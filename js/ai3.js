'use strict';
// 守军 AI（三）：小股部队渗透袭扰补给线与孤立小组、装甲车机动支援、被逼近时炸桥（我方工兵可修复）
// 存档数据全在 S 里：S.raids 进行中的袭扰 · S.armor 装甲车 · S.blown 被炸桥梁 · S.a3 计时器、炸桥判定与情报记忆
const A3D = {
  normal: { cars: 1, carT: 200, raidMax: 1, raidGap: 150, spawnGap: 240, blow: .5, first: 150 },
  hard: { cars: 2, carT: 140, raidMax: 2, raidGap: 100, spawnGap: 150, blow: .8, first: 100 },
  hell: { cars: 4, carT: 80, raidMax: 3, raidGap: 60, spawnGap: 90, blow: .95, first: 70 }
};
const a3D = () => A3D[S && S.level] || A3D.hard;
const A3 = { ter: null, err: {}, strict: false, reindex: false };   // 非存档缓存：已应用炸桥改动的地形对象；出错只报一次
const A3_LEN = 18;   // 装甲车车长（世界单位）
const a3IsBridge = k => /^B\d+$/.test(k);   // B1..B3 是桥，BT/BT2 是炮台

function a3Init() {
  const D = a3D();
  if (!S.a3) S.a3 = { raidT: 20, next: D.first, spawnNext: D.first + 60, roll: {}, seen: {}, seenT: 0, bridgeT: 0, lineT: 0 };
  if (!S.raids) S.raids = [];
  if (!S.blown) S.blown = [];
  if (!S.armor) a3CarInit();
}

function a3Run(f, dt) {
  try { f(dt); } catch (e) {
    if (A3.strict) throw e;
    if (!A3.err[f.name]) { A3.err[f.name] = 1; console.error('ai3: ' + f.name, e); }
  }
}

function updateAI3(dt) {
  if (!S || !TER || !S.points) return;
  a3Sync(); a3Init();
  a3Run(updateRaids, dt); a3Run(updateArmor, dt); a3Run(updateBridges, dt);
}

// 读档后 buildMap 会重建地形：把仍未修复的炸桥改动重新应用到新地形上
function a3Sync() {
  if (!S || !TER || A3.ter === TER) return;
  A3.ter = TER;
  let ch = false;
  for (const b of S.blown || []) if (b.prog < 1) for (const i of b.cells) if (TER.type[i] === T.BRIDGE) { TER.type[i] = T.RIVER; ch = true; }
  if (ch) { rebuildForts(); a3Dirty(); }
}

// 地形改变后让各处缓存失效：着色器地形纹理、像素降级图、小地图底图、据点掩体表、小组直线判定
function a3Dirty() {
  if (typeof MX !== 'undefined' && MX) MX.seed = null;
  if (typeof R !== 'undefined' && R) R.pixSeed = null;
  if (typeof MM !== 'undefined' && MM) MM.seed = null;
  if (typeof aiCache === 'function') aiCache();
  if (S) for (const q of S.teams) q.pathT = -9;
}

const a3Snap = (x, y, cls) => {
  const j = nearestPassable(ci(x, y), cls || 'e');
  return j < 0 ? null : { x: cellCX(j), y: cellCY(j) };
};
const a3Men = ts => ts.reduce((a, q) => a + q.men.length, 0);
const a3SeenP = () => S.teams.filter(q => q.side === 'p' && q.men.length && spotted(q.x, q.y));

// ———————————————— 袭扰 ————————————————
const a3Key = t => t.kind + ':' + Math.round(t.x / 20) + ',' + Math.round(t.y / 20);

// 补给目标：陆上补给网（supplynet.js，可能不存在）+ 浮桥补给站与浮桥段（兜底）
function a3SupplyList() {
  const out = [], keys = new Set();
  const add = t => {
    if (!t || !isFinite(t.x) || !isFinite(t.y)) return;
    t.key = a3Key(t);
    if (keys.has(t.key)) return;
    keys.add(t.key); out.push(t);
  };
  if (typeof supplyTargets === 'function') for (const t of supplyTargets() || []) if (t) add({ kind: t.kind, x: t.x, y: t.y, value: t.value || 1, st: t });
  for (const L of S.supply || []) {
    if (L.segs && L.segs.length && L.segs[0].ok) add({ kind: 'depot', x: L.x, y: L.y, value: 3, line: L.id, fb: true });
    L.segs.forEach((g, i) => { if (g.ok) add({ kind: 'seg', x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2, value: 1.5, line: L.id, seg: i, fb: true }); });
  }
  return out;
}

// 全部候选目标：补给目标 + 与其他友军相距 220 以上的孤立小组（工兵组价值更高）
function a3Targets() {
  const out = a3SupplyList(), pT = S.teams.filter(q => q.side === 'p' && q.men.length);
  for (const q of pT) {
    if (pT.some(o => o !== q && dist(o.x, o.y, q.x, q.y) < 220)) continue;
    out.push({ kind: 'team', x: q.x, y: q.y, value: 1 + q.men.length * .3 + (q.kind === 'eng' ? 2 : 0), team: q.id, key: 'team:' + q.id });
  }
  return out;
}

// 守军是否知道这个目标：正被看见、近期被看见、滩头登记过，或有巡逻队在附近
function a3Known(t) {
  if (spotted(t.x, t.y)) return true;
  if (t.kind === 'team') return false;
  const s = S.a3.seen[t.key];
  if (s != null && S.t - s < 300) return true;
  if (t.kind === 'depot' && S.ai && S.ai.reg && S.ai.reg.some(r => dist(r.x, r.y, t.x, t.y) < 90)) return true;
  return S.teams.some(q => q.side === 'e' && q.men.length && dist(q.x, q.y, t.x, t.y) < 260);
}

function a3Spot() {
  const A = S.a3;
  for (const t of a3SupplyList()) if (spotted(t.x, t.y)) A.seen[t.key] = S.t;
  for (const k of Object.keys(A.seen)) if (S.t - A.seen[k] > 400) delete A.seen[k];
}

// 可抽调的预备队：空闲、未受攻击、所属据点平静、350 以内没有看得见的我方部队
function a3Sources() {
  const seenP = a3SeenP();
  return S.teams.filter(q => {
    if (q.side !== 'e' || q.role !== 'reserve' || q.men.length < 2 || q.raid || (typeof a4Busy === 'function' && a4Busy(q))) return false;
    if (q.order.t !== 'hold' && q.order.t !== 'move') return false;
    if (S.t - q.hitT < 30 || q.sup > 20) return false;
    const u = unitOf(q);
    if (u && u.state === 'rout') return false;
    const p = ptByKey(q.obj);
    if (p && (p.owner === 'p' || p.prog > .1 || p.contested)) return false;
    return !seenP.some(o => dist(o.x, o.y, q.x, q.y) < 350);
  });
}

