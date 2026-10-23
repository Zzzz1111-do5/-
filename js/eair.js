'use strict';
// 守方航空（v7）：野战机场 → 对地攻击机（一次通场：6 枚火箭齐射 + 机炮扫射）与武装直升机（300–380 外悬停，反坦克导弹 + 火箭）；
// 双方单兵防空导弹组（防空导弹在 missile.js 飞行与结算）；我方自行高炮、驱逐舰舰空导弹与近防炮、机枪打直升机；
// 守方视野（飞机是视野源）、绘制（剪影、旋翼、火箭、导弹、残骸，只用形状）
// 状态：S.eair = { wing: [{id, type, state: ready|out|rearm|lost, rearmT}], fly: [飞机], proj: [弹药], wr: [残骸], flash: [发射暴露], cratT, nextT, first, gap }
const eaOn = () => !!S && !(S.v7off && S.v7off.air);
const eaStat = (k, n = 1) => { const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
POWER.erk = { men: .45, ship: 2, struct: 0, seg: false, R: 18 };   // 机载火箭（守方只打进攻方，不伤自家工事）
const EA_DIFF = { normal: { wing: ['heli'], first: 210, gap: 150 }, hard: { wing: ['ga', 'heli'], first: 150, gap: 100 }, hell: { wing: ['ga', 'ga', 'heli'], first: 100, gap: 70 } };
const EA_SPEC = { ga: { name: '攻击机', spd: 200, turn: 1.4, hp: 1, flares: 2 }, heli: { name: '武装直升机', spd: 90, turn: 2.4, hp: 2, flares: 1 } };
const EA_MANPADS = { normal: 0, hard: 1, hell: 2 };   // 战役守军单兵防空组数
const EA_GUNV = ['tank', 'hv_tank', 'td', 'flame_tank', 'lt_tank', 'amtank', 'mine_tank'];
const eaAng = a => Math.atan2(Math.sin(a), Math.cos(a));

function eaEnsure() {
  if (!S.eair) S.eair = { wing: [], fly: [], proj: [], wr: [], flash: [], cratT: 0, nextT: 90, first: 90, gap: 80, aaT: 0, thinkT: 2, said: {} };
  return S.eair;
}
function eaAddWing(type) { const E = eaEnsure(); E.wing.push({ id: S.nid++, type: EA_SPEC[type] ? type : 'ga', state: 'ready', rearmT: 0 }); }
const eaBases = () => S.enemies.filter(e => e.kind === 'airfield' && !e.dead);
function eaNearBase(x, y) { let b = null, bd = Infinity; for (const e of eaBases()) { const d = dist(e.x, e.y, x, y); if (d < bd) { bd = d; b = e; } } return b; }
const eaWhere = (x, y) => typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);

