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
const sbxCmd = () => typeof cmdShipTask === 'function';   // 指挥官模块（agent E）在场

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
// 驱逐舰 / 巡洋舰可部署多艘：造价最高的一艘为旗舰（S.dd，玩家可直接操纵舰炮），其余开战后编为护航舰
const sbxFlag = () => sbxOf('dd').reduce((b, it) => !b || sbxCost(it) > sbxCost(b) ? it : b, null);
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
  const repl = s.kind === 'cv' ? sbxOf(s.kind).reduce((a, it) => a + sbxCost(it), 0) : 0;
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
  if (s.kind === 'cv') S.sbx.items = S.sbx.items.filter(it => sbxEntry(it).spawn.kind !== s.kind);   // 航母只有一艘
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
  const dd = sbxFlag(), cv = sbxOf('cv')[0];
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
  sbxFitBudget('e');
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
  sbxFitBudget('p');
  sbxSync();
  const nk = k => O.ships.filter(s => s.kind === k).length, am = sbxOf('veh').filter(it => it.side === 'p').length;
  sbxSay('p', `采用「标准舰队」：登陆艇 ${nk('assault')} 艘分两个突击编队、补给舰 ${nk('supply')} 艘` + (nk('lst') ? `、坦克登陆舰 ${nk('lst')} 艘` : '') + (am ? `、两栖坦克 ${am} 辆` : '') + `，驱逐舰与航母联队支援，登陆舰由自动指挥择滩。共 ${sbxSpent('p')} 点。`, 'plan');
}
// 预设可能超出当前预算：按 250 取整抬高预算
function sbxFitBudget(side) {
  const sp = sbxSpent(side);
  if (sp > S.sbx.budget[side]) S.sbx.budget[side] = Math.min(6000, Math.ceil(sp / 250) * 250);
}
function sbxSnap(x, y, cls) {
  x = clamp(x, 10, W - 10); y = clamp(y, 10, H - 10);
  const j = nearestPassable(ci(x, y), cls || 'e');
  if (j < 0) return null;
  const sx = cellCX(j), sy = cellCY(j);
  return sbxLandOk(sx, sy) ? { x: sx, y: sy } : null;
}

// ———————————————— 高级指挥官：AI 帮我部署 ————————————————
// 只读公开地形（海滩、出口、指挥所、城镇、桥梁、高程、河流）；进攻方看不到守军部署
function sbxCross(x0, y0, x1, y1) {   // 直线路径上需要渡河的次数
  let n = 0;
  for (let k = 0; k < TER.rivers.length; k++) {
    let last = null;
    for (let s = 0; s <= 40; s++) {
      const x = lerp(x0, x1, s / 40), y = lerp(y0, y1, s / 40), rx = riverX(k, Math.floor(y / CELL));
      if (rx < -1e8) { last = null; continue; }
      const sg = Math.sign(x - rx);
      if (last != null && sg !== last && sg !== 0) n++;
      if (sg) last = sg;
    }
  }
  return n;
}
function sbxBeaches() {
  const hq = ptByKey('HQ') || S.points[0], towns = ['T1', 'T2'].map(ptByKey).filter(Boolean), bats = ['BT', 'BT2'].map(ptByKey).filter(Boolean);
  return TER.beaches.map((b, i) => {
    const ex = ptByKey('E' + (i + 1)) || { x: b.cx, y: coastAt(b.cx) - 50, name: b.name + '出口', key: 'E' + (i + 1) }, w = b.x1 - b.x0;
    const tw = towns.slice().sort((a, c) => dist(a.x, a.y, ex.x, ex.y) - dist(c.x, c.y, ex.x, ex.y))[0] || hq;
    let cliff = 0;
    for (let x = b.x0 - 450; x <= b.x1 + 450; x += 20) if (x > 0 && x < W && typeAt(x, coastAt(x) - 10) === T.CLIFF) cliff++;
    return { b, i, ex, w, hq, dHQ: dist(ex.x, ex.y, hq.x, hq.y), tw, dTown: dist(tw.x, tw.y, ex.x, ex.y), cross: sbxCross(ex.x, ex.y, hq.x, hq.y),
      bat: bats.filter(p => dist(p.x, p.y, b.cx, coastAt(b.cx)) < 650), cliff };
  });
}
const sbxM = d => Math.round(d / 10) * 10;
const sbxNm = arr => arr.map(B => B.b.name).join('、');
function sbxTry(id, x, y, r, extra) {
  for (let k = 0; k < 26; k++) {
    const a = k * 2.4, d = k ? 4 + k * (r ?? 50) / 26 : 0, res = sbxPlace(id, x + Math.cos(a) * d, y + Math.sin(a) * d * .8, null, null, extra);
    if (res.ok) return res.it;
    if (/预算|未加载|航母/.test(res.why || '')) return null;
  }
  return null;
}
function sbxLineTry(id, x0, y0, x1, y1) { const r = sbxPlace(id, x0, y0, x1, y1); return r.ok ? r.it : null; }
// 沿海岸曲线分段放置线状工事：yOff 为相对海岸线的高度（负 = 内陆）
function sbxAlong(id, xa, xb, yOff, seg, gapX, gapW) {
  let n = 0;
  for (let x = xa; x < xb - 4; x += seg) {
    let x0 = x, x1 = Math.min(x + seg, xb);
    if (gapX != null && x1 > gapX - gapW && x0 < gapX + gapW) { if (x0 < gapX - gapW) x1 = gapX - gapW; else if (x1 > gapX + gapW) x0 = gapX + gapW; else continue; }
    if (x1 - x0 < 20) continue;
    if (sbxLineTry(id, x0, coastAt(x0) + yOff, x1, coastAt(x1) + yOff)) n++;
  }
  return n;
}

// —— 守方：判断主攻方向 → 主防御地带 → 岸炮 → 反斜面炮兵 → 居中预备队 → 防空 → 警戒 → 守备 ——
function sbxAIDefend() {
  sbxClear('e');
  const B0 = S.sbx.budget.e, k = B0 / SBX_BUDGET, BS = sbxBeaches(), say = (t, at) => sbxSay('e', t, 'plan', at);
  for (const B of BS) B.L = B.w / 190 + 1.6 * (1 - B.dHQ / 2200) + (B.dTown < 650 ? .5 : 0) - .45 * B.cross - .25 * B.bat.length + (Math.random() - .5) * .25;
  const ord = BS.slice().sort((a, b) => b.L - a.L), nMain = B0 >= 2400 ? 3 : 2, main = ord.slice(0, nMain), rest = ord.slice(nMain);
  const b1 = main[0], dest = B => B.dHQ < 900 ? '指挥所' : B.tw.name;
  say(`判断：${b1.b.name}宽约 ${sbxM(b1.w)} 米，出口道路直通${dest(b1)}，距指挥所约 ${sbxM(b1.dHQ)} 米，最可能是敌主攻方向；${sbxNm(main.slice(1))}次之。` +
    (rest.length ? `${sbxNm(rest)}${rest.some(B => B.cross) ? '登陆后需渡河' : '离要地较远'}，登陆价值低。` : ''), b1.ex);
  // 1. 主防御地带核心
  const belt = (B, rich) => {
    const b = B.b, cx = b.cx, cy = coastAt(cx);
    sbxTry('e_mg_bunker', lerp(b.x0, b.x1, .2), coastAt(lerp(b.x0, b.x1, .2)) - 50, 40);
    sbxTry('e_mg_bunker', lerp(b.x0, b.x1, .8), coastAt(lerp(b.x0, b.x1, .8)) - 50, 40);
    sbxAlong(rich ? 'e_wire2' : 'e_wire', b.x0 - 10, b.x1 + 10, -26, 80, cx, 22);
    for (let x = b.x0 + 30; x <= b.x1 - 20; x += 62) sbxTry(rich ? 'e_hedgehog' : 'e_stakes', x, coastAt(x) + 28, 14);
    sbxTry('e_mines_ap', cx, cy - 28, 14);
    sbxAlong('e_trench', b.x0 - 20, b.x1 + 20, -64, 120);
    sbxTry('e_ambush', cx, cy - 64, 24);
  };
  belt(main[0], true); belt(main[1], k >= 1.3);
  say(`决心：在${sbxNm(main.slice(0, 2))}构筑主防御地带——出口两侧各一座机枪碉堡，射界在出口前交叉；滩顶拉铁丝网，水际布障碍，出口缺口埋雷；堑壕内伏击组待敌上滩到 80 米内再开火。`, b1.ex);
  // 2. 岸防炮：岬角与高地，覆盖主攻滩头的接近航道
  const sites = [];
  for (const p of ['BT', 'BT2'].map(ptByKey).filter(Boolean)) sites.push({ x: p.x, y: p.y, bonus: 1.2, name: p.name });
  for (let x = 40; x < W - 40; x += 20) for (const d of [45, 80, 130, 190, 260]) {
    const y = coastAt(x) - d;
    if (!sbxLandOk(x, y)) continue;
    const t = typeAt(x, y);
    sites.push({ x, y, bonus: (t === T.CLIFF || t === T.HILL || t === T.MOUNT ? .5 : 0) + elevAt(x, y) * 3 });
  }
  for (const s of sites) {
    s.sc = s.bonus;
    for (const B of BS) { const d = dist(s.x, s.y, B.b.cx, coastAt(B.b.cx) + 160); if (d < 600) s.sc += main.includes(B) ? 1.3 : .3; }
    if (BS.some(B => Math.abs(s.x - B.b.cx) < 150 && coastAt(s.x) - s.y < 120)) s.sc -= 1.6;
  }
  sites.sort((a, b) => b.sc - a.sc);
  const guns = [], nGun = clamp(Math.round(2 * k), 1, 5);
  for (const s of sites) {
    if (guns.length >= nGun) break;
    if (guns.some(g => dist(g.x, g.y, s.x, s.y) < 380)) continue;
    const it = sbxTry(guns.length === 0 ? (k >= 1.6 ? 'e_coastal_r' : 'e_coastal_h') : guns.length === 1 ? 'e_coastal_h' : 'e_coastal_m', s.x, s.y, 30);
    if (it) guns.push(it);
  }
  if (guns.length) {
    const cov = BS.filter(B => guns.some(g => dist(g.x, g.y, B.b.cx, coastAt(B.b.cx) + 160) < 600));
    say(`岸防炮：${guns.length} 门配置于岬角 / 高地（最高处高程 ${Math.round(Math.max(...guns.map(g => elevAt(g.x, g.y))) * 100)}），射界覆盖${sbxNm(cov) || '近岸航道'}的接近航道；重炮射程 600，可威胁驱逐舰与航母。`, guns[0]);
  }
  // 3. 炮兵：距岸 480–760 的山脊反斜面
  const arts = [];
  for (let x = 120; x < W - 120; x += 30) for (let d = 480; d <= 760; d += 40) {
    const y = coastAt(x) - d;
    if (y < 40 || !sbxLandOk(x, y) || !(TP[typeAt(x, y)].sp > 0) || typeAt(x, y) === T.TOWN) continue;
    const slope = elevAt(x, y + 70) - elevAt(x, y), cov = main.filter(B => dist(x, y, B.b.cx, coastAt(B.b.cx)) < 1000).length;
    arts.push({ x, y, d, sc: clamp(slope, -.1, .3) * 12 + cov * 1.2 + (Math.random() - .5) * .3 });
  }
  arts.sort((a, b) => b.sc - a.sc);
  const art = [], nArt = clamp(Math.round(2 * k), 1, 6);
  for (const a of arts) {
    if (art.length >= nArt) break;
    if (art.some(o => dist(o.x, o.y, a.x, a.y) < 170)) continue;
    const it = sbxTry(art.length === 2 && k >= 1.2 ? 'e_rkt' : art.length === 3 ? 'e_hhow' : 'e_how', a.x, a.y, 30);
    if (it) { it.d = a.d; art.push(it); }
  }
  if (art.length) say(`炮兵：${art.length} 个炮兵阵地设在距岸约 ${sbxM(art.reduce((s, a) => s + a.d, 0) / art.length)} 米的山脊反斜面，避开舰炮直瞄，射程仍覆盖${sbxNm(main)}与泊地；打几轮就转移。`, art[0]);
  for (const a of art) delete a.d;
  // 4. 机动预备队：选到各主攻滩头最远距离最小的镇子 / 路口
  const cands = ['T1', 'T2', 'X1', 'X2', 'HQ'].map(ptByKey).filter(Boolean);
  const cost = p => Math.max(...main.slice(0, 2).map(B => dist(p.x, p.y, B.ex.x, B.ex.y) + 280 * sbxCross(p.x, p.y, B.ex.x, B.ex.y)));
  const hub = cands.sort((a, b) => cost(a) - cost(b))[0] || BS[0].hq;
  sbxTry('e_reserve', hub.x, hub.y - 30, 40);
  let armor = '';
  if (sbxVehOk() && typeof VEH_SPEC === 'object' && VEH_SPEC.tank) { if (sbxTry('e_tank', hub.x + 25, hub.y - 50, 50)) armor = '中型坦克'; }
  else if (sbxTry('e_car', hub.x + 25, hub.y - 50, 50)) armor = '装甲车';
  say(`预备队：机动预备队集结于${hub.name}，到${main[0].b.name}约 ${sbxM(dist(hub.x, hub.y, main[0].ex.x, main[0].ex.y))} 米、到${main[1].b.name}约 ${sbxM(dist(hub.x, hub.y, main[1].ex.x, main[1].ex.y))} 米，居中可两面驰援${armor ? '；配属' + armor : ''}。判明敌主攻方向后再整体投入，不零敲碎打。`, hub);
  // 5. 指挥所守备、防空
  const hq = BS[0].hq;
  sbxTry('e_garrison', hq.x, hq.y + 20, 40);
  const aaAt = [{ x: hq.x + 40, y: hq.y + 35 }, ...guns.slice(0, 2).map(g => ({ x: g.x + 40, y: g.y - 40 })), ...(art.length ? [{ x: art[0].x - 40, y: art[0].y - 20 }] : [])];
  let nAA = 0;
  for (const p of aaAt.slice(0, clamp(Math.round(2 * k), 1, 4))) if (sbxTry(nAA === 0 && k >= 1.5 ? 'e_aa_radar' : 'e_aa', p.x, p.y, 40)) nAA++;
  if (nAA) say(`防空：指挥所与岸炮、炮兵阵地配高炮 ${nAA} 门，防敌舰载机先拔岸炮、再炸预备队。`, hq);
  // 6. 主攻滩头加强：反坦克炮、迫击炮、出口机枪班、反坦克雷、探照灯
  for (const B of main.slice(0, 2)) {
    const cx = B.b.cx, cy = coastAt(cx);
    sbxTry('e_at_casemate', cx + 45, cy - 88, 30);
    sbxTry('e_mortar', cx - 50, cy - 170, 40);
    sbxTry('e_mg_nest', B.ex.x, B.ex.y - 12, 30);
    sbxTry('e_mines_at', cx, cy - 95, 20);
    if (B === main[0]) sbxTry('e_slight', cx + 70, cy - 72, 30);
  }
  // 7. 次要滩头：警戒分队
  const scr = [];
  for (const B of rest) { const cx = B.b.cx, cy = coastAt(cx); if (sbxTry('e_pillbox', cx, cy - 48, 40)) scr.push(B); sbxTry('e_ambush', cx + 30, cy - 62, 30); }
  if (scr.length) say(`${sbxNm(scr)}只留警戒：各一座小碉堡加伏击组，发现登陆立即报告、迟滞，等预备队赶到。`, scr[0].ex);
  // 8. 纵深：第三处主防地带、更多炮兵、观察哨、雷达、反击连、桥梁守备、假目标
  if (main[2]) belt(main[2], false);
  const hi = sites.filter(s => coastAt(s.x) - s.y > 120 && Math.abs(s.x - b1.b.cx) < 500).sort((a, b) => elevAt(b.x, b.y) - elevAt(a.x, a.y))[0];
  if (hi && sbxTry('e_op', hi.x, hi.y, 30)) say(`观察哨设在${b1.b.name}侧后高地，为炮兵与岸炮指示目标。`, hi);
  const rd = ptByKey('RD');
  if (rd) sbxTry('e_radar', rd.x, rd.y + 15, 30);
  sbxTry('e_assault', hub.x - 30, hub.y - 40, 50);
  for (const p of ['B1', 'B2', 'B3', 'BT', 'BT2', 'RD'].map(ptByKey).filter(Boolean)) sbxTry('e_garrison', p.x, p.y + 15, 40, { n: 2 });
  if (main[1]) { sbxTry('e_decoy', main[1].b.cx - 60, coastAt(main[1].b.cx) - 120, 40); }
  if (guns[0]) sbxTry('e_decoy', guns[0].x - 70, guns[0].y - 30, 40);
  if (sbxLeft('e') > 60) { sbxTry('e_wave', 0, 0); }
  // 9. 余款：出口补雷、补碉堡、据点守备
  for (let pass = 0; pass < 3 && sbxLeft('e') >= 15; pass++) for (const B of main) {
    const cx = B.b.cx, cy = coastAt(cx);
    if (pass === 0) sbxTry('e_pillbox', cx + (Math.random() - .5) * 60, cy - 110, 40);
    else if (pass === 1) sbxTry('e_mines_mx', B.b.x0 + 20, coastAt(B.b.x0 + 20) - 36, 20);
    else sbxTry('e_mines_ap', B.b.x1 - 20, coastAt(B.b.x1 - 20) - 36, 20);
  }
  for (const p of S.points) if (sbxLeft('e') >= 12 && !S.sbx.items.some(it => it.side === 'e' && sbxEntry(it).spawn.kind === 'einf' && dist(it.x, it.y, p.x, p.y) < 90)) sbxTry('e_militia', p.x, p.y + 10, 40, { n: 2 });
  sbxSync();
  say(`部署完毕：共 ${S.sbx.items.filter(it => it.side === 'e').length} 项，用去 ${sbxSpent('e')} / ${B0} 点。`, null);
  return main.map(B => B.b.name);
}

