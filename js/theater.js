'use strict';
// 战区指挥与战线推演（双方，钢铁雄心式）
//   层级：战区司令部 → 师（XX）→ 团（III）→ 营（II，三个排以上）/ 连（I）→ 排（•••）。命令逐级下达，每一级都有传达时间（TH.dly），
//     传到哪一级就由哪一级接着往下分；玩家（S.ctl = 'p'）选中任一级下令，命令同样从战区一级级传下去，期间面板上显示「传达中」
//   战线：front.js 的双方前沿（每 30 米一列）就是战线。战区把战线按兵力分给各师、师分给团、团分给营（营多、正面窄时留一个营作第二梯队）；
//     战线比一线各营能守的总宽长得多时只守最要紧的几段（thFocus），战线断成几段时一支部队只分在一段里。
//     营在自己的地段里沿战线排开：一线各排按队形实际宽度留出空当，排不下的往后一排排错开；各排、各车的槽位都和本方已定的错开（thBusy），不挤成一团。推进 = 整条线一步一步往前压：每步一个跃进（TH.bound），不甩开左右友邻（TH.lead），
//     不越过战区的阶段线；地段里的敌据点在战线推过时由最近的排夺取——不再有部队单独直扑指挥所
//   命令：推进 · 穿插（向指定点突击，用营长状态机的开进 / 展开 / 冲击 / 肃清）· 坚守（就地挖工事）· 后撤（退一个后撤距离再坚守）·
//     预备队（撤到战线后方隐蔽集结）· 自动（交还战区 AI）
//   AI：攻方战区——抢滩 → 扩大登陆场到第一阶段线 → 全线按阶段线一段段推进；兵力占优、前方空虚的地段派装甲营穿插。
//     守方战区——登陆前机动兵力隐蔽待机；登陆场出现后各师沿当面封锁，兵力占优的地段向海反击，劣势的退守下一道线
//   旧的零散调兵层（hq.js 司令 / 团长、brain.js、tf.js、ai4 / ai5 的预备队机动、autopilot 的排级自选目标）在这里开着时让位；
//     守备队、碉堡、炮兵、袭扰、舰船抢滩、航空兵、舰炮照旧由各自的模块管
// 状态（纯 JSON）：S.th = { on, nid, f: { id: 编队 }, p: { id 战区编队, k 阶段线序号, kT, sp 进行中的穿插 }, e: { … } }
//   编队 = { id, side, lvl: thr / div / bde / reg, no, name, ech, par, kids: [id], g 营对应的战斗群（S.bgs）id, cols 战线列, sec [x0, x1],
//     ord { v, x, y, src: ai / pl, t } 正在执行的命令, box [{ ord, at }] 在途命令, man 玩家接管, aiSp AI 派出的穿插, p0 初始兵力 }
const TH = { org: 2, think: 4, dly: { div: 5, bde: 3, reg: 2 }, bound: 130, lead: 150, back: 240, rest: 30, minW: 60, maxReg: 4, maxBde: 3, maxDiv: 3,
  head: 260, phase: 300, phaseK: .7, spear: 700, spearT: 160, link: 380, wait: 20,
  gap: 30, vgap: 25, row: 100, rows: 3, focus: 1.2 };   // gap 相邻两排形之间留的空当 · vgap 车辆最小间距 · row 后几排的排距 · focus 正面超出能守宽度多少倍就收缩
// 战区条令参数（司令训练场 tools/train_real.js 按「胜负 + 条令符合度」调出来；S.thFix = { p: {…}, e: {…} } 可覆盖，训练时用）
//   攻方：ech 留作第二梯队的营占上陆营数的比例（联合登陆战役：第一梯队约三分之二）· adv 由坚守恢复推进要的兵力比（推进中掉到它的七成就转入坚守）·
//         prep 由坚守转入推进前的火力准备秒数（舰炮、垂发导弹打当面已知火力点，到点再推进）
//   守方：res 登陆场出现后留作战役预备队的机动营比例（美军机动防御：机动兵力的 1/9–1/3）· ctr 向海反击要的兵力比 ·
//         prep 反击前的炮火准备秒数 · commit 一线吃紧到什么程度（当面敌兵力 / 当面全部守军，含守备队与工事）不等判明主攻就投入预备队 ·
//         det 判明敌主攻要的上陆兵力（一段里已知敌兵力达到它、又比别处多五成）
const TH_DOC = { p: { ech: .25, adv: 2, prep: 0 }, e: { res: .25, ctr: 2, prep: 12, commit: 1.5, det: 15 } };   // 2026-10-27 训练结果（docs/real_train.md）
const thDoc = side => ({ ...TH_DOC[side], ...(S && S.thFix && S.thFix[side] || {}) });
const TH_V = { auto: '自动', advance: '推进', spear: '穿插', hold: '坚守', retreat: '后撤', reserve: '预备队', follow: '第二梯队', ext: '独立作战' };
const TH_LV = { thr: '战区', div: '师', bde: '团', reg: '营' };
const thOn = side => !!S && !!S.th && S.th.on && S.phase === 'battle' && (!side || S.th[side] != null);
const thF = id => (S && S.th && id != null && S.th.f[id]) || null;
const thKids = F => (F && F.kids ? F.kids.map(thF).filter(Boolean) : []);
const thRoot = side => thF(S.th && S.th[side] && S.th[side].id);
const thG = F => F && F.g != null ? (S.bgs || []).find(G => G.id === F.g && !G.dead) || null : null;
const thRegsOf = F => !F ? [] : F.lvl === 'reg' ? [F] : thKids(F).flatMap(thRegsOf);
const thDir = side => side === 'p' ? -1 : 1;   // 向前：攻方向北（y 变小），守方向南（向海）
const thStat = (k, n = 1) => { const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
const thErr = {};
function thTry(k, fn) { try { return fn(); } catch (e) { if (!thErr[k]) { thErr[k] = 1; console.error('theater ' + k, e); } if (typeof CMD_STRICT !== 'undefined' && CMD_STRICT) throw e; } }

// ———————————————— 兵力、组织度 ————————————————
function thPow(F) { let s = 0; for (const R of thRegsOf(F)) { const G = thG(R); if (G) s += hqRegPow(G).tot; } return s; }
function thP0(F) { return thRegsOf(F).reduce((a, R) => a + (R.p0 || 0), 0); }
// 组织度：各排士气（压制越重越低）的平均，0–100；坦克车组按车体完好度
function thOrg(F) {
  let s = 0, n = 0;
  for (const R of thRegsOf(F)) {
    const G = thG(R);
    if (!G) continue;
    for (const u of bgUnits(G)) { const ts = teamsOf(u).filter(q => q.men.length); if (!ts.length) continue; const sup = ts.reduce((a, q) => a + (q.sup || 0), 0) / ts.length; s += clamp((u.morale ?? 70) - sup * .35 - (u.state === 'rout' ? 40 : 0), 0, 100); n++; }
    for (const v of bgVehs(G)) { s += clamp(100 * v.hp / Math.max(1, v.maxhp), 0, 100) * (v.immob ? .5 : 1); n++; }
  }
  return n ? s / n : 0;
}
const thMen = F => thRegsOf(F).reduce((a, R) => { const G = thG(R); return a + (G ? bgUnits(G).reduce((b, u) => b + teamsOf(u).reduce((c, q) => c + q.men.length, 0), 0) : 0); }, 0);
const thVehN = F => thRegsOf(F).reduce((a, R) => { const G = thG(R); return a + (G ? bgVehs(G).length : 0); }, 0);
// thAtV：画面用（番号牌、定位）——按各营成员的实际位置（orbat.js bgAt）；thAt 按锚点，给指挥逻辑用
//   取兵力最集中的那一片（各营按兵力加权，450 米内兵力最多的营为中心，700 米内加权平均），不落在相隔很远的几个营中间的空地上；
//   还没上岸的营不算（都没上岸时 n = 0，番号牌不画）
function thAtV(F) {
  const P = [];
  let x0 = 0, y0 = 0, w0 = 0;
  for (const R of thRegsOf(F)) {
    const G = thG(R);
    if (!G) continue;
    const k = Math.max(1, hqRegPow(G).tot), c = bgAt(G);
    if (c.n === 0) { x0 += c.x * k; y0 += c.y * k; w0 += k; } else P.push([c.x, c.y, k]);
  }
  if (!P.length) return w0 ? { x: x0 / w0, y: y0 / w0, n: 0 } : null;
  let bi = 0, bw = -1;
  for (let i = 0; i < P.length; i++) { let w = 0; for (const p of P) if (dist(p[0], p[1], P[i][0], P[i][1]) < 450) w += p[2]; if (w > bw) { bw = w; bi = i; } }
  let x = 0, y = 0, w = 0;
  for (const p of P) if (dist(p[0], p[1], P[bi][0], P[bi][1]) < 700) { x += p[0] * p[2]; y += p[1] * p[2]; w += p[2]; }
  return { x: x / w, y: y / w, n: P.length };
}
const thAt = F => { let x = 0, y = 0, w = 0; for (const R of thRegsOf(F)) { const G = thG(R); if (!G) continue; const k = Math.max(1, hqRegPow(G).tot); x += G.ax * k; y += G.ay * k; w += k; } return w ? { x: x / w, y: y / w } : null; };

// ———————————————— 战线 ————————————————
// 某方自己的战线（这一列的 y）：攻方 = 'p' 视角的进攻方前沿；守方 = 'e' 视角的守方前沿，没有就取当面敌前沿以北 160
function thLineY(side, x) {
  if (!S.front || typeof frFront !== 'function') return null;
  if (side === 'p') return frFront('p', x).fp;
  const f = frFront('e', x);
  return f.fe != null ? (f.fp != null ? Math.min(f.fe, f.fp - 40) : f.fe) : f.fp != null ? f.fp - 160 : null;
}
// 当面敌前沿
function thFoeY(side, x) { if (!S.front || typeof frFront !== 'function') return null; const f = frFront(side, x); return side === 'p' ? f.fe : f.fp; }
// 需要兵力的战线列：只认真有地面部队的地段——攻方 = 自己已上岸的兵 / 车（海上泅渡的两栖车不算）一带的前沿；
//   守方 = 看得见或记得住的、已上岸之敌一带的敌登陆场前沿（两端各外扩 3 列）
function thCols(side) {
  if (!S.front) return [];
  const V = S.front[side === 'p' ? 'p' : 'e'], A = V.fp, has = new Uint8Array(FR_NX), out = [];
  const mark = x => { const b = frBand(x); for (let k = -6; k <= 6; k++) if (b + k >= 0 && b + k < FR_NX) has[b + k] = 1; };
  if (side === 'p') {
    for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y)) mark(q.x);
    for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && !v.swim && isLand(v.x, v.y)) mark(v.x);
    for (let b = 0; b < FR_NX; b++) if (A[b] != null && has[b]) out.push(b);
    return out;
  }
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y) && (EV[ci(q.x, q.y)] || (q.es != null && S.t - q.es < 60))) mark(q.x);
  // 记忆：一列上 60 秒内确认过敌登陆场，就仍算（敌人一时钻进隐蔽处看不见，不等于登陆场没了）
  const M = S.th.e.colT && S.th.e.colT.length === FR_NX ? S.th.e.colT : (S.th.e.colT = Array(FR_NX).fill(-99));
  for (let b = 0; b < FR_NX; b++) if (A[b] != null && has[b]) M[b] = S.t;
  const on = new Uint8Array(FR_NX);
  for (let b = 0; b < FR_NX; b++) if (S.t - M[b] < 60) for (let k = -3; k <= 3; k++) if (b + k >= 0 && b + k < FR_NX) on[b + k] = 1;
  for (let b = 0; b < FR_NX; b++) if (on[b]) out.push(b);
  return out;
}
// 一个营能守的正面（米）：每人 7 米、每车 15 米，90–480 米
const thCap = G => clamp(bgUnits(G).reduce((a, u) => a + teamsOf(u).reduce((b, q) => b + q.men.length, 0), 0) * 7 + bgVehs(G).length * 15, 90, 480);
// 一串战线列断成连续的几段（相隔超过 3 列就算断开）
function thSegs(cols) { const out = []; for (const b of cols) { const s = out[out.length - 1]; if (s && b - s[s.length - 1] <= 3) s.push(b); else out.push([b]); } return out; }
// 收缩正面：战线比一线各营能守的总宽（thCap 之和）长出 TH.focus 倍以上时，只守最要紧的几段——攻方守自己兵力集中的地方，
//   守方守当面敌兵力多、身后有本方据点的地方；其余地段不再摊兵（兵少线长时不把人撒成一条细线，集中起来守得住）
function thFocus(side, cols, divs) {
  const T = S.th[side];
  let cap = 0;
  for (const D of divs) for (const R of thRegsOf(D)) { const G = thG(R); if (G && thInLine(R)) cap += thCap(G); }
  const B = Math.max(8, Math.round(cap * TH.focus / FR_G));
  if (cols.length <= B) { T.foc = null; return cols; }
  // 每列的分量（左右各 5 列平滑）：攻方 = 已上岸的本方兵力；守方 = 看得见或记得住的已上岸之敌 + 本方据点
  const wt = new Float64Array(FR_NX), add = (x, w) => { const b = frBand(x); for (let k = -5; k <= 5; k++) if (b + k >= 0 && b + k < FR_NX) wt[b + k] += w * (1 - Math.abs(k) / 6); };
  const known = o => side === 'p' || EV[ci(o.x, o.y)] || (o.es != null && S.t - o.es < 60);
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y) && known(q)) add(q.x, q.men.length);
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && !v.swim && isLand(v.x, v.y) && known(v)) add(v.x, 3);
  if (side === 'e') for (const p of S.points) if (p.owner !== 'p') add(p.x, 4 * (p.vp || 1));
  const prev = new Set(T.foc || []);
  for (const b of cols) if (prev.has(b)) wt[b] *= 1.3;   // 上次守的地段优先，不来回换
  // 按段的总分量从大到小整段取，取到预算用完；放不下的那一段只取分量最大的一截
  const segs = thSegs(cols).map(c => ({ c, w: c.reduce((a, b) => a + wt[b], 0) })).sort((a, b) => b.w - a.w), pick = [];
  let left = B;
  for (const o of segs) {
    if (left < 4) break;
    if (o.c.length <= left) { pick.push(...o.c); left -= o.c.length; continue; }
    let bi = 0, bw = -1, acc = 0;
    for (let i = 0; i < o.c.length; i++) { acc += wt[o.c[i]]; if (i >= left) acc -= wt[o.c[i - left]]; if (i >= left - 1 && acc > bw) { bw = acc; bi = i - left + 1; } }
    pick.push(...o.c.slice(bi, bi + left)); left = 0;
  }
  pick.sort((a, b) => a - b);
  if (!T.foc) thStat('thFocus' + side);
  T.foc = pick;
  return pick;
}

