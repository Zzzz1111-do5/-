'use strict';
// 敌方火炮俯视建模：岸防重炮、榴弹炮、火箭炮、迫击炮、高炮、机枪碉堡。
// 近看（每世界单位 ≥ 1 像素）画世界尺寸的炮位：掩体、炮架、炮管指向最近一次射击的方向，开火时后坐与炮口焰，旁边有炮组；
// 远看仍用 render2.js 的简洁图标。只有形状，不写字。
const GUNV = { S: null, aim: {}, fire: {} };   // 渲染缓存（不进 S）：各炮最近的射向（弧度）与开火时刻

// 从刚出膛的炮弹 / 曳光弹反查是哪门炮打的（炮弹起点就是炮位坐标）
function gunScan() {
  if (GUNV.S !== S) { GUNV.S = S; GUNV.aim = {}; GUNV.fire = {}; }
  const near = (x, y) => S.enemies.find(e => !e.dead && Math.abs(e.x - x) < 2.5 && Math.abs(e.y - y) < 2.5);
  for (const s of S.shells) if (s.side === 'e' && s.t >= 0 && s.t < .25) { const e = near(s.x0, s.y0); if (e) { GUNV.aim[e.id] = Math.atan2(s.y1 - s.y0, s.x1 - s.x0); GUNV.fire[e.id] = S.t - s.t; } }
  for (const t of S.tracers) if (t.side === 'e' && !t.fuzzy && t.life < .06) { const e = near(t.x0, t.y0); if (e) { GUNV.aim[e.id] = Math.atan2(t.y1 - t.y0, t.x1 - t.x0); GUNV.fire[e.id] = S.t - t.life; } }
}
// 炮口朝向：最近射击方向；没打过时岸炮、火炮朝海（南），高炮缓慢搜索或跟踪最近的飞机
function gunAim(e, time) {
  if (e.kind === 'tel' || e.kind === 'typhon' || e.kind === 'ascm') return e.th ?? Math.PI / 2;   // 发射车：车头朝行驶 / 发射方向（missile.js、antiship.js 的车阵与导弹出口按同一个朝向）
  if (e.kind === 'aa') {
    let best = null, bd = 300;
    for (const p of S.planes || []) if (!p.dead && p.alt > .3) { const d = dist(p.x, p.y, e.x, e.y); if (d < bd) { bd = d; best = p; } }
    if (best) return Math.atan2(best.y - e.y, best.x - e.x);
    if (GUNV.aim[e.id] != null && S.t - GUNV.fire[e.id] < 6) return GUNV.aim[e.id];
    return -1.57 + Math.sin(time * .35 + e.id) * 1.2;
  }
  return GUNV.aim[e.id] ?? Math.PI / 2 + Math.sin(e.id * 7.3) * .35;
}
const gunRocket = e => e.kind === 'arty' && e.mod && (e.mod.salvo || 1) >= 2;

