'use strict';
// 战术导弹（v7）：进攻方战术弹道导弹——驱逐舰垂直发射，驱逐舰沉没时由战区导弹部队发射；
// 弹道飞行、末段可被雷达高炮与守军弹炮防空车拦截、命中按 POWER.tbm 结算；HUD 按钮（I 键）、AI 用弹、绘制（只用形状）。
// 守方战术导弹发射车（e_tel）：纵深机动阵地，载弹 2 枚，打卸载中的登陆舰、滩头补给站与密集部队（射程 300–1800）；
// 发射即暴露，随即转移阵地；末段可被我方驱逐舰舰空导弹与弹炮防空车拦截；守方弹头不伤自家工事（POWER.etbm）。
// 接口按 SPEC-v7：msOn / msLaunch / msFireP / msCommandP；岸舰导弹、单兵防空导弹在此基础上扩展。
POWER.tbm = { men: .9, ship: 6, struct: 24, seg: true, R: 40 };
POWER.etbm = { men: .9, ship: 6, struct: 0, seg: true, R: 40 };
const MS_TEL = { normal: 75, hard: 60, hell: 45 };   // 守方发射车两次发射的间隔（秒）
const msOn = () => !!S && !(S.v7off && S.v7off.msl);
const MS_STOCK = { normal: 3, hard: 2, hell: 2 };
const MSV = { S: null, trail: new Map(), rings: [], fl: [] };   // fl：干扰弹（仅画面）   // 渲染缓存（不进 S）：尾迹点、命中扩散环
const msName = e => (ENEMY_SPEC[e.kind] || { name: '目标' }).name;

function msEnsure() {
  if (!S) return;
  if (!Array.isArray(S.missiles)) S.missiles = [];
  if (!S.msl) S.msl = { p: { used: 0, hit: 0 }, warn: [] };
  if (!S.assets) S.assets = {};
  if (S.assets.msl == null) S.assets.msl = S.mode === 'sandbox' ? 0 : MS_STOCK[S.level] ?? 2;
}
HOOK.newGame.push(function msNewGame(opts) {
  if (!S) return;
  S.missiles = []; S.msl = { p: { used: 0, hit: 0 }, warn: [] };
  S.assets.msl = opts && opts.sandbox ? 0 : MS_STOCK[S.level] ?? 2;   // 沙盒的导弹从目录购买（p_tbm）
  if (!(opts && opts.sandbox) && msOn() && S.level === 'hell') { msPlaceAscm(4); msPlaceTel(); }   // 战役地狱难度：侧翼岬角一个岸舰导弹连、纵深一辆战术导弹发射车
});

// 发射一枚：tgt = {x, y}；opts.delay 秒后才真正升空，opts.src 记发射平台
function msLaunch(kind, side, x0, y0, tgt, opts = {}) {
  msEnsure();
  const d = dist(x0, y0, tgt.x, tgt.y), dur = opts.dur || (kind === 'tbm' ? 5 + d / 600 : 2.2);
  const m = { id: S.nid++, kind, side, x0, y0, x: x0, y: y0, z: 0, tx: tgt.x, ty: tgt.y, t: -(opts.delay || 0), dur, tgt: opts.tgt || null, ph: opts.delay ? 'wait' : 'boost', icp: false, src: opts.src || null,
    spd: opts.spd || null, pk: opts.pk || null, sup: opts.sup || 0 };
  S.missiles.push(m);
  return m;
}

// 玩家（或 AI）对地面一点发射战术导弹：圆概率误差 σ 8
function msFireP(x, y, ai) {
  msEnsure();
  if (!msOn() || S.phase !== 'battle') { if (!ai) log('战术导弹在 H 时之后才能使用', 'warn', 'msl0', 2); return false; }
  if (!(S.assets.msl > 0)) { if (!ai) log('战术导弹已用完', 'warn', 'msl0', 2); return false; }
  if (!isLand(x, y)) { if (!ai) log('战术导弹只能打击陆上目标', 'warn', 'msl1', 2); return false; }
  const tx = clamp(x + gauss() * 8, 0, W), ty = clamp(y + gauss() * 8, 0, H), dd = S.dd, ship = dd && dd.state !== 'sunk' && isFinite(dd.x);
  const m = ship ? msLaunch('tbm', 'p', dd.x, dd.y, { x: tx, y: ty }, { src: 'dd' }) : msLaunch('tbm', 'p', tx, H + 60, { x: tx, y: ty }, { src: 'theatre', delay: 6 });
  S.assets.msl--; S.msl.p.used++; S.stats.shots++;
  if (ship) S.fx.push({ kind: 'flash', x: dd.x, y: dd.y, r: 18, life: 0, max: .6, side: 'p' });
  log(ship ? `驱逐舰垂直发射战术导弹，约 ${Math.round(m.dur)} 秒后命中` : `战区导弹部队发射战术导弹，约 ${Math.round(m.dur + 6)} 秒后命中`, 'info', null, 0, { x: tx, y: ty });
  return true;
}

