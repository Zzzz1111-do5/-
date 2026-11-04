'use strict';
// 立体云朵（用户：云朵也从 Sketchfab 上找；天空要百分之七十都是云）：RandyGF 的「Cloud」（CC-BY-4.0，体积云转成的网格，tools/v3gmodels.json 键 cloud，烘焙成 1000 米长）
//   写实画面里在战场上空铺一层积云：云底 1.2–2.6 公里、每朵 1–2.3 公里，地面投影约盖住四成半（从地面往上看，斜着看过去一朵叠一朵，天空约七成是云）；
//   位置按地图定（同一张图每次一样），随高空风慢慢飘（推演时间，暂停就停），飘出范围从另一边回来；雾的尽头以外的不画。
//   画法是 js/v3g.js（uCld：白里透暖的顶、灰蓝的云底，边缘按视角淡出，离镜头近的淡掉免得糊一脸；镜头在云层上面往下看战场时淡到很薄，
//   不挡战场——亲自开飞机时不淡）。不进太阳阴影那一遍（地面云影是 view3d.js cloudSh 那层噪声）；黑绿 / 数码画面、白色平原（太空背景）不画
const V3CL = { list: null, key: '' };
const V3CL_WIND = [9, -3];   // 高空风（米 / 秒，游戏坐标）：比地面的 V3F_WIND 快
const V3CL_M = 6000, V3CL_COVER = .45;   // 地图外再铺多远；地面投影的覆盖率
function v3cloudInit() {
  const k = W + 'x' + H + ':' + (S.seed ?? '');
  if (V3CL.list && V3CL.key === k) return V3CL.list;
  let r = (Number(S.seed) || 12345) * 9301 % 233280 || 1;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const M = V3CL_M, A = (W + 2 * M) * (H + 2 * M), L = [];
  let cov = 0;
  while (cov < A * V3CL_COVER && L.length < 160) {
    const c = { x: -M + rnd() * (W + 2 * M), y: -M + rnd() * (H + 2 * M), z: 1200 + rnd() * 1400, a: rnd() * 6.2832, k: 1 + rnd() * 1.3 };
    cov += 1000 * 680 * c.k * c.k * .75;   // 一朵的投影约是包围盒的四分之三
    L.push(c);
  }
  V3CL.list = L; V3CL.key = k;
  return L;
}
function v3cloudAdd(C) {
  if (!S || typeof v3gAdd !== 'function' || (typeof v3Mx === 'function' && v3Mx()) || (typeof TER === 'object' && TER.flat)) return;
  if (!v3gModel('cloud')) return;
  const cl = typeof SETTINGS === 'object' && SETTINGS ? clamp(+SETTINGS.cloud, 0, 1) : 1;   // 云量（编辑器 / 设置）：0 不画
  if (!(cl > 0)) return;
  if (typeof R === 'object' && R && R.fpLite && typeof V3FP === 'object' && V3FP.on && V3FP.k === 'air') return;   // 开飞机太卡时（main.js fpHeavyGuard）不画云
  const L = v3cloudInit(), M = V3CL_M, sx = W + 2 * M, sy = H + 2 * M, t = S.t || 0, E = C && C.E, far = C && C.fog ? C.fog[1] * 1.15 + 1300 : 1e9;
  const th = typeof R === 'object' && R && R.autoLow ? .5 : 1;   // 持续卡顿自动降画质时（main.js R.autoLow）云少一半：云是一层层薄壳叠着混色，开飞机穿云时最吃显卡
  for (let i = 0; i < L.length; i++) {
    const c = L[i];
    if ((i * .618034) % 1 > cl * th) continue;   // 云量低于 1：按固定的顺序少画几朵
    const x = ((c.x + M + V3CL_WIND[0] * t) % sx + sx) % sx - M, y = ((c.y + M + V3CL_WIND[1] * t) % sy + sy) % sy - M;
    if (E && Math.hypot(x - E[0], -y - E[1], c.z - E[2]) > far) continue;   // 雾的尽头以外：看不见
    v3gAdd('cloud', x, y, c.z, c.a, c.k, 0, 0, 0);
  }
}
