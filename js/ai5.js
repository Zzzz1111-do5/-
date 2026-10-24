'use strict';
// 守方蓄力总攻（v13）：不再逐次添油、被各个击破——
// ① 蓄力：我军上陆站稳（或丢了第一个据点）后，把机动预备队整连、远方抽调到位的支队、第 101 空降师落地的连编入总攻集团（守备队照常坚守），
//    调到主攻方向背后、我方看不见的集结地域隐蔽待命；坦克、步兵战车跟着各连（ai4 a4Bind），防空车掩护集结地域；
//    蓄力期间 ai4 的小规模反冲击、机动加强、ai2 的兵力调度都不抽用这些兵力（只有指挥所告急例外），第 101 空降师也留着配合总攻；
// ② 主攻方向：我方占着的据点里最要害的——滩头出口（切断登陆场与海滩）优先，其次分值高、我方守备薄弱、离集结地域近的；
// ③ 发起时机：集结到位的兵力 ≥ 目标附近我方兵力的 1.4 倍且不少于 30 人；或我方刚推进上来弹药不足、士气动摇（机会），够 20 人且不少于我方；
//    或蓄力超过 A5.max 秒、够 20 人；
// ④ 总攻：各连进入冲击出发阵地（目标前 160、分两三个方向）同时炮兵火力准备、攻击机与武装直升机编队同时出动、第 101 空降师在目标另一侧空降夹击
//    → 统一发起，坦克在步兵线后伴随、防空车跟进掩护 → 接近后冲锋；
// ⑤ 夺回后扩张战果：兵力还有六成、附近还有我方据点就转向下一个；伤亡过半或 150 秒打不下转入防御，休整后再蓄力。
// 状态：S.ai.g5 = { st: build | prep | go | rest, t, key, x, y（集结地域）, ux, uy（攻击方向）, units: [连 id], aa: [车 id], men0, goT, n 次数 }
const A5 = { start: 60, max: 110, need: 1.4, minMen: 24, oppMen: 20, prep: 16, prepMax: 50, go: 150, rest: 90, keepHQ: true };
const a5On = () => !!S && S.ai && typeof a4On === 'function' && a4On();
const a5G = () => S.ai.g5 || (S.ai.g5 = { st: 'off', t: 0, units: [], aa: [], n: 0 });
const a5Say = (t, o) => typeof chatSay === 'function' ? chatSay('e', t, o) : null;
const a5Units = G => G.units.map(id => UNIT_MAP.get(id)).filter(u => u && u.state !== 'rout' && a4Ts(u).length);
// 总攻集团的连：ai2 不调动、ai3 不抽去袭扰、ai4 不拿去零散反冲击（a4UnitBusy 读这里）
const a5Has = id => !!(S && S.ai && S.ai.g5 && S.ai.g5.st !== 'off' && S.ai.g5.st !== 'rest' && S.ai.g5.units.includes(id));
// 蓄力期间第 101 空降师不零散空降（a101.js 读）
const a5Hold = () => !!(S && S.ai && S.ai.g5 && S.ai.g5.st === 'build' && S.t - S.ai.g5.t < 90);   // 最多扣 90 秒
// 炮兵火力重点（ai4 a4Focus 先问这里）：火力准备打目标；发起后 25 秒内向我方来路延伸
function a5Focus() {
  const G = S && S.ai && S.ai.g5;
  if (!G || !G.key) return null;
  if (G.st === 'prep') return { x: G.tx, y: G.ty, r: 110 };
  if (G.st === 'go' && S.t - G.goT < 25) return { x: G.tx - G.ux * 160, y: G.ty - G.uy * 160, r: 100 };
  return null;
}
// 我方在 (x, y) r 以内的兵力（坦克车组 ×1.5）与平均弹药、动摇程度
function a5Our(x, y, r) {
  let men = 0, ammo = 0, n = 0, shaky = 0;
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride && dist(q.x, q.y, x, y) < r) { men += q.men.length; ammo += q.ammo; n++; const u = unitOf(q); if (u && u.state !== 'ok') shaky++; }
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && !v.lst && dist(v.x, v.y, x, y) < r) men += vehCrew(v) * 1.5;
  return { men: Math.round(men), ammo: n ? ammo / n : 60, shaky: n ? shaky / n : 0 };
}
// 主攻方向：我方占着（或正在夺）的据点
function a5Target(from) {
  let best = null, bs = -Infinity;
  for (const p of S.points) {
    if (!(p.owner === 'p' || p.prog > .3)) continue;
    const our = a5Our(p.x, p.y, 280), d = from ? dist(from.x, from.y, p.x, p.y) : 0;
    const s = (/^E\d/.test(p.key) ? 5 : 0) + (p.vp || 1) * 1.5 + (p.key === 'HQ' ? 6 : 0) - our.men / 12 - d / 700 + (our.ammo < 25 ? 2 : 0);
    if (s > bs) { bs = s; best = p; }
  }
  return best;
}
// 集结地域：目标背向我方一侧 280–420、可通行、我方看不见、离已知我军 220 以外、掩护好
function a5Rally(T) {
  const hq = S.points.find(p => p.key === 'HQ' && p.owner === 'e'), rx = hq ? hq.x : T.x, ry = hq ? Math.min(hq.y, T.y - 200) : T.y - 400;
  const base = Math.atan2(ry - T.y, rx - T.x), F = a4Foes();
  let best = null, bs = -Infinity;
  for (let i = 0; i < 36; i++) {
    const a = base + (i / 36 - .5) * 1.6, r = 280 + (i % 4) * 45, x = clamp(T.x + Math.cos(a) * r, 30, W - 30), y = clamp(T.y + Math.sin(a) * r, 30, H - 30);
    if (!passInf(x, y)) continue;
    const fd = a4FoeD(F, x, y);
    if (fd < 220) continue;
    const s = (1 - coverAt(x, y)) * 2 - (PV[ci(x, y)] ? 3 : 0) + Math.min(fd, 500) / 250 - (coastAt(x) - y < 220 ? 2 : 0) + Math.random() * .2;
    if (s > bs) { bs = s; best = { x: Math.round(x), y: Math.round(y) }; }
  }
  return best;
}
// 可编入总攻的连：机动预备队（含落地集合完的第 101 空降师）、到位的抽调支队；不抽守备队、正在反冲击的、行军中的；指挥所旁留一个预备连
function a5Pool(G) {
  const C = a4C(), hq = S.points.find(p => p.key === 'HQ' && p.owner === 'e'), out = [], F = a4Foes();
  for (const u of S.units) {
    if (u.side !== 'e' || u.kind !== 'inf' || u.role !== 'reserve' || u.state === 'rout' || G.units.includes(u.id) || C.dr[u.id]) continue;
    const pl = a4Plan(C, u.id);
    if (pl && pl.st === 'go') continue;
    const ts = a4Ts(u), c = a4Cent(u);
    if (a4Men(ts) < 3 || ts.some(q => q.raid || a4Held(q) || C.fl[q.id])) continue;
    if (c && a4FoeD(F, c[0], c[1]) < 220) continue;   // 正在交战的连抽不出来，硬抽只会在路上被打散
    out.push(u);
  }
  if (A5.keepHQ && hq && out.length >= 3) {   // 总预备队留一个连在指挥所
    const c = out.map(u => ({ u, c: a4Cent(u) })).filter(o => o.c).sort((a, b) => dist(a.c[0], a.c[1], hq.x, hq.y) - dist(b.c[0], b.c[1], hq.x, hq.y))[0];
    if (c && dist(c.c[0], c.c[1], hq.x, hq.y) < 300) out.splice(out.indexOf(c.u), 1);
  }
  return out;
}
function a5Recruit(G, us) {
  const C = a4C();
  let k = G.units.length;
  for (const u of us) {
    delete C.res[u.id];
    const pl = a4Plan(C, u.id);
    if (pl) pl.units = pl.units.filter(id => id !== u.id);
    G.units.push(u.id); u.a4T = S.t;
    const lat = ((k % 2) ? 1 : -1) * Math.ceil(k / 2) * 46, back = (k % 3) * 18;   // 集结地域里各连左右错开
    a4Move(u, G.x - G.uy * lat - G.ux * back, G.y + G.ux * lat - G.uy * back, Math.atan2(G.uy, G.ux));
    k++;
  }
  // 防空车掩护集结地域（最多 2 辆）
  for (const v of S.veh || []) {
    if (G.aa.length >= 2) break;
    if (v.side !== 'e' || v.dead || v.afD || (v.type !== 'aa_veh' && v.type !== 'sam_veh') || G.aa.includes(v.id) || v.immob || dist(v.x, v.y, G.x, G.y) > 1200) continue;
    G.aa.push(v.id);
    v.cmd = { t: 'move', x: Math.round(G.x - G.ux * 50), y: Math.round(G.y - G.uy * 50), face: Math.atan2(G.uy, G.ux), until: S.t + 600, ai: 'aacov' };
  }
}
const a5Men = G => a5Units(G).reduce((a, u) => a + a4Men(a4Ts(u)), 0);
const a5Arrived = (G, x, y, r) => a5Units(G).reduce((a, u) => a + a4Men(a4Ts(u).filter(q => dist(q.x, q.y, x, y) < r)), 0);   // r：集结地域半径
function a5SetTarget(G, p) {
  G.key = p.key; G.tx = p.x; G.ty = p.y;
  const R = a5Rally(p) || { x: p.x, y: p.y - 340 };
  G.x = R.x; G.y = R.y;
  const l = Math.max(1, dist(G.x, G.y, p.x, p.y)); G.ux = (p.x - G.x) / l; G.uy = (p.y - G.y) / l;
}
function a5Release(G, why) {
  const C = a4C(), p = ptByKey(G.key);
  for (const u of a5Units(G)) {
    if (why === 'ok' && p) { u.role = 'garrison'; u.obj = p.key; for (const q of a4Ts(u)) { q.role = 'garrison'; q.obj = p.key; q.px = null; if (q.order.t === 'charge' || q.order.t === 'amove') q.order = { t: 'hold' }; } }
    else { if (why === 'fail') a4Move(u, G.x, G.y, Math.atan2(G.uy, G.ux), 'retreat'); if (p) C.res[u.id] = { st: 'stand', key: p.key, x: G.x, y: G.y, t: S.t, calm: S.t }; }
  }
  for (const id of G.aa) { const v = typeof vehById === 'function' ? vehById(id) : null; if (v) v.cmd = null; }
  Object.assign(G, { st: 'rest', t: S.t, units: [], aa: [] });
}

