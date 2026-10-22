'use strict';
// 战术导弹（v7）：进攻方战术弹道导弹——驱逐舰垂直发射，驱逐舰沉没时由战区导弹部队发射；
// 弹道飞行、末段可被雷达高炮拦截、命中按 POWER.tbm 结算；HUD 按钮（I 键）、AI 用弹、绘制（只用形状）。
// 接口按 SPEC-v7：msOn / msLaunch / msFireP / msCommandP；守方发射车、岸舰导弹、单兵防空导弹在此基础上扩展。
POWER.tbm = { men: .9, ship: 6, struct: 24, seg: true, R: 40 };
const msOn = () => !!S && !(S.v7off && S.v7off.msl);
const MS_STOCK = { normal: 3, hard: 2, hell: 2 };
const MSV = { S: null, trail: new Map(), rings: [] };   // 渲染缓存（不进 S）：尾迹点、命中扩散环
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
});

// 发射一枚：tgt = {x, y}；opts.delay 秒后才真正升空，opts.src 记发射平台
function msLaunch(kind, side, x0, y0, tgt, opts = {}) {
  msEnsure();
  const d = dist(x0, y0, tgt.x, tgt.y), dur = opts.dur || (kind === 'tbm' ? 5 + d / 600 : 2.2);
  const m = { id: S.nid++, kind, side, x0, y0, x: x0, y: y0, z: 0, tx: tgt.x, ty: tgt.y, t: -(opts.delay || 0), dur, tgt: opts.tgt || null, ph: opts.delay ? 'wait' : 'boost', icp: false, src: opts.src || null };
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
function msStep(dt) {
  if (!S || !Array.isArray(S.missiles) || !S.missiles.length) return;
  for (const m of S.missiles) {
    if (m.done) continue;
    if ((m.t += dt) < 0) continue;
    if (m.ph === 'wait') m.ph = 'boost';
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
    if (u >= 1) {
      m.done = true;
      impact(m.tx, m.ty, POWER.tbm, m.side);
      S.fx.push({ kind: 'boom', x: m.tx, y: m.ty, r: 52, life: 0, max: 1.5, side: m.side });
      if (m.side === 'p') {
        S.msl.p.hit++;
        const hit = S.enemies.filter(e => e.dead && dist(e.x, e.y, m.tx, m.ty) < 50);
        log(hit.length ? `战术导弹命中，摧毁${msName(hit[0])}` : '战术导弹命中目标区', 'good', null, 0, { x: m.tx, y: m.ty });
      }
    }
  }
  S.missiles = S.missiles.filter(m => !m.done);
}
HOOK.step.push(function msStepHook(dt) { if (msOn()) { msStep(dt); msCommandP(dt); } });

// —— 进攻方 AI 用弹：观战，或驱逐舰交给指挥官时；手动指挥驱逐舰时只提建议 ——
function msCommandP(dt) {
  if (!S || S.phase !== 'battle' || !(S.assets.msl > 0)) return;
  if ((S.msl.aiT = (S.msl.aiT ?? 3) - dt) > 0) return;
  S.msl.aiT = 3;
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length), atSea = S.ships.some(s => s.state !== 'sunk' && s.state !== 'beached' && s.load && s.load.teams > 0);
  const VAL = { coastal: atSea ? 10 : 5, tel: 9, ascm: atSea ? 10 : 6, airfield: 8, arty: 4, aa: 3, mortar: 2.5, bunker: 2 };
  let best = null, bv = 0;
  for (const e of S.enemies) {
    if (e.dead || e.kx == null || !VAL[e.kind]) continue;
    if (pT.some(q => dist(q.x, q.y, e.kx, e.ky) < 60) || S.missiles.some(m => m.side === 'p' && dist(m.tx, m.ty, e.kx, e.ky) < 50)) continue;
    const v = VAL[e.kind] * (e.kind === 'bunker' && pT.some(q => dist(q.x, q.y, e.kx, e.ky) < 260) ? 2.5 : 1);
    if (v > bv) { bv = v; best = e; }
  }
  if (!best || bv < 5) return;
  const ctl = S.role === 'spectate' || (typeof cmdCtl === 'function' && cmdCtl(S.dd));
  const say = (t, k) => { if (typeof chatSay === 'function') chatSay('p', t, { kind: k, at: { x: best.kx, y: best.ky }, key: 'msl' + best.id, gap: 60 }); };
  if (ctl) { if (msFireP(best.kx, best.ky, true)) say(`命令：战术导弹打击 ${gridRef(best.kx, best.ky)} ${msName(best)}（存量 ${S.assets.msl}）。`, 'order'); }
  else if (S.t - (S.msl.sugT ?? -99) > 60) { S.msl.sugT = S.t; say(`建议：以战术导弹打击 ${gridRef(best.kx, best.ky)} ${msName(best)}（按 I 键，再点目标）。`, 'plan'); }
}

// —— HUD：支援栏注入导弹按钮（I 键）；工具状态下左键点地面发射 ——
const MS_ICON = '<path d="M12 2.5l2 4v10l-2 2-2-2v-10z"/><path d="M10 13.5l-3 3v2l3-1.5M14 13.5l3 3v2l-3-1.5"/><path d="M11 20.5l1 1.5 1-1.5"/>';
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
  MSV.rings = MSV.rings.filter(r => time - r.t < .6);
  for (const r of MSV.rings) {
    const v = (time - r.t) / .6;
    ctx.strokeStyle = rgba(r.col, 1 - v); ctx.lineWidth = px(2);
    ctx.beginPath(); ctx.arc(r.x, r.y, POWER.tbm.R * 2 * v, 0, 7); ctx.stroke();
  }
}
function msDrawTop() {
  if (typeof U !== 'object' || U.tool !== 'msl' || !U.mouse || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, m = U.mouse, ok = S.assets.msl > 0 && isLand(m.x, m.y), col = ok ? COL.g : COL.enemy, d = Math.max(10, px(12));
  ctx.strokeStyle = rgba(col, .9); ctx.lineWidth = px(1.5);
  ctx.beginPath(); ctx.moveTo(m.x - d, m.y); ctx.lineTo(m.x - d * .35, m.y); ctx.moveTo(m.x + d * .35, m.y); ctx.lineTo(m.x + d, m.y);
  ctx.moveTo(m.x, m.y - d); ctx.lineTo(m.x, m.y - d * .35); ctx.moveTo(m.x, m.y + d * .35); ctx.lineTo(m.x, m.y + d); ctx.stroke();
  ctx.setLineDash([px(4), px(4)]); ctx.beginPath(); ctx.arc(m.x, m.y, POWER.tbm.R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
}
HOOK.drawOver.push(function msDrawHook(time) { if (msOn()) msDraw(time); });
HOOK.drawTop.push(function msDrawTopHook() { if (msOn()) msDrawTop(); });
