(() => {
  if (window.__opportunitiesMounted) return;
  window.__opportunitiesMounted = true;
  const host = document.createElement('div');
  host.id = 'opportunities-extension-root';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host{all:initial!important;position:fixed!important;inset:0 0 0 auto!important;width:min(440px,100vw)!important;height:100dvh!important;z-index:2147483646!important;display:block!important;box-shadow:-10px 0 50px #1112!important}iframe{border:0;width:100%;height:100%;display:block;background:#faf9f6}.handle{position:absolute;left:-34px;top:110px;width:34px;height:52px;border:1px solid #dedbd3;border-right:0;border-radius:10px 0 0 10px;background:#faf9f6;color:#363b32;cursor:pointer;font:20px system-ui}.hidden{display:none}:host(.collapsed){width:0!important}';
  const frame = document.createElement('iframe'); frame.src = chrome.runtime.getURL('panel.html'); frame.title = 'Opportunities editor panel';
  const button = document.createElement('button'); button.className = 'handle'; button.textContent = '›'; button.setAttribute('aria-label', 'Collapse opportunities panel');
  let open = true;
  function toggle() { open = !open; host.classList.toggle('collapsed', !open); frame.classList.toggle('hidden', !open); button.textContent = open ? '›' : '‹'; button.setAttribute('aria-label', `${open ? 'Collapse' : 'Open'} opportunities panel`); }
  button.addEventListener('click', toggle);
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'toggle-panel') toggle(); });
  shadow.append(style, frame, button);
  const mount = () => { if (!host.isConnected && document.body) document.body.append(host); };
  mount();
  // Ghost is a SPA; reattach the same host if a route transition removes it.
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
})();
