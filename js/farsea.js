'use strict';
// 远海（用户：把海扩张很多倍，让攻守双方有 50 海里距离；仿照《海权》这类导弹时代的海战）——
//   地面战场的格子不动（格子地图往南再加 90 公里，每格一百来字节的各种数组要上亿字节，浏览器扛不住）：开战时把我方整个海上编队
//   （登陆舰船、驱护舰、航母、在水里的两栖车辆）往南挪到离守方海岸 50 海里（92.6 公里）的海面上，编队一起航渡回原来的集结海域——
//   航渡途中各舰自己的航行、指挥官下给它们的命令先放着（fsT），到了再接着执行；地图外的海面没有礁石，3D 里是无边海面。
//   航渡就是远程海空战：我方驱逐舰对海雷达 25 公里、空警-600 300 公里看得见敌舰（navy.js），敌舰的雷达、反舰导弹、舰空导弹、舰炮换成真实距离（FS_NV），
//   低空掠海的导弹要进了雷达地平线（约 28 公里）才拦得到，巡逻机的海情能给敌舰指示视距外的目标。
//   时间压缩可以开到 8 倍、16 倍（同类游戏的做法），有敌方导弹来袭、航渡结束时自动降回 4 倍
const FS = { nm: 50, d: 92600, v: 26, slow: 4, hz: 28000 };
// 敌舰真实距离（米）：radar 对海（雷达地平线：桅顶天线约 25 米、对方舰桅约 20 米）、samR 标准-2 / 标准-6、asmR 鱼叉约 124 公里 / NSM 约 185 公里、gunR Mk45 常规弹约 24 公里（57 毫米约 14 公里）
const FS_NV = { ddg: { radar: 38000, samR: 150000, asmR: 124000, gunR: 24000 }, ddg3: { radar: 42000, samR: 240000, asmR: 124000, gunR: 24000 }, cg: { radar: 38000, samR: 150000, asmR: 124000, gunR: 24000 },
  ffg: { radar: 34000, samR: 150000, asmR: 185000, gunR: 14000 }, lcs: { radar: 28000, samR: 0, asmR: 185000, gunR: 8000 } };
