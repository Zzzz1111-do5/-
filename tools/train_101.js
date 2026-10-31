// 101 空降师训练场（Node）：node tools/train_101.js [候选数]
// 训练守方第 101 空降师战斗群的打法（js/a101.js A101_TAC，态势感知见 js/sa.js）：
//   agg 有效兵力比到多少就跃进—掩护压上去（顺风）· ret 低于多少就交替掩护撤退、向主力靠拢（逆风）· pick 敌集团超过本群几倍就不去硬碰、转去加强己方据点
// 方法同司令训练场（tools/train_cmd.js）：同一局面分支比较（地图 × 攻方打法 × 攻方兵力强弱 × 随机数种子，各候选完全相同）、
//   逐轮淘汰 + 冠军变异复赛、稳健打分（平均 − 0.4 × 标准差）、四个进程并行、每局结果缓存（断点续训）。
//   局面里攻方兵力分三档（弱 / 相当 / 强），101 的打法要在顺风、均势、逆风里都打得好，不只会一种
// 结果写进 js/a101.js 的 A101_TAC，过程记在 docs/a101_train.md
const { fork } = require('child_process');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

if (process.argv[2] === '--worker') {
  const { load } = require('./headless.js');
  const g = load();
  g.__run(fs.readFileSync(path.join(__dirname, 'train_101scene.js'), 'utf8'));
  const R0 = Math.random;
  process.on('message', job => {
    let r;
    try {
      Math.random = rng(job.rng);
      g.__run(`T101.setup(${JSON.stringify(job)})`);
      r = g.__run(`T101.run(${job.T})`);
    } catch (e) { r = { err: String(e && e.stack || e).slice(0, 300) }; }
    Math.random = R0;
    process.send({ id: job.id, r });
  });
  return;
}

const SPACE = { agg: [1, 1.25, 1.5, 1.8], ret: [.5, .65, .75, .9], pick: [.9, 1.3, 1.8, 2.5] };
const MAPS = [777, 4242, 9001, 31337, 2024, 555, 8080, 1234];
const ATK = ['bal', 'armor', 'fire'], ABUD = [3500, 5000, 7000];   // 攻方兵力：弱（101 顺风）、相当、强（逆风）
const BUD = 4500, T = 330, DROP = 140;

const pickR = (a, r) => a[Math.floor(r() * a.length)];
const keyOf = d => JSON.stringify(Object.keys(SPACE).map(k => d[k]));

