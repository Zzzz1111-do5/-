'use strict';
// 机型与挂载参数：驾驶战斗机时按 I（或武器栏的「I 参数」、手机上的「参数」）开关面板；驾驶列表里每架飞机下面「挂载参数」点开看。
//   机型性能（最大 / 巡航速度、雷达与探测距离、机内燃油、推力、过载限制、滚转率、作战重量、隐身）、此刻的状态（速度、高度、过载、迎角、油量），
//   每种挂载：剩余 / 满载、挂在哪、类型、制导方式、射程（最小–最大）、速度、过载、导引头离轴角、锁定时间、发动机工作时间、弹体说明；自卫：热诱弹。
//   数字都取自现有的表（carrier.js AIR_MDL / AIR_REAL、flight.js FL_AC、fpwpn.js FW_W / FW_LOAD、fptgp.js 热诱弹数），这里只补了弹体说明
const FI = { on: false };
const FI_K = { aam: '空空导弹', arm: '反辐射导弹', agm: '空地导弹', gb: '制导滑翔炸弹' };
const FI_SK = { rf: '主动雷达（数据链中制导）', ir: '红外成像', ar: '被动雷达（追辐射源）', tv: '电视 / 红外成像末制导', gps: '卫星 / 惯导 + 末端成像' };
const FI_BAY = { main: '主弹舱', side: '侧弹舱', ext: '翼下外挂' };
// 弹体说明（公开资料与外界估算，出处同 fpwpn.js 的注释）
const FI_WD = {
  pl15: '弹长约 4 米、弹径 203 毫米、约 210 公斤；双脉冲固体火箭发动机；有源相控阵导引头 + 双向数据链',
  pl10: '弹长约 3 米、弹径 160 毫米、89 公斤；红外成像导引头，±90° 大离轴发射，燃气舵推力矢量',
  pl17: '弹长约 6 米；超远程，专打预警机、加油机一类的大目标',
  ld10: '霹雳-12 弹体改的反辐射导弹，被动雷达导引头追防空雷达的辐射；出口型射程 60 公里',
  kd88: '涡喷动力亚音速空地导弹，末段电视 / 红外成像，防区外打点目标',
  ft8: '百公斤级小直径炸弹：投放后展开弹翼滑翔，卫星惯导 + 末端成像，一架能挂好几枚',
  ls6: '500 公斤级航弹加滑翔组件，高空投放滑翔约 60 公里'
};
const fiKm = m => m >= 1000 ? `${+(m / 1000).toFixed(1)} 公里` : `${m} 米`;
const fiNum = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// 满载时每种弹几枚：按型号表的总数重新分一遍（与 fwInit 同一套分法）
function fiFull(o) { const t = { kind: o.kind, v: o.v }; if (typeof fwInit === 'function') fwInit(t); return t.fwN || {}; }
// 一架飞机的全部参数（o 可以是在飞的飞机，也可以只是 { kind, v }：待命的）
function fiData(o) {
  const key = typeof airMdlKey === 'function' ? airMdlKey(o.kind, o.v) : null, M = typeof airMdl === 'function' ? airMdl(o.kind, o.v) : {};
  const RL = (typeof AIR_REAL === 'object' && AIR_REAL[key]) || {}, A = typeof FL_AC === 'object' && typeof FL_KEY === 'object' && FL_KEY[key] ? FL_AC[FL_KEY[key]] : null;
  const perf = [];
  if (RL.vmax) perf.push(['最大速度', `${fiNum(RL.vmax)} km/h（约 ${(RL.vmax / 1225).toFixed(1)} 马赫）`]);   // 海平面音速约 1225 km/h
  if (M.spd) perf.push(['巡航速度', `${fiNum(M.spd * 3.6)} km/h`]);
  if (RL.rdrNm) perf.push(['机载雷达', RL.rdr ? `${RL.rdrNm} · 对战斗机大小目标约 ${RL.rdr} 公里` : RL.rdrNm]);
  if (RL.fuel) perf.push(['机内燃油', `${fiNum(RL.fuel)} 公斤`]);
  if (A) {
    perf.push(['发动机推力', `两台合计 军用 ${Math.round(A.Tm / 1000)} 千牛 · 加力 ${Math.round(A.Ta / 1000)} 千牛`]);
    const mk = typeof fpMk === 'function' ? fpMk() : 1, mt = mk > 1 ? `（皇牌空战式放大 ${mk} 倍：+${+(A.nz[1] * mk).toFixed(1)} g、${Math.round(A.pmax * mk * 57.3)}°/秒）` : '';   // 皇牌空战式操纵的机动性放大（v3pilot.js FP_MK）
    perf.push(['过载限制', `${A.nz[0]} ～ +${A.nz[1]} g（正常律）${mt && mt.replace(/、.*）/, '）')}`]);
    perf.push(['最大滚转率', `${Math.round(A.pmax * 57.3)}°/秒${mk > 1 ? `（放大后 ${Math.round(A.pmax * mk * 57.3)}°/秒）` : ''}`]);
    perf.push(['作战重量 · 翼展', `约 ${Math.round(A.m / 1000)} 吨 · ${A.b} 米`]);
  }
  if (M.stealth) perf.push(['隐身', `系数 ${M.stealth}（越小越难被雷达发现；在敌雷达下待久了会被稳定跟踪）`]);
  if (M.jam) perf.push(['电子干扰', `翼尖干扰吊舱：${M.jam} 米内我方飞机被发现、被命中的概率打七折`]);
  if (M.gun === 0) perf.push(['航炮', '无（只打超视距）']);
  // 此刻的状态：只有正在亲自飞的这一架（物理引擎在算）
  let state = null;
  const F = o.fl;
  if (F && typeof V3FP === 'object' && V3FP.o === o) {
    const agl = typeof flGround === 'function' ? -F.P[2] - Math.max(flGround(F.P[0], F.P[1]), -2.6) : -F.P[2], cap = F.cap || RL.fuel || 1;
    state = [['速度', `${fiNum(F.Va * 3.6)} km/h · 马赫 ${F.M.toFixed(2)}`], ['高度', `${fiNum(-F.P[2])} 米（离地 ${fiNum(Math.max(0, agl))} 米）`],
      ['过载 · 迎角', `${F.nz.toFixed(1)} g · ${(F.a * 57.3).toFixed(1)}°`], ['燃油', `${fiNum(F.fuel)} 公斤（${Math.round(100 * F.fuel / cap)}%）${F.ff > 0 ? ` · 每分钟耗 ${fiNum(F.ff * 60)} 公斤` : ''}`],
      ['油门', F.ab ? '加力' : `${Math.round((V3FP.thr || 0) * 100)}%`]];
  }
  // 挂载
  if (typeof fwInit === 'function' && o.kind) fwInit(o);
  const L = typeof fwList === 'function' && o.kind ? fwList(o) : [], full = fiFull(o);
  const load = L.map((s, i) => {
    const W = s.W;
    return { k: String(i + 1), nm: W.nm, n: s.n, full: full[s.w] ?? s.n, bay: FI_BAY[s.bay] || s.bay, kind: FI_K[W.k] || W.k, sk: FI_SK[W.sk] || W.sk,
      rng: `${fiKm(W.Rmin)} – ${W.R} 公里`, spd: W.M ? `马赫 ${W.M}` : `无动力滑翔（升阻比 ${W.LD || '—'}）`, g: `${W.g} g`, cone: `±${W.cone}°`, lk: `${W.lk} 秒`,
      tb: W.M ? (W.tb < 1e8 ? `${W.tb} 秒` : '全程（涡喷）') : null, ds: FI_WD[s.w] || '' };
  });
  const self = [];
  if (key && typeof FT === 'object' && FT.flN && FT.flN[key] != null) self.push(['热诱弹', `×${o.flN ?? FT.flN[key]} / ${FT.flN[key]}（一按 4 发，3 公里内来袭的红外弹六成被骗走）`]);
  return { name: M.name || '飞机', perf, state, load, self };
}
function fiToggle() { FI.on = !FI.on; }
HOOK.newGame.push(() => { FI.on = false; });

