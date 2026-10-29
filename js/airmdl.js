'use strict';
// 飞机精细俯视模型（只是画面）：drawAircraft（carrier.js）在飞机够大时改调这里——
//   分件画：机翼（襟副翼、前缘）、平尾 / 鸭翼、机身（按西北光源的圆柱明暗、背脊线、口盖线）、发动机短舱、进气道、
//   座舱盖（隐身机金色镀膜）、外倾双垂尾、喷口（加力时尾焰）、机徽、外挂弹药（打掉一枚少一枚）、
//   内埋弹舱（开舱时舱门翻出、弹舱里的弹露出来）、旋翼 / 尾桨 / 螺旋桨、背负雷达罩，舰载机停在甲板上时外翼折起
// 坐标：机头 +x、右翼 +y，与 AIR_SIL 同一单位（机长约 22），只写右半边，画时左右镜像
//   body 机身半宽剖面 [x, 半宽]（机头 → 机尾）；wing / stab / cnd 右半边多边形；hi 上单翼（机翼盖在机身上）；tt T 形尾（平尾在垂尾顶上）
//   fin 垂尾 [根部前缘 x, 根弦长, 根部 y, 高, 外倾角, 梢部后掠]；cp 座舱 [前缘 x, 后缘 x, 半宽, 形式 bubble / tandem / win]
//   inl 进气道 [前 x, 后 x, 外缘 y, 宽, side / top]；noz 喷口 [x, y, r] 或 [x, y, 半宽, 深, 'flat']；nac 短舱 [前 x, 后 x, y, r, 上 / 下]
//   bay 主弹舱 [前 x, 后 x, 半宽, 中心 y]；sbay 侧弹舱 [前 x, 后 x, y]；st 外挂 [x, y, 种类]；mk 机徽 [x, y, r]
//   fold 机翼折叠线 y；rot 旋翼 [毂 x, 半径, 桨叶数]；tr 尾桨 [x, y, 半径]；prop 螺旋桨 [x, y, 半径, 叶数, 推进式]；dome 雷达罩 [x, r]
const AIRD = {
  j35: { paint: '#7a838a', glass: 'gold', nat: 'pla',
    body: [[11.2, 0], [10.4, .3], [9.2, .62], [7.8, .92], [6.4, 1.15], [5, 1.38], [3.8, 1.75], [2.2, 2.1], [0, 2.25], [-3, 2.3], [-5.6, 2.25], [-7.6, 2.05], [-9.2, 1.85], [-10.5, 1.6]],
    wing: [[1.4, 2.1], [-3.2, 7.6], [-5.2, 7.6], [-5.6, 2.2]], stab: [[-6.9, 2], [-9.2, 5], [-10.6, 5], [-10.3, 1.7]],
    fin: [-5.2, 3.6, 1.7, 3.1, .45, 2.2], cp: [4.6, 8.2, .6, 'bubble'], inl: [[4.4, 2.3, 1.45, .55, 'side']], noz: [[-10.55, .82, .7]],
    bay: [2.4, -3.6, 1.5, 0], mk: [[-2.9, 5.3, .8]], fold: 5.2 },
  j15: { paint: '#8c959b', glass: 'blue', nat: 'pla',
    body: [[11.6, 0], [10.8, .3], [9.6, .6], [8.2, .85], [6.8, 1], [5.4, 1.15], [4.2, 1.4], [2.4, 2], [0, 2.5], [-3, 2.6], [-6, 2.55], [-8.6, 2.35], [-10.4, 2.15], [-11, 2.05]],
    tail: [[-9.4, .55], [-12.4, .38], [-12.8, 0]],   // 两台发动机之间的尾椎
    wing: [[4.6, 1.3], [2.2, 2.6], [.3, 3], [-4, 9.2], [-5.6, 9.2], [-5.2, 2.7]], cnd: [[4.9, 1.25], [3, 4.1], [2.1, 4.1], [2.5, 1.4]], stab: [[-7.2, 2.6], [-9.6, 6.6], [-11.2, 6.6], [-10.6, 2.3]],
    fin: [-6.2, 3.6, 1.95, 3.6, .08, 2.8], cp: [6.2, 9.2, .58, 'bubble'], noz: [[-11.1, 1.35, .82]], nac: [[-.6, -11, 1.38, .95, 'up', 1]],
    st: [[-4.6, 9.4, 'aam'], [-1.4, 5.8, 'asm'], [-.6, 3.9, 'aam']], mk: [[-3.6, 7.2, .85]], fold: 6 },
  j20: { paint: '#6c757c', glass: 'gold', nat: 'pla',
    body: [[11.6, 0], [10.8, .28], [9.6, .55], [8.2, .82], [6.8, 1.05], [5.4, 1.3], [4, 1.55], [2.4, 1.85], [0, 2.05], [-3, 2.1], [-6, 2.05], [-8.4, 1.9], [-10.2, 1.65], [-11.2, 1.45]],
    wing: [[2.8, 1.9], [1.6, 2.1], [-6, 8.6], [-7.6, 8.6], [-6.9, 2]], cnd: [[5.3, 1.3], [3.4, 4.4], [2.6, 4.4], [2.7, 1.55]],
    fin: [-6.6, 3.2, 1.5, 2.9, .55, 2.4], cp: [6, 9.4, .55, 'bubble'], inl: [[5, 2.8, 1.45, .55, 'side']], noz: [[-11.15, .72, .66]],
    bay: [2, -3.8, 1.45, 0], sbay: [3.4, 1.6, 2], mk: [[-4.8, 6.1, .85]] },
  j36: { paint: '#5f676e', glass: 'gold', nat: 'pla',
    body: [[12.6, 0], [11.8, .35], [10.6, .75], [9.2, 1.15], [7.6, 1.55], [5.6, 1.9], [3, 2.15], [0, 2.25], [-4, 2.25], [-8, 2.15], [-10.8, 2], [-12.1, 1.8]],
    wing: [[8.2, 1.6], [5.6, 2.6], [1, 5.4], [-5.8, 10.3], [-7.4, 10.3], [-6.4, 6], [-10.6, 2.8], [-11.6, 2.2]], ctl: 'elevon',
    cp: [7.6, 10.6, .6, 'bubble'], inl: [[5.4, 3.6, 1.95, .5, 'side'], [3.4, 1.2, 0, 1.5, 'top']], noz: [[-12.1, 0, .62, .45, 'flat'], [-12, 1.45, .6, .42, 'flat']],
    split: [-6, 10, -7.4], bay: [3.2, -4.8, 1.7, 0], mk: [[-4.6, 7.2, .9]] },
  j50: { paint: '#6a7279', glass: 'gold', nat: 'pla',
    body: [[11.2, 0], [10.2, .4], [8.8, .8], [7, 1.2], [5, 1.6], [2.4, 1.95], [0, 2.05], [-3, 2.05], [-6, 1.95], [-8.4, 1.7], [-9.6, 1.35]],
    wing: [[5, 1.8], [1.6, 2.4], [-4.4, 8.2], [-6, 8.2], [-5.4, 5.2], [-8.4, 3.4], [-10.2, 2.4], [-9.6, 1]], ctl: 'elevon', tip: [-3.4, 7]   // 全动翼尖
    , cp: [5.8, 8.9, .55, 'bubble'], inl: [[4.4, 2.6, 1.55, .5, 'side']], noz: [[-9.7, .7, .6]], bay: [2.2, -3.8, 1.4, 0], mk: [[-4.3, 6, .8]] },
  gj11: { paint: '#5f676e', nat: 'pla',
    wing: [[8, 0], [5, 2], [-3, 10.5], [-5, 10.5], [-5.6, 8], [-3.6, 6], [-7, 3.4], [-9, 0]], ctl: 'elevon', flat: true,
    body: [[7.6, 0], [6.4, .8], [4, 1.4], [0, 1.6], [-4, 1.5], [-7.2, 1], [-8.4, .5]],
    inl: [[4.8, 2.6, 0, .95, 'top']], noz: [[-8.3, 0, .55, .3, 'flat']], bay: [2.2, -2.8, 1.1, 0], mk: [[-2.6, 6.8, .75]] },
  gj2: { paint: '#b5bcc0', nat: 'pla',
    body: [[9.2, 0], [8.6, .6], [7.6, .95], [5, 1.1], [2, 1.1], [-1, 1], [-4, .8], [-7, .6], [-9.4, .45], [-10, .3]], hump: [6.3, 1.7, .95],   // 卫星通信天线鼓包
    wing: [[1.7, 1], [1.15, 10.5], [-.85, 10.5], [-1.3, 1]], hi: true, stab: [[-7, .55], [-9.6, 3.6], [-10.6, 3.6], [-9.3, .45]],
    prop: [[-10.2, 0, 1.7, 3, true]], st: [[1.25, 3.4, 'agm'], [1.2, 5.6, 'agm']], mk: [[-.2, 8.2, .7]] },
  wz7: { paint: '#b0b8bd', nat: 'pla',
    body: [[9.2, 0], [8.4, .55], [7, .9], [4, 1.15], [0, 1.2], [-4, 1.15], [-7, 1], [-9.4, .7], [-10.5, .3]],
    wing: [[3.2, 1.1], [-4.4, 9.8], [-5.4, 9.8], [-1, 1.1]], wing2: [[-4.9, 9.3], [-5.9, 9.5], [-9.4, 1.4], [-7.9, 1.4]],
    fin: [-7.4, 2.2, 1.1, 2.2, .7, 1], inl: [[-1.6, -3.8, 0, .75, 'top']], noz: [[-10.4, 0, .45]], mk: [[-1.6, 5.6, .7]] },
  kj600: { paint: '#b0b7bb', nat: 'pla', fold: 5.6, foldBack: true, door: [-2.8, 1.1, 1.6],   // 外翼在发动机短舱外侧向后折到机身两侧（同 E-2 的斜轴折叠：前缘朝下、上表面朝外）；door：机身左侧机翼后方的登机门 [x, 机身半宽, 门槛离甲板高（米）]
    body: [[10.2, 0], [9.6, .7], [8.4, 1.2], [6, 1.45], [3, 1.5], [0, 1.45], [-3, 1.3], [-6, 1.1], [-8.6, .8], [-10, .4]],
    wing: [[3.1, 1.4], [2.4, 10.5], [-.6, 10.5], [-1.3, 1.4]], hi: true, stab: [[-7.2, 1], [-7.8, 4.6], [-9.6, 4.6], [-9.5, .8]],
    fin4: [[-7.5, 2.1, 4.5, 2.8], [-7.5, 2.1, 1.75, 2.8]], nac: [[4.8, -2.2, 4.2, .72, 'up']], prop: [[4.95, 4.2, 2.6, 8]], dome: [-1.8, 3.6],
    cp: [8.4, 9.7, 1, 'win'], mk: [[-.2, 7.6, .75]] },
  h6k: { paint: '#a7aeb3', nat: 'pla',
    body: [[11.6, 0], [11, .6], [10, 1.05], [8.4, 1.35], [6, 1.5], [3, 1.55], [0, 1.5], [-3, 1.4], [-6, 1.2], [-8.6, .95], [-10.4, .7], [-11.6, .35]],
    nac: [[4.8, -4.6, 2.35, .95, 'up']], wing: [[2.6, 2.4], [-1, 11.2], [-3.1, 11.2], [-2.8, 2.4]], stab: [[-7.4, 1], [-8.6, 4.6], [-10.2, 4.6], [-10.2, .8]],
    fin: [-6.4, 4, 0, 4.2, 0, 2.6], cp: [9.6, 10.9, 1.1, 'win'], st: [[-.4, 4.9, 'cm'], [-.9, 7.3, 'cm'], [-1.5, 9.3, 'cm']], mk: [[-2.2, 9.9, .8]] },
  y20: { paint: '#a4acb1', nat: 'pla',
    body: [[11.7, 0], [11.2, .75], [10.4, 1.25], [9, 1.65], [6, 1.8], [0, 1.8], [-4, 1.75], [-7.4, 1.5], [-9.6, 1], [-11.6, .6], [-12.4, .3]],
    wing: [[2.8, 1.8], [-3, 11.6], [-4.4, 11.6], [-1.7, 1.8]], hi: true, tt: true, stab: [[-8.6, 1.2], [-11, 5.4], [-12.1, 5.4], [-11.4, .7]],
    fin: [-7.6, 3.4, 0, 4, 0, 2.6], nac: [[2.6, -.6, 4.6, .75, 'dn'], [.6, -2.6, 8.3, .72, 'dn']], cp: [10.2, 11.2, 1.15, 'win'], mk: [[-2.6, 9.6, .85]] },
  c17: { paint: '#7d858a', nat: 'us',
    body: [[11.5, 0], [11, .8], [10.2, 1.4], [8.6, 1.9], [5, 2], [0, 2], [-4, 1.95], [-7.4, 1.6], [-9.6, 1.1], [-11.6, .6], [-12.2, .3]],
    wing: [[2.4, 2], [-4.4, 10.9], [-5.6, 11.2], [-1.6, 2]], hi: true, tt: true, wl: true, stab: [[-8.4, 1.3], [-10.8, 5.2], [-12, 5.2], [-11.4, .8]],
    fin: [-7.4, 3.4, 0, 4.2, 0, 2.8], nac: [[1.6, -1.6, 4.6, .8, 'dn'], [-.4, -3.6, 7.8, .8, 'dn']], cp: [10, 11.1, 1.3, 'win'], mk: [[-3.6, 8.8, .85]] },
  z10: { paint: '#5d6650', nat: 'pla', heli: true,
    body: [[8.7, 0], [8.5, .5], [7.6, .85], [7, 1], [5, 1.2], [3, 1.35], [1, 1.45], [-1, 1.45], [-3, 1.15], [-5, .65], [-8, .45], [-10.6, .4], [-12.6, .3]],
    wing: [[.5, 1.4], [.4, 3.8], [-1.2, 3.8], [-1.3, 1.4]], stab: [[-10.4, .4], [-10.8, 2.4], [-12, 2.4], [-12, .35]], fin: [-11, 1.6, 0, 2.4, 0, .9],
    nac: [[.6, -2.8, .95, .5, 'up']], cp: [3.8, 7.6, .78, 'tandem'], st: [[-.4, 2.45, 'atgm4'], [-.4, 3.55, 'atgm4']], rot: [.6, 9.5, 5], tr: [-12.4, -.55, 1.5], mk: [[-6.6, 0, .55]] },
  ah64: { paint: '#3f4433', nat: 'us', heli: true,
    body: [[8.6, 0], [8.45, .5], [7.9, .72], [7, .9], [5.4, 1.15], [3.6, 1.25], [2.4, 1.3], [1, 1.4], [-1.2, 1.4], [-2.8, 1.1], [-4, .75], [-7, .5], [-10.6, .45], [-12.6, .35]],
    wing: [[.7, 1.3], [.55, 4.3], [-1.35, 4.3], [-1.45, 1.3]], stab: [[-10.6, .45], [-10.9, 2.7], [-12.1, 2.7], [-12.2, .4]], fin: [-10.8, 1.8, 0, 2.6, 0, 1],
    nac: [[2.6, -2.9, 1.9, .55, 'up']], cp: [3.6, 7.4, .72, 'tandem'], st: [[-.35, 2.85, 'atgm4'], [-.35, 4.05, 'pod']], rot: [.4, 9.5, 4], tr: [-12.3, -.6, 1.4], radome: true },
  uh60: { paint: '#3f4536', nat: 'us', heli: true,
    body: [[8.1, 0], [8, .9], [7.4, 1.6], [6.4, 2.2], [5.2, 2.42], [1, 2.5], [-2, 2.45], [-3.2, 2], [-4.6, 1], [-7, .65], [-11, .55], [-12.8, .35]],
    stab: [[-11, .55], [-11.2, 2.8], [-12.4, 2.8], [-12.5, .5]], fin: [-11.2, 1.8, 0, 2.6, 0, 1], nac: [[2.2, -1.8, .75, .5, 'up']],
    cp: [5.6, 7.6, 1.6, 'win'], cabin: true, rot: [.6, 10.5, 4], tr: [-12.6, .6, 1.6] },
  f35: { paint: '#5e666d', glass: 'gold', nat: 'us',
    body: [[10.6, 0], [9.8, .32], [8.6, .65], [7.2, .98], [5.8, 1.3], [4.4, 1.75], [3, 2.15], [1, 2.4], [-2, 2.45], [-5, 2.4], [-7, 2.2], [-8.6, 1.8], [-9.6, 1.35], [-10.3, 1]],
    wing: [[.8, 2.25], [-3.6, 7.2], [-5.4, 7.2], [-5.8, 2.35]], stab: [[-7.1, 2.15], [-9, 4.6], [-10.2, 4.6], [-9.8, 1.5]],
    fin: [-5, 3.2, 1.7, 2.9, .45, 2], cp: [4, 7.6, .62, 'bubble'], inl: [[4.4, 2.6, 1.7, .55, 'side']], noz: [[-10.4, 0, .85, 'serr']],
    bay: [2.6, -3, .85, 1.15], mk: [[-3.2, 5.2, .7]] },
  f22: { paint: '#6e767c', glass: 'gold', nat: 'us',
    body: [[10.8, 0], [10, .3], [8.8, .62], [7.4, .95], [6, 1.25], [4.6, 1.7], [3, 2.25], [1, 2.5], [-2, 2.55], [-5, 2.5], [-7.4, 2.3], [-9, 2], [-10.4, 1.7]],
    wing: [[1.8, 2.5], [-2.8, 7.4], [-4.6, 7.4], [-6.2, 2.5]], stab: [[-6.7, 2.45], [-8.6, 5.4], [-9.8, 5.4], [-10.2, 1.8]],
    fin: [-4.6, 3.6, 2.05, 3, .5, 2.2], cp: [4.4, 8.4, .65, 'bubble'], inl: [[4.6, 2.6, 1.85, .6, 'side']], noz: [[-10.5, .9, .55, .35, 'flat']],
    bay: [2, -3.4, 1.4, 0], sbay: [3, 1.4, 2.35], mk: [[-2.9, 5.6, .7]] },
  a10: { paint: '#5c6660', glass: 'blue', nat: 'us',
    body: [[10.4, 0], [10, .35], [9.2, .75], [8, 1], [6, 1.15], [3, 1.2], [0, 1.2], [-3, 1.1], [-6, .95], [-8.4, .75], [-10.6, .5]], gun: true,
    wing: [[3.2, 1.15], [2.6, 9.4], [-.6, 9.4], [-1.3, 1.15]], stab: [[-8.2, .9], [-8.4, 4.8], [-10.4, 4.8], [-10.4, .8]],
    fin: [-8.2, 2.4, 4.75, 3.2, 0, .5], nac: [[-3.4, -7.2, 2.05, .85, 'up']], cp: [5.6, 8.2, .6, 'bubble'], pods: [1.4, 2.6],
    st: [[2.9, 3.7, 'agm'], [2.6, 5.2, 'bomb'], [2.9, 6.8, 'agm'], [2.4, 8.3, 'aam']], mk: [[.6, 7.4, .7]] },
  b2: { paint: '#4a5056', nat: 'us', flat: true,
    wing: [[5.6, 0], [4.8, .9], [-2.6, 11.4], [-3.5, 11.6], [-3.8, 11.1], [-1.2, 7.9], [-4.1, 4.7], [-2.1, 2.4], [-4.4, .7], [-4.4, 0]], ctl: 'elevon',
    body: [[5.4, 0], [4.6, .7], [3, 1.3], [1, 1.9], [-1.4, 2.1], [-3.6, 1.6], [-4.3, .6]],
    cp: [3.5, 4.5, .5, 'win'], inl: [[1.5, .3, 2.6, .55, 'top'], [1, -.2, 3.8, .55, 'top']], ex: [[-2.2, 1.6, 4.6]], bay: [1.8, -1.6, .8, .95], mk: [[-1.6, 8, .75]] }
};
// F-35B：机体同 F-35A，座舱后背上一块升力风扇舱门、其后的辅助进气门，弹舱短一些、机炮改外挂吊舱（腹部中线）
AIRD.f35b = { ...AIRD.f35, lift: [3.1, .3, .62], bay: [2.2, -2.4, .8, 1.15], mk: [[-3.2, 5.2, .7]] };
AIRD.mq9 = { ...AIRD.gj2, paint: '#9aa1a6', nat: 'us', st: [[1.25, 3.4, 'agm']], mk: [[-.2, 8.2, .7]] };   // MQ-9A：外形与攻击-2 同类（细长机身、直翼、V 尾、推进式螺旋桨），浅灰涂装，翼下一具光电吊舱
AIRD.heli = AIRD.z10; AIRD.transport = AIRD.y20;
const AIRV = { path: new Map() };   // 渲染缓存：Path2D（局部坐标，按机型 + 部件）

