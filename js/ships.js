'use strict';
// 舰船俯视剪影：坦克登陆艇（突击舰）、坦克登陆舰（补给舰）、驱逐舰、增援艇
// 航迹 V 形尾浪、沉船油污、选中括角、血量点、卸载进度、炮塔随射击方向转动——全部为图形，无文字
// 渲染侧缓存（不进 S）：平滑航向、航迹点、沉没时刻、炮塔角度、上次绘制的姿态（供点选）
const SHIPV = { S: null, t1: 0, t2: 0, h: {}, trail: {}, sunk: {}, pose: {}, tur: [0, 0], etur: {}, aim: null, aimT: -99 };
const SHIP_DIM = { assault: [32, 11], supply: [42, 13], lst: [48, 14], dd: [50, 9], boat: [12, 5] };   // 长 × 宽（世界单位）
let SH_DARK = 'rgba(2,10,6,.86)', SH_FOAM = '#d4fff0';
// 写实画面：甲板灰、白色浪花；细节线（原先的发光描边）改深灰，船体用海军灰涂装（shHull）
const SH_REAL = { deck: '#646b70', hull: '#7c8489', sup: '#9aa1a6', edge: '#2c3135', foam: '#eef3f2' };
function shLook() {
  const r = typeof realLook === 'function' && realLook();
  SH_DARK = r ? SH_REAL.deck : 'rgba(2,10,6,.86)'; SH_FOAM = r ? SH_REAL.foam : '#d4fff0';
  return r;
}
// HUD 单位卡图标（侧视，照真实舰型，icons.js）：271 型登陆艇、072 型后勤登陆舰、055 / 052D、072A、人员登陆艇
const SHIP_ICONS = typeof WI === 'object' ? { ship: WI.t271, supply: WI.t072, dd: WI.t055, lst: WI.t072a, boat: WI.lcvp } : {};

// 远景放大：保证船体在适配缩放下仍有约 18px 长（各舰同一比例，保持大小关系）
const shipK = () => clamp(18 / (32 * R.s), 1, 2.6);
const shWrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function shSync() {
  if (SHIPV.S === S) return;
  Object.assign(SHIPV, { S, h: {}, trail: {}, sunk: {}, pose: {}, tur: [0, 0], etur: {}, aim: null, aimT: -99 });
}

// 平滑航向（寻路逐格转向会抖动）
function shHead(key, a, dt) {
  if (!isFinite(a)) a = -Math.PI / 2;
  const v = SHIPV.h[key];
  if (v == null || !isFinite(v)) return (SHIPV.h[key] = a);
  return (SHIPV.h[key] = shWrap(v + shWrap(a - v) * Math.min(1, dt * 4)));
}

// 航迹点：用于尾浪与航向估计
function shTrail(key, x, y, moving) {
  const tr = SHIPV.trail[key] || (SHIPV.trail[key] = []), l = tr[tr.length - 1];
  if (l && (dist(l.x, l.y, x, y) > 80 || l.t > S.t)) tr.length = 0;   // 瞬移（部署调整）或时间倒流
  const e = tr[tr.length - 1];
  if (moving && (!e || dist(e.x, e.y, x, y) > 4)) tr.push({ x, y, t: S.t });
  while (tr.length && (S.t - tr[0].t > 3.5 || tr.length > 28)) tr.shift();
  return tr;
}

// 姿态：显示中心、航向、放大系数；抢滩时以舰艏为锚点，放大不会把船体推上岸
function shPose(o, key, L, B, tgt, moving, dt, beached) {
  const k = shipK(), tr = shTrail(key, o.x, o.y, moving);
  let a = tgt;
  if (moving) for (let i = tr.length - 1; i >= 0; i--) if (dist(tr[i].x, tr[i].y, o.x, o.y) >= 14) { a = Math.atan2(o.y - tr[i].y, o.x - tr[i].x); break; }
  const h = shHead(key, a, dt);
  let x = o.x, y = o.y;
  if (beached) { const b = (k - 1) * L * .45; x -= Math.cos(h) * b; y -= Math.sin(h) * b; }
  return (SHIPV.pose[key] = { x, y, h, k, L, B, tr });
}

// 船体外形（局部坐标，艏向 +x）
function shHullPath(ctx, kind, open) {
  ctx.beginPath();
  if (kind === 'dd') {
    ctx.moveTo(25, 0); ctx.quadraticCurveTo(14, -4.3, 2, -4.5); ctx.lineTo(-20, -4.2); ctx.quadraticCurveTo(-25, -3.9, -25, -2.8);
    ctx.lineTo(-25, 2.8); ctx.quadraticCurveTo(-25, 3.9, -20, 4.2); ctx.lineTo(2, 4.5); ctx.quadraticCurveTo(14, 4.3, 25, 0);
  } else if (kind === 'supply') {
    ctx.moveTo(-21, -5.2); ctx.quadraticCurveTo(-21, -6.5, -19.6, -6.5); ctx.lineTo(10, -6.5);
    if (open) { ctx.quadraticCurveTo(13.6, -6.3, 15, -4.6); ctx.lineTo(15, 4.6); ctx.quadraticCurveTo(13.6, 6.3, 10, 6.5); }
    else { ctx.quadraticCurveTo(18, -6.2, 21, -1.5); ctx.lineTo(21, 1.5); ctx.quadraticCurveTo(18, 6.2, 10, 6.5); }
    ctx.lineTo(-19.6, 6.5); ctx.quadraticCurveTo(-21, 6.5, -21, 5.2);
  } else if (kind === 'lst') {   // 坦克登陆舰：更长更宽的平底船体、钝圆艏门
    ctx.moveTo(-24, -5.6); ctx.quadraticCurveTo(-24, -7, -22.4, -7); ctx.lineTo(13, -7);
    if (open) { ctx.quadraticCurveTo(16.4, -6.8, 17.6, -5); ctx.lineTo(17.6, 5); ctx.quadraticCurveTo(16.4, 6.8, 13, 7); }
    else { ctx.quadraticCurveTo(21.4, -6.6, 24, -1.8); ctx.lineTo(24, 1.8); ctx.quadraticCurveTo(21.4, 6.6, 13, 7); }
    ctx.lineTo(-22.4, 7); ctx.quadraticCurveTo(-24, 7, -24, 5.6);
  } else if (kind === 'boat') {
    ctx.moveTo(-6, -1.8); ctx.quadraticCurveTo(-6, -2.5, -5.2, -2.5); ctx.lineTo(5.1, -2.5); ctx.lineTo(6, -2);
    ctx.lineTo(6, 2); ctx.lineTo(5.1, 2.5); ctx.lineTo(-5.2, 2.5); ctx.quadraticCurveTo(-6, 2.5, -6, 1.8);
  } else {
    ctx.moveTo(-16, -4.2); ctx.quadraticCurveTo(-16, -5.5, -14.5, -5.5); ctx.lineTo(14.2, -5.5); ctx.lineTo(16, -4.9);
    ctx.lineTo(16, 4.9); ctx.lineTo(14.2, 5.5); ctx.lineTo(-14.5, 5.5); ctx.quadraticCurveTo(-16, 5.5, -16, 4.2);
  }
  ctx.closePath();
}

