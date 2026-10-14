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
function drawGlobeScene() {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = CSSV['--space'] || '#060a14'; ctx.fillRect(0, 0, view.w, view.h);
  ctx.drawImage(starCanvas, 0, 0, view.w, view.h);
  drawMoon(false); drawOrbitalRing(false);
  const nsat = Math.min(SAT.length, Math.round(Math.sqrt(S.sats) * 2.2));
  const satP = []; for (let k = 0; k < nsat; k++) satP.push(satPos(SAT[k], animT));
  ctx.fillStyle = 'rgba(200,220,255,.7)';
  for (const p of satP) if (p.z < 0 && Math.hypot(p.x - G.cx, p.y - G.cy) > G.R) ctx.fillRect(p.x - 0.75, p.y - 0.75, 1.5, 1.5);
  const R = G.R;
  const ag = ctx.createRadialGradient(G.cx, G.cy, R * 0.96, G.cx, G.cy, R * 1.16);
  ag.addColorStop(0, 'rgba(90,160,255,0.42)'); ag.addColorStop(0.35, 'rgba(70,130,240,0.16)'); ag.addColorStop(1, 'rgba(60,110,230,0)');
  ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(G.cx, G.cy, R * 1.16, 0, TAU); ctx.fill();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(G.gc, 0, 0, G.gc.width, G.gc.height, G.box.x, G.box.y, G.gc.width / G.q, G.gc.height / G.q);
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
