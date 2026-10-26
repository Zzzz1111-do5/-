'use strict';
// 空中作战计划（双方司令统一定，AI 指挥的一方按它派机；玩家指挥攻方时不替玩家设限）
// 三个阶段，只进不退：
//   ① 夺取制空权：只出战斗机（双机编队扫荡、巡逻）与侦察机，对地的飞机一律不出动；
//   ② 压制防空：战斗机继续巡逻，攻击机只打已知的敌防空（攻方：高炮、防空车、单兵防空组；守方：防空车、单兵防空组），近距支援仍不出动；
//   ③ 近距支援：全部放开——近距支援、打击、轰炸、武装直升机。
// 转段：敌方没有歼击机、我方掌握制空权、或我方根本没有歼击机（争不了）→ ②；第一阶段最长 3 分钟。
//   已知的敌防空都打掉、或我方没有能压制防空的飞机 → ③；第二阶段最长 2 分钟。转段时司令在通联里宣布（hqBig，大战术）
// 编队飞行：长机带僚机（同型在册飞机两架以上就出双机），起飞后长机放慢等僚机到位（集合），僚机保持在长机右后 / 左后；
//   离目标近了、接敌、长机返航才散开各打各的。
// 航线：攻方舰载机走固定的进出航线——岸线上的几个出入口（航路点），按目标选进入口、换一个相邻的出口返航，不原路折返；
//   守方飞机从机场出发先飞到目标背海一侧的起始点（IP）再进入，返航从另一侧的出航点离开。
// 巡逻 / 待机：不兜圈子——到了巡逻点沿岸线方向直飞一段（atoLeg）就返航，打完一波也返航；只有返航等着舰时在航母边飞跑马场航线（carrier.js airOrbit）
const ATO = { t1: 180, t2: 120, think: 2, gates: 6, gateOff: 140, race: 2.4 };
const ATO_NM = { 1: '夺取制空权', 2: '压制防空', 3: '近距支援' };

