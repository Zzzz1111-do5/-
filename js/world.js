'use strict';
// 世界常量、工具函数、地形生成
const W = 1200, H = 800, CELL = 10, GW = W / CELL, GH = H / CELL;
const STAGING_Y = 680;            // 我方集结海域上沿（桌子我这一端）
const COL = {
  bg: '#020704', g: '#3dff8a', gMid: '#1fa457', gDim: '#0f4a29', enemy: '#ff3d6e',
  intel: '#5cc8ff', sel: '#b07cff', amber: '#ffc24a', text: '#c6f7d8'
};
const T = { SEA: 0, BEACH: 1, LAND: 2, FOREST: 3, HILL: 4, TOWN: 5 };
const T_NAME = ['海域', '滩头', '平地', '林地', '高地', '城镇'];
const COVER = [1, 1, .85, .5, .65, .55];   // 目标所处地形的受击系数
const SPEED = [1, .75, 1, .6, .7, .8];     // 地形移动系数

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
// 方位角：正上方为北 000°
const bearing = (ax, ay, bx, by) => (Math.atan2(bx - ax, ay - by) * 180 / Math.PI + 360) % 360;
const fmtBrg = b => String(Math.round(b) % 360).padStart(3, '0') + '°';
// 沙盘网格坐标：列 A–L，行 1–8
const gridRef = (x, y) => 'ABCDEFGHIJKL'[clamp(Math.floor(x / 100), 0, 11)] + (clamp(Math.floor(y / 100), 0, 7) + 1);

function segDist(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - x0) * dx + (py - y0) * dy) / l2, 0, 1);
  return dist(px, py, x0 + dx * t, y0 + dy * t);
}

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function valueNoise(r, nx, ny) {
  const g = [];
  for (let i = 0; i < (nx + 1) * (ny + 1); i++) g.push(r());
  return (u, v) => {
    const fx = clamp(u, 0, 1) * nx, fy = clamp(v, 0, 1) * ny;
    const ix = Math.min(nx - 1, fx | 0), iy = Math.min(ny - 1, fy | 0);
    const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const k = iy * (nx + 1) + ix;
    return lerp(lerp(g[k], g[k + 1], sx), lerp(g[k + nx + 1], g[k + nx + 2], sx), sy);
  };
}

let TER = null;

function buildTerrain(seed) {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6], amp = [34 + r() * 14, 18 + r() * 10, 8 + r() * 5];
  const coast = new Float32Array(W + 1);
  for (let x = 0; x <= W; x++)
    coast[x] = 395 + amp[0] * Math.sin(x / 150 + ph[0]) + amp[1] * Math.sin(x / 61 + ph[1]) + amp[2] * Math.sin(x / 23 + ph[2]);
  const cAt = x => coast[clamp(Math.round(x), 0, W)];

  const ax = 170 + r() * 90, bx = 540 + r() * 110, cx = 900 + r() * 110;
  const obj = [
    { key: 'A', name: '灯塔', x: ax, y: cAt(ax) - 70 },
    { key: 'B', name: '炮台高地', x: bx, y: cAt(bx) - 200 },
    { key: 'C', name: '指挥所', x: cx, y: 100 + r() * 40 }
  ];
  const hills = [{ x: obj[1].x, y: obj[1].y, r: 85, h: 1 }];
  for (let i = 0; i < 5; i++) hills.push({ x: 60 + r() * 1080, y: 40 + r() * 230, r: 45 + r() * 65, h: .45 + r() * .5 });
  const noise = valueNoise(r, 14, 9);

  const type = new Uint8Array(GW * GH), elev = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2, i = gy * GW + gx;
    const c = cAt(x);
    let e = 0;
    for (const h of hills) e += h.h * Math.exp(-((x - h.x) ** 2 + (y - h.y) ** 2) / (2 * h.r * h.r));
    e = Math.min(1, e + noise(x / W, y / H) * .25);
    elev[i] = y < c ? e : 0;
    let t;
    if (y >= c) t = T.SEA;
    else if (c - y < 16) t = T.BEACH;
    else if (dist(x, y, obj[2].x, obj[2].y) < 62 && r() < .78) t = T.TOWN;
    else if (e > .58) t = T.HILL;
    else if (noise(x / W + .37, y / H + .21) > .6) t = T.FOREST;
    else t = T.LAND;
    type[i] = t;
  }
  TER = { seed, coast, type, elev, obj, cAt };
}

const coastAt = x => TER.cAt(x);
const isLand = (x, y) => y < coastAt(x);
function terrainAt(x, y) {
  const gx = clamp(Math.floor(x / CELL), 0, GW - 1), gy = clamp(Math.floor(y / CELL), 0, GH - 1);
  return TER.type[gy * GW + gx];
}
