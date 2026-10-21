'use strict';
// AI 指挥官（攻防双方）：判断—决心—理由—命令—报告。命令经通信传递有延迟；执行中有摩擦（偏航、通信受阻、情报误判、
// 后续梯队迟滞、火力误伤与假目标、停滞不前），指挥官发现后实施补救，补救在推演中真实执行
// 存档数据（纯 JSON）：S.chat 通联记录 · S.chatK 节流 · S.cmd = { v, q 待执行动作, p 我方指挥官, e 敌方指挥官 }
// 我方：PvE 只指挥 auto 资产（连队、舰船、车辆；驱逐舰 / 航母须开自动）；观战（S.role === 'spectate'）指挥全部
// 敌方：包装 ai.js / ai2.js / ai3.js：判明主攻方向（可能误判佯攻）、控制预备队投入、反冲击协同，叙述炸桥 / 袭扰 / 装甲车 / 炮兵
const CMD_KINDS = ['plan', 'order', 'intel', 'friction', 'remedy', 'report'];
const CMD_FP = { drift: .2, late: .4, halt: .16, dc: .14, decoy: .22, jam: .07 };   // 我方摩擦基础概率（有无线电中继 S.relay 时减半）
// 敌方决策质量：mis 误判佯攻为主攻 · late 预备队迟出 · piece 逐次反击；fix / fixT 纠正误判所需的兵力比与持续秒数
const CMD_FE = {
  normal: { mis: .65, late: .5, piece: .5, fix: 1.9, fixT: 33, lateT: 45 },
  hard: { mis: .45, late: .35, piece: .35, fix: 1.6, fixT: 21, lateT: 35 },
  hell: { mis: .12, late: .12, piece: .12, fix: 1.3, fixT: 9, lateT: 24 }
};
const CMD_UNIT = { coastal: '门', bunker: '座', arty: '门', mortar: '门', aa: '门', mine: '处' };
const CMD_RAID = { node: '前沿补给点', edge: '运输线', depot: '滩头补给站', seg: '浮桥补给线', team: '孤立小组' };
const CMD_ERR = {};   // 非存档：各子系统出错只报一次
let CMD_STRICT = false;   // 测试时置 true：出错直接抛出

// ———————————————— 通联记录 ————————————————
// side：'p' 我方指挥官 / 'e' 敌方指挥官 / 'sys' 系统；opts = {kind, at:{x,y}, delay 秒, key, gap 节流秒, lv 0 必显 / 1 普通 / 2 详细}
function chatSay(side, text, opts) {
  if (!S || !text) return null;
  opts = opts || {};
  if (!Array.isArray(S.chat)) S.chat = [];
  if (opts.key) {
    const th = S.chatK && typeof S.chatK === 'object' ? S.chatK : (S.chatK = {});
    if (th[opts.key] != null && S.t - th[opts.key] < (opts.gap ?? 20)) return null;
    th[opts.key] = S.t;
  }
  const kind = CMD_KINDS.includes(opts.kind) ? opts.kind : 'report', at = opts.at && isFinite(opts.at.x) && isFinite(opts.at.y) ? opts.at : null;
  const t = S.t + Math.max(0, +opts.delay || 0);
  const m = { id: S.nid++, t, side: side === 'e' || side === 'sys' ? side : 'p', kind, text: String(text), x: at ? Math.round(at.x) : null, y: at ? Math.round(at.y) : null,
    lv: opts.lv ?? (kind === 'plan' || kind === 'friction' || kind === 'remedy' ? 0 : 1) };
  // PvE 里敌方通话只能截获：约四成，滞后 15–30 秒（面板据此显示；观战时实时显示）
  if (m.side === 'e') m.ic = Math.random() < (m.lv === 0 ? .45 : m.lv === 1 ? .38 : .3) ? +(t + 15 + Math.random() * 15).toFixed(2) : null;
  S.chat.push(m);
  if (S.chat.length > 400) { const k = S.chat.findIndex(m => m.kind !== 'plan'); if (k >= 0) S.chat.splice(k, 1); }   // 上限 400，先丢最早的非决心消息
  return m;
}

// ———————————————— 状态与通用工具 ————————————————
const cmdNewP = () => ({ plan: null, ship: {}, ph: 'land', thinkT: .4, noise: {}, est0: {}, stall: {}, halt: {}, haltT: -99, fm: [], air: [], cf: 0, safe: 60, safeT: 0, airSafe: 90,
  airSafeT: 0, navFix: -99, driftN: 0, alias: {}, rc: 0, mission: {}, decoy: [], dcT: -99, known: {}, bridge: {}, raids: {}, cars: {}, sitT: 150, own: {}, axis: [], focus: null,
  smokeDue: false, w2: null, sunk: {}, ddSunk: false, lostT: {}, init: false });
const cmdNewE = () => ({ thinkT: 1.6, init: false, seenT: null, guess: null, gT: 0, wrong: false, commit: null, hold: {}, home: {}, rel: {}, bias: {}, ca: {}, mass: null, fixC: 0,
  nb: 0, roll: {}, raids: {}, cars: {}, artT: 40, art: {}, waves: 0, own: {}, amb: {}, last: false, fails: 0 });
function cmdInit() {
  if (!S) return null;
  if (S.cmd && S.cmd.v === 1 && S.cmd.p && S.cmd.e) return S.cmd;
  S.cmd = { v: 1, q: [], p: cmdNewP(), e: cmdNewE() };
  return S.cmd;
}
const cmdAll = () => !!S && S.role === 'spectate';
const cmdCtl = o => !!o && (cmdAll() || o.auto === true);
const cmdOn = () => !!S && S.phase === 'battle' && !S.over && !!S.cmd;
const cmdRK = () => S && S.relay ? .5 : 1;
const cmdPt = k => (k != null && S.points.find(p => p.key === k)) || null;
const cmdBN = i => (TER.beaches[i] && TER.beaches[i].name) || '滩头';
const cmdExit = i => {
  const b = TER.beaches[i];
  if (!b) return null;
  return cmdPt('E' + (i + 1)) || { key: null, name: b.name + '出口', x: b.cx, y: coastAt(b.cx) - 50, owner: 'e', prog: 0, vp: 1 };
};
const cmdMen = ts => ts.reduce((a, q) => a + q.men.length, 0);
const cmdHT = () => `H+${Math.floor(S.t / 60)}分`;
const cmdLoaded = s => !!s.load && (s.load.teams > 0 || s.load.eng > 0 || (Array.isArray(s.load.veh) && s.load.veh.length > 0));
const cmdAssault = s => s.kind !== 'supply' && s.kind !== 'lst' && !!s.load && s.load.teams > 0;
const cmdEName = e => e.name || (ENEMY_SPEC[e.kind] && ENEMY_SPEC[e.kind].name) || '火力点';
const cmdPInf = () => S.teams.filter(q => q.side === 'p' && q.kind === 'inf' && q.men.length);
function cmdRun(f, ...a) {
  try { return f(...a); } catch (e) {
    if (CMD_STRICT) throw e;
    if (!CMD_ERR[f.name]) { CMD_ERR[f.name] = 1; console.error('commander: ' + f.name, e); }
  }
}
// 某点落在哪个滩头（pad 以内算）
function cmdBeachOf(x, pad = 60) {
  let bi = -1, bd = Infinity;
  TER.beaches.forEach((b, i) => { const d = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0; if (d < bd) { bd = d; bi = i; } });
  return bd <= pad ? bi : -1;
}
// 方位词（屏幕坐标，北为 -y）
function cmdDir(dx, dy) { const a = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360; return ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(a / 45) % 8]; }
// 地名：最近的据点（150 内）或滩头，否则方格坐标
function cmdWhere(x, y) {
  let best = null, bd = 150;
  for (const p of S.points) { const d = dist(p.x, p.y, x, y); if (d < bd) { bd = d; best = p; } }
  if (best) return best.name;
  const bi = coastAt(x) - y < 140 ? cmdBeachOf(x, 80) : -1;
  return bi >= 0 ? cmdBN(bi) : `${gridRef(x, y)} 方格`;
}
// 舰名列表压缩：LA-1、LA-2、LA-3 → LA-1至LA-3
function cmdLabels(list) {
  const L = list.map(s => typeof s === 'string' ? s : s.label).filter(Boolean), out = [];
  const m = L.map(l => /^(.*?)(\d+)$/.exec(l));
  for (let i = 0; i < L.length;) {
    let j = i;
    while (m[i] && m[j + 1] && m[j + 1][1] === m[i][1] && +m[j + 1][2] === +m[j][2] + 1) j++;
    out.push(j - i >= 2 ? `${L[i]}至${L[j]}` : L.slice(i, j + 1).join('、'));
    i = j + 1;
  }
  return out.join('、');
}
function cmdUName(u) {
  if (!u) return '某部';
  if (u.side !== 'p') return '敌军';
  if (u.kind === 'eng') return `${u.ship || ''}工兵组`;
  if (u.ship && Array.isArray(S.veh) && S.veh.some(v => v.label === u.ship)) return `${u.ship}车组`;
  if (u.ship && u.ship !== '增援') return `${u.ship}连`;
  const C = S.cmd.p;
  if (!C.alias[u.id]) C.alias[u.id] = ++C.rc;
  return `增援${C.alias[u.id]}连`;
}
function cmdKnText(kn) {
  const N = { coastal: '岸防重炮', bunker: '机枪碉堡', arty: '榴弹炮', mortar: '迫击炮', aa: '防空炮', mine: '雷区' };
  return Object.keys(N).filter(k => kn[k]).map(k => `${N[k]} ${kn[k]} ${CMD_UNIT[k]}`).join('、');
}
// 待执行动作（命令传递、延时补救）：动作名 + 纯数据参数
function cmdLater(d, act, a) { S.cmd.q.push({ due: +(S.t + d).toFixed(2), act, a: a || {} }); }

// ———————————————— 主循环（HOOK.step） ————————————————
function updateCommander(dt) {
  if (!S || S.phase !== 'battle' || S.over || !TER || !S.points) return;
  const Cm = cmdInit(), C = Cm.p, E = Cm.e;
  cmdRun(cmdQueue);
  if ((C.thinkT -= dt) <= 0) { C.thinkT = 2.5; cmdRun(cmdThinkP); }
  if ((E.thinkT -= dt) <= 0) { E.thinkT = 3; cmdRun(cmdThinkE); }
}
function cmdQueue() {
  const Q = S.cmd.q;
  for (let i = 0; i < Q.length; i++) {
    const it = Q[i];
    if (it.due > S.t) continue;
    Q.splice(i--, 1);
    const f = CMD_ACT[it.act];
    if (f) cmdRun(f, it.a || {}, it);
  }
}

// ———————————————— 我方指挥官 ————————————————
// 是否有可指挥的资产（PvE 全部手动时指挥官沉默）
function cmdHasP() {
  if (cmdAll()) return true;
  return S.ships.some(s => alive(s) && s.auto === true) || S.units.some(u => u.side === 'p' && u.auto === true) || S.dd.auto === true || (S.cv && S.cv.auto === true) ||
    (Array.isArray(S.veh) && S.veh.some(v => v.side === 'p' && !v.dead && v.auto === true));
}
function cmdThinkP() {
  const C = S.cmd.p;
  if (!cmdHasP()) return;
  if (cmdAll()) cmdForceAuto();
  if (!C.plan) cmdPlanP();
  if (C.plan && C.plan.main < 0) cmdAdoptP(C);
  if (!C.plan || C.plan.main < 0) return;
  const P = typeof apEnsure === 'function' ? apEnsure() : null;
  cmdRun(cmdIntelP, C);
  cmdRun(cmdShipsP, C);
  cmdRun(cmdWaves, C);
  cmdRun(cmdFiresP, C);
  if (P) {
    cmdRun(cmdPhaseP, C, P);
    cmdRun(cmdPointsP, C, P);
    cmdRun(cmdStalls, C, P);
    cmdRun(cmdHalts, C, P);
    cmdRun(cmdEst0, C, P);
    cmdRun(cmdCrisisP, C, P);
    cmdRun(cmdAmmoP, C, P);
  }
  cmdRun(cmdDecoys, C);
  cmdRun(cmdThreatsP, C);
  cmdRun(cmdVeh, C);
  cmdRun(cmdSitrep, C);
}
// 观战：指挥官接管全部资产
function cmdForceAuto() {
  for (const u of S.units) if (u.side === 'p') u.auto = true;
  for (const s of S.ships) s.auto = true;
  if (S.dd) S.dd.auto = true;
  if (S.cv) S.cv.auto = true;
  if (Array.isArray(S.veh)) for (const v of S.veh) if (v.side === 'p') v.auto = true;
}

// —— 滩头评估：只用开战时可知的情报（地形、据点位置、已标定的火力点）——
function cmdBeachInfo(i, ships) {
  const b = TER.beaches[i], E = cmdExit(i), hq = cmdPt('HQ');
  const w = Math.round(b.x1 - b.x0), dHQ = hq ? Math.round(dist(E.x, E.y, hq.x, hq.y)) : 900;
  let road = 0;
  eachCellIn(E.x, E.y - 90, 130, k => { const t = TER.type[k]; if (t === T.ROAD || t === T.BRIDGE) road++; });
  const bats = S.points.filter(p => (p.key === 'BT' || p.key === 'BT2') && p.owner !== 'p' && dist(p.x, p.y, E.x, E.y) < 650);
  let def = 0;
  const kn = {};
  for (const e of S.enemies) if (!e.dead && e.kx != null) {
    const d = dist(e.kx, e.ky, E.x, E.y), r = { coastal: 650, bunker: 260, mortar: 420, arty: 900 }[e.kind] || 0;
    if (d < r) { def += { coastal: 4, bunker: 3, mortar: 1.2, arty: .6 }[e.kind]; kn[e.kind] = (kn[e.kind] || 0) + 1; }
  }
  for (const m of S.mines) if (m.known && m.clr < 1 && m.x > b.x0 - 30 && m.x < b.x1 + 30 && Math.abs(m.y - coastAt(m.x)) < 80) { def += 1; kn.mine = (kn.mine || 0) + 1; }
  const fd = ships.length ? ships.reduce((a, s) => a + dist(s.x, s.y, b.cx, coastAt(b.cx)), 0) / ships.length : 500;
  let town = null, td = Infinity;
  for (const k of ['T1', 'T2']) { const p = cmdPt(k); if (p) { const d = dist(p.x, p.y, E.x, E.y); if (d < td) { td = d; town = p; } } }
  const score = w / 35 - dHQ / 260 + Math.min(road, 18) / 9 - def * 1.3 - bats.length * 1.6 - fd / 800;
  return { i, b, E, w, dHQ, road, bats, def, kn, fd, town, td, score };
}