// 这一方由 AI 指挥空中力量吗（攻方只在观战时）
const atoAI = side => !!S && S.mode === 'sandbox' && (side === 'e' || S.role === 'spectate');
function atoEnsure() { if (!S.ato) S.ato = { p: { ph: 0, t: 0 }, e: { ph: 0, t: 0 }, thT: 0 }; return S.ato; }
// 当前阶段：不由 AI 管的一方返回 3（不设限）
function atoPhase(side) {
  if (!S || !atoAI(side)) return 3;
  const A = atoEnsure()[side];
  return A.ph || 1;
}
// 双方的歼击机：在册（没损失的）与在空的
const atoFtrP = () => !!S.air && (S.air.wing.some(w => w.type === 'fighter' && w.state !== 'lost') || (S.planes || []).some(p => !p.dead && p.kind === 'fighter'));
const atoFtrE = () => !!S.eair && (S.eair.wing.some(w => (w.type === 'ftr' || w.type === 'f22') && w.state !== 'lost') || S.eair.fly.some(a => !a.dead && (a.type === 'ftr' || a.type === 'f22')));
// 已知的敌防空（攻方所知：carrier.js airAASites；守方所知：看得见的防空车、近 2 分钟暴露过的单兵防空组）
function atoAAKnown(side) {
  if (side === 'p') return typeof airAASites === 'function' ? airAASites() : [];
  const out = [];
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && (v.type === 'aa_veh' || v.type === 'sam_veh') && (spotted(v.x, v.y) || (v.es != null && S.t - v.es < 120))) out.push({ x: v.x, y: v.y, k: 'veh', id: v.id, o: v, w: v.type === 'sam_veh' ? 2 : 1.3 });
  for (const q of S.teams) if (q.side === 'p' && q.men.length && q.men.includes('aa') && q.aaSeenE != null && S.t - q.aaSeenE < 120) out.push({ x: q.x, y: q.y, k: 'team', id: q.id, o: q, w: .8 });
  return out;
}
// 这一方已损失的飞机架数
const atoLost = side => side === 'p' ? (S.air ? S.air.wing.filter(w => w.state === 'lost').length : 0) : (S.eair ? S.eair.wing.filter(w => w.state === 'lost').length : 0);
// 能压制防空的飞机：攻方攻击机（歼-35，防空压制型更好）、歼-36 打击型；守方 A-10C（小牛）、带小直径炸弹的 F-35A
const atoSeadP = () => !!S.air && S.air.wing.some(w => (w.type === 'strike' || (w.type === 'fighter' && w.v === 'j36s')) && w.state !== 'lost');
const atoSeadE = () => !!S.eair && S.eair.wing.some(w => (w.type === 'ga' || w.type === 'ftr') && w.state !== 'lost');
function atoSay(side, ph, why) {
  const txt = { 1: `空中作战第一阶段——夺取制空权：${side === 'p' ? '歼击机' : 'F-35A / F-22A'}双机编队前出扫荡、巡逻，对地飞机一律待命，不打无制空权的仗。`,
    2: `空中作战转入第二阶段——压制防空（${why}）：攻击机专打已知的敌防空${side === 'p' ? '（高炮、防空车、单兵防空组）' : '（防空车、单兵防空组）'}，战斗机继续巡逻掩护，近距支援仍待命。`,
    3: `空中作战转入第三阶段——近距支援（${why}）：${side === 'p' ? '攻击机、对地支援机、轰炸机' : '武装直升机、攻击机'}按地面部队的需要出动，战斗机继续掌握制空权。` }[ph];
  if (typeof hqBig === 'function' && S.hq && S.hq[side]) hqBig(side, 'ato' + ph, txt);
  else if (typeof chatSay === 'function') chatSay(side, `司令：${txt}`, { kind: 'plan', lv: 0, hq: true });
}
function atoStep(dt) {
  if (!S || S.phase !== 'battle' || S.over || S.mode !== 'sandbox') return;
  const AT = atoEnsure();
  if ((AT.thT -= dt) > 0) return;
  AT.thT = ATO.think;
  for (const side of ['p', 'e']) {
    if (!atoAI(side)) continue;
    const A = AT[side], own = side === 'p' ? atoFtrP() : atoFtrE(), foe = side === 'p' ? atoFtrE() : atoFtrP(), st = typeof awState === 'function' ? awState() : null;
    const air = side === 'p' ? !!S.air && S.air.wing.some(w => w.state !== 'lost') : !!S.eair && S.eair.wing.some(w => w.state !== 'lost');
    if (!air) { A.ph = 3; continue; }   // 这一方根本没有飞机：没有空中作战计划可言，不发通报
    if (!A.ph) { A.ph = 1; A.t = S.t; if (own && foe) atoSay(side, 1); }
    if (A.ph === 1) {
      const why = !foe ? '敌方没有歼击机' : st === side ? '已取得制空权' : !own ? '我方没有歼击机，制空交给防空部队' : S.t - A.t > ATO.t1 ? '制空争夺已持续三分钟，在争夺中转入下一阶段' : null;
      if (why) { A.ph = 2; A.t = S.t; A.why = why; }
    }
    if (A.ph === 2) {
      if (!A.said2) { A.said2 = 1; atoSay(side, 2, A.why); }
      const aa = atoAAKnown(side).length, sead = side === 'p' ? atoSeadP() : atoSeadE();
      // 没发现敌防空不等于没有：至少侦察、压制 90 秒才认定「已压制」；有防空而压不动，两分钟后也转段
      if (A.l2 == null) A.l2 = atoLost(side);
      const why = !aa ? (S.t - A.t >= 90 ? '侦察与压制之后未再发现敌防空' : null) : !sead ? '我方没有能压制防空的飞机' : atoLost(side) - A.l2 >= 3 ? '压制防空代价太大，余下的敌防空改由舰炮、导弹压制' : S.t - A.t > ATO.t2 ? '压制防空已持续两分钟' : null;
      if (why) { A.ph = 3; A.t = S.t; atoSay(side, 3, why); }
    }
  }
}
HOOK.step.push(atoStep);

