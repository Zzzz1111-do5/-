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
const V3_HZ = 150, V3_FOV = .8, V3_TILT = [.05, 1.45], V3_SKIRT = -70;   // 俯仰：从几乎正俯视到几乎平视
let V3_ST = 2;   // 地形网格每几格一个顶点：显卡支持 32 位索引时为 1（每 10 米一个顶点，山脊、河谷的轮廓更细），否则 2

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
uniform sampler2D uTop, uBase, uCls, uCls2, uFogT, uHt, uLf, uTopF; uniform vec4 uBox, uBoxF; uniform vec2 uWorld, uGrid, uHG; uniform vec2 uFog; uniform float uSea, uT, uMx;
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
  // 俯视贴图：近处一张高清（uTop / uBox），远到地平线一张低清（uTopF / uBoxF，隔几帧更新），再远是底图
  vec2 uv = (w - uBox.xy) / uBox.zw, uvF = (w - uBoxF.xy) / uBoxF.zw;
  bool inBox = uv.x > 0. && uv.y > 0. && uv.x < 1. && uv.y < 1., inF = uvF.x > 0. && uvF.y > 0. && uvF.x < 1. && uvF.y < 1.;
  float wN = inBox ? smoothstep(0., .07, min(min(uv.x, uv.y), min(1. - uv.x, 1. - uv.y))) : 0.;   // 近处贴图的边上渐变到远处那张，看不出一圈分界
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
    vec3 cF = inF ? texture2D(uTopF, uvF).rgb : texture2D(uBase, w / uWorld).rgb;
    c = (wN > 0. ? mix(cF, texture2D(uTop, uv).rgb, wN) : cF) * (.5 + .75 * lit);
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
  // 河流、道路按中心线距离场画（uLf：R 到路中心 / 12 米、G 到河中心 / 半宽 / 2.5、B 路半宽 / 8；4 倍网格精度，边是光滑的曲线）
  vec4 LF = texture2D(uLf, cu);
  vec2 el = ex / 4.;
  // 河流：暗色水道、两岸亮线，水道里的字符顺流而下
  float rq = LF.g * 2.5;
  if (rq < 1.6) {
    float band = 1. - smoothstep(.92, 1.04, rq);
    vec2 gr = vec2(texture2D(uLf, cu + vec2(el.x, 0.)).g - texture2D(uLf, cu - vec2(el.x, 0.)).g, texture2D(uLf, cu + vec2(0., el.y)).g - texture2D(uLf, cu - vec2(0., el.y)).g);
    vec2 tg = normalize(vec2(-gr.y, gr.x) + vec2(0., 1e-4)); if (tg.y < 0.) tg = -tg;   // 顺流（向海，y 增大）
    vec2 nr = vec2(tg.y, -tg.x);
    c = mix(c, vec3(.0, .022, .028), band * .85);
    c += vec3(.15, .95, .7) * (1. - smoothstep(0., max(FW(rq), .01) * 1.5, abs(rq - 1.))) * .6;
    vec2 q = vec2(dot(w, nr) / 4.5, dot(w, tg) / 5.5 - uT * 1.6);
    c += vec3(.2, 1., .8) * mxGlyph(floor(q), fract(q), uT, 4.5 / pw) * band * .5;
  }
  // 道路：带亮边的通道，中线上一段段「数据包」沿路流动
  float dR = LF.r * 12., hwR = max(LF.b * 8., 1.5);
  if (dR < hwR + 2.) {
    float band = 1. - smoothstep(hwR - .3, hwR + .3, dR);
    vec2 gd = vec2(texture2D(uLf, cu + vec2(el.x, 0.)).r - texture2D(uLf, cu - vec2(el.x, 0.)).r, texture2D(uLf, cu + vec2(0., el.y)).r - texture2D(uLf, cu - vec2(0., el.y)).r);
    vec2 tg = normalize(vec2(-gd.y, gd.x) + vec2(1e-4, 0.));
    float sl = dot(w, tg);
    c = mix(c, vec3(.008, .05, .03), band * .75);
    c += G * (1. - smoothstep(0., max(FW(dR), .05) * 1.4, abs(dR - hwR))) * .6;
    float pk = step(.62, fract(sl / 18. - uT * .7 + mxH(floor(w / 60.)))) * (1. - smoothstep(.6, 1.2, dR));
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
  vec3 oF = inF ? texture2D(uTopF, uvF).rgb : vec3(0.);
  c += wN > 0. ? mix(oF, texture2D(uTop, uv).rgb, wN) : oF;
  gl_FragColor = vec4(mix(c, bg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;

// 城镇房屋：挤出成立体方块——屋顶取俯视贴图（与平面画面同一张），墙面暗绿，棱线发光
const V3_BVS = `attribute vec3 p; attribute vec3 n; attribute vec2 e;
uniform mat4 uM; uniform vec3 uEye;
varying vec3 vP, vN; varying vec2 vE; varying float vD;
void main() { vP = p; vN = n; vE = e; vD = distance(p, uEye); gl_Position = uM * vec4(p, 1.); }`;
const V3_BFS = `precision mediump float;
uniform sampler2D uTop, uBase, uTopF; uniform vec4 uBox, uBoxF; uniform vec2 uWorld, uFog; uniform float uT, uMx;
varying vec3 vP, vN; varying vec2 vE; varying float vD;
${V3_MX}
void main() {
  vec2 w = vec2(vP.x, -vP.y), uv = (w - uBox.xy) / uBox.zw, uvF = (w - uBoxF.xy) / uBoxF.zw;
  bool inF = uvF.x > 0. && uvF.y > 0. && uvF.x < 1. && uvF.y < 1.;
  vec3 N = normalize(vN), bg = vec3(.004, .02, .011);
  float lit = clamp(dot(N, normalize(vec3(-.45, .55, .7))), 0., 1.);
  float ed = min(min(vE.x, 1. - vE.x), min(vE.y, 1. - vE.y)), edge = 1. - smoothstep(.02, .1, ed);
  vec3 c;
  if (vE.x > 1.5) {   // 树：树冠（e.x 2.5）、树干（3.5）；不画棱线，边缘（侧面）一圈淡淡的轮廓光
    float tk = step(3., vE.x), hv = fract(sin(dot(floor(vP.xy * .25), vec2(12.9898, 78.233))) * 43758.5453), rim = smoothstep(.15, .9, 1. - abs(N.z));
    if (uMx > .5) c = mix(vec3(.004, .03, .016) * (.5 + 1.4 * lit) + vec3(.1, .7, .36) * rim * .1, vec3(.01, .02, .012), tk);
    else c = mix(mix(vec3(.05, .1, .04), vec3(.09, .15, .06), hv) * (.45 + .9 * lit) + vec3(.05, .09, .04) * rim * .3, vec3(.07, .05, .03) * (.5 + .7 * lit), tk);
  } else if (uMx > .5) {   // 数码风：楼是数字模型——深色实体、发光棱线；屋顶细方格，墙面上随机亮着的「窗格」，字符竖着往下落
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
    c = N.z > .5 ? ((uv.x > 0. && uv.y > 0. && uv.x < 1. && uv.y < 1.) ? texture2D(uTop, uv).rgb : inF ? texture2D(uTopF, uvF).rgb : texture2D(uBase, w / uWorld).rgb) * (.75 + .45 * lit)
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
  const big = verts.length / 6 > 65535 && V3.u32;   // 顶点超过 16 位索引的上限：用 32 位索引（OES_element_index_uint）
  V3.it = big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V3.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(idx) : new Uint16Array(idx), gl.STATIC_DRAW);
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
  V3.baseMM = c;
  v3BaseTex();
  v3Cls();
  v3HtTex();
  v3EnvBuild();
}
// 底图（远处、俯视贴图以外）：写实画面用整图地形渲染（terrain.js trxSnapshot，约 1.5 米一个像素，有农田、林冠、河流道路），
//   不再是每 10 米一个色块；黑绿 / 数码风的地面由着色器画，底图只在写实画面里用，用小地图配色就够
function v3BaseTex() {
  const gl = V3.gl, real = typeof realLook === 'function' && realLook() && !v3Mx();
  let src = V3.baseMM;
  const pw = V3.coarse || (V3.maxTex || 2048) < 4096 ? 2048 : 4096;   // 底图按 2 的幂（2:1）存，好生成多级渐远纹理
  if (real && typeof trxSnapshot === 'function') { const snap = trxSnapshot(pw); if (snap) src = snap; }
  V3.baseReal = real;
  if (!src) return;
  const P = V3.basePot || (V3.basePot = document.createElement('canvas'));
  if (P.width !== pw) { P.width = pw; P.height = pw / 2; }
  const cx = P.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(src, 0, 0, P.width, P.height);
  v3Upload(1, V3.base, P, gl.RGBA);
}
// 上传贴图：边长都是 2 的幂时生成多级渐远纹理、开各向异性过滤——斜着看远处的地面不再糊成一片，也不闪烁
function v3Upload(unit, tex, src, fmt) {
  const gl = V3.gl, pot = n => n > 0 && (n & (n - 1)) === 0, mip = pot(src.width) && pot(src.height);
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, fmt, gl.UNSIGNED_BYTE, src);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  if (V3.aniso) gl.texParameterf(gl.TEXTURE_2D, V3.aniso.TEXTURE_MAX_ANISOTROPY_EXT, mip ? V3.anMax : 1);
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
  if (typeof terLines === 'function') { const lf = terLines(); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, V3.lf); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lf.w, lf.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, lf.d); }   // 道路、河流的中心线距离场（terrain.js）
}
// 3D 地图用数码风画地面吗（黑绿画面；设置里可关）
const v3Mx = () => typeof SETTINGS === 'object' && !!SETTINGS && (SETTINGS.look === 'green' || SETTINGS.look === 'matrix') && SETTINGS.matrix3d !== false;   // 黑绿、数码两种画面都用数码风地面

// 房屋几何：民房是坡顶（两面坡 + 山墙，屋脊顺着长边），楼房是平顶（女儿墙、楼梯间 / 水箱），镇中心的更高；坐落在地面高度上；
// 机场建筑（afbase.js：机库、机堡、塔台、营房、油罐等，任意朝向的多边形柱体，塔台玻璃顶与水塔水箱架空）排在前面，机场被发现 / 夺取时重建；
// 树木（v3Trees）：林地成片、丘陵山地零星、田野里偶尔一棵孤树；按块（每块不超过 16 位索引）静态缓冲区
const v3Hsh = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
function v3Chunks() {
  const out = [];
  let cur = null;
  const need = n => { if (!cur || cur.vb.length / 8 + n > 65000) out.push(cur = { vb: [], ib: [] }); return cur; };
  return { out, need };
}
function v3Bld() {
  const gl = V3.gl, L = typeof townBld === 'function' ? townBld().list : [];
  const A = typeof afb3dBlocks === 'function' ? afb3dBlocks() : [];
  V3.asig = typeof afb3dSig === 'function' ? afb3dSig() : '';
  const K = v3Chunks();
  for (const k of A) {
    const n = k.pts.length, ch = K.need(n * 5 + 2), vb = ch.vb, ib = ch.ib;
    const P = k.pts.map(([x, y]) => [x, -y]), g = Math.min(...k.pts.map(([x, y]) => v3Ht(x, y))) - .5, z0 = g + k.z0 * 1.6, top = g + k.z * 1.6;
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
  const TW = typeof TER === 'object' && TER.towns ? [...(TER.towns.vills || []), TER.towns.town1, TER.towns.town2, TER.towns.town3, TER.towns.hq].filter(Boolean) : [];
  for (const b of L) {
    const ch = K.need(48), vb = ch.vb, ib = ch.ib;
    const quad = (pts, n, e) => { const k = vb.length / 8; pts.forEach(([x, y, z], i) => vb.push(x, y, z, n[0], n[1], n[2], e ? e[i][0] : (i === 1 || i === 2 ? 1 : 0), e ? e[i][1] : (i >= 2 ? 1 : 0))); ib.push(k, k + 1, k + 2, k, k + 2, k + 3); };
    const box = (X0, X1, Y0, Y1, z0, z1, roof = true) => {   // GL 坐标的方块（Y 已取负）：四面墙 + 平顶
      if (roof) quad([[X0, Y0, z1], [X1, Y0, z1], [X1, Y1, z1], [X0, Y1, z1]], [0, 0, 1]);
      quad([[X0, Y0, z0], [X1, Y0, z0], [X1, Y0, z1], [X0, Y0, z1]], [0, 1, 0]);    // 北墙
      quad([[X1, Y1, z0], [X0, Y1, z0], [X0, Y1, z1], [X1, Y1, z1]], [0, -1, 0]);   // 南墙
      quad([[X1, Y0, z0], [X1, Y1, z0], [X1, Y1, z1], [X1, Y0, z1]], [1, 0, 0]);    // 东墙
      quad([[X0, Y1, z0], [X0, Y0, z0], [X0, Y0, z1], [X0, Y1, z1]], [-1, 0, 0]);   // 西墙
    };
    const w = (b.r ? b.h : b.w) / 2, h = (b.r ? b.w : b.h) / 2, cx = b.x + b.dx, cy = b.y + b.dy, g = v3Ht(cx, cy) - .5;
    const dc = TW.length ? Math.min(...TW.map(t => Math.hypot(t.x - cx, t.y - cy))) : 99, core = dc < 24 ? 2 : dc < 40 ? 1 : 0, hs = v3Hsh(cx, cy), hs2 = v3Hsh(cy, cx);
    const X0 = cx - w, X1 = cx + w, Y0 = -(cy - h), Y1 = -(cy + h);   // GL 坐标：y 取负（北为正）
    if (b.f) {   // 平顶楼房：4–7 层（镇中心再高两层）、女儿墙、屋顶楼梯间 / 水箱
      const top = g + (4 + Math.floor(hs * 4) + core) * 2.6, pw = .35;
      box(X0, X1, Y0, Y1, g, top, false);
      quad([[X0 + pw, Y0 - pw, top - .5], [X1 - pw, Y0 - pw, top - .5], [X1 - pw, Y1 + pw, top - .5], [X0 + pw, Y1 + pw, top - .5]], [0, 0, 1]);   // 屋面（比墙顶低半格）
      quad([[X0, Y0, top], [X1, Y0, top], [X1 - pw, Y0 - pw, top], [X0 + pw, Y0 - pw, top]], [0, 0, 1], [[0, 0], [1, 0], [1, .5], [0, .5]]);   // 女儿墙顶
      quad([[X1, Y1, top], [X0, Y1, top], [X0 + pw, Y1 + pw, top], [X1 - pw, Y1 + pw, top]], [0, 0, 1], [[0, 0], [1, 0], [1, .5], [0, .5]]);
      quad([[X1, Y0, top], [X1, Y1, top], [X1 - pw, Y1 + pw, top], [X1 - pw, Y0 - pw, top]], [0, 0, 1], [[0, 0], [1, 0], [1, .5], [0, .5]]);
      quad([[X0, Y1, top], [X0, Y0, top], [X0 + pw, Y0 - pw, top], [X0 + pw, Y1 + pw, top]], [0, 0, 1], [[0, 0], [1, 0], [1, .5], [0, .5]]);
      const sx = lerp(X0 + 1, X1 - 2.2, hs2), sy = lerp(Y1 + 1, Y0 - 2, hs);   // 楼梯间
      box(sx, sx + 1.4, sy, sy + 1.2, top - .5, top + 1.8);
      if (hs2 > .45) { const tx = lerp(X0 + .8, X1 - 1.6, 1 - hs2), ty = lerp(Y1 + .8, Y0 - 1.6, 1 - hs); box(tx, tx + .9, ty, ty + .9, top + .4, top + 1.5); }   // 水箱
    } else {   // 坡顶民房：2–3 层，两面坡屋顶（屋脊顺长边），两头山墙
      const ew = g + (2 + Math.floor(hs * 2) + (core > 1 ? 1 : 0)) * 2.8, rh = 1.8 + hs2 * 1.2, ov = .35;
      box(X0, X1, Y0, Y1, g, ew, false);
      const ex = [[0, 0], [1, 0], [1, 1], [0, 1]];
      if (X1 - X0 >= Y0 - Y1) {   // 屋脊东西向
        const ym = (Y0 + Y1) / 2, nz = (Y0 - Y1) / 2 + ov, l = Math.hypot(nz, rh), N = [0, rh / l, nz / l], S2 = [0, -rh / l, nz / l];
        quad([[X0 - ov, Y0 + ov, ew - .3], [X1 + ov, Y0 + ov, ew - .3], [X1 + ov, ym, ew + rh], [X0 - ov, ym, ew + rh]], N, ex);
        quad([[X1 + ov, Y1 - ov, ew - .3], [X0 - ov, Y1 - ov, ew - .3], [X0 - ov, ym, ew + rh], [X1 + ov, ym, ew + rh]], S2, ex);
        quad([[X1, Y0, ew], [X1, Y1, ew], [X1, ym, ew + rh], [X1, ym, ew + rh]], [1, 0, 0], ex);   // 山墙（三角形：上面两点重合）
        quad([[X0, Y1, ew], [X0, Y0, ew], [X0, ym, ew + rh], [X0, ym, ew + rh]], [-1, 0, 0], ex);
      } else {   // 屋脊南北向
        const xm = (X0 + X1) / 2, nz = (X1 - X0) / 2 + ov, l = Math.hypot(nz, rh), E = [rh / l, 0, nz / l], Wn = [-rh / l, 0, nz / l];
        quad([[X1 + ov, Y0 + ov, ew - .3], [X1 + ov, Y1 - ov, ew - .3], [xm, Y1 - ov, ew + rh], [xm, Y0 + ov, ew + rh]], E, ex);
        quad([[X0 - ov, Y1 - ov, ew - .3], [X0 - ov, Y0 + ov, ew - .3], [xm, Y0 + ov, ew + rh], [xm, Y1 - ov, ew + rh]], Wn, ex);
        quad([[X0, Y0, ew], [X1, Y0, ew], [xm, Y0, ew + rh], [xm, Y0, ew + rh]], [0, 1, 0], ex);
        quad([[X1, Y1, ew], [X0, Y1, ew], [xm, Y1, ew + rh], [xm, Y1, ew + rh]], [0, -1, 0], ex);
      }
    }
  }
  const up = L => L.filter(c => c.ib.length).map(c => {
    const o = { b: gl.createBuffer(), i: gl.createBuffer(), n: c.ib.length, bb: c.bb };
    gl.bindBuffer(gl.ARRAY_BUFFER, o.b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(c.vb), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(c.ib), gl.STATIC_DRAW);
    return o;
  }), drop = L => { for (const c of L || []) { gl.deleteBuffer(c.b); gl.deleteBuffer(c.i); } };
  drop(V3.bch);
  const TL = v3Trees();
  if (V3.tchL !== TL) { drop(V3.tch); V3.tch = up(TL); V3.tchL = TL; }   // 树只在地图 / 地形变了时重传（机场被发现时只重建房屋）
  V3.bch = [...up(K.out), ...V3.tch];
  V3.bn = V3.bch.reduce((a, c) => a + c.n, 0);
}
// 树：阔叶树（两层收拢的多面树冠）、针叶树（尖塔形）、细树干；e.x = 2.5 标记树冠、3.5 树干（着色器另配颜色，不画棱线）
// 返回若干小块（每块的顶点、索引，按地图种子缓存；地形改了（弹坑等）重算高度）
function v3Trees() {
  if (!(typeof TER === 'object' && TER && TER.type)) return [];
  const sig = TER.seed + ':' + (V3.sig || '');
  if (V3.trees && V3.trees.sig === sig) return V3.trees.list;
  const r = rng(TER.seed + 77), list = [];
  let cur = { vb: [], ib: [] };
  const af = TER.af, roadNear = (gx, gy) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = gx + dx, y = gy + dy; if (x < 0 || y < 0 || x >= GW || y >= GH) continue; const t = TER.type[y * GW + x]; if (t === T.ROAD || t === T.BRIDGE || t === T.TOWN || t === T.RIVER || t === T.BEACH) return true; } return false; };
  const ptsNear = (x, y) => (TER.points || []).some(p => Math.abs(p.x - x) < 26 && Math.abs(p.y - y) < 26);
  const tree = (x, y, hgt, rad, con) => {
    if (cur.vb.length / 8 > 60000) { list.push(cur); cur = { vb: [], ib: [], bb: cur.bb }; }
    const vb = cur.vb, ib = cur.ib, g = v3Ht(x, y) - .2, X = x, Y = -y, a0 = r() * 6.28, n = 5, base = vb.length / 8;
    const tr = .22 + rad * .05;   // 树干：三棱柱
    for (let i = 0; i < 3; i++) { const a = a0 + i * 2.094, c = Math.cos(a), s = Math.sin(a); vb.push(X + c * tr, Y + s * tr, g, c, s, 0, 3.5, .5, X + c * tr * .7, Y + s * tr * .7, g + hgt * .45, c, s, 0, 3.5, .5); }
    for (let i = 0; i < 3; i++) { const j = (i + 1) % 3, a = base + i * 2, b2 = base + j * 2; ib.push(a, b2, b2 + 1, a, b2 + 1, a + 1); }
    const c0 = vb.length / 8, ring = (z, rr, nz, k) => { for (let i = 0; i < n; i++) { const a = a0 + i * 6.2832 / n + k, c = Math.cos(a), s = Math.sin(a), jr = rr * (.85 + .3 * r()); vb.push(X + c * jr, Y + s * jr, z, c * (1 - Math.abs(nz)), s * (1 - Math.abs(nz)), nz, 2.5, .5); } };
    // 针叶：两层尖塔（下层宽、上层收）；阔叶：腰宽、上收的多面树冠；底下一个尖收到树干
    if (con) { ring(g + hgt * .22, rad, -.25, 0); ring(g + hgt * .55, rad * .62, .35, .6); }
    else { ring(g + hgt * .55, rad, .05, 0); ring(g + hgt * .85, rad * .62, .6, .63); }
    vb.push(X, Y, g + hgt, 0, 0, 1, 2.5, .5, X, Y, g + hgt * (con ? .2 : .32), 0, 0, -1, 2.5, .5);
    const tip = c0 + 2 * n;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; ib.push(c0 + i, c0 + j, c0 + n + j, c0 + i, c0 + n + j, c0 + n + i, c0 + n + i, c0 + n + j, tip, tip + 1, c0 + j, c0 + i); }
  };
  const TS = 30;   // 按 30 × 30 格的方块分块（每块一个缓冲区、带包围盒，远处雾里的整块不画）
  for (let ty = 0; ty < GH; ty += TS) for (let tx = 0; tx < GW; tx += TS) {
  if (cur.ib.length) list.push(cur);
  cur = { vb: [], ib: [], bb: [tx * CELL - 6, ty * CELL - 6, (tx + TS) * CELL + 6, (ty + TS) * CELL + 6] };
  for (let gy = ty; gy < Math.min(GH, ty + TS); gy++) for (let gx = tx; gx < Math.min(GW, tx + TS); gx++) {
    const i = gy * GW + gx, t = TER.type[i];
    let n = 0;
    if (t === T.FOREST) n = 1 + (r() < (V3.coarse ? .15 : .45) ? 1 : 0) + (!V3.coarse && r() < .12 ? 1 : 0);   // 触屏（手机、平板）少种一些
    else if (t === T.HILL) n = r() < .16 ? 1 : 0;
    else if (t === T.MOUNT) n = r() < .09 ? 1 : 0;
    else if (t === T.FIELD) n = r() < .01 ? 1 : 0;
    else if (t === T.MARSH) n = r() < .06 ? 1 : 0;
    if (!n || (t !== T.FOREST && roadNear(gx, gy))) continue;
    const cx = gx * CELL + CELL / 2, cy = gy * CELL + CELL / 2;
    if (af && Math.hypot(cx - af.x, cy - af.y) < 520) continue;   // 机场场区（跑道、滑行道）不长树
    if (ptsNear(cx, cy)) continue;   // 据点、阵地上不长树（挡住工事）
    for (let k = 0; k < n; k++) {
      const x = cx + (r() - .5) * CELL * .9, y = cy + (r() - .5) * CELL * .9, el = TER.elev[i] || 0, con = el > .62 || t === T.MOUNT || r() < .28;
      const hgt = (t === T.FOREST ? 7.5 + r() * 4 : 6 + r() * 3) * (t === T.MARSH ? .6 : 1), rad = (con ? 1.9 : 2.6) + r() * 1.1;
      tree(x, y, hgt, rad, con);
    }
  }
  }
  if (cur.ib.length) list.push(cur);
  V3.trees = { sig, list };
  return list;
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
    for (const k of ['uM', 'uEye', 'uTop', 'uBase', 'uCls', 'uCls2', 'uFogT', 'uHt', 'uLf', 'uTopF', 'uBox', 'uBoxF', 'uWorld', 'uGrid', 'uHG', 'uFog', 'uSea', 'uT', 'uMx']) u[k] = gl.getUniformLocation(pr, k);
    const pb = gl.createProgram();
    gl.attachShader(pb, sh(gl.VERTEX_SHADER, V3_BVS)); gl.attachShader(pb, sh(gl.FRAGMENT_SHADER, V3_BFS));
    gl.linkProgram(pb);
    if (!gl.getProgramParameter(pb, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pb));
    const ub = {}, ab = { p: gl.getAttribLocation(pb, 'p'), n: gl.getAttribLocation(pb, 'n'), e: gl.getAttribLocation(pb, 'e') };
    for (const k of ['uM', 'uEye', 'uTop', 'uBase', 'uTopF', 'uBox', 'uBoxF', 'uWorld', 'uFog', 'uT', 'uMx']) ub[k] = gl.getUniformLocation(pb, k);
    gl.useProgram(pb); gl.uniform1i(ub.uTop, 0); gl.uniform1i(ub.uBase, 1); gl.uniform1i(ub.uTopF, 7);
    Object.assign(V3, { pb, ub, ab });
    const mk = (unit, filt) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, filt], [gl.TEXTURE_MAG_FILTER, filt], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v); return t; };
    Object.assign(V3, { gl, cv, pr, u, a, tex: mk(0, gl.LINEAR), base: mk(1, gl.LINEAR), cls: mk(2, gl.LINEAR), cls2: mk(3, gl.LINEAR), fog: mk(4, gl.LINEAR), ht: mk(5, gl.NEAREST), lf: mk(6, gl.LINEAR), texF: mk(7, gl.LINEAR), topF: document.createElement('canvas'), u32: !!gl.getExtension('OES_element_index_uint'), top: document.createElement('canvas'), coarse: V3.coarse ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches), maxTex: Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048), ok: true });
    gl.useProgram(pr);
    gl.uniform1i(u.uTop, 0); gl.uniform1i(u.uBase, 1); gl.uniform1i(u.uCls, 2); gl.uniform1i(u.uCls2, 3); gl.uniform1i(u.uFogT, 4); gl.uniform1i(u.uHt, 5); gl.uniform1i(u.uLf, 6); gl.uniform1i(u.uTopF, 7);
    if (V3.u32) V3_ST = 1;
    V3.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic'); V3.anMax = V3.aniso ? Math.min(8, gl.getParameter(V3.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;
    gl.enable(gl.DEPTH_TEST);
  } catch (e) { V3.ok = false; console.warn('3D 地图不可用', e); }
}

// —— 3D 镜头：自由镜头（V3.fc）——镜头本身就是一个在战场上空自由移动的视点：位置 (x, y, z) + 偏航 yaw（0 朝东、π/2 朝南）+ 俯仰 pitch（向上为正）。
//   不再绕着地面上的某一点转（不是第三人称）：拖动 / Q E / R F 是原地转头、抬头低头；W S 沿视线方向前后飞（抬头往上、低头往下）、A D 左右平移；
//   滚轮朝鼠标指着的地方推近 / 拉远；左键拖动平移（地面跟着手走）；小地图、编队栏双击等「把镜头移到某处」保持当前朝向和距离平移过去。
//   画面中心（CAM.x, CAM.y）与缩放 CAM.z 每帧由镜头推算（视线落地点、离地高度），贴图范围、细节档、平面地图的切换都照旧按它们
// 渲染距离（设置「3D 渲染距离」）：雾、远景贴图、远裁剪面一起放远 / 拉近
const v3RD = () => clamp(+(typeof SETTINGS === 'object' && SETTINGS && SETTINGS.rdist) || 1, .5, 4);
// 能见距离（雾的起点、终点）：按镜头尺度 D，再乘玩家设的渲染距离（设置里的「3D 渲染距离」、3D 里 [ ] 键）；贴近地面时也至少看得到 1000 × 倍数 米
const v3Fog = (D, rd = v3RD()) => { const f1 = Math.max(D * 3.2, 1000) * rd; return [f1 * .5, f1]; };   // 远处清楚的范围放远（原来 2.8 倍、雾从 46% 起，远处的地面一片暗）
const v3FogR = C => C.fog || [C.D * 1.3, C.D * 2.8], v3FogE = C => v3FogR(C)[1];
// 从「注视点 + 距离 + 俯角 + 方位」（原来的环绕参数）换算成自由镜头：进 3D 时画面和平面地图一致
function v3FcFromOrbit(tx, ty, tz, D, th, ps) {
  const x = tx + D * Math.sin(th) * Math.sin(ps), y = ty + D * Math.sin(th) * Math.cos(ps), z = tz + D * Math.cos(th);
  const yaw = Math.atan2(ty - y, tx - x), pitch = th - Math.PI / 2;
  return { x, y, z, yaw, pitch, yawT: yaw, pitchT: pitch, cx: null, cy: null, cz: null, d: D };
}
function v3FcInit() {
  let D = (CAM.vh / CAM.z) / (2 * Math.tan(V3_FOV / 2)), th = V3.tiltT ?? .95;
  const ps = V3.yawT ?? 0, tz = v3Ht(CAM.x, CAM.y), ux = Math.sin(ps), uy = Math.cos(ps);
  // 平面地图缩得很远时换算出的镜头会在地图外、高度上限以上：改成更陡地俯看、再降低距离，镜头仍对着原来的画面中心
  const lim = (p, u, a, b) => u > 1e-6 ? (b - p) / u : u < -1e-6 ? (a - p) / u : 1e9;
  const hmax = Math.max(0, Math.min(lim(CAM.x, ux, -400, W + 400), lim(CAM.y, uy, -400, H + 400)));
  if (D * Math.sin(th) > hmax) th = Math.asin(clamp(hmax / D, 0, 1));
  if (D * Math.cos(th) > 4200 - tz) D = (4200 - tz) / Math.max(.2, Math.cos(th));
  V3.fc = v3FcFromOrbit(CAM.x, CAM.y, tz, D, th, ps);
}
const v3Gnd = (x, y) => Math.max(v3Ht(clamp(x, 0, W - 1), clamp(y, 0, H - 1)), -2.6, typeof cvCamZ === 'function' ? cvCamZ(x, y) ?? -99 : -99);
// 镜头离最近的东西有多远：脚下的地面 / 甲板，空中的飞机、直升机（近裁剪面按它定）
function v3NearGap(F) {
  let g = Math.max(.5, F.z - v3Gnd(F.x, F.y));
  const near = o => { if (!o || o.dead || !isFinite(o.x)) return; const d = Math.hypot(o.x - F.x, o.y - F.y); if (d < g + 40) g = Math.min(g, Math.max(.5, Math.hypot(d, v3AirZ(o) - F.z) - 20)); };   // 减去半个翼展
  for (const p of (S && S.planes) || []) near(p);
  if (S && S.eair) for (const a of S.eair.fly || []) near(a);
  return g;
}
function v3FcCamera() {
  const F = V3.fc || (v3FcInit(), V3.fc), cp = Math.cos(F.pitch), f = [cp * Math.cos(F.yaw), -cp * Math.sin(F.yaw), Math.sin(F.pitch)];   // 视线方向（GL 坐标）
  const E = [F.x, -F.y, F.z], z = [-f[0], -f[1], -f[2]], x = v3Norm(v3Cross([0, 0, 1], z)), y = v3Cross(z, x);
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, E), -v3Dot(y, E), -v3Dot(z, E), 1]);
  const D = clamp(F.d || 600, 80, 5000), rd = v3RD(), fog = v3Fog(D, rd);
  const asp = CAM.vw / Math.max(1, CAM.vh), fo = 1 / Math.tan(V3_FOV / 2), n = clamp(Math.min(D * .012, v3NearGap(F) * .45), .3, 25), fa = Math.max(D * 9, fog[1] * 1.5), nf = 1 / (n - fa);   // 近裁剪面：离最近的东西（地面、飞机）越近越小，凑近飞机不会被切掉
  const proj = new Float32Array([fo / asp, 0, 0, 0, 0, fo, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]);
  return (V3.cam = { E, x, y, z, D, rd, fog, asp, M: v3Mul(proj, view) });
}
// 每帧：转头缓动、按键飞行、外部「移镜头」的平移、不钻地；再推算画面中心与缩放
function v3FcStep(dt) {
  const F = V3.fc || (v3FcInit(), V3.fc);
  if (F.cx != null && (Math.abs(CAM.x - F.cx) > .5 || Math.abs(CAM.y - F.cy) > .5)) { F.x += CAM.x - F.cx; F.y += CAM.y - F.cy; }   // 别处把画面中心移走了（小地图、双击编队、点消息定位）：镜头平移过去
  F.yaw += Math.atan2(Math.sin(F.yawT - F.yaw), Math.cos(F.yawT - F.yaw)) * Math.min(1, dt * 14);
  F.pitch += (F.pitchT - F.pitch) * Math.min(1, dt * 14);
  F.x = clamp(F.x, -400, W + 400); F.y = clamp(F.y, -400, H + 400);
  F.z = clamp(F.z, v3Gnd(F.x, F.y) + 3, 4200);
  const alt = Math.max(1, F.z - v3Gnd(F.x, F.y)), cp = Math.cos(F.pitch), down = -Math.sin(F.pitch);
  const reach = down > .05 ? Math.min(5000, alt / down * cp) : 2600 * Math.min(1, alt / 200 + .3);   // 视线落地点（看天时取前方一段）
  F.d = Math.hypot(reach, Math.min(alt, reach * 3));
  CAM.x = F.x + Math.cos(F.yaw) * reach; CAM.y = F.y + Math.sin(F.yaw) * reach;
  CAM.z = clamp((CAM.vh / Math.max(30, F.d)) / (2 * Math.tan(V3_FOV / 2)), CAM.fit, Math.max(CAM.fit * 12, 4));   // 与原来的环绕镜头同一换算：画面中心的比例接近平面地图
  camClamp();
  F.cx = CAM.x; F.cy = CAM.y; F.cz = CAM.z;
  V3.yaw = V3.yawT = Math.atan2(-Math.cos(F.yaw), -Math.sin(F.yaw)); V3.tilt = V3.tiltT = clamp(F.pitch + Math.PI / 2, V3_TILT[0], V3_TILT[1]);   // 兼容：旧的方位 / 俯角
}
// 原地转头（偏航）、抬头低头（俯仰）
function v3Look(dyaw, dpitch, now) {
  const F = V3.fc || (v3FcInit(), V3.fc);
  F.yawT += dyaw; F.pitchT = clamp(F.pitchT + dpitch, -1.52, 1.45);   // 可以抬头看到接近头顶（仰看飞过头顶的飞机）
  if (now) { F.yaw = F.yawT; F.pitch = F.pitchT; }
}
// 沿视线飞：fw 前后（沿视线方向，含高低）、rt 左右平移，按离地高度定速度
function v3Fly(fw, rt, dt) {
  const F = V3.fc || (v3FcInit(), V3.fc), alt = Math.max(1, F.z - v3Gnd(F.x, F.y)), sp = clamp(alt * 1.25, 50, 1100) * dt, cp = Math.cos(F.pitch);
  F.x += (Math.cos(F.yaw) * cp * fw - Math.sin(F.yaw) * rt) * sp; F.y += (Math.sin(F.yaw) * cp * fw + Math.cos(F.yaw) * rt) * sp; F.z += Math.sin(F.pitch) * fw * sp;
}
// 推近 / 拉远：朝屏幕上 (sx, sy) 指着的地面点移动（k > 1 推近）
function v3Dolly(sx, sy, k) {
  const F = V3.fc || (v3FcInit(), V3.fc), P = v3Pick(sx, sy), pz = v3Gnd(P.x, P.y), dx = P.x - F.x, dy = P.y - F.y, dz = pz - F.z, d = Math.hypot(dx, dy, dz) || 1;
  let m = d * (1 - 1 / k);
  if (k > 1) m = Math.min(m, d - 6);   // 推近：停在离那一点 6 米外
  else m = Math.max(m, dz < 0 ? -Math.max(0, 4200 - F.z) / Math.max(.05, -dz / d) : -d * 3);   // 拉远：到了最高高度就停，不再贴着高度上限水平往后飘出地图
  F.x += dx / d * m; F.y += dy / d * m; F.z += dz / d * m;
}
// 镜头：画面中心（CAM.x, CAM.y）为目标点；距离按平面地图的缩放换算，使画面中心的比例与平面时相同（开始界面背景的环绕展示用）
function v3Camera() {
  if (typeof V3O === 'object' && V3O.on) return v3oCamera();   // 观察者模式（v3obs.js）
  if (V3.on) return v3FcCamera();   // 自由镜头
  const th = V3.tilt, ps = V3.yaw, D = (CAM.vh / CAM.z) / (2 * Math.tan(V3_FOV / 2));
  const T = [CAM.x, -CAM.y, V3.tz ?? v3Ht(CAM.x, CAM.y)];   // 注视点高度按帧平滑跟随地形 / 航母甲板（v3TzStep），翻过山头、掠过航母时镜头不突然冒高
  const E = [T[0] + D * Math.sin(th) * Math.sin(ps), T[1] - D * Math.sin(th) * Math.cos(ps), T[2] + D * Math.cos(th)];
  { const g = v3Ht(clamp(E[0], 0, W - 1), clamp(-E[1], 0, H - 1)); if (E[2] < g + 8) E[2] = g + 8; }   // 平视时镜头不钻进身后的山里
  const z = v3Norm(v3Sub(E, T)), x = v3Norm(v3Cross([-Math.sin(ps), Math.cos(ps), 0], z)), y = v3Cross(z, x);
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, E), -v3Dot(y, E), -v3Dot(z, E), 1]);
  const asp = CAM.vw / Math.max(1, CAM.vh), f = 1 / Math.tan(V3_FOV / 2), n = D * .03, fa = D * 9, nf = 1 / (n - fa);
  const proj = new Float32Array([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]);
  return (V3.cam = { E, x, y, z, D, rd: 1, fog: [D * 1.3, D * 2.8], asp, M: v3Mul(proj, view) });
}
// 注视点高度：画面中心脚下的地形包络（比实际地形平缓）与航母飞行甲板取高者，按真实时间平滑过去（时间常数约 0.35 秒）
function v3TzStep(dt) {
  const cz = typeof cvCamZ === 'function' ? cvCamZ(CAM.x, CAM.y) : null, g = V3.env ? v3Env(CAM.x, CAM.y) : v3Ht(CAM.x, CAM.y), want = Math.max(g, cz ?? -99);
  if (V3.tz == null || !isFinite(V3.tz)) V3.tz = want;
  else V3.tz += (want - V3.tz) * (1 - Math.exp(-dt / .35));
}
// 按住 Q / E 连续转向、R / F 连续俯仰（右键拖动同样可以自由转视角）
function v3HoldStep(dt) {
  const K = V3.hold;
  if (!K || !K.size || !V3.on) return;
  v3Look((K.has('KeyE') ? 1.6 : 0) * dt - (K.has('KeyQ') ? 1.6 : 0) * dt, (K.has('KeyR') ? 1 : 0) * dt - (K.has('KeyF') ? 1 : 0) * dt, true);   // Q E 原地左右转头、R 抬头 F 低头
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
// lim：视线最远取到几倍的镜头尺度（2.6 = 一直到地平线的雾里；近处的高清贴图取 1.15）
const V3_SKY = 700;   // 最高的飞行高度（战术弹道导弹弹道顶点附近）
function v3Box(lim = 2.6) {
  const C = V3.cam, pts = [];
  for (const [sx, sy] of [[0, 0], [CAM.vw / 2, 0], [CAM.vw, 0], [0, CAM.vh / 2], [CAM.vw, CAM.vh / 2], [0, CAM.vh], [CAM.vw / 2, CAM.vh], [CAM.vw, CAM.vh]]) {
    const { o, d } = v3Ray(sx, sy);
    let t = d[2] < -1e-4 ? (V3_HZ * .3 - o[2]) / d[2] : d[2] > 1e-4 ? (V3_SKY - o[2]) / d[2] : C.D * lim;   // 往上看的视线：飞机、导弹只会在它穿过最高飞行高度之前出现
    t = Math.min(Math.max(t, 0), C.D * lim);   // 再远的地方已经暗下去了（雾），用底图
    pts.push([o[0] + d[0] * t, -(o[1] + d[1] * t)]);
  }
  pts.push([C.E[0], -C.E[1]]);   // 镜头脚下：仰看时头顶的飞机就在这附近（原来只按视线远处的落点圈范围，正下方往上看时飞机被当成在范围外不画）
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
  // 转向 / 俯仰缓动；注视点高度平滑
  const fdt = clamp((now - (V3.lastNow || now)) / 1000, 0, .1); V3.lastNow = now;
  if (typeof V3O === 'object' && V3O.on) v3oStep(now);
  else if (V3.on) { v3HoldStep(fdt); v3FcStep(fdt); }   // 自由镜头
  else { v3TzStep(fdt); V3.yaw += Math.atan2(Math.sin(V3.yawT - V3.yaw), Math.cos(V3.yawT - V3.yaw)) * .18; V3.tilt += (V3.tiltT - V3.tilt) * .18; }   // 开始界面背景的环绕展示
  const C = v3Camera(), box = V3.box = v3Box(Math.max(2.6, v3FogE(C) * .93 / C.D)), boxN = v3Box(1.15);   // 远处贴图（与立体模型）铺到能见距离
  if (V3.baseReal !== (typeof realLook === 'function' && realLook() && !v3Mx())) v3BaseTex();   // 切换了画面风格：底图跟着换
  // 俯视贴图：近处一张高清（每帧画），整个可见范围一张低清（每 3 帧画一次）；近处已经盖住大半个可见范围（俯看时）就只画一张
  const cap = Math.min(V3.maxTex, R.lowCap || (SETTINGS && SETTINGS.quality === 'low') ? 1280 : V3.coarse ? 1600 : 2048, Math.max(1024, Math.max(R.cv.width, R.cv.height) * 1.3));   // 屏外俯视画布最长边（按屏幕大小，手机、低画质更小）
  // 跟不上（主循环帧间隔滑动平均超过 40ms）就把屏外画布逐步缩小，最低 45%；流畅后再慢慢放大
  if (typeof ema === 'number') V3.capK = clamp((V3.capK || 1) * (ema > .04 ? .985 : ema < .022 ? 1.004 : 1), .45, 1);
  const dpr = R.dprCap ? 1 : Math.min(2, window.devicePixelRatio || 1), one = boxN[2] * boxN[3] > box[2] * box[3] * .7;
  const bN = one ? box : boxN, sTop = Math.min(CAM.z * dpr, cap * (V3.capK || 1) / Math.max(bN[2], bN[3]));
  const K = { cv: R.cv, ctx: R.ctx, s: R.s, ox: R.ox, oy: R.oy, dpr: R.dpr, vw: CAM.vw, vh: CAM.vh, z: CAM.z, x: CAM.x, y: CAM.y };
  // 有立体模型的东西（飞机、车辆、舰船、阵地，近看时的步兵）贴图里不再画平面图标——否则地面上多一层「倒影」
  //   画布边长取最接近的 2 的幂（上传后生成多级渐远纹理）：比例按装得下整个范围取，多出来的一边把范围往两边放宽；返回实际铺的范围
  const pot = n => 2 ** clamp(Math.round(Math.log2(Math.max(64, n))), 6, 12);
  const paint = (cv, b0, sc0) => {
    const tw = pot(b0[2] * sc0), th = pot(b0[3] * sc0), sc = Math.min(tw / b0[2], th / b0[3]), bw = tw / sc, bh = th / sc;
    const b = [b0[0] + b0[2] / 2 - bw / 2, b0[1] + b0[3] / 2 - bh / 2, bw, bh];
    if (cv.width !== tw || cv.height !== th) { cv.width = tw; cv.height = th; }
    V3.drawing = true;
    R.fx3d = typeof v3Fx === 'function' && !(SETTINGS && SETTINGS.models3d === false);   // 弹道在 3D 里立体画（v3fx.js），贴图里不再画
    R.m3d = R.fx3d && typeof V3M === 'object' && !!V3M.ok; R.m3dNear = true;   // 士兵远近都是立体模型（远处低模，v3units.js），贴图里不再画平的小人
    try {
      R.cv = cv; R.ctx = cv.getContext('2d'); R.dpr = 1;
      CAM.vw = tw; CAM.vh = th; CAM.z = R.s = sc; CAM.x = b[0] + b[2] / 2; CAM.y = b[1] + b[3] / 2;
      R.ox = -b[0] * sc; R.oy = -b[1] * sc;
      drawScene(now);
    } finally {
      V3.drawing = false; R.fx3d = false; R.m3d = false;
      Object.assign(R, { cv: K.cv, ctx: K.ctx, s: K.s, ox: K.ox, oy: K.oy, dpr: K.dpr });
      Object.assign(CAM, { vw: K.vw, vh: K.vh, z: K.z, x: K.x, y: K.y });
    }
    return b;
  };
  V3.boxN = paint(V3.top, bN, sTop);
  if (!one && (!V3.boxB || (V3.fT = (V3.fT || 0) + 1) % 3 === 0 || Math.abs(V3.boxB[0] - box[0]) + Math.abs(V3.boxB[1] - box[1]) > box[2] * .12)) {
    V3.boxF = paint(V3.topF, box, Math.min(sTop, cap * (V3.capK || 1) / Math.max(box[2], box[3])));   // 远处这张也按整幅分辨率画（原来只有六成，远景糊）
    V3.boxB = box.slice(); V3.fNew = true;
  }
  if (one) { V3.boxF = [0, 0, 0, 0]; V3.boxB = null; }
  // 3D 网格
  const W0 = R.cv.width, H0 = R.cv.height;
  if (V3.cv.width !== W0 || V3.cv.height !== H0) { V3.cv.width = W0; V3.cv.height = H0; }
  gl.viewport(0, 0, W0, H0);
  gl.useProgram(V3.pr);
  v3Upload(0, V3.tex, V3.top, gl.RGB);
  if (V3.fNew) { v3Upload(7, V3.texF, V3.topF, gl.RGB); V3.fNew = false; }
  gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, V3.texF);
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
  gl.uniform4f(u.uBox, V3.boxN[0], V3.boxN[1], V3.boxN[2], V3.boxN[3]); gl.uniform4f(u.uBoxF, V3.boxF[0], V3.boxF[1], V3.boxF[2] || 1, V3.boxF[3] || 1);
  gl.uniform2f(u.uWorld, W, H); gl.uniform2f(u.uGrid, GW, GH); gl.uniform2f(u.uHG, Math.max(1, V3.nx - 1), Math.max(1, V3.ny - 1));
  gl.uniform2f(u.uFog, ...v3FogR(C));
  gl.uniform1f(u.uSea, 1.5);
  const mx = v3Mx() ? 1 : 0, tm = (now / 1000) % 3600;   // 黑绿画面：黑客帝国式数码风
  gl.uniform1f(u.uT, tm); gl.uniform1f(u.uMx, mx);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3.buf); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V3.ib);
  gl.enableVertexAttribArray(V3.a.p); gl.vertexAttribPointer(V3.a.p, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(V3.a.n); gl.vertexAttribPointer(V3.a.n, 3, gl.FLOAT, false, 24, 12);
  gl.drawElements(gl.TRIANGLES, V3.n, V3.it || gl.UNSIGNED_SHORT, 0);
  if (V3.bn && V3.pb && V3.bch) {   // 城镇房屋、机场建筑、树木（分块的静态缓冲区）
    const ub = V3.ub, ab = V3.ab;
    gl.useProgram(V3.pb);
    gl.uniformMatrix4fv(ub.uM, false, C.M); gl.uniform3f(ub.uEye, C.E[0], C.E[1], C.E[2]);
    gl.uniform4f(ub.uBox, V3.boxN[0], V3.boxN[1], V3.boxN[2], V3.boxN[3]); gl.uniform4f(ub.uBoxF, V3.boxF[0], V3.boxF[1], V3.boxF[2] || 1, V3.boxF[3] || 1); gl.uniform2f(ub.uWorld, W, H); gl.uniform2f(ub.uFog, ...v3FogR(C));
    gl.uniform1f(ub.uT, tm); gl.uniform1f(ub.uMx, mx);
    gl.disableVertexAttribArray(V3.a.p); gl.disableVertexAttribArray(V3.a.n);
    gl.enableVertexAttribArray(ab.p); gl.enableVertexAttribArray(ab.n); gl.enableVertexAttribArray(ab.e);
    const fe = v3FogE(C), ex = C.E[0], ey = -C.E[1];
    for (const c of V3.bch) {
      if (c.bb && Math.hypot(Math.max(c.bb[0] - ex, 0, ex - c.bb[2]), Math.max(c.bb[1] - ey, 0, ey - c.bb[3])) > fe) continue;   // 整块在雾外
      gl.bindBuffer(gl.ARRAY_BUFFER, c.b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.i);
      gl.vertexAttribPointer(ab.p, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(ab.n, 3, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(ab.e, 2, gl.FLOAT, false, 32, 24);
      gl.drawElements(gl.TRIANGLES, c.n, gl.UNSIGNED_SHORT, 0);
    }
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
  const [f0, f1] = v3FogR(V3.cam), f = smooth(f0, f1, Math.hypot(X - E[0], Y - E[1], z - E[2]));
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
    if (G.dead) continue;
    const c = bgAt(G);   // 部队实际所在处（不是队形锚点）
    if (G.side === 'e' && !spec && !spotted(c.x, c.y)) continue;
    if ((G.th || G.thx) && typeof thMarks3 === 'function' && typeof thOn === 'function' && thOn()) continue;   // 战区编队的营、连由番号牌标（thpanel.js thMarks3）
    const col = G.side === 'p' ? COL.g : COL.enemy, q = stem(c.x, c.y, 70, col, 1);
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
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && (spec || a.pv) && isFinite(a.x) && a.ph !== 'roll' && a.ph !== 'gnd') air(a, COL.enemy);
  if (typeof hqMarks3 === 'function') hqMarks3(ctx, stem);   // 团标：立在团的上空（hq.js）
  if (typeof thMarks3 === 'function') thMarks3(ctx, stem);   // 营标：战区编队的番号牌立在每个营（连）头顶（thpanel.js）
  if (typeof shOverlay3D === 'function') shOverlay3D(ctx, (x, y, h) => v3Proj(x, y, v3Ht(x, y) + h));   // 士兵喊话气泡（shout.js）
  if (typeof v3oOverlay === 'function') v3oOverlay(ctx);   // 观察者模式的准星
  ctx.restore();
}

// —— 开关与操作 ——
const v3Can = () => !!S && !(typeof INTRO === 'object' && INTRO.on);   // 部署、沙盒编辑、开战后都能开 3D
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
  const was = V3.on;
  V3.on = on && V3.ok;
  if (V3.on && !was) v3FcInit();   // 进 3D：自由镜头从平面地图当前的画面接着看
  const b = typeof $ === 'function' && $('btn3d'), c = typeof $ === 'function' && $('v3ctl');
  if (b) { b.classList.toggle('on', V3.on); b.setAttribute('aria-pressed', V3.on ? 'true' : 'false'); }
  if (c) c.hidden = !V3.on;
  if (!V3.on && typeof trxResize === 'function' && TRX.ok) trxResize();
  if (typeof log === 'function' && S && S.t != null) log(V3.on ? '3D 自由镜头：中键 / 右键拖动原地转头，Q E 转向、R F 抬头低头，W S 沿视线飞、A D 平移，滚轮朝鼠标处推拉，左键拖动平移，O 观察者模式' : '平面地图', 'info', 'v3', 1);
}
const v3Turn = k => { if (V3.on) v3Look(k * Math.PI / 8, 0); else V3.yawT += k * Math.PI / 8; };
const v3Tilt = k => { if (V3.on) v3Look(0, -k * .12); else V3.tiltT = clamp(V3.tiltT + k * .12, V3_TILT[0], V3_TILT[1]); };

// 平移：拖动的屏幕方向换算到地面（地面跟着手走），镜头高度、朝向不变
function v3Pan(dx, dy) {
  const F = V3.fc || (v3FcInit(), V3.fc), k = Math.max(30, F.d || 600) * 2 * Math.tan(V3_FOV / 2) / Math.max(1, CAM.vh), c = Math.cos(F.yaw), s = Math.sin(F.yaw), down = Math.max(.35, -Math.sin(F.pitch));
  F.x -= (-s * dx) * k - (c * dy) * k / down; F.y -= (c * dx) * k - (s * dy) * k / down;
}

// 输入：中键（或 Ctrl + 左键）拖动 → 横向转向、纵向俯仰；双指旋转 → 转向
// 右键拖动（编队指挥模式里右键不再下命令）：同样转视角；只点一下不拖，照旧是取消（穿插选目标 / 选择）
HOOK.pointer.push((e, kind) => {
  if (!V3.on || (typeof V3O === 'object' && V3O.on)) return false;
  const { sx, sy } = evPos(e), rDrag = e.button === 2 && typeof thuActive === 'function' && thuActive();
  if (kind === 'down' && (e.button === 1 || (e.button === 0 && e.ctrlKey) || rDrag)) { V3.orb = { sx, sy, x0: sx, y0: sy, id: e.pointerId, r: rDrag, moved: false }; return true; }
  if (V3.orb && V3.orb.id === e.pointerId) {
    if (kind === 'move') {
      if (!V3.orb.moved && Math.hypot(sx - V3.orb.x0, sy - V3.orb.y0) < 4) return true;
      V3.orb.moved = true;
      v3Look((sx - V3.orb.sx) * .005, -(sy - V3.orb.sy) * .005, true); V3.orb.sx = sx; V3.orb.sy = sy; return true;   // 原地转头：往右拖看右边、往上拖抬头
    }
    if (kind === 'up') { const o = V3.orb; V3.orb = null; if (o.r && !o.moved && typeof thuCancel === 'function') thuCancel(); return true; }
  }
  return false;
});
if (typeof window === 'object' && window.addEventListener) {
  const hk = { KeyQ: 1, KeyE: 1, KeyR: 1, KeyF: 1 };
  window.addEventListener('keyup', e => { if (V3.hold) V3.hold.delete(e.code); });
  window.addEventListener('blur', () => { if (V3.hold) V3.hold.clear(); });
  HOOK.key.push(e => {   // 3D 且编队指挥模式（这几个键不再有别的用途）：按住连续转向 / 俯仰
    if (!V3.on || !hk[e.code] || (typeof V3O === 'object' && V3O.on) || !(typeof thuActive === 'function' && thuActive()) || e.ctrlKey || e.metaKey || e.altKey) return false;
    (V3.hold || (V3.hold = new Set())).add(e.code);
    return true;
  });
}
HOOK.key.push(e => {
  const k = e.key;
  if ((k === 'l' || k === 'L') && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { v3Toggle(); return true; }   // 单按 L 是通讯面板（chat.js）
  if (!V3.on) return false;
  if (k === ',' || k === '<') { v3Turn(-1); return true; }
  if (k === '.' || k === '>') { v3Turn(1); return true; }
  if (k === ';') { v3Tilt(-1); return true; }
  if (k === "'") { v3Tilt(1); return true; }
  if ((k === '[' || k === ']') && typeof setSetting === 'function') {   // 渲染距离：每下 ±0.25 倍（0.5–4）
    const v = setSetting('rdist', Math.round((v3RD() + (k === ']' ? .25 : -.25)) * 4) / 4);
    if (typeof log === 'function') log(`3D 渲染距离 ${v.toFixed(2).replace(/0$/, '')}×${v >= 2.5 ? '（远景很多，慢的设备会掉帧）' : ''}`, 'info');
    return true;
  }
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
