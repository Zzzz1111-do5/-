'use strict';
// 编辑器：导弹尾烟设计、特效动图、抛射与点火（用户：导弹我要能自己设计尾烟；那些特效要变成动图，我要能自己选；飞机把导弹抛下后几秒开始点火）
//   「导弹尾烟」页：每型导弹（或整类一起：空空弹、防空导弹、巡航导弹……）的烟量、留多久、粗细、变粗、浓淡、颜色、往上飘、随风、扭动，发动机烧几秒、续航，
//     尾焰长短粗细、颜色、光晕；用不用序列帧烟团。上面一个一直在飞的预览（二维模拟，参数和游戏里 v3fx.js v3fTrl 一一对应），下面一排会动的预设卡片，点一下就套上。
//   「特效贴图」页的「换掉游戏里的特效」：每个特效一排会动的卡片（原来的 ArmyVFX、导入的），点卡片换；ArmyVFX 是分通道的贴图，卡片里按游戏的着色合成成看得懂的颜色。
//   「机载武器」页最上面「抛射与点火」：主弹舱 / 侧弹舱 / 外挂抛离后几秒点火（airmdl.js AIR_IGN；每型武器在自己那页还能单独设）
const MFX = { sheets: new Map(), sims: new WeakMap(), raf: 0, cards: [] };
const MFX_CLS = [['aam', '空空导弹'], ['sam', '大型防空导弹'], ['sams', '近程防空导弹'], ['manpad', '便携防空导弹'], ['agm', '小型空地导弹'], ['cruise', '巡航 / 反舰导弹'], ['big', '鹰击-21（大助推）'], ['tbm', '弹道导弹']];
const MFX_NM = { pl15: '霹雳-15', pl10: '霹雳-10', pl17: '霹雳-17', aim120: 'AIM-120', aim9: 'AIM-9X', ld10: '雷电-10', hhq9: '海红旗-9', hhq16: '海红旗-16', sm6: '标准-6', hhq10: '红旗-10', manpad: '便携防空导弹',
  yj21: '鹰击-21', yj18: '鹰击-18', yj12: '鹰击-12', yj83: '鹰击-83', yj83k: '鹰击-83K', yj62: '鹰击-62', cj10: '长剑-10', kd88: 'KD-88', kd20: '空地-20', nsm: 'NSM 反舰导弹', lrasm: 'LRASM', tomahawk: '战斧',
  agm: '蓝箭-7 / 红箭-10', agm65: 'AGM-65 小牛', sdb: '飞腾-8 / GBU-53', bomb: '航弹', tbm: '战术弹道导弹', df15: '东风-15B' };
// 参数：[键, 名称, 最小, 最大, 步长, 单位]
const MFX_F = [['sm', '烟量', 0, 2, .05, ''], ['life', '烟留多久', .5, 40, .5, '秒'], ['w', '烟的起始粗细', .1, 10, .05, '米'], ['grow', '越飘越粗', 0, 3, .05, '倍'], ['op', '浓淡', 0, 2, .05, '倍'],
  ['rise', '往上飘', -1, 3, .05, '米 / 秒'], ['wind', '随风飘', 0, 4, .05, '倍'], ['tw', '扭着散开', 0, 4, .05, '倍'], ['burn', '主发动机烧几秒', 0, 30, .1, '秒'], ['sus', '续航烧到第几秒', 0, 40, .1, '秒'],
  ['fl', '尾焰长', 0, 40, .1, '米'], ['fw', '尾焰粗细', 0, 4, .05, '倍'], ['glow', '光晕', 0, 3, .05, '倍']];
