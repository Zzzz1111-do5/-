// 条令符合度评估（Node）：批量无头对局，测双方司令「打得像不像真的」，对照条令目标范围打分
// 用法：node tools/doctrine_eval.js [局数上限] [每局秒数]   （环境变量 FIX='{"…"}' 给战区指定参数，见 theater.js 的 S.thFix）
// 局面：沙盒 AI 对 AI（双方各 5000 点；守方部署方案 × 攻方打法 × 地图）+ 战役普通 / 困难（攻方全自动）；
//   工作进程里 Math.random 换成按种子的随机数发生器（同一局面可复现）；四个进程并行
// 也供训练场调用：require('./doctrine_eval.js').evalJobs(jobs, fix) → 每局 { m 指标, o 结局 }；score(m) → 条令分 0–100
const { fork } = require('child_process');
const path = require('path');
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

if (process.argv[2] === '--worker') {
  const fs = require('fs');
  const { load } = require('./headless.js');
  const g = load();
  g.__run(fs.readFileSync(path.join(__dirname, 'doctrine_scene.js'), 'utf8'));
  const R0 = Math.random;
  process.on('message', job => {
    let r;
    try {
      Math.random = rng(job.rng);
      g.__run(`DOCT.setup(${JSON.stringify(job)})`);
      r = g.__run(`DOCT.run(${job.T})`);
    } catch (e) { r = { err: String(e && e.stack || e).slice(0, 400) }; }
    Math.random = R0;
    process.send({ id: job.id, r });
  });
  return;
}

// —— 条令目标范围：[下限, 上限, 权重, 说明] ——
// 依据（公开资料，按游戏地图比例缩放）：联合登陆战役——火力准备后突击、主攻方向集中优势兵力、第一梯队约三分之二、巩固登陆场后向纵深发展；
// 美军条令（FM 3-90）——攻击要 3:1（筑垒）、机动防御留预备队（机动兵力的 1/9–1/3）、纵深配置、反冲击前火力准备、不零打碎敲；双方步坦协同、防空伞
const BANDS = {
  prep_p: [.7, 1, 2, '攻方冲击前有火力准备的比例'],
  ratio_p: [.6, 1, 2, '攻方冲击时局部兵力比达标（筑垒 3:1、近战地形 2:1、开阔地 1.5:1）的比例'],
  solo_p: [0, .15, 1.5, '攻方零打碎敲（不到一个排的兵力冲击据点）的比例'],
  conc_p: [.55, 1, 1.5, '攻方主攻集中：前沿三分之一宽度内的兵力占比'],
  ech_p: [.2, .4, 1, '攻方梯队：前沿以后 150 外（第二梯队、预备队）的兵力占比'],
  tank_p: [.8, 1, 1, '攻方坦克 80 内有本方步兵的时间占比'],
  aa_p: [.6, 1, 1, '攻方地面兵力在防空伞下的占比'],
  idle_p: [0, .15, 1, '攻方兵力闲置占比'],
  res_e: [.15, .35, 2, '守方判明主攻前（上陆后 4 分钟内）预备队占机动兵力的比例'],
  depth_e: [.3, .55, 1, '守方机动兵力纵深配置（攻方前沿 350 以外）的占比'],
  prep_e: [.6, 1, 1.5, '守方反冲击前有火力准备的比例'],
  ratio_e: [.6, 1, 1.5, '守方反冲击时局部兵力比 2:1 以上的比例'],
  solo_e: [0, .15, 1.5, '守方零打碎敲（不到一个排的兵力反冲击）的比例'],
  tank_e: [.8, 1, 1, '守方坦克 80 内有本方步兵的时间占比'],
  aa_e: [.6, 1, 1, '守方机动兵力在防空伞下的占比'],
  idle_e: [0, .15, 1, '守方机动兵力闲置占比']
};
// 单项符合度：在范围内 1，出范围按偏离量线性扣（偏离 0.3 扣光）
const fit = (v, [lo, hi]) => v == null || isNaN(v) ? null : v < lo ? Math.max(0, 1 - (lo - v) / .3) : v > hi ? Math.max(0, 1 - (v - hi) / .3) : 1;
function score(m, side) {
  let s = 0, w = 0;
  for (const k in BANDS) {
    if (side && !k.endsWith('_' + side)) continue;
    const f = fit(m[k], BANDS[k]);
    if (f == null) continue;
    s += f * BANDS[k][2]; w += BANDS[k][2];
  }
  return w ? +(100 * s / w).toFixed(1) : null;
}

