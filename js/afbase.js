'use strict';
// 空军基地（守方野战机场 / 我方夺取后的机场）：版图、精细绘制、3D 建筑块
// 场区沿用 AF_BOX × AF_K（约 1100 × 800，地图生成时预留并清成平地）；设施按真实比例（1 单位约 1 米）布置，不整体放大：
//   跑道 920 × 30（道肩、防吹坪人字标、入口斑马线、跑道号、接地区与瞄准点、中线、边线、拦阻索、PAPI、进近灯、航向台、下滑台、风向袋）；
//   平行滑行道与两端联络道、中间联络道、两条快速出口；两个加固机库群（各 8 座 TAB-VEE 机堡，鱼骨式滑行道）、两端待命 / 挂弹坪、罗盘校正坪；
//   主停机线两排 24 个机位、三座维修机库与中队楼；直升机停机坪 10 个位、起降坪、直升机库；塔台、航务楼、消防站与消防车；
//   发动机试车库、试车坪、地面设备场；弹药库区（8 座覆土弹药库、独立围栏）；油库（4 个大油罐、防火堤、发油台、加油车）；
//   营区（指挥部、宿舍、食堂、体育场、健身房、服务社、诊所、礼拜堂、停车场、行道树）、机动车场、仓库、土木工程场、电站、水塔、净水池；
//   爱国者导弹排阵地、M-SHORAD 与陆基密集阵掩体、火神高炮沙袋掩体、守备队工事、雷达站；双层围栏、岗楼、正门与巡逻道
// 局部坐标 (u, v) 与世界同一尺度（eaW / eaL）：u 沿跑道，v 垂直跑道、指向营区一侧（v < 0 为跑道外侧，选址时朝海）
// 画法：同一材质的图形合成一个 Path2D，按机场朝向缓存（投影、屋顶明暗随朝向变）；每帧整批填充 / 描边。
//   远看只画草地、道路、道面与建筑块（带投影）；近看加标线、树、车辆、土堤、围栏；再近加灯光、跑道号、拦阻索、标牌、道面接缝

// —— 版图 ——
const EA_RW = { hl: 460, hw: 15, cap: 50 };   // 跑道半长、半宽；每座机场的机位数
const AFB_SP = [-315, 380];   // 两个加固机库群的鱼骨式滑行道（u）
// 加固机库（机堡 30 × 24）：每群两侧各 4 座、交错排列，门朝滑行道（a：门的朝向）
const AFB_HAS = AFB_SP.flatMap(su => [[140, 0], [200, 0], [260, 0], [320, 0], [170, 1], [230, 1], [290, 1], [350, 1]].map(([v, e]) => ({ su, u: e ? su + 31 : su - 31, v, a: e ? Math.PI : 0 })));
// 机位 [u, v, 机头朝向, 类型]：机堡 16 个（两个机库群交替排序；飞机前半截伸出门外）· 主停机线两排 24 个（机头朝滑行道，从中间往两边排）· 直升机停机位 10 个
const EA_STAND = [
  ...AFB_HAS.map((h, i) => [h, i]).sort((a, b) => a[1] % 8 - b[1] % 8 || a[1] - b[1]).map(([h]) => [h.u + (h.a ? -17 : 17), h.v, h.a, 'has']),
  ...[120, 196].flatMap(v => Array.from({ length: 12 }, (_, k) => [-155 + 30 * k, v, -Math.PI / 2, 'line']).sort((a, b) => Math.abs(a[0] - 10) - Math.abs(b[0] - 10))),
  ...[112, 160].flatMap(v => Array.from({ length: 5 }, (_, k) => [212 + 26 * k, v, -Math.PI / 2, 'heli']))
];
const EA_PAD = [290, 221];   // 直升机起降坪
// 判断机场是否被看见的采样点：跑道与各设施区
const EA_EYE = [[-420, 0], [-210, 0], [0, 0], [210, 0], [420, 0], [-315, 220], [380, 220], [0, 150], [-215, 130], [262, 150], [0, 256], [-460, 330],
  [-300, 520], [-100, 400], [80, 450], [270, 536], [445, 480], [485, 290]];
// 设施范围 [u0, u1, v0, v1]（eaFacDist）：跑道、滑行道、停机坪与机库、直升机区、两个机库群、待命坪、塔台消防站、试车区、油库、弹药库
const AFB_FAC = [[-490, 490, -20, 20], [-458, 458, 15, 86], [-170, 190, 84, 280], [196, 330, 84, 244], [-376, -254, 128, 375], [334, 446, 128, 375],
  [-476, -424, 86, 116], [424, 506, 86, 230], [-237, -193, 86, 172], [212, 328, 460, 594], [-532, -388, 202, 470]];

