// 101 空降师训练场的一局（在游戏作用域里执行：tools/train_101.js 的工作进程用 headless.js 的 __run 载入）
// job = { seed 地图, dsty 守方部署, asty 攻方打法, bud 守方预算, abud 攻方预算（强弱：顺风 / 均势 / 逆风）, tac 101 打法（A101_TAC）, drop 空降时刻, T 秒 }
globalThis.T101 = {
  setup(job) {
    CMD_STRICT = false;
    openSandbox(job.seed);
    S.sbx.budget = { p: job.abud, e: job.bud };
    sbxAIDefend(job.dsty);
    sbxAIAttack(job.asty);
    sbxStart('spectate');
    Object.assign(A101_TAC, job.tac);   // 候选打法
    S.assets = S.assets || {}; S.assets.e101 = 1; S.e101 = null;
    const E1 = a101Ensure(); E1.n = 1; E1.next = job.drop;
    T101.st = { held: 0, n: 0, seenP: {}, vP: {}, a: {}, av: {}, link: 0, delay: 0, fire: 0, drop: job.drop };
  },
  held() {
    let a = 0, b = 0;
    for (const p of S.points) { const v = p.vp || 1; b += v; if (p.owner === 'e' && p.prog < .5) a += v; }
    return b ? a / b : 1;
  },
  // 攻方出现过的兵力；101 落地的人、车（按战斗力）
  track() {
    const T = T101.st;
    for (const q of S.teams) if (q.men.length && !q.ride) {
      if (q.side === 'p') T.seenP[q.id] = Math.max(T.seenP[q.id] || 0, q.men.length);
      else if (q.a101) T.a[q.id] = Math.max(T.a[q.id] || 0, q.men.length);
    }
    for (const v of S.veh || []) if (!v.dead && !v.lst) {
      if (v.side === 'p') T.vP[v.id] = Math.max(T.vP[v.id] || 0, bgPow(v));
      else if (v.a101) T.av[v.id] = Math.max(T.av[v.id] || 0, bgPow(v));
    }
  },
  left(mt, mv) {
    let s0 = 0, s1 = 0;
    for (const id in mt) { s0 += mt[id]; const q = S.teams.find(o => o.id === +id); s1 += q ? q.men.length : 0; }
    for (const id in mv) { s0 += mv[id]; const v = (S.veh || []).find(o => o.id === +id); s1 += v && !v.dead ? mv[id] : 0; }
    return { s0, f: s0 ? s1 / s0 : 0 };
  },
  run(T) {
    const t0 = S.t;
    let k = 0;
    while (S.t - t0 < T && !S.over) {
      for (let i = 0; i < 30; i++) { step(1 / 30); if (S.over) break; }
      if (++k % 5 === 0) { T101.st.held += T101.held(); T101.st.n++; T101.track(); }
      const E1 = S.e101;   // 到了空降时刻还没走（守方在等总攻）：指定去受威胁最大的据点，保证每局都空降
      if (E1 && E1.n > 0 && !E1.lift && S.t > T101.st.drop + 15 && !E1.force) { const p = a101Obj() || S.points.find(o => o.owner === 'p') || S.points[0]; E1.force = p && p.key; }
    }
    T101.track();
    const st = T101.st, lp = 1 - T101.left(st.seenP, st.vP).f, A = T101.left(st.a, st.av), v = S.v7s || {};
    const hAvg = st.n ? st.held / st.n : T101.held(), hEnd = T101.held(), surv = A.s0 ? A.f : 0;
    // 得分：攻方损失（101 打掉的算在里面）、据点守得住、101 自己活下来（精锐不能拼光），没落地（被击落 / 没空降）的局 101 分只按 0 算
    const s = 45 * lp + 25 * hAvg + 25 * hEnd + 35 * surv + (S.over === 'lose' ? 10 : S.over === 'win' ? -10 : 0);
    return { s: +s.toFixed(2), lp: +lp.toFixed(2), surv: +surv.toFixed(2), men: A.s0, held: +hEnd.toFixed(2), hAvg: +hAvg.toFixed(2), over: S.over, t: Math.round(S.t),
      delay: v.saDelay || 0, brk: v.saBreak || 0, link: v.bgLink || 0, go: v.bgLinkGo || 0, cover: v.bgCover || 0, turtle: v.a101Turtle || 0, fire: (v.saFiree || 0) };
  }
};
