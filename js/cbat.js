'use strict';
// 反炮兵侦察与反炮兵射击（进攻方）：守军纵深的榴弹炮、迫击炮、自行火炮躲在视野外反复炮击我补给线与部队时，
//   ① 055 / 052D 驱逐舰的舰载雷达（舰 1500 以内）每发来袭炮弹有 CB.radar 的概率跟踪到弹道，上岸步兵 900 以内的炮位每发再有 CB.sound 的概率被声测；
//   ② 同一门炮 120 秒内被跟踪到 CB.need 发就测定炮位（误差约 15），标为已知目标——舰炮、垂发导弹、攻击机、战术导弹的 AI 都会去打已知炮位；
//   ③ 测定后立即组织一次反炮兵射击：垂发长剑-10 → 攻击机 → 舰炮 → 东风-15B，谁能打谁先打（驱逐舰 / 航母须受指挥官控制；玩家手动指挥时只提出请求）；
//   炮兵打完转移阵地（ai2 relocate）后旧坐标作废，要重新测定。
// 打补给线的炮（v13）：补给点、前沿运输线、滩头浮桥补给线中弹时，后勤分队做弹坑分析（看弹坑朝向与深浅判断来向和距离）、驱逐舰雷达同时跟踪——
//   同一门炮第 CB.supN 次打中补给线就测定炮位（有雷达误差 15，只靠弹坑分析误差 25），不必等两发都被雷达跟踪到；
//   打补给线的炮优先：垂发导弹两发，攻击机同时出动；没打掉、又打过来就再打（间隔 CB.supGap 秒）；
//   反炮兵火力在途（CB.wait 秒内）时，卡车与工兵先不去抢修那一带的运输线，免得刚修好又被打断（trucks.js / autopilot.js 读 cbWait）
// 状态：S.cb = { g: {敌 id: {n 跟踪次数, t 首次时刻}}, fixT: {敌 id: 测定时刻}, sup: {敌 id: {n 打中补给线次数, t, x, y, fireT, until}} }
const CB = { radar: .45, sound: .18, need: 2, win: 120, err: 15, kinds: ['arty', 'mortar', 'spg'], supN: 2, supErr: 25, supGap: 20, wait: 25 };

