'use strict';
// 沙盘桌（view3d.js v3Draw 画完地形后调用 v3Table）：整片战场是指挥部一张兵推沙盘桌上的模型——
//   地形模型四周一圈深色金属边框（框顶略高于海面，里沿一道绿色发光边线，像桌面显示屏的边），
//   框外是大片深色桌面：200 一格的淡方格（与战报里 Q19 之类的方格对齐）、头顶一盏灯照出的光斑和光泽，越往外越暗，融进昏暗的房间。
//   拉远到能看见整张桌子时，战场就是桌上的一个模型；边框上沿标方格坐标（v3TableMarks，主画布上画字，字不跟着透视变形）
const V3T = { ok: false, tried: false, pr: null, u: {}, a: {}, buf: null, n: 0, der: false };
const V3T_FR = 240, V3T_FZ = 16, V3T_M = 2600, V3T_LINE = 8;   // 边框宽、框顶高度、桌面伸出边框的宽度、里沿发光线宽

const V3T_VS = `attribute vec3 p; attribute vec3 n; attribute float m;
uniform mat4 uM; uniform vec3 uEye;
varying vec3 vP, vN; varying float vM, vD;
void main() { vP = p; vN = n; vM = m; vD = distance(p, uEye); gl_Position = uM * vec4(p, 1.); }`;
// 材质 m：0 桌面、1 框顶、2 框壁、3 里沿发光线
const V3T_FS = der => `${der ? '#extension GL_OES_standard_derivatives : enable\n#define DER 1\n' : ''}#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uEye, uLine; uniform vec2 uFog, uWorld;
varying vec3 vP, vN; varying float vM, vD;
void main() {
  vec3 bg = vec3(.004, .02, .011), N = normalize(vN), V = normalize(uEye - vP);
  vec2 C = vec2(uWorld.x * .5, -uWorld.y * .5);
  vec3 L = normalize(vec3(C, 9000.) - vP), Hh = normalize(L + V);   // 桌子正上方的一盏灯
  float dif = max(dot(N, L), 0.), spec = pow(max(dot(N, Hh), 0.), 48.);
  float r = length((vP.xy - C) / (uWorld * .5)), lamp = 1. - smoothstep(.75, 2.2, r);
  vec2 dq = abs(vP.xy - C) - uWorld * .5 - ${V3T_FR}.;
  float ofs = max(dq.x, dq.y);   // 离边框外沿多远（框外为正）
  vec3 c;
  if (vM < .5) {
    vec2 q = vP.xy / 200.;
#ifdef DER
    vec2 w = max(fwidth(q), 1e-4), g = abs(fract(q + .5) - .5) / w;
    float grid = (1. - min(min(g.x, g.y), 1.)) * (1. - smoothstep(.15, .45, max(w.x, w.y)));   // 远处一格不到几个像素就不画线，免得糊成一片
#else
    float grid = 0.;
#endif
    c = vec3(.018, .028, .024) * (.25 + 1.25 * lamp) + vec3(.07, .24, .14) * grid * .3 * lamp + vec3(.3, .38, .35) * spec * .35 * lamp;
    c *= .45 + .55 * smoothstep(0., 260., ofs);   // 边框脚下的接触阴影
  } else if (vM < 1.5) {   // 框顶：拉丝深灰金属（细斜纹）
    float br = .92 + .08 * sin((vP.x + vP.y) * 1.7);
    c = vec3(.085, .095, .09) * (.35 + .85 * dif) * br * (.6 + .4 * lamp) + vec3(.6, .66, .63) * spec * .55;
  }
  else if (vM < 2.5) c = vec3(.045, .052, .05) * (.4 + .7 * dif) * (.55 + .45 * lamp) + vec3(.4, .45, .43) * spec * .2;
  else c = uLine;
  gl_FragColor = vec4(mix(c, bg, smoothstep(uFog.x, uFog.y, vD)), 1.);
}`;

function v3tInit(gl) {
  V3T.tried = true;
  try {
    V3T.der = !!gl.getExtension('OES_standard_derivatives');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3T_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3T_FS(V3T.der))); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3T.pr = pr;
    for (const k of ['uM', 'uEye', 'uLine', 'uFog', 'uWorld']) V3T.u[k] = gl.getUniformLocation(pr, k);
    for (const k of ['p', 'n', 'm']) V3T.a[k] = gl.getAttribLocation(pr, k);
    v3tMesh(gl);
    V3T.ok = true;
  } catch (e) { V3T.ok = false; console.warn('沙盘桌不可用', e); }
}

