// 条令符合度测量（在游戏作用域里执行：tools/doctrine_eval.js 的工作进程用 headless.js 的 __run 载入）
// 测的是「打得像不像真的」，不是输赢：按公开条令把双方司令的打法变成可测指标，推演中每秒 / 每 5 秒 / 每 10 秒取样
//   攻方（联合登陆战役原则）：冲击前火力准备、冲击时局部兵力比、主攻方向集中、梯队配置、零打碎敲、步坦协同、防空伞、兵力闲置
//   守方（纵深防御 / 机动防御）：判明主攻前留预备队、纵深配置、反冲击兵力比与火力准备、零打碎敲、步坦协同、防空伞、兵力闲置
// 用法：DOCT.setup(job) → DOCT.run(T) → { m: 指标, o: 结局 }；job = { mode: 'sbx' | 'pve', seed, dsty, asty, bud, level, fix }
//   fix：训练场指定的战区参数（S.thFix，theater.js 读取；没有就用默认）
globalThis.DOCT = {
  setup(job) {
    if (typeof CMD_STRICT !== 'undefined') CMD_STRICT = false;
    if (job.mode === 'pve') {
      newGame(job.seed, job.level || 'normal');
      startBattle();
      S.dd.auto = true; if (S.cv) S.cv.auto = true;
      for (const u of S.units) if (u.side === 'p') u.auto = true;
      for (const s of S.ships) s.auto = true;
      for (const v of S.veh || []) if (v.side === 'p') v.auto = true;
    } else {
      openSandbox(job.seed);
      S.sbx.budget = { p: job.bud, e: job.bud };
      sbxAIDefend(job.dsty);
      sbxAIAttack(job.asty);
      sbxStart('spectate');
    }
    if (job.fix) S.thFix = job.fix;
    DOCT.d = { imp: [], land: null, lastA: {}, lastD: {}, ep: [], s: {}, resCommit: null, t1: 0, t5: 0, t10: 0 };
  },
  // —— 真值兵力：每人 1，坦克 6、其余车辆 3；守方工事（碉堡类）6、其余固定火力 2 ——
  pow(side, x, y, r) {
    let s = 0;
    for (const q of S.teams) if (q.side === side && q.men.length && !q.ride && isLand(q.x, q.y) && dist(q.x, q.y, x, y) < r) s += q.men.length;
    for (const v of S.veh || []) if (v.side === side && !v.dead && !v.lst && isLand(v.x, v.y) && dist(v.x, v.y, x, y) < r) s += bgPow(v);
    if (side === 'e') for (const e of S.enemies) if (!e.dead && !e.decoy && dist(e.x, e.y, x, y) < r) s += e.kind === 'bunker' ? 6 : 2;
    return s;
  },
  fort(x, y, r) { return S.enemies.some(e => !e.dead && !e.decoy && e.kind === 'bunker' && dist(e.x, e.y, x, y) < r); },
  // 本方在 (x,y) 一带落弹次数（[t0, t1] 之间）
  fires(side, x, y, r, t0, t1) { let n = 0; for (const o of DOCT.d.imp) if (o.side === side && o.t >= t0 && o.t <= t1 && dist(o.x, o.y, x, y) < r) n++; return n; },
  add(k, v, w = 1) { const s = DOCT.d.s[k] || (DOCT.d.s[k] = [0, 0]); s[0] += v * w; s[1] += w; },
  // 地面兵力单位：[{side, x, y, w, kind, o}]
  ground() {
    const out = [];
    for (const q of S.teams) if (q.men.length && !q.ride && isLand(q.x, q.y)) out.push({ side: q.side, x: q.x, y: q.y, w: q.men.length, kind: 'team', o: q });
    for (const v of S.veh || []) if (!v.dead && !v.lst && isLand(v.x, v.y)) out.push({ side: v.side, x: v.x, y: v.y, w: bgPow(v), kind: 'veh', o: v });
    return out;
  },
  // 守方机动兵力（编进战斗群的排与车；守备队、伏击组、碉堡不算）
  manE(o) { return o.side === 'e' && (o.kind === 'veh' ? (S.bgs || []).some(G => !G.dead && G.side === 'e' && G.vs.includes(o.o.id)) : (S.bgs || []).some(G => !G.dead && G.side === 'e' && G.us.includes(o.o.u))); },
  thOrd(o) {   // 这个排 / 车所属营在战区体系里的命令（没有战区体系返回 null）
    if (typeof thF !== 'function' || !S.th) return null;
    const G = (S.bgs || []).find(g => !g.dead && g.th && (o.kind === 'veh' ? g.vs.includes(o.o.id) : g.us.includes(o.o.u)));
    const F = G && thF(G.th);
    return F ? thOrdOf(F).v : null;
  },
  sample1() {
    const D = DOCT.d;
    if (D.land == null && S.teams.some(q => q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y))) D.land = S.t;
    // 冲击与反冲击：本方小组进入敌据点 120 以内（30 秒内没接触过才算新的一次）
    for (const p of S.points) {
      const held = p.owner === 'p' && p.prog >= .99;
      for (const side of ['p', 'e']) {
        if (side === 'p' ? held : !held || p.owner !== 'p') continue;
        // 冲击 = 带进攻命令（攻击前进 / 冲锋）的本方小组进到据点 120 以内；守在附近、正在撤的不算
        const close = S.teams.some(q => q.side === side && q.men.length && !q.ride && dist(q.x, q.y, p.x, p.y) < 120 && q.order && (q.order.t === 'amove' || q.order.t === 'charge'));
        const L = side === 'p' ? D.lastA : D.lastD;
        if (!close) continue;
        if (L[p.key] == null || S.t - L[p.key] > 30) {
          const foe = side === 'p' ? 'e' : 'p', own = DOCT.pow(side, p.x, p.y, 260), opp = DOCT.pow(foe, p.x, p.y, 200);
          const req = side === 'p' ? (DOCT.fort(p.x, p.y, 150) ? 3 : coverAt(p.x, p.y) < .75 ? 2 : 1.5) : 2;
          const who = {};   // 冲上去的是谁（诊断用）：守备队 / 伏击组 / 预备队 / 战斗群（营）
          for (const q of S.teams) if (q.side === side && q.men.length && !q.ride && dist(q.x, q.y, p.x, p.y) < 260) {
            const G = (S.bgs || []).find(G => !G.dead && G.us.includes(q.u)), F = G && G.th && typeof thF === 'function' ? thF(G.th) : null;
            const k = G ? (F ? 'th:' + thOrdOf(F).v + (F.aiSp ? '*' : '') : 'bg') : (q.ca ? 'a4ca' : q.role || 'none');
            who[k] = (who[k] || 0) + q.men.length;
          }
          D.ep.push({ side, key: p.key, t: Math.round(S.t), r: +(own / Math.max(1, opp)).toFixed(2), req, opp, prep: DOCT.fires(side, p.x, p.y, 220, S.t - 60, S.t) >= 2, solo: own < 10, who });
        }
        L[p.key] = S.t;
      }
    }
    D.imp = D.imp.filter(o => S.t - o.t < 90);
  },
  sample5() {
    // 步坦协同：地面上的坦克 80 以内有本方步兵
    for (const v of S.veh || []) {
      if (v.dead || v.lst || !isLand(v.x, v.y) || !(BG_TANK.includes(v.type) || v.type === 'flame_tank' || v.type === 'td')) continue;
      const ok = S.teams.some(q => q.side === v.side && q.men.length && !q.ride && dist(q.x, q.y, v.x, v.y) < 80);
      DOCT.add('tank_' + v.side, ok ? 1 : 0);
    }
  },
  sample10() {
    const D = DOCT.d, G0 = DOCT.ground(), since = D.land == null ? -1 : S.t - D.land;
    if (since < 0) return;
    const P = G0.filter(o => o.side === 'p'), E = G0.filter(o => o.side === 'e'), sum = a => a.reduce((s, o) => s + o.w, 0), tp = sum(P);
    // 攻方主攻集中：前沿宽度三分之一（至少 300）的窗口里最多装了几成兵力（上陆后前 6 分钟）
    if (since < 360 && tp >= 20) {
      const xs = P.slice().sort((a, b) => a.x - b.x);
      let acc = 0, x5 = xs[0].x, x95 = xs[xs.length - 1].x;
      for (const o of xs) { acc += o.w; if (acc >= tp * .05 && x5 === xs[0].x) x5 = o.x; if (acc >= tp * .95) { x95 = o.x; break; } }
      const win = Math.max(300, (x95 - x5) / 3);
      let best = 0, j = 0, s = 0;
      for (let i = 0; i < xs.length; i++) { s += xs[i].w; while (xs[i].x - xs[j].x > win) { s -= xs[j].w; j++; } best = Math.max(best, s); }
      DOCT.add('conc_p', best / tp);
    }
    // 攻方梯队：上陆一分钟后，第二梯队、预备队占全部登陆兵力的比例——前沿以后 150 外的岸上兵力，加上还在海上待命、
    //   载着部队没抢滩的登陆舰（登陆作战的第二梯队本来就是后续上陆的舰船）
    if (since > 60 && tp >= 20 && S.front && S.front.p) {
      let back = 0, sea = 0;
      for (const o of P) { const f = frFront('p', o.x).fp; if (f != null && o.y > f + 150) back += o.w; }
      for (const sh of S.ships) if (alive(sh) && sh.state !== 'beached' && sh.load) sea += (sh.load.teams || 0) * 3 + (sh.load.eng || 0) + (Array.isArray(sh.load.veh) ? sh.load.veh.length * 6 : 0);
      DOCT.add('ech_p', (back + sea) / (tp + sea));
    }
    // 守方：机动兵力的纵深配置、判明主攻前的预备队
    const M = E.filter(DOCT.manE), tm = sum(M);
    if (tm >= 10) {
      let deep = 0, res = 0;
      for (const o of M) {
        const f = S.front && S.front.e ? frFront('e', o.x).fp : null;
        if (f != null ? o.y < f - 350 : coastAt(o.x) - o.y > 600) deep += o.w;
        const v = DOCT.thOrd(o);
        if (v === 'reserve' || v === 'follow') res += o.w;
      }
      DOCT.add('depth_e', deep / tm);
      if (since < 240) DOCT.add('res_e', res / tm);
      if (D.resCommit == null && since > 20 && res / tm < .05) D.resCommit = Math.round(since);
    }
    // 防空伞：地面兵力在本方防空 350 以内的占比
    for (const side of ['p', 'e']) {
      const own = side === 'p' ? P : E, tot = sum(own);
      if (tot < 10) continue;
      const aa = [];
      for (const v of S.veh || []) if (v.side === side && !v.dead && (v.type === 'aa_veh' || v.type === 'sam_veh')) aa.push(v);
      for (const q of S.teams) if (q.side === side && q.men.length && q.men.includes('aa')) aa.push(q);
      if (side === 'e') for (const e of S.enemies) if (!e.dead && e.kind === 'aa') aa.push(e);
      let cov = 0;
      for (const o of own) if (aa.some(a => dist(a.x, a.y, o.x, o.y) < 350)) cov += o.w;
      DOCT.add('aa_' + side, cov / tot);
    }
    // 兵力闲置：60 秒没动、400 内没有敌人、不是守据点也不是预备队的兵力占比
    for (const side of ['p', 'e']) {
      const own = side === 'p' ? P : M, tot = sum(own);
      if (tot < 10) continue;
      const foe = G0.filter(o => o.side !== side);
      let idle = 0;
      for (const o of own) {
        const mv = o.kind === 'team' ? o.o.movedT : o.o.movedT ?? o.o.arrT;
        if (mv != null && S.t - mv < 60) continue;
        if (foe.some(f => dist(f.x, f.y, o.x, o.y) < 400) || (side === 'p' && S.enemies.some(e => !e.dead && dist(e.x, e.y, o.x, o.y) < 400))) continue;
        if (S.points.some(p => (side === 'p' ? p.owner === 'p' : p.owner === 'e') && dist(p.x, p.y, o.x, o.y) < 150)) continue;
        const v = DOCT.thOrd(o);
        if (v === 'reserve' || v === 'follow') continue;
        idle += o.w;
      }
      DOCT.add('idle_' + side, idle / tot);
    }
  },
  // 双方兵力损失（出现过的峰值 → 现在）
  track() {
    const T = DOCT.d.pk || (DOCT.d.pk = { p: {}, e: {} });
    for (const o of DOCT.ground()) { const m = T[o.side], k = o.kind + o.o.id; m[k] = Math.max(m[k] || 0, o.w); }
  },
  loss(side) {
    const m = (DOCT.d.pk || { p: {}, e: {} })[side], now = {};
    for (const o of DOCT.ground()) if (o.side === side) now[o.kind + o.o.id] = o.w;
    let a = 0, b = 0;
    for (const k in m) { a += m[k]; b += Math.min(m[k], now[k] || 0); }
    return a ? 1 - b / a : 0;
  },
  run(T) {
    const D = DOCT.d, t0 = S.t;
    let k = 0;
    while (S.t - t0 < T && !S.over) {
      step(1 / 30);
      k++;
      if (k % 30 === 0) DOCT.sample1();
      if (k % 150 === 0) { DOCT.sample5(); DOCT.track(); }
      if (k % 300 === 0) DOCT.sample10();
    }
    DOCT.track();
    const m = {};
    for (const key in D.s) m[key] = +(D.s[key][0] / Math.max(1e-9, D.s[key][1])).toFixed(3);
    const ep = side => D.ep.filter(e => e.side === side && e.opp > 0);
    for (const side of ['p', 'e']) {
      const a = ep(side);
      m['n_' + side] = a.length;
      if (!a.length) continue;
      m['prep_' + side] = +(a.filter(e => e.prep).length / a.length).toFixed(3);
      m['ratio_' + side] = +(a.filter(e => e.r >= e.req).length / a.length).toFixed(3);
      m['solo_' + side] = +(a.filter(e => e.solo).length / a.length).toFixed(3);
      m['rmed_' + side] = a.map(e => e.r).sort((x, y) => x - y)[Math.floor(a.length / 2)];
    }
    m.commit_e = D.resCommit;
    m.ep = D.ep;
    m.st = Object.fromEntries(Object.entries(S.v7s || {}).filter(([k]) => /^th/.test(k)));   // 战区条令规则的触发次数（诊断）
    let hv = 0, tv = 0;
    for (const p of S.points) { const v = p.vp || 1; tv += v; if (p.owner === 'p' && p.prog >= .99) hv += v; }
    const o = { pts: +(hv / Math.max(1, tv)).toFixed(3), lp: +DOCT.loss('p').toFixed(3), le: +DOCT.loss('e').toFixed(3), over: S.over, t: Math.round(S.t), land: D.land == null ? null : Math.round(D.land) };
    return { m, o };
  }
};
HOOK.impact.push(function doctImpact(x, y, R, pw, side) { if (globalThis.DOCT && DOCT.d) DOCT.d.imp.push({ x, y, side, t: S.t }); });
