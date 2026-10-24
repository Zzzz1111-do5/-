'use strict';
// 音频：Web Audio 全合成，不用音频文件。音乐 / 音效 / 无线电 / 界面 四条子总线 → 压缩器 → 主音量，音量跟随 SETTINGS
// 音效：每帧比对战局数组找新事件（WeakSet 记已见对象，不往 S 写字段）；按屏幕位置声像、按离视野中心距离与缩放衰减；限并发与分类限速
const AU = { ctx: null, master: null, comp: null, bus: {}, noise: null, voices: 0, cap: 24, seen: new WeakSet(), wh: new WeakSet(), S: null,
  tok: {}, q: [], act: 0, inten: .1, mus: null, eng: null, pauseK: 1, n: {} };
// 分类限速：[每秒补充, 最多攒几个]
const AU_RATE = { boom: [9, 4], report: [9, 4], thump: [7, 3], crack: [14, 5], burst: [7, 3], whistle: [3, 2], chirp: [1.2, 2], squelch: [1.5, 2] };
const auMtof = m => 440 * Math.pow(2, (m - 69) / 12);

function auInit() {
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume().catch(() => {}); return; }
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;
  try {
    const c = AU.ctx = new AC({ latencyHint: 'interactive' });
    AU.comp = c.createDynamicsCompressor();
    AU.comp.threshold.value = -16; AU.comp.knee.value = 10; AU.comp.ratio.value = 5; AU.comp.attack.value = .003; AU.comp.release.value = .25;
    AU.master = c.createGain();
    AU.comp.connect(AU.master); AU.master.connect(c.destination);
    for (const k of ['music', 'sfx', 'radio', 'ui']) { const g = AU.bus[k] = c.createGain(); g.gain.value = 0; g.connect(AU.comp); }
    const n = c.sampleRate * 2, b = AU.noise = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    auApply();
    auMusicStart();
  } catch (e) { AU.ctx = null; console.warn('音频不可用', e); }
}

function auApply() {
  if (!AU.ctx) return;
  const t = AU.ctx.currentTime, set = (n, v) => n.gain.setTargetAtTime(v, t, .06);
  set(AU.master, SETTINGS.master);
  set(AU.bus.music, SETTINGS.music * .5);
  set(AU.bus.sfx, SETTINGS.sfx * AU.pauseK);
  set(AU.bus.radio, SETTINGS.radio * (AU.pauseK < 1 ? .6 : 1));
  set(AU.bus.ui, SETTINGS.sfx * .8);
}
if (typeof onSettings === 'function') onSettings(() => auApply());