// —— 攻方：判读地形 → 选主攻与佯攻 → 编成三个梯队与火力、航空、保障 → 集结海域对位展开并预定登陆点 ——
function sbxSea(x, y) {
  for (let k = 0; k < 30; k++) {
    const a = k * 2.4, d = k * 6, sx = clamp(x + Math.cos(a) * d, 30, W - 30), sy = clamp(y + Math.sin(a) * d * .6, STAGING_Y - 90, H - 30);
    if (typeAt(sx, sy) === T.DEEP && !S.sbx.items.some(it => it.side === 'p' && it.x != null && sbxEntry(it).spawn.at === 'sea' && dist(it.x, it.y, sx, sy) < 18)) return { x: sx, y: sy };
  }
  return { x, y };
}
function sbxAIAttack() {
  sbxClear('p');
  const B0 = S.sbx.budget.p, k = B0 / SBX_BUDGET, BS = sbxBeaches(), say = (t, at) => sbxSay('p', t, 'plan', at), veh = sbxVehOk();
  for (const B of BS) B.A = B.w / 190 + 1.4 * (1 - B.dHQ / 2200) + (B.dTown < 650 ? .4 : 0) - .4 * B.cross - .6 * B.bat.length - .015 * B.cliff + (Math.random() - .5) * .2;
  const ord = BS.slice().sort((a, b) => b.A - a.A), M = ord[0];
  const far = ord.filter(B => Math.abs(B.b.cx - M.b.cx) > 650);
  const F = far.sort((a, b) => (b.A + (b.tw !== M.tw ? .5 : 0)) - (a.A + (a.tw !== M.tw ? .5 : 0)))[0] || ord[1];
  const risky = BS.filter(B => B.bat.length && B !== M);
  say(`判断：守军部署不明，只能从地形判读。${M.b.name}宽约 ${sbxM(M.w)} 米，出口道路直通${M.dHQ < 900 ? '指挥所' : M.tw.name}，距指挥所约 ${sbxM(M.dHQ)} 米，${M.cross ? '途中需过河' : '无需渡河'}` +
    (risky.length ? `；${sbxNm(risky)}紧邻岬角炮台，正面强攻代价大。` : '。'), M.ex);
  if (F) say(`决心：主攻${M.b.name}，佯攻${F.b.name}。理由：${M.b.name}正面宽、纵深直通目标；${F.b.name}距主攻方向约 ${sbxM(Math.abs(F.b.cx - M.b.cx))} 米，佯攻可牵制${F.tw.name}方向守军预备队，使其不敢全力增援主攻方向。`, F.ex);
  const plan = (B, i, n, sp) => { const x = clamp(B.b.cx + (i - (n - 1) / 2) * (sp || 26), B.b.x0 + 12, B.b.x1 - 12); return { x: sbxR(x), y: sbxR(coastAt(x) - 20) }; };
  const ship = (id, B, i, n, row, cargo, wave, dx) => {
    const p = sbxSea(B.b.cx + (dx || 0) + (i - (n - 1) / 2) * 34, (row || 1580) + (i % 2) * 36), r = sbxPlace(id, p.x, p.y);
    if (!r.ok) return null;
    r.it.plan = plan(B, i, n); r.it.wave = wave || 1;
    for (const c of cargo || []) { const cc = catalogById(c); if (cc && (cc.spawn.kind !== 'veh' || veh) && sbxLeft('p') >= cc.cost) r.it.cargo.push(c); }
    sbxSync();
    return r.it;
  };
  // 1. 第一波主攻：突击登陆艇（陆战、工兵、爆破、机枪、观察）
  const LOADS = [['p_marine', 'p_marine', 'p_mg', 'p_eng', 'p_demo'], ['p_marine', 'p_rifle', 'p_mg', 'p_eng', 'p_fo'], ['p_rifle', 'p_marine', 'p_mg', 'p_at', 'p_flame'],
    ['p_ranger', 'p_ranger', 'p_rifle', 'p_mg', 'p_medic'], ['p_rifle', 'p_rifle', 'p_mg', 'p_mortar', 'p_hq'], ['p_marine', 'p_rifle', 'p_sniper', 'p_eng', 'p_mg']];
  const nW1 = clamp(Math.round(4.2 * k), 3, 8), w1 = [];
  for (let i = 0; i < nW1; i++) { const it = ship('p_lct', M, i, nW1, 1580, LOADS[i % LOADS.length], 1); if (it) w1.push(it); }
  // 2. 火力支援舰
  const ddId = B0 >= 2600 ? 'p_cl' : B0 >= 1100 ? 'p_dd' : B0 >= 700 ? 'p_dd_e' : null;
  let dd = null;
  if (ddId) { const p = sbxSea(M.b.cx + 140, 1650); const r = sbxPlace(ddId, p.x, p.y); if (r.ok) { dd = r.it; dd.plan = { x: sbxR(M.b.cx + 90), y: sbxR(coastAt(M.b.cx) + 430) }; } }
  // 3. 补给舰（第二波）
  const sup = [];
  { const it = ship('p_supply', M, 0, 2, 1720, null, 2, -40); if (it) sup.push(it); }
  sbxTry('p_sortie_recon', M.ex.x, M.ex.y - 60, 30);
  // 4. 航母与舰载机：侦察优先、对地支援为主
  const cvId = B0 >= 1300 ? 'p_cv' : B0 >= 800 ? 'p_cve' : null;
  let cv = null, air = { recon: 0, cas: 0, strike: 0 };
  if (cvId) { const p = sbxSea(clamp(M.b.cx, 200, W - 200), CARRIER_Y - 20); const r = sbxPlace(cvId, p.x, Math.max(p.y, STAGING_Y + 60)); if (r.ok) cv = r.it; }
  const buyAir = (id, t) => { if (sbxPlace(id).ok) { air[t]++; return true; } return false; };
  if (cv) { buyAir('p_air_recon', 'recon'); buyAir('p_air_cas', 'cas'); buyAir('p_air_cas', 'cas'); if (k >= 1) buyAir('p_air_recon_lr', 'recon'); }
  // 5. 两栖坦克、火箭艇、扫雷舰
  let nAm = 0;
  if (veh && typeof VEH_SPEC === 'object' && VEH_SPEC.amtank) for (let i = 0; i < clamp(Math.round(2.4 * k), 1, 5); i++) {
    const p = sbxSea(M.b.cx + (i - 1) * 40, 1545), r = sbxPlace(i % 2 && k >= 1.2 ? 'p_amtank_how' : 'p_amtank', p.x, p.y);
    if (r.ok) { r.it.plan = plan(M, i, 3, 40); nAm++; }
  }
  const rk = B0 >= 1100 ? ship('p_rocket', M, 0, 1, 1550, null, 1, -110) : null;
  const sw = B0 >= 950 ? ship('p_sweep', M, 0, 1, 1540, null, 1, 110) : null;
  // 6. 佯攻：两艘小艇
  const feint = [];
  if (F) for (let i = 0; i < 2; i++) { const it = ship(k >= 1.2 ? 'p_lct' : 'p_lcvp', F, i, 2, 1600, ['p_rifle', 'p_mg', 'p_rifle'], 1); if (it) feint.push(it); }
  // 7. 第二波：坦克登陆舰（或步兵登陆舰）、第二艘补给舰
  const w2 = [];
  const nL = B0 >= 2200 ? 2 : B0 >= 1250 ? 1 : 0;
  for (let i = 0; i < nL; i++) {
    const it = veh ? ship('p_lst', M, i, nL, 1760, i ? ['p_tank', 'p_apc', 'p_spg'] : ['p_tank', 'p_tank76', 'p_apc'], 2, 60) :
      ship('p_lci', M, i, nL, 1760, ['p_rifle', 'p_rifle', 'p_rifle', 'p_mg', 'p_at', 'p_medic', 'p_mortar', 'p_rifle'], 2, 60);
    if (it) w2.push(it);
  }
  if (!veh && nL === 0 && B0 >= 1000) { const it = ship('p_lci', M, 0, 1, 1760, ['p_rifle', 'p_rifle', 'p_mg', 'p_at', 'p_medic', 'p_rifle', 'p_mg', 'p_rifle'], 2, 60); if (it) w2.push(it); }
  { const it = ship('p_supply', M, 1, 2, 1720, null, 2, -40); if (it) sup.push(it); }
  // 8. 保障与追加航空兵
  let smoke = 0;
  if (dd) for (let i = 0; i < (k >= 1.3 ? 2 : 1); i++) if (sbxPlace('p_smoke').ok) smoke += 3;
  const relay = B0 >= 1150 && sbxPlace('p_relay').ok;
  if (cv) { buyAir('p_air_strike', 'strike'); if (k >= 1) buyAir(k >= 1.3 ? 'p_air_dive' : 'p_air_strike', 'strike'); buyAir('p_air_cas', 'cas'); }
  const depot = B0 >= 1400 && sbxPlace('p_depot').ok;
  if (B0 >= 1600) { sbxPlace('p_reserve'); sbxPlace('p_rline'); }
  if (B0 >= 1800) sbxTry('p_sortie_naval', M.ex.x, M.ex.y, 30);
  if (cv && B0 >= 2000) { sbxPlace('p_deck'); buyAir('p_air_heli', 'cas'); buyAir('p_air_heavy', 'strike'); }
  // 余款：主攻登陆艇补满、追加一艘步兵登陆舰
  for (const it of w1) for (const c of ['p_rifle', 'p_mg', 'p_eng']) { const cap = sbxShipCap(it), ld = sbxShipLoad(it); if (ld.t < cap.t && sbxLeft('p') >= 14) it.cargo.push(c); }
  if (sbxLeft('p') >= 100) { const it = ship('p_lci', M, 1, 2, 1640, ['p_rifle', 'p_rifle', 'p_mg', 'p_marine', 'p_at', 'p_eng', 'p_medic', 'p_rifle'], 1, -90); if (it) w1.push(it); }
  sbxSync();
  const men = w1.reduce((a, it) => a + sbxShipLoad(it).t, 0) * 3;
  say(`第一波：${w1.length} 艘突击登陆艇载陆战突击组、工兵、爆破组与机枪组约 ${men} 人` + (nAm ? `，${nAm} 辆两栖坦克随波泅渡` : '') + (sw ? '，扫雷舰先行清除水际障碍' : '') + (rk ? '，火箭艇抢滩前齐射压制滩头' : '') + '。', M.ex);
  if (w2.length || sup.length) say(`第二波：${w2.length ? (veh ? '坦克登陆舰' : '步兵登陆舰') + ' ' + w2.length + ' 艘与' : ''}补给舰 ${sup.length} 艘在集结海域待命，滩头出口夺取后（最迟 H+2.5 分钟）再靠岸，避免在泊地挤成靶子。`, null);
  if (dd || cv) say(`火力：${dd ? sbxEntry(dd).name + '前出至' + M.b.name + '外海直接支援' : '无舰炮支援'}；${cv ? `${sbxEntry(cv).name}编 ${air.recon} 架侦察机先行照相、${air.cas} 架对地支援机随叫随到、${air.strike} 架攻击机专打已标定炮位` : '无航空兵'}。`, dd || cv);
  const sup2 = [relay && '无线电中继减少通讯中断', '战前对' + M.b.name + '出口照相侦察', depot && '预置野战补给站加快向纵深推进', smoke && `烟幕弹 ${smoke} 发掩护抢滩`].filter(Boolean);
  say(`保障：${sup2.join('；')}。部署完毕，共用去 ${sbxSpent('p')} / ${B0} 点。`, null);
  return { main: M.b.name, feint: F && F.b.name };
}

