'use strict';

/* =====================================================================
   Constants & helpers
   ===================================================================== */
const TAU = Math.PI * 2, PI = Math.PI;
const W = 192, H = 96, N = W * H;          // simulation grid (1.875° cells)
const TS = 4, TW = W * TS, TH = H * TS, TN = TW * TH;   // render texture
const CW = 1024, CH = 512;                  // cloud texture (upsampled from 512×256 noise)
const START_YEAR = -3500;
const MAX_CITIES = 380;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const pick = arr => arr[(rand() * arr.length) | 0];
const $ = id => document.getElementById(id);

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// simulation RNG keeps its state on S so a snapshot can resume it
function rand() {
  let a = (S.rng = (S.rng + 0x6D2B79F5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function makeNoise(rnd) {
  const p = new Uint8Array(512), perm = [];
  for (let i = 0; i < 256; i++) perm.push(i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => { const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
  return function (x, y, z) {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B2 = p[X + 1] + Y, BA = p[B2] + Z, BB = p[B2 + 1] + Z;
    const l1 = grad(p[AA] & 15, x, y, z) + u * (grad(p[BA] & 15, x - 1, y, z) - grad(p[AA] & 15, x, y, z));
    const l2 = grad(p[AB] & 15, x, y - 1, z) + u * (grad(p[BB] & 15, x - 1, y - 1, z) - grad(p[AB] & 15, x, y - 1, z));
    const l3 = grad(p[AA + 1] & 15, x, y, z - 1) + u * (grad(p[BA + 1] & 15, x - 1, y, z - 1) - grad(p[AA + 1] & 15, x, y, z - 1));
    const l4 = grad(p[AB + 1] & 15, x, y - 1, z - 1) + u * (grad(p[BB + 1] & 15, x - 1, y - 1, z - 1) - grad(p[AB + 1] & 15, x, y - 1, z - 1));
    const m1 = l1 + v * (l2 - l1), m2 = l3 + v * (l4 - l3);
    return m1 + w * (m2 - m1);
  };
}
function fbm(nz, x, y, z, oct) {
  let s = 0, a = 0.5, f = 1, t = 0;
  for (let i = 0; i < oct; i++) { s += a * nz(x * f, y * f, z * f); t += a; a *= 0.5; f *= 2.03; }
  return s / t;
}

const CELL_LAT = new Float32Array(H), COSLAT = new Float32Array(H), AMP_CELL = new Float32Array(H), AMP_TEX = new Float32Array(TH);
for (let y = 0; y < H; y++) { const lat = PI / 2 - (y + 0.5) / H * PI; CELL_LAT[y] = lat; COSLAT[y] = Math.cos(lat); AMP_CELL[y] = 1 + 1.6 * Math.abs(Math.sin(lat)); }
for (let y = 0; y < TH; y++) { const lat = PI / 2 - (y + 0.5) / TH * PI; AMP_TEX[y] = 1 + 1.6 * Math.abs(Math.sin(lat)); }
const cellLon = x => (x + 0.5) / W * TAU - PI;

function cellDist(i, j) {
  const yi = (i / W) | 0, xi = i - yi * W, yj = (j / W) | 0, xj = j - yj * W;
  let dx = Math.abs(xi - xj); if (dx > W / 2) dx = W - dx;
  const cl = Math.cos((CELL_LAT[yi] + CELL_LAT[yj]) / 2);
  const ddx = dx * cl, ddy = yi - yj;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

/* =====================================================================
   Biomes, resources, technology
   ===================================================================== */
const B = { DEEP: 0, SHALLOW: 1, ICE: 2, TUNDRA: 3, TAIGA: 4, FOREST: 5, GRASS: 6, DESERT: 7, SAVANNA: 8, JUNGLE: 9, MOUNTAIN: 10, STEPPE: 11 };
const BIOME_NAME = ['深海', '浅海', '冰原', '苔原', '针叶林', '温带森林', '草原', '沙漠', '稀树草原', '热带雨林', '山地', '干草原'];
const BIOME_FERT = [0, 0, 0, 0.08, 0.32, 0.8, 1.0, 0.04, 0.62, 0.6, 0.12, 0.45];
const BIOME_FOREST = [0, 0, 0, 0, 0.85, 0.8, 0.06, 0, 0.25, 0.95, 0.1, 0.02];
const FARMABLE = [0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 1];
// cleared / forested colours per biome
const CLR = [[0,0,0],[0,0,0],[232,238,244],[132,128,108],[112,122,88],[132,148,82],[124,152,70],[212,184,128],[176,160,86],[118,140,68],[116,106,96],[166,156,104]];
const FOR = [[0,0,0],[0,0,0],[232,238,244],[132,128,108],[40,78,56],[48,100,46],[110,142,62],[212,184,128],[122,136,60],[26,88,40],[96,98,84],[160,152,100]];
const FARM_A = [176, 166, 96], FARM_B = [120, 150, 70];

const RES = ['coal', 'oil', 'iron', 'uran', 'rare'];
const RES_NAME = { coal: '煤炭', oil: '石油', iron: '铁矿', uran: '铀矿', rare: '稀土' };
const RES_RGB = { coal: [210, 210, 214], oil: [229, 90, 150], iron: [236, 120, 60], uran: [140, 228, 90], rare: [80, 206, 236] };
const RES_TOTAL = { coal: 520000, oil: 260000, iron: 330000, uran: 26000, rare: 30000 };