const auOk = () => !!(AU.ctx && AU.ctx.state === 'running');
// 输出链：增益（含声像）→ 子总线；返回增益节点作为声源入口
function auOut(bus, g, pan) {
  const c = AU.ctx, gn = c.createGain();
  gn.gain.value = g;
  if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); gn.connect(p); p.connect(AU.bus[bus]); }
  else gn.connect(AU.bus[bus]);
  return gn;
}
function auNoiseSrc(t, dur, loop) {
  const s = AU.ctx.createBufferSource();
  s.buffer = AU.noise;
  if (loop) { s.loop = true; s.start(t, Math.random() * 1.8); s.stop(t + dur); } else s.start(t, Math.random() * Math.max(0, 1.9 - dur), dur);
  return s;
}
function auOsc(type, f, t, dur) { const o = AU.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur); return o; }
function auFilt(type, f, q) { const b = AU.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
// 指数包络：a 起音，d 衰减；返回增益节点
function auEnv(t, a, peak, d) {
  const g = AU.ctx.createGain(), p = g.gain;
  p.setValueAtTime(.0001, t); p.exponentialRampToValueAtTime(Math.max(.0002, peak), t + a); p.exponentialRampToValueAtTime(.0001, t + a + d);
  return g;
}
// 计入并发：声源结束时释放
function auVoice(src) { AU.voices++; src.onended = () => { AU.voices = Math.max(0, AU.voices - 1); }; }
const auCount = k => { AU.n[k] = (AU.n[k] || 0) + 1; };

// —— 战场音效 ——
function auBoom(k, pan, g) {   // 爆炸：低通噪声 + 下滑正弦重击；k 为大小（≈0.4–2）
  const c = AU.ctx, t = c.currentTime, out = auOut('sfx', g, pan), dur = .5 + k * .9;
  const n = auNoiseSrc(t, dur + .1, true), lp = auFilt('lowpass', 2600 / (.6 + k), .7), e = auEnv(t, .006, .9, dur);
  lp.frequency.setValueAtTime(3200 / (.6 + k), t); lp.frequency.exponentialRampToValueAtTime(140, t + dur);
  n.connect(lp); lp.connect(e); e.connect(out);
  const o = auOsc('sine', 95 / (.7 + k * .3), t, .7 + k * .3), e2 = auEnv(t, .004, .95, .45 + k * .25);
  o.frequency.exponentialRampToValueAtTime(28, t + .5 + k * .2);
  o.connect(e2); e2.connect(out);
  auVoice(n); auCount('boom');
}
function auReport(k, pan, g) {   // 枪炮发射的爆音
  const c = AU.ctx, t = c.currentTime, out = auOut('sfx', g, pan), dur = .14 + k * .3;
  const n = auNoiseSrc(t, dur + .05), hp = auFilt('highpass', 220), lp = auFilt('lowpass', 5200 - k * 2400), e = auEnv(t, .002, 1, dur);
  n.connect(hp); hp.connect(lp); lp.connect(e); e.connect(out);
  const o = auOsc('sine', 160 - k * 50, t, .2), e2 = auEnv(t, .002, .7, .14);
  o.frequency.exponentialRampToValueAtTime(50, t + .15); o.connect(e2); e2.connect(out);
  auVoice(n); auCount('report');
}
function auThump(k, pan, g) {   // 火炮出膛闷响；舰炮 k 大，更沉更响
  const c = AU.ctx, t = c.currentTime, out = auOut('sfx', g, pan);
  const o = auOsc('sine', 120 - k * 30, t, .6), e = auEnv(t, .003, 1, .3 + k * .2);
  o.frequency.exponentialRampToValueAtTime(34, t + .3 + k * .15); o.connect(e); e.connect(out);
  const n = auNoiseSrc(t, .5 + k * .3), lp = auFilt('lowpass', 900 + k * 500, .8), e2 = auEnv(t, .002, .8, .25 + k * .35);
  n.connect(lp); lp.connect(e2); e2.connect(out);
  auVoice(o); auCount('thump');
}
function auWhistle(dur, pan, g) {   // 来袭炮弹的呼啸：频率下滑、越来越响，落地前截止
  const c = AU.ctx, t = c.currentTime, out = auOut('sfx', g, pan), o = auOsc('sine', 1700, t, dur), v = auOsc('sine', 7, t, dur), vg = c.createGain(), e = c.createGain();
  o.frequency.exponentialRampToValueAtTime(520, t + dur); vg.gain.value = 14; v.connect(vg); vg.connect(o.frequency);
  e.gain.setValueAtTime(.0001, t); e.gain.exponentialRampToValueAtTime(.35, t + dur * .85); e.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(e); e.connect(out);
  auVoice(o); auCount('whistle');
}
function auCrack(side, pan, g) {   // 步枪：带通噪声脆响；双方音色不同
  const c = AU.ctx, t = c.currentTime, out = auOut('sfx', g, pan), n = auNoiseSrc(t, .18), bp = auFilt('bandpass', side === 'p' ? 2600 : 1700, 1.1), e = auEnv(t, .001, 1, .06);
  n.connect(bp); bp.connect(e); e.connect(out);
  const lp = auFilt('lowpass', 500), e2 = auEnv(t, .002, .35, .14); n.connect(lp); lp.connect(e2); e2.connect(out);
  auVoice(n); auCount('crack');
}
function auBurst(side, pan, g) {   // 机枪点射：一条噪声上连续 4–6 个脉冲
  const c = AU.ctx, t = c.currentTime, k = 4 + (Math.random() * 3 | 0), gap = side === 'p' ? .062 : .075, dur = k * gap + .1;
  const out = auOut('sfx', g, pan), n = auNoiseSrc(t, dur), bp = auFilt('bandpass', side === 'p' ? 1500 : 1050, .9), e = c.createGain();
  e.gain.setValueAtTime(.0001, t);
  for (let i = 0; i < k; i++) { const a = t + i * gap; e.gain.setValueAtTime(.0001, a); e.gain.linearRampToValueAtTime(.9 - i * .06, a + .003); e.gain.exponentialRampToValueAtTime(.0001, a + gap * .85); }
  n.connect(bp); bp.connect(e); e.connect(out);
  auVoice(n); auCount('burst');
}
// 舰载机引擎：常驻的嗡鸣，增益随空中架数
function auEngine(n, pan, g) {
  const c = AU.ctx, t = c.currentTime;
  if (!AU.eng) {
    const out = c.createGain(), pan = c.createStereoPanner ? c.createStereoPanner() : null, lp = auFilt('lowpass', 520, 1.5), o1 = c.createOscillator(), o2 = c.createOscillator(),
      nz = c.createBufferSource(), bp = auFilt('bandpass', 260, 1.2), ng = c.createGain();
    out.gain.value = 0; o1.type = o2.type = 'sawtooth'; o1.frequency.value = 92; o2.frequency.value = 94.7;
    nz.buffer = AU.noise; nz.loop = true; ng.gain.value = .5;
    o1.connect(lp); o2.connect(lp); nz.connect(bp); bp.connect(ng); ng.connect(lp); lp.connect(out);
    if (pan) { out.connect(pan); pan.connect(AU.bus.sfx); } else out.connect(AU.bus.sfx);
    o1.start(); o2.start(); nz.start();
    AU.eng = { out, pan, o1, o2 };
  }
  const E = AU.eng, v = n ? Math.min(.4, .16 * Math.sqrt(n)) * g : 0;
  if (!isFinite(v) || !isFinite(pan || 0)) return;
  E.out.gain.setTargetAtTime(v, t, .4);
  if (E.pan) E.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, .3);
  E.o1.frequency.setTargetAtTime(88 + Math.min(n, 6) * 2, t, 1); E.o2.frequency.setTargetAtTime(90.5 + Math.min(n, 6) * 2.3, t, 1);
}

