// 实战化司令训练场（Node）：node tools/train_real.js [p|e|both] [候选数]
// 训练战区司令（theater.js）的条令参数 TH_DOC：打分 = 一半胜负 + 一半条令符合度（tools/doctrine_eval.js 的 BANDS），
//   不只练「怎么赢」，还要「像真的那样打」——光按输赢练会练出不留预备队、不打火力准备直接冲之类真实指挥官不会用的打法
// 方法（同 train_cmd.js）：同一局面（地图 × 部署方案 × 打法 × 随机数种子）里各候选配对比较；逐轮淘汰（每轮加新局面、淘汰后一半）；
//   最后围绕冠军做小改动再比一轮。双方轮流练：先练攻方（守方用现行参数），再练守方（攻方用刚练出的参数）
// 结果：打印各轮排名，冠军写进 docs/real_train.md；TH_DOC 由人按结果更新（不自动改源码）
const fs = require('fs'), path = require('path');
const { score, pool } = require('./doctrine_eval.js');
const POOL = pool(Math.max(1, Math.min(4, require('os').cpus().length)));   // 一个进程池跑到底，每局带自己的参数
const ROOT = path.resolve(__dirname, '..');

const SPACE = {
  p: { ech: [0, .15, .25, .33], adv: [1.2, 1.5, 2, 2.5], prep: [0, 8, 15, 25] },
  e: { res: [0, .15, .25, .35], ctr: [1.5, 2, 2.5, 3], prep: [0, 8, 15], commit: [1.2, 1.5, 2], det: [15, 30, 45] }
};
const DEF = { p: { ech: .25, adv: 1.5, prep: 12 }, e: { res: .25, ctr: 2, prep: 12, commit: 1.5, det: 30 } };
const T = +(process.env.T || 480);

// 局面：沙盒 AI 对 AI（双方各 5000 点）与战役（普通 / 困难），按序号确定
const MAPS = [777, 4242, 9001, 31337, 2024, 555, 8080, 1234, 4321, 6060, 7171, 9999, 2468, 1357, 8642];
const DS = ['bal', 'armor', 'deep', 'fort'], AS = ['bal', 'armor', 'fire'];
function scene(i) {
  if (i % 4 === 3) return { mode: 'pve', seed: 100 + i, level: i % 8 === 3 ? 'normal' : 'hard', T, rng: 7000 + i };
  return { mode: 'sbx', seed: MAPS[i % MAPS.length], dsty: DS[i % DS.length], asty: AS[(i >> 2) % AS.length], bud: 5000, T, rng: 7000 + i };
}
// 胜负分（攻方角度，0–100）：夺取的据点分值、双方损失；守方取 100 − 它
const winP = o => Math.max(0, Math.min(100, 50 + 60 * o.pts + 40 * (o.le - o.lp) + (o.over === 'win' ? 15 : o.over === 'lose' ? -15 : 0)));
function grade(r, side) {
  if (!r || r.err) return null;
  const w = side === 'p' ? winP(r.o) : 100 - winP(r.o), d = score(r.m, side);
  return { w, d, s: .5 * w + .5 * (d ?? 50) };
}
const keyOf = c => JSON.stringify(c);
const pickR = a => a[Math.floor(Math.random() * a.length)];
const cache = new Map();   // 候选 × 局面 → 成绩
async function play(side, cands, other, scenes) {
  const jobs = [], refs = [];
  for (const c of cands) for (const si of scenes) {
    const k = keyOf(c) + '|' + keyOf(other) + '|' + si;
    if (cache.has(k)) continue;
    jobs.push({ ...scene(si), fix: side === 'p' ? { p: c, e: other } : { p: other, e: c } }); refs.push({ k, c, si });
  }
  if (jobs.length) { const rs = await Promise.all(jobs.map(j => POOL.run(j))); rs.forEach((r, i) => cache.set(refs[i].k, r)); }
  return cands.map(c => {
    const gs = scenes.map(si => grade(cache.get(keyOf(c) + '|' + keyOf(other) + '|' + si), side)).filter(Boolean);
    const m = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), s = gs.map(g => g.s), mu = m(s), sd = Math.sqrt(m(s.map(v => (v - mu) ** 2)));
    return { c, n: gs.length, s: +(mu - .4 * sd).toFixed(1), mu: +mu.toFixed(1), w: +m(gs.map(g => g.w)).toFixed(1), d: +m(gs.map(g => g.d ?? 50)).toFixed(1) };
  });
}
async function train(side, other, nC) {
  const S = SPACE[side], seen = new Set(), cands = [];
  const add = c => { const k = keyOf(c); if (!seen.has(k)) { seen.add(k); cands.push(c); } };
  add({ ...DEF[side] });
  while (cands.length < nC) add(Object.fromEntries(Object.keys(S).map(k => [k, pickR(S[k])])));
  let alive = cands, scenes = [], next = side === 'p' ? 0 : 40;
  const log = [];
  for (const [nNew, keep] of [[3, .5], [3, .5], [3, 1]]) {
    for (let i = 0; i < nNew; i++) scenes.push(next++);
    const t0 = Date.now(), rk = (await play(side, alive, other, scenes)).sort((a, b) => b.s - a.s);
    console.log(`\n${side === 'p' ? '攻方' : '守方'} 第 ${log.length + 1} 轮：${alive.length} 个候选 × ${scenes.length} 局（${Math.round((Date.now() - t0) / 1000)} 秒）`);
    rk.forEach(r => console.log(String(r.s).padStart(6), `均分 ${r.mu} 胜负 ${r.w} 条令 ${r.d}`, JSON.stringify(r.c)));
    log.push(rk);
    alive = rk.slice(0, Math.max(2, Math.ceil(rk.length * keep))).map(r => r.c);
  }
  // 冠军附近的小改动再比一轮
  const champ = alive[0], mut = [];
  for (const k of Object.keys(S)) { const i = S[k].indexOf(champ[k]); for (const j of [i - 1, i + 1]) if (j >= 0 && j < S[k].length) mut.push({ ...champ, [k]: S[k][j] }); }
  const fin = (await play(side, [champ, alive[1], ...mut.slice(0, 6)].filter(Boolean), other, scenes)).sort((a, b) => b.s - a.s);
  console.log(`\n${side === 'p' ? '攻方' : '守方'} 决赛（冠军与变异）：`);
  fin.forEach(r => console.log(String(r.s).padStart(6), `均分 ${r.mu} 胜负 ${r.w} 条令 ${r.d}`, JSON.stringify(r.c)));
  const def = fin.find(r => keyOf(r.c) === keyOf(DEF[side])) || (await play(side, [DEF[side]], other, scenes))[0];
  return { best: fin[0], def, scenes: scenes.length };
}