// —— 每步：飞行、末段拦截、命中 ——
const msStat = (k, n = 1) => { const o = S.v7s || (S.v7s = {}); o[k] = (o[k] || 0) + n; };
const msPuff = (x, y, side, big) => S.fx.push({ kind: 'flash', x, y, r: big ? 15 : 8, life: 0, max: big ? .7 : .45, side });
function msStep(dt) {
  if (!S || !Array.isArray(S.missiles) || !S.missiles.length) return;
  for (const m of S.missiles) {
    if (m.done) continue;
    if ((m.t += dt) < 0) continue;
    if (m.ph === 'wait') { m.ph = 'boost'; if (m.kind === 'asm') S.fx.push({ kind: 'flash', x: m.x0, y: m.y0, r: 12, life: 0, max: .5, side: m.side }); }
    if (m.kind === 'sam') { msSam(m, dt); continue; }
    if (m.kind === 'asm') { msAsm(m, dt); continue; }
    const u = clamp(m.t / m.dur, 0, 1);
    m.x = lerp(m.x0, m.tx, u); m.y = lerp(m.y0, m.ty, u); m.z = Math.sin(Math.PI * u) * (m.kind === 'tbm' ? 1 : .15);
    if (m.t > 1) m.ph = u > .8 ? 'term' : 'mid';
    // 末段：目标 200 以内的守军高炮各有一次拦截机会（雷达高炮更高）
    if (m.side === 'p' && u > .85 && !m.aaTry) {
      m.aaTry = true;
      for (const a of S.enemies) {
        if (a.dead || a.kind !== 'aa' || dist(a.x, a.y, m.tx, m.ty) > 200) continue;
        if (Math.random() < .1 * ((a.mod && a.mod.aa) || 1) * (1 - (a.sup || 0) / 130)) {
          m.done = m.icp = true;
          S.fx.push({ kind: 'flash', x: m.x, y: m.y - 20, r: 14, life: 0, max: .7, side: 'e' });
          log('战术导弹在末段被敌防空火力拦截', 'bad', null, 0, { x: m.x, y: m.y });
          if (a.kx == null) { a.kx = a.x; a.ky = a.y; }
          break;
        }
      }
      if (m.done) continue;
    }
    // 守方来袭弹道导弹：落点 650 以内的我方驱逐舰（旗舰 / 护航舰）在末段发射一枚舰空导弹拦截
    if (m.side === 'e' && u > .62 && !m.samTry) {
      const s = msDefShips().filter(o => dist(o.x, o.y, m.tx, m.ty) < 650 && (o.o.samCd || 0) <= S.t).sort((a, b) => dist(a.x, a.y, m.tx, m.ty) - dist(b.x, b.y, m.tx, m.ty))[0];
      if (s) {
        m.samTry = true; s.o.samCd = S.t + 1.5;
        msLaunch('sam', 'p', s.x, s.y, { x: m.x, y: m.y }, { tgt: { k: 'msl', id: m.id }, src: s.esc ? 'esc' : 'dd', spd: 720, dur: 2.2, pk: s.esc ? .25 : .35 });
        msStat('abmTbm');
      }
    }
    if (u >= 1) {
      m.done = true;
      const before = m.side === 'e' ? S.teams.filter(q => q.side === 'p').reduce((a, q) => a + q.men.length, 0) : 0;
      impact(m.tx, m.ty, m.side === 'e' ? POWER.etbm : POWER.tbm, m.side);
      S.fx.push({ kind: 'boom', x: m.tx, y: m.ty, r: 52, life: 0, max: 1.5, side: m.side });
      if (m.side === 'p') {
        S.msl.p.hit++;
        const hit = S.enemies.filter(e => e.dead && dist(e.x, e.y, m.tx, m.ty) < 50);
        log(hit.length ? `战术导弹命中，摧毁${msName(hit[0])}` : '战术导弹命中目标区', 'good', null, 0, { x: m.tx, y: m.ty });
      } else {
        const k = before - S.teams.filter(q => q.side === 'p').reduce((a, q) => a + q.men.length, 0);
        msStat('telHit'); if (k > 0) msStat('telKill', k);
        log(`敌战术导弹在${typeof cmdWhere === 'function' ? cmdWhere(m.tx, m.ty) : gridRef(m.tx, m.ty)}爆炸${k > 0 ? `，我 ${k} 人伤亡` : ''}`, 'bad', null, 0, { x: m.tx, y: m.ty });
      }
    }
  }
  S.missiles = S.missiles.filter(m => !m.done);
}

// —— 目标解算：tgt = {k, id}；k ∈ plane（我方舰载机）/ eair（守方飞机）/ msl（导弹）/ ship / dd / cv ——
function msTgtObj(t) {
  if (!t) return null;
  if (t.k === 'plane') { const p = S.planes.find(o => o.id === t.id); return p && !p.dead ? p : null; }
  if (t.k === 'eair') { const a = S.eair && S.eair.fly ? S.eair.fly.find(o => o.id === t.id) : null; return a && !a.dead ? a : null; }
  if (t.k === 'msl') { const m = S.missiles.find(o => o.id === t.id); return m && !m.done && m.t >= 0 ? m : null; }
  if (t.k === 'ship') { const s = S.ships.find(o => o.id === t.id); return s && alive(s) ? s : null; }
  if (t.k === 'dd') return S.dd && S.dd.state !== 'sunk' ? S.dd : null;
  if (t.k === 'cv') { const c = typeof cvOf === 'function' ? cvOf(t.id) : null; return c && c.hp > 0 ? c : null; }
  return null;
}
const msTgtName = t => !t ? '目标' : t.k === 'dd' ? '驱逐舰' : t.k === 'cv' ? '航母' : t.k === 'ship' ? ((S.ships.find(o => o.id === t.id) || {}).label || '舰船') : '目标';