// —— 战役：在指挥所以北纵深找一块平地修野战机场；按难度配飞机、守军单兵防空组；我方两个连各带一个便携防空组 ——
function eaPlaceBase() {
  const hq = S.points.find(p => p.key === 'HQ') || S.points.reduce((a, p) => p.y < a.y ? p : a, S.points[0]);
  const flat = (x, y) => isLand(x, y) && passInf(x, y) && [T.FIELD, T.ROAD].includes(typeAt(x, y));
  let best = null, bs = -1e9;
  for (let dx = -520; dx <= 520; dx += 40) for (let y = 70; y <= hq.y - 230; y += 30) {
    const x = clamp(hq.x + dx, 60, W - 60);
    if (!flat(x, y) || !flat(x - 18, y) || !flat(x + 18, y)) continue;
    if (S.points.some(p => dist(p.x, p.y, x, y) < 90) || S.enemies.some(e => dist(e.x, e.y, x, y) < 50)) continue;
    const sc = -Math.abs(dx) / 300 + Math.random() * 1.2 + (y > 120 ? .5 : 0);
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  if (!best) for (let k = 0; k < 400 && !best; k++) { const x = 80 + Math.random() * (W - 160), y = 60 + Math.random() * 400; if (isLand(x, y) && passInf(x, y) && coastAt(x) - y > 500) best = { x, y }; }
  return best ? addEnemy('airfield', best.x, best.y) : null;
}
function eaAddManpads(p) {
  const g = S.teams.find(q => q.side === 'e' && q.obj === p.key && q.role === 'garrison' && q.u != null);
  for (let k = 0; k < 20; k++) {
    const x = p.x + gauss() * 25, y = p.y + gauss() * 25;
    if (passInf(x, y)) return addTeam('e', x, y, ['rifle', 'rifle', 'aa'], { role: 'garrison', obj: p.key, u: g ? g.u : undefined, aam: 3 });
  }
  return null;
}
HOOK.newGame.push(function eaNewGame(opts) {
  if (!S) return;
  S.eair = null;
  if ((opts && opts.sandbox) || !eaOn()) return;
  const D = EA_DIFF[S.level];
  if (D && eaPlaceBase()) { const E = eaEnsure(); E.first = E.nextT = D.first; E.gap = D.gap; for (const t of D.wing) eaAddWing(t); }
  for (const s of S.ships) if (s.label === 'LA-3' || s.label === 'LS-1') s.aaN = 1;
  const n = EA_MANPADS[S.level] || 0, keys = ['HQ', 'RD', 'T1'];
  for (let i = 0, k = 0; i < n && k < keys.length; k++) { const p = S.points.find(p => p.key === keys[k]); if (p && eaAddManpads(p)) i++; }
});

// —— 每步 ——
function eaStep(dt) {
  if (!S || S.phase !== 'battle' || !eaOn()) return;
  eaConvert();
  const E = S.eair;
  if (E) {
    // 机场被毁：容量（每座 4 架）不够的地面飞机随之损失
    const cap = eaBases().length * 4, gnd = E.wing.filter(w => w.state === 'ready' || w.state === 'rearm');
    let over = E.wing.filter(w => w.state !== 'lost').length - cap;
    for (let i = gnd.length - 1; i >= 0 && over > 0; i--, over--) gnd[i].state = 'lost';
    if (over < 0 && !cap && E.wing.length && !E.said.base) { E.said.base = 1; log('敌野战机场被毁，停在地面的敌机全部损失', 'good'); }
    for (const w of E.wing) if (w.state === 'rearm' && (w.rearmT -= dt) <= 0) w.state = 'ready';
    for (const a of E.fly) if (!a.dead) { if (a.type === 'heli') eaFlyHeli(a, dt); else eaFlyGA(a, dt); }
    E.fly = E.fly.filter(a => !a.dead);
    eaProj(dt);
    for (const w of E.wr) if (!w.hit && S.t - w.t >= 2) { w.hit = true; const x = w.x + Math.cos(w.h) * w.spd * 2, y = w.y + Math.sin(w.h) * w.spd * 2; S.fx.push({ kind: isLand(x, y) ? 'boom' : 'flash', x, y, r: 14, life: 0, max: .8, side: 'e' }); }
    E.wr = E.wr.filter(w => S.t - w.t < 2.4);
    E.flash = E.flash.filter(f => S.t - f.t < 2);
    if ((E.thinkT -= dt) <= 0) { E.thinkT = 3; eaThink(); }
  }
  if (((E || eaEnsureLight()).aaT -= dt) <= 0) { (E || S.eaLight).aaT = .5; eaAA(); }
}
// 没有守方航空时也要跑单兵防空（守方打我方舰载机）：只用一个计时器
function eaEnsureLight() { if (!S.eaLight) S.eaLight = { aaT: 0 }; return S.eaLight; }

// 战役：LA-3、LS-1 抢滩后，本连最后一个小组的机枪手换成防空导弹手
function eaConvert() {
  for (const s of S.ships) {
    if (!s.aaN || s.aaDone || s.state !== 'beached') continue;
    s.aaDone = true;
    const u = S.units.find(u => u.side === 'p' && u.ship === s.label && u.kind === 'inf'), ts = u ? teamsOf(u).filter(q => q.men.length) : [];
    const q = ts[ts.length - 1];
    if (!q) continue;
    const i = q.men.lastIndexOf('mg') >= 0 ? q.men.lastIndexOf('mg') : q.men.lastIndexOf('rifle');
    if (i >= 0) { q.men[i] = 'aa'; q.aam = 3; }
  }
}

// —— 飞行 ——
function eaSteer(a, tx, ty, dt, spd) {
  const sp = EA_SPEC[a.type], df = eaAng(Math.atan2(ty - a.y, tx - a.x) - a.heading), turn = clamp(df, -sp.turn * dt, sp.turn * dt);
  a.heading = eaAng(a.heading + turn); a.bank = lerp(a.bank || 0, dt > 0 ? turn / (sp.turn * dt) : 0, Math.min(1, dt * 5));
  a.spd += clamp((spd ?? sp.spd) - a.spd, -60 * dt, 50 * dt);
  a.x += Math.cos(a.heading) * a.spd * dt; a.y += Math.sin(a.heading) * a.spd * dt;
  return dist(a.x, a.y, tx, ty);
}
// 跟踪目标的当前位置（只在守方看得见时更新）
function eaTgtObj(t) {
  if (!t) return null;
  if (t.k === 'ship') { const s = S.ships.find(o => o.id === t.id); return s && alive(s) ? s : null; }
  if (t.k === 'veh') { const v = (S.veh || []).find(o => o.id === t.id); return v && !v.dead ? v : null; }
  if (t.k === 'team') { const q = S.teams.find(o => o.id === t.id); return q && q.men.length ? q : null; }
  return null;
}
function eaTrack(a) {
  const o = eaTgtObj(a.tgt);
  if (a.tgt.k !== 'pt' && !o) { a.lost = true; return; }
  if (o && (spotted(o.x, o.y) || dist(o.x, o.y, a.x, a.y) < 160)) { a.tx = o.x; a.ty = o.y; }
}
function eaFlyGA(a, dt) {
  if (a.ph === 'out' || a.ph === 'attack') {
    eaTrack(a);
    const d = eaSteer(a, a.tx, a.ty, dt);
    a.alt = a.ph === 'attack' ? Math.max(.35, a.alt - dt * .25) : Math.min(.7, a.alt + dt * .4);
    if (a.ph === 'out' && d < 420) { a.ph = 'attack'; eaSpotSay(a); }
    if (a.ph === 'attack') {
      const df = Math.abs(eaAng(Math.atan2(a.ty - a.y, a.tx - a.x) - a.heading));
      if (d < 190 && df < .3 && a.ammo > 0) { eaRockets(a, 6, 20, .6, a.tx, a.ty); eaStrafe(a); a.ammo = 0; a.ph = 'egress'; a.egT = 3; }
      else if (d < 140 && df > 1.2) { a.ph = 'egress'; a.egT = 2.5; a.pass = (a.pass || 0) + 1; }   // 冲过头：拉起重新进入
    }
  } else if (a.ph === 'egress') {
    eaSteer(a, a.x + Math.cos(a.heading) * 200, a.y + Math.sin(a.heading) * 200, dt);
    a.alt = Math.min(.7, a.alt + dt * .3);
    if ((a.egT -= dt) <= 0) a.ph = a.ammo > 0 && (a.pass || 0) < 2 && !a.lost ? 'out' : 'rtb';
  } else eaRtb(a, dt);
}
// 直升机：在目标与机场连线上、离目标 340 处悬停（守方一侧），面向目标开火
function eaStandoff(a) {
  const b = eaNearBase(a.x, a.y) || { x: a.tx, y: 0 }, d = Math.max(1, dist(a.tx, a.ty, b.x, b.y)), r = Math.min(340, d * .8);
  let x = a.tx + (b.x - a.tx) / d * r, y = a.ty + (b.y - a.ty) / d * r;
  x = clamp(x, 20, W - 20); y = clamp(y, 20, H - 20);
  a.sx = x; a.sy = y; a.stx = a.tx; a.sty = a.ty;
}
function eaFlyHeli(a, dt) {
  a.alt = a.ph === 'rtb' ? Math.min(.3, a.alt + dt * .25) : Math.min(.3, a.alt + dt * .25);
  if (a.ph === 'out') {
    eaTrack(a);
    if (a.sx == null || dist(a.tx, a.ty, a.stx, a.sty) > 80) eaStandoff(a);
    const dd = dist(a.x, a.y, a.sx, a.sy), d = eaSteer(a, a.sx, a.sy, dt, dd < 90 ? Math.max(15, dd * .8) : undefined);
    if (d < 22 || (d < 60 && dist(a.x, a.y, a.tx, a.ty) < 390)) { a.ph = 'loiter'; a.loT = 12 + Math.random() * 28; a.fireT = 1.2; eaSpotSay(a); }
    if (a.lost && !eaRetarget(a)) a.ph = 'rtb';
  } else if (a.ph === 'loiter') {
    eaTrack(a);
    a.spd = Math.max(0, a.spd - 60 * dt);
    const want = Math.atan2(a.ty - a.y, a.tx - a.x);
    a.heading = eaAng(a.heading + clamp(eaAng(want - a.heading), -2 * dt, 2 * dt)); a.bank = 0;
    a.x += (Math.cos(a.heading) * a.spd + Math.sin(S.t * .7 + a.id) * 4) * dt; a.y += (Math.sin(a.heading) * a.spd + Math.cos(S.t * .9 + a.id) * 3) * dt;
    if ((a.fireT -= dt) <= 0) { a.fireT = 3.5; eaHeliFire(a); }
    if ((a.loT -= dt) <= 0 || (a.atgm <= 0 && a.rk <= 0)) a.ph = 'rtb';
  } else eaRtb(a, dt);
}
function eaHeliFire(a) {
  if (a.lost && !eaRetarget(a)) { a.ph = 'rtb'; return; }
  const d = dist(a.x, a.y, a.tx, a.ty);
  if (d > 430) { a.ph = 'out'; a.sx = null; return; }
  if (a.atgm > 0 && (a.tgt.k === 'veh' || a.tgt.k === 'ship')) { eaATGM(a); a.atgm--; return; }
  if (a.rk > 0) {
    let tg = null, bm = 0;   // 火箭：目标附近（或机下 380 以内）最密集的步兵
    for (const q of S.teams) {
      if (q.side !== 'p' || !q.men.length || q.ride || !spotted(q.x, q.y) || dist(q.x, q.y, a.x, a.y) > 380 || ownNear('e', q.x, q.y, 45)) continue;
      let m = 0; for (const o of S.teams) if (o.side === 'p' && o.men.length && !o.ride && dist(o.x, o.y, q.x, q.y) < 35) m += o.men.length;
      if (m > bm) { bm = m; tg = q; }
    }
    if (tg) { eaRockets(a, 4, 22, .9, tg.x, tg.y); a.rk--; return; }
  }
  if (!eaRetarget(a)) a.ph = 'rtb';
}
// 原目标没了：直升机就近另找车辆 / 舰船
function eaRetarget(a) {
  let best = null, bv = 0;
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && spotted(v.x, v.y) && dist(v.x, v.y, a.x, a.y) < 450) { const val = EA_GUNV.includes(v.type) ? 6 : 4; if (val > bv) { bv = val; best = { k: 'veh', id: v.id, x: v.x, y: v.y }; } }
  if (!best) for (const s of S.ships) if (alive(s) && s.state === 'unloading' && dist(s.x, s.y, a.x, a.y) < 450) { best = { k: 'ship', id: s.id, x: s.x, y: s.y }; break; }
  if (!best) return false;
  a.tgt = { k: best.k, id: best.id }; a.tx = best.x; a.ty = best.y; a.lost = false; a.sx = null;
  return true;
}
function eaRtb(a, dt) {
  const b = eaNearBase(a.x, a.y);
  if (a.type !== 'heli') a.alt = Math.min(.7, a.alt + dt * .3);
  if (!b) {   // 没有机场可回：向北转场离开
    eaSteer(a, a.x, -300, dt);
    if (a.y < -30) { a.dead = true; const w = S.eair.wing.find(w => w.id === a.wid); if (w) w.state = 'lost'; }
    return;
  }
  const d = eaSteer(a, b.x, b.y, dt, a.type === 'heli' && dist(a.x, a.y, b.x, b.y) < 80 ? 30 : undefined);
  if (d < (a.type === 'heli' ? 20 : 70)) {
    a.dead = true;
    const w = S.eair.wing.find(w => w.id === a.wid);
    if (w && w.state !== 'lost') { w.state = 'rearm'; w.rearmT = 60; }
  }
}

