/* =====================================================================
   Military sprites: one renderer per sprite family (UNIT_BY_ID[id].spr,
   parameters in .vis). Ground units and ships are drawn side-on with the
   pixel-rect helper pr() (origin = feet / waterline, y up is negative);
   aircraft are drawn top-down, rotated to their heading, above their
   ground shadow. Every unit carries its nation's colour somewhere.
   ===================================================================== */
for (const u of UNITS) if (!KIND_LABEL[u.id]) KIND_LABEL[u.id] = u.name;
let MD = 1;      // facing of the sprite being drawn (1 → east, −1 → west)
function q(x, y, w, h, col) { pr(MD > 0 ? x : -x - w, y, w, h, col); }
function mixHex(h1, h2, t) {
  const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t), g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t), bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return `rgb(${r},${g},${bl})`;
}
const CAMO = ['#6a5a3a', '#6a5a3a', '#6a5a3a', '#6a5a3a', '#5a5a42', '#5d6340', '#5f6a4c', '#646d70', '#7b8794'];
const PAL = new Map();
function milPal(n) {
  const era = n.mult ? n.mult.era : 0, key = n.id * 16 + era;
  if (PAL.S !== S) { PAL.clear(); PAL.S = S; }
  let P = PAL.get(key); if (P) return P;
  const c = n.color, cm = CAMO[Math.min(era, 8)];
  P = { nat: c, natD: shade(c, 0.62), natL: shade(c, 1.25), camo: mixHex(cm, c, 0.16), camoD: mixHex(cm, '#16160f', 0.38), camoL: mixHex(cm, '#ffffff', 0.18),
    navy: era >= 8 ? '#7e8a96' : era >= 7 ? '#6d7781' : '#69727b', navyD: era >= 7 ? '#4c545c' : '#4a5158', era };
  PAL.set(key, P);
  return P;
}
const M_STEEL = '#2a2a26', M_TRACK = '#2b2a26', M_WHEEL = '#4b4a44', M_WOOD = '#7a5230', M_WOODD = '#5a3a20', M_SAIL = '#efe9da', M_FLASH = '#ffd27a';

/* ---------- foot soldiers ---------- */
const GARB = {   // [coat, trousers, accent]
  hide: ['#8a6a44', null, '#6a4a2a'], tunic: [null, null, '#c8b080'], mail: ['#8a9098', '#5a5048', null], coat: [null, '#e8e2d0', '#f2efe6'],
  drab: ['#5e6444', '#4e5238', '#3a3e2a'], exo: ['#5a636e', '#3a4048', '#9aa4ae'],
};
function sFoot(a, v, n, P, d) {
  const st = a.st, moving = st === 'walk', fight = st === 'fight' || st === 'siege';
  const skin = a.skin || SKINS[0], g = GARB[v.garb] || GARB.tunic;
  let coat = g[0] || (v.garb === 'coat' ? n.color : mixHex('#c8b48a', n.color, 0.45));
  if (v.garb === 'coat' && v.helm === 'kepi') coat = P.natD;
  const legs = g[1] || (v.garb === 'tunic' || v.garb === 'hide' ? skin : '#3a3430');
  const t4 = moving ? Math.floor(a.ph * 8) & 3 : 0, sw = t4 === 0 ? 0.45 : t4 === 2 ? -0.45 : 0;
  const up = fight && (Math.floor(a.ph * 5 + a.id) & 1);
  if (v.prone && fight && a.kind !== 'flag') {    // riflemen drop prone to shoot
    q(-3.2, -1.3, 3.4, 1.1, coat); q(-4.4, -1, 1.4, 0.8, legs); q(0.2, -1.9, 1.3, 1.3, skin); q(0, -2.2, 1.6, 0.6, P.natD);
    q(1.2, -1.5, 2.8, 0.35, '#2a2420'); if (a.flash > 0) q(4, -1.8, 0.9, 0.9, M_FLASH);
    return;
  }
  // legs (4-frame walk), body, head
  q(-0.95 + sw, -2, 0.85, 2, legs); q(0.1 - sw, -2, 0.85, 2, shade(legs.startsWith('#') ? legs : '#3a3430', 0.85));
  if (v.garb === 'drab' || v.garb === 'coat' || v.garb === 'exo') { q(-1 + sw, -0.45, 1, 0.45, '#22201c'); q(0.05 - sw, -0.45, 1, 0.45, '#22201c'); }
  q(-1, -4.1, 2, 2.2, coat);
  if (v.garb === 'mail') q(-1, -3.6, 2, 0.6, n.color);                 // tabard stripe
  else if (v.garb === 'coat' && v.helm === 'tricorn') { q(-0.6, -4, 0.3, 2, g[2]); q(0.3, -4, 0.3, 2, g[2]); }   // crossbelts
  else if (v.garb === 'drab') q(-1, -2.4, 2, 0.35, '#3a3424');
  else if (v.garb === 'exo') { q(-1.3, -4.3, 2.6, 1, g[2]); q(-1, -2.9, 2, 0.4, n.color); }
  else q(-1, -2.3, 2, 0.35, g[2] || P.natD);
  q(-0.9, -6, 1.8, 1.9, skin);
  // headgear
  switch (v.helm) {
    case 'bronze': q(-1, -6.4, 2, 0.9, '#c08a3a'); q(-0.2, -7, 0.4, 0.6, '#c08a3a'); break;
    case 'iron': q(-1, -6.4, 2, 1, '#8a9098'); if (v.crest) q(-0.6, -7.2, 1.4, 0.8, '#c0302a'); break;
    case 'tricorn': q(-1.5, -6.4, 3, 0.5, '#22201e'); q(-0.9, -7, 1.8, 0.7, '#22201e'); break;
    case 'kepi': q(-1, -6.5, 2, 0.8, P.natD); q(0.6, -5.9, 0.8, 0.25, '#1a1a1a'); break;
    case 'steel': q(-1.3, -6.1, 2.6, 0.4, '#454a36'); q(-0.95, -6.7, 1.9, 0.7, '#4e5440'); break;
    case 'visor': q(-1.1, -6.6, 2.2, 1.3, '#3a4048'); q(0, -5.7, 1.1, 0.4, v.visor || '#4ff'); break;
    default: q(-0.9, -6.3, 1.8, 0.6, a.hair || HAIRS[0]);
  }
  if (a.kind === 'flag') {
    q(1, -11, 0.4, 9, '#5a4028');
    const wv = Math.sin(animT * 5 + a.id) * 0.35;
    q(1.4, -11 + wv, 4, 2.6, n.color); q(1.4, -8.6 + wv, 4, 0.4, P.natD); q(2.6, -10.2 + wv, 1.4, 1, P.natL);
    return;
  }
  // weapons
  switch (v.wpn) {
    case 'spear': { const th = up ? 1 : 0; q(0.9 + th, up ? -6.2 : -8, 0.4, up ? 0.4 : 5.6, '#7a5a30'); if (up) { q(0.9, -6.4, 4.4, 0.35, '#7a5a30'); q(5.2, -6.6, 0.8, 0.7, v.garb === 'hide' ? '#8a8a8a' : '#c08a3a'); } else q(0.8, -8.6, 0.6, 0.8, v.garb === 'hide' ? '#8a8a8a' : '#c08a3a'); break; }
    case 'sword': q(0.9, up ? -7 : -5.2, 0.4, 2.4, '#d0d4da'); q(0.6, up ? -4.8 : -3, 1, 0.35, '#8a6a3a'); break;
    case 'bow': q(1, -6.4, 0.4, 4, M_WOOD); q(1.4, -6.2, 0.25, 3.6, '#e8e0c8'); if (up) q(0.6, -4.6, 2, 0.25, '#c8b080'); q(-1.8, -5, 0.8, 2, '#6a4a2a'); break;
    case 'xbow': q(0.4, -4.4, 2.6, 0.45, M_WOOD); q(2.2, -5, 0.35, 1.6, '#5a5a5a'); break;
    case 'musket': if (fight) { q(0.4, -4.6, 3.6, 0.4, '#3a2a1c'); if (a.flash > 0) q(4, -5, 1, 1, M_FLASH); } else q(0.9, -7.6, 0.4, 5, '#3a2a1c'); break;
    case 'rifle': if (fight) { q(0.4, -4.5, 3.2, 0.4, '#2a2420'); q(3.6, -4.4, 0.8, 0.2, '#c8ccd2'); if (a.flash > 0) q(4.4, -4.8, 0.9, 0.9, M_FLASH); } else { q(0.9, -7.4, 0.35, 4.6, '#2a2420'); q(0.95, -8.2, 0.2, 0.8, '#c8ccd2'); } break;
    case 'smg': q(0.5, -4.4, 2.2, 0.5, '#1e1e1c'); q(1, -4, 0.4, 0.8, '#1e1e1c'); if (a.flash > 0) q(2.7, -4.6, 0.8, 0.8, M_FLASH); break;
    case 'heavy': q(0.3, -4.6, 3.2, 0.8, '#2e3238'); q(3.4, -4.4, 0.6, 0.35, '#1a1c1e'); if (a.flash > 0) q(4, -4.8, 1, 1, '#9ff8ff'); break;
  }
  if (v.shield === 'round') { q(-1.9, -4.6, 1.3, 2.4, n.color); q(-1.6, -3.8, 0.7, 0.7, '#c08a3a'); }
  else if (v.shield === 'rect') { q(-2, -5, 1.2, 3.4, n.color); q(-1.8, -3.6, 0.8, 0.6, '#d8c070'); }
}

