/* =====================================================================
   Game theory: nations play 2×2 strategic games and pick Nash equilibria
   ===================================================================== */
const GAMES = {
  arms: { name: '军备竞赛', kind: '囚徒困境', s: ['裁军', '扩军'], t: ['裁军', '扩军'], note: '无论对方怎么做，扩军对自己都更有利，于是双方都扩军，结果谁也没有更安全。这就是囚徒困境：个体理性导致集体非理性。只有足够耐心、彼此信任的国家，才会因为“未来的报复”而选择合作。' },
  trade: { name: '贸易协定', kind: '囚徒困境', s: ['开放市场', '贸易保护'], t: ['开放市场', '贸易保护'], note: '互相开放对双方都好，单方面保护却能占便宜。重复博弈中，“以牙还牙”的声誉让合作得以维持。' },
  crisis: { name: '边境危机', kind: '懦夫博弈', s: ['让步', '强硬'], t: ['让步', '强硬'], note: '谁先退缩谁就输，双方都不退就是战争。弱者往往被迫让步。当双方都拥有核武器，“双双强硬”的代价高到无法承受，这就是相互确保毁灭带来的恐怖平衡。' },
  alliance: { name: '共同防御', kind: '猎鹿博弈', s: ['结盟', '观望'], t: ['结盟', '观望'], note: '联手才能猎到鹿，单干只能抓兔子。合作的均衡更好，但需要对彼此有信心，否则双方都会选择更安全的观望。' },
  ideology: { name: '意识形态渗透', kind: '不对称博弈', s: ['克制', '输出'], t: ['开放', '封锁'], note: '思想没有国界。输出意识形态能扩大影响，也会招致对方的封锁。开放的社会更容易被渗透，也更富有。' },
  union: { name: '联合谈判', kind: '协调博弈', s: ['合并', '保持独立'], t: ['合并', '保持独立'], note: '统一带来规模与安全，代价是主权。两个都很好的均衡之间如何选择，取决于彼此的信任。' },
};
function trustKey(a, b) { return a < b ? a + ':' + b : b + ':' + a; }
function getTrust(a, b) {
  const k = trustKey(a, b);
  if (S.trust[k] === undefined) S.trust[k] = clamp(0.5 - 0.35 * ideoDist(S.nations[a].ideo, S.nations[b].ideo), 0.05, 0.9);
  return S.trust[k];
}
function addTrust(a, b, d) { const k = trustKey(a, b); S.trust[k] = clamp(getTrust(a, b) + d, 0, 1); }
function patience(n) { return clamp(0.45 + n.mult.coop * 0.8 + (n.mult.gt ? 0.12 : 0) + n.stabV * 0.1, 0.15, 0.93); }
function hasNap(A, B) { return (A.nap && A.nap[B.id] > S.year) || (B.nap && B.nap[A.id] > S.year); }
// pure equilibria plus the interior mixed equilibrium (p = P(row plays 0), q = P(col plays 0))
function solve2(A, B) {
  const pure = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if (A[i][j] >= A[1 - i][j] - 1e-9 && B[i][j] >= B[i][1 - j] - 1e-9) pure.push([i, j]);
  let mixed = null;
  const dq = A[0][0] - A[0][1] - A[1][0] + A[1][1], dp = B[0][0] - B[1][0] - B[0][1] + B[1][1];
  if (Math.abs(dp) > 1e-9 && Math.abs(dq) > 1e-9) {
    const p = (B[1][1] - B[1][0]) / dp, q = (A[1][1] - A[0][1]) / dq;
    if (p > 0 && p < 1 && q > 0 && q < 1) mixed = { p, q };
  }
  return { pure, mixed };
}
function riskProduct(A, B, e) { const [i, j] = e; return (A[i][j] - A[1 - i][j]) * (B[i][j] - B[i][1 - j]); }
function selectEq(type, A, B, sol, trust) {
  if (sol.pure.length === 1) return { pick: sol.pure[0], how: '唯一的纯策略纳什均衡' };
  if (sol.pure.length > 1) {
    const coord = type === 'alliance' || type === 'union';
    if (coord && trust > 0.55) {
      const best = sol.pure.slice().sort((x, y) => (A[y[0]][y[1]] + B[y[0]][y[1]]) - (A[x[0]][x[1]] + B[x[0]][x[1]]))[0];
      return { pick: best, how: '多个均衡，互信足够高，选择对双方都更好的那个（收益占优）' };
    }
    const best = sol.pure.slice().sort((x, y) => riskProduct(A, B, y) - riskProduct(A, B, x))[0];
    return { pick: best, how: coord ? '多个均衡，互信不足，选择风险更小的那个（风险占优）' : '多个均衡，按风险占优选出：更有底气的一方更敢强硬' };
  }
  if (sol.mixed) { const i = rand() < sol.mixed.p ? 0 : 1, j = rand() < sol.mixed.q ? 0 : 1; return { pick: [i, j], how: `没有纯策略均衡，双方按混合策略随机行动（${Math.round(sol.mixed.p * 100)}% / ${Math.round(sol.mixed.q * 100)}% 选择第一项）` }; }
  return { pick: [1, 1], how: '无均衡' };
}
function buildGame(type, a, b, ctx) {
  const A_ = S.nations[a], B_ = S.nations[b];
  const pa = power(A_), pb = power(B_), ra = pa / (pa + pb || 1), dist = ideoDist(A_.ideo, B_.ideo);
  let A, B;
  switch (type) {
    case 'arms': { const ta = dist + (1 - ra) * 0.8, tb = dist + ra * 0.8; A = [[3, -ta], [4 + ta, 1]]; B = [[3, 4 + tb], [-tb, 1]]; break; }
    case 'trade': { const oa = ideoOf(A_).trade + A_.mult.tradeK * 0.4, ob = ideoOf(B_).trade + B_.mult.tradeK * 0.4; A = [[2 + 1.5 * oa, 0.5], [3.3 + (1.4 - oa) * 0.8, 1.5]]; B = [[2 + 1.5 * ob, 3.3 + (1.4 - ob) * 0.8], [0.5, 1.5]]; break; }
    case 'crisis': {
      const v = ctx.v, nukes = deterrent(A_) && deterrent(B_);
      const ca = nukes ? 30 : 1 + 6 * (1 - ra), cb = nukes ? 30 : 1 + 6 * ra;
      A = [[0, -1], [v, v * ra * 1.2 - ca]];
      B = [[0, 0.6], [-v, -cb + v * (1 - ra)]];
      break;
    }
    case 'alliance': { const s = 3 + (ctx.threat || 1), d = dist * 3; A = [[s - d, -1], [1, 1]]; B = [[s - d, 1], [-1, 1]]; break; }
    case 'ideology': { const v = 2.2 * dist * A_.mult.spread; A = [[0, 0], [v, -1]]; B = [[1, -0.4], [1 - 2.4 * dist, -0.8]]; break; }
    case 'union': { const la = pa < pb ? 1.6 : 0.3, lb = pa < pb ? 0.3 : 1.6, g = 3 + A_.mult.unionK + B_.mult.unionK - dist * 4; A = [[g - la, -0.3], [0, 0]]; B = [[g - lb, 0], [-0.3, 0]]; break; }
  }
  // repeated games: patience and trust make future cooperation worth something today
  if (type === 'arms' || type === 'trade') {
    const tr = getTrust(a, b);
    const fa = patience(A_) / (1 - patience(A_)) * tr * (A[0][0] - A[1][1]) * 0.15;
    const fb = patience(B_) / (1 - patience(B_)) * tr * (B[0][0] - B[1][1]) * 0.15;
    A[0][0] += fa; A[0][1] += fa; B[0][0] += fb; B[1][0] += fb;
  }
  const r = x => Math.round(x * 10) / 10;
  return { A: A.map(row => row.map(r)), B: B.map(row => row.map(r)) };
}
function playGame(type, a, b, ctx) {
  ctx = ctx || {};
  const g = buildGame(type, a, b, ctx), sol = solve2(g.A, g.B), tr = getTrust(a, b);
  const sel = selectEq(type, g.A, g.B, sol, tr);
  const rec = { y: S.year, type, a, b, an: S.nations[a].name, bn: S.nations[b].name, ac: S.nations[a].color, bc: S.nations[b].color, A: g.A, B: g.B, pure: sol.pure, mixed: sol.mixed, eq: sel.pick, how: sel.how, ctx, trust: tr };
  if (isPlayer(S.nations[a]) || isPlayer(S.nations[b])) { playerGame(rec); return rec; }
  let [i, j] = sel.pick;
  if (rand() < 0.05) i = 1 - i;
  if (rand() < 0.05) j = 1 - j;
  resolveGame(rec, i, j);
  return rec;
}
function resolveGame(rec, i, j) {
  const A = S.nations[rec.a], Bn = S.nations[rec.b];
  rec.pick = [i, j];
  if (!A || !Bn || !A.alive || !Bn.alive) return;
  const G = GAMES[rec.type];
  let out = '';
  switch (rec.type) {
    case 'arms':
      // arming speeds up the military research track at the expense of civil research, disarming does the opposite
      for (const [n, s] of [[A, i], [Bn, j]]) {
        ensureMil(n);
        if (s === 1) { n.legions += 1.5; if (n.target) n.research -= techCost(n, n.target) * 0.02; if (n.mtarget) n.mresearch += techCost(n, n.mtarget) * 0.04; }
        else { if (n.target) n.research += techCost(n, n.target) * 0.015; if (n.mtarget) n.mresearch = Math.max(0, n.mresearch - techCost(n, n.mtarget) * 0.02); }
      }
      if (i === 0 && j === 0) { addTrust(A.id, Bn.id, 0.1); out = '双方签署裁军条约，把钱花在民生与科研上'; S.stats.coop = (S.stats.coop || 0) + 1; if (deterrent(A) && deterrent(Bn)) S.stats.nukeDisarm = (S.stats.nukeDisarm || 0) + 1; }
      else if (i === 1 && j === 1) { addTrust(A.id, Bn.id, -0.05); out = '军备竞赛升级，双方都在扩军'; S.stats.armsRaces = (S.stats.armsRaces || 0) + 1; }
      else { addTrust(A.id, Bn.id, -0.18); out = `${i === 1 ? A.name : Bn.name}趁对方裁军时扩军，取得军事优势`; }
      break;
    case 'trade':
      if (i === 0 && j === 0) { A.trade[Bn.id] = S.year; Bn.trade[A.id] = S.year; addTrust(A.id, Bn.id, 0.08); out = '双方签订自由贸易协定，科研与粮食产量提高'; S.stats.coop = (S.stats.coop || 0) + 1; }
      else { delete A.trade[Bn.id]; delete Bn.trade[A.id]; addTrust(A.id, Bn.id, i === j ? -0.03 : -0.15); out = i === j ? '双方互设关税，贸易往来中断' : `${i === 1 ? A.name : Bn.name}单方面设置贸易壁垒，对方愤怒`; }
      A.mult = computeMult(A); Bn.mult = computeMult(Bn);
      break;
    case 'crisis': {
      const c = cityById(rec.ctx.city);
      if (i === 1 && j === 0 && c && c.n === Bn.id && Bn.cl.length > 1) { transferCity(c, A, Bn); Bn.warLoss = Math.min(1.2, Bn.warLoss + 0.06); addTrust(A.id, Bn.id, -0.1); out = `${Bn.name}在压力下让步，把${c.name}割让给${A.name}`; log('war', `边境危机：${Bn.name}向${A.name}让步，割让了${c.name}`, c.i, true); }
      else if (i === 1 && j === 1) { S.trust[trustKey(A.id, Bn.id)] = 0.1; out = '双方都拒绝让步，危机升级为战争'; startWar(A.id, Bn.id, false, `${A.name}与${Bn.name}的边境危机升级为战争：双方都拒绝让步`); }
      else if (i === 0 && j === 1) { A.stabV = Math.max(0, A.stabV - 0.03); out = `${A.name}在对方的强硬面前退缩了`; }
      else { addTrust(A.id, Bn.id, 0.06); out = '双方各退一步，维持现状'; if (deterrent(A) && deterrent(Bn)) S.stats.mad = (S.stats.mad || 0) + 1; }
      break;
    }
    case 'alliance':
      if (i === 0 && j === 0) { formAlliance(A.id, Bn.id, `${A.name}与${Bn.name}为应对共同威胁结成同盟`); addTrust(A.id, Bn.id, 0.15); out = '双方结成同盟'; }
      else { addTrust(A.id, Bn.id, i === j ? -0.02 : -0.1); out = i === j ? '双方都选择观望' : `${i === 0 ? A.name : Bn.name}伸出橄榄枝，对方却按兵不动`; }
      break;
    case 'ideology': {
      const I = ideoOf(A);
      if (i === 1 && j === 0) { Bn.push = Bn.push || {}; Bn.push[A.ideo] = (Bn.push[A.ideo] || 0) + 0.9 * (0.4 + ideoDist(A.ideo, Bn.ideo)); addTrust(A.id, Bn.id, -0.06); out = `${I.name}思想在${Bn.name}广泛传播`; S.stats.ideoExports = (S.stats.ideoExports || 0) + 1; }
      else if (i === 1 && j === 1) { Bn.stabV = Math.min(1, Bn.stabV + 0.02); addTrust(A.id, Bn.id, -0.08); out = `${Bn.name}封锁了${A.name}的宣传，国内反而更团结`; }
      else if (j === 1) { out = `${Bn.name}实行言论管控，付出了自由的代价`; }
      else { addTrust(A.id, Bn.id, 0.04); out = '双方互不干涉，文化交流正常进行'; }
      break;
    }
    case 'union':
      if (i === 0 && j === 0) { const big = power(A) >= power(Bn) ? A : Bn, small = big === A ? Bn : A; out = `${small.name}与${big.name}经公投合并`; annexNation(big, small, `${small.name}与${big.name}经全民公投和平合并为一个国家`, true); S.stats.unions = (S.stats.unions || 0) + 1; }
      else { addTrust(A.id, Bn.id, -0.03); out = '合并谈判破裂，双方保持独立'; }
      break;
  }
  rec.out = out;
  S.games.unshift(rec);
  if (S.games.length > 40) S.games.length = 40;
  gameVersion++;
}
function transferCity(c, to, from) {
  c.n = to.id; c.cap = false; c.origin = from.id; c.capturedAt = S.year;
  from.cl = from.cl.filter(x => x !== c); to.cl.push(c);
  c.lay = null;
  S.terrDirty = true;
}
let gameVersion = 0;
function chooseGameType(A, B, len) {
  if (atWar(A.id, B.id) || realmOf(A.id) === realmOf(B.id) || A.overlord >= 0 || B.overlord >= 0) return null;
  const pa = power(A), pb = power(B), strong = pa >= pb ? A : B, weak = strong === A ? B : A, ratio = Math.max(pa, pb) / Math.max(1, Math.min(pa, pb));
  const tr = getTrust(A.id, B.id), dist = ideoDist(A.ideo, B.ideo), era = Math.min(A.mult.era, B.mult.era);
  const greed = strong.ambition * ideoOf(strong).aggr * Math.min(3, ratio) * (1 + dist);
  if (len > 0 && !hasNap(A, B) && greed > 1.5 && rand() < 0.55) {
    const pr = nearestPair(weak, strong);
    if (pr && pr.d < 9 && weak.cl.length > 1) return ['crisis', strong, weak, { city: pr.c.id, v: 1 + Math.min(3, Math.log10(pr.c.pop / 1e5 + 1) * 1.5) }];
  }
  if (A.ideo === B.ideo && tr > 0.58 && era >= 5 && rand() < 0.25 + (A.mult.unionK + B.mult.unionK) * 0.15) return ['union', A, B, {}];
  if (dist > 0.3 && rand() < 0.4) { const ex = A.mult.spread * ideoOf(A).spread >= B.mult.spread * ideoOf(B).spread ? A : B; return ['ideology', ex, ex === A ? B : A, {}]; }
  const common = enemiesOf(A.id).filter(e => enemiesOf(B.id).includes(e) || (S.nations[e] && power(S.nations[e]) > Math.max(pa, pb)));
  if (common.length && !allied(A.id, B.id)) return ['alliance', A, B, { threat: 1.5 }];
  if (era >= 3 && rand() < 0.5) return ['arms', A, B, {}];
  if (era >= 1) return ['trade', A, B, {}];
  return null;
}
function gameTick() {
  const alive = S.nations.filter(n => n.alive && n.cl.length);
  if (alive.length < 2) return;
  const cand = S.borders.map(([a, b, len]) => [a, b, len]);
  const gp = alive.slice().sort((x, y) => power(y) - power(x)).slice(0, 4);
  for (let i = 0; i < gp.length; i++) for (let j = i + 1; j < gp.length; j++) cand.push([gp[i].id, gp[j].id, 0]);
  for (let k = cand.length - 1; k > 0; k--) { const r = (rand() * (k + 1)) | 0; [cand[k], cand[r]] = [cand[r], cand[k]]; }
  let played = 0;
  const maxGames = S.flags.maxEra < 2 ? 1 : 2;
  for (const [a, b, len] of cand) {
    if (played >= maxGames) break;
    const A = S.nations[a], Bn = S.nations[b];
    if (!A || !Bn || !A.alive || !Bn.alive) continue;
    const key = trustKey(a, b);
    if ((S.gcd[key] || -1e9) > S.year) continue;
    const involvesPlayer = isPlayer(A) || isPlayer(Bn);
    if (involvesPlayer && (modalOpen || (S.player.gcd || -1e9) > S.year)) continue;
    const g = chooseGameType(A, Bn, len);
    if (!g) continue;
    S.gcd[key] = S.year + Math.round(8 * (S.flags.maxEra < 4 ? 4 : 1));
    if (involvesPlayer) S.player.gcd = S.year + secYears(25);
    playGame(g[0], g[1].id, g[2].id, g[3]);
    played++;
  }
}