// —— 派机的闸门（carrier.js updateAirAuto / commander.js cmdAirTask、eair.js eaThink / eaMass、airwar.js awSdbE 调用） ——
// kind：攻方 recon / fighter / strike / cas / bomber，守方 ga / heli / sdb；sead：这次出击是不是打防空
function atoOk(side, kind, sead) {
  const ph = atoPhase(side);
  if (kind === 'fighter' || kind === 'recon' || kind === 'ftr' || kind === 'f22') return true;
  if (ph >= 3) return true;
  if (ph === 2) return !!sead && (kind === 'strike' || kind === 'ga' || kind === 'sdb');
  return false;
}
// 攻方：某处是不是已知敌防空（压制防空阶段只打这些）
const atoIsAAP = (x, y) => atoAAKnown('p').some(s => dist(s.x, s.y, x, y) < 40);
// 守方压制防空阶段的目标（A-10C 小牛打防空车、机炮打单兵防空组）
function atoSeadTgtE() {
  return atoAAKnown('e').map(s => s.k === 'veh' ? { k: 'veh', id: s.id, x: s.x, y: s.y, v: s.w * 6, nm: typeof vehName === 'function' ? vehName(s.o) : '防空车' } : { k: 'team', id: s.id, x: s.x, y: s.y, v: 6, nm: '单兵防空组' });
}

// —— 跑马场航线：中心 (cx, cy)，长边与海岸线平行（东西向），长 R × 2.4；到了一头就转向另一头 ——
function atoRace(p, cx, cy, R, dir, steer) {
  const L = Math.max(150, R * ATO.race) / 2, ends = [[cx - L, cy], [cx + L, cy]];
  if (p.rk == null || p.rkC == null || dist(p.rkC[0], p.rkC[1], cx, cy) > 60) { p.rk = (dir || 1) > 0 ? 1 : 0; p.rkC = [cx, cy]; }
  const [ex, ey] = ends[p.rk];
  // 两头转弯时略微偏到长边外侧（dir 决定往哪边绕），回程走另一条边：跑马场两条平行的长边
  const off = (p.rk ? 1 : -1) * (dir || 1) * R * .45;
  const d = steer(ex, ey + off);
  if (d < Math.max(70, R * .4)) p.rk ^= 1;
  return d;
}

// 巡逻 / 待机改为一次通过的直线航段（不在空中兜圈子）：飞到巡逻点后沿岸线方向（东西向，顺着来时机头一侧、地图边留够余地）再直飞 len，
//   飞完就返航；这一段上照样搜索、接敌（carrier.js airCasFly、airwar.js awFlyP / awFlyE）
function atoLeg(p, cx, cy, len) {
  const room = s => s > 0 ? W - 60 - cx : cx - 60;
  let s = Math.cos(p.heading || 0) >= 0 ? 1 : -1;
  if (room(s) < len * .6 && room(-s) > room(s)) s = -s;
  return { x: clamp(cx + s * len, 60, W - 60), y: clamp(cy, 60, H - 60) };
}
const ATO_LEG = { ftr: 1200, cas: 700 };

