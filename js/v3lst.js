'use strict';
// 登陆舰艇的 3D 模型（程序建模）：Sketchfab 上没有能用的原创模型（同名的几个是从游戏《Cold Waters》扒的或别人转传的），照真舰外形自己搭——
//   072A 型坦克登陆舰（玉亭 II，LT）、072 型后勤登陆舰（玉坎，LS）、073A 型中型登陆舰（运输级，LM）、074A 型登陆舰（玉北，LI）、
//   火箭支援艇（LR）、火力支援艇（GS）、082Ⅱ 型扫雷舰（窝藏级，MS）。271 型登陆艇、726 气垫艇、人员登陆艇用 v3utex.js 的外部模型。
// 按真舰尺寸以米建模（V3L_DIM），画的时候按游戏里的长度整体缩放（v3units.js V3_SHIPL）；宽度比真舰放宽一成多——
//   游戏里车辆画得比舰艇大，照真宽画，坦克从艏门开出来比船还宽。
// 坐标：x 艏、y 右舷、z 上（米）；z = 0 是水线（实例放在 −2.6，与 v3mShip 一致），水线以下再画 2 米深红水线带（海面在 −3：低角度看不见船底和海面之间的缝）
// 真舰资料：072A 长 119.5 米、宽 16.4 米，艉部直升机平台（无机库），艏楼一座双联 37 毫米炮；073A 长 87 米、宽 12.6 米；
//   074A 长 58.4 米，艏部半双体、中间是跳板门；082Ⅱ 长 55 米、宽 9.3 米，双联 25 毫米炮，艉部吊车收放灭雷具
const V3L_DIM = { '072A': [119.5, 18.6], '072': [120, 17.4], '073A': [87, 14.4], '074A': [58.4, 12.6], rkt: [50, 10.6], gun: [38.8, 6.6], '082': [55, 10.4] };
const V3L_FUN = { '072A': [-.23, 21.2], '072': [-.43, 18.2], '073A': [-.4, 15.3], '074A': [-.43, 11.1], rkt: [-.43, 10.9], gun: [-.13, 7.1], '082': [-.03, 12.7] };   // 烟囱：位置（占全长的比例）、顶高（米）——热浪用
// 舰名前缀 → [型号, 3D 长度占游戏长度的比例]：073A 在游戏里和 072A 同一种船（lst，48 长），3D 里按真长短一截，艏端对齐二维画面（抢滩、卸车的位置不变）
const V3L_PRE = { LT: ['072A', 1], LS: ['072', 1], LM: ['073A', 87 / 119.5], LI: ['074A', 1], LR: ['rkt', 1], GS: ['gun', 1], MS: ['082', 1] };
const V3L_C = {
  hull: mbRGB('#8a9096'), boot: mbRGB('#4e2925'), deck: mbRGB('#535957'), deck2: mbRGB('#5f6563'), sup: mbRGB('#959ba1'), sup2: mbRGB('#8b9197'),
  win: -mbRGB('#1d242a'), black: mbRGB('#232526'), dark: mbRGB('#3a3e41'), gun: mbRGB('#7f858b'), steel: mbRGB('#4a4e51'), rail: mbRGB('#6d7276'),
  boat: mbRGB('#d2682d'), white: mbRGB('#e4e6e2'), yellow: mbRGB('#d9b437'), heli: mbRGB('#464c4c'), float: mbRGB('#e2661c'), olive: mbRGB('#5b6447')
};