function a5Think() {
  if (!S || S.phase !== 'battle' || S.over || !a5On() || !S.ai.co) return;
  const G = a5G();
  const ashore = S.teams.filter(q => q.side === 'p' && q.men.length && isLand(q.x, q.y)).reduce((a, q) => a + q.men.length, 0);
  switch (G.st) {
    case 'off': case 'rest': {
      if (S.t < A5.start || ashore < 15 || (G.st === 'rest' && S.t - G.t < A5.rest)) return;
      if (!S.points.some(p => p.owner === 'p' || p.prog > .3) && ashore < 30) return;
      const p = a5Target(null);
      if (!p) return;
      a5SetTarget(G, p);
      Object.assign(G, { st: 'build', t: S.t });
      G.n++;
      a4Stat('a5Build');
      a5Say(`判断：敌已上陆约 ${ashore} 人，正逐点进攻，我各据点分兵反击只会被各个击破。决心：停止逐次反冲击，集中机动预备队、空降兵与坦克，在${a4Where(G.x, G.y)}隐蔽集结，蓄力向${p.name}实施总攻。`, { kind: 'plan', at: { x: G.x, y: G.y }, lv: 0 });
      return;
    }
    case 'build': {
      // 目标变了（我方又夺了更要害的据点）就改主攻方向
      const p0 = ptByKey(G.key), p1 = a5Target({ x: G.x, y: G.y });
      if (!p0 || (p0.owner === 'e' && p0.prog < .1)) { if (p1) a5SetTarget(G, p1); else { a5Release(G, 'cancel'); return; } }
      const pool = a5Pool(G);
      if (pool.length) { a5Recruit(G, pool); a5Say(`命令：${pool.map(a4Name).join('、')}编入总攻集团，到${a4Where(G.x, G.y)}隐蔽集结，不得零散投入。`, { kind: 'order', at: { x: G.x, y: G.y }, key: 'a5rec', gap: 25, lv: 1 }); }
      const T = ptByKey(G.key), our = a5Our(T.x, T.y, 300), men = a5Arrived(G, G.x, G.y, 180);
      const tot = a5Men(G), ready = men >= tot * .7 && men >= A5.oppMen && men >= our.men * 1.1;   // 七成到位、对目标之敌占优就不再干等
      const strong = men >= Math.max(A5.minMen, our.men * A5.need) || ready, chance = (our.ammo < 25 || our.shaky > .3) && men >= Math.max(A5.oppMen, our.men), late = S.t - G.t > A5.max && (men >= A5.oppMen || tot >= Math.min(A5.oppMen, 14));   // 等太久：各连从所在位置直接向冲击出发阵地开进，向心合击
      if (!(strong || chance || late)) return;
      G.st = 'prep'; G.t = S.t; G.men0 = a5Men(G);
      // 冲击出发阵地：目标前 160，按连分成两三个方向
      a5Units(G).forEach((u, i) => {
        const lane = ((i % 3) - 1) * 80, x = T.x - G.ux * 160 - G.uy * lane, y = T.y - G.uy * 160 + G.ux * lane;
        a4Move(u, x, y, Math.atan2(T.y - y, T.x - x));
      });
      const air = typeof eaMass === 'function' ? eaMass(T.x, T.y, `向${T.name}的总攻`) : 0;
      const E1 = S.e101;
      let ab = false;
      if (E1 && E1.n > 0 && !E1.lift) { E1.force = T.key; E1.next = Math.min(E1.next, S.t); ab = true; }   // 第 101 空降师配合总攻空降
      const nv = (S.veh || []).filter(v => v.side === 'e' && !v.dead && v.buddy != null && G.units.includes(v.buddy)).length;
      a4Stat('a5Go');
      a5Say(`决心：${strong ? `总攻集团已集结 ${men} 人，对${T.name}之敌（约 ${our.men} 人）占优` : chance ? `${T.name}之敌弹药不足、士气动摇，战机已到` : '蓄力已久，不能再等'}——向${T.name}发起总攻！命令：各连进入冲击出发阵地，炮兵火力准备${air ? `，攻击机、武装直升机 ${air} 架编队同时出击` : ''}${nv ? `，坦克、步兵战车 ${nv} 辆伴随` : ''}${ab ? '，第 101 空降师在目标另一侧空降夹击' : ''}；火力准备结束统一冲击，不得各自为战。`, { kind: 'plan', at: T, lv: 0 });
      return;
    }
    case 'prep': {
      const T = ptByKey(G.key), us = a5Units(G);
      if (!T || !us.length) { a5Release(G, 'cancel'); return; }
      const ld = us.reduce((a, u) => a + a4Men(a4Ts(u).filter(q => dist(q.x, q.y, T.x, T.y) < 230)), 0);
      if (S.t - G.t < A5.prep || (ld < a5Men(G) * .7 && S.t - G.t < A5.prepMax)) return;
      G.st = 'go'; G.goT = S.t; G.men0 = a5Men(G); G.air2 = 0;
      for (const u of us) { const c = a4Cent(u) || [T.x, T.y]; a4Move(u, T.x + (c[0] - T.x) * .15, T.y + (c[1] - T.y) * .15, Math.atan2(T.y - c[1], T.x - c[0]), 'amove'); }
      for (const id of G.aa) { const v = vehById(id); if (v && !v.dead) v.cmd = { t: 'move', x: Math.round(T.x - G.ux * 260), y: Math.round(T.y - G.uy * 260), face: Math.atan2(G.uy, G.ux), until: S.t + 300, ai: 'aacov' }; }
      a5Say(`命令：火力延伸！总攻集团 ${us.length} 个连 ${G.men0} 人从 ${Math.min(3, us.length)} 个方向向${T.name}同时冲击，坦克在步兵线后跟进，防空车随后掩护。`, { kind: 'order', at: T, lv: 0 });
      return;
    }
    case 'go': {
      const T = ptByKey(G.key), us = a5Units(G);
      if (!T || !us.length) { a5Release(G, 'fail'); return; }
      const men = a5Men(G);
      // 夺回：扩张战果（还有六成兵力、600 内还有我方据点）或就地转入防御
      if (T.owner === 'e' && T.prog < .1 && a5Our(T.x, T.y, 90).men === 0) {
        const nx = men >= G.men0 * .6 ? S.points.filter(p => p.owner === 'p' && dist(p.x, p.y, T.x, T.y) < 600).sort((a, b) => dist(a.x, a.y, T.x, T.y) - dist(b.x, b.y, T.x, T.y))[0] : null;
        a4Stat('a5Ok');
        if (nx) {
          G.key = nx.key; G.tx = nx.x; G.ty = nx.y; G.goT = S.t; G.men0 = men;
          const l = Math.max(1, dist(T.x, T.y, nx.x, nx.y)); G.ux = (nx.x - T.x) / l; G.uy = (nx.y - T.y) / l;
          for (const u of us) a4Move(u, nx.x, nx.y, Math.atan2(G.uy, G.ux), 'amove');
          if (typeof eaMass === 'function') eaMass(nx.x, nx.y, `向${nx.name}的追击`);
          a5Say(`报告：总攻得手，夺回${T.name}！命令：不停顿，乘胜向${nx.name}扩张战果。`, { kind: 'order', at: nx, lv: 0 });
        } else {
          a5Release(G, 'ok');
          a5Say(`报告：总攻得手，夺回${T.name}，各连就地转入防御，抓紧补充弹药，准备下一次总攻。`, { kind: 'report', at: T, lv: 0 });
        }
        return;
      }
      if (men < G.men0 * .5 || S.t - G.goT > A5.go) {
        a4Stat('a5Fail');
        a5Say(`报告：向${T.name}的总攻受挫（伤亡 ${G.men0 - men} 人），各连撤回集结地域休整，重新蓄力。`, { kind: 'report', at: T, lv: 0 });
        a5Release(G, 'fail');
        return;
      }
      // 接近后：敌被压制或我兵力占优就冲锋；停下的组继续攻击前进
      const seen = S.teams.filter(o => o.side === 'p' && o.men.length && dist(o.x, o.y, T.x, T.y) < 100 && spotted(o.x, o.y));
      const shaken = seen.length && seen.reduce((a, o) => a + o.sup, 0) / seen.length > 40, strong = men >= a5Our(T.x, T.y, 120).men * 1.4;
      for (const q of us.flatMap(a4Ts)) {
        const d = dist(q.x, q.y, T.x, T.y);
        if (d < 90 && (shaken || strong)) { if (q.order.t !== 'charge') aiGo(q, T.x + gauss() * 12, T.y + gauss() * 12, 'charge', T.x, T.y); }
        else if (q.order.t === 'hold' && d > 30) aiGo(q, T.x + gauss() * 15, T.y + gauss() * 15, 'amove', T.x, T.y);
      }
      // 防空车跟进；第二波航空火力
      if (S.t - G.goT > 30 && !G.air2) { G.air2 = 1; if (typeof eaMass === 'function') eaMass(T.x, T.y, `向${T.name}的总攻`); }
      return;
    }
  }
}
function a5Step(dt) {   // 每 3 秒
  if (!S || !S.ai || S.phase !== 'battle') return;
  const G = a5G();
  if ((G.thT = (G.thT ?? 2) - dt) > 0) return;
  G.thT = 3;
  a5Think();
}
HOOK.step.push(a5Step);