// —— 作战计划（H 时）：主攻 / 佯攻、梯队编组、火力准备、侦察 ——
function cmdPlanP() {
  const C = S.cmd.p;
  if (C.plan) return C.plan;
  const ctl = S.ships.filter(s => alive(s) && cmdCtl(s) && cmdLoaded(s)), as = ctl.filter(cmdAssault);
  if (!TER.beaches.length || !as.length) { C.plan = { main: -1, feint: -1, t: S.t, mode: 'none' }; return C.plan; }   // 突击舰都由玩家亲自指挥：待部队上陆后再接手（cmdAdoptP）
  const B = TER.beaches.map((b, i) => cmdBeachInfo(i, as));
  const pre = as.filter(s => s.state === 'move' && s.land);
  let main, feint = -1, mode;
  if (pre.length && pre.length >= as.length * .5) {   // 已有登陆计划（玩家或沙盒部署时预定）：据此确定主要方向
    mode = 'pre';
    const cnt = B.map(() => 0);
    for (const s of pre) { const bi = cmdBeachOf(s.bx); if (bi >= 0) cnt[bi]++; }
    main = cnt.indexOf(Math.max(...cnt));
    const m2 = Math.max(...cnt.map((n, i) => i === main ? -1 : n));
    if (m2 > 0) feint = cnt.findIndex((n, i) => i !== main && n === m2);
  } else {
    mode = 'self';
    main = B.reduce((a, x) => x.score > a.score ? x : a).i;
    const M = B[main];
    let bf = -Infinity;
    for (const x of B) {
      if (x.i === main) continue;
      const dx = Math.abs(x.b.cx - M.b.cx);
      const sc = -x.def * 1.2 - x.bats.length + Math.min(dx, 1200) / 500 - (dx < 420 ? 3 : 0) + (x.town && M.town && x.town.key !== M.town.key ? 1.2 : 0) - x.fd / 900;
      if (sc > bf) { bf = sc; feint = x.i; }
    }
  }
  C.plan = { main, feint, t: S.t, mode };
  const R = { w1: [], fe: [], w2: [], sup: [], lst: [] }, prep = cmdCtl(S.dd) && S.dd.state !== 'sunk', go = +(S.t + (prep && mode === 'self' ? 8 : 0)).toFixed(2);
  for (const s of ctl) {
    let r = null;
    if (s.kind === 'supply') r = 'sup';
    else if (!cmdAssault(s)) r = 'lst';
    else if (mode === 'pre') r = s.state === 'move' ? (feint >= 0 && cmdBeachOf(s.bx) === feint ? 'fe' : 'w1') : 'w2';
    if (!r) continue;
    const moving = s.state === 'move';
    C.ship[s.id] = { r, b: moving && s.land ? Math.max(0, cmdBeachOf(s.bx, 200)) : r === 'fe' ? feint : main, k: 0, n: 1, rel: moving, sent: moving, go: null };
    R[r].push(s);
  }
  if (mode === 'self') {
    const idle = as.filter(s => !C.ship[s.id] && s.state === 'idle'), n = idle.length;
    const nf = feint < 0 ? 0 : n >= 7 ? 2 : n >= 4 ? 1 : 0, n2 = n >= 8 ? 2 : n >= 6 ? 1 : 0;
    const fb = feint >= 0 ? TER.beaches[feint] : null, mb = TER.beaches[main], dm = s => dist(s.x, s.y, mb.cx, coastAt(mb.cx));
    if (fb) idle.sort((a, b) => dist(a.x, a.y, fb.cx, coastAt(fb.cx)) - dist(b.x, b.y, fb.cx, coastAt(fb.cx)));
    const fe = idle.splice(0, nf);
    idle.sort((a, b) => dm(b) - dm(a));
    const w2 = idle.splice(0, n2), w1 = idle.sort((a, b) => a.x - b.x);
    const put = (list, r, b) => list.sort((a, c) => a.x - c.x).forEach((s, k) => { C.ship[s.id] = { r, b, k, n: list.length, rel: r !== 'w2', sent: false, go: r === 'w2' ? null : go }; R[r].push(s); });
    put(w1, 'w1', main); put(fe, 'fe', feint); put(w2, 'w2', main);
  }
  cmdSayPlan(B, R, mode, prep);
  if (prep) cmdPrepFires(main);
  if (S.cv && cmdCtl(S.cv) && S.cv.hp > 0) {
    const M = cmdExit(main), F = feint >= 0 ? cmdExit(feint) : null;
    C.air.push({ k: 'recon', x: M.x, y: M.y - 60, t: S.t });
    if (F) C.air.push({ k: 'recon', x: F.x, y: F.y - 60, t: S.t });
  }
  return C.plan;
}

// 登陆由玩家亲自指挥时：以上陆兵力最多的滩头为主要方向，接手自动连队的纵深发展
function cmdAdoptP(C) {
  if (!TER.beaches.length || S.t - C.plan.t < 15 || !S.units.some(u => u.side === 'p' && u.kind === 'inf' && cmdCtl(u) && teamsOf(u).length)) return;
  C.plan.t = S.t;
  const men = TER.beaches.map((b, i) => cmdAshore(i)), mx = Math.max(...men);
  if (mx < 15) return;
  const main = men.indexOf(mx), E = cmdExit(main);
  C.plan = { main, feint: -1, t: S.t, mode: 'adopt' };
  C.ph = cmdOwned(E) ? 'brk' : 'beach';
  if (C.ph === 'brk') C.axis = cmdAxis(E);
  const nxt = C.ph === 'brk' && C.axis[0] ? cmdPt(C.axis[0]) : null;
  chatSay('p', `判断：登陆按指挥员部署实施，主力已在${cmdBN(main)}上陆约 ${mx} 人${cmdOwned(E) ? `，${E.name}已在我手` : ''}。决心：各自动连队以${cmdBN(main)}为主要方向，${nxt ? `向${nxt.name}发展` : `先夺取${E.name}`}。`, { kind: 'plan', at: E });
}

function cmdSayPlan(B, R, mode, prep) {
  const { main, feint } = S.cmd.p.plan, M = B[main], F = feint >= 0 ? B[feint] : null;
  const wMax = Math.max(...B.map(x => x.w)), dMin = Math.min(...B.map(x => x.dHQ)), fMin = Math.min(...B.map(x => x.fd));
  const why = [];
  if (M.w === wMax) why.push(`正面最宽（${M.w} 米）`); else if (M.w >= 180) why.push(`正面较宽（${M.w} 米）`);
  if (M.dHQ === dMin) why.push(`出口距指挥所最近（${M.dHQ} 米）`); else why.push(`出口距指挥所 ${M.dHQ} 米`);
  if (M.road >= 6) why.push('出口有公路直通纵深');
  if (!M.bats.length && B.some(x => x.bats.length)) why.push('不在岸防炮台射界内');
  if (M.def === 0 && B.some(x => x.def > 0)) why.push('尚未发现火力点');
  else if (M.def > 0) why.push(`已知${cmdKnText(M.kn)}`);
  if (M.fd === fMin && why.length < 4) why.push('距集结区最近');
  const susp = B.filter(x => x.bats.length && x.i !== main).map(x => x.b.name);
  const at = { x: M.E.x, y: M.E.y }, P = { kind: 'plan' };
  const told = S.chat.some(m => m.side === 'p' && m.kind === 'plan');   // 部署时（沙盒「AI 帮我部署」）已讲明作战意图：只下达执行命令
  if (told) { /* 不重复判断与决心 */ } else if (mode === 'pre') {
    const n1 = R.w1.filter(s => S.cmd.p.ship[s.id].b === main).length;
    chatSay('p', `判断：按既定登陆计划，${n1} 艘登陆舰指向${M.b.name}${F ? `，${R.fe.length} 艘指向${F.b.name}` : ''}。守军火力配系不明，${M.b.name}出口距指挥所 ${M.dHQ} 米。`, { ...P, at });
    chatSay('p', `决心：以${M.b.name}为主要突击方向${F ? `，${F.b.name}为助攻，牵制${F.town ? F.town.name : '当面'}之敌` : ''}。`, { ...P, at, delay: 1.2 });
  } else {
    chatSay('p', `判断：守军沿岸纵深设防，滩头火力配系不明。可选登陆滩 ${B.length} 处，${M.b.name}正面宽 ${M.w} 米、出口距指挥所 ${M.dHQ} 米${M.road >= 6 ? '，背后有公路纵深' : ''}。${susp.length ? `${susp.slice(0, 2).join('、')}两侧岬角有岸防炮台，抵近时须防侧射。` : ''}`, { ...P, at });
    chatSay('p', `决心：主攻${M.b.name}${F ? `，佯攻${F.b.name}` : ''}。`, { ...P, at, delay: 1.2 });
    chatSay('p', `理由：${M.b.name}${why.slice(0, 3).join('、')}${F ? `；${F.b.name}距主攻方向 ${Math.round(Math.abs(F.b.cx - M.b.cx))} 米，佯攻可牵制${F.town ? F.town.name + '方向的' : '当面'}预备队` : ''}。`, { ...P, at, delay: 2.4 });
  }
  const parts = [];
  if (R.w1.length) parts.push(`${cmdLabels(R.w1)}为第一波${mode === 'pre' ? '' : `直取${M.b.name}`}`);
  if (R.fe.length && F) parts.push(`${cmdLabels(R.fe)}佯攻${F.b.name}`);
  if (R.w2.length) parts.push(`${cmdLabels(R.w2)}为第二波，待${M.E.name}夺取后跟进`);
  if (R.sup.length) parts.push(`补给舰${cmdLabels(R.sup)}待第一波上滩后建立补给站`);
  if (R.lst.length) parts.push(`坦克登陆舰${cmdLabels(R.lst)}待出口打开后卸载装甲`);
  if (parts.length) chatSay('p', `命令：${told ? 'H 时已到，按既定部署执行。' : ''}${parts.join('；')}。`, { kind: 'order', at, delay: told ? .5 : 3.6, lv: 0 });
  if (prep) chatSay('p', `命令：驱逐舰对${M.b.name}出口及两翼可疑火力点实施火力准备，第一波 H+8 秒出发，抵近时施放烟幕。`, { kind: 'order', at, delay: 4.8 });
  if (S.cv && cmdCtl(S.cv) && S.cv.hp > 0) chatSay('p', `命令：航母派侦察机先行侦察${M.b.name}${F ? '、' + F.b.name : ''}，攻击机待命打击已标定火炮。`, { kind: 'order', at, delay: 6 });
  const veh = (Array.isArray(S.veh) ? S.veh : []).filter(v => v.side === 'p' && !v.dead && cmdCtl(v));
  if (veh.length) chatSay('p', `命令：${veh.length} 辆装甲车辆随第一波在${M.b.name}上陆，伴随步兵攻击，不得脱离步兵单独突入。`, { kind: 'order', at, delay: 7.2 });
}

// 火力准备：已知目标逐一急促射；没有已知目标时对出口与两翼可疑位置概略射击
function cmdPrepFires(main) {
  const C = S.cmd.p, b = TER.beaches[main], M = cmdExit(main);
  const sp = cmdDDSpot(M.x, M.y);
  if (sp && (dist(S.dd.x, S.dd.y, M.x, M.y) > 900 || cmdGuns().some(g => dist(g.x, g.y, S.dd.x, S.dd.y) < 650))) orderDD(sp.x, sp.y);
  const known = S.enemies.filter(e => !e.dead && e.kx != null && dist(e.kx, e.ky, M.x, M.y) < 420).sort((a, c) => (c.kind === 'coastal') - (a.kind === 'coastal'));
  // 每次齐射都可能暴露舰位、招来反炮兵射击：火力准备只打要害，不搞长时间炮击
  if (known.length) for (const e of known.slice(0, 2)) C.fm.push({ x: e.kx, y: e.ky, n: e.kind === 'coastal' ? 2 : 1, t: S.t, why: 'prep' });
  else {
    C.fm.push({ x: M.x, y: M.y, n: 1, t: S.t, why: 'prep' });
    C.fm.push({ x: b.x0 + 20, y: coastAt(b.x0 + 20) - 45, n: 1, t: S.t, why: 'prep' }, { x: b.x1 - 20, y: coastAt(b.x1 - 20) - 45, n: 1, t: S.t, why: 'prep' });
  }
  C.smokeDue = true;
}

// —— 舰船梯队（autopilot.js apShips 调用）：返回 null 不干预 / {hold} 待命 / {b, x} 指定滩头与落点（可能已含偏航）——
function cmdShipTask(s) {
  if (!S || S.phase !== 'battle' || S.over || !TER) return null;
  const Cm = cmdInit();
  if (!Cm || !cmdCtl(s)) return null;
  const C = Cm.p;
  if (!C.plan) cmdRun(cmdPlanP);
  if (!C.plan || C.plan.main < 0) return null;
  let t = C.ship[s.id];
  if (!t) {   // 计划之后加入的舰船：编入第二梯队
    const r = s.kind === 'supply' ? 'sup' : cmdAssault(s) ? 'w2' : 'lst', w2 = C.w2;
    t = C.ship[s.id] = { r, b: w2 ? w2.b : C.plan.main, k: 0, n: 1, rel: r === 'w2' ? !!w2 : false, sent: false, go: null };
  }
  if (t.sent) return null;   // 派出过（如未能抢滩回到待命）：交给自动驾驶自选滩头
  if (!t.rel || (t.go != null && S.t < t.go) || (t.late && S.t < t.late)) return { hold: true };
  const b = TER.beaches[t.b];
  if (!b) return null;
  let x = clamp(b.cx + ((t.k || 0) - ((t.n || 1) - 1) / 2) * 30, b.x0 + 12, b.x1 - 12);
  t.px = Math.round(x); t.sent = true;
  // 偏航：沿岸流、涌浪、导航失误；修正航线后（navFix）一段时间内概率降低
  const pd = CMD_FP.drift * cmdRK() * (S.t - C.navFix < 150 ? .35 : 1);
  if ((t.r === 'w1' || t.r === 'fe' || t.r === 'w2') && C.driftN < 3 && Math.random() < pd) {
    C.driftN++;
    const adj = [t.b - 1, t.b + 1].filter(i => TER.beaches[i] && Math.abs(TER.beaches[i].cx - b.cx) < 560);
    if (adj.length && Math.random() < .45) {
      const j = pick(adj), bj = TER.beaches[j];
      x = clamp(bj.cx + gauss() * 25, bj.x0 + 12, bj.x1 - 12);
      t.drift = { k: 'adj', b: j, why: pick(['沿岸流', '涌浪', '导航失误']) };
    } else {
      x = clamp(x + (Math.random() < .5 ? -1 : 1) * (80 + Math.random() * 70), b.x0 - 40, b.x1 + 40);
      t.drift = { k: 'lat', why: pick(['沿岸流', '浪花与硝烟遮蔽视线']) };
    }
  }
  t.x = Math.round(x);
  return { b: t.b, x };
}

// 舰船监视：偏航登陆、击沉
function cmdShipsP(C) {
  for (const s of S.ships) {
    const t = C.ship[s.id];
    if (!alive(s)) {
      if (!C.sunk[s.id] && t) {
        C.sunk[s.id] = 1;
        chatSay('p', `报告：${s.label} 被击沉${t.men ? `，舰上 ${t.men} 人损失` : ''}${s.kind === 'supply' && t.men ? '，一处滩头补给站无法建立' : ''}${s.kind === 'lst' && t.veh ? `，舰上 ${t.veh} 辆装甲车辆随舰沉没` : ''}。`, { kind: 'report', at: s, lv: t.men || t.veh ? 0 : 1 });
        const gun = S.enemies.filter(e => !e.dead && e.kind === 'coastal' && e.kx != null && dist(e.kx, e.ky, s.x, s.y) < 650).sort((a, b) => dist(a.kx, a.ky, s.x, s.y) - dist(b.kx, b.ky, s.x, s.y))[0];
        if (gun && cmdFire(gun.kx, gun.ky, 3, 'cb')) chatSay('p', `命令：驱逐舰对 ${gridRef(gun.kx, gun.ky)} 岸防重炮实施压制射击，后续舰艇加速通过其射界。`, { kind: 'order', at: { x: gun.kx, y: gun.ky }, delay: 1.5, key: 'gun' + gun.id, gap: 60 });
        else if (gun && cmdAir('strike', gun.kx, gun.ky, gun.id)) chatSay('p', `命令：攻击机出击，摧毁 ${gridRef(gun.kx, gun.ky)} 岸防重炮。`, { kind: 'order', at: { x: gun.kx, y: gun.ky }, delay: 1.5, key: 'gun' + gun.id, gap: 60 });
        else if (gun && cmdAsk(gun.kx, gun.ky)) chatSay('p', `${cmdAsk(gun.kx, gun.ky)}：该岸防重炮封锁登陆航道，后续舰艇须通过其射界。`, { kind: 'order', at: { x: gun.kx, y: gun.ky }, delay: 1.5, lv: 0, key: 'askgun', gap: 60 });
      }
      continue;
    }
    if (t) { t.men = s.load ? (s.load.teams || 0) * 3 + (s.load.eng || 0) : 0; t.veh = s.load && Array.isArray(s.load.veh) ? s.load.veh.length : 0; }
    if (!t || !t.drift || t.drift.rep || (s.state !== 'unloading' && s.state !== 'beached') || s.bx == null) continue;
    t.drift.rep = true;
    const ai = cmdBeachOf(s.bx, 140), off = Math.round(Math.abs(s.bx - (t.px ?? s.bx))), smoky = S.smoke.some(m => dist(m.x, m.y, s.bx, s.by) < 160);
    const why = smoky ? '烟幕遮蔽' : t.drift.why;
    if (t.drift.k === 'adj' && ai >= 0 && ai !== t.b) {
      chatSay('p', `报告：${s.label} 受${why}影响偏航，误抵${cmdBN(ai)}，偏离预定登陆点 ${off} 米。`, { kind: 'friction', at: { x: s.bx, y: s.by } });
      cmdLater(4 + Math.random() * 3, 'drift', { sid: s.id, ai, adj: true });
    } else if (off > 55) {
      chatSay('p', `报告：${s.label} 在${why}中偏离航线，于${cmdBN(t.b)}${s.bx > (t.px ?? s.bx) ? '东' : '西'}段抢滩，偏离预定点 ${off} 米，与主力间隔拉大。`, { kind: 'friction', at: { x: s.bx, y: s.by } });
      cmdLater(4 + Math.random() * 3, 'drift', { sid: s.id, ai, adj: false });
    }
  }
}

