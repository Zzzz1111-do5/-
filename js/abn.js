'use strict';
// 空降夺取机场（v13）：进攻方「机场夺控」与守方反空降，围绕守方野战机场展开。机场在据点表里是「野战机场」（key AF，分值 2），
//   双方现有的攻防逻辑（自动指挥、指挥官重点方向、守方预备队机动与反冲击）都把它当作一个要争夺的据点。
// 进攻方（解放军空降兵）：
//   ① 时机：主力已在滩头站稳并向纵深发展、前沿离机场 1400 以内（会师有望）；空降场与航线附近没有压不住的已知防空；
//      敌未掌握制空权；机场附近已知敌兵力不多（预备队被主力吸走了）。条件不够先「塑造」最多 AB.shape 秒：
//      侦察机照相、垂发导弹 / 歼-35 / 东风-15B 拔防空、战斗机进驻机场上空、空降前封锁敌跑道（敌机起不来拦截运输机）；
//   ② 有蛟龙突击队就先遣：提前约 35 秒在空降场与机场之间高跳低开，掩护空降场、标定落点（主力散布收窄）；
//   ③ 4 架运-20 伞降空降兵连 60 人（三个排：突击、机枪、红箭-12 反坦克、前卫防空、工兵）+ 重装空投 ZBD-03 伞兵战车 2 辆、弹药 3 箱；
//   ④ 各排在集合点集结（约 25 秒或七成到齐）→ 舰炮 / 垂发导弹 / 对地支援机压制机场守敌 → 两个排主攻、一个排从侧翼发起；
//   ⑤ 夺取后环形防御：一个排守机场核心、一个排前出到敌预备队来路构筑阻击阵地；工兵抢修跑道（守军炸过的要久得多）；
//   ⑥ 跑道修通、机场 200 内无敌 → 运-20 依次机降：ZTQ-15 轻型坦克 2 辆、机降步兵排与弹药油料（机场成为补给点）；
//      有油料后我方陆基飞机改在这里降落整备（45 秒，比回战区机场快一倍多）、从这里起飞（carrier.js 调 abRtbLand / abTakeoff）；
//   ⑦ 会师前：指挥官把机场与通往机场的据点列为重点方向，空降场一有敌情就叫舰炮、垂发导弹、对地支援机；会师后交还自动指挥。
// 守方（美军）：
//   ① 战役按难度配机场警卫队与防空炮；② 雷达发现运输机编队 → 判断敌企图空降，就近预备排向机场机动，歼击机截击运输机（airwar.js）；
//   ③ 伞降中 / 刚落地 → 空降场 380 内的守军趁其集结未完立即冲击（敌落地兵力太多则就地坚守），炮兵、攻击机、武装直升机打空降场；
//   ④ 机场守不住（已被突入、或当面之敌两倍于守军）→ 工兵炸毁跑道、焚毁油库，能飞的飞机转场，其余就地破坏；
//   ⑤ 失守后：炮兵专挑运输机进近、飞机起降时封锁跑道；预备队合成反冲击（ai4 按据点 AF 自动组织）；夺回后跑道要抢修才能用。
// 状态：S.ab = { st, dz, ax, rv[], tr[], ch[], us[], vs[], land, lost, men0, t, said, al, alT, fuel, ... }；S.abBase = 已夺取的机场（从 S.enemies 移出）
const AB = { jump: 5, heavy: 7, sig: 24, sigPF: 13, dzMin: 230, dzMax: 380, foeR: 140, aaR: 330, asm: 25, shape: 110, pfLead: 35, flares: 4, odds: 1.5, dfd: 90,
  mod: { pow: 1.2, rof: 1.1, hard: .15, calm: .8 }, link: 320, rearm: 45, rw: 200, fix: 50, fixEng: 28, deny: 160, denyEng: 85, alGap: 22, unload: 8, fuel: 6 };
const AB_SQ = { lead: ['radio', 'rifle', 'mg'], rifle: ['rifle', 'rifle', 'mg'], mg: ['rifle', 'mg', 'mg'], at: ['rifle', 'rifle', 'rifle'], aa: ['rifle', 'aa', 'rifle'], eng: ['rifle', 'rifle', 'rifle'] };
const AB_ROLE = { at: { at: 1.6, atPen: 3.4, rng: 1.5 }, mg: { sup: 1.4 } };
// 每架运-20 的装载（按跳伞顺序）；co = 排（0 = 重装空投）
const AB_LOAD = [
  { co: 1, sq: ['lead', 'rifle', 'rifle', 'mg', 'at', 'aa', 'rifle'] },
  { co: 2, sq: ['lead', 'rifle', 'rifle', 'mg', 'at', 'eng', 'rifle'] },
  { co: 3, sq: ['lead', 'mg', 'at', 'aa', 'eng', 'rifle'] },
  { co: 0, sq: [], veh: [{ type: 'abv', mdl: 'ZBD-03 伞兵战车' }, { type: 'abv', mdl: 'ZBD-03 伞兵战车' }], crates: 3 }
];
const AB_MEN = AB_LOAD.reduce((a, L) => a + L.sq.reduce((b, k) => b + AB_SQ[k].length, 0), 0);
// 机降：跑道修通后依次落地卸载
const AB_AL = [{ veh: ['lt_tank'], nm: 'ZTQ-15 轻型坦克 1 辆' }, { veh: ['lt_tank'], nm: 'ZTQ-15 轻型坦克 1 辆' }, { sq: ['lead', 'rifle', 'at', 'aa'], sup: 360, fuel: AB.fuel, nm: '机降步兵排 12 人与弹药油料' }];
const AB_CO = ['', '一', '二', '三'];
const AB_ICONS = { abn: '<path d="M4 9a8 6 0 0 1 16 0z"/><path d="M4 9l8 6 8-6M9 9l3 6 3-6"/><circle class="f" cx="12" cy="16.2" r="1.5"/><rect x="2" y="19" width="20" height="3" rx=".5"/><path d="M5 20.5h2M11 20.5h2M17 20.5h2"/>' };   // 支援栏按钮：伞 + 跑道

const abStat = (k, n = 1) => { const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
const abSay = (side, t, o) => typeof chatSay === 'function' ? chatSay(side, t, o) : null;
const abWhere = (x, y) => typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);
const abAI = () => S.role === 'spectate' || (S.cv && S.cv.auto === true);   // 与 para.js paAI 相同：观战或航空兵交给 AI 时由指挥官决定
const abAF = () => (S && S.points ? S.points.find(p => p.key === 'AF') : null) || null;
// 打算夺取这座机场（还有空降兵连可用，或行动已经开始）：AI 的导弹、轰炸不把它炸毁（只封跑道），留着自己用
const abKeep = () => !!(S && S.ab && S.assets && abAF() && (S.assets.abn > 0 || !['wait', 'end'].includes(S.ab.st)));
function abEnsure() {
  if (!S) return null;
  if (!S.ab || !Array.isArray(S.ab.tr)) S.ab = { st: 'wait', tr: [], ch: [], us: [], vs: [], land: 0, lost: 0, men0: 0, t: 0, thT: 2, eT: 1, said: {}, al: 0, alT: 0, fuel: 0, shT: {}, fT: 0, rv: [] };
  if (!S.assets) S.assets = {};
  if (S.assets.abn == null) S.assets.abn = 0;
  return S.ab;
}
// 机场对象：守方手里的在 S.enemies；我方夺取后移到 S.abBase（敌方的目标选择、出动逻辑都不会再碰它）
function abBaseObj() {
  if (S.abBase) return S.abBase;
  const af = abAF();
  return af ? S.enemies.find(e => e.id === af.af) || null : null;
}
// 我方机场能起降：已夺取、没被毁、跑道没坑、机场 200 以内地面没有敌人
function abAfOpen() {
  const b = S && S.abBase;
  return !!b && !b.dead && !((b.cratT || 0) > S.t) && !abFoeNear(b.x, b.y, AB.rw);
}
function abFoeNear(x, y, r) {
  return S.teams.some(q => q.side === 'e' && q.men.length && dist(q.x, q.y, x, y) < r) || (S.veh || []).some(v => v.side === 'e' && !v.dead && dist(v.x, v.y, x, y) < r);
}
const abMenNear = (side, x, y, r) => S.teams.reduce((a, q) => a + (q.side === side && q.men.length && !q.ride && dist(q.x, q.y, x, y) < r ? q.men.length : 0), 0);

// —— 据点「野战机场」：放在主停机坪西侧、塔台附近（局部坐标 u −185、v 150）；战役另配机场警卫队与防空 ——
function abMakeAF() {
  if (!S || abAF()) return abAF();
  const b = S.enemies.find(e => e.kind === 'airfield' && !e.dead);
  if (!b || typeof eaW !== 'function') return null;
  let [x, y] = eaW(b, -185, 150);
  if (!passInf(x, y)) { const j = nearestPassable(ci(x, y), 'e'); if (j >= 0) { x = cellCX(j); y = cellCY(j); } }
  const p = { key: 'AF', name: '野战机场', x: Math.round(x), y: Math.round(y), vp: 2, owner: 'e', prog: 0, af: b.id };
  S.points.push(p);
  if (typeof aiCache === 'function') aiCache();
  return p;
}
function abGarrison(p) {
  const lv = S.level || 'hard', n = { normal: 2, hard: 3, hell: 4 }[lv] || 3, b = abBaseObj();
  const u = addUnit('e', 'inf', { role: 'garrison', obj: 'AF', a4n: '机场警卫队' });
  for (let i = 0; i <= n; i++) {
    const a = i * 2.1, r = 20 + i * 7;
    let x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    if (!passInf(x, y)) { x = p.x; y = p.y; }
    const men = i === n ? ['rifle', 'aa', 'rifle'] : i ? ['rifle', 'rifle', 'mg'] : ['radio', 'rifle', 'mg'];
    const q = addTeam('e', x, y, men, { role: 'garrison', obj: 'AF', u: u.id });
    if (men.includes('aa')) q.aam = 3;
  }
  if (lv !== 'normal' && b) {   // 跑道东段外侧配一门防空炮，掩护起降
    let [x, y] = eaW(b, 180, -45);
    if (!passInf(x, y)) { const j = nearestPassable(ci(x, y), 'e'); if (j >= 0) { x = cellCX(j); y = cellCY(j); } }
    addEnemy('aa', x, y);
  }
  if (typeof indexUnits === 'function') indexUnits();
}
HOOK.newGame.push(function abNewGame(opts) {
  if (!S) return;
  S.ab = null; S.abBase = null;
  abEnsure();
  if (opts && opts.sandbox) return;
  const p = abMakeAF();
  if (!p) return;
  abGarrison(p);
  S.assets.abn = 1;   // 战役：空降兵连一个（沙盒从目录购买）
});

