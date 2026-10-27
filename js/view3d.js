'use strict';
// 3D 立体地图（黑绿画风）：右上角「3D」按钮或 Shift + L 切换，沙盒编辑时不可用
// 画法：地形按高程做成立体网格（每 2 格一个顶点，高程放大 V3_HZ 倍，海面平铺，四周有沙盘围边）；
//   当前整帧战场（地形、单位、标记，已过黑绿着色器）先在屏外按俯视画好，作为贴图披在地形上；
//   再叠加西北来光的山体明暗、等高线（每 14 一条，每 5 条加粗）、200 一格的方格网、远处渐暗
// 镜头：绕画面中心转向（< > 键、中键横拖、双指旋转）、俯仰（; ' 键、中键竖拖）、滚轮 / 双指缩放、拖动平移；
//   点选、框选、下令都用视线与地形求交（v3Pick），操作与平面地图一样
// 坐标：GL 里用 (x, -y, 高) 的右手系（x 东、y 北、z 上），世界坐标 y 向南，换算时取负
const V3 = { on: false, ok: false, tried: false, gl: null, cv: null, pr: null, u: {}, a: {}, buf: null, n: 0, seed: null, sig: null,
  top: null, tex: null, base: null, hf: null, nx: 0, ny: 0, yaw: 0, tilt: .95, yawT: 0, tiltT: .95, box: null, cam: null, keep: null };
const V3_HZ = 150, V3_ST = 2, V3_FOV = .8, V3_TILT = [.2, 1.25], V3_SKIRT = -70;