// —— 观战时画：集结地域虚线圈、主攻箭头 ——
HOOK.drawOver.push(function a5Draw(time) {
  const G = S && S.ai && S.ai.g5;
  if (!G || !G.key || !['build', 'prep', 'go'].includes(G.st) || S.role !== 'spectate' || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx;
  ctx.save();
  ctx.strokeStyle = rgba(COL.enemy, .5 + .2 * Math.sin(time * 3)); ctx.lineWidth = px(1.6); ctx.setLineDash([px(6), px(5)]);
  ctx.beginPath(); ctx.arc(G.x, G.y, 110, 0, 7); ctx.stroke();
  ctx.setLineDash(G.st === 'go' ? [] : [px(8), px(6)]); ctx.lineWidth = px(G.st === 'go' ? 3 : 2);
  const ex = G.tx - G.ux * 40, ey = G.ty - G.uy * 40;
  ctx.beginPath(); ctx.moveTo(G.x, G.y); ctx.lineTo(ex, ey); ctx.stroke();
  const a = Math.atan2(G.uy, G.ux);
  ctx.setLineDash([]); ctx.fillStyle = rgba(COL.enemy, .7);
  ctx.beginPath(); ctx.moveTo(ex + Math.cos(a) * 22, ey + Math.sin(a) * 22); ctx.lineTo(ex + Math.cos(a + 2.5) * 16, ey + Math.sin(a + 2.5) * 16); ctx.lineTo(ex + Math.cos(a - 2.5) * 16, ey + Math.sin(a - 2.5) * 16); ctx.fill();
  ctx.restore();
});