(async () => {
  const which = process.argv[2] || 'both', nC = +(process.argv[3] || 10), t0 = Date.now(), out = [];
  let P = { ...DEF.p }, E = { ...DEF.e };
  if (which === 'p' || which === 'both') { const r = await train('p', E, nC); P = r.best.c; out.push(['p', r]); }
  if (which === 'e' || which === 'both') { const r = await train('e', P, nC); E = r.best.c; out.push(['e', r]); }
  const md = [`\n## ${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}（每局 ${T} 秒，用时 ${Math.round((Date.now() - t0) / 60000)} 分钟）\n`,
    '| 方 | 冠军参数 | 稳健分 | 胜负分 | 条令分 | 现行默认参数的稳健分 / 胜负 / 条令 | 局数 |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const [side, r] of out) md.push(`| ${side === 'p' ? '攻方' : '守方'} | \`${keyOf(r.best.c)}\` | ${r.best.s} | ${r.best.w} | ${r.best.d} | ${r.def.s} / ${r.def.w} / ${r.def.d} | ${r.scenes} |`);
  const f = path.join(ROOT, 'docs/real_train.md');
  if (!fs.existsSync(f)) fs.writeFileSync(f, '# 实战化司令训练记录\n\n由 `node tools/train_real.js` 生成。训练战区司令（js/theater.js 的 TH_DOC）：打分 = 一半胜负 + 一半条令符合度（tools/doctrine_eval.js 的 BANDS）；同一局面配对比较、逐轮淘汰，候选取「平均 − 0.4 × 标准差」。\n');
  fs.appendFileSync(f, md.join('\n') + '\n');
  console.log('\n结果', JSON.stringify({ p: P, e: E }), '已记入 docs/real_train.md');
  POOL.close();
  process.exit(0);
})();