// —— 攻方编队：僚机保持在长机右后 / 左后（长机在 out 阶段、没接敌、没投弹）；离自己的目标近了、长机接敌或返航就散开 ——
const ATO_SLOT = [[0, 0], [-30, 32], [-30, -32], [-60, 64], [-60, -64]];
function atoFormP(p, dt, speed) {
  if (p.lead == null) return false;
  const L = (S.planes || []).find(o => o.id === p.lead && !o.dead);
  if (L && L.phase === 'rtb' && p.kind === 'fighter' && !p.tg) { airSet(p, 'rtb'); p.lead = null; return false; }   // 歼击机长机返航：僚机跟着回
  if (!L || L.phase === 'rtb' || (L.phase === 'loiter' && L.kind !== 'fighter') || L.dropped || L.tg || p.tg || L.hold || (p.phase !== 'out' && !(p.kind === 'fighter' && p.phase === 'loiter')) || (p.kind !== 'fighter' && dist(p.x, p.y, p.tx, p.ty) < 420)) { if (!L || L.phase !== 'cat' && L.phase !== 'roll') p.lead = null; return false; }   // 歼击机：巡逻时也保持双机队形
  if (L.phase === 'cat' || L.phase === 'roll') return false;
  if (p.route === undefined || (p.route && p.route.leg === 0)) p.route = L.route ? { in: L.route.in, out: L.route.out, leg: Math.max(1, L.route.leg) } : null;   // 跟着长机走同一条航线
  const [sx, sy] = ATO_SLOT[Math.min(p.slot || 1, ATO_SLOT.length - 1)], c = Math.cos(L.heading), n = Math.sin(L.heading);
  const px = L.x + c * sx - n * sy, py = L.y + n * sx + c * sy, err = (px - p.x) * c + (py - p.y) * n, sp = airSpec(p.kind, p.v);
  speed(clamp(L.spd + err * .9, L.spd * .6, sp.spd * 1.35));
  airSteer(p, px + c * 40, py + n * 40, dt, true);
  p.alt += (L.alt - p.alt) * Math.min(1, dt * 2);
  return true;
}
// 长机等僚机集合：起飞后到僚机都到位（或 20 秒）前放慢
function atoJoinK(p) {
  if (!p.join || S.t > p.join) return 1;
  const W2 = (S.planes || []).filter(o => !o.dead && o.lead === p.id);
  if (!W2.length || W2.every(o => dist(o.x, o.y, p.x, p.y) < 80)) { p.join = 0; return 1; }
  return .62;
}
// 派一个双机编队的僚机：同型在甲板 / 战区机场待命的还有，就再起飞一架跟长机（打同一个目标附近）
function atoWing(lead, kind, tx, ty, pref) {
  if (!lead || !S.air || !atoAI('p')) return null;
  if (!S.air.wing.some(w => w.type === kind && w.state === 'deck' && (!pref || w.v === pref || kind !== 'strike'))) return null;
  const [wx, wy] = typeof airWingTgt === 'function' ? airWingTgt(kind, tx, ty) : [tx, ty];
  if (!launchPlane(kind, wx, wy, pref)) return null;
  const w = S.planes[S.planes.length - 1];
  Object.assign(w, { lead: lead.id, slot: 1, pkg: lead.pkg ?? lead.id });
  lead.join = S.t + 22;
  return w;
}

// —— 攻方进出航线：岸线上 6 个出入口（离岸 140 的海上航路点）；进入口选离「航母→目标」最顺、附近没有已知敌防空的，出口换相邻的一个 ——
function atoGates() {
  const out = [];
  for (let i = 0; i < ATO.gates; i++) { const x = W * (i + .5) / ATO.gates; out.push({ i, x, y: Math.min(H - 40, coastAt(clamp(x, 0, W - 1)) + ATO.gateOff) }); }
  return out;
}
function atoRouteP(p) {
  if (p.route !== undefined) return p.route;
  const G = atoGates(), sx = p.x, sy = p.y, tx = p.tx, ty = p.ty;
  if (!isFinite(tx) || !isFinite(ty) || ty > coastAt(clamp(tx, 0, W - 1)) + 60) return (p.route = null);   // 目标在海上：直飞
  const aa = typeof airAASites === 'function' ? airAASites() : [];
  const cost = g => dist(sx, sy, g.x, g.y) + dist(g.x, g.y, tx, ty) + aa.reduce((a, s) => a + (dist(s.x, s.y, g.x, g.y) < 320 ? 400 * s.w : 0), 0);
  const gi = G.slice().sort((a, b) => cost(a) - cost(b))[0];
  const go = G.filter(g => Math.abs(g.i - gi.i) === 1).sort((a, b) => cost(a) - cost(b))[0] || gi;
  return (p.route = { in: [gi.x, gi.y], out: [go.x, go.y], leg: 0 });
}
// 出航：先飞到进入口（低于 60 就算到），返回 true 表示这一步在走航线
function atoIngressP(p, dt, speed) {
  if (!atoAI('p') || p.tg || p.kind === 'recon' || p.escOf != null) return false;
  const R = atoRouteP(p);
  if (R && p.slot && R.leg === 0) R.leg = 1;   // 僚机散开以后：不再回头去进入口
  if (!R || R.leg > 0) return false;
  speed(airSpec(p.kind, p.v).spd * atoJoinK(p)); p.alt = Math.min(1, p.alt + dt / 2.2);
  if (airSteer(p, R.in[0], R.in[1], dt) < 70 || p.y < R.in[1] - 40) R.leg = 1;
  return true;
}
// 返航：先飞到出口（不原路折返），再回航母 / 战区机场
function atoEgressP(p, dt, speed) {
  const R = p.route;
  if (!R || R.leg >= 2 || !atoAI('p')) return false;
  if (p.y > R.out[1] - 20) { R.leg = 2; return false; }   // 已经在海上了
  speed(airSpec(p.kind, p.v).spd); p.alt = Math.min(1, p.alt + dt / 3);
  if (airSteer(p, R.out[0], R.out[1], dt) < 80) R.leg = 2;
  return true;
}

