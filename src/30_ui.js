/* =====================================================================
   Main loop
   ===================================================================== */
let playing = true, speed = 'auto', budget = 0, lastT = 0, lastLights = -1e9, lastRecolor = 0, lastMFlush = 0, lastUI = 0, lastSlowUI = 0, lastLayerRefresh = 0, lastAgentMgr = 0, frameNo = 0, lastSave = 0, lastSpaceUI = 0;
let booting = false, techVersion = 0, achVersion = 0;
const AUTO_SPEED = [40, 30, 22, 15, 6, 4, 3, 3, 3];
function zoomTimeFactor() {
  if (viewMode !== 'map' || cam.z <= 1.2) return 1;
  const t = clamp((Math.log(cam.z) - Math.log(1.2)) / (Math.log(8) - Math.log(1.2)), 0, 1);
  return Math.exp(t * Math.log(0.025));
}
function effSpeed() { return speed === 'auto' ? AUTO_SPEED[S.flags.maxEra || 0] * zoomTimeFactor() : speed; }
let perfMs = 0;
function frame(t) {
  const t0 = performance.now(), rawDt = (t - lastT) / 1000 || 0;
  const dt = Math.min(0.1, rawDt);
  lastT = t; animT += dt; frameNo++;
  if (playing && S) {
    budget += effSpeed() * dt;
    let steps = 0;
    while (budget >= 1 && steps < 6) { tick(); budget -= 1; steps++; }
    if (budget > 2) budget = 2;
    if (steps && S.terrDirty) territory();
  }
  if (viewMode === 'map') {
    if (mdirtyList.length && t - lastMFlush > 120) { flushMapDirty(); lastMFlush = t; }
    if (dirtyList.length && t - lastRecolor > 700) { flushDirty(); lastRecolor = t; }
    if (cam.goal) { cam.x += wrapDx(cam.goal.x - cam.x) * Math.min(1, dt * 3); cam.y += (cam.goal.y - cam.y) * Math.min(1, dt * 3); if (Math.abs(wrapDx(cam.goal.x - cam.x)) < 0.5 && Math.abs(cam.goal.y - cam.y) < 0.5) cam.goal = null; }
    updateCam(dt);
    if (t - lastAgentMgr > 300) { manageAgents(); manageArmies(); lastAgentMgr = t; }
    if (playing) updateAgents(dt);
    updateParticles(dt);
    ambientTick(dt);
    drawMapScene();
    if ((frameNo & 1) === 0) drawMini();
  } else if (viewMode === 'system' || viewMode === 'planet') {
    if (dirtyList.length && t - lastRecolor > 700) { flushDirty(); lastRecolor = t; }
    if (viewMode === 'system') drawSystemScene(); else drawPlanetScene();
    if (t - lastSpaceUI > 600) { renderSpaceUI(); lastSpaceUI = t; }
  } else {
    if (dirtyList.length && t - lastRecolor > 120) { flushDirty(); lastRecolor = t; }
    if ((layer >= 3) && t - lastLayerRefresh > 1500) { recolorAll(); lastLayerRefresh = t; }
    if (t - lastLights > 450) { buildLights(); lastLights = t; }
    if (!drag) {
      if (Math.abs(G.vr) > 1e-4 || Math.abs(G.vp) > 1e-4) {
        G.rot += G.vr * dt;
        const np = clamp(G.pitch + G.vp * dt, -1.3, 1.3); if (np !== G.pitch) { G.pitch = np; G.dirty = true; }
        const k = Math.exp(-dt * 4); G.vr *= k; G.vp *= k;
      }
      if (autoSpin) G.rot -= dt * 0.07;
    }
    globeRender(G, { night: showNight, clouds: showClouds, lights: true });
    drawGlobeScene();
  }
  postFX(dt);
  perfMs = perfMs * 0.95 + (performance.now() - t0) * 0.05;
  gfxMonitor(rawDt);
  if (!reducedMotion) { cloudOff += dt * 0.0035; moonA += dt * 0.03; }
  if (t - lastUI > 200) { updateHeader(); updateInspector(); lastUI = t; }
  if (t - lastSlowUI > (playing && speed !== 'auto' && speed > 20 ? 400 : 900)) { updatePanels(); lastSlowUI = t; }
  if (t - lastSave > 30000) { saveWorld(); lastSave = t; }
  requestAnimationFrame(frame);
}
function flyTo(mx, my, z) { if (viewMode !== 'map') switchView('map'); cam.goal = { x: mx, y: my }; cam.tz = clamp(z, zMin(), Z_MAX); cam.ax = null; cam.vx = cam.vy = 0; cam.follow = null; }
function flyToCell(i, z) { const [mx, my] = cellMpx(i); flyTo(mx, my, z || Math.max(cam.z, 3.2)); }
function flyToCity(c, z) { const [mx, my] = cityMpx(c); flyTo(mx, my, z || Math.max(cam.z, 3.6)); }

/* =====================================================================
   Small helpers
   ===================================================================== */
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function setHTML(el, html) { if (el._hold && el._hold > performance.now()) return; if (el._html === html) return; el.innerHTML = html; el._html = html; }
function holdOnInteract(el) {
  el.addEventListener('pointerdown', () => { el._hold = performance.now() + 1200; });
  el.addEventListener('focusin', e => { if (e.target.matches('select,input')) el._hold = Infinity; });
  el.addEventListener('focusout', () => { el._hold = performance.now() + 300; });
}
function leadingEra() { let e = 0; for (const n of S.nations) if (n.alive && n.mult.era > e) e = n.mult.era; return e; }
function sw(n) { return `<span class="swatch" style="background:${n.color}"></span>`; }
const playIcon = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>';
const pauseIcon = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';
function setPlaying(p) { playing = p; const b = $('btnPlay'); b.innerHTML = p ? pauseIcon : playIcon; b.setAttribute('aria-label', p ? '暂停' : '继续'); }

function updateHeader() {
  $('yearLabel').textContent = fmtYear(S.year);
  const pn = playerNation();
  $('roleLabel').textContent = pn ? (pn.alive ? `你是${pn.name}的领袖` : `${pn.name}已经灭亡`) : '你是这颗星球的造物主';
  const e = leadingEra();
  const lead = S.nations.filter(n => n.alive).sort((a, b) => b.mult.count - a.mult.count || b.st.pop - a.st.pop)[0];
  setHTML($('eraLabel'), `<b>${ERA_NAME[e]}时代</b>${lead ? ` · 科技领先：${esc(lead.name)}` : ''}`);
  const tb = $('timeBadge'), f = zoomTimeFactor();
  if (speed === 'auto' && f < 0.95 && playing) {
    const ys = effSpeed();
    tb.hidden = false; tb.textContent = `近景慢放 · 1 秒 ≈ ${ys >= 1 ? ys.toFixed(1) + ' 年' : (ys * 12).toFixed(1) + ' 个月'}`;
  } else tb.hidden = true;
}
let tickerTimer = 0;
function showTicker(type, text) {
  const el = $('ticker');
  el.innerHTML = `<span class="dot" style="background:var(${TYPE_COLOR[type] || '--sodium'})"></span>${esc(fmtYearShort(S.year))} · ${esc(text)}`;
  el.dataset.empty = '0';
  clearTimeout(tickerTimer);
  tickerTimer = setTimeout(() => { el.dataset.empty = '1'; }, 4500);
}
let bannerTimer = 0;
function showBanner(title, sub) {
  if (booting) return;
  const el = $('banner');
  el.innerHTML = `<h3>${esc(title)}</h3><p>${esc(sub)}</p>`;
  el.hidden = false; el.style.opacity = '1';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.style.opacity = '0'; setTimeout(() => { el.hidden = true; }, 800); }, 3200);
}
let hintTimer = 0;
function flashHint(t, ms) {
  const h = $('toolHint'); h.hidden = false; h.textContent = t;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => refreshToolHint(), ms || 1800);
}

/* =====================================================================
   Rail panels
   ===================================================================== */
let activeTab = 'ov';
function updatePanels() {
  if (mmOpen) renderMil();
  if (activeTab === 'me') renderMe();
  if (activeTab === 'game') renderGame();
  if (layer === 5) renderLegend();
  if (activeTab === 'ov') updateOverview();
  if (activeTab === 'nat') renderNations();
  if (activeTab === 'tech') renderTechPane();
  if (activeTab === 'log' && logVersion !== renderedLogVersion) renderLog();
  if (activeTab === 'ach' && achVersion !== renderedAch) renderAch();
  if (tmOpen && techVersion !== renderedTreeVersion) renderTree();
  if ($('gfxSel')._v !== gfxVersion) syncGfxUI();
}
function updateOverview() {
  const alive = S.nations.filter(n => n.alive);
  let fac = 0, labs = 0, rp = 0;
  for (const c of S.cities) { fac += c.fac; labs += c.labs; rp += c.rp; }
  $('kPop').textContent = fmtPop(worldPop());
  $('kNat').textContent = alive.length;
  $('kCity').textContent = S.cities.length;
  $('kWar').textContent = S.wars.length;
  $('kFac').textContent = fmtNum(fac);
  $('kLab').textContent = fmtNum(labs);
  $('kRP').textContent = fmtNum(rp);
  $('kCO2').textContent = S.co2.toFixed(0) + ' ppm';
  $('kT').textContent = (S.tanom >= 0 ? '+' : '') + S.tanom.toFixed(2) + ' °C';
  $('kSea').textContent = '+' + (S.seaRise * 400).toFixed(2) + ' m';
  const hist = chartWindow(S.history);
  $('sPop').textContent = fmtPop(worldPop());
  $('sCO2').textContent = S.co2.toFixed(0);
  $('sT').textContent = (S.tanom >= 0 ? '+' : '') + S.tanom.toFixed(2);
  drawSpark(CHARTS.pop, hist); drawSpark(CHARTS.co2, hist); drawSpark(CHARTS.t, hist);
  drawIdeo();
  const ish = S.ideoWorld || {};
  $('ideoNote').textContent = `${S.realmCount || alive.length} 个独立政权`;
  setHTML($('ideoLegend'), IDEO.filter(I => ish[I.id] > 0.001).sort((a, b) => ish[b.id] - ish[a.id]).map(I => `<div><span class="swatch" style="background:${I.color}"></span>${I.short}<b>${Math.round(ish[I.id] * 100)}%</b></div>`).join(''));
  const mix = [0, 0, 0, 0, 0]; let E = 0;
  for (const n of alive) { E += n.st.E; for (let k = 0; k < 5; k++) mix[k] += n.st.mix[k] * n.st.E; }
  const names = ['煤炭', '石油', '核能', '可再生', '聚变'], vars = ['--mix-coal', '--mix-oil', '--mix-nuke', '--mix-renew', '--mix-fusion'];
  if (E < 0.5) { setHTML($('mix'), '<p class="note">工业革命尚未到来，人类的能源来自柴薪、畜力与水车。</p>'); $('mixNote').textContent = ''; }
  else {
    const tot = mix.reduce((a, b) => a + b, 0) || 1;
    $('mixNote').textContent = `开工率 ${Math.round(tot / E * 100)}%`;
    setHTML($('mix'), `<div class="mixbar" role="img" aria-label="全球能源结构">${mix.map((v, k) => v / tot > 0.002 ? `<span style="width:${(v / tot * 100).toFixed(1)}%;background:var(${vars[k]})" title="${names[k]} ${(v / tot * 100).toFixed(1)}%"></span>` : '').join('')}</div>
      <div class="mixlegend">${mix.map((v, k) => `<div><span class="swatch" style="background:var(${vars[k]})"></span>${names[k]}<b>${(v / tot * 100).toFixed(0)}%</b></div>`).join('')}</div>`);
  }
  let rows = '';
  for (const r of RES) {
    const f = S.resLeft[r] / WORLD.resTotal[r], low = f < 0.25;
    rows += `<span class="name">${RES_NAME[r]}</span><span class="track"><span class="fill${low ? ' low' : ''}" style="width:${(f * 100).toFixed(1)}%"></span></span><span class="pct${low ? ' low' : ''}">${low ? '告急 ' : ''}${(f * 100).toFixed(0)}%</span>`;
  }
  const ff = S.forestFrac;
  rows += `<span class="name">森林</span><span class="track"><span class="fill${ff < 0.5 ? ' low' : ''}" style="width:${(ff * 100).toFixed(1)}%"></span></span><span class="pct${ff < 0.5 ? ' low' : ''}">${(ff * 100).toFixed(0)}%</span>`;
  setHTML($('resBars'), rows);
  if (S.sats > 0) { $('spaceBlock').hidden = false; $('kSat').textContent = fmtNum(S.sats); $('kOrb').textContent = fmtPop(S.orbPop); $('kShip').textContent = S.ships; }
}

/* ---------- sparklines ---------- */
const CHARTS = {
  pop: { el: $('chPop'), col: 1, fmt: v => fmtPop(v), hover: -1 },
  co2: { el: $('chCO2'), col: 2, fmt: v => v.toFixed(0) + ' ppm', hover: -1, floor: 250, span: 40 },
  t: { el: $('chT'), col: 3, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) + ' °C', hover: -1, zero: true },
};
function chartWindow(h) { const st = S.firsts.steam; if (!st) return h; const k = h.findIndex(r => r[0] >= st.y - 150); return k > 0 ? h.slice(k) : h; }
function drawSpark(ch, hist) {
  ch.data = hist;
  const el = ch.el, rect = el.getBoundingClientRect();
  if (rect.width < 10) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
  const c = el.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W2 = rect.width, H2 = rect.height;
  c.clearRect(0, 0, W2, H2);
  const padL = 2, padR = 2, padT = 16, padB = 16;
  c.font = `10px ${CSSV.font}`;
  if (hist.length < 2) { c.fillStyle = CSSV['--ink-3']; c.fillText('数据收集中…', 4, H2 / 2); return; }
  const xs = hist.map(r => r[0]), ys = hist.map(r => r[ch.col]);
  const x0 = xs[0], x1 = xs[xs.length - 1];
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (ch.zero) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0.5); }
  if (ch.floor !== undefined) y0 = Math.min(y0, 280);
  if (ch.col === 1) y0 = 0;
  if (ch.span && y1 - y0 < ch.span) y1 = y0 + ch.span;
  if (y1 - y0 < 1e-9) y1 = y0 + 1;
  const X = x => padL + (x - x0) / (x1 - x0 || 1) * (W2 - padL - padR);
  const Y = y => padT + (1 - (y - y0) / (y1 - y0)) * (H2 - padT - padB);
  c.strokeStyle = CSSV['--line']; c.lineWidth = 1;
  for (const f of [0, 0.5, 1]) { const yy = Math.round(padT + f * (H2 - padT - padB)) + 0.5; c.beginPath(); c.moveTo(padL, yy); c.lineTo(W2 - padR, yy); c.stroke(); }
  if (ch.zero && y0 < 0) { c.strokeStyle = CSSV['--ink-3']; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(padL, Y(0)); c.lineTo(W2 - padR, Y(0)); c.stroke(); c.setLineDash([]); }
  const col = CSSV['--series-1'];
  c.beginPath();
  for (let k = 0; k < xs.length; k++) { const x = X(xs[k]), y = Y(ys[k]); k ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.lineWidth = 2; c.strokeStyle = col; c.lineJoin = 'round'; c.stroke();
  c.lineTo(X(x1), Y(y0)); c.lineTo(X(x0), Y(y0)); c.closePath();
  const grad = c.createLinearGradient(0, padT, 0, H2 - padB);
  grad.addColorStop(0, 'rgba(57,135,229,.28)'); grad.addColorStop(1, 'rgba(57,135,229,0)');
  c.fillStyle = grad; c.fill();
  c.fillStyle = CSSV['--ink-3']; c.textBaseline = 'alphabetic';
  c.textAlign = 'left'; c.fillText(ch.fmt(y1), padL, 11);
  c.fillText(fmtYearShort(x0), padL, H2 - 3);
  c.textAlign = 'right'; c.fillText(fmtYearShort(x1), W2 - padR, H2 - 3); c.textAlign = 'left';
  const ex = X(x1), ey = Y(ys[ys.length - 1]);
  c.fillStyle = col; c.beginPath(); c.arc(ex, ey, 3.5, 0, TAU); c.fill(); c.strokeStyle = CSSV['--panel']; c.lineWidth = 2; c.stroke();
  const tip = el.parentElement.querySelector('.tip');
  if (ch.hover >= 0 && ch.hover < xs.length) {
    const k = ch.hover, hx = X(xs[k]), hy = Y(ys[k]);
    c.strokeStyle = CSSV['--ink-3']; c.lineWidth = 1; c.beginPath(); c.moveTo(hx, padT); c.lineTo(hx, H2 - padB); c.stroke();
    c.fillStyle = col; c.beginPath(); c.arc(hx, hy, 4, 0, TAU); c.fill(); c.strokeStyle = CSSV['--panel']; c.lineWidth = 2; c.stroke();
    tip.hidden = false; tip.textContent = `${fmtYearShort(xs[k])} · ${ch.fmt(ys[k])}`; tip.style.left = clamp(hx, 60, W2 - 60) + 'px';
  } else tip.hidden = true;
}
for (const key in CHARTS) {
  const ch = CHARTS[key], el = ch.el;
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect(), hist = ch.data || S.history; if (hist.length < 2) return;
    const f = clamp((e.clientX - r.left - 2) / (r.width - 4), 0, 1);
    const target = hist[0][0] + f * (hist[hist.length - 1][0] - hist[0][0]);
    let bi = 0, bd = 1e18; for (let k = 0; k < hist.length; k++) { const d = Math.abs(hist[k][0] - target); if (d < bd) { bd = d; bi = k; } }
    ch.hover = bi; drawSpark(ch, hist);
  });
  el.addEventListener('pointerleave', () => { ch.hover = -1; drawSpark(ch, ch.data || S.history); });
}

