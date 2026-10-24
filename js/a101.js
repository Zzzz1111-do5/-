'use strict';
// 美军第 101 空降师（空中突击）：UH-60M「黑鹰」机降增援（守方）——
//   战役：困难 1 批、地狱 2 批；沙盒：守方目录「第 101 空降师 · 空中突击连」，每买一份多一批。开战 A101.first 秒后才可用，两批间隔 A101.gap 秒。
//   守方 AI：我军上岸后，挑受威胁最大的己方据点（或刚被我军夺取、值得反冲击的据点），在其内陆一侧 140–300、离我军 220 以外、
//     避开已知我方防空（暴露过的便携防空组、自行高炮 / 弹炮防空车）的平地选机降场；
//   4 架 UH-60M 从地图北缘低空飞来（两两编队），每架载一个班（3 个步枪 / 机枪班 + 1 个标枪反坦克班），落地 4 秒下完人立即北返；
//     下机的部队编成「101 空降师」连，归入守方预备队增援 / 反冲击（ai2 / ai4 接管）。门边机枪在降落时压制机降场 150 以内看得见的我军。
//   黑鹰进 S.eair.fly（type = uh60），我方便携防空导弹、自行高炮、弹炮防空车、舰空导弹与战斗机都能把它打下来，机上的班随之损失；
//     中弹未坠的放弃机降、带兵返航。
// 状态：S.e101 = { n 剩余批次, next 下一批最早时刻, lift: {id, lz, key, t, n 架数, land 已落地, lost 损失人数} | null, done 已完成批次 }
const A101 = { first: { normal: 200, hard: 150, hell: 110 }, gap: 150, n: { normal: 0, hard: 1, hell: 2 }, lzMin: 140, lzMax: 300, safe: 220, aaR: 330, helos: 4 };
const A101_MEN = [['rifle', 'rifle', 'mg'], ['rifle', 'mg', 'rifle'], ['rifle', 'rifle', 'mg'], ['rifle', 'rifle', 'rifle']];   // 最后一个班带标枪
const A101_ICON = typeof WI === 'object' && WI.uh60 ? WI.uh60 : '';

