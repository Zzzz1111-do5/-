'use strict';
// 地图生成（一）：海岸线、四处海滩、悬崖礁岸、高程、河流、沼泽与基础地形
let TER = null;
const coastAt = x => TER.coast[clamp(Math.round(x), 0, W)];
const BEACH_NAMES = ['红滩', '白滩', '蓝滩', '金滩'];

function buildMap(seed) {
  const r = rng(seed);
  const ph = Array.from({ length: 8 }, () => r() * 6.28);
  const coast = new Float32Array(W + 1);
  for (let x = 0; x <= W; x++)
    coast[x] = 585 + 58 * Math.sin(x / 270 + ph[0]) + 26 * Math.sin(x / 97 + ph[1]) + 9 * Math.sin(x / 31 + ph[2]);
  const cAt = x => coast[clamp(Math.round(x), 0, W)];

  // 河口在中段，河口两侧各两处可登陆海滩，其余海岸是悬崖或礁岸
  const mouthX = 720 + r() * 160;
  const sectors = [[60, mouthX - 330], [mouthX - 300, mouthX - 90], [mouthX + 90, mouthX + 330], [mouthX + 360, W - 60]];
  const beaches = sectors.map(([a, b], i) => {
    const w = 120 + r() * 50, x0 = a + r() * Math.max(0, b - a - w);
    return { name: BEACH_NAMES[i], x0, x1: x0 + w, cx: x0 + w / 2 };
  });
  const beachAt = x => beaches.findIndex(b => x >= b.x0 && x <= b.x1);

  // 河道：每行一个中心 x，入海处收拢到河口
  const rx = new Float32Array(GH);
  for (let gy = 0; gy < GH; gy++) {
    const y = gy * CELL + 5;
    rx[gy] = mouthX + (55 * Math.sin(y / 150 + ph[3]) + 22 * Math.sin(y / 47 + ph[4])) * smooth(0, 180, cAt(mouthX) - y);
  }

  const noise = valueNoise(r, 16, 10), noise2 = valueNoise(r, 32, 20), cliffN = valueNoise(r, 26, 1);
  const headland = x => beachAt(x) < 0 && Math.abs(x - mouthX) > 60 && cliffN(x / W, 0) > .42;
  const massif = { x: r() < .5 ? 130 + r() * 120 : W - 130 - r() * 120, y: 70 + r() * 50, r: 150, h: .85 };
  const hills = [massif];
  for (let i = 0; i < 6; i++) hills.push({ x: 80 + r() * (W - 160), y: 60 + r() * 300, r: 45 + r() * 60, h: .22 + r() * .3 });
  const ridgeY = x => cAt(x) - 270 + 40 * Math.sin(x / 190 + ph[5]);

  const type = new Uint8Array(GW * GH), elev = new Float32Array(GW * GH);
  const mouthY = cAt(mouthX);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const x = gx * CELL + 5, y = gy * CELL + 5, i = gy * GW + gx, c = cAt(x), d = c - y, b = beachAt(x);
    if (d <= 0) {
      const shoalW = b >= 0 ? 60 : Math.abs(x - mouthX) < 70 ? 70 : 28;
      type[i] = -d < shoalW ? T.SHOAL : T.DEEP;
      continue;
    }
    let e = .05 + Math.min(.16, d / 2000);
    e += .36 * Math.exp(-((y - ridgeY(x)) ** 2) / 7200);
    for (const h of hills) e += h.h * Math.exp(-((x - h.x) ** 2 + (y - h.y) ** 2) / (2 * h.r * h.r));
    if (headland(x)) e += .5 * Math.exp(-((d - 25) ** 2) / 1800);
    e += (noise(x / W, y / H) - .5) * .2 + (noise2(x / W, y / H) - .5) * .08;
    if (b >= 0) e *= lerp(.35, 1, smooth(30, 160, d));                 // 海滩后方平缓
    const rd = Math.abs(x - rx[gy]);
    e *= lerp(.35, 1, smooth(10, 90, rd));                               // 河谷
    e = clamp(e, 0, 1);
    elev[i] = e;
    let t;
    if (rd < 9) t = T.RIVER;
    else if (d < 22) t = b >= 0 ? T.BEACH : headland(x) ? T.CLIFF : Math.abs(x - mouthX) < 60 ? T.MARSH : T.ROCKS;
    else if (dist(x, y, mouthX, mouthY) < 115 && e < .32 && noise2(x / W + .5, y / H) > .38) t = T.MARSH;
    else if (e > .8) t = T.MOUNT;
    else if (e > .5) t = T.HILL;
    else if (noise2(x / W + .37, y / H + .21) > .64 || (noise(x / W + .1, y / H + .6) > .7 && e > .25)) t = T.FOREST;
    else t = T.FIELD;
    type[i] = t;
  }
  TER = { seed, type, elev, coast, beaches, mouthX, rx, massif, bridges: [], points: [] };
  finishMap(r, cAt, headland);
}