// ———————————————— 开战：条目 → 引擎对象 ————————————————
const sbxNearPt = (x, y, f) => S.points.filter(f || (() => true)).sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y))[0] || S.points[0];
const sbxPerp = (x0, y0, x1, y1) => { const l = dist(x0, y0, x1, y1) || 1, nx = -(y1 - y0) / l, ny = (x1 - x0) / l; return ny > 0 ? [-nx, -ny] : [nx, ny]; };   // 指向北（内陆）的法向
function sbxSpot(x, y, cls) { if (passInf(x, y)) return { x, y }; const j = nearestPassable(ci(x, y), cls || 'e'); return j < 0 ? { x, y } : { x: cellCX(j), y: cellCY(j) }; }
const SBX_LBL = {};
// 堑壕折线：两点连线按型号加折（之字形折幅更大）
function sbxTrenchPts(it, s) {
  if (it.pts) return it.pts;
  const x = it.x, y = it.y, [nx, ny] = sbxPerp(x, y, it.x2, it.y2), st = s.zz ? 26 : 22, n = Math.max(1, Math.round(dist(x, y, it.x2, it.y2) / st)), a = s.zz ? 12 : 6, pts = [];
  for (let k = 0; k <= n; k++) { const o = (k % 2 ? 1 : -1) * (k && k < n ? a : 0); pts.push([lerp(x, it.x2, k / n) + nx * o, lerp(y, it.y2, k / n) + ny * o]); }
  return pts;
}

function sbxSpawn(it, role, acc) {
  const c = sbxEntry(it);
  if (!c) return;
  const s = c.spawn, x = it.x, y = it.y;
  if (s.kind === 'enemy') {
    const e = addEnemy(s.ek, x, y);
    e.hp = e.maxhp = Math.max(1, Math.round(ENEMY_SPEC[s.ek].hp * (s.hp || 1)));
    if (s.mod) e.mod = { ...s.mod };
    Object.assign(e, { name: c.name, cat: c.id }, s.vis ? { sbxVis: { ...s.vis } } : {}, s.decoy ? { decoy: true } : {});
  } else if (s.kind === 'mine') {
    const r = it.r || s.r, n = s.n || 1;
    for (let k = 0; k < n; k++) S.mines.push({ id: S.nid++, x: x + (k - (n - 1) / 2) * r * 1.25, y: y + (k % 2 ? -r * .35 : 0), r, known: false, clr: s.clr || 0, ...(s.at2 ? { at: true } : {}) });
  } else if (s.kind === 'wire') {
    const [nx, ny] = sbxPerp(x, y, it.x2, it.y2), L = dist(x, y, it.x2, it.y2), n = Math.max(1, Math.ceil(L / 40));
    for (let row = 0; row < (s.rows || 1); row++) for (let k = 0; k < n; k++) {
      const o = row * 9;
      S.wire.push({ id: S.nid++, x0: lerp(x, it.x2, k / n) + nx * o, y0: lerp(y, it.y2, k / n) + ny * o, x1: lerp(x, it.x2, (k + 1) / n) + nx * o, y1: lerp(y, it.y2, (k + 1) / n) + ny * o, known: false, cut: false, ...(s.prog ? { prog: s.prog } : {}) });
    }
  } else if (s.kind === 'obst') {
    const n = it.n ?? s.n;
    for (let k = 0; k < n; k++) S.obst.push({ id: S.nid++, x: x + (k - (n - 1) / 2) * (s.sp || 14) + gauss() * 2, y: y + gauss() * 3, known: false, dead: false });
  } else if (s.kind === 'trench') {
    const pts = sbxTrenchPts(it, s);
    S.trench.push({ id: S.nid++, pts, known: false });
    if (s.ditch) for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], m = Math.max(1, Math.round(dist(x0, y0, x1, y1) / 14));
      for (let j = 0; j < m; j++) S.obst.push({ id: S.nid++, x: lerp(x0, x1, j / m), y: lerp(y0, y1, j / m) + 5, known: false, dead: false, ditch: true });
    }
  } else if (s.kind === 'post') {
    S.sbxObs.push({ id: S.nid++, kind: c.id, name: c.name, x, y, r: s.r, h: s.h, hp: s.hp, maxhp: s.hp, dead: false, kx: null, ky: null, ammo: !!s.ammo });
  } else if (s.kind === 'einf') {
    const role = s.role, p = role === 'ambush' ? sbxNearPt(x, y, p => /^E\d/.test(p.key)) : sbxNearPt(x, y), n = it.n ?? s.teams;
    const u = addUnit('e', 'inf', { role, obj: p.key });
    if (s.morale) u.morale = s.morale;
    for (let k = 0; k < n; k++) {
      const a = k / Math.max(1, n) * 6.283 + .4, rr = n > 1 ? 9 + n * 2.5 : 0, sp = sbxSpot(x + Math.cos(a) * rr, y + Math.sin(a) * rr * .8);
      addTeam('e', sp.x, sp.y, s.men, { role, obj: p.key, u: u.id, ...(role === 'ambush' ? { hold: true } : {}), ...(s.mod ? { mod: { ...s.mod } } : {}), ...(s.tag ? { sbxTag: s.tag } : {}), cat: c.id });
    }
  } else if (s.kind === 'car') {
    const home = sbxNearPt(x, y, p => ['T1', 'T2', 'HQ', 'X1', 'X2'].includes(p.key));
    S.armor.push({ id: S.nid++, x, y, heading: SOUTH, aim: SOUTH, hp: 30, maxhp: 30, cd: 1 + Math.random(), order: null, dead: false, kx: null, ky: null, kh: null, seen: -99,
      px: x, py: y, home: home.key, mode: 'park', moving: false, think: Math.random() * 2, fireT: -99, hitT: -99, hurt: false, deadT: null });
  } else if (s.kind === 'veh') {
    if (!sbxVehOk()) return;
    const v = addVehicle(c.side, s.type, x, y, { auto: true });
    if (!v) return;
    if (s.mod) v.mod = { ...(v.mod || {}), ...s.mod };
    Object.assign(v, { sbxV: c.id }, s.tag ? { sbxTag: s.tag } : {}, it.plan ? { plan: { ...it.plan } } : {});
  } else if (s.kind === 'ship') {
    const lst = s.ship === 'lst', kind = lst && !SHIP_SPEC.lst ? 'supply' : s.ship, pre = s.pre || 'LA';
    SBX_LBL[pre] = (SBX_LBL[pre] || 0) + 1;
    const sh = addShip(kind, x, y, pre + '-' + SBX_LBL[pre]), ld = sbxShipLoad(it);
    sh.hp = sh.maxhp = s.hp || sh.maxhp;
    const inf = (it.cargo || []).filter(id => { const k = catalogById(id); return k && k.spawn.kind === 'cargo'; });
    const vs = (it.cargo || []).map(catalogById).filter(k => k && k.spawn.kind === 'veh' && sbxVehOk());
    if (s.ship === 'supply') sh.load = { teams: s.teams, eng: s.eng };
    else sh.load = { teams: inf.length, eng: 0, ...(lst ? { veh: vs.map(k => k.spawn.type) } : {}) };
    if (inf.length) sh.sbxCargo = inf;
    if (vs.length) sh.sbxVeh = vs.map(k => ({ id: k.id, type: k.spawn.type, mod: k.spawn.mod || null, tag: k.spawn.tag || null }));
    if (s.role) { Object.assign(sh, { sbxRole: s.role, load: { teams: 0, eng: 0 } }); if (it.plan) sh.sbxTgt = { x: it.plan.x }; }
    else if (role === 'spectate' && (it.wave || 1) > 1) {
      // 观战第二波：有指挥官（commander.js）时不预定登陆点，由其按梯队待命、择机投入；否则由本模块扣留到出口夺取
      if (!sbxCmd()) Object.assign(sh, { sbxPlan: it.plan ? { ...it.plan } : null, sbxHold: true, auto: false });
    } else if (it.plan) sh.plan = { ...it.plan };
    if (kind === 'assault') sh.form = 'wedge';
    S.groups[s.role ? 5 : kind === 'supply' ? 3 : lst ? 4 : (it.wave || 1) > 1 ? 2 : 1].push(sh.id);
    sh.cat = c.id;
  } else if (s.kind === 'wing') acc.wing.push({ id: S.nid++, type: s.type, state: 'deck', rearmT: 0, ...(s.v ? { v: s.v } : {}) });
  else if (s.kind === 'asset') S.assets[s.key] = (S.assets[s.key] || 0) + s.add;
  else if (s.kind === 'flag') { if (s.key === 'relay') S.relay = true; else S.sbxRun[s.key] = true; }
  else if (s.kind === 'sortie') S.sbxRun.sorties.push({ k: s.t, x, y, n: s.n || 0, r: s.r || 0, at: s.t === 'naval' ? 3 : s.t === 'bomb' ? 4 : .5, done: false });
  else if (s.kind === 'ewave') { S.sbxRun.waves.push({ t: it.t ?? s.t + 60 * acc.waves, n: it.n ?? s.teams, done: false }); acc.waves++; }
}

function sbxBuild(role) {
  const SB = S.sbx;
  for (const k of ['enemies', 'mines', 'wire', 'obst', 'trench', 'teams', 'units', 'ships', 'supply', 'rlines', 'boats', 'shells', 'fx', 'smoke', 'planes', 'recon', 'craters', 'pings']) S[k] = [];
  S.groups = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [], 9: [] }; S.sel = [];
  S.armor = []; S.raids = []; S.blown = []; S.autoPlan = {}; S.relay = false; S.snet = undefined;
  if (sbxVehOk()) S.veh = [];
  S.sbxObs = [];
  S.sbxRun = { waves: [], sorties: [], depot: false, deck: false, aaT: 0, tagT: 0, waveT: 0, ddPrev: 0, said: {} };
  S.assets = { recon: 0, strike: 0, cas: 0, rline: 1, reserve: 0, smoke: 0 };
  S.points.forEach(p => { p.owner = 'e'; p.prog = 0; p.contested = false; });
  for (const k in SBX_LBL) delete SBX_LBL[k];
  UNIT_MAP = new Map();
  const acc = { wing: [], waves: 0 };
  // 守方先建（守备队士气取决于难度）
  const items = SB.items.slice().sort((a, b) => (a.side === 'e' ? 0 : 1) - (b.side === 'e' ? 0 : 1));
  for (const it of items) { try { sbxSpawn(it, role, acc); } catch (e) { console.error('sandbox spawn ' + it.cat, e); } }
  const ddI = sbxFlag(), cvI = sbxOf('cv')[0];
  if (ddI) {
    const s = sbxEntry(ddI).spawn;
    Object.assign(S.dd, { x: ddI.x, y: ddI.y, tx: ddI.x, ty: ddI.y, hull: s.hull, state: 'ready', cool: 0, repairT: 0, repairDur: s.rep || 16, auto: role === 'spectate', exposedUntil: 0, moving: false,
      mod: { rof: s.rof || 1, salvo: s.salvo || 1, hit: s.hit || 1 }, name: sbxEntry(ddI).name, plan: ddI.plan ? { ...ddI.plan } : null });
    S.assets.smoke += 2 + (s.smoke || 0);
  } else Object.assign(S.dd, { x: -9999, y: H + 9999, tx: -9999, ty: H + 9999, hull: 0, state: 'sunk', moving: false, auto: false, plan: null, mod: null });
  // 护航舰：自动前出到滩头外海，对已发现的目标实施舰炮火力支援（玩家也可点选后改变阵位）
  let ek = 1;
  for (const it of sbxOf('dd')) {
    if (it === ddI) continue;
    const c = sbxEntry(it), s = c.spawn, hp = 6 + s.hull * 3, sh = addShip('dd', it.x, it.y, 'DD-' + ++ek);
    Object.assign(sh, { hp, maxhp: hp, load: { teams: 0, eng: 0 }, auto: true, plan: null, sbxRole: 'naval', sbxCls: { rof: s.rof || 1, salvo: s.salvo || 1, name: c.name }, cat: c.id });
    if (it.plan) sh.sbxTgt = { x: it.plan.x, y: it.plan.y };
  }
  if (typeof initCarrier === 'function') initCarrier();
  if (S.cv) {
    if (cvI) { const s = sbxEntry(cvI).spawn; Object.assign(S.cv, { x: cvI.x, y: cvI.y, tx: cvI.x, ty: cvI.y, hp: s.hp, maxhp: s.hp, moving: false, auto: role === 'spectate', exposedUntil: 0, cat: [0, 0] }); }
    else Object.assign(S.cv, { x: -9999, y: H + 9999, tx: -9999, ty: H + 9999, hp: 0, moving: false, auto: false });
    S.air = { wing: cvI ? acc.wing.slice(0, sbxEntry(cvI).spawn.wing) : [], wrecks: [] };
    if (typeof airCount === 'function') airCount();
  }
  aiInit(S.level);
  S.ai.waves = 99;   // 沙盒不送默认增援波次：守方的增援只来自购买的「增援波次」
  const A = typeof A3D === 'object' ? A3D[S.level] || A3D.hard : { first: 100 };
  S.a3 = { raidT: 20, next: A.first, spawnNext: 1e9, roll: {}, seen: {}, seenT: 0, bridgeT: 0, lineT: 0 };   // 袭扰只能抽调已部署的部队
  rebuildForts(); indexUnits();
  SB.live = true; SB.role = role;
  S.mode = 'sandbox'; S.role = role;
}

// 开战：spectate 观战 AI 对 AI；attack 亲自指挥进攻方（进入常规部署阶段）
function sbxStart(role) {
  if (!S || !S.sbx || S.sbx.live) return false;
  const spent = { p: sbxSpent('p'), e: sbxSpent('e') };
  S.sbx.spent = spent;
  sbxBuild(role);
  closeSandbox(true);
  S.briefed = true; S.t = 0; S.over = null; S.holdT = 0;
  if (role === 'spectate') {
    for (const u of S.units) if (u.side === 'p') u.auto = true;
    for (const s of S.ships) if (!s.sbxHold) s.auto = true;
    if (Array.isArray(S.veh)) for (const v of S.veh) if (v.side === 'p') v.auto = true;
    S.dd.auto = S.dd.state !== 'sunk'; if (S.cv) S.cv.auto = S.cv.hp > 0;
    S.phase = 'deploy';
    startBattle();
    S.paused = false;
    log('沙盒观战：双方指挥官 AI 接管全部兵力', 'info');
  } else {
    S.phase = 'deploy'; S.paused = true;
    log('沙盒：进攻方由你指挥。预定登陆点后按 H-HOUR 开始。', 'info');
  }
  if (typeof updateVision === 'function') updateVision();
  if (typeof document !== 'undefined') {
    if (typeof mnFrameDeploy === 'function' && typeof CAM === 'object') { try { mnFrameDeploy(); } catch (e) { /* 镜头不重要 */ } }
    if (typeof updateHud === 'function') updateHud();
  }
  return true;
}

// ———————————————— 推演中的沙盒专属行为（HOOK.step）————————————————
function sbxNearFoe(x, y, r, minD) {
  let best = null, bd = r;
  for (const e of S.enemies) if (!e.dead && inVision(e.x, e.y)) { const d = dist(x, y, e.x, e.y); if (d < bd && d > (minD || 0)) { bd = d; best = e; } }
  for (const q of S.teams) if (q.side === 'e' && q.men.length && inVision(q.x, q.y)) { const d = dist(x, y, q.x, q.y); if (d < bd && d > (minD || 0)) { bd = d; best = q; } }
  return best;
}
const sbxSafe = (x, y, r) => !S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, x, y) < r);
const sbxBeachOf = x => TER.beaches.slice().sort((a, b) => Math.abs(a.cx - x) - Math.abs(b.cx - x))[0];
function sbxOnce(key, fn) { const R0 = S.sbxRun; if (R0.said[key]) return; R0.said[key] = 1; fn(); }