// 目标附近能站上去的格（浮桥段在海上时找不到就放弃）
function a3Reach(x, y) {
  const s = a3Snap(x, y, 'raid');
  return s && dist(s.x, s.y, x, y) < 45 ? s : null;
}

function a3Plan() {
  const D = a3D(), A = S.a3;
  if (S.raids.length >= D.raidMax || S.t < A.next) return;
  const busy = new Set(S.raids.map(r => r.key)), tg = a3Targets().filter(t => !busy.has(t.key) && a3Known(t));
  if (!tg.length) return;
  const src = a3Sources(), canSpawn = S.t >= A.spawnNext;
  if (!src.length && !canSpawn) return;
  const seenP = a3SeenP();
  for (const t of tg) {
    let def = 0;
    for (const q of seenP) if (q.id !== t.team && dist(q.x, q.y, t.x, t.y) < 150) def += q.men.length;
    let near = null, nd = 1e9;
    for (const q of src) { const d = dist(q.x, q.y, t.x, t.y); if (d < nd) { nd = d; near = q; } }
    if (!near) nd = t.y + 150;
    t.from = near; t.d = nd;
    t.score = (t.value || 1) * 3 / (1 + def * .35) - nd / 400 + Math.random() * .5;
  }
  tg.sort((a, b) => b.score - a.score);
  for (const t of tg.slice(0, 3)) {
    const end = a3Reach(t.x, t.y), f = end && field(end.x, end.y, 'raid');
    if (!f) continue;
    if (t.from && isFinite(f[ci(t.from.x, t.from.y)])) {
      const party = [t.from], mate = src.find(o => o !== t.from && dist(o.x, o.y, t.from.x, t.from.y) < 120 && isFinite(f[ci(o.x, o.y)]));
      if (mate) party.push(mate);
      a3Launch(t, party, f, end, false);
      return;
    }
    if (!canSpawn) continue;
    // 没有可抽调的预备队：从北界派出新的袭扰分队
    for (let k = 0; k < 3; k++) {
      const s = a3Snap(clamp(t.x + gauss() * 200, 40, W - 40), 15, 'raid');
      if (!s || !isFinite(f[ci(s.x, s.y)]) || s.y > 140) continue;
      const party = [0, 1].map(i => addTeam('e', clamp(s.x + (i ? 9 : -9), 5, W - 5), s.y, ['rifle', 'rifle', 'mg'], { role: 'raider', hold: true }));
      for (const q of party) if (!passInf(q.x, q.y)) { q.x = s.x; q.y = s.y; }
      a3Launch(t, party, f, end, true);
      return;
    }
  }
}

// 沿 'raid' 流场取样一条隐蔽路线（每 4 格一个航点），发起时固定
function a3Path(f, x, y, end) {
  const pts = [];
  let cx = x, cy = y;
  for (let k = 0; k < 900; k++) {
    const n = nextStep(f, cx, cy);
    if (!n) break;
    [cx, cy] = n;
    if (k % 4 === 3) pts.push([cx, cy]);
  }
  pts.push([end.x, end.y]);
  return pts;
}

function a3Launch(t, party, f, end, spawned) {
  const D = a3D(), id = S.nid++, u = addUnit('e', 'inf', { role: 'raider', raid: id });
  u.morale = Math.min(100, u.morale + 10);
  for (const q of party) Object.assign(q, { role: 'raider', obj: null, raid: id, u: u.id, hold: true, px: null, rwi: 0, order: { t: 'hold' } });
  S.raids.push({
    id, kind: t.kind, key: t.key, tx: t.x, ty: t.y, ex: end.x, ey: end.y, tid: t.team ?? null, fb: !!t.fb, line: t.line ?? null, seg: t.seg ?? null,
    path: a3Path(f, party[0].x, party[0].y, end), teams: party.map(q => q.id), men0: a3Men(party), u: u.id,
    state: 'go', t0: S.t, hitT0: 0, doneT: null, struck: false, seen: false, spawned, hx: null, hy: null, hk: null, backT: 0
  });
  S.a3.next = S.t + D.raidGap;
  if (spawned) S.a3.spawnNext = S.t + D.spawnGap;
  A3.reindex = true;
}

const a3Team = (r, id) => S.teams.find(q => q.id === id && q.men.length && q.raid === r.id);

function a3RaidTick(r, dt) {
  const ts = r.teams.map(id => a3Team(r, id)).filter(Boolean);
  r.teams = ts.map(q => q.id);
  if (!ts.length) { r.done = true; return; }
  if (r.state !== 'back') {
    const routed = ts.some(q => { const u = unitOf(q); return u && u.state === 'rout'; });
    if (routed || a3Men(ts) <= r.men0 * .4 || S.t - r.t0 > 420) a3Withdraw(r, ts);
  }
  if (r.state === 'go') a3Go(r, ts);
  if (r.state === 'hit') a3Hit(r, ts, dt);
  if (r.state === 'back') a3Back(r, ts);
}

// 渗透：逐个航点前进，隐蔽不开火（被打或接近目标 70 以内才还击）
function a3Go(r, ts) {
  const last = r.path.length - 1;
  for (const q of ts) {
    if (q.hold && (S.t - q.hitT < 1.5 || dist(q.x, q.y, r.tx, r.ty) < 70)) q.hold = false;
    let i = Math.min(q.rwi || 0, last);
    while (i < last && dist(q.x, q.y, r.path[i][0], r.path[i][1]) < 16) i++;
    q.rwi = i;
    const [wx, wy] = r.path[i];
    if (q.order.t !== 'move' || q.order.x !== wx || q.order.y !== wy) { q.order = { t: 'move', x: wx, y: wy, gx: r.ex, gy: r.ey }; q.pathT = -9; }
  }
  if (!r.seen && ts.some(q => inVision(q.x, q.y))) { r.seen = true; log('发现小股敌军向我后方渗透', 'warn', 'raidseen', 25, ts[0]); }
  const dEnd = Math.min(...ts.map(q => dist(q.x, q.y, r.ex, r.ey)));
  if (r.kind === 'team') {
    const tg = S.teams.find(q => q.id === r.tid && q.men.length);
    if (!tg) { if (!a3Retarget(r, ts)) a3Withdraw(r, ts); return; }
    if (dEnd < 30 || ts.some(q => dist(q.x, q.y, tg.x, tg.y) < 140)) { r.state = 'hit'; r.hitT0 = S.t; }
  } else if (dEnd < 30) { r.state = 'hit'; r.hitT0 = S.t; }
}

