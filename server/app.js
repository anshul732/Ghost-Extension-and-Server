import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { HttpError, assert, draftRecordIds, parseCommand, revision, safeId, validatePatch } from './domain.js';
import { airtableAdapter, ghostAdapter } from './adapters.js';
import { createStore, demoAdapters } from './store.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sameToken = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const summarizeDraft = d => ({ id: d.id, title: d.title, status: d.status, updatedAt: d.updated_at, recordIds: draftRecordIds(d) });
async function body(req) {
  let length = 0; const chunks = [];
  for await (const chunk of req) { length += chunk.length; assert(length <= 32768, 413, 'Request too large.'); chunks.push(chunk); }
  try { const data = JSON.parse(Buffer.concat(chunks).toString() || '{}'); assert(data && typeof data === 'object' && !Array.isArray(data), 400, 'Expected an object.'); return data; }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'Invalid JSON.'); }
}
export async function createApp(config = {}) {
  const mode = config.mode || 'demo';
  assert(['posts','pages'].includes(config.approvalResource || 'posts'), 500, 'Invalid approval resource.');
  assert(['live', 'demo'].includes(mode), 500, 'MODE must be demo or live.');
  const demo = mode === 'demo';
  const tokens = config.tokens || (demo ? { 'Demo editor': randomBytes(32).toString('hex') } : {});
  assert(Object.keys(tokens).length && Object.values(tokens).every(v => typeof v === 'string' && v.length >= 32), 500, 'Configure EDITOR_TOKENS with random tokens of at least 32 characters.');
  if (!demo) assert(config.airtable?.token && config.airtable?.base && config.airtable?.table, 500, 'Set AIRTABLE_TOKEN, AIRTABLE_BASE_ID, and AIRTABLE_TABLE_ID.');
  const store = await createStore(config.dataDir || resolve(root, 'data'));
  const adapters = demo ? demoAdapters(store) : { airtable: airtableAdapter(config.airtable), ghost: config.ghost?.url && config.ghost?.key ? ghostAdapter(config.ghost) : null };
  const { airtable, ghost } = config.adapters || adapters;
  let tail = Promise.resolve();
  const serialize = fn => { const result = tail.then(fn); tail = result.catch(() => {}); return result; };
  const server = createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') return send(200, { ok: true });
      const port = server.address()?.port;
      const localOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
      if (url.pathname === '/api/demo-session' && req.method === 'POST') {
        assert(demo && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && localOrigins.includes(req.headers.origin) && req.headers['x-demo-request'] === '1', 403, 'Demo sessions are available only from the local demo page.');
        return send(200, { token: Object.values(tokens)[0] });
      }
      if (!url.pathname.startsWith('/api/')) {
        assert(demo && req.method === 'GET', 404, 'Not found.');
        if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        const files = { '/': 'demo/index.html', '/mock-ghost/': 'demo/index.html', '/demo.js': 'demo/demo.js', '/demo.css': 'demo/demo.css', '/panel.html': 'extension/panel.html', '/panel.css': 'extension/panel.css', '/panel.js': 'extension/panel.js', '/bridge.js': 'extension/bridge.js', '/review.js': 'extension/review.js' };
        const path = files[url.pathname]; assert(path, 404, 'Not found.');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
        const data = await readFile(resolve(root, path));
        res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(path)] }); res.end(data); return;
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const editor = Object.keys(tokens).find(name => sameToken(tokens[name], token));
      assert(editor, 401, 'Connect with a valid editor access token in extension settings.');
      if (url.pathname === '/api/session' && req.method === 'GET') return send(200, { editor, mode, ghost: !!ghost, approvalPostId: config.approvalPostId || null, approvalResource: config.approvalResource || 'posts' });
      if (url.pathname === '/api/opportunities' && req.method === 'GET') return send(200, { records: await airtable.list() });
      if (url.pathname === '/api/drafts' && req.method === 'GET') return send(200, { drafts: ghost ? (await ghost.list()).map(summarizeDraft) : [] });
      if (url.pathname === '/api/activity' && req.method === 'GET') return send(200, { activity: store.state.activity.slice(0, 50) });
      if (url.pathname === '/api/demo-draft' && req.method === 'GET') { assert(demo, 404, 'Not found.'); return send(200, { post: await ghost.get('demoDraft') }); }
      assert(['POST', 'PATCH'].includes(req.method), 404, 'Endpoint not found.');
      assert(req.headers['content-type']?.includes('application/json'), 415, 'Use application/json.');
      const input = await body(req);
      if (url.pathname === '/api/commands/preview' && req.method === 'POST') {
        const { record, status } = parseCommand(input.text, await airtable.list());
        return send(200, { record, status, message: `Mark “${record.title}” as ${status}?` });
      }
      const updateMatch = req.method === 'PATCH' && url.pathname.match(/^\/api\/opportunities\/([\w-]+)$/);
      const draftMatch = req.method === 'POST' && url.pathname.match(/^\/api\/drafts\/([\w-]+)\/(add|swap)$/);
      assert(updateMatch || draftMatch, 404, 'Endpoint not found.');
      const requestId = req.headers['idempotency-key'];
      assert(typeof requestId === 'string' && /^[\w-]{16,100}$/.test(requestId), 400, 'A unique Idempotency-Key is required.');
      const result = await serialize(async () => {
        const key = revision([editor, requestId]);
        const fingerprint = revision([req.method, url.pathname, input]);
        const prior = store.state.operations[key];
        if (prior) {
          assert(prior.fingerprint === fingerprint, 409, 'This request ID was used for a different action.');
          assert(prior.result || (prior.approvalPostId && prior.approvalPostId === config.approvalPostId), 409, 'The earlier request may have reached the service. Refresh and inspect the record or draft before submitting a new action.');
          if (prior.result) return prior.result;
        }
        let execute, description, approvalPostId;
        if (updateMatch) {
          const id = safeId(updateMatch[1]); const patch = validatePatch(input.fields);
          assert(typeof input.revision === 'string', 400, 'A record revision is required.');
          // Preflight check, plus the adapter re-checks immediately before writing.
          assert((await airtable.get(id)).revision === input.revision, 409, 'This opportunity changed. Refresh and review the latest version.');
          approvalPostId = patch.status === 'approved' ? config.approvalPostId : undefined;
          if (approvalPostId) assert(ghost, 503, 'Ghost must be connected before approving.');
          execute = async () => {
            if (approvalPostId) {
              const current = await airtable.get(id);
              const post = await ghost.putOpportunity(approvalPostId, {...current, ...patch}, undefined, {approvalPostId, resource: config.approvalResource || 'posts'});
              try { return {record: await airtable.update(id, patch, input.revision), draft: summarizeDraft(post)}; }
              catch { throw new HttpError(409, 'Added to Ghost, but Airtable approval did not finish. Refresh and approve again to reconcile; the opportunity will not be duplicated.'); }
            }
            return { record: await airtable.update(id, patch, input.revision) };
          };
          description = patch.status ? `Marked opportunity ${patch.status}` : 'Updated opportunity details';
        } else {
          assert(ghost, 503, 'Configure GHOST_URL and GHOST_ADMIN_KEY on the server to connect drafts.');
          const id = safeId(draftMatch[1]); const record = await airtable.get(safeId(input.recordId));
          assert(record.status === 'approved', 409, 'Approve the opportunity before adding it to a draft.');
          const removeId = draftMatch[2] === 'swap' ? safeId(input.removeId) : undefined;
          execute = async () => ({ draft: summarizeDraft(await ghost.putOpportunity(id, record, removeId)) });
          description = removeId ? `Swapped an opportunity for ${record.title}` : `Added ${record.title} to draft`;
        }
        store.state.operations[key] = { fingerprint, approvalPostId, startedAt: new Date().toISOString() };
        await store.save();
        const value = await execute();
        store.state.operations[key].result = value;
        store.state.activity.unshift({ id: requestId, editor, description, at: new Date().toISOString(), recordId: updateMatch?.[1] || input.recordId });
        store.state.activity = store.state.activity.slice(0, 200);
        // Retain unresolved writes; bound successful replay history to 500 operations.
        const complete = Object.keys(store.state.operations).filter(k => store.state.operations[k].result);
        complete.slice(0, Math.max(0, complete.length - 500)).forEach(k => delete store.state.operations[k]);
        await store.save(); return value;
      });
      return send(200, result);
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.name);
      if (!res.headersSent) send(error.status || 500, error.status ? { error: error.message } : { error: 'Server error. Check server logs and refresh before retrying.' });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  return { server, store, tokens, mode };
}
