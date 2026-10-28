'use strict';
// 视线与寻路：双方可见格（高程、林地/城镇/悬崖/烟幕遮挡）、Dijkstra 流场
const PV = new Uint8Array(GW * GH), EV = new Uint8Array(GW * GH);   // 我方 / 敌方当前可见格
// 视野字节图（0/255），供地形着色器（2D / 3D）与小地图共用
const FOGB = new Uint8Array(GW * GH);
function fogBytes() { const D = typeof CVL_DISP === 'object' ? CVL_DISP : null; for (let i = 0; i < GW * GH; i++) FOGB[i] = PV[i] || (D && D[i]) ? 255 : 0; }   // 隐蔽小组所在格照常显示为可见（conceal.js）
const SMOKE = new Uint8Array(GW * GH);
const MINEC = new Uint8Array(GW * GH);   // 1 = 未发现的雷区，2 = 已标定雷区
const WIREC = new Uint8Array(GW * GH);   // 铁丝网所在格
const OBSC = new Uint8Array(GW * GH);    // 反登陆障碍：1 未发现，2 已发现
const CRATERC = new Uint8Array(GW * GH);   // 弹坑：提供少量掩护
let fieldGen = 0;
const FIELDS = new Map();
// 流场按通行类别分组失效：舰船只看障碍，车辆看障碍与雷区（铁丝网只慢 1.2 倍，不重算），步兵看雷区与铁丝网；地形（炸桥 / 修桥）变了全部重算
const FGEN = { ship: 0, veh: 0, inf: 0 }, FG_PREV = { m: new Uint8Array(GW * GH), w: new Uint8Array(GW * GH), o: new Uint8Array(GW * GH), t: new Uint8Array(GW * GH), ter: null };
const fgKey = cls => cls === 'ship' ? 'ship' : cls === 'veh' || cls === 'vehe' || cls === 'amph' ? 'veh' : 'inf';
// 「能不能走」的版本（连通分量 compOf 用）：只有地形变了（炸桥、修桥）才加——雷区、铁丝网只改代价，滩头障碍只挡几格，都不重算连通
const FPASS = { ship: 0, veh: 0, inf: 0 };

const inVision = (x, y) => PV[ci(x, y)] === 1;
const spotted = (x, y) => EV[ci(x, y)] === 1;

function eachCellIn(x, y, rad, fn) {
  for (let gy = Math.max(0, Math.floor((y - rad) / CELL)); gy <= Math.min(GH - 1, Math.floor((y + rad) / CELL)); gy++)
    for (let gx = Math.max(0, Math.floor((x - rad) / CELL)); gx <= Math.min(GW - 1, Math.floor((x + rad) / CELL)); gx++)
      if (dist(gx * CELL + 5, gy * CELL + 5, x, y) <= rad) fn(gy * GW + gx);
}

function smokeMask() {
  SMOKE.fill(0);
  for (const s of S.smoke) if (s.until > S.t) eachCellIn(s.x, s.y, s.r * Math.min(1, (s.until - S.t) / 6), i => { SMOKE[i] = 1; });
}

