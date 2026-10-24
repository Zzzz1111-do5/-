'use strict';
// 战术核弹（沙盒目录单独购买，S.assets.nuke）：战区火箭军发射的低当量战术核武器（游戏化的抽象效果）——
//   发射：支援栏「核」按钮点目标；落点 280 内有我军时先警告，再点一次（6 秒内、同一处）才发射 → 全战场核打击预警 → 约 15 秒后落地；
//     飞行与末段拦截按弹道导弹（missile.js，m.nuke），拦截率较低。观战时 AI 只打守军最密集、且 320 内没有我军的地方。
//   毁伤（不分敌我）：爆心 60 内一切毁灭（人员、车辆、工事、装甲车、舰船、飞机）；140 内重创；280 内压制、士气崩溃；140 内铁丝网、雷区、障碍全清。
//   辐射区：半径 170、持续 150 秒（逐渐缩小到一半），区内人员每 2 秒按剂量伤亡、持续压制；车辆有三防，只受压制。
//   画面：白闪、冲击波环、蘑菇云（约 25 秒），之后黄黑虚线辐射圈。状态 S.nuke = { fx: [{x, y, t}], rad: [{x, y, t}], cf 待确认, aiT, radT }
const NK = { r0: 60, r1: 140, r2: 280, rr: 170, radT: 150, cloud: 25, warn: 280, own: 320 };
const NK_ICON = typeof WI === 'object' && WI.nuke ? WI.nuke : '<circle cx="12" cy="12" r="8"/>';
const nkEnsure = () => S.nuke || (S.nuke = { fx: [], rad: [], cf: null, aiT: 8, radT: 0 });
const nkMen = side => S.teams.reduce((a, q) => a + (q.side === side ? q.men.length : 0), 0);

function nukeFire(x, y, ai) {
  if (!S || S.phase !== 'battle') { if (!ai) log('战术核弹在 H 时之后才能使用', 'warn', 'nk0', 2); return false; }
  if (!(S.assets.nuke > 0)) { if (!ai) log('没有战术核弹', 'warn', 'nk0', 2); return false; }
  if (!isLand(x, y)) { if (!ai) log('战术核弹只能打陆上目标', 'warn', 'nk1', 2); return false; }
  const N = nkEnsure(), own = S.teams.filter(q => q.side === 'p' && q.men.length && dist(q.x, q.y, x, y) < NK.warn);
  if (!ai && own.length && !(N.cf && S.t - N.cf.t < 6 && dist(N.cf.x, N.cf.y, x, y) < 60)) {
    N.cf = { x, y, t: S.t };
    log(`落点 ${NK.warn} 米内有我军 ${own.reduce((a, q) => a + q.men.length, 0)} 人！核爆不分敌我——6 秒内再点同一处确认发射`, 'bad', 'nkcf', 1, { x, y });
    return false;
  }
  N.cf = null;
  const m = msLaunch('tbm', 'p', x, H + 60, { x, y }, { src: 'theatre', delay: 6 });
  m.nuke = true;
  S.assets.nuke--; S.stats.shots++;
  if (typeof v8Stat === 'function') v8Stat('nukeGo');
  const eta = Math.round(m.dur + 6), wh = typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);
  log(`战区火箭军发射战术核弹，约 ${eta} 秒后在${wh}爆炸——所有部队远离落点 ${NK.r2} 米`, 'bad', null, 0, { x, y });
  if (typeof chatSay === 'function') {
    chatSay('p', `命令：对${wh}实施战术核打击，约 ${eta} 秒后爆炸。附近各部立即后撤、就地隐蔽，戴防毒面具。`, { kind: 'order', at: { x, y }, lv: 0 });
    chatSay('e', '报告：侦测到敌弹道导弹发射，疑为核弹头！各部就地隐蔽，防空部队全力拦截。', { kind: 'report', at: { x, y }, delay: 2, lv: 0 });
  }
  return true;
}

