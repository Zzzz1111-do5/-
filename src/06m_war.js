/* =====================================================================
   Military: forces, theatres, the yearly three-domain war resolution,
   nuclear deterrence, the military research track and the AI's
   army / navy / air choices.
   Contract (battle renderer, UI):
     milForces(n) → { R: {role: strength}, base, L, S, A, sp: [land, sea, air] effective split }
     power(n)     = L + 0.55·S·(0.4 + 0.6·coast) + 0.85·A   (same magnitude as the old formula)
     w.air ∈ [0,1]  side a's share of air superiority (0.5 = contested; no aircraft → 0.5)
     w.sea ∈ [0,1]  side a's share of sea control (0.5 = contested); only meaningful when w.th.sea
     w.ls  ∈ [0,1]  side a's share of the last land-battle score (drives hitChance)
     w.blockade = [blockade suffered by side a, by side b] (0..0.6 of trade lost)
     w.th = theatre(w) = { land, sea }: land false → overseas war, cities can only be taken with sea control
   ===================================================================== */
const PWR_K = 1.2;          // calibration of power() against the old m.mil curve (navies count 0.55× in power)
const CAP_K = 1;            // calibration of the yearly chance to attempt a siege
const MX_V = 1;
const EXCL = {}; for (const t of TECHS) if (t.excl) (EXCL[t.excl] = EXCL[t.excl] || []).push(t);
// transient strategic events for the renderer (not saved; newest last, max 40; the renderer may splice what it has shown):
// { t: 'nuke'|'sbomb'|'msl'|'orbital'|'naval'|'air'|'invade', a: attacker id, b: target id, i: target cell, from: attacker capital cell, y, big, retal, via: 'icbm'|'bomber' }
const MIL_EVENTS = [];
function milEvent(e) { if (booting) return; e.y = S.year; MIL_EVENTS.push(e); if (MIL_EVENTS.length > 40) MIL_EVENTS.shift(); }

/* ---------- national forces ---------- */
function mxDefaults(n) {
  const D = MIL_DOCT[n.ideo] || MIL_DOCT.tribal;
  return { v: MX_V, split: D.split.slice(), mix: { land: Object.assign({}, D.land), sea: Object.assign({}, D.sea), air: Object.assign({}, D.air) }, auto: true,
    att: [0, 0, 0], bombed: 0, block: 0, coast: 0, overseas: 0, island: false, F: null, tick: -1, policy: { sbomb: true, unrestricted: false },
    pref: {}, airCap: 0, said: [0, 0, 0], reform: -1e9, nukeHit: -1e9, prepSea: -1e9, lock: -1e9, need: null, pickAt: -1e9, idle: false };
}
function ensureMil(n) {
  let mx = n.mx;
  if (!mx) mx = n.mx = mxDefaults(n);
  else if (mx.v !== MX_V) { const d = mxDefaults(n); for (const k in d) if (mx[k] === undefined) mx[k] = d[k]; mx.v = MX_V; }
  if (n.mtarget === undefined) { n.mtarget = null; n.mresearch = 0; }
  return mx;
}
function roleVal(n, r) { const u = UNIT_BY_ID[n.mult.best[r]]; return u ? u.rating * n.mult.q[r] : 0; }
function hasNavy(m) { return !!(m.best.cap || m.best.scr || m.best.cv || m.best.sub); }
function effSplit(n) {
  const m = n.mult, mx = n.mx, sp = mx.split.slice();
  if (!mx.coast || !hasNavy(m)) sp[1] = 0;
  if (!m.airOK) sp[2] = 0;
  const s = sp[0] + sp[1] + sp[2];
  return s > 0 ? [sp[0] / s, sp[1] / s, sp[2] / s] : [1, 0, 0];
}
function milForces(n) {
  const mx = ensureMil(n);
  if (mx.tick === S.tick && mx.F) return mx.F;
  const m = n.mult;
  let co = 0; for (const c of n.cl) if (c.coastal) co++;
  mx.coast = n.cl.length ? co / n.cl.length : 0;
  const base = Math.pow(n.st.pop + 1, 0.8) * m.mil * (1 + 0.08 * (n.legions + m.era)) * (n.eco ? n.eco.K.mil : 1) * m.manpower * (1 - 0.5 * mx.bombed) * (mx.nukeHit > S.year ? 0.85 : 1) * PWR_K;
  const sp = effSplit(n), R = {};
  for (let d = 0; d < 3; d++) {
    const rs = ROLES[DOMS[d]], mix = mx.mix[DOMS[d]];
    let w = 0; for (const r of rs) if (m.best[r]) w += (mix[r] || 0) + 0.02;
    for (const r of rs) { const v = roleVal(n, r); R[r] = v > 0 && w > 0 ? base * sp[d] * ((mix[r] || 0) + 0.02) / w * v * (1 - mx.att[d]) : 0; }
  }
  const F = { R, base, sp, L: R.inf + R.art + R.arm + R.at + R.aa, S: R.scr + R.cap + R.cv + R.sub, A: R.fi + R.cas + R.bomb + R.nb + R.uav };
  F.P = F.L + 0.55 * F.S * (0.4 + 0.6 * mx.coast) + 0.85 * F.A;
  mx.F = F; mx.tick = S.tick;
  return F;
}
function power(n) { return milForces(n).P; }
// strength that matters in a given war: land wars are fought by the army (+air), overseas wars need the fleet and landing craft
function theatrePower(n, w) {
  const F = milForces(n), th = theatre(w);
  if (th.land) return F.L + 0.5 * F.A + 0.15 * F.S;
  const amph = n.mult.era >= 5 ? 0.35 + 0.65 * Math.min(1, n.mult.amphib) : 0.8;
  return 0.6 * F.S + 0.4 * F.L * amph + 0.5 * F.A;
}
function deterrent(n) { const m = n.mult; return !!(m.nukeW && (m.icbm || (m.best.bomb && m.best.bomb !== 'airship'))); }
// war-declaration factor from nuclear arms; 'att' is the side that would declare
function nukeWarK(att, def) {
  const a = deterrent(att), d = deterrent(def);
  let k = a && d ? (att.mult.secondStrike || def.mult.secondStrike ? 0.15 : 0.25) : a ? 1.3 : d ? 0.5 : 1;
  if (S.flags.nukeTaboo > S.year) k *= 0.5;
  return k;
}