/* ---------- ideology share chart (100% stacked area) ---------- */
const IDEO_CH = { el: $('chIdeo'), hover: -1, data: [] };
function drawIdeo() {
  const hist = S.history.filter(r => r[6]);
  IDEO_CH.data = hist;
  const el = IDEO_CH.el, rect = el.getBoundingClientRect();
  if (rect.width < 10) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
  const c = el.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W2 = rect.width, H2 = rect.height, padT = 4, padB = 16;
  c.clearRect(0, 0, W2, H2);
  c.font = `10px ${CSSV.font}`;
  if (hist.length < 2) { c.fillStyle = CSSV['--ink-3']; c.fillText('数据收集中…', 4, H2 / 2); return; }
  const x0 = hist[0][0], x1 = hist[hist.length - 1][0];
  const X = x => (x - x0) / (x1 - x0 || 1) * W2, Y = f => padT + (1 - f) * (H2 - padT - padB);
  const base = new Float32Array(hist.length);
  for (let k = 0; k < IDEO.length; k++) {
    if (!hist.some(r => (r[6][k] || 0) > 0.002)) continue;
    c.beginPath();
    for (let j = 0; j < hist.length; j++) { const x = X(hist[j][0]), y = Y(Math.min(1, base[j] + (hist[j][6][k] || 0))); j ? c.lineTo(x, y) : c.moveTo(x, y); }
    for (let j = hist.length - 1; j >= 0; j--) c.lineTo(X(hist[j][0]), Y(base[j]));
    c.closePath(); c.fillStyle = IDEO[k].color; c.fill();
    c.beginPath();
    for (let j = 0; j < hist.length; j++) { base[j] += hist[j][6][k] || 0; const x = X(hist[j][0]), y = Y(Math.min(1, base[j])); j ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.strokeStyle = CSSV['--panel']; c.lineWidth = 1.5; c.stroke();
  }
  c.fillStyle = CSSV['--ink-3']; c.textBaseline = 'alphabetic';
  c.textAlign = 'left'; c.fillText(fmtYearShort(x0), 2, H2 - 3);
  c.textAlign = 'right'; c.fillText(fmtYearShort(x1), W2 - 2, H2 - 3); c.textAlign = 'left';
  const tip = el.parentElement.querySelector('.tip');
  if (IDEO_CH.hover >= 0 && IDEO_CH.hover < hist.length) {
    const r = hist[IDEO_CH.hover], hx = X(r[0]);
    c.strokeStyle = CSSV['--ink']; c.lineWidth = 1; c.beginPath(); c.moveTo(hx, padT); c.lineTo(hx, H2 - padB); c.stroke();
    const top = IDEO.map((I, k) => [I, r[6][k] || 0]).filter(x => x[1] > 0.005).sort((a, b) => b[1] - a[1]).slice(0, 3);
    tip.hidden = false; tip.textContent = `${fmtYearShort(r[0])} · ${top.map(([I, v]) => `${I.short} ${Math.round(v * 100)}%`).join(' · ')}`; tip.style.left = clamp(hx, 90, W2 - 90) + 'px';
  } else tip.hidden = true;
}
IDEO_CH.el.addEventListener('pointermove', e => {
  const hist = IDEO_CH.data; if (!hist || hist.length < 2) return;
  const r = IDEO_CH.el.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1);
  const target = hist[0][0] + f * (hist[hist.length - 1][0] - hist[0][0]);
  let bi = 0, bd = 1e18; for (let k = 0; k < hist.length; k++) { const d = Math.abs(hist[k][0] - target); if (d < bd) { bd = d; bi = k; } }
  IDEO_CH.hover = bi; drawIdeo();
});
IDEO_CH.el.addEventListener('pointerleave', () => { IDEO_CH.hover = -1; drawIdeo(); });

/* ---------- economy & AI helpers ---------- */
function fmtMoney(v) { return v >= 1e4 ? (v / 1e4).toFixed(1).replace(/\.0$/, '') + ' 万亿' : (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('zh-CN')) + ' 亿'; }
function budgetBar(w, legend) {
  const bar = `<div class="supbar" role="img" aria-label="预算分配：${BUD.map((b, k) => `${BUD_NAME[b]} ${pctS(w[k])}`).join('，')}">${BUD.map((b, k) => w[k] > 0.004 ? `<span style="width:${(w[k] * 100).toFixed(1)}%;background:${BUD_COLOR[b]}" title="${BUD_NAME[b]} ${pctS(w[k])}"></span>` : '').join('')}</div>`;
  return legend === false ? bar : bar + `<div class="mixlegend" style="margin-top:4px">${BUD.map((b, k) => w[k] > 0.004 ? `<div><span class="swatch" style="background:${BUD_COLOR[b]}"></span>${BUD_NAME[b]}<b>${pctS(w[k])}</b></div>` : '').join('')}</div>`;
}
function financeKV(n) {
  const e = n.eco; if (!e) return '';
  return `<dl class="kv">
    <dt>GDP</dt><dd>${fmtMoney(e.gdp)}</dd>
    <dt>税率</dt><dd>${pctS(e.tax)}</dd>
    <dt>税收 / 年</dt><dd>${fmtMoney(e.rev)}</dd>
    <dt>出口 / 年</dt><dd>${fmtMoney(e.exp)}</dd>
    <dt>企业投资意愿</dt><dd>${e.will.toFixed(2)}</dd>
    <dt>国库</dt><dd>${fmtMoney(e.treasury)}</dd>
    <dt>铁路 / 研究院</dt><dd>${e.rails} 段 / ${e.inst} 座</dd>
  </dl>`;
}
function aiBlock(n) {
  const a = n.ai; if (!a) return '';
  const tr = (v, lo, hi) => v > 1.15 ? hi : v < 0.85 ? lo : '中庸';
  return `<div class="aihead"><span class="aitag">AI 执政者</span><b>${GOAL_NAME[a.goal] || '观望'}</b><small>${tr(n.ambition * ideoOf(n).aggr, '温和', '好战')} · ${tr(a.persona.caution, '冒进', '谨慎')} · ${tr(a.persona.zeal, '务实', '狂热')}</small></div>
    <ol class="ailog">${a.log.slice(0, 4).map(l => `<li><span class="y">${esc(fmtYearShort(l.y))}</span><span>${esc(l.t)}</span></li>`).join('') || '<li><span class="y"></span><span>正在观察局势</span></li>'}</ol>`;
}

/* ---------- military summaries (nation cards, leader panel, war modal) ---------- */
const DOM_BAR = { land: '#e8553f', sea: '#4a90e2', air: '#bfe8ff' };
function landMain(n) {
  const b = n.mult.best || {}, a = UNIT_BY_ID[b.arm];
  if (a && (a.spr === 'tracked' || a.spr === 'hover' || a.spr === 'mech')) return a;
  return UNIT_BY_ID[b.inf] || a || null;
}
function milStrengthBars(n) {
  const F = milForces(n), tot = F.L + F.S + F.A || 1;
  return `<div class="milbars" role="img" aria-label="陆军 ${fmtNum(F.L / 1000)}，海军 ${fmtNum(F.S / 1000)}，空军 ${fmtNum(F.A / 1000)}">${[['陆军', F.L, 'land'], ['海军', F.S, 'sea'], ['空军', F.A, 'air']].map(([k, v, d]) => `<span>${k.slice(0, 1)}</span><span class="track"><span class="fill" style="width:${(v / tot * 100).toFixed(1)}%;background:${DOM_BAR[d]}"></span></span><b>${fmtNum(v / 1000)}（${Math.round(v / tot * 100)}%）</b>`).join('')}</div>`;
}
function fieldedUnits(n, dom) {
  const out = []; if (effSplit(n)[DOM[dom]] <= 0) return out;
  const mix = ensureMil(n).mix[dom];
  for (const r of ROLES[dom]) { const id = n.mult.best[r]; if (id && !out.includes(id) && (mix[r] || 0) > 0.01) out.push(id); }
  return out;
}
function uchips(ids) { return ids.map(id => `<span class="uchip">${unitImg(id)}${esc(UNIT_BY_ID[id].name)}</span>`).join(''); }
function doctrineChips(n) { return DOMS.map(d => { const id = n.mult.doc[d]; return id ? `<span class="dchip" title="${DOM_NAME[d]}学说">${esc(doctrineName(id, n))}</span>` : `<span class="dchip none">${DOM_NAME[d]}：无学说</span>`; }).join(''); }
// share of air / sea control and blockade suffered, seen from nation n
function warControl(n, w) {
  const s = w.a === n.id ? 0 : 1, f = v => (v === undefined ? 0.5 : v);
  return { air: s ? 1 - f(w.air) : f(w.air), sea: s ? 1 - f(w.sea) : f(w.sea), block: (w.blockade || [0, 0])[s] || 0, land: s ? 1 - f(w.ls) : f(w.ls) };
}
function milResearchRow(n) {
  const r = researchBars(n);
  return `<div class="prog"><span>${r.mt ? '军工 ' + esc(r.mt.name) : '军工：暂无目标'}</span><span class="track"><span class="fill mil" style="width:${(r.mp * 100).toFixed(0)}%"></span></span><span class="mono">${r.mt ? Math.round(r.mp * 100) + '%' : ''}</span></div>`;
}
function milPanel(n) {
  const wars = S.wars.filter(w => w.a === n.id || w.b === n.id);
  const doms = DOMS.map(d => [d, fieldedUnits(n, d)]).filter(a => a[1].length);
  return `<span class="cap">军事</span>${milStrengthBars(n)}
    <div class="milrow"><span class="k">学说</span>${doctrineChips(n)}</div>
    <div class="milrow"><span class="k">现役</span>${doms.map(([d, ids]) => `<span class="ugrp"><i style="background:${DOM_BAR[d]}" title="${DOM_NAME[d]}"></i>${uchips(ids)}</span>`).join('') || '<span class="note" style="margin:0">无</span>'}</div>
    ${milResearchRow(n)}
    ${wars.map(w => { const o = S.nations[w.a === n.id ? w.b : w.a], c = warControl(n, w); return `<div class="milrow"><span class="k">战争</span>对${esc(o.name)} · 制空 ${Math.round(c.air * 100)}% · 制海 ${Math.round(c.sea * 100)}%${c.block > 0.01 ? ` · 被封锁 ${Math.round(c.block * 100)}%` : ''}</div>`; }).join('')}`;
}

/* ---------- nations (with god controls) ---------- */
let expandedNation = -1;
const natTarget = {};
function relTags(n) {
  const out = [];
  for (const e of enemiesOf(n.id)) out.push(`<span class="tag war">交战 · ${esc(S.nations[e].name)}</span>`);
  for (const a of n.allies) out.push(`<span class="tag ally">同盟 · ${esc(S.nations[a].name)}</span>`);
  const ov = n.overlord >= 0 ? S.nations[n.overlord] : null;
  if (ov && ov.alive) out.push(`<span class="tag">附庸 · 宗主 ${esc(ov.name)}</span>`);
  for (const p of puppetsOf(n.id)) out.push(`<span class="tag">宗主 · 附庸 ${esc(p.name)}</span>`);
  return out.join('');
}
function renderNations() {
  const list = S.nations.filter(n => n.alive).sort((a, b) => b.st.pop - a.st.pop);
  const dead = S.nations.filter(n => !n.alive);
  let html = '';
  for (const n of list) {
    const t = n.target ? TECH_BY_ID[n.target] : null;
    const prog = t ? clamp(n.research / techCost(n, n.target), 0, 1) : 1;
    const exp = expandedNation === n.id;
    html += `<div class="nat" data-n="${n.id}" aria-expanded="${exp}">
      <div class="top" role="button" tabindex="0" data-act="toggle">${sw(n)}<span class="nm">${esc(n.name)}</span><span class="pp">${fmtPop(n.st.pop)}</span></div>
      <div class="sub"><span class="ibadge" style="--ic:${ideoOf(n).color}">${ideoOf(n).short}</span>${isPlayer(n) ? '<span style="color:var(--sodium)">你的国家</span>' : ''}<span>${ERA_NAME[n.mult.era]}时代</span><span>稳定 ${Math.round(n.stabV * 100)}%</span>${n.ai && !isPlayer(n) ? `<span>AI：${GOAL_NAME[n.ai.goal] || '观望'}</span>` : ''}<span>${n.st.cities} 城</span><span>科技 ${n.mult.count}/${CIV_TOTAL} · 军工 ${n.mult.mcount}/${MIL_TOTAL}</span><span>${esc((landMain(n) || { name: WEAPON_NAME[n.mult.weapon] }).name)}</span>${n.golden > 0 ? '<span style="color:var(--sodium)">黄金时代</span>' : ''}${n.legions > 1 ? `<span>神兵 ×${n.legions.toFixed(0)}</span>` : ''}</div>
      ${relTags(n) ? `<div class="rels">${relTags(n)}</div>` : ''}
      <div class="prog"><span>${t ? '研究 ' + esc(t.name) : '已掌握全部科技'}</span><span class="track"><span class="fill" style="width:${(prog * 100).toFixed(0)}%"></span></span></div>${exp ? '' : n.mtarget ? milResearchRow(n) : ''}`;
    if (exp) {
      const others = list.filter(o => o !== n);
      if (natTarget[n.id] === undefined || !others.some(o => o.id === natTarget[n.id])) natTarget[n.id] = others.length ? others[0].id : -1;
      const tg = natTarget[n.id], god = S.mode !== 'leader', I = ideoOf(n);
      const sup = Object.entries(n.sup).filter(x => x[1] > 0.004).sort((a, b) => b[1] - a[1]);
      const ov = n.overlord >= 0 ? S.nations[n.overlord] : null;
      html += `<div class="ctl">`;
      if (god) html += `
        <span class="cap">外交（对象）</span>
        <div class="line"><select data-role="target" aria-label="外交对象">${others.map(o => `<option value="${o.id}"${o.id === tg ? ' selected' : ''}>${esc(o.name)}${atWar(n.id, o.id) ? '（交战）' : allied(n.id, o.id) ? '（同盟）' : ''}</option>`).join('')}</select></div>
        <div class="line">
          <button class="btn small danger" data-act="war">宣战</button>
          <button class="btn small" data-act="peace">停战</button>
          <button class="btn small" data-act="ally">结盟</button>
          <button class="btn small" data-act="unally">解盟</button>
          <button class="btn small" data-act="attack">派兵进攻</button>
          <button class="btn small" data-act="annex">吞并对方</button>
          <button class="btn small" data-act="puppet">扶植傀儡</button>
        </div>
        <span class="cap">意识形态</span>
        <div class="line"><select data-role="ideo" aria-label="意识形态">${ideoAvailable(n).map(J => `<option value="${J.id}"${J.id === n.ideo ? ' selected' : ''}>${J.name}</option>`).join('')}</select>
          <button class="btn small" data-act="setideo">改变政体</button>
          <button class="btn small danger" data-act="revolt" title="让所选意识形态的支持者揭竿而起">煽动内战</button></div>
        <span class="cap">神力</span>
        <div class="line">
          <button class="btn small" data-act="bless">赐福</button>
          <button class="btn small" data-act="inspire">灵感</button>
          <button class="btn small" data-act="army">赐军</button>
          <button class="btn small" data-act="plague">瘟疫</button>
          <button class="btn small" data-act="tree">赐予科技</button>
        </div>
        <span class="cap">军备</span>
        <div class="line"><select data-role="milp" aria-label="军费结构预设">${Object.keys(MIL_PRESET_NAME).map(k => `<option value="${k}">${MIL_PRESET_NAME[k]}</option>`).join('')}</select>
          <button class="btn small" data-act="milpreset">调整军备</button>
          <button class="btn small" data-act="miltree">军工科技</button></div>`;
      html += `<span class="cap">民意</span>
        <div class="supbar">${sup.map(([id, v]) => `<span style="width:${(v * 100).toFixed(1)}%;background:${IDEO_BY_ID[id].color}" title="${IDEO_BY_ID[id].name} ${Math.round(v * 100)}%"></span>`).join('')}</div>
        <div class="mixlegend" style="margin-top:0">${sup.slice(0, 4).map(([id, v]) => `<div><span class="swatch" style="background:${IDEO_BY_ID[id].color}"></span>${IDEO_BY_ID[id].short}<b>${Math.round(v * 100)}%</b></div>`).join('')}</div>
        <div class="line"><button class="btn small" data-act="locate">定位首都</button>${isPlayer(n) ? '' : `<button class="btn small primary" data-act="play">${god ? '扮演这个国家' : '改为扮演这个国家'}</button>`}</div>
        <dl class="kv">
          <dt>政体</dt><dd class="txt">${esc(I.name)}</dd>
          <dt>首都</dt><dd class="txt">${esc((cityById(n.capital) || {}).name || '—')}</dd>
          <dt>建国</dt><dd>${fmtYear(n.born)}</dd>
          <dt>军力</dt><dd>${fmtNum(power(n) / 1000)}</dd>
          <dt>工厂 / 研究所</dt><dd>${fmtNum(n.st.fac)} / ${fmtNum(n.st.labs)}</dd>
          <dt>科研 / 年</dt><dd>${fmtNum(n.st.rp)}</dd>
          <dt>稳定度</dt><dd>${Math.round(n.stabV * 100)}%</dd>
          <dt>征服欲</dt><dd class="txt">${n.ambition * I.aggr > 1.4 ? '极强' : n.ambition * I.aggr > 1 ? '强' : n.ambition * I.aggr > 0.7 ? '一般' : '温和'}</dd>
          ${ov && ov.alive ? `<dt>宗主国</dt><dd class="txt">${esc(ov.name)}</dd>` : ''}
        </dl>
        <p class="note">${esc(I.desc)}</p>
        ${milPanel(n)}
        ${isPlayer(n) ? '<span class="cap">执政</span><p class="note" style="margin:0">由你亲自执政。顾问建议：' + esc(n.ai ? n.ai.advice : '') + '</p>' : `<span class="cap">执政</span>${aiBlock(n)}`}
        ${n.eco ? `<span class="cap">财政与预算 · ${esc(doct(n.ideo).school)}</span>${financeKV(n)}${budgetBar(n.eco.alloc)}` : ''}
      </div>`;
    }
    html += '</div>';
  }
  if (dead.length) html += `<p class="note">已湮灭的文明：${esc(dead.map(n => n.name).join('、'))}</p>`;
  setHTML($('natList'), html);
}
$('natList').addEventListener('change', e => {
  const sel = e.target.closest('select[data-role="target"]'); if (!sel) return;
  const box = sel.closest('.nat'); natTarget[+box.dataset.n] = +sel.value;
});
$('natList').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const box = b.closest('.nat'); const n = S.nations[+box.dataset.n];
  const act = b.dataset.act;
  if (act === 'toggle') { expandedNation = expandedNation === n.id ? -1 : n.id; selectedNation = expandedNation; $('natList')._hold = 0; renderNations(); return; }
  const sel = box.querySelector('select[data-role="target"]');
  const o = sel ? S.nations[+sel.value] : null;
  const isel = box.querySelector(act === 'milpreset' ? 'select[data-role="milp"]' : 'select[data-role="ideo"]');
  nationAction(act, n, o, isel ? isel.value : null);
  $('natList')._hold = 0; $('natList')._html = ''; renderNations();
});
$('natList').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act="toggle"]')) { e.preventDefault(); e.target.click(); } });
holdOnInteract($('natList'));
function nationAction(act, n, o, extra) {
  if (!n || !n.alive) return;
  const needO = ['war', 'peace', 'ally', 'unally', 'attack', 'annex', 'puppet'];
  if (needO.includes(act) && (!o || !o.alive)) { flashHint('先在下拉框里选一个外交对象'); return; }
  switch (act) {
    case 'war': if (atWar(n.id, o.id)) flashHint('两国已经在交战'); else startWar(n.id, o.id, true, `${n.name}奉造物主之命，向${o.name}宣战`); break;
    case 'peace': if (!makePeace(n.id, o.id, `${n.name}与${o.name}在造物主的调停下停战`)) flashHint('两国并没有交战'); break;
    case 'ally': if (allied(n.id, o.id)) flashHint('两国已经是同盟'); else formAlliance(n.id, o.id, `${n.name}与${o.name}在造物主见证下结为同盟`); break;
    case 'unally': if (!breakAlliance(n.id, o.id, false)) flashHint('两国并不是同盟'); break;
    case 'attack': { const p = nearestPair(n, o), q = nearestPair(o, n); if (p && q) { orderAttack(p.c, q.c); if (viewMode === 'map') flyToCity(p.c, Math.max(cam.z, 3)); } break; }
    case 'annex': annexNation(n, o, `造物主将${o.name}并入${n.name}`); break;
    case 'puppet': makePuppet(n, o, `造物主令${o.name}臣服于${n.name}，成为其附庸`); break;
    case 'setideo': if (!extra || extra === n.ideo) flashHint('在下拉框里选一个不同的意识形态'); else setIdeology(n, extra, `造物主改写了${n.name}的命运：${IDEO_BY_ID[extra].name}取代了${ideoOf(n).name}`); break;
    case 'revolt': { const id = extra && extra !== n.ideo ? extra : (topRival(n)[0] || (ideoAvailable(n).find(J => J.id !== n.ideo) || {}).id); if (!id) { flashHint('这个国家还没有其他意识形态可以选'); break; } n.sup[id] = Math.max(n.sup[id] || 0, 0.4); startCivilWar(n, id); break; }
    case 'play': $('modeSel').hidden = true; setMode('leader', n.id); break;
    case 'bless': godBless(n); break;
    case 'inspire': if (!godInspire(n)) flashHint('这个国家已经掌握了全部科技'); break;
    case 'army': godArmy(n); break;
    case 'plague': plague(n, true); break;
    case 'tree': openTree(String(n.id)); break;
    case 'miltree': openTree(String(n.id), 'land'); break;
    case 'milpreset': if (extra && milPreset(n, extra)) showTicker('war', `${n.name}的军费结构调整为「${MIL_PRESET_NAME[extra]}」`); break;
    case 'locate': { const c = cityById(n.capital) || largestCity(n); if (c) { selected = { city: c.id }; flyToCity(c); } break; }
  }
}

