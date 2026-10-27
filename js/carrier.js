'use strict';
// 航空母舰与舰载机联队：甲板弹射起飞、侦察 / 空袭 / 对地支援三种任务、防空火力、舰尾进近着舰与整备；
// 航母机动与受损（岸防炮可打）；绘制航母、甲板停机、飞机剪影（无文字）
// 任务类型（每种任务默认用哪个型号见 AIR_BASEM，变体见 AIR_VMODEL）；n = 战役默认架数
const AIR_SPEC = {
  recon: { name: '侦察机', n: 2, aa: .06, spd: 190, size: 17 },
  strike: { name: '攻击机', n: 4, aa: .09, spd: 180, size: 15 },
  cas: { name: '对地支援机', n: 4, aa: .09, spd: 170, size: 15 },
  bomber: { name: '轰炸机', n: 0, aa: .07, spd: 150, size: 22 },   // 沙盒购买：轰-6K（地毯轰炸）/ 攻击-11（俯冲精确投弹）
  fighter: { name: '战斗机', n: 2, aa: .05, spd: 230, size: 15 }   // 制空（airwar.js）：在指定空域巡逻，拦截敌机、夺取制空权
};
// 型号：名称、剪影、巡航速度、被高炮打中的基础概率、画面尺寸；land = 陆基（战区机场出动，从地图南缘飞来，不占航母机位，往返加油挂弹 100 秒）；
// stealth = 隐身（敌雷达发现距离、防空命中按此打折）；std = 防区外投放距离（精确制导炸弹 / 反辐射导弹）；aam / aamR / pkK = 空空导弹数、射程、命中修正；loiter = 盘旋秒数
const AIR_MDL = {
  kj600: { name: '空警-600 舰载预警机', sil: 'kj600', spd: 175, aa: .06, size: 19 },
  wz7: { name: '无侦-7 高空无人侦察机', sil: 'wz7', spd: 175, aa: .02, size: 19, land: true },   // 两万米高空，高炮够不着
  j35: { name: '歼-35 隐身舰载战斗机', sil: 'j35', spd: 240, aa: .09, size: 15, stealth: .4, std: 170, gbN: 6, arW: 'ft8', arR: 260 },   // 内埋 6 枚飞腾-8 小直径制导炸弹：先防区外打指定目标，余弹自主武装侦察（airArFly）
  j35s: { name: '歼-35 隐身舰载战斗机（防空压制型）', sil: 'j35', spd: 240, aa: .09, size: 15, stealth: .4, std: 300, sead: true, gbN: 4, arW: 'ld10', arR: 400 },   // 4 枚雷电-10 反辐射导弹，专打敌防空，余弹自主搜索防空
  j15t: { name: '歼-15T 舰载战斗机', sil: 'j15', spd: 225, aa: .09, size: 16, agm: 'kd88', agmN: 2, agmR: 380 },   // 2 枚 KD-88 空地导弹（防区外）
  gj11: { name: '攻击-11 隐身无人攻击机', sil: 'gj11', spd: 200, aa: .08, size: 16, stealth: .5 },
  h6k: { name: '轰-6K 轰炸机', sil: 'h6k', spd: 165, aa: .07, size: 24, land: true },
  gj2: { name: '攻击-2 察打一体无人机', sil: 'gj2', spd: 140, aa: .09, size: 17, land: true, loiter: 60, agm: 'ba7', agmN: 4, agmR: 320 },   // 长航时：盘旋 60 秒；4 枚蓝箭-7 空地导弹
  z10: { name: '直-10 武装直升机', sil: 'z10', spd: 110, aa: .09, size: 15, agm: 'hj10', agmN: 8, agmR: 280 },   // 8 枚红箭-10 反坦克导弹
  j20: { name: '歼-20 隐身战斗机', sil: 'j20', spd: 265, aa: .05, size: 17, land: true, stealth: .35, aam: 6, aamR: 560, pkK: 1.15 },   // 4 枚霹雳-15 + 2 枚霹雳-10
  // 彩蛋（j36.js）：歼-36。官方未公布参数，按公开估算：机长约 23 米、翼展约 19 米、最大起飞重量约 55 吨（歼-20 约 37 吨）、三发、主弹舱长约 7.6 米、作战半径约 3000 公里；
  //   体型大、无尾 → 转弯慢（turn）、不带航炮；全向隐身更好、机头大雷达看得更远（radar）、留空时间长（cap 秒）。挂载按弹舱尺寸推测：aamL / aamLR = 霹雳-17 远程空空导弹
  // 歼-50（外界称呼，沈飞第六代原型机，2024 年 12 月 26 日被拍到试飞；λ 形无尾翼、双发）：外界推测会发展舰载型。官方无任何参数，按公开估算——
  // 比歼-36 小、可上航母（占机库），隐身 0.22、雷达 800、6 枚霹雳-15 + 2 枚霹雳-10，不带航炮，只打超视距
  j50: { name: '歼-50 第六代舰载战斗机', sil: 'j50', spd: 290, aa: .03, size: 16, stealth: .22, aam: 8, aamR: 560, pkK: 1.18, radar: 800, turn: 1.9, gun: 0 },
  j36: { name: '歼-36 第六代战斗机（制空型）', sil: 'j36', spd: 300, aa: .02, size: 18, land: true, stealth: .2, aam: 6, aamR: 560, aamL: 2, aamLR: 900, pkK: 1.2, radar: 900, turn: 1.7, cap: 240, gun: 0 },
  j36s: { name: '歼-36 第六代战斗机（打击型）', sil: 'j36', spd: 300, aa: .02, size: 18, land: true, stealth: .2, aam: 4, aamR: 560, pkK: 1.2, radar: 900, turn: 1.7, cap: 240, gun: 0, agm: 'ls6', agmN: 4, agmR: 900 }
};
const AIR_BASEM = { recon: 'kj600', strike: 'j35', cas: 'gj2', bomber: 'h6k', fighter: 'j20' };
const AIR_VMODEL = { lr: 'wz7', dive: 'gj11', heavy: 'h6k', fb: 'j15t', heli: 'z10', sead: 'j35s', adv: 'j20', j36: 'j36', j36s: 'j36s', j50: 'j50' };   // adv：旧存档里的先进战斗机
const airMdlKey = (type, v) => AIR_VMODEL[v] || AIR_BASEM[type];
const airMdl = (type, v) => AIR_MDL[airMdlKey(type, v)] || {};   // 运输机（para.js）等没有型号表的返回空
const airSpec = (type, v) => ({ ...(AIR_SPEC[type] || AIR_SPEC.strike), ...airMdl(type, v) });
const airLandW = w => !!(w && airMdl(w.type, w.v).land);
const airStealth = o => { const b = (o && airMdl(o.kind || o.type, o.v).stealth) || 1; return o && o.exp > 0 && typeof awStl === 'function' ? awStl(o, b) : b; };   // 飞机（p.kind）或编队记录（w.type）；在敌雷达下待久了隐身打折（airwar.js awStl）
const AIR_REARM_LAND = 100;   // 陆基飞机：飞回战区机场加油挂弹再飞回来
const AIR_TYPES = ['recon', 'strike', 'cas', 'bomber', 'fighter'];
const AIR_TURN = 1.5;      // 最大转弯角速度（弧度/秒）：巡航转弯半径约 120
const AIR_REARM = 45;      // 着舰后整备时间（秒）
const AIR_TRAILS = new Map();   // 仅渲染用：飞机尾迹点（不进 S）
const CV_LEN = 316;
// 航母局部坐标：u 指向舰首，v 指向右舷（绘制时 rotate(heading) 后 x = u、y = v）。照 003 型福建舰（舷号 18）的真实尺寸与布局（1 单位约 1 米）：
//   全长 316、飞行甲板最宽 76、水线宽约 40；平直通长甲板、舰首较宽；舰首两条并列、斜角甲板腰部一条，共三条电磁弹射器（后面各一块偏流板）；
//   斜角着舰区与舰体中线约成 9.6°，三道拦阻索；右舷中后部一座紧凑的舰岛（一体化桅杆、四面相控阵雷达、尾部烟囱），
//   舰岛前、后各一部舷侧升降机（平台伸出舷外，降到机库甲板）；甲板停机位 9 个（右舷前后两排，机尾朝舷外），多出来的飞机在机库（cvdeck.js）
const CVG = {
  deck: [[158, 2], [156, 8], [150, 14], [140, 20], [120, 27], [96, 32], [70, 34], [17, 34], [17, 26], [-5, 26], [-5, 34],
    [-67, 34], [-67, 26], [-89, 26], [-89, 34], [-140, 33], [-152, 30], [-158, 22], [-158, -12], [-154, -18], [-130, -23], [-100, -28],
    [-60, -34], [-20, -38], [20, -41], [46, -42], [58, -40], [70, -33], [100, -26], [130, -22], [146, -18], [153, -11], [157, -4]],
  cats: [{ u: 50, v: -9, a: 0, L: 100 }, { u: 50, v: 9, a: 0, L: 100 }, { u: -30, v: -16, a: -.17, L: 88 }],   // 弹射器：起点、方向（相对舰首）、弹射行程
  land: { u0: -140, v0: 5, u1: 50, v1: -27, hw: 14 },   // 斜角着舰区中线（舰尾 → 左舷前方）、半宽
  td: .165, wires: [.13, .165, .2],                      // 接地点、三道拦阻索在着舰中线上的位置
  // 停机位 [u, v, 机头相对舰首的角度]：右舷前排 6 个、后排 3 个，机头朝舷内偏后、机尾伸向舷外
  slots: [[128, 21, -2.8], [109, 25, -2.8], [90, 26, -2.8], [71, 26, -2.8], [52, 26, -2.8], [33, 26, -2.8], [-100, 26, -2.8], [-119, 26, -2.8], [-138, 25, -2.8]],
  el: [{ u: 6, v: 35, L: 22, B: 18 }, { u: -78, v: 35, L: 22, B: 18 }],   // 舷侧升降机（舰岛前、后各一部）平台：中心、长、宽
  isl: [-52, -14, 23, 33], door: [-30, 22],   // 舰岛 [u0, u1, v0, v1]、舰岛内侧舱门（飞行员从这里出来）
  zd: 17, hang: 9,                            // 飞行甲板离水线的高度、机库甲板在飞行甲板下多深（3D）
  fires: [[-60, 10], [24, -18], [88, 8], [-116, -8]]
};
const CV_LLEN = Math.hypot(CVG.land.u1 - CVG.land.u0, CVG.land.v1 - CVG.land.v0);
const CV_LANG = Math.atan2(CVG.land.v1 - CVG.land.v0, CVG.land.u1 - CVG.land.u0);
// 飞机俯视剪影（半边轮廓，机头 +x，长、翼展均约 21；按真实机型的平面形状）
const AIR_SIL = {
  kj600: [[10, 0], [8.4, 1.2], [3, 1.4], [2.4, 10.5], [-.6, 10.5], [-1.2, 1.4], [-7, 1.1], [-7.8, 4.6], [-9.6, 4.6], [-9.4, .8], [-10, 0]],   // 上单翼双发涡桨 + 背负雷达圆盘
  wz7: [[9, 0], [7.4, 1], [3, 1.2], [-4.6, 9.8], [-5.8, 9.6], [-8.4, 2.4], [-10, 1], [-10.5, 0]],   // 菱形连翼（前翼后掠、后翼前掠在翼尖相接）
  j35: [[11, 0], [8.4, 1], [4, 1.7], [.8, 2.1], [-3.2, 7.6], [-5.2, 7.6], [-5.2, 2.6], [-7, 2.4], [-9.2, 5], [-10.6, 5], [-10.2, 1.6], [-11, 0]],   // 梯形翼 + 平尾，双发双垂尾
  j15: [[11.5, 0], [9, 1], [5, 1.4], [3, 2.7], [.2, 3], [-4, 9.2], [-5.6, 9.2], [-5, 3], [-7, 3], [-9.6, 6.6], [-11.2, 6.6], [-10.6, 2.4], [-11.6, 1.8], [-11.6, 0]],   // 侧卫系：大边条、后掠翼、双发
  j20: [[11.5, 0], [9.4, .8], [6.4, 1.3], [5.2, 1.4], [3.4, 4.4], [2.6, 4.4], [2.8, 1.6], [1.4, 1.8], [-6, 8.6], [-7.6, 8.6], [-6.6, 2.2], [-8.6, 2], [-10.8, 1.6], [-11.4, 0]],   // 鸭翼 + 三角翼，长机身
  gj11: [[8, 0], [5, 2], [-3, 10.5], [-5, 10.5], [-5.6, 8], [-3.6, 6], [-7, 3.4], [-9, 0]],   // 飞翼，W 形后缘
  gj2: [[9, 0], [8, .9], [1.6, 1], [1.1, 10.5], [-.8, 10.5], [-1.2, 1], [-7, .7], [-9.6, 3.6], [-10.6, 3.6], [-9.2, .5], [-10, 0]],   // 细长机身、大展弦比直翼、V 形尾翼
  h6k: [[11.5, 0], [10, 1.2], [4, 1.6], [2.4, 2.9], [-1, 11.2], [-3.1, 11.2], [-2.6, 3], [-6, 1.6], [-8.6, 4.6], [-10.2, 4.6], [-10, 1], [-11.5, 0]],   // 后掠中单翼，翼根两台发动机
  heli: [[8.6, 0], [8, 1], [5, 1.3], [1, 1.5], [.6, 1.6], [.4, 3.6], [-1.2, 3.6], [-1.4, 1.6], [-3.5, 1.1], [-10.5, .45], [-10.8, 2.4], [-12, 2.4], [-12.2, .4], [-12.8, 0]],   // 直-10：细长串列座舱机身、短翼、细尾梁、尾端平尾（旋翼另画）
  z10: [[8.6, 0], [8, 1], [5, 1.3], [1, 1.5], [.6, 1.6], [.4, 3.6], [-1.2, 3.6], [-1.4, 1.6], [-3.5, 1.1], [-10.5, .45], [-10.8, 2.4], [-12, 2.4], [-12.2, .4], [-12.8, 0]],
  ah64: [[8.4, 0], [7.8, 1], [5, 1.25], [2.4, 1.3], [1.6, 2.25], [.7, 2.35], [.55, 4.3], [-1.35, 4.3], [-1.45, 2.35], [-2.7, 2.15], [-3.7, .9], [-10.6, .45], [-10.9, 2.7], [-12.1, 2.7], [-12.2, .4], [-12.8, 0]],   // AH-64：两侧发动机短舱鼓出、短翼挂地狱火、尾端全动平尾
  uh60: [[8, 0], [7.4, 1.6], [4.5, 2.5], [-2, 2.5], [-4, 1.2], [-11, .55], [-11.2, 2.8], [-12.4, 2.8], [-12.5, .5], [-13, 0]],   // UH-60：宽机舱、长尾梁、尾端平尾
  transport: [[11.6, 0], [10.8, 1.1], [8.2, 1.7], [3, 1.8], [2.6, 1.8], [-3, 11.6], [-4.4, 11.6], [-1.6, 1.8], [-7.6, 1.5], [-8.6, 1.2], [-11, 5.4], [-12.1, 5.4], [-11.4, .7], [-12.4, 0]],   // 运-20：上单翼、四发、T 尾（翼展略大于机长）
  y20: [[11.6, 0], [10.8, 1.1], [8.2, 1.7], [3, 1.8], [2.6, 1.8], [-3, 11.6], [-4.4, 11.6], [-1.6, 1.8], [-7.6, 1.5], [-8.6, 1.2], [-11, 5.4], [-12.1, 5.4], [-11.4, .7], [-12.4, 0]],
  b2: [[5.6, 0], [4.8, .9], [-2.6, 11.4], [-3.5, 11.6], [-3.8, 11.1], [-1.2, 7.9], [-4.1, 4.7], [-2.1, 2.4], [-4.4, .7], [-4.4, 0]],   // B-2A：飞翼，前缘后掠 33°，后缘双 W 锯齿（翼展 52 米、机长 21 米）
  c17: [[11.4, 0], [10.6, 1.2], [8, 1.9], [2.6, 2], [2.2, 2], [-4.4, 10.9], [-4.6, 11.4], [-5.6, 11.2], [-1.4, 2], [-7.4, 1.6], [-8.4, 1.3], [-10.8, 5.2], [-12, 5.2], [-11.4, .8], [-12.2, 0]],   // C-17：后掠更大、翼梢小翼、T 尾
  // 守方（美军）
  f35: [[10.4, 0], [8, 1], [3.6, 1.8], [.4, 2.2], [-3.6, 7.2], [-5.4, 7.2], [-5.6, 2.4], [-7, 2.3], [-9, 4.6], [-10.2, 4.6], [-9.6, 1.4], [-10.6, 0]],   // 单发，菱形梯形翼，双垂尾
  a10: [[10, 0], [8, 1], [3.2, 1.2], [2.6, 9.4], [-.6, 9.4], [-1.2, 1.4], [-7, 1.3], [-8.4, 4.8], [-10.4, 4.8], [-10, 1], [-10.6, 0]],   // 平直下单翼，尾部背负双发、双垂尾
  f22: [[10.6, 0], [8.2, .9], [4.6, 1.8], [2.6, 2.4], [1.6, 2.6], [-2.8, 7.4], [-4.6, 7.4], [-6.1, 2.8], [-6.6, 2.6], [-8.6, 5.4], [-9.8, 5.4], [-10.1, 1.6], [-10.6, 1.2], [-10.6, 0]],   // 菱形翼（后缘前掠）、全动平尾、二元矢量喷管
  // 彩蛋
  j50: [[11, 0], [8.6, .9], [5, 1.8], [1.6, 2.4], [-4.4, 8.2], [-6, 8.2], [-5.4, 5.2], [-8.4, 3.4], [-10.2, 2.4], [-9.6, 0]],   // 歼-50：λ 形无尾翼，后缘锯齿
  j36: [[12.6, 0], [10.6, .8], [8.2, 1.6], [5.6, 2.6], [1, 5.4], [-5.8, 10.3], [-7.4, 10.3], [-6.4, 6], [-10.6, 2.8], [-11.6, 2.2], [-12.2, 1.2], [-12.2, 0]]   // 歼-36：无尾双菱形翼（翼尖切尖、后缘 W 形），机长 : 翼展约 23 : 19，与歼-20 同一比例尺
};
// 剪影键：按型号；守方 type（ga / heli / ftr / f22）另映射
const airSilKey = (type, v) => type === 'ga' ? 'a10' : type === 'ftr' ? 'f35' : AIR_SIL[type] && !AIR_BASEM[type] ? type : airMdl(type, v).sil || 'j35';
const airName = (type, v) => airMdl(type, v).name || (AIR_SPEC[type] || {}).name || '飞机';
// HUD 图标（24×24，描边风格，与 hud.js ICON 一致）
const CARRIER_ICONS = typeof WI === 'object' ? {   // 照真实机型画（icons.js）：福建舰、空警-600、歼-35、攻击-2、轰-6K、歼-20
  cv: WI.t003, recon: WI.kj600, strike: WI.j35, cas: WI.gj2, bomber: WI.h6k, fighter: WI.j20,
  airauto: '<path d="M12 5l1 3.5 5 4v1.5l-5-1.8-.3 3.3 1.8 1.3v1.2L12 17l-2.5 1v-1.2l1.8-1.3-.3-3.3-5 1.8v-1.5l5-4z"/><path d="M4.5 8.5A8.5 8.5 0 0 1 10 3.3M19.5 15.5A8.5 8.5 0 0 1 14 20.7"/>'
} : {};

