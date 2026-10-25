'use strict';
// 机场防御体系（v13）：守方每座野战机场开战时自带一套防御，不必另买——
//   对空：AN/TPS-80 G/ATOR 雷达（对空发现 670、地面视野 480）；跑道两端各一辆 M-SHORAD 防空车，停机坪后方一套 LPWS 陆基密集阵（拦截炮弹、火箭弹），
//         滑行道外侧两门 M167 火神高炮；常驻守备队里有两个毒刺组；
//   对地：两辆巡逻车沿机场外围固定路线相向巡逻，发现靠近机场的敌人就迎上去；常驻守备队（沙盒两个排、战役一个排）守在跑道与停机坪外围的阵地上，
//         只守机场：不被抽去反冲击、支队、总攻（ai2 / ai4 / ai5 读 q.afG、v.afD）；机场据点丢了才随反击夺回。
// 状态：S.afd = { v: 1, bases: {机场 id: {pat: [车 id], aa: [{id, x, y}], wp: [[x, y]]}}, radar: [{id, x, y, r, h, hp, maxhp, dead, kx, ky, af}], thT }
const AFD = { radar: 480, air: 670, patR: 300 * AF_K, sbxG: 6, cpG: 3 };
const afdOn = () => !!(S && S.phase === 'battle' && S.enemies);
function afdEnsure() { if (!S.afd || S.afd.v !== 1) S.afd = { v: 1, bases: {}, radar: [], thT: 0 }; return S.afd; }
// 机场局部坐标（u 沿跑道、v 向停机坪一侧）→ 可通行的世界坐标
function afdAt(b, u, v, cls) {
  let [x, y] = eaW(b, u, v);
  x = clamp(x, 20, W - 20); y = clamp(y, 20, H - 20);
  const ok = cls === 'inf' ? passInf(x, y) : typeof vehPass === 'function' ? vehPass(x, y, 'vehe') : passInf(x, y);
  if (!ok) { const j = nearestPassable(ci(x, y), cls === 'inf' ? 'e' : 'vehe'); if (j >= 0) { x = cellCX(j); y = cellCY(j); } }
  return [Math.round(x), Math.round(y)];
}
// 阵位（机场局部坐标，与 afbase.js 的版图一致，那里也画出各阵位的土堤、沙袋）
// 巡逻路线：沿围栏内侧的巡逻道绕场区一圈（十个路标）
const AFD_WP = [[-490, -160], [0, -160], [490, -160], [526, 60], [526, 330], [490, 598], [0, 598], [-490, 598], [-526, 330], [-526, 60]];
// 火神高炮：跑道外侧两门、塔台消防站后方与直升机起降坪后方各一门；爱国者发射车阵位（东南角导弹连）；M-SHORAD（跑道两端外侧）；陆基密集阵（机库东侧）；
// AN/TPS-80 雷达站（跑道外侧西端）；常驻守备队工事（跑道外侧四处、正门门岗、西端）
const AFD_GUN = [[-250, -62], [250, -62], [-205, 222], [300, 268]];
const AFD_PAT = [[392, 432], [498, 432]];
const AFD_SHO = [[-430, -72], [430, -72]], AFD_LPWS = [180, 256], AFD_RAD = [-360, -122];
const AFD_POST = [[-330, -62], [330, -62], [16, 596], [-120, -62], [120, -62], [-500, 150]];
// 爱国者导弹参数（射程 1300、拦截来袭导弹 900 内、能打巡逻高度上的战斗机）
const AFD_PAC = { n: 12, cd: 2, regen: 40, range: 1300, icp: 900, pkK: 1.4, hi: true };
// 地勤抢修：雷达、高炮、防空阵地被毁后，场区安静（附近 AFD_FIX.foe 内没有我方部队、AFD_FIX.quiet 秒没挨打）时抢修车开过去，修 AFD_FIX.t 秒恢复
const AFD_FIX = { foe: 420 * AF_K, quiet: 20, t: 45 };
function afdBuild(b) {
  const D = afdEnsure(), sbx = S.mode === 'sandbox', B = D.bases[b.id] = { pat: [], aa: [], wp: AFD_WP.map(([u, v]) => afdAt(b, u, v)) };
  b.afD = true;
  // 雷达站
  const [rx, ry] = afdAt(b, AFD_RAD[0], AFD_RAD[1], 'inf');
  D.radar.push({ id: S.nid++, x: rx, y: ry, r: AFD.radar, h: 4, hp: 8, maxhp: 8, dead: false, kx: null, ky: null, af: b.id });
  // 高炮：滑行道外侧两门、场区东西两侧各一门，都在沙袋掩体里（AFD_GUN）
  B.guns = [];
  for (const [u, v] of AFD_GUN) { const [x, y] = afdAt(b, u, v, 'inf'), e = addEnemy('aa', x, y); e.afD = b.id; B.guns.push({ id: e.id, u, v }); }
  // 固定防空阵地（v.fixed：不机动，坏了由地勤修 / 换装）：跑道两端 M-SHORAD、机库东侧 LPWS、营区一角的爱国者导弹连（两部发射车）
  if (typeof addVehicle === 'function' && typeof VEH_SPEC === 'object') {
    const put = (type, u, v, ex) => { const [x, y] = afdAt(b, u, v), o = addVehicle('e', type, x, y, { auto: true, afD: b.id, fixed: true, ...ex }); if (o) { o.hx = o.x; o.hy = o.y; o.heading = (b.rh || 0) - Math.PI / 2 * (b.rs || 1); B.aa.push({ id: o.id, x: o.x, y: o.y, u, v, type, ex }); } return o; };
    if (VEH_SPEC.sam_veh) {
      for (const [u, v] of AFD_SHO) put('sam_veh', u, v, { sbxV: 'e_sam_veh' });
      for (const [u, v] of AFD_PAT) put('sam_veh', u, v, { mdl: 'M903 爱国者发射车（PAC-3 MSE）', samX: { ...AFD_PAC } });
    }
    if (VEH_SPEC.aa_veh) put('aa_veh', AFD_LPWS[0], AFD_LPWS[1], { sbxV: 'e_lpws', mod: { cram: 1 } });
    // 巡逻车：两辆从路线两头相向巡逻
    const rt = VEH_SPEC.recon ? 'recon' : 'apc';
    for (let i = 0; i < 2; i++) {
      const k = i ? 4 : 0, [x, y] = B.wp[k], o = addVehicle('e', rt, x, y, { auto: true, afD: b.id, afW: k, afDir: i ? -1 : 1, mdl: '机场巡逻车（M1127）' });
      if (o) { o.hx = o.x; o.hy = o.y; B.pat.push(o.id); }
    }
  }
  // 常驻守备队：跑道外侧、正门、西端的阵地（面朝场外）；两组带毒刺
  const P = S.points.find(p => p.key === 'AF' && p.af === b.id) || S.points.slice().sort((a, c) => dist(a.x, a.y, b.x, b.y) - dist(c.x, c.y, b.x, b.y))[0];
  if (!P) return;
  const n = sbx ? AFD.sbxG : AFD.cpG, posts = AFD_POST.slice(0, n);   // 第三个阵位是正门门岗
  const u = addUnit('e', 'inf', { role: 'garrison', obj: P.key, a4n: '机场常驻守备队' });
  posts.forEach(([pu, pv], i) => {
    const [x, y] = afdAt(b, pu, pv, 'inf'), [cx, cy] = eaW(b, 0, 200);
    const men = i === 1 || i === 2 ? ['rifle', 'aa', 'rifle'] : ['rifle', 'rifle', 'mg'];
    const q = addTeam('e', x, y, men, { role: 'garrison', obj: P.key, u: u.id, afG: b.id, afPost: { x, y, fx: x + (x - cx), fy: y + (y - cy) } });
    if (men.includes('aa')) q.aam = 3;
  });
  if (typeof indexUnits === 'function') indexUnits();
  if (typeof chatSay === 'function' && !D.said) {
    D.said = 1;
    chatSay('e', `命令：野战机场防御体系展开——AN/TPS-80 雷达开机对空警戒，M-SHORAD 防空车守跑道两端、陆基密集阵守停机坪，火神高炮掩护起降；巡逻车沿机场外围昼夜巡逻；常驻守备队 ${n} 个组进入外围阵地，专守机场，不得抽调。`, { kind: 'order', at: b, lv: 1 });
  }
}
// 我方（进攻方）离机场最近的已发现之敌
function afdThreat(b) {
  let best = null, bd = AFD.patR;
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y) && spotted(q.x, q.y)) { const d = dist(q.x, q.y, b.x, b.y); if (d < bd) { bd = d; best = q; } }
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && isLand(v.x, v.y) && spotted(v.x, v.y)) { const d = dist(v.x, v.y, b.x, b.y); if (d < bd) { bd = d; best = v; } }
  return best;
}
function afdThink() {
  const D = afdEnsure();
  for (const b of S.enemies) if (b.kind === 'airfield' && !b.afD && !b.dead) afdBuild(b);
  for (const id in D.bases) {
    const B = D.bases[id], b = S.enemies.find(e => e.id === +id);
    if (!b) continue;
    const T = afdThreat(b);
    // 防空车：守在原阵位
    for (const a of B.aa) { const v = vehById(a.id); if (v && !v.dead && !v.immob && v.hp >= v.maxhp * .3) v.cmd = { t: 'move', x: a.x, y: a.y, face: SOUTH, until: S.t + 6, ai: 'afaa' }; }
    // 巡逻车：有敌靠近就迎上去（停在其前方 90），否则沿路线巡逻
    for (const pid of B.pat) {
      const v = vehById(pid);
      if (!v || v.dead || v.immob || v.hp < v.maxhp * .3) continue;
      if (T) { const a = Math.atan2(v.y - T.y, v.x - T.x); v.cmd = { t: 'move', x: Math.round(T.x + Math.cos(a) * 90), y: Math.round(T.y + Math.sin(a) * 90), face: a + Math.PI, until: S.t + 6, ai: 'afpat' }; continue; }
      let [wx, wy] = B.wp[v.afW];
      if (dist(v.x, v.y, wx, wy) < 30) { v.afW = (v.afW + v.afDir + B.wp.length) % B.wp.length; [wx, wy] = B.wp[v.afW]; }
      v.cmd = { t: 'move', x: wx, y: wy, until: S.t + 8, ai: 'afpat' };
    }
  }
  // 常驻守备队：没在交战就回外围阵地（机场据点丢了由 ai2 组织反击）
  for (const q of S.teams) {
    if (q.side !== 'e' || !q.afG || !q.men.length || !q.afPost) continue;
    const P = ptByKey(q.obj);
    if (P && (P.owner === 'p' || P.prog > .25)) continue;
    if (q.order.t === 'charge' || q.order.t === 'amove' || q.order.t === 'retreat' || S.t - (q.hitT ?? -99) < 8) continue;
    if (dist(q.x, q.y, q.afPost.x, q.afPost.y) > 10 && q.order.t !== 'move') aiGo(q, q.afPost.x, q.afPost.y, 'move', q.afPost.fx, q.afPost.fy);
  }
}
function afdStep(dt) {
  if (!afdOn() || S.over) return;
  const D = afdEnsure();
  afdFix(dt);
  // 雷达站：我方步兵贴近会被破坏；我方看见就标定
  for (const r of D.radar) {
    if (r.dead) continue;
    if (r.kx == null && inVision(r.x, r.y)) { r.kx = r.x; r.ky = r.y; log('发现敌机场雷达站（AN/TPS-80）', 'warn', null, 0, r); }
    let n = 0;
    for (const q of S.teams) if (q.side === 'p' && q.men.length && dist(q.x, q.y, r.x, r.y) < 30) n++;
    if (n) afdHurt(r, .7 * n * dt);
  }
  if ((D.thT -= dt) > 0) return;
  D.thT = 2;
  afdThink();
}
function afdHurt(r, d) {
  if (r.dead) return;
  r.hp -= d;
  if (r.hp > 0) return;
  r.dead = true; r.kx = r.x; r.ky = r.y;
  if (S.stats) S.stats.structs = (S.stats.structs || 0) + 1;
  S.fx.push({ kind: 'boom', x: r.x, y: r.y, r: 22, life: 0, max: 1.1, side: 'e' });
  log(inVision(r.x, r.y) ? '摧毁敌机场雷达站' : '远处殉爆，疑似敌机场雷达站被毁', 'good', null, 0, r);
}
// —— 地勤抢修：每座机场一个抢修组（工程车 + 地勤），一次修一处：雷达站、高炮、固定防空阵地、巡逻车 ——
// 场区安静才出动；工程车从机库开到损坏处（约 8 秒），修 AFD_FIX.t 秒恢复（被毁的车辆换一辆新的进阵地）
function afdBroken(b, B) {
  const D = afdEnsure(), out = [];
  for (const r of D.radar) if (r.af === b.id && (r.dead || r.hp < r.maxhp)) out.push({ k: 'radar', id: r.id, x: r.x, y: r.y, nm: '雷达站' });
  for (const g of B.guns || []) { const e = S.enemies.find(o => o.id === g.id); if (e && (e.dead || e.hp < ENEMY_SPEC.aa.hp)) out.push({ k: 'gun', id: e.id, x: e.x, y: e.y, nm: '高炮阵地' }); }
  for (const a of B.aa) { const v = vehById(a.id); if (!v || v.dead || v.hp < v.maxhp * .6) out.push({ k: 'veh', id: a.id, x: a.x, y: a.y, nm: v && /爱国者/.test(v.mdl || '') || /爱国者/.test((a.ex && a.ex.mdl) || '') ? '爱国者发射阵地' : '防空阵地' }); }
  for (const id of B.pat) { const v = vehById(id); if (!v || v.dead) { const [x, y] = B.wp[0]; out.push({ k: 'pat', id, x, y, nm: '巡逻车' }); } }
  return out;
}
function afdFix(dt) {
  const D = afdEnsure();
  for (const id in D.bases) {
    const B = D.bases[id], b = S.enemies.find(e => e.id === +id);
    if (!b || b.dead) { B.fix = null; continue; }
    const foe = S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, b.x, b.y) < AFD_FIX.foe) || (S.veh || []).some(v => v.side === 'p' && !v.dead && !v.lst && dist(v.x, v.y, b.x, b.y) < AFD_FIX.foe);
    const quiet = !foe && S.t - (b.hitE ?? -99) > AFD_FIX.quiet;
    if (!B.fix) {
      if (!quiet || S.t < (B.fixN ?? 0)) continue;
      const list = afdBroken(b, B);
      if (!list.length) continue;
      const [hx, hy] = eaW(b, 120, 285), w = list.sort((p, q) => dist(p.x, p.y, hx, hy) - dist(q.x, q.y, hx, hy))[0];   // 抢修车从东侧维修机库后面出发
      B.fix = { ...w, t: 0, sx: hx, sy: hy };
      if (eaBaseSeen(b) || S.role === 'spectate') log(`敌机场地勤出动抢修${w.nm}`, 'warn', 'afdfix' + b.id, 40, w);
      continue;
    }
    const F = B.fix;
    if (!quiet) { F.t = Math.max(0, F.t - dt * .5); continue; }   // 挨打 / 有敌靠近：停工隐蔽
    F.t += dt;
    if (F.t < 8 + AFD_FIX.t) continue;
    // 修好
    if (F.k === 'radar') { const r = D.radar.find(o => o.id === F.id); if (r) { r.dead = false; r.hp = r.maxhp; r.kx = r.ky = null; } }
    else if (F.k === 'gun') { const e = S.enemies.find(o => o.id === F.id); if (e) { e.dead = false; e.hp = ENEMY_SPEC.aa.hp; } }
    else if (F.k === 'veh') {
      const a = B.aa.find(o => o.id === F.id), v = vehById(F.id);
      if (v && !v.dead) v.hp = v.maxhp;
      else if (a) { const o = addVehicle('e', a.type || 'sam_veh', a.x, a.y, { auto: true, afD: b.id, fixed: true, ...(a.ex || {}), ...(a.ex && a.ex.samX ? { samX: { ...a.ex.samX } } : {}) }); if (o) { o.hx = o.x; o.hy = o.y; a.id = o.id; } }
    } else if (F.k === 'pat') {
      const k = B.pat.indexOf(F.id), [x, y] = B.wp[0], o = addVehicle('e', VEH_SPEC.recon ? 'recon' : 'apc', x, y, { auto: true, afD: b.id, afW: 0, afDir: k % 2 ? -1 : 1, mdl: '机场巡逻车（M1127）' });
      if (o && k >= 0) { o.hx = o.x; o.hy = o.y; B.pat[k] = o.id; }
    }
    if (eaBaseSeen(b) || S.role === 'spectate') log(`敌机场${F.nm}抢修完毕`, 'warn', 'afdok' + b.id, 20, F);
    v8Stat('afdFix');
    B.fix = null; B.fixN = S.t + 4;
  }
}
// 抢修工程车：黄色车身、车顶琥珀色警灯闪烁；修理时冒电焊火花
function afdDrawFix(time) {
  if (!S || !S.afd) return;
  const ctx = R.ctx;
  for (const id in S.afd.bases) {
    const F = S.afd.bases[id].fix;
    if (!F || !inView(F.x, F.y, 40)) continue;
    const b = S.enemies.find(e => e.id === +id);
    if (!b || !(S.role === 'spectate' || R.eye === 'all' || inVision(F.x, F.y))) continue;
    const u = clamp(F.t / 8, 0, 1), e = u * u * (3 - 2 * u), x = lerp(F.sx, F.x + 6, e), y = lerp(F.sy, F.y + 6, e), a = Math.atan2(F.y - F.sy, F.x - F.sx);
    ctx.save(); ctx.translate(x, y); ctx.rotate(u < 1 ? a : a + .6);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(-2.6, -1.1, 6, 3.2);
    ctx.fillStyle = '#b89a3a'; ctx.fillRect(-3, -1.5, 6, 3); ctx.fillStyle = '#6d6a5a'; ctx.fillRect(1.2, -1.3, 1.6, 2.6);   // 车厢 + 驾驶室
    ctx.fillStyle = rgba(COL.amber, .5 + .5 * Math.sin(time * 9)); ctx.beginPath(); ctx.arc(1.9, 0, .55, 0, 7); ctx.fill();
    ctx.restore();
    if (u >= 1) for (let i = 0; i < 3; i++) {   // 电焊火花
      const ph = (time * 3 + i * .37) % 1, sx = F.x + Math.cos(i * 2.1 + time) * 2.5 * ph, sy = F.y + Math.sin(i * 2.1 + time) * 2.5 * ph;
      ctx.fillStyle = rgba('#fff3d6', 1 - ph); ctx.fillRect(sx - .3, sy - .3, .6, .6);
    }
    if (u >= 1) {   // 进度
      const k = clamp((F.t - 8) / AFD_FIX.t, 0, 1);
      ctx.fillStyle = rgba(COL.amber, .25); ctx.fillRect(F.x - 6, F.y + 7, 12, Math.max(1, px(2)));
      ctx.fillStyle = rgba(COL.amber, .9); ctx.fillRect(F.x - 6, F.y + 7, 12 * k, Math.max(1, px(2)));
    }
  }
}
HOOK.drawOver.push(afdDrawFix);
// 守方对空发现（airwar.js awSeen 读）
const afdRadarSees = (x, y, k) => !!(S && S.afd && S.afd.radar.some(r => !r.dead && dist(r.x, r.y, x, y) < AFD.air * k));

