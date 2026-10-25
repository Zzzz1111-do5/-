'use strict';
// 战役指挥（真 AI，双方的团长 / 旅长这一层）：只用本方看得见、记得住的敌情，决定兵往哪里调、编成什么、去干什么；
// 怎么走、怎么展开、怎么保持队形交给战斗群控制器（orbat.js，固定机制）
// ① 敌情判断（brIntel）：记住 90 秒内看见过的敌步兵与车辆的最后位置（再看那里已经没有了就划掉），相距 260 以内的连成一个敌集团，
//    兵力按每人 1、坦克 6、其余车辆 3 估算，看不全的部分按 1.2 倍补；主攻集团取最强的一股——守方以指挥官（commander.js）判定的主攻方向为准，
//    实际兵力悬殊（两倍以上）时以实情为准；有记忆，新的一股不比原主攻强三成以上不改判，不来回跳
// ② 兵力账（brPoolE）：据点威胁 = 各敌集团兵力 × 距离衰减（800 以外为 0）；威胁低于 2、550 以内没见过敌人的为平静地域，
//    其守备、伏击组与空闲的预备队除每处留一个警戒组（指挥所两个）外都可以抽；车辆抽空闲、没在交战的
// ③ 编组（brFormE）：同一地域（520 以内，凑不够放宽到 900）抽出的兵编成合成战斗群——步兵每 3 组一个连，一个连为加强连、两三个连为营、
//    四个连以上为团；配坦克 / 步战车 / 反坦克车、防空车、自行火炮（原来配属给这些连的坦克随连一起走）；缺反坦克、防空的从别处补
//    （没有防空车就带毒刺组，再没有就请战斗机在其上空巡逻，airwar.js awCapBG）；7 组以上抽一个组当侦察组前出；
//    步兵抽不够而空闲坦克 / 战车有 4 辆以上时编装甲特遣营（brFormArmorE）；交战斗群控制器成建制集合、行军、展开，不三三两两地走
// ④ 任务（brMissionE）：据点失守、兵力有对面 1.3 倍以上 → 反冲击夺回；否则加强受威胁最大的据点（在它前方占领阵地）；
//    复盘（每 6 秒）：任务方向平静 60 秒而别处吃紧 → 转用；任务据点失守而兵力不足 → 改到附近据点阻击；伤亡过六成 → 残部转入就近据点防御；
//    决心不轻改——转用后 45 秒内、离任务据点 600 以外都不改（兵力只有对面一半除外），不来回调头
// 接口：ai4 a4Draw 在守方大脑开着时不再另行抽调（brOn）；ai4 a4Focus 没有反冲击火力任务时给交战中的战斗群火力支援（brFocus）
// 状态（纯 JSON）：S.br = { e: { mem: {id: [x, y, 兵力, t]}, cl: [敌集团], main: [x, y, 兵力], n 已编组数, formT, thT, log: [] } }
const BR = { think: 6, start: 45, memT: 90, link: 260, fog: 1.2, thrR: 800, quiet: 2, quietR: 550, area: 520, area2: 900, minTeams: 5, minMen: 12, maxTeams: 12,
  maxG: 5, gap: 30, recAt: 7, ca: 1.3, block: .8, retask: 60, firm: 45, weak: .4, relP: 60 };
const BR_ECH = { I: ['连（加强）', '连长'], II: ['营', '营长'], III: ['团', '团长'], X: ['旅', '旅长'] };   // 编制记号 → 番号后缀、指挥员（一个连为加强连，两三个连为营，四个连以上为团）
const brOn = side => !!S && !(S.v7off && S.v7off.br) && (side !== 'e' || (typeof a4On === 'function' && a4On()));
const brB = side => { if (!S.br) S.br = {}; return S.br[side] || (S.br[side] = { mem: {}, cl: [], main: null, n: 0, formT: -99, thT: 3, log: [] }); };
const brVis = side => side === 'e' ? spotted : inVision;
const brLog = (B, t) => { B.log.push(Math.round(S.t) + ' ' + t); if (B.log.length > 30) B.log.shift(); };
const brMen = ts => ts.reduce((a, q) => a + q.men.length, 0);
const brIsAA = v => !!(vehSp(v).aa || (v.mod && v.mod.cram)) || v.type === 'sam_veh' || v.type === 'aa_veh';
const brTAA = q => q.men.includes('aa') || q.sbxTag === 'manpads';
const brTAT = q => !!(q.mod && q.mod.at) || q.men.includes('at') || q.men.includes('jav');
const brWhere = (x, y) => typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);

