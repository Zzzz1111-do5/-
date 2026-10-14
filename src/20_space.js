/* =====================================================================
   Space: the solar system, colonies, terraforming, colony independence
   ===================================================================== */
const PLANETS = [
  { id: 'mercury', name: '水星', type: 'mercury', a: 0.39, period: 0.24, vr: 3, ph: 0.4, col: '#a4a09a', cap: 0, info: '离太阳最近的岩石行星，白天 430 °C，夜晚 -180 °C。', g: '0.38 g', temp: '167 °C' },
  { id: 'venus', name: '金星', type: 'venus', a: 0.72, period: 0.62, vr: 5, ph: 2.1, col: '#e3c27a', cap: 6e6, colonizable: 1, key: 'venus', info: '浓密的二氧化碳大气与硫酸云，地表温度足以熔化铅。人类只能住在 50 公里高空的浮空城里。', g: '0.90 g', temp: '464 °C' },
  { id: 'home', name: '蓝星', type: 'home', a: 1.0, period: 1, vr: 5.6, ph: 0, col: '#4a8fe7', cap: 0, info: '人类的故乡。', g: '1.00 g', temp: '15 °C' },
  { id: 'moon', name: '月球', type: 'moon', parent: 'home', mr: 1.6, period: 0.075, vr: 1.8, ph: 1, col: '#c9c9c4', cap: 8e5, colonizable: 1, key: 'moon', info: '没有大气的卫星，适合建造低重力船坞与射电望远镜。', g: '0.17 g', temp: '-20 °C' },
  { id: 'mars', name: '火星', type: 'mars', a: 1.52, period: 1.88, vr: 4, ph: 4.2, col: '#c4623e', cap: 3e6, colonizable: 1, key: 'mars', terraform: 1, info: '寒冷干燥的红色星球。改造后，它可能重新拥有河流与海洋。', g: '0.38 g', temp: '-63 °C' },
  { id: 'ceres', name: '谷神星', type: 'ceres', a: 2.77, period: 4.6, vr: 2, ph: 5.3, col: '#8a867e', cap: 4e5, colonizable: 1, key: 'asteroid', info: '小行星带中最大的天体，冰与矿产丰富，是太空采矿的中心。', g: '0.03 g', temp: '-105 °C' },
  { id: 'jupiter', name: '木星', type: 'jupiter', a: 5.2, period: 11.86, vr: 12, ph: 0.9, col: '#d8b48a', cap: 0, info: '太阳系最大的气态巨行星，大红斑是一场持续数百年的风暴。', g: '2.53 g', temp: '-110 °C' },
  { id: 'europa', name: '木卫二', type: 'europa', parent: 'jupiter', mr: 1.6, period: 0.06, vr: 2, ph: 2, col: '#ddd2bb', cap: 1.5e6, colonizable: 1, key: 'outer', info: '冰壳之下是比蓝星所有海洋加起来还多的液态水。', g: '0.13 g', temp: '-160 °C' },
  { id: 'ganymede', name: '木卫三', type: 'ganymede', parent: 'jupiter', mr: 2.2, period: 0.11, vr: 2.4, ph: 4, col: '#9a8f80', cap: 1.2e6, colonizable: 1, key: 'outer', info: '太阳系最大的卫星，拥有自己的磁场。', g: '0.15 g', temp: '-163 °C' },
  { id: 'saturn', name: '土星', type: 'saturn', a: 9.54, period: 29.5, vr: 10, ph: 3.3, col: '#e3cf9a', cap: 0, rings: 1, info: '拥有壮丽光环的气态巨行星。', g: '1.07 g', temp: '-140 °C' },
  { id: 'titan', name: '土卫六', type: 'titan', parent: 'saturn', mr: 2, period: 0.09, vr: 2.4, ph: 1.5, col: '#d69a3c', cap: 3e6, colonizable: 1, key: 'outer', info: '浓厚的橙色大气下有甲烷湖泊与河流，穿上保暖服就能在户外行走。', g: '0.14 g', temp: '-179 °C' },
  { id: 'uranus', name: '天王星', type: 'uranus', a: 19.2, period: 84, vr: 7.5, ph: 5.9, col: '#9fd8df', cap: 0, info: '横躺着自转的冰巨星。', g: '0.89 g', temp: '-195 °C' },
  { id: 'neptune', name: '海王星', type: 'neptune', a: 30, period: 165, vr: 7.5, ph: 2.6, col: '#3d63d6', cap: 0, info: '太阳系最外侧的行星，风速可达每小时 2000 公里。', g: '1.14 g', temp: '-200 °C' },
  { id: 'proxima', name: '比邻星 b', type: 'exo', inter: 1, dist: '4.2 光年', col: '#7b3f6e', cap: 4e8, colonizable: 1, key: 'exo', info: '离太阳最近的恒星的宜居带行星。紫红色的植物吸收着红矮星的光。', g: '1.1 g', temp: '-39 °C' },
  { id: 'trappist', name: '特拉比斯特-1e', type: 'exo2', inter: 1, dist: '40 光年', col: '#2f8f86', cap: 5e8, colonizable: 1, key: 'exo', info: '七颗行星围绕一颗暗淡红矮星，其中这一颗有海洋。', g: '0.93 g', temp: '-22 °C' },
];
const PLANET_BY_ID = Object.fromEntries(PLANETS.map(p => [p.id, p]));
const COLONY_SYL = ['新', '星', '曙光', '远望', '希望', '开拓', '方舟', '黎明', '天穹', '深空'];
function colonyName(p) { return uniqueName(() => pick(COLONY_SYL) + pick(SYL) + pick(['城', '站', '港', '基地', '穹顶'])); }
function planetUnlocked(n, p) { return !!(p.key && n.mult[p.key]); }
function travelYears(p, n) { const base = p.inter ? (p.id === 'trappist' ? 120 : 60) : p.id === 'moon' ? 1 : p.a < 2 ? 2 : p.a < 6 ? 4 : 6; return Math.max(1, Math.round(base / (n.mult.shipK || 1))); }
function ownerOfColony(c) { return typeof c.n === 'number' ? S.nations[c.n] : S.space.factions[+String(c.n).slice(1)]; }
function spacePop() { let p = 0; if (!S.space) return 0; for (const k in S.space.col) for (const c of S.space.col[k]) p += c.pop; return p; }
function coloniesOf(nid) { const out = []; for (const k in S.space.col) for (const c of S.space.col[k]) if (c.n === nid) out.push([k, c]); return out; }
function newFaction(pid, c, parent) {
  const p = PLANET_BY_ID[pid], idx = S.space.factions.length;
  const ideo = parent ? (parent.mult.era >= 7 && rand() < 0.5 ? 'transhuman' : parent.ideo) : 'cosmo';
  const name = uniqueName(() => p.name.replace(/ .*/, '') + pick(['共和国', '自由邦', '联合体', '公社']));
  const f = { key: 'f' + idx, idx, name, color: NATION_COLORS[(idx * 5 + 3) % NATION_COLORS.length], ideo, planet: pid, born: S.year, parent: parent ? parent.id : -1 };
  S.space.factions.push(f);
  S.space.battles.push({ p: pid, t0: animT });
  return f;
}
function terraText(pid, th) {
  if (pid === 'mars') return th < 0.5 ? '火星的大气变厚，第一场雨落在了红色的土地上' : th < 0.75 ? '火星北半球出现了第一片海洋' : th < 1 ? '火星的平原上长出了成片的森林' : '火星改造完成：一颗新的蓝绿色星球诞生了';
  return th < 0.5 ? '金星的酸云开始消散' : th < 1 ? '金星的气温降到 100 °C 以下，地表第一次出现液态水' : '金星改造完成，人类可以在地面上行走了';
}
function spaceColTick() {
  const sp = S.space;
  if (!sp.unlocked && S.nations.some(n => n.alive && n.mult.moon)) { sp.unlocked = true; if (!booting) showBanner('太阳系视角已解锁', '点击顶部的「太阳系」，看看人类在群星间的足迹'); onSpaceUnlocked(); }
  for (const n of S.nations) {
    if (!n.alive || !n.mult.space || n.overlord >= 0) continue;
    for (const p of PLANETS) {
      if (!p.colonizable || !planetUnlocked(n, p)) continue;
      if (sp.transit.some(t => t.n === n.id && t.to === p.id)) continue;
      const has = (sp.col[p.id] || []).some(c => c.n === n.id);
      const k = 1 + (n.bonus.space || 0);
      const ch = (p.inter ? 0.012 : 0.04) * Math.pow(Math.max(n.st.pop, 1e6) / 5e8, 0.3) * k * (has ? 0.45 : 1) * (n.eco ? n.eco.K.space : 1);
      if (rand() < ch) sp.transit.push({ n: n.id, to: p.id, dep: S.year, arr: S.year + travelYears(p, n), pop: p.inter ? 60000 : 5000 + rand() * 15000, c: n.color });
    }
  }
  for (let k = sp.transit.length - 1; k >= 0; k--) {
    const t = sp.transit[k];
    if (S.year < t.arr) continue;
    sp.transit.splice(k, 1);
    const n = S.nations[t.n], p = PLANET_BY_ID[t.to];
    if (!n || !n.alive) continue;
    const list = sp.col[p.id] = sp.col[p.id] || [];
    let c = list.find(c => c.n === n.id);
    if (c) c.pop += t.pop;
    else {
      c = { n: n.id, pop: t.pop, born: S.year, name: colonyName(p), lat: (rand() - 0.5) * 1.5, lon: rand() * TAU - PI };
      list.push(c);
      if (!sp.firsts[p.id]) { sp.firsts[p.id] = { n: n.id, y: S.year }; log('space', `${n.name}在${p.name}建立了第一个殖民地「${c.name}」`, capitalCell(n), true); if (p.inter) showBanner('另一颗太阳', `${n.name}的方舟抵达${p.name}`); }
      planetTexDirty(p.id);
    }
  }
  for (const pid in sp.col) {
    const p = PLANET_BY_ID[pid], list = sp.col[pid];
    for (const c of list) {
      const o = ownerOfColony(c), m = o && o.mult;
      const K = p.cap * (1 + 8 * (sp.terra[pid] || 0)) * (m ? 1 + (m.fusion ? 0.6 : 0) + (m.nanotech ? 0.6 : 0) + (m.xeno ? 0.5 : 0) : 1.6);
      c.pop += 0.04 * c.pop * (1 - c.pop / Math.max(K, 1e4));
      if (m && typeof c.n === 'number' && o.target) o.research += c.pop / 1e6 * 3;
    }
    if (p.terraform || pid === 'venus') {
      if (list.some(c => { const o = ownerOfColony(c); return o && o.mult && o.mult.terra2; })) {
        const before = sp.terra[pid] || 0;
        sp.terra[pid] = Math.min(1, before + 0.0022 * Math.min(3, list.length));
        for (const th of [0.25, 0.5, 0.75, 1]) if (before < th && sp.terra[pid] >= th) log('space', terraText(pid, th), -1, th >= 0.5);
        if (Math.floor(before * 30) !== Math.floor(sp.terra[pid] * 30)) planetTexDirty(pid);
      }
    }
  }
  if (S.tick % 5 === 0) for (const pid in sp.col) for (const c of sp.col[pid]) {
    if (typeof c.n !== 'number') continue;
    const n = S.nations[c.n];
    if (!n || !n.alive) { const f = newFaction(pid, c, null); c.n = f.key; log('space', `母国覆灭后，${PLANET_BY_ID[pid].name}的「${c.name}」成立了「${f.name}」`, -1, true); continue; }
    if (c.pop < 2e6) continue;
    const p = PLANET_BY_ID[pid];
    if (rand() < 0.004 * (p.inter ? 3 : p.a > 3 ? 2 : 1) * (1.25 - n.stabV)) { const f = newFaction(pid, c, n); c.n = f.key; log('space', `${p.name}的殖民地「${c.name}」宣布脱离${n.name}独立，建立「${f.name}」`, -1, true); S.stats.spaceIndep = (S.stats.spaceIndep || 0) + 1; }
  }
  if (sp.col.ceres && S.tick % 10 === 0) for (const r of ['iron', 'rare']) {
    const g = GLOBAL_DEP[r]; if (!g.length) continue;
    const amt = WORLD.resTotal[r] * 0.0015 * sp.col.ceres.length;
    for (let k = 0; k < 5; k++) { const i = g[(rand() * g.length) | 0]; S.res[r][i] += amt / 5; }
    S.resLeft[r] += amt;
  }
}