// 登陆部队按装载清单换装（兵种、修正、标签），工兵单独编成工兵分队
function sbxCargo() {
  for (const s of S.ships) {
    if (!s.sbxCargo || s.sbxDone || s.state !== 'beached') continue;
    s.sbxDone = true;
    const u = S.units.find(u => u.side === 'p' && u.ship === s.label && u.kind === 'inf');
    if (!u) continue;
    const ts = S.teams.filter(q => q.u === u.id), eng = [];
    let mor = 0, nm = 0;
    ts.forEach((q, k) => {
      const c = catalogById(s.sbxCargo[k]);
      if (!c) return;
      const sp = c.spawn;
      q.men = sp.men.slice(); q.kind = q.men[0] === 'eng' ? 'eng' : 'inf'; q.cat = c.id;
      if (sp.mod) q.mod = { ...sp.mod };
      if (sp.tag) q.sbxTag = sp.tag;
      if (sp.eng) eng.push(q);
      mor += sp.morale || 80; nm++;
    });
    if (nm) u.morale = Math.round(mor / nm);
    if (eng.length) { const ue = addUnit('p', 'eng', { ship: s.label, emblem: 'eng', face: NORTH, auto: u.auto }); for (const q of eng) q.u = ue.id; }
    indexUnits();
  }
}
// 坦克登陆舰卸下的车辆按清单套用变体修正
function sbxVehVar() {
  if (!Array.isArray(S.veh)) return;
  for (const s of S.ships) {
    if (!s.sbxVeh || !s.sbxVeh.length || (s.state !== 'beached' && s.state !== 'unloading')) continue;
    for (const v of S.veh) {
      if (v.side !== 'p' || v.sbxV || dist(v.x, v.y, s.bx ?? s.x, s.by ?? s.y) > 110) continue;
      const k = s.sbxVeh.findIndex(o => o.type === v.type);
      if (k < 0) continue;
      const o = s.sbxVeh.splice(k, 1)[0];
      v.sbxV = o.id;
      if (o.mod) v.mod = { ...(v.mod || {}), ...o.mod };
      if (o.tag) v.sbxTag = o.tag;
    }
  }
}
// 观战：第二波待命，滩头出口夺取或 H+150 秒后起航
function sbxWaves() {
  const held = S.ships.filter(s => s.sbxHold && alive(s) && s.state === 'idle');
  if (!held.length) return;
  const landed = S.ships.filter(s => s.kind === 'assault' && s.state === 'beached').length;
  const go = [];
  for (const s of held) {
    const tx = s.sbxPlan ? s.sbxPlan.x : s.x, ex = sbxNearPt(tx, coastAt(tx) - 50, p => /^E\d/.test(p.key));
    const men = S.teams.filter(q => q.side === 'p' && q.kind === 'inf' && dist(q.x, q.y, ex.x, ex.y) < 260).reduce((a, q) => a + q.men.length, 0);
    if (S.t > 150 || (S.t > 60 && landed >= 2 && (ex.owner === 'p' || men >= 18))) go.push({ s, ex, why: ex.owner === 'p' ? 'exit' : men >= 18 ? 'men' : 'time' });
  }
  if (!go.length) return;
  for (const { s } of go) { s.sbxHold = false; s.auto = true; if (s.sbxPlan) { orderShips([s], s.sbxPlan.x, s.sbxPlan.y); s.sbxPlan = null; } }
  const g = go[0], n = go.length;
  sbxSay('p', g.why === 'exit' ? `命令：${g.ex.name}已夺取，第二波 ${n} 艘起航靠岸。` : g.why === 'men' ? `命令：滩头已站稳（${g.ex.name}附近我军约一个连），第二波 ${n} 艘起航。` : `命令：H+${Math.round(S.t / 60 * 10) / 10} 分钟，按时间表第二波 ${n} 艘起航，各舰注意规避岸炮。`, 'order', { x: g.ex.x, y: g.ex.y });
}
// 火箭艇、火力支援艇、扫雷舰
function sbxFireShips(dt) {
  for (const s of S.ships) {
    if (!s.sbxRole || !alive(s)) continue;
    const b = s.sbxTgt ? sbxBeachOf(s.sbxTgt.x) : sbxBeachOf(s.x), tx = s.sbxTgt ? s.sbxTgt.x : b.cx, cy = coastAt(tx);
    const st = s.sbxS || (s.sbxS = { n: 0, cd: 0, go: 0, sw: 0 });
    st.cd = Math.max(0, st.cd - dt);
    const goTo = (x, y) => { if (s.auto && s.state === 'idle') orderShips([s], clamp(x, 20, W - 20), y); };
    if (s.hp < s.maxhp * .35 && st.go < 9) { st.go = 9; goTo(s.x, STAGING_Y + 60); continue; }
    if (s.sbxRole === 'rocket') {
      if (st.go === 0) { st.go = 1; goTo(tx, cy + 240); }
      if (st.go === 1 && s.state === 'idle' && st.cd <= 0 && dist(s.x, s.y, tx, cy) < 720) {
        const n = 18;
        for (let k = 0; k < n; k++) fireShell(s.x, s.y, clamp(tx + gauss() * 80, 0, W), cy - 30 + gauss() * 45, 'p', 'mortar', 1.5 + k * .07, false);
        S.fx.push({ kind: 'flash', x: s.x, y: s.y, r: 18, life: 0, max: .6, side: 'p' });
        st.n++; st.cd = 38; S.stats.shots += n;
        log(`${s.label} 火箭齐射覆盖${b.name}`, 'info', 'rkt' + s.id, 5, { x: tx, y: cy });
        if (st.n === 1) sbxSay('p', `命令：${s.label} 对${b.name}实施抢滩前火箭齐射，压制滩头守军、炸开铁丝网。`, 'order', { x: tx, y: cy });
        if (st.n >= 2) { st.go = 2; goTo(s.x, STAGING_Y + 40); }
      }
    } else if (s.sbxRole === 'gun') {
      if (st.go === 0 && S.t > 12) { st.go = 1; goTo(tx + 40, cy + 150); }
      if (s.state === 'idle' && st.cd <= 0 && dist(s.x, s.y, tx, cy) < 520) {
        const t = sbxNearFoe(s.x, s.y, 380, 0);
        st.cd = t ? 3.2 : 1;
        if (!t) continue;
        if (t.men) { if (sbxSafe(t.x, t.y, 30)) fireShell(s.x, s.y, t.x + gauss() * 10, t.y + gauss() * 10, 'p', 'mortar', 1.1, false); }
        else { damageEnemy(t, .9); t.sup = Math.max(t.sup || 0, 70); }
        tracer(s.x, s.y, t.x + gauss() * 6, t.y + gauss() * 6, 'p', true); tracer(s.x, s.y, t.x + gauss() * 6, t.y + gauss() * 6, 'p', true);
        S.stats.shots++;
      }
    } else if (s.sbxRole === 'naval') {   // 护航舰：滩头外 380 游弋，优先打已发现的火力点，射程 1000，我军 45 以内不射
      if (st.go === 0 && S.t > 6) { st.go = 1; goTo(tx + ((s.id % 5) - 2) * 80, cy + 360 + (s.id % 3) * 40); }   // 各舰错开阵位
      if (st.cd > 0) continue;
      let t = null, bd = 1000;
      for (const e of S.enemies) if (!e.dead && (inVision(e.x, e.y) || e.kx != null)) { const d = dist(s.x, s.y, e.x, e.y) * (e.kind === 'coastal' || e.kind === 'bunker' ? .7 : 1); if (d < bd && sbxSafe(e.x, e.y, 45)) { bd = d; t = e; } }
      if (!t) { const q = sbxNearFoe(s.x, s.y, 1000, 0); if (q && sbxSafe(q.x, q.y, 45)) t = q; }
      st.cd = t ? 5 / (s.sbxCls.rof || 1) : 1.5;
      if (!t) continue;
      const sc = 10 + dist(s.x, s.y, t.x, t.y) / 50;
      for (let k = 0; k < (s.sbxCls.salvo || 1); k++) fireShell(s.x, s.y, t.x + gauss() * sc, t.y + gauss() * sc, 'p', 'naval', 2.2, false, { t: -k * .2 });
      Object.assign(s, { aimX: t.x, aimY: t.y, fireT: S.t });
      S.fx.push({ kind: 'flash', x: s.x, y: s.y, r: 14, life: 0, max: .5, side: 'p' });
      S.stats.shots++;
      sbxOnce('nv' + s.id, () => sbxSay('p', `命令：护航舰 ${s.label}（${s.sbxCls.name}）前出至${b.name}外海，对已发现火力点实施舰炮支援。`, 'order', { x: t.x, y: t.y }));
    } else if (s.sbxRole === 'sweep') {
      if (st.go === 0) { st.go = 1; goTo(tx, cy + 75); }
      if ((st.sw += dt) < 2.2) continue;
      st.sw = 0;
      let o = null, bd = 170;
      for (const ob of S.obst) if (!ob.dead && !ob.ditch && ob.y > coastAt(ob.x) - 12) { const d = dist(s.x, s.y, ob.x, ob.y); if (d < bd) { bd = d; o = ob; } }
      let ch = false;
      if (o) { o.dead = true; o.known = true; ch = true; S.fx.push({ kind: 'flash', x: o.x, y: o.y, r: 8, life: 0, max: .5, side: 'p' }); sbxOnce('sw' + s.id, () => log(`${s.label} 正在清除${b.name}水际障碍`, 'good', null, 0, o)); }
      for (const m of S.mines) if (!m.known && m.clr < 1 && Math.abs(m.y - coastAt(m.x)) < 70 && dist(m.x, m.y, s.x, s.y) < 220) { m.known = true; ch = true; log('扫雷舰标定滩头雷区', 'good', 'swm', 6, m); }
      if (ch) rebuildForts();
    }
  }
}
// 驱护舰 / 巡洋舰型号：射速与齐射（ddFire 把 cool 设为 5 时即为刚开火）
function sbxDD() {
  const dd = S.dd, R0 = S.sbxRun;
  if (!dd || !dd.mod || dd.state === 'sunk') return;
  if (dd.cool > R0.ddPrev + 2) {
    dd.cool = 5 / (dd.mod.rof || 1);
    if (dd.mod.salvo > 1) for (const sh of S.shells) {
      if (sh.side !== 'p' || sh.kind !== 'naval' || sh.sbxS || dist(sh.x0, sh.y0, dd.x, dd.y) > 30) continue;
      sh.sbxS = 1;
      for (let k = 1; k < dd.mod.salvo; k++) S.shells.push({ ...sh, x1: clamp(sh.x1 + gauss() * 16, 0, W), y1: clamp(sh.y1 + gauss() * 16, 0, H), t: sh.t - k * .2, sbxS: 1 });
    }
  }
  R0.ddPrev = dd.cool;
  // 反炮兵射击并非百发百中：机动中的舰艇难打，间瞄火炮超出射程必然落空；命中率随舰型（hit：小舰灵活、大舰目标大）
  for (const sh of S.shells) {
    if (sh.kind !== 'cb' || sh.sbxC) continue;
    sh.sbxC = 1;
    const g = S.enemies.find(e => Math.abs(e.x - sh.x0) < 2 && Math.abs(e.y - sh.y0) < 2), d = dist(sh.x0, sh.y0, dd.x, dd.y);
    const rng = g && g.kind === 'arty' ? 1100 * ((g.mod && g.mod.rng) || 1) : 650;
    const p = d > rng ? 0 : (g && g.kind === 'coastal' ? .7 : .45) * (dd.mod.hit || 1) * (dd.moving ? .8 : 1);
    if (Math.random() >= p) { const a = Math.random() * 6.283, m = 45 + Math.random() * 45; Object.assign(sh, { kind: 'mortar', x1: clamp(dd.x + Math.cos(a) * m, 0, W), y1: clamp(dd.y + Math.sin(a) * m, 0, H) }); }
  }
}
// 舰载机变体
function sbxAir() {
  if (!S.air || !Array.isArray(S.planes)) return;
  for (const p of S.planes) {
    if (p.dead || p.wid == null) continue;
    const w = S.air.wing.find(w => w.id === p.wid);
    if (!w || !w.v) continue;
    if (w.v === 'lr' && p.phase === 'out' && p.y < STAGING_Y && S.t - (p.sbxT || -9) > .3) {
      p.sbxT = S.t;
      const nx = -Math.sin(p.heading), ny = Math.cos(p.heading);
      for (const o of [-75, 75]) S.recon.push({ x: p.x + nx * o, y: p.y + ny * o, until: S.t + 40 });
    } else if ((w.v === 'dive' || w.v === 'heavy') && p.dropped && !p.sbxD) {
      p.sbxD = 1;
      if (w.v === 'dive') { for (const sh of S.shells) if (sh.side === 'p' && sh.kind === 'bomb' && !sh.sbxD && dist(sh.x0, sh.y0, p.x, p.y) < 60) { sh.sbxD = 1; sh.x1 = lerp(sh.x1, p.tx, .55); sh.y1 = lerp(sh.y1, p.ty, .55); } }
      else {
        const ch = Math.cos(p.heading), sh = Math.sin(p.heading);
        [-68, 68, -102, 102, 0].slice(0, 3).forEach((off, i) => { const side = (i - 1) * 18 + gauss() * 8; fireShell(p.x, p.y, clamp(p.tx + ch * off - sh * side, 0, W), clamp(p.ty + sh * off + ch * side, 0, H), 'p', 'bomb', .7, false, { t: -(i + 3) * .18 }); });
      }
    } else if (w.v === 'fb' && p.phase === 'loiter' && !p.sbxD) {
      p.sbxD = 1; p.loiterT = Math.min(p.loiterT, 26);
      const t = sbxNearFoe(p.cx ?? p.x, p.cy ?? p.y, 160, 0);
      if (t && sbxSafe(t.x, t.y, 50)) fireShell(p.x, p.y, t.x + gauss() * 10, t.y + gauss() * 10, 'p', 'bomb', .9, false);
    } else if (w.v === 'heli' && p.phase === 'loiter') {
      if (!p.sbxD) { p.sbxD = 1; p.loiterT = 70; }
      if ((p.gunT || 0) > (p.sbxG || 0) + .1) for (const o of S.teams) if (o.side === 'e' && o.men.length && dist(o.x, o.y, p.gx, p.gy) < 32) suppress(o, 18, p.x, p.y);
      p.sbxG = p.gunT || 0;
    }
  }
}
// 重型 / 雷达高炮：更远的射程、更高的命中率（基础判定在 carrier.js airAA）
function sbxAA() {
  if (!S.planes || !S.planes.length || typeof airLost !== 'function') return;
  for (const a of S.enemies) {
    if (a.dead || a.kind !== 'aa' || !a.mod || a.moving) continue;
    const ext = 190 * (a.mod.rng || 1), m = a.mod.aa || 1;
    for (const p of S.planes) {
      if (p.dead || !(p.alt > .4)) continue;
      const d = dist(a.x, a.y, p.x, p.y);
      if (d > ext) continue;
      const sp = (typeof AIR_SPEC === 'object' && AIR_SPEC[p.kind]) || { aa: .08, name: '飞机' }, pr = sp.aa * (d <= 190 ? m - 1 : m) * (1 - (a.sup || 0) / 130);
      if (d > 190) tracer(a.x, a.y, p.x + gauss() * 14, p.y + gauss() * 14, 'e', inVision(a.x, a.y));
      if (pr > 0 && Math.random() < pr) { airLost(p, `${sp.name}被${a.name || '高炮'}击落`); break; }
    }
  }
}
// 观察哨 / 雷达 / 探照灯 / 弹药库
function sbxPosts(dt) {
  for (const o of S.sbxObs) {
    if (o.dead) continue;
    if (inVision(o.x, o.y)) { if (o.kx == null) log(`发现敌${o.name}`, 'warn', null, 0, o); o.kx = o.x; o.ky = o.y; }
    let n = 0;
    for (const q of S.teams) if (q.side === 'p' && q.kind === 'inf' && q.men.length && dist(q.x, q.y, o.x, o.y) < 30) n++;
    if (n) sbxHurtPost(o, .7 * n * dt);
    if (o.ammo) for (const e of S.enemies) if (!e.dead && (e.kind === 'arty' || e.kind === 'mortar') && e.cd > 0 && dist(e.x, e.y, o.x, o.y) < 900) e.cd -= dt * .25;
  }
}
function sbxHurtPost(o, d) {
  if (o.dead) return;
  o.hp -= d;
  if (o.hp > 0) return;
  o.dead = true; o.kx = o.x; o.ky = o.y;
  S.stats.structs++;
  S.fx.push({ kind: 'boom', x: o.x, y: o.y, r: 22, life: 0, max: 1.1, side: 'e' });
  log(inVision(o.x, o.y) ? `摧毁敌${o.name}` : `远处殉爆，疑似敌${o.name}被毁`, 'good', null, 0, o);
}
// 兵种标签：卫生、营部、迫击炮、爆破、喷火、守军工兵、推土工程坦克
function sbxTags(dt) {
  const R0 = S.sbxRun;
  if ((R0.tagT += dt) < .5) return;
  const t = R0.tagT; R0.tagT = 0;
  let forts = false;
  for (const q of S.teams) {
    if (!q.sbxTag || !q.men.length) continue;
    const u = unitOf(q);
    if (q.sbxTag === 'medic' || q.sbxTag === 'hq') {
      const r = q.sbxTag === 'hq' ? 150 : 80;
      for (const o of S.units) if (o.side === q.side && o.x != null && o.state !== 'rout' && dist(o.x, o.y, q.x, q.y) < r) o.morale = Math.min(100, o.morale + (o === u ? 1.2 : q.sbxTag === 'hq' ? .8 : .5) * t);
      if (q.sbxTag === 'hq') for (const o of S.teams) if (o.side === q.side && o !== q && dist(o.x, o.y, q.x, q.y) < 150) o.sup = Math.max(0, o.sup - 4 * t);
    } else if (q.sbxTag === 'mortar') {
      if ((q.sbxCd = (q.sbxCd ?? 2) - t) > 0 || q.ammo < 6 || q.sup > 60) continue;
      const tg = sbxNearFoe(q.x, q.y, 380, 50);
      if (!tg || !sbxSafe(tg.x, tg.y, 28)) { q.sbxCd = 1; continue; }
      fireShell(q.x, q.y, tg.x + gauss() * 16, tg.y + gauss() * 16, 'p', 'mortar', 2.2, false);
      q.ammo -= 3; q.sbxCd = 7; S.stats.shots++;
    } else if (q.sbxTag === 'demo' || q.sbxTag === 'flame') {
      if (q.sup > 75) continue;
      const fl = q.sbxTag === 'flame', r = fl ? 32 : 26;
      for (const e of S.enemies) if (!e.dead && dist(e.x, e.y, q.x, q.y) < r) {
        damageEnemy(e, (fl ? 1.6 : 3.2) * t * q.men.length / 3); e.sup = 100;
        if (Math.random() < .5) S.fx.push({ kind: 'flash', x: e.x + gauss() * 4, y: e.y + gauss() * 4, r: fl ? 10 : 7, life: 0, max: .45, side: 'p' });
        sbxOnce((fl ? 'fl' : 'dm') + e.id, () => log(fl ? '喷火组压上碉堡射口' : '爆破组在碉堡下安放炸药', 'good', null, 0, e));
        break;
      }
      if (fl) for (const o of S.teams) if (o.side !== q.side && o.men.length && dist(o.x, o.y, q.x, q.y) < 36) {
        suppress(o, 26 * t, q.x, q.y);
        if (Math.random() < (o.inTrench ? .35 : .18) * t) killMan(o);
      }
    } else if (q.sbxTag === 'eeng') {
      let best = null, bd = 60;
      for (const e of S.enemies) if (!e.dead && e.hp < e.maxhp) { const d = dist(e.x, e.y, q.x, q.y); if (d < bd) { bd = d; best = e; } }
      if (best) best.hp = Math.min(best.maxhp, best.hp + .35 * t);
    }
  }
  if (Array.isArray(S.veh)) for (const v of S.veh) if (v.sbxTag === 'dozer' && !v.dead) {
    for (const o of S.obst) if (!o.dead && dist(o.x, o.y, v.x, v.y) < 16) { o.dead = true; o.known = true; forts = true; }
    for (const w of S.wire) if (!w.cut && segDist(v.x, v.y, w.x0, w.y0, w.x1, w.y1) < 12) { w.cut = true; w.known = true; forts = true; }
  }
  if (forts) rebuildForts();
}
// 战前出击（侦察 / 轰炸 / 舰炮火力准备）、守方增援波次、预置补给站、甲板整备
function sbxTimed(dt) {
  const R0 = S.sbxRun;
  for (const so of R0.sorties) {
    if (so.done || S.t < so.at) continue;
    so.done = true;
    if (so.k === 'recon') {
      for (let k = 0; k < 9; k++) { const a = k / 8 * 6.283, r = k === 8 ? 0 : so.r * .6; S.recon.push({ x: so.x + Math.cos(a) * r, y: so.y + Math.sin(a) * r, until: S.t + 30 }); }
      S.visT = 0;
      log('战前空中侦察照片已送达', 'good', null, 0, so);
    } else if (so.k === 'bomb') {
      for (let k = 0; k < so.n; k++) fireShell(so.x - 30 + gauss() * 10, so.y + 90, clamp(so.x + gauss() * 55, 0, W), clamp(so.y + gauss() * 40, 0, H), 'p', 'bomb', 1.1 + k * .25, false);
      log('战前轰炸机群进入目标上空', 'info', null, 0, so);
    } else {
      for (let k = 0; k < so.n; k++) fireShell(clamp(so.x + gauss() * 200, 20, W - 20), STAGING_Y + 140, clamp(so.x + gauss() * 45, 0, W), clamp(so.y + gauss() * 35, 0, H), 'p', 'naval', 2.6, false, { t: -k * 1.8 });
      log('外海舰队开始火力准备', 'info', null, 0, so);
    }
  }
  if ((R0.waveT += dt) >= 1) {
    R0.waveT = 0;
    let k = 0;
    for (const wv of R0.waves) {
      k++;
      if (wv.done || S.t < wv.t) continue;
      wv.done = true;
      const p = S.points.filter(p => p.owner === 'p').sort((a, b) => b.vp - a.vp)[0] || S.points.filter(p => p.contested)[0] || ptByKey('HQ') || S.points[0];
      const uw = addUnit('e', 'inf', { role: 'reserve', obj: p.key });
      for (let j = 0; j < wv.n; j++) {
        const q = addTeam('e', clamp(p.x + gauss() * 60, 20, W - 20), 12, ['rifle', 'rifle', 'mg'], { role: 'reserve', obj: p.key, u: uw.id });
        aiGo(q, p.x + gauss() * 20, p.y + gauss() * 20, 'move', p.x, p.y);
      }
      log('截获敌方无线电：北面有增援部队开来', 'warn');
      sbxSay('e', `命令：增援第 ${k} 波 ${wv.n} 个小组由北面开往${p.name}。`, 'order', p);
    }
    if (R0.depot && !R0.depotDone && S.supply.length && typeof snEnsure === 'function') {
      const L = S.supply[0], sp = sbxSnap(L.x, L.y - 150, 'p');
      if (sp) {
        R0.depotDone = true;
        snEnsure().nodes.push({ id: S.nid++, x: sp.x, y: sp.y, parent: null, root: L.id, hp: SN_HP, maxhp: SN_HP, built: 1, cut: false, dead: false, connected: false, rep: 0, sab: 0, path: [[L.x, L.y], [sp.x, sp.y]], t: S.t, deadT: null });
        log('预置野战补给站在滩头出口建成', 'good', null, 0, sp);
      }
    }
  }
  if (R0.deck && S.air) for (const w of S.air.wing) if (w.state === 'rearm') w.rearmT -= dt * .67;
}

