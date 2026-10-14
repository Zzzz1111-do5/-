/* =====================================================================
   Globe renderer (main globe view and the mini-globe)
   ===================================================================== */
const SUN = (() => { const v = [-0.62, 0.3, 0.72]; const l = Math.hypot(...v); return v.map(x => x / l); })();
const HALF = (() => { const v = [SUN[0], SUN[1], SUN[2] + 1]; const l = Math.hypot(...v); return v.map(x => x / l); })();
function makeGlobe(budget) {
  const g = { gc: document.createElement('canvas'), w: 1, h: 1, dpr: 1, cx: 0, cy: 0, R: 100, rot: 0.6, pitch: 0.28, q: 1, P: null, img: null, dirty: true, budget, box: { x: 0, y: 0, w: 1, h: 1 }, zoom: 1.6, vr: 0, vp: 0 };
  g.gctx = g.gc.getContext('2d');
  return g;
}
const G = makeGlobe(300000), GM = makeGlobe(30000);
function globeTables(g) {
  g.dirty = false;
  const R = g.R;
  const bx0 = Math.max(0, Math.floor(g.cx - R - 1)), by0 = Math.max(0, Math.floor(g.cy - R - 1));
  const bx1 = Math.min(g.w, Math.ceil(g.cx + R + 1)), by1 = Math.min(g.h, Math.ceil(g.cy + R + 1));
  const bw = Math.max(1, bx1 - bx0), bh = Math.max(1, by1 - by0);
  const area = Math.min(PI * R * R, bw * bh);
  const q = Math.min(g.dpr, 1.6, Math.sqrt(g.budget / area));
  g.q = q; g.box = { x: bx0, y: by0, w: bw, h: bh };
  const gw = Math.max(1, Math.ceil(bw * q)), gh = Math.max(1, Math.ceil(bh * q));
  g.gc.width = gw; g.gc.height = gh;
  g.img = g.gctx.createImageData(gw, gh);
  const maxP = gw * gh;
  if (!g.P || g.P.cap < maxP) g.P = { cap: maxP, idx: new Int32Array(maxP), tx: new Float32Array(maxP), ty: new Int32Array(maxP), cy: new Int32Array(maxP), Lt: new Float32Array(maxP), Nt: new Float32Array(maxP), Sp: new Float32Array(maxP), Rim: new Float32Array(maxP), Al: new Float32Array(maxP), n: 0 };
  const { idx, tx, ty, cy, Lt, Nt, Sp, Rim, Al } = g.P;
  const cp = Math.cos(g.pitch), sp = Math.sin(g.pitch);
  let k = 0;
  for (let py = 0; py < gh; py++) {
    const sy = by0 + (py + 0.5) / q, vy = -(sy - g.cy) / R;
    for (let px = 0; px < gw; px++) {
      const sx = bx0 + (px + 0.5) / q, vx = (sx - g.cx) / R, d2 = vx * vx + vy * vy;
      if (d2 >= 1) continue;
      const vz = Math.sqrt(1 - d2);
      const wx = vx, wy = vy * cp + vz * sp, wz = -vy * sp + vz * cp;
      const lat = Math.asin(clamp(wy, -1, 1)), lonP = Math.atan2(wz, -wx);
      idx[k] = (py * gw + px) * 4;
      tx[k] = (lonP + PI) / TAU * TW;
      ty[k] = clamp(Math.floor((PI / 2 - lat) / PI * TH), 0, TH - 1);
      cy[k] = clamp(Math.floor((PI / 2 - lat) / PI * CH), 0, CH - 1);
      const dot = vx * SUN[0] + vy * SUN[1] + vz * SUN[2];
      const day = smooth(-0.14, 0.28, dot);
      Lt[k] = 0.045 + day * (0.32 + 0.85 * Math.max(0, dot));
      Nt[k] = 1 - smooth(-0.28, 0.06, dot);
      const hd = Math.max(0, vx * HALF[0] + vy * HALF[1] + vz * HALF[2]);
      Sp[k] = Math.pow(hd, 70) * 120 * day;
      Rim[k] = Math.pow(1 - vz, 2.6) * 0.8;
      Al[k] = clamp((1 - Math.sqrt(d2)) * R * q * 1.2, 0, 1);
      k++;
    }
  }
  g.P.n = k;
}
let cloudOff = 0;
function globeRender(g, o) {
  if (g.dirty) globeTables(g);
  const d = g.img.data, P = g.P;
  const n = P.n, idx = P.idx, ptx = P.tx, pty = P.ty, pcy = P.cy, Lt = P.Lt, Nt = P.Nt, Sp = P.Sp, Rim = P.Rim, Al = P.Al;
  const rotTex = (g.rot / TAU) * TW, cs = CW / TW;
  const c1 = cloudOff * CW, c2 = -cloudOff * 0.6 * CW + CW * 0.37;
  const CL = WORLD.cloud;
  const era = S.flags.maxEra || 0;
  const lc = era < 4 ? [255, 150, 70] : era < 6 ? [255, 198, 112] : [255, 228, 184];
  const night = o.night, clouds = o.clouds, useL = o.lights;
  const dataLayer = layer !== 0, cloudK = (dataLayer ? 0.2 : 1) * (o.cloudK || 1), Lmin = dataLayer ? 0.55 : 0, nightK = dataLayer ? 0.35 : 1;
  for (let k = 0; k < n; k++) {
    let fx = ptx[k] + rotTex; fx -= Math.floor(fx / TW) * TW;
    let tx = fx | 0; if (tx >= TW) tx = TW - 1;
    const ti = pty[k] * TW + tx, o3 = ti * 3;
    let r = COL[o3], gg = COL[o3 + 1], b = COL[o3 + 2];
    const lt = useL ? LIGHTS[ti] : 0;
    if (lt > 0.05) { const u = Math.min(0.4, lt * 0.3); r += (150 - r) * u; gg += (146 - gg) * u; b += (140 - b) * u; }
    let L, nf;
    if (night) { L = Lt[k] > Lmin ? Lt[k] : Lmin; nf = Nt[k] * nightK; } else { L = 0.94 + 0.12 * Math.max(0, Lt[k] - 0.5); nf = 0; }
    r *= L; gg *= L; b *= L;
    if (WATER[ti] === 1) { const s = night ? Sp[k] : Sp[k] * 0.4; r += s; gg += s; b += s * 0.95; }
    if (nf > 0 && lt > 0) { const v = lt * nf; r += lc[0] * v; gg += lc[1] * v; b += lc[2] * v; }
    if (clouds) {
      const cx0 = fx * cs;
      let a1 = cx0 + c1; a1 -= Math.floor(a1 / CW) * CW;
      let a2 = cx0 + c2; a2 -= Math.floor(a2 / CW) * CW;
      const row = pcy[k] * CW;
      const ca = (CL[row + (a1 | 0)] * 0.62 + CL[row + (a2 | 0)] * 0.55) / 255 * cloudK;
      if (ca > 0.02) { const a = ca > 0.92 ? 0.92 : ca, cl = night ? 0.05 + L * 0.95 : 0.95; r += (248 * cl - r) * a; gg += (250 * cl - gg) * a; b += (255 * cl - b) * a; }
    }
    const rim = Rim[k], rl = night ? 0.12 + Lt[k] * 0.9 : 1;
    r += (110 * rl - r) * rim; gg += (168 * rl - gg) * rim; b += (255 * rl - b) * rim;
    const oo = idx[k];
    d[oo] = r; d[oo + 1] = gg; d[oo + 2] = b; d[oo + 3] = Al[k] * 255;
  }
  g.gctx.putImageData(g.img, 0, 0);
}
function globeProject(g, lat, lon) {
  const lonP = lon - g.rot, cl = Math.cos(lat);
  const px = -cl * Math.cos(lonP), py = Math.sin(lat), pz = cl * Math.sin(lonP);
  const cp = Math.cos(g.pitch), sp = Math.sin(g.pitch);
  return { x: g.cx + px * g.R, y: g.cy - (py * cp - pz * sp) * g.R, z: py * sp + pz * cp };
}
function globeUnproject(g, sx, sy) {
  const vx = (sx - g.cx) / g.R, vy = -(sy - g.cy) / g.R, d2 = vx * vx + vy * vy;
  if (d2 >= 1) return null;
  const vz = Math.sqrt(1 - d2), cp = Math.cos(g.pitch), sp = Math.sin(g.pitch);
  const wy = vy * cp + vz * sp, wz = -vy * sp + vz * cp;
  const lat = Math.asin(clamp(wy, -1, 1));
  let lon = Math.atan2(wz, -vx) + g.rot;
  lon = ((lon + PI) % TAU + TAU) % TAU - PI;
  const x = clamp(Math.floor((lon + PI) / TAU * W), 0, W - 1), y = clamp(Math.floor((PI / 2 - lat) / PI * H), 0, H - 1);
  return { lat, lon, cell: y * W + x };
}
function cellLatLon(i) { const y = (i / W) | 0, x = i - y * W; return { lat: CELL_LAT[y], lon: cellLon(x) }; }