// —— 路径 ——
// 右半边多边形镜像成左右对称的一块（y = 0 上的点不重复）
function adSym(pts) {
  const p = new Path2D();
  pts.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y));
  for (let i = pts.length - 1; i >= 0; i--) if (pts[i][1] !== 0 || (i !== 0 && i !== pts.length - 1)) p.lineTo(pts[i][0], -pts[i][1]);
  p.closePath();
  return p;
}
// 左右两块（机翼、平尾等不过中线的部件）
function adPair(pts) {
  const p = new Path2D();
  for (const s of [1, -1]) { pts.forEach(([x, y], i) => i ? p.lineTo(x, y * s) : p.moveTo(x, y * s)); p.closePath(); }
  return p;
}
// 机身：半宽剖面连成光滑轮廓（相邻点之间二次曲线过中点）
function adBody(prof) {
  const p = new Path2D(), side = s => prof.map(([x, w]) => [x, w * s]);
  const R = side(1), L = side(-1).reverse(), pts = [...R, ...L.slice(R[R.length - 1][1] === 0 ? 1 : 0)];
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i], [nx, ny] = pts[i + 1]; p.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2); }
  p.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); p.closePath();
  return p;
}
// 折叠的机翼：只留折叠线以内
function adClipY(pts, y0) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (a[1] <= y0) out.push(a);
    if ((a[1] - y0) * (b[1] - y0) < 0) { const t = (y0 - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, y0]); }
  }
  return out;
}
// 折叠线上的翼弦（前后缘 x）
function adChordAt(pts, y0) {
  const xs = [];
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] - y0) * (b[1] - y0) <= 0 && a[1] !== b[1]) xs.push(a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1])); }
  return xs.length >= 2 ? [Math.max(...xs), Math.min(...xs)] : null;
}
function adPathOf(type, part, make) {
  const k = type + ':' + part;
  let p = AIRV.path.get(k);
  if (!p) { p = make(); AIRV.path.set(k, p); }
  return p;
}
// 后缘（襟副翼铰链线用）：多边形里「从翼尖往翼根、x 较小」的那几条边
function adTE(pts) {
  const out = [], n = pts.length, ymax = Math.max(...pts.map(p => p[1]));
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; if (b[1] < a[1] - .05 && Math.min(a[0], b[0]) < pts[0][0] - .5 && a[1] > .3 * ymax * 0 + .01) out.push([a, b]); }
  return out;
}

