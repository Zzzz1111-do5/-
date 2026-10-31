'use strict';
// 呼叫火力（进攻方）：岸上步兵发现敌密集火力点 → 由发现的排上报（方位、兵力、火器）→ 指挥所比较各种火力的到达时间，派最快、又不会误伤的那一种：
//   ① 在空的对地支援机（出航或盘旋中，700 以内）：改派过去，最快，危险近距 45 也能打；
//   ② 驱逐舰舰炮（射程内、不在损管）：约 5–8 秒，我军须在 70 以外；沙盒护航舰按告急区转火支援；
//   ③ 驱逐舰垂发对地导弹（碉堡 / 炮位等硬目标，vls.js）：几秒到十几秒，精度高；
//   ④ 甲板 / 战区机场待命的对地支援机（双机编队，按起飞 + 航程算）；敌防空没压掉时改派隐身的歼-35（精确制导炸弹）。
// 密集火力点：视野内敌步兵组（机枪手按 2.5 人算）、碉堡（6）、迫击炮（3）、敌战车（4–6），70 半径内合计 ≥ 7；
//   我方有组在 320 以内看到它才算「发现」。同一处 45 秒内只呼叫一次。地图上画呼叫标记（12 秒）。
// 状态：S.cf = { t 下次检查, calls: [{x, y, t, a 火力种类, eta, by}] }
const CF = { r: 70, min: 7, see: 320, gap: 45, near: 110, mark: 12 };
const CF_NM = { cas: '对地支援机', naval: '舰炮', vls: '驱逐舰垂发导弹', deck: '舰载对地支援机', strike: '歼-35 精确制导炸弹', ask: '舰炮（待您批准）' };

function cfItems() {
  const out = [];
  for (const q of S.teams) if (q.side === 'e' && q.men.length && inVision(q.x, q.y)) out.push({ x: q.x, y: q.y, w: q.men.length + q.men.filter(m => m === 'mg').length * 1.5, men: q.men.length, mg: q.men.filter(m => m === 'mg').length });
  for (const e of S.enemies) if (!e.dead && inVision(e.x, e.y) && (e.kind === 'bunker' || e.kind === 'mortar')) out.push({ x: e.x, y: e.y, w: e.kind === 'bunker' ? 6 : 3, bk: e.kind === 'bunker' ? 1 : 0, mo: e.kind === 'mortar' ? 1 : 0, hard: true });
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && inVision(v.x, v.y)) out.push({ x: v.x, y: v.y, w: v.type === 'tank' ? 6 : 4, vh: 1, hard: true });
  for (const a of S.armor || []) if (!a.dead && inVision(a.x, a.y)) out.push({ x: a.x, y: a.y, w: 4, vh: 1, hard: true });
  return out;
}
// 聚类：以每个火力为中心统计 70 内合计，贪心取最强且互不重叠（相距 120 以上）的几处
function cfClusters() {
  const I = cfItems(), C = [];
  for (const o of I) {
    let w = 0, x = 0, y = 0, men = 0, mg = 0, bk = 0, mo = 0, vh = 0, hard = 0;
    for (const p of I) if (dist(p.x, p.y, o.x, o.y) < CF.r) { w += p.w; x += p.x * p.w; y += p.y * p.w; men += p.men || 0; mg += p.mg || 0; bk += p.bk || 0; mo += p.mo || 0; vh += p.vh || 0; hard += p.hard ? 1 : 0; }
    if (w >= CF.min) C.push({ x: x / w, y: y / w, w, men, mg, bk, mo, vh, hard });
  }
  C.sort((a, b) => b.w - a.w);
  const out = [];
  for (const c of C) if (!out.some(o => dist(o.x, o.y, c.x, c.y) < 120)) out.push(c);
  return out.slice(0, 3);
}
const cfDesc = c => [c.men ? `约 ${c.men} 人${c.mg ? `（机枪 ${c.mg} 挺）` : ''}` : '', c.bk ? `碉堡 ${c.bk} 座` : '', c.mo ? `迫击炮 ${c.mo} 门` : '', c.vh ? `战车 ${c.vh} 辆` : ''].filter(Boolean).join('，');