// 爆炸：missile.js msStep 在 m.nuke 落地时调用
function nukeBlast(x, y, side) {
  const N = nkEnsure(), p0 = nkMen('p'), e0 = nkMen('e');
  N.fx.push({ x, y, t: S.t }); N.rad.push({ x, y, t: S.t });
  const fall = (d, a, b) => clamp(1 - (d - a) / (b - a), 0, 1);
  for (const q of S.teams) {
    if (!q.men.length) continue;
    const d = dist(x, y, q.x, q.y);
    if (d < NK.r0) { while (q.men.length) killMan(q); continue; }
    if (d < NK.r1) { const p = .75 * (.4 + .6 * fall(d, NK.r0, NK.r1)) * (q.inTrench ? .6 : 1); for (let k = q.men.length; k > 0; k--) if (Math.random() < p) killMan(q); }
    if (d < NK.r2 && q.men.length) { suppress(q, 100 * fall(d, 0, NK.r2) + 30, x, y); const u = unitOf(q); if (u) u.morale = Math.max(0, u.morale - 60 * fall(d, 0, NK.r2)); }
  }
  for (const v of S.veh || []) {
    if (v.dead) continue;
    const d = dist(x, y, v.x, v.y);
    if (d < NK.r0) vehDamage(v, 999, 9, x, y, 'nuke');
    else if (d < NK.r1) vehDamage(v, 70 * (.4 + .6 * fall(d, NK.r0, NK.r1)), 6, x, y, 'nuke');
    if (!v.dead && d < NK.r2) v.sup = 100;
  }
  for (const e of S.enemies) {
    if (e.dead) continue;
    const d = dist(x, y, e.x, e.y);
    if (d < NK.r0) damageEnemy(e, 999);
    else if (d < NK.r1) damageEnemy(e, 45 * (.4 + .6 * fall(d, NK.r0, NK.r1)));
    if (!e.dead && d < NK.r2) e.sup = 100;
  }
  if (typeof damageArmor === 'function') for (const a of S.armor || []) if (!a.dead) { const d = dist(x, y, a.x, a.y); if (d < NK.r1) damageArmor(a, d < NK.r0 ? 999 : 60 * fall(d, NK.r0, NK.r1)); }
  for (const s of S.ships) if (alive(s)) { const d = dist(x, y, s.x, s.y); if (d < NK.r1) damageShip(s, d < NK.r0 ? 999 : 20 * fall(d, NK.r0, NK.r1)); }
  if (S.dd && S.dd.state !== 'sunk' && dist(x, y, S.dd.x, S.dd.y) < NK.r1) { S.dd.hull = 0; S.dd.state = 'sunk'; S.dd.moving = false; log('驱逐舰被核爆摧毁', 'bad'); }
  if (typeof cvAll === 'function' && typeof cvImpact === 'function') for (const c of cvAll()) if (c.hp > 0 && dist(x, y, c.x, c.y) < NK.r1) cvImpact(c.x, c.y, { men: 0, ship: 99, struct: 0, R: 20 });
  for (const p of S.planes || []) if (!p.dead && dist(x, y, p.x, p.y) < NK.r1 && typeof airLost === 'function') airLost(p, `${typeof airName === 'function' ? airName(p.kind, p.v) : '飞机'}被核爆冲击波摧毁`);
  if (S.eair && typeof eaLost === 'function') for (const a of S.eair.fly) if (!a.dead && dist(x, y, a.x, a.y) < NK.r1) eaLost(a, 'nuke');
  for (const w of S.wire) if (!w.cut && segDist(x, y, w.x0, w.y0, w.x1, w.y1) < NK.r1) w.cut = true;
  for (const m of S.mines) if (dist(x, y, m.x, m.y) < NK.r1 + m.r * .5) m.clr = 1;
  for (const o of S.obst) if (!o.dead && dist(x, y, o.x, o.y) < NK.r1) o.dead = true;
  if (typeof supplyImpact === 'function') supplyImpact(x, y, NK.r1, { men: 1, ship: 9, struct: 99, seg: true, R: NK.r1 });
  for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283, r = k ? NK.r0 * .7 : 0; addCrater(x + Math.cos(a) * r, y + Math.sin(a) * r, k ? 14 : 34); }
  rebuildForts();
  S.fx.push({ kind: 'boom', x, y, r: NK.r1, life: 0, max: 2.4, side });
  const kp = p0 - nkMen('p'), ke = e0 - nkMen('e');
  if (typeof v8Stat === 'function') { v8Stat('nukeHit'); v8Stat('nukeKillE', ke); v8Stat('nukeKillP', kp); }
  const wh = typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);
  log(`战术核弹在${wh}爆炸：守军 ${ke} 人、我军 ${kp} 人伤亡；留下辐射区（约 ${Math.round(NK.radT / 60 * 10) / 10} 分钟）`, kp > ke ? 'bad' : 'good', null, 0, { x, y });
  if (typeof chatSay === 'function') {
    chatSay('p', `报告：核爆已发生，${wh}一带守军成建制被歼（约 ${ke} 人）${kp ? `，我军也有 ${kp} 人伤亡` : ''}。命令：各部绕开辐射区，不得进入爆心 ${NK.rr} 米以内。`, { kind: 'report', at: { x, y }, delay: 1, lv: 0 });
    chatSay('e', `报告：${wh}遭核打击，阵地全毁。命令：周边各部向辐射区外疏散，重新组织防御。`, { kind: 'report', at: { x, y }, delay: 3, lv: 0 });
  }
}

