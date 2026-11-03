'use strict';
// 台湾东海岸（MAPGEN.tw，战役与沙盒的默认战场；用户：把 Sketchfab 上那块台湾东海岸下载下来按真实比例做成战场，平面的居民区做成立体的）：
//   用的就是 Sketchfab「Taiwan (East coast)」（Miguel Cueva，CC BY-NC-SA 4.0；高程 SRTM GL1、影像 Esri World Imagery）——花东纵谷、两条辫状大河、海岸山脉、东海岸。
//   模型本来就是按米建的真实大小（约 24.4 × 32.4 公里），高度放大了 1.5 倍，这里还原成真实高度（最高约 2020 米）；游戏的海在南边，整块转 90°：模型的东海岸朝南、北朝东，
//   南边再补 3 公里海面给舰队集结。每格 20 米（setWorld 的 cell；默认地图 10 米）。数据在 js/twmap.js（一次性转换：高度 40 米一格、地表类别 20 米一格），
//   3D 地面直接贴模型的卫星图（assets/tw/sat.jpg，view3d.js v3BaseTex / uSat），原封不动：居民区不立房屋、据点不盖房子（用户要求），卫星图里的居民区只用来定镇子、指挥所的位置。
//   授权不许商用：只在网页版里用，商店版（tools/build_www.mjs --app）不带 twmap.js、assets/tw，这时 MAPGEN.tw 不登记，一切照旧用程序生成的地图
const TW = { nm: '台湾东海岸', sat: 'assets/tw/sat.jpg', dec: null };
if (typeof TW_DATA === 'object' && TW_DATA) MAPGEN.tw = { w: TW_DATA.w, h: TW_DATA.h, cell: TW_DATA.cell, build: buildTw, nm: TW.nm };
// 游戏里「素材致谢」（v3import.js 汇总 V3G_CRED）：有这张图时加上
const TW_CRED = { name: '台湾东海岸地图（只在网页版）', title: 'Taiwan (East coast)', author: 'Miguel Cueva', license: 'CC-BY-NC-SA-4.0', url: 'https://sketchfab.com/3d-models/taiwan-east-coast-eb170c63b22b4410a79524709d561c3c' };
if (MAPGEN.tw) HOOK.newGame.push(() => { if (typeof V3G_CRED === 'object' && Array.isArray(V3G_CRED) && !V3G_CRED.includes(TW_CRED)) V3G_CRED.push(TW_CRED); });
const twOn = () => !!(typeof TER === 'object' && TER && TER.tw);

