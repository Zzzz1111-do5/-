'use strict';
// 守方反航母体系（v15，沙盒守方可买；AI 部署大预算时自动配）：先找到，再盯住，再打——
// ① P-8A「海神」海上巡逻机（e_p8，航空，2 架轮换）：在本方海岸外海上空巡逻，APY-10 雷达搜索 1500 以内的海面，
//    每 8 秒把我方航母、驱逐舰、登陆舰的位置（带 60 左右的误差）报给守方——这就是「海情」（S.asea）。它飞得慢、目标大，
//    我方歼击机与驱逐舰舰空导弹够得着就会打它；被击落后另一架约 4 分钟后接班
// ② 「堤丰」陆基中程导弹排（e_typhon，火炮，纵深 500 以外）：战斧 Block V 海上打击型，亚音速掠海、射程覆盖全图、主动雷达末制导，
//    每次 4 枚齐射，16 枚打完为止；只打海情里的目标（航母优先，其次驱逐舰）——没有巡逻机、岸上又看不见，就找不到航母。
//    航母的红旗-10、近防炮和驱逐舰舰空导弹层层拦截；每枚命中航母扣 9（重型战斗部）
// ③ SSN-774「弗吉尼亚」级攻击核潜艇（e_ssn，海军）：潜航慢速（安静）接近航母编队，被动声呐 1300 内听到航母，
//    进到 460 内发射 Mk 48 重型鱼雷（每次 4 条，共 12 条），打完一次就规避、装填；鱼雷 50 每秒、22 秒耗尽，每条命中扣 9。
//    反潜：我方驱逐舰（旗舰与护航舰）舰壳声呐 380 内每秒约两成概率发现，发现后反潜火箭 / 鱼雷攻击（命中约四成五，两发击沉）；
//    潜艇发射鱼雷后暴露 20 秒，800 内的驱逐舰都能还击。没有驱逐舰护航的航母，潜艇几乎没人管
// 状态（纯 JSON）：S.asea = { t, ships: [{k, id, x, y, nm, v}] } · S.subs = [潜艇] · S.torps = [鱼雷] · S.asP8 = { n 剩余架数, next 下一架起飞时刻 }
const AS = {
  p8: { r: 1500, upd: 8, err: 60, alt: .8, spd: 150, hp: 2, gap: 240, orbit: 260 },
  ty: { salvo: 4, every: .5, gap: 45, n: 16, spd: 230, dmg: 9 },
  ssn: { spd: 7, dash: 13, sonar: 1300, fire: 460, torps: 12, salvo: 4, reload: 80, hp: 2, tspd: 50, tlife: 22, dmg: 9, expose: 20 },
  asw: { r: 380, pd: .2, cd: 12, pk: .45, rx: 800 }
};
const asOn = () => !!S && S.phase === 'battle' && !S.over;

// ———————————————— 海情 ————————————————
// 守方知道的海上目标：巡逻机雷达、潜艇被动声呐（只报航母）、岸上直接看见的
function asPicture() {
  const A = S.asea || (S.asea = { t: -99, ships: [] });
  return S.t - A.t < 20 ? A.ships : [];
}
function asSeaAll() {
  const out = [];
  for (const c of typeof cvAll === 'function' ? cvAll() : []) if (c.hp > 0 && c.x > -999) out.push({ k: 'cv', id: cvHome(c), x: c.x, y: c.y, nm: c.name || '航母', v: 14 });
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && S.dd.x > -999) out.push({ k: 'dd', id: 'DD', x: S.dd.x, y: S.dd.y, nm: S.dd.name || '驱逐舰', v: 9 });
  for (const s of S.ships) if (alive(s) && !isLand(s.x, s.y) && s.state !== 'beached') out.push({ k: 'ship', id: s.id, x: s.x, y: s.y, nm: s.label || '舰船', v: s.kind === 'dd' ? 8 : (s.load && s.load.veh && s.load.veh.length) ? 7 : 5 });
  return out;
}
function asReport(list, src) {
  const A = S.asea || (S.asea = { t: -99, ships: [] });
  const err = AS.p8.err;
  A.t = S.t; A.src = src;
  for (const o of list) {
    const old = A.ships.find(s => s.k === o.k && s.id === o.id);
    const r = { ...o, x: Math.round(o.x + gauss() * err), y: Math.round(o.y + gauss() * err), t: S.t };
    if (old) Object.assign(old, r); else A.ships.push(r);
  }
  A.ships = A.ships.filter(s => S.t - s.t < 40);
}