// 射线投射：地表坡度不低于此前最高遮挡坡度即可见
// 同一位置（6 以内）、视高相同、视距不更远的源不重复投射（同一个排挤在一处的几个组、编队的飞机）
const VIS_DIR = new Map();
function visDirs(n) {
  let d = VIS_DIR.get(n);
  if (!d) { d = new Float64Array(n * 2); for (let k = 0; k < n; k++) { const a = k / n * 6.2832; d[k * 2] = Math.cos(a); d[k * 2 + 1] = Math.sin(a); } VIS_DIR.set(n, d); }
  return d;
}
// 每格的地面视线高度、遮挡顶高（地面 + 林地 / 城镇 / 悬崖的附加高度），只随地图变（炸桥、修桥是河流 ↔ 桥梁，两者都是 0 遮挡、同一高程）
const VIS_G = new Float64Array(GW * GH), VIS_B = new Float64Array(GW * GH), VIS_KEY = { ter: null, seed: null };
function visPrep() {
  if (VIS_KEY.ter === TER && VIS_KEY.seed === TER.seed) return;
  VIS_KEY.ter = TER; VIS_KEY.seed = TER.seed;
  for (let i = 0; i < GW * GH; i++) { const t = TER.type[i], g = isWater(t) ? 0 : TER.elev[i] * ELEV_H; VIS_G[i] = g; VIS_B[i] = g + TP[t].bl; }
}
const VIS_ST = [1];   // 射线步长 1, 1.7, 2.4 …（格），与逐次累加 .7 得到的值完全相同；视距更远时再往后补
function castVision(out, sources) {
  out.fill(0);
  visPrep();
  const done = [];
  for (const s of sources) {
    const h = s.h || .35;
    let dup = false;
    for (const o of done) if (o.h === h && o.r >= s.r && Math.abs(o.x - s.x) < 6 && Math.abs(o.y - s.y) < 6) { dup = true; break; }
    if (dup) continue;
    done.push({ x: s.x, y: s.y, r: s.r, h });
    const gx0 = s.x / CELL, gy0 = s.y / CELL, i0 = ci(s.x, s.y), rc = s.r / CELL;
    const eye = VIS_G[i0] + h;
    out[i0] = 1;
    const n = Math.ceil(rc * 7.5), D = visDirs(n);
    while (VIS_ST[VIS_ST.length - 1] + .7 <= rc) VIS_ST.push(VIS_ST[VIS_ST.length - 1] + .7);
    let ns = 0;
    while (ns < VIS_ST.length && VIS_ST[ns] <= rc) ns++;
    for (let k = 0; k < n; k++) {
      const dx = D[k * 2], dy = D[k * 2 + 1];
      let maxS = -1e9;
      for (let j = 0; j < ns; j++) {
        const st = VIS_ST[j], fx = gx0 + dx * st, fy = gy0 + dy * st;
        if (fx < 0 || fy < 0 || fx >= GW || fy >= GH) break;
        const i = (fy | 0) * GW + (fx | 0);
        if ((VIS_G[i] - eye) / st >= maxS - .02) out[i] = 1;
        const top = (VIS_B[i] - eye) / st;
        if (top > maxS) maxS = top;
        if (SMOKE[i]) break;
      }
    }
  }
}

function addCrater(x, y, r) {
  S.craters.push({ x, y, r });
  if (S.craters.length > 260) S.craters.shift();
  eachCellIn(x, y, r, i => { CRATERC[i] = 1; });
}
function rebuildCraters() { CRATERC.fill(0); for (const c of S.craters) eachCellIn(c.x, c.y, c.r, i => { CRATERC[i] = 1; }); }

// 工事网格（地雷/铁丝网/障碍）变化后重建并让寻路缓存失效
function rebuildForts() {
  MINEC.fill(0); WIREC.fill(0); OBSC.fill(0);
  for (const m of S.mines) if (m.clr < 1) eachCellIn(m.x, m.y, m.r, i => { MINEC[i] = m.known ? 2 : Math.max(MINEC[i], 1); });
  for (const w of S.wire) if (!w.cut) {
    const n = Math.ceil(dist(w.x0, w.y0, w.x1, w.y1) / 5);
    for (let s = 0; s <= n; s++) WIREC[ci(lerp(w.x0, w.x1, s / n), lerp(w.y0, w.y1, s / n))] = 1;
  }
  for (const o of S.obst) if (!o.dead) OBSC[ci(o.x, o.y)] = o.known ? 2 : 1;
  fieldGen++;
  const diff = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true; return false; };
  const t = FG_PREV.ter !== TER || diff(TER.type, FG_PREV.t), m = diff(MINEC, FG_PREV.m), w = diff(WIREC, FG_PREV.w), o = diff(OBSC, FG_PREV.o);
  if (t || o) FGEN.ship++;
  if (t || o || m) FGEN.veh++;
  if (t || m || w) FGEN.inf++;
  if (t) { FPASS.ship++; FPASS.inf++; FPASS.veh++; }   // 障碍（滩头几格）发现 / 清除不重算连通：只是局部绕行，流场的代价里照样算
  FG_PREV.m.set(MINEC); FG_PREV.w.set(WIREC); FG_PREV.o.set(OBSC); FG_PREV.t.set(TER.type); FG_PREV.ter = TER;
}