// —— 弹药：火箭（齐射，落点散布）与反坦克导弹（制导，八成命中）——
function eaRockets(a, n, spread, dur, tx, ty) {
  const E = S.eair;
  for (let i = 0; i < n; i++) E.proj.push({ k: 'rk', x0: a.x, y0: a.y, tx: tx + gauss() * spread, ty: ty + gauss() * spread, t: -i * .08, dur });
  eaStat('eaAtk');
}
function eaATGM(a) {
  const o = eaTgtObj(a.tgt);
  if (!o) return;
  S.eair.proj.push({ k: 'atgm', x0: a.x, y0: a.y, x: a.x, y: a.y, tx: o.x, ty: o.y, t: 0, dur: Math.max(.6, dist(a.x, a.y, o.x, o.y) / 260), tgt: { ...a.tgt } });
  eaStat('eaAtk');
}
// 扫射：目标 30 以内的我方小组受压制（无直接杀伤），曳光示意
function eaStrafe(a) {
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && dist(q.x, q.y, a.tx, a.ty) < 30) suppress(q, 30, a.x, a.y);
  for (let i = 0; i < 4; i++) tracer(a.x, a.y, a.tx + gauss() * 14, a.ty + gauss() * 14, 'e', true);
}
const eaMenNear = (x, y, r) => { let n = 0; for (const q of S.teams) if (q.side === 'p' && dist(q.x, q.y, x, y) < r) n += q.men.length; return n; };
function eaProj(dt) {
  const E = S.eair;
  for (const p of E.proj) {
    if (p.done || (p.t += dt) < 0) continue;
    if (p.k === 'atgm') {
      const o = eaTgtObj(p.tgt);
      if (o) { p.tx = o.x; p.ty = o.y; }
      const u = clamp(p.t / p.dur, 0, 1);
      p.x = lerp(p.x0, p.tx, u); p.y = lerp(p.y0, p.ty, u);
      if (u < 1) continue;
      p.done = true;
      if (o && Math.random() < .8) {
        if (p.tgt.k === 'veh') { vehDamage(o, 22, 3, p.x0, p.y0, 'atgm'); log(`${vehName(o)}被敌直升机反坦克导弹击中`, 'bad', 'eatgm' + o.id, 4, o); }
        else if (p.tgt.k === 'ship') { log(`${o.label} 被敌直升机反坦克导弹击中`, 'bad', 'eatgms' + o.id, 4, o); damageShip(o, 3); }
        S.fx.push({ kind: 'boom', x: p.tx, y: p.ty, r: 12, life: 0, max: .7, side: 'e' });
      } else S.fx.push({ kind: 'flash', x: p.tx + gauss() * 10, y: p.ty + gauss() * 10, r: 8, life: 0, max: .5, side: 'e' });
      continue;
    }
    if (p.t < p.dur) continue;
    p.done = true;
    const before = eaMenNear(p.tx, p.ty, POWER.erk.R);
    impact(p.tx, p.ty, POWER.erk, 'e');
    const k = before - eaMenNear(p.tx, p.ty, POWER.erk.R);
    if (k > 0) eaStat('eaKillMen', k);
  }
  E.proj = E.proj.filter(p => !p.done);
}

