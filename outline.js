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
    .question{display:flex;align-items:baseline}.question .expand{flex:none;width:auto;color:#628e85;padding:3px 6px}.sections{margin:3px 0 6px;padding-left:8px;border-left:1px solid #8885}.sections button{font-size:13px;line-height:1.45}.sections .sub{padding-left:18px}
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
  function questions(from) {
    const selector = ':is([data-message-author-role="user"], [data-turn="user"], [class~="group/user-message"])';
    return [...document.querySelectorAll("main "+selector)]
      .filter(el => (!from || el === from || (from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) && !outgoing.has(el) && !el.closest('[data-app-shell-active-page="false"]') && !el.querySelector(selector))
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

  const assistantSelector = ':is([data-message-author-role="assistant"],[data-turn="assistant"])';
  function replies(prompts = questions(), from) {
    const byElement = new Map(prompts.map(q => [q.el,q]));
    const found = [];
    let owner, ordinal = 0;
    for (const el of document.querySelectorAll(promptSelector+', main '+assistantSelector)) {
      if (el.closest('[data-app-shell-active-page="false"]') ||
          (from && el !== from && !(from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))) continue;
      if (outgoing.has(el)) { owner = undefined; continue; }
      if (!el.matches(assistantSelector)) { owner = byElement.get(el); ordinal = 0; continue; }
      if (el.querySelector(assistantSelector)) continue;
      const id = el.closest('[data-message-id]')?.dataset.messageId ||
        el.closest('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids');
      const nodes = [...el.querySelectorAll('h1,h2')].filter(h =>
        !h.closest('pre,code,nav,aside,button,[aria-hidden="true"]') && h.textContent.trim());
      found.push({el,id,owner,nodes,ordinal:ordinal++});
    }
    return found;
  }

  function headingElement(q, answer, index) {
    const mounted = replies();
    const reply = mounted.find(r => r.id && r.id === answer.id) ||
      mounted.find(r => !r.id && r.owner && matches(r.owner,q) && r.ordinal === q.answers.indexOf(answer));
    if (!reply) return;
    const heading = answer.headings[index];
    const same = h => h.level === heading.level && h.text === heading.text;
    const occurrence = answer.headings.slice(0,index).filter(same).length;
    const exact = reply.nodes.filter(h => Number(h.tagName[1]) === heading.level && h.textContent.trim() === heading.text);
    // Cached Markdown may contain inline formatting absent from the rendered label.
    if (exact[occurrence]) return exact[occurrence];
    const node = reply.nodes[index];
    const plain = heading.text.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/[*_`~]/g,'');
    return node && Number(node.tagName[1]) === heading.level && node.textContent.trim() === plain ? node : null;
  }

  function alignedTop(box, el) {
    let edge = box === document.scrollingElement ? 0 : Math.max(0,box.getBoundingClientRect().top + box.clientTop);
    const x = Math.min(innerWidth-1,Math.max(0,el.getBoundingClientRect().left + 2));
    for (const header of document.querySelectorAll('header,#page-header,[role="banner"],.sticky.top-0')) {
      const bounds = header.getBoundingClientRect();
      if (bounds.left <= x && x <= bounds.right && bounds.top <= edge+2 && bounds.bottom > edge &&
          ['sticky','fixed'].includes(getComputedStyle(header).position)) edge = bounds.bottom;
    }
    return Math.max(0,Math.min(box.scrollHeight-box.clientHeight,box.scrollTop+el.getBoundingClientRect().top-edge-8));
  }
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
        for (const answer of q.answers || []) {
          const answers = rows[index].answers ||= [];
          const old = answers.findIndex(a => a.id === answer.id);
          if (old >= 0 && JSON.stringify(answers[old].headings) === JSON.stringify(answer.headings)) continue;
          if (old < 0) answers.push(answer);
          else answers[old] = answer;
          changed = true;
        }
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
      const line = document.createElement('div');
      line.className = 'question';
      line.append(btn);
      li.append(line);
      if (q.answers?.some(a => a.headings.length)) {
        const toggle = document.createElement('button'), sections = document.createElement('div');
        const key = q.id || q.text;
        toggle.className = 'expand';
        toggle.title = '回答标题';
        toggle.setAttribute('aria-label','展开或收起回答标题');
        sections.className = 'sections';
        const show = open => {
          toggle.textContent = open ? '▾' : '▸';
          toggle.setAttribute('aria-expanded',String(open));
          sections.hidden = !open;
          sections.replaceChildren();
          if (!open) return;
          for (const answer of q.answers) answer.headings.forEach((h,index) => {
            const link = document.createElement('button');
            link.textContent = h.text;
            if (h.level === 2) link.className = 'sub';
            link.onclick = () => jump(route,q,{answer,index});
            sections.append(link);
          });
        };
        toggle.onclick = () => {
          if (sections.hidden) route.expanded.add(key); else route.expanded.delete(key);
          show(route.expanded.has(key));
        };
        show(route.expanded.has(key));
        line.append(toggle);
        li.append(sections);
      }
      buttons.append(li);
    }
    list.replaceChildren(buttons);
    status.textContent = route.rows.length ? (route.complete ? '' : '已显示 ') + route.rows.length + ' 个提问' : '等待页面显示提问';
    update.disabled = route.scanning;
  }

  async function jump(route,q,section) {
    const serial = ++jumpSerial;
    const current = () => route === state && serial === jumpSerial && route.path === location.pathname;
    const firstMounted = () => questions()[0]?.el || (section && replies()[0]?.el);
    let mounted = firstMounted();
    if (!mounted) {
      status.textContent = '正在等待聊天正文…';
      const deadline = performance.now()+30000;
      while (current() && !mounted && performance.now()<deadline) {
        await settle();
        mounted = firstMounted();
      }
      if (!current()) return;
      if (!mounted) { status.textContent = '正文尚未显示，暂时无法跳转。'; return; }
      draw(route);
    }
    if (route.scanning) route.stopScan = true;
    const box = scrollBox(mounted);
    const move = top => box.scrollTo({top,behavior:'instant'});
    const origin = readingPosition(box);
    const find = () => section ? headingElement(q,section.answer,section.index) : questions().find(item => matches(item,q))?.el;
    let target=find();
    let stable=0, searching=false, resets=0;
    if (!target && Number.isFinite(q.top)) {
      move(q.top-box.clientHeight/3);
      searching = Boolean(section);
      await settle();
    }
    const deadline=performance.now()+30000;
    while (current() && performance.now()<deadline) {
      target=find();
      if (target) {
        const bounds=target.getBoundingClientRect();
        if (section) {
          const top = alignedTop(box,target);
          if (Math.abs(top-box.scrollTop) > 1) { move(top); stable = 0; }
          else if (++stable >= 3) {
            if (Math.abs(box.scrollTop-origin.top)>1) setReturn(origin);
            return;
          }
          await settle();
          continue;
        }
        if (bounds.bottom>0 && bounds.top<innerHeight &&
            Math.abs(bounds.top+bounds.height/2-innerHeight/2)<innerHeight*.42) {
          if (++stable>=7) {
            if (Math.abs(box.scrollTop - origin.top) > 1) setReturn(origin);
            return;
          }
        } else {
          stable=0;
          target.scrollIntoView({block:'center',behavior:'instant'});
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
    if (current()) status.textContent=section ? '未定位到这个回答标题，请更新目录后重试。' : '未定位到这条提问，请更新目录后重试。';
  }
  function unpack(value) {
    if (Array.isArray(value)) return {rows:value, complete:true};
    return value?.rows ? value : {rows:[],complete:false};
  }
  async function save(route, replace=false, partial=false) {
    const rows = structuredClone(route.rows), complete = route.complete;
    try {
      await navigator.locks.request(route.key, async () => {
        if (!current(route)) return;
        const saved = unpack((await chrome.storage.local.get(route.key))[route.key]);
        if (!current(route)) return;
        if (replace) restoreOffsets(rows,saved.rows);
        if (replace && saved.complete === complete && saved.rows.length === rows.length &&
            rows.every((r,i) => r.id === saved.rows[i].id && r.text === saved.rows[i].text &&
              JSON.stringify(r.answers || []) === JSON.stringify(saved.rows[i].answers || []))) return;
        if (!replace) {
          const changed = merge(saved.rows,rows);
          if (!changed && !(partial && saved.complete)) return;
          if (partial) saved.complete = false;
        }
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
  function mountedRows(known = state?.rows || [], from) {
    const items = questions(from);
    const box = items.length && scrollBox(items[0].el);
    const rows = new Map(items.map(q => [q,{...(q.id ? {id:q.id} : {}),text:q.text,top:offset(q.el,box)}]));
    for (const reply of replies(items, from)) {
      let row = rows.get(reply.owner);
      if (!row && !reply.owner && reply.id && reply.nodes.length) {
        const previous = known.find(q => q.answers?.some(a => a.id === reply.id));
        if (previous) {
          if (!rows.has(previous)) rows.set(previous,{id:previous.id,text:previous.text});
          row = rows.get(previous);
        }
      }
      if (!row || !reply.nodes.length) continue;
      const answers = row.answers ||= [];
      const previous = !reply.id && known.find(q => matches(q,row))?.answers?.[reply.ordinal];
      answers.push({id:reply.id || previous?.id || 'mounted-'+reply.ordinal,
        headings:reply.nodes.map(h => ({level:Number(h.tagName[1]),text:h.textContent.trim()}))});
    }
    return [...rows.values()];
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
    const route = state = {path:location.pathname,key:id && 'outline-v1:'+id,rows:[],complete:false,expanded:new Set()};
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
  // Start at the saved tail. Most visits can reconcile the mounted suffix in
  // place. Page forward only when the virtualized new suffix spans more windows.
  update.onclick = async () => {
    const route = state;
    if (route.scanning || document.hidden) return;
    const tail = route.rows.at(-1);
    const prompts = [...document.querySelectorAll(promptSelector)].filter(el =>
      !outgoing.has(el) && !el.closest('[data-app-shell-active-page="false"]'));
    const anchor = tail?.id && prompts.findLast(el => {
      const msg = el.closest('[data-message-id]');
      return msg?.dataset.messageId === tail.id || el.closest('[data-turn-key]')?.dataset.turnKey === tail.id;
    });
    const first = anchor || prompts[0] || replies()[0]?.el;
    if (!first) { status.textContent = '正在等待聊天正文'; return; }
    const box = scrollBox(first), origin = readingPosition(box);
    const active = () => current(route) && !route.stopScan && !document.hidden;
    const interrupt = () => { route.stopScan = true; };
    const move = top => box.scrollTo({top,behavior:'instant'});
    let changed = false, moved = false, partial = false;
    const read = from => {
      const rows = mountedRows(route.rows,from);
      changed = merge(route.rows,rows) || changed;
      return rows;
    };
    route.stopScan = false;
    route.scanning = update.disabled = true;
    status.textContent = '正在检查最新提问和回答…';
    box.addEventListener('wheel',interrupt,{passive:true});
    box.addEventListener('touchstart',interrupt,{passive:true});
    try {
      const visibleSuffix = anchor ? read(anchor) : [];
      const end = () => box.scrollHeight-box.clientHeight;
      const last = anchor && document.querySelectorAll(promptSelector+', main '+assistantSelector);
      const lastTurn = last?.length && last[last.length-1].closest('[data-turn-key],[data-turn],article');
      const boxTop = box === document.scrollingElement ? 0 : box.getBoundingClientRect().top;
      const endMounted = lastTurn && lastTurn.getBoundingClientRect().bottom-boxTop+box.scrollTop >= box.scrollHeight-2;
      if (!endMounted && box.scrollTop < end()-2) {
        move(end());
        moved = true;
        await settle();
      }
      if (!active()) return;
      const bottomRows = endMounted ? visibleSuffix : mountedRows(route.rows,anchor?.isConnected ? anchor : undefined);
      const joined = !tail || bottomRows.some(q => matches(q,tail) || visibleSuffix.some(v => matches(q,v)));
      if (!joined && Number.isFinite(tail.top) && tail.top > 0 && tail.top < end() && bottomRows.length) {
        move(tail.top);
        moved = true;
        const deadline = performance.now()+10000;
        let connected = false;
        while (active() && performance.now()<deadline) {
          await settle();
          if (!active()) return;
          const windowRows = read();
          if (windowRows.some(q => bottomRows.some(last => matches(q,last)))) { connected = true; break; }
          const next = Math.min(end(),box.scrollTop+Math.max(1,box.clientHeight*.85));
          if (next <= box.scrollTop+1) break;
          move(next);
        }
        partial = !connected;
      } else if (!joined) partial = true;
      changed = merge(route.rows,bottomRows) || changed;
    } finally {
      box.removeEventListener('wheel',interrupt);
      box.removeEventListener('touchstart',interrupt);
      if (current(route)) {
        if (moved && !route.stopScan) {
          move(origin.top);
          await settle();
          if (active() && origin.key) {
            const el = box.querySelector(`[data-turn-key="${CSS.escape(origin.key)}"]`);
            if (el) move(box.scrollTop+el.getBoundingClientRect().top-origin.y);
          }
        }
        if (current(route)) {
          if (partial) route.complete = false;
          route.scanning = false;
          draw(route);
          if (active()) status.textContent = partial ? '已检查末尾，其余条目会随阅读补入' :
            (changed ? '已更新' : '已检查末尾')+' · '+route.rows.length+' 个提问';
          if (changed || partial) save(route,false,partial);
        }
      }
    }
  };
  toggle.onclick = () => {
    collapsed = panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded',String(!collapsed));
  };
  window.navigation?.addEventListener('navigate', e => {
    if (new URL(e.destination.url).pathname !== location.pathname) outgoing = new WeakSet(document.querySelectorAll(promptSelector+', main '+assistantSelector));
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
    const next = rows.map(({id,text,answers}) => ({
      id,text,answers:Array.isArray(answers) ? answers.filter(a => typeof a?.id === 'string' &&
        Array.isArray(a.headings) && a.headings.every(h => [1,2].includes(h?.level) && typeof h.text === 'string')) : []
    }));
    merge(next,mountedRows(next).filter(q => next.some(r => matches(r,q))));
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
  const selector = promptSelector.slice(5)+',h1,h2';
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