const airAng = a => Math.atan2(Math.sin(a), Math.cos(a));
// 航母局部坐标 ↔ 世界坐标
function cvW(u, v, c) {
  c = c || S.cv;
  const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
  return [c.x + ch * u - sh * v, c.y + sh * u + ch * v];
}
function cvL(x, y, c) {
  c = c || S.cv;
  const dx = x - c.x, dy = y - c.y, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
  return [dx * ch + dy * sh, -dx * sh + dy * ch];
}
// 多艘航母（沙盒）：S.cv 为旗舰（母舰号 0），S.cvx 为其余航母（1..n）；舰载机与飞机以 home 记所属母舰
const cvHome = o => (o && o.home) || 0;
const cvOf = h => h ? (S.cvx && S.cvx[h - 1]) || null : S.cv;
const cvAll = () => [S.cv, ...(S.cvx || [])].filter(c => c && isFinite(c.x) && isFinite(c.y));
// 航母自卫火力（按辽宁 / 山东舰实装）：3 座 1130 型近防炮（内层 300 以内，能同时对付几个目标）+ 4 座红旗-10 近程防空导弹发射装置
// （共 72 枚，射程 320）——拦截来袭反舰导弹、打靠近的敌机；近防炮也打落向航母的炮弹（ciws.js）
const CV_DEF = { hq10: 72, hqR: 320, hqMin: 40, hqCd: .9, hqPk: .5, cwR: 300, cwPk: .6 };
function cvDefs() {
  return cvAll().filter(c => c.hp > 0 && c.x > -999).map((c, i) => { if (c.hq10 == null) c.hq10 = CV_DEF.hq10; return { o: c, x: c.x, y: c.y, id: 'CV' + i, cv: true }; });
}
// 甲板停机位（cvdeck.js 维护每架舰载机的 w.dk：机位序号，-1 在机库）：返回 Map(飞机 id → 机位序号)，只含停在甲板机位上待命 / 整备的飞机；
// wing = 这艘航母的全部舰载机
function cvPark(c, wing) {
  if (typeof cvSpots === 'function') cvSpots(c);
  const m = new Map();
  for (const w of wing) if ((w.state === 'deck' || w.state === 'rearm') && w.dk != null && w.dk >= 0 && CVG.slots[w.dk]) m.set(w.id, w.dk);
  return m;
}
// 临时把 S.cv 换成某艘航母执行 fn：复用以 S.cv 为准的起降、受损与绘制代码
function withCV(c, fn) { const keep = S.cv; S.cv = c; try { return fn(); } finally { S.cv = keep; } }
// 从 (x,y) 沿角度 a 延伸 len，但不越出地图（保持方向不变）
function airRay(x, y, a, len, m = 30) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let t = len;
  if (dx > 1e-6) t = Math.min(t, (W - m - x) / dx); else if (dx < -1e-6) t = Math.min(t, (m - x) / dx);
  if (dy > 1e-6) t = Math.min(t, (H - m - y) / dy); else if (dy < -1e-6) t = Math.min(t, (m - y) / dy);
  t = Math.max(0, t);
  return [x + dx * t, y + dy * t];
}

// —— 状态初始化：newGame 部署舰队后调用；从快照恢复时也可重复调用（只补缺） ——
function initCarrier() {
  if (!S) return;
  if (!S.cv || !isFinite(S.cv.x) || !isFinite(S.cv.y))
    S.cv = { x: W / 2, y: CARRIER_Y, tx: W / 2, ty: CARRIER_Y, heading: -Math.PI / 2, hp: 30, maxhp: 30, moving: false };
  const c = S.cv;
  if (!isFinite(c.heading)) c.heading = -Math.PI / 2;
  if (!isFinite(c.tx) || !isFinite(c.ty)) { c.tx = c.x; c.ty = c.y; c.moving = false; }
  if (!isFinite(c.maxhp) || c.maxhp <= 0) c.maxhp = 30;
  if (!isFinite(c.hp)) c.hp = c.maxhp;
  if (typeof cvDeckInit === 'function') cvDeckInit(c);   // 弹射器、偏流板、升降机（cvdeck.js）
  if (c.exposedUntil == null) c.exposedUntil = 0;
  if (c.hitT == null) c.hitT = -99;
  if (c.auto == null) c.auto = false;
  if (c.autoT == null) c.autoT = 2;
  if (Array.isArray(S.cvx)) S.cvx.forEach((x, i) => {   // 其余航母：补齐字段
    x.home = i + 1;
    if (!isFinite(x.heading)) x.heading = -Math.PI / 2;
    if (!isFinite(x.tx) || !isFinite(x.ty)) { x.tx = x.x; x.ty = x.y; x.moving = false; }
    if (!isFinite(x.maxhp) || x.maxhp <= 0) x.maxhp = 30;
    if (!isFinite(x.hp)) x.hp = x.maxhp;
    if (typeof cvDeckInit === 'function') cvDeckInit(x);
    if (x.exposedUntil == null) x.exposedUntil = 0;
    if (x.hitT == null) x.hitT = -99;
  });
  if (!S.air || !Array.isArray(S.air.wing)) {
    const wing = [];
    for (const type of AIR_TYPES) for (let k = 0; k < AIR_SPEC[type].n; k++) wing.push({ id: S.nid++, type, state: 'deck', rearmT: 0 });
    S.air = { wing, wrecks: [] };
  }
  if (!Array.isArray(S.air.wrecks)) S.air.wrecks = [];
  if (!Array.isArray(S.planes)) S.planes = [];
  if (!Array.isArray(S.recon)) S.recon = [];
  if (!S.assets) S.assets = {};
  // 旧版存档里的飞机（没有 phase）：沿原任务飞完，返航后直接消失
  for (const p of S.planes) if (!p.phase) {
    const tx = isFinite(p.tx) ? p.tx : p.x, ty = isFinite(p.ty) ? p.ty : p.y;
    Object.assign(p, { phase: p.dropped ? 'rtb' : 'out', heading: -Math.PI / 2, spd: 180, alt: 1, bank: 0, wid: null, tx, ty, cx: tx, cy: ty,
      wp: p.kind === 'recon' ? [{ x: tx, y: ty }, { x: tx, y: 40 }] : [{ x: tx, y: ty }], leg: 0, aaT: 0, rt: 0, gunT: 0, strafeT: 1, loiterT: 40, rtbT: 0 });
    if (!AIR_SPEC[p.kind]) p.kind = 'strike';
  }
  airCount();
}

// HUD 读取：各机型可出击（在甲板待命）的架数
function airCount() {
  const up = w => w.af ? typeof abAfOpen === 'function' && abAfOpen() : airLandW(w) || (() => { const c = cvOf(cvHome(w)); return c && c.hp > 0; })();   // 陆基飞机不看航母；停在夺取的机场上的要跑道能用（abn.js）
  for (const t of AIR_TYPES) S.assets[t] = S.air ? S.air.wing.filter(w => w.type === t && w.state === 'deck' && up(w)).length : 0;
}

const airWing = p => p.wid != null && S.air ? S.air.wing.find(w => w.id === p.wid) : null;
const AIR_WSTATE = { cat: 'launch', roll: 'launch', out: 'out', loiter: 'out', rtb: 'return', hold: 'return', final: 'return', trap: 'return' };
function airSet(p, phase) {
  p.phase = phase;
  const w = airWing(p);
  if (w && w.state !== 'lost') w.state = AIR_WSTATE[phase] || w.state;
}