/* ---------- cavalry & chariots ---------- */
function sHorse(a, v, n, P, d) {
  const moving = a.st === 'walk', gal = moving ? Math.floor(a.ph * 10) & 1 : 0;
  const hc = a.id % 3 === 0 ? '#3a2a1e' : a.id % 3 === 1 ? '#7a4e2a' : '#8a6a4a', hd = shade(hc, 0.7);
  const horse = (ox, col) => {
    q(ox - 3, -3.6, 6, 1.9, col); q(ox + 2.2, -5, 1.2, 1.8, col); q(ox + 2.8, -5.6, 1.8, 1, col); q(ox - 3.7, -3.6, 0.8, 2, shade(col.startsWith('#') ? col : '#5a3a20', 0.7));
    const l1 = gal ? 0.5 : 0, l2 = gal ? 0 : 0.5;
    q(ox - 2.6 + l1, -1.7, 0.55, 1.7, hd); q(ox - 1.6 - l1, -1.7, 0.55, 1.7, hd); q(ox + 1.2 + l2, -1.7, 0.55, 1.7, hd); q(ox + 2 - l2, -1.7, 0.55, 1.7, hd);
  };
  if (v.cart) {    // chariot: two horses, a cart and two crew
    horse(1.2, hd); horse(0.6, hc);
    q(-4.6, -3.4, 2.6, 1.6, M_WOOD); q(-4.6, -3.8, 2.6, 0.4, n.color); q(-4.4, -2, 1.8, 1.8, M_WOODD); q(-3.8, -1.4, 0.6, 0.6, '#c08a3a');
    q(-4.4, -5.6, 1, 2.2, mixHex('#c8b48a', n.color, 0.5)); q(-4.4, -6.8, 1, 1.1, a.skin || SKINS[0]);
    q(-3.3, -5.8, 1, 2.4, mixHex('#c8b48a', n.color, 0.5)); q(-3.3, -7, 1, 1.1, a.skin || SKINS[0]); q(-2.6, -9.2, 0.35, 5, M_WOOD); q(-2.7, -9.6, 0.6, 0.6, '#c08a3a');
    return;
  }
  horse(0, hc);
  if (v.barding) { q(-3.2, -3.9, 6.2, 2.1, n.color); q(-3.2, -2.3, 6.2, 0.4, P.natD); q(2.1, -5.4, 1.4, 1.2, '#8a9098'); }
  const knight = v.rider === 'knight', body = knight ? '#9aa2aa' : mixHex('#c8b48a', n.color, 0.45);
  q(-0.8, -4.6, 1, 1.6, '#3a3430'); q(-1, -6.8, 2, 2.4, body); if (knight) q(-1, -6.3, 2, 0.6, n.color);
  q(-0.9, -8.6, 1.8, 1.8, knight ? '#8a9098' : a.skin || SKINS[0]); if (knight) { q(0.2, -8, 0.7, 0.3, '#1a1a1a'); q(-0.5, -9.4, 1, 0.8, n.color); } else q(-0.9, -8.9, 1.8, 0.6, a.hair || HAIRS[0]);
  if (v.wpn === 'lance') { q(0.6, -6.4, 6.6, 0.35, '#8a6a40'); q(5.2, -6.9, 1.4, 0.6, n.color); }
  else { const up = a.st === 'fight' && (Math.floor(a.ph * 5) & 1); q(0.8, up ? -6 : -9.5, up ? 4.5 : 0.35, up ? 0.35 : 5.4, '#7a5a30'); }
}

