/* =====================================================================
   Views, camera
   ===================================================================== */
const canvas = $('view'), ctx = canvas.getContext('2d');
const stageEl = $('stage');
const starCanvas = document.createElement('canvas');
const miniCv = $('miniCv'), miniCtx = miniCv.getContext('2d');
const view = { w: 800, h: 600, dpr: 1 };
let viewMode = 'map';
let showClouds = true, showNight = true, autoSpin = false, showPeople = true, showNames = true;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const cam = { x: MW / 2, y: MH / 2, z: 0.5, tz: 0.5, vx: 0, vy: 0, ax: null, ay: null, follow: null, shake: 0 };
const Z_MAX = 10, AGENT_Z = 2.2, BUILD_Z = 1.6;
let CSSV = {};
function readCss() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['--ink', '--ink-2', '--ink-3', '--line', '--panel', '--panel-3', '--sodium', '--sea', '--leaf', '--ember', '--blood', '--violet', '--series-1', '--space'])
    CSSV[k] = cs.getPropertyValue(k).trim();
  CSSV.font = getComputedStyle(document.body).fontFamily;
}
function zMin() { return view.w / MW; }
function layout() {
  const r = stageEl.getBoundingClientRect();
  view.w = Math.max(200, r.width); view.h = Math.max(200, r.height);
  view.dpr = Math.min(window.devicePixelRatio || 1, GFX.dpr);
  canvas.width = Math.round(view.w * view.dpr); canvas.height = Math.round(view.h * view.dpr);
  starCanvas.width = canvas.width; starCanvas.height = canvas.height;
  const sc = starCanvas.getContext('2d'), rnd = mulberry32(1234);
  sc.clearRect(0, 0, starCanvas.width, starCanvas.height);
  const count = Math.round(view.w * view.h / 1800);
  for (let k = 0; k < count; k++) {
    const x = rnd() * starCanvas.width, y = rnd() * starCanvas.height, s = rnd();
    sc.fillStyle = `rgba(${200 + rnd() * 55 | 0},${210 + rnd() * 45 | 0},255,${0.25 + s * 0.6})`;
    const sz = (s > 0.94 ? 2 : 1) * view.dpr; sc.fillRect(x, y, sz, sz);
  }
  G.w = view.w; G.h = view.h; G.dpr = view.dpr; G.cx = view.w / 2; G.cy = view.h / 2 - 20;
  G.R = Math.min(view.w, view.h) * (view.w < 600 ? 0.42 : 0.36) * G.zoom; G.dirty = true;
  const md = Math.min(2, window.devicePixelRatio || 1), ms = miniCv.getBoundingClientRect().width || 118;
  miniCv.width = Math.round(ms * md); miniCv.height = Math.round(ms * md);
  GM.w = GM.h = ms; GM.cx = GM.cy = ms / 2; GM.R = ms / 2 - 3; GM.dpr = md; GM.dirty = true;
  cam.tz = clamp(cam.tz, zMin(), Z_MAX); cam.z = clamp(cam.z, zMin(), Z_MAX);
}
function sxOf(mx) { let dx = mx - cam.x; dx -= Math.round(dx / MW) * MW; return dx * cam.z + view.w / 2; }
function syOf(my) { return (my - cam.y) * cam.z + view.h / 2; }
function mapAt(sx, sy) {
  let mx = cam.x + (sx - view.w / 2) / cam.z; mx = ((mx % MW) + MW) % MW;
  const my = cam.y + (sy - view.h / 2) / cam.z;
  return { mx, my, cell: my >= 0 && my < MH ? Math.floor(my / PX) * W + Math.floor(mx / PX) : -1 };
}
function cityMpx(c) { return [(c.lon + PI) / TAU * MW, (PI / 2 - c.lat) / PI * MH]; }
function cellMpx(i) { const y = (i / W) | 0, x = i - y * W; return [(x + 0.5) * PX, (y + 0.5) * PX]; }
function wrapDx(dx) { return dx - Math.round(dx / MW) * MW; }
function viewRect(m) {
  const hw = view.w / 2 / cam.z + m, hh = view.h / 2 / cam.z + m;
  return (x, y) => Math.abs(wrapDx(x - cam.x)) <= hw && Math.abs(y - cam.y) <= hh;
}
function zoomAt(sx, sy, factor) {
  cam.tz = clamp(cam.tz * factor, zMin() * 0.85, Z_MAX); cam.ax = sx; cam.ay = sy; cam.follow = null;
  if (cam.tz < zMin() * 0.95) { cam.tz = zMin(); switchView('globe', true); }
}
function centerOn(mx, my, z) { cam.x = mx; cam.y = my; cam.vx = cam.vy = 0; if (z) { cam.z = cam.tz = clamp(z, zMin(), Z_MAX); } cam.ax = null; }
function updateCam(dt) {
  if (Math.abs(cam.tz - cam.z) > 1e-5) {
    const nz = cam.z + (cam.tz - cam.z) * Math.min(1, dt * 12);
    if (cam.ax !== null) {
      const wx = cam.x + (cam.ax - view.w / 2) / cam.z, wy = cam.y + (cam.ay - view.h / 2) / cam.z;
      cam.z = nz; cam.x = wx - (cam.ax - view.w / 2) / cam.z; cam.y = wy - (cam.ay - view.h / 2) / cam.z;
    } else cam.z = nz;
  }
  if (!drag) { cam.x += cam.vx * dt; cam.y += cam.vy * dt; const k = Math.exp(-dt * 5); cam.vx *= k; cam.vy *= k; }
  if (cam.follow) {
    const a = cam.follow;
    if (a.st === 'dead' || !AG.includes(a)) cam.follow = null;
    else { cam.x += wrapDx(a.x - cam.x) * Math.min(1, dt * 4); cam.y += (a.y - cam.y) * Math.min(1, dt * 4); }
  }
  cam.x = ((cam.x % MW) + MW) % MW;
  const hh = view.h / 2 / cam.z;
  cam.y = hh * 2 >= MH ? MH / 2 : clamp(cam.y, hh, MH - hh);
  if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 1.5);
}
let spaceReturn = 'map';
function setView(mode, near) { switchView(mode, near); }
function onSpaceUnlocked() { const b = $('vSystem'); if (b) b.hidden = false; }
function switchView(mode, near) {
  if (mode === viewMode) return;
  const from = viewMode;
  if (mode === 'system' || mode === 'planet') {
    if (!S.space || !S.space.unlocked) return;
    if (from === 'map' || from === 'globe') spaceReturn = from;
    viewMode = mode; layout(); AG.length = 0; PROJ.length = 0; cam.follow = null; sys.hover = null;
    onViewChanged(); return;
  }
  if (from === 'system' || from === 'planet') {
    viewMode = mode; layout();
    if (mode === 'globe') { G.vr = G.vp = 0; flushDirty(); buildLights(); lastLights = performance.now(); } else flushMapDirty();
    onViewChanged(); return;
  }
  if (mode === 'globe') {
    const lon = (cam.x / MW) * TAU - PI, lat = PI / 2 - (cam.y / MH) * PI;
    G.rot = lon - PI / 2; G.pitch = clamp(lat * 0.7, -0.9, 0.9); G.zoom = near ? 1.9 : 1.1; G.vr = G.vp = 0;
    viewMode = 'globe'; layout(); flushDirty(); buildLights(); lastLights = performance.now();
  } else {
    const u = globeUnproject(G, G.cx, G.cy);
    viewMode = 'map'; layout();
    if (u) centerOn((u.lon + PI) / TAU * MW, (PI / 2 - u.lat) / PI * MH, zMin() * 1.6);
    flushMapDirty();
  }
  AG.length = 0;
  onViewChanged();
}