// cls：'p' 我方步兵（只回避已知雷区），'e' 守军（熟悉自己的雷区），'ship' 舰船，
// 'raid' 敌袭扰分队（同守军，另外偏好林地/城镇、回避开阔地与我方视野内的格；PV 在流场计算时取快照）
// 车辆：'veh' 我方轮履式（回避已知雷区/障碍，碾过铁丝网）、'vehe' 守军车辆（熟悉自己的雷区与障碍）、'amph' 两栖坦克（另可泅渡深海与浅滩）
// 林地慢、沼泽很慢、悬崖 / 山地不可通行，河流可以涉水（很慢：步兵代价 4、车辆 6、两栖车辆 2.5，所以照样优先走桥和渡口），道路最快
// 车辆爬坡：高地越高越难开（高程 0.5 起每高 0.1 代价加五成）；高程超过 VEH_ELEV 的山头（三维里看就是高山）坦克、车辆一律上不去，只能走公路过山
const VCOST = [Infinity, Infinity, Infinity, 1.25, 4, Infinity, 1, 3, 1.5, Infinity, 5, 6, .8, .72, 1.4, 2.5], VEH_ELEV = .68;
function stepCost(i, cls) {
  const t = TER.type[i];
  if (cls === 'ship') return t === T.DEEP ? (OBSC[i] === 2 ? 4 : 1) : t === T.SHOAL ? (OBSC[i] === 2 ? 6 : 1.6) : Infinity;
  if (cls === 'veh' || cls === 'vehe' || cls === 'amph') {
    let c = cls === 'amph' && (t === T.DEEP || t === T.SHOAL) ? 1.7 : cls === 'amph' && t === T.RIVER ? 2.5 : VCOST[t];
    if (c === Infinity || OBSC[i] === 2 || (cls === 'vehe' && OBSC[i])) return Infinity;
    if (t === T.HILL) { const e = TER.elev[i]; if (e > VEH_ELEV) return Infinity; c *= 1 + (e - .5) * 5; }
    if (MINEC[i] && (cls === 'vehe' || MINEC[i] === 2)) c *= cls === 'vehe' ? 25 : 8;
    return WIREC[i] ? c * 1.2 : c;
  }
  const sp = spInf(t);   // 河流：涉水，代价 4
  if (!sp) return Infinity;
  let c = 1 / sp;
  const ec = cls === 'e' || cls === 'raid';
  if (MINEC[i] && (ec || MINEC[i] === 2)) c *= ec ? 25 : 6;
  if (WIREC[i]) c *= ec ? 1.5 : 3;
  if (cls === 'raid') c *= (t === T.FOREST || t === T.TOWN ? .7 : t === T.FIELD || t === T.ROAD || t === T.BEACH ? 1.6 : 1) * (PV[i] ? 3 : 1);
  return c;
}

function nearestPassable(i, cls) {
  if (stepCost(i, cls) < Infinity) return i;
  const x = cellCX(i), y = cellCY(i);
  for (let r = 1; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const gx = (x / CELL | 0) + dx, gy = (y / CELL | 0) + dy;
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
    if (stepCost(gy * GW + gx, cls) < Infinity) return gy * GW + gx;
  }
  return -1;
}

const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
const NDX = NB.map(n => n[0]), NDY = NB.map(n => n[1]), NDM = NB.map(n => n[2]);

