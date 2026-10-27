'use strict';
// 机场上停放的飞机当地面目标：进攻方的步兵、车辆能打掉守方野战机场上停放的飞机，守方地面部队也能打掉我方停在夺取的机场上的飞机
//   步兵（combat.js findTarget / teamFire）：射程内看得见就打，同样远时先打会还手的兵和车；远处的轻武器打不进机堡，
//     冲到 AFG.close 米以内用手榴弹、炸药（工兵带的炸药最管用）
//   车辆（vehicles.js vehGunTarget）：主炮把它当工事打，榴弹落点按冲击结算（守方飞机由 eair.js eaImpact、我方飞机由 abn.js abImpact）
//   被毁的飞机在机位上留下烧毁的残骸（S.afWk），头 45 秒还冒火
const AFG = { S: null, t: -1, p: [], e: [], close: 28 };   // p：进攻方要打的（守方停放的）· e：守方要打的（我方停放的）

// 停放的飞机（世界坐标），推演时间每 0.25 秒列一次
function afgList(side) {
  if (!S || S.phase !== 'battle') return [];
  if (AFG.S !== S || S.t - AFG.t >= .25 || S.t < AFG.t) afgScan();
  return side === 'p' ? AFG.p : AFG.e;
}
function afgScan() {
  AFG.S = S; AFG.t = S.t; AFG.p = []; AFG.e = [];
  if (typeof eaBases === 'function' && typeof eaParked === 'function') for (const b of eaBases()) for (const P of eaParked(b)) {
    const [x, y] = eaW(b, P.u, P.v);
    AFG.p.push({ x, y, w: P.w, k: P.k, own: 'e', b, u: P.u, v: P.v, a: P.a, sil: eaSil(P.w.type), size: P.w.type === 'heli' ? 13 : P.w.type === 'f22' ? 15 : 14 });
  }
  const B = S.abBase;
  if (B && typeof abParked === 'function' && typeof EA_STAND === 'object') abParked().slice(0, EA_STAND.length).forEach((w, i) => {
    const [u, v, a, k] = EA_STAND[i], [x, y] = eaW(B, u, v);
    AFG.e.push({ x, y, w, k, own: 'p', b: B, u, v, a, sil: airSilKey(w.type, w.v), size: 14 });
  });
}

// 步兵开火（teamFire 里 tg.k === 'ac'）：按人头累计伤害；机堡里的远处打不进去，抵近了手榴弹、炸药
function afgHit(a, q, acc, d) {
  const w = a.w;
  if (!w || w.state === 'lost') return;
  if (w.gh == null) w.gh = a.size <= 13 ? 2.5 : 3;
  const close = d < AFG.close, has = a.k === 'has' && !close;
  let dmg = close ? 1 : 0;
  for (const m of q.men) dmg += m === 'mg' ? .6 : m === 'eng' ? (close ? 1.6 : .1) : m === 'aa' || m === 'radio' ? .05 : .25;   // 一个满员组在百米内集火十来秒能打掉一架
  w.gh -= dmg * acc * (has ? .1 : 1) * (.6 + Math.random() * .8);
  if (w.gh <= 0) afgKill(a, q.side === 'p' ? (close ? '我方步兵抵近爆破' : '我方步兵火力') : '敌地面部队');
}
// 车辆喷火：机堡外的直接烧毁，机堡里的一半
function afgFlame(a) { if (a.k !== 'has' || Math.random() < .5) afgKill(a, a.own === 'e' ? '我方喷火坦克' : '敌喷火车辆'); }

