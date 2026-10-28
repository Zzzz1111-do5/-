'use strict';
// 海战（v14，闯关第一章「夺取制海权」，沙盒也能用）：守方美军水面舰艇编队。
// 舰型（按公开资料估计、按本游戏比例缩放）：
//   DDG-51 阿利·伯克级 Flight IIA / Flight III（SPY-1D / SPY-6 雷达、标准-2 / 标准-6 远程舰空导弹、ESSM 改进型海麻雀、密集阵近防炮、鱼叉反舰导弹、Mk45 127 毫米舰炮）、
//   CG-47 提康德罗加级巡洋舰（垂发单元最多）、FFG-62 星座级护卫舰（NSM 海军打击导弹、ESSM、57 毫米炮、拉姆近防导弹）、LCS 独立级濒海战斗舰（NSM、拉姆，快但脆）。
// 守方：在本方海岸防空伞下巡逻；雷达发现我方舰艇后逼近到反舰导弹射程齐射（优先航母、驱逐舰、满载登陆舰），舰空导弹打我方飞机；受重创撤向岸边。
// 防御：我方来袭导弹先遭标准-2 / 标准-6 拦截，再遭 ESSM，最后近防炮 / 拉姆——高超音速的鹰击-21 几乎拦不住，鹰击-18A 末段超音速冲刺难拦，亚音速的最好拦。
// 进攻方：驱逐舰垂发鹰击-18A / 鹰击-21（vls.js 目标解算认得敌舰）、歼-35 挂鹰击-83K、轰-6K 挂鹰击-12 防区外发射（carrier.js flyPlane 读 p.asm）。
// 状态：S.eships = [{id, cls, nm, x, y, heading, spd, hp, maxhp, gx, gy, sam, essm, ciws, asm, …, det 最近被我方发现的时刻, dead, sinkT}]
const NV_CLS = {
  ddg: { nm: 'DDG-51 阿利·伯克级驱逐舰（Flight IIA）', hp: 50, L: 46, B: 9, spd: 30, radar: 760, sam: 40, samR: 620, essm: 24, ciws: 2, asm: 8, asmK: '鱼叉', asmR: 1100, gunR: 480, ton: 9.2 },
  ddg3: { nm: 'DDG-125 阿利·伯克级驱逐舰（Flight III）', hp: 54, L: 47, B: 9, spd: 30, radar: 900, sam: 48, samR: 700, essm: 32, ciws: 2, asm: 8, asmK: '鱼叉', asmR: 1100, gunR: 480, ton: 9.7 },
  cg: { nm: 'CG-47 提康德罗加级巡洋舰', hp: 62, L: 52, B: 10, spd: 28, radar: 760, sam: 60, samR: 650, essm: 32, ciws: 2, asm: 8, asmK: '鱼叉', asmR: 1100, gunR: 480, ton: 9.8 },
  ffg: { nm: 'FFG-62 星座级护卫舰', hp: 34, L: 40, B: 8, spd: 28, radar: 640, sam: 24, samR: 560, essm: 16, ciws: 1, ram: 1, asm: 16, asmK: 'NSM', asmR: 1300, gunR: 380, ton: 7.3 },
  lcs: { nm: 'LCS 独立级濒海战斗舰', hp: 24, L: 38, B: 12, spd: 40, radar: 480, sam: 0, samR: 0, essm: 0, ciws: 1, ram: 1, asm: 8, asmK: 'NSM', asmR: 1300, gunR: 360, ton: 3.1 }
};
// 我方各型导弹对敌舰的毁伤（击中一发扣的耐久）
const NV_DMG = { yj18: 26, yj21: 34, yj12: 28, yj83k: 16, cj10: 14, kd88: 12, ls6: 22, ba7: 6, hj10: 4 };
const nvStat = (k, n = 1) => { if (typeof v8Stat === 'function') v8Stat(k, n); };
const nvOn = () => !!(S && S.eships && S.eships.length);
const navyById = id => (S.eships || []).find(e => e.id === id) || null;
const nvAlive = () => (S.eships || []).filter(e => !e.dead);
const nvKnown = e => !e.dead && S.t - (e.det ?? -99) < 4;   // AI 只打真正发现了的（观战时画面全显，但指挥官不作弊）
function navyAdd(cls, x, y, nm) {
  const C = NV_CLS[cls] || NV_CLS.ddg;
  const e = { id: S.nid++, cls, nm: nm || C.nm, x, y, gx: x, gy: y, heading: -Math.PI / 2, spd: 0, hp: C.hp, maxhp: C.hp, sam: C.sam, essm: C.essm, asm: C.asm,
    asmT: 0, samCd: 0, gunT: 0, det: -99, dead: false, sinkT: null, st: 'patrol', odir: Math.random() < .5 ? 1 : -1, kx: null, ky: null };
  (S.eships || (S.eships = [])).push(e);
  return e;
}
// 守方看得见的我方舰艇（任一敌舰雷达范围内，或岸上视野里）
function nvTargets() {
  const out = [], seen = (x, y) => nvAlive().some(e => dist(e.x, e.y, x, y) < NV_CLS[e.cls].radar * (e.hp < e.maxhp * .5 ? .75 : 1)) || spotted(x, y);
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && seen(S.dd.x, S.dd.y)) out.push({ k: 'dd', id: 'DD', x: S.dd.x, y: S.dd.y, v: 8, nm: S.dd.name || '驱逐舰' });
  if (typeof cvAll === 'function') cvAll().forEach((c, h) => { if (c.hp > 0 && seen(c.x, c.y)) out.push({ k: 'cv', id: cvHome(c) || h, x: c.x, y: c.y, v: 10, nm: c.name || '航母' }); });
  for (const s of S.ships) if (alive(s) && !isLand(s.x, s.y) && s.state !== 'beached' && seen(s.x, s.y)) {
    const L = s.load || {}, v = s.kind === 'dd' ? 7 : (L.veh && L.veh.length) ? 7 : L.teams > 0 ? 6 : s.kind === 'supply' ? 5 : 3;
    out.push({ k: 'ship', id: s.id, x: s.x, y: s.y, v, nm: s.label || '舰船' });
  }
  return out;
}
// —— 每步 ——
function navyStep(dt) {
  if (!nvOn() || S.phase !== 'battle' || S.over) return;
  const N = S.navy || (S.navy = { thT: 0, pT: 0, said: {}, sunkTon: 0 });
  for (const e of S.eships) {
    if (e.dead) continue;
    nvMove(e, dt);
    // 我方发现：驱逐舰 / 护航舰雷达 720、航母 600、空警-600 900、视野
    const sees = (x, y, r) => dist(x, y, e.x, e.y) < r;
    let det = inVision(e.x, e.y);
    if (!det && S.dd && S.dd.state !== 'sunk' && sees(S.dd.x, S.dd.y, 720)) det = true;
    if (!det) for (const s of S.ships) if (s.kind === 'dd' && alive(s) && sees(s.x, s.y, 720)) { det = true; break; }
    if (!det && typeof cvAll === 'function') det = cvAll().some(c => c.hp > 0 && sees(c.x, c.y, 600));
    if (!det) det = (S.planes || []).some(p => !p.dead && p.alt > .3 && (p.kind === 'recon' ? sees(p.x, p.y, (p.v || 'kj600') === 'kj600' ? 900 : 420) : sees(p.x, p.y, p.kind === 'fighter' ? (p.radar || 520) : 260)));
    if (det) { if (e.det < S.t - 30 && !N.said['d' + e.id]) { N.said['d' + e.id] = 1; log(`发现敌${e.nm}`, 'warn', null, 0, e); } e.det = S.t; e.kx = e.x; e.ky = e.y; }
  }
  if ((N.thT -= dt) <= 0) { N.thT = 1; for (const e of S.eships) if (!e.dead) nvThink(e); }
  if ((N.pT -= dt) <= 0) { N.pT = 2; nvThinkP(N); }
  nvEnd(dt);
}
// 航行：巡逻（绕守备点）/ 接敌（保持在反舰导弹射程的八成）/ 撤退（回岸边防空伞下）；只走深水，舰间保持 60
function nvMove(e, dt) {
  const C = NV_CLS[e.cls], vmax = C.spd * (e.hp < e.maxhp * .4 ? .55 : 1);
  let tx = e.gx, ty = e.gy, v = vmax * .4;
  if (e.st === 'patrol') { const a = Math.atan2(e.y - e.gy, e.x - e.gx) + .5 * e.odir; tx = e.gx + Math.cos(a) * 90; ty = e.gy + Math.sin(a) * 60; }
  else if (e.st === 'engage' && e.tg) { const d = dist(e.x, e.y, e.tg.x, e.tg.y), want = C.asmR * .78; const a = Math.atan2(e.y - e.tg.y, e.x - e.tg.x); tx = e.tg.x + Math.cos(a) * want; ty = e.tg.y + Math.sin(a) * want; v = Math.abs(d - want) > 60 ? vmax : vmax * .4; }
  else if (e.st === 'retreat') { tx = e.gx; ty = Math.max(coastAt(e.gx) + 70, e.gy - 120); v = vmax; }
  for (const o of S.eships) if (o !== e && !o.dead) { const d = dist(o.x, o.y, e.x, e.y); if (d < 60 && d > 0) { tx += (e.x - o.x) / d * 40; ty += (e.y - o.y) / d * 40; } }
  ty = Math.min(ty, STAGING_Y + 120);
  const want = Math.atan2(ty - e.y, tx - e.x), da = Math.atan2(Math.sin(want - e.heading), Math.cos(want - e.heading));
  e.heading += clamp(da, -.5 * dt, .5 * dt);
  e.spd += clamp((dist(e.x, e.y, tx, ty) < 20 ? 0 : v) - e.spd, -8 * dt, 6 * dt);
  const nx = e.x + Math.cos(e.heading) * e.spd * dt, ny = e.y + Math.sin(e.heading) * e.spd * dt;
  if (typeAt(nx, ny) === T.DEEP && nx > 20 && nx < W - 20 && ny > 20 && ny < H - 20) { e.x = nx; e.y = ny; } else { e.heading += .9 * dt * e.odir; e.spd *= .9; }
}
function nvThink(e) {
  const C = NV_CLS[e.cls], tg = nvTargets();
  // 选目标：价值高、近的优先；超出反舰射程 1.6 倍的不追
  let best = null, bs = -Infinity;
  for (const t of tg) { const d = dist(e.x, e.y, t.x, t.y); if (d > C.asmR * 1.6) continue; const s = t.v * 2 - d / 200; if (s > bs) { bs = s; best = t; } }
  e.tg = best;
  e.st = e.hp < e.maxhp * .35 ? 'retreat' : best ? 'engage' : 'patrol';
  // 反舰导弹齐射：射程内、来袭中的不超过 4 枚；同舰 25 秒一轮
  if (best && e.asm > 0 && S.t >= e.asmT && dist(e.x, e.y, best.x, best.y) < C.asmR) {
    const inb = S.missiles.filter(m => m.kind === 'asm' && m.side === 'e' && !m.done && m.tgt && m.tgt.k === best.k && m.tgt.id === best.id).length;
    const n = Math.min(e.asm, 4 - inb, e.cls === 'lcs' ? 2 : 4);
    if (n > 0) {
      for (let i = 0; i < n; i++) msLaunch('asm', 'e', e.x + gauss() * 4, e.y + gauss() * 4, { x: best.x, y: best.y }, { tgt: { k: best.k, id: best.id }, delay: i * .6, src: 'eship', spd: C.asmK === 'NSM' ? 270 : 250 });
      e.asm -= n; e.asmT = S.t + 25; e.det = S.t; e.kx = e.x; e.ky = e.y;   // 发射即暴露
      nvStat('nvAsmE', n);
      const sec = Math.round(dist(e.x, e.y, best.x, best.y) / 260);
      log(`导弹预警：敌${e.nm}发射 ${n} 枚${C.asmK}反舰导弹，目标${best.nm}，约 ${sec} 秒到达`, 'bad', 'nvasm', 3, best);
      if (typeof chatSay === 'function') chatSay('e', `命令：${e.nm}对${best.nm}齐射 ${n} 枚${C.asmK}，打完立即机动规避。`, { kind: 'order', at: best, key: 'nvasm' + e.id, gap: 20, lv: 1 });
    }
  }
  // 舰空导弹打我方飞机：隐身机要飞进锁定距离（雷达 × 隐身系数 × 1.6）
  if (e.sam > 0 && S.t >= e.samCd) {
    let p0 = null, pd = Infinity;
    for (const p of S.planes || []) {
      if (p.dead || p.alt < .2 || ['cat', 'roll', 'trap', 'final'].includes(p.phase)) continue;
      const st = typeof airStealth === 'function' ? airStealth(p) : 1, d = dist(e.x, e.y, p.x, p.y);
      if (d > Math.min(C.samR, C.radar * Math.min(1, st * 1.6))) continue;
      if (S.missiles.some(m => m.src === 'eship' && m.kind === 'sam' && !m.done && m.tgt && m.tgt.k === 'plane' && m.tgt.id === p.id)) continue;
      if (d < pd) { pd = d; p0 = p; }
    }
    if (p0) { msLaunch('sam', 'e', e.x, e.y, { x: p0.x, y: p0.y }, { tgt: { k: 'plane', id: p0.id }, src: 'eship', spd: 620, dur: 2.6, pk: .5 }); e.sam--; e.samCd = S.t + 2; nvStat('nvSamE'); }
  }
  // 舰炮：480 内的我方舰船，每 3 秒一次齐射，三成五命中
  if (S.t >= e.gunT) for (const t of tg) {
    if (dist(e.x, e.y, t.x, t.y) > C.gunR) continue;
    e.gunT = S.t + 3;
    if (typeof tracer === 'function') for (let i = 0; i < 2; i++) tracer(e.x, e.y, t.x + gauss() * 10, t.y + gauss() * 10, 'e', true);
    if (Math.random() < .35) {
      S.fx.push({ kind: 'flash', x: t.x, y: t.y, r: 12, life: 0, max: .6, side: 'e' });
      if (t.k === 'ship') { const s = S.ships.find(o => o.id === t.id); if (s) damageShip(s, 3); }
      else if (t.k === 'dd' && Math.random() < .3) damageDD({ kind: 'coastal', x: e.x, y: e.y });
      else if (t.k === 'cv' && typeof cvImpact === 'function') cvImpact(t.x, t.y, { men: 0, ship: 2, struct: 0, R: 12 });
    }
    break;
  }
}
// —— 来袭导弹的分层拦截（missile.js msPgmFly 对我方导弹每步调用）：返回 true 表示本步已被拦截 ——
function navyDefend(m) {
  if (!nvOn() || m.side !== 'p') return false;
  const T = m.tgt && m.tgt.k === 'eship' ? navyById(m.tgt.id) : null;
  if (!T && !nvAlive().some(e => dist(e.x, e.y, m.x, m.y) < 700)) return false;
  const W0 = MS_PGM[m.w] || {}, dT = dist(m.x, m.y, m.tx, m.ty), hyp = m.w === 'yj21', fast = hyp || (W0.sprint && dT < W0.sr) || (W0.spd || 0) >= 500;
  const k = hyp ? .12 : fast ? .55 : 1, cover = e => !T || T === e || dist(T.x, T.y, e.x, e.y) < 450;
  // 外层：标准-2 / 标准-6——「射击—射击」：远界一枚，近一些再补一枚；拦截弹飞行时间按相遇点估（来袭弹也在飞近）
  const vin = (W0.sprint && dT < W0.sr ? W0.sprint : W0.spd) || 200, fly = d => clamp(d / (900 + vin), .25, 1.4);
  if ((m.nvS || 0) < 2) for (const e of nvAlive()) {
    const d = dist(m.x, m.y, e.x, e.y), C = NV_CLS[e.cls];
    if (!(e.sam > 0) || d > C.samR * (m.nvS ? .7 : 1) || d < 160 || !cover(e) || (m.nvSt && S.t - m.nvSt < .8)) continue;
    m.nvS = (m.nvS || 0) + 1; m.nvSt = S.t; e.sam--;
    msLaunch('sam', 'e', e.x, e.y, { x: m.x, y: m.y }, { tgt: { k: 'msl', id: m.id }, src: 'eship', spd: 900, dur: fly(d), pk: .55 * k });
    nvStat('nvAbm');
    break;
  }
  // 中层：ESSM（300 以内）
  if (!m.nvE) for (const e of nvAlive()) {
    const d = dist(m.x, m.y, e.x, e.y);
    if (!(e.essm > 0) || d > 300 || d < 70 || !cover(e)) continue;
    m.nvE = true; e.essm--;
    msLaunch('sam', 'e', e.x, e.y, { x: m.x, y: m.y }, { tgt: { k: 'msl', id: m.id }, src: 'eship', spd: 800, dur: fly(d) * .8, pk: .6 * k });
    nvStat('nvEssm');
    break;
  }
  // 内层：密集阵 / 拉姆（90 以内，一次判定，0.4 秒点射）
  if (m.nvC) {
    if (S.t < m.nvC.until) { const e = navyById(m.nvC.id); if (e && typeof tracer === 'function') tracer(e.x, e.y, m.x + gauss() * 4, m.y + gauss() * 4, 'e', true); return false; }
    const ok = m.nvC.ok; m.nvC = null;
    if (ok) { m.done = m.icp = true; if (typeof msPuff === 'function') msPuff(m.x, m.y, 'e', true); nvStat('nvCiws'); log('我方反舰导弹被敌舰近防武器拦截', 'bad', 'nvicp', 3, { x: m.x, y: m.y }); return true; }
    m.nvCd = true;
  }
  if (!m.nvC && !m.nvCd) for (const e of nvAlive()) {
    if (dist(m.x, m.y, e.x, e.y) > 90 || !cover(e)) continue;
    const C = NV_CLS[e.cls];
    m.nvC = { until: S.t + .4, ok: Math.random() < (C.ram ? .45 : .4) * k * (C.ciws > 1 ? 1.15 : 1), id: e.id };
    break;
  }
  return false;
}
// 敌舰中弹（missile.js 报来）
function navyHit(e, m) {
  if (!e || e.dead) return;
  const dmg = NV_DMG[m.w] || 10, C = NV_CLS[e.cls];
  e.hp -= dmg; e.det = S.t; e.hitT = S.t;
  S.fx.push({ kind: 'boom', x: e.x, y: e.y, r: 26, life: 0, max: 1.2, side: 'p' });
  nvStat('nvHit');
  if (e.hp > 0) { if (e.hp < e.maxhp * .5) { e.sam = Math.floor(e.sam * .6); e.essm = Math.floor(e.essm * .6); } log(`敌${e.nm}中弹（剩余耐久 ${Math.round(e.hp / e.maxhp * 100)}%）`, 'good', 'nvhit' + e.id, 2, e); return; }
  e.dead = true; e.sinkT = S.t; e.spd = 0;
  const N = S.navy || (S.navy = { thT: 0, pT: 0, said: {}, sunkTon: 0 });
  N.sunkTon += C.ton;
  nvStat('nvSunk');
  log(`击沉敌${e.nm}！`, 'good', null, 0, e);
  if (typeof chatSay === 'function') {
    chatSay('p', `报告：击沉敌${e.nm}（约 ${C.ton} 千吨）。`, { kind: 'report', at: e, lv: 0 });
    chatSay('e', `报告：${e.nm}被击沉……各舰收拢编队，向岸边防空伞下靠拢。`, { kind: 'report', at: e, lv: 1, delay: 3 });
  }
}
// —— 进攻方海上作战（我方驱逐舰受 AI 指挥、或观战时）：垂发鹰击-18A / 鹰击-21 打已发现的敌舰；航空兵挂反舰导弹出击 ——
function nvThinkP(N) {
  const known = nvAlive().filter(nvKnown);
  if (!known.length) return;
  const ctl = S.role === 'spectate' || (S.dd && S.dd.auto) || S.ships.some(s => s.kind === 'dd' && alive(s) && s.auto);
  if (ctl && typeof vlsFire === 'function' && S.t >= (N.vlsT || 0)) {
    // 每艘敌舰按耐久需要的命中数 + 预计被拦截的余量分配导弹，在途的不重复打
    const tgt = known.slice().sort((a, b) => (NV_CLS[b.cls].ton - NV_CLS[a.cls].ton) || (a.hp - b.hp))[0];
    const inb = S.missiles.filter(m => m.side === 'p' && !m.done && m.tgt && m.tgt.k === 'eship' && m.tgt.id === tgt.id).length;
    const need = Math.ceil(tgt.hp / 24) + 1 + (NV_CLS[tgt.cls].sam > 30 ? 2 : 1) - inb;
    if (need > 0) {
      const strong = NV_CLS[tgt.cls].sam > 30 && typeof vlsLeft === 'function' && vlsLeft('yj21') > 0;
      const who = typeof vlsWho === 'function' ? vlsWho(strong ? 'yj21' : 'yj18', tgt.x, tgt.y) : '驱逐舰', n = vlsFire(strong ? 'yj21' : 'yj18', tgt.x, tgt.y, Math.min(4, need), 'asuw') || vlsFire(strong ? 'yj18' : 'yj21', tgt.x, tgt.y, Math.min(4, need), 'asuw');
      if (n) {
        N.vlsT = S.t + 6; nvStat('nvVls', n);
        if (typeof chatSay === 'function') chatSay('p', `命令：${who}垂发${strong ? '鹰击-21 高超音速' : '鹰击-18A 超音速'}反舰导弹 ${n} 枚，饱和攻击敌${tgt.nm}。`, { kind: 'order', at: tgt, key: 'nvvls', gap: 12, lv: 1 });
      }
    }
  }
  // 航空兵：歼-35 挂鹰击-83K、轰-6K 挂鹰击-12，打离我方舰队最近的已发现敌舰
  const airOk = S.role === 'spectate' || (S.cv && S.cv.auto);
  if (!airOk || typeof airPkg !== 'function' || S.t < (N.airT || 0)) return;
  const busy = new Set((S.planes || []).filter(p => !p.dead && p.asm).map(p => p.asm.id));
  const tgt = known.filter(e => !busy.has(e.id)).sort((a, b) => a.y - b.y)[0] || known[0];
  for (const [kind, w] of [['bomber', 'yj12'], ['strike', 'yj83k']]) {
    if (!(S.assets[kind] > 0) || !(typeof airReady === 'function' && airReady(kind))) continue;
    const n0 = S.planes.length, L = airPkg(kind, tgt.x, tgt.y);
    if (!L) continue;
    for (const p of S.planes.slice(n0)) if (p.kind === kind) p.asm = { id: tgt.id, w };
    N.airT = S.t + 8; nvStat('nvAir');
    if (typeof chatSay === 'function') chatSay('p', `命令：${kind === 'bomber' ? '轰-6K 挂鹰击-12 超音速反舰导弹' : '歼-35 挂鹰击-83K 反舰导弹'}出击，在敌舰防空导弹射程外发射，打敌${tgt.nm}。`, { kind: 'order', at: tgt, key: 'nvair' + kind, gap: 15, lv: 1 });
    break;
  }
}
// 挂反舰导弹的飞机（carrier.js flyPlane 在出航阶段调用）：跟踪目标，进入射程就发射，投完立即掉头；目标沉了就返航。返回 true 表示本步已处理
function navyPlaneAsm(p, dt, speed) {
  const E = navyById(p.asm.id);
  if (!E || E.dead) { const n = nvAlive().filter(nvKnown).sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y))[0]; if (n) { p.asm.id = n.id; return true; } p.asm = null; airSet(p, 'rtb'); return true; }
  if (nvKnown(E)) { p.tx = E.x; p.ty = E.y; }
  const R = p.asm.w === 'yj12' ? 700 : 480, d = dist(p.x, p.y, p.tx, p.ty);
  speed(airSpec(p.kind, p.v).spd);
  airSteer(p, p.tx, p.ty, dt);
  if (d > R) return true;
  const n = p.kind === 'bomber' ? 2 : 2;
  for (let i = 0; i < n; i++) msPgm(p.asm.w, 'p', p.x, p.y, { k: 'eship', id: E.id, x: E.x, y: E.y }, 'air', i * .5);
  nvStat('nvAirAsm', n);
  log(`${airName(p.kind, p.v).split(' ')[0]}在 ${Math.round(d)} 米外发射 ${n} 枚${MS_PGM[p.asm.w].nm}，攻击敌${E.nm}`, 'info', 'nvaf' + p.id, 3, E);
  p.asm = null; p.dropped = true; p.std = true; p.egT = 3;
  return false;
}
// 胜负（闯关海战关）：击沉守方舰艇八成吨位胜；我方驱逐舰、护航舰、航母全损或 15 分钟未达成则败
function nvEnd(dt) {
  if (!(S.lv && S.lv.kind === 'naval') || S.over) return;
  const tot = S.eships.reduce((a, e) => a + NV_CLS[e.cls].ton, 0), sunk = S.eships.filter(e => e.dead).reduce((a, e) => a + NV_CLS[e.cls].ton, 0);
  if (tot > 0 && sunk / tot >= .8) { S.over = 'win'; log(`击沉敌舰 ${Math.round(sunk / tot * 100)}% 吨位，夺取制海权，作战胜利`, 'good'); return; }
  const ours = (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && S.dd.x > -999 ? 1 : 0) + S.ships.filter(s => s.kind === 'dd' && alive(s)).length + (typeof cvAll === 'function' ? cvAll().filter(c => c.hp > 0).length : 0);
  if (!ours) { S.over = 'lose'; log('我方作战舰艇全部损失，海战失利', 'bad'); return; }
  if (S.t >= 900) { S.over = 'lose'; log('15 分钟内未能夺取制海权，海战失利', 'bad'); }
}
HOOK.step.push(navyStep);
HOOK.newGame.push(() => { if (S) { S.eships = []; S.navy = null; } });
HOOK.visionE.push(() => S && S.eships ? nvAlive().map(e => ({ x: e.x, y: e.y, r: 260, h: 1.2 })) : []);

