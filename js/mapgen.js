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
  // 空军基地预留地块（地图自带设施，场区约 1100 × 800）：跑道东西向，放在主河一侧的北部纵深；
  // 场区里推平成平地，流到场区里的支流改从场区南面才发源
  const afr = afReserve(rivers, main, cAt, r);
  if (afr) for (const [k, rv] of rivers.entries()) {
    if (k === main || rv.mx < afr.x0 - 160 || rv.mx > afr.x1 + 160) continue;
    rv.top = Math.max(rv.top, afr.y1 + 40);
    for (let gy = 0; gy < GH; gy++) if (gy * CELL + 5 < rv.top) rv.rx[gy] = -1e9;
  }

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
    if (headland(x)) e += .1 * Math.exp(-((d - 60) ** 2) / 9000);   // 岬角：低缓的岸坡（原来岸边陡起一道山包，很突兀）
    e += (noise(x / W, y / H) - .5) * .2 + (noise2(x / W, y / H) - .5) * .08;
    if (b >= 0) e *= lerp(.35, 1, smooth(30, 220, d));                 // 海滩后方平缓
    let rd = 1e9, rw = 9;
    for (const rv of rivers) { const dd = Math.abs(x - rv.rx[gy]); if (dd < rd) { rd = dd; rw = rv.w; } }
    e *= lerp(.35, 1, smooth(10, 130, rd));                              // 河谷
    e = clamp(e, 0, 1);
    elev[i] = e;
    const inAF = afr && x > afr.x0 && x < afr.x1 && y > afr.y0 && y < afr.y1 && rd >= rw;
    if (inAF) { e = .28 + (e - .28) * .12; elev[i] = e; type[i] = T.FIELD; continue; }   // 机场场区：推平
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
  TER = { seed, type, elev, coast, beaches, mouths, rivers, massif, bridges: [], fords: [], points: [], af: afr ? { x: afr.x, y: afr.y, h: afr.h, s: afr.s } : null, afr };
  finishMap(r, cAt, headland);
}

// 空军基地预留：场区（AF_BOX × AF_K）放在主河哪一侧更宽就放哪一侧，北缘离地图上沿 80，跑道东西向、停机坪朝北（s = -1）；
// 返回 {x, y, h, s} 与外接矩形 x0..x1、y0..y1，放不下（场区南缘离海不到 300）返回 null
function afReserve(rivers, main, cAt, r) {
  const yc = 80 + AF_BOX.v1 * AF_K + 20, y0 = yc - AF_BOX.v1 * AF_K, y1 = yc - AF_BOX.v0 * AF_K, hw = (AF_BOX.u1 + 15) * AF_K;
  const rv = rivers[main];
  let lo = Infinity, hi = -Infinity;
  for (let gy = Math.max(0, Math.floor(y0 / CELL)); gy <= Math.min(GH - 1, Math.ceil(y1 / CELL)); gy++) { const x = rv.rx[gy]; if (x > -1e8) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }
  if (!isFinite(lo)) { lo = rv.mx; hi = rv.mx; }
  const L = [60 + hw, lo - 170 - hw], Rr = [hi + 170 + hw, W - 60 - hw], I = L[1] - L[0] >= Rr[1] - Rr[0] ? L : Rr;
  if (I[1] < I[0]) return null;
  const xc = Math.round(I[0] + (I[1] - I[0]) * (.25 + r() * .5));   // 可用范围里随机偏一点，不每张图都在同一处
  if (cAt(xc - hw) - y1 < 300 || cAt(xc + hw) - y1 < 300 || cAt(xc) - y1 < 300) return null;
  return { x: xc, y: Math.round(yc), h: 0, s: -1, x0: xc - hw, x1: xc + hw, y0: y0 - 20, y1: y1 + 20 };
}
