'use strict';
// 守方 B-2A「幽灵」隐身战略轰炸机群（沙盒守方「航空」里购买 e_b2：一组 3 架，从图外的本土 / 迪戈加西亚基地远程奔袭，打完返航，约 5 分钟后再来一波）
// 挂载按现实：两个内置弹舱，每舱一具旋转发射架或炸弹架，载弹约 18 吨。三架按目标分工，各挂一种：
//   GBU-38/B 500 磅 JDAM × 80（两舱各 40 枚，GPS / 惯导，一次通场可独立攻击 80 个瞄准点）—— 上岸的步兵、车辆
//   GBU-31(V)3/B 2000 磅 JDAM × 16（BLU-109 钻地战斗部）—— 抢滩的登陆舰、坦克
//   AGM-158B JASSM-ER 隐身巡航导弹 × 16（射程约 900 公里，亚音速、低可探测）—— 防区外打海上的驱逐舰、航母、登陆舰，不进舰空导弹射程
//   （现实中还能挂 CBU-87/97 集束炸弹 36 枚、GBU-57 巨型钻地弹 2 枚、B61 / B83 核弹 16 枚——这里不用）
// 分工：看得见海上舰船时一架挂 JASSM-ER；有抢滩的登陆舰或坦克时一架挂 GBU-31；其余挂 GBU-38（目标不够就改挂别的）
// 飞行：约 12000 米高空、亚音速（200 / 秒），三机楔形编队从北边图外进入；雷达反射截面极小（隐身 .1）——
//   高炮、单兵防空导弹、弹炮防空车的机炮、近防炮都够不着（eair.js eaHigh）；舰空导弹要很近才锁得住；歼击机雷达也要很近才发现
// 投弹：JDAM 在瞄准点前约 260 处逐枚投放（每 0.12 秒一枚），滑翔约 6 秒落地，GPS 散布约 ±4，不跟踪活动目标；
//   JASSM-ER 一进图就逐枚发射（每 0.35 秒一枚），掠海飞向目标，舰空导弹、近防炮可以拦截（低可探测，命中率打折）
// 中弹即放弃攻击返航（eaAA）；投完 / 打完从最近的图边飞出，回基地重新挂弹
// 情报：只打守方看得见（spotted）的目标；瞄准点 60 以内有自己人不投
// 状态（纯 JSON）：S.b2 = { g: [{ id, n 剩余架数, st: 'base' | 'out', next 下次出动时刻, k 出击次数 }] }；
//   飞机在 S.eair.fly（type 'b2'，g 机群 id，no 机号，load 挂载，aims 瞄准点 [x, y, k?, id?]，i 已投 / 已射枚数）
const B2 = { first: 150, gap: 300, retry: 15, spd: 200, alt: .95, turn: .8, hp: 3, rel: 260, every: .12, jEvery: .35, safe: 60, gps: 4, edge: 90 };
const B2_LOAD = {
  gbu38: { nm: 'GBU-38/B 500 磅 JDAM', n: 80 },
  gbu31: { nm: 'GBU-31(V)3/B 2000 磅 JDAM', n: 16 },
  jassm: { nm: 'AGM-158B JASSM-ER 隐身巡航导弹', n: 16 }
};
const b2On = () => !!S && S.mode === 'sandbox' && !(S.v7off && S.v7off.air);

function b2Ensure() {
  if (S.b2 && Array.isArray(S.b2.g)) return S.b2;
  const n = (S.assets && S.assets.eb2) || 0;
  return (S.b2 = { g: Array.from({ length: n }, (_, i) => ({ id: i + 1, n: 3, st: 'base', next: B2.first + i * 45, k: 0 })) });
}