HOOK.step.push(afdStep);
HOOK.newGame.push(() => { if (S) S.afd = null; });
HOOK.visionE.push(() => S && S.afd && S.phase === 'battle' ? S.afd.radar.filter(r => !r.dead).map(r => ({ x: r.x, y: r.y, r: r.r, h: r.h })) : []);
HOOK.impact.push((x, y, R, pw, side) => {
  if (side === 'e' || !S || !S.afd) return;
  for (const r of S.afd.radar) if (!r.dead) { const d = dist(x, y, r.x, r.y); if (d < R + 6) afdHurt(r, (pw.struct || pw.ship || pw.men * 4) * (1 - d / (R + 6) * .5)); }
});
// 雷达站：观战或已发现时画出天线符号与（观战时）探测圈
HOOK.drawOver.push(function afdDraw() {
  if (!S || !S.afd || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, spec = S.role === 'spectate', u = Math.max(5, px(6));
  for (const r of S.afd.radar) {
    if (!spec && !inVision(r.x, r.y) && r.kx == null) continue;
    const col = r.dead ? COL.smoke : COL.enemy;
    ctx.save(); ctx.globalAlpha = r.dead ? .35 : inVision(r.x, r.y) || spec ? .9 : .5; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = px(1.4);
    ctx.beginPath(); ctx.arc(r.x, r.y, u * .45, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(r.x, r.y, u * 1.2, -2.6, -.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(r.x, r.y, u * 1.8, -2.4, -.7); ctx.stroke();
    if (spec && !r.dead && R.s > CAM.fit * 1.5) { ctx.globalAlpha = .12; ctx.setLineDash([px(4), px(4)]); ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 7); ctx.stroke(); }
    ctx.restore();
  }
});
