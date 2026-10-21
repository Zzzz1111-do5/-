'use strict';
// 作战通联面板（DOM）：显示 S.chat（commander.js chatSay 写入）。右上 #topr 下方停靠，可收起为按钮（未读计数）；手机默认收起
// 过滤：SETTINGS.chat brief 只看计划 / 摩擦 / 补救，normal 不含详细级（lv 2），verbose 全部；SETTINGS.enemyChat 关闭时隐藏敌方
// PvE 中敌方指挥官的通话只能截获：约四成，滞后 15–30 秒（m.ic 为截获时刻，由 chatSay 预先抽定）；沙盒与观战实时显示
const CHAT = { el: null, list: null, btn: null, badge: null, pill: null, S: null, ids: [], open: null, tab: 'all', unread: 0, scanT: 0, layT: 0, hl: null, stick: true, sig: '' };
const CHAT_KIND = { plan: '计划', order: '命令', intel: '情报', friction: '摩擦', remedy: '补救', report: '报告' };
const CHAT_LV = { brief: '简', normal: '常', verbose: '详' };
const CHAT_ICON = '<path d="M4 5h16v10.5H10l-4.5 3.5v-3.5H4z"/><path d="M8 9h8M8 12h5"/>';
const CHAT_CSS = `
#chat { position: absolute; z-index: 4; right: max(16px, env(safe-area-inset-right, 0px)); width: 320px; display: flex; flex-direction: column; overflow: hidden; pointer-events: auto; }
#chat .ch-h { display: flex; align-items: center; gap: 6px; padding: 5px 6px 5px 9px; border-bottom: 1px solid var(--line); flex: none; }
#chat .ch-h > b { font: 600 12px var(--f-ui); color: var(--g); letter-spacing: .08em; white-space: nowrap; margin-right: auto; }
#chat .ch-h .ic { width: 16px; height: 16px; color: var(--g); flex: none; }
#chat .ch-tabs { display: flex; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
#chat .ch-tabs button, #chat .ch-b { background: transparent; border: 0; height: 22px; padding: 0 7px; font-size: 11px; color: var(--mute); }
#chat .ch-tabs button + button { border-left: 1px solid var(--line); }
#chat .ch-tabs button.on { color: var(--g); background: rgba(61, 255, 138, .12); }
#chat .ch-tabs button:hover, #chat .ch-b:hover { color: var(--text); }
#chat .ch-b { border: 1px solid var(--line); border-radius: 4px; min-width: 24px; padding: 0 5px; }
#chat ul { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--line) transparent; min-height: 0; flex: 1 1 auto; }
#chat li { position: relative; padding: 4px 10px 5px 11px; border-left: 2px solid var(--kc, var(--line)); margin: 0 4px 2px; border-radius: 0 3px 3px 0; animation: chIn 1.6s ease-out; }
#chat li[data-x] { cursor: pointer; }
#chat li[data-x]:hover { background: rgba(61, 255, 138, .06); }
#chat li .cm-h { display: flex; align-items: baseline; gap: 6px; font-size: 10.5px; line-height: 1.3; color: var(--mute); }
#chat li .cm-who { font-weight: 600; color: var(--sc); }
#chat li .cm-who em { font-style: normal; color: var(--bg); background: var(--enemy); border-radius: 2px; padding: 0 3px; margin-right: 4px; font-weight: 600; }
#chat li time { font-variant-numeric: tabular-nums; }
#chat li .cm-o { font-variant-numeric: tabular-nums; opacity: .7; }
#chat li .cm-k { color: var(--kc); margin-left: auto; letter-spacing: .1em; }
#chat li p { margin: 1px 0 0; font-size: 12px; line-height: 1.5; color: var(--text); overflow-wrap: anywhere; }
#chat li p b { color: var(--kc); font-weight: 600; }
#chat li.s-p { --sc: var(--g); } #chat li.s-e { --sc: var(--enemy); } #chat li.s-sys { --sc: var(--mute); }
#chat li.s-e p { color: #f4cdd7; }
#chat li.k-plan { --kc: var(--g); } #chat li.k-order { --kc: #8fe8b4; } #chat li.k-intel { --kc: #b9a6ff; }
#chat li.k-friction { --kc: var(--amber); } #chat li.k-remedy { --kc: var(--intel); } #chat li.k-report { --kc: #7fae93; }
#chat li.k-friction p { color: #ffe2a3; } #chat li.k-remedy p { color: #c9ecff; }
#chat li.k-plan { background: rgba(61, 255, 138, .04); }
#chat .ch-new { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--line-hi); color: var(--g); border-radius: 11px; height: 22px; padding: 0 10px; font-size: 11px; }
#chat .ch-empty { padding: 10px 12px; color: var(--mute); font-size: 12px; }
@keyframes chIn { from { background: rgba(61, 255, 138, .16); } to { background: transparent; } }
#btnChat { position: relative; display: grid; place-items: center; padding: 0 6px; }
#btnChat .ic { width: 18px; height: 18px; }
#btnChat.on { border-color: var(--line-hi); color: var(--g); }
#btnChat i { position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px; border-radius: 8px; padding: 0 4px; box-sizing: border-box; background: var(--amber); color: var(--bg); font: 600 10px/16px var(--f-ui); font-style: normal; text-align: center; }
@media (max-width: 900px) {
  #chat { left: max(16px, env(safe-area-inset-left, 0px)); width: auto; background: rgba(3, 12, 7, .96); }
  #chat li p { font-size: 12.5px; }
}
@media (prefers-reduced-motion: reduce) { #chat li { animation: none; } }
`;

const chatEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const chatPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches;
// PvE（玩家进攻）里敌方通话只能截获；沙盒（玩家自己部署了守军）与观战直接可见
const chatPve = () => !!S && S.mode !== 'sandbox' && S.role !== 'spectate';
// 消息出现在面板上的时刻；null = 不出现（未被截获）
function chatAt(m) {
  if (m.side === 'e' && chatPve()) return m.ic != null ? m.ic : null;
  return m.t;
}
function chatShow(m, tab) {
  const set = typeof SETTINGS === 'object' && SETTINGS ? SETTINGS : {}, lv = set.chat || 'normal';
  if (m.side === 'e' && set.enemyChat === false) return false;
  if (lv === 'brief' && m.lv !== 0 && m.kind !== 'plan' && m.kind !== 'friction' && m.kind !== 'remedy') return false;   // lv0（必显：请求玩家行动、重大损失）简要模式也显示
  if (lv === 'normal' && (m.lv ?? 1) > 1) return false;
  if (tab === 'p' && m.side === 'e') return false;
  if (tab === 'e' && m.side !== 'e') return false;
  return true;
}
function chatVisible(tab) {
  if (!S || !Array.isArray(S.chat)) return [];
  const out = [];
  for (const m of S.chat) { const a = chatAt(m); if (a != null && a <= S.t + 1e-6 && chatShow(m, tab)) out.push(m); }
  return out.sort((a, b) => chatAt(a) - chatAt(b) || a.id - b.id);
}

