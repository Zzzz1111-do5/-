// 宣传片第三步：配乐 + 音效，全部程序合成（不用任何外部音频素材）
//   node roblox/tools/trailer/audio.mjs <cues.json> <out.wav>
//   配乐 120 拍（一小节 2 秒，分镜换镜头都在小节上），D 小调：开场标题 → 大亨经营（拨弦琶音）→ 布阵（紧张、鼓点停）→ 开战（重鼓、低音铜管）
//   → 高潮（每秒一下重击）→ 胜利（转 D 大调）→ 片尾标志；音效按 cues.json（render.mjs 从推演里逐帧记下的开火、爆炸……）放，按距离衰减、按左右声像
import fs from 'fs';

const SR = 48000, LEN = 64, N = SR * LEN;
const cues = JSON.parse(fs.readFileSync(process.argv[2] || 'cues.json', 'utf8'));
const outPath = process.argv[3] || 'music.wav';

// ---------------------------------------------------------------- 工具：确定的随机数（每次生成一样）、滤波器、混音
let seed = 20261107;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const noise = () => rnd() * 2 - 1;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
function coef(type, f, q) {
  const w = 2 * Math.PI * clamp(f, 10, SR * 0.45) / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al;
  return [b0 / a0, b1 / a0, b2 / a0, -2 * cs / a0, (1 - al) / a0];
}
// 双二阶滤波（截止频率可以随时间变：f 是数或 t → 频率的函数）
function filt(x, type, f, q) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, c = null;
  const fn = typeof f === 'function';
  for (let i = 0; i < x.length; i++) {
    if (!c || (fn && (i & 15) === 0)) c = coef(type, fn ? f(i / SR) : f, q || 0.707);
    const y = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}
const buf = d => new Float32Array(Math.max(1, Math.round(d * SR)));
// 带限锯齿波（PolyBLEP，高音不刺耳）
const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;

// 总线：配乐、音效各自的干声 + 混响发送
const ML = new Float32Array(N), MR = new Float32Array(N), XL = new Float32Array(N), XR = new Float32Array(N), VL = new Float32Array(N), VR = new Float32Array(N);
function put(x, t, gain, pan, send, bus) {
  const i0 = Math.round(t * SR); if (i0 >= N) return;
  const p = clamp(pan || 0, -1, 1), gl = Math.cos((p + 1) * Math.PI / 4) * gain, gr = Math.sin((p + 1) * Math.PI / 4) * gain;
  const L = bus === 'x' ? XL : ML, R = bus === 'x' ? XR : MR, s = send || 0;
  for (let i = 0; i < x.length; i++) {
    const j = i0 + i; if (j < 0) continue; if (j >= N) break;
    const v = x[i]; L[j] += v * gl; R[j] += v * gr;
    if (s) { VL[j] += v * gl * s; VR[j] += v * gr * s; }
  }
}

