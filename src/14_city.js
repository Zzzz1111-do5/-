/* =====================================================================
   City layouts and building sprites
   Every building is a small oblique 3-D model (front, east face, roof)
   painted once into a cached sprite canvas per (kind, era, variant,
   colour, zoom bucket) together with its drop shadow, outline and a
   separate night-lights layer, so a city costs one drawImage per
   building however detailed the model is.
   ===================================================================== */
const SKINS = ['#f1c9a1', '#dba67a', '#b67b52', '#8c5b3a', '#f3d6b3', '#c69068'];
const HAIRS = ['#2a1e14', '#5a3a1e', '#d6be6e', '#1b1b1b', '#8a4a24'];
function landAt(x, y) { const xi = ((Math.round(x) % MW) + MW) % MW, yi = Math.round(y); if (yi < 0 || yi >= MH) return false; return !MWATER[yi * MW + xi]; }
const HSZ = [[3, 4], [3, 4], [3, 5], [3, 5], [3, 5], [4, 7], [4, 11], [4, 13], [4, 13]];
function layoutFor(c) {
  const n = S.nations[c.n], era = n.mult.era;
  const bucket = Math.max(0, Math.round(Math.log2(c.pop / 2e4 + 1) * 2));
  const nF = n.mult.ind > 0 ? Math.min(4, Math.ceil(c.fac / 6)) : 0, nL = n.mult.lab > 0 ? Math.min(3, Math.ceil(c.labs / 4)) : 0, nI = Math.min(3, c.inst || 0);
  const key = `${bucket}|${era}|${nF}|${nL}|${nI}|${c.cap ? 1 : 0}|${n.mult.wall}|${(S.seaRise * 1000) | 0}|${S.terra.length}|${c.n}`;
  if (c.lay && c.lay.key === key) return c.lay;
  const rng = mulberry32(c.id * 9973 + 17);
  const [cx, cy] = cityMpx(c);
  const occ = new Set();
  const free = (x, y, w, h) => {
    for (let yy = y - h; yy <= y; yy++) for (let xx = x - Math.ceil(w / 2); xx <= x + Math.ceil(w / 2); xx++) { if (!landAt(xx, yy)) return false; if (occ.has(xx * 4096 + yy)) return false; }
    return true;
  };
  const take = (x, y, w, h) => { for (let yy = y - h - 1; yy <= y + 1; yy++) for (let xx = x - Math.ceil(w / 2) - 1; xx <= x + Math.ceil(w / 2) + 1; xx++) occ.add(xx * 4096 + yy); };
  const items = [], homes = [], labs = [], factories = [], patrol = [];
  const hsz = HSZ[era], grid = era >= 3, GX = 6, GY = 7;
  // planned eras snap everything to a street grid; older towns grow organically
  const snap = (x, y) => grid ? [Math.round(cx + Math.round((x - cx) / GX) * GX), Math.round(cy + Math.round((y - cy) / GY) * GY)] : [x, y];
  const place = (t, w, h, maxR, startK) => {
    for (let k = startK || 0; k < 500; k++) {
      const ang = k * 2.39996 + rng() * 0.3, rad = 2 + Math.sqrt(k) * 2.1;
      if (rad > maxR) return null;
      const [x, y] = snap(Math.round(cx + Math.cos(ang) * rad), Math.round(cy + Math.sin(ang) * rad * 0.75));
      if (free(x, y, w, h)) { take(x, y, w, h); const it = { t, x, y, v: rng() }; items.push(it); return it; }
    }
    return null;
  };
  const nb = clamp(Math.round(3 + bucket * 2.4), 3, 60);
  const maxR = 6 + Math.sqrt(nb) * 3.2;
  const center = place(c.cap ? 'palace' : 'hall', 7, 8, maxR);
  if (center) patrol.push([center.x - 3, center.y + 1], [center.x + 3, center.y + 1]);
  if (c.cap && bucket >= 5) { const w = place('wonder', 9, 9, maxR + 3, 9); if (w) w.vi = c.id & 1; }
  if (era <= 5 && bucket >= (era ? 4 : 3)) place('temple', 5, 6, maxR, 6);
  for (let k = 0; k < nI; k++) { const it = place('inst', 6, 6, maxR + 3, 8); if (it) labs.push([it.x, it.y + 1]); }
  for (let k = 0; k < nL; k++) { const it = place('lab', 5, 5, maxR, 8); if (it) labs.push([it.x, it.y + 1]); }
  for (let k = 0; k < nF; k++) { const it = place('factory', 7, 6, maxR + 6, 20); if (it) factories.push([it.x, it.y + 1]); }
  if (era >= 1 && bucket >= 3) place(era >= 5 ? 'park' : 'market', 6, 3, maxR, 4);
  let placed = 0;
  const hR = maxR + (grid ? 6 : 4);
  for (let k = 3; k < 900 && placed < nb; k++) {
    const ang = k * 2.39996, rad = 2 + Math.sqrt(k) * (grid ? 1.5 : 2.1);
    if (rad > hR) break;
    const [x, y] = snap(Math.round(cx + Math.cos(ang) * rad + (rng() - 0.5) * 1.5), Math.round(cy + Math.sin(ang) * rad * 0.75 + (rng() - 0.5) * 1.5));
    if (!free(x, y, hsz[0], Math.min(hsz[1], 5))) continue;
    take(x, y, hsz[0], Math.min(hsz[1], 5));
    const v = rng(), dn = Math.hypot(x - cx, (y - cy) / 0.75) / hR;
    let hc = clamp(Math.floor((1 - dn) * 2.7 + rng() * 1.3 + (bucket - 12) * 0.07), 0, 3);
    if (era < 4) hc = 0; else if (era === 4) hc = hc >> 1;
    const it = { t: 'house', x, y, v, vi: Math.floor(v * 4), hc }; items.push(it); homes.push([x, y + 1]); placed++;
  }
  if (!homes.length) homes.push([cx, cy + 1]);
  let port = null;
  if (c.coastal) {
    for (let k = 0; k < 900 && !port; k++) {
      const ang = k * 2.39996, rad = 3 + Math.sqrt(k) * 0.9;
      const x = Math.round(cx + Math.cos(ang) * rad), y = Math.round(cy + Math.sin(ang) * rad);
      if (!landAt(x, y) && landAt(x - Math.sign(Math.cos(ang)) * 2, y - Math.sign(Math.sin(ang)) * 2)) port = { t: 'port', x, y, v: rng(), dir: Math.cos(ang) >= 0 ? 1 : -1 };
    }
    if (port) {
      port.vi = port.dir > 0 ? 0 : 1; items.push(port);
      if (era >= 2) for (let k = 0; k < 60; k++) { const x = Math.round(port.x - port.dir * (3 + (k % 6))), y = Math.round(port.y - 2 + ((k / 6) | 0) - 4); if (free(x, y, 5, 4)) { take(x, y, 5, 4); items.push({ t: 'ware', x, y, v: rng() }); break; } }
    }
  }
  let wall = 0;
  if (n.mult.wall && era <= 4 && bucket >= 3) {
    wall = Math.round(maxR * 0.85);
    for (let a = 0; a < 6; a++) { const x = Math.round(cx + Math.cos(a * 1.05) * wall), y = Math.round(cy + Math.sin(a * 1.05) * wall * 0.75); patrol.push([x, y]); items.push({ t: 'tower', x, y: y + 0.5, v: rng() }); }
    for (let k = 0; k < 12; k++) { const a0 = k / 12 * TAU, a1 = (k + 1) / 12 * TAU; let my = -1; for (let s = 0; s <= 4; s++) my = Math.max(my, Math.sin(a0 + (a1 - a0) * s / 4)); items.push({ t: 'wseg', a0, a1, x: cx, y: cy + my * wall * 0.75 }); }
  }
  if (!patrol.length) patrol.push([cx, cy + 2]);
  // streets: rows of a grid town, or a few winding lanes in an organic one
  const st = [], ln = [], lamps = [];
  if (grid) {
    const has = new Set(), rows = new Map();
    let i0 = 1e9, i1 = -1e9, j0 = 1e9, j1 = -1e9;
    for (const it of items) {
      if (it.t === 'wseg' || it.t === 'tower' || it.t === 'port' || it.t === 'ware') continue;
      const i = Math.round((it.x - cx) / GX), j = Math.round((it.y - cy) / GY);
      has.add(i * 1000 + j); if (!rows.has(j)) rows.set(j, []); rows.get(j).push(i);
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
    for (const [j, cols] of rows) {
      cols.sort((a, b) => a - b);
      let s0 = cols[0];
      for (let k = 1; k <= cols.length; k++) if (k === cols.length || cols[k] - cols[k - 1] > 2) { st.push([cx + s0 * GX - 3.4, cy + j * GY + 0.75, (cols[k - 1] - s0) * GX + 7.2, 1.35]); if (k < cols.length) s0 = cols[k]; }
    }
    for (let i = i0 - 1; i <= i1; i++) {
      if (((i % 2) + 2) % 2) continue;
      let r0 = null;
      for (let j = j0; j <= j1 + 1; j++) {
        const on = j <= j1 && (has.has(i * 1000 + j) || has.has((i + 1) * 1000 + j));
        if (on && r0 === null) r0 = j;
        if (!on && r0 !== null) { st.push([cx + i * GX + 2.4, cy + r0 * GY - 5.6, 1.2, (j - 1 - r0) * GY + 7.7]); r0 = null; }
      }
    }
    for (const s of st) for (let yy = Math.floor(s[1]); yy <= s[1] + s[3]; yy++) for (let xx = Math.floor(s[0]); xx <= s[0] + s[2]; xx++) occ.add(xx * 4096 + yy);
    if (era >= 4) for (const s of st) if (s[2] > s[3]) for (let x = s[0] + 2.6; x < s[0] + s[2] - 1 && lamps.length < 26; x += GX * 2) lamps.push({ t: 'lamp', x: Math.round(x * 2) / 2, y: s[1] + s[3] + 0.05, v: rng() });
  } else {
    const m = era === 0 ? 4 : 5 + (bucket > 8 ? 2 : 0);
    for (let k = 0; k < m; k++) { const a = k / m * TAU + rng() * 0.7, r1 = maxR + 4, b = (rng() - 0.5) * 0.6; ln.push([Math.cos(a) * r1, Math.sin(a) * r1 * 0.75, Math.cos(a + b) * r1 * 0.5, Math.sin(a + b) * r1 * 0.38]); }
  }
  for (const l of lamps) items.push(l);
  // trees and gardens in the gaps
  const lat = Math.abs(c.lat), tsp = lat > 0.9 ? 1 : lat < 0.36 ? 2 : 0;
  const tMax = Math.round(nb * (era >= 6 ? 0.45 : era >= 4 ? 0.55 : 0.75)) + 5;
  let nt = 0;
  for (let k = 4; k < 800 && nt < tMax; k++) {
    const ang = k * 2.39996 + 1.3, rad = 1.5 + Math.sqrt(k) * 1.2;
    if (rad > hR + 2) break;
    const x = Math.round(cx + Math.cos(ang) * rad + (rng() - 0.5) * 2), y = Math.round(cy + Math.sin(ang) * rad * 0.75 + (rng() - 0.5) * 2);
    if (rng() < 0.3 || !free(x, y, 1, 2)) continue;
    occ.add(x * 4096 + y); occ.add(x * 4096 + y - 1); occ.add(x * 4096 + y - 2);
    const v = rng(); items.push({ t: 'tree', x, y, v, vi: (v < 0.18 ? (tsp === 2 ? 0 : 3) : tsp) * 3 + ((v * 37) | 0) % 3 }); nt++;
  }
  // work spots outside the core
  const farms = [], forests = [], mines = [];
  const R = cityRadius(c);
  for (let k = 0; k < 60 && (farms.length < 14 || forests.length < 6); k++) {
    const ang = rng() * TAU, rad = (maxR + 4) + rng() * Math.max(8, R * PX * 0.8);
    const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
    if (!landAt(x, y)) continue;
    const ci = Math.floor(clamp(y, 0, MH - 1) / PX) * W + Math.floor((((x % MW) + MW) % MW) / PX);
    if (S.farm[ci] > 0.08 && farms.length < 14) farms.push([x, y]);
    else if (S.forest[ci] > 0.25 && forests.length < 6) forests.push([x, y]);
  }
  if (n.mult.mine) for (const r of RES) for (const ci of n.dep[r]) {
    if (mines.length >= 4 || cellDist(ci, c.i) > 2.6 || !isLand(ci)) continue;
    const [mx0, my0] = cellMpx(ci); const hs = hash2(ci, 77);
    const mx = mx0 + ((hs & 7) - 3.5), my = my0 + (((hs >> 3) & 7) - 3.5);
    if (landAt(mx, my)) mines.push([mx, my, r]);
  }
  items.sort((a, b) => a.y - b.y);
  const pz = center ? [center.x + 0.6, center.y + 1.6, grid ? 6.5 : 5.2] : null;
  c.lay = { key, cx, cy, r: maxR, items, homes, labs, factories, patrol, farms, forests, mines, wall, era, st, ln, pz, grid };
  return c.lay;
}

let SPX = 0, SPY = 0, SPZ = 1;
function pr(x, y, w, h, col) {
  const x0 = Math.round(SPX + x * SPZ), y0 = Math.round(SPY + y * SPZ), x1 = Math.round(SPX + (x + w) * SPZ), y1 = Math.round(SPY + (y + h) * SPZ);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}
function shade(hex, k) { const v = parseInt(hex.slice(1), 16); const r = Math.round(((v >> 16) & 255) * k), g = Math.round(((v >> 8) & 255) * k), b = Math.round((v & 255) * k); return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`; }
function sFlag(x, y, col) { pr(x, y - 4, 0.4, 4, '#3a3028'); const wv = Math.sin(animT * 6 + x) > 0 ? 0.3 : 0; pr(x + 0.4, y - 4 + wv, 2.2, 1.2, col); }

/* ---- hex colour helpers (sprite build time only) ---- */
function cRgb(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function cHex(r, g, b) { return '#' + ((1 << 24) | (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255)).toString(16).slice(1); }
function cSh(h, k) { const c = cRgb(h); return k <= 1 ? cHex(c[0] * k, c[1] * k, c[2] * k) : cHex(c[0] + (255 - c[0]) * (k - 1) * 0.5, c[1] + (255 - c[1]) * (k - 1) * 0.5, c[2] + (255 - c[2]) * (k - 1) * 0.5); }
function cMx(a, b, t) { const p = cRgb(a), q = cRgb(b); return cHex(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t); }

/* ---- sprite drawing kit: map-px units, origin = building base centre, y up is negative.
   bM: 0 = measure (bounds, shadows, emitters), 1 = paint day sprite, 2 = paint night lights ---- */
const OBX = 0.5, OBY = 0.42, SHX = 0.62, SHY = 0.27;
let bX = null, bM = 0, bK = 8, bSeed = 0, bLitN = 0, bLitC = 0, bMeta = null;
const bBB = [0, 0, 0, 0], bSH = [], bAO = [];
const LITW = '#ffc96e', LITW2 = '#ffe0a0', LITO = '#e6f0ff', GLASS = '#33404c';
const STONE = ['#aaa396', '#9e988b', '#b5ad9e'], PASTEL = ['#e7c48c', '#e0a383', '#efe2c4', '#d1baa1', '#c6d1c4', '#e9d3a3'], BRICK = ['#a4533b', '#934839', '#b0624a'];
function bbx(x, y) { if (x < bBB[0]) bBB[0] = x; if (y < bBB[1]) bBB[1] = y; if (x > bBB[2]) bBB[2] = x; if (y > bBB[3]) bBB[3] = y; }
function bS(v) { return Math.round(v * bK) / bK; }
function bH(x, y) { return hash2(Math.round(x * 13) + bSeed, Math.round(y * 17) - bSeed) / 4294967296; }
function bR(x, y, w, h, c) {
  if (bM === 0) { bbx(x, y); bbx(x + w, y + h); return; }
  if (bM !== 1) return;
  const x0 = bS(x), y0 = bS(y), m = 1 / bK;
  bX.fillStyle = c; bX.fillRect(x0, y0, Math.max(m, bS(x + w) - x0), Math.max(m, bS(y + h) - y0));
}
function bP(c, p, raw) {
  if (bM === 0) { for (let k = 0; k < p.length; k += 2) bbx(p[k], p[k + 1]); return; }
  if (bM !== 1) return;
  bX.fillStyle = c; bX.beginPath();
  if (raw) { bX.moveTo(p[0], p[1]); for (let k = 2; k < p.length; k += 2) bX.lineTo(p[k], p[k + 1]); }
  else { bX.moveTo(bS(p[0]), bS(p[1])); for (let k = 2; k < p.length; k += 2) bX.lineTo(bS(p[k]), bS(p[k + 1])); }
  bX.closePath(); bX.fill();
}
function bL(x0, y0, x1, y1, t, c) { t = Math.max(t, 0.8 / bK); const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l * t / 2, ny = dx / l * t / 2; bP(c, [x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny], true); }
function bE(cx, cy, rx, ry, c, half) {
  if (bM === 0) { bbx(cx - rx, cy - ry); bbx(cx + rx, half ? cy : cy + ry); return; }
  if (bM !== 1) return;
  bX.fillStyle = c; bX.beginPath(); if (half) bX.ellipse(cx, cy, rx, ry, 0, PI, TAU); else bX.ellipse(cx, cy, rx, ry, 0, 0, TAU); bX.fill();
}
function bHull(p) {
  const n = p.length / 2, ix = []; for (let i = 0; i < n; i++) ix.push(i);
  ix.sort((a, b) => p[2 * a] - p[2 * b] || p[2 * a + 1] - p[2 * b + 1]);
  const cr = (o, a, b) => (p[2 * a] - p[2 * o]) * (p[2 * b + 1] - p[2 * o + 1]) - (p[2 * a + 1] - p[2 * o + 1]) * (p[2 * b] - p[2 * o]);
  const lo = [], up = [];
  for (const i of ix) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
  for (let k = n - 1; k >= 0; k--) { const i = ix[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], i) <= 0) up.pop(); up.push(i); }
  lo.pop(); up.pop(); const out = []; for (const i of lo.concat(up)) out.push(p[2 * i], p[2 * i + 1]); return out;
}
// shadow of any footprint (flat point list at ground level) extruded to elevation e
function bShdP(f, e, ao) {
  if (bM !== 0) return;
  const p = f.slice(); for (let k = 0; k < f.length; k += 2) p.push(f[k] + e * SHX, f[k + 1] + e * SHY);
  bSH.push(bHull(p)); if (ao) bAO.push(bHull(f));
}
function bShd(x, y, w, h, d) { const dx = d * OBX, dy = d * OBY; bShdP([x, 0, x + w, 0, x + w + dx, -dy, x + dx, -dy], h - y, y === 0); }
function bBox(x, y, w, h, d, c, sk, tk) {
  const dx = d * OBX, dy = d * OBY;
  bShd(x, y, w, h, d);
  bR(x, y - h, w, h, c);
  if (d > 0) {
    bP(cSh(c, sk || 0.7), [x + w, y, x + w + dx, y - dy, x + w + dx, y - dy - h, x + w, y - h]);
    bP(cSh(c, tk || 1.14), [x, y - h, x + w, y - h, x + w + dx, y - h - dy, x + dx, y - h - dy]);
  }
  if (bM === 1 && y === 0 && h > 0.7 && bK >= 4 && GFX.detail >= 2) {
    const a = Math.min(h, 1.5), g = bX.createLinearGradient(0, -a, 0, 0); g.addColorStop(0, 'rgba(12,8,4,0)'); g.addColorStop(1, 'rgba(12,8,4,.2)');
    bX.fillStyle = g; bX.fillRect(bS(x), bS(-a), bS(x + w) - bS(x), bS(0) - bS(-a));
    if (d > 0) bP(g, [x + w, 0, x + w + dx, -dy, x + w + dx, -dy - a, x + w, -a]);
  }
}
// box whose front face is a vertical gradient (glass towers)
function bGlass(x, y, w, h, d, c1, c2, mul) {
  const dx = d * OBX, dy = d * OBY;
  bShd(x, y, w, h, d);
  if (bM === 0) { bbx(x, y - h - dy); bbx(x + w + dx, y); return; }
  if (bM !== 1) return;
  let g = bX.createLinearGradient(0, y - h, 0, y); g.addColorStop(0, c1); g.addColorStop(0.55, cMx(c1, c2, 0.6)); g.addColorStop(1, c2);
  bR(x, y - h, w, h, g);
  g = bX.createLinearGradient(0, y - h - dy, 0, y); g.addColorStop(0, cSh(c1, 0.72)); g.addColorStop(1, cSh(c2, 0.55));
  bP(g, [x + w, y, x + w + dx, y - dy, x + w + dx, y - dy - h, x + w, y - h]);
  bP(cSh(c1, 1.2), [x, y - h, x + w, y - h, x + w + dx, y - h - dy, x + dx, y - h - dy]);
  if (mul && bK >= 5) {
    const lc = 'rgba(230,245,255,.28)', dc = 'rgba(10,20,35,.25)';
    for (let xx = x + mul; xx < x + w - 0.1; xx += mul) bR(xx, y - h, 0.07, h, lc);
    for (let yy = y - 1; yy > y - h + 0.2; yy -= 1) { bR(x, yy, w, 0.08, dc); bP(dc, [x + w, yy, x + w + dx, yy - dy, x + w + dx, yy - dy + 0.08, x + w, yy + 0.08], true); }
    bP('rgba(255,255,255,.16)', [x, y - h, x + w * 0.45, y - h, x, y - h + w * 0.9], true);
  }
}
function bWin(x, y, w, h, c, lp, lc) {
  if (bM === 0) { if (lp) bLitN++; return; }
  if (bM === 1) { if (!c) return; bR(x, y, w, h, c); if (bK >= 9 && w * bK >= 4) bR(x, y, w * 0.4, h * 0.3, cSh(c, 1.45)); return; }
  if (lp && bH(x, y) < lp) { const x0 = bS(x), y0 = bS(y); bX.fillStyle = bH(y, x) < 0.3 ? LITW2 : lc; bX.fillRect(x0, y0, Math.max(1 / bK, bS(x + w) - x0), Math.max(1 / bK, bS(y + h) - y0)); bLitC++; }
}
function bDoor(x, yb, w, h, c, lp, lc) { if (bM === 1) bR(x, yb - h, w, h, c); else bWin(x, yb - h, w, h, null, lp, lc); }
function bSwin(xr, yb, d, t0, t1, h0, h1, c, lp, lc) {
  const ax = d * OBX, ay = d * OBY, p = [xr + t0 * ax, yb - t0 * ay - h0, xr + t1 * ax, yb - t1 * ay - h0, xr + t1 * ax, yb - t1 * ay - h1, xr + t0 * ax, yb - t0 * ay - h1];
  if (bM === 0) { if (lp) bLitN++; return; }
  if (bM === 1) { if (c) bP(cSh(c, 0.82), p); return; }
  if (lp && bH(p[0], p[1]) < lp) { const s = bM; bM = 1; bP(lc, p); bM = s; bLitC++; }
}
function bWg(x, yt, w, h, nx, ny, fw, fh, c, lp, lc) {
  const cw = w / nx, ch = h / ny, ww = cw * fw, wh = ch * fh;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) bWin(x + i * cw + (cw - ww) / 2, yt + j * ch + (ch - wh) * 0.45, ww, wh, c, lp, lc);
}
function bSwg(xr, yb, d, h0, h1, nx, ny, fw, fh, c, lp, lc) {
  const ct = 1 / nx, chh = (h1 - h0) / ny;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const t0 = i * ct + ct * (1 - fw) / 2, hb = h0 + j * chh + chh * (1 - fh) * 0.55; bSwin(xr, yb, d, t0, t0 + ct * fw, hb, hb + chh * fh, c, lp, lc); }
}
// emissive strip: drawn in the day sprite and fully lit at night
function bEm(x, y, w, h, c) { if (bM === 0) { bLitN++; bbx(x, y); bbx(x + w, y + h); return; } const s = bM; bM = 1; bR(x, y, w, h, c); bM = s; if (s === 2) bLitC++; }
// light source: a warm pool only in the night layer
function bGlow(x, y, r, c) {
  if (bM === 0) { bLitN++; bbx(x - r, y - r); bbx(x + r, y + r); return; }
  if (bM !== 2) return;
  const g = bX.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c); g.addColorStop(1, 'rgba(255,190,110,0)');
  bX.fillStyle = g; bX.beginPath(); bX.ellipse(x, y, r, r * 0.6, 0, 0, TAU); bX.fill(); bLitC++;
}
function bSmk(x, y, k) { if (bM === 0) bMeta.sm.push([x, y, k || 0]); }
function bFlag(x, y) { if (bM === 0) { bMeta.fl.push([x, y]); bbx(x, y); } }
function bBcn(x, y) { if (bM === 0) bMeta.bc.push([x, y]); }
function bFire(x, y) { if (bM === 0) { bMeta.fi.push([x, y]); bLitN++; bbx(x - 1, y - 1); bbx(x + 1, y + 0.5); } else if (bM === 2) bGlow(x, y - 0.4, 3.2, 'rgba(255,170,80,.75)'); }
// gable roof, ridge parallel to the front; y = wall-top line, wc = wall colour of the gable end
function bGab(x, y, w, d, rh, c, wc, o) {
  o = o === undefined ? 0.3 : o;
  const dx = d * OBX, dy = d * OBY, ry = y - dy / 2 - rh, rx = dx / 2, ey = y + o * 0.45;
  bShd(x - o, y, w + 2 * o, rh * 0.75, d);
  bP(cSh(c, 0.6), [x - o + rx, ry, x + w + o + rx, ry, x + w + o + dx, y - dy, x - o + dx, y - dy]);
  bP(cSh(wc, 0.7), [x + w, y, x + w + dx, y - dy, x + w + rx, ry]);
  bP(c, [x - o, ey, x + w + o, ey, x + w + o + rx, ry, x - o + rx, ry]);
  if (bM === 1) {
    if (bK >= 5) for (let t = 0.2; t < 0.95; t += 0.2) bR(x - o + rx * t, ey + (ry - ey) * t, w + 2 * o, 0.07, cSh(c, 0.8));
    bL(x - o + rx, ry, x + w + o + rx, ry, 0.16, cSh(c, 1.3));
    bL(x + w + o, ey, x + w + o + rx, ry, 0.12, cSh(c, 0.75));
    bR(x, ey, w, 0.28, 'rgba(0,0,0,.2)');
  }
}
// hip / pyramid roof
function bHip(x, y, w, d, rh, c, o) {
  o = o === undefined ? 0.3 : o;
  const dx = d * OBX, dy = d * OBY, ry = y - dy / 2 - rh, rx = dx / 2, ey = y + o * 0.45, a = Math.min(w / 2, d * 0.55);
  bShd(x - o, y, w + 2 * o, rh * 0.7, d);
  bP(cSh(c, 0.6), [x - o + a + rx, ry, x + w + o - a + rx, ry, x + w + o + dx, y - dy, x - o + dx, y - dy]);
  bP(cSh(c, 0.74), [x + w + o, ey, x + w + o + dx, y - dy, x + w - a + rx, ry]);
  bP(c, [x - o, ey, x + w + o, ey, x + w - a + rx, ry, x + a + rx, ry]);
  if (bM === 1) {
    if (bK >= 5) for (let t = 0.2; t < 0.95; t += 0.2) { const xl = x - o + (a + rx + o) * t, xr = x + w + o + (rx - a - o) * t; bR(xl, ey + (ry - ey) * t, Math.max(0.05, xr - xl), 0.07, cSh(c, 0.8)); }
    if (a < w / 2) bL(x + a + rx, ry, x + w - a + rx, ry, 0.16, cSh(c, 1.3));
    bL(x + w + o, ey, x + w - a + rx, ry, 0.12, cSh(c, 1.15));
    bR(x, ey, w, 0.28, 'rgba(0,0,0,.2)');
  }
}
// gable facing the street (ridge runs into the picture)
function bFgab(x, y, w, d, rh, c, wc, o) {
  o = o === undefined ? 0.25 : o;
  const dx = d * OBX, dy = d * OBY, ey = y + o * 0.5;
  bShd(x, y, w, rh * 0.75, d);
  bP(cSh(c, 1.04), [x + w / 2, y - rh, x - o, ey, x - o + dx, ey - dy, x + w / 2 + dx, y - rh - dy]);
  bP(cSh(c, 0.76), [x + w / 2, y - rh, x + w + o, ey, x + w + o + dx, ey - dy, x + w / 2 + dx, y - rh - dy]);
  bP(wc, [x, y, x + w, y, x + w / 2, y - rh]);
  if (bM === 1) {
    bL(x - o, ey, x + w / 2, y - rh - 0.08, 0.3, cSh(c, 0.85)); bL(x + w / 2, y - rh - 0.08, x + w + o, ey, 0.3, cSh(c, 0.7));
    bL(x + w / 2, y - rh - 0.05, x + w / 2 + dx, y - rh - dy - 0.05, 0.14, cSh(c, 1.3));
  }
}
function bCyl(cx, y, r, h, c, ry, noCap) {
  ry = ry || r * 0.42;
  bShdP([cx - r, y, cx - r * 0.7, y - ry * 0.7, cx, y - ry, cx + r * 0.7, y - ry * 0.7, cx + r, y, cx + r * 0.7, y + ry * 0.7, cx, y + ry, cx - r * 0.7, y + ry * 0.7].map((v, k) => k & 1 ? v - y : v), h - y, true);
  if (bM === 0) { bbx(cx - r, y - h - ry); bbx(cx + r, y + ry); return; }
  if (bM !== 1) return;
  const g = bX.createLinearGradient(cx - r, 0, cx + r, 0); g.addColorStop(0, cSh(c, 1.08)); g.addColorStop(0.35, c); g.addColorStop(1, cSh(c, 0.6));
  bX.fillStyle = g; bX.beginPath(); bX.moveTo(cx - r, y - h); bX.lineTo(cx - r, y); bX.ellipse(cx, y, r, ry, 0, PI, 0, true); bX.lineTo(cx + r, y - h); bX.ellipse(cx, y - h, r, ry, 0, 0, PI, true); bX.closePath(); bX.fill();
  if (!noCap) { bX.fillStyle = cSh(c, 1.12); bX.beginPath(); bX.ellipse(cx, y - h, r, ry, 0, 0, TAU); bX.fill(); }
}
function bCone(cx, y, r, rh, c, ry, lines) {
  ry = ry || r * 0.42;
  bShdP([cx - r, 0, cx + r, 0, cx, ry, cx, -ry], (rh - y) * 0.55);
  if (bM === 0) { bbx(cx - r, y - rh); bbx(cx + r, y + ry); return; }
  if (bM !== 1) return;
  const g = bX.createLinearGradient(cx - r, 0, cx + r, 0); g.addColorStop(0, cSh(c, 1.12)); g.addColorStop(0.4, c); g.addColorStop(1, cSh(c, 0.58));
  bX.fillStyle = g; bX.beginPath(); bX.moveTo(cx - r, y); bX.lineTo(cx, y - rh); bX.lineTo(cx + r, y); bX.ellipse(cx, y, r, ry, 0, 0, PI); bX.closePath(); bX.fill();
  if (lines !== false && bK >= 5) {
    bX.strokeStyle = cSh(c, 0.72); bX.lineWidth = Math.max(0.07, 1 / bK);
    bX.beginPath(); for (let k = 1; k < 7; k++) { const a = PI * k / 7; bX.moveTo(cx, y - rh); bX.lineTo(cx + Math.cos(a) * r, y + Math.sin(a) * ry); } bX.stroke();
    bX.beginPath(); for (const f of [0.35, 0.68]) bX.ellipse(cx, y - rh * f, r * (1 - f), ry * (1 - f), 0, 0, PI); bX.stroke();
  }
}
function bDome(cx, y, r, c, hk) {
  hk = hk || 1;
  bShdP([cx - r, 0, cx + r, 0, cx, -r * 0.4, cx, r * 0.3], r * hk - y);
  if (bM === 0) { bbx(cx - r, y - r * hk); bbx(cx + r, y + r * 0.3); return; }
  if (bM !== 1) return;
  const g = bX.createRadialGradient(cx - r * 0.38, y - r * hk * 0.62, r * 0.04, cx, y - r * hk * 0.3, r * 1.3);
  g.addColorStop(0, cSh(c, 1.55)); g.addColorStop(0.42, c); g.addColorStop(1, cSh(c, 0.5));
  bX.fillStyle = g; bX.beginPath(); bX.ellipse(cx, y, r, r * hk, 0, PI, TAU); bX.ellipse(cx, y, r, r * 0.3, 0, 0, PI); bX.closePath(); bX.fill();
  if (bK >= 6) { bX.strokeStyle = cSh(c, 0.7); bX.lineWidth = Math.max(0.06, 0.8 / bK); bX.beginPath(); for (const f of [0.34, 0.7]) bX.ellipse(cx, y, r * f, r * hk, 0, PI, TAU); bX.stroke(); }
}
function bStone(x, yb, w, h) {
  if (bM !== 1 || bK < 6) return;
  const m = 'rgba(40,34,28,.22)', lt = 'rgba(255,250,235,.12)';
  for (let r = 0, yy = yb - 0.45; yy > yb - h + 0.05; yy -= 0.45, r++) {
    bR(x, yy, w, 0.05, m);
    for (let xx = x + (r & 1 ? 0.35 : 0.75); xx < x + w - 0.2; xx += 0.8 + bH(xx, yy) * 0.4) { bR(xx, yy - 0.45, 0.05, 0.45, m); if (bH(yy, xx) < 0.2) bR(xx + 0.05, yy - 0.4, 0.5, 0.35, lt); }
  }
}
function bBrick(x, yb, w, h) {
  if (bM !== 1 || bK < 8) return;
  const m = 'rgba(240,225,205,.16)';
  for (let yy = yb - 0.28; yy > yb - h + 0.05; yy -= 0.28) bR(x, yy, w, 0.04, m);
}
function bTimber(x, yb, w, h, fl, c) {
  c = c || '#5a3c29'; const t = 0.16, fh = h / fl;
  bR(x, yb - h, t, h, c); bR(x + w - t, yb - h, t, h, c); bR(x + w / 2 - t / 2, yb - h, t, h, c);
  for (let f = 0; f <= fl; f++) bR(x, yb - f * fh - (f === fl ? 0 : t / 2), w, t, c);
  for (let f = 1; f < fl + 1; f++) if (f > 0 || fl === 1) { const y0 = yb - (f - 1) * fh, y1 = yb - f * fh; if (f > 1 || fl === 1) { bL(x + 0.1, y0, x + w / 2 - 0.1, y1, 0.13, c); bL(x + w - 0.1, y0, x + w / 2 + 0.1, y1, 0.13, c); } }
}
function bAwn(x, y, w, c) { // striped awning sticking out of a facade
  bP(c, [x, y, x + w, y, x + w + 0.15, y + 0.55, x - 0.15, y + 0.55]);
  if (bM === 1) for (let k = 0; k < w; k += 0.5) bP('rgba(255,255,255,.6)', [x + k, y, x + k + 0.25, y, x + k + 0.3, y + 0.55, x + k + 0.05 - 0.1, y + 0.55]);
}
function bTree(x, y, s, sp, v) {
  if (sp === 1) {
    bShdP([x - 0.9 * s, 0, x + 0.9 * s, 0, x, 0.4 * s, x, -0.4 * s].map((q, k) => k & 1 ? q + y : q), 3.6 * s);
    bR(x - 0.12 * s, y - 0.7 * s, 0.24 * s, 0.7 * s, '#5a3e26');
    const g = cMx('#2c5a38', '#3c6a3a', v);
    for (let k = 0; k < 3; k++) { const yy = y - 0.5 * s - k * 0.95 * s, ww = (1.1 - k * 0.28) * s; bP(cSh(g, 1 + k * 0.06), [x - ww, yy, x + ww, yy, x, yy - 1.6 * s]); bP(cSh(g, 0.72), [x + ww * 0.15, yy, x + ww, yy, x, yy - 1.6 * s]); }
  } else if (sp === 2) {
    bShdP([x - 0.9 * s, y, x + 0.9 * s, y, x, y - 0.4 * s, x, y + 0.4 * s], 3.4 * s);
    const tx = x + 0.5 * s, ty = y - 3.2 * s;
    bL(x, y, x + 0.25 * s, y - 1.6 * s, 0.24 * s, '#7a5c3a'); bL(x + 0.25 * s, y - 1.6 * s, tx, ty, 0.2 * s, '#866444');
    for (let k = 0; k < 7; k++) { const a = PI + k / 6 * PI, l = 1.5 * s; bL(tx, ty, tx + Math.cos(a) * l, ty + Math.sin(a) * l * 0.55 + 0.5 * s, 0.32 * s, cSh('#3f7a3a', 0.85 + (k % 3) * 0.12)); }
    bE(tx, ty, 0.25 * s, 0.2 * s, '#5a4a2a');
  } else if (sp === 3) {
    bShdP([x - 0.6 * s, y, x + 0.6 * s, y, x, y - 0.3 * s, x, y + 0.3 * s], 3.8 * s);
    bR(x - 0.1 * s, y - 0.5 * s, 0.2 * s, 0.5 * s, '#5a3e26');
    bE(x, y - 2.2 * s, 0.65 * s, 1.9 * s, '#2f5a34'); bE(x - 0.18 * s, y - 2.5 * s, 0.32 * s, 1.4 * s, '#3f7040');
  } else {
    const g = sp === 4 ? cMx('#e8a2b8', '#f2c4d0', v) : cMx('#3d6e32', '#5a8a3a', v);
    bShdP([x - 1.2 * s, y, x + 1.2 * s, y, x, y - 0.5 * s, x, y + 0.5 * s], 2.8 * s);
    bR(x - 0.14 * s, y - 1.2 * s, 0.28 * s, 1.2 * s, '#5e432a');
    bE(x + 0.15 * s, y - 1.9 * s, 1.25 * s, 1.05 * s, cSh(g, 0.7)); bE(x - 0.2 * s, y - 2.15 * s, 1.0 * s, 0.85 * s, g);
    bE(x - 0.45 * s, y - 2.45 * s, 0.5 * s, 0.42 * s, cSh(g, 1.25));
  }
}
const hX = (w, d) => -(w + d * OBX) / 2;   // left edge that centres a box's visual mass on the anchor
const rY = (y, d, rh) => y - d * OBY / 2 - rh;   // ridge line of a roof

/* ---- houses, by era ---- */
function hE0(vi, hc, col) {
  if (vi < 2) {
    const r = vi ? 1.9 : 1.55, wh = vi ? 1.25 : 1.05, rh = vi ? 2.6 : 2.15;
    bCyl(0, 0, r, wh, '#9a7249', 0, true);
    if (bM === 1 && bK >= 6) for (let k = 0; k < 6; k++) bR(-r + 0.3 + k * r / 3, -wh + 0.25 + (k % 2) * 0.35, 0.4, 0.07, 'rgba(60,40,20,.3)');
    bDoor(-0.38, 0.35, 0.76, 1.0, '#2c1c10', 0.75, '#ffad55');
    bCone(0, -wh, r + 0.38, rh, vi ? '#c39a4c' : '#cba556');
    bR(-0.06, -wh - rh - 0.75, 0.12, 0.85, '#4e3622'); bR(0.06, -wh - rh - 0.75, 0.62, 0.36, col);
    if (vi) bSmk(0.25, -wh - rh + 0.3);
  } else if (vi === 2) {
    bCyl(0, 0, 1.75, 1.05, '#dcd0b2', 0, true); bR(-1.75, -0.8, 3.5, 0.26, col);
    bDoor(-0.4, 0.45, 0.8, 0.95, '#5a3a22', 0.6, '#ffad55');
    bCone(0, -1.05, 1.95, 1.2, '#cbb994', 0, false);
    bE(0, -2.2, 0.3, 0.12, '#5a4a36');
  } else {
    const w = 4.6, d = 2.4, x = hX(w, d);
    bBox(x, 0, w, 1.2, d, '#8a6644');
    for (let k = 0.3; k < 1.2; k += 0.3) bR(x, -k, w, 0.07, '#6c4e33');
    bDoor(x + w / 2 - 0.36, 0, 0.72, 0.95, '#2c1c10', 0.75, '#ffad55');
    bGab(x, -1.2, w, d, 1.75, '#c39c50', '#8a6644', 0.42);
    bR(x + w / 2 - 0.3, rY(-1.2, d, 1.75) - 0.2, 0.6, 0.25, col);
    bSmk(x + w * 0.7 + d * OBX * 0.5, rY(-1.2, d, 1.75));
  }
}
function hE1(vi, hc, col) {
  const rc = cMx('#b9603f', col, 0.3), dk = '#3a2a1c';
  if (vi === 0) {
    const w = 3.2, d = 2.6, h = 2.3, x = hX(w, d), c = '#d5bb8d';
    bBox(x, 0, w, h, d, c); bBox(x - 0.08, -h, w + 0.16, 0.26, d, '#e0c99d');
    bBox(x + w - 1.25 + 1.4 * OBX, -h - 0.26 - 1.4 * OBY, 0.9, 0.75, 0.9, '#cdb183');
    bR(x + 0.35 + 0.6 * OBX, -h - 0.26 - 0.6 * OBY - 0.9, 0.08, 0.9, '#6a4a2a'); bR(x + 0.43 + 0.6 * OBX, -h - 0.26 - 0.6 * OBY - 0.9, 1.0, 0.3, col);
    bWin(x + 0.42, -h + 0.65, 0.55, 0.5, dk, 0.5, LITW); bWin(x + w - 0.97, -h + 0.65, 0.55, 0.5, dk, 0.5, LITW);
    bDoor(x + w / 2 - 0.4, 0, 0.8, 1.25, '#4a3220', 0.3, LITW);
    bSwg(x + w, 0, d, 0.9, h - 0.4, 2, 1, 0.45, 0.6, dk, 0.4, LITW);
  } else if (vi === 1) {
    const w = 3.4, d = 2.8, x = hX(w, d), c = '#d1b385';
    bBox(x, 0, w, 1.8, d, c);
    bBox(x + 0.25 + 1.3 * OBX, -1.8 - 1.3 * OBY, 2.0, 1.35, 1.4, '#dac093');
    bWin(x + 0.5 + 1.3 * OBX, -1.8 - 1.3 * OBY - 1.0, 0.45, 0.45, dk, 0.5, LITW); bWin(x + 1.5 + 1.3 * OBX, -1.8 - 1.3 * OBY - 1.0, 0.45, 0.45, dk, 0.5, LITW);
    bDoor(x + 0.6, 0, 0.75, 1.15, '#4a3220', 0.4, LITW); bWin(x + 2.2, -1.35, 0.5, 0.5, dk, 0.5, LITW);
    bAwn(x + 0.35, -1.45, 1.3, col);
  } else if (vi === 2) {
    const w = 3.4, d = 2.6, h = 2.0, x = hX(w, d), c = '#ebe2cf';
    bBox(x, 0, w, h, d, c);
    bWin(x + 0.45, -h + 0.55, 0.5, 0.6, dk, 0.5, LITW); bWin(x + w - 0.95, -h + 0.55, 0.5, 0.6, dk, 0.5, LITW);
    bDoor(x + w / 2 - 0.38, 0, 0.76, 1.2, '#6a4a2c', 0.3, LITW);
    bSwg(x + w, 0, d, 0.7, h - 0.3, 2, 1, 0.4, 0.6, dk, 0.4, LITW);
    bGab(x, -h, w, d, 1.2, rc, c, 0.32);
  } else {
    const w = 3.9, d = 3.0, h = 1.9, x = hX(w, d), c = '#e6dac2';
    bBox(x, 0, w, h, d, c);
    bR(x + 0.25, -h + 0.3, w - 0.5, h - 0.3, '#a8977a');
    bDoor(x + w / 2 - 0.4, 0, 0.8, 1.2, '#4a3220', 0.5, LITW);
    for (let k = 0; k < 5; k++) { bR(x + 0.2 + k * (w - 0.6) / 4, -h + 0.25, 0.22, h - 0.25, '#f4eee0'); bR(x + 0.2 + k * (w - 0.6) / 4 + 0.15, -h + 0.25, 0.07, h - 0.25, '#cfc4ad'); }
    bR(x - 0.05, -h, w + 0.1, 0.3, '#f2ead8');
    bHip(x, -h, w, d, 1.1, rc, 0.3);
  }
}
function hE2(vi, hc, col) {
  const rc = cMx(col, '#48434b', 0.5), st = STONE[vi % 3], gl = '#2e3036';
  if (vi === 0) {
    const w = 3.6, d = 2.6, h = 2.0, x = hX(w, d);
    bBox(x, 0, w, h, d, st); bStone(x, 0, w, h);
    bWin(x + 0.5, -h + 0.6, 0.5, 0.6, gl, 0.55, LITW); bWin(x + w - 1.0, -h + 0.6, 0.5, 0.6, gl, 0.55, LITW);
    bDoor(x + w / 2 - 0.38, 0, 0.76, 1.2, '#4a3426', 0.2, LITW);
    bGab(x, -h, w, d, 1.7, rc, st, 0.3);
    const cxp = x + w - 0.75 + d * OBX * 0.5, ry = rY(-h, d, 1.7);
    bBox(cxp, ry + 0.45, 0.5, 1.25, 0.4, '#8c8478'); bSmk(cxp + 0.35, ry - 0.9);
  } else if (vi === 1) {
    const w = 2.6, d = 2.6, h = 4.2, x = hX(w, d);
    bBox(x, 0, w, h, d, st); bStone(x, 0, w, h);
    for (const yy of [-1.6, -3.0]) bWin(x + w / 2 - 0.12, yy, 0.24, 0.7, '#1e2026', 0.5, LITW);
    bWin(x + 0.4, -3.4, 0.45, 0.55, gl, 0.6, LITW);
    bDoor(x + w / 2 - 0.4, 0, 0.8, 1.2, '#4a3426', 0.2, LITW);
    bSwg(x + w, 0, d, 1.5, h - 0.6, 1, 2, 0.3, 0.45, '#1e2026', 0.4, LITW);
    bHip(x, -h, w, d, 2.0, rc, 0.25);
  } else if (vi === 2) {
    const w = 3.0, d = 2.6, x = hX(w, d), pl = '#ece0c6';
    bBox(x, 0, w, 1.5, d, st); bStone(x, 0, w, 1.5);
    bDoor(x + 0.4, 0, 0.75, 1.15, '#4a3426', 0.2, LITW); bWin(x + 1.8, -1.2, 0.6, 0.55, gl, 0.5, LITW);
    bBox(x - 0.25, -1.5, w + 0.5, 1.6, d + 0.2, pl); bTimber(x - 0.25, -1.5, w + 0.5, 1.6, 1);
    bWin(x + 0.25, -2.75, 0.55, 0.6, gl, 0.55, LITW); bWin(x + w - 0.8, -2.75, 0.55, 0.6, gl, 0.55, LITW);
    bR(x - 0.25, -1.5, w + 0.5, 0.2, 'rgba(0,0,0,.25)');
    bGab(x - 0.25, -3.1, w + 0.5, d + 0.2, 1.9, rc, pl, 0.3);
  } else {
    const w = 3.4, d = 2.8, h = 3.0, x = hX(w, d), c = '#b3ab9c';
    bBox(x, 0, w, h, d, c); bStone(x, 0, w, h);
    bWg(x + 0.2, -h + 0.25, w - 0.4, h - 1.5, 2, 1, 0.38, 0.62, gl, 0.55, LITW);
    bWin(x + 0.55, -1.15, 0.45, 0.55, gl, 0.5, LITW); bDoor(x + w - 1.25, 0, 0.75, 1.25, '#4a3426', 0.2, LITW);
    bSwg(x + w, 0, d, 0.7, h - 0.3, 2, 2, 0.4, 0.5, gl, 0.4, LITW);
    bHip(x, -h, w, d, 1.5, rc, 0.3);
  }
}
function hE3(vi, hc, col) {
  const rc = cMx('#a94a35', col, 0.3), pl = '#efe5cf', gl = '#3a4552';
  if (vi === 0) {
    const w = 3.0, d = 3.0, h = 3.4, x = hX(w, d);
    bBox(x, 0, w, h, d, pl); bTimber(x, 0, w, h, 2);
    bWg(x + 0.15, -h + 0.15, w - 0.3, 1.5, 2, 1, 0.42, 0.6, gl, 0.6, LITW); bWin(x + 0.45, -1.25, 0.55, 0.55, gl, 0.5, LITW);
    bDoor(x + w - 1.15, 0, 0.7, 1.25, '#5a3a26', 0.2, LITW);
    bSwg(x + w, 0, d, 0.5, h - 0.3, 2, 2, 0.38, 0.5, gl, 0.45, LITW);
    bFgab(x, -h, w, d, 2.3, rc, pl, 0.25);
    bR(x + w / 2 - 0.08, -h - 2.1, 0.16, 2.1, '#5a3c29'); bR(x + 0.5, -h - 0.85, w - 1.0, 0.15, '#5a3c29'); bWin(x + w / 2 - 0.25, -h - 1.5, 0.5, 0.5, gl, 0.5, LITW);
    const cxp = x + w * 0.78 + d * OBX * 0.55, cyp = -h - d * OBY * 0.55 - 0.9;
    bBox(cxp, cyp, 0.45, 1.3, 0.4, '#8a5a44'); bSmk(cxp + 0.3, cyp - 1.5);
  } else if (vi === 1) {
    const w = 2.8, d = 3.0, h = 4.4, x = hX(w, d), br = '#9b5643';
    bBox(x, 0, w, h, d, br); bBrick(x, 0, w, h);
    bP(cSh(rc, 0.72), [x + w, -h, x + w + d * OBX, -h - d * OBY, x + w / 2 + d * OBX, -h - 2.2 - d * OBY, x + w / 2, -h - 2.2]);
    for (let k = 0; k < 4; k++) bR(x + k * 0.35, -h - (k + 1) * 0.55, w - k * 0.7, 0.57, br);
    for (let k = 0; k < 4; k++) bR(x + k * 0.35 - 0.05, -h - (k + 1) * 0.55, w - k * 0.7 + 0.1, 0.1, '#e8dccb');
    for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) { bR(x + 0.38 + i * 1.2, -h + 0.35 + j * 1.35, 0.85, 0.95, '#efe6d6'); bWin(x + 0.46 + i * 1.2, -h + 0.43 + j * 1.35, 0.69, 0.79, gl, 0.6, LITW); }
    bWin(x + w / 2 - 0.25, -h - 1.45, 0.5, 0.5, gl, 0.4, LITW); bR(x + w / 2 - 0.06, -h - 2.45, 0.12, 0.5, '#4a3020');
    bSwg(x + w, 0, d, 0.5, h - 0.3, 2, 3, 0.4, 0.55, gl, 0.4, LITW);
    bShd(x, 0, w, h + 2.2, d);
  } else if (vi === 2) {
    const w = 3.2, d = 3.0, h = 4.2, x = hX(w, d), c = PASTEL[(bSeed >>> 3) % 6];
    bBox(x, 0, w, h, d, c);
    bR(x, -1.4, w, 0.12, cSh(c, 0.85)); bR(x - 0.1, -h, w + 0.2, 0.28, cSh(c, 1.2));
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const wx = x + 0.55 + i * 1.45, wy = -h + 0.55 + j * 1.35; bWin(wx, wy, 0.55, 0.85, gl, 0.6, LITW); if (bK >= 6) { bR(wx - 0.22, wy, 0.2, 0.85, '#4d7656'); bR(wx + 0.57, wy, 0.2, 0.85, '#4d7656'); } }
    bDoor(x + w / 2 - 0.4, 0, 0.8, 1.2, '#5a3a26', 0.25, LITW); bE(x + w / 2, -1.2, 0.4, 0.3, '#5a3a26', true);
    bSwg(x + w, 0, d, 0.5, h - 0.4, 2, 3, 0.36, 0.55, gl, 0.4, LITW);
    bHip(x, -h, w, d, 1.3, rc, 0.3);
  } else {
    const w = 3.0, d = 2.8, x = hX(w, d), sc = '#d9cdb5';
    bBox(x, 0, w, 1.5, d, sc); bStone(x, 0, w, 1.5); bDoor(x + 0.35, 0, 0.75, 1.2, '#5a3a26', 0.25, LITW); bWin(x + 1.75, -1.2, 0.7, 0.6, gl, 0.6, LITW);
    bBox(x - 0.2, -1.5, w + 0.4, 1.4, d + 0.1, pl); bTimber(x - 0.2, -1.5, w + 0.4, 1.4, 1); bWg(x - 0.1, -2.75, w + 0.2, 1.0, 2, 1, 0.42, 0.65, gl, 0.6, LITW);
    bBox(x - 0.4, -2.9, w + 0.8, 1.3, d + 0.2, pl); bTimber(x - 0.4, -2.9, w + 0.8, 1.3, 1); bWg(x - 0.3, -4.1, w + 0.6, 0.9, 3, 1, 0.42, 0.65, gl, 0.6, LITW);
    bR(x - 0.2, -1.5, w + 0.4, 0.18, 'rgba(0,0,0,.25)'); bR(x - 0.4, -2.9, w + 0.8, 0.18, 'rgba(0,0,0,.25)');
    bGab(x - 0.4, -4.2, w + 0.8, d + 0.2, 1.8, rc, pl, 0.3);
  }
}
function hE4(vi, hc, col) {
  const sl = cMx('#4d545e', col, 0.18), tr = '#e6dccb', gl = '#3c4a58', br = BRICK[vi % 3];
  if (vi === 0) {
    const w = 3.4, d = 3.0, h = 3.9, x = hX(w, d);
    bBox(x, 0, w, h, d, br); bBrick(x, 0, w, h);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const wx = x + 0.5 + i * 1.6, wy = -h + 0.45 + j * 1.3; bR(wx - 0.08, wy - 0.15, 0.81, 0.15, tr); bWin(wx, wy, 0.65, 0.85, gl, 0.6, LITW); }
    bWin(x + 0.5, -1.3, 0.65, 0.8, gl, 0.55, LITW); bDoor(x + 2.1, 0, 0.7, 1.35, '#2a3036', 0.3, LITW); bR(x + 1.95, -0.2, 1.0, 0.2, '#b8b0a2');
    bSwg(x + w, 0, d, 0.5, h - 0.3, 2, 3, 0.36, 0.55, gl, 0.45, LITW);
    bGab(x, -h, w, d, 1.1, sl, br, 0.2);
    const ry = rY(-h, d, 1.1);
    for (const fx of [0.35, w - 0.85]) { bBox(x + fx + d * OBX / 2, ry + 0.35, 0.5, 1.1, 0.35, cSh(br, 0.9)); bR(x + fx + d * OBX / 2 + 0.08, ry - 0.95, 0.12, 0.2, '#6a4a3a'); bR(x + fx + d * OBX / 2 + 0.3, ry - 0.95, 0.12, 0.2, '#6a4a3a'); bSmk(x + fx + d * OBX / 2 + 0.3, ry - 1.0); }
  } else if (vi === 1) {
    const w = 3.8, d = 3.0, h = 5.6 + hc * 1.2, x = hX(w, d), fl = Math.round(h / 1.1);
    bBox(x, 0, w, h, d, br); bBrick(x, 0, w, h);
    bWg(x + 0.15, -h + 0.4, w - 0.3, h - 1.6, 3, fl - 1, 0.45, 0.6, gl, 0.55, LITW);
    bR(x, -1.2, w, 1.2, cSh(br, 0.8)); bWin(x + 0.3, -1.0, 1.2, 0.75, gl, 0.7, LITW); bDoor(x + 2.0, 0, 0.7, 1.05, '#2a3036', 0.3, LITW); bWin(x + 2.9, -1.0, 0.7, 0.75, gl, 0.7, LITW);
    bSwg(x + w, 0, d, 1.2, h - 0.4, 2, fl - 1, 0.4, 0.55, gl, 0.45, LITW);
    bBox(x - 0.12, -h, w + 0.24, 0.35, d + 0.1, cSh(br, 1.25));
    if (bK >= 6) for (let k = 0; k < fl - 2; k++) { const yy = -h + 1.5 + k * ((h - 1.6) / (fl - 1)); bR(x + w - 1.25, yy, 1.0, 0.07, '#22262a'); bL(x + w - 1.2, yy, x + w - 0.35, yy + (h - 1.6) / (fl - 1), 0.07, '#22262a'); }
    const tx = x + 1.0 + 1.6 * OBX, ty = -h - 0.35 - 1.6 * OBY;
    bR(tx - 0.55, ty - 1.0, 0.1, 1.0, '#3a2e26'); bR(tx + 0.45, ty - 1.0, 0.1, 1.0, '#3a2e26');
    bCyl(tx, ty - 1.0, 0.65, 1.1, '#8a6a4a', 0.25, true); bCone(tx, ty - 2.1, 0.75, 0.55, '#5a4a3e', 0.28, false);
  } else if (vi === 2) {
    const w = 3.4, d = 3.0, h = 3.4, x = hX(w, d), c = '#7d5240';
    bBox(x, 0, w, h, d, c); bBrick(x, 0, w, h);
    bWg(x + 0.2, -h + 0.35, w - 0.4, h - 1.6, 2, 2, 0.4, 0.62, gl, 0.55, LITW);
    bR(x + 0.25, -0.25, 1.5, 0.25, '#a89c8a'); bR(x + 0.35, -0.5, 1.3, 0.25, '#b8ac9a'); bDoor(x + 0.65, -0.5, 0.7, 1.05, '#2a2420', 0.3, LITW); bWin(x + 2.1, -1.2, 0.75, 0.75, gl, 0.6, LITW);
    bSwg(x + w, 0, d, 0.5, h - 0.3, 2, 2, 0.38, 0.55, gl, 0.45, LITW);
    bR(x - 0.1, -h, w + 0.2, 0.22, cSh(c, 1.3));
    const mh = 1.5, mx = 0.45;
    bP(cSh(sl, 0.7), [x + w + 0.1, -h, x + w + 0.1 + d * OBX, -h - d * OBY, x + w - mx + d * OBX, -h - mh - d * OBY, x + w - mx, -h - mh]);
    bP(cSh(sl, 1.15), [x + mx, -h - mh, x + w - mx, -h - mh, x + w - mx + d * OBX, -h - mh - d * OBY, x + mx + d * OBX, -h - mh - d * OBY]);
    bP(sl, [x - 0.1, -h, x + w + 0.1, -h, x + w - mx, -h - mh, x + mx, -h - mh]);
    bShd(x, -h, w, mh, d);
    for (const fx of [0.75, 2.05]) { bR(x + fx, -h - 1.15, 0.6, 0.8, '#e2d8c6'); bWin(x + fx + 0.12, -h - 1.0, 0.36, 0.6, gl, 0.5, LITW); bP(cSh(sl, 0.85), [x + fx - 0.1, -h - 1.15, x + fx + 0.7, -h - 1.15, x + fx + 0.3, -h - 1.55]); }
  } else {
    const w = 3.8, d = 3.0, h = 3.2, x = hX(w, d);
    bBox(x, 0, w, h, d, br); bBrick(x, 0, w, h);
    bR(x, -1.45, w, 1.45, '#3a3430'); bWin(x + 0.25, -1.25, 1.4, 0.95, '#56636e', 0.85, LITW2); bWin(x + 2.6, -1.25, 0.95, 0.95, '#56636e', 0.85, LITW2); bDoor(x + 1.85, 0, 0.6, 1.2, '#22262a', 0.5, LITW);
    bR(x, -1.75, w, 0.3, col); bAwn(x + 0.1, -1.45, 1.6, col); bAwn(x + 2.5, -1.45, 1.2, col);
    bWg(x + 0.2, -h + 0.3, w - 0.4, 1.3, 3, 1, 0.42, 0.62, gl, 0.55, LITW);
    bSwg(x + w, 0, d, 1.6, h - 0.3, 2, 1, 0.38, 0.6, gl, 0.45, LITW);
    bBox(x - 0.1, -h, w + 0.2, 0.3, d + 0.05, cSh(br, 1.25));
  }
}
function hE5(vi, hc, col) {
  const H = [4.6, 6.6, 9, 12][hc], gl = '#4e6478';
  if (vi === 3 && hc <= 1) {
    const w = 4.2, d = 3.0, h = 1.9, x = hX(w, d);
    bBox(x, 0, w, h, d, '#efede6');
    bWin(x + 0.3, -1.6, 2.2, 1.25, '#5d7a90', 0.8, LITW2); bDoor(x + 3.0, 0, 0.7, 1.3, '#6a5040', 0.3, LITW);
    bSwg(x + w, 0, d, 0.4, h - 0.3, 2, 1, 0.5, 0.6, '#5d7a90', 0.5, LITW);
    bBox(x - 0.35, -h, w + 0.7, 0.22, d + 0.4, '#77736c');
    bTree(x + w + 1.4, 0.4, 0.75, 0, 0.5);
    return;
  }
  if (vi === 0 || vi === 3) {
    const w = 4.2, d = 3.2, x = hX(w, d), c = vi ? '#d8d0c0' : '#cdc7bb', fl = Math.round(H / 1.05);
    bBox(x, 0, w, H, d, c);
    for (let f = 0; f < fl; f++) { const yy = -H + 0.35 + f * (H - 0.4) / fl; bR(x + 0.2, yy, w - 0.4, 0.5, '#5a6876'); if (bK >= 5) bR(x + 0.15, yy + 0.5, w - 0.3, 0.12, cSh(c, 1.15)); }
    bWg(x + 0.2, -H + 0.35, w - 0.4, H - 0.4, 4, fl, 0.8, 0.5, null, 0.55, LITW2);
    bSwg(x + w, 0, d, 0.3, H - 0.1, 3, fl, 0.7, 0.45, gl, 0.45, LITW2);
    if (vi) bR(x + w - 0.5, -H, 0.3, H, col);
    bBox(x + 0.6 + 1.2 * OBX, -H - 1.2 * OBY, 1.4, 0.8, 1.0, cSh(c, 0.92));
  } else if (vi === 1) {
    const w = 3.6, d = 3.0, h = H + 1, x = hX(w, d), fl = Math.round(h / 1.1), c = '#e9e7e1';
    bBox(x, 0, w, h, d, c);
    for (let f = 1; f < fl; f++) { const yy = -h + 0.3 + (f - 1) * (h - 1.2) / (fl - 1); bR(x, yy, w, 0.55, '#4f6a82'); bP(cSh('#4f6a82', 0.8), [x + w, yy, x + w + d * OBX, yy - d * OBY, x + w + d * OBX, yy - d * OBY + 0.55, x + w, yy + 0.55]); }
    bWg(x, -h + 0.3, w, h - 1.2, 5, fl - 1, 0.86, 0.5, null, 0.55, LITO);
    bR(x + 0.15, -1.0, w - 0.3, 1.0, '#2e343a'); for (let k = 0; k < 4; k++) bR(x + 0.3 + k * (w - 0.8) / 3, -1.0, 0.2, 1.0, '#d6d2ca');
    bWin(x + 1.3, -0.85, 1.0, 0.75, null, 0.7, LITW2);
  } else {
    const w = 3.8, d = 3.0, h = Math.max(4.2, H * 0.8), x = hX(w, d), c = '#9e6a52', fl = Math.round(h / 1.1);
    bBox(x, 0, w, h, d, c); bBrick(x, 0, w, h);
    bWg(x + 0.2, -h + 0.35, w - 0.4, h - 0.5, 3, fl, 0.5, 0.58, gl, 0.55, LITW);
    bSwg(x + w, 0, d, 0.3, h - 0.2, 2, fl, 0.45, 0.55, gl, 0.45, LITW);
    bBox(x - 0.1, -h, w + 0.2, 0.25, d, '#c8c0b2');
    bCyl(x + 1.0 + 1.5 * OBX, -h - 0.25 - 1.5 * OBY, 0.55, 0.9, '#b0aaa0', 0.22);
  }
}
function hE6(vi, hc, col) {
  const H = [7, 10, 14, 18][hc];
  if (vi === 0) {
    const w = 3.6, d = 3.0, x = hX(w, d), h1 = H * 0.86;
    bGlass(x, 0, w, h1, d, '#a6d2ee', '#3a6d9a', 0.6);
    bWg(x, -h1 + 0.2, w, h1 - 0.3, 6, Math.round(h1), 0.82, 0.62, null, 0.45, LITO);
    bSwg(x + w, 0, d, 0.1, h1 - 0.1, 4, Math.round(h1), 0.8, 0.6, null, 0.35, LITO);
    bGlass(x + 0.5 + 0.5 * OBX, -h1 - 0.5 * OBY, w - 1.0, H - h1, d - 1.0, '#c4e4f6', '#5d8fb8', 0.6);
    const ax = x + w / 2 + d * OBX / 2, ay = -H - d * OBY / 2;
    bR(ax - 0.06, ay - 2.2, 0.12, 2.4, '#c8d0d8'); bBcn(ax, ay - 2.2);
  } else if (vi === 1) {
    const w = 3.4, d = 3.0, x = hX(w, d), c = '#2f3c4a';
    bGlass(x, 0, w, H, d, '#4a5e72', '#25303c', 0);
    for (let k = 0; k < 6; k++) bR(x + 0.25 + k * (w - 0.5) / 5, -H, 0.12, H, '#8a9aaa');
    bWg(x + 0.3, -H + 1.4, w - 0.6, H - 1.8, 5, Math.round(H * 1.1), 0.7, 0.6, null, 0.5, LITO);
    bSwg(x + w, 0, d, 0.3, H - 1.5, 3, Math.round(H * 1.1), 0.7, 0.6, null, 0.4, LITO);
    bEm(x, -H + 0.25, w, 0.25, col); bEm(x, -H + 0.85, w, 0.12, cSh(col, 1.3));
    bBox(x - 0.1, -H, w + 0.2, 0.18, d + 0.1, c);
  } else if (vi === 2) {
    const ws = [4.0, 3.0, 2.0], hs = [0.5, 0.3, 0.2]; let y = 0, x0 = hX(4.0, 3.0);
    for (let k = 0; k < 3; k++) {
      const w = ws[k], d = 3.0 - k * 0.6, h = H * hs[k], x = x0 + (4.0 - w) / 2 + (3.0 - d) * OBX / 2;
      bGlass(x, y, w, h, d, '#9fded8', '#2f7f88', 0.55);
      bWg(x, y - h + 0.2, w, h - 0.3, Math.round(w * 1.6), Math.max(1, Math.round(h)), 0.8, 0.6, null, 0.45, LITO);
      bR(x - 0.05, y - h, w + 0.1, 0.15, '#e4f2f2');
      y -= h;
    }
    bBcn(x0 + 2.0 + 0.9 * OBX, y - 0.5 * OBY);
  } else {
    const w = 4.0, d = 3.2, h = Math.max(4.5, H * 0.55), x = hX(w, d), fl = Math.round(h / 1.0);
    bBox(x, 0, w, h, d, '#d2d6d8');
    for (let f = 0; f < fl; f++) bR(x, -h + 0.25 + f * (h - 0.4) / fl, w, 0.55, '#4b7f9c');
    bWg(x, -h + 0.25, w, h - 0.4, 6, fl, 0.85, 0.55, null, 0.5, LITO);
    bSwg(x + w, 0, d, 0.15, h - 0.15, 4, fl, 0.8, 0.5, '#4b7f9c', 0.45, LITO);
    bP('#6a9a4a', [x + 0.15, -h, x + w - 0.15, -h, x + w - 0.15 + d * OBX, -h - d * OBY, x + 0.15 + d * OBX, -h - d * OBY]);
    bTree(x + 1.0 + 1.5 * OBX, -h - 1.5 * OBY, 0.5, 0, 0.3); bTree(x + 2.6 + 1.0 * OBX, -h - 1.0 * OBY, 0.45, 0, 0.7);
  }
}
function hE7(vi, hc, col) {
  const H = [9, 12, 16, 20][hc], wh = '#eef3f5', cy = '#5fe6f0';
  if (vi === 0) {
    const w = 3.4, d = 3.0, x = hX(w, d);
    bBox(x, 0, w, H, d, wh, 0.78);
    bE(x + w / 2 + d * OBX / 2, -H - d * OBY / 2, w / 2 + d * OBX / 2, 1.3, cSh(wh, 1.05), true);
    bWg(x + 0.3, -H + 0.5, w - 0.6, H - 1, 4, Math.round(H / 1.2), 0.75, 0.5, '#7aa6b8', 0.45, LITO);
    for (let yy = -2.5; yy > -H + 1; yy -= 3) { bEm(x, yy, w, 0.2, cy); bP(cSh(cy, 0.8), [x + w, yy, x + w + d * OBX, yy - d * OBY, x + w + d * OBX, yy - d * OBY + 0.2, x + w, yy + 0.2]); }
    for (let yy = -H + 1.5; yy < -0.6; yy += 0.9) { bE(x + 0.15, yy, 0.32, 0.28, '#4f9a4a'); bE(x + w - 0.1, yy + 0.4, 0.28, 0.25, '#5aa652'); }
    bBcn(x + w / 2 + d * OBX / 2, -H - d * OBY / 2 - 1.3);
  } else if (vi === 1) {
    const b = 2.0, t = 0.5, dd = 1.5, cx0 = -0.4;
    bShdP([cx0 - b, 0, cx0 + b, 0, cx0 + b + dd * OBX, -dd * OBY, cx0 - b + dd * OBX, -dd * OBY], H * 1.05, true);
    bP(cSh(wh, 0.72), [cx0 + b, 0, cx0 + b + dd * OBX, -dd * OBY, cx0 + t + dd * OBX * 0.6, -H * 1.05 - dd * OBY * 0.6, cx0 + t, -H * 1.05]);
    bP(wh, [cx0 - b, 0, cx0 + b, 0, cx0 + t, -H * 1.05, cx0 - t, -H * 1.05]);
    for (let k = 1; k < 8; k++) { const f = k / 8, hw = b + (t - b) * f; bR(cx0 - hw, -H * 1.05 * f, hw * 2, 0.08, 'rgba(60,110,130,.35)'); }
    bWg(cx0 - 1.0, -H * 0.8, 2.0, H * 0.7, 3, Math.round(H / 1.4), 0.6, 0.45, null, 0.45, LITO);
    bEm(cx0 - 0.08, -H * 1.05, 0.16, H * 1.05 - 0.5, cy);
    if (bM !== 2) { const ry = -H * 0.66, rr = 2.1; if (bM === 0) { bbx(cx0 - rr, ry - 0.6); bbx(cx0 + rr, ry + 0.6); } else { bX.strokeStyle = cy; bX.lineWidth = 0.22; bX.beginPath(); bX.ellipse(cx0, ry, rr, 0.55, 0, 0, TAU); bX.stroke(); } }
    bGlow(cx0, -H * 0.66, 2.4, 'rgba(120,240,255,.55)');
    bBcn(cx0, -H * 1.05);
  } else if (vi === 2) {
    const d = 2.2, x = hX(4.4, d);
    bBox(x + 2.6, 0, 1.8, H * 0.82, d, wh, 0.75); bWg(x + 2.75, -H * 0.82 + 0.4, 1.5, H * 0.82 - 0.8, 2, Math.round(H * 0.6), 0.65, 0.5, '#7aa6b8', 0.45, LITO);
    bBox(x, 0, 1.8, H, d, wh, 0.75); bWg(x + 0.15, -H + 0.4, 1.5, H - 0.8, 2, Math.round(H * 0.7), 0.65, 0.5, '#7aa6b8', 0.45, LITO);
    const by = -H * 0.55; bBox(x + 1.8, by + 0.0, 0.8, 0.6, d * 0.6, cSh(wh, 0.95)); bEm(x + 1.8, by - 0.45, 0.8, 0.15, cy);
    bE(x + 2.2, by - 0.75, 0.35, 0.22, '#5aa652');
    bEm(x, -H + 0.3, 1.8, 0.15, cy); bEm(x + 2.6, -H * 0.82 + 0.3, 1.8, 0.15, cy);
    bBcn(x + 0.9 + d * OBX / 2, -H - d * OBY / 2);
  } else {
    let y = 0; const d0 = 3.4;
    for (let k = 0; k < 4; k++) {
      const w = 4.6 - k * 0.9, d = d0 - k * 0.5, h = Math.max(1.6, H * 0.2), x = hX(4.6, d0) + k * 0.45 + (d0 - d) * OBX;
      bBox(x, y, w, h, d, wh, 0.78); bWg(x + 0.15, y - h + 0.2, w - 0.3, h - 0.3, Math.round(w * 1.5), Math.max(1, Math.round(h / 1.1)), 0.7, 0.55, '#6f9cb0', 0.45, LITO);
      y -= h;
      for (let t = 0.3; t < w - 0.2; t += 0.55) bE(x + t, y - 0.15, 0.32, 0.26, cSh('#4f9a4a', 0.9 + bH(t, y) * 0.3));
    }
  }
}
function hE8(vi, hc, col) {
  const H = [10, 13, 17, 22][hc], cy = '#7ff0ff', wh = '#e8eef4';
  if (vi === 0) {
    const tiers = 5, w0 = 6.4, d0 = 3.6; let y = 0;
    for (let k = 0; k < tiers; k++) {
      const w = w0 - k * 1.15, d = d0 - k * 0.55, h = H / tiers * (k ? 0.9 : 1.3), x = hX(w0, d0) + k * 0.575 + (d0 - d) * OBX;
      bBox(x, y, w, h, d, k & 1 ? '#d8e2ea' : wh, 0.74);
      bR(x, y - h + 0.2, w, h * 0.45, '#5a8aa8'); bWg(x, y - h + 0.2, w, h * 0.45, Math.round(w * 2), 1, 0.85, 0.7, null, 0.6, LITO);
      bEm(x, y - 0.25, w, 0.12, cy);
      y -= h;
      for (let t = 0.3; t < w - 0.2; t += 0.6) bE(x + t, y - 0.12, 0.3, 0.22, '#5aa652');
    }
    bR(-0.05, y - 2.4, 0.1, 2.4, '#c8d8e0'); bBcn(0, y - 2.4);
  } else if (vi === 1) {
    const cx0 = -0.3, b = 1.5;
    bShdP([cx0 - b, 0, cx0 + b, 0, cx0, -1, cx0, 0.5], H * 1.1, true);
    bP('#8fd6ee', [cx0 - b, 0, cx0, 0.6, cx0, -H * 1.1, cx0 - b * 0.55, -H * 0.55]);
    bP('#4f9ac0', [cx0, 0.6, cx0 + b, 0, cx0 + b * 0.55, -H * 0.55, cx0, -H * 1.1]);
    bP('rgba(255,255,255,.35)', [cx0 - b * 0.7, -0.3, cx0 - 0.2, 0, cx0 - 0.15, -H * 0.9, cx0 - b * 0.45, -H * 0.55], true);
    bEm(cx0 - 0.07, -H * 1.05, 0.14, H, cy);
    for (let yy = -2; yy > -H; yy -= 2.4) bEm(cx0 - b * 0.4, yy, b * 0.8, 0.12, cy);
    bGlow(cx0, -H * 1.08, 1.8, 'rgba(140,250,255,.7)'); bBcn(cx0, -H * 1.1);
  } else if (vi === 2) {
    const r = 3.0;
    bBox(hX(6.4, 1.2), 0, 6.4, 0.6, 1.2, '#c8d0d8');
    if (bM === 1) { bTree(-1.2, -0.7, 0.6, 0, 0.2); bTree(0.6, -0.9, 0.75, 0, 0.6); bTree(1.6, -0.6, 0.5, 4, 0.5); }
    bShdP([-r, 0, r, 0, 0, -r * 0.4, 0, r * 0.3], r);
    if (bM === 0) { bbx(-r, -0.6 - r); bbx(r, 0); } else if (bM === 1) {
      const g = bX.createRadialGradient(-r * 0.35, -0.6 - r * 0.65, 0.1, 0, -0.6 - r * 0.3, r * 1.3); g.addColorStop(0, 'rgba(240,255,255,.75)'); g.addColorStop(0.5, 'rgba(140,220,240,.32)'); g.addColorStop(1, 'rgba(60,140,180,.55)');
      bX.fillStyle = g; bX.beginPath(); bX.ellipse(0, -0.6, r, r, 0, PI, TAU); bX.closePath(); bX.fill();
      bX.strokeStyle = 'rgba(230,250,255,.5)'; bX.lineWidth = 0.08; bX.beginPath(); for (const f of [0.35, 0.7]) bX.ellipse(0, -0.6, r * f, r, 0, PI, TAU); bX.ellipse(0, -0.6 - r * 0.5, r * 0.86, r * 0.16, 0, 0, TAU); bX.stroke();
    }
    bEm(-r, -0.75, r * 2, 0.15, cy); bGlow(0, -1.5, 3.2, 'rgba(160,255,230,.45)');
  } else {
    const w = 2.0, d = 2.0, x = hX(w, d);
    bBox(x, 0, w, H, d, wh, 0.74); bWg(x + 0.2, -H + 0.5, w - 0.4, H - 1, 2, Math.round(H / 1.2), 0.6, 0.5, '#6f9cb0', 0.5, LITO);
    bEm(x + w / 2 - 0.06, -H, 0.12, H - 0.3, cy);
    const cx0 = x + w / 2 + d * OBX / 2;
    for (const [f, rr] of [[0.72, 2.6], [0.45, 2.0]]) {
      const ry = -H * f;
      if (bM === 0) { bbx(cx0 - rr, ry - 0.8); bbx(cx0 + rr, ry + 0.8); }
      else if (bM === 1) { bX.strokeStyle = '#d8e8f0'; bX.lineWidth = 0.35; bX.beginPath(); bX.ellipse(cx0, ry, rr, 0.62, 0, 0, TAU); bX.stroke(); bX.strokeStyle = cy; bX.lineWidth = 0.1; bX.beginPath(); bX.ellipse(cx0, ry, rr, 0.62, 0, 0, PI); bX.stroke(); }
      bGlow(cx0, ry, rr * 0.9, 'rgba(120,240,255,.4)');
    }
    bBcn(cx0, -H - d * OBY / 2);
  }
}
const HOUSE = [hE0, hE1, hE2, hE3, hE4, hE5, hE6, hE7, hE8];

/* ---- civic buildings ---- */
function sPalaceB(era, vi, hc, col) {
  const gl = '#2e3640';
  if (era === 0) {
    bE(0, 0.1, 4.4, 1.5, '#7d6a48');
    bCyl(0, -0.3, 2.6, 1.6, '#93693f', 0, true); bR(-2.6, -1.2, 5.2, 0.3, col);
    bDoor(-0.55, 0.6, 1.1, 1.3, '#2a1a0e', 0.85, '#ffb05a');
    bCone(0, -1.9, 3.0, 3.4, '#c49a4c');
    bFlag(0, -5.2);
    for (const tx of [-3.7, 3.4]) { const tc = [col, '#8a5a30', '#c9a24a', '#5a7a4a']; for (let k = 0; k < 4; k++) bBox(tx - 0.35, -k * 0.8, 0.7, 0.8, 0.5, tc[k]); bR(tx - 0.2, -2.0, 0.12, 0.12, '#111'); bR(tx + 0.08, -2.0, 0.12, 0.12, '#111'); bP('#c9a24a', [tx - 0.9, -3.2, tx + 0.9, -3.2, tx, -2.8]); }
    bFire(2.4, 1.6);
  } else if (era === 1) {
    const c = '#d6bd8f';
    for (let k = 0; k < 3; k++) { const w = 7.2 - k * 2.0, d = 3.6 - k * 0.8, x = hX(7.2, 3.6) + k * 1.0 + (3.6 - d) * OBX * 0.5; bBox(x, -k * 1.4, w, 1.4, d, cSh(c, 1 - k * 0.04)); bR(x, -k * 1.4 - 1.4, w, 0.12, cSh(c, 1.2)); }
    bR(-0.75, -4.2, 1.5, 4.2, '#c8ae80'); for (let k = 0; k < 12; k++) bR(-0.75, -k * 0.35 - 0.1, 1.5, 0.06, 'rgba(80,60,30,.35)');
    const sx = -1.0 + 0.6 * OBX, sy = -4.2 - 0.6 * OBY;
    bBox(sx, sy, 2.0, 1.2, 1.0, '#efe6d0'); for (let k = 0; k < 4; k++) bR(sx + 0.1 + k * 0.55, sy - 1.2, 0.15, 1.2, '#d6ccb4');
    bWin(sx + 0.75, sy - 0.9, 0.5, 0.9, '#3a2a1a', 0.9, LITW);
    bHip(sx, sy - 1.2, 2.0, 1.0, 0.7, cMx('#b9603f', col, 0.4), 0.2);
    bFlag(hX(7.2, 3.6) + 0.3, -1.4); bFlag(hX(7.2, 3.6) + 6.6, -1.4);
    bFire(-1.2, -4.25); bFire(1.0, -4.25);
  } else if (era === 2) {
    const st = '#a39d90', rc = cMx(col, '#3c3840', 0.45), kx = -1.6 - 1.2 * OBX, kd = 3.0;
    bBox(kx + 0.9 * OBX, -0.9 * OBY, 3.2, 5.4, kd, st); bStone(kx + 0.9 * OBX, -0.9 * OBY, 3.2, 5.4);
    const ky = -0.9 * OBY - 5.4, kxx = kx + 0.9 * OBX;
    for (let k = 0; k < 5; k++) bBox(kxx + k * 0.7, ky, 0.4, 0.45, 0.4, st);
    for (let k = 1; k < 4; k++) bBox(kxx + 3.2 - 0.4 + k * 0.7 * OBX, ky - k * 0.7 * OBY, 0.4, 0.45, 0.4, st);
    bWg(kxx + 0.4, ky + 0.9, 2.4, 2.4, 3, 2, 0.35, 0.5, '#1e2026', 0.6, LITW);
    bFlag(kxx + 1.6 + kd * OBX / 2, ky - kd * OBY / 2);
    bBox(-3.6, 0, 7.2, 2.4, 0.7, st); bStone(-3.6, 0, 7.2, 2.4);
    for (let k = 0; k < 11; k++) bBox(-3.6 + k * 0.68, -2.4, 0.38, 0.4, 0.35, st);
    bR(-0.75, -1.7, 1.5, 1.7, '#2a2420'); bE(0, -1.7, 0.75, 0.55, '#2a2420', true); if (bK >= 6) for (let k = 0; k < 4; k++) bR(-0.6 + k * 0.38, -2.1, 0.07, 2.1, '#6a5a48');
    bWin(-0.6, -1.6, 1.2, 1.6, null, 0.8, LITW);
    for (const tx of [-3.6, 3.6]) { bCyl(tx, 0.15, 1.0, 3.6, st, 0.4, true); bWin(tx - 0.12, -2.2, 0.24, 0.6, '#1e2026', 0.6, LITW); bCone(tx, -3.45, 1.25, 2.2, rc, 0.5, false); bFlag(tx, -5.6); }
  } else if (era === 3) {
    const c = PASTEL[2], rc = cMx('#a94a35', col, 0.3), w = 7.6, d = 3.4, h = 3.8, x = hX(w, d);
    bBox(x, 0, w, h, d, c); bStone(x, 0, w, 1.3); bR(x, -1.3, w, 0.12, cSh(c, 0.85)); bR(x - 0.1, -h, w + 0.2, 0.3, cSh(c, 1.2));
    bWg(x + 0.2, -h + 0.5, w - 0.4, 1.4, 7, 1, 0.45, 0.72, gl, 0.7, LITW); bWg(x + 0.2, -1.2, w - 0.4, 1.0, 7, 1, 0.4, 0.7, gl, 0.6, LITW);
    bSwg(x + w, 0, d, 0.4, h - 0.4, 3, 2, 0.4, 0.5, gl, 0.5, LITW);
    bHip(x, -h, 2.6, d, 1.2, rc, 0.25); bHip(x + w - 2.6, -h, 2.6, d, 1.2, rc, 0.25);
    const px = x + 2.6, pw = w - 5.2;
    bBox(px, -h, pw, 0.6, d, c);
    for (let k = 0; k < 4; k++) bR(px + 0.15 + k * (pw - 0.5) / 3, -h + 0.2 + 0.0, 0.2, 2.2, '#f6f0e2');
    bP(cSh(c, 1.15), [px - 0.1, -h - 0.6, px + pw + 0.1, -h - 0.6, px + pw / 2, -h - 1.5]);
    const dx = px + pw / 2 + d * OBX / 2, dy = -h - 0.6 - d * OBY / 2;
    bCyl(dx, dy, 1.25, 1.0, c, 0.45, true); bWg(dx - 1.0, dy - 0.85, 2.0, 0.7, 4, 1, 0.4, 0.8, gl, 0.6, LITW);
    bDome(dx, dy - 1.0, 1.45, cMx('#6fa58c', col, 0.15), 1.05);
    bCyl(dx, dy - 2.5, 0.28, 0.6, '#e8e0cc', 0.12, false); bCone(dx, dy - 3.1, 0.35, 0.6, '#d4af37', 0, false); bFlag(dx, dy - 3.7);
    bDoor(px + pw / 2 - 0.5, 0, 1.0, 1.4, '#5a3a26', 0.5, LITW);
  } else if (era === 4) {
    const c = '#e4dccb', w = 7.8, d = 3.4, h = 3.3, x = hX(w, d);
    bBox(x, 0, w, h, d, c); bStone(x, 0, w, h);
    bR(x + 0.6, -h + 0.5, w - 1.2, h - 0.5, '#bfb39e');
    bWg(x + 0.6, -h + 0.6, w - 1.2, h - 0.9, 9, 2, 0.4, 0.62, gl, 0.65, LITW);
    for (let k = 0; k < 10; k++) bR(x + 0.6 + k * (w - 1.4) / 9, -h + 0.4, 0.22, h - 0.4, '#f6f2e8');
    bR(x - 0.1, -h, w + 0.2, 0.35, '#f0eadc');
    bSwg(x + w, 0, d, 0.4, h - 0.4, 3, 2, 0.4, 0.5, gl, 0.5, LITW);
    bBox(x, -h - 0.35, w, 0.4, d, cSh(c, 1.05));
    const dx = d * OBX / 2, dy = -h - 0.75 - d * OBY / 2;
    bCyl(dx, dy, 1.5, 1.3, c, 0.5, true); for (let k = 0; k < 6; k++) bR(dx - 1.3 + k * 0.5, dy - 1.2, 0.14, 1.2, '#f8f4ea');
    bDome(dx, dy - 1.3, 1.65, cMx('#7fa8a0', col, 0.12), 0.95); bCyl(dx, dy - 2.85, 0.25, 0.6, c, 0.1, false); bFlag(dx, dy - 3.4);
    const tx = x + w - 1.3;
    bBox(tx, 0, 1.4, 8.5, 1.4, cSh(c, 0.95)); bStone(tx, 0, 1.4, 8.5);
    bE(tx + 0.7, -7.2, 0.5, 0.5, '#f8f4e0'); if (bM === 1) { bL(tx + 0.7, -7.2, tx + 0.7, -7.6, 0.08, '#222'); bL(tx + 0.7, -7.2, tx + 0.95, -7.1, 0.08, '#222'); }
    bEm(tx + 0.25, -7.65, 0, 0, LITW2);
    bHip(tx, -8.5, 1.4, 1.4, 2.6, '#4f5660', 0.12); bFlag(tx + 0.7 + 0.35, -8.5 - 0.3 - 2.6);
    bGlow(tx + 0.7, -7.2, 1.0, 'rgba(255,240,190,.7)');
  } else if (era === 5) {
    const w = 8.2, d = 3.6, x = hX(w, d), c = '#efeee9';
    bBox(x + 2.4 + 1.6 * OBX, -1.6 * OBY, 3.4, 10, 1.8, '#d8dcde');
    bWg(x + 2.4 + 1.6 * OBX + 0.1, -1.6 * OBY - 9.7, 3.2, 9.4, 6, 11, 0.85, 0.55, '#5a7590', 0.55, LITO);
    bBox(x, 0, w, 3.4, d, c);
    for (let k = 0; k < 14; k++) bR(x + 0.2 + k * (w - 0.5) / 13, -3.4, 0.16, 3.4, '#cfcdc6');
    bWg(x + 0.3, -3.1, w - 0.6, 2.8, 13, 2, 0.5, 0.6, '#4e6680', 0.55, LITO);
    bSwg(x + w, 0, d, 0.3, 3.1, 3, 2, 0.6, 0.55, '#4e6680', 0.45, LITO);
    bR(x + w / 2 - 1.0, -1.4, 2.0, 1.4, '#3a4048'); bWin(x + w / 2 - 0.9, -1.3, 1.8, 1.2, null, 0.9, LITW2);
    bR(x - 0.15, -3.4, w + 0.3, 0.25, '#ffffff');
    for (const fx of [-2.6, 0, 2.6]) bFlag(fx, 1.2);
  } else {
    const H = era === 6 ? 17 : era === 7 ? 20 : 23, w = 4.4, d = 3.4, x = hX(w, d);
    bBox(hX(8.4, 4.0), 0, 8.4, 2.2, 4.0, era >= 7 ? '#e6ecef' : '#bcc6cc');
    bWin(hX(8.4, 4.0) + 0.4, -1.8, 7.6, 1.4, '#4c6f8a', 0.85, LITO);
    if (era === 6) { bGlass(x, -2.2, w, H - 2.2, d, '#b6dcf2', '#3a6d9a', 0.55); bWg(x, -H + 0.2, w, H - 2.6, 7, Math.round(H - 3), 0.8, 0.6, null, 0.45, LITO); bEm(x, -H + 0.2, w, 0.3, col); }
    else { bBox(x, -2.2, w, H - 2.2, d, '#f2f6f8', 0.76); bWg(x + 0.3, -H + 0.5, w - 0.6, H - 3.2, 5, Math.round(H / 1.3), 0.7, 0.5, '#7aa6b8', 0.5, LITO); for (let yy = -5; yy > -H + 1; yy -= 3.5) bEm(x, yy, w, 0.2, era === 8 ? '#7ff0ff' : '#5fe6f0'); bEm(x + w / 2 - 0.08, -H, 0.16, H - 2.5, col); }
    const ax = x + w / 2 + d * OBX / 2, ay = -H - d * OBY / 2;
    if (era >= 7) { bP(cSh('#f2f6f8', 0.9), [ax - 1.4, ay + 0.5, ax + 1.4, ay + 0.5, ax, ay - 4]); bGlow(ax, ay - 2, 2.6, 'rgba(120,240,255,.55)'); bFlag(ax, ay - 4); }
    else { bR(ax - 0.08, ay - 3, 0.16, 3, '#c8d0d8'); bFlag(ax, ay - 3); }
    bBcn(ax, ay - 0.3);
  }
}
function sHallB(era, vi, hc, col) {
  const gl = '#2e3640';
  if (era === 0) {
    const w = 5.4, d = 2.8, x = hX(w, d);
    bBox(x, 0, w, 1.4, d, '#7d5c3c'); for (let k = 0.3; k < 1.4; k += 0.3) bR(x, -k, w, 0.07, '#5c422a');
    bDoor(x + w / 2 - 0.45, 0, 0.9, 1.1, '#24160c', 0.8, '#ffad55');
    bGab(x, -1.4, w, d, 2.1, '#bd9549', '#7d5c3c', 0.45);
    bR(x - 0.4, rY(-1.4, d, 2.1) - 0.1, 0.6, 0.6, col); bR(x + w + 0.25 + d * OBX * 0.5, rY(-1.4, d, 2.1) - 0.1, 0.6, 0.6, col);
    bR(-0.12 - 3.4, -4.2, 0.24, 4.2, '#6a4a2c'); bP(col, [-3.4, -4.2, -2.0, -3.85, -3.4, -3.5]);
    bFire(2.8, 1.4);
  } else if (era === 1) {
    const w = 6.0, d = 2.6, h = 2.3, x = hX(w, d), c = '#ece3d0', rc = cMx('#b9603f', col, 0.35);
    bBox(x, 0, w, 0.35, d + 0.4, '#d8ccb4');
    bBox(x + 0.2, -0.35, w - 0.4, h, d, '#b8a88a');
    for (let k = 0; k < 8; k++) { bR(x + 0.3 + k * (w - 0.8) / 7, -h - 0.35, 0.24, h, '#f8f2e4'); bR(x + 0.47 + k * (w - 0.8) / 7, -h - 0.35, 0.07, h, '#cfc4ae'); }
    bR(x + 0.1, -h - 0.7, w - 0.2, 0.35, c);
    bWg(x + 0.6, -h + 0.2, w - 1.2, 1.2, 4, 1, 0.3, 0.8, null, 0.6, LITW);
    bGab(x + 0.1, -h - 0.7, w - 0.2, d, 1.1, rc, c, 0.25);
    bFlag(x + w + 0.4, 0.6);
  } else if (era <= 4) {
    const br = era === 4, c = br ? '#a85a40' : era === 3 ? PASTEL[0] : '#aaa396', rc = br ? '#4d545e' : cMx(era === 3 ? '#a94a35' : '#48434b', col, 0.35), w = 5.2, d = 3.0, h = 3.2, x = hX(w, d) - 0.6;
    bBox(x, 0, w, h, d, c); if (br) bBrick(x, 0, w, h); else bStone(x, 0, w, h);
    if (era >= 3) { for (let k = 0; k < 4; k++) { bR(x + 0.35 + k * 1.25, -1.3, 0.9, 1.3, '#3a3430'); bE(x + 0.8 + k * 1.25, -1.3, 0.45, 0.35, '#3a3430', true); } bWin(x + 0.4, -1.2, w - 0.8, 1.1, null, 0.7, LITW); }
    else bDoor(x + w / 2 - 0.5, 0, 1.0, 1.5, '#4a3426', 0.4, LITW);
    bWg(x + 0.2, -h + 0.3, w - 0.4, 1.2, 4, 1, 0.42, 0.7, gl, 0.6, LITW);
    bSwg(x + w, 0, d, 0.5, h - 0.4, 2, 2, 0.4, 0.5, gl, 0.45, LITW);
    bGab(x, -h, w, d, 1.5, rc, c, 0.25);
    const tx = x + w + 0.2, th = era === 2 ? 6.0 : 7.0;
    bBox(tx, 0, 1.5, th, 1.5, cSh(c, 0.96)); if (br) bBrick(tx, 0, 1.5, th); else bStone(tx, 0, 1.5, th);
    bR(tx + 0.35, -th + 0.5, 0.8, 1.0, '#2a2420'); if (era >= 3) { bE(tx + 0.75, -th + 2.0, 0.42, 0.42, '#f6f0dc'); if (bM === 1) bL(tx + 0.75, -th + 2.0, tx + 0.75, -th + 1.7, 0.07, '#222'); bGlow(tx + 0.75, -th + 2.0, 0.9, 'rgba(255,240,190,.6)'); }
    bHip(tx, -th, 1.5, 1.5, 2.0, rc, 0.15); bFlag(tx + 0.75 + 0.3, -th - 0.3 - 2.0);
  } else {
    const H = era === 5 ? 9 : 12, w = 3.8, d = 3.2, x = hX(w, d);
    bBox(hX(7.4, 3.8), 0, 7.4, 1.8, 3.8, '#d4d6d6'); bWin(hX(7.4, 3.8) + 0.3, -1.5, 6.8, 1.2, '#4a6680', 0.85, LITW2);
    if (era === 5) { bBox(x, -1.8, w, H - 1.8, d, '#e6e4de'); bWg(x + 0.2, -H + 0.3, w - 0.4, H - 2.4, 5, Math.round(H - 2), 0.8, 0.55, '#4f6a82', 0.55, LITO); }
    else { bGlass(x, -1.8, w, H - 1.8, d, era >= 7 ? '#e6f2f6' : '#a6d2ee', era >= 7 ? '#9cc6d4' : '#3a6d9a', 0.6); bWg(x, -H + 0.2, w, H - 2.2, 6, Math.round(H - 2), 0.8, 0.6, null, 0.45, LITO); }
    bEm(x, -H + 0.2, w, 0.25, col); bFlag(x + w / 2 + d * OBX / 2, -H - d * OBY / 2);
  }
}
function sTempleB(era, vi, hc, col) {
  const gl = '#2e3640';
  if (era === 0) {
    bE(0, -0.6, 4.2, 1.8, '#7c8a5a');
    for (let k = 0; k < 10; k++) { const a = k / 10 * TAU + 0.2, x = Math.cos(a) * 3.3, y = -0.6 + Math.sin(a) * 1.35; if (Math.sin(a) < 0) bBox(x - 0.3, y, 0.6, 1.9, 0.4, '#9e9a92'); }
    bBox(-0.7, -0.8, 1.4, 1.2, 0.5, '#8e8a82');
    for (let k = 0; k < 10; k++) { const a = k / 10 * TAU + 0.2, x = Math.cos(a) * 3.3, y = -0.6 + Math.sin(a) * 1.35; if (Math.sin(a) >= 0) bBox(x - 0.3, y, 0.6, 1.9, 0.4, '#aaa69e'); }
    bBox(-2.0, 0.6, 1.8, 0.4, 0.4, '#a29e96'); bFire(0.3, -0.2);
  } else if (era === 1) {
    const w = 5.2, d = 3.4, x = hX(w, d), c = '#efe8d8';
    bBox(x - 0.3, 0, w + 0.6, 0.3, d + 0.4, '#d8d0bc'); bBox(x - 0.15, -0.3, w + 0.3, 0.3, d + 0.2, '#e2dac8');
    bBox(x + 0.4, -0.6, w - 0.8, 2.6, d - 0.6, '#b9ab8e'); bWin(x + w / 2 - 0.5, -2.4, 1.0, 1.7, null, 0.9, LITW);
    for (let k = 0; k < 6; k++) { const cx0 = x + 0.25 + k * (w - 0.7) / 5; bR(cx0, -3.2, 0.3, 2.6, '#faf6ec'); bR(cx0 + 0.2, -3.2, 0.1, 2.6, '#d4ccb8'); }
    bBox(x, -3.2, w, 0.45, d, c);
    bP(cSh(cMx('#b9603f', col, 0.35), 0.7), [x + w, -3.65, x + w + d * OBX, -3.65 - d * OBY, x + w / 2 + d * OBX, -4.8 - d * OBY, x + w / 2, -4.8]);
    bP(cSh(c, 1.08), [x - 0.1, -3.65, x + w + 0.1, -3.65, x + w / 2, -4.8]); bP('rgba(150,130,100,.35)', [x + 0.6, -3.75, x + w - 0.6, -3.75, x + w / 2, -4.5]);
    bShd(x, 0, w, 4.8, d);
  } else if (era === 2 || era === 4) {
    const st = era === 4 ? '#9a5443' : '#b2ab9c', rc = era === 4 ? '#3f454e' : '#4a4650', w = 3.2, d = 5.0, x = -1.2, h = 4.0;
    bBox(x, 0, w, h, d, st); if (era === 4) bBrick(x, 0, w, h); else bStone(x, 0, w, h);
    bSwg(x + w, 0, d, 0.8, h - 0.5, 4, 1, 0.35, 0.8, '#3a3048', 0.8, '#ffb46a');
    bFgab(x, -h, w, d, 2.8, rc, st, 0.15);
    bE(x + w / 2, -h - 0.9, 0.55, 0.55, '#4a3a5a'); bEm(x + w / 2 - 0.3, -h - 1.2, 0.6, 0.6, '#ff9a50');
    bDoor(x + w / 2 - 0.5, 0, 1.0, 1.8, '#3a2a20', 0.5, '#ffb46a'); bE(x + w / 2, -1.8, 0.5, 0.45, '#3a2a20', true);
    const towers = era === 4 ? [x - 1.7] : [x - 1.7, x + w + 0.2];
    for (const tx of towers) { bBox(tx, 0, 1.5, h + 2.2, 1.5, st); if (era === 4) bBrick(tx, 0, 1.5, h + 2.2); else bStone(tx, 0, 1.5, h + 2.2); bWin(tx + 0.5, -h - 1.4, 0.5, 1.0, '#1e1a22', 0.5, LITW); bHip(tx, -h - 2.2, 1.5, 1.5, era === 4 ? 5.0 : 3.6, rc, 0.1); }
  } else {
    const st = era === 5 ? '#d8d4ca' : PASTEL[5], rc = cMx('#a94a35', col, 0.25), w = 5.4, d = 3.6, h = 3.4, x = hX(w, d);
    bBox(x, 0, w, h, d, st); bStone(x, 0, w, 1.2);
    bWg(x + 0.3, -h + 0.4, w - 0.6, 1.4, 4, 1, 0.3, 0.8, gl, 0.65, LITW);
    bDoor(x + w / 2 - 0.55, 0, 1.1, 1.8, '#4a3426', 0.5, LITW); bE(x + w / 2, -1.8, 0.55, 0.45, '#4a3426', true);
    bGab(x, -h, w, d, 1.2, rc, st, 0.2);
    const dx = x + w / 2 + d * OBX / 2, dy = rY(-h, d, 1.2) + 0.6;
    if (era === 5) { bP(cSh(st, 1.1), [x + 0.5, -h - 0.5, x + w - 0.5, -h - 0.5, x + w / 2 + 0.4, -h - 4.4, x + w / 2 - 0.2, -h - 4.4]); bEm(x + w / 2 - 0.05, -h - 4.2, 0.1, 3.6, LITW2); }
    else { bCyl(dx, dy, 1.6, 1.2, st, 0.5, true); bWg(dx - 1.3, dy - 1.0, 2.6, 0.8, 5, 1, 0.4, 0.8, gl, 0.6, LITW); bDome(dx, dy - 1.2, 1.8, cMx('#c46a44', col, 0.2), 1.1); bCyl(dx, dy - 3.1, 0.3, 0.7, st, 0.12, false); bCone(dx, dy - 3.8, 0.36, 0.5, '#d4af37', 0, false); }
    bBox(x + w + 0.5, 0, 1.3, 7.5, 1.3, st); bR(x + w + 0.8, -6.6, 0.7, 0.9, '#2a2420'); bHip(x + w + 0.5, -7.5, 1.3, 1.3, 1.6, rc, 0.15);
  }
}
function sLabB(era, vi, hc, col) {
  const gl = '#3a5070';
  if (era < 4) {
    const w = 4.2, d = 2.8, h = 2.6, x = hX(w, d), c = '#f0eee8';
    bBox(x, 0, w, h, d, c);
    bWg(x + 0.2, -h + 0.4, w - 0.4, 1.0, 4, 1, 0.38, 0.7, gl, 0.65, LITW);
    for (let k = 0; k < 4; k++) bR(x + 1.1 + k * 0.6, -1.4, 0.2, 1.4, '#fbfaf6'); bR(x + 1.4, -1.2, 1.4, 1.2, '#5a6a8a');
    bWin(x + 1.5, -1.1, 1.2, 1.1, null, 0.7, LITW);
    bP('#fbfaf6', [x + 0.9, -1.4, x + 3.3, -1.4, x + 2.1, -2.1]);
    bHip(x, -h, w, d, 1.1, '#4a78c8', 0.25);
  } else if (era === 4) {
    const w = 4.2, d = 3.0, h = 3.2, x = hX(w, d), c = '#a65a42';
    bBox(x, 0, w, h, d, c); bBrick(x, 0, w, h);
    bWg(x + 0.2, -h + 0.3, w - 0.4, h - 0.6, 4, 2, 0.42, 0.62, gl, 0.65, LITW); bR(x, -1.6, w, 0.12, '#e6dccb');
    bBox(x - 0.1, -h, w + 0.2, 0.3, d + 0.05, '#e6dccb');
    const dx = x + 1.2 + 1.5 * OBX, dy = -h - 0.3 - 1.5 * OBY;
    bCyl(dx, dy, 0.9, 0.7, '#e6e2da', 0.35, true); bDome(dx, dy - 0.7, 1.0, '#c8ccd0', 1); if (bM === 1) bR(dx - 0.12, dy - 1.65, 0.24, 0.95, '#3a3e44');
    const cxp = x + w - 0.8 + 1.0 * OBX; bBox(cxp, -h - 0.3 - 1.0 * OBY, 0.5, 1.6, 0.4, '#7a4434'); bSmk(cxp + 0.25, -h - 2.3 - 1.0 * OBY);
  } else if (era === 5) {
    const w = 4.6, d = 3.2, h = 3.6, x = hX(w, d);
    bBox(x, 0, w, h, d, '#eef0f2');
    for (let f = 0; f < 3; f++) bR(x, -h + 0.3 + f * 1.1, w, 0.55, '#4e7090');
    bWg(x, -h + 0.3, w, 3.3, 6, 3, 0.85, 0.5, null, 0.7, LITO);
    bSwg(x + w, 0, d, 0.3, h - 0.3, 3, 3, 0.7, 0.5, '#4e7090', 0.6, LITO);
    bR(x + 1.0 + 1.0 * OBX, -h - 1.0 * OBY - 2.2, 0.1, 2.2, '#9aa0a8'); bR(x + 2.0 + 1.6 * OBX, -h - 1.6 * OBY - 1.5, 0.1, 1.5, '#9aa0a8'); bBcn(x + 1.05 + 1.0 * OBX, -h - 1.0 * OBY - 2.2);
  } else {
    const w = 4.6, d = 3.2, h = 3.4, x = hX(w, d);
    bGlass(x, 0, w, h, d, '#c6ecf4', '#4f9ab8', 0.55); bWg(x, -h + 0.2, w, h - 0.3, 7, 3, 0.85, 0.6, null, 0.7, LITO);
    bR(x - 0.1, -h, w + 0.2, 0.2, '#f2f6f8');
    const dx = x + 2.6 + 1.6 * OBX, dy = -h - 1.6 * OBY;
    bR(dx - 0.1, dy - 1.1, 0.2, 1.1, '#c8ccd0');
    bP('#e8ecf0', [dx - 1.3, dy - 2.4, dx + 0.9, dy - 1.0, dx + 0.6, dy - 0.7, dx - 1.5, dy - 2.0]); bP('#b8c0c8', [dx - 1.0, dy - 2.1, dx + 0.6, dy - 1.05, dx + 0.45, dy - 0.9, dx - 1.15, dy - 1.95]);
    bR(dx - 0.35, dy - 1.85, 0.08, 0.6, '#8a929a'); bEm(x, -0.25, w, 0.1, col);
  }
}
function sInstB(era, vi, hc, col) {
  if (era <= 4) {
    const w = 4.0, d = 2.8, h = 2.2, x = hX(w, d) - 0.6, c = era === 4 ? '#e6dccb' : '#efece4';
    bBox(x, 0, w, h, d, c); if (era >= 3) bStone(x, 0, w, h);
    bWg(x + 0.2, -h + 0.35, w - 0.4, 1.0, 4, 1, 0.38, 0.65, '#2e3640', 0.7, LITW); bDoor(x + w / 2 - 0.4, 0, 0.8, 1.2, '#4a3a2a', 0.5, LITW);
    bBox(x - 0.1, -h, w + 0.2, 0.3, d, cSh(c, 1.1));
    const dx = x + w + 1.4, dy = 0.4;
    bCyl(dx, dy, 1.7, 2.2, '#f2f0ea', 0.6, true); bWin(dx - 0.3, dy - 1.4, 0.6, 1.0, '#2e3640', 0.8, LITW);
    bDome(dx, dy - 2.2, 1.85, '#d8dce0', 1.0);
    if (bM === 1) { bP('#2a2e36', [dx - 0.3, dy - 4.0, dx + 0.15, dy - 4.05, dx + 0.25, dy - 2.4, dx - 0.2, dy - 2.4]); bL(dx, dy - 3.6, dx + 1.0, dy - 4.4, 0.25, '#5a6068'); }
  } else if (era === 5) {
    const w = 4.4, d = 3.0, h = 2.6, x = hX(w, d) - 1.6;
    bBox(x, 0, w, h, d, '#e8eaec'); for (let f = 0; f < 2; f++) bR(x, -h + 0.3 + f * 1.15, w, 0.5, '#4e7090'); bWg(x, -h + 0.3, w, 2.2, 6, 2, 0.85, 0.45, null, 0.7, LITO);
    const dx = x + w + 2.3, dy = -0.2;
    bShdP([dx - 2.2, 0, dx + 2.2, 0, dx, -1, dx, 0.5], 5);
    bR(dx - 0.15, dy - 2.4, 0.3, 2.4, '#b8bec4'); bL(dx - 1.0, dy, dx - 0.1, dy - 2.2, 0.15, '#9aa0a8'); bL(dx + 1.0, dy, dx + 0.1, dy - 2.2, 0.15, '#9aa0a8');
    if (bM === 0) { bbx(dx - 2.6, dy - 6.2); bbx(dx + 2.6, dy - 1.6); }
    else if (bM === 1) { const g = bX.createLinearGradient(dx - 2.4, 0, dx + 2.4, 0); g.addColorStop(0, '#f8fafc'); g.addColorStop(1, '#a8b0b8'); bX.fillStyle = g; bX.beginPath(); bX.ellipse(dx, dy - 4.0, 2.5, 1.6, -0.5, 0, TAU); bX.fill(); bX.fillStyle = 'rgba(80,90,100,.35)'; bX.beginPath(); bX.ellipse(dx + 0.15, dy - 3.85, 1.9, 1.15, -0.5, 0, TAU); bX.fill(); bL(dx, dy - 4.0, dx + 0.9, dy - 5.4, 0.1, '#6a7078'); }
    bBcn(dx + 0.9, dy - 5.4);
  } else {
    if (bM === 0) { bbx(-6, -2.2); bbx(6, 2.4); bLitN++; }
    else if (bM === 1) { bX.strokeStyle = '#a8b4bc'; bX.lineWidth = 0.7; bX.beginPath(); bX.ellipse(0, 0, 5.4, 2.0, 0, 0, TAU); bX.stroke(); bX.strokeStyle = '#5fe6f0'; bX.lineWidth = 0.18; bX.beginPath(); bX.ellipse(0, 0, 5.4, 2.0, 0, 0, TAU); bX.stroke(); }
    else { bX.strokeStyle = '#7ff4ff'; bX.lineWidth = 0.35; bX.beginPath(); bX.ellipse(0, 0, 5.4, 2.0, 0, 0, TAU); bX.stroke(); bLitC++; }
    const w = 3.6, d = 2.8, x = hX(w, d);
    bGlass(x, 0, w, 2.8, d, '#d6f2f8', '#5aa8c4', 0.5); bWg(x, -2.6, w, 2.5, 6, 2, 0.85, 0.6, null, 0.7, LITO);
    bDome(x + w / 2 + d * OBX / 2, -2.8 - d * OBY / 2, 1.5, '#e8f2f6', 0.9);
    bEm(x, -0.2, w, 0.12, '#5fe6f0');
  }
}
function sFactoryB(era, vi, hc, col) {
  if (era <= 4) {
    const br = '#8e4a38', w = 7.0, d = 3.4, h = 2.6, x = hX(w, d);
    bBox(x, 0, w, h, d, br); bBrick(x, 0, w, h);
    for (let k = 0; k < 5; k++) { bR(x + 0.3 + k * 1.35, -2.1, 0.9, 1.4, '#2e2a28'); bE(x + 0.75 + k * 1.35, -2.1, 0.45, 0.3, '#2e2a28', true); bWin(x + 0.38 + k * 1.35, -2.0, 0.74, 1.25, null, 0.8, '#ffb85e'); }
    const tw = w / 4;
    for (let k = 0; k < 4; k++) { const tx = x + k * tw; bP('#5a6068', [tx, -h, tx + tw, -h, tx + tw + d * OBX, -h - d * OBY, tx + d * OBX, -h - d * OBY]); bP('#6c7680', [tx, -h, tx + tw * 0.3, -h - 1.0, tx + tw * 0.3 + d * OBX, -h - 1.0 - d * OBY, tx + d * OBX, -h - d * OBY]); bP('#a0c0d0', [tx + tw * 0.3, -h - 1.0, tx + tw, -h, tx + tw + d * OBX, -h - d * OBY, tx + tw * 0.3 + d * OBX, -h - 1.0 - d * OBY]); }
    bShd(x, -h, w, 1.0, d);
    for (const [sx, sh] of [[x + w - 0.2 + 1.0 * OBX, 7.4], [x + w - 1.6 + 2.4 * OBX, 6.2]]) { const sy = -1.0 * OBY * (sx > x + w - 1 ? 1 : 2.4); bCyl(sx, sy, 0.45, sh, '#7a3c2e', 0.18, false); bR(sx - 0.45, sy - sh + 0.4, 0.9, 0.2, '#3a3030'); bR(sx - 0.45, sy - sh * 0.6, 0.9, 0.12, '#5a2a22'); bSmk(sx, sy - sh - 0.2, 1); }
  } else if (era === 5) {
    const c = '#9aa0a6', w = 6.4, d = 3.4, h = 2.8, x = hX(w + 2, d);
    bBox(x, 0, w, h, d, c); for (let k = 0; k < 6; k++) bR(x + 0.3 + k * 1.0, -h + 0.4, 0.6, 0.5, '#4a5a68'); bWg(x + 0.3, -h + 0.4, 6.0, 0.5, 6, 1, 0.6, 1, null, 0.8, LITW2);
    bR(x + 1.0, -1.6, 1.6, 1.6, '#5a6068');
    bBox(x - 0.1, -h, w + 0.2, 0.2, d, '#b8bec4');
    for (let k = 0; k < 2; k++) { const sx = x + w + 0.9 + k * 1.3 + k * 0.8 * OBX, sy = -k * 0.8 * OBY; bCyl(sx, sy, 0.75, 4.4, '#c4c8cc', 0.3, false); bR(sx - 0.75, sy - 2.2, 1.5, 0.08, '#8a9096'); }
    const sx = x + 1.2 + 2.2 * OBX, sy = -h - 2.2 * OBY; bCyl(sx, sy, 0.28, 6.2, '#e8e8e8', 0.12, false); for (let k = 0; k < 3; k++) bR(sx - 0.28, sy - 1.4 - k * 1.8, 0.56, 0.6, '#c8402e'); bSmk(sx, sy - 6.4, 1);
    if (bM === 1) bL(x + w, -1.8, x + w + 0.9, -1.8, 0.2, '#6a7076');
  } else {
    const w = 7.0, d = 3.6, h = 2.4, x = hX(w, d);
    bBox(x, 0, w, h, d, '#e2e6e8', 0.76, 1.0);
    bP('#24364e', [x + 0.2, -h, x + w - 0.2, -h, x + w - 0.2 + d * OBX * 0.95, -h - d * OBY * 0.95, x + 0.2 + d * OBX * 0.95, -h - d * OBY * 0.95]);
    if (bM === 1 && bK >= 4) for (let k = 1; k < 7; k++) bL(x + 0.2 + k * (w - 0.4) / 7, -h, x + 0.2 + k * (w - 0.4) / 7 + d * OBX * 0.95, -h - d * OBY * 0.95, 0.06, '#5a7aa0');
    bR(x, -1.5, w, 0.7, '#5a8aa8'); bWg(x, -1.5, w, 0.7, 8, 1, 0.9, 1, null, 0.8, LITO);
    bEm(x, -h + 0.15, w, 0.12, era >= 7 ? '#5fe6f0' : col);
    const sx = x + w + 1.4; bCyl(sx, 0.2, 1.1, 3.4, '#d8dcde', 0.45, false); bE(sx, -3.2, 0.8, 0.3, '#9aa0a6');
  }
}
function sPortB(era, vi) {
  const dir = vi ? -1 : 1, L = era >= 4 ? 8 : 6, x0 = dir > 0 ? -0.5 : 0.5 - L, wd = era >= 2 ? '#8a8478' : '#8a6438';
  if (bM === 1) for (let k = 0; k <= L; k += 1.2) bR(x0 + k, -0.2, 0.22, 0.9, '#3e2e20');
  bBox(x0, -0.3, L, 0.35, 1.6, era >= 4 ? '#9c9c98' : wd);
  if (bM === 1 && era < 4 && bK >= 5) for (let k = 0.5; k < L; k += 0.5) bL(x0 + k, -0.65, x0 + k + 1.6 * OBX, -0.65 - 1.6 * OBY, 0.05, 'rgba(40,24,10,.35)');
  const tip = dir > 0 ? x0 + L - 0.6 : x0 + 0.6;
  bP('#6a4a2a', [tip - 1.6 * dir - 1.0, 0.6, tip - 1.6 * dir + 1.0, 0.6, tip - 1.6 * dir + 0.7, 1.1, tip - 1.6 * dir - 0.7, 1.1]);
  bR(tip - 1.6 * dir - 0.05, -1.4, 0.1, 2.0, '#4a3424');
  if (era >= 2 && era <= 5) { bCyl(tip, -0.6, 0.45, 3.2, '#f0ece4', 0.2, true); bR(tip - 0.45, -2.0, 0.9, 0.4, '#c84030'); bR(tip - 0.45, -3.0, 0.9, 0.3, '#c84030'); bCyl(tip, -3.8, 0.35, 0.5, '#2a2e34', 0.15, true); bEm(tip - 0.2, -4.2, 0.4, 0.35, '#fff0b0'); bCone(tip, -4.3, 0.5, 0.6, '#c84030', 0, false); bGlow(tip, -4.0, 2.4, 'rgba(255,240,180,.75)'); }
  if (era >= 4) {
    const cx0 = x0 + L * 0.42, cc = era >= 6 ? '#e8e8ea' : '#e0a830';
    bBox(cx0 - 0.9, -0.65, 0.25, 4.6, 0.25, cc); bBox(cx0 + 0.9, -0.65, 0.25, 4.6, 0.25, cc);
    bBox(cx0 - 2.0 * (dir > 0 ? 0.6 : 1.8), -5.25, 4.6, 0.4, 0.5, cc); bBox(cx0 - 0.4, -5.65, 1.0, 0.6, 0.6, cSh(cc, 0.85));
    if (bM === 1) { bL(cx0 - 0.8, -0.65, cx0 + 0.95, -5.0, 0.1, cc); bL(cx0 + 1.0, -0.65, cx0 - 0.75, -5.0, 0.1, cc); bL(cx0 + dir * 2.4, -4.85, cx0 + dir * 2.4, -2.2, 0.05, '#3a3a3a'); }
    if (era >= 5) for (let k = 0; k < 6; k++) bBox(x0 + L * 0.68 + (k % 3) * 0.75 - (dir < 0 ? L * 0.55 : 0), -0.65 - ((k / 3) | 0) * 0.55, 0.7, 0.55, 1.0, ['#c84a3a', '#3a7ac8', '#e0a830', '#4a9a5a', '#d8d8d8', '#8a5ac8'][(k + bSeed) % 6]);
  }
}
function sWareB(era, vi, hc, col) {
  const w = 5.0, d = 3.0, x = hX(w, d);
  if (era <= 3) { const c = era === 3 ? '#9b5643' : '#8a6a48'; bBox(x, 0, w, 2.2, d, c); bR(x + 1.6, -1.8, 1.6, 1.8, '#3a2a1e'); bWin(x + 1.7, -1.7, 1.4, 1.7, null, 0.5, LITW); bGab(x, -2.2, w, d, 1.4, era === 3 ? '#7a3a2a' : '#6a5038', c, 0.25); }
  else if (era === 4) { bBox(x, 0, w, 2.6, d, '#a4553e'); bBrick(x, 0, w, 2.6); for (let k = 0; k < 3; k++) { bR(x + 0.4 + k * 1.6, -2.0, 1.0, 2.0, '#2e3036'); bE(x + 0.9 + k * 1.6, -2.0, 0.5, 0.35, '#2e3036', true); } bGab(x, -2.6, w, d, 1.0, '#4d545e', '#a4553e', 0.2); }
  else { bBox(x, 0, w, 2.4, d, era >= 6 ? '#dfe3e6' : '#a8aeb4'); for (let k = 0; k < 6; k++) bR(x + 0.2 + k * 0.8, -2.4, 0.06, 2.4, 'rgba(0,0,0,.15)'); bR(x + 1.4, -1.8, 2.2, 1.8, '#4a5058'); bWin(x + 1.5, -1.7, 2.0, 1.7, null, 0.6, LITW2); bEm(x, -2.3, w, 0.1, col); }
}
function sWonderB(era, vi, hc, col) {
  if (era === 0) {
    bE(0, -0.8, 5.6, 2.3, '#7c8a5a');
    const ring = (front) => { for (let k = 0; k < 14; k++) { const a = k / 14 * TAU, x = Math.cos(a) * 4.6, y = -0.8 + Math.sin(a) * 1.8; if ((Math.sin(a) >= 0) === front) { bBox(x - 0.45, y, 0.9, 3.0, 0.5, front ? '#a8a49c' : '#96928a'); if (k % 2 === 0) bBox(x - 0.45, y - 3.0, 1.9, 0.5, 0.5, '#9e9a92'); } } };
    ring(false); bBox(-0.4, -0.9, 0.8, 3.8, 0.6, '#8e8a82'); ring(true);
  } else if (era === 1) {
    const b = 5.0, h = 7.0, dd = 4.0, c = '#e2c68e';
    bShdP([-b, 0, b, 0, b + dd * OBX, -dd * OBY, -b + dd * OBX, -dd * OBY], h);
    const ax = dd * OBX / 2, ay = -h - dd * OBY / 2;
    bP(cSh(c, 0.68), [b, 0, b + dd * OBX, -dd * OBY, ax, ay]);
    bP(c, [-b, 0, b, 0, ax, ay]);
    if (bM === 1 && bK >= 4) for (let k = 1; k < 12; k++) { const f = k / 12; bR(-b + (ax + b) * f, ay * f, (b - ax) * (1 - f) + (b - (-b + (ax + b) * f) - (b - ax) * (1 - f)) * 0 + (2 * b) * (1 - f) - (ax - ax) , 0.06, 'rgba(120,90,40,.25)'); }
    bP('#e8c040', [ax - 0.55, ay + 0.8, ax + 0.55, ay + 0.8, ax, ay]);
    bP('rgba(255,255,255,.18)', [-b, 0, -b + 1.2, 0, ax, ay], true);
    bDoor(-0.4, 0, 0.8, 1.0, '#3a2a18', 0.6, LITW);
  } else if (era === 2) {
    if (vi) {
      const rc = cMx(col, '#2c2a30', 0.35);
      for (let k = 0; k < 5; k++) { const w = 5.0 - k * 0.8, d = 3.2 - k * 0.45, h = 1.6 - k * 0.1, y = -k * (1.6 + 0.35) + k * 0.25, x = hX(5.0, 3.2) + k * 0.4 + (3.2 - d) * OBX * 0.5; bBox(x, y, w, h, d, '#b8342a'); bWg(x + 0.2, y - h + 0.3, w - 0.4, h - 0.5, Math.round(w), 1, 0.5, 0.8, '#3a2a20', 0.7, LITW); bHip(x - 0.2, y - h, w + 0.4, d, 0.55, rc, 0.55); }
      bR(-0.05 + 0.4, -10.4, 0.1, 1.6, '#d4af37');
    } else {
      const st = '#c2bba8', w = 4.6, d = 6.0, x = -2.4, h = 5.0;
      bBox(x, 0, w, h, d, st); bStone(x, 0, w, h); bSwg(x + w, 0, d, 1.0, h - 0.6, 5, 1, 0.35, 0.8, '#3a3048', 0.85, '#ffb46a');
      bFgab(x, -h, w, d, 3.4, '#4a4650', st, 0.15); bE(x + w / 2, -h - 1.1, 0.75, 0.75, '#4a3a5a'); bEm(x + w / 2 - 0.4, -h - 1.5, 0.8, 0.8, '#ff9a50');
      bDoor(x + w / 2 - 0.6, 0, 1.2, 2.2, '#3a2a20', 0.6, '#ffb46a');
      for (const tx of [x - 1.9, x + w + 0.3]) { bBox(tx, 0, 1.6, h + 3.4, 1.6, st); bStone(tx, 0, 1.6, h + 3.4); bWin(tx + 0.5, -h - 2.4, 0.6, 1.4, '#1e1a22', 0.5, LITW); bHip(tx, -h - 3.4, 1.6, 1.6, 5.4, '#4a4650', 0.1); }
    }
  } else if (era === 3) {
    const st = '#ece2cc', w = 6.4, d = 4.0, h = 3.4, x = hX(w, d);
    bBox(x, 0, w, h, d, st); bStone(x, 0, w, h); bWg(x + 0.3, -h + 0.4, w - 0.6, 1.4, 5, 1, 0.3, 0.8, '#2e3640', 0.65, LITW);
    bP('#e4dac4', [x, -h, x + w, -h, x + w / 2, -h - 1.4]); bDoor(x + w / 2 - 0.6, 0, 1.2, 1.9, '#4a3426', 0.5, LITW);
    const dx = x + w / 2 + d * OBX / 2, dy = -h - d * OBY / 2;
    bCyl(dx, dy, 2.2, 1.6, st, 0.7, true); bWg(dx - 1.8, dy - 1.35, 3.6, 1.0, 6, 1, 0.4, 0.8, '#2e3640', 0.7, LITW);
    bDome(dx, dy - 1.6, 2.5, '#c4603e', 1.25); if (bM === 1 && bK >= 4) { bX.strokeStyle = '#f2e8d4'; bX.lineWidth = 0.12; bX.beginPath(); for (const f of [0, 0.45, 0.82]) bX.ellipse(dx, dy - 1.6, 2.5 * f + 0.001, 2.5 * 1.25, 0, PI, TAU); bX.stroke(); }
    bCyl(dx, dy - 4.7, 0.4, 0.9, st, 0.16, false); bCone(dx, dy - 5.6, 0.45, 0.8, '#d4af37', 0, false); bFlag(dx, dy - 6.4);
    bBox(x + w + 0.4, 0, 1.4, 9.0, 1.4, st); bStone(x + w + 0.4, 0, 1.4, 9); bR(x + w + 0.7, -8.0, 0.8, 1.0, '#2a2420'); bHip(x + w + 0.4, -9.0, 1.4, 1.4, 1.8, '#c4603e', 0.12);
  } else if (era === 4) {
    const H = 15, c = '#7a5a46', b = 4.2;
    bShdP([-b, 0, b, 0, b + 2, -1.5, -b + 2, -1.5], H);
    if (bM === 0) { bbx(-b - 0.3, -H - 1.5); bbx(b + 1.5, 0.3); }
    else if (bM === 1) {
      bX.strokeStyle = c; bX.lineWidth = 0.32; bX.lineJoin = 'round';
      const leg = (s) => { bX.beginPath(); bX.moveTo(s * b, 0); bX.quadraticCurveTo(s * b * 0.45, -H * 0.3, s * 0.35, -H * 0.88); bX.stroke(); };
      leg(-1); leg(1); bX.strokeStyle = cSh(c, 0.75); bX.beginPath(); bX.moveTo(b * 0.8 + 1.4, -1.0); bX.quadraticCurveTo(b * 0.4 + 1.2, -H * 0.3, 1.0, -H * 0.88); bX.stroke();
      bX.lineWidth = 0.1; bX.strokeStyle = cSh(c, 0.9); bX.beginPath();
      for (let k = 1; k < 14; k++) { const f = k / 14, y = -H * 0.88 * f, wv = b * (1 - f) * (1 - f) * 0.85 + 0.35 + b * 0.15 * (1 - f); bX.moveTo(-wv, y); bX.lineTo(wv, y - H * 0.88 / 14); bX.moveTo(wv, y); bX.lineTo(-wv, y - H * 0.88 / 14); }
      bX.stroke();
      bX.lineWidth = 0.3; bX.strokeStyle = c; bX.beginPath(); bX.ellipse(0, -1.4, b * 0.62, 1.8, 0, PI, TAU); bX.stroke();
      bR(-1.9, -H * 0.3, 3.8, 0.4, c); bR(-0.9, -H * 0.6, 1.8, 0.35, c); bR(-0.45, -H * 0.88, 0.9, 0.3, c);
      bR(-0.12, -H, 0.24, H * 0.12, c); bR(-0.04, -H - 1.0, 0.08, 1.0, '#3a3a3a');
    }
    for (let k = 0; k < 5; k++) bEm(-0.06, -H * (0.3 + k * 0.15), 0.12, 0.12, '#ffe0a0');
    bGlow(0, -H * 0.6, 3.2, 'rgba(255,210,140,.5)'); bBcn(0, -H - 1.0);
  } else if (era === 5) {
    const H = 18;
    bShdP([-1.6, 0, 1.6, 0, 0, -1.2, 0, 0.6], H);
    bCyl(0, 0, 1.4, 1.2, '#c8ccd0', 0.5, false);
    bP('#e4e6e8', [-0.75, -1.2, 0.75, -1.2, 0.4, -H * 0.72, -0.4, -H * 0.72]); bP('#a8acb0', [0.15, -1.2, 0.75, -1.2, 0.4, -H * 0.72, 0.1, -H * 0.72]);
    bCyl(0, -H * 0.72, 1.8, 0.8, '#d8dce0', 0.55, false); bWin(-1.5, -H * 0.72 - 0.55, 3.0, 0.35, '#4a6a88', 1, LITO); bEm(-1.8, -H * 0.72 - 0.1, 3.6, 0.1, col);
    bCyl(0, -H * 0.76, 1.0, 0.6, '#e8eaec', 0.3, false);
    bR(-0.12, -H, 0.24, H * 0.2, '#e0e2e4'); for (let k = 0; k < 4; k++) bR(-0.12, -H + k * 0.9, 0.24, 0.3, '#c8402e');
    bBcn(0, -H);
  } else if (era === 6) {
    const H = 26, segs = [[2.6, 0.32], [2.0, 0.28], [1.4, 0.22], [0.9, 0.12]]; let y = 0;
    for (const [w, f] of segs) { const h = H * f, d = w, x = -w / 2 - d * OBX / 2; bGlass(x, y, w, h, d, '#c2e2f4', '#4a7ea8', 0.5); bWg(x, y - h + 0.2, w, h - 0.3, Math.max(2, Math.round(w * 2)), Math.round(h), 0.8, 0.6, null, 0.5, LITO); bR(x - 0.05, y - h, w + 0.1, 0.12, '#eef6fa'); y -= h; }
    bR(-0.08, y - 3.5, 0.16, 3.5, '#d8e0e8'); bBcn(0, y - 3.5);
  } else {
    const H = 30, r = era === 8 ? 5.2 : 4.4;
    bShdP([-r, 0, r, 0, 0, -1.6, 0, 1.2], 8);
    bCyl(0, 0, r, 1.6, era === 8 ? '#dfe6ee' : '#e8ecef', 1.4, false);
    bCyl(0, -1.6, r * 0.55, 3.2, '#f0f4f6', 0.8, false); bEm(-r, -0.8, r * 2, 0.15, era === 8 ? '#7ff0ff' : '#5fe6f0');
    bWg(-r * 0.5, -4.4, r, 2.4, 6, 2, 0.7, 0.5, '#6f9cb0', 0.6, LITO);
    bR(-0.12, -H, 0.24, H - 4.8, 'rgba(200,250,255,.85)'); bEm(-0.05, -H, 0.1, H - 4.8, '#bff8ff');
    for (let k = 0; k < 4; k++) bE(0, -8 - k * 5.5, 0.55, 0.22, '#e8f4f8');
    bGlow(0, -H * 0.5, 4, 'rgba(140,240,255,.45)'); bGlow(0, -4.8, 3.4, 'rgba(140,240,255,.6)'); bBcn(0, -H);
  }
}
function sMarketB(era, vi, hc, col) {
  if (era === 4) {
    const w = 5.6, d = 2.8, x = hX(w, d);
    for (let k = 0; k < 5; k++) bR(x + 0.1 + k * (w - 0.3) / 4, -2.0, 0.15, 2.0, '#3a3e44');
    bWin(x + 0.3, -1.5, w - 0.6, 1.4, null, 0.6, LITW2);
    bP('#8ab0c0', [x - 0.2, -2.0, x + w + 0.2, -2.0, x + w / 2 + 0.2 + d * OBX * 0.5, -3.4 - d * OBY * 0.5, x + w / 2 - 0.2 + d * OBX * 0.5, -3.4 - d * OBY * 0.5]);
    bP('#6a8a9a', [x + w + 0.2, -2.0, x + w + 0.2 + d * OBX, -2.0 - d * OBY, x + w / 2 + 0.2 + d * OBX * 0.5, -3.4 - d * OBY * 0.5]);
    bShd(x, 0, w, 3.2, d);
    if (bM === 1) for (let k = 1; k < 7; k++) bL(x - 0.2 + k * (w + 0.4) / 7, -2.0, x + w / 2 + d * OBX * 0.5, -3.4 - d * OBY * 0.5, 0.06, '#3a3e44');
    return;
  }
  const cols = [col, '#e8d8a8', '#c84a3a', '#4a8a5a', '#3a6ac8'];
  for (let k = 0; k < 3; k++) {
    const x = -3.2 + k * 2.3, y = k === 1 ? -0.6 : 0, ac = cols[(k + bSeed) % 5];
    bBox(x, y, 1.6, 0.7, 0.9, '#8a6438');
    for (let g = 0; g < 4; g++) bE(x + 0.25 + g * 0.38, y - 0.75, 0.16, 0.12, ['#e0b040', '#c84a3a', '#7aa04a', '#e88a3a'][(g + k) % 4]);
    bR(x + 0.05, y - 1.9, 0.1, 1.2, '#5a4028'); bR(x + 1.45, y - 1.9, 0.1, 1.2, '#5a4028');
    bAwn(x - 0.1, y - 2.0, 1.8, ac);
  }
  if (era >= 2) bGlow(0, -1.0, 2.8, 'rgba(255,190,110,.55)');
}
function sParkB(era, vi, hc, col) {
  bP('#5d8f45', [-3.4, 0.4, 2.6, 0.4, 3.6, -1.6, -2.4, -1.6]);
  bP('#c8c0a8', [-0.5, 0.4, 0.5, 0.4, 1.0, -1.6, 0.0, -1.6]); bP('#c8c0a8', [-3.0, -0.4, 3.0, -0.4, 3.2, -0.8, -2.8, -0.8]);
  bE(0.3, -0.6, 1.2, 0.5, '#d8d4cc'); bE(0.3, -0.65, 0.95, 0.38, '#5aa0d0'); bR(0.24, -1.5, 0.12, 0.9, '#e8f4ff');
  if (bM === 1) { bE(0.3, -1.6, 0.35, 0.25, 'rgba(230,245,255,.8)'); }
  bTree(-2.2, -0.9, 0.6, 0, 0.3); bTree(2.6, -1.1, 0.55, 0, 0.8); bTree(-1.4, 0.3, 0.5, 4, 0.5);
  bGlow(0.3, -0.8, 2.6, era >= 6 ? 'rgba(160,230,255,.5)' : 'rgba(255,200,130,.5)');
}
function sTreeB(era, vi) { const sp = (vi / 3) | 0, sz = vi % 3; bTree(0, 0, 0.62 + sz * 0.16, sp, sz / 2); }
function sLampB(era) {
  if (era === 4) { bR(-0.07, -2.2, 0.14, 2.2, '#22262a'); bR(-0.22, -2.6, 0.44, 0.45, '#2a2e32'); bEm(-0.15, -2.55, 0.3, 0.32, '#ffd890'); bGlow(0, -2.2, 2.6, 'rgba(255,200,120,.7)'); bGlow(0, 0, 2.2, 'rgba(255,190,110,.45)'); }
  else { const c = era >= 6 ? '#e8ecf0' : '#8a9096'; bR(-0.06, -2.9, 0.12, 2.9, c); bR(-0.06, -2.95, 0.8, 0.12, c); bEm(0.35, -2.85, 0.45, 0.12, era >= 6 ? '#e8f6ff' : '#ffc070'); bGlow(0.55, -2.6, 2.8, era >= 6 ? 'rgba(220,240,255,.6)' : 'rgba(255,180,90,.7)'); bGlow(0.5, 0, 2.4, era >= 6 ? 'rgba(220,240,255,.35)' : 'rgba(255,180,90,.45)'); }
}
function sTowerB(era) {
  if (era === 0) { for (const lx of [-0.9, 0.8]) bR(lx, -3.2, 0.18, 3.2, '#5a3e24'); bBox(-1.1, -2.8, 2.2, 0.35, 1.2, '#7a5a38'); bCone(0.2, -3.2, 1.4, 1.4, '#c39c50', 0.5, false); return; }
  const st = era <= 2 ? '#a39d90' : '#aea79a';
  if (era <= 2) { bCyl(0, 0, 1.15, 3.4, st, 0.45, false); for (let k = 0; k < 5; k++) bR(-1.1 + k * 0.5, -3.75, 0.3, 0.4, st); bWin(-0.12, -2.4, 0.24, 0.6, '#1e2026', 0.5, LITW); bGlow(0, -2.0, 1.2, 'rgba(255,180,90,.6)'); }
  else { bBox(-1.5, 0, 3.0, 2.6, 1.6, st); bStone(-1.5, 0, 3.0, 2.6); for (let k = 0; k < 5; k++) bBox(-1.5 + k * 0.66, -2.6, 0.36, 0.35, 0.3, st); bWin(-0.15, -1.8, 0.3, 0.5, '#1e2026', 0.5, LITW); }
}
function sMineB(era, vi) {
  const r = RES[vi], c = RES_RGB[r], oc = cHex(c[0], c[1], c[2]);
  bE(0.6, 0.2, 2.8, 1.0, '#6a5a46');
  if (era >= 4) {
    bBox(-2.2, 0, 2.0, 1.4, 1.6, '#7a7068'); bR(-1.7, -1.0, 0.9, 1.0, '#2a2420');
    if (bM === 1) { bL(-0.9, 0, 0.2, -5, 0.2, '#4a4e54'); bL(1.3, 0, 0.2, -5, 0.2, '#4a4e54'); bL(0.2, -5, 0.2, -1.2, 0.12, '#4a4e54'); bL(-0.6, -1.4, 1.0, -1.4, 0.1, '#4a4e54'); bL(-0.3, -3.0, 0.7, -3.0, 0.1, '#4a4e54'); }
    bShdP([-0.9, 0, 1.3, 0, 0.2, -0.6], 5);
    bE(0.2, -5.0, 0.55, 0.55, '#6a6e74'); bE(0.2, -5.0, 0.3, 0.3, '#3a3e44');
  } else {
    bR(-1.5, -2.0, 3.0, 0.5, '#8a6a44'); bR(-1.5, -2.0, 0.45, 2.0, '#8a6a44'); bR(1.05, -2.0, 0.45, 2.0, '#8a6a44'); bR(-1.05, -1.5, 2.1, 1.5, '#1e1814');
  }
  bP('#5a4a3a', [1.4, 0.3, 3.4, 0.3, 2.4, -1.0]); bP(oc, [1.9, -0.05, 2.9, -0.05, 2.4, -0.75]); bE(2.1, 0.1, 0.25, 0.15, oc);
}
const BLD = { house: (e, v, h, c) => HOUSE[e](v, h, c), palace: sPalaceB, hall: sHallB, temple: sTempleB, lab: sLabB, inst: sInstB, factory: sFactoryB, port: sPortB, ware: sWareB, wonder: sWonderB, market: sMarketB, park: sParkB, tree: sTreeB, lamp: sLampB, tower: sTowerB, mine: sMineB };
const NOCOL = { tree: 1, lamp: 1, tower: 1, mine: 1, port: 1 };

/* ---- sprite cache ---- */
const SPR = new Map(), SPALT = new Map(), SPSCR = [], CGLOW = [];
const SPB = [3e6, 5e6, 9e6, 16e6];
let sprPx = 0, sprGen = 0, sprGfx = -1, sprFrame = -1, sprNew = 0, sprCap = 0, sprK = 4, sprZoom = false, glowCv = null;
function sprScratch(i, w, h) { let c = SPSCR[i]; if (!c) c = SPSCR[i] = document.createElement('canvas'); if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); } return c; }
function sprMake(K, kind, era, vi, hc, col) {
  const f = BLD[kind];
  bK = K; bM = 0; bBB[0] = bBB[1] = 1e9; bBB[2] = bBB[3] = -1e9; bSH.length = 0; bAO.length = 0; bLitN = 0;
  bSeed = (hash2(kind.length * 31 + era * 7 + vi, hc * 13 + 5) & 0xffff) || 1; bMeta = { sm: [], fl: [], bc: [], fi: [] };
  f(era, vi, hc, col);
  if (bBB[0] > bBB[2]) return null;
  if (GFX.shadows) for (const p of bSH) for (let k = 0; k < p.length; k += 2) bbx(p[k], p[k + 1]);
  const pad = 2 + Math.ceil(K * 0.25);
  const ox = Math.ceil(-bBB[0] * K) + pad, oy = Math.ceil(-bBB[1] * K) + pad, w = Math.ceil(bBB[2] * K) + ox + pad, h = Math.ceil(bBB[3] * K) + oy + pad;
  if (w * h > 4e6) return null;
  const A = sprScratch(0, w, h), a = A.getContext('2d');
  a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, w, h); a.setTransform(K, 0, 0, K, ox, oy);
  bX = a; bM = 1; f(era, vi, hc, col);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const F = cv.getContext('2d');
  if (GFX.shadows && bSH.length) {
    F.setTransform(K, 0, 0, K, ox, oy);
    if (GFX.detail >= 2 && bAO.length) { F.filter = `blur(${(K * 0.35).toFixed(1)}px)`; F.fillStyle = 'rgba(14,12,10,.32)'; F.beginPath(); for (const p of bAO) { F.moveTo(p[0], p[1]); for (let k = 2; k < p.length; k += 2) F.lineTo(p[k], p[k + 1]); F.closePath(); } F.fill(); }
    F.filter = GFX.detail >= 2 ? `blur(${Math.max(0.6, K * 0.1).toFixed(1)}px)` : 'none';
    F.fillStyle = 'rgba(18,24,42,.28)'; F.beginPath(); for (const p of bSH) { F.moveTo(p[0], p[1]); for (let k = 2; k < p.length; k += 2) F.lineTo(p[k], p[k + 1]); F.closePath(); } F.fill();
    F.filter = 'none'; F.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (GFX.detail >= 1 && K >= 3) {
    const B = sprScratch(1, w, h), b = B.getContext('2d'), t = Math.max(1, K * 0.075);
    b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = 'source-over'; b.clearRect(0, 0, w, h);
    for (const [dx, dy] of [[t, 0], [-t, 0], [0, t], [0, -t]]) b.drawImage(A, 0, 0, w, h, dx, dy, w, h);
    b.globalCompositeOperation = 'source-in'; b.fillStyle = 'rgba(26,20,16,.5)'; b.fillRect(0, 0, w, h); b.globalCompositeOperation = 'source-over';
    F.drawImage(B, 0, 0, w, h, 0, 0, w, h);
  }
  F.drawImage(A, 0, 0, w, h, 0, 0, w, h);
  bM = 0; bX = null;
  return { cv, nv: null, ox, oy, w, h, K, px: w * h, u: 0, lt: bLitN > 0, a: [kind, era, vi, hc, col], sm: bMeta.sm, fl: bMeta.fl, bc: bMeta.bc, fi: bMeta.fi, bk: '' };
}
// the night layer is painted lazily the first time a city is dark
function sprNight(e) {
  if (e.nv !== null || sprNew >= sprCap) return e.nv;
  sprNew++;
  const [kind, era, vi, hc, col] = e.a, f = BLD[kind], w = e.w, h = e.h;
  const A = sprScratch(0, w, h), a = A.getContext('2d');
  a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, w, h); a.setTransform(e.K, 0, 0, e.K, e.ox, e.oy);
  bK = e.K; bX = a; bM = 2; bLitC = 0; bSeed = (hash2(kind.length * 31 + era * 7 + vi, hc * 13 + 5) & 0xffff) || 1; bMeta = { sm: [], fl: [], bc: [], fi: [] };
  f(era, vi, hc, col);
  bM = 0; bX = null;
  if (!bLitC) { e.nv = false; e.lt = false; return null; }
  const nv = document.createElement('canvas'); nv.width = w; nv.height = h; const N = nv.getContext('2d');
  if (GFX.detail >= 1) { N.filter = `blur(${Math.max(1, e.K * 0.4).toFixed(1)}px)`; N.globalAlpha = 0.85; N.drawImage(A, 0, 0, w, h, 0, 0, w, h); N.filter = 'none'; N.globalAlpha = 1; }
  N.drawImage(A, 0, 0, w, h, 0, 0, w, h);
  e.nv = nv; e.px += w * h; sprPx += w * h;
  return nv;
}
function sprBegin() {
  sprFrame = frameNo; sprNew = 0; CGLOW.length = 0;
  if (sprGfx !== gfxVersion) { SPR.clear(); SPALT.clear(); sprPx = 0; sprGen++; sprGfx = gfxVersion; }
  const kr = cam.z * view.dpr, kmax = [6, 10, 16, 24][GFX.level];
  sprK = Math.min(kmax, Math.max(2, Math.pow(2, Math.ceil(Math.log2(kr) * 2 - 0.25) / 2)));
  sprCap = [12, 18, 28, 40][GFX.level];
  sprZoom = Math.abs(cam.tz - cam.z) > cam.z * 0.004;
  if (sprPx > SPB[GFX.level]) {
    const old = []; for (const [k, e] of SPR) if (e.u < frameNo - 1) old.push([k, e]);
    old.sort((p, q) => p[1].u - q[1].u);
    for (const [k, e] of old) { if (sprPx <= SPB[GFX.level] * 0.7) break; SPR.delete(k); sprPx -= e.px; e.cv = null; e.nv = null; if (SPALT.get(e.bk) === e) SPALT.delete(e.bk); }
  }
}
function sprGet(kind, era, vi, hc, col, K) {
  const bk = kind + '|' + era + '|' + vi + '|' + hc + '|' + col, key = bk + '|' + K;
  let e = SPR.get(key);
  if (e) { e.u = frameNo; return e; }
  const alt = SPALT.get(bk);
  if (alt && alt.cv && (sprZoom || sprNew >= sprCap)) { alt.u = frameNo; return alt; }
  if (sprNew >= sprCap * 2) return null;
  sprNew++;
  e = sprMake(K, kind, era, vi, hc, col);
  if (!e) return null;
  e.bk = bk; e.u = frameNo; SPR.set(key, e); SPALT.set(bk, e); sprPx += e.px;
  return e;
}
function itemSprite(it, era, col, K) {
  const e0 = it._e;
  if (e0 && e0.cv && it._k === K && it._c === col && it._g === sprGen) { e0.u = frameNo; return e0; }
  const kind = it.t === 'mine' ? 'mine' : it.t, e = sprGet(kind, era, it.vi || 0, it.hc || 0, NOCOL[kind] ? '' : col, K);
  if (e && e.K === K) { it._e = e; it._k = K; it._c = col; it._g = sprGen; }
  return e;
}
function glowSprite() {
  if (glowCv) return glowCv;
  glowCv = document.createElement('canvas'); glowCv.width = glowCv.height = 64; const g = glowCv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(0.35, 'rgba(255,170,90,.45)'); gr.addColorStop(1, 'rgba(255,140,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return glowCv;
}
const GROUND = [['#7d6646', 0.32], ['#b39a70', 0.36], ['#958772', 0.38], ['#9d907c', 0.38], ['#6d6863', 0.42], ['#87878a', 0.42], ['#7e8388', 0.42], ['#c3ccd0', 0.4], ['#b4c0c8', 0.42]];
const STREET = ['#9a8462', '#b8a27c', '#8f8576', '#8a8173', '#4f4c4a', '#55585c', '#4a4e54', '#b8c2c8', '#a4b0b8'];
const groundCv = [];
function groundSprite(era) {
  if (groundCv[era]) return groundCv[era];
  const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d'), [col, a] = GROUND[era], rgb = cRgb(col);
  const gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
  gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(0.62, `rgba(${rgb},${a * 0.75})`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
  const rnd = mulberry32(era * 31 + 7);
  for (let k = 0; k < 420; k++) { const r = Math.sqrt(rnd()) * 44, t = rnd() * TAU, x = 48 + Math.cos(t) * r, y = 48 + Math.sin(t) * r; g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.05 * (1 - r / 48)})` : `rgba(255,250,235,${0.06 * (1 - r / 48)})`; g.fillRect(x, y, 2, 2); }
  return (groundCv[era] = c);
}
function drawCityGround(lay, z, sx0, sy0) {
  const era = lay.era, rx = (lay.r + (lay.grid ? 7 : 5)) * z, ry = rx * 0.8;
  ctx.drawImage(groundSprite(era), sx0 - rx, sy0 - ry, rx * 2, ry * 2);
  const sc = STREET[era];
  if (lay.pz) { ctx.fillStyle = era >= 4 ? (era >= 7 ? '#d6dde0' : '#a8a49c') : era >= 2 ? '#a69a86' : 'rgba(170,146,110,.75)'; const r = lay.pz[2] * z, px = sx0 + (lay.pz[0] - lay.cx) * z, py = sy0 + (lay.pz[1] - lay.cy) * z; ctx.beginPath(); if (lay.grid) ctx.rect(px - r, py - r * 0.55, r * 2, r * 0.95); else ctx.ellipse(px, py, r, r * 0.62, 0, 0, TAU); ctx.fill(); }
  if (lay.st.length) {
    ctx.fillStyle = sc;
    for (const s of lay.st) ctx.fillRect(sx0 + (s[0] - lay.cx) * z, sy0 + (s[1] - lay.cy) * z, s[2] * z, s[3] * z);
    if (z >= 3.5 && GFX.detail >= 1) {
      ctx.fillStyle = era >= 5 ? 'rgba(240,226,150,.55)' : 'rgba(255,255,255,.12)';
      for (const s of lay.st) { if (s[2] > s[3]) { if (era >= 5) for (let x = s[0] + 0.6; x < s[0] + s[2] - 0.8; x += 1.6) ctx.fillRect(sx0 + (x - lay.cx) * z, sy0 + (s[1] + s[3] / 2 - 0.05 - lay.cy) * z, 0.8 * z, Math.max(1, 0.1 * z)); else ctx.fillRect(sx0 + (s[0] - lay.cx) * z, sy0 + (s[1] - lay.cy) * z, s[2] * z, Math.max(1, 0.12 * z)); } }
    }
  }
  if (lay.ln.length) {
    ctx.strokeStyle = sc; ctx.globalAlpha = 0.8; ctx.lineWidth = Math.max(1, 1.15 * z); ctx.lineCap = 'round'; ctx.beginPath();
    for (const l of lay.ln) { ctx.moveTo(sx0, sy0); ctx.quadraticCurveTo(sx0 + l[2] * z, sy0 + l[3] * z, sx0 + l[0] * z, sy0 + l[1] * z); }
    ctx.stroke(); ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
  }
}
const WALLC = [['#7a5634', '#9a7448'], ['#b8a07a', '#cdb894'], ['#9a9488', '#b2ac9f'], ['#a29c90', '#bab4a6'], ['#a29c90', '#bab4a6']];
function drawWallSeg(lay, it, z, era, sx0, sy0) {
  const R = lay.wall * z, ry = R * 0.75, wh = (era === 0 ? 1.7 : era <= 2 ? 2.1 : 2.4) * z, [fc, tc] = WALLC[era], n = 6;
  const px = [], py = [];
  for (let k = 0; k <= n; k++) { const a = it.a0 + (it.a1 - it.a0) * k / n; px.push(sx0 + Math.cos(a) * R); py.push(sy0 + Math.sin(a) * ry); }
  const am = (it.a0 + it.a1) / 2;
  if (px[0] < -wh * 3 && px[n] < -wh * 3 || px[0] > view.w + wh * 3 && px[n] > view.w + wh * 3) return;
  if (era === 0) {
    ctx.strokeStyle = fc; ctx.lineWidth = wh; ctx.setLineDash([Math.max(1, 0.42 * z), Math.max(0.5, 0.14 * z)]);
    ctx.beginPath(); for (let k = 0; k <= n; k++) ctx[k ? 'lineTo' : 'moveTo'](px[k], py[k] - wh / 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = tc; ctx.lineWidth = Math.max(1, 0.2 * z); ctx.beginPath(); for (let k = 0; k <= n; k++) ctx[k ? 'lineTo' : 'moveTo'](px[k], py[k] - wh * 0.7); ctx.stroke();
    return;
  }
  ctx.fillStyle = cSh(fc, 0.92 - 0.14 * Math.cos(am));
  ctx.beginPath(); for (let k = 0; k <= n; k++) ctx[k ? 'lineTo' : 'moveTo'](px[k], py[k]); for (let k = n; k >= 0; k--) ctx.lineTo(px[k], py[k] - wh); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = tc; ctx.lineWidth = Math.max(1, 0.75 * z); ctx.beginPath(); for (let k = 0; k <= n; k++) ctx[k ? 'lineTo' : 'moveTo'](px[k], py[k] - wh - 0.2 * z); ctx.stroke();
  if (z >= 2.5) { ctx.strokeStyle = fc; ctx.lineWidth = Math.max(1, 0.4 * z); ctx.setLineDash([0.45 * z, 0.4 * z]); ctx.beginPath(); for (let k = 0; k <= n; k++) ctx[k ? 'lineTo' : 'moveTo'](px[k], py[k] - wh - 0.6 * z); ctx.stroke(); ctx.setLineDash([]); }
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); for (let k = 0; k <= n; k++) ctx[k ? 'lineTo' : 'moveTo'](px[k], py[k]); for (let k = n; k >= 0; k--) ctx.lineTo(px[k], py[k] - Math.min(wh, 0.5 * z)); ctx.closePath(); ctx.fill();
}
function drawFlagAt(x, y, z, col, ph) {
  const h = 3.0 * z, fw = 1.9 * z, fh = 1.15 * z, t0 = animT * 4.5 + ph;
  ctx.fillStyle = '#2a2420'; ctx.fillRect(x - Math.max(0.5, 0.09 * z), y - h, Math.max(1, 0.18 * z), h);
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - h);
  for (let k = 1; k <= 4; k++) { const t = k / 4; ctx.lineTo(x + fw * t, y - h + Math.sin(t0 - t * 3) * 0.22 * z * t); }
  for (let k = 4; k >= 0; k--) { const t = k / 4; ctx.lineTo(x + fw * t, y - h + fh + Math.sin(t0 - t * 3) * 0.22 * z * t); }
  ctx.closePath(); ctx.fill();
  if (z >= 4) { ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x, y - h + fh * 0.62, fw * 0.95, fh * 0.12); }
}
function drawFireAt(x, y, z, night, ph) {
  const f = Math.sin(animT * 13 + ph) * 0.5 + 0.5, g = Math.sin(animT * 21 + ph * 2) * 0.5 + 0.5;
  ctx.fillStyle = '#4a3020'; ctx.fillRect(x - 0.75 * z, y - 0.15 * z, 1.5 * z, 0.3 * z);
  ctx.fillStyle = '#ff8a30'; ctx.beginPath(); ctx.moveTo(x - 0.6 * z, y); ctx.lineTo(x - 0.1 * z + g * 0.2 * z, y - (1.3 + f * 0.5) * z); ctx.lineTo(x + 0.6 * z, y); ctx.fill();
  ctx.fillStyle = '#ffd36a'; ctx.beginPath(); ctx.moveTo(x - 0.3 * z, y); ctx.lineTo(x + g * 0.15 * z, y - (0.7 + g * 0.3) * z); ctx.lineTo(x + 0.3 * z, y); ctx.fill();
  if (GFX.detail >= 1) { const r = (2.4 + f * 0.4) * z; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.18 + night * 0.4; ctx.drawImage(glowSprite(), x - r, y - r * 0.8, r * 2, r * 1.6); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
}
// lights are drawn again additively by drawCityLights() once the night tint has been laid over the scene
function drawCityLights(z) {
  if (cglowF !== frameNo || !CGLOW.length) return;
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < CGLOW.length; k += 6) { ctx.globalAlpha = CGLOW[k + 5] * 0.55; ctx.drawImage(CGLOW[k], CGLOW[k + 1], CGLOW[k + 2], CGLOW[k + 3], CGLOW[k + 4]); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; CGLOW.length = 0;
}
let cglowF = -1;
function drawCitySprites(c, z) {
  if (sprFrame !== frameNo) { sprBegin(); cglowF = frameNo; }
  const lay = layoutFor(c), n = S.nations[c.n], era = lay.era, col = n.color, K = sprK;
  const sx0 = sxOf(lay.cx), sy0 = syOf(lay.cy), night = nightAt(lay.cx, lay.cy), nl = smooth(0.3, 0.7, night);
  drawCityGround(lay, z, sx0, sy0);
  const deco = GFX.detail >= 1 && z >= 2.1, vw = view.w, vh = view.h, mL = -18 * z, mR = vw + 9 * z, mT = -7 * z, mB = vh + 30 * z;
  const smoke = playing && z >= 2 && GFX.parts > 0, rate = 0.011 * GFX.parts;
  for (const m of lay.mines) {
    const sx = sxOf(m[0]), sy = syOf(m[1]);
    if (sx < mL || sx > mR || sy < mT || sy > mB) continue;
    const e = sprGet('mine', era >= 4 ? 4 : 0, RES.indexOf(m[2]), 0, '', K);
    if (e) { const s = z / e.K; ctx.drawImage(e.cv, sx - e.ox * s, sy - e.oy * s, e.w * s, e.h * s); }
  }
  for (const it of lay.items) {
    const t = it.t;
    if (t === 'wseg') { drawWallSeg(lay, it, z, era, sx0, sy0); continue; }
    if (!deco && (t === 'tree' || t === 'lamp' || t === 'park' || t === 'market')) continue;
    const sx = sx0 + (it.x - lay.cx) * z, sy = sy0 + (it.y - lay.cy) * z;
    if (sx < mL || sx > mR || sy < mT || sy > mB) continue;
    const e = itemSprite(it, t === 'tower' ? Math.min(era, 4) : era, col, K);
    if (!e) continue;
    const s = z / e.K, dx = sx - e.ox * s, dy = sy - e.oy * s, dw = e.w * s, dh = e.h * s;
    ctx.drawImage(e.cv, dx, dy, dw, dh);
    if (nl > 0 && e.lt) { const nv = e.nv || sprNight(e); if (nv) { ctx.globalAlpha = nl; ctx.drawImage(nv, dx, dy, dw, dh); ctx.globalAlpha = 1; CGLOW.push(nv, dx, dy, dw, dh, nl); } }
    if (z >= 2.4) {
      for (const f of e.fl) drawFlagAt(sx + f[0] * z, sy + f[1] * z, z * 0.8, col, it.x * 0.3 + f[0]);
      for (const f of e.fi) drawFireAt(sx + f[0] * z, sy + f[1] * z, z, nl, it.x + f[0]);
      if (z >= 3) for (const b of e.bc) if (Math.sin(animT * 2.4 + it.v * 9 + b[1]) > 0.55) { ctx.fillStyle = '#ff3a2a'; const r = Math.max(1.5, 0.3 * z); ctx.fillRect(sx + b[0] * z - r / 2, sy + b[1] * z - r / 2, r, r); }
    }
    if (smoke && e.sm.length) for (const p of e.sm) {
      if (p[2]) { if (rand2() < 0.08) { const fossil = Math.max(0, 1 - n.nuke - n.renew - n.fusion); if (rand2() < 0.2 + fossil) particle(it.x + p[0], it.y + p[1], 0.4 + (rand2() - 0.3) * 1.2, -2.2 - rand2(), 3 + rand2() * 2, fossil > 0.4 ? '#77706a' : '#c8ccd0', 1.2, 2.5, 0.55); } }
      else if (rand2() < rate) particle(it.x + p[0], it.y + p[1], 0.5 + rand2() * 0.6, -1.3 - rand2() * 0.7, 2.4 + rand2() * 1.4, '#8e8a86', 0.45, 1.6, 0.3);
    }
  }
}
