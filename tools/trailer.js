// 宣传片（66 秒，1080p）：跟着游戏自己的进行曲剪——固定 120 拍、一小节 2 秒，换幕和切镜头都在重拍上
//   开场（氛围乐）桌上的兵推沙盘 → 第一幕 先夺制海权（航母、舰队、空袭岸防）→ 第二幕 再强行登陆（抢滩、滩头交火）
//   → 第三幕 向纵深推进（纵深激战、战线、AI 指挥官通联）→ 内容一览（图鉴、闯关、部署）→ 高潮 → 片尾标志（胜利号角）
// 画面：同一局（固定地图与随机数）逐帧推演、逐帧截图。推演和画面的随机数分开存：画画用掉的随机数不影响战局，
//   所以先不画画「侦察」一遍，记下每个时刻爆炸落在哪、部队在哪，再正式渲染时镜头就能对准，每次生成都一样
// 声音：渲染时让游戏自己的音效系统按每一帧的镜头判断该响什么（声像、远近），只记下来；录音时按剪辑时间线回放，叠在进行曲上
// 用法：NODE_PATH=$(npm root -g) node tools/trailer.js [输出目录，默认 store/video] [步骤，默认 shots,audio,edit]
//   需要 Playwright 与 ffmpeg；没有显卡的机器上约一个半小时（逐帧渲染占大半）；输出 trailer_1080p.mp4（不进仓库）
//   调试：ONLY=A,B 只渲染这几个镜头，FROM=30 FRAMES=8 每个镜头只渲染从第 30 帧起的 8 帧（不推演跳过的帧），SCOUT=reuse 用上次的侦察结果
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { ROOT, LAUNCH, sleep, boot, battle } = require('./store_assets.js');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'store', 'video'));
const STEPS = (process.argv[3] || 'shots,audio,edit').split(',');
const FPS = 30, LEN = 66, PRE = 1;   // 帧率、片长（秒）；录音提前 1 秒开录，前面放一声对齐用的哔
const SHOT_DIR = path.join(OUT, 'trailer_shots'), SFX = path.join(OUT, 'trailer_sfx.json');
const lerp = (a, b, u) => a + (b - a) * u, ease = u => u * u * (3 - 2 * u), clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// —— 分镜 ——（at 片中起点秒、dur 时长、T 开拍时的推演秒数，推演 2 倍速；tg 对准什么：table 沙盘中心、cv 航母、fleet 舰队、
//   ships 舰艇最密的一群、land 登陆部队最密处、boom 本镜头时段里炸得最集中处、landing 部队刚上岸的地方；hud 显示界面；card 字幕卡；flash 开头一闪；booms 安排的爆炸；
//   fire 真实爆炸放大一些、隔几帧在旁边再炸一团——S.fx 在推演里只计时、清理，不影响战局）
const C = (kick, title, sub, at, out, pos) => ({ kick, title, sub, at, out, pos: pos || 'left' });
const SHOTS = [
  { id: 'A', at: 0, dur: 6, T: 24, tg: 'table', cam: [[12500, -1.5708, -1.18], [7200, -1.42, -0.92]], card: C('COMMAND POST // SANDTABLE', '一张兵推沙盘', '一场完整的两栖登陆战', 1.2, 5.3), fadeIn: .9 },
  { id: 'B', at: 6, dur: 4, T: 36, tg: 'cv', cam: [[460, -2.3, -0.30], [330, -1.75, -0.22]], card: C('PHASE 01 // SEA CONTROL', '先夺制海权', '航母舰载机 · 驱逐舰 · 战区航空兵', .15, 3.7), flash: true },
  { id: 'D', at: 14, dur: 4, T: 102, tg: 'boom', fire: true, cam: [[820, -1.32, -0.44], [640, -1.18, -0.40]] },
  { id: 'C', at: 10, dur: 4, T: 150, tg: 'ships', ahead: 250, cam: [[760, -1.62, -0.17], [560, -1.50, -0.20]] },
  { id: 'E', at: 18, dur: 4, T: 188, tg: 'fleet', hud: true, cam: [[2600, -1.48, -0.78], [2150, -1.36, -0.72]] },
  { id: 'F', at: 22, dur: 4, T: 200, tg: 'landing', cam: [[520, -1.75, -0.20], [380, -1.55, -0.25]], card: C('PHASE 02 // ASSAULT', '再强行登陆', '抢滩，夺取登陆场', .15, 3.7), flash: true },
  { id: 'G', at: 26, dur: 4, T: 232, tg: 'boom', fire: true, cam: [[420, -0.95, -0.34], [330, -1.35, -0.36]] },
  { id: 'H', at: 30, dur: 4, T: 275, tg: 'boom', fire: true, cam: [[460, -1.95, -0.30], [360, -1.65, -0.28]] },
  { id: 'I', at: 34, dur: 4, T: 300, tg: 'land', hud: true, cam: [[1300, -1.2, -0.62], [1080, -1.05, -0.58]] },
  { id: 'J', at: 38, dur: 4, T: 358, tg: 'boom', fire: true, cam: [[430, -1.38, -0.36], [340, -1.08, -0.33]], card: C('PHASE 03 // DEPTH', '向纵深推进', '战区 → 师 → 团 → 营 逐级指挥', .15, 3.7), flash: true },
  { id: 'K', at: 42, dur: 4, T: 398, tg: 'land', hud: true, cam: [[3300, -1.5708, -1.02], [2700, -1.5708, -0.88]] },
  { id: 'L', at: 46, dur: 4, T: 410, tg: 'land', hud: true, chat: true, cam: [[1250, -1.0, -0.55], [1050, -1.2, -0.55]], card: C('AI COMMANDERS', '会打仗的 AI', '按条令打仗，还会在通联里跟你汇报', .2, 3.8, 'mid') },
  { id: 'N', at: 54, dur: 4, T: 380, tg: 'boom', fire: true, cam: [[400, -1.18, -0.24], [300, -1.36, -0.27]], flash: true, booms: [0, .5, 1, 1.5, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5] },
  { id: 'O', at: 58, dur: 8, T: 428, tg: 'land', end: true },
  // 内容一览：最后拍（会换掉战局）
  { id: 'M1', at: 50, dur: 4 / 3, ui: 'codex', card: C('ORDER OF BATTLE', '156 种兵力', '', .05, 1.3, 'low') },
  { id: 'M2', at: 50 + 4 / 3, dur: 4 / 3, ui: 'campaign', card: C('CAMPAIGN', '三章十关', '', .05, 1.3, 'low') },
  { id: 'M3', at: 50 + 8 / 3, dur: 4 / 3, ui: 'deploy', card: C('SANDBOX', '自由部署 · 攻守对抗', '', .05, 1.3, 'low') }
];

