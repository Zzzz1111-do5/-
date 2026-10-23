'use strict';
// 守方协同（v7）：
// ① 预备队整连机动：指挥官放行（判明敌主攻方向）后，预备连整连调到受压最大的据点后方待机，不再一组一组地抽；
//    待机中据点吃紧 → 进入阵地加强；据点失守 → 转入反冲击；压力消失 60 秒 → 就地转入防御
// ② 有计划的反冲击：据点失守或被突入 → 就近预备连在出发阵地集结 → 炮兵（与航空兵，eair.js 读 ca）火力准备
//    → 兵力够了统一发起、火力延伸 → 得手就地转入防御 / 受挫撤回出发阵地；兵力始终凑不够则放弃，在出发阵地组织防御
// ③ 借兵侧射：据点遭攻击时，从平静的友邻据点借一个守备组到攻击之敌侧翼射击，45 秒后归建
// ④ 步坦协同：守方车辆绑定反冲击连 / 机动中的预备连（执行器 tf.js vehEscort 双方共用），轴线 = 反冲击目标或威胁方向（a4Axis）
// ⑤ 远方抽调：判明敌主攻方向后，从平静的远方据点抽出多余守备（每处至少留一个组、最多抽一半），凑够 3 组 6 人以上才编成机动支队，
//    沿内线开到受威胁据点后方、敌人看不见的集结地域，到齐后转为 ① 的待机预备队统一投入；凑不够就不派，不逐次添油
// 接口：ai2.js 写 thr、询问 a4Busy / a4OwnsPt / a4Focus；ai3.js 抽袭扰分队前询问 a4Busy；front.js 战线图调 frDrawPlans
// 状态（纯 JSON）：S.ai.co = { v, thr: {据点: [fx, fy, 威胁, 120 内敌人数]}, ca: [反冲击], res: {连队 id: 机动}, fl: {小组 id: 侧射}, dr: {支队 id: 抽调行军}, cool: {}, thinkT, bindT }
const a4On = () => !!S && !(S.v7off && S.v7off.co);
const a4Stat = (k, n = 1) => { const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
// prep 火力准备秒数 · mass 集结最长秒数 · need 反冲击兵力比（再乘难度的 ratio）· flank 同时借兵侧射的组数 · gap 同一据点再次反冲击的间隔
const A4D = {
  normal: { prep: 24, mass: 60, need: 1.15, flank: 1, gap: 70 },
  hard: { prep: 18, mass: 48, need: 1.3, flank: 2, gap: 50 },
  hell: { prep: 12, mass: 36, need: 1.45, flank: 2, gap: 35 }
};
const a4D = () => A4D[S && S.level] || A4D.hard;
const A4_GUNV = ['lt_tank', 'tank', 'hv_tank', 'amtank', 'td', 'flame_tank', 'mine_tank'];

function a4Init() { if (S && S.ai) S.ai.co = { v: 1, thr: {}, ca: [], res: {}, fl: {}, dr: {}, cool: {}, hold: {}, thinkT: 2, bindT: 0 }; }
function a4C() { if (!S || !S.ai) return null; if (!S.ai.co || S.ai.co.v !== 1) a4Init(); if (!S.ai.co.hold) S.ai.co.hold = {}; if (!S.ai.co.dr) S.ai.co.dr = {}; return S.ai.co; }
const a4Men = ts => ts.reduce((a, q) => a + q.men.length, 0);
const a4Ts = u => teamsOf(u).filter(q => q.men.length && !q.ride);
function a4Cent(u) { let x = 0, y = 0, n = 0; for (const q of a4Ts(u)) { x += q.x; y += q.y; n++; } return n ? [x / n, y / n] : null; }
// 连队称呼按第一次被调动时的驻地（「镇中心预备队」），之后不随任务改名
const a4Name = u => u.a4n || (u.a4n = ((ptByKey(u.obj) || {}).name || '') + (u.role === 'reserve' ? '预备队' : '守备队'));
const a4Where = (x, y) => typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);
const a4Plan = (C, id) => C.ca.find(c => !c.end && c.units.includes(id));
const a4Held = q => typeof cmdHeld === 'function' && cmdHeld(q);

// —— 对外接口 ——
// 这个组正由 ai4 调动（反冲击、整连机动 / 待机、借兵侧射）：ai2 不再给它布位，ai3 不抽它去袭扰
function a4Busy(q) {
  const C = S && S.ai && S.ai.co;
  if (!C || !q) return false;
  const f = C.fl[q.id];
  if (f && f.until > S.t) return true;
  return q.u != null && a4UnitBusy(q.u);
}
// 连队正由 ai4 整连机动 / 待机 / 反冲击（ai.js aiUnitFor 不往这样的连里编散兵）
function a4UnitBusy(id) {
  const C = S && S.ai && S.ai.co;
  if (!C) return false;
  const r = C.res[id];
  return !!(r && (r.st === 'move' || r.st === 'stand')) || !!a4Plan(C, id) || !!(C.dr && C.dr[id]);
}
// 该据点的反冲击由 ai4 掌握：有进行中的计划，或刚放弃 / 受挫（冷却期内不再仓促反击，与「暂不反冲击」的决心一致）
const a4OwnsPt = k => { const C = S && S.ai && S.ai.co; return !!C && (C.ca.some(c => c.key === k && !c.end) || (C.hold && C.hold[k] > S.t)); };
// 炮兵火力重点（ai2 aiArtillery 对 r 以内的目标加权）：火力准备打据点本身；发起后 25 秒内向敌来路延伸，不打自己的冲击分队
function a4Focus() {
  const C = S && S.ai && S.ai.co;
  if (!C) return null;
  let lift = null;
  for (const c of C.ca) {
    if (c.end) continue;
    const p = ptByKey(c.key);
    if (!p) continue;
    if (c.st === 'prep') return { x: p.x, y: p.y, r: 90 };
    if (c.st === 'go' && S.t - c.goT < 25 && !lift) {
      const T = C.thr[c.key], dx = T ? T[0] - p.x : 0, dy = T ? T[1] - p.y : 0, l = Math.hypot(dx, dy);
      const ux = l > 40 ? dx / l : 0, uy = l > 40 ? dy / l : 1;   // 没有明显的来路：朝海（敌后续梯队的方向）
      lift = { x: p.x + ux * 150, y: p.y + uy * 150, r: 90 };
    }
  }
  return lift;
}
// 守方车辆的伴随轴线（tf.js tfAxisPt）：反冲击目标；机动 / 待机中的连队对着所去据点的威胁方向；否则朝海
function a4Axis(v, u, c) {
  const C = S && S.ai && S.ai.co;
  if (C && u) {
    const ca = a4Plan(C, u.id), p = ca && ptByKey(ca.key);
    if (p) return [p.x, p.y];
    const r = C.res[u.id] || (C.dr && C.dr[u.id]), k = (r && r.key) || u.obj, T = k && C.thr[k];
    if (T && T[2] > .5 && dist(T[0], T[1], c[0], c[1]) > 30) return [T[0], T[1]];
  }
  return [c[0], c[1] + 200];
}

