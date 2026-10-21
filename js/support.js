'use strict';
// 支援火力：驱逐舰（机动、榴弹、烟幕、暴露与损管）、炮弹结算；空军在 carrier.js

function orderDD(x, y) {
  const dd = S.dd;
  if (dd.state === 'sunk') return false;
  if (isLand(x, y)) { log('驱逐舰只能在海上机动', 'warn', 'ddl', 2); return false; }
  Object.assign(dd, { tx: x, ty: y, moving: true });
  return true;
}

function ddFire(tx, ty, smoke) {
  const dd = S.dd;
  if (dd.state !== 'ready' || dd.cool > 0) {
    log(dd.state === 'sunk' ? '驱逐舰已沉没' : dd.state === 'repair' ? '驱逐舰损管中，无法射击' : `舰炮装填中（${Math.ceil(dd.cool)}s）`, 'warn', 'ddno', 2);
    return false;
  }
  const d = dist(dd.x, dd.y, tx, ty);
  if (d > 1000) { log('超出舰炮射程（1000）', 'warn', 'ddr', 2); return false; }
  if (smoke && S.assets.smoke <= 0) { log('烟幕弹已用完', 'warn', 'sm', 2); return false; }
  const sc = 10 + d / 50;
  fireShell(dd.x, dd.y, tx + gauss() * sc, ty + gauss() * sc, 'p', smoke ? 'smoke' : 'naval', 2.2, false);
  if (smoke) S.assets.smoke--;
  dd.cool = 5; S.stats.shots++;
  S.fx.push({ kind: 'flash', x: dd.x, y: dd.y, r: 16, life: 0, max: .5, side: 'p' });
  if (Math.random() < .7) {
    dd.exposedUntil = S.t + 6; S.stats.exposed++;
    const guns = S.enemies.filter(e => !e.dead && !e.moving && (e.kind === 'arty' || (e.kind === 'coastal' && dist(e.x, e.y, dd.x, dd.y) < 600)));
    if (guns.length) {
      const a = pick(guns);
      fireShell(a.x, a.y, dd.x, dd.y, 'e', 'cb', 4.2, !inVision(a.x, a.y), { t: -1.2 });
      log('驱逐舰暴露坐标，反炮兵射击来袭', 'bad', null, 0, dd);
    } else log('驱逐舰坐标暴露，但敌方已无火炮可以还击', 'info', 'ddsafe', 4);
  } else log(`驱逐舰${smoke ? '烟幕弹' : '齐射'}，方位 ${fmtBrg(bearing(dd.x, dd.y, tx, ty))}，未暴露`, 'info', 'dd', 2);
  return true;
}

function damageDD() {
  const dd = S.dd;
  if (dd.state === 'sunk') return;
  dd.hull--;
  S.fx.push({ kind: 'boom', x: dd.x, y: dd.y, r: 30, life: 0, max: 1.2, side: 'p' });
  if (dd.hull <= 0) { dd.state = 'sunk'; dd.moving = false; log('驱逐舰第三次中弹沉没，舰炮掩护永久丧失', 'bad'); return; }
  dd.state = 'repair'; dd.repairT = 0;
  log(`驱逐舰中弹（船体 ${dd.hull}/3），损管抢修中，暂停火力掩护`, 'bad');
}

function updateDD(dt) {
  const dd = S.dd;
  if (dd.state === 'sunk') return;
  dd.cool = Math.max(0, dd.cool - dt);
  if (dd.moving && sailTo(dd, dt, 18)) dd.moving = false;
  if (dd.state === 'repair') {
    if ((dd.repairT += dt) >= dd.repairDur) { dd.state = 'ready'; log('损管完成，驱逐舰恢复火力掩护', 'good'); }
    return;
  }
  if (!dd.auto || dd.cool > 0) return;
  // 指挥官火力任务（commander.js）：火力准备、烟幕、支援受阻的攻击；停止射击（误伤后）时不开火
  const fm = typeof cmdDDMission === 'function' ? cmdDDMission(dd) : null;
  if (fm) { if (!fm.hold) ddFire(fm.x, fm.y, !!fm.smoke); return; }
  // 自动掩护：射击视野内、靠近我方小组（但不贴脸）的敌人
  let best = null, bd = 180;
  const safe = typeof cmdDDSafe === 'function' ? cmdDDSafe() : 55;
  const foes = S.enemies.filter(e => !e.dead).concat(S.teams.filter(q => q.side === 'e' && q.men.length));
  for (const e of foes) {
    if (!inVision(e.x, e.y) || dist(dd.x, dd.y, e.x, e.y) > 1000) continue;
    let near = 1e9;
    for (const q of S.teams) if (q.side === 'p') near = Math.min(near, dist(e.x, e.y, q.x, q.y));
    if (near < bd && near > safe) { bd = near; best = e; }
  }
  if (best) ddFire(best.x, best.y, false);
}

// 空军（舰载机联队 launchPlane / updatePlanes）见 carrier.js

function updateShells(dt) {
  for (const s of S.shells) {
    if ((s.t += dt) < s.dur) continue;
    s.done = true;
    if (s.kind === 'cb') { if (dist(s.x1, s.y1, S.dd.x, S.dd.y) < 45) damageDD(); else impact(s.x1, s.y1, POWER.mortar, 'e'); }   // 机动中的驱逐舰可以躲开反炮兵射击
    else if (s.kind === 'smoke') {
      S.smoke.push({ x: s.x1, y: s.y1, r: 65, until: S.t + 35 });
      S.fx.push({ kind: 'flash', x: s.x1, y: s.y1, r: 20, life: 0, max: .6, side: 'p' });
      S.visT = 0;
    } else impact(s.x1, s.y1, POWER[s.kind], s.side);
  }
  S.shells = S.shells.filter(s => !s.done);
  S.smoke = S.smoke.filter(s => s.until > S.t);
}