// —— 无线电与界面 ——
function auTone(bus, type, f, t, dur, g, f2) {
  const o = auOsc(type, f, t, dur + .02), e = auEnv(t, .006, g, dur), out = auOut(bus, 1, 0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  o.connect(e); e.connect(out);
  return o;
}
function auChirp(kind) {   // 事件提示：好消息上行、坏消息下行
  const t = AU.ctx.currentTime, g = .16;
  if (kind === 'good') { auTone('radio', 'sine', 1046, t, .07, g); auVoice(auTone('radio', 'sine', 1568, t + .08, .1, g)); }
  else if (kind === 'bad') { auTone('radio', 'square', 660, t, .09, g * .45); auVoice(auTone('radio', 'square', 440, t + .1, .16, g * .45)); }
  else if (kind === 'warn') { auTone('radio', 'triangle', 880, t, .06, g); auVoice(auTone('radio', 'triangle', 880, t + .1, .06, g)); }
  else auVoice(auTone('radio', 'sine', 1320, t, .05, g * .7));
  auCount('chirp');
}
function auSquelch(side) {   // 指挥官通话：静噪“嚓”一声，再接短促提示音
  const c = AU.ctx, t = c.currentTime, out = auOut('radio', .5, 0), n = auNoiseSrc(t, .2), bp = auFilt('bandpass', 2200, .7), e = auEnv(t, .004, .6, .12);
  n.connect(bp); bp.connect(e); e.connect(out);
  const seq = side === 'e' ? [[760, .05], [700, .05], [760, .05]] : side === 'sys' ? [[1500, .06]] : [[1200, .05], [1500, .07]];
  seq.forEach(([f, d], i) => auTone('radio', side === 'e' ? 'square' : 'sine', f, t + .16 + i * .075, d, side === 'e' ? .06 : .13));
  auVoice(n); auCount('squelch');
}
// 界面音：tick 悬停 · click 点击 · ok 确认 · back 返回 · open 打开面板
function auUi(kind) {
  if (!auOk()) return;
  const t = AU.ctx.currentTime;
  if (kind === 'tick') auTone('ui', 'sine', 2400, t, .018, .05);
  else if (kind === 'ok') { auTone('ui', 'sine', 880, t, .05, .12); auTone('ui', 'sine', 1320, t + .06, .08, .12); }
  else if (kind === 'back') { auTone('ui', 'sine', 1100, t, .05, .1); auTone('ui', 'sine', 740, t + .06, .07, .1); }
  else if (kind === 'open') auTone('ui', 'triangle', 420, t, .16, .1, 1260);
  else { auTone('ui', 'sine', 2000, t, .03, .1, 1300); const n = auNoiseSrc(t, .02), hp = auFilt('highpass', 4000), e = auEnv(t, .001, .08, .015), o = auOut('ui', 1, 0); n.connect(hp); hp.connect(e); e.connect(o); }
}
// 转场用：风声扫频（up 为上扫）
function auWhoosh(dur, up, g = .5) {
  if (!auOk()) return;
  const c = AU.ctx, t = c.currentTime, out = auOut('sfx', g, 0), n = auNoiseSrc(t, dur + .1, true), bp = auFilt('bandpass', up ? 250 : 3000, 1.4), e = c.createGain();
  bp.frequency.exponentialRampToValueAtTime(up ? 3200 : 220, t + dur);
  e.gain.setValueAtTime(.0001, t); e.gain.exponentialRampToValueAtTime(.8, t + dur * .7); e.gain.exponentialRampToValueAtTime(.0001, t + dur);
  n.connect(bp); bp.connect(e); e.connect(out);
  const o = auOsc('sine', up ? 40 : 90, t, dur), e2 = c.createGain();
  o.frequency.exponentialRampToValueAtTime(up ? 90 : 36, t + dur);
  e2.gain.setValueAtTime(.0001, t); e2.gain.exponentialRampToValueAtTime(.5, t + dur * .8); e2.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(e2); e2.connect(out);
}
function auBeep(f, dur = .06, g = .12) { if (auOk()) auTone('ui', 'sine', f, AU.ctx.currentTime, dur, g); }
function auHit(k = 1.4, g = .55) { if (auOk()) auBoom(k, 0, g); }   // 不定位的重击（转场落地）
// 设置面板试听
function auTest(k) {
  if (!auOk()) return;
  if (k === 'sfx') auBoom(.9, 0, .8); else if (k === 'radio') auSquelch('p'); else if (k === 'master') auReport(.6, 0, .7);
}

// —— 声像与衰减：屏幕内居中最响，屏外迅速变小；缩得越远整体越轻 ——
function auPos(x, y) {
  if (typeof CAM !== 'object' || !R.s || CAM.vw < 2) return { pan: 0, g: .6 };
  const sx = x * R.s + R.ox, sy = y * R.s + R.oy, hw = CAM.vw / 2, hh = CAM.vh / 2, hd = Math.hypot(hw, hh);
  const pan = clamp((sx - hw) / hw, -1.4, 1.4) * .7;
  const ox = Math.max(0, Math.abs(sx - hw) - hw), oy = Math.max(0, Math.abs(sy - hh) - hh);
  const g = ox || oy ? .3 * Math.exp(-Math.hypot(ox, oy) / (hd * .4)) : 1 - .55 * Math.hypot(sx - hw, sy - hh) / hd;
  const zf = clamp(Math.log(CAM.z / CAM.fit) / Math.log(6), 0, 1);
  return { pan: clamp(pan, -1, 1), g: g * (.4 + .6 * zf) };
}
function auQ(cat, x, y, vol, fn) {
  const p = auPos(x, y), g = p.g * vol;
  if (g > .015) AU.q.push({ cat, g, pan: p.pan, fn });
}
function auTake(cat) {
  const r = AU_RATE[cat];
  if (!r) return true;
  const v = AU.tok[cat] ?? r[1];
  if (v < 1) return false;
  AU.tok[cat] = v - 1;
  return true;
}

// 每帧：比对战局，找新事件
function auScan(play) {
  const seen = AU.seen, newShellAt = [];
  let act = 0;
  for (const s of S.shells) if (!seen.has(s)) {
    seen.add(s);
    if (!play || s.kind === 'bomb') continue;
    const naval = s.kind === 'naval' || s.kind === 'smoke', ox = s.fuzzy ? s.fx0 : s.x0, oy = s.fuzzy ? s.fy0 : s.y0;
    newShellAt.push([s.x0, s.y0]);
    const k = naval ? 1.4 : s.kind === 'coastal' ? 1.2 : s.kind === 'mortar' ? .4 : .8;
    auQ('thump', ox, oy, (naval ? 1 : .75) * (s.fuzzy ? .6 : 1), q => auThump(k, q.pan, q.g));
    act += .5;
  }
  for (const f of S.fx) if (!seen.has(f)) {
    seen.add(f);
    if (!play || f.life > .4) continue;
    if (f.kind === 'boom') { const k = clamp(f.r / 26, .4, 2.2); auQ('boom', f.x, f.y, .6 + k * .25, q => auBoom(k, q.pan, q.g)); act += 1 + k; }
    else if (f.kind === 'flash') {
      if (newShellAt.some(([x, y]) => Math.abs(x - f.x) < 25 && Math.abs(y - f.y) < 25)) continue;   // 已有出膛声
      const k = clamp(f.r / 16, .3, 1.3);
      auQ('report', f.x, f.y, .45 + k * .3, q => auReport(k, q.pan, q.g)); act += .4;
    }
  }
  // 曳光：同一帧同一射手的两条 = 机枪点射，单条 = 步枪
  const grp = new Map();
  for (const tr of S.tracers) if (!seen.has(tr)) {
    seen.add(tr);
    if (!play) continue;
    const key = tr.side + (tr.fuzzy ? 'f' + Math.round(tr.x1 / 30) + ',' + Math.round(tr.y1 / 30) : Math.round(tr.x0) + ',' + Math.round(tr.y0));
    const gr = grp.get(key);
    if (gr) gr.n++; else grp.set(key, { n: 1, tr });
  }
  for (const { n, tr } of grp.values()) {
    const mg = n >= 2, side = tr.side;
    auQ(mg ? 'burst' : 'crack', tr.x0, tr.y0, (mg ? .45 : .35) * (tr.fuzzy ? .7 : 1), q => mg ? auBurst(side, q.pan, q.g) : auCrack(side, q.pan, q.g));
    act += .12 * n;
  }
  // 来袭炮弹：落点靠近视野中心时，落地前约 1 秒响起呼啸
  if (play) for (const s of S.shells) if (s.side === 'e' && !s.done && !AU.wh.has(s)) {
    const rem = (s.dur - s.t) / Math.max(1, S.speed);
    if (rem > 1.15 || rem < .2) continue;
    AU.wh.add(s);
    const p = auPos(s.x1, s.y1);
    if (p.g > .45) AU.q.push({ cat: 'whistle', g: p.g * .5, pan: p.pan, fn: q => auWhistle(rem, q.pan, q.g) });
  }
  if (Array.isArray(S.log)) for (const l of S.log) if (!seen.has(l)) { seen.add(l); if (play && S.t - l.t < 2) AU.q.push({ cat: 'chirp', g: l.kind === 'bad' ? .9 : l.kind === 'good' ? .8 : l.kind === 'warn' ? .7 : .3, fn: () => auChirp(l.kind) }); }
  if (Array.isArray(S.chat)) for (const m of S.chat) if (!seen.has(m)) {
    if (m.t > S.t + .05) continue;   // 延时消息到点再响
    seen.add(m);
    if (!play || S.t - m.t > 3 || !auChatHeard(m)) continue;
    AU.q.push({ cat: 'squelch', g: 1, fn: () => auSquelch(m.side) });
  }
  return act;
}
// 和聊天面板的过滤一致：PvE 里敌方通话只在截获时由面板提示，这里不响
function auChatHeard(m) {
  if (m.side === 'e' && (S.mode !== 'sandbox' && S.role !== 'spectate' || !SETTINGS.enemyChat)) return false;
  if (SETTINGS.chat === 'brief' && !['plan', 'friction', 'remedy'].includes(m.kind)) return false;
  return true;
}

function auFrame(now, dt) {
  if (!S) return;
  if (AU.S !== S) { AU.S = S; AU.seen = new WeakSet(); AU.wh = new WeakSet(); auScan(false); return; }   // 新战局：旧积压不出声
  for (const k in AU_RATE) AU.tok[k] = Math.min(AU_RATE[k][1], (AU.tok[k] ?? AU_RATE[k][1]) + AU_RATE[k][0] * dt);
  const run = auOk() && SETTINGS.master > 0;
  AU.q.length = 0;
  const act = auScan(run && SETTINGS.sfx > 0);
  AU.act += (act / Math.max(dt, .001) - AU.act) * Math.min(1, dt / 3);
  if (!AU.ctx) return;
  const menu = typeof MENU === 'object' && MENU.open, pk = (S.paused && S.phase === 'battle') || menu ? .3 : 1;
  if (pk !== AU.pauseK) { AU.pauseK = pk; auApply(); }
  if (!run) return;
  AU.q.sort((a, b) => b.g - a.g);
  for (const it of AU.q) {
    if (AU.voices >= AU.cap) break;
    if (!auTake(it.cat)) continue;
    try { it.fn(it); } catch (e) { /* 单个声音失败不影响其他 */ }
  }
  // 空中飞机
  let n = 0, best = null;
  for (const p of S.planes || []) if (!p.dead && (p.alt || 0) > .15) { n++; const q = auPos(p.x, p.y); if (!best || q.g > best.g) best = q; }
  if (n || AU.eng) auEngine(n, best ? best.pan : 0, best ? Math.max(.25, best.g) : 0);
  // 音乐强度：菜单最静，部署稍起，战斗随近期爆炸数上升
  const tgt = menu ? .06 : S.over ? .15 : S.phase === 'battle' ? .28 + Math.min(.72, AU.act / 14) : .16;
  AU.inten += (tgt - AU.inten) * Math.min(1, dt / 4);
  auMusicTick();
}

// —— 生成式暗色合成器氛围乐：A 小调持续低音 + 慢速和弦垫 + 琶音 + 滤波噪声脉冲；强度越高越快越亮 ——
const AU_CHORDS = [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [7, 10, 14]];   // Am F Dm Em
function auMusicStart() {
  const c = AU.ctx, t = c.currentTime, bus = AU.bus.music;
  const dl = c.createDelay(2), fb = c.createGain(), dlp = auFilt('lowpass', 2000);
  fb.gain.value = .38; dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(bus);
  // 持续低音：A1 + E2，低通随 LFO 缓慢开合
  const dr = c.createGain(), dlpf = auFilt('lowpass', 200, 2), lfo = c.createOscillator(), lg = c.createGain();
  dr.gain.value = 0; dr.gain.setTargetAtTime(.32, t, 3);
  lfo.frequency.value = .045; lg.gain.value = 90; lfo.connect(lg); lg.connect(dlpf.frequency); lfo.start();
  for (const [f, g, ty] of [[55, 1, 'sawtooth'], [55.3, .8, 'sawtooth'], [82.4, .35, 'sawtooth'], [27.5, .9, 'sine']]) {
    const o = c.createOscillator(), og = c.createGain(); o.type = ty; o.frequency.value = f; og.gain.value = g; o.connect(og); og.connect(dlpf); o.start();
  }
  dlpf.connect(dr); dr.connect(bus);
  // 噪声脉冲
  const nz = c.createBufferSource(), nbp = auFilt('bandpass', 900, 1.3), ng = c.createGain();
  nz.buffer = AU.noise; nz.loop = true; ng.gain.value = 0; nz.connect(nbp); nbp.connect(ng); ng.connect(bus); nz.start();
  AU.mus = { next: t + .2, step: 0, delay: dl, dlpf, ng, nbp, dr };
}
function auMusicTick() {
  const c = AU.ctx, M = AU.mus;
  if (!M) return;
  if (M.next < c.currentTime - .4) M.next = c.currentTime + .05;   // 标签页挂起后不补播
  const march = (SETTINGS.musicStyle || 'march') === 'march';
  if (march !== M.march) { M.march = march; M.step = 0; M.dr.gain.setTargetAtTime(march ? 0 : .32, c.currentTime, 1.2); }
  if (march) { auMarchTick(M); return; }
  const I = AU.inten, st = 60 / lerp(56, 86, I) / 2;   // 八分音符时值
  M.delay.delayTime.setTargetAtTime(st * 3, c.currentTime, .5);
  M.dlpf.frequency.setTargetAtTime(160 + I * 520, c.currentTime, 1.5);
  while (M.next < c.currentTime + .3) { auMusicStep(M.next, st, I); M.next += st; M.step++; }
}
function auMusicStep(t, st, I) {
  const c = AU.ctx, M = AU.mus, s = M.step % 16, ch = AU_CHORDS[(M.step / 16 | 0) % 4], bus = AU.bus.music;
  if (s === 0) for (const iv of ch) for (const det of [-7, 7]) {   // 和弦垫：每两小节换一次
    const o = c.createOscillator(), lp = auFilt('lowpass', 420 + I * 1100, .8), g = c.createGain(), d = st * 16;
    o.type = 'sawtooth'; o.frequency.value = auMtof(57 + iv); o.detune.value = det;
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.022, t + d * .35); g.gain.setValueAtTime(.022, t + d * .7); g.gain.exponentialRampToValueAtTime(.0001, t + d * 1.05);
    o.connect(lp); lp.connect(g); g.connect(bus); o.start(t); o.stop(t + d * 1.1);
  }
  // 琶音：和弦音上下行，强度高时更密、高八度
  const pat = [0, 1, 2, 3, 2, 1, 2, 3], tones = [...ch, ch[0] + 12], oct = I > .6 && s >= 8 ? 12 : 0;
  if (Math.random() < .3 + I * .65 || s % 4 === 0) {
    const f = auMtof(69 + tones[pat[s % 8]] + oct - (s % 8 === 0 ? 12 : 0)), o = c.createOscillator(), lp = auFilt('lowpass', 1200 + I * 2600, 2), g = auEnv(t, .006, (s % 4 === 0 ? .07 : .045) * (.7 + I * .5), st * 1.8);
    o.type = 'triangle'; o.frequency.value = f;
    o.connect(lp); lp.connect(g); g.connect(bus); g.connect(M.delay); o.start(t); o.stop(t + st * 2.2);
  }
  // 噪声脉冲：拍点重
  const pk = (s % 2 === 0 ? 1 : .55) * (.01 + I * .07);
  M.ng.gain.setValueAtTime(pk, t); M.ng.gain.setTargetAtTime(.0001, t + .01, st * .25);
  M.nbp.frequency.setValueAtTime(700 + I * 1500 + (s % 4 === 2 ? 600 : 0), t);
  // 心跳鼓：激烈时第 1、3 拍
  if (I > .5 && s % 4 === 0) {
    const o = c.createOscillator(), g = auEnv(t, .004, .2 * (I - .4), .32);
    o.frequency.setValueAtTime(64, t); o.frequency.exponentialRampToValueAtTime(30, t + .3); o.connect(g); g.connect(bus); o.start(t); o.stop(t + .4);
  }
}

