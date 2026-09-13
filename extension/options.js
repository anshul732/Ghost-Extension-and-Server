import { message, api } from './bridge.js';
const $ = s => document.querySelector(s);
const status = (text, error = false) => { $('#setup-status').hidden = false; $('#setup-status').className = `notice${error ? ' error' : ''}`; $('#setup-status').textContent = text; };
message({ type: 'settings:get' }).then(config => { $('#server-url').value = config.serverUrl; $('#ghost-url').value = config.ghostUrl; if (config.hasToken) $('#editor-token').placeholder = 'Connected token saved for this session'; }).catch(e => status(e.message, true));
$('#setup-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#connect').disabled = true;
  try {
    const settings = { serverUrl: $('#server-url').value.trim(), ghostUrl: $('#ghost-url').value.trim() };
    const origins = [...new Set([settings.serverUrl, settings.ghostUrl].map(value => `${new URL(value).origin}/*`))];
    // Request host access directly within the user gesture.
    if (!await chrome.permissions.request({ origins })) throw new Error('Site access was not granted. Allow the chosen server and Ghost site to connect.');
    await message({ type: 'settings:save', settings, token: $('#editor-token').value });
    const session = await api('/session');
    $('#editor-token').value = '';
    status(`Connected as ${session.editor} (${session.mode}). Reload Ghost Admin and click the extension icon to open your panel.`);
  } catch (error) { status(error.message || 'Connection failed.', true); }
  finally { $('#connect').disabled = false; }
});
$('#disconnect').addEventListener('click', () => message({ type: 'logout' }).then(() => status('Disconnected. Paste an editor token to reconnect.')).catch(e => status(e.message, true)));