// —— 梯队投入：第二波、补给舰、坦克登陆舰 ——
function cmdShipsOf(C, r) { return S.ships.filter(s => alive(s) && C.ship[s.id] && C.ship[s.id].r === r && cmdCtl(s) && cmdLoaded(s)); }
function cmdAshore(i) {
  const E = cmdExit(i);
  return E ? cmdMen(cmdPInf().filter(q => dist(q.x, q.y, E.x, E.y) < 380)) : 0;
}
const cmdOwned = E => !!E && E.owner === 'p' && E.prog >= .99;
function cmdWaves(C) {
  const pl = C.plan, main = pl.main, E = cmdExit(main), own = cmdOwned(E), am = cmdAshore(main);
  const w2 = cmdShipsOf(C, 'w2').filter(s => !C.ship[s.id].rel && s.state === 'idle');
  if (w2.length && (own || (S.t > 100 && am >= 25) || S.t > 190)) {
    const F = pl.feint >= 0 ? cmdExit(pl.feint) : null, af = pl.feint >= 0 ? cmdAshore(pl.feint) : 0;
    const exploit = !own && cmdOwned(F) && af >= 10, tb = exploit ? pl.feint : main, L = cmdLabels(w2);
    C.w2 = { b: tb, t: S.t };
    w2.sort((a, b) => a.x - b.x).forEach((s, k) => Object.assign(C.ship[s.id], { rel: true, b: tb, k, n: w2.length }));
    const at = cmdExit(tb);
    if (exploit) {
      chatSay('p', `判断：${cmdBN(pl.feint)}方向守军薄弱，佯攻分队已夺取${F.name}；${cmdBN(main)}方向受阻，滩头仅 ${am} 人。`, { kind: 'plan', at });
      chatSay('p', `决心：扩张战果，第二波 ${L} 改向${cmdBN(pl.feint)}上陆，由该方向向纵深发展。`, { kind: 'plan', at, delay: 1.2 });
    } else if (own) chatSay('p', `命令：${E.name}已在我手，第二波 ${L} 即刻出发，向${cmdBN(tb)}上陆。`, { kind: 'order', at, lv: 0 });
    else if (S.t <= 190) chatSay('p', `判断：${E.name}尚未夺取，但滩头已有 ${am} 人立足。决心：第二波 ${L} 提前投入${cmdBN(tb)}，加强突击力量。`, { kind: 'plan', at });
    else chatSay('p', `判断：${cmdHT()}，${E.name}仍未夺取，滩头兵力 ${am} 人。决心：不再等待，第二波 ${L} 投入${cmdBN(tb)}。`, { kind: 'plan', at });
    // 摩擦：后续梯队迟滞
    if (Math.random() < CMD_FP.late * cmdRK()) {
      const s = pick(w2), n = Math.round(30 + Math.random() * 25), why = pick(['主机故障', '舰艏跳板液压故障', '换乘编组混乱']);
      C.ship[s.id].late = +(S.t + n).toFixed(1);
      chatSay('p', `报告：第二波 ${s.label} ${why}，出发推迟约 ${n} 秒。`, { kind: 'friction', at: s, delay: 3 });
      cmdLater(9, 'late', { sid: s.id, b: tb });
    }
  }
  // 补给舰：第一波上滩、滩头有人接应后出发；尽量分到兵力最多的两处滩头
  const sup = cmdShipsOf(C, 'sup').filter(s => !C.ship[s.id].rel && s.state === 'idle');
  const first = S.ships.some(s => s.kind !== 'supply' && s.kind !== 'lst' && (s.state === 'beached' || s.state === 'unloading'));
  if (sup.length && ((first && am >= 6) || S.t > 70)) {
    const cand = TER.beaches.map((b, i) => ({ i, n: cmdAshore(i) + (cmdOwned(cmdExit(i)) ? 8 : 0) + (i === main ? 15 : 0) })).filter(x => x.n >= 6).sort((a, b) => b.n - a.n);
    if (!cand.length) cand.push({ i: main, n: 0 });
    const plan = {};
    sup.sort((a, b) => a.x - b.x).forEach((s, k) => { const c = cand[k < 2 || cand.length < 2 ? 0 : 1]; (plan[c.i] = plan[c.i] || []).push(s); });
    for (const i in plan) plan[i].forEach((s, k) => Object.assign(C.ship[s.id], { rel: true, b: +i, k: k + 3, n: plan[i].length + 5 }));
    chatSay('p', `命令：补给舰${Object.keys(plan).map(i => `${cmdLabels(plan[i])}驶向${cmdBN(+i)}`).join('，')}，建立滩头补给站。`, { kind: 'order', at: cmdExit(cand[0].i) });
  }
  // 坦克登陆舰：出口在我手中（或时间已到）才卸载装甲
  const lst = cmdShipsOf(C, 'lst').filter(s => !C.ship[s.id].rel && s.state === 'idle');
  if (lst.length) {
    const ownB = TER.beaches.map((b, i) => i).filter(i => cmdOwned(cmdExit(i))).sort((a, b) => cmdAshore(b) - cmdAshore(a));
    if (ownB.length || S.t > 240) {
      const tb = ownB.includes(main) ? main : ownB[0] ?? main;
      lst.forEach((s, k) => Object.assign(C.ship[s.id], { rel: true, b: tb, k, n: lst.length }));
      chatSay('p', `命令：坦克登陆舰 ${cmdLabels(lst)} 出发，在${cmdBN(tb)}卸载装甲${ownB.length ? `，${cmdExit(tb).name}已在我手` : '；出口未通，装甲上陆后先支援步兵夺取出口'}。`, { kind: 'order', at: cmdExit(tb) });
    }
  }
}

// —— 情报：新标定的火力点按地域汇总报告 ——
function cmdIntelP(C) {
  const fresh = S.enemies.filter(e => !e.dead && e.kx != null && !C.known[e.id]);
  if (!fresh.length) return;
  const groups = {};
  for (const e of fresh) { const w = cmdWhere(e.kx, e.ky); (groups[w] = groups[w] || []).push(e); }
  const area = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length)[0], es = groups[area];
  const plane = S.planes.some(p => !p.dead && p.kind === 'recon' && es.some(e => dist(p.x, p.y, e.kx, e.ky) < 260));
  const kn = {};
  for (const e of es) kn[e.kind] = (kn[e.kind] || 0) + 1;
  const g = gridRef(es[0].kx, es[0].ky), place = area.endsWith('方格') ? area : `${area}方向`;
  const m = chatSay('p', `${plane ? '侦察机报告' : '前沿观察报告'}：${place}标定${cmdKnText(kn)}${area.endsWith('方格') ? '' : `，坐标 ${g}`}。`, { kind: 'intel', at: { x: es[0].kx, y: es[0].ky }, key: 'intel', gap: 9, lv: es.some(e => e.kind === 'coastal' || e.kind === 'arty') ? 1 : 2 });
  if (m) for (const e of es) C.known[e.id] = 1;
}

// —— 火力：驱逐舰火力任务、航空兵任务 ——
// 岸防炮威胁：已标定的岸防重炮 + 尚未夺取的炮台据点（推定有炮）
function cmdGuns() {
  const g = S.enemies.filter(e => !e.dead && e.kind === 'coastal' && e.kx != null).map(e => ({ x: e.kx, y: e.ky }));
  for (const p of S.points) if ((p.key === 'BT' || p.key === 'BT2') && p.owner !== 'p' && !g.some(o => dist(o.x, o.y, p.x, p.y) < 120)) g.push({ x: p.x, y: p.y });
  return g;
}
// 驱逐舰阵位：能打到 (x, y)（980 以内）、离岸防炮 650 以外、航程最短的深水点；没有就返回 null
function cmdDDSpot(x, y) {
  const dd = S.dd, guns = cmdGuns();
  let best = null, bd = Infinity;
  for (let sx = clamp(x - 700, 100, W - 100); sx <= clamp(x + 700, 100, W - 100); sx += 70)
    for (let sy = Math.max(coastAt(sx) + 380, STAGING_Y - 140); sy <= H - 70; sy += 60) {
      if (typeAt(sx, sy) !== T.DEEP || dist(sx, sy, x, y) > 960 || guns.some(g => dist(g.x, g.y, sx, sy) < (dd.hull <= 1 ? 720 : 650))) continue;
      const d = dist(dd.x, dd.y, sx, sy);
      if (d < bd) { bd = d; best = { x: sx, y: sy }; }
    }
  return best;
}
// 下达一个舰炮火力任务（驱逐舰须受指挥且在位）；返回是否受理
function cmdFire(x, y, n, why) {
  const C = S.cmd.p, dd = S.dd;
  if (!cmdCtl(dd) || dd.state === 'sunk' || !isFinite(x) || !isFinite(y)) return false;
  if (dist(dd.x, dd.y, x, y) > 980 && !cmdDDSpot(x, y)) return false;
  if (C.fm.some(m => dist(m.x, m.y, x, y) < 40 && m.n > 0)) return true;
  C.fm.push({ x: Math.round(x), y: Math.round(y), n, t: S.t, why });
  return true;
}
function cmdAir(k, x, y, eid) {
  const C = S.cmd.p, c = S.cv;
  if (!c || !cmdCtl(c) || c.hp <= 0 || !S.air || !S.air.wing.some(w => w.type === k && w.state !== 'lost')) return false;
  if (C.air.some(a => a.k === k && dist(a.x, a.y, x, y) < 60)) return true;
  C.air.push({ k, x: Math.round(x), y: Math.round(y), eid: eid ?? null, t: S.t });
  return true;
}
// PvE：驱逐舰 / 航母由玩家直接指挥时，指挥官只能提出请求（坐标随消息，点击即可定位）
function cmdAsk(x, y) {
  if (cmdAll() || !S.dd || S.dd.state === 'sunk' || cmdCtl(S.dd)) return '';
  return `请求舰队以舰炮压制 ${gridRef(x, y)}（驱逐舰由您直接指挥）`;
}
// 离 (x,y) 最近的我方小组距离
function cmdNearP(x, y) {
  let bd = Infinity, best = null;
  for (const q of S.teams) if (q.side === 'p' && q.men.length) { const d = dist(q.x, q.y, x, y); if (d < bd) { bd = d; best = q; } }
  return { d: bd, q: best };
}
// support.js updateDD 调用：返回 null 交给默认自动射击 / {hold} 停止射击 / {x, y, smoke} 本次射击诸元
function cmdDDMission(dd) {
  if (!cmdOn() || !cmdCtl(dd)) return null;
  const C = S.cmd.p;
  if (S.t < C.cf) return { hold: true };
  if (C.safeT && S.t > C.safeT) { C.safe = 60; C.safeT = 0; }
  // 受损后节约射击：舰体 2/3 时齐射间隔拉长，1/3 时只执行指定火力任务（每次齐射都可能招来反炮兵射击）
  // 只在冷却为 0 时被调用：两次调用之间有间隔，说明上次调用后开过火（装填 5 秒）
  if (C.ddCall != null && S.t - C.ddCall > .2) C.ddLast = Math.max(C.ddLast ?? -99, C.ddCall);
  C.ddCall = S.t;
  const econ = dd.hull <= 1 ? 14 : dd.hull === 2 ? 9 : 0;
  if (econ && S.t - (C.ddLast ?? -99) < econ) return { hold: true };
  while (C.fm.length) {
    const m = C.fm[0];
    if (m.n <= 0 || S.t - m.t > 100 || (m.smoke && S.assets.smoke <= 0)) { C.fm.shift(); continue; }
    if (dist(dd.x, dd.y, m.x, m.y) > 990) {   // 射程外：机动到安全阵位，期间照常自卫射击
      const sp = cmdDDSpot(m.x, m.y);
      if (!sp) { C.fm.shift(); continue; }
      if (!dd.moving || dist(dd.tx, dd.ty, sp.x, sp.y) > 80) orderDD(sp.x, sp.y);
      return null;
    }
    let x = m.x, y = m.y;
    if (!m.smoke) {
      const nb = cmdNearP(x, y);
      if (nb.d < C.safe) { const k = (C.safe + 30 - nb.d) / Math.max(1, nb.d); x += (x - nb.q.x) * k; y += (y - nb.q.y) * k; }   // 向远离我军方向延伸
      // 摩擦：射击诸元错误，弹着向我军一侧偏移
      if (nb.d < 170 && S.t - C.dcT > 60 && Math.random() < CMD_FP.dc) { x = nb.q.x + (x - nb.q.x) * 30 / Math.max(30, nb.d); y = nb.q.y + (y - nb.q.y) * 30 / Math.max(30, nb.d); }
    }
    m.n--;
    return { x, y, smoke: !!m.smoke };
  }
  return dd.hull <= 1 ? { hold: true } : null;
}
const cmdDDSafe = () => cmdOn() && S.cmd ? Math.max(55, S.cmd.p.safe) : 55;
const cmdAirSafe = () => cmdOn() && S.cmd ? (S.cmd.p.airSafeT > S.t ? S.cmd.p.airSafe : 90) : 90;
// carrier.js updateAirAuto 调用：取出一个可执行的航空任务
function cmdAirTask(c) {
  if (!cmdOn() || !cmdCtl(c)) return null;
  const C = S.cmd.p;
  for (let i = 0; i < C.air.length; i++) {
    const a = C.air[i];
    if (S.t - a.t > 75) { C.air.splice(i--, 1); continue; }
    if (!(S.assets[a.k] > 0)) continue;
    if (a.k !== 'recon' && cmdNearP(a.x, a.y).d < (a.k === 'cas' ? 45 : cmdAirSafe())) { if (S.t - a.t > 20) C.air.splice(i--, 1); continue; }
    C.air.splice(i, 1);
    return a;
  }
  return null;
}
// 起飞后：攻击机可能被假阵地 / 坐标错误引偏
function cmdAirLaunched(a, p) {
  if (!cmdOn() || !p || !a || a.k !== 'strike' || a.eid == null) return;
  const C = S.cmd.p;
  if (C.decoy.length || S.t - (C.dcyT ?? -99) < 150 || (C.dcyOK && C.dcyOK[a.eid]) || Math.random() >= CMD_FP.decoy * cmdRK()) return;
  C.dcyT = S.t;
  const ang = Math.random() * 6.283, off = 85 + Math.random() * 45;
  let x = clamp(p.tx + Math.cos(ang) * off, 10, W - 10), y = clamp(p.ty + Math.sin(ang) * off, 10, H - 10);
  if (cmdNearP(x, y).d < 120) { x = clamp(p.tx - Math.cos(ang) * off, 10, W - 10); y = clamp(p.ty - Math.sin(ang) * off, 10, H - 10); }
  if (cmdNearP(x, y).d < 120) return;
  Object.assign(p, { tx: x, ty: y, cx: x, cy: y, wp: [{ x, y }] });
  C.decoy.push({ pid: p.id, eid: a.eid, x: Math.round(x), y: Math.round(y), rx: Math.round(a.x), ry: Math.round(a.y), t: S.t });
}
function cmdDecoys(C) {
  for (let i = 0; i < C.decoy.length; i++) {
    const d = C.decoy[i], p = S.planes.find(o => o.id === d.pid);
    if (S.t - d.t > 90) { C.decoy.splice(i--, 1); continue; }
    if (p && !p.dropped) continue;
    C.decoy.splice(i--, 1);
    if (!p) continue;   // 投弹前被击落
    const e = S.enemies.find(o => o.id === d.eid), off = Math.round(dist(d.x, d.y, d.rx, d.ry));
    chatSay('p', `报告：攻击机在 ${gridRef(d.x, d.y)} 投弹，未见二次爆炸，判断为伪装假阵地，偏离标定目标约 ${off} 米。`, { kind: 'friction', at: d, delay: 1.5 });
    const acts = [];
    if (cmdAir('recon', d.rx, d.ry)) acts.push(`侦察机复查 ${gridRef(d.rx, d.ry)} 地域，重新标定`);
    if (e && !e.dead) { (C.dcyOK = C.dcyOK || {})[e.id] = 1; cmdAir('strike', e.kx ?? d.rx, e.ky ?? d.ry, e.id); acts.push(`攻击机整备后对${cmdEName(e)}再次出击`); }
    if (e && !e.dead && cmdFire(e.kx ?? d.rx, e.ky ?? d.ry, 2, 'decoy')) acts.push('舰炮先行压制');
    if (acts.length) chatSay('p', `补救：${acts.join('，')}。`, { kind: 'remedy', at: { x: d.rx, y: d.ry }, delay: 4 });
  }
}
// 定时火力：第一波抵近时施放烟幕
function cmdFiresP(C) {
  const pl = C.plan, b = TER.beaches[pl.main];
  if (C.smokeDue && b) {
    const w1 = cmdShipsOf(C, 'w1').filter(s => s.state === 'move');
    const near = w1.some(s => s.y - coastAt(s.x) < 380) || S.ships.some(s => C.ship[s.id] && C.ship[s.id].r === 'w1' && s.state !== 'move' && s.state !== 'idle');
    if (near) {
      C.smokeDue = false;
      if (cmdCtl(S.dd) && S.dd.state !== 'sunk' && S.assets.smoke >= 2) {
        C.fm.unshift({ x: Math.round(b.cx - 45), y: Math.round(coastAt(b.cx - 45) - 30), n: 1, smoke: true, t: S.t, why: 'smoke' }, { x: Math.round(b.cx + 45), y: Math.round(coastAt(b.cx + 45) - 30), n: 1, smoke: true, t: S.t, why: 'smoke' });
        chatSay('p', `命令：驱逐舰向${b.name}滩头施放烟幕，遮蔽守军观察，掩护第一波抢滩。`, { kind: 'order', at: { x: b.cx, y: coastAt(b.cx) } });
      }
    }
  }
  // 驱逐舰中弹：报告损伤与火力来源，机动脱离射界，航空兵压制该炮
  const dd = S.dd;
  if (cmdCtl(dd) && dd.state !== 'sunk') {
    if (C.ddHull == null || dd.hull > C.ddHull) C.ddHull = dd.hull;
    if (dd.hull < C.ddHull) {
      C.ddHull = dd.hull;
      // 火力来源按实际命中记录（support.js damageDD）：岸防炮直瞄 / 反炮兵射击 / 不明
      const h = dd.lastHit && S.t - dd.lastHit.t < 3 ? dd.lastHit : null, cb = h && h.kind === 'cb';
      const g = h && h.kind === 'coastal' ? S.enemies.filter(e => !e.dead && e.kind === 'coastal' && dist(e.x, e.y, h.x, h.y) < 30)[0] : null, gk = g && g.kx != null;
      const src = cb ? `；火力来自 ${gridRef(h.x, h.y)} 方向敌炮兵反炮兵射击` : g ? `；火力来自 ${gk ? gridRef(g.kx, g.ky) + ' 岸防重炮' : gridRef(h.x, h.y) + ' 方向未标定的岸防炮'}` : h && h.x != null ? `；火力来自 ${gridRef(h.x, h.y)} 方向敌炮兵` : '；火力来源尚未判明';
      chatSay('p', `报告：驱逐舰中弹，舰体 ${dd.hull}/3，损管抢修中，暂停射击${src}。`, { kind: 'friction', at: dd });
      const M = cmdExit(pl.main), sp = M && cmdDDSpot(M.x, M.y), acts = [];
      if (cb) { dd.scoot = true; acts.push('驱逐舰每次齐射后立即机动 70 米以上（打了就走），躲开反炮兵弹着'); }
      else if (sp && dist(sp.x, sp.y, dd.x, dd.y) > 60) { orderDD(sp.x, sp.y); acts.push(`驱逐舰全速机动至 ${gridRef(sp.x, sp.y)}，脱离其射界`); }
      else if (!sp) { orderDD(dd.x, Math.min(H - 70, dd.y + 260)); acts.push('驱逐舰向南退出岸防炮射程'); }
      else {   // 已在最佳阵位仍被命中（多为未标定火炮）：变换阵位，打乱敌方测距
        let nx = clamp(dd.x + (Math.random() < .5 ? -1 : 1) * 170, 120, W - 120), ny = Math.min(H - 70, dd.y + 120);
        if (typeAt(nx, ny) !== T.DEEP) { nx = dd.x; ny = Math.min(H - 70, dd.y + 200); }
        orderDD(nx, ny); acts.push('驱逐舰变换阵位');
      }
      if (gk && cmdAir('strike', g.kx, g.ky, g.id)) acts.push('攻击机出击压制该炮');
      if (dd.hull === 1) acts.push('驱逐舰舰体重创，此后只执行指定火力任务');
      else if (!cb) acts.push('驱逐舰降低射速，减少暴露');
      C.evT = S.t;
      if (acts.length) chatSay('p', `补救：${acts.join('；')}。`, { kind: 'remedy', at: sp || dd, delay: 2 });
    }
  }
  // 驱逐舰位于（或正驶入）已标定岸防炮射界：机动规避（仍保持对主攻滩头的射程）
  if (cmdCtl(dd) && dd.state !== 'sunk' && S.t - (C.evT ?? -99) > 30) {
    const g = S.enemies.find(e => !e.dead && e.kind === 'coastal' && e.kx != null && (dist(e.kx, e.ky, dd.x, dd.y) < 640 || (dd.moving && dist(e.kx, e.ky, dd.tx, dd.ty) < 640)));
    const M = cmdExit(pl.main), sp = g && M && cmdDDSpot(M.x, M.y);
    if (sp && dist(sp.x, sp.y, dd.x, dd.y) > 60) { C.evT = S.t; orderDD(sp.x, sp.y); chatSay('p', `命令：驱逐舰机动至 ${gridRef(sp.x, sp.y)}，规避 ${gridRef(g.kx, g.ky)} 岸防重炮射界，保持对${b.name}的火力支援。`, { kind: 'order', at: sp, lv: 2 }); }
  }
  if (S.dd.state === 'sunk' && !C.ddSunk) {
    C.ddSunk = true;
    if (cmdCtl(S.dd)) chatSay('p', `报告：驱逐舰被击沉，舰炮支援丧失。${S.cv && S.cv.hp > 0 && cmdCtl(S.cv) ? '近距火力支援改由舰载航空兵承担。' : ''}`, { kind: 'report', at: S.dd, lv: 0 });
  }
}