// ———————————————— ① P-8A ————————————————
function asP8Step() {
  const n = (S.assets && S.assets.ep8) || 0;
  if (!n || typeof eaEnsure !== 'function') return;
  const P = S.asP8 || (S.asP8 = { n: n * 2, next: 20 });
  const E = eaEnsure(), up = E.fly.find(a => a.type === 'p8' && !a.dead);
  if (!up && P.n > 0 && S.t >= P.next) {
    P.n--; P.next = S.t + AS.p8.gap;
    const x = clamp(W / 2 + gauss() * 600, 300, W - 300);
    E.fly.push({ id: S.nid++, type: 'p8', x, y: -80, heading: Math.PI / 2, spd: AS.p8.spd, alt: AS.p8.alt, bank: 0, hp: AS.p8.hp, flares: 2, t: S.t, pv: false, ph: 'in', scanT: 0 });
    if (typeof chatSay === 'function') chatSay('e', '命令：P-8A 海上巡逻机起飞，搜索敌航母编队位置，为「堤丰」导弹排与潜艇指示目标。', { kind: 'order', lv: 1 });
  }
}
// 巡逻：沿海岸外 260 的一条东西向航线来回（离我方驱逐舰远的一段），每 8 秒雷达扫一次
function asP8Fly(a, dt) {
  if (a.ph === 'rtb') a.ph = 'out';
  if (a.ph === 'out') {
    const tx = a.x, ty = -200;
    eaTurnTo(a, tx, ty, dt);
    if (a.y < -150) { a.dead = true; a.gone = true; }
    return;
  }
  const dds = [S.dd, ...S.ships.filter(s => s.kind === 'dd' && alive(s))].filter(o => o && o.state !== 'sunk' && isFinite(o.x) && o.x > -999);
  if (a.wx == null || dist(a.x, a.y, a.wx, a.wy) < 60) {
    let best = null, bs = -1e9;
    for (let k = 0; k < 16; k++) {
      const x = clamp(300 + k / 15 * (W - 600) + gauss() * 40, 200, W - 200), y = coastAt(x) + AS.p8.orbit;
      const md = dds.reduce((m, o) => Math.min(m, dist(o.x, o.y, x, y)), 1e9);
      const sc = Math.min(md, 900) / 100 - dist(a.x, a.y, x, y) / 900 + Math.random();
      if (sc > bs) { bs = sc; best = { x, y }; }
    }
    a.wx = best.x; a.wy = best.y; a.ph = 'patrol';
  }
  eaTurnTo(a, a.wx, a.wy, dt);
  if ((a.scanT -= dt) <= 0 && a.ph === 'patrol') {
    a.scanT = AS.p8.upd;
    const seen = asSeaAll().filter(o => dist(o.x, o.y, a.x, a.y) < AS.p8.r);
    if (seen.length) asReport(seen, 'p8');
    if (seen.some(o => o.k === 'cv') && S.t - (S.asCvT ?? -99) > 90) { S.asCvT = S.t; log('敌巡逻机雷达照射：航母编队位置可能已暴露', 'warn', 'p8cv', 60, a); }
  }
}
// 通用转向（eair 的飞机都用这个手感）
function eaTurnTo(a, tx, ty, dt) {
  const want = Math.atan2(ty - a.y, tx - a.x), da = Math.atan2(Math.sin(want - a.heading), Math.cos(want - a.heading)), k = airK(a);
  a.heading += airYaw(a, da, .6, dt); a.bank = clamp(a.hr / .6, -.5, .5);   // 平滑转向、地速减半（carrier.js）
  a.x += Math.cos(a.heading) * a.spd * k * dt; a.y += Math.sin(a.heading) * a.spd * k * dt;
}

