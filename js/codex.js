'use strict';
// 兵力图鉴：读取 CATALOG / CAT_NAMES / ARCH_NAMES（catalog.js），分类页签、阵营筛选、搜索、卡片网格与详情
// 另含前端浮层的按键栈 LY：最上层的浮层（菜单 / 设置 / 图鉴 / 转场）独占键盘，游戏快捷键不会穿透
const LY = [];
function lyPush(el, key) { lyPop(el); LY.push({ el, key }); }
function lyPop(el) { const i = LY.findIndex(l => l.el === el); if (i >= 0) LY.splice(i, 1); }
if (typeof window !== 'undefined') window.addEventListener('keydown', e => {
  const top = LY[LY.length - 1];
  if (!top) return;
  e.stopImmediatePropagation();
  try { top.key(e); } catch (err) { console.error('layer key', err); }
}, true);
const lySfx = k => { if (typeof auUi === 'function') auUi(k); };

const CDX = { el: null, cat: 'all', side: 'all', q: '', sel: null, list: [], poll: 0 };
const CDX_STATS = [['hp', '生命'], ['armor', '装甲'], ['firepower', '火力'], ['range', '射程'], ['speed', '速度'], ['sight', '视野'], ['men', '人数']];
const CDX_SIDE = { p: '进攻方', e: '防守方', both: '双方通用' };
const CDX_CATS = ['inf', 'armor', 'arty', 'air', 'naval', 'fort', 'support'];
const cdxCat = () => typeof CATALOG !== 'undefined' && Array.isArray(CATALOG) ? CATALOG : [];
const cdxCatName = k => (typeof CAT_NAMES === 'object' && CAT_NAMES && CAT_NAMES[k]) || k;
const cdxArch = k => (typeof ARCH_NAMES === 'object' && ARCH_NAMES && ARCH_NAMES[k]) || k || '';
const cdxById = id => (typeof catalogById === 'function' ? catalogById(id) : null) || cdxCat().find(c => c.id === id);
const cdxEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cdxIcon = (c, cls) => `<svg viewBox="0 0 24 24" class="ic ${cls}" aria-hidden="true">${c && c.icon ? c.icon : '<rect x="5" y="5" width="14" height="14" stroke-dasharray="2 2"/>'}</svg>`;