// —— 目标（只用守方看得见的）——
function b2Seen(x, y) { return typeof spotted === 'function' ? spotted(x, y) : true; }
const b2Own = (x, y) => S.teams.some(q => q.side === 'e' && q.men.length && dist(q.x, q.y, x, y) < B2.safe);
// 呼叫（第 101 空降师优先）：挂好弹的机群提前出动（回到基地至少 60 秒），这一波优先打呼叫点 500 以内的目标（价值 ×4）
function b2Call(x, y, who) {
  if (!S || !b2On() || !((S.assets && S.assets.eb2) > 0)) return false;
  const B = b2Ensure();
  B.call = { x: Math.round(x), y: Math.round(y), t: S.t };
  const G = B.g.filter(G => G.st === 'base' && G.n > 0).sort((a, b) => a.next - b.next)[0];
  if (!G) return false;
  const t = Math.max(S.t + 8, (G.backT ?? -999) + 60);
  if (t < G.next) {
    G.next = t;
    if (typeof chatSay === 'function') chatSay('e', `命令：${who}呼叫 B-2A 火力支援——机群提前出击，优先打${typeof cmdWhere === 'function' ? cmdWhere(x, y) : gridRef(x, y)}一带之敌。`, { kind: 'order', lv: 1, at: { x, y } });
  }
  return true;
}
function b2Cands() {
  const soft = [], hard = [], sea = [], C = S.b2 && S.b2.call && S.t - S.b2.call.t < 240 ? S.b2.call : null;
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y) && b2Seen(q.x, q.y)) soft.push([q.x, q.y, q.men.length]);
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
// 投弹顺序：从进入点开始就近串成一条航线
function b2Route(aims, x, y) {
  const left = aims.slice(), out = [];
  while (left.length) { let bi = 0, bd = Infinity; left.forEach((o, i) => { const d = dist(x, y, o[0], o[1]); if (d < bd) { bd = d; bi = i; } }); const o = left.splice(bi, 1)[0]; out.push(o); [x, y] = o; }
  return out;
}
// 三架的挂载与瞄准点；没有可打的目标返回 null
function b2Plan() {
  const C = b2Cands(), plan = [];
  const jassm = b2Pick(C.sea, B2_LOAD.jassm.n, 0, 6).flatMap(o => Array(o[3] === 'cv' ? 6 : o[3] === 'dd' ? 4 : 2).fill(o)).slice(0, B2_LOAD.jassm.n);
  const g31 = b2Pick(C.hard, B2_LOAD.gbu31.n, 14, 2), g38 = b2Pick(C.soft.concat(C.hard), B2_LOAD.gbu38.n, 12, 2);
  if (jassm.length) plan.push({ load: 'jassm', aims: jassm });
  if (g31.length) plan.push({ load: 'gbu31', aims: g31 });
  while (plan.length < 3 && (g38.length || g31.length)) plan.push(g38.length >= 4 || !g31.length ? { load: 'gbu38', aims: g38 } : { load: 'gbu31', aims: g31 });
  if (!plan.length) return null;
  while (plan.length < 3) plan.push({ ...plan[plan.length - 1] });   // 目标少：其余几架同样分工、补投
  return plan.slice(0, 3);
}

// —— 出动 ——
function b2Sortie(G) {
  const plan0 = b2Plan(), plan = plan0 && plan0.slice(0, G.n);   // 被击落过的机群只剩几架就出几架
  if (!plan) { G.next = S.t + B2.retry; return; }
  const E = eaEnsure(), sp = EA_SPEC.b2;
  // 进入点：北边图外，正对主要目标的经度；楔形编队（长机居中在前，僚机两侧后方 90）
  const cx = clamp(plan.reduce((a, p) => a + (p.aims[0] ? p.aims[0][0] : W / 2), 0) / plan.length, 300, W - 300);
  plan.forEach((p, i) => {
    const x = cx + (i === 0 ? 0 : i === 1 ? -110 : 110), y = -B2.edge - (i === 0 ? 0 : 90);
    const aims = p.load === 'jassm' ? p.aims : b2Route(p.aims, x, y);
    E.fly.push({ id: S.nid++, type: 'b2', g: G.id, no: i + 1, x, y, heading: Math.PI / 2, spd: B2.spd, alt: B2.alt, bank: 0, hp: sp.hp, flares: sp.flares, t: S.t, pv: false,
      ph: 'in', load: p.load, aims: aims.map(o => [Math.round(o[0]), Math.round(o[1]), o[3] || null, o[4] ?? null]), i: 0, relT: 0 });
  });
  G.st = 'out'; G.k++;
  const what = plan.map((p, i) => `${i + 1} 号机挂 ${B2_LOAD[p.load].n} 枚 ${B2_LOAD[p.load].nm}，${p.load === 'jassm' ? '在防区外打海上舰艇' : p.load === 'gbu31' ? '打抢滩登陆舰与坦克' : `打${typeof cmdWhere === 'function' && p.aims[0] ? cmdWhere(p.aims[0][0], p.aims[0][1]) : '滩头'}一带的步兵、车辆`}`).join('；');
  if (typeof chatSay === 'function') chatSay('e', `决心：B-2A 隐身轰炸机群（${plan.length} 架，第 ${G.k} 次出击）从本土远程奔袭，高空突防：${what}。`, { kind: 'plan', lv: 1, at: plan[0].aims[0] ? { x: plan[0].aims[0][0], y: plan[0].aims[0][1] } : null });
  if (typeof eaStat === 'function') eaStat('b2Sortie');
}
// 机群里一架被击落（eair.js eaLost 调用）
function b2Down(a) {
  const G = S.b2 && S.b2.g.find(G => G.id === a.g);
  if (G) G.n = Math.max(0, G.n - 1);
  if (typeof chatSay === 'function') chatSay('e', `报告：B-2A ${a.no} 号机被击落，机组跳伞。`, { kind: 'report', lv: 0, at: { x: a.x, y: a.y } });
}