// 攻方阶段线：第 k 道 = 岸线向内陆 TH.head + k × TH.phase（不是一条直线，跟着岸线走）
const thPL = (k, x) => coastAt(clamp(x, 0, W - 1)) - (TH.head + TH.phase * k);

// 把一串战线列按兵力比例分给几支部队（左右顺序按它们上次的地段 / 现在的位置排，不互相穿插）
// 战线断成几段时，每支部队只分在离它最近的那一段里，不跨过空当把一个营撒在两段上；没有部队的段空着（那里的兵归回各自部队的地段）
const thKey = F => F.sec0 != null ? F.sec0 : (thAt(F) || { x: W / 2 }).x;
function thSplit(cols, items) {
  for (const F of items) { F.cols = []; F.sec = null; }
  if (!items.length || !cols.length) return;
  const segs = thSegs(cols);
  if (segs.length > 1) {
    const grp = segs.map(() => []);
    for (const F of items) {
      const k = thKey(F); let bi = 0, bd = Infinity;
      segs.forEach((c, i) => { const x0 = c[0] * FR_G, x1 = (c[c.length - 1] + 1) * FR_G, d = k < x0 ? x0 - k : k > x1 ? k - x1 : 0; if (d < bd) { bd = d; bi = i; } });
      grp[bi].push(F);
    }
    segs.forEach((c, i) => { if (grp[i].length) thSplit1(c, grp[i]); });
    return;
  }
  thSplit1(cols, items);
}
function thSplit1(cols, items) {
  const key = thKey;
  items.sort((a, b) => key(a) - key(b));
  const w = items.map(F => Math.max(4, thPow(F))), tot = w.reduce((a, b) => a + b, 0);
  let k = 0;
  items.forEach((F, i) => {
    const n = i === items.length - 1 ? cols.length - k : Math.max(1, Math.min(cols.length - k - (items.length - 1 - i), Math.round(cols.length * w[i] / tot)));
    F.cols = cols.slice(k, k + n);
    if (F.cols.length) { F.sec = [F.cols[0] * FR_G, (F.cols[F.cols.length - 1] + 1) * FR_G]; F.sec0 = (F.sec[0] + F.sec[1]) / 2; }
    k += n;
  });
}

// ———————————————— 编队与命令 ————————————————
function thNew(side, lvl, par, name, o) {
  const id = 'F' + S.th.nid++, F = { id, side, lvl, par: par ? par.id : null, kids: [], name, ord: null, box: [], man: false, p0: 0, t: S.t, ...o };
  S.th.f[id] = F;
  if (par) par.kids.push(id);
  return F;
}
function thName(side, lvl, small) {
  const T = S.th[side], n = (T.n[lvl] = (T.n[lvl] || 0) + 1);
  if (lvl === 'div') return side === 'p' ? `两栖第${n}师` : `守军第${n}师`;
  if (lvl === 'bde') return `第${n}团`;
  return small ? `第${n}连` : `第${n}营`;
}
const thVerb = o => !o ? '待命' : o.v === 'spear' ? '穿插' : o.v === 'ext' ? o.txt || TH_V.ext : TH_V[o.v] || o.v;
// 战区调度的师（独立指挥的编队 F.ext 只进列表：如美军第 101 空降师由空降模块 a101.js 指挥）
const thDivs = side => thKids(thRoot(side)).filter(d => !d.ext);
// 下令：同一支部队只留最新的一道在途命令（新命令顶掉还没传到的旧命令）
function thSend(F, ord, delay) {
  if (!F) return;
  const at = S.t + (delay != null ? delay : TH.dly[F.lvl] || 0);
  F.box = [{ ord: { ...ord, t: S.t }, at }];
}
// 玩家下令：命令从战区经各级司令部传到这支部队（传达时间按经过的级数累加）
function thPlayer(F, v, x, y) {
  if (!F || F.side !== S.ctl || F.ext) return false;
  let d = 0;
  for (const l of ['div', 'bde', 'reg']) { d += TH.dly[l]; if (l === F.lvl) break; }
  if (v === 'auto') {
    const clear = K => { K.man = false; K.aiK = null; thKids(K).forEach(clear); };
    clear(F);
    const P = thF(F.par);
    thSend(F, P && P.ord && P.lvl !== 'thr' ? thChildOrd(P, F, P.ord) : { v: 'hold', src: 'ai' }, d);
  } else {
    F.man = true; F.aiSp = false;
    thSend(F, { v, x: x != null ? Math.round(x) : null, y: y != null ? Math.round(y) : null, src: 'pl' }, d);
  }
  const at = x != null ? { x, y } : thAt(F);
  if (typeof chatSay === 'function') chatSay(F.side, `战区司令部 → ${F.name}：${v === 'auto' ? '交还战区统一指挥' : v === 'spear' ? `向${typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y)}穿插` : TH_V[v]}（命令约 ${d} 秒后送达）。`, { kind: 'order', at, lv: 0 });
  thStat('thPlayer');
  return true;
}
// 上级命令落到下级：穿插只派最能打的一个营（装甲营优先），其余在原地段推进；第二梯队 / 预备队照传
function thChildOrd(P, K, ord) {
  if (ord.v !== 'spear') return { ...ord };
  const regs = thRegsOf(P), best = regs.slice().sort((a, b) => thSpearScore(b) - thSpearScore(a))[0];
  return thRegsOf(K).includes(best) ? { ...ord } : { ...ord, v: 'advance' };
}
function thSpearScore(R) { const G = thG(R); if (!G) return -1; const P = hqRegPow(G); return P.veh * 1.5 + P.tot + (G.type === 'armor' ? 20 : G.type === 'mech' ? 8 : 0); }
// 命令送达：记下、往下转；营开始执行
function thRecv(F, ord) {
  const was = F.ord && F.ord.v;
  F.ord = ord; F.ordT = S.t;
  if (F.lvl === 'reg') { const G = thG(F); if (G) { G.tk = null; G.thFb = null; } }
  else for (const K of thKids(F)) if (!K.man || ord.src === 'pl') { if (ord.src === 'pl') { K.man = false; K.e2 = false; K.rsv = false; } if ((!K.aiSp && !K.e2 && !K.rsv) || ord.src === 'pl') thSend(K, thChildOrd(F, K, ord)); }
  if (was !== ord.v && F.lvl !== 'reg' && typeof chatSay === 'function') {
    const n = thKids(F).length;
    chatSay(F.side, `${F.name}收到${ord.src === 'pl' ? '战区' : '上级'}命令：${thVerb(ord)}${n ? `，转令所属 ${n} 个${F.lvl === 'div' ? '团' : '营连'}` : ''}。`, { kind: 'order', at: thAtV(F), lv: F.lvl === 'div' ? 1 : 2, key: 'thr' + F.id, gap: 8 });
  }
}
function thDeliver() {
  for (const id in S.th.f) {
    const F = S.th.f[id];
    if (F.box && F.box.length && F.box[0].at <= S.t) { const b = F.box.shift(); thRecv(F, b.ord); }
  }
}
// 有效命令：自己的（没有就按上级的推进 / 坚守）
const thOrdOf = F => F.ord || (F.par && thF(F.par) && thF(F.par).ord) || { v: 'hold', src: 'ai' };