// ———————————————— 视野、爆炸挂钩 ————————————————
HOOK.visionE.push(() => {
  if (!sbxLive() || S.phase !== 'battle') return [];
  const out = [];
  for (const o of S.sbxObs || []) if (!o.dead && o.r > 0) out.push({ x: o.x, y: o.y, r: o.r, h: o.h });
  for (const e of S.enemies) if (!e.dead && e.sbxVis) out.push({ x: e.x, y: e.y, r: e.sbxVis.r, h: e.sbxVis.h });
  return out;
});
HOOK.visionP.push(() => sbxLive() ? S.teams.filter(q => q.side === 'p' && q.sbxTag === 'fo' && q.men.includes('radio')).map(q => ({ x: q.x, y: q.y, r: 240, h: .9 })) : []);
HOOK.impact.push((x, y, R, pw, side) => {
  if (!sbxLive() || side === 'e' || !S.sbxObs) return;
  for (const o of S.sbxObs) if (!o.dead) { const d = dist(x, y, o.x, o.y); if (d < R + 6) sbxHurtPost(o, (pw.struct || pw.ship || pw.men * 4) * (1 - d / (R + 6) * .5)); }
});
HOOK.step.push(dt => {
  if (!sbxLive() || !S.sbxRun) return;
  sbxCargo(); sbxVehVar(); sbxFireShips(dt); sbxDD(); sbxAir(); sbxPosts(dt); sbxTags(dt); sbxTimed(dt);
  if ((S.sbxRun.aaT += dt) >= .5) { S.sbxRun.aaT = 0; sbxAA(); }
  if (S.t - (S.sbxRun.wT || 0) >= 1) { S.sbxRun.wT = S.t; sbxWaves(); }
});
HOOK.newGame.push(opts => { if (!(opts && opts.sandbox)) closeSandbox(); });

// ———————————————— 编辑器入口 ————————————————
function openSandbox(seed, keep) {
  const prev = S && S.sbx ? S : null, lv = (prev && prev.level) || (typeof U === 'object' && U.level) || 'hard';
  const bud = keep && prev ? { ...prev.sbx.budget } : { p: SBX_BUDGET, e: SBX_BUDGET };
  newGame(seed, lv, { sandbox: true, mode: 'sandbox' });
  Object.assign(S, { phase: 'sandbox', briefed: true, paused: true, role: 'attack', mode: 'sandbox', armor: [] });
  S.sbx = { items: [], budget: bud, nid: 1, notes: { p: [], e: [] }, live: false };
  Object.assign(SBX, { pick: null, line: null, lineDown: null, hover: null, drag: null, pv: false, msg: '', endKey: null });
  sbxSync();
  if (typeof document === 'undefined') return S;
  if (typeof MX === 'object' && MX) MX.seed = null;
  if (typeof R === 'object' && R) R.pixSeed = null;
  if (typeof mmInit === 'function' && $('mm')) mmInit($('mm'));
  if (typeof U === 'object') { U.tool = null; U.logKey = null; U.cardKey = null; U.level = lv; }
  $('brief').hidden = true; $('end').hidden = true;
  sbxShow();
  if (typeof CAM === 'object' && CAM.vw > 1) {
    if (CAM.vw > 900) { CAM.z = CAM.fit * 1.15; CAM.x = W / 2 - 150 / CAM.z; CAM.y = H * .55; }   // 全图，向右偏一点给左侧面板让位
    else {   // 窄屏：画布只占上方，铺满高度看海岸到集结海域，横向拖动平移
      const vis = Math.max(200, CAM.vh - 30), B = TER.beaches.slice().sort((a, b) => Math.abs(a.cx - W / 2) - Math.abs(b.cx - W / 2))[0];
      CAM.z = clamp(vis / 1250, CAM.fit, CAM.fit * 4); CAM.x = B ? B.cx : W / 2; CAM.y = 750 + vis / CAM.z / 2;
    }
    if (typeof camClamp === 'function') camClamp();
  }
  sbxRender();
  if (typeof updateHud === 'function') updateHud();
  return S;
}
// 显示编辑器（热重载恢复到编辑阶段时由 frame 挂钩补建）
function sbxShow() {
  sbxUI();
  document.body.classList.add('sbx-edit');
  SBX.el.hidden = false;
  sbxRender();
}
function closeSandbox() {
  if (typeof document === 'undefined') return;
  document.body.classList.remove('sbx-edit');
  if (SBX.el) SBX.el.remove();
  const old = document.getElementById('sbxPanel'); if (old) old.remove();
  SBX.el = null; SBX.pick = null; SBX.line = null; SBX.drag = null; SBX.hover = null;
  if (typeof R === 'object' && R && R.cv) R.cv.style.cursor = '';
}