// —— 战歌（原创军乐进行曲，WebAudio 实时合成）：4/4 拍，主歌 D 小调（悲壮）→ 副歌转降 B / F 大调（激昂），16 小节一循环；
//    军鼓（第 4 小节滚奏）、大鼓 1、3 拍，大号 / 低音提琴「嘭—恰」根音五音，铜管齐奏主旋律、圆号三度和声，副歌男声合唱「啊」，段落转换处定音鼓滚奏、副歌起拍镲。
//    随场合变化（AU.inten）：菜单——圆号独奏慢板；部署——军鼓进行 + 低音；战斗——全编制，越激烈越快（112→128 BPM）、加弦乐跳弓、合唱与镲；
//    胜利——号角短曲；失败——慢板、低八度、无鼓 ——
// 旋律：每小节 [音高(MIDI) | null 休止, 时值（八分音符数）]，每小节合计 8
const AU_MEL = [
  [[62, 3], [62, 1], [65, 2], [69, 2]], [[74, 4], [72, 2], [69, 2]], [[70, 3], [69, 1], [67, 2], [65, 2]], [[67, 4], [64, 2], [60, 2]],
  [[62, 3], [62, 1], [65, 2], [69, 2]], [[70, 3], [69, 1], [67, 2], [74, 2]], [[73, 4], [69, 2], [64, 2]], [[69, 6], [null, 2]],
  [[74, 2], [77, 4], [74, 2]], [[72, 3], [69, 1], [72, 4]], [[76, 3], [74, 1], [72, 2], [67, 2]], [[69, 6], [69, 1], [70, 1]],
  [[74, 2], [77, 4], [79, 2]], [[81, 4], [79, 2], [77, 2]], [[76, 3], [73, 1], [76, 2], [81, 2]], [[74, 6], [null, 2]]
];
// 每小节和弦（根音 MIDI、和弦音相对根音的半音）：Dm Dm B♭ C Dm Gm A A ｜ B♭ F C Dm B♭ F A Dm
const AU_HAR = [[50, [0, 3, 7]], [50, [0, 3, 7]], [46, [0, 4, 7]], [48, [0, 4, 7]], [50, [0, 3, 7]], [43, [0, 3, 7]], [45, [0, 4, 7]], [45, [0, 4, 7]],
  [46, [0, 4, 7]], [41, [0, 4, 7]], [48, [0, 4, 7]], [50, [0, 3, 7]], [46, [0, 4, 7]], [41, [0, 4, 7]], [45, [0, 4, 7]], [50, [0, 3, 7]]];