// 防空导弹（单兵 / 舰空 / 战斗机空空导弹）：纯追踪，380（舰空 560、空空 640）每秒，超时自毁；进入 12 以内结算毁伤
function msSam(m, dt) {
  const T = msTgtObj(m.tgt);
  if (!T || m.t > m.dur) { m.done = true; msPuff(m.x, m.y, m.side); return; }
  const d = dist(m.x, m.y, T.x, T.y), st = (m.spd || 380) * dt;
  m.hd = Math.atan2(T.y - m.y, T.x - m.x); m.z = Math.min(.6, (T.alt != null ? T.alt : T.z || .05) * .6 + Math.min(1, m.t * 2) * .05);
  if (d > Math.max(12, st)) { m.x += Math.cos(m.hd) * st; m.y += Math.sin(m.hd) * st; return; }
  m.done = true; m.x = T.x; m.y = T.y;
  msSamHit(m, T);
}
function msSamHit(m, T) {
  const k = m.tgt.k;
  const samv = m.src === 'samv';   // 弹炮防空车（vehicles.js vehSam）：单发命中率随弹带来（m.pk）
  if (k === 'msl') {   // 拦截来袭导弹
    if (Math.random() < (m.pk || .35)) { T.done = T.icp = true; msPuff(T.x, T.y, m.side, true); msStat('mslIcpt'); msIcpt(T, samv ? '弹炮防空车' : '舰空导弹'); } else msPuff(m.x, m.y, m.side);
    return;
  }
  let base, flare = 1;
  const aam = m.src === 'aam';   // 战斗机空空导弹（airwar.js）：单发命中率随弹带来（m.pk）
  if (k === 'plane') {
    base = (aam || samv ? m.pk : T.kind === 'recon' ? .3 : T.v === 'heli' ? .62 : T.kind === 'bomber' && T.v !== 'dive' ? .32 : .42) * (aam ? 1 : (1 + (typeof airStealth === 'function' ? airStealth(T) : 1)) / 2);   // 隐身机：防空导弹难以锁定
    if (!T.samN) { T.samN = 1; flare = .6; MSV.fl.push({ x: T.x, y: T.y, t: S.t }); }   // 第一枚多半被干扰弹骗走
  } else {
    base = (aam || samv ? m.pk : m.src === 'dd' || m.src === 'esc' ? (T.type === 'heli' ? .55 : .6) : T.type === 'heli' ? .62 : .42) * (aam ? 1 : (1 + ((typeof EA_SPEC === 'object' && EA_SPEC[T.type] && EA_SPEC[T.type].stealth) || 1)) / 2);   // F-35A 隐身
    if (T.flares > 0) { T.flares--; flare = .6; MSV.fl.push({ x: T.x, y: T.y, t: S.t }); }
  }
  if (Math.random() < base * (1 - clamp(m.sup || 0, 0, 100) / 150) * flare) {
    msStat('aaKill');
    if (k === 'plane') { if (typeof airLost === 'function') airLost(T, `${typeof airName === 'function' ? airName(T.kind, T.v) : '飞机'}被敌${aam ? '歼击机空空导弹' : samv ? '弹炮防空车' : '单兵防空导弹'}击落`); }
    else if (typeof eaLost === 'function') eaLost(T, aam ? 'aam' : samv ? 'samv' : m.src === 'dd' || m.src === 'esc' ? 'sam' : 'manpads');
    if (aam && typeof awScore === 'function') awScore(m.side);
  } else msPuff(m.x, m.y, m.side);
}
function msIcpt(T, how) {
  if (T.side === 'e') log(`${how}拦截一枚来袭的${T.kind === 'tbm' ? '战术弹道导弹' : '岸舰导弹'}`, 'good', 'icpt', 1.5, { x: T.x, y: T.y });
  else log('我方导弹被拦截', 'bad', 'icptp', 2, { x: T.x, y: T.y });
}