/* ---------- game theory pane ---------- */
function compassSVG() {
  const W2 = 300, H2 = 230, pad = 24;
  const X = x => pad + (x + 1) / 2 * (W2 - 2 * pad), Y = y => pad + (1 - (y + 1) / 2) * (H2 - 2 * pad);
  const alive = S.nations.filter(n => n.alive && n.cl.length);
  const used = new Set(alive.map(n => n.ideo));
  let g = `<svg class="compass" viewBox="0 0 ${W2} ${H2}" role="img" aria-label="各国在政治光谱上的位置">`;
  g += `<rect x="${pad}" y="${pad}" width="${W2 - 2 * pad}" height="${H2 - 2 * pad}" fill="none" stroke="${CSSV['--line']}"/>`;
  g += `<line x1="${W2 / 2}" y1="${pad}" x2="${W2 / 2}" y2="${H2 - pad}" stroke="${CSSV['--line']}"/><line x1="${pad}" y1="${H2 / 2}" x2="${W2 - pad}" y2="${H2 / 2}" stroke="${CSSV['--line']}"/>`;
  const t = (x, y, s, a) => `<text x="${x}" y="${y}" fill="${CSSV['--ink-3']}" font-size="10" text-anchor="${a || 'middle'}">${s}</text>`;
  g += t(W2 / 2, 14, '威权') + t(W2 / 2, H2 - 8, '自由') + t(6, H2 / 2 + 3, '左', 'start') + t(W2 - 6, H2 / 2 + 3, '右', 'end');
  for (const I of IDEO) if (used.has(I.id)) g += `<text x="${X(I.x)}" y="${Y(I.y) - 9}" fill="${I.color}" font-size="10" text-anchor="middle" opacity=".9">${I.short}</text>`;
  for (const n of alive.sort((a, b) => b.st.pop - a.st.pop)) {
    const I = ideoOf(n); let sx = 0, sy = 0; for (const k in n.sup) { const J = IDEO_BY_ID[k]; sx += n.sup[k] * J.x; sy += n.sup[k] * J.y; }
    const x = X(I.x * 0.55 + sx * 0.45) + ((n.id * 37) % 11 - 5) * 0.9, y = Y(I.y * 0.55 + sy * 0.45) + ((n.id * 53) % 9 - 4) * 0.9;
    const r = clamp(2.5 + Math.sqrt(n.st.pop / 2e6), 3, 12);
    g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${n.color}" stroke="${CSSV['--panel']}" stroke-width="2"><title>${esc(n.name)} · ${I.name} · 稳定 ${Math.round(n.stabV * 100)}%</title></circle>`;
    if (isPlayer(n)) g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 4).toFixed(1)}" fill="none" stroke="${CSSV['--sodium']}" stroke-width="1.5"/>`;
  }
  return g + '</svg><p class="note" style="text-align:center;margin-top:2px">圆点是国家，大小代表人口。位置介于政府与民意之间：偏离越远，政局越不稳。</p>';
}
function gameMatrix(r) {
  const G = GAMES[r.type];
  const isEq = (i, j) => r.pure.some(e => e[0] === i && e[1] === j), sel = (i, j) => r.pick && r.pick[0] === i && r.pick[1] === j;
  let h = `<table class="mtx sm"><thead><tr><th></th>${G.t.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>`;
  for (let i = 0; i < 2; i++) { h += `<tr><th>${esc(G.s[i])}</th>`; for (let j = 0; j < 2; j++) h += `<td class="${isEq(i, j) ? 'eq' : ''} ${sel(i, j) ? 'sel' : ''}">${r.A[i][j]} , ${r.B[i][j]}</td>`; h += '</tr>'; }
  return h + '</tbody></table>';
}
function doctrineRows() {
  const used = new Set(S.nations.filter(n => n.alive && n.cl.length).map(n => n.ideo));
  return IDEO.filter(I => used.has(I.id)).map(I => { const d = doct(I.id); return `<div class="gcard"><div class="gh"><span class="ibadge" style="--ic:${I.color}">${I.short}</span><b>「${esc(d.school)}」</b><span class="gk">第 ${d.ver + 1} 版 · 税率 ${pctS(d.tax)} · 市场 ${d.market.toFixed(2)} · 活力 ${d.vigor.toFixed(2)}</span></div>${budgetBar(d.w, false)}${d.hist.length ? `<div class="gw" style="margin-top:4px">${esc(fmtYearShort(d.hist[0].y))}：${esc(d.hist[0].note)}</div>` : ''}</div>`; }).join('');
}
function renderGame() {
  const games = S.games || [], st = S.stats, pn = playerNation();
  let trustHTML = '';
  if (pn && pn.alive) {
    const rows = S.nations.filter(o => o.alive && o !== pn && o.cl.length).map(o => [o, getTrust(pn.id, o.id)]).sort((a, b) => b[1] - a[1]);
    trustHTML = `<h3>你与各国的互信</h3><div class="trust">${rows.map(([o, v]) => `<span>${sw(o)} ${esc(o.name)}</span><span class="track"><span class="fill" style="width:${(v * 100).toFixed(0)}%"></span></span><span class="mono">${Math.round(v * 100)}%</span>`).join('')}</div>`;
  }
  setHTML($('pane-game'), `
    <h3>国际博弈</h3>
    <p class="note" style="margin:0 0 10px">国与国的每一次互动都是一局 2×2 博弈。双方算出收益矩阵，寻找纳什均衡；有多个均衡时，互信高的一方选「收益占优」，互信低的选「风险占优」。越有耐心（越看重未来），越可能跳出囚徒困境。</p>
    <div class="gstat"><div>合作<b>${st.coop || 0}</b></div><div>军备竞赛<b>${st.armsRaces || 0}</b></div><div>和平合并<b>${st.unions || 0}</b></div><div>恐怖平衡<b>${st.mad || 0}</b></div><div>思想输出<b>${st.ideoExports || 0}</b></div><div>内战<b>${st.civilWars || 0}</b></div></div>
    <h3>政治光谱 <small>${S.realmCount || ''} 个独立政权</small></h3>
    ${compassSVG()}
    ${trustHTML}
    <h3>各国 AI 的最新决策</h3>
    <ol class="ailog feed">${(S.aiFeed || []).slice(0, 12).map(f => { const o = S.nations[f.n]; return o ? `<li><span class="y">${esc(fmtYearShort(f.y))}</span><span>${sw(o)} <b>${esc(o.name)}</b>：${esc(f.t)}</span></li>` : ''; }).join('') || '<li><span class="y"></span><span>各国 AI 还在观察局势</span></li>'}</ol>
    <h3>意识形态的自我迭代</h3>
    <p class="note" style="margin:0 0 8px">每 20 年，各意识形态按其国家的人均产出增长、国力变化和稳定度接受检验。落后者会向表现最好的意识形态取经并发生变异，演化出新的流派；成功者影响力上升。</p>
    ${doctrineRows()}
    <h3>最近的博弈 <small>${games.length} 局</small></h3>
    ${games.slice(0, 14).map(r => `<div class="gcard"><div class="gh"><span class="swatch" style="background:${r.ac}"></span>${esc(r.an)}<span style="color:var(--ink-3)">×</span><span class="swatch" style="background:${r.bc}"></span>${esc(r.bn)}<span class="gk">${GAMES[r.type].name} · ${esc(fmtYearShort(r.y))}</span></div>${gameMatrix(r)}<div class="go">${esc(r.out || '')}</div><div class="gw">${esc(r.how || '')} · 互信 ${Math.round(r.trust * 100)}%</div></div>`).join('') || '<p class="note">各国还没有博弈过。进入青铜时代后，外交会越来越频繁。</p>'}
    <p class="note">表格行是先手国的策略，列是对手的策略，格子里是「先手收益 , 对手收益」。蓝框是纳什均衡，金框是实际结果。</p>
    <h3>博弈类型</h3>
    ${Object.values(GAMES).map(G => `<p class="note"><b style="color:var(--ink);font-weight:500">${G.name} · ${G.kind}</b><br>${esc(G.note)}</p>`).join('')}`);
}
holdOnInteract($('pane-game'));

/* ---------- tech pane ---------- */
const CIV_TOTAL = TECHS.filter(t => !t.mil).length, MIL_TOTAL = TECHS.length - CIV_TOTAL;
function researchBars(n) {
  const t = n.target ? TECH_BY_ID[n.target] : null, p = t ? clamp(n.research / techCost(n, n.target), 0, 1) : 1;
  const mt = n.mtarget ? TECH_BY_ID[n.mtarget] : null, mp = mt ? clamp(n.mresearch / techCost(n, n.mtarget), 0, 1) : 0;
  return { t, p, mt, mp };
}
function renderTechPane() {
  const alive = S.nations.filter(n => n.alive).sort((a, b) => b.mult.count - a.mult.count);
  let civ = 0, mil = 0; for (const id in S.firsts) { const t = TECH_BY_ID[id]; if (t) { if (t.mil) mil++; else civ++; } }
  const recent = Object.entries(S.firsts).filter(([id]) => id !== 'agri' && TECH_BY_ID[id]).sort((a, b) => b[1].y - a[1].y).slice(0, 8);
  setHTML($('techPane'), `
    <h3>人类的知识</h3>
    <p class="note" style="margin:0 0 10px">已发现 ${civ + mil} / ${TECHS.length} 项科技（文明 ${civ}/${CIV_TOTAL} · 军事 ${mil}/${MIL_TOTAL}），分为 ${TECH_CATS.length} 个类别。军事科技由军费推动，走单独的军工研究轨道。</p>
    <button class="btn primary" data-act="open">打开完整科技树</button>
    <h3>各国正在研究 <small>科研 · 军工</small></h3>
    <div class="rlist">${alive.map(n => { const r = researchBars(n); return `<div class="rrow r2">${sw(n)}<span>${esc(n.name)}</span><span class="mono">${n.mult.count} · ${n.mult.mcount}</span>
      <span class="rl">${r.t ? esc(r.t.name) : '文明科技全部完成'}</span><span class="track"><span class="fill" style="width:${(r.p * 100).toFixed(0)}%"></span></span>
      <span class="rl mil">${r.mt ? esc(r.mt.name) : '军工：暂无目标'}</span><span class="track"><span class="fill mil" style="width:${(r.mp * 100).toFixed(0)}%"></span></span></div>`; }).join('')}</div>
    <h3>最近的重大发现</h3>
    <ol class="log">${recent.map(([id, f]) => `<li><span class="y">${esc(fmtYearShort(f.y))}</span><span class="dot" style="background:${BRANCH[TECH_BY_ID[id].br].color}"></span><span class="t">${esc(f.name)} · ${esc(TECH_BY_ID[id].name)}</span></li>`).join('') || '<li><span></span><span></span><span class="t" style="color:var(--ink-3)">还没有</span></li>'}</ol>`);
}
$('techPane').addEventListener('click', e => { if (e.target.closest('[data-act="open"]')) openTree(); });

/* ---------- unit glyphs (procedural, cached as data URLs) ---------- */
const DOM_COLOR = { land: '#d8b48a', sea: '#9cc6ee', air: '#d6ecff' };
const UGLYPH = new Map();
function unitGlyph(id, big) {
  const key = id + (big ? '@b' : ''); let url = UGLYPH.get(key);
  if (url) return url;
  const u = UNIT_BY_ID[id]; if (!u) return '';
  const W = big ? 144 : 48, H = big ? 96 : 32, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.scale(W / 24, H / 16); g.lineCap = 'round'; g.lineJoin = 'round';
  drawGlyph(g, u);
  url = c.toDataURL(); UGLYPH.set(key, url);
  return url;
}
function drawGlyph(g, u) {
  const v = u.vis || {}, col = v.body || DOM_COLOR[u.dom], dark = 'rgba(0,0,0,.45)';
  const L = (pts, w, s) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]); g.lineWidth = w; g.strokeStyle = s || col; g.stroke(); };
  const P = (pts, f) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]); g.closePath(); g.fillStyle = f || col; g.fill(); };
  const E = (x, y, rx, ry, f) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = f || col; g.fill(); };
  const R = (x, y, w, h, f) => { g.fillStyle = f || col; g.fillRect(x, y, w, h); };
  const water = () => L([1, 13.6, 23, 13.6], 0.7, 'rgba(110,170,230,.75)');
  switch (u.spr) {
    case 'foot': {
      const pole = v.wpn === 'spear' || v.wpn === 'pike';
      for (const dx of [-5, 0, 5]) {
        const x = 12 + dx;
        E(x, 4.2, 1.3, 1.3); R(x - 1.1, 5.6, 2.2, 4.6); L([x - 0.6, 10, x - 1.2, 14], 0.9); L([x + 0.6, 10, x + 1.2, 14], 0.9);
        if (pole) L([x + 1.8, 2, x + 1.8, 13], 0.5, '#cbb'); else L([x - 1, 7, x + 3.4, 5.6], 0.7, '#9aa');
        if (v.shield) E(x - 1.4, 8, 1.2, 1.8, '#a76');
      }
      break;
    }
    case 'horse': {
      E(11, 9.5, 5.5, 2.3); L([7, 10.5, 6.4, 14.5], 0.9); L([9, 11, 9.2, 14.5], 0.9); L([13.5, 11, 13.8, 14.5], 0.9); L([15.6, 10.5, 16.4, 14.5], 0.9);
      L([15.5, 8.6, 18.5, 5.4], 1.6); E(19.2, 5.2, 1.6, 0.9);
      if (v.chariot || u.id === 'chariot') { g.beginPath(); g.arc(6, 12, 2.4, 0, Math.PI * 2); g.lineWidth = 0.6; g.strokeStyle = '#cbb'; g.stroke(); }
      else { E(11, 5.4, 1.1, 1.1); R(10.2, 6.2, 1.6, 2.6); L([12, 6.5, 18, 2.4], 0.5, '#cbb'); }
      break;
    }
    case 'tracked': case 'hover': {
      const len = clamp((v.len || 6) * 2.6, 12, 20), x0 = 12 - len / 2;
      if (u.spr === 'hover') { E(12, 14, len / 2, 1, 'rgba(120,220,255,.6)'); P([x0, 11.5, x0 + len, 11.5, x0 + len - 2, 8.5, x0 + 2, 8.5]); }
      else if (v.hull === 'truck') { R(x0, 8, len, 3.5); R(x0 + len - 4, 5.5, 4, 3, col); for (const k of [0.2, 0.5, 0.85]) E(x0 + len * k, 12.6, 1.4, 1.4, '#333'); }
      else { P([x0, 9, x0 + len, 9, x0 + len - 1.5, 12, x0 + 1.5, 12]); g.beginPath(); g.roundRect ? g.roundRect(x0 + 0.5, 11.3, len - 1, 2.8, 1.4) : g.rect(x0 + 0.5, 11.3, len - 1, 2.8); g.fillStyle = '#2a2a2a'; g.fill(); }
      if (v.launcher) { g.save(); g.translate(x0 + 3, 8); g.rotate(-0.45); R(0, -2.2, 8, 2.2, '#bbb'); g.restore(); }
      else if (v.turret === 'open') { R(11, 6.4, 6, 2.6); L([16, 7.4, 22, 4], 1, col); }
      else { E(12.5, 7.6, v.turret === 'small' ? 2.6 : 3.4, 1.8); L([14.5, 7.4, 14.5 + clamp((v.gun || 4) * 1.6, 3, 10), 7], v.turret === 'rails' ? 1.2 : 0.9, v.beam || col); }
      break;
    }
    case 'gun': {
      g.beginPath(); g.arc(9, 12, 2.4, 0, Math.PI * 2); g.lineWidth = 0.9; g.strokeStyle = '#a98'; g.stroke();
      L([5, 13, 12, 11], 1.4); L([8, 11, 20, 5], v.len > 3 ? 1.5 : 1.1);
      break;
    }
    case 'mech': {
      R(9, 3.5, 6, 5); E(12, 2.6, 1.6, 1.2); L([10, 8.5, 8.4, 14.5], 1.4); L([14, 8.5, 15.6, 14.5], 1.4); L([15, 5, 20, 4], 1.1, '#9cf');
      break;
    }
    case 'heli': {
      E(11, 9, 5, 2.4); L([15, 8.6, 22, 7.6], 1); L([3, 5.6, 19, 5.6], 0.6, '#ccc'); L([11, 5.6, 11, 7], 0.6, '#ccc'); L([8, 12, 14, 12], 0.5, '#999');
      break;
    }
    case 'plane': {
      const jet = v.jet || v.swept;
      if (v.flyingWing) { P([3, 10, 12, 4, 21, 10, 12, 8.5]); break; }
      if (v.wedge) { P([2, 8, 22, 6, 22, 10]); E(2.2, 8, 1.4, 0.8, '#6af'); break; }
      L([3, 8, 21, 8], 2);
      if (jet) P([10, 8, 15, 8, 7, 14]); else P([9, 8, 12.5, 8, 11.5, 14, 9.5, 14]);
      P([3, 8, 4.8, 8, 2.6, 4.5]);
      if (!jet) L([21.6, 6, 21.6, 10], 0.5, '#ddd');
      if (v.engines >= 2 || v.size >= 2) { P([11, 8, 14, 8, 9, 2.5, 8, 2.5]); }
      break;
    }
    case 'drone': {
      if (v.swarm) { for (let k = 0; k < 9; k++) E(5 + (k * 7) % 15, 4 + ((k * 5) % 9), 0.8, 0.5); break; }
      L([4, 8, 18, 8], 1.2); P([9, 8, 13, 8, 10, 3, 9, 3]); P([9, 8, 13, 8, 10, 13, 9, 13]); P([4, 8, 5.5, 8, 3.5, 5]);
      break;
    }
    case 'airship': { E(12, 7, 9, 3.2); R(10, 10, 4, 1.6, '#887'); P([3, 7, 1.2, 4.5, 1.2, 9.5]); break; }
    case 'missile': {
      if (v.kind === 'beam') { R(10, 1, 4, 3, '#bcd'); L([12, 4, 12, 15], 1.6, '#fff'); break; }
      L([4, 12, 19, 4], 1.6, '#ddd'); P([19, 4, 21.5, 2.6, 20.2, 5.2], '#f84'); L([4, 12, 2, 13.2], 1.4, v.trail || '#f84');
      break;
    }
    case 'oared': {
      P([2, 9, 22, 9, 19, 12, 5, 12]); for (let x = 6; x <= 18; x += 3) L([x, 11, x - 1.5, 14.5], 0.5, '#cba'); L([12, 9, 12, 3], 0.6, '#cba'); P([9, 3.5, 15, 3.5, 14, 8, 10, 8], '#e8dcc0');
      break;
    }
    case 'sail': {
      P([2, 9.5, 22, 9.5, 19.5, 13, 4.5, 13]); const m = v.masts || 3;
      for (let k = 0; k < m; k++) { const x = 6 + k * (12 / Math.max(1, m - 1 || 1)); L([x, 9.5, x, 1.5], 0.5, '#cba'); P([x - 2.3, 2.5, x + 2.3, 2.5, x + 2.6, 8.5, x - 2.6, 8.5], '#ece2c8'); }
      water(); break;
    }
    case 'steam': case 'carrier': {
      if (u.spr === 'carrier') { P([1.5, 9, 22.5, 9, 21, 12.5, 3.5, 12.5]); R(1, 8, 22, 1.2, '#888'); R(15, 5, 3, 3); L([16.5, 5, 16.5, 3], 0.4, '#ccc'); water(); break; }
      P([1.5, 9.5, 22.5, 9.5, 20.5, 12.8, 3.5, 12.8]); R(9, 6.8, 6, 2.7); R(10.6, 4.2, 2.6, 2.8);
      const f = v.funnels || 1; for (let k = 0; k < f; k++) R(13.6 + k * 1.8, 3.6, 1.2, 3.2, '#777');
      const t = v.turrets || (v.gun ? 2 : 1); for (let k = 0; k < Math.min(4, t); k++) { const x = k % 2 ? 18 : 5.4; E(x - (k > 1 ? 2.2 : 0) * (k % 2 ? 1 : -1), 8.8, 1.4, 0.9); L([x, 8.6, x + (k % 2 ? 2.8 : -2.8), 8.2], 0.5); }
      water(); break;
    }
    case 'sub': { E(12, 11.5, 9.5, 1.9); R(10, 8, 3, 2.6); L([11.5, 8, 11.5, 6], 0.4, '#bbb'); water(); break; }
    default: E(12, 8, 6, 4);
  }
}
function unitImg(id, cls) { const u = UNIT_BY_ID[id]; return u ? `<img class="${cls || 'ug'}" src="${unitGlyph(id, cls === 'ugb')}" alt="" title="${esc(u.name)}">` : ''; }