// 各种火力到这一点的到达时间（秒）；不可用返回 null。near = 我军最近的组离目标多远
function cfOptions(c, near) {
  const O = [], dd = S.dd, ddOk = dd && dd.state !== 'sunk' && isFinite(dd.x) && dd.x > -999;
  if (near >= 45) {
    let bp = null, bd = 700;
    for (const p of S.planes || []) if (!p.dead && p.kind === 'cas' && (p.phase === 'loiter' || p.phase === 'out') && p.alt > .4) {
      const d = dist(p.x, p.y, c.x, c.y), busy = p.phase === 'loiter' && S.teams.some(q => q.side === 'e' && q.men.length && inVision(q.x, q.y) && dist(q.x, q.y, p.cx, p.cy) < 120 && dist(p.cx, p.cy, c.x, c.y) > 160);
      if (d < bd && !busy) { bd = d; bp = p; }
    }
    if (bp) O.push({ a: 'cas', eta: bd / 150 + 1, p: bp });
  }
  if (near >= 70 && ddOk && dd.state === 'ready' && dist(dd.x, dd.y, c.x, c.y) < 990) {
    const q = cmdOn() ? S.cmd.p.fm.filter(m => m.n > 0).length : 0;
    O.push({ a: cmdCtl(dd) ? 'naval' : 'ask', eta: Math.max(0, dd.cool) + 2.2 + q * 5 + (cmdCtl(dd) ? 0 : 8) });
  }
  if (near >= 70 && c.hard && typeof vlsCan === 'function' && vlsCan('lacm', c.x, c.y)) O.push({ a: 'vls', eta: vlsEta('lacm', c.x, c.y) + 2 });
  if (near >= 45 && S.cv && cmdCtl(S.cv) && S.air && typeof airReady === 'function') {
    const closed = typeof cmdAirClosed === 'function' && cmdAirClosed(c.x, c.y);
    const k = closed ? 'strike' : 'cas';
    if (S.assets[k] > 0 && airReady(k)) {
      const w = S.air.wing.find(o => o.type === k && o.state === 'deck'), land = w && airLandW(w), cv = !land && cvOf(cvHome(w));
      if (w && (land || (cv && cv.hp > 0))) O.push({ a: k === 'cas' ? 'deck' : 'strike', eta: (land ? (H - c.y + 300) : 6 + dist(cv.x, cv.y, c.x, c.y)) / (k === 'cas' ? 170 : 240) + (land ? 0 : 6) });
    }
  }
  return O.sort((a, b) => a.eta - b.eta);
}

