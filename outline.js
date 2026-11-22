(() => {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;top:19%;z-index:2147483000';
  document.body.append(host);
  const ui = host.attachShadow({mode:'closed'});
  ui.innerHTML = `<style>
    :host{color-scheme:light dark}*{box-sizing:border-box}button{font:inherit;cursor:pointer;color:inherit}
    button:focus-visible{outline:2px solid #518c85}.toggle,.back,section{background:Canvas;color:CanvasText;border:1px solid #8886;border-radius:14px;box-shadow:0 4px 18px #0002}
    .actions{display:flex;justify-content:flex-end;gap:5px}.toggle,.back{padding:8px 13px;font:600 13px system-ui}section{clear:both;position:relative;top:6px;padding:14px;width:min(330px,86vw);font:14px/1.55 system-ui}
    header{display:flex;justify-content:space-between;align-items:center}header button{background:none;border:0;text-decoration:underline;font-size:12px}ol{max-height:57vh;overflow:auto;padding-left:29px;margin-bottom:0}
    li{padding:4px 0;color:#628e85}li button{color:CanvasText;text-align:left;display:block;width:100%;border:0;background:none;padding:4px;overflow-wrap:anywhere}li button:hover{background:#8882;border-radius:5px}small{display:block;opacity:.65}
    </style><div class="actions"><button class="back" hidden>返回阅读位置</button><button class="toggle" aria-expanded="false">提问目录</button></div><section hidden><header><strong>当前提问</strong><button>更新目录</button></header><ol></ol><small role="status"></small></section>`;
  const panel = ui.querySelector('section'), toggle = ui.querySelector('.toggle');
  const list = ui.querySelector('ol'), status = ui.querySelector('small');
  const back = ui.querySelector('.back');
  let returnTo;
  function setReturn(position) {
    returnTo = position;
    back.hidden = !position;
  }
  function readingPosition(box) {
    const edge = Math.max(0, box.getBoundingClientRect().top);
    const anchor = [...box.querySelectorAll('[data-turn-key]')].find(el => el.getBoundingClientRect().bottom > edge);
    return {box, top:box.scrollTop, key:anchor?.dataset.turnKey, y:anchor?.getBoundingClientRect().top};
  }
  function questions() {
    const selector = ':is([data-message-author-role="user"], [data-turn="user"], [class~="group/user-message"])';
    return [...document.querySelectorAll("main "+selector)]
      .filter(el => !outgoing.has(el) && !el.closest('[data-app-shell-active-page="false"]') && !el.querySelector(selector))
      .map(el => {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('.chatgpt-timestamp,button,svg,.sr-only').forEach(n => n.remove());
        const id = el.closest('[data-message-id]')?.dataset.messageId ||
          el.closest('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids') || el.closest('[data-turn-key]')?.dataset.turnKey;
        return {el, id, text:copy.textContent.trim(), time:el.querySelector('.chatgpt-turn-time,time')?.textContent || ''};
      }).filter(q => q.text);
  }
  let jumpSerial = 0;
  document.addEventListener("wheel", () => ++jumpSerial, {passive:true});
  back.onclick = async () => {
    const position = returnTo;
    const serial = ++jumpSerial;
    const path = location.pathname;
    setReturn(null);
    if (!position?.box.isConnected) return;
    const {box, top, key, y} = position;
    box.scrollTo({top, behavior:'instant'});
    for (let pass = 0; pass < 4; pass++) {
      await settle();
      if (path !== location.pathname || serial !== jumpSerial) return;
      const anchor = key && box.querySelector(`[data-turn-key="${CSS.escape(key)}"]`);
      const corrected = anchor ? box.scrollTop + anchor.getBoundingClientRect().top - y : top;
      if (Math.abs(corrected - box.scrollTop) > 1) box.scrollTo({top:corrected, behavior:'instant'});
    }
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 180));
  function scrollBox(el) {
    for (let box=el.parentElement; box; box=box.parentElement) {
      if (box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY)) return box;
    }
    return document.scrollingElement;
  }
  const promptSelector = 'main :is([data-message-author-role="user"], [data-turn="user"], [class~="group/user-message"])';

  let state, outgoing = new WeakSet(), frame = 0, collapsed = false;
  const update = ui.querySelector('header button');
  const chatId = () => location.pathname.match(/\/c\/([^/]+)\/?$/)?.[1];
  const matches = (a,b) => a.id && b.id ? a.id === b.id : a.text === b.text;
  const current = route => state === route && location.pathname === route.path;
  const offset = (el,box) => el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;

  // Insert newly mounted turns next to a known neighbour. Virtual windows can
  // overlap at either end or include two distinct questions with the same text.
  function merge(rows, incoming) {
    let cursor = -1, changed = false;
    for (let i=0; i<incoming.length; i++) {
      const q = incoming[i];
      const index = rows.findIndex(item => matches(item,q));
      if (index >= 0) {
        cursor = index;
        if (rows[index].text !== q.text) { rows[index].text = q.text; changed = true; }
        if (Number.isFinite(q.top)) rows[index].top = q.top;
      } else {
        if (cursor >= 0) cursor++;
        else {
          const next = incoming.slice(i+1).find(n => rows.some(r => matches(r,n)));
          cursor = next ? rows.findIndex(r => matches(r,next)) : rows.findIndex(r => r.top > q.top);
          if (cursor < 0) cursor = rows.length;
        }
        rows.splice(cursor,0,{...q});
        changed = true;
      }
    }
    return changed;
  }

  function draw(route) {
    const buttons = document.createDocumentFragment();
    for (const q of route.rows) {
      const li = document.createElement('li'), btn = document.createElement('button');
      btn.textContent = q.text.length > 100 ? q.text.slice(0,99)+'…' : q.text;
      btn.onclick = () => jump(route,q);
      li.append(btn); buttons.append(li);
    }
    list.replaceChildren(buttons);
    status.textContent = route.rows.length ? (route.complete ? '' : '已显示 ') + route.rows.length + ' 个提问' : '等待页面显示提问';
    update.disabled = route.scanning;
  }

  async function jump(route,q) {
    const serial = ++jumpSerial;
    const current = () => route === state && serial === jumpSerial && route.path === location.pathname;
    let mounted = questions();
    if (!mounted.length) {
      status.textContent = '正在等待聊天正文…';
      const deadline = performance.now()+30000;
      while (current() && !mounted.length && performance.now()<deadline) {
        await settle();
        mounted = questions();
      }
      if (!current()) return;
      if (!mounted.length) { status.textContent = '正文尚未显示，暂时无法跳转。'; return; }
      draw(route);
    }
    if (route.scanning) route.stopScan = true;
    const box = scrollBox(mounted[0].el);
    const move = top => box.scrollTo({top,behavior:'instant'});
    const origin = readingPosition(box);
    const find = () => questions().find(item =>
      (item.id && q.id) ? item.id===q.id : item.text===q.text);
    let target=find();
    if (!target && Number.isFinite(q.top)) { move(q.top-box.clientHeight/3); await settle(); }
    let stable=0, searching=false, resets=0;
    const deadline=performance.now()+30000;
    while (current() && performance.now()<deadline) {
      target=find();
      if (target) {
        const bounds=target.el.getBoundingClientRect();
        if (bounds.bottom>0 && bounds.top<innerHeight &&
            Math.abs(bounds.top+bounds.height/2-innerHeight/2)<innerHeight*.42) {
          if (++stable>=7) {
            if (Math.abs(box.scrollTop - origin.top) > 1) setReturn(origin);
            return;
          }
        } else {
          stable=0;
          target.el.scrollIntoView({block:'center',behavior:'instant'});
        }
      } else {
        stable=0;
        if (!searching) { move(0); searching=true; }
        else if (box.scrollTop+box.clientHeight<box.scrollHeight-2) {
          move(box.scrollTop+Math.max(1,Math.floor(box.clientHeight*.65)));
        } else if (++resets<2) move(0);
        else break;
      }
      await settle();
    }
    if (current()) status.textContent='未定位到这条提问，请更新目录后重试。';
  }
  function unpack(value) {
    if (Array.isArray(value)) return {rows:value, complete:true};
    return value?.rows ? value : {rows:[],complete:false};
  }
  async function save(route, replace=false) {
    const rows = route.rows.map(q => ({...q})), complete = route.complete;
    try {
      await navigator.locks.request(route.key, async () => {
        if (!current(route)) return;
        const saved = unpack((await chrome.storage.local.get(route.key))[route.key]);
        if (!current(route)) return;
        if (replace) restoreOffsets(rows,saved.rows);
        if (replace && saved.complete === complete && saved.rows.length === rows.length &&
            rows.every((r,i) => r.id === saved.rows[i].id && r.text === saved.rows[i].text)) return;
        if (!replace && !merge(saved.rows,rows)) return;
        await chrome.storage.local.set({[route.key]:replace ? {rows,complete} : saved});
      });
    } catch {
      if (current(route)) status.textContent = '目录可用，本次未能保存到本机。';
    }
  }
  function restoreOffsets(rows, previous) {
    const positions = new Map(previous.filter(q => q.id && Number.isFinite(q.top)).map(q => [q.id,q.top]));
    for (const q of rows) {
      if (positions.has(q.id) && !Number.isFinite(q.top)) q.top = positions.get(q.id);
    }
  }
  function mountedRows() {
    const items = questions();
    if (!items.length) return [];
    const box = scrollBox(items[0].el);
    return items.map(({id,text,el}) => ({...(id ? {id} : {}),text,top:offset(el,box)}));
  }
  function refreshMounted(route) {
    if (!route?.key || !current(route) || document.hidden || route.scanning) return;
    if (merge(route.rows,mountedRows())) {
      draw(route);
      if (route.restored) save(route);
    }
  }
  function enter() {
    if (state?.path === location.pathname) return;
    const id = chatId();
    const route = state = {path:location.pathname,key:id && 'outline-v1:'+id,rows:[],complete:false};
    ++jumpSerial;
    setReturn(null);
    host.hidden = !id;
    panel.hidden = collapsed;
    toggle.setAttribute('aria-expanded',String(!collapsed));
    draw(route);
    if (!id) return;
    refreshMounted(route);
    chrome.storage.local.get(route.key).then(result => {
      if (!current(route)) return;
      route.restored = true;
      const saved = unpack(result[route.key]);
      if (route.authoritative) { restoreOffsets(route.rows,saved.rows); return; }
      const added = merge(saved.rows,route.rows);
      route.rows = saved.rows;
      route.complete = saved.complete;
      draw(route);
      if (added) save(route);
    }).catch(() => { if (current(route)) route.restored = true; });
  }
  // Explicit fallback for sites or conversation formats that expose only a
  // virtual window. Merely entering or expanding a chat never scrolls it.
  update.onclick = async () => {
    const route = state, first = questions()[0];
    if (!first || route.scanning) return;
    const box = scrollBox(first.el), origin = box.scrollTop, rows = [];
    const interrupt = () => { route.stopScan = true; };
    route.scanning = update.disabled = true;
    route.stopScan = false;
    status.textContent = '正在从页面补全目录…';
    box.addEventListener('wheel',interrupt,{passive:true});
    box.addEventListener('touchstart',interrupt,{passive:true});
    const active = () => current(route) && !document.hidden && !route.stopScan;
    const deadline = performance.now()+120000;
    try {
      let stable = 0, height = -1;
      while (active() && stable < 4 && performance.now() < deadline) {
        box.scrollTo({top:0,behavior:'instant'});
        await settle();
        stable = box.scrollTop < 2 && box.scrollHeight === height ? stable+1 : 0;
        height = box.scrollHeight;
      }
      while (active() && performance.now() < deadline) {
        merge(rows,mountedRows());
        if (box.scrollTop+box.clientHeight >= box.scrollHeight-2) {
          if (rows.length) {
            route.rows = rows; route.authoritative = route.complete = true;
            save(route,true);
          }
          break;
        }
        box.scrollTo({top:box.scrollTop+Math.max(1,Math.floor(box.clientHeight*.85)),behavior:'instant'});
        await settle();
      }
    } finally {
      box.removeEventListener('wheel',interrupt);
      box.removeEventListener('touchstart',interrupt);
      route.scanning = false;
      if (current(route)) {
        if (!route.stopScan) box.scrollTo({top:origin,behavior:'instant'});
        draw(route);
      }
    }
  };
  toggle.onclick = () => {
    collapsed = panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded',String(!collapsed));
  };
  window.navigation?.addEventListener('navigate', e => {
    if (new URL(e.destination.url).pathname !== location.pathname) outgoing = new WeakSet(document.querySelectorAll(promptSelector));
  });
  window.navigation?.addEventListener('currententrychange',enter);
  document.addEventListener('reading-panel:questions', e => {
    if (typeof e.detail !== 'string') return;
    let data;
    try { data = JSON.parse(e.detail); } catch { return; }
    const {id,rows} = data || {};
    enter();
    if (!id || id !== chatId() || !Array.isArray(rows) || !rows.length ||
        !rows.every(q => typeof q?.id === 'string' && typeof q.text === 'string')) return;
    const next = rows.map(({id,text}) => ({id,text}));
    restoreOffsets(next,state.rows);
    state.rows = next;
    state.authoritative = state.complete = true;
    draw(state);
    save(state,true);
  });
  function schedule() {
    if (frame || document.hidden) return;
    frame = requestAnimationFrame(() => { frame = 0; enter(); refreshMounted(state); });
  }
  const selector = promptSelector.slice(5);
  const observer = new MutationObserver(records => {
    if (location.pathname !== state.path || records.some(r =>
      r.target.parentElement?.closest(selector) || r.target.closest?.(selector) ||
      [...r.addedNodes].some(n => n.nodeType === 1 && (n.matches(selector) || n.querySelector(selector))))) schedule();
  });
  document.addEventListener('visibilitychange',schedule);
  enter();
  document.dispatchEvent(new Event('reading-panel:ready'));
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributeFilter:['data-message-author-role','data-turn']});
})();