// —— 作战阶段与目标优先级（写入 S.autoPlan.pri / mis，自动驾驶据此选目标）——
function cmdAxis(E) {
  const hq = cmdPt('HQ');
  if (!hq || !E) return [];
  const L = dist(E.x, E.y, hq.x, hq.y) || 1, c = [];
  for (const p of S.points) {
    if (p === hq || /^E\d/.test(p.key) || cmdOwned(p)) continue;
    const t = ((p.x - E.x) * (hq.x - E.x) + (p.y - E.y) * (hq.y - E.y)) / (L * L);
    if (t < .05 || t > .95 || segDist(p.x, p.y, E.x, E.y, hq.x, hq.y) > 260) continue;
    c.push({ k: p.key, t });
  }
  c.sort((a, b) => a.t - b.t);
  const out = c.slice(0, 2).map(x => x.k);
  if (!cmdOwned(hq)) out.push('HQ');
  return out;
}
function cmdPhaseP(C, P) {
  const pl = C.plan, E = cmdExit(pl.main), hq = cmdPt('HQ');
  const w1 = S.ships.filter(s => C.ship[s.id] && C.ship[s.id].r === 'w1');
  if (C.ph === 'land') {
    const beached = w1.filter(s => s.state === 'beached');
    if (beached.length && (beached.length >= Math.max(1, Math.ceil(w1.filter(alive).length * .6)) || S.t > 60)) {
      C.ph = 'beach';
      const men = cmdAshore(pl.main), feint = pl.feint >= 0 ? cmdAshore(pl.feint) : 0;
      chatSay('p', `报告：第一波 ${beached.length} 艘已在${cmdBN(pl.main)}抢滩，上陆约 ${men} 人${feint ? `；佯攻分队在${cmdBN(pl.feint)}上陆 ${feint} 人，正吸引守军火力` : ''}。`, { kind: 'report', at: E, lv: 0 });
    }
  }
  if ((C.ph === 'land' || C.ph === 'beach') && cmdOwned(E)) {
    C.ph = 'brk';
    C.axis = cmdAxis(E);
    const names = C.axis.map(k => cmdPt(k).name);
    if (names.length) chatSay('p', `决心：${E.name}已夺取，滩头阵地初步稳固。转入纵深发展，主要方向：${names.join('→')}。`, { kind: 'plan', at: cmdPt(C.axis[0]) || E });
  }
  if (C.ph === 'brk') {
    C.axis = C.axis.filter(k => { const p = cmdPt(k); return p && !cmdOwned(p); });
    if (!C.axis.length) C.axis = cmdAxis(E);
  }
  if (C.ph !== 'cons' && hq && cmdOwned(hq)) {
    C.ph = 'cons';
    chatSay('p', `决心：指挥所已夺取，转入巩固。各连就地构筑防御，严防反冲击；${vpShare() >= VP_WIN ? '已控制七成据点分值，坚守待援' : '余部继续夺取周边据点，扩大登陆场'}。`, { kind: 'plan', at: hq });
  } else if (C.ph === 'cons' && hq && hq.owner !== 'p') { C.ph = 'brk'; C.axis = ['HQ']; }   // 失守的叙述与反击见 cmdPointsP
  // 目标优先级
  const pri = {};
  if (C.ph === 'land' || C.ph === 'beach') {
    if (E && E.key) pri[E.key] = 5;
    const F = pl.feint >= 0 ? cmdExit(pl.feint) : null;
    if (F && F.key) pri[F.key] = 1.5;
  } else if (C.ph === 'brk') {
    C.axis.forEach((k, i) => { pri[k] = Math.max(pri[k] || 0, i === 0 ? 4.5 : k === 'HQ' ? 2.5 : 2.5); });
  } else for (const p of S.points) if (C.own[p.key] === 'p' && p.owner !== 'p') pri[p.key] = p.key === 'HQ' ? 6 : 3.5;
  if (C.crisis && C.ph !== 'cons') {   // 危局：集中残余兵力于一点，其余方向停止进攻
    const k = C.crisis.key, cp = cmdPt(k);
    if (cp && !cmdOwned(cp)) { for (const q in pri) pri[q] = Math.min(pri[q], 1); for (const p of S.points) if (p.key !== k && !cmdOwned(p) && C.own[p.key] !== 'p') pri[p.key] = -3; pri[k] = 8; }
    else C.crisis.key = null;
  }
  P.pri = pri;
  P.mis = C.mission;
  let fk = null, fv = 0;
  for (const k in pri) if (pri[k] > fv) { fv = pri[k]; fk = k; }
  C.focus = fk;
}

