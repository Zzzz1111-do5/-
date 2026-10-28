'use strict';
// 常量、工具函数、地形类型表
// 地图尺度：边长是最初 3000 × 2000 版的 MAP_K 倍（2.8：8400 × 5600，面积约 8 倍；比上一版 4200 × 2800 大 4 倍）。
//   地形大特征、纵深、海面位置按它换算；武器射程、车速等真实距离不变——战场更开阔，海上纵深也更大
const MAP_K = 2.8;
const AF_K = 2;   // 空军基地场区尺度：场区世界范围 = AF_BOX（mapgen2.js）× AF_K，约 1100 × 800（面积为最初的 4 倍）；场内设施按真实比例布置（afbase.js），机场局部坐标 eaW / eaL 与世界同一尺度
const W = Math.round(3000 * MAP_K), H = Math.round(2000 * MAP_K), CELL = 10, GW = W / CELL, GH = H / CELL;
const SEA = y => H - (2000 - y) * MAP_K;   // 旧版（高 2000）海面上的 y 换算到现在的地图：集结海域、船位、航母
const STAGING_Y = SEA(1500);      // 我方舰队集结海域上沿（航母在更南边）
const CARRIER_Y = SEA(1880);
const ELEV_H = 6;                 // 高程 1.0 对应的视线高度（格）
const COL = {
  bg: '#020704', g: '#3dff8a', gMid: '#1fa457', gDim: '#0f4a29', enemy: '#ff3d6e',
  intel: '#5cc8ff', sel: '#b07cff', amber: '#ffc24a', text: '#c6f7d8', smoke: '#9fb8a8'
};
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
const dist = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); };   // 不用 Math.hypot：V8 里慢好几倍，推演里调用极多
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const bearing = (ax, ay, bx, by) => (Math.atan2(bx - ax, ay - by) * 180 / Math.PI + 360) % 360;
const fmtBrg = b => String(Math.round(b) % 360).padStart(3, '0') + '°';
const GRID_COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gridCol = k => k < 26 ? GRID_COLS[k] : GRID_COLS[Math.floor(k / 26) - 1] + GRID_COLS[k % 26];   // 超过 26 列（大地图 42 列）接着用 AA、AB……
const gridRef = (x, y) => gridCol(clamp(Math.floor(x / 200), 0, Math.ceil(W / 200) - 1)) + (clamp(Math.floor(y / 200), 0, Math.ceil(H / 200) - 1) + 1);   // 200 一格：列 A–Z、AA… 自西向东，行 1… 自北向南（地图上有标注，places.js）

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
const passInf = (x, y) => TP[typeAt(x, y)].sp > 0;   // 能站：落脚点、队形位置只取这些格（河里不站人、不停车）
// 渡河：所有兵种都能涉水过河，只是慢——步兵、车辆在河里只有平地速度的两成五，两栖车辆六成；寻路照样优先走桥和渡口
const RIVER_WADE = { inf: .25, veh: .25, amph: .6 };
const wadeInf = (x, y) => { const t = typeAt(x, y); return TP[t].sp > 0 || t === T.RIVER; };   // 能走（含涉水）
const spInf = t => TP[t].sp || (t === T.RIVER ? RIVER_WADE.inf : 0);   // 步兵在这种地形上的速度系数
const coverAt = (x, y) => TP[typeAt(x, y)].cv;
// 地面坡度（度）：按 3D 地形里看到的坡度（高程 1.0 对应 view3d.js V3_HZ 高），中心差分、跨度 2r。
//   碉堡、岸防炮台是整块浇筑的混凝土工事，只能建在 SLOPE_MAX 以内的平地上（沙盒放置、AI 布防、战役布防都按这个）
const SLOPE_MAX = 14;
function groundSlope(x, y, r = 10) {
  const k = typeof V3_HZ === 'number' ? V3_HZ : 230, z = (a, b) => elevAt(clamp(a, 0, W - 1), clamp(b, 0, H - 1)) * k;
  return Math.atan(Math.hypot((z(x + r, y) - z(x - r, y)) / (2 * r), (z(x, y + r) - z(x, y - r)) / (2 * r))) * 57.3;
}
// r 以内离 (x, y) 最近的一处平地（坡度不超过 max，ok 为额外条件）；没有返回 null
function flatNear(x, y, r, max = SLOPE_MAX, ok) {
  for (let d = 0; d <= r; d += 8) for (let i = 0, n = d ? Math.ceil(d * .8) : 1; i < n; i++) {
    const a = i / n * 6.283, px = clamp(x + Math.cos(a) * d, 10, W - 10), py = clamp(y + Math.sin(a) * d, 10, H - 10);
    if (groundSlope(px, py) <= max && (!ok || ok(px, py))) return { x: px, y: py };
  }
  return null;
}
// 观战看全图：双方都交给 AI、玩家不指挥任何一方时才算（指挥模式 S.ctl 下各级仍由 AI 执行，但玩家只看本方视野）
const specAll = () => !!S && S.role === 'spectate' && !S.ctl;

// 行为计数（S.v7s，测试与调试用）：各模块的 xxStat 都写这里
const v8Stat = (k, n = 1) => { if (!S) return; const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
// 模块挂钩：新模块向这里登记函数，主循环/渲染/输入按名调用，免得多个模块同改一处
// newGame(opts) · step(dt) · impact(x,y,R,pw,side) · visionP()/visionE() 返回视野源数组
// drawGround（地面层：先于弹坑、战壕、据点）/drawUnder/drawOver/drawTop(time) 世界坐标 · frame(now,dt) 每帧 · pointer(e,kind,p)/key(e) 返回 true 表示已处理
const HOOK = { newGame: [], step: [], impact: [], visionP: [], visionE: [], drawGround: [], drawUnder: [], drawOver: [], drawTop: [], frame: [], pointer: [], key: [] };
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