const CDX_CSS = `
#cdx { position: fixed; inset: 0; z-index: 45; display: grid; place-items: center; background: rgba(1, 4, 2, .84); padding: max(12px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px)); }
#cdx .cdx-win { width: min(1180px, 100%); height: min(760px, 100%); display: grid; grid-template-rows: auto auto minmax(0, 1fr); background: rgba(3, 12, 7, .94); border: 1px solid var(--line-hi); border-radius: 8px;
  box-shadow: 0 0 0 4px rgba(61, 255, 138, .06), 0 0 40px rgba(61, 255, 138, .14); overflow: hidden; }
#cdx header { display: flex; align-items: center; gap: 12px; padding: 12px 14px 10px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
#cdx h2 { margin: 0 auto 0 0; font: 700 20px/1.1 "Noto Sans SC", var(--f-ui); color: var(--g); letter-spacing: .12em; text-shadow: 0 0 12px rgba(61, 255, 138, .45); display: flex; align-items: baseline; gap: 10px; }
#cdx h2 small { font: 10px var(--f-px); color: var(--mute); letter-spacing: .14em; }
#cdx .cdx-seg { display: flex; border: 1px solid var(--line); border-radius: 5px; overflow: hidden; }
#cdx .cdx-seg button { background: transparent; border: 0; padding: 5px 12px; color: var(--mute); min-height: 30px; }
#cdx .cdx-seg button + button { border-left: 1px solid var(--line); }
#cdx .cdx-seg button[aria-pressed="true"] { color: var(--g); background: rgba(61, 255, 138, .12); }
#cdx .cdx-seg button[data-side="e"][aria-pressed="true"] { color: var(--enemy); background: rgba(255, 61, 110, .1); }
#cdx input[type=search] { background: rgba(0, 0, 0, .35); border: 1px solid var(--line); border-radius: 5px; color: var(--text); font: 13px var(--f-ui); padding: 5px 10px; width: 210px; min-height: 30px; box-sizing: border-box; }
#cdx input[type=search]::-webkit-search-cancel-button { -webkit-appearance: none; }
#cdx input[type=search]:focus { outline: none; border-color: var(--line-hi); box-shadow: 0 0 10px rgba(61, 255, 138, .25); }
#cdx .cdx-x { background: transparent; border: 1px solid var(--line); border-radius: 5px; width: 34px; height: 32px; font-size: 18px; line-height: 1; color: var(--text); }
#cdx .cdx-x:hover { border-color: var(--enemy); color: var(--enemy); }
#cdx nav { display: flex; gap: 4px; padding: 8px 14px; border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: thin; }
#cdx nav button { flex: 0 0 auto; background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 4px 11px; color: var(--mute); display: flex; gap: 6px; align-items: center; min-height: 30px; }
#cdx nav button:hover { color: var(--text); border-color: var(--line); }
#cdx nav button[aria-selected="true"] { color: var(--g); border-color: var(--line-hi); background: rgba(61, 255, 138, .08); box-shadow: inset 0 -2px 0 var(--g); }
#cdx nav button i { font-style: normal; font-size: 10px; color: var(--mute); font-variant-numeric: tabular-nums; }
#cdx .cdx-body { display: grid; grid-template-columns: minmax(0, 1fr) 360px; min-height: 0; }
#cdx .cdx-grid { overflow-y: auto; padding: 12px 14px; display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; align-content: start; scrollbar-width: thin; }
#cdx .cdx-card { position: relative; display: grid; justify-items: center; gap: 4px; padding: 10px 6px 8px; min-height: 104px; background: linear-gradient(180deg, rgba(61, 255, 138, .06), rgba(3, 12, 7, .6));
  border: 1px solid var(--line); border-radius: 5px; color: var(--g); text-align: center; }
#cdx .cdx-card.e { color: var(--enemy); background: linear-gradient(180deg, rgba(255, 61, 110, .07), rgba(3, 12, 7, .6)); }
#cdx .cdx-card.both { color: var(--intel); background: linear-gradient(180deg, rgba(92, 200, 255, .07), rgba(3, 12, 7, .6)); }
#cdx .cdx-card:hover { border-color: var(--line-hi); }
#cdx .cdx-card[aria-selected="true"] { border-color: var(--sel); box-shadow: 0 0 14px rgba(176, 124, 255, .45); background: linear-gradient(180deg, rgba(176, 124, 255, .16), rgba(3, 12, 7, .7)); }
#cdx .cdx-card .ic { width: 36px; height: 36px; stroke-width: 1.4; filter: drop-shadow(0 0 4px currentColor); }
#cdx .cdx-card b { font: 600 12px/1.3 "Noto Sans SC", var(--f-ui); color: var(--text); }
#cdx .cdx-card span { font: 11px var(--f-ui); color: var(--amber); font-variant-numeric: tabular-nums; }
#cdx .cdx-card::before { content: ""; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px; border-radius: 1px; background: currentColor; opacity: .7; }
#cdx .cdx-det { border-left: 1px solid var(--line); overflow-y: auto; padding: 14px 16px; display: grid; gap: 12px; align-content: start; scrollbar-width: thin; }
#cdx .cdx-hero { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 14px; align-items: center; }
#cdx .cdx-big { position: relative; width: 96px; height: 96px; display: grid; place-items: center; color: var(--g); border: 1px solid var(--line);
  background: linear-gradient(rgba(61, 255, 138, .07) 1px, transparent 1px) 0 0 / 12px 12px, linear-gradient(90deg, rgba(61, 255, 138, .07) 1px, transparent 1px) 0 0 / 12px 12px, rgba(0, 0, 0, .3); }
#cdx .cdx-big.e { color: var(--enemy); } #cdx .cdx-big.both { color: var(--intel); }
#cdx .cdx-big .ic { width: 64px; height: 64px; stroke-width: 1.2; filter: drop-shadow(0 0 6px currentColor); }
#cdx .cdx-big::before, #cdx .cdx-big::after { content: ""; position: absolute; width: 12px; height: 12px; border: 2px solid currentColor; }
#cdx .cdx-big::before { left: -2px; top: -2px; border-right: 0; border-bottom: 0; } #cdx .cdx-big::after { right: -2px; bottom: -2px; border-left: 0; border-top: 0; }
#cdx .cdx-det h3 { margin: 0 0 6px; font: 700 20px/1.2 "Noto Sans SC", var(--f-ui); color: var(--text); }
#cdx .cdx-tags { display: flex; gap: 5px; flex-wrap: wrap; }
#cdx .cdx-tag { font-size: 11px; padding: 1px 7px; border-radius: 3px; border: 1px solid var(--line-hi); color: var(--g); }
#cdx .cdx-tag.e { border-color: rgba(255, 61, 110, .6); color: var(--enemy); } #cdx .cdx-tag.both { border-color: rgba(92, 200, 255, .6); color: var(--intel); }
#cdx .cdx-tag.m { border-color: var(--line); color: var(--mute); } #cdx .cdx-tag.c { border-color: rgba(255, 194, 74, .6); color: var(--amber); }
#cdx .cdx-stats { display: grid; grid-template-columns: auto minmax(0, 1fr) 26px; gap: 6px 10px; align-items: center; font-size: 12px; }
#cdx .cdx-stats dt { color: var(--mute); } #cdx .cdx-stats dd { margin: 0; text-align: right; color: var(--text); font-variant-numeric: tabular-nums; }
#cdx .cdx-bar { display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px; height: 8px; }
#cdx .cdx-bar i { background: rgba(61, 255, 138, .1); border-radius: 1px; }
#cdx .cdx-bar i.on { background: var(--g); box-shadow: 0 0 5px rgba(61, 255, 138, .6); }
#cdx .cdx-bar i.half { background: linear-gradient(90deg, var(--g) 50%, rgba(61, 255, 138, .1) 50%); }
#cdx .cdx-desc { margin: 0; color: var(--text); line-height: 1.7; font-family: "Noto Sans SC", var(--f-ui); }
#cdx .cdx-rel { display: grid; gap: 6px; font-size: 12px; }
#cdx .cdx-rel > div { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
#cdx .cdx-rel em { font-style: normal; color: var(--mute); min-width: 48px; }
#cdx .cdx-rel button { background: transparent; border: 1px solid var(--line); border-radius: 3px; padding: 1px 7px; font-size: 11px; color: var(--text); }
#cdx .cdx-rel .up button { border-color: rgba(61, 255, 138, .5); color: var(--g); }
#cdx .cdx-rel .dn button { border-color: rgba(255, 61, 110, .5); color: #ffb3c4; }
#cdx .cdx-rel button:hover { background: rgba(255, 255, 255, .06); }
#cdx .cdx-empty { grid-column: 1 / -1; display: grid; place-items: center; gap: 8px; padding: 60px 10px; color: var(--mute); text-align: center; }
#cdx .cdx-empty b { font: 600 15px "Noto Sans SC", var(--f-ui); color: var(--g); letter-spacing: .2em; }
#cdx .cdx-hint { font-size: 11px; color: var(--mute); border-top: 1px solid var(--line); padding-top: 10px; }
#cdx .cdx-hint kbd { border: 1px solid var(--line-hi); border-radius: 3px; padding: 0 4px; font: 10px var(--f-ui); color: var(--g); }
@media (max-width: 760px) {
  #cdx { padding: 0; }
  #cdx .cdx-win { height: 100%; border-radius: 0; border: 0; }
  #cdx header { gap: 8px; padding: 10px 12px 8px; }
  #cdx h2 { flex: 1 0 auto; } #cdx h2 small { display: none; }
  #cdx header .cdx-seg { order: 3; } #cdx input[type=search] { order: 4; flex: 1 1 120px; width: auto; }
  #cdx nav { padding: 6px 12px; }
  #cdx .cdx-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, auto); }
  #cdx .cdx-grid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); padding: 10px 12px; gap: 6px; }
  #cdx .cdx-card { min-height: 88px; padding: 8px 4px 6px; } #cdx .cdx-card .ic { width: 30px; height: 30px; }
  #cdx .cdx-det { border-left: 0; border-top: 1px solid var(--line); max-height: 48vh; padding: 12px; }
  #cdx .cdx-hero { grid-template-columns: 72px minmax(0, 1fr); } #cdx .cdx-big { width: 72px; height: 72px; } #cdx .cdx-big .ic { width: 48px; height: 48px; }
  #cdx .cdx-hint { display: none; }
}`;

