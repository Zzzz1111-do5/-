'use strict';
// 士兵动画与兵种建模（只是画面，不进 S）——俯视单兵的整套动作：
//   行走：两腿前后交替（按走过的距离推进步态相位，停下就收步）、两臂随步摆、身体左右轻晃；
//   跑步 / 冲锋：步幅加大、身体前倾、枪斜端在胸前；卧倒：身体贴地、两腿分开，移动时匍匐（手脚交替）；
//   跪姿射击：停下来打的时候单膝跪地；射击：枪口焰 + 后坐 + 枪口烟（机枪三连发、反坦克手与防空手的尾喷）；
//   换弹：打了几轮后枪口下压、左手去换弹匣；投弹：手臂后摆、甩出；受压制：缩头压低；待机：慢慢转头张望；
//   工兵作业：挥锹；通讯兵：鞭状天线随步摆动；中弹：转身倒下、枪脱手，遗体留在原地约一分钟再淡去
// 兵种各有建模（按 q.men 的角色与小组特长 q.mod / q.sbxTag 区分）：步枪手（弹匣包）、机枪手（粗枪管、弹链箱、脚架）、
//   反坦克手（PF-98 粗长筒带瞄准镜 / 标枪发射筒 + 指令发射单元）、防空手（前卫-2 / 毒刺长筒、握把电池、敌我识别天线）、
//   通讯兵（背负电台、鞭状天线）、工兵（锹、爆破包）、狙击手（长枪管 + 瞄准镜、伪装披挂）、温压火箭手（背两具 PF-97）、
//   车组（坦克帽、短冲锋枪、无背包）、卫生兵（背包上的红十字）、迫击炮手（行进时扛炮管、背座钣，停下就架炮、装填发射）、
//   炮兵前进观察员（停下时举望远镜观察，步枪斜挎背上）、指挥员（平板 / 地图在手，不时抬手指向前方）、
//   蛟龙突击队（夜视仪支架头盔、突击小背包、步枪带消音器，写实版军装更深）
// 尺寸（世界单位）：肩宽约 2.6、连枪长约 3.6——比原来小三成，三人一组的间距不变
const MAN_K = .78;
const MANV = { S: null, tm: new WeakMap(), dead: [] };
const MAN_IDLE = { mv: false, run: false, ph: 0, prone: false, fire: null, kneel: false, rel: null, thr: null, sup: false, work: false, look: 0, at: false, mo: null, sof: false, bino: false, cmd: false };
function manReset() { if (MANV.S !== S) { MANV.S = S; MANV.tm = new WeakMap(); MANV.dead = []; } }

// 小组的动画状态：步态相位按走过的距离推进；新的一轮射击、投弹、反坦克射击从模拟状态里认出来
function manTeam(q) {
  manReset();
  let T = MANV.tm.get(q);
  if (!T) { T = { x: q.x, y: q.y, ph: (q.id * 2.3) % 6.28, sp: 0, fT: q.fT ?? -99, n: 0, rel: -99, thr: null, at: -99, mo: -99, t: S.t }; MANV.tm.set(q, T); return T; }
  const dt = S.t - T.t;
  if (dt > 0) {
    const d = dist(T.x, T.y, q.x, q.y);
    T.sp = lerp(T.sp, Math.min(d / dt, 40), Math.min(1, dt * 6));
    T.ph += Math.min(d, 6) * .55;   // 每走约 11 个单位迈一个完整的步子
    T.x = q.x; T.y = q.y; T.t = S.t;
    if (q.fT != null && q.fT !== T.fT) {
      T.fT = q.fT; T.n++;
      if (T.n % 4 === 0) T.rel = S.t + 1.9;   // 打完四轮换一次弹匣
      if (q.mod && q.mod.at && (S.veh || []).some(v => !v.dead && v.side !== q.side && dist(v.x, v.y, q.fx, q.fy) < 14)) T.at = S.t;   // 打的是车：反坦克手发射
    }
    for (const g of S.gren || []) if (g.side === q.side && g.t < .08 && Math.abs(g.x0 - q.x) < 1.5 && Math.abs(g.y0 - q.y) < 1.5) T.thr = S.t - g.t;
    if (q.sbxTag === 'mortar') for (const sh of S.shells || []) if (sh.kind === 'mortar' && sh.side === q.side && sh.t < .1 && Math.abs(sh.x0 - q.x) < 1.5 && Math.abs(sh.y0 - q.y) < 1.5) T.mo = S.t - sh.t;   // 迫击炮刚打出一发
  }
  return T;
}
// 第 i 个人的兵种建模
function manKind(q, i, role) {
  const u = typeof unitOf === 'function' ? unitOf(q) : null, tag = q.sbxTag;
  if (u && u.emblem === 'crew') return 'crew';
  if (tag) {   // 沙盒特种小组：组里的第一个步枪手是卫生兵 / 迫击炮手，第二个通讯兵是观察员 / 指挥员
    if (tag === 'flame' && i === 0) return 'flame';
    if ((tag === 'medic' || tag === 'mortar') && role === 'rifle' && q.men.indexOf('rifle') === i) return tag;
    if ((tag === 'fo' || tag === 'hq') && role === 'radio' && q.men.indexOf('radio') !== i) return tag === 'fo' ? 'fo' : 'officer';
    if (tag === 'eeng' && i < 2) return 'eng';
  }
  if (q.mod && q.mod.at && i === 2) return 'at';
  if (q.mod && (q.mod.rng || 1) >= 1.6) return i === 0 ? 'sniper' : 'spot';
  return role || 'rifle';
}
// 第 i 个人此刻的动作
function manAn(q, T, i, kind) {
  const t = S.t, o = q.order || {}, mv = T.sp > 2.5 && t - (q.movedT ?? -9) < .35, fired = t - T.fT < 4 && T.fT > 0;
  const df = t - (T.fT + i * .09), at = kind === 'at' && t - T.at < 1.2, u = typeof unitOf === 'function' ? unitOf(q) : null;
  const fire = df >= 0 && df < .45 && (kind !== 'at' || at) && kind !== 'eng' && kind !== 'crew' && kind !== 'mortar' ? df : null;
  return {
    mv, run: mv && (o.t === 'charge' || o.t === 'retreat' || T.sp > 17), ph: T.ph + i * 2.1, prone: !!q.prone, fire, at,
    mo: kind === 'mortar' && !mv && t - T.mo < 1.2 ? t - T.mo : null, sof: q.cat === 'p_ranger' || !!(u && u.paEv != null),
    bino: kind === 'fo' && !mv && fire == null, cmd: kind === 'officer' && !mv && fire == null,
    kneel: !mv && !q.prone && (fired || kind === 'mortar') && kind !== 'eng', rel: T.rel > t && T.rel - t < 1.9 && kind !== 'at' && kind !== 'aa' && kind !== 'mortar' ? 1 - (T.rel - t) / 1.9 : null,
    thr: i === 0 && T.thr != null && t - T.thr < .55 ? (t - T.thr) / .55 : null, sup: q.sup >= 55 && !q.prone, work: !!q.working && kind === 'eng',
    look: !mv && !fired ? Math.sin(t * .37 + q.id * 1.7 + i * 2.3) * .55 : 0, t: t + q.id * .61 + i * 1.3
  };
}