// —— 几何 ——
const AFB_GEO = new Map();
function afbGeo(h = 0, s = 1) {
  const key = h.toFixed(4) + '|' + s;
  let G = AFB_GEO.get(key);
  if (!G) AFB_GEO.set(key, G = afbBuild(h, s));
  return G;
}
function afbHull(pts) {   // 凸包（单调链）
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), lo = [], up = [];
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// 按机场朝向 (h, s) 建一套图形：G[材质] = Path2D；G.TW / G.TL 滑行道中线（按宽度描成道面）；G.blocks 3D 建筑块
function afbBuild(h, s) {
  const c = Math.cos(h), n = Math.sin(h), G = { blocks: [] };
  const dirL = (x, y) => [x * c + y * n, (-x * n + y * c) * s];   // 世界方向 → 局部方向
  const LT = dirL(-Math.SQRT1_2, -Math.SQRT1_2), SH = dirL(.3, .3);   // 光从西北来；每单位高度向东南投影 0.3
  const P = k => G[k] || (G[k] = new Path2D());
  let sd = 90173;
  const rnd = () => (sd = sd * 16807 % 2147483647) / 2147483647;
  const poly = (k, pts) => { const p = P(k); p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); p.closePath(); };
  const rect = (k, u0, v0, u1, v1) => P(k).rect(Math.min(u0, u1), Math.min(v0, v1), Math.abs(u1 - u0), Math.abs(v1 - v0));
  const circ = (k, u, v, r) => { const p = P(k); p.moveTo(u + r, v); p.arc(u, v, r, 0, 2 * Math.PI); };
  const line = (k, ...q) => { const p = P(k); p.moveTo(q[0], q[1]); for (let i = 2; i < q.length; i += 2) p.lineTo(q[i], q[i + 1]); };
  const ngon = (u, v, r, m = 16) => Array.from({ length: m }, (_, i) => [u + Math.cos(i / m * 2 * Math.PI) * r, v + Math.sin(i / m * 2 * Math.PI) * r]);
  const shade = (k, pts, z) => poly(k, afbHull(pts.concat(pts.map(([x, y]) => [x + SH[0] * z, y + SH[1] * z]))));
  const obs = [];   // 营区里已占用的范围（种树时避开）
  const take = (u0, v0, u1, v1) => obs.push([Math.min(u0, u1) - 2, Math.min(v0, v1) - 2, Math.max(u0, u1) + 2, Math.max(v0, v1) + 2]);
  const free = (u, v, r) => !obs.some(o => u + r > o[0] && u - r < o[2] && v + r > o[1] && v - r < o[3]);
  // 房屋 / 构筑物：中心 (u, v)、沿 a 方向长 L、横向宽 W、高 z、材质 m；屋顶 r：flat 平顶（女儿墙亮边）· gable 坡顶 · arch 拱顶（两侧明暗、中间中间调）· has 机堡（拱轴沿 a）
  // 返回房屋坐标（x 沿 a、y 横向）→ 局部坐标的换算，方便加门、墙等细节
  const bld = (u, v, L, W, a, z, m, r, z0 = 0) => {
    const ca = Math.cos(a), sa = Math.sin(a), l = L / 2, w = W / 2;
    const Q = (x, y) => [u + x * ca - y * sa, v + x * sa + y * ca];
    const R4 = (x0, y0, x1, y1) => [Q(x0, y0), Q(x1, y0), Q(x1, y1), Q(x0, y1)];
    const pts = R4(-l, -w, l, w);
    shade('shade', pts, z); poly('foot', pts); G.blocks.push({ pts, z, z0, m, r });   // m、r：3D 里按材质、屋顶类型换模型（v3props.js）
    take(Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1])));
    if (r === 'flat') {
      const i1 = Math.min(.9, l * .2, w * .2);
      poly('F0' + m, pts); poly('F1' + m, R4(-l + i1, -w + i1, l - i1, w - i1)); poly('F2' + m, R4(-l + 2 * i1, -w + 2 * i1, l - 2 * i1, w - 2 * i1));
      return Q;
    }
    const ax = r === 'has' || l >= w, arch = r !== 'gable', k = arch ? .3 : 0;
    const tone = (nx, ny) => nx * LT[0] + ny * LT[1] > 0 ? 'L' : 'D';   // 坡面外法线朝光：亮
    if (ax) {
      poly(tone(sa, -ca) + m, R4(-l, -w, l, -w * k)); poly(tone(-sa, ca) + m, R4(-l, w * k, l, w));
      if (arch) poly('M' + m, R4(-l, -w * k, l, w * k)); else line('ridge', ...Q(-l, 0), ...Q(l, 0));
      if (m === 'metal') for (let x = -l + 2.4; x < l - 1; x += 2.4) line('corr', ...Q(x, -w), ...Q(x, w));
    } else {
      poly(tone(-ca, -sa) + m, R4(-l, -w, -l * k, w)); poly(tone(ca, sa) + m, R4(l * k, -w, l, w));
      if (arch) poly('M' + m, R4(-l * k, -w, l * k, w)); else line('ridge', ...Q(0, -w), ...Q(0, w));
      if (m === 'metal') for (let y = -w + 2.4; y < w - 1; y += 2.4) line('corr', ...Q(-l, y), ...Q(l, y));
    }
    return Q;
  };
  // 车辆：宽 w、长 l、车头朝 a（车头一段画成驾驶室）
  const veh = (k, u, v, w, l, a) => {
    const ca = Math.cos(a), sa = Math.sin(a), Q = (x, y) => [u + x * ca - y * sa, v + x * sa + y * ca];
    const pts = [Q(-l / 2, -w / 2), Q(l / 2, -w / 2), Q(l / 2, w / 2), Q(-l / 2, w / 2)];
    shade('vshade', pts, 2.4); poly(k, pts);
    poly('cabs', [Q(l * .22, -w / 2 + .25), Q(l / 2 - .2, -w / 2 + .25), Q(l / 2 - .2, w / 2 - .25), Q(l * .22, w / 2 - .25)]);
  };
  const car = () => ['car1', 'car2', 'car3', 'car4'][(rnd() * 4) | 0];
  // 树：投影、树冠、受光一侧的亮部
  const tree = (u, v, r) => { circ('tshade', u + SH[0] * 7, v + SH[1] * 7, r * .95); circ('tree', u, v, r); circ('treeH', u + LT[0] * r * .32, v + LT[1] * r * .32, r * .55); };
  const plant = (u, v, r) => { if (!free(u, v, r + 1)) return; tree(u, v, r); obs.push([u - r, v - r, u + r, v + r]); };
  // 土堤掩体（U 形，o = 1 开口朝 +v）
  const rev = (u, v, w, d, o) => { const q = [u - w / 2, v + o * d / 2, u - w / 2, v - o * d / 2, u + w / 2, v - o * d / 2, u + w / 2, v + o * d / 2]; line('berm', ...q); line('crest', ...q); };
  // 立式油罐：投影、罐壁、浮顶、受光亮部、中心呼吸阀
  const tank = (u, v, r, z) => {
    const o = ngon(u, v, r, 20);
    shade('shade', o, z); poly('foot', o); poly('tankR', o); circ('tank', u, v, r * .9); circ('tankH', u + LT[0] * r * .2, v + LT[1] * r * .2, r * .6); circ('box', u, v, r * .06 + .5);
    G.blocks.push({ pts: o, z });
  };

  // —— 地面：围栏内修剪过的草地；跑道升降带（更平整、割草条纹）——
  rect('grass', -544, -176, 544, 616);
  rect('strip', -505, -70, 505, 58);
  for (let u = -505; u < 505; u += 24) rect('mow', u, -70, u + 12, 58);
  // 双层围栏（正门留口）、岗楼
  line('fence', 12, 612, 540, 612, 540, -172, -540, -172, -540, 612, -12, 612);
  line('fence2', 16, 616, 544, 616, 544, -176, -544, -176, -544, 616, -16, 616);
  for (const [u, v] of [[-536, -168], [536, -168], [-536, 608], [536, 608], [-536, 220], [536, 220], [0, -168]]) bld(u, v, 5, 5, 0, 10, 'tan', 'flat');

  // —— 道路：巡逻道（碎石，沿围栏内侧一圈）、场内柏油路、停车场 ——
  { const p = P('gravel'), r = 24, U = 526, A = -160, B = 598;
    p.moveTo(-U + r, A); p.arcTo(U, A, U, A + r, r); p.arcTo(U, B, U - r, B, r); p.arcTo(-U, B, -U, B - r, r); p.arcTo(-U, A, -U + r, A, r); p.closePath(); }
  line('gravel', AFD_RAD[0], -160, AFD_RAD[0], AFD_RAD[1] - 14); line('gravel', 280, -160, 280, -133);
  for (const [u, v] of AFD_SHO) line('gravel', u, -160, u, v - 10);
  line('road', -255, 300, 330, 300);     // 机场路（机库后方）
  line('road', -186, 160, -186, 592);    // 西路（塔台 → 工业区）
  line('road', 195, 300, 195, 592);      // 东路
  line('road', -460, 450, 335, 450);     // 横路（弹药库大门 → 爱国者阵地）
  line('road', -460, 215, -460, 450);    // 弹药库内道路
  line('road10', 0, 300, 0, 628);        // 正门大道（出大门接公路）
  rect('lot', -12, 560, 12, 628);        // 大门前拓宽
  take(-255, 296, 330, 304); take(-190, 160, -182, 592); take(191, 300, 199, 592); take(-460, 446, 335, 454); take(-12, 300, 12, 628);
  rect('jersey', -11, 565, -3, 566.4); rect('jersey', 3, 573, 11, 574.4); rect('jersey', -11, 581, -3, 582.4);   // 大门前的防冲撞水泥墩（蛇形通道）
  // 停车场：车位线、停放的轿车
  const lotRow = (u0, u1, v0, v1, sp) => {
    for (let u = u0; u <= u1 + .01; u += sp) line('lotL', u, v0, u, v1);
    for (let u = u0; u + sp <= u1 + .01; u += sp) if (rnd() < .72) veh(car(), u + sp / 2, (v0 + v1) / 2, 2.1, 4.4, rnd() < .5 ? Math.PI / 2 : -Math.PI / 2);
  };
  rect('lot', -180, 408, -30, 438); take(-180, 408, -30, 438); lotRow(-180, -30, 408, 417, 4); lotRow(-180, -30, 429, 438, 4);   // 宿舍停车场
  rect('lot', 20, 460, 125, 500); take(20, 460, 125, 500); lotRow(20, 124, 460, 469, 4); lotRow(20, 124, 491, 500, 4);           // 服务社停车场
  rect('lot', -180, 470, -156, 540); take(-180, 470, -156, 540);                                                                  // 指挥部停车场
  for (let v = 470; v <= 540; v += 4) { line('lotL', -180, v, -172, v); line('lotL', -164, v, -156, v); }
  for (let v = 470; v < 540; v += 4) { if (rnd() < .7) veh(car(), -176, v + 2, 2.1, 4.4, 0); if (rnd() < .7) veh(car(), -160, v + 2, 2.1, 4.4, Math.PI); }
  rect('lot', 208, 312, 300, 342); take(208, 312, 300, 342);                                                                      // 加油车停车场
  for (let k = 0; k < 8; k++) veh('vWh', 214 + k * 11, 327, 3.6, 10, Math.PI / 2);

  // —— 滑行道：中线路径按宽度描成道面（转角、交叉口用圆弧倒角）——
  const TW = G.TW = new Path2D(), TL = G.TL = new Path2D();
  TW.moveTo(-450, 0); TW.lineTo(-450, 45); TW.arcTo(-450, 75, -420, 75, 30); TW.lineTo(420, 75); TW.arcTo(450, 75, 450, 45, 30); TW.lineTo(450, 0);   // 平行滑行道 + 两端联络道
  TW.moveTo(0, 0); TW.lineTo(0, 75); TW.moveTo(-30, 75); TW.arcTo(0, 75, 0, 45, 30); TW.moveTo(30, 75); TW.arcTo(0, 75, 0, 45, 30);              // 中间联络道
  TW.moveTo(120, 0); TW.bezierCurveTo(185, 0, 235, 75, 305, 75); TW.moveTo(-120, 0); TW.bezierCurveTo(-185, 0, -235, 75, -305, 75);           // 两个方向的快速出口
  for (const su of AFB_SP) { TL.moveTo(su, 75); TL.lineTo(su, 362); TL.moveTo(su - 28, 75); TL.arcTo(su, 75, su, 103, 28); TL.moveTo(su + 28, 75); TL.arcTo(su, 75, su, 103, 28); }   // 机库群鱼骨滑行道
  TL.moveTo(-446, 112); TL.quadraticCurveTo(-446, 165, -413, 165);                                           // 罗盘校正坪
  TL.moveTo(440, 112); TL.lineTo(440, 206); TL.lineTo(456, 206); TL.moveTo(440, 150); TL.lineTo(452, 150);   // 试车库、试车坪
  // 停机坪、起降坪、待命坪、机堡门前引道等混凝土道面
  rect('apron', -170, 84, 190, 232);                                     // 主停机坪（一直到机库门前）
  rect('apron', 196, 84, 330, 206); rect('apron', 275, 206, 305, 236);   // 直升机停机坪、起降坪
  rect('apron', -476, 86, -424, 116); rect('apron', 424, 86, 476, 116);  // 跑道两端待命 / 挂弹坪
  rect('apron', -237, 86, -193, 95);                                     // 消防站门前
  circ('apron', -395, 165, 18);                                          // 罗盘校正坪
  rect('apron', 452, 186, 492, 226);                                     // 试车坪
  for (const su of AFB_SP) circ('apron', su, 362, 13);                   // 鱼骨滑行道尽头的掉头坪
  for (const H of AFB_HAS) rect('apron', H.a ? H.su + 5 : H.u + 14, H.v - 11, H.a ? H.u - 14 : H.su - 5, H.v + 11);
  for (let u = -170; u <= 190; u += 7.5) line('joint', u, 84, u, 232);   // 道面板缝
  for (let v = 84; v <= 232; v += 7.4) line('joint', -170, v, 190, v);
  for (let u = 196; u <= 330; u += 7.45) line('joint', u, 84, u, 206);
  for (let v = 84; v <= 206; v += 7.6) line('joint', 196, v, 330, v);

  // —— 跑道：道肩、道面、防吹坪；标线 ——
  rect('rwSh', -462, -20, 462, 20); rect('rw', -460, -15, 460, 15); rect('bp', -490, -15, -460, 15); rect('bp', 460, -15, 490, 15);
  rect('rwP', -460, -14.2, 460, -13.3); rect('rwP', -460, 13.3, 460, 14.2);   // 边线
  for (let u = -398; u < 398; u += 20) rect('rwP', u, -.45, u + 12, .45);    // 中线
  for (const e of [-1, 1]) {
    const u0 = e > 0 ? 428 : -458, at = d => e * (460 - d);
    for (let i = 0; i < 4; i++) { const v1 = 13 - i * 3.2, v0 = v1 - 2.1; rect('rwP', u0, v0, u0 + 30, v1); rect('rwP', u0, -v1, u0 + 30, -v0); }   // 入口斑马线
    const bars = (d, m) => { for (let i = 0; i < m; i++) { const v0 = 3.4 + i * 2.7; rect('rwP', at(d) - 7.5, v0, at(d) + 7.5, v0 + 1.5); rect('rwP', at(d) - 7.5, -v0 - 1.5, at(d) + 7.5, -v0); } };
    bars(75, 3); bars(175, 2); bars(225, 2); bars(275, 1); bars(325, 1);   // 接地区标志
    rect('rwP', at(125) - 13, 3.6, at(125) + 13, 8.4); rect('rwP', at(125) - 13, -8.4, at(125) + 13, -3.6);   // 瞄准点
    for (let i = 0; i < 3; i++) { const ua = e * (465 + i * 8.5); line('chev', ua + e * 9, -13, ua, 0, ua + e * 9, 13); }   // 防吹坪人字标
    // 拦阻索（BAK-12）：横跨跑道的钢索、两侧的制动器机房、道面上的黄色圆盘
    const ua = e * 390; line('cable', ua, -24, ua, 24); rect('box', ua - 2, -26.5, ua + 2, -23.5); rect('box', ua - 2, 23.5, ua + 2, 26.5);
    for (let v = -10; v <= 10; v += 5) circ('disc', ua, v, 1.1);
    // 灯光：入口灯（绿）、进近灯（中线短排灯 + 横排灯）、PAPI
    for (let v = -15; v <= 15; v += 3) circ('lG', e * 461.5, v, .55);
    for (let d = 15; d <= 150; d += 15) rect('lW', e * (490 + d) - .4, -3, e * (490 + d) + .4, 3);
    rect('lW', e * 590 - .4, -21, e * 590 + .4, 21);
    for (let i = 0; i < 4; i++) rect('papi', e * 360 - 1, -25 - i * 3.2, e * 360 + 1, -23 - i * 3.2);
    // 下滑台（天线杆 + 机房）、航向台（天线阵 + 机房）
    circ('mast', e * 370, -42, 1.2); rect('box', e * 370 + 2, -44, e * 370 + 6, -40.5);
    for (let v = -18; v <= 18; v += 3) circ('mast', e * 508, v, .6);
    rect('box', e * 508 - 2.5, -30, e * 508 + 2.5, -26);
  }
  // 接地区轮胎胶痕：主起落架两条轮迹，离接地点越近越重
  for (const e of [-1, 1]) for (let i = 0; i < 10; i++) {
    const u = e * (460 - 70 - i * 22 - rnd() * 10), len = 16 + rnd() * 10;
    for (const v of [-3.6, 3.6]) { const p = P(i < 4 ? 'rub1' : 'rub2'), vv = v + (rnd() - .5) * .8; p.moveTo(u + len / 2, vv); p.ellipse(u, vv, len / 2, 1.2 + rnd() * .6, 0, 0, 2 * Math.PI); }
  }
  for (let u = -440; u <= 440; u += 40) { circ('lW', u, -17, .55); circ('lW', u, 17, .55); }       // 跑道边灯
  for (let u = -435; u <= 435; u += 30) { circ('lB', u, 65.5, .5); circ('lB', u, 84.5, .5); }    // 滑行道边灯（蓝）
  for (let u = -400; u <= 400; u += 100) { rect('sign', u - 1.6, -25, u + 1.6, -23.6); rect('sign', u - 1.6, 23.6, u + 1.6, 25); }   // 剩余距离牌
  // 滑行道等待位置（实线在滑行道一侧）与标牌
  for (const u of [-450, 0, 450]) {
    line('hold', u - 8, 40.2, u + 8, 40.2); line('hold', u - 8, 39, u + 8, 39); line('holdD', u - 8, 37.8, u + 8, 37.8); line('holdD', u - 8, 36.6, u + 8, 36.6);
    rect('sign', u + 10, 39.5, u + 15, 41.1);
  }
  // 风向袋（风从西来）
  { const D = dirL(1, 0), N = [-D[1], D[0]];
    for (const e of [-1, 1]) { const u = e * 420, v = -38; circ('mast', u, v, .8); poly('sock', [[u + N[0] * 1.2, v + N[1] * 1.2], [u - N[0] * 1.2, v - N[1] * 1.2], [u + D[0] * 8 - N[0] * .5, v + D[1] * 8 - N[1] * .5], [u + D[0] * 8 + N[0] * .5, v + D[1] * 8 + N[1] * .5]]); } }

  // —— 机位标线：停机线引入线与停止线、机坪滑行道、机堡引道中线；直升机位圆圈与 H；起降坪；罗盘校正坪 ——
  for (const [u, v, , k] of EA_STAND) {
    if (k === 'line') { const v0 = v < 150 ? 75 : 158, vn = v - 7.5; line('stand', u, v0, u, vn); line('stand', u - 3.2, vn, u + 3.2, vn); }
    if (k === 'heli') { circ('heliP', u, v, 8); line('heliH', u - 2.6, v - 3.4, u - 2.6, v + 3.4, u - 2.6, v, u + 2.6, v, u + 2.6, v - 3.4, u + 2.6, v + 3.4); }
  }
  line('apL', -170, 158, 190, 158);
  for (const H of AFB_HAS) line('stand', H.su, H.v, H.u + (H.a ? -15 : 15), H.v);
  { const [u, v] = EA_PAD; circ('padP', u, v, 11.5); line('padH', u - 4, v - 6, u - 4, v + 6); line('padH', u + 4, v - 6, u + 4, v + 6); line('padH', u - 4, v, u + 4, v); }
  { const u = -395, v = 165, N = dirL(0, -1), E = [-N[1], N[0]];
    circ('rose', u, v, 15); circ('rose', u, v, 7);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; line('rose', u + Math.cos(a) * 7, v + Math.sin(a) * 7, u + Math.cos(a) * 15, v + Math.sin(a) * 15); }
    poly('roseN', [[u + N[0] * 17.5, v + N[1] * 17.5], [u + N[0] * 11 + E[0] * 2.4, v + N[1] * 11 + E[1] * 2.4], [u + N[0] * 11 - E[0] * 2.4, v + N[1] * 11 - E[1] * 2.4]]); }
  for (const [u, v] of [[-168, 229], [-60, 229], [60, 229], [188, 229]]) circ('mast', u, v, 1);   // 停机坪照明灯杆

  // —— 跑道外侧：雷达站、M-SHORAD 与高炮掩体、守备队工事 ——
  rect('gravF', AFD_RAD[0] - 18, AFD_RAD[1] - 14, AFD_RAD[0] + 18, AFD_RAD[1] + 14);   // AN/TPS-80：碎石场坪、雷达拖车（天线旋转另画）、发电机、方舱
  bld(AFD_RAD[0], AFD_RAD[1] - 3, 12, 4.4, 0, 3.5, 'olive', 'flat'); bld(AFD_RAD[0] - 11, AFD_RAD[1] + 8, 5, 3, 0, 2.5, 'olive', 'flat'); bld(AFD_RAD[0] + 9, AFD_RAD[1] + 8, 6, 4, 0, 3, 'tan', 'flat');
  line('fence', 262, -133, 298, -133, 298, -103, 262, -103, 262, -133);   // 机场监视雷达：围栏小院、机房、天线塔
  bld(272, -112, 12, 8, 0, 5, 'conc', 'flat'); circ('box', 288, -124, 2.6);
  for (const [u, v] of AFD_SHO) rev(u, v, 20, 18, 1);
  rev(AFD_LPWS[0], AFD_LPWS[1], 20, 18, 1);
  // 消防训练坑：圆形混凝土坑、烧黑的地面、飞机模型骨架
  line('gravel', 40, -160, 40, -140); circ('wallC', 40, -125, 15); circ('soot', 40, -125, 13);
  line('mock', 31, -125, 49, -125); line('mock', 42, -133, 42, -117); line('mock', 33, -128.5, 33, -121.5);
  for (const [u, v] of AFD_GUN) { const p = P('bag'), a0 = Math.PI / 2 + .55; p.moveTo(u + Math.cos(a0) * 7, v + Math.sin(a0) * 7); p.arc(u, v, 7, a0, Math.PI * 2.5 - .55); }   // 火神高炮：沙袋圆环（后方留口）
  for (const [u, v] of AFD_POST) { const a = Math.atan2(v - 200, u), p = P('bag'); p.moveTo(u + Math.cos(a - 1.1) * 5, v + Math.sin(a - 1.1) * 5); p.arc(u, v, 5, a - 1.1, a + 1.1); }   // 守备队：朝外的沙袋胸墙

  // —— 飞行区建筑 ——
  bld(-215, 107, 44, 24, 0, 7, 'conc', 'flat');   // 消防站：车库门朝滑行道，门前三辆消防车
  for (let i = 0; i < 5; i++) rect('bay', -234.5 + i * 8.6, 94.6, -228.5 + i * 8.6, 95.8);
  for (const u of [-229, -215, -201]) veh('vLime', u, 90, 3.4, 8.4, -Math.PI / 2);
  bld(-215, 136, 10, 10, 0, 30, 'conc', 'flat'); G.blocks[G.blocks.length - 1].k = 'tower';  // 塔台：塔身 + 八角形玻璃塔顶
  { const o = ngon(-215, 136, 7, 8); shade('shade', o, 36); poly('foot', o); poly('cab', o); poly('cabTop', ngon(-215, 136, 4.6, 8)); G.blocks.push({ pts: o, z: 36, z0: 30, k: 'cab' }); line('ant', -215, 136, -211, 132.5); }
  bld(-215, 161, 40, 22, 0, 7, 'tan', 'flat');    // 航务楼
  for (const u of [-120, 0, 120]) {   // 维修机库：拱顶、门朝停机坪（门轨与门扇）
    bld(u, 256, 70, 48, 0, 16, 'metal', 'arch');
    line('door', u - 33, 232.7, u + 33, 232.7);
    for (let x = u - 33; x < u + 30; x += 4) line('hatch', x, 231.6, x + 4, 226);   // 门前警戒斜纹
    for (let x = u - 30; x <= u + 30.1; x += 7.5) line('doorP', x, 231.9, x, 233.5);
  }
  for (const u of [-60, 60]) bld(u, 258, 30, 40, 0, 8, 'conc', 'flat');   // 中队楼
  bld(227, 227, 44, 34, 0, 12, 'metal', 'arch'); line('door', 208, 210.7, 246, 210.7);   // 直升机库
  for (const H of AFB_HAS) {   // 机堡：拱顶、门脸墙、门、后部排气口
    const Q = bld(H.u, H.v, 30, 24, H.a, 9, 'has', 'has');
    poly('wall', [Q(13.6, -13), Q(15.4, -13), Q(15.4, 13), Q(13.6, 13)]);
    line('hasDoor', ...Q(15.4, -10), ...Q(15.4, 10));
    poly('box', [Q(-15.6, -2.2), Q(-14, -2.2), Q(-14, 2.2), Q(-15.6, 2.2)]);
  }
  bld(468, 150, 36, 20, 0, 10, 'conc', 'arch'); bld(494, 150, 16, 7, 0, 6, 'dark', 'arch');   // 发动机试车库与消音排气筒
  bld(493.5, 206, 3, 38, 0, 4, 'conc', 'flat'); circ('box', 470, 206, .9);                    // 试车坪：导流墙、系留点
  line('fence', 450, 250, 520, 250, 520, 340, 450, 340, 450, 250); take(450, 250, 520, 340);  // 地面设备场：棚、电源车、气源车、照明车
  bld(485, 262, 56, 14, 0, 6, 'metal', 'gable');
  for (let r = 0; r < 4; r++) for (let k = 0; k < 10; k++) if (rnd() < .8) veh(['vOl', 'vAge', 'vWh'][(rnd() * 3) | 0], 457 + k * 6.6, 284 + r * 15, 2.6, 4, Math.PI / 2);

  // —— 工业区：仓库、土木工程场、水塔、净水池、电站、机动车场 ——
  bld(-356, 394, 44, 18, 0, 9, 'metal', 'gable'); bld(-356, 427, 44, 18, 0, 9, 'metal', 'gable');
  line('fence', -320, 380, -215, 380, -215, 440, -320, 440, -320, 380); take(-320, 380, -215, 440);
  bld(-298, 392, 20, 12, 0, 6, 'tan', 'gable'); bld(-268, 392, 20, 12, 0, 6, 'tan', 'gable');
  circ('pile', -300, 424, 5.5); circ('pile2', -282, 427, 4.5); circ('pile', -262, 423, 6); circ('pile2', -241, 426, 4.2);
  veh('vTan', -236, 400, 3.4, 8, Math.PI / 2); veh('vOl', -226, 400, 3.4, 8, Math.PI / 2);
  { const o = ngon(-232, 322, 7); shade('shade', o, 26); poly('foot', o); poly('tankR', o); circ('tank', -232, 322, 6.2); circ('tankH', -232 + LT[0] * 1.5, 322 + LT[1] * 1.5, 4); G.blocks.push({ pts: o, z: 26, z0: 17 }); take(-239, 315, -225, 329); }
  circ('wallC', -256, 320, 6.4); circ('water', -256, 320, 5.3); take(-262, 314, -250, 326);
  bld(-236, 353, 44, 22, 0, 10, 'dark', 'flat');
  for (const u of [-250, -238, -226]) { const o = ngon(u, 349, 1.8, 8); shade('shade', o, 18); poly('foot', o); poly('stack', o); G.blocks.push({ pts: o, z: 18 }); }
  line('fence', -378, 458, -196, 458, -196, 590, -378, 590, -378, 458); take(-378, 458, -196, 590);
  rect('gravF', -376, 492, -198, 588);
  bld(-330, 474, 50, 20, 0, 8, 'metal', 'gable'); rect('apron', -270, 465, -246, 481);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 15; k++) if (rnd() < .78) veh(rnd() < .8 ? 'vOl' : 'vTan', -366 + k * 11, 505 + r * 23, 3.4, 8.6, Math.PI / 2);

  // —— 营区：宿舍、指挥部、礼拜堂、体育场、健身房、食堂、诊所、服务社、访客中心、大门 ——
  for (const u of [-150, -60]) for (const v of [325, 357, 389]) bld(u, v, 50, 12, 0, 9, 'brick', 'gable');
  bld(-105, 479, 90, 18, 0, 10, 'white', 'flat'); bld(-141, 514, 18, 52, 0, 10, 'white', 'flat'); bld(-69, 514, 18, 52, 0, 10, 'white', 'flat');
  circ('mast', -105, 463, .8);
  bld(-170, 573, 14, 26, 0, 9, 'brick', 'gable'); bld(-170, 557, 6, 6, 0, 18, 'white', 'flat');
  const stad = (k, r) => { const p = P(k); p.moveTo(54, 350 - r); p.lineTo(106, 350 - r); p.arc(106, 350, r, -Math.PI / 2, Math.PI / 2); p.lineTo(54, 350 + r); p.arc(54, 350, r, Math.PI / 2, Math.PI * 1.5); p.closePath(); };
  stad('track', 24); stad('pitch', 17); take(30, 326, 130, 374);
  for (const r of [19, 21, 23]) stad('sportL', r);
  P('sportL').rect(47, 337, 66, 26); line('sportL', 80, 337, 80, 363); circ('sportL', 80, 350, 4.5); P('sportL').rect(47, 343, 8, 14); P('sportL').rect(105, 343, 8, 14);
  bld(163, 333, 36, 26, 0, 11, 'metal', 'arch');
  bld(50, 409, 40, 22, 0, 7, 'tan', 'flat'); for (const [u, v] of [[36, 403], [44, 403], [58, 411]]) rect('box', u, v, u + 3.2, v + 2.4);
  bld(115, 409, 30, 18, 0, 7, 'white', 'flat');
  bld(158, 476, 46, 28, 0, 8, 'conc', 'flat');
  bld(31, 578, 18, 12, 0, 5, 'tan', 'flat');
  bld(0, 600, 24, 12, 0, 6, 'canopy', 'flat');

  // —— 油库与加油车场、爱国者导弹排 ——
  bld(316, 322, 24, 16, 0, 6, 'tan', 'flat');
  line('berm', 212, 478, 328, 478, 328, 594, 212, 594, 212, 478); line('crest', 212, 478, 328, 478, 328, 594, 212, 594, 212, 478); take(210, 460, 330, 596);
  for (const [u, v] of [[241, 507], [299, 507], [241, 565], [299, 565]]) tank(u, v, 15, 12);
  bld(270, 536, 12, 8, 0, 5, 'conc', 'flat');
  bld(233, 465, 26, 10, 0, 6, 'canopy', 'flat'); veh('vWh', 256, 465, 3.6, 10, 0);
  line('pipe', 270, 478, 270, 244);
  for (const [u, v] of AFD_PAT) rev(u, v, 20, 22, 1);
  rev(372, 548, 20, 22, 1); rev(516, 548, 20, 22, 1);   // 预备发射阵位
  rect('gravF', 428, 460, 462, 484);
  bld(445, 472, 14, 6, 0, 4, 'olive', 'flat'); bld(445, 467.6, 12, 2.8, 0, 5, 'dark', 'flat');   // AN/MPQ-65 雷达（阵面朝跑道外侧）
  rev(445, 474, 28, 18, -1);
  bld(420, 497, 10, 5, 0, 3.5, 'olive', 'flat'); bld(470, 497, 10, 5, 0, 3.5, 'olive', 'flat'); bld(445, 522, 8, 4, 0, 3, 'olive', 'flat'); circ('mast', 445, 528, 1.2);   // 交战控制站、电源车、天线车
  poly('net', [[411, 489], [428, 488], [430, 503], [419, 507], [409, 500]]); poly('net', [[461, 489], [479, 491], [478, 505], [463, 505]]);
  line('cable', 420, 497, 392, 443); line('cable', 420, 497, 498, 443); line('cable', 445, 476, 432, 494);
  line('wire', 350, 398, 532, 398, 532, 596, 350, 596, 350, 398); take(350, 398, 532, 596);

  // —— 弹药库区：独立围栏、覆土弹药库（门脸墙朝内部道路）、装配检测间 ——
  line('fence', -388, 444, -388, 202, -532, 202, -532, 470, -388, 470, -388, 456); take(-532, 202, -388, 470);
  const igloo = (u, v, a) => {
    const Q = bld(u, v, 26, 18, a, 5, 'mound', 'gable');
    poly('wall', [Q(11.6, -12), Q(13.4, -12), Q(13.4, 12), Q(11.6, 12)]); poly('box', [Q(13, -3), Q(13.6, -3), Q(13.6, 3), Q(13, 3)]);
    rect('apron', u + Math.cos(a) * 13.4, v - 5, a ? -456.5 : -463.5, v + 5);
  };
  for (const v of [230, 285, 340, 395]) { igloo(-490, v, 0); igloo(-430, v, Math.PI); }
  bld(-500, 446, 30, 16, 0, 7, 'conc', 'gable');

  // —— 树：行道树、围栏边、指挥部庭院、营区草坪、场区边角（离跑道净空远）——
  for (let v = 312; v <= 556; v += 15) { plant(-13, v, 4 + rnd()); plant(13, v, 4 + rnd()); }
  for (let u = -176; u <= 185; u += 17) { plant(u, 440, 3.6 + rnd()); plant(u, 460, 3.6 + rnd()); }
  for (let v = 312; v <= 586; v += 16) plant(-176, v, 3.8 + rnd());
  for (let u = -176; u <= 185; u += 13) plant(u, 588, 3.5 + rnd() * 1.5);
  for (const [u, v] of [[-105, 505], [-117, 527], [-93, 527]]) plant(u, v, 4.5);
  for (let i = 0; i < 160; i++) plant(-180 + rnd() * 365, 306 + rnd() * 284, 3 + rnd() * 2.5);
  for (let i = 0; i < 60; i++) plant((rnd() < .5 ? -1 : 1) * (350 + rnd() * 180), 380 + rnd() * 215, 3 + rnd() * 2);
  return G;
}