// —— 防空威胁（我方情报）：已标定的防空炮、看见过的防空车、近 150 秒暴露过的单兵防空组 ——
function abAAList() {
  const out = [];
  for (const e of S.enemies) if (!e.dead && e.kind === 'aa' && e.kx != null) out.push({ x: e.kx, y: e.ky, w: 1.2, o: e, k: 'enemy' });
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && (v.type === 'aa_veh' || v.type === 'sam_veh') && (inVision(v.x, v.y) || (v.kx != null && S.t - (v.seen ?? -99) < 120)))
    out.push({ x: inVision(v.x, v.y) ? v.x : v.kx, y: inVision(v.x, v.y) ? v.y : v.ky, w: v.type === 'sam_veh' ? 1.6 : 1, o: v, k: 'veh' });
  for (const q of S.teams) if (q.side === 'e' && q.men.length && q.men.includes('aa') && q.aaSeen != null && S.t - q.aaSeen < 150) out.push({ x: q.aax, y: q.aay, w: .6, o: q, k: 'team' });
  return out;
}
// 空降场与航线（从南面海上 ax 处直飞空降场）上的防空威胁分
function abAAOn(L, dz, ax) {
  let w = 0;
  for (const a of L) if (dist(a.x, a.y, dz.x, dz.y) < AB.aaR || segDist(a.x, a.y, ax, H + 60, dz.x, dz.y) < AB.aaR * .8) w += a.w;
  return w;
}
// 已知敌人（看得见或刚看见的小组、车辆）
function abFoes() {
  const out = [];
  for (const q of S.teams) if (q.side === 'e' && q.men.length) { const vis = inVision(q.x, q.y); if (vis || (q.seen != null && S.t - q.seen < 40)) out.push({ x: vis ? q.x : q.sx, y: vis ? q.y : q.sy, n: q.men.length, q }); }
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && (inVision(v.x, v.y) || (v.kx != null && S.t - (v.seen ?? -99) < 60))) out.push({ x: inVision(v.x, v.y) ? v.x : v.kx, y: inVision(v.x, v.y) ? v.y : v.ky, n: vehCrew(v) * 1.5, v });
  return out;
}
// 空降场：机场周围 140–260、不在跑道 / 停机坪上、开阔（伞兵好落）、离已知敌人 140 以外、远离已知防空、靠我方主力一侧（会师近）
function abDZ(b, af, aa, foes) {
  const ashore = S.teams.filter(q => q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y));
  let best = null, bs = -Infinity;
  for (let k = 0; k < 110; k++) {
    const a = Math.random() * 6.283, r = AB.dzMin + Math.random() * (AB.dzMax - AB.dzMin);
    const x = clamp(af.x + Math.cos(a) * r, 60, W - 60), y = clamp(af.y + Math.sin(a) * r, 60, H - 60);
    if (!isLand(x, y) || !passInf(x, y) || coastAt(x) - y < 160 || (typeof eaFacDist === 'function' && eaFacDist(b, x, y) < 22)) continue;
    let open = 0;
    for (let j = 0; j < 8; j++) { const ox = x + Math.cos(j * .785) * 45, oy = y + Math.sin(j * .785) * 45; if (isLand(ox, oy) && passInf(ox, oy) && coverAt(ox, oy) > .75) open++; }
    const fd = foes.reduce((m, f) => Math.min(m, dist(f.x, f.y, x, y)), 1e9);
    if (fd < AB.foeR || S.points.some(p => p.key !== 'AF' && p.owner !== 'p' && dist(p.x, p.y, x, y) < 220)) continue;   // 敌守据点照例有守备与防空：不往它旁边跳
    const ad = aa.reduce((m, o) => Math.min(m, dist(o.x, o.y, x, y)), 1e9), fr = ashore.reduce((m, q) => Math.min(m, dist(q.x, q.y, x, y)), 3000);
    const s = open * .35 + Math.min(fd, 420) / 160 + Math.min(ad, 600) / 260 - fr / 900 - Math.abs(r - 190) / 130 + Math.random() * .3;
    if (s > bs) { bs = s; best = { x: Math.round(x), y: Math.round(y) }; }
  }
  return best;
}
// 进场点：南面海上，空降场正南或偏东 / 偏西 300，取航线上防空最弱的
function abEntry(dz, aa) {
  let bx = dz.x, bw = Infinity;
  for (const o of [0, -300, 300, -520, 520]) { const ax = clamp(dz.x + o, 60, W - 60), w = abAAOn(aa, dz, ax) + Math.abs(o) / 2000; if (w < bw) { bw = w; bx = ax; } }
  return bx;
}

// —— 判断：能不能空降、还差什么 ——
function abEval() {
  const b = abBaseObj(), af = abAF();
  if (!b || !af || b.dead || S.abBase || af.owner === 'p') return null;
  const C = S.cmd && S.cmd.p, aa = abAAList(), foes = abFoes();
  const ashore = S.teams.filter(q => q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y) && !q.ab);
  const men = ashore.reduce((a, q) => a + q.men.length, 0), front = ashore.reduce((m, q) => Math.min(m, dist(q.x, q.y, af.x, af.y)), 1e9);
  const beach = (C && (C.ph === 'brk' || C.ph === 'cons')) || S.points.some(p => /^E\d/.test(p.key) && p.owner === 'p');
  const near = foes.filter(f => dist(f.x, f.y, af.x, af.y) < 380).reduce((a, f) => a + f.n, 0);
  const aa2 = [...aa, ...S.points.filter(p => p.owner !== 'p').map(p => ({ x: p.x, y: p.y, w: p.key === 'AF' || p.key === 'HQ' ? .8 : .4, k: 'presumed' }))];   // 机场警卫与敌守据点照例有防空：航线、空降场避开
  const dz = abDZ(b, af, aa2, foes), ax = dz ? abEntry(dz, aa2) : null;
  return { b, af, aa, foes, men, front, beach, near, dz, ax, aaW: dz ? abAAOn(aa, dz, ax) : 9, air: typeof awState === 'function' ? awState() : null,
    seen: S.t - (S.ab.seenT ?? -999) < 150 };
}
// —— 塑造：拔防空、照相、制空、封跑道（每次思考最多派两次火力，同一目标 35 秒内不重复）——
function abShape(E) {
  const A = S.ab, out = [];
  // 机场方向没照过相（150 秒内机场一带不在视野里）：派侦察机
  if (!E.seen && S.t - (A.rcT ?? -99) > 60 && typeof launchPlane === 'function' && S.assets.recon > 0 && launchPlane('recon', E.af.x, E.af.y)) { A.rcT = S.t; out.push('侦察机对机场一带照相'); }
  let n = 0;
  for (const a of E.aa.sort((p, q) => q.w - p.w)) {
    if (n >= 2) break;
    if (dist(a.x, a.y, E.dz.x, E.dz.y) > AB.aaR && segDist(a.x, a.y, E.ax, H + 60, E.dz.x, E.dz.y) > AB.aaR * .8) continue;
    const id = a.k + (a.o.id ?? 0);
    if (S.t - (A.shT[id] ?? -99) < 35) continue;
    let how = null;
    if (typeof vlsCan === 'function' && vlsCan('lacm', a.x, a.y) && vlsFire('lacm', a.x, a.y, 1, 'abn')) how = '垂发巡航导弹';
    else if (typeof cmdAir === 'function' && S.cv && S.cv.auto && S.assets.strike > 0 && cmdAir('strike', a.x, a.y, a.k === 'enemy' ? a.o.id : null)) how = '歼-35';
    else if (S.assets.msl > 0 && typeof msFireP === 'function' && a.k !== 'team' && msFireP(a.x, a.y, true)) how = '东风-15B';
    if (!how) continue;
    A.shT[id] = S.t; n++;
    out.push(`${how}打掉${abWhere(a.x, a.y)}的${a.k === 'veh' ? (typeof vehModel === 'function' ? vehModel(a.o) : '防空车') : a.k === 'team' ? '毒刺防空组' : '防空炮'}`);
  }
  // 敌机活跃：战斗机先进驻机场上空
  const aw = S.airw, foeAir = E.air === 'e' || E.air === 'c' || (aw && S.t - (aw.seenE ?? -1e9) < 120);
  if (foeAir && !S.planes.some(p => !p.dead && p.kind === 'fighter' && ['cat', 'roll', 'out', 'loiter'].includes(p.phase) && dist(p.cx ?? p.x, p.cy ?? p.y, E.af.x, E.af.y) < 450)
    && S.t - (A.cpT ?? -99) > 40 && typeof launchPlane === 'function' && S.assets.fighter > 0 && launchPlane('fighter', E.af.x, Math.min(H - 60, E.af.y + 120))) { A.cpT = S.t; out.push('战斗机进驻机场上空'); }
  return out;
}
// 空降前 20 秒左右封锁敌跑道：敌固定翼还有待命的就打跑道中段（夺取后由工兵修复）
function abCloseRunway(E) {
  const A = S.ab, b = E.b, Ea = S.eair;
  if (A.rwShot || !Ea || !(b.cratT <= S.t) || !Ea.wing.some(w => w.state === 'ready' && w.type !== 'heli')) return '';
  let how = null;
  if (typeof vlsCan === 'function' && vlsCan('lacm', b.x, b.y) && vlsFire('lacm', b.x, b.y, 1, 'abn')) how = '垂发巡航导弹';
  else if (S.assets.msl > 0 && typeof msFireP === 'function' && msFireP(b.x, b.y, true)) how = '东风-15B';
  if (!how) return '';
  A.rwShot = S.t;
  return `${how}封锁敌机场跑道，敌机起不来拦截运输机`;
}