// —— 出击：kind = recon / strike / cas；从甲板待命的飞机中派出一架 ——
// pref：想要的变体（如 'sead' 防空压制型歼-35）；没有就用同任务的其他型号
function launchPlane(kind, tx, ty, pref) {
  if (!S.cv || !S.air) initCarrier();
  const sp = AIR_SPEC[kind];
  if (!sp || !isFinite(tx) || !isFinite(ty)) return false;
  const cvOk = cvAll().some(c => c.hp > 0);
  if (!cvOk && !S.air.wing.some(o => o.type === kind && o.state === 'deck' && airLandW(o))) { log('航母飞行甲板瘫痪，舰载机无法起飞', 'warn', 'cvdead', 2); return false; }
  // 多艘航母时：从离目标最近、且有该机型待命的那艘起飞；陆基飞机从战区机场（地图南缘以外）飞来，算作稍远
  const want = pref || (kind === 'bomber' ? (S.enemies.some(e => !e.dead && e.kx != null && dist(e.kx, e.ky, tx, ty) < 40) ? 'dive' : 'heavy') : null);
  let w = null, bd = Infinity;
  for (const o of S.air.wing) if (o.type === kind && o.state === 'deck') {
    const land = airLandW(o), c = land ? null : cvOf(cvHome(o)), af = o.af && S.abBase;
    if (!land && !(c && c.hp > 0)) continue;
    if (o.af && !(typeof abAfOpen === 'function' && abAfOpen())) continue;   // 停在夺取的机场上、跑道用不了的起不来
    const d = (af ? dist(af.x, af.y, tx, ty) : land ? H - ty + 300 : dist(c.x, c.y, tx, ty)) + (want && (o.v || (kind === 'bomber' ? 'heavy' : null)) !== want ? 1e4 : 0) + (!land && !af && o.dk === -1 ? 60 : 0);   // 同一艘航母上先派甲板上的，机库里的要等升降机
    if (d < bd) { bd = d; w = o; }
  }
  if (!w) {
    const left = S.air.wing.filter(w => w.type === kind && w.state !== 'lost'), r = left.filter(w => w.state === 'rearm').map(w => w.rearmT);
    log(!left.length ? `${sp.name}已全部损失` : r.length ? `${sp.name}均在出击或整备中（最快 ${Math.ceil(Math.min(...r))} 秒）` : `${sp.name}均已升空`, 'warn', 'air' + kind, 2);
    return false;
  }
  if (w.af && typeof abTakeoff === 'function') return abTakeoff(w, kind, tx, ty);   // 从夺取的机场起飞（abn.js）
  return airLandW(w) ? launchLand(w, kind, tx, ty) : withCV(cvOf(cvHome(w)), () => launchFrom(w, kind, sp, tx, ty));
}
// —— 天上每一架飞机都是机库里的在册飞机（不再有不占机库的僚机、随队机）；护航、扫荡、防空压制也派在册飞机 ——
// 派一架在册战斗机护航：先改派在空巡逻、没接敌的，没有再从甲板 / 战区机场起飞一架；ex：护航标记（含巡逻中心 cx、cy 或跟随的 escOf）
function airEscFtr(tx, ty, ex) {
  const f = airFtrFree().sort((a, b) => dist(a.x, a.y, tx, ty) - dist(b.x, b.y, tx, ty))[0];
  if (f) { Object.assign(f, ex, { retask: true, capT: Math.max(f.capT || 0, ex.capT || 45) }); if (f.phase === 'loiter') airSet(f, 'out'); return f; }
  if (!airFtrDeck() || !launchPlane('fighter', clamp(tx, 60, W - 60), clamp(ty, 60, H - 60))) return null;
  return Object.assign(S.planes[S.planes.length - 1], ex);
}
// —— 对地出击：派一架在册的攻击机 / 对地支援机 / 轰炸机；敌机在活动（敌方掌握或争夺制空权、近 2 分钟见过敌机）、目标上空又没有我方战斗机时，
//    再派一架在册战斗机护航（先改派在空巡逻的）。轰炸机另编突击群（airBomberGroup）。返回出击的飞机（派不出时为 false） ——
const AIR_PKG = { strike: 2, cas: 2, bomber: 2 };
const airReady = kind => S.air.wing.some(o => o.type === kind && o.state === 'deck' && (airLandW(o) || (cvOf(cvHome(o)) || { hp: 0 }).hp > 0));
function airWingTgt(kind, tx, ty) {
  if (kind === 'cas') return [tx + gauss() * 25, ty + gauss() * 25];
  const own = (x, y) => S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, x, y) < 90);
  const e = S.enemies.filter(e => !e.dead && e.kx != null && dist(e.kx, e.ky, tx, ty) > 25 && dist(e.kx, e.ky, tx, ty) < 140 && !own(e.kx, e.ky)
    && !S.planes.some(p => !p.dead && p.kind === kind && dist(p.tx, p.ty, e.kx, e.ky) < 30)).sort((a, b) => dist(a.kx, a.ky, tx, ty) - dist(b.kx, b.ky, tx, ty))[0];
  return e ? [e.kx, e.ky] : [tx, ty];
}
function airPkg(kind, tx, ty, pref) {
  const G = kind === 'bomber' ? airBomberGate(tx, ty, pref) : null;
  if (kind === 'bomber' && !G) return false;
  if (!launchPlane(kind, tx, ty, pref)) return false;
  const lead = S.planes[S.planes.length - 1];
  lead.pkg = lead.id;
  if (kind === 'bomber') { airBomberGroup(lead, [lead], tx, ty, G); return lead; }
  const A = S.airw, threat = A && (A.st === 'e' || A.st === 'c' || S.t - (A.seenE ?? -1e9) < 120);
  const esc = kind !== 'fighter' && kind !== 'recon' && threat
    && !S.planes.some(p => !p.dead && p.kind === 'fighter' && ['cat', 'roll', 'out', 'loiter'].includes(p.phase) && dist(p.cx, p.cy, tx, ty) < 300)
    ? airEscFtr(tx, ty, { pkg: lead.id, esc: true, cx: clamp(tx, 60, W - 60), cy: clamp(ty, 60, H - 60) }) : null;
  if (esc) {
    if (typeof v8Stat === 'function') v8Stat('pkg');
    const nm = airName(kind, lead.v).split(' ')[0], en = airName('fighter', esc.v).split(' ')[0];
    log(`${nm}出击，${en}随队护航${esc.retask ? '（由空中巡逻改派）' : ''}`, 'info', 'airpkg', 4, { x: tx, y: ty });
    if (typeof chatSay === 'function') chatSay('p', `命令：${nm}出击${typeof cmdWhere === 'function' ? cmdWhere(tx, ty) : ''}，${en}随队护航，先清空目标上空敌机。`, { kind: 'order', at: { x: tx, y: ty }, key: 'airpkg', gap: 20, lv: 1 });
  }
  return lead;
}
// —— 轰炸机突击群（解放军体系作战：预警指挥 + 防空压制 + 制空护航 + 突击），都是在册飞机：
//    ① 先导扫荡：敌有歼击机、待命战斗机又有富余（3 架以上）时，先派一架飞到目标与敌机场之间的空域，清除敌歼击机；
//    ② 防空压制：目标 320 以内有已知敌防空、机库里有歼-35 防空压制型待命，先派去打掉（最多两架）；
//    ③ 随队护航：最多两架战斗机贴着轰炸机长机飞（awFlyP 读 p.escOf；先改派在空巡逻的，不够再起飞），敌机逼近轰炸机就迎击；
//    ④ 轰炸机先在敌防空圈外的待机点盘旋，扫荡到位、防空压掉（最多等 45 秒）再进入投弹航路（airHoldP）；
//    空中有空警-600 时护航机发现距离更远（airwar.js awAew）。
//    没有能起飞的护航机：请求排队，等护航机整备（最多 60 秒，airBomberQueue）；全军没有战斗机：只在我方掌握制空权、或敌方没有歼击机时出动 ——
const airFtrUp = () => S.air.wing.filter(w => w.type === 'fighter' && w.state !== 'lost');
const airFtrDeck = () => S.air.wing.filter(w => w.type === 'fighter' && w.state === 'deck' && !(w.af && !(typeof abAfOpen === 'function' && abAfOpen())) && (airLandW(w) || (cvOf(cvHome(w)) || { hp: 0 }).hp > 0)).length;
// 在空、没在接敌、弹药够的巡逻战斗机（可改派去护航轰炸机）
const airFtrFree = () => S.planes.filter(p => !p.dead && p.kind === 'fighter' && (p.phase === 'loiter' || p.phase === 'out') && !p.tg && !p.esc && p.escOf == null && !p.sweep && (p.aam || 0) >= 2 && p.alt > .5);
const airEFtr = () => !!(S.eair && (S.eair.wing.some(w => (w.type === 'ftr' || w.type === 'f22') && w.state !== 'lost') || S.eair.fly.some(a => !a.dead && (a.type === 'ftr' || a.type === 'f22'))));
// 目标 r 以内已知的敌防空（高炮阵地、防空车、近 2 分钟暴露过的单兵防空）
function airAAKnown(x, y, r) {
  const out = [];
  for (const e of S.enemies) if (!e.dead && (e.kind === 'aa') && e.kx != null && dist(e.kx, e.ky, x, y) < r) out.push({ x: e.kx, y: e.ky, k: 'enemy', id: e.id });
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && (v.type === 'aa_veh' || v.type === 'sam_veh') && (inVision(v.x, v.y) || (v.seen != null && S.t - v.seen < 60)) && dist(v.x, v.y, x, y) < r) out.push({ x: v.x, y: v.y, k: 'veh', id: v.id });
  if (typeof eaThreat === 'function' && eaThreat(x, y) >= 1) out.push({ x, y, k: 'manpads' });
  return out;
}
function airBomberGate(tx, ty, pref) {
  const say = (t, k) => { log(t, 'warn', 'bgate', 4, { x: tx, y: ty }); if (typeof chatSay === 'function') chatSay('p', t, { kind: 'report', at: { x: tx, y: ty }, key: 'bgate' + k, gap: 40, lv: 1 }); };
  if (!airFtrUp().length) {
    const A = S.airw;
    if (airEFtr() && !(A && A.st === 'p')) { say('轰炸机没有战斗机护航，敌歼击机仍在、我方未掌握制空权——轰炸机暂不出动，改由舰炮、导弹打击。', 'n'); return null; }
    return { noEsc: true };
  }
  if (airFtrDeck() || airFtrFree().length) { S.air.bq = null; return { noEsc: false }; }   // 有待命或在空巡逻的战斗机：护航随队出动
  const Q = S.air.bq;
  if (Q && S.t - Q.t > 60) { S.air.bq = null; return { noEsc: true, late: true }; }   // 等了一分钟：不再等，轰炸机按防区外方式出动
  if (!Q) {
    S.air.bq = { x: tx, y: ty, pref, t: S.t };
    const r = S.air.wing.filter(w => w.type === 'fighter' && w.state === 'rearm').map(w => w.rearmT);
    say(`轰炸机等护航战斗机一起出动（护航机整备中${r.length ? `，最快 ${Math.ceil(Math.min(...r))} 秒` : ''}）；最多等 60 秒。`, 'w');
  }
  return null;
}
// 排队的轰炸任务：每秒看一次护航机好了没有
function airBomberQueue(dt) {
  if (!S || S.phase !== 'battle' || S.over || !S.air || !S.air.bq) return;
  if ((S.air.bqT = (S.air.bqT || 0) - dt) > 0) return;
  S.air.bqT = 1;
  const Q = S.air.bq;
  if (!(S.assets.bomber > 0) || !airReady('bomber')) { S.air.bq = null; return; }
  if (airFtrDeck() || airFtrFree().length || S.t - Q.t > 60) airPkg('bomber', Q.x, Q.y, Q.pref);
}
function airBomberGroup(lead, fl, tx, ty, G) {
  const pk = lead.id, said = [];
  let nSw = 0, nEsc = 0, nSd = 0;
  const tag = (o, ex) => Object.assign(o, { pkg: pk }, ex);
  if (!G.noEsc) {
    const nf = airFtrDeck(), eF = airEFtr();
    // 先导扫荡：敌有歼击机、待命战斗机有三架以上（留两架护航）时，先派一架去目标与敌机场之间
    if (eF && nf >= 3) {
      const af = S.enemies.filter(e => e.kind === 'airfield' && !e.dead && e.kx != null).sort((a, b) => dist(a.kx, a.ky, tx, ty) - dist(b.kx, b.ky, tx, ty))[0];
      let sx = tx, sy = ty - 160;
      if (af) { const d = Math.max(1, dist(tx, ty, af.kx, af.ky)), k = Math.min(300, d * .45) / d; sx = tx + (af.kx - tx) * k; sy = ty + (af.ky - ty) * k; }
      sx = clamp(sx, 60, W - 60); sy = clamp(sy, 60, H - 60);
      if (launchPlane('fighter', sx, sy)) { tag(S.planes[S.planes.length - 1], { sweep: true, esc: true, capT: 75 }); nSw++; }
    }
    // 随队护航：最多两架贴着轰炸机长机——先改派在空巡逻、没接敌的，不够再起飞在册的
    for (let i = 0; i < 2; i++) { const f = airEscFtr(tx, ty, { pkg: pk, esc: true, escOf: pk, slot: nEsc + 1, odir: nEsc ? -1 : 1, capT: 45 }); if (!f) break; nEsc++; }
  }
  // 防空压制：目标附近已知敌防空，派歼-35 防空压制型先打（最多两架）
  const aa = airAAKnown(tx, ty, 320).filter(o => o.k !== 'manpads');
  for (const o of aa.slice(0, 2)) {
    if (!S.air.wing.some(w => w.type === 'strike' && w.v === 'sead' && w.state === 'deck') || !launchPlane('strike', o.x, o.y, 'sead')) break;   // 机库里待命的歼-35 防空压制型
    tag(S.planes[S.planes.length - 1], { seadP: true }); nSd++;
  }
  // 待机点：目标向我方一侧 330（避开已知防空圈），扫荡与压制完成前在这里盘旋
  if (nSw || nSd || nEsc) {   // 有护航就先在待机点会合
    let hx = tx, hy = Math.min(H - 60, ty + 330);
    const th = airAAKnown(tx, ty, 700);
    for (let i = 0; i < 8 && th.some(o => dist(o.x, o.y, hx, hy) < 260); i++) hy = Math.min(H - 40, hy + 50);
    for (const b of fl) b.hold = { x: clamp(hx + (b === lead ? 0 : 40), 40, W - 40), y: hy, t0: S.t, until: S.t + (nSd ? 50 : nSw ? 35 : 28), pkg: pk };
  }
  lead.pkg = pk;
  for (const b of fl) b.pkg = pk;
  if (typeof v8Stat === 'function') v8Stat('bomberPkg');
  if (typeof awStat === 'function') { awStat('bSweep', nSw); awStat('bEsc', nEsc); awStat('bSead', nSd); if (!nSw && !nEsc) awStat('bNoEsc'); }
  const fn = (S.planes.find(p => p.pkg === pk && p.kind === 'fighter') || {}).v, fnm = airName('fighter', fn).split(' ')[0], bnm = airName('bomber', lead.v).split(' ')[0];
  if (nSw) said.push(`${fnm} ${nSw} 架前出扫荡`);
  if (nSd) said.push(`歼-35 防空压制型 ${nSd} 架先打敌防空`);
  if (nEsc) said.push(`${fnm} ${nEsc} 架随队护航${S.planes.some(p => p.pkg === pk && p.retask) ? '（由空中巡逻改派）' : ''}`);
  if (awAewUp()) said.push('空警-600 预警引导');
  const txt = `突击群编成：${bnm} ${fl.length} 架${said.length ? '，' + said.join('，') : G.late ? '（护航机整备未完，轰炸机不进敌防空圈，投完立即脱离）' : '（敌无歼击机威胁，单独出动）'}`;
  log(txt, 'info', 'bpkg', 4, { x: tx, y: ty });
  if (typeof chatSay === 'function') chatSay('p', `命令：${txt}${lead.hold ? '。轰炸机先在防空圈外待机，扫荡与压制完成后进入投弹航路' : ''}。`, { kind: 'order', at: { x: tx, y: ty }, key: 'bpkg', gap: 15, lv: 1 });
}
const awAewUp = () => typeof awAew === 'function' && !!awAew();
// 轰炸机待机：扫荡机到位（巡逻或已接敌）、目标附近已知防空打掉、压制机投弹完毕，或待机时间到，才进入投弹航路
function airHoldP(p, dt, speed) {
  const H0 = p.hold, mates = S.planes.filter(o => !o.dead && o.pkg === H0.pkg);
  const sw = mates.filter(o => o.sweep), swOk = !sw.length || sw.some(o => o.phase === 'loiter' || o.tg);
  const sd = mates.some(o => o.seadP && o.phase === 'out' && !o.dropped);
  const aa = airAAKnown(p.tx, p.ty, 320).filter(o => o.k !== 'manpads').length;
  const es = mates.filter(o => o.escOf === H0.pkg), escOk = !es.length || es.some(o => dist(o.x, o.y, p.x, p.y) < 170);   // 护航机已到身边
  if (S.t > H0.until || (S.t - H0.t0 > 4 && swOk && !sd && !aa && escOk)) {
    p.hold = null;
    if (p.id === H0.pkg && typeof chatSay === 'function') chatSay('p', `报告：${escOk && es.length ? '护航机已会合，' : ''}${swOk ? (sw.length ? '扫荡机已控制目标空域' : '目标空域无敌机') : '扫荡未完'}${aa ? `，目标附近仍有 ${aa} 处敌防空` : '，敌防空已压制'}——轰炸机进入投弹航路。`, { kind: 'report', at: { x: p.tx, y: p.ty }, key: 'bhold', gap: 20, lv: 2 });
    return false;
  }
  p.alt = Math.min(1, p.alt + dt / 2.2);
  // 到待机点前正常飞；到了以后低速朝目标直飞（不盘旋），飞到防空圈边上（离目标比待机点近 260）还没放行就按时间到处理
  if (!H0.at && dist(p.x, p.y, H0.x, H0.y) < 130) { H0.at = true; H0.d0 = dist(H0.x, H0.y, p.tx, p.ty); }
  if (!H0.at) { speed(150); airSteer(p, H0.x, H0.y, dt); return true; }
  speed(110); airSteer(p, p.tx, p.ty, dt);
  if (dist(p.x, p.y, p.tx, p.ty) < H0.d0 - 260) H0.until = Math.min(H0.until, S.t);
  return true;
}
// —— 对地支援的真实战法：不在目标上空绕圈等着挨打——
//   待机点选在目标周围、已知防空圈之外（有空地导弹的取导弹射程的八成五，否则 220），在那里盘旋 / 悬停；
//   有空地导弹：在待机点防区外发射；目标附近没有已知防空时才进入一次扫射航路（冲过去打一次，立即拉起回待机点，7 秒后才能再来）；
//   攻击-2 无人机在中空待机（单兵防空、高炮够不着）；直-10 悬停发射红箭-10，每打两发换一个悬停点；
//   导弹告警：放干扰弹、转向背离来袭方向、放弃这次攻击航路；目标附近防空太强、又没有导弹可用：直接返航，不去送 ——
function airCasHold(p) {
  const M = airMdl(p.kind, p.v), uav = !p.v || p.v === 'gj2', heli = p.v === 'heli';
  let T = (heli && typeof heliT === 'function' ? heliT('p', p) : typeof airThreats === 'function' ? airThreats('p') : []).filter(t => dist(t.x, t.y, p.cx, p.cy) < t.r + 600);   // 直升机：连机组自己挨打记下的火力点一起算（airwar.js）；按圈的半径筛，远程防空（爱国者）圆心远也照样覆盖目标区
  if (uav) T = T.filter(t => t.k === 'ship' || t.r >= 400);   // 中空：只怕防空导弹
  const R = M.agmR ? M.agmR * .85 : 220, home = { x: p.cx, y: Math.min(H - 40, p.cy + 400) };
  p.hop = (p.hop || 0);
  if (heli && typeof heliSpot === 'function') {   // 直-10：悬停点必须完全在已知防空圈外（红箭-10 射程内放远一点也行），找不到就不进去
    const sp = heliSpot(p.cx, p.cy, R, (M.agmR || 280) * .97, T, home.x + Math.sin(p.hop * 1.7) * 300, home.y, (x, y) => coverAt(x, y) * 2);
    p.noSafe = !sp;
    p.hp = sp ? { x: sp.x, y: sp.y, risk: 0, t: S.t } : { x: home.x, y: home.y, risk: 9, t: S.t };
  } else {
    const sp = airSafePos(p.cx, p.cy, R, T, home.x, home.y, 50, null) || { x: home.x, y: home.y, risk: 0 };
    p.hp = { x: sp.x, y: sp.y, risk: sp.risk, t: S.t };
  }
  p.tRisk = typeof airThreatAt === 'function' ? airThreatAt(T, p.cx, p.cy, 30) : 0;
}
// 直升机：目标周围没有防空圈外的悬停点（或挨打两次）就返航，不硬闯
function airHeliAbort(p, why) {
  log(`直-10：${why}，返航`, 'warn', 'heliab' + p.id, 20, p);
  if (typeof v8Stat === 'function') v8Stat('heliAbort');
  airSet(p, 'rtb');
}
// 直升机飞向 (x, y)：直线穿过已知防空圈就先飞绕行点（airwar.js heliVia）
function airHeliGo(p, x, y, dt, hard) {
  const v = typeof heliVia === 'function' ? heliVia(p.x, p.y, x, y, heliT('p', p).filter(t => dist(t.x, t.y, p.x, p.y) < t.r + 900)) : null;
  if (v) { airSteer(p, v.x, v.y, dt, true); return Infinity; }
  return airSteer(p, x, y, dt, hard);
}
function airCasFly(p, dt, speed) {
  const M = airMdl(p.kind, p.v), sp = airSpec(p.kind, p.v), uav = !p.v || p.v === 'gj2', heli = p.v === 'heli';
  if (!p.hp || S.t - p.hp.t > 6) airCasHold(p);
  if ((p.loiterT -= dt) <= 0) { airSet(p, 'rtb'); return; }
  p.alt = Math.min(uav ? 1 : heli ? .3 : .85, p.alt + dt / 2);
  // 导弹告警：放干扰弹、背离来袭方向全速脱离 3 秒，放弃本次航路
  if (typeof airMslWarn === 'function' && airMslWarn('p', 'plane', p.id)) {
    if (heli && typeof heliShotAt === 'function') { const m = S.missiles.find(o => o.kind === 'sam' && o.side === 'e' && !o.done && o.tgt && o.tgt.k === 'plane' && o.tgt.id === p.id); if (m) heliShotAt(p, m.x0, m.y0, 280, 1); }   // 记下导弹从哪儿打来的
    if (!(p.brk > S.t)) { p.brk = S.t + 3; p.run = null; if (typeof v8Stat === 'function') v8Stat('casBreak'); if (typeof MSV === 'object') MSV.fl.push({ x: p.x, y: p.y, t: S.t }); log(`${airName(p.kind, p.v).split(' ')[0]}导弹告警：放干扰弹、机动规避`, 'warn', 'casbrk' + p.id, 8, p); }
  }
  if (p.brk > S.t) {
    const m = S.missiles.find(o => o.kind === 'sam' && o.side === 'e' && !o.done && o.tgt && o.tgt.k === 'plane' && o.tgt.id === p.id), a = m ? Math.atan2(p.y - m.y, p.x - m.x) : p.heading;
    speed(sp.spd * 1.1); airSteer(p, clamp(p.x + Math.cos(a) * 300, 30, W - 30), clamp(p.y + Math.sin(a) * 300, 30, H - 30), dt, true);
    if (S.t > p.brk - .1) { airCasHold(p); if (heli && ((p.shotN || 0) >= HELI.hits || p.noSafe)) { airHeliAbort(p, (p.shotN || 0) >= HELI.hits ? '两次遭敌防空火力射击' : '周边都在敌防空火力覆盖下'); return; } }
    return;
  }
  // 直升机遭地面火力射击（高炮、机枪）：换一个避开火力点的悬停点；挨打两次返航
  if (heli && p.shotT != null && S.t - p.shotT < .6 && p.shotSeen !== p.shotT) {
    p.shotSeen = p.shotT; airCasHold(p);
    if ((p.shotN || 0) >= HELI.hits || p.noSafe) { airHeliAbort(p, (p.shotN || 0) >= HELI.hits ? '两次遭敌防空火力射击' : '周边都在敌防空火力覆盖下'); return; }
  }
  const hasAgm = M.agm && p.agmN > 0, gun = !uav && !heli;
  // 目标附近防空太强、手上又没有防区外武器：返航
  if (!hasAgm && p.tRisk >= 1.5 && !p.run) { log(`${airName(p.kind, p.v).split(' ')[0]}：目标上空防空太强，无防区外武器，返航`, 'warn', 'casrtb' + p.id, 20, p); if (typeof v8Stat === 'function') v8Stat('casAbort'); airSet(p, 'rtb'); return; }
  // 扫射航路：冲向目标、近距扫射一次、立即拉起回待机点
  if (p.run) {
    speed(sp.spd); const d = airSteer(p, p.run.x, p.run.y, dt, true);
    if (d < 70 && !p.run.shot) { p.run.shot = true; casStrafe(p); if (p.wave == null) p.wave = S.t; if (typeof v8Stat === 'function') v8Stat('casRun'); }
    if (p.run.shot && d > 120 || S.t - p.run.t > 9) { p.run = null; p.runCd = S.t + 7; }
    return;
  }
  const fired = airAgm(p);
  if (fired && p.wave == null) p.wave = S.t;
  // 打完一波就返航：第一次开火后，固定翼再打 6 秒（把这一波的导弹打完）、直升机打完 4 发，然后返航，不在目标区上空兜圈子等下一个目标
  if (p.wave != null && !p.run && (heli ? (p.wv0 ?? (p.wv0 = (p.agmN || 0) + 1)) - (p.agmN || 0) >= 4 || !(p.agmN > 0) && !(p.ammoG > 0) || S.t - p.wave > 16 : S.t - p.wave > 6)) { airSet(p, 'rtb'); return; }
  // 直-10：没有导弹目标（或导弹打光）时，悬停用 23 毫米机炮打目标一带的步兵和火力点（射程 280 内，每 2.5 秒一个点射）
  if (heli && !fired && S.t >= (p.gunT2 || 0) && (p.ammoG ?? (p.ammoG = 12)) > 0) {
    const sv = { x: p.x, y: p.y }, near = [...S.teams.filter(q => q.side === 'e' && q.men.length && inVision(q.x, q.y)), ...S.enemies.filter(e => !e.dead && inVision(e.x, e.y))].some(o => dist(o.x, o.y, sv.x, sv.y) < 280 && dist(o.x, o.y, p.cx, p.cy) <= 160);
    if (near && casStrafe(p)) { p.ammoG--; p.gunT2 = S.t + 2.5; if (p.wave == null) p.wave = S.t; }
  }
  if (gun && S.t >= (p.runCd || 0) && p.tRisk < .5) {
    let best = null, bd = 1e9;
    const pT = S.teams.filter(q => q.side === 'p' && q.men.length);
    for (const q of S.teams) if (q.side === 'e' && q.men.length && dist(q.x, q.y, p.cx, p.cy) <= 160 && inVision(q.x, q.y) && !pT.some(o => dist(o.x, o.y, q.x, q.y) <= 45)) { const d = dist(q.x, q.y, p.x, p.y); if (d < bd) { bd = d; best = q; } }
    for (const e of S.enemies) if (!e.dead && dist(e.x, e.y, p.cx, p.cy) <= 160 && inVision(e.x, e.y)) { const d = dist(e.x, e.y, p.x, p.y); if (d < bd) { bd = d; best = e; } }
    if (best) { p.run = { x: best.x, y: best.y, t: S.t }; return; }
  }
  if (heli) {   // 悬停：到了就停住、机头对准目标；每打两发换个悬停点
    const d = dist(p.x, p.y, p.hp.x, p.hp.y);
    if (d > 18) { speed(sp.spd * .8); airHeliGo(p, p.hp.x, p.hp.y, dt, true); }
    else { speed(0); const want = Math.atan2(p.cy - p.y, p.cx - p.x); p.heading += clamp(Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading)), -1.5 * dt, 1.5 * dt); p.bank = 0; }
    if (p.agmN != null) { if (p.n0 == null) p.n0 = p.agmN; if (p.n0 - p.agmN >= 2) { p.n0 = p.agmN; p.hop++; airCasHold(p); if (typeof v8Stat === 'function') v8Stat('heliHop'); } }
    return;
  }
  // 固定翼：在待机点沿岸线方向直飞一段搜索目标（不盘旋），飞完还没找到可打的就返航
  if (!p.leg2) p.leg2 = atoLeg(p, p.hp.x, p.hp.y, ATO_LEG.cas);
  speed(uav ? 120 : 140);
  if (airSteer(p, p.leg2.x, p.leg2.y, dt) < 70) { if (p.wave == null) log(`${airName(p.kind, p.v).split(' ')[0]}任务区内没有发现可打的目标，返航`, 'info', 'casnone', 15, p); airSet(p, 'rtb'); }
}
// 新飞机的公共字段
function airNew(w, kind, x, y, heading, tx, ty, extra) {
  const M = airMdl(kind, w.v), p = { id: S.nid++, wid: w.id, home: cvHome(w), kind, v: w.v || null, x, y, heading, spd: 0, alt: 0, bank: 0,
    tx, ty, cx: tx, cy: ty, wp: [{ x: tx, y: ty }], leg: 0, aaT: Math.random() * .5, rt: 0, gunT: 0, strafeT: 1, loiterT: M.loiter || 40, odir: 1, dropped: false, rtbT: 0, ...extra };
  if (kind === 'recon') { const a = Math.atan2(ty - y, tx - x), [bx, by] = airRay(tx, ty, a, 700); p.wp.push({ x: bx, y: by }); }   // 侦察机：飞越目标后沿同一方向再向纵深飞 700
  if (kind === 'fighter') Object.assign(p, { aam: M.aam || 4, gun: M.gun ?? 40, capT: M.cap || 90, aamR: M.aamR || 480, pkK: M.pkK || 1, aamL: M.aamL || 0, aamLR: M.aamLR || 0, radar: M.radar || 520, aam0: (M.aam || 4) + (M.aamL || 0) });   // 空空导弹 · 机炮点射次数 · 巡逻秒数 · 远程弹 · 机载雷达（airwar.js）
  if (M.agm) p.agmN = M.agmN;   // 空地导弹（airAgm）
  return p;
}
// 陆基飞机（歼-20、轰-6K、无侦-7、攻击-2）：从战区机场起飞，由地图南缘进入战场
function launchLand(w, kind, tx, ty) {
  tx = clamp(tx, 10, W - 10); ty = clamp(ty, 10, H - 10);
  const x = clamp(tx + gauss() * 120, 60, W - 60), M = airMdl(kind, w.v);
  const p = airNew(w, kind, x, H + 10, -Math.PI / 2, tx, ty, { phase: 'out', land: true, alt: 1, spd: M.spd || AIR_SPEC[kind].spd });
  S.planes.push(p);
  w.state = 'out';
  airCount();
  log(`${airName(kind, w.v)}从战区机场起飞，目标方位 ${fmtBrg(bearing(x, H, tx, ty))}`, 'info', 'airup', 1.5);
  return true;
}
// 舰载机出动：从甲板机位（飞行员先登机）或机库（升降机升上来）出发，滑到所派的弹射器弹射起飞（甲板作业见 cvdeck.js）
function launchFrom(w, kind, sp, tx, ty) {
  const c = S.cv;
  tx = clamp(tx, 10, W - 10); ty = clamp(ty, 10, H - 10);
  const st = cvLaunchStart(c, w), [x, y] = cvW(st.lu, st.lv);
  const p = airNew(w, kind, x, y, c.heading + st.lh, tx, ty, { phase: 'cat', dkT: 0, ...st });
  if (p.dk === 'brd') Object.assign(p, cvPilotPlan(p));
  p.cat = cvPickCat(c, p);
  S.planes.push(p);
  w.state = 'launch';
  airCount();
  log(`${airName(kind, w.v)}${p.dk === 'lift' ? '由升降机从机库升上甲板，' : '飞行员登机，'}准备弹射起飞，目标方位 ${fmtBrg(bearing(c.x, c.y, tx, ty))}`, 'info', 'airup', 1.5);
  return true;
}