function shHull(ctx, kind, open, col, a, lw) {
  if (typeof realLook === 'function' && realLook()) {   // 写实：投影 + 受光渐变的海军灰船体 + 深色边线 + 阵营细边（我方蓝）
    const m = ctx.getTransform(), h = Math.atan2(m.b, m.a), [sx, sy] = rlLocal(h, 1.6, 1.6);
    ctx.save(); ctx.translate(sx, sy); shHullPath(ctx, kind, open); ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill(); ctx.restore();
    shHullPath(ctx, kind, open);
    ctx.fillStyle = rlLit(ctx, h, 40, 10, SH_REAL.hull); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = lw(.7); ctx.stroke();
    ctx.strokeStyle = rgba(COL.g, .7 * a); ctx.lineWidth = lw(1); ctx.stroke();
    return;
  }
  shHullPath(ctx, kind, open);
  ctx.fillStyle = SH_DARK; ctx.fill();
  ctx.strokeStyle = rgba(col, .16 * a); ctx.lineWidth = lw(3.4); ctx.stroke();   // 外晕，远景更醒目
  ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw(1.5); ctx.stroke();
}

function shBox(ctx, x, y, w, h, col, a, lw, fa) {
  ctx.fillStyle = SH_DARK === SH_REAL.deck ? SH_REAL.sup : SH_DARK; ctx.fillRect(x, y, w, h);
  if (fa) { ctx.fillStyle = rgba(col, fa * a); ctx.fillRect(x, y, w, h); }
  ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h);
}

function shRamp(ctx, x0, w0, x1, w1, col, a, lw, lod) {
  ctx.beginPath(); ctx.moveTo(x0, -w0); ctx.lineTo(x1, -w1); ctx.lineTo(x1, w1); ctx.lineTo(x0, w0); ctx.closePath();
  ctx.fillStyle = SH_DARK; ctx.fill(); ctx.fillStyle = rgba(col, .1 * a); ctx.fill();
  ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw(1.2); ctx.stroke();
  if (lod < 24) return;
  ctx.beginPath();   // 防滑横肋
  for (let x = x0 + 2.4; x < x1 - .5; x += 2.3) { const w = lerp(w0, w1, (x - x0) / (x1 - x0)) - .3; ctx.moveTo(x, -w); ctx.lineTo(x, w); }
  ctx.strokeStyle = rgba(col, .4 * a); ctx.lineWidth = lw(.7); ctx.stroke();
}

// —— 坦克登陆艇（突击）：方形船体、艏跳板、敞开货舱载兵、艉部驾驶室 ——
function shLCT(ctx, s, P, col, a, time) {
  const lw = v => px(v) / P.k, lod = P.L * P.k * R.s, down = s.state === 'beached' || s.state === 'unloading';
  const ld = s.load || {}, n = clamp((ld.teams | 0) * 3, 0, 18);
  ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.h); ctx.scale(P.k, P.k);
  if (down) shRamp(ctx, 15.4, 4.4, 25, 3.8, col, a, lw, lod);
  shHull(ctx, 'assault', false, col, a, lw);
  if (!down) { ctx.fillStyle = rgba(col, .45 * a); ctx.fillRect(13.4, -4.8, 2.4, 9.6); }   // 跳板收起：艏部厚板
  // 货舱
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-8.5, -3.9, 21.6, 7.8);
  ctx.strokeStyle = rgba(col, .55 * a); ctx.lineWidth = lw(.9); ctx.strokeRect(-8.5, -3.9, 21.6, 7.8);
  const f = s.state === 'unloading' ? clamp(1 - (s.ut || 0) / 3, 0, 1) : 1, m = Math.round(n * f);
  if (lod < 24) {
    if (m) { ctx.fillStyle = rgba(col, (.15 + .55 * m / 15) * a); ctx.fillRect(-8.5, -3.9, 21.6, 7.8); }
  } else {
    const r = Math.max(.7, lw(1.1));
    ctx.fillStyle = rgba(col, .95 * a); ctx.strokeStyle = rgba(col, .75 * a); ctx.lineWidth = lw(.7);
    for (let i = 0; i < m; i++) {   // 从艏部往后排
      const x = -6.6 + (5 - Math.floor(i / 3)) * 3.75, y = (i % 3 - 1) * 2.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      if (lod > 110) { ctx.beginPath(); ctx.moveTo(x - .55, y - 1.3); ctx.lineTo(x - .55, y + 1.3); ctx.stroke(); }   // 肩线
    }
    if (s.state === 'unloading' && m < n) for (let j = 0; j < 3; j++) {   // 正冲下跳板的士兵
      const u = (time * 1.4 + j / 3) % 1;
      ctx.beginPath(); ctx.arc(13 + u * 12, (j - 1) * 2, r, 0, 7); ctx.fill();
    }
  }
  // 艉部驾驶室
  shBox(ctx, -15.2, -3.3, 5.4, 6.6, col, a, lw(1.1));
  ctx.fillStyle = rgba(col, .35 * a); ctx.fillRect(-11.4, -2.5, 1, 5);
  if (lod >= 24) { ctx.fillStyle = rgba(col, .9 * a); ctx.beginPath(); ctx.arc(-13, 0, .75, 0, 7); ctx.fill(); }
  if (lod > 70) {   // 近景细节：舷墙内线、系缆桩、救生筏、艉锚绞盘
    ctx.strokeStyle = rgba(col, .3 * a); ctx.lineWidth = lw(.6);
    ctx.beginPath(); ctx.moveTo(-9.4, -4.7); ctx.lineTo(13.2, -4.7); ctx.moveTo(-9.4, 4.7); ctx.lineTo(13.2, 4.7); ctx.stroke();
    ctx.fillStyle = rgba(col, .6 * a);
    for (const [x, y] of [[-8.9, -4.8], [-8.9, 4.8], [12.6, -4.8], [12.6, 4.8], [2, -4.8], [2, 4.8]]) ctx.fillRect(x - .45, y - .45, .9, .9);
    ctx.strokeStyle = rgba(col, .5 * a); ctx.strokeRect(-14.6, -5.1, 3.4, 1.1); ctx.strokeRect(-14.6, 4, 3.4, 1.1);
    ctx.beginPath(); ctx.arc(-15.3, 0, .9, 0, 7); ctx.stroke();
  }
  ctx.restore();
}

