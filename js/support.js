'use strict';
// 支援火力：驱逐舰（机动、榴弹、烟幕、暴露与损管）、炮弹结算；空军在 carrier.js
// 舰炮射程（现实）：052C / 052D 的 H/PJ-38 130 毫米舰炮约 30 公里，055 同型炮——岸上看得见的目标都够得着（守方榴弹炮也是整张图都在射程内，combat.js GUN_R）；
//   这里取 20 公里（默认地图、海岛战役都覆盖全图），弹丸飞行时间、散布随距离增大
const DD_R = 20000;

function orderDD(x, y) {
  const dd = S.dd;
  if (dd.state === 'sunk') return false;
  if (isLand(x, y)) { log('驱逐舰只能在海上机动', 'warn', 'ddl', 2); return false; }
  Object.assign(dd, { tx: x, ty: y, moving: true });
  return true;
}

// 打了就走：指挥官补救后（dd.scoot）每次齐射立即机动 70 以上，躲开随后落下的反炮兵炮弹
function ddScoot(dd) {
  if (typeof cmdCtl === 'function' && !cmdCtl(dd)) return;
  for (let k = 0; k < 8; k++) {
    const a = Math.random() * 6.283, nx = clamp(dd.x + Math.cos(a) * 80, 60, W - 60), ny = clamp(dd.y + Math.sin(a) * 80, 60, H - 70);
    if (typeAt(nx, ny) === T.DEEP && dist(nx, ny, dd.x, dd.y) > 70) { orderDD(nx, ny); return; }
  }
}
// 舰炮散布：1 公里内与原来相同（10 + 距离 / 50），再远每公里多约 6 米（火控雷达、弹道计算机，无制导炮弹）；弹丸飞行时间约 2.2 秒 + 距离 / 700
const ddSc = d => 10 + Math.min(d, 1000) / 50 + Math.max(0, d - 1000) / 160, ddDur = d => 2.2 + Math.max(0, d - 1000) / 700;
// ai：AI 指挥的射击（自动掩护、指挥官火力任务）——落点必须避开自己人；玩家手动射击不受限
function ddFire(tx, ty, smoke, ai) {
  const dd = S.dd;
  if (dd.state !== 'ready' || dd.cool > 0) {
    log(dd.state === 'sunk' ? '驱逐舰已沉没' : dd.state === 'repair' ? '驱逐舰损管中，无法射击' : `舰炮装填中（${Math.ceil(dd.cool)}s）`, 'warn', 'ddno', 2);
    return false;
  }
  const d = dist(dd.x, dd.y, tx, ty);
  if (d > DD_R) { log(`超出舰炮射程（${DD_R / 1000} 公里）`, 'warn', 'ddr', 2); return false; }
  if (smoke && S.assets.smoke <= 0) { log('烟幕弹已用完', 'warn', 'sm', 2); return false; }
  const sc = ddSc(d), pt = ai && !smoke ? safeAim('p', tx, ty, sc, POWER.naval.R, 55) : [tx + gauss() * sc, ty + gauss() * sc];
  if (!pt) return false;   // 危险近距：自己人在落区，这一轮不打
  fireShell(dd.x, dd.y, pt[0], pt[1], 'p', smoke ? 'smoke' : 'naval', ddDur(d), false);
  if (smoke) S.assets.smoke--;
  dd.cool = 5; S.stats.shots++;
  if (dd.scoot && !smoke) ddScoot(dd);
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

// hit：命中来源 {kind:'cb'|'coastal'|'arty', x, y}（发射点），供指挥官判明火力来源
function damageDD(hit) {
  const dd = S.dd;
  if (dd.state === 'sunk') return;
  dd.lastHit = { kind: 'arty', ...hit, t: S.t };
  dd.hull--;
  S.fx.push({ kind: 'boom', x: dd.x, y: dd.y, r: 30, life: 0, max: 1.2, side: 'p' });
  if (dd.hull <= 0) { dd.state = 'sunk'; dd.moving = false; log('驱逐舰第三次中弹沉没，舰炮掩护永久丧失', 'bad'); return; }
  dd.state = 'repair'; dd.repairT = 0;
  log(`驱逐舰中弹（船体 ${dd.hull}/${dd.hull0 || 3}），损管抢修中，暂停火力掩护`, 'bad');
}

function updateDD(dt) {
  const dd = S.dd;
  if (dd.state === 'sunk') return;
  dd.cool = Math.max(0, dd.cool - dt);
  const fp = typeof fpDriving === 'function' && fpDriving(dd);   // 第一人称驾驶（v3pilot.js）：玩家在开船
  if (dd.moving && !fp && sailTo(dd, dt, 18)) dd.moving = false;
  if (dd.state === 'repair') {
    if ((dd.repairT += dt) >= dd.repairDur) { dd.state = 'ready'; log('损管完成，驱逐舰恢复火力掩护', 'good'); }
    return;
  }
  if (!dd.auto || dd.cool > 0 || fp) return;   // 玩家亲自开着：不替他开炮
  // 指挥官火力任务（commander.js）：火力准备、烟幕、支援受阻的攻击；停止射击（误伤后）时不开火
  navHotUpdate();
  if (typeof lcvTask === 'function' && lcvTask(dd)) return;   // 登陆掩护优先：烟幕墙、压制刚开过火的敌坦克（lcover.js）
  const fm = typeof cmdDDMission === 'function' ? cmdDDMission(dd) : null;
  if (fm && fm.hold) return;
  // 先执行指挥官的火力计划（冲击前的火力准备、冲击支援、反炮兵、呼叫火力，里面本来就有打装甲车的任务）——
  //   原来把「正朝我军开火的敌车辆」排在火力计划前面，交战中敌车几乎一直在开火，火力准备就被挤掉了（条令评估里攻方冲击前有火力准备的比例掉到三成）
  if (fm) { if (ddFire(fm.x, fm.y, !!fm.smoke, true) && !fm.smoke) navMark(dd, fm.x, fm.y); return; }
  const av = navArmorTarget(dd);   // 没有指定任务时：正朝我军开火的敌车辆比自动掩护急，先打它
  if (av) { if (ddFire(av.x, av.y, false, true)) navMark(dd, av.x, av.y); return; }
  // 自动掩护：射击视野内、靠近我方小组（但不贴脸）的敌人；按责任区加权，别的舰刚打过的不重复打
  let best = null, bd = 180;
  const safe = typeof cmdDDSafe === 'function' ? cmdDDSafe() : 55;
  const foes = S.enemies.filter(e => !e.dead).concat(S.teams.filter(q => q.side === 'e' && q.men.length));
  for (const e of foes) {
    if (!inVision(e.x, e.y) || dist(dd.x, dd.y, e.x, e.y) > DD_R) continue;
    let near = 1e9;
    for (const q of S.teams) if (q.side === 'p') near = Math.min(near, dist(e.x, e.y, q.x, q.y));
    const w = navWeight(dd, e.x, e.y);
    if (!w || near <= safe) continue;
    if (near / w < bd) { bd = near / w; best = e; }
  }
  if (best && ddFire(best.x, best.y, false, true)) navMark(dd, best.x, best.y);
}

// 正朝我军开火的敌车辆（整体配合）：坦克、步战车、防空车在一两公里外用主炮、机枪打登陆滩头，是滩头步兵最大的威胁，步兵够不着它——
//   看得见（舰艇、飞机、车辆、步兵谁发现都算，刚开过火的炮口焰、热信号藏不住）、在舰炮射程内、NAV_ARMOR_T 秒内开过火的，交给舰炮：
//   有主炮的先打，离我军越近（正在打我军）越先打；按分区（navWeight）不重复打；自己人 55 以内不打（舰炮散布大）。返回目标车辆或 null
const NAV_ARMOR_T = 6;
function navArmorTarget(o) {
  let best = null, bs = 0;
  for (const v of S.veh || []) {
    if (v.dead || v.side !== 'e' || v.lst || S.t - Math.max(v.fireT ?? -99, v.mgT ?? -99) > NAV_ARMOR_T || !inVision(v.x, v.y) || dist(o.x, o.y, v.x, v.y) > DD_R) continue;
    const w = navWeight(o, v.x, v.y);
    if (!w) continue;
    let near = 1e9;
    for (const q of S.teams) if (q.side === 'p' && q.men.length) near = Math.min(near, dist(v.x, v.y, q.x, q.y));
    if (near < 55) continue;
    const g = vehSp(v).gun, sc = w * (g && !g.ind ? 2 : 1) * (1 + 1000 / (near + 300));
    if (sc > bs) { bs = sc; best = v; }
  }
  return best;
}
// 登陆支援（整体配合）：第一波抵近到抵滩后 2 分钟内，沙盒护航舰按责任区急袭第一波各登陆滩头（主攻、拓宽的一翼）的出口与附近已发现的火力点——
//   旗舰驱逐舰打主攻出口（commander.js cmdCloseFires），护航舰把两翼、相邻滩头的出口也压住；出口已到手的不打，别的舰刚打过的不重复打（navWeight）。
//   bare = false：只取出口 350 米内已发现的火力点（实打实的目标）；true：出口本身（没有确认目标时的压制射击，只在别的目标都没有时才打）。返回 {x, y} 或 null
const NAV_LAND_K = { bunker: 1, coastal: 1, mortar: 1, aa: 1, arty: 1 };
function navLandTarget(o, bare) {
  const C = S.cmd && S.cmd.p, pl = C && C.plan;
  if (!pl || C.prep2 == null || (C.landT1 != null && S.t - C.landT1 > 120) || typeof cmdExit !== 'function' || typeof cmdOwned !== 'function') return null;
  let best = null, bs = 0;
  for (const bi of [pl.main, pl.wide]) {
    if (bi == null || bi < 0) continue;
    const M = cmdExit(bi);
    if (!M || cmdOwned(M)) continue;
    const pts = bare ? [{ x: M.x, y: M.y }] : [];
    if (!bare) for (const e of S.enemies) if (!e.dead && e.kx != null && NAV_LAND_K[e.kind] && dist(e.kx, e.ky, M.x, M.y) < 350) pts.push({ x: e.kx, y: e.ky });
    for (const p of pts) {
      const d = dist(o.x, o.y, p.x, p.y), w = d > DD_R ? 0 : navWeight(o, p.x, p.y);
      if (!w) continue;
      const sc = w / (1 + d / DD_R);
      if (sc > bs) { bs = sc; best = p; }
    }
  }
  return best;
}
// 舰炮还在不在：旗舰驱逐舰没沉，或沙盒护航舰（驱逐舰 / 护卫舰）还有——通联、喊话按这个说，都沉了就不再提舰炮
const ddUp = () => !!S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && S.dd.x > -999;
const navGunUp = () => ddUp() || (S.ships || []).some(s => s.kind === 'dd' && alive(s));
// —— 舰炮火力分配（旗舰驱逐舰 + 沙盒护航舰）：分区负责、不重复打、告急区集中支援 ——
// 责任区：按各舰当前位置的东西顺序，把海岸正面在相邻两舰之间的中点处分段，各舰优先打本区的目标；
// 不重复打：别的舰 6 秒内打过的点 40 以内不再打（同一目标不需要几艘舰同时打）；本区没有目标时才打相邻区；
// 集中支援：某区我军步兵被压制（120 以内 3 个组以上压制 > 50）或有岸防炮在 6 秒内开过火，标为告急 25 秒——
//   相邻的舰可以转火支援，与本区舰一起打同一个区域（此时不受「不重复打」限制）
// 状态：S.nav = { aim: [{x, y, t, id}] 近 6 秒各舰的弹着点, hot: [{x, y, until, why}], hotT }
function navShips() {
  const out = [];
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && S.dd.x > -999) out.push({ o: S.dd, id: 'DD', x: S.dd.x });
  for (const s of S.ships) if (s.kind === 'dd' && s.sbxRole === 'naval' && alive(s)) out.push({ o: s, id: s.id, x: s.x });
  return out.sort((a, b) => a.x - b.x);
}
function navEnsure() { if (!S.nav) S.nav = { aim: [], hot: [], hotT: 0 }; return S.nav; }
function navHotUpdate() {
  const N = navEnsure();
  if (S.t < N.hotT) return;
  N.hotT = S.t + 2;
  N.hot = N.hot.filter(h => h.until > S.t);
  const add = (x, y, why) => { const h = N.hot.find(o => dist(o.x, o.y, x, y) < 150); if (h) h.until = S.t + 25; else N.hot.push({ x: Math.round(x), y: Math.round(y), until: S.t + 25, why }); };
  for (const q of S.teams) if (q.side === 'p' && q.men.length && q.sup > 50 && S.teams.filter(o => o.side === 'p' && o.men.length && o.sup > 50 && dist(o.x, o.y, q.x, q.y) < 120).length >= 3) add(q.x, q.y, 'pin');
  for (const e of S.enemies) if (!e.dead && e.kind === 'coastal' && e.kx != null && S.t - (e.fireT ?? -99) < 6) add(e.kx, e.ky, 'gun');
  for (const v of S.veh || []) if (!v.dead && v.side === 'e' && !v.lst && S.t - Math.max(v.fireT ?? -99, v.mgT ?? -99) < NAV_ARMOR_T && inVision(v.x, v.y)) add(v.x, v.y, 'armor');   // 正朝我军开火的敌车辆
}
// 某舰打 (x, y) 的权重：0 = 不打；本区 1、告急区 1.3、相邻区 .35
function navWeight(o, x, y) {
  const L = navShips();
  if (L.length < 2) return 1;
  const N = navEnsure(), i = L.findIndex(s => s.o === o);
  if (i < 0) return 1;
  const lo = i ? (L[i - 1].x + L[i].x) / 2 : -Infinity, hi = i < L.length - 1 ? (L[i].x + L[i + 1].x) / 2 : Infinity;
  const own = x >= lo && x < hi, hot = N.hot.some(h => h.until > S.t && dist(h.x, h.y, x, y) < 150);
  if (!hot && N.aim.some(a => a.id !== (o === S.dd ? 'DD' : o.id) && S.t - a.t < 6 && dist(a.x, a.y, x, y) < 40)) return 0;
  return own ? (hot ? 1.3 : 1) : hot ? 1.3 : .35;
}
function navMark(o, x, y) {
  const N = navEnsure(), id = o === S.dd ? 'DD' : o.id;
  N.aim = N.aim.filter(a => S.t - a.t < 6);
  N.aim.push({ x: Math.round(x), y: Math.round(y), t: S.t, id });
  // 转火支援：打的是告急区且不在本舰责任区，报一声
  const L = navShips(), i = L.findIndex(s => s.o === o);
  if (L.length < 2 || i < 0 || typeof chatSay !== 'function') return;
  const lo = i ? (L[i - 1].x + L[i].x) / 2 : -Infinity, hi = i < L.length - 1 ? (L[i].x + L[i + 1].x) / 2 : Infinity;
  const h = N.hot.find(o2 => o2.until > S.t && dist(o2.x, o2.y, x, y) < 150);
  if (h && (x < lo || x >= hi)) chatSay('p', `命令：${o === S.dd ? (S.dd.name || '驱逐舰') : o.label}转火支援相邻责任区，集中舰炮压制 ${gridRef(h.x, h.y)} ${h.why === 'gun' ? '开火的岸防炮' : h.why === 'armor' ? '朝滩头开火的敌装甲车辆' : '压制我步兵的火力点'}。`, { kind: 'order', at: { x: h.x, y: h.y }, key: 'navsup' + id, gap: 120, lv: 2 });
}

// 空军（舰载机联队 launchPlane / updatePlanes）见 carrier.js

function updateShells(dt) {
  for (const s of S.shells) {
    if (s.done) continue;   // 已被近防炮在空中打掉（ciws.js）
    if ((s.t += dt) < s.dur) continue;
    s.done = true;
    if (s.kind === 'cb') { if (dist(s.x1, s.y1, S.dd.x, S.dd.y) < 45) damageDD({ kind: 'cb', x: s.x0, y: s.y0 }); else impact(s.x1, s.y1, POWER.mortar, 'e'); }   // 机动中的驱逐舰可以躲开反炮兵射击
    else if (s.kind === 'smoke') {
      S.smoke.push({ x: s.x1, y: s.y1, r: 65, until: S.t + 35 });
      S.fx.push({ kind: 'flash', x: s.x1, y: s.y1, r: 20, life: 0, max: .6, side: 'p' });
      S.visT = 0;
    } else impact(s.x1, s.y1, POWER[s.kind], s.side, s);
  }
  S.shells = S.shells.filter(s => !s.done);
  S.smoke = S.smoke.filter(s => s.until > S.t);
}