// 防空舰艇：旗舰驱逐舰与护航驱逐舰（沙盒）；返回 [{o, x, y, id, esc}]
function msDefShips() {
  const out = [];
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x)) out.push({ o: S.dd, x: S.dd.x, y: S.dd.y, id: 'DD', esc: false });
  for (const s of S.ships) if (s.kind === 'dd' && alive(s)) out.push({ o: s, x: s.x, y: s.y, id: s.id, esc: true });
  return out;
}
// 岸舰导弹：掠海 260 每秒，每步重新对准目标，最后 200 蛇形机动；外层舰空导弹、内层近防炮拦截
function msAsm(m, dt) {
  const T = msTgtObj(m.tgt);
  if (T) { m.tx = T.x; m.ty = T.y; }
  if (m.bx == null) { m.bx = m.x; m.by = m.y; }
  const d = dist(m.bx, m.by, m.tx, m.ty), st = (m.spd || 260) * dt;
  m.hd = Math.atan2(m.ty - m.by, m.tx - m.bx); m.z = .04;
  if (d > Math.max(10, st)) { m.bx += Math.cos(m.hd) * st; m.by += Math.sin(m.hd) * st; }
  else { m.bx = m.tx; m.by = m.ty; }
  const w = d < 200 ? Math.sin(m.t * 9) * 6 : 0;
  m.x = m.bx - Math.sin(m.hd) * w; m.y = m.by + Math.cos(m.hd) * w;
  if (m.side === 'e' && msDefend(m)) return;
  if (d > Math.max(10, st)) { if (m.t > 14) { m.done = true; msPuff(m.x, m.y, m.side); } return; }
  m.done = true;
  if (!T) { S.fx.push({ kind: 'flash', x: m.x, y: m.y, r: 12, life: 0, max: .6, side: m.side }); return; }
  S.fx.push({ kind: 'boom', x: m.x, y: m.y, r: 26, life: 0, max: 1.1, side: m.side });
  msStat('ascmHit');
  const k = m.tgt.k;
  if (k === 'ship') { log(`${T.label} 被岸舰导弹击中`, 'bad', null, 0, T); damageShip(T, 7); }
  else if (k === 'dd') { damageDD({ kind: 'coastal', x: m.x0, y: m.y0 }); damageDD({ kind: 'coastal', x: m.x0, y: m.y0 }); }
  else if (k === 'cv' && typeof cvImpact === 'function') cvImpact(T.x, T.y, { men: 0, ship: 6, struct: 0, R: 20 });
}
// 返回 true 表示本步已被拦截
function msDefend(m) {
  const D = msDefShips();
  if (!D.length) return false;
  const T = msTgtObj(m.tgt);
  const cover = s => !T || T === s.o || dist(T.x, T.y, s.x, s.y) < 400;
  // 外层：舰空导弹（每枚来袭导弹只分配一枚拦截弹）
  if (!m.samTry) for (const s of D) {
    const r = s.esc ? 600 : 750, d = dist(m.x, m.y, s.x, s.y);
    if (d > r || d < 140 || !cover(s) || (s.o.samCd || 0) > S.t) continue;
    m.samTry = true; s.o.samCd = S.t + 1.5;
    msLaunch('sam', 'p', s.x, s.y, { x: m.x, y: m.y }, { tgt: { k: 'msl', id: m.id }, src: s.esc ? 'esc' : 'dd', spd: 560, dur: 2.5, pk: s.esc ? .3 : .35 });
    msStat('abm');
    break;
  }
  // 内层：近防炮——来袭导弹进入 300 时打一个 0.4 秒长点射（曳光），结束时判定
  if (m.cw) {
    if (S.t < m.cw.until) { const s = D.find(o => o.id === m.cw.id); if (s) for (let i = 0; i < 2; i++) tracer(s.x, s.y, m.x + gauss() * 5, m.y + gauss() * 5, 'p', true); return false; }
    const ok = m.cw.ok; m.cw = null;
    if (ok) { m.done = m.icp = true; msPuff(m.x, m.y, 'p', true); msStat('ciws'); msIcpt(m, '近防炮'); return true; }
  }
  if (!m.cw) for (const s of D) {
    if ((m.cwN || []).includes(s.id) || dist(m.x, m.y, s.x, s.y) > 300 || !cover(s)) continue;
    const many = S.missiles.filter(o => o.kind === 'asm' && o.side === m.side && !o.done && o.t >= 0 && dist(o.x, o.y, s.x, s.y) < 300).length >= 2;
    const p = (s.esc ? .4 : .55 * (S.dd.hull >= 3 ? 1 : .8)) * (many ? .7 : 1);
    (m.cwN || (m.cwN = [])).push(s.id);
    m.cw = { until: S.t + .4, ok: Math.random() < p, id: s.id };
    break;
  }
  return false;
}