// —— 据点得失：夺取报告；失守时组织反击 ——
function cmdPointsP(C, P) {
  for (const p of S.points) {
    const was = C.own[p.key] || 'e', now = cmdOwned(p) ? 'p' : p.owner === 'p' ? was : 'e';
    if (was === now) continue;
    C.own[p.key] = now;
    if (now === 'p') {
      let u = null, bd = 200;
      for (const o of S.units) if (o.side === 'p' && o.kind === 'inf' && o.x != null) { const d = dist(o.x, o.y, p.x, p.y); if (d < bd) { bd = d; u = o; } }
      const next = C.ph === 'brk' && C.axis[0] === p.key ? cmdPt(C.axis[1]) : null;
      chatSay('p', `报告：${u ? cmdUName(u) : '我部'}夺取${p.name}。${next ? `命令：继续向${next.name}发展。` : ''}`, { kind: 'report', at: p, lv: p.vp >= 2 || next ? 1 : 2 });
    } else {
      if (S.t - (C.lostT[p.key] ?? -99) < 60) continue;
      C.lostT[p.key] = S.t;
      chatSay('p', `报告：${p.name}遭敌反冲击失守。`, { kind: 'report', at: p, lv: p.vp >= 2 ? 0 : 1 });
      const us = [], n = p.key === 'HQ' ? 2 : 1;
      for (let k = 0; k < n; k++) { const u = cmdSpareUnit(p, us, P, p.key === 'HQ' ? 900 : 650); if (u) us.push(u); }
      if (us.length) {
        for (const u of us) cmdSend(u, 'task', { key: p.key });
        const fire = cmdFoeFire(p);
        chatSay('p', `${p.key === 'HQ' ? '决心：集中就近兵力立即反击。' : '补救：'}命令${us.map(cmdUName).join('、')}就近反击，夺回${p.name}${fire ? '，舰炮先行压制' : ''}。`, { kind: p.key === 'HQ' ? 'plan' : 'remedy', at: p, delay: 2 });
      }
    }
  }
}
// 附近已知敌人（碉堡、看得见或刚看见的小组）的火力重心，且离我军不太近；可以就地叫舰炮
function cmdFoeAt(p, r, safe) {
  const pts = [];
  for (const e of S.enemies) if (!e.dead && e.kx != null && dist(e.kx, e.ky, p.x, p.y) < r) pts.push({ x: e.kx, y: e.ky, w: e.kind === 'bunker' ? 5 : 2 });
  for (const q of S.teams) if (q.side === 'e' && q.men.length) {
    const vis = inVision(q.x, q.y), x = vis ? q.x : q.sx, y = vis ? q.y : q.sy;
    if ((vis || (q.seen != null && S.t - q.seen < 20)) && dist(x, y, p.x, p.y) < r) pts.push({ x, y, w: q.men.length });
  }
  let best = null, bs = 0;
  for (const a of pts) {
    if (cmdNearP(a.x, a.y).d < (safe ?? 70)) continue;
    const s = pts.reduce((acc, b) => acc + (dist(a.x, a.y, b.x, b.y) < 40 ? b.w : 0), 0);
    if (s > bs) { bs = s; best = { x: a.x, y: a.y, w: s }; }
  }
  return best;
}
function cmdFoeFire(p) { const f = cmdFoeAt(p, 140); return !!(f && cmdFire(f.x, f.y, 2, 'retake')); }
// 可抽调的连队：受指挥、未溃、不弱，当前目标价值不高于 p，距离以内最近
function cmdSpareUnit(p, grp, P, maxD = 700) {
  let best = null, bd = maxD;
  const pri = (P.pri || {});
  for (const u of S.units) {
    if (u.side !== 'p' || u.kind !== 'inf' || !cmdCtl(u) || u.state === 'rout' || grp.includes(u) || u.x == null || !teamsOf(u).length) continue;
    const pl = P.u[u.id];
    if (!pl || !['idle', 'stage', 'wait', 'garrison'].includes(pl.ph) || pl.obj === p.key || apWeak(u)) continue;
    if (S.cmd.p.pend && S.cmd.p.pend[u.id] > S.t) continue;
    const o = cmdPt(pl.obj);
    if (o && pl.ph !== 'idle' && ((pri[o.key] || 0) > (pri[p.key] || 0) || (o.key === 'HQ' && pl.ph === 'garrison'))) continue;
    if (pl.ph === 'garrison' && o && apEstimate(o, true) > 0) continue;
    const d = dist(u.x, u.y, p.x, p.y) + (pl.ph === 'garrison' ? 150 : 0);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

// —— 情报误判：指挥官对据点守军的估计带噪声（autopilot.js apAssign 使用）；记录发起攻击时的估计，受挫后对照 ——
function cmdEst(p, est) {
  if (!cmdOn() || !S.cmd.p.plan) return est;
  const C = S.cmd.p;
  if (C.noise[p.key] == null) C.noise[p.key] = +clamp(gauss() * .55, -.6, .8).toFixed(2);
  const k = inVision(p.x, p.y) ? .3 : 1;   // 目视之后误差收窄
  return Math.max(0, est * (1 + C.noise[p.key] * k));
}
function cmdEst0(C, P) {
  for (const k in P.o) if (C.est0[k] == null) { const p = cmdPt(k); if (p) C.est0[k] = Math.round(cmdEst(p, apEstimate(p))); }
  for (const k in C.est0) if (!P.o[k]) delete C.est0[k];
}

// —— 攻击受阻：火力支援 → 增援 → 后撤重整、侧翼迂回 ——
function cmdStalls(C, P) {
  for (const key in P.o) {
    const O = P.o[key], p = cmdPt(key);
    if (!O.go || !p || cmdOwned(p)) continue;
    if (C.stall[key] != null && S.t - C.stall[key] < 75) continue;
    const grp = S.units.filter(u => u.side === 'p' && cmdCtl(u) && P.u[u.id] && P.u[u.id].obj === key && P.u[u.id].ph === 'go' && teamsOf(u).length);
    if (!grp.length) continue;
    const men = grp.reduce((a, u) => a + (u.men || 0), 0), men0 = grp.reduce((a, u) => a + Math.max(u.men || 0, P.u[u.id].men0 || 0), 0), lost = men0 - men;
    if (men0 < 4) continue;   // 残部（几个人）不算一次攻击
    const dur = S.t - (O.t || S.t), stag = S.t - (O.pgT ?? O.t ?? S.t), waver = grp.some(u => u.state === 'waver');
    if (!((dur > 40 && stag > 32) || (lost >= Math.max(5, men0 * .35) && dur > 12) || (waver && dur > 15))) continue;
    C.stall[key] = S.t;
    cmdStallFix(C, P, key, p, grp, men, men0, lost);
  }
}
function cmdStallFix(C, P, key, p, grp, men, men0, lost) {
  const names = grp.map(cmdUName).join('、'), seen = Math.round(apEstimate(p, true)), est0 = C.est0[key];
  const bk = S.enemies.filter(e => !e.dead && e.kx != null && e.kind === 'bunker' && dist(e.kx, e.ky, p.x, p.y) < 120).length;
  let why = '';
  if (est0 != null && seen > est0 * 1.3 + 1) why = `；守军约 ${seen} 人，超出战前估计（${est0} 人），攻击兵力不足`;
  else if (bk) why = `；${bk} 座碉堡交叉火力封锁接近路`;
  else if (grp.some(u => u.state === 'waver')) why = '；部队士气动摇';
  const O = P.o[key], dur = Math.round(S.t - (O.t || S.t)), st = [];
  if (S.t - (O.pgT ?? O.t ?? S.t) > 30) st.push(`攻击 ${dur} 秒仍未突入`);
  if (lost > 0) st.push(`已伤亡 ${lost} 人`);
  chatSay('p', `报告：${p.name}攻击受阻：${names}投入 ${men0} 人，${st.join('，') || '攻势受挫'}${why}。`, { kind: 'friction', at: p });
  const gx = grp.reduce((a, u) => a + u.x, 0) / grp.length, gy = grp.reduce((a, u) => a + u.y, 0) / grp.length, acts = [];
  const tgt = cmdFoeAt(p, 140);
  if (tgt && cmdFire(tgt.x, tgt.y, 3, 'stall')) acts.push(`呼叫舰炮对${p.name}${cmdDir(tgt.x - gx, tgt.y - gy)}面火力点急促射 3 发`);
  else if (tgt && cmdAir('cas', tgt.x, tgt.y)) acts.push(`呼叫对地支援机压制${p.name}守军`);
  else if (tgt && cmdAsk(tgt.x, tgt.y)) acts.push(cmdAsk(tgt.x, tgt.y));
  if (tgt && S.assets.smoke > 0 && cmdCtl(S.dd) && S.dd.state !== 'sunk' && lost >= men0 * .25) {
    const sx = lerp(gx, tgt.x, .55), sy = lerp(gy, tgt.y, .55);
    if (cmdNearP(sx, sy).d > 25) { C.fm.push({ x: Math.round(sx), y: Math.round(sy), n: 1, smoke: true, t: S.t, why: 'stall' }); acts.push('在攻击正面施放烟幕'); }
  }
  const vh = cmdVehHelp(gx, gy, p);
  if (vh) acts.push(`${typeof vehName === 'function' ? vehName(vh) + ' ' : '装甲车'}前出至攻击组后方，以主炮摧毁当面火力点`);
  const hurt = lost >= men0 * .45, rf = !hurt ? cmdSpareUnit(p, grp, P) : null;
  if (rf) {
    cmdSend(rf, 'task', { key });
    P.o[key].boost = P.o[key].need = Math.min(3, (P.o[key].need || 1) + 1);
    acts.push(`命令${cmdUName(rf)}向${p.name}增援，协同再攻`);
  }
  if (hurt || (!rf && !acts.length)) {
    // 迂回方向：先实际选出侧翼集结点（避开海面、雷区、铁丝网），叙述与执行一致
    const u0 = grp[0], a = Math.atan2(p.y - u0.y, p.x - u0.x), lx = -Math.sin(a), ly = Math.cos(a);
    let side = Math.random() < .5 ? 1 : -1;
    const sp = typeof apFlankSpot === 'function' ? apFlankSpot(u0, p, side) : null;
    if (sp) side = (sp.x - u0.x) * lx + (sp.y - u0.y) * ly >= 0 ? 1 : -1;
    for (const u of grp) cmdSend(u, 'flank', { key, side });
    acts.push(`攻击暂停，${names}后撤重整，尔后由${cmdDir(sp ? sp.x - p.x : lx * side, sp ? sp.y - p.y : ly * side)}侧迂回再攻`);
  }
  chatSay('p', `补救：${acts.join('；')}。`, { kind: 'remedy', at: p, delay: 2 });
}

// —— 停滞不前（apLaunch 调用 cmdOnLaunch 制造；此处发现并催促）——
function cmdOnLaunch(units, p) {
  if (!cmdOn() || !S.autoPlan) return;
  const C = S.cmd.p, P = S.autoPlan;
  if (S.t - C.haltT < 50 || Math.random() >= CMD_FP.halt * cmdRK()) return;
  const cand = units.filter(u => cmdCtl(u) && P.u[u.id] && dist(u.x, u.y, p.x, p.y) > 125);
  if (!cand.length) return;
  const u = pick(cand), pl = P.u[u.id];
  for (const q of teamsOf(u)) if (q.order.x != null) {
    const d = dist(q.x, q.y, p.x, p.y), f = clamp((d - 95) / Math.max(1, d), .1, .9);
    q.order = { t: 'amove', x: q.x + (q.order.x - q.x) * f, y: q.y + (q.order.y - q.y) * f, gx: q.order.gx, gy: q.order.gy }; q.pathT = -9;
  }
  pl.halt = S.t; C.haltT = S.t;
  C.halt[u.id] = { t: S.t, key: p.key, why: pick(['误将一条田埂当作调整线', '等待侧翼友邻跟进', '前方情况不明，排长犹豫']) };
}
function cmdHalts(C, P) {
  for (const id in C.halt) {
    const h = C.halt[id], u = UNIT_MAP.get(+id), pl = P.u[id], p = cmdPt(h.key);
    if (!u || !pl || pl.halt == null || !teamsOf(u).length || !p || cmdOwned(p)) { delete C.halt[id]; if (pl) pl.halt = null; continue; }
    if (h.rep) continue;
    const ts = teamsOf(u);
    if (S.t - h.t < 9 || !ts.every(q => q.order.t === 'hold' || (q.order.x != null && dist(q.x, q.y, q.order.x, q.order.y) < 6))) continue;
    h.rep = true;
    const d = Math.round(dist(u.x, u.y, p.x, p.y)), mates = S.units.filter(o => o !== u && o.side === 'p' && P.u[o.id] && P.u[o.id].obj === h.key && P.u[o.id].ph === 'go');
    chatSay('p', `报告：${cmdUName(u)}在${p.name}${cmdDir(u.x - p.x, u.y - p.y)}面 ${d} 米处停止前进，${h.why}${mates.length ? `，${cmdUName(mates[0])}侧翼暴露` : ''}。`, { kind: 'friction', at: u });
    cmdSend(u, 'urge', { key: h.key });
    chatSay('p', `补救：催促${cmdUName(u)}立即前进${mates.length ? `，与${mates.map(cmdUName).join('、')}会攻${p.name}` : `，限 30 秒内突入${p.name}`}。`, { kind: 'remedy', at: u, delay: 1.5 });
  }
}

// —— 通信：命令经无线电（或传令兵）传达，有延迟、可能受干扰或丢失 ——
function cmdSend(u, act, a) {
  const C = S.cmd.p, relay = !!S.relay, radios = teamsOf(u).filter(q => q.men.includes('radio')).length, un = cmdUName(u);
  let d = relay ? 1 + Math.random() * 2 : 2 + Math.random() * 6, lost = false;
  if (!radios) {
    if (relay) d += 3;
    else if (Math.random() < .3) { lost = true; d = 18 + Math.random() * 10; }
    else {
      d = 8 + Math.random() * 7;
      chatSay('p', `报告：${un}电台全部损毁，无线电联络中断。`, { kind: 'friction', at: u, key: 'nor' + u.id, gap: 60 });
      chatSay('p', `补救：派传令兵前往${un}传达命令，预计 ${Math.round(d)} 秒送达。`, { kind: 'remedy', at: u, delay: 1.5, key: 'run' + u.id, gap: 60 });
    }
  } else if (!relay && Math.random() < CMD_FP.jam && S.t - (C.jamT ?? -99) > 60) {
    C.jamT = S.t;
    const n = Math.round(8 + Math.random() * 7);
    d += n;
    chatSay('p', `报告：与${un}的无线电联络受干扰，命令未获确认。`, { kind: 'friction', at: u });
    chatSay('p', `补救：改用备用频率重发命令，约 ${n} 秒后确认收到。`, { kind: 'remedy', at: u, delay: 2 });
  }
  cmdLater(d, 'order', { uid: u.id, act, ...a, lost, runner: !radios && !relay });
  (C.pend || (C.pend = {}))[u.id] = S.t + d + 2;   // 命令在途：送达前不再被另行抽调
  return d;
}

// 威胁处置：炸桥、渗透、敌装甲
function cmdThreatsP(C) {
  for (const b of S.blown || []) {
    if (b.prog >= 1 || C.bridge[b.key]) continue;
    C.bridge[b.key] = { t: S.t };
    let u = null, bd = 400;
    for (const o of S.units) if (o.side === 'p' && o.kind === 'inf' && o.x != null) { const d = dist(o.x, o.y, b.x, b.y); if (d < bd) { bd = d; u = o; } }
    chatSay('p', `报告：守军炸毁${b.name}${u ? `，${cmdUName(u)}向纵深推进受阻` : ''}。`, { kind: 'report', at: b, lv: 0 });
    const eng = S.units.some(o => o.side === 'p' && o.kind === 'eng' && cmdCtl(o) && teamsOf(o).length);
    if (eng) chatSay('p', `补救：命令工兵组前出抢修${b.name}${u ? `，${cmdUName(u)}在桥头占领阵地掩护作业` : ''}；同时侦察上下游渡口。`, { kind: 'remedy', at: b, delay: 2 });
    else C.bridge[b.key].none = true;
  }
  for (const r of S.raids || []) {
    if (!r.seen || C.raids[r.id]) continue;
    C.raids[r.id] = 1;
    const ts = r.teams.map(id => S.teams.find(q => q.id === id && q.men.length)).filter(Boolean), q = ts[0];
    if (!q) continue;
    const at = { x: q.seen != null ? q.sx : q.x, y: q.seen != null ? q.sy : q.y }, P = S.autoPlan;
    chatSay('p', `报告：${cmdWhere(at.x, at.y)}发现敌小股部队 ${ts.length} 组向我后方渗透，疑图袭击${CMD_RAID[r.kind] || '我后方'}。`, { kind: 'report', at, lv: 0 });
    let u = null, bd = 550;
    if (P) for (const o of S.units) {
      const pl = P.u[o.id];
      if (o.side !== 'p' || o.kind !== 'inf' || !cmdCtl(o) || o.state === 'rout' || !pl || apWeak(o) || !['idle', 'garrison', 'stage', 'wait', 'supply'].includes(pl.ph)) continue;
      if (pl.ph === 'garrison' && pl.obj === 'HQ') continue;
      const d = dist(o.x, o.y, at.x, at.y);
      if (d < bd) { bd = d; u = o; }
    }
    if (u) {
      cmdSend(u, 'icpt', { raid: r.id });
      chatSay('p', `补救：命令${cmdUName(u)}抽出兵力拦截，补给站警戒分队进入阵地。`, { kind: 'remedy', at, delay: 2 });
    }
  }
  for (const a of S.armor || []) {
    if (a.dead || a.kx == null || C.cars[a.id]) continue;
    C.cars[a.id] = 1;
    const acts = [], g = gridRef(a.kx, a.ky), at = { x: a.kx, y: a.ky };
    const near = cmdNearP(a.kx, a.ky), close = near.d < 320;
    if (cmdFire(a.kx, a.ky, 3, 'armor')) acts.push('舰炮急促射');
    if (cmdAir('strike', a.kx, a.ky)) acts.push('攻击机出击');
    chatSay('p', `报告：${cmdWhere(a.kx, a.ky)}发现敌装甲车（${g}）${close ? `，距我前沿 ${Math.round(near.d)} 米` : ''}，轻武器无法击穿。`, { kind: 'report', at, key: 'car', gap: 30, lv: close ? 0 : 1 });
    if (acts.length) chatSay('p', `命令：${acts.join('、')}，打击 ${g} 敌装甲车${close ? '' : '，阻其向滩头机动'}。`, { kind: 'order', at, delay: 1.5, key: 'carord', gap: 30 });
    else if (!close && cmdAsk(a.kx, a.ky)) chatSay('p', `${cmdAsk(a.kx, a.ky)}：敌装甲车正向我滩头机动。`, { kind: 'order', at, delay: 1.5, key: 'carord', gap: 30, lv: 0 });
    if (close) {
      const vh = near.q ? cmdVehHelp(near.q.x, near.q.y, at) : null, ask = !acts.length ? cmdAsk(a.kx, a.ky) : '';
      chatSay('p', `补救：${vh ? `${typeof vehName === 'function' ? vehName(vh) + ' ' : '我坦克'}前出迎击；` : ''}${ask ? ask + '；' : ''}附近各连以集束手榴弹抵近攻击，不得以步兵正面硬拼。`, { kind: 'remedy', at, delay: 2.5, key: 'carfix', gap: 30 });
    }
  }
}
// 工兵任务（autopilot.js apEngineer 使用）：抢修被炸的桥
function cmdEngTasks() {
  if (!cmdOn() || !S.blown) return [];
  const C = S.cmd.p, out = [];
  for (const b of S.blown) if (b.prog < 1 && C.bridge[b.key]) out.push({ k: 'b' + b.key, kind: 'bridge', key: b.key, x: b.x, y: b.y, pri: .5 });
  return out;
}

// —— 装甲车辆（vehicles.js）：车辆自动驾驶自行伴随步兵攻击；坦克登陆舰由指挥官掌握出发时机（S.autoPlan.holdLST）——
function cmdVeh(C) {
  const P = S.autoPlan;
  if (!P) return;
  P.holdLST = S.ships.some(s => s.kind === 'lst' && alive(s) && cmdCtl(s) && C.ship[s.id] && !C.ship[s.id].rel && s.state === 'idle');
}
// 调一辆装甲车辆支援受阻的攻击：开到攻击组后方 60，40 秒后交还车辆自动驾驶
function cmdVehHelp(gx, gy, p) {
  if (!Array.isArray(S.veh)) return null;
  let best = null, bd = 650;
  for (const v of S.veh) {
    if (v.side !== 'p' || v.dead || v.immob || v.swim || v.lst || !cmdCtl(v) || (v.cmd && S.t < (v.cmd.until ?? 0))) continue;
    if (typeof VEH_SPEC === 'object' && VEH_SPEC[v.type] && !VEH_SPEC[v.type].gun) continue;
    if (v.hp < v.maxhp * .4) continue;
    const d = dist(v.x, v.y, gx, gy);
    if (d < bd) { bd = d; best = v; }
  }
  if (!best) return null;
  const a = Math.atan2(p.y - gy, p.x - gx);
  best.cmd = { t: 'move', x: Math.round(gx - Math.cos(a) * 60), y: Math.round(gy - Math.sin(a) * 60), face: a, until: S.t + 40 };
  return best;
}

// —— 危局：在岸兵力锐减、进展甚微 → 停止多路进攻，集中于一点，投入后备队 ——
function cmdCrisisP(C, P) {
  const now = cmdMen(cmdPInf());
  C.peak = Math.max(C.peak || 0, now);
  const ts = cmdPInf(), cx = ts.reduce((a, q) => a + q.x, 0) / Math.max(1, ts.length), cy = ts.reduce((a, q) => a + q.y, 0) / Math.max(1, ts.length);
  const pickT = () => {
    const a = C.ph === 'brk' && C.axis[0] ? cmdPt(C.axis[0]) : null;
    if (a && dist(a.x, a.y, cx, cy) <= 600) return a;
    return S.points.filter(p => !cmdOwned(p)).sort((a, b) => dist(a.x, a.y, cx, cy) / Math.sqrt(a.vp) - dist(b.x, b.y, cx, cy) / Math.sqrt(b.vp))[0] || null;
  };
  if (C.crisis) {
    if (C.crisis.key) { cmdCrisisStall(C, ts, cx, cy); return; }
    // 集中目标已夺取：态势好转则恢复多路发展，否则转向下一个目标
    if (vpShare() >= .3 || now >= C.peak * .6 || C.ph === 'cons') { C.crisis = null; chatSay('p', `判断：态势好转，在岸兵力 ${now} 人，据点分值 ${Math.round(vpShare() * 100)}%。决心：恢复多路发展。`, { kind: 'plan' }); return; }
    const nx = pickT();
    if (!nx) return;
    C.crisis.key = nx.key;
    chatSay('p', `命令：残余兵力继续集中使用，转向${nx.name}。`, { kind: 'order', at: nx });
    return;
  }
  if (S.t < 150 || now >= C.peak * .45 || vpShare() >= .3 || C.ph === 'cons') return;
  const tg = pickT();
  if (!tg) return;
  C.crisis = { t: S.t, key: tg.key };
  const lossPct = Math.round((1 - now / C.peak) * 100), at = { x: tg.x, y: tg.y };
  chatSay('p', `判断：${cmdHT()}，在岸兵力仅 ${now} 人，较峰值减少 ${lossPct}%，累计伤亡 ${S.stats.lost} 人；据点分值仅 ${Math.round(vpShare() * 100)}%，已无力多路进攻。`, { kind: 'plan', at });
  const rein = [];
  if (S.assets.reserve > 0 && !S.rlines.length) {
    const sh = S.ships.filter(o => o.state === 'beached' && o.bx != null).sort((a, b) => dist(a.bx, a.by, cx, cy) - dist(b.bx, b.by, cx, cy))[0];
    if (cmdAll() && sh && S.assets.rline > 0 && typeof buildRLine === 'function' && buildRLine(sh)) { S.rlines[S.rlines.length - 1].cmd = 1; rein.push(`开辟增援线，后备队 ${S.assets.reserve} 人经${cmdBN(cmdBeachOf(sh.bx, 200))}上陆补充`); }
    else if (!cmdAll() && sh) rein.push(`请求开辟增援线，后备队 ${S.assets.reserve} 人待命（增援线由您直接指挥）`);
  }
  chatSay('p', `决心：停止多路进攻，残余兵力集中于${tg.name}方向，夺取后再图发展${rein.length ? '；' + rein.join('；') : ''}。`, { kind: 'plan', at, delay: 1.5 });
}

// 危局集中目标 60 秒无进展：说明原因（无兵可用 / 弹药不足 / 火力未压制），先请火力，再次受阻则换目标或转入防御
function cmdCrisisStall(C, ts, cx, cy) {
  const cr = C.crisis, cp = cmdPt(cr.key);
  if (!cp) return;
  if (cr.pv == null || cp.prog > cr.pv + .05) { cr.pv = cp.prog; cr.pT = S.t; }
  if (S.t - cr.pT < 60 || S.t - (cr.sayT ?? -99) < 75 || S.t < (cr.waitT ?? 0)) return;
  cr.sayT = S.t; cr.n = (cr.n || 0) + 1;
  const near = ts.filter(q => dist(q.x, q.y, cp.x, cp.y) < 260), dry = ts.filter(q => q.ammo < 15);
  const why = !near.length ? '无兵可用，残余兵力未能展开到攻击位置' : dry.length >= Math.max(1, ts.length * .4) ? `弹药不足，${dry.length} 个小组弹药将尽` : `当面火力未被压制，${Math.round(S.t - cr.t)} 秒未能突入`;
  chatSay('p', `报告：集中攻击${cp.name}的兵力未能展开：${why}。`, { kind: 'friction', at: cp });
  const acts = [];
  if (dry.length) acts.push('弹药将尽的小组轮流后撤至补给点补充');
  if (cr.n === 1 && near.length && cmdFoeFire(cp)) acts.push(`舰炮先行压制${cp.name}当面火力点，压制后再攻`);
  else {
    const nx = S.points.filter(p => p !== cp && !cmdOwned(p)).sort((a, b) => dist(a.x, a.y, cx, cy) / Math.sqrt(a.vp) - dist(b.x, b.y, cx, cy) / Math.sqrt(b.vp))[0];
    if (nx && dist(nx.x, nx.y, cx, cy) < dist(cp.x, cp.y, cx, cy) * 1.3) { cr.key = nx.key; cr.t = S.t; cr.pv = null; cr.n = 0; acts.push(`放弃对${cp.name}的攻击，残余兵力转向较近的${nx.name}`); }
    else { cr.waitT = S.t + 150; acts.push(`残余兵力就地转入防御，${S.assets.reserve > 0 ? '等待后备队上陆后再攻' : '巩固已占据点'}`); }
  }
  chatSay('p', `补救：${acts.join('；')}。`, { kind: 'remedy', at: cp, delay: 2 });
}
// 弹药摩擦：连队因弹药将尽转入补给（autopilot apFallback 写 ph=supply / regroup）时报告
function cmdAmmoP(C, P) {
  C.ammo = C.ammo || {};
  for (const u of S.units) {
    const pl = u.side === 'p' && u.kind === 'inf' && cmdCtl(u) && P.u[u.id];
    if (!pl || (pl.ph !== 'supply' && pl.ph !== 'regroup')) { if (pl) C.ammo[u.id] = null; continue; }
    if (C.ammo[u.id] === pl.ph) continue;
    C.ammo[u.id] = pl.ph;
    const ts = teamsOf(u).filter(q => q.kind === 'inf'), am = ts.length ? ts.reduce((a, q) => a + q.ammo, 0) / ts.length : 60;
    if (am >= 15 || S.t - (C.ammoT ?? -99) < 20) continue;
    C.ammoT = S.t;
    const un = cmdUName(u);
    chatSay('p', `报告：${un}弹药将尽，攻击力减弱。`, { kind: 'friction', at: u, lv: 1 });
    chatSay('p', pl.ph === 'supply' && pl.sp ? `补救：${un}后撤至 ${gridRef(pl.sp.x, pl.sp.y)} 补给点补充弹药，补足后归建再攻。` : `补救：附近无接通的补给点，${un}就近隐蔽待补，工兵抢修补给线。`, { kind: 'remedy', at: pl.sp || u, delay: 2, lv: 1 });
  }
}
// —— 态势报告 ——
function cmdSitrep(C) {
  if (S.t < C.sitT) return;
  C.sitT = S.t + 150;
  const now = cmdMen(S.teams.filter(q => q.side === 'p')), own = S.points.filter(p => p.owner === 'p').length;
  chatSay('p', `报告：${cmdHT()}，我在岸兵力 ${now} 人，累计伤亡 ${S.stats.lost} 人；控制据点 ${own}/${S.points.length}（分值 ${Math.round(vpShare() * 100)}%），摧毁敌火力点 ${S.stats.structs} 处。`, { kind: 'report', lv: 1 });
}

// —— 增援线（logistics.js updateRLines 在放出增援艇前调用）：返回 true 表示本批推迟 ——
function cmdRLine(L) {
  if (!cmdOn() || !(cmdAll() || L.cmd)) return false;
  const C = S.cmd.p, B = TER.beaches[cmdBeachOf(L.bx, 100)];
  if (L.dbl && S.assets.reserve >= 6) {   // 补救：两艇并行出发，追回延误
    L.dbl = 0;
    const n = Math.min(3, S.assets.reserve);
    S.assets.reserve -= n;
    S.boats.push({ id: S.nid++, line: L.id, u: -.08, x: L.x0, y: L.y0, n });
    return false;
  }
  if (S.t - (C.rlT ?? -99) < 100 || Math.random() >= .2 * cmdRK()) return false;
  C.rlT = S.t;
  const n = Math.round(22 + Math.random() * 14);
  L.timer = n;
  chatSay('p', `报告：增援艇队在换乘区编队迟缓，下一批推迟约 ${n} 秒上陆${B ? B.name : ''}。`, { kind: 'friction', at: { x: L.x0, y: L.y0 } });
  cmdLater(5, 'rlFix', { line: L.id });
  return true;
}

// ———————————————— 敌方指挥官 ————————————————
// 守军观察到的登陆兵力：被看见的登陆艇（按驶向的滩头）+ 已上陆的小组
function cmdEObs() {
  const radar = typeof radarUp === 'function' ? radarUp() : null, o = TER.beaches.map(() => ({ men: 0, ships: 0, land: 0, held: 0 }));
  for (const s of S.ships) if (alive(s) && s.land && (s.state === 'move' || s.state === 'unloading') && shipSeen(s.x, s.y, radar)) {
    const bi = cmdBeachOf(s.bx ?? s.tx, 120);
    if (bi < 0) continue;
    o[bi].ships++; o[bi].men += s.load ? (s.load.teams || 0) * 3 + (s.load.eng || 0) : 0;
  }
  // 已上陆之敌按其登陆的滩头归属（守军跟踪各路登陆兵力；向纵深发展后仍算原方向）；无从判断的按所在扇区；已失守的据点计入就近滩头方向
  const from = {};
  for (const s of S.ships) if (s.bx != null && s.land) from[s.label] = cmdBeachOf(s.bx, 200);
  for (const q of S.teams) if (q.side === 'p' && q.men.length && spotted(q.x, q.y) && coastAt(q.x) - q.y < 1100) {
    const u = typeof unitOf === 'function' ? unitOf(q) : null, f = u && u.ship != null ? from[u.ship] : undefined;
    const bi = f != null && f >= 0 ? f : cmdBeachOf(q.x, 250);
    if (bi >= 0) { o[bi].men += q.men.length; o[bi].land += q.men.length; }
  }
  for (const p of S.points) if (p.owner === 'p') { const bi = cmdBeachOf(p.x, 400); if (bi >= 0) o[bi].held++; }
  return o;
}
const cmdIsHome = q => !!S.cmd && S.cmd.e.home[q.id] != null && q.obj === S.cmd.e.home[q.id];
// ai2.js 预备队调动时询问：这个组是否还被扣着（判明主攻方向前 / 迟出摩擦）
function cmdHeld(q) {
  if (!cmdOn() || q.role !== 'reserve' || !cmdIsHome(q)) return false;
  const E = S.cmd.e;
  if (E.rel[q.id]) return false;
  if (E.commit == null) return S.t < 75;   // 判明主攻方向之前不轻动（最多扣 75 秒）
  return (E.hold[q.obj] || 0) > S.t;
}
// ai2.js 威胁计算时的加权：判定的主攻方向加重、判定的佯动方向减轻、集中反击点加重
function cmdBias(k) { return cmdOn() && S.cmd.e.bias[k] != null ? S.cmd.e.bias[k] : 1; }

function cmdThinkE() {
  const E = S.cmd.e, F = CMD_FE[S.level] || CMD_FE.hard;
  if (!E.init) cmdEInit(E);
  const o = cmdEObs(), tot = o.reduce((a, x) => a + x.men, 0);
  // 守军对各方向兵力的估计：目视数为下限，记忆缓慢衰减（约 2 分钟减半），看不见不等于没有
  if (!Array.isArray(E.mem)) E.mem = [];
  o.forEach((x, i) => { E.mem[i] = Math.max(x.men, (E.mem[i] || 0) * .983); x.est = Math.round(E.mem[i]); });
  if (E.guess == null) {
    if (tot > 0 && E.seenT == null) {
      E.seenT = S.t;
      const list = o.map((x, i) => ({ i, ...x })).filter(x => x.ships > 0).sort((a, b) => b.ships - a.ships);
      if (list.length) chatSay('e', `报告：发现敌登陆艇 ${list.reduce((a, x) => a + x.ships, 0)} 艘，正驶向${list.slice(0, 3).map(x => cmdBN(x.i)).join('、')}。`, { kind: 'intel', at: cmdExit(list[0].i) });
    }
    if (E.seenT != null && ((S.t - E.seenT > 8 && tot >= 20) || S.t - E.seenT > 30)) cmdEIdentify(E, F, o);
    else if (E.seenT == null && S.t > 75 && E.commit == null) { E.commit = S.t; chatSay('e', '判断：敌登陆方向仍未判明。决心：预备队前出至公路枢纽，随时机动。', { kind: 'plan' }); }
  } else cmdECorrect(E, F, o);
  cmdEBias(E, o);
  cmdRun(cmdECounters, E);
  cmdRun(cmdEEvents, E, o);
}
function cmdEInit(E) {
  E.init = true;
  const towns = new Map();
  for (const q of S.teams) if (q.side === 'e' && q.role === 'reserve' && q.men.length && q.obj) { E.home[q.id] = q.obj; towns.set(q.obj, (towns.get(q.obj) || 0) + 1); }
  for (const q of S.teams) if (q.side === 'e' && q.role === 'ambush' && q.men.length) E.amb[q.id] = q.obj || 1;
  for (const p of S.points) E.own[p.key] = p.owner;
  E.waves = S.ai ? S.ai.waves : 0;
  const tn = [...towns.keys()].map(k => cmdPt(k)).filter(Boolean).map(p => `${p.name}（${towns.get(p.key)} 组）`);
  chatSay('e', `判断：敌舰队在南面集结海域展开，登陆方向尚不明确。决心：各滩守备就地抗登陆，预备队${tn.length ? '于' + tn.join('、') : ''}待命，判明敌主攻方向后实施反冲击。`, { kind: 'plan' });
}
// 判明主攻方向：可能把佯攻误判为主攻（理由取自真实数字，如离指挥所更近、率先上陆）
function cmdEIdentify(E, F, o) {
  const R = o.map((x, i) => ({ i, ...x })).filter(x => x.men > 0).sort((a, b) => b.men - a.men);
  if (!R.length) { E.seenT = S.t; return; }
  let g = R[0], why = '兵力最为集中';
  const hq = cmdPt('HQ'), dHQ = i => { const X = cmdExit(i); return hq ? Math.round(dist(X.x, X.y, hq.x, hq.y)) : 0; };
  if (R.length >= 2 && R[1].men >= Math.max(8, R[0].men * .4) && Math.random() < F.mis) {   // 兵力悬殊时不会看错
    g = R[1];
    if (hq && dHQ(g.i) < dHQ(R[0].i) - 60) why = `出口距指挥所仅 ${dHQ(g.i)} 米，威胁最大`;
    else if (g.land > 0 && R[0].land === 0) why = '已率先上陆';
    else why = g.ships >= 2 ? `登陆艇 ${g.ships} 艘编队密集，疑为敌主力` : '该方向登陆动作最为坚决，疑为敌主力';
  }
  E.guess = g.i; E.gT = S.t; E.commit = S.t;
  const main = S.cmd.p.plan ? S.cmd.p.plan.main : -1;
  E.wrong = main >= 0 && g.i !== main;
  const others = R.filter(x => x.i !== g.i).slice(0, 2), X = cmdExit(g.i);
  chatSay('e', `判断：${cmdBN(g.i)}之敌约 ${g.men} 人，${why}，判为敌主攻方向${others.length ? `；${others.map(x => `${cmdBN(x.i)}之敌约 ${x.men} 人`).join('、')}，判为牵制佯动` : ''}。`, { kind: 'plan', at: X });
  const towns = [...new Set(Object.values(E.home))].map(k => cmdPt(k)).filter(Boolean).sort((a, b) => dist(a.x, a.y, X.x, X.y) - dist(b.x, b.y, X.x, X.y));
  chatSay('e', `决心：${towns.length ? towns.map(p => p.name).join('、') + '预备队' : '预备队'}向${X.name}方向机动，准备反冲击；${others.length ? `${others.map(x => cmdBN(x.i)).join('、')}守备依托出口阵地阻击，伏击组按预案逐次退守出口` : '各滩守备就地阻击'}。`, { kind: 'plan', at: X, delay: 1.5 });
  // 摩擦：预备队迟出（离主攻方向最近的镇子）
  if (towns.length && Math.random() < F.late) {
    const tw = towns[0], n = Math.round(F.lateT * (.75 + Math.random() * .5));
    E.hold[tw.key] = +(S.t + n).toFixed(1);
    chatSay('e', `报告：${tw.name}预备队${pick(['车辆未到', '集结迟缓', '有线电话被炮火炸断'])}，出动推迟约 ${n} 秒。`, { kind: 'friction', at: tw, delay: 4 });
    cmdLater(10, 'eLate', { town: tw.key, other: towns[1] ? towns[1].key : null });
  }
}
// 误判纠正：另一滩头的敌人持续明显多于判定方向，或其出口失守
function cmdECorrect(E, F, o) {
  // 方向强度：目视兵力 + 已失守据点（每处折 6 人）；收缩固守指挥所后不再纠缠主攻方向
  const st = x => x.est + 6 * x.held, g = E.guess, R = o.map((x, i) => ({ i, ...x })).sort((a, b) => st(b) - st(a)), c = R[0];
  if (!c || c.i === g || E.last) { E.fixC = 0; return; }
  const X = cmdExit(c.i), lostX = !!X && X.owner === 'p', sg = st(o[g]), sc = st(c);
  // 判定方向的出口已被敌夺取：说明那里确是主攻之一，除非另一方向兵力远多于此
  const GX = cmdExit(g), gLost = !!GX && GX.owner === 'p';
  if (S.t - E.gT < 45 || c.est < 12 || (E.fixN || 0) >= 2 || (gLost && sc < Math.max(sg, 8) * Math.max(1.8, F.fix))) { E.fixC = 0; return; }
  if (sc >= sg * F.fix) E.fixC += 3; else E.fixC = Math.max(0, E.fixC - 3);
  if (E.fixC < F.fixT && !(lostX && c.est >= 15 && sc > sg * 1.5)) return;
  const was = g;
  E.guess = c.i; E.gT = S.t; E.fixC = 0; E.fixN = (E.fixN || 0) + 1;
  const main = S.cmd.p.plan ? S.cmd.p.plan.main : -1;
  E.wrong = main >= 0 && c.i !== main;
  chatSay('e', `判断修正：${cmdBN(was)}${o[was].est ? `之敌仅约 ${o[was].est} 人，攻势有限` : o[was].held ? '方向之敌已无后续兵力，攻势成强弩之末' : '已不见敌兵力活动，原判主攻实为佯动'}；${cmdBN(c.i)}已上陆约 ${c.est} 人${lostX ? `并夺取${X.name}` : ''}，确认为敌主攻方向。`, { kind: 'plan', at: X });
  // 从原判定方向抽调守备加强
  const W0 = cmdExit(was), mv = S.teams.filter(q => q.side === 'e' && q.men.length > 1 && q.role === 'garrison' && W0 && dist(q.x, q.y, W0.x, W0.y) < 260 && (!q.order || q.order.t !== 'amove'))
    .sort((a, b) => dist(a.x, a.y, X.x, X.y) - dist(b.x, b.y, X.x, X.y)).slice(0, 2);
  if (X.key) for (const q of mv) Object.assign(q, { obj: X.key, role: 'reserve', px: null, u: aiUnitFor(X.key).id });
  if (mv.length) indexUnits();
  for (const k in E.hold) E.hold[k] = 0;
  // 原判方向上尚在集结的反冲击取消；已发起的照常进行（说明，免得与「全部转向」矛盾）
  const ca = [];
  for (const k in E.ca) {
    const a = E.ca[k], p = cmdPt(k);
    if (!p || a.end || !W0 || dist(p.x, p.y, W0.x, W0.y) > 350) continue;
    if (a.st === 'mass') { a.end = S.t; ca.push(`取消对${p.name}的集中反冲击`); } else ca.push(`${p.name}方向已发起的反击照常进行`);
  }
  chatSay('e', `决心：预备队全部转向${cmdBN(c.i)}${mv.length ? `，${cmdBN(was)}守备抽调 ${mv.length} 组加强` : ''}${ca.length ? '；' + ca.join('；') : ''}。`, { kind: 'plan', at: X, delay: 1.5 });
}
function cmdEBias(E, o) {
  const B = {};
  if (E.guess != null) {
    const G = cmdExit(E.guess);
    for (const p of S.points) {
      let b = 1;
      if (dist(p.x, p.y, G.x, G.y) < 450) b = 1.8;
      else if (o.some((x, i) => i !== E.guess && x.men >= 6 && dist(p.x, p.y, cmdExit(i).x, cmdExit(i).y) < 300)) b = .6;
      if (b !== 1) B[p.key] = b;
    }
  }
  if (E.mass && cmdPt(E.mass.key)) B[E.mass.key] = (B[E.mass.key] || 1) * 1.8;
  if (E.last) B.HQ = (B.HQ || 1) * 2;
  E.bias = B;
}
// ai2.js 反冲击前询问：返回实际投入的组（逐次投入时只有一部分；集中兵力时暂不出击）
function cmdCounter(p, mine, men, I) {
  if (!cmdOn()) return null;
  const E = S.cmd.e, F = CMD_FE[S.level] || CMD_FE.hard;
  let c = E.ca[p.key];
  if (c && c.end && S.t - c.end < 20) return [];
  if (!c || c.end) {
    const piece = mine.length >= 2 && Math.random() < F.piece;
    const ids = piece ? mine.slice().sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y)).slice(0, Math.max(1, Math.floor(mine.length / 2))).map(q => q.id) : null;
    c = E.ca[p.key] = { t: S.t, ids, men0: ids ? cmdMen(mine.filter(q => ids.includes(q.id))) : men, near0: I.near, piece, st: 'go' };
    chatSay('e', `命令：${p.name}方向 ${mine.length} 组（约 ${men} 人）${p.owner === 'p' ? '立即反冲击，夺回阵地！' : '立即反击，将突入之敌逐出阵地！'}`, { kind: 'order', at: p, key: 'ca' + p.key, gap: 30, lv: p.vp >= 2 ? 1 : 2 });   // 阵地仍在手里时不说「夺回」
  }
  if (c.st === 'mass') {
    const ready = (men >= Math.max(8, I.near * aiD().ratio * 1.4) && S.t - c.mT > 12) || S.t - c.mT > 45;
    if (!ready) return [];
    Object.assign(c, { st: 'go2', t: S.t, ids: null, men0: men });
    chatSay('e', `命令：兵力已集中（${mine.length} 组 ${men} 人），炮火准备后统一向${p.name}反冲击。`, { kind: 'order', at: p, lv: 0 });
    return mine;
  }
  return c.ids ? mine.filter(q => c.ids.includes(q.id)) : mine;
}
function cmdECounters(E) {
  for (const k in E.ca) {
    const c = E.ca[k], p = cmdPt(k);
    if (!p) { delete E.ca[k]; continue; }
    if (c.end) { if (S.t - c.end > 60) delete E.ca[k]; continue; }
    if (p.owner === 'e' && p.prog < .3) {
      c.end = S.t;
      if (E.mass && E.mass.key === k) E.mass = null;
      chatSay('e', `报告：反冲击得手，已夺回${p.name}。`, { kind: 'report', at: p, lv: p.vp >= 2 ? 0 : 1 });
      continue;
    }
    const att = S.teams.filter(q => q.side === 'e' && q.obj === k && q.men.length && (!c.ids || c.ids.includes(q.id)));
    const lostN = Math.max(0, c.men0 - cmdMen(att)), broke = att.every(q => q.order.t === 'retreat' || (unitOf(q) && unitOf(q).state === 'rout'));
    if (c.st === 'go' && c.piece && S.t - c.t > 14 && (lostN >= c.men0 * .35 || broke)) {
      c.st = 'mass'; c.mT = S.t;
      E.mass = { key: k, t: S.t };
      chatSay('e', `报告：对${p.name}的反冲击各组未能协同，逐次投入，${lostN ? `已伤亡 ${lostN} 人，攻击受挫` : '遭敌火力压制被迫后撤'}。`, { kind: 'friction', at: p });
      chatSay('e', `补救：停止逐次反击，残部就地隐蔽；向${p.name}集中预备队，待兵力与炮火到位后统一反冲击。`, { kind: 'remedy', at: p, delay: 4 });
    } else if (c.st !== 'mass' && S.t - c.t > 45 && p.owner === 'p' && (lostN >= c.men0 * .5 || broke)) {
      c.end = S.t; E.fails++;
      if (E.mass && E.mass.key === k) E.mass = null;
      chatSay('e', lostN ? `报告：向${p.name}反冲击失利，伤亡 ${lostN} 人，残部撤回二线阵地。` : `报告：向${p.name}反冲击受敌火力压制，未能接近，各组撤回二线阵地。`, { kind: 'report', at: p, lv: 1 });
    } else if (S.t - c.t > 120) { c.end = S.t; if (E.mass && E.mass.key === k) E.mass = null; }
  }
}
// 守军其他行动的叙述：据点得失、炸桥、袭扰、装甲车、炮兵、增援、伏击组后撤、收缩防线
function cmdEEvents(E, o) {
  for (const p of S.points) {
    const was = E.own[p.key] || 'e', now = p.owner;
    if (was === now) continue;
    E.own[p.key] = now;
    if (now === 'p') chatSay('e', `报告：${p.name}失守。`, { kind: 'report', at: p, lv: p.vp >= 2 ? 1 : 2 });
  }
  const lostV = S.points.filter(p => p.owner === 'p').reduce((a, p) => a + p.vp, 0) / Math.max(1, S.points.reduce((a, p) => a + p.vp, 0));
  if (!E.last && lostV >= .45) {
    E.last = true;
    const hq = cmdPt('HQ'), gone = hq && hq.owner === 'p';   // 指挥所已失：决心改为反击夺回，不再「固守」
    chatSay('e', `判断：敌已突入纵深，${gone ? '指挥所失守，' : ''}我已失去 ${Math.round(lostV * 100)}% 据点分值，各据点被分割。决心：${gone ? '集中残部与增援梯队反击，夺回指挥所；其余据点就地坚守，炸毁桥梁迟滞敌军' : '收缩兵力固守指挥所，炸毁桥梁迟滞敌军'}。`, { kind: 'plan', at: hq });
  }
  // 炸桥
  for (const b of S.blown || []) if (!E.roll[b.key]) {
    E.roll[b.key] = 'blown';
    chatSay('e', `命令：工兵炸毁${b.name}，迟滞敌军向纵深发展。`, { kind: 'order', at: b, lv: 0 });
  }
  if (S.a3 && S.a3.roll) for (const k in S.a3.roll) if (S.a3.roll[k] === 0 && !E.roll[k]) {
    E.roll[k] = 'fail';
    const p = cmdPt(k);
    if (!p) continue;
    chatSay('e', `报告：${p.name}爆破失败，导火索被炮火炸断。`, { kind: 'friction', at: p });
    chatSay('e', `补救：桥头守备就地死守，工兵冒火重新装药。`, { kind: 'remedy', at: p, delay: 3 });
    cmdLater(40 + Math.random() * 20, 'reblow', { key: k });
  }
  // 袭扰
  for (const r of S.raids || []) if (!E.raids[r.id]) {
    E.raids[r.id] = 1;
    chatSay('e', `命令：抽调 ${r.teams.length} 组组成袭扰分队，渗透破袭敌${CMD_RAID[r.kind] || '后方'}（${gridRef(r.tx, r.ty)}）。`, { kind: 'order', at: { x: r.tx, y: r.ty }, lv: 1 });
  }
  // 装甲车
  const going = (S.armor || []).filter(a => !a.dead && a.mode === 'go' && a.order && a.order.k && E.cars[a.id] !== a.order.k), grp = {};
  for (const a of going) { E.cars[a.id] = a.order.k; const g = a.home + '>' + a.order.k; (grp[g] = grp[g] || []).push(a); }
  for (const g in grp) {
    const a = grp[g][0], p = cmdPt(a.order.k), home = cmdPt(a.home), n = grp[g].length;
    chatSay('e', `命令：装甲车${n > 1 ? ` ${n} 辆` : ''}自${home ? home.name : '后方'}出动，支援${p ? p.name : '前沿'}方向${p && p.owner === 'p' ? '反冲击' : '防御'}。`, { kind: 'order', at: a, key: 'car' + g, gap: 40, lv: 1 });
  }
  if (Array.isArray(S.veh)) {
    const ev = S.veh.filter(v => v.side === 'e' && !v.dead && v.order && v.order.t && v.order.t !== 'hold');
    if (ev.length && !E.evMove) { E.evMove = 1; chatSay('e', `命令：坦克预备队 ${ev.length} 辆出击，配合步兵反冲击。`, { kind: 'order', at: ev[0], lv: 1 }); }
  }
  // 炮兵：统计炮弹落区，定期通报火力重心
  for (const sh of S.shells) if (sh.side === 'e' && (sh.kind === 'arty' || sh.kind === 'mortar' || sh.kind === 'coastal') && sh.t < .5) {
    const w = coastAt(sh.x1) - sh.y1 < 160 && cmdBeachOf(sh.x1, 120) >= 0 ? cmdBN(cmdBeachOf(sh.x1, 120)) + '滩头' : sh.y1 > coastAt(sh.x1) ? '登陆艇航道' : cmdWhere(sh.x1, sh.y1);
    E.art[w] = (E.art[w] || 0) + 1;
  }
  if (S.t >= E.artT) {
    E.artT = S.t + 45;
    const ks = Object.keys(E.art).sort((a, b) => E.art[b] - E.art[a]), n = ks.reduce((a, k) => a + E.art[k], 0);
    if (n >= 3) chatSay('e', `命令：炮兵集中火力于${ks[0]}${ks[1] && E.art[ks[1]] >= 2 ? `，以一部火力封锁${ks[1]}` : ''}。`, { kind: 'order', lv: 2, at: null });
    E.art = {};
  }
  // 增援梯队
  if (S.ai && S.ai.waves > E.waves) {
    E.waves = S.ai.waves;
    const p = S.points.filter(p => p.owner === 'p').sort((a, b) => b.vp - a.vp)[0] || cmdPt('HQ');
    chatSay('e', `报告：北部增援 ${aiD().waveSize} 组已投入，开赴${p ? p.name : '前沿'}。`, { kind: 'report', at: p, lv: 1 });
  }
  // 伏击组后撤（ai2.js 把被压倒的伏击组改为守备并退向出口据点）
  const back = {};
  for (const id in E.amb) {
    const q = S.teams.find(t => t.id === +id);
    if (!q || !q.men.length) { delete E.amb[id]; continue; }
    if (q.role !== 'ambush') { const bi = cmdBeachOf(q.x, 200); back[bi] = (back[bi] || 0) + 1; delete E.amb[id]; }
  }
  for (const bi in back) if (+bi >= 0) chatSay('e', `命令：${cmdBN(+bi)}伏击组 ${back[bi]} 组边打边撤，退守${cmdExit(+bi).name}。`, { kind: 'order', at: cmdExit(+bi), lv: 2, key: 'amb' + bi, gap: 30 });
}