const V3_VS = `attribute vec3 p; attribute vec3 n;
uniform mat4 uM; uniform vec3 uEye;
varying vec3 vP, vN; varying float vD;
void main() { vP = p; vN = n; vD = distance(p, uEye); gl_Position = uM * vec4(p, 1.); }`;
// 黑客帝国式数码风（黑绿画面）：地形网格的每个面都画出发光的网格线（粗糙的多边形地形反而像数字模型）、按等高线分层的明暗台阶，
//   地面上一列列下落的点阵字符流（「数字雨」，向海的方向流下去、字形不断变换、头部最亮、拖着渐暗的尾巴），海面是暗色的字符雨与扫描线，
//   沙盘围边与房屋墙面上字符竖着往下落；字小到看不清时只留亮度带，不闪烁
const V3_MX = `
float mxH(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// 一格里的点阵字形（5 × 7 个圆点，按格子与时间换字）；px：一格在屏幕上有几个像素，太小就只给平均亮度
float mxGlyph(vec2 cell, vec2 f, float t, float px) {
  float id = mod(floor(t * (.6 + mxH(cell) * 2.2)), 61.);
  vec2 g = floor(f * vec2(5., 7.)), q = fract(f * vec2(5., 7.)) - .5;
  float on = step(.48, mxH(cell * 1.7 + g * 13.1 + id * 7.3));
  float m = step(.08, f.x) * step(f.x, .92) * step(.06, f.y) * step(f.y, .94);
  float dd = on * m * (1. - smoothstep(.22, .48, length(q)));
  return mix(.26, dd, smoothstep(5., 12., px));
}
// 字符雨：沿 v 方向流动的一列列字符（cell 格子号，f 格内坐标）；返回亮度（头部 > 1）
float mxRain(vec2 cell, vec2 f, float t, float px) {
  float col = cell.x, sp = 4. + mxH(vec2(col, 1.)) * 9., len = 12. + mxH(vec2(col, 2.)) * 30.;
  float d = mod(t * sp + mxH(vec2(col, 3.)) * 140. - cell.y, 90.);
  float tr = (d < len ? 1. - d / len : 0.) * step(.15, mxH(vec2(col, 4.)));
  float hd = 1. - smoothstep(0., 1.2, d);
  return mxGlyph(cell, f, t, px) * (tr * tr * .9 + hd * 1.6);
}`;
// 数码风地面（黑绿画面的 3D）：不再披平面地图的底图（树林、田块那些写实纹理），地面全由地形数据在着色器里画成数字模型——
//   底色近黑、按高度台阶分层（网格面量化，台阶边是直角折线，不画平滑的等高线曲线）、山坡是一块块平面（低多边形）；坦克上不去的高山加斜向扫描线；
//   地形多边形的网格线与交点；树林是成片缓慢闪变的点阵字符，边缘一道亮线；城镇是细方格；
//   田地是稀疏的数据点阵；沼泽横向虚线；沙滩细密点、礁石稀疏亮点；道路是带亮边的通道，中线上一段段「数据包」沿路流动；
//   河流是暗色水道、两岸亮线，水道里的字符顺流而下；海岸线一道亮光；没看见的地方压暗（战争迷雾）；字符雨照常落下。
//   单位、标号、箭头、弹坑等仍来自俯视贴图（这时贴图底色是黑的，叠加上去）
const V3_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}precision mediump float;
uniform sampler2D uTop, uBase, uCls, uCls2, uFogT, uHt; uniform vec4 uBox; uniform vec2 uWorld, uGrid, uHG; uniform vec2 uFog; uniform float uSea, uT, uMx;
varying vec3 vP, vN; varying float vD;
${V3_MX}
#ifdef DER
#define FW(x) fwidth(x)
#else
#define FW(x) .03
#endif
// 地物通道的走向：沿掩码梯度的垂直方向（世界坐标）
vec2 mxTan(sampler2D T, vec2 cu, vec2 e, int ch) {
  vec4 a = texture2D(T, cu + vec2(e.x, 0.)), b = texture2D(T, cu - vec2(e.x, 0.)), c = texture2D(T, cu + vec2(0., e.y)), d = texture2D(T, cu - vec2(0., e.y));
  vec2 g = ch == 0 ? vec2(a.r - b.r, c.r - d.r) : vec2(a.b - b.b, c.b - d.b);
  return normalize(vec2(-g.y, g.x) + vec2(1e-4, 0.));
}
void main() {
  vec2 w = vec2(vP.x, -vP.y);
  vec3 bg = vec3(.004, .02, .011);
#ifdef DER
  float pw = max(length(fwidth(w)), 1e-3);
#else
  float pw = vD * .0015;
#endif
  if (vN.z < -.5) {   // 沙盘围边（法线朝下作标记）：数码风下字符沿侧壁往下落
    vec3 c0 = vec3(.01, .07, .035);
    if (uMx > .5) { vec2 u = vec2(vP.x + vP.y, -vP.z) / vec2(9., 12.); c0 = c0 * .45 + vec3(.15, .95, .45) * mxRain(floor(u), fract(u), uT, 9. / pw) * .6; }
    gl_FragColor = vec4(mix(c0, bg, smoothstep(uFog.x, uFog.y, vD)), 1.); return;
  }
  vec2 uv = (w - uBox.xy) / uBox.zw;
  bool inBox = uv.x > 0. && uv.y > 0. && uv.x < 1. && uv.y < 1.;
  vec3 N = normalize(vN);
  float lit = clamp(dot(N, normalize(vec3(-.45, .55, .7))), 0., 1.);
  float h = vP.z, land = step(uSea, h);
  vec3 c;
  // 等高线与方格网（两种画风共用）
  float fw = max(FW(h / 14.), .001), fg = max(FW(w.x / 200.), FW(w.y / 200.)), fm = max(FW(w.x / 20.), FW(w.y / 20.));
  float t14 = h / 14., e = .5 - abs(fract(t14) - .5), major = 1. - step(.5, mod(floor(t14 + .5), 5.));
  float cl = (1. - smoothstep(0., fw * (1.2 + major), e)) * land * (.35 + .4 * major);
  vec2 g2 = abs(fract(w / 200.) - .5);
  float gl = (1. - smoothstep(0., fg * 1.5, .5 - max(g2.x, g2.y))) * .16;
  if (uMx < .5) {   // 写实 / 关闭数码风：披俯视贴图，叠山体明暗、等高线、方格网
    c = (inBox ? texture2D(uTop, uv).rgb : texture2D(uBase, w / uWorld).rgb) * (.5 + .75 * lit);
    c += vec3(.12, .62, .32) * (cl + gl);
    gl_FragColor = vec4(mix(c, bg, smoothstep(uFog.x, uFog.y, vD)), 1.); return;
  }
  vec2 cu = w / uWorld, ex = 1. / uGrid;
  vec4 k1 = texture2D(uCls, cu), k2 = texture2D(uCls2, cu);
  float vis = texture2D(uFogT, cu).r, hn = clamp(h / 150., 0., 1.);
  vec3 G = vec3(.14, .9, .46);   // 荧光绿
  // 山体明暗：每个三角面一个平面法线（低多边形的数字模型，山坡是一块块平面，不是平滑曲面），明暗再量化成五档
#ifdef DER
  vec3 Nf = normalize(cross(dFdx(vP), dFdy(vP)));
  if (Nf.z < 0.) Nf = -Nf;
  float litF = clamp(dot(Nf, normalize(vec3(-.45, .55, .7))), 0., 1.);
#else
  float litF = lit;
#endif
  litF = floor(litF * 5. + .5) / 5.;
  // 数码高程（取代平滑的等高线曲线）：每个 20 × 20 的网格面按平均高度量化成一级台阶（uHt：R 级数 / 16，G 坦克上不去的高山，B 水面），
  //   越高越亮；级数变化处沿网格边画直角折线（数码等高线）；远看折线细到看不清时淡出，只留台阶的明暗
  vec2 hc = w / 20., hi = floor(hc), hq = fract(hc);
  vec4 HT = texture2D(uHt, (hi + .5) / uHG);
  float Lx = texture2D(uHt, (hi + vec2(hq.x < .5 ? -1. : 1., 0.) + .5) / uHG).r, Ly = texture2D(uHt, (hi + vec2(0., hq.y < .5 ? -1. : 1.) + .5) / uHG).r;
  float lw = fm * 1.7, far2 = 1. - smoothstep(.12, .45, fm);
  float stp = max(step(.01, abs(Lx - HT.r)) * (1. - smoothstep(0., lw, .5 - abs(hq.x - .5))), step(.01, abs(Ly - HT.r)) * (1. - smoothstep(0., lw, .5 - abs(hq.y - .5))));
  // 底色：近黑，陆地按高度台阶提亮
  c = mix(vec3(.002, .012, .014), vec3(.006, .03, .017) + vec3(.012, .05, .026) * hn + vec3(.01, .06, .03) * HT.r, land) * (.55 + 1.15 * litF);
  c += G * (stp * (.13 + .3 * HT.r) * far2 * land + gl * .7);
  // 坦克上不去的高山：斜向扫描线（远看成一层淡淡的亮度）
  float hz = step(.86, fract((w.x - w.y) / 9.));
  c += G * HT.g * land * mix(hz * .16, .025, smoothstep(.1, .35, FW((w.x - w.y) / 9.)));
  // 地形网格线（多边形的边）与交点
  vec2 m = abs(fract(w / 20.) - .5);
  float far = 1. - smoothstep(.06, .25, fm);
  c += G * ((1. - smoothstep(0., fm * 1.4, .5 - max(m.x, m.y))) * (.05 + .07 * land) + (1. - smoothstep(0., fm * 2.2, length(m - .5))) * .3) * far;
  // 海岸线：一道细亮线（按屏幕像素的宽度）
  c += G * (1. - smoothstep(0., max(FW(h), .05) * 1.6, abs(h - uSea))) * .6;
  // 田地：稀疏数据点阵
  float fd = smoothstep(.3, .7, k2.a);
  vec2 d10 = fract(w / 10.) - .5;
  c += G * fd * (1. - smoothstep(.06, .12, length(d10))) * .16 * far;
  // 城镇：细方格
  float tw = smoothstep(.3, .7, k1.a), f8 = FW(w.x / 8.);
  vec2 d8 = abs(fract(w / 8.) - .5);
  c += G * tw * mix(1. - smoothstep(0., f8 * 1.5, .5 - max(d8.x, d8.y)), .22, smoothstep(.15, .45, f8)) * .16;   // 远看细方格挤成一片时取平均亮度（不再糊成亮块）
  // 沼泽：错开的横向虚线
  float mr = smoothstep(.3, .7, k2.r);
  c += G * mr * step(.84, fract(w.y / 5.)) * step(.45, fract(w.x / 9. + floor(w.y / 5.) * .37)) * .3;
  // 沙滩细密点、礁石 / 悬崖稀疏亮点
  float bc = smoothstep(.3, .7, k2.g), rk = smoothstep(.25, .6, k2.b);
  vec2 q3 = floor(w / 3.), f3 = fract(w / 3.) - .5;
  c += G * bc * mix(step(.55, mxH(q3)) * (1. - smoothstep(.12, .22, length(f3))), .05, smoothstep(.15, .45, FW(w.x / 3.))) * .3;   // 远看点挤成一片时取平均亮度，不闪
  vec2 q6 = floor(w / 6.), f6 = fract(w / 6.) - .5;
  c += G * rk * mix(step(.7, mxH(q6 + 3.1)) * (1. - smoothstep(.15, .3, length(f6))), .045, smoothstep(.15, .45, FW(w.x / 6.))) * .55;
  // 树林：成片缓慢闪变的点阵字符，边缘一道亮线
  float fo = smoothstep(.3, .7, k1.g);
  if (k1.g > .05) {
    vec2 g6 = w / 6.5;
    float gg = mxGlyph(floor(g6), fract(g6), uT * .3, 6.5 / pw);
    c += G * (.025 + (gg - .26 * (1. - smoothstep(5., 12., 6.5 / pw)) * .55) * .2) * fo;   // 暗暗的一片，字点微亮（远看不糊成亮块）
    c += G * (1. - smoothstep(0., max(FW(k1.g), .004) * 1.6, abs(k1.g - .5))) * .16;   // 导数取下限：掩码平在 0.5 附近的小片林地不会整片发亮
  }
  // 河流：暗色水道、两岸亮线，水道里的字符顺流而下
  if (k1.b > .06) {
    float rv = k1.b, band = smoothstep(.2, .4, rv);
    vec2 tg = mxTan(uCls, cu, ex, 2), nr = vec2(tg.y, -tg.x);
    c = mix(c, vec3(.0, .022, .028), band * .85);
    c += vec3(.15, .95, .7) * (1. - smoothstep(0., max(FW(rv), .004) * 1.5, abs(rv - .26))) * .6;
    vec2 q = vec2(dot(w, nr) / 4.5, dot(w, tg) / 5.5 - uT * 1.6);
    c += vec3(.2, 1., .8) * mxGlyph(floor(q), fract(q), uT, 4.5 / pw) * band * .5;
  }
  // 道路：带亮边的通道，中线上一段段「数据包」沿路流动
  if (k1.r > .06) {
    float rd = k1.r, band = smoothstep(.22, .4, rd);
    vec2 tg = mxTan(uCls, cu, ex, 0);
    float sl = dot(w, tg);
    c = mix(c, vec3(.008, .05, .03), band * .75);
    c += G * (1. - smoothstep(0., max(FW(rd), .004) * 1.4, abs(rd - .28))) * .6;
    float pk = step(.62, fract(sl / 18. - uT * .7 + mxH(floor(w / 60.)))) * smoothstep(.4, .5, rd);
    c += vec3(.55, 1., .75) * pk * .75;
  }
  // 字符雨：两档字格（近处 9 × 12，远看换 27 × 36），向海的方向流下去
  vec2 cu1 = w / vec2(9., 12.), cu2 = w / vec2(27., 36.);
  float r = mix(mxRain(floor(cu1), fract(cu1), uT, 9. / pw), mxRain(floor(cu2) + 500., fract(cu2), uT * .6, 27. / pw), smoothstep(7., 3.5, 9. / pw));
  c += vec3(.16, 1., .5) * r * mix(.5, .26, land) + vec3(.6, 1., .8) * max(r - 1., 0.) * .3;
  if (land < .5) c += vec3(.02, .1, .07) * (.5 + .5 * sin(w.y * .35 - uT * 3.)) * .45;   // 海面扫描线
  // 战争迷雾：没看见的地方压暗
  c *= mix(.42, 1., vis);
  // 单位、标号、箭头等（俯视贴图，底色是黑的）叠加上去
  if (inBox) c += texture2D(uTop, uv).rgb;
  gl_FragColor = vec4(mix(c, bg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;

// 城镇房屋：挤出成立体方块——屋顶取俯视贴图（与平面画面同一张），墙面暗绿，棱线发光
const V3_BVS = `attribute vec3 p; attribute vec3 n; attribute vec2 e;
uniform mat4 uM; uniform vec3 uEye;
varying vec3 vP, vN; varying vec2 vE; varying float vD;
void main() { vP = p; vN = n; vE = e; vD = distance(p, uEye); gl_Position = uM * vec4(p, 1.); }`;
const V3_BFS = `precision mediump float;
uniform sampler2D uTop, uBase; uniform vec4 uBox; uniform vec2 uWorld, uFog; uniform float uT, uMx;
varying vec3 vP, vN; varying vec2 vE; varying float vD;
${V3_MX}
void main() {
  vec2 w = vec2(vP.x, -vP.y), uv = (w - uBox.xy) / uBox.zw;
  vec3 N = normalize(vN), bg = vec3(.004, .02, .011);
  float lit = clamp(dot(N, normalize(vec3(-.45, .55, .7))), 0., 1.);
  float ed = min(min(vE.x, 1. - vE.x), min(vE.y, 1. - vE.y)), edge = 1. - smoothstep(.02, .1, ed);
  vec3 c;
  if (uMx > .5) {   // 数码风：楼是数字模型——深色实体、发光棱线；屋顶细方格，墙面上随机亮着的「窗格」，字符竖着往下落
    vec3 G = vec3(.14, .9, .46);
    c = vec3(.006, .035, .02) * (.6 + 1.2 * lit) + G * edge * (N.z > .5 ? .6 : .95);
    if (N.z > .5) { vec2 d = abs(fract(w / 3.) - .5); c += G * step(.42, max(d.x, d.y)) * .12; }
    else {
      vec2 u = vec2((vP.x * N.y - vP.y * N.x), -vP.z) / vec2(4., 5.), win = floor(vec2(vP.x * N.y - vP.y * N.x, vP.z) / vec2(3., 3.5)), fw = fract(vec2(vP.x * N.y - vP.y * N.x, vP.z) / vec2(3., 3.5));
      float px = 4. / max(vD * .0015, 1e-3);
      c += G * step(.78, mxH(win + floor(uT * .1) * .37)) * step(.25, fw.x) * step(fw.x, .75) * step(.3, fw.y) * step(fw.y, .7) * .35;
      c += vec3(.15, .95, .45) * mxRain(floor(u), fract(u), uT * 1.3, px) * .5;
    }
  } else {
    c = N.z > .5 ? ((uv.x > 0. && uv.y > 0. && uv.x < 1. && uv.y < 1.) ? texture2D(uTop, uv).rgb : texture2D(uBase, w / uWorld).rgb) * (.75 + .45 * lit)
      : vec3(.015, .085, .045) * (.55 + 1.1 * lit);
    c += vec3(.12, .68, .36) * edge * (N.z > .5 ? .55 : .9);
  }
  gl_FragColor = vec4(mix(c, bg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;

// —— 3D 数学（列主序 4×4）——
const v3Sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3Dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3Cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3Norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function v3Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}

// 高度场：每 V3_ST 格一个顶点，取四周格子的平均（海面略低于 0）
function v3H0(gx, gy) {
  gx = clamp(gx, 0, GW - 1); gy = clamp(gy, 0, GH - 1);
  const i = gy * GW + gx;
  return isWater(TER.type[i]) ? -3 : TER.elev[i] * V3_HZ + 2;
}
// 世界坐标 (x, y) 处的地面高度（双线性插值）
// 飞机在 3D 里的绝对高度（模型、标识、机上射出的弹共用）：舰载机在甲板上（弹射、滑跑、拦阻）贴着飞行甲板，海上起降以甲板为基准；
//   高度 alt 0.05 以下贴着基准面（地面 / 甲板），往上每 1.0 约 230（直升机悬停 0.3 约离地 60）——见 v3AltZ：高空按海拔平飞，不随山起伏
const V3_DECK = -2.6 + 17 + 1.5;   // 舰载机在飞行甲板上的高度：甲板离水线 17（carrier.js CVG.zd）+ 放下起落架的机身高度
function v3AirZ(o) {
  const ph = o.phase || o.ph;
  if (o.kind && (ph === 'cat' || ph === 'roll' || ph === 'trap')) return V3_DECK;
  return v3AltZ(o.x, o.y, Math.max(0, clamp(o.alt ?? 1, 0, 1) - .05) * 230, o.kind && !o.land && !o.afPh ? V3_DECK - 1.5 : -2.6, 1.5);
}
// 离地高度 h → 绝对高度：贴地时按脚下实际地面（lo 是海上的最低基准：舰载机 = 飞行甲板，其余 = 海面），一离地参考面就换成平滑的地形包络
//   （v3Env，不跟着每个小山包上下抖），越高越接近海拔基准——220 以上完全按海拔平飞；低空过山时沿包络平缓爬升、越过山脊再下来
const sm01 = v => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
function v3AltZ(x, y, h, lo, lift) {
  const g = Math.max(v3Ht(x, y), lo);
  if (!(h > 0)) return g + lift;
  const F = Math.max(v3Env(x, y), g), gr = lerp(g, F, sm01(h / 20));
  return Math.max(h + lift + lerp(gr, lo, sm01(h / 220)), g + lift + Math.min(h, 6));
}
// 地形包络：每 40 一个点，取 140 以内的最高地面，再在 80 内取平均——比实际地形略宽、略高，处处平缓
const V3_ENV = 40;
function v3EnvBuild() {
  const nx = Math.ceil(W / V3_ENV) + 1, ny = Math.ceil(H / V3_ENV) + 1, A = new Float32Array(nx * ny), B = new Float32Array(nx * ny);
  const hf = V3.hf, hn = V3.nx, hm = V3.ny, sp = CELL * V3_ST, r = Math.ceil(140 / sp);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ci = Math.round(i * V3_ENV / sp), cj = Math.round(j * V3_ENV / sp);
    let m = -3;
    for (let b = Math.max(0, cj - r); b <= Math.min(hm - 1, cj + r); b++) for (let a = Math.max(0, ci - r); a <= Math.min(hn - 1, ci + r); a++) if ((a - ci) ** 2 + (b - cj) ** 2 <= r * r && hf[b * hn + a] > m) m = hf[b * hn + a];
    A[j * nx + i] = m;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0, n = 0;
    for (let b = j - 2; b <= j + 2; b++) for (let a = i - 2; a <= i + 2; a++) if (a >= 0 && b >= 0 && a < nx && b < ny && (a - i) ** 2 + (b - j) ** 2 <= 4) { s += A[b * nx + a]; n++; }
    B[j * nx + i] = s / n;
  }
  V3.env = B; V3.enx = nx; V3.eny = ny;
}
function v3Env(x, y) {
  if (!V3.env) return v3Ht(x, y);
  const fx = clamp(x / V3_ENV, 0, V3.enx - 1.001), fy = clamp(y / V3_ENV, 0, V3.eny - 1.001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, E = V3.env, n = V3.enx;
  return lerp(lerp(E[j * n + i], E[j * n + i + 1], u), lerp(E[(j + 1) * n + i], E[(j + 1) * n + i + 1], u), v);
}
function v3Ht(x, y) {
  if (!V3.hf) return 0;
  const fx = clamp(x / (CELL * V3_ST), 0, V3.nx - 1.001), fy = clamp(y / (CELL * V3_ST), 0, V3.ny - 1.001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, H = V3.hf, n = V3.nx;
  return lerp(lerp(H[j * n + i], H[j * n + i + 1], u), lerp(H[(j + 1) * n + i], H[(j + 1) * n + i + 1], u), v);
}
// 网格：地形 + 四边围边（沙盘侧壁，法线 z = -1 作标记）；桥被炸 / 地形变了按签名重建
function v3Mesh() {
  const gl = V3.gl, st = V3_ST, nx = Math.floor((GW - 1) / st) + 1, ny = Math.floor((GH - 1) / st) + 1, hf = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const gx = i * st, gy = j * st; hf[j * nx + i] = (v3H0(gx - 1, gy - 1) + v3H0(gx, gy - 1) + v3H0(gx - 1, gy) + v3H0(gx, gy)) / 4; }
  V3.hf = hf; V3.nx = nx; V3.ny = ny;
  const d = CELL * st, verts = [], idx = [];
  const P = (i, j) => [i * d, -j * d, hf[j * nx + i]];
  const nor = (i, j) => { const hx = hf[j * nx + Math.min(nx - 1, i + 1)] - hf[j * nx + Math.max(0, i - 1)], hy = hf[Math.max(0, j - 1) * nx + i] - hf[Math.min(ny - 1, j + 1) * nx + i]; return v3Norm([-hx / (2 * d), -hy / (2 * d), 1]); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const p = P(i, j), n = nor(i, j); verts.push(p[0], p[1], p[2], n[0], n[1], n[2]); }
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, e = c + 1; idx.push(a, c, b, b, c, e); }
  // 围边：沿四条边走一圈，每个边点一上一下两个顶点
  const ring = [];
  for (let i = 0; i < nx; i++) ring.push([i, 0]);
  for (let j = 1; j < ny; j++) ring.push([nx - 1, j]);
  for (let i = nx - 2; i >= 0; i--) ring.push([i, ny - 1]);
  for (let j = ny - 2; j > 0; j--) ring.push([0, j]);
  ring.push([0, 0]);
  const base = verts.length / 6;
  for (const [i, j] of ring) { const p = P(i, j); verts.push(p[0], p[1], p[2], 0, 0, -1, p[0], p[1], V3_SKIRT, 0, 0, -1); }
  for (let k = 0; k < ring.length - 1; k++) { const a = base + k * 2, b = a + 1, c = a + 2, e = a + 3; idx.push(a, b, c, c, b, e); }
  if (!V3.buf) { V3.buf = gl.createBuffer(); V3.ib = gl.createBuffer(); }
  gl.bindBuffer(gl.ARRAY_BUFFER, V3.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V3.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  V3.n = idx.length; V3.seed = TER.seed; V3.sig = typeof trxSig === 'function' ? trxSig() : null;
  v3Bld();
  // 底图（俯视贴图以外的远处）：小地图同款黑绿配色，每格一个像素
  const c = document.createElement('canvas'), g = c.getContext('2d'), img = g.createImageData(GW, GH);
  for (let i = 0; i < GW * GH; i++) {
    const t = TER.type[i], col = (typeof MM_COL === 'object' && MM_COL[t]) || '#0a2a18', e = isWater(t) ? .5 : .45 + TER.elev[i] * .5;
    for (let k = 0; k < 3; k++) img.data[i * 4 + k] = parseInt(col.slice(1 + k * 2, 3 + k * 2), 16) * e;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, V3.base);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  v3Cls();
  v3HtTex();
  v3EnvBuild();
}
// 数码高程贴图（每个网格面一个像素，不插值）：R 高度台阶级数（每 15 一级）/ 16 · G 坦克上不去（山地，或高程超过 grid.js VEH_ELEV 的高地）· B 水面
function v3HtTex() {
  const gl = V3.gl, nx = V3.nx, ny = V3.ny, hf = V3.hf, w = nx - 1, h = ny - 1, a = new Uint8Array(w * h * 4), ve = typeof VEH_ELEV === 'number' ? VEH_ELEV : .68;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const m = (hf[j * nx + i] + hf[j * nx + i + 1] + hf[(j + 1) * nx + i] + hf[(j + 1) * nx + i + 1]) / 4, k = (j * w + i) * 4;
    let blk = 0;
    for (let dy = 0; dy < V3_ST && !blk; dy++) for (let dx = 0; dx < V3_ST; dx++) {
      const gx = Math.min(GW - 1, i * V3_ST + dx), gy = Math.min(GH - 1, j * V3_ST + dy), t = TER.type[gy * GW + gx];
      if (t === T.MOUNT || (t === T.HILL && TER.elev[gy * GW + gx] > ve)) { blk = 1; break; }
    }
    a[k] = Math.round(clamp(Math.floor(Math.max(0, m) / 15) / 16, 0, 1) * 255); a[k + 1] = blk * 255; a[k + 2] = m < 1.5 ? 255 : 0; a[k + 3] = 255;
  }
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, V3.ht);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, a);
}
// 数码风地面用的地物掩码（每格一个像素，线性插值后取等值线就是平滑的边）：
//   uCls：R 道路 / 桥 · G 树林 · B 河流（渡口淡一些，桥下也算河）· A 城镇；uCls2：R 沼泽 · G 沙滩 · B 礁岸 / 悬崖 · A 田地
//   掩码先模糊再上传，边缘不再是一格一格的台阶：道路、河流只模糊一格（[1 2 1]），成片的地物模糊两格
function v3Cls() {
  const gl = V3.gl, N = GW * GH, a = new Uint8Array(N * 4), b = new Uint8Array(N * 4);
  const ch = f => { const m = new Float32Array(N); for (let i = 0; i < N; i++) m[i] = f(TER.type[i]); return m; };
  const blur = (m, r) => {   // 可分离的二项式模糊，r 遍 [1 2 1]
    const tmp = new Float32Array(N);
    for (let k = 0; k < r; k++) {
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const i = y * GW + x; tmp[i] = (m[y * GW + Math.max(0, x - 1)] + 2 * m[i] + m[y * GW + Math.min(GW - 1, x + 1)]) / 4; }
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const i = y * GW + x; m[i] = (tmp[Math.max(0, y - 1) * GW + x] + 2 * tmp[i] + tmp[Math.min(GH - 1, y + 1) * GW + x]) / 4; }
    }
    return m;
  };
  const C = [blur(ch(t => t === T.ROAD || t === T.BRIDGE ? 1 : 0), 1), blur(ch(t => t === T.FOREST ? 1 : 0), 2), blur(ch(t => t === T.RIVER || t === T.BRIDGE ? 1 : t === T.FORD ? .7 : 0), 1), blur(ch(t => t === T.TOWN ? 1 : 0), 2),
    blur(ch(t => t === T.MARSH ? 1 : 0), 2), blur(ch(t => t === T.BEACH ? 1 : 0), 2), blur(ch(t => t === T.CLIFF ? 1 : t === T.ROCKS ? .7 : 0), 1), blur(ch(t => t === T.FIELD ? 1 : 0), 2)];
  for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) { a[i * 4 + k] = Math.round(C[k][i] * 255); b[i * 4 + k] = Math.round(C[4 + k][i] * 255); }
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, V3.cls); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, a);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, V3.cls2); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, b);
}
// 3D 地图用数码风画地面吗（黑绿画面；设置里可关）
const v3Mx = () => typeof SETTINGS === 'object' && !!SETTINGS && (SETTINGS.look === 'green' || SETTINGS.look === 'matrix') && SETTINGS.matrix3d !== false;   // 黑绿、数码两种画面都用数码风地面

// 房屋几何：每栋一个方块（屋顶 + 四面墙），高度按类型（平顶楼房高、坡顶民房矮）放大 1.6 倍，坐落在地面高度上；
// 机场建筑（afbase.js：机库、机堡、塔台、营房、油罐等，任意朝向的多边形柱体，塔台玻璃顶与水塔水箱架空）排在前面，机场被发现 / 夺取时重建
function v3Bld() {
  const gl = V3.gl, L = typeof townBld === 'function' ? townBld().list : [], vb = [], ib = [];
  const A = typeof afb3dBlocks === 'function' ? afb3dBlocks() : [];
  V3.asig = typeof afb3dSig === 'function' ? afb3dSig() : '';
  for (const k of A) {
    const n = k.pts.length, P = k.pts.map(([x, y]) => [x, -y]), g = Math.min(...k.pts.map(([x, y]) => v3Ht(x, y))) - .5, z0 = g + k.z0 * 1.6, top = g + k.z * 1.6;
    const cx = P.reduce((a, p) => a + p[0], 0) / n, cy = P.reduce((a, p) => a + p[1], 0) / n, b0 = vb.length / 8;
    vb.push(cx, cy, top, 0, 0, 1, .5, .5);   // 顶面：从中心扇形三角化，边缘的 e 取 0（棱线发光）
    for (const [x, y] of P) vb.push(x, y, top, 0, 0, 1, 0, .5);
    for (let i = 0; i < n; i++) ib.push(b0, b0 + 1 + i, b0 + 1 + (i + 1) % n);
    for (let i = 0; i < n; i++) {   // 墙：法线朝外
      const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % n], l = Math.hypot(x1 - x0, y1 - y0) || 1;
      let nx = (y1 - y0) / l, ny = -(x1 - x0) / l;
      if (((x0 + x1) / 2 - cx) * nx + ((y0 + y1) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const q = vb.length / 8;
      vb.push(x0, y0, z0, nx, ny, 0, 0, 0, x1, y1, z0, nx, ny, 0, 1, 0, x1, y1, top, nx, ny, 0, 1, 1, x0, y0, top, nx, ny, 0, 0, 1);
      ib.push(q, q + 1, q + 2, q, q + 2, q + 3);
    }
  }
  for (const b of L) {
    if (vb.length / 8 > 65000 - 24) break;
    const w = (b.r ? b.h : b.w) / 2, h = (b.r ? b.w : b.h) / 2, cx = b.x + b.dx, cy = b.y + b.dy, g = v3Ht(cx, cy) - .5;
    const top = g + (b.f ? 9 + (Math.abs(Math.sin(cx * 12.9 + cy * 7.3)) * 7) : 5 + (Math.abs(Math.sin(cx * 3.1 + cy * 5.7)) * 3)) * 1.6;
    const X0 = cx - w, X1 = cx + w, Y0 = -(cy - h), Y1 = -(cy + h);   // GL 坐标：y 取负（北为正）
    const quad = (pts, n) => { const k = vb.length / 8; pts.forEach(([x, y, z], i) => vb.push(x, y, z, n[0], n[1], n[2], i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0)); ib.push(k, k + 1, k + 2, k, k + 2, k + 3); };
    quad([[X0, Y0, top], [X1, Y0, top], [X1, Y1, top], [X0, Y1, top]], [0, 0, 1]);
    quad([[X0, Y0, g], [X1, Y0, g], [X1, Y0, top], [X0, Y0, top]], [0, 1, 0]);    // 北墙
    quad([[X1, Y1, g], [X0, Y1, g], [X0, Y1, top], [X1, Y1, top]], [0, -1, 0]);   // 南墙
    quad([[X1, Y0, g], [X1, Y1, g], [X1, Y1, top], [X1, Y0, top]], [1, 0, 0]);    // 东墙
    quad([[X0, Y1, g], [X0, Y0, g], [X0, Y0, top], [X0, Y1, top]], [-1, 0, 0]);   // 西墙
  }
  if (!V3.bb) { V3.bb = gl.createBuffer(); V3.bi = gl.createBuffer(); }
  gl.bindBuffer(gl.ARRAY_BUFFER, V3.bb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vb), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V3.bi); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ib), gl.STATIC_DRAW);
  V3.bn = ib.length;
}

function v3Init() {
  V3.tried = true;
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true, alpha: false });
    if (!gl) return;
    const der = !!gl.getExtension('OES_standard_derivatives');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3_FS(der)));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    const u = {}, a = { p: gl.getAttribLocation(pr, 'p'), n: gl.getAttribLocation(pr, 'n') };
    for (const k of ['uM', 'uEye', 'uTop', 'uBase', 'uCls', 'uCls2', 'uFogT', 'uHt', 'uBox', 'uWorld', 'uGrid', 'uHG', 'uFog', 'uSea', 'uT', 'uMx']) u[k] = gl.getUniformLocation(pr, k);
    const pb = gl.createProgram();
    gl.attachShader(pb, sh(gl.VERTEX_SHADER, V3_BVS)); gl.attachShader(pb, sh(gl.FRAGMENT_SHADER, V3_BFS));
    gl.linkProgram(pb);
    if (!gl.getProgramParameter(pb, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pb));
    const ub = {}, ab = { p: gl.getAttribLocation(pb, 'p'), n: gl.getAttribLocation(pb, 'n'), e: gl.getAttribLocation(pb, 'e') };
    for (const k of ['uM', 'uEye', 'uTop', 'uBase', 'uBox', 'uWorld', 'uFog', 'uT', 'uMx']) ub[k] = gl.getUniformLocation(pb, k);
    gl.useProgram(pb); gl.uniform1i(ub.uTop, 0); gl.uniform1i(ub.uBase, 1);
    Object.assign(V3, { pb, ub, ab });
    const mk = (unit, filt) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, filt], [gl.TEXTURE_MAG_FILTER, filt], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v); return t; };
    Object.assign(V3, { gl, cv, pr, u, a, tex: mk(0, gl.LINEAR), base: mk(1, gl.LINEAR), cls: mk(2, gl.LINEAR), cls2: mk(3, gl.LINEAR), fog: mk(4, gl.LINEAR), ht: mk(5, gl.NEAREST), top: document.createElement('canvas'), coarse: V3.coarse ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches), maxTex: Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048), ok: true });
    gl.useProgram(pr);
    gl.uniform1i(u.uTop, 0); gl.uniform1i(u.uBase, 1); gl.uniform1i(u.uCls, 2); gl.uniform1i(u.uCls2, 3); gl.uniform1i(u.uFogT, 4); gl.uniform1i(u.uHt, 5);
    gl.enable(gl.DEPTH_TEST);
  } catch (e) { V3.ok = false; console.warn('3D 地图不可用', e); }
}

// 镜头：画面中心（CAM.x, CAM.y）为目标点；距离按平面地图的缩放换算，使画面中心的比例与平面时相同
function v3Camera() {
  if (typeof V3O === 'object' && V3O.on) return v3oCamera();   // 观察者模式（v3obs.js）
  const th = V3.tilt, ps = V3.yaw, D = (CAM.vh / CAM.z) / (2 * Math.tan(V3_FOV / 2));
  const cz = typeof cvCamZ === 'function' ? cvCamZ(CAM.x, CAM.y) : null, T = [CAM.x, -CAM.y, Math.max(v3Ht(CAM.x, CAM.y), cz ?? -99)];   // 对准航母时注视点在飞行甲板高度（cvdeck.js）
  const E = [T[0] + D * Math.sin(th) * Math.sin(ps), T[1] - D * Math.sin(th) * Math.cos(ps), T[2] + D * Math.cos(th)];
  const z = v3Norm(v3Sub(E, T)), x = v3Norm(v3Cross([-Math.sin(ps), Math.cos(ps), 0], z)), y = v3Cross(z, x);
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, E), -v3Dot(y, E), -v3Dot(z, E), 1]);
  const asp = CAM.vw / Math.max(1, CAM.vh), f = 1 / Math.tan(V3_FOV / 2), n = D * .03, fa = D * 9, nf = 1 / (n - fa);
  const proj = new Float32Array([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]);
  return (V3.cam = { E, x, y, z, D, asp, M: v3Mul(proj, view) });
}
// 屏幕点 → 视线 → 与地形求交（先粗步进，再二分）；打不到地面时取视线与海平面的交点
function v3Ray(sx, sy) {
  const C = V3.cam || v3Camera(), tf = Math.tan(V3_FOV / 2), nx = (sx / CAM.vw * 2 - 1) * tf * C.asp, ny = (1 - sy / CAM.vh * 2) * tf;
  return { o: C.E, d: v3Norm([-C.z[0] + C.x[0] * nx + C.y[0] * ny, -C.z[1] + C.x[1] * nx + C.y[1] * ny, -C.z[2] + C.x[2] * nx + C.y[2] * ny]), C };
}
function v3Pick(sx, sy) {
  const { o, d, C } = v3Ray(sx, sy), above = t => o[2] + d[2] * t - v3Ht(o[0] + d[0] * t, -(o[1] + d[1] * t));
  const tMax = C.D * 8, stp = C.D / 80;
  let t0 = 0, t = stp, hit = false;
  for (; t < tMax; t += stp) { if (above(t) <= 0) { hit = true; break; } t0 = t; }
  if (hit) { for (let k = 0; k < 10; k++) { const m = (t0 + t) / 2; if (above(m) > 0) t0 = m; else t = m; } }
  else t = d[2] < -1e-4 ? -o[2] / d[2] : tMax;
  return { x: o[0] + d[0] * t, y: -(o[1] + d[1] * t) };
}
// 俯视贴图要覆盖的地面范围：画面四角、四边中点的视线落点（最远 2.6 倍镜头距离），外扩一点，夹在地图内
function v3Box() {
  const C = V3.cam, pts = [];
  for (const [sx, sy] of [[0, 0], [CAM.vw / 2, 0], [CAM.vw, 0], [0, CAM.vh / 2], [CAM.vw, CAM.vh / 2], [0, CAM.vh], [CAM.vw / 2, CAM.vh], [CAM.vw, CAM.vh]]) {
    const { o, d } = v3Ray(sx, sy);
    let t = d[2] < -1e-4 ? (V3_HZ * .3 - o[2]) / d[2] : C.D * 2.6;
    t = Math.min(Math.max(t, 0), C.D * 2.6);   // 再远的地方已经暗下去了（雾），用底图
    pts.push([o[0] + d[0] * t, -(o[1] + d[1] * t)]);
  }
  const m = 60, x0 = clamp(Math.min(...pts.map(p => p[0])) - m, 0, W), x1 = clamp(Math.max(...pts.map(p => p[0])) + m, 0, W);
  const y0 = clamp(Math.min(...pts.map(p => p[1])) - m, 0, H), y1 = clamp(Math.max(...pts.map(p => p[1])) + m, 0, H);
  return [x0, y0, Math.max(20, x1 - x0), Math.max(20, y1 - y0)];
}

// 每帧（render.js draw 调用）：屏外按俯视画战场 → 贴到地形网格上 → 画回主画布
function v3Draw(now) {
  if (!V3.tried) v3Init();
  if (!V3.ok) { V3.on = false; return false; }
  const gl = V3.gl;
  if (V3.seed !== TER.seed || (typeof trxSig === 'function' && (V3.chk = (V3.chk || 0) - 1) <= 0 && (V3.chk = 60) && trxSig() !== V3.sig)) v3Mesh();
  else if (typeof afb3dSig === 'function' && (V3.achk = (V3.achk || 0) - 1) <= 0 && (V3.achk = 30) && afb3dSig() !== V3.asig) v3Bld();   // 机场刚被发现 / 夺取
  // 转向 / 俯仰缓动
  V3.yaw += Math.atan2(Math.sin(V3.yawT - V3.yaw), Math.cos(V3.yawT - V3.yaw)) * .18; V3.tilt += (V3.tiltT - V3.tilt) * .18;
  if (typeof V3O === 'object' && V3O.on) v3oStep(now);
  const C = v3Camera(), box = V3.box = v3Box();
  // 俯视贴图：分辨率取画面中心的比例与贴图上限中较小者
  const cap = Math.min(V3.maxTex, R.lowCap || (SETTINGS && SETTINGS.quality === 'low') ? 1280 : V3.coarse ? 1600 : 2048, Math.max(1024, Math.max(R.cv.width, R.cv.height) * 1.3));   // 屏外俯视画布最长边（按屏幕大小，手机、低画质更小）
  // 跟不上（主循环帧间隔滑动平均超过 40ms）就把屏外画布逐步缩小，最低 45%；流畅后再慢慢放大
  if (typeof ema === 'number') V3.capK = clamp((V3.capK || 1) * (ema > .04 ? .985 : ema < .022 ? 1.004 : 1), .45, 1);
  const sTop = Math.min(CAM.z * (R.dprCap ? 1 : Math.min(2, window.devicePixelRatio || 1)), cap * (V3.capK || 1) / Math.max(box[2], box[3]));
  const tw = Math.max(64, Math.round(box[2] * sTop)), th = Math.max(64, Math.round(box[3] * sTop));
  const top = V3.top;
  if (top.width !== tw || top.height !== th) { top.width = tw; top.height = th; }
  const K = { cv: R.cv, ctx: R.ctx, s: R.s, ox: R.ox, oy: R.oy, dpr: R.dpr, vw: CAM.vw, vh: CAM.vh, z: CAM.z, x: CAM.x, y: CAM.y };
  V3.drawing = true;
  R.fx3d = typeof v3Fx === 'function' && !(SETTINGS && SETTINGS.models3d === false);   // 弹道在 3D 里立体画（v3fx.js），贴图里不再画
  // 有立体模型的东西（飞机、车辆、舰船、阵地，近看时的步兵）贴图里不再画平面图标——否则地面上多一层「倒影」
  R.m3d = R.fx3d && typeof V3M === 'object' && !!V3M.ok; R.m3dNear = K.z / CAM.fit > 1.15 || sTop >= 1;   // 贴图里会画出单兵小人的距离（R.fig）起就改用立体士兵，地面上不留平的小人
  try {
    R.cv = top; R.ctx = top.getContext('2d'); R.dpr = 1;
    CAM.vw = tw; CAM.vh = th; CAM.z = R.s = sTop; CAM.x = box[0] + box[2] / 2; CAM.y = box[1] + box[3] / 2;
    R.ox = -box[0] * sTop; R.oy = -box[1] * sTop;
    drawScene(now);
  } finally {
    V3.drawing = false; R.fx3d = false; R.m3d = false;
    Object.assign(R, { cv: K.cv, ctx: K.ctx, s: K.s, ox: K.ox, oy: K.oy, dpr: K.dpr });
    Object.assign(CAM, { vw: K.vw, vh: K.vh, z: K.z, x: K.x, y: K.y });
  }
  // 3D 网格
  const W0 = R.cv.width, H0 = R.cv.height;
  if (V3.cv.width !== W0 || V3.cv.height !== H0) { V3.cv.width = W0; V3.cv.height = H0; }
  gl.viewport(0, 0, W0, H0);
  gl.useProgram(V3.pr);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, V3.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, top);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, V3.base);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, V3.cls);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, V3.cls2);
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, V3.ht);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, V3.fog);
  if (typeof FOGB === 'object') gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, GW, GH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, FOGB);   // 视野（drawScene 刚按当前观察视野算好）
  gl.clearColor(.004, .02, .011, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const u = V3.u;
  gl.uniformMatrix4fv(u.uM, false, C.M);
  gl.uniform3f(u.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform4f(u.uBox, box[0], box[1], box[2], box[3]);
  gl.uniform2f(u.uWorld, W, H); gl.uniform2f(u.uGrid, GW, GH); gl.uniform2f(u.uHG, Math.max(1, V3.nx - 1), Math.max(1, V3.ny - 1));
  gl.uniform2f(u.uFog, C.D * 1.3, C.D * 2.8);
  gl.uniform1f(u.uSea, 1.5);
  const mx = v3Mx() ? 1 : 0, tm = (now / 1000) % 3600;   // 黑绿画面：黑客帝国式数码风
  gl.uniform1f(u.uT, tm); gl.uniform1f(u.uMx, mx);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3.buf); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V3.ib);
  gl.enableVertexAttribArray(V3.a.p); gl.vertexAttribPointer(V3.a.p, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(V3.a.n); gl.vertexAttribPointer(V3.a.n, 3, gl.FLOAT, false, 24, 12);
  gl.drawElements(gl.TRIANGLES, V3.n, gl.UNSIGNED_SHORT, 0);
  if (V3.bn && V3.pb) {   // 城镇房屋、机场建筑
    const ub = V3.ub, ab = V3.ab;
    gl.useProgram(V3.pb);
    gl.uniformMatrix4fv(ub.uM, false, C.M); gl.uniform3f(ub.uEye, C.E[0], C.E[1], C.E[2]);
    gl.uniform4f(ub.uBox, box[0], box[1], box[2], box[3]); gl.uniform2f(ub.uWorld, W, H); gl.uniform2f(ub.uFog, C.D * 1.3, C.D * 2.8);
    gl.uniform1f(ub.uT, tm); gl.uniform1f(ub.uMx, mx);
    gl.bindBuffer(gl.ARRAY_BUFFER, V3.bb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V3.bi);
    gl.disableVertexAttribArray(V3.a.p); gl.disableVertexAttribArray(V3.a.n);
    gl.enableVertexAttribArray(ab.p); gl.vertexAttribPointer(ab.p, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(ab.n); gl.vertexAttribPointer(ab.n, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(ab.e); gl.vertexAttribPointer(ab.e, 2, gl.FLOAT, false, 32, 24);
    gl.drawElements(gl.TRIANGLES, V3.bn, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(ab.p); gl.disableVertexAttribArray(ab.n); gl.disableVertexAttribArray(ab.e);
  }
  if (typeof v3Units === 'function' && !(SETTINGS && SETTINGS.models3d === false)) { gl.disableVertexAttribArray(V3.a.p); gl.disableVertexAttribArray(V3.a.n); v3Units(C, box); }   // 兵种立体模型（v3units.js）
  if (typeof v3Fx === 'function' && !(SETTINGS && SETTINGS.models3d === false)) { gl.disableVertexAttribArray(V3.a.p); gl.disableVertexAttribArray(V3.a.n); v3Fx(C); }   // 立体弹道（v3fx.js）
  const ctx = R.ctx;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'copy'; ctx.drawImage(V3.cv, 0, 0); ctx.restore();
  v3Overlay(ctx, now / 1000);
  return true;
}

// 世界坐标（含高度）→ 屏幕（CSS 像素）；在镜头背后返回 null。f：按距离的雾（0 清楚 … 1 看不见）
function v3Proj(x, y, z) {
  const M = V3.cam.M, X = x, Y = -y, cw = M[3] * X + M[7] * Y + M[11] * z + M[15];
  if (cw <= 1e-3) return null;
  const cx = M[0] * X + M[4] * Y + M[8] * z + M[12], cy = M[1] * X + M[5] * Y + M[9] * z + M[13], E = V3.cam.E;
  const f = smooth(V3.cam.D * 1.3, V3.cam.D * 2.8, Math.hypot(X - E[0], Y - E[1], z - E[2]));
  return { x: (cx / cw + 1) / 2 * CAM.vw, y: (1 - cy / cw) / 2 * CAM.vh, f };
}
// 立在地形上方的标识（屏幕空间，不随透视变形）：据点旗杆与菱形、战斗群北约标号、飞机按高度悬空并向地面引垂线
function v3Overlay(ctx, time) {
  ctx.save(); ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
  ctx.lineCap = 'round'; ctx.font = '11px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.textAlign = 'center';
  const near = CAM.z / CAM.fit > 2.2, spec = specAll() || R.eye === 'all', used = [];
  // 名称标签：和已画的标签重叠就不画（近处的先画，远处的让位）
  const label = (t, x, y, col, al) => {
    const w = ctx.measureText(t).width + 4, r = [x - w / 2, y - 11, x + w / 2, y + 2];
    if (used.some(o => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1])) return;
    used.push(r); ctx.fillStyle = rgba(col, al); ctx.fillText(t, x, y);
  };
  const stem = (x, y, hgt, col, a) => {
    const g = v3Ht(x, y), p0 = v3Proj(x, y, g), p1 = v3Proj(x, y, g + hgt);
    if (!p0 || !p1 || p1.f > .97) return null;
    const al = a * (1 - p1.f);
    ctx.strokeStyle = rgba(col, al * .55); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = rgba(col, al * .8); ctx.beginPath(); ctx.arc(p0.x, p0.y, 1.6, 0, 7); ctx.fill();
    return { ...p1, al };
  };
  // 据点（离镜头近的先画，名称优先）
  const C = V3.cam, byNear = (a, b) => dist(a.x, -a.y, C.E[0], C.E[1]) - dist(b.x, -b.y, C.E[0], C.E[1]);
  for (const p of S.points.slice().sort(byNear)) {
    const col = p.owner === 'p' ? COL.g : COL.enemy, q = stem(p.x, p.y, 34 + (p.vp || 1) * 8, col, .9);
    if (!q) continue;
    const r = 4 + (p.vp || 1);
    ctx.fillStyle = rgba(COL.bg, .75 * q.al); ctx.strokeStyle = rgba(col, q.al); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (p.owner === 'e' && p.prog > 0) { ctx.fillStyle = rgba(COL.g, q.al); ctx.fillRect(q.x - r, q.y + r + 2, r * 2 * p.prog, 2); }
    if (q.f < .6) label(p.name, q.x, q.y - r - 4, COL.text, q.al * .85);   // 地名（通联里说的据点名）一直标着，压住了就让近处的
  }
  // 海滩名（海面上）、方格号（近看时贴在地面每格左上角，与通联里的「D7 方格」对应）
  for (const b of TER.beaches) { const q = v3Proj(b.cx, coastAt(b.cx) + 70, 0); if (q && q.f < .7) label(b.name, q.x, q.y, COL.amber, .75 * (1 - q.f)); }
  if (near) {
    const gx0 = Math.floor(CAM.x / 200), gy0 = Math.floor(CAM.y / 200);
    for (let gx = gx0 - 3; gx <= gx0 + 3; gx++) for (let gy = gy0 - 3; gy <= gy0 + 3; gy++) {
      if (gx < 0 || gy < 0 || gx * 200 >= W || gy * 200 >= H) continue;
      const x = gx * 200 + 14, y = gy * 200 + 16, q = v3Proj(x, y, v3Ht(x, y));
      if (q && q.f < .5) label(gridRef(x, y), q.x, q.y, COL.g, .45 * (1 - q.f));
    }
  }
  // 战斗群（编制标号）
  for (const G of S.bgs || []) {
    if (G.dead || (G.side === 'e' && !spec && !spotted(G.ax, G.ay))) continue;
    const col = G.side === 'p' ? COL.g : COL.enemy, q = stem(G.ax, G.ay, 70, col, 1);
    if (!q) continue;
    const w = 20, h = 13;
    ctx.fillStyle = rgba(COL.bg, .8 * q.al); ctx.strokeStyle = rgba(col, q.al); ctx.lineWidth = 1.3;
    ctx.fillRect(q.x - w / 2, q.y - h / 2, w, h); ctx.strokeRect(q.x - w / 2, q.y - h / 2, w, h);
    ctx.beginPath(); ctx.moveTo(q.x - w / 2, q.y + h / 2); ctx.lineTo(q.x + w / 2, q.y - h / 2); ctx.moveTo(q.x - w / 2, q.y - h / 2); ctx.lineTo(q.x + w / 2, q.y + h / 2); ctx.stroke();
    ctx.fillStyle = rgba(col, q.al); ctx.fillText(G.ech || 'X', q.x, q.y - h / 2 - 3);
    if (near && q.f < .6) label(G.name, q.x, q.y + h / 2 + 11, COL.text, q.al * .85);
  }
  // 飞机：离地高度按 alt（0–1）放大，机头朝向按投影
  const air = (o, col) => {
    if (typeof V3M === 'object' && V3M.ok && !(SETTINGS && SETTINGS.models3d === false)) return;   // 立体模型已经画了飞机：不再画到地面的垂线（看着假）
    const x = o.x, y = o.y, hd = o.heading || 0, Z = v3AirZ(o), g = v3Ht(x, y), z = Z - g, q = stem(x, y, z, col, .9);
    if (!q) return;
    const p2 = v3Proj(x + Math.cos(hd) * 12, y + Math.sin(hd) * 12, Z);
    const a = p2 ? Math.atan2(p2.y - q.y, p2.x - q.x) : 0;
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(a);
    ctx.fillStyle = rgba(col, q.al); ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -4.5); ctx.lineTo(-2.5, 0); ctx.lineTo(-5, 4.5); ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  for (const p of S.planes || []) if (!p.dead && isFinite(p.x) && p.phase !== 'cat' && p.phase !== 'roll' && p.phase !== 'trap') air(p, COL.g);   // 甲板上的不画垂线
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && (spec || a.pv) && isFinite(a.x) && a.ph !== 'roll') air(a, COL.enemy);
  if (typeof hqMarks3 === 'function') hqMarks3(ctx, stem);   // 旅标：立在旅的上空（hq.js）
  if (typeof shOverlay3D === 'function') shOverlay3D(ctx, (x, y, h) => v3Proj(x, y, v3Ht(x, y) + h));   // 士兵喊话气泡（shout.js）
  if (typeof v3oOverlay === 'function') v3oOverlay(ctx);   // 观察者模式的准星
  ctx.restore();
}

// —— 开关与操作 ——
const v3Can = () => !!S && S.phase !== 'sandbox' && !(typeof INTRO === 'object' && INTRO.on);
// 开始界面背景：电脑上（非低画质）用 3D 地形缓慢转动展示
function v3Att() {
  if (!(typeof MENU === 'object' && MENU.open && !MENU.game) || V3.ok === false && V3.tried || R.lowCap || (typeof SETTINGS === 'object' && SETTINGS.quality === 'low')) return false;
  if (V3.coarse == null) V3.coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (V3.coarse) return false;
  V3.yaw = V3.yawT = (MENU.drift || 0) * .5; V3.tilt = V3.tiltT = 1.02;
  return true;
}
function v3Toggle(on = !V3.on) {
  if (on && !v3Can()) return;
  if (on && !V3.tried) v3Init();
  V3.on = on && V3.ok;
  const b = typeof $ === 'function' && $('btn3d'), c = typeof $ === 'function' && $('v3ctl');
  if (b) { b.classList.toggle('on', V3.on); b.setAttribute('aria-pressed', V3.on ? 'true' : 'false'); }
  if (c) c.hidden = !V3.on;
  if (!V3.on && typeof trxResize === 'function' && TRX.ok) trxResize();
  if (typeof log === 'function' && S && S.t != null) log(V3.on ? '3D 立体地图：中键拖动转向 / 俯仰，< > 转向，; \' 俯仰' : '平面地图', 'info', 'v3', 1);
}
const v3Turn = k => { V3.yawT += k * Math.PI / 8; };
const v3Tilt = k => { V3.tiltT = clamp(V3.tiltT + k * .12, V3_TILT[0], V3_TILT[1]); };

// 平移：拖动的屏幕方向按镜头转向换算到地面
function v3Pan(dx, dy) {
  const c = Math.cos(V3.yaw), s = Math.sin(V3.yaw);
  CAM.x -= (dx * c - dy * s) / CAM.z; CAM.y -= (dx * s + dy * c) / CAM.z / Math.max(.45, Math.cos(V3.tilt));
  camClamp();
}

// 输入：中键（或 Ctrl + 左键）拖动 → 横向转向、纵向俯仰；双指旋转 → 转向
HOOK.pointer.push((e, kind) => {
  if (!V3.on) return false;
  const { sx, sy } = evPos(e);
  if (kind === 'down' && (e.button === 1 || (e.button === 0 && e.ctrlKey))) { V3.orb = { sx, sy, id: e.pointerId }; return true; }
  if (V3.orb && V3.orb.id === e.pointerId) {
    if (kind === 'move') { V3.yawT -= (sx - V3.orb.sx) * .006; V3.yaw = V3.yawT; v3Tilt(-(sy - V3.orb.sy) * .05); V3.tilt = V3.tiltT; V3.orb.sx = sx; V3.orb.sy = sy; return true; }
    if (kind === 'up') { V3.orb = null; return true; }
  }
  return false;
});
HOOK.key.push(e => {
  const k = e.key;
  if ((k === 'l' || k === 'L') && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { v3Toggle(); return true; }   // 单按 L 是通讯面板（chat.js）
  if (!V3.on) return false;
  if (k === ',' || k === '<') { v3Turn(-1); return true; }
  if (k === '.' || k === '>') { v3Turn(1); return true; }
  if (k === ';') { v3Tilt(-1); return true; }
  if (k === "'") { v3Tilt(1); return true; }
  return false;
});

// 右上角按钮
function v3Button() {
  if (typeof document === 'undefined' || !document.getElementById('topr') || document.getElementById('btn3d')) return;
  const b = document.createElement('button');
  b.id = 'btn3d'; b.className = 'tb'; b.type = 'button'; b.textContent = '3D'; b.title = '3D 立体地图（Shift + L）'; b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => v3Toggle());
  const help = document.getElementById('btnHelp');
  help.parentNode.insertBefore(b, help);
  // 3D 时显示的转向 / 俯仰按钮（手机没有键盘、中键）
  const c = document.createElement('div');
  c.id = 'v3ctl'; c.className = 'ov box'; c.hidden = true; c.setAttribute('role', 'group'); c.setAttribute('aria-label', '3D 镜头');
  for (const [t, ti, f] of [['⟲', '向左转（<）', () => v3Turn(-1)], ['⟳', '向右转（>）', () => v3Turn(1)], ['⤒', '抬高视角、更俯视（;）', () => v3Tilt(-1)], ['⤓', '压低视角、更平视（\'）', () => v3Tilt(1)]]) {
    const k = document.createElement('button');
    k.type = 'button'; k.className = 'tb'; k.textContent = t; k.title = ti; k.setAttribute('aria-label', ti);
    k.addEventListener('click', f);
    c.appendChild(k);
  }
  document.getElementById('stage').appendChild(c);
  const st = document.createElement('style');
  st.textContent = '#btn3d.on { color: var(--bg); background: var(--g); border-color: var(--g); }' +
    '#v3ctl { top: calc(58px + env(safe-area-inset-top, 0px)); right: max(16px, env(safe-area-inset-right, 0px)); display: flex; gap: 4px; padding: 4px; }' +
    '#v3ctl[hidden] { display: none; } #v3ctl .tb { min-width: 34px; font-size: 16px; }' +
    '@media (max-height: 520px) { #v3ctl { top: calc(44px + env(safe-area-inset-top, 0px)); right: max(8px, env(safe-area-inset-right, 0px)); } #v3ctl .tb { height: 28px; min-width: 30px; } }';
  document.head.appendChild(st);
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', v3Button); else setTimeout(v3Button, 0); }