// 网格（GL 坐标：x 东、y = −世界 y、z 高）：桌面一块、框顶四条、框外壁四面、框内壁四面（框顶到海面，低处的地形模型边上看得见）、里沿发光线四条
function v3tMesh(gl) {
  const v = [], F = V3T_FR, Z = V3T_FZ, B = V3_SKIRT, M = V3T_M, e = 1.5;
  const quad = (a, b, c, d, n, m) => { for (const p of [a, b, c, a, c, d]) v.push(p[0], -p[1], p[2], n[0], -n[1], n[2], m); };   // 角点按世界坐标给（y 向南），存的时候翻成 GL 坐标
  quad([-F - M, -F - M, B], [W + F + M, -F - M, B], [W + F + M, H + F + M, B], [-F - M, H + F + M, B], [0, 0, 1], 0);
  const x0 = -F, x1 = W + F, y0 = -F, y1 = H + F, i0 = -e, i1 = W + e, j0 = -e, j1 = H + e;
  for (const [a, b, c, d] of [[[x0, y0], [x1, y0], [x1, j0], [x0, j0]], [[x0, j1], [x1, j1], [x1, y1], [x0, y1]], [[x0, j0], [i0, j0], [i0, j1], [x0, j1]], [[i1, j0], [x1, j0], [x1, j1], [i1, j1]]])
    quad([...a, Z], [...b, Z], [...c, Z], [...d, Z], [0, 0, 1], 1);
  const wall = (ax, ay, bx, by, n, z0, z1, m) => quad([ax, ay, z1], [bx, by, z1], [bx, by, z0], [ax, ay, z0], n, m);
  wall(x0, y0, x1, y0, [0, -1, 0], B, Z, 2); wall(x1, y1, x0, y1, [0, 1, 0], B, Z, 2); wall(x0, y1, x0, y0, [-1, 0, 0], B, Z, 2); wall(x1, y0, x1, y1, [1, 0, 0], B, Z, 2);
  wall(i0, j0, i1, j0, [0, 1, 0], 0, Z, 2); wall(i1, j1, i0, j1, [0, -1, 0], 0, Z, 2); wall(i0, j1, i0, j0, [1, 0, 0], 0, Z, 2); wall(i1, j0, i1, j1, [-1, 0, 0], 0, Z, 2);
  const L = V3T_LINE, z = Z + .4;
  for (const [a, b, c, d] of [[[i0 - L, j0 - L], [i1 + L, j0 - L], [i1 + L, j0], [i0 - L, j0]], [[i0 - L, j1], [i1 + L, j1], [i1 + L, j1 + L], [i0 - L, j1 + L]], [[i0 - L, j0], [i0, j0], [i0, j1], [i0 - L, j1]], [[i1, j0], [i1 + L, j0], [i1 + L, j1], [i1, j1]]])
    quad([...a, z], [...b, z], [...c, z], [...d, z], [0, 0, 1], 3);
  V3T.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, V3T.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  V3T.n = v.length / 7;
}

function v3Table(C) {
  const gl = V3.gl;
  if (!V3T.tried) v3tInit(gl);
  if (!V3T.ok) return;
  const u = V3T.u, a = V3T.a, g = [1, 3, 5].map(i => parseInt(COL.g.slice(i, i + 2), 16) / 255);
  gl.useProgram(V3T.pr);
  gl.uniformMatrix4fv(u.uM, false, C.M); gl.uniform3f(u.uEye, C.E[0], C.E[1], C.E[2]);
  gl.uniform3f(u.uLine, g[0] * .75, g[1] * .75, g[2] * .75); gl.uniform2f(u.uWorld, W, H);
  const [f0, f1] = v3FogR(C), k = Math.max(1, C.E[2] / 2500);   // 拉得很高时桌面也看得见：雾跟着镜头高度放远
  gl.uniform2f(u.uFog, f0 * k, f1 * k);
  gl.bindBuffer(gl.ARRAY_BUFFER, V3T.buf);
  gl.enableVertexAttribArray(a.p); gl.vertexAttribPointer(a.p, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(a.n); gl.vertexAttribPointer(a.n, 3, gl.FLOAT, false, 28, 12);
  gl.enableVertexAttribArray(a.m); gl.vertexAttribPointer(a.m, 1, gl.FLOAT, false, 28, 24);
  gl.drawArrays(gl.TRIANGLES, 0, V3T.n);
  gl.disableVertexAttribArray(a.p); gl.disableVertexAttribArray(a.n); gl.disableVertexAttribArray(a.m);
}

// 边框上沿的方格坐标：北、南两边标列（A、B……AA），西、东两边标行（1、2……）；按屏幕上的间距隔几格标一个，离得远就只标少数几个
function v3TableMarks(ctx) {
  if (!V3T.ok || typeof v3Proj !== 'function') return;
  const F = V3T_FR / 2, z = V3T_FZ + 1, nc = Math.ceil(W / 200), nr = Math.ceil(H / 200);
  ctx.save();
  ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const edge = (n, at, name) => {
    const m = Math.floor(n / 2), p0 = v3Proj(...at(m), z), p1 = v3Proj(...at(m + 1), z);
    const step = p0 && p1 ? Math.max(1, Math.ceil(30 / Math.max(.1, Math.hypot(p1.x - p0.x, p1.y - p0.y)))) : 4;
    for (let i = 0; i < n; i += step) {
      const q = v3Proj(...at(i), z);
      if (!q || q.f > .85 || q.x < -20 || q.y < -20 || q.x > CAM.vw + 20 || q.y > CAM.vh + 20) continue;
      ctx.fillStyle = rgba(COL.g, .62 * (1 - q.f)); ctx.fillText(name(i), q.x, q.y);
    }
  };
  edge(nc, i => [(i + .5) * 200, -F], gridCol); edge(nc, i => [(i + .5) * 200, H + F], gridCol);
  edge(nr, j => [-F, (j + .5) * 200], j => String(j + 1)); edge(nr, j => [W + F, (j + .5) * 200], j => String(j + 1));
  ctx.restore();
}