const auMarchBpm = (I, over) => over === 'lose' ? 72 : I < .1 ? 84 : I < .25 ? 104 : lerp(112, 128, clamp((I - .25) / .75, 0, 1));
function auMarchTick(M) {
  const c = AU.ctx, I = AU.inten, ov = S && S.over ? (S.over === 'win' ? 'win' : 'lose') : null;
  if (ov !== M.ov) { if (ov === 'win') auFanfare(c.currentTime + .1); M.ov = ov; }
  const st = 60 / auMarchBpm(I, ov) / 2;
  while (M.next < c.currentTime + .3) { auMarchStep(M.next, st, I, ov); M.next += st; M.step++; }
}
// 铜管：三支失谐锯齿波 + 低八度方波，滤波器包络模拟「吹响」的亮度；长音带颤音
function auBrass(t, m, dur, vel, bright, dest) {
  const c = AU.ctx, f = auMtof(m), lp = auFilt('lowpass', 400, 1.2), g = c.createGain(), d = Math.max(.08, dur);
  lp.frequency.setValueAtTime(380, t); lp.frequency.exponentialRampToValueAtTime(bright, t + .045); lp.frequency.exponentialRampToValueAtTime(bright * .62, t + Math.min(.3, d * .6));
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vel, t + .03); g.gain.setValueAtTime(vel * .82, t + d * .7); g.gain.exponentialRampToValueAtTime(.0001, t + d + .12);
  const vib = d > .45 ? c.createOscillator() : null, vg = vib ? c.createGain() : null;
  if (vib) { vib.frequency.value = 5.2; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * .006, t + .35); vib.connect(vg); vib.start(t); vib.stop(t + d + .15); }
  for (const [ty, det, k, mul] of [['sawtooth', -9, .5, 1], ['sawtooth', 0, .55, 1], ['sawtooth', 9, .5, 1], ['square', 0, .25, .5]]) {
    const o = c.createOscillator(), og = c.createGain();
    o.type = ty; o.frequency.value = f * mul; o.detune.value = det; og.gain.value = k;
    if (vg) vg.connect(o.frequency);
    o.connect(og); og.connect(lp); o.start(t); o.stop(t + d + .15);
  }
  lp.connect(g); g.connect(dest || AU.bus.music);
}
// 大号 / 低音提琴：短促的「嘭」
function auTuba(t, m, dur, vel) {
  const c = AU.ctx, o = c.createOscillator(), o2 = c.createOscillator(), lp = auFilt('lowpass', 420, 1.5), g = auEnv(t, .02, vel, dur);
  o.type = 'sawtooth'; o.frequency.value = auMtof(m); o2.type = 'sine'; o2.frequency.value = auMtof(m);
  o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(AU.bus.music); o.start(t); o2.start(t); o.stop(t + dur + .1); o2.stop(t + dur + .1);
}
function auSnare(t, vel) {
  const c = AU.ctx, n = auNoiseSrc(t, .2), bp = auFilt('bandpass', 1900, .7), hp = auFilt('highpass', 700), g = auEnv(t, .002, vel, .13);
  n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(AU.bus.music);
  const o = c.createOscillator(), og = auEnv(t, .002, vel * .5, .06);
  o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(150, t + .05); o.connect(og); og.connect(AU.bus.music); o.start(t); o.stop(t + .1);
}
function auKick(t, vel) {
  const c = AU.ctx, o = c.createOscillator(), g = auEnv(t, .004, vel, .38);
  o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(42, t + .3); o.connect(g); g.connect(AU.bus.music); o.start(t); o.stop(t + .45);
}
function auTimp(t, vel, m = 38) {
  const c = AU.ctx, o = c.createOscillator(), g = auEnv(t, .006, vel, .55), lp = auFilt('lowpass', 300);
  o.frequency.setValueAtTime(auMtof(m) * 1.04, t); o.frequency.exponentialRampToValueAtTime(auMtof(m), t + .08);
  o.connect(lp); lp.connect(g); g.connect(AU.bus.music); o.start(t); o.stop(t + .65);
}
function auCrash(t, vel) {
  const n = auNoiseSrc(t, 1.8), hp = auFilt('highpass', 5200), g = auEnv(t, .004, vel, 1.6);
  n.connect(hp); hp.connect(g); g.connect(AU.bus.music);
}
// 男声合唱「啊」：锯齿波过两个共振峰（约 700 / 1150 Hz）
function auChoir(t, notes, dur, vel) {
  const c = AU.ctx, f1 = auFilt('bandpass', 700, 5), f2 = auFilt('bandpass', 1150, 6), g = c.createGain();
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vel, t + dur * .25); g.gain.setValueAtTime(vel, t + dur * .8); g.gain.exponentialRampToValueAtTime(.0001, t + dur * 1.05);
  for (const m of notes) for (const det of [-6, 6]) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = auMtof(m); o.detune.value = det + (Math.random() - .5) * 6;
    o.connect(f1); o.connect(f2); o.start(t); o.stop(t + dur * 1.1);
  }
  const mix = c.createGain(); mix.gain.value = 1.6; f1.connect(mix); f2.connect(mix); mix.connect(g); g.connect(AU.bus.music);
}
function auFanfare(t) {   // 胜利号角：D 大调分解和弦上行，长音收束
  const st = .16;
  [[62, 1], [66, 1], [69, 1], [74, 3], [69, 1], [74, 5]].reduce((a, [m, d]) => { auBrass(a, m, d * st, .06, 2600); auBrass(a, m - 12, d * st, .03, 1400); return a + d * st; }, t);
  auCrash(t, .05); auTimp(t, .2); auTimp(t + st * 3, .22);
}
function auMarchStep(t, st, I, ov) {
  const M = AU.mus, s = M.step % 128, bar = s >> 3, pos = s & 7, ch = AU_HAR[bar], chorus = bar >= 8, lose = ov === 'lose', menu = I < .1;
  // 主旋律（菜单与失败：圆号音色、暗；战斗：铜管齐奏、亮）
  let p0 = 0;
  for (const [m, d] of AU_MEL[bar]) {
    if (p0 === pos && m != null) {
      const mm = lose ? m - 12 : m, bright = menu || lose ? 1100 : 1500 + I * 1700, vel = (menu ? .028 : .034 + I * .016) * (chorus ? 1.1 : 1);
      auBrass(t, mm, d * st * .92, vel, bright);
      if (!menu && !lose && (chorus || I > .45)) {   // 圆号和声：旋律下方最近的和弦音
        const pcs = ch[1].map(iv => (ch[0] + iv) % 12);
        let h = mm - 3; for (let k = 0; k < 6 && !pcs.includes(((h % 12) + 12) % 12); k++) h--;
        auBrass(t, h, d * st * .92, vel * .55, bright * .7);
      }
    }
    p0 += d;
  }
  // 低音「嘭—恰」：根音（第 1、3 拍）、五音（第 2、4 拍）
  if (!menu && pos % 2 === 0) auTuba(t, ch[0] - 12 + (pos % 4 === 2 ? 7 : 0), st * 1.4, (lose ? .05 : .07) * (pos % 4 ? .75 : 1));
  else if (menu && pos === 0) auTuba(t, ch[0] - 12, st * 7, .035);
  if (lose || menu) return;
  // 鼓：军鼓（重拍、反拍 + 十六分装饰音；每 4 小节最后一拍滚奏）、大鼓 1、3 拍
  const sv = .05 + I * .07, roll = bar % 4 === 3 && pos >= 6;
  if (I >= .1) {
    if (pos === 0 || pos === 4) { auSnare(t, sv); auKick(t, .16 + I * .12); }
    else if (pos % 2 === 0) auSnare(t, sv * .65);
    else if (I > .35) { auSnare(t, sv * .4); auSnare(t + st / 2, sv * .45); }
    if (roll) for (let k = 1; k < 4; k++) auSnare(t + st * k / 4, sv * (.5 + k * .15));
  }
  // 段落转换：定音鼓滚奏；副歌起拍：镲
  if ((bar === 7 || bar === 15) && pos >= 4) for (let k = 0; k < 4; k++) auTimp(t + st * k / 4, (.08 + I * .1) * (.6 + (pos - 4) * .1 + k * .03));
  if ((bar === 8 || bar === 0) && pos === 0 && I > .45) auCrash(t, .025 + I * .03);
  // 弦乐跳弓：和弦根音、五音八分音符
  if (I > .4) { const o = AU.ctx.createOscillator(), lp = auFilt('lowpass', 1300, 1), g = auEnv(t, .01, .012 + I * .01, st * .6); o.type = 'sawtooth'; o.frequency.value = auMtof(ch[0] + (pos % 2 ? 7 : 12)); o.connect(lp); lp.connect(g); g.connect(AU.bus.music); o.start(t); o.stop(t + st); }
  // 副歌：男声合唱，每小节一个和弦
  if (chorus && pos === 0 && I > .5) auChoir(t, ch[1].map(iv => ch[0] + iv), st * 8, .022 + I * .015);
}

if (typeof document !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, auInit, true);   // 窗口捕获阶段：先于浮层按键栈
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button')) auUi('click'); }, true);
}
HOOK.frame.push(auFrame);