// 没有可用火力时让前沿等什么：只说还在的（舰炮没了就不提舰炮）
function cfWait() {
  const w = [];
  if (typeof navGunUp === 'function' && navGunUp()) w.push('舰炮');
  if ((S.cv && S.cv.hp > 0) || (S.planes || []).some(p => !p.dead && (p.kind === 'cas' || p.kind === 'strike')) || (typeof airLandW === 'function' && S.air && S.air.wing.some(o => o.state !== 'lost' && airLandW(o)))) w.push('航空兵');
  return w.length ? `，等待${w.join('或')}` : '，组织爆破组逐个拔除';
}
let vlsShooter = '驱逐舰';
function cfStep(dt) {
  if (!S || S.phase !== 'battle' || S.over || !cmdOn()) return;
  const F = S.cf || (S.cf = { t: 0, calls: [] });
  F.calls = F.calls.filter(o => S.t - o.t < CF.gap);
  if (S.t < F.t) return;
  F.t = S.t + 2;
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y));
  if (!pT.length) return;
  for (const c of cfClusters()) {
    if (F.calls.some(o => dist(o.x, o.y, c.x, c.y) < CF.near)) continue;
    let obs = null, od = CF.see, near = Infinity;
    for (const q of pT) { const d = dist(q.x, q.y, c.x, c.y); if (d < od) { od = d; obs = q; } }
    if (!obs || od < 40) continue;   // 已经短兵相接：靠建制火力，支援火力打不进来
    for (const q of S.teams) if (q.side === 'p' && q.men.length) near = Math.min(near, dist(q.x, q.y, c.x, c.y));
    if (S.shells.some(s => s.side === 'p' && !s.done && dist(s.x1, s.y1, c.x, c.y) < 60)) continue;   // 已经有炮弹在往这儿落
    const O = cfOptions(c, near), u = typeof unitOf === 'function' ? unitOf(obs) : null, nm = typeof cmdUName === 'function' ? cmdUName(u) : '前沿分队';
    const at = { x: Math.round(c.x), y: Math.round(c.y) }, wh = cmdWhere(c.x, c.y);
    F.calls.push({ ...at, t: S.t, a: O[0] ? O[0].a : null, eta: O[0] ? O[0].eta : 0, by: nm });
    v8Stat('cfCall');
    chatSay('p', `报告：${nm}在${wh}发现敌密集火力点（${cfDesc(c)}），距我 ${Math.round(od)} 米，请求火力支援。`, { kind: 'report', at, key: 'cfr' + Math.round(c.x / 150) + '_' + Math.round(c.y / 150), gap: 40, lv: 2 });
    const who = u || obs, sh = (t, o) => typeof shout === 'function' && shout(who, t, o);   // 请求、答复由前沿排自己喊（shout.js），通联里只留详档
    sh('发现敌火力点，请求火力支援！');
    if (!O.length) { chatSay('p', `答复：${nm}，附近暂无可用的支援火力，就地隐蔽、以建制火力压制${cfWait()}。`, { kind: 'remedy', at, delay: 1.5, key: 'cfnone', gap: 40, lv: 2 }); sh('没有支援火力，就地隐蔽压制！', { delay: 2.5 }); v8Stat('cfNone'); continue; }
    const o = O[0];
    v8Stat('cf_' + o.a);
    if (o.a === 'cas') {
      const p = o.p;
      Object.assign(p, { tx: at.x, ty: at.y, cx: at.x, cy: at.y, wp: [{ ...at }], leg: 0, loiterT: Math.max(p.loiterT || 0, 25), strafeT: .5 });
      if (p.phase === 'loiter') airSet(p, 'out');
    } else if (o.a === 'naval') { cmdFire(at.x, at.y, c.w >= 12 ? 4 : 3, 'call'); const C = S.cmd.p, i = C.fm.findIndex(m => m.why === 'call' && m.x === at.x && m.y === at.y); if (i > 0) C.fm.unshift(C.fm.splice(i, 1)[0]); }
    else if (o.a === 'vls') { vlsShooter = vlsWho('lacm', at.x, at.y); vlsFire('lacm', at.x, at.y, c.bk ? 2 : 1, 'call'); }
    else if (o.a === 'deck') airPkg('cas', at.x, at.y);
    else if (o.a === 'strike') airPkg('strike', at.x, at.y);
    if (typeof navEnsure === 'function' && (o.a === 'naval' || o.a === 'ask')) { const N = navEnsure(); N.hot.push({ ...at, until: S.t + 25, why: 'pin' }); }   // 沙盒护航舰也转火
    const eta = Math.max(2, Math.round(o.eta)), alt = O.slice(1).map(x => CF_NM[x.a]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 2), fnm = o.a === 'vls' ? vlsShooter + '垂发导弹' : CF_NM[o.a];
    chatSay('p', o.a === 'ask' ? `${cmdAsk(at.x, at.y)}：${nm}被敌密集火力压制。` : `命令：${fnm}${o.a === 'cas' ? '转场' : ''}支援${nm}，打击${wh}的敌火力点，约 ${eta} 秒后到达${alt.length ? `（${alt.join('、')}较慢，暂不动用）` : ''}。`, { kind: 'order', at, delay: 1.5, key: 'cfo' + at.x + '_' + at.y, gap: 30, lv: o.a === 'ask' ? 1 : 2 });
    if (o.a !== 'ask') sh(`${o.a === 'vls' ? '垂发导弹' : CF_NM[o.a]}约 ${eta} 秒后到！`, { delay: 2.5 });
  }
}

// 地图标记：呼叫点（橙色虚线圈 + 十字，12 秒）与指向它的连线（从上报的组）
function cfDraw(time) {
  if (!S || !S.cf || !S.cf.calls.length || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx;
  ctx.save();
  for (const o of S.cf.calls) {
    const age = S.t - o.t;
    if (age > CF.mark) continue;
    const a = 1 - age / CF.mark, r = 26 + Math.sin(time * 5) * 3;
    ctx.strokeStyle = rgba(COL.amber || '#ffc24a', .8 * a); ctx.lineWidth = px(1.6); ctx.setLineDash([px(4), px(4)]); ctx.lineDashOffset = -time * 12;
    ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, 6.283); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(o.x - r - 6, o.y); ctx.lineTo(o.x - r + 8, o.y); ctx.moveTo(o.x + r - 8, o.y); ctx.lineTo(o.x + r + 6, o.y);
    ctx.moveTo(o.x, o.y - r - 6); ctx.lineTo(o.x, o.y - r + 8); ctx.moveTo(o.x, o.y + r - 8); ctx.lineTo(o.x, o.y + r + 6); ctx.stroke();
  }
  ctx.restore();
}

HOOK.step.push(cfStep);
HOOK.drawOver.push(cfDraw);
HOOK.newGame.push(() => { if (S) S.cf = null; });