// —— 发起：蛟龙先遣（有就用）→ 运-20 编队 ——
function abGo(E, why) {
  const A = abEnsure();
  if (!(S.assets.abn > 0) || A.st === 'air' || A.st === 'pf') return false;
  S.assets.abn--;
  Object.assign(A, { dz: E.dz, ax: E.ax, t: S.t, tgtAf: E.af.key, men0: AB_MEN, pfM: false });
  // 集合点：空降场靠机场一侧，三个排横向展开 34
  const l = Math.max(1, dist(E.dz.x, E.dz.y, E.af.x, E.af.y)), ux = (E.af.x - E.dz.x) / l, uy = (E.af.y - E.dz.y) / l;
  A.rv = [0, 1, 2, 3].map(k => { const o = k ? (k - 2) * 34 : 0, x = E.dz.x + ux * 25 - uy * o, y = E.dz.y + uy * 25 + ux * o; return { x: Math.round(x), y: Math.round(y) }; });
  A.face = Math.atan2(uy, ux);
  if (abAI() && S.assets.para > 0 && typeof paLaunch === 'function') {
    const px = E.dz.x + ux * 70, py = E.dz.y + uy * 70;
    if (isLand(px, py) && passInf(px, py) && paLaunch('para', px, py, true)) { A.st = 'pf'; A.pfT = S.t; abSay('p', `命令：蛟龙突击队先遣，在空降场与机场之间 ${abWhere(px, py)} 高跳低开，清除空降场附近的防空、标定落点；空降兵连约 ${AB.pfLead} 秒后跟进。`, { kind: 'order', at: { x: px, y: py }, lv: 1 }); }
  }
  if (A.st !== 'pf') abLift();
  abStat('abGo');
  abSay('p', `决心：${why}以空降兵连（4 架运-20，伞兵 ${AB_MEN} 人，重装空投 ZBD-03 伞兵战车 2 辆）在${abWhere(E.dz.x, E.dz.y)}伞降，夺取敌野战机场——断敌空中支援、开辟空中走廊，机降轻型坦克与后续兵力，我方飞机就近起降；主力向机场方向打通，与空降兵会师。`, { kind: 'plan', at: E.dz, lv: 0 });
  return true;
}
function abLift() {
  const A = S.ab, dz = A.dz;
  A.st = 'air'; A.tT = S.t;
  A.sig = A.pfM ? AB.sigPF : AB.sig;
  AB_LOAD.forEach((L, k) => {
    const x = clamp(A.ax + (k % 2 ? 26 : -26), 40, W - 40), y = H + 60 + k * 75;
    const p = { id: S.nid++, kind: 'transport', ab: 'drop', x, y, heading: -Math.PI / 2, spd: 150, alt: .55, bank: 0, phase: 'in', tx: dz.x + (k % 2 ? 14 : -14), ty: dz.y, cx: dz.x, cy: dz.y, ox: 1, dropped: false, flares: AB.flares };
    S.planes.push(p);
    A.tr.push({ id: p.id, k, co: L.co, sq: L.sq.slice(), veh: (L.veh || []).slice(), cr: L.crates || 0, done: false, gone: false });
  });
  const sec = Math.round((H + 60 - dz.y) / 150);
  log(`空降兵连：4 架运-20 从海上进场，约 ${sec} 秒后在 ${gridRef(dz.x, dz.y)} 伞降`, 'info', null, 0, dz);
  if (abAI()) { const how = abPrep(abAF(), true); if (how.length) abSay('p', `命令：运输机进场前，${how.join('、')}压制机场守敌，让他们抬不起头打运输机、冲空降场。`, { kind: 'order', at: abAF(), lv: 1 }); }
}
// 压制机场守敌：舰炮够得着先用舰炮，再用垂发导弹打机场核心（不打机场设施）、攻击机；force = 不管看没看见都打机场核心
function abPrep(af, force) {
  const A = S.ab, out = [];
  if (!af || S.t - (A.prT ?? -99) < 14) return out;
  const f = typeof cmdFoeAt === 'function' ? cmdFoeAt(af, 160, 60) : null, t = f || (force ? { x: af.x, y: af.y } : null);
  if (!t) return out;
  A.prT = S.t;
  if (typeof cmdFire === 'function' && S.dd && S.dd.state !== 'sunk' && dist(S.dd.x, S.dd.y, t.x, t.y) < 980 && cmdFire(t.x, t.y, 3, 'ab')) out.push('舰炮急促射');
  if (typeof vlsCan === 'function' && vlsCan('lacm', t.x, t.y) && vlsFire('lacm', t.x, t.y, 1, 'ab')) out.push('垂发巡航导弹');
  if (out.length < 2 && typeof cmdAir === 'function' && S.cv && S.cv.auto && S.assets.cas > 0 && cmdAir('cas', t.x, t.y)) out.push('对地支援机');
  if (out.length) abStat('abPrep');
  return out;
}
// 玩家点地图发起（hud 支援栏 / Shift+K）：点在敌机场 700 以内，空降场按情报自动选
function abPlayerLaunch(x, y) {
  const A = abEnsure();
  if (!S || S.phase !== 'battle') { log('空降在 H 时之后才能使用', 'warn', 'ab0', 2); return false; }
  if (!(S.assets.abn > 0)) { log('空降兵连已经用掉了', 'warn', 'ab1', 2); return false; }
  if (A.st !== 'wait' && A.st !== 'shape') { log('空降兵连已经出动', 'warn', 'ab1', 2); return false; }
  const E = abEval();
  if (!E || !E.dz) { log(S.abBase ? '机场已经在我手里' : '没有可以空降夺取的敌机场', 'warn', 'ab2', 2); return false; }
  if (dist(x, y, E.af.x, E.af.y) > 700) { log('点敌野战机场附近：空降兵连会在机场周围选空降场', 'warn', 'ab3', 2); return false; }
  const warn = [E.aaW > 1.5 && '航线上还有未压制的防空', E.air === 'e' && '敌方掌握制空权', !E.beach && '主力尚未在滩头站稳', E.near > 18 && `机场附近已知敌约 ${Math.round(E.near)} 人`].filter(Boolean);
  if (warn.length) abSay('p', `提醒：${warn.join('、')}——空降风险大。`, { kind: 'intel', at: E.dz, lv: 1 });
  return abGo(E, '');
}