// 破袭：补给目标就地爆破，孤立小组则发起冲锋
function a3Hit(r, ts, dt) {
  for (const q of ts) q.hold = false;
  if (r.kind === 'team') {
    const tg = S.teams.find(q => q.id === r.tid && q.men.length);
    if (!tg && S.t - r.hitT0 < 25 && a3Retarget(r, ts)) return;
    if (!tg || S.t - r.hitT0 > 35 || !ts.some(q => dist(q.x, q.y, tg.x, tg.y) < 260)) { a3Withdraw(r, ts); return; }
    for (const q of ts) if (q.order.t !== 'charge' || dist(q.order.x, q.order.y, tg.x, tg.y) > 12) { q.order = { t: 'charge', x: tg.x, y: tg.y, gx: tg.x, gy: tg.y }; q.pathT = -9; }
    if (!r.struck) { r.struck = true; log('敌袭扰分队突袭我方孤立小组', 'bad', 'raidhit' + r.id, 20, tg); }
    return;
  }
  const cur = a3SupplyList().find(t => t.key === r.key);
  if (!cur && r.doneT == null && a3Retarget(r, ts)) return;   // 目标已被别人破坏：就近另找一个
  if (!cur || S.t - r.hitT0 > 45 || (r.doneT != null && S.t - r.doneT > 4)) { a3Withdraw(r, ts); return; }
  let on = false;
  for (const q of ts) {
    const d = dist(q.x, q.y, r.ex, r.ey);
    if (d < 30) on = true;
    if (d > 14 && (q.order.t !== 'move' || q.order.x !== r.ex || q.order.y !== r.ey)) { q.order = { t: 'move', x: r.ex, y: r.ey, gx: r.ex, gy: r.ey }; q.pathT = -9; }
  }
  if (!on) return;
  if (!r.struck) { r.struck = true; log('补给线遭敌袭', 'bad', 'raid' + r.id, 20, { x: r.tx, y: r.ty }); }
  // hitSupply 返回 false 表示目标已被摧毁/切断：稍作停留即撤
  const intact = cur.fb ? (a3Cut(cur), false) : typeof hitSupply === 'function' ? hitSupply(cur.st, 6 * dt) !== false : false;
  if (!intact && r.doneT == null) r.doneT = S.t;
  if (inVision(r.tx, r.ty) && Math.random() < dt * 3) S.fx.push({ kind: 'flash', x: r.tx + gauss() * 6, y: r.ty + gauss() * 6, r: 5, life: 0, max: .35, side: 'e' });
}

// 原目标已失效：在 300 以内另找一个已知、可抵达且无人袭扰的补给目标（每次袭扰最多两次）
function a3Retarget(r, ts) {
  if ((r.re || 0) >= 2) return false;
  const lead = ts[0], busy = new Set(S.raids.filter(o => o !== r).map(o => o.key));
  let best = null, bd = 300;
  for (const t of a3SupplyList()) {
    const d = dist(t.x, t.y, lead.x, lead.y);
    if (d < bd && !busy.has(t.key) && a3Known(t)) { const end = a3Reach(t.x, t.y); if (end) { bd = d; best = { t, end }; } }
  }
  const f = best && field(best.end.x, best.end.y, 'raid');
  if (!f || !isFinite(f[ci(lead.x, lead.y)])) {
    // 没有补给目标：突袭附近看得见、援兵不多的我方小组（优先工兵）
    const men = a3Men(ts), seenP = a3SeenP();
    let tq = null, ts0 = -1e9;
    for (const q of seenP) {
      const d = dist(q.x, q.y, lead.x, lead.y);
      if (d > 220) continue;
      const sup = seenP.reduce((a, o) => a + (dist(o.x, o.y, q.x, q.y) < 120 ? o.men.length : 0), 0);
      if (sup > men * 1.5) continue;
      const sc = (q.kind === 'eng' ? 2 : 0) - d / 100 - sup * .1;
      if (sc > ts0) { ts0 = sc; tq = q; }
    }
    if (!tq) return false;
    Object.assign(r, { re: (r.re || 0) + 1, kind: 'team', key: 'team:' + tq.id, tid: tq.id, tx: tq.x, ty: tq.y, ex: tq.x, ey: tq.y, fb: false, state: 'hit', hitT0: S.t, doneT: null, struck: false });
    return true;
  }
  const { t, end } = best;
  Object.assign(r, { re: (r.re || 0) + 1, kind: t.kind, key: t.key, tx: t.x, ty: t.y, ex: end.x, ey: end.y, fb: !!t.fb, line: t.line ?? null, seg: t.seg ?? null,
    path: a3Path(f, lead.x, lead.y, end), state: 'go', hitT0: 0, doneT: null });
  for (const q of ts) q.rwi = 0;
  return true;
}

// 兜底：没有补给网模块时直接切断浮桥段
function a3Cut(t) {
  const L = (S.supply || []).find(l => l.id === t.line);
  if (!L) return;
  const g = L.segs[t.kind === 'seg' ? t.seg : 0];
  if (g && g.ok) { g.ok = false; g.rep = 0; L.connected = false; }
}

// 撤离：退往最近的己方据点，到达后编入该据点的预备队
function a3Withdraw(r, ts) {
  r.state = 'back'; r.backT = S.t;
  const cx = ts.reduce((a, q) => a + q.x, 0) / ts.length, cy = ts.reduce((a, q) => a + q.y, 0) / ts.length;
  let home = null, bd = 1e9;
  for (const p of S.points) if (p.owner === 'e' && p.prog < .5) { const d = dist(p.x, p.y, cx, cy) + (p.contested ? 300 : 0); if (d < bd) { bd = d; home = p; } }
  const hq = ptByKey('HQ') || S.points[0], s = home ? a3Snap(home.x, home.y, 'e') : a3Snap(clamp(cx, 40, W - 40), 20, 'e');
  r.hx = s ? s.x : cx; r.hy = s ? s.y : cy; r.hk = home ? home.key : hq && hq.key;
  for (const q of ts) { q.hold = false; aiGo(q, r.hx, r.hy, 'retreat', r.hx, r.hy); }
}