function chatBuild() {
  if (typeof document === 'undefined' || CHAT.el) return;
  const st = document.getElementById('stage'), tr = document.getElementById('topr');
  if (!st) return;
  if (!document.getElementById('chatCss')) { const cs = document.createElement('style'); cs.id = 'chatCss'; cs.textContent = CHAT_CSS; document.head.appendChild(cs); }
  const el = document.createElement('section');
  el.id = 'chat'; el.className = 'ov box'; el.hidden = true; el.setAttribute('aria-label', '作战通联');
  el.innerHTML = `<div class="ch-h"><svg viewBox="0 0 24 24" class="ic" aria-hidden="true">${CHAT_ICON}</svg><b>作战通联</b>
    <div class="ch-tabs" role="tablist"><button type="button" data-tab="all">全部</button><button type="button" data-tab="p">我方</button><button type="button" data-tab="e">敌方</button></div>
    <button type="button" class="ch-b ch-lv" title="详略：简报 / 常规 / 详细"></button><button type="button" class="ch-b ch-x" title="收起（L）" aria-label="收起">–</button></div>
    <ul aria-live="polite"></ul><button type="button" class="ch-new" hidden>↓ 新消息</button>`;
  st.appendChild(el);
  CHAT.el = el; CHAT.list = el.querySelector('ul'); CHAT.pill = el.querySelector('.ch-new');
  try { const t = localStorage.getItem('bh-chat-tab'); if (t === 'p' || t === 'e' || t === 'all') CHAT.tab = t; } catch (e) { /* 无本地存储 */ }
  el.querySelector('.ch-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    CHAT.tab = b.dataset.tab;
    try { localStorage.setItem('bh-chat-tab', CHAT.tab); } catch (err) { /* 无本地存储 */ }
    chatRender(true);
  });
  el.querySelector('.ch-lv').addEventListener('click', () => {
    if (typeof SETTINGS !== 'object') return;
    const ks = Object.keys(CHAT_LV), nx = ks[(ks.indexOf(SETTINGS.chat) + 1) % ks.length];
    if (typeof setSetting === 'function') setSetting('chat', nx); else SETTINGS.chat = nx;
    if (typeof saveSettings === 'function') saveSettings();
    chatRender(true);
  });
  el.querySelector('.ch-x').addEventListener('click', () => chatToggle(false));
  CHAT.pill.addEventListener('click', () => { CHAT.list.scrollTop = CHAT.list.scrollHeight; CHAT.stick = true; CHAT.pill.hidden = true; });
  CHAT.list.addEventListener('scroll', () => {
    const L = CHAT.list;
    CHAT.stick = L.scrollTop + L.clientHeight >= L.scrollHeight - 14;
    if (CHAT.stick) CHAT.pill.hidden = true;
  });
  CHAT.list.addEventListener('click', e => {
    const li = e.target.closest('li[data-x]');
    if (!li || typeof camCenter !== 'function') return;
    const x = +li.dataset.x, y = +li.dataset.y;
    camCenter(x, y);
    CHAT.hl = { x, y, t0: performance.now(), col: li.classList.contains('s-e') ? 'enemy' : li.classList.contains('k-friction') ? 'amber' : li.classList.contains('k-remedy') ? 'intel' : 'g' };
    if (chatPhone()) chatToggle(false);   // 手机：定位后收起，让出地图
  });
  // 右上角按钮（注入 #topr，菜单按钮之前）
  if (tr && !document.getElementById('btnChat')) {
    const b = document.createElement('button');
    b.className = 'tb'; b.id = 'btnChat'; b.type = 'button'; b.title = '作战通联（L）'; b.setAttribute('aria-label', '作战通联');
    b.innerHTML = `<svg viewBox="0 0 24 24" class="ic" aria-hidden="true">${CHAT_ICON}</svg><i hidden></i>`;
    b.addEventListener('click', () => chatToggle());
    const menu = document.getElementById('btnMenu');
    menu ? tr.insertBefore(b, menu) : tr.appendChild(b);
    CHAT.btn = b; CHAT.badge = b.querySelector('i');
  }
  if (typeof addEventListener === 'function') addEventListener('resize', () => { CHAT.layT = 0; });
  if (typeof onSettings === 'function') onSettings(() => chatRender(true));
}

// 沙盒编辑时面板默认收起（只亮未读数），免得盖住东侧海滩、重复编辑面板里的部署思路；在编辑时手动打开的才显示
const chatEditing = () => !!S && S.mode === 'sandbox' && S.phase === 'sandbox';
const chatOpen = () => chatEditing() ? !!CHAT.edOpen : !!CHAT.open;
function chatToggle(v) {
  if (chatEditing()) CHAT.edOpen = v ?? !CHAT.edOpen;
  else CHAT.open = v ?? !CHAT.open;
  if (chatOpen()) { CHAT.unread = 0; CHAT.stick = true; }
  CHAT.layT = 0;
  chatRender(true);
}