// 页面里的字幕卡、遮罩、闪白（游戏开始界面的字体与辉光；字先乱码再定格，和开始界面的解码效果一样）
const OVERLAY_CSS = `
#trShade, #trFlash { position: fixed; inset: 0; z-index: 98; pointer-events: none; opacity: 0; }
#trFlash { z-index: 99; background: #e8fff0; }
#trCard { position: fixed; z-index: 100; pointer-events: none; color: #3dff8a; opacity: 0; }
#trCard .k { font: 15px "Silkscreen", monospace; letter-spacing: .5em; color: rgba(198, 247, 216, .82); }
#trCard .t { font: 700 66px/1.15 "Noto Sans SC", sans-serif; letter-spacing: .12em; margin-top: 12px; white-space: nowrap;
  text-shadow: 0 0 20px rgba(61, 255, 138, .6), 0 0 2px rgba(216, 255, 232, .85); }
#trCard .r { height: 2px; margin-top: 16px; background: linear-gradient(90deg, #3dff8a, rgba(61, 255, 138, 0)); box-shadow: 0 0 10px #3dff8a; }
#trCard .s { font: 400 24px "Noto Sans SC", sans-serif; letter-spacing: .22em; color: rgba(214, 255, 228, .9); margin-top: 16px; white-space: nowrap; }
#trCard.logo { left: 50% !important; top: 47% !important; text-align: center; display: flex; flex-direction: column; align-items: center; }
#trCard.logo .t { order: 1; } #trCard.logo .k { order: 2; margin-top: 18px; } #trCard.logo .r { order: 3; } #trCard.logo .s { order: 4; }
#trCard.logo .t { font-size: 150px; letter-spacing: .16em; margin-right: -.16em; }
#trCard.logo .k { font-size: 30px; letter-spacing: .62em; margin-right: -.62em; color: rgba(214, 255, 228, .9); }
#trCard.logo .r { margin: 22px auto 0; background: linear-gradient(90deg, rgba(61, 255, 138, 0), #3dff8a, rgba(61, 255, 138, 0)); }
#trCard.logo .s { font-size: 28px; letter-spacing: .4em; margin-right: -.4em; margin-top: 30px; }
body.trChat #chat { box-shadow: 0 0 0 2px #3dff8a, 0 0 32px rgba(61, 255, 138, .55) !important; }
body.trClean > :not(#stage):not(#trShade):not(#trFlash):not(#trCard):not(script):not(style), body.trClean #stage > :not(#cv) { visibility: hidden !important; }
#pauseBand { display: none !important; }`;
function overlayState(sh, t) {   // 本镜头第 t 秒的字幕卡、遮罩、闪白、黑场
  const st = { flash: 0, black: 0, shade: 0, card: null };
  if (sh.flash) st.flash = [.6, .32, .12][Math.round(t * FPS)] || 0;
  if (sh.fadeIn) st.black = clamp(1 - t / sh.fadeIn, 0, 1);
  const c = sh.card;
  if (c) {
    const a = clamp((t - c.at) / .3, 0, 1) * clamp((c.out - t) / .3, 0, 1);
    if (a > 0) st.card = { ...c, a, rev: clamp((t - c.at) / .55, 0, 1), rule: ease(clamp((t - c.at - .1) / .5, 0, 1)), slide: (1 - ease(clamp((t - c.at) / .4, 0, 1))) * -24 };
    st.shade = c.pos === 'left' ? a * .9 : c.pos === 'low' ? a * .8 : a * .55;
  }
  if (sh.end) {   // 片尾：镜头拉高到整张沙盘，压暗，标志解码出现，再出「即将上线」，最后黑场
    st.shade = .82 * ease(clamp((t - 1.4) / 1.6, 0, 1));
    if (t > 2) st.card = { pos: 'logo', kick: 'DARKSWORD', title: '暗剑', sub: t > 3.4 ? '即将上线　Steam · TapTap' : '', a: clamp((t - 2) / .4, 0, 1), rev: clamp((t - 2) / .8, 0, 1), rule: ease(clamp((t - 2.4) / .7, 0, 1)), slide: 0, subA: clamp((t - 3.4) / .5, 0, 1) };
    st.black = clamp((t - 7.1) / .9, 0, 1);
  }
  return st;
}

