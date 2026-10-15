/* =====================================================================
   Map scene
   ===================================================================== */
let screenCities = [];
let hoverCity = null, selected = null, selectedNation = -1, diploFrom = null;
function forVisibleCells(x0, y0, x1, y1, fn) {
  const cy0 = Math.max(0, Math.floor(y0 / PX)), cy1 = Math.min(H - 1, Math.floor(y1 / PX));
  const cx0 = Math.floor(x0 / PX), cx1 = Math.floor(x1 / PX);
  for (let cy = cy0; cy <= cy1; cy++) for (let cxr = cx0; cxr <= cx1; cxr++) fn(cy * W + (((cxr % W) + W) % W), cxr, cy);
}
function drawMapScene() {
  const sw = view.w, sh = view.h, z = cam.z;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  if (cam.shake > 0 && !reducedMotion) ctx.translate((Math.random() - 0.5) * cam.shake * 9, (Math.random() - 0.5) * cam.shake * 9);
  const x0 = cam.x - sw / 2 / z, x1 = cam.x + sw / 2 / z, y0 = cam.y - sh / 2 / z, y1 = cam.y + sh / 2 / z;
  drawBackdrop(x0, x1, z);
  const tiles = tilePlan(x0, y0, x1, y1, z);
  // the base bitmap is skipped once ready detail tiles cover the whole view
  if (!tiles || !tiles.full) { ctx.imageSmoothingEnabled = z * view.dpr < 2; drawMapImage(x0, x1, y0, y1, z, 0); }
  // tiles are filtered unless each sample already spans ≥ 1.9 device px on a hi-dpi screen (nearest is far cheaper there)
  ctx.imageSmoothingEnabled = !tiles || tiles.sc < 1.9 || (view.dpr < 1.5 && GFX.level >= 3);
  if (tiles) for (const [cv, s, xa, ya, w, h, a] of tiles.draw) { ctx.globalAlpha = a; ctx.drawImage(cv, 1, 1, s, s, xa, ya, w, h); }
  ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true;
  drawPolarSeam(x0, x1, z);
  if (GFX.water && z >= 1.3) drawWaterGlints(x0, y0, x1, y1, z);
  drawMapLayer(x0, y0, x1, y1, z);
  drawBorders(x0, y0, x1, y1, z);
  if (z >= 0.9) drawRoads(z);
  if (z >= 0.45) drawRails(z);
  const vis = [];
  for (const c of S.cities) {
    const [cx, cy] = cityMpx(c), sx = sxOf(cx), sy = syOf(cy);
    if (sx < -70 * z || sx > sw + 70 * z || sy < -70 * z || sy > sh + 70 * z) continue;
    vis.push({ c, x: sx, y: sy, cx, cy, r: 4 });
  }
  if (z >= BUILD_Z) { vis.sort((a, b) => a.cy - b.cy); for (const v of vis) { drawCitySprites(v.c, z); v.r = Math.max(10, layoutFor(v.c).r * z * 0.6); } }
  else for (const v of vis) {
    const c = v.c, n = S.nations[c.n];
    const dim = selectedNation >= 0 && c.n !== selectedNation;
    const rr = clamp(1.4 + Math.log10(Math.max(1, c.pop / 3e4)) * 1.4, 1.4, 6) * (0.75 + z * 0.4);
    ctx.globalAlpha = dim ? 0.3 : 1;
    ctx.fillStyle = n.color; ctx.strokeStyle = 'rgba(6,10,20,.85)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(v.x, v.y, rr, 0, TAU); ctx.fill(); ctx.stroke();
    if (c.cap) { ctx.strokeStyle = n.color; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(v.x, v.y, rr + 2.5, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1; v.r = rr + 3;
  }
  screenCities = vis;
  if (z >= AGENT_Z && showPeople) { drawAgents(z); drawProjectiles(z); }
  drawParticles(z);
  drawAmbient(z);
  if (z >= AGENT_Z && showPeople) drawBattleLabels(z);
  drawMapFx(z);
  drawWarMarks(z);
  drawSelection(z);
  if (showNames) drawCityLabels(vis, z);
}
// the base bitmap, repeated east-west; rows > 0 / < 0 limits it to the top / bottom rows (the mirrored polar backdrop)
function drawMapImage(x0, x1, y0, y1, z, rows) {
  const sw = view.w, sh = view.h;
  for (let k = Math.floor(x0 / MW); k * MW < x1; k++) {
    const ox = k * MW;
    const sx0 = Math.max(Math.floor(x0 - ox), 0), sx1 = Math.min(Math.ceil(x1 - ox), MW);
    const sy0 = rows < 0 ? Math.max(MH + rows, 0) : Math.max(Math.floor(y0), 0), sy1 = rows > 0 ? Math.min(rows, MH) : Math.min(Math.ceil(y1), MH);
    if (sx1 <= sx0 || sy1 <= sy0) continue;
    ctx.drawImage(mapCanvas, sx0, sy0, sx1 - sx0, sy1 - sy0, (ox + sx0 - cam.x) * z + sw / 2, (sy0 - cam.y) * z + sh / 2, (sx1 - sx0) * z, (sy1 - sy0) * z);
  }
}
// zoomed out the map is shorter than the stage: the polar edge colour (averaged over the outermost 24 map rows and
// smoothed east-west, so no texture repeats) bleeds into the letterbox and fades into deep space
let POLAR = null, polarDirty = true;
function polarStrips() {
  const n = MW / 8, cv = POLAR || document.createElement('canvas'); cv.width = n; cv.height = 2;
  const c = cv.getContext('2d'), im = c.createImageData(n, 2), d = im.data, D = mapImg.data, acc = new Float32Array(n * 3);
  for (let side = 0; side < 2; side++) {
    acc.fill(0);
    for (let r = 0; r < 24; r++) {
      const y = side ? MH - 1 - r : r, w = 1 - r / 30;
      for (let x = 0; x < MW; x++) { const q = (y * MW + x) * 4, k = (x >> 3) * 3; acc[k] += D[q] * w; acc[k + 1] += D[q + 1] * w; acc[k + 2] += D[q + 2] * w; }
    }
    for (let i = 0; i < n; i++) {   // wrap-around box blur over ±6 columns (±48 map px)
      let r = 0, g = 0, b = 0;
      for (let k = -6; k <= 6; k++) { const j = ((i + k + n) % n) * 3; r += acc[j]; g += acc[j + 1]; b += acc[j + 2]; }
      const q = (side * n + i) * 4, f = 1 / (13 * 8 * 14.8);
      d[q] = r * f; d[q + 1] = g * f; d[q + 2] = b * f; d[q + 3] = 255;
    }
  }
  c.putImageData(im, 0, 0); POLAR = cv; polarDirty = false;
}
function drawBackdrop(x0, x1, z) {
  const sw = view.w, sh = view.h, top = syOf(0), bot = syOf(MH);
  ctx.fillStyle = '#04101f'; ctx.fillRect(-20, -20, sw + 40, sh + 40);
  if (top <= 0 && bot >= sh) return;
  if (GFX.level && (polarDirty || !POLAR)) polarStrips();
  ctx.imageSmoothingEnabled = true;
  for (const side of [0, 1]) {
    const edge = side ? bot : top, hpx = side ? sh - bot : top;
    if (hpx <= 0) continue;
    const ya = side ? edge : -20, hh = hpx + 20, fade = Math.min(hpx, 26 + 160 * z);
    if (GFX.level) {
      // the strip is drawn per east-west copy of the map; its source row (0 north, 1 south) is stretched over the band
      for (let k = Math.floor(x0 / MW); k * MW < x1; k++) ctx.drawImage(POLAR, 0, side + 0.25, POLAR.width, 0.5, (k * MW - cam.x) * z + sw / 2, ya, MW * z, hh);
      const g = ctx.createLinearGradient(0, edge, 0, side ? edge + fade : edge - fade);
      g.addColorStop(0, 'rgba(4,16,31,0.05)'); g.addColorStop(0.18, 'rgba(4,16,31,0.32)'); g.addColorStop(0.55, 'rgba(4,15,30,0.8)'); g.addColorStop(1, 'rgba(4,16,31,1)');
      ctx.fillStyle = g; ctx.fillRect(-20, side ? edge : edge - fade, sw + 40, fade);
      if (hpx > fade) { ctx.fillStyle = '#04101f'; ctx.fillRect(-20, side ? edge + fade : -20, sw + 40, hpx - fade + 20); }
    } else {
      const g = ctx.createLinearGradient(0, edge, 0, side ? sh : 0); g.addColorStop(0, '#4a6178'); g.addColorStop(0.3, '#10243c'); g.addColorStop(1, '#04101f'); ctx.fillStyle = g; ctx.fillRect(-20, ya, sw + 40, hh);
    }
  }
}
// the polar edge strip feathered a few px into the map's outermost rows (in 4 alpha bands), so the painted map melts
// into the letterbox instead of ending in a hard line
function drawPolarSeam(x0, x1, z) {
  if (!GFX.level || !POLAR) return;
  const sw = view.w, sh = view.h, top = syOf(0), bot = syOf(MH), bh = Math.min(3, 1 + 2.5 * z);
  for (const side of [0, 1]) {
    const edge = side ? bot : top;
    if (side ? edge >= sh : edge <= 0) continue;
    for (let b = 0; b < 4; b++) {
      ctx.globalAlpha = [0.78, 0.5, 0.27, 0.1][b];
      const ya = side ? edge - (b + 1) * bh : edge + b * bh;
      for (let k = Math.floor(x0 / MW); k * MW < x1; k++) ctx.drawImage(POLAR, 0, side + 0.25, POLAR.width, 0.5, (k * MW - cam.x) * z + sw / 2, ya, MW * z, bh);
    }
  }
  ctx.globalAlpha = 1;
}
// hi-res detail tiles over the base bitmap when zoomed in (GFX.detail ≥ 1; 4 samples per map px at detail 3):
// returns the tile draws for this frame (a ready tile of the other resolution stands in while one is painted, new
// tiles fade in) and whether they cover the view opaquely; paints missing tiles nearest-first within a time budget
function tilePlan(x0, y0, x1, y1, z) {
  const zd = z * view.dpr;
  if (GFX.detail < 1 || zd < 2) { if (TILES.size && GFX.detail < 1) tilesClear(); return null; }
  const area = (x1 - x0) * (Math.min(y1, MH) - Math.max(y0, 0));
  let R = zd >= 3.2 && GFX.detail >= 3 ? 4 : 2;
  if (R === 4 && area * 16 > 2.6e6) R = 2;
  if (area * R * R > 2.6e6) return null;
  const dpr = view.dpr, sw2 = view.w / 2, sh2 = view.h / 2, NTX = MW / TILE, need = [], draw = [];
  const ty0 = Math.max(0, Math.floor(y0 / TILE)), ty1 = Math.min(MH / TILE - 1, Math.floor(y1 / TILE));
  const SX = txr => Math.round(((txr * TILE - cam.x) * z + sw2) * dpr) / dpr, SY = ty => Math.round(((ty * TILE - cam.y) * z + sh2) * dpr) / dpr;
  let full = true;
  tileUse++;
  for (let ty = ty0; ty <= ty1; ty++) for (let txr = Math.floor(x0 / TILE); txr <= Math.floor(x1 / TILE); txr++) {
    const tx = ((txr % NTX) + NTX) % NTX, t = tileGet(tx, ty, R, true);
    t.used = tileUse;
    let d = t;
    if (!t.ready) { const alt = tileGet(tx, ty, 6 - R, false); d = alt && alt.ready ? alt : null; if (d) d.used = tileUse; }
    if (!t.ready || t.dirty.length) { t.dist = Math.abs(txr * TILE + TILE / 2 - cam.x) + Math.abs(ty * TILE + TILE / 2 - cam.y); need.push(t); }
    if (!d) { full = false; continue; }
    const fade = d === t ? Math.min(1, (animT - t.t0) / 0.35) : 1;
    if (fade < 1) full = false;
    const xa = SX(txr), ya = SY(ty);
    draw.push([d.cv, TILE * d.R, xa, ya, SX(txr + 1) - xa, SY(ty + 1) - ya, fade]);
  }
  if (need.length) { need.sort((a, b) => a.dist - b.dist); tilesWork(need, GFX.detail >= 3 ? 3 : GFX.detail >= 2 ? 2 : 1.5); }
  tilesEvict(Math.max(48, ((ty1 - ty0 + 2) * ((x1 - x0) / TILE + 2)) | 0) * (R === 4 ? 1 : 3));
  return { draw, full, sc: zd / R };
}
// sun glints on open water: a pre-rendered tileable sparkle pattern (12 twinkle phases, cross-faded), drawn 1:1 in
// device pixels and anchored to the map, filled over 4-px texel runs grouped by glint strength (WMASK: deep, ice-free
// water, fading out in the shallows) — a few pattern fills per frame, no offscreen compositing
let GLINT = null;
function glintInit(dp) {
  const T = Math.round(256 * dp), NF = 12, rnd = mulberry32(90127), sp = [], rip = [];
  for (let k = 0; k < 380; k++) sp.push([rnd() * 256, rnd() * 256, rnd(), 0.7 + rnd() * 1.5, rnd() < 0.12]);
  for (let k = 0; k < 90; k++) rip.push([rnd() * 256, rnd() * 256, 6 + rnd() * 16, rnd()]);
  GLINT = { dp, pat: [] };
  for (let f = 0; f < NF; f++) {
    const cv = document.createElement('canvas'); cv.width = cv.height = T; const c = cv.getContext('2d');
    c.scale(dp, dp);
    for (const [x, y, len, ph] of rip) for (const dx of [0, -256, 256]) {   // faint wave crests
      if (x + dx + len < 0 || x + dx - len > 256) continue;
      c.strokeStyle = `rgba(220,240,255,${0.08 + 0.06 * Math.sin((f / NF + ph) * TAU)})`; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x + dx - len, y); c.quadraticCurveTo(x + dx, y - 2.2, x + dx + len, y); c.stroke();
    }
    for (const [x, y, ph, sz, star] of sp) {
      const a = Math.sin((f / NF + ph) * TAU); if (a < 0.15) continue;
      const al = a * a * (star ? 0.95 : 0.5);
      for (const dx of [0, -256, 256]) for (const dy of [0, -256, 256]) {
        const X = x + dx, Y = y + dy; if (X < -8 || X > 264 || Y < -8 || Y > 264) continue;
        if (star) {
          const r = sz * 2.6;
          c.fillStyle = `rgba(255,252,236,${al})`; c.fillRect(X - 0.8, Y - 0.8, 1.6, 1.6);
          c.fillStyle = `rgba(255,250,230,${al * 0.45})`; c.fillRect(X - r, Y - 0.4, r * 2, 0.8); c.fillRect(X - 0.4, Y - r * 0.6, 0.8, r * 1.2);
        } else { c.fillStyle = `rgba(250,252,255,${al})`; c.beginPath(); c.ellipse(X, Y, sz * 1.9, sz * 0.45, 0, 0, TAU); c.fill(); }
      }
    }
    GLINT.pat.push(ctx.createPattern(cv, 'repeat'));
  }
}
function drawWaterGlints(x0, y0, x1, y1, z) {
  const night = showDayNight ? nightAt(cam.x, cam.y) : 0, a = clamp((z - 1.3) / 1.1, 0, 1) * (1 - 0.7 * night) * 0.8;
  if (a < 0.03) return;
  const dp = view.dpr; if (!GLINT || GLINT.dp !== dp) glintInit(dp);
  const WD = WMASK, groups = cellRuns(x0, y0, x1, y1, z, i => { const v = WD[i]; return v < 32 ? -1 : (v * 4 + 128) >> 8; }, dp, TS, TW, TH);
  if (!groups.size) return;
  const ph = reducedMotion ? 0 : animT * 7.5, n = GLINT.pat.length, f = Math.floor(ph) % n, u = ph - Math.floor(ph), two = GFX.level >= 3 && u > 0.04 && u < 0.96;
  const tx = Math.round(((animT * 1.4 - cam.x) * z + view.w / 2) * dp) / dp, ty = Math.round(((animT * 0.5 - cam.y) * z + view.h / 2) * dp) / dp, M = new DOMMatrix([1 / dp, 0, 0, 1 / dp, tx, ty]);
  for (let k = 0; k < (two ? 2 : 1); k++) {
    const p = GLINT.pat[(f + k) % n]; p.setTransform(M); ctx.fillStyle = p;
    const w = two ? (k ? u : 1 - u) : 1;
    for (const [lv, path] of groups) { ctx.globalAlpha = a * w * lv / 4; ctx.fill(path); }
  }
  ctx.globalAlpha = 1;
}
// coast-following land shapes for overlays: per coastal cell, a cached Path2D (map px) traced by marching squares over
// the 2-px sea-coverage mask LMASK (lattice at even map px = mean of the 4 surrounding texels), so data layers end at
// the painted shoreline instead of in 16-px steps. CCLS: 0 unknown, 1 sea, 2 land, 3 coast (cleared on repaint).
const CLAT = new Float32Array(81);
function coastClass(ci) {
  let k = CCLS[ci]; if (k) return k;
  const cy = (ci / W) | 0, cx = ci - cy * W, D = LMASK.d, LW = LMASK.w, LH = LMASK.h;
  let lo = 1, hi = 0;
  for (let j = 0; j <= 8; j++) {
    const y0 = Math.max(0, cy * 8 + j - 1), y1 = Math.min(LH - 1, cy * 8 + j);
    for (let i = 0; i <= 8; i++) {
      const xa = (cx * 8 + i - 1 + LW) % LW, xb = (cx * 8 + i) % LW;
      const v = 1 - (D[y0 * LW + xa] + D[y0 * LW + xb] + D[y1 * LW + xa] + D[y1 * LW + xb]) / 1020;
      CLAT[j * 9 + i] = v; if (v < lo) lo = v; if (v > hi) hi = v;
    }
  }
  k = lo >= 0.5 ? 2 : hi < 0.5 ? 1 : 3;
  if (k === 3) {
    const p = new Path2D(), X = cx * PX, Y = cy * PX, L = CLAT;
    for (let j = 0; j < 8; j++) {
      let run = -1;
      for (let i = 0; i <= 8; i++) {
        const q = j * 9 + i, full = i < 8 && L[q] >= 0.5 && L[q + 1] >= 0.5 && L[q + 9] >= 0.5 && L[q + 10] >= 0.5;
        if (full) { if (run < 0) run = i; continue; }
        if (run >= 0) { p.rect(X + run * 2, Y + j * 2, (i - run) * 2, 2); run = -1; }
        if (i === 8) break;
        // walk the square clockwise: corners that are land, and the 0.5 crossings on edges that change state
        const c = [L[q], L[q + 1], L[q + 10], L[q + 9]], cxs = [0, 2, 2, 0], cys = [0, 0, 2, 2];
        if (c[0] < 0.5 && c[1] < 0.5 && c[2] < 0.5 && c[3] < 0.5) continue;
        let first = true;
        for (let e = 0; e < 4; e++) {
          const e2 = (e + 1) & 3;
          if (c[e] >= 0.5) { const px = X + i * 2 + cxs[e], py = Y + j * 2 + cys[e]; if (first) { p.moveTo(px, py); first = false; } else p.lineTo(px, py); }
          if ((c[e] >= 0.5) !== (c[e2] >= 0.5)) {
            const t = (0.5 - c[e]) / (c[e2] - c[e]), px = X + i * 2 + cxs[e] + (cxs[e2] - cxs[e]) * t, py = Y + j * 2 + cys[e] + (cys[e2] - cys[e]) * t;
            if (first) { p.moveTo(px, py); first = false; } else p.lineTo(px, py);
          }
        }
        p.closePath();
      }
    }
    CPOLY[ci] = p;
  }
  CCLS[ci] = k; return k;
}
// data layers. Land layers (政治/人口/意识形态 and the zoomed-out tint) fill merged same-key runs of cells; zoomed in,
// coastal cells use their marching-squares shoreline shape. 气候 fills all cells; 资源 draws markers.
function drawMapLayer(x0, y0, x1, y1, z) {
  const tint = layer === 0 ? clamp((2.2 - z) / 1.6, 0, 1) * 0.12 : 0;
  if (layer === 0 && tint < 0.02) return;
  if (layer >= 2 && layer <= 4) { ctx.fillStyle = 'rgba(6,10,20,.45)'; ctx.fillRect(0, 0, view.w, view.h); }
  if (layer <= 1 || layer === 3 || layer === 5) {
    const O = S.owner, keyOf = layer === 3 ? i => { const ci = S.cityOf[i], c = ci >= 0 ? S.cities[ci] : null; return c && c.cells > 0 ? Math.round(clamp((Math.log10(c.pop / c.cells) - 3.8) / 3.4, 0, 1) * 24) : -1; } : i => O[i];
    const fine = z >= (layer ? 0.9 : 1.2), E = WORLD.elev, rise = S.seaRise, coast = [];
    // zoomed out: a cell counts if its mean elevation is land; zoomed in: interior land cells as runs, coastal ones traced
    const key = fine ? i => { const c = coastClass(i); if (c === 1) return -1; const k = keyOf(i); if (c === 3 && k >= 0) { coast.push(i, k); return -1; } return k; } : i => E[i] > rise ? keyOf(i) : -1;
    const groups = cellRuns(x0, y0, x1, y1, z, key, view.dpr);
    if (coast.length) {
      // each traced cell is mapped onto the same device-pixel-snapped square its neighbouring runs use → no seams
      const d = view.dpr, sw2 = view.w / 2, sh2 = view.h / 2, SX = m => Math.round(((m - cam.x) * z + sw2) * d) / d, SY = m => Math.round(((m - cam.y) * z + sh2) * d) / d;
      for (let q = 0; q < coast.length; q += 2) {
        const i = coast[q], k = coast[q + 1], cy = (i / W) | 0, cx = i - cy * W, wx = Math.round(((cx + 0.5) * PX - cam.x) / MW) * MW;
        const xl = SX(wx + cx * PX), yt = SY(cy * PX), a = (SX(wx + cx * PX + PX) - xl) / PX, b = (SY(cy * PX + PX) - yt) / PX;
        let p = groups.get(k); if (!p) { p = new Path2D(); groups.set(k, p); }
        p.addPath(CPOLY[i], new DOMMatrix([a, 0, 0, b, xl - cx * PX * a, yt - cy * PX * b]));
      }
    }
    if (!groups.size) return;
    for (const [k, p] of groups) {
      if (layer === 3) { const col = popColor(k / 24); ctx.globalAlpha = 0.75; ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`; }
      else { const n = S.nations[k]; if (!n) continue; ctx.globalAlpha = layer === 0 ? tint : selectedNation >= 0 && k !== selectedNation ? 0.15 : 0.5; ctx.fillStyle = layer === 5 ? ideoOf(n).color : n.color; }
      ctx.fill(p);
    }
  } else if (layer === 4) {
    const E = WORLD.elev, rise = S.seaRise;
    ctx.globalAlpha = 0.6;
    for (const [k, p] of cellRuns(x0, y0, x1, y1, z, i => clamp(Math.round(cellTeff(i)), -40, 50) + 40, view.dpr)) { const col = tempColor(k - 40); ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`; ctx.fill(p); }
    ctx.fillStyle = '#605038';
    for (const [k, p] of cellRuns(x0, y0, x1, y1, z, i => E[i] > rise && S.smog[i] > 0.05 ? Math.round(Math.min(0.7, S.smog[i]) * 20) : -1, view.dpr)) { ctx.globalAlpha = k / 20; ctx.fill(p); }
  } else if (layer === 2) {
    const sw2 = view.w / 2, sh2 = view.h / 2, cs = PX * z;
    forVisibleCells(x0, y0, x1, y1, (i, cxr, cy) => {
      const sx = (cxr * PX - cam.x) * z + sw2, sy = (cy * PX - cam.y) * z + sh2, land = WORLD.elev[i] > S.seaRise;
      ctx.globalAlpha = 1;
      let k = 0;
      for (const r of RES) {
        const amt = S.res[r][i], a0 = WORLD.res0[r][i];
        if (a0 <= 0) continue;
        const fx = [0.3, 0.7, 0.3, 0.7, 0.5][k], fy = [0.3, 0.3, 0.7, 0.7, 0.5][k]; k++;
        const s = clamp(PX * z * 0.22, 2.5, 9) * (amt > 0 ? 0.55 + 0.45 * Math.sqrt(amt / a0) : 0.6), c = RES_RGB[r], px = sx + fx * cs, py = sy + fy * cs;
        ctx.fillStyle = amt > 0 ? `rgb(${c[0]},${c[1]},${c[2]})` : '#46464c'; ctx.strokeStyle = 'rgba(6,10,20,.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, py - s); ctx.lineTo(px + s, py); ctx.lineTo(px, py + s); ctx.lineTo(px - s, py); ctx.closePath(); ctx.fill(); if (s > 3.5) ctx.stroke();
      }
      if (!land && WORLD.fish[i] > 0) { ctx.globalAlpha = WORLD.fish[i] * 0.5; ctx.fillStyle = '#96c8ff'; ctx.beginPath(); ctx.arc(sx + cs * 0.5, sy + cs * 0.5, cs * 0.12, 0, TAU); ctx.fill(); }
    });
  }
  ctx.globalAlpha = 1;
}
// visible squares of a g-map-px grid (gw × gh; default the cell grid) grouped by key(i) (≥ 0) into Path2Ds of
// horizontally merged runs; edges snap to device pixels (s per CSS px) so neighbouring runs neither overlap nor leave seams
function cellRuns(x0, y0, x1, y1, z, key, s, g = PX, gw = W, gh = H) {
  const groups = new Map(), sw2 = view.w / 2, sh2 = view.h / 2, SX = m => Math.round(((m - cam.x) * z + sw2) * s) / s;
  const cy0 = Math.max(0, Math.floor(y0 / g)), cy1 = Math.min(gh - 1, Math.floor(y1 / g)), cx0 = Math.floor(x0 / g), cx1 = Math.floor(x1 / g);
  for (let cy = cy0; cy <= cy1; cy++) {
    const ya = Math.round(((cy * g - cam.y) * z + sh2) * s) / s, yb = Math.round((((cy + 1) * g - cam.y) * z + sh2) * s) / s, row = cy * gw;
    let rk = -1, rs = 0;
    for (let cxr = cx0; cxr <= cx1 + 1; cxr++) {
      const k = cxr > cx1 ? -1 : key(row + (((cxr % gw) + gw) % gw));
      if (k === rk) continue;
      if (rk >= 0) { let p = groups.get(rk); if (!p) { p = new Path2D(); groups.set(rk, p); } const xa = SX(rs * g); p.rect(xa, ya, SX(cxr * g) - xa, yb - ya); }
      rk = k; rs = cxr;
    }
  }
  return groups;
}
// national borders: each land cell draws its edges facing another nation's land, inset on its own side (neighbours'
// lines run side by side). Corners are chamfered at 45° — convex ones cut inside the cell, concave ones bridged to the
// diagonal neighbour's edge — so borders read as drawn lines rather than 16-px stairs.
function drawBorders(x0, y0, x1, y1, z) {
  const paths = new Map(), glow = new Map(), cs = PX * z, sw2 = view.w / 2, sh2 = view.h / 2, d = view.dpr;
  const lwD = Math.max(1, Math.round(clamp(z * 0.9, 1, 3) * d)), lw = lwD / d, half = (lwD & 1) ? 0.5 / d : 0;
  const ins = Math.min(1.5, cs * 0.06) + lw / 2, gw = z >= 1.2 && GFX.detail >= 1 ? clamp(cs * 0.16, 2, 8) : 0, gi = ins + gw / 2;
  const chf = GFX.level ? 0.26 : 0;
  const P = v => Math.round(v * d) / d + half, rise = S.seaRise, E = WORLD.elev, O = S.owner;
  const mine = (cx, cy, own) => { if (cy < 0 || cy >= H) return false; const j = cy * W + (cx + W) % W; return O[j] === own && E[j] > rise; };
  // one cell's border edges into path p at inset t (snap: pixel-align straight runs); flags R L D U, diagonal ownership
  const edges = (p, sx, sy, t, R, L, D, U, dUR, dUL, dDR, dDL, snap) => {
    const c = Math.max(t + 0.4, cs * chf), Q = snap ? P : v => v;
    const xa = sx, xb = sx + cs, ya = sy, yb = sy + cs;
    for (const sxn of [1, -1]) {
      if (!(sxn > 0 ? R : L)) continue;
      const lx = Q(sxn > 0 ? xb - t : xa + t), hU = U, hD = D, gU = sxn > 0 ? dUR : dUL, gD = sxn > 0 ? dDR : dDL;
      const yt = !chf ? ya : hU ? ya + t + c : gU ? ya - t + c : ya, yb2 = !chf ? yb : hD ? yb - t - c : gD ? yb + t - c : yb;
      if (chf && hU) p.moveTo(lx - sxn * c, ya + t); else if (chf && gU) p.moveTo(lx + sxn * c, ya - t); else p.moveTo(lx, Q(yt));
      p.lineTo(lx, Q(yt)); p.lineTo(lx, Q(yb2));
      if (chf && hD) p.lineTo(lx - sxn * c, yb - t); else if (chf && gD) p.lineTo(lx + sxn * c, yb + t);
    }
    for (const syn of [1, -1]) {
      if (!(syn > 0 ? D : U)) continue;
      const ly = Q(syn > 0 ? yb - t : ya + t), gL = syn > 0 ? dDL : dUL, gR = syn > 0 ? dDR : dUR;
      const xl = !chf ? xa : L ? xa + t + c : gL ? xa - t + c : xa, xr = !chf ? xb : R ? xb - t - c : gR ? xb + t - c : xb;
      p.moveTo(Q(xl), ly); p.lineTo(Q(xr), ly);
    }
  };
  forVisibleCells(x0, y0, x1, y1, (i, cxr, cy) => {
    const own = O[i]; if (own < 0 || E[i] <= rise) return;
    const x = i - cy * W, sx = (cxr * PX - cam.x) * z + sw2, sy = (cy * PX - cam.y) * z + sh2;
    const jr = cy * W + (x + 1) % W, jl = cy * W + (x + W - 1) % W;
    const R = E[jr] > rise && O[jr] !== own, L = E[jl] > rise && O[jl] !== own, D = cy < H - 1 && E[i + W] > rise && O[i + W] !== own, U = cy > 0 && E[i - W] > rise && O[i - W] !== own;
    if (!(R || L || D || U)) return;
    let p = paths.get(own); if (!p) { p = new Path2D(); paths.set(own, p); }
    const dUR = mine(x + 1, cy - 1, own), dUL = mine(x - 1, cy - 1, own), dDR = mine(x + 1, cy + 1, own), dDL = mine(x - 1, cy + 1, own);
    edges(p, sx, sy, ins, R, L, D, U, dUR, dUL, dDR, dDL, true);
    if (gw) { let q = glow.get(own); if (!q) { q = new Path2D(); glow.set(own, q); } edges(q, sx, sy, gi, R, L, D, U, dUR, dUL, dDR, dDL, false); }
  });
  ctx.lineCap = chf ? 'round' : 'square'; ctx.lineJoin = chf ? 'round' : 'miter';
  if (gw) for (const [own, q] of glow) { ctx.globalAlpha = own === selectedNation ? 0.34 : 0.2; ctx.lineWidth = gw; ctx.strokeStyle = S.nations[own].color; ctx.stroke(q); }
  // dark casing under every border line (not at 流畅), then the nation-coloured line on top
  if (GFX.level) {
    ctx.globalAlpha = clamp((z - 0.3) / 1.2, 0.3, 1) * 0.6; ctx.strokeStyle = '#050810';
    for (const [own, p] of paths) { const sel = own === selectedNation || (diploFrom && diploFrom.n === own); ctx.lineWidth = lw * (sel ? 2 : 1) + 1.6; ctx.stroke(p); }
  }
  for (const [own, p] of paths) {
    const sel = own === selectedNation || (diploFrom && diploFrom.n === own);
    ctx.lineWidth = lw * (sel ? 2 : 1); ctx.globalAlpha = sel ? 1 : 0.9;
    ctx.strokeStyle = S.nations[own].color; ctx.stroke(p);
  }
  ctx.globalAlpha = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'miter';
}
function drawRoads(z) {
  const byId = new Map(S.cities.map(c => [c.id, c])), dirt = new Path2D(), paved = new Path2D();
  let nd = 0, np = 0;
  for (const c of S.cities) {
    const [cx, cy] = cityMpx(c);
    const ax = sxOf(cx), ay = syOf(cy);
    for (const id of c.links) {
      if (id < c.id) continue;
      const o = byId.get(id); if (!o) continue;
      const [ox, oy] = cityMpx(o);
      const bx = ax + wrapDx(ox - cx) * z, by = ay + (oy - cy) * z;
      if (Math.max(ax, bx) < -10 || Math.min(ax, bx) > view.w + 10 || Math.max(ay, by) < -10 || Math.min(ay, by) > view.h + 10) continue;
      if (c.wet === undefined || c.wetKey !== o.id + ':' + S.terra.length + ':' + ((S.seaRise * 1000) | 0)) { let wet = 0; for (let s = 1; s < 8; s++) { if (!landAt(cx + wrapDx(ox - cx) * s / 8, cy + (oy - cy) * s / 8)) wet++; } c.wet = wet; c.wetKey = o.id + ':' + S.terra.length + ':' + ((S.seaRise * 1000) | 0); }
      if (c.wet > 1) continue;
      const p = S.nations[c.n].mult.era >= 4 ? (np++, paved) : (nd++, dirt);
      p.moveTo(ax, ay); p.lineTo(bx, by);
    }
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (nd) {
    const w = Math.max(1, z * 0.7);
    if (z >= 1.4 && GFX.level) { ctx.strokeStyle = 'rgba(70,52,30,.45)'; ctx.lineWidth = w + 1.4; ctx.stroke(dirt); }
    ctx.strokeStyle = 'rgba(168,134,88,.85)'; ctx.lineWidth = w; ctx.stroke(dirt);
  }
  if (np) {
    const w = Math.max(1, z * 1.1);
    if (z >= 1.4 && GFX.level) { ctx.strokeStyle = 'rgba(16,16,20,.55)'; ctx.lineWidth = w + 1.6; ctx.stroke(paved); }
    ctx.strokeStyle = 'rgba(78,78,86,.92)'; ctx.lineWidth = w; ctx.stroke(paved);
    if (z > 2.2) { ctx.strokeStyle = 'rgba(236,224,160,.6)'; ctx.lineWidth = Math.max(0.6, z * 0.13); ctx.lineCap = 'butt'; ctx.setLineDash([z * 0.8, z * 1.4]); ctx.stroke(paved); ctx.setLineDash([]); ctx.lineCap = 'round'; }
  }
  ctx.lineJoin = 'miter';
}
function drawRails(z) {
  if (!S.rails) return;
  const byId = new Map(S.cities.map(c => [c.id, c]));
  const fine = z >= 1.4, trains = z >= 1.6 && !reducedMotion;
  ctx.lineCap = 'butt';
  for (const k in S.rails) {
    const sep = k.indexOf(':'), a = byId.get(+k.slice(0, sep)), b = byId.get(+k.slice(sep + 1));
    if (!a || !b) continue;
    const [ax0, ay0] = cityMpx(a), [bx0, by0] = cityMpx(b);
    const dx = wrapDx(bx0 - ax0), dy = by0 - ay0, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy * 2.2, ny = ux * 2.2;
    const x1 = sxOf(ax0 + nx), y1 = syOf(ay0 + ny), x2 = x1 + dx * z, y2 = y1 + dy * z;
    if (Math.max(x1, x2) < -20 || Math.min(x1, x2) > view.w + 20 || Math.max(y1, y2) < -20 || Math.min(y1, y2) > view.h + 20) continue;
    if (fine) {
      ctx.strokeStyle = '#6b5640'; ctx.lineWidth = z * 1.15; ctx.setLineDash([z * 0.3, z * 0.85]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#2b2725'; ctx.lineWidth = Math.max(1, z * 0.16);
      for (const o of [-0.38, 0.38]) { const ox = -uy * o * z, oy = ux * o * z; ctx.beginPath(); ctx.moveTo(x1 + ox, y1 + oy); ctx.lineTo(x2 + ox, y2 + oy); ctx.stroke(); }
    } else { ctx.strokeStyle = 'rgba(43,39,37,.9)'; ctx.lineWidth = Math.max(1, z * 0.6); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    if (!trains) continue;
    const owner = S.nations[S.rails[k].n] || S.nations[a.n], era = owner ? owner.mult.era : 4;
    const h = ((a.id * 7919 + b.id * 104729) % 997) / 997, sp = (era >= 6 ? 26 : 12) / len;
    let t = (animT * sp + h * 2) % 2; const back = t > 1; if (back) t = 2 - t;
    const px = x1 + dx * z * t, py = y1 + dy * z * t, ang = Math.atan2(dy, dx) + (back ? PI : 0);
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    const cl = 3.2 * z, cw = 1.3 * z, gap = 0.35 * z;
    for (let j = 0; j < 3; j++) {
      const x = -j * (cl + gap) - cl / 2;
      if (era >= 6) { ctx.fillStyle = '#eef2f6'; ctx.fillRect(x, -cw / 2, cl, cw); ctx.fillStyle = owner ? owner.color : '#5cc4e6'; ctx.fillRect(x, -cw * 0.12, cl, cw * 0.24); if (j === 0) { ctx.fillStyle = '#eef2f6'; ctx.beginPath(); ctx.moveTo(x + cl, -cw / 2); ctx.lineTo(x + cl + cw * 0.9, 0); ctx.lineTo(x + cl, cw / 2); ctx.fill(); } }
      else { ctx.fillStyle = j === 0 ? '#2a2624' : '#7a4a2a'; ctx.fillRect(x, -cw / 2, cl, cw); if (j === 0) { ctx.fillStyle = owner ? owner.color : '#c44'; ctx.fillRect(x, -cw / 2, cl * 0.3, cw); } }
    }
    ctx.restore();
    if (era < 6 && rand2() < 0.08) { const mx = ax0 + nx + dx * t + Math.cos(ang) * 1.6, my = ay0 + ny + dy * t + Math.sin(ang) * 1.6; particle(mx, my - 0.6, (rand2() - 0.5) * 0.6, -1.4, 1.4, '#d8d8d8', 0.8, 1.6, 0.55); }
  }
  ctx.lineCap = 'round';
}
function drawParticles(z) {
  for (const p of PARTS) {
    const sx = sxOf(p.x), sy = syOf(p.y);
    if (sx < -20 || sx > view.w + 20 || sy < -20 || sy > view.h + 20) continue;
    const f = p.t / p.life, s = Math.max(1, (p.size + p.grow * f) * z);
    ctx.globalAlpha = (1 - f) * p.a; ctx.fillStyle = p.col; ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}
const FX_COL = { tech: '--sea', war: '--blood', disaster: '--ember', climate: '--leaf', space: '--violet', civ: '--sodium', bless: '--sodium', inspire: '--sea', army: '--ink-2', plague: '--leaf', quake: '--ember', volcano: '--ember', capture: '--blood' };
function drawMapFx(z) {
  for (let k = FX.length - 1; k >= 0; k--) {
    const f = FX[k], life = f.type === 'meteor' ? 2.5 : 3, age = (animT - f.t0) / life;
    if (age >= 1) { FX.splice(k, 1); continue; }
    const sx = sxOf(f.mx), sy = syOf(f.my);
    if (sx < -200 || sx > view.w + 200 || sy < -200 || sy > view.h + 200) continue;
    const col = f.col || CSSV[FX_COL[f.type] || '--sodium'] || '#ffb547';
    if (f.type === 'meteor') {
      if (age < 0.12) { const t = age / 0.12; ctx.strokeStyle = '#fff2c0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx - 300 * (1 - t) - 40, sy - 300 * (1 - t) - 40); ctx.lineTo(sx - 300 * (1 - t), sy - 300 * (1 - t)); ctx.stroke(); continue; }
      const t = (age - 0.12) / 0.88, R = (20 + 70 * t) * Math.max(1, z * 0.6);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
      g.addColorStop(0, `rgba(255,240,200,${0.9 * (1 - t)})`); g.addColorStop(0.4, `rgba(255,120,40,${0.7 * (1 - t)})`); g.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - t)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, R * 1.6, 0, TAU); ctx.stroke();
      continue;
    }
    if (f.type === 'quake') {
      ctx.strokeStyle = col; ctx.globalAlpha = 1 - age; ctx.lineWidth = 1.5;
      for (let r = 0; r < 3; r++) { const R = (10 + age * 60 + r * 14) * Math.max(1, z * 0.5); ctx.beginPath(); for (let a = 0; a <= 24; a++) { const ang = a / 24 * TAU, jr = R + ((a & 1) ? 3 : -3); ctx.lineTo(sx + Math.cos(ang) * jr, sy + Math.sin(ang) * jr * 0.7); } ctx.stroke(); }
      ctx.globalAlpha = 1; continue;
    }
    ctx.globalAlpha = 1 - age; ctx.strokeStyle = col; ctx.lineWidth = f.type === 'capture' ? 2.5 : 1.6;
    ctx.beginPath(); ctx.arc(sx, sy, (5 + age * 28) * Math.max(1, z * 0.45), 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
function swordsIcon(x, y, s, col) {
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, s * 0.16); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - s / 2, y - s / 2); ctx.lineTo(x + s / 2, y + s / 2); ctx.moveTo(x + s / 2, y - s / 2); ctx.lineTo(x - s / 2, y + s / 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - s * 0.45, y + s * 0.15); ctx.lineTo(x - s * 0.15, y + s * 0.45); ctx.moveTo(x + s * 0.45, y + s * 0.15); ctx.lineTo(x + s * 0.15, y + s * 0.45); ctx.stroke();
}
function drawWarMarks(z) {
  const showFront = z < AGENT_Z || !showPeople;
  for (const w of S.wars) {
    if (w.front < 0 || !showFront) continue;
    const [mx, my] = cellMpx(w.front), sx = sxOf(mx), sy = syOf(my);
    if (sx < -20 || sx > view.w + 20 || sy < -20 || sy > view.h + 20) continue;
    const ph = (animT * 1.3) % 1;
    ctx.strokeStyle = `rgba(255,95,107,${0.9 * (1 - ph)})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, 9 + ph * 14, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,70,80,.18)'; ctx.beginPath(); ctx.arc(sx, sy, 12.5, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(8,10,18,.88)'; ctx.strokeStyle = 'rgba(255,95,107,.85)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(sx, sy, 9.5, 0, TAU); ctx.fill(); ctx.stroke();
    swordsIcon(sx, sy, 9, CSSV['--blood']);
  }
  for (const o of S.orders) {
    const a = cityById(o.from), b = cityById(o.to);
    if (!a || !b) continue;
    const [ax0, ay0] = cityMpx(a), [bx0, by0] = cityMpx(b);
    const ax = sxOf(ax0), ay = syOf(ay0), bx = ax + wrapDx(bx0 - ax0) * z, by = ay + (by0 - ay0) * z;
    const col = S.nations[o.a].color;
    const mx = (ax + bx) / 2, my = (ay + by) / 2 - Math.hypot(bx - ax, by - ay) * 0.18;
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(6,8,14,.55)'; ctx.lineWidth = 4.4;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -animT * 20;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke(); ctx.setLineDash([]);
    const ang = Math.atan2(by - my, bx - mx);
    ctx.fillStyle = col; ctx.strokeStyle = 'rgba(6,8,14,.7)'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(ang - 0.4) * 12, by - Math.sin(ang - 0.4) * 12); ctx.lineTo(bx - Math.cos(ang + 0.4) * 12, by - Math.sin(ang + 0.4) * 12); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.lineJoin = 'miter';
    const t = clamp((S.year - o.start + budget) / Math.max(1, o.eta - o.start), 0, 1), it = 1 - t;
    const px = it * it * ax + 2 * it * t * mx + t * t * bx, py = it * it * ay + 2 * it * t * my + t * t * by;
    ctx.fillStyle = 'rgba(8,10,18,.88)'; ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(px, py, 9.5, 0, TAU); ctx.fill(); ctx.stroke();
    swordsIcon(px, py, 9, col);
  }
}
function drawSelection(z) {
  if (!selected) return;
  let x, y, r = 12;
  if (selected.agent) { const a = selected.agent; if (!AG.includes(a)) { selected = null; return; } x = sxOf(a.x); y = syOf(a.y); r = Math.max(6, z * 2); }
  else if (selected.city) { const c = cityById(selected.city); if (!c) return; const [mx, my] = cityMpx(c); x = sxOf(mx); y = syOf(my); r = z >= BUILD_Z ? Math.max(14, layoutFor(c).r * z * 0.9) : 12; }
  else if (selected.cell >= 0) { const [mx, my] = cellMpx(selected.cell); x = sxOf(mx); y = syOf(my); r = Math.max(8, PX * z * 0.6); }
  else return;
  const ry = r * (selected.agent ? 0.5 : 0.8);
  ctx.beginPath(); ctx.ellipse(x, y, r, ry, 0, 0, TAU);
  ctx.strokeStyle = 'rgba(255,181,71,.22)'; ctx.lineWidth = 6; ctx.stroke();
  ctx.strokeStyle = 'rgba(6,8,14,.6)'; ctx.lineWidth = 3.2; ctx.stroke();
  ctx.strokeStyle = CSSV['--sodium']; ctx.lineWidth = 1.6; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -animT * 10; ctx.stroke(); ctx.setLineDash([]);
  if (diploFrom) { const c = cityById(diploFrom.city); if (c) { const [mx, my] = cityMpx(c); ctx.strokeStyle = S.nations[c.n].color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(sxOf(mx), syOf(my), 16, 0, TAU); ctx.stroke(); } }
}
function plate(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawCityLabels(vis, z) {
  const boxes = [], d = view.dpr, P = v => Math.round(v * d) / d;
  const list = vis.slice().sort((a, b) => b.c.pop - a.c.pop);
  const maxN = z >= BUILD_Z ? 80 : view.w < 600 ? 8 : 18, big = z >= BUILD_Z;
  ctx.font = `${big ? 12 : 11}px ${CSSV.font}`;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  let k = 0;
  for (const v of list) {
    if (k >= maxN) break;
    if (selectedNation >= 0 && v.c.n !== selectedNation && z < BUILD_Z) continue;
    const c = v.c, txt = c.name + (z >= 3 ? ` · ${fmtPop(c.pop)}` : ''), cap = c.cap, h = big ? 17 : 16;
    const tw = ctx.measureText(txt).width + 14 + (cap ? 11 : 0);
    const ly = big ? v.y - Math.max(18, layoutFor(c).r * z * 0.75 + 10) : v.y - v.r - 8;
    const b = { x: P(v.x - tw / 2), y: P(ly - h / 2), w: Math.round(tw), h };
    if (b.x > view.w || b.x + b.w < 0 || b.y > view.h || b.y + b.h < 0) continue;
    if (boxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)) continue;
    boxes.push(b); k++;
    const col = S.nations[c.n].color, hq = GFX.level > 0;
    if (hq) {   // rounded plate with a drop shadow and a hairline rim (gold for capitals)
      ctx.fillStyle = 'rgba(0,0,0,.32)'; plate(b.x + 0.5, b.y + 1.5, b.w, b.h, 4); ctx.fill();
      ctx.fillStyle = 'rgba(8,12,22,.8)'; plate(b.x, b.y, b.w, b.h, 4); ctx.fill();
      ctx.strokeStyle = cap ? 'rgba(255,214,140,.38)' : 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; plate(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 3.5); ctx.stroke();
      ctx.fillStyle = col; ctx.fillRect(b.x + 1, b.y + 3, 2.5, b.h - 6);
    } else { ctx.fillStyle = 'rgba(6,10,20,.72)'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.fillStyle = col; ctx.fillRect(b.x, b.y, 3, b.h); }
    let tx = v.x + 1.5;
    if (cap) { const sx = b.x + 11, sy = b.y + b.h / 2; ctx.fillStyle = '#ffcf6e'; ctx.beginPath(); for (let j = 0; j < 10; j++) { const rr = j & 1 ? 1.7 : 4, an = -PI / 2 + j * PI / 5; ctx.lineTo(sx + Math.cos(an) * rr, sy + Math.sin(an) * rr); } ctx.fill(); tx += 5.5; }
    if (hq) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(txt, P(tx) + 0.5, P(b.y + b.h / 2) + 1); }
    ctx.fillStyle = cap ? '#fff4dc' : 'rgba(233,238,248,.94)';
    ctx.fillText(txt, P(tx), P(b.y + b.h / 2));
  }
  ctx.textAlign = 'left';
}