/* ---------- guns & siege engines ---------- */
function crew(x, coat, skin, helm, kneel) {
  const h = kneel ? 1.2 : 2;
  q(x - 0.45, -h, 0.9, h, '#3a3430'); q(x - 0.5, -h - 1.8, 1, 1.8, coat); q(x - 0.45, -h - 3.3, 0.9, 1.5, skin); q(x - 0.55, -h - 3.6, 1.1, 0.5, helm);
}
function sGun(a, v, n, P, d) {
  const rec = a.rec || 0, coat = P.era >= 5 ? P.camo : P.era >= 3 ? n.color : mixHex('#c8b48a', n.color, 0.45), helm = P.era >= 5 ? '#4e5440' : P.era >= 3 ? '#22201e' : a.hair || HAIRS[0], skin = a.skin || SKINS[0];
  switch (v.type) {
    case 'catapult': {
      q(-3, -1.8, 6, 0.7, M_WOOD); q(-2.6, -1.2, 1.2, 1.2, M_WOODD); q(1.4, -1.2, 1.2, 1.2, M_WOODD); q(-0.4, -4.2, 0.8, 2.6, M_WOOD);
      const fired = (a.rec || 0) > 0.05;
      if (fired) { q(-0.2, -8.4, 0.5, 4.4, '#8a6a40'); q(-0.6, -9, 1.3, 0.8, '#5a4a3a'); }
      else { for (let k = 0; k < 4; k++) q(-0.5 - k * 0.9, -3.8 + k * 0.4, 1, 0.5, '#8a6a40'); q(-4.4, -2.6, 1.3, 0.9, '#5a4a3a'); q(-4.1, -3, 0.8, 0.6, '#9a9088'); }
      crew(3.6, coat, skin, helm);
      return;
    }
    case 'bombard':
      q(-2.8, -1.2, 5.4, 1.2, M_WOOD); q(-2.4 - rec, -2.8, 4.6, 1.6, '#2e2e30'); q(1.9 - rec, -3, 0.6, 2, '#3e3e42'); q(-2.8 - rec, -2.5, 0.6, 1, '#3e3e42');
      if (a.flash > 0) q(2.6, -3.2, 1.6, 1.6, M_FLASH);
      crew(-4.2, coat, skin, helm);
      return;
    case 'field': case 'howitzer': {
      const hw = v.type === 'howitzer', bar = hw ? (P.era >= 5 ? '#4a4e42' : '#3a3a3e') : '#9a7a3a';
      q(-3.8 - rec, -1.1, 3.2, 0.6, M_WOODD);
      if (hw) { for (let k = 0; k < 4; k++) q(-0.6 + k * 0.85 - rec, -2.8 - k * 0.7, 1.2, 1, bar); if (a.flash > 0) q(3 - rec, -6.4, 1.6, 1.6, M_FLASH); }
      else { q(-0.6 - rec, -2.7, 4.6, 0.75, bar); q(3.6 - rec, -2.85, 0.5, 1, bar); if (a.flash > 0) q(4.2, -3.2, 1.4, 1.4, M_FLASH); }
      q(-1.3, -2.8, 2.6, 2.6, P.era >= 5 ? '#2a2a26' : M_WOODD); q(-0.9, -2.4, 1.8, 1.8, P.era >= 5 ? '#3c3c36' : '#8a6a40'); q(-0.3, -1.8, 0.6, 0.6, '#2a2018');
      if (P.era >= 5) q(-1.6, -3.6, 2.4, 1, P.camo);
      crew(-4.4, coat, skin, helm, a.st === 'fight'); if ((v.crew || 1) > 1) crew(-5.8, coat, skin, helm);
      return;
    }
    case 'aa': {
      q(-2.6, -0.7, 5.2, 0.6, '#3a3a36'); q(-2.6, -1.2, 0.5, 0.5, '#3a3a36'); q(2.1, -1.2, 0.5, 0.5, '#3a3a36');
      q(-1, -2.4, 2, 1.7, P.camo); q(-1.2, -2.8, 2.4, 0.5, P.camoD);
      for (let k = 0; k < 5; k++) { q(0 + k * 0.55, -3.2 - k * 0.9, 0.45, 1, '#2a2a26'); q(0.6 + k * 0.55, -3.2 - k * 0.9, 0.45, 1, '#2a2a26'); }
      if (a.flash > 0) q(2.6, -8.4, 1.4, 1.4, M_FLASH);
      q(-0.4, -2.2, 0.8, 0.5, n.color);
      crew(-3.4, coat, skin, helm);
      return;
    }
  }
}

/* ---------- tracked & wheeled vehicles ---------- */
const HULL = {
  light: { L: 5, h: 1.6, tw: 1.9, th: 1.1, tx: -0.3 }, med: { L: 6, h: 1.8, tw: 2.6, th: 1.4, tx: -0.4 }, heavy: { L: 7.5, h: 2.2, tw: 3.3, th: 1.7, tx: -0.6 },
  td: { L: 6.5, h: 1.7, tw: 0, th: 0, tx: 0 }, mbt: { L: 7, h: 1.6, tw: 3.6, th: 1.3, tx: -0.8 }, ifv: { L: 5.2, h: 2.2, tw: 1.4, th: 0.9, tx: 0.2 },
  spg: { L: 6.5, h: 1.8, tw: 3, th: 1.7, tx: -1.2 }, truck: { L: 6, h: 1.5, tw: 0, th: 0, tx: 0 },
};
function treads(L, moving, ph, skirts, col) {
  q(-L / 2, -1.35, L, 1.35, M_TRACK);
  const off = moving ? (Math.floor(ph * 12) & 1) * 0.4 : 0;
  if (!skirts) for (let x = -L / 2 + 0.35 + off; x < L / 2 - 0.8; x += 1.05) q(x, -1.05, 0.75, 0.75, M_WHEEL);
  else { q(-L / 2, -1.6, L, 1, col); q(-L / 2, -0.6, L, 0.15, '#1e1e1a'); }
}
function sTracked(a, v, n, P, d) {
  const moving = a.st === 'walk', H = HULL[v.hull] || HULL.med, L = v.len || H.L, rec = a.rec || 0;
  const body = P.camo, dark = P.camoD, lite = P.camoL;
  const shake = v.shake && moving ? (Math.floor(a.ph * 14) & 1) * 0.15 : 0;
  const flash = (x, y, s) => { if (a.flash > 0) { q(x, y - s / 2, s, s, M_FLASH); q(x + s * 0.25, y - s * 0.25, s * 0.5, s * 0.5, '#fffbe8'); } };
  if (v.hull === 'truck') {
    q(-L / 2, -1.9, L, 0.6, '#2a2a26');
    for (const wx of [-L / 2 + 0.5, -L / 2 + 1.8, L / 2 - 1.5]) { q(wx, -1.1, 1.1, 1.1, '#1e1e1c'); q(wx + 0.35, -0.75, 0.4, 0.4, '#5a5a54'); }
    q(L / 2 - 1.8, -3.4, 1.8, 1.6, body); q(L / 2 - 0.9, -3.1, 0.7, 0.7, '#9ab8c8'); q(-L / 2, -2.5, L - 1.9, 0.6, dark);
    if (v.launcher === 'box') { const up = 1.2; q(-L / 2 + 0.3, -3.2 - up, 3.6, 1.8, lite); q(-L / 2 + 0.3, -3.2 - up, 3.6, 0.35, dark); for (let k = 0; k < 3; k++) q(-L / 2 + 3.6, -2.9 - up + k * 0.5, 0.3, 0.3, '#1a1a1a'); q(-L / 2 + 1.2, -2.6, 1.2, 0.8, dark); }
    else { for (let k = 0; k < 2; k++) q(-L / 2 + 0.4 + k * 0.2, -3.4 - k * 0.9, 4, 0.7, k ? lite : body); q(-L / 2 + 0.6, -2.7, 0.8, 0.8, dark); }
    q(L / 2 - 1.5, -3.8, 1.2, 0.4, n.color);
    return;
  }
  treads(L, moving, a.ph, v.skirts, dark);
  const y0 = -1.35 - H.h - shake;
  if (v.early && S.year < 1930) {     // rhomboid Mark I silhouette: tracks run round the whole hull
    q(-L / 2 - 0.4, -2.8, L + 0.8, 1.6, M_TRACK); q(-L / 2 + 0.2, -3.6, L - 0.4, 1.2, M_TRACK); q(-L / 2 + 0.6, -3.1, L - 1.2, 1.8, body);
    q(-0.8, -2.8, 1.6, 0.9, dark); q(0.6, -2.5, 1.6, 0.35, '#262622'); q(-0.4, -3.3, 0.9, 0.5, n.color); flash(2.2, -2.3, 0.9);
    return;
  }
  q(-L / 2 + 0.2, y0, L - 0.4, H.h, body); q(-L / 2 + 0.2, y0, L - 0.4, 0.35, lite);
  q(L / 2 - 0.2, y0 + 0.3, 0.4, H.h - 0.3, dark);   // sloped glacis
  if (v.hull === 'td') {
    q(-L / 2 + 0.8, y0 - 1.1, L - 2.4, 1.1, body); q(L / 2 - 1.6, y0 - 0.9, 0.4, 0.9, dark);
    q(L / 2 - 1.8 - rec, y0 - 0.7, (v.gun || 7) * 0.75, 0.42, M_STEEL); q(L / 2 - 1.8 - rec + (v.gun || 7) * 0.75, y0 - 0.85, 0.6, 0.7, M_STEEL); flash(L / 2 - 1.2 + (v.gun || 7) * 0.75 - rec, y0 - 0.5, 1.2);
    q(-L / 2 + 1.2, y0 - 0.8, 0.9, 0.6, n.color);
    return;
  }
  if (v.hull === 'heavy' && v.turret === 'rails') {
    const ty = y0 - 1.6; q(-1.8, ty, 3.6, 1.6, body); q(-1.8, ty, 3.6, 0.3, lite);
    q(1.4 - rec, ty + 0.25, 6.5, 0.32, '#3a4048'); q(1.4 - rec, ty + 1.0, 6.5, 0.32, '#3a4048');
    const fl = 0.5 + 0.5 * Math.sin(animT * 9 + a.id); ctx.globalAlpha = 0.45 + 0.4 * fl; q(1.6 - rec, ty + 0.6, 6.2, 0.35, v.beam || '#8ff'); ctx.globalAlpha = 1;
    q(-1.4, ty + 0.5, 0.9, 0.6, n.color);
    return;
  }
  const tw = H.tw, th = H.th, tx = H.tx, ty = y0 - th;
  if (v.turret === 'open') { q(tx - tw / 2, ty, tw, th, body); q(tx - tw / 2, ty, 0.3, th, dark); q(tx + tw / 2 - 0.3, ty, 0.3, th, dark); for (let k = 0; k < 4; k++) q(tx + 0.6 + k * 0.9 - rec, ty - 0.2 - k * 0.55, 1.1, 0.6, M_STEEL); flash(tx + 4.1 - rec, ty - 2.4, 1.2); q(tx - 0.9, ty + 0.5, 0.8, 0.5, n.color); return; }
  if (v.turret === 'optic') { q(tx - 1.4, ty - 0.4, 2.8, th + 0.4, body); q(tx - 1, ty - 1.4, 2, 1.1, lite); q(tx + 0.3, ty - 1.2, 0.8, 0.8, v.beam || '#6ff'); q(tx - 1.2, ty + 0.3, 0.9, 0.5, n.color); return; }
  if (v.turret === 'wedge') { q(tx - tw / 2, ty, tw, th, body); q(tx + tw / 2, ty + 0.35, 0.7, th - 0.35, dark); q(tx - tw / 2, ty, tw, 0.3, lite); q(tx - tw / 2 - 0.5, ty + 0.2, 0.6, 0.9, dark); }
  else if (v.turret === 'box') { q(tx - tw / 2, ty, tw, th, body); q(tx - tw / 2, ty, tw, 0.35, lite); q(tx - 0.4, ty - 0.45, 1, 0.45, dark); }
  else if (v.turret === 'small') { q(tx - tw / 2, ty, tw, th, body); q(tx - tw / 2 + 0.3, ty - 0.3, tw - 0.6, 0.3, dark); }
  else { q(tx - tw / 2, ty + 0.2, tw, th - 0.2, body); q(tx - tw / 2 + 0.3, ty, tw - 0.6, 0.3, body); q(tx - tw / 2 + 0.3, ty, tw - 0.6, 0.15, lite); }
  const gl = (v.gun || 3) * 0.75, gy = ty + th * 0.4;
  q(tx + tw / 2 - rec, gy - 0.18, gl, v.gun >= 5 ? 0.42 : 0.34, M_STEEL);
  if (v.gun >= 5) q(tx + tw / 2 + gl * 0.55 - rec, gy - 0.28, 0.6, 0.6, M_STEEL);
  flash(tx + tw / 2 + gl - rec, gy, v.gun >= 5 ? 1.4 : 1);
  q(tx - tw / 2 + 0.3, ty + th * 0.35, Math.min(0.9, tw * 0.35), 0.55, n.color);
  if (v.dismount && a.st === 'hold' && P.era >= 6) { q(-L / 2 - 1.2, -2, 0.8, 2, P.camoD); q(-L / 2 - 1.2, -3.2, 0.8, 1.2, a.skin || SKINS[0]); }
}
// trucks carrying motorised infantry to the line
function sTruck(n, P, moving, ph) {
  q(-3, -1.9, 6, 0.6, '#2a2a26');
  for (const wx of [-2.6, -1.4, 1.6]) q(wx, -1.1, 1.1, 1.1, '#1e1e1c');
  q(1.2, -3.4, 1.8, 1.6, P.camo); q(1.9, -3.1, 0.7, 0.7, '#9ab8c8'); q(-3, -4, 4.1, 2.2, P.camoD); q(-3, -4, 4.1, 0.35, P.camoL); q(-2, -3.4, 1, 0.8, n.color);
}

