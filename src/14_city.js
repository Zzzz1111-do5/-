/* =====================================================================
   City layouts and building sprites
   ===================================================================== */
const SKINS = ['#f1c9a1', '#dba67a', '#b67b52', '#8c5b3a', '#f3d6b3', '#c69068'];
const HAIRS = ['#2a1e14', '#5a3a1e', '#d6be6e', '#1b1b1b', '#8a4a24'];
function landAt(x, y) { const xi = ((Math.round(x) % MW) + MW) % MW, yi = Math.round(y); if (yi < 0 || yi >= MH) return false; return !MWATER[yi * MW + xi]; }
function layoutFor(c) {
  const n = S.nations[c.n], era = n.mult.era;
  const bucket = Math.max(0, Math.round(Math.log2(c.pop / 2e4 + 1) * 2));
  const nF = n.mult.ind > 0 ? Math.min(4, Math.ceil(c.fac / 6)) : 0, nL = n.mult.lab > 0 ? Math.min(3, Math.ceil(c.labs / 4)) : 0;
  const key = `${bucket}|${era}|${nF}|${nL}|${c.cap ? 1 : 0}|${n.mult.wall}|${(S.seaRise * 1000) | 0}|${S.terra.length}|${c.n}`;
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
  const hsz = [[3, 4], [3, 4], [3, 5], [3, 5], [3, 5], [4, 7], [4, 11], [4, 13], [4, 13]][era];
  const place = (t, w, h, maxR, startK) => {
    for (let k = startK || 0; k < 500; k++) {
      const ang = k * 2.39996 + rng() * 0.3, rad = 2 + Math.sqrt(k) * 2.1;
      if (rad > maxR) return null;
      const x = Math.round(cx + Math.cos(ang) * rad), y = Math.round(cy + Math.sin(ang) * rad * 0.75);
      if (free(x, y, w, h)) { take(x, y, w, h); const it = { t, x, y, v: rng() }; items.push(it); return it; }
    }
    return null;
  };
  const nb = clamp(Math.round(3 + bucket * 2.4), 3, 60);
  const maxR = 6 + Math.sqrt(nb) * 3.2;
  const center = place(c.cap ? 'palace' : 'hall', 7, 8, maxR);
  if (center) patrol.push([center.x - 3, center.y + 1], [center.x + 3, center.y + 1]);
  if (era >= 1 && era <= 3 && bucket >= 4) place('temple', 4, 5, maxR, 6);
  for (let k = 0; k < nL; k++) { const it = place('lab', 5, 5, maxR, 8); if (it) labs.push([it.x, it.y + 1]); }
  for (let k = 0; k < nF; k++) { const it = place('factory', 7, 6, maxR + 6, 20); if (it) factories.push([it.x, it.y + 1]); }
  let placed = 0;
  for (let k = 3; k < 600 && placed < nb; k++) {
    const ang = k * 2.39996, rad = 2 + Math.sqrt(k) * 2.1;
    if (rad > maxR + 4) break;
    const x = Math.round(cx + Math.cos(ang) * rad + (rng() - 0.5) * 1.5), y = Math.round(cy + Math.sin(ang) * rad * 0.75 + (rng() - 0.5) * 1.5);
    if (!free(x, y, hsz[0], Math.min(hsz[1], 5))) continue;
    take(x, y, hsz[0], Math.min(hsz[1], 5));
    const it = { t: 'house', x, y, v: rng() }; items.push(it); homes.push([x, y + 1]); placed++;
  }
  if (!homes.length) homes.push([cx, cy + 1]);
  let port = null;
  if (c.coastal) {
    for (let k = 0; k < 900 && !port; k++) {
      const ang = k * 2.39996, rad = 3 + Math.sqrt(k) * 0.9;
      const x = Math.round(cx + Math.cos(ang) * rad), y = Math.round(cy + Math.sin(ang) * rad);
      if (!landAt(x, y) && landAt(x - Math.sign(Math.cos(ang)) * 2, y - Math.sign(Math.sin(ang)) * 2)) port = { t: 'port', x, y, v: rng(), dir: Math.cos(ang) >= 0 ? 1 : -1 };
    }
    if (port) items.push(port);
  }
  let wall = 0;
  if (n.mult.wall && era <= 4 && bucket >= 3) { wall = Math.round(maxR * 0.85); for (let a = 0; a < 6; a++) patrol.push([Math.round(cx + Math.cos(a * 1.05) * wall), Math.round(cy + Math.sin(a * 1.05) * wall * 0.75)]); }
  if (!patrol.length) patrol.push([cx, cy + 2]);
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
  c.lay = { key, cx, cy, r: maxR, items, homes, labs, factories, patrol, farms, forests, mines, wall, era };
  return c.lay;
}

