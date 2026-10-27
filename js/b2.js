'use strict';
// 守方 B-2A「幽灵」隐身战略轰炸机群（沙盒守方「航空」里购买 e_b2：一组 5 架，限购一组，从图外的本土 / 迪戈加西亚基地远程奔袭，一局只出动一波）
// 战略轰炸机是战区司令手里的王牌，不轻易动用：开战 4 分钟以后、滩头真的吃紧才放出来——看得见的上岸之敌够多（步兵、车辆、抢滩舰按价值合计），
//   或者据点开始失守（门槛降低）；第 101 空降师呼叫只是指定优先打击的地域，门槛照样要够
// 挂载按现实：两个内置弹舱，每舱一具旋转发射架或炸弹架，载弹约 18 吨。五架按目标分工，各挂一种：
//   GBU-38/B 500 磅 JDAM × 80（两舱各 40 枚，GPS / 惯导，一次通场可独立攻击 80 个瞄准点）—— 上岸的步兵、车辆
//   GBU-31(V)3/B 2000 磅 JDAM × 16（BLU-109 钻地战斗部）—— 抢滩的登陆舰、坦克
//   AGM-158B JASSM-ER 隐身巡航导弹 × 16（射程约 900 公里，亚音速、低可探测）—— 防区外打海上的驱逐舰、航母、登陆舰，不进舰空导弹射程
//   （现实中还能挂 CBU-87/97 集束炸弹 36 枚、GBU-57 巨型钻地弹 2 枚、B61 / B83 核弹 16 枚——这里不用）
// 分工：看得见海上舰船时一架挂 JASSM-ER；有抢滩的登陆舰或坦克时一架挂 GBU-31（多就两架）；其余挂 GBU-38（目标不够就改挂别的）
// 飞行：约 12000 米高空、亚音速（200 / 秒），五机楔形编队从北边图外进入；雷达反射截面极小（隐身 .1）——
//   高炮、单兵防空导弹、弹炮防空车的机炮、近防炮都够不着（eair.js eaHigh）；舰空导弹要很近才锁得住；歼击机雷达也要很近才发现
// 投弹：JDAM 在瞄准点前约 260 处逐枚投放（每 0.12 秒一枚），滑翔约 6 秒落地，GPS 散布约 ±4，不跟踪活动目标；
//   JASSM-ER 一进图就逐枚发射（每 0.35 秒一枚），掠海飞向目标，舰空导弹、近防炮可以拦截（低可探测，命中率打折）
// 中弹即放弃攻击返航（eaAA）；投完 / 打完从最近的图边飞出，不再回来
// 情报：只打守方看得见（spotted）的目标；瞄准点 60 以内有自己人不投
// 状态（纯 JSON）：S.b2 = { g: [{ id, n 剩余架数, st: 'base' 待命 | 'out' 出击中 | 'done' 已返航, k 出击次数 }] }；
//   飞机在 S.eair.fly（type 'b2'，g 机群 id，no 机号，load 挂载，aims 瞄准点 [x, y, k?, id?]，i 已投 / 已射枚数）
// n 一组架数 · minT 开战后最早出动 · need 出动门槛（看得见的上岸之敌价值合计：步兵每人 1、坦克 6、车辆 3、抢滩舰 7~10）· needLost 据点失守后的门槛
const B2 = { n: 5, minT: 240, need: 90, needLost: 50, retry: 10, spd: 200, alt: .95, turn: .8, fturn: .28, hp: 3, rel: 260, every: .12, jEvery: .35, safe: 60, gps: 4, edge: 90 };
// 压制（v14）：每枚 JDAM 落地除了杀伤半径内的毁伤，还有大得多的冲击波与心理震撼——RS 以内的敌步兵被死死压住、排士气大跌，
//   车辆乘员被震晕（压制）；连续落弹沿航线一路滚过去（地毯式覆盖），爆点留下火球与久久不散的烟尘。
//   弹多目标少时不再「其余几架补投同样的点」：GBU-38 在敌集结处按 26 的间距铺满覆盖面（藏在掩体里看不见的也一起覆盖）
const B2_SHOCK = { gbu38: { rs: 120, sup: 95, mor: 10 }, gbu31: { rs: 190, sup: 100, mor: 18 } };
const B2_LOAD = {
  gbu38: { nm: 'GBU-38/B 500 磅 JDAM', n: 80 },
  gbu31: { nm: 'GBU-31(V)3/B 2000 磅 JDAM', n: 16 },
  jassm: { nm: 'AGM-158B JASSM-ER 隐身巡航导弹', n: 16 }
};
const b2On = () => !!S && S.mode === 'sandbox' && !(S.v7off && S.v7off.air);