/* ---------- full tech tree: one page per category ---------- */
let tmWho = 'world', tmSel = null, tmOpen = false, renderedTreeVersion = -1, tmGrant = null, tmCat = 'life', tmQuery = '';
try { const c = localStorage.getItem('blue-planet-tmcat'); if (c && TECH_CATS.some(x => x.id === c)) tmCat = c; } catch (e) {}
const TM = { colW: 186, rowH: 56, top: 40, laneW: 132, nodeW: 164 };
const CAT_TECHS = {}; for (const c of TECH_CATS) CAT_TECHS[c.id] = TECHS.filter(t => t.cat === c.id);
const CAT_BY_ID = Object.fromEntries(TECH_CATS.map(c => [c.id, c]));
const BRANCH_ROLE = { inf: 'inf', art: 'art', arm: 'arm', ncap: 'cap', nscr: 'scr', ncv: 'cv', nsub: 'sub', afi: 'fi', aatk: 'cas', abo: 'bomb', auav: 'uav' };
const EXCL_N = ['', '', '二选一', '三选一', '四选一', '五选一'];
let tmSwap = false;
function setTmCat(id, keepScroll) {
  if (!CAT_BY_ID[id]) return;
  if (id !== tmCat) tmSwap = true;
  if (id !== tmCat && !keepScroll) { const tr = $('tmTree'); tr.scrollLeft = 0; tr.scrollTop = 0; }
  tmCat = id; try { localStorage.setItem('blue-planet-tmcat', id); } catch (e) {}
}
function openTree(who, cat) {
  if (who !== undefined) tmWho = who;
  if (cat) setTmCat(cat);
  $('techModal').hidden = false; tmOpen = true; renderedTreeVersion = -1; tmSwap = true; $('tmTree').scrollLeft = 0; renderTree();
  setTimeout(() => $('tmClose').focus(), 0);
}
function closeTree() { $('techModal').hidden = true; tmOpen = false; }
function ancestors(id, out = new Set()) { for (const r of TECH_BY_ID[id].req) if (!out.has(r)) { out.add(r); ancestors(r, out); } return out; }
function techState(t, who) {
  if (who.techs[t.id] !== undefined) return 'known';
  if (t.mil ? who.mtarget === t.id : who.target === t.id) return 'cur';
  if (t.excl && exclBlocked(who, t)) return 'locked';
  if (!t.req.every(r => who.techs[r] !== undefined)) return 'none';
  if (t.mil && t.era > who.mult.era) return 'era';
  return 'avail';
}
function techProg(t, who) { return clamp((t.mil ? who.mresearch : who.research) / techCost(who, t.id), 0, 1); }
function treeLayout(cat) {
  const ts = CAT_TECHS[cat.id], eras = [...new Set(ts.map(t => t.era))].sort((a, b) => a - b);
  const narrow = window.innerWidth < 640, laneW = narrow ? 92 : TM.laneW;
  // exclusive groups (doctrines) sit side by side, everything else stacks by reference year inside its era cell
  const cellOf = (b, e) => ts.filter(t => t.br === b && t.era === e).sort((p, q) => p.ry - q.ry || p.idx - q.idx);
  const isRow = cell => cell.length > 1 && cell.every(t => t.excl);
  const span = eras.map(e => Math.max(1, ...cat.branches.map(b => { const c = cellOf(b, e); return isRow(c) ? c.length : 1; })));
  const colX = []; let cx = laneW + 14; span.forEach((n, ci) => { colX[ci] = cx; cx += n * TM.colW; });
  const pos = {}, lanes = []; let y = TM.top;
  for (const b of cat.branches) {
    let depth = 1;
    const cells = eras.map(e => cellOf(b, e));
    cells.forEach((cell, ci) => {
      const row = isRow(cell);
      if (!row) depth = Math.max(depth, cell.length);
      cell.forEach((t, k) => { pos[t.id] = row ? { x: colX[ci] + k * TM.colW, y: y + 10 } : { x: colX[ci], y: y + 6 + k * TM.rowH }; });
    });
    lanes.push({ b, y, h: depth * TM.rowH + 8, cells });
    y += depth * TM.rowH + 8;
  }
  return { ts, eras, pos, lanes, laneW, colX, span, W: cx + 10, H: y + 12 };
}
function laneNow(b, who) {
  if (!who) return '';
  const r = BRANCH_ROLE[b];
  if (r) { const u = UNIT_BY_ID[who.mult.best[r]]; return u ? `当前：${u.name}` : '尚未装备'; }
  const ex = TECHS.find(t => t.br === b && t.excl && who.techs[t.id] !== undefined);
  if (ex) return `已选：${TECH_BY_ID[ex.id].name}`;
  let last = null; for (const t of TECHS) if (t.br === b && who.techs[t.id] !== undefined && (!last || t.ry > last.ry)) last = t;
  return last ? `最新：${last.name}` : '尚未起步';
}
function renderTabs(who) {
  const alive = S.nations.filter(n => n.alive);
  let html = '', grp = '', k = 0;
  for (const c of TECH_CATS) {
    if (c.group !== grp) { if (grp) html += '<span class="tm-sep" aria-hidden="true"></span>'; grp = c.group; html += `<span class="tm-grp">${grp}</span>`; }
    const ts = CAT_TECHS[c.id];
    const have = who ? ts.filter(t => who.techs[t.id] !== undefined).length : ts.filter(t => S.firsts[t.id]).length;
    const dot = who ? ts.some(t => t.id === who.target || t.id === who.mtarget) : false;
    const hit = tmQuery && ts.some(t => t.name.includes(tmQuery));
    const key = (k + 1) % 10; k++;
    html += `<button role="tab" class="tm-tab${hit ? ' hit' : ''}" data-cat="${c.id}" aria-selected="${c.id === tmCat}" title="${esc(c.name)}（快捷键 ${key}）"><span class="kk">${key}</span>${esc(c.name)}<small>${have}/${ts.length}</small>${dot ? '<i class="dot" title="正在研究"></i>' : ''}</button>`;
  }
  void alive;
  setHTML($('tmTabs'), html);
}
function renderTree() {
  renderedTreeVersion = techVersion;
  const alive = S.nations.filter(n => n.alive);
  if (tmWho !== 'world' && !alive.some(n => String(n.id) === tmWho)) tmWho = 'world';
  const sel = $('tmWho');
  const sig = alive.map(n => n.id).join(',');
  if (sel.dataset.sig !== sig) { sel.innerHTML = `<option value="world">全世界（首次发现）</option>` + alive.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join(''); sel.dataset.sig = sig; }
  sel.value = tmWho;
  const who = tmWho === 'world' ? null : S.nations[+tmWho];
  if (tmSel && TECH_BY_ID[tmSel].cat !== tmCat) tmSel = null;
  renderTabs(who);
  const cat = CAT_BY_ID[tmCat], Ly = treeLayout(cat), pos = Ly.pos;
  $('tmLegend').textContent = cat.desc;
  const rel = tmSel ? new Set([tmSel, ...ancestors(tmSel), ...(UNLOCKS[tmSel] || [])]) : null;
  const NW = TM.nodeW;
  let svg = `<svg width="${Ly.W}" height="${Ly.H}" viewBox="0 0 ${Ly.W} ${Ly.H}" aria-hidden="true">`;
  for (const t of Ly.ts) for (const r of t.req) {
    const a = pos[r], b = pos[t.id]; if (!a) continue;
    const x1 = a.x + NW, y1 = a.y + 23, x2 = b.x, y2 = b.y + 23, mx = (x1 + x2) / 2;
    const known = who ? who.techs[t.id] !== undefined && who.techs[r] !== undefined : !!S.firsts[t.id];
    const hi = rel && rel.has(t.id) && rel.has(r);
    svg += `<path d="M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" fill="none" stroke="${hi ? '#ffb547' : known ? '#3d6a90' : '#26385a'}" stroke-width="${hi ? 2 : 1.2}" opacity="${rel && !hi ? 0.25 : 1}"/>`;
  }
  svg += '</svg>';
  let html = '';
  Ly.eras.forEach((e, ci) => { if (ci % 2) html += `<div class="tm-col" style="left:${Ly.colX[ci] - 10}px;width:${Ly.span[ci] * TM.colW}px;height:${Ly.H}px"></div>`; });
  for (const L of Ly.lanes) html += `<div class="tm-lrow" style="top:${L.y}px;width:${Ly.W}px;height:${L.h}px"></div>`;
  html += svg;
  // exclusive doctrine groups: dashed bracket around each stacked cell
  for (const L of Ly.lanes) L.cells.forEach(cell => {
    const ex = cell.filter(t => t.excl); if (ex.length < 2) return;
    const p0 = pos[ex[0].id], p1 = pos[ex[ex.length - 1].id];
    html += `<div class="tm-excl" style="left:${p0.x - 8}px;top:${p0.y - 6}px;width:${p1.x - p0.x + NW + 16}px;height:${p1.y - p0.y + 58}px"><span>${EXCL_N[ex.length] || '多选一'}</span></div>`;
  });
  for (const t of Ly.ts) {
    const p = pos[t.id];
    let cls = 'tn', sub = '', bar = 0, name = t.name;
    const unit = t.units.length ? UNIT_BY_ID[t.units[0]] : null;
    if (who) {
      const st = techState(t, who);
      if (st === 'known') { cls += ' known'; sub = fmtYear(who.techs[t.id]); if (t.excl) { cls += ' chosen'; name = doctrineName(t.id, who); } }
      else if (st === 'cur') { cls += ' cur'; bar = techProg(t, who); sub = `${t.mil ? '军工' : '研究'}中 ${Math.round(bar * 100)}%`; }
      else if (st === 'locked') { cls += ' locked'; sub = '已选择其他学说'; }
      else if (st === 'avail') { cls += ' avail'; sub = '可以研究'; }
      else if (st === 'era') sub = `需要${ERA_NAME[t.era]}时代`;
      else sub = '尚未解锁';
      if (unit && st !== 'known' && st !== 'locked') sub = `解锁：${unit.name}` + (st === 'cur' ? ` · ${Math.round(bar * 100)}%` : '');
    } else {
      const f = S.firsts[t.id], k = alive.filter(n => n.techs[t.id] !== undefined).length;
      if (f) { cls += ' known'; sub = `${fmtYearShort(f.y)} · ${f.name}`; bar = alive.length ? k / alive.length : 0; } else sub = unit ? `解锁：${unit.name}` : t.fxt;
      if (t.excl && k) sub = `${k} 国采用`;
    }
    if (t.excl) cls += ' excl';
    if (t.mil) cls += ' mil';
    if (tmSel === t.id) cls += ' sel';
    if (rel && !rel.has(t.id)) cls += ' dim';
    if (tmQuery && t.name.includes(tmQuery)) cls += ' hit';
    const xr = t.req.filter(r => TECH_BY_ID[r].cat !== tmCat);
    html += `<button class="${cls}" data-t="${t.id}" style="left:${p.x}px;top:${p.y}px;--bc:${BRANCH[t.br].color}" title="${esc(name)}：${esc(t.fxt)}"><div class="n1">${esc(name)}</div><div class="n2">${esc(sub)}</div>${unit ? unitImg(unit.id) : ''}${xr.length ? `<span class="xb" title="其他页的前置：${esc(xr.map(r => TECH_BY_ID[r].name).join('、'))}">+${xr.length}</span>` : ''}${bar > 0 ? `<span class="pb" style="width:${(bar * (NW - 4)).toFixed(0)}px"></span>` : ''}</button>`;
  }
  // sticky lane titles and era header (moved with the scroll position)
  let lanes = `<div class="tm-lanes" id="tmLanes" style="width:${Ly.laneW}px;height:${Ly.H}px">`;
  for (const L of Ly.lanes) lanes += `<div class="tm-lane" style="top:${L.y}px;height:${L.h}px;--bc:${BRANCH[L.b].color}"><b>${esc(BRANCH[L.b].name)}</b><small>${esc(laneNow(L.b, who))}</small></div>`;
  lanes += '</div>';
  let eraRow = `<div class="tm-eras" id="tmEras" style="width:${Ly.W}px">`;
  Ly.eras.forEach((e, ci) => { eraRow += `<span style="left:${Ly.colX[ci]}px">${ERA_NAME[e]}时代</span>`; });
  eraRow += '</div>';
  const cv = $('tmCanvas');
  cv.style.width = Ly.W + 'px'; cv.style.height = Ly.H + 'px';
  cv.innerHTML = html + eraRow + lanes;
  if (tmSwap) {
    tmSwap = false; cv.classList.remove('swap'); void cv.offsetWidth; cv.classList.add('swap');
    // open the page at its research frontier: the current target, else the newest known era
    const tr = $('tmTree');
    if (!tmSel && tr.scrollLeft === 0) {
      const ts = Ly.ts; let e = -1;
      const cur = who && ts.find(t => t.id === who.target || t.id === who.mtarget);
      if (cur) e = cur.era; else for (const t of ts) if (who ? who.techs[t.id] !== undefined : S.firsts[t.id]) e = Math.max(e, t.era);
      const ci = Ly.eras.indexOf(e);
      if (ci > 0) tr.scrollLeft = Math.max(0, Ly.colX[ci] - Ly.laneW - TM.colW * 0.6);
    }
  }
  syncTreeScroll();
  renderTreeDetail();
}
function syncTreeScroll() {
  const tr = $('tmTree'), l = $('tmLanes'), e = $('tmEras');
  if (l) l.style.transform = `translateX(${tr.scrollLeft}px)`;
  if (e) e.style.transform = `translateY(${tr.scrollTop}px)`;
}
$('tmTree').addEventListener('scroll', syncTreeScroll, { passive: true });
function revealNode(id) {
  const b = $('tmCanvas').querySelector(`[data-t="${id}"]`); if (!b) return;
  const tr = $('tmTree'), x = b.offsetLeft, y = b.offsetTop, lw = ($('tmLanes') || {}).offsetWidth || 0;
  if (x < tr.scrollLeft + lw || x + 170 > tr.scrollLeft + tr.clientWidth) tr.scrollLeft = Math.max(0, x - lw - 40);
  if (y < tr.scrollTop + 40 || y + 60 > tr.scrollTop + tr.clientHeight) tr.scrollTop = Math.max(0, y - 80);
}
function jumpTech(id) { const t = TECH_BY_ID[id]; if (!t) return; setTmCat(t.cat); tmSel = id; renderTree(); revealNode(id); }
function statBar(label, v, mx, sqrt) {
  const f = mx > 0 ? (sqrt ? Math.sqrt(v / mx) : v / mx) : 0;
  return `<span>${label}</span><span class="track"><span class="fill" style="width:${(clamp(f, 0, 1) * 100).toFixed(0)}%"></span></span><b>${v >= 10 ? Math.round(v) : +v.toFixed(1)}</b>`;
}
const UMAX = {}; for (const u of UNITS) { const m = UMAX[u.dom] || (UMAX[u.dom] = { atk: 0, def: 0, hp: 0, sp: 0, range: 0, cost: 0 }); for (const k in m) m[k] = Math.max(m[k], u[k]); }
function unitCard(u) {
  const m = UMAX[u.dom], roles = u.roles.map(r => MIL_ROLE_NAME[r] || r);
  const beats = new Set(), by = new Set();
  for (const r of u.roles) { const c = ROLE_COUNTER[r]; if (c) { c.beats.forEach(x => beats.add(MIL_ROLE_NAME[x])); c.beatenBy.forEach(x => by.add(MIL_ROLE_NAME[x])); } }
  const rep = u.obsBy.map(id => UNIT_BY_ID[id].name), next = u.obs ? UNIT_BY_ID[u.obs] : null;
  return `<div class="ucard"><div class="uhead">${unitImg(u.id, 'ugb')}<div><b>${esc(u.name)}</b><div class="tags"><span class="tag">${DOM_NAME[u.dom]}</span>${roles.map(r => `<span class="tag">${esc(r)}</span>`).join('')}</div></div></div>
    ${u.desc ? `<p>${esc(u.desc)}</p>` : ''}
    <div class="ustats">${statBar('攻击', u.atk, m.atk, true)}${statBar('防御', u.def, m.def, true)}${statBar('耐久', u.hp, m.hp)}${statBar('速度', u.sp, m.sp)}${statBar('射程', u.range, m.range)}${statBar('造价', u.cost, m.cost, true)}</div>
    <p class="note">${rep.length ? `取代 ${esc(rep.join('、'))}` : '本系列的第一种型号'}${next ? ` · 将被 ${esc(next.name)} 取代` : ''}</p>
    ${beats.size || by.size ? `<p class="note">${beats.size ? `克制：${esc([...beats].join('、'))}` : ''}${beats.size && by.size ? '；' : ''}${by.size ? `被克制：${esc([...by].join('、'))}` : ''}</p>` : ''}</div>`;
}
function renderTreeDetail() {
  const el = $('tmDetail');
  const alive = S.nations.filter(n => n.alive);
  if (!tmSel) {
    const cat = CAT_BY_ID[tmCat];
    el.innerHTML = `<h3>${esc(cat.name)}</h3><p>${esc(cat.desc)}</p><p>点选一项科技，查看它的作用、前置科技和掌握它的国家。你可以把任何科技直接赐给任何国家，前置科技会一并赐予。</p>
      <p class="note">${cat.group === '军事' ? '军事科技由军费推动，走单独的「军工研究」轨道，不计入文明时代。' : '文明科技决定一个国家所处的时代。'}节点右上角的「+N」表示有 N 项前置科技在其他页。数字键 1–0 或 ←/→ 切换类别。</p>`;
    return;
  }
  const t = TECH_BY_ID[tmSel], f = S.firsts[t.id];
  const who = tmWho === 'world' ? null : S.nations[+tmWho];
  const knowers = alive.filter(n => n.techs[t.id] !== undefined);
  const chips = ids => ids.map(id => { const x = TECH_BY_ID[id], other = x.cat !== tmCat; return `<button class="chipbtn${other ? ' xp' : ''}" data-t="${id}">${esc(x.name)}${other ? ` · ${esc(CAT_BY_ID[x.cat].name)}` : ''}</button>`; }).join('') || '<span class="note">无</span>';
  if (tmGrant === null || !alive.some(n => n.id === tmGrant)) tmGrant = who ? who.id : (alive.find(n => n.techs[t.id] === undefined) || alive[0] || {}).id;
  let status = '';
  if (who) {
    const st = techState(t, who);
    status = st === 'known' ? `${esc(who.name)}已于${fmtYear(who.techs[t.id])}掌握。` : st === 'cur' ? `${esc(who.name)}正在${t.mil ? '军工' : ''}研究，进度 ${Math.round(techProg(t, who) * 100)}%。` : st === 'locked' ? `${esc(who.name)}已选择了同一军种的其他学说。` : st === 'era' ? `${esc(who.name)}需要先进入${ERA_NAME[t.era]}时代。` : st === 'avail' ? `${esc(who.name)}可以研究这项科技。` : `${esc(who.name)}还缺少前置科技。`;
  }
  const excl = t.excl ? EXCL[t.excl] : null;
  el.innerHTML = `
    <h3>${esc(who && who.techs[t.id] !== undefined && t.excl ? doctrineName(t.id, who) : t.name)}</h3>
    <div class="tags"><span class="tag">${ERA_NAME[t.era]}时代</span><span class="tag"><span class="swatch" style="background:${BRANCH[t.br].color}"></span>${BRANCH[t.br].name}</span>${t.mil ? '<span class="tag gold">军工研究</span>' : ''}${t.mil && t.ry !== undefined ? `<span class="tag">历史参考 ${fmtYearShort(t.ry)}</span>` : ''}</div>
    <p>${esc(t.desc)}</p>
    <div class="fx">效果：${esc(t.fxt)}</div>
    ${status ? `<p>${status}</p>` : ''}
    ${t.units.map(id => unitCard(UNIT_BY_ID[id])).join('')}
    ${excl ? `<h4>互斥学说（${EXCL_N[excl.length] || '多选一'}）</h4><div>${chips(excl.filter(o => o !== t).map(o => o.id))}</div>` : ''}
    <h4>前置科技</h4><div>${chips(t.req)}</div>
    <h4>解锁</h4><div>${chips(UNLOCKS[t.id] || [])}</div>
    <h4>首次发现</h4><p>${f ? `${fmtYear(f.y)}，${esc(f.name)}` : '尚未被任何文明发现'}</p>
    <h4>掌握它的国家（${knowers.length}/${alive.length}）</h4><div class="tags">${knowers.map(n => `<span class="tag">${sw(n)}${esc(n.name)}</span>`).join('') || '<span class="note">还没有</span>'}</div>
    <h4>造物主</h4>
    <div class="acts">
      <select id="tmGrantWho" aria-label="赐予对象" class="msel" style="flex:0 1 auto">${alive.map(n => `<option value="${n.id}"${n.id === tmGrant ? ' selected' : ''}>${esc(n.name)}${n.techs[t.id] !== undefined ? '（已掌握）' : ''}</option>`).join('')}</select>
      <button class="btn primary small" data-act="grant">直接赐予</button>
      <button class="btn small" data-act="target">${t.excl ? '改用这一学说' : t.mil ? '设为军工研究目标' : '设为研究目标'}</button>
    </div>
    <p class="note" id="tmMsg"></p>`;
}
$('tmCanvas').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; tmSel = tmSel === b.dataset.t ? null : b.dataset.t; renderTree(); });
$('tmTabs').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; setTmCat(b.dataset.cat); renderTree(); b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
function cycleTmCat(d) { const k = TECH_CATS.findIndex(c => c.id === tmCat); setTmCat(TECH_CATS[(k + d + TECH_CATS.length) % TECH_CATS.length].id); renderTree(); const b = $('tmTabs').querySelector('[aria-selected="true"]'); if (b) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
$('tmDetail').addEventListener('click', e => {
  const c = e.target.closest('[data-t]'); if (c) { jumpTech(c.dataset.t); return; }
  const b = e.target.closest('[data-act]'); if (!b || !tmSel) return;
  const n = S.nations[+$('tmGrantWho').value]; if (!n || !n.alive) return;
  tmGrant = n.id;
  const t = TECH_BY_ID[tmSel], msg = s => { $('tmMsg').textContent = s; };
  if (b.dataset.act === 'grant') { if (godGrantTech(n, tmSel)) renderTree(); else msg(`${n.name}已经掌握了这项科技`); return; }
  if (n.techs[tmSel] !== undefined) { msg(`${n.name}已经掌握了这项科技`); return; }
  if (t.excl) {
    const reform = EXCL[t.excl].some(o => o !== t && n.techs[o.id] !== undefined);
    if (reform && isPlayer(n) && S.player.pp < 60) { msg('学说改革需要 60 政治点数'); return; }
    const r = chooseDoctrine(n, tmSel);
    if (r.ok && reform && isPlayer(n)) S.player.pp -= 60;
    renderTree(); msg(r.msg); return;
  }
  if (!t.req.every(r => n.techs[r] !== undefined)) { msg(`${n.name}还缺少前置科技，可以直接赐予`); return; }
  if (t.mil) {
    if (t.era > n.mult.era) { msg(`${n.name}还没有进入${ERA_NAME[t.era]}时代，可以直接赐予`); return; }
    if (!milTechOK(n, t)) { msg('现在无法研究这项科技'); return; }
    n.mtarget = tmSel; renderTree(); msg(`${n.name}的军工部门开始研制「${t.name}」`); return;
  }
  n.target = tmSel; renderTree(); msg(`${n.name}的学者开始研究「${t.name}」`);
});
$('tmDetail').addEventListener('change', e => { if (e.target.id === 'tmGrantWho') tmGrant = +e.target.value; });
$('tmWho').addEventListener('change', e => { tmWho = e.target.value; renderTree(); });
$('tmSearch').addEventListener('input', e => { tmQuery = e.target.value.trim(); renderTree(); });
$('tmSearch').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !tmQuery) return;
  const hits = TECHS.filter(t => t.name.includes(tmQuery)); if (!hits.length) return;
  const k = hits.findIndex(t => t.id === tmSel), nx = hits[(k + 1) % hits.length];
  jumpTech(nx.id);
});
$('tmClose').addEventListener('click', closeTree);
$('btnTree').addEventListener('click', () => openTree());

