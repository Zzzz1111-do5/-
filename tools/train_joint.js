// 司令—旅—团联合训练场（Node）：node tools/train_joint.js [轮数，默认 1] [候选数，默认 6]
// 训练「上下级怎么配合」：司令的编旅、调旅由司令训练场（tools/train_cmd.js）先训好，这里在整局 AI 对 AI 的推演里，
//   按坐标轮换（一次只动一级、其他级固定在当前最好的）依次训练——
//   ① 旅：攻击出发位置多远、第二梯队跟多近、等齐同时发起最多等多久、第一梯队打到几成换第二梯队、防御纵深（jointdoc.js BDE_DOC）；
//   ② 团：边打边撤每跃多远、多久叫一次火力、什么时候脱离接触、离主力多近算汇合（jointdoc.js SA_DOC）；
//   双方各训各的（守方的参数按守方得分、攻方的按攻方得分），一级训完再训下一级，轮数 > 1 时再从旅开始复训一遍（上下级互相适应）。
// 每一级的训练方法同司令训练场：同一局面分支比较（地图 × 守方部署 × 攻方打法 × 随机数种子，各候选完全相同）、逐轮淘汰、冠军变异复赛、
//   稳健打分（平均 − 0.4 × 标准差）；守擂：挑战者在配对局里至少赢现行参数六成、稳健分也更高才换，不因为噪声乱改。
// 每局结果缓存（断点续训）；结果写进 js/jointdoc.js，过程记在 docs/joint_train.md
const { fork } = require('child_process');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

if (process.argv[2] === '--worker') {
  const { load } = require('./headless.js');
  const g = load();
  g.__run(fs.readFileSync(path.join(__dirname, 'train_jointscene.js'), 'utf8'));
  const R0 = Math.random;
  process.on('message', job => {
    let r;
    try {
      Math.random = rng(job.rng);
      g.__run(`TJ.setup(${JSON.stringify(job)})`);
      r = g.__run(`TJ.run(${job.T})`);
    } catch (e) { r = { err: String(e && e.stack || e).slice(0, 300) }; }
    Math.random = R0;
    process.send({ id: job.id, r });
  });
  return;
}

const SPACE = {
  bde: { atk: [260, 340, 420], fol: [300, 420, 560], sync: [30, 60, 90], pass: [.3, .4, .55], dep: [180, 260, 360] },
  sa: { bound: [80, 110, 150], fire: [8, 12, 18], brk: [.35, .5, .7], link: [200, 260, 340] }
};
const MAPS = [777, 4242, 9001, 31337, 2024, 555, 8080, 1234, 4321, 6060];
const DST = ['bal', 'armor', 'fort'], ATK = ['bal', 'armor', 'fire'];
const BUD = 5000, T = 360;

const pickR = (a, r) => a[Math.floor(r() * a.length)];
const keyOf = (lv, d) => JSON.stringify(Object.keys(SPACE[lv]).map(k => d[k]));

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
// 断点续训：结果按「局面 + 全部候选参数 + 代码指纹（js/ 源码哈希，训练结果 jointdoc.js 本身除外）」缓存
const CACHE = process.env.TJ_CACHE || path.join(ROOT, 'tools', '.cache', 'train_joint.json');
const FP = require('crypto').createHash('sha1').update(fs.readdirSync(path.join(ROOT, 'js')).filter(f => f !== 'jointdoc.js').sort().map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n')).digest('hex').slice(0, 12);
let cache = {};
try { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (c.fp === FP) cache = c.r || {}; } catch (e) { /* 没有缓存 */ }
const cacheSave = () => { try { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify({ fp: FP, r: cache })); } catch (e) { console.error('缓存写不进去', e.message); } };
const runJob = job => {
  const k = JSON.stringify(job);
  if (cache[k]) return Promise.resolve(cache[k]);
  return new Promise(res => { const id = ++jid; wait.set(id, r => { if (r && !r.err) { cache[k] = r; cacheSave(); } res(r); }); queue.push({ ...job, id }); pump(); });
};
console.log(`代码指纹 ${FP}，缓存里已有 ${Object.keys(cache).length} 局`);

const scene = i => ({ seed: MAPS[i % MAPS.length], dsty: DST[i % DST.length], asty: ATK[Math.floor(i / 3) % ATK.length], bud: BUD, rng: 3000 + i * 7919, T });
const stat = (C, idx) => { const v = idx.map(i => C.sc[i]).filter(x => x != null); if (!v.length) return { m: -999, sd: 0, n: 0, rob: -999 }; const m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); return { m, sd, n: v.length, rob: m - .4 * sd }; };