function b2Ensure() {
  if (S.b2 && Array.isArray(S.b2.g)) return S.b2;
  const n = Math.min(1, (S.assets && S.assets.eb2) || 0);   // 限购一组（旧存档买了几组也只算一组）
  return (S.b2 = { g: Array.from({ length: n }, (_, i) => ({ id: i + 1, n: B2.n, st: 'base', next: B2.minT, k: 0 })) });
}

// —— 目标（只用守方看得见的）——
function b2Seen(x, y) { return typeof spotted === 'function' ? spotted(x, y) : true; }
const b2Own = (x, y) => S.teams.some(q => q.side === 'e' && q.men.length && dist(q.x, q.y, x, y) < B2.safe);
// 呼叫（第 101 空降师）：只指定这一波优先打击的地域（呼叫点 500 以内的目标价值 ×4），不降低出动门槛——B-2 不会因为一次呼叫就轻易放出来
function b2Call(x, y, who) {
  if (!S || !b2On() || !((S.assets && S.assets.eb2) > 0)) return false;
  const B = b2Ensure();
  if (!B.g.some(G => G.st === 'base' && G.n > 0)) return false;
  B.call = { x: Math.round(x), y: Math.round(y), t: S.t, who };
  return true;
}
// 滩头是否吃紧到要动用 B-2：看得见的上岸之敌价值合计够门槛（据点失守后门槛降低）
function b2Crisis() {
  const C = b2Cands(true), val = C.soft.concat(C.hard).reduce((a, o) => a + o[2], 0), lost = S.points.some(p => p.owner === 'p' && !/^E\d/.test(p.key));
  return val >= (lost ? B2.needLost : B2.need);
}
function b2Cands(raw) {   // raw：不加呼叫点的优先权重（判断是否出动用）
  const soft = [], hard = [], sea = [], C = !raw && S.b2 && S.b2.call && S.t - S.b2.call.t < 240 ? S.b2.call : null;
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y) && b2Seen(q.x, q.y)) soft.push([q.x, q.y, q.men.length]);
  const M = S.hq && S.hq.e && S.hq.e.mem;   // 守方司令记得的敌位置（指挥体系 hq.js，60 秒内）：GPS 坐标交给 B-2，打折计价值
  if (M) for (const k in M) { const m = M[k]; if (S.t - m[3] < 60 && isLand(m[0], m[1]) && !soft.some(o => Math.abs(o[0] - m[0]) < 20 && Math.abs(o[1] - m[1]) < 20)) soft.push([m[0], m[1], m[2] * .6]); }
  for (const v of S.veh || []) {
    if (v.side !== 'p' || v.dead || v.lst || !b2Seen(v.x, v.y)) continue;
    if (!isLand(v.x, v.y)) continue;
    const tank = BG_TANK.includes(v.type) || v.type === 'td';
    (tank ? hard : soft).push([v.x, v.y, tank ? 6 : 3]);
  }
  for (const s of S.ships) {
    if (!alive(s) || !b2Seen(s.x, s.y)) continue;
    if (s.state === 'beached' || s.state === 'unloading' || coastAt(clamp(s.x, 0, W - 1)) + 120 > s.y) hard.push([s.x, s.y, s.kind === 'lst' ? 10 : 7, 'ship', s.id]);
    else sea.push([s.x, s.y, s.kind === 'dd' ? 9 : s.kind === 'lst' || s.kind === 'assault' ? 6 : 4, 'ship', s.id]);
  }
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && b2Seen(S.dd.x, S.dd.y)) sea.push([S.dd.x, S.dd.y, 12, 'dd', 0]);
  if (S.cv && S.cv.hp > 0 && isFinite(S.cv.x) && b2Seen(S.cv.x, S.cv.y)) sea.push([S.cv.x, S.cv.y, 14, 'cv', 0]);
  if (C) for (const o of [...soft, ...hard]) if (dist(o[0], o[1], C.x, C.y) < 500) o[2] *= 4;   // 呼叫点一带优先
  return { soft: soft.filter(o => !b2Own(o[0], o[1])), hard: hard.filter(o => !b2Own(o[0], o[1])), sea };
}
// 给一种挂载分瞄准点：按价值排，彼此至少隔开 rMin，弹多目标少时价值高的多投几枚
function b2Pick(list, n, rMin, per) {
  const L = list.slice().sort((a, b) => b[2] - a[2]), out = [];
  for (const o of L) { if (out.length >= n) break; if (!out.some(a => dist(a[0], a[1], o[0], o[1]) < rMin)) out.push(o); }
  for (let r = 1; r < per && out.length && out.length < n; r++) for (const o of out.slice(0, out.length)) { if (out.length >= n) break; if (o[2] >= 6) out.push(o); }
  return out;
}
// 地毯式覆盖：瞄准点不够一架的载弹量时，在敌人扎堆的地方（价值高的点 90 以内）按 26 的间距铺点，直到把弹投满
function b2Carpet(aims, all, n) {
  const out = aims.slice();
  if (!out.length) return out;
  const hubs = all.slice().sort((a, b) => b[2] - a[2]).slice(0, 12);
  for (let ring = 1; ring <= 3 && out.length < n; ring++) for (const h of hubs) {
    const r = ring * 30, k = Math.round(6.283 * r / 26);
    for (let i = 0; i < k && out.length < n; i++) {
      const a = i / k * 6.283 + ring, x = h[0] + Math.cos(a) * r, y = h[1] + Math.sin(a) * r;
      if (!isLand(x, y) || b2Own(x, y) || out.some(o => Math.abs(o[0] - x) < 18 && Math.abs(o[1] - y) < 18)) continue;
      out.push([x, y, 1]);
    }
  }
  return out;
}
// 落弹（missile.js 精确制导弹药落地时调用）：冲击波压制、士气震撼、车组震晕，火球与烟尘
function b2Blast(x, y, w) {
  const K = B2_SHOCK[w];
  if (!K) return;
  const hitU = new Set();
  for (const q of S.teams) {
    if (q.side !== 'p' || !q.men.length || q.ride) continue;
    const d = dist(q.x, q.y, x, y);
    if (d >= K.rs) continue;
    suppress(q, K.sup * (1 - d / K.rs * .6));
    q.proneT = S.t; q.b2Pin = S.t + 20;   // 炸懵了：20 秒内压制不低于 65（趴着抬不起头、不能前进）
    const u = unitOf(q);
    if (u && !hitU.has(u.id) && S.t - (u.b2T ?? -99) > 4) { hitU.add(u.id); u.b2T = S.t; u.morale = Math.max(0, u.morale - K.mor * (1 - d / K.rs)); u.hitT = S.t; }
  }
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst) { const d = dist(v.x, v.y, x, y); if (d < K.rs * .55) { v.sup = Math.min(100, v.sup + 60 * (1 - d / (K.rs * .55))); v.hitT = S.t; } }
  S.fx.push({ kind: 'b2', x, y, r: K.rs, life: 0, max: 2.4, side: 'e', w });
  const D = S.b2dust || (S.b2dust = []);
  D.push({ x: Math.round(x + gauss() * 6), y: Math.round(y + gauss() * 6), t: S.t, r: w === 'gbu31' ? 48 : 30 });
  if (D.length > 260) D.splice(0, D.length - 260);
  if (S.t - (S.b2shoutT ?? -99) > 6 && typeof shout === 'function') {   // 挨炸的排喊一嗓子
    const q = S.teams.find(q => q.side === 'p' && q.men.length && dist(q.x, q.y, x, y) < K.rs);
    if (q && unitOf(q)) { S.b2shoutT = S.t; shout(unitOf(q), pick(['B-2 地毯轰炸！趴下！', '天上全是炸弹！', '隐蔽！炸弹一路砸过来了！']), { side: 'p' }); }
  }
}
// 投弹顺序：从进入点开始就近串成一条航线
function b2Route(aims, x, y) {
  const left = aims.slice(), out = [];
  while (left.length) { let bi = 0, bd = Infinity; left.forEach((o, i) => { const d = dist(x, y, o[0], o[1]); if (d < bd) { bd = d; bi = i; } }); const o = left.splice(bi, 1)[0]; out.push(o); [x, y] = o; }
  return out;
}
// n 架的挂载与瞄准点；没有可打的目标返回 null
function b2Plan(n = B2.n) {
  const C = b2Cands(), plan = [];
  const jassm = b2Pick(C.sea, B2_LOAD.jassm.n, 0, 6).flatMap(o => Array(o[3] === 'cv' ? 6 : o[3] === 'dd' ? 4 : 2).fill(o)).slice(0, B2_LOAD.jassm.n);
  const g31 = b2Pick(C.hard, B2_LOAD.gbu31.n * 2, 14, 2), land = C.soft.concat(C.hard);
  if (jassm.length && n >= 3) plan.push({ load: 'jassm', aims: jassm });
  if (g31.length) plan.push({ load: 'gbu31', aims: g31.slice(0, B2_LOAD.gbu31.n) });
  if (g31.length > B2_LOAD.gbu31.n && n >= 5) plan.push({ load: 'gbu31', aims: g31.slice(B2_LOAD.gbu31.n) });   // 抢滩的坦克、登陆舰多：第二架也挂钻地弹
  // 其余几架都挂 GBU-38：按架数一起铺覆盖面，再按东西向分给各架（各炸一片，不重复投同一个点）
  const n38 = land.length ? n - plan.length : 0;
  if (n38 > 0) {
    const all = b2Carpet(b2Pick(land, B2_LOAD.gbu38.n * n38, 12, 2), land, B2_LOAD.gbu38.n * n38).sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < n38; k++) { const part = all.slice(Math.round(k * all.length / n38), Math.round((k + 1) * all.length / n38)); if (part.length) plan.push({ load: 'gbu38', aims: part }); }
  }
  if (!plan.length) return null;
  while (plan.length < n) plan.push({ ...plan[plan.length - 1] });   // 只有海上目标：其余几架同样分工、补射
  return plan.slice(0, n);
}

