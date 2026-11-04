'use strict';
// 编辑器：局部自由动画（用户：能设计动画，比如坦克的开火动画——模型上任何一个部件都能单独动，想怎么动就怎么动；「拆成碎片跳舞」只是打个比方；自由度拉满、非常好上手）
//   「模型与挂点」页里车辆、飞机模型多一段「动画」：
//   ① 分组：自动拆成 N 块（按块的位置聚类）、按模型自带的部件分（炮塔、炮管、车轮……）、或者把选中的块设成一组；
//   ② 选时机：开炮时、挨打时、走着时（循环）、停着时（循环）、被打掉时；飞机：发射 / 开火时、飞着时（循环）、停在地上时（循环）、被击落时（v3g.js v3gPlaneAn）；
//   ③ 点预设（散开跳舞、炸开再合上、原地转圈、弹跳、摇摆、震动、后坐、脉冲、悬浮、波浪），或者自己拖时间轴、给某一组在某一刻摆姿势（挪、转、缩放）记成关键帧；
//   ④ ▶ 预览里马上动起来看；保存后游戏里到那个时机就播（mod.js modAnimNow → v3g.js v3gAnimDraw）。数据格式见 mod.js「动画」那一段
const MAN = { ev: 'fire', play: false, t: 0, raf: 0, last: 0, g: -1, amp: 1, n: 10, ax: 'y', key: '', vg: null, vgK: '' };
const MAN_EV = [['fire', '开炮时'], ['hit', '挨打时'], ['move', '走着时（循环）'], ['idle', '停着时（循环）'], ['die', '被打掉时']];
const MAN_EV_AIR = [['fire', '发射 / 开火时'], ['move', '飞着时（循环）'], ['idle', '停在地上时（循环）'], ['die', '被击落时']];   // 飞机没记挨打时刻
const MAN_DEF = { fire: { dur: 2.5, loop: 0 }, hit: { dur: .8, loop: 0 }, move: { dur: 2, loop: 1 }, idle: { dur: 3, loop: 1 }, die: { dur: 3, loop: 0, back: false } };
const MAN_PRE = [['recoil', '后坐（往后一顿再复位）'], ['shake', '震动'], ['open', '开合（绕转动中心转过去再回来）'], ['lift', '升降'], ['push', '伸出再缩回'], ['spin', '转一圈'], ['sway', '来回摆'], ['pulse', '变大变小'],
  ['bounce', '弹跳'], ['float', '飘起来'], ['wave', '波浪'], ['explode', '炸开再合上'], ['dance', '散开乱跳']];