// —— 运输机（para.js paFly 交给这里）：进场 → 飞越空降场依次放出伞兵、重装平台与弹药箱 → 掉头回海上 ——
function abFly(p, dt) {
  if (p.ab === 'land') { abAlFly(p, dt); return; }
  if (p.phase === 'in') {
    airSteer(p, p.tx, p.ty, dt);
    if (dist(p.x, p.y, p.tx, p.ty) < 60 || (p.y < p.ty - 10 && Math.abs(p.x - p.tx) < 90)) { p.phase = 'drop'; p.rT = 0; }
    return;
  }
  if (p.phase === 'drop') {   // 边跳边向背离机场核心的一侧转弯，不飞进机场警卫的单兵防空射程
    const af = abAF(), a = af ? Math.atan2(p.y - af.y, p.x - af.x) : p.heading;
    airSteer(p, p.x + Math.cos(a) * 300, p.y + Math.sin(a) * 300, dt, true);
    const r = S.ab.tr.find(o => o.id === p.id);
    if ((p.rT -= dt) <= 0) { p.rT = .2; if (r) abRelease(p, r); }
    if (!r || (!r.sq.length && !r.veh.length && !r.cr)) { p.phase = 'out'; p.dropped = true; p.ox = p.x < W / 2 ? 1 : -1; if (r) r.done = true; }
    return;
  }
  airSteer(p, clamp(p.x + p.ox * 260, 0, W), H + 240, dt);
  if (p.y > H + 50) p.dead = true;
}
function abRelease(p, r) {
  const A = S.ab, sg = A.sig || AB.sig;
  if (r.sq.length) { const k = r.sq.shift(); A.ch.push({ k: 'team', co: r.co, role: k, men: AB_SQ[k].slice(), x: p.x + gauss() * sg, y: p.y + gauss() * sg, t: 0, hT: 0 }); }
  else if (r.veh.length) { const v = r.veh.shift(); A.ch.push({ k: 'veh', v, x: p.x + gauss() * sg * .6, y: p.y + gauss() * sg * .6, t: 0 }); }
  else if (r.cr > 0) { r.cr--; A.ch.push({ k: 'crate', x: p.x + gauss() * sg * .6, y: p.y + gauss() * sg * .6, t: 0 }); }
  if (!A.said.jump) { A.said.jump = 1; log('空降兵连开始伞降', 'good', null, 0, p); }
}
// 下降：东北风飘移；伞兵每 0.5 秒挨一次地面火力（150 内没被压住的守军步兵、190 内的防空炮）
function abChutes(dt) {
  const A = S.ab;
  for (const c of A.ch) {
    c.t += dt; c.x += 3 * dt; c.y -= 2 * dt;
    if (c.k === 'team' && c.men.length && (c.hT -= dt) <= 0) {
      c.hT = .5;
      let pk = 0, src = null;
      for (const q of S.teams) if (q.side === 'e' && q.men.length && q.sup < 70 && dist(q.x, q.y, c.x, c.y) < 150) { pk += .04 * q.men.length / 3; src = src || q; }
      for (const e of S.enemies) if (!e.dead && e.kind === 'aa' && (e.sup || 0) < 60 && dist(e.x, e.y, c.x, c.y) < 190) { pk += .08; src = e; }
      if (src) tracer(src.x, src.y, c.x + gauss() * 4, c.y - (1 - c.t / AB.jump) * 34, 'e', inVision(src.x, src.y));
      if (pk && Math.random() < pk) { c.men.splice(Math.floor(Math.random() * c.men.length), 1); S.stats.lost++; A.lost++; abStat('abAirKill'); }
    }
    if (c.t < (c.k === 'veh' ? AB.heavy : AB.jump)) continue;
    c.done = true;
    abLand(c);
  }
  if (A.ch.some(c => c.done)) A.ch = A.ch.filter(c => !c.done);
}
function abUnit(co) {
  const A = S.ab;
  if (A.us[co] != null) { const u = UNIT_MAP.get(A.us[co]); if (u) return u; }
  const u = addUnit('p', 'inf', { ship: '空降兵' + AB_CO[co], emblem: 'para', form: 'wedge', face: A.face ?? NORTH, auto: true, morale: 90, elite: true, ab: co });
  A.us[co] = u.id;
  const P = typeof apEnsure === 'function' ? apEnsure() : null;
  if (P) P.u[u.id] = { ph: 'ab', obj: null, next: S.t + 1 };   // 集结期间由本模块掌握（自动指挥不分配目标）
  return u;
}
function abLand(c) {
  const A = S.ab;
  let x = clamp(c.x, 10, W - 10), y = clamp(c.y, 10, H - 10);
  const n = c.k === 'team' ? c.men.length : 0;
  if (isWater(typeAt(x, y))) { A.lost += n; return; }
  if (!passInf(x, y)) {
    const j = nearestPassable(ci(x, y), c.k === 'veh' ? 'veh' : 'p');
    if (j < 0 || dist(cellCX(j), cellCY(j), x, y) > 30) { A.lost += n; return; }
    x = cellCX(j); y = cellCY(j);
  }
  if (c.k === 'crate') {   // 弹药箱：空降场旁的空投补给点（para.js 的补给点逻辑）
    if (typeof paEnsure === 'function' && paEnsure()) { const P = S.para, k = P.ca.find(o => o.ev === 'ab' && dist(o.x, o.y, x, y) < 70); if (k) k.amt += 120; else P.ca.push({ id: S.nid++, ev: 'ab', x: Math.round(x), y: Math.round(y), amt: 120, t: S.t }); }
    return;
  }
  if (c.k === 'veh') {
    const v = addVehicle('p', c.v.type, x, y, { auto: true, mdl: c.v.mdl, ab: true });
    if (v) { A.vs.push(v.id); abStat('abVeh'); }
    return;
  }
  if (!n) return;
  const u = abUnit(c.co);
  const q = addTeam('p', x, y, c.men, { unit: u.ship, u: u.id, ammo: 60, sup: 12, ab: c.role, mod: { ...AB.mod, ...(AB_ROLE[c.role] || {}) } });
  if (q.men.includes('aa')) q.aam = 3;
  if (typeof indexUnits === 'function') indexUnits();
  const rv = A.rv[c.co] || A.dz, k = teamsOf(u).length;
  if (typeof apTeamGo === 'function') apTeamGo(q, rv.x + gauss() * 10 + (k % 3 - 1) * 12, rv.y + gauss() * 10, 'move');
  A.land++;
  abStat('abMen', q.men.length);
}

// —— 机降：运-20 沿跑道进近 → 落地减速到跑道中段 → 卸载 → 继续滑跑起飞 → 回海上 ——
// 跑道两端里取进近点更靠南（我方一侧）的一端作入口；dir = 着陆方向（局部 u 增加为 +1）
function abRwy(b) {
  const L = EA_RW.hl, [ex, ey] = eaW(b, -L, 0), [wx, wy] = eaW(b, L, 0), ux = (wx - ex) / (2 * L), uy = (wy - ey) / (2 * L);
  const fA = { x: ex - ux * 380, y: ey - uy * 380 }, fB = { x: wx + ux * 380, y: wy + uy * 380 };
  return fA.y >= fB.y ? { dir: 1, u0: -L, fix: fA, hx: ux, hy: uy } : { dir: -1, u0: L, fix: fB, hx: -ux, hy: -uy };
}
function abAlLaunch(k) {
  const b = S.abBase, R0 = abRwy(b), L = AB_AL[k];
  const p = { id: S.nid++, kind: 'transport', ab: 'land', alk: k, x: clamp(R0.fix.x + gauss() * 40, 40, W - 40), y: H + 60, heading: -Math.PI / 2, spd: 150, alt: .5, bank: 0, phase: 'app', tx: R0.fix.x, ty: R0.fix.y, ox: 1, t0: S.t, flares: AB.flares };
  S.planes.push(p);
  S.ab.alOn = p.id;
  log(`运-20 机降：载${L.nm}，向机场进近`, 'info', null, 0, { x: b.x, y: b.y });
}
function abAlFly(p, dt) {
  const b = S.abBase, A = S.ab;
  const out = () => { p.phase = 'out'; p.ox = p.x < W / 2 ? 1 : -1; };
  if (!b && p.phase !== 'out') out();
  const R0 = b ? abRwy(b) : null;
  if (p.phase === 'app') {
    const d = airSteer(p, R0.fix.x, R0.fix.y, dt);
    if (d < 60 && abAfOpen()) p.phase = 'fin';   // 跑道不能用就在进近点附近盘旋等待
    if (!abAfOpen() && S.t - p.t0 > 90) { out(); log('机场跑道迟迟无法使用，运-20 带着货物返航', 'warn', null, 0, p); }
    return;
  }
  if (p.phase === 'fin') {   // 对正跑道下滑；跑道被炸、机场有敌就复飞
    if (!abAfOpen()) { p.phase = 'app'; p.alt = .5; log('机场跑道遭炮击，运-20 复飞等待', 'warn', 'abga', 10, p); return; }
    const [tx, ty] = eaW(b, R0.u0, 0), d = dist(p.x, p.y, tx, ty);
    p.spd += clamp(95 - p.spd, -40 * dt, 30 * dt); p.alt = Math.max(.02, Math.min(p.alt, d / 380 * .5));
    airSteer(p, tx, ty, dt, true);
    if (d < 18) { p.phase = 'roll'; p.ru = R0.u0; p.alt = 0; }
    return;
  }
  if (p.phase === 'roll' || p.phase === 'tko') {
    const tko = p.phase === 'tko';
    p.spd = tko ? Math.min(150, p.spd + 45 * dt) : Math.max(0, p.spd - 40 * dt);
    p.ru += R0.dir * Math.max(tko ? 0 : 8, p.spd) * dt;
    [p.x, p.y] = eaW(b, p.ru, 0); p.heading = Math.atan2(R0.hy, R0.hx); p.alt = tko ? Math.max(0, (p.spd - 110) / 120) : 0;
    if (!tko && (p.spd <= 9 || Math.abs(p.ru) < 8)) { p.phase = 'unl'; p.uT = AB.unload; p.spd = 0; }
    if (tko && (p.spd >= 140 || Math.abs(p.ru) > EA_RW.hl - 15)) { p.phase = 'out'; p.ox = p.x < W / 2 ? 1 : -1; p.alt = .3; }
    return;
  }
  if (p.phase === 'unl') {
    if ((p.uT -= dt) <= 0) { abUnload(p); p.phase = 'tko'; }
    return;
  }
  p.alt = Math.min(.55, p.alt + dt * .2);
  airSteer(p, clamp(p.x + p.ox * 260, 0, W), H + 240, dt);
  if (p.y > H + 50) { p.dead = true; if (A.alOn === p.id) A.alOn = null; }
}
function abUnload(p) {
  const A = S.ab, b = S.abBase, L = AB_AL[p.alk];
  if (!b || !L || p.unl) return;
  p.unl = true;
  // 从运-20 尾部舱门开下来：停在跑道与滑行道之间的草地上，沿跑道往后一字排开
  const R0 = abRwy(b), u0 = clamp(p.ru ?? 0, -EA_RW.hl + 40, EA_RW.hl - 40);
  const at = k => { let [x, y] = eaW(b, clamp(u0 - R0.dir * (16 + k * 20), -EA_RW.hl + 10, EA_RW.hl - 10), 44); if (!passInf(x, y)) { const j = nearestPassable(ci(x, y), 'p'); if (j >= 0) { x = cellCX(j); y = cellCY(j); } } return [x, y]; };
  (L.veh || []).forEach((t, k) => { const [x, y] = at(k); const v = addVehicle('p', t, x, y, { auto: true, ab: true }); if (v) A.vs.push(v.id); });
  if (L.sq) {
    const u = addUnit('p', 'inf', { ship: '机降', emblem: 'para', form: 'line', face: A.face ?? NORTH, auto: true, morale: 85, elite: true, ab: 9 });
    L.sq.forEach((k, i) => { const [x, y] = at(i); const q = addTeam('p', x, y, AB_SQ[k], { unit: u.ship, u: u.id, ammo: 60, ab: k, mod: { ...AB.mod, ...(AB_ROLE[k] || {}) } }); if (q.men.includes('aa')) q.aam = 3; });
    if (typeof indexUnits === 'function') indexUnits();
    A.us.push(u.id);
  }
  if (L.sup && typeof paEnsure === 'function' && paEnsure()) {   // 弹药：机场补给点（随机场存续，不过期）
    const [x, y] = at(1), k = S.para.ca.find(o => o.ev === 'abaf');
    if (k) k.amt += L.sup; else S.para.ca.push({ id: S.nid++, ev: 'abaf', x: Math.round(x), y: Math.round(y), amt: L.sup, t: S.t });
  }
  if (L.fuel) A.fuel += L.fuel;
  A.al = Math.max(A.al, p.alk + 1); A.alT = S.t + AB.alGap;
  abStat('abLand');
  log(`运-20 在机场落地，卸下${L.nm}`, 'good', null, 0, { x: p.x, y: p.y });
  abSay('p', `报告：运-20 在机场机降成功，卸下${L.nm}${L.fuel ? '——机场有了油料弹药，我方飞机可以在这里降落整备' : ''}。`, { kind: 'report', at: { x: p.x, y: p.y }, lv: 1 });
}