// —— 每个推演步：航母机动、自动派机、整备、各架飞机飞行与任务、防空火力 ——
function updatePlanes(dt) {
  if (!S.cv || !S.air) initCarrier();
  updateCarrier(dt);
  updateAirAuto(dt);
  airBomberQueue(dt);
  for (const w of S.air.wing) if (w.state === 'rearm' && (w.rearmT -= dt) <= 0) {
    w.state = 'deck'; w.rearmT = 0;
    if (airLandW(w)) log(`${airName(w.type, w.v)}在${w.af ? '夺取的机场' : '战区机场'}加油挂弹完毕，可以再次出击`, 'good', 'rearm' + w.type + (w.v || ''), 8);
    else if (S.cv.hp > 0) log(`${airName(w.type, w.v)}整备完毕`, 'good', 'rearm' + w.type + (w.v || ''), 8);
  }
  for (const p of S.planes) {
    if (p.dead) continue;
    if (p.kind === 'transport') {   // 战区运输机（para.js）：不归航母，照样挨高炮
      if (typeof paFly === 'function') paFly(p, dt); else p.dead = true;
      if (!p.dead && p.alt > .4) airAA(p, dt);
      continue;
    }
    let c = cvOf(cvHome(p)) || S.cv;
    if (!p.land && c.hp <= 0 && p.phase !== 'cat' && p.phase !== 'roll') {   // 母舰瘫痪：改降其他还能起降的航母
      const alt = cvAll().find(o => o.hp > 0), w = airWing(p);
      if (alt) { p.home = cvHome(alt); if (w) w.home = p.home; c = alt; }
    }
    withCV(c, () => flyPlane(p, dt));
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.heading)) { airAbort(p); continue; }   // 防御：数值异常直接收回
    if (!p.dead && p.alt > .4) airAA(p, dt);
  }
  S.planes = S.planes.filter(p => !p.dead);
  for (const w of S.air.wrecks) if (!w.hit && S.t - w.t >= 2.2) {   // 残骸坠地
    w.hit = true;
    const [x, y] = airWreckPos(w, 2.2);
    S.fx.push({ kind: isLand(x, y) ? 'boom' : 'flash', x, y, r: 14, life: 0, max: .8, side: 'p' });
  }
  S.air.wrecks = S.air.wrecks.filter(w => S.t - w.t < 2.6);
  airCount();
}

// 转向飞行：限制角速度；固定目标落在转弯圈内时先直飞拉开（带回差，避免贴着转弯圈绕圈）
// free：追踪前方移动的引导点（盘旋、最后进近）时不做此判断
// 飞机的地速：速度表（spd）乘 AIR_K——空中的飞机比原来慢一半（离地 / 着舰前后逐渐过渡到真实速度，起降滑跑不变）
const AIR_K = .5;
const airK = o => !o || o.alt == null || o.alt >= .25 ? AIR_K : lerp(1, AIR_K, clamp(o.alt / .25, 0, 1));
// 平滑转向（双方所有飞机共用）：想要的角速度按航向偏差成比例（快对准时自然收小，不过冲、不来回摆），
//   角速度的变化有上限（压坡度、改出都要时间）——航迹是连续的圆弧，不走折线 / 波浪；返回这一步转过的角度
function airYaw(o, df, rate, dt) {
  const w = Math.abs(df) < .004 ? 0 : clamp(df * 2.2, -rate, rate), a = rate * 2.6 * dt, h = o.hr || 0;
  o.hr = clamp(w, h - a, h + a);
  return o.hr * dt;
}
function airSteer(p, tx, ty, dt, free) {
  const d = dist(p.x, p.y, tx, ty), df = airAng(Math.atan2(ty - p.y, tx - p.x) - p.heading), k = airK(p), spd = Math.max(20, p.spd) * k;
  let want = df;
  if (!free && Math.abs(df) > .15) {   // 目标在转弯圆里面：先直飞拉开距离再转，不绕着目标打转
    const r = spd / AIR_TURN, s = df > 0 ? 1 : -1, ox = p.x - Math.sin(p.heading) * r * s, oy = p.y + Math.cos(p.heading) * r * s;
    if (dist(ox, oy, tx, ty) < r * (p.ext ? 1.4 : 1.02)) { want = 0; p.ext = true; } else p.ext = false;
  } else p.ext = false;
  const turn = airYaw(p, want, AIR_TURN, dt);
  p.heading = airAng(p.heading + turn);
  p.bank = lerp(p.bank || 0, clamp(p.hr / AIR_TURN, -1, 1), Math.min(1, dt * 6));
  p.x += Math.cos(p.heading) * p.spd * k * dt; p.y += Math.sin(p.heading) * p.spd * k * dt;
  return d;
}
// 待机 / 巡逻：跑马场航线（ato.js atoRace：两头转弯、中间直飞，长边与海岸线平行），不在空中原地打转
function airOrbit(p, cx, cy, R, dir, dt) {
  const d = dist(p.x, p.y, cx, cy);
  if (d > R * 2.6) return airSteer(p, cx, cy, dt);
  if (typeof atoRace === 'function') return atoRace(p, cx, cy, R, dir, (x, y) => airSteer(p, x, y, dt, true));
  const a = Math.atan2(p.y - cy, p.x - cx) + dir * .55;
  return airSteer(p, cx + Math.cos(a) * R, cy + Math.sin(a) * R, dt, true);
}
// 着舰几何：斜角甲板中线方向与接地点（随航母移动）
function cvLanding() {
  const L = CVG.land, a = S.cv.heading + CV_LANG, [x, y] = cvW(lerp(L.u0, L.u1, CVG.td), lerp(L.v0, L.v1, CVG.td));
  return { x, y, a, dx: Math.cos(a), dy: Math.sin(a) };
}
// 着舰区占用：有飞机在最后进近、刚着舰还没滑出着舰区，或者在着舰区里滑行 / 在腰部弹射器上（cvdeck.js cvFoul）
const cvDeckBusy = p => S.planes.some(o => o !== p && !o.dead && cvHome(o) === cvHome(p) && (o.phase === 'final' || (typeof cvFoul === 'function' ? cvFoul(o) : o.phase === 'trap')));

function flyPlane(p, dt) {
  const c = S.cv, sp = airSpec(p.kind, p.v), dead = c.hp <= 0, M = airMdl(p.kind, p.v);
  const speed = v => { p.spd += clamp(v - p.spd, -70 * dt, 45 * dt); };
  p.gunT = Math.max(0, (p.gunT || 0) - dt);
  if (p.afPh && typeof abPlaneFly === 'function' && abPlaneFly(p, dt, speed)) return;   // 在夺取的机场起降（abn.js）
  if (!Array.isArray(p.wp) || !p.wp.length) p.wp = [{ x: isFinite(p.tx) ? p.tx : p.x, y: isFinite(p.ty) ? p.ty : p.y }];
  // 甲板阶段（cvdeck.js，甲板局部坐标、随航母移动）：飞行员登机 / 升降机升上来 → 滑到弹射器 → 挂弹射杆、加力 → 弹射滑跑离舰；
  //   着舰：拦阻索拉停 → 滑回甲板机位，甲板停满就倒上升降机降进机库
  if (p.phase === 'cat' || p.phase === 'roll') {
    if (dead) { airAbort(p); return; }
    cvLaunchStep(p, c, dt);
    return;
  }
  if (p.phase === 'trap') { cvTrapStep(p, c, dt); return; }
  // 编队与航线（ato.js）：僚机保持在长机右后 / 左后；长机先飞到岸线进入口（起飞后放慢等僚机集合）
  if (typeof atoFormP === 'function' && p.lead != null && (p.phase === 'out' || (p.kind === 'fighter' && p.phase === 'loiter'))) {
    if (p.kind === 'fighter' && typeof awFight === 'function') awFight(p, 'p', dt);   // 僚机也一直搜索敌机，接敌就散开
    if (atoFormP(p, dt, speed)) return;
  }
  if (p.phase === 'out' && typeof atoIngressP === 'function' && atoIngressP(p, dt, speed)) return;
  if (p.kind === 'fighter' && (p.phase === 'out' || p.phase === 'loiter') && typeof awFlyP === 'function') { awFlyP(p, dt, speed); return; }   // 战斗机巡逻 / 拦截（airwar.js）
  if (p.phase === 'out') {
    p.alt = Math.min(1, p.alt + dt / 2.2); speed(sp.spd);
    if (p.kind === 'recon') {
      const wp = p.wp[Math.min(p.leg, p.wp.length - 1)], d = airSteer(p, wp.x, wp.y, dt);
      const ahead = (wp.x - p.x) * Math.cos(p.heading) + (wp.y - p.y) * Math.sin(p.heading);
      if (d < 45 || (ahead < 0 && d < 160)) p.leg++;
      if (p.y < STAGING_Y && (p.rt -= dt) <= 0) { p.rt = .2; S.recon.push({ x: p.x, y: p.y, until: S.t + 25 }); }
      if (p.leg >= p.wp.length) airSet(p, 'rtb');
    } else if (p.kind === 'strike' || p.kind === 'bomber') {
      if (p.hold && !p.dropped && airHoldP(p, dt, speed)) return;   // 突击群：防空圈外待机
      if (p.asm && !p.dropped && typeof navyPlaneAsm === 'function' && navyPlaneAsm(p, dt, speed)) return;   // 挂反舰导弹打敌舰（navy.js）
      const dive = p.kind === 'bomber' && p.v === 'dive', heavy = p.kind === 'bomber' && !dive, std = p.kind === 'strike' && M.std;   // 歼-35：防区外投放精确制导弹药
      if (std && p.gbN == null) { p.gbN = M.gbN || 2; p.acx = p.tx; p.acy = p.ty; p.arLeft = 50; }
      if (p.ar) { airArFly(p, dt, speed, M, sp); return; }   // 歼-35 自主武装侦察
      if (!p.dropped) {
        const df = Math.abs(airAng(Math.atan2(p.ty - p.y, p.tx - p.x) - p.heading)), d = airSteer(p, p.tx, p.ty, dt);
        if (dive && d < 280 && df < .5) { p.diving = true; speed(235); p.alt = Math.max(.32, p.alt - dt * .9); }   // 俯冲：压低高度加速
        if (std ? d < M.std && df < .3 : dive ? d < 42 : heavy ? d < 95 && df < .3 : d < 80 && df < .35) (std ? guidedDrop : p.kind === 'bomber' ? bomberDrop : strikeDrop)(p);
      } else if (p.std) {   // 投完立即掉头，不飞进敌防空圈；弹舱还有弹就转入自主武装侦察
        airSteer(p, p.x - Math.cos(p.heading) * 300, Math.min(H - 40, p.y + 300), dt, true);
        if ((p.egT -= dt) <= 0) { if (M.gbN && p.gbN > 0) { p.ar = true; p.arT = 0; } else airSet(p, 'rtb'); }
      } else {
        airSteer(p, p.x + Math.cos(p.heading) * 200, p.y + Math.sin(p.heading) * 200, dt);
        if ((p.egT -= dt) <= 0) { p.diving = false; airSet(p, 'rtb'); }
      }
    } else {
      // 对地支援：先飞到任务区外的待机点（避开已知防空圈），到了转入待机（airCasFly）
      if (!p.hp) { Object.assign(p, { cx: p.tx, cy: p.ty, loiterT: M.loiter || 40, strafeT: .8 }); airCasHold(p); }
      const heli = p.v === 'heli';
      if (heli && S.t - p.hp.t > 3) airCasHold(p);   // 直升机途中每 3 秒按新发现的防空重算悬停点
      if (heli && p.noSafe) { airHeliAbort(p, '目标周边都在敌防空火力覆盖下，找不到安全的悬停发射位置'); return; }
      const d = heli ? airHeliGo(p, p.hp.x, p.hp.y, dt) : airSteer(p, p.hp.x, p.hp.y, dt);
      if (dist(p.x, p.y, p.tx, p.ty) < (M.agmR || 0) + 60 && airAgm(p) && p.wave == null) p.wave = S.t;   // 进入导弹射程就先发射，不必等飞临目标上空
      if (d < 70) { const cross = Math.cos(p.heading) * (p.hp.y - p.y) - Math.sin(p.heading) * (p.hp.x - p.x); p.odir = cross >= 0 ? 1 : -1; airSet(p, 'loiter'); }
    }
    return;
  }
  if (p.phase === 'loiter') { airCasFly(p, dt, speed); return; }
  if (p.phase === 'rtb' && p.v === 'heli' && typeof heliVia === 'function' && c && isFinite(c.x)) {   // 直升机返航也绕开已知防空圈（先出圈）
    const v = heliVia(p.x, p.y, c.x, c.y, heliT('p', p).filter(t => dist(t.x, t.y, p.x, p.y) < t.r + 900));
    if (v) { speed(sp.spd); airSteer(p, v.x, v.y, dt, true); return; }
  }
  if (p.phase === 'rtb' && typeof atoEgressP === 'function' && atoEgressP(p, dt, speed)) return;   // 返航先走出口（ato.js），不原路折返
  if (p.land) {   // 陆基飞机：向南飞出地图，回战区机场加油挂弹（100 秒后再出击）；夺取了敌机场、有油料就改降那里（abn.js）
    if (typeof abRtbLand === 'function' && abRtbLand(p) && abPlaneFly(p, dt, speed)) return;
    p.alt = Math.min(1, p.alt + dt / 3); speed(sp.spd);
    airSteer(p, clamp(p.x, 40, W - 40), H + 60, dt, true);
    if (p.y > H + 15) { p.dead = true; const w = airWing(p); if (w && w.state !== 'lost') { w.state = 'rearm'; w.rearmT = AIR_REARM_LAND; w.af = false; } }
    return;
  }
  // —— 返航：rtb 飞到舰尾一侧的顺风点（偏离中线约两个转弯半径）→ final 转弯切入斜角甲板中线下滑 → trap 着舰；
  //    甲板占用时 hold 在右舷外盘旋等待 ——
  p.rtbT = (p.rtbT || 0) + dt;
  if (dead) {   // 航母瘫痪：无处降落，飞回航母附近迫降
    p.alt = Math.max(.3, p.alt - dt * .1); speed(140);
    if (airSteer(p, c.x, c.y, dt) < 140 || p.rtbT > 60) airLost(p, '航母瘫痪，舰载机无处降落，迫降海面', true);
    return;
  }
  const G = cvLanding(), rx = p.x - G.x, ry = p.y - G.y, along = rx * G.dx + ry * G.dy, lat = -rx * G.dy + ry * G.dx, hd = Math.abs(airAng(p.heading - G.a));
  const s = lat >= 0 ? 1 : -1, ax = G.x - G.dx * 380 - G.dy * s * 150, ay = G.y - G.dy * 380 + G.dx * s * 150;
  if (p.rtbT > 90) {   // 兜底：长时间未能着舰，直接收回
    Object.assign(p, { tl: CVG.td, spd: 60, rest: 0 }); airSet(p, 'trap');
    return;
  }
  if (p.phase === 'final') {
    const k = clamp(-along / 330, 0, 1);
    speed(lerp(78, 130, k)); p.alt = Math.min(p.alt, .06 + k * .94);
    const look = Math.min(along + 100, 30);
    airSteer(p, G.x + G.dx * look, G.y + G.dy * look, dt, true);
    if (along >= -3) {
      if (Math.abs(lat) < 12 && hd < .5) { Object.assign(p, { tl: CVG.td, spd: Math.min(p.spd, 90), rest: 0 }); airSet(p, 'trap'); }
      else { airSet(p, 'rtb'); p.alt = Math.max(p.alt, .35); }   // 复飞
    } else if (Math.abs(lat) > 320 || along < -900) airSet(p, 'rtb');
    return;
  }
  p.alt = Math.min(1, p.alt + dt / 3);
  const busy = cvDeckBusy(p), da = dist(p.x, p.y, ax, ay);
  if (p.phase === 'hold') {
    speed(140);
    const [hx, hy] = cvW(-40, 240);
    airOrbit(p, hx, hy, 130, 1, dt);
    if (!busy) airSet(p, 'rtb');
    return;
  }
  speed(sp.spd);
  if (!busy && along < -200 && along > -650 && Math.abs(lat) < 90 && hd < .6) { airSet(p, 'final'); return; }   // 已在进近航线上
  if (busy && da < 300) { if (p.free) { p.dead = true; return; } airSet(p, 'hold'); return; }   // 旧存档里不占机库的僚机：甲板忙就直接收回，不排队
  airSteer(p, ax, ay, dt);
  if (da < 70 && !busy) airSet(p, 'final');
}

// 攻击机：沿进场方向投下三连弹（以目标为中心，间隔 34）
function strikeDrop(p) {
  p.dropped = true; p.egT = 1.4;
  const ch = Math.cos(p.heading), sh = Math.sin(p.heading);
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 34 + gauss() * 8, side = gauss() * 6;
    fireShell(p.x, p.y, clamp(p.tx + ch * off - sh * side, 0, W), clamp(p.ty + sh * off + ch * side, 0, H), 'p', 'bomb', .7, false, { t: -i * .18 });
  }
}

// 已知的敌防空（我方情报）：高炮阵地、防空车（M163、M-SHORAD、LPWS）、近 90 秒暴露过的毒刺组；w = 威胁分
function airAASites() {
  const out = [];
  if (!S) return out;
  for (const e of S.enemies) if (!e.dead && e.kind === 'aa' && e.kx != null) out.push({ x: e.kx, y: e.ky, w: (e.mod && e.mod.aa ? 1.6 : 1) * ((e.sup || 0) > 50 ? .5 : 1), k: 'gun', id: e.id, o: e });
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && v.kx != null && (vehSp(v).aa || (v.mod && v.mod.cram))) out.push({ x: v.kx, y: v.ky, w: v.type === 'sam_veh' ? 2 : 1.3, k: 'veh', id: 'v' + v.id, o: v });
  for (const q of S.teams) if (q.side === 'e' && q.men.length && q.men.includes('aa') && q.aaSeen != null && S.t - q.aaSeen < 90) out.push({ x: q.aax, y: q.aay, w: .8, k: 'mp', id: 'q' + q.id, o: q });
  return out;
}
const airAAAt = (x, y, r = 300) => airAASites().reduce((a, s) => a + (dist(s.x, s.y, x, y) < r ? s.w : 0), 0);
// 歼-35：防区外投放两枚精确制导炸弹（散布很小）；防空压制型发射反辐射导弹，自动对准目标 140 以内已知的敌防空
function guidedDrop(p) {
  p.dropped = true; p.std = true; p.egT = 2.5;
  const M = airMdl(p.kind, p.v);
  let tx = p.tx, ty = p.ty;
  if (M.sead) { let bd = 140; for (const a of airAASites()) { const d = dist(a.x, a.y, p.tx, p.ty); if (d < bd) { bd = d; tx = a.x; ty = a.y; } } }
  const d = dist(p.x, p.y, tx, ty), n = Math.min(2, p.gbN ?? 2);
  for (let i = 0; i < n; i++) fireShell(p.x, p.y, clamp(tx + gauss() * 4, 0, W), clamp(ty + gauss() * 4, 0, H), 'p', 'bomb', .4 + d / 260, false, { t: -i * .3, gd: true });
  if (p.gbN != null) p.gbN -= n;
  if (typeof v8Stat === 'function') v8Stat(M.sead ? 'seadArm' : 'gdrop');
  log(M.sead ? `${M.name}在防区外发射反辐射导弹，压制敌防空` : `${M.name}在防区外投放精确制导炸弹`, 'info', 'gdrop', 10, { x: tx, y: ty });
}