// 流场缓存：地形/工事变化只让版本号递增；每个推演步最多重算 FBUDGET 个，超出时先用旧流场，避免大地图卡顿
let FBUDGET = 3, FCOUNT = 0;   // FCOUNT：累计重算次数（性能统计）
const COSTS = new Map();
const HEAP_N = new Int32Array(GW * GH * 4), HEAP_P = new Float64Array(GW * GH * 4);   // 堆满了就不再压入（n < HEAP_N.length）；惰性删除的堆实际很少超过两倍格数，大地图上省一半内存
// 通行代价按地形版本缓存（同一版本内多个流场共用，大地图上省掉每次整图重算）；raid 依赖实时视野，每次重算。
//   交战中铁丝网、雷区几乎每秒都在变：同一类别最多每 2.5 秒整图重算一次（raid 每秒），晚两秒生效无所谓——大地图上每次重算近五十万格
const fgNow = () => typeof S === 'object' && S && S.phase === 'battle' && isFinite(S.t) ? S.t : null;
function costArr(cls, gen, force) {
  let C = COSTS.get(cls);
  const now = fgNow(), fresh = C && C.t != null && now != null && now - C.t >= 0 && now - C.t < (cls === 'raid' ? 1 : 2.5);
  if (!C || (force && C.gen !== gen) || ((C.gen !== gen || cls === 'raid') && !fresh)) { C = { gen, t: now, a: (C && C.a) || new Float32Array(GW * GH) }; for (let k = 0; k < GW * GH; k++) C.a[k] = stepCost(k, cls); COSTS.set(cls, C); }
  return C.a;
}
// 连通分量（按通行类别缓存）：能不能开到只看两格是否同属一片，不必为了判断可达整图算一遍流场。
//   只在地形变了（FPASS：炸桥、修桥）时重算——交战中雷区、铁丝网、滩头障碍一直在变，但不影响大片地区连不连通；fresh 参数留着兼容旧调用
const COMPS = new Map();
function compOf(cls, fresh) {
  const gen = FPASS[fgKey(cls)], now = typeof S === 'object' && S && S.phase === 'battle' && isFinite(S.t) ? S.t : null;
  let C = COMPS.get(cls);
  if (C && C.gen === gen) return C.a;
  const cost = costArr(cls, FGEN[fgKey(cls)], true), a = (C && C.a) || new Int32Array(GW * GH), st = HEAP_N;
  a.fill(0);
  let id = 0;
  for (let k0 = 0; k0 < GW * GH; k0++) {
    if (a[k0] || cost[k0] === Infinity) continue;
    a[k0] = ++id; let n = 0; st[n++] = k0;
    while (n) {
      const i = st[--n], gx = i % GW, gy = (i / GW) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = gx + NDX[k], ny = gy + NDY[k];
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const j = ny * GW + nx;
        if (!a[j] && cost[j] !== Infinity) { a[j] = id; st[n++] = j; }
      }
    }
  }
  COMPS.set(cls, { gen, t: now, a });
  return a;
}
// (x0, y0) 能否走到 (x1, y1)（目标不可通行时按最近的可通行格，与 field 一致）
function reachable(x0, y0, x1, y1, cls) {
  const j = nearestPassable(ci(x1, y1), cls);
  if (j < 0) return false;
  const i = ci(x0, y0), a = compOf(cls);
  if (a[i] > 0 && a[i] === a[j]) return true;
  const b = compOf(cls, true);   // 判不通时用最新地形再确认（3 秒内的旧分量可能还没算上刚炸开的通路）
  return b[i] > 0 && b[i] === b[j];
}
// 目标点附近有可通行格（field 不会返回 null）——只判断这个时不必真去算流场
const fieldOk = (x, y, cls) => nearestPassable(ci(x, y), cls) >= 0;
// A* 寻路（单位自己的路线：代价与流场相同，启发值按最便宜的地形（公路）× 1.2 加权——只搜起终点之间的一小片，比整图流场快几十倍）
// 返回途经各格中心 [x, y, x, y, …]（不含起点格，起点即终点为空数组）；搜了 maxN 格还没到返回 null（改用流场）
const AS_G = new Float64Array(GW * GH), AS_FROM = new Int32Array(GW * GH), AS_SEEN = new Uint32Array(GW * GH);
let AS_STAMP = 0;
function astar(s, g, cls, maxN = Math.round(40000 * Math.max(1, GW * GH / 117600))) {   // 搜索上限按地图面积放大：大地图上远距离路线也用 A*，不退回整图流场
  if (g < 0) return null;
  if (s === g) return [];
  const cost = costArr(cls, FGEN[fgKey(cls)]), stamp = ++AS_STAMP, mc = (cls === 'ship' ? 1 : .72) * 1.2, gx = g % GW, gy = (g / GW) | 0;
  const h = i => { const dx = Math.abs(i % GW - gx), dy = Math.abs(((i / GW) | 0) - gy); return (Math.max(dx, dy) + .414 * Math.min(dx, dy)) * mc; };
  let n = 0, cnt = 0, found = false;
  const push = (i, p) => {
    let k = n++;
    while (k > 0) { const pa = (k - 1) >> 1; if (HEAP_P[pa] <= p) break; HEAP_N[k] = HEAP_N[pa]; HEAP_P[k] = HEAP_P[pa]; k = pa; }
    HEAP_N[k] = i; HEAP_P[k] = p;
  };
  AS_SEEN[s] = stamp; AS_G[s] = 0; AS_FROM[s] = -1; push(s, h(s));
  while (n) {
    const i = HEAP_N[0], p = HEAP_P[0], li = HEAP_N[--n], lp = HEAP_P[n];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && HEAP_P[c + 1] < HEAP_P[c]) c++;
      if (HEAP_P[c] >= lp) break;
      HEAP_N[k] = HEAP_N[c]; HEAP_P[k] = HEAP_P[c]; k = c;
    }
    HEAP_N[k] = li; HEAP_P[k] = lp;
    if (i === g) { found = true; break; }
    if (p > AS_G[i] + h(i) || ++cnt > maxN) { if (cnt > maxN) break; continue; }
    const ix = i % GW, iy = (i / GW) | 0, c0 = cost[i];
    for (let k2 = 0; k2 < 8; k2++) {
      const nx = ix + NDX[k2], ny = iy + NDY[k2];
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const j = ny * GW + nx, cj = cost[j];
      if (cj === Infinity) continue;
      const nd = AS_G[i] + (cj + c0) * .5 * NDM[k2];
      if ((AS_SEEN[j] !== stamp || nd < AS_G[j]) && n < HEAP_N.length) { AS_SEEN[j] = stamp; AS_G[j] = nd; AS_FROM[j] = i; push(j, nd + h(j)); }
    }
  }
  if (!found) return null;
  const out = [];
  for (let i = g; i !== s; i = AS_FROM[i]) out.push(cellCY(i), cellCX(i));
  return out.reverse();
}
function field(tx, ty, cls) {
  const ti = nearestPassable(ci(tx, ty), cls);
  if (ti < 0) return null;
  const key = cls + ti, f = FIELDS.get(key), gen = FGEN[fgKey(cls)], now = typeof S === 'object' && S && S.phase === 'battle' && isFinite(S.t) ? S.t : null;
  // 交战中 3 秒内（大地图 6 秒）算过的流场：工事网格又变了也先照用（炮火连连时铁丝网、雷区几乎每秒在变，每变一次就整图重算太卡；大地图上一次要几百毫秒）
  if (f && (f.gen === gen || FBUDGET <= 0 || (now != null && f.t != null && now - f.t >= 0 && now - f.t < (GW * GH > 200000 ? 6 : 3)))) { FIELDS.delete(key); FIELDS.set(key, f); return f.d; }
  FBUDGET--; FCOUNT++;
  const d = f ? f.d : new Float32Array(GW * GH);   // 距离表用 Float32：大地图上一张近 2 MB，缓存几十张也不吃光手机内存
  d.fill(Infinity);
  const cost = costArr(cls, gen);
  let n = 0;
  const push = (i, p) => {
    let k = n++;
    while (k > 0) { const pa = (k - 1) >> 1; if (HEAP_P[pa] <= p) break; HEAP_N[k] = HEAP_N[pa]; HEAP_P[k] = HEAP_P[pa]; k = pa; }
    HEAP_N[k] = i; HEAP_P[k] = p;
  };
  d[ti] = 0; push(ti, 0);
  while (n) {
    const i = HEAP_N[0], p = HEAP_P[0], li = HEAP_N[--n], lp = HEAP_P[n];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && HEAP_P[c + 1] < HEAP_P[c]) c++;
      if (HEAP_P[c] >= lp) break;
      HEAP_N[k] = HEAP_N[c]; HEAP_P[k] = HEAP_P[c]; k = c;
    }
    HEAP_N[k] = li; HEAP_P[k] = lp;
    if (p > d[i]) continue;
    const gx = i % GW, gy = (i / GW) | 0, c0 = cost[i];
    for (let k2 = 0; k2 < 8; k2++) {
      const nx = gx + NDX[k2], ny = gy + NDY[k2];
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const j = ny * GW + nx, cj = cost[j];
      if (cj === Infinity) continue;
      const nd = Math.fround(p + (cj + c0) * .5 * NDM[k2]);   // 按 Float32 取整后再比、再压堆，和距离表里存的一致
      if (nd < d[j] && n < HEAP_N.length) { d[j] = nd; push(j, nd); }
    }
  }
  FIELDS.delete(key);
  FIELDS.set(key, { d, gen, t: now });
  while (FIELDS.size > (GW * GH > 200000 ? 32 : 48)) FIELDS.delete(FIELDS.keys().next().value);
  return d;
}