/* ---------- geography ---------- */
function seaGap(i, j) {   // share of water cells on the straight line between two cells
  const yi = (i / W) | 0, xi = i - yi * W, yj = (j / W) | 0;
  let dx = (j - yj * W) - xi; if (dx > W / 2) dx -= W; if (dx < -W / 2) dx += W;
  const k = Math.max(2, Math.ceil(Math.hypot(dx, yj - yi) * 1.5));
  let wet = 0;
  for (let s = 1; s < k; s++) { const x = ((Math.round(xi + dx * s / k) % W) + W) % W, y = Math.round(yi + (yj - yi) * s / k); if (!isLand(y * W + x)) wet++; }
  return wet / (k - 1);
}
function landLinked(a, b, ca, cb) {
  if (cellDist(ca.i, cb.i) <= 2.5) return true;
  return S.borders.some(([x, y, len]) => len >= 2 && ((x === a && y === b) || (x === b && y === a))) && seaGap(ca.i, cb.i) < 0.5;
}
// the closest pair of cities between two nations, in one pass
function closestCities(A, B) {
  let bd = 1e9, ca = null, cb = null;
  for (const c of A.cl) for (const o of B.cl) { if (Math.abs(c.y - o.y) >= bd) continue; const d = cellDist(c.i, o.i); if (d < bd) { bd = d; ca = c; cb = o; } }
  return ca ? { a: ca, b: cb, d: bd } : null;
}
const OSC = new Map();
function overseasPair(A, B) {
  if (OSC.S !== S) { OSC.clear(); OSC.S = S; }
  const k = A.id < B.id ? A.id * 4096 + B.id : B.id * 4096 + A.id, c = OSC.get(k);
  if (c && Math.abs(S.year - c.y) < 16) return c.v;
  const border = S.borders.some(([x, y, len]) => len >= 2 && ((x === A.id && y === B.id) || (x === B.id && y === A.id)));
  let v = true;
  if (border) { const p = closestCities(A, B); v = !(p && landLinked(A.id, B.id, p.a, p.b)); }
  OSC.set(k, { y: S.year, v });
  return v;
}
function theatre(w) {
  const A = S.nations[w.a], B = S.nations[w.b], cc = w.caps[0] + w.caps[1];
  if (w.th && w.th.c === cc && S.year - w.th.y < 6 && w.th.y <= S.year) return w.th;
  const p = closestCities(A, B);
  const k = p ? p.a.id * 65536 + p.b.id : -1;
  if (w.th && w.th.k === k) { w.th.y = S.year; w.th.c = cc; w.th.d = p ? p.d : 99; return w.th; }
  milForces(A); milForces(B);
  const land = !!p && landLinked(A.id, B.id, p.a, p.b);
  w.th = { k, y: S.year, c: cc, land, sea: !!p && A.mx.coast > 0 && B.mx.coast > 0 && (!land || (p.a.coastal && p.b.coastal)), d: p ? p.d : 99 };
  return w.th;
}
function frontDist(X, w) { const cc = capitalCell(X); return cc >= 0 && w.front >= 0 ? cellDist(cc, w.front) : 0; }
function nearFrontCities(Y, w, k) { const f = w.front >= 0 ? w.front : capitalCell(Y); return Y.cl.slice().sort((a, b) => cellDist(a.i, f) - cellDist(b.i, f)).slice(0, k); }
function cryptoEdge(X, Y) { const a = X.mult, b = Y.mult; return 1 + 0.2 * clamp(a.crypto - (b.cyber ? 0 : b.crypto) + (a.cyber && !b.cyber ? 0.25 : 0), -0.5, 0.5); }
const sideOf = (w, n) => w.a === n.id ? 0 : 1;
const airC = (w, side) => (side === 0 ? 1 : -1) * (2 * (w.air ?? 0.5) - 1);   // signed air superiority, −1..1
const seaC = (w, side) => (side === 0 ? 1 : -1) * (2 * (w.sea ?? 0.5) - 1);
function warInit(w) { if (w.air === undefined) w.air = 0.5; if (w.sea === undefined) w.sea = 0.5; if (!w.blockade) w.blockade = [0, 0]; if (w.ls === undefined) w.ls = 0.5; if (!w.capLost) w.capLost = [0, 0]; if (!w.yr) w.yr = {}; }
function docStat(id, win) { if (!id) return; const md = S.milDoc || (S.milDoc = {}); const r = md[id] || (md[id] = { w: 0, l: 0 }); if (win) r.w++; else r.l++; }

