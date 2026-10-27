'use strict';
// 舰艇支援（编队指挥模式里保留的直接操控）：开战后点我方驱逐舰，弹出火力选项——舰炮、烟幕、垂发导弹、战术导弹、AI 自动；
//   点航母，弹出舰载机选项——侦察、空袭、对地支援、战斗机巡逻、轰炸、AI 自动。
//   舰炮 / 烟幕 / 导弹：选好后点地图上的目标（舰炮可以连续点，右键 / Esc 收手）；
//   飞机：在地图上按住拖出一个圈——圈心是目标区，攻击机、轰炸机打圈里最要紧的已知目标，其余飞到圈心；只点一下按默认范围。
//   快捷键：F 舰炮 · T 空袭 · V 对地支援 · R 侦察（Y 垂发导弹、I 战术导弹由各自模块管）。只在玩家指挥攻方（S.ctl = 'p'）时有
const SPU = { el: null, k: null, circ: null, last: null, t: 0 };
const SPU_AIR = { recon: 150, strike: 140, cas: 120, fighter: 260, bomber: 140 };   // 舰载机任务 → 只点一下时的默认范围（米）
const spuOn = () => !!S && S.phase === 'battle' && S.ctl === 'p' && typeof thuActive === 'function' && thuActive() && !(typeof V3O === 'object' && V3O.on);   // 3D 观察者模式里不弹

const SPU_CSS = `
#spMenu { position: absolute; z-index: 6; width: 268px; padding: 0; font-size: 12px; pointer-events: auto; }
#spMenu header { display: flex; align-items: baseline; gap: 8px; padding: 6px 9px; border-bottom: 1px solid var(--line); }
#spMenu header b { color: var(--g-hi); font-size: 13px; white-space: nowrap; }
#spMenu header span { color: var(--mute); font-size: 11px; margin-left: auto; white-space: nowrap; }
#spMenu .sp-btns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 6px; }
#spMenu button { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 5px 7px; border: 1px solid var(--line-hi); border-radius: 4px;
  background: rgba(var(--pn-rgb), .9); font-size: 12px; text-align: left; white-space: nowrap; }
#spMenu button small { color: var(--mute); font-size: 10px; white-space: nowrap; }
#spMenu button.on { border-color: var(--amber); color: var(--amber); }
#spMenu .sp-tip { padding: 0 9px 7px; color: var(--mute); font-size: 11px; }`;

