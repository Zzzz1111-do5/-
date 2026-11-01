'use strict';
// 太空背景与黑夜（view3d.js v3Draw 在兵种模型之后、弹道特效之前调用 v3Night，再画 v3Neb）：
//   ① 白色平原（TER.flat）浮在超新星遗迹星云的正中间：用户给的点云模型（js/mdl/nebula.js，tools/nebula_bake.py 从 Sketchfab 的
//      「Supernova remnant : lighting 2」降采样到 30 万个点，CC-BY-4.0，作者 Aiekick），以地图中心为球心放大到约 35–55 公里的球壳，
//      镜头移动有视差；一个点画成一团柔和的光斑（加法混合），按深度画在最远处：地面、模型挡得住它，远裁剪面也不会把它切掉。
//      天空不画（v3Draw 跳过 v3Sky），背景与雾是近黑的太空色（view3d.js v3Bg）。
//   ② 黑夜（S.night，沙盒「黑夜」按钮）：地形、建筑、模型画完后整幅乘一层夜色（月光偏蓝；太空平台偏暗红，星云的光），
//      之后再画星云、弹道、爆炸、枪口焰——这些发光的东西不被压暗，夜里格外显眼。平面画面在 render.js drawScene 里同样压暗
const V3N = { tried: false, ok: false, pr: null, a: {}, u: {}, pb: null, cb: null, n: 0, dec: false, np: null, nu: {}, qb: null };
const V3N_K = 25000;   // 点云每个单位多少米（坐标范围约 ±2.16 → 半径约 35–55 公里的球壳）
const V3N_PT = 340;    // 一个点画成多大的光斑（米）：30 万个点铺满整个球壳，这个大小正好连成一片
const V3N_NIGHT = { std: [.2, .24, .36], flat: [.3, .2, .24], mx: [.55, .6, .6] };   // 夜色：月光、太空（星云的暗红）、黑绿画面（本来就暗，压得轻）
const v3nebOn = () => !!(typeof TER === 'object' && TER && TER.flat);

