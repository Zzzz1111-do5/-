// 团长战法训练（Node）：node tools/train_reg.js [局面过滤，如 atk|mech] [每个局面候选数]
// 每个局面（命令 × 本团编成 × 敌情）：先随机抽一批打法，每种在几张图、几个据点、攻守双方各打一局；取平均分最好的几种，
// 再围绕最好的那种做小改动，换一批地图复赛；冠军写进 js/doctrine.js 的 DOCTRINE，过程记在 docs/doctrine_train.md
// 打分（tools/train_scene.js TRAIN.score）：完成任务 +100（进攻越快越多，最多再 +30）+ 歼敌比例 × 60 − 自损比例 × 60
const { fork } = require('child_process');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

if (process.argv[2] === '--worker') {
  const { load } = require('./headless.js');
  const g = load();
  g.__run(fs.readFileSync(path.join(__dirname, 'train_scene.js'), 'utf8'));
  process.on('message', job => {
    let r;
    try {
      const ok = g.__run(`TRAIN.setup(${JSON.stringify(job.spec)})`);
      r = ok ? g.__run(`TRAIN.run(${job.T})`) : null;
    } catch (e) { r = { err: String(e).slice(0, 200) }; }
    process.send({ id: job.id, r });
  });
  return;
}

const FORM = ['line', 'wedge', 'vee', 'echL', 'echR'], ARM = ['front', 'mixed', 'rear'];
const SPACE = {
  atk: { form: FORM, arm: ARM, wid: [.7, 1, 1.4], bound: [0, 1], pace: [.6, .8, 1], prep: [0, 15, 30], flank: [0, .25, .34], press: [1, 1.3, 1.8], ret: [.3, .5, .7] },
  def: { arm: ARM, wid: [.7, 1, 1.4], press: [1.2, 1.6, 2.4], ret: [.3, .5, .7], depth: [0, .25, .4] }
};
const SIT = [];
for (const own of ['inf', 'mech', 'armor']) for (const foe of ['inf', 'armor', 'mixed', 'fort']) SIT.push(['atk', own, foe]);
for (const own of ['inf', 'mech', 'armor']) for (const foe of ['inf', 'mixed', 'armor']) SIT.push(['def', own, foe]);   // 来攻之敌：步兵团 / 机步团（步坦合成）/ 装甲团
const MAPS = [[777, 0], [777, 1], [4242, 0], [4242, 2], [9001, 1], [9001, 3], [31337, 0], [31337, 2], [2024, 1], [2024, 4]];
const T = 300;

const pickR = a => a[Math.floor(Math.random() * a.length)];
const rand = task => Object.fromEntries(Object.entries(SPACE[task]).map(([k, v]) => [k, pickR(v)]));
function mutate(task, d) {
  const o = { ...d }, ks = Object.keys(SPACE[task]);
  for (let n = 0; n < 2; n++) { const k = pickR(ks); o[k] = pickR(SPACE[task][k]); }
  return o;
}
const keyOf = d => JSON.stringify(Object.keys(d).sort().map(k => [k, d[k]]));

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
const runJob = (spec) => new Promise(res => { const id = ++jid; wait.set(id, res); queue.push({ id, spec, T }); pump(); });

async function evalDoc(task, own, foe, doc, maps) {
  const jobs = maps.map(([seed, pt], i) => {
    const side = foe === 'fort' ? 'p' : i % 2 ? 'e' : 'p';   // 工事只有守方（敌）有：打工事总是攻方
    return runJob({ seed, pt, task, own, foe, side, doc });
  });
  const rs = (await Promise.all(jobs)).filter(r => r && !r.err && r.s != null);
  if (!rs.length) return { s: -999, n: 0 };
  return { s: rs.reduce((a, r) => a + r.s, 0) / rs.length, ok: rs.filter(r => r.ok).length / rs.length, ol: rs.reduce((a, r) => a + r.ol, 0) / rs.length, fl: rs.reduce((a, r) => a + r.fl, 0) / rs.length, n: rs.length };
}