// ---------------------------------------------------------------- 乐器
function kick(v) {
  const x = buf(0.55); let ph = 0;
  for (let i = 0; i < x.length; i++) { const t = i / SR, f = 44 + 120 * Math.exp(-t * 30); ph += f / SR; x[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 6.5) + noise() * Math.exp(-t * 350) * 0.35; }
  return scale(x, v || 1);
}
function snare(v) {
  const x = buf(0.38), n = buf(0.38);
  for (let i = 0; i < n.length; i++) n[i] = noise();
  filt(n, 'bp', 2400, 0.7);
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 22) * 0.55 + n[i] * Math.exp(-t * 13) * 1.6; }
  return scale(x, v || 1);
}
function hat(v, open) {
  const x = buf(open ? 0.3 : 0.07);
  for (let i = 0; i < x.length; i++) x[i] = noise();
  filt(x, 'hp', 7500, 0.7);
  for (let i = 0; i < x.length; i++) x[i] *= Math.exp(-i / SR * (open ? 11 : 70));
  return scale(x, v || 1);
}
function crash(v) {
  const x = buf(2.4);
  for (let i = 0; i < x.length; i++) x[i] = noise();
  filt(x, 'hp', 4200, 0.6);
  for (let i = 0; i < x.length; i++) x[i] *= Math.exp(-i / SR * 1.8);
  return scale(x, v || 1);
}
function tom(f, v) {
  const x = buf(0.6); let ph = 0;
  for (let i = 0; i < x.length; i++) { const t = i / SR; ph += f * (1 + 0.6 * Math.exp(-t * 18)) / SR; x[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 5.5) + noise() * Math.exp(-t * 60) * 0.2; }
  return scale(x, v || 1);
}
function scale(x, v) { if (v !== 1) for (let i = 0; i < x.length; i++) x[i] *= v; return x; }
// 锯齿波合成音（低音、弦乐垫、铜管）：几根略微走音的锯齿叠起来，过低通
function saws(freqs, dur, o) {
  const att = o.att || 0.01, rel = o.rel || 0.2, x = buf(dur + rel), det = o.det || 0, nv = o.voices || 1;
  for (const f0 of freqs) for (let k = 0; k < nv; k++) {
    const f = f0 * (1 + (nv > 1 ? (k / (nv - 1) - 0.5) * det : 0)), dt = f / SR; let ph = rnd();
    for (let i = 0; i < x.length; i++) { ph += dt; if (ph >= 1) ph -= 1; x[i] += (2 * ph - 1 - blep(ph, dt)) / (nv * freqs.length); }
  }
  if (o.sub) for (let i = 0; i < x.length; i++) x[i] += Math.sin(2 * Math.PI * freqs[0] / 2 * i / SR) * o.sub;
  filt(x, 'lp', o.cut || 1200, o.q || 0.8);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const env = t < att ? t / att : t < dur ? (o.decay ? Math.exp(-(t - att) * o.decay) : 1) : (o.decay ? Math.exp(-(dur - att) * o.decay) : 1) * Math.max(0, 1 - (t - dur) / rel);
    x[i] *= env;
  }
  return x;
}
// 铜管低音「轰」（电影预告片那种）：根音 + 五度 + 八度，滤波器猛地张开再慢慢合上，再过一点失真
function braam(root, dur, v) {
  const fs_ = [midi(root), midi(root + 7), midi(root + 12), midi(root - 12)];
  const x = buf(dur + 0.8);
  for (const f0 of fs_) for (let k = 0; k < 3; k++) { const f = f0 * (1 + (k - 1) * 0.006), dt = f / SR; let ph = rnd();
    for (let i = 0; i < x.length; i++) { ph += dt; if (ph >= 1) ph -= 1; x[i] += (2 * ph - 1 - blep(ph, dt)) * 0.12; } }
  filt(x, 'lp', t => 180 + 2600 * Math.exp(-t * 2.2) * Math.min(1, t / 0.06), 2.2);
  for (let i = 0; i < x.length; i++) { const t = i / SR, env = Math.min(1, t / 0.035) * (t < dur ? Math.exp(-t * 0.9) : Math.exp(-dur * 0.9) * Math.max(0, 1 - (t - dur) / 0.8)); x[i] = Math.tanh(x[i] * 2.2) * env; }
  return scale(x, v || 1);
}
// 重击：底鼓 + 一大团低沉的噪声 + 往下掉的次低音
function impact(v, len) {
  len = len || 3.2;
  const x = buf(len), n = buf(len);
  for (let i = 0; i < n.length; i++) n[i] = noise();
  filt(n, 'lp', t => 3200 * Math.exp(-t * 5) + 120, 0.7);
  let ph = 0;
  for (let i = 0; i < x.length; i++) { const t = i / SR, f = 28 + 70 * Math.exp(-t * 2.5); ph += f / SR;
    x[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 1.3) * 0.9 + n[i] * Math.exp(-t * 3) * 1.4; }
  const k = kick(1.2); for (let i = 0; i < k.length; i++) x[i] += k[i];
  return scale(x, v || 1);
}
// 上冲音：噪声过一个越来越高的带通 + 越来越响；end 那一刻断掉
function riser(dur, v) {
  const x = buf(dur), s = buf(dur);
  for (let i = 0; i < x.length; i++) x[i] = noise();
  filt(x, 'bp', t => 250 * Math.pow(30, t / dur), 2.5);
  let ph = 0;
  for (let i = 0; i < x.length; i++) { const t = i / SR, u = t / dur; ph += (180 * Math.pow(6, u)) / SR; s[i] = Math.sin(2 * Math.PI * ph) * 0.15; x[i] = (x[i] * 2.2 + s[i]) * u * u; }
  return scale(x, v || 1);
}
// 嗖：噪声带通往下扫，中间最响
function whoosh(dur, v, up) {
  const x = buf(dur);
  for (let i = 0; i < x.length; i++) x[i] = noise();
  filt(x, 'bp', t => up ? 400 * Math.pow(8, t / dur) : 3200 * Math.pow(0.15, t / dur), 1.6);
  for (let i = 0; i < x.length; i++) { const u = i / x.length; x[i] *= Math.sin(Math.PI * Math.pow(u, 0.7)) * 1.8; }
  return scale(x, v || 1);
}
// 拨弦合成音（琶音）：方波 + 锯齿，滤波器一下子合上
function pluck(f, v) {
  const x = buf(0.45), dt = f / SR; let ph = 0;
  for (let i = 0; i < x.length; i++) { ph += dt; if (ph >= 1) ph -= 1; x[i] = ((ph < 0.5 ? 1 : -1) * 0.5 + (2 * ph - 1 - blep(ph, dt)) * 0.5); }
  filt(x, 'lp', t => 300 + 4200 * Math.exp(-t * 16), 1.3);
  for (let i = 0; i < x.length; i++) x[i] *= Math.exp(-i / SR * 7);
  return scale(x, v || 1);
}
// 钟（调频合成）
function bell(f, v, dur) {
  dur = dur || 2.5; const x = buf(dur);
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = Math.sin(2 * Math.PI * f * t + 2.6 * Math.exp(-t * 3) * Math.sin(2 * Math.PI * f * 3.5 * t)) * Math.exp(-t * 2.2); }
  return scale(x, v || 1);
}