function cbShooter(s) {
  if (!s || !isFinite(s.x0) || !isFinite(s.y0)) return null;
  let best = null, bd = 40;
  for (const e of S.enemies) if (!e.dead && (e.kind === 'arty' || e.kind === 'mortar')) { const d = dist(e.x, e.y, s.x0, s.y0); if (d < bd) { bd = d; best = { o: e, k: 'enemy' }; } }
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && vehSp(v).gun && vehSp(v).gun.ind) { const d = dist(v.x, v.y, s.x0, s.y0); if (d < bd) { bd = d; best = { o: v, k: 'veh' }; } }
  return best;
}
const cbDDs = () => typeof msDefShips === 'function' ? msDefShips().filter(o => o.o === S.dd || o.esc) : [];
function cbStep() {
  if (!S || S.phase !== 'battle' || S.over || !S.shells) return;
  const C = S.cb || (S.cb = { g: {}, fixT: {} });
  const ddR = cbDDs();
  const ashore = S.teams.filter(q => q.side === 'p' && q.men.length && isLand(q.x, q.y));
  for (const s of S.shells) {
    if (s.side !== 'e' || s.cbS || !CB.kinds.includes(s.kind) || s.t < 0) continue;
    s.cbS = true;
    const sh = cbShooter(s);
    if (!sh || (sh.o.kx != null && dist(sh.o.kx, sh.o.ky, sh.o.x, sh.o.y) < 30)) continue;   // 已标定且没挪窝：不用再测
    let p = 0;
    const mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2;
    if (ddR.some(o => dist(o.x, o.y, mx, my) < 1500)) p += CB.radar;
    if (ashore.some(q => dist(q.x, q.y, s.x0, s.y0) < 900)) p += CB.sound;
    if (!p || Math.random() >= p) continue;
    const g = C.g[sh.o.id] && S.t - C.g[sh.o.id].t < CB.win ? C.g[sh.o.id] : (C.g[sh.o.id] = { n: 0, t: S.t });
    if (++g.n < CB.need) continue;
    delete C.g[sh.o.id];
    cbFix(sh, ddR.length > 0);
  }
}
// 补给线中弹（combat.js impact / supplynet.js supplyImpact 报来，src = 那发炮弹）：记到打它的那门炮头上，够次数就测定并优先打掉
function cbSupplyHit(src, x, y) {
  if (!S || S.phase !== 'battle' || S.over || !src || !CB.kinds.includes(src.kind)) return;
  const sh = cbShooter(src);
  if (!sh) return;
  const C = S.cb || (S.cb = { g: {}, fixT: {} }), R = C.sup || (C.sup = {}), id = sh.o.id;
  const r = R[id] && S.t - R[id].t < 240 ? R[id] : (R[id] = { n: 0, t: S.t });
  r.n++; r.t = S.t; r.x = Math.round(x); r.y = Math.round(y);
  if (typeof v8Stat === 'function') v8Stat('cbSupHit');
  if (r.n < CB.supN || S.t - (r.fireT ?? -99) < CB.supGap) return;
  r.fireT = S.t;
  const mx = (src.x0 + src.x1) / 2, my = (src.y0 + src.y1) / 2, radar = cbDDs().some(o => dist(o.x, o.y, mx, my) < 1500);
  const n = cbFix(sh, radar, { sup: r });
  r.until = n ? S.t + CB.wait : 0;
}
// 反炮兵火力在途、正要打掉那门炮的补给线中弹点附近：卡车、工兵先等一等
function cbWait(x, y) {
  const R = S && S.cb && S.cb.sup;
  if (!R) return false;
  for (const id in R) {
    const r = R[id];
    if (!(r.until > S.t) || dist(r.x, r.y, x, y) > 160) continue;
    const e = S.enemies.find(o => o.id === +id) || (typeof vehById === 'function' ? vehById(+id) : null);
    if (e && !e.dead) return true;
  }
  return false;
}
// 测定炮位并组织反炮兵射击；opt.sup = 打补给线的炮（误差按有无雷达定，火力加倍）。返回实际出动的火力数
function cbFix(sh, radar, opt) {
  const e = sh.o, sup = opt && opt.sup, err = sup && !radar ? CB.supErr : CB.err;
  const x = Math.round(e.x + gauss() * err), y = Math.round(e.y + gauss() * err);
  e.kx = x; e.ky = y; if (sh.k === 'veh') { e.kh = e.heading; e.seen = S.t; }
  S.cb.fixT[e.id] = S.t;
  if (typeof v8Stat === 'function') v8Stat(sup ? 'cbSupFix' : 'cbFix');
  const nm = sh.k === 'veh' ? (typeof vehModel === 'function' ? vehModel(e) : '敌自行火炮') : (ENEMY_SPEC[e.kind] || {}).name || '敌炮兵', nmP = /阵地$/.test(nm) ? nm : nm + '阵地', wh = typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);
  const rn = radar && (typeof ddUp === 'function' && ddUp() ? '驱逐舰' : '护航舰'), how = sup ? (radar ? `弹坑分析与${rn}雷达` : '后勤分队弹坑分析') : radar ? `${rn}雷达` : '前沿声测';
  log(`${how}测定敌炮位：${wh}（${nm}）${sup ? '——就是它在打补给线' : ''}`, 'good', null, 0, { x, y });
  const acts = [], ask = [];
  const C = S.cmd && S.cmd.p;
  // 反炮兵射击：精度高、来得快的先上；打补给线的炮垂发两发、攻击机同时出动
  if (typeof vlsCan === 'function' && vlsCan('lacm', x, y)) { const who = vlsWho('lacm', x, y), f = vlsFire('lacm', x, y, sup ? 2 : 1, 'cb'); if (f) acts.push(`${who}垂发导弹 ${f} 枚`); }
  if ((!acts.length || sup) && C && typeof cmdAir === 'function' && S.assets.strike > 0 && cmdAir('strike', x, y, sh.k === 'enemy' ? e.id : null)) acts.push('攻击机');
  if (!acts.length && C && typeof cmdFire === 'function' && S.dd && S.dd.state !== 'sunk' && dist(S.dd.x, S.dd.y, x, y) < 990 && cmdFire(x, y, sup ? 4 : 3, 'cb')) acts.push('舰炮急促射');
  if (!acts.length && S.assets.msl > 0 && typeof msFireP === 'function' && (typeof cmdCtl !== 'function' || cmdCtl(S.dd) || S.role === 'spectate') && msFireP(x, y, true)) acts.push('东风-15B 战术导弹');
  if (!acts.length && typeof cmdAsk === 'function' && cmdAsk(x, y)) ask.push(cmdAsk(x, y));
  if (acts.length && typeof v8Stat === 'function') v8Stat(sup ? 'cbSupFire' : 'cbFire');
  if (typeof chatSay === 'function') {
    if (sup) chatSay('p', `判断：补给线在${typeof cmdWhere === 'function' ? cmdWhere(sup.x, sup.y) : gridRef(sup.x, sup.y)}已第 ${sup.n} 次被炮击，${how}测定是${wh}的敌${nm}打的。决心：先打掉这门炮——${acts.length ? `命令：${acts.join('、')}实施反炮兵射击；工兵与卡车等炮打掉再抢修，免得修好又被打断。` : ask.length ? ask[0] + '（反炮兵射击）。' : '暂无可用火力，炮位标定在案，航空兵出动时优先打击。'}`, { kind: acts.length ? 'plan' : 'report', at: { x, y }, key: 'cbs' + e.id, gap: 30, lv: 0 });
    else chatSay('p', `报告：${radar ? `${how}跟踪来袭炮弹弹道` : '前沿分队声测'}，测定敌${nmP}在${wh}。${acts.length ? `命令：${acts.join('、')}实施反炮兵射击，打掉这门炮，免得它反复切断补给线。` : ask.length ? ask[0] + '（反炮兵射击）。' : '暂无可用火力，标定在案，航空兵出动时优先打击。'}`, { kind: acts.length ? 'order' : 'report', at: { x, y }, key: 'cb' + e.id, gap: 40, lv: 2 });
    if (acts.length && typeof shout === 'function') shout(radar && typeof ddUp === 'function' && ddUp() ? S.dd : { x, y, side: 'p' }, `测定敌${nmP}，反炮兵射击！`);
  }
  return acts.length;
}

HOOK.step.push(cbStep);
HOOK.newGame.push(() => { if (S) S.cb = null; });