// 停靠位置：#topr 之下；若据点条伸到右侧则再往下；底部不压 #bottom（桌面）或据点条（手机）
function chatLayout() {
  const el = CHAT.el, st = document.getElementById('stage');
  if (!el || !st || el.hidden) return;
  const sr = st.getBoundingClientRect(), tr = document.getElementById('topr'), trr = tr ? tr.getBoundingClientRect() : null;
  let top = trr && trr.height ? trr.bottom - sr.top + 8 : 56, bot = sr.height - 10;
  const er = el.getBoundingClientRect(), left = sr.right - 16 - er.width;
  for (const id of ['objs', 'deploy', 'pauseBand']) {   // 顶部浮层伸到面板所在列时让开
    const o = document.getElementById(id), r = o && !o.hidden && o.getBoundingClientRect();
    if (!r || !r.width || !r.height || r.top - sr.top > sr.height * .5) continue;
    if (r.right > left - 6 && r.left < sr.right) top = Math.max(top, r.bottom - sr.top + 8);
  }
  for (const id of ['bottom', 'objs']) {   // 底部浮层
    const o = document.getElementById(id), r = o && o.getBoundingClientRect();
    if (!r || !r.width || !r.height || r.top - sr.top < sr.height * .5 || r.top >= sr.bottom) continue;
    if (r.right > left - 6) bot = Math.min(bot, r.top - sr.top - 10);
  }
  const cap = chatPhone() ? bot - top : Math.min(bot - top, innerHeight * .42);
  el.style.top = Math.round(top) + 'px';
  el.style.maxHeight = Math.max(110, Math.round(cap)) + 'px';
}

function chatRow(m) {
  const li = document.createElement('li'), ic = m.side === 'e' && chatPve();
  li.className = `s-${m.side} k-${m.kind}`;
  li.dataset.id = m.id;
  if (m.x != null && m.y != null) { li.dataset.x = m.x; li.dataset.y = m.y; li.title = '点击定位'; }
  const who = m.side === 'p' ? '我方指挥官' : m.side === 'e' ? '敌方指挥官' : '系统';
  const txt = chatEsc(m.text), i = txt.indexOf('：');
  const body = i > 0 && i <= 6 ? `<b>${txt.slice(0, i + 1)}</b>${txt.slice(i + 1)}` : txt;
  // 截获的消息按截获时刻排序：显示截获时刻，原发时刻放在后面，免得时间戳前后颠倒
  li.innerHTML = `<div class="cm-h"><span class="cm-who">${ic ? '<em>截获</em>' : ''}${who}</span><time>${fmtT(ic && m.ic != null ? m.ic : m.t)}</time>${ic && m.ic != null ? `<span class="cm-o">原 ${fmtT(m.t)}</span>` : ''}<span class="cm-k">${CHAT_KIND[m.kind] || ''}</span></div><p>${body}</p>`;
  return li;
}