// —— ① 敌情判断 ——
function brIntel(B, side) {
  const vis = brVis(side), M = B.mem;
  for (const q of S.teams) if (q.side !== side && q.men.length && !q.ride && isLand(q.x, q.y) && vis(q.x, q.y)) M['t' + q.id] = [Math.round(q.x), Math.round(q.y), q.men.length, S.t];
  for (const v of S.veh || []) if (v.side !== side && !v.dead && !v.lst && isLand(v.x, v.y) && vis(v.x, v.y)) M['v' + v.id] = [Math.round(v.x), Math.round(v.y), BG_TANK.includes(v.type) ? 6 : 3, S.t];
  for (const k in M) { const m = M[k]; if (S.t - m[3] > BR.memT || (m[3] < S.t && vis(m[0], m[1]))) delete M[k]; }   // 过期，或再看那里已经没有了
  // 连成集团（并查集，相距 260 以内同属一股）；旧情报打折
  const P = Object.values(M).map(m => ({ x: m[0], y: m[1], n: m[2] * (1 - (S.t - m[3]) / BR.memT * .4) }));
  const par = P.map((_, i) => i), f = i => par[i] === i ? i : (par[i] = f(par[i]));
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) if (dist(P[i].x, P[i].y, P[j].x, P[j].y) < BR.link) par[f(i)] = f(j);
  const cl = new Map();
  P.forEach((p, i) => { const r = f(i), c = cl.get(r) || { x: 0, y: 0, n: 0, k: 0 }; c.x += p.x * p.n; c.y += p.y * p.n; c.n += p.n; c.k++; cl.set(r, c); });
  B.cl = [...cl.values()].filter(c => c.n > 0).map(c => ({ x: Math.round(c.x / c.n), y: Math.round(c.y / c.n), n: Math.round(c.n * BR.fog), k: c.k })).sort((a, b) => b.n - a.n);
  let K = B.cl[0] || null;
  if (side === 'e' && typeof cmdOn === 'function' && cmdOn() && S.cmd.e && S.cmd.e.guess != null) {
    const X = cmdExit(S.cmd.e.guess), c = X && B.cl.find(o => dist(o.x, o.y, X.x, X.y) < 700);
    if (c && (!K || K.n < c.n * 2)) K = c;
  }
  if (B.main && K) { const o = B.cl.find(c => dist(c.x, c.y, B.main[0], B.main[1]) < 300); if (o && o !== K && K.n < o.n * 1.3) K = o; }
  B.main = K ? [K.x, K.y, K.n] : null;
  return K;
}
const brThr = (B, x, y) => B.cl.reduce((a, c) => a + c.n * Math.max(0, 1 - dist(c.x, c.y, x, y) / BR.thrR), 0);
const brNear = (B, x, y, r) => Object.values(B.mem).reduce((a, m) => a + (dist(m[0], m[1], x, y) < r ? m[2] : 0), 0);   // r 以内记得的敌兵力

// 战斗群现有战斗力（与 orbat bgPow 同口径）
const brPow = G => bgUnits(G).reduce((a, u) => a + brMen(teamsOf(u)), 0) + bgVehs(G).reduce((a, v) => a + bgPow(v), 0);
const brMine = side => (S.bgs || []).filter(G => G.side === side && G.br && !G.dead);

// —— ② 兵力账（守方）：平静地域可抽的组 ——
function brPoolE(B) {
  const ok = q => q.side === 'e' && q.men.length >= 2 && !q.ride && !q.bg && !q.raid && !q.afG && q.order.t !== 'retreat' && ['garrison', 'ambush', 'reserve'].includes(q.role) &&
    !(typeof a4Busy === 'function' && a4Busy(q)) && !(typeof cmdHeld === 'function' && cmdHeld(q)) &&
    !(unitOf(q) && (unitOf(q).state === 'rout' || (typeof a5Has === 'function' && a5Has(unitOf(q).id))));
  const out = [];
  for (const p of S.points) {
    if (p.owner !== 'e' || p.prog > .1 || brThr(B, p.x, p.y) >= BR.quiet || brNear(B, p.x, p.y, BR.quietR) > 0) continue;
    // 警戒组：离据点最近的组留下（指挥所留两个），有机枪的优先
    const sc = q => dist(q.x, q.y, p.x, p.y) - (q.men.includes('mg') ? 25 : 0);
    const ts = S.teams.filter(q => ok(q) && q.obj === p.key).sort((a, b) => sc(a) - sc(b));
    for (const q of ts.slice(p.key === 'HQ' ? 2 : 1)) out.push({ q, p });
  }
  return out;
}
// 可抽的车：空闲（在镇子待命 / 没有任务）、没在交战、不是固定防空和机场的；指挥所只剩一辆防空车就不抽
function brVehPoolE(B, x, y, r) {
  const hq = ptByKey('HQ'), hqAA = hq ? (S.veh || []).filter(v => v.side === 'e' && !v.dead && brIsAA(v) && dist(v.x, v.y, hq.x, hq.y) < 300).length +
    S.enemies.filter(e => !e.dead && e.kind === 'aa' && dist(e.x, e.y, hq.x, hq.y) < 300).length : 0;   // 指挥所的固定高炮也算
  return (S.veh || []).filter(v => v.side === 'e' && !v.dead && !v.fixed && !v.afD && v.auto !== false && !v.immob && !v.lst && !v.a101 && v.bgG == null && v.buddy == null && isLand(v.x, v.y) &&
    v.hp >= v.maxhp * .5 && (!v.ai || v.ai === 'reserve') && !(v.cmd && S.t < (v.cmd.until ?? 0)) && !(v.mod && v.mod.cram) && dist(v.x, v.y, x, y) < r && !brNear(B, v.x, v.y, 450) &&
    !(brIsAA(v) && hq && dist(v.x, v.y, hq.x, hq.y) < 300 && hqAA < 2));
}