// —— 侦察：不画画推演一遍，记下舰队、航母、登陆部队与每一发爆炸 ——
async function scout(b) {
  const p = await boot(b, 1280, 720);
  await p.evaluate(PAGE_FNS);
  await battle(p, 0);
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; }); await sleep(1500);   // 已排上的那一帧跑完（暂停中，不推演）
  const last = Math.max(...SHOTS.filter(s => s.T).map(s => s.T + s.dur * 2)) + 2;
  const r = await p.evaluate(last => {
    __seed(13);   // 渲染时推演也从这个随机数开始：两遍战局一模一样
    const seen = new WeakSet(), samp = [], booms = [], avg = A => A.length ? [A.reduce((a, q) => a + q.x, 0) / A.length, A.reduce((a, q) => a + q.y, 0) / A.length] : null;
    let i = 0;
    while (S.t < last && !S.over) {
      step(1 / 30); i++;
      for (const f of S.fx) if (f.kind === 'boom' && !seen.has(f)) { seen.add(f); booms.push([S.t, f.x, f.y, f.r]); }
      if (i % 15 === 0) samp.push({ t: S.t, land: window.__land(), fleet: avg(S.ships.filter(s => !s.dead)), cv: S.cv && !S.cv.dead ? [S.cv.x, S.cv.y] : null });
    }
    return { samp, booms };
  }, last);
  await p.close();
  return r;
}
async function scoutSaved(b) {
  console.log('侦察推演…');
  const sc = await scout(b);
  fs.writeFileSync(path.join(OUT, 'trailer_scout.json'), JSON.stringify(sc));
  for (let t = 0; t < sc.samp[sc.samp.length - 1].t; t += 10) {   // 每 10 秒：爆炸数、中心、登陆部队位置——选镜头时间时看
    const B = sc.booms.filter(q => q[0] >= t && q[0] < t + 10), s = sc.samp.find(q => q.t >= t + 9.9);
    console.log(`${String(t).padStart(3)}–${t + 10} 秒：爆炸 ${String(B.length).padStart(2)}${B.length ? ' 在 ' + [B.reduce((a, q) => a + q[1], 0) / B.length, B.reduce((a, q) => a + q[2], 0) / B.length].map(Math.round) : ''}；登陆部队 ${s && s.land ? s.land.map(Math.round) : '-'}；舰队 ${s && s.fleet ? s.fleet.map(Math.round) : '-'}`);
  }
  return sc;
}
// 页面里的取景函数（侦察与渲染共用，不用随机数）
const PAGE_FNS = () => {
  const avg = A => A.length ? [A.reduce((a, q) => a + q.x, 0) / A.length, A.reduce((a, q) => a + q.y, 0) / A.length] : null;
  window.__land = () => {   // 登陆部队最密的一团
    const U = [...(S.veh || []).filter(v => v.side === 'p' && !v.dead && isLand(v.x, v.y)), ...S.teams.filter(q => q.side === 'p' && q.men.length && isLand(q.x, q.y))];
    const near = q => U.filter(o => dist(o.x, o.y, q.x, q.y) < 240), b = U.reduce((a, q) => !a || near(q).length > near(a).length ? q : a, null);
    return b ? avg(near(b)) : null;
  };
  window.__fleet = () => avg(S.ships.filter(s => !s.dead));
  window.__ships = reset => {   // 舰艇最密的一群（舰队分成几群时平均位置落在空海上）：开拍时选定这几艘，之后一直跟着，中途不换群
    if (reset || !window.__grp) { const A = S.ships.filter(s => !s.dead), near = q => A.filter(o => dist(o.x, o.y, q.x, q.y) < 300), c = A.reduce((a, q) => !a || near(q).length > near(a).length ? q : a, null); window.__grp = c ? near(c) : []; }
    return avg(window.__grp.filter(s => !s.dead));
  };
  window.__cvp = () => S.cv && !S.cv.dead ? [S.cv.x, S.cv.y] : window.__fleet();
};

