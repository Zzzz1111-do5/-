/* =====================================================================
   Graphics quality
   Every renderer reads GFX.* to decide how much detail to draw. Level 3
   ("极致") is the default; on slow devices the auto monitor steps down.
   ===================================================================== */
const GFX_LEVELS = [
  { name: '流畅', dpr: 1, globe: 160000, parts: 0.4, post: 0, shadows: 0, weather: 0, water: 0, detail: 0 },
  { name: '均衡', dpr: 1.5, globe: 260000, parts: 0.7, post: 0, shadows: 1, weather: 1, water: 1, detail: 1 },
  { name: '精致', dpr: 2, globe: 420000, parts: 1, post: 1, shadows: 1, weather: 1, water: 1, detail: 2 },
  { name: '极致', dpr: 3, globe: 700000, parts: 1.5, post: 2, shadows: 1, weather: 1, water: 1, detail: 3 },
];
const GFX = Object.assign({ level: 3, auto: true }, GFX_LEVELS[3]);
let gfxSlow = 0, gfxVersion = 0;
function setGfx(level, auto) {
  level = clamp(level | 0, 0, GFX_LEVELS.length - 1);
  Object.assign(GFX, GFX_LEVELS[level], { level });
  if (auto !== undefined) GFX.auto = !!auto;
  try { localStorage.setItem('blue-planet-gfx', JSON.stringify({ level: GFX.level, auto: GFX.auto })); } catch (e) {}
  G.budget = GFX.globe; G.dirty = true;
  if (typeof GP !== 'undefined') { GP.budget = Math.round(GFX.globe * 0.75); GP.dirty = true; }
  gfxSlow = 0; gfxVersion++;
  if (typeof layout === 'function' && view.w > 0) layout();
}
function loadGfx() {
  let g = null; try { g = JSON.parse(localStorage.getItem('blue-planet-gfx') || 'null'); } catch (e) {}
  setGfx(g && g.level !== undefined ? g.level : 3, g && g.auto !== undefined ? g.auto : true);
}
// called once per frame with the real frame interval; steps quality down after ~4 s below ~40 fps
function gfxMonitor(dt) {
  if (!GFX.auto || GFX.level === 0 || document.hidden) { gfxSlow = 0; return; }
  if (dt > 0.025 && dt < 0.2) gfxSlow += dt; else gfxSlow = Math.max(0, gfxSlow - dt * 0.5);
  if (gfxSlow > 4) { setGfx(GFX.level - 1); if (typeof showTicker === 'function' && S) showTicker('civ', `画面帧率偏低，画质已自动调整为「${GFX.name}」`); }
}