// —— 绘制 ——
// 材质底色（写实 / 黑绿）：坡顶亮面 ×1.1、暗面 ×0.72，拱顶中间 ×0.93；平顶外圈 ×0.84、女儿墙亮边 ×1.02、屋面 ×0.92
const AFB_MAT = { has: [150, 150, 140], metal: [178, 181, 178], conc: [170, 168, 160], tan: [178, 164, 132], brick: [148, 106, 90], white: [208, 208, 200],
  dark: [92, 95, 93], olive: [98, 106, 74], mound: [102, 124, 72], canopy: [198, 198, 192] };
const AFB_TONE = { L: 1.1, D: .72, M: .93, F0: .84, F1: 1.02, F2: .92 };
const _afbT = {};
const afbTone = (m, k) => _afbT[m + k] || (_afbT[m + k] = `rgb(${AFB_MAT[m].map(x => Math.min(255, Math.round(x * k))).join(',')})`);
const AFB_C = {
  grass: '#6b7b49', strip: 'rgba(160,176,112,.3)', mow: 'rgba(255,255,255,.045)', gravel: '#958e78', gravF: '#8a8470', road: '#4f5151', lot: '#575959',
  lotL: 'rgba(236,236,226,.55)', roadC: 'rgba(236,236,226,.5)', twSh: '#78786f', tw: '#86867f', apron: '#9d9b93', joint: 'rgba(40,40,36,.12)',
  rwSh: '#6b6b65', rw: '#3b3d3d', bp: '#474947', paint: 'rgba(238,240,234,.93)', ylw: '#cdb85c', shade: 'rgba(0,0,0,.3)', vshade: 'rgba(0,0,0,.24)',
  tree: '#3b5331', treeH: '#566f45', berm: '#7a6e50', crest: 'rgba(176,164,124,.75)', bag: '#a39470', fence: 'rgba(206,210,204,.6)', net: 'rgba(58,70,44,.82)',
  track: '#97665a', pitch: '#62894a', pile: '#8e8672', pile2: '#77705f', water: '#46545c', wallC: '#b4b2aa', tankR: '#a9a9a2', tank: '#d6d6ce', tankH: '#e6e6de',
  stack: '#3c3e3c', glass: '#40545f', box: '#3b3d3b', sign: '#1c1c1a', mast: '#2b2b29', sock: '#ecece4', jersey: '#c9c7be', cabs: 'rgba(0,0,0,.22)',
  rub1: 'rgba(0,0,0,.22)', rub2: 'rgba(0,0,0,.12)', soot: 'rgba(34,30,26,.72)',
  vOl: '#5a6142', vTan: '#a69a78', vWh: '#d4d4cd', vLime: '#b0b462', vAge: '#c2b36a', car1: '#c8c8c4', car2: '#3e4246', car3: '#5d6f80', car4: '#8f8576'
};
const AFB_CG = { ...AFB_C, rub1: 'rgba(0,0,0,.12)', rub2: 'rgba(0,0,0,.07)', shade: 'rgba(0,0,0,.2)', vshade: 'rgba(0,0,0,.16)', tree: '#4d653b', treeH: '#5b7547', joint: 'rgba(40,40,36,.07)', mow: 'rgba(255,255,255,.03)' };
// 停放的飞机：{u, v, a, k 位置类型, sil, size, col, ready, prog 整备进度}
function afbParked(b, own) {
  if (b.dead || typeof drawAircraft !== 'function') return [];
  if (own) {
    if (typeof abParked !== 'function') return [];
    return abParked().slice(0, EA_STAND.length).map((w, k) => { const [u, v, a, kd] = EA_STAND[k]; return { u, v, a, k: kd, sil: airSilKey(w.type, w.v), size: 14, col: COL.intel, ready: w.state === 'deck', prog: 1 - clamp(w.rearmT / 45, 0, 1) }; });
  }
  return eaParked(b).map(P => ({ u: P.u, v: P.v, a: P.a, k: P.k, sil: eaSil(P.w.type), size: P.w.type === 'heli' ? 13 : P.w.type === 'f22' ? 15 : 14, col: COL.enemy,
    ready: P.w.state === 'ready', prog: 1 - clamp(P.w.rearmT / EA_REARM, 0, 1) }));
}
// 地面层（drawGround，先于弹坑、战壕、据点与部队）：整座机场与停放的飞机；看不见但已标定的机场半透明
function eaDrawBases(time) {
  if (!S || typeof eaOn !== 'function' || !eaOn() || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, spec = specAll();
  for (const b of S.enemies) {
    if (b.kind !== 'airfield' || !inView(b.x, b.y, 820)) continue;
    const vis = spec || eaBaseSeen(b);
    if (vis || b.kx != null) eaDrawBase(ctx, b, vis, time);
  }
  if (S.abBase && inView(S.abBase.x, S.abBase.y, 820)) eaDrawBase(ctx, S.abBase, true, time, true);   // 我方夺取的机场（abn.js）
}
function eaDrawBase(ctx, b, vis, time, own) {
  const G = afbGeo(b.rh || 0, b.rs || 1), rl = realLook(), dead = !!b.dead, sc = R.s, d1 = sc >= .62, d2 = sc >= 1.6, d3 = sc >= 2.6;
  const C = typeof greenLook === 'function' && greenLook() ? AFB_CG : AFB_C;   // 黑绿画面：投影、树、道面接缝的明暗差小一点（着色器按亮度差描边）
  const park = afbParked(b, own);
  ctx.save();
  ctx.translate(b.x, b.y); ctx.rotate(b.rh || 0); ctx.scale(1, b.rs || 1);
  ctx.globalAlpha = vis ? 1 : .5; ctx.setLineDash([]); ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  const F = (k, col) => { const p = G[k]; if (p) { ctx.fillStyle = col; ctx.fill(p); } };
  const L = (k, col, w, dash, cap) => {
    const p = typeof k === 'string' ? G[k] : k;
    if (!p) return;
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = cap || 'butt'; ctx.setLineDash(dash || []); ctx.stroke(p);
  };
  const px1 = px(1);
  if (rl) {
    // 地面、道路、停车场、地面上的场地
    F('grass', C.grass); if (d1) { F('strip', C.strip); F('mow', C.mow); }
    L('gravel', C.gravel, 6, null, 'round'); F('gravF', C.gravF);
    L('road', C.road, 8, null, 'round'); L('road10', C.road, 10, null, 'round'); F('lot', C.lot);
    F('track', C.track); F('pitch', C.pitch);
    if (d1) { F('pile', C.pile); F('pile2', C.pile2); F('wallC', C.wallC); F('water', C.water); F('jersey', C.jersey); }
    if (d2) { L('road', C.roadC, .45, [4, 5]); L('road10', C.roadC, .45, [4, 5]); L('lotL', C.lotL, .35); L('sportL', 'rgba(240,240,232,.8)', .3); L('pipe', 'rgba(56,56,52,.35)', .6, [3, 3]); }
    // 滑行道（道肩、道面）、停机坪
    L(G.TW, C.twSh, 23, null, 'round'); L(G.TL, C.twSh, 16.5, null, 'round');
    L(G.TW, C.tw, 16, null, 'round'); L(G.TL, C.tw, 12, null, 'round');
    F('apron', C.apron);
    if (d3) L('joint', C.joint, .2);
    // 跑道
    F('rwSh', C.rwSh); F('rw', C.rw); F('bp', C.bp);
    if (d1) {
      F('rwP', C.paint); F('rub1', C.rub1); F('rub2', C.rub2); L('chev', C.ylw, 1.3);
      L(G.TW, C.ylw, .55); L(G.TL, C.ylw, .55); L('apL', C.ylw, .55); L('stand', C.ylw, .45);
      L('heliP', C.ylw, .6); L('heliH', C.paint, .7); L('padP', C.paint, 1); L('padH', C.paint, 1.4);
    }
    F('soot', C.soot); if (d1) L('mock', '#2a2826', 1.4, null, 'round');
    if (d2) { L('hatch', C.ylw, .7); L('hold', C.ylw, .45); L('holdD', C.ylw, .45, [1.2, 1]); F('sign', C.sign); L('rose', C.paint, .4); F('roseN', C.paint); F('disc', C.ylw); L('cable', '#1e1e1e', .4); }
    afbCraters(ctx, b, true);
    // 土堤、沙袋（矮，不投影）
    if (d1) { L('berm', C.berm, 3.4, null, 'round'); L('crest', C.crest, .7, null, 'round'); L('bag', C.bag, 2, null, 'round'); }
    // 投影 → 机堡里的飞机（被拱顶盖住后半截）→ 屋顶 → 细节 → 停在外面的飞机
    F('shade', C.shade); if (d1) { F('tshade', C.shade); F('vshade', C.vshade); }
    afbPlanes(ctx, park, true, d1, true);
    for (const m in AFB_MAT) for (const t in AFB_TONE) F(t + m, afbTone(m, AFB_TONE[t]));
    F('tankR', C.tankR); F('tank', C.tank); F('tankH', C.tankH); F('stack', C.stack); F('cab', C.glass); F('cabTop', afbTone('conc', 1.02));
    if (d1) {
      L('ridge', 'rgba(255,255,255,.2)', .35); F('wall', afbTone('conc', 1.08)); L('hasDoor', '#2a2c2a', 1.4); L('door', 'rgba(30,32,30,.75)', 1.6); F('bay', '#2a2c2a'); F('box', C.box);
      for (const k of ['vOl', 'vTan', 'vWh', 'vLime', 'vAge', 'car1', 'car2', 'car3', 'car4']) F(k, C[k]);
      F('cabs', C.cabs); F('net', C.net); F('tree', C.tree); F('treeH', C.treeH); F('mast', C.mast); F('sock', C.sock);
      L('fence', C.fence, Math.max(.45, px1 * .8), [2.4, 1.4]); L('fence2', C.fence, Math.max(.45, px1 * .8), [2.4, 1.4]); L('wire', 'rgba(200,200,190,.5)', .5, [1.2, 1.2]);
    } else L('fence', C.fence, px1);
    if (d2) { L('doorP', 'rgba(20,22,20,.6)', .3); L('ant', C.mast, .4); L('cable', 'rgba(30,30,28,.55)', .35, [1.5, 1.5]); }
    if (d3) L('corr', 'rgba(60,62,60,.18)', .2);
    if (d2) { F('lW', 'rgba(255,252,236,.95)'); F('lG', 'rgba(130,255,165,.95)'); F('lB', 'rgba(130,160,255,.9)'); F('papi', '#ffffff'); }
  } else {
    // 数码矩阵画面：暗底 + 发光轮廓
    const slab = 'rgba(30,36,33,.9)', pave = 'rgba(16,20,18,.93)', dark = 'rgba(2,10,6,.92)', paint = rgba('#e8fff0', .5), con = rgba(STRUCT, .42), dim = rgba(COL.gDim, .5);
    F('grass', 'rgba(4,14,9,.85)');
    L('gravel', dim, 4, null, 'round'); L('road', dim, 6, null, 'round'); L('road10', dim, 8, null, 'round'); F('lot', 'rgba(14,20,17,.9)');
    L(G.TW, con, 16 + px1 * 2, null, 'round'); L(G.TL, con, 12 + px1 * 2, null, 'round'); L(G.TW, slab, 16, null, 'round'); L(G.TL, slab, 12, null, 'round');
    F('apron', slab); L('apron', con, px1);
    F('rwSh', slab); F('rw', pave); F('bp', pave);
    if (d1) { F('rwP', paint); L(G.TW, rgba(COL.amber, .35), px1, [4, 4]); L(G.TL, rgba(COL.amber, .35), px1, [4, 4]); L('stand', rgba(COL.amber, .3), px1); L('heliP', paint, px1); L('padP', paint, px1 * 1.2); }
    afbCraters(ctx, b, false);
    if (d1) { L('berm', rgba(COL.gDim, .8), 3, null, 'round'); L('bag', rgba(COL.gMid, .6), 2, null, 'round'); }
    afbPlanes(ctx, park, true, d1, false);
    F('foot', dark); L('foot', rgba(dead ? COL.smoke : own ? COL.g : COL.enemy, .7), px1 * 1.1);
    if (d1) { L('tree', rgba(COL.gDim, .7), px1); L('fence', con, px1, [3, 2.5]); }
  }
  // 跑道外框（敌我标识色）
  ctx.setLineDash([]); ctx.strokeStyle = rgba(dead ? COL.smoke : own ? COL.g : COL.enemy, .55); ctx.lineWidth = px1 * 1.2; ctx.strokeRect(-460, -15, 920, 30);
  // 被毁：建筑焦黑
  if (dead) { ctx.fillStyle = 'rgba(16,12,10,.62)'; ctx.fill(G.foot); }
  // 雷达天线：机场监视雷达（转得快）、AN/TPS-80（慢）
  const ant = (u, v, l, w, sp) => {
    const a = dead ? .6 : time * sp;
    ctx.save(); ctx.translate(u, v); ctx.rotate(a); ctx.fillStyle = rl ? '#d8dad6' : rgba(STRUCT, .7); ctx.fillRect(-l / 2, -w / 2, l, w); ctx.restore();
  };
  ant(288, -124, 11, 1.6, 1.6);
  ant(AFD_RAD[0], AFD_RAD[1] - 3, 8, 2.2, .9);
  afbPlanes(ctx, park, false, d1, rl);
  ctx.restore();
  if (d2 && !dead) afbRwyNum(ctx, b, vis ? 1 : .5, rl);
}
// 停放的飞机：机堡里的先画（拱顶盖住后半截，机头伸出门外），停机线与直升机位的后画；整备中的暗、外加进度弧；
// 写实近看：停机线上整备中的飞机旁边停一辆加油车、机头前一台电源车
function afbPlanes(ctx, park, has, d1, rl) {
  if (R.m3d) return;   // 3D：停放的飞机是立体模型（v3units.js）
  for (const p of park) {
    if ((p.k === 'has') !== has) continue;
    drawAircraft(ctx, p.u, p.v, p.a, p.sil, p.size, p.col, p.ready ? .95 : .5, 0, px(1), undefined, { still: true });   // 停放：旋翼不转
  }
  if (has || !d1) return;
  if (rl) for (const p of park) if (!p.ready && p.k === 'line') {
    ctx.fillStyle = AFB_C.vshade; ctx.fillRect(p.u + 9.6, p.v - 3.4, 3.6, 10); ctx.fillRect(p.u - 7.2, p.v - 11.6, 3.6, 2.4);
    ctx.fillStyle = AFB_C.vWh; ctx.fillRect(p.u + 9, p.v - 4, 3.6, 10); ctx.fillStyle = AFB_C.cabs; ctx.fillRect(p.u + 9.2, p.v - 4, 3.2, 2.6);
    ctx.fillStyle = AFB_C.vAge; ctx.fillRect(p.u - 7.8, p.v - 12.2, 3.6, 2.4);
  }
  for (const p of park) if (!p.ready) {
    ctx.setLineDash([]); ctx.strokeStyle = rgba(COL.amber, .8); ctx.lineWidth = px(1.4);
    ctx.beginPath(); ctx.arc(p.u, p.v, 9, -1.57, -1.57 + p.prog * 6.283); ctx.stroke();
  }
}
// 跑道弹坑（局部坐标 b.rc）
function afbCraters(ctx, b, rl) {
  for (const c of b.rc || []) {
    const g = ctx.createRadialGradient(c.u, c.v, 0, c.u, c.v, c.r * 1.6);
    g.addColorStop(0, 'rgba(0,0,0,.9)'); g.addColorStop(.6, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.u, c.v, c.r * 1.6, 0, 7); ctx.fill();
    if (rl) { ctx.fillStyle = 'rgba(120,104,78,.55)'; ctx.beginPath(); ctx.arc(c.u, c.v, c.r * 1.25, 0, 7); ctx.arc(c.u, c.v, c.r * .9, 0, 7, true); ctx.fill(); }
    ctx.strokeStyle = rgba(COL.amber, .45); ctx.lineWidth = px(1); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(c.u, c.v, c.r, 0, 7); ctx.stroke();
  }
}
// 跑道号：按跑道磁向（取真方位）写在两端入口斑马线之后，字头朝着陆方向；在世界坐标里写，不受机场镜像影响
function afbRwyNum(ctx, b, a, rl) {
  const h = b.rh || 0, brg = (Math.atan2(Math.cos(h), -Math.sin(h)) * 180 / Math.PI + 360) % 360;
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = rl ? AFB_C.paint : rgba('#e8fff0', .5);
  ctx.font = '700 9px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const e of [-1, 1]) {   // e = -1：-u 端入口（朝 +u 着陆）
    const dir = e < 0 ? brg : (brg + 180) % 360, num = String(Math.round(dir / 10) % 36 || 36).padStart(2, '0');
    const [x, y] = eaW(b, e * 413, 0), ux = -e * Math.cos(h), uy = -e * Math.sin(h);
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(ux, -uy)); ctx.scale(1, 1.6); ctx.fillText(num, 0, 0); ctx.restore();
  }
  ctx.restore();
}
// 跑道封闭、耐久 / 重建进度、起火冒烟（drawUnder：压在部队之下、地面之上）
function eaDrawBaseFx(time) {
  if (!S || typeof eaOn !== 'function' || !eaOn() || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, spec = specAll();
  const list = S.enemies.filter(b => b.kind === 'airfield' && inView(b.x, b.y, 820) && (spec || eaBaseSeen(b) || b.kx != null)).map(b => [b, spec || eaBaseSeen(b), false]);
  if (S.abBase && inView(S.abBase.x, S.abBase.y, 820)) list.push([S.abBase, true, true]);
  for (const [b, vis, own] of list) {
    const dead = b.dead, a = vis ? 1 : .5, f = clamp(b.hp / b.maxhp, 0, 1), C0 = own ? COL.g : COL.enemy, bh = Math.max(1.5, px(2.5));
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rh || 0); ctx.scale(1, b.rs || 1); ctx.globalAlpha = 1;
    if (!dead && b.cratT > S.t) {   // 跑道封闭：琥珀色虚线框住道面，下沿是抢修进度
      ctx.strokeStyle = rgba(COL.amber, (.5 + .3 * Math.sin(time * 5)) * a); ctx.lineWidth = px(1.6); ctx.setLineDash([px(6), px(5)]);
      ctx.strokeRect(-463, -18, 926, 36); ctx.setLineDash([]);
      ctx.fillStyle = rgba(COL.amber, .75 * a); ctx.fillRect(-460, -26, 920 * (1 - clamp((b.cratT - S.t) / (own ? b.fixD || 60 : 60), 0, 1)), bh);
    }
    if (vis && !dead && f < 1) {   // 耐久条（跑道外侧）；地勤抢修时右端闪一个琥珀色「＋」
      ctx.fillStyle = rgba(C0, .2); ctx.fillRect(-80, -44, 160, bh);
      ctx.fillStyle = rgba(C0, .85); ctx.fillRect(-80, -44, 160 * f, bh);
      if (b.fixing) { ctx.strokeStyle = rgba(COL.amber, (.5 + .4 * Math.sin(time * 6)) * a); ctx.lineWidth = Math.max(1, px(1.6)); ctx.beginPath(); ctx.moveTo(86, -43); ctx.lineTo(96, -43); ctx.moveTo(91, -48); ctx.lineTo(91, -38); ctx.stroke(); }
    }
    if (vis && dead && b.rb != null) {   // 重建：琥珀色进度条与跑道虚线框
      ctx.fillStyle = rgba(COL.amber, .2); ctx.fillRect(-120, -44, 240, bh);
      ctx.fillStyle = rgba(COL.amber, .85); ctx.fillRect(-120, -44, 240 * clamp(b.rb, 0, 1), bh);
      ctx.strokeStyle = rgba(COL.amber, (.35 + .25 * Math.sin(time * 4)) * a); ctx.lineWidth = px(1.4); ctx.setLineDash([px(6), px(5)]); ctx.strokeRect(-463, -18, 926, 36); ctx.setLineDash([]);
    }
    ctx.restore();
    // 受损过半 / 被毁：机库、塔台、油库、跑道中段起火，黑烟向东北飘（世界坐标）
    if (vis && (dead || f < .5)) for (const [u, v, k] of [[0, 256, .5], [-215, 136, .35], [270, 536, .25], [0, 0, 0]]) {
      if (!dead && f > k) continue;
      const [x, y] = eaW(b, u, v), fl = 9 + 3 * Math.sin(time * 9 + u), g = ctx.createRadialGradient(x, y, 0, x, y, fl);
      g.addColorStop(0, 'rgba(255,243,214,.85)'); g.addColorStop(.4, rgba(COL.amber, .7)); g.addColorStop(1, rgba(COL.enemy, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, fl, 0, 7); ctx.fill();
      for (let i = 0; i < 4; i++) {
        const ph = ((time * .22 + i / 4 + u * .01) % 1 + 1) % 1, sx = x + 12 + ph * 110, sy = y - 8 - ph * 60, r = 10 + ph * 28, sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        sg.addColorStop(0, rgba(COL.smoke, .2 * (1 - ph))); sg.addColorStop(1, rgba(COL.smoke, 0));
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
      }
    }
  }
}
// 沙盒放置预览：跑道、滑行道、停机坪、建筑轮廓与围栏（方向即开战后的跑道方向；颜色由调用方设好）
function afbPreview(ctx, x, y, f, lw) {
  const G = afbGeo(f.h || 0, f.s || 1);
  ctx.save(); ctx.translate(x, y); ctx.rotate(f.h || 0); ctx.scale(1, f.s || 1); ctx.lineWidth = lw;
  ctx.fill(G.rw); ctx.stroke(G.rw); ctx.stroke(G.TW); ctx.stroke(G.TL); ctx.stroke(G.apron); ctx.stroke(G.foot);
  ctx.setLineDash([lw * 4, lw * 3]); ctx.stroke(G.fence); ctx.setLineDash([]);
  ctx.restore();
}
// 3D 立体地图的建筑块（view3d.js）：看得见 / 已标定的机场与我方夺取的机场；世界坐标角点 + 高度（z0 起、z 止）
function afb3dBases() {
  if (!S || !S.enemies || typeof eaOn !== 'function' || !eaOn()) return [];
  const spec = specAll() || (typeof R === 'object' && R.eye === 'all');
  const out = S.enemies.filter(e => e.kind === 'airfield' && !e.dead && (spec || e.kx != null));
  if (S.abBase && !S.abBase.dead) out.push(S.abBase);
  return out;
}
const afb3dSig = () => afb3dBases().map(b => `${b.id}:${Math.round(b.x)},${Math.round(b.y)},${(b.rh || 0).toFixed(3)},${b.rs || 1}`).join('|');
function afb3dBlocks() {
  const out = [];
  for (const b of afb3dBases()) for (const k of afbGeo(b.rh || 0, b.rs || 1).blocks) out.push({ pts: k.pts.map(([u, v]) => eaW(b, u, v)), z: k.z, z0: k.z0 || 0, m: k.m, r: k.r, k: k.k, base: b.id });
  return out;
}

HOOK.drawGround.push(eaDrawBases);
HOOK.drawUnder.push(eaDrawBaseFx);
