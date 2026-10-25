'use strict';
// 地图生成（一）：海岸线、六处海滩、悬崖礁岸、两条河、两处山地、山脊、沼泽与基础地形
let TER = null;
const coastAt = x => TER.coast[clamp(Math.round(x), 0, W)];
const BEACH_NAMES = ['红滩', '白滩', '蓝滩', '金滩', '绿滩', '银滩', '黄滩', '黑滩', '紫滩', '橙滩'];
const N_BEACH = Math.round(6 * MAP_K * MAP_K / 1.6), N_RIVER = MAP_K > 1.2 ? 3 : 2;   // 海滩、河流按地图大小增加（1.4 倍边长：8 处海滩、3 条河）
// 第 k 条河在第 gy 行的中心 x；河源以北返回很大的负数
const riverX = (k, gy) => TER.rivers[k].rx[clamp(gy, 0, GH - 1)];

function buildMap(seed) {
  const r = rng(seed);
  const ph = Array.from({ length: 10 }, () => r() * 6.28);
  const coast = new Float32Array(W + 1), C0 = H * .54;
  for (let x = 0; x <= W; x++)
    coast[x] = C0 + 95 * MAP_K * Math.sin(x / (430 * MAP_K) + ph[0]) + 42 * Math.sin(x / 150 + ph[1]) + 14 * Math.sin(x / 47 + ph[2]);
  const cAt = x => coast[clamp(Math.round(x), 0, W)];

  // 河流：主河发源于北界，支流发源于内陆（大地图三条：西、中、东）
  const mouths = N_RIVER === 3 ? [W * (.2 + r() * .08), W * (.47 + r() * .08), W * (.74 + r() * .08)] : [W * (.36 + r() * .1), W * (.7 + r() * .1)];
  const main = N_RIVER === 3 ? 1 : 0;   // 发源于北界的主河
  const rivers = mouths.map((mx, k) => {
    const top = k === main ? -1 : cAt(mx) - (620 + r() * 220) * MAP_K, rx = new Float32Array(GH);
    for (let gy = 0; gy < GH; gy++) {
      const y = gy * CELL + 5;
      rx[gy] = y < top ? -1e9 : mx + (70 * Math.sin(y / 190 + ph[3] + k * 2) + 26 * Math.sin(y / 60 + ph[4] + k)) * smooth(0, 220, cAt(mx) - y);
    }
    return { mx, top, w: k === main ? 9 : 7, rx };
  });
  const nearMouth = (x, d) => mouths.some(m => Math.abs(x - m) < d);

  // 可登陆海滩（N_BEACH 处），避开河口
  const beaches = [], L = (W - 160) / N_BEACH;
  for (let i = 0; i < N_BEACH; i++) {
    const a = 80 + i * L, clash = (x0, w) => mouths.some(m => m > x0 - 100 && m < x0 + w + 100);
    let w = 160 + r() * 70, x0 = a + r() * (L - w);
    for (let tries = 0; tries < 30 && clash(x0, w); tries++) { w = Math.max(130, w - 4); x0 = a + r() * (L - w); }
    if (clash(x0, w)) continue;
    beaches.push({ name: BEACH_NAMES[beaches.length], x0, x1: x0 + w, cx: x0 + w / 2 });
  }
  const beachAt = x => beaches.findIndex(b => x >= b.x0 && x <= b.x1);

  // 噪声网格按边长放大，地物斑块大小与原图一致
  const nk = n => Math.round(n * MAP_K);
  const noise = valueNoise(r, nk(24), nk(14)), noise2 = valueNoise(r, nk(48), nk(30)), cliffN = valueNoise(r, nk(40), 1);
  const rf = v => { v = ((v % 2) + 2) % 2; return v > 1 ? 2 - v : v; };   // 偏移后的噪声坐标在 0–1 内镜像折返（以前超出部分被截断，成了一道道直条纹）
  const headland = x => beachAt(x) < 0 && !nearMouth(x, 80) && cliffN(x / W, 0) > .42;
  const massif = { x: r() < .5 ? 300 + r() * 300 : W - 300 - r() * 300, y: 150 + r() * 100 * MAP_K, r: 260 * Math.sqrt(MAP_K), h: .9 };
  const hills = [massif, { x: W * .5 + (r() - .5) * 600 * MAP_K, y: 120 + r() * 80 * MAP_K, r: 200 * Math.sqrt(MAP_K), h: .75 }];
  for (let i = 0; i < Math.round(12 * MAP_K * MAP_K); i++) hills.push({ x: 100 + r() * (W - 200), y: 100 + r() * (C0 - 400), r: 60 + r() * 70, h: .2 + r() * .3 });
  const ridgeY = x => cAt(x) - 420 * MAP_K + 60 * Math.sin(x / 260 + ph[5]);

  const type = new Uint8Array(GW * GH), elev = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const x = gx * CELL + 5, y = gy * CELL + 5, i = gy * GW + gx, c = cAt(x), d = c - y, b = beachAt(x);
    if (d <= 0) {
      const shoalW = b >= 0 ? 70 : nearMouth(x, 90) ? 80 : 30;
      type[i] = -d < shoalW ? T.SHOAL : T.DEEP;
      continue;
    }
    let e = .05 + Math.min(.16, d / (3500 * MAP_K));
    e += .36 * Math.exp(-((y - ridgeY(x)) ** 2) / 14450);
    for (const h of hills) e += h.h * Math.exp(-((x - h.x) ** 2 + (y - h.y) ** 2) / (2 * h.r * h.r));
    if (headland(x)) e += .5 * Math.exp(-((d - 25) ** 2) / 1800);
    e += (noise(x / W, y / H) - .5) * .2 + (noise2(x / W, y / H) - .5) * .08;
    if (b >= 0) e *= lerp(.35, 1, smooth(30, 220, d));                 // 海滩后方平缓
    let rd = 1e9, rw = 9;
    for (const rv of rivers) { const dd = Math.abs(x - rv.rx[gy]); if (dd < rd) { rd = dd; rw = rv.w; } }
    e *= lerp(.35, 1, smooth(10, 130, rd));                              // 河谷
    e = clamp(e, 0, 1);
    elev[i] = e;
    let t;
    if (rd < rw) t = T.RIVER;
    else if (d < 24) t = b >= 0 ? T.BEACH : headland(x) ? T.CLIFF : nearMouth(x, 70) ? T.MARSH : T.ROCKS;
    else if (mouths.some(m => dist(x, y, m, cAt(m)) < 150) && e < .32 && noise2(rf(x / W + .5), y / H) > .38) t = T.MARSH;
    else if (e > .8) t = T.MOUNT;
    else if (e > .5) t = T.HILL;
    else if (noise2(rf(x / W + .37), rf(y / H + .21)) > .64 || (noise(rf(x / W + .1), rf(y / H + .6)) > .7 && e > .25)) t = T.FOREST;
    else t = T.FIELD;
    type[i] = t;
  }
  TER = { seed, type, elev, coast, beaches, mouths, rivers, massif, bridges: [], fords: [], points: [] };
  finishMap(r, cAt, headland);
}