// —— ④ 任务：反冲击夺回 / 加强受威胁最大的据点 ——
function brMissionE(B, pw, from, G) {
  const claim = k => brMine('e').some(o => o !== G && o.key === k);
  let best = null, bs = -Infinity;
  for (const p of S.points) {
    const d = dist(from.x, from.y, p.x, p.y);
    if (d > 2400) continue;
    const lost = p.owner === 'p' || p.prog > .25;
    let s;
    if (lost) {
      const no = G && G.no && G.no[p.key], est = Math.max(4, brNear(B, p.x, p.y, 260), no && S.t < no[0] ? no[2] : 0);   // 刚因兵力不足放弃过：按当时看到的敌情算
      if (pw < est * BR.ca || (no && S.t < no[0] && pw < no[1] * 1.3)) continue;
      s = 4 + (p.vp || 1) * 2 + (p.key === 'HQ' ? 4 : 0) + (/^E\d/.test(p.key) ? 2 : 0);
    } else {
      const th = brThr(B, p.x, p.y);
      if (th < 3) continue;
      const def = S.teams.filter(q => q.side === 'e' && q.men.length && q.obj === p.key && !q.bg).reduce((a, q) => a + q.men.length, 0) + brMine('e').filter(o => o !== G && o.key === p.key).reduce((a, o) => a + brPow(o), 0);
      s = th / (def + 4) * Math.sqrt(p.vp || 1) * 2 + (p.key === 'HQ' ? 1 : 0);
    }
    s -= d / 700 + (claim(p.key) ? 3 : 0);
    if (s > bs) { bs = s; best = { p, lost }; }
  }
  return best;
}

// —— ③ 编组 ——
function brFormE(B, K) {
  const pool = brPoolE(B);
  if (pool.length < BR.minTeams - 1) return false;
  // 抽调地域：以某个平静据点为中心 520 以内的可抽兵力最多、离敌主攻集团又近的一片；凑不够就放宽到 900（各据点多出来的零散组也收拢起来）
  let seed = null, ss = -Infinity, R = 0;
  for (const [r, need] of [[BR.area, BR.minTeams], [BR.area2, BR.minTeams - 1]]) {
    for (const p of new Set(pool.map(o => o.p))) {
      const n = pool.filter(o => dist(o.p.x, o.p.y, p.x, p.y) <= r).length, s = n - dist(p.x, p.y, K.x, K.y) / 600;
      if (n >= need && s > ss) { ss = s; seed = p; R = r; }
    }
    if (seed) break;
  }
  if (!seed) return false;
  const area = pool.filter(o => dist(o.p.x, o.p.y, seed.x, seed.y) <= R).sort((a, b) => dist(a.q.x, a.q.y, K.x, K.y) - dist(b.q.x, b.q.y, K.x, K.y)).slice(0, BR.maxTeams);
  const ts = area.map(o => o.q);
  if (ts.length < BR.minTeams - 1 || brMen(ts) < BR.minMen - 2) return false;
  const cx = ts.reduce((a, q) => a + q.x, 0) / ts.length, cy = ts.reduce((a, q) => a + q.y, 0) / ts.length;
  const big = ts.length >= 9, vp = brVehPoolE(B, cx, cy, 1100).sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy));
  const uOld = new Set(ts.map(q => q.u)), att = (S.veh || []).filter(v => v.side === 'e' && !v.dead && v.buddy != null && uOld.has(v.buddy) && v.bgG == null && !v.fixed && !v.afD);   // 抽出的连原来配属的坦克随连一起走
  const take = (f, n) => vp.filter(f).slice(0, n);
  const vs = [...att, ...take(v => BG_TANK.includes(v.type) || v.type === 'td' || v.type === 'flame_tank', big ? 4 : 2), ...take(v => v.type === 'apc' || v.type === 'recon', big ? 2 : 1), ...take(brIsAA, big ? 2 : 1), ...take(v => v.type === 'spg', 2)]
    .filter((v, i, a) => a.indexOf(v) === i);
  // 缺哪样从别处补：反坦克（没有坦克 / 反坦克车又没有反坦克组）、防空（没有防空车就带毒刺组）
  const rest = pool.filter(o => !ts.includes(o.q)).map(o => o.q);
  if (!vs.some(v => BG_TANK.includes(v.type) || v.type === 'td') && !ts.some(brTAT)) { const q = rest.find(brTAT); if (q) ts.push(q); }
  if (!vs.some(brIsAA) && !ts.some(brTAA)) {   // 防空车 → 抽出来的毒刺组 → 平静据点上的毒刺组（那里还有别的组守着）
    const a = brVehPoolE(B, cx, cy, 1800).filter(brIsAA).sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy))[0];
    const spare = q => { const o = ptByKey(q.obj); return !!o && o.owner === 'e' && brThr(B, o.x, o.y) < BR.quiet && S.teams.filter(t => t.side === 'e' && t.men.length && t.obj === q.obj && !t.bg).length >= 2; };
    const q = !a && (rest.find(brTAA) || S.teams.find(q => q.side === 'e' && q.men.length && brTAA(q) && !q.bg && !q.raid && !q.afG && !q.ride && q.order.t !== 'retreat' && !ts.includes(q) && !(typeof a4Busy === 'function' && a4Busy(q)) && spare(q)));
    if (a) vs.push(a); else if (q) ts.push(q);
  }
  const pw = brMen(ts) + vs.reduce((a, v) => a + bgPow(v), 0), M = brMissionE(B, pw, { x: cx, y: cy }, null);
  if (!M) return false;
  // 集合点：抽出各组的中心附近、可通行、离已知敌人 260 以外、掩护好
  let A = null, ab = -Infinity;
  for (let i = 0; i < 24; i++) {
    const a = i * 2.4, rr = i ? 15 + i * 7 : 0, x = clamp(cx + Math.cos(a) * rr, 20, W - 20), y = clamp(cy + Math.sin(a) * rr, 20, H - 20);
    if (!passInf(x, y)) continue;
    const fd = Object.values(B.mem).reduce((m, o) => Math.min(m, dist(o[0], o[1], x, y)), 1e9);
    const sc = Math.min(fd, 400) / 100 - rr / 60 + (1 - coverAt(x, y)) * .8 - (fd < 260 ? 4 : 0);
    if (sc > ab) { ab = sc; A = { x, y }; }
  }
  if (!A) return false;
  const ri = ts.length >= BR.recAt ? ts.findIndex(q => !brTAA(q) && !brTAT(q)) : -1, rec = ri >= 0 ? ts.splice(ri, 1)[0] : null, n = ++B.n;
  const nc = Math.max(1, Math.round(ts.length / 3)), ech = nc >= 4 ? 'III' : nc >= 2 ? 'II' : 'I', nm = `机动第 ${n} ${BR_ECH[ech][0]}`;
  // 步兵按离任务点远近排开，每 3 组一个连（最后一个连 2–4 组）
  const p = M.p, srt = ts.slice().sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y)), us = [];
  for (let c = 0; c < nc; c++) {
    const part = srt.slice(Math.round(c * srt.length / nc), Math.round((c + 1) * srt.length / nc));
    if (!part.length) continue;
    const u = addUnit('e', 'inf', { role: 'bg', obj: p.key, form: 'wedge', a4n: `${nm}${c + 1} 连`, a4T: S.t });
    for (const q of part) Object.assign(q, { u: u.id, role: 'bg', bg: true, obj: p.key, hold: false, px: null });
    us.push(u.id);
  }
  if (rec) { const u = addUnit('e', 'inf', { role: 'bg', obj: p.key, form: 'loose', a4n: `${nm}侦察排`, a4T: S.t }); Object.assign(rec, { u: u.id, role: 'bg', bg: true, obj: p.key, hold: false, px: null, recon: true }); }
  indexUnits();
  const far = Math.max(...ts.map(q => dist(q.x, q.y, A.x, A.y)), ...vs.map(v => dist(v.x, v.y, A.x, A.y) / 2));   // 集合时限按最远一个组的路程（步兵约 9 / 秒）
  const G = bgNew('e', nm, BR_ECH[ech][1], { us, vs: vs.map(v => v.id), rec: rec ? [rec.id] : [], ax: Math.round(A.x), ay: Math.round(A.y), key: p.key, ech, br: true,
    face: Math.atan2(p.y - A.y, p.x - A.x), p0: pw, agg: M.lost ? 1.2 : 1.6, calm: S.t, asmT: Math.round(clamp(far / 9 + 20, 50, 150)) });
  for (const v of vs) Object.assign(v, { bgG: G.id, cmd: null, buddy: null, esc: null });
  B.formT = S.t;
  const from = [...new Set(area.map(o => o.p.name))].slice(0, 3).join('、'), vc = {};
  for (const v of vs) vc[vehModel(v)] = (vc[vehModel(v)] || 0) + 1;
  const comp = [`步兵 ${nc} 个连 ${ts.length + (rec ? 1 : 0)} 组 ${brMen(ts) + (rec ? rec.men.length : 0)} 人`, ...Object.keys(vc).map(k => `${k} ${vc[k]} 辆`)].join('、');
  const lacks = [!vs.some(brIsAA) && !ts.some(brTAA) && '防空', !vs.some(v => BG_TANK.includes(v.type) || v.type === 'td') && !ts.some(brTAT) && '反坦克'].filter(Boolean);
  const est = M.lost ? Math.max(4, brNear(B, p.x, p.y, 260)) : Math.round(brThr(B, p.x, p.y));
  chatSay('e', `判断：敌主力集团约 ${K.n} 人（按兵力折算）在${brWhere(K.x, K.y)}，${M.lost ? `已占${p.name}，当面约 ${est} 人` : `威胁${p.name}`}；${from}方向未见敌情。` +
    `决心：从${from}抽调兵力编成${nm}（${comp}${lacks.length ? `，缺${lacks.join('、')}，由炮兵与友邻支援` : ''}），在${brWhere(A.x, A.y)}集合后成行军队形开进，${M.lost ? `向${p.name}反冲击` : `加强${p.name}防御`}${rec ? '；侦察排先行前出' : ''}。`,
    { kind: 'plan', at: p, lv: 1 });
  brLog(B, `form ${nm} ${comp} → ${p.key}${M.lost ? ' ca' : ''} K${K.n}`);
  if (typeof a4Stat === 'function') { a4Stat('brForm'); a4Stat('brMen', brMen(ts)); a4Stat('brVeh', vs.length); }
  return true;
}