// —— 防空：双方单兵防空导弹组；我方自行高炮、舰空导弹、近防炮、机枪打直升机 ——
function eaAA() {
  const E = S.eair, fly = E ? E.fly.filter(a => !a.dead && a.alt > .1) : [];
  const busy = (side, k, id) => S.missiles && S.missiles.some(m => m.kind === 'sam' && m.side === side && !m.done && m.tgt && m.tgt.k === k && m.tgt.id === id);
  const canMs = typeof msLaunch === 'function';
  for (const q of S.teams) {
    if (!q.men.length || q.ride || !q.men.includes('aa')) continue;
    if (q.aam == null) q.aam = 3;
    q.aaCd = Math.max(0, (q.aaCd || 0) - .5);
    // 补弹：每 60 秒 1 枚（我方在接通的补给点附近，守方在本方据点附近）
    if (q.aam < 3 && S.t - (q.aaRe || 0) > 60) {
      const ok = q.side === 'p' ? (typeof nearestSupply === 'function' && (() => { const s = nearestSupply(q.x, q.y, true); return s && dist(s.x, s.y, q.x, q.y) < 120; })()) : S.points.some(p => p.owner === 'e' && dist(p.x, p.y, q.x, q.y) < 120);
      if (ok) { q.aam++; q.aaRe = S.t; }
    }
    if (!canMs || q.aam <= 0 || q.aaCd > 0 || q.sup >= 60 || S.t - q.movedT < .6) continue;
    let tg = null, bd = Infinity, k = null;
    if (q.side === 'e') {
      for (const p of S.planes) {
        if (p.dead || !(p.alt > .25) || ['cat', 'roll', 'trap', 'final'].includes(p.phase)) continue;
        const r = p.v === 'heli' ? 260 : p.kind === 'bomber' && p.v !== 'dive' ? 150 : 230, d = dist(p.x, p.y, q.x, q.y);
        if (d < r && d < bd && !busy('e', 'plane', p.id)) { bd = d; tg = p; k = 'plane'; }
      }
    } else for (const a of fly) {
      const d = dist(a.x, a.y, q.x, q.y);
      if (d < (a.type === 'heli' ? 260 : 230) && d < bd && !busy('p', 'eair', a.id)) { bd = d; tg = a; k = 'eair'; }
    }
    if (!tg) continue;
    msLaunch('sam', q.side, q.x, q.y, { x: tg.x, y: tg.y }, { tgt: { k, id: tg.id }, src: 'manpads', dur: 2.2, spd: 380, sup: q.sup });
    q.aaCd = 7; q.aam--;
    eaStat('aaShot');
    if (q.side === 'e') { q.seen = S.t; q.sx = q.x; q.sy = q.y; q.aaSeen = S.t; q.aax = q.x; q.aay = q.y; log('敌单兵防空导弹发射，位置暴露', 'warn', 'emanpads', 8, q); }
    else { q.aaSeenE = S.t; if (E) E.flash.push({ x: q.x, y: q.y, t: S.t }); }
  }
  if (!fly.length) return;
  const hit = (a, how, p) => {
    if (Math.random() >= p) return false;
    if ((a.hp -= 1) <= 0) eaLost(a, how); else if (a.ph !== 'rtb') { a.ph = 'rtb'; log(`敌${EA_SPEC[a.type].name}中弹，放弃攻击`, 'good', 'eahit' + a.id, 6, a); }
    return true;
  };
  const D = typeof msDefShips === 'function' ? msDefShips() : [];
  for (const a of fly) {
    a.pv = PV[ci(clamp(a.x, 0, W - 1), clamp(a.y, 0, H - 1))] === 1 || S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, a.x, a.y) < 400) || (S.veh || []).some(v => v.side === 'p' && !v.dead && dist(v.x, v.y, a.x, a.y) < 400);
    let gone = false;
    for (const v of S.veh || []) {
      if (gone || v.dead || v.side !== 'p' || v.type !== 'aa_veh' || dist(v.x, v.y, a.x, a.y) > 230) continue;
      for (let i = 0; i < 3; i++) tracer(v.x, v.y, a.x + gauss() * 10, a.y + gauss() * 10, 'p', true);
      if (hit(a, 'aa', .1)) gone = a.dead;
    }
    for (const s of D) {
      if (gone) break;
      const d = dist(s.x, s.y, a.x, a.y);
      if (d < (s.esc ? 260 : 300)) {   // 近防炮
        for (let i = 0; i < 2; i++) tracer(s.x, s.y, a.x + gauss() * 8, a.y + gauss() * 8, 'p', true);
        if (hit(a, 'ciws', s.esc ? .05 : a.type === 'heli' ? .1 : .06)) gone = a.dead;
      } else if (canMs && d < (s.esc ? 550 : 650) && (s.o.samCd || 0) <= S.t && !busy('p', 'eair', a.id)) {   // 舰空导弹
        s.o.samCd = S.t + (s.esc ? 5 : 4);
        msLaunch('sam', 'p', s.x, s.y, { x: a.x, y: a.y }, { tgt: { k: 'eair', id: a.id }, src: s.esc ? 'esc' : 'dd', spd: 520, dur: 3 });
        eaStat('aaShot');
      }
    }
    if (!gone && a.type === 'heli') for (const q of S.teams) {   // 机枪打直升机
      if (q.side !== 'p' || !q.men.includes('mg') || q.ride || q.sup >= 60 || dist(q.x, q.y, a.x, a.y) > 150) continue;
      tracer(q.x, q.y, a.x + gauss() * 6, a.y + gauss() * 6, 'p', true);
      if (hit(a, 'mg', .02)) { gone = a.dead; if (gone) break; }
    }
  }
}
// 击落一架守方飞机：空中爆炸 + 翻滚坠落 2 秒
function eaLost(a, how) {
  if (!a || a.dead) return;
  a.dead = true;
  const E = S.eair, w = E && E.wing.find(w => w.id === a.wid);
  if (w) w.state = 'lost';
  S.fx.push({ kind: 'boom', x: a.x, y: a.y, r: 20, life: 0, max: 1, side: 'e' });
  if (E) E.wr.push({ x: a.x, y: a.y, h: a.heading, spd: Math.min(70, a.spd * .4 + 10), t: S.t, type: a.type, hit: false });
  eaStat('eaLost');
  const nm = EA_SPEC[a.type].name, by = { manpads: '便携防空导弹', sam: '舰空导弹', aa: '自行高炮', mg: '机枪火力', ciws: '舰上近防炮' }[how] || '防空火力';
  log(`${by}击落敌${nm}`, 'good', null, 0, a);
  if (typeof chatSay === 'function') {
    chatSay('p', `报告：${by}击落敌${nm} 1 架。`, { kind: 'report', at: { x: a.x, y: a.y }, key: 'eakill' + a.id, gap: 5 });
    chatSay('e', `报告：一架${nm}未能返航。`, { kind: 'report', lv: 1, key: 'ealost', gap: 20 });
  }
}
// 我方发现来袭敌机：报告 + 补救（便携防空组就地停下对空、自动指挥的自行高炮前出掩护）
function eaSpotSay(a) {
  if (a.said) return;
  a.said = true;
  const nm = EA_SPEC[a.type].name, o = eaTgtObj(a.tgt), what = !o ? '前沿阵地' : a.tgt.k === 'ship' ? `${o.label}登陆舰` : a.tgt.k === 'veh' ? vehName(o) : '步兵';
  if (typeof chatSay !== 'function') return;
  if (!a.pv && S.role !== 'spectate') return;
  chatSay('p', `报告：敌${nm}出现在${eaWhere(a.x, a.y)}，正扑向我${what}。`, { kind: 'report', at: { x: a.x, y: a.y }, key: 'easpot', gap: 25 });
  let n = 0;
  for (const q of S.teams) if (q.side === 'p' && q.men.includes('aa') && (q.aam ?? 3) > 0 && dist(q.x, q.y, a.tx, a.ty) < 450) {
    const u = unitOf(q);
    if (u && u.auto && q.order.t !== 'charge') { q.order = { t: 'hold' }; n++; }
  }
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && v.type === 'aa_veh' && v.auto && dist(v.x, v.y, a.tx, a.ty) < 700 && typeof vehGo === 'function') {
    const d = Math.max(1, dist(v.x, v.y, a.tx, a.ty)), k = Math.max(0, d - 140) / d;
    if (vehGo(v, v.x + (a.tx - v.x) * k, v.y + (a.ty - v.y) * k, 'move')) n++;
  }
  if (n) chatSay('p', '命令：便携防空组就地对空，自行高炮前出掩护。', { kind: 'remedy', at: { x: a.tx, y: a.ty }, key: 'earem', gap: 40 });
}