// —— 守方岸舰导弹连：两枚一组齐射，间隔 45 秒，射程 1600；只打海上航行 / 待命的舰船（已抢滩的不打） ——
function msCommandE(dt) {
  if (!S || S.phase !== 'battle') return;
  if ((S.msl.eT = (S.msl.eT ?? 1) - dt) > 0) return;
  S.msl.eT = 1;
  const radar = typeof radarUp === 'function' ? radarUp() : null, seen = (x, y) => typeof shipSeen === 'function' ? shipSeen(x, y, radar) : spotted(x, y);
  for (const e of S.enemies) {
    if (e.kind !== 'ascm' || e.dead || e.moving || !((e.n ?? 4) > 0) || (e.ascT || 0) > S.t || (e.sup || 0) > 60) continue;
    const inb = (tx, ty) => S.missiles.filter(m => m.kind === 'asm' && !m.done && dist(m.tx, m.ty, tx, ty) < 30).length;
    let best = null, bv = 0;
    for (const s of S.ships) {
      if (!alive(s) || s.state === 'beached' || s.state === 'unloading' || isLand(s.x, s.y) || dist(e.x, e.y, s.x, s.y) > 1600 || !seen(s.x, s.y) || inb(s.x, s.y) >= 2) continue;
      const L = s.load || {}, v = (L.veh && L.veh.length) ? 10 : L.teams > 0 ? 8 : s.kind === 'supply' ? 7 : s.kind === 'dd' ? 6 : 3;
      if (v > bv) { bv = v; best = { k: 'ship', id: s.id, x: s.x, y: s.y, nm: s.label }; }
    }
    if (bv < 6) {
      const dd = S.dd;
      if (dd && dd.state !== 'sunk' && isFinite(dd.x) && dist(e.x, e.y, dd.x, dd.y) < 1600 && seen(dd.x, dd.y) && inb(dd.x, dd.y) < 2) { bv = 6; best = { k: 'dd', id: 'DD', x: dd.x, y: dd.y, nm: '驱逐舰' }; }
      else if (!best && typeof cvAll === 'function') cvAll().forEach((c, h) => { if (!best && c.hp > 0 && dist(e.x, e.y, c.x, c.y) < 1600 && seen(c.x, c.y)) { bv = 5; best = { k: 'cv', id: cvHome(c) || h, x: c.x, y: c.y, nm: c.name || '航母' }; } });
    }
    if (!best) continue;
    const n = Math.min(2, e.n ?? 4), d = dist(e.x, e.y, best.x, best.y);
    for (let i = 0; i < n; i++) msLaunch('asm', 'e', e.x + gauss() * 4, e.y + gauss() * 4, { x: best.x, y: best.y }, { tgt: { k: best.k, id: best.id }, delay: i * .7, src: e.id, spd: 260 });
    e.n = (e.n ?? 4) - n; e.ascT = S.t + 45; e.kx = e.x; e.ky = e.y;   // 发射即暴露
    msStat('ascm', n);
    const sec = Math.round(d / 260);
    log(`导弹预警：${n} 枚岸舰导弹来袭，目标${best.nm}，约 ${sec} 秒到达`, 'bad', 'ascmw', 3, { x: best.x, y: best.y });
    if (typeof chatSay === 'function') {
      chatSay('sys', `导弹预警：敌岸舰导弹 ${n} 枚来袭，目标${best.nm}，约 ${sec} 秒后到达；驱逐舰舰空导弹与近防炮拦截。`, { kind: 'intel', at: { x: e.x, y: e.y }, key: 'ascmw', gap: 8 });
      chatSay('e', `命令：岸舰导弹连齐射 ${n} 枚，打击海上${best.nm}。`, { kind: 'order', at: { x: best.x, y: best.y }, key: 'ascmo', gap: 20 });
    }
  }
  msTelE();
}
// —— 守方战术导弹发射车（msCommandE 每秒调用）：发射 7 秒后转移阵地；冷却完毕、有弹、未被压制时，打守方看得见的最高价值目标 ——
//    卸载中的坦克登陆舰 12、卸载中的登陆舰 9 + 载员组数、滩头补给站 8、前沿补给点 5+、45 内集结 10 人以上的步兵 人数·0.7；够 7 分才打
function msTelE() {
  for (const e of S.enemies) {
    if (e.kind !== 'tel' || e.dead) continue;
    if (e.scoot != null && S.t >= e.scoot && !e.moving) { e.scoot = null; msTelMove(e); continue; }
    if (e.moving || e.scoot != null || !((e.n ?? 2) > 0) || (e.telT || 0) > S.t || (e.sup || 0) > 60) continue;
    const T = msTelPick(e);
    if (!T) continue;
    const tx = clamp(T.x + gauss() * 10, 0, W), ty = clamp(T.y + gauss() * 10, 0, H);
    e.th = Math.atan2(ty - e.y, tx - e.x);   // 车头转向目标，起竖 1.5 秒后点火
    const m = msLaunch('tbm', 'e', e.x, e.y, { x: tx, y: ty }, { src: e.id, delay: 1.5 });
    e.n = (e.n ?? 2) - 1; e.telT = S.t + (MS_TEL[S.level] || 60); e.fireT = S.t; e.scoot = S.t + 7; e.kx = e.x; e.ky = e.y;   // 发射即暴露
    msStat('telLaunch');
    const sec = Math.round(m.dur + 1.5), where = typeof cmdWhere === 'function' ? cmdWhere(e.x, e.y) : gridRef(e.x, e.y), dd = msDefShips().some(o => dist(o.x, o.y, tx, ty) < 650);
    const sv = (S.veh || []).some(v => v.side === 'p' && !v.dead && v.type === 'sam_veh' && (v.samN ?? 1) > 0 && dist(v.x, v.y, tx, ty) < 450), icp = [dd && '驱逐舰舰空导弹', sv && '弹炮防空车'].filter(Boolean).join('与');
    log(`导弹预警：敌战术弹道导弹来袭，目标${T.nm}，约 ${sec} 秒后落地；发射车位置已标定`, 'bad', 'telw', 3, { x: tx, y: ty });
    if (typeof chatSay === 'function') {
      chatSay('sys', `导弹预警：敌战术弹道导弹 1 枚自${where}发射，目标${T.nm}，约 ${sec} 秒后落地${icp ? `；${icp}准备拦截` : ''}。`, { kind: 'intel', at: { x: tx, y: ty }, key: 'telw', gap: 6 });
      chatSay('e', `命令：战术导弹发射车对${T.nm}实施导弹突击，发射后立即转移阵地（余弹 ${e.n} 枚）。`, { kind: 'order', at: { x: tx, y: ty }, key: 'telo' + e.id, gap: 20, lv: 1 });
    }
  }
}
function msTelPick(e) {
  let best = null, bv = 7;
  const add = (x, y, v, nm) => {
    if (v <= bv) return;
    const d = dist(e.x, e.y, x, y);
    if (d < 300 || d > 1800 || ownNear('e', x, y, 75) || S.missiles.some(m => m.side === 'e' && m.kind === 'tbm' && !m.done && dist(m.tx, m.ty, x, y) < 60)) return;
    bv = v; best = { x, y, nm };
  };
  for (const s of S.ships) if (alive(s) && s.state === 'unloading' && spotted(s.x, s.y)) add(s.x, s.y, s.kind === 'lst' ? 12 : 9 + ((s.load && s.load.teams) || 0), `正在卸载的 ${s.label}`);
  for (const L of S.supply) if (L.connected && spotted(L.x, L.y)) add(L.x, L.y, 8, '滩头补给站');
  if (typeof supplyTargets === 'function') for (const t of supplyTargets() || []) if (t && t.kind === 'node' && spotted(t.x, t.y)) add(t.x, t.y, 5 + (t.value || 1), '前沿补给点');
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length && !q.ride && spotted(q.x, q.y));
  for (const q of pT) { let m = 0; for (const o of pT) if (dist(o.x, o.y, q.x, q.y) < 45) m += o.men.length; if (m >= 10) add(q.x, q.y, m * .7, `约 ${m} 人的集结部队`); }
  return best;
}
// 转移阵地：150–280 外的新位置（离海岸 450 以外、可通行；道路 / 平地开得快，掩护好的更好），车速 16
function msTelMove(e) {
  let best = null, bs = -Infinity;
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * 6.283, r = 150 + Math.random() * 130, x = clamp(e.x + Math.cos(a) * r, 40, W - 40), y = clamp(e.y + Math.sin(a) * r, 30, H - 30);
    if (!passInf(x, y) || coastAt(x) - y < 450) continue;
    const t = typeAt(x, y), sc = (t === T.ROAD ? 1 : t === T.FIELD ? .6 : 0) + (1 - coverAt(x, y)) * 1.5 + Math.random() * .3;
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  if (!best) return;
  Object.assign(e, { moving: true, mx: best.x, my: best.y, mspd: 16, th: Math.atan2(best.y - e.y, best.x - e.x) });
  msStat('telMove');
}
// 战役（地狱）：指挥所以北纵深（离海岸 520 以外）一辆发射车，载弹 2 枚
function msPlaceTel() {
  for (let k = 0; k < 300; k++) {
    const x = 120 + Math.random() * (W - 240), y = 40 + Math.random() * 640;
    if (!passInf(x, y) || coastAt(x) - y < 520 || S.points.some(p => dist(p.x, p.y, x, y) < 100) || S.enemies.some(o => dist(o.x, o.y, x, y) < 60)) continue;
    const e = addEnemy('tel', x, y);
    e.n = 2; e.th = Math.PI / 2;
    return e;
  }
  return null;
}
// 战役（困难 / 地狱）：在侧翼岬角布置一个岸舰导弹连（困难 2 枚，地狱 4 枚）
function msPlaceAscm(n) {
  const B = TER.beaches || [];
  let best = null, bs = -1e9;
  for (let x = 140; x < W - 140; x += 40) for (const dy of [120, 170, 220]) {
    const y = coastAt(x) - dy;
    if (y < 60 || !passInf(x, y) || !isLand(x, y)) continue;
    const bd = B.length ? Math.min(...B.map(b => Math.abs(b.cx - x))) : 300, pd = Math.min(...S.points.map(p => dist(p.x, p.y, x, y)));
    if (pd < 90) continue;
    const sc = Math.min(bd, 500) / 100 + (1 - coverAt(x, y)) * 2 + Math.random() * 1.5;
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  if (!best) return null;
  const e = addEnemy('ascm', best.x, best.y);
  e.n = n;
  return e;
}

HOOK.step.push(function msStepHook(dt) { if (msOn() || (typeof eaOn === 'function' && eaOn())) msStep(dt); if (msOn()) { msEnsure(); msCommandP(dt); msCommandE(dt); } });

// —— 进攻方 AI 用弹：观战，或驱逐舰交给指挥官时；手动指挥驱逐舰时只提建议 ——
function msCommandP(dt) {
  if (!S || S.phase !== 'battle' || !(S.assets.msl > 0)) return;
  if ((S.msl.aiT = (S.msl.aiT ?? 3) - dt) > 0) return;
  S.msl.aiT = 3;
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length), atSea = S.ships.some(s => s.state !== 'sunk' && s.state !== 'beached' && s.load && s.load.teams > 0);
  const VAL = { coastal: atSea ? 10 : 5, tel: 9, ascm: atSea ? 10 : 6, airfield: 8, arty: 4, aa: 3, mortar: 2.5, bunker: 2 };
  let best = null, bv = 0;
  const JP = typeof cmdJointPts === 'function' ? cmdJointPts() : [];   // 联合火力：正在攻击的目标据点附近的火力点优先
  for (const e of S.enemies) {
    if (e.dead || e.kx == null || !VAL[e.kind]) continue;
    if (pT.some(q => dist(q.x, q.y, e.kx, e.ky) < 60) || S.missiles.some(m => m.side === 'p' && dist(m.tx, m.ty, e.kx, e.ky) < 50)) continue;
    const v = VAL[e.kind] * (e.kind === 'bunker' && pT.some(q => dist(q.x, q.y, e.kx, e.ky) < 260) ? 2.5 : 1) * (JP.some(p => dist(p.x, p.y, e.kx, e.ky) < 220) ? 1.6 : 1);
    if (v > bv) { bv = v; best = e; }
  }
  if (!best || bv < 5) return;
  const ctl = S.role === 'spectate' || (typeof cmdCtl === 'function' && cmdCtl(S.dd));
  const say = (t, k) => { if (typeof chatSay === 'function') chatSay('p', t, { kind: k, at: { x: best.kx, y: best.ky }, key: 'msl' + best.id, gap: 60 }); };
  if (ctl) { if (msFireP(best.kx, best.ky, true)) say(`命令：战术导弹打击 ${gridRef(best.kx, best.ky)} ${msName(best)}（存量 ${S.assets.msl}）。`, 'order'); }
  else if (S.t - (S.msl.sugT ?? -99) > 150) { S.msl.sugT = S.t; say(`建议：以战术导弹打击 ${gridRef(best.kx, best.ky)} ${msName(best)}（按 I 键，再点目标）。`, 'plan'); }
}