// —— 绘制：船体（尖艏）、上层建筑、垂发区、舰炮；航迹；耐久；沉没下沉 ——
function navyDraw(time) {
  if (!S || !S.eships || !S.eships.length || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, spec = specAll(), k = typeof shipK === 'function' ? shipK() : 1;
  for (const e of S.eships) {
    const known = spec || S.t - (e.det ?? -99) < 4, ghost = !known && e.kx != null && !e.dead;
    if (!known && !ghost && !(e.dead && S.t - e.sinkT < 12 && e.kx != null)) continue;
    const C = NV_CLS[e.cls], x = ghost ? e.kx : e.x, y = ghost ? e.ky : e.y, L = C.L * k, B = C.B * k;
    const sink = e.dead ? clamp((S.t - e.sinkT) / 10, 0, 1) : 0;
    ctx.save(); ctx.translate(x, y); ctx.rotate(e.heading);
    ctx.globalAlpha = ghost ? .35 : 1 - sink * .85;
    if (!e.dead && !ghost && e.spd > 4) { ctx.strokeStyle = realLook() ? 'rgba(238,243,242,.35)' : rgba(COL.enemy, .25); ctx.lineWidth = px(1.2); ctx.beginPath(); ctx.moveTo(-L / 2, -B / 3); ctx.lineTo(-L / 2 - e.spd * 1.6, -B * 1.2); ctx.moveTo(-L / 2, B / 3); ctx.lineTo(-L / 2 - e.spd * 1.6, B * 1.2); ctx.stroke(); }
    if (R.m3d && known && !e.dead) { ctx.restore(); continue; }   // 3D：舰体是立体模型（v3units.js），贴图里只留尾浪
    const real = realLook() && !ghost;   // 写实：美国海军灰舰体、深色甲板设备、细红边
    ctx.fillStyle = real ? rlLit(ctx, e.heading, L, B, lkPaint('#7f878d', 'e')) : rgba(COL.enemy, .22); ctx.strokeStyle = COL.enemy; ctx.lineWidth = px(real ? 1 : 1.3);
    ctx.beginPath(); ctx.moveTo(L / 2, 0); ctx.lineTo(L * .22, -B / 2); ctx.lineTo(-L / 2, -B / 2 * .9); ctx.lineTo(-L / 2, B / 2 * .9); ctx.lineTo(L * .22, B / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (real) { ctx.strokeStyle = 'rgba(28,32,34,.85)'; ctx.fillStyle = lkPaint('#9aa2a7', 'e'); } else ctx.fillStyle = rgba(COL.enemy, .55);
    ctx.fillRect(-L * .08, -B * .3, L * .2, B * .6);   // 舰桥 / 相控阵雷达
    ctx.strokeRect(L * .18, -B * .22, L * .12, B * .44);   // 前垂发
    if (e.cls !== 'lcs') ctx.strokeRect(-L * .34, -B * .22, L * .12, B * .44);   // 后垂发
    ctx.beginPath(); ctx.arc(L * .36, 0, B * .14, 0, 7); ctx.fill(); ctx.beginPath(); ctx.moveTo(L * .36, 0); ctx.lineTo(L * .48, 0); ctx.stroke();   // 舰炮
    ctx.restore();
    if (!e.dead && !ghost) {   // 耐久条
      const w = Math.max(16, L * .8), f = clamp(e.hp / e.maxhp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - w / 2, y - B * 1.6 - 4, w, 3);
      ctx.fillStyle = f > .5 ? COL.enemy : COL.amber; ctx.fillRect(x - w / 2, y - B * 1.6 - 4, w * f, 3);
    }
    if (e.dead && sink < 1 && Math.random() < .3) S.fx.push({ kind: 'flash', x: x + gauss() * 6, y: y + gauss() * 4, r: 6, life: 0, max: .5, side: 'e' });
  }
}
HOOK.drawOver.push(navyDraw);
