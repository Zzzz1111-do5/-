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
const BELT_PATHS = [[], [], [], []];
const KUIPER = Array.from({ length: 260 }, (_, k) => { const r = mulberry32(k * 53 + 11); return { a: 33 + r() * 14, ph: r() * TAU, s: r() }; });
// long-period comets (a in AU, e, argument of perihelion, period in system-time units)
const COMETS = [{ a: 14, e: 0.94, w: 2.3, per: 4.2, ph: 0.12 }, { a: 8, e: 0.86, w: 4.9, per: 2.7, ph: 0.6 }, { a: 22, e: 0.965, w: 0.7, per: 6.5, ph: 0.85 }];
// atmosphere tints (shared by the system view rims, the close-up shader and its halo)
const ATM = { venus: [255, 220, 150], titan: [240, 170, 80], mars: [255, 180, 150], exo: [200, 150, 220], exo2: [140, 220, 210], home: [110, 168, 255], uranus: [170, 230, 240], neptune: [100, 140, 255], jupiter: [230, 200, 160], saturn: [240, 220, 170] };
const GIANT = { jupiter: 1, saturn: 1, uranus: 1, neptune: 1 };
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

/* ---------- backdrop: Milky Way band + nebulae, generated once per size/quality ---------- */
const SPACE_BG = { c: null, key: '', m: 0.05 };
function spaceBackdrop() {
  if (GFX.level === 0) return null;
  const m = SPACE_BG.m, w = Math.round(view.w * (1 + 2 * m)), h = Math.round(view.h * (1 + 2 * m));
  const key = w + 'x' + h + ':' + Math.min(2, GFX.level);
  if (SPACE_BG.key === key) return SPACE_BG.c;
  const lw = GFX.level >= 2 ? 320 : 220, lh = Math.max(2, Math.round(lw * h / w)), asp = w / h;
  const rnd = mulberry32(4711), n1 = makeNoise(rnd), n2 = makeNoise(rnd);
  const lo = document.createElement('canvas'); lo.width = lw; lo.height = lh;
  const lc = lo.getContext('2d'), img = lc.createImageData(lw, lh), d = img.data;
  // galactic plane: a line from (0, .82h) to (w, .14h); distance measured in units of h
  const lx = w, ly = -0.68 * h, ll = Math.hypot(lx, ly);
  const band = (px, py) => { const dd = Math.abs((px * ly - (py - 0.82 * h) * lx) / ll) / h; return Math.exp(-dd * dd / 0.02); };
  for (let y = 0; y < lh; y++) {
    const v = y / lh;
    for (let x = 0; x < lw; x++) {
      const u = x / lw, b = band(u * w, v * h);
      const f1 = fbm(n1, u * 5 * asp, v * 5, 0.5, 5), f2 = fbm(n2, u * 2.6 * asp, v * 2.6, 1.7, 4);
      let core = b * clamp(0.55 + f1 * 1.6, 0, 1.4);
      core *= 1 - 0.8 * b * smooth(0.02, 0.22, f2 + f1 * 0.6);           // dust lanes
      const I = core * 62 + b * b * 18;
      const neb = smooth(0.08, 0.42, f2 * 0.8 + f1 * 0.5) * (0.35 + 0.65 * b);
      const hue = 0.5 + f1 * 2.2;
      const nr = hue < 0.5 ? 120 : 150, ng = hue < 0.5 ? 46 : 52, nb = hue < 0.5 ? 150 : 86;
      const tq = smooth(0.15, 0.55, -f2);                                    // teal veils away from the band
      const o = (y * lw + x) * 4;
      d[o] = 4 + I * 0.95 + neb * nr * 0.32 + tq * 6;
      d[o + 1] = 6 + I * 0.9 + neb * ng * 0.32 + tq * 26;
      d[o + 2] = 13 + I * 1.05 + neb * nb * 0.32 + tq * 34;
      d[o + 3] = 255;
    }
  }
  lc.putImageData(img, 0, 0);
  const c = SPACE_BG.c || document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(lo, 0, 0, w, h);
  // dense faint star fields concentrated in the band
  const n = Math.round(w * h / (GFX.level >= 2 ? 500 : 900));
  for (let k = 0; k < n; k++) {
    const x = rnd() * w, y = rnd() * h, b = band(x, y);
    if (rnd() > b * 0.85 + 0.06) continue;
    const s = rnd();
    g.fillStyle = `rgba(${215 + s * 40 | 0},${215 + s * 30 | 0},255,${0.12 + s * 0.45})`;
    g.fillRect(x, y, s > 0.97 ? 1.5 : 1, s > 0.97 ? 1.5 : 1);
  }
  if (GFX.level >= 2) for (let k = 0; k < 26; k++) {
    const x = rnd() * w, y = rnd() * h, r = 3 + rnd() * 5, hue = rnd();
    const col = hue < 0.3 ? '255,210,170' : hue < 0.6 ? '200,220,255' : '255,245,230';
    const sg = g.createRadialGradient(x, y, 0, x, y, r);
    sg.addColorStop(0, `rgba(${col},.9)`); sg.addColorStop(0.25, `rgba(${col},.25)`); sg.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = sg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  SPACE_BG.c = c; SPACE_BG.key = key;
  return c;
}
function drawSpaceBackdrop(ox, oy) {
  const bg = spaceBackdrop();
  if (!bg) { ctx.fillStyle = '#04060d'; ctx.fillRect(0, 0, view.w, view.h); }
  else {
    const mx = SPACE_BG.m * view.w, my = SPACE_BG.m * view.h;
    ctx.drawImage(bg, -mx + clamp(ox, -mx, mx), -my + clamp(oy, -my, my), bg.width, bg.height);
  }
  ctx.drawImage(starCanvas, 0, 0, view.w, view.h);
}

/* ---------- rings (sprite with a radial density profile, the planet's shadow cut into the back half) ---------- */
const RING_SPR = { c: null, n: 0 };
const RING_IN = 1.22 / 2.3;
function ringSprite() {
  const n = GFX.level >= 2 ? 512 : 256;
  if (RING_SPR.n === n) return RING_SPR.c;
  const prof = new Float32Array(512), tint = new Float32Array(512);
  for (let k = 0; k < 512; k++) {
    const R = 1.22 + (k / 511) * 1.08, h = hash2(k * 7 + 3, 91) / 4294967296;
    let a = R < 1.53 ? 0.16 + (R - 1.22) * 0.5 : R < 1.95 ? 0.72 + 0.12 * Math.sin(R * 55) : R < 2.03 ? 0.05 : R < 2.27 ? (Math.abs(R - 2.21) < 0.01 ? 0.08 : 0.5) : 0.12 * (1 - (R - 2.27) / 0.03);
    prof[k] = clamp(a * (0.82 + 0.36 * h), 0, 1); tint[k] = R < 1.53 ? 0.75 : R < 1.95 ? 1.05 : 0.92;
  }
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data, hn = n / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x + 0.5 - hn, y + 0.5 - hn) / hn;
    if (r < RING_IN || r > 1) continue;
    const k = Math.min(511, ((r - RING_IN) / (1 - RING_IN) * 511) | 0), t = tint[k], o = (y * n + x) * 4;
    d[o] = 228 * t; d[o + 1] = 206 * t; d[o + 2] = 164 * t; d[o + 3] = prof[k] * 255;
  }
  g.putImageData(img, 0, 0);
  RING_SPR.c = c; RING_SPR.n = n;
  return c;
}
// Rp: planet radius on screen; ratio: ellipse minor/major; (shx, shy): anti-sun direction in ring-plane coordinates
function drawRings(x, y, Rp, tilt, ratio, front, shx, shy, alpha) {
  const spr = ringSprite(), o = Rp * 2.3;
  ctx.save(); ctx.translate(x, y); ctx.rotate(tilt); ctx.scale(1, ratio);
  ctx.beginPath(); if (front) ctx.rect(-o, 0, 2 * o, o); else ctx.rect(-o, -o, 2 * o, o); ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.drawImage(spr, -o, -o, 2 * o, 2 * o);
  ctx.globalAlpha = 1;
  if (shx !== undefined && (front ? shy > -0.2 : shy < 0.2)) {
    ctx.beginPath(); ctx.arc(0, 0, o, 0, TAU); ctx.arc(0, 0, o * RING_IN, 0, TAU, true); ctx.clip();
    const px = -shy, py = shx, L = o * 2.2, w = Rp / Math.max(0.3, Math.hypot(px, py * ratio) || 1) * 0.98;
    ctx.fillStyle = 'rgba(2,3,8,.78)'; ctx.beginPath();
    ctx.moveTo(px * w, py * w); ctx.lineTo(px * w + shx * L, py * w + shy * L); ctx.lineTo(-px * w + shx * L, -py * w + shy * L); ctx.lineTo(-px * w, -py * w); ctx.fill();
  }
  ctx.restore();
}