// —— 出击决策（每 3 秒，守方所知）：卸载中的登陆舰 8、坦克 6、装甲车 4、密集步兵 人数·0.6、补给站 5；
//    已知我方防空每处 −6、驱逐舰 300 以内 −4；够 6 分才出击，两次出击至少间隔 gap 秒 ——
function eaTargets() {
  const out = [], radar = typeof radarUp === 'function' ? radarUp() : null;
  for (const s of S.ships) if (alive(s) && (s.state === 'unloading' || (s.load && s.load.teams > 0 && s.y < coastAt(s.x) + 380)) && shipSeen(s.x, s.y, radar)) out.push({ k: 'ship', id: s.id, x: s.x, y: s.y, v: s.state === 'unloading' ? 8 : 6, nm: `${s.label}登陆舰` });
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && spotted(v.x, v.y)) out.push({ k: 'veh', id: v.id, x: v.x, y: v.y, v: EA_GUNV.includes(v.type) ? 6 : v.type === 'apc' ? 4 : v.type === 'aa_veh' ? 0 : 3, nm: vehName(v) });
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length && !q.ride && spotted(q.x, q.y));
  for (const q of pT) { let m = 0; for (const o of pT) if (dist(o.x, o.y, q.x, q.y) < 50) m += o.men.length; if (m >= 9) out.push({ k: 'team', id: q.id, x: q.x, y: q.y, v: m * .6, nm: `${m} 人的集结步兵` }); }
  for (const L of S.supply) if (L.connected && spotted(L.x, L.y)) out.push({ k: 'pt', x: L.x, y: L.y, v: 5, nm: '滩头补给站' });
  const CA = S.ai && S.ai.co && S.ai.co.ca;
  if (CA) for (const c of CA) if (c.st === 'prep') { const p = S.points.find(p => p.key === c.key); if (p) out.push({ k: 'pt', x: p.x, y: p.y, v: 7, nm: `${p.name}的守敌` }); }
  const aaV = (S.veh || []).filter(v => v.side === 'p' && !v.dead && v.type === 'aa_veh' && (spotted(v.x, v.y) || (v.es != null && S.t - v.es < 120)));
  const aaQ = S.teams.filter(q => q.side === 'p' && q.men.length && q.men.includes('aa') && q.aaSeenE != null && S.t - q.aaSeenE < 120);
  const dd = S.dd && S.dd.state !== 'sunk' ? S.dd : null;
  for (const t of out) {
    t.v -= 6 * (aaV.filter(v => dist(v.x, v.y, t.x, t.y) < 260).length + aaQ.filter(q => dist(q.x, q.y, t.x, t.y) < 260).length);
    if (dd && dist(dd.x, dd.y, t.x, t.y) < 300) t.v -= 4;
    if (ownNear('e', t.x, t.y, 55)) t.v = 0;
  }
  return out;
}
const EA_PREF = { heli: { veh: 1.3, ship: 1.1, team: .9, pt: .8 }, ga: { veh: 1, ship: 1.3, team: 1.2, pt: 1.1 } };
function eaThink() {
  const E = S.eair;
  if (S.t < E.cratT || !eaBases().length) return;
  // 两次出击间隔 gap 秒；另一机种可提前一半时间出动（直升机与攻击机各打各的）
  const ready = E.wing.filter(w => w.state === 'ready' && S.t >= E.first && (S.t >= E.nextT || (E.lastType && w.type !== E.lastType && S.t >= E.nextT - E.gap / 2)));
  if (!ready.length) return;
  let best = null, bs = 6, bw = null;
  for (const t of eaTargets()) for (const type of ['heli', 'ga']) {
    const w = ready.find(w => w.type === type);
    if (!w) continue;
    const s = t.v * EA_PREF[type][t.k];
    if (s >= bs) { bs = s; best = t; bw = w; }
  }
  if (!best) return;
  const b = eaNearBase(best.x, best.y), sp = EA_SPEC[bw.type];
  const a = { id: S.nid++, wid: bw.id, type: bw.type, x: b.x, y: b.y, heading: Math.atan2(best.y - b.y, best.x - b.x), spd: bw.type === 'ga' ? 90 : 0, alt: .02, bank: 0,
    ph: 'out', tx: best.x, ty: best.y, tgt: { k: best.k, id: best.id }, ammo: 1, atgm: bw.type === 'heli' ? 2 : 0, rk: bw.type === 'heli' ? 2 : 0, flares: sp.flares, hp: sp.hp, t: S.t, pv: false };
  bw.state = 'out'; E.fly.push(a); E.nextT = S.t + E.gap; E.lastType = bw.type;
  eaStat('eaSortie');
  if (typeof chatSay === 'function') chatSay('e', `命令：${sp.name}一个架次出击，打击${eaWhere(best.x, best.y)}的${best.nm}。`, { kind: 'order', at: { x: best.x, y: best.y }, lv: 1, key: 'easort', gap: 15 });
}
// 已知（被我方看到发射过）的敌单兵防空组：攻方派机时避开
function eaThreat(x, y) {
  let n = 0;
  if (!S) return 0;
  for (const q of S.teams) if (q.side === 'e' && q.men.length && q.aaSeen != null && S.t - q.aaSeen < 120 && q.men.includes('aa') && dist(q.aax, q.aay, x, y) < 260) n++;
  return n;
}