// ———————————————— 编组 ————————————————
// 营（战斗群）建在某个团下：不到 25 人、车不到 4 辆的叫连
function thMkReg(side) {
  return (us, vs, at) => {
    const men = us.reduce((a, u) => a + (u.men || 0), 0), big = men >= 25 || vs.length >= 3;
    const B = thHome(side, at.x, big), small = men < 25 && vs.length < 4, F = thNew(side, 'reg', B, thName(side, 'reg', small), { ech: small ? 'I' : 'II' });
    const G = bgNew(side, F.name, small ? '连长' : '营长', { us: [], vs: [], rec: [], ax: Math.round(at.x), ay: Math.round(at.y), key: null, ech: F.ech, reg: true, th: F.id, no: S.th.nid,
      task: { v: 'reserve', x: Math.round(at.x), y: Math.round(at.y), face: side === 'e' ? SOUTH : NORTH }, asmT: 30, face: side === 'e' ? SOUTH : NORTH });
    hqTake(G, us, vs);
    G.type = hqRegType(G); G.p0 = hqRegPow(G).tot;
    F.g = G.id; F.p0 = G.p0;
    F.ord = { ...thOrdOf(B) }; F.ordT = S.t;   // 新营接上所属团现在的命令
    return G;
  };
}
// 新营放进哪个师、哪个团：离得近的师（地段或位置 TH.link × 2 以内），团不满三个营就进团，否则新编一个团；
//   师不够近、且这股兵够一个像样的营（25 人以上或 3 辆车以上）才新编一个师——偏航、佯攻上岸的零星部队编进最近的师，不单独挂师的番号
function thHome(side, x, big = true) {
  const R = thRoot(side), divs = thDivs(side);
  let D = null, bd = TH.link * 2;
  for (const d of divs) {
    const c = d.sec ? (d.sec[0] + d.sec[1]) / 2 : (thAt(d) || { x: -1e9 }).x, half = d.sec ? (d.sec[1] - d.sec[0]) / 2 : 0, dd = Math.max(0, Math.abs(x - c) - half);
    if (dd < bd) { bd = dd; D = d; }
  }
  if (!D && (divs.length >= TH.maxDiv || (!big && divs.length))) D = divs.slice().sort((a, b) => Math.abs((thAt(a) || { x: 0 }).x - x) - Math.abs((thAt(b) || { x: 0 }).x - x))[0];
  if (!D) { D = thNew(side, 'div', R, thName(side, 'div'), { ech: 'XX' }); D.sec0 = x; }
  let B = thKids(D).filter(b => b.kids.length < TH.maxBde).sort((a, b) => Math.abs((thAt(a) || { x }).x - x) - Math.abs((thAt(b) || { x }).x - x))[0];
  if (!B) B = thNew(side, 'bde', D, thName(side, 'bde'), { ech: 'III' });
  return B;
}
function thMake(side, us, vs) {
  if (!us.length && !vs.length) return [];
  const all = [...us, ...vs], cx = all.reduce((a, o) => a + o.x, 0) / all.length;
  const made = hqMakeRegs(side, null, us, vs, 'mix', true, thMkReg(side));
  const up = G => { const R = thF(G.th), B = R && thF(R.par), D = B && thF(B.par); return [D && D.name, B && B.name].filter(Boolean).join(''); };
  if (made.length && typeof chatSay === 'function') chatSay(side, `编组：${made.map(G => { const P = hqRegPow(G); return `${G.name}（步兵 ${P.inf} 人${bgVehs(G).length ? `、车辆 ${bgVehs(G).length} 辆` : ''}，归${up(G)}）`; }).join('、')}。`, { kind: 'report', at: { x: cx, y: all[0].y }, lv: 2 });
  thStat('thMake', made.length);
  return made;
}
// 编队里已有的排 / 车
function thMembers(side) {
  const us = new Set(), vs = new Set();
  for (const G of S.bgs || []) if (!G.dead && G.side === side) { G.us.forEach(id => us.add(id)); G.vs.forEach(id => vs.add(id)); }
  return { us, vs };
}
const thAir = u => u.ab != null || u.emblem === 'para' || u.a101;   // 空降兵、特种部队：各自的模块指挥
// 攻方：上岸的排、车编进营；新上岸的先就近补进没满编的营，凑够了另编新营
function thOrgP() {
  const M = thMembers('p');
  const us = S.units.filter(u => u.side === 'p' && u.kind === 'inf' && u.state !== 'rout' && u.x != null && isFinite(u.x) && isLand(u.x, u.y) && !M.us.has(u.id) && !thAir(u) &&
    teamsOf(u).some(q => q.men.length && !q.ride) && (u.men || 0) >= 2 && !(u.y < (thLineY('p', u.x) ?? -1e9) - 150));   // 战线外很远的（空投到敌后的）不编
  const vs = (S.veh || []).filter(v => v.side === 'p' && !v.dead && !v.lst && !v.swim && v.bgG == null && !M.vs.has(v.id) && isLand(v.x, v.y) && v.ai !== 'repair' && !v.immob && !(v.mod && v.mod.cram) && v.auto !== false);
  thFold('p', us, vs);
}
// 守方：预备队与机动车辆（开战后陆续到的增援、弃车乘员也一样）
function thOrgE() {
  const { us, vs } = hqPoolE(), M = thMembers('e');
  thFold('e', us.filter(u => !M.us.has(u.id) && !thAir(u)), vs.filter(v => !M.vs.has(v.id)));
}
function thFold(side, us, vs) {
  const regs = thDivs(side).flatMap(thRegsOf).map(R => ({ R, G: thG(R) })).filter(o => o.G);
  const rest = [], restV = [];
  for (const u of us) {
    u.thW = u.thW ?? S.t;
    const tiny = (u.men || 0) < 4, r = tiny ? TH.link * 4 : TH.link;   // 一两个兵的零散小组：并进就近的营，不单独成连
    const o = regs.filter(o => (tiny || bgUnits(o.G).length < TH.maxReg) && dist(o.G.ax, o.G.ay, u.x, u.y) < r).sort((a, b) => dist(a.G.ax, a.G.ay, u.x, u.y) - dist(b.G.ax, b.G.ay, u.x, u.y))[0];
    if (o) { hqTake(o.G, [u], []); u.thW = null; continue; }
    rest.push(u);
  }
  for (const v of vs) {
    const o = regs.filter(o => bgVehs(o.G).length < 14 && dist(o.G.ax, o.G.ay, v.x, v.y) < TH.link * 1.4).sort((a, b) => dist(a.G.ax, a.G.ay, v.x, v.y) - dist(b.G.ax, b.G.ay, v.x, v.y))[0];
    if (o && (side === 'p' || hqTank(v) || rest.length < 2)) { hqTake(o.G, [], [v]); continue; }
    restV.push(v);
  }
  // 凑够两个排（或等满 TH.wait 秒）、或三辆以上车辆：另编新营
  const old = rest.filter(u => S.t - u.thW > TH.wait);
  const restMen = rest.reduce((a, u) => a + (u.men || 0), 0);
  if (side === 'e' ? restMen >= 6 || restV.length >= 2 : rest.length >= 2 || old.length || restV.length >= 3 || (rest.length && restV.length)) {
    thMake(side, rest, restV);
    for (const u of rest) u.thW = null;
  }
}
// 撤编合并：营打光了（没有能动的车，人不足 4 个、或兵力打到编成时的一成五以下又不足 8 人）就撤销番号，残部并入就近的营——
//   面板、地图上不再有这个番号，也不再给它下命令；趴窝的车留在原地当固定火力点。全军只剩这一股人时留着。
//   师打到不足 15 人（车不超过 1 辆）就撤销，所属的营划给最近的师
const thSpent = F => { const G = thG(F); if (!G || bgVehs(G).some(v => !v.immob)) return false; const men = thMen(F); return men < 4 || (men < 8 && thPow(F) < (F.p0 || 1) * .15); };
function thMerge(side) {
  const R0 = thRoot(side);
  if (!R0) return;
  const regs = thDivs(side).flatMap(thRegsOf).filter(F => thG(F));
  for (const F of regs) {
    const G = thG(F);
    if (!G || !thSpent(F)) continue;
    const men = thMen(F), o = regs.filter(R => R !== F && thG(R) && !thSpent(R)).map(R => ({ R, G: thG(R) })).sort((a, b) => dist(a.G.ax, a.G.ay, G.ax, G.ay) - dist(b.G.ax, b.G.ay, G.ax, G.ay))[0];
    if (!o && men) continue;
    const us = bgUnits(G);
    G.us = []; G.vs = [];   // 空营下面 thPrune 撤掉
    if (o) hqTake(o.G, us, []);
    thStat('thMergeReg');
    if (men && typeof chatSay === 'function') chatSay(side, `${F.name}打光了，只剩 ${men} 人，番号撤销，残部并入${o.R.name}。`, { kind: 'report', at: { x: G.ax, y: G.ay }, lv: 2, key: 'thsp' + F.id, gap: 30 });
  }
  const divs = thDivs(side).filter(D => thRegsOf(D).some(R => thG(R)));
  for (const D of divs) {
    if (divs.length < 2 || thMen(D) >= 15 || thVehN(D) > 1) continue;
    const c = thAt(D) || { x: W / 2, y: H / 2 };
    const T = divs.filter(o => o !== D && thMen(o) >= 15).sort((a, b) => dist((thAt(a) || c).x, (thAt(a) || c).y, c.x, c.y) - dist((thAt(b) || c).x, (thAt(b) || c).y, c.x, c.y))[0];
    if (!T) continue;
    for (const R of thRegsOf(D)) {
      const P = thF(R.par);
      if (P) { P.kids = P.kids.filter(k => k !== R.id); P.mg = 1; }
      let B = thKids(T).filter(b => b.kids.length < TH.maxBde).sort((a, b) => Math.abs((thAt(a) || c).x - c.x) - Math.abs((thAt(b) || c).x - c.x))[0];
      if (!B) B = thNew(side, 'bde', T, thName(side, 'bde'), { ech: 'III' });
      R.par = B.id; B.kids.push(R.id);
      R.man = false; R.aiSp = false; R.ord = { ...thOrdOf(B), t: S.t }; R.ordT = S.t; R.box = [];
    }
    D.mg = 1;
    if (typeof chatSay === 'function') chatSay(side, `${D.name}兵力不足 15 人，撤销番号，残部划归${T.name}。`, { kind: 'report', at: c, lv: 1 });
    thStat('thMergeDiv');
  }
}
// 清理：打光的营、空的团 / 师
// 独立指挥的编队：美军第 101 空降师落地后编成的团战斗队（a101.js 的战斗群，由空降模块指挥）进守方列表——单列一个师，只显示、不归战区调度
function thExt() {
  const R = thRoot('e');
  if (!R) return;
  for (const G of S.bgs || []) {
    if (!G.a101 || G.dead || G.thx) continue;
    const D = thKids(R).find(d => d.ext === 'a101') || thNew('e', 'div', R, '美军第101空降师', { ech: 'XX', ext: 'a101' });
    const F = thNew('e', 'reg', D, G.name, { ech: 'III', ext: 'a101', g: G.id, p0: Math.max(1, hqRegPow(G).tot) });
    G.thx = F.id; G.ech = 'III';
  }
  for (const id in S.th.f) {
    const F = S.th.f[id];
    if (F.ext !== 'a101') continue;
    if (F.lvl === 'reg') { const G = thG(F); if (G) { F.p0 = Math.max(F.p0 || 1, hqRegPow(G).tot); F.ord = { v: 'ext', txt: G.st === 'asm' ? '空降集结' : G.st === 'withdraw' ? '后撤' : '空降反击', src: 'ai', t: S.t }; } }
    else F.ord = { v: 'ext', txt: '空降作战', src: 'ai', t: S.t };
  }
}
function thPrune() {
  thMerge('p'); thMerge('e');
  for (const id of Object.keys(S.th.f)) {
    const F = S.th.f[id];
    if (!F || F.lvl === 'thr') continue;
    let dead = false;
    if (F.lvl === 'reg') {
      const G = thG(F);
      if (!G) dead = true;
      else if (!bgUnits(G).length && !bgVehs(G).length) { G.dead = true; G.done = true; dead = true; }
    } else dead = !F.kids.some(k => S.th.f[k]);
    if (!dead) continue;
    const P = thF(F.par);
    if (P) P.kids = P.kids.filter(k => k !== id);
    delete S.th.f[id];
    if (typeof chatSay === 'function' && F.lvl !== 'reg' && !F.mg) chatSay(F.side, `${F.name}已失去战斗力，番号撤销，残部并入友邻。`, { kind: 'report', lv: 1 });
  }
}

