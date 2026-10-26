// 司令训练场（Node）：node tools/train_cmd.js [编成键过滤：inf / mech / armor] [每个编成的候选数]
// 训练守方司令的两件事：把手上的机动兵力编成几个旅（几个旅、坦克集中还是分散、留不留战役预备队、用什么战术），
//   以及怎么调派各旅（多快判明敌主攻方向、各旅同时反冲击还是梯次投入）。参数见 js/cmddoc.js
// 训练方法（又快又可靠）：
//   ① 同一局面分支比较：每个「局面」= 地图种子 × 攻方打法 × 随机数种子；同一局面里每个候选司令的部署、对手、随机数完全相同
//      （工作进程里 Math.random 换成按种子的随机数发生器），分数差只来自司令的决策，配对比较噪声小，几局就分得出好坏；
//   ② 逐轮淘汰（successive halving）：先让所有候选各打几个局面，淘汰后一半，剩下的再加新局面，算力集中在有希望的候选上；
//      最后围绕冠军做小改动（变异）再复赛一轮，避免只在随机抽样里挑；
//   ③ 稳健打分：每局按「时间平均守住的据点（按分值）+ 最后守住的据点 + 敌损失 − 我损失」打分，候选的总分取「平均 − 0.4 × 标准差」，
//      不要偶尔大胜、经常大败的打法；
//   ④ 多地图、多种攻方打法（均衡、装甲突击、火力先导），四个进程并行，局面分出胜负就提前结束
// 结果写进 js/cmddoc.js 的 CMD_DOC，过程记在 docs/cmd_train.md；每局结果缓存在 tools/.cache/（断点续训，见 runJob）
const { fork } = require('child_process');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

// 按种子的随机数发生器（mulberry32）
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

if (process.argv[2] === '--worker') {
  const { load } = require('./headless.js');
  const g = load();
  g.__run(fs.readFileSync(path.join(__dirname, 'train_cmdscene.js'), 'utf8'));
  const R0 = Math.random;
  process.on('message', job => {
    let r;
    try {
      Math.random = rng(job.rng);   // 共同随机数：同一局面里各候选的随机数序列相同
      g.__run(`CMDT.setup(${JSON.stringify(job)})`);
      r = g.__run(`CMDT.run(${job.T})`);
    } catch (e) { r = { err: String(e && e.stack || e).slice(0, 300) }; }
    Math.random = R0;
    process.send({ id: job.id, r });
  });
  return;
}

const SPACE = { tac: ['bal', 'armor', 'fort', 'deep'], nb: [0, 1, 2, 3], mass: [0, 1], resv: [0, 1], det: ['fast', 'mid', 'slow'], ctr: ['all', 'echelon'] };
// 编成键 → 用来摆出这种编成的部署方案（攻方的部署由 AI 按打法摆）
const KEYS = { inf: ['fort'], mech: ['bal', 'deep'], armor: ['armor'] };
const MAPS = [777, 4242, 9001, 31337, 2024, 555, 8080, 1234, 4321, 6060, 7171, 9999];
const ATK = ['bal', 'armor', 'fire'];
const BUD = 5000, T = 360;

const pickR = (a, r) => a[Math.floor(r() * a.length)];
const keyOf = d => JSON.stringify(Object.keys(SPACE).map(k => d[k]));
const base = { tac: null, nb: 0, mass: 0, resv: 0, det: 'mid', ctr: 'echelon' };

// —— 工作进程池 ——
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
// 断点续训：每局结果按「局面 + 战法 + 代码指纹（js/ 源码的哈希，训练结果 cmddoc.js 本身除外）」记进缓存文件，进程被打断后重跑时已打过的局直接取结果；代码改了指纹变，旧结果自动作废
const CACHE = process.env.CMDT_CACHE || path.join(ROOT, 'tools', '.cache', 'train_cmd.json');
const FP = require('crypto').createHash('sha1').update(fs.readdirSync(path.join(ROOT, 'js')).filter(f => f !== 'cmddoc.js').sort().map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n')).digest('hex').slice(0, 12);
let cache = {};
try { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (c.fp === FP) cache = c.r || {}; } catch (e) { /* 没有缓存 */ }
let cacheDirty = 0;
const cacheSave = () => { try { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify({ fp: FP, r: cache })); cacheDirty = 0; } catch (e) { console.error('缓存写不进去', e.message); } };
const runJob = job => {
  const k = JSON.stringify(job);
  if (cache[k]) return Promise.resolve(cache[k]);
  return new Promise(res => { const id = ++jid; wait.set(id, r => { if (r && !r.err) { cache[k] = r; if (++cacheDirty >= 1) cacheSave(); } res(r); }); queue.push({ ...job, id }); pump(); });
};
console.log(`代码指纹 ${FP}，缓存里已有 ${Object.keys(cache).length} 局`);