/* ---------- log ---------- */
let renderedLogVersion = -1, logFilter = 'all';
function renderLog() {
  renderedLogVersion = logVersion;
  const items = S.log.filter(e => logFilter === 'all' || e.t === logFilter).slice(0, 160);
  $('logList').innerHTML = items.map(e => `<li${e.i >= 0 ? ` data-cell="${e.i}"` : ''}><span class="y">${esc(fmtYearShort(e.y))}</span><span class="dot" style="background:var(${TYPE_COLOR[e.t] || '--sodium'})" title="${TYPE_NAME[e.t] || ''}"></span><span class="t">${esc(e.s)}</span></li>`).join('') || '<li><span></span><span></span><span class="t" style="color:var(--ink-3)">暂无记录</span></li>';
}
$('logFilter').innerHTML = [['all', '全部'], ...Object.entries(TYPE_NAME)].map(([k, v]) => `<button data-f="${k}" aria-pressed="${k === 'all'}">${v}</button>`).join('');
$('logFilter').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  logFilter = b.dataset.f;
  for (const x of $('logFilter').children) x.setAttribute('aria-pressed', x === b);
  renderedLogVersion = -1; renderLog();
});
$('logList').addEventListener('click', e => {
  const li = e.target.closest('li[data-cell]'); if (!li) return;
  const cell = +li.dataset.cell, c = S.cities.find(c => c.i === cell);
  selected = c ? { city: c.id } : { cell };
  if (viewMode === 'map') flyToCell(cell, Math.max(cam.z, 2.6));
  else { const ll = cellLatLon(cell); G.rot = ll.lon - PI / 2; G.pitch = clamp(ll.lat, -1.1, 1.1); G.dirty = true; }
  updateInspector(true);
});

/* ---------- achievements ---------- */
const ACH = [
  { id: 'seed', name: '创世', desc: '用「播种文明」诞生一个新部落' },
  { id: 'bigcity', name: '千万之城', desc: '出现一座人口超过 1000 万的城市' },
  { id: 'empire', name: '日不落', desc: '一个国家拥有 40 座城市' },
  { id: 'worldwar', name: '世界大战', desc: '同时有 6 个国家卷入战争' },
  { id: 'peace', name: '永久和平', desc: '连续 150 年世界上没有一场战争' },
  { id: 'conquer', name: '奉天讨逆', desc: '用「派兵」攻下一座敌城' },
  { id: 'kingmaker', name: '造王者', desc: '用「煽动独立」建立的国家存续 300 年' },
  { id: 'blessed', name: '众神眷顾', desc: '为 5 个不同的国家赐福' },
  { id: 'impact', name: '天降正义', desc: '用陨石摧毁一座城市' },
  { id: 'creator', name: '沧海桑田', desc: '用「造陆」造出 30 格新陆地' },
  { id: 'steam', name: '工业革命', desc: '任意文明发明蒸汽机' },
  { id: 'moon', name: '一小步', desc: '人类登上月球' },
  { id: 'pop10b', name: '百亿人口', desc: '世界人口突破 100 亿' },
  { id: 'stars', name: '星辰大海', desc: '第一艘星际方舟启航' },
  { id: 'allfirst', name: '百科全书', desc: `人类发现全部 ${TECHS.length} 项科技` },
  { id: 'hegemon', name: '大一统', desc: '一个国家拥有世界 70% 的人口' },
  { id: 'green', name: '气候守护者', desc: '进入未来时代时，全球升温仍低于 1.5 °C' },
  { id: 'doom', name: '温室地狱', desc: '全球升温超过 4 °C' },
  { id: 'revolution', name: '人民的意志', desc: '任意国家发生一次政体更替' },
  { id: 'civilwar', name: '兄弟阋墙', desc: '爆发一场意识形态内战' },
  { id: 'coop', name: '走出囚徒困境', desc: '各国在博弈中达成合作 30 次' },
  { id: 'mad', name: '恐怖平衡', desc: '两个拥核国家在边境危机中各退一步' },
  { id: 'unify', name: '天下归一', desc: '整个世界被一个政权统一' },
  { id: 'mars', name: '第二颗蓝星', desc: '完成火星改造' },
  { id: 'exo', name: '另一颗太阳', desc: '在系外行星上建立殖民地' },
  { id: 'spaceindep', name: '星际独立战争', desc: '一个地外殖民地宣布脱离母国' },
  { id: 'railnet', name: '钢铁动脉', desc: '一个国家铺设 30 段铁路' },
  { id: 'reform', name: '与时俱进', desc: '一种意识形态完成三次自我迭代' },
  { id: 'leader_unify', name: '征服者', desc: '领袖模式：统一世界' },
  { id: 'leader_ideo', name: '思想的胜利', desc: '领袖模式：八成人口生活在你的意识形态之下' },
  { id: 'leader_stars', name: '群星之主', desc: '领袖模式：殖民 5 颗星球，包括一颗系外行星' },
];
let ACHV = {}, renderedAch = -1;
function loadAch() { try { ACHV = JSON.parse(localStorage.getItem('blue-planet-ach') || '{}') || {}; } catch (e) { ACHV = {}; } }
function unlock(id) {
  if (ACHV[id]) return;
  ACHV[id] = Date.now();
  try { localStorage.setItem('blue-planet-ach', JSON.stringify(ACHV)); } catch (e) {}
  const a = ACH.find(x => x.id === id);
  if (a) { showBanner('成就解锁 · ' + a.name, a.desc); log('civ', `成就解锁：${a.name}`, -1, false); }
  achVersion++;
}
function checkAchievements() {
  const alive = S.nations.filter(n => n.alive), st = S.stats;
  if (st.seeds > 0) unlock('seed');
  if (S.cities.some(c => c.pop >= 1e7)) unlock('bigcity');
  if (alive.some(n => n.cl.length >= 40)) unlock('empire');
  if (st.maxWarNations >= 6) unlock('worldwar');
  if (st.maxWarNations >= 2 && S.flags.maxEra >= 2 && S.year - st.lastWarYear >= 150) unlock('peace');
  if (st.conquer > 0) unlock('conquer');
  if (alive.some(n => n.rebel && S.year - n.born >= 300)) unlock('kingmaker');
  if (st.blessed.length >= 5) unlock('blessed');
  if (st.impact > 0) unlock('impact');
  if (st.landMade >= 30) unlock('creator');
  if (S.firsts.steam) unlock('steam');
  if (S.moon) unlock('moon');
  const wp = worldPop();
  if (wp >= 1e10) unlock('pop10b');
  if (S.ships > 0) unlock('stars');
  if (Object.keys(S.firsts).length >= TECHS.length) unlock('allfirst');
  if (S.year > -3000 && alive.some(n => n.st.pop >= wp * 0.7)) unlock('hegemon');
  if (S.flags.maxEra >= 7 && S.tanom < 1.5 && S.firsts.steam) unlock('green');
  if (S.tanom >= 4) unlock('doom');
  if (st.revolutions > 0) unlock('revolution');
  if (st.civilWars > 0) unlock('civilwar');
  if ((st.coop || 0) >= 30) unlock('coop');
  if (st.mad > 0) unlock('mad');
  if (S.flags.unified) unlock('unify');
  if (S.space && (S.space.terra.mars || 0) >= 1) unlock('mars');
  if (S.space && PLANETS.some(p => p.inter && (S.space.col[p.id] || []).length)) unlock('exo');
  if (st.spaceIndep > 0) unlock('spaceindep');
  if (alive.some(n => n.eco && n.eco.rails >= 30)) unlock('railnet');
  if (S.doct && Object.values(S.doct).some(d => d.ver >= 3)) unlock('reform');
}
function renderAch() {
  renderedAch = achVersion;
  const got = ACH.filter(a => ACHV[a.id]).length;
  $('achList').innerHTML = `<h3>挑战 <small>${got} / ${ACH.length}</small></h3>` + ACH.map(a => `<div class="ach${ACHV[a.id] ? ' got' : ''}"><span class="badge">${ACHV[a.id] ? '✓' : ''}</span><span class="an">${esc(a.name)}</span><span class="ad">${esc(a.desc)}</span></div>`).join('') + '<p class="note">成就会保存在这个浏览器里，换一颗星球也会保留。</p>';
}

