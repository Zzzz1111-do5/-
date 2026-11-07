'use strict';
// 远距离发现目标（热像观瞄）：坦克、突击炮、步战车、侦察车的车长周视热像仪按真实距离发现目标——
//   车辆约 3.5–6 公里（VEH_SPEC 的 spot[0]），站着的步兵约 1.5–2.5 公里（spot[1]），卧倒、躲在林子 / 房子 / 战壕里的近得多；
//   刚开过火的（炮口焰、热信号）远一半也看得见；要有通视——地形、林地、城镇、烟幕挡住的看不见，躲在林子、房子里的车辆在远处也看不见。
//   全格视野（grid.js castVision）的开销随半径平方增长，几公里的视野没法逐格算：远距离只按目标逐个查通视，
//   发现的目标在本方视野里点亮它所在的几格（visionP / visionE 源），全军共享——车辆据此远距离开火（vehicles.js vehSees），炮兵、飞机也能打
const SPOT = { S: null, k: 0, p: new Map(), e: new Map() };   // p：攻方发现的守方目标（目标对象 → 有效到的推演时间）
const SPOT_KEEP = 1.6;   // 一次确认后保持几秒（每 0.5 秒复查一次，转过山包丢了目标不会马上消失）
const SPOT_ARMOR = [3000, 1400];   // 守方 M1117 装甲警戒车：遥控武器站的热像仪
// 攻方驱逐舰 / 护卫舰的光电跟踪仪（舰炮火控的红外 + 电视 + 激光测距转塔，装在上层建筑高处，约 25 米）：近岸几公里内的车辆、开过火的步兵都看得见——
//   滩头外海的舰艇正好能看到朝滩头开火的守军坦克、防空车（炮口焰、热信号），舰炮据此还击（support.js navArmorTarget）；地形、林地照样挡
const SPOT_SHIP = [7000, 2200], SPOT_SHIP_H = 2.5;
// 侦察机、无人机、武装直升机的光电吊舱（红外 + 电视，从几百到几千米高往下看，地形、林地很少挡得住）：在空中的才算——
//   攻方侦察机 / 无侦-7 / 攻击-2 / 直-10，守方 MQ-9、阿帕奇。登陆前侦察照相时就能把藏在林缘的守军坦克找出来，交给舰炮、飞机（整体配合）
const SPOT_AIR = { recon: [8000, 3000], cas: [6000, 2500], heli: [5000, 2000] }, SPOT_AIR_H = 60;

// 两点之间有没有通视：沿线每格取遮挡顶高（地面 + 林地 / 城镇 / 悬崖），高过视线就挡住；烟幕挡。
//   林缘、镇子边上 SPOT_EDGE 米以内的树木、房屋不算遮挡（观察车停在林缘往外看、目标在林缘也露着——双方一样）：
//   在林子、镇子深处的看不见外面，外面也看不见它；地形（山包）照样挡。
//   刚开过火的（fired）藏不住：炮口焰、扬尘、热像上的亮斑冒出树冠和屋顶——目标高度按它所在格的遮挡顶高，目标那一端 SPOT_FIRED 米内的树木、房屋不算遮挡。
//   高度单位与 castVision 相同（格）；sh、th 是观察点、目标离地高度
const SPOT_EDGE = 25, SPOT_FIRED = 60;
function spotLos(sx, sy, sh, tx, ty, th, fired) {
  const i0 = ci(sx, sy), i1 = ci(tx, ty);
  if (fired) th = Math.max(th, VIS_B[i1] - VIS_G[i1] + .02);
  const z0 = VIS_G[i0] + sh, z1 = VIS_G[i1] + th;
  const dx = tx - sx, dy = ty - sy, D = Math.sqrt(dx * dx + dy * dy), n = Math.floor(D / CELL);
  if (n < 2) return true;
  const ux = dx / D * CELL, uy = dy / D * CELL, dz = (z1 - z0) / n, e0 = SPOT_EDGE / CELL, e1 = n - (fired ? SPOT_FIRED : SPOT_EDGE) / CELL;
  for (let k = 1; k < n; k++) {
    const x = sx + ux * k, y = sy + uy * k;
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    if (i === i0 || i === i1) continue;
    if (SMOKE[i]) return false;
    if ((k <= e0 || k >= e1 ? VIS_G[i] : VIS_B[i]) > z0 + dz * k + .02) return false;   // 两端的林缘只按地面高度挡
  }
  return true;
}

