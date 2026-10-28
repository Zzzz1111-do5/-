'use strict';
// 航母甲板作业（carrier.js 的 CVG 甲板几何；全用甲板局部坐标 u 舰首、v 右舷，随航母移动；状态都在 S 里）——
//   出动（flyPlane 的 'cat' 阶段，p.dk 分步）：
//     brd  停机位上的飞机：座舱盖打开，飞行员从舰岛舱门或最近的舷边通道口跑到飞机左侧，顺登机梯爬进座舱，座舱盖合上
//     lift 机库里的飞机：升降机先空降到机库甲板，载上飞机升回飞行甲板（飞行员在机库里已登机）
//     eng  启动发动机 → taxi 展开机翼滑出机位（升降机上的向舷内开出），沿甲板滑到所派弹射器偏流板后的等待点
//     hold 弹射器上还有飞机就在偏流板后等 → line 滑上弹射器 → hook 挂弹射杆、偏流板升起、弹射官示意、发动机加力
//   'roll'：电磁弹射，沿弹射器加速到离舰；偏流板随后放下
//   回收（'trap' 阶段）：arr 拦阻索拉停 → 收索、折机翼 → taxi 滑出着舰区 → 甲板有空位：滑到机位前、转向、倒进机位（机尾朝舷外）；
//     甲板停满：滑到升降机舷内侧 → ewait 等升降机 → 倒上平台 → down 降到机库甲板（进机库整备），空平台再升回来
// 停机位：每架舰载机记 w.dk（机位序号；-1 机库；null 不在舰上）。升降机 c.el[i] = { h 平台高度 0 甲板—1 机库, to 目标, w 占用的飞机 id }；
// 偏流板：c.jl[k] 弹射器 k 上一次弹射离舰的时刻（放下的动画）
const CVD = { taxi: 16, rev: 6, run: 9, climb: 1.5, cnp: .8, eng: 1.1, hook: 2.4, acc: 110, elv: .32, pivot: 1.25 };
const cvCat = k => CVG.cats[clamp(k | 0, 0, CVG.cats.length - 1)];
const cvCatPt = (k, s) => { const C = cvCat(k); return [C.u + Math.cos(C.a) * s, C.v + Math.sin(C.a) * s]; };
// 右舷甲板边线（不算升降机缺口）：舷边通道口的位置
const CVD_EDGE = [[158, 13], [118, 16.5], [100, 17], [90, 21], [84, 27], [74, 33], [52, 34], [50, 37], [-116, 37], [-152, 28], [-158, 26]];
function cvEdgeV(u) {
  for (let i = 1; i < CVD_EDGE.length; i++) { const [u0, v0] = CVD_EDGE[i - 1], [u1, v1] = CVD_EDGE[i]; if (u <= u0 && u >= u1) return lerp(v0, v1, (u0 - u) / (u0 - u1 || 1)); }
  return 18;
}
// 斜角着舰区（m 外扩）
function cvInLand(u, v, m = 0) {
  const L = CVG.land, dx = L.u1 - L.u0, dy = L.v1 - L.v0, l2 = dx * dx + dy * dy, t = ((u - L.u0) * dx + (v - L.v0) * dy) / l2, lat = Math.abs(-(u - L.u0) * dy + (v - L.v0) * dx) / Math.sqrt(l2);
  return t > -.1 && t < 1.05 && lat < L.hw + m;
}
function cvDeckInit(c) {
  const n = CVG.cats.length;
  if (!Array.isArray(c.cat) || c.cat.length !== n) c.cat = Array(n).fill(0);
  if (!Array.isArray(c.jl) || c.jl.length !== n) c.jl = Array(n).fill(-99);
  if (!Array.isArray(c.el) || c.el.length !== CVG.el.length) c.el = CVG.el.map(() => ({ h: 0, to: 0, w: null }));
  return c;
}
const cvWingOn = c => S && S.air ? S.air.wing.filter(w => cvHome(w) === cvHome(c) && !airLandW(w)) : [];
const cvLive = c => S.planes.filter(p => !p.dead && cvHome(p) === cvHome(c) && !p.land);
// 机位 j 有没有被占：停着的飞机（含正在登机、还没滑走的）、着舰后正滑向这里的
const cvSlotTaken = (c, j, wing) => wing.some(w => w.dk === j) || cvLive(c).some(p => p.rsv === j);
// 补齐 w.dk：在舰上待命 / 整备还没有位置的（开局、读旧档、中止起飞）先占甲板空位，满了进机库；离舰、损失的清掉
function cvSpots(c) {
  const wing = cvWingOn(c);
  for (const w of wing) if ((w.state === 'out' || w.state === 'return' || w.state === 'lost') && w.dk != null) w.dk = null;
  for (const w of wing) if (w.dk == null && (w.state === 'deck' || w.state === 'rearm')) {
    w.dk = -1;
    for (let j = 0; j < CVG.slots.length; j++) if (!cvSlotTaken(c, j, wing)) { w.dk = j; break; }
  }
  return wing;
}
// 每步：升降机平台移动；占用它的飞机没了（离舰、被毁、进了机库）就放开、空平台升回甲板
function cvDeckStep(c, dt) {
  cvDeckInit(c);
  if (!S.air) return;
  for (const E of c.el) {
    if (E.w != null && !S.planes.some(p => p.id === E.w && !p.dead)) { E.w = null; E.to = 0; }
    E.h = E.h < E.to ? Math.min(E.to, E.h + CVD.elv * dt) : Math.max(E.to, E.h - CVD.elv * dt);
  }
  cvSpots(c);
}
// —— 出动 ——
// 起点：甲板机位（飞行员登机）或机库（等升降机）
function cvLaunchStart(c, w) {
  cvDeckInit(c); cvSpots(c);
  if (w.dk != null && w.dk >= 0 && CVG.slots[w.dk]) { const [u, v, r] = CVG.slots[w.dk]; return { lu: u, lv: v, lh: r, dk: 'brd', slot: w.dk, fold: 1, cpo: 0 }; }
  w.dk = null;
  const e = cvPickEl(c, 'lift'), E = CVG.el[e];
  return { lu: E.u, lv: E.v, lh: -Math.PI / 2, dk: 'lift', el: e, fold: 1, cpo: 0, up: false };
}
// 升降机：先挑排队的飞机少、离得近的一部
function cvPickEl(c, why, from) {
  let best = 0, bs = Infinity;
  CVG.el.forEach((E, i) => {
    const q = cvLive(c).filter(p => p.el === i && (p.dk === 'lift' || p.dk === 'ewait' || p.dk === 'eon' || p.dk === 'down' || (p.dk === 'taxi' && p.rsv === -1))).length;
    const s = q * 12 + (c.el && c.el[i] && c.el[i].w != null ? 6 : 0) + (from ? Math.hypot(E.u - from[0], E.v - from[1]) / 40 : i);
    if (s < bs) { bs = s; best = i; }
  });
  return best;
}
// 着舰作业：有飞机在最后进近 / 刚着舰、或者在 900 以内返航（腰部弹射器在着舰区上，这时不用）
const cvRecov = c => cvLive(c).some(p => p.phase === 'final' || (p.phase === 'trap' && !p.clr) || ((p.phase === 'rtb' || p.phase === 'hold') && dist(p.x, p.y, c.x, c.y) < 900));
// 派弹射器：排队的少、滑过去近的；腰部那条只在没有飞机要降落时用
function cvPickCat(c, p) {
  let best = 0, bs = Infinity;
  const rec = cvRecov(c);
  for (let k = 0; k < CVG.cats.length; k++) {
    if (k === 2 && rec) continue;
    const q = cvLive(c).filter(o => o !== p && o.phase === 'cat' && o.cat === k).length, [hu, hv] = cvCatPt(k, -27);
    const s = q * 9 + Math.hypot(hu - p.lu, hv - p.lv) / CVD.taxi + (k === 2 ? 2 : 0);
    if (s < bs) { bs = s; best = k; }
  }
  return best;
}
// 登机梯：在座舱左侧（机头朝 lh，左 = lh − 90°）。返回 [梯脚 u, v, 座舱 u, v, 机身半宽]
function cvLadder(p) {
  const key = airSilKey(p.kind, p.v), D = typeof AIRD === 'object' && AIRD[key], k = (airMdl(p.kind, p.v).size || 15) / 21;
  const cx = D && D.cp ? (D.cp[0] + D.cp[1]) / 2 : 6, hw = D && D.body ? cvHalfW(D.body, cx) : 1.4;
  const ca = Math.cos(p.lh), sa = Math.sin(p.lh), lx = cx * k, ly = -(hw + 1.2) * k, cu = p.lu + ca * lx, cv = p.lv + sa * lx;
  return [p.lu + ca * lx - sa * ly, p.lv + sa * lx + ca * ly, cu, cv, hw * k];
}
function cvHalfW(body, x) {   // 机身剖面在 x 处的半宽
  for (let i = 1; i < body.length; i++) { const [x0, w0] = body[i - 1], [x1, w1] = body[i]; if (x <= x0 && x >= x1) return lerp(w0, w1, (x0 - x) / (x0 - x1 || 1)); }
  return body[body.length - 1][1];
}
// 飞行员路线：飞行员从舰岛里出来——离舰岛舱门不远（70 以内）的飞机直接从舱门跑过去，远的从舷边通道口（往舰岛方向约 24 处）上到甲板再跑过去；pT = 跑的秒数
function cvPilotPlan(p) {
  const L = cvLadder(p), door = CVG.door, du = L[0] + Math.sign(door[0] - L[0]) * 24, hatch = [du, Math.min(cvEdgeV(du) - 1.5, 31)];
  const from = Math.hypot(door[0] - L[0], door[1] - L[1]) < 70 ? door : hatch;
  return { pu: from[0], pv: from[1], pT: Math.hypot(from[0] - L[0], from[1] - L[1]) / CVD.run };
}
// 飞行员此刻的样子（甲板局部坐标）：{ u, v, a 朝向, run 跑, clb 爬梯进度 0–1, z 离甲板的高度 }；进了座舱返回 null
function cvPilotPose(p) {
  if (p.dk !== 'brd' || p.pu == null) return null;
  const t = p.dkT || 0, L = cvLadder(p);
  if (t < p.pT) { const q = t / Math.max(.01, p.pT); return { u: lerp(p.pu, L[0], q), v: lerp(p.pv, L[1], q), a: Math.atan2(L[1] - p.pv, L[0] - p.pu), run: true, clb: null, z: 0, ph: t * 6.5 }; }
  const q = (t - p.pT) / CVD.climb;
  if (q >= 1) return null;
  const sw = clamp((q - .62) / .38, 0, 1), k = (airMdl(p.kind, p.v).size || 15) / 21;   // 前六成顺梯子往上爬，后四成跨进座舱
  return { u: lerp(L[0], L[2], sw), v: lerp(L[1], L[3], sw), a: p.lh + Math.PI / 2, run: false, clb: q, z: (Math.min(q / .62, 1) * 2.1 + sw * .3) * k * 1.25, ph: q * 9 };
}
// 座舱盖开度：登机时先打开，飞行员坐进去后合上
function cvCanopy(p) {
  if (p.dk !== 'brd') return 0;
  const t = p.dkT || 0, T = (p.pT || 0) + CVD.climb;
  return t < T ? clamp(t / .8, 0, 1) : 1 - clamp((t - T) / CVD.cnp, 0, 1);
}
// 甲板滑行路线：先到开阔处（机位前 / 升降机舷内侧），再沿两条车道（中线一带 v 4、右舷 v 17，在 u −4 处相接）到目的地附近
function cvLanes(a, b) {
  const lane = p => p[0] > -4 ? 'T' : 'S', proj = (p, L) => L === 'T' ? [clamp(p[0], -4, 128), 17] : [clamp(p[0], -150, -4), 4];
  const La = lane(a), Lb = lane(b), pa = proj(a, La), pb = proj(b, Lb);
  if (La === Lb) return Math.abs(pa[0] - pb[0]) < 6 ? [] : [pa, pb];
  return La === 'S' ? [pa, [-4, 4], [-4, 17], pb] : [pa, [-4, 17], [-4, 4], pb];
}
const cvSlotFront = j => { const [u, v, r] = CVG.slots[j]; return [u + Math.cos(r) * 15, v + Math.sin(r) * 15]; };
const cvElFront = e => [CVG.el[e].u, 17];
// 出发：从机位（顺机头开出）或升降机（向舷内开出）滑到弹射器 k 的等待点（偏流板后）
function cvRouteOut(p, k) {
  const F = p.el != null ? cvElFront(p.el) : [p.lu + Math.cos(p.lh) * 15, p.lv + Math.sin(p.lh) * 15];
  const A = cvCatPt(k, -44), Hd = cvCatPt(k, -27), mid = k === 2 ? [A[0] - 12, A[1] + 5] : null;   // 腰部弹射器：从它后方绕进来
  const pts = [F, ...cvLanes(F, mid || A), ...(mid ? [mid] : []), A, Hd];
  return pts.filter((q, i) => Math.hypot(q[0] - (i ? pts[i - 1][0] : p.lu), q[1] - (i ? pts[i - 1][1] : p.lv)) > 2);
}
// 回收：从拦阻停下的地方先往前开出拦阻索区，再去机位前（转向、倒进机位）或升降机舷内侧（等平台、转向、倒上去）
function cvRouteIn(p, j, e) {
  const L = CVG.land, ga = Math.atan2(L.v1 - L.v0, L.u1 - L.u0), X = [p.lu + Math.cos(ga) * 20, p.lv + Math.sin(ga) * 20];
  const T = j >= 0 ? cvSlotFront(j) : cvElFront(e);
  const out = [X, ...cvLanes(X, T), T];
  if (j >= 0) { const [u, v, r] = CVG.slots[j]; out.push(['P', r], ['R', u, v]); }
  return out;
}
// 沿路线走一步：普通点像开车一样边转边走（偏得多就放慢，转弯半径很小）；'P' 原地转到朝向（牵引车拖着转）；'R' 倒车直线退到点；'S' 直线开到点
// 返回 true = 走完
function cvFollow(p, dt) {
  const P = p.path;
  p.mv = 0;
  for (let guard = 0; P && P.length && guard < 6; guard++) {
    const s = P[0];
    if (s[0] === 'P') {
      const d = airAng(s[1] - p.lh), st = CVD.pivot * dt;
      if (Math.abs(d) <= st) { p.lh = s[1]; P.shift(); continue; }
      p.lh = airAng(p.lh + Math.sign(d) * st); p.mv = .3;
      return false;
    }
    if (s[0] === 'R' || s[0] === 'S') {
      const rev = s[0] === 'R', dx = s[1] - p.lu, dy = s[2] - p.lv, d = Math.hypot(dx, dy), st = (rev ? CVD.rev : CVD.taxi * .55) * dt;
      if (d <= st) { p.lu = s[1]; p.lv = s[2]; P.shift(); continue; }
      p.lu += dx / d * st; p.lv += dy / d * st; p.mv = rev ? -1 : 1;
      return false;
    }
    const dx = s[0] - p.lu, dy = s[1] - p.lv, d = Math.hypot(dx, dy), last = P.length === 1 || typeof P[1][0] === 'string';
    if (d < (last ? .5 : 3)) { if (last) { p.lu = s[0]; p.lv = s[1]; } P.shift(); continue; }
    const err = airAng(Math.atan2(dy, dx) - p.lh);
    p.lh = airAng(p.lh + clamp(err * 3.2, -1.8, 1.8) * dt);
    const v = CVD.taxi * Math.max(.08, Math.cos(Math.min(Math.abs(err), 1.5))) ** 2 * (last ? clamp(d / 9, .2, 1) : 1);
    p.lu += Math.cos(p.lh) * v * dt; p.lv += Math.sin(p.lh) * v * dt; p.mv = 1;
    return false;
  }
  return !P || !P.length;
}
const cvPlace = (p, c) => { [p.x, p.y] = cvW(p.lu, p.lv, c); p.heading = airAng(c.heading + p.lh); p.alt = 0; p.bank = 0; };
// 甲板上的飞机挡着着舰区（刚着舰没滑出、在着舰区里滑行、在腰部弹射器上）
const cvFoul = o => (o.phase === 'trap' && !o.clr) || ((o.phase === 'cat' || o.phase === 'roll') && o.lu != null && o.dk !== 'brd' && o.dk !== 'eng' && o.dk !== 'lift' && cvInLand(o.lu, o.lv, 7));
// 在机库里 / 升降机降在甲板以下（甲板中弹炸不到）
const cvBelow = p => p.el != null && (p.dk === 'lift' || p.dk === 'down') && S.cv && (() => { const c = cvOf(cvHome(p)) || S.cv; return c.el && c.el[p.el] && c.el[p.el].h > .35; })();
function cvLaunchStep(p, c, dt) {
  cvDeckInit(c);
  p.dkT = (p.dkT || 0) + dt;
  const h = cvHome(c), others = cvLive(c).filter(o => o !== p);
  if (p.phase === 'roll') {   // 电磁弹射：沿弹射器加速，到行程末端离舰
    const C = cvCat(p.cat);
    p.spd = Math.min(p.spd + CVD.acc * dt, 175); p.cs = (p.cs || 0) + p.spd * dt;
    [p.lu, p.lv] = cvCatPt(p.cat, p.cs); p.lh = C.a; p.fold = 0; p.cpo = 0;
    cvPlace(p, c);
    if (p.cs >= C.L) { c.jl[p.cat] = S.t; airSet(p, 'out'); p.alt = .05; p.lT = S.t; p.lu = p.lv = null; p.dk = null; p.path = null; }   // lT：离舰时刻（画面用：抬头、下沉、收起落架）
    return;
  }
  switch (p.dk) {
    case 'lift': {   // 升降机：空平台降到机库甲板 → 载上飞机升回来
      const E = c.el[p.el];
      if (E.w == null) E.w = p.id;
      if (E.w === p.id) {
        if (!p.up) { E.to = 1; if (E.h >= 1) { p.up = true; E.to = 0; } }
        else if (E.h <= 0) { p.dk = 'eng'; p.dkT = 0; }
      }
      break;
    }
    case 'brd':   // 飞行员跑过来、爬梯子进座舱，座舱盖合上
      p.cpo = cvCanopy(p);
      if (p.dkT >= (p.pT || 0) + CVD.climb + CVD.cnp) { p.dk = 'eng'; p.dkT = 0; p.cpo = 0; }
      break;
    case 'eng': {   // 启动发动机；同一条弹射器前面已有飞机在滑 / 在等，或者要穿过着舰区而有飞机正在降落，就在原地等
      if (p.dkT < CVD.eng) break;
      if (p.dkT > 6 && !others.some(o => o.phase === 'cat' && o.cat === p.cat && o.dk !== 'brd' && o.dk !== 'eng' && o.dk !== 'lift')) p.cat = cvPickCat(c, p);   // 等久了：换一条空着的弹射器
      if (p.cat === 2 && cvRecov(c)) p.cat = cvPickCat(c, p);
      const busy = others.some(o => o.phase === 'cat' && o.cat === p.cat && (o.dk === 'taxi' || o.dk === 'hold' || o.dk === 'line'));
      const path = cvRouteOut(p, p.cat), cross = path.some(q => cvInLand(q[0], q[1], 4)) || cvInLand(p.lu, p.lv, 4);
      if (busy || (cross && others.some(o => o.phase === 'final' || (o.phase === 'trap' && !o.clr)))) break;
      p.path = path; p.dk = 'taxi'; p.dkT = 0;
      if (p.slot != null) { const w = airWing(p); if (w && w.dk === p.slot) w.dk = null; p.slot = null; }
      break;
    }
    case 'taxi':   // 展开机翼，滑到偏流板后的等待点；离开升降机平台就把它放开
      p.fold = Math.max(0, (p.fold ?? 1) - dt / 2.4);
      if (p.el != null && Math.hypot(p.lu - CVG.el[p.el].u, p.lv - CVG.el[p.el].v) > 12) { const E = c.el[p.el]; if (E && E.w === p.id) E.w = null; p.el = null; }
      if (cvFollow(p, dt)) { p.dk = 'hold'; p.dkT = 0; }
      break;
    case 'hold': {   // 弹射器空了（前一架已离舰、偏流板放下）就滑上去
      p.fold = Math.max(0, (p.fold ?? 0) - dt / 2.4);
      const C = cvCat(p.cat), on = others.some(o => o.cat === p.cat && ((o.phase === 'cat' && (o.dk === 'line' || o.dk === 'hook')) || o.phase === 'roll'));
      if (on || S.t - (c.jl[p.cat] ?? -99) < 1.6 || (p.cat === 2 && cvRecov(c))) break;
      p.path = [['P', C.a], ['S', C.u, C.v]]; p.dk = 'line'; p.dkT = 0;
      break;
    }
    case 'line':
      p.fold = 0;
      if (cvFollow(p, dt)) { p.dk = 'hook'; p.dkT = 0; }
      break;
    case 'hook':   // 挂弹射杆、偏流板升起、弹射官示意、发动机加力 → 弹射
      if (p.dkT >= CVD.hook) { airSet(p, 'roll'); p.cs = 0; p.spd = 15; c.exposedUntil = Math.max(c.exposedUntil || 0, S.t + 10); }   // 起降作业：甲板灯光、弹射，10 秒内易被岸防炮发现
      break;
    default: p.dk = 'eng'; p.dkT = 0;   // 旧存档里停在弹射器上的飞机
  }
  if (p.lu == null) { const C = cvCat(p.cat || 0); p.lu = C.u; p.lv = C.v; p.lh = C.a; }
  cvPlace(p, c);
}
// —— 回收 ——
const CVD_TRAP = new Set(['arr', 'taxi', 'ewait', 'eon', 'down']);
function cvTrapStep(p, c, dt) {
  cvDeckInit(c);
  const L = CVG.land;
  if (!CVD_TRAP.has(p.dk)) { p.dk = 'arr'; p.rsv = null; p.el = null; p.clr = false; }
  if (p.dk === 'arr') {   // 拦阻索减速，停稳后收索、折机翼，准备滑出
    p.tl = (p.tl ?? CVG.td) + p.spd * dt / CV_LLEN; p.spd = Math.max(0, p.spd - 170 * dt);
    p.lu = lerp(L.u0, L.u1, p.tl); p.lv = lerp(L.v0, L.v1, p.tl); p.lh = CV_LANG; p.dk = 'arr';
    if (p.spd <= 0 && (p.rest = (p.rest || 0) + dt) > .7) cvTrapPark(p, c);
  } else if (p.dk === 'taxi') {   // 滑出着舰区，去机位或升降机
    p.fold = Math.min(1, (p.fold ?? 0) + dt / 2.4);
    if (!p.clr && !cvInLand(p.lu, p.lv, 5)) p.clr = true;
    if (cvFollow(p, dt)) {
      p.clr = true;
      if (p.rsv != null && p.rsv >= 0) { cvParked(p, p.rsv); return; }
      p.dk = 'ewait'; p.dkT = 0;
    }
  } else if (p.dk === 'ewait') {   // 等升降机平台空着停在甲板上，再转向、倒上去
    const E = c.el[p.el];
    if (E.w == null && E.h <= .001 && E.to <= 0) { E.w = p.id; p.path = [['P', -Math.PI / 2], ['R', CVG.el[p.el].u, CVG.el[p.el].v]]; p.dk = 'eon'; }
  } else if (p.dk === 'eon') {
    if (cvFollow(p, dt)) { p.dk = 'down'; c.el[p.el].to = 1; }
  } else if (p.dk === 'down') {   // 降到机库甲板：进机库整备
    const E = c.el[p.el];
    if (E.h >= 1) { cvParked(p, -1); return; }
  }
  cvPlace(p, c);
}
// 停稳后：甲板有空位就去最近的空机位，停满了就去升降机
function cvTrapPark(p, c) {
  const wing = cvWingOn(c);
  let j = -1, bd = Infinity;
  for (let i = 0; i < CVG.slots.length; i++) if (!cvSlotTaken(c, i, wing)) { const [u, v] = cvSlotFront(i), d = Math.hypot(u - p.lu, v - p.lv); if (d < bd) { bd = d; j = i; } }
  p.rsv = j;
  if (j < 0) p.el = cvPickEl(c, 'down', [p.lu, p.lv]);
  p.path = cvRouteIn(p, j, p.el); p.dk = 'taxi'; p.dkT = 0; p.fold = p.fold ?? 0;
}
function cvParked(p, j) {
  p.dead = true;
  const w = airWing(p);
  if (w && w.state !== 'lost') { w.state = 'rearm'; w.rearmT = AIR_REARM; w.dk = j; }
}
// —— 绘制用 ——
// 偏流板升起的角度（0 放平 — 1 竖到 55°）
function cvJbd(c, k, list) {
  for (const p of list) {
    if (p.cat !== k) continue;
    if (p.phase === 'roll') return 1;
    if (p.phase === 'cat' && p.dk === 'hook') return clamp((p.dkT - .3) / .9, 0, 1);
  }
  const t = S.t - ((c.jl && c.jl[k]) ?? -99);
  return t < 1.4 ? 1 - clamp((t - .2) / 1.2, 0, 1) : 0;
}
// 升降机平台此刻的高度（0 甲板 — 1 机库）
const cvElH = (c, i) => (c.el && c.el[i] && c.el[i].h) || 0;
// 飞机在甲板以下多深（升降机上）：0 = 在飞行甲板上
function cvDeckSink(p) {
  if (p.el == null || !(p.dk === 'lift' || p.dk === 'eon' || p.dk === 'down' || p.dk === 'eng' || p.dk === 'taxi')) return 0;
  const c = cvOf(cvHome(p)) || S.cv;
  return c ? cvElH(c, p.el) : 0;
}
// 弹射官：飞机挂上弹射器时站在旁边，弹射那一刻蹲下、手臂指向舰首
function cvShooters(c, list) {
  const out = [];
  for (let k = 0; k < CVG.cats.length; k++) {
    const p = list.find(o => o.cat === k && ((o.phase === 'cat' && (o.dk === 'hook' || o.dk === 'line')) || (o.phase === 'roll' && (o.cs || 0) < 30)));
    if (!p) continue;
    const C = cvCat(k), sd = k === 1 ? 1 : -1, [u, v] = cvCatPt(k, 4);
    out.push({ u: u - Math.sin(C.a) * 15 * sd, v: v + Math.cos(C.a) * 15 * sd, a: C.a + (p.phase === 'roll' ? 0 : -sd * Math.PI / 2), go: p.phase === 'roll' || (p.dk === 'hook' && p.dkT > CVD.hook - .5) });
  }
  return out;
}
// 二维：登机梯（座舱盖开着、飞行员还没坐进去时挂在座舱左侧）与飞行员（drawPlanes 在飞机之后画，爬进座舱时盖在机身上）；k 远景放大
function cvPilotDraw(ctx, p, k, time) {
  const c = cvOf(cvHome(p)) || S.cv, P = cvPilotPose(p), Ld = cvLadder(p);
  if (!c || typeof manDraw !== 'function') return;
  const at = (u, v) => cvW(u * k, v * k, c);
  if ((p.cpo || 0) > .3 && P) {
    const ux = Ld[2] - Ld[0], vy = Ld[3] - Ld[1], l = Math.hypot(ux, vy) || 1, nu = -vy / l * .3, nv = ux / l * .3, top = .62;
    ctx.strokeStyle = 'rgba(220,222,214,.9)'; ctx.lineWidth = Math.max(px(.8), .12 * k); ctx.beginPath();
    for (const s of [-1, 1]) { const [x0, y0] = at(Ld[0] + nu * s, Ld[1] + nv * s), [x1, y1] = at(Ld[0] + ux * top + nu * s, Ld[1] + vy * top + nv * s); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
    for (let i = 1; i < 4; i++) { const q = i / 4 * top, [x0, y0] = at(Ld[0] + ux * q - nu, Ld[1] + vy * q - nv), [x1, y1] = at(Ld[0] + ux * q + nu, Ld[1] + vy * q + nv); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
    ctx.stroke();
  }
  if (!P) return;
  const [x, y] = at(P.u, P.v);
  manDraw(ctx, x, y, c.heading + P.a, 'pilot', COL.g, 'p', { ...MAN_IDLE, k: .5 * k * (1 + P.z * .05), mv: P.run, run: P.run, ph: P.ph, clb: P.clb, t: time });
}
// —— 舰体占位：别的舰艇不能压在航母上 ——
// 舰体（外扩 r）在甲板局部坐标里的范围：u −160…160、v −47…39（左舷斜角甲板伸得更远）；点在里面时返回推出去的最近点
function cvFootOut(c, x, y, r) {
  const [u, v] = cvL(x, y, c), u0 = -160 - r, u1 = 160 + r, v0 = -47 - r, v1 = 39 + r;
  if (u <= u0 || u >= u1 || v <= v0 || v >= v1) return null;
  const d = [[u - u0, u0, v], [u1 - u, u1, v], [v - v0, u, v0], [v1 - v, u, v1]].sort((a, b) => a[0] - b[0])[0];
  return cvW(d[1], d[2], c);
}
// 每步把进到航母舰体里的舰艇（两栖舰、坦克登陆舰、驱逐舰、增援艇、别的航母）沿最近的一边推出去；inst = 一次挪到位（开战那一刻）
function cvShoo(dt, inst) {
  const cvs = cvAll().filter(c => c.x > -999);
  if (!cvs.length) return;
  const list = [...S.ships.filter(s => alive(s) && s.state !== 'beached'), S.dd && S.dd.state !== 'sunk' && S.dd.x > -999 ? S.dd : null, ...(S.boats || []).filter(b => !b.dead), ...cvs].filter(Boolean);
  for (const c of cvs) for (const s of list) {
    if (s === c || !isFinite(s.x)) continue;
    const r = cvs.includes(s) ? 40 : (((typeof SHIP_DIM === 'object' && SHIP_DIM[s.kind]) || [30, 10])[1] / 2 + 5);
    const o = cvFootOut(c, s.x, s.y, r);
    if (o) {
      const dx = o[0] - s.x, dy = o[1] - s.y, d = Math.hypot(dx, dy), st = inst ? d : Math.min(d, 40 * dt);
      s.x += dx / (d || 1) * st; s.y += dy / (d || 1) * st;
    }
    if (isFinite(s.tx) && isFinite(s.ty)) { const t = cvFootOut(c, s.tx, s.ty, r); if (t) [s.tx, s.ty] = t; }   // 目的地落在航母舰体上的也挪出去
  }
}
// 3D 镜头对准航母时注视点抬到飞行甲板高度（离舰体 60 以外平滑回到海面）：近看甲板作业时镜头不会钻到甲板下面
function cvCamZ(x, y) {
  if (!S || typeof cvAll !== 'function') return null;
  let best = null;
  for (const c of cvAll()) {
    if (!(c.x > -999)) continue;
    const [u, v] = cvL(x, y, c), d = Math.hypot(Math.max(0, Math.abs(u) - 158), Math.max(0, v > 0 ? v - 37 : -v - 42));
    if (d >= 60) continue;
    const k = 1 - d / 60, z = lerp(-2.6, -2.6 + CVG.zd, k * k * (3 - 2 * k));
    if (best == null || z > best) best = z;
  }
  return best;
}