// ———————————————— 延时动作 ————————————————
const CMD_ACT = {
  // 命令到达连队（可能已丢失：传令兵失踪 → 任务式指挥）
  order(a) {
    const u = UNIT_MAP.get(a.uid);
    if (!u || !teamsOf(u).length || u.state === 'rout') return;
    const un = cmdUName(u), P = S.autoPlan;
    if (a.lost) {
      const p = cmdPt(a.key);
      chatSay('p', `报告：派往${un}的传令兵途中失踪，命令未能送达。`, { kind: 'friction', at: u });
      if (p) { S.cmd.p.mission[u.id] = p.key; chatSay('p', `补救：${un}依任务式指挥行动，按既定意图自行向${p.name}攻击；后续命令经邻近连队电台转达。`, { kind: 'remedy', at: u, delay: 2 }); }
      return;
    }
    if (!P || typeof apTask !== 'function') return;
    if (a.runner) chatSay('p', `报告：传令兵已将命令送达${un}。`, { kind: 'report', at: u, lv: 2 });
    if (a.act === 'task') apTask(u, a.key);
    else if (a.act === 'flank') apTask(u, a.key, a.side || 1);
    else if (a.act === 'urge') {
      const pl = P.u[u.id], p = cmdPt(a.key);
      delete S.cmd.p.halt[u.id];
      if (!pl || !p) return;
      pl.halt = null;
      u.morale = Math.min(100, (u.morale || 50) + 8);
      if (!cmdOwned(p) && typeof apLaunch === 'function') apLaunch([u], p, P);
    } else if (a.act === 'icpt' && typeof apIntercept === 'function') apIntercept(u, a.raid);
  },
  // 偏航登陆后的补救：就地夺取当面出口或向主力靠拢；后续舰艇修正航线
  drift(a) {
    const C = S.cmd.p, s = S.ships.find(o => o.id === a.sid), main = C.plan.main;
    C.navFix = S.t;
    const u = s && S.units.find(o => o.side === 'p' && o.kind === 'inf' && o.ship === s.label && teamsOf(o).length);
    const tg = cmdPt(C.focus) || cmdExit(main);
    if (!u || !cmdCtl(u)) { chatSay('p', '补救：后续舰艇以浮标重新标定航线，减速靠岸。', { kind: 'remedy', at: s }); return; }
    const un = cmdUName(u);
    if (a.adj) {
      const X = cmdExit(a.ai), est = X && X.key ? Math.round(apEstimate(X, true)) : 99, wing = TER.beaches[a.ai].cx < TER.beaches[main].cx ? '西' : '东';
      if (X && X.key && !cmdOwned(X) && est < 6) {
        cmdSend(u, 'task', { key: X.key });
        chatSay('p', `补救：令${un}就地夺取${X.name}（${est ? `目视守军约 ${est} 人` : '当面未见守军'}），尔后向${cmdBN(main)}靠拢，掩护主攻${wing}翼；后续舰艇以浮标重新标定航线。`, { kind: 'remedy', at: u });
      } else if (tg && tg.key) {
        cmdSend(u, 'task', { key: tg.key });
        chatSay('p', `补救：${X ? X.name : '当面'}守备较强${est < 99 ? `（约 ${est} 人）` : ''}，令${un}不得孤立攻击，沿海岸向${cmdBN(main)}机动，加入${tg.name}方向攻击。`, { kind: 'remedy', at: u });
      }
    } else if (tg && tg.key) {
      cmdSend(u, 'task', { key: tg.key });
      chatSay('p', `补救：令${un}向${tg.name}方向收拢，与主力衔接；后续舰艇以浮标重新标定航线。`, { kind: 'remedy', at: u });
    }
  },
  // 后续梯队迟滞的补救：抢修缩短延误；观战时可开辟增援线投入后备队
  late(a) {
    const C = S.cmd.p, s = S.ships.find(o => o.id === a.sid), t = s && C.ship[s.id];
    if (!s || !alive(s) || !t) return;
    const acts = [];
    const others = cmdShipsOf(C, 'w2').filter(o => o !== s && C.ship[o.id].rel);
    if (others.length) acts.push(`${cmdLabels(others)}按时先行`);
    if (t.late && t.late > S.t) { t.late = +(S.t + (t.late - S.t) * .45).toFixed(1); acts.push(`${s.label}损管抢修，约 ${Math.round(t.late - S.t)} 秒后单独跟进`); }
    if (cmdAll() && S.assets.rline > 0 && S.assets.reserve > 0 && typeof buildRLine === 'function') {
      const sh = S.ships.filter(o => o.state === 'beached' && cmdBeachOf(o.bx, 80) === a.b && !S.rlines.some(l => l.ship === o.id))[0];
      if (sh && buildRLine(sh)) { const L = S.rlines[S.rlines.length - 1]; L.cmd = 1; acts.push(`开辟增援线，后备队经${cmdBN(a.b)}上陆补充兵力`); }
    }
    if (acts.length) chatSay('p', `补救：${acts.join('；')}。`, { kind: 'remedy', at: s });
  },
  rlFix(a) {
    const L = S.rlines.find(l => l.id === a.line);
    if (!L || S.assets.reserve < 6) return;
    L.dbl = 1;
    chatSay('p', '补救：后续批次改为两艇并行出发，追回延误。', { kind: 'remedy', at: { x: L.x0, y: L.y0 } });
  },
  // 预备队迟出的补救：已集结的一半先行出动
  eLate(a) {
    const E = S.cmd.e, tw = cmdPt(a.town);
    if (!tw || !((E.hold[a.town] || 0) > S.t)) return;
    const ts = S.teams.filter(q => q.side === 'e' && q.men.length && cmdIsHome(q) && q.obj === a.town);
    const go = ts.slice(0, Math.ceil(ts.length / 2));
    for (const q of go) E.rel[q.id] = 1;
    const ot = a.other ? cmdPt(a.other) : null;
    chatSay('e', `补救：${tw.name}预备队已集结的 ${go.length} 组先行出动，其余随后跟进${ot ? `；${ot.name}预备队就近加强` : ''}。`, { kind: 'remedy', at: tw });
    if (ot) E.hold[ot.key] = 0;
  },
  // 炸桥失败：重新装药，允许 ai3.js 再判定一次
  reblow(a) {
    const p = cmdPt(a.key);
    if (!p || p.owner !== 'e' || !S.a3 || !S.a3.roll || S.a3.roll[a.key] !== 0) return;
    delete S.a3.roll[a.key];
    S.cmd.e.roll[a.key] = null;
  }
};