// 一方的观察点：[x, y, 发现车辆的距离, 发现步兵的距离, 观察点离地高（格，不给 = 车长周视镜 0.3）]
function spotSensors(side) {
  const out = [];
  if (side === 'p') {   // 驱护舰的光电跟踪仪；侦察机、无人机、直升机的光电吊舱
    if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && S.dd.x > -999) out.push([S.dd.x, S.dd.y, SPOT_SHIP[0], SPOT_SHIP[1], SPOT_SHIP_H]);
    for (const sh of S.ships) if (sh.kind === 'dd' && alive(sh)) out.push([sh.x, sh.y, SPOT_SHIP[0], SPOT_SHIP[1], SPOT_SHIP_H]);
    for (const p of S.planes || []) {
      if (p.dead || !(p.alt > .25) || !isFinite(p.x)) continue;
      const k = p.kind === 'recon' && !p.aew ? 'recon' : p.kind === 'cas' && (!p.v || p.v === 'gj2' || p.v === 'heli') ? (p.v === 'heli' ? 'heli' : 'cas') : null;   // 攻击-2（cas 默认机型）、直-10
      if (k) out.push([p.x, p.y, SPOT_AIR[k][0], SPOT_AIR[k][1], SPOT_AIR_H]);
    }
  } else if (S.eair) for (const a of S.eair.fly || []) {   // 守方 MQ-9（光电 / 红外转塔）、阿帕奇（目标截获指示瞄准具）
    if (a.dead || !isFinite(a.x) || a.ph === 'gnd' || a.ph === 'roll') continue;
    const k = a.type === 'mq9' ? 'cas' : a.type === 'heli' ? 'heli' : null;
    if (k) out.push([a.x, a.y, SPOT_AIR[k][0], SPOT_AIR[k][1], SPOT_AIR_H]);
  }
  for (const v of S.veh || []) {
    if (v.dead || v.lst || v.side !== side) continue;
    const s = vehSp(v).spot;
    if (!s) continue;
    const k = (v.swim ? .6 : 1) * (v.sup > 70 ? .6 : 1);   // 泅渡中、被压制得抬不起头的看不远
    out.push([v.x, v.y, s[0] * k, s[1] * k]);
  }
  if (side === 'e') for (const a of S.armor || []) if (!a.dead) out.push([a.x, a.y, SPOT_ARMOR[0], SPOT_ARMOR[1]]);
  return out;
}
// 对方的目标：[对象, x, y, 距离系数（乘到车辆 / 步兵的发现距离上）, 目标高度, 是不是步兵, 刚开过火]
function spotTargets(side) {
  const foe = side === 'p' ? 'e' : 'p', out = [], t = S.t;
  for (const v of S.veh || []) {
    if (v.dead || v.lst || v.side !== foe) continue;
    const fired = t - Math.max(v.fireT ?? -99, v.mgT ?? -99) < 3;   // 主炮、机枪开火都会暴露（炮口焰、曳光弹）
    // 泅渡中：车体大半没在水里，只露出炮塔，海浪杂波里热像对比度也差——发现距离打六折、目标高度减半
    out.push([v, v.x, v.y, (v.moving ? 1 : .85) * (fired ? 1.5 : 1) * (v.swim ? .6 : 1), v.swim ? .12 : .24, false, fired]);
  }
  if (foe === 'e') for (const a of S.armor || []) if (!a.dead) { const fired = t - (a.fireT ?? -99) < 3; out.push([a, a.x, a.y, (a.moving ? 1 : .85) * (fired ? 1.5 : 1), .22, false, fired]); }
  for (const q of S.teams) {
    if (q.side !== foe || !q.men.length || q.ride) continue;
    const fired = t - (q.fT ?? -99) < 2;
    out.push([q, q.x, q.y, coverAt(q.x, q.y) * (q.prone ? .55 : 1) * (q.inTrench ? .6 : 1) * (fired ? 1.5 : 1), q.prone ? .06 : .17, true, fired]);
  }
  if (foe === 'e') for (const e of S.enemies) {
    if (e.dead) continue;
    const fired = t - (e.fireT ?? -99) < 3;
    out.push([e, e.x, e.y, (e.kind === 'coastal' || e.kind === 'arty' || e.kind === 'airfield' ? .8 : .55) * (fired ? 1.6 : 1), .25, false, fired]);   // 伪装的工事、阵地发现距离打折；大炮阵地、机场好找些
  }
  return out;
}