const FS_NV0 = {}, FS_PG0 = {};
const fsOn = () => !!(S && S.fs);
const fsMoving = () => !!(S && S.fs && S.fs.left > 0);
// 这张图能不能开远海：南边是海（同 afp.js 战区机场的判断），闯关、海岛战役（各有自己的海域设计）、白色平原不开；设置里能关
function fsWant() {
  if (!S || S.lv || !TER || TER.flat || !TER.type || (typeof SETTINGS === 'object' && SETTINGS.farsea === false)) return false;
  let w = 0;
  for (let x = 0; x < GW; x++) if (isWater(TER.type[(GH - 1) * GW + x])) w++;
  return w >= GW * .95;
}
// 我方海上编队
function fsUnits() {
  const out = [];
  for (const s of S.ships || []) if (alive(s) && s.state !== 'beached' && s.state !== 'unloading' && !isLand(s.x, s.y)) out.push(s);
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && S.dd.x > -999) out.push(S.dd);
  if (typeof cvAll === 'function') for (const c of cvAll()) if (c.hp > 0) out.push(c);
  for (const v of S.veh || []) if (!v.dead && v.side === 'p' && !v.lst && (v.swim || !isLand(v.x, v.y))) out.push(v);
  return out;
}
// 换上 / 还原真实距离
function fsRanges(on) {
  if (typeof NV_CLS === 'object') for (const k in FS_NV) { const C = NV_CLS[k]; if (!C) continue; if (!FS_NV0[k]) FS_NV0[k] = { radar: C.radar, samR: C.samR, asmR: C.asmR, gunR: C.gunR }; Object.assign(C, on ? FS_NV[k] : FS_NV0[k]); }
  if (typeof MS_PGM === 'object' && MS_PGM.yj18) { if (!('yj18' in FS_PG0)) FS_PG0.yj18 = MS_PGM.yj18.sr; MS_PGM.yj18.sr = on ? 40000 : FS_PG0.yj18; }   // 鹰击-18A 末段约 40 公里超音速冲刺
}
function fsStart() {
  const U = fsUnits();
  if (!U.length) return;
  let sx = 0, sy = 0;
  for (const o of U) { sx += o.x; sy += o.y; }
  const cx = sx / U.length, cy = sy / U.length;
  let yc = 0, n = 0;
  for (let x = cx - 3000; x <= cx + 3000; x += 250) { yc += coastAt(clamp(x, 0, W)); n++; }
  const D = Math.round(yc / n + FS.d - cy);
  if (D < 2000) return;
  let ym = -1e9;
  for (const o of U) { o.y += D; o.fsT = 1; if (o.heading != null) o.heading = -Math.PI / 2; ym = Math.max(ym, o.y); if (o.wf != null) o.wf = -Math.PI / 2; }
  S.fs = { D, left: D, t0: S.t, s: Math.round(ym - H + 8000) };
  fsRanges(true);
  log(`我方编队在离敌方海岸 ${FS.nm} 海里（约 ${Math.round(FS.d / 1000)} 公里）的海上，向集结海域航渡（约 ${Math.round(D / FS.v / 60)} 分钟），右上角快进可开到 16 倍`, 'warn');
  if (typeof V3 === 'object' && V3.gl && typeof v3FcInit === 'function') {   // 3D 镜头挪到编队上空，往北看
    const F = V3.fc || (v3FcInit(), V3.fc);
    if (F) { F.x = cx; F.y = cy + D + 2600; F.z = 900; F.yaw = F.yawT = -Math.PI / 2; F.pitch = F.pitchT = -.22; V3.tz = null; V3.tin = null; }
  }
}
// 每步：编队一起往北航渡；到了解冻，各舰接着执行自己的命令
function fsStep(dt) {
  if (!S || S.phase !== 'battle') return;
  const F = S.fs;
  if (!F) return;
  if (F.left > 0) {
    const dy = Math.min(F.left, FS.v * dt);
    F.left -= dy;
    for (const o of fsUnits()) if (o.fsT) o.y -= dy;
    if (F.left <= 0) {
      for (const o of fsUnits()) delete o.fsT;
      for (const v of S.veh || []) delete v.fsT;
      for (const s of S.ships || []) delete s.fsT;
      if (S.speed > FS.slow) S.speed = FS.slow;
      log('编队抵达集结海域，登陆舰船按命令向滩头展开', 'warn');
    }
  }
  // 时间压缩自动降档：敌方反舰导弹在飞（同类游戏有新威胁就停快进）
  if (S.speed > FS.slow && S.missiles && S.missiles.some(m => m.side === 'e' && !m.done && m.t >= 0 && (m.kind === 'asm' || (m.tgt && ['ship', 'dd', 'cv'].includes(m.tgt.k))))) {
    S.speed = FS.slow;
    log(`敌方导弹来袭，时间压缩降到 ${FS.slow} 倍`, 'bad', 'fsslow', 20);
  }
}
HOOK.step.push(fsStep);
HOOK.newGame.push(() => fsRanges(false));   // 新开一局先还原（开战时再按地图决定）
// 快进档位：航渡中能开 8、16 倍
function fsNextSpeed(sp) {
  const L = fsMoving() ? [1, 2, 4, 8, 16] : [1, 2, 4], i = L.indexOf(sp);
  return L[(i + 1) % L.length] || 1;
}
// 镜头、驾驶能到的南边范围（编队最远处再往外 8 公里）
const fsSouth = () => S && S.fs ? S.fs.s : 0;
// —— 接到别的模块上 ——
if (typeof startBattle === 'function') {
  const f0 = startBattle;
  startBattle = function () { const was = S && S.phase; const r = f0.apply(this, arguments); if (was === 'deploy' && S.phase === 'battle' && !S.fs && fsWant()) fsStart(); return r; };
}
// 航渡中的舰船、驱逐舰、航母、两栖车辆：自己的航行先放着（编队整体由 fsStep 挪）
if (typeof updateShips === 'function') {
  const u0 = updateShips;
  updateShips = function (dt) {
    if (!fsMoving()) return u0.apply(this, arguments);
    const all = S.ships;
    S.ships = all.filter(s => !s.fsT);
    try { return u0.apply(this, arguments); } finally { S.ships = all; }
  };
}
if (typeof updateDD === 'function') { const d0 = updateDD; updateDD = function () { if (S.dd && S.dd.fsT) return; return d0.apply(this, arguments); }; }
if (typeof cvMove === 'function') { const c0 = cvMove; cvMove = function (c) { if (c && c.fsT) return; return c0.apply(this, arguments); }; }
if (typeof vehTick === 'function') { const t0 = vehTick; vehTick = function (v) { if (v && v.fsT) return; return t0.apply(this, arguments); }; }
// 跳过航渡（推演一步要几毫秒，16 倍快进在一般电脑上跑不满；不想等的直接到集结海域）：编队一下挪到终点、解冻
function fsSkip() {
  const F = S && S.fs;
  if (!F || !(F.left > 0)) return;
  const dy = F.left;
  for (const o of fsUnits()) if (o.fsT) o.y -= dy;
  F.left = 1e-6;   // 下一步 fsStep 收尾（解冻、降档、报到达）
  log('跳过航渡：编队直接到达集结海域', 'info');
}
// 顶栏「跳过航渡」按钮：只在航渡中显示（挨着快进按钮）
HOOK.frame.push(() => {
  if (typeof document === 'undefined') return;
  let b = document.getElementById('btnFsSkip');
  const on = fsMoving() && S.phase === 'battle';
  if (!b) {
    if (!on) return;
    const sp = document.getElementById('btnSpeed');
    if (!sp) return;
    b = document.createElement('button'); b.className = 'tb'; b.id = 'btnFsSkip'; b.type = 'button'; b.title = '编队离敌方海岸还远，直接到集结海域'; b.textContent = '跳过航渡';
    b.addEventListener('click', () => { fsSkip(); if (typeof updateHud === 'function') updateHud(); });
    sp.after(b);
  }
  if (b.hidden === on) b.hidden = !on;
  if (on) { const t = `跳过航渡（还有 ${Math.round(S.fs.left / 1000)} 公里）`; if (b.textContent !== t) b.textContent = t; }
});