/* ---------- yearly war resolution: air → sea → strategic strikes → land → nuclear ---------- */
function warYear(w) {
  const A = S.nations[w.a], B = S.nations[w.b];
  warInit(w);
  const FA = milForces(A), FB = milForces(B), th = theatre(w);
  airWar(w, A, B, FA, FB);
  if (th.sea) seaWar(w, A, B, FA, FB, th);
  else { w.sea = 0.5 + (w.sea - 0.5) * 0.7; w.blockade[0] = A.mx.block; w.blockade[1] = B.mx.block; }
  strategicStrike(A, B, FA, FB, airC(w, 0), w);
  strategicStrike(B, A, FB, FA, airC(w, 1), w);
  landWar(w, A, B, FA, FB, th);
  if (S.wars.includes(w) && S.year - w.start >= 2) nukeCheck(w, A, B);
}
function airWar(w, A, B, FA, FB) {
  if (FA.A + FB.A <= 0) { w.air = 0.5; return; }
  const fi = (X, Y, F) => (F.R.fi + 0.3 * F.R.cv * X.mult.cvAir) * (1 + 0.3 * X.mult.radar) * (1 + X.mult.supK) * (1 + 0.3 * X.mult.stealth * (1 - 0.5 * Math.min(1, Y.mult.radar)));
  const fa = fi(A, B, FA), fb = fi(B, A, FB);
  const sup = fa + fb > 0 ? (fa - fb) / (fa + fb) : FA.A > FB.A ? 0.6 : FB.A > FA.A ? -0.6 : 0;
  const prev = 2 * w.air - 1, c = prev * 0.5 + sup * 0.5;
  w.air = (1 + c) / 2;
  if (FA.A > 0) A.mx.att[2] = Math.min(0.7, A.mx.att[2] + 0.04 * (1 - c) / 2 * A.mult.airLossK);
  if (FB.A > 0) B.mx.att[2] = Math.min(0.7, B.mx.att[2] + 0.04 * (1 + c) / 2 * B.mult.airLossK);
  if (Math.abs(c) > 0.3 && fa > 0 && fb > 0) {
    const win = c > 0 ? A : B, lose = win === A ? B : A;
    if (S.tick % 4 === 0) { docStat(win.mult.doc.air, true); docStat(lose.mult.doc.air, false); }
    if (Math.abs(c - prev) > 0.25 && S.year - (w.yr.air || -1e9) >= 10) {
      w.yr.air = S.year;
      const c0 = nearFrontCities(lose, w, 1)[0];
      if (c0) { log('war', `${c0.name}空战：${win.name}的战斗机夺取了制空权`, c0.i, false); milEvent({ t: 'air', a: win.id, b: lose.id, i: c0.i }); }
    }
  }
}
function navalScore(X, Y, FX, FY, sup, near) {
  const R = FX.R, Q = FY.R, m = X.mult;
  const screenK = 0.65 + 0.35 * clamp(R.scr / (0.6 * (R.cap + R.cv) + 1e-9), 0, 1);
  const asw = Q.scr * (1 + Y.mult.asw);
  const subEff = R.sub * (1 - 0.7 * clamp(asw / (2 * R.sub + 1e-9), 0, 1) * (1 - m.subStealth));
  const cvStrike = R.cv * (1 + m.cvAir) * (1 - 0.5 * clamp(Y.mult.fleetAA, 0, 0.9)) * (0.7 + 0.3 * Math.max(0, sup));
  const gunNerf = Q.cv > 0 && R.cv === 0 && m.era >= 5 ? 0.55 : 1;
  const landAir = near ? (R.nb + 0.3 * R.cas) * clamp(0.4 + sup, 0, 1.4) : 0;
  const s = (R.cap * screenK * gunNerf + 0.5 * R.scr + 1.4 * cvStrike + 0.9 * subEff + landAir) * (1 + 0.2 * m.radar) * cryptoEdge(X, Y) * (0.75 + 0.5 * rand());
  return { s, subEff };
}
function seaWar(w, A, B, FA, FB, th) {
  const supA = airC(w, 0), near = th.d < 14;
  const a = navalScore(A, B, FA, FB, supA, near), b = navalScore(B, A, FB, FA, -supA, near);
  let na = a.s, nb = b.s;
  if (na + nb > 0) {
    if (na > nb) na *= 1 + A.mult.decisive; else nb *= 1 + B.mult.decisive;
    const nc = (na - nb) / (na + nb), prev = 2 * w.sea - 1, c = prev * 0.6 + nc * 0.4;
    w.sea = (1 + c) / 2;
    if (FA.S > 0) A.mx.att[1] = Math.min(0.7, A.mx.att[1] + 0.04 * nb / (na + nb));
    if (FB.S > 0) B.mx.att[1] = Math.min(0.7, B.mx.att[1] + 0.04 * na / (na + nb));
    if (Math.abs(nc) > 0.3 && FA.S > 0 && FB.S > 0) {
      const win = nc > 0 ? A : B, lose = win === A ? B : A;
      docStat(win.mult.doc.sea, true); docStat(lose.mult.doc.sea, false);
      if (S.year - (w.yr.sea || -1e9) >= 8) {
        w.yr.sea = S.year; S.stats.navalBattles = (S.stats.navalBattles || 0) + 1;
        const port = nearFrontCities(lose, w, 4).find(c => c.coastal) || nearFrontCities(win, w, 4).find(c => c.coastal);
        if (port) { log('war', `${port.name}海战：${win.name}击败了${lose.name}的舰队`, port.i, false); milEvent({ t: 'naval', a: win.id, b: lose.id, i: port.i }); }
      }
    }
  } else w.sea = 0.5 + (w.sea - 0.5) * 0.7;
  const raid = (X, Y, sub, FY) => clamp(Y.mx.block * 0.85 + 0.25 * sub / (sub + FY.R.scr + 0.2 * FY.S + 1e-9) * (1 + X.mult.raid) * (X.mx.policy.unrestricted ? 1.5 : 1), 0, 0.6);
  const ca = 2 * w.sea - 1;
  B.mx.block = clamp(raid(A, B, a.subEff, FB) + (ca > 0.3 ? 0.1 * ca * B.mx.coast : 0), 0, 0.6);
  A.mx.block = clamp(raid(B, A, b.subEff, FA) + (ca < -0.3 ? -0.1 * ca * A.mx.coast : 0), 0, 0.6);
  w.blockade[0] = A.mx.block; w.blockade[1] = B.mx.block;
  // unrestricted submarine warfare angers neutrals; neutral democracies may join the other side
  for (const [X, Y] of [[A, B], [B, A]]) {
    if (!X.mx.policy.unrestricted || !(X === A ? a : b).subEff) continue;
    for (const o of S.nations) {
      if (!o.alive || o === X || o === Y || atWar(o.id, X.id) || !o.cl.length) continue;
      addTrust(o.id, X.id, -0.05);
      if (ideoOf(o).demo && !isPlayer(o) && warCount(o.id) === 0 && rand() < 0.02) joinWar(o.id, X.id, Y);
    }
  }
}
function strategicStrike(X, Y, FX, FY, supX, w) {
  const m = X.mult;
  let sb = 0, bombs = 0;
  if (FX.R.bomb > 0 && X.mx.policy.sbomb) {
    const intercept = clamp((FY.R.fi * (1 - Math.max(0, supX)) + 0.5 * FY.R.aa) / (FX.R.bomb + 1e-9), 0, 1);
    bombs = FX.R.bomb * (0.4 + m.sbomb) * (1 - 0.7 * intercept);
    sb += bombs;
    X.mx.att[2] = Math.min(0.7, X.mx.att[2] + 0.03 * intercept * FX.R.bomb / (FX.A + 1e-9));
  }
  const tx = FX.L + FX.S + FX.A, ty = FY.L + FY.S + FY.A;
  if (m.msl) sb += 0.04 * m.msl * tx * clamp(1 - Y.mult.abm * (1 - m.mslPen), 0.1, 1) * (0.2 + 0.8 * Math.min(1, FX.sp[1] + FX.sp[2]));
  if (m.orbStrike) sb += 0.06 * tx;
  if (sb <= 0) return;
  const k = sb / (0.3 * ty + sb + 1e-9);
  Y.mx.bombed = Math.min(0.5, Y.mx.bombed + 0.15 * k);
  for (const c of nearFrontCities(Y, w, 3)) c.fac *= 1 - 0.03 * k;
  Y.stabV = Math.max(0, Y.stabV - 0.004 * k);
  if (X.mx.policy.sbomb && bombs > 0) for (const o of S.nations) if (o.alive && o !== X && o !== Y && ideoOf(o).demo && !atWar(o.id, X.id) && rand() < 0.3) addTrust(o.id, X.id, -0.02);
  if (k > 0.04 && S.year - (w.yr.bomb || -1e9) >= 10) {
    w.yr.bomb = S.year; S.stats.sbombs = (S.stats.sbombs || 0) + 1;
    const c = nearFrontCities(Y, w, 3).sort((a, b) => b.pop - a.pop)[0];
    if (c) {
      const how = m.orbStrike && bombs < 0.3 * sb ? 'orbital' : m.msl && bombs < 0.5 * sb ? 'msl' : 'sbomb';
      log('war', how === 'orbital' ? `${X.name}的天基平台从轨道打击了${c.name}` : how === 'msl' ? `${X.name}的导弹齐射命中${c.name}` : `${c.name}大轰炸：${X.name}的轰炸机群把${Y.name}的工厂炸成废墟`, c.i, false);
      milEvent({ t: how, a: X.id, b: Y.id, i: c.i, from: capitalCell(X) });
      if (how === 'sbomb' && !S.flags.firstSbomb) { S.flags.firstSbomb = S.year; think(X, `对${Y.name}实施战略轰炸`); }
    }
  }
}
function landStrength(X, Y, FX, FY, supX, w) {
  const R = FX.R, Q = FY.R, m = X.mult;
  const atCov = R.arm > 0 ? clamp((Q.at + 0.3 * Q.inf * (1 + Y.mult.infAT) + 0.25 * Q.art) / R.arm * (1 - m.armorRes), 0, 1) : 1;
  const LA = R.inf + 1.2 * R.art + R.arm * (1 + 0.5 * (1 - atCov)) + 0.6 * R.at + 0.2 * R.aa;
  const air = R.cas + R.uav + 0.6 * R.bomb, aaCov = air > 0 ? clamp(Q.aa / air, 0, 1) : 0;
  const CAS = air * clamp(0.4 + supX, 0, 1.4) * (1 - 0.5 * aaCov) * (1 + m.casK);
  const supply = w ? clamp(1 - Math.max(0, frontDist(X, w) - (20 + 8 * m.supply)) / 60, 0.55, 1) : 1;
  const plan = w ? 1 + Math.min(0.3, m.planK * (S.year - w.start)) : 1;
  return (LA + 0.8 * CAS) * supply * plan * cryptoEdge(X, Y);
}
const TANKS = new Set(['tank_light', 'tank_medium', 'tank_heavy', 'mbt']);
function landWar(w, A, B, FA, FB, th) {
  const sa = airC(w, 0);
  const la = landStrength(A, B, FA, FB, sa, w) * visBias(w, 0), lb = landStrength(B, A, FB, FA, -sa, w) * visBias(w, 1);
  w.ls = w.ls * 0.5 + 0.5 * la / (la + lb + 1e-9);
  const pa = la * (0.5 + rand()), pb = lb * (0.5 + rand());      // same noise as the old power duel
  const win = pa > pb ? A : B, lose = win === A ? B : A, ws = win === A ? 0 : 1;
  if (!S.flags.tankWar) for (const X of [A, B]) if (TANKS.has(X.mult.best.arm) && (X === A ? FA : FB).R.arm > 0 && th.land) { S.flags.tankWar = S.year; const c = cityById(X.capital); log('war', `${X.name}的坦克第一次出现在战场上`, w.front >= 0 ? w.front : c ? c.i : -1, true); break; }
  if (rand() < 0.2 * (1 + win.mult.tempo) * CAP_K) {
    const lc = nearestPair(lose, win), overseas = !th.land;
    const seaW = seaC(w, ws), airW = airC(w, ws);
    const FW = win === A ? FA : FB, FL = lose === A ? FA : FB;
    const reach = 10 + win.mult.range * 0.5 + win.mult.sea * 0.3 + 2 * win.mult.supply + (win.mult.para && airW > 0.3 ? 6 : 0);
    const free = FL.S <= 0 && (win.mult.sea > 0 || FW.S > 0);      // nobody contests the sea lanes
    const seaOK = !overseas || seaW > 0.15 || free || (S.year - w.start > 60 && rand() < 0.2);
    if (lc && seaOK && lc.d < reach) {
      const amph = overseas ? (win.mult.era >= 5 ? 0.35 + 0.65 * Math.min(1, win.mult.amphib) : 0.8) : (lc.c.coastal && seaW > 0.4 ? 1.3 : 1);
      if (rand() < (1 + 0.5 * win.mult.siege) / lose.mult.def * amph) {
        if (overseas && !free) { S.stats.invasions = (S.stats.invasions || 0) + 1; milEvent({ t: 'invade', a: win.id, b: lose.id, i: lc.c.i }); }
        docStat(win.mult.doc.land, true); docStat(lose.mult.doc.land, false);
        captureCity(lc.c, win, lose, w);
      } else w.front = lc.i;
    }
  }
  const lk = th.land ? 1 : 0.35;      // armies facing each other across the sea only skirmish
  lose.mx.att[0] = Math.min(0.6, lose.mx.att[0] + 0.04 * lk * lose.mult.lossK);
  win.mx.att[0] = Math.min(0.6, win.mx.att[0] + 0.015 * lk * win.mult.lossK);
}
function costK(n, d) {
  const F = n.mx.F; if (!F) return 1;
  let c = 0, r = 0;
  for (const ro of ROLES[DOMS[d]]) { const u = UNIT_BY_ID[n.mult.best[ro]]; if (u && F.R[ro] > 0) { c += F.R[ro] * u.cost; r += F.R[ro] * u.rating; } }
  return r > 0 ? Math.pow(clamp(0.8 / (c / r), 0.5, 1.5), 0.6) : 1;
}
function milRecover(n) {
  const mx = ensureMil(n), K = (n.eco ? n.eco.K.mil : 1) * (1 - 0.5 * mx.bombed) * (1 + n.mult.recov);
  for (let d = 0; d < 3; d++) if (mx.att[d] > 0) { mx.att[d] *= 1 - clamp(0.12 * K * costK(n, d), 0.03, 0.4); if (mx.att[d] < 0.002) mx.att[d] = 0; }
  mx.bombed *= 0.85; if (mx.bombed < 0.002) mx.bombed = 0;
}