// ———————————————— ② 堤丰导弹排 ————————————————
// 车阵（二维 / 三维建模与导弹出口共用；局部坐标 x 向车头、y 向右，单位为世界长度）：4 套发射单元并排（间隔 9）——
//   HEMTT M983A4 牵引车 + M870 拖车，拖车上卧着 Mk 41 四联装发射箱；发射前箱子绕拖车尾部的铰点起竖到垂直（up 秒），
//   箱顶 2×2 四个发射单元格逐个开盖点火，打完再竖 hold 秒、down 秒放平。一次齐射 4 枚 = 一套发射单元打空（16 枚 = 4 套）；
//   排部（连指挥车 BOC）与发电车在车阵后方
const TY_RIG = { n: 4, gap: 9, piv: -12.6, L: 13, T: 4.4, up: 3, hold: 5, down: 3 };
const tyA = e => e.th ?? Math.PI / 2;
const tySm = v => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
// 第 k 套发射单元第 i 个单元格（箱子竖直时箱顶）的世界坐标
function tyCell(e, k, i) {
  const a = tyA(e), u = TY_RIG.piv - TY_RIG.T * (i < 2 ? .25 : .75), v = (k - (TY_RIG.n - 1) / 2) * TY_RIG.gap + (i % 2 ? .25 : -.25) * TY_RIG.T;
  return { x: e.x + u * Math.cos(a) - v * Math.sin(a), y: e.y + u * Math.sin(a) + v * Math.cos(a) };
}
// 第 k 套发射单元的起竖角：0 卧倒 … π/2 竖直
function tyErect(e, k) {
  if (e.tyL !== k || e.fireT == null) return 0;
  const R0 = TY_RIG, ft = S.t - e.fireT;
  return Math.PI / 2 * (ft < 0 ? 0 : ft < R0.up ? tySm(ft / R0.up) : ft < R0.up + R0.hold ? 1 : tySm(1 - (ft - R0.up - R0.hold) / R0.down));
}
function asTyphon() {
  const P = asPicture(), seenNow = asSeaAll().filter(o => spotted(o.x, o.y));
  const known = [...P, ...seenNow.filter(o => !P.some(p => p.k === o.k && p.id === o.id))];
  for (const e of S.enemies) {
    if (e.kind !== 'typhon' || e.dead || e.moving || !((e.n ?? AS.ty.n) > 0) || (e.tyT || 0) > S.t || (e.sup || 0) > 60) continue;
    const inb = o => S.missiles.filter(m => m.kind === 'asm' && !m.done && m.tgt && m.tgt.k === o.k && m.tgt.id === o.id).length;
    const T = known.filter(o => o.k === 'cv' || o.k === 'dd' || (o.k === 'ship' && o.v >= 7)).sort((a, b) => b.v - a.v).find(o => inb(o) < 4);
    if (!T) continue;
    const n = Math.min(AS.ty.salvo, e.n ?? AS.ty.n), k = Math.floor((AS.ty.n - (e.n ?? AS.ty.n)) / AS.ty.salvo) % TY_RIG.n;   // 轮到第 k 套发射单元
    for (let i = 0; i < n; i++) {
      const c = tyCell(e, k, i);   // 从竖起的发射箱顶上的单元格垂直射出
      const m = msLaunch('asm', 'e', c.x, c.y, { x: T.x, y: T.y }, { tgt: { k: T.k, id: T.id }, delay: TY_RIG.up + i * AS.ty.every, src: e.id, spd: AS.ty.spd });
      Object.assign(m, { nm: '战斧 Block V 海上打击型', life: 60, dmg: AS.ty.dmg });
    }
    e.n = (e.n ?? AS.ty.n) - n; e.tyT = S.t + AS.ty.gap; e.fireT = S.t; e.tyL = k; e.kx = e.x; e.ky = e.y;   // 发射即暴露
    if (typeof msStat === 'function') msStat('typhon', n);
    log(`导弹预警：${n} 枚战斧海上打击型巡航导弹来袭，目标${T.nm}`, 'bad', 'tyw', 8, { x: T.x, y: T.y });
    if (typeof chatSay === 'function') chatSay('e', `命令：「堤丰」导弹排齐射 ${n} 枚战斧 Block V，打击${T.nm}。`, { kind: 'order', at: { x: T.x, y: T.y }, lv: 1 });
  }
}