// —— 坦克登陆舰（补给）：尖艏+艏门、甲板货箱、吊车、艉部上层建筑；抢滩后标出补给站 ——
function shLST(ctx, s, P, col, a, time) {
  const lw = v => px(v) / P.k, lod = P.L * P.k * R.s, open = s.state === 'beached' || s.state === 'unloading';
  ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.h); ctx.scale(P.k, P.k);
  if (open) {   // 艏门向两侧打开，跳板伸出
    shRamp(ctx, 14.6, 3.3, 25.5, 2.9, col, a, lw, lod);
    for (const g of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(15, g * 4.6); ctx.lineTo(19.6, g * 9.6); ctx.lineTo(20.8, g * 8.8); ctx.lineTo(16.4, g * 3.9); ctx.closePath();
      ctx.fillStyle = SH_DARK; ctx.fill(); ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw(1.1); ctx.stroke();
    }
  }
  shHull(ctx, 'supply', open, col, a, lw);
  ctx.strokeStyle = rgba(col, .6 * a); ctx.lineWidth = lw(.8);
  ctx.beginPath();
  if (!open) { ctx.moveTo(14.5, 0); ctx.lineTo(21, 0); }   // 艏门中缝
  ctx.moveTo(11.5, -6.2); ctx.lineTo(11.5, 6.2); ctx.stroke();   // 艏门铰线
  if (lod >= 24) { ctx.strokeStyle = rgba(col, .4 * a); ctx.strokeRect(8.6, -2.4, 2.4, 4.8); }   // 升降口
  // 甲板货箱：卸载时由前往后逐个吊走
  const nc = s.state === 'beached' ? 2 : s.state === 'unloading' ? Math.round(2 + 6 * clamp(1 - (s.ut || 0) / 3, 0, 1)) : 8;
  for (let i = 0; i < nc; i++) {
    const x = -7 + Math.floor(i / 2) * 4.3, y = i % 2 ? 1.5 : -4.1;
    shBox(ctx, x, y, 3.6, 2.6, col, .85 * a, lw(.8), .22);
    if (lod > 70) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3.6, y + 2.6); ctx.moveTo(x + 3.6, y); ctx.lineTo(x, y + 2.6); ctx.strokeStyle = rgba(col, .35 * a); ctx.lineWidth = lw(.5); ctx.stroke(); }
  }
  if (lod > 70) for (const g of [-1, 1]) {   // 舷侧吊艇架上的小艇
    ctx.save(); ctx.translate(3.6, g * 5.6); ctx.scale(.34, .34);
    shHullPath(ctx, 'boat'); ctx.fillStyle = SH_DARK; ctx.fill(); ctx.strokeStyle = rgba(col, .7 * a); ctx.lineWidth = lw(.6) / .34; ctx.stroke();
    ctx.restore();
  }
  // 吊车：航行时收起，抢滩后摆动吊运
  if (lod > 20) {
    const ba = open ? -.25 + Math.sin(time * .6) * .55 : -.06, ex = -9.4 + Math.cos(ba) * 9.5, ey = 3.9 + Math.sin(ba) * 9.5;
    ctx.strokeStyle = rgba(col, .9 * a); ctx.lineWidth = lw(1.1);
    ctx.beginPath(); ctx.moveTo(-9.4, 3.9); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.arc(-9.4, 3.9, 1.2, 0, 7); ctx.fillStyle = SH_DARK; ctx.fill(); ctx.stroke();
    if (open && lod >= 24) { ctx.fillStyle = rgba(col, .55 * a); ctx.fillRect(ex - 1.1, ey - 1, 2.2, 2); }
  }
  // 艉部上层建筑与烟囱
  shBox(ctx, -19.4, -5, 8.6, 10, col, a, lw(1.1));
  ctx.fillStyle = rgba(col, .35 * a); ctx.fillRect(-11.9, -4, 1.1, 8);
  ctx.beginPath(); ctx.ellipse(-16.2, 0, 1.6, 2.1, 0, 0, 7); ctx.fillStyle = rgba(col, .35 * a); ctx.fill(); ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw(.9); ctx.stroke();
  if (lod >= 24) { ctx.beginPath(); ctx.moveTo(-13.2, -3.6); ctx.lineTo(-13.2, 3.6); ctx.lineWidth = lw(.7); ctx.stroke(); }
  // 抢滩后：跳板前方堆放的补给物资（补给线断开时闪红）
  if (s.state === 'beached') {
    const L = (S.supply || []).find(l => l.ship === s.id), ok = !L || L.connected, c2 = ok ? col : COL.enemy, al = ok ? a : .5 + .5 * Math.sin(time * 8);
    for (const [x, y] of [[27.6, -3.2], [27.6, .4], [31.2, -1.4]]) shBox(ctx, x, y, 3.2, 2.8, c2, al, lw(1), .25);
    ctx.setLineDash([lw(2), lw(3)]); ctx.strokeStyle = rgba(c2, .45 * al); ctx.lineWidth = lw(1);
    ctx.beginPath(); ctx.arc(30, 0, 7, time * .4, time * .4 + 6.283); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}