// —— 菜单内容 ——
function spuDdItems() {
  const D = S.dd, vl = typeof vlsShips === 'function' && typeof VLS_LAND === 'object' ? (vlsShips().length ? VLS_LAND.reduce((a, k) => a + vlsLeft(k), 0) : 0) : 0;
  const msl = typeof msOn === 'function' && msOn() && S.assets && S.assets.msl > 0 ? S.assets.msl : 0;
  const gun = D.state === 'ready' ? (D.cool > 0 ? `装填 ${Math.ceil(D.cool)}s` : '可射击') : D.state === 'repair' ? '损管中' : '不可用';
  return {
    title: D.name || '驱逐舰', st: D.auto ? 'AI 自动指挥中' : '手动',
    items: [['fire', '舰炮', gun, D.state === 'ready'], ['smoke', '烟幕弹', gun, D.state === 'ready'],
      ['vls', '垂发导弹', `余 ${vl}`, vl > 0], ['msl', '战术导弹', `余 ${msl}`, msl > 0],
      ['ddauto', D.auto ? '交给 AI：开' : '交给 AI：关', '', true, D.auto]],
    tip: '舰炮、烟幕、导弹：选好后点地图上的目标；右键 / Esc 收手'
  };
}
function spuCvItems() {
  const W = S.air ? S.air.wing : [], cvOk = (o) => typeof airLandW === 'function' && airLandW(o) ? true : (typeof cvOf === 'function' && typeof cvHome === 'function' ? (cvOf(cvHome(o)) || { hp: 0 }).hp > 0 : S.cv.hp > 0);
  const cnt = k => { const L = W.filter(o => o.type === k && o.state !== 'lost'); return { all: L.length, rdy: L.filter(o => o.state === 'deck' && cvOk(o)).length }; };
  const it = (k, nm) => { const c = cnt(k); return c.all ? [[k, nm, `待命 ${c.rdy}/${c.all}`, c.rdy > 0]] : []; };
  return {
    title: '福建舰（舰载航空兵）', st: S.cv.auto ? 'AI 自动派机中' : '手动',
    items: [...it('recon', '侦察'), ...it('strike', '空袭'), ...it('cas', '对地支援'), ...it('fighter', '战斗机巡逻'), ...it('bomber', '轰炸'),
      ['cvauto', S.cv.auto ? '交给 AI：开' : '交给 AI：关', '', true, S.cv.auto]],
    tip: '飞机：在地图上按住拖出一个圈（圈心是目标区）；只点一下按默认范围；右键 / Esc 取消'
  };
}
function spuEl() {
  if (SPU.el || typeof document === 'undefined') return SPU.el;
  const st = document.createElement('style'); st.textContent = SPU_CSS; document.head.appendChild(st);
  const el = SPU.el = document.createElement('div');
  el.id = 'spMenu'; el.className = 'ov box'; el.hidden = true; el.setAttribute('role', 'menu');
  el.addEventListener('pointerdown', e => e.stopPropagation());
  el.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b && !b.disabled) { spuPick(b.dataset.k); spuClose(); } });
  (document.getElementById('stage') || document.body).appendChild(el);
  return el;
}
// 菜单开着时只改按钮上的字和状态，不整块重画（不然正要点的按钮会被换掉，点了没反应）；项目变了才重建
function spuFill() {
  const el = SPU.el, M = SPU.k === 'dd' ? spuDdItems() : spuCvItems(), keys = M.items.map(o => o[0]).join();
  if (el.dataset.keys !== keys) {
    el.dataset.keys = keys;
    el.innerHTML = `<header><b></b><span></span></header><div class="sp-btns">` + M.items.map(([k]) => `<button type="button" data-k="${k}"><span></span><small></small></button>`).join('') + `</div><div class="sp-tip"></div>`;
  }
  const set = (e, t) => { if (e && e.textContent !== t) e.textContent = t; };
  set(el.querySelector('header b'), M.title); set(el.querySelector('header span'), M.st); set(el.querySelector('.sp-tip'), M.tip);
  for (const [k, nm, sub, ok, on] of M.items) {
    const b = el.querySelector(`button[data-k="${k}"]`);
    if (!b) continue;
    set(b.firstChild, nm); set(b.lastChild, sub);
    if (b.disabled !== !ok) b.disabled = !ok;
    b.classList.toggle('on', !!on || U.tool === k);
  }
}
// 在点击处弹出（不出画面）
function spuOpen(k, e) {
  const el = spuEl();
  if (!el) return;
  SPU.k = k; spuFill(); el.hidden = false;
  const st = (document.getElementById('stage') || document.body).getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.round(clamp(e.clientX - st.left + 14, 8, st.width - w - 8)) + 'px';
  el.style.top = Math.round(clamp(e.clientY - st.top - h / 2, 8, st.height - h - 8)) + 'px';
}
function spuClose() { if (SPU.el && !SPU.el.hidden) SPU.el.hidden = true; SPU.k = null; }
function spuCancel() { const had = !!(U.tool || SPU.circ || SPU.k); U.tool = null; SPU.circ = null; spuClose(); if (typeof updateHud === 'function') updateHud(); return had; }