// ———————————————— 编辑器面板（DOM 注入）————————————————
const SBX_CATS = { e: ['inf', 'armor', 'arty', 'fort', 'support'], p: ['inf', 'armor', 'naval', 'air', 'support'] };
const SBX_LV = [['normal', '普通'], ['hard', '困难'], ['hell', '地狱']];
const sbxEsc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const sbxIc = (c, cls) => `<svg viewBox="0 0 24 24" class="ic ${cls || ''}" aria-hidden="true">${c && c.icon || ''}</svg>`;
function sbxCss() {
  if (document.getElementById('sbxCss')) return;
  const st = document.createElement('style');
  st.id = 'sbxCss';
  st.textContent = `
body.sbx-edit #cards, body.sbx-edit #cmdBox, body.sbx-edit #deploy, body.sbx-edit #pauseBand, body.sbx-edit #feed { display: none !important; }
body.sbx-edit #bottom { grid-template-columns: minmax(0, 1fr) auto; pointer-events: none; } body.sbx-edit #mmBox { grid-column: 2; }
#sbxPanel { box-sizing: border-box; position: absolute; z-index: 6; top: calc(10px + env(safe-area-inset-top, 0px)); left: max(16px, env(safe-area-inset-left, 0px)); width: 316px; max-height: calc(100% - 20px);
  display: flex; flex-direction: column; gap: 7px; padding: 10px; overflow-y: auto; overscroll-behavior: contain; font-size: 12px; color: var(--text); scrollbar-width: thin; }
#sbxPanel[hidden] { display: none; } #sbxPanel > * { flex-shrink: 0; }
#sbxPanel h2 { margin: 0; font: 13px var(--f-px, monospace); letter-spacing: .12em; color: var(--g); display: flex; justify-content: space-between; align-items: baseline; }
#sbxPanel h2 small { font: 10px var(--f-ui, monospace); color: var(--g-mid); letter-spacing: 0; }
.sbx-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.sbx-sides button { background: transparent; border: 1px solid var(--line); border-radius: 5px; padding: 5px 7px; text-align: left; display: grid; gap: 1px; color: var(--text); }
.sbx-sides button b { font-size: 13px; } .sbx-sides button span { font-size: 11px; opacity: .8; font-variant-numeric: tabular-nums; }
.sbx-sides button.e.on { border-color: var(--enemy); color: #ffd0dc; box-shadow: 0 0 12px rgba(255, 61, 110, .25); }
.sbx-sides button.p.on { border-color: var(--g); color: #d4ffe6; box-shadow: 0 0 12px rgba(61, 255, 138, .25); }
.sbx-sides button.over span { color: var(--enemy); opacity: 1; }
.sbx-bud { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: center; }
.sbx-bud .tb { min-width: 26px; height: 24px; padding: 0 6px; }
.sbx-bar { height: 5px; border-radius: 3px; background: rgba(61, 255, 138, .08); border: 1px solid var(--line); overflow: hidden; position: relative; }
.sbx-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--g); }
#sbxPanel.e .sbx-bar i { background: var(--enemy); } .sbx-bar.over i { background: var(--amber) !important; }
.sbx-cats { display: flex; flex-wrap: wrap; gap: 4px; }
.sbx-cats button, .sbx-row button, .sbx-lv button { background: transparent; border: 1px solid var(--line); border-radius: 4px; padding: 3px 8px; color: var(--text); font-size: 12px; }
.sbx-cats button.on, .sbx-lv button.on { border-color: var(--line-hi); color: var(--g); background: rgba(61, 255, 138, .1); }
#sbxPanel.e .sbx-cats button.on { border-color: rgba(255, 61, 110, .7); color: #ffc2d0; background: rgba(255, 61, 110, .1); }
.sbx-pal { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 4px; max-height: 196px; overflow-y: auto; padding-right: 2px; scrollbar-width: thin; }
.sbx-pal button { position: relative; display: grid; justify-items: center; gap: 1px; padding: 4px 2px 3px; background: rgba(61, 255, 138, .04); border: 1px solid var(--line); border-radius: 4px; color: var(--g); }
#sbxPanel.e .sbx-pal button { color: #ff8fab; background: rgba(255, 61, 110, .04); border-color: rgba(255, 61, 110, .2); }
.sbx-pal button .ic { width: 22px; height: 22px; } .sbx-pal button span { font-size: 10px; color: var(--text); opacity: .85; font-variant-numeric: tabular-nums; }
.sbx-pal button:hover { border-color: var(--line-hi); } .sbx-pal button.on { border-color: var(--sel); box-shadow: 0 0 10px rgba(176, 124, 255, .45); background: rgba(176, 124, 255, .12); }
.sbx-pal button:disabled { opacity: .32; }
.sbx-info { min-height: 62px; border-left: 2px solid var(--line-hi); padding: 3px 8px; background: rgba(61, 255, 138, .04); border-radius: 0 4px 4px 0; }
#sbxPanel.e .sbx-info { border-color: rgba(255, 61, 110, .6); background: rgba(255, 61, 110, .04); }
.sbx-info b { color: var(--g); font-size: 13px; } #sbxPanel.e .sbx-info b { color: #ff9db5; }
.sbx-info em { font-style: normal; color: var(--amber); margin-left: 6px; } .sbx-info p { margin: 3px 0 0; line-height: 1.45; } .sbx-info .h { color: var(--intel); }
.sbx-msg { min-height: 16px; font-size: 11px; color: var(--intel); } .sbx-msg.bad { color: #ff9db5; }
.sbx-list { display: flex; flex-wrap: wrap; gap: 4px; } .sbx-list:empty { display: none; }
.sbx-list button { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px 1px 3px; border: 1px solid var(--line); border-radius: 10px; background: transparent; color: var(--text); font-size: 11px; }
.sbx-list button .ic { width: 15px; height: 15px; color: var(--g); } .sbx-list button i { font-style: normal; color: var(--enemy); margin-left: 2px; }
.sbx-row { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.sbx-row button.ai { border-color: var(--intel); color: var(--intel); }
.sbx-row input { width: 92px; background: rgba(0, 0, 0, .3); border: 1px solid var(--line); border-radius: 4px; color: var(--g); padding: 3px 6px; font: 12px var(--f-ui, monospace); }
.sbx-lv { display: inline-flex; gap: 3px; }
.sbx-notes { border: 1px solid var(--line); border-radius: 4px; padding: 2px 8px; } .sbx-notes summary { cursor: pointer; color: var(--g-mid); padding: 2px 0; }
.sbx-notes ol { margin: 2px 0 4px; padding-left: 24px; max-height: 150px; overflow-y: auto; line-height: 1.45; } .sbx-notes li { margin: 2px 0; }
.sbx-go { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; position: sticky; bottom: -10px; z-index: 1; margin: 0 -10px -10px; padding: 8px 10px 10px; background: linear-gradient(rgba(2, 10, 6, .82), rgba(2, 10, 6, .96)); border-top: 1px solid var(--line); }
.sbx-go button { background: transparent; border: 1px solid var(--g); color: var(--g); border-radius: 5px; padding: 8px 6px; font-weight: 600; box-shadow: 0 0 12px rgba(61, 255, 138, .25); }
.sbx-go button.alt { border-color: var(--intel); color: var(--intel); box-shadow: 0 0 12px rgba(92, 200, 255, .2); }
.sbx-hint { font-size: 10.5px; color: var(--g-mid); line-height: 1.4; }
@media (max-width: 900px) {
  #sbxPanel { position: fixed; top: auto; bottom: 0; left: 0; right: 0; width: auto; height: 38vh; max-height: none; border-radius: 10px 10px 0 0; padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }
  body.sbx-edit #objs, body.sbx-edit #bottom { display: none !important; } .sbx-pal { max-height: 112px; } .sbx-notes ol { max-height: 90px; }
  .sbx-info { min-height: 0; } .sbx-keys { display: none; } .sbx-go { bottom: calc(-10px - env(safe-area-inset-bottom, 0px)); }
}`;
  document.head.appendChild(st);
}
function sbxUI() {
  sbxCss();
  if (SBX.el) return SBX.el;
  const el = document.createElement('section');
  el.id = 'sbxPanel'; el.className = 'box ov'; el.setAttribute('aria-label', '沙盒部署'); el.hidden = true;
  el.innerHTML = `<h2>沙盒部署<small class="sbx-seed"></small></h2>
    <div class="sbx-sides" role="tablist"></div>
    <div class="sbx-bud"><span>预算</span><div class="sbx-bar"><i></i></div><span><button class="tb" type="button" data-act="bud-" title="预算 −250">−</button> <button class="tb" type="button" data-act="bud+" title="预算 ＋250">＋</button></span></div>
    <div class="sbx-cats"></div><div class="sbx-pal" role="listbox" aria-label="兵力目录"></div>
    <div class="sbx-info"></div><div class="sbx-msg" role="status"></div><div class="sbx-list"></div>
    <div class="sbx-row"><button type="button" data-act="preset"></button><button type="button" class="ai" data-act="ai">AI 帮我部署</button><button type="button" data-act="clear">清空</button></div>
    <div class="sbx-row"><input type="text" inputmode="numeric" aria-label="地图种子" class="sbx-seedin"><button type="button" data-act="map">新地图</button><span class="sbx-lv" role="radiogroup" aria-label="守军 AI 水平"></span></div>
    <details class="sbx-notes" open><summary>部署思路</summary><p class="sbx-hint">点「AI 帮我部署」，由高级指挥官按地形判读完成部署并说明理由。</p><ol></ol></details>
    <div class="sbx-hint sbx-keys">左键放置 · 右键 / Delete 移除 · 拖动已放置的条目可移位 · Tab 切换攻守 · Esc 取消 · 滚轮缩放、中键拖动平移</div>
    <div class="sbx-go"><button type="button" data-act="spectate">观战：AI 对 AI</button><button type="button" class="alt" data-act="command">指挥进攻方</button></div>`;
  ($('stage') || document.body).appendChild(el);
  SBX.el = el;
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !S || !S.sbx || S.sbx.live) return;
    const a = b.dataset.act;
    if (b.dataset.side) { SBX.side = b.dataset.side; SBX.pick = null; SBX.line = null; SBX.cat = 'all'; sbxFrameSide(); }
    else if (b.dataset.cat) SBX.cat = b.dataset.cat;
    else if (b.dataset.id) sbxPick(b.dataset.id);
    else if (b.dataset.rm) { const it = S.sbx.items.find(o => o.id === +b.dataset.rm); if (it) { sbxRemove(it); sbxMsg('已移除' + sbxEntry(it).name); } }
    else if (b.dataset.lv) { S.level = b.dataset.lv; if (typeof U === 'object') U.level = S.level; }
    else if (a === 'bud-' || a === 'bud+') S.sbx.budget[SBX.side] = clamp(S.sbx.budget[SBX.side] + (a === 'bud+' ? 250 : -250), 250, 6000);
    else if (a === 'preset') { const b0 = S.sbx.budget[SBX.side]; if (SBX.side === 'e') sbxPresetDef(); else sbxPresetFleet(); sbxMsg(`已载入标准部署（${sbxSpent(SBX.side)} 点）` + (S.sbx.budget[SBX.side] > b0 ? `，预算已调至 ${S.sbx.budget[SBX.side]}` : '')); }
    else if (a === 'ai') { const r = SBX.side === 'e' ? sbxAIDefend() : sbxAIAttack(); sbxMsg(SBX.side === 'e' ? `守方指挥官判断主攻方向：${r.join('、')}` : `攻方指挥官：主攻${r.main}${r.feint ? '，佯攻' + r.feint : ''}`); }
    else if (a === 'clear') { sbxClear(SBX.side); sbxMsg('已清空' + (SBX.side === 'e' ? '防守方' : '进攻方')); }
    else if (a === 'map') { const v = parseInt(el.querySelector('.sbx-seedin').value, 10); openSandbox(isFinite(v) && v > 0 && v !== S.seed ? v : (Math.random() * 1e9) | 0, true); return; }
    else if (a === 'spectate' || a === 'command') { sbxGo(a === 'spectate' ? 'spectate' : 'attack'); return; }
    sbxRender();
  });
  el.addEventListener('pointerover', e => { const b = e.target.closest('[data-id]'); if (b) sbxInfo(catalogById(b.dataset.id)); });
  el.addEventListener('pointerleave', () => sbxInfo(SBX.pick ? catalogById(SBX.pick) : null));
  el.querySelector('.sbx-seedin').addEventListener('keydown', e => { if (e.key === 'Enter') el.querySelector('[data-act="map"]').click(); });
  return el;
}
function sbxGo(role) {
  const n = { p: S.sbx.items.filter(it => it.side === 'p').length, e: S.sbx.items.filter(it => it.side === 'e').length };
  const ships = S.sbx.items.some(it => it.side === 'p' && sbxEntry(it).spawn.kind === 'ship' && (sbxShipLoad(it).t || sbxEntry(it).spawn.ship === 'supply' || sbxShipLoad(it).v));
  const amph = S.sbx.items.some(it => it.side === 'p' && sbxEntry(it).spawn.kind === 'veh');
  if (!ships && !amph) { sbxMsg('进攻方没有可登陆的部队：先部署登陆舰并装载步兵（或用「AI 帮我部署」）', true); SBX.side = 'p'; sbxRender(); return; }
  if (!n.e) sbxMsg('防守方空无一人——将直接开战', false);
  sbxStart(role);
}
// 切换攻守方：集结海域 / 海岸不在视野内时把镜头移过去
function sbxFrameSide() {
  if (typeof toWorld !== 'function' || typeof camCenter !== 'function') return;
  const a = toWorld(0, 0), b = toWorld(CAM.vw, CAM.vh), want = SBX.side === 'p' ? STAGING_Y + 60 : coastAt(CAM.x) - 180;
  if (want < a.y + 60 || want > b.y - 160) camCenter(CAM.x, want);
}
function sbxMsg(t, bad) { SBX.msg = t; SBX.msgBad = !!bad; SBX.msgT = performance.now(); if (SBX.el) { const m = SBX.el.querySelector('.sbx-msg'); m.textContent = t; m.classList.toggle('bad', !!bad); } }
function sbxPick(id) {
  const c = catalogById(id);
  if (!c) return;
  SBX.line = null;
  if (c.spawn.at === 'none' || c.spawn.at === 'air') {   // 无需位置：直接编入
    const r = sbxPlace(id);
    sbxMsg(r.ok ? `已编入：${c.name}` : r.why, !r.ok);
    SBX.pick = null;
    return;
  }
  SBX.pick = id;   // 保持选中，可连续放置多个；右键或 Esc 取消
  sbxInfo(c);
  sbxMsg((SBX_AT[c.spawn.at] || '') + '（可连续放置，右键或 Esc 取消）');
}
function sbxInfo(c) {
  if (!SBX.el) return;
  const box = SBX.el.querySelector('.sbx-info');
  if (!c) { box.innerHTML = `<p class="h">从目录中选择一种兵力，然后在地图上放置。${SBX.side === 'p' ? '步兵与非两栖车辆须装载到登陆舰上。' : ''}</p>`; return; }
  const arch = typeof ARCH_NAMES === 'object' ? ARCH_NAMES[c.arch] || '' : '', cost = c.spawn.at === 'line' ? `${c.spawn.per} 点 / 100 长` : `${c.cost} 点`;
  box.innerHTML = `<b>${sbxEsc(c.name)}</b><em>◆ ${cost}</em><span class="h"> · ${sbxEsc(arch)}</span><p>${sbxEsc(c.desc)}</p><p class="h">${sbxEsc(SBX_AT[c.spawn.at] || '')}</p>`;
}
function sbxRender() {
  if (!SBX.el || !S || !S.sbx || typeof document === 'undefined') return;
  const el = SBX.el, side = SBX.side, q = s => el.querySelector(s);
  el.classList.toggle('e', side === 'e'); el.classList.toggle('p', side === 'p');
  q('.sbx-seed').textContent = `SEED ${S.seed}`;
  const si = q('.sbx-seedin'); if (document.activeElement !== si) si.value = S.seed;
  q('.sbx-sides').innerHTML = ['e', 'p'].map(k => { const sp = sbxSpent(k), b = S.sbx.budget[k];
    return `<button type="button" role="tab" class="${k}${side === k ? ' on' : ''}${sp > b ? ' over' : ''}" data-side="${k}" aria-selected="${side === k}"><b>${k === 'e' ? '防守方' : '进攻方'}</b><span>${sp} / ${b} 点</span></button>`; }).join('');
  const sp = sbxSpent(side), bud = S.sbx.budget[side];
  q('.sbx-bar i').style.width = clamp(sp / bud, 0, 1) * 100 + '%'; q('.sbx-bar').classList.toggle('over', sp > bud);
  q('.sbx-bud > span').textContent = `剩 ${bud - sp}`;
  const cats = SBX_CATS[side];
  if (SBX.cat !== 'all' && !cats.includes(SBX.cat)) SBX.cat = 'all';
  q('.sbx-cats').innerHTML = ['all', ...cats].map(k => `<button type="button" class="${SBX.cat === k ? 'on' : ''}" data-cat="${k}">${k === 'all' ? '全部' : CAT_NAMES[k]}</button>`).join('');
  const pal = CATALOG.filter(c => (c.side === side || c.side === 'both') && (SBX.cat === 'all' || c.cat === SBX.cat));
  const left = bud - sp;
  q('.sbx-pal').innerHTML = pal.map(c => {
    const na = c.spawn.kind === 'veh' && !sbxVehOk(), cost = c.spawn.at === 'line' ? c.spawn.per + '/百' : c.cost;
    return `<button type="button" role="option" data-id="${c.id}" class="${SBX.pick === c.id ? 'on' : ''}" title="${sbxEsc(c.name)}（${cost} 点）" aria-selected="${SBX.pick === c.id}" ${na || (c.spawn.at !== 'line' && c.cost > left) ? 'disabled' : ''}>${sbxIc(c)}<span>${cost}</span></button>`;
  }).join('');
  sbxInfo(SBX.pick ? catalogById(SBX.pick) : null);
  // 无需位置的条目（舰载机、后勤、增援波次）：同类合并计数，点击移除一项
  const grp = new Map();
  for (const it of S.sbx.items) if (it.side === side && it.x == null) { const g = grp.get(it.cat) || []; g.push(it); grp.set(it.cat, g); }
  q('.sbx-list').innerHTML = [...grp].map(([id, list]) => { const c = catalogById(id); return `<button type="button" data-rm="${list[list.length - 1].id}" title="移除一项：${sbxEsc(c.name)}">${sbxIc(c)}${sbxEsc(c.name)}${list.length > 1 ? ' ×' + list.length : ''}<i>×</i></button>`; }).join('');
  q('[data-act="preset"]').textContent = side === 'e' ? '标准布防' : '标准舰队';
  q('.sbx-lv').innerHTML = SBX_LV.map(([k, n]) => `<button type="button" role="radio" data-lv="${k}" class="${S.level === k ? 'on' : ''}" aria-checked="${S.level === k}" title="守军 AI 水平（士气、射击精度、反应速度）">${n}</button>`).join('');
  const ns = S.sbx.notes[side] || [];
  q('.sbx-notes ol').innerHTML = ns.map(t => `<li>${sbxEsc(t)}</li>`).join('');
  q('.sbx-notes ol').hidden = !ns.length; q('.sbx-notes .sbx-hint').hidden = !!ns.length;
  const m = q('.sbx-msg'); m.textContent = SBX.msg; m.classList.toggle('bad', !!SBX.msgBad);
}