// —— HUD：支援栏注入导弹按钮（I 键）；工具状态下左键点地面发射 ——
const MS_ICON = typeof WI === 'object' ? WI.df15b : '<path d="M12 2.5l2 4v10l-2 2-2-2v-10z"/>';   // 东风-15B
function msHud() {
  if (typeof document === 'undefined' || typeof $ !== 'function' || !$('support') || !S) return;
  let b = $('b-msl');
  if (!b) {
    if (typeof ICON === 'object' && !ICON.msl) ICON.msl = MS_ICON;
    b = document.createElement('button');
    b.className = 'ib'; b.id = 'b-msl'; b.type = 'button'; b.title = '战术导弹：舰载垂直发射，约 6–8 秒命中（I）'; b.setAttribute('aria-label', '战术导弹');
    b.innerHTML = `<svg viewBox="0 0 24 24" class="ic" aria-hidden="true">${MS_ICON}</svg><kbd>I</kbd><em id="n-msl"></em>`;
    b.addEventListener('click', msTool);
    const ref = $('b-bomber') || $('b-strike');
    ref ? ref.after(b) : $('support').appendChild(b);
  }
  const n = S.assets && S.assets.msl > 0 ? S.assets.msl : 0, dis = !msOn() || S.phase !== 'battle' || !n;
  if (b.disabled !== dis) b.disabled = dis;
  b.hidden = !msOn() || (S.mode === 'sandbox' && !n && !(S.msl && S.msl.p.used));
  b.classList.toggle('on', typeof U === 'object' && U.tool === 'msl');
  const em = $('n-msl'), t = String(n);
  if (em && em.textContent !== t) em.textContent = t;
}
function msTool() {
  if (typeof U !== 'object') return;
  U.tool = U.tool === 'msl' ? null : 'msl';
  if (typeof updateHud === 'function') updateHud();
}
HOOK.frame.push(function msHudHook() { msHud(); });
HOOK.key.push(function msKey(e) {
  if (!S || e.ctrlKey || e.metaKey || e.altKey || e.key.toUpperCase() !== 'I' || S.phase === 'sandbox' || !msOn()) return false;
  msTool(); return true;
});
HOOK.pointer.push(function msPointer(e, kind, p) {
  if (typeof U !== 'object' || U.tool !== 'msl' || kind !== 'down' || !p) return false;
  if (e.button === 2) { U.tool = null; return true; }
  if (e.button !== 0) return false;
  if (msFireP(p.x, p.y)) U.tool = null;
  if (typeof updateHud === 'function') updateHud();
  return true;
});