function a3Back(r, ts) {
  for (const q of ts) {
    // 被击溃时 aiRout 会把撤退目标改成默认据点，这里改回
    if (q.order.t === 'retreat' && (q.order.gx !== r.hx || q.order.gy !== r.hy)) aiGo(q, r.hx, r.hy, 'retreat', r.hx, r.hy);
    if (q.order.t !== 'retreat' || dist(q.x, q.y, r.hx, r.hy) < 45 || S.t - r.backT > 240) a3Join(q, r);
  }
}

function a3Join(q, r) {
  const k = r.hk && ptByKey(r.hk) ? r.hk : S.points[0] && S.points[0].key;
  Object.assign(q, { role: 'reserve', obj: k, raid: null, hold: false, px: null, rwi: 0 });
  if (k && typeof aiUnitFor === 'function') q.u = aiUnitFor(k).id;
  if (q.order.t === 'retreat' && dist(q.x, q.y, r.hx, r.hy) < 45) q.order = { t: 'hold' };
  A3.reindex = true;
}

function updateRaids(dt) {
  a3Init();
  const A = S.a3;
  if ((A.seenT -= dt) <= 0) { A.seenT = 2; a3Spot(); }
  for (const r of S.raids) a3RaidTick(r, dt);
  if (S.raids.some(r => r.done)) S.raids = S.raids.filter(r => !r.done);
  if ((A.raidT -= dt) <= 0) { A.raidT = 20; a3Plan(); }
  if (A3.reindex) { A3.reindex = false; indexUnits(); }
}

// ———————————————— 装甲车 ————————————————
function a3CarInit() {
  const D = a3D(), towns = ['T1', 'T2'].map(k => ptByKey(k)).filter(Boolean);
  if (!towns.length) { const hq = ptByKey('HQ') || S.points[0]; if (hq) towns.push(hq); }
  S.armor = [];
  if (!towns.length) return;
  for (let k = 0; k < D.cars; k++) {
    const tw = towns[k % towns.length], sp = a3Park(tw);
    S.armor.push({
      id: S.nid++, x: sp.x, y: sp.y, heading: SOUTH, aim: SOUTH, hp: 30, maxhp: 30, cd: 1 + k * .3, order: null, dead: false, kx: null, ky: null, kh: null, seen: -99,
      px: sp.x, py: sp.y, home: tw.key, mode: 'park', moving: false, think: k * .5, fireT: -99, hitT: -99, hurt: false, deadT: null
    });
  }
}

// 停车位：镇子背面（北侧）的道路或城镇格，彼此错开
function a3Park(tw) {
  let best = null, bs = -1e9;
  eachCellIn(tw.x, tw.y, 90, i => {
    const t = TER.type[i];
    if (!TP[t].sp || t === T.BRIDGE || t === T.FORD || MINEC[i]) return;
    const x = cellCX(i), y = cellCY(i), d = dist(x, y, tw.x, tw.y);
    if (d < 25) return;
    const crowd = S.armor.some(a => dist(a.x, a.y, x, y) < 30);
    const sc = (t === T.ROAD ? 2 : t === T.TOWN ? 1 : 0) + (y < tw.y ? .8 : 0) - (crowd ? 5 : 0) - d / 120 + Math.random() * .3;
    if (sc > bs) { bs = sc; best = { x, y }; }
  });
  return best || a3Snap(tw.x, tw.y - 30, 'e') || { x: tw.x, y: tw.y };
}

// 选择去向：700 以内受威胁或失守的据点（分值高、近的优先）；受损严重则回停车位
function a3CarThink(a) {
  if (a.hp < a.maxhp * .3 && !a.hurt) { a.hurt = true; if (inVision(a.x, a.y)) log('敌装甲车受损后撤', 'good', 'achurt' + a.id, 30, a); }
  if (a.hurt && a.hp >= a.maxhp * .5) a.hurt = false;
  if (a.hurt) { a.order = { x: a.px, y: a.py, r: 6, k: null }; a.mode = 'back'; return; }
  if (S.t < a3D().carT) { a.order = null; a.mode = 'park'; return; }   // 登陆初期车组仍在集结，暂不出动
  let best = null, bs = -1e9;
  for (const p of S.points) {
    const d = dist(a.x, a.y, p.x, p.y), lost = p.owner === 'p';
    if (d > 700 || !(lost || p.prog > .2 || p.contested)) continue;
    const sc = p.vp * 2 + (lost ? 1 : 0) + (p.contested ? 1 : 0) - d / 300 + (a.order && a.order.k === p.key ? .8 : 0);
    if (sc > bs) { bs = sc; best = p; }
  }
  if (!best) { a.order = { x: a.px, y: a.py, r: 6, k: null }; a.mode = 'park'; return; }
  // 守军正对该据点反击时抵近到 40 掩护，否则在 90 外火力支援
  const push = S.teams.some(q => q.side === 'e' && q.men.length && (q.order.t === 'amove' || q.order.t === 'charge') && q.order.gx != null && dist(q.order.gx, q.order.gy, best.x, best.y) < 60);
  a.order = { x: best.x, y: best.y, r: push ? 40 : 90, k: best.key }; a.mode = 'go';
}

// 沿守军流场（偏好道路）行驶，速度 24 × 地形系数，转向有角速度限制
function a3Drive(a, dt) {
  const g = a.order;
  a.moving = false;
  if (!g || dist(a.x, a.y, g.x, g.y) <= g.r) return;
  const f = field(g.x, g.y, 'e');
  if (!f) return;
  let tx = g.x, ty = g.y;
  const n = nextStep(f, a.x, a.y);
  if (n) [tx, ty] = n;
  const l = dist(a.x, a.y, tx, ty);
  if (l < .01) return;
  const want = Math.atan2(ty - a.y, tx - a.x), da = Math.atan2(Math.sin(want - a.heading), Math.cos(want - a.heading));
  a.heading += clamp(da, -3 * dt, 3 * dt);
  const sp = Math.min(l, 24 * Math.max(.3, TP[typeAt(a.x, a.y)].sp) * dt * (Math.abs(da) > 1.2 ? .45 : 1));
  let nx = a.x + (tx - a.x) / l * sp, ny = a.y + (ty - a.y) / l * sp;
  for (const o of S.armor) if (o !== a && !o.dead) {
    const d = dist(nx, ny, o.x, o.y);
    if (d < 14 && d > .01) { nx += (nx - o.x) / d * (14 - d) * .2; ny += (ny - o.y) / d * (14 - d) * .2; }
  }
  if (passInf(nx, ny)) { a.x = nx; a.y = ny; a.moving = true; }
  else if (passInf(nx, a.y)) { a.x = nx; a.moving = true; }   // 斜穿格角受阻时沿单轴滑过
  else if (passInf(a.x, ny)) { a.y = ny; a.moving = true; }
}