// —— 船体 ——
// 站位 [x, 甲板半宽, 水线半宽, 甲板高]（艉 → 艏）。o：xs 艏部开始收窄处、tip 艏端面半宽占比、fine 尖艏（扫雷舰、炮艇；否则圆钝艏）、
//   fb 干舷、xf / df 艏楼台阶的位置与高、xt 方艉半宽占比、flare 水线半宽占比
function v3lStations(hl, hb, o) {
  const { xs, tip = .4, fine = false, fb, xf = 1e9, df = 0, xt = .95, flare = .93, n = 9, rake = 0 } = o;
  const f = t => fine ? Math.max(tip, 1 - t ** 1.7) : Math.max(tip, Math.sqrt(Math.max(0, 1 - t * t)));
  const hw = x => x <= xs ? hb : hb * f((x - xs) / (hl - xs));
  const wl = x => x <= xs ? hb * flare : hb * flare * Math.max(tip * .85, f(Math.min(1, (x - xs) / (hl - xs) * (fine ? 1.08 : 1.04))));
  const X = [-hl, -hl * .86, xs];
  for (let i = 1; i <= n; i++) X.push(xs + (hl - xs) * i / n);
  if (xf < hl && !X.includes(xf)) X.push(xf);
  X.sort((a, b) => a - b);
  const S = [], xw = x => x <= xs ? x : x - rake * ((x - xs) / (hl - xs)) ** 2;   // 艏柱前倾：水线处的站位比甲板边靠后（rake 米）
  for (const x of X) {
    const k = x === -hl ? xt : 1;
    if (x === xf) S.push([x, hw(x), wl(x), fb, xw(x)]);
    S.push([x, hw(x) * k, wl(x) * k, x >= xf ? fb + df : fb, xw(x)]);
  }
  return S;
}
// 侧板（甲板边 → 水线的直纹面）、水线带（水线 → zb，顺着艏柱的前倾往下延）、甲板、艏楼台阶的隔墙、方艉、艏端面
function v3lHull(M, S, deck = V3L_C.deck, zb = -2) {
  const C = V3L_C, xb = p => p[4] - (p[0] - p[4]) * -zb / p[3];   // 水线带下缘的 x
  for (let i = 0; i + 1 < S.length; i++) {
    const P0 = S[i], P1 = S[i + 1], [x0, b0, w0, z0, u0] = P0, [x1, b1, w1, z1, u1] = P1;
    if (x1 - x0 < 1e-6) { mbQuad(M, [x0, -b0, z0], [x0, b0, z0], [x0, b1, z1], [x0, -b1, z1], C.hull, [x0 + 5, 0, (z0 + z1) / 2]); continue; }   // 艏楼台阶
    const c = [(x0 + x1) / 2 - 3, 0, z0 / 2];
    for (const g of [1, -1]) {
      mbQuad(M, [x0, g * b0, z0], [x1, g * b1, z1], [u1, g * w1, 0], [u0, g * w0, 0], C.hull, c);
      mbQuad(M, [u0, g * w0, 0], [u1, g * w1, 0], [xb(P1), g * w1 * .96, zb], [xb(P0), g * w0 * .96, zb], C.boot, c);
    }
    mbQuad(M, [x0, -b0, z0], [x1, -b1, z1], [x1, b1, z1], [x0, b0, z0], deck, [(x0 + x1) / 2, 0, -50]);
  }
  for (const [P, d] of [[S[0], 1], [S[S.length - 1], -1]]) {
    const [x, b, w, z, u] = P, v = xb(P);
    mbQuad(M, [x, -b, z], [x, b, z], [u, w, 0], [u, -w, 0], C.hull, [x + d * 5, 0, z / 2]);
    mbQuad(M, [u, -w, 0], [u, w, 0], [v, w * .96, zb], [v, -w * .96, zb], C.boot, [x + d * 5, 0, 0]);
  }
}
// 栏杆：扶手 + 每 3 米一根立柱（线）
function v3lRail(M, P, z, h = 1) {
  const C = V3L_C;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
    mbLine(M, [a[0], a[1], z + h], [b[0], b[1], z + h], C.rail);
    for (let k = 0; k < n; k++) { const t = k / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; mbLine(M, [x, y, z], [x, y, z + h], C.rail); }
  }
}
// 甲板边一圈栏杆：两舷沿站位的甲板边（缩进 0.25 米），只拉 x 在 [xa, xb] 之间、甲板高是 z 的那几段
function v3lEdgeRail(M, S, xa, xb, z) {
  const P = S.filter(p => p[0] >= xa - 1e-6 && p[0] <= xb + 1e-6 && Math.abs(p[3] - z) < .01);
  if (P.length < 2) return;
  for (const g of [1, -1]) v3lRail(M, P.map(p => [p[0], g * (p[1] - .25)]), z);
}

