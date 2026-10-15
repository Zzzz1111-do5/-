/* =====================================================================
   Globe scene and mini-globe
   ===================================================================== */
const SAT = Array.from({ length: 160 }, (_, k) => { const r = mulberry32(k * 977 + 3); return { inc: (r() - 0.5) * 2.2, node: r() * TAU, ph: r() * TAU, sp: 0.15 + r() * 0.35, rad: 1.07 + r() * 0.22 }; });
let moonA = 2.2, animT = 0;
function satPos(s, t) {
  const a = s.ph + t * s.sp;
  let x = Math.cos(a), y = 0, z = Math.sin(a);
  const ci = Math.cos(s.inc), si = Math.sin(s.inc);
  const y2 = y * ci - z * si, z2 = y * si + z * ci; y = y2; z = z2;
  const cn = Math.cos(s.node), sn = Math.sin(s.node);
  const x3 = x * cn + z * sn, z3 = -x * sn + z * cn;
  return { x: G.cx + x3 * s.rad * G.R, y: G.cy - y * s.rad * G.R, z: z3 };
}
function drawMoon(front) {
  const Rm = G.R * 1.85, z = Math.sin(moonA);
  if ((z >= 0) !== front) return;
  const mx = G.cx + Math.cos(moonA) * Rm, my = G.cy - G.R * 0.35 - Math.sin(moonA) * G.R * 0.12;
  const mr = G.R * 0.11 * (1 + z * 0.08);
  if (!front && Math.hypot(mx - G.cx, my - G.cy) < G.R + mr) return;
  const g = ctx.createRadialGradient(mx - mr * 0.45, my - mr * 0.25, mr * 0.1, mx, my, mr);
  g.addColorStop(0, '#d9dbe0'); g.addColorStop(0.6, '#9a9ea8'); g.addColorStop(1, '#3a3e48');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
  if (S.moon) { ctx.fillStyle = CSSV['--sodium']; ctx.beginPath(); ctx.arc(mx - mr * 0.2, my - mr * 0.1, Math.max(1.2, mr * 0.07), 0, TAU); ctx.fill(); }
}
function drawOrbitalRing(front) {
  if (S.orbital <= 0) return;
  const cp = Math.cos(G.pitch), sp = Math.sin(G.pitch), rr = 1.32 * G.R;
  ctx.save();
  ctx.strokeStyle = `rgba(184,162,255,${0.18 + 0.35 * S.orbital})`; ctx.lineWidth = 1.2;
  ctx.beginPath();
  let started = false;
  for (let k = 0; k <= 96; k++) {
    const a = k / 96 * TAU, px = Math.cos(a), pz = Math.sin(a), vy = -pz * sp, vz = pz * cp;
    const x = G.cx + px * rr, y = G.cy - vy * rr;
    if ((vz >= 0) === front) { if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); } else started = false;
  }
  ctx.stroke();
  const ns = Math.round(4 + 14 * S.orbital);
  for (let k = 0; k < ns; k++) {
    const a = k / ns * TAU + animT * 0.05, px = Math.cos(a), pz = Math.sin(a), vy = -pz * sp, vz = pz * cp;
    if ((vz >= 0) !== front) continue;
    ctx.fillStyle = CSSV['--violet']; ctx.fillRect(G.cx + px * rr - 2, G.cy - vy * rr - 1, 4, 2);
  }
  ctx.restore();
}
// ---- cached sky: graded stars + faint galaxy band (gfx >= 1; gfx 0 keeps the plain star field)
let skyCv = null, skyKey = '';
function globeSky() {
  if (GFX.level === 0) return starCanvas;
  const W0 = canvas.width, H0 = canvas.height, key = W0 + 'x' + H0 + '/' + GFX.level;
  if (key === skyKey && skyCv) return skyCv;
  skyKey = key; skyCv = skyCv || document.createElement('canvas');
  skyCv.width = W0; skyCv.height = H0;
  const c = skyCv.getContext('2d'), rnd = mulberry32(4321), dp = view.dpr, diag = Math.hypot(W0, H0);
  const ang = -0.42, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux, mx = W0 * 0.5, my = H0 * 0.55, bw = diag * 0.075;
  c.globalCompositeOperation = 'lighter';
  const blobs = 7 + GFX.level * 3;
  for (let k = 0; k < blobs; k++) {
    const t = (rnd() - 0.5) * diag * 1.1, o = (rnd() - 0.5) * bw * 0.9, x = mx + ux * t + nx * o, y = my + uy * t + ny * o;
    const rr = bw * (0.8 + rnd() * 1.4), hue = rnd();
    const col = hue < 0.4 ? '120,130,200' : hue < 0.75 ? '170,140,205' : '205,185,150';
    const gr = c.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, `rgba(${col},${0.05 + rnd() * 0.04})`); gr.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = gr; c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  const bandN = Math.round(W0 * H0 / (dp * dp) / (GFX.level >= 2 ? 260 : 520));
  for (let k = 0; k < bandN; k++) {
    const t = (rnd() - 0.5) * diag, g1 = rnd() + rnd() + rnd() - 1.5, o = g1 * bw * 0.8;
    const x = mx + ux * t + nx * o, y = my + uy * t + ny * o;
    c.fillStyle = `rgba(${200 + rnd() * 55 | 0},${200 + rnd() * 40 | 0},${225 + rnd() * 30 | 0},${0.08 + rnd() * 0.22})`;
    c.fillRect(x, y, dp, dp);
  }
  c.globalCompositeOperation = 'source-over';
  const TEMP = [[170, 195, 255], [215, 225, 255], [255, 250, 240], [255, 228, 180], [255, 196, 150]];
  const n = Math.round(W0 * H0 / (dp * dp) / 1500);
  for (let k = 0; k < n; k++) {
    const x = rnd() * W0, y = rnd() * H0, m = Math.pow(rnd(), 3), tc = TEMP[(rnd() * TEMP.length) | 0];
    const a = 0.2 + m * 0.8, sz = (m > 0.6 ? 1.6 : m > 0.25 ? 1.2 : 0.9) * dp;
    c.fillStyle = `rgba(${tc[0]},${tc[1]},${tc[2]},${a})`; c.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    if (m > 0.75 && GFX.level >= 2) {
      const rr = (2 + m * 3.5) * dp, gr = c.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, `rgba(${tc[0]},${tc[1]},${tc[2]},${0.35 * m})`); gr.addColorStop(1, `rgba(${tc[0]},${tc[1]},${tc[2]},0)`);
      c.fillStyle = gr; c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      if (m > 0.93) { c.fillStyle = `rgba(${tc[0]},${tc[1]},${tc[2]},0.22)`; c.fillRect(x - rr * 1.3, y - dp * 0.3, rr * 2.6, dp * 0.6); c.fillRect(x - dp * 0.3, y - rr * 1.3, dp * 0.6, rr * 2.6); }
    }
  }
  return skyCv;
}
// ---- atmosphere halo, built once in globe-radius units: blue on the sun side, orange at the terminator, dark at night
let haloCv = null, haloKey = -1;
const HALO_EXT = 1.3;
function globeHalo(night) {
  const key = night ? 1 : 0;
  if (haloCv && haloKey === key) return haloCv;
  haloKey = key; haloCv = haloCv || document.createElement('canvas');
  const HS = 256; haloCv.width = haloCv.height = HS;
  const c = haloCv.getContext('2d'), img = c.createImageData(HS, HS), d = img.data;
  const sl = Math.hypot(SUN[0], SUN[1]), s0 = SUN[0] / sl, s1 = SUN[1] / sl;
  for (let y = 0; y < HS; y++) for (let x = 0; x < HS; x++) {
    const u = ((x + 0.5) / HS * 2 - 1) * HALO_EXT, v = -((y + 0.5) / HS * 2 - 1) * HALO_EXT, r = Math.hypot(u, v);
    if (r < 0.9) continue;
    const h = r < 1 ? smooth(0.9, 1, r) : Math.exp(-(r - 1) * 15) * 0.85 + Math.exp(-(r - 1) * 45) * 0.15;
    const lit = night ? (u * s0 + v * s1) / r : 1;
    const day = night ? smooth(-0.35, 0.4, lit) : 1, tw = night ? Math.exp(-(((lit + 0.05) / 0.2) ** 2)) : 0;
    const al = h * (0.06 + 0.62 * day + 0.32 * tw);
    if (al <= 0.004) continue;
    const wsum = day + tw * 0.9 + 0.08;
    const o = (y * HS + x) * 4;
    d[o] = (95 * day + 255 * tw * 0.9 + 40 * 0.08) / wsum; d[o + 1] = (160 * day + 125 * tw * 0.9 + 60 * 0.08) / wsum; d[o + 2] = (255 * day + 70 * tw * 0.9 + 140 * 0.08) / wsum; d[o + 3] = Math.min(255, al * 255);
  }
  c.putImageData(img, 0, 0);
  return haloCv;
}
// ---- aurora curtains around both magnetic poles (detail >= 2, night shading on)
function drawAurora() {
  const R = G.R, cp = Math.cos(G.pitch), sp = Math.sin(G.pitch);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let pole = 0; pole < 2; pole++) {
    const plat = pole ? -1.38 : 1.38, plon = pole ? 1.9 : -1.25, cr = 0.33;
    const sa = Math.sin(plat), ca = Math.cos(plat);
    const NR = 120, pts = [];
    for (let k = 0; k <= NR; k++) {
      const th = k / NR * TAU;
      // point at angular distance cr from the pole along bearing th
      const lat = Math.asin(sa * Math.cos(cr) + ca * Math.sin(cr) * Math.cos(th));
      const lon = plon + Math.atan2(Math.sin(th) * Math.sin(cr) * ca, Math.cos(cr) - sa * Math.sin(lat));
      const lonP = lon - G.rot, cl = Math.cos(lat);
      const px = -cl * Math.cos(lonP), py = Math.sin(lat), pz = cl * Math.sin(lonP);
      const vy = py * cp - pz * sp, vz = py * sp + pz * cp;
      const dot = px * SUN[0] + vy * SUN[1] + vz * SUN[2];
      const wav = 0.5 + 0.5 * Math.sin(k * 0.31 + animT * 0.9) * Math.sin(k * 0.13 - animT * 0.5);
      const hgt = 0.022 + 0.035 * wav;
      const x0 = G.cx + px * R, y0 = G.cy - vy * R, x1 = G.cx + px * R * (1 + hgt), y1 = G.cy - vy * R * (1 + hgt);
      // hidden: behind the globe (top of the curtain also inside the disc) or on the day side
      const hid = vz < 0 && (x1 - G.cx) * (x1 - G.cx) + (y1 - G.cy) * (y1 - G.cy) < R * R;
      pts.push({ x0, y0, x1, y1, a: hid ? 0 : (1 - smooth(-0.25, 0.1, dot)) * (0.1 + 0.3 * wav) * (0.75 + 0.25 * Math.sin(k * 2.3 + animT * 3)) });
    }
    for (let k = 0; k < NR; k++) {
      const p = pts[k], q = pts[k + 1], al = (p.a + q.a) * 0.5;
      if (al < 0.01) continue;
      const mx0 = p.x0 + (p.x1 - p.x0) * 0.45, my0 = p.y0 + (p.y1 - p.y0) * 0.45, mx1 = q.x0 + (q.x1 - q.x0) * 0.45, my1 = q.y0 + (q.y1 - q.y0) * 0.45;
      ctx.fillStyle = `rgba(70,255,140,${al})`;
      ctx.beginPath(); ctx.moveTo(p.x0, p.y0); ctx.lineTo(q.x0, q.y0); ctx.lineTo(mx1, my1); ctx.lineTo(mx0, my0); ctx.fill();
      ctx.fillStyle = `rgba(170,90,255,${al * 0.4})`;
      ctx.beginPath(); ctx.moveTo(mx0, my0); ctx.lineTo(mx1, my1); ctx.lineTo(q.x1, q.y1); ctx.lineTo(p.x1, p.y1); ctx.fill();
    }
  }
  ctx.restore();
}
function drawGlobeScene() {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = CSSV['--space'] || '#060a14'; ctx.fillRect(0, 0, view.w, view.h);
  ctx.drawImage(globeSky(), 0, 0, view.w, view.h);
  drawMoon(false); drawOrbitalRing(false);
  const nsat = Math.min(SAT.length, Math.round(Math.sqrt(S.sats) * 2.2));
  const satP = []; for (let k = 0; k < nsat; k++) satP.push(satPos(SAT[k], animT));
  ctx.fillStyle = 'rgba(200,220,255,.7)';
  for (const p of satP) if (p.z < 0 && Math.hypot(p.x - G.cx, p.y - G.cy) > G.R) ctx.fillRect(p.x - 0.75, p.y - 0.75, 1.5, 1.5);
  const R = G.R, hi = GFX.level > 0;
  if (hi) {
    const he = R * HALO_EXT; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(globeHalo(showNight), G.cx - he, G.cy - he, he * 2, he * 2);
  } else {
    const ag = ctx.createRadialGradient(G.cx, G.cy, R * 0.96, G.cx, G.cy, R * 1.16);
    ag.addColorStop(0, 'rgba(90,160,255,0.42)'); ag.addColorStop(0.35, 'rgba(70,130,240,0.16)'); ag.addColorStop(1, 'rgba(60,110,230,0)');
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(G.cx, G.cy, R * 1.16, 0, TAU); ctx.fill();
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(G.gc, 0, 0, G.gc.width, G.gc.height, G.box.x, G.box.y, G.gc.width / G.q, G.gc.height / G.q);
  if (hi) {
    // thin bright limb on the sun side
    const sl = Math.hypot(SUN[0], SUN[1]), lx = SUN[0] / sl, ly = -SUN[1] / sl;
    const lg = ctx.createLinearGradient(G.cx + lx * R, G.cy + ly * R, G.cx - lx * R, G.cy - ly * R);
    lg.addColorStop(0, 'rgba(170,215,255,0.7)'); lg.addColorStop(0.42, showNight ? 'rgba(255,170,110,0.25)' : 'rgba(170,215,255,0.4)'); lg.addColorStop(0.6, showNight ? 'rgba(120,150,255,0)' : 'rgba(170,215,255,0.3)');
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = lg; ctx.lineWidth = Math.max(1, R * 0.004);
    ctx.beginPath(); ctx.arc(G.cx, G.cy, R - 0.5, 0, TAU); ctx.stroke(); ctx.restore();
    if (GFX.detail >= 2 && showNight && layer === 0) drawAurora();
  }
  const vis = [];
  for (const c of S.cities) { const p = globeProject(G, c.lat, c.lon); if (p.z < 0.03) continue; vis.push({ c, x: p.x, y: p.y, z: p.z, r: 4 }); }
  vis.sort((a, b) => a.c.pop - b.c.pop);
  const ms = layer === 1 || layer === 3 ? 1.15 : 0.85;
  for (const s of vis) {
    const c = s.c, n = S.nations[c.n], dim = selectedNation >= 0 && c.n !== selectedNation;
    const rr = clamp(1.2 + Math.log10(Math.max(1, c.pop / 30000)) * 1.25, 1.2, 5.2) * ms * (0.6 + 0.4 * s.z) * Math.sqrt(G.zoom / 1.6);
    ctx.globalAlpha = (dim ? 0.25 : 1) * clamp(s.z * 4, 0, 1);
    ctx.fillStyle = n.color; ctx.strokeStyle = 'rgba(6,10,20,.85)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, TAU); ctx.fill(); ctx.stroke();
    if (c.cap) { ctx.strokeStyle = n.color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(s.x, s.y, rr + 2.5, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1; s.r = rr + 4;
  }
  screenCities = vis;
  if (showNames) {
    const boxes = []; ctx.font = `12px ${CSSV.font}`; ctx.textBaseline = 'middle'; let k = 0;
    for (const s of vis.slice().sort((a, b) => b.c.pop - a.c.pop)) {
      if (k >= (view.w < 600 ? 7 : 14) || s.z < 0.3) continue;
      const tw = ctx.measureText(s.c.name).width, b = { x: s.x + s.r + 2, y: s.y - 8, w: tw, h: 16 };
      if (boxes.some(o => b.x < o.x + o.w + 4 && b.x + b.w + 4 > o.x && b.y < o.y + o.h && b.y + b.h > o.y)) continue;
      boxes.push(b); k++;
      ctx.globalAlpha = clamp((s.z - 0.3) * 4, 0, 1);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(6,10,20,.8)'; ctx.strokeText(s.c.name, b.x, s.y);
      ctx.fillStyle = s.c.cap ? '#fff4dc' : 'rgba(233,238,248,.9)'; ctx.fillText(s.c.name, b.x, s.y);
      ctx.globalAlpha = 1;
    }
  }
  for (const w of S.wars) {
    if (w.front < 0) continue;
    const ll = cellLatLon(w.front), p = globeProject(G, ll.lat, ll.lon); if (p.z < 0.05) continue;
    const ph = (animT * 1.4) % 1;
    ctx.strokeStyle = `rgba(255,95,107,${0.9 * (1 - ph)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 5 + ph * 12, 0, TAU); ctx.stroke();
    swordsIcon(p.x, p.y, 8, CSSV['--blood']);
  }
  for (let k = FX.length - 1; k >= 0; k--) {
    const f = FX[k], age = (animT - f.t0) / 3;
    if (age >= 1) { FX.splice(k, 1); continue; }
    const p = globeProject(G, f.lat, f.lon); if (p.z < 0.05) continue;
    ctx.globalAlpha = 1 - age; ctx.strokeStyle = f.col || CSSV[FX_COL[f.type] || '--sodium'] || '#ffb547'; ctx.lineWidth = f.type === 'meteor' ? 3 : 1.6;
    ctx.beginPath(); ctx.arc(p.x, p.y, 4 + age * (f.type === 'meteor' ? 60 : 26), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (selected && (selected.city || selected.cell >= 0)) {
    let lat, lon;
    if (selected.city) { const c = cityById(selected.city); if (c) { lat = c.lat; lon = c.lon; } } else { const ll = cellLatLon(selected.cell); lat = ll.lat; lon = ll.lon; }
    if (lat !== undefined) { const p = globeProject(G, lat, lon); if (p.z > 0) { ctx.strokeStyle = CSSV['--sodium']; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, TAU); ctx.stroke(); ctx.setLineDash([]); } }
  }
  ctx.fillStyle = 'rgba(220,235,255,.9)';
  for (const p of satP) if (p.z >= 0) ctx.fillRect(p.x - 0.9, p.y - 0.9, 1.8, 1.8);
  drawOrbitalRing(true);
  for (let k = SHIPS.length - 1; k >= 0; k--) {
    const s = SHIPS[k], age = (animT - s.t0) / 6;
    if (age >= 1) { SHIPS.splice(k, 1); continue; }
    const p0 = globeProject(G, s.lat, s.lon), dx = Math.cos(s.ang), dy = Math.sin(s.ang);
    const dist = Math.pow(age, 1.6) * Math.max(view.w, view.h), hx = p0.x + dx * dist, hy = p0.y + dy * dist, tail = Math.min(dist, 60 + age * 80);
    const gr = ctx.createLinearGradient(hx, hy, hx - dx * tail, hy - dy * tail);
    gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(1, 'rgba(255,181,71,0)');
    ctx.strokeStyle = gr; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - dx * tail, hy - dy * tail); ctx.stroke();
  }
  drawMoon(true);
}
function drawMini() {
  const g = GM;
  const lon = (cam.x / MW) * TAU - PI, lat = PI / 2 - (cam.y / MH) * PI;
  g.rot = lon - PI / 2;
  const np = clamp(lat * 0.85, -1, 1);
  if (Math.abs(np - g.pitch) > 0.03) { g.pitch = np; g.dirty = true; }
  globeRender(g, { night: false, clouds: true, lights: false, cloudK: 0.7 });
  miniCtx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  miniCtx.clearRect(0, 0, g.w, g.h);
  const ag = miniCtx.createRadialGradient(g.cx, g.cy, g.R * 0.9, g.cx, g.cy, g.R * 1.08);
  ag.addColorStop(0, 'rgba(90,160,255,.45)'); ag.addColorStop(1, 'rgba(90,160,255,0)');
  miniCtx.fillStyle = ag; miniCtx.beginPath(); miniCtx.arc(g.cx, g.cy, g.R * 1.08, 0, TAU); miniCtx.fill();
  miniCtx.drawImage(g.gc, 0, 0, g.gc.width, g.gc.height, g.box.x, g.box.y, g.gc.width / g.q, g.gc.height / g.q);
  const hw = view.w / 2 / cam.z, hh = view.h / 2 / cam.z;
  if (hw * 2 >= MW * 0.98) return;
  const pts = [];
  const y0 = Math.max(0, cam.y - hh), y1 = Math.min(MH, cam.y + hh), x0 = cam.x - hw, x1 = cam.x + hw;
  for (let t = 0; t <= 1; t += 0.1) pts.push([x0 + (x1 - x0) * t, y0]);
  for (let t = 0; t <= 1; t += 0.1) pts.push([x1, y0 + (y1 - y0) * t]);
  for (let t = 0; t <= 1; t += 0.1) pts.push([x1 - (x1 - x0) * t, y1]);
  for (let t = 0; t <= 1; t += 0.1) pts.push([x0, y1 - (y1 - y0) * t]);
  miniCtx.strokeStyle = CSSV['--sodium']; miniCtx.lineWidth = 1.5; miniCtx.beginPath();
  let pen = false;
  for (const [mx, my] of pts) {
    const p = globeProject(g, PI / 2 - my / MH * PI, mx / MW * TAU - PI);
    if (p.z < 0) { pen = false; continue; }
    if (!pen) { miniCtx.moveTo(p.x, p.y); pen = true; } else miniCtx.lineTo(p.x, p.y);
  }
  miniCtx.stroke();
}