// —— 出动 ——
function b2Sortie(G) {
  const plan = b2Plan(G.n);
  if (!plan) { G.next = S.t + B2.retry; return; }
  const E = eaEnsure(), sp = EA_SPEC.b2;
  // 进入点：北边图外，正对主要目标的经度；楔形编队（长机居中在前，僚机两侧各两架、逐级向后 B2_FORM.back），全程保持队形：
  //   机群沿一条共同航线飞（按全部瞄准点聚成几片、就近串起来），各机在自己的编队位置上，瞄准点进了投放距离就投（JDAM 是 GPS 制导、能偏置投放）
  const cx = clamp(plan.reduce((a, p) => a + (p.aims[0] ? p.aims[0][0] : W / 2), 0) / plan.length, 300, W - 300);
  const land = plan.filter(p => p.load !== 'jassm').flatMap(p => p.aims);
  G.f = { x: cx, y: -B2.edge, heading: Math.PI / 2, spd: B2.spd, alt: B2.alt, hr: 0, bank: 0, ri: 0, pass: 0, route: b2FormRoute(land, cx, -B2.edge) };
  const order = plan.map((p, i) => i).sort((i, j) => (plan[i].aims[0] ? plan[i].aims[0][0] : cx) - (plan[j].aims[0] ? plan[j].aims[0][0] : cx));   // 瞄准点偏东的飞机排在编队东侧
  const slots = b2Slots(plan.length).sort((u, v) => v[1] - u[1]);   // 由东到西（航向向南时右翼 = 西）：先按横向位置排
  plan.forEach((p, i) => {
    const sl = slots[order.indexOf(i)] || [0, 0], x = cx - sl[1], y = -B2.edge - sl[0];
    E.fly.push({ id: S.nid++, type: 'b2', g: G.id, no: i + 1, x, y, heading: Math.PI / 2, spd: B2.spd, alt: B2.alt, bank: 0, hp: sp.hp, flares: sp.flares, t: S.t, pv: false,
      ph: 'in', load: p.load, fo: sl, aims: p.aims.map(o => [Math.round(o[0]), Math.round(o[1]), o[3] || null, o[4] ?? null]), i: 0, relT: 0 });
  });
  G.st = 'out'; G.k++;
  const what = plan.map((p, i) => `${i + 1} 号机挂 ${B2_LOAD[p.load].n} 枚 ${B2_LOAD[p.load].nm}，${p.load === 'jassm' ? '在防区外打海上舰艇' : p.load === 'gbu31' ? '打抢滩登陆舰与坦克' : `打${typeof cmdWhere === 'function' && p.aims[0] ? cmdWhere(p.aims[0][0], p.aims[0][1]) : '滩头'}一带的步兵、车辆`}`).join('；');
  if (typeof chatSay === 'function') chatSay('e', `决心：滩头吃紧，动用 B-2A 隐身轰炸机群（${plan.length} 架，一局仅此一波）从本土远程奔袭，高空突防：${what}。`, { kind: 'plan', lv: 1, at: plan[0].aims[0] ? { x: plan[0].aims[0][0], y: plan[0].aims[0][1] } : null });
  if (typeof eaStat === 'function') eaStat('b2Sortie');
}
// 楔形编队的位置 [向后, 横向（航向右侧为正）]：长机居中在前，僚机左右交替、逐级向后
const B2_FORM = { back: 75, side: 95, cell: 230, wp: 60, passes: 2 };
const b2Slots = n => Array.from({ length: n }, (_, i) => { const r = Math.ceil(i / 2); return [r * B2_FORM.back, (i % 2 ? -1 : 1) * r * B2_FORM.side]; });
// 机群的共同航线：瞄准点按 cell 的网格聚成几片（按价值加权的中心），从当前位置就近串起来；没有地面瞄准点（只打海上）就向南直飞一段
function b2FormRoute(aims, x, y) {
  if (!aims.length) return [[x, y + 700]];
  const cells = new Map();
  for (const o of aims) { const k = Math.floor(o[0] / B2_FORM.cell) + ',' + Math.floor(o[1] / B2_FORM.cell), c = cells.get(k) || { x: 0, y: 0, w: 0 }, w = Math.max(.5, o[2] || 1); c.x += o[0] * w; c.y += o[1] * w; c.w += w; cells.set(k, c); }
  return b2Route([...cells.values()].map(c => [Math.round(c.x / c.w), Math.round(c.y / c.w)]), x, y).map(o => [o[0], o[1]]);
}
// 编队基准点（机群共享，存在 G.f）沿航线平滑转向前进；航线飞完还有没投出去的弹，就按剩下的瞄准点再绕一圈（最多两遍），然后返航
function b2FormStep(G, dt) {
  const F = G.f, live = S.eair.fly.filter(a => a.type === 'b2' && a.g === G.id && !a.dead && !a.abort);
  if (F.ph !== 'out') {
    let w = F.route[F.ri];
    if (w && dist(F.x, F.y, w[0], w[1]) < B2_FORM.wp + 40) { F.ri++; w = F.route[F.ri]; }
    if (!w && live.some(a => a.load === 'jassm' && a.i < a.aims.length) && F.y < H - 200) { F.route.push([F.x + Math.cos(F.heading) * 300, F.y + Math.sin(F.heading) * 300]); w = F.route[F.ri]; }   // 巡航导弹还没射完：保持航向再飞一段
    if (!w) {
      const rest = live.filter(a => a.load !== 'jassm').flatMap(a => a.aims.slice(a.i));
      if (rest.length && F.pass < B2_FORM.passes - 1) { F.pass++; F.route = b2FormRoute(rest, F.x, F.y); F.ri = 0; w = F.route[0]; if (typeof chatSay === 'function') chatSay('e', `B-2A 机群保持编队转弯，再进入一次投弹航路。`, { kind: 'report', lv: 0, at: { x: w[0], y: w[1] } }); }
      else F.ph = 'out';
    }
    if (w) b2Turn(F, w[0], w[1], dt, B2.fturn);
  }
  if (F.ph === 'out') {   // 弹投完了：加速从最近的图边飞出（多半是北边），不再盘旋
    if (F.ox == null) { const e = [[F.x, -200, F.y], [W + 200, F.y, W - F.x], [-200, F.y, F.x]].sort((p, q) => p[2] - q[2])[0]; [F.ox, F.oy] = e; F.spd = B2.spd * 1.3; }
    b2Turn(F, F.ox, F.oy, dt, B2.fturn);
  }
}
// 机群里一架被击落（eair.js eaLost 调用）
function b2Down(a) {
  const G = S.b2 && S.b2.g.find(G => G.id === a.g);
  if (G) G.n = Math.max(0, G.n - 1);
  if (typeof chatSay === 'function') chatSay('e', `报告：B-2A ${a.no} 号机被击落，机组跳伞。`, { kind: 'report', lv: 0, at: { x: a.x, y: a.y } });
}