// ———————————————— 计划图形（只用图形，不写字）————————————————
// 主攻方向粗半透明绿箭头、佯攻虚线箭头、调整线短横、当前重点目标脉动圈；敌预备队红箭头（观战或已看见时）
function cmdArrow(ctx, pts, w) {
  if (pts.length < 2) return;
  const L = [], R2 = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const hw = w * .5;
    L.push([pts[i][0] - Math.sin(ang) * hw, pts[i][1] + Math.cos(ang) * hw]); R2.push([pts[i][0] + Math.sin(ang) * hw, pts[i][1] - Math.cos(ang) * hw]);
  }
  const n = pts.length - 1, a = Math.atan2(pts[n][1] - pts[n - 1][1], pts[n][0] - pts[n - 1][0]), hx = pts[n][0] + Math.cos(a) * w * 1.3, hy = pts[n][1] + Math.sin(a) * w * 1.3;
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i <= n; i++) ctx.lineTo(L[i][0], L[i][1]);
  ctx.lineTo(pts[n][0] - Math.sin(a) * w * 1.05, pts[n][1] + Math.cos(a) * w * 1.05);
  ctx.lineTo(hx, hy);
  ctx.lineTo(pts[n][0] + Math.sin(a) * w * 1.05, pts[n][1] - Math.cos(a) * w * 1.05);
  for (let i = n; i >= 0; i--) ctx.lineTo(R2[i][0], R2[i][1]);
  ctx.closePath();
}
function cmdDraw(time) {
  if (!S || !S.cmd || S.phase !== 'battle' || typeof R === 'undefined' || !R.ctx) return;
  const C = S.cmd.p, E = S.cmd.e, pl = C.plan;
  const zr = typeof CAM === 'object' && CAM.fit ? CAM.z / CAM.fit : 1, fade = clamp((4 - zr) / 2.5, 0, 1);
  if (fade <= 0) return;
  const ctx = R.ctx;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (pl && pl.main >= 0 && cmdHasP()) {
    const M = cmdExit(pl.main), b = TER.beaches[pl.main], sy = Math.min(STAGING_Y + 20, coastAt(b.cx) + 420);
    const route = [[b.cx, sy], [b.cx, coastAt(b.cx) + 40], [M.x, M.y]];
    if (C.ph === 'brk' || C.ph === 'cons') for (const k of C.axis.slice(0, 2)) { const p = cmdPt(k); if (p) route.push([p.x, p.y + (k === C.axis[C.axis.length - 1] ? 40 : 0)]); }
    else { const p = cmdAxis(M)[0]; if (p && cmdPt(p)) route.push([lerp(M.x, cmdPt(p).x, .45), lerp(M.y, cmdPt(p).y, .45)]); }
    const w = Math.max(30, px(12));
    ctx.fillStyle = rgba(COL.g, .09 * fade); ctx.strokeStyle = rgba(COL.g, .36 * fade); ctx.lineWidth = px(1.2);
    cmdArrow(ctx, route, w); ctx.fill(); ctx.stroke();
    // 调整线：滩头出口与下一目标前的短横
    ctx.strokeStyle = rgba(COL.g, .45 * fade); ctx.lineWidth = px(1.4);
    for (let i = 2; i < route.length; i++) {
      const [x0, y0] = route[i - 1], [x1, y1] = route[i], a = Math.atan2(y1 - y0, x1 - x0), hl = w * 1.15;
      const cx = lerp(x0, x1, .82), cy = lerp(y0, y1, .82);
      ctx.beginPath(); ctx.moveTo(cx - Math.sin(a) * hl, cy + Math.cos(a) * hl); ctx.lineTo(cx + Math.sin(a) * hl, cy - Math.cos(a) * hl); ctx.stroke();
    }
    if (pl.feint >= 0) {
      const F = cmdExit(pl.feint), fb = TER.beaches[pl.feint];
      ctx.strokeStyle = rgba(COL.g, .3 * fade); ctx.lineWidth = px(1.1); ctx.setLineDash([px(6), px(5)]);
      cmdArrow(ctx, [[fb.cx, sy], [fb.cx, coastAt(fb.cx) + 30], [F.x, F.y + 10]], w * .55); ctx.stroke(); ctx.setLineDash([]);
    }
    const fp = cmdPt(C.focus);
    if (fp) {   // 重点目标：脉动细圈
      const k = .5 + .5 * Math.sin(time * 3);
      ctx.strokeStyle = rgba(COL.g, (.25 + .3 * k) * fade); ctx.lineWidth = px(1.3);
      ctx.beginPath(); ctx.arc(fp.x, fp.y, 66 + k * 6, 0, 6.283); ctx.stroke();
    }
  }
  // 敌预备队机动：观战，或我方看见了正在机动的预备队
  const tgt = E.mass ? cmdPt(E.mass.key) : E.guess != null ? cmdExit(E.guess) : null;
  if (tgt) {
    const mv = S.teams.filter(q => q.side === 'e' && q.men.length && q.role === 'reserve' && q.order && q.order.t !== 'hold' && q.order.gx != null && dist(q.order.gx, q.order.gy, tgt.x, tgt.y) < 120);
    if (mv.length && (cmdAll() || mv.some(q => inVision(q.x, q.y)))) {
      const cx = mv.reduce((a, q) => a + q.x, 0) / mv.length, cy = mv.reduce((a, q) => a + q.y, 0) / mv.length;
      if (dist(cx, cy, tgt.x, tgt.y) > 90) {
        const ex = lerp(cx, tgt.x, .85), ey = lerp(cy, tgt.y, .85);
        ctx.fillStyle = rgba(COL.enemy, .06 * fade); ctx.strokeStyle = rgba(COL.enemy, .34 * fade); ctx.lineWidth = px(1.1);
        cmdArrow(ctx, [[cx, cy], [lerp(cx, ex, .5) + (ey - cy) * .08, lerp(cy, ey, .5) - (ex - cx) * .08], [ex, ey]], Math.max(16, px(8))); ctx.fill(); ctx.stroke();
      }
    }
  }
  ctx.restore();
}