const MFX_PRE = [
  ['照发动机类（默认）', {}],
  ['固体火箭 · 浓白烟', { sm: 1.1, life: 16, w: 1.6, grow: 1.2, op: 1.1, col: '#f4f4f2', rise: .3, fl: 6, fc: '#ffa040', cc: '#fff6e0', jet: 0 }],
  ['少烟推进剂 · 淡淡一条', { sm: .3, life: 6, w: .7, grow: .8, op: .7, col: '#dfe3e6', fl: 4.5, fc: '#ff9a3a', jet: 0 }],
  ['双脉冲 · 两段烟', { sm: .9, burn: 3, sus: 9, life: 12, w: 1.1, jet: 0 }],
  ['黑烟 · 老式推进剂', { sm: 1.2, life: 14, w: 1.4, op: 1.25, col: '#3a3836', fc: '#ff7a20', jet: 0 }],
  ['冲压 / 涡喷 · 不冒烟', { sm: 0, jet: 1, fl: 2.5, fc: '#ff5a1a', glow: .7 }],
  ['弹道导弹 · 粗烟柱', { sm: 1.3, life: 30, w: 6, grow: 1.4, op: 1.2, fl: 30, fc: '#ffb050', cc: '#ffffff', jet: 0 }],
  ['表演彩烟 · 红', { sm: 1.2, life: 18, w: 1.8, col: '#e8543c', op: 1.2, jet: 0 }],
  ['序列帧烟团', { spr: 'puff', sm: 1, life: 14, w: 1.6, jet: 0 }]
];
const mfxCls = k => k.startsWith('@') ? k.slice(1) : (typeof V3F_MK === 'object' && V3F_MK[k]) || 'aam';
// 一型现在的样子：发动机类的默认 ← 整类改过的 ← 这一型改过的（正在编辑的副本）
function mfxStyle(k, extra) {
  const cls = mfxCls(k), M = (typeof V3F_MOT === 'object' && V3F_MOT[cls]) || { burn: 5, sus: 0, smoke: .6, life: 10, w: 1, fl: 4 }, T = (MDX_W && MDX_W.trl) || {};
  const base = { sm: M.smoke, life: M.life, w: M.w, burn: M.burn ?? 0, sus: M.sus ?? 0, fl: M.fl, jet: M.jet ? 1 : 0, grow: 1, op: 1, rise: .3, wind: 1, tw: 1, fw: 1, glow: 1, col: '#f4f4f2', fc: '#ffa842', cc: '#fffaeb', spr: '' };
  if (cls === 'tbm' && !(T['@tbm'] || {}).burn && !(T[k] || {}).burn) base.burn = 12;
  return { ...base, ...(k.startsWith('@') ? {} : T['@' + cls] || {}), ...(T[k] || {}), ...(extra || {}) };
}
const mfxRgb = c => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '')); const n = m ? parseInt(m[1], 16) : 0xf4f4f2; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
// —— 序列帧贴图 → 能直接画的图（分通道的按游戏着色器的算法合成颜色）——
function mfxSheet(key) {
  let S0 = MFX.sheets.get(key);
  if (S0) return S0;
  S0 = { ok: false, img: null, n: 1, f: 1, add: false };
  MFX.sheets.set(key, S0);
  const T = typeof V3V_TEX === 'object' && V3V_TEX[key], usr = typeof V3V_USR === 'object' && V3V_USR[key];
  if (!T) return S0;
  S0.n = T.n; S0.f = T.f; S0.add = (T.col | 0) === 2 || (T.col | 0) === 0;
  const done = img => {
    const cv = document.createElement('canvas'), W0 = Math.min(1024, img.width), H0 = Math.round(img.height * W0 / img.width);
    cv.width = W0; cv.height = H0;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0, W0, H0);
    if ((T.col | 0) === 0) {   // 分通道：A 透明、B 火光、R / G 两个方向的受光 → 预乘过的颜色（黑底上叠加着看）
      const D = g.getImageData(0, 0, W0, H0), p = D.data;
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i] / 255, gg = p[i + 1] / 255, b = p[i + 2] / 255, a = p[i + 3] / 255, l = r * .4 + gg * .6, sm = .32 * (.55 + .45 * l) + .55 * l;
        const fr = b * b * 1.6, f0 = Math.min(1, (b - .15) / .45), fc = [.95 + .05 * f0, .22 + .44 * f0, .04 + .22 * f0];
        p[i] = Math.min(255, (sm * a + fc[0] * fr) * 255); p[i + 1] = Math.min(255, (sm * a * .97 + fc[1] * fr) * 255); p[i + 2] = Math.min(255, (sm * a * .93 + fc[2] * fr) * 255); p[i + 3] = 255;
      }
      g.putImageData(D, 0, 0);
    }
    S0.img = cv; S0.ok = true;
  };
  if (usr && usr.blob) createImageBitmap(usr.blob).then(done, () => {});
  else { const v = typeof window === 'object' && window.DS_BUILD ? '?v=' + window.DS_BUILD : '', I = new Image(); I.onload = () => done(I); I.src = 'assets/vfx/' + key + '.webp' + v; }
  return S0;
}
// —— 尾烟预览（二维模拟：一枚导弹从左飞到右，按参数喷烟、喷火；和游戏里一样的规律，只是侧面看）——
function mfxSimDraw(cv, P, dt) {
  let st = MFX.sims.get(cv);
  if (!st) MFX.sims.set(cv, st = { t: 0, pf: [], last: -1 });
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, sc = W / 320, T = Math.max(6, Math.min(16, (P.burn || 0) + 4));   // 320 米宽的一段天空；一个循环 T 秒
  st.t += dt;
  if (st.t > T + Math.min(P.life, 10)) { st.t = 0; st.pf.length = 0; }
  const age = st.t, v = 30 + 26 * Math.min(age, 8), x = -20 + 15 * age * age + 30 * age, y = H * .58 - age * 3 * sc, flying = x < 340;
  const burn = age < P.burn, sus = !burn && age < P.sus, jet = P.jet && !burn, on = flying && (burn || sus || jet);
  const sm = burn ? P.sm * (age < 1 ? 1.25 : 1) : sus ? P.sm * .3 : 0;
  if (flying && sm > .01 && age - st.last > .04) { st.last = age; st.pf.push({ x, y: y / sc, t: st.t, s: sm }); if (st.pf.length > 400) st.pf.shift(); }
  // 天空
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#6f8fb3'); bg.addColorStop(1, '#c7d4df');
  g.globalCompositeOperation = 'source-over'; g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const [cr, cg, cb] = mfxRgb(P.col), Sh = P.spr ? mfxSheet(P.spr) : null;
  for (const q of st.pf) {
    const a = st.t - q.t, f = 1 - a / P.life;
    if (f <= 0) continue;
    const r = P.w * (.7 + 1.3 * P.grow * Math.sqrt(a) + .1 * a) * sc * 1.4, px = (q.x + 4 * a * P.wind + Math.sin(q.t * 9 + a) * P.tw * Math.sqrt(a) * 1.5) * sc, py = (q.y - P.rise * a * 1.2 + Math.cos(q.t * 7 + a * .7) * P.tw * Math.sqrt(a)) * sc;
    const al = Math.min(1, .5 * q.s * f * Math.sqrt(f) * Math.min(1, a / .15) * P.op), c = a < 1.5 ? 1 : a < 6 ? .94 : .88;
    if (al < .01) continue;
    if (Sh && Sh.ok) {
      const fr = Math.min(Sh.f - 1, Math.floor(a / P.life * Sh.f)), cw = Sh.img.width / Sh.n, ch = Sh.img.height / Sh.n;
      g.globalAlpha = al; g.globalCompositeOperation = Sh.add ? 'lighter' : 'source-over';
      g.drawImage(Sh.img, (fr % Sh.n) * cw, Math.floor(fr / Sh.n) * ch, cw, ch, px - r * 1.2, py - r * 1.2, r * 2.4, r * 2.4);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      continue;
    }
    const gr = g.createRadialGradient(px, py, 0, px, py, r);
    gr.addColorStop(0, `rgba(${cr * c | 0},${cg * c | 0},${cb * c | 0},${al})`); gr.addColorStop(1, `rgba(${cr * c | 0},${cg * c | 0},${cb * c | 0},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill();
  }
  if (!flying) return;
  const mx = x * sc, my = y;
  if (on) {   // 尾焰：外层的火、白热的芯、光晕（涡喷只有一点暗红光）
    const fk = .85 + .15 * Math.sin(st.t * 57) * Math.sin(st.t * 23), FL = (jet && !burn ? 1.2 : P.fl * (sus ? .45 : 1)) * sc * 2.2 * fk, FW = Math.max(1.5, (jet && !burn ? .6 : 1.2) * P.fw * sc * 1.6), [fr, fg, fb] = mfxRgb(jet && !burn ? '#ff5020' : P.fc), [kr, kg, kb] = mfxRgb(P.cc);
    g.globalCompositeOperation = 'lighter';
    if (P.glow > 0) { const gl = g.createRadialGradient(mx - 6 * sc, my, 0, mx - 6 * sc, my, FW * 6 * P.glow); gl.addColorStop(0, `rgba(${fr},${fg * .8 | 0},${fb * .6 | 0},.35)`); gl.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gl; g.beginPath(); g.arc(mx - 6 * sc, my, FW * 6 * P.glow, 0, 6.2832); g.fill(); }
    const lg = g.createLinearGradient(mx - 6 * sc, 0, mx - 6 * sc - FL, 0); lg.addColorStop(0, `rgba(${fr},${fg},${fb},.95)`); lg.addColorStop(1, `rgba(${fr},${fg * .4 | 0},${fb * .2 | 0},0)`);
    g.fillStyle = lg; g.beginPath(); g.ellipse(mx - 6 * sc - FL / 2, my, FL / 2, FW, 0, 0, 6.2832); g.fill();
    if (!(jet && !burn)) { const kg2 = g.createLinearGradient(mx - 6 * sc, 0, mx - 6 * sc - FL * .5, 0); kg2.addColorStop(0, `rgba(${kr},${kg},${kb},1)`); kg2.addColorStop(1, `rgba(${kr},${kg * .8 | 0},${kb * .5 | 0},0)`); g.fillStyle = kg2; g.beginPath(); g.ellipse(mx - 6 * sc - FL * .25, my, FL * .25, FW * .45, 0, 0, 6.2832); g.fill(); }
    g.globalCompositeOperation = 'source-over';
  }
  g.fillStyle = '#d9dcd8'; g.fillRect(mx - 6 * sc, my - 1.2 * sc, 8 * sc, 2.4 * sc);   // 弹体
  g.fillStyle = '#9aa09a'; g.fillRect(mx + 1.5 * sc, my - 1.2 * sc, .8 * sc, 2.4 * sc);
}
// 一帧：所有看得见的动图（预览、预设卡片、特效卡片）
function mfxTick(now) {
  const el = typeof MDX === 'object' && MDX.el;
  if (!el || el.hidden || !el.isConnected) { MFX.raf = 0; return; }
  const dt = Math.min(.05, (now - (MFX.last || now)) / 1000); MFX.last = now;
  let any = false;
  for (const cv of el.querySelectorAll('canvas.mfx-sim')) {
    any = true;
    const k = cv.dataset.k, pi = cv.dataset.pre;
    mfxSimDraw(cv, mfxStyle(k, pi != null ? (MFX_PRE[+pi] || [, {}])[1] : null), dt);
  }
  for (const cv of el.querySelectorAll('canvas.mfx-sp')) {
    any = true;
    const Sh = mfxSheet(cv.dataset.k), g = cv.getContext('2d');
    g.globalCompositeOperation = 'source-over'; g.fillStyle = '#15191b'; g.fillRect(0, 0, cv.width, cv.height);
    if (!Sh.ok) continue;
    const fr = Math.floor(now / 1000 * 24) % Sh.f, cw = Sh.img.width / Sh.n, ch = Sh.img.height / Sh.n;
    g.globalCompositeOperation = Sh.add ? 'lighter' : 'source-over';
    g.drawImage(Sh.img, (fr % Sh.n) * cw, Math.floor(fr / Sh.n) * ch, cw, ch, 0, 0, cv.width, cv.height);
    g.globalCompositeOperation = 'source-over';
  }
  MFX.raf = any ? requestAnimationFrame(mfxTick) : 0;
}
const mfxRun = () => { if (!MFX.raf && typeof requestAnimationFrame === 'function') MFX.raf = requestAnimationFrame(mfxTick); };
// —— 「导弹尾烟」页 ——
function mfxTrlForm(k) {
  const P = mfxStyle(k), cur = (MDX_W.trl || {})[k] || {}, cls = mfxCls(k), cn = (MFX_CLS.find(c => c[0] === cls) || [, cls])[1];
  const sl = ([f, nm, mn, mx, stp, unit]) => `<div class="mdx-row${cur[f] != null ? ' chg' : ''}"><label>${nm}${unit ? '（' + unit + '）' : ''}</label><input type="range" min="${mn}" max="${mx}" step="${stp}" data-mfx="${f}" value="${P[f]}"><span class="def" data-mfxv="${f}">${+(+P[f]).toFixed(2)}</span><button type="button" class="mdx-rst" data-mfxr="${f}" title="恢复默认">↺</button></div>`;
  const col = (f, nm) => `<div class="mdx-row${cur[f] != null ? ' chg' : ''}"><label>${nm}</label><input type="color" data-mfx="${f}" value="${mdxEsc(P[f])}"><span></span><button type="button" class="mdx-rst" data-mfxr="${f}" title="恢复默认">↺</button></div>`;
  const sprs = ['', 'puff', ...Object.keys(MOD.lib).filter(id => MOD.lib[id].k === 'fx')];
  return `<h3>${mdxEsc(k.startsWith('@') ? cn + '（整类一起改）' : (MFX_NM[k] || k))}</h3><p class="note">${k.startsWith('@') ? '这一类导弹都按这里画（单独改过的型号以它自己的为准）。' : '发动机类：' + mdxEsc(cn) + '（没改的照整类的）。'}
    预览是侧面看一枚刚发射的导弹（真实大小的 320 米），参数和游戏里一一对应；保存后游戏里发射的导弹就按这个画。</p>
    <canvas class="mfx-sim mfx-big" data-k="${mdxEsc(k)}" width="640" height="200"></canvas>
    <h3 style="margin-top:10px">预设（点一下套上，可以接着调）</h3><div class="mfx-cards">${MFX_PRE.map(([nm], i) => `<button type="button" class="mfx-card" data-mfxp="${i}"><canvas class="mfx-sim" data-k="${mdxEsc(k)}" data-pre="${i}" width="200" height="74"></canvas><span>${mdxEsc(nm)}</span></button>`).join('')}</div>
    <h3 style="margin-top:10px">发动机</h3><div class="mdx-row${cur.jet != null ? ' chg' : ''}"><label>主发动机烧完以后</label><select data-mfx="jet"><option value="0"${!P.jet ? ' selected' : ''}>固体火箭：烧完就滑翔（续航段小火、淡烟）</option><option value="1"${P.jet ? ' selected' : ''}>涡喷 / 冲压续航：不冒烟，弹尾一点暗红光</option></select><span></span><button type="button" class="mdx-rst" data-mfxr="jet">↺</button></div>
    ${MFX_F.filter(r => ['burn', 'sus'].includes(r[0])).map(sl).join('')}
    <h3 style="margin-top:10px">尾烟</h3>${MFX_F.filter(r => ['sm', 'life', 'w', 'grow', 'op', 'rise', 'wind', 'tw'].includes(r[0])).map(sl).join('')}${col('col', '烟的颜色')}
    <div class="mdx-row"><label>烟团用序列帧</label><span class="mfx-cards">${sprs.map(id => `<button type="button" class="mfx-card sm${(P.spr || '') === id ? ' on' : ''}" data-mfxs="${mdxEsc(id)}">${id ? `<canvas class="mfx-sp" data-k="${mdxEsc(id)}" width="64" height="64"></canvas>` : '<span class="mfx-none">不用（程序烟团）</span>'}<span>${id ? mdxEsc(id === 'puff' ? 'ArmyVFX 烟团' : (MOD.lib[id] || {}).nm || id) : '程序烟团'}</span></button>`).join('')}</span><span></span><span></span></div>
    <h3 style="margin-top:10px">尾焰</h3>${MFX_F.filter(r => ['fl', 'fw', 'glow'].includes(r[0])).map(sl).join('')}${col('fc', '火的颜色')}${col('cc', '焰芯的颜色')}
    <p><button type="button" class="mdx-btn" data-mfxa="clear">这一型全部恢复默认</button></p>`;
}
function mfxSet(k, f, v) {
  const T = MDX_W.trl = MDX_W.trl || {}, o = T[k] = T[k] || {};
  if (v === '' || v == null) delete o[f]; else o[f] = v;
  if (!Object.keys(o).length) delete T[k];
  MDX.dirty = true;
}
// —— 「特效贴图」页：换掉游戏里的特效（会动的卡片）——
function mfxSlotForm() {
  const fxs = Object.keys(MOD.lib).filter(id => MOD.lib[id].k === 'fx'), L = typeof MDX_SLOT === 'object' ? MDX_SLOT : [];
  return `<h3>换掉游戏里的特效</h3><p class="note">每一种特效下面一排会动的卡片：第一张是游戏原来的（ArmyVFX），后面是导入的序列帧。点卡片换，点「保存」生效（帧数不一样也行，按总帧数换算）。</p>` +
    L.map(([s, n]) => `<h3 style="margin-top:10px">${mdxEsc(n)}</h3><div class="mfx-cards">${['', ...fxs].map(id => `<button type="button" class="mfx-card${(MDX_W.fx[s] || '') === id ? ' on' : ''}" data-mfxslot="${s}|${mdxEsc(id)}"><canvas class="mfx-sp" data-k="${mdxEsc(id || s)}" width="120" height="120"></canvas><span>${id ? mdxEsc(MOD.lib[id].nm) : '原来的'}</span></button>`).join('')}</div>`).join('') +
    (fxs.length ? '' : '<p class="note">还没有导入的序列帧：点左边「＋ 导入序列帧贴图」。</p>');
}
// —— 「机载武器」页：抛射与点火 ——
function mfxRelForm() {
  const R = MDX_W.rel || {}, D = typeof AIR_IGN0 === 'object' ? AIR_IGN0 : { main: 1.2, side: .3, ext: .8 };
  const row = (k, nm, tip) => mdxRow('rel', k, nm, '秒', D[k], R[k]) + `<p class="note" style="margin:-2px 0 6px">${tip}</p>`;
  return `<h3>抛射与点火</h3><p class="note">飞机打出去的导弹先抛离、掉一段，过几秒发动机才点火（之前没有尾焰、没有烟，导引头也还没开始管）。AI 开的飞机、亲自驾驶都按这里；每型武器在它自己那页还能单独设「抛离后几秒点火」。</p>` +
    row('main', '内埋主弹舱', '弹射臂把弹从舱里往下推出去，自由落下一段再点火') + row('ext', '外挂', '弹从翼下挂架脱离，往下掉一段再点火') + row('side', '侧弹舱（挂架推出舱外的近距格斗弹）', '挂架推出舱外，在舱外点火');
}
// —— 接到 modui.js 上 ——
if (typeof MDX_TABS === 'object' && !MDX_TABS.some(t => t[0] === 'trl')) { const i = MDX_TABS.findIndex(t => t[0] === 'msl'); MDX_TABS.splice(i + 1, 0, ['trl', '导弹尾烟']); }
if (typeof MDX_WPN_F === 'object' && !MDX_WPN_F.some(r => r[0] === 'ign')) MDX_WPN_F.push(['ign', '抛离后几秒点火（空着 = 按挂的位置，见「抛射与点火」）', '秒']);
if (typeof mdxItems === 'function') {
  const i0 = mdxItems;
  mdxItems = function () {
    if (MDX.tab === 'trl') {
      const T = (MDX_W && MDX_W.trl) || {};
      return [...MFX_CLS.map(([c, n]) => ({ id: '@' + c, nm: n + '（整类）', sub: '这一类导弹一起改', mod: !!T['@' + c] })),
        ...Object.keys(typeof V3F_MK === 'object' ? V3F_MK : {}).filter(k => V3F_MK[k] !== 'none').map(k => ({ id: k, nm: MFX_NM[k] || k, sub: (MFX_CLS.find(c => c[0] === V3F_MK[k]) || [, ''])[1], mod: !!T[k] }))];
    }
    const L = i0.apply(this, arguments);
    if (MDX.tab === 'wpn') return [{ id: '@rel', nm: '抛射与点火', sub: '抛离后几秒点火', mod: !!Object.keys((MDX_W && MDX_W.rel) || {}).length }, ...L];
    return L;
  };
}
if (typeof mdxForm === 'function') {
  const f0 = mdxForm;
  mdxForm = function () {
    if (MDX.tab === 'trl') { setTimeout(mfxRun, 0); return mfxTrlForm(MDX.sel); }
    if (MDX.tab === 'wpn' && MDX.sel === '@rel') return mfxRelForm();
    if (MDX.tab === 'fx' && MDX.sel === 'slots') { setTimeout(mfxRun, 0); return mfxSlotForm(); }
    const h = f0.apply(this, arguments);
    if (MDX.tab === 'fx' || MDX.tab === 'trl') setTimeout(mfxRun, 0);
    return h;
  };
}
if (typeof mdxBuild === 'function') {
  const b0 = mdxBuild;
  mdxBuild = function () {
    if (MDX.el) return MDX.el;
    const el = b0.apply(this, arguments), st = document.createElement('style');
    st.textContent = `#mdx canvas.mfx-big { width: 100%; max-width: 640px; height: auto; aspect-ratio: 16 / 5; border: 1px solid var(--line); border-radius: 6px; display: block; }
#mdx .mfx-cards { display: flex; flex-wrap: wrap; gap: 8px; }
#mdx .mfx-card { display: flex; flex-direction: column; gap: 4px; align-items: center; background: rgba(0, 0, 0, .25); border: 1px solid var(--line); border-radius: 6px; padding: 5px; color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
#mdx .mfx-card:hover { border-color: var(--g); }
#mdx .mfx-card.on { border-color: var(--amber, #ffc24a); box-shadow: 0 0 0 1px var(--amber, #ffc24a) inset; }
#mdx .mfx-card canvas { display: block; border-radius: 4px; }
#mdx .mfx-card canvas.mfx-sim { width: 200px; height: 74px; }
#mdx .mfx-card canvas.mfx-sp { width: 120px; height: 120px; }
#mdx .mfx-card.sm canvas.mfx-sp { width: 64px; height: 64px; }
#mdx .mfx-none { display: grid; place-items: center; width: 64px; height: 64px; font-size: 11px; color: var(--mute); text-align: center; }`;
    document.head.appendChild(st);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-mfxp], [data-mfxs], [data-mfxr], [data-mfxa], [data-mfxslot]');
      if (!b) return;
      e.stopPropagation();
      if (typeof muxBefore === 'function') muxBefore(false);   // 记撤销（modux.js）
      const k = MDX.sel, d = b.dataset;
      if (d.mfxslot != null) { const [s, id] = d.mfxslot.split('|'); if (id) MDX_W.fx[s] = id; else delete MDX_W.fx[s]; MDX.dirty = true; MDX.keep = true; mdxRender(); mdxMsg('换了，点「保存」生效'); return; }
      if (d.mfxp != null) { const P = (MFX_PRE[+d.mfxp] || [, {}])[1], T = MDX_W.trl = MDX_W.trl || {}; if (!Object.keys(P).length) delete T[k]; else T[k] = { ...P }; MDX.dirty = true; }
      else if (d.mfxs != null) mfxSet(k, 'spr', d.mfxs);
      else if (d.mfxr) mfxSet(k, d.mfxr, '');
      else if (d.mfxa === 'clear') { if (MDX_W.trl) delete MDX_W.trl[k]; MDX.dirty = true; }
      MDX.keep = true; mdxRender(); mdxMsg('改了，点「保存」生效（上面的预览已经按新的画）');
    }, true);
    const upd = (t, fin) => {
      const f = t.dataset.mfx, k = MDX.sel;
      if (f == null || MDX.tab !== 'trl') return false;
      const v = t.type === 'color' ? t.value : f === 'jet' ? +t.value : +t.value;
      if (t.type !== 'color' && !isFinite(v)) return true;
      mfxSet(k, f, v);
      const s = MDX.el.querySelector(`[data-mfxv="${f}"]`); if (s) s.textContent = +(+v).toFixed(2);
      if (fin) { MDX.keep = true; mdxRender(); }
      return true;
    };
    el.addEventListener('input', e => { if (upd(e.target, false)) e.stopPropagation(); }, true);
    el.addEventListener('change', e => { if (e.target.dataset.mfx != null && MDX.tab === 'trl') { if (typeof muxBefore === 'function') muxBefore(false); upd(e.target, true); e.stopPropagation(); } }, true);
    return el;
  };
}