/* ---------- nuclear weapons ---------- */
function nukeCheck(w, A, B) {
  if (S.flags.noNukes) return;
  for (const [X, Y, s] of [[A, B, 0], [B, A, 1]]) {
    if (isPlayer(X) || !deterrent(X)) continue;
    const net = w.caps[s] - w.caps[1 - s];
    const p = 0.002 * (w.capLost[s] ? 5 : 1) * (net <= -3 ? 3 : 1) * ideoOf(X).aggr * (Y.mult.secondStrike ? 0.1 : 1) * (S.flags.nukeTaboo > S.year ? 0.3 : 1) * (1 + X.mult.deter * 0.5);
    if (rand() < p) { nukeStrike(X, Y, w, false); return; }
  }
}
function nukeStrike(X, Y, w, retal) {
  if (!X.alive || !Y.alive || !Y.cl.length) return false;
  const c = (w ? nearFrontCities(Y, w, 3) : Y.cl.slice()).sort((a, b) => b.pop - a.pop)[0] || largestCity(Y);
  if (!c) return false;
  const big = X.mult.nukeY >= 2, k = big ? 0.2 : 0.4, dead = c.pop * (1 - k);
  c.pop *= k; c.fac *= 0.1; c.lay = null; c.nuked = S.year;
  for (const o of S.cities) if (o !== c && cellDist(o.i, c.i) < (big ? 3 : 2)) { o.pop *= big ? 0.8 : 0.9; o.fac *= 0.7; }
  S.stats.nukeCool = S.stats.nukeCool || 0;
  if (S.stats.nukeCool < 0.6) { S.tanom -= 0.05; S.stats.nukeCool += 0.05; }
  for (const o of S.nations) if (o.alive && o !== X && o.cl.length) addTrust(o.id, X.id, -0.4);
  X.stabV = Math.max(0, X.stabV - 0.1);
  ensureMil(Y).nukeHit = S.year + 10; Y.mx.tick = -1;
  S.flags.nukeTaboo = S.year + 50;
  S.stats.nukes = (S.stats.nukes || 0) + 1;
  const first = !S.flags.firstNuke; if (first) S.flags.firstNuke = S.year;
  log('war', `${retal ? `${X.name}发动核反击：` : `${X.name}对${Y.name}动用了核武器：`}${big ? '一枚热核弹头' : '一颗原子弹'}在${c.name}上空爆炸，约 ${fmtPop(dead)} 人罹难`, c.i, true);
  if (first) showBanner('末日时钟', `${X.name}在${c.name}投下了战争中的第一颗核弹`);
  milEvent({ t: 'nuke', a: X.id, b: Y.id, i: c.i, from: capitalCell(X), big, retal: !!retal, via: X.mult.icbm ? 'icbm' : 'bomber' });
  if (!retal && Y.mult.secondStrike && deterrent(Y) && !isPlayer(Y) && rand() < 0.8) nukeStrike(Y, X, w, true);
  return true;
}

