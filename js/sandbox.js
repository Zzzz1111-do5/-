'use strict';
// 沙盒模式：同一张海岸地图上按预算自由部署岸防与进攻部队（CATALOG 条目），可让「高级指挥官」AI 替任一方部署并在聊天框说明理由；
// 开战时把部署条目转换为引擎对象，观战 AI 对 AI 或亲自指挥进攻方。部署数据 S.sbx = {items, budget, notes, ...}（纯 JSON）。
// 条目字段：{id, cat(目录 id), side, x, y, x2, y2, cargo:[目录 id], plan:{x,y}, wave, n(兵组/数量覆盖), r(雷区半径), pts(折线), t(增援时刻)}
const SBX_BUDGET = 1500;
const SBX = { el: null, side: 'e', cat: 'all', pick: null, hover: null, line: null, lineDown: null, drag: null, mouse: null, tip: null, msg: '', msgT: 0, pv: false, endKey: null };
const sbxEntry = it => it && typeof catalogById === 'function' ? catalogById(it.cat) : null;
const sbxOn = () => !!(S && S.phase === 'sandbox' && S.sbx);
const sbxLive = () => !!(S && S.mode === 'sandbox' && S.sbx && S.sbx.live);
const sbxR = v => Math.round(v * 10) / 10;
const sbxVehOk = () => typeof addVehicle === 'function';

// 参谋笔记：写进聊天框（chat.js），同时留在沙盒面板「部署思路」里
function sbxSay(side, text, kind, at) {
  if (typeof chatSay === 'function') { try { chatSay(side, text, { kind: kind || 'plan', at: at && isFinite(at.x) ? { x: at.x, y: at.y } : undefined }); } catch (e) { /* 聊天模块异常不影响部署 */ } }
  if (S && S.sbx && S.sbx.notes) { const L = S.sbx.notes[side] || (S.sbx.notes[side] = []); L.push(text); if (L.length > 40) L.shift(); }
}

// —— 点数 ——
function sbxCost(it) {
  const c = sbxEntry(it);
  if (!c) return 0;
  const s = c.spawn;
  if (s.at === 'line') {
    let len = 0;
    if (it.pts) for (let k = 1; k < it.pts.length; k++) len += dist(it.pts[k - 1][0], it.pts[k - 1][1], it.pts[k][0], it.pts[k][1]);
    else len = dist(it.x, it.y, it.x2, it.y2);
    return Math.max(1, Math.round(s.per * len / 100));
  }
  let k = 1;
  if (it.n != null && (s.teams || s.n)) k = it.n / (s.teams || s.n);
  return Math.max(1, Math.round(c.cost * k)) + (it.cargo || []).reduce((a, id) => a + ((catalogById(id) || {}).cost || 0), 0);
}
const sbxSpent = side => S.sbx.items.filter(it => it.side === side).reduce((a, it) => a + sbxCost(it), 0);
const sbxLeft = side => S.sbx.budget[side] - sbxSpent(side);
const sbxShipCap = it => { const c = sbxEntry(it), s = c && c.spawn; return s && s.kind === 'ship' ? { t: s.cap || 0, v: s.vcap || 0 } : { t: 0, v: 0 }; };
function sbxShipLoad(it) {
  let t = 0, v = 0;
  for (const id of it.cargo || []) { const c = catalogById(id); if (c && c.spawn.kind === 'veh') v++; else if (c) t++; }
  return { t, v };
}
const sbxOf = kind => S.sbx.items.filter(it => { const c = sbxEntry(it); return c && c.spawn.kind === kind; });
const sbxWingCap = () => { const cv = sbxOf('cv')[0]; return cv ? sbxEntry(cv).spawn.wing : 0; };
const sbxWingN = () => sbxOf('wing').reduce((a, it) => a + (sbxEntry(it).spawn.n || 1), 0);

