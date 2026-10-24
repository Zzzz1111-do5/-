'use strict';
// 反炮兵侦察与反炮兵射击（进攻方）：守军纵深的榴弹炮、迫击炮、自行火炮躲在视野外反复炮击我补给线与部队时，
//   ① 055 / 052D 驱逐舰的舰载雷达（舰 1500 以内）每发来袭炮弹有 CB.radar 的概率跟踪到弹道，上岸步兵 900 以内的炮位每发再有 CB.sound 的概率被声测；
//   ② 同一门炮 120 秒内被跟踪到 CB.need 发就测定炮位（误差约 15），标为已知目标——舰炮、垂发导弹、攻击机、战术导弹的 AI 都会去打已知炮位；
//   ③ 测定后立即组织一次反炮兵射击：垂发长剑-10 → 攻击机 → 舰炮 → 东风-15B，谁能打谁先打（驱逐舰 / 航母须受指挥官控制；玩家手动指挥时只提出请求）；
//   炮兵打完转移阵地（ai2 relocate）后旧坐标作废，要重新测定。
// 状态：S.cb = { g: {敌 id: {n 跟踪次数, t 首次时刻}}, fixT: {敌 id: 测定时刻} }
const CB = { radar: .45, sound: .18, need: 2, win: 120, err: 15, kinds: ['arty', 'mortar', 'spg'] };

function cbShooter(s) {
  let best = null, bd = 40;
  for (const e of S.enemies) if (!e.dead && (e.kind === 'arty' || e.kind === 'mortar')) { const d = dist(e.x, e.y, s.x0, s.y0); if (d < bd) { bd = d; best = { o: e, k: 'enemy' }; } }
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && vehSp(v).gun && vehSp(v).gun.ind) { const d = dist(v.x, v.y, s.x0, s.y0); if (d < bd) { bd = d; best = { o: v, k: 'veh' }; } }
  return best;
}
function cbStep() {
  if (!S || S.phase !== 'battle' || S.over || !S.shells) return;
  const C = S.cb || (S.cb = { g: {}, fixT: {} });
  const ddR = typeof msDefShips === 'function' ? msDefShips().filter(o => o.o === S.dd || o.esc) : [];
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
function cbFix(sh, radar) {
  const e = sh.o, x = Math.round(e.x + gauss() * CB.err), y = Math.round(e.y + gauss() * CB.err);
  e.kx = x; e.ky = y; if (sh.k === 'veh') { e.kh = e.heading; e.seen = S.t; }
  S.cb.fixT[e.id] = S.t;
  if (typeof v8Stat === 'function') v8Stat('cbFix');
  const nm = sh.k === 'veh' ? (typeof vehModel === 'function' ? vehModel(e) : '敌自行火炮') : (ENEMY_SPEC[e.kind] || {}).name || '敌炮兵', wh = typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y);
  log(`${radar ? '驱逐舰雷达' : '前沿声测'}测定敌炮位：${wh}（${nm}）`, 'good', null, 0, { x, y });
  const acts = [], ask = [];
  const C = S.cmd && S.cmd.p;
  // 反炮兵射击：精度高、来得快的先上
  if (typeof vlsCan === 'function' && vlsCan('lacm', x, y) && vlsFire('lacm', x, y, 1, 'cb')) acts.push('驱逐舰垂发导弹');
  else if (C && typeof cmdAir === 'function' && S.assets.strike > 0 && cmdAir('strike', x, y, sh.k === 'enemy' ? e.id : null)) acts.push('攻击机');
  else if (C && typeof cmdFire === 'function' && S.dd && S.dd.state !== 'sunk' && dist(S.dd.x, S.dd.y, x, y) < 990 && cmdFire(x, y, 3, 'cb')) acts.push('舰炮急促射');
  else if (S.assets.msl > 0 && typeof msFireP === 'function' && (typeof cmdCtl !== 'function' || cmdCtl(S.dd) || S.role === 'spectate') && msFireP(x, y, true)) acts.push('东风-15B 战术导弹');
  else if (typeof cmdAsk === 'function' && cmdAsk(x, y)) ask.push(cmdAsk(x, y));
  if (acts.length && typeof v8Stat === 'function') v8Stat('cbFire');
  if (typeof chatSay === 'function') chatSay('p', `报告：${radar ? '驱逐舰雷达跟踪来袭炮弹弹道' : '前沿分队声测'}，测定敌${nm}阵地在${wh}。${acts.length ? `命令：${acts.join('、')}实施反炮兵射击，打掉这门炮，免得它反复切断补给线。` : ask.length ? ask[0] + '（反炮兵射击）。' : '暂无可用火力，标定在案，航空兵出动时优先打击。'}`, { kind: acts.length ? 'order' : 'report', at: { x, y }, key: 'cb' + e.id, gap: 40, lv: 1 });
}

HOOK.step.push(cbStep);
HOOK.newGame.push(() => { if (S) S.cb = null; });