function a101Ensure() {
  if (S.e101) return S.e101;
  const lv = S.level || 'hard', sbx = S.mode === 'sandbox';
  return (S.e101 = { n: sbx ? (S.assets && S.assets.e101) || 0 : A101.n[lv] || 0, next: (A101.first[lv] || 150) * (sbx ? .8 : 1), lift: null, done: 0 });
}
// 机降场：据点 p 内陆一侧，按离据点近、离我军远、隐蔽好打分
function a101LZ(p) {
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length);
  const aa = [...S.teams.filter(q => q.side === 'p' && q.men.length && q.men.includes('aa') && q.aaSeenE != null && S.t - q.aaSeenE < 180),
    ...(S.veh || []).filter(v => v.side === 'p' && !v.dead && (v.type === 'aa_veh' || v.type === 'sam_veh') && spotted(v.x, v.y))];
  let best = null, bs = -Infinity;
  for (let k = 0; k < 60; k++) {
    const a = -Math.PI / 2 + gauss() * .7, r = A101.lzMin + Math.random() * (A101.lzMax - A101.lzMin), x = clamp(p.x + Math.cos(a) * r, 40, W - 40), y = clamp(p.y + Math.sin(a) * r, 40, H - 40);
    if (!isLand(x, y) || !passInf(x, y) || coastAt(x) - y < 120) continue;
    const dp = pT.length ? Math.min(...pT.map(q => dist(q.x, q.y, x, y))) : 999;
    if (dp < A101.safe || aa.some(o => dist(o.x, o.y, x, y) < A101.aaR)) continue;
    const s = -dist(x, y, p.x, p.y) / 100 + Math.min(dp, 500) / 150 + coverAt(x, y) * .5 + Math.random() * .3;
    if (s > bs) { bs = s; best = { x: Math.round(x), y: Math.round(y) }; }
  }
  return best;
}
// 去哪儿：受威胁最大的己方据点（威胁 ≥ 2），或我军刚夺取、价值最高的据点（反冲击）
function a101Obj() {
  const thr = S.ai && S.ai.co && S.ai.co.thr;
  let best = null, bs = 0;
  for (const p of S.points) {
    let s = 0;
    if (p.owner === 'e') { const T = thr && thr[p.key]; s = T ? T[2] : S.teams.filter(q => q.side === 'p' && q.men.length && dist(q.x, q.y, p.x, p.y) < 260).length * .6; if (s < 2) continue; }
    else s = 1.5 + (p.vp || 1) * .8;
    if (s > bs) { bs = s; best = p; }
  }
  return best;
}
function a101Think() {
  const E1 = a101Ensure();
  if (E1.lift || !(E1.n > 0) || S.t < E1.next || typeof eaEnsure !== 'function') return;
  const ashore = S.teams.filter(q => q.side === 'p' && q.men.length && isLand(q.x, q.y)).length;
  if (ashore < 5) return;
  const p = a101Obj(), lz = p && a101LZ(p);
  if (!lz) { E1.next = S.t + 10; return; }
  const E = eaEnsure(), id = S.nid++;
  E1.lift = { id, lz, key: p.key, t: S.t, n: A101.helos, land: 0, lost: 0, u: null };
  E1.n--; E1.next = S.t + A101.gap;
  for (let k = 0; k < A101.helos; k++) {
    const side = k % 2 ? 1 : -1, row = k >> 1, x0 = clamp(lz.x + side * (30 + row * 10) + gauss() * 20, 40, W - 40);
    const lx = lz.x + side * (14 + row * 8), ly = lz.y + row * 16 - 8;
    E.fly.push({ id: S.nid++, type: 'uh60', lift: id, k, x: x0, y: -40 - row * 70, heading: Math.atan2(ly + 40, lx - x0), spd: EA_SPEC.uh60.spd, alt: .25, bank: 0, hp: EA_SPEC.uh60.hp, flares: EA_SPEC.uh60.flares,
      ph: 'in', lx, ly, men: A101_MEN[k].slice(), mod: k === 3 ? { at: 1.5, atPen: 3.4, rng: 1.6, pow: .8 } : null, t: S.t, pv: false });
  }
  if (typeof v8Stat === 'function') v8Stat('a101Go');
  const wh = typeof cmdWhere === 'function' ? cmdWhere(lz.x, lz.y) : gridRef(lz.x, lz.y);
  if (typeof chatSay === 'function') chatSay('e', `命令：第 101 空降师一个空中突击连，${A101.helos} 架 UH-60M 黑鹰低空机降${wh}，增援${p.name}${p.owner === 'p' ? '、发起反冲击' : ''}。`, { kind: 'order', at: lz, lv: 0 });
}
// 飞行：in 低空进场（两两编队）→ land 悬停落地（门边机枪压制）→ 下人 → out 北返出图
function a101Fly(a, dt) {
  const E1 = a101Ensure(), L = E1.lift && E1.lift.id === a.lift ? E1.lift : null, sp = EA_SPEC.uh60;
  if (a.ph === 'rtb') a.ph = a.men ? 'abort' : 'out';   // 中弹：带兵返航（eaAA 把受伤的飞机设成 rtb）
  if (a.ph === 'in') {
    a.alt = Math.min(.25, a.alt + dt * .2);
    const d = dist(a.x, a.y, a.lx, a.ly);
    eaSteer(a, a.lx, a.ly, dt, d < 120 ? Math.max(8, d * .6) : sp.spd);
    if (d < 160) a101Guns(a, dt);
    if (d < 10) { a.ph = 'land'; a.lt = 0; }
  } else if (a.ph === 'land') {
    a.spd = Math.max(0, a.spd - 40 * dt); a.alt = Math.max(.03, a.alt - dt * .12); a.lt += dt;
    a101Guns(a, dt);
    if (a.men && a.lt > 2) a101Unload(a, L);
    if (a.lt > 4) a.ph = 'out';
  } else {
    a.alt = Math.min(.25, a.alt + dt * .15);
    eaSteer(a, a.x + (a.k % 2 ? 40 : -40), -120, dt, sp.spd);
    if (a.y < -40) { a.dead = true; a.home = true; if (a.ph === 'abort' && typeof v8Stat === 'function') v8Stat('a101Abort'); }
  }
}
// 门边机枪（M240）：150 以内看得见的我军小组，每 0.7 秒一个点射
function a101Guns(a, dt) {
  if ((a.gT = (a.gT ?? .5) - dt) > 0) return;
  a.gT = .7;
  let tg = null, bd = 150;
  for (const q of S.teams) if (q.side === 'p' && q.men.length && !q.ride) { const d = dist(q.x, q.y, a.x, a.y); if (d < bd && spotted(q.x, q.y)) { bd = d; tg = q; } }
  if (!tg) return;
  suppress(tg, 12, a.x, a.y);
  if (Math.random() < .06 * coverAt(tg.x, tg.y) / .9) killMan(tg);
  tracer(a.x, a.y, tg.x + gauss() * 6, tg.y + gauss() * 6, 'e', inVision(a.x, a.y));
  a.gunT = .3;
}
function a101Unload(a, L) {
  const p = L && S.points.find(o => o.key === L.key) || S.points[0];
  if (L && !L.u) { L.u = addUnit('e', 'inf', { role: 'reserve', obj: p.key, form: 'wedge', a4n: '第 101 空降师', morale: 88 }).id; }
  const uid = L ? L.u : addUnit('e', 'inf', { role: 'reserve', obj: p.key }).id;
  const q = addTeam('e', a.x + gauss() * 6, a.y + gauss() * 6, a.men, { role: 'reserve', obj: p.key, u: uid, a101: true, ...(a.mod ? { mod: { ...a.mod } } : {}) });
  const lz = L ? L.lz : { x: a.x, y: a.y }, k = L ? L.land : 0;
  aiGo(q, lz.x + (k % 2 ? 18 : -18), lz.y - 10 + (k >> 1) * 18, 'move', p.x, p.y);   // 先在机降场就地集合、占领环形阵地，整连到齐再投入（a101Step → a4Adopt）
  const uu = UNIT_MAP.get(uid);
  if (uu) uu.a4T = S.t;   // 集合期间 ai4 不改派
  a.men = null;
  if (L) L.land++;
  if (typeof v8Stat === 'function') v8Stat('a101Men', q.men.length);
  S.fx.push({ kind: 'flash', x: a.x, y: a.y, r: 10, life: 0, max: .5, side: 'e' });
  if (L && L.land === 1) {
    if (spotted(a.x, a.y) || inVision(a.x, a.y)) log(`敌直升机在${typeof cmdWhere === 'function' ? cmdWhere(a.x, a.y) : gridRef(a.x, a.y)}机降，敌第 101 空降师部队落地`, 'bad', null, 0, { x: a.x, y: a.y });
    if (typeof chatSay === 'function') chatSay('p', `报告：${typeof cmdWhere === 'function' ? cmdWhere(a.x, a.y) : gridRef(a.x, a.y)}发现敌直升机机降，判断为美军第 101 空降师空中突击分队，正向${p.name}运动。`, { kind: 'report', at: { x: a.x, y: a.y }, key: 'a101s', gap: 60, lv: 0 });
  }
}
// 被击落（eaLost 调用）：机上的班随之损失
function a101Down(a) {
  const E1 = a101Ensure(), L = E1.lift && E1.lift.id === a.lift ? E1.lift : null, n = a.men ? a.men.length : 0;
  if (!n) return;
  a.men = null;
  if (L) { L.lost += n; L.down = (L.down || 0) + 1; }
  if (typeof v8Stat === 'function') v8Stat('a101Lost', n);
  log(`敌黑鹰直升机被击落，机上 ${n} 名空降兵全部损失`, 'good', null, 0, { x: a.x, y: a.y });
}
// 每秒：一批结束（全部落地后返航 / 被击落）就清掉并报告；然后 AI 决策下一批
function a101Step(dt) {
  if (!S || S.phase !== 'battle' || S.over || !(typeof eaOn === 'function' && eaOn())) return;
  const E1 = a101Ensure();
  if ((E1.thT = (E1.thT ?? 1) - dt) > 0) return;
  E1.thT = 1;
  const L = E1.lift;
  if (L && S.t - L.t > 3 && !(S.eair && S.eair.fly.some(a => a.type === 'uh60' && a.lift === L.id && !a.dead))) {
    E1.lift = null; E1.done++;
    const u = L.u != null ? UNIT_MAP.get(L.u) : null;
    if (u && typeof a4Adopt === 'function') a4Adopt(u, L.key);   // 整连交给守方协同：开到据点后方待机，或加入反冲击
    if (typeof chatSay === 'function') chatSay('e', `报告：第 101 空降师机降${L.land ? `完成，${L.land} 个班落地` : '失败'}${L.lost ? `，${L.lost} 人随直升机损失` : ''}。`, { kind: 'report', lv: 1 });
  }
  a101Think();
}

HOOK.step.push(a101Step);
HOOK.newGame.push(() => { if (S) S.e101 = null; });