// —— 上层建筑 ——
// 一层甲板室：箱体（墙略内倾）+ 前墙、两侧一排方窗（窗是负明暗：写实画面泛天光，黑绿画面发光）
function v3lLevel(M, x0, x1, hy, z0, z1, o = {}) {
  const C = V3L_C, h = z1 - z0;
  mbBox(M, x0, x1, -hy, hy, z0, z1, o.c || C.sup, { taper: o.taper ?? .1 });
  if (o.win === false) return;
  const zc = z0 + h * .6, wh = Math.min(.5, h * .17), sp = o.sp || 2.4;
  if (o.band) {   // 驾驶室：一圈连续的大窗
    mbBox(M, x1 - .03, x1 + .05, -hy + .5, hy - .5, zc - wh * 1.3, zc + wh * 1.3, C.win);
    for (const g of [1, -1]) mbBox(M, x0 + .6, x1 - .4, g > 0 ? hy - .06 : -hy - .02, g > 0 ? hy + .02 : -hy + .06, zc - wh * 1.2, zc + wh * 1.2, C.win);
    return;
  }
  const nf = Math.max(1, Math.floor((2 * hy - 2) / sp) + 1), ns = Math.max(1, Math.floor((x1 - x0 - 2.4) / sp) + 1), xc = (x0 + x1) / 2;   // 窗按墙面居中排
  for (let i = 0; i < nf; i++) { const y = (i - (nf - 1) / 2) * sp; mbBox(M, x1 - .03, x1 + .05, y - .35, y + .35, zc - wh, zc + wh, C.win); }
  for (let i = 0; i < ns; i++) { const x = xc + (i - (ns - 1) / 2) * sp; for (const g of [1, -1]) mbBox(M, x - .3, x + .3, g > 0 ? hy - .06 : -hy - .02, g > 0 ? hy + .02 : -hy + .06, zc - wh * .8, zc + wh * .8, C.win); }
}
// 驾驶室两侧的翼台：挑出去的平台 + 栏杆
function v3lWings(M, x0, x1, hy, wy, z) {
  for (const g of [1, -1]) {
    mbBox(M, x0, x1, g > 0 ? hy - .2 : -wy, g > 0 ? wy : -hy + .2, z - .25, z, V3L_C.sup2);
    v3lRail(M, [[x0, g * hy], [x0, g * wy], [x1, g * wy], [x1, g * hy]], z, 1.05);
  }
}
// 桅杆：主杆（下粗上细）+ 平台 + 两层横桁 + 顶上对海搜索雷达（长条天线）与导航雷达
function v3lMast(M, x, z0, h, k = 1) {
  const C = V3L_C;
  mbTube(M, [x, 0, z0], [x, 0, z0 + h], .45 * k, .22 * k, 8, C.sup);
  mbBox(M, x - 1.1 * k, x + 1.1 * k, -1.1 * k, 1.1 * k, z0 + h * .52, z0 + h * .52 + .2, C.sup2);
  for (const [f, w] of [[.62, 3.4], [.82, 2.4]]) mbTube(M, [x, -w * k, z0 + h * f], [x, w * k, z0 + h * f], .07, .07, 4, C.steel);
  mbBox(M, x - .35 * k, x + .35 * k, -2.6 * k, 2.6 * k, z0 + h, z0 + h + .45 * k, C.dark);   // 对海搜索雷达
  mbBox(M, x + .8 * k, x + 1.4 * k, -1 * k, 1 * k, z0 + h * .7, z0 + h * .7 + .3 * k, C.dark);   // 导航雷达
  mbTube(M, [x, 0, z0 + h + .45 * k], [x, 0, z0 + h + 2.4 * k], .06, .04, 4, C.steel);   // 顶上的鞭状天线
  for (const g of [1, -1]) mbLine(M, [x, g * 3.2 * k, z0 + h * .62], [x - 9 * k, g * 1.5 * k, z0 + .5], C.rail);   // 信号旗绳
}
// 烟囱：带收分的柱体 + 黑色烟囱帽；r 半宽，l 半长
function v3lFunnel(M, x, y, l, r, z0, z1, round) {
  const C = V3L_C, P = round ? mbCirc(x, y, r, 12).map(([a, b]) => [x + (a - x) * l / r, b]) : [[x - l, y - r * .8], [x + l * .9, y - r], [x + l, y], [x + l * .9, y + r], [x - l, y + r * .8]];
  mbPrism(M, P, z0, z1, C.sup2, { taper: Math.min(l, r) * .12 });
  const Q = round ? mbCirc(x, y, r * .86, 12).map(([a, b]) => [x + (a - x) * l / r, b]) : P.map(([a, b]) => [x + (a - x) * .86, y + (b - y) * .86]);
  mbPrism(M, Q, z1, z1 + .7, C.black);
}