// 歼-35 武装侦察：投完指定目标后弹舱还有弹，就在任务区（初始目标 480 以内）用光电 / 雷达自主搜索打击——
//   普通型：飞腾-8 打战车、炮位、碉堡、发射车（硬目标两枚，车辆一枚，能追运动目标）；防空压制型：雷电-10 专打防空。
//   防空太密的目标不碰（隐身也有限度）；在防区外（arR）对准发射后立即转开；弹打完或巡逻超时（约 50 秒）返航
const AR_V = { tank: 6, hv_tank: 6.5, td: 5.5, lt_tank: 5, apc: 4.5, amtank: 4.5, aa_veh: 5.5, sam_veh: 6, spg: 5, recon: 3, flame_tank: 5.5, mine_tank: 4 };
const AR_E = { bunker: 4.5, coastal: 5.5, arty: 5, mortar: 3.5, aa: 5.5, tel: 7, ascm: 7 };
function airArPick(p, M) {
  const own = (x, y) => S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, x, y) < 45);
  const taken = (x, y) => S.missiles.some(m => !m.done && m.side === 'p' && m.kind === 'pgm' && dist(m.tx, m.ty, x, y) < 20)
    || S.planes.some(o => o !== p && !o.dead && o.arTg && dist(o.arTg.x, o.arTg.y, x, y) < 20);
  let best = null, bs = 0;
  const cand = (k, o, x, y, v, hard) => {
    if (!v || dist(x, y, p.acx, p.acy) > 480 || own(x, y) || taken(x, y)) return;
    if (!M.sead && airAAAt(x, y, 260) > 3) return;
    const s = v / (1 + dist(p.x, p.y, x, y) / 500);
    if (s > bs) { bs = s; best = { k, id: o.id, x, y, hard }; }
  };
  if (M.sead) {
    for (const a of airAASites()) if (a.k !== 'mp') cand(a.k === 'veh' ? 'veh' : 'enemy', a.o, a.x, a.y, a.w * 3, false);
    return best;
  }
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead) { const sv = inVision(v.x, v.y); if (sv || v.kx != null) cand('veh', v, sv ? v.x : v.kx, sv ? v.y : v.ky, AR_V[v.type] || 3, false); }
  for (const a of S.armor || []) if (!a.dead && inVision(a.x, a.y)) cand('armor', a, a.x, a.y, 4.5, false);
  for (const e of S.enemies) if (!e.dead && e.kx != null) cand('enemy', e, e.kx, e.ky, AR_E[e.kind], e.kind === 'bunker' || e.kind === 'coastal');
  return best;
}
function airArFly(p, dt, speed, M, sp) {
  speed(sp.spd * .85);
  p.alt = Math.min(1, p.alt + dt / 3);
  p.arLeft -= dt;
  if (!(p.gbN > 0) || p.arLeft <= 0) {
    p.ar = false; p.arTg = null; airSet(p, 'rtb');
    if (p.gbN > 0) log(`${airName(p.kind, p.v).split(' ')[0]}任务区内没有可打的目标，带弹返航`, 'info', 'arrtb', 8);
    return;
  }
  if ((p.arBrk || 0) > S.t) { airSteer(p, p.bx, p.by, dt, true); return; }   // 刚发射：转开，不飞临目标上空
  if (!p.arTg || (p.arT || 0) < S.t) { p.arTg = airArPick(p, M); p.arT = S.t + 1.5; }
  const G = p.arTg, T = G && (G.k ? msPgmTgt(G) : null);
  if (!T) { p.arTg = null; p.arLeft = Math.min(p.arLeft, 0); return; }   // 没有可打的目标：返航（不在任务区上空兜圈子）
  const tx = G.k === 'veh' && T.side === 'e' && !inVision(T.x, T.y) && T.kx != null ? T.kx : T.x, ty = G.k === 'veh' && T.side === 'e' && !inVision(T.x, T.y) && T.ky != null ? T.ky : T.y;
  const d = airSteer(p, tx, ty, dt), df = Math.abs(airAng(Math.atan2(ty - p.y, tx - p.x) - p.heading));
  if (d < (M.arR || 260) && df < .6) {
    const n = Math.min(G.hard ? 2 : 1, p.gbN), W0 = M.arW || 'ft8';
    for (let i = 0; i < n; i++) msPgm(W0, 'p', p.x, p.y, { k: G.k, id: G.id, x: tx, y: ty }, p.kind, i * .35);
    p.gbN -= n; p.arTg = null; p.arT = S.t + 2; p.arBrk = S.t + 1.6;
    p.bx = clamp(p.x + Math.cos(p.heading) * 200, 40, W - 40); p.by = Math.min(H - 40, p.y + 300);   // 发射后向本方一侧转开
    if ((p.arN = (p.arN || 0) + 1) >= 2) p.arLeft = Math.min(p.arLeft, 1.6);   // 武装侦察只打两个目标：打完这一波就返航
    if (typeof v8Stat === 'function') v8Stat('arStrike');
    const nm = G.k === 'veh' ? (typeof vehName === 'function' ? vehName(T) : '敌战车') : G.k === 'armor' ? '敌装甲车' : (ENEMY_SPEC[T.kind] || {}).name || '目标';
    log(`${airName(p.kind, p.v).split(' ')[0]}自主发现${nm}，发射${MS_PGM[W0].nm}${n > 1 ? ' ×' + n : ''}（余 ${p.gbN} 枚）`, 'info', 'ar' + p.id, 3, { x: tx, y: ty });
  }
}

// 轰炸机投弹：俯冲轰炸机两枚重磅弹几乎正中目标；重型轰炸机沿进场方向六弹地毯轰炸（间隔 26）
function bomberDrop(p) {
  p.dropped = true; p.egT = 1.6;
  const ch = Math.cos(p.heading), sh = Math.sin(p.heading);
  if (p.v === 'dive') for (let i = 0; i < 2; i++) fireShell(p.x, p.y, clamp(p.tx + gauss() * 7, 0, W), clamp(p.ty + gauss() * 7, 0, H), 'p', 'bomb', .45, false, { t: -i * .12 });
  else for (let i = 0; i < 6; i++) {
    const off = (i - 2.5) * 26 + gauss() * 6, side = gauss() * 10;
    fireShell(p.x, p.y, clamp(p.tx + ch * off - sh * side, 0, W), clamp(p.ty + sh * off + ch * side, 0, H), 'p', 'bomb', .9, false, { t: -i * .14 });
  }
}

// 对地支援机扫射：盘旋中心 160 内、我方视野内、距任何我方小组 45 以上的最近目标
// 空地导弹：射程 agmR 内、任务区 220 以内看得见的硬目标（坦克 / 战车、装甲车、碉堡、炮位、防空、发射车）；离我军 40 以内不打；
// 同一目标只要一枚在飞；两次发射间隔 2.5 秒（KD-88 防区外、蓝箭-7 / 红箭-10 近距）
const AGM_V = { tank: 6, td: 5.5, hv_tank: 6.5, lt_tank: 5, apc: 4.5, amtank: 4.5, aa_veh: 5, sam_veh: 5.5, spg: 4.5, recon: 3, flame_tank: 5.5 };
const AGM_E = { bunker: 4.5, coastal: 5, arty: 4.5, mortar: 3.5, aa: 5, tel: 6, ascm: 6 };
function airAgm(p) {
  const M = airMdl(p.kind, p.v);
  if (!M.agm || !(p.agmN > 0) || (p.agmT || 0) > S.t || typeof msPgm !== 'function' || p.alt < (p.v === 'heli' ? .2 : .4)) return false;   // 直-10 悬停高度约 0.3：照样能打
  p.agmT = S.t + 1;
  const cx = p.cx ?? p.tx, cy = p.cy ?? p.ty, own = (x, y) => S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, x, y) < 40);
  const flying = (k, id) => S.missiles.some(m => m.kind === 'pgm' && !m.done && m.side === 'p' && m.tgt && m.tgt.k === k && m.tgt.id === id);
  let best = null, bs = 0;
  const cand = (k, o, v) => {
    const d = dist(p.x, p.y, o.x, o.y);
    if (!v || d > M.agmR || dist(o.x, o.y, cx, cy) > 220 || !inVision(o.x, o.y) || own(o.x, o.y) || flying(k, o.id)) return;
    const s = v / (1 + d / 400);
    if (s > bs) { bs = s; best = { k, id: o.id, x: o.x, y: o.y, o }; }
  };
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead) cand('veh', v, AGM_V[v.type] || 3);
  for (const a of S.armor || []) if (!a.dead) cand('armor', a, 4.5);
  for (const e of S.enemies) if (!e.dead) cand('enemy', e, AGM_E[e.kind]);
  if (!best) return false;
  msPgm(M.agm, 'p', p.x, p.y, best, p.kind);
  p.agmN--; p.agmT = S.t + 2.5;
  if (typeof v8Stat === 'function') v8Stat('agm');
  const nm = best.k === 'veh' ? (typeof vehName === 'function' ? vehName(best.o) : '敌战车') : best.k === 'armor' ? '敌装甲车' : (ENEMY_SPEC[best.o.kind] || {}).name || '目标';
  log(`${airName(p.kind, p.v).split(' ')[0]}发射${MS_PGM[M.agm].nm}，打击${nm}（余 ${p.agmN} 枚）`, 'info', 'agm' + p.id, 2, best);
  return true;
}
function casStrafe(p) {
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length), safe = (x, y) => !pT.some(q => dist(q.x, q.y, x, y) <= 45);
  let best = null, bd = 260, team = false;
  for (const q of S.teams) if (q.side === 'e' && q.men.length && dist(q.x, q.y, p.cx, p.cy) <= 160 && inVision(q.x, q.y)) {
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < bd && safe(q.x, q.y)) { bd = d; best = q; team = true; }
  }
  for (const e of S.enemies) if (!e.dead && dist(e.x, e.y, p.cx, p.cy) <= 160 && inVision(e.x, e.y)) {
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < bd && safe(e.x, e.y)) { bd = d; best = e; team = false; }
  }
  if (!best) return false;
  if (team) {
    suppress(best, 30, p.x, p.y);
    if (Math.random() < .25 * coverAt(best.x, best.y) / .9 * (SMOKE[ci(best.x, best.y)] ? .5 : 1)) killMan(best);
    for (const o of S.teams) if (o !== best && o.side === 'e' && o.men.length && dist(o.x, o.y, best.x, best.y) < 22) suppress(o, 12, p.x, p.y);
  } else {
    damageEnemy(best, 1.5);
    best.sup = Math.min(100, (best.sup || 0) + 45);
  }
  for (let k = 0; k < 4; k++) tracer(p.x, p.y, best.x + gauss() * 7, best.y + gauss() * 7, 'p', true);
  Object.assign(p, { gunT: .35, gx: best.x, gy: best.y });
  S.stats.shots++;
  log('对地支援机开始扫射', 'info', 'strafe', 20, best);
  return true;
}

// 防空炮：190 内每 0.5 秒判定一次；被压制的炮位命中率下降
function airAA(p, dt) {
  if ((p.aaT = (p.aaT || 0) - dt) > 0) return;
  p.aaT = .5;
  if (typeof eaHigh === 'function' && (eaHigh(p) || eaHighUav(p))) return;   // 战斗机在巡逻高度、无人机在中空：高炮够不着
  const sp = airSpec(p.kind, p.v), s0 = airStealth(p), st = s0 < 1 ? (1 + s0) / 2 : 1;   // 隐身机：雷达高炮难以跟踪，光学瞄准仍可能打中（久留暴露后打折变少）
  for (const a of S.enemies) {
    if (a.dead || a.kind !== 'aa' || dist(a.x, a.y, p.x, p.y) > 190) continue;
    tracer(a.x, a.y, p.x + gauss() * 14, p.y + gauss() * 14, 'e', inVision(a.x, a.y)); a.fireT = S.t;   // 开火即暴露（conceal.js）
    if (p.v === 'heli' && typeof heliShotAt === 'function') heliShotAt(p, a.x, a.y, 210, 1.2);   // 直升机机组看得见曳光从哪来
    if (a.kx == null && Math.random() < .15) { a.kx = a.x; a.ky = a.y; log('防空炮火暴露位置', 'warn', null, 0, a); }
    const k = p.kind === 'bomber' ? (p.v === 'dive' ? (p.diving ? 1.3 : 1) : .75) : 1;
    if (Math.random() < sp.aa * k * st * (1 - (a.sup || 0) / 130)) { airLost(p, `${airName(p.kind, p.v)}被击落`); break; }
  }
}

// 损失一架飞机：击落（空中爆炸 + 翻滚坠落）或迫降（水花）
function airLost(p, msg, ditch) {
  if (p.dead) return;
  p.dead = true;
  const w = airWing(p);
  if (w) w.state = 'lost';
  if (ditch) S.fx.push({ kind: 'flash', x: p.x, y: p.y, r: 12, life: 0, max: .8, side: 'p' });
  else {
    S.fx.push({ kind: 'boom', x: p.x, y: p.y, r: 22, life: 0, max: 1, side: 'p' });
    S.air.wrecks.push({ x: p.x, y: p.y, h: p.heading, spd: Math.min(80, p.spd * .4), kind: p.kind, v: p.v || null, t: S.t, hit: false });
  }
  if (msg) log(msg, 'bad', null, 0, { x: p.x, y: p.y });
}
const airWreckPos = (w, age) => [w.x + Math.cos(w.h) * w.spd * age, w.y + Math.sin(w.h) * w.spd * age];
// 中止起飞（航母瘫痪时仍在弹射器上的飞机）
function airAbort(p) {
  p.dead = true;
  const w = airWing(p);
  if (w && w.state !== 'lost') { w.state = p.phase === 'cat' || p.phase === 'roll' ? 'deck' : 'lost'; w.rearmT = 0; if (w.state === 'deck') w.dk = p.slot ?? null; }
}

// —— 航母机动：只在集结线以北 150 以南的深水区；转向平缓 ——
function orderCV(x, y) {
  if (!S.cv || !S.air) initCarrier();
  const c = S.cv;
  if (c.hp <= 0) { log('航母已瘫痪，无法机动', 'warn', 'cvmv', 2); return false; }
  if (!isFinite(x) || !isFinite(y)) return false;
  const deploy = S.phase === 'deploy', ymin = deploy ? STAGING_Y + 40 : STAGING_Y - 150;
  x = clamp(x, 90, W - 90); y = Math.min(y, H - 30);
  if (y < ymin || typeAt(x, y) !== T.DEEP) {
    log(deploy ? '部署阶段航母只能停在集结海域' : '航母只能在集结线以北 150 以南的深水区机动', 'warn', 'cvl', 2);
    return false;
  }
  if (deploy) Object.assign(c, { x, y, tx: x, ty: y, moving: false });
  else Object.assign(c, { tx: x, ty: y, moving: true, pathT: -9 });
  return true;
}

function cvClear(x0, y0, x1, y1) {
  const n = Math.ceil(dist(x0, y0, x1, y1) / 15);
  for (let s = 1; s <= n; s++) if (typeAt(lerp(x0, x1, s / n), lerp(y0, y1, s / n)) > T.SHOAL) return false;
  return true;
}

function updateCarrier(dt) {
  if (!S.cv || !S.air) initCarrier();
  for (const c of [S.cv, ...(S.cvx || [])]) { cvMove(c, dt); if (typeof cvDeckStep === 'function') cvDeckStep(c, dt); }   // 机动；升降机、甲板停机位（cvdeck.js）
  if (typeof cvShoo === 'function') cvShoo(dt);   // 别的舰艇不压在航母舰体上
}
function cvMove(c, dt) {
  if (c.stepT === S.t) return;   // 同一推演步只更新一次（step 中另有调用也无妨）
  c.stepT = S.t;
  if (c.hp <= 0) { c.moving = false; return; }
  if (!c.moving) return;
  const d = dist(c.x, c.y, c.tx, c.ty);
  if (d < 6) { c.moving = false; return; }
  if (S.t - (c.pathT ?? -9) > 1) { c.pathT = S.t; c.direct = cvClear(c.x, c.y, c.tx, c.ty); }
  let wx = c.tx, wy = c.ty;
  if (!c.direct && d > 30) { const f = field(c.tx, c.ty, 'ship'), n = f && nextStep(f, c.x, c.y); if (n) [wx, wy] = n; }
  const df = airAng(Math.atan2(wy - c.y, wx - c.x) - c.heading);
  c.heading = airAng(c.heading + clamp(df, -.18 * dt, .18 * dt));
  const sp = 10 * clamp(Math.cos(df), .25, 1) * clamp(d / 50, .35, 1) * (typeAt(c.x, c.y) === T.SHOAL ? .55 : 1) * dt;
  const nx = c.x + Math.cos(c.heading) * sp, ny = c.y + Math.sin(c.heading) * sp;
  if (typeAt(nx, ny) <= T.SHOAL && ny >= STAGING_Y - 200) { c.x = clamp(nx, 60, W - 60); c.y = Math.min(ny, H - 20); }
}