// 阵亡（combat.js killMan 调用）：在这个人当时的站位记一具遗体，倒地动画后留约一分钟再淡去
function manDied(q, i, role) {
  if (typeof S !== 'object' || !S || !isFinite(q.x) || !isFinite(q.y)) return;
  manReset();
  const f = typeof faceOf === 'function' ? faceOf(q) : 0, c = Math.cos(f + 1.57), s = Math.sin(f + 1.57), o = (typeof MO === 'object' && MO[Math.min(i, MO.length - 1)]) || [0, 0], k = (q.id * 7 + i * 13 + Math.round(S.t * 10)) % 997;
  MANV.dead.push({ x: q.x + o[0] * c - o[1] * s, y: q.y + o[0] * s + o[1] * c, a: f, tw: ((k % 7) - 3) * .3, k, side: q.side, t0: S.t, kind: manKind(q, i, role), prone: !!q.prone });
  if (MANV.dead.length > 400) MANV.dead.splice(0, MANV.dead.length - 400);
}

// —— 画一个人（局部坐标 +x 朝前、+y 向右，单位：世界长度 / MAN_K）——
function manDraw(ctx, x0, y0, a, kind, col, side, an, real) {
  an = an || MAN_IDLE;
  const P = real ? rlPal(side) : null, lw = px(1) / MAN_K, dark = 'rgba(2,10,6,.88)';
  const uni = real ? (an.sof ? rlShade(P.uni, .8) : P.uni) : dark, packC = real ? P.pack : dark, helmC = real ? P.helm : col, gunC = real ? RL_EDGE : col, edge = real ? 'rgba(0,0,0,.45)' : col;
  ctx.save(); ctx.translate(x0, y0); ctx.rotate(a); ctx.scale(MAN_K, MAN_K);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const fillB = c => { ctx.fillStyle = c; ctx.fill(); if (!real) { ctx.globalAlpha *= .35; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha /= .35; } ctx.strokeStyle = edge; ctx.lineWidth = lw * (real ? .5 : 1); ctx.stroke(); };
  const line = (x1, y1, x2, y2, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); if (!real) { ctx.strokeStyle = col; ctx.lineWidth = lw * .7; ctx.strokeRect(x, y, w, h); } };
  if (real) {   // 脚下阵营淡圈（col 已含透明度 / 溃退时的琥珀色）+ 投影（光从西北来）
    ctx.strokeStyle = col; ctx.lineWidth = lw * .9; ctx.beginPath();
    if (an.prone) ctx.ellipse(-1.2, 0, 3.4, 2.1, 0, 0, 7); else ctx.ellipse(0, 0, 2.5, 2.3, 0, 0, 7);
    ctx.stroke();
    const [sx, sy] = rlLocal(a, an.prone ? .25 : .55, an.prone ? .25 : .55);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath();
    if (an.prone) ctx.ellipse(-1.1 + sx, sy, 2.3, .95, 0, 0, 7); else ctx.ellipse(-.1 + sx, sy, .95, 1.75, 0, 0, 7);
    ctx.fill();
  }
  if (an.prone) { manProne(ctx, kind, an, lw, real, col, uni, packC, helmC, gunC, edge, fillB, line, rect); ctx.restore(); return; }
  const g = an.mv ? Math.sin(an.ph) : 0, stride = an.run ? 2.2 : 1.6, lean = an.run ? .35 : 0, duck = an.sup ? 1 : 0, sw = g * .07;
  // 腿：走动时两只脚一前一后交替迈出身体轮廓（跑步步子更大），跪姿时一膝着地、小腿贴地伸在后面
  const legC = real ? rlShade(P.uni, .78) : col;
  if (an.mv) {
    for (const s of [-1, 1]) { const fx = g * stride * -s; manLimb(ctx, real, col, lw, .58, legC, [-.1, s * .4, fx, s * .48]); manBoot(ctx, real, col, fx + (fx >= 0 ? .14 : -.14), s * .48, 0); }
  } else if (an.kneel) {
    manLimb(ctx, real, col, lw, .58, legC, [-.1, -.4, .9, -.5]); manBoot(ctx, real, col, 1.05, -.5, 0);
    manLimb(ctx, real, col, lw, .58, legC, [-.1, .4, -1.05, .55, -1.85, .6]); manBoot(ctx, real, col, -2, .6, 0);
  }
  ctx.save(); ctx.translate(lean * .3, sw); ctx.rotate(g * .06);
  // 背后：背包 / 电台 / 工具（随兵种）
  manBack(ctx, kind, an, lw, real, col, packC, gunC, rect, line);
  // 躯干与肩
  const sk = an.kneel ? .93 : 1 - duck * .06;
  ctx.beginPath(); ctx.ellipse(-.1, 0, .88 * sk, 1.68 * sk, 0, 0, 7); fillB(uni);
  if (real && kind !== 'crew') { ctx.fillStyle = rlShade(P.uni, .82); ctx.fillRect(.25, -.7, .38, .55); ctx.fillRect(.25, .15, .38, .55); }   // 胸前弹匣包
  if (kind === 'sniper' || kind === 'spot') manGhillie(ctx, real, col, lw, an.t);
  // 武器与手臂
  manArms(ctx, kind, an, lw, real, col, uni, gunC, line, rect);
  // 头：钢盔（车组是坦克帽），受压制时缩头，待机时转头张望
  const hx = .15 + lean * .55 - duck * .3, hr = kind === 'crew' ? .72 : .8 * (1 - duck * .12);
  ctx.fillStyle = helmC; ctx.strokeStyle = real ? 'rgba(0,0,0,.5)' : dark; ctx.lineWidth = lw * .8;
  ctx.beginPath(); if (kind === 'crew') ctx.ellipse(hx, 0, hr * .95, hr * 1.1, 0, 0, 7); else ctx.arc(hx, 0, hr, 0, 7); ctx.fill(); ctx.stroke();
  if (real) { const [lx, ly] = rlLocal(a, -.25, -.25); ctx.fillStyle = 'rgba(255,255,255,.17)'; ctx.beginPath(); ctx.arc(hx + lx, ly, hr * .46, 0, 7); ctx.fill(); }
  const la = an.look; line(hx + Math.cos(la) * hr * .45, Math.sin(la) * hr * .45, hx + Math.cos(la) * hr * 1.05, Math.sin(la) * hr * 1.05, lw * .9, real ? 'rgba(0,0,0,.55)' : dark);   // 面朝的方向（帽檐）
  if (kind === 'crew') line(hx - .5, -.55, hx - .5, .55, lw * .7, real ? '#1b1a17' : dark);   // 坦克帽的耳机带
  else if (an.sof) rect(hx + hr * .45, -.24, .5, .48, real ? '#1d1e1b' : dark);   // 蛟龙：头盔前的夜视仪支架
  ctx.restore();
  ctx.restore();
}
// 背后的东西
function manBack(ctx, kind, an, lw, real, col, packC, gunC, rect, line) {
  if (kind === 'crew') return;
  if (kind === 'radio') {   // 背负电台 + 鞭状天线（随步摆）
    rect(-1.95, -.85, 1.05, 1.7, real ? '#3a3f30' : packC);
    const sw = an.mv ? Math.sin(an.ph * 2) * .35 : Math.sin(an.t * 1.3) * .08;
    ctx.strokeStyle = real ? '#1e1f1b' : col; ctx.lineWidth = lw * .7; ctx.beginPath(); ctx.moveTo(-1.7, -.7); ctx.quadraticCurveTo(-2.6, -1.3 + sw * .3, -3.5, -2.1 + sw); ctx.stroke();
    return;
  }
  if (kind === 'mg') { rect(-1.85, -.8, .95, 1.6, packC); rect(-1.55, .55, .7, .5, real ? '#3b3a30' : packC); return; }   // 背包 + 备用弹链箱
  if (kind === 'eng') {   // 工兵：背包、锹、爆破包
    rect(-1.8, -.75, .95, 1.5, packC);
    if (!an.work) { line(-.5, -1.15, -2.9, -1.9, lw * (real ? 1.1 : .9), real ? '#5a4a34' : col); ctx.fillStyle = real ? '#6b6b66' : col; ctx.fillRect(-3.45, -2.4, 1, .95); }
    rect(-1.6, .75, .7, .55, real ? '#6a5a3a' : packC);
    return;
  }
  if (kind === 'flame') { for (const y of [-.55, .55]) { ctx.fillStyle = real ? '#4a4f3c' : packC; ctx.beginPath(); ctx.ellipse(-1.75, y, 1.05, .32, 0, 0, 7); ctx.fill(); if (!real) { ctx.strokeStyle = col; ctx.lineWidth = lw * .7; ctx.stroke(); } } return; }   // 背两具 PF-97
  if (kind === 'at' && !an.at) { rect(-1.75, -.7, .9, 1.4, packC); return; }
  if (kind === 'medic') {   // 卫生兵：大背包上的红十字
    rect(-1.85, -.8, 1.05, 1.6, packC);
    if (real) { ctx.fillStyle = '#e9e6dc'; ctx.fillRect(-1.72, -.4, .8, .8); ctx.fillStyle = '#b3261e'; ctx.fillRect(-1.42, -.3, .2, .6); ctx.fillRect(-1.62, -.1, .6, .2); }
    else { line(-1.32, -.42, -1.32, .42, lw * 1.2, col); line(-1.74, 0, -.9, 0, lw * 1.2, col); }
    return;
  }
  if (kind === 'mortar') {   // 迫击炮手：行进时座钣背在背包上
    rect(-1.75, -.72, .92, 1.44, packC);
    if (an.mv) { ctx.fillStyle = real ? '#3a3b33' : 'rgba(2,10,6,.88)'; ctx.beginPath(); ctx.ellipse(-1.3, 0, .62, .82, 0, 0, 7); ctx.fill(); ctx.strokeStyle = real ? 'rgba(0,0,0,.45)' : col; ctx.lineWidth = lw * .8; ctx.stroke(); }
    return;
  }
  if (an.sof) { rect(-1.5, -.58, .68, 1.16, packC); return; }   // 蛟龙：突击小背包
  rect(-1.75, -.72, .92, 1.44, packC);
  if (an.bino || an.cmd) line(-1.35, -1.3, -.4, 1.2, lw * 1.05, gunC);   // 观察员 / 指挥员：步枪斜挎在背上
}
// 狙击手 / 观察手的伪装披挂：肩背一圈毛边
function manGhillie(ctx, real, col, lw, t) {
  ctx.strokeStyle = real ? 'rgba(78,88,52,.9)' : rgba(COL.g, .55); ctx.lineWidth = lw * .8; ctx.beginPath();
  for (let i = 0; i < 14; i++) { const b = i / 14 * 6.283, r0 = 1.55, r1 = 2.05 + Math.sin(i * 2.7 + t * .3) * .15; ctx.moveTo(Math.cos(b) * .85 * r0 / 1.55, Math.sin(b) * r0); ctx.lineTo(Math.cos(b) * .85 * r1 / 1.55 - .2, Math.sin(b) * r1); }
  ctx.stroke();
}
// 武器与手臂：瞄准 / 端枪跑 / 换弹 / 投弹 / 挖掘；射击时枪口焰、后坐、烟
function manArms(ctx, kind, an, lw, real, col, uni, gunC, line, rect) {
  const armC = real ? uni : col, armW = lw * (real ? 2.1 : 1);
  const fire = an.fire, rec = fire != null ? Math.max(0, 1 - fire / .14) * (kind === 'mg' ? .22 : kind === 'sniper' ? .5 : .32) : 0;
  if (an.work) {   // 工兵挥锹：锹头一下一下往前铲
    const k = (Math.sin(an.t * 6) + 1) / 2, bx = 1.2 + k * .9;
    line(0, 1.2, .5, .45, armW, armC); line(0, -1.2, .9, -.2, armW, armC);
    line(.2, .5, bx, -.1, lw * (real ? 1.2 : 1), real ? '#5a4a34' : col);
    ctx.fillStyle = real ? '#6b6b66' : col; ctx.save(); ctx.translate(bx, -.1); ctx.rotate(-.4); ctx.fillRect(-.1, -.45, .8, .9); ctx.restore();
    return;
  }
  if (an.thr != null) {   // 投弹：右臂从后上方甩到前方，枪换到左手
    const u = an.thr, b = -2.4 + u * 3.2, hx = Math.cos(b) * 1.7, hy = 1.15 + Math.sin(b) * .9;
    manGun(ctx, kind, -.6, -.4, -.55, 0, lw, real, col, gunC, rect, line, an.sof);
    line(0, -1.2, .7, -.55, armW, armC); line(0, 1.2, hx, hy, armW, armC);
    if (u < .7) { ctx.fillStyle = real ? '#3a3c2e' : col; ctx.beginPath(); ctx.arc(hx + Math.cos(b) * .25, hy, .3, 0, 7); ctx.fill(); }
    return;
  }
  if (kind === 'mortar' && !an.mv) {   // 架炮：座钣、炮身（俯视是一段朝前的粗管）、两脚架；右手在炮口装填，打出一发后抽手，炮口焰与烟
    const bx = 2.1, by = .7, mx = bx + 1.8, mo = an.mo, dk = real ? '#3a3b33' : 'rgba(2,10,6,.88)';
    ctx.fillStyle = dk; ctx.beginPath(); ctx.ellipse(bx, by, .55, .5, 0, 0, 7); ctx.fill(); ctx.strokeStyle = real ? 'rgba(0,0,0,.45)' : col; ctx.lineWidth = lw * .8; ctx.stroke();
    line(bx + 1.15, by, bx + .8, by - .75, lw * .9, gunC); line(bx + 1.15, by, bx + .8, by + .75, lw * .9, gunC);
    line(bx, by, mx, by, lw * (real ? 2.6 : 2), real ? '#3d4234' : gunC);
    const pull = mo != null ? clamp(mo / .25, 0, 1) * (1 - clamp((mo - .7) / .4, 0, 1)) : 0;
    line(0, 1.22, lerp(mx - .25, 1.3, pull), lerp(by + .3, 1.3, pull), armW, armC);
    line(0, -1.22, bx + .9, by - .45, armW, armC);
    if (mo != null) {
      if (mo < .1) { ctx.fillStyle = 'rgba(255,243,214,.95)'; ctx.beginPath(); ctx.arc(mx + .2, by, .9, 0, 7); ctx.fill(); ctx.fillStyle = rgba(COL.amber, .5); ctx.beginPath(); ctx.arc(mx + .2, by, 1.6, 0, 7); ctx.fill(); }
      const k = mo / 1.2; ctx.fillStyle = rgba(COL.smoke, .45 * (1 - k)); ctx.beginPath(); ctx.arc(mx + .3 + k * 1.2, by - k * .6, .6 + k * 2.2, 0, 7); ctx.fill();
    }
    return;
  }
  if (an.bino) {   // 观察员举望远镜：两手托到眼前
    const bc = real ? '#23241f' : gunC;
    line(0, 1.22, .95, .45, armW, armC); line(0, -1.22, .95, -.45, armW, armC);
    line(.9, -.28, 1.55, -.28, lw * (real ? 1.8 : 1.3), bc); line(.9, .28, 1.55, .28, lw * (real ? 1.8 : 1.3), bc); line(1.1, -.28, 1.1, .28, lw * .8, bc);
    return;
  }
  if (an.cmd) {   // 指挥员：左手拿平板，右手不时抬起指向前方
    const k = clamp((Math.sin(an.t * .45) - .45) / .35, 0, 1);
    ctx.save(); ctx.translate(.95, -.6); ctx.rotate(-.25);
    ctx.fillStyle = real ? '#2a2c27' : 'rgba(2,10,6,.88)'; ctx.fillRect(-.36, -.3, .72, .6);
    if (real) { ctx.fillStyle = 'rgba(150,190,160,.8)'; ctx.fillRect(-.28, -.22, .56, .44); } else { ctx.strokeStyle = col; ctx.lineWidth = lw * .7; ctx.strokeRect(-.36, -.3, .72, .6); }
    ctx.restore();
    line(0, -1.22, .78, -.8, armW, armC);
    line(0, 1.22, lerp(.9, 2.5, k), lerp(.35, 1.05, k), armW, armC);
    return;
  }
  // 持枪姿势：瞄准（枪平端向前）、跑（斜端胸前）、换弹（枪口压低、左手拿弹匣）
  const rel = an.rel, port = an.run && fire == null && kind !== 'mortar', rot = port ? -.65 : rel != null ? -.5 * Math.sin(Math.min(1, rel * 1.2) * Math.PI) : 0;
  const shoulder = kind === 'at' || kind === 'aa' || kind === 'flame' || kind === 'mortar';
  const gx = -rec, gy = shoulder ? .72 : .5;
  manGun(ctx, kind, gx, gy, rot, an.mv ? Math.sin(an.ph) * .03 : 0, lw, real, col, gunC, rect, line, an.sof);
  // 手：右手在扳机（握把），左手在护木；换弹时左手去弹匣
  const R0 = (x, y) => [gx + x * Math.cos(rot) - (y - gy) * Math.sin(rot), gy + x * Math.sin(rot) + (y - gy) * Math.cos(rot)];
  const [tx, ty] = R0(.55, gy + .05), [fx, fy] = rel != null && rel > .2 && rel < .85 ? R0(.45 + Math.sin(rel * 9) * .15, gy + .5) : R0(shoulder ? .9 : 1.45, gy);
  const swing = an.mv && !port ? Math.sin(an.ph) * .15 : 0;
  line(0, 1.22, tx - swing, ty, armW, armC);
  line(0, -1.22, fx + swing, fy, armW, armC);
  if (fire != null) manFire(ctx, kind, an, gx, gy, rot, fire, lw, real);
}
// 武器本体（局部：枪托在 gx、枪身沿 +x，rot 为枪身转角）
function manGun(ctx, kind, gx, gy, rot, wob, lw, real, col, gunC, rect, line, sof) {
  ctx.save(); ctx.translate(gx, gy); ctx.rotate(rot + wob);
  const w = (k, c) => { ctx.strokeStyle = c || gunC; ctx.lineWidth = lw * k; };
  if (kind === 'mg') {   // 机枪：粗枪管、机匣、弹链箱、折叠的脚架
    w(real ? 2.2 : 1.7); ctx.beginPath(); ctx.moveTo(-.55, 0); ctx.lineTo(3.05, 0); ctx.stroke();
    rect(.25, .05, .65, .55, real ? '#30312a' : 'rgba(2,10,6,.88)');
    w(.8); ctx.beginPath(); ctx.moveTo(2.4, .05); ctx.lineTo(2.85, .35); ctx.moveTo(2.4, -.05); ctx.lineTo(2.85, -.35); ctx.stroke();
  } else if (kind === 'at') {   // 反坦克：PF-98 粗长发射筒 + 瞄准镜（守方是标枪：粗筒 + 指令发射单元方盒）
    w(real ? 3.6 : 2.6, real ? '#3b402f' : undefined); ctx.beginPath(); ctx.moveTo(-1.6, 0); ctx.lineTo(1.95, 0); ctx.stroke();
    rect(-.25, -.62, .6, .42, real ? '#23241f' : 'rgba(2,10,6,.88)');
    w(.9); ctx.beginPath(); ctx.moveTo(1.95, -.25); ctx.lineTo(1.95, .25); ctx.stroke();
  } else if (kind === 'aa') {   // 防空：长发射筒、握把电池、敌我识别天线
    w(real ? 2.6 : 2, real ? '#3d4234' : undefined); ctx.beginPath(); ctx.moveTo(-2.05, 0); ctx.lineTo(1.85, 0); ctx.stroke();
    w(.8); ctx.beginPath(); ctx.moveTo(.4, -.2); ctx.lineTo(.4, -.75); ctx.moveTo(.1, -.75); ctx.lineTo(.7, -.75); ctx.stroke();
    rect(-.15, .15, .45, .4, real ? '#23241f' : 'rgba(2,10,6,.88)');
  } else if (kind === 'flame') {   // PF-97 温压火箭筒（手里一具）
    w(real ? 3 : 2.2, real ? '#4a4f3c' : undefined); ctx.beginPath(); ctx.moveTo(-1.2, 0); ctx.lineTo(1.6, 0); ctx.stroke();
  } else if (kind === 'sniper') {   // 狙击步枪：长枪管 + 瞄准镜
    w(1.15); ctx.beginPath(); ctx.moveTo(-.45, 0); ctx.lineTo(3.35, -.02); ctx.stroke();
    w(real ? 1.6 : 1.2); ctx.beginPath(); ctx.moveTo(.35, -.12); ctx.lineTo(1.2, -.12); ctx.stroke();
  } else if (kind === 'crew') {   // 车组：短冲锋枪
    w(1); ctx.beginPath(); ctx.moveTo(-.1, 0); ctx.lineTo(1.35, 0); ctx.stroke();
  } else if (kind === 'mortar') {   // 迫击炮：炮身扛在肩上
    w(real ? 2.8 : 2.1, real ? '#3d4234' : undefined); ctx.beginPath(); ctx.moveTo(-1.35, 0); ctx.lineTo(1.35, 0); ctx.stroke();
    w(.8); ctx.beginPath(); ctx.moveTo(1.35, -.3); ctx.lineTo(1.35, .3); ctx.stroke();
  } else if (kind === 'officer') {   // 指挥员：短卡宾枪
    w(1); ctx.beginPath(); ctx.moveTo(-.25, 0); ctx.lineTo(1.9, -.03); ctx.stroke();
  } else if (kind === 'eng') {   // 工兵：步枪背在身上，手里短一点
    w(1); ctx.beginPath(); ctx.moveTo(-.2, 0); ctx.lineTo(2.1, -.05); ctx.stroke();
  } else {   // 步枪：枪身、弹匣；蛟龙的步枪带消音器
    w(1.05); ctx.beginPath(); ctx.moveTo(-.3, 0); ctx.lineTo(2.45, -.05); ctx.stroke();
    w(.8); ctx.beginPath(); ctx.moveTo(.75, .05); ctx.lineTo(.75, .38); ctx.stroke();
    if (sof) { w(real ? 2 : 1.6); ctx.beginPath(); ctx.moveTo(2.05, -.04); ctx.lineTo(2.85, -.06); ctx.stroke(); }
  }
  ctx.restore();
}
// 射击效果：枪口焰（机枪三连发）、后喷（反坦克 / 防空）、枪口烟
function manFire(ctx, kind, an, gx, gy, rot, t, lw, real) {
  const L = kind === 'mg' ? 3.05 : kind === 'at' ? 1.95 : kind === 'aa' ? 1.85 : kind === 'flame' ? 1.6 : kind === 'sniper' ? 3.35 : kind === 'crew' ? 1.35 : kind === 'officer' ? 1.9 : an.sof ? 2.85 : 2.45;
  const mx = gx + Math.cos(rot) * L, my = gy + Math.sin(rot) * L, ca = Math.cos(rot), sa = Math.sin(rot);
  const burst = kind === 'mg' ? [0, .08, .16] : [0], hot = burst.some(b => t >= b && t < b + .055), big = kind === 'at' || kind === 'aa' || kind === 'flame';
  if (hot) {
    const r = big ? 1.6 : kind === 'sniper' ? 1.1 : .8;
    ctx.fillStyle = 'rgba(255,243,214,.95)'; ctx.beginPath(); ctx.moveTo(mx + ca * r * 1.6, my + sa * r * 1.6); ctx.lineTo(mx - sa * r * .5, my + ca * r * .5); ctx.lineTo(mx - sa * -r * .5, my + ca * -r * .5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba(COL.amber, .55); ctx.beginPath(); ctx.arc(mx + ca * r * .5, my + sa * r * .5, r, 0, 7); ctx.fill();
  }
  if (big && t < .35) {   // 尾喷：发射筒后方一道锥形燃气
    const k = 1 - t / .35, bx = gx - ca * 1.7, by = gy - sa * 1.7;
    ctx.fillStyle = rgba('#fff3d6', .7 * k); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - ca * 4.5 - sa * 1.6, by - sa * 4.5 + ca * 1.6); ctx.lineTo(bx - ca * 4.5 + sa * 1.6, by - sa * 4.5 - ca * 1.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba(COL.smoke, .45 * k); ctx.beginPath(); ctx.arc(bx - ca * 5, by - sa * 5, 1.8 + (1 - k) * 2.5, 0, 7); ctx.fill();
  }
  if (t < .45) { const k = t / .45; ctx.fillStyle = rgba(COL.smoke, (big ? .4 : .28) * (1 - k)); ctx.beginPath(); ctx.arc(mx + ca * (1 + k * 1.6) - sa * k * .6, my + sa * (1 + k * 1.6) + ca * k * .6, .5 + k * (big ? 1.6 : .9), 0, 7); ctx.fill(); }
}
// 四肢（卧姿、遗体用）：按身体比例定粗细，不随缩放变细；黑绿版是带描边的深色肢体，写实版是军装色
function manLimb(ctx, real, col, lw, w, c, pts) {
  w = Math.max(w, lw * 1.1);
  const path = () => { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); };
  path();
  if (real) { ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = w + lw * .7; ctx.stroke(); ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke(); return; }
  ctx.strokeStyle = col; ctx.lineWidth = w + lw * 1.5; ctx.stroke();
  ctx.strokeStyle = 'rgba(2,10,6,.92)'; ctx.lineWidth = w; ctx.stroke();
  ctx.globalAlpha *= .35; ctx.strokeStyle = col; ctx.stroke(); ctx.globalAlpha /= .35;
}
function manBoot(ctx, real, col, x, y, a) { ctx.fillStyle = real ? '#26241e' : col; ctx.beginPath(); ctx.ellipse(x, y, .36, .24, a, 0, 7); ctx.fill(); }
// 卧倒：身体贴地、两腿稍分开伸在后面，两肘撑地端枪朝前；移动时匍匐——一侧屈膝蹬地、对侧手前伸，左右交替，身体随之扭动
function manProne(ctx, kind, an, lw, real, col, uni, packC, helmC, gunC, edge, fillB, line, rect) {
  const c = an.mv ? Math.sin(an.ph * 1.6) : 0, legC = real ? rlShade(uni, .78) : col, armC = real ? uni : col;
  ctx.rotate(c * .07);
  for (const s of [-1, 1]) {   // 腿：静止时脚尖外撇；匍匐时一侧膝盖往外收、脚往前蹬
    const k = Math.max(0, c * s), hx = -2.35, hy = s * .38;
    if (k > .05) { const kx = -3.05 + k * .2, ky = s * (.5 + k * .95), fx = -4.2 + k * .35, fy = s * (.55 + k * .3); manLimb(ctx, real, col, lw, .62, legC, [hx, hy, kx, ky, fx, fy]); manBoot(ctx, real, col, fx - .15, fy, s * .5); }
    else { const fx = -4.55, fy = s * .8; manLimb(ctx, real, col, lw, .62, legC, [hx, hy, -3.45, s * .6, fx, fy]); manBoot(ctx, real, col, fx - .15, fy + s * .08, s * .8); }
  }
  ctx.beginPath(); ctx.ellipse(-1.1, 0, 1.75, .8, 0, 0, 7); fillB(uni);
  if (kind === 'radio') { rect(-1.95, -.5, 1.05, 1, real ? '#3a3f30' : packC); line(-1.7, -.4, -3.6, -1.3 + c * .3, lw * .7, real ? '#1e1f1b' : col); }
  else if (kind === 'flame') { for (const y of [-.4, .4]) rect(-2.6, y - .2, 1.8, .4, real ? '#4a4f3c' : packC); }
  else if (kind !== 'crew') rect(-1.9, -.5, 1.1, 1, packC);
  if (kind === 'sniper' || kind === 'spot') { ctx.save(); ctx.translate(-1.1, 0); ctx.scale(2, .55); manGhillie(ctx, real, col, lw * .7, an.t); ctx.restore(); }
  // 枪：枪托抵右肩、枪身贴着头右侧朝前；匍匐时枪横托在两臂上往后收
  const rec = an.fire != null ? Math.max(0, 1 - an.fire / .14) * .25 : 0, gx = (an.mv ? -.25 : .2) - rec, gy = .38;
  if (an.bino && !an.mv) { const bc = real ? '#23241f' : gunC; line(1.45, -.28, 2.1, -.28, lw * (real ? 1.8 : 1.3), bc); line(1.45, .28, 2.1, .28, lw * (real ? 1.8 : 1.3), bc); manLimb(ctx, real, col, lw, .5, armC, [-.05, .72, .6, 1.0, 1.45, .4]); manLimb(ctx, real, col, lw, .5, armC, [-.05, -.72, .6, -1.0, 1.45, -.4]); ctx.fillStyle = helmC; ctx.strokeStyle = real ? 'rgba(0,0,0,.5)' : 'rgba(2,10,6,.88)'; ctx.lineWidth = lw * .8; ctx.beginPath(); ctx.arc(.72, 0, .78, 0, 7); ctx.fill(); ctx.stroke(); return; }   // 观察员趴着举望远镜
  manGun(ctx, kind, gx, gy, an.mv ? -.12 : 0, 0, lw, real, col, gunC, rect, line, an.sof);
  if (kind === 'mg' && !an.mv) { line(gx + 2.85, gy, gx + 3.2, gy - .55, lw * .9, gunC); line(gx + 2.85, gy, gx + 3.2, gy + .55, lw * .9, gunC); }   // 脚架着地
  // 两臂：肘在地上撑开，右手握把、左手托护木；匍匐时一手前伸扒地、一手收回
  if (an.mv) {
    for (const s of [-1, 1]) { const r = Math.max(0, -c * s); manLimb(ctx, real, col, lw, .5, armC, [-.05, s * .72, .45 + r * .5, s * (1.15 - r * .15), 1.05 + r * 1.05, s * (.62 - r * .1)]); }
  } else {
    manLimb(ctx, real, col, lw, .5, armC, [-.05, .72, .3, 1.2, gx + .75, gy + .05]);
    manLimb(ctx, real, col, lw, .5, armC, [-.05, -.72, .95, -.85, gx + 1.55, gy - .02]);
  }
  ctx.fillStyle = helmC; ctx.strokeStyle = real ? 'rgba(0,0,0,.5)' : 'rgba(2,10,6,.88)'; ctx.lineWidth = lw * .8; ctx.beginPath(); ctx.arc(.72, 0, .78, 0, 7); ctx.fill(); ctx.stroke();
  if (an.fire != null) manFire(ctx, kind, an, gx, gy, 0, an.fire, lw, real);
}
// 遗体：0.55 秒内转身倒地（身体由站姿变成躺平、四肢摊开，枪脱手落在一旁），之后静止，50 秒后慢慢淡去
function manDrawDead(ctx, d, real, col) {
  const age = S.t - d.t0, u = clamp(age / .55, 0, 1), e = u * u * (3 - 2 * u), fade = clamp(1 - (age - 50) / 15, 0, 1);
  if (fade <= 0) return;
  const P = real ? rlPal(d.side) : null, lw = px(1) / MAN_K, sc = d.side === 'e' ? COL.enemy : COL.g, ink = real ? 'rgba(0,0,0,.4)' : rgba(sc, .6);
  const uni = real ? rlShade(P.uni, .8) : 'rgba(2,10,6,.92)', legC = real ? rlShade(P.uni, .66) : ink;
  ctx.save(); ctx.globalAlpha *= fade; ctx.translate(d.x, d.y); ctx.rotate(d.a + d.tw * e); ctx.scale(MAN_K, MAN_K); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (real && e > .5) { ctx.fillStyle = 'rgba(40,24,18,.22)'; ctx.beginPath(); ctx.ellipse(-1, 0, 2.6, 1.3, 0, 0, 7); ctx.fill(); }
  const L = d.prone ? 1.75 : lerp(.88, 1.75, e), Wd = d.prone ? .8 : lerp(1.6, .82, e), cx = d.prone ? -1.1 : lerp(-.1, -1.15, e), m = d.k % 2 ? 1 : -1, hip = cx - L + .45, sh = cx + L - .35;
  // 腿：一条伸直、一条弯着；手臂：一只摊开、一只压在身下半露
  manLimb(ctx, real, ink, lw, .62, legC, [hip, -.38, hip - 1.2 * e, -.5 - .35 * e * m, hip - 2.25 * e, -.45 - .7 * e * m]);
  manLimb(ctx, real, ink, lw, .62, legC, [hip, .38, hip - .9 * e, .55 + .75 * e, hip - 2.1 * e, .5 + .25 * e]);
  manLimb(ctx, real, ink, lw, .5, real ? uni : ink, [sh, -.65 * m, sh + .55 * e, -(1.05 + .55 * e) * m, sh + 1.25 * e, -(.9 + 1.0 * e) * m]);
  manLimb(ctx, real, ink, lw, .5, real ? uni : ink, [sh, .65 * m, sh + .7 * e, (.9 + .1 * e) * m]);
  ctx.beginPath(); ctx.ellipse(cx, 0, L, Wd, 0, 0, 7); ctx.fillStyle = uni; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = lw * (real ? .5 : 1); ctx.stroke();
  if (!real) { ctx.globalAlpha *= .2; ctx.fillStyle = sc; ctx.fill(); ctx.globalAlpha /= .2; }
  if (d.kind === 'radio' && e > .3) { ctx.fillStyle = real ? '#3a3f30' : 'rgba(2,10,6,.92)'; ctx.fillRect(cx - .9, -.5, 1.05, 1); if (!real) { ctx.strokeStyle = ink; ctx.lineWidth = lw * .7; ctx.strokeRect(cx - .9, -.5, 1.05, 1); } }
  ctx.fillStyle = real ? rlShade(P.helm, .8) : 'rgba(2,10,6,.92)'; ctx.strokeStyle = ink; ctx.lineWidth = lw * .8; ctx.beginPath(); ctx.arc(cx + L + .4, (d.k % 3 - 1) * .3 * e, .74, 0, 7); ctx.fill(); ctx.stroke();   // 头（钢盔）
  ctx.save(); ctx.translate(lerp(.4, 1.6 + (d.k % 5) * .2, e), lerp(.5, 1.9, e) * m); ctx.rotate(lerp(0, .7 + (d.k % 4) * .4, e));   // 枪脱手
  ctx.strokeStyle = real ? 'rgba(36,37,31,.85)' : ink; ctx.lineWidth = lw * (d.kind === 'mg' || d.kind === 'at' || d.kind === 'aa' || d.kind === 'flame' ? 1.8 : 1.1); ctx.beginPath(); ctx.moveTo(-.5, 0); ctx.lineTo(d.kind === 'mg' ? 3 : d.kind === 'crew' ? 1.4 : d.kind === 'sniper' ? 3.2 : 2.4, 0); ctx.stroke();
  ctx.restore();
  ctx.restore();
}
// 遗体层（render2.js drawTeams 在活人之前调用）：守方的只画看得见的
function manDrawCorpses(ctx) {
  if (!S || MANV.S !== S || !MANV.dead.length || !R.fig) return;
  const real = typeof realLook === 'function' && realLook(), spec = S.role === 'spectate' || R.eye === 'all' || R.eye === 'both' || R.eye === 'e';
  let drop = 0;
  for (const d of MANV.dead) {
    if (S.t - d.t0 > 65) { drop++; continue; }
    if (!inView(d.x, d.y, 10) || (d.side === 'e' && !spec && !inVision(d.x, d.y))) continue;
    manDrawDead(ctx, d, real, null);
  }
  if (drop > 40) MANV.dead = MANV.dead.filter(d => S.t - d.t0 <= 65);
}
// 3D（v3units.js）用：这个人现在是哪个姿态、哪一帧
function manPose3(q, T, i, kind) {
  const an = manAn(q, T, i, kind);
  if (an.prone) return { p: an.mv ? 'c' + ((Math.floor(an.ph / Math.PI * 1.6) % 2 + 2) % 2) : 'pr', fire: an.fire };
  if (an.mv) { const f = ((Math.floor(an.ph / (Math.PI / 2)) % 4) + 4) % 4; return { p: (an.run ? 'r' : 'w') + f, fire: null }; }
  if (an.kneel) return { p: 'kn', fire: an.fire };
  return { p: 'st', fire: an.fire };
}
HOOK.drawUnder.push(() => { if (!(R.m3d && R.m3dNear)) manDrawCorpses(R.ctx); });   // 3D 近看时遗体是立体模型（v3units.js）