// 整连机动：各组按三三制槽位同时出发，面向 face
function a4Move(u, x, y, face, t = 'move') {
  const ts = a4Ts(u);
  if (!ts.length) return false;
  const sl = formationSlots(ts.length, x, y, face);
  ts.forEach((q, i) => { aiGo(q, sl[i][0], sl[i][1], t, x, y); q.px = null; });
  u.face = face;
  return true;
}

// —— ① 预备队整连机动 ——
function a4Res(C, info) {
  for (const id in C.res) {
    const r = C.res[id], u = UNIT_MAP.get(+id), ts = u ? a4Ts(u) : [], p = ptByKey(r.key), I = info[r.key];
    if (!u || !ts.length || u.state === 'rout' || !p || a4Plan(C, +id)) { delete C.res[id]; continue; }
    if (r.st === 'move') {
      const c = a4Cent(u);
      if ((c && dist(c[0], c[1], r.x, r.y) < 45) || ts.every(q => q.order.t === 'hold') || S.t - r.t > 150) { r.st = 'stand'; r.t = S.t; }
      continue;
    }
    // 待机：据点吃紧（120 内敌兵力超过守备 1.3 倍）→ 进入阵地加强；压力消失 60 秒 → 就地转入防御
    if (p.owner === 'e' && p.prog < .25 && I && I.near >= Math.max(3, I.def * 1.3)) {
      delete C.res[id];
      for (const q of ts) q.px = null;
      a4Stat('a4Reinf');
      chatSay('e', `命令：${a4Name(u)}进入${p.name}阵地，加强防御。`, { kind: 'order', at: p, key: 'a4rf' + id, gap: 60, lv: 1 });
      continue;
    }
    if (I && I.th >= 1.5) r.calm = S.t;
    if (S.t - (r.calm ?? r.t) > 60) { delete C.res[id]; for (const q of ts) q.px = null; }
  }
  if (Object.values(C.res).filter(r => r.st === 'move').length >= 2) return;
  // 新的机动：受压最大（威胁 × 指挥官判断的权重 / 守备）、与现驻地相比明显更需要的据点；每次只调一个连
  const bias = typeof cmdBias === 'function' ? cmdBias : () => 1;
  const need = k => { const I = info[k]; return I ? (I.th * bias(k) + 1) / (I.def + 1) * Math.sqrt(I.p.vp || 1) : 0; };
  let best = null, bs = .5;
  for (const u of S.units) {
    if (u.side !== 'e' || u.kind !== 'inf' || u.role !== 'reserve' || u.state === 'rout' || C.res[u.id] || C.dr[u.id] || a4Plan(C, u.id)) continue;   // 行军中的机动支队到齐前不改派
    const ts = a4Ts(u), c = a4Cent(u);
    if (!c || a4Men(ts) < 4 || ts.some(q => q.raid || q.role !== 'reserve' || a4Held(q) || C.fl[q.id])) continue;
    const cur = need(u.obj) * 1.5;
    for (const k in info) {
      const I = info[k], p = I.p;
      if (k === u.obj || I.th < 4 || p.owner !== 'e' || p.prog > .25) continue;   // 已失守 / 被突入的据点交给反冲击
      const inb = Object.values(C.res).filter(r => r.key === k).length, d = dist(c[0], c[1], p.x, p.y);
      if (inb >= 2 || d > 1300) continue;
      const s = need(k) - cur - d / 900 - inb;
      if (s > bs) { bs = s; best = { u, k, I, ts }; }
    }
  }
  if (!best) return;
  const { u, k, I, ts } = best, p = I.p, nm = a4Name(u), sp = stagingSpot(p, I), face = Math.atan2(I.fy - sp.y, I.fx - sp.x);
  for (const q of ts) q.obj = k;
  u.obj = k;
  if (!a4Move(u, sp.x, sp.y, face)) return;
  C.res[u.id] = { st: 'move', key: k, x: Math.round(sp.x), y: Math.round(sp.y), t: S.t };
  a4Stat('a4Res');
  chatSay('e', `命令：${nm}整连（${ts.length} 组 ${a4Men(ts)} 人）向${p.name}后方机动待命，准备加强防御或反冲击。`, { kind: 'order', at: p, key: 'a4res' + u.id, gap: 60, lv: 1 });
}