// —— 坦克登陆舰（LST）：钝圆艏门与长跳板、坦克甲板上看得见的车辆、艉部上层建筑；抢滩后车辆逐辆驶下跳板（vehicles.js）——
function shTLS(ctx, s, P, col, a, time) {
  const lw = v => px(v) / P.k, lod = P.L * P.k * R.s, open = s.state === 'beached' || s.state === 'unloading';
  ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.h); ctx.scale(P.k, P.k);
  if (open) {   // 艏门向两侧打开，跳板伸到滩上
    shRamp(ctx, 17.2, 4.4, 30, 4, col, a, lw, lod);
    for (const g of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(17.4, g * 5.2); ctx.lineTo(22.2, g * 10.6); ctx.lineTo(23.5, g * 9.7); ctx.lineTo(18.8, g * 4.4); ctx.closePath();
      ctx.fillStyle = SH_DARK; ctx.fill(); ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw(1.1); ctx.stroke();
    }
  }
  shHull(ctx, 'lst', open, col, a, lw);
  ctx.strokeStyle = rgba(col, .6 * a); ctx.lineWidth = lw(.8);
  ctx.beginPath();
  if (!open) { ctx.moveTo(16.8, 0); ctx.lineTo(24, 0); }   // 艏门中缝
  ctx.moveTo(14.6, -6.7); ctx.lineTo(14.6, 6.7); ctx.stroke();   // 艏门铰线
  // 坦克甲板（下沉的车舱）与舱内车辆
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(-13.4, -4.7, 27.2, 9.4);
  ctx.strokeStyle = rgba(col, .45 * a); ctx.lineWidth = lw(.8); ctx.strokeRect(-13.4, -4.7, 27.2, 9.4);
  if (lod > 70) {   // 近景：甲板系固桩
    ctx.fillStyle = rgba(col, .4 * a);
    for (let x = -12; x < 13; x += 4) for (const y of [-4.1, 4.1]) ctx.fillRect(x - .3, y - .3, .6, .6);
  }
  const vs = (s.load && s.load.veh) || [], n = vs.length, gap = n > 1 ? Math.min(8, 20.5 / (n - 1)) : 0, sc = Math.min(1, gap ? gap / 7.4 : 1);
  for (let i = 0; i < n; i++) shDeckVeh(ctx, vs[i], 9.6 - i * gap, 0, sc, col, a, lw, lod);
  // 艉部上层建筑、烟囱、桅杆
  shBox(ctx, -22.6, -5.6, 8.6, 11.2, col, a, lw(1.1));
  ctx.fillStyle = rgba(col, .35 * a); ctx.fillRect(-14.9, -4.6, 1.1, 9.2);
  ctx.beginPath(); ctx.ellipse(-19.4, 0, 1.7, 2.2, 0, 0, 7); ctx.fillStyle = rgba(col, .35 * a); ctx.fill(); ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw(.9); ctx.stroke();
  if (lod >= 24) { ctx.beginPath(); ctx.moveTo(-16.4, -4); ctx.lineTo(-16.4, 4); ctx.lineWidth = lw(.7); ctx.stroke(); ctx.beginPath(); ctx.arc(-16.4, 0, .7, 0, 7); ctx.fillStyle = rgba(col, a); ctx.fill(); }
  if (lod > 70) for (const g of [-1, 1]) {   // 舷侧的车辆人员登陆艇
    ctx.save(); ctx.translate(-9, g * 6.2); ctx.scale(.36, .36);
    shHullPath(ctx, 'boat'); ctx.fillStyle = SH_DARK; ctx.fill(); ctx.strokeStyle = rgba(col, .7 * a); ctx.lineWidth = lw(.6) / .36; ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
// 甲板上的小车辆剪影（车头朝向舰艏）
function shDeckVeh(ctx, type, x, y, sc, col, a, lw, lod) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
  const L = 6.6, B = 3.9, wheel = type === 'recon', tur = !['apc', 'spg', 'td'].includes(type);
  ctx.strokeStyle = rgba(col, .9 * a); ctx.lineWidth = lw(.7) / sc;
  if (!wheel) for (const g of [-1, 1]) { ctx.fillStyle = 'rgba(4,8,6,.95)'; ctx.fillRect(-L / 2, g < 0 ? -B / 2 : B / 2 - 1, L, 1); ctx.strokeRect(-L / 2, g < 0 ? -B / 2 : B / 2 - 1, L, 1); }
  const vp = SH_DARK === SH_REAL.deck ? RLP.p.hull : SH_DARK;   // 写实：甲板上的车辆是橄榄绿
  ctx.beginPath(); ctx.rect(-L / 2 + .3, -B / 2 + .8, L - .6, B - 1.6); ctx.fillStyle = vp; ctx.fill(); ctx.fillStyle = rgba(col, .18 * a); ctx.fill(); ctx.stroke();
  if (tur) { ctx.beginPath(); ctx.arc(-.3, 0, 1.25, 0, 7); ctx.fillStyle = vp; ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(.9, 0); ctx.lineTo(L / 2 + 1.6, 0); ctx.stroke(); }
  else if (type !== 'apc') { ctx.beginPath(); ctx.moveTo(.4, 0); ctx.lineTo(L / 2 + 1.8, 0); ctx.stroke(); }
  else if (lod >= 24) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(-2.4, -.8, 3.4, 1.6); }
  ctx.restore();
}

// —— 驱逐舰：尖艏、两座炮塔（随射击方向转动）、舰桥、双烟囱、桅杆 ——
function shTurret(ctx, x, rot, col, a, lw, lod, flash) {
  ctx.save(); ctx.translate(x, 0);
  ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 7); ctx.fillStyle = SH_DARK; ctx.fill();
  ctx.strokeStyle = rgba(col, .45 * a); ctx.lineWidth = lw(.8); ctx.stroke();
  ctx.rotate(rot);
  ctx.beginPath(); ctx.moveTo(-2, -1.7); ctx.lineTo(1.5, -1.7); ctx.lineTo(2.3, -.9); ctx.lineTo(2.3, .9); ctx.lineTo(1.5, 1.7); ctx.lineTo(-2, 1.7); ctx.closePath();
  ctx.fillStyle = rgba(col, .2 * a); ctx.fill(); ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw(1.1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2.3, 0); ctx.lineTo(8, 0); ctx.lineWidth = lw(lod > 24 ? 1.4 : 1.8); ctx.stroke();
  if (flash != null) {   // 炮口焰
    const u = clamp(flash, 0, 1);
    ctx.fillStyle = rgba(COL.amber, (1 - u) * .85);
    ctx.beginPath(); ctx.moveTo(8, -1.3); ctx.lineTo(13 + 5 * (1 - u), 0); ctx.lineTo(8, 1.3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba('#fff3d6', 1 - u); ctx.beginPath(); ctx.arc(8.8, 0, 2.4 * (1 - u * .5), 0, 7); ctx.fill();
  }
  ctx.restore();
}