// 炮组：近看画几个小人，朝向射向
function gunCrew(ctx, x, y, a, pts, col) {
  if (typeof drawMan !== 'function' || !R.fig) return;
  const c = Math.cos(a), s = Math.sin(a);
  for (const [u, v, role] of pts) drawMan(ctx, x + u * c - v * s, y + u * s + v * c, a, role || 'rifle', realLook() ? rgba(COL.enemy, .5) : col, true, 'e');
}
// 沙袋环：一圈小圆角块；open 为缺口方向（弧度），不设则为整圈
function gunSandbags(ctx, x, y, r, open, col) {
  const n = Math.max(8, Math.round(r * 1.4)), gap = open == null ? 0 : .9;
  ctx.fillStyle = realLook() ? rlGun().sand : 'rgba(2,10,6,.85)'; ctx.strokeStyle = realLook() ? 'rgba(70,58,40,.8)' : col; ctx.lineWidth = px(1);
  for (let i = 0; i < n; i++) {
    const a = i / n * 6.283;
    if (open != null && Math.abs(Math.atan2(Math.sin(a - open), Math.cos(a - open))) < gap) continue;
    ctx.save(); ctx.translate(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.rotate(a + 1.57);
    ctx.beginPath(); ctx.ellipse(0, 0, 1.6, .9, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
  }
}
function gunFlash(ctx, x, y, a, len, k) {   // 炮口焰：k 0–1 随时间衰减
  const mx = x + Math.cos(a) * len, my = y + Math.sin(a) * len;
  ctx.fillStyle = rgba('#fff3d6', .9 * k); ctx.beginPath(); ctx.arc(mx, my, 2.2 + 2 * k, 0, 7); ctx.fill();
  ctx.fillStyle = rgba(COL.amber, .5 * k); ctx.beginPath(); ctx.ellipse(mx + Math.cos(a) * 3, my + Math.sin(a) * 3, 5 * k + 1, 2.2 * k + .6, a, 0, 7); ctx.fill();
}

// 主入口：返回 true 表示已按模型绘制（render2.js drawEnemies 调用）
function gunModel(ctx, e, x, y, vis, time) {
  if (R.s < .75) return false;   // 约 2 倍全图以上才画模型
  const K = { coastal: 1, arty: 1, mortar: 1, aa: 1, bunker: 1, tel: 1, typhon: 1, ascm: 1 };
  if (!K[e.kind]) return false;
  if (GUNV.S !== S || GUNV.t !== time) { gunScan(); GUNV.t = time; }
  const real = vis && realLook();   // 写实：深色金属描边、沙色 / 混凝土底，不再是发光线稿
  const a = gunAim(e, time), col = real ? rlGun().col : rgba(COL.enemy, vis ? .95 : .4), dim = real ? rlGun().dim : rgba(COL.enemy, vis ? .45 : .2), con = real ? rlGun().con : rgba(STRUCT, vis ? .3 : .12);
  const ft = S.t - (GUNV.fire[e.id] ?? -99), fk = vis && ft < .3 ? 1 - ft / .3 : 0, rec = vis && ft < .45 ? (1 - ft / .45) * 2.2 : 0;
  const dark = real ? rlGun().dark : 'rgba(30,4,10,.85)';
  ctx.save();
  if (!vis) ctx.setLineDash([px(2), px(2)]);
  ctx.lineWidth = px(1.2);
  if (e.dead) { gunWreck(ctx, e, x, y, a); ctx.restore(); return true; }
  if (e.kind === 'coastal') {
    // 圆形混凝土炮台 + 环形炮座 + 旋转炮塔与长炮管
    ctx.fillStyle = real ? rlGun().concrete : 'rgba(2,10,6,.9)'; ctx.strokeStyle = con; ctx.lineWidth = px(3);
    ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.fill(); ctx.stroke();
    ctx.lineWidth = px(1); ctx.strokeStyle = dim; ctx.setLineDash([px(2), px(3)]); ctx.beginPath(); ctx.arc(x, y, 9.5, 0, 7); ctx.stroke(); ctx.setLineDash(vis ? [] : [px(2), px(2)]);
    ctx.fillStyle = dark; ctx.strokeStyle = con; ctx.lineWidth = px(1.2);
    ctx.fillRect(x - 3.5 - Math.cos(a) * 17, y - 2.5 - Math.sin(a) * 17, 7, 5); ctx.strokeRect(x - 3.5 - Math.cos(a) * 17, y - 2.5 - Math.sin(a) * 17, 7, 5);   // 弹药掩体（炮后）
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.strokeStyle = col; ctx.lineWidth = 2.6; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(4 - rec, 0); ctx.lineTo(23 - rec, 0); ctx.stroke();
    ctx.lineWidth = 3.6; ctx.beginPath(); ctx.moveTo(21 - rec, 0); ctx.lineTo(23.5 - rec, 0); ctx.stroke();   // 炮口制退器
    ctx.lineCap = 'round'; ctx.lineWidth = px(1.3); ctx.fillStyle = dark; ctx.strokeStyle = col;
    ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(4, -5.5); ctx.quadraticCurveTo(7.5, 0, 4, 5.5); ctx.lineTo(-6, 5); ctx.closePath(); ctx.fill(); ctx.stroke();   // 炮塔防盾
    ctx.fillStyle = dim; ctx.fillRect(-4, -1.2, 5, 2.4);
    ctx.restore();
    if (vis) gunCrew(ctx, x, y, a, [[-9, -6], [-10, 6], [-14, 0, 'radio']], col);
    if (fk) gunFlash(ctx, x, y, a, 24 - rec, fk);
  } else if (e.kind === 'arty' && gunRocket(e)) {
    // 火箭炮：卡车底盘 + 驾驶室 + 斜指射向的多管发射架
    gunSandbags(ctx, x, y, 13, a, dim);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = dark; ctx.strokeStyle = col; ctx.lineWidth = px(1.2);
    ctx.fillRect(-10, -3.6, 15, 7.2); ctx.strokeRect(-10, -3.6, 15, 7.2);   // 车体
    ctx.fillRect(5, -3, 4.5, 6); ctx.strokeRect(5, -3, 4.5, 6);   // 驾驶室
    ctx.fillStyle = dim; for (const [u, v] of [[-8, -4.4], [-3, -4.4], [3, -4.4], [-8, 3.4], [-3, 3.4], [3, 3.4]]) ctx.fillRect(u, v, 2.6, 1);   // 车轮
    ctx.fillStyle = dark; ctx.fillRect(-9, -3, 11, 6); ctx.strokeRect(-9, -3, 11, 6);   // 发射架
    ctx.lineWidth = px(1);
    for (let i = 0; i < 5; i++) { const v = -2.4 + i * 1.2; ctx.beginPath(); ctx.moveTo(-9, v); ctx.lineTo(2, v); ctx.stroke(); }
    ctx.restore();
    if (vis) gunCrew(ctx, x, y, a, [[-14, -6], [-15, 6]], col);
    if (fk) { for (let i = 0; i < 3; i++) gunFlash(ctx, x + Math.cos(a + 1.57) * (i - 1) * 2, y + Math.sin(a + 1.57) * (i - 1) * 2, a, 3, fk * .8); ctx.fillStyle = rgba(COL.smoke, .35 * fk); ctx.beginPath(); ctx.arc(x - Math.cos(a) * 14, y - Math.sin(a) * 14, 8 + 6 * (1 - fk), 0, 7); ctx.fill(); }   // 尾焰与后喷烟
  } else if (e.kind === 'arty') {
    // 榴弹炮：马蹄形沙袋掩体（开口朝射向）+ 炮轮、防盾、大架两腿 + 炮管
    gunSandbags(ctx, x, y, 12, a, dim);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.strokeStyle = col; ctx.lineWidth = px(1.3);
    ctx.beginPath(); ctx.moveTo(-1, -1.8); ctx.lineTo(-11, -5.5); ctx.moveTo(-1, 1.8); ctx.lineTo(-11, 5.5); ctx.stroke();   // 大架
    ctx.lineWidth = px(2); ctx.beginPath(); ctx.moveTo(-11, -6.8); ctx.lineTo(-11, -4.2); ctx.moveTo(-11, 4.2); ctx.lineTo(-11, 6.8); ctx.stroke();   // 驻锄
    ctx.fillStyle = dark; ctx.lineWidth = px(1.1);
    for (const s of [-1, 1]) { ctx.fillRect(-1.8, s * 4.6 - .9, 3.6, 1.8); ctx.strokeRect(-1.8, s * 4.6 - .9, 3.6, 1.8); }   // 炮轮
    ctx.beginPath(); ctx.moveTo(1.5, -4); ctx.quadraticCurveTo(3, 0, 1.5, 4); ctx.stroke();   // 防盾
    ctx.lineWidth = 1.7; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(-2 - rec, 0); ctx.lineTo(13 - rec, 0); ctx.stroke(); ctx.lineCap = 'round';
    ctx.restore();
    ctx.fillStyle = dark; ctx.strokeStyle = dim; ctx.lineWidth = px(1);
    for (const [u, v] of [[-15, -3], [-15, 1.5]]) { const c = Math.cos(a), s = Math.sin(a), bx = x + u * c - v * s, by = y + u * s + v * c; ctx.fillRect(bx - 1.6, by - 1.2, 3.2, 2.4); ctx.strokeRect(bx - 1.6, by - 1.2, 3.2, 2.4); }   // 弹药箱
    if (vis) gunCrew(ctx, x, y, a, [[-7, -7], [-9, 7], [-4, 8.5, 'radio']], col);
    if (fk) gunFlash(ctx, x, y, a, 14 - rec, fk);
  } else if (e.kind === 'mortar') {
    // 迫击炮：圆形炮坑 + 座钣 + 短炮身与两脚架
    gunSandbags(ctx, x, y, 7, null, dim);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = dark; ctx.strokeStyle = col; ctx.lineWidth = px(1.1);
    ctx.beginPath(); ctx.arc(-1.5, 0, 1.8, 0, 7); ctx.fill(); ctx.stroke();   // 座钣
    ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-1.5, 0); ctx.lineTo(4.5, 0); ctx.stroke();   // 炮身（高仰角，俯视很短）
    ctx.lineWidth = px(1); ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(1.5, -2.6); ctx.moveTo(3, 0); ctx.lineTo(1.5, 2.6); ctx.stroke();   // 两脚架
    ctx.restore();
    if (vis) gunCrew(ctx, x, y, a, [[-4, -3.5], [-4.5, 3.5]], col);
    if (fk) gunFlash(ctx, x, y, a, 4.5, fk * .8);
  } else if (e.kind === 'aa') {
    // 高炮：圆形沙袋阵地 + 炮座 + 双联长炮管；雷达高炮带一个小雷达
    gunSandbags(ctx, x, y, 10, null, dim);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = dark; ctx.strokeStyle = col; ctx.lineWidth = px(1.2);
    ctx.beginPath(); ctx.arc(0, 0, 3.6, 0, 7); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1; ctx.lineCap = 'butt';
    for (const v of [-1.3, 1.3]) { ctx.beginPath(); ctx.moveTo(1, v); ctx.lineTo(13, v); ctx.stroke(); }
    ctx.lineCap = 'round'; ctx.lineWidth = px(1); ctx.strokeRect(-3, -2.6, 4, 5.2);   // 炮手座
    ctx.restore();
    if (e.mod && (e.mod.aa || 1) > 1.5) {   // 雷达
      const rx = x - Math.cos(a) * 12, ry = y - Math.sin(a) * 12, ra = time * 2.5;
      ctx.strokeStyle = col; ctx.lineWidth = px(1.2);
      ctx.beginPath(); ctx.arc(rx, ry, 3, ra - .9, ra + .9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + Math.cos(ra) * 3, ry + Math.sin(ra) * 3); ctx.stroke();
    }
    if (vis) gunCrew(ctx, x, y, a, [[-6, -5.5], [-6, 5.5]], col);
    if (fk) { gunFlash(ctx, x + Math.cos(a + 1.57) * 1.3, y + Math.sin(a + 1.57) * 1.3, a, 13, fk); gunFlash(ctx, x - Math.cos(a + 1.57) * 1.3, y - Math.sin(a + 1.57) * 1.3, a, 13, fk); }
  } else if (e.kind === 'bunker') {
    // 机枪碉堡：厚墙混凝土工事（圆角方形）、朝射向的射孔与伸出的枪管、伪装点
    const sa = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);   // 射孔开在最接近射向的那面墙
    ctx.fillStyle = real ? rlGun().concrete : 'rgba(2,10,6,.92)'; ctx.strokeStyle = con; ctx.lineWidth = px(3);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 8, y - 8, 16, 16, 3) : ctx.rect(x - 8, y - 8, 16, 16); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = px(1.2);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 5.5, y - 5.5, 11, 11, 2) : ctx.rect(x - 5.5, y - 5.5, 11, 11); ctx.stroke();
    ctx.save(); ctx.translate(x, y); ctx.rotate(sa);
    ctx.fillStyle = '#000'; ctx.fillRect(6.2, -3.2, 2.6, 6.4);   // 射孔
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(10.5 - rec * .5, 0); ctx.stroke();   // 机枪管
    ctx.restore();
    ctx.fillStyle = dim; for (const [u, v] of [[-3, -2], [2, 3], [-2, 3.5], [3, -3]]) ctx.fillRect(x + u - .5, y + v - .5, 1, 1);   // 伪装网结
    if (fk) gunFlash(ctx, x, y, sa, 10.5, fk * .9);
  } else if (e.kind === 'tel') {
    // 战术导弹发射车：四轴重型底盘 + 驾驶室；停车后液压臂把导弹竖起（俯视投影缩短成一点），点火后放下空架，随即转移阵地
    const ft = S.t - (e.fireT ?? -99), up = e.moving ? 0 : ft < 1.5 ? ft / 1.5 : ft < 3.5 ? 1 - (ft - 1.5) / 2 : 0, loaded = (e.n ?? 2) > 0 || ft < 1.5, L = 15 * (1 - .82 * up);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = dark; ctx.strokeStyle = col; ctx.lineWidth = px(1.2);
    ctx.fillRect(-10, -3.2, 17, 6.4); ctx.strokeRect(-10, -3.2, 17, 6.4);   // 车体
    ctx.fillRect(7, -3, 4.2, 6); ctx.strokeRect(7, -3, 4.2, 6);   // 驾驶室
    ctx.fillStyle = dim; for (const u of [-8, -4.5, 1, 4.5]) for (const v of [-4, 3]) ctx.fillRect(u, v, 2.6, 1);   // 车轮
    ctx.strokeStyle = dim; ctx.lineWidth = px(1); ctx.strokeRect(-9.5, -1.6, Math.max(2, L), 3.2);   // 起竖臂
    if (loaded) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(-9.5, 0); ctx.lineTo(-9.5 + L, 0); ctx.stroke(); ctx.lineCap = 'round';
      ctx.fillStyle = rgba('#ffffff', vis ? .9 : .4); ctx.beginPath(); ctx.arc(-9.5 + L, 0, up > .6 ? 1.4 : .9, 0, 7); ctx.fill();   // 弹头
    }
    ctx.restore();
    if (vis && ft >= 1.5 && ft < 2.6) {   // 点火：车尾尾焰与扬起的烟尘
      const k = 1 - (ft - 1.5) / 1.1, bx = x - Math.cos(a) * 10, by = y - Math.sin(a) * 10;
      ctx.fillStyle = rgba('#fff3d6', .85 * k); ctx.beginPath(); ctx.arc(bx, by, 3 + 3 * k, 0, 7); ctx.fill();
      ctx.fillStyle = rgba(COL.smoke, .35 * k); ctx.beginPath(); ctx.arc(bx, by, 10 + 10 * (1 - k), 0, 7); ctx.fill();
    }
    if (vis && !e.moving) gunCrew(ctx, x, y, a, [[-4, -7], [3, 7, 'radio']], col);
  } else if (e.kind === 'typhon') tyModel(ctx, e, x, y, a, vis, col, dim, dark, real);
  else if (e.kind === 'ascm') ascModel(ctx, e, x, y, a, vis, col, dim, dark, real);
  ctx.restore();
  return true;
}