// ———————————————— 战线分配：战区 → 师 → 团 → 营 ————————————————
const thInLine = F => { const v = thOrdOf(F).v; return v !== 'reserve' && v !== 'spear' && v !== 'follow'; };
function thAlloc(side) {
  const divs = thDivs(side).filter(d => thPow(d) > 0), cols = thFocus(side, thCols(side), divs.filter(thInLine));
  thSplit(cols, divs.filter(thInLine));
  for (const D of divs) {
    const bdes = thKids(D).filter(b => thPow(b) > 0);
    thSplit(D.cols || [], bdes.filter(thInLine));
    for (const B of bdes) {
      let regs = thKids(B).filter(r => thG(r));
      // 第二梯队：团里三个营以上、正面又窄（每营不到 180 米），最弱的一个营跟在后面；条件不在了就回到一线。选定了就不换人
      const v = thOrdOf(B).v, w = (B.cols || []).length * FR_G, cur = regs.find(r => r.ord && r.ord.v === 'follow' && !r.man && !r.e2);
      const n = regs.filter(thInLine).length + (cur ? 1 : 0), need = (v === 'advance' || v === 'hold') && n >= 3 && w < 180 * (n - 1);
      if (cur && !need) cur.ord = { ...thOrdOf(B), t: S.t };
      if (!cur && need) { const weak = regs.filter(r => thInLine(r) && !r.man && !r.aiSp && !r.e2 && !r.rsv).sort((a, b) => thPow(a) - thPow(b))[0]; if (weak) weak.ord = { v: 'follow', src: 'ai', lead: B.id, t: S.t }; }
      regs = regs.filter(thInLine);
      thSplit(B.cols || [], regs);
    }
  }
}

