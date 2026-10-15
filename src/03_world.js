/* =====================================================================
   Names
   ===================================================================== */
const SYL = '阿 巴 卡 达 厄 法 伽 哈 伊 嘉 克 洛 玛 纳 欧 帕 奎 拉 萨 塔 乌 维 沃 夏 亚 泽 辛 莫 雷 索 缇 琉 瑟 赫 诺 兰 贝 米 奥 塞 图 坦 斯 林 安 恩 特 丽 罗 苏 梅 凯 珀 黎 昆 澜 汐 岚 曦 墨 弥 艾 尔 迦 珊 蒂 沙 寒 鸣 青 燕 齐 楚 越 秦 吴'.split(' ');
const STARS = ['比邻星', '巴纳德星', '天苑四', '天仓五', '罗斯 128', '格利泽 581', '开普勒 452', '波江座 ε', '鲸鱼座 τ', '牛郎星', '织女星', '天狼星'];
const NATION_COLORS = ['#e8604c', '#4aa8e8', '#f0c04a', '#6fcf86', '#b07ee6', '#ea7fbf', '#49d6c4', '#f2913d', '#97a6ff', '#c3e05a', '#ff7a95', '#5f8dff', '#d9a878', '#9fe3ff', '#ffd2a0', '#8ec63f', '#e0e0e0', '#c47d5a'];
function hexRgb(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function uniqueName(make) { for (let k = 0; k < 40; k++) { const s = make(); if (!S.names[s]) { S.names[s] = 1; return s; } } const s = make() + (S.nextCity % 97); S.names[s] = 1; return s; }
function nationName(era) {
  const suf = era < 2 ? ['王国', '帝国', '城邦', '部落联盟'] : era < 4 ? ['王国', '帝国', '公国', '共和国'] : ['共和国', '联邦', '合众国', '联合体'];
  return uniqueName(() => pick(SYL) + pick(SYL) + (rand() < 0.3 ? pick(SYL) : '')) + pick(suf);
}
function cityName(i) {
  const coastal = isCoastal(i), mtn = nearBiome(i, B.MOUNTAIN, 2);
  const suf = coastal ? ['港', '湾', '城', '津', ''] : mtn ? ['岭', '堡', '城', '关', ''] : ['城', '原', '州', '镇', '堡', '谷', ''];
  return uniqueName(() => pick(SYL) + pick(SYL) + pick(suf));
}

/* =====================================================================
   World generation (static, deterministic from seed)
   ===================================================================== */
let WORLD = null, S = null;

function genWorld(seed) {
  const rnd = mulberry32(seed);
  const nE = makeNoise(rnd), nW = makeNoise(rnd), nM = makeNoise(rnd), nT = makeNoise(rnd), nR = makeNoise(rnd), nC = makeNoise(rnd);
  const o1 = rnd() * 50, o2 = rnd() * 50, o3 = rnd() * 50;
  const raw = new Float32Array(TN), mo = new Float32Array(TN), tn = new Float32Array(TN);
  for (let ty = 0; ty < TH; ty++) {
    const lat = PI / 2 - (ty + 0.5) / TH * PI, sl = Math.sin(lat), cl = Math.cos(lat);
    for (let tx = 0; tx < TW; tx++) {
      const lon = (tx + 0.5) / TW * TAU - PI;
      const x = cl * Math.cos(lon), y = sl, z = cl * Math.sin(lon);
      const wv = fbm(nW, x * 1.5 + o1, y * 1.5 + o2, z * 1.5 + o3, 3);
      const ti = ty * TW + tx;
      raw[ti] = fbm(nE, x * 1.2 + wv * 0.9 + o1, y * 1.2 + wv * 0.9 + o2, z * 1.2 - wv * 0.9 + o3, 8);
      mo[ti] = fbm(nM, x * 2.1 + o3, y * 2.1 + o1, z * 2.1 + o2, 4);
      tn[ti] = nT(x * 1.7 + o2, y * 1.7 + o3, z * 1.7 + o1);
    }
  }
  // sea level at the 70th percentile → ~30% land
  const sample = [];
  for (let i = 0; i < TN; i += 7) sample.push(raw[i]);
  sample.sort((a, b) => a - b);
  const sea = sample[(sample.length * 0.70) | 0], lo = sample[0], hi = sample[sample.length - 1];
  const tElev = new Float32Array(TN), tT = new Float32Array(TN), tM = new Float32Array(TN), tBiome = new Uint8Array(TN);
  const tHash = new Uint8Array(TN), tHash2 = new Uint8Array(TN), tShade = new Float32Array(TN);
  for (let i = 0; i < TN; i++) {
    const e = raw[i];
    tElev[i] = e > sea ? (e - sea) / (hi - sea) : (e - sea) / (sea - lo);
    let h = Math.imul(i ^ (seed * 7919), 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    tHash[i] = h & 255; tHash2[i] = (h >>> 8) & 255;
  }
  const landSample = [];
  for (let i = 0; i < TN; i += 5) if (tElev[i] > 0) landSample.push(tElev[i]);
  landSample.sort((a, b) => a - b);
  const mtn = landSample[(landSample.length * 0.93) | 0] || 0.6;
  for (let ty = 0; ty < TH; ty++) {
    const lat = PI / 2 - (ty + 0.5) / TH * PI, cl = Math.cos(lat), latDeg = Math.abs(lat * 180 / PI);
    for (let tx = 0; tx < TW; tx++) {
      const i = ty * TW + tx, e = tElev[i], el = Math.max(0, e);
      tT[i] = -26 + 54 * Math.pow(cl, 1.35) - el * 30 + tn[i] * 6;
      tM[i] = clamp(0.5 + 0.95 * mo[i] + 0.2 * Math.cos(latDeg * PI / 30) - el * 0.25, 0, 1);
      tBiome[i] = e > 0 ? classify(e, tT[i], tM[i], mtn) : (e > -0.1 ? B.SHALLOW : B.DEEP);
    }
  }
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const i = ty * TW + tx;
    if (tElev[i] <= 0) { tShade[i] = 1; continue; }
    const l = tElev[ty * TW + (tx + TW - 1) % TW], r = tElev[ty * TW + (tx + 1) % TW];
    const u = tElev[Math.max(0, ty - 1) * TW + tx], d = tElev[Math.min(TH - 1, ty + 1) * TW + tx];
    tShade[i] = clamp(1 + ((r - l) + (d - u)) * 7, 0.72, 1.3);
  }
  // simulation cells = 4×4 texel averages
  const elev = new Float32Array(N), cT = new Float32Array(N), moist = new Float32Array(N), biome = new Uint8Array(N);
  const fert0 = new Float32Array(N), forest0 = new Float32Array(N), fish = new Float32Array(N);
  const minTE = new Float32Array(N), minTT = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let se = 0, st = 0, sm = 0, mn = 9, mt = 99;
    for (let sy = 0; sy < TS; sy++) for (let sx = 0; sx < TS; sx++) {
      const ti = (y * TS + sy) * TW + x * TS + sx;
      se += tElev[ti]; st += tT[ti]; sm += tM[ti]; if (tElev[ti] < mn) mn = tElev[ti]; if (tT[ti] < mt) mt = tT[ti];
    }
    const i = y * W + x, k = TS * TS;
    elev[i] = se / k; cT[i] = st / k; moist[i] = sm / k; minTE[i] = mn; minTT[i] = mt;
    biome[i] = elev[i] > 0 ? classify(elev[i], cT[i], moist[i], mtn) : (elev[i] > -0.1 ? B.SHALLOW : B.DEEP);
    fert0[i] = BIOME_FERT[biome[i]] * (0.75 + 0.5 * moist[i]);
    forest0[i] = BIOME_FOREST[biome[i]];
  }
  // fish & mineral deposits
  const res0 = {}; for (const r of RES) res0[r] = new Float32Array(N);
  const cand = { coal: [], oil: [], iron: [], uran: [], rare: [] };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, lat = CELL_LAT[y], lon = cellLon(x), cl = Math.cos(lat);
    const px = cl * Math.cos(lon), py = Math.sin(lat), pz = cl * Math.sin(lon);
    const b = biome[i], land = elev[i] > 0;
    if (b === B.SHALLOW) fish[i] = clamp(0.45 + 0.6 * fbm(nR, px * 4, py * 4, pz * 4, 2) + (Math.abs(lat) > 0.6 ? 0.15 : 0), 0.1, 1);
    if (land && b !== B.ICE) {
      if ([B.FOREST, B.TAIGA, B.GRASS, B.STEPPE, B.TUNDRA].includes(b) && elev[i] < 0.5) cand.coal.push([i, fbm(nC, px * 3 + 5, py * 3, pz * 3, 3)]);
      if ([B.DESERT, B.STEPPE, B.TUNDRA, B.SAVANNA, B.JUNGLE].includes(b)) cand.oil.push([i, fbm(nR, px * 3.3, py * 3.3 + 7, pz * 3.3, 3)]);
      if (elev[i] > 0.1) cand.iron.push([i, fbm(nW, px * 4 + 3, py * 4, pz * 4 - 3, 3)]);
      cand.uran.push([i, fbm(nM, px * 5 + 9, py * 5, pz * 5, 3)]);
      if (elev[i] > 0.06) cand.rare.push([i, fbm(nT, px * 5 + 11, py * 5, pz * 5, 3)]);
    }
    if (b === B.SHALLOW) cand.oil.push([i, fbm(nR, px * 3.3, py * 3.3 + 7, pz * 3.3, 3) - 0.04]);
  }
  const share = { coal: 0.16, oil: 0.13, iron: 0.14, uran: 0.05, rare: 0.06 };
  const resTotal = {};
  for (const r of RES) {
    const c = cand[r].sort((a, b) => b[1] - a[1]);
    const k = Math.max(4, (c.length * share[r]) | 0), thr = c[Math.min(k, c.length - 1)][1], top = c[0][1];
    let sum = 0;
    for (let j = 0; j < k && j < c.length; j++) { const v = 0.35 + (c[j][1] - thr) / (top - thr + 1e-6); res0[r][c[j][0]] = v; sum += v; }
    const scale = RES_TOTAL[r] / sum;
    for (let i = 0; i < N; i++) res0[r][i] *= scale;
    resTotal[r] = RES_TOTAL[r];
  }
  // clouds
  const CW0 = 512, CH0 = 256, craw = new Float32Array(CW0 * CH0);
  for (let y = 0; y < CH0; y++) {
    const lat = PI / 2 - (y + 0.5) / CH0 * PI, sl = Math.sin(lat), cl = Math.cos(lat), ld = Math.abs(lat * 180 / PI);
    const band = 0.08 * Math.exp(-ld * ld / 60) + 0.1 * Math.exp(-(ld - 52) * (ld - 52) / 120) - 0.08 * Math.exp(-(ld - 25) * (ld - 25) / 80);
    for (let x = 0; x < CW0; x++) {
      const lon = (x + 0.5) / CW0 * TAU - PI;
      craw[y * CW0 + x] = fbm(nC, cl * Math.cos(lon) * 2.6 + 3, sl * 2.6 * 1.4, cl * Math.sin(lon) * 2.6 - 3, 6) + band;
    }
  }
  const cloud = new Uint8Array(CW * CH);
  for (let y = 0; y < CH; y++) {
    const sy = clamp((y + 0.5) / CH * CH0 - 0.5, 0, CH0 - 1), y0 = Math.floor(sy), y1 = Math.min(CH0 - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < CW; x++) {
      const sx = (x + 0.5) / CW * CW0 - 0.5, xf = Math.floor(sx), fx = sx - xf;
      const x0 = (xf + CW0) % CW0, x1 = (x0 + 1) % CW0;
      const a = craw[y0 * CW0 + x0] + (craw[y0 * CW0 + x1] - craw[y0 * CW0 + x0]) * fx;
      const b = craw[y1 * CW0 + x0] + (craw[y1 * CW0 + x1] - craw[y1 * CW0 + x0]) * fx;
      cloud[y * CW + x] = Math.round(smooth(0.03, 0.3, a + (b - a) * fy) * 225);
    }
  }
  return { seed, tElev, tT, tBiome, tHash, tHash2, tShade, elev, cT, moist, biome, fert0, forest0, fish, res0, resTotal, minTE, minTT, cloud, mtn };
}

function classify(e, T, m, mtn) {
  if (T < -10) return B.ICE;
  if (e > mtn) return B.MOUNTAIN;
  if (T < -2) return B.TUNDRA;
  if (T < 5) return m > 0.42 ? B.TAIGA : B.STEPPE;
  if (T < 18) return m < 0.27 ? B.DESERT : m < 0.43 ? B.STEPPE : m < 0.57 ? B.GRASS : B.FOREST;
  return m < 0.3 ? B.DESERT : m < 0.45 ? B.SAVANNA : m < 0.6 ? B.GRASS : B.JUNGLE;
}