// ---------------------------------------------------------------- 配乐
const CH = { Dm: [50, 53, 57], Bb: [46, 50, 53], F: [53, 57, 60], C: [48, 52, 55], Gm: [55, 58, 62], A: [45, 49, 52], D: [50, 54, 57] };
const ROOT = { Dm: 38, Bb: 34, F: 41, C: 36, Gm: 43, A: 33, D: 38 };
// 每半小节（1 秒）一个和弦
const HB = [];
const seq = (from, arr) => arr.forEach((c, k) => { HB[from + k] = c; });
seq(0, ['Dm', 'Dm', 'Dm', 'Dm']);                                            // 0–4 开场
seq(4, ['Dm', 'Dm', 'Bb', 'Bb', 'F', 'F', 'C', 'C', 'Dm', 'Dm', 'Bb', 'Bb']);   // 4–16 经营
seq(16, ['Gm', 'Gm', 'A', 'A']);                                              // 16–20 布阵
for (let k = 0; k < 5; k++) seq(20 + k * 4, ['Dm', 'Dm', 'Bb', 'Bb']);         // 20–40 开战（两小节一换）
seq(30, ['F', 'F', 'C', 'C']); seq(38, ['Gm', 'A']);
seq(40, ['Dm', 'Dm', 'Bb', 'Bb', 'F', 'F', 'Gm', 'A']);                       // 40–48
seq(48, ['Dm', 'Bb', 'C', 'A']);                                              // 48–52 高潮
seq(52, ['Bb', 'C', 'D', 'D']);                                               // 52–56 胜利
for (let k = 56; k < 64; k++) HB[k] = 'D';                                    // 片尾
const chordAt = t => HB[clamp(Math.floor(t), 0, 63)];

const M = (x, t, g, pan, send) => put(x, t, g, pan, send, 'm');
// 开场：重击 + 低音持续 + 高处的钟
M(impact(1, 4), 0.62, 0.9, 0, 0.5);
M(braam(38, 3.0, 1), 0.62, 0.55, 0, 0.6);
M(saws([midi(26), midi(38)], 3.6, { att: 0.8, rel: 1.2, cut: 500, voices: 3, det: 0.01 }), 0.0, 0.5, 0, 0.3);
[74, 77, 81, 86].forEach((n, k) => M(bell(midi(n), 1, 2.4), 1.0 + k * 0.5, 0.12, (k % 2 ? 0.4 : -0.4), 0.8));
M(riser(1.4, 1), 2.6, 0.18, 0, 0.4);