// —— 绘制：弹体（细长三角、白色弹头）、地面投影、尾迹、助推火焰、命中扩散环、瞄准十字 ——
function msDraw(time) {
  if (!S || typeof R !== 'object' || !R.ctx) return;
  if (MSV.S !== S) { MSV.S = S; MSV.trail.clear(); MSV.rings = []; }
  const ctx = R.ctx, live = new Set();
  for (const m of S.missiles || []) {
    if (m.t < 0 || m.done) continue;
    live.add(m.id);
    if (m.kind !== 'tbm') { msDrawSmall(ctx, m); continue; }
    const u = clamp(m.t / m.dur, 0, 1), lift = m.z * 90, x = m.x, y = m.y - lift;
    const ux = lerp(m.x0, m.tx, Math.min(1, u + .02)), uy = lerp(m.y0, m.ty, Math.min(1, u + .02)) - Math.sin(Math.PI * Math.min(1, u + .02)) * 90 * (m.kind === 'tbm' ? 1 : .15);
    const a = Math.atan2(uy - y, ux - x), col = m.side === 'p' ? COL.g : COL.enemy;
    let tr = MSV.trail.get(m.id);
    if (!tr) MSV.trail.set(m.id, tr = []);
    tr.push([x, y, S.t]);
    while (tr.length && S.t - tr[0][2] > 1.4) tr.shift();
    ctx.lineWidth = px(2.2);
    for (let i = 1; i < tr.length; i++) { ctx.strokeStyle = rgba(i > tr.length - 4 ? '#ffffff' : col, .75 * i / tr.length); ctx.beginPath(); ctx.moveTo(tr[i - 1][0], tr[i - 1][1]); ctx.lineTo(tr[i][0], tr[i][1]); ctx.stroke(); }
    // 地面投影与系线
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(m.x, m.y, Math.max(2, px(2.5)), 0, 7); ctx.fill();
    ctx.strokeStyle = rgba(col, .18); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(4)]); ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    // 弹体：7 × 2，白色弹头
    const k = Math.max(1, px(12) / 7);   // 屏幕上至少约 12 像素长
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(k, k);
    ctx.fillStyle = rgba(col, .95); ctx.beginPath(); ctx.moveTo(3.5, 0); ctx.lineTo(-3.5, -1); ctx.lineTo(-3.5, 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(3.5, 0); ctx.lineTo(2, -.55); ctx.lineTo(2, .55); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba('#fff3d6', .9); ctx.beginPath(); ctx.arc(-3.8, 0, .9, 0, 7); ctx.fill();   // 尾焰亮点
    if (m.t < 1.2) { ctx.fillStyle = rgba(COL.amber, .8 - m.t * .5); ctx.beginPath(); ctx.moveTo(-3.5, -.8); ctx.lineTo(-8 - Math.random() * 3, 0); ctx.lineTo(-3.5, .8); ctx.closePath(); ctx.fill(); }   // 助推火焰
    ctx.restore();
    // 落点：随飞行收紧的目标圈
    ctx.strokeStyle = rgba(col, .35 + .3 * u); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(4)]);
    ctx.beginPath(); ctx.arc(m.tx, m.ty, POWER.tbm.R * (1.6 - u * .6), 0, 7); ctx.stroke(); ctx.setLineDash([]);
    if (u > .97 && !MSV.rings.some(r => r.id === m.id)) MSV.rings.push({ id: m.id, x: m.tx, y: m.ty, t: time, col });
  }
  for (const id of [...MSV.trail.keys()]) if (!live.has(id)) MSV.trail.delete(id);
  // 干扰弹：三颗琥珀亮点向下散落 1.2 秒
  MSV.fl = MSV.fl.filter(f => S.t - f.t < 1.2 && S.t >= f.t);
  for (const f of MSV.fl) {
    const a = S.t - f.t;
    ctx.fillStyle = rgba(COL.amber, .9 * (1 - a / 1.2));
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(f.x + i * (4 + a * 14), f.y + a * 26 + Math.abs(i) * a * 6, Math.max(1, px(2.2)), 0, 7); ctx.fill(); }
  }
  MSV.rings = MSV.rings.filter(r => time - r.t < .6);
  for (const r of MSV.rings) {
    const v = (time - r.t) / .6;
    ctx.strokeStyle = rgba(r.col, 1 - v); ctx.lineWidth = px(2);
    ctx.beginPath(); ctx.arc(r.x, r.y, POWER.tbm.R * 2 * v, 0, 7); ctx.stroke();
  }
}
// 防空导弹：白亮点 + 短尾迹；岸舰导弹：小弹体贴海飞行 + 海面投影，目标舰周围红色虚线警示圈
function msDrawSmall(ctx, m) {
  const col = m.side === 'p' ? COL.g : COL.enemy, sam = m.kind === 'sam', x = m.x, y = m.y - m.z * 30;
  let tr = MSV.trail.get(m.id);
  if (!tr) MSV.trail.set(m.id, tr = []);
  tr.push([x, y, S.t]);
  while (tr.length && S.t - tr[0][2] > (sam ? .5 : .9)) tr.shift();
  ctx.lineWidth = px(sam ? 1.3 : 1.7);
  for (let i = 1; i < tr.length; i++) { ctx.strokeStyle = rgba(sam ? '#e8fff0' : col, .65 * i / tr.length); ctx.beginPath(); ctx.moveTo(tr[i - 1][0], tr[i - 1][1]); ctx.lineTo(tr[i][0], tr[i][1]); ctx.stroke(); }
  if (sam) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, Math.max(1.4, px(2.2)), 0, 7); ctx.fill(); return; }
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(m.x, m.y + 2, Math.max(1.5, px(2)), 0, 7); ctx.fill();
  const k = Math.max(.8, px(10) / 7);
  ctx.save(); ctx.translate(x, y); ctx.rotate(m.hd || 0); ctx.scale(k, k);
  ctx.fillStyle = rgba(col, .95); ctx.beginPath(); ctx.moveTo(3.5, 0); ctx.lineTo(-3.5, -1); ctx.lineTo(-3.5, 1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(3.5, 0); ctx.lineTo(2, -.55); ctx.lineTo(2, .55); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba('#fff3d6', .9); ctx.beginPath(); ctx.arc(-3.8, 0, .8, 0, 7); ctx.fill();
  ctx.restore();
  const T = msTgtObj(m.tgt);
  if (T && m.side === 'e') { ctx.strokeStyle = rgba(COL.enemy, .55); ctx.lineWidth = px(1.3); ctx.setLineDash([px(3), px(3)]); ctx.beginPath(); ctx.arc(T.x, T.y, 32, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
}
function msDrawTop() {
  if (typeof U !== 'object' || U.tool !== 'msl' || !U.mouse || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, m = U.mouse, ok = S.assets.msl > 0 && isLand(m.x, m.y), col = ok ? COL.g : COL.enemy, d = Math.max(10, px(12));
  ctx.strokeStyle = rgba(col, .9); ctx.lineWidth = px(1.5);
  ctx.beginPath(); ctx.moveTo(m.x - d, m.y); ctx.lineTo(m.x - d * .35, m.y); ctx.moveTo(m.x + d * .35, m.y); ctx.lineTo(m.x + d, m.y);
  ctx.moveTo(m.x, m.y - d); ctx.lineTo(m.x, m.y - d * .35); ctx.moveTo(m.x, m.y + d * .35); ctx.lineTo(m.x, m.y + d); ctx.stroke();
  ctx.setLineDash([px(4), px(4)]); ctx.beginPath(); ctx.arc(m.x, m.y, POWER.tbm.R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
}
HOOK.drawOver.push(function msDrawHook(time) { if (msOn() || (typeof eaOn === 'function' && eaOn())) msDraw(time); });
HOOK.drawTop.push(function msDrawTopHook() { if (msOn()) msDrawTop(); });