function shDDBody(ctx, D, P, col, a, time, flash, tur = SHIPV.tur) {
  const lw = v => px(v) / P.k, lod = P.L * P.k * R.s;
  ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.h); ctx.scale(P.k, P.k);
  shHull(ctx, 'dd', false, col, a, lw);
  if (lod >= 24) {
    ctx.strokeStyle = rgba(col, .18 * a); ctx.lineWidth = lw(.6);
    ctx.beginPath(); ctx.moveTo(21.5, 0); ctx.lineTo(18, 0); ctx.moveTo(-19.5, 0); ctx.lineTo(-23.5, 0); ctx.stroke();
    ctx.strokeStyle = rgba(col, .55 * a);   // 深弹架、鱼雷发射管
    ctx.beginPath(); ctx.moveTo(-24, -2.3); ctx.lineTo(-21, -2.3); ctx.moveTo(-24, 2.3); ctx.lineTo(-21, 2.3); ctx.stroke();
    ctx.strokeRect(-12, -.9, 4.2, 1.8);
  }
  // 舰桥
  ctx.beginPath(); ctx.moveTo(4.5, -2.8); ctx.lineTo(10.4, -2.8); ctx.lineTo(12, -1.5); ctx.lineTo(12, 1.5); ctx.lineTo(10.4, 2.8); ctx.lineTo(4.5, 2.8); ctx.closePath();
  ctx.fillStyle = SH_DARK; ctx.fill(); ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw(1.1); ctx.stroke();
  if (lod >= 24) { ctx.fillStyle = rgba(col, .4 * a); ctx.fillRect(10.6, -1.7, .9, 3.4); }
  // 烟囱
  for (const [x, rx, ry] of [[.6, 2.1, 1.5], [-5, 2, 1.4]]) {
    ctx.beginPath(); ctx.ellipse(x, 0, rx, ry, 0, 0, 7); ctx.fillStyle = rgba(col, .3 * a); ctx.fill(); ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw(.9); ctx.stroke();
    if (lod > 70) { ctx.beginPath(); ctx.ellipse(x, 0, rx * .55, ry * .5, 0, 0, 7); ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fill(); }
  }
  // 桅杆与雷达（自动掩护时雷达旋转）
  ctx.strokeStyle = rgba(col, .9 * a); ctx.lineWidth = lw(.8);
  ctx.beginPath(); ctx.moveTo(7.2, -3.6); ctx.lineTo(7.2, 3.6); ctx.stroke();
  ctx.fillStyle = rgba(col, a); ctx.beginPath(); ctx.arc(7.2, 0, .9, 0, 7); ctx.fill();
  if (D.auto && lod >= 24) { const r = time * 3; ctx.beginPath(); ctx.moveTo(7.2 - Math.cos(r) * 2.4, -Math.sin(r) * 2.4); ctx.lineTo(7.2 + Math.cos(r) * 2.4, Math.sin(r) * 2.4); ctx.stroke(); }
  if (lod > 70) {   // 近景：锚链、舷侧系缆桩
    ctx.fillStyle = rgba(col, .6 * a);
    for (const [x, y] of [[20.5, -1.1], [20.5, 1.1], [-2, -4], [-2, 4], [-18, -3.7], [-18, 3.7]]) ctx.fillRect(x - .4, y - .4, .8, .8);
  }
  shTurret(ctx, 15, tur[0], col, a, lw, lod, flash);
  shTurret(ctx, -16.5, Math.PI + tur[1], col, a, lw, lod, flash);
  ctx.restore();
}

// 炮塔指向：外部设定的 S.dd.aim > 正在瞄准的鼠标 > 最近一发舰炮弹的落点 > 艏艉向
function shDDAim(D) {
  let aim = null, flash = null;
  const shells = S.shells || [];
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i];
    if (s.side !== 'p' || (s.kind !== 'naval' && s.kind !== 'smoke') || dist(s.x0, s.y0, D.x, D.y) > 90) continue;
    SHIPV.aim = { x: s.x1, y: s.y1 }; SHIPV.aimT = S.t;
    if (s.t >= 0 && s.t < .25) flash = s.t / .25;
    break;
  }
  if (SHIPV.aim && S.t - SHIPV.aimT < 8) aim = SHIPV.aim;
  if ((U.tool === 'fire' || U.tool === 'smoke') && U.mouse && isFinite(U.mouse.x)) aim = U.mouse;
  if (D.aim && isFinite(D.aim.x) && isFinite(D.aim.y)) aim = D.aim;
  return { aim, flash };
}

// —— 航迹：沿实际航线的 V 形尾浪 + 螺旋桨尾流 ——
function shWake(ctx, P, a) {
  const tr = P.tr;
  if (!tr || !tr.length) return;
  const fade = a * clamp(1 - (S.t - tr[tr.length - 1].t) / 3, 0, 1);
  if (fade < .02) return;
  const ch = Math.cos(P.h), sh = Math.sin(P.h), hl = P.L / 2 * P.k, maxD = P.L * P.k * 3.2;
  const pts = [[P.x + ch * hl, P.y + sh * hl], [P.x - ch * hl, P.y - sh * hl]];
  for (let i = tr.length - 1; i >= 0; i--) if (dist(tr[i].x, tr[i].y, P.x, P.y) > hl + 2) pts.push([tr[i].x, tr[i].y]);
  const Lp = [], Rp = [], C = [];
  let d = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) d += dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (d > maxD) break;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)], l = dist(p0[0], p0[1], p1[0], p1[1]) || 1;
    const nx = -(p1[1] - p0[1]) / l, ny = (p1[0] - p0[0]) / l, w = d * .34;
    Lp.push([pts[i][0] + nx * w, pts[i][1] + ny * w]); Rp.push([pts[i][0] - nx * w, pts[i][1] - ny * w]); C.push(pts[i]);
  }
  if (C.length < 3) return shVWake(ctx, P.x, P.y, P.h, P.L, P.B, P.k, SH_FOAM, .4 * fade);
  const e = C[C.length - 1], gr = ctx.createLinearGradient(C[0][0], C[0][1], e[0], e[1]);
  gr.addColorStop(0, rgba(SH_FOAM, .5 * fade)); gr.addColorStop(1, rgba(SH_FOAM, 0));
  ctx.strokeStyle = gr; ctx.lineWidth = px(1.2);
  ctx.beginPath();
  for (const arm of [Lp, Rp]) arm.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
  const g2 = ctx.createLinearGradient(C[1][0], C[1][1], e[0], e[1]);
  g2.addColorStop(0, rgba(SH_FOAM, .2 * fade)); g2.addColorStop(.6, rgba(SH_FOAM, 0));
  ctx.strokeStyle = g2; ctx.lineWidth = P.B * P.k * .55;
  ctx.beginPath(); for (let i = 1; i < C.length; i++) i > 1 ? ctx.lineTo(C[i][0], C[i][1]) : ctx.moveTo(C[i][0], C[i][1]); ctx.stroke();
}