// 本镜头的固定取景点（boom、landing 用侦察记录；其余逐帧跟着走）
function staticTarget(sh, sc, W, H) {
  if (sh.tg === 'table') return [W / 2, H / 2 + 300];
  if (sh.tg === 'boom') {   // 炸得最集中的一团（几处同时在炸时不能取总平均：会落在两处中间的空地上）
    const B = sc.booms.filter(([t]) => t >= sh.T && t <= sh.T + sh.dur * 2), wt = A => A.reduce((a, q) => a + q[3], 0);
    const near = p => B.filter(q => Math.hypot(q[1] - p[1], q[2] - p[2]) < 320), c = B.reduce((a, q) => !a || wt(near(q)) > wt(near(a)) ? q : a, null);
    if (c) { const A = near(c), w = wt(A); return [A.reduce((a, q) => a + q[1] * q[3], 0) / w, A.reduce((a, q) => a + q[2] * q[3], 0) / w]; }
  }
  if (sh.tg === 'landing' || sh.tg === 'boom') {
    const s = sc.samp.find(q => q.t >= sh.T + sh.dur * 2 && q.land) || sc.samp.slice().reverse().find(q => q.land);
    return s ? s.land : [W / 2, H / 2];
  }
  return null;
}

// —— 逐帧渲染全部镜头 ——
async function stepShots(b) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const scf = path.join(OUT, 'trailer_scout.json');
  const sc = process.env.SCOUT === 'reuse' && fs.existsSync(scf) ? JSON.parse(fs.readFileSync(scf, 'utf8')) : await scoutSaved(b);   // SCOUT=reuse：调试时用上次的侦察结果
  const p = await boot(b, 1920, 1080);
  p.on('console', m => { if (m.type() === 'error') console.warn('页面：', m.text().slice(0, 200)); });
  await p.addStyleTag({ content: OVERLAY_CSS });
  await p.evaluate(PAGE_FNS);
  await battle(p, 0);
  const geo = await p.evaluate(() => {
    // 接管：动画循环停掉、时钟由这里推进；音效只记录不发声（声像按 3D 镜头算）
    window.requestAnimationFrame = () => 0;
    window.__vt = lastT; performance.now = () => window.__vt;
    window.__ss = 13; window.__rs = 99991;   // 推演、画面各用一份随机数（页面里别的定时器用掉的算画面的）
    for (const id of ['trShade', 'trFlash', 'trCard']) { const d = document.createElement('div'); d.id = id; d.className = 'mn-layer'; document.body.appendChild(d); }
    document.getElementById('trCard').innerHTML = '<div class="k"></div><div class="t"></div><div class="r"></div><div class="s"></div>';
    AU.ctx = { state: 'running', currentTime: 0 }; AU.master = {};
    window.__snd = []; window.__st = 0; window.__rec = false;
    for (const f of ['auBoom', 'auReport', 'auThump', 'auWhistle', 'auCrack', 'auBurst', 'auEngine', 'auChirp', 'auSquelch']) window[f] = (...a) => { if (window.__rec) window.__snd.push([+window.__st.toFixed(3), f, a.map(v => typeof v === 'number' ? +v.toFixed(3) : v)]); };
    for (const f of ['auApply', 'auMusicTick', 'auUi', 'auTone', 'auWhoosh', 'auBeep', 'auHit']) window[f] = () => {};
    window.auPos = (x, y) => {
      const z = v3Ht(x, y), q = v3Proj(x, y, z), E = V3.cam.E;
      if (!q) return { pan: 0, g: 0 };
      const d = Math.hypot(x - E[0], -y - E[1], z - E[2]), w2 = CAM.vw / 2, h2 = CAM.vh / 2, off = Math.max(0, Math.abs(q.x - w2) - w2, Math.abs(q.y - h2) - h2);
      return { pan: clamp((q.x - w2) / w2, -1, 1) * .7, g: clamp(800 / (d + 450), 0, 1) * (off ? .45 * Math.exp(-off / 500) : 1) };
    };
    S.speed = 2;
    return { W, H };
  });
  await sleep(1500);   // 已排上的那一帧跑完（暂停中，不推演），再接管时钟
  await p.evaluate(() => { window.__vt = lastT; __seed(window.__rs); S.paused = false; });
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const order = SHOTS.filter(s => s.T).sort((a, b) => a.T - b.T).concat(SHOTS.filter(s => s.ui)).filter(s => !only || only.includes(s.id));
  for (const sh of order) {
    const N0 = Math.round(sh.dur * FPS), F0 = +process.env.FROM || 0, N = Math.min(N0, F0 + (+process.env.FRAMES || 1e9)), dir = path.join(SHOT_DIR, sh.id);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    if (sh.T) {
      const st = await p.evaluate(T => { __seed(window.__ss); while (S.t < T && !S.over) step(1 / 30); window.__ss = __rng(); __seed(window.__rs); return { t: S.t, land: window.__land(), fleet: window.__fleet(), cv: window.__cvp(), en: S.enemies.filter(e => !e.dead).length, tm: S.teams.filter(q => q.side === 'p' && q.men.length).length }; }, sh.T);
      const ss = sc.samp.find(q => q.t >= sh.T - .01);
      console.log(`镜头 ${sh.id}：第 ${st.t.toFixed(1)} 秒，敌 ${st.en}、我 ${st.tm} 组；侦察时登陆部队 ${ss && ss.land ? ss.land.map(Math.round) : '-'}，现在 ${st.land ? st.land.map(Math.round) : '-'}`);
    } else await uiSetup(p, sh);
    await p.evaluate(sh => { document.body.classList.toggle('trClean', !sh.hud && !sh.ui); document.body.classList.toggle('trChat', !!sh.chat);
      if (!sh.hud && !sh.ui && !window.__v3o) { window.__v3o = v3Overlay; window.v3Overlay = () => {}; }
      if ((sh.hud || sh.ui) && window.__v3o) { window.v3Overlay = window.__v3o; window.__v3o = null; } }, sh);
    const fixed = staticTarget(sh, sc, geo.W, geo.H), mem = {};
    let cur = null;
    for (let i = F0 - 2; i < N; i++) {   // 前两帧预热（新镜头位置的贴图、缓存），不推演、不截图、不记声音
      const t = Math.max(F0, i) / FPS, u = N0 > 1 ? Math.max(F0, i) / (N0 - 1) : 0;
      const cam = sh.ui ? null : await shotCam(p, sh, u, fixed, cur, geo, mem);
      if (cam) cur = cam.tg;
      const ov = overlayState(sh, t);
      await p.evaluate(([i, cam, ov, sh, t, glyph, f0]) => {
        window.__rs = __rng(); __seed(window.__ss);   // 推演用推演的随机数
        window.__rec = i >= f0;   // 预热帧里出现的旧事件被音效系统看过就算听过，正式第一帧起才记
        if (i < f0) { const seen = window.__fireS || (window.__fireS = new WeakSet()); for (const f of S.fx) seen.add(f); window.__fireQ = []; }
        if (i >= f0 && !sh.ui) {
          for (let k = 0; k < 2 && !S.over; k++) step(1 / 30);   // 2 倍速：每帧推演两步
          if (sh.fire) {   // 新出现的真实爆炸放大 1.5 倍，5 帧后旁边再炸一团小的
            const q = window.__fireQ || (window.__fireQ = []), seen = window.__fireS || (window.__fireS = new WeakSet());
            for (const f of S.fx) if (f.kind === 'boom' && !seen.has(f)) { seen.add(f); if (f.life < .2) { f.r *= 1.5; const a = (f.x * 7 + f.y * 13) % 6.283; q.push({ i: i + 5, x: f.x + Math.cos(a) * 26, y: f.y + Math.sin(a) * 18, r: f.r * .55 }); } }
            for (const e of q.filter(e => e.i === i)) { const f = { kind: 'boom', x: e.x, y: e.y, r: e.r, life: .05, max: 1.1, side: 'e' }; seen.add(f); S.fx.push(f); }   // 自己加的不再引出下一发
            window.__fireQ = q.filter(e => e.i > i);
          }
          if (sh.booms) for (const [j, bt] of sh.booms.entries()) if (Math.round(bt * 30) === i) {   // 高潮：按拍子落下的爆炸（位置固定，不用随机数）
            const a = j * 2.39996, r = 60 + (j % 4) * 45, f = { kind: 'boom', x: cam.tg[0] + Math.cos(a) * r, y: cam.tg[1] + Math.sin(a) * r * .7, r: 22 + (j % 3) * 8, life: .05, max: 1.2, side: 'e' };
            (window.__fireS || (window.__fireS = new WeakSet())).add(f); S.fx.push(f);
          }
        }
        window.__st = sh.at + t;
        window.__ss = __rng(); __seed(window.__rs);   // 画面用画面的随机数
        if (cam) { V3.tin = null; const cp = Math.cos(cam.pitch); Object.assign(V3.fc, { x: cam.tg[0] - Math.cos(cam.yaw) * cp * cam.d, y: cam.tg[1] - Math.sin(cam.yaw) * cp * cam.d, z: v3Ht(cam.tg[0], cam.tg[1]) - Math.sin(cam.pitch) * cam.d, yaw: cam.yaw, pitch: cam.pitch, yawT: cam.yaw, pitchT: cam.pitch, cx: null, cy: null }); }
        if (sh.ui === 'codex' && i >= f0 && i % 10 === 0) {   // 图鉴：隔 10 帧换一个有代表性的兵种
          const cs = [...document.querySelectorAll('#cdx .cdx-card')], pick = ['055 型驱逐舰', '歼-20', '福建舰', 'ZTD-05', '东风-15B', '轰-6K'].map(k => cs.find(e => e.textContent.includes(k))).filter(Boolean), c = pick[(i / 10) % pick.length | 0];
          if (c) { c.click(); c.scrollIntoView({ block: 'nearest' }); }
        }
        // 字幕卡
        const sd = document.getElementById('trShade'), fl = document.getElementById('trFlash'), cd = document.getElementById('trCard');
        sd.style.opacity = Math.max(ov.shade, ov.black);
        sd.style.background = ov.black > ov.shade ? '#000' : ov.card && ov.card.pos === 'logo' || sh.end ? 'radial-gradient(ellipse at 50% 45%, rgba(1, 6, 3, .55), rgba(1, 6, 3, .96) 70%)'
          : ov.card && ov.card.pos === 'low' ? 'linear-gradient(0deg, rgba(1, 6, 3, .9), rgba(1, 6, 3, .5) 30%, rgba(1, 6, 3, 0) 50%)'
          : 'linear-gradient(90deg, rgba(1, 6, 3, .88), rgba(1, 6, 3, .45) 38%, rgba(1, 6, 3, 0) 62%)';
        if (sh.end && ov.black) { sd.style.background = `linear-gradient(rgba(0, 0, 0, ${ov.black}), rgba(0, 0, 0, ${ov.black})), radial-gradient(ellipse at 50% 45%, rgba(1, 6, 3, .55), rgba(1, 6, 3, .96) 70%)`; sd.style.opacity = 1; }
        fl.style.opacity = ov.flash;
        const c = ov.card;
        cd.style.opacity = c ? c.a : 0;
        if (c) {
          cd.classList.toggle('logo', c.pos === 'logo');   // 只切换 logo：mn-layer 要留着，菜单打开时（图鉴）别的元素都会被藏起来
          Object.assign(cd.style, c.pos === 'logo' ? { left: '', top: '', bottom: '', transform: 'translate(-50%, -50%)' } : c.pos === 'low' ? { left: '7vw', top: 'auto', bottom: '11%', transform: `translateX(${c.slide}px)` } : { left: c.pos === 'mid' ? '330px' : '7vw', top: '50%', bottom: 'auto', transform: `translate(${c.slide}px, -50%)` });
          const hash = n => { n = Math.imul(n ^ n >>> 16, 2246822507); n = Math.imul(n ^ n >>> 13, 3266489909); return (n ^ n >>> 16) >>> 0; };
          const dec = (s, rev) => [...s].map((ch, k, A) => k < rev * A.length || ch === ' ' || ch === '　' ? ch : glyph[hash(i * 131 + k * 7919) % glyph.length]).join('');
          cd.querySelector('.k').textContent = dec(c.kick, c.rev);
          cd.querySelector('.t').textContent = dec(c.title, c.rev);
          cd.querySelector('.r').style.width = c.pos === 'logo' ? `${c.rule * 760}px` : `${c.rule * 460}px`;
          const s = cd.querySelector('.s'); s.textContent = c.sub || ''; s.style.opacity = c.subA ?? 1;
        }
        acc = -1e9; window.__vt += 1000 / 30; frame(window.__vt);   // 推演已经在上面做了，frame() 只画
      }, [i, cam, ov, sh, t, GLYPHS, F0]);
      if (i >= F0) await p.screenshot({ path: path.join(dir, String(i - F0).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 93 });
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.jpg'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', path.join(SHOT_DIR, sh.id + '.mp4')]);
    fs.rmSync(dir, { recursive: true, force: true });
    await p.evaluate(() => { window.__rec = false; });
    console.log(`镜头 ${sh.id} 完成（${N} 帧）`);
  }
  let snd = await p.evaluate(() => window.__snd);
  if (only && fs.existsSync(SFX)) {   // 只重渲了几个镜头：保留别的镜头的音效记录
    const redo = order.map(s => [s.at, s.at + s.dur]);
    snd = JSON.parse(fs.readFileSync(SFX, 'utf8')).filter(([t]) => !redo.some(([a, b]) => t >= a - 1e-6 && t < b - 1e-6)).concat(snd);
  }
  fs.writeFileSync(SFX, JSON.stringify(snd));
  console.log('音效记录', snd.length, '条');
  await p.close();
}
const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789#%&*+=<>/\\|';