// —— 我方飞机在夺取的机场起降（carrier.js 调用）——
// 陆基固定翼返航：机场能起降、有油料就改降这里
function abRtbLand(p) {
  if (p.afPh) return true;
  if (!abAfOpen() || !(S.ab && S.ab.fuel > 0) || p.kind === 'transport') return false;
  p.afPh = 'app'; p.afT = S.t;
  return true;
}
function abPlaneFly(p, dt, speed) {
  const b = S.abBase;
  if (!b) { p.afPh = null; return false; }
  const R0 = abRwy(b);
  if (p.afPh === 'app') {
    p.alt = Math.min(1, p.alt + dt / 3); speed(Math.min(220, airSpec(p.kind, p.v).spd));
    if (airSteer(p, R0.fix.x, R0.fix.y, dt) < 60) p.afPh = 'fin';
    if (!abAfOpen() || S.t - p.afT > 80) { p.afPh = null; return false; }   // 机场用不了：照旧回战区机场
    return true;
  }
  if (p.afPh === 'fin') {
    if (!abAfOpen()) { p.afPh = null; return false; }
    const [tx, ty] = eaW(b, R0.u0, 0), d = dist(p.x, p.y, tx, ty);
    speed(110); p.alt = Math.max(.02, Math.min(p.alt, d / 380));
    airSteer(p, tx, ty, dt, true);
    if (d < 18) { p.afPh = 'roll'; p.ru = R0.u0; p.alt = 0; }
    return true;
  }
  if (p.afPh === 'roll') {   // 落地滑跑，停到跑道中段后滑进机位整备
    p.spd = Math.max(0, p.spd - 70 * dt); p.ru += R0.dir * Math.max(10, p.spd) * dt;
    [p.x, p.y] = eaW(b, p.ru, 0); p.heading = Math.atan2(R0.hy, R0.hx); p.alt = 0; p.bank = 0;
    if (p.spd <= 12 || Math.abs(p.ru) < 10) {
      p.dead = true;
      const w = airWing(p);
      if (w && w.state !== 'lost') { w.state = 'rearm'; w.rearmT = AB.rearm; w.af = true; }
      S.ab.fuel = Math.max(0, S.ab.fuel - 1);
      abStat('abAfLand');
      log(`${airName(p.kind, p.v)}在夺取的机场降落整备`, 'info', 'abafl', 6, p);
    }
    return true;
  }
  if (p.afPh === 'tko') {   // 从机场起飞：沿跑道加速，滑跑 250 或速度够了离地，转入出航
    speed(airSpec(p.kind, p.v).spd); const st = Math.max(30, p.spd) * dt; p.ru += R0.dir * st; p.rd = (p.rd || 0) + st;
    [p.x, p.y] = eaW(b, p.ru, 0); p.heading = Math.atan2(R0.hy, R0.hx); p.alt = Math.max(0, (p.spd - 120) / 140);
    if (p.rd > 250 || p.spd > 200) { p.afPh = null; p.alt = Math.max(p.alt, .2); }
    return true;
  }
  p.afPh = null;
  return false;
}
// 停在机场的飞机出击：从跑道入口滑跑起飞（launchPlane 已选中这架 w）
function abTakeoff(w, kind, tx, ty) {
  const b = S.abBase;
  if (!b || !abAfOpen()) return false;
  const R0 = abRwy(b), [x, y] = eaW(b, R0.u0, 0);
  const p = airNew(w, kind, x, y, Math.atan2(R0.hy, R0.hx), clamp(tx, 10, W - 10), clamp(ty, 10, H - 10), { phase: 'out', land: true, alt: 0, spd: 20, afPh: 'tko', ru: R0.u0 });
  S.planes.push(p);
  w.state = 'out';
  if (typeof airCount === 'function') airCount();
  log(`${airName(kind, w.v)}从夺取的机场起飞`, 'info', 'airup', 1.5);
  return true;
}

// —— 夺取 / 失守 ——
function abCapture() {
  const A = S.ab, af = abAF(), b = af && S.enemies.find(e => e.id === af.af);
  if (!b || S.abBase) return;
  S.enemies = S.enemies.filter(e => e !== b);
  S.abBase = b; b.ours = true; b.kx = b.x; b.ky = b.y;
  const eng = S.teams.some(q => q.side === 'p' && q.men.length && q.ab === 'eng'), wasDead = b.dead;
  if (b.dead) Object.assign(b, { dead: false, hp: b.maxhp * .4, rb: null });   // 被毁的机场：工兵按废墟抢修
  const fix = b.denied || wasDead ? (eng ? AB.denyEng : AB.deny) : Math.max(0, (b.cratT || 0) - S.t);
  b.cratT = fix > 0 ? S.t + fix : 0; b.fixD = fix;
  // 停在机场上的敌机：被缴获 / 就地击毁
  let n = 0;
  if (S.eair) for (const w of S.eair.wing) if ((w.state === 'ready' || w.state === 'rearm') && !w.farp && !(typeof eaBases === 'function' && eaBases().length)) { w.state = 'lost'; n++; }   // 疏散到机场外前沿加油弹药点的不算
  if (S.eair) S.eair.said.base = 1;
  A.capT = S.t; A.st = 'hold';
  abStat('abCap');
  log(`夺取敌野战机场${n ? `，停放的敌机 ${n} 架被缴获或击毁` : ''}`, 'good', null, 0, af);
  abSay('p', `报告：空降兵夺取敌野战机场${n ? `，缴获、击毁停放的敌机 ${n} 架` : ''}！${fix > 0 ? `跑道${b.denied ? '被守敌炸毁' : '有弹坑'}，工兵抢修约 ${Math.round(fix)} 秒。` : '跑道完好。'}命令：各排就地转入环形防御，一个排前出阻击敌预备队；跑道修通后组织机降。`, { kind: 'report', at: af, lv: 0 });
  abPerimeter();
}
function abLoseBase() {
  const A = S.ab, b = S.abBase;
  if (!b) return;
  S.abBase = null; b.ours = false; b.kx = b.x; b.ky = b.y;
  b.cratT = Math.max(b.cratT || 0, S.t + 90); b.denied = false;   // 守军夺回后要抢修跑道
  S.enemies.push(b);
  let n = 0;
  if (S.air) for (const w of S.air.wing) if (w.af && (w.state === 'deck' || w.state === 'rearm')) { w.state = 'lost'; n++; }
  for (const p of S.planes) if (!p.dead && (p.ab === 'land' && p.phase !== 'out' || p.afPh === 'roll')) { p.dead = true; n++; }
  if (S.air) for (const w of S.air.wing) if (w.af) w.af = false;
  if (typeof airCount === 'function') airCount();
  A.st = 'lost'; A.lostT = S.t;
  abStat('abLost');
  log(`敌军夺回野战机场${n ? `，停在机场的我方飞机 ${n} 架被毁` : ''}`, 'bad', null, 0, b);
  abSay('p', `报告：野战机场遭敌反冲击失守${n ? `，停在机场的飞机 ${n} 架被毁` : ''}。决心：残部就近反击夺回，主力加速向机场方向打通。`, { kind: 'report', at: b, lv: 0 });
}
// 环形防御：最强的排守机场核心，次强的排前出到敌预备队来路 120–160 的阻击阵地（掩护好、可通行）
function abPerimeter() {
  const A = S.ab, af = abAF(), P = typeof apEnsure === 'function' ? apEnsure() : null;
  if (!af || !P) return;
  const us = A.us.map(id => UNIT_MAP.get(id)).filter(u => u && u.state !== 'rout' && teamsOf(u).length).sort((a, b) => (b.men || 0) - (a.men || 0));
  if (!us.length) return;
  const dir = abThreatDir(af);
  if (typeof apGarrison === 'function') apGarrison(us[0], af, P);
  if (us[1]) {
    let best = null, bs = -Infinity;
    for (let k = 0; k < 24; k++) {
      const a = dir + (k / 24 - .5) * 1.2, r = 120 + (k % 3) * 20, x = af.x + Math.cos(a) * r, y = af.y + Math.sin(a) * r;
      if (!passInf(x, y)) continue;
      const s = (1 - coverAt(x, y)) * 3 - Math.abs(r - 140) / 60 + Math.random() * .2;
      if (s > bs) { bs = s; best = { x, y }; }
    }
    if (best && us[1].auto !== false) { const pl = P.u[us[1].id] || (P.u[us[1].id] = {}); Object.assign(pl, { ph: 'ab', obj: null, next: S.t + 2 }); apMove(us[1], pl, best.x, best.y, dir, 'move'); A.blk = { u: us[1].id, x: Math.round(best.x), y: Math.round(best.y), a: dir }; }
  }
  for (const u of us.slice(2)) if (u.auto !== false && typeof apGarrison === 'function') apGarrison(u, af, P);   // 玩家手动指挥的排不接管
  // 工兵组去跑道
  const b = S.abBase;
  if (b) for (const q of S.teams) if (q.side === 'p' && q.men.length && q.ab === 'eng' && !(unitOf(q) && unitOf(q).auto === false) && typeof apTeamGo === 'function') { const [x, y] = eaW(b, gauss() * 240, 26); apTeamGo(q, x, y, 'move'); }
}
// 敌人最可能来的方向：已知敌人（机场 900 以内）的重心，没有就朝敌指挥所
function abThreatDir(af) {
  let x = 0, y = 0, n = 0;
  for (const f of abFoes()) { const d = dist(f.x, f.y, af.x, af.y); if (d < 900 && d > 60) { x += f.x * f.n; y += f.y * f.n; n += f.n; } }
  if (n) return Math.atan2(y / n - af.y, x / n - af.x);
  const hq = S.points.find(p => p.key === 'HQ' && p.owner !== 'p');
  return hq ? Math.atan2(hq.y - af.y, hq.x - af.x) : NORTH;
}