function afgKill(a, by) {
  const w = a.w;
  if (!w || w.state === 'lost') return;
  w.state = 'lost';
  if (a.own === 'p' && typeof airCount === 'function') airCount();
  afgWreck(a.b, a, a.sil, a.size);
  S.fx.push({ kind: 'boom', x: a.x, y: a.y, r: 16, life: 0, max: 1.1, side: a.own === 'e' ? 'p' : 'e' });
  const nm = a.own === 'e' ? (EA_SPEC[w.type] || { name: '飞机' }).name : airName(w.type, w.v);
  if (a.own === 'e') log(`敌${nm}在机位上被${by}击毁`, 'good', null, 0, { x: a.x, y: a.y });
  else log(`停在机场的${nm}被${by}击毁`, 'bad', null, 0, { x: a.x, y: a.y });
  const st = S.v7s || (S.v7s = {}); st['afgKill' + a.own] = (st['afgKill' + a.own] || 0) + 1;
}
// 机位上留一具烧毁的残骸（世界坐标与朝向：机场局部坐标可能镜像，朝向按 rs 翻转）
function afgWreck(b, P, sil, size) {
  const h = b.rh || 0, s = b.rs || 1, [x, y] = eaW(b, P.u, P.v);
  (S.afWk || (S.afWk = [])).push({ x: Math.round(x), y: Math.round(y), a: +(h + s * P.a).toFixed(3), sil: sil || 'a10', size: size || 14, t: S.t });
  if (S.afWk.length > 30) S.afWk.shift();
}

// 我方停在夺取的机场上的飞机挨守方炮火（abn.js abImpact 只管跑道附近，机位在场区里另算）
HOOK.impact.push(function afgImpact(x, y, R, pw, side) {
  if (side !== 'e' || !S || !S.abBase) return;
  for (const a of afgList('e')) {
    const d = dist(x, y, a.x, a.y), has = a.k === 'has';
    if (d < (has ? R * .35 + 3 : R * .6 + 8) && Math.random() < (has ? .3 : d < 12 ? .85 : .4)) afgKill(a, '敌炮火');
  }
});
HOOK.newGame.push(() => { AFG.S = null; if (S) S.afWk = []; });

// 残骸：焦痕、烧黑的机体，头 45 秒有火光和黑烟
HOOK.drawGround.push(function afgDraw(time) {
  if (!S || !S.afWk || !S.afWk.length || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, real = typeof realLook === 'function' && realLook();
  for (const k of S.afWk) {
    if (!inView(k.x, k.y, 40)) continue;
    if (!k.seen && inVision(k.x, k.y)) k.seen = 1;   // 看见过就一直标着（残骸不会动）
    if (!k.seen && !specAll()) continue;
    const age = S.t - k.t, r = k.size * .9, sc = k.size / 21;
    ctx.save(); ctx.translate(k.x, k.y);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r);   // 焦痕：中间黑、边上淡
    sg.addColorStop(0, 'rgba(18,15,12,.62)'); sg.addColorStop(.6, 'rgba(24,20,16,.35)'); sg.addColorStop(1, 'rgba(24,20,16,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    if (typeof airShape === 'function') {   // 烧黑的机体（剪影，不画涂装）
      ctx.rotate(k.a); ctx.scale(sc, sc); airShape(ctx, k.sil);
      ctx.fillStyle = real ? 'rgba(38,34,30,.92)' : 'rgba(10,8,6,.9)'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = px(.8) / sc; ctx.stroke();
    }
    ctx.restore();
    if (age < 45) {
      const f = 1 - age / 45, fl = .55 + .45 * Math.sin(time * 13 + k.x) * Math.sin(time * 7.3 + k.y);
      const g = ctx.createRadialGradient(k.x, k.y, 0, k.x, k.y, r * .8);
      g.addColorStop(0, `rgba(255,190,90,${.7 * f * fl})`); g.addColorStop(.5, `rgba(240,90,30,${.35 * f * fl})`); g.addColorStop(1, 'rgba(240,90,30,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(k.x, k.y, r * .8, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(30,28,26,${.24 * f})`;   // 黑烟顺风飘
      for (let i = 0; i < 4; i++) { const s = (time * .35 + i / 4) % 1; ctx.beginPath(); ctx.arc(k.x + s * 22, k.y - s * 15, 3 + s * 9, 0, 7); ctx.fill(); }
    }
  }
});