// 选中一项：设好工具（舰炮 / 烟幕 / 飞机由这里接点击，导弹交给 vls.js / missile.js）
function spuPick(k) {
  if (k === 'ddauto') { if (typeof toggleAuto === 'function') toggleAuto(); log(S.dd.auto ? '驱逐舰交给 AI 自动指挥' : '驱逐舰改为手动：只按你点的目标射击', 'info', 'spdd', 1); return; }
  if (k === 'cvauto') { if (typeof toggleCvAuto === 'function') toggleCvAuto(); return; }
  if (k === 'vls') { if (typeof vlsTool === 'function') { U.tool = null; vlsTool(); } return; }
  if (k === 'msl') { if (typeof msTool === 'function') { U.tool = null; msTool(); } return; }
  U.tool = U.tool === k ? null : k;
  if (U.tool) log(SPU_AIR[k] ? `在地图上按住拖出一个圈，叫${AIR_SPEC[k] ? AIR_SPEC[k].name : '飞机'}到圈里（右键 / Esc 取消）` : k === 'smoke' ? '点地图放烟幕（右键 / Esc 取消）' : '点地图上的目标，舰炮射击；可以连续点，右键 / Esc 收手', 'info', 'sptool', 1);
  if (typeof updateHud === 'function') updateHud();
}
// 点到的是驱逐舰还是航母
function spuHit(p) {
  if (S.cv && S.cv.hp > 0 && typeof pickCarrier === 'function' && pickCarrier(p)) return 'cv';
  const D = S.dd;
  if (D && D.state !== 'sunk' && dist(p.x, p.y, D.x, D.y) < Math.max(26, px(18))) return 'dd';
  return null;
}
// 圈里最要紧的已知目标（攻击机 / 轰炸机打它）：防空 > 火炮 > 岸防 > 碉堡 > 其余，同类挑近圈心的
const SPU_PRI = { aa: 5, arty: 4, mortar: 4, coastal: 3, tel: 3, ascm: 3, bunker: 2 };
function spuTgt(x, y, r) {
  let best = null, bs = -1e9;
  for (const e of S.enemies) if (!e.dead && e.kx != null) { const d = dist(e.kx, e.ky, x, y); if (d <= r) { const s = (SPU_PRI[e.kind] || 1) * 100 - d / r * 60; if (s > bs) { bs = s; best = { x: e.kx, y: e.ky }; } } }
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && (inVision(v.x, v.y) || (v.seen != null && S.t - v.seen < 60))) { const d = dist(v.x, v.y, x, y); if (d <= r) { const s = (v.type === 'aa_veh' || v.type === 'sam_veh' ? 5 : 2.5) * 100 - d / r * 60; if (s > bs) { bs = s; best = { x: v.x, y: v.y }; } } }
  return best;
}
// 松开：按圈出动
function spuAir(t, C) {
  const r0 = dist(C.x0, C.y0, C.x, C.y), r = r0 < px(14) ? SPU_AIR[t] : clamp(r0, 40, 700);
  let tx = C.x0, ty = C.y0;
  if (t === 'strike' || t === 'bomber') { const g = spuTgt(tx, ty, r); if (g) { tx = g.x; ty = g.y; } }
  const ok = t === 'recon' || t === 'fighter' ? launchPlane(t, tx, ty) : airPkg(t, tx, ty);
  if (ok) { U.tool = null; SPU.last = { x: C.x0, y: C.y0, r, tx, ty, t: performance.now() }; }
  if (typeof updateHud === 'function') updateHud();
}