// 车载机枪：行进间射击 180 以内被看见的我方小组，4 发 / 1.2 秒（行进间与远距离命中下降），轻度偏好通讯兵
function a3CarFire(a, D) {
  let best = null, bd = 180;
  for (const q of S.teams) if (q.side === 'p' && q.men.length) {
    const d = dist(a.x, a.y, q.x, q.y);
    if (d < bd && (d < 50 || spotted(q.x, q.y))) { bd = d; best = q; }
  }
  if (!best) { a.cd = .6; return; }
  a.cd = 1.2; a.aim = Math.atan2(best.y - a.y, best.x - a.x); a.fireT = S.t;
  const def = coverAt(best.x, best.y) * shelter(best, a.x, a.y) * (SMOKE[ci(best.x, best.y)] ? .4 : 1);
  for (let s = 0; s < 4; s++) {
    suppress(best, 10, a.x, a.y);
    if (best.men.length && Math.random() < .12 * def * D.acc * (1 - bd / 180 * .5) * (a.moving ? .6 : 1)) killMan(best, Math.random() < D.radio ? 'radio' : null);
  }
  const vis = inVision(a.x, a.y);
  tracer(a.x, a.y, best.x + gauss() * 5, best.y + gauss() * 5, 'e', vis);
  tracer(a.x, a.y, best.x + gauss() * 8, best.y + gauss() * 8, 'e', vis);
  if (!vis) log(`遭装甲车机枪扫射，方位约 ${fmtBrg(bearing(best.x, best.y, a.x, a.y) + gauss() * 14)}`, 'warn', 'acmg' + a.id, 9, best);
}

// 冲锋中的我方小组：附近没有别的目标时扑向装甲车，贴近 20 以内投掷手榴弹（每组 2 点/秒）
function a3Grenades(a, dt) {
  let n = 0;
  for (const q of S.teams) {
    if (q.side !== 'p' || q.kind !== 'inf' || !q.men.length || q.order.t !== 'charge' || q.sup >= 85) continue;
    const d = dist(q.x, q.y, a.x, a.y);
    if (d < 20) { n++; continue; }
    if (d > 70 || S.teams.some(o => o.side === 'e' && o.men.length && dist(o.x, o.y, q.x, q.y) < 90) || S.enemies.some(e => !e.dead && dist(e.x, e.y, q.x, q.y) < 90)) continue;
    const sp = Math.min(d - 12, 22 * (TP[typeAt(q.x, q.y)].sp || .5) * dt), nx = q.x + (a.x - q.x) / d * sp, ny = q.y + (a.y - q.y) / d * sp;
    if (sp > 0 && passInf(nx, ny)) { q.x = nx; q.y = ny; q.movedT = S.t; q.heading = Math.atan2(a.y - q.y, a.x - q.x); }
  }
  if (!n) return;
  if (Math.random() < dt * 2.5 * n) S.fx.push({ kind: 'flash', x: a.x + gauss() * 5, y: a.y + gauss() * 5, r: 6, life: 0, max: .35, side: 'p' });
  damageArmor(a, 2 * n * dt);
}

function damageArmor(a, dmg) {
  if (!a || a.dead || !(dmg > 0)) return;
  a.hp -= dmg; a.hitT = S.t;
  if (a.hp > 0) return;
  Object.assign(a, { hp: 0, dead: true, moving: false, deadT: S.t, kx: a.x, ky: a.y, kh: a.heading, order: null });
  S.stats.structs++;
  S.fx.push({ kind: 'boom', x: a.x, y: a.y, r: 26, life: 0, max: 1.3, side: 'e' });
  log(inVision(a.x, a.y) ? '击毁敌装甲车' : '远处殉爆，疑似敌装甲车被毁', 'good', null, 0, a);
}

// 爆炸伤害（由 impact() 调用）：轻武器无效；伤害 = struct 或 ship×3，随距离衰减；守军自己的炮弹不计
function armorImpact(x, y, R0, pw, side) {
  if (!S || !S.armor || !pw || side === 'e') return;
  const r = (R0 || pw.R || 20) + 8, base = pw.struct || (pw.ship || 0) * 3;
  if (!(base > 0)) return;
  for (const a of S.armor) if (!a.dead) { const d = dist(x, y, a.x, a.y); if (d < r) damageArmor(a, base * (1 - d / r * .5)); }
}

// 守军视野源（并入 EV）
function armorVisionSources() { return (S && S.armor || []).filter(a => !a.dead).map(a => ({ x: a.x, y: a.y, r: 170, h: .8 })); }
const armorNear = (x, y, r) => !!(S && S.armor && S.armor.some(a => !a.dead && dist(a.x, a.y, x, y) < r));

function updateArmor(dt) {
  a3Init();
  const D = aiD();
  for (const a of S.armor) {
    // 我方情报：看得见就记下位置；回头再看已空则撤销标定
    if (PV[ci(a.x, a.y)] === 1) {
      if (a.seen < 0 && !a.dead) log('发现敌装甲车：轻武器无效，用舰炮、空袭或冲锋投弹对付', 'warn', null, 0, a);
      a.kx = a.x; a.ky = a.y; a.kh = a.heading; a.seen = S.t;
    } else if (a.kx != null && !a.dead && dist(a.kx, a.ky, a.x, a.y) > 20 && PV[ci(a.kx, a.ky)] === 1) a.kx = a.ky = a.kh = null;
    if (a.dead) continue;
    a3Grenades(a, dt);
    if (a.dead) continue;
    if ((a.think -= dt) <= 0) { a.think = 2; a3CarThink(a); }
    a3Drive(a, dt);
    if ((a.cd -= dt) <= 0) a3CarFire(a, D);
    else if (S.t - a.fireT > 3) a.aim += clamp(Math.atan2(Math.sin(a.heading - a.aim), Math.cos(a.heading - a.aim)), -2 * dt, 2 * dt);
    // 停车且远离战斗时缓慢抢修到半血
    if (a.mode === 'park' && !a.moving && a.hp < a.maxhp * .5 && S.t - a.hitT > 30) a.hp = Math.min(a.maxhp * .5, a.hp + .1 * dt);
  }
}

