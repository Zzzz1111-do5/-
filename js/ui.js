'use strict';
// 选择与指令：选中的是连队（单位）、舰船与驱逐舰；部署阶段右键为布阵或预定登陆点
const U = { tool: null, mouse: null, box: null, down: null, fdrag: null, hoverText: '', logKey: null, level: 'hard', touches: new Map(), pinch: null, grpT: {} };
const $ = id => document.getElementById(id);
const selUnits = () => S.sel.map(id => UNIT_MAP.get(id)).filter(u => u && u.side === 'p' && teamsOf(u).length);
const selTeams = () => selUnits().flatMap(teamsOf);
const selShips = () => S.sel.map(id => S.ships.find(s => s.id === id)).filter(s => s && alive(s));
const selDD = () => S.sel.includes('DD') && S.dd.state !== 'sunk';
const selCV = () => S.sel.includes('CV') && S.cv && S.cv.hp > 0;
const isSel = id => S.sel.includes(id);
const movable = s => s.state === 'idle' || s.state === 'move';
const ORDER_NAME = { hold: '坚守', move: '移动', amove: '攻击前进', charge: '冲锋', retreat: '撤退', clear: '排雷剪网' };

function setTool(t) { U.tool = U.tool === t ? null : t; updateHud(); }
function evPos(e) { const r = R.cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }

function pickAt(p) {
  if (typeof pickVeh === 'function') { const v = pickVeh(p); if (v != null) return v; }   // 车辆（vehicles.js）：点在剪影内
  let best = null, bd = px(14);
  for (const q of S.teams) if (q.side === 'p' && q.u) { const d = dist(p.x, p.y, q.x, q.y); if (d < bd) { bd = d; best = q.u; } }
  for (const u of S.units) if (u.side === 'p' && u.x != null) {   // 点连队旗也能选中
    const ts = teamsOf(u); if (!ts.length) continue;
    const top = Math.min(...ts.map(q => q.y)) - px(22);
    if (Math.abs(p.x - (u.x + px(7))) < px(10) && Math.abs(p.y - top) < px(10)) return u.id;
  }
  if (best) return best;
  if (typeof pickCarrier === 'function' && S.cv) { const c = pickCarrier(p); if (c) return c; }
  if (typeof pickShip === 'function') { const h = pickShip(p); if (h != null) return h; }
  bd = px(18);
  for (const s of S.ships) if (alive(s)) { const d = dist(p.x, p.y, s.x, s.y); if (d < bd) { bd = d; best = s.id; } }
  if (S.dd.state !== 'sunk' && dist(p.x, p.y, S.dd.x, S.dd.y) < Math.max(bd, px(20))) best = 'DD';
  return best;
}

// 右键或工具点击；face/total 来自右键拖拽（拖出的线定宽，线的左手法向为朝向）
function issueOrder(p, mode, face, total) {
  const vs = typeof selVehs === 'function' ? selVehs() : [];
  if (S.phase === 'deploy') { deployOrder(selShips(), selDD(), p.x, p.y, selCV()); if (vs.length) vehDeployOrder(vs, p.x, p.y); updateHud(); return 1; }
  const units = selUnits(), ships = selShips().filter(movable);
  let n = 0;
  // 玩家亲自下令即转为手动指挥（自动驾驶不再接管）
  for (const u of units) u.auto = false;
  for (const s of ships) s.auto = false;
  if (selCV() && typeof orderCV === 'function' && orderCV(p.x, p.y)) n++;
  if (units.length) {
    const cx0 = units.reduce((a, u) => a + u.x, 0) / units.length, cy0 = units.reduce((a, u) => a + u.y, 0) / units.length;
    const f = face ?? Math.atan2(p.y - cy0, p.x - cx0);
    const us = mode === 'clear' ? units.filter(u => u.kind === 'eng') : units;
    if (mode === 'clear') { for (const u of us) orderTeams(teamsOf(u), p.x, p.y, 'clear'); n += us.length; }
    else n += orderUnits(us, p.x, p.y, f, total, mode || 'move');
  }
  if (ships.length) n += orderShips(ships, p.x, p.y);
  if (selDD() && orderDD(p.x, p.y)) n++;
  // 车辆：与步兵同时下令时落在队形后方；排雷指令只给扫雷坦克
  const vm = mode === 'clear' ? vs.filter(v => VEH_SPEC[v.type].flail) : vs;
  if (vm.length) n += units.length && mode !== 'clear' ? vehOrderWith(vm, units, p.x, p.y, face, mode || 'move') : vehOrder(vm, p.x, p.y, mode || 'move', face);
  return n;
}

