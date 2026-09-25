const defaults = { serverUrl: '', ghostUrl: '' };
const settings = async () => ({ ...defaults, ...(await chrome.storage.local.get('settings')).settings });
function validUrl(value, ghost = false) {
  const url = new URL(value);
  if (url.username || url.password || !(['https:'].includes(url.protocol) || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Use HTTPS, or HTTP on localhost for development.');
  if (!ghost && url.pathname !== '/') throw new Error('Use the server origin without a path, for example https://api.example.com.');
  url.hash = ''; url.search = '';
  return ghost ? url.href : url.origin;
}
async function register(config) {
  const ghost = new URL(config.ghostUrl);
  const matches = [`${ghost.origin}${ghost.pathname.startsWith('/mock-ghost') ? '/mock-ghost/*' : '/ghost/*'}`];
  await chrome.scripting.unregisterContentScripts({ ids: ['opportunities-panel'] }).catch(() => {});
  await chrome.scripting.registerContentScripts([{ id: 'opportunities-panel', matches, js: ['content.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
}
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.runtime.openOptionsPage();
});
chrome.action.onClicked.addListener(async tab => {
  const config = await settings();
  if (!config.ghostUrl) return chrome.runtime.openOptionsPage();
  const ghost = new URL(config.ghostUrl);
  if (!tab.id || !tab.url?.startsWith(ghost.origin + (ghost.pathname.startsWith('/mock-ghost') ? '/mock-ghost/' : '/ghost/'))) return chrome.runtime.openOptionsPage();
  try { await chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' }); }
  catch { try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch { await chrome.runtime.openOptionsPage(); } }
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const allowed = ['panel.html', 'options.html'].some(path => sender.url === chrome.runtime.getURL(path));
  if (sender.id !== chrome.runtime.id || !allowed) return;
  (async () => {
    if (sender.url === chrome.runtime.getURL('panel.html')) {
      const config = await settings(); const ghost = new URL(config.ghostUrl);
      const topUrl = sender.tab?.url;
      const expectedPath = ghost.pathname.startsWith('/mock-ghost') ? '/mock-ghost/' : '/ghost/';
      if (topUrl !== chrome.runtime.getURL('panel.html') && !topUrl?.startsWith(ghost.origin + expectedPath)) throw new Error('Open this panel inside your configured Ghost Admin site.');
    }
    if (message.type === 'settings:get') {
      const config = await settings(); const session = await chrome.storage.session.get(['editorToken', 'tokenServer']);
      return { ...config, hasToken: !!session.editorToken && session.tokenServer === config.serverUrl };
    }
    if (message.type === 'settings:open') { await chrome.runtime.openOptionsPage(); return {}; }
    if (message.type === 'settings:save') {
      if (sender.url !== chrome.runtime.getURL('options.html')) throw new Error('Settings can only be changed from the setup page.');
      const config = { serverUrl: validUrl(message.settings.serverUrl), ghostUrl: validUrl(message.settings.ghostUrl, true) };
      if (!await chrome.permissions.contains({ origins: [`${new URL(config.serverUrl).origin}/*`, `${new URL(config.ghostUrl).origin}/*`] })) throw new Error('Allow access to the selected server and Ghost site.');
      const old = await settings();
      await register(config);
      await chrome.storage.local.set({ settings: config });
      if (typeof message.token === 'string' && message.token.trim()) await chrome.storage.session.set({ editorToken: message.token.trim(), tokenServer: config.serverUrl });
      else if (old.serverUrl !== config.serverUrl) await chrome.storage.session.remove(['editorToken', 'tokenServer']);
      return { saved: true };
    }
    if (message.type === 'logout') { await chrome.storage.session.remove(['editorToken', 'tokenServer']); return {}; }
    if (message.type === 'api') {
      const { serverUrl } = await settings();
      const { editorToken, tokenServer } = await chrome.storage.session.get(['editorToken', 'tokenServer']);
      if (!editorToken || tokenServer !== serverUrl) throw new Error('Connect your editor account in Settings. Your session ends when the browser closes.');
      const { method = 'GET', path, body, requestId } = message;
      const permitted = (method === 'GET' && ['/session', '/opportunities', '/drafts', '/activity'].includes(path)) || (method === 'PATCH' && /^\/opportunities\/[\w-]+$/.test(path)) || (method === 'POST' && (/^\/drafts\/[\w-]+\/(add|swap)$/.test(path) || path === '/commands/preview'));
      if (!permitted) throw new Error('Unsupported action.');
      const response = await fetch(`${serverUrl}/api${path}`, { method, headers: { Authorization: `Bearer ${editorToken}`, 'Content-Type': 'application/json', ...(requestId ? { 'Idempotency-Key': requestId } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000), redirect: 'error' });
      const result = await response.json();
      if (!response.ok) { if (response.status === 401) await chrome.storage.session.remove(['editorToken', 'tokenServer']); throw new Error(result.error || `Server returned ${response.status}.`); }
      return result;
    }
    throw new Error('Unknown request.');
  })().then(data => reply({ ok: true, data }), error => reply({ ok: false, error: error.message || 'Could not connect to the server.' }));
  return true;
});