// —— 空降场与机场的火力支援（会师前；每 6 秒一次）：舰炮够得着先用舰炮，其次垂发导弹（车辆、防空）、对地支援机 ——
function abFires() {
  const A = S.ab, af = abAF();
  if (!af || S.t - A.fT < 6) return;
  A.fT = S.t;
  const c = { x: A.st === 'asm' ? A.dz.x : af.x, y: A.st === 'asm' ? A.dz.y : af.y };
  let best = null, bs = 0;
  for (const f of abFoes()) {
    const d = dist(f.x, f.y, c.x, c.y);
    if (d > 320 || d < 45 || S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, f.x, f.y) < 55)) continue;
    let w = 0;
    for (const g of abFoes()) if (dist(g.x, g.y, f.x, f.y) < 45) w += g.n;
    if (f.v) w += 4;
    if (w > bs) { bs = w; best = f; }
  }
  if (!best || bs < 4) return;
  const key = Math.round(best.x / 60) + ',' + Math.round(best.y / 60);
  if (S.t - (A.shT[key] ?? -99) < 25) return;
  let how = null;
  if (typeof cmdFire === 'function' && S.dd && S.dd.state !== 'sunk' && (S.dd.auto || S.role === 'spectate') && dist(S.dd.x, S.dd.y, best.x, best.y) < 980 && cmdFire(best.x, best.y, 2, 'ab')) how = '舰炮';
  else if (best.v && typeof vlsCan === 'function' && vlsCan('lacm', best.x, best.y) && vlsFire('lacm', best.x, best.y, 1, 'ab')) how = '垂发导弹';
  else if (typeof cmdAir === 'function' && S.cv && S.cv.auto && S.assets.cas > 0 && cmdAir('cas', best.x, best.y)) how = '对地支援机';
  if (!how) return;
  A.shT[key] = S.t;
  abStat('abFire');
  abSay('p', `请求：空降兵报告${abWhere(best.x, best.y)}有敌约 ${Math.round(bs)} 人逼近${A.st === 'asm' ? '空降场' : '机场'}，${how}火力支援。`, { kind: 'order', at: best, key: 'abf', gap: 15, lv: 1 });
}

// 兵力：空降兵现有人数（含 ZBD-03 车组）；机场守敌估计（自动指挥的估计，没看见时按据点分值估）
const abMen = us => us.reduce((a, u) => a + teamsOf(u).reduce((b, q) => b + q.men.length, 0), 0) + (S.ab.vs || []).reduce((a, id) => { const v = typeof vehById === 'function' ? vehById(id) : null; return a + (v && !v.dead ? vehCrew(v) : 0); }, 0);
const abEst = af => typeof apEstimate === 'function' ? apEstimate(af) : 8;
const abNear = (af, us) => Math.max(abMen(us), abMenNear('p', af.x, af.y, 420) + (S.ab.vs || []).reduce((a, id) => { const v = typeof vehById === 'function' ? vehById(id) : null; return a + (v && !v.dead ? vehCrew(v) : 0); }, 0));
const abStrong = (af, us) => abNear(af, us) >= Math.max(18, abEst(af) * AB.odds);
// —— 进攻方每 2 秒 ——
function abThink() {
  const A = S.ab, af = abAF();
  if (!af) return;
  if (inVision(af.x, af.y)) A.seenT = S.t;
  // 机场易手
  if (!S.abBase && af.owner === 'p' && af.prog >= .99) abCapture();
  else if (S.abBase && af.owner !== 'p') abLoseBase();
  switch (A.st) {
    case 'wait': case 'shape': {
      if (!(S.assets.abn > 0) || !abAI() || S.t < 90) return;
      const E = abEval();
      if (!E || !E.dz) return;
      const ok = E.beach && E.front < 1400 && E.air !== 'e', good = ok && E.aaW <= 1 && E.near <= 18 && E.seen;
      if (A.st === 'wait') {
        if (!ok || S.t - (A.planT ?? -999) < 30) return;
        A.st = 'shape'; A.shapeT = S.t; A.planT = S.t;
        const need = [E.aaW > 1 && '航线与空降场附近的防空', !E.seen && '机场一带的敌情', E.near > 18 && `机场附近约 ${Math.round(E.near)} 人的守敌`].filter(Boolean);
        abSay('p', `判断：主力已在滩头站稳、前沿离敌野战机场约 ${Math.round(E.front)} 米，会师有望；${need.length ? `尚需解决${need.join('、')}。决心：先塑造条件再空降。` : '空降条件基本具备。'}`, { kind: 'plan', at: E.af, lv: 0 });
      }
      const did = abShape(E);
      if (did.length) abSay('p', `命令：为空降夺取机场塑造条件——${did.join('；')}。`, { kind: 'order', at: E.dz, key: 'abshape', gap: 20, lv: 1 });
      const late = S.t - A.shapeT > AB.shape;
      if (good || (late && E.aaW <= 2.5 && E.air !== 'e')) {
        const rw = abCloseRunway(E);
        if (rw && !A.rwWait) { A.rwWait = S.t; abSay('p', `命令：${rw}。`, { kind: 'order', at: E.b, lv: 1 }); return; }
        if (A.rwWait && S.t - A.rwWait < 12) return;   // 等封跑道的导弹落地
        abGo(E, good ? '判断：防空已压制、敌预备队被主力吸住，' : `判断：塑造已进行 ${Math.round(S.t - A.shapeT)} 秒，残余防空不足以阻止空降，`);
      } else if (late && S.t - A.shapeT > AB.shape * 2) {   // 迟迟不具备条件：推迟，过一分钟再判断
        A.st = 'wait'; A.planT = S.t + 30;
        abSay('p', `判断：机场方向${E.aaW > 2.5 ? '防空仍强' : '敌兵力仍多'}，空降风险过大。决心：推迟空降，继续以火力削弱后再定。`, { kind: 'plan', at: E.af, key: 'abdelay', gap: 90, lv: 1 });
      }
      return;
    }
    case 'pf': {   // 蛟龙先遣落地后标定空降场（主力散布收窄），时间到就让主力起飞
      const jl = S.units.find(u => u.side === 'p' && u.emblem === 'para' && u.paEv != null && teamsOf(u).length && dist(u.x, u.y, A.dz.x, A.dz.y) < 200);
      if (jl) A.pfM = true;
      if (S.t - A.pfT >= AB.pfLead) { abLift(); if (A.pfM) abSay('p', '报告：蛟龙突击队已在空降场就位、标定落点。空降兵连跟进伞降。', { kind: 'report', at: A.dz, lv: 1 }); }
      return;
    }
    case 'air': {
      for (const r of A.tr) {   // 跳完之前被击落：机上人员装备损失
        const p = S.planes.find(o => o.id === r.id);
        if (r.gone || (p && !p.dead)) continue;
        r.gone = true;
        const n = r.sq.reduce((a, k) => a + AB_SQ[k].length, 0), nv = r.veh.length;
        if (n || nv) { A.lost += n; log(`运-20 在空降场前被击落，机上${[n && `伞兵 ${n} 人`, nv && `ZBD-03 ${nv} 辆`].filter(Boolean).join('、')}损失`, 'bad', null, 0, A.dz); abStat('abTrDown'); }
      }
      if (A.tr.every(r => r.done || r.gone) && !A.ch.length) {
        A.st = 'asm'; A.t = S.t;
        abSay('p', `报告：空降兵连伞降完毕，${A.land} 个组落地${A.vs.length ? `，ZBD-03 ${A.vs.length} 辆` : ''}${A.lost ? `，空中损失 ${A.lost} 人` : ''}，正在集合点集结。`, { kind: 'report', at: A.dz, lv: 0 });
      }
      return;
    }
    case 'asm': {
      const us = A.us.map(id => id != null && UNIT_MAP.get(id)).filter(u => u && teamsOf(u).length);
      if (!us.length) { A.st = 'end'; abSay('p', '报告：空降兵连落地后被敌打散，夺取机场的行动失败。', { kind: 'report', at: A.dz, lv: 0 }); return; }
      const rvOf = q => A.rv[A.us.indexOf(q.u)] || A.dz, ts = us.flatMap(u => teamsOf(u)), atRv = ts.filter(q => dist(q.x, q.y, rvOf(q).x, rvOf(q).y) < 50).length;
      abFires();
      if (atRv < ts.length * .7 && S.t - A.t < AB.asm) return;
      if (!A.go && !abStrong(af, us)) {
        A.st = 'dfd'; A.t = S.t;
        for (const u of us) { const pl = apEnsure().u[u.id]; if (pl && u.auto !== false) apMove(u, pl, (A.rv[A.us.indexOf(u.id)] || A.dz).x, (A.rv[A.us.indexOf(u.id)] || A.dz).y, A.face ?? NORTH, 'move'); }
        abSay('p', `判断：落地兵力约 ${abMen(us)} 人，机场守敌估计 ${Math.round(abEst(af))} 人，兵力不足以强攻。决心：就地固守空降场，火力削弱机场守敌，待兵力占优或主力靠近再攻。`, { kind: 'plan', at: A.dz, lv: 0 });
        return;
      }
      A.st = 'atk'; A.t = S.t;
      const P = apEnsure(), ord = us.slice().sort((a, b) => (b.men || 0) - (a.men || 0));
      ord.forEach((u, i) => { if (typeof apTask === 'function') apTask(u, 'AF', i === 2 ? (Math.random() < .5 ? 1 : -1) : 0); if (P.mis) P.mis[u.id] = 'AF'; });
      const v1 = UNIT_MAP.get(A.us[1]) || ord[0];
      for (const id of A.vs) { const v = typeof vehById === 'function' ? vehById(id) : null; if (v && !v.dead && v1) { v.buddy = v1.id; v.esc = { back: 45, lat: 0, mode: 'travel' }; } }
      const pre = typeof cmdFoeAt === 'function' ? cmdFoeAt(af, 150) : null;
      if (pre && typeof cmdFire === 'function' && S.dd && S.dd.state !== 'sunk' && dist(S.dd.x, S.dd.y, pre.x, pre.y) < 980) cmdFire(pre.x, pre.y, 3, 'ab');
      abSay('p', `命令：集结完毕（${ts.length} 个组 ${ts.reduce((a, q) => a + q.men.length, 0)} 人）。${ord.length > 2 ? `${typeof cmdUName === 'function' ? cmdUName(ord[0]) : unitName(ord[0])}、${typeof cmdUName === 'function' ? cmdUName(ord[1]) : unitName(ord[1])}正面主攻，${typeof cmdUName === 'function' ? cmdUName(ord[2]) : unitName(ord[2])}从侧翼发起` : '各排'}，ZBD-03 伴随，夺取机场${pre ? '；舰炮先压制机场守敌' : ''}。`, { kind: 'order', at: af, lv: 0 });
      return;
    }
    case 'dfd': {   // 固守空降场：火力削弱机场守敌；兵力占优、主力进到机场 600 以内、或固守 AB.dfd 秒后兵力不比守敌少，就发起
      abFires(); abPrep(af);
      const us = A.us.map(id => id != null && UNIT_MAP.get(id)).filter(u => u && teamsOf(u).length);
      if (!us.length) { A.st = 'end'; return; }
      if (abStrong(af, us) || (S.t - A.t > AB.dfd && abNear(af, us) >= abEst(af) * 1.1)) {   // 兵力占优（主力赶到也算）或固守够久、兵力不比守敌少
        A.st = 'asm'; A.t = S.t - AB.asm; A.go = true;
        abSay('p', `判断：机场方向我兵力约 ${abNear(af, us)} 人，守敌估计 ${Math.round(abEst(af))} 人。决心：空降兵连发起攻击，夺取机场。`, { kind: 'plan', at: af, lv: 1 });
      }
      return;
    }
    case 'atk': {
      abFires();
      const men = A.us.map(id => id != null && UNIT_MAP.get(id)).filter(Boolean).reduce((a, u) => a + teamsOf(u).reduce((b, q) => b + q.men.length, 0), 0);
      if (men < A.men0 * .3 && S.t - A.t > 40) {   // 伤亡过大：转入防御，等主力会师
        A.st = 'end';
        abSay('p', `报告：空降兵连攻击机场受挫，仅剩约 ${men} 人。决心：就地转入防御，固守空降场待主力会师。`, { kind: 'report', at: A.dz, lv: 0 });
      }
      return;
    }
    case 'hold': case 'ops': {
      const b = S.abBase;
      if (!b) return;
      // 工兵抢修跑道：机场 150 以内没有敌人时，工兵在跑道上每秒多修 0.8 秒
      if ((b.cratT || 0) > S.t && !abFoeNear(b.x, b.y, 150)) {
        const eng = S.teams.some(q => q.side === 'p' && q.men.length && q.ab === 'eng' && dist(q.x, q.y, b.x, b.y) < 170);
        if (eng) b.cratT -= 2 * .8;
        if (b.cratT <= S.t) { b.cratT = 0; b.rc = []; log('夺取的机场跑道抢修完毕，可以起降', 'good', null, 0, b); }
      }
      if (A.st === 'hold' && abAfOpen() && S.t - A.capT > 15) {
        A.st = 'ops';
        abSay('p', '报告：机场跑道修通，周边 200 米内无敌。命令：运-20 依次机降轻型坦克与后续兵力，油料弹药运到后我方飞机就近在此起降。', { kind: 'order', at: b, lv: 0 });
      }
      if (A.st === 'ops' && A.al < AB_AL.length && !A.alOn && S.t >= A.alT && abAfOpen()) abAlLaunch(A.al);
      if (A.alOn && !S.planes.some(p => p.id === A.alOn && !p.dead)) A.alOn = null;
      abFires();
      return;
    }
  }
}
// 会师：主力（非空降兵）进入机场 320 以内，或机场 300 内有接通的补给点——空降兵各排交还自动指挥
function abLink() {
  const A = S.ab, af = abAF();
  if (!af || A.linked || !['asm', 'dfd', 'atk', 'hold', 'ops', 'end'].includes(A.st)) return;
  const main = S.teams.some(q => q.side === 'p' && q.men.length && !q.ab && !(unitOf(q) && (unitOf(q).ab != null || unitOf(q).emblem === 'para')) && dist(q.x, q.y, af.x, af.y) < AB.link);
  const sup = S.snet && S.snet.nodes.some(n => n.connected && !n.dead && dist(n.x, n.y, af.x, af.y) < 300);
  if (!main && !sup) return;
  A.linked = true;
  const P = typeof apEnsure === 'function' ? apEnsure() : null;
  if (P) for (const id of A.us) { const pl = id != null && P.u[id]; if (pl && pl.ph === 'ab') apIdle(pl); }
  abStat('abLink');
  abSay('p', `报告：主力与空降兵在${af.name}附近会师${S.abBase ? '，机场已在我手中' : ''}。空降兵各排交还统一指挥。`, { kind: 'report', at: af, lv: 0 });
}
// 指挥官重点方向（autopilot 读 P.pri）：空降后、会师前，机场与通往机场的敌据点加权，主力朝机场打通
function abPri() {
  const A = S.ab, af = abAF(), P = S.autoPlan;
  if (!af || !P || !P.pri || A.linked || !['asm', 'dfd', 'atk', 'hold', 'ops', 'end', 'lost'].includes(A.st)) return;
  if (af.owner !== 'p') P.pri.AF = Math.max(P.pri.AF || 0, 5);
  for (const p of S.points) if (p.key !== 'AF' && p.owner !== 'p' && dist(p.x, p.y, af.x, af.y) < 520) P.pri[p.key] = Math.max(P.pri[p.key] || 0, 2.5);
}