function applyTool(p) {
  const t = U.tool;
  if (t === 'move' || t === 'amove' || t === 'charge' || t === 'clear') { if (issueOrder(p, t)) U.tool = null; }
  else if (S.phase === 'deploy') log('支援火力在战斗开始后才能使用', 'warn', 'dep', 2);
  else if (t === 'fire') ddFire(p.x, p.y, false);
  else if (t === 'smoke') { if (ddFire(p.x, p.y, true)) U.tool = null; }
  else if (t === 'recon' || t === 'strike' || t === 'cas' || t === 'bomber' || t === 'fighter') { if (launchPlane(t, p.x, p.y)) U.tool = null; }
  else if (t === 'rline') {
    const h = typeof pickShip === 'function' ? pickShip(p) : null;
    const s = S.ships.find(s => s.state === 'beached' && (s.id === h || dist(s.x, s.y, p.x, p.y) < 25));
    if (!s) log('点选一艘已抢滩的登陆舰作为增援线终点', 'warn', 'rl0', 2);
    else if (buildRLine(s)) U.tool = null;
  }
  updateHud();
}

function selectGroup(n) {
  S.sel = S.groups[n].filter(id => id === 'DD' ? S.dd.state !== 'sunk' : id === 'CV' ? !!S.cv : UNIT_MAP.has(id) || S.ships.some(s => s.id === id && alive(s)) || (S.veh || []).some(v => v.id === id && !v.dead));
  const now = performance.now();
  if (now - (U.grpT[n] || 0) < 400 && S.sel.length) centerOnSel();
  U.grpT[n] = now;
  updateHud();
}
function centerOnSel() {
  const objs = S.sel.map(id => id === 'DD' ? S.dd : id === 'CV' ? S.cv : UNIT_MAP.get(id) || S.ships.find(s => s.id === id) || (S.veh || []).find(v => v.id === id)).filter(o => o && o.x != null);
  if (objs.length) camCenter(objs.reduce((a, o) => a + o.x, 0) / objs.length, objs.reduce((a, o) => a + o.y, 0) / objs.length);
}
function assignGroup(n) {
  if (!S.sel.length) return;
  for (const g in S.groups) S.groups[g] = S.groups[g].filter(id => !S.sel.includes(id));
  S.groups[n] = S.sel.slice();
  updateHud();
}
const ordersNow = t => {
  const us = selUnits(), vs = typeof selVehs === 'function' ? selVehs() : [];
  if (us.length) orderUnits(us, 0, 0, 0, null, t);
  if (vs.length && S.phase !== 'deploy') vehOrderAll(vs, t);
  updateHud();
};
function formNow(f) {
  if (S.phase === 'deploy') for (const s of selShips()) s.form = f;
  setForm(selUnits(), f);
  updateHud();
}
function togglePause() { if (!S.over && S.phase === 'battle') { S.paused = !S.paused; updateHud(); } }
function toggleAuto() { S.dd.auto = !S.dd.auto; updateHud(); }
// 选中部队/舰船在“自动（AI 接管）”与“手动（玩家指挥）”之间切换
function toggleAutoSel() {
  const items = [...selUnits(), ...selShips(), ...(typeof selVehs === 'function' ? selVehs() : [])];
  if (!items.length) return;
  const on = items.some(o => o.auto !== true);
  for (const o of items) o.auto = on;
  if (S.phase === 'deploy') for (const s of selShips()) s.unitAuto = on;
  log(on ? `${items.length} 个单位交由 AI 自动指挥` : `${items.length} 个单位改为手动指挥`, 'info', 'auto', 1);
  updateHud();
}

function finishSelect(p, add) {
  if (U.box) {
    const b = U.box, inB = o => o.x >= b.x0 && o.x <= b.x1 && o.y >= b.y0 && o.y <= b.y1;
    const vids = (S.veh || []).filter(v => v.side === 'p' && !v.dead && !v.lst && inB(v)).map(v => v.id);   // 车辆（vehicles.js）
    let ids = S.phase === 'deploy' ? [] : S.units.filter(u => u.side === 'p' && teamsOf(u).some(inB)).map(u => u.id).concat(vids);
    if (!ids.length) ids = S.ships.filter(s => alive(s) && (movable(s) || S.phase === 'deploy') && inB(s)).map(s => s.id).concat(vids);
    if (S.dd.state !== 'sunk' && inB(S.dd)) ids.push('DD');
    if (S.cv && inB(S.cv)) ids.push('CV');
    S.sel = add ? [...new Set([...S.sel, ...ids])] : ids;
  } else {
    const id = pickAt(p);
    if (id != null) S.sel = add ? (S.sel.includes(id) ? S.sel.filter(i => i !== id) : [...S.sel, id]) : [id];
    else if (!add) S.sel = [];
  }
  U.box = null;
  updateHud();
}