function cdxBuild() {
  if (CDX.el) return CDX.el;
  const st = document.createElement('style'); st.id = 'cdxCss'; st.textContent = CDX_CSS; document.head.appendChild(st);
  const el = CDX.el = document.createElement('div');
  el.id = 'cdx'; el.className = 'mn-layer'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '兵力图鉴');
  el.innerHTML = `<div class="cdx-win">
  <header><h2>兵力图鉴<small>ORDER OF BATTLE</small></h2>
    <div class="cdx-seg" role="group" aria-label="阵营">${[['all', '全部'], ['p', '进攻方'], ['e', '防守方']].map(([k, n]) => `<button type="button" data-side="${k}">${n}</button>`).join('')}</div>
    <input type="search" placeholder="搜索名称、类型、描述（/）" aria-label="搜索">
    <button class="cdx-x" type="button" title="关闭（Esc）" aria-label="关闭">×</button></header>
  <nav role="tablist" aria-label="兵种分类"></nav>
  <div class="cdx-body"><div class="cdx-grid" role="listbox" aria-label="兵力列表"></div><aside class="cdx-det" aria-live="polite"></aside></div></div>`;
  document.body.appendChild(el);
  const q = s => el.querySelector(s);
  q('.cdx-x').addEventListener('click', closeCodex);
  el.addEventListener('pointerdown', e => { if (e.target === el) closeCodex(); });
  q('.cdx-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { CDX.side = b.dataset.side; cdxRender(); } });
  q('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { CDX.cat = b.dataset.cat; cdxRender(); } });
  q('input').addEventListener('input', e => { CDX.q = e.target.value.trim(); cdxRender(); });
  q('.cdx-grid').addEventListener('click', e => { const b = e.target.closest('.cdx-card'); if (b) cdxSelect(b.dataset.id, false); });
  q('.cdx-det').addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    const c = cdxById(b.dataset.go);
    if (c) { CDX.cat = 'all'; CDX.side = 'all'; CDX.q = ''; q('input').value = ''; cdxRender(); cdxSelect(c.id, true); }
    else { CDX.q = cdxArch(b.dataset.go); q('input').value = CDX.q; CDX.cat = 'all'; CDX.side = 'all'; cdxRender(); }   // 克制关系常跨阵营：清除阵营筛选
  });
  return el;
}