/* ---------- inspector ---------- */
const CITY_STYLE = ['茅草村落', '泥砖城镇', '石砌城邦', '木构市镇', '红砖工业城', '钢筋都市', '玻璃摩天城', '未来之城', '星际都会'];
const KIND_NAME = KIND_LABEL;
// buildings of a city (everyone sees them); the player's own cities get build buttons, enemy cities a thrust button
function inspBuildings(c, n) {
  const have = BLD_ORDER.filter(k => bget(c, k)).map(k => `<span class="tag">${esc(bldName(k, n))}${BLD_KINDS[k].lv ? ' ' + bget(c, k) + ' 级' : ' ×' + bget(c, k)}</span>`).join('');
  const P = S.mode === 'leader' ? playerNation() : null;
  let h = have ? `<div class="ibld">${have}</div>` : '';
  if (P && P.alive && c.n === P.id) {
    const q = queuedAt(P, c);
    h += `<p class="note">建设（用地 ${slotsUsed(c) + queuedSlots(P, c)}/${citySlots(c)}${q ? `，在建 ${q} 项` : ''}）：民用工厂 · 军工厂 · 船坞 · 陆/海/空军基地 · 要塞</p><div class="bchips" style="margin-top:4px">${bldButtons(P, c, 'bchip')}<button class="bchip" data-act="milbuild" title="打开军务面板">军务…</button></div>`;
  } else if (P && P.alive && warBetween(P.id, n.id)) {
    const w = warBetween(P.id, n.id), on = w.obj && w.obj[sideOf(w, P)] === c.id;
    h += `<div class="acts"><button class="btn small${on ? '' : ' danger'}" data-act="thrust" ${on ? 'disabled' : ''}>${on ? '已是主攻方向' : '设为主攻方向'}</button></div>`;
  }
  return h;
}
function updateInspector(force) {
  const el = $('insp');
  if (!selected) { el.hidden = true; el._html = ''; return; }
  if (viewMode === 'system' || viewMode === 'planet') { el.hidden = true; return; }
  if (!force && el.matches(':hover')) return;
  let html = '';
  if (selected.agent) {
    const a = selected.agent;
    if (!AG.includes(a)) { selected = null; el.hidden = true; return; }
    const n = S.nations[a.n], c = cityById(a.c);
    const job = a.role === 'army' ? (KIND_NAME[a.kind] || WEAPON_NAME[a.wp] + '兵') : (KIND_NAME[a.kind] || ROLE_NAME[a.role]);
    html = `<button class="close" aria-label="关闭">×</button>
      <h2>${esc(a.name)}</h2>
      <div class="meta">${n ? sw(n) + esc(n.name) : ''} · ${esc(job)} · ${a.age} 岁</div>
      <div class="doing">${esc(a.st === 'dead' ? '已经离世' : a.doing || '发呆')}</div>
      <dl class="kv">
        <dt>家乡</dt><dd class="txt">${c ? esc(c.name) : '—'}</dd>
        <dt>职业</dt><dd class="txt">${esc(ROLE_NAME[a.role])}</dd>
        ${a.role === 'army' ? `<dt>装备</dt><dd class="txt">${esc(WEAPON_NAME[a.wp])}</dd>` : ''}
        ${a.boat ? '<dt>正在</dt><dd class="txt">乘船渡海</dd>' : ''}
      </dl>
      <div class="acts"><button class="btn small" data-act="follow">${cam.follow === a ? '停止跟随' : '跟随视角'}</button>${c ? '<button class="btn small" data-act="home">查看家乡</button>' : ''}</div>`;
  } else if (selected.city) {
    const c = cityById(selected.city);
    if (!c) { selected = null; el.hidden = true; return; }
    const n = S.nations[c.n];
    const res = RES.filter(r => n.dep[r].some(i => S.cityOf[i] === S.cities.indexOf(c))).map(r => `<span class="tag"><span class="swatch" style="background:rgb(${RES_RGB[r].join(',')})"></span>${RES_NAME[r]}</span>`).join('');
    html = `<button class="close" aria-label="关闭">×</button>
      <h2>${esc(c.name)}</h2>
      <div class="meta">${sw(n)}${esc(n.name)}${c.cap ? ' · 首都' : ''} · 建于${fmtYear(c.born)}</div>
      <dl class="kv">
        <dt>政体</dt><dd class="txt">${esc(ideoOf(n).name)}</dd>
        <dt>人口</dt><dd>${fmtPop(c.pop)}</dd>
        <dt>承载上限</dt><dd>${fmtPop(c.K)}</dd>
        <dt>风貌</dt><dd class="txt">${CITY_STYLE[n.mult.era]}</dd>
        <dt>工厂</dt><dd>${c.fac >= 0.05 ? c.fac.toFixed(1) : '—'}</dd>
        <dt>研究所</dt><dd>${c.labs >= 0.05 ? c.labs.toFixed(1) : '—'}</dd>
        ${c.inst ? `<dt>国立研究院</dt><dd>${c.inst} 座</dd>` : ''}
        <dt>科研 / 年</dt><dd>${c.rp.toFixed(1)}</dd>
        <dt>守军</dt><dd class="txt">${esc((landMain(n) || { name: WEAPON_NAME[n.mult.weapon] }).name)}</dd>
        <dt>地貌</dt><dd class="txt">${BIOME_NAME[WORLD.biome[c.i]]}${c.coastal ? '，沿海' : ''}</dd>
        <dt>气温</dt><dd>${cellTeff(c.i).toFixed(1)} °C</dd>
      </dl>
      ${relTags(n) ? `<div class="tags">${relTags(n)}</div>` : ''}
      ${res ? `<div class="tags">${res}</div>` : ''}
      ${inspBuildings(c, n)}
      <div class="acts">
        <button class="btn small" data-act="zoom">放大看看</button>
        ${S.mode === 'leader' ? '' : `<button class="btn small" data-act="bless">赐福</button>
        <button class="btn small" data-act="inspire">灵感</button>
        <button class="btn small" data-act="army">赐军</button>
        <button class="btn small" data-act="rebel">煽动独立</button>`}
        <button class="btn small" data-act="nation">${isPlayer(n) ? '国家面板' : S.mode === 'leader' ? '查看国家' : '管理国家'}</button>
      </div>`;
  } else {
    const i = selected.cell;
    if (i < 0) { selected = null; el.hidden = true; return; }
    const land = isLand(i), own = S.owner[i], e = WORLD.elev[i];
    const res = RES.filter(r => S.res[r][i] > 0).map(r => `<span class="tag"><span class="swatch" style="background:rgb(${RES_RGB[r].join(',')})"></span>${RES_NAME[r]} ${Math.round(S.res[r][i])}</span>`).join('');
    const biome = land ? BIOME_NAME[WORLD.biome[i] === B.ICE && cellTeff(i) > -9 ? B.TUNDRA : WORLD.biome[i]] : (cellTeff(i) < -7 ? '海冰' : (isShallow(i) ? '浅海' : '深海'));
    const ll = cellLatLon(i);
    html = `<button class="close" aria-label="关闭">×</button>
      <h2>${biome}</h2>
      <div class="meta">${Math.abs(ll.lat * 180 / PI).toFixed(1)}°${ll.lat >= 0 ? 'N' : 'S'} · ${Math.abs(ll.lon * 180 / PI).toFixed(1)}°${ll.lon >= 0 ? 'E' : 'W'}</div>
      <dl class="kv">
        <dt>${land ? '海拔' : '水深'}</dt><dd>${land ? Math.round((e - S.seaRise) * 5600) : Math.round((S.seaRise - e) * 6500)} m</dd>
        <dt>气温</dt><dd>${cellTeff(i).toFixed(1)} °C</dd>
        ${land ? `<dt>森林覆盖</dt><dd>${Math.round(S.forest[i] * 100)}%</dd><dt>土地肥力</dt><dd>${(WORLD.fert0[i] * 100).toFixed(0)}</dd>` : `<dt>渔业资源</dt><dd>${WORLD.fish[i] > 0 ? Math.round(WORLD.fish[i] * 100) : '—'}</dd>`}
        <dt>归属</dt><dd class="txt">${own >= 0 ? esc(S.nations[own].name) : '无主之地'}</dd>
      </dl>
      ${res ? `<div class="tags">${res}</div>` : ''}
      ${land && own < 0 ? '<div class="acts"><button class="btn small" data-act="seedhere">在此播种文明</button></div>' : ''}`;
  }
  setHTML(el, html);
  el.hidden = false;
}
$('insp').addEventListener('click', e => {
  if (e.target.closest('.close')) { selected = null; cam.follow = null; $('insp').hidden = true; return; }
  const bc = e.target.closest('[data-bc]');
  if (bc && selected && selected.city) {
    const P = playerNation(), c = cityById(+bc.dataset.bc);
    if (P && c) { const r = queueBuild(P, c, bc.dataset.bk, 1); if (r.ok) showTicker('civ', r.msg); else flashHint(r.msg); }
    $('insp')._html = ''; updateInspector(true); return;
  }
  const b = e.target.closest('[data-act]'); if (!b || !selected) return;
  const act = b.dataset.act;
  if (selected.agent) {
    const a = selected.agent;
    if (act === 'follow') cam.follow = cam.follow === a ? null : a;
    if (act === 'home') { const c = cityById(a.c); if (c) { selected = { city: c.id }; flyToCity(c); } }
  } else if (selected.city) {
    const c = cityById(selected.city); if (!c) return;
    const n = S.nations[c.n];
    if (act === 'zoom') flyToCity(c, Math.max(cam.z, 4.5));
    if (act === 'milbuild') openMil('build');
    if (act === 'thrust') { const P = playerNation(), w = P && warBetween(P.id, n.id); if (w) { showTicker('war', setWarObjective(P, w, c.id)); $('pane-me')._html = ''; } }
    if (S.mode === 'leader' && act !== 'zoom' && act !== 'nation') { $('insp')._html = ''; updateInspector(true); return; }
    if (act === 'bless') godBless(n);
    if (act === 'inspire') godInspire(n);
    if (act === 'army') godArmy(n);
    if (act === 'rebel') { if (!splitFrom(c, true)) flashHint('这个国家只剩这一座城了'); }
    if (act === 'nation') { if (isPlayer(n)) switchTab('me'); else { expandedNation = n.id; selectedNation = n.id; switchTab('nat'); } }
  } else if (act === 'seedhere') { const r = godSeed(selected.cell); if (typeof r === 'string') flashHint(r); }
  $('insp')._html = ''; updateInspector(true);
});
holdOnInteract($('insp'));

/* ---------- legend ---------- */
function renderLegend() {
  const el = $('legend');
  if (layer === 0 || viewMode === 'system' || viewMode === 'planet') { el.hidden = true; return; }
  let html = '';
  if (layer === 1) html = '颜色代表国家，边线是国界。点击城市查看详情。';
  if (layer === 2) html = RES.map(r => `<span><i style="background:rgb(${RES_RGB[r].join(',')})"></i>${RES_NAME[r]}</span>`).join('') + '<span><i style="background:rgb(150,200,255)"></i>渔场</span><span><i style="background:rgb(70,70,76)"></i>已采空</span>';
  if (layer === 3) html = `<div class="ramp"><span>稀疏</span><span class="bar" style="background:linear-gradient(90deg,${POP_RAMP.map(c => `rgb(${c.join(',')})`).join(',')})"></span><span>稠密</span></div>`;
  if (layer === 4) html = `<div class="ramp"><span>-30 °C</span><span class="bar" style="background:linear-gradient(90deg,rgb(57,120,214),rgb(120,122,126),rgb(222,72,64))"></span><span>35 °C</span></div><span><i style="background:rgb(96,80,56)"></i>工业雾霾</span>`;
  if (layer === 5) { const sh = S.ideoWorld || worldIdeoShares(); html = IDEO.filter(I => sh[I.id] > 0.001).sort((a, b) => sh[b.id] - sh[a.id]).map(I => `<span><i style="background:${I.color}"></i>${I.name} ${Math.round(sh[I.id] * 100)}%</span>`).join(''); }
  setHTML(el, html); el.hidden = false;
}

/* =====================================================================
   Tools
   ===================================================================== */