// base64 → 字节（浏览器、无头环境都能用，不依赖 atob / Buffer）
function twB64(s) {
  const A = new Uint8Array(128);
  for (let i = 0; i < 64; i++) A['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.charCodeAt(i)] = i;
  let n = s.length; while (n && s[n - 1] === '=') n--;
  const out = new Uint8Array((n * 3) >> 2);
  let o = 0, b = 0, k = 0;
  for (let i = 0; i < n; i++) { b = (b << 6) | A[s.charCodeAt(i)]; k += 6; if (k >= 8) { k -= 8; out[o++] = (b >> k) & 255; } }
  return out;
}
// 解码（只做一次）：高度（米，40 米一格）、地表类别（20 米一格）
function twDecode() {
  if (TW.dec) return TW.dec;
  const D = TW_DATA, eb = twB64(D.elev), e = new Float32Array(D.dw * D.dh);
  for (let i = 0; i < e.length; i++) e[i] = (eb[2 * i] | (eb[2 * i + 1] << 8)) / 10;
  const rb = twB64(D.cover), N = (D.w / D.cell) * (D.h / D.cell), cov = new Uint8Array(N);
  for (let i = 0, o = 0; i < rb.length && o < N; i += 2) { cov.fill(rb[i], o, Math.min(N, o + rb[i + 1])); o += rb[i + 1]; }
  return (TW.dec = { e, cov });
}

function buildTw(seed) {
  const r = rng(seed), D = TW_DATA, { e: E40, cov } = twDecode(), dx = D.dx, hmax = D.hmax;
  const hAt = (x, y) => {   // 40 米格的双线性插值（米）
    const fx = clamp(x / dx, 0, D.dw - 1.001), fy = clamp(y / dx, 0, D.dh - 1.001), i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * D.dw + i;
    return E40[k] * (1 - u) * (1 - v) + E40[k + 1] * u * (1 - v) + E40[k + D.dw] * (1 - u) * v + E40[k + D.dw + 1] * u * v;
  };
  const N = GW * GH, type = new Uint8Array(N), elev = new Float32Array(N), hC = new Float32Array(N);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) hC[gy * GW + gx] = hAt((gx + .5) * CELL, (gy + .5) * CELL);
  // 海岸线：每列从南往北第一个陆地格的南沿
  const colC = new Float32Array(GW);
  for (let gx = 0; gx < GW; gx++) { let gy = GH - 1; while (gy > 0 && cov[gy * GW + gx] === 0) gy--; colC[gx] = (gy + 1) * CELL; }
  const coast = new Float32Array(W + 1);
  for (let x = 0; x <= W; x++) { const g = clamp(Math.floor(x / CELL), 0, GW - 1); let s = 0, n = 0; for (let k = -2; k <= 2; k++) { const q = g + k; if (q >= 0 && q < GW) { s += colC[q]; n++; } } coast[x] = s / n; }
  const cAt = x => coast[clamp(Math.round(x), 0, W)];
  // 地表类别 + 坡度 → 地形类型：陡坡（> 26°）是山地（车辆上不去、步兵很慢），15–26° 是丘陵；沿岸陡的是礁岸
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx, c = cov[i], h = hC[i];
    elev[i] = clamp(h / hmax, 0, 1);
    if (c === 0) { type[i] = gy * CELL < colC[gx] + 110 ? T.SHOAL : T.DEEP; continue; }
    const hx = hC[gy * GW + Math.min(GW - 1, gx + 1)] - hC[gy * GW + Math.max(0, gx - 1)], hy = hC[Math.min(GH - 1, gy + 1) * GW + gx] - hC[Math.max(0, gy - 1) * GW + gx];
    const s = Math.atan(Math.hypot(hx, hy) / (4 * CELL)) * 57.3, nearSea = colC[gx] - gy * CELL < 80;
    let t;
    if (c === 4) t = s > 20 ? T.HILL : T.FIELD;   // 居民区：照卫星图原样，不立房屋（用户：不要加房屋，按这个图原封不动），只用来定镇子、指挥所的位置
    else if (c === 1) t = nearSea && s > 16 ? T.ROCKS : T.BEACH;   // 海滩、河床砾石
    else if (s > 26) t = nearSea ? T.ROCKS : T.MOUNT;
    else if (s > 15) t = T.HILL;
    else t = c === 2 ? T.FIELD : T.FOREST;
    type[i] = t;
  }
  // 海滩（登陆地段）：沿岸往里 240 米坡缓、站得住人的岸段，宽 220–420 米，彼此隔开 500 米以上
  const okAt = x => {
    const c = cAt(x);
    if (c < 400 || c > H - 300) return 0;
    let n = 0, s = 0;
    for (let d = 30; d <= 240; d += 30) { const i = ci(x, c - d), t = type[i]; n++; if (TP[t].sp >= .6 && t !== T.MOUNT) s++; }
    return s / n;
  };
  const runs = [];
  let st = null;
  for (let x = 300; x <= W - 300; x += 20) { if (okAt(x) >= .75) { if (st == null) st = x; } else { if (st != null && x - st >= 200) runs.push([st, x]); st = null; } }
  if (st != null && W - 300 - st >= 200) runs.push([st, W - 300]);
  const beaches = [];
  for (const [a, b] of runs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))) {
    for (let x0 = a; x0 + 200 <= b && beaches.length < 10; ) {
      const w = Math.min(b - x0, 220 + r() * 200);
      if (!beaches.some(B => x0 < B.x1 + 500 && x0 + w > B.x0 - 500)) beaches.push({ x0, x1: x0 + w, cx: x0 + w / 2 });
      x0 += w + 520;
    }
  }
  beaches.sort((p, q) => p.cx - q.cx).forEach((b, i) => { b.name = BEACH_NAMES[i % BEACH_NAMES.length]; });
  // 城镇：卫星图里成片的居民区（TOWN 格）按 400 米块数一数，最密的几块当镇子、指挥所，靠海的当渔村
  const BK = 400, bw = Math.ceil(W / BK), bh = Math.ceil(H / BK), cnt = new Int32Array(bw * bh);
  for (let i = 0; i < N; i++) if (cov[i] === 4) cnt[Math.floor(cellCY(i) / BK) * bw + Math.floor(cellCX(i) / BK)]++;
  const blocks = [];
  for (let j = 0; j < bh; j++) for (let k = 0; k < bw; k++) if (cnt[j * bw + k] >= 12) blocks.push({ x: (k + .5) * BK, y: (j + .5) * BK, n: cnt[j * bw + k] });
  blocks.sort((p, q) => q.n - p.n);
  const pick = (f, sep) => { for (const b of blocks) if (!b.used && f(b) && ![...blocks].some(o => o.used && dist(o.x, o.y, b.x, b.y) < sep)) { b.used = true; return { x: b.x, y: b.y }; } return null; };
  const inland = b => cAt(b.x) - b.y > 2500, coastal = b => cAt(b.x) - b.y < 1500 && cAt(b.x) - b.y > 60;
  // 指挥所：离登陆滩头最近的纵谷大镇（越大越好、越近越好）；其余按大小
  const bc = beaches.length ? beaches.reduce((a, b) => a + b.cx, 0) / beaches.length : W / 2, by = cAt(bc);
  const hb = blocks.filter(b => inland(b)).sort((p, q) => (q.n - dist(q.x, q.y, bc, by) / 120) - (p.n - dist(p.x, p.y, bc, by) / 120))[0];
  if (hb) hb.used = true;
  const hq = hb ? { x: hb.x, y: hb.y } : { x: W / 2, y: 2000 };
  const town1 = pick(inland, 2500) || { x: W * .3, y: cAt(W * .3) - 3000 }, town2 = pick(inland, 2500) || { x: W * .7, y: cAt(W * .7) - 3000 };
  const town3 = pick(inland, 2500);
  const vills = [];
  for (let k = 0; k < 3; k++) { const v = pick(coastal, 1800); if (v) vills.push(v); }
  TER = { seed, type, elev, coast, beaches, mouths: [], rivers: [], massif: { x: W / 2, y: 0, r: 1, h: 0 }, bridges: [], fords: [], points: [], roads: [],
    roadY: new Float32Array(GW + 1).map((_, k) => cAt(k * CELL) - 170), towns: { vills, town1, town2, town3, hq }, tw: true, hz: hmax };
  // 守方机场：纵谷里的平地（mapgen2.js afSite 找放得下跑道的地方）；场区推平成同一高度
  if (typeof eaRunwayFit === 'function' && typeof afSite === 'function') {
    TER.af = afSite(r, [...vills, town1, town2, town3, hq].filter(Boolean), hq);
    if (TER.af) {
      let s = 0, n = 0;
      const cells = [];
      for (let u = AF_BOX.u0; u <= AF_BOX.u1; u += 5) for (let v = AF_BOX.v0; v <= AF_BOX.v1; v += 5) { const [x, y] = afWorld(TER.af, u, v), i = ci(x, y); cells.push(i); s += elev[i]; n++; }
      const e0 = s / n;
      for (const i of cells) { elev[i] = e0; if (!isWater(type[i])) type[i] = T.FIELD; }
    }
  }
  // 据点：滩头出口、指挥所、镇子、渔村、海岸山脉上的雷达站（离岸 1.5–5 公里最高处）
  const P = [], add = (key, name, x, y, vp) => { if (x != null && !P.some(p => dist(p.x, p.y, x, y) < 120)) P.push({ key, name, x: Math.round(x), y: Math.round(y), vp }); };
  beaches.forEach((b, i) => add('E' + (i + 1), b.name + '出口', b.cx, cAt(b.cx) - 60, 1));
  add('HQ', '指挥所', hq.x, hq.y, 3);
  const tn = p => (p.x < W / 3 ? '西' : p.x > W * 2 / 3 ? '东' : '中') + '部镇子';   // 按方位叫
  add('T1', tn(town1), town1.x, town1.y, 2); add('T2', tn(town2) === tn(town1) ? tn(town2) + '二' : tn(town2), town2.x, town2.y, 2); if (town3) add('T3', '纵谷北镇', town3.x, town3.y, 2);
  vills.forEach((v, i) => add('V' + (i + 1), '渔村' + '一二三'[i], v.x, v.y, 1));
  let best = null, be = -1;
  for (let gy = 0; gy < GH; gy += 3) for (let gx = 0; gx < GW; gx += 3) {
    const i = gy * GW + gx, x = cellCX(i), y = cellCY(i), d = cAt(x) - y;
    if (d > 1500 && d < 5000 && x > W * .15 && x < W * .85 && elev[i] > be && type[i] !== T.TOWN) { be = elev[i]; best = { x, y }; }
  }
  if (best) add('RD', '雷达站', best.x, best.y, 2);
  TER.points = P;
  let cm = 0; for (let x = 0; x <= W; x += 20) cm = Math.max(cm, cAt(x));
  TER.pathY = Math.min(H, Math.ceil(cm + 900));
  setPathRows(Math.ceil((TER.pathY + 200) / CELL));
}
