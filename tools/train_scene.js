// 团级训练场（在游戏作用域里执行：Node 由 headless.js 的 __run 载入，浏览器用 <script> 载入）
// 在沙盒地图上摆一个团（本方）对一股敌人（对手），本方按指定战法（docFix）执行命令，打 T 秒后打分
// 局面：task atk 本方进攻对手据守的据点 · def 本方防守据点、对手一个团来攻
// spec = { seed, pt 据点序号, task, own 编成, foe 敌情 / 来攻的编成, side 本方 'p' | 'e', doc 战法参数, T 秒 }
globalThis.TRAIN = {
  // 编成：co 步兵连数（每连 3 个组）· at 反坦克组数 · v 车辆
  OWN: {
    inf: { co: 4, at: 1, v: [] },
    mech: { co: 3, at: 1, v: ['tank', 'tank', 'tank', 'apc', 'apc', 'aa_veh'] },
    armor: { co: 1, at: 0, v: ['hv_tank', 'tank', 'tank', 'tank', 'tank', 'tank', 'apc', 'apc', 'sam_veh'] }
  },
  // 据守的对手（进攻局面）：约为本方兵力的六成，挖好散兵坑
  FOE: {
    inf: { co: 2, at: 1, v: [] },
    armor: { co: 1, at: 0, v: ['tank', 'tank', 'hv_tank', 'tank'] },
    mixed: { co: 1, at: 1, v: ['tank', 'tank', 'td'] },
    fort: { co: 1, at: 1, v: [], bunk: 3, wire: true }
  },
  men(side, at) { return at ? (side === 'p' ? ['radio', 'rifle', 'rifle'] : ['rifle', 'rifle', 'rifle']) : side === 'p' ? ['radio', 'rifle', 'mg'] : ['rifle', 'rifle', 'mg']; },
  // 在 (x, y) 附近摆一支部队，正面朝 face；hold：据守（挖好坑、不动）
  spawn(side, comp, x, y, face, hold, pk) {
    const us = [], vs = [], lx = -Math.sin(face), ly = Math.cos(face), fx = Math.cos(face), fy = Math.sin(face);
    const spot = (ox, oy, cls) => { let sx = clamp(x + lx * ox + fx * oy, 30, W - 30), sy = clamp(y + ly * ox + fy * oy, 30, H - 30); if (stepCost(ci(sx, sy), cls) === Infinity) { const j = nearestPassable(ci(sx, sy), cls); if (j >= 0) { sx = cellCX(j); sy = cellCY(j); } } return [sx, sy]; };
    const n = comp.co;
    for (let c = 0; c < n; c++) {
      const u = addUnit(side, 'inf', side === 'e' ? { role: hold ? 'garrison' : 'bg', obj: pk, face } : { auto: false, man: true, ship: '训练', face });
      for (let k = 0; k < 3; k++) {
        const at = c === 0 && k === 2 && comp.at > 0, [sx, sy] = spot((c - (n - 1) / 2) * (hold ? 70 : 95) + (k - 1) * 22, (k === 1 ? 12 : 0) + (hold ? 0 : 0), side);
        const q = addTeam(side, sx, sy, TRAIN.men(side, at), { u: u.id, ...(side === 'e' ? { role: hold ? 'garrison' : 'bg', obj: pk } : { man: true }), ...(at ? { mod: { at: 1.5, atPen: 3.4, rng: 1.6, pow: .8 } } : {}) });
        if (hold) q.order = { t: 'hold' };
      }
      us.push(u);
    }
    comp.v.forEach((t, i) => {
      const [sx, sy] = spot((i - (comp.v.length - 1) / 2) * 30, hold ? -50 : -60, side === 'e' ? 'vehe' : 'veh');
      const v = addVehicle(side, t, sx, sy, { auto: side === 'e' || !hold, ...(side === 'p' ? { man: true } : {}) });
      v.heading = v.aim = face;
      if (hold) { v.order = { t: 'hold' }; if (side === 'p') v.auto = false; }
      vs.push(v);
    });
    for (let k = 0; k < (comp.bunk || 0); k++) { const [sx, sy] = spot((k - (comp.bunk - 1) / 2) * 90, 40, side); addEnemy('bunker', sx, sy); }
    if (comp.wire) { const [ax, ay] = spot(-160, 110, side), [bx, by] = spot(160, 110, side); S.wire.push({ id: S.nid++, x0: ax, y0: ay, x1: bx, y1: by, known: false, cut: false }); }
    indexUnits();
    if (hold) for (const q of S.teams) if (q.side === side && us.some(u => u.id === q.u)) { const h = { id: S.nid++, x: q.x, y: q.y, side, u: q.u, a: face, d: 1 }; (S.holes || (S.holes = [])).push(h); q.hole = h.id; q.movedT = -99; }
    rebuildForts();
    return { us, vs };
  },
  // 出发位置：离据点 dist 远、朝 a0 方向 ±70°、陆上、步兵与车辆都能走到据点
  start(p, side, a0, d0) {
    let best = null, bs = -1e9;
    for (let i = 0; i < 48; i++) {
      const a = a0 + (i / 48 - .5) * 2.4, r = d0 + (i % 3) * 50, x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      if (x < 60 || y < 60 || x > W - 60 || y > H - 60 || !passInf(x, y)) continue;
      const vc = side === 'e' ? 'vehe' : 'veh';
      if (!reachable(x, y, p.x, p.y, side) || stepCost(ci(x, y), vc) === Infinity || !reachable(x, y, p.x, p.y, vc)) continue;
      const sc = -Math.abs(a - a0) - coverAt(x, y) * .3;
      if (sc > bs) { bs = sc; best = { x, y }; }
    }
    return best;
  },
  setup(spec) {
    const { seed, pt, task, own, foe, side, doc } = spec;
    openSandbox(seed);
    S.sbx.items = [];
    sbxStart('spectate');
    S.v7off = { ...(S.v7off || {}), br: true, hq: true };
    S.hq = { on: false, e: { bdes: [], n: 0, mem: {} }, p: { bdes: [], n: 0, mem: {} } };
    S.trainSpec = spec;
    const cands = S.points.filter(p => !/^E\d/.test(p.key) && p.key !== 'AF' && coastAt(p.x) - p.y > 250);
    const P = cands[pt % cands.length];
    // 据点：攻方守、守方攻的据点先归据守的一方
    const def = task === 'atk' ? (side === 'p' ? 'e' : 'p') : side;
    for (const p of S.points) { p.owner = 'e'; p.prog = 0; }
    if (def === 'p') { P.owner = 'p'; P.prog = 1; }
    const atkSide = def === 'p' ? 'e' : 'p', a0 = atkSide === 'p' ? SOUTH : NORTH;   // 攻方从海那边（南）来，守方反冲击从北边来
    const st = TRAIN.start(P, atkSide, a0, 720);
    if (!st) return false;
    const face = Math.atan2(P.y - st.y, P.x - st.x);
    const B = { id: -1, no: 9, regs: [], rn: 0 }, B2 = { id: -2, no: 8, regs: [], rn: 0 };
    let G, F;
    if (task === 'atk') {
      const D = TRAIN.spawn(def, TRAIN.FOE[foe], P.x, P.y, face + Math.PI, true, P.key);
      const A = TRAIN.spawn(side, TRAIN.OWN[own], st.x, st.y, face, false, P.key);
      G = hqNewReg(side, B, A.us, A.vs, st);
      const at = hqApproach(side, st.x, st.y, P, HQ.attack);
      G.task = { k: 'atk', v: 'attack', key: P.key, x: at.x, y: at.y, face, go: true };
      G.docFix = doc; G.st = 'move';
      F = { us: D.us.map(u => u.id), vs: D.vs.map(v => v.id) };
    } else {
      const D = TRAIN.spawn(side, TRAIN.OWN[own], P.x, P.y, face + Math.PI, false, P.key);
      const A = TRAIN.spawn(atkSide, TRAIN.OWN[foe === 'mixed' ? 'mech' : foe], st.x, st.y, face, false, P.key);
      G = hqNewReg(side, B, D.us, D.vs, P);
      G.task = { k: 'def', v: 'defend', key: P.key, x: Math.round(P.x + Math.cos(face + Math.PI) * 40), y: Math.round(P.y + Math.sin(face + Math.PI) * 40), face: face + Math.PI };
      G.docFix = doc; G.st = 'move';
      const H = hqNewReg(atkSide, B2, A.us, A.vs, st), at = hqApproach(atkSide, st.x, st.y, P, HQ.attack);
      H.task = { k: 'atk', v: 'attack', key: P.key, x: at.x, y: at.y, face, go: true };
      H.st = 'move';
      F = { G: H.id };
    }
    S.train = { P: P.key, G: G.id, F, p0: hqRegPow(G).tot, f0: 0, capT: null };
    S.train.f0 = TRAIN.foePow();
    // 训练场的火力支援：团叫火力准备时，一个炮兵连在 15 秒内打 6 发（按真实对局里舰炮 / 炮兵大致的反应）
    S.trainFire = [];
    return true;
  },
  foePow() {
    const T = S.train, F = T.F;
    if (F.G != null) { const H = (S.bgs || []).find(o => o.id === F.G); return H ? hqRegPow(H).tot : 0; }
    let n = 0;
    for (const id of F.us) { const u = UNIT_MAP.get(id); if (u) for (const q of teamsOf(u)) n += q.men.length; }
    for (const id of F.vs) { const v = vehById(id); if (v && !v.dead) n += bgPow(v); }
    for (const e of S.enemies) if (!e.dead && e.kind === 'bunker') n += 6;
    return n;
  },
  fire() {
    const G = (S.bgs || []).find(o => o.reg && o.fireReq && !o.dead && (S.trainFire.done || (S.trainFire.done = {}))[o.id + ':' + o.fireReq.t] == null);
    if (G) { S.trainFire.done[G.id + ':' + G.fireReq.t] = 1; for (let k = 0; k < 6; k++) S.trainFire.push({ t: S.t + 2 + k * 2.5, x: G.fireReq.x, y: G.fireReq.y, side: G.side }); }
    for (const f of S.trainFire) if (!f.done && S.t >= f.t) {
      f.done = true;
      const a = safeAim(f.side, f.x, f.y, 35, POWER.arty.R);
      if (a) fireShell(f.x, f.y + (f.side === 'p' ? 900 : -900), a[0], a[1], f.side, 'arty', 3, false);
    }
  },
  // 推演 T 秒（或分出胜负）；返回得分
  run(T) {
    const t0 = S.t, Tr = S.train, P = ptByKey(Tr.P), side = S.trainSpec.side, task = S.trainSpec.task;
    while (S.t - t0 < T) {
      for (let i = 0; i < 30; i++) step(1 / 30);
      TRAIN.fire();
      S.over = null;
      const G = (S.bgs || []).find(o => o.id === Tr.G);
      if (task === 'atk' && Tr.capT == null && hqMine(side, P)) Tr.capT = S.t - t0;
      if (!G || G.dead) break;
      if (TRAIN.foePow() <= 0) break;
    }
    return TRAIN.score(T);
  },
  score(T) {
    const Tr = S.train, P = ptByKey(Tr.P), side = S.trainSpec.side, task = S.trainSpec.task;
    const G = (S.bgs || []).find(o => o.id === Tr.G), own = G && !G.dead ? hqRegPow(G).tot : 0, foe = TRAIN.foePow();
    const ol = 1 - own / Math.max(1, Tr.p0), fl = 1 - foe / Math.max(1, Tr.f0);
    let s = 60 * fl - 60 * ol, ok;
    if (task === 'atk') { ok = hqMine(side, P) || (foe <= Tr.f0 * .1 && own > 0); if (ok) s += 100 + 30 * (1 - Math.min(T, Tr.capT ?? T) / T); }
    else { ok = hqMine(side, P) && own > 0; if (ok) s += 100; }
    return { s: +s.toFixed(1), ok, ol: +ol.toFixed(2), fl: +fl.toFixed(2), cap: Tr.capT };
  }
};
