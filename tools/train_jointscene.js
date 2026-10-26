// 司令—旅—团联合训练场的一局（在游戏作用域里执行：tools/train_joint.js 的工作进程用 headless.js 的 __run 载入）
// job = { seed 地图, dsty 守方部署, asty 攻方打法, bud 双方预算, fix 候选协同参数（S.jointFix = { bde: { e, p }, sa: { e, p } }）, T 秒 }
// 返回双方各自的得分：守方 = 守住据点 + 敌损失 − 我损失；攻方反过来
globalThis.TJ = {
  setup(job) {
    CMD_STRICT = false;
    openSandbox(job.seed);
    S.sbx.budget = { p: job.bud, e: job.bud };
    sbxAIDefend(job.dsty);
    sbxAIAttack(job.asty);
    sbxStart('spectate');
    S.jointFix = job.fix;
    TJ.st = { held: 0, n: 0, seenP: {}, seenE: {}, vP: {}, vE: {} };
  },
  held() {
    let a = 0, b = 0;
    for (const p of S.points) { const v = p.vp || 1; b += v; if (p.owner === 'e' && p.prog < .5) a += v; }
    return b ? a / b : 1;
  },
  track() {
    const T = TJ.st;
    for (const q of S.teams) if (q.men.length && !q.ride) { const m = q.side === 'p' ? T.seenP : T.seenE; m[q.id] = Math.max(m[q.id] || 0, q.men.length); }
    for (const v of S.veh || []) if (!v.dead && !v.lst) { const m = v.side === 'p' ? T.vP : T.vE; m[v.id] = Math.max(m[v.id] || 0, bgPow(v)); }
  },
  loss(side) {
    const T = TJ.st, seenT = side === 'p' ? T.seenP : T.seenE, seenV = side === 'p' ? T.vP : T.vE;
    let s0 = 0, s1 = 0;
    for (const id in seenT) { s0 += seenT[id]; const q = S.teams.find(o => o.id === +id); s1 += q ? q.men.length : 0; }
    for (const id in seenV) { s0 += seenV[id]; const v = (S.veh || []).find(o => o.id === +id); s1 += v && !v.dead ? seenV[id] : 0; }
    return s0 ? 1 - s1 / s0 : 0;
  },
  run(T) {
    const t0 = S.t;
    let k = 0;
    while (S.t - t0 < T && !S.over) {
      for (let i = 0; i < 30; i++) { step(1 / 30); if (S.over) break; }
      if (++k % 10 === 0) { TJ.st.held += TJ.held(); TJ.st.n++; TJ.track(); }
    }
    TJ.track();
    const hAvg = TJ.st.n ? TJ.st.held / TJ.st.n : TJ.held(), hEnd = TJ.held(), lp = TJ.loss('p'), le = TJ.loss('e'), v = S.v7s || {};
    const ov = S.over === 'lose' ? 10 : S.over === 'win' ? -10 : 0;
    const e = 60 * hAvg + 40 * hEnd + 40 * lp - 30 * le + ov, p = 60 * (1 - hAvg) + 40 * (1 - hEnd) + 40 * le - 30 * lp - ov;
    return { e: +e.toFixed(2), p: +p.toFixed(2), held: +hEnd.toFixed(2), lp: +lp.toFixed(2), le: +le.toFixed(2), over: S.over, t: Math.round(S.t),
      delay: (v.saDelay || 0) + (v.saBreak || 0), link: v.saEnd_link || 0, fire: (v.saFiree || 0) + (v.saFirep || 0) };
  }
};