// 局部坐标里的矩形（u 沿车头方向、v 向右）
const gunRect = (ctx, u0, u1, v0, v1) => ctx.rect(Math.min(u0, u1), Math.min(v0, v1), Math.abs(u1 - u0), Math.abs(v1 - v0));
// 地面投影：光从西北来，每单位高度向东南偏 0.3（afbase.js 同一套）；换成车阵局部坐标
const gunSh = a => [.3 * (Math.cos(a) + Math.sin(a)), .3 * (Math.cos(a) - Math.sin(a))];
// 发射后的燃气：一团灰白烟，随风（向东）飘散变大
function gunPuff(ctx, u, v, age, life, r0, a) {
  if (age < 0 || age > life) return;
  const k = age / life, wu = Math.cos(a) * 1.4 * age, wv = -Math.sin(a) * 1.4 * age;
  ctx.fillStyle = rgba(COL.smoke, .5 * (1 - k)); ctx.beginPath(); ctx.arc(u + wu, v + wv, r0 + age * 2.6, 0, 7); ctx.fill();
}
function gunFlare(ctx, u, v, k, r) {   // 点火白光：k 1 → 0
  ctx.fillStyle = rgba('#fff3d6', .95 * k); ctx.beginPath(); ctx.arc(u, v, r * (.6 + .4 * k), 0, 7); ctx.fill();
  ctx.fillStyle = rgba(COL.amber, .55 * k); ctx.beginPath(); ctx.arc(u, v, r * 1.8 * (.7 + .3 * k), 0, 7); ctx.fill();
}