// —— 武器、设备 ——
// 双联（nb 管）舰炮：炮座 + 带收分的炮塔（防盾）+ 炮管；w 炮塔宽、bl 炮管长、dir 朝艏 1 / 朝艉 −1
function v3lGun(M, x, y, z, w, bl, nb = 2, dir = 1) {
  const C = V3L_C, h = w * .55;
  mbPrism(M, mbCirc(x, y, w * .55, 10), z, z + h * .35, C.gun);
  mbBox(M, x - w * .55 * dir, x + w * .45 * dir, y - w * .5, y + w * .5, z + h * .35, z + h * 1.25, C.gun, { taper: w * .1 });
  for (let i = 0; i < nb; i++) { const o = nb === 1 ? 0 : (i / (nb - 1) - .5) * w * .5; mbTube(M, [x + w * .4 * dir, y + o, z + h * .85], [x + (w * .4 + bl) * dir, y + o, z + h * .92], w * .055, w * .045, 6, C.steel); }
}
// 救生艇 / 登陆小艇挂在吊艇架上：艇身（尖艏）+ 小舱室 + 两根弯吊臂
function v3lBoat(M, x, y, z, L = 8, hw = 1.3) {
  const C = V3L_C, g = Math.sign(y) || 1;
  mbPrism(M, [[x - L / 2, y - hw * .85], [x + L * .3, y - hw], [x + L / 2, y], [x + L * .3, y + hw], [x - L / 2, y + hw * .85]], z, z + 1.1, C.boat, { taper: .35 });
  mbBox(M, x - L * .2, x + L * .1, y - hw * .55, y + hw * .55, z + 1.1, z + 1.8, C.white);
  for (const o of [-L * .32, L * .32]) mbTube(M, [x + o, y - g * hw * 1.2, z - .6], [x + o, y, z + 2.6], .09, .07, 4, C.steel, false);
}
// 吊车：底座 + 司机室 + 斜吊臂 + 吊索
function v3lCrane(M, x, y, z, h, jx, jy, jz) {
  const C = V3L_C;
  mbTube(M, [x, y, z], [x, y, z + h], .7, .55, 8, C.sup2);
  mbBox(M, x - 1, x + 1, y - .9, y + .9, z + h, z + h + 1.6, C.yellow);
  mbTube(M, [x, y, z + h + 1], [jx, jy, jz], .32, .18, 6, C.yellow);
  mbLine(M, [jx, jy, jz], [jx, jy, jz - 4], C.steel);
}
// 舱口盖：微微凸起的大盖板 + 分块缝
function v3lHatch(M, x0, x1, hy, z, n) {
  const C = V3L_C;
  mbBox(M, x0, x1, -hy, hy, z, z + .35, C.deck2);
  for (let i = 1; i < n; i++) { const x = x0 + (x1 - x0) * i / n; mbLine(M, [x, -hy, z + .37], [x, hy, z + .37], C.dark); }
  mbLine(M, [x0, 0, z + .37], [x1, 0, z + .37], C.dark);
}
// 锚：锚链孔（黑）+ 收在孔里的锚
function v3lAnchor(M, x, hy, z) {
  for (const g of [1, -1]) { mbBox(M, x - .7, x + .7, g * hy - .2, g * hy + .2, z - .7, z + .7, V3L_C.black); mbBox(M, x - .4, x + .4, g * hy - .35, g * hy + .35, z - 1.7, z - .3, V3L_C.steel); }
}
// 艏门：中缝 + 两扇门的门框线（072 系列的蚌壳式艏门）
function v3lBowDoor(M, P, k = .9) {
  const C = V3L_C, [x, b, w, z, u] = P, at = (f, g) => { const t = f / z; return [u + (x - u) * t + .06, g * (w + (b - w) * t) * k, f]; };   // 艏端面上高 f 处、左右 g 的点（沿前倾的端面）
  mbLine(M, at(.5, 0), at(z - .3, 0), C.dark);
  for (const g of [1, -1]) { mbLine(M, at(.5, g), at(z - .3, g), C.dark); mbLine(M, at(.5, g), at(.5, 0), C.dark); mbLine(M, at(z - .3, g), at(z - .3, 0), C.dark); }
}
// 直升机平台：抬高一点的平台 + 白边线、着舰圈、中线、H 字 + 两舷安全网
function v3lHelipad(M, x0, x1, hy, z, r) {
  const C = V3L_C, c = (x0 + x1) / 2, zt = z + .45;
  mbBox(M, x0, x1, -hy, hy, z, zt, C.heli);
  mbLoop(M, [[x0 + .4, -hy + .4], [x1 - .4, -hy + .4], [x1 - .4, hy - .4], [x0 + .4, hy - .4]], zt + .02, C.white);
  mbLoop(M, mbCirc(c, 0, r, 28), zt + .02, C.yellow);
  mbLine(M, [x0 + .5, 0, zt + .02], [x1 - .5, 0, zt + .02], C.white);
  const a = r * .38;
  for (const g of [1, -1]) mbLine(M, [c - a * .9, g * a * .6, zt + .03], [c + a * .9, g * a * .6, zt + .03], C.white);
  mbLine(M, [c, -a * .6, zt + .03], [c, a * .6, zt + .03], C.white);
  for (const g of [1, -1]) { mbLine(M, [x0, g * (hy + 1.2), zt - .1], [x1, g * (hy + 1.2), zt - .1], C.rail); mbLine(M, [x0, g * hy, zt], [x0, g * (hy + 1.2), zt - .1], C.rail); mbLine(M, [x1, g * hy, zt], [x1, g * (hy + 1.2), zt - .1], C.rail); }
}
// 122 毫米 40 管火箭炮（4 排 × 10 列）：转盘 + 托架 + 斜起的发射箱，管口一格格
function v3lRocket(M, x, y, z, el = .45) {
  const C = V3L_C, c = Math.cos(el), s = Math.sin(el), L = 3.2, Ht = 1.25, hw = 1.25, px = x - .4, pz = z + 1.3;
  mbPrism(M, mbCirc(x, y, 1.3, 10), z, z + .5, C.olive);
  mbBox(M, x - 1, x + .6, y - .9, y + .9, z + .5, z + 1.3, C.olive);
  const p = (u, v) => [px + c * u - s * v, pz + s * u + c * v], P = [p(-1, 0), p(L - 1, 0), p(L - 1, Ht), p(-1, Ht)];
  mbSide(M, P, y - hw, y + hw, C.olive);
  const [ax, az] = P[1], [bx, bz] = P[2], o = .03;
  for (let i = 1; i < 4; i++) { const t = i / 4; mbLine(M, [ax + (bx - ax) * t + c * o, y - hw, az + (bz - az) * t + s * o], [ax + (bx - ax) * t + c * o, y + hw, az + (bz - az) * t + s * o], C.black); }
  for (let j = 1; j < 10; j++) { const yy = y - hw + 2 * hw * j / 10; mbLine(M, [ax + c * o, yy, az + s * o], [bx + c * o, yy, bz + s * o], C.black); }
}