// 局部流场：只在 (x0, y0)、(tx, ty) 外扩 pad 格的小窗口里算（近距离绕行、近距离可达性检查用，不进全图流场缓存）；
// 返回 {d 窗口距离图, gx0, gy0, w, h}，窗口超过 LOCF.max 格返回 null（交给全图流场）
const LOCF = { max: 2500, d: new Float64Array(2500), hn: new Int32Array(2500 * 8), hp: new Float64Array(2500 * 8) };
function localField(x0, y0, tx, ty, cls, pad = 6) {
  const gx0 = Math.max(0, Math.floor(Math.min(x0, tx) / CELL) - pad), gy0 = Math.max(0, Math.floor(Math.min(y0, ty) / CELL) - pad);
  const gx1 = Math.min(GW - 1, Math.floor(Math.max(x0, tx) / CELL) + pad), gy1 = Math.min(GH - 1, Math.floor(Math.max(y0, ty) / CELL) + pad);
  const w = gx1 - gx0 + 1, h = gy1 - gy0 + 1;
  if (w * h > LOCF.max) return null;
  const ti = nearestPassable(ci(tx, ty), cls);
  if (ti < 0) return null;
  const tx0 = ti % GW - gx0, ty0 = ((ti / GW) | 0) - gy0;
  if (tx0 < 0 || ty0 < 0 || tx0 >= w || ty0 >= h) return null;
  const d = LOCF.d, HN = LOCF.hn, HP = LOCF.hp;
  d.fill(Infinity, 0, w * h);
  let n = 0;
  const push = (i, p) => { let k = n++; while (k > 0) { const pa = (k - 1) >> 1; if (HP[pa] <= p) break; HN[k] = HN[pa]; HP[k] = HP[pa]; k = pa; } HN[k] = i; HP[k] = p; };
  const t0 = ty0 * w + tx0;
  d[t0] = 0; push(t0, 0);
  while (n) {
    const i = HN[0], p = HP[0], li = HN[--n], lp = HP[n];
    let k = 0;
    for (;;) { let c = 2 * k + 1; if (c >= n) break; if (c + 1 < n && HP[c + 1] < HP[c]) c++; if (HP[c] >= lp) break; HN[k] = HN[c]; HP[k] = HP[c]; k = c; }
    HN[k] = li; HP[k] = lp;
    if (p > d[i]) continue;
    const lx = i % w, ly = (i / w) | 0, c0 = stepCost((ly + gy0) * GW + lx + gx0, cls);
    for (let k2 = 0; k2 < 8; k2++) {
      const nx = lx + NDX[k2], ny = ly + NDY[k2];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const cj = stepCost((ny + gy0) * GW + nx + gx0, cls);
      if (cj === Infinity) continue;
      const j = ny * w + nx, nd = p + (cj + c0) * .5 * NDM[k2];
      if (nd < d[j] && n < HN.length) { d[j] = nd; push(j, nd); }
    }
  }
  return { d, gx0, gy0, w, h };
}
// 局部流场里 (x, y) 的距离（窗口外为 Infinity）与下降一步
function localAt(L, x, y) { const gx = Math.floor(x / CELL) - L.gx0, gy = Math.floor(y / CELL) - L.gy0; return gx < 0 || gy < 0 || gx >= L.w || gy >= L.h ? Infinity : L.d[gy * L.w + gx]; }
function localNext(L, x, y) {
  const gx = Math.floor(x / CELL) - L.gx0, gy = Math.floor(y / CELL) - L.gy0;
  if (gx < 0 || gy < 0 || gx >= L.w || gy >= L.h) return null;
  let best = -1, bv = L.d[gy * L.w + gx];
  for (let k = 0; k < 8; k++) {
    const nx = gx + NDX[k], ny = gy + NDY[k];
    if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) continue;
    const j = ny * L.w + nx;
    if (L.d[j] < bv) { bv = L.d[j]; best = j; }
  }
  return best < 0 ? null : [((best % L.w) + L.gx0) * CELL + CELL / 2, (((best / L.w) | 0) + L.gy0) * CELL + CELL / 2];
}