// —— 驾驶时的面板（fptgp.js ftOverlay 调）：右侧一块压暗的底，白字 ——
function fiDraw(ctx) {
  const o = typeof V3FP === 'object' && V3FP.on && V3FP.k === 'air' ? V3FP.o : null;
  if (!FI.on || !o) return;
  const D = fiData(o), FONT = '"IBM Plex Mono", "Noto Sans SC", monospace';
  // 顶上让开右上角的按钮（时钟、3D 镜头那两排；每半秒量一次版面，不每帧读）
  const now = performance.now();
  if (!FI.at || now - FI.at > 500) {
    FI.at = now; FI.top = 64;
    const cv = typeof R === 'object' && R.cv;
    if (cv && cv.getBoundingClientRect && typeof document !== 'undefined') { const c = cv.getBoundingClientRect(); for (const id of ['topr', 'v3ctl']) { const e = document.getElementById(id); if (e && e.offsetParent !== null) { const r = e.getBoundingClientRect(); if (r.height > 0 && r.left - c.left > CAM.vw * .45) FI.top = Math.max(FI.top, r.bottom - c.top + 8); } } }
  }
  const W0 = Math.min(560, CAM.vw - 24), pad = 14, lh = 18, x0 = CAM.vw - 12 - W0, y0 = Math.min(FI.top, CAM.vh * .4), maxY = CAM.vh - 64;
  ctx.save();
  // 先排版（按宽度折行），再按总高画底
  const lines = [];   // [文字, 字体, 颜色, 缩进, 行高]
  const wrap = (t, font, col, ind = 0, h = lh) => {
    ctx.font = font; const mw = W0 - pad * 2 - ind;
    let s = '';
    for (const ch of t) { if (ctx.measureText(s + ch).width > mw && s) { lines.push([s, font, col, ind, h]); s = ''; } s += ch; }
    if (s) lines.push([s, font, col, ind, h]);
  };
  const kv = (rows, col) => { for (const [k, v] of rows) wrap(`${k}：${v}`, `13px ${FONT}`, col, 0); };
  wrap(D.name, `600 16px ${FONT}`, '#ffffff', 0, 24);
  wrap('机型性能', `600 12px ${FONT}`, 'rgba(255,255,255,.55)', 0, 20); kv(D.perf, 'rgba(255,255,255,.88)');
  if (D.state) { wrap('此刻', `600 12px ${FONT}`, 'rgba(255,255,255,.55)', 0, 22); kv(D.state, '#ffffff'); }
  wrap('挂载', `600 12px ${FONT}`, 'rgba(255,255,255,.55)', 0, 22);
  if (!D.load.length) wrap('没有可用的机载武器', `13px ${FONT}`, 'rgba(255,255,255,.7)');
  for (const w of D.load) {
    wrap(`[${w.k}] ${w.nm}  ×${w.n} / ${w.full}  ${w.bay} · ${w.kind}`, `600 13px ${FONT}`, w.n ? '#ffffff' : 'rgba(255,255,255,.4)', 0, 19);
    wrap(`制导 ${w.sk} · 射程 ${w.rng} · ${w.spd}${w.tb ? ` · 发动机 ${w.tb}` : ''} · 过载 ${w.g} · 导引头离轴 ${w.cone} · 锁定 ${w.lk}`, `12px ${FONT}`, 'rgba(255,255,255,.8)', 14, 17);
    if (w.ds) wrap(w.ds, `12px ${FONT}`, 'rgba(255,255,255,.5)', 14, 17);
  }
  if (D.self.length) { wrap('自卫', `600 12px ${FONT}`, 'rgba(255,255,255,.55)', 0, 22); kv(D.self, 'rgba(255,255,255,.88)'); }
  wrap('I 关闭', `11px ${FONT}`, 'rgba(255,255,255,.45)', 0, 22);
  let H0 = pad * 2; for (const L of lines) H0 += L[4];
  const sc = Math.min(1, (maxY - y0) / H0);   // 屏幕矮放不下：整块缩小
  ctx.translate(x0 + W0 * (1 - sc), y0); ctx.scale(sc, sc);
  ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(0, 0, W0, H0);
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.strokeRect(.5, .5, W0 - 1, H0 - 1);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  let y = pad;
  for (const [t, font, col, ind, h] of lines) { y += h; ctx.font = font; ctx.fillStyle = col; ctx.fillText(t, pad + ind, y - 5); }
  ctx.restore();
}