/* ---------- walkers & hover tanks ---------- */
function sMech(a, v, n, P, d) {
  const moving = a.st === 'walk', t = moving ? Math.floor(a.ph * 4) & 3 : 0, st = [0, 0.5, 0, -0.5][t], lift = [0, 0.5, 0, 0.5][t];
  const mc = '#9aa2aa', md = '#5a6068';
  q(-1.6 + st, -2.6 - (t === 1 ? lift : 0), 1.1, 2.6, md); q(0.5 - st, -2.6 - (t === 3 ? lift : 0), 1.1, 2.6, md);
  q(-2 + st, -0.5, 1.6, 0.5, '#3a3e44'); q(0.3 - st, -0.5, 1.6, 0.5, '#3a3e44');
  q(-2.1, -5.2, 4.2, 2.8, mc); q(-2.1, -5.2, 4.2, 0.4, '#c0c8d0'); q(-2.1, -3.8, 4.2, 0.5, n.color);
  q(-0.8, -6.3, 1.8, 1.1, '#7a828a'); q(0.2, -6, 0.7, 0.45, '#ff4a4a');
  q(1.9, -5, 1.2, 1.4, md); q(2.6, -4.6, 2.6, 0.6, '#3a3e44'); if (a.flash > 0) q(5.2, -4.8, 1, 1, '#9ff8ff');
  q(-3.1, -5, 1.2, 1.2, md); q(-3.4, -6.6, 1, 1.8, '#4a5058');
}
function sHover(a, v, n, P, d) {
  const fl = (v.float || 1.5) + Math.sin(a.ph * 2.2) * 0.25, L = v.len || 7, y0 = -fl - 1.4;
  ctx.globalAlpha = 0.35 + 0.15 * Math.sin(a.ph * 6); q(-L / 2 + 0.6, -0.6, L - 1.2, 0.6, v.glow || '#5ff'); q(-L / 2 + 1.4, -fl - 0.2, L - 2.8, fl - 0.2, v.glow || '#5ff'); ctx.globalAlpha = 1;
  q(-L / 2, y0, L, 1.4, '#c8d2dc'); q(-L / 2 + 0.6, y0 + 1.1, L - 1.2, 0.4, '#5a6470'); q(L / 2 - 0.2, y0 + 0.3, 0.8, 0.9, '#a8b2bc');
  q(-1.6, y0 - 1.1, 3.4, 1.1, '#dfe6ee'); q(1.8 - (a.rec || 0), y0 - 0.7, 4.2, 0.35, '#3a4048'); q(-1.2, y0 - 0.8, 1, 0.5, n.color);
  if (a.flash > 0) q(6, y0 - 0.9, 1, 1, v.glow || '#5ff');
}