function pool(n) {
  const workers = [], queue = [], wait = new Map();
  for (let i = 0; i < n; i++) {
    const w = fork(__filename, ['--worker'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    w.busy = false;
    w.on('message', m => { w.busy = false; const cb = wait.get(m.id); wait.delete(m.id); cb(m.r); pump(); });
    workers.push(w);
  }
  let jid = 0;
  function pump() { for (const w of workers) if (!w.busy && queue.length) { const j = queue.shift(); w.busy = true; w.send(j); } }
  return {
    run: job => new Promise(res => { const id = ++jid; wait.set(id, res); queue.push({ ...job, id }); pump(); }),
    close: () => workers.forEach(w => w.kill())
  };
}
function defaultJobs(maxN, T) {
  const jobs = [], MAPS = [777, 4242, 9001, 31337, 2024, 555], DS = ['bal', 'armor', 'deep', 'fort'], AS = ['bal', 'armor', 'fire'];
  let r = 1;
  MAPS.forEach((seed, i) => jobs.push({ mode: 'sbx', seed, dsty: DS[i % DS.length], asty: AS[i % AS.length], bud: 5000, T, rng: r++ }));
  for (const [seed, level] of [[11, 'normal'], [22, 'hard'], [33, 'normal'], [44, 'hard']]) jobs.push({ mode: 'pve', seed, level, T, rng: r++ });
  return jobs.slice(0, maxN);
}
async function evalJobs(jobs, fix, nw = 4) {
  const P = pool(Math.min(nw, jobs.length));
  try { return await Promise.all(jobs.map(j => P.run({ ...j, fix: j.fix || fix || null }))); } finally { P.close(); }
}
function summary(rs) {
  const ok = rs.filter(r => r && !r.err), avg = {};
  for (const k of [...Object.keys(BANDS), 'rmed_p', 'rmed_e', 'n_p', 'n_e', 'commit_e']) {
    const v = ok.map(r => r.m[k]).filter(x => x != null && !isNaN(x));
    avg[k] = v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) : null;
  }
  const o = { pts: 0, lp: 0, le: 0 };
  for (const r of ok) for (const k in o) o[k] += r.o[k] / ok.length;
  for (const k in o) o[k] = +o[k].toFixed(3);
  return { avg, o, sp: score(avg, 'p'), se: score(avg, 'e'), s: score(avg), errs: rs.filter(r => r && r.err).map(r => r.err) };
}
module.exports = { BANDS, score, fit, evalJobs, defaultJobs, summary, pool };

if (require.main === module) {
  (async () => {
    const maxN = +(process.argv[2] || 10), T = +(process.argv[3] || 420), fix = process.env.FIX ? JSON.parse(process.env.FIX) : null, t0 = Date.now();
    const jobs = defaultJobs(maxN, T), rs = await evalJobs(jobs, fix);
    rs.forEach((r, i) => { const j = jobs[i]; console.log(`${j.mode} ${j.seed} ${j.dsty || j.level} ${j.asty || ''}`.padEnd(26), r.err ? 'ERR ' + r.err.split('\n')[0] : JSON.stringify(r.o) + ' 条令分 攻 ' + score(r.m, 'p') + ' 守 ' + score(r.m, 'e')); });
    const S = summary(rs);
    console.log('\n指标'.padEnd(10), '均值'.padStart(7), '  目标范围    ', '符合度', ' 说明');
    for (const k in BANDS) { const v = S.avg[k], f = fit(v, BANDS[k]); console.log(k.padEnd(10), String(v).padStart(7), `  [${BANDS[k][0]}, ${BANDS[k][1]}]`.padEnd(14), f == null ? '  -  ' : (100 * f).toFixed(0).padStart(4) + '%', ' ' + BANDS[k][3]); }
    console.log('冲击局部兵力比中位数 攻', S.avg.rmed_p, '守', S.avg.rmed_e, '· 每局冲击次数 攻', S.avg.n_p, '反冲击', S.avg.n_e, '· 守方预备队全部投入用时（上陆后秒）', S.avg.commit_e);
    console.log('结局均值', JSON.stringify(S.o), '· 条令分 攻', S.sp, '守', S.se, '总', S.s, '· 用时', Math.round((Date.now() - t0) / 1000), '秒', S.errs.length ? '· 出错 ' + S.errs.length : '');
  })();
}