// —— 各型舰 ——
function v3mLST(v) {
  const M = mbNew(), C = V3L_C, [L, B] = V3L_DIM[v] || V3L_DIM['072A'], hl = L / 2, hb = B / 2;
  if (v === '072A' || v === '072' || v === '073A') {
    // 坦克登陆舰：方艉 → 平行中体 → 圆钝舰首（蚌壳式艏门，舰内跳板从这里放下）；艏楼抬高一级
    const big = v !== '073A', fb = big ? 6 : 5, df = big ? 2.6 : 2.2, xf = hl * (v === '072' ? .66 : .63), S = v3lStations(hl, hb, { xs: hl * .46, tip: .36, fb, xf, df, rake: big ? 3.2 : 2.6, n: 12 });
    v3lHull(M, S);
    const zf = fb + df;
    v3lBowDoor(M, S[S.length - 1]);
    v3lAnchor(M, hl * .9, S[S.length - 3][1] - .05, fb - 1);
    v3lEdgeRail(M, S, xf, hl, zf); v3lEdgeRail(M, S, -hl, xf, fb);
    if (v === '072') { v3lGun(M, hl * .8, 0, zf, 3, 3.6); mbPrism(M, mbCirc(hl * .71, 0, 2, 10), zf, zf + 1.4, C.sup2); v3lGun(M, hl * .71, 0, zf + 1.4, 3, 3.6); }   // 玉坎：两座双联 57 毫米炮（后一座在抬高的炮座上）
    else v3lGun(M, hl * .8, 0, zf, 2.4, 3);   // 双联 37 毫米炮
    if (v === '072A') {
      // 玉亭 II：舯后部四层上层建筑，前面坦克甲板上大舱口与右舷吊车，艉部直升机平台
      const a0 = -36, a1 = -6;
      v3lHatch(M, 4, xf - 6, hb * .45, fb, 6);
      v3lLevel(M, a0, a1, hb - 1.2, fb, fb + 2.7);
      v3lLevel(M, a0 + 2, a1 - 1.5, hb - 2, fb + 2.7, fb + 5.4);
      v3lLevel(M, a0 + 9, a1 - 2.5, hb - 3, fb + 5.4, fb + 8.1);
      v3lLevel(M, -19, a1 - 3, hb - 3.4, fb + 8.1, fb + 10.9, { band: true });
      v3lWings(M, -12, a1 - 3, hb - 3.4, hb - .6, fb + 8.1);
      v3lMast(M, -15, fb + 10.9, 9);
      v3lFunnel(M, L * V3L_FUN[v][0], 0, 3.6, 2.4, fb + 5.4, fb + 14.5);
      for (const x of [-15, -28]) for (const g of [1, -1]) v3lBoat(M, x, g * (hb + .4), fb + 3.2, 8.5, 1.4);
      v3lCrane(M, a1 + 3, hb * .55, fb, 3.4, a1 + 14, hb * .25, fb + 9);
      v3lHelipad(M, -hl + .4, a0 - .5, hb - .6, fb, 7);
    } else if (v === '072') {
      // 玉坎：上层建筑在艉部，舯部两组起货吊杆柱（吊杆斜搁着）、大舱口
      const a0 = -hl + 1, a1 = -36;
      v3lHatch(M, -26, xf - 10, hb * .42, fb, 8);
      v3lLevel(M, a0, a1, hb - 1, fb, fb + 2.7);
      v3lLevel(M, a0 + 2, a1 - 1.5, hb - 1.8, fb + 2.7, fb + 5.4);
      v3lLevel(M, a0 + 12, a1 - 2, hb - 2.8, fb + 5.4, fb + 8.2, { band: true });
      v3lWings(M, a1 - 6, a1 - 2, hb - 2.8, hb - .5, fb + 5.4);
      v3lMast(M, a1 - 6, fb + 8.2, 8);
      v3lFunnel(M, L * V3L_FUN[v][0], 0, 2.6, 2.6, fb + 5.4, fb + 11.5, true);
      for (const x of [a0 + 6, a1 - 6]) for (const g of [1, -1]) v3lBoat(M, x, g * (hb + .4), fb + 3.2, 7.5, 1.3);
      for (const [x, d] of [[-28.5, 1], [31.5, -1]]) {   // 舱口两头各一根吊杆柱，吊杆斜伸向舱口
        mbTube(M, [x, 0, fb], [x, 0, fb + 11], .55, .4, 8, C.sup2);
        mbTube(M, [x, -2.6, fb + 10.4], [x, 2.6, fb + 10.4], .2, .2, 5, C.sup2);
        for (const g of [1, -1]) { mbTube(M, [x + .8 * d, g * 2.2, fb + 1.4], [x + 11 * d, g * 1.4, fb + 7.5], .22, .14, 5, C.steel); mbLine(M, [x, g * 2.4, fb + 10.4], [x + 11 * d, g * 1.4, fb + 7.5], C.steel); }
      }
    } else {
      // 运输级：上层建筑在艉部三层，甲板上一台吊车，上层建筑顶上第二座双联 37 毫米炮
      const a0 = -hl + .8, a1 = -24;
      v3lHatch(M, -18, xf - 6, hb * .42, fb, 6);
      v3lLevel(M, a0, a1, hb - 1, fb, fb + 2.5);
      v3lLevel(M, a0 + 1.5, a1 - 1.5, hb - 1.8, fb + 2.5, fb + 5);
      v3lLevel(M, a0 + 9, a1 - 2, hb - 2.6, fb + 5, fb + 7.6, { band: true });
      v3lWings(M, a1 - 5, a1 - 2, hb - 2.6, hb - .5, fb + 5);
      v3lMast(M, a1 - 6, fb + 7.6, 7, .85);
      v3lFunnel(M, L * V3L_FUN[v][0], 0, 2.6, 1.9, fb + 5, fb + 9.6);
      v3lGun(M, a0 + 3, 0, fb + 5, 2.4, 3, 2, -1);
      for (const g of [1, -1]) v3lBoat(M, a0 + 12, g * (hb + .3), fb + 2.8, 7, 1.2);
      v3lCrane(M, a1 + 3, -hb * .55, fb, 3, a1 + 13, -hb * .2, fb + 7.5);
    }
  } else if (v === '074A' || v === 'rkt') {
    // 074A：艏部半双体、中间一块跳板门（竖起时就是艏门），通长的车辆甲板两舷是高舷墙，驾驶室在艉部；火箭支援艇同一类艇体，车辆甲板上装三座火箭炮
    const rk = v === 'rkt', fb = rk ? 2.8 : 3, S = v3lStations(hl, hb, { xs: hl * .78, tip: .82, fb, xt: .97, rake: 1.6 });
    v3lHull(M, S);
    const wh = 2.6, wt = 1.3, x0 = rk ? -hl * .44 : -hl * .5, bw = S[S.length - 1][1];
    for (const g of [1, -1]) {   // 两舷舷墙一直伸到艏端（两个艏柱），中间是跳板
      const P = S.filter(p => p[0] >= x0).map(p => [p[0], g * p[1]]), Q = P.slice().reverse().map(([x, y]) => [x, y - g * wt]);
      mbPrism(M, g > 0 ? P.concat(Q).reverse() : P.concat(Q), fb, fb + wh, C.hull);
    }
    const rw = bw - wt;   // 跳板：铰链在甲板前沿，竖起来略向前倾
    mbSide(M, [[hl - 1.4, fb], [hl - .2, fb + wh + .4], [hl - .6, fb + wh + .5], [hl - 1.8, fb + .1]], -rw, rw, C.deck2);
    for (let i = 1; i < 6; i++) { const t = i / 6; mbLine(M, [hl - 1.4 + 1.2 * t + .05, -rw, fb + (wh + .4) * t], [hl - 1.4 + 1.2 * t + .05, rw, fb + (wh + .4) * t], C.dark); }
    for (let x = x0 + 2; x < hl - 2.5; x += 2.2) mbLine(M, [x, -(hb - wt), fb + .02], [x, hb - wt, fb + .02], C.dark);   // 车辆甲板防滑条
    const a0 = -hl + .6, a1 = x0;
    v3lLevel(M, a0, a1, hb - .6, fb, fb + 2.6);
    v3lLevel(M, a0 + 1.5, a1 - 2.4, hb - 1.4, fb + 2.6, fb + 5.2);
    v3lLevel(M, a0 + 6, a1 - 3, hb - 2.2, fb + 5.2, fb + 7.8, { band: true });
    v3lWings(M, a1 - 5.5, a1 - 3, hb - 2.2, hb - .4, fb + 5.2);
    v3lMast(M, a1 - 6.5, fb + 7.8, 5.5, .7);
    const fx = L * V3L_FUN[v][0];
    for (const g of [1, -1]) v3lFunnel(M, fx, g * 2.6, 1.3, .9, fb + 5.2, fb + 7.4, true);
    if (rk) for (const x of [-hl * .22, hl * .08, hl * .38]) v3lRocket(M, x, 0, fb);
    else for (const g of [1, -1]) v3lGun(M, a1 - 1.2, g * (hb - 2), fb + 2.6, 1.6, 2.1);   // 两座双联 25 毫米炮（上层建筑前面一层的顶上）
  } else if (v === 'gun') {
    // 火力支援艇（照 062 型护卫艇的布局）：尖艏、舯部驾驶室、前后两座炮（前 40 毫米，后双联 25 毫米）
    const fb = 2.2, S = v3lStations(hl, hb, { xs: -hl * .05, tip: .03, fine: true, fb, xf: hl * .1, df: .6, xt: .9, rake: 2.4 });
    v3lHull(M, S);
    v3lEdgeRail(M, S, -hl, hl * .1, fb); v3lEdgeRail(M, S, hl * .1, hl * .85, fb + .6);
    v3lLevel(M, -7, 4, hb - .7, fb, fb + 2.2);
    v3lLevel(M, -2, 3.4, hb - 1.2, fb + 2.2, fb + 4.2, { band: true });
    v3lMast(M, -1.5, fb + 4.2, 4.5, .55);
    v3lFunnel(M, L * V3L_FUN[v][0], 0, 1, .7, fb + 2.2, fb + 4.2);
    v3lGun(M, hl * .45, 0, fb + .6, 1.8, 3.2, 1);
    v3lGun(M, -hl * .55, 0, fb, 1.5, 2, 2, -1);
  } else {
    // 082Ⅱ 扫雷舰：尖艏、长艏楼上的上层建筑（驾驶室在前、烟囱在后）、桅杆；艉部低矮的作业甲板：电缆绞车、两个橘色拖曳浮体、灭雷具、艉吊车与 A 字架
    const fb = 3.2, df = 2.4, xf = -hl * .16, S = v3lStations(hl, hb, { xs: -hl * .02, tip: .03, fine: true, fb, xf, df, xt: .92, rake: 3.6 });
    v3lHull(M, S);
    const zf = fb + df;
    v3lEdgeRail(M, S, xf, hl * .9, zf); v3lEdgeRail(M, S, -hl, xf, fb);
    v3lLevel(M, xf, 11, hb - .8, zf, zf + 2.6);
    v3lLevel(M, 4.5, 10.6, hb - 1.4, zf + 2.6, zf + 5.2, { band: true });
    v3lWings(M, 8, 10.6, hb - 1.4, hb - .3, zf + 2.6);
    v3lMast(M, 6.5, zf + 5.2, 7, .7);
    v3lFunnel(M, L * V3L_FUN['082'][0], 0, 1.8, 1.2, zf + 2.6, zf + 6.4);
    v3lGun(M, 17.5, 0, zf, 1.7, 2.2);   // 双联 25 毫米炮
    for (const g of [1, -1]) v3lBoat(M, -1, g * (hb + .3), zf + 1.6, 5.5, 1);
    for (const x of [-10, -15]) {   // 电缆绞车：卷筒横放在支架上
      mbTube(M, [x, -1.4, fb + 1.3], [x, 1.4, fb + 1.3], 1.05, 1.05, 10, C.dark);
      for (const g of [1, -1]) mbBox(M, x - .5, x + .5, g * 1.55 - .12, g * 1.55 + .12, fb, fb + 1.6, C.sup2);
    }
    for (const g of [1, -1]) { mbTube(M, [-21.5, g * 3.3, fb + .55], [-18.5, g * 3.3, fb + .55], .5, .45, 8, C.float); mbTube(M, [-18.5, g * 3.3, fb + .55], [-18, g * 3.3, fb + .55], .45, .12, 8, C.float); }
    mbBox(M, -7.4, -5.6, 1.6, 3.2, fb, fb + 1, C.yellow); mbDome(M, -6.5, 2.4, .7, .6, fb + 1, .4, C.yellow, 8, 2);   // 灭雷具
    v3lCrane(M, -23, -3, fb, 2.2, -27.5, -1.8, fb + 6);
    for (const g of [1, -1]) mbTube(M, [-26.6, g * 3.6, fb], [-25.8, g * 3, fb + 5.6], .25, .2, 6, C.yellow);   // 艉 A 字架
    mbTube(M, [-25.8, -3.2, fb + 5.6], [-25.8, 3.2, fb + 5.6], .25, .25, 6, C.yellow);
  }
  return M;
}