/* ---------- ships (side view, origin on the waterline) ---------- */
function wakeFx(L, moving, ph, z) {
  if (!moving) return;
  ctx.globalAlpha = 0.75; q(L / 2 - 0.2, -0.5, 1.3, 0.35, '#f4fbff'); q(L / 2 + 0.6, -0.2, 0.9, 0.25, '#e6f4ff');
  for (let k = 0; k < 4; k++) { ctx.globalAlpha = 0.5 - k * 0.11; const o = ((ph * 3 + k) % 1) * 0.6; q(-L / 2 - 1.2 - k * 1.6 - o, -0.18, 1.4 + k * 0.4, 0.3, '#eaf6ff'); }
  ctx.globalAlpha = 1;
}
function sOared(a, v, n, P, d) {
  const L = v.len || 9, moving = a.st === 'walk' || a.st === 'fight';
  wakeFx(L, moving, a.ph);
  q(-L / 2, -1.5, L, 1.5, '#6a4626'); q(-L / 2, -1.9, L, 0.4, '#8a5e36'); q(-L / 2, -1.2, L, 0.25, n.color);
  q(L / 2 - 0.7, -2.8, 0.7, 1.3, '#6a4626'); q(L / 2, -0.7, 1.2, 0.45, '#b08a3a');
  q(-L / 2, -3, 0.6, 1.5, '#6a4626'); q(-L / 2 - 0.4, -3.4, 0.8, 0.5, '#6a4626');
  const s = Math.sin(a.ph * (moving ? 7 : 2));
  for (let k = 0; k < 6; k++) { const x = -L / 2 + 1.3 + k * 1.15; q(x, -0.6 + s * 0.4, 0.3, 1.1, '#8a6a40'); }
  q(-0.2, -8, 0.4, 6.2, '#4a3424'); q(-2.4, -7.6, 4.8, 3.8, '#e8dcc0'); q(-2.4, -6.5, 4.8, 0.9, n.color); q(-2.4, -4.2, 4.8, 0.4, '#c8bca0');
  if (a.flash > 0) q(L / 2 + 0.6, -1.6, 1, 1, '#fff4b0');
}
function sSail(a, v, n, P, d) {
  const L = v.len || 10, moving = a.st === 'walk', masts = v.masts || 2, hullC = v.decks ? '#4a3220' : '#6a4626';
  wakeFx(L, moving, a.ph);
  const hh = v.decks ? 2.6 : v.slim ? 1.6 : 2;
  q(-L / 2 + 0.4, -hh, L - 0.8, hh, hullC); q(-L / 2 + 0.8, -0.5, L - 1.6, 0.5, '#2a1e14');
  q(L / 2 - 0.4, -hh + 0.4, 1.4, 0.5, hullC); q(L / 2 + 0.8, -hh - 0.2, 1.6, 0.25, '#4a3424');   // bow & bowsprit
  if (v.castles) { q(-L / 2 + 0.2, -hh - 1.8, 2.4, 1.8, hullC); q(L / 2 - 2.2, -hh - 1.2, 1.8, 1.2, hullC); q(-L / 2 + 0.2, -hh - 1.8, 2.4, 0.3, '#c8a040'); }
  else { q(-L / 2 + 0.3, -hh - 1, 2, 1, hullC); }
  if (v.ports || v.decks) { const rows = v.decks || 1; for (let r = 0; r < rows; r++) { q(-L / 2 + 0.6, -hh + 0.35 + r * 1.05, L - 1.6, 0.5, '#c8a040'); for (let x = -L / 2 + 1.2; x < L / 2 - 1; x += 1.1) q(x, -hh + 0.4 + r * 1.05, 0.45, 0.4, '#1a120c'); } }
  else q(-L / 2 + 0.6, -hh + 0.3, L - 1.6, 0.3, n.color);
  const mh = v.decks ? 12 : 10, sp = (L - 3) / Math.max(1, masts - 1);
  for (let m = 0; m < masts; m++) {
    const mx = masts === 1 ? 0 : -L / 2 + 1.8 + m * sp, h = m === 1 || masts === 1 ? mh : mh - 1.6, sw = m === masts - 1 && masts > 2 ? 2.2 : 3;
    q(mx - 0.2, -hh - h, 0.4, h, '#4a3424');
    const billow = moving ? 0.25 : 0;
    q(mx - sw / 2, -hh - h + 1.2, sw, 2.4, M_SAIL); q(mx - sw / 2 - 0.3, -hh - h + 4, sw + 0.6, 2.8 + billow, M_SAIL); if (h > 9) q(mx - sw / 2 - 0.5, -hh - h + 7.2, sw + 1, 2.4 + billow, M_SAIL);
    q(mx - sw / 2 - 0.3, -hh - h + 6.6, sw + 0.6, 0.3, '#c8c0aa');
    if (m === 1 || masts === 1) { const wv = Math.sin(animT * 6 + a.id) * 0.25; q(mx + 0.2, -hh - h - 0.4 + wv, 2.2, 0.9, n.color); }
  }
  q(-L / 2 - 0.2, -hh - 3.4, 0.25, 2.2, '#4a3424'); q(-L / 2 - 1.6, -hh - 3.4, 1.4, 1, n.color);
}
function sSteam(a, v, n, P, d) {
  const L = v.len || 9, moving = a.st === 'walk' || (v.zigzag && a.st !== 'dead');
  wakeFx(L, moving, a.ph);
  const low = v.low, stealth = v.stealth, hull = stealth ? '#545b63' : v.low ? '#3e4248' : P.navy, dark = stealth ? '#3a4046' : P.navyD;
  const hh = low ? 1.1 : v.torp && L < 7 ? 1.3 : 1.7;
  q(-L / 2 + 0.3, -hh, L - 0.6, hh, hull); q(-L / 2 + 0.6, -0.35, L - 1.2, 0.35, '#7a2a24');    // red boot-top
  q(L / 2 - 0.3, -hh - (v.torp ? 0.6 : 0.3), 1, hh - 0.2, hull);
  if (stealth) { q(-L / 2 + 0.3, -hh, 0.6, hh, '#3a4046'); q(-2.4, -hh - 2.6, 5, 2.6, '#5e666e'); q(-1.6, -hh - 3.8, 3.2, 1.2, '#5e666e'); q(-0.8, -hh - 4.6, 1.6, 0.8, '#666e76'); q(2.8, -hh - 0.7, 1.6, 0.7, '#4c535a'); q(-1.6, -hh - 2.2, 0.7, 0.5, n.color); return; }
  if (v.ramp) { q(L / 2 - 0.4, -hh - 1.4, 0.5, 1.4, dark); q(-L / 2 + 0.5, -hh - 1.6, 2.4, 1.6, P.navy); const tr = v.troops || 3; for (let k = 0; k < tr; k++) { q(-0.8 + k * 1.2, -hh - 1.2, 0.8, 1.2, P.camo); q(-0.8 + k * 1.2, -hh - 1.7, 0.8, 0.5, '#4e5440'); } q(-L / 2 + 0.9, -hh - 1.2, 1, 0.5, n.color); return; }
  // superstructure & bridge
  const bx = v.mast === 'pagoda' ? -0.6 : -0.4;
  q(bx - 1.8, -hh - 1.4, 3.6, 1.4, P.navy); q(bx - 1.8, -hh - 1.4, 3.6, 0.25, '#9aa4ae');
  if (v.mast === 'pagoda') { for (let k = 0; k < 4; k++) q(bx + 0.6 - (1.2 - k * 0.25) / 2, -hh - 2.6 - k * 1.2, 1.2 - k * 0.25 + 0.4, 1.2, k & 1 ? dark : P.navy); }
  else if (v.bridge === 'tall') { q(bx + 0.2, -hh - 3.6, 1.6, 2.2, P.navy); q(bx + 0.4, -hh - 3.2, 1.2, 0.3, '#1a1e22'); q(bx + 0.9, -hh - 5, 0.25, 1.4, '#3a3e44'); }
  else if (v.radar === 'octa') { q(bx, -hh - 3.4, 2.2, 2, '#8a949e'); q(bx + 0.4, -hh - 3, 1, 1, '#4a525a'); q(bx + 1, -hh - 4.8, 0.25, 1.4, '#3a3e44'); }
  else { q(bx + 0.4, -hh - 2.4, 1.2, 1, P.navy); q(bx + 0.9, -hh - 3.8, 0.2, 1.4, '#3a3e44'); }
  // funnels
  const fn = v.funnels || 0;
  for (let k = 0; k < fn; k++) { const fx = bx - 1.4 - k * 1.3; q(fx, -hh - 2.7, 0.9, 1.4, dark); q(fx, -hh - 2.7, 0.9, 0.3, '#1a1a1a'); if (k === 0) q(fx, -hh - 2.1, 0.9, 0.25, n.color); }
  // turrets (fore and aft)
  const tn = v.turrets || 0, tpos = [L / 2 - 2, -L / 2 + 1.6, L / 2 - 3.3, -L / 2 + 2.9];
  for (let k = 0; k < tn; k++) {
    const tx = tpos[k], fore = tx > 0, big = L >= 12;
    q(tx - 0.7, -hh - 0.8, 1.4, 0.8, dark); q(fore ? tx + 0.6 - (a.rec || 0) * 0.5 : tx - 0.6 - (big ? 2 : 1.4), -hh - 0.55, big ? 2 : 1.4, 0.25, '#2a2e33');
  }
  if (v.vls) for (let k = 0; k < v.vls * 3; k++) q(L / 2 - 2.6 - (k % 3) * 0.6 - (k >= 3 ? 7 : 0), -hh - 0.25, 0.45, 0.25, '#2a2e33');
  if (v.torp) { q(-1, -hh - 0.5, 1.6, 0.5, '#2a2e33'); }
  q(-L / 2 + 0.6, -hh - 0.8, 0.25, 0.8, '#3a3e44'); q(-L / 2 + 0.85, -hh - 0.8, 0.9, 0.55, n.color);
  if (a.flash > 0) q(tn ? tpos[0] + 1.8 : L / 2, -hh - 1, 1.2, 1.2, M_FLASH);
}
function sCarrier(a, v, n, P, d) {
  const L = v.len || 15, moving = a.st === 'walk';
  wakeFx(L, moving, a.ph);
  q(-L / 2 + 0.8, -2, L - 1.6, 2, P.navy); q(-L / 2 + 1, -0.35, L - 2, 0.35, '#7a2a24');
  q(-L / 2, -2.6, L + 0.6, 0.6, '#4a4e54'); q(-L / 2, -2.6, L + 0.6, 0.12, '#6a7078');
  for (let x = -L / 2 + 0.8; x < L / 2; x += 1.6) q(x, -2.55, 0.7, 0.1, '#e8e8e0');
  if (v.angled) { q(-L / 2 + 1, -2.25, L * 0.45, 0.2, '#e8d070'); }
  if (v.island) { q(L * 0.12, -5.4, 1.8, 2.8, '#7a838c'); q(L * 0.12, -5.4, 1.8, 0.3, '#9aa4ae'); q(L * 0.12 + 0.8, -7, 0.25, 1.6, '#3a3e44'); q(L * 0.12 + 0.2, -4.6, 1.4, 0.3, '#1a1e22'); q(L * 0.12 + 0.3, -3.8, 1.2, 0.5, n.color); }
  const nP = v.planes === 'drone' ? 7 : 4, pc = v.planes === 'jet' ? '#8a929a' : v.planes === 'drone' ? '#5a6068' : '#6a7050';
  for (let k = 0; k < nP; k++) { const x = -L / 2 + 1.2 + k * (v.planes === 'drone' ? 0.9 : 1.6); if (x > L * 0.1 && v.island) continue; q(x, -3, v.planes === 'drone' ? 0.5 : 1, 0.4, pc); }
  if (v.heli) { q(-L / 2 + 2, -3.1, 1.4, 0.5, '#5a6040'); q(-L / 2 + 1.6, -3.4, 2.2, 0.12, '#2a2a26'); }
  if (v.catapult && (Math.floor(animT * 0.7 + a.id) % 4 === 0)) { ctx.globalAlpha = 0.5; q(L / 2 - 3, -3.2, 2, 0.6, '#f0f0f0'); ctx.globalAlpha = 1; }
}
function sSub(a, v, n, P, d) {
  const L = v.len || 7, surf = (a.surf || 0) > 0, moving = a.st === 'walk' || a.st === 'fight';
  if (v.count) {   // UUV: three dim shapes and a blinking blue light
    ctx.globalAlpha = 0.45;
    for (let k = 0; k < v.count; k++) { const ox = (k - 1) * 3.2, oy = (k & 1) * 0.8; q(ox - L / 2, oy - 0.4, L, 0.7, '#14181c'); }
    ctx.globalAlpha = 1;
    if (Math.floor(animT * 2 + a.id) % 3 === 0) q(-0.3, -0.5, 0.6, 0.6, v.light || '#4af');
    return;
  }
  const hull = v.teardrop ? '#1c1f22' : '#2c3136';
  if (!surf) { ctx.globalAlpha = 0.28; q(-L / 2, -0.2, L, 1, '#0c1418'); ctx.globalAlpha = 0.85; }
  else { q(-L / 2 + 0.3, -0.9, L - 0.6, 0.9, hull); q(L / 2 - 0.3, -0.6, 0.6, 0.6, hull); q(-L / 2 + 0.3, -0.25, L - 0.6, 0.25, '#5a2a24'); }
  const tx = v.teardrop ? 0.8 : 0.4;
  q(tx - 0.7, -2.6, 1.4, 1.8, hull); q(tx - 0.7, -2.6, 1.4, 0.25, '#3c4248'); if (!v.teardrop) q(tx + 0.7, -1.4, 0.9, 0.5, hull);
  if (v.periscope || surf) q(tx + 0.1, -3.8, 0.2, 1.2, '#3a3e44');
  if (v.tubes) q(-2.4, -1.1, 2.4, 0.3, '#2a2e33');
  q(tx - 0.5, -2, 0.6, 0.4, n.color);
  ctx.globalAlpha = 1;
  if (moving) { ctx.globalAlpha = 0.6; q(tx + 0.7, -0.3, 1, 0.25, '#f0f8ff'); q(tx - 2.6, -0.15, 2, 0.25, '#e0f0ff'); ctx.globalAlpha = 1; }
}

