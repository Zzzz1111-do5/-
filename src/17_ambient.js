/* =====================================================================
   Ambient life and weather on the map (day/night, cloud shadows, birds).
   Kept deliberately cheap: one gradient for the night side, pre-rendered
   sprites for city glows and clouds. nightAt() is the shared day/night
   contract: other renderers (city windows, torches) ask it how dark it is.
   ===================================================================== */
let showDayNight = true;
const DAY_SEC = 180;                       // one full day per 3 minutes of real time
function sunX() { return (((-animT / DAY_SEC) * MW) % MW + MW) % MW; }   // sun moves east → west
// 0 = full day, 1 = deep night at map pixel (mx, my)
function nightAt(mx, my) {
  if (!showDayNight) return 0;
  const c = Math.cos(wrapDx(mx - sunX()) / MW * TAU);
  return smooth(0.3, -0.45, c);
}
const AMB = { glow: null, glowE: null, cloud: null, shadow: null, strip: null, sctx: null, sdata: null };
function ambSprite(r, stops) {
  const cv = document.createElement('canvas'); cv.width = cv.height = r * 2;
  const c = cv.getContext('2d'), g = c.createRadialGradient(r, r, 0, r, r, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g; c.fillRect(0, 0, r * 2, r * 2); return cv;
}
function ambInit() {
  AMB.glow = ambSprite(32, [[0, 'rgba(255,170,90,0.9)'], [0.35, 'rgba(255,140,60,0.35)'], [1, 'rgba(255,120,40,0)']]);
  AMB.glowE = ambSprite(32, [[0, 'rgba(255,236,190,0.95)'], [0.3, 'rgba(255,214,150,0.4)'], [1, 'rgba(255,200,120,0)']]);
  // a lumpy cloud: a few overlapping soft discs
  const cv = document.createElement('canvas'); cv.width = 160; cv.height = 96;
  const c = cv.getContext('2d'), rnd = mulberry32(99);
  for (let k = 0; k < 9; k++) { const x = 30 + rnd() * 100, y = 30 + rnd() * 36, r = 18 + rnd() * 22, g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 160, 96); }
  AMB.cloud = cv;
  const sv = document.createElement('canvas'); sv.width = 160; sv.height = 96;
  const sc = sv.getContext('2d'); sc.drawImage(cv, 0, 0); sc.globalCompositeOperation = 'source-in'; sc.fillStyle = 'rgba(10,18,30,1)'; sc.fillRect(0, 0, 160, 96);
  AMB.shadow = sv;
  AMB.strip = document.createElement('canvas'); AMB.strip.width = 48; AMB.strip.height = 1; AMB.sctx = AMB.strip.getContext('2d'); AMB.sdata = AMB.sctx.createImageData(48, 1);
}
const CLOUDS = Array.from({ length: 22 }, (_, k) => { const r = mulberry32(k * 131 + 7); return { x: r() * 3072, y: 120 + r() * 1300, s: 0.7 + r() * 1.2, v: 6 + r() * 8 }; });
function ambientTick(dt) {}
function drawAmbient(z) {
  if (!AMB.glow) ambInit();
  const W2 = view.w, H2 = view.h;
  // cloud shadows (mid zoom) and soft clouds (far zoom)
  if (GFX.weather && z < 1.2) {
    const far = z < 0.9;
    for (const cl of CLOUDS) {
      const mx = cl.x + animT * cl.v, w = 160 * cl.s * 2.2 * z, h = 96 * cl.s * 2.2 * z;
      const sx = sxOf(mx), sy = syOf(cl.y);
      if (sx < -w || sx > W2 + w || sy < -h || sy > H2 + h) continue;
      ctx.globalAlpha = far ? 0.16 : 0.1; ctx.drawImage(AMB.shadow, sx - w / 2 + 10 * z, sy - h / 2 + 14 * z, w, h);
      if (far) { ctx.globalAlpha = 0.5; ctx.drawImage(AMB.cloud, sx - w / 2, sy - h / 2, w, h); }
    }
    ctx.globalAlpha = 1;
  }
  if (showDayNight) {
    // night side: a 48×1 strip of darkness values stretched over the screen (much cheaper than a gradient fill)
    const n = 48, px = AMB.sdata.data;
    let lo = n, hi = -1;
    for (let k = 0; k < n; k++) { const d = nightAt(cam.x + ((k + 0.5) / n - 0.5) * W2 / z, 0), o = k * 4; px[o] = 6; px[o + 1] = 12; px[o + 2] = 38; px[o + 3] = d * 0.48 * 255; if (d > 0.01) { if (k < lo) lo = k; hi = k; } }
    if (hi >= 0) {
      AMB.sctx.putImageData(AMB.sdata, 0, 0);
      const a = Math.max(0, lo - 1), b = Math.min(n, hi + 2);
      ctx.imageSmoothingEnabled = true; ctx.drawImage(AMB.strip, a, 0, b - a, 1, a / n * W2, 0, (b - a) / n * W2, H2);
      // warm city lights on the night side
      ctx.globalCompositeOperation = 'lighter';
      for (const c of S.cities) {
        const [mx, my] = cityMpx(c), d = nightAt(mx, my);
        if (d < 0.15) continue;
        const sx = sxOf(mx), sy = syOf(my), era = S.nations[c.n] ? S.nations[c.n].mult.era : 0;
        const r = (6 + Math.log10(c.pop / 1e4 + 1) * 7) * Math.max(0.9, Math.min(z, 3)) * (era >= 4 ? 1.25 : 0.9);
        if (sx < -r || sx > W2 + r || sy < -r || sy > H2 + r) continue;
        ctx.globalAlpha = Math.min(1, d * (z >= BUILD_Z ? 0.35 : 0.75));
        ctx.drawImage(era >= 4 ? AMB.glowE : AMB.glow, sx - r, sy - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
  // a couple of bird flocks drifting across the view when zoomed in
  if (GFX.level >= 1 && z >= 2 && z <= 7) {
    ctx.strokeStyle = 'rgba(30,30,36,.75)'; ctx.lineWidth = Math.max(1, z * 0.18);
    for (let f = 0; f < 2; f++) {
      const t = animT * 0.035 + f * 0.5, fx = ((t % 1) + 1) % 1, cx = W2 * (1.15 - fx * 1.3), cy = H2 * (0.25 + 0.4 * f) + Math.sin(animT * 0.3 + f) * 20;
      for (let k = 0; k < 7; k++) {
        const row = Math.ceil(k / 2), side = k % 2 ? 1 : -1, x = cx + row * 9 * z * 0.4, y = cy + side * row * 6 * z * 0.4, flap = Math.sin(animT * 9 + k) * z * 0.6, s = z * 1.1;
        ctx.beginPath(); ctx.moveTo(x - s, y - flap); ctx.lineTo(x, y); ctx.lineTo(x + s, y - flap); ctx.stroke();
      }
    }
  }
}