// 路点缓存（每个单位 u.fpth 一条）：从流场沿下降方向取出前方最多 50 格的路点，单位照着走；走完、偏离 off（默认 30）以上、
// 地形版本变了 3 秒以上才重新取（最快 0.8 秒一次）——不再每帧都查整图流场（目标点一多，流场缓存装不下，每帧都整图重算，画面卡顿）
// fget()：取流场；look(x0, y0, x1, y1)：能否直线走到（往前最多看 ahead 个路点，路线顺直）
// 返回 null 没有流场 / { no } 走不到 / { end } 已在流场终点格 / { x, y } 下一个瞄准点
function pathStep(u, tx, ty, cls, fget, look, ahead = 2, off = 30) {
  const gen = FGEN[fgKey(cls)];
  let P = u.fpth;
  if (P && (P.tx !== tx || P.ty !== ty || P.cls !== cls)) P = null;
  if (P) {
    while (P.i < P.p.length && dist(u.x, u.y, P.p[P.i], P.p[P.i + 1]) < 12) P.i += 2;
    const bad = (P.i >= P.p.length && !P.full) || (P.i < P.p.length && dist(u.x, u.y, P.p[P.i], P.p[P.i + 1]) > off) || (P.gen !== gen && S.t - P.t > 3);
    if (bad && S.t - P.t > .8) P = null;
  }
  if (!P) {
    const i0 = ci(u.x, u.y), cost = costArr(cls, gen);
    let p = null, full = true;
    if (cost[i0] !== Infinity && cls !== 'raid') {   // 先看连通、再用 A* 只搜起终点之间的一片；单位站在不可通行格上（被挤进河边等）仍按流场下降走出来
      if (!reachable(u.x, u.y, tx, ty, cls)) { u.fpth = null; return { no: true }; }
      p = astar(i0, nearestPassable(ci(tx, ty), cls), cls);
      if (p && !p.length) { u.fpth = null; return { end: true }; }
    }
    if (!p) {
      const f = fget();
      if (!f) { u.fpth = null; return null; }
      if (!isFinite(f[i0])) { u.fpth = null; return { no: true }; }
      if (f[i0] < 1) { u.fpth = null; return { end: true }; }
      p = []; full = false;
      let x = u.x, y = u.y;
      for (let k = 0; k < 50; k++) { const s = nextStep(f, x, y); if (!s) { full = true; break; } [x, y] = s; p.push(x, y); }
    }
    P = u.fpth = { tx, ty, cls, gen, t: S.t, p, i: 0, full };
  }
  if (P.i >= P.p.length) return P.full ? { end: true } : null;
  let x = P.p[P.i], y = P.p[P.i + 1];
  for (let k = 2; k <= ahead * 2 && P.i + k < P.p.length; k += 2) { const nx = P.p[P.i + k], ny = P.p[P.i + k + 1]; if (!look(u.x, u.y, nx, ny)) break; x = nx; y = ny; }
  return { x, y };
}

// 沿流场下降一步：返回下一格中心，已在目标格返回 null
function nextStep(d, x, y) {
  const i = ci(x, y), gx = i % GW, gy = (i / GW) | 0;
  let best = -1, bv = d[i];
  for (const [dx, dy] of NB) {
    const nx = gx + dx, ny = gy + dy;
    if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
    const j = ny * GW + nx;
    if (d[j] < bv) { bv = d[j]; best = j; }
  }
  return best < 0 ? null : [cellCX(best), cellCY(best)];
}