// ———————————————— 战区 AI ————————————————
// 一个师当面的态势：本师兵力 / 已知当面敌兵力（沿地段抽几列，在敌前沿一带量）
function thOdds(side, F) {
  const cols = F.cols || [], pw = thPow(F);
  if (!cols.length) return { pw, foe: 0, r: 9 };
  // 沿地段每 300 米量一处（半径 150），量的是敌前沿一带已知的敌兵力
  let foe = 0;
  const n = Math.max(1, Math.round(cols.length * FR_G / 300));
  for (let i = 0; i < n; i++) {
    const x = frBX(cols[Math.min(cols.length - 1, Math.floor((i + .5) * cols.length / n))]), fy = thFoeY(side, x), y = fy != null ? fy : thLineY(side, x);
    if (y != null) foe += frKnown(side, x, fy != null ? y : y + thDir(side) * 110, fy != null ? 200 : 150).foe;
  }
  return { pw, foe, r: pw / Math.max(1, foe) };
}
// 攻方：按前沿模块的地段统计（S.front.sec：地段内我方兵力、前沿以北 300 内的敌兵力）合计本师地段的兵力比——贴在战线上的敌人也算进去
function thPress(side, F) {
  if (side !== 'p' || !S.front || !S.front.sec || !F.sec) return thOdds(side, F);
  let pw = 0, ew = 0;
  for (const s of S.front.sec) { const ov = Math.min(s.x1, F.sec[1]) - Math.max(s.x0, F.sec[0]); if (ov > 0) { const k = ov / Math.max(1, s.x1 - s.x0); pw += s.pw * k; ew += s.ew * k; } }
  const o = thOdds(side, F);
  return { pw: Math.max(pw, o.pw * .5), foe: Math.max(ew, o.foe), r: Math.max(pw, o.pw * .5) / Math.max(1, Math.max(ew, o.foe)) };
}
// 近 90 秒掉了多少兵力（0–1）：每次战区思考记一笔
function thDrop(F) {
  const h = F.hist || (F.hist = []), pw = thPow(F);
  h.push([S.t, pw]);
  while (h.length && S.t - h[0][0] > 90) h.shift();
  const mx = Math.max(...h.map(o => o[1]));
  return mx > 0 ? 1 - pw / mx : 0;
}
function thAiSend(D, v, why, extra) {
  if (D.man || D.aiSp) return;
  const k = v + ':' + (extra ? Math.round(extra.x / 100) + ',' + Math.round(extra.y / 100) : '');
  if (D.aiK === k) return;
  if (D.aiK && S.t - (D.aiT ?? -99) < TH.rest && v !== 'retreat') return;   // 命令下了至少执行 30 秒，不朝令夕改（后撤除外）
  D.aiK = k; D.aiT = S.t;
  thSend(D, { v, src: 'ai', ...(extra || {}) });
  if (typeof chatSay === 'function') chatSay(D.side, `战区司令部 → ${D.name}：${TH_V[v]}${why ? '，' + why : ''}。`, { kind: 'order', at: thAtV(D), lv: 1, key: 'tha' + D.id, gap: 10 });
}
// 攻方战区：阶段线推进
function thThinkP(T) {
  const divs = thDivs('p').filter(d => thPow(d) > 0);
  if (!divs.length) return;
  const cols = thCols('p');
  // 阶段线：七成战线到了这一道（或越过），就把阶段线推到下一道
  if (cols.length) {
    const got = cols.filter(b => { const y = S.front.p.fp[b]; return y != null && y <= thPL(T.k, frBX(b)) + 60; }).length;
    const left = S.points.filter(p => p.owner !== 'p' || p.prog < .99);
    if (got >= cols.length * TH.phaseK && left.length) {
      T.k++; T.kT = S.t;
      const L = left.filter(p => p.y >= thPL(T.k, p.x)).map(p => p.name);
      if (typeof chatSay === 'function') chatSay('p', T.k === 1 ? `战区：登陆场已扩大到第一阶段线，全线转入向纵深推进——下一阶段线${L.length ? `：${L.slice(0, 4).join('、')}一线` : ''}。` : `战区：第 ${T.k} 阶段线已到，全线继续推进${L.length ? `，前出至${L.slice(0, 4).join('、')}一线` : ''}。`, { kind: 'plan', lv: 0 });
      thStat('thPhase');
    }
  }
  // 巩固登陆场：后续梯队（还载着兵、正驶向滩头的舰艇）没上来之前，先沿滩头一线挖工事顶住反冲击（第一批上岸后最多等 150 秒）
  const afloat = S.ships.some(s => alive(s) && s.land && (s.state === 'move' || s.state === 'unloading') && s.load && (s.load.teams > 0 || (Array.isArray(s.load.veh) && s.load.veh.length)));
  if (T.landT == null && divs.length) T.landT = S.t;
  const consol = T.k === 0 && afloat && S.t - T.landT < 150, dc = thDoc('p');
  for (const D of divs) {
    const o = thPress('p', D), drop = thDrop(D), str = thPow(D) / Math.max(1, thP0(D)), org = thOrg(D), cur = D.aiK ? D.aiK.split(':')[0] : null;
    // 转入防御要的门槛低、恢复推进要的门槛高（不在两个命令之间来回切）
    const weak = o.foe > 4 && (cur === 'hold' ? o.r < dc.adv || drop > .12 : o.r < dc.adv * .7 || drop > .3);
    if (weak || consol) D.prepT = null;
    if ((str < .3 || org < 22) && divs.length > 1 && divs.some(d => d !== D && thPow(d) > thPow(D))) thAiSend(D, 'reserve', '伤亡过大，撤下来整补');
    else if (consol && !weak) thAiSend(D, 'hold', '后续梯队正在上陆，先沿滩头一线挖工事巩固登陆场');
    else if (weak) thAiSend(D, 'hold', drop > .25 ? `近一分半钟伤亡${Math.round(drop * 100)}%，当面敌反击猛烈，就地转入防御、挖工事，等舰炮和航空兵削弱敌人再攻` : `当面之敌约 ${Math.round(o.foe)}，兵力比 ${o.r.toFixed(1)}:1，不够 ${dc.adv}:1，就地巩固、等火力削弱后再攻`);
    else {
      // 由坚守转入推进：先火力准备（舰炮、垂发导弹打当面已知火力点），到点再全线推进
      if (cur !== 'advance' && o.foe > 2 && dc.prep > 0) {
        if (D.prepT == null) { const n = thPrepFire('p', D, dc.prep); D.prepT = S.t + (n ? dc.prep : 0); }
        if (S.t < D.prepT) continue;
      }
      D.prepT = null;
      thAiSend(D, 'advance', T.k === 0 ? '扩大登陆场，前出至第一阶段线' : `向第 ${T.k} 阶段线推进`);
    }
  }
  thEchP(T, dc);
  thPrepPts(T, dc);
  // 后备队：滩头站稳后开辟增援线，把后备队经抢滩的舰船送上岸补进战线
  if (S.t > 150 && S.assets && S.assets.reserve > 0 && S.assets.rline > 0 && !(S.rlines || []).length && typeof buildRLine === 'function') {
    const c = thAt(divs.slice().sort((a, b) => thPow(b) - thPow(a))[0]) || { x: W / 2, y: H / 2 };
    const sh = S.ships.filter(o => alive(o) && o.state === 'beached' && o.bx != null).sort((a, b) => dist(a.bx, a.by, c.x, c.y) - dist(b.bx, b.by, c.x, c.y))[0];
    if (sh && buildRLine(sh)) { S.rlines[S.rlines.length - 1].cmd = 1; if (typeof chatSay === 'function') chatSay('p', `战区：登陆场已站稳，开辟增援线，后备队 ${S.assets.reserve} 人经${sh.label}上陆补充战线。`, { kind: 'plan', at: { x: sh.bx, y: sh.by }, lv: 0 }); }
  }
  thSpearAi('p', T);
}
// 守方战区：封锁登陆场、占优地段向海反击、劣势退守
function thThinkE(T) {
  const divs = thDivs('e').filter(d => thPow(d) > 0);
  if (!divs.length) return;
  const cols = thCols('e');
  // 战区预备队：两个师以上时留一个师在后方不投入，一线当面敌情吃紧（已知敌兵力超过一线兵力的七成）再投入；投入后两分钟内不再抽回
  if (cols.length && divs.length >= 2) {
    const line = divs.filter(d => d.id !== T.resD), lp = line.reduce((a, d) => a + thPow(d), 0), foe = line.reduce((a, d) => a + thOdds('e', d).foe, 0);
    if (T.resD && (!thF(T.resD) || thF(T.resD).man || foe > lp * .7)) {
      const Rd = thF(T.resD); T.resD = null; T.resT = S.t;
      if (Rd && !Rd.man) { Rd.aiK = null; if (typeof chatSay === 'function') chatSay('e', `战区：一线当面之敌约 ${Math.round(foe)}，投入战区预备队${Rd.name}。`, { kind: 'plan', at: thAtV(Rd), lv: 0 }); }
    } else if (!T.resD && S.t - (T.resT ?? -999) > 120 && foe < lp * .4) {
      const c = divs.filter(d => !d.man).sort((a, b) => thPow(a) - thPow(b))[0];
      if (c && thPow(c) < lp - thPow(c)) T.resD = c.id;
    }
  }
  const dc = thDoc('e');
  thResE(T, cols, dc);
  for (const D of divs) {
    if (!cols.length) { thAiSend(D, 'reserve', '敌登陆方向未明，隐蔽待机'); continue; }
    if (D.id === T.resD) { thAiSend(D, 'reserve', '作战区预备队，隐蔽待机，一线吃紧时投入'); continue; }
    if (!(D.cols && D.cols.length) && thInLine(D)) { thAiSend(D, 'reserve', '当面无敌，作战区预备队'); continue; }
    const o = thOdds('e', D), drop = thDrop(D), str = thPow(D) / Math.max(1, thP0(D)), cur = D.aiK ? D.aiK.split(':')[0] : null;
    if (cur === 'advance' ? o.r >= dc.ctr * .6 && drop < .3 : o.r >= dc.ctr && o.foe >= 3 && drop < .2) {
      // 由坚守转入反击：炮兵先对当面打一阵（a4Focus 加权），到点再出击
      if (cur !== 'advance' && o.foe >= 3 && dc.prep > 0) {
        if (D.prepT == null) { const n = thPrepFire('e', D, dc.prep); D.prepT = S.t + (n ? dc.prep : 0); }
        if (S.t < D.prepT) continue;
      }
      D.prepT = null;
      thAiSend(D, 'advance', o.foe < 1 ? '当面敌情不明，向海搜索前进、压缩登陆场' : `当面之敌约 ${Math.round(o.foe)}，我 ${o.r.toFixed(1)} 倍于敌，炮火准备后向海反击、把登陆场压回去`);
    }
    else if (o.r < .5 && str < .45) { D.prepT = null; thAiSend(D, 'retreat', '兵力不足，边打边撤到下一道防线'); }
    else { D.prepT = null; thAiSend(D, 'hold', '沿当面封锁登陆场'); }
  }
  thSpearAi('e', T);
}
// ———————————————— 条令：火力准备、第二梯队、战役预备队 ————————————————
// 火力准备：本师地段内、己方战线前 450 以内的已知敌火力点，聚成最多 3 处（70 内合计、相距 120 以上）；
//   攻方叫舰炮（commander.js cmdFire）、硬目标加垂发对陆导弹、沙盒护航舰转火；守方给炮兵定火力重点（thFocusE → ai2 aiArtillery 加权）。返回打了几处
function thPrepFire(side, D, secs) {
  const c = thAt(D), sec = D.sec || (c ? [c.x - 220, c.x + 220] : null);
  if (!sec) return 0;
  const its = [], inSec = x => x >= sec[0] - 60 && x <= sec[1] + 60;
  const ahead = (x, y) => { const ly = thLineY(side, x); if (ly == null) return true; const a = side === 'p' ? ly - y : y - ly; return a > -30 && a < 450; };
  if (side === 'p') {
    for (const e of S.enemies) if (!e.dead && e.kx != null && inSec(e.kx) && ahead(e.kx, e.ky)) its.push({ x: e.kx, y: e.ky, w: e.kind === 'bunker' ? 6 : 3, hard: true });
    for (const q of S.teams) if (q.side === 'e' && q.men.length && inVision(q.x, q.y) && inSec(q.x) && ahead(q.x, q.y)) its.push({ x: q.x, y: q.y, w: q.men.length });
    for (const v of S.veh || []) if (v.side === 'e' && !v.dead && inVision(v.x, v.y) && inSec(v.x) && ahead(v.x, v.y)) its.push({ x: v.x, y: v.y, w: bgPow(v), hard: true });
  } else {
    for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && spotted(q.x, q.y) && inSec(q.x) && ahead(q.x, q.y)) its.push({ x: q.x, y: q.y, w: q.men.length });
    for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && spotted(v.x, v.y) && inSec(v.x) && ahead(v.x, v.y)) its.push({ x: v.x, y: v.y, w: bgPow(v) });
  }
  const cl = [];
  for (const o of its) { let w = 0, x = 0, y = 0, hard = false; for (const k of its) if (dist(k.x, k.y, o.x, o.y) < 70) { w += k.w; x += k.x * k.w; y += k.y * k.w; hard = hard || !!k.hard; } cl.push({ x: x / w, y: y / w, w, hard }); }
  cl.sort((a, b) => b.w - a.w);
  const pick = [];
  for (const k of cl) { if (pick.length >= 3) break; if (k.w >= 3 && !pick.some(o => dist(o.x, o.y, k.x, k.y) < 120)) pick.push(k); }
  if (!pick.length) return 0;
  if (side === 'p') {
    let n = 0;
    for (const k of pick) {
      if (typeof cmdFire === 'function' && S.cmd && S.cmd.p && cmdFire(k.x, k.y, 2, 'prep')) n++;
      if (k.hard && typeof vlsCan === 'function' && vlsCan('lacm', k.x, k.y) && vlsFire('lacm', k.x, k.y, 1, 'prep')) n++;
      if (typeof navEnsure === 'function') navEnsure().hot.push({ x: Math.round(k.x), y: Math.round(k.y), until: S.t + secs + 10, why: 'prep' });
    }
    if (n && typeof chatSay === 'function') chatSay('p', `${D.name}推进前先打 ${secs} 秒火力准备：舰炮${n > pick.length ? '和垂发导弹' : ''}压制当面 ${pick.length} 处敌火力点。`, { kind: 'order', at: pick[0], lv: 1, key: 'thprep' + D.id, gap: 30 });
    thStat('thPrepP');
    return n || pick.length;
  }
  const k = pick[0];
  S.th.e.focus = { x: Math.round(k.x), y: Math.round(k.y), r: 130, until: S.t + secs + 8 };
  if (typeof chatSay === 'function') chatSay('e', `${D.name}反击前，炮兵先对${typeof cmdWhere === 'function' ? cmdWhere(k.x, k.y) : gridRef(k.x, k.y)}打 ${secs} 秒火力准备。`, { kind: 'order', at: k, lv: 1, key: 'thprepe' + D.id, gap: 30 });
  thStat('thPrepE');
  return pick.length;
}
// 攻方：战线推到离敌据点 380 以内、据点一带有已知敌兵力（3 人以上）时，对它打一次火力准备（同一据点 90 秒内不重复）；
//   打的是据点 180 以内的已知敌火力点，危险近距由舰炮任务（commander.js）自己把关
function thPrepPts(T, dc) {
  if (!(dc.prep > 0)) return;
  const done = T.prepK || (T.prepK = {});
  for (const p of S.points) {
    if ((p.owner === 'p' && p.prog >= .99) || S.t - (done[p.key] ?? -999) < 90) continue;
    const ly = thLineY('p', p.x);
    if (ly == null || ly - p.y < 0 || ly - p.y > 380 || frKnown('p', p.x, p.y, 180).foe < 3) continue;
    done[p.key] = S.t;
    const its = [];
    for (const e of S.enemies) if (!e.dead && e.kx != null && dist(e.kx, e.ky, p.x, p.y) < 180) its.push({ x: e.kx, y: e.ky, hard: true });
    for (const q of S.teams) if (q.side === 'e' && q.men.length && inVision(q.x, q.y) && dist(q.x, q.y, p.x, p.y) < 180) its.push({ x: q.x, y: q.y });
    let n = 0;
    for (const k of its.slice(0, 3)) {
      if (typeof cmdFire === 'function' && S.cmd && S.cmd.p && cmdFire(k.x, k.y, 2, 'prep')) n++;
      if (k.hard && typeof vlsCan === 'function' && vlsCan('lacm', k.x, k.y) && vlsFire('lacm', k.x, k.y, 1, 'prep')) n++;
    }
    if (typeof navEnsure === 'function') navEnsure().hot.push({ x: p.x, y: p.y, until: S.t + dc.prep + 15, why: 'prep' });
    if (n || its.length) {
      thStat('thPrepPt');
      if (typeof chatSay === 'function') chatSay('p', `战线逼近${p.name}，冲击前先对它打火力准备。`, { kind: 'order', at: p, lv: 1, key: 'thpp' + p.key, gap: 60 });
    }
  }
}
// 守方炮兵的火力重点（ai2.js aiArtillery 对 r 以内的目标加权）
function thFocusE() { const f = S && S.th && S.th.e && S.th.e.focus; return f && S.t < f.until ? f : null; }
// 攻方第二梯队：上陆的营够四个以上时，按 ech 留出营在一线后 200 跟进（先挑最弱、需要整补的）；
//   一线营打残（战力不到四成五或组织度不到 30）就由第二梯队里最强的超越接替，打残的营撤下来作第二梯队整补
function thEchSet(R, on) {
  R.e2 = on;
  const B = thF(R.par), D = B && thF(B.par);
  thSend(R, on ? { v: 'follow', src: 'ai', lead: (D || B || R).id } : { ...thOrdOf(B || R), src: 'ai' }, TH.dly.reg);
}
function thEchP(T, dc) {
  const regs = thDivs('p').flatMap(thRegsOf).filter(R => thG(R) && !R.man && !R.aiSp);
  const ech = regs.filter(R => R.e2), line = regs.filter(R => !R.e2 && thInLine(R)), want = regs.length >= 4 ? Math.round(regs.length * dc.ech) : 0;
  const str = R => thPow(R) / Math.max(1, R.p0 || thPow(R));
  const worn = line.filter(R => str(R) < .45 || thOrg(R) < 30).sort((a, b) => str(a) - str(b))[0];
  const fresh = ech.filter(R => str(R) > .7 && thOrg(R) > 45).sort((a, b) => thPow(b) - thPow(a))[0];
  if (worn && fresh && S.t - (T.passT ?? -99) > 30) {
    thEchSet(fresh, false); thEchSet(worn, true); T.passT = S.t;
    if (typeof chatSay === 'function') chatSay('p', `${fresh.name}超越${worn.name}接替一线，${worn.name}撤下来作第二梯队整补。`, { kind: 'order', at: thAt(worn), lv: 1, key: 'thpass', gap: 20 });
    thStat('thPass');
    return;
  }
  if (S.t - (T.e2T ?? -99) < 20) return;
  if (ech.length > want) { const R = ech.slice().sort((a, b) => str(b) - str(a))[0]; thEchSet(R, false); T.e2T = S.t; }
  else if (ech.length < want && line.length > want) {
    const R = line.slice().sort((a, b) => str(a) - str(b) || thPow(a) - thPow(b))[0];
    if (R) {
      thEchSet(R, true); T.e2T = S.t;
      if (typeof chatSay === 'function' && !T.e2Said) { T.e2Said = 1; chatSay('p', `第一梯队沿登陆场展开，${R.name}作第二梯队在一线后跟进，准备接替和扩张战果。`, { kind: 'plan', at: thAt(R), lv: 0 }); }
      thStat('thEch');
    }
  }
}
// 守方战役预备队（营级）：登陆场出现后按 res 留出机动营（装甲 > 机步 > 步兵）在纵深隐蔽待机；
//   判明敌主攻（已知上陆兵力最集中的一段 12 人以上、见敌 45 秒后）且预备队加当面一线对它的兵力比够 ctr，集中向那里反冲击（炮兵先打 prep 秒）；
//   一线吃紧（当面敌兵力超过一线兵力 commit 倍）就不等，投入加强。反冲击打完（夺回、打不动或 200 秒）各营回到所在师的命令，120 秒后再重新留预备队
function thRsvSet(R, on) {
  R.rsv = on;
  const B = thF(R.par);
  thSend(R, on ? { v: 'reserve', src: 'ai' } : { ...thOrdOf(B || R), src: 'ai' }, TH.dly.reg);
}
function thResE(T, cols, dc) {
  if (!cols.length) return;
  if (T.seen0 == null) T.seen0 = S.t;
  const regs = thDivs('e').flatMap(thRegsOf).filter(R => thG(R) && !R.man);
  const sp = T.rsp;
  if (sp) {   // 预备队反冲击进行中：各营到齐（在攻击出发位置展开就位）或 75 秒到了，同时发起
    const p = sp.key ? S.points.find(o => o.key === sp.key) : null, live = sp.ids.map(thF).filter(R => R && thG(R));
    if (!sp.go && live.length && (live.every(R => { const G = thG(R); return G.st === 'reserve' && dist(G.ax, G.ay, sp.ax, sp.ay) < 160; }) || S.t - sp.t > 75)) {
      sp.go = S.t;
      thStat('thSync');
      if (dc.prep > 0) S.th.e.focus = { x: sp.x, y: sp.y, r: 140, until: S.t + dc.prep + 30 };   // 炮火准备在离开集结地域、向目标开进时打，冲击前后一直压着
      if (typeof chatSay === 'function') chatSay('e', `预备队${live.length > 1 ? ` ${live.length} 个营` : ''}${S.t - sp.t > 75 ? '时限已到' : '已在集结地域会合'}，同时向${p ? p.name : '敌登陆场'}开进反冲击。`, { kind: 'order', at: sp, lv: 1 });
    }
    if (!live.length || (p && hqMine('e', p)) || S.t - sp.t > 240) {
      for (const R of live) { R.aiSp = false; const B = thF(R.par); thSend(R, { ...thOrdOf(B || R), src: 'ai' }); }
      T.rsp = null; T.resT = S.t;
    }
    return;
  }
  const rs = regs.filter(R => R.rsv), want = regs.length >= 3 && dc.res > 0 ? Math.max(1, Math.round(regs.length * dc.res)) : 0;
  if (rs.length < want && S.t - (T.resT ?? -999) > 120) {
    const c = regs.filter(R => !R.rsv && !R.aiSp && thInLine(R)).sort((a, b) => thSpearScore(b) - thSpearScore(a));
    const add = [];
    while (rs.length + add.length < want && c.length > 1) add.push(c.shift());
    for (const R of add) thRsvSet(R, true);
    if (add.length) {
      thStat('thRsv', add.length);
      if (typeof chatSay === 'function') chatSay('e', `${add.map(R => R.name).join('、')}作战役预备队，在纵深隐蔽待机，判明敌主攻方向再集中使用。`, { kind: 'plan', at: thAt(add[0]), lv: 0, key: 'thrsv', gap: 60 });
    }
    return;
  }
  if (!rs.length) return;
  // 敌主攻：沿登陆场每 300 米量一处已知敌兵力（frKnown：守方所知），取最大的一处；当面守军按全部守方兵力算（守备队、碉堡也在顶）
  const win = [];
  let foeAll = 0, ownAll = 0;
  for (let i = 0; i < cols.length; i += 10) {
    const x = frBX(cols[Math.min(cols.length - 1, i + 5)]), fy = thFoeY('e', x);
    if (fy == null) continue;
    const k = frKnown('e', x, fy, 260);
    foeAll += k.foe; ownAll += k.own;
    win.push({ x, y: fy, foe: k.foe });
  }
  if (!win.length) return;
  win.sort((a, b) => b.foe - a.foe);
  const best = win[0], other = win.find(o => Math.abs(o.x - best.x) > 450);
  const rp = rs.reduce((a, R) => a + thPow(R), 0), line = regs.filter(R => !R.rsv && thInLine(R));
  const near = line.filter(R => { const c = thAt(R); return c && dist(c.x, c.y, best.x, best.y) < 450; }).reduce((a, R) => a + thPow(R), 0);
  // 判明主攻：这一段的敌兵力够 det、又比别处（450 以外）多五成；一线吃紧：当面敌兵力超过当面全部守军的 commit 倍
  const main = best.foe >= dc.det && (!other || best.foe >= other.foe * 1.5), r = (rp + near) / Math.max(1, best.foe), crisis = foeAll > Math.max(1, ownAll) * dc.commit;
  if (!(main && r >= dc.ctr) && !crisis) return;
  // 目标：离敌主攻最近的已失守据点，没有就直接打敌登陆场
  const lost = S.points.filter(p => p.owner === 'p' || p.prog > .25).sort((a, b) => dist(a.x, a.y, best.x, best.y) - dist(b.x, b.y, best.x, best.y))[0];
  const tgt = lost && dist(lost.x, lost.y, best.x, best.y) < 500 ? { x: lost.x, y: lost.y, key: lost.key, nm: lost.name } : { x: best.x, y: best.y, key: null, nm: typeof cmdWhere === 'function' ? cmdWhere(best.x, best.y) : gridRef(best.x, best.y) };
  const id = 'R' + Math.round(S.t * 10);
  // 集结地域：目标朝预备队一侧 380（预备队本来就更近就地会合），挑隐蔽处
  const rc = rs.map(thAt).filter(Boolean), cx = rc.reduce((a, o) => a + o.x, 0) / Math.max(1, rc.length), cy = rc.reduce((a, o) => a + o.y, 0) / Math.max(1, rc.length);
  const dd = Math.max(1, dist(tgt.x, tgt.y, cx, cy)), ar = Math.min(380, dd), s0 = hqSlot('e', tgt.x + (cx - tgt.x) / dd * ar, tgt.y + (cy - tgt.y) / dd * ar), asm = hqCover('e', s0.x, s0.y);
  for (const R of rs) { R.rsv = false; R.aiSp = true; thSend(R, { v: 'spear', x: Math.round(tgt.x), y: Math.round(tgt.y), key: tgt.key, src: 'ai', sync: id }, TH.dly.div + TH.dly.reg); }
  T.rsp = { id, ids: rs.map(R => R.id), key: tgt.key, x: Math.round(tgt.x), y: Math.round(tgt.y), ax: Math.round(asm.x), ay: Math.round(asm.y), t: S.t, go: null };
  thStat(crisis && !(main && r >= dc.ctr) ? 'thCommitCrisis' : 'thCommit');
  if (typeof chatSay === 'function') chatSay('e', crisis && !(main && r >= dc.ctr) ? `一线吃紧（当面之敌约 ${Math.round(foeAll)}，我约 ${Math.round(ownAll)}），预备队${rs.map(R => R.name).join('、')}投入，向${tgt.nm}反冲击。` : `判明敌主攻在${tgt.nm}一带（约 ${Math.round(best.foe)} 人），预备队${rs.map(R => R.name).join('、')}集中反冲击，我约 ${r.toFixed(1)} 倍于敌，炮兵先打 ${dc.prep} 秒。`, { kind: 'plan', at: tgt, lv: 0 });
}