/* ---------- solar system view ---------- */
const sys = { z: 1, px: 0, py: 0, hover: null };
let planetSel = null;
const BELT = Array.from({ length: 520 }, (_, k) => { const r = mulberry32(k * 31 + 7); return { a: 2.15 + r() * 1.15, ph: r() * TAU, s: r(), e: (r() - 0.5) * 0.1 }; });
const KUIPER = Array.from({ length: 260 }, (_, k) => { const r = mulberry32(k * 53 + 11); return { a: 33 + r() * 14, ph: r() * TAU, s: r() }; });
function sysT() { return animT / 40; }
function sysR(a) { return Math.pow(a, 0.5) * 88 * sys.z; }
function sysPos(p, t) {
  if (p.parent) {
    const pp = sysPos(PLANET_BY_ID[p.parent], t), par = PLANET_BY_ID[p.parent];
    const ang = TAU * t / p.period + p.ph, r = (par.vr + 4 + p.mr * 4) * Math.max(0.6, sys.z);
    return { x: pp.x + Math.cos(ang) * r, y: pp.y + Math.sin(ang) * r * 0.55, z: Math.sin(ang) };
  }
  const ang = TAU * t / p.period + p.ph, r = sysR(p.a);
  return { x: view.w / 2 + sys.px + Math.cos(ang) * r, y: view.h / 2 + sys.py + Math.sin(ang) * r * 0.55, z: Math.sin(ang) };
}
function planetTint(p) {
  const t = S.space.terra[p.id] || 0;
  if (p.id === 'mars' && t > 0) return mixHex('#c4623e', '#4f9a6a', t);
  if (p.id === 'venus' && t > 0) return mixHex('#e3c27a', '#6fa0d8', t);
  return p.col;
}
function mixHex(a, b, t) { const A = hexRgb(a), Bc = hexRgb(b); return `rgb(${Math.round(A[0] + (Bc[0] - A[0]) * t)},${Math.round(A[1] + (Bc[1] - A[1]) * t)},${Math.round(A[2] + (Bc[2] - A[2]) * t)})`; }
let sysScreen = [];
function drawSystemScene() {
  const sw = view.w, sh = view.h, t = sysT();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = '#04060d'; ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(starCanvas, 0, 0, sw, sh);
  const cx = sw / 2 + sys.px, cy = sh / 2 + sys.py;
  // kuiper belt and asteroid belt
  ctx.fillStyle = 'rgba(160,170,190,.35)';
  for (const b of KUIPER) { const ang = b.ph + t * TAU / 300, r = sysR(b.a); const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r * 0.55; if (x > -5 && x < sw + 5 && y > -5 && y < sh + 5) ctx.fillRect(x, y, 1, 1); }
  for (const b of BELT) { const ang = b.ph + t * TAU / Math.pow(b.a, 1.5), r = sysR(b.a + b.e); const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r * 0.55; ctx.fillStyle = `rgba(170,160,140,${0.25 + b.s * 0.45})`; ctx.fillRect(x, y, b.s > 0.85 ? 1.6 : 1, b.s > 0.85 ? 1.6 : 1); }
  // orbits
  ctx.lineWidth = 1;
  for (const p of PLANETS) { if (p.parent || p.inter) continue; const r = sysR(p.a); ctx.strokeStyle = p.id === 'home' ? 'rgba(92,196,230,.35)' : 'rgba(140,170,220,.16)'; ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.55, 0, 0, TAU); ctx.stroke(); }
  // sun
  const sr = 16 * Math.max(0.7, sys.z);
  const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, sr * 5);
  sg.addColorStop(0, 'rgba(255,244,214,1)'); sg.addColorStop(0.18, 'rgba(255,206,110,.95)'); sg.addColorStop(0.4, 'rgba(255,150,60,.25)'); sg.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, sr * 5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff6dc'; ctx.beginPath(); ctx.arc(cx, cy, sr, 0, TAU); ctx.fill();
  // planets sorted by depth
  sysScreen = [];
  const list = PLANETS.filter(p => !p.inter).map(p => ({ p, pos: sysPos(p, t) })).sort((a, b) => a.pos.y - b.pos.y);
  for (const { p, pos } of list) {
    const r = Math.max(1.5, p.vr * Math.max(0.6, Math.sqrt(sys.z)));
    const col = planetTint(p);
    if (p.rings) { ctx.strokeStyle = 'rgba(226,206,150,.55)'; ctx.lineWidth = r * 0.35; ctx.beginPath(); ctx.ellipse(pos.x, pos.y, r * 2.1, r * 0.7, -0.35, PI, TAU); ctx.stroke(); }
    const dx = cx - pos.x, dy = cy - pos.y, dl = Math.hypot(dx, dy) || 1;
    const g = ctx.createRadialGradient(pos.x + dx / dl * r * 0.5, pos.y + dy / dl * r * 0.5, r * 0.1, pos.x, pos.y, r * 1.05);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(10,12,20,1)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, TAU); ctx.fill();
    if (p.rings) { ctx.strokeStyle = 'rgba(226,206,150,.75)'; ctx.lineWidth = r * 0.35; ctx.beginPath(); ctx.ellipse(pos.x, pos.y, r * 2.1, r * 0.7, -0.35, 0, PI); ctx.stroke(); }
    if (p.id === 'home') { ctx.strokeStyle = 'rgba(92,196,230,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(pos.x, pos.y, r + 4, 0, TAU); ctx.stroke(); }
    const cols = S.space.col[p.id] || [];
    cols.forEach((c, k) => { const o = ownerOfColony(c); if (!o) return; const a = k / Math.max(1, cols.length) * TAU + animT * 0.3; ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(pos.x + Math.cos(a) * (r + 5), pos.y + Math.sin(a) * (r + 5), 2.4, 0, TAU); ctx.fill(); });
    sysScreen.push({ p, x: pos.x, y: pos.y, r: Math.max(r + 6, 10) });
    if (sys.z > 0.55 || !p.parent) {
      ctx.font = `${p.parent ? 10 : 12}px ${CSSV.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const pop = cols.reduce((s, c) => s + c.pop, 0);
      const label = p.name + (cols.length ? ` · ${fmtPop(pop)}` : '');
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,6,13,.85)'; ctx.strokeText(label, pos.x, pos.y + r + 7);
      ctx.fillStyle = sys.hover === p.id ? CSSV['--sodium'] : cols.length ? '#e9eef8' : 'rgba(166,179,204,.85)'; ctx.fillText(label, pos.x, pos.y + r + 7);
      ctx.textAlign = 'left';
    }
  }
  // ships in transit
  const home = sysPos(PLANET_BY_ID.home, t);
  for (const tr of S.space.transit) {
    const p = PLANET_BY_ID[tr.to];
    const f = clamp((S.year + budget - tr.dep) / Math.max(0.5, tr.arr - tr.dep), 0, 1);
    let x, y;
    if (p.inter) { const ex = sw - 30, ey = 40 + (p.id === 'trappist' ? 30 : 0); x = home.x + (ex - home.x) * f; y = home.y + (ey - home.y) * f; }
    else { const tp = sysPos(p, t), mx = (home.x + tp.x) / 2 - (tp.y - home.y) * 0.25, my = (home.y + tp.y) / 2 + (tp.x - home.x) * 0.25; const it = 1 - f; x = it * it * home.x + 2 * it * f * mx + f * f * tp.x; y = it * it * home.y + 2 * it * f * my + f * f * tp.y; }
    ctx.fillStyle = tr.c || '#fff'; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,210,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - (x - home.x) * 0.08, y - (y - home.y) * 0.08); ctx.stroke();
  }
  // independence battles
  for (let k = S.space.battles.length - 1; k >= 0; k--) {
    const b = S.space.battles[k], age = (animT - b.t0) / 6;
    if (age > 1) { S.space.battles.splice(k, 1); continue; }
    const p = PLANET_BY_ID[b.p]; if (!p || p.inter) continue;
    const pos = sysPos(p, t);
    for (let j = 0; j < 4; j++) { const a = animT * 3 + j * 1.6; ctx.fillStyle = `rgba(255,${180 + j * 15},90,${1 - age})`; ctx.fillRect(pos.x + Math.cos(a) * (p.vr + 12), pos.y + Math.sin(a) * (p.vr + 8), 2, 2); }
    ctx.strokeStyle = `rgba(255,95,107,${1 - age})`; ctx.beginPath(); ctx.arc(pos.x, pos.y, p.vr + 10 + age * 20, 0, TAU); ctx.stroke();
  }
  // interstellar targets
  const known = S.nations.some(n => n.alive && n.mult.warp) || PLANETS.some(p => p.inter && S.space.col[p.id]);
  if (known) {
    let y = 30;
    for (const p of PLANETS.filter(p => p.inter)) {
      const cols = S.space.col[p.id] || [];
      ctx.fillStyle = 'rgba(11,19,36,.85)'; ctx.fillRect(sw - 190, y - 16, 176, 30);
      ctx.fillStyle = planetTint(p); ctx.beginPath(); ctx.arc(sw - 174, y - 1, 7, 0, TAU); ctx.fill();
      ctx.font = `12px ${CSSV.font}`; ctx.fillStyle = '#e9eef8'; ctx.textBaseline = 'middle';
      ctx.fillText(`${p.name} · ${p.dist}`, sw - 160, y - 5);
      ctx.fillStyle = 'rgba(166,179,204,.9)'; ctx.font = `11px ${CSSV.font}`;
      ctx.fillText(cols.length ? `${cols.length} 个殖民地 · ${fmtPop(cols.reduce((s, c) => s + c.pop, 0))}` : '尚无人类定居', sw - 160, y + 8);
      sysScreen.push({ p, x: sw - 174, y: y - 1, r: 16 });
      y += 38;
    }
  }
}

/* ---------- planet close-up ---------- */
const GP = makeGlobe(220000);
GP.zoom = 1; GP.pitch = 0.25; GP.rot = 0;
const PTEX = {};
const PTW = 512, PTH = 256;
function planetTexDirty(pid) { if (PTEX[pid]) PTEX[pid].dirty = true; }
function planetTexture(p) {
  let tx = PTEX[p.id];
  if (tx && !tx.dirty) return tx;
  if (!tx) {
    const rnd = mulberry32((p.id.charCodeAt(0) * 7919 + p.id.length * 131) | 0);
    const n1 = makeNoise(rnd), n2 = makeNoise(rnd), n3 = makeNoise(rnd);
    const el = new Float32Array(PTW * PTH), v2 = new Float32Array(PTW * PTH);
    for (let y = 0; y < PTH; y++) {
      const lat = PI / 2 - (y + 0.5) / PTH * PI, cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < PTW; x++) {
        const lon = (x + 0.5) / PTW * TAU - PI, X = cl * Math.cos(lon), Y = sl, Z = cl * Math.sin(lon), i = y * PTW + x;
        el[i] = fbm(n1, X * 2 + 3, Y * 2, Z * 2, 6);
        v2[i] = p.type === 'jupiter' || p.type === 'saturn' || p.type === 'venus' || p.type === 'uranus' || p.type === 'neptune' || p.type === 'titan'
          ? fbm(n2, X * 2.5, Y * 9, Z * 2.5, 4) : fbm(n2, X * 6, Y * 6, Z * 6, 3);
      }
    }
    const craters = [];
    if (['mercury', 'moon', 'ceres', 'ganymede'].includes(p.type)) for (let k = 0; k < 90; k++) craters.push({ lat: Math.asin(rnd() * 2 - 1), lon: rnd() * TAU - PI, r: 0.02 + Math.pow(rnd(), 3) * 0.18 });
    tx = PTEX[p.id] = { w: PTW, h: PTH, col: new Uint8ClampedArray(PTW * PTH * 3), lights: new Float32Array(PTW * PTH), el, v2, craters, n3 };
  }
  paintPlanet(p, tx);
  tx.dirty = false;
  return tx;
}
function paintPlanet(p, tx) {
  const { el, v2, craters, col } = tx;
  const terra = S.space.terra[p.id] || 0;
  for (let y = 0; y < PTH; y++) {
    const lat = PI / 2 - (y + 0.5) / PTH * PI, alat = Math.abs(lat);
    for (let x = 0; x < PTW; x++) {
      const i = y * PTW + x, e = el[i], v = v2[i];
      const lon = (x + 0.5) / PTW * TAU - PI;
      let r = 128, g = 128, b = 128;
      switch (p.type) {
        case 'mercury': { const s = 120 + e * 90 + v * 20; r = s; g = s * 0.96; b = s * 0.9; break; }
        case 'moon': { let s = 178 + e * 50 + v * 15; if (e < -0.12) s -= 55; r = s; g = s; b = s * 0.98; break; }
        case 'ceres': case 'ganymede': { let s = (p.type === 'ceres' ? 105 : 130) + e * 60 + v * 25; r = s * 1.02; g = s * 0.97; b = s * 0.9; if (p.type === 'ganymede' && v > 0.12) { r += 30; g += 28; b += 24; } break; }
        case 'mars': {
          const sea = -0.45 + terra * 0.5;
          r = 176 + e * 70; g = 86 + e * 40; b = 52 + e * 25;
          if (v > 0.18) { r *= 0.62; g *= 0.6; b *= 0.62; }
          if (terra > 0 && e > sea) { const k = clamp(terra * 1.4 - (e - sea) * 1.2, 0, 0.85); r += (78 - r) * k; g += (140 - g) * k; b += (72 - b) * k; }
          if (terra > 0.15 && e <= sea) { const d = sea - e; r = 30 + 20 * (1 - d); g = 80 + 50 * (1 - d); b = 150 + 40 * (1 - d); }
          if (alat > 1.28 - terra * 0.3 && terra < 0.95) { r = 236; g = 240; b = 244; }
          break;
        }
        case 'venus': { const s = Math.sin(lat * 6 + v * 4 + lon * 0.5); r = 226 + s * 18; g = 190 + s * 20; b = 120 + s * 16; if (terra > 0) { r += (90 - r) * terra * 0.8; g += (150 - g) * terra * 0.8; b += (210 - b) * terra * 0.8; } break; }
        case 'jupiter': { const s = Math.sin(lat * 14 + v * 2.2); r = 210 + s * 30; g = 172 + s * 32; b = 128 + s * 34; const dl = (lat + 0.38) / 0.1, dn = ((lon - 0.8 + PI) % TAU - PI) / 0.22; if (dl * dl + dn * dn < 1) { r = 196; g = 92; b = 62; } break; }
        case 'saturn': { const s = Math.sin(lat * 11 + v * 1.6); r = 226 + s * 14; g = 204 + s * 16; b = 150 + s * 18; break; }
        case 'uranus': { const s = Math.sin(lat * 6 + v); r = 160 + s * 8; g = 214 + s * 8; b = 222 + s * 6; break; }
        case 'neptune': { const s = Math.sin(lat * 8 + v * 2); r = 60 + s * 12; g = 98 + s * 16; b = 214 + s * 14; const dl = (lat + 0.35) / 0.08, dn = ((lon + 1.2 + PI) % TAU - PI) / 0.18; if (dl * dl + dn * dn < 1) { r = 30; g = 44; b = 120; } break; }
        case 'europa': { r = 222 + e * 20; g = 210 + e * 18; b = 188 + e * 16; if (Math.abs(v) < 0.025 || Math.abs(e - 0.1) < 0.012) { r = 150; g = 100; b = 70; } break; }
        case 'titan': { const s = Math.sin(lat * 5 + v * 2); r = 214 + s * 12; g = 150 + s * 12; b = 60 + s * 8; if (e < -0.25 && alat > 1) { r = 80; g = 60; b = 40; } break; }
        case 'exo': { if (e < 0) { r = 38; g = 70 + e * 30; b = 130 + e * 40; } else { r = 122 + v * 60; g = 52 + v * 30; b = 104 + v * 40; if (e > 0.35) { r = 150; g = 140; b = 150; } } if (alat > 1.3) { r = 230; g = 232; b = 240; } break; }
        case 'exo2': { if (e < 0.05) { r = 30; g = 92 + e * 30; b = 140 + e * 40; } else { r = 44 + v * 60; g = 140 + v * 40; b = 128 + v * 30; if (v > 0.15) { r = 210; g = 150; b = 80; } } break; }
      }
      for (const c of craters) {
        const d = Math.acos(clamp(Math.sin(lat) * Math.sin(c.lat) + Math.cos(lat) * Math.cos(c.lat) * Math.cos(lon - c.lon), -1, 1));
        if (d < c.r) { const k = d / c.r; const f = k > 0.85 ? 1.18 : 0.78 + k * 0.15; r *= f; g *= f; b *= f; break; }
      }
      const o = i * 3; col[o] = r; col[o + 1] = g; col[o + 2] = b;
    }
  }
}
function planetLights(p, tx) {
  tx.lights.fill(0);
  for (const c of S.space.col[p.id] || []) {
    const cx = Math.floor((c.lon + PI) / TAU * PTW), cy = Math.floor((PI / 2 - c.lat) / PI * PTH);
    const rad = clamp(2 + Math.log10(c.pop / 1e3 + 1) * 2.4, 2, 14);
    for (let dy = -Math.ceil(rad); dy <= rad; dy++) for (let dx = -Math.ceil(rad * 1.5); dx <= rad * 1.5; dx++) {
      const y = cy + dy; if (y < 0 || y >= PTH) continue;
      const x = ((cx + dx) % PTW + PTW) % PTW, d2 = (dx / 1.5) * (dx / 1.5) + dy * dy;
      if (d2 > rad * rad) continue;
      const h = hash2(x + 9000, y);
      tx.lights[y * PTW + x] += Math.exp(-d2 / (rad * rad * 0.4)) * ((h & 255) > 90 ? 0.9 : 0.2);
    }
  }
}
function planetRender(g, tx, p) {
  if (g.dirty) globeTables(g);
  const d = g.img.data, P = g.P;
  const n = P.n, idx = P.idx, ptx = P.tx, pty = P.ty, Lt = P.Lt, Nt = P.Nt, Rim = P.Rim, Al = P.Al;
  const rotTex = (g.rot / TAU) * TW, sx = tx.w / TW, sy = tx.h / TH, col = tx.col, li = tx.lights;
  const atm = { venus: [255, 220, 150], titan: [240, 170, 80], mars: [255, 180, 150], exo: [200, 150, 220], exo2: [140, 220, 210], home: [110, 168, 255], uranus: [170, 230, 240], neptune: [100, 140, 255], jupiter: [230, 200, 160], saturn: [240, 220, 170] }[p.type];
  const rimK = atm ? 0.7 : 0.15, ac = atm || [200, 200, 200];
  for (let k = 0; k < n; k++) {
    let fx = ptx[k] + rotTex; fx -= Math.floor(fx / TW) * TW;
    const x = Math.min(tx.w - 1, (fx * sx) | 0), y = Math.min(tx.h - 1, (pty[k] * sy) | 0), i = y * tx.w + x, o3 = i * 3;
    const L = Lt[k];
    let r = col[o3] * L, gg = col[o3 + 1] * L, b = col[o3 + 2] * L;
    const lt = li[i];
    if (lt > 0) { const v = Math.min(1.2, lt) * (0.25 + Nt[k] * 0.9); r += 255 * v; gg += 214 * v; b += 150 * v; }
    const rim = Rim[k] * rimK, rl = 0.15 + L * 0.85;
    r += (ac[0] * rl - r) * rim; gg += (ac[1] * rl - gg) * rim; b += (ac[2] * rl - b) * rim;
    const oo = idx[k]; d[oo] = r; d[oo + 1] = gg; d[oo + 2] = b; d[oo + 3] = Al[k] * 255;
  }
  g.gctx.putImageData(g.img, 0, 0);
}
let lastPlanetLights = 0, planetScreen = [];
function drawPlanetScene() {
  const p = PLANET_BY_ID[planetSel]; if (!p) return;
  const tx = planetTexture(p);
  if (animT - lastPlanetLights > 1) { planetLights(p, tx); lastPlanetLights = animT; }
  const wide = view.w > 900, availW = wide ? view.w - 262 - 312 : view.w;
  GP.w = view.w; GP.h = view.h; GP.dpr = view.dpr; GP.cx = wide ? 262 + availW / 2 : view.w / 2; GP.cy = wide ? view.h / 2 : view.h * 0.42;
  const R = Math.min(availW * 0.9, view.h) * 0.38 * GP.zoom;
  if (Math.abs(R - GP.R) > 0.5) { GP.R = R; GP.dirty = true; }
  if (GP._cx !== GP.cx || GP._cy !== GP.cy || GP._w !== view.w) { GP._cx = GP.cx; GP._cy = GP.cy; GP._w = view.w; GP.dirty = true; }
  if (!drag) { GP.rot -= 0.0025; if (Math.abs(GP.vr) > 1e-4) { GP.rot += GP.vr / 60; GP.vr *= 0.94; } }
  planetRender(GP, tx, p);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = '#04060d'; ctx.fillRect(0, 0, view.w, view.h);
  ctx.drawImage(starCanvas, 0, 0, view.w, view.h);
  if (p.rings) { ctx.strokeStyle = 'rgba(226,206,150,.45)'; for (let k = 0; k < 6; k++) { ctx.lineWidth = GP.R * 0.06; ctx.beginPath(); ctx.ellipse(GP.cx, GP.cy, GP.R * (1.45 + k * 0.12), GP.R * (0.36 + k * 0.03), -0.3, PI, TAU); ctx.stroke(); } }
  ctx.drawImage(GP.gc, 0, 0, GP.gc.width, GP.gc.height, GP.box.x, GP.box.y, GP.gc.width / GP.q, GP.gc.height / GP.q);
  if (p.rings) { ctx.strokeStyle = 'rgba(226,206,150,.7)'; for (let k = 0; k < 6; k++) { ctx.lineWidth = GP.R * 0.06; ctx.beginPath(); ctx.ellipse(GP.cx, GP.cy, GP.R * (1.45 + k * 0.12), GP.R * (0.36 + k * 0.03), -0.3, 0, PI); ctx.stroke(); } }
  planetScreen = [];
  const cols = S.space.col[p.id] || [];
  ctx.font = `12px ${CSSV.font}`; ctx.textBaseline = 'middle';
  for (const c of cols) {
    const pr2 = globeProject(GP, c.lat, c.lon); if (pr2.z < 0.05) continue;
    const o = ownerOfColony(c); if (!o) continue;
    const s = clamp(3 + Math.log10(c.pop / 1e4 + 1) * 3, 3, 10);
    ctx.fillStyle = 'rgba(230,240,255,.9)'; ctx.beginPath(); ctx.arc(pr2.x, pr2.y, s, PI, TAU); ctx.fill();
    ctx.strokeStyle = o.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pr2.x, pr2.y, s, PI, TAU); ctx.stroke();
    ctx.fillStyle = o.color; ctx.fillRect(pr2.x - s, pr2.y, s * 2, 2);
    const label = `${c.name} · ${fmtPop(c.pop)}`, tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(6,10,20,.75)'; ctx.fillRect(pr2.x + s + 4, pr2.y - 8, tw + 10, 16);
    ctx.fillStyle = o.color; ctx.fillRect(pr2.x + s + 4, pr2.y - 8, 3, 16);
    ctx.fillStyle = '#e9eef8'; ctx.fillText(label, pr2.x + s + 10, pr2.y);
    planetScreen.push({ c, x: pr2.x, y: pr2.y, r: s + 4 });
  }
  const ns = Math.min(24, cols.length * 4);
  for (let k = 0; k < ns; k++) { const a = animT * (0.3 + (k % 5) * 0.07) + k * 1.3, rr = GP.R * (1.15 + (k % 4) * 0.06); const x = GP.cx + Math.cos(a) * rr, y = GP.cy + Math.sin(a) * rr * 0.35; const front = Math.sin(a) > 0; if (!front && Math.hypot(x - GP.cx, y - GP.cy) < GP.R) continue; ctx.fillStyle = 'rgba(220,235,255,.9)'; ctx.fillRect(x - 1, y - 1, 2, 2); }
}
function openPlanet(pid) { if (pid === 'home') { setView('globe'); return; } planetSel = pid; GP.zoom = 1; GP.rot = 0; GP.dirty = true; setView('planet'); }