/* ---------- military research track ---------- */
function exclBlocked(n, t) { if (!t.excl) return false; for (const o of EXCL[t.excl]) if (o !== t && n.techs[o.id] !== undefined) return true; return false; }
function resolveExcl(n) {
  let ch = false;
  for (const g in EXCL) {
    const k = EXCL[g].filter(t => n.techs[t.id] !== undefined).sort((a, b) => n.techs[a.id] - n.techs[b.id]);
    for (let j = 1; j < k.length; j++) { delete n.techs[k[j].id]; ch = true; }
  }
  return ch;
}
function weightedPick(pool, w) {
  let tot = 0; for (const v of w) if (v > 0) tot += v;
  if (tot <= 0) return null;
  let r = rand() * tot;
  for (let k = 0; k < pool.length; k++) if (w[k] > 0) { r -= w[k]; if (r <= 0) return pool[k].id; }
  return pool[pool.length - 1].id;
}
function preferredDoctrine(n, dom) {
  const mx = ensureMil(n);
  if (mx.pref[dom] && DOCTRINES[mx.pref[dom]]) return mx.pref[dom];
  let d = (S.milPref && S.milPref[n.ideo] && S.milPref[n.ideo][dom]) || (MIL_DOCT[n.ideo] || MIL_DOCT.tribal).doc[dom];
  if (rand() < 0.25) {
    if (dom === 'sea' && mx.island) d = 'dcarrier';
    else if (dom === 'land' && n.ai && n.ai.persona.caution > 1.2) d = 'dplan';
  }
  return (mx.pref[dom] = d);
}
function counterNeed(n, t) {
  const nd = n.mx.need; if (!nd) return 1;
  let v = 1;
  if (t.id === 'tankdes' || t.id === 'infat') v *= 1 + 0.5 * nd.at;
  if (t.id === 'destroyer' || t.id === 'aegis') v *= 1 + 0.4 * nd.asw;
  if (t.id === 'aagun' || t.id === 'sam' || t.br === 'afi') v *= 1 + 0.5 * nd.aa;
  if (t.br === 'nsub' || t.id === 'navalbomber') v *= 1 + 0.3 * nd.cv;
  return v;
}
function milTechOK(n, t) { return t && t.mil && n.techs[t.id] === undefined && t.era <= n.mult.era && t.req.every(r => n.techs[r] !== undefined) && !exclBlocked(n, t); }
// the AI does not start a weapon long before its historical reference year (keeps WWI → WWII → cold-war order);
// a player may still order it, paying the ahead-of-time penalty in techCost
function milLead(e) { return clamp((ERA_REF[e + 1] - ERA_REF[e]) / 40, 2, 100); }
const MIL_KEY = { trireme: 2, milaviation: 2.5, tank: 1.5, nukeweapons: 1.5, radar: 1.3, carrier: 1.3 };
// first year in which a currently blocked military tech clears the calendar gate (mx.idle: nothing left at all)
function nextMilYear(n) {
  let y = 1e9; for (const t of TECHS) if (t.mil && milTechOK(n, t)) y = Math.min(y, Math.ceil(t.ry - milLead(t.era)));
  n.mx.idle = y === 1e9;
  return n.mx.idle ? S.year + 10 : Math.max(S.year + 1, y);
}
function pickMilTech(n) {
  const m = n.mult, mx = ensureMil(n), bw = BR_W[n.ideo] || {};
  const avail = TECHS.filter(t => t.mil && t.ry <= S.year + milLead(t.era) && milTechOK(n, t));
  if (!avail.length) return null;
  mx.idle = false;
  let minEra = 9; for (const t of avail) if (t.era < minEra) minEra = t.era;
  const others = S.nations.filter(o => o.alive && o !== n), no = others.length || 1;
  const wt = t => {
    let v = (bw[t.br] || 1) * (MIL_KEY[t.id] || 1);
    for (const id of t.units) {
      const u = UNIT_BY_ID[id], dom = ROLE_OF_DOM[u.roles[0]]; if (!dom) continue;
      let b = 0; for (const r of u.roles) { const x = mx.mix[ROLE_OF_DOM[r]]; if (x && x[r] > b) b = x[r]; }
      v *= 0.3 + 2 * b;
    }
    if (t.cat === 'navy') v *= mx.coast ? 0.15 + 1.6 * mx.coast : 0.05;
    v *= counterNeed(n, t);
    if (t.excl) v = t.excl === 'sea' && !mx.coast ? 0 : t.id === preferredDoctrine(n, t.excl) ? 3 : 0;
    let k = 0; for (const o of others) if (o.techs[t.id] !== undefined) k++;
    return v * Math.pow(0.45, t.era - minEra) * (1 + 2 * k / no);
  };
  const pool = avail.filter(t => t.era <= minEra + 1);
  return weightedPick(pool, pool.map(wt)) || weightedPick(avail, avail.map(wt));
}
// military research points come from the army budget; once every military tech of the era is done, 10% spills into civil research
function milResearch(n, rp) {
  ensureMil(n);
  const share = n.eco ? n.eco.alloc[0] : 0.2;
  const mrp = rp * MRP_K * (0.25 + 2.5 * share) * (1 + 0.25 * (n.mobil || 0)) * (warCount(n.id) ? 1.2 : 1);
  const mx = n.mx;
  if (n.mtarget && !milTechOK(n, TECH_BY_ID[n.mtarget])) n.mtarget = null;
  if (!n.mtarget && S.year >= mx.pickAt) { n.mtarget = pickMilTech(n); if (!n.mtarget) mx.pickAt = mx.idle ? S.year + 10 : nextMilYear(n); }
  if (!n.mtarget) { if (n.target && mx.idle) n.research += mrp * 0.1; return; }
  n.mresearch += mrp;
  const cost = techCost(n, n.mtarget);
  if (n.mresearch >= cost) { n.mresearch -= cost; discover(n, n.mtarget); n.mtarget = pickMilTech(n); }
}
const MIL_FIRST = {
  trireme: n => `${n.name}组建了人类第一支海军，桨帆战船驶出港口`,
  dreadnought: n => `${n.name}的无畏舰下水，所有旧式战列舰一夜之间过时`,
  milaviation: n => `${n.name}组建了人类第一支空军`,
  carrier: n => `${n.name}的第一艘航空母舰下水`,
  submarine: n => `${n.name}的第一艘潜艇潜入水下`,
  radar: n => `${n.name}建成了第一座雷达站`,
  jetfighter: n => `${n.name}的喷气式战斗机首次升空`,
  nukeweapons: n => `${n.name}引爆了人类第一颗原子弹`,
  nukesub: n => `${n.name}的第一艘核潜艇潜入深海`,
  icbm: n => `${n.name}试射了第一枚洲际导弹`,
  mbt: n => `${n.name}的主战坦克开下生产线`,
  stealthfighter: n => `${n.name}的隐身战斗机首飞`,
  swarm: n => `${n.name}放飞了第一群蜂群无人机`,
  gravtank: n => `${n.name}的反重力坦克悬浮在阅兵场上`,
};
function milFirst(n, id, cell) {
  const f = MIL_FIRST[id]; if (!f) return false;
  log(id === 'nukeweapons' || id === 'icbm' ? 'war' : 'tech', f(n), cell, true);
  if (id === 'icbm') showBanner('恐怖平衡', `${n.name}的洲际导弹可以在三十分钟内抵达地球另一端`);
  if (id === 'nukeweapons') showBanner('原子时代', `${n.name}掌握了毁灭城市的力量`);
  return true;
}

