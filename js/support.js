'use strict';
// 支援火力：驱逐舰（机动、榴弹、烟幕、暴露与损管）、空军、炮弹结算

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
  // 自动掩护：射击视野内、靠近我方小组（但不贴脸）的敌人
  let best = null, bd = 180;
  const foes = S.enemies.filter(e => !e.dead).concat(S.teams.filter(q => q.side === 'e' && q.men.length));
  for (const e of foes) {
    if (!inVision(e.x, e.y) || dist(dd.x, dd.y, e.x, e.y) > 1000) continue;
    let near = 1e9;
    for (const q of S.teams) if (q.side === 'p') near = Math.min(near, dist(e.x, e.y, q.x, q.y));
    if (near < bd && near > 55) { bd = near; best = e; }
  }
  if (best) ddFire(best.x, best.y, false);
}

// —— 空军：侦察机纵贯全图，攻击机投三连弹；都可能被防空炮击落 ——
function launchPlane(kind, tx, ty) {
  if (S.assets[kind] <= 0) { log(kind === 'strike' ? '空袭架次已用完' : '侦察架次已用完', 'warn', 'air', 2); return false; }
  S.assets[kind]--;
  S.planes.push({ id: S.nid++, kind, x: tx, y: H + 30, tx, ty, dropped: false, aaT: 0, rt: 0 });
  return true;
}

function updatePlanes(dt) {
  for (const p of S.planes) {
    p.y -= 160 * dt;
    if (p.kind === 'recon' && (p.rt -= dt) <= 0) { p.rt = .2; S.recon.push({ x: p.x, y: p.y, until: S.t + 25 }); }
    if (p.kind === 'strike' && !p.dropped && p.y <= p.ty + 70) {
      p.dropped = true;
      for (let i = 0; i < 3; i++) fireShell(p.x, p.y, p.tx + gauss() * 10, p.ty + 34 - i * 34 + gauss() * 6, 'p', 'bomb', .7, false, { t: -i * .18 });
    }
    if ((p.aaT -= dt) > 0) continue;
    p.aaT = .5;
    for (const a of S.enemies) {
      if (a.dead || a.kind !== 'aa' || dist(a.x, a.y, p.x, p.y) > 180) continue;
      tracer(a.x, a.y, p.x + gauss() * 14, p.y + gauss() * 14, 'e', inVision(a.x, a.y));
      if (a.kx == null && Math.random() < .15) { a.kx = a.x; a.ky = a.y; log('防空炮火暴露位置', 'warn', null, 0, a); }
      if (Math.random() < (p.kind === 'strike' ? .09 : .06)) {
        p.dead = true;
        S.fx.push({ kind: 'boom', x: p.x, y: p.y, r: 22, life: 0, max: 1, side: 'p' });
        log(`${p.kind === 'strike' ? '攻击机' : '侦察机'}被击落`, 'bad', null, 0, p);
        break;
      }
    }
  }
  S.planes = S.planes.filter(p => !p.dead && p.y > -40);
}

function updateShells(dt) {
  for (const s of S.shells) {
    if ((s.t += dt) < s.dur) continue;
    s.done = true;
    if (s.kind === 'cb') damageDD();
    else if (s.kind === 'smoke') {
      S.smoke.push({ x: s.x1, y: s.y1, r: 65, until: S.t + 35 });
      S.fx.push({ kind: 'flash', x: s.x1, y: s.y1, r: 20, life: 0, max: .6, side: 'p' });
      S.visT = 0;
    } else impact(s.x1, s.y1, POWER[s.kind], s.side);
  }
  S.shells = S.shells.filter(s => !s.done);
  S.smoke = S.smoke.filter(s => s.until > S.t);
}