// 固定形状的 V 形尾浪（增援艇、航迹点不足时）
function shVWake(ctx, x, y, h, L, B, k, col, a) {
  const ch = Math.cos(h), sh = Math.sin(h), hl = L / 2 * k, len = L * k * 2.6, bx = x + ch * hl, by = y + sh * hl, ex = bx - ch * len, ey = by - sh * len, w = len * .34;
  const gr = ctx.createLinearGradient(bx, by, ex, ey);
  gr.addColorStop(0, rgba(col, a)); gr.addColorStop(1, rgba(col, 0));
  ctx.strokeStyle = gr; ctx.lineWidth = px(1.1);
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex - sh * w, ey + ch * w); ctx.moveTo(bx, by); ctx.lineTo(ex + sh * w, ey - ch * w); ctx.stroke();
  const sx = x - ch * hl, sy = y - sh * hl, tx = sx - ch * L * k * 1.4, ty = sy - sh * L * k * 1.4, g2 = ctx.createLinearGradient(sx, sy, tx, ty);
  g2.addColorStop(0, rgba(col, a * .45)); g2.addColorStop(1, rgba(col, 0));
  ctx.strokeStyle = g2; ctx.lineWidth = B * k * .5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
}

// —— 沉船：虚线残骸轮廓 + 逐渐扩散的油污 + 初期气泡 ——
function shWreck(ctx, P, kind, key, time) {
  const t0 = SHIPV.sunk[key] ?? (SHIPV.sunk[key] = S.t), age = Math.max(0, S.t - t0), g = Math.min(1, age / 45), sd = typeof key === 'number' ? key : 7;
  const Lk = P.L * P.k, Bk = P.B * P.k;
  ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.h);
  for (let i = 0; i < 4; i++) {
    const rx = Lk * (.26 + .3 * g) * (1 + .2 * Math.sin(i * 1.9 + sd)), ox = (i - 1.5) * Lk * .16 - g * Lk * .15, oy = Math.sin(i * 2.3 + sd) * Bk * .5;
    ctx.beginPath(); ctx.ellipse(ox, oy, rx, rx * .5, Math.sin(i + sd) * .5, 0, 7);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
    ctx.strokeStyle = realLook() ? `rgba(60,70,72,${.2 + .06 * Math.sin(time * .7 + i)})` : rgba(i % 2 ? COL.amber : COL.intel, .13 + .05 * Math.sin(time * .7 + i)); ctx.lineWidth = px(1); ctx.stroke();   // 油污
  }
  ctx.scale(P.k, P.k); ctx.rotate(.08);
  shHullPath(ctx, kind, false);
  ctx.fillStyle = realLook() ? 'rgba(40,44,46,.55)' : 'rgba(2,10,6,.35)'; ctx.fill();
  ctx.setLineDash([px(2) / P.k, px(3) / P.k]); ctx.strokeStyle = realLook() ? 'rgba(0,0,0,.35)' : rgba(COL.g, .4); ctx.lineWidth = px(1) / P.k; ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
  if (age < 30) for (let j = 0; j < 4; j++) {
    const u = (time * .8 + j * .29 + sd * .13) % 1, bx = P.x + Math.sin(j * 2.1 + sd) * Lk * .25, by = P.y + Math.cos(j * 1.7 + sd) * Bk * .4;
    ctx.strokeStyle = rgba(SH_FOAM, (1 - u) * (1 - age / 30) * .5); ctx.lineWidth = px(1);
    ctx.beginPath(); ctx.arc(bx, by, (.6 + u * 2.4) * P.k, 0, 7); ctx.stroke();
  }
}

// 受损冒烟（血量过半以下）、驱逐舰损管时的火光
function shSmoke(ctx, P, time, seed, fire) {
  const ch = Math.cos(P.h), sh = Math.sin(P.h), ox = P.x - ch * P.L * .12 * P.k, oy = P.y - sh * P.L * .12 * P.k, sk = Math.sqrt(P.k);
  for (let j = 0; j < 5; j++) {
    const u = (time * .3 + j / 5 + seed * .37) % 1;
    ctx.fillStyle = rgba(COL.smoke, .2 * (1 - u));
    ctx.beginPath(); ctx.arc(ox + u * 26 + Math.sin(j + time) * 2, oy - u * 20, (2 + u * 9) * sk, 0, 7); ctx.fill();
  }
  if (fire) { ctx.fillStyle = rgba(COL.amber, .55 + .45 * Math.sin(time * 19 + seed)); ctx.beginPath(); ctx.arc(ox, oy, 1.6 * P.k, 0, 7); ctx.fill(); }
}

// 选中括角：贴合旋转后船体的外接框
function shBrackets(ctx, P, col) {
  const c = Math.abs(Math.cos(P.h)), s = Math.abs(Math.sin(P.h)), hx = (c * P.L + s * P.B) / 2 * P.k + px(5), hy = (s * P.L + c * P.B) / 2 * P.k + px(5);
  const m = Math.max(px(4), Math.min(hx, hy) * .45);
  ctx.strokeStyle = col; ctx.lineWidth = px(1.6);
  ctx.beginPath();
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(P.x + dx * hx, P.y + dy * (hy - m)); ctx.lineTo(P.x + dx * hx, P.y + dy * hy); ctx.lineTo(P.x + dx * (hx - m), P.y + dy * hy);
  }
  ctx.stroke();
}