const ICONS = {
  eye: 'M2 10c2-4 5-6 8-6s6 2 8 6c-2 4-5 6-8 6s-6-2-8-6z M10 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z',
  sprout: 'M10 18v-8 M10 10c0-4-3-6-7-6 0 4 3 6 7 6z M10 12c0-3 2-5 6-5 0 3-2 5-6 5z',
  house: 'M3 10l7-6 7 6 M5 9v8h10V9 M8.5 17v-4h3v4',
  star: 'M10 2.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2-4.6-2.5-4.6 2.5.9-5.2L2.5 8l5.2-.7z',
  bulb: 'M7 14h6 M8 17h4 M10 2.5a5 5 0 0 0-3 9c.7.6 1 1.4 1 2.5h4c0-1.1.3-1.9 1-2.5a5 5 0 0 0-3-9z',
  shield: 'M10 2.5l6 2.5v5c0 4-3 6.5-6 7.5-3-1-6-3.5-6-7.5V5z',
  split: 'M10 3v5 M10 8l-5 5v4 M10 8l5 5v4',
  handshake: 'M2 9l4-4 4 3 4-3 4 4 M6 9l4 4 4-4 M2 9l3 3 M18 9l-3 3',
  swords: 'M3 3l10 10 M12 15l3-3 M17 3L7 13 M8 15l-3-3 M3 17l2-2 M17 17l-2-2',
  meteor: 'M15.5 13.5a3 3 0 1 1-6 0a3 3 0 1 1 6 0z M3 3l7 7 M6 2l5 5 M2 6l5 5',
  virus: 'M10 6a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M10 2v3 M10 15v3 M2 10h3 M15 10h3 M4.3 4.3l2.1 2.1 M13.6 13.6l2.1 2.1 M4.3 15.7l2.1-2.1 M13.6 6.4l2.1-2.1',
  quake: 'M2 10h3l2-5 3 10 2-7 2 4h4',
  volcano: 'M2 17l5-9h6l5 9z M8 8l2-4 2 4 M7 3l1 1 M13 3l-1 1',
  land: 'M3 15c2-3 4-1 6-4s4-5 8-3v7H3z',
  wave: 'M2 8c2-2 4-2 6 0s4 2 6 0 3-2 4-1 M2 13c2-2 4-2 6 0s4 2 6 0 3-2 4-1',
  mountain: 'M2 17l6-10 3 5 2-3 5 8z',
  tree: 'M10 2l5 7h-3l4 5H4l4-5H5z M10 14v4',
};
const TOOLS = [
  { g: '查看', id: 'inspect', name: '查看', icon: 'eye', cls: '', hint: '点击城市、小人或土地查看详情。拖动平移，滚轮缩放。' },
  { g: '文明', id: 'seed', name: '播种', icon: 'sprout', cls: 'g-civ', hint: '点击一块无人陆地，诞生一个新部落' },
  { g: '文明', id: 'city', name: '建城', icon: 'house', cls: 'g-civ', hint: '点击陆地，为最近的国家建一座新城' },
  { g: '文明', id: 'bless', name: '赐福', icon: 'star', cls: 'g-civ', hint: '点击城市：它的国家迎来黄金时代（增长与科研加速）' },
  { g: '文明', id: 'inspire', name: '灵感', icon: 'bulb', cls: 'g-civ', hint: '点击城市：它的国家立即取得一项科研突破' },
  { g: '文明', id: 'army', name: '赐军', icon: 'shield', cls: 'g-civ', hint: '点击城市：它的国家军力大增' },
  { g: '文明', id: 'rebel', name: '独立', icon: 'split', cls: 'g-civ', hint: '点击城市：它带着周边城市独立建国' },
  { g: '战争', id: 'diplo', name: '外交', icon: 'handshake', cls: 'g-war', hint: '先点甲国的一座城，再点乙国的一座城，选择宣战、停战或结盟' },
  { g: '战争', id: 'attack', name: '派兵', icon: 'swords', cls: 'g-war', hint: '先点出兵的城市，再点要攻打的别国城市' },
  { g: '灾难', id: 'meteor', name: '陨石', icon: 'meteor', cls: 'g-dis', hint: '点击任意位置，召唤一颗陨石' },
  { g: '灾难', id: 'plague', name: '瘟疫', icon: 'virus', cls: 'g-dis', hint: '点击城市：瘟疫在它的国家蔓延' },
  { g: '灾难', id: 'quake', name: '地震', icon: 'quake', cls: 'g-dis', hint: '点击任意位置，引发一场大地震' },
  { g: '灾难', id: 'volcano', name: '火山', icon: 'volcano', cls: 'g-dis', hint: '点击陆地，唤醒一座火山' },
  { g: '地形', id: 'raise', name: '造陆', icon: 'land', cls: 'g-ter', brush: 1, hint: '在海上按住拖动，堆出新陆地（右键拖动可平移）' },
  { g: '地形', id: 'sink', name: '沉海', icon: 'wave', cls: 'g-ter', brush: 1, hint: '按住拖动，让陆地沉入大海' },
  { g: '地形', id: 'mountain', name: '造山', icon: 'mountain', cls: 'g-ter', brush: 1, hint: '按住拖动，隆起山脉' },
  { g: '地形', id: 'forest', name: '种树', icon: 'tree', cls: 'g-ter', brush: 1, hint: '按住拖动，种下森林' },
];
let tool = 'inspect', attackFrom = null;
function buildToolbar() {
  const groups = [];
  for (const t of TOOLS) { let g = groups.find(x => x.name === t.g); if (!g) { g = { name: t.g, items: [] }; groups.push(g); } g.items.push(t); }
  $('toolbar').innerHTML = groups.map(g => `<div class="tgroup" data-g="${g.name}"><span class="gl">${g.name}</span><div class="row">${g.items.map(t => `<button class="tool ${t.cls}" data-tool="${t.id}" aria-pressed="${t.id === tool}" title="${esc(t.hint)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="${ICONS[t.icon]}"/></svg>${t.name}</button>`).join('')}</div></div>`).join('');
}
$('toolbar').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool === tool && tool !== 'inspect' ? 'inspect' : b.dataset.tool); });
function setTool(id) {
  tool = id; diploFrom = null; attackFrom = null; $('popup').hidden = true;
  for (const b of $('toolbar').querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', b.dataset.tool === id);
  canvas.classList.toggle('tool', id !== 'inspect');
  refreshToolHint();
}
function refreshToolHint() {
  const h = $('toolHint'), t = TOOLS.find(x => x.id === tool);
  if (!t || tool === 'inspect' || viewMode === 'system' || viewMode === 'planet') { h.hidden = true; return; }
  let txt = t.hint;
  if (tool === 'diplo' && diploFrom) txt = `已选中${S.nations[diploFrom.n].name}，再点另一个国家的城市`;
  if (tool === 'attack' && attackFrom) { const c = cityById(attackFrom); txt = c ? `从${c.name}出兵，再点要攻打的别国城市` : t.hint; }
  h.hidden = false; h.textContent = txt + '（Esc 取消）';
}
function cityForTool(city, cell) {
  if (city) return city;
  if (cell >= 0 && S.owner[cell] >= 0) { const n = S.nations[S.owner[cell]]; let b = null, bd = 1e9; for (const c of n.cl) { const d = cellDist(c.i, cell); if (d < bd) { bd = d; b = c; } } return b; }
  return null;
}
function applyTool(city, cell, sx, sy) {
  const c = cityForTool(city, cell);
  if (S.mode === 'leader' && tool !== 'attack') { flashHint('领袖模式下只能查看和派兵'); return; }
  if (S.mode === 'leader') {
    const P = playerNation(); if (!P || !P.alive) return;
    if (!c) { flashHint('请点击一座城市'); return; }
    const from = attackFrom ? cityById(attackFrom) : null;
    if (!from || from.n !== P.id) {
      if (c.n !== P.id) {
        const w = warBetween(P.id, c.n);
        if (w) { showTicker('war', setWarObjective(P, w, c.id) + '（要直接突击，先点你自己的出发城市）'); $('pane-me')._html = ''; return; }
        flashHint(`你没有与${S.nations[c.n].name}交战。先在「国家」页宣战`); return;
      }
      attackFrom = c.id; refreshToolHint(); return;
    }
    if (c.n === P.id) { attackFrom = c.id; refreshToolHint(); return; }
    if (!atWar(P.id, c.n)) { flashHint(`你没有与${S.nations[c.n].name}交战。先在「国家」页宣战`); return; }
    orderAttack(from, c); attackFrom = null; refreshToolHint();
    return;
  }
  switch (tool) {
    case 'seed': { if (cell < 0) return; const r = godSeed(cell); if (typeof r === 'string') flashHint(r); return; }
    case 'city': { if (cell < 0) return; const r = godCity(cell); if (typeof r === 'string') flashHint(r); return; }
    case 'bless': case 'inspire': case 'army': case 'plague': case 'rebel': {
      if (!c) { flashHint('请点击某个国家的城市或领土'); return; }
      const n = S.nations[c.n];
      if (tool === 'bless') godBless(n);
      if (tool === 'inspire' && !godInspire(n)) flashHint('这个国家已经掌握了全部科技');
      if (tool === 'army') godArmy(n);
      if (tool === 'plague') plague(n, true);
      if (tool === 'rebel' && !splitFrom(c, true)) flashHint('这个国家只剩这一座城了');
      return;
    }
    case 'meteor': if (cell >= 0) meteor(cell, true); return;
    case 'quake': if (cell >= 0) quake(cell, true); return;
    case 'volcano': if (cell >= 0) { if (!isLand(cell)) flashHint('火山需要在陆地上'); else volcano(cell, true); } return;
    case 'diplo': {
      if (!c) { flashHint('请点击某个国家的城市'); return; }
      if (!diploFrom || diploFrom.n === c.n) { diploFrom = { city: c.id, n: c.n }; refreshToolHint(); return; }
      showDiplo(S.nations[diploFrom.n], S.nations[c.n], sx, sy);
      diploFrom = null; refreshToolHint();
      return;
    }
    case 'attack': {
      if (!c) { flashHint('请点击一座城市'); return; }
      if (!attackFrom || !cityById(attackFrom)) { attackFrom = c.id; refreshToolHint(); return; }
      const from = cityById(attackFrom);
      if (c.n === from.n) { attackFrom = c.id; refreshToolHint(); return; }
      orderAttack(from, c); attackFrom = null; refreshToolHint();
      return;
    }
  }
}
function showDiplo(A, Bn, sx, sy) {
  const p = $('popup');
  const war = atWar(A.id, Bn.id), al = allied(A.id, Bn.id);
  p.innerHTML = `<h4>${sw(A)}${esc(A.name)} <span style="color:var(--ink-3)">与</span> ${sw(Bn)}${esc(Bn.name)}</h4>
    <div class="row">
      ${war ? '<button class="btn small" data-d="peace">停战</button>' : '<button class="btn small danger" data-d="war">宣战</button>'}
      ${al ? '<button class="btn small" data-d="unally">解除同盟</button>' : '<button class="btn small" data-d="ally">结盟</button>'}
      <button class="btn small" data-d="attack">${esc(A.name)}出兵</button>
      <button class="btn small" data-d="annexA">${esc(A.name)}吞并对方</button>
      <button class="btn small" data-d="annexB">${esc(Bn.name)}吞并对方</button>
      <button class="btn small" data-d="close">关闭</button>
    </div>
    <p class="note">现在：${war ? '交战中' : al ? '同盟' : '和平'}。军力 ${fmtNum(power(A) / 1000)} 对 ${fmtNum(power(Bn) / 1000)}。</p>`;
  p.hidden = false;
  const r = p.getBoundingClientRect();
  p.style.left = clamp(sx + 12, 8, view.w - r.width - 8) + 'px';
  p.style.top = clamp(sy - r.height / 2, 8, view.h - r.height - 90) + 'px';
  p.dataset.a = A.id; p.dataset.b = Bn.id;
}
$('popup').addEventListener('click', e => {
  const b = e.target.closest('[data-d]'); if (!b) return;
  const p = $('popup'), A = S.nations[+p.dataset.a], Bn = S.nations[+p.dataset.b];
  const d = b.dataset.d;
  if (d === 'war') nationAction('war', A, Bn);
  if (d === 'peace') nationAction('peace', A, Bn);
  if (d === 'ally') nationAction('ally', A, Bn);
  if (d === 'unally') nationAction('unally', A, Bn);
  if (d === 'attack') nationAction('attack', A, Bn);
  if (d === 'annexA') annexNation(A, Bn, `造物主将${Bn.name}并入${A.name}`);
  if (d === 'annexB') annexNation(Bn, A, `造物主将${A.name}并入${Bn.name}`);
  p.hidden = true;
});
let lastBrush = -1;
function applyBrush(sx, sy) {
  const t = TOOLS.find(x => x.id === tool); if (!t || !t.brush) return;
  const cell = viewMode === 'map' ? mapAt(sx, sy).cell : (globeUnproject(G, sx, sy) || { cell: -1 }).cell;
  if (cell < 0 || cell === lastBrush) return;
  lastBrush = cell;
  const cells = [cell];
  if (viewMode === 'map' ? cam.z < 2.5 : true) cells.push(...neighbors4(cell));
  for (const c of cells) terraform(c, tool, true);
}

/* =====================================================================
   Pointer & keyboard
   ===================================================================== */
let drag = null;
const pointers = new Map();
function pickCity(sx, sy) {
  let b = null, bd = 16;
  for (const s of screenCities) { const d = Math.hypot(s.x - sx, s.y - sy) - (s.r || 3); if (d < bd) { bd = d; b = s.c; } }
  return b;
}
function pickAgent(sx, sy) {
  if (viewMode !== 'map' || cam.z < AGENT_Z) return null;
  let b = null, bd = Math.max(8, cam.z * 1.6);
  for (const a of AG) {
    if (a.st === 'dead' || (a.hide && a.st === 'rest')) continue;
    const ax = sxOf(a.x), ay = syOf(a.y) - cam.z * 1.6;
    const d = Math.hypot(ax - sx, ay - sy); if (d < bd) { bd = d; b = a; }
  }
  return b;
}
function localXY(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
canvas.addEventListener('pointerdown', e => {
  const [sx, sy] = localXY(e);
  pointers.set(e.pointerId, { x: sx, y: sy });
  canvas.setPointerCapture(e.pointerId);
  $('popup').hidden = true;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), z0: viewMode === 'map' ? cam.tz : viewMode === 'system' ? sys.z : viewMode === 'planet' ? GP.zoom : G.zoom, moved: 99 }; return; }
  const t = TOOLS.find(x => x.id === tool);
  drag = { x: sx, y: sy, lx: sx, ly: sy, lt: performance.now(), moved: 0, brush: !!(t && t.brush) && e.button === 0 };
  cam.goal = null;
  if (drag.brush) { lastBrush = -1; applyBrush(sx, sy); }
  else canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', e => {
  const [sx, sy] = localXY(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: sx, y: sy });
  if (drag && drag.pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()], f = Math.hypot(a.x - b.x, a.y - b.y) / drag.pinch;
    if (viewMode === 'map') { cam.tz = clamp(drag.z0 * f, zMin() * 0.85, Z_MAX); cam.ax = (a.x + b.x) / 2; cam.ay = (a.y + b.y) / 2; if (cam.tz < zMin() * 0.9) { cam.tz = zMin(); switchView('globe', true); drag = null; } }
    else if (viewMode === 'system') sysZoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, drag.z0 * f / sys.z);
    else if (viewMode === 'planet') setPlanetZoom(drag.z0 * f);
    else { setGlobeZoom(drag.z0 * f); }
    return;
  }
  if (drag && !drag.pinch) {
    const dx = sx - drag.lx, dy = sy - drag.ly, now = performance.now(), dt = Math.max(1, now - drag.lt) / 1000;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.lx = sx; drag.ly = sy; drag.lt = now;
    if (drag.brush) { applyBrush(sx, sy); return; }
    if (viewMode === 'system') { sys.px += dx; sys.py += dy; return; }
    if (viewMode === 'planet') { GP.rot -= dx / GP.R; const np = clamp(GP.pitch + dy / GP.R, -1.2, 1.2); if (np !== GP.pitch) { GP.pitch = np; GP.dirty = true; } GP.vr = GP.vr * 0.6 + (-dx / GP.R / dt) * 0.4; return; }
    if (viewMode === 'map') {
      cam.x -= dx / cam.z; cam.y -= dy / cam.z; cam.follow = null;
      cam.vx = cam.vx * 0.6 + (-dx / cam.z / dt) * 0.4; cam.vy = cam.vy * 0.6 + (-dy / cam.z / dt) * 0.4;
    } else {
      G.rot -= dx / G.R;
      const np = clamp(G.pitch + dy / G.R, -1.3, 1.3); if (np !== G.pitch) { G.pitch = np; G.dirty = true; }
      G.vr = G.vr * 0.6 + (-dx / G.R / dt) * 0.4; G.vp = G.vp * 0.6 + (dy / G.R / dt) * 0.4;
    }
    return;
  }
  if (viewMode === 'system' || viewMode === 'planet') { spaceHover(sx, sy); return; }
  const a = pickAgent(sx, sy), c = a ? null : pickCity(sx, sy), tip = $('hoverTip');
  if (a) { tip.hidden = false; tip.textContent = `${a.name} · ${a.role === 'army' ? (KIND_NAME[a.kind] || WEAPON_NAME[a.wp] + '兵') : ROLE_NAME[a.role]} · ${a.doing}`; tip.style.left = sx + 'px'; tip.style.top = sy + 'px'; }
  else if (c) { tip.hidden = false; tip.textContent = `${c.name} · ${S.nations[c.n].name} · ${fmtPop(c.pop)}`; tip.style.left = sx + 'px'; tip.style.top = sy + 'px'; }
  else tip.hidden = true;
  canvas.style.cursor = (a || c) && tool === 'inspect' ? 'pointer' : '';
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size) return;
  canvas.classList.remove('dragging');
  const d = drag; drag = null;
  if (!d || d.pinch) return;
  if (d.brush) { if (S.terrDirty) territory(); return; }
  if (Math.abs(cam.vx) < 4 && Math.abs(cam.vy) < 4) { cam.vx = cam.vy = 0; }
  if (performance.now() - d.lt > 120) { cam.vx = cam.vy = 0; G.vr = G.vp = 0; GP.vr = 0; }
  if (d.moved >= 6 || e.type !== 'pointerup') return;
  cam.vx = cam.vy = 0; G.vr = G.vp = 0;
  const [sx, sy] = localXY(e);
  if (viewMode === 'system') { const h = spaceHit(sx, sy); if (h && h.p) openPlanet(h.p.id); return; }
  if (viewMode === 'planet') return;
  const agent = tool === 'inspect' ? pickAgent(sx, sy) : null;
  const city = pickCity(sx, sy);
  const cell = viewMode === 'map' ? mapAt(sx, sy).cell : (globeUnproject(G, sx, sy) || { cell: -1 }).cell;
  if (tool !== 'inspect') { applyTool(city, cell, sx, sy); return; }
  if (agent) selected = { agent };
  else if (city) selected = { city: city.id };
  else if (cell >= 0) selected = { cell };
  else selected = null;
  $('insp')._hold = 0; updateInspector(true);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { $('hoverTip').hidden = true; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const [sx, sy] = localXY(e), f = Math.exp(-e.deltaY * 0.0016);
  if (viewMode === 'map') zoomAt(sx, sy, f);
  else if (viewMode === 'system') sysZoomAt(sx, sy, f);
  else if (viewMode === 'planet') setPlanetZoom(GP.zoom * f);
  else setGlobeZoom(G.zoom * f);
}, { passive: false });
function sysZoomAt(sx, sy, f) {
  const z2 = clamp(sys.z * f, 0.3, 6), k = z2 / sys.z, cx0 = view.w / 2, cy0 = view.h / 2;
  sys.px = sx - cx0 - (sx - cx0 - sys.px) * k; sys.py = sy - cy0 - (sy - cy0 - sys.py) * k; sys.z = z2;
}
function setPlanetZoom(z) { GP.zoom = clamp(z, 0.5, 2.4); }
function spaceHit(sx, sy) {
  const list = viewMode === 'system' ? sysScreen : planetScreen;
  let b = null, bd = 1e9;
  for (const h of list) { const d = Math.hypot(h.x - sx, h.y - sy); if (d < h.r && d < bd) { bd = d; b = h; } }
  return b;
}
function spaceHover(sx, sy) {
  const h = spaceHit(sx, sy), tip = $('hoverTip');
  if (viewMode === 'system') sys.hover = h ? h.p.id : null;
  if (h) { const o = h.c ? ownerOfColony(h.c) : null; tip.hidden = false; tip.textContent = h.p ? `${h.p.name} · 点击查看` : `${h.c.name} · ${o ? o.name : ''} · ${fmtPop(h.c.pop)}`; tip.style.left = sx + 'px'; tip.style.top = sy + 'px'; canvas.style.cursor = h.p ? 'pointer' : ''; }
  else { tip.hidden = true; canvas.style.cursor = ''; }
}
canvas.addEventListener('dblclick', e => { if (viewMode !== 'map') return; const [sx, sy] = localXY(e); zoomAt(sx, sy, 2.2); });
function setGlobeZoom(z) {
  if (z > 2.7) { switchView('map'); return; }
  G.zoom = clamp(z, 0.6, 2.7);
  G.R = Math.min(view.w, view.h) * (view.w < 600 ? 0.42 : 0.36) * G.zoom; G.dirty = true;
}
$('zIn').addEventListener('click', () => { if (viewMode === 'map') zoomAt(view.w / 2, view.h / 2, 1.6); else if (viewMode === 'system') sysZoomAt(view.w / 2, view.h / 2, 1.3); else if (viewMode === 'planet') setPlanetZoom(GP.zoom * 1.25); else setGlobeZoom(G.zoom * 1.25); });
$('zOut').addEventListener('click', () => { if (viewMode === 'map') zoomAt(view.w / 2, view.h / 2, 1 / 1.6); else if (viewMode === 'system') sysZoomAt(view.w / 2, view.h / 2, 1 / 1.3); else if (viewMode === 'planet') setPlanetZoom(GP.zoom / 1.25); else setGlobeZoom(G.zoom / 1.25); });
$('zHome').addEventListener('click', () => { if (viewMode === 'system') { sys.z = 1; sys.px = sys.py = 0; return; } if (viewMode === 'planet') { setView('system'); return; } if (viewMode !== 'map') switchView('map'); cam.goal = { x: cam.x, y: MH / 2 }; cam.tz = zMin(); cam.ax = null; });
miniCv.addEventListener('click', e => {
  const r = miniCv.getBoundingClientRect(), u = globeUnproject(GM, e.clientX - r.left, e.clientY - r.top);
  if (u) flyTo((u.lon + PI) / TAU * MW, (PI / 2 - u.lat) / PI * MH, Math.max(cam.z, zMin() * 2));
});
// one step "back" (Escape, and the Android back key through window.__appBack): closes the topmost open
// thing and returns true, or returns false when nothing was open
function uiBack() {
  if (!$('focusModal').hidden) { $('focusModal').hidden = true; return true; }
  if (modalOpen) return true;                       // event and decision dialogs need an answer
  if (!$('modeSel').hidden) {
    if (!$('modeNations').hidden) { $('modeCards').hidden = false; $('modeNations').hidden = true; return true; }
    if (S && S.modeChosen) { $('modeSel').hidden = true; setPlaying(true); return true; }
    return false;                                   // the start screen: let the app close
  }
  if (tmOpen) { closeTree(); return true; }
  if (mmOpen) { closeMil(); return true; }
  if (document.body.classList.contains('rail-open')) { setRailOpen(false); return true; }
  if (viewMode === 'planet') { setView('system'); return true; }
  if (viewMode === 'system') { setView(spaceReturn); return true; }
  if (!$('popup').hidden) { $('popup').hidden = true; return true; }
  if (diploFrom || attackFrom) { diploFrom = null; attackFrom = null; refreshToolHint(); return true; }
  if (tool !== 'inspect') { setTool('inspect'); return true; }
  if (selected || cam.follow) { selected = null; cam.follow = null; updateInspector(true); return true; }
  if (viewMode === 'globe') { switchView('map'); return true; }
  return false;
}
// the info rail as a slide-in drawer (landscape phones; see the CSS for .rail-open)
function setRailOpen(on) { document.body.classList.toggle('rail-open', on); $('btnRail').setAttribute('aria-expanded', on); }
$('btnRail').addEventListener('click', () => setRailOpen(!document.body.classList.contains('rail-open')));
$('stage').addEventListener('pointerdown', () => { if (document.body.classList.contains('rail-open')) setRailOpen(false); }, true);
// hooks for the Android shell: back key, and save + pause while the app is in the background
let appPausedPlaying = null;
window.__appBack = () => { try { return uiBack(); } catch (e) { return false; } };
window.__appPause = () => {
  try { saveWorld(); lastSave = performance.now(); } catch (e) {}
  try { if (appPausedPlaying === null) { appPausedPlaying = playing; if (playing) setPlaying(false); } } catch (e) {}
};
window.__appResume = () => { try { if (appPausedPlaying) setPlaying(true); } catch (e) {} appPausedPlaying = null; };
// mobile browsers may discard a background tab without warning: save whenever the page is hidden
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveWorld(); lastSave = performance.now(); } });
window.addEventListener('pagehide', () => saveWorld());
window.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  if (e.key === 'Escape') { uiBack(); return; }
  if (tmOpen && !modalOpen && $('focusModal').hidden && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (/^[0-9]$/.test(e.key)) { const k = (+e.key + 9) % 10; if (TECH_CATS[k]) { setTmCat(TECH_CATS[k].id); renderTree(); } e.preventDefault(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { cycleTmCat(e.key === 'ArrowLeft' ? -1 : 1); e.preventDefault(); return; }
  }
  if (tmOpen || modalOpen || !$('modeSel').hidden || !$('focusModal').hidden) return;
  if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); setPlaying(!playing); return; }
  const step = 60;
  if (viewMode === 'map') {
    if (e.key === 'ArrowLeft' || e.key === 'a') { cam.vx = -step * 6 / cam.z; }
    if (e.key === 'ArrowRight' || e.key === 'd') { cam.vx = step * 6 / cam.z; }
    if (e.key === 'ArrowUp' || e.key === 'w') { cam.vy = -step * 6 / cam.z; }
    if (e.key === 'ArrowDown' || e.key === 's') { cam.vy = step * 6 / cam.z; }
    if (e.key === '+' || e.key === '=') zoomAt(view.w / 2, view.h / 2, 1.4);
    if (e.key === '-') zoomAt(view.w / 2, view.h / 2, 1 / 1.4);
  } else {
    if (e.key === 'ArrowLeft' || e.key === 'a') G.vr = 1.2;
    if (e.key === 'ArrowRight' || e.key === 'd') G.vr = -1.2;
    if (e.key === '+' || e.key === '=') setGlobeZoom(G.zoom * 1.2);
    if (e.key === '-') setGlobeZoom(G.zoom / 1.2);
  }
});
window.addEventListener('resize', () => layout());

