'use strict';
// 近防拦截（C-RAM）：近防炮在空中打掉落向自己防区的榴弹、迫击炮弹、火箭弹与舰炮炮弹（不拦航空炸弹）
//   进攻方：PGZ-07 双 35 自行高炮、PGL-625 弹炮防空车（160–180 内）、LD-2000 陆基近防炮（沙盒，260 内）、驱护舰的 1130 型近防炮（只护本舰 70 内）；
//   守方：M163 火神、M-SHORAD（150–170 内）、LPWS 陆基密集阵（沙盒，260 内）。
//   只打末段（飞行过半之后）；每门炮每次交战后 0.8 秒（近防炮 0.5 秒）才能再打；命中率按弹种：迫击炮弹最好打，岸防重炮弹最难。
//   守方的近防炮打出曳光、暴露位置；我方的照常画曳光。
const CW_PK = { mortar: .55, arty: .4, spg: .4, cb: .4, naval: .35, coastal: .3 };
const CW_FROM = { p: ['arty', 'mortar', 'coastal', 'cb', 'spg'], e: ['naval', 'mortar', 'spg'] };   // 各方拦截的来袭弹种（对方打来的）
const cwStat = k => { if (typeof v8Stat === 'function') v8Stat(k); };
// 3D 画面用的连射记录（不进 S、不影响推演）：每次交战一条 {t0, gx, gy, gz 炮口离地高, s 来袭弹的起止与弹种, u 交战时弹飞了几成, kill, side}
//   v3fx.js 按它画一道从炮口射向空中来袭弹的曳光弹流、炮口焰、空中的爆点——原来借步兵曳光弹画：从 1.6 米高平着射向炮弹在地上的投影点，每次只有 3 条
const CW_FX = [];
// 来袭弹在 u 时刻离地多高（同 v3fx.js 画炮弹的弧线：迫击炮弹弧线高、榴弹 / 舰炮炮弹低平）
const cwShellH = (s, u) => { const d = dist(s.x0, s.y0, s.x1, s.y1), apex = s.kind === 'mortar' ? Math.min(320, d * .75) : Math.min(420, d * .32); return Math.sin(Math.PI * u) * apex + 3 * (1 - u); };

// side 方的近防火力：{o, x, y, r 防区半径, k 命中率系数, cd 冷却, nm 名称, ship}
function cwGuns(side) {
  const out = [];
  for (const v of S.veh || []) {
    if (v.side !== side || v.dead || v.lst || v.swim) continue;
    const sp = vehSp(v), cram = v.mod && v.mod.cram;
    if (!sp.aa && !cram) continue;
    const r = cram ? 260 : v.type === 'sam_veh' ? 180 : side === 'e' ? 150 : 160;
    out.push({ o: v, x: v.x, y: v.y, r, k: cram ? 1.35 : 1, cd: cram ? .5 : .8, nm: vehModel(v) });
  }
  if (side === 'p' && typeof msDefShips === 'function') for (const s of msDefShips()) out.push({ o: s.o, x: s.x, y: s.y, r: 70, k: 1.1, cd: .6, nm: s.esc ? (s.o.label || '护卫舰') : (S.dd.name || '驱逐舰'), ship: true });
  if (side === 'p' && typeof cvDefs === 'function') for (const s of cvDefs()) out.push({ o: s.o, x: s.x, y: s.y, r: 90, k: 1.2, cd: .4, nm: s.o.name || '航母', ship: true });   // 航母 1130 型近防炮
  return out;
}

function cwStep(dt) {
  if (!S) return;
  if (CW_FX.S !== S) { CW_FX.length = 0; CW_FX.S = S; }   // 换局清掉
  let j = 0; while (j < CW_FX.length && S.t - CW_FX[j].t0 > 3) j++;   // 过时的（按时间先后排着）
  if (j || CW_FX.length > 60) CW_FX.splice(0, Math.max(j, CW_FX.length - 60));
  if (!S || S.phase !== 'battle' || !S.shells || !S.shells.length) return;
  for (const side of ['p', 'e']) {
    const G = cwGuns(side);
    if (!G.length) continue;
    const from = CW_FROM[side];
    for (const g of G) {
      if ((g.o.cwT ?? 0) > S.t) continue;
      let best = null, bd = Infinity;
      for (const s of S.shells) {
        if (s.done || s.cw || s.side === side || !from.includes(s.kind) || s.t < s.dur * .55 || s.t >= s.dur) continue;
        const d = dist(s.x1, s.y1, g.x, g.y);
        if (d < g.r && d < bd) { bd = d; best = s; }
      }
      if (!best) continue;
      g.o.cwT = S.t + g.cd;
      best.cw = true;   // 每发弹只拦一次
      const u = clamp(best.t / best.dur, 0, 1), gx = lerp(best.fx0 ?? best.x0, best.x1, u), gy = lerp(best.fy0 ?? best.y0, best.y1, u), sx = gx, sy = gy - Math.sin(u * Math.PI) * 18;
      const vis = side === 'p' || inVision(g.x, g.y);
      for (let i = 0; i < 3; i++) { tracer(g.x, g.y, sx + gauss() * 5, sy + gauss() * 5, side, vis); S.tracers[S.tracers.length - 1].cw = 1; }   // 平面画面的示意；3D 里按 CW_FX 画
      if (!g.ship) { const o = g.o, hz = cwShellH(best, u); o.aim = Math.atan2(gy - g.y, gx - g.x); o.mgT = S.t; o.cwAt = S.t; o.cwEl = Math.atan2(hz - 4, Math.max(1, dist(g.x, g.y, gx, gy))); }   // 炮塔转过去、炮管仰起、炮管束转起来（vfn.js）
      if (side === 'e' && g.o.kx !== undefined && !g.ship) { g.o.kx = g.o.x; g.o.ky = g.o.y; g.o.seen = S.t; }   // 守方近防炮开火暴露位置
      const kill = Math.random() < (CW_PK[best.kind] || .35) * g.k;
      CW_FX.push({ t0: S.t, gx: g.x, gy: g.y, gz: g.ship ? 14 : 4.3, s: { x0: best.fuzzy ? best.fx0 : best.x0, y0: best.fuzzy ? best.fy0 : best.y0, x1: best.x1, y1: best.y1, kind: best.kind }, u, kill, side, vis });
      if (kill) {
        best.done = true; best.cwKill = true;
        S.fx.push({ kind: 'flash', x: sx, y: sy, r: 9, life: 0, max: .5, side, cw: 1 });
        cwStat(side === 'p' ? 'cwP' : 'cwE');
        if (side === 'p') log(`${g.nm}在空中打掉一发来袭${best.kind === 'mortar' ? '迫击炮弹' : '炮弹'}`, 'good', 'cwp', 12, { x: sx, y: sy });
        else if (vis) log(`敌${g.nm}拦截了我方炮弹`, 'warn', 'cwe', 15, { x: sx, y: sy });
      } else cwStat(side === 'p' ? 'cwPmiss' : 'cwEmiss');
    }
  }
}

HOOK.step.push(cwStep);
