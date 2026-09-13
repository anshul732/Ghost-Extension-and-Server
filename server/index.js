import { resolve } from 'node:path';
import { createApp } from './app.js';

const env = process.env;
try {
  const mode = env.MODE || 'demo';
  const host = env.HOST || '127.0.0.1';
  if (mode === 'demo' && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Demo mode must bind to loopback. Use MODE=live for deployment.');
  if (env.GHOST_URL && (new URL(env.GHOST_URL).protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(new URL(env.GHOST_URL).hostname))) throw new Error('Use HTTPS for your Ghost server.');
  const app = await createApp({ mode, approvalPostId: env.GHOST_APPROVAL_POST_ID, approvalResource: env.GHOST_APPROVAL_RESOURCE || 'posts', dataDir: resolve(env.DATA_DIR || './data'), tokens: env.EDITOR_TOKENS ? JSON.parse(env.EDITOR_TOKENS) : undefined, airtable: { token: env.AIRTABLE_TOKEN, base: env.AIRTABLE_BASE_ID, table: env.AIRTABLE_TABLE_ID, fields: JSON.parse(env.AIRTABLE_FIELDS || '{}'), statuses: JSON.parse(env.AIRTABLE_STATUSES || '{}') }, ghost: { url: env.GHOST_URL, key: env.GHOST_ADMIN_KEY } });
  app.server.listen(Number(env.PORT || 8787), host, () => {
    console.log(`Opportunities server (${mode}) listening on http://${host}:${app.server.address().port}`);
    if (mode === 'demo') console.log('Open http://localhost:' + app.server.address().port + ' to try the demo. Use “Copy demo token” to connect the installed extension.');
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => app.server.close(() => process.exit(0)));
} catch (error) { console.error(error.message); process.exitCode = 1; }