// ———————————————— 炸桥与修桥 ————————————————
const isBlown = key => !!(S && S.blown && S.blown.some(b => b.key === key && b.prog < 1));

function a3Blow(p) {
  const cells = [];
  eachCellIn(p.x, p.y, 45, i => { if (TER.type[i] === T.BRIDGE) cells.push(i); });
  if (!cells.length) return false;
  impact(p.x, p.y, { men: .55, ship: 0, struct: 0, seg: false, R: 24 }, 'e');
  for (const i of cells) TER.type[i] = T.RIVER;
  for (const i of cells) if (Math.random() < .35) S.fx.push({ kind: 'boom', x: cellCX(i), y: cellCY(i), r: 14, life: 0, max: 1.1, side: 'e' });
  S.blown.push({ key: p.key, name: p.name, x: p.x, y: p.y, cells, prog: 0, t: S.t });
  if (typeof cmdOnBlow === 'function') cmdOnBlow(S.blown[S.blown.length - 1]);   // 守军指挥官当场下达的炸桥命令
  // 落水者游回最近的岸边
  for (const q of S.teams) if (q.men.length && !passInf(q.x, q.y)) { const s = a3Snap(q.x, q.y, q.side === 'p' ? 'p' : 'e'); if (s) { q.x = s.x; q.y = s.y; } }
  for (const a of S.armor || []) if (!a.dead && !passInf(a.x, a.y)) { const s = a3Snap(a.x, a.y, 'e'); if (s) { a.x = s.x; a.y = s.y; } }
  rebuildForts(); a3Dirty();
  log(`守军炸毁了${p.name}，需工兵抵近修复`, 'bad', null, 0, p);
  return true;
}

// 修桥：桥头 40 以内待命（坚守/排障且已到位）的我方工兵组推进进度，3 人满编 30 秒
function a3Repair(b, dt) {
  let rate = 0;
  for (const q of S.teams) {
    if (q.side !== 'p' || q.kind !== 'eng' || !q.men.length || q.repairing) continue;
    const o = q.order;
    if ((o.t !== 'hold' && o.t !== 'clear') || (o.x != null && dist(q.x, q.y, o.x, o.y) > 8) || dist(q.x, q.y, b.x, b.y) >= 40) continue;
    rate += q.men.length / 3; q.working = true;
  }
  if (!rate) return;
  b.prog = Math.min(1, b.prog + dt / 30 * rate);
  if (b.prog < 1) return;
  for (const i of b.cells) if (TER.type[i] === T.RIVER) TER.type[i] = T.BRIDGE;
  rebuildForts(); a3Dirty();
  log(`工兵修复了${b.name || '桥梁'}`, 'good', null, 0, b);
}

// 被炸桥所在的河（离桥最近的一条）及某点位于哪一岸
function a3River(b) {
  let best = -1, bd = 60;
  (TER.rivers || []).forEach((rv, k) => { const d = Math.abs(riverX(k, clamp(Math.floor(b.y / CELL), 0, GH - 1)) - b.x); if (d < bd) { bd = d; best = k; } });
  return best;
}
const a3Bank = (k, x, y) => x < riverX(k, clamp(Math.floor(y / CELL), 0, GH - 1)) ? -1 : 1;

// 炸桥后守军沿河布防：桥头守备队若被分到对岸的阵位，改在己方一侧河岸找掩体
function a3RiverLine(b) {
  const k = a3River(b);
  if (k < 0) return;
  for (const q of S.teams) {
    if (q.side !== 'e' || !q.men.length || q.obj !== b.key || q.px == null) continue;
    if (q.order.t === 'retreat' || q.order.t === 'amove' || q.order.t === 'charge') continue;
    const side = a3Bank(k, q.x, q.y);
    if (a3Bank(k, q.px, q.py) === side) continue;
    let best = null, bs = -1e9;
    eachCellIn(b.x, b.y, 75, i => {
      const x = cellCX(i), y = cellCY(i);
      if (!TP[TER.type[i]].sp || a3Bank(k, x, y) !== side || dist(x, y, b.x, b.y) < 18) return;
      const crowd = S.teams.some(o => o !== q && o.side === 'e' && o.px != null && dist(o.px, o.py, x, y) < 14);
      const sc = (1 - coverAt(x, y)) * 2 - dist(x, y, b.x, b.y) / 80 - (crowd ? 3 : 0) + Math.random() * .2;
      if (sc > bs) { bs = sc; best = { x, y }; }
    });
    if (!best) continue;
    q.px = best.x; q.py = best.y; q.posT = S.t + 600;
    aiGo(q, best.x, best.y, 'move', b.x, b.y);
  }
}

function updateBridges(dt) {
  a3Init();
  const A = S.a3, D = a3D();
  if ((A.bridgeT -= dt) <= 0) {
    A.bridgeT = 1;
    for (const p of S.points) {
      if (!a3IsBridge(p.key) || p.owner !== 'e' || A.roll[p.key] != null || !(p.prog > .2)) continue;
      if (!S.teams.some(q => q.side === 'p' && q.kind === 'inf' && q.men.length && dist(q.x, q.y, p.x, p.y) < 160)) continue;
      A.roll[p.key] = Math.random() < D.blow ? 1 : 0;   // 每座桥只判定一次
      if (!A.roll[p.key] || !a3Blow(p)) {
        S.fx.push({ kind: 'flash', x: p.x, y: p.y, r: 10, life: 0, max: .5, side: 'e' });
        log(`守军炸桥未遂，${p.name}完好`, 'good', null, 0, p);
      }
    }
  }
  for (const b of S.blown) if (b.prog < 1) a3Repair(b, dt);
  if ((A.lineT -= dt) <= 0) { A.lineT = 3; for (const b of S.blown) if (b.prog < 1) a3RiverLine(b); }
}

// ———————————————— 绘制（只用图形，不写字）————————————————
function drawArmor(time) {
  if (!S) return;
  const ctx = R.ctx;
  a3DrawRaids(ctx, time);
  for (const a of S.armor || []) {
    const vis = inVision(a.x, a.y);
    if (a.dead) { if (vis || a.kx != null) a3Wreck(ctx, a, time); continue; }
    if (vis) a3Car(ctx, a.x, a.y, a.heading, a.aim ?? a.heading, true, a, time);
    else if (a.kx != null) a3Car(ctx, a.kx, a.ky, a.kh ?? a.heading, a.kh ?? a.heading, false, a, time);
  }
}