// —— 守方（每 1.5 秒）——
function abeThink() {
  const A = S.ab, af = abAF();
  if (!af || !S.ai) return;
  const b = abBaseObj();
  // ② 预警：雷达 / 歼击机发现运输机编队向机场方向飞行
  if (!A.said.ew && S.planes.some(p => !p.dead && p.ab === 'drop' && typeof awSeen === 'function' && awSeen('e', p.x, p.y))) {
    A.said.ew = 1;
    const u = abeReserve(af);
    abSay('e', `判断：雷达发现 4 架大型运输机编队低空向野战机场方向飞行，敌企图空降夺取机场。命令：歼击机截击运输机；机场警卫队进入阵地${u ? `；${typeof a4Name === 'function' ? a4Name(u) : '预备队'}向机场机动` : ''}。`, { kind: 'plan', at: af, lv: 0 });
  }
  // ③ 伞降中 / 刚落地：空降场 380 内的守军趁其集结未完冲击（落地之敌太多则就地坚守）
  if ((A.st === 'air' || A.st === 'asm') && A.dz && !A.said.cnt && A.land >= 4) {
    A.said.cnt = 1;
    const mine = S.teams.filter(q => q.side === 'e' && q.men.length && !q.ride && dist(q.x, q.y, A.dz.x, A.dz.y) < 380 && !(typeof a4Busy === 'function' && a4Busy(q)) && !(unitOf(q) && unitOf(q).state === 'rout'));
    const em = mine.reduce((a, q) => a + q.men.length, 0), pm = abMenNear('p', A.dz.x, A.dz.y, 120);
    if (mine.length && em * 2 >= pm) {
      const keep = mine.filter(q => q.obj === 'AF').slice(0, 2);   // 机场核心留两个组
      for (const q of mine) if (!keep.includes(q)) { aiGo(q, A.dz.x + gauss() * 25, A.dz.y + gauss() * 25, 'amove', A.dz.x, A.dz.y); q.px = null; }
      abStat('abeCnt');
      abSay('e', `命令：空降之敌立足未稳，机场附近各分队（约 ${em} 人）立即向空降场冲击，趁其集结前消灭；炮兵、航空兵打空降场。`, { kind: 'order', at: A.dz, lv: 0 });
    } else if (mine.length) abSay('e', `判断：空降之敌约 ${pm} 人，兵力占优。决心：机场各分队就地坚守，待预备队到达后再反冲击。`, { kind: 'plan', at: af, lv: 1 });
  }
  // ④ 守不住：炸跑道、毁油库，能飞的飞机转场
  if (b && !S.abBase && !b.denied && !b.dead) {
    const pm = abMenNear('p', af.x, af.y, 150), em = abMenNear('e', af.x, af.y, 150);
    if (af.prog > .35 || (pm >= 8 && pm >= em * 2)) abeDeny(b, af);
  }
}
// 就近空闲的预备排向机场机动（ai4 的机动预备队：到机场后方待机，吃紧时整排进入阵地）
function abeReserve(af) {
  let best = null, bd = 1100;
  for (const u of S.units) {
    if (u.side !== 'e' || u.kind !== 'inf' || u.role !== 'reserve' || u.state === 'rout' || (typeof a4UnitBusy === 'function' && a4UnitBusy(u.id))) continue;
    const ts = teamsOf(u).filter(q => q.men.length), c = typeof a4Cent === 'function' ? a4Cent(u) : null;
    if (!c || ts.reduce((a, q) => a + q.men.length, 0) < 4) continue;
    const d = dist(c[0], c[1], af.x, af.y);
    if (d < bd) { bd = d; best = u; }
  }
  if (best && typeof a4Adopt === 'function' && a4Adopt(best, 'AF')) return best;
  return null;
}
function abeDeny(b, af) {
  b.denied = true;
  b.cratT = S.t + 9999;   // 炸毁的跑道守军不再修（转入反冲击），我方夺取后按 AB.deny 抢修
  b.rc = [-110, -55, 0, 55, 110].map(u => ({ u: u + gauss() * 8, v: gauss() * 3, r: 6 + Math.random() * 2 }));
  b.hp = Math.max(1, b.hp * .5);
  let fly = 0, burn = 0;
  if (S.eair) for (const w of S.eair.wing) {
    if (w.farp || ((w.type === 'heli' || (typeof eaVtol === 'function' && eaVtol(w.type))) && (w.state === 'ready' || w.state === 'rearm'))) continue;   // 直升机、F-35B 不要跑道：升空疏散到机场外的前沿加油弹药点（eair.js eaScramble）
    if (w.state === 'ready') { w.state = 'lost'; fly++; }   // 转场去后方机场，本局不再出现
    else if (w.state === 'rearm') { w.state = 'lost'; burn++; }
  }
  abStat('abeDeny');
  log(inVision(b.x, b.y) || specAll() ? '敌军炸毁机场跑道、焚毁油库' : '机场方向接连传来大爆炸，疑似敌军自行破坏机场', 'warn', null, 0, b);
  abSay('e', `决心：机场守不住了。命令：工兵炸毁跑道、焚毁油库，不给敌人留下可用的机场；${fly ? `能飞的 ${fly} 架飞机立即转场后方机场；` : ''}${burn ? `整备中的 ${burn} 架就地破坏；` : ''}警卫队边打边撤，预备队组织反冲击。`, { kind: 'plan', at: af, lv: 0 });
}
// 守方炮兵的额外目标（ai2.js aiArtillery 读取）：我方占着的机场——运输机进近 / 落地、飞机起降时打跑道，平时打得少
function abeArtyTargets() {
  const out = [], b = S && S.abBase;
  if (!b || b.dead) return out;
  const busy = S.planes.some(p => !p.dead && ((p.ab === 'land' && p.phase !== 'out') || p.afPh));
  const [x, y] = eaW(b, gauss() * 280, 0);
  out.push({ x, y, v: busy ? 9 : abAfOpen() ? 3.5 : 1, vx: 0, vy: 0 });
  return out;
}
// 守方攻击机 / 武装直升机的额外目标（eair.js eaTargets 读取）：集结中的空降场
function abeAirTargets() {
  const A = S && S.ab, out = [];
  if (A && (A.st === 'asm' || A.st === 'dfd') && A.dz) out.push({ k: 'pt', x: A.dz.x, y: A.dz.y, v: 9, nm: '空降场集结之敌' });
  return out;
}
// 守方炮弹落在我方机场跑道上：弹坑封闭跑道（工兵在场修得快）
HOOK.impact.push(function abImpact(x, y, R, pw, side) {
  const b = S && S.abBase;
  if (!b || side !== 'e' || typeof eaL !== 'function') return;
  const [u, v] = eaL(b, x, y);
  if (Math.abs(u) > EA_RW.hl + 10 || Math.abs(v) > 20 + R * .5) return;
  const eng = S.teams.some(q => q.side === 'p' && q.men.length && q.ab === 'eng' && dist(q.x, q.y, b.x, b.y) < 170), fix = eng ? AB.fixEng : AB.fix;
  b.cratT = Math.max(b.cratT || 0, S.t + fix); b.fixD = fix;
  (b.rc = b.rc || []).push({ u: clamp(u, -EA_RW.hl + 5, EA_RW.hl - 5), v: clamp(v, -13, 13), r: Math.min(12, 4 + R * .25) });
  if (b.rc.length > 12) b.rc.shift();
  abStat('abRwHit');
  log('夺取的机场跑道中弹，暂停起降，工兵抢修', 'warn', 'abrw', 15, { x, y });
  // 停在机位上的我方飞机被炸
  if (S.air) for (const [k, w] of abParked().entries()) {   // 机堡里的挡得住大部分破片
    const st = EA_STAND[k];
    if (!st) break;
    const [px, py] = eaW(b, st[0], st[1]), has = st[3] === 'has';
    if (dist(px, py, x, y) < (has ? R * .35 + 3 : R * .6 + 8) && Math.random() < (has ? .3 : .5)) { w.state = 'lost'; log(`停在机场的${airName(w.type, w.v)}被炮火击毁`, 'bad', null, 0, { x: px, y: py }); }
  }
});
// 停在夺取的机场上的我方飞机（按机位顺序）
const abParked = () => S.air ? S.air.wing.filter(w => w.af && (w.state === 'deck' || w.state === 'rearm')) : [];