// 爆炸落在舰体 30 以内：甲板受损；直接命中可能毁掉甲板上的飞机（机库里的不受影响）；归零即瘫痪（由 combat.js impact 调用）
function cvImpact(x, y, pw) { for (const c of cvAll()) withCV(c, () => cvImpact1(x, y, pw)); }
function cvImpact1(x, y, pw) {
  const c = S.cv, h = cvHome(c), nm = c.name || '航母';
  if (!c || c.hp <= 0 || !pw || !pw.ship) return;
  const [u, v] = cvL(x, y), d = Math.hypot(Math.max(0, Math.abs(u) - 155), Math.max(0, v > 0 ? v - 31 : -v - 34));
  if (d >= 30) return;
  c.hp = Math.max(0, c.hp - pw.ship * (1 - d / 30 * .6)); c.hitT = S.t;
  if (d === 0) {
    for (const p of S.planes) if (!p.dead && cvHome(p) === h && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap') && !(typeof cvBelow === 'function' && cvBelow(p)) && dist(p.x, p.y, x, y) < 18) airLost(p, `${airName(p.kind, p.v)}在甲板上被炸毁`);
    if (Math.random() < .3) {
      let best = null, bd = 40;
      const wing = S.air.wing.filter(w => cvHome(w) === h && !airLandW(w));
      for (const [id, j] of cvPark(c, wing)) {   // 只有停在甲板上的会被炸到，机库里的不受影响
        const s = CVG.slots[j], dd = dist(s[0], s[1], u, v);
        if (dd < bd) { bd = dd; best = wing.find(w => w.id === id); }
      }
      if (best) { best.state = 'lost'; best.dk = null; log(`${airName(best.type, best.v)}在甲板上被炸毁`, 'bad', null, 0, c); }
    }
  }
  if (c.hp > 0) { log(`${nm}中弹，飞行甲板受损（${Math.ceil(c.hp)}/${c.maxhp}）`, 'bad', 'cvhit' + h, 4, c); return; }
  c.moving = false;
  for (const p of S.planes) if (cvHome(p) === h && (p.phase === 'cat' || p.phase === 'roll')) airAbort(p);
  S.fx.push({ kind: 'boom', x: c.x, y: c.y, r: 60, life: 0, max: 1.6, side: 'p' });
  const alt = cvAll().some(o => o !== c && o.hp > 0);
  log(alt ? `${nm}遭重创，飞行甲板瘫痪：舰载机改由其他航母起降` : '航母遭重创，飞行甲板瘫痪，舰载机无法再起降', 'bad', null, 0, c);
  if (alt) for (const w of S.air.wing) if (cvHome(w) === h && w.state !== 'lost' && w.state !== 'deck' && w.state !== 'rearm') w.home = cvHome(cvAll().find(o => o !== c && o.hp > 0));
  airCount();
}

// 视野来源（由 updateVision 合并到我方视野）
function carrierVision() {
  return S && S.cv ? cvAll().map(c => ({ x: c.x, y: c.y, r: 160, h: 1.5 })) : [];
}

// —— 自动派机（S.cv.auto）：对地支援压制我军的敌人、空袭已标定火力点、侦察前线方向的敌占据点 ——
function updateAirAuto(dt) {
  const c = S.cv;
  if (!c || !c.auto || S.phase !== 'battle' || (!cvAll().some(o => o.hp > 0) && !S.air.wing.some(w => airLandW(w) && w.state !== 'lost'))) return;   // 旗舰的自动开关统管全部航母（含战区陆基飞机）
  if ((c.autoT = (c.autoT ?? 2) - dt) > 0) return;
  c.autoT = 3;
  if (typeof awAutoP === 'function' && awAutoP()) return;   // 制空（airwar.js）：先派战斗机拦截 / 巡逻
  // 敌方掌握制空权、我又没有战斗机在空：攻击机与轰炸机暂缓，对地支援只在我军压力很大时出动
  const awBad = typeof awState === 'function' && awState() === 'e' && !S.planes.some(p => !p.dead && p.kind === 'fighter' && p.alt > .3);
  // 指挥官的航空任务（commander.js）：H 时侦察、受阻攻击的对地支援、假目标后的复查与再次出击
  // 空中作战计划（ato.js）：AI 指挥时按阶段放行——①只出战斗机与侦察机 ②攻击机只打已知敌防空 ③全部放开
  const ph = typeof atoPhase === 'function' ? atoPhase('p') : 3, okA = (k, x, y) => typeof atoOk !== 'function' || atoOk('p', k, k === 'strike' && atoIsAAP(x, y));
  const T = typeof cmdAirTask === 'function' ? cmdAirTask(c, a => okA(a.k, a.x, a.y)) : null;
  const L = T && airPkg(T.k, T.x, T.y, T.pref);
  if (L) { if (typeof atoWing === 'function' && (T.k === 'strike' || T.k === 'cas')) atoWing(L, T.k, T.x, T.y, T.pref); if (typeof cmdAirLaunched === 'function') cmdAirLaunched(T, L); return; }
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length);
  const near = (x, y, r) => pT.filter(q => dist(q.x, q.y, x, y) < r);
  const busy = (kind, x, y, r) => S.planes.some(p => p.kind === kind && !p.dead && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'out' || p.phase === 'loiter') && dist(p.cx ?? p.tx, p.cy ?? p.ty, x, y) < r);
  if (S.assets.cas > 0 && pT.length && ph >= 3) {
    let best = null, bs = 0;
    for (const o of S.teams) if (o.side === 'e' && o.men.length && inVision(o.x, o.y)) {
      const nb = near(o.x, o.y, 220);
      if (!nb.length || nb.some(q => dist(q.x, q.y, o.x, o.y) < 60) || busy('cas', o.x, o.y, 200)) continue;
      const s = nb.reduce((a, q) => a + 1 + q.sup / 50, 0);
      if (typeof eaThreat === 'function' && eaThreat(o.x, o.y) >= 1 && s < 8) continue;   // 已知敌单兵防空：盘旋的对地支援机不去送（我方压力很大时例外）
      if (typeof cmdAirClosed === 'function' && cmdAirClosed(o.x, o.y) && s < 10) continue;   // 已知敌防空强：先由舰炮、导弹、歼-35 打掉（commander.js cmdSeadP）
      if (s > bs) { bs = s; best = o; }
    }
    const Lc = best && bs >= (awBad ? 6 : 2) && airPkg('cas', best.x, best.y);
    if (Lc) { if (typeof atoWing === 'function') atoWing(Lc, 'cas', best.x, best.y); return; }
  }
  const seadUp = S.planes.filter(o => !o.dead && o.kind === 'strike' && o.phase !== 'rtb').length, seadV = S.air.wing.some(w => w.type === 'strike' && w.v === 'sead' && w.state === 'deck');
  if (S.assets.strike > 0 && !awBad && ph >= 2 && !(ph === 2 && seadUp >= 2)) {   // 压制防空阶段：同时最多两架
    const PRI = { coastal: 5, ascm: 5, tel: 5, airfield: 4.5, arty: 4, aa: 3.5, mortar: 3, bunker: 2 };   // 歼-35 在时高炮阵地（防空）优先级再乘 1.8
    let best = null, bs = 0;
    for (const e of S.enemies) if (!e.dead && e.kx != null && !(e.kind === 'airfield' && typeof abKeep === 'function' && abKeep())) {   // 打算空降夺取的机场不炸（abn.js）
      if (ph === 2 && (e.kind !== 'aa' || (!seadV && airAAAt(e.kx, e.ky, 300) > 1.4))) continue;   // 压制防空阶段：只打防空；没有防空压制型时只打孤立的防空点，不往防空网里送
      if (near(e.kx, e.ky, typeof cmdAirSafe === 'function' ? cmdAirSafe() : 90).length || busy('strike', e.kx, e.ky, 70) || S.shells.some(s => s.side === 'p' && s.kind === 'bomb' && dist(s.x1, s.y1, e.kx, e.ky) < 60)) continue;
      const stl = S.air.wing.some(w => w.type === 'strike' && w.state === 'deck' && airMdl('strike', w.v).stealth);   // 歼-35 隐身：不怕防空圈
      const s = (PRI[e.kind] || 1) * (e.kind === 'bunker' && !near(e.kx, e.ky, 320).length ? .3 : 1) * (!stl && typeof eaThreat === 'function' && eaThreat(e.kx, e.ky) >= 1 ? .4 : 1) * (e.kind === 'aa' && stl ? 1.8 : 1);
      if (s > bs) { bs = s; best = e; }
    }
    // 压制防空阶段：已知的敌防空车也打（防空压制型歼-35 优先）
    if (ph === 2 && !best && typeof airAASites === 'function') { const v = airAASites().filter(s => s.k === 'veh' && !near(s.x, s.y, 90).length && !busy('strike', s.x, s.y, 70) && (seadV || airAAAt(s.x, s.y, 300) <= 2.1)).sort((a, b) => b.w - a.w)[0]; if (v) best = { kx: v.x, ky: v.y, id: null, sead: true }; }
    const pref = ph === 2 && S.air.wing.some(w => w.type === 'strike' && w.v === 'sead' && w.state === 'deck') ? 'sead' : undefined;
    const L = best && airPkg('strike', best.kx, best.ky, pref);
    if (L) { if (typeof atoWing === 'function') atoWing(L, 'strike', best.kx, best.ky, pref); if (typeof cmdAirLaunched === 'function' && best.id != null) cmdAirLaunched({ k: 'strike', x: best.kx, y: best.ky, eid: best.id }, L); return; }
  }
  if (S.assets.bomber > 0 && !awBad && ph >= 3) {   // 轰炸机：炮兵阵地群、岸防炮、碉堡（周围已标定目标越多越优先）；我军 150 以内不投
    const PRI = { coastal: 5, airfield: 5, ascm: 4.5, tel: 4.5, arty: 4.5, aa: 3, mortar: 3, bunker: 2.5 };
    let best = null, bs = 0;
    for (const e of S.enemies) if (!e.dead && e.kx != null && !(e.kind === 'airfield' && typeof abKeep === 'function' && abKeep())) {
      if (near(e.kx, e.ky, 150).length || busy('bomber', e.kx, e.ky, 90) || S.shells.some(s => s.side === 'p' && s.kind === 'bomb' && dist(s.x1, s.y1, e.kx, e.ky) < 60)) continue;
      const s = (PRI[e.kind] || 1) + .8 * S.enemies.filter(o => o !== e && !o.dead && o.kx != null && dist(o.kx, o.ky, e.kx, e.ky) < 90).length;
      if (s > bs) { bs = s; best = e; }
    }
    if (best && airPkg('bomber', best.kx, best.ky)) return;
  }
  if (S.assets.recon > 0 && !S.planes.some(p => p.kind === 'recon' && !p.dead) && S.t - (c.reconT ?? -99) > 40) {
    // 前线方向：我方步兵重心；尚未登陆时用登陆舰队重心
    const inf = pT.filter(q => q.kind === 'inf'), sh = S.ships.filter(s => alive(s)), src = inf.length ? inf : pT.length ? pT : sh.length ? sh : [c];
    const fx = src.reduce((a, q) => a + q.x, 0) / src.length, fy = src.reduce((a, q) => a + q.y, 0) / src.length;
    const tgt = S.points.filter(p => p.owner !== 'p').sort((a, b) => dist(a.x, a.y, fx, fy) - dist(b.x, b.y, fx, fy))[0];
    if (tgt && launchPlane('recon', tgt.x, tgt.y)) c.reconT = S.t;
  }
}
function toggleCvAuto() {
  if (!S.cv || !S.air) initCarrier();
  S.cv.auto = !S.cv.auto;
  log(S.cv.auto ? '航母自动派机支援：开启' : '航母自动派机支援：关闭', 'info', 'cvauto', 0);
  if (typeof updateHud === 'function') updateHud();
}

// 单位卡数据（hud.js updateCards 使用）
function cvCard() {
  if (!S.cv || !S.air) initCarrier();
  const c = S.cv, live = S.air.wing.filter(w => w.state !== 'lost' && !airLandW(w)), n = live.length || 1;
  const ready = live.filter(w => w.state === 'deck' && (cvOf(cvHome(w)) || { hp: 0 }).hp > 0).length, up = live.filter(w => w.state === 'launch' || w.state === 'out' || w.state === 'return').length;
  return { n: ready, hp: clamp(c.hp / c.maxhp, 0, 1), ready: ready / n, air: up / n,
    state: c.hp <= 0 ? 'rout' : c.hp < c.maxhp * .4 || S.t < (c.exposedUntil || 0) ? 'waver' : 'ok', mini: c.auto ? 'auto' : c.moving ? 'move' : 'hold' };
}

// 点选：世界坐标落在航母舰体上返回 'CV'
function pickCarrier(p) {
  const c = S && S.cv;
  if (!c || !p || !isFinite(p.x) || !isFinite(p.y)) return null;
  const rd = typeof R !== 'undefined' && R.s > 0, k = rd ? cvScale() : 1, pad = rd ? px(4) : 0, [u, v] = cvL(p.x, p.y);
  return Math.abs(u) <= 159 * k + pad && v <= 34 * k + pad && v >= -42 * k - pad ? 'CV' : null;
}

// —— 绘制 ——
const cvScale = () => Math.max(1, 70 / (CV_LEN * R.s));   // 小屏全图时放大，保证航母至少约 70px 长

function cvPath(ctx, pts) { ctx.beginPath(); for (const [u, v] of pts) ctx.lineTo(u, v); ctx.closePath(); }

function airShape(ctx, type) {
  const h = AIR_SIL[type] || AIR_SIL.j35;
   // 黑鹰：机身更宽（运兵舱）
  ctx.beginPath();
  for (const [x, y] of h) ctx.lineTo(x, y);
  for (let i = h.length - 1; i >= 0; i--) ctx.lineTo(h[i][0], -h[i][1]);
  ctx.closePath();
}

