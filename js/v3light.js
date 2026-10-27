'use strict';
// 3D 光影（沙盘桌上方一盏灯从西北斜照下来，光向 V3_SUN 与地面、房屋、模型着色器一致）：
// 一、光照贴图（view3d.js 建好地形网格后烘焙一次，地形变了随网格重建重算）：每 10 米一格的高度场上算
//   R 投影：朝灯的方向步进，山、房屋、树林挡住的地方变暗，离挡光处越远半影越宽（软阴影）；
//   G 环境光遮蔽：八个方向看地平线抬起多高，山谷、沟底、街巷、林下发暗；B 近岸浅水（海面颜色、拍岸的浪用）。
//   城镇格按 9 米高、树林格按 11 米高参与遮挡（房屋、树冠的立体模型本身在那里）。大地图约 0.2 秒，地面、房屋、立体模型都乘上它。
// 二、模型的地面软阴影（v3units.js 收集完实例后调用 v3ShadowDraw）：每个车辆、士兵、舰船、阵地、飞机在地上投一块柔和的影子，
//   往东南偏（灯在西北）；飞机的影子按离地高度投到远处的地面上，越高越淡越虚——看得出高低，像桌上悬着的模型
const V3L = { seed: null, sig: null, tex: null, unit: 8, ok: false, sh: null };
const V3L_TO = (() => { const x = V3_SUN[0], y = -V3_SUN[1], z = V3_SUN[2], h = Math.hypot(x, y); return { x: x / h, y: y / h, t: z / h }; })();   // 世界坐标（y 向南）里朝灯的水平方向；每走 1 米光线升高 t 米
const V3L_DIRS = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
const V3L_RAD = [1, 2, 3.5, 5.5, 8, 12];   // 遮蔽的采样半径（格）

function v3LightBake() {
  const n = GW * GH, Hc = new Float32Array(n);
  let hMax = 0;
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx, t = TER.type[i];
    const h = v3Ht(gx * CELL + 5, gy * CELL + 5) + (t === T.TOWN ? 9 : t === T.FOREST ? 11 : 0);
    Hc[i] = h; if (h > hMax) hMax = h;
  }
  const at = (x, y) => { const gx = x | 0, gy = y | 0; return x < 0 || y < 0 || gx >= GW || gy >= GH ? -3 : Hc[gy * GW + gx]; };
  const out = new Uint8Array(n * 4), sx = V3L_TO.x, sy = V3L_TO.y, rise = V3L_TO.t * CELL;
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx, h0 = Hc[i] + .6, cx = gx + .5, cy = gy + .5;
    // 投影：按每格的光线高度与挡光物比，越接近擦边越灰（半影宽度随距离增大）
    let lit = 1;
    for (let k = 1; k < 70; k++) {
      const ray = h0 + rise * k;
      if (ray > hMax) break;
      const d = ray - at(cx + sx * k, cy + sy * k);
      if (d <= 0) { lit = 0; break; }
      const p = d / (k * CELL) * 5;
      if (p < lit) lit = p;
    }
    // 遮蔽：各方向地平线仰角的平均
    let occ = 0;
    for (const [dx, dy] of V3L_DIRS) {
      let m = 0;
      for (const r of V3L_RAD) { const s = (at(cx + dx * r, cy + dy * r) - h0) / (r * CELL); if (s > m) m = s; }
      occ += m / (1 + m);
    }
    const ao = clamp(1 - occ / 8 * 2.4, 0, 1);
    const sea = isWater(TER.type[i]) && TER.type[i] !== T.RIVER && TER.type[i] !== T.FORD ? clamp(1 - (cy * CELL - coastAt(cx * CELL)) / 300, 0, 1) : 0;   // B：近岸浅水（海岸线 1 → 离岸 300 米 0）
    out[i * 4] = Math.round(lit * lit * (3 - 2 * lit) * 255); out[i * 4 + 1] = Math.round(ao * 255); out[i * 4 + 2] = Math.round(sea * 255); out[i * 4 + 3] = 255;
  }
  V3L.data = out; V3L.seed = TER.seed; V3L.up = false;
}
// 上传光照贴图（第 9 个贴图单元；显卡不够 9 个单元就不用光照贴图，画面照旧）
function v3LightBind(gl) {
  if (!V3L.data) return false;
  if (V3L.ok === false && V3L.tried) return false;
  if (!V3L.tried) { V3L.tried = true; V3L.ok = (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) || 8) > V3L.unit; if (V3L.ok) V3L.tex = gl.createTexture(); }
  if (!V3L.ok) return false;
  gl.activeTexture(gl.TEXTURE0 + V3L.unit); gl.bindTexture(gl.TEXTURE_2D, V3L.tex);
  if (!V3L.up) {
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, V3L.data);
    V3L.up = true;
  }
  return true;
}

