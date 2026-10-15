/* =====================================================================
   Post-processing (applied to the finished frame in every view).
   Speed first (user request): just a cached vignette at GFX.post ≥ 1, plus
   a cheap bloom from a 1/8-size copy of the frame in the globe and space
   views at GFX.post 2 (refreshed every third frame). Nothing at post 0.
   ===================================================================== */
const FXC = { vig: null, vw: 0, vh: 0, small: null, sctx: null, filter: null };
function fxVignette(w, h) {
  if (FXC.vig && FXC.vw === w && FXC.vh === h) return FXC.vig;
  const cv = document.createElement('canvas'); cv.width = Math.max(1, w >> 2); cv.height = Math.max(1, h >> 2);
  const c = cv.getContext('2d'), r = Math.hypot(cv.width, cv.height) / 2;
  const g = c.createRadialGradient(cv.width / 2, cv.height / 2, r * 0.45, cv.width / 2, cv.height / 2, r);
  g.addColorStop(0, 'rgba(4,8,18,0)'); g.addColorStop(1, 'rgba(4,8,18,0.38)');
  c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
  FXC.vig = cv; FXC.vw = w; FXC.vh = h; return cv;
}
function postFX(dt) {
  if (!GFX.post) return;
  const w = canvas.width, h = canvas.height;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (GFX.post >= 2 && viewMode !== 'map') {
    if (FXC.filter === null) { const t = document.createElement('canvas').getContext('2d'); FXC.filter = 'filter' in t && (t.filter = 'blur(1px)', t.filter === 'blur(1px)'); }
    if (FXC.filter) {
      const sw = Math.max(1, w >> 3), sh = Math.max(1, h >> 3);
      if (!FXC.small) { FXC.small = document.createElement('canvas'); FXC.sctx = FXC.small.getContext('2d'); }
      if (FXC.small.width !== sw || FXC.small.height !== sh) { FXC.small.width = sw; FXC.small.height = sh; }
      const s = FXC.sctx;
      if ((frameNo % 3) === 0) { s.filter = 'brightness(0.9) contrast(2.2) blur(2px)'; s.clearRect(0, 0, sw, sh); s.drawImage(canvas, 0, 0, sw, sh); s.filter = 'none'; }
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.24;
      ctx.drawImage(FXC.small, 0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
  }
  ctx.drawImage(fxVignette(w, h), 0, 0, w, h);
  ctx.restore();
}
