'use strict';
// 近防拦截（C-RAM）：近防炮在空中打掉落向自己防区的榴弹、迫击炮弹、火箭弹与舰炮炮弹（不拦航空炸弹）
//   进攻方：PGZ-07 双 35 自行高炮、PGL-625 弹炮防空车（160–180 内）、LD-2000 陆基近防炮（沙盒，260 内）、驱护舰的 1130 型近防炮（只护本舰 70 内）；
//   守方：M163 火神、M-SHORAD（150–170 内）、LPWS 陆基密集阵（沙盒，260 内）。
//   只打末段（飞行过半之后）；每门炮每次交战后 0.8 秒（近防炮 0.5 秒）才能再打；命中率按弹种：迫击炮弹最好打，岸防重炮弹最难。
//   守方的近防炮打出曳光、暴露位置；我方的照常画曳光。
const CW_PK = { mortar: .55, arty: .4, spg: .4, cb: .4, naval: .35, coastal: .3 };
const CW_FROM = { p: ['arty', 'mortar', 'coastal', 'cb', 'spg'], e: ['naval', 'mortar', 'spg'] };   // 各方拦截的来袭弹种（对方打来的）
const cwStat = k => { if (typeof v8Stat === 'function') v8Stat(k); };

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
  return out;
}

function cwStep(dt) {
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
      const u = clamp(best.t / best.dur, 0, 1), sx = lerp(best.fx0 ?? best.x0, best.x1, u), sy = lerp(best.fy0 ?? best.y0, best.y1, u) - Math.sin(u * Math.PI) * 18;
      const vis = side === 'p' || inVision(g.x, g.y);
      for (let i = 0; i < 3; i++) tracer(g.x, g.y, sx + gauss() * 5, sy + gauss() * 5, side, vis);
      if (side === 'e' && g.o.kx !== undefined && !g.ship) { g.o.kx = g.o.x; g.o.ky = g.o.y; g.o.seen = S.t; }   // 守方近防炮开火暴露位置
      if (Math.random() < (CW_PK[best.kind] || .35) * g.k) {
        best.done = true; best.cwKill = true;
        S.fx.push({ kind: 'flash', x: sx, y: sy, r: 9, life: 0, max: .5, side });
        cwStat(side === 'p' ? 'cwP' : 'cwE');
        if (side === 'p') log(`${g.nm}在空中打掉一发来袭${best.kind === 'mortar' ? '迫击炮弹' : '炮弹'}`, 'good', 'cwp', 12, { x: sx, y: sy });
        else if (vis) log(`敌${g.nm}拦截了我方炮弹`, 'warn', 'cwe', 15, { x: sx, y: sy });
      } else cwStat(side === 'p' ? 'cwPmiss' : 'cwEmiss');
    }
  }
}

HOOK.step.push(cwStep);
