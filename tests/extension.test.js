import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
function fixture() {
  const config = { serverUrl: 'https://api.example.com', ghostUrl: 'https://ghost.example.com/ghost/' };
  const local = { settings: config }; const session = { editorToken: 'old-test-token', tokenServer: config.serverUrl };
  let listener; let failRegistration = false; const calls = [];
  const area = data => ({ async get(keys) { if (typeof keys === 'string') return { [keys]: data[keys] }; return Object.fromEntries(keys.map(k => [k, data[k]])); }, async set(values) { Object.assign(data, values); }, async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; }, async setAccessLevel() {} });
  const base = 'chrome-extension://test-extension/';
  const chrome = { runtime: { id: 'test-extension', getURL: path => base + path, onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener() {} }, async openOptionsPage() {} }, action: { onClicked: { addListener() {} } }, storage: { local: area(local), session: area(session) }, permissions: { async contains() { return true; } }, scripting: { async unregisterContentScripts() {}, async registerContentScripts() { if (failRegistration) throw new Error('Registration failed'); } } };
  runInNewContext(source, { chrome, URL, AbortSignal, fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, async json() { return { editor: 'Test editor' }; } }; } });
  const dispatch = (payload, sender = { id: chrome.runtime.id, url: base + 'options.html' }) => new Promise(resolve => { if (listener(payload, sender, resolve) !== true) resolve({ ignored: true }); });
  return { local, session, dispatch, calls, base, failRegistration() { failRegistration = true; } };
}
test('background rejects panels embedded outside the configured Ghost origin', async () => {
  const f = fixture();
  const result = await f.dispatch({ type: 'api', path: '/session' }, { id: 'test-extension', url: f.base + 'panel.html', tab: { url: 'https://attacker.example.com/ghost/' } });
  assert.equal(result.ok, false); assert.match(result.error, /configured Ghost/); assert.equal(f.calls.length, 0);
  const trusted = await f.dispatch({ type: 'api', path: '/session' }, { id: 'test-extension', url: f.base + 'panel.html', tab: { url: 'https://ghost.example.com/ghost/#/editor/post/123' } });
  assert.equal(trusted.ok, true); assert.equal(f.calls.length, 1);
});
test('background never sends a token to a server other than the one it was issued for', async () => {
  const f = fixture(); f.local.settings.serverUrl = 'https://different.example.com';
  const result = await f.dispatch({ type: 'api', path: '/session' });
  assert.equal(result.ok, false); assert.equal(f.calls.length, 0);
});
test('failed settings registration keeps the old server and credential paired', async () => {
  const f = fixture(); f.failRegistration();
  const result = await f.dispatch({ type: 'settings:save', settings: { serverUrl: 'https://new.example.com', ghostUrl: 'https://new-ghost.example.com/ghost/' }, token: 'new-test-token' });
  assert.equal(result.ok, false); assert.equal(f.session.editorToken, 'old-test-token'); assert.equal(f.local.settings.serverUrl, 'https://api.example.com');
});
test('background rejects arbitrary URLs and messages from content scripts', async () => {
  const f = fixture();
  const result = await f.dispatch({ type: 'api', path: 'https://attacker.example.com' });
  assert.equal(result.ok, false); assert.equal(f.calls.length, 0);
  const other = await f.dispatch({ type: 'settings:get' }, { id: 'test-extension', url: 'https://ghost.example.com/ghost/' });
  assert.equal(other.ignored, true);
});