// —— 放置校验：返回 {ok, why, host} ——
const SBX_AT = {
  land: '放在海岸线以北的陆地上', coast: '放在离海岸 300 以内的陆地（岬角、高地最好）', shore: '放在滩头前的浅滩或滩顶', line: '两点连线：点起点、再点终点（或按住拖拽）',
  sea: '放在集结海域（虚线以南的深水区）', cargo: '装载：点击一艘有空余运力的登陆舰', vcargo: '装载：点击一艘坦克登陆舰 / 中型登陆舰', air: '无需位置：点击即编入航母（需先部署航母）',
  none: '无需位置：点击即编入', target: '目标点：点击敌岸任意位置'
};
const sbxLandOk = (x, y) => { const t = typeAt(x, y); return !isWater(t) && t !== T.RIVER && y < coastAt(x) - 4; };
function sbxCheck(c, x, y, x2, y2, ignore) {
  if (!c) return { ok: false, why: '未知条目' };
  const s = c.spawn, bad = why => ({ ok: false, why });
  if (s.kind === 'veh' && !sbxVehOk()) return bad('装甲车辆模块未加载');
  let cost = c.cost;
  if (s.at === 'line') cost = x2 == null ? 1 : Math.max(1, Math.round(s.per * dist(x, y, x2, y2) / 100));
  const repl = (s.kind === 'dd' || s.kind === 'cv') ? sbxOf(s.kind).reduce((a, it) => a + sbxCost(it), 0) : 0;
  if (ignore) cost = 0;
  if (cost > sbxLeft(c.side) + repl) return bad(`预算不足（还剩 ${sbxLeft(c.side)} 点）`);
  if (s.at === 'none') return { ok: true };
  if (s.at === 'air') {
    if (!sbxOf('cv').length) return bad('需要先部署一艘航母');
    if (sbxWingN() + (s.n || 1) > sbxWingCap()) return bad(`航母机库已满（${sbxWingCap()} 架）`);
    return { ok: true };
  }
  if (!(x > 8 && x < W - 8 && y > 8 && y < H - 8)) return bad('超出地图');
  const t = typeAt(x, y);
  if (s.at === 'cargo' || s.at === 'vcargo') {
    const veh = s.at === 'vcargo';
    let host = null, bd = Math.max(70, typeof px === 'function' && typeof R === 'object' && R.s ? px(26) : 70);
    for (const it of S.sbx.items) if (it.side === 'p') {
      const cap = sbxShipCap(it), ld = sbxShipLoad(it), d = dist(x, y, it.x, it.y);
      if (d < bd && (veh ? cap.v > ld.v : cap.t > ld.t)) { bd = d; host = it; }
    }
    return host ? { ok: true, host } : bad(veh ? '附近没有空余车位的坦克登陆舰' : '附近没有空余运力的登陆舰（步兵须装载上舰）');
  }
  if (s.at === 'sea') {
    if (t !== T.DEEP) return bad('只能放在深水区');
    if (y < STAGING_Y - 100) return bad('只能放在集结海域（虚线以南）');
    if (s.kind === 'cv' && y < STAGING_Y + 40) return bad('航母须停在集结海域纵深（更南）');
    if (S.sbx.items.some(it => it !== ignore && it.side === 'p' && it.x != null && sbxEntry(it).spawn.at === 'sea' && dist(it.x, it.y, x, y) < 16)) return bad('与其他舰艇重叠');
    return { ok: true };
  }
  if (s.at === 'target') return isLand(x, y) ? { ok: true } : bad('目标须在陆地上');
  if (s.at === 'shore') {
    const d = coastAt(x) - y;
    if (!(t === T.SHOAL || t === T.BEACH || (sbxLandOk(x, y) && TP[t].sp > 0)) || d > 110 || d < -80) return bad('障碍物放在滩头前浅滩或滩顶 110 以内');
    return { ok: true };
  }
  if (s.at === 'line') {
    if (!sbxLandOk(x, y)) return bad('起点须在陆地上');
    if (x2 == null) return { ok: true };
    const L = dist(x, y, x2, y2);
    if (L < 20) return bad('线太短');
    if (L > 420) return bad('一次最长 420');
    for (let k = 0; k <= Math.ceil(L / 10); k++) { const u = k / Math.ceil(L / 10); if (!sbxLandOk(lerp(x, x2, u), lerp(y, y2, u))) return bad('线段穿过水域或河流'); }
    return { ok: true };
  }
  // land / coast
  if (!sbxLandOk(x, y)) return bad('须放在海岸线以北的陆地上（不能在河里）');
  const mob = s.kind === 'einf' || s.kind === 'veh' || s.kind === 'car';
  if (mob && !(TP[t].sp > 0)) return bad('部队不能放在悬崖或不可通行地形');
  if (s.at === 'coast' && coastAt(x) - y > 300) return bad('岸防炮须在离海岸 300 以内');
  if (s.kind === 'enemy' || s.kind === 'post') {
    if (S.sbx.items.some(it => it !== ignore && it.side === 'e' && it.x != null && ['enemy', 'post'].includes(sbxEntry(it).spawn.kind) && dist(it.x, it.y, x, y) < 12)) return bad('与其他工事重叠');
  }
  return { ok: true };
}

