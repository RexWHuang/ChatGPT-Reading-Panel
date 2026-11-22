(() => {
  const selector = ':is(nav,aside,#sidebar,#stage-slideover-sidebar,[data-sidebar-project-container-id]) a[href*="/c/"], a[data-interactive-row-link][href*="/c/"], a[data-sidebar-item][href*="/c/"]';
  const format = new Intl.DateTimeFormat('zh-CN', {dateStyle:'medium', timeStyle:'medium'});
  function timestamp(value) {
    if (value == null || value === '') return NaN;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : Date.parse(value);
  }
  function conversationTimes(link) {
    const id = link.pathname.match(/\/c\/([^/]+)/)?.[1];
    const key = Object.keys(link).find(k => k.startsWith('__reactFiber$'));
    for (let fiber = link[key]; fiber; fiber = fiber.return) {
      const props = fiber.memoizedProps;
      const row = [props?.conversation, props?.historyItem].find(r => r && r.id === id);
      if (!row) continue;
      const created = timestamp(row.create_time ?? row.created_at);
      const updated = timestamp(row.update_time ?? row.updated_at);
      if (Number.isFinite(created) || Number.isFinite(updated)) return {created, updated};
    }
    return {};
  }
  function hoverTime(link) {
    const {created, updated} = conversationTimes(link);
    const details = [];
    if (Number.isFinite(created)) details.push('创建于 '+format.format(created));
    if (Number.isFinite(updated)) details.push('更新于 '+format.format(updated));
    if (details.length) return details.join('\n');
    const stamp = (link.closest('.sidebar-item') || link).querySelector('.timestamp-primary');
    return stamp?.textContent.trim() || '页面未提供时间';
  }
  function decorate() {
    const links = [...document.querySelectorAll(selector)];
    const now = Date.now();
    links.forEach((link,index) => {
      const row = link.closest('.sidebar-item') || link;
      row.dataset.readRow = '';
      const position = index / Math.max(links.length - 1, 1);
      const {created, updated} = conversationTimes(link);
      const lastActivity = Number.isFinite(updated) ? updated : created;
      const days = (now - lastActivity) / 86400000;
      let hue = 165 + 105 * position;
      if (Number.isFinite(days)) {
        if (days <= 1) hue = 154;
        else if (days <= 3) hue = 191;
        else if (days <= 7) hue = 230;
        else hue = 274;
        hue += 12 * position;
      }
      row.style.setProperty('--read-hue', String(Math.round(hue)));
    });
  }
  function refreshDetails(event) {
    const row = event.target.closest?.('[data-read-row]');
    if (!row || row.contains(event.relatedTarget)) return;
    const link = row.matches('a') ? row : row.querySelector('a[href*="/c/"]');
    if (link) row.dataset.readDetails = hoverTime(link);
  }
  let neighbors=[];
  function clearNeighbors() {
    for (const row of neighbors) delete row.dataset.readNeighbor;
    neighbors=[];
  }
  document.addEventListener('pointerover', event => {
    refreshDetails(event);
    const row=event.target.closest?.('[data-read-row]');
    if (!row || row.contains(event.relatedTarget)) return;
    clearNeighbors();
    const scope=row.closest('nav,aside') || row.parentElement.parentElement;
    const rows=[...scope.querySelectorAll('[data-read-row]')].filter(el=>el.getClientRects().length);
    const index=rows.indexOf(row);
    neighbors=[rows[index-1],rows[index+1]].filter(Boolean);
    for (const neighbor of neighbors) neighbor.dataset.readNeighbor='';
  });
  document.addEventListener('pointerout', event => {
    const row=event.target.closest?.('[data-read-row]');
    if (row && !row.contains(event.relatedTarget)) clearNeighbors();
  });
  document.addEventListener('focusin', refreshDetails);
  let frame = 0;
  const observer = new MutationObserver(records => {
    if (frame || !records.some(r => [...r.addedNodes,...r.removedNodes].some(n =>
      n.nodeType === 1 && (n.matches('a[href*="/c/"]') || n.querySelector('a[href*="/c/"]'))))) return;
    frame = requestAnimationFrame(() => { frame = 0; decorate(); });
  });
  observer.observe(document.body, {childList:true, subtree:true});
  window.addEventListener('pagehide', event => {
    if (!event.persisted) { observer.disconnect(); cancelAnimationFrame(frame); }
  });
  decorate();
})();