const NW = Math.max(1, Math.min(4, require('os').cpus().length));
const workers = [], queue = [], wait = new Map();
let jid = 0;
for (let i = 0; i < NW; i++) {
  const w = fork(__filename, ['--worker'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  w.busy = false;
  w.on('message', m => { w.busy = false; const cb = wait.get(m.id); wait.delete(m.id); cb(m.r); pump(); });
  workers.push(w);
}
function pump() { for (const w of workers) if (!w.busy && queue.length) { const j = queue.shift(); w.busy = true; w.send(j); } }
// 断点续训：结果按「局面 + 打法 + 代码指纹（js/ 源码哈希，训练结果所在的 a101.js 里 A101_TAC 一行除外）」缓存
const CACHE = process.env.T101_CACHE || path.join(ROOT, 'tools', '.cache', 'train_101.json');
const FP = require('crypto').createHash('sha1').update(fs.readdirSync(path.join(ROOT, 'js')).sort().map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8').replace(/const A101_TAC = .*\n/, '')).join('\n')).digest('hex').slice(0, 12);
let cache = {};
try { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (c.fp === FP) cache = c.r || {}; } catch (e) { /* 没有缓存 */ }
const cacheSave = () => { try { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify({ fp: FP, r: cache })); } catch (e) { console.error('缓存写不进去', e.message); } };
const runJob = job => {
  const k = JSON.stringify(job);
  if (cache[k]) return Promise.resolve(cache[k]);
  return new Promise(res => { const id = ++jid; wait.set(id, r => { if (r && !r.err) { cache[k] = r; cacheSave(); } res(r); }); queue.push({ ...job, id }); pump(); });
};
console.log(`代码指纹 ${FP}，缓存里已有 ${Object.keys(cache).length} 局`);

// 局面 i：地图、攻方打法、攻方兵力档、随机数都由 i 决定（三档兵力轮流出现）
const scene = i => ({ seed: MAPS[i % MAPS.length], dsty: 'bal', asty: ATK[Math.floor(i / 3) % ATK.length], abud: ABUD[i % ABUD.length], bud: BUD, drop: DROP, rng: 2000 + i * 7919, T });
async function evalOn(C, idx) {
  const rs = await Promise.all(idx.map(i => runJob({ ...scene(i), tac: C.d })));
  for (const [n, r] of rs.entries()) { if (r && !r.err && r.s != null) C.sc[idx[n]] = r; else if (r && r.err) console.error('  错误', r.err); }
}
const stat = (C, idx) => { const v = idx.map(i => C.sc[i]).filter(Boolean).map(r => r.s); if (!v.length) return { m: -999, sd: 0, n: 0, rob: -999 }; const m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); return { m, sd, n: v.length, rob: m - .4 * sd }; };
const avg = (C, idx, k) => { const v = idx.map(i => C.sc[i]).filter(Boolean).map(r => r[k] || 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };

(async () => {
  const NC = +(process.argv[2] || 8);
  const srcPath = path.join(ROOT, 'js', 'a101.js'), repPath = path.join(ROOT, 'docs', 'a101_train.md');
  const src = fs.readFileSync(srcPath, 'utf8'), m0 = src.match(/const A101_TAC = (\{.*?\});/);
  const cur = m0 ? Function('return ' + m0[1])() : { agg: 1.25, ret: .75, pick: 1.3 };
  const t0 = Date.now(), r = rng(20261026);
  const cands = [{ d: { ...cur }, sc: {} }, { d: { agg: 1, ret: .35, pick: 99 }, sc: {}, old: true }];   // 现在的打法、旧参数（硬拼到三成半才撤、什么敌人都敢打）
  while (cands.length < NC) { const d = Object.fromEntries(Object.keys(SPACE).map(q => [q, pickR(SPACE[q], r)])); if (!cands.some(c => keyOf(c.d) === keyOf(d))) cands.push({ d, sc: {} }); }
  let alive = cands.slice(), used = 0;
  const rounds = [3, 3, 3];
  for (const [ri, nAdd] of rounds.entries()) {
    const idx = Array.from({ length: nAdd }, (_, j) => used + j); used += nAdd;
    if (ri === rounds.length - 1) {
      const best = alive[0], muts = [];
      while (muts.length < 3) { const d = { ...best.d }; const q = pickR(Object.keys(SPACE), r); d[q] = pickR(SPACE[q], r); if (![...alive, ...muts].some(c => keyOf(c.d) === keyOf(d))) muts.push({ d, sc: {}, mut: true }); }
      await Promise.all(muts.map(C => evalOn(C, Array.from({ length: used - nAdd }, (_, j) => j))));
      alive = alive.concat(muts);
    }
    await Promise.all(alive.map(C => evalOn(C, idx)));
    const all = Array.from({ length: used }, (_, j) => j);
    alive.sort((a, b) => stat(b, all).rob - stat(a, all).rob);
    console.log(`第 ${ri + 1} 轮（${used} 个局面）：` + alive.map(C => { const s = stat(C, all); return `${JSON.stringify(C.d).replace(/"/g, '')} ${s.rob.toFixed(1)}(${s.m.toFixed(1)}±${s.sd.toFixed(1)})${C.mut ? '*' : C.old ? '旧' : ''}`; }).join(' | ') + `  ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
    if (ri < rounds.length - 1) { alive = alive.slice(0, Math.max(2, Math.ceil(alive.length / 2))); if (!alive.includes(cands[1])) alive.push(cands[1]); }   // 旧参数一直留着当对照
  }
  const all = Array.from({ length: used }, (_, j) => j), best = alive[0], bs = stat(best, all), b0 = cands[1], s0 = stat(b0, all);
  const wins = all.filter(i => best.sc[i] && b0.sc[i] && best.sc[i].s > b0.sc[i].s).length;
  fs.writeFileSync(srcPath, src.replace(/const A101_TAC = \{.*?\};/, `const A101_TAC = { agg: ${best.d.agg}, ret: ${best.d.ret}, pick: ${best.d.pick} };`));
  console.log(`冠军 ${JSON.stringify(best.d)}  稳健分 ${bs.rob.toFixed(1)}（均分 ${bs.m.toFixed(1)}）  旧参数 ${s0.n ? s0.m.toFixed(1) : '-'}  配对胜 ${wins}/${all.length}`);
  // 分档看：顺风 / 均势 / 逆风各自的得分与 101 存活
  const tier = k => all.filter(i => scene(i).abud === ABUD[k]);
  const row = (C, nm) => `| ${nm} | ${C.d.agg} | ${C.d.ret} | ${C.d.pick} | ${[0, 1, 2].map(k => { const s = stat(C, tier(k)); return `${s.m.toFixed(1)}（存活 ${Math.round(avg(C, tier(k), 'surv') * 100)}%）`; }).join(' | ')} | ${stat(C, all).rob.toFixed(1)} | ${avg(C, all, 'delay').toFixed(1)} / ${avg(C, all, 'link').toFixed(1)} / ${avg(C, all, 'cover').toFixed(1)} |`;
  const prev = fs.existsSync(repPath) ? fs.readFileSync(repPath, 'utf8') : '';
  const head = `# 101 空降师训练记录\n\n由 \`node tools/train_101.js\` 生成。训练第 101 空降师战斗群的打法（\`js/a101.js\` A101_TAC；态势感知与边打边撤见 \`js/sa.js\`）。\n` +
    `每个局面 = 地图 × 攻方打法 × 攻方兵力（${ABUD.join(' / ')} 点，守方 ${BUD} 点）× 随机数种子，同一局面里各候选完全相同（配对比较）；逐轮淘汰 3、3、3 个新局面，最后一轮加冠军的 3 个变异。\n` +
    `开战 ${DROP} 秒空降，每局 ${T} 秒；得分 = 45 × 攻方损失比例 + 25 × 时间平均守住的据点 + 25 × 最后守住的据点 + 35 × 101 存活比例；候选取「平均 − 0.4 × 标准差」。\n\n`;
  const tab = `## ${new Date().toISOString().slice(0, 10)}\n\n| | agg 压上 | ret 撤退 | pick 不碰 | 顺风（攻方弱） | 均势 | 逆风（攻方强） | 稳健分 | 每局边打边撤 / 与主力汇合 / 占有利地形 次数 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${row(best, '冠军')}\n${row(b0, '旧参数（硬拼）')}\n\n配对胜过旧参数 ${wins}/${all.length} 局。\n\n`;
  fs.writeFileSync(repPath, head + tab + prev.replace(/^# 101 空降师训练记录[\s\S]*?\n\n(?=## )/, ''));
  for (const w of workers) w.kill();
})();