// 岸线内法向（指向陆地）：岸线 y = coastAt(x)，北面为陆
function shShoreNormal(x) {
  const sl = (coastAt(clamp(x + 20, 0, W - 1)) - coastAt(clamp(x - 20, 0, W - 1))) / 40;
  return isFinite(sl) ? Math.atan2(-1, sl) : -Math.PI / 2;
}

const shHalf = P => (Math.abs(Math.sin(P.h)) * P.L + Math.abs(Math.cos(P.h)) * P.B) / 2 * P.k;

// 船体在屏幕上的下沿相对 o.y 的距离（世界单位）：供载员条、编组点等避开船体
function shipHalfH(o) {
  if (!o || SHIPV.S !== S) return 16;
  const P = SHIPV.pose[o === S.dd ? 'DD' : o.id];
  return P ? shHalf(P) + (P.y - o.y) : 16;
}

function shPips(ctx, P, hp, maxhp) {
  const n = clamp(Math.round(maxhp) || 0, 0, 16);
  if (!n) return;
  const g = px(clamp(P.L * P.k * R.s * 1.1 / n, 1.6, 3.2)), w = g * .7, y = P.y + shHalf(P) + px(5), x0 = P.x - (n * g - (g - w)) / 2;   // 远景时点距收窄，不超出船宽
  for (let i = 0; i < n; i++) { ctx.fillStyle = rgba(hp > 3 ? COL.g : COL.enemy, .15 + .8 * clamp(hp - i, 0, 1)); ctx.fillRect(x0 + i * g, y, w, w); }
}

function shInView(P, vr) {
  const m = P.L * P.k + 40;
  return P.x > vr[0] - m && P.x < vr[2] + m && P.y > vr[1] - m && P.y < vr[3] + m;
}

function drawShips(time) {
  shSync();
  const real = shLook(), dcol = real ? SH_REAL.edge : COL.g;
  const ctx = R.ctx, dt = clamp(time - SHIPV.t1, 0, .25), vr = viewRect(), list = [];
  SHIPV.t1 = time;
  for (const s of S.ships) {
    if (!s || !isFinite(s.x) || !isFinite(s.y)) continue;
    const dim = SHIP_DIM[s.kind] || SHIP_DIM.assault, sunk = s.state === 'sunk', beached = s.state === 'beached' || s.state === 'unloading';
    let tg = s.heading ?? -Math.PI / 2;
    if (beached) tg = shShoreNormal(s.x);   // 抢滩：舰艏垂直顶向岸线
    if (sunk && SHIPV.h[s.id] != null) tg = SHIPV.h[s.id];
    const P = shPose(s, s.id, dim[0], dim[1], tg, s.state === 'move', dt, beached);
    list.push({ s, P, vis: shInView(P, vr), sunk, beached, kind: s.kind === 'supply' ? 'supply' : s.kind === 'lst' ? 'lst' : s.kind === 'dd' ? 'dd' : 'assault' });
  }
  // 航线与预定抢滩点
  for (const { s } of list) if (s.state === 'move' && isFinite(s.tx)) {
    const sel = isSel(s.id);
    ctx.strokeStyle = sel ? rgba(COL.sel, .7) : rgba(COL.g, .22); ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(4)]);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.tx, s.ty); ctx.stroke(); ctx.setLineDash([]);
    if (s.land && s.bx != null) {
      const fh = Math.max(12, px(14));
      ctx.beginPath(); ctx.moveTo(s.bx, s.by); ctx.lineTo(s.bx, s.by - fh); ctx.lineTo(s.bx + fh * .58, s.by - fh * .75); ctx.lineTo(s.bx, s.by - fh * .5); ctx.stroke();
    }
  }
  for (const o of list) if (o.sunk && o.vis) shWreck(ctx, o.P, o.kind, o.s.id, time);
  for (const o of list) if (!o.sunk && o.vis) shWake(ctx, o.P, .9);
  for (const o of list) {
    if (o.sunk || !o.vis) continue;
    const a = o.s.state === 'beached' ? .6 : 1;
    if (o.kind === 'supply') shLST(ctx, o.s, o.P, dcol, a, time); else if (o.kind === 'lst') shTLS(ctx, o.s, o.P, dcol, a, time);
    else if (o.kind === 'dd') { const f = o.s.fireT != null && S.t - o.s.fireT < .25 ? (S.t - o.s.fireT) / .25 : null; shDDBody(ctx, o.s, o.P, dcol, a, time, f, shEscortTur(o.s, o.P, dt)); }
    else shLCT(ctx, o.s, o.P, dcol, a, time);
  }
  for (const { s, P, vis, sunk } of list) {
    if (sunk || !vis) continue;
    if (s.hp < s.maxhp * .5) shSmoke(ctx, P, time, s.id, s.hp < s.maxhp * .3);
    if (s.state === 'unloading') {
      ctx.strokeStyle = COL.g; ctx.lineWidth = px(2);
      const lv = s.kind === 'lst' ? ((s.load && s.load.veh) || []).length : 0, fu = s.kind === 'lst' ? 1 - lv / Math.max(1, lv + (s.vk || 0)) : clamp((s.ut || 0) / 3, 0, 1);   // LST：已下车辆的比例
      ctx.beginPath(); ctx.arc(P.x, P.y, P.L * P.k * .5 + 4, -1.57, -1.57 + fu * 6.283); ctx.stroke();
    }
    if (isSel(s.id)) shBrackets(ctx, P, COL.sel);
    if (s.state !== 'beached') shPips(ctx, P, s.hp, s.maxhp);
  }
}

// 护航舰炮塔：各舰独立转向最近一次射击的目标（渲染缓存，不进 S）
function shEscortTur(s, P, dt) {
  const t = SHIPV.etur[s.id] || (SHIPV.etur[s.id] = [0, 0]), aim = s.fireT != null && S.t - s.fireT < 8 && isFinite(s.aimX) ? { x: s.aimX, y: s.aimY } : null;
  for (let i = 0; i < 2; i++) {
    const rest = i ? Math.PI : 0, tg = aim ? clamp(shWrap(Math.atan2(aim.y - P.y, aim.x - P.x) - P.h - rest), -2.5, 2.5) : 0;
    t[i] += clamp(tg - t[i], -2.4 * dt, 2.4 * dt);
  }
  return t;
}

