'use strict';
// 机械化步兵乘车机动：营里的步战车（装甲运兵车、伞兵战车）把本营的步兵排运到前沿——
//   上车：排要去的地方远（营在行军、离任务位置 MT.far 以上，或排的槽位离排 MT.far 以上）、附近没有看得见的敌人（步兵 MT.foe、车辆 MT.foeV 以内）、
//     排没被压制、营没在冲击 / 肃清 / 后撤：就近找本营空着的车（每车 carry 个组，装得下全排才装），车开到各组跟前、各组迎上去，18 米内登车；
//   乘车：车开到排的槽位（各车左右错开），全营步兵大多在车上时营锚点按 MT.pace 倍速开进（hq.js regThink）；
//   下车：车附近看见敌人（现代条令在敌人直瞄火力之外下车）、到了槽位 MT.near 以内、营转入冲击 / 肃清 / 后撤、车受伤过半、乘车超过 MT.ride 秒、车开不过去——
//     就地放下（vehDropRiders：车尾 12 米），排交回营长重下队形命令，车回到营的队形里，在步兵身后用机枪、机关炮掩护；放下后 MT.cool 秒内不再上车
//   乘车的组随车走、不开火、不挨车外的炮火、不触雷（combat.js impact、logistics.js updateTeams 跳过）；车被打爆时跟着伤亡（vehKill → vehDropRiders）
// 状态（纯 JSON）：排 u.mt = { st: 'pick' | 'ride' | 'down', g 营 id, vs: [车 id], t, px / py 领头车上次有进展的位置, bt 那时的时刻 }；
//   组 q.mtV = 分给它的车 id（等车时）；车 v.mtU = 排 id（运输中：营的队形命令跳过它，hq.js regOrder）；营 G.mtd = 步兵大多在车上
const MT = { far: 700, stay: 520, near: 260, foe: 900, foeV: 2000, sup: 35, pickR: 500, pickT: 35, ride: 240, cool: 60, pace: 2, lat: 14, stuck: 25 };
const MT_NO = ['assault', 'clear', 'local', 'withdraw', 'regroup'];   // 这些状态下不上车，在车上的就地下车
const mtVis = side => side === 'e' ? spotted : inVision;
// 车能不能运兵：活着、在岸上、自动指挥、没在补给 / 抢修 / 侦察、没被玩家亲自开着、车况油料够
const mtCan = v => !!v && !v.dead && !v.lst && !v.swim && !v.ramp && v.auto && !v.man && !v.rc && !v.immob && vehSp(v).carry > 0 &&
  v.hp >= v.maxhp * .5 && (v.fuel ?? 1) >= .2 && v.ai !== 'repair' && v.ai !== 'resup' && !(typeof fpDriving === 'function' && fpDriving(v));
const mtTeams = u => teamsOf(u).filter(q => q.men.length && !q.rc);
const mtAt = ts => [ts.reduce((a, q) => a + q.x, 0) / ts.length, ts.reduce((a, q) => a + q.y, 0) / ts.length];

// (x, y) 附近有没有看得见的敌人：车辆 MT.foeV、步兵与已知工事 MT.foe 以内（找到一个就返回）
function mtThreat(side, x, y) {
  const vis = mtVis(side), r1 = MT.foe * MT.foe, r2 = MT.foeV * MT.foeV;
  for (const v of S.veh || []) { if (v.side === side || v.dead || v.lst) continue; const dx = v.x - x, dy = v.y - y; if (dx * dx + dy * dy < r2 && vis(v.x, v.y)) return true; }
  for (const q of S.teams) { if (q.side === side || !q.men.length || q.ride) continue; const dx = q.x - x, dy = q.y - y; if (dx * dx + dy * dy < r1 && vis(q.x, q.y)) return true; }
  if (side === 'p') for (const e of S.enemies) { if (e.dead || e.kx == null) continue; const dx = e.kx - x, dy = e.ky - y; if (dx * dx + dy * dy < r1) return true; }
  return false;
}

// 放下：各车放下所载的组，排交回营长（下一次营长思考重下队形命令）
function mtDrop(u, why) {
  const M = u.mt;
  for (const id of (M && M.vs) || []) {
    const v = vehById(id);
    if (!v) continue;
    if (v.ride && v.ride.length) vehDropRiders(v, false);
    if (v.mtU === u.id) { v.mtU = null; v.cmd = null; }
  }
  for (const q of teamsOf(u)) { q.mtV = null; if (q.men.length && !q.ride) q.order = { t: 'hold' }; }   // 原地等营长的队形命令（不走回接人的地方）
  u.mt = { st: 'down', t: S.t, why };
  u.bgX = null;
  if (typeof v8Stat === 'function') v8Stat('mtDrop:' + why);
}

// 上车：就近找本营空着、能开到槽位的车，装得下全排才装；各车分到离它最近的几个组
function mtPick(G, u, ts, car, sx, sy) {
  const [cx, cy] = mtAt(ts), free = car.filter(v => v.mtU == null && mtCan(v) && dist(v.x, v.y, cx, cy) < MT.pickR).sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy));
  const use = [];
  let cap = 0;
  for (const v of free) { if (cap >= ts.length) break; use.push(v); cap += vehSp(v).carry; }
  if (cap < ts.length || !reachable(use[0].x, use[0].y, sx, sy, vehCls(use[0], sx, sy))) return false;
  const left = ts.slice();
  for (const v of use) {
    left.sort((a, b) => dist(a.x, a.y, v.x, v.y) - dist(b.x, b.y, v.x, v.y));
    for (const q of left.splice(0, vehSp(v).carry)) { q.mtV = v.id; aiGo(q, v.x, v.y, 'move'); }
    v.mtU = u.id; v.pick = null;
  }
  u.mt = { st: 'pick', g: G.id, vs: use.map(v => v.id), t: S.t };
  if (typeof v8Stat === 'function') v8Stat('mtPick');
  return true;
}