/* ---------- the sun: limb-darkened disc, corona streamers, prominences, lens ghosts ---------- */
function drawSun(cx, cy, sr) {
  const L = GFX.level, sw = view.w, sh = view.h;
  const R5 = sr * (L ? 7 : 5);
  const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R5);
  if (L) { sg.addColorStop(0, 'rgba(255,248,225,1)'); sg.addColorStop(0.1, 'rgba(255,214,130,.85)'); sg.addColorStop(0.22, 'rgba(255,160,70,.3)'); sg.addColorStop(0.5, 'rgba(255,110,40,.07)'); sg.addColorStop(1, 'rgba(255,90,30,0)'); }
  else { sg.addColorStop(0, 'rgba(255,244,214,1)'); sg.addColorStop(0.18, 'rgba(255,206,110,.95)'); sg.addColorStop(0.4, 'rgba(255,150,60,.25)'); sg.addColorStop(1, 'rgba(255,120,40,0)'); }
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, R5, 0, TAU); ctx.fill();
  if (!L) { ctx.fillStyle = '#fff6dc'; ctx.beginPath(); ctx.arc(cx, cy, sr, 0, TAU); ctx.fill(); return; }
  ctx.globalCompositeOperation = 'lighter';
  // corona streamers: one gradient, one path
  const nr = L >= 2 ? 16 : 9, maxL = sr * 4.2;
  const cg = ctx.createRadialGradient(cx, cy, sr * 0.8, cx, cy, maxL);
  cg.addColorStop(0, 'rgba(255,225,160,.32)'); cg.addColorStop(0.35, 'rgba(255,190,110,.10)'); cg.addColorStop(1, 'rgba(255,160,80,0)');
  ctx.fillStyle = cg; ctx.beginPath();
  for (let k = 0; k < nr; k++) {
    const a = k / nr * TAU + animT * 0.015 + Math.sin(k * 7.3) * 0.25;
    const len = sr * (1.6 + (k % 3 ? 1.1 : 2.5) * (0.6 + 0.4 * Math.sin(animT * 0.5 + k * 2.1)));
    const w = sr * (k % 3 ? 0.22 : 0.34), ca = Math.cos(a), sa = Math.sin(a);
    ctx.moveTo(cx - sa * w, cy + ca * w); ctx.lineTo(cx + ca * len, cy + sa * len); ctx.lineTo(cx + sa * w, cy - ca * w);
  }
  ctx.fill();
  // prominences: small glowing loops on the limb
  if (sr > 9) {
    ctx.strokeStyle = 'rgba(255,110,60,.55)'; ctx.lineWidth = Math.max(1, sr * 0.07);
    for (let k = 0; k < 3; k++) {
      const a = k * 2.4 + animT * 0.01, pr = sr * (0.18 + 0.08 * Math.sin(animT * 0.4 + k * 3));
      const px = cx + Math.cos(a) * sr, py = cy + Math.sin(a) * sr;
      ctx.beginPath(); ctx.arc(px, py, pr, a - PI * 0.5, a + PI * 0.5); ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  const pg = ctx.createRadialGradient(cx - sr * 0.12, cy - sr * 0.12, 0, cx, cy, sr);
  pg.addColorStop(0, '#fffef6'); pg.addColorStop(0.6, '#fff1c4'); pg.addColorStop(0.88, '#ffcb78'); pg.addColorStop(1, '#ff9d48');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(cx, cy, sr, 0, TAU); ctx.fill();
  // lens flare ghosts along the sun → screen-centre axis
  if (L >= 2 && cx > -sr && cx < sw + sr && cy > -sr && cy < sh + sr) {
    const vx = sw / 2 - cx, vy = sh / 2 - cy, k = smooth(30, 260, Math.hypot(vx, vy));
    ctx.globalCompositeOperation = 'lighter';
    const hs = ctx.createLinearGradient(cx - sr * 14, 0, cx + sr * 14, 0);
    hs.addColorStop(0, 'rgba(160,200,255,0)'); hs.addColorStop(0.5, 'rgba(190,215,255,.22)'); hs.addColorStop(1, 'rgba(160,200,255,0)');
    ctx.fillStyle = hs; ctx.fillRect(cx - sr * 14, cy - 0.8, sr * 28, 1.6);
    if (k > 0.01) for (const [t, rr, col, a] of [[0.55, 0.9, '120,200,255', 0.09], [0.95, 0.45, '255,190,120', 0.12], [1.35, 1.7, '140,255,210', 0.05], [1.7, 0.7, '210,150,255', 0.08]]) {
      const x = cx + vx * t, y = cy + vy * t, r = sr * rr;
      const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
      gg.addColorStop(0, `rgba(${col},${a * k})`); gg.addColorStop(0.75, `rgba(${col},${a * k * 0.6})`); gg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

function cometPos(c, t, cx, cy) {
  const M = TAU * (t / c.per + c.ph);
  let E = c.e > 0.8 ? PI : M;
  for (let k = 0; k < 8; k++) E -= (E - c.e * Math.sin(E) - M) / (1 - c.e * Math.cos(E));
  const xo = c.a * (Math.cos(E) - c.e), yo = c.a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
  const cw = Math.cos(c.w), sw = Math.sin(c.w), X = xo * cw - yo * sw, Y = xo * sw + yo * cw, rr = Math.hypot(X, Y) || 1e-3;
  const sr = sysR(rr) / rr;
  return { x: cx + X * sr, y: cy + Y * sr * 0.55, r: rr };
}
function drawComets(cx, cy, t) {
  ctx.globalCompositeOperation = 'lighter';
  for (const c of COMETS) {
    const p = cometPos(c, t, cx, cy);
    if (p.x < -200 || p.x > view.w + 200 || p.y < -200 || p.y > view.h + 200) continue;
    let ux = p.x - cx, uy = p.y - cy; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const len = Math.min(150, 70 / Math.max(0.35, p.r)) * Math.sqrt(sys.z), br = clamp(2.2 / p.r, 0.15, 1);
    if (len > 4) {
      // dust tail (curved back along the orbit) and ion tail (straight, blue)
      const qa = 0.22, dx = ux * Math.cos(qa) - uy * Math.sin(qa), dy = ux * Math.sin(qa) + uy * Math.cos(qa);
      for (const [tx, ty, L2, w, col, a] of [[dx, dy, len * 0.8, len * 0.13, '255,236,200', 0.35], [ux, uy, len, len * 0.05, '140,200,255', 0.5]]) {
        const ex = p.x + tx * L2, ey = p.y + ty * L2;
        const g = ctx.createLinearGradient(p.x, p.y, ex, ey);
        g.addColorStop(0, `rgba(${col},${a * br})`); g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(p.x - ty * 1.2, p.y + tx * 1.2); ctx.lineTo(ex - ty * w, ey + tx * w); ctx.lineTo(ex + ty * w, ey - tx * w); ctx.lineTo(p.x + ty * 1.2, p.y - tx * 1.2); ctx.fill();
      }
    }
    const hr = 2 + br * 4, hg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, hr);
    hg.addColorStop(0, `rgba(230,245,255,${0.5 + br * 0.5})`); hg.addColorStop(1, 'rgba(160,210,255,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(p.x, p.y, hr, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
function transitPos(tr, f, home, t, sw) {
  const p = PLANET_BY_ID[tr.to];
  if (p.inter) { const ex = sw - 30, ey = 40 + (p.id === 'trappist' ? 30 : 0); return [home.x + (ex - home.x) * f, home.y + (ey - home.y) * f]; }
  const tp = sysPos(p, t), mx = (home.x + tp.x) / 2 - (tp.y - home.y) * 0.25, my = (home.y + tp.y) / 2 + (tp.x - home.x) * 0.25, it = 1 - f;
  return [it * it * home.x + 2 * it * f * mx + f * f * tp.x, it * it * home.y + 2 * it * f * my + f * f * tp.y];
}

let sysScreen = [];
function drawSystemScene() {
  const sw = view.w, sh = view.h, t = sysT(), L = GFX.level;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  drawSpaceBackdrop(sys.px * 0.04 + Math.sin(animT * 0.01) * 6, sys.py * 0.04);
  const cx = sw / 2 + sys.px, cy = sh / 2 + sys.py;
  // kuiper belt and asteroid belt (asteroids batched into brightness buckets; the near side reads brighter)
  ctx.fillStyle = 'rgba(160,170,190,.35)';
  ctx.beginPath();
  for (const b of KUIPER) { const ang = b.ph + t * TAU / 300, r = sysR(b.a); const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r * 0.55; if (x > -5 && x < sw + 5 && y > -5 && y < sh + 5) ctx.rect(x, y, 1, 1); }
  ctx.fill();
  const BK = 4, bp = BELT_PATHS;
  for (let k = 0; k < BK; k++) bp[k].length = 0;
  for (const b of BELT) {
    const ang = b.ph + t * TAU / Math.pow(b.a, 1.5), r = sysR(b.a + b.e), sa = Math.sin(ang);
    const x = cx + Math.cos(ang) * r, y = cy + sa * r * 0.55;
    if (x < -3 || x > sw + 3 || y < -3 || y > sh + 3) continue;
    const v = L ? b.s * 0.6 + (sa + 1) * 0.2 : b.s;
    bp[Math.min(BK - 1, (v * BK) | 0)].push(x, y, b.s > 0.85 ? 1.6 : 1);
  }
  for (let k = 0; k < BK; k++) {
    const a = bp[k]; if (!a.length) continue;
    ctx.fillStyle = `rgba(${170 + k * 12},${160 + k * 10},${140 + k * 6},${0.25 + (k + 0.5) / BK * 0.45})`;
    ctx.beginPath(); for (let j = 0; j < a.length; j += 3) ctx.rect(a[j], a[j + 1], a[j + 2], a[j + 2]); ctx.fill();
  }
  // orbits
  ctx.lineWidth = 1;
  for (const p of PLANETS) { if (p.parent || p.inter) continue; const r = sysR(p.a); ctx.strokeStyle = p.id === 'home' ? 'rgba(92,196,230,.35)' : 'rgba(140,170,220,.16)'; ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.55, 0, 0, TAU); ctx.stroke(); }
  if (L) drawComets(cx, cy, t);
  drawSun(cx, cy, 16 * Math.max(0.7, sys.z));
  // planets sorted by depth
  sysScreen = [];
  const list = PLANETS.filter(p => !p.inter).map(p => ({ p, pos: sysPos(p, t) })).sort((a, b) => a.pos.y - b.pos.y);
  for (const { p, pos } of list) {
    const r = Math.max(1.5, p.vr * Math.max(0.6, Math.sqrt(sys.z)));
    const col = planetTint(p);
    const dx = cx - pos.x, dy = cy - pos.y, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
    // ring shadow direction in ring-plane coordinates (undo the ring tilt and the orbit-plane squash)
    let shx = 0, shy = 0;
    if (p.rings && L) { const ex = -ux, ey = -uy / 0.55, el = Math.hypot(ex, ey) || 1, c = Math.cos(0.35), s = Math.sin(0.35); shx = (ex * c - ey * s) / el; shy = (ex * s + ey * c) / el; }
    if (p.rings) { if (L) drawRings(pos.x, pos.y, r, -0.35, 0.36, false, shx, shy, 0.9); else { ctx.strokeStyle = 'rgba(226,206,150,.55)'; ctx.lineWidth = r * 0.35; ctx.beginPath(); ctx.ellipse(pos.x, pos.y, r * 2.1, r * 0.7, -0.35, PI, TAU); ctx.stroke(); } }
    if (!L) {
      const g = ctx.createRadialGradient(pos.x + ux * r * 0.5, pos.y + uy * r * 0.5, r * 0.1, pos.x, pos.y, r * 1.05);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(10,12,20,1)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, TAU); ctx.fill();
      if (GIANT[p.type] && r >= 4) {
        // cloud bands (and Jupiter's red spot)
        ctx.save(); ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, TAU); ctx.clip();
        const nb = p.type === 'uranus' ? 3 : 7;
        for (let j = 0; j < nb; j++) { const yy = pos.y - r + (j + 0.5) * 2 * r / nb; ctx.fillStyle = j & 1 ? 'rgba(255,250,235,.16)' : 'rgba(70,40,20,.16)'; ctx.fillRect(pos.x - r, yy - r / nb * 0.55, r * 2, r / nb * 1.1); }
        if (p.type === 'jupiter') { ctx.fillStyle = 'rgba(190,80,50,.8)'; ctx.beginPath(); ctx.ellipse(pos.x + r * 0.3 * Math.cos(animT * 0.2), pos.y + r * 0.35, r * 0.2, r * 0.11, 0, 0, TAU); ctx.fill(); }
        ctx.restore();
      }
      // sphere shading: lit from the sun, terminator a little past the centre
      const g = ctx.createRadialGradient(pos.x + ux * r * 0.6, pos.y + uy * r * 0.6, 0, pos.x + ux * r * 0.6, pos.y + uy * r * 0.6, r * 1.9);
      g.addColorStop(0, 'rgba(255,250,235,.28)'); g.addColorStop(0.32, 'rgba(255,250,235,0)'); g.addColorStop(0.58, 'rgba(4,6,12,.72)'); g.addColorStop(0.78, 'rgba(4,6,12,.97)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, TAU); ctx.fill();
      const atm = ATM[p.type];
      if (atm && r >= 2.5) { const sa = Math.atan2(uy, ux); ctx.strokeStyle = `rgba(${atm[0]},${atm[1]},${atm[2]},.6)`; ctx.lineWidth = Math.max(1, r * 0.16); ctx.beginPath(); ctx.arc(pos.x, pos.y, r + ctx.lineWidth * 0.3, sa - 1.35, sa + 1.35); ctx.stroke(); }
    }
    if (p.rings) { if (L) drawRings(pos.x, pos.y, r, -0.35, 0.36, true, shx, shy, 1); else { ctx.strokeStyle = 'rgba(226,206,150,.75)'; ctx.lineWidth = r * 0.35; ctx.beginPath(); ctx.ellipse(pos.x, pos.y, r * 2.1, r * 0.7, -0.35, 0, PI); ctx.stroke(); } }
    if (p.id === 'home') { ctx.strokeStyle = 'rgba(92,196,230,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(pos.x, pos.y, r + 4, 0, TAU); ctx.stroke(); }
    const cols = S.space.col[p.id] || [];
    if (L && cols.length && r >= 2.5) {
      // colony lights twinkling on the night side
      ctx.fillStyle = 'rgba(255,214,140,.95)';
      const nl = Math.min(8, 2 + cols.length * 2), px = -uy, py = ux;
      for (let k = 0; k < nl; k++) { const h = hash2(k * 13 + 5, p.id.length * 7), u = ((h & 1023) / 1023 - 0.5) * 1.4, v = 0.25 + ((h >>> 10) & 255) / 255 * 0.6; if (Math.sin(animT * 2 + k * 1.7) < -0.85) continue; ctx.fillRect(pos.x + (-ux * v + px * u * Math.sqrt(1 - v * v)) * r - 0.5, pos.y + (-uy * v + py * u * Math.sqrt(1 - v * v)) * r - 0.5, 1, 1); }
    }
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
  // ships in transit: fading trail along the flight path and an engine glow
  const home = sysPos(PLANET_BY_ID.home, t);
  for (const tr of S.space.transit) {
    const f = clamp((S.year + budget - tr.dep) / Math.max(0.5, tr.arr - tr.dep), 0, 1);
    const [x, y] = transitPos(tr, f, home, t, sw);
    if (L) {
      const f0 = Math.max(0, f - 0.18), [x0, y0] = transitPos(tr, f0, home, t, sw), [xm, ym] = transitPos(tr, (f + f0) / 2, home, t, sw);
      const g = ctx.createLinearGradient(x0, y0, x, y);
      g.addColorStop(0, 'rgba(160,210,255,0)'); g.addColorStop(1, 'rgba(190,225,255,.55)');
      ctx.strokeStyle = g; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(2 * xm - (x0 + x) / 2, 2 * ym - (y0 + y) / 2, x, y); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const eg = ctx.createRadialGradient(x, y, 0, x, y, 6);
      eg.addColorStop(0, 'rgba(200,230,255,.8)'); eg.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = tr.c || '#fff'; ctx.beginPath(); ctx.arc(x, y, 2, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = tr.c || '#fff'; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,210,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - (x - home.x) * 0.08, y - (y - home.y) * 0.08); ctx.stroke();
    }
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
const PTW = 512, PTH = 256;                 // base noise resolution; detail ≥ 2 upsamples and adds a finer octave
const BANDED = { jupiter: 1, saturn: 1, venus: 1, uranus: 1, neptune: 1, titan: 1 };
const RELIEF = { mercury: 0.035, moon: 0.03, ceres: 0.04, ganymede: 0.022, europa: 0.008, mars: 0.028, exo: 0.022, exo2: 0.018 };
const CRATERS = { mercury: 110, moon: 100, ceres: 90, ganymede: 70, mars: 36 };
const CLOUDY = { mars: 1, exo: 1, exo2: 1 };
function planetRes() { return GFX.detail >= 3 ? 1024 : GFX.detail >= 2 ? 768 : 512; }
function planetTexDirty(pid) { if (PTEX[pid]) PTEX[pid].dirty = true; }
function planetTexture(p) {
  const w = planetRes(), h = w / 2;
  let tx = PTEX[p.id];
  if (tx && tx.w === w && !tx.dirty) { tx.used = animT; return tx; }
  if (!tx || tx.w !== w) {
    // keep at most four textures resident (the hi-res ones are ~10 MB each)
    const keys = Object.keys(PTEX).filter(k => k !== p.id);
    if (keys.length >= 4) { keys.sort((a, b) => PTEX[a].used - PTEX[b].used); delete PTEX[keys[0]]; }
    const rnd = mulberry32((p.id.charCodeAt(0) * 7919 + p.id.length * 131) | 0);
    const n1 = makeNoise(rnd), n2 = makeNoise(rnd), n3 = makeNoise(rnd);
    const band = BANDED[p.type], cloudy = CLOUDY[p.type];
    // terrain at the base resolution; the smooth fields (albedo variation, bands, clouds) at a quarter of the cost
    const el0 = sphereField(PTW, PTH, (X, Y, Z) => fbm(n1, X * 2 + 3, Y * 2, Z * 2, 5));
    const vw = 256, vh = band ? 256 : 128;
    const v20 = sphereField(vw, vh, band ? (X, Y, Z) => fbm(n2, X * 2.5, Y * 9, Z * 2.5, 4) : (X, Y, Z) => fbm(n2, X * 6, Y * 6, Z * 6, 3));
    const cl0 = cloudy ? sphereField(256, 128, (X, Y, Z) => fbm(n3, X * 3 + 7, Y * 5, Z * 3, 3)) : null;
    const N = w * h;
    const el = upsampleField(el0, PTW, PTH, w, h), v2 = upsampleField(v20, vw, vh, w, h), cld = cl0 && upsampleField(cl0, 256, 128, w, h);
    if (w !== PTW) {
      // finer grain on top of the upsampled base: a small wrapped noise tile (cheap, invisible repetition at texel scale)
      if (!band) {
        const T = 128, tile = new Float32Array(T * T), tr = mulberry32(99);
        for (let k = 0; k < T * T; k++) tile[k] = tr() - 0.5;
        for (let y = 0; y < h; y++) { const row = y * w, tr2 = (y & (T - 1)) * T; for (let x = 0; x < w; x++) el[row + x] += (tile[tr2 + (x & (T - 1))] + tile[tr2 + ((x + 1) & (T - 1))] + tile[((y + 1) & (T - 1)) * T + (x & (T - 1))]) * 0.035; }
      }
    }
    // relief: crater bowls/rims + terrain height → baked slope shading (light from the screen's upper left;
    // the planet spins about the screen-vertical axis, so texture +x stays screen-right on the visible face)
    const rk = RELIEF[p.type], sh = rk ? new Float32Array(N) : null;
    if (rk) {
      const hgt = new Float32Array(N);
      for (let i = 0; i < N; i++) hgt[i] = el[i] * rk;
      const nc = CRATERS[p.type] ? Math.round(CRATERS[p.type] * (w > PTW ? 2.5 : 1)) : 0;
      for (let k = 0; k < nc; k++) {
        const big = k < CRATERS[p.type];
        stampCrater(hgt, w, h, Math.asin(rnd() * 2 - 1), rnd() * TAU - PI, big ? 0.02 + Math.pow(rnd(), 3) * 0.18 : 0.006 + rnd() * 0.014);
      }
      const dth = TAU / w;
      for (let y = 0; y < h; y++) {
        const lat = PI / 2 - (y + 0.5) / h * PI, ic = 1 / (2 * dth * Math.max(0.15, Math.cos(lat))), row = y * w, up = Math.max(0, y - 1) * w, dn = Math.min(h - 1, y + 1) * w;
        for (let x = 0; x < w; x++) {
          const xl = x ? x - 1 : w - 1, xr = x < w - 1 ? x + 1 : 0;
          const hx = (hgt[row + xr] - hgt[row + xl]) * ic, hy = (hgt[dn + x] - hgt[up + x]) / (2 * dth);
          sh[row + x] = clamp(1 + 1.3 * (0.62 * hx + 0.3 * hy), 0.45, 1.55);
        }
      }
    }
    tx = PTEX[p.id] = { w, h, c32: new Uint32Array(N), lights: new Float32Array(N), wet: null, el, v2, sh, cld, rs: new Float32Array(h), used: animT };
  }
  paintPlanet(p, tx);
  tx.dirty = false;
  return tx;
}
window.__ptex = (id) => { const t0 = performance.now(); const p = PLANET_BY_ID[id]; delete PTEX[id]; planetTexture(p); return performance.now() - t0; };
function sphereField(w, h, fn) {
  const out = new Float32Array(w * h), cosL = new Float32Array(w), sinL = new Float32Array(w);
  for (let x = 0; x < w; x++) { const lon = (x + 0.5) / w * TAU - PI; cosL[x] = Math.cos(lon); sinL[x] = Math.sin(lon); }
  for (let y = 0; y < h; y++) {
    const lat = PI / 2 - (y + 0.5) / h * PI, cl = Math.cos(lat), sl = Math.sin(lat), row = y * w;
    for (let x = 0; x < w; x++) out[row + x] = fn(cl * cosL[x], sl, cl * sinL[x]);
  }
  return out;
}
function upsampleField(src, sw, sh, w, h) {
  if (sw === w && sh === h) return src;
  const out = new Float32Array(w * h), kx = sw / w, ky = sh / h;
  for (let y = 0; y < h; y++) {
    let fy = (y + 0.5) * ky - 0.5; if (fy < 0) fy = 0; if (fy > sh - 1) fy = sh - 1;
    const y0 = fy | 0, y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0, r0 = y0 * sw, r1 = y1 * sw, row = y * w;
    for (let x = 0; x < w; x++) {
      let fx = (x + 0.5) * kx - 0.5; if (fx < 0) fx += sw;
      const x0 = fx | 0, x1 = x0 + 1 === sw ? 0 : x0 + 1, wx = fx - x0;
      const a = src[r0 + x0] + (src[r0 + x1] - src[r0 + x0]) * wx, b = src[r1 + x0] + (src[r1 + x1] - src[r1 + x0]) * wx;
      out[row + x] = a + (b - a) * wy;
    }
  }
  return out;
}
function stampCrater(hgt, w, h, clat, clon, r) {
  const ext = r * 1.5, y0 = Math.max(0, Math.floor((PI / 2 - clat - ext) / PI * h)), y1 = Math.min(h - 1, Math.ceil((PI / 2 - clat + ext) / PI * h));
  const scl = Math.sin(clat), ccl = Math.cos(clat), depth = 0.22 * r, rim = 0.06 * r;
  for (let y = y0; y <= y1; y++) {
    const lat = PI / 2 - (y + 0.5) / h * PI, sl = Math.sin(lat), cl = Math.cos(lat);
    const dl = Math.min(PI, ext / Math.max(0.05, cl)), xa = Math.floor((clon - dl + PI) / TAU * w), xb = Math.ceil((clon + dl + PI) / TAU * w);
    for (let xx = xa; xx <= xb; xx++) {
      const x = ((xx % w) + w) % w, lon = (x + 0.5) / w * TAU - PI;
      const d = Math.acos(clamp(sl * scl + cl * ccl * Math.cos(lon - clon), -1, 1)), k = d / r;
      if (k >= 1.5) continue;
      hgt[y * w + x] += k < 1 ? -depth * (1 - k * k) + rim * smooth(0.65, 1, k) : rim * (1 - smooth(1, 1.5, k));
    }
  }
}
function paintPlanet(p, tx) {
  const { el, v2, sh, cld, c32, w: TW2, h: TH2 } = tx;
  const terra = S.space.terra[p.id] || 0;
  const cloudK = p.type === 'mars' ? smooth(0.2, 0.8, terra) * 0.75 : p.type === 'exo' ? 0.55 : p.type === 'exo2' ? 0.65 : 0;
  const wetty = p.type === 'mars' ? terra > 0.15 : p.type === 'exo' || p.type === 'exo2';
  const wet = wetty ? (tx.wet || (tx.wet = new Uint8Array(TW2 * TH2))) : null;
  if (!wetty) tx.wet = null; else wet.fill(0);
  for (let y = 0; y < TH2; y++) {
    const lat = PI / 2 - (y + 0.5) / TH2 * PI, alat = Math.abs(lat);
    for (let x = 0; x < TW2; x++) {
      const i = y * TW2 + x, e = el[i], v = v2[i];
      const lon = (x + 0.5) / TW2 * TAU - PI;
      let r = 128, g = 128, b = 128, water = false;
      switch (p.type) {
        case 'mercury': { const s = 120 + e * 90 + v * 20; r = s; g = s * 0.96; b = s * 0.9; break; }
        case 'moon': { let s = 178 + e * 50 + v * 15; if (e < -0.12) s -= 55; r = s; g = s; b = s * 0.98; break; }
        case 'ceres': case 'ganymede': { let s = (p.type === 'ceres' ? 105 : 130) + e * 60 + v * 25; r = s * 1.02; g = s * 0.97; b = s * 0.9; if (p.type === 'ganymede' && v > 0.12) { r += 30; g += 28; b += 24; } break; }
        case 'mars': {
          const sea = -0.45 + terra * 0.5;
          r = 176 + e * 70; g = 86 + e * 40; b = 52 + e * 25;
          if (v > 0.18) { r *= 0.62; g *= 0.6; b *= 0.62; }
          if (terra > 0 && e > sea) { const k = clamp(terra * 1.4 - (e - sea) * 1.2, 0, 0.85); r += (78 - r) * k; g += (140 - g) * k; b += (72 - b) * k; }
          if (terra > 0.15 && e <= sea) { const d = sea - e; r = 30 + 20 * (1 - d); g = 80 + 50 * (1 - d); b = 150 + 40 * (1 - d); water = true; }
          if (alat > 1.28 - terra * 0.3 && terra < 0.95) { r = 236; g = 240; b = 244; water = false; }
          break;
        }
        case 'venus': { const s = Math.sin(lat * 6 + v * 4 + lon * 0.5); r = 226 + s * 18; g = 190 + s * 20; b = 120 + s * 16; if (terra > 0) { r += (90 - r) * terra * 0.8; g += (150 - g) * terra * 0.8; b += (210 - b) * terra * 0.8; } break; }
        case 'jupiter': { const s = Math.sin(lat * 14 + v * 2.2), s2 = Math.sin(lat * 37 + v * 5); r = 210 + s * 30 + s2 * 6; g = 172 + s * 32 + s2 * 6; b = 128 + s * 34 + s2 * 5; const dl = (lat + 0.38) / 0.1, dn = ((lon - 0.8 + PI) % TAU - PI) / 0.22, q = dl * dl + dn * dn; if (q < 1) { const k = 1 - q * q; r += (196 - r) * k; g += (92 - g) * k; b += (62 - b) * k; } break; }
        case 'saturn': { const s = Math.sin(lat * 11 + v * 1.6), s2 = Math.sin(lat * 31 + v * 4); r = 226 + s * 14 + s2 * 4; g = 204 + s * 16 + s2 * 4; b = 150 + s * 18 + s2 * 3; break; }
        case 'uranus': { const s = Math.sin(lat * 6 + v); r = 160 + s * 8; g = 214 + s * 8; b = 222 + s * 6; break; }
        case 'neptune': { const s = Math.sin(lat * 8 + v * 2); r = 60 + s * 12; g = 98 + s * 16; b = 214 + s * 14; const dl = (lat + 0.35) / 0.08, dn = ((lon + 1.2 + PI) % TAU - PI) / 0.18; if (dl * dl + dn * dn < 1) { r = 30; g = 44; b = 120; } break; }
        case 'europa': { r = 222 + e * 20; g = 210 + e * 18; b = 188 + e * 16; if (Math.abs(v) < 0.025 || Math.abs(e - 0.1) < 0.012) { r = 150; g = 100; b = 70; } break; }
        case 'titan': { const s = Math.sin(lat * 5 + v * 2); r = 214 + s * 12; g = 150 + s * 12; b = 60 + s * 8; if (e < -0.25 && alat > 1) { r = 80; g = 60; b = 40; } break; }
        case 'exo': { if (e < 0) { r = 38; g = 70 + e * 30; b = 130 + e * 40; water = true; } else { r = 122 + v * 60; g = 52 + v * 30; b = 104 + v * 40; if (e > 0.35) { r = 150; g = 140; b = 150; } } if (alat > 1.3) { r = 230; g = 232; b = 240; water = false; } break; }
        case 'exo2': { if (e < 0.05) { r = 30; g = 92 + e * 30; b = 140 + e * 40; water = true; } else { r = 44 + v * 60; g = 140 + v * 40; b = 128 + v * 30; if (v > 0.15) { r = 210; g = 150; b = 80; } } break; }
      }
      if (sh && !water) { const s = sh[i]; r *= s; g *= s; b *= s; }
      if (cloudK) { const a = smooth(0.08, 0.4, cld[i]) * cloudK; if (a > 0.01) { r += (250 - r) * a; g += (251 - g) * a; b += (253 - b) * a; if (a > 0.3) water = false; } }
      if (water) wet[i] = 1;
      r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;
      c32[i] = (r | 0) | ((g | 0) << 8) | ((b | 0) << 16);
    }
  }
}
function planetLights(p, tx) {
  tx.lights.fill(0);
  const W2 = tx.w, H2 = tx.h, sc = W2 / PTW;
  for (const c of S.space.col[p.id] || []) {
    const cx = Math.floor((c.lon + PI) / TAU * W2), cy = Math.floor((PI / 2 - c.lat) / PI * H2);
    const rad = clamp(2 + Math.log10(c.pop / 1e3 + 1) * 2.4, 2, 14) * sc;
    for (let dy = -Math.ceil(rad); dy <= rad; dy++) for (let dx = -Math.ceil(rad * 1.5); dx <= rad * 1.5; dx++) {
      const y = cy + dy; if (y < 0 || y >= H2) continue;
      const x = ((cx + dx) % W2 + W2) % W2, d2 = (dx / 1.5) * (dx / 1.5) + dy * dy;
      if (d2 > rad * rad) continue;
      const hh = hash2(((x / sc) | 0) + 9000, (y / sc) | 0);
      tx.lights[y * W2 + x] += Math.exp(-d2 / (rad * rad * 0.4)) * ((hh & 255) > 90 ? 0.9 : 0.2);
    }
  }
}
// fractional texture row (0..1) per globe pixel, for bilinear sampling; rebuilt with the globe tables
function planetFy(g) {
  const P = g.P, R = g.R, q = g.q, bx0 = g.box.x, by0 = g.box.y, gw = g.gc.width, gh = g.gc.height;
  if (!P.fy || P.fy.length < P.cap) P.fy = new Float32Array(P.cap);
  const fy = P.fy, cp = Math.cos(g.pitch), sp = Math.sin(g.pitch);
  let k = 0;
  for (let py = 0; py < gh; py++) {
    const vy = -(by0 + (py + 0.5) / q - g.cy) / R;
    for (let px = 0; px < gw; px++) {
      const vx = (bx0 + (px + 0.5) / q - g.cx) / R, d2 = vx * vx + vy * vy;
      if (d2 >= 1) continue;
      const vz = Math.sqrt(1 - d2), wy = vy * cp + vz * sp;
      fy[k++] = (PI / 2 - Math.asin(clamp(wy, -1, 1))) / PI;
    }
  }
}
function P0reset(g) { g.P.roW = -1; }
function planetRender(g, tx, p) {
  if (g.dirty) { globeTables(g); planetFy(g); P0reset(g); }
  const d = g.img.data, P = g.P;
  const n = P.n, idx = P.idx, ptx = P.tx, Fy = P.fy, Lt = P.Lt, Nt = P.Nt, Sp = P.Sp, Rim = P.Rim, Al = P.Al;
  const W2 = tx.w, H2 = tx.h, sx = W2 / TW, rotTex = (g.rot / TAU) * W2, c32 = tx.c32, li = tx.lights, wet = tx.wet, rs = tx.rs;
  const atm = ATM[p.type];
  const rimK = atm ? 0.7 : 0.15, ac = atm || [200, 200, 200];
  const bil = GFX.detail >= 2 && g.R * g.q * 4 > W2 * 1.4, anim = GFX.level >= 1 && BANDED[p.type];
  // gas giants: zonal jets drift at latitude-dependent speeds (texels at texture resolution)
  if (anim) { const sp = W2 / 512 * (p.type === 'venus' ? 2.2 : 1.4); for (let y = 0; y < H2; y++) { const lat = PI / 2 - (y + 0.5) / H2 * PI; let s = animT * sp * Math.sin(lat * 9 + 0.6) * Math.cos(lat); s -= Math.floor(s / W2) * W2; rs[y] = s; } }
  const Hm = H2 - 1;
  if (!bil && !anim) {
    // fast path (gfx 0/1 and unmagnified views): nearest texel, precomputed row offsets
    if (P.roW !== W2 || P.roN !== n) { if (!P.ro || P.ro.length < P.cap) P.ro = new Int32Array(P.cap); for (let k = 0; k < n; k++) P.ro[k] = Math.min(Hm, (Fy[k] * H2) | 0) * W2; P.roW = W2; P.roN = n; }
    const ro = P.ro;
    for (let k = 0; k < n; k++) {
      let fx = ptx[k] * sx + rotTex; fx -= Math.floor(fx / W2) * W2;
      const i = ro[k] + (fx < W2 ? fx | 0 : 0), A = c32[i], L = Lt[k];
      let r = (A & 255) * L, gg = ((A >> 8) & 255) * L, b = ((A >> 16) & 255) * L;
      if (wet !== null && wet[i] === 1) { const s = Sp[k] * 0.9; r += s; gg += s; b += s * 0.95; }
      const lt = li[i];
      if (lt > 0) { const v = Math.min(1.2, lt) * (0.25 + Nt[k] * 0.9); r += 255 * v; gg += 214 * v; b += 150 * v; }
      const rim = Rim[k] * rimK, rl = 0.15 + L * 0.85;
      r += (ac[0] * rl - r) * rim; gg += (ac[1] * rl - gg) * rim; b += (ac[2] * rl - b) * rim;
      const oo = idx[k]; d[oo] = r; d[oo + 1] = gg; d[oo + 2] = b; d[oo + 3] = Al[k] * 255;
    }
    g.gctx.putImageData(g.img, 0, 0);
    return;
  }
  for (let k = 0; k < n; k++) {
    let fy = Fy[k] * H2 - 0.5; if (fy < 0) fy = 0; else if (fy > Hm) fy = Hm;
    const y0 = fy | 0;
    let fx = ptx[k] * sx + rotTex + (anim ? rs[y0] : 0); fx -= Math.floor(fx / W2) * W2; if (fx >= W2) fx = 0;
    let r, gg, b, i;
    if (bil) {
      let fxs = fx - 0.5; if (fxs < 0) fxs += W2;
      const x0 = fxs | 0, x1 = x0 + 1 === W2 ? 0 : x0 + 1, wx = fxs - x0, wy = fy - y0, y1 = y0 < Hm ? y0 + 1 : y0;
      const r0 = y0 * W2, r1 = y1 * W2, A = c32[r0 + x0], B = c32[r0 + x1], C = c32[r1 + x0], D = c32[r1 + x1];
      const w00 = (1 - wx) * (1 - wy), w01 = wx * (1 - wy), w10 = (1 - wx) * wy, w11 = wx * wy;
      r = (A & 255) * w00 + (B & 255) * w01 + (C & 255) * w10 + (D & 255) * w11;
      gg = ((A >> 8) & 255) * w00 + ((B >> 8) & 255) * w01 + ((C >> 8) & 255) * w10 + ((D >> 8) & 255) * w11;
      b = ((A >> 16) & 255) * w00 + ((B >> 16) & 255) * w01 + ((C >> 16) & 255) * w10 + ((D >> 16) & 255) * w11;
      i = (wy < 0.5 ? r0 : r1) + (wx < 0.5 ? x0 : x1);
    } else {
      i = y0 * W2 + (fx | 0); const A = c32[i];
      r = A & 255; gg = (A >> 8) & 255; b = (A >> 16) & 255;
    }
    const L = Lt[k];
    r *= L; gg *= L; b *= L;
    if (wet !== null && wet[i] === 1) { const s = Sp[k] * 0.9; r += s; gg += s; b += s * 0.95; }
    const lt = li[i];
    if (lt > 0) { const v = Math.min(1.2, lt) * (0.25 + Nt[k] * 0.9); r += 255 * v; gg += 214 * v; b += 150 * v; }
    const rim = Rim[k] * rimK, rl = 0.15 + L * 0.85;
    r += (ac[0] * rl - r) * rim; gg += (ac[1] * rl - gg) * rim; b += (ac[2] * rl - b) * rim;
    const oo = idx[k]; d[oo] = r; d[oo + 1] = gg; d[oo + 2] = b; d[oo + 3] = Al[k] * 255;
  }
  g.gctx.putImageData(g.img, 0, 0);
}
let lastPlanetLights = 0, lastPlanetLightsId = null, planetScreen = [];
function drawPlanetScene() {
  const p = PLANET_BY_ID[planetSel]; if (!p) return;
  const tx = planetTexture(p), L = GFX.level;
  if (animT - lastPlanetLights > 1 || lastPlanetLightsId !== tx) { planetLights(p, tx); lastPlanetLights = animT; lastPlanetLightsId = tx; }
  const wide = view.w > 900, availW = wide ? view.w - 262 - 312 : view.w;
  GP.w = view.w; GP.h = view.h; GP.dpr = view.dpr; GP.cx = wide ? 262 + availW / 2 : view.w / 2; GP.cy = wide ? view.h / 2 : view.h * 0.42;
  const R = Math.min(availW * 0.9, view.h) * 0.38 * GP.zoom;
  if (Math.abs(R - GP.R) > 0.5) { GP.R = R; GP.dirty = true; }
  if (GP._cx !== GP.cx || GP._cy !== GP.cy || GP._w !== view.w) { GP._cx = GP.cx; GP._cy = GP.cy; GP._w = view.w; GP.dirty = true; }
  if (!drag) { GP.rot -= 0.0025; if (Math.abs(GP.vr) > 1e-4) { GP.rot += GP.vr / 60; GP.vr *= 0.94; } }
  planetRender(GP, tx, p);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  drawSpaceBackdrop(-GP.cx * 0.02, 0);
  if (L) {
    // warm scattered sunlight from the upper left
    const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, view.w * 0.7);
    hg.addColorStop(0, 'rgba(255,210,150,.10)'); hg.addColorStop(1, 'rgba(255,210,150,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = hg; ctx.fillRect(0, 0, view.w, view.h); ctx.globalCompositeOperation = 'source-over';
  }
  const ringShx = 0.65, ringShy = -0.76;
  if (p.rings) { if (L) drawRings(GP.cx, GP.cy, GP.R, -0.3, 0.25, false, ringShx, ringShy, 0.85); else { ctx.strokeStyle = 'rgba(226,206,150,.45)'; for (let k = 0; k < 6; k++) { ctx.lineWidth = GP.R * 0.06; ctx.beginPath(); ctx.ellipse(GP.cx, GP.cy, GP.R * (1.45 + k * 0.12), GP.R * (0.36 + k * 0.03), -0.3, PI, TAU); ctx.stroke(); } } }
  ctx.drawImage(GP.gc, 0, 0, GP.gc.width, GP.gc.height, GP.box.x, GP.box.y, GP.gc.width / GP.q, GP.gc.height / GP.q);
  const atm = ATM[p.type];
  if (atm && L) {
    // atmosphere halo, brighter toward the sun
    const ox = SUN[0] * GP.R * 0.05, oy = -SUN[1] * GP.R * 0.05, a = `${atm[0]},${atm[1]},${atm[2]}`;
    const ag = ctx.createRadialGradient(GP.cx + ox, GP.cy + oy, GP.R * 0.95, GP.cx + ox, GP.cy + oy, GP.R * 1.13);
    ag.addColorStop(0, `rgba(${a},0)`); ag.addColorStop(0.22, `rgba(${a},.32)`); ag.addColorStop(0.5, `rgba(${a},.10)`); ag.addColorStop(1, `rgba(${a},0)`);
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(GP.cx + ox, GP.cy + oy, GP.R * 1.13, 0, TAU); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
  }
  if (p.rings) {
    if (L) {
      // the rings' own shadow on the globe, then the near half of the rings
      ctx.save(); ctx.beginPath(); ctx.arc(GP.cx, GP.cy, GP.R, 0, TAU); ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = GP.R * 0.16;
      ctx.beginPath(); ctx.ellipse(GP.cx + GP.R * 0.04, GP.cy + GP.R * 0.13, GP.R * 1.55, GP.R * 0.39, -0.3, 0, PI); ctx.stroke();
      ctx.restore();
      drawRings(GP.cx, GP.cy, GP.R, -0.3, 0.25, true, ringShx, ringShy, 1);
    } else { ctx.strokeStyle = 'rgba(226,206,150,.7)'; for (let k = 0; k < 6; k++) { ctx.lineWidth = GP.R * 0.06; ctx.beginPath(); ctx.ellipse(GP.cx, GP.cy, GP.R * (1.45 + k * 0.12), GP.R * (0.36 + k * 0.03), -0.3, 0, PI); ctx.stroke(); } }
  }
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