// 「堤丰」导弹排（车阵见 antiship.js TY_RIG）：4 套发射单元并排——HEMTT 牵引车（全宽驾驶室、风挡、后视镜、排气管、四轴八轮）
//   + M870 拖车（鹅颈、三轴、展开的四个液压支腿），拖车上卧着 Mk 41 四联装发射箱（侧面加强筋、箱口端盖）；
//   发射前箱子绕拖车尾部铰点起竖到垂直：卧着看见侧面，竖起来看见箱顶 2×2 四个单元格的舱盖，地上拖出长长的投影；
//   点火前舱盖打开（黑），点火瞬间白光、燃气从箱顶冒出随风飘散、地面一圈冲击波；打空的发射单元尾部地面留下烧蚀痕；
//   车阵后方是连指挥车（方舱、鞭状天线、卫星天线）与发电车，电缆连到车阵
function tyModel(ctx, e, x, y, a, vis, col, dim, dark, real) {
  const R0 = TY_RIG, [su, sv] = gunSh(a), fired = AS.ty.n - (e.n ?? AS.ty.n), ft = e.fireT != null ? S.t - e.fireT : 99, glass = real ? 'rgba(150,190,210,.9)' : rgba(col, .9);
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.lineWidth = px(1.1);
  // 排部：连指挥车与发电车（车阵后方左右）
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); gunRect(ctx, -33 + su * 3, -21 + su * 3, -9.2 + sv * 3, -4.6 + sv * 3); gunRect(ctx, -31 + su * 1.6, -25.5 + su * 1.6, 4.8 + sv * 1.6, 8.4 + sv * 1.6); ctx.fill();
  ctx.fillStyle = dark; ctx.strokeStyle = col;
  ctx.beginPath(); gunRect(ctx, -24.2, -21, -9, -4.8); ctx.fill(); ctx.stroke();   // 驾驶室
  ctx.beginPath(); gunRect(ctx, -33, -24.6, -9.2, -4.6); ctx.fill(); ctx.stroke();   // 方舱
  ctx.strokeStyle = glass; ctx.lineWidth = px(1.4); ctx.beginPath(); ctx.moveTo(-21.25, -8.5); ctx.lineTo(-21.25, -5.3); ctx.stroke(); ctx.lineWidth = px(1.1);
  ctx.strokeStyle = dim; ctx.beginPath(); ctx.arc(-27.6, -6.9, 1.25, 0, 7); ctx.moveTo(-27.6, -6.9); ctx.lineTo(-26.2, -8.1); ctx.stroke();   // 卫星天线
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(-31.6, -8.3, .45, 0, 7); ctx.arc(-31.6, -5.5, .45, 0, 7); ctx.fill();   // 鞭状天线座
  ctx.fillStyle = dark; ctx.strokeStyle = col; ctx.beginPath(); gunRect(ctx, -31, -25.5, 4.8, 8.4); ctx.fill(); ctx.stroke();   // 发电车
  ctx.strokeStyle = dim; ctx.beginPath(); for (let u = -30; u < -26; u += 1.1) { ctx.moveTo(u, 5.4); ctx.lineTo(u, 7.8); } ctx.moveTo(-25.5, 6.6); ctx.lineTo(-23.6, 6.6); ctx.stroke();
  ctx.setLineDash([px(1.5), px(2)]); ctx.beginPath(); ctx.moveTo(-25.5, 7.6); ctx.quadraticCurveTo(-20, 9, -17, (R0.n - 1) / 2 * R0.gap * .5); ctx.moveTo(-28, 4.8); ctx.quadraticCurveTo(-27, -1, -24.6, -4.6); ctx.stroke(); ctx.setLineDash(vis ? [] : [px(2), px(2)]);   // 电缆
  for (let k = 0; k < R0.n; k++) {
    const v0 = (k - (R0.n - 1) / 2) * R0.gap, th = tyErect(e, k), sn = Math.sin(th), cs = Math.cos(th), cur = e.tyL === k && ft < R0.up + R0.hold + R0.down, spent = (k + 1) * 4 <= fired && !cur;
    ctx.save(); ctx.translate(0, v0);
    if (spent || (cur && ft > R0.up)) { const g = ctx.createRadialGradient(R0.piv - R0.T / 2, 0, 0, R0.piv - R0.T / 2, 0, 7); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(R0.piv - R0.T / 2, 0, 7, 0, 7); ctx.fill(); }   // 烧蚀痕
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); gunRect(ctx, -17 + su * 2.2, 15 + su * 2.2, -2.4 + sv * 2.2, 2.4 + sv * 2.2); ctx.fill();   // 车的投影
    // 拖车：甲板、横梁、三轴车轮、液压支腿
    ctx.fillStyle = dim; ctx.beginPath();
    for (const u of [-10.6, -12.8, -15]) for (const s of [-1, 1]) gunRect(ctx, u - 1.05, u + 1.05, s * 2.4, s * 3.3);
    for (const u of [13.4, 11, 4.6, 2.3]) for (const s of [-1, 1]) gunRect(ctx, u - 1.05, u + 1.05, s * 1.95, s * 2.85);
    ctx.fill();
    if (!e.moving) { ctx.strokeStyle = dim; ctx.beginPath(); for (const u of [-16.2, -1.8]) for (const s of [-1, 1]) { ctx.moveTo(u, s * 2.4); ctx.lineTo(u, s * 4); } ctx.stroke(); ctx.fillStyle = dim; ctx.beginPath(); for (const u of [-16.2, -1.8]) for (const s of [-1, 1]) gunRect(ctx, u - .65, u + .65, s * 3.8, s * 4.9); ctx.fill(); }
    ctx.fillStyle = dark; ctx.strokeStyle = col;
    ctx.beginPath(); gunRect(ctx, -17, -.5, -2.4, 2.4); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = dim; ctx.beginPath(); for (let u = -15; u < -1; u += 2.1) { ctx.moveTo(u, -2.4); ctx.lineTo(u, 2.4); } ctx.stroke();
    // 牵引车：车架、绞盘箱、驾驶室（风挡、后视镜、顶舱盖）、排气管；鹅颈压在第五轮上
    ctx.strokeStyle = col; ctx.fillStyle = dark;
    ctx.beginPath(); gunRect(ctx, -.5, 9.8, -1.9, 1.9); ctx.fill(); ctx.stroke();
    ctx.beginPath(); gunRect(ctx, 9.6, 15, -2.35, 2.35); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = glass; ctx.lineWidth = px(1.5); ctx.beginPath(); ctx.moveTo(14.7, -2); ctx.lineTo(14.7, 2); ctx.stroke(); ctx.lineWidth = px(1.1);
    ctx.fillStyle = dim; ctx.beginPath(); gunRect(ctx, 13.6, 14.4, -2.35, -2.95); gunRect(ctx, 13.6, 14.4, 2.35, 2.95); gunRect(ctx, 5.8, 8.6, -1.9, -.7); ctx.fill();
    ctx.beginPath(); ctx.arc(9.15, 1.7, .55, 0, 7); ctx.fill();
    ctx.strokeStyle = dim; ctx.beginPath(); ctx.arc(12.1, -.9, .62, 0, 7); ctx.stroke();
    ctx.fillStyle = dark; ctx.strokeStyle = dim; ctx.beginPath(); gunRect(ctx, -.5, 4.4, -1.8, 1.8); ctx.fill(); ctx.stroke();
    // Mk 41 四联装发射箱：卧着 → 竖起（侧面 + 箱顶舱盖），先画地上的投影
    const pu = R0.piv, L = R0.L, T = R0.T, E1 = pu + L * cs, E0 = E1 - T * sn, S0 = pu - T * sn;
    if (sn > .02) { const h = L * sn + T * cs * .5, ut = E1 - T * sn * .5; ctx.fillStyle = `rgba(0,0,0,${.34 * sn})`; ctx.beginPath(); ctx.moveTo(pu, -2.2); ctx.lineTo(pu, 2.2); ctx.lineTo(ut + su * h, 2.2 + sv * h); ctx.lineTo(ut + su * h, -2.2 + sv * h); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = dark; ctx.strokeStyle = col;
    if (cs > .03) {
      ctx.beginPath(); gunRect(ctx, S0, E0, -2.2, 2.2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = dim; ctx.beginPath(); for (let j = 1; j < 6; j++) { const u = S0 + (E0 - S0) * j / 6; ctx.moveTo(u, -2.2); ctx.lineTo(u, 2.2); } ctx.moveTo(S0, 0); ctx.lineTo(E0, 0); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = px(1.6); ctx.beginPath(); ctx.moveTo(E0, -2.2); ctx.lineTo(E0, 2.2); ctx.stroke(); ctx.lineWidth = px(1.1);
    }
    if (sn > .03) {
      ctx.fillStyle = real ? rlGun().concrete : 'rgba(10,20,14,.95)'; ctx.strokeStyle = col; ctx.beginPath(); gunRect(ctx, E0, E1, -2.2, 2.2); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const w0 = i < 2 ? 0 : T / 2, ua = E1 - (w0 + T / 2) * sn + .18 * sn, ub = E1 - w0 * sn - .18 * sn, va = i % 2 ? .18 : -2.02, vb = i % 2 ? 2.02 : -.18;
        const tf = R0.up + i * AS.ty.every, dt = ft - tf, open = cur && dt > -.45 && dt < 1.4, used = (cur && dt >= 1.4) || spent;
        ctx.fillStyle = open ? '#000' : used ? 'rgba(0,0,0,.6)' : dark; ctx.strokeStyle = open ? col : dim;
        ctx.beginPath(); gunRect(ctx, ua, ub, va, vb); ctx.fill(); ctx.stroke();
        if (cur && vis && dt >= 0 && dt < .3) gunFlare(ctx, (ua + ub) / 2, (va + vb) / 2, 1 - dt / .3, 3.2);
      }
    }
    ctx.restore();
    if (cur && vis) for (let i = 0; i < 4; i++) {   // 燃气与地面冲击波
      const dt = ft - (R0.up + i * AS.ty.every), cu = pu - T * (i < 2 ? .25 : .75), cv = v0 + (i % 2 ? .25 : -.25) * T;
      gunPuff(ctx, cu, cv, dt, 6, 2.2, a);
      if (dt >= 0 && dt < 1.1) { ctx.strokeStyle = rgba(COL.smoke, .45 * (1 - dt / 1.1)); ctx.lineWidth = px(1.2); ctx.beginPath(); ctx.arc(cu, cv, 3 + dt * 16, 0, 7); ctx.stroke(); }
    }
  }
  ctx.restore();
  if (vis) gunCrew(ctx, x, y, a, [[-20, -11], [-19.5, -2.8, 'radio'], [-23, 10]], col);
}