// 经营：琶音、轻鼓，越来越满
for (let t = 4; t < 20; t += 0.125) {
  const ch = CH[chordAt(t)], st = Math.round((t - 4) / 0.125), n = ch[st % 3] + 12 * (1 + ((st >> 2) % 2));
  if (t >= 16 && st % 2) continue;   // 布阵那段琶音稀一半
  M(pluck(midi(n), 1), t, (t < 16 ? 0.2 : 0.14) * (st % 4 === 0 ? 1.25 : 1), (st % 2 ? 0.35 : -0.35), 0.35);
}
for (let t = 4; t < 16; t += 2) {
  const c = chordAt(t);
  M(saws(CH[c].map(n => midi(n + 12)).concat([midi(CH[c][0])]), 2, { att: 0.3, rel: 0.5, cut: 2200, voices: 3, det: 0.012 }), t, 0.2, 0, 0.5);
  M(saws([midi(ROOT[c])], 1.9, { att: 0.02, rel: 0.1, cut: 600, sub: 0.15 }), t, 0.26, 0, 0.05);
  M(kick(0.9), t, 0.4, 0, 0.1); M(kick(0.8), t + 1, 0.34, 0, 0.1);
  if (t >= 12) { M(snare(1), t + 0.5, 0.28, 0.05, 0.3); M(snare(1), t + 1.5, 0.28, 0.05, 0.3); }
  for (let h = 0; h < 2; h += 0.5) M(hat(1), t + h + 0.25, 0.12, 0.3, 0.1);
}
// 布阵：鼓停了，只剩心跳一样的底鼓、滴答的镲，弦乐压着，最后一小节军鼓滚奏冲进开战
for (let t = 16; t < 20; t += 1) { M(kick(0.9), t, 0.45, 0, 0.2); M(kick(0.6), t + 0.22, 0.3, 0, 0.2); }
for (let t = 16; t < 20; t += 0.25) M(hat(0.8), t, 0.06, -0.3, 0.1);
M(saws([midi(43), midi(46), midi(50), midi(55)], 2, { att: 0.6, rel: 0.4, cut: 1300, voices: 4, det: 0.014 }), 16, 0.2, 0, 0.6);
M(saws([midi(45), midi(49), midi(52), midi(57)], 2, { att: 0.3, rel: 0.2, cut: 1600, voices: 4, det: 0.014 }), 18, 0.22, 0, 0.6);
M(saws([midi(31)], 4, { att: 0.5, rel: 0.2, cut: 300, sub: 0.6 }), 16, 0.35, 0, 0.1);
M(riser(3.0, 1), 17.0, 0.32, 0, 0.4);
for (let t = 19.0, k = 0; t < 19.98; k++) { M(snare(0.5 + 0.5 * (t - 19)), t, 0.18 + 0.14 * (t - 19), 0.05, 0.3); t += t < 19.5 ? 0.125 : 0.0625; }

// 开战（20–48）：重鼓、十六分音符低音、弦乐、每段开头一声铜管
function groove(t0, t1, hard) {
  for (let t = t0; t < t1 - 1e-6; t += 2) {
    M(kick(1), t, 0.62, 0, 0.1); M(kick(0.9), t + 0.75, 0.5, 0, 0.1); M(kick(1), t + 1, 0.6, 0, 0.1);
    if (hard) M(kick(0.8), t + 1.75, 0.45, 0, 0.1);
    M(snare(1), t + 0.5, 0.36, 0.05, 0.35); M(snare(1), t + 1.5, 0.36, 0.05, 0.35);
    for (let h = 0; h < 2; h += 0.125) M(hat(h % 0.5 === 0 ? 1 : 0.6), t + h, 0.07, 0.35, 0.05);
  }
}
groove(20, 40, false); groove(40, 48, true);
for (let t = 20; t < 48; t += 0.125) {   // 十六分音符低音：根音、根音、八度、根音……
  const c = chordAt(t), st = Math.round(t / 0.125) % 8, n = ROOT[c] + ([0, 0, 12, 0, 0, 12, 0, 7][st]);
  M(saws([midi(n)], 0.1, { att: 0.004, rel: 0.04, cut: 1100 + (t >= 40 ? 500 : 0), q: 1.6, sub: 0.12 }), t, 0.24, 0, 0.02);
}
for (let t = 20; t < 48; t += 2) {
  const c = chordAt(t);
  M(saws(CH[c].map(n => midi(n + 12)).concat([midi(CH[c][0])]), 2, { att: 0.15, rel: 0.4, cut: 2200, voices: 4, det: 0.012 }), t, t < 40 ? 0.14 : 0.19, 0, 0.6);
}
for (let t = 40; t < 48; t += 0.25) {   // 40 秒以后再加一层弦乐八分音符
  const c = chordAt(t), st = Math.round(t / 0.25) % 4, n = CH[c][[0, 1, 2, 1][st]] + 24;
  M(saws([midi(n)], 0.2, { att: 0.01, rel: 0.08, cut: 3000, voices: 3, det: 0.01 }), t, 0.06, (st % 2 ? 0.3 : -0.3), 0.5);
}
M(impact(1.1, 3.5), 20, 0.95, 0, 0.5); M(braam(38, 2.6, 1), 20, 0.6, 0, 0.6); M(crash(1), 20, 0.3, -0.2, 0.3);
M(crash(1), 28, 0.22, 0.2, 0.3); M(crash(1), 36, 0.22, -0.2, 0.3);
M(braam(38, 1.8, 0.8), 40, 0.45, 0, 0.5); M(crash(1), 40, 0.28, 0.2, 0.3);
for (const t of [27.25, 35.25, 43.25]) [0, 0.25, 0.5, 0.75].forEach((d, k) => M(tom([150, 120, 95, 75][k], 1), t + d, 0.4, 0.4 - k * 0.25, 0.3));
M(riser(2.0, 1), 46, 0.3, 0, 0.4);
for (let t = 47, k = 0; t < 47.98; k++) { M(snare(0.6 + 0.4 * (t - 47)), t, 0.2 + 0.16 * (t - 47), 0.05, 0.3); t += 0.0625; }