// 增量渲染：新列表以已渲染列表为前缀时只追加，否则重建
function chatRender(force) {
  if (!CHAT.el || !S) return;
  if (CHAT.S !== S) {   // 新战局
    CHAT.S = S; CHAT.ids = []; CHAT.unread = 0; CHAT.edOpen = false; CHAT.list.textContent = '';
    if (CHAT.open == null) CHAT.open = !chatPhone();
  }
  const vis = chatVisible(CHAT.tab), ids = vis.map(m => m.id), old = CHAT.ids;
  // 只追加：旧列表的末尾（前头可能因上限被裁掉）与新列表对得上，新消息都排在旧末条之后
  const j = old.length ? ids.lastIndexOf(old[old.length - 1]) : -1;
  let pre = !force && (!old.length || j >= 0);
  if (pre && j >= 0) for (let m = 0, n = Math.min(old.length, j + 1); m < n; m++) if (ids[j - m] !== old[old.length - 1 - m]) { pre = false; break; }
  const fresh = pre ? vis.slice(j + 1) : vis;
  // 未读：收起时新出现的消息（当前页签口径）；重建时按旧列表里没有的消息计
  const seen = new Set(old), nNew = pre ? fresh.length : force ? 0 : ids.filter(id => !seen.has(id)).length;
  const open = chatOpen();
  if (nNew && !open) CHAT.unread += nNew;
  else if (open && CHAT.unread) CHAT.unread = 0;
  const keep = !pre && !force && !CHAT.stick && old.length ? CHAT.list.scrollTop : null;   // 中间插入（截获）时重建：用户在往上翻就别跳到底
  const has = S.phase === 'battle' || vis.length > 0 || (Array.isArray(S.chat) && S.chat.some(m => { const t = chatAt(m); return t != null && t <= S.t + 1e-6; }));
  CHAT.el.hidden = !open || !has;
  if (CHAT.btn) {
    CHAT.btn.classList.toggle('on', open);
    CHAT.badge.hidden = open || !CHAT.unread;
    CHAT.badge.textContent = CHAT.unread > 99 ? '99+' : CHAT.unread;
  }
  for (const b of CHAT.el.querySelectorAll('.ch-tabs button')) b.classList.toggle('on', b.dataset.tab === CHAT.tab);
  const lvb = CHAT.el.querySelector('.ch-lv');
  if (lvb) lvb.textContent = CHAT_LV[(typeof SETTINGS === 'object' && SETTINGS.chat) || 'normal'] || '常';
  if (!pre) {
    CHAT.list.textContent = '';
    if (!vis.length) CHAT.list.innerHTML = `<li class="ch-empty">${CHAT.tab === 'e' ? (chatPve() ? '尚未截获敌方通话' : '敌方指挥官暂无通话') : '暂无通联'}</li>`;
  } else if (fresh.length) { const e = CHAT.list.querySelector('.ch-empty'); if (e) e.remove(); }
  if (fresh.length && vis.length) {
    const fr = document.createDocumentFragment();
    for (const m of fresh) { const li = chatRow(m); if (!pre) li.style.animation = 'none'; fr.appendChild(li); }
    CHAT.list.appendChild(fr);
    while (CHAT.list.children.length > 160) CHAT.list.firstChild.remove();
  }
  CHAT.ids = ids;
  if (CHAT.el.hidden) return;
  if (keep != null) { CHAT.list.scrollTop = keep; if (nNew) CHAT.pill.hidden = false; }
  else if (!pre || CHAT.stick) { CHAT.list.scrollTop = CHAT.list.scrollHeight; CHAT.pill.hidden = true; }
  else if (fresh.length) CHAT.pill.hidden = false;
  if (!pre || fresh.length) CHAT.layT = 0;
}

function chatFrame(now) {
  if (!CHAT.el) chatBuild();
  if (!CHAT.el || !S) return;
  if (now - CHAT.scanT > 200 || CHAT.S !== S) { CHAT.scanT = now; chatRender(false); }
  if (!CHAT.el.hidden && now - CHAT.layT > 900) { CHAT.layT = now; chatLayout(); }
}

// 点击消息定位后：在目标处画两圈短暂扩散的细环（实时计时，暂停时也可见）
function chatDrawHl() {
  const h = CHAT.hl;
  if (!h || typeof R === 'undefined' || !R.ctx) return;
  const age = (performance.now() - h.t0) / 1000;
  if (age > 1.8) { CHAT.hl = null; return; }
  const ctx = R.ctx, col = COL[h.col] || COL.g;
  for (let k = 0; k < 2; k++) {
    const u = clamp((age - k * .35) / 1.2, 0, 1);
    if (u <= 0 || u >= 1) continue;
    ctx.strokeStyle = rgba(col, (1 - u) * .9); ctx.lineWidth = px(1.5);
    ctx.beginPath(); ctx.arc(h.x, h.y, px(8) + u * px(40), 0, 6.2832); ctx.stroke();
  }
}

if (typeof document !== 'undefined') {
  HOOK.frame.push(chatFrame);
  HOOK.drawTop.push(chatDrawHl);
  HOOK.key.push(e => {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'l' && e.key !== 'L')) return false;
    if (typeof MENU === 'object' && MENU.open) return false;
    chatToggle();
    return true;
  });
  chatBuild();
}