/* ---------- AI: budget split, force mix, doctrine, policies ---------- */
function milThink(n, A) {
  const mx = ensureMil(n), m = n.mult, D = MIL_DOCT[n.ideo] || MIL_DOCT.tribal, F = milForces(n);
  const rel = new Set(); for (const w of A.wars) rel.add(w.a === n.id ? w.b : w.a);
  if (A.prey) rel.add(A.prey.id); if (A.threat) rel.add(A.threat.id);
  let os = 0, k = 0; for (const id of rel) { const o = S.nations[id]; if (!o || !o.alive || !o.cl.length) continue; k++; if (overseasPair(n, o)) os++; }
  mx.overseas = k ? os / k : 0;
  const landNb = A.nb.filter(o => !overseasPair(n, o)).length;
  mx.island = mx.coast > 0.4 && landNb === 0;
  const enemy = A.wars.length ? S.nations[A.wars[0].a === n.id ? A.wars[0].b : A.wars[0].a] : null, T = enemy || A.threat || A.prey;
  const FT = T && T.alive ? milForces(T) : null;
  if (!(mx.lock > S.year)) {
    const t = D.split.slice();
    t[1] += 0.25 * mx.overseas + 0.15 * (mx.coast - 0.4);
    if (n.ai.goal === 'expand' && A.prey && overseasPair(n, A.prey)) t[1] += 0.12;
    if (n.ai.goal === 'defend' && A.threat && !overseasPair(n, A.threat)) t[0] += 0.10;
    if (FT && FT.A > 1.3 * F.A) t[2] += 0.08;
    if (A.wars.some(w => overseasPair(n, S.nations[w.a === n.id ? w.b : w.a]))) t[1] += 0.10;
    if (mx.prepSea > S.year) t[1] += 0.15;
    if (mx.island) t[1] = Math.max(t[1], 0.4);
    if (!mx.coast || !hasNavy(m)) t[1] = 0;
    if (!m.airOK) { t[2] = 0; mx.airCap = 0; } else { mx.airCap = Math.min(1, Math.max(0.05, mx.airCap) + 0.02); t[2] = Math.min(t[2], mx.airCap); }
    for (let d = 0; d < 3; d++) t[d] = Math.max(0, t[d]);
    normW(t);
    for (let d = 0; d < 3; d++) mx.split[d] += (t[d] - mx.split[d]) * 0.25;
    normW(mx.split);
  }
  // force templates: retire obsolete roles, counter the main rival
  const need = { at: 0, asw: 0, aa: 0, cv: 0 };
  const tm = { land: Object.assign({}, D.land), sea: Object.assign({}, D.sea), air: Object.assign({}, D.air) };
  for (const dom of DOMS) {
    let avg = 0, c = 0; for (const r of ROLES[dom]) { const v = roleVal(n, r); if (v > 0) { avg += v; c++; } }
    avg = c ? avg / c : 0;
    for (const r of ROLES[dom]) { const v = roleVal(n, r); if (v > 0 && v < avg * 0.45) tm[dom][r] *= 0.3; }
  }
  if (FT) {
    const R = F.R, Q = FT.R;
    if (Q.arm > (R.at + 0.3 * R.inf * (1 + m.infAT) + 0.25 * R.art) * 1.2) { tm.land.at += 0.10; tm.land.art += 0.05; need.at = 1; }
    if (FT.S > 0 && Q.sub / FT.S > 0.3) { tm.sea.scr += 0.15; need.asw = 1; }
    if (Q.cv > 0 && !R.cv) { tm.sea.sub += 0.10; tm.air.nb += 0.05; need.cv = 1; }
    if (FT.A > 1.3 * F.A || Q.fi > 1.3 * R.fi) { tm.air.fi += 0.15; tm.land.aa += 0.05; need.aa = 1; }
    if (Q.bomb > 0.2 * FT.A && FT.A > 0) { tm.air.fi += 0.10; tm.land.aa += 0.05; need.aa = 1; }
  }
  for (const dom of DOMS) { const t = tm[dom], mix = mx.mix[dom]; let s = 0; for (const r in t) s += t[r]; for (const r in t) mix[r] += (t[r] / (s || 1) - mix[r]) * 0.3; }
  mx.need = need;
  // policies
  if (!mx.policy.manual) {
    const enemies = A.wars.map(w => S.nations[w.a === n.id ? w.b : w.a]).filter(Boolean);
    mx.policy.sbomb = !((n.ideo === 'liberal' || n.ideo === 'cosmo') && enemies.some(o => ideoOf(o).demo));
    const raider = n.ideo === 'fascist' || n.ideo === 'communist' || m.doc.sea === 'draid';
    const losingSea = A.wars.some(w => S.year - w.start > 6 && (w.th && w.th.sea) && seaC(w, sideOf(w, n)) < -0.1);
    const was = mx.policy.unrestricted;
    mx.policy.unrestricted = raider && F.R.sub > 0 && losingSea;
    if (mx.policy.unrestricted && !was) think(n, '宣布无限制潜艇战，击沉一切驶向敌国的商船');
  }
  // narrative
  const sea = mx.split[1], air = mx.split[2];
  if (Math.abs(sea - mx.said[1]) > 0.1 && hasNavy(m)) {
    think(n, sea > mx.said[1] ? `扩建海军：海军占军费 ${pctS(sea)}（${mx.prepSea > S.year ? '为渡海进攻做准备' : mx.island ? '岛国必须控制海洋' : mx.overseas > 0.4 ? '对手远在海外' : '保护海上贸易'}）` : `裁减海军：海军占军费 ${pctS(sea)}，把钱用在陆军上`, false);
    mx.said[1] = sea;
  }
  if (Math.abs(air - mx.said[2]) > 0.1 && m.airOK) { think(n, `${air > mx.said[2] ? '扩建' : '缩减'}空军：空军占军费 ${pctS(air)}`, false); mx.said[2] = air; }
  if (F.R.cv > 0 && !mx.cvSaid) { mx.cvSaid = 1; think(n, '第一支航母编队组建完成'); }
}
// world-level military thought (every 20 years with the ideology doctrine review) and AI doctrine reforms
function milDoctrineTick() {
  const md = S.milDoc || (S.milDoc = {}); if (!S.milPref) S.milPref = {};
  const rate = id => { const r = md[id]; return r && r.w + r.l >= 6 ? r.w / (r.w + r.l) : null; };
  for (const I of IDEO) for (const dom of DOMS) {
    const cur = (S.milPref[I.id] && S.milPref[I.id][dom]) || MIL_DOCT[I.id].doc[dom], rc = rate(cur);
    if (rc === null || rc >= 0.4) continue;
    let best = null, br = 0.6;
    for (const id in DOCTRINES) if (DOCTRINES[id].dom === dom && id !== cur) { const r = rate(id); if (r !== null && r > br) { br = r; best = id; } }
    if (best && rand() < 0.4) { (S.milPref[I.id] = S.milPref[I.id] || {})[dom] = best; log('civ', `军事思潮：${I.name}转向「${TECH_BY_ID[best].name}」（胜率 ${pctS(br)}，原先的「${TECH_BY_ID[cur].name}」只有 ${pctS(rc)}）`, -1, false); }
  }
  for (const id in md) { md[id].w *= 0.7; md[id].l *= 0.7; }
  for (const n of S.nations) {
    if (!n.alive || !n.cl.length || isPlayer(n) || !n.mx || S.year - n.mx.reform < 80) continue;
    for (const dom of DOMS) {
      const want = S.milPref[n.ideo] && S.milPref[n.ideo][dom], have = n.mult.doc[dom];
      if (!want || !have || want === have) continue;
      const cost = techCost(n, have);
      delete n.techs[have]; n.mx.pref[dom] = want; n.mx.reform = S.year;
      n.mresearch = Math.max(0, n.mresearch - cost * 0.5);
      n.mult = computeMult(n); techVersion++;
      think(n, `学说改革：放弃「${TECH_BY_ID[have].name}」，改学「${TECH_BY_ID[want].name}」`);
      break;
    }
  }
}

