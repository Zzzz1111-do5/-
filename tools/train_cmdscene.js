// 司令训练场的一局（在游戏作用域里执行：tools/train_cmd.js 的工作进程用 headless.js 的 __run 载入）
// job = { seed 地图, dsty 守方部署方案, asty 攻方打法, bud 双方预算, doc 司令战法（S.cmdFix）, T 秒 }
globalThis.CMDT = {
  setup(job) {
    CMD_STRICT = false;
    openSandbox(job.seed);
    S.sbx.budget = { p: job.bud, e: job.bud };
    sbxAIDefend(job.dsty);
    sbxAIAttack(job.asty);
    sbxStart('spectate');
    S.cmdFix = job.doc;   // hq.js hqOrgE 按它编旅、hqCmdE 按它派旅
    CMDT.st = { held: 0, n: 0, seenP: {}, seenE: {}, vP: {}, vE: {} };
  },
  // 据点按分值：守方还在手里的比例
  held() {
    let a = 0, b = 0;
    for (const p of S.points) { const v = p.vp || 1; b += v; if (p.owner === 'e' && p.prog < .5) a += v; }
    return b ? a / b : 1;
  },
  // 双方出现过的兵力（人、车按战斗力）与现在还在的
  track() {
    const T = CMDT.st;
    for (const q of S.teams) if (q.men.length && !q.ride) { const m = q.side === 'p' ? T.seenP : T.seenE; m[q.id] = Math.max(m[q.id] || 0, q.men.length); }
    for (const v of S.veh || []) if (!v.dead && !v.lst) { const m = v.side === 'p' ? T.vP : T.vE; m[v.id] = Math.max(m[v.id] || 0, bgPow(v)); }
  },
  loss(side) {
    const T = CMDT.st, seenT = side === 'p' ? T.seenP : T.seenE, seenV = side === 'p' ? T.vP : T.vE;
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
      if (++k % 10 === 0) { CMDT.st.held += CMDT.held(); CMDT.st.n++; CMDT.track(); }
    }
    CMDT.track();
    const H = S.hq && S.hq.e, hAvg = CMDT.st.n ? CMDT.st.held / CMDT.st.n : CMDT.held(), hEnd = CMDT.held(), lp = CMDT.loss('p'), le = CMDT.loss('e');
    const s = 60 * hAvg + 40 * hEnd + 40 * lp - 30 * le + (S.over === 'lose' ? 10 : S.over === 'win' ? -10 : 0);
    return { s: +s.toFixed(2), held: +hEnd.toFixed(2), hAvg: +hAvg.toFixed(2), lp: +lp.toFixed(2), le: +le.toFixed(2), over: S.over, t: Math.round(S.t), key: H && H.doc ? H.doc.key : null, tac: H && H.tac ? H.tac.k : null, nb: H ? H.bdes.length : 0 };
  }
};