function openCodex() {
  if (typeof document === 'undefined') return;
  const el = cdxBuild();
  el.hidden = false;
  lyPush(el, cdxKey);
  lySfx('open');
  cdxRender();
  clearInterval(CDX.poll);
  // 目录模块可能还没加载完：打开期间轮询
  CDX.poll = setInterval(() => { if (!el.hidden && cdxCat().length && !CDX.list.length) cdxRender(); }, 600);
  const first = el.querySelector('.cdx-card[aria-selected="true"]') || el.querySelector('.cdx-card');
  if (first && !matchMedia('(pointer: coarse)').matches) first.focus({ preventScroll: true });
}

function closeCodex() {
  if (!CDX.el || CDX.el.hidden) return;
  CDX.el.hidden = true; clearInterval(CDX.poll);
  lyPop(CDX.el);
  lySfx('back');
  if (typeof MENU === 'object' && MENU.open && typeof mnFocus === 'function') mnFocus();
}

function cdxMatch(c) {
  if (CDX.side !== 'all' && c.side !== CDX.side && c.side !== 'both') return false;
  if (!CDX.q) return true;
  const q = CDX.q.toLowerCase();
  return [c.name, c.id, c.desc, cdxArch(c.arch), cdxCatName(c.cat)].some(s => s && String(s).toLowerCase().includes(q));
}