// 装甲特遣营：步兵抽不够、但空闲的坦克 / 战车有 4 辆以上（装甲机动防御的守方常见）——以坦克为主体，就近带上能抽的步兵（最多一个连）和防空车
function brFormArmorE(B, K) {
  const vp = brVehPoolE(B, K.x, K.y, 2600), ar = vp.filter(v => BG_TANK.includes(v.type) || v.type === 'td' || v.type === 'flame_tank' || v.type === 'apc');
  if (ar.length < 4) return false;
  let seed = null, sn = 0;
  for (const v of ar) { const n = ar.filter(o => dist(o.x, o.y, v.x, v.y) < 700).length - dist(v.x, v.y, K.x, K.y) / 1500; if (n > sn) { sn = n; seed = v; } }
  const near = ar.filter(o => dist(o.x, o.y, seed.x, seed.y) < 700).sort((a, b) => dist(a.x, a.y, K.x, K.y) - dist(b.x, b.y, K.x, K.y));
  if (near.length < 4) return false;
  const cx = near.reduce((a, v) => a + v.x, 0) / near.length, cy = near.reduce((a, v) => a + v.y, 0) / near.length;
  const vs = [...near.slice(0, 6), ...vp.filter(v => brIsAA(v) && dist(v.x, v.y, cx, cy) < 1200).slice(0, 1), ...vp.filter(v => v.type === 'spg' && dist(v.x, v.y, cx, cy) < 1200).slice(0, 1)];
  const ts = brPoolE(B).filter(o => dist(o.q.x, o.q.y, cx, cy) < 700).map(o => o.q).slice(0, 4);
  const pw = brMen(ts) + vs.reduce((a, v) => a + bgPow(v), 0), M = brMissionE(B, pw, { x: cx, y: cy }, null);
  if (!M) return false;
  let A = { x: cx, y: cy };
  if (!vehPass(A.x, A.y, 'vehe')) { const j = nearestPassable(ci(A.x, A.y), 'vehe'); if (j >= 0) A = { x: cellCX(j), y: cellCY(j) }; }
  const p = M.p, n = ++B.n, nm = `装甲第 ${n} 营`, us = [];
  if (ts.length >= 2) {
    const u = addUnit('e', 'inf', { role: 'bg', obj: p.key, form: 'wedge', a4n: `${nm}步兵连`, a4T: S.t });
    for (const q of ts) Object.assign(q, { u: u.id, role: 'bg', bg: true, obj: p.key, hold: false, px: null });
    us.push(u.id);
    indexUnits();
  }
  const far = Math.max(...vs.map(v => dist(v.x, v.y, A.x, A.y) / 2), ...(ts.length >= 2 ? ts : []).map(q => dist(q.x, q.y, A.x, A.y)));
  const G = bgNew('e', nm, '营长', { us, vs: vs.map(v => v.id), rec: [], ax: Math.round(A.x), ay: Math.round(A.y), key: p.key, ech: 'II', br: true, arm: true,
    face: Math.atan2(p.y - A.y, p.x - A.x), p0: pw, agg: M.lost ? 1.1 : 1.4, calm: S.t, asmT: Math.round(clamp(far / 9 + 20, 40, 120)) });
  for (const v of vs) Object.assign(v, { bgG: G.id, cmd: null, buddy: null, esc: null });
  B.formT = S.t;
  const vc = {};
  for (const v of vs) vc[vehModel(v)] = (vc[vehModel(v)] || 0) + 1;
  const comp = [...Object.keys(vc).map(k => `${k} ${vc[k]} 辆`), us.length && `步兵 ${ts.length} 组 ${brMen(ts)} 人`].filter(Boolean).join('、');
  chatSay('e', `判断：敌主力集团约 ${K.n} 人在${brWhere(K.x, K.y)}，${M.lost ? `已占${p.name}` : `威胁${p.name}`}。决心：以${brWhere(A.x, A.y)}一带的装甲预备队编成${nm}（${comp}），成行军队形开进，${M.lost ? `向${p.name}实施装甲反冲击` : `前出到${p.name}占领阵地，以坦克火力加强防御`}。`, { kind: 'plan', at: p, lv: 1 });
  brLog(B, `armor ${nm} ${comp} → ${p.key}${M.lost ? ' ca' : ''}`);
  if (typeof a4Stat === 'function') { a4Stat('brForm'); a4Stat('brVeh', vs.length); }
  return true;
}