// 炮口焰：坦克、步战车、装甲车一开炮，炮口焰、扬尘和热像上的亮斑几公里外都看得见——步兵（没有车载热像）在 2.5 公里内、有通视就能报出它的位置
//   （登陆部队抢滩时没有一辆车在岸上当观察哨，原来只能挨打、报不出是谁在打；双方一样）
const SPOT_FLASH = 2500;
// 每 0.25 秒轮流查一方：每个目标逐个看观察车辆，有一辆看得见就算发现（不用再查别的车）；刚开过火的车再让步兵看一遍
function spotScan(side) {
  const M = SPOT[side], sens = spotSensors(side), until = S.t + SPOT_KEEP;
  for (const [o, until0] of M) if (until0 < S.t || o.dead || (o.men && !o.men.length)) M.delete(o);
  const T = spotTargets(side);
  for (const [o, x, y, f, th, inf, fired] of T) {
    if (inf || !fired || M.has(o) || !(o.fireT != null)) continue;
    for (const q of S.teams) {
      if (q.side !== side || !q.men.length || q.ride) continue;
      const dx = x - q.x, dy = y - q.y, d2 = dx * dx + dy * dy;
      if (d2 > SPOT_FLASH * SPOT_FLASH * (S.night ? 2.56 : 1) || d2 < 2500) continue;   // 夜里枪口焰、炮口焰老远就看得见（1.6 倍距离）
      if (spotLos(q.x, q.y, .17, x, y, th, true)) { M.set(o, until); break; }
    }
  }
  if (!sens.length) return;
  for (const [o, x, y, f, th, inf, fired] of T) {
    for (const s of sens) {
      const R = (inf ? s[3] : s[2]) * f, dx = x - s[0], dy = y - s[1];
      if (dx > R || dx < -R || dy > R || dy < -R || dx * dx + dy * dy > R * R) continue;
      if (dx * dx + dy * dy < 2500) continue;   // 50 米内全格视野已经看得见
      if (spotLos(s[0], s[1], s[4] ?? .3, x, y, th, fired)) { M.set(o, until); break; }
    }
  }
}
HOOK.step.push(dt => {
  if (!S || S.phase !== 'battle' || typeof VIS_G === 'undefined' || !VIS_G) return;
  if (SPOT.S !== S) { SPOT.S = S; SPOT.p.clear(); SPOT.e.clear(); SPOT.k = 0; SPOT.t = .125; }   // 比视野（logistics.js S.visT，同样 0.25 秒一次）晚半个周期：两样都不便宜，错开免得挤在同一步里卡一下
  if ((SPOT.t -= dt) > 0) return;
  SPOT.t = .25;
  spotScan(SPOT.k++ & 1 ? 'e' : 'p');
});
// 发现的目标：在本方视野里点亮它所在的几格（视野源半径 12 米，castVision 按精确坐标缓存，不动的目标不重算）
const spotSrc = side => S && S.phase === 'battle' && SPOT.S === S ? [...SPOT[side].keys()].filter(o => !o.dead && isFinite(o.x)).map(o => ({ x: o.x, y: o.y, r: 12, h: 2 })) : [];
HOOK.visionP.push(() => spotSrc('p'));
HOOK.visionE.push(() => spotSrc('e'));
HOOK.newGame.push(() => { SPOT.S = null; SPOT.p.clear(); SPOT.e.clear(); });