function drawDD(time) {
  shSync();
  const real = shLook();
  const ctx = R.ctx, D = S.dd;
  if (!D || !isFinite(D.x) || !isFinite(D.y)) return;
  const dt = clamp(time - SHIPV.t2, 0, .25), sunk = D.state === 'sunk';
  SHIPV.t2 = time;
  const P = shPose(D, 'DD', 50, 9, sunk && SHIPV.h.DD != null ? SHIPV.h.DD : D.heading ?? -Math.PI / 2, !!D.moving && !sunk, dt, false);
  if (sunk) { shWreck(ctx, P, 'dd', 'DD', time); return; }
  const col = D.state === 'repair' ? COL.amber : COL.g, sel = isSel('DD'), bcol = real && D.state !== 'repair' ? SH_REAL.edge : col;
  if (sel || U.tool === 'fire' || U.tool === 'smoke') {
    ctx.strokeStyle = rgba(COL.g, .12); ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(8)]);
    ctx.beginPath(); ctx.arc(D.x, D.y, 1000, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
  if (D.moving && isFinite(D.tx)) {
    ctx.strokeStyle = rgba(COL.sel, .5); ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(4)]);
    ctx.beginPath(); ctx.moveTo(D.x, D.y); ctx.lineTo(D.tx, D.ty); ctx.stroke(); ctx.setLineDash([]);
  }
  // 炮塔转向（相对艏/艉的偏角，限制在 ±143° 内，不会扫过上层建筑）
  const { aim, flash } = shDDAim(D);
  for (let i = 0; i < 2; i++) {
    const rest = i ? Math.PI : 0, tgt = aim ? clamp(shWrap(Math.atan2(aim.y - P.y, aim.x - P.x) - P.h - rest), -2.5, 2.5) : 0;
    SHIPV.tur[i] += clamp(tgt - SHIPV.tur[i], -2.4 * dt, 2.4 * dt);
  }
  if (!shInView(P, viewRect())) return;
  shWake(ctx, P, .9);
  shDDBody(ctx, D, P, bcol, 1, time, flash);
  if (D.state === 'repair') shSmoke(ctx, P, time, 7, true);
  const rr = P.L * P.k * .5 + 6;
  ctx.lineWidth = px(2.2);
  if (D.state === 'repair') { ctx.strokeStyle = COL.amber; ctx.beginPath(); ctx.arc(P.x, P.y, rr, -1.57, -1.57 + clamp(D.repairT / (D.repairDur || 16), 0, 1) * 6.283); ctx.stroke(); }
  else if (D.cool > 0) { ctx.strokeStyle = rgba(COL.g, .5); ctx.beginPath(); ctx.arc(P.x, P.y, rr, -1.57, -1.57 + clamp(1 - D.cool / 5, 0, 1) * 6.283); ctx.stroke(); }
  if (S.t < (D.exposedUntil || 0)) { ctx.strokeStyle = rgba(COL.enemy, .5 + .5 * Math.sin(time * 12)); ctx.lineWidth = px(1.5); ctx.beginPath(); ctx.arc(P.x, P.y, rr + 6, 0, 7); ctx.stroke(); }
  if (sel) shBrackets(ctx, P, COL.sel);
  const y = P.y + shHalf(P) + px(7);
  for (let i = 0; i < 3; i++) { ctx.fillStyle = rgba(col, D.hull > i ? .95 : .15); shape(ctx, P.x + (i - 1) * px(8), y, px(3), 5, -1.57); ctx.fill(); }
}

// —— 增援艇（LCVP）：小方艇、艏跳板、载员点、尾浪 ——
function drawBoat(ctx, x, y, heading, opt) {
  if (!isFinite(x) || !isFinite(y)) return;
  opt = opt || {};
  const real = shLook(), h = isFinite(heading) ? heading : -Math.PI / 2, col = real ? SH_REAL.edge : opt.col || COL.intel, k = clamp(9 / (12 * R.s), 1, 3), lod = 12 * k * R.s, lw = v => px(v) / k;
  const n = clamp(opt.n ?? 3, 0, 9);
  if (opt.wake !== false) shVWake(ctx, x, y, h, 12, 5, k, SH_FOAM, .45);
  ctx.save(); ctx.translate(x, y); ctx.rotate(h); ctx.scale(k, k);
  shHull(ctx, 'boat', false, col, 1, lw);
  ctx.fillStyle = rgba(col, .55); ctx.fillRect(4.6, -2.2, 1.4, 4.4);   // 艏跳板
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-3, -1.6, 7.2, 3.2);
  if (lod < 16) { if (n) { ctx.fillStyle = rgba(col, .2 + .5 * n / 9); ctx.fillRect(-3, -1.6, 7.2, 3.2); } }
  else {
    const r = Math.max(.35, lw(.9));
    ctx.fillStyle = rgba(col, .95);
    for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(3.3 - Math.floor(i / 3) * 2.4, (i % 3 - 1) * 1.05, r, 0, 7); ctx.fill(); }
  }
  ctx.fillStyle = rgba(col, .6); ctx.fillRect(-5.3, -1, 1.6, 2);   // 艇长位
  ctx.restore();
}

// 点选：落在（放大后的）船体轮廓内即选中；没画过时返回 null，由原距离判定兜底
function pickShip(p) {
  if (!S || !p || SHIPV.S !== S) return null;
  let best = null, bd = 1e9;
  const test = (key, id) => {
    const P = SHIPV.pose[key];
    if (!P) return;
    const dx = p.x - P.x, dy = p.y - P.y, c = Math.cos(P.h), s = Math.sin(P.h), lx = dx * c + dy * s, ly = -dx * s + dy * c, m = px(4);
    if (Math.abs(lx) > P.L / 2 * P.k + m || Math.abs(ly) > P.B / 2 * P.k + m) return;
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = id; }
  };
  for (const s of S.ships) if (alive(s)) test(s.id, s.id);
  if (S.dd && S.dd.state !== 'sunk') test('DD', 'DD');
  return best;
}
