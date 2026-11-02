'use strict';
// 车载烟幕弹：主动发射与齐射（vehicles.js 的 vehSmokeOut 交到这里）
//   一次齐射 = 一侧发射器的一组弹（ZTZ-99A 炮塔每侧 5 具、M1 的 M250 每侧 6 具）扇形打出去，在车前约 30 米炸开（M250：落在车前约 30 米），
//   连成一道宽约 70 米的弧形烟墙；多光谱烟幕热像也看不透（grid.js 的视线、spot.js 的远距离发现都被挡住），约 25 秒散去（VEH_SMK.dur）。
//   齐射：一辆车要打时，同排（vehMates）与 150 米内面向同一方向的本方车辆一起打，各车都朝来袭方向，弹扇落在同一片、连成一道烟墙。
//   什么时候打：
//     ① 挨了穿甲弹、反坦克导弹没被打穿，或被近失弹擦过（原有的被动反应，vehicles.js）；
//     ② 掩护步兵：附近本方步兵正被 250 米以外的直瞄火力压着，而这辆车往来袭方向打出去的烟正好挡在两者之间（正在跟那个火力点对射的车不打，留着火力）；
//     ③ 抢滩：两栖车辆离岸 160 米以内、滩头正挨打时朝来袭方向打，烟落在滩头上，挡住守军看滩头的视线；
//     ④ 后撤：刚转入后撤、近 10 秒内挨过打的车，先朝来袭方向放烟再走。
//   每车两组（VEH_SMK.n），打光了到补给点重新装填（vehicles.js vehSmkLoad）；两次齐射至少隔 20 秒（VEH_SMK.gap）。
//   状态：S.vsm = { t 下次检查倒计时, cd 各片区（400 米一格）的掩护冷却 }；烟团照旧记在 S.smoke（多 t0 发射时刻、lx / ly 发射车位置、k: 'vg'）
const VSM = { R: 30, k: 5, fan: .96, pr: 14, grp: 150, cone: .9, max: 6, cover: 140, far: 250, area: 400, areaCd: 10, shore: 160 };

// 能不能打：活着、不在登陆舰上 / 跳板上、还有弹、过了两次齐射的间隔；泅渡中只有抢滩时打（swim）
const vsmReady = (v, swim) => !v.dead && !v.lst && !v.ramp && (!v.swim || swim) && (v.smk ?? VEH_SMK.n) > 0 && S.t - (v.smkT ?? -99) >= VEH_SMK.gap;

// 从 (x, y) 往方位 a 看，前方 90 米以内已经有烟（含刚打出去、还在飞的弹）：不用再打
function vsmScreened(x, y, a, far = 90) {
  const ux = Math.cos(a), uy = Math.sin(a);
  for (const s of S.smoke) {
    if (!(s.until > S.t + 6)) continue;
    const rx = s.x - x, ry = s.y - y, t = rx * ux + ry * uy;
    if (t < 4 || t > far) continue;
    if (Math.abs(-rx * uy + ry * ux) < s.r * .8) return true;
  }
  return false;
}

// 一辆车朝方位 a 打一组弹：k 发沿车前 R 米的弧线排开（±fan），t0 时刻出筒，飞约 0.35 秒炸开、1.6 秒里长满（grid.js smkR）
function vsmShoot(v, a, t0) {
  v.smk = (v.smk ?? VEH_SMK.n) - 1; v.smkT = S.t;
  for (let i = 0; i < VSM.k; i++) {
    const b = a + (i / (VSM.k - 1) * 2 - 1) * VSM.fan, d = VSM.R * (.9 + Math.random() * .2);
    S.smoke.push({ x: v.x + Math.cos(b) * d, y: v.y + Math.sin(b) * d, r: VSM.pr, until: t0 + VEH_SMK.dur, t0, lx: v.x, ly: v.y, k: 'vg' });
  }
  if (typeof v8Stat === 'function') v8Stat('vSmoke' + v.side);
}

// 齐射：v 发起，朝来袭点 (tx, ty)；同排与附近面向同一方向、前面还没有烟的本方车辆一起打（各车相隔零点几秒，弹扇都朝来袭方向）。
//   why：'hit' 挨打 · 'cover' 掩护步兵 · 'land' 抢滩 · 'retreat' 后撤。返回参加的车数。
//   打了烟自己往那边也打不了（grid.js smokeBlk：弹道线穿过烟团不能直瞄射击）——放烟就是脱离接触、换位，所以只在上面这几种时候打
function vsmVolley(v, tx, ty, why, swim) {
  if (!S || !v || !isFinite(tx) || !isFinite(ty) || !vsmReady(v, swim)) return 0;
  const a0 = Math.atan2(ty - v.y, tx - v.x), mates = typeof vehMates === 'function' ? vehMates(v) : [], grp = [v];
  for (const o of vehCache()[v.side]) {
    if (o === v || grp.length >= VSM.max || !vsmReady(o, swim)) continue;
    const d = dist(o.x, o.y, v.x, v.y);
    if (d > VSM.grp * (mates.includes(o) ? 1.4 : 1)) continue;
    const a = Math.atan2(ty - o.y, tx - o.x);
    if (Math.abs(vehAng(a - a0)) > VSM.cone || vsmScreened(o.x, o.y, a)) continue;
    grp.push(o);
  }
  grp.forEach((o, i) => vsmShoot(o, Math.atan2(ty - o.y, tx - o.x), S.t + (i ? .1 + Math.random() * .5 : 0)));
  if (grp.length > 1 && typeof v8Stat === 'function') v8Stat('vSmkGrp' + v.side);
  if (v.side === 'p' && grp.length > 1) log(`${vehName(v)}等 ${grp.length} 辆车齐射烟幕弹，${({ cover: '烟墙挡住压制步兵的火力', land: '烟墙遮住滩头', retreat: '在烟幕掩护下后撤' })[why] || '烟墙挡住来袭方向'}`, 'info', 'vsm', 12, v);
  return grp.length;
}