// 局面：编成键 k 的第 i 个局面（地图、部署方案、攻方打法、随机数种子都由 i 决定，各候选共用）
function scene(k, i) { const ds = KEYS[k][i % KEYS[k].length]; return { seed: MAPS[i % MAPS.length], dsty: ds, asty: ATK[Math.floor(i / 2) % ATK.length], rng: 1000 + i * 7919, bud: BUD, T }; }
async function evalOn(C, k, idx) {
  const rs = await Promise.all(idx.map(i => runJob({ ...scene(k, i), doc: C.d })));
  for (const [n, r] of rs.entries()) { if (r && !r.err && r.s != null) C.sc[idx[n]] = r; else if (r && r.err) console.error('  错误', r.err); }
}
const stat = (C, idx) => { const v = idx.map(i => C.sc[i]).filter(Boolean).map(r => r.s); if (!v.length) return { m: -999, sd: 0, n: 0, rob: -999 }; const m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); return { m, sd, n: v.length, rob: m - .4 * sd }; };

(async () => {
  const filt = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null, NC = +(process.argv[3] || 10);
  const docPath = path.join(ROOT, 'js', 'cmddoc.js'), repPath = path.join(ROOT, 'docs', 'cmd_train.md');
  const old = fs.readFileSync(docPath, 'utf8');
  const table = {};
  { const m = old.match(/const CMD_DOC = (\{[\s\S]*?\});\n/); if (m) Object.assign(table, Function('return ' + m[1])()); }
  const report = [], t0 = Date.now(), r = rng(20261025);
  for (const k of Object.keys(KEYS)) {
    if (filt && k !== filt) continue;
    const tk = 'e|' + k;
    // 候选：现在的打法（未训练的默认）+ 表里已有的 + 随机抽样
    const cands = [{ d: { ...base }, sc: {} }];
    if (table[tk]) cands.push({ d: { ...base, ...table[tk] }, sc: {} });
    while (cands.length < NC) { const d = Object.fromEntries(Object.keys(SPACE).map(q => [q, pickR(SPACE[q], r)])); if (!cands.some(c => keyOf(c.d) === keyOf(d))) cands.push({ d, sc: {} }); }
    // 逐轮淘汰：每轮新加局面、留前一半；最后一轮加冠军的变异
    let alive = cands, used = 0;
    const rounds = [2, 3, 3];
    for (const [ri, nAdd] of rounds.entries()) {
      const idx = Array.from({ length: nAdd }, (_, j) => used + j); used += nAdd;
      if (ri === rounds.length - 1) {   // 最后一轮：冠军的三个变异也参赛，补打之前所有局面
        const best = alive[0], muts = [];
        while (muts.length < 3) { const d = { ...best.d }; for (let n = 0; n < 2; n++) { const q = pickR(Object.keys(SPACE), r); d[q] = pickR(SPACE[q], r); } if (![...alive, ...muts].some(c => keyOf(c.d) === keyOf(d))) muts.push({ d, sc: {}, mut: true }); }
        await Promise.all(muts.map(C => evalOn(C, k, Array.from({ length: used - nAdd }, (_, j) => j))));
        alive = alive.concat(muts);
      }
      await Promise.all(alive.map(C => evalOn(C, k, idx)));
      const all = Array.from({ length: used }, (_, j) => j);
      alive.sort((a, b) => stat(b, all).rob - stat(a, all).rob);
      console.log(`${tk} 第 ${ri + 1} 轮（${used} 个局面）：` + alive.map(C => { const s = stat(C, all); return `${s.rob.toFixed(1)}(${s.m.toFixed(1)}±${s.sd.toFixed(1)})${C.mut ? '*' : ''}`; }).join(' ') + `  ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
      if (ri < rounds.length - 1) alive = alive.slice(0, Math.max(2, Math.ceil(alive.length / 2)));
    }
    const all = Array.from({ length: used }, (_, j) => j), best = alive[0], bs = stat(best, all), b0 = cands[0], s0 = stat(b0, all);
    const wins = all.filter(i => best.sc[i] && b0.sc[i] && best.sc[i].s > b0.sc[i].s).length;
    table[tk] = Object.fromEntries(Object.keys(SPACE).map(q => [q, best.d[q]]));
    report.push({ k: tk, d: table[tk], rob: bs.rob, m: bs.m, sd: bs.sd, n: bs.n, base: s0.n === bs.n ? s0 : null, wins, held: all.map(i => best.sc[i] && best.sc[i].held).filter(x => x != null) });
    console.log(`${tk} 冠军 ${JSON.stringify(table[tk])}  稳健分 ${bs.rob.toFixed(1)}（均分 ${bs.m.toFixed(1)}）  默认 ${s0.n ? s0.m.toFixed(1) : '-'}  配对胜 ${wins}/${all.length}`);
    // 每个编成训完就落盘
    const body = Object.entries(table).sort().map(([kk, d]) => `  '${kk}': ${JSON.stringify(d).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ').replace(/"/g, "'")}`).join(',\n');
    fs.writeFileSync(docPath, old.replace(/const CMD_DOC = \{[\s\S]*?\};\n/, `const CMD_DOC = {\n${body}\n};\n`));
  }
  const NM = { inf: '步兵为主', mech: '步坦合成', armor: '装甲为主' }, TN = { bal: '纵深防御、机动反击', armor: '装甲机动防御', fort: '要塞固守、逐次反击', deep: '诱敌深入、两翼合围' }, DN = { fast: '快', mid: '中', slow: '慢' };
  const lines = report.map(o => { const d = o.d; return `| ${NM[o.k.split('|')[1]]} | ${TN[d.tac] || '按兵力自动'} | ${d.nb || '自动'} | ${d.mass ? '集中' : '分散到各团'} | ${d.resv ? '留' : '不留'} | ${DN[d.det]} | ${d.ctr === 'all' ? '各旅同时' : '梯次投入'} | ${o.rob.toFixed(1)}（${o.m.toFixed(1)} ± ${o.sd.toFixed(1)}） | ${o.base ? o.base.m.toFixed(1) : '-'} | ${o.wins}/${o.n} |`; });
  if (lines.length) {
    const prev = fs.existsSync(repPath) ? fs.readFileSync(repPath, 'utf8') : '';
    const head = `# 司令训练记录\n\n由 \`node tools/train_cmd.js\` 生成。训练守方司令怎么把机动兵力编成旅、怎么调派各旅（参数见 \`js/cmddoc.js\`）。\n` +
      `每个局面 = 地图 × 攻方打法 × 随机数种子，同一局面里各候选的部署、对手、随机数完全相同（配对比较）；逐轮淘汰：${'2、3、3'} 个新局面三轮，最后一轮加冠军的 3 个变异。\n` +
      `每局 ${T} 秒，双方各 ${BUD} 点；得分 = 60 × 时间平均守住的据点比例 + 40 × 最后守住的比例 + 40 × 敌损失比例 − 30 × 我损失比例；候选取「平均 − 0.4 × 标准差」。\n\n`;
    const tab = `## ${new Date().toISOString().slice(0, 10)}\n\n| 机动兵力 | 战术 | 旅数 | 坦克 | 预备队 | 判明主攻 | 反击 | 稳健分（均分 ± 标准差） | 默认打法均分 | 配对胜过默认 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${lines.join('\n')}\n\n`;
    fs.writeFileSync(repPath, head + tab + prev.replace(/^# 司令训练记录[\s\S]*?\n\n(?=## )/, ''));
  }
  for (const w of workers) w.kill();
})();