// —— 飞行 ——
function b2Turn(a, tx, ty, dt) {
  const want = Math.atan2(ty - a.y, tx - a.x), da = eaAng(want - a.heading), t = B2.turn * dt;
  a.heading = eaAng(a.heading + clamp(da, -t, t)); a.bank = clamp(da, -.6, .6);
  a.x += Math.cos(a.heading) * a.spd * dt; a.y += Math.sin(a.heading) * a.spd * dt;
}
function b2Fly(a, dt) {
  if (a.ph === 'rtb') {   // 中弹（eaAA 置 rtb）：放弃攻击，从图边飞出
    if (!a.abort && typeof chatSay === 'function') chatSay('e', `报告：B-2A ${a.no} 号机中弹受损，放弃攻击返航。`, { kind: 'report', lv: 1, at: { x: a.x, y: a.y } });
    a.abort = true; a.ph = 'out';
  }
  if (a.ph === 'in' || a.ph === 'run') {
    if (a.load === 'jassm') {   // 一进图就逐枚发射，然后掉头
      if (a.y > 40 && (a.relT -= dt) <= 0 && a.i < a.aims.length) {
        a.relT = B2.jEvery;
        const [x, y, k, id] = a.aims[a.i++], m = msLaunch('asm', 'e', a.x, a.y, { x, y }, { tgt: k ? { k, id } : null, spd: 240 });
        Object.assign(m, { nm: 'JASSM-ER 隐身巡航导弹', lo: true, life: 40 });
        if (a.i === 1) log('B-2A 在防区外发射 JASSM-ER 隐身巡航导弹', S.role === 'spectate' ? 'warn' : 'warn', 'b2j' + a.id, 30, { x, y });
      }
      if (a.i >= a.aims.length) a.ph = 'out';
      else b2Turn(a, a.x, a.y + 200, dt);   // 打完前一直向南直飞
    } else {
      const o = a.aims[a.i];
      if (!o) a.ph = 'out';
      else {
        b2Turn(a, o[0], o[1], dt);
        if (dist(a.x, a.y, o[0], o[1]) < B2.rel) {
          a.ph = 'run';
          if ((a.relT -= dt) <= 0) {   // 逐枚投放：每 0.12 秒一枚，同一航线上的下一个瞄准点也进了投放距离就接着投
            a.relT = B2.every;
            const x = o[0] + gauss() * B2.gps, y = o[1] + gauss() * B2.gps;
            if (!b2Own(x, y)) msLaunch('pgm', 'e', a.x, a.y, { x, y }, { src: 'b2', dur: 60, w: a.load });
            if (a.i === 0) log(`B-2A 隐身轰炸机投弹（${B2_LOAD[a.load].nm}）`, 'bad', 'b2drop' + a.g, 20, { x: o[0], y: o[1] });
            a.i++;
          }
        }
        if (a.i >= a.aims.length) a.ph = 'out';
      }
    }
  }
  if (a.ph === 'out') {   // 从最近的图边飞出（多半是北边）
    if (a.ox == null) { const e = [[a.x, -200, a.y], [W + 200, a.y, W - a.x], [-200, a.y, a.x]].sort((p, q) => p[2] - q[2])[0]; [a.ox, a.oy] = e; }
    b2Turn(a, a.ox, a.oy, dt);
    if (a.x < -150 || a.x > W + 150 || a.y < -150) { a.dead = true; a.gone = true; }
  }
}

function b2Step() {
  if (!S || S.phase !== 'battle' || !b2On() || !((S.assets && S.assets.eb2) > 0)) return;
  const B = b2Ensure(), E = S.eair;
  for (const G of B.g) {
    if (G.st === 'out') {
      if (!E || !E.fly.some(a => a.type === 'b2' && a.g === G.id && !a.dead)) { G.st = 'base'; G.next = S.t + B2.gap; G.backT = S.t; if (G.n > 0 && typeof chatSay === 'function') chatSay('e', `报告：B-2A 机群（剩 ${G.n} 架）返回基地重新挂弹，约 ${Math.round(B2.gap / 60)} 分钟后再次出击。`, { kind: 'report', lv: 1 }); }
    } else if (G.n > 0 && S.t >= G.next && S.teams.some(q => q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y))) b2Sortie(G);   // 敌人上岸后才出动
  }
}
HOOK.step.push(b2Step);