// —— 外挂：导弹 / 炸弹 / 吊舱（局部坐标，弹头朝 +x）——
const AD_ST = { aam: [2.6, .17], asm: [3.4, .3], agm: [1.9, .2], bomb: [2.2, .34], cm: [4.6, .36], atgm4: [1.5, .13], pod: [1.9, .42] };
function adStore(ctx, kind, x, y, real, col, lw, n) {
  const [L, r] = AD_ST[kind] || AD_ST.agm, body = real ? (kind === 'bomb' ? '#6b6f5e' : '#c9cdc8') : 'rgba(2,10,6,.9)', edge = real ? 'rgba(20,22,24,.7)' : col;
  const one = (cx, cy) => {
    ctx.fillStyle = body; ctx.strokeStyle = edge; ctx.lineWidth = lw * .5;
    ctx.beginPath(); ctx.moveTo(cx + L / 2, cy); ctx.quadraticCurveTo(cx + L / 2 - r * 1.2, cy + r, cx + L / 2 - r * 2.2, cy + r); ctx.lineTo(cx - L / 2, cy + r); ctx.lineTo(cx - L / 2, cy - r); ctx.lineTo(cx + L / 2 - r * 2.2, cy - r); ctx.quadraticCurveTo(cx + L / 2 - r * 1.2, cy - r, cx + L / 2, cy); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (kind !== 'pod') { ctx.beginPath(); ctx.moveTo(cx - L / 2 + .45, cy - r); ctx.lineTo(cx - L / 2, cy - r * 2.6); ctx.lineTo(cx - L / 2, cy + r * 2.6); ctx.lineTo(cx - L / 2 + .45, cy + r); ctx.fillStyle = real ? 'rgba(60,64,62,.9)' : body; ctx.fill(); ctx.stroke(); }   // 尾翼
    if (real && (kind === 'aam' || kind === 'agm' || kind === 'asm' || kind === 'cm')) { ctx.fillStyle = kind === 'aam' ? '#d8c25a' : '#9a7b4a'; ctx.fillRect(cx + L / 2 - r * 2.6, cy - r, r * .6, r * 2); }   // 战斗部色带
  };
  if (kind === 'atgm4') { for (let i = 0; i < Math.min(4, n ?? 4); i++) one(x, y + (i % 2 ? .22 : -.22) + (i > 1 ? 0 : 0)); return; }   // 四联装架：俯视看到并排两枚（上下各两枚）
  if (kind === 'pod') { ctx.fillStyle = real ? '#4b4f45' : 'rgba(2,10,6,.9)'; ctx.strokeStyle = edge; ctx.lineWidth = lw * .5; ctx.beginPath(); ctx.ellipse(x, y, L / 2, r, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = real ? '#23251f' : col; ctx.beginPath(); ctx.ellipse(x + L / 2 - .08, y, .1, r * .8, 0, 0, 7); ctx.fill(); return; }   // 火箭巢
  one(x, y);
}

// —— 机徽 ——
function adMark(ctx, nat, x, y, r, real, stealth) {
  if (!real) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 2);   // 星尖朝机头
  const star = (R, ri) => { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? ri : R; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); };
  if (nat === 'pla') {   // 八一红星（两侧红黄横条）；隐身机低可视度
    const red = stealth ? 'rgba(120,52,52,.85)' : '#c8262a', yel = stealth ? 'rgba(150,140,120,.7)' : '#f1c232';
    ctx.fillStyle = yel; ctx.fillRect(-r * 1.75, -r * .2, r * 3.5, r * .4); ctx.fillStyle = red; ctx.fillRect(-r * 1.7, -r * .13, r * 3.4, r * .26);
    star(r * 1.04, r * .46); ctx.fillStyle = yel; ctx.fill(); star(r * .9, r * .38); ctx.fillStyle = red; ctx.fill();
  } else {   // 美军低可视度星徽：灰色描边
    ctx.strokeStyle = 'rgba(30,32,34,.55)'; ctx.lineWidth = r * .12;
    ctx.beginPath(); ctx.arc(0, 0, r * .8, 0, 7); ctx.stroke(); star(r * .78, r * .32); ctx.stroke(); ctx.strokeRect(r * .8, -r * .22, r * .9, r * .44); ctx.strokeRect(-r * 1.7, -r * .22, r * .9, r * .44);
  }
  ctx.restore();
}