// 镜头参数：起止两组 [距离, 方位, 俯角] 之间缓动；对准的点逐帧跟着走（平滑），或固定
async function shotCam(p, sh, u, fixed, cur, geo, mem) {
  if (sh.end) {   // 片尾：从登陆场拉高到整张沙盘（距离按对数插值，拉远的速度看起来均匀）
    if (!mem.start) mem.start = await p.evaluate(() => window.__land()) || [geo.W / 2, geo.H / 2];
    const v = ease(clamp(u / .55, 0, 1)), a = mem.start;
    return { tg: [lerp(a[0], geo.W / 2, v), lerp(a[1], geo.H / 2 + 300, v)], d: Math.exp(lerp(Math.log(600), Math.log(10500), v)), yaw: lerp(-1.3, -1.5708, v), pitch: lerp(-0.45, -1.08, v) };
  }
  let tg = fixed;
  if (!tg) {
    const live = await p.evaluate(([k, first]) => k === 'cv' ? window.__cvp() : k === 'fleet' ? window.__fleet() : k === 'ships' ? window.__ships(first) : window.__land(), [sh.tg, !cur]) || cur || [geo.W / 2, geo.H / 2];
    if (sh.ahead) live[1] -= sh.ahead;   // 舰队往岸上看：取景点放在舰队前方
    tg = cur ? [lerp(cur[0], live[0], .08), lerp(cur[1], live[1], .08)] : live;
  }
  const e = ease(u), [a, b] = sh.cam;
  return { tg, d: lerp(a[0], b[0], e), yaw: lerp(a[1], b[1], e), pitch: lerp(a[2], b[2], e) };
}