// 高潮（48–52）：每一秒一声铜管 + 重击，中间大鼓
['Dm', 'Bb', 'C', 'A'].forEach((c, k) => {
  const t = 48 + k;
  M(braam(ROOT[c] + 12, 0.95, 1), t, 0.55, 0, 0.6);
  M(impact(0.9, 1.6), t, 0.6 + k * 0.08, 0, 0.4);
  M(crash(1), t, 0.2, k % 2 ? 0.3 : -0.3, 0.3);
  for (let h = 0.25; h < 1; h += 0.25) M(tom([110, 90, 70][Math.round(h * 4) - 1], 1), t + h, 0.45, 0.2, 0.3);
  M(saws(CH[c].map(n => midi(n + 12)), 0.95, { att: 0.02, rel: 0.2, cut: 2600, voices: 4, det: 0.014 }), t, 0.2, 0, 0.6);
});

// 胜利（52–56）：转大调，半速的鼓，钟
M(impact(0.8, 3), 52, 0.55, 0, 0.6);
M(saws([midi(46), midi(50), midi(53), midi(58)], 1, { att: 0.05, rel: 0.3, cut: 2400, voices: 4, det: 0.012 }), 52, 0.24, 0, 0.7);
M(saws([midi(48), midi(52), midi(55), midi(60)], 1, { att: 0.05, rel: 0.3, cut: 2400, voices: 4, det: 0.012 }), 53, 0.24, 0, 0.7);
M(saws([midi(50), midi(54), midi(57), midi(62), midi(66)], 2.6, { att: 0.08, rel: 1.6, cut: 2800, voices: 4, det: 0.012 }), 54, 0.28, 0, 0.8);
M(saws([midi(34)], 1, { att: 0.02, rel: 0.2, cut: 500, sub: 0.5 }), 52, 0.4, 0, 0.1);
M(saws([midi(36)], 1, { att: 0.02, rel: 0.2, cut: 500, sub: 0.5 }), 53, 0.4, 0, 0.1);
M(saws([midi(38)], 2.4, { att: 0.02, rel: 1.4, cut: 500, sub: 0.5 }), 54, 0.42, 0, 0.1);
for (const t of [52, 53, 54]) { M(kick(1), t, 0.55, 0, 0.2); M(snare(1), t + 0.5, 0.3, 0.05, 0.5); }
M(crash(1), 54, 0.3, 0, 0.4);
[74, 78, 81, 86].forEach((n, k) => M(bell(midi(n), 1, 3), 54 + k * 0.25, 0.1, (k % 2 ? 0.4 : -0.4), 0.8));
M(riser(1.7, 1), 54.9, 0.2, 0, 0.5);