/* ---------- ground & sea unit dispatcher ---------- */
const SPR_FN = { foot: sFoot, horse: sHorse, gun: sGun, tracked: sTracked, mech: sMech, hover: sHover, oared: sOared, sail: sSail, steam: sSteam, carrier: sCarrier, sub: sSub };
// draws one military agent at screen (sx, sy); returns false when it has no military sprite
function drawMilUnit(a, sx, sy, z, n) {
  const u = UNIT_BY_ID[a.unit]; if (!u) return false;
  const fn = SPR_FN[a.kind === 'flag' ? 'foot' : u.spr]; if (!fn) return false;
  const P = milPal(n);
  MD = a.dir || 1; SPX = sx; SPY = sy; SPZ = z * 0.62 * (u.vis.scale || 1) * (u.dom === 'sea' ? 0.95 : 1);
  if (u.dom === 'land' && a.truck && a.st === 'walk' && a.leg === 'rally') { sTruck(n, P, true, a.ph); return true; }
  fn(a, u.vis, n, P, MD);
  return true;
}
// burning wreck of a vehicle (4 s), sinking ship (tilts and slides under) — drawn instead of the live sprite
function drawMilDead(a, sx, sy, z, n) {
  const u = UNIT_BY_ID[a.unit]; if (!u) return false;
  const P = milPal(n);
  MD = a.dir || 1; SPX = sx; SPY = sy; SPZ = z * 0.62;
  if (u.dom === 'sea') {
    const f = clamp(1 - a.t / 3.5, 0, 1), L = (u.vis.len || 8) * SPZ;
    ctx.save(); ctx.beginPath(); ctx.rect(sx - L * 1.5, sy - 60 * SPZ, L * 3, 60 * SPZ + 0.6 * SPZ); ctx.clip();
    ctx.translate(sx, sy + f * 5 * SPZ); ctx.rotate(MD * (0.08 + f * 0.5) * (a.id & 1 ? 1 : -0.6)); ctx.translate(-sx, -sy);
    ctx.globalAlpha = 1 - f * 0.4; a.st = 'hold'; const fl = a.flash; a.flash = 0;
    SPR_FN[u.spr](a, u.vis, n, P, MD); a.st = 'dead'; a.flash = fl; ctx.restore(); ctx.globalAlpha = 1;
    if (Math.floor(animT * 10 + a.id) & 1) { SPX = sx; SPY = sy; q(-1, -2.4 + f * 2, 1.4, 1.2, '#ff8a2a'); }
    return true;
  }
  if (u.spr === 'foot' || u.spr === 'horse') return false;
  const fade = clamp(a.t / 1, 0, 1); ctx.globalAlpha = fade;
  const L = u.vis.len || 5;
  q(-L / 2, -1.3, L, 1.3, '#1c1a18'); q(-L / 2 + 0.4, -2.6, L - 0.8, 1.3, '#2e2a26'); q(-0.8, -3.6, 1.8, 1, '#26221e');
  const fl = Math.floor(animT * 12 + a.id) & 1; q(-0.6, -4.4 - fl * 0.4, 1.2, 0.9 + fl * 0.4, fl ? '#ffb347' : '#ff6a2a'); q(-0.2, -4.8, 0.5, 0.5, '#fff0b0');
  ctx.globalAlpha = 1;
  return true;
}