// 内容一览：图鉴（隔几帧换一个兵种）、闯关列表、闯关部署（AI 帮我部署，看部署好的舰队与对岸）
async function uiSetup(p, sh) {
  await p.evaluate(k => {
    document.body.classList.remove('trClean');
    if (k === 'codex') { showMenu(); openCodex(); }
    if (k === 'campaign') { if (typeof closeCodex === 'function') closeCodex(); const cx = document.getElementById('cdx'); if (cx) cx.hidden = true; if (typeof lyPop === 'function' && cx) lyPop(cx); mnAct('pve'); }
    if (k === 'deploy') { lvClose(); lvStart(4); const a = document.querySelector('#sbxPanel [data-act="ai"]'); if (a) a.click(); }
  }, sh.ui);
  if (sh.ui === 'deploy') {
    await p.evaluate(() => {
      const sh = S.ships, x = sh.length ? sh.reduce((a, s) => a + s.x, 0) / sh.length : W / 2, y = sh.length ? sh.reduce((a, s) => a + s.y, 0) / sh.length : H / 2, ty = (y + coastAt(x)) / 2, d = 2400, yaw = -1.5708, pitch = -0.9, cp = Math.cos(pitch);
      V3.tin = null; Object.assign(V3.fc, { x: x - Math.cos(yaw) * cp * d, y: ty - Math.sin(yaw) * cp * d, z: v3Ht(x, ty) - Math.sin(pitch) * d, yaw, pitch, yawT: yaw, pitchT: pitch, cx: null, cy: null });
    });
  }
  await sleep(300);
}