const MAN_AX = [['y', '绕左右轴（抬起 / 放下）'], ['x', '绕前后轴（侧倾）'], ['z', '绕竖轴（左右转）']];
const manAxI = () => ({ x: 0, y: 1, z: 2 })[MAN.ax] ?? 1;
const MAN_EASE = [['io', '平滑'], ['lin', '匀速'], ['out', '先快后慢'], ['in', '先慢后快'], ['back', '冲过头再回来'], ['bounce', '弹几下'], ['step', '一下跳过去']];
const MAN_COL = ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#c77dff', '#ff9f45', '#00c2d1', '#f15bb5', '#9bdeac', '#fee440', '#7b8cde', '#e07a5f'];
const manM = mk => { const M = typeof mdxPcM === 'function' ? mdxPcM(mk) : null; return M && M.pv ? M : null; };
const manOff = mk => { const S0 = typeof mdxPtState === 'function' ? mdxPtState(mk) : null; return (S0 && S0.off) || [0, 0, 0]; };
const manA = mk => MDX_W.mdl[mk] || {};
const manClip = (mk, ev, make) => {
  const A = make ? (MDX_W.mdl[mk] = MDX_W.mdl[mk] || {}) : manA(mk), an = make ? (A.an = A.an || {}) : A.an || {};
  if (!an[ev] && make) an[ev] = { ...MAN_DEF[ev], tr: {} };
  return an[ev] || null;
};
// 每组的块、中心
function manGroupBox(M, ids, off) {
  const bb = mdxPcBB(M), b = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30];
  for (const i of ids) { if (i >= M.pn || bb[i * 6] > bb[i * 6 + 3]) continue; for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], bb[i * 6 + k] - off[k]); b[k + 3] = Math.max(b[k + 3], bb[i * 6 + 3 + k] - off[k]); } }
  return b[0] > b[3] ? null : b;
}
const R4 = v => Math.round(v * 1e4) / 1e4;
function manSetGroups(mk, L) {   // L：[{ nm, ids }]
  const M = manM(mk), off = manOff(mk), A = MDX_W.mdl[mk] = MDX_W.mdl[mk] || {};
  A.ag = L.filter(g => g.ids.length).map(g => { const b = manGroupBox(M, g.ids, off); return { nm: g.nm, id: modIdsEnc(g.ids), cp: b ? [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2].map(R4) : [0, 0, 0] }; });
  if (!A.ag.length) delete A.ag;
  if (A.an) for (const ev in A.an) { const c = A.an[ev]; for (const gi in c.tr || {}) if (!A.ag || +gi >= A.ag.length) delete c.tr[gi]; }
  MAN.g = -1; MDX.dirty = true;
}
// 自动拆成 N 块：按每块的中心聚类（大块权重大），从最大的一块开始，每次挑离已选中心最远的当新中心，再迭代几轮
function manSplit(mk, N) {
  const M = manM(mk), off = manOff(mk), S0 = mdxPtState(mk), bb = mdxPcBB(M), P = [];
  for (let i = 0; i < M.pn; i++) { if ((S0 && S0.R[i] === MOD_PT_DEL) || bb[i * 6] > bb[i * 6 + 3]) continue; P.push({ i, c: [0, 1, 2].map(k => (bb[i * 6 + k] + bb[i * 6 + 3 + k]) / 2 - off[k]), w: Math.max(1, (M.ptri || [])[i] || 1) }); }
  N = Math.max(1, Math.min(N, P.length));
  if (!P.length) return 0;
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2, C = [P.reduce((a, b) => b.w > a.w ? b : a).c.slice()];
  while (C.length < N) { let best = null, bd = -1; for (const p of P) { const d = Math.min(...C.map(c => d2(c, p.c))) * Math.sqrt(p.w); if (d > bd) { bd = d; best = p; } } C.push(best.c.slice()); }
  let as = new Int32Array(P.length);
  for (let it = 0; it < 12; it++) {
    P.forEach((p, j) => { let bi = 0, bd = 1e30; C.forEach((c, ci) => { const d = d2(c, p.c); if (d < bd) { bd = d; bi = ci; } }); as[j] = bi; });
    const S = C.map(() => [0, 0, 0, 0]);
    P.forEach((p, j) => { const s = S[as[j]]; for (let k = 0; k < 3; k++) s[k] += p.c[k] * p.w; s[3] += p.w; });
    S.forEach((s, ci) => { if (s[3] > 0) C[ci] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const G = C.map((c, ci) => ({ nm: '碎片 ' + (ci + 1), ids: P.filter((p, j) => as[j] === ci).map(p => p.i) })).filter(g => g.ids.length);
  manSetGroups(mk, G);
  return G.length;
}
// 预设：给这些组按时长生成关键帧。A 幅度（米），dir 组中心离整车中心的方向，i / n 第几组 / 一共几组
function manPreset(mk, ev, pre, only) {
  const M = manM(mk), A = manA(mk), G = A.ag || [], c = manClip(mk, ev, true), dur = +c.dur || 2, b = M.m.bb, ctr = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  const L = Math.max(b[3] - b[0], b[4] - b[1], 1), amp = L * .12 * MAN.amp, n = G.length;
  const ids = only != null && only >= 0 ? [only] : G.map((g, i) => i);
  if (pre === 'spin' && ev !== 'die') { c.loop = c.loop ?? 1; }
  ids.forEach(gi => {
    const g = G[gi], cp = g.cp || ctr, dv = [cp[0] - ctr[0], cp[1] - ctr[1], (cp[2] - ctr[2]) * .5 + .15], dl = Math.hypot(...dv) || 1, dir = dv.map(v => v / dl), ph = gi * 2.399, K = [], at = u => +(u * dur).toFixed(3);
    const out = (k, extra = [0, 0, 0]) => dir.map((v, j) => +(v * amp * k + extra[j]).toFixed(3));
    if (pre === 'dance') {
      K.push({ t: at(.12), p: out(1.4, [0, 0, amp * .5]), r: [0, 0, 0], s: 1, e: 'out' });
      for (let j = 1; j <= 6; j++) { const u = .12 + j * .76 / 7, w = Math.sin(j * 1.9 + ph); K.push({ t: at(u), p: out(1.4, [0, 0, amp * (.5 + .55 * Math.abs(w))]), r: [+(12 * Math.sin(j + ph)).toFixed(1), +(18 * w).toFixed(1), +(45 * Math.sin(j * 1.3 + ph)).toFixed(1)], s: 1, e: 'io' }); }
      K.push({ t: at(.88), p: out(1.4, [0, 0, amp * .3]), r: [0, 0, 0], s: 1, e: 'io' });
    } else if (pre === 'explode') {
      const rr = [((gi * 47) % 120) - 60, ((gi * 83) % 120) - 60, ((gi * 29) % 240) - 120];
      K.push({ t: at(.3), p: out(2.6, [0, 0, amp]), r: rr, s: 1, e: 'out' }, { t: at(.62), p: out(2.6, [0, 0, amp * .8]), r: rr, s: 1, e: 'io' });
    } else if (pre === 'spin') { const r = [0, 0, 0]; r[manAxI()] = 360; K.push({ t: 0, p: [0, 0, 0], r: [0, 0, 0], s: 1 }, { t: at(1), p: [0, 0, 0], r, s: 1, e: 'lin' }); }
    else if (pre === 'open') { const r = [0, 0, 0]; r[manAxI()] = +(-75 * MAN.amp).toFixed(1); K.push({ t: at(.3), p: [0, 0, 0], r, s: 1, e: 'out' }, { t: at(.7), p: [0, 0, 0], r, s: 1, e: 'io' }); }
    else if (pre === 'lift') K.push({ t: at(.35), p: [0, 0, +(amp * .4).toFixed(3)], r: [0, 0, 0], s: 1, e: 'io' }, { t: at(.65), p: [0, 0, +(amp * .4).toFixed(3)], r: [0, 0, 0], s: 1, e: 'io' });
    else if (pre === 'push') K.push({ t: at(.3), p: [+(amp * .45).toFixed(3), 0, 0], r: [0, 0, 0], s: 1, e: 'out' }, { t: at(.65), p: [+(amp * .45).toFixed(3), 0, 0], r: [0, 0, 0], s: 1, e: 'io' });
    else if (pre === 'bounce') K.push({ t: at(.3), p: [0, 0, +(amp * 1.2).toFixed(3)], r: [0, 0, 0], s: 1, e: 'out' }, { t: at(.75), p: [0, 0, 0], r: [0, 0, 0], s: 1, e: 'bounce' });
    else if (pre === 'sway') { const a1 = [0, 0, 0], a2 = [0, 0, 0]; a1[manAxI()] = +(12 * MAN.amp).toFixed(1); a2[manAxI()] = -a1[manAxI()]; K.push({ t: at(.25), p: [0, 0, 0], r: a1, s: 1, e: 'io' }, { t: at(.75), p: [0, 0, 0], r: a2, s: 1, e: 'io' }); }
    else if (pre === 'shake') for (let j = 1; j < 12; j++) { const q = amp * .12 * (1 - j / 13); K.push({ t: at(j / 12), p: [+(Math.sin(j * 7.1 + ph) * q).toFixed(3), +(Math.sin(j * 4.3 + ph) * q).toFixed(3), +(Math.sin(j * 9.7 + ph) * q * .5).toFixed(3)], r: [0, 0, 0], s: 1, e: 'lin' }); }
    else if (pre === 'recoil') K.push({ t: +(Math.min(.08, dur * .05)).toFixed(3), p: [+(-amp * .45).toFixed(3), 0, 0], r: [0, 0, 0], s: 1, e: 'out' }, { t: at(.55), p: [0, 0, 0], r: [0, 0, 0], s: 1, e: 'io' });
    else if (pre === 'pulse') K.push({ t: at(.5), p: [0, 0, 0], r: [0, 0, 0], s: +(1 + .3 * MAN.amp).toFixed(3), e: 'io' });
    else if (pre === 'float') K.push({ t: at(.5), p: [0, 0, +(amp * .7).toFixed(3)], r: [0, 0, +(10 * Math.sin(ph)).toFixed(1)], s: 1, e: 'io' });
    else if (pre === 'wave') { const x0 = (cp[0] - b[0]) / Math.max(.1, b[3] - b[0]); for (let j = 1; j <= 7; j++) K.push({ t: at(j / 8), p: [0, 0, +(amp * .6 * Math.sin(j / 8 * 6.283 * 2 - x0 * 6.283)).toFixed(3)], r: [0, 0, 0], s: 1, e: 'io' }); }
    c.tr[gi] = K;
  });
  if (pre === 'spin') c.back = false;
  MDX.dirty = true;
}
// 预览：每组按此刻的姿势把顶点挪过去再传给显卡（停下来、换页时传回原样）
function manVGroups(M, A) {
  const k = JSON.stringify((A.ag || []).map(g => g.id));
  if (MAN.vg && MAN.vgK === k && MAN.vgM === M) return MAN.vg;
  const pg = new Int16Array(M.pn).fill(-1);
  (A.ag || []).forEach((g, gi) => { for (const i of modIdsDec(g.id)) if (i < M.pn && pg[i] < 0) pg[i] = gi; });
  const vg = new Int16Array(M.nv);
  for (let v = 0; v < M.nv; v++) vg[v] = pg[M.pv[v]];
  MAN.vg = vg; MAN.vgK = k; MAN.vgM = M;
  return vg;
}
function manPose(mk, t) {
  const M = manM(mk);
  if (!M || !MIV.gl) return;
  const A = manA(mk), c = (A.an || {})[MAN.ev], G = A.ag || [];
  if (!c || !G.length) { manRestore(); return; }
  const P = modAnimEval(c, t), vg = manVGroups(M, A), off = manOff(mk), st = M.st, VB = M.VB, out = MAN.buf && MAN.buf.length === VB.length ? MAN.buf : (MAN.buf = new Float32Array(VB.length));
  out.set(VB);
  const T = G.map((g, gi) => { const q = P[gi]; if (!q) return null; return { R: modRotM(q.r), p: q.p, s: q.s > .001 ? q.s : .001, c: g.cp || [0, 0, 0] }; });
  for (let v = 0; v < M.nv; v++) {
    const g = vg[v], X = g >= 0 ? T[g] : null;
    if (!X) continue;
    const o = v * st, R = X.R, x = VB[o] - off[0] - X.c[0], y = VB[o + 1] - off[1] - X.c[1], z = VB[o + 2] - off[2] - X.c[2], nx = VB[o + 3], ny = VB[o + 4], nz = VB[o + 5];
    out[o] = X.c[0] + X.p[0] + X.s * (R[0] * x + R[1] * y + R[2] * z) + off[0]; out[o + 1] = X.c[1] + X.p[1] + X.s * (R[3] * x + R[4] * y + R[5] * z) + off[1]; out[o + 2] = X.c[2] + X.p[2] + X.s * (R[6] * x + R[7] * y + R[8] * z) + off[2];
    out[o + 3] = R[0] * nx + R[1] * ny + R[2] * nz; out[o + 4] = R[3] * nx + R[4] * ny + R[5] * nz; out[o + 5] = R[6] * nx + R[7] * ny + R[8] * nz;
  }
  const gl = MIV.gl; gl.bindBuffer(gl.ARRAY_BUFFER, M.vb); gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
  MAN.posed = M; mivDraw();
}
function manRestore() {
  const M = MAN.posed;
  MAN.posed = null;
  if (!M || !MIV.gl || MIV.M !== M) return;
  const gl = MIV.gl; gl.bindBuffer(gl.ARRAY_BUFFER, M.vb); gl.bufferData(gl.ARRAY_BUFFER, M.VB, gl.STATIC_DRAW); mivDraw();
}
function manTick(now) {
  const mk = MDX.sel, ok = MAN.play && MDX.el && !MDX.el.hidden && MDX.tab === 'mdl' && MIV.wrap && MIV.wrap.isConnected && manM(mk);
  if (!ok) { MAN.play = false; MAN.raf = 0; manRestore(); manBar(); return; }
  const c = (manA(mk).an || {})[MAN.ev], dur = Math.max(.05, (c && +c.dur) || 1), dt = Math.min(.1, (now - MAN.last) / 1000); MAN.last = now;
  MAN.t += dt;
  if (MAN.t > dur) MAN.t = c && c.loop ? MAN.t % dur : (MAN.t > dur + .6 ? 0 : MAN.t);   // 只播一遍的：停半秒再从头
  manPose(mk, Math.min(MAN.t, dur));
  manBar();
  MAN.raf = requestAnimationFrame(manTick);
}
function manPlay(on) {
  MAN.play = on;
  cancelAnimationFrame(MAN.raf); MAN.raf = 0;
  if (on) { MAN.last = performance.now(); MAN.raf = requestAnimationFrame(manTick); } else manPose(MDX.sel, MAN.t);
}
// 时间轴上的游标、读数（不重建整页）
function manBar() {
  const el = MDX.el && MDX.el.querySelector('.man-tl');
  if (!el) return;
  const c = (manA(MDX.sel).an || {})[MAN.ev], dur = Math.max(.05, (c && +c.dur) || 1), u = clamp(MAN.t / dur, 0, 1);
  for (const cur of el.querySelectorAll('.man-cur')) cur.style.left = (u * 100) + '%';
  const s = MDX.el.querySelector('[data-mant="t"]'); if (s && document.activeElement !== s) s.value = MAN.t.toFixed(2);
  const r = MDX.el.querySelector('[data-mant="tr"]'); if (r && document.activeElement !== r) r.value = MAN.t.toFixed(2);
  const pb = MDX.el.querySelector('[data-manp="play"]'); if (pb) pb.textContent = MAN.play ? '⏸ 暂停' : '▶ 播放';
}
function manForm(mk, air) {
  const M = manM(mk), A = manA(mk), G = A.ag || [], EV = air ? MAN_EV_AIR : MAN_EV;
  if (!EV.some(e => e[0] === MAN.ev)) MAN.ev = 'fire';
  const btn = (attr, t, on, tip) => `<button type="button" class="mdx-btn${on ? ' pri' : ''}" ${attr}${tip ? ` title="${mdxEsc(tip)}"` : ''}>${t}</button>`;
  let h = `<h3 style="margin-top:12px">${air ? '动画：自己设计发射、飞行、停放、被击落时怎么动' : '动画：自己设计开炮、挨打、走、停、被打掉时怎么动'}</h3>`;
  if (!M) return h + '<p class="note">模型读出来以后才能做动画（上面的预览加载完会自动刷新这一段）。</p>';
  const c = (A.an || {})[MAN.ev], dur = Math.max(.05, (c && +c.dur) || MAN_DEF[MAN.ev].dur);
  h += `<p class="note">模型上任何一部分都能单独动：① 选出要动的部件（在模型上点选，或者按模型自带的${air ? '起落架、弹舱门、旋翼' : '炮塔、炮管、车轮'}……分）② 选什么时候播 ③ 点一个动作预设，或者自己拖时间轴、给这个部件在某一刻摆姿势（挪、转、缩放）记成关键帧，
      转动中心可以在模型上点、也能输数（${air ? '座舱盖、舱门' : '舱盖'}绕铰链开合就把中心放在铰链上）④ ▶ 播放看效果，满意就保存，游戏里到那个时机就这么动。</p>
    ${air ? '' : `<div class="mdx-pcbar">${btn('data-mana="demo"', '示例：开炮时炮管后坐、炮塔一震', false, '按模型自带的部件找出炮管、炮塔，开炮时炮管往后坐、炮塔跟着一震')}</div>`}
    <div class="mdx-pcbar"><b>① 要动的部件</b>${btn('data-pk="pc"', '在模型上点选', MDX.pk === 'pc', '在预览里点一块就选上 / 取消（黄色）；部件那一段有框选、按整个部件选')}${btn('data-mana="bysel"', '选中的设成一个部件', false, '点选好以后点这个')}
      ${btn('data-mana="bynode"', '按模型自带的部件分', false, '炮塔、炮管、车轮……各一个')}${btn('data-mana="split"', '自动拆成', false, '按位置聚成几块（拆碎片的效果用）')} <input type="number" min="2" max="60" step="1" data-manf="n" value="${MAN.n}" style="width:56px"> 块${G.length ? btn('data-mana="clr"', '清空分组') : ''}</div>
    <div class="man-chips">${G.length ? G.map((g, gi) => `<button type="button" class="man-chip${MAN.g === gi ? ' on' : ''}" data-mang="${gi}" style="--c:${MAN_COL[gi % MAN_COL.length]}">${mdxEsc(g.nm)}<small>${modIdsDec(g.id).length} 块</small></button>`).join('') + `<button type="button" class="man-chip${MAN.g < 0 ? ' on' : ''}" data-mang="-1" style="--c:#aaa">全部组</button>` : '<span class="def">还没分组：整车不动（先分组才能让各部分各动各的）</span>'}</div>
    <div class="mdx-pcbar"><b>② 什么时候播</b>${EV.map(([k, n]) => btn(`data-mane="${k}"`, n + ((A.an || {})[k] ? ' ●' : ''), MAN.ev === k)).join('')}</div>
    <div class="mdx-pcbar">时长 <input type="number" min=".1" max="60" step=".1" data-manf="dur" value="${dur}" style="width:64px"> 秒
      <label><input type="checkbox" data-manf="loop"${(c ? c.loop : MAN_DEF[MAN.ev].loop) ? ' checked' : ''}> 循环</label><label><input type="checkbox" data-manf="back"${(c ? c.back : MAN_DEF[MAN.ev].back) !== false ? ' checked' : ''}> 播完回到原位</label>${c ? btn('data-mana="delclip"', '删掉这一段动画') : ''}</div>
    <div class="mdx-pcbar"><b>③ 动作预设</b><span class="def">套给${MAN.g >= 0 && G[MAN.g] ? '「' + mdxEsc(G[MAN.g].nm) + '」' : '全部部件'}</span> 幅度 <input type="range" min=".2" max="4" step=".1" data-manf="amp" value="${MAN.amp}" style="width:90px">
      转的话 <select data-manf="ax">${MAN_AX.map(([k, n]) => `<option value="${k}"${MAN.ax === k ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="mdx-pcbar">${MAN_PRE.map(([k, n]) => btn(`data-manpre="${k}"`, n)).join('')}</div>`;
  // 时间轴：每组一行、关键帧是点；游标跟着播
  const rows = G.map((g, gi) => { const K = (c && c.tr && c.tr[gi]) || []; return `<div class="man-row${MAN.g === gi ? ' on' : ''}" data-mang="${gi}"><span class="man-rn" style="color:${MAN_COL[gi % MAN_COL.length]}">${mdxEsc(g.nm)}</span><span class="man-track">${K.map(k => `<i class="man-key" data-mank="${gi}|${k.t}" style="left:${clamp(k.t / dur, 0, 1) * 100}%;background:${MAN_COL[gi % MAN_COL.length]}" title="${k.t} 秒"></i>`).join('')}<i class="man-cur"></i></span></div>`; }).join('');
  h += `<div class="mdx-pcbar"><b>时间轴</b>${btn('data-manp="play"', MAN.play ? '⏸ 暂停' : '▶ 播放', MAN.play)}${btn('data-manp="zero"', '回到开头')}
      <input type="range" min="0" max="${dur}" step=".01" data-mant="tr" value="${Math.min(MAN.t, dur)}" style="flex:1;min-width:140px"> <input type="number" min="0" max="${dur}" step=".05" data-mant="t" value="${Math.min(MAN.t, dur).toFixed(2)}" style="width:64px"> 秒</div>
    <div class="man-tl">${rows || ''}</div>`;
  // 关键帧：选中的组在这一刻的姿势
  if (MAN.g >= 0 && G[MAN.g]) {
    const K = (c && c.tr && c.tr[MAN.g]) || [], kn = K.find(k => Math.abs(k.t - MAN.t) < .03), P = kn ? { p: kn.p || [0, 0, 0], r: kn.r || [0, 0, 0], s: kn.s ?? 1 } : (c ? modAnimPose(K, MAN.t, dur, c.back) : null) || { p: [0, 0, 0], r: [0, 0, 0], s: 1 }, e = (kn && kn.e) || 'io';
    const num = (f, v, w = 64) => `<input type="number" step="any" data-mank-f="${f}" value="${+(+v).toFixed(3)}" style="width:${w}px">`;
    const cp = G[MAN.g].cp || [0, 0, 0];
    h += `<div class="mdx-pcbar"><b>「${mdxEsc(G[MAN.g].nm)}」的转动中心</b> x <input type="number" step="any" data-manc="0" value="${cp[0]}" style="width:70px"> y <input type="number" step="any" data-manc="1" value="${cp[1]}" style="width:70px"> z <input type="number" step="any" data-manc="2" value="${cp[2]}" style="width:70px"> 米
      ${btn('data-mana="pickcp"', MDX.pk === 'anpv' ? '在模型上点一下…' : '在模型上点一下定中心', MDX.pk === 'anpv', '转、缩放都绕这一点（舱盖开合放在铰链上，炮管抬起放在炮耳上）')}${btn('data-mana="cpmid"', '放回部件中间')}</div>
      <div class="mdx-pcbar"><b>「${mdxEsc(G[MAN.g].nm)}」在 ${MAN.t.toFixed(2)} 秒的姿势</b>${kn ? '<span class="def">（这一刻有关键帧，改了直接更新）</span>' : '<span class="def">（改了就在这一刻加一个关键帧）</span>'}</div>
      <div class="mdx-pcbar">挪 x ${num('p.0', P.p[0])} y ${num('p.1', P.p[1])} z ${num('p.2', P.p[2])} 米　转 侧滚 ${num('r.0', P.r[0])} 俯仰 ${num('r.1', P.r[1])} 方位 ${num('r.2', P.r[2])} 度　缩放 ${num('s', P.s, 56)} 倍</div>
      <div class="mdx-pcbar">到这一帧的缓动 <select data-mank-f="e">${MAN_EASE.map(([k, n]) => `<option value="${k}"${e === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
        ${kn ? btn('data-mana="kdel"', '删掉这一帧') : btn('data-mana="kadd"', '在这一刻记关键帧')}${K.length ? btn('data-mana="kclr"', '清空这一组的关键帧') : ''}</div>`;
  } else if (G.length) h += '<p class="note">点上面一组（或时间轴左边的组名），就能给它在任意时刻摆姿势、记关键帧。</p>';
  return h;
}
// 这一组在这一刻写一个关键帧（有就改）
function manKeySet(mk, f, v) {
  const c = manClip(mk, MAN.ev, true), gi = MAN.g, K = c.tr[gi] = c.tr[gi] || [], dur = +c.dur || 1, t = +clamp(MAN.t, 0, dur).toFixed(3);
  let k = K.find(q => Math.abs(q.t - t) < .03);
  if (!k) { const P = modAnimPose(K, t, dur, c.back) || { p: [0, 0, 0], r: [0, 0, 0], s: 1 }; k = { t, p: P.p.map(R4), r: P.r.map(R4), s: R4(P.s), e: 'io' }; K.push(k); K.sort((a, b) => a.t - b.t); }
  if (f === 'e') k.e = v;
  else if (f === 's') k.s = v > 0 ? v : 1;
  else if (f) { const [a, i] = f.split('.'); k[a] = (k[a] || [0, 0, 0]).slice(); k[a][+i] = v; }
  MDX.dirty = true;
}
function manSelGroup(mk, gi) {
  MAN.g = gi;
  const A = manA(mk), g = (A.ag || [])[gi];
  if (g && MDX.pc) { MDX.pc.sel = new Set(modIdsDec(g.id)); if (typeof mdxPtSync === 'function') mdxPtSync(); }
}
function manClick(b) {
  const d = b.dataset, mk = MDX.sel, M = manM(mk);
  if (!M) return false;
  const A = manA(mk);
  if (d.mana) {
    const a = d.mana;
    if (a === 'demo') {   // 局部动画的示例：按模型自带的部件找出炮管、炮塔，开炮时炮管往后坐、炮口一抬，炮塔跟着一震
      const nodes = M.nodes || [], find = re => nodes.map((nd, i) => re.test(nd.n) ? i : -1).filter(i => i >= 0), gN = find(/炮管/), tN = find(/炮塔/);
      if (!gN.length && !tN.length) { mdxMsg('这个模型没有现成的炮管、炮塔部件：先点「在模型上点选」把炮管点出来，「选中的设成一个部件」，再点「后坐」'); return true; }
      const of = L => { const o = []; if (M.pnd) for (let i = 0; i < M.pn; i++) if (L.includes(M.pnd[i])) o.push(i); return o; }, G0 = [];
      if (gN.length) G0.push({ nm: '炮管', ids: of(gN) });
      if (tN.length) G0.push({ nm: '炮塔', ids: of(tN) });
      manSetGroups(mk, G0);
      MAN.ev = 'fire'; const c = manClip(mk, 'fire', true); c.dur = 1.2; c.loop = 0; delete c.back; c.tr = {};
      const A2 = manA(mk), gi = A2.ag.findIndex(g => g.nm === '炮管'), ti = A2.ag.findIndex(g => g.nm === '炮塔');
      if (gi >= 0) c.tr[gi] = [{ t: .05, p: [-.45, 0, 0], r: [0, -1.5, 0], s: 1, e: 'out' }, { t: .7, p: [0, 0, 0], r: [0, 0, 0], s: 1, e: 'io' }];
      if (ti >= 0) c.tr[ti] = [{ t: .04, p: [-.06, 0, .02], r: [0, -1.2, 0], s: 1, e: 'out' }, { t: .25, p: [.02, 0, 0], r: [0, .5, 0], s: 1, e: 'io' }, { t: .5, p: [0, 0, 0], r: [0, 0, 0], s: 1, e: 'io' }];
      MAN.g = gi; MAN.t = 0; MDX.dirty = true; MDX.keep = true; mdxRender(); manPlay(true);
      mdxMsg('开炮时：炮管往后坐 0.45 米、炮口一抬，炮塔跟着一震（预览在播）。点部件、拖时间轴接着改；别的部件同样点选出来自己做');
      return true;
    }
    if (a === 'pickcp') { MDX.pk = MDX.pk === 'anpv' ? '' : 'anpv'; MDX.keep = true; mdxRender(); if (MDX.pk) mdxMsg('在模型上点一下：转动中心挪到那里'); return true; }
    if (a === 'cpmid') { const g = (A.ag || [])[MAN.g]; if (g) { const b2 = manGroupBox(M, modIdsDec(g.id), manOff(mk)); if (b2) g.cp = [(b2[0] + b2[3]) / 2, (b2[1] + b2[4]) / 2, (b2[2] + b2[5]) / 2].map(R4); MDX.dirty = true; } }
    if (a === 'split') { const n = manSplit(mk, MAN.n); mdxMsg(`拆成了 ${n} 组`); }
    else if (a === 'bynode') { const L = (M.nodes || []).map((nd, i) => ({ nm: nd.n, ids: [] })); if (M.pnd) for (let i = 0; i < M.pn; i++) if (L[M.pnd[i]]) L[M.pnd[i]].ids.push(i); const G = L.filter(g => g.ids.length).slice(0, 40); manSetGroups(mk, G); mdxMsg(`按部件分成了 ${G.length} 组`); }
    else if (a === 'bysel') { if (!MDX.pc.sel.size) { mdxMsg('先在「部件」那一段点「选部件」，在预览里点选要一起动的块'); return true; } const S0 = new Set(MDX.pc.sel), L = (A.ag || []).map(g => ({ nm: g.nm, ids: modIdsDec(g.id).filter(i => !S0.has(i)) })); L.push({ nm: '组 ' + (L.length + 1), ids: [...S0] }); manSetGroups(mk, L); MAN.g = (manA(mk).ag || []).length - 1; mdxMsg('选中的 ' + S0.size + ' 块设成了一组'); }
    else if (a === 'clr') { manSetGroups(mk, []); manRestore(); }
    else if (a === 'delclip') { if (A.an) { delete A.an[MAN.ev]; if (!Object.keys(A.an).length) delete A.an; MDX.dirty = true; } manRestore(); }
    else if (a === 'kadd') manKeySet(mk, null);
    else if (a === 'kdel') { const c = manClip(mk, MAN.ev), K = c && c.tr && c.tr[MAN.g]; if (K) { const i = K.findIndex(k => Math.abs(k.t - MAN.t) < .03); if (i >= 0) K.splice(i, 1); MDX.dirty = true; } }
    else if (a === 'kclr') { const c = manClip(mk, MAN.ev); if (c && c.tr) { delete c.tr[MAN.g]; MDX.dirty = true; } }
    MDX.keep = true; mdxRender(); if (!MAN.play) manPose(mk, MAN.t);
    return true;
  }
  if (d.mane) { MAN.ev = d.mane; MAN.t = 0; MDX.keep = true; mdxRender(); manPose(mk, 0); return true; }
  if (d.manpre) { if (!(A.ag || []).length) manSplit(mk, MAN.n); manPreset(mk, MAN.ev, d.manpre, MAN.g); MAN.t = 0; MDX.keep = true; mdxRender(); manPlay(true); mdxMsg('套上了「' + (MAN_PRE.find(p => p[0] === d.manpre) || [, ''])[1] + '」，预览在播；可以接着改关键帧，满意就保存'); return true; }
  if (d.manp === 'play') { manPlay(!MAN.play); manBar(); return true; }
  if (d.manp === 'zero') { MAN.t = 0; manPlay(false); manBar(); return true; }
  if (d.mank) { const [gi, t] = d.mank.split('|'); MAN.t = +t; manSelGroup(mk, +gi); manPlay(false); MDX.keep = true; mdxRender(); manPose(mk, MAN.t); return true; }
  if (d.mang != null) { manSelGroup(mk, +d.mang); MDX.keep = true; mdxRender(); if (!MAN.play) manPose(mk, MAN.t); return true; }
  return false;
}
function manChange(t, live) {
  const d = t.dataset, mk = MDX.sel;
  if (!manM(mk)) return false;
  if (d.manf) {
    const f = d.manf;
    if (f === 'n') { MAN.n = clamp(Math.round(+t.value || 10), 2, 60); return true; }
    if (f === 'amp') { MAN.amp = clamp(+t.value || 1, .2, 4); return true; }
    if (f === 'ax') { MAN.ax = t.value; return true; }
    if (live) return true;
    const c = manClip(mk, MAN.ev, true);
    if (f === 'dur') { const v = +t.value; if (v > 0) { const k = v / (+c.dur || v); c.dur = v; for (const gi in c.tr) for (const q of c.tr[gi]) q.t = +(q.t * k).toFixed(3); } }   // 改时长：关键帧按比例跟着伸缩
    else if (f === 'loop') c.loop = t.checked ? 1 : 0;
    else if (f === 'back') { if (t.checked) delete c.back; else c.back = false; }
    MDX.dirty = true; MDX.keep = true; mdxRender(); manPose(mk, MAN.t);
    return true;
  }
  if (d.manc != null) {   // 转动中心
    if (live) return true;
    const g = (manA(mk).ag || [])[MAN.g], v = +t.value;
    if (g && isFinite(v)) { g.cp = (g.cp || [0, 0, 0]).slice(); g.cp[+d.manc] = v; MDX.dirty = true; MDX.keep = true; mdxRender(); manPose(mk, MAN.t); }
    return true;
  }
  if (d.mant) { MAN.t = Math.max(0, +t.value || 0); if (MAN.play) manPlay(false); manPose(mk, MAN.t); manBar(); if (!live) { MDX.keep = true; mdxRender(); } return true; }
  if (d.mankF) {
    if (MAN.g < 0) return true;
    if (live && t.type !== 'number') return true;
    const f = d.mankF, v = f === 'e' ? t.value : +t.value;
    if (f !== 'e' && !isFinite(v)) return true;
    if (live) return true;   // 数字打完（change）才记
    manKeySet(mk, f, v); MDX.keep = true; mdxRender(); manPose(mk, MAN.t);
    return true;
  }
  return false;
}
// —— 接到 modui.js 上 ——
if (typeof mdxMdlForm === 'function') {
  const f0 = mdxMdlForm;
  mdxMdlForm = function (mk) {
    const h = f0.apply(this, arguments), md = typeof mdxModels === 'function' && mdxModels().find(r => r.id === mk);
    if (!md) return h;
    if (MAN.key !== mk) { MAN.key = mk; MAN.g = -1; MAN.t = 0; MAN.play = false; }
    const air = md.kind === 'air', part = manForm(mk, air), i = h.indexOf(air ? '<h3 style="margin-top:12px">挂点' : '<h3 style="margin-top:12px">主炮炮口');   // 飞机：放在挂点前面
    return i < 0 ? h + part : h.slice(0, i) + part + h.slice(i);
  };
}
if (typeof mdxBuild === 'function') {
  const b0 = mdxBuild;
  mdxBuild = function () {
    if (MDX.el) return MDX.el;
    const el = b0.apply(this, arguments), st = document.createElement('style');
    st.textContent = `#mdx .man-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }
#mdx .man-chip { border: 1px solid var(--c); border-left-width: 6px; background: rgba(0, 0, 0, .25); color: var(--text); border-radius: 5px; padding: 4px 9px; font: inherit; font-size: 12px; cursor: pointer; display: flex; gap: 6px; align-items: baseline; }
#mdx .man-chip small { color: var(--mute); font-size: 11px; }
#mdx .man-chip.on { background: rgba(255, 255, 255, .12); box-shadow: 0 0 0 1px var(--c) inset; }
#mdx .man-tl { display: grid; gap: 3px; margin: 2px 0 8px; }
#mdx .man-row { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 8px; align-items: center; cursor: pointer; border-radius: 4px; padding: 1px 4px; }
#mdx .man-row.on { background: rgba(255, 255, 255, .08); }
#mdx .man-rn { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#mdx .man-track { position: relative; height: 16px; background: rgba(0, 0, 0, .3); border: 1px solid var(--line); border-radius: 3px; }
#mdx .man-key { position: absolute; top: 3px; width: 9px; height: 9px; margin-left: -5px; border-radius: 50%; border: 1px solid #000; cursor: pointer; }
#mdx .man-cur { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #fff; pointer-events: none; }`;
    document.head.appendChild(st);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-mana], [data-mane], [data-manpre], [data-manp], [data-mank], [data-mang]');
      if (!b || MDX.tab !== 'mdl') return;
      if ((b.dataset.mana || b.dataset.manpre) && typeof muxBefore === 'function') muxBefore(false);   // 改数据的记撤销（modux.js）
      if (manClick(b)) e.stopPropagation();
    }, true);
    el.addEventListener('input', e => { const t = e.target; if (MDX.tab === 'mdl' && (t.dataset.manf || t.dataset.mant || t.dataset.mankF || t.dataset.manc != null) && manChange(t, true)) e.stopPropagation(); }, true);
    el.addEventListener('change', e => { const t = e.target; if (MDX.tab === 'mdl' && (t.dataset.manf || t.dataset.mant || t.dataset.mankF || t.dataset.manc != null)) { if (typeof muxBefore === 'function' && !t.dataset.mant) muxBefore(false); if (manChange(t, false)) e.stopPropagation(); } }, true);
    return el;
  };
}
// 换页、换模型、关掉编辑器：预览里摆着的姿势放回去
if (typeof mdxRender === 'function') {
  const r0 = mdxRender;
  mdxRender = function (listOnly) {
    const k0 = MAN.key, out = r0.apply(this, arguments);
    if (!listOnly && (MDX.tab !== 'mdl' || MDX.sel !== k0)) { MAN.play = false; manRestore(); }
    else if (!listOnly && MAN.posed && !MAN.play) manPose(MDX.sel, MAN.t);
    return out;
  };
}

// 在模型上点转动中心（点选模式 anpv）；预览上标出选中部件的转动中心
if (typeof mdxOnPick === 'function') {
  const o0 = mdxOnPick;
  mdxOnPick = function (h) {
    if (MDX.pk === 'anpv') {
      const mk = MDX.sel, g = (manA(mk).ag || [])[MAN.g], p = (MDX.pc && MDX.pc.snap && h.vp ? h.vp : h.p).map(R4);
      if (g) { g.cp = p; MDX.dirty = true; }
      MDX.pk = ''; MDX.keep = true; mdxRender(); manPose(mk, MAN.t); mdxMsg('转动中心挪到了（' + p.join(', ') + '）');
      return;
    }
    return o0.apply(this, arguments);
  };
}
if (typeof mdxMarks === 'function') {
  const k0 = mdxMarks;
  mdxMarks = function () {
    const out = k0.apply(this, arguments), g = MDX.tab === 'mdl' && MDX.sel ? (manA(MDX.sel).ag || [])[MAN.g] : null;
    if (g && Array.isArray(g.cp)) out.push({ p: g.cp, c: '#ffffff', t: '转动中心', r: 6 });
    return out;
  };
}
