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
  let page = location.pathname, returnTo;
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
      .filter(el => !el.closest('[data-app-shell-active-page="false"]') && !el.querySelector(selector))
      .map(el => {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('.chatgpt-timestamp,button,svg,.sr-only').forEach(n => n.remove());
        const id = el.closest('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids') ||
          el.closest('[data-message-id]')?.dataset.messageId || el.closest('[data-turn-key]')?.dataset.turnKey;
        return {el, id, text:copy.textContent.trim(), time:el.querySelector('.chatgpt-turn-time,time')?.textContent || ''};
      }).filter(q => q.text);
  }
  let generation = 0, jumpSerial = 0;
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
  let attempted = false, busy = false, outgoing = new WeakSet();
  const chatId = () => location.pathname.match(/\/c\/([^/]+)\/?$/)?.[1];
  function rememberOutgoing() {
    outgoing = new WeakSet(document.querySelectorAll(promptSelector));
  }
  window.navigation?.addEventListener('navigate', event => {
    if (new URL(event.destination.url).pathname !== location.pathname) rememberOutgoing();
  });
  async function start(force=false) {
    const id = chatId(), path = location.pathname;
    if (!id || document.hidden || busy || (!force && attempted)) return;
    const mounted = [...document.querySelectorAll(promptSelector)];
    if (!mounted.some(el => !outgoing.has(el) && !el.closest('[data-app-shell-active-page="false"]'))) return;
    attempted = busy = true;
    const key = 'outline-v1:' + id;
    try {
      await navigator.locks.request(key, async () => {
        if (path !== location.pathname || document.hidden) return;
        const stored = force ? null : (await chrome.storage.local.get(key))[key];
        if (path === location.pathname && !document.hidden) await render(key, stored);
      });
    } catch {
      if (path === location.pathname) status.textContent='本地目录读写失败，请点更新目录重试。';
    } finally {
      if (path === location.pathname) busy=false;
    }
  }
  async function render(key, stored) {
    const turn = ++generation;
    list.replaceChildren();
    const mountedQuestions = questions();
    const first = mountedQuestions[0];
    if (!first) { status.textContent='当前页面还没有可读取的提问'; return; }
    const box = scrollBox(first.el), original = box.scrollTop;
    const cached = Array.isArray(stored) && stored.length > 0;
    const entries = cached ? stored : [];
    const offset = el => el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const move = top => box.scrollTo({top,behavior:'instant'});
    status.textContent='正在读取整段对话…';
    const path = location.pathname;
    const active = () => path === location.pathname && turn === generation;
    let interrupted = false;
    const interrupt = () => { interrupted=true; };
    const scanAllowed = () => active() && !document.hidden && !interrupted;
    if (!cached) {
      box.addEventListener('wheel',interrupt,{passive:true});
      box.addEventListener('touchstart',interrupt,{passive:true});
    }
    const deadline = performance.now()+120000;
    let finished = false;
    if (!cached) try {
      // Virtualized history can prepend older turns and adjust scrollTop asynchronously.
      let stable = 0, lastHeight = -1;
      while (scanAllowed() && performance.now()<deadline && stable < 4) {
        move(0);
        await settle();
        stable = box.scrollTop < 2 && box.scrollHeight === lastHeight ? stable + 1 : 0;
        lastHeight = box.scrollHeight;
      }
      while (scanAllowed() && performance.now()<deadline) {
        await settle();
        if (!scanAllowed()) break;
        let previousEntry;
        for (const q of questions()) {
          const top = offset(q.el);
          const id = q.id;
          const old = entries.find(item => (id && item.id===id) || item.el===q.el ||
            (item.text===q.text && Math.abs(item.top-top)<18));
          if (old) Object.assign(old,{el:q.el,top});
          else {
            const entry = {...q,top};
            entries.splice(previousEntry ? entries.indexOf(previousEntry)+1 : entries.length,0,entry);
            previousEntry = entry;
            continue;
          }
          previousEntry = old;
        }
        if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) { finished=true; break; }
        const previous = box.scrollTop;
        move(previous + Math.max(1, Math.floor(box.clientHeight * .85)));
        if (box.scrollTop <= previous) break;
      }
    } finally {
      box.removeEventListener('wheel',interrupt);
      box.removeEventListener('touchstart',interrupt);
      if (active() && !interrupted) move(original);
    }
    if (!active()) return;
    // Extend a saved outline only when the page shows the old tail followed by new questions.
    let appended = false;
    if (cached && entries.at(-1).id) {
      const tail = mountedQuestions.findIndex(q => q.id === entries.at(-1).id);
      if (tail >= 0) {
        for (const q of mountedQuestions.slice(tail + 1)) {
          if (!q.id || entries.some(item => item.id === q.id)) continue;
          entries.push({...q, top:offset(q.el)});
          appended = true;
        }
      }
    }
    let saveFailed=false;
    if ((!cached && finished && entries.length) || appended) {
      try {
        await chrome.storage.local.set({[key]:entries.map(({id,text,top}) => ({...(id ? {id} : {}),text,top}))});
      } catch { saveFailed=true; }
      if (!active()) return;
    }
    for (const q of entries) {
      const li=document.createElement('li'), btn=document.createElement('button');
      btn.textContent=q.text.length>100?q.text.slice(0,99)+'…':q.text;
      btn.onclick=async()=>{
        const origin = readingPosition(box);
        const serial = ++jumpSerial;
        const current = () => active() && serial===jumpSerial;
        const find = () => questions().find(item =>
          item.text===q.text && (!item.id || !q.id || item.id===q.id));
        let target=find();
        if (!target) { move(q.top-box.clientHeight/3); await settle(); }
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
      };
      li.append(btn); list.append(li);
    }
    status.textContent=`${cached ? "本地已保存" : finished ? "已读取" : "部分读取"} ${entries.length} 个提问` + (saveFailed ? "（保存失败）" : "");
  }
  toggle.onclick=()=>{ panel.hidden=!panel.hidden; toggle.setAttribute('aria-expanded',String(!panel.hidden)); if(!panel.hidden && !list.children.length) start(true); };
  ui.querySelector('header button').onclick=()=>start(true);
  const routeObserver = new MutationObserver(() => {
    if (location.pathname!==page) { page=location.pathname; attempted=busy=false; status.textContent=""; setReturn(null); panel.hidden=true; toggle.setAttribute('aria-expanded','false'); list.replaceChildren(); }
    if (!attempted && !busy) start();
  });
  document.addEventListener("visibilitychange",()=>{ if (!document.hidden) start(); });
  start();
  routeObserver.observe(document.body,{subtree:true,childList:true});
  window.addEventListener("pagehide", e => { if (!e.persisted) routeObserver.disconnect(); });
})();