/* ---------- views for the renderer ---------- */
// units to draw for a nation in a domain: the fielded model per role (70%) plus older models still in service (30%)
function milUnitsFor(n, dom) {
  const out = [], m = n.mult; if (!m || !ROLES[dom]) return out;
  const mx = ensureMil(n), sp = effSplit(n)[DOM[dom]];
  if (sp <= 0) return out;
  let tot = 0; for (const r of ROLES[dom]) if (m.best[r]) tot += (mx.mix[dom][r] || 0) + 0.02;
  for (const r of ROLES[dom]) {
    const bid = m.best[r]; if (!bid) continue;
    const share = ((mx.mix[dom][r] || 0) + 0.02) / tot, bu = UNIT_BY_ID[bid];
    const olds = UNITS_BY_ROLE[r].filter(u => u !== bu && n.techs[u.tech] !== undefined && u.rating >= bu.rating * 0.3 && u.rating < bu.rating).sort((a, b) => b.rating - a.rating).slice(0, 2);
    out.push({ unit: bid, w: share * (olds.length ? 0.7 : 1), role: r });
    for (const u of olds) out.push({ unit: u.id, w: share * 0.3 / olds.length, role: r });
  }
  return out;
}
// per-shot hit probability for battle agents: follows the land-score share / sea control / air superiority of the war
function hitChance(a, e) {
  const w = a && a.war ? S.wars.find(x => x.id === a.war) : null;
  let s;
  if (w && w.ls !== undefined) {
    const side = a.n === w.a ? 0 : a.n === w.b ? 1 : (a.side || 0);
    const u = a.unit && UNIT_BY_ID[a.unit], dom = a.dom || (u ? u.dom : a.kind === 'ship' ? 'sea' : a.kind === 'drone' ? 'air' : 'land');
    s = dom === 'air' ? w.air : dom === 'sea' ? w.sea : w.ls;
    if (side === 1) s = 1 - s;
  } else { const pa = power(S.nations[a.n] || S.nations[0]), pe = power(S.nations[e.n] || S.nations[0]); s = pa / (pa + pe || 1); }
  return 0.3 * clamp(s * 2, 0.4, 1.6);
}

