const extension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
let demoToken;
export async function message(payload) {
  if (extension) {
    let response;
    try { response = await chrome.runtime.sendMessage(payload); } catch { throw new Error('Extension was updated. Reload Ghost Admin to reconnect.'); }
    if (!response?.ok) throw new Error(response?.error || 'The extension could not respond.');
    return response.data;
  }
  if (payload.type === 'settings:open') { window.open('/', '_blank', 'noopener'); return {}; }
  if (payload.type !== 'api') throw new Error('This action is available in the installed extension.');
  if (!demoToken) {
    const response = await fetch('/api/demo-session', { method: 'POST', headers: { 'X-Demo-Request': '1' } });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); demoToken = result.token;
  }
  const response = await fetch(`/api${payload.path}`, { method: payload.method || 'GET', headers: { Authorization: `Bearer ${demoToken}`, 'Content-Type': 'application/json', ...(payload.requestId ? { 'Idempotency-Key': payload.requestId } : {}) }, ...(payload.body ? { body: JSON.stringify(payload.body) } : {}), signal: AbortSignal.timeout(25000) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Server request failed.'); return result;
}
export const api = (path, method = 'GET', body) => message({ type: 'api', path, method, body, ...(method !== 'GET' ? { requestId: crypto.randomUUID() } : {}) });