// 片尾（56–64）：标志出来那一下重击，D 大调长音慢慢收
M(impact(1.1, 5), 56.6, 0.85, 0, 0.7); M(braam(38, 3.5, 1), 56.6, 0.45, 0, 0.7);
M(saws([midi(38), midi(45), midi(50), midi(54), midi(57)], 5.4, { att: 0.4, rel: 1.6, cut: 1800, voices: 4, det: 0.012 }), 56.6, 0.2, 0, 0.8);
M(saws([midi(26)], 5.6, { att: 0.3, rel: 1.6, cut: 300, sub: 0.6 }), 56.6, 0.4, 0, 0.2);
[86, 90, 93, 98].forEach((n, k) => M(bell(midi(n), 1, 3), 57.2 + k * 0.4, 0.07, (k % 2 ? 0.45 : -0.45), 0.9));

// ---------------------------------------------------------------- 音效
const SM = 1;   // 慢动作：音调压低、拖长
function gun(kind, sl) {
  // kind：cannon 坦克炮、auto 机关炮、rifle 步枪、mg 机枪
  const d = kind === 'cannon' ? 1.1 : kind === 'auto' ? 0.35 : 0.18, x = buf(d / sl), n = buf(d / sl);
  for (let i = 0; i < n.length; i++) n[i] = noise();
  filt(n, 'lp', kind === 'cannon' ? 2200 * sl : kind === 'auto' ? 4200 * sl : 6500 * sl, 0.7);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR * sl;
    if (kind === 'cannon') { ph += (40 + 90 * Math.exp(-t * 25)) * sl / SR; x[i] = n[i] * (Math.exp(-t * 9) * 1.4 + Math.exp(-t * 60)) + Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7) * 1.1; }
    else if (kind === 'auto') { const burst = (Math.floor(t / 0.085) < 3) ? Math.exp(-(t % 0.085) * 45) : 0; x[i] = n[i] * burst * 1.2; }
    else x[i] = n[i] * Math.exp(-t * (kind === 'mg' ? 40 : 55)) * 1.2;
  }
  return x;
}
function boomSfx(s, sl, big) {
  const len = (big ? 4.5 : 1.2 + s * 0.9) / sl, x = buf(len), n = buf(len);
  for (let i = 0; i < n.length; i++) n[i] = noise();
  filt(n, 'lp', t => (big ? 1800 : 2600) * sl * Math.exp(-t * sl * 3.5) + 140, 0.7);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR * sl; ph += (30 + 60 * Math.exp(-t * 6)) * sl / SR;
    x[i] = (n[i] * (Math.exp(-t * (big ? 1.1 : 4.5 / Math.sqrt(s))) * 1.6 + Math.exp(-t * 40) * 0.8) + Math.sin(2 * Math.PI * ph) * Math.exp(-t * (big ? 0.9 : 4)) * (big ? 1.4 : 0.8 * s)) * Math.min(1, t * 400);
  }
  return x;
}
function zap(sl) {
  const x = buf(0.22 / sl); let ph = 0;
  for (let i = 0; i < x.length; i++) { const t = i / SR * sl; ph += (2600 * Math.exp(-t * 14) + 500) * sl / SR; x[i] = (Math.sin(2 * Math.PI * ph) + 0.4 * Math.sign(Math.sin(2 * Math.PI * ph * 0.5))) * Math.exp(-t * 14) * 0.6; }
  return filt(x, 'lp', 6000, 0.7);
}
function railSfx(sl) {
  const x = buf(1.0 / sl), n = buf(1.0 / sl);
  for (let i = 0; i < n.length; i++) n[i] = noise();
  filt(n, 'hp', 1500, 0.7);
  let ph = 0;
  for (let i = 0; i < x.length; i++) { const t = i / SR * sl; ph += (5200 * Math.exp(-t * 5) + 180) * sl / SR;
    x[i] = n[i] * Math.exp(-t * 18) * 1.6 + Math.sin(2 * Math.PI * ph) * Math.exp(-t * 4) * 0.35 + Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t * 6) * 0.9; }
  return x;
}
function launch(len, sl, low) {
  const x = buf(len / sl);
  for (let i = 0; i < x.length; i++) x[i] = noise();
  filt(x, 'bp', t => (low ? 500 : 1600) * sl * Math.pow(0.4, t * sl / len), 0.9);
  for (let i = 0; i < x.length; i++) { const t = i / SR * sl; x[i] *= Math.min(1, t * 60) * Math.exp(-t * 2.2 / len) * 2.2; }
  return x;
}
function whistle(sl) {
  const x = buf(0.9 / sl); let ph = 0;
  for (let i = 0; i < x.length; i++) { const t = i / SR * sl; ph += (1400 - 700 * t / 0.9) * sl / SR; x[i] = Math.sin(2 * Math.PI * ph) * Math.sin(Math.PI * t / 0.9) * 0.35; }
  return x;
}
function jetRoar(len) {
  const x = buf(len);
  for (let i = 0; i < x.length; i++) x[i] = noise();
  filt(x, 'lp', t => 700 + 2600 * Math.exp(-Math.pow((t / len - 0.45) * 4, 2)), 0.8);
  for (let i = 0; i < x.length; i++) { const u = i / x.length; x[i] *= Math.exp(-Math.pow((u - 0.45) * 3.2, 2)) * 2.6; }
  return x;
}
function buzz(sl) {
  const x = buf(1.4 / sl); let ph = 0;
  for (let i = 0; i < x.length; i++) { const t = i / SR * sl; ph += (190 + 25 * Math.sin(t * 40)) * sl / SR; const dt = 190 * sl / SR, p = ph % 1; x[i] = (2 * p - 1 - blep(p, dt)) * Math.min(1, t * 8) * Math.max(0, 1 - t / 1.4) * 0.35; }
  return filt(x, 'lp', 2500, 0.8);
}
const CANNON = new Set(['tank', 'heavytank', 'boss', 'td', 'railgun']), AUTO = new Set(['ifv', 'spaag', 'aa', 'heli', 'attacker', 'jeep', 'cram', 'fighter']), MG = new Set(['mg', 'commando']);
const X = (x, c, g, send) => {
  // 距离：越远越轻、越闷；左右按镜头右方向的偏移
  const d = Math.max(1, c.d || 1), gd = 1 / (1 + d / 110), pan = clamp((c.x || 0) / Math.max(d, 30) * 1.1, -0.85, 0.85);
  filt(x, 'lp', clamp(16000 * Math.exp(-d / 260), 900, 16000), 0.7);
  put(x, c.t, g * gd, pan, (send || 0.25) + Math.min(0.5, d / 1200), 'x');
};
const cnt = {};
for (const c of cues) {
  const sl = c.slow ? 0.72 : 1;
  cnt[c.k] = (cnt[c.k] || 0) + 1;
  switch (c.k) {
    case 'cut': if (c.t > 0.5 && ![20, 48, 49, 50, 51, 56].includes(Math.round(c.t))) M(whoosh(0.5, 1, false), c.t - 0.3, 0.14, 0, 0.3); break;
    case 'shot': {
      const kind = CANNON.has(c.u) ? 'cannon' : AUTO.has(c.u) ? 'auto' : MG.has(c.u) ? 'mg' : 'rifle';
      X(gun(kind, sl), c, kind === 'cannon' ? 1.6 : kind === 'auto' ? 0.7 : 0.38); break;
    }
    case 'laser': X(zap(sl), c, 0.5); break;
    case 'rail': X(railSfx(sl), c, 1.5, 0.4); break;
    case 'shell': X(gun('cannon', sl * 0.8), c, 1.4); break;
    case 'gshell': X(gun('cannon', sl * 0.9), c, 1.1); break;
    case 'mrocket': X(launch(0.9, sl, false), c, 0.6); break;
    case 'missile': X(launch(1.2, sl, false), c, 0.75); break;
    case 'abm': X(launch(1.0, sl, false), c, 1.1); X(gun('cannon', sl), c, 0.6); break;
    case 'ballistic': X(launch(3.2, sl, true), c, 2.2, 0.4); X(boomSfx(1.2, sl, false), c, 0.8); break;
    case 'boom': X(boomSfx(clamp(c.s || 1, 0.6, 2.2), sl, false), c, 1.5, 0.35); break;
    case 'mineboom': X(boomSfx(1.4, sl, false), c, 1.6, 0.35); break;
    case 'bigboom': X(boomSfx(3, sl, true), c, 3.2, 0.5); break;
    case 'intercept': X(boomSfx(0.6, sl, false), c, 0.55, 0.4); break;
    case 'bomb': X(whistle(sl), c, 0.5, 0.3); break;
    case 'flyover': { const x = jetRoar(4.5); if (c.skip) put(x.subarray(Math.min(x.length - 1, Math.round((c.skip + 0.6) * SR))), c.t, 0.7, 0, 0.3, 'x'); else put(x, c.t - 0.6, 0.7, 0, 0.3, 'x'); break; }
    case 'swarm': X(buzz(sl), c, 0.9); break;
    case 'heal': case 'jam': case 'ability': X(bell(midi(84), 1, 1.2), c, 0.25, 0.5); break;
  }
}
// 战场底噪：开战到胜利一直有远处的隆隆声
{ const x = buf(33); for (let i = 0; i < x.length; i++) x[i] = noise(); filt(x, 'lp', 180, 0.7);
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] *= Math.min(1, t / 0.5) * Math.min(1, (33 - t) / 1.5) * 1.6 * (1 + 0.3 * Math.sin(t * 1.3)); }
  put(x, 20, 0.2, 0, 0.2, 'x'); }

