'use strict';
// 电子战（照真实战场）：歼-16D 翼尖两个电子侦察 / 告警吊舱 + 进气道下两个大功率干扰吊舱——
//   ① 电子侦察（无源）：敌方雷达一开机，侦察吊舱就测得出它在哪——防空车、高炮炮瞄雷达、爱国者、C-RAM、岸基警戒雷达、舰载雷达、
//      敌战斗机的火控雷达：地面、海上的辐射源标到地图上（kx / ky、det：我方火力、反辐射弹打得到），敌战斗机雷达开着也就被发现（airwar.js awSeen）
//   ② 有源干扰（噪声压制 + 数字射频存储的欺骗干扰）：每架同时压制有限几部雷达（EW.nj，按威胁挑：能打飞机的、我方飞机正在它射程里的优先）；
//      被压的雷达对我机的探测 / 跟踪距离按烧穿距离缩短——支援干扰：有效距离 = 名义距离 × √(干扰机到雷达的距离 ÷ (名义距离 × 干扰强度 jk))，
//      干扰机离雷达越近压得越狠；干扰机自己就是目标（自卫干扰）时同一个式子算出烧穿距离 = 名义距离 ÷ jk。最低压到一成五（再近就烧穿了）；
//      雷达制导的导弹（爱国者、舰空导弹、AIM-120）打干扰机本身或它掩护半径里的飞机，命中率打折（欺骗干扰拉偏跟踪门）；红外制导的（毒刺、AIM-9X、单兵导弹）不受影响
//   ③ 代价：干扰机一直在发射，敌方的无源侦察（战斗机、军舰、岸基雷达站）老远就测得到——开着干扰就藏不住，AIM-120 还能「跟踪干扰源」直接打它（不打折）
//   ④ 反辐射：雷电-10 盯上一部雷达，操作员有一半机会关机规避（EW.emconT 秒：关机期间不能用雷达打我机、侦察不到）；关机了弹只能打记忆位置，多半打不中车本身
//   ⑤ 通信干扰：干扰机附近（EW.comm）敌军电台被压——敌炮兵常常收不到火力呼叫（ai2.js aiArtillery）
// 雷达名义距离都用各自代码里用的那个（同一套单位），所以压缩量对地面防空、舰艇、战斗机一样算
const EW = { jk: 5, nj: 4, rng: 4500, esm: 9000, cover: 900, pkJ: .55, emcon: .5, emconT: 25, comm: 1800, commP: .6, dt: .5, see: 9000 };
const EWS = { S: null, t: -99, jm: new Map(), esm: [], jp: [], log: new Set() };
const EW_W = { sam: 3, ship: 3, ftr: 2.6, ews: 2, aaa: 1.4 };   // 挑压制目标的威胁权重
const ewIsJ = p => !!p && typeof airMdlKey === 'function' && airMdlKey(p.kind, p.v) === 'j16d';
const ewUp = p => !p.dead && isFinite(p.x) && (p.alt ?? 1) > .3 && !['cat', 'roll', 'trap', 'final'].includes(p.phase) && !p.afPh;
// 干扰机（开着干扰的：AI 开的一直开；玩家开的按 J 键开关，p.jam === false 是关了）、电子侦察平台（无源，开不开干扰都在收）
const ewJammers = () => (S.planes || []).filter(p => ewIsJ(p) && ewUp(p) && p.jam !== false);
const ewEsmPlat = () => (S.planes || []).filter(p => ewIsJ(p) && ewUp(p));
// 有雷达的敌防空车：复仇者（毒刺 + 前视红外瞄准）没有雷达
const ewRadarVeh = v => { const sp = vehSp(v); return !!(sp.sam || sp.aa || (v.mod && v.mod.cram)) && !/复仇者/.test(v.mdl || ''); };
const ewVehNm = v => /爱国者/.test(v.mdl || '') ? '爱国者 AN/MPQ-65 雷达' : /M-SHORAD/.test(v.mdl || '') ? 'M-SHORAD 的 RADA 雷达' : v.mod && v.mod.cram ? 'C-RAM 火控雷达' : `${v.mdl || vehSp(v).name}的雷达`;
// 敌方雷达辐射源：{ key, o, k 种类, x, y, R0 名义距离, nm }；关机规避中的（o.emT）不在里面
function ewEmitters() {
  const out = [], on = o => !(o.emT > S.t);
  for (const e of S.enemies || []) if (!e.dead && e.kind === 'aa' && on(e)) out.push({ key: 'e' + e.id, o: e, k: 'aaa', x: e.x, y: e.y, R0: 190, nm: 'M167 火神高炮的炮瞄雷达' });
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && !v.lst && on(v) && ewRadarVeh(v)) {
    const sp = vehSp(v), M = sp.sam ? (v.samX ? { ...sp.sam, ...v.samX } : sp.sam) : null;
    out.push({ key: 'v' + v.id, o: v, k: M ? 'sam' : 'aaa', x: v.x, y: v.y, R0: M ? M.range : sp.aa || 260, nm: ewVehNm(v) });
  }
  const rd = typeof radarUp === 'function' ? radarUp() : null;
  if (rd) out.push({ key: 'rd', o: rd, k: 'ews', x: rd.x, y: rd.y, R0: 820, nm: '岸基对空 / 对海警戒雷达' });
  for (const e of S.eships || []) if (!e.dead && on(e)) { const C = (typeof NV_CLS === 'object' && NV_CLS[e.cls]) || {}; out.push({ key: 's' + e.id, o: e, k: 'ship', x: e.x, y: e.y, R0: C.radar || 600, nm: `${C.nm || '敌舰'}的舰载雷达` }); }
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && isFinite(a.x) && (a.alt ?? 1) > .2 && typeof eaFtr === 'function' && eaFtr(a.type))
    out.push({ key: 'a' + a.id, o: a, k: 'ftr', x: a.x, y: a.y, R0: ((typeof EA_FTR === 'object' && EA_FTR[a.type]) || { radar: 520 }).radar, nm: `${(typeof EA_SPEC === 'object' && EA_SPEC[a.type] || {}).name || '敌战斗机'}的火控雷达` });
  return out;
}
// 每 0.5 秒（推演时刻，不用真实时间）：电子侦察、分配压制
HOOK.step.push(() => {
  if (!S) return;
  if (EWS.S !== S) Object.assign(EWS, { S, t: -99, jm: new Map(), esm: [], jp: [], log: new Set() });
  if (S.t - EWS.t < EW.dt) return;
  EWS.t = S.t;
  const J = ewJammers(), P = ewEsmPlat(), E = ewEmitters();
  EWS.jp = J.map(j => ({ id: j.id, x: j.x, y: j.y }));
  // ① 电子侦察：辐射源标到地图上
  EWS.esm = [];
  for (const em of E) {
    if (!P.some(p => dist(p.x, p.y, em.x, em.y) < EW.esm)) continue;
    EWS.esm.push({ key: em.key, x: em.x, y: em.y, k: em.k });
    const o = em.o;
    if (em.k === 'ftr') o.esmT = S.t;
    else if (em.k === 'ship') o.det = S.t;
    else if (em.k !== 'ews' && (o.kx == null || dist(o.kx, o.ky, o.x, o.y) > 20)) { o.kx = o.x; o.ky = o.y; }
    if (em.k !== 'ftr' && !EWS.log.has(em.key)) { EWS.log.add(em.key); log(`歼-16D 电子侦察：测得${em.nm}的位置`, 'info', 'ewesm', 4, { x: em.x, y: em.y }); }
  }
  // ② 压制：每架干扰机挑威胁最大的 nj 部（太远压不住的不挑）；同一部被几架压着取最近那架
  const jm = new Map(), air = (S.planes || []).filter(p => !p.dead && (p.alt ?? 1) > .25 && isFinite(p.x));
  for (const j of J) {
    const cand = [];
    for (const em of E) {
      const d = dist(j.x, j.y, em.x, em.y);
      if (d > Math.min(EW.rng, em.R0 * EW.jk)) continue;
      const near = air.reduce((a, p) => Math.min(a, dist(p.x, p.y, em.x, em.y)), Infinity);
      cand.push({ em, d, s: (EW_W[em.k] || 1) * (near < em.R0 * 1.5 ? 2 : 1) / (1 + d / 1500) });
    }
    cand.sort((a, b) => b.s - a.s);
    for (const c of cand.slice(0, EW.nj)) { const cur = jm.get(c.em.key); if (!cur || c.d < cur.d) jm.set(c.em.key, { d: c.d, j: j.id, x: j.x, y: j.y, k: c.em.k }); }
  }
  for (const [k] of jm) if (!EWS.jm.has(k) && !EWS.log.has('j' + k)) { const em = E.find(e => e.key === k); if (em) { EWS.log.add('j' + k); log(`歼-16D 干扰压制${em.nm}`, 'info', 'ewjam', 4, { x: em.x, y: em.y }); } }
  EWS.jm = jm;
});
const ewLive = () => EWS.S === S;
// 这部雷达（key）现在被压到几成：没被压 1；被压 √(干扰机到雷达距离 ÷ (R0 × jk))，最低 0.15
function ewK(key, R0) { const J = ewLive() && EWS.jm.get(key); return J ? clamp(Math.sqrt(J.d / (R0 * EW.jk)), .15, 1) : 1; }
const ewJammed = key => ewLive() && EWS.jm.has(key);
// 雷达制导的弹（这部雷达 key 制导）打 tgt：雷达被压着，目标是干扰机本身或在它掩护半径里 → 命中率 × pkJ；hoj：AIM-120 能跟踪干扰源，打干扰机本身不打折
function ewPk(key, tgt, hoj) {
  const J = ewLive() && EWS.jm.get(key);
  if (!J || !tgt) return 1;
  if (tgt.id === J.j) return hoj ? 1 : EW.pkJ;
  return dist(tgt.x, tgt.y, J.x, J.y) < EW.cover ? EW.pkJ : 1;
}
// 我方电子侦察测到的、正开着雷达的敌战斗机在 (x, y) 附近（awSeen('p') 用）
const ewSeenP = (x, y) => ewLive() && EWS.esm.some(e => e.k === 'ftr' && dist(e.x, e.y, x, y) < 160);
// 敌方无源侦察测得到正在干扰的飞机（awSeen('e') 用）：(x, y) 附近有一架开着干扰的，敌方还有能收的平台（战斗机、军舰、岸基雷达站）在 see 以内
function ewJamSeen(x, y) {
  if (!ewLive() || !EWS.jp.length) return false;
  const j = EWS.jp.find(q => dist(q.x, q.y, x, y) < 160);
  if (!j) return false;
  if (typeof radarUp === 'function' && radarUp()) return true;
  if ((S.eships || []).some(e => !e.dead && dist(e.x, e.y, j.x, j.y) < EW.see)) return true;
  return !!(S.eair && S.eair.fly.some(a => !a.dead && (a.alt ?? 1) > .2 && typeof eaFtr === 'function' && eaFtr(a.type) && dist(a.x, a.y, j.x, j.y) < EW.see));
}
// 通信干扰：(x, y) 在某架干扰机的通信干扰半径里——这一回收不到呼叫的概率 commP
const ewComm = (x, y) => ewLive() && EWS.jp.some(j => dist(j.x, j.y, x, y) < EW.comm) && Math.random() < EW.commP;
// 反辐射弹盯上了雷达 o：操作员一半机会关机规避（emconT 秒）
function ewArm(o, nm) {
  if (!o || o.emT > S.t || Math.random() >= EW.emcon) return;
  o.emT = S.t + EW.emconT;
  log(`敌${nm || '防空雷达'}发现反辐射导弹来袭，关机规避（${EW.emconT} 秒内不能用雷达打飞机）`, 'info', 'ewemc', 4, { x: o.x, y: o.y });
}
// 驾驶时的雷达告警（v3pilot.js 画）：照着这架飞机的敌雷达（开着、它在雷达名义距离 1.6 倍以内）——{ x, y, k, jam 被压着, lock 正在用导弹打它 }；再加飞向它的导弹
function ewRwr(o) {
  if (!o || !S) return { em: [], msl: [] };
  const em = [];
  for (const e of ewEmitters()) {
    const d = dist(o.x, o.y, e.x, e.y);
    if (d > e.R0 * 1.6) continue;
    const lock = (S.missiles || []).some(m => !m.done && m.side === 'e' && m.tgt && m.tgt.k === 'plane' && m.tgt.id === o.id && dist(m.x0 ?? m.x, m.y0 ?? m.y, e.x, e.y) < 60);
    em.push({ x: e.x, y: e.y, k: e.k, jam: ewJammed(e.key), lock, d, R0: e.R0 });
  }
  const msl = (S.missiles || []).filter(m => !m.done && m.side === 'e' && m.tgt && m.tgt.k === 'plane' && m.tgt.id === o.id && m.t >= 0).map(m => ({ x: m.x, y: m.y, d: dist(m.x, m.y, o.x, o.y) }));
  return { em, msl };
}
// 平显一行：电子战状态（歼-16D）
function ewStat(o) {
  if (!ewIsJ(o) || !ewLive()) return null;
  let nj = 0;
  for (const [, J] of EWS.jm) if (J.j === o.id) nj++;
  return { on: o.jam !== false, nj, ns: EWS.esm.length };
}