// 营长每秒：哪些排上车、哪些下车
function mtThink(G) {
  const us = bgUnits(G);
  if (!us.length) { G.mtd = false; return; }
  const car = bgVehs(G).filter(v => vehSp(v).carry > 0);
  // 营在行军、离任务位置远（hq.js regThink 每秒记下 goD）：全营乘车开进；走近了（MT.stay 以内）车上的到槽位就下
  const live = G.st === 'move' && S.t - (G.goT ?? -99) < 2.5, march = live && G.goD > MT.far, stay = live && G.goD > MT.stay;
  const no = MT_NO.includes(G.st);
  let ride = 0, tot = 0;
  for (const u of us) {
    const ts = mtTeams(u);
    if (!ts.length) continue;
    tot += ts.length;
    const M = u.mt;
    if (M && M.st !== 'down') {
      const cs = M.vs.map(vehById);
      if (no) { mtDrop(u, 'st'); continue; }
      if (cs.some(v => !mtCan(v) || v.mtU !== u.id)) { mtDrop(u, 'veh'); continue; }
      if (M.st === 'pick') {
        if (ts.every(q => q.ride)) { M.st = 'ride'; M.t = S.t; M.px = cs[0].x; M.py = cs[0].y; M.bt = S.t; ride += ts.length; continue; }
        if (S.t - M.t > MT.pickT || u.state === 'rout' || mtThreat(G.side, ...mtAt(ts))) { mtDrop(u, 'pick'); continue; }
        for (const q of ts) {   // 各组迎向接自己的车（车也在开过来）
          const v = !q.ride && q.mtV != null && vehById(q.mtV);
          if (v && (q.order.t !== 'move' || dist(q.order.x ?? -1e9, q.order.y ?? -1e9, v.x, v.y) > 15)) aiGo(q, v.x, v.y, 'move');
        }
        continue;
      }
      // 乘车：离槽位多远、车附近有没有敌人；领头车 MT.stuck 秒没挪动 25 米、离槽位还远就算开不过去（营行军时槽位跟着锚点走，不能按离槽位的距离算进展）
      const sx = u.slX ?? G.ax, sy = u.slY ?? G.ay, d = Math.max(...cs.map(v => dist(v.x, v.y, sx, sy)));
      if (dist(cs[0].x, cs[0].y, M.px, M.py) > 25) { M.px = cs[0].x; M.py = cs[0].y; M.bt = S.t; }
      const why = cs.some(v => mtThreat(G.side, v.x, v.y)) ? 'foe' : !stay && d < MT.near ? 'arr' : S.t - M.t > MT.ride ? 'time' : S.t - M.bt > MT.stuck && d > MT.near ? 'stuck' : null;
      if (why) { mtDrop(u, why); continue; }
      ride += ts.length;
      continue;
    }
    // 不在车上：要走远路就上车
    if (no || u.state === 'rout' || (M && S.t - M.t < MT.cool) || u.slX == null || !car.length) continue;
    if (ts.some(q => q.ride || !isLand(q.x, q.y))) continue;
    if (ts.reduce((a, q) => a + q.sup, 0) / ts.length > MT.sup) continue;
    const [cx, cy] = mtAt(ts);
    if (!march && dist(cx, cy, u.slX, u.slY) < MT.far) continue;
    if (mtThreat(G.side, cx, cy)) continue;
    mtPick(G, u, ts, car, u.slX, u.slY);
  }
  G.mtd = tot > 0 && ride >= tot * .7;
}

// 每步：开车（接人 / 送到槽位）、登车
function mtDrive() {
  for (const v of S.veh || []) {
    if (v.mtU == null) continue;
    const u = UNIT_MAP.get(v.mtU), M = u && u.mt;
    if (v.dead || !M || M.st === 'down' || !M.vs.includes(v.id)) { v.mtU = null; continue; }
    const G = bgOf(M.g), face = G ? G.face : v.heading, carry = vehSp(v).carry;
    if (M.st === 'pick') {
      let tq = null, bd = Infinity;
      for (const q of teamsOf(u)) {
        if (q.mtV !== v.id || q.ride || !q.men.length) continue;
        const d = dist(q.x, q.y, v.x, v.y);
        if (d < 18 && v.ride.length < carry) { v.ride.push(q.id); q.ride = v.id; q.mtV = null; continue; }   // 登车
        if (d < bd) { bd = d; tq = q; }
      }
      if (tq) v.cmd = { x: tq.x, y: tq.y, t: 'move', face: Math.atan2(tq.y - v.y, tq.x - v.x), until: S.t + 3, ai: 'pick' };
      else v.cmd = { x: v.x, y: v.y, t: 'move', face, until: S.t + 3, ai: 'pick' };   // 本车的组都上来了：原地等全排上齐
      continue;
    }
    // 送到排的槽位，各车按营的正面左右错开
    const k = M.vs.indexOf(v.id), n = M.vs.length, off = (k - (n - 1) / 2) * MT.lat, px = -Math.sin(face), py = Math.cos(face);
    const sx = (u.slX ?? v.x) + px * off, sy = (u.slY ?? v.y) + py * off;
    v.cmd = { x: sx, y: sy, t: 'move', face, until: S.t + 3, ai: 'carry' };
  }
}

const MTS = { t: 0 };
HOOK.step.push(dt => {
  if (!S || S.phase !== 'battle' || !S.bgs || !S.bgs.length) return;
  mtDrive();
  if ((MTS.t -= dt) > 0) return;
  MTS.t = 1;
  for (const G of S.bgs) if (G.reg && !G.dead) mtThink(G);
});