// —— 飞行 ——
function b2Turn(a, tx, ty, dt, rate = B2.turn) {
  const want = Math.atan2(ty - a.y, tx - a.x), da = eaAng(want - a.heading), k = airK(a);
  a.heading = eaAng(a.heading + airYaw(a, da, rate, dt)); a.bank = clamp(a.hr / rate, -.6, .6);   // 平滑转向、地速减半（carrier.js）
  a.x += Math.cos(a.heading) * a.spd * k * dt; a.y += Math.sin(a.heading) * a.spd * k * dt;
}
function b2Fly(a, dt) {
  const G = S.b2 && S.b2.g.find(G => G.id === a.g), F = G && G.f;
  if (a.ph === 'rtb') {   // 中弹（eaAA 置 rtb）：放弃攻击，脱离编队从图边飞出
    if (!a.abort && typeof chatSay === 'function') chatSay('e', `报告：B-2A ${a.no} 号机中弹受损，放弃攻击，脱离编队返航。`, { kind: 'report', lv: 1, at: { x: a.x, y: a.y } });
    a.abort = true; a.ph = 'out';
  }
  if (!F || a.abort) {   // 脱离编队的（或旧存档没有编队数据）：单机从最近的图边飞出
    if (a.ox == null) { const e = [[a.x, -200, a.y], [W + 200, a.y, W - a.x], [-200, a.y, a.x]].sort((p, q) => p[2] - q[2])[0]; [a.ox, a.oy] = e; }
    b2Turn(a, a.ox, a.oy, dt);
    if (a.x < -150 || a.x > W + 150 || a.y < -150) { a.dead = true; a.gone = true; }
    return;
  }
  if (G.fT !== S.t) { G.fT = S.t; b2FormStep(G, dt); }   // 每帧只推进一次编队基准点
  // 编队位置 = 基准点 + 本机的编队位置（随航向转）。各机自己转弯、加减速飞向编队位置前方一点（位置保持）：
  //   转弯时外侧的飞得快、内侧的慢，掉队了加速追，不刚性平移、不横着滑
  const [bk, sd] = a.fo || [0, 0], c = Math.cos(F.heading), sn = Math.sin(F.heading), px = F.x - c * bk - sn * sd, py = F.y - sn * bk + c * sd;
  if (!a.fk) { a.fk = 1; a.x = px; a.y = py; a.heading = F.heading; }
  const lag = (px - a.x) * c + (py - a.y) * sn;
  a.spd = clamp(F.spd + lag * .8, F.spd * .7, F.spd * 1.35);
  b2Turn(a, px + c * 90, py + sn * 90, dt);
  if (a.ph === 'in' || a.ph === 'run') {
    if (a.load === 'jassm') {   // 一进图就逐枚发射（编队照样往前飞）
      if (a.y > 40 && (a.relT -= dt) <= 0 && a.i < a.aims.length) {
        a.relT = B2.jEvery;
        const [x, y, k, id] = a.aims[a.i++], m = msLaunch('asm', 'e', a.x, a.y, { x, y }, { tgt: k ? { k, id } : null, spd: 240 });
        Object.assign(m, { nm: 'JASSM-ER 隐身巡航导弹', lo: true, life: 40 });
        if (a.i === 1) log('B-2A 在防区外发射 JASSM-ER 隐身巡航导弹', 'warn', 'b2j' + a.id, 30, { x, y });
      }
    } else if (a.i < a.aims.length) {
      // 逐枚投放：剩下的瞄准点里离本机最近、进了投放距离（GPS 制导滑翔，可以偏离航线投）的那个；每 0.12 秒一枚
      let bi = -1, bd = B2.rel + B2_FORM.side * 1.7;
      for (let j = a.i; j < a.aims.length; j++) { const o = a.aims[j], d = dist(a.x, a.y, o[0], o[1]); if (d < bd) { bd = d; bi = j; } }
      if (bi >= 0) {
        a.ph = 'run';
        if ((a.relT -= dt) <= 0) {
          a.relT = B2.every;
          const o = a.aims[bi]; a.aims[bi] = a.aims[a.i]; a.aims[a.i] = o;   // 投过的挪到前面（a.i 之前都是投过的）
          const x = o[0] + gauss() * B2.gps, y = o[1] + gauss() * B2.gps;
          if (!b2Own(x, y)) msLaunch('pgm', 'e', a.x, a.y, { x, y }, { src: 'b2', dur: 60, w: a.load });
          if (a.i === 0) log(`B-2A 隐身轰炸机编队投弹（${B2_LOAD[a.load].nm}）`, 'bad', 'b2drop' + a.g, 20, { x: o[0], y: o[1] });
          a.i++;
        }
      } else a.ph = 'in';
    }
  }
  if (F.ph === 'out') { a.ph = 'out'; if (a.x < -150 || a.x > W + 150 || a.y < -150) { a.dead = true; a.gone = true; } }   // 返航出了图边
}

