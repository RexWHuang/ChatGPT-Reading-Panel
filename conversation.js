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
  function markdownHeadings(msg) {
    const items = [];
    let fence = '', previous = '';
    for (const line of (msg.content.parts || []).filter(p => typeof p === 'string').join('\n').split(/\r?\n/)) {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (marker && (!fence || (marker[1].startsWith(fence) && !marker[2].trim()))) {
        fence = fence ? '' : marker[1]; previous = ''; continue;
      }
      if (fence) continue;
      const atx = /^ {0,3}(#{1,2})[ \t]+(.+?)\s*$/.exec(line);
      const underline = previous && /^ {0,3}(=+|-+)\s*$/.exec(line);
      if (atx || underline) {
        const level = atx ? atx[1].length : underline[1][0] === '=' ? 1 : 2;
        const text = atx ? atx[2].replace(/\s+#+$/, '').trim() : previous;
        if (text) items.push({level,text});
      }
      previous = /^ {0,3}[^\s#>*|\-]/.test(line) && !atx && !underline ? line.trim() : '';
    }
    return items;
  }
  async function collect(response, id) {
    const {mapping, current_node, conversation_id} = await response.json();
    if (!mapping || !current_node || (conversation_id && conversation_id !== id)) return;
    const rows = [], seen = new Set();
    let key = current_node, answers = [];
    while (key) {
      const node = mapping[key];
      if (!node || seen.has(key)) return;
      seen.add(key);
      const msg = node.message;
      if (msg?.author?.role === 'user' && !msg.metadata?.is_visually_hidden_from_conversation) {
        const text = msg.content?.parts?.filter(part => typeof part === 'string').join('\n').trim();
        if (!text) return; // The page can supply the label for non-text turns.
        rows.push({id:msg.id || key, text, answers:answers.reverse()});
        answers = [];
      } else if (msg?.author?.role === 'assistant' && (!msg.channel || msg.channel === 'final') && (!msg.recipient || msg.recipient === 'all') &&
                 !msg.metadata?.is_visually_hidden_from_conversation && ['text','multimodal_text'].includes(msg.content?.content_type)) {
        const headings = markdownHeadings(msg);
        if (headings.length) answers.push({id:msg.id || key,headings});
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