// —— 模型的地面软阴影 ——
const V3L_SVS = `attribute vec3 p; attribute vec3 q;
uniform mat4 uM;
varying vec3 vQ;
void main() { vQ = q; gl_Position = uM * vec4(p, 1.); }`;
// q：x、y 在椭圆里的位置（-1…1），z 不透明度；边缘柔和，中心最浓
const V3L_SFS = `precision mediump float;
varying vec3 vQ;
void main() { float r = length(vQ.xy); gl_FragColor = vec4(0., 0., 0., vQ.z * (1. - smoothstep(.25, 1., r))); }`;
function v3shInit(gl) {
  V3L.sTried = true;
  try {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, V3L_SVS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, V3L_SFS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    V3L.sh = { pr, uM: gl.getUniformLocation(pr, 'uM'), p: gl.getAttribLocation(pr, 'p'), q: gl.getAttribLocation(pr, 'q'), buf: gl.createBuffer(), v: [] };
  } catch (e) { V3L.sh = null; console.warn('3D 阴影不可用', e); }
}
// 不投影的部件：枪口焰、炮塔（车体的影子已经盖住）、雷达、旋翼桨叶、在飞的导弹、垂发舱盖
const V3L_SKIP = /^(mflash|vt:|rad:|rot:|rotor|prop:|msl:|vlslid|radmast)/;
// 一个实例的影子：bb 模型包围盒（模型坐标），k 缩放，a 朝向（世界），z 模型底座高度
function v3ShadowAdd(x, y, z, a, k, bb, sea) {
  if (!V3L.sh || !bb) return;
  const g = sea ? -2.6 : v3Gnd(x, y), up = Math.max(0, z - g), hgt = (bb[5] - Math.max(0, bb[4])) * k;   // 地面含航母飞行甲板（甲板上的飞机、车辆影子落在甲板上）
  const off = (up + hgt * .45) / V3L_TO.t, ox = x - V3L_TO.x * off, oy = y - V3L_TO.y * off;   // 往背光的东南方向偏
  const gz = (up > 3 ? v3Gnd(ox, oy) : g) + .35;
  const air = smooth(2, 900, up), al = (sea ? .32 : .5) * (1 - .78 * air), blur = 1 + 2.2 * air;
  const hx = Math.max(.6, (bb[1] - bb[0]) * k * .55) * blur + hgt * .2, hy = Math.max(.5, (bb[3] - bb[2]) * k * .55) * blur;
  // 模型 x 轴朝航向 (cos a, sin a)，y 轴在世界坐标里是 (sin a, −cos a)（GL 坐标 y 取反）
  const cx = (bb[0] + bb[1]) * .5 * k, cy = (bb[2] + bb[3]) * .5 * k, c = Math.cos(a), s = Math.sin(a), px = ox + cx * c + cy * s, py = oy + cx * s - cy * c;
  const corner = (u, v) => [px + u * hx * c + v * hy * s, py + u * hx * s - v * hy * c];
  const V = V3L.sh.v, P = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], Q = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const j of [0, 1, 2, 0, 2, 3]) V.push(P[j][0], -P[j][1], gz, Q[j][0], Q[j][1], al);
}
function v3ShadowBegin(gl) { if (!V3L.sTried) v3shInit(gl); if (V3L.sh) V3L.sh.v.length = 0; return !!V3L.sh; }
function v3ShadowDraw(gl, C) {
  const S0 = V3L.sh;
  if (!S0 || !S0.v.length) return;
  gl.useProgram(S0.pr); gl.uniformMatrix4fv(S0.uM, false, C.M);
  gl.bindBuffer(gl.ARRAY_BUFFER, S0.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(S0.v), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(S0.p); gl.vertexAttribPointer(S0.p, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(S0.q); gl.vertexAttribPointer(S0.q, 3, gl.FLOAT, false, 24, 12);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4);   // 贴着地面画，不和地面打架
  gl.drawArrays(gl.TRIANGLES, 0, S0.v.length / 6);
  gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true); gl.disable(gl.BLEND);
  gl.disableVertexAttribArray(S0.p); gl.disableVertexAttribArray(S0.q);
}