/* ---------- leader / god API ---------- */
function setMilSplit(n, s) {
  const mx = ensureMil(n), t = [0, 1, 2].map(k => Math.max(0, +s[k] || 0)), sum = t[0] + t[1] + t[2];
  if (sum <= 0) return false;
  mx.split = t.map(v => v / sum); mx.auto = false; mx.tick = -1;
  return true;
}
function setMilMix(n, dom, role, share) {
  const mx = ensureMil(n), mix = mx.mix[dom];
  if (!mix || mix[role] === undefined) return false;
  share = clamp(+share || 0, 0, 1);
  const keys = Object.keys(mix).filter(r => r !== role); let o = 0; for (const r of keys) o += mix[r];
  for (const r of keys) mix[r] = o > 0 ? mix[r] / o * (1 - share) : (1 - share) / keys.length;
  mix[role] = share; mx.auto = false; mx.tick = -1;
  return true;
}
function milPreset(n, kind) {
  const mx = ensureMil(n), D = MIL_DOCT[n.ideo] || MIL_DOCT.tribal;
  const p = MIL_PRESET[kind] || D.split;
  mx.split = p.slice(); normW(mx.split); mx.tick = -1;
  if (isPlayer(n)) mx.auto = false; else mx.lock = S.year + 50;
  return true;
}
function milCommand(n, w, cmd) {
  const mx = ensureMil(n);
  if (cmd === 'sbomb' || cmd === 'unrestricted') mx.policy.manual = true;
  if (cmd === 'sbomb') { mx.policy.sbomb = !mx.policy.sbomb; return { ok: true, on: mx.policy.sbomb, msg: mx.policy.sbomb ? '恢复战略轰炸' : '停止战略轰炸' }; }
  if (cmd === 'unrestricted') { mx.policy.unrestricted = !mx.policy.unrestricted; return { ok: true, on: mx.policy.unrestricted, msg: mx.policy.unrestricted ? '宣布无限制潜艇战：中立国会愤怒，民主国家可能参战' : '恢复有限制的潜艇战' }; }
  if (!w || (w.a !== n.id && w.b !== n.id)) return { ok: false, msg: '没有这场战争' };
  warInit(w);
  const side = sideOf(w, n), o = S.nations[side === 0 ? w.b : w.a];
  if (cmd === 'amphib') {
    if (!o || !o.alive) return { ok: false, msg: '对手已不存在' };
    const sc = seaC(w, side), FO = milForces(o);
    if (FO.S > 0 && sc < 0.15) return { ok: false, msg: `制海权不足（${Math.round(50 + 50 * sc)}%），需要 58% 以上` };
    let best = null, bd = 1e9;
    for (const c of n.cl) if (c.coastal) for (const t of o.cl) if (t.coastal) { const d = cellDist(c.i, t.i); if (d < bd) { bd = d; best = [c, t]; } }
    if (!best) return { ok: false, msg: '双方都没有可以登陆的海岸' };
    const ord = orderAttack(best[0], best[1]);
    if (!ord) return { ok: false, msg: '无法发起登陆' };
    ord.amphib = 1; ord.str = 1.5 * (n.mult.era >= 5 ? 0.6 + 0.4 * Math.min(1, n.mult.amphib + 0.2) : 0.85);
    return { ok: true, msg: `两栖舰队从${best[0].name}出发，目标：${best[1].name}`, order: ord };
  }
  if (cmd === 'nuke') {
    if (!deterrent(n)) return { ok: false, msg: '需要核武器与投送手段（战略轰炸机或洲际导弹）' };
    return nukeStrike(n, o, w, false) ? { ok: true, msg: '核打击已执行' } : { ok: false, msg: '找不到目标' };
  }
  return { ok: false, msg: '未知命令' };
}
// doctrine reform: drop the domain's current doctrine (refund 50% of its cost) and target the new one
function chooseDoctrine(n, techId) {
  const t = TECH_BY_ID[techId];
  if (!t || !t.excl) return { ok: false, msg: '这不是一项学说' };
  const mx = ensureMil(n); let old = null, refund = 0;
  for (const o of EXCL[t.excl]) if (o !== t && n.techs[o.id] !== undefined) { old = o; refund += 0.5 * techCost(n, o.id); delete n.techs[o.id]; }
  mx.pref[t.excl] = techId;
  if (old) { n.mult = computeMult(n); n.mresearch += refund; techVersion++; log('war', `${n.name}进行学说改革：放弃「${old.name}」，改为研究「${t.name}」`, capitalCell(n), isPlayer(n)); }
  if (milTechOK(n, t)) { n.mtarget = techId; }
  return { ok: true, old: old ? old.id : null, refund, msg: milTechOK(n, t) ? `开始研究「${t.name}」` : `「${t.name}」的前置科技尚未完成` };
}
// old saves (S.v < 4): fill military state, move military research targets to the military track, fix doctrine conflicts
function migrateMil(st) {
  st = st || S;
  st.v = 4; if (!st.milDoc) st.milDoc = {}; if (!st.milPref) st.milPref = {};
  for (const n of st.nations) {
    ensureMil(n); n.mx.tick = -1; n.mx.F = null;
    if (n.target && TECH_BY_ID[n.target] && TECH_BY_ID[n.target].mil) { if (!n.mtarget) n.mtarget = n.target; n.target = null; }
    if (n.mtarget && !TECH_BY_ID[n.mtarget]) n.mtarget = null;
    if (resolveExcl(n) || n.mult) n.mult = computeMult(n);
  }
  for (const w of st.wars) { warInit(w); w.th = null; }
  return st;
}