// ———————————————— ③ 攻击核潜艇与反潜 ————————————————
function asSubAdd(x, y, nm) {
  const s = { id: S.nid++, x, y, heading: Math.PI / 2, hp: AS.ssn.hp, torps: AS.ssn.torps, st: 'hunt', det: -99, fireT: -99, nm: nm || 'SSN-774 弗吉尼亚级攻击核潜艇', dead: false, hx: x, hy: y };
  (S.subs || (S.subs = [])).push(s);
  return s;
}
const asSubSeen = s => S.t - (s.det ?? -99) < 6;
function asSubStep(dt) {
  if (!S.subs || !S.subs.length) return;
  const C = AS.ssn, sea = asSeaAll();
  for (const s of S.subs) {
    if (s.dead) continue;
    // 目标：被动声呐听到的航母（1300 内），否则海情里的航母 / 驱逐舰
    const heard = sea.filter(o => o.k === 'cv' && dist(o.x, o.y, s.x, s.y) < C.sonar)[0];
    if (heard && S.t - (s.repT ?? -99) > 15) { s.repT = S.t; asReport([heard], 'ssn'); }
    const P = asPicture(), T = heard || P.filter(o => o.k === 'cv')[0] || P.filter(o => o.k === 'dd')[0] || null;
    let tx = s.hx, ty = s.hy, sp = C.spd;
    if (s.st === 'evade') {   // 规避：背离驱逐舰方向潜航，装填好再回来
      tx = s.ex; ty = s.ey; sp = C.dash;
      if (S.t - s.fireT > C.reload && s.torps > 0) s.st = 'hunt';
    } else if (T) {
      const real = sea.find(o => o.k === T.k && o.id === T.id) || T, d = dist(s.x, s.y, real.x, real.y);
      tx = real.x; ty = real.y;
      if (d < C.fire && s.torps > 0 && S.t - s.fireT > C.reload) {
        const n = Math.min(C.salvo, s.torps);
        for (let i = 0; i < n; i++) (S.torps || (S.torps = [])).push({ id: S.nid++, x: s.x, y: s.y, hd: Math.atan2(real.y - s.y, real.x - s.x) + (i - (n - 1) / 2) * .08, t: -i * .8, tgt: { k: real.k, id: real.id }, side: 'e' });
        s.torps -= n; s.fireT = S.t; s.det = S.t + C.expose - 6;   // 发射鱼雷：暴露 20 秒
        const a = Math.atan2(s.y - real.y, s.x - real.x); s.ex = clamp(s.x + Math.cos(a) * 600, 60, W - 60); s.ey = clamp(s.y + Math.sin(a) * 600, coastAt(s.x) + 120, H - 40); s.st = 'evade';
        log(`声呐告警：鱼雷入水！${n} 条重型鱼雷射向${real.nm}`, 'bad', 'trpw', 6, real);
        if (typeof chatSay === 'function') chatSay('e', `命令：攻击核潜艇对${real.nm}发射 ${n} 条 Mk 48 重型鱼雷，随即规避。`, { kind: 'order', at: real, lv: 1 });
        continue;
      }
      if (d < C.fire * .8) sp = 0;   // 进到射程就停下等装填
    }
    const d = dist(s.x, s.y, tx, ty);
    if (d > 5 && sp > 0) {
      const a = Math.atan2(ty - s.y, tx - s.x);
      s.heading = a;
      const nx = s.x + Math.cos(a) * sp * dt, ny = s.y + Math.sin(a) * sp * dt;
      if (asWet(nx, ny)) { s.x = nx; s.y = ny; }
      else { const b = a + (s.id % 2 ? 1 : -1) * 1.2; const mx = s.x + Math.cos(b) * sp * dt, my = s.y + Math.sin(b) * sp * dt; if (asWet(mx, my)) { s.x = mx; s.y = my; } }
    }
  }
  // 反潜：驱逐舰声呐搜索、攻击
  const dds = [S.dd, ...S.ships.filter(o => o.kind === 'dd' && alive(o))].filter(o => o && o.state !== 'sunk' && isFinite(o.x) && o.x > -999);
  for (const s of S.subs) {
    if (s.dead) continue;
    for (const o of dds) {
      const d = dist(o.x, o.y, s.x, s.y);
      if (d < AS.asw.r && Math.random() < AS.asw.pd * dt) { if (!asSubSeen(s)) log('驱逐舰声呐发现敌潜艇', 'warn', 'subdet' + s.id, 20, s); s.det = S.t; }
      if (asSubSeen(s) && d < (S.t - s.fireT < AS.ssn.expose ? AS.asw.rx : AS.asw.r) && S.t - (o.aswT ?? -99) > AS.asw.cd) {
        o.aswT = S.t;
        (S.torps || (S.torps = [])).push({ id: S.nid++, x: o.x, y: o.y, hd: Math.atan2(s.y - o.y, s.x - o.x), t: 0, tgt: { k: 'sub', id: s.id }, side: 'p', asw: true });
        log('驱逐舰发射反潜鱼雷', 'info', 'aswf', 8, s);
      }
    }
  }
}
// 海面判定：潜艇只在深水、浅滩里走
function asWet(x, y) { const t = typeAt(x, y); return t === T.DEEP || t === T.SHOAL; }
function asTorpStep(dt) {
  if (!S.torps || !S.torps.length) return;
  const C = AS.ssn;
  for (const t of S.torps) {
    if (t.done) continue;
    t.t += dt;
    if (t.t < 0) continue;
    if (t.t > C.tlife) { t.done = true; continue; }
    let T = null;
    if (t.tgt.k === 'sub') T = (S.subs || []).find(o => o.id === t.tgt.id && !o.dead);
    else T = asSeaAll().find(o => o.k === t.tgt.k && o.id === t.tgt.id);
    if (T) { const a = Math.atan2(T.y - t.y, T.x - t.x), da = Math.atan2(Math.sin(a - t.hd), Math.cos(a - t.hd)); t.hd += clamp(da, -.5 * dt, .5 * dt); }   // 线导 + 末段自导：慢慢转向目标
    const sp = (t.asw ? 60 : C.tspd) * dt;
    t.x += Math.cos(t.hd) * sp; t.y += Math.sin(t.hd) * sp;
    if (isLand(t.x, t.y)) { t.done = true; continue; }
    if (!T || dist(t.x, t.y, T.x, T.y) > (t.tgt.k === 'cv' ? 22 : 12)) continue;
    t.done = true;
    if (t.asw) {   // 反潜鱼雷
      if (Math.random() < AS.asw.pk) {
        const s = T; s.hp--;
        S.fx.push({ kind: 'boom', x: s.x, y: s.y, r: 18, life: 0, max: 1, side: 'e' });
        if (s.hp <= 0) { s.dead = true; log(`击沉敌${s.nm}`, 'good', null, 0, s); }
        else log('反潜鱼雷命中，敌潜艇受损', 'good', 'aswh', 6, s);
      }
      continue;
    }
    if (t.tgt.k === 'cv' && Math.random() < .2) { log('航母释放鱼雷诱饵，一条鱼雷被引偏', 'good', 'cvdec', 10, T); continue; }
    S.fx.push({ kind: 'boom', x: t.x, y: t.y, r: 30, life: 0, max: 1.4, side: 'e' });
    if (t.tgt.k === 'cv' && typeof cvImpact === 'function') cvImpact(T.x, T.y, { men: 0, ship: C.dmg, struct: 0, R: 20 });
    else if (t.tgt.k === 'dd' && typeof damageDD === 'function') { damageDD({ kind: 'coastal', x: t.x, y: t.y }); damageDD({ kind: 'coastal', x: t.x, y: t.y }); }
    else if (t.tgt.k === 'ship') { const s = S.ships.find(o => o.id === t.tgt.id); if (s) damageShip(s, C.dmg); }
    log(`${T.nm}被鱼雷击中`, 'bad', null, 0, T);
  }
  S.torps = S.torps.filter(t => !t.done);
}