// 解散：残部编入任务据点（或就近还在手里的据点）守备，车辆交回原来的车辆 AI
function brDissolve(G, why) {
  const at = { x: G.ax, y: G.ay }, own = S.points.filter(p => p.owner === G.side && p.prog < .25).sort((a, b) => dist(a.x, a.y, at.x, at.y) - dist(b.x, b.y, at.x, at.y));
  const p = own[0] || ptByKey(G.key);
  for (const u of bgUnits(G)) { Object.assign(u, { role: 'garrison', obj: p && p.key }); for (const q of teamsOf(u)) Object.assign(q, { role: 'garrison', bg: null, obj: p && p.key, px: null, recon: null }); }
  for (const q of bgRecs(G)) { const u = unitOf(q); if (u) Object.assign(u, { role: 'garrison', obj: p && p.key }); Object.assign(q, { role: 'garrison', bg: null, obj: p && p.key, px: null, recon: null }); }
  for (const v of bgVehs(G)) Object.assign(v, { cmd: null, bgG: null, hx: v.x, hy: v.y });
  G.dead = true; G.done = true;
  bgSay(G, why === 'weak' ? `伤亡过大（剩约 ${Math.round(brPow(G) / Math.max(1, G.p0) * 100)}%），残部转入${p ? p.name : '就近'}防御。` : `任务完成，各连编入${p ? p.name : '就近据点'}守备。`, null, 'report');
}
// 转用：换任务据点，重新成行军队形开进
function brRetask(B, G, M, why) {
  G.key = M.p.key; G.st = 'move'; G.stT = S.t; G.calm = S.t; G.taskT = S.t; G.agg = M.lost ? 1.2 : 1.6;
  for (const u of bgUnits(G)) { u.obj = M.p.key; for (const q of teamsOf(u)) q.obj = M.p.key; }
  bgSay(G, `${why}奉命${M.lost ? `向${M.p.name}反冲击` : `转到${M.p.name}方向加强防御`}，全群成行军队形开进。`, null, 'order', M.lost ? `转向${M.p.name}反冲击！` : `转向${M.p.name}加强防御！`);
  brLog(B, `retask ${G.name} → ${M.p.key}`);
}
// 复盘（每 6 秒，每个战斗群）
function brReview(B, G) {
  const pw = brPow(G);
  if (pw < (G.p0 || pw) * BR.weak) { brDissolve(G, 'weak'); brLog(B, `weak ${G.name}`); return; }
  const p = ptByKey(G.key);
  if (!p) return;
  const lost = p.owner !== G.side || p.prog > .25, dk = dist(G.ax, G.ay, p.x, p.y);
  // 决心不轻改：转用后 45 秒内、离任务据点 600 以外（敌情还看不清）都不改，除非兵力只有对面一半
  if (lost && G.st !== 'fight') {
    const est = brNear(B, p.x, p.y, 260), firm = S.t - (G.taskT ?? G.t) < BR.firm || dk > 600;
    if (pw < est * (firm ? .5 : BR.block)) {   // 夺不回：改到附近还在手里、受威胁的据点阻击；记下这里，两分钟内兵力没明显增加不再来
      const nx = S.points.filter(o => o.owner === G.side && o.prog < .25 && o !== p && dist(o.x, o.y, G.ax, G.ay) < 1100).sort((a, b) => (brThr(B, b.x, b.y) - dist(b.x, b.y, G.ax, G.ay) / 150) - (brThr(B, a.x, a.y) - dist(a.x, a.y, G.ax, G.ay) / 150))[0];
      if (nx) { (G.no || (G.no = {}))[p.key] = [S.t + 120, Math.round(pw), est]; brRetask(B, G, { p: nx, lost: false }, `${p.name}之敌约 ${est} 人，我兵力不足以反冲击；`); }
    }
    return;
  }
  if (!lost && brThr(B, p.x, p.y) >= BR.quiet) G.calm = S.t;
  if (G.st === 'hold' && !lost && S.t - (G.calm ?? G.stT) > BR.retask && S.t - (G.taskT ?? G.t) > BR.firm) {
    const M = brMissionE(B, pw, { x: G.ax, y: G.ay }, G);
    if (M && M.p.key !== G.key) brRetask(B, G, M, `${p.name}方向已平静；`);
    else G.calm = S.t;
  }
}