// —— 录音：游戏自己的音频引擎实时录下来——氛围乐开场，第 6 秒进行曲（固定 120 拍）起，强度逐幕加大，第 58 秒胜利号角；
//    渲染时记下的音效按时间线回放；换幕处加重击 ——
async function stepAudio(b) {
  const snd = JSON.parse(fs.readFileSync(SFX, 'utf8'));
  const b2 = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b2.newPage();
  await p.addInitScript(() => { window.requestAnimationFrame = () => 0; try { localStorage.clear(); localStorage.setItem('bh-settings', JSON.stringify({ intro: false, music: .9, sfx: .5, radio: .45, musicStyle: 'ambient' })); } catch (e) { /* 只影响声音 */ } });
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForFunction(() => typeof MENU === 'object' && MENU.open, null, { timeout: 90000 });
  const b64 = await p.evaluate(async ([snd, LEN, PRE]) => {
    auInit(); await AU.ctx.resume();
    const c = AU.ctx, d = c.createMediaStreamDestination(); AU.master.connect(d);
    // 进行曲固定 120 拍（一小节 2 秒），剪辑卡在小节线上；强度只改编制，不改速度
    window.auMarchTick = M => { while (M.next < c.currentTime + .3) { auMarchStep(M.next, .25, AU.inten, null); M.next += .25; M.step++; } };
    const rec = new MediaRecorder(d.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 }), ch = [];
    rec.ondataavailable = e => ch.push(e.data);
    const mg = AU.bus.music.gain, mv = SETTINGS.music * .5;
    window.auMusicStep = () => {};   // 开场只留氛围乐的低音持续音（A 与 E：D 大调的属音），和弦垫不要——会拖进进行曲里打架
    rec.start();
    const R0 = c.currentTime, Z = R0 + PRE;   // Z：片中第 0 秒
    mg.cancelScheduledValues(R0); mg.setValueAtTime(0, R0); mg.setValueAtTime(0, Z); mg.linearRampToValueAtTime(mv, Z + 2.5);   // 对齐哔声之前不出音乐，之后 2.5 秒淡入
    for (let k = 0, t = 3.4; t < 5.95; k++) { auTimp(Z + t, .035 + .17 * (t - 3.4) / 2.55, 33); t += Math.max(.06, .26 - k * .018); }   // 定音鼓滚奏渐强（A），第 6 秒落到进行曲第一拍
    auTone('ui', 'square', 1000, R0 + .5, .03, .9);   // 对齐用：片中 −0.5 秒
    const done = { march: 0, end: 0 }, hits = [[0, 'up', 5.6], [.35, 'hit', 1.2], [6, 'hit', 1.8], [21.3, 'up', .7], [22, 'hit', 1.8], [37.3, 'up', .7], [38, 'hit', 1.9], [53.3, 'up', .7], [54, 'hit', 2.2], [58, 'hit', 2.4]];
    let si = 0, hi = 0;
    await new Promise(res => {
      const iv = setInterval(() => {
        const g = c.currentTime - Z;
        AU.inten = g < 6 ? lerp(.12, .3, clamp(g / 6, 0, 1)) : g < 22 ? .34 : g < 38 ? .62 : g < 54 ? .86 : 1;
        if (g >= 5.5 && !done.march) { done.march = 1; SETTINGS.musicStyle = 'march'; AU.mus.next = Z + 6; auMusicTick(); AU.mus.step = 0; }   // 第 6 秒整进入进行曲第 1 小节
        if (g >= 57.7 && !done.end) {   // 第 58 秒：进行曲停，胜利号角，接一个长和弦
          done.end = 1; AU.mus.next = 1e9; const t = Z + 58;
          auFanfare(t);
          for (const m of [62, 66, 69, 74]) auBrass(t + .96, m, 6, .045, 2300);   // D 大调长和弦，撑到片尾淡出
          auBrass(t + .96, 50, 6, .04, 900); auTuba(t + .96, 38, 1.2, .1); auTimp(t + 4.5, .12, 38);
          for (let k = 0; k < 10; k++) auTimp(t + .96 + k * .07, .06 + k * .012);
          auCrash(t + .96, .06);
        }
        if (g < 58) auMusicTick();
        while (hi < hits.length && hits[hi][0] <= g + .005) { const [, k, v] = hits[hi++]; if (k === 'hit') auHit(v, .75); else auWhoosh(v, true, .32); }
        while (si < snd.length && snd[si][0] <= g + .005) { const [, f, a] = snd[si++]; try { window[f](...a); } catch (e) { /* 单个声音失败不影响其他 */ } }
        if (g > LEN + 1) { clearInterval(iv); res(); }
      }, 8);
    });
    rec.stop(); await new Promise(r => rec.onstop = r);
    const u = new Uint8Array(await new Blob(ch).arrayBuffer()); let s = '';
    for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
    return btoa(s);
  }, [snd.sort((a, b) => a[0] - b[0]), LEN, PRE]);
  fs.writeFileSync(path.join(OUT, 'trailer_rec.webm'), Buffer.from(b64, 'base64'));
  await b2.close();
  // 找对齐哔声（片中 −0.5 秒），从它往后 0.5 秒起截 LEN 秒
  //   按采样数截，不按时间戳：录音的时间戳跟墙上时钟走，没有声卡的机器上音频时钟慢一点（实测 0.3%），按时间戳截会短一截
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(OUT, 'trailer_rec.webm'), '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 30 });
  const f = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2);
  let on = f.findIndex(v => Math.abs(v) > .1);
  if (on < 0) throw new Error('录音里找不到对齐哔声');
  const start = on / 48000 + .5;
  console.log('对齐哔声在录音第', (on / 48000).toFixed(3), '秒');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'trailer_rec.webm'), '-af', `aresample=48000,asetpts=N/SR/TB,atrim=start=${start.toFixed(4)}:duration=${LEN},asetpts=PTS-STARTPTS,afade=t=out:st=${LEN - 1.4}:d=1.4,loudnorm=I=-14:TP=-1.5:LRA=11,apad`,
    '-t', String(LEN), '-ar', '48000', '-ac', '2', path.join(OUT, 'trailer_audio.wav')]);
}

// —— 剪辑：按时间线把各镜头接起来，配上声音 ——
function stepEdit() {
  const list = SHOTS.slice().sort((a, b) => a.at - b.at), txt = path.join(SHOT_DIR, 'list.txt');
  let t = 0;
  for (const s of list) { if (Math.abs(s.at - t) > .02) throw new Error(`镜头 ${s.id} 起点 ${s.at} 与上一镜头终点 ${t} 对不上`); t += s.dur; }
  fs.writeFileSync(txt, list.map(s => `file '${path.join(SHOT_DIR, s.id + '.mp4')}'`).join('\n') + '\n');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', txt, '-i', path.join(OUT, 'trailer_audio.wav'),
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-t', String(LEN), path.join(OUT, 'trailer_1080p.mp4')]);
  console.log('宣传片：', path.join(OUT, 'trailer_1080p.mp4'));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(LAUNCH);
  try {
    if (STEPS.includes('scout')) await scoutSaved(b);
    if (STEPS.includes('shots')) await stepShots(b);
    if (STEPS.includes('audio')) { console.log('录音…'); await stepAudio(b); }
    if (STEPS.includes('edit')) stepEdit();
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