HOOK.step.push(dt => {
  if (!asOn()) return;
  if ((S.asT = (S.asT ?? 0) - dt) <= 0) { S.asT = 1; asP8Step(); asTyphon(); }
  asSubStep(dt); asTorpStep(dt);
});

// ———————————————— 画面 ————————————————
// 潜艇：看得见（观战 / 被我方发现）时画艇体；鱼雷：水下细白尾迹
HOOK.drawOver.push(function asDraw(time) {
  if (!S || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, spec = specAll() || R.eye === 'all' || R.eye === 'e' || R.eye === 'both';
  for (const s of S.subs || []) {
    if (s.dead || !(spec || asSubSeen(s)) || !inView(s.x, s.y, 40)) continue;
    if (R.m3d) { if (asSubSeen(s)) { ctx.strokeStyle = rgba(COL.enemy, .5 + .3 * Math.sin(time * 5)); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(3)]); ctx.beginPath(); ctx.arc(s.x, s.y, 26, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); } continue; }   // 3D：艇体在水下立体画（v3units.js）
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.heading);
    ctx.globalAlpha = asSubSeen(s) ? .95 : .55;
    ctx.fillStyle = rgba(COL.enemy, .35); ctx.strokeStyle = rgba(COL.enemy, .95); ctx.lineWidth = px(1.2);
    ctx.beginPath(); ctx.ellipse(0, 0, 17, 3.4, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillRect(1, -1.6, 4, 3.2);   // 指挥台围壳
    ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(-21, -3); ctx.moveTo(-17, 0); ctx.lineTo(-21, 3); ctx.stroke();
    ctx.restore();
    if (asSubSeen(s)) { ctx.strokeStyle = rgba(COL.enemy, .5 + .3 * Math.sin(time * 5)); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(3)]); ctx.beginPath(); ctx.arc(s.x, s.y, 26, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }
  }
  for (const t of S.torps || []) {
    if (t.t < 0 || !inView(t.x, t.y, 30)) continue;
    ctx.strokeStyle = t.asw ? rgba(COL.g, .8) : rgba('#ffffff', .8); ctx.lineWidth = px(1.4);
    ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.x - Math.cos(t.hd) * 18, t.y - Math.sin(t.hd) * 18); ctx.stroke();
    ctx.fillStyle = t.asw ? COL.g : '#fff'; ctx.beginPath(); ctx.arc(t.x, t.y, px(1.8), 0, 6.283); ctx.fill();
  }
});