function cdxRender() {
  const el = CDX.el, all = cdxCat(), q = s => el.querySelector(s);
  for (const b of el.querySelectorAll('.cdx-seg button')) b.setAttribute('aria-pressed', b.dataset.side === CDX.side);
  const pool = all.filter(cdxMatch), cats = [...CDX_CATS, ...new Set(all.map(c => c.cat).filter(k => !CDX_CATS.includes(k)))];
  q('nav').innerHTML = [['all', '全部', pool.length], ...cats.map(k => [k, cdxCatName(k), pool.filter(c => c.cat === k).length])]
    .filter(([k, , n]) => k === 'all' || n || all.some(c => c.cat === k))
    .map(([k, n, cnt]) => `<button type="button" role="tab" data-cat="${k}" aria-selected="${CDX.cat === k}">${cdxEsc(n)}<i>${cnt}</i></button>`).join('');
  const order = k => { const i = cats.indexOf(k); return i < 0 ? 99 : i; };
  CDX.list = pool.filter(c => CDX.cat === 'all' || c.cat === CDX.cat).sort((a, b) => order(a.cat) - order(b.cat) || (a.cost || 0) - (b.cost || 0));
  const grid = q('.cdx-grid');
  if (!all.length) {
    grid.innerHTML = `<div class="cdx-empty"><b>目录加载中</b><span>兵力目录模块尚未就绪，稍候自动刷新</span></div>`;
    q('.cdx-det').innerHTML = '';
    return;
  }
  if (!CDX.list.length) grid.innerHTML = `<div class="cdx-empty"><b>无匹配单位</b><span>换个关键词或筛选条件</span></div>`;
  else grid.innerHTML = CDX.list.map(c => `<button type="button" role="option" class="cdx-card ${c.side}" data-id="${cdxEsc(c.id)}" aria-selected="${c.id === CDX.sel}" title="${cdxEsc(c.name)}">${cdxIcon(c, '')}<b>${cdxEsc(c.name)}</b><span>◆ ${c.cost ?? '—'}</span></button>`).join('');
  if (!CDX.list.some(c => c.id === CDX.sel)) CDX.sel = CDX.list.length ? CDX.list[0].id : CDX.sel;
  cdxDetail();
  for (const b of grid.children) b.setAttribute && b.setAttribute('aria-selected', b.dataset.id === CDX.sel);
}

function cdxSelect(id, scroll) {
  if (id == null) return;
  CDX.sel = id;
  for (const b of CDX.el.querySelectorAll('.cdx-card')) b.setAttribute('aria-selected', b.dataset.id === id);
  const b = CDX.el.querySelector(`.cdx-card[data-id="${CSS.escape(id)}"]`);
  if (b) { if (scroll) b.scrollIntoView({ block: 'nearest' }); if (document.activeElement !== b && CDX.el.contains(document.activeElement) && document.activeElement.classList.contains('cdx-card')) b.focus({ preventScroll: true }); }
  cdxDetail();
  lySfx('tick');
}

function cdxBar(v) {
  v = clamp(+v || 0, 0, 10);
  return `<span class="cdx-bar">${Array.from({ length: 10 }, (_, i) => `<i class="${v >= i + 1 ? 'on' : v > i + .3 ? 'half' : ''}"></i>`).join('')}</span>`;
}