HOOK.newGame.push(() => { if (S) { S.cmd = null; S.chat = []; S.chatK = {}; cmdInit(); } });
HOOK.step.push(updateCommander);
HOOK.drawUnder.push(cmdDraw);
// 我方炮弹 / 航弹落在我军附近：危险近距，停止射击并延伸诸元
HOOK.impact.push((x, y, R0, pw, side) => {
  if (!cmdOn() || side !== 'p' || typeof POWER !== 'object') return;
  const naval = pw === POWER.naval, bomb = pw === POWER.bomb;
  if (!naval && !bomb) return;
  if (naval ? !cmdCtl(S.dd) : !(S.cv && cmdCtl(S.cv))) return;
  const nb = cmdNearP(x, y), C = S.cmd.p;
  if (!nb.q || nb.d > R0 * 1.25 || S.t - C.dcT < 45) return;
  C.dcT = S.t;
  const u = unitOf(nb.q), un = u ? cmdUName(u) : teamName(nb.q);
  chatSay('p', `报告：${naval ? '舰炮' : '空袭'}弹着偏近，落在${un}阵地 ${Math.round(nb.d)} 米处！`, { kind: 'friction', at: { x, y } });
  if (naval) {
    C.cf = S.t + 10; C.safe = 110; C.safeT = S.t + 150;
    chatSay('p', '补救：舰炮停止射击！诸元向敌纵深延伸 100 米，10 秒后恢复射击，危险近距内的目标改由步兵火力解决。', { kind: 'remedy', at: { x, y }, delay: 2 });
  } else {
    C.airSafe = 150; C.airSafeT = S.t + 150;
    chatSay('p', '补救：暂停近距空袭，攻击机投弹安全距离加大至 150 米，近距目标改由舰炮与迫击炮压制。', { kind: 'remedy', at: { x, y }, delay: 2 });
  }
});