// 穿插（AI）：兵力占优、前方空虚的地段，派装甲（机械化）营向战线后方的敌据点突击；同时只派一个，打下来或打不动就收回
function thSpearAi(side, T) {
  const sp = T.sp;
  if (sp) {
    const F = thF(sp.f), G = thG(F), p = S.points.find(o => o.key === sp.key);
    const done = !F || !G || !p || (side === 'p' ? hqMine('p', p) : hqMine('e', p)) || G.st === 'withdraw' || S.t - sp.t > TH.spearT || F.man;
    if (!done) return;
    if (F && !F.man) { F.aiSp = false; const P = thF(F.par); thSend(F, P && P.ord ? thChildOrd(P, F, P.ord) : { v: 'hold', src: 'ai' }); }
    T.sp = null; T.spT = S.t;
    return;
  }
  if (S.t - (T.spT ?? -99) < 60 || (side === 'p' && T.k < 1)) return;
  let best = null, bs = 0;
  for (const D of thDivs(side)) {
    if (D.man || thOrdOf(D).v !== 'advance') continue;
    for (const F of thRegsOf(D)) {
      const G = thG(F);
      if (!G || F.man || F.aiSp || F.rsv || F.e2 || (G.type !== 'armor' && G.type !== 'mech')) continue;
      const P = hqRegPow(G);
      if (P.tot < (F.p0 || 1) * .55) continue;
      for (const p of S.points) {
        if (side === 'p' ? p.owner === 'p' : p.owner !== 'p') continue;
        const d = dist(G.ax, G.ay, p.x, p.y), ahead = (p.y - G.ay) * thDir(side);
        if (d > TH.spear || ahead < 120) continue;
        const foe = frKnown(side, p.x, p.y, 200).foe;
        if (foe > P.tot * .45) continue;
        const s = (p.vp || 1) * (1 - d / TH.spear) * P.tot / (foe + 6);
        if (s > bs) { bs = s; best = { F, p }; }
      }
    }
  }
  if (!best) return;
  const { F, p } = best;
  F.aiSp = true;
  thSend(F, { v: 'spear', x: p.x, y: p.y, key: p.key, src: 'ai' }, TH.dly.div + TH.dly.bde + TH.dly.reg);
  T.sp = { f: F.id, key: p.key, t: S.t };
  if (typeof chatSay === 'function') chatSay(side, `战区：${p.name}一带敌兵力空虚，命${F.name}穿插夺取。`, { kind: 'plan', at: p, lv: 0 });
  thStat('thSpear' + side);
}

