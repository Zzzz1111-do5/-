'use strict';
// 常量、工具函数、地形类型表
// 地图尺度：边长是最初 3000 × 2000 版的 MAP_K 倍（面积约 2 倍）。地形大特征、纵深、海面位置按它换算；武器射程等真实距离不变
const MAP_K = 1.4;
const AF_K = 2;   // 空军基地尺度：机场局部坐标（eaW / eaL）放大的倍数——跑道 600、场区约 1100 × 800（面积为最初的 4 倍）
const W = 4200, H = 2800, CELL = 10, GW = W / CELL, GH = H / CELL;
const SEA = y => H - (2000 - y) * MAP_K;   // 旧版（高 2000）海面上的 y 换算到现在的地图：集结海域、船位、航母
const STAGING_Y = SEA(1500);      // 我方舰队集结海域上沿（航母在更南边）
const CARRIER_Y = SEA(1880);
const ELEV_H = 6;                 // 高程 1.0 对应的视线高度（格）
const COL = {
  bg: '#020704', g: '#3dff8a', gMid: '#1fa457', gDim: '#0f4a29', enemy: '#ff3d6e',
  intel: '#5cc8ff', sel: '#b07cff', amber: '#ffc24a', text: '#c6f7d8', smoke: '#9fb8a8'
};
// 画面风格：real 写实（默认，我方蓝、敌方红，颜色贴近真实地图）· matrix 数码矩阵（原配色）。切换时改写 COL 并给 <html> 标 data-look 供 CSS 换色
const COL_LOOK = {
  matrix: { ...COL },
  real: { bg: '#0b1014', g: '#52a8ff', gMid: '#2f7fd0', gDim: '#1d4a7a', enemy: '#ff4848', intel: '#8fdcff', sel: '#c78cff', amber: '#ffbb38', text: '#e6edf2', smoke: '#b4afa6' }
};
function applyLook(look) {
  const k = look === 'matrix' ? 'matrix' : 'real';
  Object.assign(COL, COL_LOOK[k]);
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.dataset.look = k;
}
const T = { DEEP: 0, SHOAL: 1, REEF: 2, BEACH: 3, ROCKS: 4, CLIFF: 5, FIELD: 6, FOREST: 7, HILL: 8, MOUNT: 9, MARSH: 10, RIVER: 11, BRIDGE: 12, ROAD: 13, TOWN: 14, FORD: 15 };
// n 名称 · sp 步兵速度系数（0 = 不可通行）· cv 受击系数 · bl 遮挡视线的附加高度（格）
const TP = [
  { n: '深海', sp: 0, cv: 1, bl: 0 }, { n: '浅滩', sp: 0, cv: 1, bl: 0 }, { n: '暗礁', sp: 0, cv: 1, bl: 0 },
  { n: '沙滩', sp: .8, cv: 1, bl: 0 }, { n: '礁岸', sp: .35, cv: .8, bl: 0 }, { n: '悬崖', sp: 0, cv: .5, bl: 1.5 },
  { n: '平地', sp: 1, cv: .9, bl: 0 }, { n: '林地', sp: .6, cv: .5, bl: .9 }, { n: '丘陵', sp: .7, cv: .65, bl: 0 },
  { n: '山地', sp: .3, cv: .5, bl: 0 }, { n: '沼泽', sp: .35, cv: .95, bl: 0 }, { n: '河流', sp: 0, cv: 1, bl: 0 },
  { n: '桥梁', sp: 1, cv: .9, bl: 0 }, { n: '道路', sp: 1.35, cv: 1, bl: 0 }, { n: '城镇', sp: .8, cv: .45, bl: .9 },
  { n: '渡口', sp: .4, cv: 1, bl: 0 }
];
const isWater = t => t <= T.REEF;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const bearing = (ax, ay, bx, by) => (Math.atan2(bx - ax, ay - by) * 180 / Math.PI + 360) % 360;
const fmtBrg = b => String(Math.round(b) % 360).padStart(3, '0') + '°';
const GRID_COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gridRef = (x, y) => GRID_COLS[clamp(Math.floor(x / 200), 0, 14)] + (clamp(Math.floor(y / 200), 0, 9) + 1);

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
    const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), k = iy * (nx + 1) + ix;
    return lerp(lerp(g[k], g[k + 1], sx), lerp(g[k + nx + 1], g[k + nx + 2], sx), sy);
  };
}

// —— 网格访问 ——
const ci = (x, y) => clamp(Math.floor(y / CELL), 0, GH - 1) * GW + clamp(Math.floor(x / CELL), 0, GW - 1);
const cellCX = i => (i % GW) * CELL + CELL / 2;
const cellCY = i => Math.floor(i / GW) * CELL + CELL / 2;
const typeAt = (x, y) => TER.type[ci(x, y)];
const elevAt = (x, y) => TER.elev[ci(x, y)];
const isLand = (x, y) => !isWater(typeAt(x, y));
const passInf = (x, y) => TP[typeAt(x, y)].sp > 0;
const coverAt = (x, y) => TP[typeAt(x, y)].cv;

// 行为计数（S.v7s，测试与调试用）：各模块的 xxStat 都写这里
const v8Stat = (k, n = 1) => { if (!S) return; const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
// 模块挂钩：新模块向这里登记函数，主循环/渲染/输入按名调用，免得多个模块同改一处
// newGame(opts) · step(dt) · impact(x,y,R,pw,side) · visionP()/visionE() 返回视野源数组
// drawUnder/drawOver/drawTop(time) 世界坐标 · frame(now,dt) 每帧 · pointer(e,kind,p)/key(e) 返回 true 表示已处理
const HOOK = { newGame: [], step: [], impact: [], visionP: [], visionE: [], drawUnder: [], drawOver: [], drawTop: [], frame: [], pointer: [], key: [] };
const HOOK_ERR = new Set();
function runHook(name, ...a) {
  let hit = false;
  for (const f of HOOK[name]) {
    try { if (f(...a) === true) hit = true; } catch (e) {
      if (!HOOK_ERR.has(f)) { HOOK_ERR.add(f); console.error('hook ' + name, e); }
    }
  }
  return hit;
}
const hookSources = name => HOOK[name].flatMap(f => { try { return f() || []; } catch (e) { return []; } });