// NMESIS 岸舰导弹排（车阵见 missile.js ASC_RIG）：2 辆 ROGUE-Fires 无人发射车（JLTV 底盘、没有驾驶室，车头只有传感器吊舱与摄像头杆）
//   各载 2 联装 NSM 发射箱，卧放时箱口朝车头；发射前转台转向目标、发射箱以尾部为轴仰起，箱口白光、车尾助推器燃气；
//   车阵后方一辆有人驾驶的 JLTV 遥控指挥车（风挡、车顶卫通天线罩）
function ascModel(ctx, e, x, y, a, vis, col, dim, dark, real) {
  const R0 = ASC_RIG, [su, sv] = gunSh(a), ft = e.fireT != null ? S.t - e.fireT : 99, glass = real ? 'rgba(150,190,210,.9)' : rgba(col, .9);
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.lineWidth = px(1.1);
  // 指挥车
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); gunRect(ctx, -19 + su * 2.4, -8.6 + su * 2.4, -2.4 + sv * 2.4, 2.4 + sv * 2.4); ctx.fill();
  ctx.fillStyle = dim; ctx.beginPath(); for (const u of [-10.8, -16.6]) for (const s of [-1, 1]) gunRect(ctx, u - 1.1, u + 1.1, s * 2.3, s * 3.1); ctx.fill();
  ctx.fillStyle = dark; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(-19, -2.4); ctx.lineTo(-9.4, -2.4); ctx.lineTo(-8.6, -1.6); ctx.lineTo(-8.6, 1.6); ctx.lineTo(-9.4, 2.4); ctx.lineTo(-19, 2.4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = dim; ctx.beginPath(); ctx.moveTo(-11.6, -2.4); ctx.lineTo(-11.6, 2.4); ctx.moveTo(-15.6, -2.4); ctx.lineTo(-15.6, 2.4); ctx.stroke();
  ctx.strokeStyle = glass; ctx.lineWidth = px(1.4); ctx.beginPath(); ctx.moveTo(-11.9, -2); ctx.lineTo(-11.9, 2); ctx.stroke(); ctx.lineWidth = px(1.1);
  ctx.strokeStyle = dim; ctx.beginPath(); ctx.arc(-13.8, 0, 1, 0, 7); ctx.stroke();
  for (let k = 0; k < R0.n; k++) {
    const v0 = (k - (R0.n - 1) / 2) * R0.gap, P = ascPose(e, k), cur = e.ascL === k && ft < R0.up + R0.hold + R0.down;
    ctx.save(); ctx.translate(0, v0);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); gunRect(ctx, -6.2 + su * 2, 6.2 + su * 2, -2.5 + sv * 2, 2.5 + sv * 2); ctx.fill();
    ctx.fillStyle = dim; ctx.beginPath(); for (const u of [4.3, -3.6]) for (const s of [-1, 1]) gunRect(ctx, u - 1.2, u + 1.2, s * 2.4, s * 3.3); ctx.fill();
    // 车体：倒角车头、发动机盖、格栅；没有驾驶室，只有传感器吊舱与摄像头杆
    ctx.fillStyle = dark; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(-6.2, -2.5); ctx.lineTo(5.4, -2.5); ctx.lineTo(6.2, -1.7); ctx.lineTo(6.2, 1.7); ctx.lineTo(5.4, 2.5); ctx.lineTo(-6.2, 2.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = dim; ctx.beginPath(); gunRect(ctx, 2.6, 5.8, -2.1, 2.1); for (let v = -1.4; v <= 1.4; v += .7) { ctx.moveTo(5.85, v); ctx.lineTo(6.15, v); } ctx.stroke();
    ctx.fillStyle = dim; ctx.beginPath(); gunRect(ctx, .5, 2.2, -1.2, 1.2); ctx.fill(); ctx.beginPath(); ctx.arc(2, 1.75, .5, 0, 7); ctx.fill();
    // 转台与 2 联装发射箱（仰起时投影变短、地上拖出影子）
    const cu = -3.4, l = R0.L * Math.cos(P.el), h = R0.L * Math.sin(P.el);
    ctx.strokeStyle = dim; ctx.beginPath(); ctx.arc(cu, 0, 1.9, 0, 7); ctx.stroke();
    ctx.save(); ctx.translate(cu, 0); ctx.rotate(P.tr); ctx.translate(R0.piv - cu, 0);
    if (h > .3) { ctx.fillStyle = `rgba(0,0,0,${.3 * Math.min(1, h / 4)})`; ctx.beginPath(); ctx.moveTo(0, -1.5); ctx.lineTo(0, 1.5); ctx.lineTo(l + su * h, 1.5 + sv * h); ctx.lineTo(l + su * h, -1.5 + sv * h); ctx.closePath(); ctx.fill(); }
    for (let i = 0; i < 2; i++) {
      const va = i ? .08 : -1.48, vb = i ? 1.48 : -.08, dt = ft - (R0.up + i * .7);
      ctx.fillStyle = dark; ctx.strokeStyle = col; ctx.beginPath(); gunRect(ctx, 0, l, va, vb); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = dim; ctx.beginPath(); for (const f of [.3, .62]) { ctx.moveTo(l * f, va); ctx.lineTo(l * f, vb); } ctx.stroke();
      ctx.strokeStyle = cur && dt >= 0 ? rgba(COL.smoke, .9) : col; ctx.lineWidth = px(1.6); ctx.beginPath(); ctx.moveTo(l, va); ctx.lineTo(l, vb); ctx.stroke(); ctx.lineWidth = px(1.1);
      if (cur && vis && dt >= 0 && dt < .3) { gunFlare(ctx, l, (va + vb) / 2, 1 - dt / .3, 2.6); gunFlare(ctx, -.6, (va + vb) / 2, (1 - dt / .3) * .7, 2); }
      if (cur && vis) { gunPuff(ctx, -1.5 - Math.max(0, dt) * 2, (va + vb) / 2, dt, 4, 1.8, 0); }
    }
    ctx.restore();
    ctx.restore();
  }
  ctx.restore();
  if (vis) gunCrew(ctx, x, y, a, [[-14, -5], [-15.5, 4.6, 'radio']], col);
}

// 被摧毁：焦黑弹坑、散落的掩体块、折断的炮管
function gunWreck(ctx, e, x, y, a) {
  const col = realLook() ? 'rgba(28,26,22,.75)' : rgba(COL.enemy, .35);
  ctx.setLineDash([]);
  const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
  g.addColorStop(0, 'rgba(0,0,0,.65)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = px(1.2);
  for (let i = 0; i < 6; i++) { const b = i * 1.05 + e.id, r = 8 + (i % 3) * 2; ctx.strokeRect(x + Math.cos(b) * r - 1.2, y + Math.sin(b) * r - 1, 2.4, 2); }
  if (e.kind !== 'bunker') {
    ctx.lineWidth = e.kind === 'coastal' ? 2.2 : 1.3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a + .5) * 9, y + Math.sin(a + .5) * 9); ctx.lineTo(x + Math.cos(a + .35) * 16, y + Math.sin(a + .35) * 16); ctx.stroke();
  }
}