// ———————————————— 营的执行 ————————————————
// orbat.js bgStep 每秒调用：沿战线的命令（推进 / 坚守 / 后撤）自己摆；穿插 / 预备队 / 第二梯队交给营长状态机（hq.js regThink）
function thRegThink(G) {
  const F = thF(G.th);
  if (!F) { G.th = null; return regThink(G); }
  const O = thOrdOf(F), v = O.v;
  if (v === 'spear' && O.x != null) {
    const p = O.key ? S.points.find(o => o.key === O.key) : S.points.find(o => dist(o.x, o.y, O.x, O.y) < 90), tx = p ? p.x : O.x, ty = p ? p.y : O.y;
    const d = dist(G.ax, G.ay, tx, ty), a = Math.atan2(ty - G.ay, tx - G.ax), st = p && d > 260 ? 200 : 0;
    const k = `sp:${Math.round(tx)}:${Math.round(ty)}`;
    // 集中反冲击（守方战役预备队）：发起信号之前先到敌火力范围外的集结地域会合（营长按「预备队」执行：到位后隐蔽待命），到齐后同时开进、展开、冲击
    const sp = O.sync && S.th[G.side] && S.th[G.side].rsp && S.th[G.side].rsp.id === O.sync ? S.th[G.side].rsp : null;
    if (sp && !sp.go && sp.ax != null) {
      const ka = `asm:${sp.ax}:${sp.ay}`;
      if (!G.task || G.task.k !== ka) G.task = { k: ka, v: 'reserve', x: sp.ax, y: sp.ay, face: Math.atan2(ty - sp.ay, tx - sp.ax) };
      return regThink(G);
    }
    if (!G.task || G.task.k !== k) G.task = { k, v: 'attack', key: p ? p.key : null, x: Math.round(tx - Math.cos(a) * st), y: Math.round(ty - Math.sin(a) * st), face: a, go: true };
    return regThink(G);
  }
  if (v === 'reserve' || v === 'follow') {
    const D = v === 'follow' ? thF(O.lead) || thF(F.par) : thF(F.par) && thF(thF(F.par).par) || thF(F.par);
    const at = thRearSpot(G.side, D, v === 'follow' ? 200 : 300);
    const k = `${v}:${Math.round(at.x / 60)}:${Math.round(at.y / 60)}`;
    if (!G.task || G.task.k !== k) G.task = { k, v: v === 'follow' ? 'follow' : 'reserve', x: Math.round(at.x), y: Math.round(at.y), face: G.side === 'p' ? NORTH : SOUTH };
    return regThink(G);
  }
  thLine(G, F, v === 'advance' || v === 'retreat' ? v : 'hold', O);
}
// 某支部队战线后方的集结点：攻方在战线与海岸之间（不下海），守方在战线以北；隐蔽处优先
function thRearSpot(side, F, back) {
  const c = (F && thAt(F)) || { x: W / 2, y: side === 'p' ? coastAt(W / 2) - 80 : H / 3 };
  const x = F && F.sec ? (F.sec[0] + F.sec[1]) / 2 : c.x, ly = thLineY(side, x) ?? c.y;
  let y = ly - thDir(side) * back;
  if (side === 'p') y = Math.min(y, coastAt(clamp(x, 0, W - 1)) - 50); else y = Math.max(60, y);
  const s = hqSlot(side, x, y);
  return hqCover(side, s.x, s.y);
}
// 槽位附近 55 米内隐蔽最好的一处（已经在用的隐蔽点离新槽位不远就不换，免得一点点挪）；ok(x, y) 为假的点不选（与友邻挤在一起）
function thCov(x, y, keep, ok) {
  if (keep && passInf(keep[0], keep[1]) && (!ok || ok(keep[0], keep[1])) && coverAt(keep[0], keep[1]) <= coverAt(x, y)) return keep;
  let best = [x, y], bs = -1e9;
  for (let i = 0; i < 12; i++) {
    const a = i * 2.4, r = i ? 10 + i * 4 : 0, sx = clamp(x + Math.cos(a) * r, 20, W - 20), sy = clamp(y + Math.sin(a) * r, 20, H - 20);
    if (!passInf(sx, sy) || (ok && !ok(sx, sy))) continue;
    const sc = (1 - coverAt(sx, sy)) * 2 - r / 30;
    if (sc > bs) { bs = sc; best = [sx, sy]; }
  }
  return best;
}
// 排的横向占地（米），照 units.js formationSlots 的三三制队形：1 组 0 米、3 组 28 米、6 组 74 米、9 组 120 米，每多一个排再加 150 米
function thFoot(n) {
  let lo = 0, hi = 0;
  const pls = Math.ceil(n / 9), tri = [0, -1, 1];
  for (let k = 0; k < n; k++) { const lat = tri[k % 3] * 14 + tri[Math.floor(k / 3) % 3] * 46 + (Math.floor(k / 9) - (pls - 1) / 2) * 150; if (lat < lo) lo = lat; if (lat > hi) hi = lat; }
  return hi - lo;
}
const thFootU = u => thFoot(teamsOf(u).filter(q => q.men.length && !q.ride && !q.rc).length);
// 本方已经定下的槽位：友邻（同一方其他战斗群）上次下达的 + 本营这一轮刚定的。两排前后相距不到 60 米、左右相距不到两排半宽之和加半个空当就算挤；
//   车辆之间不到 TH.vgap 米算挤——挤在一起一发炮弹、一颗炸弹就能端掉好几个排（几辆车）
function thBusy(G) {
  const us = [], vs = [];
  for (const H of S.bgs || []) {
    if (H === G || H.dead || H.side !== G.side) continue;
    for (const u of bgUnits(H)) if (u.bgX != null && u.state !== 'rout') us.push([u.bgX, u.bgY, thFootU(u)]);
    for (const v of bgVehs(H)) { const c = v.cmd && v.cmd.ai === 'bg' ? v.cmd : v; vs.push([c.x, c.y]); }
  }
  return {
    u: (x, y, w) => !us.some(o => Math.abs(o[1] - y) < 60 && Math.abs(o[0] - x) < (o[2] + w) / 2 + TH.gap / 2),
    v: (x, y) => !vs.some(o => Math.abs(o[0] - x) < TH.vgap && Math.abs(o[1] - y) < TH.vgap && Math.hypot(o[0] - x, o[1] - y) < TH.vgap),
    addU: (x, y, w) => { us.push([x, y, w]); }, addV: (x, y) => { vs.push([x, y]); }
  };
}
// 沿战线排开：一线各排按占地分完地段正面（排不下的往后一排排），坦克夹在步兵线后，防空、火炮在后；推进时整线前压一个跃进
function thLine(G, F, v, O) {
  const side = G.side, dir = thDir(side), us0 = bgUnits(G), vs = bgVehs(G);
  if (!us0.length && !vs.length) { G.dead = true; G.done = true; return; }
  const us = us0.filter(u => u.state !== 'rout');
  const cols = F.cols && F.cols.length ? F.cols : null;
  let xs = cols ? cols.map(frBX) : null;
  if (!xs) {   // 还没有分到战线地段（刚上岸、战线还没成形）：按各排现在的横向位置摆，不挤成一团
    xs = [];
    for (const x of us0.map(u => regUnitAt(u)[0]).sort((a, b) => a - b)) if (!xs.length || x - xs[xs.length - 1] > 40) xs.push(x);
    if (!xs.length) xs = [G.ax];
  }
  // 正面太宽、兵力摊不开：只守本地段里靠本营的一段（每人约 7 米、每车 15 米，90–480 米）——登陆场收紧成连贯的几段，不撒成一条细线
  const men = us0.reduce((a, u) => a + teamsOf(u).reduce((b, q) => b + q.men.length, 0), 0), capN = Math.round(clamp(men * 7 + vs.length * 15, 90, 480) / FR_G);
  if (cols && xs.length > capN) {
    const mx = us0.length ? us0.reduce((a, u) => a + regUnitAt(u)[0], 0) / us0.length : G.ax;
    let i0 = 0;
    xs.forEach((x, i) => { if (Math.abs(x - mx) < Math.abs(xs[i0] - mx)) i0 = i; });
    const s0 = clamp(i0 - Math.floor(capN / 2), 0, xs.length - capN);
    xs = xs.slice(s0, s0 + capN);
  }
  const cy = x => { const y = thLineY(side, x); return y != null ? y : side === 'p' ? Math.max(G.ay, coastAt(clamp(x, 0, W - 1)) - 40) : G.ay; };
  // 敌情与兵力比（态势感知 sa.js：当面、刚钻进隐蔽处的、增援趋势、友邻、火力支援一起算）
  const pw = hqRegPow(G), near = hqFoe(side, G.ax, G.ay, 320), L = typeof saLook === 'function' ? saLook(G, pw, near) : null, r = L ? L.odds : pw.tot / Math.max(1, near.n);
  if (near.n) G.nearT = S.t;
  const contact = S.t - (G.nearT ?? -99) < 8, D = G.doc || (typeof DOC_BASE === 'object' ? DOC_BASE : { ret: .5, press: 1 });
  // 顶不住：就地后撤一段（25 秒内不再前压）
  if (near.n >= 3 && r < (D.ret || .5) * .85 && v !== 'retreat') G.thFb = S.t;
  const fb = S.t - (G.thFb ?? -99) < 25;
  const stall = v === 'advance' && contact && r < 1.2 && near.n >= 3;
  // 推不动、或坚守中被优势之敌压着打：叫火力（攻方舰炮 / 对地支援机，守方炮兵）
  if ((stall || (contact && near.n >= 3 && r < 1.5)) && S.t - (G.prepT2 ?? -99) > 40) { G.prepT2 = S.t; regPrep(G, near.x, near.y); }
  // 本营地段两侧各外扩 4 列里最靠后的战线（不甩开友邻）
  let rear = null;
  if (cols) for (let b = cols[0] - 4; b <= cols[cols.length - 1] + 4; b++) { if (b < 0 || b >= FR_NX) continue; const y = thLineY(side, frBX(b)); if (y != null) rear = rear == null ? y : dir < 0 ? Math.max(rear, y) : Math.min(rear, y); }
  const T = S.th[side], pl = side === 'p' && O.src !== 'pl' ? T.k : null;
  // 后撤：接令时的战线往后一个后撤距离，记下来（战线跟着后退，目标不跟着退）
  const RY = v === 'retreat' ? (G.thRY && G.thRY.t === O.t ? G.thRY.m : (G.thRY = { t: O.t, m: {} }).m) : null;
  // 战线是兵力场的边缘，在兵的前面；坚守就守在现在的位置（已经在线后 15–150 米之间的不挪），不一次次往线上凑、越守越往前
  const tgtY = (x, yc, keep = 150) => {
    const y0 = cy(x);
    let y;
    if (fb) y = y0 - dir * 120;
    else if (RY) { const b = frBand(x); y = RY[b] ?? (RY[b] = Math.round(y0 - dir * TH.back)); }
    else if (v === 'advance' && !stall) {
      y = y0 + dir * TH.bound;
      if (rear != null) y = dir < 0 ? Math.max(y, rear - TH.lead) : Math.min(y, rear + TH.lead);
      if (pl != null) y = Math.max(y, thPL(pl, x));
      if (side === 'e') { const f = thFoeY('e', x); if (f != null) y = Math.min(y, f + 20); }
    } else if (yc != null) { const a = (yc - y0) * dir; y = a > -15 ? y0 - dir * 15 : a < -keep ? y0 - dir * keep : yc; }
    else y = y0 - dir * 15;
    if (side === 'p') y = Math.min(y, coastAt(clamp(x, 0, W - 1)) - 30); else y = Math.min(Math.max(50, y), coastAt(clamp(x, 0, W - 1)) - 40);
    return y;
  };
  const snap = (x, y, cls) => { x = clamp(x, 15, W - 15); y = clamp(y, 15, H - 15); if (cls === side ? passInf(x, y) : vehPass(x, y, cls)) return [x, y]; const j = nearestPassable(ci(x, y), cls); return j >= 0 ? [cellCX(j), cellCY(j)] : [x, y]; };
  const out = [], vcls = side === 'e' ? 'vehe' : 'veh';
  // 排：左右顺序黏住（按现在的横向位置排一次，之后编成不变就沿用）
  G.face = dir < 0 ? NORTH : SOUTH;
  const sorted = regLatOrder(G, 'thu', us, u => regUnitAt(u)[0]);
  // 一线按横向顺序取排，各排占（队形宽 + 空当 TH.gap，至少 TH.minW）把地段正面排满为止；排不下的往后一排一排摆（排距 TH.row，最多再排 TH.rows 排）
  //   ——原来一律按每排 60 米摆，六到九个组的排形就有 74–120 米宽，相邻两个排的兵混成一团
  const width = xs.length * FR_G, needW = u => Math.max(TH.minW, thFootU(u) + TH.gap), rows = [[]];
  let used = 0;
  for (const u of sorted) {
    if (rows[rows.length - 1].length && used + needW(u) > width && rows.length <= TH.rows) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(u); used += needW(u);
  }
  const line = rows[0], deep = rows.length > 1;
  // 地段里（含两侧 60）战线前方 260 以内的敌据点：派最近的一线排去夺（推进中；坚守时只夺贴着战线的）
  const x0 = xs[0] - 60, x1 = xs[xs.length - 1] + 60, taken = new Map();
  for (const p of S.points) {
    if (p.x < x0 || p.x > x1 || hqMine(side, p) || (side === 'e' && p.owner !== 'p')) continue;
    const ahead = (p.y - cy(p.x)) * dir;
    if (ahead < -80 || ahead > (v === 'advance' && !fb && !stall ? 260 : 60)) continue;
    if (pl != null && p.y < thPL(pl, p.x) - 40) continue;
    if (side === 'e') {   // 守方就地反冲击：本营在据点 300 以内的兵力对当面已知之敌够 ctr 倍才派，不够就封堵、等预备队（不一个排一个排地往里送）
      const foe = frKnown('e', p.x, p.y, 180).foe;
      let own = 0;
      for (const o of line) { const [ux, uy] = regUnitAt(o); if (dist(ux, uy, p.x, p.y) < 300) own += teamsOf(o).reduce((b, q) => b + q.men.length, 0); }
      for (const vh of vs) if (dist(vh.x, vh.y, p.x, p.y) < 300) own += bgPow(vh);
      if (foe > 0 && own < foe * thDoc('e').ctr) continue;
    }
    const u = line.filter(o => !taken.has(o)).sort((a, b) => Math.abs(regUnitAt(a)[0] - p.x) - Math.abs(regUnitAt(b)[0] - p.x))[0];
    if (u) taken.set(u, p);
    if (u && side === 'e' && !thFocusE()) S.th.e.focus = { x: p.x, y: p.y, r: 120, until: S.t + 20 };   // 就地反冲击也要炮兵先压住据点里的敌人
  }
  // 一排里各排按占地比例分完整段正面，排中心放在各自那一份的中点
  const rowXs = R0 => { const tot = R0.reduce((a, u) => a + needW(u), 0); let acc = 0; return R0.map(u => { const w = needW(u), f = (acc + w / 2) / tot; acc += w; return xs[Math.min(xs.length - 1, Math.floor(f * xs.length))]; }); };
  const dig = !(v === 'advance' && !stall) && !fb && !RY;   // 坚守：槽位附近找隐蔽处
  // 槽位按先后（夺据点的排 → 一线 → 后几排）逐个定下，和本方已定的槽位错开：挤了先往左右挪一个排宽、再往后挪一排，都不行才留在原处
  const busy = thBusy(G);
  const place = (u, bx, by, keep, t) => {
    const w = thFootU(u), ok = (x, y) => busy.u(x, y, w), st = Math.max(TH.minW, w + TH.gap);
    let best = null;
    for (const [l, r] of [[0, 0], [1, 0], [-1, 0], [0, 1], [2, 0], [-2, 0], [1, 1], [-1, 1], [0, 2]]) {
      let [sx, sy] = snap(bx + l * st, by - dir * r * TH.row, side);
      if (dig && !t) [sx, sy] = thCov(sx, sy, !l && !r ? keep : null, ok);
      if (!best) best = [sx, sy];
      if (ok(sx, sy)) { best = [sx, sy]; break; }
    }
    busy.addU(best[0], best[1], w);
    out.push({ m: u, k: 'u', x: best[0], y: best[1], ...(t ? { t } : {}) });
  };
  for (const u of line) { const p = taken.get(u); if (p) place(u, p.x, p.y, null, 'amove'); }
  const lineXs = rowXs(line);
  line.forEach((u, i) => {
    if (taken.has(u)) return;
    const x = lineXs[i], [sx, sy] = snap(x, tgtY(x, dig ? regUnitAt(u)[1] : null, deep ? 70 : 150), side);
    place(u, sx, sy, u.bgX != null && dist(u.bgX, u.bgY, sx, sy) < 60 ? [u.bgX, u.bgY] : null);
  });
  rows.slice(1).forEach((R0, r) => { const X = rowXs(R0); R0.forEach((u, i) => place(u, X[i], tgtY(X[i]) - dir * (110 + r * TH.row), null)); });
  // 车辆：坦克、步战车在步兵线后（推进时贴上来），反坦克 / 侦察车护两翼，防空在后 120，自行火炮在后 240
  const tk = vs.filter(hqTank), ifv = vs.filter(o => o.type === 'apc' || o.type === 'abv'), aa = vs.filter(hqAA), art = vs.filter(o => o.type === 'spg');
  const oth = vs.filter(o => !tk.includes(o) && !ifv.includes(o) && !aa.includes(o) && !art.includes(o));
  // 车辆槽位同样和本方已定的车辆错开（左右挪 TH.vgap、再往后挪）
  const placeV = (o, bx, by) => {
    let best = null;
    for (const [l, r] of [[0, 0], [1, 0], [-1, 0], [0, 1], [2, 0], [-2, 0], [1, 1], [-1, 1], [0, 2], [3, 0], [-3, 0]]) {
      const [sx, sy] = snap(bx + l * TH.vgap, by - dir * r * TH.vgap, vcls);
      if (!best) best = [sx, sy];
      if (busy.v(sx, sy)) { best = [sx, sy]; break; }
    }
    busy.addV(best[0], best[1]);
    out.push({ m: o, k: 'v', x: best[0], y: best[1] });
  };
  const spread = (list, back, key) => { const L2 = regLatOrder(G, key, list, o => o.x); L2.forEach((o, i) => { const x = xs[Math.min(xs.length - 1, Math.floor((i + .5) * xs.length / L2.length))]; placeV(o, x + (i % 2 ? 12 : -12), tgtY(x) - dir * back); }); };
  spread(tk, v === 'advance' && !stall ? 18 : 40, 'tht');
  spread(ifv, 55, 'thi');
  const xm = xs[Math.floor(xs.length / 2)];
  oth.forEach((o, i) => { const x = i % 2 ? xs[xs.length - 1] + 30 : xs[0] - 30; placeV(o, x, tgtY(clamp(x, xs[0], xs[xs.length - 1])) - dir * 40); });
  aa.forEach((o, i) => placeV(o, xm + (i - (aa.length - 1) / 2) * 40, tgtY(xm) - dir * 120));
  art.forEach((o, i) => placeV(o, xm + (i - (art.length - 1) / 2) * 35, tgtY(xm) - dir * 240));
  // 锚点 = 一线的中心（画营标、态势感知用）；车辆按锚点移动的速度跟进
  const lo = out.filter(s => s.k === 'u' && line.includes(s.m));
  const ax0 = G.ax, ay0 = G.ay;
  if (lo.length) { G.ax = lo.reduce((a, s) => a + s.x, 0) / lo.length; G.ay = lo.reduce((a, s) => a + s.y, 0) / lo.length; }
  else if (out.length) { G.ax = out.reduce((a, s) => a + s.x, 0) / out.length; G.ay = out.reduce((a, s) => a + s.y, 0) / out.length; }
  G.vel = Math.min(30, dist(ax0, ay0, G.ax, G.ay));
  const st = fb || v === 'retreat' ? 'withdraw' : v === 'advance' ? (stall ? 'hold' : contact ? 'assault' : 'move') : 'hold';
  if (G.st !== st) { G.st = st; G.stT = S.t; }
  G.thMode = fb ? 'fb' : stall ? 'stall' : v;
  regOrder(G, out, v === 'retreat' || fb ? 'move' : v === 'advance' && !stall ? 'amove' : 'hold');
}