// —— 守方进出航线：机场 → 目标背海一侧 350 的起始点（IP，偏向机场一侧）→ 目标；返航经目标另一侧的出航点 ——
function atoRouteE(a) {
  if (a.route !== undefined) return a.route;
  if (!isFinite(a.tx) || !isFinite(a.ty)) return (a.route = null);
  const b = typeof eaNearBase === 'function' ? eaNearBase(a.x, a.y) : null, bx = b ? b.x : a.x;
  const s = bx >= a.tx ? 1 : -1;   // 起始点偏向机场一侧，出航点在另一侧
  const ip = [clamp(a.tx + s * 260, 40, W - 40), clamp(a.ty - 380, 40, H - 40)], ep = [clamp(a.tx - s * 320, 40, W - 40), clamp(a.ty - 360, 40, H - 40)];
  return (a.route = { in: ip, out: ep, leg: 0 });
}
function atoIngressE(a, dt) {
  if (a.type === 'b2' || a.type === 'p8' || a.type === 'c17' || a.type === 'uh60' || a.ph !== 'out' || a.lead != null) return false;
  const R = atoRouteE(a);
  if (R && a.slot && R.leg === 0) R.leg = 1;   // 僚机散开以后：不再回头去起始点
  if (!R || R.leg > 0) return false;
  if (dist(a.x, a.y, a.tx, a.ty) < dist(R.in[0], R.in[1], a.tx, a.ty) + 30) { R.leg = 1; return false; }   // 已经比起始点更近：直接进入
  const sp = EA_SPEC[a.type];
  if (eaSteer(a, R.in[0], R.in[1], dt, a.join > S.t ? sp.spd * .7 : undefined) < 60) R.leg = 1;
  if (a.type !== 'heli') a.alt = Math.min(.7, a.alt + dt * .4);
  return true;
}
function atoEgressE(a, dt) {
  const R = a.route;
  if (!R || R.leg >= 2 || R.leg < 1 || a.ph !== 'rtb') return false;
  if (eaSteer(a, R.out[0], R.out[1], dt) < 70) R.leg = 2;
  if (a.type !== 'heli') a.alt = Math.min(.7, a.alt + dt * .3);
  return true;
}

// —— 画面：AI 指挥的一方的出入口与航线（观战时淡淡画出，看得出飞机走的是固定航线）——
function atoDraw() {
  if (!S || S.phase !== 'battle' || S.mode !== 'sandbox' || S.role !== 'spectate' || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx;
  ctx.save();
  ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(6)]);
  for (const p of S.planes || []) {
    const Rt = p.route;
    if (p.dead || !Rt || Rt.leg >= 2) continue;
    ctx.strokeStyle = rgba(COL.g, .3);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    if (Rt.leg === 0) ctx.lineTo(Rt.in[0], Rt.in[1]);
    ctx.lineTo(p.tx, p.ty); ctx.lineTo(Rt.out[0], Rt.out[1]); ctx.stroke();
  }
  if (S.eair) for (const a of S.eair.fly) {
    const Rt = a.route;
    if (a.dead || !Rt || Rt.leg >= 2) continue;
    ctx.strokeStyle = rgba(COL.enemy, .3);
    ctx.beginPath(); ctx.moveTo(a.x, a.y);
    if (Rt.leg === 0) ctx.lineTo(Rt.in[0], Rt.in[1]);
    ctx.lineTo(a.tx, a.ty); ctx.lineTo(Rt.out[0], Rt.out[1]); ctx.stroke();
  }
  ctx.setLineDash([]);
  // 出入口：岸外的小菱形
  if (atoAI('p')) for (const g of atoGates()) { ctx.strokeStyle = rgba(COL.g, .35); shape(ctx, g.x, g.y, px(5), 4, 0); ctx.stroke(); }
  ctx.restore();
}
HOOK.drawOver.push(atoDraw);
