'use strict';
// 美舰的舰载直升机（navy.js 的守方舰艇）：现役是 MH-60R「海鹰」（SH-60B 已于 2015 年退役，两者机体几乎一样），3D 用用户给的 SH-60B 模型。
//   阿利·伯克级 Flight IIA / III、提康德罗加级机库里各 2 架，星座级护卫舰、独立级濒海战斗舰各 1 架；同一时间每舰在空中 1 架，被打下来后 5 分钟再起飞一架。
//   开战约 40 秒后从舰尾直升机甲板起飞，爬到约 150 米，在本舰朝我方舰队一侧 1.5 公里处绕 700 米半径盘旋（留在本舰防空伞下）（APS-153 雷达对海警戒、给本舰指示目标）：
//   它在 S.eair.fly 里，是守方的视野源，我方舰空导弹、战斗机、便携防空导弹都能打。本舰沉了就去最近的友舰；都没了就往北飞离战场。
//   eair.js 把 a.a82 的飞机交给 a82Fly（a82.js），a82Fly 见 type 'sh60b' 再交给这里
const MH60 = { first: 40, again: 300, alt: 150, off: 1500, rad: 700, spd: 55, n: { ddg: 2, ddg3: 2, cg: 2, ffg: 1, lcs: 1 } };
if (typeof EA_SPEC === 'object') EA_SPEC.sh60b = { name: 'MH-60R 海鹰舰载直升机', spd: 70, turn: 2.2, hp: 2, flares: 1 };
if (typeof EA_SIL === 'object') EA_SIL.sh60b = 'uh60';
const mh60Alt = m => m / (typeof V3_AIR === 'number' ? V3_AIR : 352.7) + .05;
// 我方舰队的位置（舰船、旗舰驱逐舰）：直升机在本舰朝这边的一侧警戒
function mh60Foe(e) {
  let best = null, bd = 1e18;
  const L = [...(S.ships || []).filter(s => typeof alive !== 'function' || alive(s)), ...(S.dd && S.dd.state !== 'sunk' ? [S.dd] : [])];
  for (const s of L) { const d = dist(s.x, s.y, e.x, e.y); if (d < bd) { bd = d; best = s; } }
  return best || { x: e.x, y: H };
}
function mh60Step(dt) {
  if (!S || S.phase !== 'battle' || S.over || !S.eships || !S.eships.length || typeof eaEnsure !== 'function') return;
  if ((S.mh60T = (S.mh60T ?? 1) - dt) > 0) return;
  S.mh60T = 1;
  if (S.t < MH60.first) return;
  const E = eaEnsure();
  for (const e of S.eships) {
    if (e.dead) continue;
    if (e.helo == null) e.helo = { n: MH60.n[e.cls] || 0, id: null, t: -999 };
    const H0 = e.helo, up = H0.id != null && E.fly.find(a => a.id === H0.id && !a.dead);
    if (up || !(H0.n > 0) || S.t - H0.t < (H0.id != null ? MH60.again : 0)) continue;
    H0.n--; H0.t = S.t;
    const id = S.nid++, sp = EA_SPEC.sh60b, hd = (e.heading ?? -1.57) + Math.PI, bx = e.x + Math.cos(hd) * 16, by = e.y + Math.sin(hd) * 16;   // 直升机甲板在舰尾
    E.fly.push({ id, type: 'sh60b', a82: true, ship: e.id, x: bx, y: by, heading: e.heading ?? -1.57, spd: 0, alt: mh60Alt(8), bank: 0, hp: sp.hp, flares: sp.flares, ph: 'lau', t: S.t, pv: false, ang: Math.random() * 6.28 });
    H0.id = id;
  }
}
function mh60Fly(a, dt) {
  let e = navyById(a.ship);
  if (!e || e.dead) {   // 本舰没了：去最近的友舰，都没了就飞离战场
    const L = (S.eships || []).filter(o => !o.dead).sort((p, q) => dist(p.x, p.y, a.x, a.y) - dist(q.x, q.y, a.x, a.y));
    if (L.length) { a.ship = L[0].id; e = L[0]; } else a.ph = 'out';
  }
  const alt = m => { const k = (typeof V3_AIR === 'number' ? V3_AIR : 352.7), d = (mh60Alt(m) - a.alt) * k; a.alt += clamp(d * Math.min(1, dt * .8), -6 * dt, 8.5 * dt) / k; };   // 爬升最快约 8.5 米/秒（MH-60R 约 1650 英尺/分）
  if (a.ph === 'rtb') a.ph = 'pat';   // 中弹：照样警戒（对海警戒是本舰的眼睛，不能撤）
  if (a.ph === 'out' || !e) {
    alt(300); eaSteer(a, a.x, -2000, dt, EA_SPEC.sh60b.spd);
    if (a.y < -300 || a.x < -2000 || a.x > W + 2000) { a.dead = true; a.home = true; }
    return;
  }
  const f = mh60Foe(e), dir = Math.atan2(f.y - e.y, f.x - e.x), cx = e.x + Math.cos(dir) * MH60.off, cy = e.y + Math.sin(dir) * MH60.off;
  if (a.ph === 'lau') {   // 起飞：先垂直爬升离开甲板，再前飞
    alt(MH60.alt);
    if (a.alt > mh60Alt(40)) { eaSteer(a, cx, cy, dt, MH60.spd); a.ph = 'pat'; }
    else { a.x = e.x - Math.cos(e.heading ?? -1.57) * 16; a.y = e.y - Math.sin(e.heading ?? -1.57) * 16; }
    return;
  }
  // 警戒：绕警戒点逆时针盘旋（半径 700 米）
  alt(MH60.alt);
  a.ang = (a.ang || 0) + dt * MH60.spd / MH60.rad;
  eaSteer(a, cx + Math.cos(a.ang) * MH60.rad, cy + Math.sin(a.ang) * MH60.rad, dt, MH60.spd);
}
HOOK.step.push(mh60Step);