// ———————————————— 主循环 ————————————————
function thInit() {
  S.th = { on: true, nid: 1, f: {}, p: { n: {}, k: 0, kT: 0, sp: null }, e: { n: {}, sp: null } };
  for (const side of ['p', 'e']) S.th[side].id = thNew(side, 'thr', null, side === 'p' ? '登陆战区司令部' : '守军战区司令部', { ech: 'XXX' }).id;
  S.v7off = { ...(S.v7off || {}), hq: true, br: true, tf: true };   // 旧的司令 / 团长、零散调兵、攻方协同让位
  if (typeof chatSay === 'function') {
    chatSay('p', '战区司令部：各部上陆后按地段编成师、团、营，沿登陆场展开战线，按阶段线全线推进；据点随战线推进逐一夺取。', { kind: 'plan', lv: 0 });
    chatSay('e', '战区司令部：守备部队依托工事坚守，机动兵力编成师、团隐蔽待机；判明登陆场后沿当面封锁，占优地段向海反击。', { kind: 'plan', lv: 0 });
  }
}
function thStep(dt) {
  if (!S || S.phase !== 'battle' || S.over) return;
  if (!S.th) { if (S.v7off && S.v7off.th) return; thInit(); }
  if (!S.th.on) return;
  const T = S.th;
  thDeliver();
  if ((T.orgT = (T.orgT ?? 1) - dt) <= 0) {
    T.orgT = TH.org;
    thTry('orgP', thOrgP);
    if (S.t > 2) thTry('orgE', thOrgE);
    thTry('ext', thExt);
    thTry('prune', thPrune);
    thTry('alloc', () => { thAlloc('p'); thAlloc('e'); });
  }
  if ((T.thT = (T.thT ?? 3) - dt) <= 0) {
    T.thT = TH.think;
    thTry('thinkP', () => thThinkP(T.p));
    thTry('thinkE', () => thThinkE(T.e));
  }
}
HOOK.newGame.push(() => { if (S) { S.th = null; S.v7off = { ...(S.v7off || {}), hq: true, br: true, tf: true }; } });
HOOK.step.push(thStep);
// 隶属（型号卡「隶属」一栏）：排、车的师 · 团 · 营
function thAffil(o) {
  if (!S || !S.th) return null;
  const G = o.bgG != null ? (S.bgs || []).find(g => g.id === o.bgG) : (S.bgs || []).find(g => !g.dead && g.th && g.us.includes(o.id));
  const R = G && thF(G.th);
  if (!R) return null;
  const B = thF(R.par), D = B && thF(B.par);
  return [D && D.name, B && B.name, R.name].filter(Boolean).join(' · ');
}