let SPX = 0, SPY = 0, SPZ = 1;
function pr(x, y, w, h, col) {
  const x0 = Math.round(SPX + x * SPZ), y0 = Math.round(SPY + y * SPZ), x1 = Math.round(SPX + (x + w) * SPZ), y1 = Math.round(SPY + (y + h) * SPZ);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}
function shade(hex, k) { const v = parseInt(hex.slice(1), 16); const r = Math.round(((v >> 16) & 255) * k), g = Math.round(((v >> 8) & 255) * k), b = Math.round((v & 255) * k); return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`; }
function sHouse(era, roof, v) {
  if (era <= 0) { pr(-1.5, -2, 3, 2, '#8a6a44'); pr(-1.5, -3, 3, 1, '#d6b264'); pr(-0.5, -3.6, 1, 0.6, '#c49a50'); pr(-0.5, -1, 1, 1, '#3a2a18'); return; }
  if (era === 1) { pr(-1.5, -2, 3, 2, '#c9a676'); pr(-1.5, -3, 3, 1, roof); pr(-0.5, -1, 1, 1, '#4a3420'); return; }
  if (era === 2) { const t = v > 0.6 ? 3 : 2; pr(-1.5, -t, 3, t, '#a3a6aa'); pr(-1.5, -t - 1, 3, 1, roof); pr(-0.5, -1, 1, 1, '#3a3028'); if (t === 3) pr(-1, -2.4, 0.7, 0.6, '#f0d890'); return; }
  if (era === 3) { pr(-1.5, -3, 3, 3, '#e6dccb'); pr(-1.5, -2, 3, 0.35, '#7a5636'); pr(-0.2, -3, 0.4, 3, '#7a5636'); pr(-1.5, -4, 3, 1, roof); pr(-0.5, -1, 1, 1, '#4a3420'); return; }
  if (era === 4) { pr(-1.5, -3, 3, 3, '#a4553c'); pr(-1.5, -3.6, 3, 0.6, '#3a3a44'); pr(0.6, -4.4, 0.6, 1, '#5a3a30'); pr(-1, -2.2, 0.6, 0.6, '#f0d890'); pr(0.4, -2.2, 0.6, 0.6, '#f0d890'); pr(-0.4, -1, 0.8, 1, '#2a2024'); return; }
  if (era === 5) { const h = 4 + Math.round(v * 2); pr(-2, -h, 4, h, '#b9b8b0'); for (let yy = -h + 0.6; yy < -0.9; yy += 1.1) { pr(-1.5, yy, 0.7, 0.6, '#5a6a78'); pr(-0.35, yy, 0.7, 0.6, v > 0.5 ? '#e8d890' : '#5a6a78'); pr(0.8, yy, 0.7, 0.6, '#5a6a78'); } pr(-2, -h - 0.4, 4, 0.4, roof); return; }
  if (era === 6) { const h = 6 + Math.round(v * 4); pr(-2, -h, 4, h, '#4f8fbf'); for (let yy = -h + 0.6; yy < -0.5; yy += 1) pr(-2, yy, 4, 0.3, '#8cc8ec'); pr(-0.3, -h - 1, 0.6, 1, '#cfd8e0'); pr(-2, -h, 4, 0.4, roof); return; }
  const h = 7 + Math.round(v * 5); pr(-2, -h + 1, 4, h - 1, '#e6eef2'); pr(-1.4, -h, 2.8, 1, '#e6eef2'); pr(-2, -h * 0.62, 4, 0.5, '#57e0ec'); pr(-2, -h * 0.3, 4, 0.5, '#57e0ec'); pr(-0.3, -h - 1.5, 0.6, 1.5, roof);
}
function sFlag(x, y, col) { pr(x, y - 4, 0.4, 4, '#3a3028'); const wv = Math.sin(animT * 6 + x) > 0 ? 0.3 : 0; pr(x + 0.4, y - 4 + wv, 2.2, 1.2, col); }
function sPalace(era, col) {
  if (era <= 3) { pr(-3.5, -4, 7, 4, '#9c9a94'); pr(-3.5, -6, 2, 2, '#8c8a84'); pr(1.5, -6, 2, 2, '#8c8a84'); pr(-3.5, -6.5, 0.6, 0.5, '#8c8a84'); pr(-2.1, -6.5, 0.6, 0.5, '#8c8a84'); pr(1.5, -6.5, 0.6, 0.5, '#8c8a84'); pr(2.9, -6.5, 0.6, 0.5, '#8c8a84'); pr(-1, -5, 2, 1, col); pr(-0.7, -1.6, 1.4, 1.6, '#3a3028'); sFlag(0, -5, col); return; }
  if (era <= 5) { pr(-3.5, -4, 7, 4, '#e2d8c4'); for (let k = -3; k <= 2; k += 1.25) pr(k, -3.6, 0.5, 3.2, '#c8bca6'); pr(-1.8, -5.5, 3.6, 1.5, '#d4af37'); pr(-1, -6.4, 2, 0.9, '#d4af37'); pr(-0.7, -1.4, 1.4, 1.4, '#5a4a38'); sFlag(0, -6.4, col); return; }
  const h = 13; pr(-2.5, -h, 5, h, era >= 7 ? '#eef4f6' : '#5d9ccc'); for (let yy = -h + 1; yy < -1; yy += 1.2) pr(-2.5, yy, 5, 0.35, era >= 7 ? '#57e0ec' : '#9fd2f0'); pr(-0.3, -h - 3, 0.6, 3, '#d8dee4'); pr(-2.5, -h, 5, 0.5, col); sFlag(1.6, -h, col);
}
function sHall(era, col) {
  if (era <= 1) { pr(-0.3, -4, 0.6, 4, '#6a4a2c'); pr(-1, -4.6, 2, 0.6, col); const f = (Math.sin(animT * 9) > 0) ? '#ffb347' : '#ff8a3c'; pr(1.4, -1.2, 1, 1.2, f); pr(1.2, -0.3, 1.4, 0.3, '#5a3a20'); return; }
  if (era <= 3) { pr(-2.5, -3.5, 5, 3.5, '#d9d0bc'); for (let k = -2.2; k <= 1.8; k += 1.3) pr(k, -3.2, 0.45, 3.2, '#bfb39a'); pr(-3, -4.5, 6, 1, col); pr(-1.5, -5.2, 3, 0.7, col); return; }
  pr(-2.5, -4, 5, 4, '#c9b48e'); pr(-0.8, -6, 1.6, 2, '#c9b48e'); pr(-0.5, -5.6, 1, 1, '#f4f0e0'); pr(-2.5, -4.4, 5, 0.4, col); pr(-0.6, -1.4, 1.2, 1.4, '#4a3a2a');
}
function sTemple(col) { pr(-2, -3, 4, 3, '#e0d4b0'); pr(-2.5, -4, 5, 1, col); pr(-1.5, -4.8, 3, 0.8, col); pr(-0.5, -1.4, 1, 1.4, '#5a4a30'); }
function sLab(era) {
  if (era < 4) { pr(-2, -3, 4, 3, '#eeeef2'); pr(-2.5, -4, 5, 1, '#4a78c8'); pr(-0.5, -1.2, 1, 1.2, '#3a4a6a'); pr(-1.6, -2.4, 0.6, 0.6, '#9ab8f0'); pr(1, -2.4, 0.6, 0.6, '#9ab8f0'); return; }
  pr(-2.5, -2.5, 5, 2.5, '#eef2f6'); pr(-1.8, -3.5, 3.6, 1, '#dfe6ee'); pr(-1.2, -4.2, 2.4, 0.7, '#dfe6ee'); pr(0.2, -4.6, 1.8, 0.4, '#8090a0'); pr(-0.5, -1.2, 1, 1.2, '#4a5a6a');
}
function sFactory(era, it) {
  const base = era >= 6 ? '#8a98a4' : '#5c5c64';
  pr(-3.5, -3, 7, 3, base);
  for (let k = -3.5; k < 3.5; k += 1.75) { pr(k, -3.8, 0.9, 0.8, shade(base.length === 7 ? base : '#5c5c64', 0.8)); }
  pr(2.2, -6.5, 1, 3.5, '#4a4a50'); pr(2.2, -6.7, 1, 0.3, '#a04030');
  pr(-2.8, -1.8, 1, 0.8, '#f0c060'); pr(-1.2, -1.8, 1, 0.8, '#f0c060'); pr(0.6, -1.4, 1.2, 1.4, '#2a2a30');
}
function sPort(dir) { pr(dir > 0 ? 0 : -5, -0.6, 5, 1, '#8a6438'); pr(dir > 0 ? 1 : -2, -1.2, 0.5, 1.6, '#6a4a28'); pr(dir > 0 ? 3.5 : -4.5, -1.2, 0.5, 1.6, '#6a4a28'); }
function sMine(r) { pr(-1.5, -2, 3, 0.6, '#8a6a44'); pr(-1.5, -2, 0.5, 2, '#8a6a44'); pr(1, -2, 0.5, 2, '#8a6a44'); pr(-1, -1.4, 2, 1.4, '#221c18'); const c = RES_RGB[r]; pr(1.7, -0.9, 1.3, 0.9, '#5a4a3a'); pr(1.8, -1.3, 1.1, 0.5, `rgb(${c[0]},${c[1]},${c[2]})`); }
function drawWall(lay, z, era) {
  const col = era >= 3 ? '#a8a49a' : '#9a8e7a', tw = era >= 3 ? '#8e8a80' : '#857a66';
  const steps = Math.max(24, Math.round(lay.wall * 3));
  for (let k = 0; k < steps; k++) {
    const a = k / steps * TAU, x = lay.cx + Math.cos(a) * lay.wall, y = lay.cy + Math.sin(a) * lay.wall * 0.75;
    SPX = sxOf(x); SPY = syOf(y); SPZ = z;
    if (k % Math.round(steps / 6) === 0) { pr(-1, -2.5, 2, 2.5, tw); pr(-1, -3, 0.6, 0.5, tw); pr(0.4, -3, 0.6, 0.5, tw); }
    else pr(-0.7, -1.4, 1.4, 1.4, col);
  }
}
function drawCitySprites(c, z) {
  const lay = layoutFor(c), n = S.nations[c.n], era = lay.era, roof = n.color;
  if (lay.wall) drawWall(lay, z, era);
  for (const m of lay.mines) { SPX = sxOf(m[0]); SPY = syOf(m[1]); SPZ = z; sMine(m[2]); }
  for (const it of lay.items) {
    SPX = sxOf(it.x); SPY = syOf(it.y); SPZ = z;
    if (SPX < -60 || SPX > view.w + 60 || SPY < -80 || SPY > view.h + 40) continue;
    switch (it.t) {
      case 'house': sHouse(era, roof, it.v); break;
      case 'palace': sPalace(era, roof); break;
      case 'hall': sHall(era, roof); break;
      case 'temple': sTemple(roof); break;
      case 'lab': sLab(era); break;
      case 'factory': sFactory(era, it);
        if (playing && rand2() < 0.08) { const fossil = Math.max(0, 1 - n.nuke - n.renew - n.fusion); if (rand2() < 0.2 + fossil) particle(it.x + 2.7, it.y - 6.8, (rand2() - 0.3) * 1.2, -2.2 - rand2(), 3 + rand2() * 2, fossil > 0.4 ? '#77706a' : '#c8ccd0', 1.2, 2.5, 0.55); }
        break;
      case 'port': sPort(it.dir); break;
    }
  }
}