/* ---------- header & side controls ---------- */
$('btnPlay').addEventListener('click', () => setPlaying(!playing));
$('speedSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  speed = b.dataset.speed === 'auto' ? 'auto' : +b.dataset.speed;
  for (const x of $('speedSeg').children) x.setAttribute('aria-pressed', x === b);
  if (!playing) setPlaying(true);
});
$('viewSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchView(b.dataset.view); });
function onViewChanged() {
  const space = viewMode === 'system' || viewMode === 'planet';
  for (const x of $('viewSeg').children) x.setAttribute('aria-pressed', x.dataset.view === viewMode || (viewMode === 'planet' && x.dataset.view === 'system'));
  $('vSystem').hidden = !(S && S.space && S.space.unlocked);
  $('mini').hidden = viewMode !== 'map';
  $('lSpin').hidden = viewMode !== 'globe';
  $('side').hidden = space;
  $('side').style.top = viewMode === 'map' ? '' : '12px';
  $('toolbar').hidden = space;
  if (space) { $('popup').hidden = true; $('hoverTip').hidden = true; $('insp').hidden = true; }
  $('spacePanel').hidden = !space; $('planetCard').hidden = viewMode !== 'planet';
  $('spaceBack').hidden = !space; $('spaceBack').textContent = viewMode === 'planet' ? '← 返回太阳系' : '← 返回蓝星';
  $('spacePanel')._html = ''; $('planetCard')._html = '';
  renderLegend(); refreshToolHint();
  if (space) renderSpaceUI();
}
$('spaceBack').addEventListener('click', () => { if (viewMode === 'planet') setView('system'); else setView(spaceReturn); });
$('spacePanel').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) openPlanet(b.dataset.p); });
const PLANET_TECH = { moon: 'moonbase', mars: 'marscol', asteroid: 'asteroidmining', outer: 'outercol', venus: 'venusfloat', exo: 'exoplanet' };
function renderSpaceUI() {
  if (!S.space) return;
  const sp = S.space, tot = spacePop();
  const ncol = Object.values(sp.col).reduce((a, l) => a + l.length, 0);
  const homePop = S.cities.reduce((a, c) => a + c.pop, 0);
  const rows = PLANETS.filter(p => p.id !== 'home').map(p => {
    const cols = sp.col[p.id] || [], pop = cols.reduce((a, c) => a + c.pop, 0);
    return `<button data-p="${p.id}"><span class="dotp" style="background:${planetTint(p)}"></span><span>${p.name}${p.inter ? ' · ' + p.dist : ''}</span><span class="mono">${cols.length ? fmtPop(pop) : '—'}</span></button>`;
  }).join('');
  const live = new Set(); for (const k in sp.col) for (const c of sp.col[k]) if (typeof c.n !== 'number') live.add(c.n);
  const facs = sp.factions.filter(f => live.has(f.key));
  const powers = S.nations.filter(n => n.alive && coloniesOf(n.id).length).map(n => [n, coloniesOf(n.id).reduce((a, [, c]) => a + c.pop, 0)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  setHTML($('spacePanel'), `<h3>太阳系</h3><p class="note">${ncol} 个殖民地 · 地外人口 ${fmtPop(tot)} · ${sp.transit.length} 艘飞船在途</p>
    <div class="splist"><button data-p="home"><span class="dotp" style="background:#4a8fe7"></span><span>蓝星</span><span class="mono">${fmtPop(homePop)}</span></button>${rows}</div>
    ${powers.length ? `<h4>太空强国</h4><div class="splist">${powers.map(([n, p]) => `<div class="rrow">${sw(n)}<span>${esc(n.name)}</span><span class="mono">${fmtPop(p)}</span></div>`).join('')}</div>` : ''}
    ${facs.length ? `<h4>独立的星际政权</h4><div class="splist">${facs.map(f => `<div class="rrow"><span class="swatch" style="background:${f.color}"></span><span>${esc(f.name)}</span><span class="mono">${PLANET_BY_ID[f.planet].name}</span></div>`).join('')}</div>` : ''}
    <p class="note">拖动平移，滚轮缩放，点击星球查看。</p>`);
  if (viewMode === 'planet') renderPlanetCard();
}
function renderPlanetCard() {
  const p = PLANET_BY_ID[planetSel]; if (!p) return;
  const sp = S.space, cols = sp.col[p.id] || [], terra = sp.terra[p.id] || 0;
  const reach = S.nations.filter(n => n.alive && planetUnlocked(n, p)).map(n => n.name);
  const tr = sp.transit.filter(t => t.to === p.id), first = sp.firsts[p.id];
  const where = p.inter ? `${p.dist} · 系外行星` : p.parent ? `${PLANET_BY_ID[p.parent].name}的卫星` : `距太阳 ${p.a} 天文单位`;
  const need = p.key && PLANET_TECH[p.key] ? TECH_BY_ID[PLANET_TECH[p.key]].name : '';
  setHTML($('planetCard'), `<h2>${p.name}</h2><div class="meta">${where} · 重力 ${p.g} · ${p.temp}</div>
    <p class="note" style="color:var(--ink-2)">${esc(p.info)}</p>
    ${p.terraform || p.id === 'venus' ? `<h4>行星改造</h4><div class="res"><span class="name">进度</span><span class="track"><span class="fill" style="width:${(terra * 100).toFixed(0)}%;background:var(--leaf)"></span></span><span class="pct">${Math.round(terra * 100)}%</span></div>` : ''}
    <h4>殖民地 · ${cols.length}</h4>
    ${cols.length ? cols.slice().sort((a, b) => b.pop - a.pop).map(c => { const o = ownerOfColony(c); return `<div class="col"><span class="swatch" style="background:${o ? o.color : '#888'}"></span><span>${esc(c.name)}</span><span class="mono">${fmtPop(c.pop)}</span><small>${o ? esc(o.name) : '—'}${typeof c.n !== 'number' ? '（独立政权）' : ''} · 建于${fmtYear(c.born)}</small></div>`; }).join('')
      : `<p class="note">${p.colonizable ? (reach.length ? `${esc(reach.join('、'))}已经能抵达这里。` : `需要科技「${esc(need)}」才能殖民。`) : '这里无法建立永久定居点。'}</p>`}
    ${tr.length ? `<p class="note">${tr.length} 艘殖民船正在途中，最早 ${Math.max(0, Math.min(...tr.map(t => t.arr)) - S.year)} 年后抵达。</p>` : ''}
    ${first && S.nations[first.n] ? `<p class="note">首个殖民地由${esc(S.nations[first.n].name)}于${fmtYear(first.y)}建立。</p>` : ''}`);
}
$('layerSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  layer = +b.dataset.layer;
  for (const x of $('layerSeg').children) x.setAttribute('aria-pressed', x === b);
  recolorAll(); renderLegend();
});
$('tNames').addEventListener('change', e => { showNames = e.target.checked; });
$('tPeople').addEventListener('change', e => { showPeople = e.target.checked; });
$('tSpin').addEventListener('change', e => { autoSpin = e.target.checked; });
let newArmed = 0;
$('btnNew').addEventListener('click', () => {
  const b = $('btnNew');
  if (performance.now() - newArmed > 3000) { newArmed = performance.now(); b.textContent = '确定换一颗？'; setTimeout(() => { b.textContent = '新世界'; }, 3000); return; }
  b.textContent = '新世界'; newArmed = 0;
  bootFresh(openModeOverlay);
});
/* graphics quality selector (reflects automatic step-downs through gfxVersion) and the day/night toggle */
function syncGfxUI() { const el = $('gfxSel'); el.options[0].textContent = GFX.auto ? `自动 · ${GFX_LEVELS[GFX.level].name}` : '自动'; el.value = GFX.auto ? 'auto' : String(GFX.level); el._v = gfxVersion; }
$('gfxSel').addEventListener('change', e => { const v = e.target.value; if (v === 'auto') setGfx(GFX.auto ? GFX.level : 3, true); else setGfx(+v, false); syncGfxUI(); e.target.blur(); });
$('tDayNight').addEventListener('change', e => { showDayNight = e.target.checked; try { localStorage.setItem('blue-planet-daynight', showDayNight ? '1' : '0'); } catch (err) {} });
function loadDayNight() { try { const v = localStorage.getItem('blue-planet-daynight'); if (v !== null) showDayNight = v === '1'; } catch (e) {} $('tDayNight').checked = showDayNight; }
function loadSplash(on, msg) {
  const el = $('splash'); if (!el) return;
  if (on) { $('splashMsg').textContent = msg || '正在生成星球…'; el.hidden = false; el.classList.remove('gone'); return; }
  el.classList.add('gone'); setTimeout(() => { if (el.classList.contains('gone')) el.hidden = true; }, 400);
}
// regenerate behind the splash: give the browser one frame to paint it first
function bootFresh(after) { loadSplash(true, '正在生成新的星球…'); setTimeout(() => { boot({ seed: (Math.random() * 1e9) | 0 }); saveWorld(); loadSplash(false); if (after) after(); }, 40); }
function switchTab(k) {
  activeTab = k;
  for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-selected', x.dataset.tab === k);
  for (const p of ['me', 'ov', 'nat', 'game', 'tech', 'log', 'ach']) $('pane-' + p).hidden = p !== k;
  $('pane-me')._html = ''; $('pane-game')._html = '';
  renderedLogVersion = -1; renderedAch = -1; $('natList')._html = ''; $('techPane')._html = '';
  updatePanels();
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });
$('modeCancel').addEventListener('click', () => { $('modeSel').hidden = true; setPlaying(true); });

/* =====================================================================
   Save, snapshot, boot
   ===================================================================== */
const SAVE_KEY = 'blue-planet-world-v2';
function serialize() {
  const sparse = a => { const out = []; for (let i = 0; i < a.length; i++) if (a[i] > 0) out.push(i, Math.round(a[i] * 10) / 10); return out; };
  const res = {}; for (const r of RES) res[r] = sparse(S.res[r]);
  return {
    v: 4, seed: S.seed, year: S.year, tick: S.tick, rng: S.rng, co2: S.co2, tanom: S.tanom, seaRise: S.seaRise, co2Peak: S.co2Peak,
    cities: S.cities.map(c => { const { lay, ...r } = c; return r; }), wars: S.wars.map(w => { const { th, ...r } = w; return r; }), milDoc: S.milDoc || {}, milPref: S.milPref || {}, orders: S.orders, log: S.log.slice(0, 250), history: S.history, firsts: S.firsts, names: S.names, flags: S.flags,
    nations: S.nations.map(n => { const { mult, dep, cl, ...rest } = n; if (rest.mx) { const { F, ...mx } = rest.mx; rest.mx = mx; } return rest; }),
    forest: Array.from(S.forest, v => Math.round(v * 100) / 100), res, resLeft: S.resLeft,
    nextCity: S.nextCity, nextOrder: S.nextOrder, sats: S.sats, orbital: S.orbital, orbPop: S.orbPop, ships: S.ships, moon: S.moon, moonDue: S.moonDue, moonBy: S.moonBy,
    forestFrac: S.forestFrac, lastShip: S.lastShip, terra: S.terra, stats: S.stats,
    doct: S.doct, aiFeed: (S.aiFeed || []).slice(0, 40), rails: S.rails, mode: S.mode, player: S.player, trust: S.trust, gcd: S.gcd, games: S.games.slice(0, 40), ideoWorld: S.ideoWorld, realmCount: S.realmCount, modeChosen: S.modeChosen,
    space: Object.assign({}, S.space, { battles: [] }),
    ui: { layer, speed, playing, cam: { x: cam.x, y: cam.y, z: cam.z }, viewMode },
  };
}
function deserialize(d) {
  WORLD = genWorld(d.seed);
  S = {
    v: d.v || 3, milDoc: d.milDoc || {}, milPref: d.milPref || {}, seed: d.seed, year: d.year, tick: d.tick, rng: d.rng, co2: d.co2, tanom: d.tanom, seaRise: d.seaRise, co2Peak: d.co2Peak,
    cities: d.cities, wars: d.wars || [], orders: d.orders || [], log: d.log || [], history: d.history || [], firsts: d.firsts || {}, names: d.names || {}, flags: d.flags || { maxEra: 0 },
    nations: d.nations.map(n => { n.mult = null; n.dep = { coal: [], oil: [], iron: [], uran: [], rare: [] }; n.cl = []; n.allies = n.allies || []; n.legions = n.legions || 0; return n; }),
    forest: Float32Array.from(d.forest), res: {}, owner: new Int16Array(N).fill(-1), cityOf: new Int16Array(N).fill(-1),
    farm: new Float32Array(N), smog: new Float32Array(N), resLeft: d.resLeft,
    nextCity: d.nextCity, nextOrder: d.nextOrder || 1, sats: d.sats, orbital: d.orbital, orbPop: d.orbPop, ships: d.ships, moon: d.moon, moonDue: d.moonDue, moonBy: d.moonBy,
    forestFrac: d.forestFrac, deforest: 0, terrDirty: true, borders: [], lastShip: d.lastShip, terra: [], stats: Object.assign({ blessed: [], landMade: 0, lastWarYear: d.year, maxWarNations: 0, impact: 0, conquer: 0, seeds: 0 }, d.stats || {}),
    doct: d.doct || {}, aiFeed: d.aiFeed || [], rails: d.rails || {}, mode: d.mode || 'god', player: d.player || null, trust: d.trust || {}, gcd: d.gcd || {}, games: d.games || [], ideoWorld: d.ideoWorld || {}, realmCount: d.realmCount || 0, modeChosen: !!d.modeChosen,
    space: Object.assign({ col: {}, terra: {}, transit: [], factions: [], battles: [], firsts: {}, unlocked: false }, d.space || {}, { battles: [] }),
  };
  if (S.mode === 'leader' && (!S.player || !S.nations[S.player.n])) { S.mode = 'god'; S.player = null; }
  for (const id in S.firsts) if (!TECH_BY_ID[id]) delete S.firsts[id];
  for (const n of S.nations) {
    for (const id in n.techs) if (!TECH_BY_ID[id]) delete n.techs[id];
    if (n.target && !TECH_BY_ID[n.target]) n.target = null;
    if (!n.ideo) {
      initIdeology(n, null);
      n.mult = computeMult(n);
      const best = ideoAvailable(n).sort((a, b) => b.fit[n.mult.era] - a.fit[n.mult.era])[0];
      if (best) { n.ideo = best.id; n.sup = { [best.id]: 1 }; }
    }
    n.bonus = n.bonus || {}; n.trade = n.trade || {}; n.nap = n.nap || {}; n.claims = n.claims || {};
    if (n.overlord === undefined) n.overlord = -1;
  }
  for (const w of S.wars) { w.caps = w.caps || [0, 0]; w.vis = w.vis || [0, 0]; }
  for (const [ci, k] of d.terra || []) { terraform(ci, TERRA_KIND[k], true, true); S.terra.push([ci, k]); }
  for (const n of S.nations) n.mult = computeMult(n);
  migrateMil(S);   // v2/v3 saves: military state, research track and doctrine conflicts (idempotent for v4)
  for (const r of RES) { const a = new Float32Array(N); const s = d.res[r]; for (let k = 0; k < s.length; k += 2) a[s[k]] = s[k + 1]; S.res[r] = a; }
}
function saveWorld() { if (!S || booting) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize())); } catch (e) {} }
function loadWorld() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
document.addEventListener('visibilitychange', () => { if (document.hidden) saveWorld(); });

function boot(data) {
  booting = true;
  let restored = false;
  if (data && (data.v === 2 || data.v === 3 || data.v === 4)) { try { deserialize(data); restored = true; } catch (err) { console.warn(err); restored = false; } }
  if (!restored) newState(data && data.seed ? data.seed : ((Math.random() * 1e9) | 0));
  HSEED = Math.imul(S.seed | 0, 2654435761) | 0;
  buildGlobalDep();
  lastRiseDrawn = S.seaRise; lastTanomDrawn = S.tanom;
  S.flags.maxEra = S.flags.maxEra || 0;
  territory();
  if (!restored) for (let k = 0; k < 60; k++) tick();
  territory();
  recolorAll(); paintMapAll(); buildLights();
  booting = false;
  selected = null; selectedNation = -1; expandedNation = -1; diploFrom = null; attackFrom = null; cam.follow = null; cam.goal = null;
  FX.length = 0; PARTS.length = 0; AG.length = 0; SHIPS.length = 0; TRACERS.length = 0; PROJ.length = 0; BATTLES.length = 0;
  MQ.length = 0; modalOpen = false; resumeAfterModal = false; $('evModal').hidden = true; $('focusModal').hidden = true; fSel = null; decisionTarget = -1;
  for (const k in PTEX) delete PTEX[k];
  planetSel = null; sys.z = 1; sys.px = sys.py = 0;
  for (const c of S.cities) c.lay = null;
  $('seedLabel').textContent = S.seed;
  viewMode = 'map';
  layout();
  const ui = restored && data.ui;
  if (ui) {
    layer = ui.layer || 0; speed = ui.speed || 'auto';
    for (const x of $('layerSeg').children) x.setAttribute('aria-pressed', +x.dataset.layer === layer);
    for (const x of $('speedSeg').children) x.setAttribute('aria-pressed', String(x.dataset.speed) === String(speed));
    if (layer) recolorAll();
    if (ui.cam) centerOn(ui.cam.x, ui.cam.y, ui.cam.z);
    setPlaying(ui.playing !== false);
  } else { centerOn(MW / 2, MH / 2, zMin()); setPlaying(true); }
  applyModeUI();
  if (activeTab === 'me' && S.mode !== 'leader') switchTab('ov');
  onViewChanged();
  renderLegend(); updateHeader();
  techVersion++; logVersion++; achVersion++;
  $('natList')._html = ''; $('techPane')._html = '';
  updatePanels();
  return restored;
}
function start(data) {
  readCss(); loadGfx(); loadDayNight(); loadAch(); buildToolbar(); refreshToolHint();
  const snap = data && data.state ? data.state : null;
  const restored = boot(snap || loadWorld());
  if (restored && !snap) showTicker('civ', '已恢复你上次的世界');
  window.claude?.hot?.snapshot?.(() => ({ state: serialize() }));
  let seen = false; try { seen = !!localStorage.getItem('blue-planet-intro'); } catch (e) {}
  if (!snap && (!seen || !restored)) openModeOverlay();
  syncGfxUI(); loadSplash(false);
  requestAnimationFrame(t => { lastT = t; requestAnimationFrame(frame); });
}

window.__earth = { api: { startWar, makePeace, formAlliance, orderAttack, godSeed, godCity, meteor, quake, volcano, terraform, splitFrom, godGrantTech, openTree, nationAction }, get S() { return S; }, tick: n => { for (let k = 0; k < n; k++) tick(); }, serialize, newWorld: seed => boot({ seed }), cam, AG, flyTo, setTool, applyTool, switchView, setView, openPlanet, setMode, playGame, gameTick, startCivilWar, setIdeology, queueModal, get modalOpen() { return modalOpen; }, BATTLES, PROJ, aiTick, doctrineTick, get sys() { return sys; }, GFX, setGfx, get perfMs() { return perfMs; }, get viewMode() { return viewMode; } };

if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
})();
</script>
</body>
</html>