function b2Step() {
  if (!S || S.phase !== 'battle' || !b2On() || !((S.assets && S.assets.eb2) > 0)) return;
  const B = b2Ensure(), E = S.eair;
  for (const G of B.g) {
    if (G.st === 'out') {
      if (!E || !E.fly.some(a => a.type === 'b2' && a.g === G.id && !a.dead)) { G.st = 'done'; G.backT = S.t; if (typeof chatSay === 'function') chatSay('e', `报告：B-2A 机群（${G.n} 架）完成攻击返航。`, { kind: 'report', lv: 1 }); }
    } else if (G.st === 'base' && G.n > 0 && S.t >= G.next) { G.next = S.t + B2.retry; if (b2Crisis()) b2Sortie(G); }   // 每 10 秒判断一次滩头是否吃紧
  }
}
HOOK.step.push(b2Step);
HOOK.step.push(() => { if (S && S.b2dust && S.b2dust.length) for (const q of S.teams) if (q.b2Pin > S.t && q.men.length) q.sup = Math.max(q.sup, 65); });

// —— 画面：重磅炸弹的火球、冲击波（drawFx 画外圈）与久久不散的烟尘 ——
HOOK.drawUnder.push(function b2DrawDust() {
  const D = S && S.b2dust;
  if (!D || !D.length || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx;
  ctx.save();
  for (const d of D) {
    const age = S.t - d.t, k = 1 - age / 45;
    if (k <= 0 || !inView(d.x, d.y, d.r * 2)) continue;
    const r = d.r * (1 + age / 30), dx = age * 1.2, g = ctx.createRadialGradient(d.x + dx, d.y - age * .5, 0, d.x + dx, d.y - age * .5, r);
    g.addColorStop(0, `rgba(58,50,42,${.42 * k})`); g.addColorStop(.6, `rgba(70,62,54,${.22 * k})`); g.addColorStop(1, 'rgba(70,62,54,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x + dx, d.y - age * .5, r, 0, 6.283); ctx.fill();
  }
  ctx.restore();
  if (S.t - (S.b2dustT ?? 0) > 5) { S.b2dustT = S.t; S.b2dust = D.filter(d => S.t - d.t < 45); }
});
HOOK.drawOver.push(function b2DrawBlast() {
  if (!S || !S.fx || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx;
  for (const f of S.fx) {
    if (f.kind !== 'b2' || !inView(f.x, f.y, f.r)) continue;
    const u = f.life / f.max;
    if (u < .35) {   // 火球
      const r = (f.w === 'gbu31' ? 46 : 30) * (.5 + u * 1.6), a = 1 - u / .35, g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `rgba(255,248,220,${.95 * a})`); g.addColorStop(.35, `rgba(255,170,60,${.85 * a})`); g.addColorStop(.75, `rgba(200,70,20,${.5 * a})`); g.addColorStop(1, 'rgba(120,40,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 6.283); ctx.fill();
    }
    // 第二道冲击波：贴地扩散的淡圈，到压制半径为止
    ctx.strokeStyle = `rgba(255,214,150,${(1 - u) * .5})`; ctx.lineWidth = px(2.2 * (1 - u) + .6);
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * Math.min(1, u * 1.8), 0, 6.283); ctx.stroke();
  }
});