// —— ⑤ 远方抽调 ——
// 集结地域：据点背向威胁一侧 220–320 处、可通行、敌人看不见（不在我方视野里）、掩护好、离海岸 250 以外的格
function a4Rally(p, I) {
  const away = Math.atan2(p.y - I.fy, p.x - I.fx);
  let best = null, bs = -Infinity;
  for (let i = 0; i < 24; i++) {
    const a = away + (i / 24 - .5) * 2.2, r = 220 + (i % 3) * 50;
    const x = clamp(p.x + Math.cos(a) * r, 20, W - 20), y = clamp(p.y + Math.sin(a) * r, 20, H - 20);
    if (!passInf(x, y)) continue;
    const sc = (1 - coverAt(x, y)) * 2 - (PV[ci(x, y)] ? 3 : 0) - (coastAt(x) - y < 250 ? 2 : 0) + Math.random() * .3;
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  return best || stagingSpot(p, I);
}
function a4Draw(C, info) {
  // 行军中的支队：到齐（四分之三的组到了集结地域 70 以内）或超时（到了一半）→ 转为待机预备队；途中遇敌停下的组 15 秒后再走
  for (const id in C.dr) {
    const r = C.dr[id], u = UNIT_MAP.get(+id), ts = u ? a4Ts(u) : [], p = ptByKey(r.key);
    if (!u || !ts.length || u.state === 'rout' || !p) { delete C.dr[id]; continue; }
    for (const q of ts) if (q.order.t === 'hold' && dist(q.x, q.y, r.x, r.y) > 70 && S.t - (q.stopT ?? -99) > 15 && S.t - (q.drT ?? -99) > 10 && q.sup < 50) {
      aiGo(q, r.x + gauss() * 15, r.y + gauss() * 15, 'move', r.x, r.y); q.drT = S.t;
    }
    const at = ts.filter(q => dist(q.x, q.y, r.x, r.y) < 70);
    if (!(at.length >= Math.max(Math.min(3, ts.length), Math.ceil(ts.length * .75)) || (S.t - r.t > r.T && at.length >= Math.ceil(ts.length / 2)) || S.t - r.t > r.T * 1.8)) continue;
    delete C.dr[id];
    C.res[id] = { st: 'stand', key: r.key, x: r.x, y: r.y, t: S.t, calm: S.t };
    for (const q of ts) q.px = null;
    a4Stat('a4DrRdy');
    chatSay('e', `报告：${a4Name(u)}已在${a4Where(r.x, r.y)}集结完毕（到达 ${at.length} 组 ${a4Men(at)} 人），归${p.name}方向统一指挥，准备加强防御或反冲击。`, { kind: 'report', at: { x: r.x, y: r.y }, lv: 1 });
  }
  if (S.t < (C.drT || 0) || Object.keys(C.dr).length >= 2) return;
  C.drT = S.t + 12;
  // 敌主攻方向：指挥官已判明主攻方向（无指挥官时看威胁持续最大处）；受压最大的据点（威胁 × 判断权重 / 守备）
  const E = typeof cmdOn === 'function' && cmdOn() && S.cmd && S.cmd.e;
  if (E && E.guess == null) return;
  const bias = typeof cmdBias === 'function' ? cmdBias : () => 1;
  let K = null, ks = 0;
  for (const k in info) { const I = info[k], s = I.th >= 6 ? I.th * bias(k) / (I.def + 4) * Math.sqrt(I.p.vp || 1) : 0; if (s > ks) { ks = s; K = I; } }
  if (!K || ks < .8) return;
  // 平静的据点：威胁 < 1.5、近处无敌、离主攻方向 250 以外；守备组至少留一个（指挥所两个），最多抽一半
  const pick = [], from = [];
  const donors = Object.values(info).filter(J => J !== K && J.p.owner === 'e' && J.p.prog < .1 && J.th < 1.5 && !J.near && dist(J.p.x, J.p.y, K.p.x, K.p.y) > 250)
    .sort((a, b) => dist(a.p.x, a.p.y, K.p.x, K.p.y) - dist(b.p.x, b.p.y, K.p.x, K.p.y));
  for (const J of donors) {
    const g = S.teams.filter(q => q.side === 'e' && q.obj === J.p.key && q.role === 'garrison' && q.men.length >= 2 && !q.hold && !q.raid && q.order.t !== 'retreat' && !a4Busy(q) && !(unitOf(q) && unitOf(q).state === 'rout'));
    const take = Math.min(g.length - (J.p.key === 'HQ' ? 2 : 1), Math.floor(g.length / 2));
    if (take <= 0) continue;
    g.sort((a, b) => dist(a.x, a.y, K.p.x, K.p.y) - dist(b.x, b.y, K.p.x, K.p.y)).slice(0, Math.min(take, 6 - pick.length)).forEach(q => pick.push(q));
    from.push(J.p.name);
    if (pick.length >= 6) break;
  }
  if (pick.length < 3 || a4Men(pick) < 6) return;   // 凑不够一个像样的支队：不派（不逐次添油）
  const sp = a4Rally(K.p, K), face = Math.atan2(K.fy - sp.y, K.fx - sp.x), n = (C.drN = (C.drN || 0) + 1);
  const u = addUnit('e', 'inf', { role: 'reserve', obj: K.p.key, face });
  u.a4n = `机动支队${n > 1 ? n : ''}`;
  const sl = formationSlots(pick.length, sp.x, sp.y, face), far = Math.max(...pick.map(q => dist(q.x, q.y, sp.x, sp.y)));
  pick.forEach((q, i) => { Object.assign(q, { u: u.id, role: 'reserve', obj: K.p.key, px: null }); aiGo(q, sl[i][0], sl[i][1], 'move', sp.x, sp.y); });
  C.dr[u.id] = { st: 'march', key: K.p.key, x: Math.round(sp.x), y: Math.round(sp.y), t: S.t, T: Math.round(far / 10 + 30), from };
  C.drT = S.t + 60;
  a4Stat('a4Draw'); a4Stat('a4DrMen', a4Men(pick));
  chatSay('e', `判断：${K.p.name}方向吃紧（当面之敌约 ${Math.max(K.near, Math.round(K.th))} 人），${from.join('、')}方向未见敌情。决心：从${from.join('、')}守备抽调 ${pick.length} 组（${a4Men(pick)} 人）编成${u.a4n}，经内线向${K.p.name}后方${a4Where(sp.x, sp.y)}集结，到齐后统一投入，不逐次添油。`, { kind: 'plan', at: K.p, lv: 1 });
}

// —— ② 有计划的反冲击 ——
function a4Ca(C, info, D) {
  const A = a4D();
  for (const c of C.ca) if (!c.end) a4CaTick(C, c, info, A);
  C.ca = C.ca.filter(c => !c.end || S.t - c.end < 60);   // 结束的计划留 60 秒，战线图淡出
  if (C.ca.filter(c => !c.end).length >= 2) return;
  for (const k in info) {
    const I = info[k], p = I.p;
    if (!(p.owner === 'p' || p.prog > .25) || a4OwnsPt(k) || (C.cool[k] || 0) > S.t) continue;
    // 可用兵力：在此待机的连队优先，其次 800 以内空闲的预备连（须经指挥官放行）；最多 3 个连
    const need = Math.max(8, Math.round(Math.max(I.near, 3) * D.ratio * A.need)), cand = [];
    for (const u of S.units) {
      if (u.side !== 'e' || u.kind !== 'inf' || u.state === 'rout' || a4Plan(C, u.id) || C.dr[u.id]) continue;
      const ts = a4Ts(u), c = a4Cent(u);
      if (!c || a4Men(ts) < 3 || ts.some(q => q.raid || a4Held(q) || C.fl[q.id])) continue;
      const r = C.res[u.id], stand = r && r.key === k, d = dist(c[0], c[1], p.x, p.y);
      if (!stand && (u.role !== 'reserve' || d > 800 || (r && info[r.key] && info[r.key].th >= 4 && info[r.key].p.owner === 'e'))) continue;   // 正在别处顶住压力的不抽
      cand.push({ u, d: stand ? -1 : d, men: a4Men(ts) });
    }
    cand.sort((a, b) => a.d - b.d);
    const pick = [];
    let men = 0;
    for (const o of cand) { if (men >= need * 1.2 || pick.length >= 3) break; pick.push(o); men += o.men; }
    if (!pick.length || men < need * .6) { C.cool[k] = S.t + 20; continue; }   // 兵力不够：交给 ai2 的仓促反击 / 坚守，20 秒后再看
    const sp = stagingSpot(p, I), face = Math.atan2(p.y - sp.y, p.x - sp.x);
    // 集结时限按最远一个连的行军路程估算（守军步兵约 9–14 每秒），不在部队还在路上时就放弃
    const far = Math.max(...pick.map(o => { const cc = a4Cent(o.u); return cc ? dist(cc[0], cc[1], sp.x, sp.y) : 0; }));
    const c = { id: S.nid++, key: k, st: 'mass', t: S.t, units: pick.map(o => o.u.id), nm: pick.map(o => a4Name(o.u)), need, men0: men, x: Math.round(sp.x), y: Math.round(sp.y), end: null,
      massT: Math.round(Math.max(A.mass, far / 9 + 15)) };
    for (const o of pick) { delete C.res[o.u.id]; for (const q of a4Ts(o.u)) q.obj = k; o.u.obj = k; a4Move(o.u, sp.x, sp.y, face); }
    C.ca.push(c);
    a4Stat('caPlan');
    chatSay('e', `判断：${p.name}${p.owner === 'p' ? '失守' : '被敌突入'}${I.near ? `，突入之敌约 ${I.near} 人` : ''}。决心：以${c.nm.join('、')}（约 ${men} 人）在${a4Where(sp.x, sp.y)}集结，炮火准备后统一反冲击，夺回${p.name}。`, { kind: 'plan', at: p, lv: p.vp >= 2 ? 0 : 1 });
    if (C.ca.filter(o => !o.end).length >= 2) return;
  }
}
function a4CaTick(C, c, info, A) {
  const p = ptByKey(c.key), us = c.units.map(id => UNIT_MAP.get(id)).filter(u => u && a4Ts(u).length);
  if (!p || !us.length) { a4CaEnd(C, c, 'gone', p, us); return; }
  const live = us.filter(u => u.state !== 'rout').flatMap(a4Ts).filter(q => q.order.t !== 'retreat'), men = a4Men(live), lost = p.owner === 'p' || p.prog > .25;
  if (c.st !== 'go') {
    if (!lost) { a4CaEnd(C, c, 'cancel', p, us); return; }   // 敌已退出 / 被仓促反击夺回
    const am = a4Men(live.filter(q => dist(q.x, q.y, c.x, c.y) < 90)), mT = c.massT || A.mass;
    if (men < c.need * .45 && S.t - c.t > 15) { a4CaEnd(C, c, 'weak', p, us, 0, am); return; }   // 途中伤亡、溃散，已凑不够
    if (c.st === 'mass') {
      if (am < c.need * .5 && S.t - c.t < mT * .6) return;
      c.st = 'prep'; c.prepT = S.t;
      c.guns = S.enemies.some(e => !e.dead && !e.moving && (e.kind === 'arty' || e.kind === 'mortar') && dist(e.x, e.y, p.x, p.y) < (e.kind === 'mortar' ? 420 : 1100) * ((e.mod && e.mod.rng) || 1));
      const air = !!(S.eair && S.eair.wing && S.eair.wing.some(w => w.state === 'ready' && w.type !== 'ftr'));
      chatSay('e', `命令：${c.guns ? `炮兵对${p.name}实施火力准备` : `${p.name}方向没有炮兵支援，各分队以直射火力压制`}${air ? '，航空兵出动支援' : ''}；反冲击各分队在出发阵地待命。`, { kind: 'order', at: p, lv: 1 });
      return;
    }
    if (S.t - c.prepT < (c.guns ? A.prep : 6)) return;
    if (am >= c.need * .7 || (S.t - c.t > mT && am >= c.need * .45)) a4CaGo(C, c, p, info[c.key]);
    else if (S.t - c.t > mT + 20) a4CaEnd(C, c, 'weak', p, us, 0, am);
    return;
  }
  // 发起后：得手 / 受挫 / 超时；接近目标、敌被压制（或我兵力占优）时冲锋；停下的组继续向目标攻击前进
  const T = info[c.key], lostN = Math.max(0, c.men0 - men);
  if (p.owner === 'e' && p.prog < .1 && (!T || !T.near)) { a4CaEnd(C, c, 'ok', p, us); return; }
  if (!live.length || lostN >= c.men0 * .5 || S.t - c.goT > 110) { a4CaEnd(C, c, 'fail', p, us, lostN); return; }
  const seenP = S.teams.filter(o => o.side === 'p' && o.men.length && dist(o.x, o.y, p.x, p.y) < 90 && spotted(o.x, o.y));
  const shaken = seenP.length && seenP.reduce((a, o) => a + o.sup, 0) / seenP.length > 45, strong = men >= (T ? T.near : 0) * 1.5;
  for (const q of live) {
    const d = dist(q.x, q.y, p.x, p.y);
    if (d < 85 && (shaken || strong)) { if (q.order.t !== 'charge') aiGo(q, p.x + gauss() * 12, p.y + gauss() * 12, 'charge', p.x, p.y); }
    else if (q.order.t === 'hold' && d > 30) aiGo(q, p.x + gauss() * 15, p.y + gauss() * 15, 'amove', p.x, p.y);
  }
}
function a4CaGo(C, c, p, I) {
  // 原据点守备的残部（就近在出发阵地附近的）一并投入
  for (const u of S.units) {
    if (u.side !== 'e' || u.kind !== 'inf' || u.state === 'rout' || c.units.includes(u.id) || a4Plan(C, u.id)) continue;
    const ts = a4Ts(u);
    if (ts.length && ts.every(q => q.obj === c.key && !q.raid && !C.fl[q.id]) && ts.some(q => dist(q.x, q.y, p.x, p.y) < 320)) { c.units.push(u.id); delete C.res[u.id]; }
  }
  const ts = c.units.flatMap(id => { const u = UNIT_MAP.get(id); return u && u.state !== 'rout' ? a4Ts(u) : []; }).filter(q => q.order.t !== 'retreat'), men = a4Men(ts);
  c.st = 'go'; c.goT = S.t; c.men0 = men;
  for (const q of ts) { aiGo(q, p.x + gauss() * 15, p.y + gauss() * 15, 'amove', p.x, p.y); q.px = null; }
  const nv = (S.veh || []).filter(v => v.side === 'e' && !v.dead && v.buddy != null && c.units.includes(v.buddy) && A4_GUNV.includes(v.type)).length;
  a4Stat('caGo');
  chatSay('e', `命令：火力延伸！${c.nm.join('、')}（${ts.length} 组 ${men} 人${I && I.near ? `，对敌约 ${I.near} 人` : ''}）向${p.name}统一发起反冲击${nv ? `，${nv} 辆坦克在步兵线后伴随支援` : ''}。`, { kind: 'order', at: p, lv: 0 });
}
function a4CaEnd(C, c, why, p, us, lostN = 0, am = 0) {
  c.end = S.t; c.why = why;
  if (!p) return;
  const A = a4D();
  C.cool[c.key] = S.t + (why === 'ok' ? 20 : why === 'cancel' || why === 'gone' ? 10 : A.gap * (why === 'fail' ? 2 : 1.5));
  if (why === 'fail' || why === 'weak') C.hold[c.key] = C.cool[c.key];   // 冷却期内也不仓促反击（a4OwnsPt）
  if (why === 'gone') return;
  if (why === 'ok') {   // 得手：编入该据点守备，就地转入防御
    for (const u of us) {
      u.role = 'garrison'; u.obj = c.key;
      for (const q of a4Ts(u)) { q.role = 'garrison'; q.obj = c.key; q.px = null; if (q.order.t === 'charge' || q.order.t === 'amove') q.order = { t: 'hold' }; }
    }
    a4Stat('caOk');
    chatSay('e', `报告：反冲击得手，已夺回${p.name}，各分队就地转入防御。`, { kind: 'report', at: p, lv: 0 });
    return;
  }
  // 受挫 / 兵力不足 / 敌已退出：残部在出发阵地待机，之后仍可再次反冲击
  const face = Math.atan2(p.y - c.y, p.x - c.x);
  for (const u of us) {
    if (u.state === 'rout' || !a4Ts(u).length) continue;
    if (why === 'fail') a4Move(u, c.x, c.y, face, 'retreat');
    C.res[u.id] = { st: why === 'fail' ? 'move' : 'stand', key: c.key, x: c.x, y: c.y, t: S.t };
  }
  if (why === 'fail') {
    a4Stat('caFail');
    chatSay('e', lostN ? `报告：向${p.name}反冲击受挫，伤亡 ${lostN} 人，残部撤回出发阵地。` : `报告：向${p.name}反冲击遭敌火力压制，未能接近，各分队撤回出发阵地。`, { kind: 'report', at: p, lv: 1 });
  } else if (why === 'weak') {
    a4Stat('caWeak');
    const live = us.filter(u => u.state !== 'rout').reduce((a, u) => a + a4Men(a4Ts(u)), 0);
    chatSay('e', `判断：反冲击兵力不足（${am ? `出发阵地仅约 ${am} 人` : `集结途中遭敌火力杀伤，尚能战斗的约 ${live} 人`}，需 ${c.need} 人）。决心：暂不反冲击，各分队就近组织防御，阻敌向纵深发展。`, { kind: 'plan', at: { x: c.x, y: c.y }, lv: 1, key: 'a4weak' + c.key, gap: 120 });
  }
}

// —— ③ 借兵侧射 ——
function a4Flank(C, info) {
  const A = a4D();
  for (const id in C.fl) {
    const f = C.fl[id], q = S.teams.find(o => o.id === +id);
    if (!q || !q.men.length) { delete C.fl[id]; continue; }
    const u = unitOf(q), K = info[f.k];
    if (S.t >= f.until || (u && u.state === 'rout') || q.sup > 85 || (K && K.p.owner === 'p')) {
      delete C.fl[id]; q.px = null;   // 归建：ai2 按其据点重新布位
      if (q.order.t !== 'retreat') aiGo(q, f.hx, f.hy, 'move');
    }
  }
  if (Object.keys(C.fl).length >= A.flank) return;
  for (const k in info) {
    const I = info[k], p = I.p, ax = I.fx, ay = I.fy;
    if (p.owner !== 'e' || p.prog > .25 || I.near < 3 || I.th < 5 || (C.cool['f' + k] || 0) > S.t || dist(ax, ay, p.x, p.y) < 25) continue;
    C.cool['f' + k] = S.t + 30;
    // 借出的组：520 以内平静的友邻据点（威胁 < 1.5、近处无敌）至少还留一个守备组
    let best = null, bs = 650;
    for (const j in info) {
      const J = info[j];
      if (j === k || J.p.owner !== 'e' || J.th >= 1.5 || J.near > 0 || dist(J.p.x, J.p.y, p.x, p.y) > 520) continue;
      const g = S.teams.filter(q => q.side === 'e' && q.obj === j && q.role === 'garrison' && q.men.length >= 2 && !q.hold && !q.raid && q.order.t !== 'retreat' && !a4Busy(q) && !(unitOf(q) && unitOf(q).state === 'rout'));
      if (g.length < 2) continue;
      for (const q of g) { const d = dist(q.x, q.y, ax, ay); if (d < bs) { bs = d; best = { q, J }; } }
    }
    if (!best) continue;
    // 侧射阵位：攻击之敌周围、与「敌 → 据点」方向成 70°、靠近借出组的一侧，120 处掩护最好的格（避开雷区、铁丝网）
    const q = best.q, a0 = Math.atan2(p.y - ay, p.x - ax);
    let spot = null, sd = Infinity, side = 1;
    for (const s of [1, -1]) {
      const x = ax + Math.cos(a0 + s * 1.22) * 120, y = ay + Math.sin(a0 + s * 1.22) * 120, d = dist(x, y, q.x, q.y);
      if (d < sd && x > 10 && x < W - 10 && y > 10 && y < coastAt(clamp(x, 0, W - 1)) - 15) { sd = d; spot = { x, y }; side = s; }
    }
    if (!spot) continue;
    let cell = null, bc = -Infinity;
    eachCellIn(spot.x, spot.y, 30, i => { const t = TER.type[i]; if (!TP[t].sp || MINEC[i] || WIREC[i]) return; const s = (1 - TP[t].cv) * 2 - dist(cellCX(i), cellCY(i), spot.x, spot.y) / 30; if (s > bc) { bc = s; cell = { x: cellCX(i), y: cellCY(i) }; } });
    if (!cell) continue;
    C.fl[q.id] = { k, j: best.J.p.key, until: S.t + 45, x: cell.x, y: cell.y, hx: Math.round(q.x), hy: Math.round(q.y) };
    aiGo(q, cell.x, cell.y, 'amove'); q.px = null;
    C.cool['f' + k] = S.t + 60;
    a4Stat('a4Flank');
    chatSay('e', `命令：${best.J.p.name}守备抽一个组前出至${p.name}之敌${side > 0 ? '右' : '左'}翼，以侧射火力支援${p.name}。`, { kind: 'order', at: cell, key: 'a4fl' + k, gap: 45, lv: 1 });
    if (Object.keys(C.fl).length >= A.flank) return;
  }
}

// —— ④ 步坦协同：绑定（每 3 秒）。反冲击连优先（发起中的最优先），其次机动 / 待机中的预备连；每连最多 2 辆炮车 + 1 辆装甲车 ——
function a4Bind(C) {
  const kind = v => A4_GUNV.includes(v.type) ? 'g' : v.type === 'apc' ? 'a' : 'o', cap = { g: 2, a: 1, o: 1 };
  const vs = (S.veh || []).filter(v => v.side === 'e' && !v.dead && v.auto !== false && !v.immob && !v.lst && v.type !== 'spg' && v.type !== 'aa_veh' && v.type !== 'sam_veh' && v.hp >= v.maxhp * .3 && isLand(v.x, v.y));
  const want = new Map();
  for (const c of C.ca) if (!c.end) for (const id of c.units) want.set(id, c.st === 'go' ? 3 : 2);
  for (const id in C.res) if (!want.has(+id)) want.set(+id, 1);
  for (const id in C.dr) if (!want.has(+id)) want.set(+id, 1.5);   // 抽调行军中的机动支队：远处闲着的车辆跟着一起走
  for (const v of S.veh || []) if (v.side === 'e' && v.buddy != null && (!vs.includes(v) || !want.has(v.buddy) || !UNIT_MAP.get(v.buddy))) { v.buddy = null; v.esc = null; }
  const load = {};
  for (const v of vs) if (v.buddy != null) { const L = load[v.buddy] || (load[v.buddy] = { g: 0, a: 0, o: 0 }); L[kind(v)]++; }
  for (const v of vs) {
    if (v.buddy != null) continue;
    const k = kind(v);
    let best = null, bs = -Infinity;
    for (const [id, pr] of want) {
      const u = UNIT_MAP.get(id), L = load[id] || { g: 0, a: 0, o: 0 }, c = u && u.state !== 'rout' ? a4Cent(u) : null;
      if (!c || L[k] >= cap[k]) continue;
      const d = dist(v.x, v.y, c[0], c[1]);
      if (d > 900) continue;
      const s = pr * 2 - d / 150 - (L.g + L.a) * 1.2;
      if (s > bs) { bs = s; best = id; }
    }
    if (best == null) continue;
    (load[best] || (load[best] = { g: 0, a: 0, o: 0 }))[k]++;
    v.buddy = best; v.esc = { back: (typeof VEH_BACK7 === 'object' && VEH_BACK7[v.type]) || 45, lat: 0, mode: 'travel' };
    a4Stat('a4Bind');
  }
  if (typeof tfLat === 'function') tfLat('e');
}

// —— 每 1.5 秒（ai2 至少评估过一次威胁之后）——
function a4Think(dt) {
  if (!S || S.phase !== 'battle' || S.over || !a4On() || !S.ai) return;
  const C = a4C();
  if ((C.thinkT -= dt) > 0) return;
  C.thinkT = 1.5;
  if (!Object.keys(C.thr).length) return;
  const info = {};
  for (const p of S.points) {
    const T = C.thr[p.key];
    info[p.key] = { p, fx: T ? T[0] : p.x, fy: T ? T[1] : p.y + 250, th: T ? T[2] : 0, near: T ? T[3] : 0, def: 0 };
  }
  for (const q of S.teams) if (q.side === 'e' && q.men.length && info[q.obj] && !(unitOf(q) && unitOf(q).state === 'rout')) info[q.obj].def += q.men.length;
  a4Ca(C, info, aiD());
  a4Res(C, info);
  a4Draw(C, info);
  a4Flank(C, info);
  if ((C.bindT -= 1.5) <= 0) { C.bindT = 3; a4Bind(C); }
}
HOOK.step.push(a4Think);

// —— 战线图上的作战计划（front.js frDraw 调用，fL 为战线随缩放的淡出系数）——
// 我方：最近统一发起的冲击（tf.js S.tf.go）画突击箭头与目标处的调整线，30 秒后淡出
// 守方（只在观战时画）：反冲击——出发阵地虚线圈、集结 / 准备中为虚线箭头、发起后实心；火力准备为目标上脉动的准星；
//   预备队整连机动、借兵侧射为细虚线
function frDrawPlans(ctx, fL, spec, time) {
  if (!S) return;
  const arrow = typeof cmdArrow === 'function' ? cmdArrow : null, G = S.tf && Array.isArray(S.tf.go) ? S.tf.go : [];
  ctx.setLineDash([]);
  if (arrow) for (const g of G) {
    const age = S.t - g.t, d = dist(g.x0, g.y0, g.x1, g.y1);
    if (age < 0 || age > 40 || d < 40) continue;
    const a = fL * (age < 30 ? 1 : (40 - age) / 10), u = 1 - Math.min(.3, 45 / d), ex = lerp(g.x0, g.x1, u), ey = lerp(g.y0, g.y1, u), w = Math.max(14, px(7));
    ctx.fillStyle = rgba(COL.g, .08 * a); ctx.strokeStyle = rgba(COL.g, .45 * a); ctx.lineWidth = px(1.3);
    arrow(ctx, [[g.x0, g.y0], [lerp(g.x0, ex, .5), lerp(g.y0, ey, .5)], [ex, ey]], w, .6); ctx.fill(); ctx.stroke();
    // 调整线：越过目标 20 处、垂直于冲击方向的虚横线（突击群在此巩固、调整）
    const an = Math.atan2(g.y1 - g.y0, g.x1 - g.x0), hl = Math.max(40, w * 2.6), cx = g.x1 + Math.cos(an) * 20, cy = g.y1 + Math.sin(an) * 20;
    ctx.strokeStyle = rgba(COL.g, .55 * a); ctx.lineWidth = px(1.6); ctx.setLineDash([px(6), px(4)]);
    ctx.beginPath(); ctx.moveTo(cx - Math.sin(an) * hl, cy + Math.cos(an) * hl); ctx.lineTo(cx + Math.sin(an) * hl, cy - Math.cos(an) * hl); ctx.stroke(); ctx.setLineDash([]);
  }
  // 队形进攻（tf.js S.tf.fm）：两个梯次的推进线（跃进中的梯次实线、掩护梯次虚线）与冲击出发线（细点线），宽为队形横向范围
  const FM = S.tf && S.tf.fm;
  if (FM) for (const k in FM) {
    const F = FM[k];
    if (F.ph !== 'adv') continue;
    const lx = -F.ay, ly = F.ax, w0 = F.w0 - 20, w1 = F.w1 + 20, seg = (s, w) => { const x = F.ox + F.ax * s, y = F.oy + F.ay * s; ctx.moveTo(x + lx * w0 * w, y + ly * w0 * w); ctx.lineTo(x + lx * w1 * w, y + ly * w1 * w); };
    for (let e = 0; e < 2; e++) {
      const on = e === F.lead;
      ctx.strokeStyle = rgba(COL.g, (on ? .65 : .32) * fL); ctx.lineWidth = px(on ? 1.8 : 1.2); ctx.setLineDash(on ? [] : [px(4), px(4)]);
      ctx.beginPath(); seg(F.sE[e], 1); ctx.stroke();
    }
    ctx.strokeStyle = rgba(COL.g, .4 * fL); ctx.lineWidth = px(1.2); ctx.setLineDash([px(1.5), px(4)]);
    ctx.beginPath(); seg(F.L, 1.15); ctx.stroke(); ctx.setLineDash([]);
    // 队形：各组的位置画成指向进攻方向的三角，同一梯次按横向顺序连成队形线——楔形 / 横队 / 散开一眼看得出；
    // 跃进梯次实心亮、掩护梯次空心暗
    const r = Math.max(4, px(5.5)), live = new Set(S.teams.filter(q => q.side === 'p' && q.men.length).map(q => q.id)), pts = [[], []];
    for (const id in F.q) {
      if (!live.has(+id)) continue;
      const o = F.q[id], s = F.sE[o[2]] - o[1];
      pts[o[2]].push([o[0], F.ox + F.ax * s + lx * o[0], F.oy + F.ay * s + ly * o[0]]);
    }
    for (let e = 0; e < 2; e++) {
      const on = e === F.lead, P = pts[e].sort((a, b) => a[0] - b[0]);
      if (P.length > 1) { ctx.strokeStyle = rgba(COL.g, (on ? .6 : .35) * fL); ctx.lineWidth = px(on ? 1.6 : 1.1); ctx.setLineDash(on ? [] : [px(3), px(3)]); ctx.beginPath(); P.forEach(([, x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.setLineDash([]); }
      for (const [, x, y] of P) {
        ctx.beginPath(); ctx.moveTo(x + F.ax * r * 1.6, y + F.ay * r * 1.6); ctx.lineTo(x - F.ax * r + lx * r, y - F.ay * r + ly * r); ctx.lineTo(x - F.ax * r - lx * r, y - F.ay * r - ly * r); ctx.closePath();
        if (on) { ctx.fillStyle = rgba(COL.g, .95 * fL); ctx.fill(); } else { ctx.strokeStyle = rgba(COL.g, .75 * fL); ctx.lineWidth = px(1.4); ctx.stroke(); }
      }
    }
  }
  const C = S.ai && S.ai.co;
  if (!spec || !C) return;
  for (const c of C.ca) {
    const p = ptByKey(c.key), a = fL * (c.end ? clamp(1 - (S.t - c.end) / 20, 0, 1) : 1);
    if (!p || a <= 0) continue;
    ctx.strokeStyle = rgba(COL.enemy, .45 * a); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(3)]);
    ctx.beginPath(); ctx.arc(c.x, c.y, 45, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
    if (c.st === 'prep' && !c.end) {
      const k = .5 + .5 * Math.sin(time * 6), r = 70 + k * 8;
      ctx.strokeStyle = rgba(COL.enemy, (.35 + .35 * k) * a); ctx.lineWidth = px(1.6);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.283);
      for (let i = 0; i < 4; i++) { const b = i * Math.PI / 2; ctx.moveTo(p.x + Math.cos(b) * (r - 14), p.y + Math.sin(b) * (r - 14)); ctx.lineTo(p.x + Math.cos(b) * (r + 14), p.y + Math.sin(b) * (r + 14)); }
      ctx.stroke();
    }
    if (arrow && dist(c.x, c.y, p.x, p.y) > 50) {
      const go = c.st === 'go', ex = lerp(c.x, p.x, .82), ey = lerp(c.y, p.y, .82), w = Math.max(12, px(6));
      ctx.lineWidth = px(1.3); ctx.strokeStyle = rgba(COL.enemy, (go ? .55 : .35) * a); ctx.fillStyle = rgba(COL.enemy, (go ? .1 : .04) * a);
      if (!go) ctx.setLineDash([px(5), px(4)]);
      arrow(ctx, [[c.x, c.y], [ex, ey]], w, .6); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.strokeStyle = rgba(COL.enemy, .32 * fL); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(4)]);
  ctx.beginPath();
  for (const id in C.res) { const r = C.res[id], u = r.st === 'move' && UNIT_MAP.get(+id), c = u && a4Cent(u); if (c) { ctx.moveTo(c[0], c[1]); ctx.lineTo(r.x, r.y); } }
  for (const id in C.fl) { const f = C.fl[id], q = S.teams.find(o => o.id === +id); if (q) { ctx.moveTo(q.x, q.y); ctx.lineTo(f.x, f.y); } }
  for (const id in C.dr || {}) { const r = C.dr[id], u = UNIT_MAP.get(+id); if (u) for (const q of a4Ts(u)) { ctx.moveTo(q.x, q.y); ctx.lineTo(r.x, r.y); } }
  ctx.stroke(); ctx.setLineDash([]);
  for (const id in C.dr || {}) { const r = C.dr[id]; ctx.strokeStyle = rgba(COL.enemy, .4 * fL); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(3)]); ctx.beginPath(); ctx.arc(r.x, r.y, 60, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }
}