// 飞机剪影：轮廓 + 各型细节（预警机雷达圆盘、歼-20 外倾双垂尾与鸭翼、轰-6K 翼根发动机、A-10 尾部双发、连翼机的中空、V 尾、旋翼与短翼）；攻击机挂弹
// o（可缺省）：精细模型的状态——t 时间、ab 加力、fold 机翼折起、st 外挂剩余比例、bay / sbay 弹舱开度、still 停放（旋翼不转）
function drawAircraft(ctx, x, y, a, type, size, col, alpha, bank, lw, bombs, o) {
  const sc = size / 21, real = typeof realLook === 'function' && realLook();
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(sc, sc * (1 - .32 * Math.min(1, Math.abs(bank || 0))));
  if (typeof airDetail === 'function' && typeof AIRD === 'object' && AIRD[type]) {   // 屏幕上够大（机长约 26 像素以上）就画精细模型（airmdl.js）
    const T = ctx.getTransform(), ppu = Math.hypot(T.a, T.b) / ((typeof R === 'object' && R.dpr) || 1);
    if (ppu * 22 >= 26 && airDetail(ctx, type, a, real, col, alpha, lw / sc, type === 'h6k' && bombs != null ? { st: bombs ? 1 : 0, ...o } : o)) { ctx.restore(); return; }
  }
  airShape(ctx, type);
  if (real) {   // 写实：按机型涂装（受光渐变）、深色细节线、阵营细边
    const ga = ctx.globalAlpha;
    ctx.fillStyle = rlLit(ctx, a, 22, 18, col === COL.enemy ? lkPaint(rlAirPaint(type), 'e') : rlAirPaint(type)); ctx.globalAlpha = ga * alpha; ctx.fill(); ctx.globalAlpha = ga;   // 黑绿画面：敌机暗红
    ctx.strokeStyle = rgba(col, alpha * .8); ctx.lineWidth = lw / sc * .8; ctx.stroke();
    ctx.strokeStyle = `rgba(20,22,24,${.55 * alpha})`;
  } else {
    ctx.fillStyle = `rgba(2,10,6,${.88 * alpha})`; ctx.fill();
    ctx.strokeStyle = rgba(col, alpha); ctx.lineWidth = lw / sc; ctx.stroke();
  }
  ctx.lineWidth = lw / sc * .7;
  const seg = (...p) => { ctx.beginPath(); for (let i = 0; i < p.length; i += 4) { ctx.moveTo(p[i], p[i + 1]); ctx.lineTo(p[i + 2], p[i + 3]); } ctx.stroke(); };
  const heliT = type === 'heli' || type === 'z10' || type === 'ah64' || type === 'uh60', bigT = type === 'transport' || type === 'y20' || type === 'c17' || type === 'h6k' || type === 'kj600';
  if (!heliT && type !== 'gj11' && type !== 'wz7' && type !== 'gj2' && type !== 'b2' && !real) seg(8.5, 0, 4.5, 0);   // 座舱
  if (real) {   // 写实细节：座舱玻璃（有人机）、尾喷口、机身中线
    if (type === 'b2') { ctx.fillStyle = `rgba(40,58,68,${alpha})`; for (const y of [-.55, .55]) { ctx.beginPath(); ctx.ellipse(3.7, y, .45, .35, 0, 0, 7); ctx.fill(); } }   // B-2A：机鼻上两块风挡
    else if (!heliT && !bigT && type !== 'gj11' && type !== 'wz7' && type !== 'gj2') {
      ctx.fillStyle = `rgba(52,78,94,${alpha})`; ctx.beginPath(); ctx.ellipse(6.6, 0, type === 'a10' ? 1.3 : 1.8, .62, 0, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(210,230,240,${.35 * alpha})`; ctx.beginPath(); ctx.ellipse(7, -.18, .7, .2, 0, 0, 7); ctx.fill();
      const nz = type === 'f35' ? [0] : type === 'j36' ? [] : type === 'a10' ? [] : [-.75, .75];
      ctx.fillStyle = `rgba(28,28,26,${alpha})`; for (const y of nz) { ctx.beginPath(); ctx.arc(-10.6, y, .62, 0, 7); ctx.fill(); }
    } else if (bigT || heliT) { ctx.fillStyle = `rgba(40,58,68,${alpha})`; ctx.beginPath(); ctx.ellipse(heliT ? 6.6 : 10.2, 0, heliT ? 1.4 : .9, heliT ? .75 : 1, 0, 0, 7); ctx.fill(); }   // 风挡
    ctx.strokeStyle = `rgba(20,22,24,${.25 * alpha})`; seg(9, 0, -9, 0);
    ctx.strokeStyle = `rgba(20,22,24,${.55 * alpha})`;
  }
  if (type === 'kj600') {   // 背负雷达圆盘 + 两台涡桨
    ctx.beginPath(); ctx.arc(-1.8, 0, 3.6, 0, 7); ctx.fillStyle = real ? `rgba(214,218,218,${alpha})` : `rgba(2,10,6,${alpha})`; ctx.fill(); ctx.stroke();
    seg(-5.4, 0, 1.8, 0);
    for (const s of [-1, 1]) ctx.strokeRect(1.2, s * 4.4 - .8, 3.4, 1.6);
  } else if (type === 'wz7') {   // 连翼中间是空的
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(.4, s * 1.5); ctx.lineTo(-4.2, s * 8.4); ctx.lineTo(-7.4, s * 2.4); ctx.stroke(); }
  } else if (type === 'j20') {   // 外倾双垂尾
    for (const s of [-1, 1]) seg(-6, s * 1.9, -9.6, s * 3);
  } else if (type === 'j35' || type === 'f35' || type === 'j15') {   // 双垂尾
    for (const s of [-1, 1]) seg(-5.6, s * 1.6, -9.2, s * 2.3);
  } else if (type === 'f22') {   // 外倾双垂尾 + 进气口
    for (const s of [-1, 1]) seg(-4.6, s * 2.1, -8.4, s * 3.4, 3.4, s * 1.9, 1.4, s * 2.5);
  } else if (type === 'j36') {   // 背部进气口 + 三台发动机的扁平喷口，翼尖开裂式方向舵，无垂尾
    ctx.strokeRect(-.6, -1, 3.4, 2);
    for (const y of [-1.7, 0, 1.7]) ctx.strokeRect(-12, y - .5, 1.5, 1);
    for (const s of [-1, 1]) seg(-6.2, s * 9.4, -7.4, s * 9.4);
  } else if (type === 'h6k') {   // 翼根两台发动机
    for (const s of [-1, 1]) ctx.strokeRect(-1.8, s * 3.2 - .9, 6, 1.8);
  } else if (type === 'a10') {   // 尾部背负双发 + 双垂尾
    for (const s of [-1, 1]) { ctx.strokeRect(-6.4, s * 2.6 - .9, 3.6, 1.8); seg(-9.4, s * 4.8, -10.6, s * 4.8); }
  } else if (type === 'gj2') {   // V 形尾翼
    for (const s of [-1, 1]) seg(-8.2, s * .4, -10.2, s * 3.6);
  } else if (type === 'gj11') {   // 背部进气口
    ctx.strokeRect(1, -1, 3, 2);
  } else if (heliT) {   // 主旋翼（写实：转动的半透明桨盘 + 桨叶；数码：虚线圆）+ 短翼挂架
    if (type === 'ah64' && real) { ctx.fillStyle = `rgba(60,62,56,${alpha})`; for (const s of [-1, 1]) for (const x of [-.1, -.8]) ctx.fillRect(x - .25, s * 3.9 - .45, .5, .9); }   // 地狱火
    if (real) {
      const tt = (typeof S === 'object' && S ? S.t : 0) * 22, nb = type === 'ah64' || type === 'uh60' ? 4 : 5, Rr = type === 'uh60' ? 10.5 : 9.5;
      ctx.fillStyle = `rgba(24,26,24,${.16 * alpha})`; ctx.beginPath(); ctx.arc(.4, 0, Rr, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(22,22,20,${.5 * alpha})`; ctx.lineWidth = lw / sc * .9;
      ctx.beginPath(); for (let i = 0; i < nb; i++) { const b = tt + i * 6.283 / nb; ctx.moveTo(.4, 0); ctx.lineTo(.4 + Math.cos(b) * Rr, Math.sin(b) * Rr); } ctx.stroke();
      ctx.fillStyle = `rgba(24,26,24,${.2 * alpha})`; ctx.beginPath(); ctx.arc(-12.2, 1.4, 1.5, 0, 7); ctx.fill();   // 尾桨
    } else {
      seg(-.5, type === 'uh60' ? -5 : -4.2, -.5, type === 'uh60' ? 5 : 4.2);
      ctx.setLineDash([2.2, 1.6]); ctx.beginPath(); ctx.arc(1.5, 0, 9.5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
  } else if (type === 'transport' || type === 'y20' || type === 'c17') {   // 四台涡扇发动机吊舱
    if (real) { ctx.fillStyle = `rgba(90,96,100,${alpha})`; for (const s of [-1, 1]) for (const y of [4.4, 8.1]) ctx.fillRect(type === 'c17' ? .4 - (y - 4.4) * .25 : 1.2 - (y - 4.4) * .2, s * y - .7, 3, 1.4); }
    else for (const s of [-1, 1]) for (const y of [4.2, 8]) ctx.strokeRect(1.4, s * y - .8, 3.2, 1.6);
  }
  if (bombs) {
    ctx.fillStyle = real ? `rgba(70,74,64,${alpha})` : rgba(COL.amber, alpha);
    for (const s of [-1, 0, 1]) { ctx.beginPath(); ctx.ellipse(-1.5 + Math.abs(s) * .5, s * 4.6, 1.6, .8, 0, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}

function drawCarrier(time) {
  if (!S || !S.cv) return;
  drawCarrier1(time);
  for (const x of S.cvx || []) withCV(x, () => drawCarrier1(time));
}
function drawCarrier1(time) {
  const c = S && S.cv, h = cvHome(c);
  if (!c || !R.ctx || !isFinite(c.x) || !isFinite(c.y)) return;
  const ctx = R.ctx, k = cvScale(), lw = n => px(n) / k, dead = c.hp <= 0, det = CV_LEN * k * R.s;
  const col = dead ? COL.amber : COL.g, hit = S.t - (c.hitT ?? -99) < .35, sel = !h && typeof isSel === 'function' && isSel('CV');
  const wing = S.air ? S.air.wing.filter(w => cvHome(w) === h && !airLandW(w)) : [], live = S.planes.filter(p => !p.dead && cvHome(p) === h && !p.land && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap'));
  if (c.moving && !dead) {   // 航向指示
    ctx.strokeStyle = rgba(COL.sel, sel ? .6 : .25); ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(4)]);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.tx, c.ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(c.tx, c.ty, px(5), 0, 7); ctx.stroke();
  }
  const real = typeof realLook === 'function' && realLook();
  if (typeof cvDeckInit === 'function') cvDeckInit(c);
  ctx.save();
  ctx.translate(c.x, c.y); ctx.rotate(c.heading); ctx.scale(k, k);
  if (c.moving && !dead) {   // 舰尾 V 形尾流与舰首浪
    for (const s of [-1, 1]) {
      const g = ctx.createLinearGradient(-156, 0, -380, 0), wc = real ? '#eef3f2' : COL.intel;
      g.addColorStop(0, rgba(wc, .35)); g.addColorStop(1, rgba(wc, 0));
      ctx.strokeStyle = g; ctx.lineWidth = lw(1.6);
      ctx.beginPath(); ctx.moveTo(-150, s * 16); ctx.lineTo(-380, s * (60 + 8 * Math.sin(time * 2 + s))); ctx.stroke();
    }
    const g = ctx.createLinearGradient(-156, 0, -300, 0);
    g.addColorStop(0, rgba('#d4fff0', .12)); g.addColorStop(1, rgba('#d4fff0', 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-154, -14); ctx.lineTo(-300, -22); ctx.lineTo(-300, 22); ctx.lineTo(-154, 14); ctx.fill();
    ctx.strokeStyle = rgba('#d4fff0', .35); ctx.lineWidth = lw(1.3);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(160, 0); ctx.quadraticCurveTo(142, s * 22, 108, s * 36); ctx.stroke(); }
  }
  if (!R.m3d || dead) {   // 3D：航母、甲板设备与甲板上的飞机是立体模型（v3units.js），贴图里只留尾流与选中、暴露标记
    // 舰体投影与飞行甲板
    ctx.save(); ctx.translate(8 * Math.sin(c.heading) + 6 * Math.cos(c.heading), 8 * Math.cos(c.heading) - 6 * Math.sin(c.heading));
    cvPath(ctx, CVG.deck); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill(); ctx.restore();
    cvPath(ctx, CVG.deck);
    ctx.fillStyle = real ? rlLit(ctx, c.heading, 300, 70, '#4d5357') : 'rgba(2,10,6,.9)'; ctx.fill();   // 写实：深灰飞行甲板
    ctx.strokeStyle = hit ? rgba('#ffffff', .95) : rgba(col, dead ? .65 : .95); ctx.lineWidth = lw(hit ? 2.6 : 1.6); ctx.stroke();
    const pc = a => real ? `rgba(236,236,226,${a})` : rgba(STRUCT, a), ylw = a => real ? `rgba(214,190,72,${a})` : rgba(COL.amber, a * .8);
    // 升降机：平台在甲板高度时与甲板齐平（黄边）；降下时舷边缺口露出机库，平台变暗
    CVG.el.forEach((E, i) => {
      const eh = typeof cvElH === 'function' ? cvElH(c, i) : 0, u0 = E.u - E.L / 2, v0 = E.v - E.B / 2;
      if (eh > .01) {
        ctx.fillStyle = real ? 'rgba(16,18,20,.95)' : 'rgba(0,4,2,.98)'; ctx.fillRect(u0, v0, E.L, 33 - v0);   // 机库开口
        const sh = 1 - eh * .1, du = E.L * (1 - sh) / 2;
        ctx.fillStyle = real ? `rgba(${Math.round(77 - 45 * eh)},${Math.round(83 - 48 * eh)},${Math.round(87 - 50 * eh)},1)` : `rgba(2,10,6,${.9})`;
        ctx.fillRect(u0 + du, v0 + 1 + eh * 2, E.L - du * 2, E.B - 2 - eh * 2);
        ctx.strokeStyle = ylw(.5 * (1 - eh * .6)); ctx.lineWidth = lw(1); ctx.strokeRect(u0 + du, v0 + 1 + eh * 2, E.L - du * 2, E.B - 2 - eh * 2);
      } else {
        if (real) { ctx.fillStyle = rlLit(ctx, c.heading, 22, 18, '#50565a'); ctx.fillRect(u0, v0, E.L, E.B); }
        else { ctx.fillStyle = 'rgba(2,10,6,.9)'; ctx.fillRect(u0, v0, E.L, E.B); }
        ctx.strokeStyle = ylw(.75); ctx.lineWidth = lw(1.1); ctx.strokeRect(u0, v0, E.L, E.B);
        if (det >= 160) { ctx.strokeStyle = ylw(.35); ctx.setLineDash([lw(3), lw(3)]); ctx.strokeRect(u0 + 1.5, v0 + 1.5, E.L - 3, E.B - 3); ctx.setLineDash([]); }
      }
    });
    const L = CVG.land, nx = -(L.v1 - L.v0) / CV_LLEN, ny = (L.u1 - L.u0) / CV_LLEN, at = t => [lerp(L.u0, L.u1, t), lerp(L.v0, L.v1, t)];
    if (det >= 70) {
      // 斜角着舰区：两侧边线、中线虚线、接地区横条、四道拦阻索；右侧红白相间的安全线（着舰时这条线以左不能停飞机）
      ctx.strokeStyle = pc(real ? .7 : .35); ctx.lineWidth = lw(1);
      ctx.beginPath();
      for (const s of [-L.hw, L.hw]) { ctx.moveTo(L.u0 + nx * s, L.v0 + ny * s); ctx.lineTo(L.u1 + nx * s, L.v1 + ny * s); }
      ctx.stroke();
      ctx.setLineDash([lw(9), lw(7)]); ctx.strokeStyle = pc(real ? .8 : .45); ctx.lineWidth = lw(1.2);
      ctx.beginPath(); ctx.moveTo(L.u0, L.v0); ctx.lineTo(L.u1, L.v1); ctx.stroke(); ctx.setLineDash([]);
      if (det >= 160) {
        ctx.strokeStyle = real ? 'rgba(200,52,40,.75)' : rgba(COL.enemy, .45); ctx.lineWidth = lw(1); ctx.setLineDash([lw(4), lw(4)]);
        ctx.beginPath(); ctx.moveTo(L.u0 + nx * (L.hw + 2.5), L.v0 + ny * (L.hw + 2.5)); ctx.lineTo(L.u1 + nx * (L.hw + 2.5), L.v1 + ny * (L.hw + 2.5)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = pc(real ? .5 : .25);
        for (const t of [.06, .085, .27, .3]) { const [u, v] = at(t); ctx.save(); ctx.translate(u, v); ctx.rotate(CV_LANG); for (const s of [-1, 1]) ctx.fillRect(-1.2, s * 7 - 2, 2.4, 4); ctx.restore(); }   // 接地区标志
      }
      ctx.strokeStyle = real ? 'rgba(30,30,28,.85)' : rgba(STRUCT, .32); ctx.lineWidth = lw(real ? 1.1 : .9);
      ctx.beginPath();
      for (const t of CVG.wires) { const [u, v] = at(t); ctx.moveTo(u + nx * 15, v + ny * 15); ctx.lineTo(u - nx * 15, v - ny * 15); }
      ctx.stroke();
      // 舰首中线、甲板边安全线
      ctx.setLineDash([lw(6), lw(6)]); ctx.strokeStyle = pc(real ? .45 : .22); ctx.lineWidth = lw(1);
      ctx.beginPath(); ctx.moveTo(150, 0); ctx.lineTo(60, 0); ctx.stroke(); ctx.setLineDash([]);
      if (det >= 160 && real) { ctx.strokeStyle = 'rgba(230,230,220,.25)'; ctx.lineWidth = lw(.8); ctx.save(); ctx.beginPath(); cvPath(ctx, CVG.deck); ctx.clip(); cvPath(ctx, CVG.deck); ctx.lineWidth = lw(3.4); ctx.stroke(); ctx.restore(); }
    }
    // 弹射器：滑轨、弹射滑块；有飞机挂上 / 弹射时发光，偏流板升起（抬起的板子俯视变短、身后拖一道影子）
    CVG.cats.forEach((C, i) => {
      const ca = Math.cos(C.a), sa = Math.sin(C.a), on = live.find(p => p.cat === i && ((p.phase === 'cat' && (p.dk === 'hook' || p.dk === 'line')) || p.phase === 'roll'));
      ctx.save(); ctx.translate(C.u, C.v); ctx.rotate(C.a);
      ctx.strokeStyle = on ? rgba(COL.amber, .55 + .4 * Math.sin(time * 14)) : real ? 'rgba(24,26,26,.85)' : rgba(STRUCT, det >= 70 ? .3 : .18);
      ctx.lineWidth = lw(on ? 2 : 1); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(C.L - 2, 0); ctx.stroke();
      if (det >= 160) { ctx.strokeStyle = pc(real ? .4 : .2); ctx.lineWidth = lw(.7); ctx.beginPath(); for (const s of [-1, 1]) { ctx.moveTo(0, s * 2.2); ctx.lineTo(C.L - 2, s * 2.2); } ctx.stroke(); }
      const sx = on && on.phase === 'roll' ? Math.min(C.L, on.cs || 0) : 0;   // 滑块
      ctx.fillStyle = real ? '#2c2e2e' : rgba(COL.amber, .9); ctx.fillRect(sx - 1.4, -.6, 2.8, 1.2);
      if (on && on.phase === 'roll') { const g = ctx.createLinearGradient(0, 0, sx, 0); g.addColorStop(0, rgba(COL.amber, 0)); g.addColorStop(1, rgba(COL.amber, .55)); ctx.strokeStyle = g; ctx.lineWidth = lw(3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sx, 0); ctx.stroke(); }
      const j = typeof cvJbd === 'function' ? cvJbd(c, i, live) : 0, dep = 5 * Math.cos(j * .96), sh = 5 * Math.sin(j * .96) * .7;   // 偏流板：铰链在前沿，向后上方抬起
      if (sh > .2) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-9.5 - dep - sh, -8, sh, 16); }
      ctx.fillStyle = real ? (j > .05 ? '#7c8287' : '#565c60') : `rgba(2,10,6,.95)`; ctx.fillRect(-9.5 - dep, -8, dep, 16);
      ctx.strokeStyle = j > .05 ? rgba(COL.amber, .4 + .5 * j) : real ? 'rgba(20,22,22,.7)' : rgba(STRUCT, .28); ctx.lineWidth = lw(1); ctx.strokeRect(-9.5 - dep, -8, dep, 16);
      if (real && j > .05) { ctx.strokeStyle = 'rgba(30,30,30,.5)'; ctx.lineWidth = lw(.5); ctx.beginPath(); for (let y = -6; y <= 6; y += 3) { ctx.moveTo(-9.5 - dep, y); ctx.lineTo(-9.5, y); } ctx.stroke(); }
      ctx.restore();
    });
    // 舰首、舰尾舷号「18」（字头朝舰首，从舰尾方向看是正的）
    if (det >= 110) {
      ctx.save(); ctx.fillStyle = pc(real ? .75 : .4); ctx.font = '700 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const [u, v, s] of [[126, 0, 1.1], [-146, 12, .9]]) { ctx.save(); ctx.translate(u, v); ctx.rotate(Math.PI / 2); ctx.scale(s, s * 1.4); ctx.fillText('18', 0, 0); ctx.restore(); }
      ctx.restore();
    }
    // 近防炮 / 红旗-10 发射装置：甲板四角舷台
    ctx.fillStyle = real ? '#8d9398' : 'rgba(2,10,6,1)'; ctx.strokeStyle = real ? 'rgba(0,0,0,.5)' : rgba(STRUCT, .6); ctx.lineWidth = lw(.9);
    for (const [u, v] of [[144, -19], [136, 23], [-148, -20], [-150, 30]]) { ctx.beginPath(); ctx.arc(u, v, 2.6, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.fillRect(-124, -28, 9, 5); ctx.strokeRect(-124, -28, 9, 5);   // 左舷后部的着舰指挥官平台
    // 舰岛（003：右舷中后部、紧凑）：底层甲板室 → 相控阵层（四面大型有源相控阵，俯视是四边的深色斜面）→ 驾驶室（前、侧窗带）→ 一体化桅杆（八角柱、顶部天线罩）；
    //   尾部烟囱（两个排烟口）；舰岛朝甲板一侧的飞行指挥所窗
    const [iu0, iu1, iv0, iv1] = CVG.isl, im = (iv0 + iv1) / 2;
    const blk = (u0, u1, v0, v1, f) => { ctx.fillStyle = real ? f : 'rgba(2,10,6,1)'; ctx.fillRect(u0, v0, u1 - u0, v1 - v0); ctx.strokeRect(u0, v0, u1 - u0, v1 - v0); };
    ctx.save(); ctx.translate(7, 7); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(iu0, iv0, iu1 - iu0, iv1 - iv0); ctx.restore();   // 投影（光从西北来）
    ctx.strokeStyle = real ? 'rgba(0,0,0,.55)' : rgba(STRUCT, dead ? .5 : .85); ctx.lineWidth = lw(1.3);
    blk(iu0, iu1, iv0, iv1, '#8a9196');
    if (det >= 70) {
      ctx.lineWidth = lw(1);
      blk(iu0 + 2, iu0 + 11, iv0 + 2, iv1 - 2, '#7d8489');   // 烟囱
      ctx.fillStyle = real ? '#22262a' : rgba(STRUCT, .45);
      for (const v of [im - 1.6, im + 1.6]) { ctx.beginPath(); ctx.ellipse(iu0 + 6.5, v, 3, 1.2, 0, 0, 7); ctx.fill(); }   // 排烟口
      blk(iu0 + 13, iu1 - 3, iv0 + 1.2, iv1 - 1.2, '#9aa1a6');   // 相控阵层
      if (real) { ctx.fillStyle = '#56606a'; ctx.fillRect(iu0 + 15, iv0 + 1.2, iu1 - iu0 - 20, 1.3); ctx.fillRect(iu0 + 15, iv1 - 2.5, iu1 - iu0 - 20, 1.3); ctx.fillRect(iu1 - 4.3, iv0 + 3, 1.3, iv1 - iv0 - 6); ctx.fillRect(iu0 + 13, iv0 + 3, 1.3, iv1 - iv0 - 6); }   // 四面阵列
      blk(iu0 + 18, iu1 - 4, iv0 + 2.4, iv1 - 2.4, '#acb3b8');   // 驾驶室
      ctx.fillStyle = real ? '#28394a' : rgba(STRUCT, .55); ctx.fillRect(iu1 - 5, iv0 + 3, 1, iv1 - iv0 - 6); ctx.fillRect(iu0 + 18, iv0 + 2.4, iu1 - iu0 - 22, .8);   // 前窗、舷内侧窗（飞行指挥所）
      const mu = iu0 + 24, ra = dead ? 0 : time * 2.2;
      ctx.fillStyle = real ? '#bfc5c9' : 'rgba(2,10,6,1)'; ctx.beginPath();
      for (let i = 0; i < 8; i++) { const b = i / 8 * 6.283 + .39; ctx.lineTo(mu + Math.cos(b) * 3.4, im + Math.sin(b) * 3.4); }
      ctx.closePath(); ctx.fill(); ctx.stroke();   // 一体化桅杆
      ctx.fillStyle = real ? '#e2e5e6' : 'rgba(2,10,6,1)'; ctx.beginPath(); ctx.arc(mu, im, 1.6, 0, 7); ctx.fill(); ctx.stroke();   // 顶部天线罩
      ctx.strokeStyle = real ? '#3a4249' : rgba(STRUCT, .8); ctx.lineWidth = lw(1.1);
      ctx.beginPath(); ctx.moveTo(mu - 6 - Math.cos(ra) * 2.4, im - Math.sin(ra) * 2.4); ctx.lineTo(mu - 6 + Math.cos(ra) * 2.4, im + Math.sin(ra) * 2.4); ctx.stroke();   // 导航雷达
      ctx.fillStyle = rgba(dead ? COL.enemy : COL.g, .5 + .5 * Math.sin(time * 4)); ctx.beginPath(); ctx.arc(iu1 - 2, im, lw(1.8), 0, 7); ctx.fill();
    }
    // 甲板停机：待命（青）、整备中（琥珀 + 进度）；机库里的飞机不画，只在舰下状态点里
    const park = cvPark(c, wing);
    for (const [id, j] of park) {
      const [u, v, r] = CVG.slots[j], w = wing.find(o => o.id === id);
      if (!w) continue;
      const rearm = w.state === 'rearm', cl = rearm ? COL.amber : COL.intel, key = airSilKey(w.type, w.v), sz = airSpec(w.type, w.v).size || 15;
      if (det < 80) { ctx.fillStyle = rgba(cl, rearm ? .55 : .9); ctx.fillRect(u - 4, v - 4, 8, 8); continue; }
      drawAircraft(ctx, u, v, r, key, sz, cl, rearm ? .7 : 1, 0, lw(1.1), w.type === 'bomber' && !rearm, { fold: true, still: true, t: time });   // 停在甲板上：外翼折起
      if (rearm && det >= 160) {
        ctx.strokeStyle = rgba(COL.amber, .8); ctx.lineWidth = lw(1.4);
        ctx.beginPath(); ctx.arc(u, v, sz * .5, -1.57, -1.57 + (1 - clamp(w.rearmT / AIR_REARM, 0, 1)) * 6.283); ctx.stroke();
      }
    }
    // 弹射官：飞机挂上弹射器时站在一旁，弹射那一刻蹲下、手臂指向舰首（黄衣）
    if (det >= 220 && typeof cvShooters === 'function' && typeof manDraw === 'function') for (const o of cvShooters(c, live)) manDraw(ctx, o.u, o.v, o.a, 'deck', COL.g, 'p', { ...MAN_IDLE, k: .5, kneel: o.go, jc: '#e8c33a', point: o.go, t: time }, real);
  }
  if (dead) {   // 甲板火灾
    CVG.fires.forEach(([u, v], i) => {
      const r = 14 + 5 * Math.sin(time * 9 + i * 1.7), g = ctx.createRadialGradient(u, v, 0, u, v, r);
      g.addColorStop(0, rgba('#fff3d6', .85)); g.addColorStop(.35, rgba(COL.amber, .7)); g.addColorStop(1, rgba(COL.enemy, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(u, v, r, 0, 7); ctx.fill();
    });
  }
  if (S.t < (c.exposedUntil || 0) && !dead && c.y - coastAt(c.x) < 760) {   // 起降作业暴露（处于岸防炮可及海域）
    ctx.strokeStyle = rgba(COL.enemy, .35 + .35 * Math.sin(time * 10)); ctx.lineWidth = lw(1.5); ctx.setLineDash([lw(5), lw(4)]);
    ctx.beginPath(); ctx.ellipse(0, -3, 192, 60, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
  if (sel) {   // 选中：四角括线
    ctx.strokeStyle = COL.sel; ctx.lineWidth = lw(2.2);
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const vv = sv < 0 ? -46 : 38;
      ctx.beginPath(); ctx.moveTo(su * 168, vv - sv * 16); ctx.lineTo(su * 168, vv); ctx.lineTo(su * 140, vv); ctx.stroke();
    }
  }
  ctx.restore();
  if (dead) {   // 黑烟向东北飘散
    for (let i = 0; i < 6; i++) {
      const ph = (time * .25 + i / 6) % 1, sx = c.x + 30 + ph * 200, sy = c.y - 15 - ph * 100, r = (16 + ph * 48) * Math.max(1, k * .7);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, rgba(COL.smoke, .22 * (1 - ph))); g.addColorStop(1, rgba(COL.smoke, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
    }
  }
  if (R.m3d) return;   // 3D：耐久与联队状态看底部单位卡，不在海面上铺一条平的状态条
  // 舰体下方：甲板耐久条 + 联队状态点（侦察 ○、攻击 △、对地支援 ◇）
  const ey = (160 * Math.abs(Math.sin(c.heading)) + 40 * Math.abs(Math.cos(c.heading))) * k;
  const bw = clamp(100 * k, px(46), px(130)), by = c.y + ey + px(7), f = clamp(c.hp / c.maxhp, 0, 1);
  ctx.fillStyle = rgba(col, .2); ctx.fillRect(c.x - bw / 2, by, bw, px(3));
  ctx.fillStyle = f > .5 ? COL.g : f > .25 ? COL.amber : COL.enemy; ctx.fillRect(c.x - bw / 2, by, bw * f, px(3));
  const gap = px(6.5), list = AIR_TYPES.flatMap(t => wing.filter(w => w.type === t)), tw = list.length * gap + px(5) * 2;
  let x = c.x - tw / 2 + gap / 2, prev = null;
  const yy = by + px(9), r = px(2.3);
  for (const w of list) {
    if (prev && prev !== w.type) x += px(5);
    prev = w.type;
    const st = w.state, cl = st === 'deck' ? (dead ? COL.amber : COL.intel) : st === 'rearm' ? COL.amber : st === 'lost' ? COL.enemy : COL.intel;
    ctx.strokeStyle = rgba(cl, st === 'lost' ? .4 : .95); ctx.fillStyle = rgba(cl, .95); ctx.lineWidth = px(1.1);
    if (st === 'lost') { ctx.beginPath(); ctx.moveTo(x - r, yy - r); ctx.lineTo(x + r, yy + r); ctx.moveTo(x + r, yy - r); ctx.lineTo(x - r, yy + r); ctx.stroke(); }
    else {
      ctx.beginPath();
      if (w.type === 'recon') ctx.arc(x, yy, r, 0, 7);
      else if (w.type === 'strike') { ctx.moveTo(x, yy - r * 1.2); ctx.lineTo(x + r * 1.1, yy + r * .9); ctx.lineTo(x - r * 1.1, yy + r * .9); ctx.closePath(); }
      else if (w.type === 'bomber') ctx.rect(x - r * 1.1, yy - r * 1.1, r * 2.2, r * 2.2);
      else if (w.type === 'fighter') { ctx.moveTo(x - r * 1.2, yy - r * .9); ctx.lineTo(x, yy + r * 1.1); ctx.lineTo(x + r * 1.2, yy - r * .9); ctx.lineTo(x, yy - r * .2); ctx.closePath(); }   // 战斗机：V 形
      else { ctx.moveTo(x, yy - r * 1.25); ctx.lineTo(x + r * 1.1, yy); ctx.lineTo(x, yy + r * 1.25); ctx.lineTo(x - r * 1.1, yy); ctx.closePath(); }
      if (st === 'deck') ctx.fill(); else ctx.stroke();
      if (st === 'rearm') { ctx.save(); ctx.clip(); const p = 1 - clamp(w.rearmT / AIR_REARM, 0, 1); ctx.fillRect(x - r * 1.3, yy + r * 1.3 - p * r * 2.6, r * 2.6, p * r * 2.6); ctx.restore(); }
    }
    x += gap;
  }
  const g = !h && typeof groupOf === 'function' ? groupOf('CV') : 0;
  if (g && typeof pips === 'function') pips(ctx, g, c.x, yy + px(7), COL.sel);
}

function drawPlanes(time) {
  const ctx = R.ctx, c = S.cv, k = c ? cvScale() : 1, big = n => Math.max(n, px(20));
  ctx.fillStyle = rgba(COL.intel, .16);
  for (const r of S.recon) ctx.fillRect(r.x - 1, r.y - 1, 2, 2);
  if (AIR_TRAILS.size) { const ids = new Set(S.planes.map(p => p.id)); for (const id of [...AIR_TRAILS.keys()]) if (!ids.has(id)) AIR_TRAILS.delete(id); }
  // 被击落：翻滚、拖着黑烟坠落
  for (const w of (S.air && S.air.wrecks) || []) {
    const age = S.t - w.t, u = clamp(age / 2.2, 0, 1);
    if (age < 0 || age > 2.2) continue;
    for (let j = 1; j <= 6; j++) {
      const a2 = age - j * .09;
      if (a2 < 0) break;
      const [sx, sy] = airWreckPos(w, a2);
      ctx.fillStyle = rgba(COL.smoke, .3 * (1 - j / 7)); ctx.beginPath(); ctx.arc(sx, sy, px(2) + j * 1.2, 0, 7); ctx.fill();
    }
    const [x, y] = airWreckPos(w, age);
    drawAircraft(ctx, x, y, w.h + age * 5, airSilKey(w.kind, w.v), big(airSpec(w.kind, w.v).size) * (1 - u * .55), COL.amber, 1 - u * .6, Math.sin(age * 9), px(1.3), false);
  }
  for (const p of S.planes) {
    if (p.dead) continue;
    const sp = airSpec(p.kind, p.v), onDeck = !p.land && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap');
    const air = clamp((p.alt || 0) * 1.6, 0, 1), size = lerp(sp.size * k, big(sp.size), air);   // 甲板上按真实尺寸画
    const sink = onDeck && typeof cvDeckSink === 'function' ? cvDeckSink(p) : 0;   // 升降机上：降到甲板以下时变暗（还在机库里没升上来的不画）
    if (onDeck && p.dk === 'lift' && !p.up) continue;
    let x = p.x, y = p.y;
    if (onDeck && c && k > 1) { const cc = cvOf(cvHome(p)) || c, [u, v] = cvL(p.x, p.y, cc); [x, y] = cvW(u * k, v * k, cc); }
    if (!isFinite(x) || !isFinite(y)) continue;
    // 任务标记
    if (p.phase === 'loiter' && p.kind !== 'fighter') {   // 战斗机的巡逻圈在 airwar.js 画
      ctx.strokeStyle = rgba(COL.intel, .4); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(5)]); ctx.lineDashOffset = -time * 20 * (p.odir || 1);
      ctx.beginPath(); ctx.arc(p.cx, p.cy, 110, 0, 7); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.strokeStyle = rgba(COL.intel, .7); ctx.lineWidth = px(2);
      ctx.beginPath(); ctx.arc(p.cx, p.cy, 118, -1.57, -1.57 + clamp(p.loiterT / 40, 0, 1) * 6.283); ctx.stroke();
      ctx.strokeStyle = rgba(COL.intel, .12); ctx.lineWidth = px(1); ctx.beginPath(); ctx.arc(p.cx, p.cy, 160, 0, 7); ctx.stroke();
    } else if (p.phase === 'out' && p.kind === 'recon') {
      const e = p.wp[p.wp.length - 1];
      ctx.strokeStyle = rgba(COL.intel, .3); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(6)]);
      ctx.beginPath(); ctx.moveTo(x, y); for (let i = Math.min(p.leg, p.wp.length - 1); i < p.wp.length; i++) ctx.lineTo(p.wp[i].x, p.wp[i].y); ctx.stroke();
      ctx.beginPath(); ctx.arc(e.x, e.y, px(4), 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 100, time * 2, time * 2 + 4.5); ctx.stroke(); ctx.setLineDash([]);
    } else if (p.phase === 'out' && p.kind === 'strike' && !p.dropped) {
      ctx.strokeStyle = rgba(COL.amber, .55 + .3 * Math.sin(time * 6)); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(3)]);
      ctx.beginPath(); ctx.arc(p.tx, p.ty, POWER.bomb.R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(p.tx - px(6), p.ty); ctx.lineTo(p.tx + px(6), p.ty); ctx.moveTo(p.tx, p.ty - px(6)); ctx.lineTo(p.tx, p.ty + px(6)); ctx.stroke();
    } else if (p.phase === 'out' && p.kind === 'cas') {
      ctx.strokeStyle = rgba(COL.intel, .25); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(5)]);
      ctx.beginPath(); ctx.arc(p.tx, p.ty, 110, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    if (R.m3d) continue;   // 3D：飞机是立体模型，按海拔飞（v3units.js）；贴图里再画尾迹、投影、剪影就成了地面上的「倒影」
    // 尾迹（只在空中）
    if (air > .5) {
      let tr = AIR_TRAILS.get(p.id);
      if (!tr) AIR_TRAILS.set(p.id, tr = []);
      const l = tr[tr.length - 1];
      if (!l || dist(l[0], l[1], x, y) > 6) { tr.push([x, y]); if (tr.length > 26) tr.shift(); }
      ctx.lineWidth = px(1.3);
      for (let i = 1; i < tr.length; i++) {
        ctx.strokeStyle = rgba(COL.intel, .16 * i / tr.length * air);
        ctx.beginPath(); ctx.moveTo(tr[i - 1][0], tr[i - 1][1]); ctx.lineTo(tr[i][0], tr[i][1]); ctx.stroke();
      }
    }
    // 地面投影：高度越高偏得越远
    if (air > .05) {
      const o = size * .9 * air, sc = size / 21;
      ctx.save(); ctx.translate(x + o * .7, y + o); ctx.rotate(p.heading); ctx.scale(sc, sc * (1 - .32 * Math.min(1, Math.abs(p.bank || 0))));
      airShape(ctx, airSilKey(p.kind, p.v)); ctx.fillStyle = `rgba(0,0,0,${.38 * air})`; ctx.fill(); ctx.restore();
    }
    const rs = typeof airRelState === 'function' ? airRelState('p', p.id) : null;   // 弹舱开度、外挂消耗（airmdl.js）
    const dk = onDeck ? { fold: (p.fold ?? 0) > .5, cpo: p.cpo || 0, still: p.dk === 'brd' || (p.dk === 'lift' && !p.up), ab: p.phase === 'roll' || (p.phase === 'cat' && p.dk === 'hook' && p.dkT > 1.3) } : { ab: false };   // 甲板上：折翼、座舱盖开合、发动机没启动时旋翼 / 螺旋桨不转、弹射前加力
    drawAircraft(ctx, x, y, p.heading, airSilKey(p.kind, p.v), size, COL.intel, 1 - sink * .65, p.bank, px(1.4), p.kind === 'bomber' && !p.dropped, { t: time, ...dk, ...rs });   // 歼-35 内埋弹舱：不画外挂炸弹
    if (onDeck && p.dk === 'brd' && typeof cvPilotDraw === 'function') cvPilotDraw(ctx, p, k, time);   // 飞行员跑向飞机、爬梯进座舱
    if (p.gunT > 0) {   // 机炮口焰
      const nx = x + Math.cos(p.heading) * size * .55, ny = y + Math.sin(p.heading) * size * .55;
      ctx.fillStyle = rgba('#fff3d6', .5 + .5 * Math.sin(time * 60)); ctx.beginPath(); ctx.arc(nx, ny, size * .14, 0, 7); ctx.fill();
    }
  }
}

function arrowAir(ctx, x, y, a, col) {
  const l = px(14);
  ctx.strokeStyle = col; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); ctx.lineTo(x, y);
  ctx.moveTo(x - Math.cos(a - .5) * l * .6, y - Math.sin(a - .5) * l * .6); ctx.lineTo(x, y); ctx.lineTo(x - Math.cos(a + .5) * l * .6, y - Math.sin(a + .5) * l * .6); ctx.stroke();
}

// 出击工具预览（render3.js drawTool 调用）：侦察航带、三连弹落点、盘旋圈；无可用飞机时显示为红色
function drawAirTool(time) {
  const t = U.tool, m = U.mouse;
  if (!m || (t !== 'recon' && t !== 'strike' && t !== 'cas' && t !== 'bomber' && t !== 'fighter')) return false;
  const land = S.air && S.air.wing.some(w => w.type === t && w.state === 'deck' && airLandW(w));   // 陆基飞机不需要航母
  const ctx = R.ctx, c = cvAll().filter(o => o.hp > 0).sort((a, b) => dist(a.x, a.y, m.x, m.y) - dist(b.x, b.y, m.x, m.y))[0] || S.cv, ok = !!(S.assets && S.assets[t] > 0 && (land || (c && c.hp > 0))), col = ok ? COL.intel : COL.enemy;
  const ox = land || !c || !(c.hp > 0) ? m.x : c.x, oy = land || !c || !(c.hp > 0) ? H : c.y, a = Math.atan2(m.y - oy, m.x - ox);
  ctx.lineWidth = px(1.2); ctx.strokeStyle = rgba(col, .35); ctx.setLineDash([px(3), px(5)]);
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(m.x, m.y); ctx.stroke();
  if (t === 'recon') {
    const [bx, by] = airRay(m.x, m.y, a, 700), nx = -Math.sin(a) * 100, ny = Math.cos(a) * 100;
    ctx.fillStyle = rgba(col, .08);
    ctx.beginPath(); ctx.moveTo(m.x + nx, m.y + ny); ctx.lineTo(bx + nx, by + ny); ctx.lineTo(bx - nx, by - ny); ctx.lineTo(m.x - nx, m.y - ny); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(col, .55); ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = rgba(col, .38); ctx.beginPath(); ctx.moveTo(m.x + nx, m.y + ny); ctx.lineTo(bx + nx, by + ny); ctx.moveTo(m.x - nx, m.y - ny); ctx.lineTo(bx - nx, by - ny); ctx.stroke();
  } else if (t === 'bomber') {   // 会出击的变体：点目标 → 俯冲轰炸机（单个小圈）；其余 → 重型轰炸机（六弹地毯）
    const pt = S.enemies.some(e => !e.dead && e.kx != null && dist(e.kx, e.ky, m.x, m.y) < 40), has = v => S.air.wing.some(w => w.type === 'bomber' && w.state === 'deck' && (w.v || 'heavy') === v);
    const dive = pt ? has('dive') || !has('heavy') : !has('heavy') && has('dive');
    ctx.strokeStyle = rgba(ok ? COL.amber : COL.enemy, .9); ctx.lineWidth = px(1.7);
    const offs = dive ? [0] : [-2.5, -1.5, -.5, .5, 1.5, 2.5].map(i => i * 26);
    for (const o of offs) {
      const bx = m.x + Math.cos(a) * o, by = m.y + Math.sin(a) * o;
      ctx.setLineDash([px(3), px(4)]); ctx.beginPath(); ctx.arc(bx, by, dive ? 14 : POWER.bomb.R, 0, 7); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(bx, by, px(2.5), 0, 7); ctx.stroke();
    }
    arrowAir(ctx, m.x - Math.cos(a) * 110, m.y - Math.sin(a) * 110, a, rgba(ok ? COL.amber : COL.enemy, .9));
  } else if (t === 'strike' && (() => { const w = S.air && S.air.wing.find(o => o.type === 'strike' && o.state === 'deck'); return airMdl('strike', w ? w.v : null).std; })()) {   // 歼-35：精确制导，防区外投放
    const w = S.air.wing.find(o => o.type === 'strike' && o.state === 'deck'), M = airMdl('strike', w ? w.v : null);
    ctx.strokeStyle = rgba(ok ? COL.amber : COL.enemy, .9); ctx.lineWidth = px(1.7);
    ctx.setLineDash([]); ctx.beginPath(); ctx.arc(m.x, m.y, 10, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(m.x - 14, m.y); ctx.lineTo(m.x + 14, m.y); ctx.moveTo(m.x, m.y - 14); ctx.lineTo(m.x, m.y + 14); ctx.stroke();
    ctx.setLineDash([px(4), px(4)]); ctx.beginPath(); ctx.arc(m.x, m.y, M.std, a + Math.PI - .5, a + Math.PI + .5); ctx.stroke();   // 投放线：飞机在这里投弹后掉头
    arrowAir(ctx, m.x - Math.cos(a) * (M.std + 40), m.y - Math.sin(a) * (M.std + 40), a, rgba(ok ? COL.amber : COL.enemy, .9));
  } else if (t === 'strike') {
    ctx.strokeStyle = rgba(ok ? COL.amber : COL.enemy, .9); ctx.lineWidth = px(1.7);
    for (let i = 0; i < 3; i++) {
      const o = (i - 1) * 34, bx = m.x + Math.cos(a) * o, by = m.y + Math.sin(a) * o;
      ctx.setLineDash([px(3), px(4)]); ctx.beginPath(); ctx.arc(bx, by, POWER.bomb.R, 0, 7); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(bx, by, px(2.5), 0, 7); ctx.stroke();
    }
    arrowAir(ctx, m.x - Math.cos(a) * 90, m.y - Math.sin(a) * 90, a, rgba(ok ? COL.amber : COL.enemy, .9));
  } else if (t === 'fighter') {   // 战斗机：巡逻圈与拦截搜索范围（airwar.js）
    ctx.strokeStyle = rgba(col, .7); ctx.lineDashOffset = -time * 14;
    ctx.beginPath(); ctx.arc(m.x, m.y, typeof AW_CAP === 'number' ? AW_CAP : 160, 0, 7); ctx.stroke(); ctx.lineDashOffset = 0;
    ctx.strokeStyle = rgba(col, .18); ctx.beginPath(); ctx.arc(m.x, m.y, typeof AW_RNG === 'number' ? AW_RNG : 700, 0, 7); ctx.stroke();
  } else {
    ctx.strokeStyle = rgba(col, .6); ctx.lineDashOffset = -time * 20;
    ctx.beginPath(); ctx.arc(m.x, m.y, 110, 0, 7); ctx.stroke(); ctx.lineDashOffset = 0;
    ctx.strokeStyle = rgba(col, .2); ctx.beginPath(); ctx.arc(m.x, m.y, 160, 0, 7); ctx.stroke();
  }
  ctx.setLineDash([]);
  return true;
}