// —— 放置、移除 ——
function sbxPlace(id, x, y, x2, y2, extra) {
  const c = catalogById(id), chk = sbxCheck(c, x, y, x2, y2);
  if (!chk.ok) return chk;
  if (chk.host) { chk.host.cargo = (chk.host.cargo || []).concat(id); return { ok: true, it: chk.host }; }
  const s = c.spawn;
  if (s.kind === 'dd' || s.kind === 'cv') S.sbx.items = S.sbx.items.filter(it => sbxEntry(it).spawn.kind !== s.kind);
  const pos = s.at === 'none' || s.at === 'air' ? {} : { x: sbxR(x), y: sbxR(y) };
  if (s.at === 'line') Object.assign(pos, { x2: sbxR(x2), y2: sbxR(y2) });
  const it = { id: S.sbx.nid++, cat: id, side: c.side, ...pos, ...(s.kind === 'ship' ? { cargo: [], wave: s.wave || 1 } : {}), ...extra };
  S.sbx.items.push(it);
  sbxSync();
  return { ok: true, it };
}

// 离 (x,y) 最近的一方条目：舰艇优先卸下最后装载的部队
function sbxNearest(x, y, side, r) {
  let best = null, bd = r;
  for (const it of S.sbx.items) {
    if (it.side !== side || it.x == null) continue;
    const d = it.x2 != null ? segDist(x, y, it.x, it.y, it.x2, it.y2) : it.pts ? polyDist(x, y, it.pts) : dist(x, y, it.x, it.y);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}
function sbxRemove(it) {
  if (!it) return false;
  if (it.cargo && it.cargo.length) it.cargo.pop();
  else S.sbx.items = S.sbx.items.filter(o => o !== it);
  if (sbxEntry(it).spawn.kind === 'cv' && !sbxOf('cv').length) S.sbx.items = S.sbx.items.filter(o => sbxEntry(o).spawn.kind !== 'wing');
  sbxSync();
  return true;
}
function sbxClear(side) {
  S.sbx.items = S.sbx.items.filter(it => it.side !== side);
  S.sbx.notes[side] = [];
  sbxSync();
}

// 编辑阶段：驱逐舰与航母只在买下后出现在其位置（否则移出地图）
function sbxSync() {
  if (!S || !S.sbx || S.sbx.live) return;
  const dd = sbxOf('dd')[0], cv = sbxOf('cv')[0];
  if (dd) Object.assign(S.dd, { x: dd.x, y: dd.y, tx: dd.x, ty: dd.y, state: 'ready', moving: false, hull: sbxEntry(dd).spawn.hull });
  else Object.assign(S.dd, { x: -9999, y: H + 9999, tx: -9999, ty: H + 9999, state: 'sunk', moving: false });
  if (S.cv) {
    if (cv) Object.assign(S.cv, { x: cv.x, y: cv.y, tx: cv.x, ty: cv.y, hp: sbxEntry(cv).spawn.hp, maxhp: sbxEntry(cv).spawn.hp, moving: false });
    else Object.assign(S.cv, { x: -9999, y: H + 9999, tx: -9999, ty: H + 9999, moving: false });
  }
  if (typeof sbxRender === 'function') sbxRender();
}

// —— 预设：复用 deployDefenses / deployFleet，再把生成的引擎对象换算回可编辑的条目 ——
const SBX_EK = { bunker: 'e_mg_bunker', coastal: 'e_coastal_h', arty: 'e_how', mortar: 'e_mortar', aa: 'e_aa' };
const SBX_ROLE = { garrison: 'e_garrison', reserve: 'e_reserve', ambush: 'e_ambush' };
function sbxScratch(fn) {
  const keep = {};
  for (const k of ['enemies', 'mines', 'wire', 'obst', 'trench', 'teams', 'units', 'ships']) { keep[k] = S[k]; S[k] = []; }
  const keepG = S.groups, keepVeh = S.veh;
  S.groups = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [], 9: [] }; S.veh = [];
  try { fn(); } catch (e) { console.error('sandbox preset', e); }
  const out = { enemies: S.enemies, mines: S.mines, wire: S.wire, obst: S.obst, trench: S.trench, teams: S.teams, units: S.units, ships: S.ships, veh: S.veh };
  Object.assign(S, keep); S.groups = keepG; S.veh = keepVeh;
  indexUnits();
  return out;
}
function sbxPresetDef() {
  sbxClear('e');
  const D = DIFF[S.level] || DIFF.hard, O = sbxScratch(() => deployDefenses(rng(S.seed ^ 0x5f3759df), D));
  const add = it => S.sbx.items.push({ id: S.sbx.nid++, side: 'e', ...it });
  for (const e of O.enemies) add({ cat: SBX_EK[e.kind] || 'e_mg_bunker', x: sbxR(e.x), y: sbxR(e.y) });
  for (const m of O.mines) add({ cat: 'e_mines_ap', x: sbxR(m.x), y: sbxR(m.y), r: sbxR(m.r) });
  for (const w of O.wire) add({ cat: 'e_wire', x: sbxR(w.x0), y: sbxR(w.y0), x2: sbxR(w.x1), y2: sbxR(w.y1) });
  for (const o of O.obst) add({ cat: 'e_stakes', x: sbxR(o.x), y: sbxR(o.y), n: 1 });
  for (const t of O.trench) add({ cat: 'e_trench', x: t.pts[0][0], y: t.pts[0][1], pts: t.pts.map(([x, y]) => [sbxR(x), sbxR(y)]) });
  const byU = new Map();
  for (const q of O.teams) { if (!byU.has(q.u)) byU.set(q.u, []); byU.get(q.u).push(q); }
  for (const u of O.units) {
    const ts = byU.get(u.id) || [];
    if (!ts.length) continue;
    add({ cat: SBX_ROLE[u.role] || 'e_garrison', x: sbxR(ts.reduce((a, q) => a + q.x, 0) / ts.length), y: sbxR(ts.reduce((a, q) => a + q.y, 0) / ts.length), n: ts.length });
  }
  const A = typeof A3D === 'object' ? A3D[S.level] || A3D.hard : { cars: 0 }, towns = ['T1', 'T2'].map(ptByKey).filter(Boolean);
  for (let k = 0; k < A.cars && towns.length; k++) { const tw = towns[k % towns.length], s = sbxSnap(tw.x + (k > 1 ? 30 : -20), tw.y - 40); if (s) add({ cat: 'e_car', x: s.x, y: s.y }); }
  for (let k = 0; k < D.waves; k++) add({ cat: 'e_wave', t: Math.round(D.waveEvery * .6 + k * D.waveEvery), n: D.waveSize });
  sbxSync();
  sbxSay('e', `采用「标准布防」（${D.name}）：每处海滩一线设铁丝网、障碍、雷区与碉堡，岬角配岸防重炮，据点各有守备，两镇驻机动预备队。共 ${sbxSpent('e')} 点。`, 'plan');
}
const SBX_VEH_ID = { lt_tank: 'p_lt_tank', tank: 'p_tank', hv_tank: 'p_hv_tank', amtank: 'p_amtank', apc: 'p_apc', spg: 'p_spg', td: 'p_td', aa_veh: 'p_aa_veh', recon: 'p_recon', flame_tank: 'p_flame_tank', mine_tank: 'p_mine_tank' };
function sbxPresetFleet() {
  sbxClear('p');
  const O = sbxScratch(() => deployFleet());
  const add = it => { const o = { id: S.sbx.nid++, side: 'p', ...it }; S.sbx.items.push(o); return o; };
  for (const s of O.ships) {
    const id = s.kind === 'supply' ? 'p_supply' : s.kind === 'lst' ? 'p_lst' : 'p_lct', it = add({ cat: id, x: sbxR(s.x), y: sbxR(s.y), cargo: [], wave: s.kind === 'assault' ? 1 : 2 });
    if (s.kind === 'assault') for (let k = 0; k < (s.load.teams || 0); k++) it.cargo.push('p_rifle');
    if (s.kind === 'lst' && sbxVehOk()) for (const v of (s.load.veh || [])) if (SBX_VEH_ID[v]) it.cargo.push(SBX_VEH_ID[v]);
  }
  if (sbxVehOk()) for (const v of O.veh || []) if (v.side === 'p' && SBX_VEH_ID[v.type] && typeAt(v.x, v.y) === T.DEEP) add({ cat: SBX_VEH_ID[v.type], x: sbxR(v.x), y: sbxR(v.y) });
  add({ cat: 'p_dd', x: W / 2, y: 1720 });
  add({ cat: 'p_cv', x: W / 2, y: CARRIER_Y });
  const wing = typeof AIR_SPEC === 'object' ? AIR_SPEC : { recon: { n: 2 }, strike: { n: 4 }, cas: { n: 4 } };
  for (const [t, id] of [['recon', 'p_air_recon'], ['strike', 'p_air_strike'], ['cas', 'p_air_cas']]) for (let k = 0; k < wing[t].n; k++) add({ cat: id });
  for (let k = 0; k < 3; k++) add({ cat: 'p_reserve' });
  for (let k = 0; k < 2; k++) add({ cat: 'p_rline' });
  for (let k = 0; k < 2; k++) add({ cat: 'p_smoke' });
  sbxSync();
  sbxSay('p', `采用「标准舰队」：两个突击编队各 5 艘登陆艇、3 艘补给舰、驱逐舰与航母联队，登陆舰由自动指挥择滩。共 ${sbxSpent('p')} 点。`, 'plan');
}
function sbxSnap(x, y, cls) {
  x = clamp(x, 10, W - 10); y = clamp(y, 10, H - 10);
  const j = nearestPassable(ci(x, y), cls || 'e');
  if (j < 0) return null;
  const sx = cellCX(j), sy = cellCY(j);
  return sbxLandOk(sx, sy) ? { x: sx, y: sy } : null;
}
