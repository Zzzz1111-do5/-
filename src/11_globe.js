/* =====================================================================
   Globe renderer (main globe view and the mini-globe)
   Per-pixel tables (texture coords, lighting, rim, glint, cloud-shadow
   offsets) are built when pitch/zoom/size change; each frame only does
   table lookups + bilinear sampling of the packed COL32/AUX32 textures.
   Resolution follows texel density: lower while the globe moves, refined
   progressively once it is still; a still globe re-renders every ~150 ms.
   ===================================================================== */
const SUN = (() => { const v = [-0.62, 0.3, 0.72]; const l = Math.hypot(...v); return v.map(x => x / l); })();
const HALF = (() => { const v = [SUN[0], SUN[1], SUN[2] + 1]; const l = Math.hypot(...v); return v.map(x => x / l); })();
function makeGlobe(budget) {
  const g = { gc: document.createElement('canvas'), w: 1, h: 1, dpr: 1, cx: 0, cy: 0, R: 100, rot: 0.6, pitch: 0.28, q: 1, P: null, img: null, d32: null, dirty: true, budget, box: { x: 0, y: 0, w: 1, h: 1 }, zoom: 1.6, vr: 0, vp: 0, ms: 0 };
  g.gctx = g.gc.getContext('2d');
  return g;
}
const G = makeGlobe(300000), GM = makeGlobe(30000);
// samples per texel [moving, still] per GFX level (texture is magnified ~4x at default zoom)
const GLOBE_SPT = [[1.2, 1.7], [1.3, 2.0], [1.4, 2.2], [1.5, 2.4]];
// Each globe keeps one table set per tier (0 = moving, 1 = still/refined; only G uses tier 1).
// Rotation never invalidates tables; pitch/zoom/size/GFX changes bump g.geo.
function globeTier(g, t) {
  const T = g.T || (g.T = []);
  if (!T[t]) { const gc = t === 0 ? g.gc : document.createElement('canvas'); T[t] = { gc, gctx: t === 0 ? g.gctx : gc.getContext('2d'), img: null, d32: null, P: null, q: 1, box: null, gw: 1, gh: 1, py: 0, k: 0, ready: false, geo: -1, maxP: 0 }; }
  return T[t];
}
function tierBegin(g, T, tier) {
  const R = g.R, full = g === G;
  const bx0 = Math.max(0, Math.floor(g.cx - R - 1)), by0 = Math.max(0, Math.floor(g.cy - R - 1));
  const bx1 = Math.min(g.w, Math.ceil(g.cx + R + 1)), by1 = Math.min(g.h, Math.ceil(g.cy + R + 1));
  const bw = Math.max(1, bx1 - bx0), bh = Math.max(1, by1 - by0);
  const area = Math.min(PI * R * R, bw * bh);
  let q = Math.min(g.dpr, 1.6, Math.sqrt(g.budget / area));
  if (full) q = Math.min(q, GLOBE_SPT[GFX.level][tier] * TH / (PI * R));
  q = Math.max(q, 0.05);
  T.q = q; T.box = { x: bx0, y: by0, w: bw, h: bh };
  const gw = Math.max(1, Math.ceil(bw * q)), gh = Math.max(1, Math.ceil(bh * q));
  T.gw = gw; T.gh = gh;
  T.gc.width = gw; T.gc.height = gh;
  T.img = T.gctx.createImageData(gw, gh);
  T.d32 = new Uint32Array(T.img.data.buffer);
  const maxP = Math.min(gw * gh, Math.ceil(PI * (R * q + 2) * (R * q + 2)) + 16);
  if (!T.P || T.P.cap < maxP || T.P.full !== full) {
    const F = () => new Float32Array(maxP), I = () => new Int32Array(maxP);
    T.P = { cap: maxP, full, idx: I(), tx: F(), ty: I(), cy: I(), wy: new Uint8Array(maxP), Lt: F(), Nt: F(), Sp: F(), Rim: F(), Al: F(), n: 0 };
    if (full) Object.assign(T.P, { Tw: F(), Fr: F(), Sh: F(), sdx: F(), sr: I() });
  }
  T.maxP = maxP; T.P.shad = full && GFX.shadows > 0; T.P.n = 0;
  T.py = 0; T.k = 0; T.ready = false; T.geo = g.geo;
}
// fills table rows until done or the time budget (ms) runs out
function tierFill(g, T, ms) {
  const t0 = performance.now(), full = g === G, bil = full || g === GM, cp = Math.cos(g.pitch), sp = Math.sin(g.pitch);
  while (T.py < T.gh) {
    const py1 = Math.min(T.gh, T.py + 24);
    T.k = globeTableFill(T.P, T.gw, T.py, py1, T.k, T.box.x, T.box.y, T.q, g.cx, g.cy, g.R, cp, sp, full, bil, T.P.shad, T.maxP);
    T.py = py1;
    if (performance.now() - t0 > ms) break;
  }
  T.P.n = T.k;
  if (T.py >= T.gh) T.ready = true;
}
function tierUse(g, T) { g.gc = T.gc; g.gctx = T.gctx; g.img = T.img; g.d32 = T.d32; g.P = T.P; g.q = T.q; g.box = T.box; g.cur = T; }
function globeTables(g) {
  g.dirty = false; g.geo = (g.geo | 0) + 1;
  const t0 = performance.now(), T = globeTier(g, 0);
  tierBegin(g, T, 0); tierFill(g, T, Infinity); tierUse(g, T);
  g.tms = performance.now() - t0;
}
// hot loop kept in its own function so it optimises cleanly (no OSR deopt on the epilogue)
function globeTableFill(P, gw, py0, py1, k, bx0, by0, q, gcx, gcy, R, cp, sp, full, bil, shad, maxK) {
  const { idx, tx, ty, cy, wy, Lt, Nt, Sp, Rim, Al } = P, Tw = P.Tw, Fr = P.Fr, Sh = P.Sh, sdx = P.sdx, sr = P.sr;
  const hk = 0.018, sw0 = SUN[0], sw1 = SUN[1] * cp + SUN[2] * sp, sw2 = -SUN[1] * sp + SUN[2] * cp;
  const kT = TH / PI, kC = CH / PI, kX = TW / TAU, kCX = CW / TAU, aaK = R * q * 1.2;
  for (let py = py0; py < py1; py++) {
    const sy = by0 + (py + 0.5) / q, vy = -(sy - gcy) / R;
    for (let px = 0; px < gw; px++) {
      const sx = bx0 + (px + 0.5) / q, vx = (sx - gcx) / R, d2 = vx * vx + vy * vy;
      if (d2 >= 1 || k >= maxK) continue;
      const vz = Math.sqrt(1 - d2);
      const wx = vx, wy0 = vy * cp + vz * sp, wz = -vy * sp + vz * cp;
      // fast acos/atan2 (error < 1e-4 rad, a texel is 8e-3 rad)
      const aw0 = wy0 < 0 ? -wy0 : wy0, ay0 = aw0 > 1 ? 1 : aw0, ac = Math.sqrt(1 - ay0) * (1.5707288 + ay0 * (-0.2121144 + ay0 * (0.074261 - 0.0187293 * ay0)));
      const colat = wy0 < 0 ? PI - ac : ac, lat = PI / 2 - colat;
      const xx = -wx, ax = xx < 0 ? -xx : xx, az = wz < 0 ? -wz : wz, mxa = ax > az ? ax : az, mna = ax > az ? az : ax;
      const ra = mxa > 1e-12 ? mna / mxa : 0, ra2 = ra * ra;
      let lon = ((-0.0464964749 * ra2 + 0.15931422) * ra2 - 0.327622764) * ra2 * ra + ra;
      if (az > ax) lon = PI / 2 - lon; if (xx < 0) lon = PI - lon; if (wz < 0) lon = -lon;
      idx[k] = (py * gw + px) * 4;
      tx[k] = (lon + PI) * kX;
      const tv = (PI / 2 - lat) * kT;
      if (bil) {
        const v = tv - 0.5, r0 = v < 0 ? 0 : Math.min(TH - 1, v | 0);
        ty[k] = r0; wy[k] = v < 0 ? 0 : Math.min(128, ((v - r0) * 128) | 0);
      } else ty[k] = clamp(Math.floor(tv), 0, TH - 1);
      cy[k] = clamp(Math.floor((PI / 2 - lat) * kC), 0, CH - 1) * CW;
      const dot = vx * SUN[0] + vy * SUN[1] + vz * SUN[2];
      const day = smooth(-0.14, 0.28, dot);
      Lt[k] = 0.045 + day * (0.32 + 0.85 * Math.max(0, dot));
      Nt[k] = 1 - smooth(-0.28, 0.06, dot);
      const hd = Math.max(0, vx * HALF[0] + vy * HALF[1] + vz * HALF[2]);
      const ivz = 1 - vz;
      Rim[k] = ivz * ivz * Math.sqrt(ivz) * 0.8;
      Al[k] = clamp((1 - Math.sqrt(d2)) * aaK, 0, 1);
      if (full) {
        const h2 = hd * hd, h4 = h2 * h2, h8 = h4 * h4, h16 = h8 * h8, h64 = h16 * h16 * h16 * h16;
        Sp[k] = (h64 * h16 * 130 + h8 * h4 * 10) * day;
        const i2 = ivz * ivz;
        Fr[k] = i2 * i2 * ivz * 0.9 * day;
        Tw[k] = smooth(-0.16, 0.0, dot) * (1 - smooth(0.0, 0.2, dot));
        if (shad && dot > 0) {
          // cloud casting the shadow sits ~hk towards the sun: offset along the local east/north axes
          const cf = Math.sqrt(1 - wy0 * wy0) || 1e-3, ic = 1 / cf;
          const dlat = hk * (-wy0 * wx * ic * sw0 + cf * sw1 - wy0 * wz * ic * sw2);
          const dlon = hk * (wz * ic * sw0 - wx * ic * sw2) * ic;
          sdx[k] = clamp(dlon * kCX, -256, 256); sr[k] = clamp(Math.floor((PI / 2 - lat - dlat) * kC), 0, CH - 1) * CW;
          Sh[k] = 0.5 * smooth(0, 0.22, dot);
        } else Sh[k] = 0;
      } else { const h2 = hd * hd, h4 = h2 * h2, h8 = h4 * h4, h16 = h8 * h8, h64 = h16 * h16 * h16 * h16; Sp[k] = h64 * h4 * h2 * 120 * day; }
      k++;
    }
  }
  return k;
}
let cloudOff = 0;
function globeRender(g, o) {
  const now = performance.now();
  const moved = g.dirty || g.rot !== g._rot;
  if (moved) g._mv = now;
  const key = (o.night ? 1 : 0) | (o.clouds ? 2 : 0) | (o.lights ? 4 : 0) | (layer << 3) | (GFX.level << 8);
  if (g.dirty || g._lv !== GFX.level) { g._lv = GFX.level; globeTables(g); }
  let force = false;
  if (g === G) {
    const T1 = globeTier(g, 1);
    if (now - (g._mv || 0) > 250) {
      // still: build the refined tables a few ms per frame, then switch to them
      if (T1.geo !== g.geo) tierBegin(g, T1, 1);
      if (!T1.ready) tierFill(g, T1, 5);
      if (T1.ready && g.cur !== T1) { tierUse(g, T1); force = true; }
    } else if (g.cur !== g.T[0]) { tierUse(g, g.T[0]); force = true; }
  }
  if (!moved && !force && key === g._key && now - (g._rt || 0) < (g === GM ? 250 : 150)) return false;
  g._key = key; g._rt = now; g._rot = g.rot;
  const P = g.P;
  let rt = (g.rot / TAU) * TW - 0.5; rt -= Math.floor(rt / TW) * TW;
  let c1 = cloudOff * CW, c2 = -cloudOff * 0.6 * CW + CW * 0.37;
  c1 -= Math.floor(c1 / CW) * CW; c2 -= Math.floor(c2 / CW) * CW;
  const era = S.flags.maxEra || 0;
  const lc = era < 4 ? GLOBE_LC[0] : era < 6 ? GLOBE_LC[1] : GLOBE_LC[2];
  const dataLayer = layer !== 0;
  globeShade(g.d32, P, rt, c1, c2, lc[0], lc[1], lc[2], !!o.night, !!o.clouds, !!o.lights, (dataLayer ? 0.2 : 1) * (o.cloudK || 1) / 255, dataLayer ? 0.55 : 0, dataLayer ? 0.35 : 1);
  g.gctx.putImageData(g.img, 0, 0);
  g.ms = g.ms * 0.9 + (performance.now() - now) * 0.1;
  return true;
}
const GLOBE_LC = [[255, 150, 70], [255, 186, 100], [255, 206, 150]];
function globeShade(d32, P, rt, c1, c2, lc0, lc1, lc2, night, clouds, useL, cloudK, Lmin, nightK) {
  const full = P.full, n = P.n, idx = P.idx, ptx = P.tx, pty = P.ty, pcy = P.cy, pwy = P.wy, Lt = P.Lt, Nt = P.Nt, Sp = P.Sp, Rim = P.Rim, Al = P.Al;
  const Tw = P.Tw, Fr = P.Fr, Sh = P.Sh, sdx = P.sdx, sr = P.sr;
  const cs = CW / TW, CL = WORLD.cloud, C32 = COL32, X32 = AUX32;
  const shad = full && P.shad && night && clouds, sunset = full && night;
  const TW1 = TW - 1, THm = TH - 1, inv159 = 1 / 159, inv255 = 1 / 255, specK = night ? 1 : 0.4;
  for (let k = 0; k < n; k++) {
    let fx = ptx[k] + rt; if (fx >= TW) fx -= TW;
    const ix = fx | 0, wx = ((fx - ix) * 128) | 0, iw = 128 - wx, ix1 = ix === TW1 ? 0 : ix + 1;
    const ry = pty[k], o0 = ry * TW, o1 = ry < THm ? o0 + TW : o0, wyk = pwy[k], iwy = 128 - wyk;
    let a = C32[o0 + ix], b = C32[o0 + ix1];
    const t0 = (((a & 0xff00ff) * iw + (b & 0xff00ff) * wx) >> 7) & 0xff00ff, u0 = (((a & 0xff00) * iw + (b & 0xff00) * wx) >> 7) & 0xff00;
    a = C32[o1 + ix]; b = C32[o1 + ix1];
    const t1 = (((a & 0xff00ff) * iw + (b & 0xff00ff) * wx) >> 7) & 0xff00ff, u1 = (((a & 0xff00) * iw + (b & 0xff00) * wx) >> 7) & 0xff00;
    const rb = ((t0 * iwy + t1 * wyk) >> 7) & 0xff00ff, gc = ((u0 * iwy + u1 * wyk) >> 7) & 0xff00;
    a = X32[o0 + ix]; b = X32[o0 + ix1];
    const x0 = ((a * iw + b * wx) >> 7) & 0xff00ff;
    a = X32[o1 + ix]; b = X32[o1 + ix1];
    const x1 = ((a * iw + b * wx) >> 7) & 0xff00ff, xv = ((x0 * iwy + x1 * wyk) >> 7) & 0xff00ff;
    let r = rb & 255, gg = gc >> 8, bb = rb >> 16;
    const lt = useL ? (xv & 255) * inv159 : 0, wm = (xv >> 16) * inv255;
    if (lt > 0.05) { const u = lt * 0.3 < 0.4 ? lt * 0.3 : 0.4; r += (150 - r) * u; gg += (146 - gg) * u; bb += (140 - bb) * u; }
    let L, lr, lg, lb, nf, tw = 0;
    if (night) {
      L = Lt[k];
      if (sunset) { tw = Tw[k]; lr = L * (1 + 0.28 * tw); lg = L * (1 - 0.04 * tw); lb = L * (1 - 0.3 * tw); } else lr = lg = lb = L;
      if (L < Lmin) { L = lr = lg = lb = Lmin; }
      nf = Nt[k] * nightK;
    } else { L = 0.94 + 0.12 * (Lt[k] > 0.5 ? Lt[k] - 0.5 : 0); lr = lg = lb = L; nf = 0; }
    let cx0 = 0;
    if (clouds) cx0 = fx * cs;
    if (shad) {
      const sk = Sh[k];
      if (sk > 0) {
        let s1 = cx0 + c1 + sdx[k]; if (s1 >= CW) s1 -= CW; if (s1 >= CW) s1 -= CW; else if (s1 < 0) s1 += CW;
        let s2 = cx0 + c2 + sdx[k]; if (s2 >= CW) s2 -= CW; if (s2 >= CW) s2 -= CW; else if (s2 < 0) s2 += CW;
        const row = sr[k], cs1 = (CL[row + (s1 | 0)] * 0.62 + CL[row + (s2 | 0)] * 0.55) * cloudK;
        const sv = 1 - sk * (cs1 > 0.92 ? 0.92 : cs1); lr *= sv; lg *= sv; lb *= sv;
      }
    }
    r *= lr; gg *= lg; bb *= lb;
    if (wm > 0) {
      const s = Sp[k] * specK * wm;
      if (full && night) { const f = Fr[k] * wm; r += s + (128 * lr - r) * f; gg += s + (176 * lg - gg) * f; bb += s * 0.95 + (236 * lb - bb) * f; }
      else { r += s; gg += s; bb += s * 0.95; }
    }
    let ca = 0;
    if (clouds) {
      let a1 = cx0 + c1; if (a1 >= CW) a1 -= CW;
      let a2 = cx0 + c2; if (a2 >= CW) a2 -= CW;
      const row = pcy[k];
      ca = (CL[row + (a1 | 0)] * 0.62 + CL[row + (a2 | 0)] * 0.55) * cloudK;
      if (ca > 0.02) {
        if (ca > 0.92) ca = 0.92;
        if (night) { r += (248 * (0.05 + lr * 0.95) - r) * ca; gg += (250 * (0.05 + lg * 0.95) - gg) * ca; bb += (255 * (0.05 + lb * 0.95) - bb) * ca; }
        else { r += (236 - r) * ca; gg += (238 - gg) * ca; bb += (242 - bb) * ca; }
      } else ca = 0;
    }
    if (nf > 0 && lt > 0) {
      let v = lt * nf * (1 - ca * 0.65);
      v = v * 1.05 / (0.35 + v);
      r += lc0 * v; gg += lc1 * v; bb += lc2 * v;
      if (v > 0.6) { v = (v - 0.6) * 140; r += v; gg += v; bb += v; }
    }
    const rim = Rim[k];
    if (night) {
      const rl = 0.12 + L * 0.9;
      r += ((110 + 145 * tw) * rl - r) * rim; gg += ((168 - 30 * tw) * rl - gg) * rim; bb += ((255 - 150 * tw) * rl - bb) * rim;
    } else { r += (110 - r) * rim; gg += (168 - gg) * rim; bb += (255 - bb) * rim; }
    d32[idx[k] >> 2] = ((Al[k] * 255) << 24) | ((bb > 255 ? 255 : bb) << 16) | ((gg > 255 ? 255 : gg) << 8) | (r > 255 ? 255 : r);
  }
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