function v3nInit(gl) {
  V3N.tried = true;
  try {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = (vs, fs, attrs, unis) => {
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      const a = {}, u = {};
      for (const k of attrs) a[k] = gl.getAttribLocation(pr, k);
      for (const k of unis) u[k] = gl.getUniformLocation(pr, k);
      return { pr, a, u };
    };
    // 星云：坐标是归一化的 16 位整数（glTF 的 y 朝上 → 游戏 GL 坐标 z 朝上），按 uK 放大、移到 uC；z 写成 w 的 0.99999 倍 = 最远处
    const P = prog(`attribute vec3 p; attribute vec3 c;
uniform mat4 uM; uniform vec3 uC; uniform float uK, uPx, uI;
varying vec3 vC;
void main() {
  vec4 q = uM * vec4(uC + vec3(p.x, -p.z, p.y) * uK, 1.);
  q.z = q.w * .99999;
  gl_Position = q;
  gl_PointSize = clamp(uPx / max(q.w, 1.), 1.5, 14.);
  vC = c * uI;
}`, `precision mediump float;
varying vec3 vC;
void main() { vec2 d = gl_PointCoord - .5; float a = exp(-dot(d, d) * 13.); gl_FragColor = vec4(vC * a, a); }`, ['p', 'c'], ['uM', 'uC', 'uK', 'uPx', 'uI']);
    // 夜色：整幅相乘
    const Q = prog('attribute vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }', 'precision mediump float; uniform vec3 uK; void main() { gl_FragColor = vec4(uK, 1.); }', ['p'], ['uK']);
    Object.assign(V3N, { pr: P.pr, a: P.a, u: P.u, np: Q.pr, na: Q.a, nu: Q.u, qb: gl.createBuffer(), ok: true });
    gl.bindBuffer(gl.ARRAY_BUFFER, V3N.qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  } catch (e) { V3N.ok = false; console.warn('星云 / 夜色不可用', e); }
}
// 点云数据：用到时才加载 js/mdl/nebula.js（v3g.js 的脚本加载队列），解码后建两个顶点缓冲（坐标、颜色）
function v3nData(gl) {
  if (V3N.pb) return true;
  if (V3N.dec || typeof V3G !== 'object') return false;
  const D = V3G.def.nebula;
  if (!D) { if (!V3G.want.has('nebula') && !V3G.fail.has('nebula') && typeof v3gLoad === 'function') { V3G.want.add('nebula'); v3gLoad('nebula', true); } return false; }
  V3N.dec = true;
  v3gBytes(D.b64).then(b => {
    const n = D.meta.n, pos = new Int16Array(b.buffer, b.byteOffset, n * 3), col = new Uint8Array(b.buffer, b.byteOffset + n * 6, n * 3);
    const pb = gl.createBuffer(), cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
    Object.assign(V3N, { pb, cb, n, s: D.meta.s || 1 });
    delete V3G.def.nebula;   // 原始数据不再留着
  }).catch(e => { console.warn('星云点云解码失败', e); V3G.fail.add('nebula'); });
  return false;
}
// ② 夜色：在发光的东西之前把已经画好的地形、建筑、模型整幅压暗
function v3Night(C) {
  if (!(typeof S === 'object' && S && S.night) || !V3.gl) return;
  const gl = V3.gl;
  if (!V3N.tried) v3nInit(gl);
  if (!V3N.ok) return;
  const k = typeof v3Mx === 'function' && v3Mx() ? V3N_NIGHT.mx : v3nebOn() ? V3N_NIGHT.flat : V3N_NIGHT.std;
  gl.useProgram(V3N.np);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3N.qb); gl.enableVertexAttribArray(V3N.na.p); gl.vertexAttribPointer(V3N.na.p, 2, gl.FLOAT, false, 0, 0);
  gl.uniform3f(V3N.nu.uK, k[0], k[1], k[2]);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  gl.disableVertexAttribArray(V3N.na.p);
}
// ① 星云
function v3Neb(C) {
  if (!v3nebOn() || !V3.gl) return;
  const gl = V3.gl;
  if (!V3N.tried) v3nInit(gl);
  if (!V3N.ok || !v3nData(gl)) return;
  const f = 1 / Math.tan(V3_FOV / 2), hpx = (V3.cv ? V3.cv.height : 720) / 2;
  gl.useProgram(V3N.pr);
  gl.uniformMatrix4fv(V3N.u.uM, false, C.M);
  gl.uniform3f(V3N.u.uC, W / 2, -H / 2, 0);
  gl.uniform1f(V3N.u.uK, V3N.s * V3N_K);
  gl.uniform1f(V3N.u.uPx, V3N_PT * f * hpx);
  gl.uniform1f(V3N.u.uI, S && S.night ? .75 : .55);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3N.pb); gl.enableVertexAttribArray(V3N.a.p); gl.vertexAttribPointer(V3N.a.p, 3, gl.SHORT, true, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3N.cb); gl.enableVertexAttribArray(V3N.a.c); gl.vertexAttribPointer(V3N.a.c, 3, gl.UNSIGNED_BYTE, true, 0, 0);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.drawArrays(gl.POINTS, 0, V3N.n);
  gl.disable(gl.BLEND); gl.depthMask(true); gl.depthFunc(gl.LESS);
  gl.disableVertexAttribArray(V3N.a.p); gl.disableVertexAttribArray(V3N.a.c);
}
// 换了 WebGL 上下文（3D 重建）：缓冲区跟着作废
function v3nReset() { Object.assign(V3N, { tried: false, ok: false, pb: null, cb: null, dec: false }); }
// 游戏里「素材致谢」（v3import.js 汇总 V3G_CRED）
if (typeof V3G_CRED === 'object' && Array.isArray(V3G_CRED) && !V3G_CRED.some(c => c.title === 'Supernova remnant : lighting 2'))
  V3G_CRED.push({ name: '超新星遗迹星云（白色平原的太空背景）', title: 'Supernova remnant : lighting 2', author: 'Aiekick', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/supernova-remnant-lighting-2-68cbcb486c7f41f2b842a36a543a54a1' });