function a3Hull(ctx) {
  ctx.beginPath();
  ctx.moveTo(9, -1.9); ctx.lineTo(9, 1.9); ctx.lineTo(6.4, 3.7); ctx.lineTo(-7.6, 3.7); ctx.lineTo(-9, 2.5);
  ctx.lineTo(-9, -2.5); ctx.lineTo(-7.6, -3.7); ctx.lineTo(6.4, -3.7); ctx.closePath();
}

// 俯视装甲车：车体（前后斜面）、四轮、六角炮塔与机枪；远看画成实心剪影（不糊成一团），看不见时在标定位置画虚线轮廓
function a3Car(ctx, x, y, h, aim, vis, a, time) {
  const k = Math.max(1, px(20) / A3_LEN), det = A3_LEN * k * R.s >= 40, lw = px(1.3) / k;
  const al = vis ? 1 : clamp(.6 - (S.t - a.seen) / 120, .25, .6);
  ctx.save(); ctx.translate(x, y);
  if (vis && a.moving && det) for (let i = 0; i < 4; i++) {   // 行进扬尘（近看才画，远看保持剪影干净）
    const u = (time * 1.6 + i / 4) % 1, d = (10 + u * 14) * k, s = Math.sin(i * 2.3) * 3 * k;
    ctx.fillStyle = rgba(COL.smoke, .16 * (1 - u));
    ctx.beginPath(); ctx.arc(-Math.cos(h) * d - Math.sin(h) * s, -Math.sin(h) * d + Math.cos(h) * s, (2 + u * 4) * k, 0, 7); ctx.fill();
  }
  ctx.rotate(h); ctx.scale(k, k);
  ctx.lineWidth = lw; ctx.strokeStyle = rgba(COL.enemy, .95 * al);
  if (!vis) ctx.setLineDash([px(2.5) / k, px(2) / k]);
  if (det || !vis) for (const wx of [-5.6, 5.2]) for (const s of [-1, 1]) {   // 车轮
    ctx.beginPath(); ctx.rect(wx - 2.1, s * 4.7 - 1.1, 4.2, 2.2);
    if (vis) { ctx.fillStyle = 'rgba(10,2,4,.95)'; ctx.fill(); }
    ctx.stroke();
  } else {
    ctx.fillStyle = rgba(COL.enemy, .55);
    for (const wx of [-5.6, 5.2]) for (const s of [-1, 1]) ctx.fillRect(wx - 2, s * 4.7 - 1, 4, 2);
  }
  a3Hull(ctx);
  ctx.fillStyle = vis ? (det ? 'rgba(28,4,10,.92)' : rgba(COL.enemy, .32)) : rgba(COL.enemy, .06); ctx.fill();
  if (!det && vis) ctx.lineWidth = px(1.6) / k;
  ctx.stroke();
  if (det && vis) {
    ctx.lineWidth = lw * .7; ctx.strokeStyle = rgba(COL.enemy, .55);
    ctx.beginPath(); ctx.moveTo(6.4, -3.7); ctx.lineTo(6.4, 3.7);
    for (let gx = -7.4; gx <= -4.5; gx += .95) { ctx.moveTo(gx, -2.2); ctx.lineTo(gx, 2.2); }   // 发动机格栅
    ctx.stroke();
    ctx.fillStyle = rgba(COL.amber, .75); ctx.fillRect(7.5, -1.7, .8, 1); ctx.fillRect(7.5, .7, .8, 1);   // 观察窗
  }
  ctx.save(); ctx.translate(-.6, 0); ctx.rotate(aim - h);
  ctx.lineWidth = lw; ctx.strokeStyle = rgba(COL.enemy, al);
  if (det || !vis) {
    shape(ctx, 0, 0, 3, 6, Math.PI / 6);
    if (vis) { ctx.fillStyle = 'rgba(44,6,16,.96)'; ctx.fill(); }
    ctx.stroke();
  } else { ctx.fillStyle = 'rgba(30,4,10,.95)'; ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.lineWidth = Math.max(lw * 1.6, px(1.8) / k); ctx.beginPath(); ctx.moveTo(2.4, 0); ctx.lineTo(8.6, 0); ctx.stroke();
  if (det && vis) { ctx.lineWidth = lw * .7; ctx.beginPath(); ctx.arc(-.7, 0, 1.1, 0, 7); ctx.stroke(); }   // 舱盖
  if (vis && S.t - a.fireT < .14) { ctx.fillStyle = rgba(COL.amber, .95); ctx.beginPath(); ctx.arc(9.7, 0, 1.7, 0, 7); ctx.fill(); }
  ctx.restore();
  ctx.setLineDash([]);
  ctx.restore();
  if (!vis) return;
  const bw = 16 * k, by = y + 6.5 * k + px(3);
  ctx.fillStyle = rgba(COL.enemy, .25); ctx.fillRect(x - bw / 2, by, bw, px(2));
  ctx.fillStyle = COL.enemy; ctx.fillRect(x - bw / 2, by, bw * Math.max(0, a.hp) / a.maxhp, px(2));
  if (a.hp < a.maxhp * .5) a3Smoke(ctx, x, y, k, time, det ? .5 : .25);
}

function a3Smoke(ctx, x, y, k, time, a0) {
  for (let i = 0; i < 4; i++) {
    const u = (time * .5 + i / 4) % 1;
    ctx.fillStyle = rgba(COL.smoke, a0 * .35 * (1 - u));
    ctx.beginPath(); ctx.arc(x + Math.sin(i * 1.7 + time) * 2 * k + u * 6 * k, y - u * 16 * k, (2 + u * 5) * k, 0, 7); ctx.fill();
  }
}

function a3Wreck(ctx, a, time) {
  const k = Math.max(1, px(18) / A3_LEN), x = a.x, y = a.y;
  ctx.save(); ctx.translate(x, y); ctx.rotate(a.heading); ctx.scale(k, k);
  ctx.lineWidth = px(1.1) / k; ctx.strokeStyle = rgba(COL.enemy, .35); ctx.setLineDash([px(2) / k, px(2.5) / k]);
  a3Hull(ctx); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(-5, -3); ctx.lineTo(5, 3); ctx.moveTo(5, -3); ctx.lineTo(-5, 3); ctx.stroke();
  ctx.restore();
  const age = S.t - (a.deadT ?? -99);
  if (age < 40) a3Smoke(ctx, x, y, k, time, 1 - age / 40);
}

// 看得见的渗透分队：沿预定路线向前的红色虚线箭头；正在破袭的补给目标闪烁
function a3DrawRaids(ctx, time) {
  for (const r of S.raids || []) {
    if (r.state === 'hit' && r.kind !== 'team' && inVision(r.tx, r.ty)) {
      const u = (time * 1.8) % 1;
      ctx.strokeStyle = rgba(COL.enemy, .8 * (1 - u)); ctx.lineWidth = px(2);
      ctx.beginPath(); ctx.arc(r.tx, r.ty, px(6) + u * px(18), 0, 7); ctx.stroke();
      ctx.strokeStyle = rgba(COL.amber, .5 + .5 * Math.sin(time * 14)); ctx.lineWidth = px(1.4);
      for (let i = 0; i < 4; i++) {
        const a = i * 1.57 + time * 3;
        ctx.beginPath(); ctx.moveTo(r.tx + Math.cos(a) * px(4), r.ty + Math.sin(a) * px(4)); ctx.lineTo(r.tx + Math.cos(a) * px(9), r.ty + Math.sin(a) * px(9)); ctx.stroke();
      }
    }
    if (r.state !== 'go') continue;
    for (const id of r.teams) {
      const q = S.teams.find(o => o.id === id);
      if (!q || !q.men.length || !inVision(q.x, q.y)) continue;
      const i = Math.min(q.rwi || 0, r.path.length - 1), pts = [[q.x, q.y], ...r.path.slice(i, i + 3)];
      if (pts.length < 2) continue;
      ctx.strokeStyle = rgba(COL.enemy, .5); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(4)]);
      ctx.beginPath(); for (const [x, y] of pts) ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
      const [x1, y1] = pts[pts.length - 1], [x0, y0] = pts[pts.length - 2], a = Math.atan2(y1 - y0, x1 - x0);
      ctx.beginPath(); ctx.moveTo(x1 - Math.cos(a - .5) * px(7), y1 - Math.sin(a - .5) * px(7)); ctx.lineTo(x1, y1);
      ctx.lineTo(x1 - Math.cos(a + .5) * px(7), y1 - Math.sin(a + .5) * px(7)); ctx.stroke();
    }
  }
}