// —— 驾驶列表里的「挂载参数」（v3pilot.js fpMenuFill 调）：每架飞机下面一个可展开的小块 ——
function fiDetails(o) {
  if (typeof document === 'undefined') return null;
  if (!document.getElementById('fiCss')) {
    const st = document.createElement('style'); st.id = 'fiCss';
    st.textContent = '#fpMenu details.fi { margin: -1px 0 6px; padding: 0 9px 4px; font-size: 11px; color: var(--mute); }' +
      '#fpMenu details.fi summary { cursor: pointer; padding: 2px 0; user-select: none; } #fpMenu details.fi[open] summary { color: var(--fg, #ddd); }' +
      '#fpMenu details.fi .h { margin: 6px 0 2px; color: var(--fg, #ddd); font-weight: 600; } #fpMenu details.fi .w { margin: 4px 0 0; color: var(--fg, #ddd); }' +
      '#fpMenu details.fi .d { margin-left: 12px; } #fpMenu details.fi .s { margin-left: 12px; opacity: .75; }';
    document.head.appendChild(st);
  }
  const D = fiData(o), el = document.createElement('details'); el.className = 'fi';
  const sm = document.createElement('summary'); sm.textContent = '挂载参数'; el.appendChild(sm);
  const add = (cls, t) => { const d = document.createElement('div'); d.className = cls; d.textContent = t; el.appendChild(d); };
  add('h', '机型性能'); for (const [k, v] of D.perf) add('d', `${k}：${v}`);
  add('h', '挂载'); if (!D.load.length) add('d', '没有可用的机载武器');
  for (const w of D.load) {
    add('w', `[${w.k}] ${w.nm} ×${w.n} / ${w.full} · ${w.bay} · ${w.kind}`);
    add('d', `制导 ${w.sk} · 射程 ${w.rng} · ${w.spd}${w.tb ? ` · 发动机 ${w.tb}` : ''} · 过载 ${w.g} · 导引头离轴 ${w.cone} · 锁定 ${w.lk}`);
    if (w.ds) add('s', w.ds);
  }
  if (D.self.length) { add('h', '自卫'); for (const [k, v] of D.self) add('d', `${k}：${v}`); }
  return el;
}