// —— 每步 ——
function abStep(dt) {
  if (!S || S.phase !== 'battle' || S.over) return;
  const A = abEnsure();
  if (!abAF() && S.enemies.some(e => e.kind === 'airfield' && !e.dead)) abMakeAF();   // 沙盒：开战后补建据点
  if (A.ch.length) abChutes(dt);
  abPri();
  if ((A.thT -= dt) <= 0) { A.thT = 2; abThink(); abLink(); }
  if ((A.eT -= dt) <= 0) { A.eT = 1.5; abeThink(); }
}
HOOK.step.push(abStep);

// —— 按键：Shift+K 选空降夺取机场（点敌机场附近）——
HOOK.key.push(function abKey(e) {
  if (!S || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.key.toUpperCase() !== 'K' || S.phase === 'sandbox') return false;
  if (typeof setTool === 'function') setTool('abn');
  return true;
});

// —— 绘制：下降中的伞兵（我方绿色伞衣）与重装平台；空降场、集合点；选择工具时的预览 ——
function abDraw(time) {
  const A = S && S.ab;
  if (!A || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, r = Math.max(4, px(5));
  if (A.dz && ['pf', 'air', 'asm', 'dfd'].includes(A.st) && inView(A.dz.x, A.dz.y, 120)) {
    ctx.strokeStyle = rgba(COL.g, .45 + .25 * Math.sin(time * 4)); ctx.lineWidth = px(1.3); ctx.setLineDash([px(4), px(4)]);
    ctx.beginPath(); ctx.arc(A.dz.x, A.dz.y, (A.sig || AB.sig) * 1.8, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    for (const p of A.rv.slice(1)) { ctx.beginPath(); ctx.moveTo(p.x - px(5), p.y - px(5)); ctx.lineTo(p.x + px(5), p.y + px(5)); ctx.moveTo(p.x + px(5), p.y - px(5)); ctx.lineTo(p.x - px(5), p.y + px(5)); ctx.stroke(); }
  }
  for (const c of A.ch) {
    if (!inView(c.x, c.y, 60)) continue;
    const T = c.k === 'veh' ? AB.heavy : AB.jump, u = clamp(c.t / T, 0, 1), h = (1 - u) * 40, x = c.x, y = c.y - h, big = c.k === 'veh';
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, r * (big ? 1.6 : .9), r * (big ? .8 : .45), 0, 0, 7); ctx.fill();
    if (R.fx3d) continue;   // 3D 时伞衣立体画（v3units.js），贴图里只留地面投影
    if (realLook()) { ctx.fillStyle = c.k === 'crate' || c.k === 'veh' ? '#d9d6c8' : '#6d7650'; ctx.strokeStyle = 'rgba(30,32,26,.75)'; ctx.lineWidth = px(.9); }   // 写实：橄榄绿人员伞、白色货运伞
    else { ctx.fillStyle = 'rgba(2,10,6,.85)'; ctx.strokeStyle = rgba(COL.g, .95); ctx.lineWidth = px(1.2); }
    for (const o of big ? [-1, 0, 1] : [0]) {
      ctx.beginPath(); ctx.arc(x + o * r * 1.8, y - r * (big ? 2.4 : 1.6), r * (big ? 1.2 : 1), Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + o * r * 1.8 - r, y - r * (big ? 2.4 : 1.6)); ctx.lineTo(x, y); ctx.lineTo(x + o * r * 1.8 + r, y - r * (big ? 2.4 : 1.6)); ctx.stroke();
    }
    if (big) { ctx.fillStyle = rgba(COL.g, .9); ctx.fillRect(x - r * .9, y - r * .3, r * 1.8, r * .9); }
    else if (c.k === 'crate') { ctx.fillStyle = rgba(COL.amber, .95); ctx.fillRect(x - r * .4, y - r * .2, r * .8, r * .6); }
    else { ctx.fillStyle = rgba(COL.g, .95); ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, px(2)), 0, 7); ctx.fill(); }
  }
  if (A.blk && S.abBase && inView(A.blk.x, A.blk.y, 80)) {   // 阻击阵地：朝敌来路的弧线
    ctx.strokeStyle = rgba(COL.g, .5); ctx.lineWidth = px(1.6);
    ctx.beginPath(); ctx.arc(A.blk.x, A.blk.y, 26, A.blk.a - .8, A.blk.a + .8); ctx.stroke();
  }
}
HOOK.drawOver.push(abDraw);
HOOK.drawTop.push(function abDrawTop() {
  if (typeof U !== 'object' || U.tool !== 'abn' || !U.mouse || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, m = U.mouse, af = abAF(), ok = af && S.assets.abn > 0 && !S.abBase && dist(m.x, m.y, af.x, af.y) < 700, col = ok ? COL.g : COL.enemy;
  ctx.strokeStyle = rgba(col, .9); ctx.lineWidth = px(1.5); ctx.setLineDash([px(4), px(4)]);
  ctx.beginPath(); ctx.arc(m.x, m.y, 30, 0, 7); ctx.stroke();
  if (af) { ctx.beginPath(); ctx.arc(af.x, af.y, 700, 0, 7); ctx.stroke(); }
  ctx.setLineDash([]);
});
HOOK.newGame.push(() => { if (typeof U === 'object' && U.tool === 'abn') U.tool = null; });