function cdxDetail() {
  const det = CDX.el.querySelector('.cdx-det'), c = cdxById(CDX.sel);
  if (!c) { det.innerHTML = ''; return; }
  const st = c.stats || {}, side = c.side || 'p';
  const rel = (arr, cls, label) => Array.isArray(arr) && arr.length ? `<div class="${cls}"><em>${label}</em>${arr.map(k => { const o = cdxById(k); return `<button type="button" data-go="${cdxEsc(k)}">${cdxEsc(o ? o.name : cdxArch(k))}</button>`; }).join('')}</div>` : '';
  det.innerHTML = `<div class="cdx-hero"><div class="cdx-big ${side}">${cdxIcon(c, '')}</div><div><h3>${cdxEsc(c.name)}</h3>
    <div class="cdx-tags"><span class="cdx-tag ${side}">${CDX_SIDE[side] || side}</span><span class="cdx-tag m">${cdxEsc(cdxCatName(c.cat))}</span>${c.arch ? `<span class="cdx-tag m">${cdxEsc(cdxArch(c.arch))}</span>` : ''}<span class="cdx-tag c">◆ ${c.cost ?? '—'} 点</span></div></div></div>
    <dl class="cdx-stats">${CDX_STATS.map(([k, n]) => `<dt>${n}</dt>${cdxBar(st[k])}<dd>${st[k] == null ? '—' : Math.round(st[k] * 10) / 10}</dd>`).join('')}</dl>
    <p class="cdx-desc">${cdxEsc(c.desc || '暂无说明。')}</p>
    ${c.counters || c.weakTo ? `<div class="cdx-rel">${rel(c.counters, 'up', '克制')}${rel(c.weakTo, 'dn', '被克制')}</div>` : ''}
    <div class="cdx-hint"><kbd>←↑→↓</kbd> 浏览 · <kbd>[</kbd><kbd>]</kbd> 切换分类 · <kbd>/</kbd> 搜索 · <kbd>Esc</kbd> 关闭</div>`;
}

// 网格内方向键：按实际列数上下移动
function cdxKey(e) {
  const k = e.key, inp = e.target.closest && e.target.closest('input');
  if (k === 'Escape') { e.preventDefault(); if (inp && CDX.q) { inp.value = ''; CDX.q = ''; cdxRender(); } else closeCodex(); return; }
  if (inp) { if (k === 'Enter' || k === 'ArrowDown') { e.preventDefault(); const b = CDX.el.querySelector('.cdx-card'); if (b) { b.focus(); cdxSelect(b.dataset.id); } } return; }
  if (k === '/') { e.preventDefault(); CDX.el.querySelector('input').focus(); return; }
  if (k === '[' || k === ']') {
    const tabs = [...CDX.el.querySelectorAll('nav button')].map(b => b.dataset.cat), i = tabs.indexOf(CDX.cat);
    CDX.cat = tabs[(i + (k === ']' ? 1 : tabs.length - 1)) % tabs.length]; cdxRender(); lySfx('tick'); e.preventDefault(); return;
  }
  const cards = [...CDX.el.querySelectorAll('.cdx-card')];
  if (!cards.length || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) return;
  e.preventDefault();
  let i = Math.max(0, cards.findIndex(b => b.dataset.id === CDX.sel));
  const top = cards[0].offsetTop, cols = Math.max(1, cards.filter(b => b.offsetTop === top).length);
  i = k === 'ArrowLeft' ? i - 1 : k === 'ArrowRight' ? i + 1 : k === 'ArrowUp' ? i - cols : k === 'ArrowDown' ? i + cols : k === 'Home' ? 0 : cards.length - 1;
  i = clamp(i, 0, cards.length - 1);
  cards[i].focus({ preventScroll: true }); cards[i].scrollIntoView({ block: 'nearest' });
  cdxSelect(cards[i].dataset.id, false);
}