(async () => {
  const filt = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null, NC = +(process.argv[3] || 14);
  const docPath = path.join(ROOT, 'js', 'doctrine.js'), repPath = path.join(ROOT, 'docs', 'doctrine_train.md');
  const old = fs.readFileSync(docPath, 'utf8');
  const table = {};
  { const m = old.match(/const DOCTRINE = (\{[\s\S]*?\});\n/); if (m) Object.assign(table, Function('return ' + m[1])()); }
  const report = [];
  const t0 = Date.now();
  for (const [task, own, foe] of SIT) {
    const k = `${task}|${own}|${foe}`;
    if (filt && !k.includes(filt)) continue;
    // 第一轮：现有冠军 + 默认 + 随机，每种 4 局
    const base = Object.fromEntries(Object.keys(SPACE[task]).map(q => [q, ({ form: 'line', arm: 'mixed', wid: 1, bound: 0, pace: .8, prep: 0, flank: 0, press: 1.3, ret: .5, depth: .25 })[q]]));
    const cands = [base, ...(table[k] ? [table[k]] : [])];
    while (cands.length < NC) { const c = rand(task); if (!cands.some(o => keyOf(o) === keyOf(c))) cands.push(c); }
    const m1 = MAPS.slice(0, 4);
    let res = await Promise.all(cands.map(async d => ({ d, ...(await evalDoc(task, own, foe, d, m1)) })));
    res.sort((a, b) => b.s - a.s);
    // 第二轮：前 3 + 冠军的 6 个变体，换 6 张图复赛（与第一轮合并计分）
    const top = res.slice(0, 3), mut = [];
    while (mut.length < 6) { const c = mutate(task, top[0].d); if (![...top, ...mut].some(o => keyOf(o.d || o) === keyOf(c))) mut.push(c); }
    const m2 = MAPS.slice(4);
    const r2 = await Promise.all([...top.map(o => o.d), ...mut].map(async d => ({ d, ...(await evalDoc(task, own, foe, d, m2)) })));
    const merged = r2.map(o => { const a = top.find(t => keyOf(t.d) === keyOf(o.d)); return a ? { ...o, s: (a.s * 4 + o.s * 6) / 10, ok: (a.ok * 4 + o.ok * 6) / 10 } : o; }).sort((a, b) => b.s - a.s);
    const best = merged[0];
    table[k] = best.d;
    const bl = res.find(o => keyOf(o.d) === keyOf(base));
    report.push({ k, best: best.d, s: +best.s.toFixed(1), ok: +(best.ok * 100).toFixed(0), base: bl ? +bl.s.toFixed(1) : null, baseOk: bl ? +(bl.ok * 100).toFixed(0) : null });
    console.log(`${k}  冠军 ${best.s.toFixed(1)}（成功 ${(best.ok * 100).toFixed(0)}%）  默认 ${bl ? bl.s.toFixed(1) : '-'}  ${JSON.stringify(best.d)}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    // 每个局面训完就落盘，中途停下也不丢
    const body = Object.entries(table).sort().map(([kk, d]) => `  '${kk}': ${JSON.stringify(d).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ').replace(/"/g, "'")}`).join(',\n');
    fs.writeFileSync(docPath, old.replace(/const DOCTRINE = \{[\s\S]*?\};\n/, `const DOCTRINE = {\n${body}\n};\n`));
  }
  // 报告
  const NM = { atk: '进攻', def: '防御', inf: '步兵', mech: '机步', armor: '装甲', mixed: '步坦合成', fort: '工事' };
  const FN = { line: '横队', wedge: '楔形', vee: '倒楔形', echL: '左梯形', echR: '右梯形', front: '坦克在前', mixed: '步坦交错', rear: '坦克在后' };
  const lines = report.map(r => { const [t, o, f] = r.k.split('|'), d = r.best; return `| ${NM[t]} | ${NM[o]}团 | ${NM[f] || f} | ${d.form ? FN[d.form] + '、' : ''}${FN[d.arm]}、正面 ×${d.wid}${d.bound ? '、交替跃进' : ''}${d.prep ? `、火力准备 ${d.prep} 秒` : ''}${d.flank ? `、${Math.round(d.flank * 100)}% 迂回` : ''}${d.depth != null ? `、纵深 ${Math.round(d.depth * 100)}%` : ''}、压上 ${d.press}、后撤 ${d.ret} | ${r.s}（${r.ok}%） | ${r.base ?? '-'}（${r.baseOk ?? '-'}%） |`; });
  if (lines.length) {
    const prev = fs.existsSync(repPath) ? fs.readFileSync(repPath, 'utf8') : '';
    const head = `# 团长战法训练记录\n\n由 \`node tools/train_reg.js\` 生成：每个局面先随机抽 ${NC} 种打法各打 4 局，前 3 名与冠军的 6 个变体再换 6 张图复赛，取综合分最高的写进 \`js/doctrine.js\`。\n` +
      `每局 ${T} 秒；得分 = 完成任务 100（进攻越快越多，最多再加 30）+ 歼敌比例 × 60 − 自损比例 × 60。括号里是任务完成率。\n\n`;
    const tab = `## ${new Date().toISOString().slice(0, 10)}\n\n| 命令 | 本团 | 敌情 | 训练出的打法 | 得分（完成率） | 默认打法得分 |\n| --- | --- | --- | --- | --- | --- |\n${lines.join('\n')}\n\n`;
    fs.writeFileSync(repPath, head + tab + prev.replace(/^# 团长战法训练记录[\s\S]*?\n\n(?=## )/, ''));
  }
  for (const w of workers) w.kill();
})();
