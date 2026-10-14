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
  ctx.fillStyle = '#0c2a52'; ctx.fillRect(-20, -20, sw + 40, sh + 40);
  const x0 = cam.x - sw / 2 / z, x1 = cam.x + sw / 2 / z, y0 = cam.y - sh / 2 / z, y1 = cam.y + sh / 2 / z;
  ctx.imageSmoothingEnabled = z < 1.2;
  for (let k = Math.floor(x0 / MW); k * MW < x1; k++) {
    const ox = k * MW;
    const sx0 = Math.max(Math.floor(x0 - ox), 0), sx1 = Math.min(Math.ceil(x1 - ox), MW);
    const sy0 = Math.max(Math.floor(y0), 0), sy1 = Math.min(Math.ceil(y1), MH);
    if (sx1 <= sx0 || sy1 <= sy0) continue;
    ctx.drawImage(mapCanvas, sx0, sy0, sx1 - sx0, sy1 - sy0, (ox + sx0 - cam.x) * z + sw / 2, (sy0 - cam.y) * z + sh / 2, (sx1 - sx0) * z, (sy1 - sy0) * z);
  }
  ctx.imageSmoothingEnabled = true;
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
function drawMapLayer(x0, y0, x1, y1, z) {
  const cs = PX * z + 0.6;
  const tint = layer === 0 ? clamp((2.2 - z) / 1.6, 0, 1) * 0.12 : 0;
  if (layer === 0 && tint <= 0.005) return;
  if (layer >= 2 && layer <= 4) { ctx.fillStyle = 'rgba(6,10,20,.45)'; ctx.fillRect(0, 0, view.w, view.h); }
  const sw2 = view.w / 2, sh2 = view.h / 2;
  forVisibleCells(x0, y0, x1, y1, (i, cxr, cy) => {
    const sx = (cxr * PX - cam.x) * z + sw2, sy = (cy * PX - cam.y) * z + sh2;
    const own = S.owner[i], land = WORLD.elev[i] > S.seaRise;
    if (layer <= 1 || layer === 5) {
      if (own >= 0 && land) { ctx.globalAlpha = layer >= 1 ? (selectedNation >= 0 && own !== selectedNation ? 0.15 : 0.5) : tint; ctx.fillStyle = layer === 5 ? ideoOf(S.nations[own]).color : S.nations[own].color; ctx.fillRect(sx, sy, cs, cs); }
    } else if (layer === 2) {
      ctx.globalAlpha = 1;
      let k = 0;
      for (const r of RES) {
        const amt = S.res[r][i], a0 = WORLD.res0[r][i];
        if (a0 <= 0) continue;
        const fx = [0.3, 0.7, 0.3, 0.7, 0.5][k], fy = [0.3, 0.3, 0.7, 0.7, 0.5][k]; k++;
        const s = clamp(PX * z * 0.22, 2.5, 9) * (amt > 0 ? 0.55 + 0.45 * Math.sqrt(amt / a0) : 0.6);
        const c = RES_RGB[r];
        ctx.fillStyle = amt > 0 ? `rgb(${c[0]},${c[1]},${c[2]})` : '#46464c';
        ctx.beginPath(); ctx.moveTo(sx + fx * cs, sy + fy * cs - s); ctx.lineTo(sx + fx * cs + s, sy + fy * cs); ctx.lineTo(sx + fx * cs, sy + fy * cs + s); ctx.lineTo(sx + fx * cs - s, sy + fy * cs); ctx.closePath(); ctx.fill();
      }
      if (!land && WORLD.fish[i] > 0) { ctx.globalAlpha = WORLD.fish[i] * 0.5; ctx.fillStyle = '#96c8ff'; ctx.fillRect(sx + cs * 0.4, sy + cs * 0.4, cs * 0.2, cs * 0.2); }
    } else if (layer === 3) {
      if (land) {
        const ci = S.cityOf[i], c = ci >= 0 ? S.cities[ci] : null;
        if (c && c.cells > 0) { const col = popColor(clamp((Math.log10(c.pop / c.cells) - 3.8) / 3.4, 0, 1)); ctx.globalAlpha = 0.75; ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`; ctx.fillRect(sx, sy, cs, cs); }
      }
    } else if (layer === 4) {
      const col = tempColor(cellTeff(i)); ctx.globalAlpha = 0.6; ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`; ctx.fillRect(sx, sy, cs, cs);
      const sm = S.smog[i]; if (land && sm > 0.05) { ctx.globalAlpha = Math.min(0.7, sm); ctx.fillStyle = '#605038'; ctx.fillRect(sx, sy, cs, cs); }
    }
  });
  ctx.globalAlpha = 1;
}
function drawBorders(x0, y0, x1, y1, z) {
  const paths = new Map(), cs = PX * z, sw2 = view.w / 2, sh2 = view.h / 2, ins = Math.min(1.5, cs * 0.06);
  const rise = S.seaRise, E = WORLD.elev, O = S.owner;
  forVisibleCells(x0, y0, x1, y1, (i, cxr, cy) => {
    const own = O[i]; if (own < 0 || E[i] <= rise) return;
    const x = i - cy * W, sx = (cxr * PX - cam.x) * z + sw2, sy = (cy * PX - cam.y) * z + sh2;
    const jr = cy * W + (x + 1) % W, jl = cy * W + (x + W - 1) % W;
    let p = paths.get(own); if (!p) { p = new Path2D(); paths.set(own, p); }
    if (E[jr] > rise && O[jr] !== own) { p.moveTo(sx + cs - ins, sy); p.lineTo(sx + cs - ins, sy + cs); }
    if (E[jl] > rise && O[jl] !== own) { p.moveTo(sx + ins, sy); p.lineTo(sx + ins, sy + cs); }
    if (cy < H - 1 && E[i + W] > rise && O[i + W] !== own) { p.moveTo(sx, sy + cs - ins); p.lineTo(sx + cs, sy + cs - ins); }
    if (cy > 0 && E[i - W] > rise && O[i - W] !== own) { p.moveTo(sx, sy + ins); p.lineTo(sx + cs, sy + ins); }
  });
  ctx.lineCap = 'square';
  for (const [own, p] of paths) {
    const sel = own === selectedNation || (diploFrom && diploFrom.n === own);
    ctx.lineWidth = clamp(z * 0.9, 1, 3) * (sel ? 2 : 1);
    ctx.globalAlpha = sel ? 1 : 0.85;
    ctx.strokeStyle = S.nations[own].color; ctx.stroke(p);
  }
  ctx.globalAlpha = 1;
}
function drawRoads(z) {
  const byId = new Map(S.cities.map(c => [c.id, c]));
  ctx.lineCap = 'round';
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
      const era = S.nations[c.n].mult.era;
      ctx.strokeStyle = era >= 4 ? 'rgba(66,66,72,.85)' : 'rgba(150,118,78,.75)';
      ctx.lineWidth = Math.max(1, z * (era >= 4 ? 1.1 : 0.7));
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      if (era >= 4 && z > 2.2) { ctx.strokeStyle = 'rgba(232,222,160,.55)'; ctx.lineWidth = Math.max(0.6, z * 0.15); ctx.setLineDash([z * 0.8, z * 1.4]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]); }
    }
  }
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
    ctx.beginPath(); ctx.arc(sx, sy, 7 + ph * 14, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(6,10,20,.75)'; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, TAU); ctx.fill();
    swordsIcon(sx, sy, 9, CSSV['--blood']);
  }
  for (const o of S.orders) {
    const a = cityById(o.from), b = cityById(o.to);
    if (!a || !b) continue;
    const [ax0, ay0] = cityMpx(a), [bx0, by0] = cityMpx(b);
    const ax = sxOf(ax0), ay = syOf(ay0), bx = ax + wrapDx(bx0 - ax0) * z, by = ay + (by0 - ay0) * z;
    const col = S.nations[o.a].color;
    ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -animT * 20;
    const mx = (ax + bx) / 2, my = (ay + by) / 2 - Math.hypot(bx - ax, by - ay) * 0.18;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke(); ctx.setLineDash([]);
    const ang = Math.atan2(by - my, bx - mx);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(ang - 0.4) * 12, by - Math.sin(ang - 0.4) * 12); ctx.lineTo(bx - Math.cos(ang + 0.4) * 12, by - Math.sin(ang + 0.4) * 12); ctx.closePath(); ctx.fill();
    const t = clamp((S.year - o.start + budget) / Math.max(1, o.eta - o.start), 0, 1), it = 1 - t;
    const px = it * it * ax + 2 * it * t * mx + t * t * bx, py = it * it * ay + 2 * it * t * my + t * t * by;
    ctx.fillStyle = 'rgba(6,10,20,.8)'; ctx.beginPath(); ctx.arc(px, py, 9, 0, TAU); ctx.fill();
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
  ctx.strokeStyle = CSSV['--sodium']; ctx.lineWidth = 1.6; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -animT * 10;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * (selected.agent ? 0.5 : 0.8), 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  if (diploFrom) { const c = cityById(diploFrom.city); if (c) { const [mx, my] = cityMpx(c); ctx.strokeStyle = S.nations[c.n].color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(sxOf(mx), syOf(my), 16, 0, TAU); ctx.stroke(); } }
}
function drawCityLabels(vis, z) {
  const boxes = [];
  const list = vis.slice().sort((a, b) => b.c.pop - a.c.pop);
  const maxN = z >= BUILD_Z ? 80 : view.w < 600 ? 8 : 18;
  ctx.font = `${z >= BUILD_Z ? 12 : 11}px ${CSSV.font}`;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  let k = 0;
  for (const v of list) {
    if (k >= maxN) break;
    if (selectedNation >= 0 && v.c.n !== selectedNation && z < BUILD_Z) continue;
    const c = v.c, txt = c.name + (z >= 3 ? ` · ${fmtPop(c.pop)}` : '');
    const tw = ctx.measureText(txt).width + 14;
    const ly = z >= BUILD_Z ? v.y - Math.max(18, layoutFor(c).r * z * 0.75 + 10) : v.y - v.r - 8;
    const b = { x: v.x - tw / 2, y: ly - 8, w: tw, h: 16 };
    if (b.x > view.w || b.x + b.w < 0 || b.y > view.h || b.y + b.h < 0) continue;
    if (boxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)) continue;
    boxes.push(b); k++;
    ctx.fillStyle = 'rgba(6,10,20,.72)'; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = S.nations[c.n].color; ctx.fillRect(b.x, b.y, 3, b.h);
    ctx.fillStyle = c.cap ? '#fff4dc' : 'rgba(233,238,248,.92)';
    ctx.fillText(txt, v.x + 1.5, ly);
  }
  ctx.textAlign = 'left';
}