// ---------------------------------------------------------------- 混响（Freeverb：8 个梳状 + 4 个全通，左右错开）
function freeverb(inp, spread) {
  const k = SR / 44100, out = new Float32Array(inp.length);
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(n => ({ b: new Float32Array(Math.round((n + spread) * k)), i: 0, f: 0 }));
  const aps = [556, 441, 341, 225].map(n => ({ b: new Float32Array(Math.round((n + spread) * k)), i: 0 }));
  const room = 0.86, damp = 0.25;
  for (let j = 0; j < inp.length; j++) {
    const x = inp[j] * 0.015; let y = 0;
    for (const c of combs) { const o = c.b[c.i]; c.f = o * (1 - damp) + c.f * damp; c.b[c.i] = x + c.f * room; if (++c.i >= c.b.length) c.i = 0; y += o; }
    for (const a of aps) { const o = a.b[a.i]; const v = -y + o; a.b[a.i] = y + o * 0.5; if (++a.i >= a.b.length) a.i = 0; y = v; }
    out[j] = y;
  }
  return out;
}
const RVL = freeverb(VL, 0), RVR = freeverb(VR, 23);

// ---------------------------------------------------------------- 总混：配乐压在音效下面一点；高潮处音效让一让配乐；软削波、归一化
const L = new Float32Array(N), R = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const t = i / SR, mg = 0.8, xg = 0.62;
  L[i] = ML[i] * mg + XL[i] * xg + RVL[i] * 2.2;
  R[i] = MR[i] * mg + XR[i] * xg + RVR[i] * 2.2;
  if (t > 63.2) { const f = Math.max(0, 1 - (t - 63.2) / 0.8); L[i] *= f; R[i] *= f; }
}
// 均衡：低频搁架往下压约 5 dB（底鼓、次低音、爆炸叠起来太闷，手机、笔记本喇叭只剩一团）、3 kHz 以上提一点、32 Hz 以下切掉
for (const x of [L, R]) {
  const lo = filt(Float32Array.from(x), 'lp', 140, 0.707), hi = filt(Float32Array.from(x), 'hp', 3000, 0.707);
  for (let i = 0; i < N; i++) x[i] = x[i] - 0.45 * lo[i] + 0.3 * hi[i];
  filt(x, 'hp', 32, 0.707);
}
// 简单的压缩：按 30 毫秒的峰值包络把太响的地方往下压
{ let env = 0; const att = Math.exp(-1 / (0.003 * SR)), rel = Math.exp(-1 / (0.25 * SR)), th = 0.55;
  for (let i = 0; i < N; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
    const g = env > th ? Math.pow(th / env, 0.6) : 1; L[i] *= g; R[i] *= g; } }
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = 0.98 / Math.max(1e-6, Math.tanh(peak * 1.15) / 1.0);
const pcm = Buffer.alloc(44 + N * 4);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.round(clamp(Math.tanh(L[i] * 1.15) * norm, -1, 1) * 32767), 44 + i * 4);
  pcm.writeInt16LE(Math.round(clamp(Math.tanh(R[i] * 1.15) * norm, -1, 1) * 32767), 46 + i * 4);
}
fs.writeFileSync(outPath, pcm);
console.log('配乐写好：' + outPath + '（' + LEN + ' 秒，音效 ' + JSON.stringify(cnt) + '）');