function brThinkE(B) {
  const K = brIntel(B, 'e');
  for (const G of brMine('e')) brReview(B, G);
  if (!K || K.n < 8 || S.t < BR.start || S.t - B.formT < BR.gap || brMine('e').length >= BR.maxG) return;
  if (!S.teams.some(q => q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y))) return;   // 敌人还没上岸：不动
  if (!brFormE(B, K)) brFormArmorE(B, K);
}

// —— 攻方：夺下据点后闲着的连（平静据点的留守连只留一个警戒组）与空闲的坦克、防空车编成合成营 / 团，成建制开到下一个目标前约 300 的
//    攻击出发位置；到位或途中接敌就展开——各连交回自动指挥（autopilot.js）按队形集结、统一发起攻击，车辆交回步坦协同（tf.js）——
// 可抽的连：没任务的（不含残部）；平静据点的留守连（据点估计无敌、威胁低于 2、550 内没见过敌人，指挥所除外）
function brPoolP(B) {
  const P = S.autoPlan, out = [];
  if (!P || !P.u) return out;
  for (const u of S.units) {
    if (u.side !== 'p' || u.kind !== 'inf' || u.auto !== true || u.state === 'rout' || u.x == null || !teamsOf(u).length || apWeak(u)) continue;
    const pl = P.u[u.id];
    if (!pl || (pl.ph !== 'idle' && pl.ph !== 'garrison')) continue;
    if (pl.ph === 'garrison') {
      const p = apPt(pl.obj);
      if (!p || p.key === 'HQ' || !apTaken(p) || apEstimate(p, true) >= 1 || brThr(B, p.x, p.y) >= BR.quiet || brNear(B, p.x, p.y, BR.quietR) > 0) continue;
      if (S.t - (pl.garT ?? -99) < 30) continue;
    }
    out.push({ u, pl });
  }
  return out;
}
function brVehPoolP(B, x, y, r) {
  return (S.veh || []).filter(v => v.side === 'p' && !v.dead && v.auto && !v.man && !v.lst && !v.swim && !v.immob && v.bgG == null && v.buddy == null && isLand(v.x, v.y) && v.ai !== 'repair' &&
    !(v.ride && v.ride.length) && !v.pick && v.hp >= v.maxhp * .5 && vehAmmoF(v) >= .4 && (v.fuel ?? 1) >= .35 && !(v.cmd && S.t < (v.cmd.until ?? 0)) && !(v.mod && v.mod.cram) &&
    dist(v.x, v.y, x, y) < r && !brNear(B, v.x, v.y, 450));
}
// 目标：没拿下、离抽调地域 380 以外的据点（近的各连自己就打了）——价值、指挥官的主要方向、已有多少连在攻、估计守敌
function brMissionP(B, pw, from) {
  const P = S.autoPlan || {}, pri = P.pri || {}, C = S.cmd && S.cmd.p, axis = C && C.ph === 'brk' && Array.isArray(C.axis) ? C.axis : [];
  let best = null, bs = -Infinity;
  for (const p of S.points) {
    if (apTaken(p)) continue;
    const d = dist(from.x, from.y, p.x, p.y);
    if (d < 380 || d > 2600) continue;
    const est = Math.max(2, typeof cmdEst === 'function' ? cmdEst(p, apEstimate(p)) : apEstimate(p)), req = typeof tfReq === 'function' ? tfReq(p) : 1.5;
    if (pw < est * req * .7) continue;   // 打不动的不去
    const on = apGroup(p.key, P).length, claim = brMine('p').some(G => G.key === p.key);
    const s = (p.vp || 1) * 3 + (pri[p.key] || 0) + (axis[0] === p.key ? 3 : 0) + (p.key === 'HQ' ? 2 : 0) - d / 600 - est * .12 - on * 1.5 - (claim ? 4 : 0);
    if (s > bs) { bs = s; best = { p, est, req }; }
  }
  return best;
}
// 攻击出发位置：沿寻路场从集合点走向目标，停在离目标 r 处
function brAtkPos(A, p, r) {
  const f = field(p.x, p.y, 'p');
  let x = A.x, y = A.y;
  if (f && isFinite(f[ci(x, y)])) for (let k = 0; k < 900 && dist(x, y, p.x, p.y) > r; k++) { const n = nextStep(f, x, y); if (!n) break; [x, y] = n; }
  else { const d = dist(A.x, A.y, p.x, p.y) || 1; if (d > r) { x = p.x + (A.x - p.x) * r / d; y = p.y + (A.y - p.y) * r / d; } }
  return { x: Math.round(x), y: Math.round(y) };
}
function brFormP(B) {
  const pool = brPoolP(B);
  if (!pool.length) return false;
  // 抽调地域：以离敌最近的一个连为中心 600 以内的连
  const K = B.cl[0], seed = pool.slice().sort((a, b) => (K ? dist(a.u.x, a.u.y, K.x, K.y) : 0) - (K ? dist(b.u.x, b.u.y, K.x, K.y) : 0))[0];
  const area = pool.filter(o => dist(o.u.x, o.u.y, seed.u.x, seed.u.y) < 600).slice(0, 4);
  const cx = area.reduce((a, o) => a + o.u.x, 0) / area.length, cy = area.reduce((a, o) => a + o.u.y, 0) / area.length;
  const vp = brVehPoolP(B, cx, cy, 900).sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy)), take = (f, n) => vp.filter(f).slice(0, n);
  const ids = new Set(area.map(o => o.u.id)), att = (S.veh || []).filter(v => v.side === 'p' && !v.dead && v.auto && !v.man && v.buddy != null && ids.has(v.buddy) && v.bgG == null && v.ai !== 'repair');   // 各连配属的坦克随连一起走
  const vs = [...att, ...take(v => BG_TANK.includes(v.type) || v.type === 'td', 3), ...take(v => v.type === 'apc' || v.type === 'ifv' || v.type === 'recon', 2), ...take(brIsAA, 1), ...take(v => v.type === 'spg', 1)]
    .filter((v, i, a) => a.indexOf(v) === i);
  // 留守连：留离据点最近的一个组当警戒组（单独成一个小分队守点），其余编入
  const men = o => o.pl.ph === 'garrison' ? brMen(teamsOf(o.u)) - (teamsOf(o.u).length > 1 ? teamsOf(o.u)[0].men.length : 0) : brMen(teamsOf(o.u));
  const inf = area.reduce((a, o) => a + men(o), 0), pw = inf + vs.reduce((a, v) => a + bgPow(v), 0);
  if (inf < BR.minMen || (area.length < 2 && vs.length < 2)) return false;
  const M = brMissionP(B, pw, { x: cx, y: cy });
  if (!M) return false;
  const P = apEnsure(), us = [];
  for (const o of area) {
    if (o.pl.ph === 'garrison') {
      const gp = apPt(o.pl.obj), ts = teamsOf(o.u).filter(q => q.men.length && !q.ride).sort((a, b) => dist(a.x, a.y, gp.x, gp.y) - dist(b.x, b.y, gp.x, gp.y));
      if (ts.length > 1) {   // 警戒组单独成一个小分队，接着守点
        const k = addUnit('p', 'inf', { ship: `${o.u.ship || ''}警戒分队`, auto: true, form: 'line', face: o.u.face, morale: o.u.morale });
        ts[0].u = k.id;
        P.u[k.id] = { ph: 'garrison', obj: gp.key, next: S.t + 1, garT: S.t };
      }
    }
    apIdle(o.pl); o.pl.ph = 'bg';
    us.push(o.u.id);
  }
  indexUnits();
  for (const id of us) for (const q of teamsOf(UNIT_MAP.get(id))) q.bg = true;
  const p = M.p, A = { x: Math.round(cx), y: Math.round(cy) }, gp = brAtkPos(A, p, 300), n = ++B.n, ech = us.length >= 4 ? 'III' : us.length >= 2 ? 'II' : 'I', nm = `合成第 ${n} ${BR_ECH[ech][0]}`;
  const far = Math.max(...us.map(id => { const u = UNIT_MAP.get(id); return u ? dist(u.x, u.y, A.x, A.y) : 0; }));
  const G = bgNew('p', nm, BR_ECH[ech][1], { us, vs: vs.map(v => v.id), rec: [], ax: A.x, ay: A.y, key: p.key, ech, br: true, gx: gp.x, gy: gp.y,
    face: Math.atan2(gp.y - A.y, gp.x - A.x), p0: pw, agg: 1.4, asmT: Math.round(clamp(far / 9 + 20, 50, 150)) });
  for (const v of vs) Object.assign(v, { bgG: G.id, cmd: null, buddy: null, esc: null });
  B.formT = S.t;
  const vc = {};
  for (const v of vs) vc[vehModel(v)] = (vc[vehModel(v)] || 0) + 1;
  const comp = [`步兵 ${us.length} 个连 ${inf} 人`, ...Object.keys(vc).map(k => `${k} ${vc[k]} 辆`)].join('、');
  const aa = vs.some(brIsAA) || us.some(id => teamsOf(UNIT_MAP.get(id)).some(brTAA));
  chatSay('p', `判断：${p.name}守敌约 ${Math.round(M.est)} 人，${brWhere(cx, cy)}一带我 ${us.length} 个连已无当面之敌。决心：编成${nm}（${comp}${aa ? '' : '，无伴随防空，请航空兵掩护'}），` +
    `成行军队形向${p.name}开进，到${brWhere(gp.x, gp.y)}攻击出发位置展开，按攻击队形发起攻击。`, { kind: 'plan', at: p, lv: 1 });
  brLog(B, `form ${nm} ${comp} → ${p.key} est${Math.round(M.est)}`);
  if (typeof tfStat === 'function') { tfStat('brFormP'); tfStat('brVehP', vs.length); }
  return true;
}
// 展开：各连交回自动指挥向目标攻击（目标已拿下就重新分配），车辆交回步坦协同
function brDeployP(B, G, why) {
  const P = apEnsure(), p = ptByKey(G.key), go = p && !apTaken(p);
  for (const u of bgUnits(G)) {
    for (const q of teamsOf(u)) q.bg = null;
    const pl = P.u[u.id] || (P.u[u.id] = { ph: 'idle', obj: null, next: S.t });
    apIdle(pl);
    if (go) apTask(u, p.key);
  }
  for (const v of bgVehs(G)) Object.assign(v, { cmd: null, bgG: null });
  G.dead = true; G.done = true;
  bgSay(G, go ? `${why}各连展开，按攻击队形向${p.name}发起攻击，坦克在步兵线后伴随。` : `${p ? p.name : '目标'}已被友邻夺取，各连就地待命，另行分配任务。`, null, 'order', go ? `展开，向${p.name}攻击！` : '目标已被友邻拿下，待命');
  brLog(B, `deploy ${G.name} ${go ? '→ ' + G.key : 'idle'}`);
}
function brReviewP(B, G) {
  const p = ptByKey(G.key);
  if (!p || apTaken(p)) { brDeployP(B, G, ''); return; }
  if (brPow(G) < (G.p0 || 1) * BR.weak) { brDeployP(B, G, '伤亡较大，'); return; }
  if (G.st === 'hold' || dist(G.ax, G.ay, G.gx, G.gy) < 60) brDeployP(B, G, '到达攻击出发位置，');
  else if (G.st === 'fight') brDeployP(B, G, '前出途中接敌，');
  else if (S.t - G.t > 300) brDeployP(B, G, '');
}
// 留守连在平静据点守了 60 秒以上、又凑不成战斗群：留一个警戒组守点，主力交回自动指挥继续向纵深发展（指挥官下令巩固时不动）
function brFreeP(B) {
  const C = S.cmd && S.cmd.p;
  if (C && C.ph === 'cons') return;
  const P = apEnsure(), o = brPoolP(B).find(o => o.pl.ph === 'garrison' && S.t - (o.pl.garT ?? o.pl.ordT ?? 0) > BR.relP && teamsOf(o.u).filter(q => q.men.length && !q.ride).length >= 2);
  if (!o) return;
  const gp = apPt(o.pl.obj), ts = teamsOf(o.u).filter(q => q.men.length && !q.ride).sort((a, b) => dist(a.x, a.y, gp.x, gp.y) - dist(b.x, b.y, gp.x, gp.y));
  const k = addUnit('p', 'inf', { ship: `${o.u.ship || ''}警戒分队`, auto: true, form: 'line', face: o.u.face, morale: o.u.morale });
  ts[0].u = k.id;
  P.u[k.id] = { ph: 'garrison', obj: gp.key, next: S.t + 1, garT: S.t };
  indexUnits();
  apIdle(o.pl);
  brLog(B, `free ${o.u.ship || o.u.id} @${gp.key}`);
  if (typeof chatSay === 'function') chatSay('p', `命令：${typeof cmdUName === 'function' ? cmdUName(o.u) : '留守连'}留一个组在${gp.name}警戒，主力继续向纵深发展。`, { kind: 'order', at: gp, key: 'brfree' + o.u.id, gap: 60, lv: 2 });
}
function brThinkP(B) {
  brIntel(B, 'p');
  for (const G of brMine('p')) brReviewP(B, G);
  if (S.t < 120) return;
  if (S.t - B.formT < BR.gap || brMine('p').length >= 2 || !brFormP(B)) brFreeP(B);
}

function brStep(dt) {
  if (!S || S.phase !== 'battle' || S.over) return;
  if (brOn('e')) { const B = brB('e'); if ((B.thT -= dt) <= 0) { B.thT = BR.think; brThinkE(B); } }
  if (brOn('p') && typeof apEnsure === 'function') { const B = brB('p'); if ((B.thT -= dt) <= 0) { B.thT = BR.think; brThinkP(B); } }
}
HOOK.step.push(brStep);

// 炮兵火力支援（ai4 a4Focus 没有反冲击火力任务时）：交战中的战斗群当面之敌
function brFocus() {
  if (!brOn('e')) return null;
  const B = brB('e');
  for (const G of brMine('e')) {
    if (G.st !== 'fight') continue;
    const c = B.cl.find(o => dist(o.x, o.y, G.ax, G.ay) < 420);
    if (c) return { x: c.x, y: c.y, r: 110 };
  }
  return null;
}
