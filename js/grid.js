'use strict';
// 视线与寻路：双方可见格（高程、林地/城镇/悬崖/烟幕遮挡）、Dijkstra 流场
const PV = new Uint8Array(GW * GH), EV = new Uint8Array(GW * GH);   // 我方 / 敌方当前可见格
const SMOKE = new Uint8Array(GW * GH);
const MINEC = new Uint8Array(GW * GH);   // 1 = 未发现的雷区，2 = 已标定雷区
const WIREC = new Uint8Array(GW * GH);   // 铁丝网所在格
const OBSC = new Uint8Array(GW * GH);    // 反登陆障碍：1 未发现，2 已发现
const CRATERC = new Uint8Array(GW * GH);   // 弹坑：提供少量掩护
let fieldGen = 0;
const FIELDS = new Map();

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
function castVision(out, sources) {
  out.fill(0);
  for (const s of sources) {
    const gx0 = s.x / CELL, gy0 = s.y / CELL, i0 = ci(s.x, s.y), rc = s.r / CELL;
    const eye = (isWater(TER.type[i0]) ? 0 : TER.elev[i0] * ELEV_H) + (s.h || .35);
    out[i0] = 1;
    const n = Math.ceil(rc * 7.5);
    for (let k = 0; k < n; k++) {
      const a = k / n * 6.2832, dx = Math.cos(a), dy = Math.sin(a);
      let maxS = -1e9;
      for (let st = 1; st <= rc; st += .7) {
        const fx = gx0 + dx * st, fy = gy0 + dy * st;
        if (fx < 0 || fy < 0 || fx >= GW || fy >= GH) break;
        const i = (fy | 0) * GW + (fx | 0), t = TER.type[i];
        const ground = isWater(t) ? 0 : TER.elev[i] * ELEV_H;
        if ((ground - eye) / st >= maxS - .02) out[i] = 1;
        const top = (ground + TP[t].bl - eye) / st;
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
  fieldGen++; FIELDS.clear();
}

// cls：'p' 我方步兵（只回避已知雷区），'e' 守军（熟悉自己的雷区），'ship' 舰船
function stepCost(i, cls) {
  const t = TER.type[i];
  if (cls === 'ship') return t === T.DEEP ? (OBSC[i] === 2 ? 4 : 1) : t === T.SHOAL ? (OBSC[i] === 2 ? 6 : 1.6) : Infinity;
  const sp = TP[t].sp;
  if (!sp) return Infinity;
  let c = 1 / sp;
  if (MINEC[i] && (cls === 'e' || MINEC[i] === 2)) c *= cls === 'e' ? 25 : 6;
  if (WIREC[i]) c *= cls === 'e' ? 1.5 : 3;
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

function field(tx, ty, cls) {
  const ti = nearestPassable(ci(tx, ty), cls);
  if (ti < 0) return null;
  const key = cls + ti + ':' + fieldGen;
  let d = FIELDS.get(key);
  if (d) return d;
  if (FIELDS.size > 48) FIELDS.delete(FIELDS.keys().next().value);
  d = new Float64Array(GW * GH).fill(Infinity);   // 双精度：避免与堆优先级比较时的舍入误差
  const heap = [ti], pr = [0];
  d[ti] = 0;
  const push = (i, p) => {
    let k = heap.length; heap.push(i); pr.push(p);
    while (k > 0) { const pa = (k - 1) >> 1; if (pr[pa] <= p) break; heap[k] = heap[pa]; pr[k] = pr[pa]; k = pa; }
    heap[k] = i; pr[k] = p;
  };
  const pop = () => {
    const top = heap[0], tp = pr[0], li = heap.pop(), lp = pr.pop();
    if (heap.length) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && pr[c + 1] < pr[c]) c++;
        if (pr[c] >= lp) break;
        heap[k] = heap[c]; pr[k] = pr[c]; k = c;
      }
      heap[k] = li; pr[k] = lp;
    }
    popP = tp;
    return top;
  };
  let popP = 0;
  const cost = new Float64Array(GW * GH);
  for (let k = 0; k < GW * GH; k++) cost[k] = stepCost(k, cls);
  while (heap.length) {
    const i = pop(), p = popP;
    if (p > d[i]) continue;
    const gx = i % GW, gy = (i / GW) | 0, c0 = cost[i];
    for (let k = 0; k < 8; k++) {
      const nx = gx + NDX[k], ny = gy + NDY[k];
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const j = ny * GW + nx, cj = cost[j];
      if (cj === Infinity) continue;
      const nd = p + (cj + c0) * .5 * NDM[k];
      if (nd < d[j]) { d[j] = nd; push(j, nd); }
    }
  }
  FIELDS.set(key, d);
  return d;
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