// 被炸毁的桥：两端断裂的桥面残段、河中残骸、裂口红色折线、爆炸后余火；修复中画脚手架与进度环
function drawBlown(time) {
  if (!S || !S.blown || !S.blown.length) return;
  a3Sync();
  const ctx = R.ctx;
  for (const b of S.blown) {
    if (b.prog >= 1) continue;
    const x = b.x, y = b.y, age = S.t - (b.t ?? -99), lw = px(1.4);
    ctx.save(); ctx.translate(x, y);
    ctx.lineWidth = lw; ctx.strokeStyle = rgba(STRUCT, .75); ctx.fillStyle = 'rgba(2,10,6,.85)';
    for (const sg of [-1, 1]) {   // 断裂桥面：从桥头伸向河心，末端参差并下垂
      ctx.save(); ctx.translate(sg * 24, 0); ctx.rotate(-sg * .1);
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(-sg * 12, -5); ctx.lineTo(-sg * 10.5, -2); ctx.lineTo(-sg * 13.5, .5);
      ctx.lineTo(-sg * 10, 3); ctx.lineTo(-sg * 12, 5); ctx.lineTo(0, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    const rr = rng((b.cells[0] || 7) * 7919);
    ctx.lineWidth = px(1);
    for (let i = 0; i < 7; i++) {   // 河中残骸
      const dx = (rr() - .5) * 16, dy = (rr() - .5) * 18, s = 1.5 + rr() * 2.5, a = rr() * 3;
      ctx.save(); ctx.translate(dx, dy + Math.sin(time * 1.5 + i) * .4); ctx.rotate(a);
      ctx.fillRect(-s / 2, -s / 4, s, s / 2); ctx.strokeStyle = rgba(STRUCT, .45); ctx.strokeRect(-s / 2, -s / 4, s, s / 2);
      ctx.restore();
    }
    for (let i = 0; i < 2; i++) {   // 水纹
      const u = (time * .4 + i * .5) % 1;
      ctx.strokeStyle = rgba(COL.intel, .3 * (1 - u)); ctx.lineWidth = px(1);
      ctx.beginPath(); ctx.ellipse(0, 0, 6 + u * 10, 4 + u * 8, 0, 0, 7); ctx.stroke();
    }
    const hh = Math.max(10, px(9));   // 裂口：近看远看都清楚的红色折线
    ctx.strokeStyle = rgba(COL.enemy, b.prog > 0 ? .4 : .65 + .3 * Math.sin(time * 4)); ctx.lineWidth = px(2);
    ctx.beginPath(); ctx.moveTo(-2, -hh); ctx.lineTo(2, -hh * .4); ctx.lineTo(-2, hh * .2); ctx.lineTo(2, hh * .7); ctx.lineTo(-1, hh); ctx.stroke();
    if (age < 25) {   // 爆破后余火
      const f = 1 - age / 25;
      for (const sg of [-1, 1]) {
        const fx = sg * 12, g = ctx.createRadialGradient(fx, 0, 0, fx, 0, 9);
        g.addColorStop(0, rgba(COL.amber, .55 * f * (.7 + .3 * Math.sin(time * 17 + sg)))); g.addColorStop(1, rgba(COL.amber, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fx, 0, 9, 0, 7); ctx.fill();
      }
      a3Smoke(ctx, 0, -2, 1, time, f);
    }
    if (b.prog > 0) {   // 工兵架设的临时桥面
      ctx.strokeStyle = rgba(COL.amber, .35 + .5 * b.prog); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(2)]);
      ctx.beginPath(); ctx.moveTo(-12, -3.5); ctx.lineTo(-12 + 24 * b.prog, -3.5); ctx.moveTo(-12, 3.5); ctx.lineTo(-12 + 24 * b.prog, 3.5); ctx.stroke();
      ctx.setLineDash([]);
      for (let i = -11; i <= -11 + 22 * b.prog; i += 3) { ctx.beginPath(); ctx.moveTo(i, -3.5); ctx.lineTo(i, 3.5); ctx.stroke(); }
    }
    ctx.restore();
    if (b.prog > 0) {
      ctx.strokeStyle = COL.amber; ctx.lineWidth = px(2.5);
      ctx.beginPath(); ctx.arc(x, y, 30, -1.57, -1.57 + b.prog * 6.283); ctx.stroke();
    }
  }
}