// ———————————————— 地图上的放置交互 ————————————————
function sbxClick(p) {
  const id = SBX.pick, c = id && catalogById(id);
  if (!c) {   // 未选兵种：点中已放置条目即可拖动
    const it = sbxNearest(p.x, p.y, SBX.side, Math.max(12, px(14)));
    if (it && it.x2 == null && !it.pts) SBX.drag = { it, x0: it.x, y0: it.y, moved: false };
    return;
  }
  if (c.spawn.at === 'line') {
    if (!SBX.line) { const r = sbxCheck(c, p.x, p.y); if (!r.ok) { sbxMsg(r.why, true); return; } SBX.line = { x: p.x, y: p.y }; sbxMsg('再点终点（Esc 取消）'); return; }
    const r = sbxPlace(id, SBX.line.x, SBX.line.y, p.x, p.y);
    if (r.ok) { SBX.line = null; sbxMsg(`已放置：${c.name}（${sbxCost(r.it)} 点）`); } else sbxMsg(r.why, true);
    sbxRender();
    return;
  }
  const r = sbxPlace(id, p.x, p.y);
  if (!r.ok) SBX.bad = { x: p.x, y: p.y, t: performance.now() };
  sbxMsg(r.ok ? (r.it.cargo && c.spawn.kind !== 'ship' ? `已装载到 ${sbxEntry(r.it).name}（${sbxShipLoad(r.it).t + sbxShipLoad(r.it).v} / ${sbxShipCap(r.it).t + sbxShipCap(r.it).v}）` : `已放置：${c.name}`) : r.why, !r.ok);
  sbxRender();
}
HOOK.pointer.push((e, kind, p) => {
  if (!sbxOn() || !p) return false;
  SBX.mouse = p;
  if (e.pointerType === 'touch') {   // 触屏：单指点按放置，拖动 / 双指仍为平移缩放
    if (kind !== 'up' || !U.down || !U.down.touch || U.down.moved || U.touches.size > 1) return false;
    U.touches.delete(e.pointerId); U.pinch = null; U.down = null;
    sbxClick(p);
    return true;
  }
  if (kind === 'down') {
    if (e.button === 1 || e.altKey) return false;
    if (e.button === 2) {
      if (SBX.line || SBX.pick) { SBX.line = null; SBX.pick = null; sbxRender(); return true; }
      const it = sbxNearest(p.x, p.y, SBX.side, Math.max(12, px(16)));
      if (it) { sbxRemove(it); sbxMsg('已移除' + sbxEntry(it).name); }
      return true;
    }
    if (e.button !== 0) return false;
    const c = SBX.pick && catalogById(SBX.pick);
    if (c && c.spawn.at === 'line' && !SBX.line) { const r = sbxCheck(c, p.x, p.y); if (r.ok) { SBX.line = { x: p.x, y: p.y }; SBX.lineDown = { sx: e.clientX, sy: e.clientY }; } else sbxMsg(r.why, true); return true; }
    sbxClick(p);
    return true;
  }
  if (kind === 'move') {
    if (SBX.drag) {
      const D = SBX.drag, c = sbxEntry(D.it), r = sbxCheck(c, p.x, p.y, null, null, D.it);
      D.moved = true; D.bad = !r.ok;
      if (r.ok && !r.host) { D.it.x = sbxR(p.x); D.it.y = sbxR(p.y); if (c.spawn.kind === 'dd' || c.spawn.kind === 'cv') sbxSync(); }
      return true;
    }
    SBX.hover = SBX.pick ? null : sbxNearest(p.x, p.y, SBX.side, Math.max(12, px(14)));
    return false;
  }
  if (kind === 'up') {
    if (SBX.drag) { const D = SBX.drag; SBX.drag = null; if (D.moved) { sbxMsg(D.bad ? '该处不能放置，已停在最后的有效位置' : `已移动：${sbxEntry(D.it).name}`, D.bad); sbxRender(); } return true; }
    if (SBX.lineDown && SBX.line) {   // 按住拖拽画线
      const L = SBX.lineDown; SBX.lineDown = null;
      if (Math.hypot(e.clientX - L.sx, e.clientY - L.sy) > 14) { sbxClick(p); return true; }
      sbxMsg('再点终点（Esc 取消）');
      return true;
    }
    return e.button === 0 || e.button === 2;
  }
  return false;
});
HOOK.key.push(e => {
  if (!sbxOn()) return false;
  const k = e.key;
  if (k === 'Escape') { if (SBX.line || SBX.pick || SBX.drag) { SBX.line = null; SBX.pick = null; SBX.drag = null; sbxRender(); return true; } return false; }
  if ((k === 'Delete' || k === 'Backspace') && SBX.mouse) { const it = sbxNearest(SBX.mouse.x, SBX.mouse.y, SBX.side, Math.max(12, px(16))); if (it) { sbxRemove(it); sbxMsg('已移除' + sbxEntry(it).name); } e.preventDefault(); return true; }
  if (k === 'Tab' && !e.target.closest('#sbxPanel')) { SBX.side = SBX.side === 'e' ? 'p' : 'e'; SBX.pick = null; SBX.line = null; sbxRender(); e.preventDefault(); return true; }
  if (k === '=' || k === '+' || k === '-' || k === 'F10') return false;
  return k.length === 1 || k === 'Enter';   // 战斗快捷键在编辑阶段无意义
});
HOOK.frame.push(() => {
  if (sbxOn()) {
    if (typeof document !== 'undefined' && (!SBX.el || !SBX.el.isConnected)) { const o = document.getElementById('sbxPanel'); if (o) o.remove(); SBX.el = null; sbxShow(); }
    if (!SBX.pv) { PV.fill(1); SBX.pv = true; }   // 编辑时全图可见
    if (typeof R === 'object' && R.cv) R.cv.style.cursor = SBX.drag ? 'grabbing' : SBX.pick ? 'crosshair' : SBX.hover ? 'grab' : '';
  }
  // 观战结束：按攻守双方视角给出结果
  if (S && S.over && S.mode === 'sandbox' && S.sbx && S.sbx.live && typeof document !== 'undefined') {
    const t = $('endTitle'), key = S.over + ':' + S.seed + ':' + S.role;
    if (t && t.dataset.over === S.over && SBX.endKey !== key) {
      SBX.endKey = key;
      const sp = S.role === 'spectate';
      if (sp && typeof decode === 'function') decode(t, S.over === 'win' ? '进攻方胜利 · 登陆场巩固' : '防守方胜利 · 登陆被击退', 1100);
      let n = $('sbxEnd');
      if (!n) { n = document.createElement('p'); n.id = 'sbxEnd'; n.style.cssText = 'margin:0;font-size:12px;color:var(--intel)'; $('endStats').after(n); }
      const s0 = S.sbx.spent || { p: 0, e: 0 };
      n.textContent = `沙盒${sp ? ' · 观战 AI 对 AI' : ' · 指挥进攻方'} · 进攻方 ${s0.p} 点 / 防守方 ${s0.e} 点 · 守军 AI ${DIFF[S.level].name}`;
      n.hidden = false;
    }
  } else if (typeof document !== 'undefined' && SBX.endKey && $('sbxEnd')) { $('sbxEnd').hidden = true; SBX.endKey = null; }
});