// 辐射区：每 2 秒结算一次剂量
function nukeStep(dt) {
  if (!S || !S.nuke || S.phase !== 'battle') return;
  const N = S.nuke;
  N.rad = N.rad.filter(r => S.t - r.t < NK.radT);
  N.fx = N.fx.filter(f => S.t - f.t < NK.cloud + 5);
  if (!N.rad.length || (N.radT -= dt) > 0) return;
  N.radT = 2;
  let n = 0;
  for (const r of N.rad) {
    const R = nkRadR(r);
    for (const q of S.teams) {
      if (!q.men.length || q.ride) continue;
      const d = dist(q.x, q.y, r.x, r.y);
      if (d >= R) continue;
      const p = .06 * (1 - d / R) * (1 - (S.t - r.t) / NK.radT * .5);
      for (let k = q.men.length; k > 0; k--) if (Math.random() < p) { killMan(q); n++; }
      suppress(q, 25, r.x, r.y);
    }
    for (const v of S.veh || []) if (!v.dead && dist(v.x, v.y, r.x, r.y) < R) v.sup = Math.max(v.sup, 40);
  }
  if (n) { if (typeof v8Stat === 'function') v8Stat('nukeRad', n); log(`辐射区内又有 ${n} 人伤亡`, 'warn', 'nkrad', 10); }
}
const nkRadR = r => NK.rr * (1 - (S.t - r.t) / NK.radT * .5);

// 观战 AI：守军最密集（人员 + 工事 + 战车）且 320 内没有我军、200 内没有我方舰船的一处，分值够高才用
function nukeAI(dt) {
  if (!S || S.phase !== 'battle' || S.role !== 'spectate' || !(S.assets.nuke > 0) || S.t < 45) return;   // 先让侦察与火力准备把守军位置摸清
  const N = nkEnsure();
  if ((N.aiT -= dt) > 0) return;
  N.aiT = 5;
  if (S.missiles.some(m => m.nuke && !m.done)) return;
  const cand = S.teams.filter(q => q.side === 'e' && q.men.length && (q.seen != null || inVision(q.x, q.y)));
  let best = null, bs = 0;
  for (const c of cand) {
    if (S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, c.x, c.y) < NK.own) || (S.veh || []).some(v => v.side === 'p' && !v.dead && dist(v.x, v.y, c.x, c.y) < NK.own)
      || S.ships.some(s => alive(s) && dist(s.x, s.y, c.x, c.y) < 200) || !isLand(c.x, c.y)) continue;
    let s = 0;
    for (const q of S.teams) if (q.side === 'e' && q.men.length && dist(q.x, q.y, c.x, c.y) < NK.r1) s += q.men.length;
    for (const e of S.enemies) if (!e.dead && dist(e.x, e.y, c.x, c.y) < NK.r1) s += 3;
    for (const v of S.veh || []) if (v.side === 'e' && !v.dead && dist(v.x, v.y, c.x, c.y) < NK.r1) s += 4;
    if (s > bs) { bs = s; best = c; }
  }
  if (best && bs >= 16) nukeFire(best.x, best.y, true);
}

