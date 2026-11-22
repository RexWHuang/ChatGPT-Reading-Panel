// Observe the conversation response the page already requested. The original
// Response (including its body) goes back to the page unchanged.
(() => {
  const fetchPage = window.fetch;
  let pending;
  function deliver() {
    if (pending) document.dispatchEvent(new CustomEvent('reading-panel:questions', {detail: pending}));
  }
  let ready = false;
  document.addEventListener('reading-panel:ready', () => { ready = true; deliver(); pending = undefined; });
  async function collect(response, id) {
    const {mapping, current_node, conversation_id} = await response.json();
    if (!mapping || !current_node || (conversation_id && conversation_id !== id)) return;
    const rows = [], seen = new Set();
    let key = current_node;
    while (key) {
      const node = mapping[key];
      if (!node || seen.has(key)) return;
      seen.add(key);
      const msg = node.message;
      if (msg?.author?.role === 'user' && !msg.metadata?.is_visually_hidden_from_conversation) {
        const text = msg.content?.parts?.filter(part => typeof part === 'string').join('\n').trim();
        if (!text) return; // The page can supply the label for non-text turns.
        rows.push({id:msg.id || key, text});
      }
      key = node.parent;
    }
    if (rows.length && location.pathname.split('/').filter(Boolean).at(-1) === id) {
      pending = JSON.stringify({id, rows:rows.reverse()});
      if (ready) { deliver(); pending = undefined; }
    }
  }
  window.fetch = function (...args) {
    const result = fetchPage.apply(this, args);
    const input = args[0];
    const method = args[1]?.method || input?.method || 'GET';
    const url = typeof input === 'string' ? input : input?.url || input?.href;
    if (String(method).toUpperCase() === 'GET' && typeof url === 'string' && url.includes('conversation/')) {
      result.then(response => {
        if (!response.ok || !response.url.startsWith(location.origin + '/')) return;
        const id = new URL(response.url).pathname.match(/^\/backend-api\/(?:f\/)?conversation\/([^/]+)\/?$/)?.[1];
        if (id && location.pathname.split('/').filter(Boolean).at(-1) === id && response.headers.get('content-type')?.includes('application/json')) {
          return collect(response.clone(), id);
        }
      }).catch(() => {});
    }
    return result;
  };
})();