// 跑道中弹：60 秒内暂停出击
function eaImpact(x, y, R, pw, side) {
  if (!S.eair || side !== 'p') return;
  for (const b of eaBases()) if (dist(b.x, b.y, x, y) < 60 + R * .5) {
    S.eair.cratT = Math.max(S.eair.cratT, S.t + 60);
    if (inVision(b.x, b.y)) log('敌野战机场跑道中弹，敌机暂时无法起飞', 'good', 'eacrat', 20, b);
  }
}
// 守方视野：飞机（半径 120）与我方防空导弹的发射尾焰（2 秒，半径 60）
function eaVision() {
  if (!S || !S.eair || !eaOn()) return [];
  const o = [];
  for (const a of S.eair.fly) if (!a.dead && a.alt > .1) o.push({ x: a.x, y: a.y, r: 120, h: 1.5 });
  for (const f of S.eair.flash) o.push({ x: f.x, y: f.y, r: 60, h: .5 });
  return o;
}

// —— 绘制 ——
function eaDraw(time) {
  if (!S || !S.eair || !eaOn() || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, E = S.eair, spec = S.role === 'spectate', lw = px(1.3);
  // 机场上待命 / 整备的飞机（机场在视野内或观战）
  for (const b of eaBases()) {
    if (!spec && !inVision(b.x, b.y)) continue;
    let k = 0;
    for (const w of E.wing) if (w.state === 'ready' || w.state === 'rearm') {
      if (k >= 4) break;
      const x = b.x - 15 + k * 10, y = b.y + 10;
      if (typeof drawAircraft === 'function') drawAircraft(ctx, x, y, -Math.PI / 2, w.type === 'heli' ? 'heli' : 'strike', 8, COL.enemy, w.state === 'ready' ? .85 : .4, 0, px(1));
      k++;
    }
  }
  // 弹药
  for (const p of E.proj) {
    if (p.t < 0 || p.done) continue;
    if (!spec && !inVision(p.tx, p.ty) && !inVision(p.x0, p.y0)) continue;
    if (p.k === 'rk') {
      const u = clamp(p.t / p.dur, 0, 1), x = lerp(p.x0, p.tx, u), y = lerp(p.y0, p.ty, u), a = Math.atan2(p.ty - p.y0, p.tx - p.x0);
      ctx.strokeStyle = rgba(COL.enemy, .9); ctx.lineWidth = px(1.6); ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 9, y - Math.sin(a) * 9); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = rgba(COL.amber, .9); ctx.beginPath(); ctx.arc(x, y, Math.max(.8, px(1.6)), 0, 7); ctx.fill();
    } else {
      ctx.strokeStyle = rgba(COL.enemy, .55); ctx.lineWidth = px(1); ctx.beginPath(); ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, px(2.2)), 0, 7); ctx.fill();
    }
  }
  // 坠落残骸：翻滚、拖烟
  for (const w of E.wr) {
    const age = S.t - w.t, x = w.x + Math.cos(w.h) * w.spd * age, y = w.y + Math.sin(w.h) * w.spd * age;
    if (!spec && !inVision(x, y)) continue;
    ctx.strokeStyle = rgba(COL.smoke, .35); ctx.lineWidth = px(3); ctx.beginPath(); ctx.moveTo(w.x, w.y); ctx.lineTo(x, y); ctx.stroke();
    if (typeof drawAircraft === 'function') drawAircraft(ctx, x, y, w.h + age * 5, w.type === 'heli' ? 'heli' : 'strike', 14 * (1 - age * .2), COL.enemy, .6 * (1 - age / 2.4), 0, lw);
  }
  // 飞机：地面投影 + 剪影；直升机加旋转的主旋翼
  for (const a of E.fly) {
    if (a.dead || !(spec || a.pv || inVision(a.x, a.y))) continue;
    const heli = a.type === 'heli', size = Math.max(heli ? 15 : 17, px(heli ? 17 : 19));
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(a.x + a.alt * 14, a.y + a.alt * 22, size * .35, size * .22, a.heading, 0, 7); ctx.fill();
    if (typeof drawAircraft === 'function') drawAircraft(ctx, a.x, a.y, a.heading, heli ? 'heli' : 'strike', size, COL.enemy, 1, a.bank || 0, lw);
    if (heli) {
      const r = size * 9.5 / 21, cx = a.x + Math.cos(a.heading) * size * 1.5 / 21, cy = a.y + Math.sin(a.heading) * size * 1.5 / 21, ang = time * 22 + a.id;
      ctx.strokeStyle = rgba(COL.enemy, .6); ctx.lineWidth = px(1.2); ctx.beginPath();
      for (let k = 0; k < 2; k++) { const b = ang + k * Math.PI / 2; ctx.moveTo(cx - Math.cos(b) * r, cy - Math.sin(b) * r); ctx.lineTo(cx + Math.cos(b) * r, cy + Math.sin(b) * r); }
      ctx.stroke();
    }
  }
}

HOOK.step.push(eaStep);
HOOK.impact.push(eaImpact);
HOOK.visionE.push(eaVision);
HOOK.drawOver.push(eaDraw);