// ② 掩护步兵：被 250 米以外的直瞄火力压着的小组，找一辆打出去的烟能挡在它与来袭方向之间的车
function vsmCover() {
  const L = S.vsm;
  for (const q of S.teams) {
    if (!q.men.length || q.ride || !(S.t - (q.supT ?? -99) < 1.2) || q.sup < 40) continue;
    const sx = q.supX, sy = q.supY, d = dist(q.x, q.y, sx, sy);
    if (!(d > VSM.far) || d > 4000) continue;
    const key = q.side + ((q.x / VSM.area) | 0) + ',' + ((q.y / VSM.area) | 0);
    if ((L.cd[key] ?? -99) > S.t) continue;
    const a = Math.atan2(sy - q.y, sx - q.x), ux = Math.cos(a), uy = Math.sin(a);
    if (vsmScreened(q.x, q.y, a, 160)) continue;
    let best = null, bs = Infinity;
    for (const v of vehCache()[q.side]) {
      if (!vsmReady(v)) continue;
      const dv = dist(v.x, v.y, q.x, q.y);
      if (dv > VSM.cover || dv >= bs) continue;
      if (v.tg && v.tg.t && dist(v.tg.x, v.tg.y, sx, sy) < 40) continue;   // 正在跟那个火力点对射：留着火力，别把自己的视线也挡了
      const av = Math.atan2(sy - v.y, sx - v.x), cx = v.x + Math.cos(av) * VSM.R - q.x, cy = v.y + Math.sin(av) * VSM.R - q.y;
      const t = cx * ux + cy * uy, w = Math.abs(-cx * uy + cy * ux);   // 烟墙中心在小组前方多远、偏离来袭线多远
      if (t < 8 || t > 160 || w > 35) continue;
      bs = dv; best = v;
    }
    if (!best) continue;
    L.cd[key] = S.t + VSM.areaCd;
    vsmVolley(best, sx, sy, 'cover');
  }
}

// ③ 抢滩 ④ 后撤
function vsmVeh() {
  for (const v of vehCache().p.concat(vehCache().e)) {
    if (v.order && v.order.t !== v.vsmO) {   // ④ 刚转入后撤
      const was = v.vsmO;
      v.vsmO = v.order.t;
      if (was != null && v.order.t === 'retreat' && S.t - v.hitT < 10 && v.hitX != null && vsmReady(v)) { vsmVolley(v, v.hitX, v.hitY, 'retreat'); continue; }
    }
    if (v.swim) {   // ③ 两栖车辆抢滩：离岸 160 米以内，滩头上的本方小组或自己正被远处的火力打
      if (v.side !== 'p' || !vsmReady(v, true) || typeof coastAt !== 'function') continue;
      const dc = v.y - coastAt(v.x);
      if (!(dc > 0 && dc < VSM.shore)) continue;
      let tx = null, ty = null, bt = -99;
      if (S.t - v.hitT < 3 && v.hitX != null) { tx = v.hitX; ty = v.hitY; bt = v.hitT; }
      for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && S.t - (q.supT ?? -99) < 1.5 && q.supT > bt && Math.abs(q.x - v.x) < 300 && Math.abs(q.y - v.y) < 300 && dist(q.x, q.y, q.supX, q.supY) > VSM.far) { tx = q.supX; ty = q.supY; bt = q.supT; }
      if (tx != null && !vsmScreened(v.x, v.y, Math.atan2(ty - v.y, tx - v.x), 200)) vsmVolley(v, tx, ty, 'land', true);
      continue;
    }
  }
}

HOOK.step.push(dt => {
  if (!S || S.phase !== 'battle' || !S.veh || !S.veh.length || !Array.isArray(S.smoke)) return;
  const L = S.vsm || (S.vsm = { t: 0, cd: {} });
  if ((L.t -= dt) > 0) return;
  L.t = .5;
  vsmVeh(); vsmCover();
  for (const k in L.cd) if (L.cd[k] < S.t) delete L.cd[k];
});
HOOK.newGame.push(() => { if (S) S.vsm = null; });
