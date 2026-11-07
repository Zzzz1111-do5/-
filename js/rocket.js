'use strict';
// 火箭军（战区常规导弹部队）：从地图南缘以外（大陆纵深）发射。参数照公开资料，官方没公布的按外界估算——
//   东风-15B：近程弹道导弹，射程约 50–800 公里、弹头约 500 公斤，带主动雷达末制导的型号圆概率误差约 5–10 米；
//   东风-16：近程弹道导弹，射程约 800–1000 公里、弹头约 1000 公斤（2011 年前后服役），再入速度更高、弹头末段机动——比东风-15B 难拦截；
//   东风-17：带高超音速滑翔弹头（射程外界估算约 1800–2500 公里），助推后在大气层里以马赫 5 以上滑翔、横向机动——爱国者很难拦截；
//   长剑-10（陆基型）：射程约 1500 公里、弹头约 500 公斤、圆概率误差约 10 米，亚音速低空掠地飞行——近程防空、爱国者都打得到。
// 推演：弹道导弹用 missile.js 的 tbm（m.rf 记型号——毁伤、被拦截的难度、飞行剖面按 RF 表），巡航导弹用 pgm（MS_PGM.cj10）。
// 开战的火力准备（联合火力打击的第一波，rfPlan）：打卫星侦察早已掌握的固定目标和已经侦察到的目标——
//   机场的爱国者发射车 → 东风-17（最难拦截，先把防空打掉）；「堤丰」导弹排、野战机场跑道 → 东风-16；岸基警戒雷达、岸舰导弹、海马斯、岸防重炮 → 东风-15B；
//   机场的机库、炮阵地 → 长剑-10。各留一枚东风-15B、长剑-10 给之后的临机打击（指挥官、反炮兵、空降前压制走 missile.js msFireP，东风-15B 用完接着用东风-16、长剑-10）。
// 库存：S.assets.msl（东风-15B，原有）、df16、df17、cj10；战役按难度给（RF_STOCK），沙盒从目录买。
const RF = {
  df15b: { nm: '东风-15B', key: 'msl', icp: 1, durK: 1, sig: 8 },
  df16: { nm: '东风-16', key: 'df16', icp: .7, durK: 1.05, sig: 6, pw: { men: 1, ship: 8, struct: 34, seg: true, R: 55 } },
  df17: { nm: '东风-17', key: 'df17', icp: .15, durK: 1.4, sig: 5, hgv: true, pw: { men: .9, ship: 8, struct: 30, seg: true, R: 42 } },
  cj10: { nm: '长剑-10', key: 'cj10', cm: true }
};
const RF_STOCK = { normal: { df16: 2, df17: 2, cj10: 4 }, hard: { df16: 2, df17: 1, cj10: 4 }, hell: { df16: 1, df17: 1, cj10: 2 } };
HOOK.newGame.push(function rfNewGame(opts) {
  if (!S) return;
  const st = opts && opts.sandbox ? { df16: 0, df17: 0, cj10: 0 } : RF_STOCK[S.level] || RF_STOCK.hard;   // 沙盒从目录买
  Object.assign(S.assets, st);
  S.rf = { plan: false, q: [] };
});
// 东风-17 的滑翔剖面（画面与拦截窗口）：助推升到高处 → 在大气层里滑翔、边滑边左右机动 → 末段俯冲；u 是飞行进度 0–1
function rfPath(m, u) {
  const R = RF[m.rf];
  if (!R || !R.hgv) return;
  const s = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }, g = s(.18, .3, u) * (1 - s(.78, .9, u));
  const dx = m.tx - m.x0, dy = m.ty - m.y0, d = Math.hypot(dx, dy) || 1, off = Math.sin(u * Math.PI * 3 + (m.id % 7)) * 160 * g;   // 横向机动
  m.x += -dy / d * off; m.y += dx / d * off;
  m.z = u < .22 ? .95 * Math.sin(u / .22 * Math.PI / 2) : u < .86 ? lerp(.95, .42, (u - .22) / .64) : .42 * (1 - s(.86, 1, u));
}
const rfLeft = t => (S && S.assets && RF[t] ? S.assets[RF[t].key] || 0 : 0);
// 发射一枚：type 型号，(x, y) 目标点，tg 目标对象 { k, id }（巡航导弹跟踪用），why 写进日志的目标名
function rfFire(type, x, y, ai, tg, why) {
  const R = RF[type];
  if (!R || !S || S.phase !== 'battle' || (typeof msOn === 'function' && !msOn()) || !(rfLeft(type) > 0) || !isLand(x, y)) return false;
  if (type === 'df15b') return typeof msFireP === 'function' && msFireP(x, y, ai, true);
  if (typeof msEnsure === 'function') msEnsure();
  let m;
  if (R.cm) {   // 长剑-10：从南缘以外低空飞来（掠地），可被近程防空、爱国者打下来
    const x0 = clamp(x + (Math.random() - .5) * 900, 40, W - 40);
    m = msLaunch('pgm', 'p', x0, H + 80, { x, y }, { w: 'cj10', tgt: tg || null, src: 'rf', delay: 2, dur: 120 });
  } else {
    const tx = clamp(x + gauss() * R.sig, 0, W), ty = clamp(y + gauss() * R.sig, 0, H);
    m = msLaunch('tbm', 'p', tx, H + 60, { x: tx, y: ty }, { src: 'theatre', delay: 4 });
    m.rf = type; m.dur *= R.durK;
  }
  S.assets[R.key]--;
  if (S.msl && S.msl.p) S.msl.p.used++;
  S.stats.shots++;
  const wh = why || (typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y));
  log(`火箭军发射${R.nm}${R.cm ? '巡航导弹' : R.hgv ? '（高超音速滑翔弹头）' : '弹道导弹'}，打击${wh}${R.cm ? '' : `，约 ${Math.round(m.dur + 4)} 秒后命中`}（余 ${rfLeft(type)} 枚）`, 'info', ai ? 'rf' + type : null, ai ? 1.5 : 0, { x, y });
  return true;
}
// 临机打击时东风-15B 用完了：接着用东风-16、长剑-10（东风-17 留给敌防空）
function rfFireAny(x, y, ai) { return rfFire('df16', x, y, ai) || rfFire('cj10', x, y, ai); }
// —— 开战火力准备：按目标优先级排一批发射（错开几秒，免得同一时刻全落一个点）——
function rfPlan() {
  const Q = S.rf.q, t0 = S.t + 2, used = new Set();
  let t = t0;
  const left = { df15b: rfLeft('df15b') - 1, df16: rfLeft('df16'), df17: rfLeft('df17'), cj10: rfLeft('cj10') - 1 };   // 东风-15B、长剑-10 各留一枚给临机打击
  const add = (type, x, y, tg, nm, gap = 2.5) => { if (!(left[type] > 0)) return false; left[type]--; Q.push({ t, type, x, y, tg, nm }); t += gap; return true; };
  const known = e => !e.dead && (e.kx != null || e.kind === 'airfield' || e.kind === 'coastal');   // 机场、岸防重炮是固定工事，卫星早就侦察到了
  const nmOf = e => (ENEMY_SPEC[e.kind] || { name: '目标' }).name;
  // ① 机场的爱国者发射车（固定阵地）：东风-17
  for (const v of S.veh || []) if (!v.dead && v.side === 'e' && /爱国者/.test(v.mdl || '') && (v.fixed || v.kx != null)) add('df17', v.x, v.y, { k: 'veh', id: v.id }, '爱国者导弹发射车');
  // ② 「堤丰」导弹排、野战机场跑道：东风-16（没有了就用东风-15B）
  for (const e of S.enemies) if (known(e) && (e.kind === 'typhon' || e.kind === 'airfield') && !used.has(e.id)) { used.add(e.id); if (!add('df16', e.x, e.y, null, nmOf(e))) add('df15b', e.x, e.y, null, nmOf(e)); }
  // ③ 岸基警戒雷达、岸舰导弹、海马斯、岸防重炮：东风-15B（没有了就用长剑-10）
  const rd = typeof radarUp === 'function' ? radarUp() : null;
  if (rd && !add('df15b', rd.x, rd.y, null, '岸基警戒雷达站')) add('cj10', rd.x, rd.y, null, '岸基警戒雷达站', 1.5);
  for (const k of ['ascm', 'tel', 'coastal']) for (const e of S.enemies) if (e.kind === k && known(e) && !used.has(e.id)) { used.add(e.id); if (!add('df15b', e.kx ?? e.x, e.ky ?? e.y, null, nmOf(e))) add('cj10', e.kx ?? e.x, e.ky ?? e.y, { k: 'enemy', id: e.id }, nmOf(e), 1.5); }
  // ④ 剩下的长剑-10：已侦察到的炮阵地
  for (const e of S.enemies) if ((e.kind === 'arty' || e.kind === 'mortar') && e.kx != null && !e.dead && !used.has(e.id)) { used.add(e.id); add('cj10', e.kx, e.ky, { k: 'enemy', id: e.id }, nmOf(e), 1.5); }
  if (Q.length) log(`火箭军开始火力准备：${Q.length} 枚导弹打击敌防空、机场、雷达与岸防`, 'info', 'rfplan', 3);
}
HOOK.step.push(function rfStep() {
  if (!S || S.phase !== 'battle' || !S.rf || (typeof msOn === 'function' && !msOn())) return;
  if (!S.rf.plan && S.t > 4) { S.rf.plan = true; rfPlan(); }   // 开战 4 秒后排火力准备（简报没看完时推演本来就不走）
  if (!S.rf.q.length) return;
  for (const j of S.rf.q) if (!j.done && S.t >= j.t) { j.done = true; rfFire(j.type, j.x, j.y, true, j.tg, j.nm); }
  S.rf.q = S.rf.q.filter(j => !j.done);
});