// ———————————————— 地图绘制（只用形状与颜色，不写字）————————————————
const SBX_HULL = { p_lct: 26, p_lci: 30, p_lcvp: 16, p_lst: 36, p_lsm: 30, p_supply: 32, p_supply_h: 32, p_rocket: 24, p_lcs: 26, p_sweep: 22 };
function sbxRange(c, it) {
  const s = c.spawn, M = s.mod || {};
  if (s.kind === 'enemy') return ({ bunker: 170, coastal: 600, arty: 1100, mortar: 420, aa: 190 })[s.ek] * (M.rng || 1);
  if (s.kind === 'post') return s.r;
  if (s.kind === 'sortie') return s.r || 70;
  if (s.kind === 'einf' || s.kind === 'cargo') return RANGE * (M.rng || 1);
  if (s.kind === 'veh' && typeof VEH_SPEC === 'object' && VEH_SPEC[s.type]) { const g = VEH_SPEC[s.type].gun || VEH_SPEC[s.type].mg; return g ? g.range * (M.rng || 1) : 0; }
  if (s.kind === 'mine') return (it && it.r) || s.r;
  return 0;
}
function sbxGlyph(ctx, c, x, y, col, a, it, ghost) {
  const s = c.spawn, u = Math.max(4.5, px(5.5)), lw = px(1.3), fill = `rgba(2,10,6,${.78 * a})`;
  ctx.save();
  ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.fillStyle = fill; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const dot = (dx, dy, r) => { ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, 6.283); ctx.fill(); ctx.stroke(); };
  const line = (x0, y0, x1, y1, w) => { ctx.lineWidth = w || lw; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.lineWidth = lw; };
  const pips = (n, oy) => { ctx.fillStyle = col; for (let k = 0; k < n; k++) { ctx.beginPath(); ctx.arc(x + (k - (n - 1) / 2) * u * .5, y + oy, u * .13, 0, 6.283); ctx.fill(); } ctx.fillStyle = fill; };
  const variant = CATALOG.filter(o => o.arch === c.arch && o.side === c.side).indexOf(c);
  switch (c.arch) {
    case 'bunker': case 'decoy': {
      const big = c.id === 'e_casemate' ? 1.25 : c.id === 'e_pillbox' ? .75 : 1;
      if (c.arch === 'decoy') ctx.setLineDash([px(2), px(2)]);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - u * big, y - u * .7 * big, u * 2 * big, u * 1.4 * big, u * .35) : ctx.rect(x - u * big, y - u * .7 * big, u * 2 * big, u * 1.4 * big); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      line(x - u * .55 * big, y + u * .15, x + u * .55 * big, y + u * .15, lw * 1.6);
      if (c.id === 'e_at_casemate') line(x, y + u * .7, x, y + u * 1.9, lw * 1.4);
      break;
    }
    case 'coastal': dot(0, 0, u * .9); line(x, y + u * .5, x, y + u * 2.6, lw * 1.8); pips(variant + 1, -u * 1.5); break;
    case 'arty': dot(0, 0, u * .7); line(x + u * .35, y + u * .35, x + u * 1.5, y + u * 1.5, lw * 1.5); if (c.id === 'e_rkt') { line(x - u * .7, y - u * .2, x - u * .1, y + u * .9); line(x - u * .3, y - u * .5, x + u * .3, y + u * .6); } pips(variant + 1, -u * 1.2); break;
    case 'mortar': dot(0, 0, u * .55); line(x, y, x + u * .4, y - u * 1.2, lw * (c.id === 'e_hmortar' ? 2 : 1.3)); break;
    case 'aa': dot(0, 0, u * .7); line(x, y, x - u * .6, y - u * 1.4); line(x, y, x + u * .6, y - u * 1.4); if (c.id === 'e_flak_tower') { ctx.strokeRect(x - u, y - u, u * 2, u * 2); } pips(variant + 1, u * 1.2); break;
    case 'mines': {
      const r = (it && it.r) || s.r, n = s.n || 1;
      ctx.setLineDash([px(2.5), px(2.5)]);
      for (let k = 0; k < n; k++) { ctx.beginPath(); ctx.arc(x + (k - (n - 1) / 2) * r * 1.25, y + (k % 2 ? -r * .35 : 0), r, 0, 6.283); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(x + Math.cos(k * 2.4) * r * .45, y + Math.sin(k * 2.4) * r * .45, s.at2 ? u * .3 : u * .16, 0, 6.283); ctx.fill(); }
      break;
    }
    case 'wire': case 'trench': {
      const x2 = it ? it.x2 : x, y2 = it ? it.y2 : y, P = it && it.pts ? it.pts : c.arch === 'trench' && it && dist(x, y, x2, y2) > 1 ? sbxTrenchPts(it, s) : [[x, y], [x2, y2]];
      if (c.arch === 'trench') {
        ctx.lineWidth = Math.max(px(2.5), 3.5); ctx.strokeStyle = rgba(col, .35 * a);
        ctx.beginPath(); P.forEach(([px_, py_], k) => k ? ctx.lineTo(px_, py_) : ctx.moveTo(px_, py_)); ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = lw;
        if (s.ditch) { ctx.setLineDash([px(3), px(3)]); }
        ctx.beginPath(); P.forEach(([px_, py_], k) => k ? ctx.lineTo(px_, py_) : ctx.moveTo(px_, py_)); ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[P.length - 1][0], P[P.length - 1][1]); ctx.stroke();
        const L = dist(P[0][0], P[0][1], P[P.length - 1][0], P[P.length - 1][1]), st = Math.max(7, px(7)), n = Math.max(1, Math.floor(L / st)), h = Math.max(2.2, px(2.6));
        for (let k = 0; k <= n; k++) {
          const t = k / n, cx = lerp(P[0][0], P[P.length - 1][0], t), cy = lerp(P[0][1], P[P.length - 1][1], t);
          line(cx - h, cy - h, cx + h, cy + h); line(cx - h, cy + h, cx + h, cy - h);
          if (s.rows === 2) { const [nx, ny] = sbxPerp(P[0][0], P[0][1], P[P.length - 1][0], P[P.length - 1][1]); line(cx + nx * 9 - h, cy + ny * 9 - h, cx + nx * 9 + h, cy + ny * 9 + h); }
        }
      }
      break;
    }
    case 'obst': {
      const n = (it && it.n) ?? s.n, h = Math.max(2, px(2.6));
      for (let k = 0; k < n; k++) { const ox = x + (k - (n - 1) / 2) * (s.sp || 14); line(ox - h, y - h, ox + h, y + h); line(ox - h, y + h, ox + h, y - h); }
      break;
    }
    case 'post': case 'depot_e': {
      if (c.id === 'e_op') { ctx.beginPath(); ctx.moveTo(x, y - u * 1.1); ctx.lineTo(x + u * .9, y + u * .7); ctx.lineTo(x - u * .9, y + u * .7); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      else if (c.id === 'e_radar') { dot(0, 0, u * .5); ctx.beginPath(); ctx.arc(x, y, u * 1.2, -2.6, -.5); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, u * 1.7, -2.4, -.7); ctx.stroke(); }
      else if (c.id === 'e_slight') { dot(0, 0, u * .55); line(x, y, x - u * .8, y + u * 1.8); line(x, y, x + u * .8, y + u * 1.8); }
      else { ctx.fillRect(x - u * .9, y - u * .7, u * 1.8, u * 1.4); ctx.strokeRect(x - u * .9, y - u * .7, u * 1.8, u * 1.4); line(x - u * .9, y, x + u * .9, y); }
      break;
    }
    case 'inf_e': case 'eng_e': case 'inf_p': case 'eng_p': {
      const n = (it && it.n) ?? s.teams ?? 1, r = u * .32, tri = [[0, -1], [-1, .7], [1, .7]];
      if (s.role === 'ambush') ctx.setLineDash([px(1.5), px(1.5)]);
      for (let k = 0; k < Math.min(n, 9); k++) { const [a1, b1] = tri[k % 3], g = Math.floor(k / 3); dot(a1 * r * 2.2 + (g - (Math.ceil(n / 3) - 1) / 2) * r * 6.5, b1 * r * 2, r); }
      ctx.setLineDash([]);
      if (s.role === 'reserve') line(x - u, y + u * 1.1, x + u, y + u * 1.1);
      break;
    }
    case 'veh': case 'car_e': {
      const f = c.side === 'e' ? 1 : -1, L = u * 1.1, Wd = u * .7;
      ctx.beginPath(); ctx.rect(x - Wd, y - L, Wd * 2, L * 2); ctx.fill(); ctx.stroke();
      if (c.arch === 'car_e' || (s.type === 'recon')) { ctx.fillStyle = col; for (const [dx, dy] of [[-1, -.6], [1, -.6], [-1, .6], [1, .6]]) { ctx.beginPath(); ctx.arc(x + dx * Wd, y + dy * L, u * .16, 0, 6.283); ctx.fill(); } ctx.fillStyle = fill; }
      if (s.type !== 'apc') { dot(0, 0, u * .42); line(x, y + f * u * .4, x, y + f * (u * .4 + (s.type === 'td' || s.type === 'hv_tank' ? u * 1.3 : u)), lw * 1.4); }
      if (s.type === 'amtank' && c.side === 'p') { ctx.beginPath(); ctx.arc(x, y + L + u * .3, u * .8, .4, 2.74); ctx.stroke(); }
      break;
    }
    case 'ship': case 'fire_ship': case 'sweep': {
      const L = SBX_HULL[c.id] || 26, hw = L > 28 ? 6.5 : L > 20 ? 5.5 : 4, k = Math.max(1, px(10) / L * 2.2);
      ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.lineWidth = lw / k;
      ctx.beginPath(); ctx.moveTo(0, -L / 2); ctx.lineTo(hw, -L / 2 + (s.ship === 'assault' || s.ship === 'lst' ? 1.5 : 6)); ctx.lineTo(hw, L / 2); ctx.lineTo(-hw, L / 2); ctx.lineTo(-hw, -L / 2 + (s.ship === 'assault' || s.ship === 'lst' ? 1.5 : 6)); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (it && it.cargo) {   // 装载：小组为圆点，车辆为方块
        const ld = it.cargo.map(catalogById).filter(Boolean);
        ctx.fillStyle = col;
        ld.forEach((o, i) => { const cy = -L / 2 + 5 + i * (L - 8) / Math.max(1, ld.length); if (o.spawn.kind === 'veh') ctx.fillRect(-2.2, cy, 4.4, 3); else { ctx.beginPath(); ctx.arc(0, cy + 1.5, 1.3, 0, 6.283); ctx.fill(); } });
        const cap = sbxShipCap(it), n = cap.t + cap.v, ld2 = ld.length;
        ctx.strokeStyle = rgba(col, .45); for (let i = ld2; i < n; i++) { const cy = -L / 2 + 5 + i * (L - 8) / Math.max(1, n); ctx.beginPath(); ctx.arc(0, cy + 1.5, 1.3, 0, 6.283); ctx.stroke(); }
      }
      if (c.arch === 'fire_ship') { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -L * .15, 1.8, 0, 6.283); ctx.fill(); }
      if (c.arch === 'sweep') { ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(-hw, L / 2); ctx.lineTo(-hw - 6, L / 2 + 8); ctx.moveTo(hw, L / 2); ctx.lineTo(hw + 6, L / 2 + 8); ctx.stroke(); ctx.setLineDash([]); }
      ctx.restore();
      break;
    }
    case 'sortie': {
      const r = s.r || 70;
      ctx.globalAlpha = a * .4; ctx.setLineDash([px(3), px(5)]); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = a;
      line(x - u, y, x + u, y); line(x, y - u, x, y + u);
      break;
    }
    default: dot(0, 0, u * .6);
  }
  ctx.restore();
}
function sbxRing(ctx, x, y, r, col, a) {
  if (!(r > 0)) return;
  ctx.save(); ctx.strokeStyle = rgba(col, a); ctx.lineWidth = px(1); ctx.setLineDash([px(5), px(5)]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke(); ctx.restore();
}
function sbxDrawEdit(time) {
  const ctx = R.ctx, side = SBX.side, pick = SBX.pick && catalogById(SBX.pick);
  // 区域提示：集结海域上沿（攻方），岸防炮 300 带（选中岸炮时）
  if (side === 'p' || (pick && pick.spawn.at === 'sea')) {
    ctx.save(); ctx.strokeStyle = rgba(COL.g, .35); ctx.lineWidth = px(1); ctx.setLineDash([px(8), px(6)]);
    ctx.beginPath(); ctx.moveTo(0, STAGING_Y - 100); ctx.lineTo(W, STAGING_Y - 100); ctx.stroke(); ctx.restore();
  }
  if (pick && pick.spawn.at === 'coast') {
    ctx.save(); ctx.strokeStyle = rgba(COL.amber, .35); ctx.lineWidth = px(1); ctx.setLineDash([px(6), px(5)]);
    ctx.beginPath(); for (let x = 0; x <= W; x += 20) { const y = coastAt(x) - 300; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); ctx.restore();
  }
  const flag = sbxFlag();
  for (const it of S.sbx.items) {
    const c = sbxEntry(it);
    if (!c || it.x == null || it === flag || c.spawn.kind === 'cv') continue;
    const mine = it.side === side, col = it.side === 'e' ? COL.enemy : COL.g;
    if (it.plan && mine) {   // 预定登陆点
      ctx.save(); ctx.strokeStyle = rgba(COL.g, .3); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(4)]);
      ctx.beginPath(); ctx.moveTo(it.x, it.y); ctx.lineTo(it.plan.x, it.plan.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = rgba(COL.g, .5); ctx.beginPath(); ctx.arc(it.plan.x, it.plan.y, Math.max(2, px(2.5)), 0, 6.283); ctx.fill(); ctx.restore();
    }
    const drag = SBX.drag && SBX.drag.it === it;
    sbxGlyph(ctx, c, it.x, it.y, drag && SBX.drag.bad ? COL.amber : col, mine ? 1 : .45, it);
  }
  for (const it of [flag, sbxOf('cv')[0]]) { if (it && it.plan && side === 'p') { ctx.save(); ctx.strokeStyle = rgba(COL.g, .3); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(4)]); ctx.beginPath(); ctx.moveTo(it.x, it.y); ctx.lineTo(it.plan.x, it.plan.y); ctx.stroke(); ctx.restore(); } }
  const h = SBX.drag ? SBX.drag.it : SBX.hover;
  if (h) {
    const c = sbxEntry(h), col = h.side === 'e' ? COL.enemy : COL.g;
    ctx.save(); ctx.strokeStyle = rgba(COL.sel, .8); ctx.lineWidth = px(1.2);
    ctx.beginPath(); ctx.arc(h.x2 != null ? (h.x + h.x2) / 2 : h.x, h.x2 != null ? (h.y + h.y2) / 2 : h.y, Math.max(10, px(13)), 0, 6.283); ctx.stroke(); ctx.restore();
    if (c.arch !== 'mines') sbxRing(ctx, h.x, h.y, sbxRange(c, h), col, .35);
  }
  if (SBX.bad && performance.now() - SBX.bad.t < 900) {   // 放置失败的位置
    const B = SBX.bad, d = Math.max(7, px(10)), a = 1 - (performance.now() - B.t) / 900;
    ctx.save(); ctx.strokeStyle = rgba(COL.enemy, a); ctx.lineWidth = px(2); ctx.beginPath(); ctx.moveTo(B.x - d, B.y - d); ctx.lineTo(B.x + d, B.y + d); ctx.moveTo(B.x - d, B.y + d); ctx.lineTo(B.x + d, B.y - d); ctx.stroke(); ctx.restore();
  }
  // 放置预览
  const m = SBX.mouse;
  if (pick && m) {
    if (pick.spawn.at === 'line' && SBX.line) {
      const r = sbxCheck(pick, SBX.line.x, SBX.line.y, m.x, m.y), col = r.ok ? (pick.side === 'e' ? COL.enemy : COL.g) : COL.amber;
      sbxGlyph(ctx, pick, SBX.line.x, SBX.line.y, col, .75, { x: SBX.line.x, y: SBX.line.y, x2: m.x, y2: m.y });
    } else {
      const r = sbxCheck(pick, m.x, m.y), ok = r.ok, col = ok ? (pick.side === 'e' ? COL.enemy : COL.g) : COL.amber;
      if (r.host) { ctx.save(); ctx.strokeStyle = rgba(COL.sel, .9); ctx.lineWidth = px(1.4); ctx.beginPath(); ctx.arc(r.host.x, r.host.y, Math.max(16, px(18)), 0, 6.283); ctx.stroke(); ctx.restore(); }
      if (!r.host) sbxGlyph(ctx, pick, m.x, m.y, col, ok ? .7 : .55, null, true);
      if (!ok) { ctx.save(); ctx.strokeStyle = rgba(COL.enemy, .8); ctx.lineWidth = px(1.6); const d = Math.max(5, px(7)); ctx.beginPath(); ctx.moveTo(m.x - d, m.y - d); ctx.lineTo(m.x + d, m.y + d); ctx.moveTo(m.x - d, m.y + d); ctx.lineTo(m.x + d, m.y - d); ctx.stroke(); ctx.restore(); }
      if (pick.arch !== 'mines' && !r.host) sbxRing(ctx, m.x, m.y, sbxRange(pick), ok ? col : COL.amber, .3);
    }
  }
}
// 推演中：观察哨 / 雷达 / 探照灯；观战时以暗色轮廓显示我方尚未发现的守军部署
function sbxDrawLive(time) {
  const ctx = R.ctx, spec = S.role === 'spectate';
  for (const o of S.sbxObs || []) {
    const c = catalogById(o.kind);
    if (!c || (!spec && !inVision(o.x, o.y) && o.kx == null)) continue;
    sbxGlyph(ctx, c, o.x, o.y, o.dead ? COL.smoke : COL.enemy, o.dead ? .35 : inVision(o.x, o.y) ? .9 : .5, null);
    if (!o.dead && o.r > 0 && spec && inVision(o.x, o.y) && R.s > CAM.fit * 1.5) sbxRing(ctx, o.x, o.y, o.r, COL.enemy, .12);
  }
  if (!spec) return;
  ctx.save(); ctx.globalAlpha = .4; ctx.strokeStyle = COL.enemy; ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(3)]);
  const u = Math.max(4, px(4.5));
  for (const e of S.enemies) if (!e.dead && !inVision(e.x, e.y) && e.kx == null) { ctx.beginPath(); ctx.rect(e.x - u, e.y - u * .7, u * 2, u * 1.4); ctx.stroke(); }
  for (const m of S.mines) if (!m.known && m.clr < 1) { ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.283); ctx.stroke(); }
  for (const w of S.wire) if (!w.known && !w.cut) { ctx.beginPath(); ctx.moveTo(w.x0, w.y0); ctx.lineTo(w.x1, w.y1); ctx.stroke(); }
  ctx.setLineDash([]); ctx.fillStyle = COL.enemy;
  for (const q of S.teams) if (q.side === 'e' && q.men.length && !inVision(q.x, q.y)) { ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.6, px(1.8)), 0, 6.283); ctx.fill(); }
  ctx.restore();
}
HOOK.drawOver.push(time => {
  if (!S || !S.sbx || typeof R !== 'object' || !R.ctx) return;
  if (sbxOn()) sbxDrawEdit(time);
  else if (sbxLive()) sbxDrawLive(time);
});