/* ---------- aircraft (top-down, rotated to heading) ---------- */
function poly(pts, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]); ctx.closePath(); ctx.fill(); }
function rect(x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
function roundel(x, y, r, n) { ctx.fillStyle = '#f2f2ea'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, TAU); ctx.fill(); }
function airBody(u, n, P) {
  const v = u.vis;
  if (v.body && v.body[0] === '#') return v.body;
  if (v.body === 'wood') return '#b89a68';
  return P.era >= 7 ? '#8a939c' : P.era >= 6 ? '#9aa2a8' : mixHex('#6a7050', n.color, 0.12);
}
// local coordinates: nose → +x, span along y, 1 unit = SPZ screen px (scale applied by caller)
function drawPlaneShape(a, u, n, P, shadow) {
  const v = u.vis, s = v.size || 1, c = shadow ? 'rgba(0,0,0,1)' : airBody(u, n, P), cd = shadow ? c : shade(c[0] === '#' ? c : '#7a8088', 0.72);
  const prop = !shadow && v.prop;
  const tracer = !shadow;
  if (u.spr === 'heli') {
    rect(-1.2, -0.7, 2.6, 1.4, c); rect(-4.4, -0.25, 3.4, 0.5, c); rect(-4.6, -1, 0.5, 2, c);
    if (!shadow) { rect(0.6, -0.4, 0.8, 0.8, '#9ab8c8'); rect(-0.6, -1.1, 1.2, 0.3, '#2a2e33'); rect(-0.6, 0.8, 1.2, 0.3, '#2a2e33'); rect(-2.6, -0.25, 0.8, 0.5, n.color); }
    const r = a.ph * 30; ctx.save(); ctx.rotate(r); ctx.globalAlpha *= shadow ? 0.6 : 0.75; rect(-4, -0.18, 8, 0.36, shadow ? c : '#1e2024'); rect(-0.18, -4, 0.36, 8, shadow ? c : '#1e2024'); ctx.restore();
    return;
  }
  if (u.spr === 'drone') {
    if (v.swarm) {
      const nn = Math.max(3, Math.round(v.swarm * (0.5 + 0.5 * GFX.parts)));
      for (let k = 0; k < nn; k++) { const ang = k * 2.399 + a.ph * 0.7, rr = 1.2 + (k % 4) * 1.1; const x = Math.cos(ang) * rr + Math.sin(a.ph * 9 + k) * 0.4, y = Math.sin(ang) * rr * 0.8 + Math.cos(a.ph * 8 + k * 3) * 0.4; rect(x - 0.35, y - 0.35, 0.7, 0.7, shadow ? c : k & 1 ? '#2a2e33' : n.color); }
      return;
    }
    rect(-2.2, -0.3, 4.2, 0.6, shadow ? c : '#8a929a'); rect(-0.4, -3.6, 1, 7.2, shadow ? c : '#9aa2aa'); rect(-2.4, -1.2, 0.6, 2.4, shadow ? c : '#8a929a');
    if (!shadow) { rect(1.4, -0.3, 0.6, 0.6, '#3a3e44'); rect(-0.3, -3.4, 0.8, 0.6, n.color); const r = a.ph * 40; ctx.save(); ctx.translate(-2.6, 0); ctx.rotate(r); rect(-0.1, -0.9, 0.2, 1.8, '#c8d0d8'); ctx.restore(); }
    return;
  }
  if (u.spr === 'airship') {
    ctx.fillStyle = shadow ? c : '#b8bec4'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 1.6, 0, 0, TAU); ctx.fill();
    poly([-5.6, -0.6, -7.4, -2, -7.4, 2, -5.6, 0.6], shadow ? c : '#8a9096');
    if (!shadow) { rect(-3, -1.62, 0.4, 3.24, '#9aa0a6'); rect(1.4, -1.62, 0.4, 3.24, '#9aa0a6'); rect(-1, -0.4, 2.6, 0.8, '#5a5a52'); rect(3.6, -0.6, 1.2, 1.2, n.color); }
    return;
  }
  if (u.spr === 'missile') { rect(-1.6, -0.25, 3.2, 0.5, shadow ? c : '#d8dce0'); if (!shadow) rect(-2.6, -0.2, 1, 0.4, '#ffb347'); return; }
  ctx.save(); ctx.scale(s, s);
  if (v.flyingWing) {
    poly([2.2, 0, -1.2, -5.2, -2, -4.4, -1.4, -3.4, -2.2, -2.4, -1.6, 0, -2.2, 2.4, -1.4, 3.4, -2, 4.4, -1.2, 5.2], c);
    if (!shadow) { rect(0.2, -0.5, 1.2, 1, '#3a3e44'); roundel(-0.6, -3, 0.35, n); }
  } else if (v.wedge) {
    poly([3.6, 0, -2.4, -2.6, -2, 0, -2.4, 2.6], c);
    if (!shadow) { poly([3, 0, 0.8, -0.5, 0.8, 0.5], '#2a3a5a'); rect(-2.2, -0.9, 0.4, 1.8, n.color); ctx.globalAlpha *= 0.8 + 0.2 * Math.sin(a.ph * 30); rect(-3.6, -0.6, 1.4, 1.2, v.plasma || '#6af'); ctx.globalAlpha = 1; }
  } else if (v.diamond) {
    poly([3.2, 0, 0.4, -1, -0.6, -3.2, -2, -3, -2.2, -1, -2.8, -1.2, -2.6, 0, -2.8, 1.2, -2.2, 1, -2, 3, -0.6, 3.2, 0.4, 1], c);
    if (!shadow) { poly([2.4, 0, 1, -0.35, 1, 0.35], '#c8a040'); rect(-2.1, -1.4, 0.6, 0.35, n.color); rect(-2.1, 1.05, 0.6, 0.35, n.color); }
  } else if (v.swept) {
    rect(-2.6, -0.45, 6, 0.9, c); poly([1, -0.4, -1.6, -3.4, -2.4, -3.4, -1.2, -0.4], c); poly([1, 0.4, -1.6, 3.4, -2.4, 3.4, -1.2, 0.4], c);
    poly([-1.8, -0.3, -3, -1.5, -3.2, -1.5, -2.8, -0.3], cd); poly([-1.8, 0.3, -3, 1.5, -3.2, 1.5, -2.8, 0.3], cd);
    if (!shadow) { rect(1.6, -0.3, 1, 0.6, '#3a5a7a'); roundel(-1.4, -2.2, 0.38, n); roundel(-1.4, 2.2, 0.38, n); if (v.tails) { rect(-2.8, -0.9, 1, 0.25, cd); rect(-2.8, 0.65, 1, 0.25, cd); } if (v.msl) { rect(-1, -2.8, 1.4, 0.2, '#e8e8e8'); rect(-1, 2.6, 1.4, 0.2, '#e8e8e8'); } }
  } else {
    // straight-winged propeller types
    const span = v.engines >= 4 ? 6.6 : v.engines === 2 ? 5 : 3.6, wl = v.engines ? 1.1 : 0.9, fat = v.fat ? 0.75 : 0.45, len = v.engines >= 4 ? 4.4 : v.engines === 2 ? 3.6 : 3;
    rect(-len * 0.7, -fat, len * 1.25, fat * 2, c);
    if (v.gull) { poly([0.6, -0.4, 0.2, -1.6, 0.4, -3.4, -0.4, -3.4, -0.6, -1.6, -0.4, -0.4], c); poly([0.6, 0.4, 0.2, 1.6, 0.4, 3.4, -0.4, 3.4, -0.6, 1.6, -0.4, 0.4], c); }
    else { rect(-0.4, -span, wl, span * 2, c); if (v.wings === 2) rect(0.5, -span * 0.95, 0.5, span * 1.9, cd); }
    rect(-len * 0.7, -1.3, 0.7, 2.6, cd);
    if (v.engines) { const ys = v.engines >= 4 ? [-4.4, -2.2, 2.2, 4.4] : [-2, 2]; for (const y of ys) rect(0.2, y - 0.35, 1.2, 0.7, cd); }
    if (v.dome && !shadow) { ctx.fillStyle = '#d8dce0'; ctx.beginPath(); ctx.arc(-0.8, 0, 1.2, 0, TAU); ctx.fill(); rect(-1.9, -0.15, 2.2, 0.3, '#5a6068'); }
    if (!shadow) {
      if (v.canopy || !v.engines) rect(0.2, -0.28, 0.8, 0.56, '#3a5a7a');
      roundel(-0.1, -span * 0.72, 0.4, n); roundel(-0.1, span * 0.72, 0.4, n);
      if (v.torp) rect(-0.6, -0.15, 1.8, 0.3, '#4a4e54');
      if (prop) { const fl = Math.floor(a.ph * 30) & 1; ctx.globalAlpha *= 0.55; if (v.engines) { const ys = v.engines >= 4 ? [-4.4, -2.2, 2.2, 4.4] : [-2, 2]; for (const y of ys) rect(1.4, y - (fl ? 0.9 : 0.6), 0.2, fl ? 1.8 : 1.2, '#d8d8d0'); } else rect(len * 0.55, fl ? -1 : -0.7, 0.2, fl ? 2 : 1.4, '#d8d8d0'); ctx.globalAlpha = 1; }
    }
  }
  if (!shadow && v.jet && !v.wedge) { ctx.globalAlpha *= 0.7 + 0.3 * Math.sin(a.ph * 25); rect(v.flyingWing ? -2.6 : -3.4, -0.25, 0.7, 0.5, '#ffb347'); ctx.globalAlpha = 1; }
  ctx.restore();
}
// shadow pass (on the ground, under everything) and body pass (above all ground sprites)
function drawAircraft(list, z, shadow) {
  const k = z * 0.62;
  for (const a of list) {
    const u = UNIT_BY_ID[a.unit]; if (!u) continue;
    const alt = a.alt || 0, sx = sxOf(a.x), gy = syOf(a.y);
    if (sx < -60 || sx > view.w + 60 || gy < -40 || gy > view.h + 140) continue;
    const n = S.nations[a.n]; if (!n) continue;
    const dead = a.st === 'dead';
    ctx.save();
    if (shadow) {
      ctx.globalAlpha = clamp(0.32 - alt * 0.008, 0.08, 0.3) * (dead ? 0.6 : 1);
      ctx.translate(sx + alt * k * 0.18, gy); ctx.rotate(a.hd || 0); ctx.scale(k * 0.9, k * 0.55 * 0.9);
      drawPlaneShape(a, u, n, milPal(n), true);
    } else {
      const sy = gy - alt * k;
      ctx.translate(sx, sy);
      if (u.spr === 'airship' || u.spr === 'heli') ctx.rotate(Math.abs(Math.cos(a.hd || 0)) > 0.3 ? (Math.cos(a.hd || 0) > 0 ? 0 : PI) : (a.hd || 0));
      else ctx.rotate((a.hd || 0) + (dead ? a.ph * 6 : 0));
      const bank = a.bank || 0; ctx.scale(k, k * (1 - Math.min(0.45, Math.abs(bank)) ) * 0.78);
      if (dead) ctx.globalAlpha = clamp(a.t, 0, 1);
      drawPlaneShape(a, u, n, milPal(n), false);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
// a parachutist drifting down (paratroopers dropped behind the lines)
function drawChute(a, sx, sy, z, n) {
  const k = z * 0.62, alt = a.chute || 0, y = sy - alt * k;
  ctx.globalAlpha = 0.25; ctx.fillStyle = '#000'; ctx.fillRect(sx - k, sy - k * 0.3, 2 * k, k * 0.6); ctx.globalAlpha = 1;
  ctx.fillStyle = '#eef0ea'; ctx.beginPath(); ctx.arc(sx, y - 6 * k, 2.6 * k, PI, 0); ctx.fill();
  ctx.fillStyle = n.color; ctx.fillRect(sx - 0.4 * k, y - 8.6 * k, 0.8 * k, 2.6 * k);
  ctx.strokeStyle = 'rgba(230,230,220,.8)'; ctx.lineWidth = Math.max(0.5, k * 0.12); ctx.beginPath(); ctx.moveTo(sx - 2.5 * k, y - 6 * k); ctx.lineTo(sx, y - 3 * k); ctx.lineTo(sx + 2.5 * k, y - 6 * k); ctx.stroke();
  SPX = sx; SPY = y; SPZ = k; MD = 1; pr(-0.6, -3.2, 1.2, 1.8, milPal(n).camo); pr(-0.5, -4.2, 1, 1, a.skin || SKINS[0]); pr(-0.5, -1.4, 0.4, 1.4, '#3a3430'); pr(0.1, -1.4, 0.4, 1.4, '#3a3430');
}