// 排在最前：别的模块的工具（垂发导弹、战术导弹……）开着时这里不管，交给它们
HOOK.pointer.unshift(function spuPointer(e, kind, p) {
  if (!spuOn() || !p) { if (SPU.k) spuClose(); SPU.circ = null; return false; }
  if (kind === 'down') {
    spuClose();
    const t = U.tool, touch = e.pointerType === 'touch';
    if (SPU.circ && SPU.circ.id !== e.pointerId) { SPU.circ = null; return false; }   // 第二根手指：让给双指缩放
    if (t && (SPU_AIR[t] || t === 'fire' || t === 'smoke')) {
      if (e.button === 2) { U.tool = null; if (typeof updateHud === 'function') updateHud(); return true; }
      if (e.button !== 0 && !touch) return false;
      if (SPU_AIR[t]) { SPU.circ = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y }; try { R.cv.setPointerCapture(e.pointerId); } catch (er) { /* 没有指针捕获也能用 */ } return true; }
      if (ddFire(p.x, p.y, t === 'smoke') && t === 'smoke') U.tool = null;
      if (typeof updateHud === 'function') updateHud();
      return true;
    }
    if (!t && (e.button === 0 || touch)) { const k = spuHit(p); if (k) { spuOpen(k, e); return true; } }
    return false;
  }
  if (!SPU.circ || SPU.circ.id !== e.pointerId) return false;
  if (kind === 'move') { SPU.circ.x = p.x; SPU.circ.y = p.y; return true; }
  if (kind === 'up') { const C = SPU.circ; SPU.circ = null; C.x = p.x; C.y = p.y; if (SPU_AIR[U.tool]) spuAir(U.tool, C); return true; }
  return false;
});
// Esc 收菜单、收工具（菜单键看到工具开着就不弹游戏菜单，见 menu.js）；F / T / V / R 直接选工具
HOOK.key.push(function spuKey(e) {
  if (!spuOn() || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === 'Escape') { if (!(SPU.k || SPU.circ || (U.tool && (SPU_AIR[U.tool] || U.tool === 'fire' || U.tool === 'smoke')))) return false; spuCancel(); e.spuEsc = true; return true; }   // spuEsc：这一下 Esc 已用掉，菜单键别再弹游戏菜单
  const k = !e.shiftKey && { KeyF: 'fire', KeyT: 'strike', KeyV: 'cas', KeyR: 'recon' }[e.code];
  if (!k) return false;
  e.preventDefault(); spuPick(k); return true;
});
// 菜单开着时每 0.4 秒刷新状态（装填、待命架数）；离开战斗 / 不再指挥就收起
HOOK.frame.push(function spuFrame(now) {
  if (!SPU.el) return;
  if (!spuOn()) { if (SPU.k) spuClose(); return; }
  if (SPU.k && now - SPU.t > 400) { SPU.t = now; spuFill(); }
});
HOOK.newGame.push(() => { SPU.circ = null; SPU.last = null; spuClose(); });

// —— 地图上：正在拖的圈（圈心十字、半径、预计打击的目标），出动后圈淡出 ——
HOOK.drawTop.push(function spuDraw() {
  if (!S || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, C = SPU.circ, L = SPU.last;
  const ring = (x, y, r, a, col) => {
    ctx.strokeStyle = rgba(col, .85 * a); ctx.fillStyle = rgba(col, .07 * a); ctx.lineWidth = px(1.6); ctx.setLineDash([px(6), px(4)]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    const d = px(7); ctx.beginPath(); ctx.moveTo(x - d, y); ctx.lineTo(x + d, y); ctx.moveTo(x, y - d); ctx.lineTo(x, y + d); ctx.stroke();
  };
  if (C && SPU_AIR[U.tool]) {
    const r0 = dist(C.x0, C.y0, C.x, C.y), r = r0 < px(14) ? SPU_AIR[U.tool] : clamp(r0, 40, 700);
    ring(C.x0, C.y0, r, 1, COL.intel);
    const g = (U.tool === 'strike' || U.tool === 'bomber') && spuTgt(C.x0, C.y0, r);
    if (g) { ctx.strokeStyle = rgba(COL.amber, .95); ctx.lineWidth = px(1.8); ctx.beginPath(); ctx.arc(g.x, g.y, px(9), 0, 7); ctx.stroke(); }
    ctx.fillStyle = rgba(COL.intel, .95); ctx.font = `${Math.round(px(12))}px "IBM Plex Mono", "Noto Sans SC", monospace`;
    ctx.fillText(`${AIR_SPEC[U.tool] ? AIR_SPEC[U.tool].name : ''} · 范围 ${Math.round(r)} 米`, C.x0 + r * .72 + px(6), C.y0 - r * .72);
  }
  if (L) {
    const a = 1 - (performance.now() - L.t) / 2200;
    if (a <= 0) SPU.last = null; else ring(L.x, L.y, L.r, a, COL.intel);
  }
});