// —— 画面 ——
function nukeDraw(time) {
  if (!S || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx;
  ctx.save();
  // 来袭：落点的毁伤半径警示圈
  for (const m of S.missiles || []) if (m.nuke && !m.done) {
    const blink = .45 + .35 * Math.sin(time * 8);
    ctx.strokeStyle = rgba(COL.enemy, blink); ctx.lineWidth = px(2); ctx.setLineDash([px(8), px(5)]);
    for (const r of [NK.r0, NK.r1, NK.r2]) { ctx.beginPath(); ctx.arc(m.tx, m.ty, r, 0, 6.283); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  const N = S.nuke;
  if (N) {
    for (const r of N.rad) {   // 辐射区：黄黑相间虚线圈 + 中心三叶标志
      const R0 = nkRadR(r), a = clamp(1 - (S.t - r.t) / NK.radT, .25, 1);
      ctx.fillStyle = rgba('#d8ff3a', .07 * a); ctx.beginPath(); ctx.arc(r.x, r.y, R0, 0, 6.283); ctx.fill();
      ctx.lineWidth = px(2.4); ctx.setLineDash([px(10), px(10)]);
      ctx.strokeStyle = rgba('#ffd400', .75 * a); ctx.beginPath(); ctx.arc(r.x, r.y, R0, 0, 6.283); ctx.stroke();
      ctx.lineDashOffset = px(10); ctx.strokeStyle = rgba('#141414', .75 * a); ctx.beginPath(); ctx.arc(r.x, r.y, R0, 0, 6.283); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      const s = Math.max(10, px(16));
      ctx.fillStyle = rgba('#ffd400', .8 * a);
      for (let k = 0; k < 3; k++) { const a0 = -1.57 + k * 2.094 - .5; ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.arc(r.x, r.y, s, a0, a0 + 1); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = rgba('#141414', .9 * a); ctx.beginPath(); ctx.arc(r.x, r.y, s * .25, 0, 6.283); ctx.fill();
    }
    for (const f of N.fx) {   // 白闪 → 冲击波环 → 蘑菇云
      const t = S.t - f.t;
      if (t < 1.4) { ctx.fillStyle = `rgba(255,255,240,${(1 - t / 1.4) * .85})`; ctx.fillRect(f.x - 4000, f.y - 4000, 8000, 8000); }
      if (t < 2.2) { const u = t / 2.2; ctx.strokeStyle = `rgba(255,236,200,${1 - u})`; ctx.lineWidth = px(4) * (1 - u) + px(1); ctx.beginPath(); ctx.arc(f.x, f.y, NK.r2 * 1.5 * u, 0, 6.283); ctx.stroke(); }
      if (t < NK.cloud) {
        const g = clamp(t / 4, 0, 1), fade = clamp((NK.cloud - t) / 6, 0, 1), h = 40 + 120 * g, cr = 30 + 60 * g;
        const hot = clamp(1 - t / 8, 0, 1), col = (a) => `rgba(${Math.round(150 + 105 * hot)},${Math.round(120 + 60 * hot)},${Math.round(100 + 20 * hot)},${a * fade})`;
        ctx.fillStyle = col(.55); ctx.beginPath(); ctx.ellipse(f.x, f.y - h * .45, 12 + 10 * g, h * .5, 0, 0, 6.283); ctx.fill();   // 烟柱
        ctx.fillStyle = col(.35); ctx.beginPath(); ctx.ellipse(f.x, f.y, cr * 1.3, cr * .45, 0, 0, 6.283); ctx.fill();          // 底部尘环
        for (let k = 0; k < 7; k++) {   // 云冠：一圈翻滚的团块
          const a = k / 7 * 6.283 + t * .3, rx = f.x + Math.cos(a) * cr * .55, ry = f.y - h + Math.sin(a) * cr * .22;
          ctx.fillStyle = col(.6); ctx.beginPath(); ctx.arc(rx, ry, cr * .42, 0, 6.283); ctx.fill();
        }
        ctx.fillStyle = col(.7); ctx.beginPath(); ctx.arc(f.x, f.y - h - cr * .1, cr * .55, 0, 6.283); ctx.fill();
        if (hot > 0) { ctx.fillStyle = `rgba(255,200,90,${.5 * hot * fade})`; ctx.beginPath(); ctx.arc(f.x, f.y - h, cr * .35, 0, 6.283); ctx.fill(); }
      }
    }
  }
  ctx.restore();
}
function nukeDrawTop() {
  if (typeof U !== 'object' || U.tool !== 'nuke' || !U.mouse || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, m = U.mouse, ok = S.assets.nuke > 0 && isLand(m.x, m.y);
  ctx.save();
  ctx.strokeStyle = rgba(ok ? COL.amber : COL.enemy, .9); ctx.lineWidth = px(1.6); ctx.setLineDash([px(6), px(5)]);
  for (const r of [NK.r0, NK.r1, NK.r2]) { ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, 6.283); ctx.stroke(); }
  ctx.setLineDash([]);
  const own = S.teams.filter(q => q.side === 'p' && q.men.length && dist(q.x, q.y, m.x, m.y) < NK.r2);
  ctx.fillStyle = rgba(COL.enemy, .9);
  for (const q of own) { ctx.beginPath(); ctx.arc(q.x, q.y, px(5), 0, 6.283); ctx.fill(); }
  ctx.restore();
}

// —— HUD：支援栏「核」按钮（只在买了核弹时出现） ——
function nukeHud() {
  if (typeof document === 'undefined' || typeof $ !== 'function' || !$('support') || !S) return;
  let b = $('b-nuke');
  const n = S.assets && S.assets.nuke > 0 ? S.assets.nuke : 0, used = S.v7s && S.v7s.nukeGo;
  if (!b) {
    if (!n && !used) return;
    b = document.createElement('button');
    b.className = 'ib'; b.id = 'b-nuke'; b.type = 'button';
    b.title = '战术核弹（低当量）：点目标发射，约 15 秒落地；爆心 60 米内全毁、140 米重创、280 米压制，不分敌我，留下辐射区'; b.setAttribute('aria-label', '战术核弹');
    b.innerHTML = `<svg viewBox="0 0 24 24" class="ic" aria-hidden="true">${NK_ICON}</svg><kbd>核</kbd><em id="n-nuke"></em>`;
    b.addEventListener('click', () => { if (typeof U !== 'object') return; U.tool = U.tool === 'nuke' ? null : 'nuke'; if (typeof updateHud === 'function') updateHud(); });
    const ref = $('b-vls') || $('b-msl');
    ref ? ref.after(b) : $('support').appendChild(b);
  }
  const dis = S.phase !== 'battle' || !n;
  if (b.disabled !== dis) b.disabled = dis;
  b.hidden = !n && !used;
  b.classList.toggle('on', typeof U === 'object' && U.tool === 'nuke');
  const em = $('n-nuke'), t = String(n);
  if (em && em.textContent !== t) em.textContent = t;
}

HOOK.step.push(function nukeStepHook(dt) { nukeStep(dt); nukeAI(dt); });
HOOK.drawOver.push(nukeDraw);
HOOK.drawTop.push(nukeDrawTop);
HOOK.frame.push(function nukeHudHook() { nukeHud(); });
HOOK.pointer.push(function nukePointer(e, kind, p) {
  if (typeof U !== 'object' || U.tool !== 'nuke' || kind !== 'down' || !p) return false;
  if (e.button === 2) { U.tool = null; return true; }
  if (e.button !== 0) return false;
  if (nukeFire(p.x, p.y)) U.tool = null;
  if (typeof updateHud === 'function') updateHud();
  return true;
});
HOOK.newGame.push(() => { if (S) S.nuke = null; });