// —— 主函数：在 drawAircraft 已经设好的局部坐标里画；返回 false 表示没有这个机型的精细模型 ——
// o：{ t 时间, ab 加力, fold 机翼折起, st 外挂剩余比例, bay 主弹舱开度 0–1, sbay 侧弹舱开度, bayW 弹舱里弹的种类, bombs }
function airDetail(ctx, type, a, real, col, alpha, lw, o) {
  const D = AIRD[type];
  if (!D) return false;
  o = o || {};
  const ga = ctx.globalAlpha; ctx.globalAlpha = ga * alpha;
  const base = col === COL.enemy && typeof lkPaint === 'function' ? lkPaint(D.paint, 'e') : D.paint, sh = k => rlShade(base, Math.round(clamp(k, .3, 1.6) * 40) / 40);
  const [lx, ly] = rlLocal(a, -.7, -.7), dark = 'rgba(2,10,6,.9)', ink = real ? 'rgba(18,20,22,.55)' : rgba(col, .55), st = !!(D.glass === 'gold' || D.flat);
  const fold = o.fold && D.fold, wingPts = fold ? adClipY(D.wing, D.fold) : D.wing;
  const P = {
    wing: D.wing && adPathOf(type, fold ? 'wingF' : 'wing', () => D.flat ? adSym(D.wing) : adPair(wingPts)),
    wing2: D.wing2 && adPathOf(type, 'wing2', () => adPair(D.wing2)),
    stab: D.stab && adPathOf(type, 'stab', () => adPair(D.stab)), cnd: D.cnd && adPathOf(type, 'cnd', () => adPair(D.cnd)),
    body: D.body && adPathOf(type, 'body', () => adBody(D.body)), tail: D.tail && adPathOf(type, 'tail', () => adSym(D.tail))
  };
  const nacP = (n, s) => { const [x0, x1, y, r] = n, p = new Path2D(); p.ellipse((x0 + x1) / 2, y * s, (x0 - x1) / 2, r, 0, 0, 7); return p; };
  const nacs = (D.nac || []).flatMap(n => [1, -1].map(s => ({ n, s, p: nacP(n, s) })));
  // 圆柱明暗（沿 x 的机身 / 短舱）：横向渐变，受光一侧亮
  const cyl = (y0, hw, k0 = 1, facet) => {
    const g = ctx.createLinearGradient(0, y0 - hw, 0, y0 + hw);
    if (facet) {   // 隐身机机身：两侧棱线斜面 + 平的背部，明暗分成三块
      const f = sg => sh(k0 * (.6 + .52 * Math.max(0, .41 * sg * ly + .59))), top = sh(k0 * (.6 + .52 * .77));
      g.addColorStop(0, f(-1)); g.addColorStop(.2, f(-1)); g.addColorStop(.24, top); g.addColorStop(.76, top); g.addColorStop(.8, f(1)); g.addColorStop(1, f(1));
      return g;
    }
    for (const s of [-1, -.6, -.2, .2, .6, 1]) { const d = Math.max(0, .64 * s * ly + .77 * Math.sqrt(1 - s * s)); g.addColorStop((s + 1) / 2, sh(k0 * (.6 + .52 * d))); }
    return g;
  };
  const fillPart = (p, fill, k) => {
    if (real) { ctx.fillStyle = fill; ctx.fill(p); ctx.strokeStyle = 'rgba(18,20,22,.45)'; ctx.lineWidth = lw * .45; ctx.stroke(p); }
    else { ctx.fillStyle = dark; ctx.fill(p); ctx.strokeStyle = rgba(col, k ?? 1); ctx.lineWidth = lw; ctx.stroke(p); }
  };
  const line = (x1, y1, x2, y2, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const both = f => { f(1); f(-1); };
  // ① 写实：先沿所有部件描一圈阵营色细边，后面的填色盖住内侧，只剩外轮廓
  if (real) {
    ctx.strokeStyle = rgba(col, .8); ctx.lineWidth = lw * 1.5; ctx.lineJoin = 'round';
    for (const k of ['wing', 'wing2', 'stab', 'cnd', 'body', 'tail']) if (P[k]) ctx.stroke(P[k]);
    for (const n of nacs) ctx.stroke(n.p);
  }
  // ② 翼下外挂（机翼盖住挂架，弹头弹尾露在前后缘外）
  const stores = adStores(D, o);
  for (const s of stores) if (!D.heli) adStore(ctx, s.k, s.x, s.y, real, col, lw, s.n);
  // ③ 翼下吊舱、平尾、鸭翼、下单翼
  for (const n of nacs) if (n.n[4] === 'dn') fillPart(n.p, cyl(n.n[2] * n.s, n.n[3]));
  if (P.stab && !D.tt) { fillPart(P.stab, sh(.9)); adHinge(ctx, D.stab, .3, ink, lw); }
  if (P.cnd) fillPart(P.cnd, sh(.95));
  const wingDraw = () => {
    if (!P.wing) return;
    fillPart(P.wing, sh(D.flat ? .98 : .94));
    if (P.wing2) fillPart(P.wing2, sh(.9));
    if (real) { ctx.save(); ctx.clip(P.wing); adHinge(ctx, wingPts, D.ctl === 'elevon' ? .55 : .38, ink, lw, D.flat); ctx.restore(); }
    else adHinge(ctx, wingPts, D.ctl === 'elevon' ? .55 : .38, ink, lw, D.flat);
    if (fold) both(s => { const c = adChordAt(D.wing, D.fold); if (c) { ctx.fillStyle = real ? sh(.7) : rgba(col, .6); ctx.fillRect(c[1], s > 0 ? D.fold - .25 : -D.fold, c[0] - c[1], .25); } });   // 折起的外翼：俯视是一道窄条
    for (const m of D.mk || []) both(s => adMark(ctx, D.nat, m[0], m[1] * s, m[2], real, st));
    if (D.tip) both(s => line(D.tip[0], D.tip[1] * s, D.tip[0] - 1.6, D.tip[1] * s * 1.05, lw * .8, ink));
    if (D.split) both(s => line(D.split[0], D.split[1] * s, D.split[2], D.split[1] * s * .985, lw * 1.2, ink));   // 翼尖开裂式方向舵
    if (D.wl) both(s => line(-4.5, 10.9 * s, -5.5, 11.3 * s, lw * 1.6, real ? sh(.7) : col));   // 翼梢小翼
    if (real && !D.heli) {   // 前缘襟翼线、翼尖航行灯（左红右绿，白色频闪）
      const pts = wingPts, tip = pts.reduce((b, p) => p[1] > b[1] ? p : b, pts[0]), le = pts.filter(p => p[0] >= tip[0] - .01 && p[1] <= tip[1]).sort((p, q) => p[1] - q[1]);
      if (!D.flat && le.length >= 2 && !fold) both(s => line(le[0][0] - .55, le[0][1] * s, tip[0] - .35, (tip[1] - .3) * s, lw * .35, 'rgba(18,20,22,.3)'));
      if (!fold) both(s => { ctx.fillStyle = s > 0 ? 'rgba(80,255,120,.95)' : 'rgba(255,60,50,.95)'; ctx.beginPath(); ctx.arc(tip[0] - .2, tip[1] * s, .22, 0, 7); ctx.fill(); });
      if (((o.t || 0) * 1.1 + (D.paint.length)) % 1 < .07) { ctx.fillStyle = 'rgba(255,255,255,.95)'; both(s => { ctx.beginPath(); ctx.arc(tip[0] - .5, tip[1] * s, .3, 0, 7); ctx.fill(); }); }
    }
    if (D.pods) both(s => { ctx.fillStyle = real ? sh(.85) : dark; ctx.beginPath(); ctx.ellipse(D.pods[0], D.pods[1] * s, 1, .42, 0, 0, 7); ctx.fill(); if (!real) { ctx.strokeStyle = col; ctx.lineWidth = lw * .7; ctx.stroke(); } });   // A-10 起落架整流罩
  };
  if (!D.hi) wingDraw();
  // ④ 机身（圆柱明暗、背脊线），尾椎，机身旁的短舱
  if (P.tail) fillPart(P.tail, sh(.8));
  if (P.body) {
    const hw = Math.max(...D.body.map(b => b[1]));
    fillPart(P.body, real ? cyl(0, hw * .95, D.flat ? .97 : 1.02, st) : null);
    if (real) {
      ctx.save(); ctx.clip(P.body);
      line(D.body[0][0] - 1, 0, D.body[D.body.length - 1][0] + .4, 0, lw * .5, 'rgba(18,20,22,.22)');   // 背脊线
      for (const x of [D.body[0][0] - 2.4, (D.body[0][0] + D.body[D.body.length - 1][0]) / 2]) line(x, -hw, x, hw, lw * .4, 'rgba(18,20,22,.18)');   // 舱段对接线
      if (st && D.cp) {   // 隐身机：座舱后的锯齿形口盖缝
        const x0 = D.cp[0] - .4, w = Math.min(hw * .55, 1.1);
        ctx.strokeStyle = 'rgba(18,20,22,.3)'; ctx.lineWidth = lw * .4; ctx.beginPath();
        for (let i = 0; i <= 6; i++) ctx.lineTo(x0 - (i % 2) * .35 - 1.2, -w + i * w / 3);
        ctx.moveTo(x0 - 2.6, -w * .8); ctx.lineTo(x0 - 3.2, -w * .4); ctx.lineTo(x0 - 2.6, 0); ctx.lineTo(x0 - 3.2, w * .4); ctx.lineTo(x0 - 2.6, w * .8);
        ctx.stroke();
      }
      ctx.restore();
    } else line(D.body[0][0] - 1, 0, D.body[D.body.length - 1][0] + .4, 0, lw * .6, rgba(col, .35));
    if (D.hump) { ctx.fillStyle = real ? sh(1.12) : dark; ctx.beginPath(); ctx.ellipse(D.hump[0], 0, D.hump[1], D.hump[2], 0, 0, 7); ctx.fill(); ctx.strokeStyle = real ? 'rgba(18,20,22,.3)' : col; ctx.lineWidth = lw * .5; ctx.stroke(); }
    if (D.gun) line(D.body[0][0] - .2, -.22, D.body[0][0] + .7, -.22, lw * 1.4, real ? '#2a2c2a' : col);   // A-10 的 30 毫米加特林炮口
  }
  for (const n of nacs) if (n.n[4] === 'up') {
    fillPart(n.p, cyl(n.n[2] * n.s, n.n[3], .95));
    if (real && !n.n[5]) { ctx.fillStyle = 'rgba(15,16,18,.85)'; ctx.beginPath(); ctx.ellipse(n.n[0] - .1, n.n[2] * n.s, .18, n.n[3] * .72, 0, 0, 7); ctx.fill(); }   // 进气口（第 6 项为 1 的是机身里的发动机舱，进气口在下面看不见）
  }
  if (D.hi) wingDraw();
  // ⑤ 进气道、座舱、弹舱
  for (const [x0, x1, y, w, k] of D.inl || []) {
    ctx.fillStyle = real ? 'rgba(26,28,31,.82)' : rgba(col, .45);
    if (k === 'top') {   // 背部进气口（S 形、锯齿唇口）：一道深色月牙，前唇受光
      for (const s of y ? [1, -1] : [1]) {
        const yc = y * s, dx = (x0 - x1) * .55;
        ctx.beginPath(); ctx.moveTo(x0, yc - w); ctx.lineTo(x0 - dx * .35, yc - w * .2); ctx.lineTo(x0, yc); ctx.lineTo(x0 - dx * .35, yc + w * .2); ctx.lineTo(x0, yc + w); ctx.lineTo(x0 - dx, yc + w * .45); ctx.quadraticCurveTo(x0 - dx * 1.25, yc, x0 - dx, yc - w * .45); ctx.closePath(); ctx.fill();
        if (real) { ctx.strokeStyle = 'rgba(225,230,235,.35)'; ctx.lineWidth = lw * .45; ctx.beginPath(); ctx.moveTo(x0, yc - w); ctx.lineTo(x0 - dx * .35, yc - w * .2); ctx.lineTo(x0, yc); ctx.lineTo(x0 - dx * .35, yc + w * .2); ctx.lineTo(x0, yc + w); ctx.stroke(); }
      }
    } else both(s => {   // 两侧进气道（DSI 鼓包 / 加莱特斜切）：机身侧面一道窄的深色口，唇口一道亮线
      ctx.beginPath(); ctx.moveTo(x0, (y - .05) * s); ctx.lineTo(x1, (y + .2) * s); ctx.lineTo(x1 - .25, (y - w * .6) * s); ctx.lineTo(x0 - .15, (y - w * .28) * s); ctx.closePath(); ctx.fill();
      if (real) { line(x0, (y - .05) * s, x1, (y + .2) * s, lw * .55, 'rgba(230,236,240,.4)'); ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.beginPath(); ctx.ellipse((x0 + x1) / 2 - .6, (y - w * .9) * s, (x0 - x1) * .45, w * .35, 0, 0, 7); ctx.fill(); }   // DSI 鼓包的受光
    });
  }
  if (D.ex) for (const [x0, y0, y1] of D.ex) both(s => { ctx.fillStyle = real ? 'rgba(30,26,24,.75)' : rgba(col, .4); ctx.beginPath(); ctx.moveTo(x0, y0 * s); ctx.lineTo(x0 - 1.3, (y0 + .3) * s); ctx.lineTo(x0 - 1.2, y1 * s); ctx.lineTo(x0, (y1 - .5) * s); ctx.closePath(); ctx.fill(); });   // B-2 背部排气槽
  if (D.cabin && real) both(s => { ctx.fillStyle = 'rgba(30,40,46,.8)'; for (const x of [3.6, 2.2, .8]) ctx.fillRect(x - .45, s > 0 ? 2.05 : -2.4, .9, .35); });   // 黑鹰舱门窗
  adCanopy(ctx, D, real, col, lw, lx, ly, o.cpo || 0);
  adBay(ctx, D, o, real, col, lw, sh);
  // ⑥ 垂尾（外倾：俯视看到外侧面，受光一侧亮）、T 形尾的平尾
  if (D.fin) adFins(ctx, D.fin, real, col, lw, sh, ly);
  if (D.fin4) for (const f of D.fin4) adFins(ctx, [f[0], f[1], f[2], f[3], 0, .5], real, col, lw, sh, ly);
  if (P.stab && D.tt) { fillPart(P.stab, sh(.92)); adHinge(ctx, D.stab, .3, ink, lw); }
  // ⑦ 喷口、加力尾焰
  for (const n of D.noz || []) for (const s of n[1] ? [1, -1] : [1]) {
    const [x, y] = [n[0], n[1] * s];
    if (n[4] === 'flat') { ctx.fillStyle = real ? '#2a2b2c' : dark; ctx.fillRect(x - n[3], y - n[2], n[3], n[2] * 2); if (!real) { ctx.strokeStyle = col; ctx.lineWidth = lw * .7; ctx.strokeRect(x - n[3], y - n[2], n[3], n[2] * 2); } }
    else {
      const r = n[2];
      ctx.fillStyle = real ? '#3a3b3d' : dark; ctx.beginPath(); ctx.ellipse(x, y, r * .5, r, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = real ? 'rgba(20,20,22,.8)' : col; ctx.lineWidth = lw * .6; ctx.stroke();
      if (real) { ctx.strokeStyle = 'rgba(150,150,150,.35)'; ctx.lineWidth = lw * .35; for (let i = -2; i <= 2; i++) line(x + r * .1, y + i * r * .35, x - r * .5, y + i * r * .42, lw * .35, 'rgba(160,160,160,.3)'); }   // 收敛调节片
    }
    if (o.ab) {   // 加力：橙色尾焰 + 激波环
      const L = 3.4 + Math.sin((o.t || 0) * 40 + s) * .3, g = ctx.createLinearGradient(x, 0, x - L, 0);
      g.addColorStop(0, 'rgba(255,240,200,.95)'); g.addColorStop(.35, 'rgba(255,150,60,.7)'); g.addColorStop(1, 'rgba(255,90,30,0)');
      ctx.fillStyle = g; const r = n[4] === 'flat' ? n[2] : n[2] * .8;
      ctx.beginPath(); ctx.moveTo(x - .1, y - r); ctx.lineTo(x - L, y); ctx.lineTo(x - .1, y + r); ctx.closePath(); ctx.fill();
    }
  }
  // ⑧ 旋翼 / 螺旋桨 / 背负雷达罩
  if (D.dome) adDome(ctx, D.dome, real, col, lw, o.t || 0, ly);
  for (const pr of D.prop || []) for (const s of pr[1] ? [1, -1] : [1]) adProp(ctx, pr[0], pr[1] * s, pr[2], pr[3], real, col, lw, (o.t || 0) * 30 + s, pr[4]);
  if (D.heli) {
    for (const s of stores) adStore(ctx, s.k, s.x, s.y, real, col, lw, s.n);   // 短翼挂架在旋翼下面、看得见
    if (P.wing) fillPart(P.wing, sh(.9));   // 短翼盖住挂架根部
    for (const s of stores) if (s.k !== 'pod') adStore(ctx, s.k, s.x + .35, s.y, real, col, lw, Math.max(0, (s.n ?? 4) - 2));
    if (D.tr) adTail(ctx, D.tr, real, col, lw, o.still ? 0 : o.t || 0);
    adRotor(ctx, D.rot, real, col, lw, o.still ? null : o.t || 0, D.radome);
  }
  ctx.globalAlpha = ga;
  return true;
}
// 外挂清单（左右镜像）：o.st 为剩余比例，从外侧往里先打掉
function adStores(D, o) {
  if (!D.st) return [];
  let all = [];
  for (const [x, y, k] of D.st) for (const s of y ? [1, -1] : [1]) all.push({ x, y: y * s, k, n: k === 'atgm4' ? 4 : 1, w: Math.abs(y) });
  if (o.used) for (const k in o.used) {   // 打掉的：同类里从外侧往里、左右交替
    let u = o.used[k];
    const L = all.filter(s => s.k === k).sort((p, q) => q.w - p.w || q.y - p.y);
    for (const s of L) { if (u <= 0) break; const d = Math.min(s.n, u); s.n -= d; u -= d; }
    all = all.filter(s => s.n > 0);
  }
  const frac = o.st == null ? 1 : clamp(o.st, 0, 1);
  if (frac >= 1) return all;
  const tot = all.reduce((a, s) => a + s.n, 0);
  let keep = Math.round(tot * frac);
  all.sort((p, q) => p.w - q.w);   // 里侧的留到最后
  const out = [];
  for (const s of all) { if (keep <= 0) break; const n = Math.min(s.n, keep); keep -= n; out.push({ ...s, n }); }
  return out;
}
// 舵面铰链线：沿后缘往里 d 画一道（襟副翼 / 升降副翼），再画前缘一道亮线
function adHinge(ctx, pts, d, ink, lw, flat) {
  ctx.strokeStyle = ink; ctx.lineWidth = lw * .45; ctx.beginPath();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (!(b[1] < a[1] - .1 || (flat && b[0] < a[0] && Math.abs(b[1] - a[1]) > .3))) continue;   // 后缘：翼尖往翼根走的边
    if (Math.min(a[0], b[0]) > pts[0][0] - 1) continue;
    for (const s of flat ? [1, -1] : [1, -1]) {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * d, ny = dx / L * d, sg = nx > 0 ? 1 : -1;   // 法线朝机翼里侧（+x）
      ctx.moveTo(a[0] + Math.abs(nx), (a[1] + ny * sg) * s); ctx.lineTo(b[0] + Math.abs(nx), (b[1] + ny * sg) * s);
      ctx.moveTo(a[0] + Math.abs(nx) * .4 + dx * .48, (a[1] + dy * .48) * s); ctx.lineTo(a[0] + dx * .48, (a[1] + dy * .48) * s);   // 襟翼 / 副翼分界
    }
  }
  ctx.stroke();
}
// 座舱：气泡（金色镀膜 / 普通）、串列双座（直升机）、风挡（大飞机）
// cpo：座舱盖打开的程度（登机时）——后铰链向上掀起，俯视变短、露出前面的座舱（坐椅、仪表板）
function adCanopy(ctx, D, real, col, lw, lx, ly, cpo = 0) {
  if (!D.cp) return;
  const [x0, x1, w0, k] = D.cp, rx0 = (x1 - x0) / 2;
  if (cpo > .02 && k === 'bubble') {
    ctx.fillStyle = real ? '#1b1d1e' : 'rgba(2,10,6,.95)'; ctx.beginPath(); ctx.ellipse(x0 + rx0, 0, rx0 * .92, w0 * .82, 0, 0, 7); ctx.fill();   // 座舱
    if (real) { ctx.fillStyle = '#3d4040'; ctx.fillRect(x0 + rx0 * .55, -w0 * .4, rx0 * .55, w0 * .8); ctx.fillStyle = '#2a2c2c'; ctx.fillRect(x1 - rx0 * .55, -w0 * .55, rx0 * .3, w0 * 1.1); }   // 弹射座椅、仪表板遮光罩
    else { ctx.strokeStyle = col; ctx.lineWidth = lw * .45; ctx.strokeRect(x0 + rx0 * .55, -w0 * .4, rx0 * .55, w0 * .8); }
  }
  const th = cpo * .95, x1o = x0 + (x1 - x0) * Math.cos(th), cx = (x0 + x1o) / 2, rx = (x1o - x0) / 2, w = w0 * (1 + cpo * .12);
  const glass = D.glass === 'gold' ? ['#5b4a24', '#9a8040'] : ['#1f2d36', '#3f5866'];
  const pane = (cx, rx, ry) => {
    if (real) { const g = ctx.createLinearGradient(cx - rx, -ry, cx + rx, ry); g.addColorStop(0, glass[0]); g.addColorStop(1, glass[1]); ctx.fillStyle = g; }
    else ctx.fillStyle = 'rgba(2,10,6,.9)';
    ctx.beginPath(); ctx.ellipse(cx, 0, rx, ry, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = real ? 'rgba(15,16,18,.7)' : col; ctx.lineWidth = lw * .55; ctx.stroke();
    if (real) { ctx.fillStyle = 'rgba(235,245,250,.35)'; ctx.beginPath(); ctx.ellipse(cx + lx * rx * .35, ly * ry * .4, rx * .45, ry * .22, 0, 0, 7); ctx.fill(); }   // 反光
  };
  if (k === 'tandem') { pane(x1 - rx * .5, rx * .48, w * .85); pane(x0 + rx * .5, rx * .5, w); ctx.strokeStyle = real ? 'rgba(15,16,18,.6)' : col; ctx.lineWidth = lw * .5; ctx.beginPath(); ctx.moveTo(cx, -w); ctx.lineTo(cx, w); ctx.stroke(); return; }
  if (k === 'win') {   // 驾驶舱风挡：机头上一道深色窗带
    ctx.fillStyle = real ? '#1d2830' : rgba(col, .5);
    ctx.beginPath(); ctx.moveTo(x1, -w * .55); ctx.quadraticCurveTo(x1 + .5, 0, x1, w * .55); ctx.lineTo(x0, w); ctx.lineTo(x0 + .15, -w); ctx.closePath(); ctx.fill();
    if (real) { ctx.strokeStyle = 'rgba(160,170,175,.6)'; ctx.lineWidth = lw * .4; ctx.beginPath(); for (const f of [-.5, 0, .5]) { ctx.moveTo(x0 + .1, f * w * 1.4); ctx.lineTo(x1, f * w * .9); } ctx.stroke(); }
    return;
  }
  pane(cx, rx, w);
  if (D.glass !== 'gold') { ctx.strokeStyle = real ? 'rgba(15,16,18,.6)' : col; ctx.lineWidth = lw * .45; ctx.beginPath(); ctx.moveTo(x1o - rx * .55, -w * .82); ctx.quadraticCurveTo(x1o - rx * .4, 0, x1o - rx * .55, w * .82); ctx.stroke(); }   // 风挡框
}
// 垂尾：根部在机身上，外倾时梢部向外偏（俯视能看到外侧面）
function adFins(ctx, f, real, col, lw, sh, ly) {
  const [x, c, y, h, cant, sw] = f, off = h * Math.sin(cant), tc = c * .45;
  for (const s of y ? [1, -1] : [1]) {
    const yr = y * s, yt = (y + off) * s;
    if (cant < .1) {   // 竖直垂尾：俯视一道细长条（厚度），顶边亮
      ctx.fillStyle = real ? sh(.8) : 'rgba(2,10,6,.9)'; ctx.beginPath(); ctx.moveTo(x, yr); ctx.lineTo(x - sw, yr + .12); ctx.lineTo(x - sw - tc, yr + .12); ctx.lineTo(x - c, yr); ctx.lineTo(x - sw - tc, yr - .12); ctx.lineTo(x - sw, yr - .12); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = real ? 'rgba(18,20,22,.6)' : col; ctx.lineWidth = lw * .6; ctx.stroke();
      continue;
    }
    const lit = .64 * ly * s * Math.cos(cant) + .77 * Math.sin(cant);
    ctx.fillStyle = real ? sh(.7 + .45 * Math.max(0, lit)) : 'rgba(2,10,6,.9)';
    ctx.beginPath(); ctx.moveTo(x, yr); ctx.lineTo(x - sw, yt); ctx.lineTo(x - sw - tc, yt); ctx.lineTo(x - c, yr); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = real ? 'rgba(18,20,22,.55)' : col; ctx.lineWidth = lw * .55; ctx.stroke();
    if (real) { ctx.strokeStyle = 'rgba(18,20,22,.35)'; ctx.lineWidth = lw * .4; ctx.beginPath(); ctx.moveTo(x - c * .62, yr); ctx.lineTo(x - sw - tc * .55, yt); ctx.stroke(); }   // 方向舵铰链线
  }
}
// 弹舱：开舱时舱底变成深色凹槽，两扇舱门向两侧翻出，弹舱里的弹露出来；侧弹舱的弹被挂架推到机身外
function adBay(ctx, D, o, real, col, lw, sh) {
  const k = o.bay || 0, ks = o.sbay || 0;
  if (D.bay && k > .02) {
    const [x0, x1, hw, yc] = D.bay;
    for (const s of yc ? [1, -1] : [0]) {
      const y = yc * (s || 1) * (s ? 1 : 0), w = hw * k;
      ctx.fillStyle = real ? 'rgba(22,24,26,.9)' : 'rgba(2,10,6,.95)'; ctx.fillRect(x1, y - w, x0 - x1, w * 2);
      if (!real) { ctx.strokeStyle = col; ctx.lineWidth = lw * .6; ctx.strokeRect(x1, y - w, x0 - x1, w * 2); }
      const n = Math.max(1, Math.round(hw * 2 / .7)), ww = o.bayW || 'agm';
      if (o.bayN !== 0) for (let i = 0; i < Math.min(n, o.bayN ?? n); i++) adStore(ctx, ww === 'bomb' ? 'bomb' : ww === 'aam' ? 'aam' : 'agm', (x0 + x1) / 2 - .2, y - hw + .35 + i * (hw * 2 - .7) / Math.max(1, n - 1), real, col, lw * .8, 1);
      for (const g of [-1, 1]) {   // 舱门：从凹槽两边翻出去
        const e = y + g * w, out = e + g * hw * .55 * k;
        ctx.fillStyle = real ? sh(.75) : 'rgba(2,10,6,.9)'; ctx.beginPath(); ctx.moveTo(x0, e); ctx.lineTo(x0 - .2, out); ctx.lineTo(x1 + .2, out); ctx.lineTo(x1, e); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = real ? 'rgba(18,20,22,.7)' : col; ctx.lineWidth = lw * .5; ctx.stroke();
      }
    }
  }
  if (D.sbay && ks > .02) {
    const [x0, x1, y] = D.sbay;
    for (const s of [1, -1]) {
      ctx.fillStyle = real ? 'rgba(22,24,26,.9)' : 'rgba(2,10,6,.95)'; ctx.fillRect(x1, (y - .35) * s - (s < 0 ? .5 : 0) + (s < 0 ? .35 : 0), x0 - x1, .5);
      adStore(ctx, 'aam', (x0 + x1) / 2, (y + ks * .75) * s, real, col, lw * .8, 1);   // 侧弹舱：挂架把霹雳-10 / AIM-9X 推出舱外
    }
  }
}
// 主旋翼：半透明桨盘 + 转动的桨叶（桨尖色）；阿帕奇桨毂上方的长弓雷达罩
function adRotor(ctx, R0, real, col, lw, t, radome) {
  if (!R0) return;
  const [hx, r, nb] = R0, still = t == null, a0 = still ? .4 : t * 22;   // t 为空：停放，桨叶不转、没有桨盘虚影
  if (!still) {
    ctx.fillStyle = real ? 'rgba(24,26,24,.13)' : rgba(col, .07); ctx.beginPath(); ctx.arc(hx, 0, r, 0, 7); ctx.fill();
    if (!real) { ctx.setLineDash([lw * 2, lw * 2]); ctx.strokeStyle = rgba(col, .5); ctx.lineWidth = lw * .6; ctx.stroke(); ctx.setLineDash([]); }
  }
  for (let i = 0; i < nb; i++) {
    const b = a0 + i * 6.2832 / nb, c = Math.cos(b), s = Math.sin(b);
    ctx.strokeStyle = real ? 'rgba(26,27,25,.6)' : rgba(col, .75); ctx.lineWidth = lw * 1.5; ctx.beginPath(); ctx.moveTo(hx + c * .5, s * .5); ctx.lineTo(hx + c * r, s * r); ctx.stroke();
    if (!still) for (let k = 1; k <= 2; k++) { const bb = b - k * .09; ctx.strokeStyle = real ? `rgba(26,27,25,${.25 / k})` : rgba(col, .25 / k); ctx.beginPath(); ctx.moveTo(hx + Math.cos(bb) * r * .3, Math.sin(bb) * r * .3); ctx.lineTo(hx + Math.cos(bb) * r, Math.sin(bb) * r); ctx.stroke(); }   // 拖影
    if (real) { ctx.strokeStyle = 'rgba(230,200,60,.7)'; ctx.lineWidth = lw * 1.5; ctx.beginPath(); ctx.moveTo(hx + c * r * .94, s * r * .94); ctx.lineTo(hx + c * r, s * r); ctx.stroke(); }   // 桨尖警示色
  }
  ctx.fillStyle = real ? '#2c2e2a' : 'rgba(2,10,6,.9)'; ctx.beginPath(); ctx.arc(hx, 0, radome ? .95 : .55, 0, 7); ctx.fill();
  ctx.strokeStyle = real ? 'rgba(10,10,10,.6)' : col; ctx.lineWidth = lw * .6; ctx.stroke();
  if (radome && real) { ctx.fillStyle = 'rgba(200,205,195,.25)'; ctx.beginPath(); ctx.arc(hx - .25, -.25, .4, 0, 7); ctx.fill(); }
}
// 尾桨：桨盘竖直，俯视是机尾一侧的一道虚影
function adTail(ctx, T, real, col, lw, t) {
  const [x, y, r] = T, k = Math.abs(Math.sin(t * 40));
  ctx.fillStyle = real ? 'rgba(24,26,24,.22)' : rgba(col, .2); ctx.fillRect(x - r, y - .12, r * 2, .24);
  ctx.strokeStyle = real ? 'rgba(24,26,24,.6)' : rgba(col, .7); ctx.lineWidth = lw * .9; ctx.beginPath(); ctx.moveTo(x - r * k, y); ctx.lineTo(x + r * k, y); ctx.stroke();
}
// 螺旋桨：桨盘竖直（法线朝前），俯视是一道横向的半透明虚影 + 桨毂
function adProp(ctx, x, y, r, nb, real, col, lw, t, pusher) {
  ctx.fillStyle = real ? 'rgba(30,32,30,.18)' : rgba(col, .18); ctx.fillRect(x - .12, y - r, .24, r * 2);
  ctx.strokeStyle = real ? 'rgba(30,32,30,.55)' : rgba(col, .7); ctx.lineWidth = lw * .8; ctx.beginPath();
  for (let i = 0; i < Math.min(nb, 4); i++) { const yy = Math.cos(t + i * Math.PI / Math.min(nb, 4)) * r; ctx.moveTo(x, y); ctx.lineTo(x + (pusher ? .1 : -.1), y + yy); }
  ctx.stroke();
  ctx.fillStyle = real ? '#3b3d3e' : 'rgba(2,10,6,.9)'; ctx.beginPath(); ctx.ellipse(x + (pusher ? -.25 : .25), y, .45, .3, 0, 0, 7); ctx.fill();
}
// 背负雷达罩：圆盘，上面两道深色条纹随天线慢转
function adDome(ctx, d, real, col, lw, t, ly) {
  const [x, r] = d;
  ctx.fillStyle = real ? (() => { const g = ctx.createRadialGradient(x - r * .3 * Math.sign(ly || 1), -r * .3 * ly, r * .1, x, 0, r); g.addColorStop(0, '#e8ecec'); g.addColorStop(1, '#a9b0b2'); return g; })() : 'rgba(2,10,6,.92)';
  ctx.beginPath(); ctx.arc(x, 0, r, 0, 7); ctx.fill(); ctx.strokeStyle = real ? 'rgba(20,22,24,.55)' : col; ctx.lineWidth = lw * .7; ctx.stroke();
  const b = t * .6;
  ctx.save(); ctx.translate(x, 0); ctx.rotate(b); ctx.strokeStyle = real ? 'rgba(40,44,46,.55)' : rgba(col, .5); ctx.lineWidth = r * .16;
  ctx.beginPath(); ctx.arc(0, 0, r * .62, -.8, .8); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * .62, Math.PI - .8, Math.PI + .8); ctx.stroke(); ctx.restore();
}

// —— 发射 / 投弹的画面（只是画面，不进 S）——
//   内埋弹舱：先开舱（0.25 秒），弹射臂把弹从舱顶往下推出舱外（0.1 秒），自由落下、被气流带到机后，0.6 秒时发动机点火，
//   再在 0.7 秒内追上真实弹道；舱门开足后 0.85 秒开始关；
//   侧弹舱（歼-20 / F-22 的近距格斗弹）：舱门打开、挂架把弹推出舱外，在舱外点火；外挂：弹从挂架脱离后点火，挂架上少一枚
// AIRV.ev：飞机键（阵营 + id）→ { ts 最近几次发射 [{t0, k}], rel 外挂消耗 [{t, sk}], w 弹种 }；AIRV.mv：导弹 id → 挂点与时刻
const AIR_REL = { open: .25, ej: .1, ign: .6, done: 1.3, shut: .85 };   // 开舱、弹射臂行程、点火、并入弹道、开始关舱（离机后的秒数）
const AIR_GND = new Set(['dd', 'esc', 'cv', 'samv', 'manpads', 'eship', 'vls', 'theatre']);   // 舰艇 / 地面发射的，不是飞机
const AIR_W = { ft8: 'bomb', gbu53: 'bomb', gbu38: 'bomb', gbu31: 'bomb', ls6: 'bomb', yj12: 'cm', yj83k: 'cm', yj18: 'cm' };
const AIR_SK = { aam: ['aam'], agm: ['atgm4', 'agm', 'asm', 'pod', 'cm'], cm: ['cm', 'asm'], bomb: ['bomb', 'cm'] };   // 弹种 → 从哪类挂点上取
const airRelW = m => m.kind === 'sam' ? 'aam' : m.kind === 'asm' ? 'cm' : AIR_W[m.w] || 'agm';
function airRelReset() { AIRV.S = S; AIRV.ev = new Map(); AIRV.mv = new Map(); AIRV.last = -1; AIRV.st = null; AIRV.proj = new WeakSet(); }
function airRelScan() {
  if (!S || !Array.isArray(S.missiles)) return;
  if (AIRV.S !== S) airRelReset();
  const L = S.missiles, top = L.length ? L[L.length - 1].id : -1, pj = S.eair && S.eair.proj, pn = pj ? pj.length : 0;
  if (AIRV.st === S.t && AIRV.top === top && AIRV.pn === pn) return;
  AIRV.st = S.t; AIRV.top = top; AIRV.pn = pn;
  for (let i = L.length - 1; i >= 0; i--) {   // 新导弹都在数组尾部
    const m = L[i];
    if (m.id <= AIRV.last) break;
    if (m.done || AIR_GND.has(m.src) || typeof m.src === 'number' || !(m.src === 'aam' || m.kind === 'pgm' || m.kind === 'asm')) continue;
    airRelNew(m);
  }
  if (top > AIRV.last) AIRV.last = top;
  if (pj) for (const p of pj) if (p.k === 'atgm' && !AIRV.proj.has(p)) { AIRV.proj.add(p); airRelNew({ id: null, side: 'e', x0: p.x0, y0: p.y0, t: p.t, kind: 'pgm', w: 'hellfire', tx: p.tx, ty: p.ty }); }   // 阿帕奇的地狱火（eair.js 的投射物）
  if (AIRV.mv.size > 80) for (const [id, r] of AIRV.mv) if (S.t - r.t0 > 3) AIRV.mv.delete(id);
}
// 发射平台：同阵营、发射点 70 以内最近的空中飞机
function airRelNew(m) {
  const side = m.side, L = side === 'p' ? S.planes || [] : (S.eair && S.eair.fly) || [];
  let best = null, bd = 70;
  for (const o of L) {
    if (o.dead || o.phase === 'cat' || o.phase === 'roll' || o.phase === 'trap' || o.ph === 'roll' || o.ph === 'gnd') continue;
    const d = dist(o.x, o.y, m.x0, m.y0);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) return;
  const type = side === 'p' ? (typeof airSilKey === 'function' ? airSilKey(best.kind, best.v) : null) : typeof eaSil === 'function' ? eaSil(best.type) : null, D = AIRD[type];
  if (!D) return;
  const pk = side + best.id, t0 = S.t - (m.t || 0), w = airRelW(m);
  let ev = AIRV.ev.get(pk);
  if (!ev) AIRV.ev.set(pk, ev = { ts: [], rel: [], n: 0, w });
  let k = 'ext', ox = 0, oy = 0, sk = null;
  const s = ev.n % 2 ? 1 : -1;
  if (D.bay || D.sbay) {
    k = D.sbay && w === 'aam' && !m.lr && dist(m.x0, m.y0, m.tx, m.ty) < 320 ? 'side' : D.bay ? 'main' : 'side';
    if (k === 'main') { const [x0, x1, hw, yc] = D.bay; ox = (x0 + x1) / 2; oy = yc ? yc * s : hw * .45 * s; }
    else { const [x0, x1, y] = D.sbay; ox = (x0 + x1) / 2; oy = (y + .75) * s; }
  } else if (D.st) {   // 外挂：同类挂点里还剩的最外侧一枚
    const used = airUsed(ev, t0 + 1), kinds = AIR_SK[w] || AIR_SK.agm, left = adStores(D, { used });
    const c = left.filter(o => kinds.includes(o.k)).sort((p, q) => q.w - p.w || (p.y > 0 ? -1 : 1) * s)[0];
    if (c) { ox = c.x; oy = c.y; sk = c.k; }
  }
  ev.n++; ev.w = w;
  ev.ts.push({ t0, k }); if (ev.ts.length > 10) ev.ts.shift();
  if (sk) { ev.rel.push({ t: t0, sk }); if (ev.rel.length > 40) ev.rel.shift(); }
  if (m.id != null) AIRV.mv.set(m.id, { pk, side, id: best.id, t0, ox, oy, k, w, type });
}
// 到时刻 t 为止各类外挂打掉了几枚
function airUsed(ev, t) { const u = {}; for (const r of ev.rel) if (t >= r.t + .08) u[r.sk] = (u[r.sk] || 0) + 1; return u; }
// 画飞机时要的状态：弹舱开度、外挂消耗、弹舱里的弹种
function airRelState(side, id) {
  airRelScan();
  const ev = AIRV.ev && AIRV.ev.get(side + id);
  if (!ev) return null;
  let bay = 0, sbay = 0;
  for (const e of ev.ts) {
    const u = S.t - e.t0, k = u < 0 ? 0 : u < AIR_REL.open ? u / AIR_REL.open : u < AIR_REL.shut ? 1 : u < AIR_REL.done ? 1 - (u - AIR_REL.shut) / (AIR_REL.done - AIR_REL.shut) : 0;
    if (e.k === 'main') bay = Math.max(bay, k); else if (e.k === 'side') sbay = Math.max(sbay, k);
  }
  return { bay, sbay, used: airUsed(ev, S.t), bayW: ev.w, bayN: bay > 0 ? (S.t - ev.ts[ev.ts.length - 1].t0 < AIR_REL.open ? undefined : 0) : 0 };
}
// 二维画飞机时用的尺寸（与 drawPlanes / eair.js 一致）
function airDrawSize(o, side) {
  if (side === 'p') { const sp = typeof airSpec === 'function' ? airSpec(o.kind, o.v) : { size: 15 }; return Math.max(sp.size, px(20)); }
  const heli = o.type === 'heli' || o.type === 'uh60', big = o.type === 'c17' || o.type === 'b2';
  return big ? Math.max(28, px(30)) : Math.max(heli ? 15 : 17, px(heli ? 17 : 19));
}
// 刚离机的弹此刻该画在哪：{ x, y, h 机头方向, sc 机体比例, u 离机秒数, lit 已点火, o 飞机, r 记录 }；过了这段返回 null
function airRelPos(m, three) {
  if (!AIRV.mv || m.done) return null;
  airRelScan();
  const r = AIRV.mv.get(m.id);
  if (!r) return null;
  const u = S.t - r.t0;
  if (u < 0 || u > AIR_REL.done) return null;
  const L = r.side === 'p' ? S.planes || [] : (S.eair && S.eair.fly) || [], o = L.find(p => p.id === r.id);
  if (!o || o.dead) return null;
  const h = o.heading || 0, c = Math.cos(h), sn = Math.sin(h), sc = three ? airSize3(o, r.side) / 21 : airDrawSize(o, r.side) / 21;
  const fr = Math.max(0, u - AIR_REL.open - AIR_REL.ej), back = r.k === 'side' ? 0 : 2.2 * fr ** 2 * 6, out = r.k === 'side' ? 0 : .6 * fr;   // 弹射臂松开后被气流往后、往外带
  const lx = r.ox - back, ly = r.oy + Math.sign(r.oy || 1) * out, bx = o.x + (lx * c - ly * sn) * sc, by = o.y + (lx * sn + ly * c) * sc;
  const e = sm01((u - AIR_REL.ign) / (AIR_REL.done - AIR_REL.ign));
  return { x: lerp(bx, m.x, e), y: lerp(by, m.y, e), h: Math.atan2(lerp(Math.sin(h), Math.sin(m.hd ?? h), e), lerp(c, Math.cos(m.hd ?? h), e)), sc, u, e, lit: u >= AIR_REL.ign, o, r };
}
// 3D 高度：舱里 → 弹射臂往下推出舱外 → 自由落下 → 点火后接上导弹自己的高度（与 v3fx.js 同一套）；侧弹舱、外挂在挂点上点火
function airRelZ(P, m) {
  const side = P.r.k !== 'main', ej = clamp((P.u - AIR_REL.open) / AIR_REL.ej, 0, 1), fr = Math.max(0, P.u - AIR_REL.open - AIR_REL.ej);
  const zp = v3AirZ(P.o) - (side ? 1 : .6 + ej) * P.sc - (side ? 0 : 16 * fr * fr), zm = v3AltZ(m.x, m.y, m.z * (m.kind === 'tbm' ? 620 : 230), -2.6, 2);
  return lerp(zp, zm, P.e);
}
// 3D 里飞机的尺寸（v3units.js 的 plane()）
function airSize3(o, side) {
  if (side === 'p') return (typeof airMdl === 'function' && airMdl(o.kind, o.v).size) || ((typeof AIR_SPEC === 'object' && AIR_SPEC[o.kind]) || {}).size || 15;
  return ({ ga: 18, heli: 16, uh60: 17, c17: 30, ftr: 17, ftrb: 17, f22: 18, b2: 34, p8: 26, mq9: 18 })[o.type] || 17;
}
// 二维：离机阶段画弹体（落下时不点火，点火后尾焰），返回 true 表示已经画了
function airRelDraw(ctx, m) {
  const P = airRelPos(m, false);
  if (!P) return false;
  const real = typeof realLook === 'function' && realLook(), col = m.side === 'p' ? COL.intel : COL.enemy, sk = P.r.w === 'aam' ? 'aam' : P.r.w === 'bomb' ? 'bomb' : P.r.w === 'cm' ? 'cm' : 'agm';
  if (P.u < (P.r.k === 'main' ? AIR_REL.open : .05)) return true;   // 还在舱里 / 挂架上（飞机自己画）
  ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.h); ctx.scale(P.sc, P.sc);
  if (P.lit && P.r.w !== 'bomb') {   // 点火：尾焰 + 一团烟（炸弹没有发动机）
    const k = Math.min(1, (P.u - AIR_REL.ign) / .12), L = (AD_ST[sk] || AD_ST.agm)[0];
    const g = ctx.createLinearGradient(-L / 2, 0, -L / 2 - 4 * k, 0); g.addColorStop(0, 'rgba(255,245,210,.95)'); g.addColorStop(.4, 'rgba(255,160,60,.75)'); g.addColorStop(1, 'rgba(255,100,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-L / 2, -.25); ctx.lineTo(-L / 2 - 4 * k, 0); ctx.lineTo(-L / 2, .25); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(220,220,215,.35)'; ctx.beginPath(); ctx.arc(-L / 2 - 1.2, 0, .8 + k, 0, 7); ctx.fill();
  }
  adStore(ctx, sk, 0, 0, real, col, px(1) / P.sc, 1);
  ctx.restore();
  return true;
}