(async () => {
  const passes = +(process.argv[2] || 1), NC = +(process.argv[3] || 6);
  const docPath = path.join(ROOT, 'js', 'jointdoc.js'), repPath = path.join(ROOT, 'docs', 'joint_train.md');
  const read = () => { const src = fs.readFileSync(docPath, 'utf8'), get = nm => Function('return ' + src.match(new RegExp(`const ${nm} = (\\{[\\s\\S]*?\\n\\});`))[1])(); return { src, bde: get('BDE_DOC'), sa: get('SA_DOC') }; };
  const write = cur => {
    let src = fs.readFileSync(docPath, 'utf8');
    const fmt = o => `{\n  e: ${JSON.stringify(o.e).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')},\n  p: ${JSON.stringify(o.p).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')}\n}`;
    src = src.replace(/const BDE_DOC = \{[\s\S]*?\n\};/, `const BDE_DOC = ${fmt(cur.bde)};`).replace(/const SA_DOC = \{[\s\S]*?\n\};/, `const SA_DOC = ${fmt(cur.sa)};`);
    fs.writeFileSync(docPath, src);
  };
  const cur = read(), t0 = Date.now(), r = rng(20261027), report = [];
  const NM = { bde: '旅（协同）', sa: '团（边打边撤）' }, SN = { e: '守方', p: '攻方' };
  for (let pass = 0; pass < passes; pass++) for (const lv of ['bde', 'sa']) for (const side of ['e', 'p']) {
    // 候选：现行参数 + 随机抽样；其余各级、对方都固定在现行参数
    const fixOf = d => ({ bde: { ...cur.bde, [side]: lv === 'bde' ? d : cur.bde[side] }, sa: { ...cur.sa, [side]: lv === 'sa' ? d : cur.sa[side] } });
    const evalOn = async (C, idx) => {
      const rs = await Promise.all(idx.map(i => runJob({ ...scene(i), fix: fixOf(C.d) })));
      for (const [n, x] of rs.entries()) { if (x && !x.err && x[side] != null) { C.sc[idx[n]] = x[side]; C.raw[idx[n]] = x; } else if (x && x.err) console.error('  错误', x.err); }
    };
    const cands = [{ d: { ...cur[lv][side] }, sc: {}, raw: {}, inc: true }];
    while (cands.length < NC) { const d = Object.fromEntries(Object.keys(SPACE[lv]).map(q => [q, pickR(SPACE[lv][q], r)])); if (!cands.some(c => keyOf(lv, c.d) === keyOf(lv, d))) cands.push({ d, sc: {}, raw: {} }); }
    let alive = cands.slice(), used = pass * 6;   // 复训时换一批新局面
    const rounds = [2, 2, 2], base = used;
    for (const [ri, nAdd] of rounds.entries()) {
      const idx = Array.from({ length: nAdd }, (_, j) => used + j); used += nAdd;
      if (ri === rounds.length - 1) {
        const best = alive[0], muts = [];
        while (muts.length < 2) { const d = { ...best.d }; const q = pickR(Object.keys(SPACE[lv]), r); d[q] = pickR(SPACE[lv][q], r); if (![...alive, ...muts].some(c => keyOf(lv, c.d) === keyOf(lv, d))) muts.push({ d, sc: {}, raw: {}, mut: true }); }
        await Promise.all(muts.map(C => evalOn(C, Array.from({ length: used - nAdd - base }, (_, j) => base + j))));
        alive = alive.concat(muts);
      }
      await Promise.all(alive.map(C => evalOn(C, idx)));
      const all = Array.from({ length: used - base }, (_, j) => base + j);
      alive.sort((a, b) => stat(b, all).rob - stat(a, all).rob);
      console.log(`${NM[lv]} ${SN[side]} 第 ${ri + 1} 轮：` + alive.map(C => `${JSON.stringify(C.d).replace(/"/g, '')} ${stat(C, all).rob.toFixed(1)}${C.inc ? '（现行）' : C.mut ? '*' : ''}`).join(' | ') + `  ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
      if (ri < rounds.length - 1) { alive = alive.slice(0, Math.max(2, Math.ceil(alive.length / 2))); if (!alive.includes(cands[0])) alive.push(cands[0]); }   // 现行参数一直留着当擂主
    }
    const all = Array.from({ length: used - base }, (_, j) => base + j), inc = cands[0], best = alive[0];
    const wins = all.filter(i => best.sc[i] != null && inc.sc[i] != null && best.sc[i] > inc.sc[i]).length, sb = stat(best, all), si = stat(inc, all);
    const take = best !== inc && wins >= all.length * .6 && sb.rob > si.rob;
    if (take) { cur[lv][side] = { ...best.d }; write(cur); }
    report.push({ lv, side, d: cur[lv][side], take, sb, si, wins, n: all.length });
    console.log(`${NM[lv]} ${SN[side]}：${take ? `换成 ${JSON.stringify(best.d)}（配对胜 ${wins}/${all.length}，稳健分 ${si.rob.toFixed(1)} → ${sb.rob.toFixed(1)}）` : `保持现行（最好的挑战者配对胜 ${wins}/${all.length}）`}`);
  }
  const prev = fs.existsSync(repPath) ? fs.readFileSync(repPath, 'utf8') : '';
  const head = `# 司令—旅—团联合训练记录\n\n由 \`node tools/train_joint.js\` 生成。司令的编旅、调旅先由司令训练场训好；这里在整局 AI 对 AI 推演里按坐标轮换训练旅的协同参数（\`js/jointdoc.js\` BDE_DOC）与团边打边撤的参数（SA_DOC），双方各按自己的得分训练。\n` +
    `每个局面 = 地图 × 守方部署 × 攻方打法 × 随机数种子（各候选完全相同，配对比较）；逐轮淘汰 2、2、2 个新局面，最后一轮加冠军的 2 个变异；挑战者配对胜现行六成以上、稳健分也更高才换。每局 ${T} 秒，双方各 ${BUD} 点。\n\n`;
  const tab = `## ${new Date().toISOString().slice(0, 10)}\n\n| 级 | 方 | 结果 | 参数 | 稳健分（现行 → 冠军） | 冠军配对胜现行 |\n| --- | --- | --- | --- | --- | --- |\n` +
    report.map(o => `| ${NM[o.lv]} | ${SN[o.side]} | ${o.take ? '更新' : '保持'} | ${JSON.stringify(o.d).replace(/"/g, '')} | ${o.si.rob.toFixed(1)} → ${o.sb.rob.toFixed(1)} | ${o.wins}/${o.n} |`).join('\n') + '\n\n';
  fs.writeFileSync(repPath, head + tab + prev.replace(/^# 司令—旅—团联合训练记录[\s\S]*?\n\n(?=## )/, ''));
  for (const w of workers) w.kill();
})();
