import { HttpError, assert, ghostToken, patchDraft, revision } from './domain.js';

export const fields = { title: 'Title', organization: 'Organization', summary: 'Summary', url: 'URL', deadline: 'Deadline', category: 'Category', status: 'Status' };
export async function upstream(url, init = {}, fetcher = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw new HttpError(502, 'The upstream service could not be reached. Refresh before retrying a change.'); }
    if (response.status === 429 && attempt < 2) {
      const seconds = Number(response.headers.get('retry-after'));
      if (seconds > 5) throw new HttpError(429, `Service rate limit reached. Try again in ${seconds} seconds.`);
      await new Promise(resolve => setTimeout(resolve, Math.max(500 * 2 ** attempt, (seconds || 0) * 1000)));
      continue;
    }
    if (!response.ok) throw new HttpError(response.status === 409 ? 409 : response.status === 429 ? 429 : 502, `Upstream request failed (${response.status}). Check server credentials, field mapping, and record access.`);
    return response.json();
  }
}
export function airtableAdapter(config, fetcher) {
  const mapping = { ...fields, ...config.fields };
  const statuses = { pending: 'pending', approved: 'approved', rejected: 'rejected', ...config.statuses };
  const root = `https://api.airtable.com/v0/${encodeURIComponent(config.base)}/${encodeURIComponent(config.table)}`;
  const request = (path, init = {}) => upstream(root + path, { ...init, headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' } }, fetcher);
  const normalize = record => {
    const item = { id: record.id, createdAt: record.createdTime || '' };
    for (const [key, field] of Object.entries(mapping)) item[key] = typeof record.fields[field] === 'string' ? record.fields[field] : '';
    item.status = Object.keys(statuses).find(k => statuses[k] === item.status) || 'unknown';
    return { ...item, revision: revision(record.fields) };
  };
  return {
    async list() {
      const records = []; let offset;
      do { const data = await request(`?pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`); records.push(...data.records.map(normalize)); offset = data.offset; if (offset) await new Promise(resolve => setTimeout(resolve, 210)); } while (offset);
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    },
    async get(id) { return normalize(await request(`/${encodeURIComponent(id)}`)); },
    async update(id, patch, expected) {
      const current = await this.get(id);
      assert(current.revision === expected, 409, 'This opportunity changed. Refresh and review the latest version.');
      for (const [key, value] of Object.entries(patch)) assert(mapping[key] || !value, 400, `No Airtable field is configured for ${key}.`);
      const values = Object.fromEntries(Object.entries(patch).filter(([key]) => mapping[key]).map(([key, value]) => [mapping[key], key === 'status' ? statuses[value] : value || null]));
      return normalize(await request(`/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ fields: values }) }));
    }
  };
}
export function ghostAdapter(config, fetcher) {
  const root = `${config.url.replace(/\/$/, '')}/ghost/api/admin/`;
  const request = (path, init = {}) => upstream(root + path, { ...init, headers: { Authorization: `Ghost ${ghostToken(config.key)}`, 'Content-Type': 'application/json', 'Accept-Version': 'v5.0' } }, fetcher);
  return {
    async list() { return (await request('posts/?filter=status%3Adraft&limit=100&formats=lexical')).posts; },
    async get(id, resource = 'posts') { assert(['posts','pages'].includes(resource), 400, 'Invalid Ghost resource.'); return (await request(`${resource}/${encodeURIComponent(id)}/?formats=lexical`))[resource][0]; },
    async putOpportunity(id, record, remove, options = {}) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const resource = options.resource || 'posts';
        const post = await this.get(id, resource);
        const lexical = patchDraft(post, record, remove, options);
        if (!lexical) return post;
        try { return (await request(`${resource}/${encodeURIComponent(id)}/?save_revision=true`, { method: 'PUT', body: JSON.stringify({ [resource]: [{ lexical, updated_at: post.updated_at }] }) }))[resource][0]; }
        catch (error) { if (error.status !== 409 || attempt) throw error; }
      }
    }
  };
}
