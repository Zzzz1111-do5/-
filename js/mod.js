'use strict';
// 编辑器的数据（用户：能自己改坦克、飞机、导弹的参数，导弹弹道，飞机挂载，坦克各面装甲、爆反、炮弹穿深，战场大小，渲染距离和画质；
//   导入模型、设开火位置、挂点、尾喷口、尾焰特效；加速度、速度这些也能设）：
//   MOD 存在 localStorage（MOD_KEY），编辑器界面在 modui.js，导入模型 / 预览在 modimp.js；「模组包」可以导出成 JSON 文件、再导入（自己在文本里改参数也行）。
//   套用：表格类的（机型 AIR_MDL、守方飞机 EA_SPEC、能量机动 AP、飞控 FL_AC、机载武器 FW_W、挂载 FW_LOAD、挂点 FW_ST、航炮 FW_GUN、导弹 MS_PGM、飞机 → 模型 V3G_AIR）
//   存盘时直接改进表里（先记下原值，恢复默认时还原）；车辆按型号（models.js rlModelOf 的模型键：ztz99a、m1a2……）在推演里第一次见到这辆车时套上
//   （modVehApply：结构值、各面装甲、穿深、射程、装填、速度、加速度、转向、炮塔转速、视野、爆反）；车辆换模型只改画面（MOD_VMDL，v3g.js v3gVehKey）。
//   模型上的点（MOD.mdl[模型键]：炮口 muz、航炮口 gun、挂点 st、尾喷口 noz、尾焰 fx）按模型记——同一个模型几型飞机共用。
//   导入的文件（模型、序列帧贴图）太大放不进 localStorage：存在 IndexedDB（modFilePut），MOD.lib 只记名字和参数；开机时读出来登记给 v3g.js / v3vfx.js。
//   战场大小只管程序生成的「海岸登陆」地图（state.js newGame）；画面设置在 SETTINGS 里（settings.js）
const MOD_KEY = 'bh-mod', MOD_MM = 220;   // 装甲、穿深：推演里按「级」算（vehicles.js vehPenMul），编辑器里写毫米均质钢，1 级 ≈ 220 毫米
const MOD_SEC = ['veh', 'air', 'eair', 'wpn', 'msl', 'map', 'mdl', 'fx', 'rel', 'trl', 'lib'];   // rel 抛离后几秒点火（airmdl.js AIR_IGN）、trl 导弹尾烟尾焰（v3fx.js v3fTrl）
const MOD = { v: 1 };
for (const k of MOD_SEC) MOD[k] = {};
const MOD_DEF = { air: {}, eair: {}, wpn: {}, msl: {}, load: {}, ap: {}, fl: {}, gun: {}, st: {}, v3air: {} };   // 表里改之前的原值
const MOD_VMDL = {};   // 车辆型号 → 换上的 3D 模型（只管画面；推演里查型号功能表 vfn.js 仍按原来的模型）
const MODX = { db: null, bad: new Set(), ready: false, raw: {}, sig: {}, bsig: {} };   // IndexedDB、读不出来的导入文件；raw 导入模型的原件（{ meta, bin }，拆部件改了以后照它重新解码），sig 解码时用的部件设置
// 各表能改的字段（别的字段不往表里写，免得和表里原有的字段撞名）
const MOD_F = {
  air: ['spd', 'aa', 'stealth', 'radar', 'aamR', 'pkK', 'agmR', 'std', 'turn', 'loiter'],
  eair: ['spd', 'turn', 'hp', 'flares', 'stealth'],
  wpn: ['M', 'R', 'Rmin', 'tb', 'g', 'cone', 'lk', 'pk', 'acc', 'ign'],
  msl: ['spd', 'sprint', 'sr', 'prof', 'z', 'lz', 'pd', 'dmg', 'pen', 'R', 'icp', 'acc', 'v0']
};
// 能量机动（airperf.js AP）与飞控（flight.js FL_AC，亲自驾驶）：编辑器字段 → 表里的字段；两张表同口径，改一处两边一起改
const MOD_APF = { apM: 'm', apT: 'T', apS: 'S', apCD0: 'CD0', apK: 'K', apCL: 'CL', apNz: 'nz' };
const MOD_FLF = { apM: 'm', apT: 'Ta', apS: 'S', apCD0: 'CD0', apK: 'K', apCL: 'CLmax', flTm: 'Tm', flP: 'pmax', flA: 'alim' };
const modStore = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };
function modLoad() {
  const st = modStore();
  if (!st) return;
  try { const o = JSON.parse(st.getItem(MOD_KEY) || 'null'); if (o && o.v === 1) for (const k of MOD_SEC) MOD[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}; } catch (e) { /* 坏了就当没有 */ }
}
function modStoreSave() {
  const st = modStore();
  if (st) try { st.setItem(MOD_KEY, JSON.stringify(MOD)); } catch (e) { console.warn('编辑器存盘失败', e); }
}
function modSave() {
  modStoreSave();
  modApply();
  if (typeof S === 'object' && S && S.veh) for (const v of S.veh) v.modK = 0;   // 正在打的这一局：车辆下一步重新套一遍
}
const modNum = v => typeof v === 'number' && isFinite(v);
const modClone = o => o == null ? o : JSON.parse(JSON.stringify(o));
// 模型键能不能用：内置的都能用；导入的要在库里、读出来了
const modMdlOk = k => typeof k === 'string' && k !== '' && (!k.startsWith('u_') || (MOD.lib[k] && MOD.lib[k].k === 'mdl' && !MODX.bad.has(k)));
// 飞机型号键（carrier.js AIR_MDL）→ 剪影键（V3G_AIR 的键）；守方飞机（eair.js EA_SPEC）用 EA_SIL
const modAirSil = k => { const A = MOD_DEF.air[k] || (typeof AIR_MDL === 'object' && AIR_MDL[k]) || {}; return A.sil || k; };
const modEairSil = t => (typeof EA_SIL === 'object' && EA_SIL[t]) || t;
// 套到表上：先还原原值再套（改了又删掉的字段能回到默认）；F 能改的字段、nest 放进子对象的字段（导弹的爆炸半径在 pw 里）、ren 改名
function modTab(T, D, O, F, nest, ren) {
  if (typeof T !== 'object' || !T) return;
  for (const k in T) {
    if (!D[k]) D[k] = modClone(T[k]);
    const base = modClone(D[k]), o = O[k];
    if (o) for (const f in o) {
      if (F && !F.includes(f)) continue;
      const v = o[f];
      if (v === '' || v == null) continue;
      const g = ren ? ren[f] : f;
      if (g == null) continue;
      if (nest && nest[g]) { base[nest[g]] = { ...(base[nest[g]] || {}), [g]: v }; continue; }
      base[g] = v;
    }
    for (const f of Object.keys(T[k])) delete T[k][f];
    Object.assign(T[k], base);
  }
}
function modApply() {
  if (typeof AIR_MDL === 'object') modTab(AIR_MDL, MOD_DEF.air, MOD.air, MOD_F.air);
  if (typeof EA_SPEC === 'object') modTab(EA_SPEC, MOD_DEF.eair, MOD.eair, MOD_F.eair);
  if (typeof FW_W === 'object') modTab(FW_W, MOD_DEF.wpn, MOD.wpn, MOD_F.wpn);
  if (typeof MS_PGM === 'object') modTab(MS_PGM, MOD_DEF.msl, MOD.msl, MOD_F.msl, { R: 'pw' });
  // 能量机动、飞控：我方按型号键（AP 的键与 AIR_MDL 相同），守方按 EA_SPEC 的键
  const AO = { ...MOD.eair, ...MOD.air };
  if (typeof AP === 'object') modTab(AP, MOD_DEF.ap, AO, Object.keys(MOD_APF), null, MOD_APF);
  if (typeof FL_AC === 'object') {
    const FO = {};   // 飞控表按 FL_KEY 对到型号（歼-35 防空压制型和歼-35 共用一份飞控：只按它自己那一型的改）
    for (const k in MOD.air) if (typeof FL_KEY === 'object' && FL_KEY[k] === k) FO[k] = MOD.air[k];
    modTab(FL_AC, MOD_DEF.fl, FO, Object.keys(MOD_FLF), null, MOD_FLF);
    for (const k in FO) { const o = FO[k], A = FL_AC[k]; if (A && modNum(o.apNz) && Array.isArray(A.nz)) A.nz = [A.nz[0], o.apNz]; if (A && modNum(o.flA)) A.alim = o.flA * Math.PI / 180; if (A && modNum(o.flP)) A.pmax = o.flP * Math.PI / 180; }
  }
  // 飞机 → 3D 模型（V3G_AIR）：挂点、尾喷口、座舱都跟着模型走
  if (typeof V3G_AIR === 'object') {
    for (const k in V3G_AIR) if (!(k in MOD_DEF.v3air)) MOD_DEF.v3air[k] = V3G_AIR[k];
    for (const k in MOD_DEF.v3air) V3G_AIR[k] = MOD_DEF.v3air[k];
    for (const k in MOD.air) if (modMdlOk(MOD.air[k].mdl)) V3G_AIR[modAirSil(k)] = MOD.air[k].mdl;
    for (const t in MOD.eair) if (modMdlOk(MOD.eair[t].mdl)) V3G_AIR[modEairSil(t)] = MOD.eair[t].mdl;
  }
  for (const k in MOD_VMDL) delete MOD_VMDL[k];
  for (const k in MOD.veh) if (modMdlOk(MOD.veh[k].mdl)) MOD_VMDL[k] = MOD.veh[k].mdl;
  // 挂点（fpwpn.js FW_ST，按模型）：编辑器里改过的整组换掉
  if (typeof FW_ST === 'object') {
    for (const mk in MOD.mdl) if (MOD.mdl[mk].st && !(mk in MOD_DEF.st)) MOD_DEF.st[mk] = FW_ST[mk] ? modClone(FW_ST[mk]) : null;
    for (const mk in MOD_DEF.st) { const st = MOD.mdl[mk] && MOD.mdl[mk].st; if (st) FW_ST[mk] = modClone(st); else if (MOD_DEF.st[mk]) FW_ST[mk] = modClone(MOD_DEF.st[mk]); else delete FW_ST[mk]; }
  }
  // 航炮（FW_GUN，按型号）：备弹、射速、初速按型号改；炮口位置按模型（MOD.mdl[模型].gun）
  if (typeof FW_GUN === 'object' && typeof V3G_AIR === 'object') {
    for (const k in FW_GUN) if (!(k in MOD_DEF.gun)) MOD_DEF.gun[k] = modClone(FW_GUN[k]);
    for (const k in MOD.air) if (!(k in MOD_DEF.gun) && (MOD.air[k].gunN > 0)) MOD_DEF.gun[k] = null;
    for (const k in MOD_DEF.gun) {
      const o = MOD.air[k] || {}, D = MOD_DEF.gun[k], mk = V3G_AIR[modAirSil(k)], G = MOD.mdl[mk] && MOD.mdl[mk].gun;
      if (!D && !(o.gunN > 0)) { delete FW_GUN[k]; continue; }
      const g = D ? modClone(D) : { nm: '航炮', n: 150, rpm: 1650, v0: 860, at: [4, -1, 1.5] };
      if (modNum(o.gunN)) g.n = Math.max(0, Math.round(o.gunN));
      if (modNum(o.gunRpm) && o.gunRpm > 0) g.rpm = o.gunRpm;
      if (modNum(o.gunV0) && o.gunV0 > 0) g.v0 = o.gunV0;
      if (Array.isArray(G) && G.length === 3) g.at = G.slice();
      if (g.n > 0) FW_GUN[k] = g; else delete FW_GUN[k];
    }
  }
  // 挂载：[{ w 武器, bay 弹舱 / 外挂, n 枚数 }] → FW_LOAD（驾驶时的武器表、3D 挂架上画的弹）+ 机型表里的计数（AI 出击时带几枚）
  if (typeof FW_LOAD === 'object') {
    for (const k in MOD.air) if (MOD.air[k].load && !(k in MOD_DEF.load)) MOD_DEF.load[k] = FW_LOAD[k] ? modClone(FW_LOAD[k]) : null;
    for (const k in MOD_DEF.load) {
      const L = MOD.air[k] && MOD.air[k].load;
      if (!L) { if (MOD_DEF.load[k]) FW_LOAD[k] = modClone(MOD_DEF.load[k]); else delete FW_LOAD[k]; continue; }
      const rows = L.filter(r => r && FW_W[r.w] && r.n > 0), A = AIR_MDL[k];
      const sr = rows.filter(r => FW_W[r.w].k === 'aam' && FW_W[r.w].sk === 'ir').reduce((a, r) => a + r.n, 0);
      FW_LOAD[k] = rows.map(r => ({ w: r.w, bay: r.bay || 'ext', ...(FW_W[r.w].k === 'aam' && FW_W[r.w].sk === 'ir' ? { sr } : {}) }));
      if (A) {
        const sum = f => rows.filter(f).reduce((a, r) => a + r.n, 0), agm = rows.find(r => FW_W[r.w].k === 'agm'), gb = rows.find(r => FW_W[r.w].k === 'gb' || FW_W[r.w].k === 'arm');
        A.aam = sum(r => FW_W[r.w].k === 'aam' && r.w !== 'pl17'); A.aamL = sum(r => r.w === 'pl17') || undefined;
        A.agmN = sum(r => FW_W[r.w].k === 'agm'); A.gbN = sum(r => FW_W[r.w].k === 'gb' || FW_W[r.w].k === 'arm');
        if (agm) { A.agm = FW_W[agm.w].pg || agm.w; if (!A.agmR) A.agmR = 300; }
        if (gb) { A.arW = FW_W[gb.w].pg || gb.w; if (FW_W[gb.w].k === 'arm') A.sead = true; if (!A.std) A.std = 200; if (!A.arR) A.arR = 260; }
      }
    }
  }
  // 序列帧特效：换掉内置的爆炸、火、炮口焰、烟团（v3vfx.js）
  if (typeof v3vSlots === 'function') { const sl = {}; for (const k in MOD.fx) if (MOD.lib[MOD.fx[k]] && !MODX.bad.has(MOD.fx[k])) sl[k] = MOD.fx[k]; v3vSlots(sl); }
  if (typeof FW_LD === 'object' && FW_LD && typeof FW_LD.clear === 'function') FW_LD.clear();   // 甲板上挂弹的满载清单按机型缓存着（fpwpn.js fwLoadout）：挂载、挂点改了要重算
  for (const id in MODX.raw) if (MODX.sig[id] !== modISig(id)) modRegMdl(id);   // 部件、动画分组改了：导入的模型重新解码
  modBApply();   // 游戏里的模型：删掉的部件、改造（移动 / 旋转 / 缩放 / 换色）、炮塔炮管怎么动
  if (typeof AIR_IGN === 'object') { Object.assign(AIR_IGN, AIR_IGN0); for (const k of ['main', 'side', 'ext']) if (modNum(MOD.rel[k]) && MOD.rel[k] >= 0) AIR_IGN[k] = Math.min(8, MOD.rel[k]); }   // 抛离后几秒点火
}
// —— 游戏里自带的模型（js/mdl/<键>.js）也能拆（用户：载具任何一个部件都能精准去掉、单独拿出来看、再设计）——
//   分块：解码加工完（v3gPrep 的最后）按连通块编号（modPieces：三角形连着的、位置相同的顶点算一块，不跨部件——炮塔、车轮、起落架各自分开），
//   编辑器预览（modimp.js mivShow）对同样加工过的网格用同一个算法，块号对得上。MOD.mdl[模型键]：
//   pt.x 删掉的块（区间字符串，同导入模型的格式；不重新落地居中：挂点、喷口、座舱这些按原来的坐标）；
//   ed 改造 [{ id 块号, t 平移 [x, y, z] 米, r 旋转 [绕 x, 绕 y, 绕 z] 度, s 缩放, cp 旋转缩放的中心, c 颜色 #rrggbb, cm 涂多少（1 = 完全盖住贴图）}]，按顺序套；
//   fn 动作参数（炮塔回转、炮管俯仰范围 / 速度、后坐）→ vfn.js VFN[模型键]（推演里的炮塔转速也按它）
function modPieces(m, VB, IB) {
  const st = m.st || 8, nv = VB.length / st, par = new Int32Array(nv), vp = new Int16Array(nv).fill(-9);
  for (let i = 0; i < nv; i++) par[i] = i;
  const find = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  for (const [, pi, i0, cnt] of m.lod[0]) for (let t = i0; t < i0 + cnt; t++) vp[IB[t]] = pi;
  const weld = new Map();
  for (let v = 0; v < nv; v++) {
    if (vp[v] === -9) continue;
    const o = v * st, k = vp[v] + ':' + Math.round(VB[o] * 1e4) + ',' + Math.round(VB[o + 1] * 1e4) + ',' + Math.round(VB[o + 2] * 1e4), w = weld.get(k);
    if (w == null) weld.set(k, v); else { const a = find(v), b = find(w); if (a !== b) par[a] = b; }
  }
  for (const [, , i0, cnt] of m.lod[0]) for (let t = i0; t + 2 < i0 + cnt; t += 3) { const a = find(IB[t]), b = find(IB[t + 1]), c = find(IB[t + 2]); if (b !== a) par[b] = a; if (c !== a && find(c) !== a) par[find(c)] = a; }
  const id = new Int32Array(nv).fill(-1), pv = new Uint32Array(nv);
  let n = 0;
  for (const [, , i0, cnt] of m.lod[0]) for (let t = i0; t < i0 + cnt; t++) { const r = find(IB[t]); if (id[r] < 0) id[r] = n++; }
  for (let v = 0; v < nv; v++) { const r = id[find(v)]; pv[v] = r < 0 ? 0 : r; }
  return { pv, pn: n, vp };
}
const modHex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '')); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
// 绕 x、y、z 转（度）的旋转矩阵（行主序 3 × 3，Rz · Ry · Rx）：改造、动画都用它
function modRotM(r) {
  const D = Math.PI / 180, x = (+r[0] || 0) * D, y = (+r[1] || 0) * D, z = (+r[2] || 0) * D, cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx];
}
// 改造套到顶点上（预览、游戏同一套）：VB 原地改；返回每块用哪条改造的颜色（-1 不换色）
function modEdApply(ed, VB, st, pv, pn) {
  const col = new Int16Array(pn).fill(-1), D = Math.PI / 180;
  (ed || []).forEach((e, ei) => {
    if (!e) return;
    const ids = new Uint8Array(pn);
    for (const i of modIdsDec(e.id)) if (i < pn) ids[i] = 1;
    const t = Array.isArray(e.t) ? e.t.map(v => +v || 0) : [0, 0, 0], r = Array.isArray(e.r) ? e.r.map(v => (+v || 0) * D) : [0, 0, 0], s = modNum(e.s) && e.s > 0 ? e.s : 1, c = Array.isArray(e.cp) ? e.cp : [0, 0, 0];
    const cx = Math.cos(r[0]), sx = Math.sin(r[0]), cy = Math.cos(r[1]), sy = Math.sin(r[1]), cz = Math.cos(r[2]), sz = Math.sin(r[2]);
    const M = [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx];   // Rz · Ry · Rx
    const moved = t[0] || t[1] || t[2] || r[0] || r[1] || r[2] || s !== 1;
    if (moved) for (let v = 0; v < VB.length / st; v++) {
      if (!ids[pv[v]]) continue;
      const o = v * st, x = (VB[o] - c[0]) * s, y = (VB[o + 1] - c[1]) * s, z = (VB[o + 2] - c[2]) * s, nx = VB[o + 3], ny = VB[o + 4], nz = VB[o + 5];
      VB[o] = c[0] + M[0] * x + M[1] * y + M[2] * z + t[0]; VB[o + 1] = c[1] + M[3] * x + M[4] * y + M[5] * z + t[1]; VB[o + 2] = c[2] + M[6] * x + M[7] * y + M[8] * z + t[2];
      VB[o + 3] = M[0] * nx + M[1] * ny + M[2] * nz; VB[o + 4] = M[3] * nx + M[4] * ny + M[5] * nz; VB[o + 5] = M[6] * nx + M[7] * ny + M[8] * nz;
    }
    if (modHex(e.c)) for (let i = 0; i < pn; i++) if (ids[i]) col[i] = ei;
  });
  return col;
}
// 换色：按（原材质、哪条改造）拆出新材质，把这些块的三角形挪到新材质那一段；del：删掉的块（游戏里不画；预览里靠用途码藏，不删）
function modEdSplit(m, IB, pv, col, ed, del) {
  const mats = m.mats, nm = new Map();
  const matOf = (mi, ei) => {
    const k = mi + ':' + ei;
    if (nm.has(k)) return nm.get(k);
    const T = mats[mi], e = ed[ei], c = modHex(e.c), f = clamp(modNum(e.cm) ? e.cm : .85, 0, 1);
    const N = { ...T, n: (T.n || '') + '·改色', c: [T.c[0] + (c[0] - T.c[0]) * f, T.c[1] + (c[1] - T.c[1]) * f, T.c[2] + (c[2] - T.c[2]) * f, T.c[3]] };
    if (f >= .999) { N.t = null; N.sgt = null; }   // 完全涂成这个颜色：不贴原来的底色贴图
    const j = mats.push(N) - 1;
    nm.set(k, j);
    return j;
  };
  m.lod = m.lod.map(L => {
    const out = [];
    for (const [mi, pi, i0, cnt] of L) {
      const B = new Map();
      for (let t = i0; t + 2 < i0 + cnt; t += 3) {
        const q = pv[IB[t]];
        if (del && del[q]) continue;
        const ei = col[q], k = ei < 0 ? mi : matOf(mi, ei);
        let A = B.get(k); if (!A) B.set(k, A = []);
        A.push(IB[t], IB[t + 1], IB[t + 2]);
      }
      let o = i0;
      for (const [k, A] of B) { IB.set(A, o); out.push([k, pi, o, A.length]); o += A.length; }
    }
    return out;
  });
}
// 游戏里解码（v3g.js v3gPrep 的最后调）
function modPrepB(key, m, VB, IB) {
  const A = MOD.mdl[key];
  if (MODX.noB || !A || key.startsWith('u_') || key === 'army') return;   // noB：编辑器预览自己套正在改的那份
  const pt = A.pt, ed = Array.isArray(A.ed) ? A.ed : [], ag = Array.isArray(A.ag) && A.ag.length;
  if (!(pt && pt.x) && !ed.length && !ag) return;
  const st = m.st || 8, P = modPieces(m, VB, IB), del = new Uint8Array(P.pn);
  for (const i of modIdsDec(pt && pt.x)) if (i < P.pn) del[i] = 1;
  const col = modEdApply(ed, VB, st, P.pv, P.pn);
  modEdSplit(m, IB, P.pv, col, ed, del);
  modAnimSplit(key, m, IB, P.pv);
  MODX.bsig[key] = modBSig(key);
}
const modBSig = k => { const A = MOD.mdl[k] || {}; return JSON.stringify([(A.pt && A.pt.x) || '', A.ed || null, (A.ag || []).map(g => g.id)]); };
const modISig = id => { const A = MOD.mdl[id] || {}; return JSON.stringify([A.pt || null, (A.ag || []).map(g => g.id)]); };
// 改了游戏里模型的部件：已经解码的那份放掉、重新加载（下次画到时从 js/mdl 重新取）
function modReloadB(key) {
  if (typeof V3G !== 'object') return;
  const gl = V3G.gl;
  for (const k of [key, key + '~']) {
    const old = V3G.M[k];
    if (old && old.ready && gl && k === key) { try { gl.deleteBuffer(old.vb); gl.deleteBuffer(old.ib); for (const t of old.tex || []) if (t) gl.deleteTexture(t); } catch (e) { /* 已经没了 */ } }
    for (const [ik, L] of [...V3G.inst.entries()]) if (ik.slice(0, ik.lastIndexOf('#')) === k) { if (gl) for (const b of [L.gb, L.gbv]) if (b) gl.deleteBuffer(b); V3G.inst.delete(ik); }
    delete V3G.M[k];
  }
  delete V3G.def[key]; V3G.want.delete(key); V3G.fail.delete(key);
  delete MODX.bsig[key];
  modAnimDrop(key);
}
function modBApply() {
  if (!MODX.bsig) MODX.bsig = {};
  if (typeof V3G === 'object') for (const k of new Set([...Object.keys(MOD.mdl), ...Object.keys(MODX.bsig)])) {
    if (k.startsWith('u_') || !V3G.M[k] || !V3G.M[k].ready) continue;
    const want = modBSig(k), had = MODX.bsig[k] ?? JSON.stringify(['', null]);
    if (want !== had) modReloadB(k);
  }
  // 动作参数（炮塔、炮管）
  if (typeof VFN === 'object') {
    if (!MOD_DEF.vfn) MOD_DEF.vfn = {};
    for (const k in MOD.mdl) if (MOD.mdl[k].fn && !(k in MOD_DEF.vfn) && !k.startsWith('u_')) MOD_DEF.vfn[k] = VFN[k] ? modClone(VFN[k]) : null;
    for (const k in MOD_DEF.vfn) {
      const D = MOD_DEF.vfn[k], f = MOD.mdl[k] && MOD.mdl[k].fn;
      if (!f) { if (D) VFN[k] = modClone(D); else delete VFN[k]; continue; }
      const o = D ? modClone(D) : { trav: 40, el: [-6, 18], elR: 20, rc: .3 };
      if (modNum(f.trav) && f.trav > 0) o.trav = f.trav;
      if (Array.isArray(f.el) && f.el.length === 2 && f.el.every(modNum)) o.el = [Math.min(f.el[0], f.el[1]), Math.max(f.el[0], f.el[1])];
      if (modNum(f.elR) && f.elR > 0) o.elR = f.elR;
      if (modNum(f.rc) && f.rc >= 0) o.rc = f.rc;
      VFN[k] = o;
    }
  }
}
// 模型上的点（模型坐标，米：x 前、y 左、z 上）
const modMdlOf = mk => (mk && MOD.mdl[mk]) || null;
const modNozOf = mk => { const o = modMdlOf(mk); return o && Array.isArray(o.noz) && o.noz.length ? o.noz : null; };   // 尾喷口 [x, y, z, 内半径, 深]（y 不为 0 时左右各一个）
const modFxOf = mk => { const o = modMdlOf(mk); return o && o.fx ? o.fx : null; };   // 尾焰：len 长度、bri 亮度、dia 马赫环数、wid 粗细、haze 热浪（倍数），spr 序列帧尾焰、sprS 大小、vol 体渲染尾焰开关
const modMuzOf = mk => { const o = modMdlOf(mk); return o && Array.isArray(o.muz) && o.muz.length === 3 ? o.muz : null; };   // 车辆主炮炮口
// 车载机枪的枪口：{ p 位置, on 装在哪（hull 车体 / t 炮塔 / g 炮管 / mg 机枪塔）}；没设 on 的按模型有什么部件猜（有机枪的部件就在机枪塔上，有炮塔就在炮塔上）
function modMgOf(mk) {
  const o = modMdlOf(mk);
  if (!o || !Array.isArray(o.mg) || o.mg.length !== 3) return null;
  const pt = o.pt || {}, on = ['hull', 't', 'g', 'mg'].includes(o.mgOn) ? o.mgOn : pt.mg || pt.mt ? 'mg' : pt.t ? 't' : 'hull';
  return { p: o.mg, on };
}
// 编辑器设计的热浪（按模型，MOD.mdl[模型键].hz）：每个热浪源 { p 起点, d 方向（模型坐标，米）, r 起点半径, len 长度, k 强度, sp 末端变粗几倍, rise 末端往上飘（米）, tb 湍流疏密, spd 流速, warm 发暖 }
//   游戏里（v3g.js v3gVeh / v3gPlane）按车、飞机此刻的姿态登记成三维热气柱（v3det.js v3dHazeD）；设计了的车辆不再用默认的排气位置（v3dVehHaze）
const MOD_HZC = new WeakMap();
function modHazeOf(mk) {
  const o = modMdlOf(mk);
  if (!o || !Array.isArray(o.hz) || !o.hz.length) return null;
  let L = MOD_HZC.get(o.hz);
  if (!L) MOD_HZC.set(o.hz, L = o.hz.filter(e => e && Array.isArray(e.p) && Array.isArray(e.d) && e.p.length === 3 && e.d.length === 3 && e.p.every(modNum) && e.d.every(modNum) && Math.hypot(...e.d) > 1e-6 && e.r > 0 && e.len > 0));
  return L.length ? L : null;
}
// 这辆车画面上用的模型键（编辑器换过的按换的）
const modVehMdl = v => { const M = typeof rlModelOf === 'function' ? rlModelOf(v) : null; return M && typeof v3gVehKey === 'function' ? v3gVehKey(M.key, v.side === 'e' ? 'e' : 'p') : null; };
// —— 导入模型的部件（编辑器「部件」页：MOD.mdl[模型键].pt）——
//   导入时按「连通块」编号（modimp.js mimPieces：三角形连着的、同一个物体里位置相同的顶点算一块），每个顶点记着自己是第几块（meta.pv，接在模型数据后面）；
//   连成一整块分不开的（炮塔和车体是一张网格）用编辑器里的切割薄片切开（modimp.js mimCut：沿平面真的把三角形切开，切下来的是新的块）。
//   pt 按用途列块号（区间字符串「0-5,9」）：t 炮塔、g 炮管、gear 起落架（收起时藏起来）、rot 主旋翼、trot 尾桨、x 删除、mt 机枪塔（遥控武器站的转台，转向机枪的目标）、mg 机枪（随机枪塔转、自己俯仰）；
//   没列的块是车体 / 机身，不动——炮塔转的时候只有列进 t、g、mt、mg 的块跟着转。转轴全是手动定的（不自动估）：ta 炮塔转轴、ga 炮管俯仰轴（炮耳）、ma 机枪塔转轴、mb 机枪俯仰轴、
//   ra 主旋翼轴、qa 尾桨轴，各是 { p 轴上一点 [x, y, z], a 方向 [x, y, z] }
//   （编辑器里输数、在模型上点、或用圆心定位器在圆边上点三个点）；没定转轴的部件不动。
//   el 俯仰范围 [俯, 仰]（度）、elR 俯仰速度（度 / 秒）、rc 后坐行程（米）、trav 画面上炮塔转速（装到推演里没有炮塔的车种上时用）；mtr 机枪塔转速、mel 机枪俯仰范围、melR 机枪俯仰速度。
//   机枪口在 MOD.mdl[模型键].mg（mgOn 装在哪：hull 车体、t 炮塔、g 炮管（并列机枪）、mg 机枪塔；不设按有没有机枪塔 / 炮塔猜）：推演里车载机枪打的曳光弹从这里出（combat.js tracer 的 src、v3fx.js）
//   删了东西：按剩下的部分重新落地、前后左右居中（modPtOff），模型上的点（炮口、挂点、转轴……）都按这个坐标记
const MOD_PTR = ['', 't', 'g', 'gear', 'rot', 'trot', 'x', 'mt', 'mg'];   // 用途代码（下标）：0 车体 / 机身（不动）、1 炮塔、2 炮管、3 起落架、4 主旋翼、5 尾桨、6 删除、7 机枪塔、8 机枪
const MOD_PT_DEL = 6;
const MOD_PT_AX = { ta: 1, ga: 2, ma: 7, mb: 8, ra: 4, qa: 5 };   // 转轴 → 它管哪种用途的块
const modIdsDec = s => {
  const out = [];
  for (const a of String(s ?? '').split(',')) { const m = a.match(/^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/); if (!m) continue; const lo = +m[1], hi = m[2] != null ? Math.min(+m[2], lo + 4e6) : lo; for (let i = lo; i <= hi; i++) out.push(i); }
  return out;
};
const modIdsEnc = ids => {
  const a = [...new Set(ids)].sort((x, y) => x - y), o = [];
  for (let i = 0; i < a.length;) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; o.push(j > i ? a[i] + '-' + a[j] : String(a[i])); i = j + 1; }
  return o.join(',');
};
// 每一块的用途代码（Uint8Array，下标是块号）
function modPtRoles(pt, n) {
  const R = new Uint8Array(n);
  if (pt) for (let c = 1; c < MOD_PTR.length; c++) for (const i of modIdsDec(pt[MOD_PTR[c]])) if (i < n) R[i] = c;
  return R;
}
// 每个顶点是第几块（模型数据后面那一段；没有的返回 null）
function modPv(m, bin) {
  if (!m || !m.pv || !bin) return null;
  const B = bin instanceof ArrayBuffer ? bin : bin.buffer, o = (bin.byteOffset || 0) + m.pv[0];
  if (o + m.pv[1] > B.byteLength) return null;
  return m.pvt === 4 ? new Uint32Array(B, o, m.pv[1] / 4) : new Uint16Array(B, o, m.pv[1] / 2);
}
// 每一块属于哪个物体（glTF 节点；老的导入没有）
function modPnd(m, bin) {
  if (!m || !m.pnd || !bin) return null;
  const B = bin instanceof ArrayBuffer ? bin : bin.buffer, o = (bin.byteOffset || 0) + m.pnd[0];
  return o + m.pnd[1] <= B.byteLength ? new Uint16Array(B, o, m.pnd[1] / 2) : null;
}
// 删了东西以后的坐标原点：剩下部分的包围盒底面中心（原始坐标）；什么都没删就是原点（不动以前的数据）
function modPtOff(VB, st, nv, pv, R) {
  let del = false;
  for (let i = 0; i < R.length; i++) if (R[i] === MOD_PT_DEL) { del = true; break; }
  if (!del) return [0, 0, 0];
  const b = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30];
  for (let v = 0; v < nv; v++) {
    if (R[pv[v]] === MOD_PT_DEL) continue;
    const o = v * st;
    for (let k = 0; k < 3; k++) { const x = VB[o + k]; if (x < b[k]) b[k] = x; if (x > b[k + 3]) b[k + 3] = x; }
  }
  return b[0] > b[3] ? [0, 0, 0] : [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[2]];
}
// 转轴 { p, a }：合法就返回方向单位化的一份，否则 null
function modAx(o) {
  if (!o || !Array.isArray(o.p) || !Array.isArray(o.a) || o.p.length !== 3 || o.a.length !== 3 || !o.p.every(modNum) || !o.a.every(modNum)) return null;
  const l = Math.hypot(o.a[0], o.a[1], o.a[2]);
  return l > 1e-9 ? { p: o.p.slice(), a: o.a.map(v => v / l) } : null;
}
// 转轴的正方向：炮塔正角 = 从上往下看逆时针（同游戏里炮塔转角的符号）；炮管正角 = 炮口抬起（轴指向右边）
const modAxUp = A => A && A.a[2] < 0 ? { p: A.p, a: A.a.map(v => -v) } : A;
const modAxEl = A => A && A.a[1] > 0 ? { p: A.p, a: A.a.map(v => -v) } : A;
// 游戏里解码导入的模型时（v3g.js v3gPrep 调）：删掉的块不画，炮塔、炮管、起落架、旋翼按手动定的转轴挂成部件（顶点着色器按实例参数转），
//   删了东西重新落地、居中；车辆登记进 vfn.js 的 VFN（炮塔转、炮管俯仰、后坐走和内置坦克同一套）
function modPrep(key, m, VB, IB) {
  if (typeof VFN === 'object') delete VFN[key];
  const A = MOD.mdl[key], pt = A && A.pt, D = typeof V3G === 'object' && V3G.def[key];
  if (!D || !m.pv) return;
  if (!pt) { const pv0 = modPv(m, D.bin); if (pv0 && A && Array.isArray(A.ag) && A.ag.length) modAnimSplit(key, m, IB, pv0); return; }   // 只分了动画组（没拆部件）
  const pv = modPv(m, D.bin), st = m.st || 8, nv = VB.length / st;
  if (!pv || pv.length < nv) return;
  const n = m.pn || 0, R = modPtRoles(pt, n), off = modPtOff(VB, st, nv, pv, R), R3 = v => Math.round(v * 1e4) / 1e4;
  if (off[0] || off[1] || off[2]) {
    const b = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30];
    for (let v = 0; v < nv; v++) {
      const o = v * st;
      VB[o] -= off[0]; VB[o + 1] -= off[1]; VB[o + 2] -= off[2];
      if (R[pv[v]] === MOD_PT_DEL) continue;
      for (let k = 0; k < 3; k++) { const x = VB[o + k]; if (x < b[k]) b[k] = x; if (x > b[k + 3]) b[k + 3] = x; }
    }
    const len0 = m.len;
    m.bb = b.map(R3); m.len = R3(b[3] - b[0]); m.zc = R3((b[5] - b[2]) / 2);
    if (!(m.hl > 0) || Math.abs(m.hl - len0) < 1e-3) m.hl = m.len;   // 车体长没单独给：跟着全长
  }
  const has = c => R.includes(c), parts = [], pidx = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (R[i] === MOD_PT_DEL) pidx[i] = -2;
  const TA = modAxUp(modAx(pt.ta)), GA = modAxEl(modAx(pt.ga)), RA = modAx(pt.ra), QA = modAx(pt.qa), put = (c, j) => { for (let i = 0; i < n; i++) if (R[i] === c) pidx[i] = j; };
  let ti = -1, gi = -1;
  if (TA && (has(1) || has(2))) ti = parts.push({ n: 'tur', k: 'rot', p: TA.p, a: TA.a, w: [1, 0, 0, 0] }) - 1;
  if (has(2) && GA) gi = parts.push({ n: 'gun', k: 'chain', p: TA ? TA.p : GA.p, a: TA ? TA.a : [0, 0, 1], w: TA ? [1, 0, 0, 0] : [0, 0, 0, 0], q: GA.p, a2: GA.a, e: [0, 1, 0, 0], r: [1, 0, 0], w2: [0, 0, 1, 0] }) - 1;   // 先后坐、再绕炮耳俯仰、最后随炮塔转
  else if (has(2) && TA) gi = parts.push({ n: 'gun', k: 'gun', p: TA.p, a: TA.a, w: [1, 0, 0, 0], w2: [0, 0, 1, 0] }) - 1;   // 没定炮耳：炮管只随炮塔转、后坐，不俯仰
  if (ti >= 0) put(1, ti);
  if (gi >= 0) put(2, gi);
  // 机枪塔、机枪（遥控武器站）：先绕机枪俯仰轴抬（iD3 = 参数槽 7），再绕机枪塔转轴转向机枪的目标（iC2 = 参数槽 2），最后随炮塔转
  const MA = modAxUp(modAx(pt.ma)), MB = modAxEl(modAx(pt.mb)), onT = TA ? { p: TA.p, a: TA.a, w: [1, 0, 0, 0] } : { p: [0, 0, 0], a: [0, 0, 1], w: [0, 0, 0, 0] };
  let mti = -1, mgi = -1;
  if (has(7) && (MA || TA)) mti = parts.push({ n: 'mgt', k: 'chain', ...onT, q: MA ? MA.p : [0, 0, 0], a2: MA ? MA.a : [0, 0, 1], e: MA ? [0, 0, 1, 0] : [0, 0, 0, 0], r: [1, 0, 0], w2: [0, 0, 0, 0] }) - 1;
  if (has(8) && (MA || MB || TA)) mgi = parts.push({ n: 'mgg', k: 'chain', ...onT, q: MA ? MA.p : [0, 0, 0], a2: MA ? MA.a : [0, 0, 1], e: MA ? [0, 0, 1, 0] : [0, 0, 0, 0], q3: MB ? MB.p : [0, 0, 0], a3: MB ? MB.a : [0, -1, 0], g2: MB ? [0, 0, 0, 1] : [0, 0, 0, 0], r: [1, 0, 0], w2: [0, 0, 0, 0] }) - 1;
  if (mti >= 0) put(7, mti);
  if (mgi >= 0) put(8, mgi);
  // 飞机：起落架、主旋翼、尾桨（v3gPlane 按部件名给参数：起落架收起时 1、旋翼按时间转），各占一个参数槽
  if (has(3)) {   // 起落架收起：缩到它顶上那一点（在机身里，看不见）
    const b = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30];
    for (let v = 0; v < nv; v++) { if (R[pv[v]] !== 3) continue; const o = v * st; for (let k = 0; k < 3; k++) { const x = VB[o + k]; if (x < b[k]) b[k] = x; if (x > b[k + 3]) b[k + 3] = x; } }
    put(3, parts.push({ n: 'gear', k: 'hide', slot: 0, p: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[5]], a: [0, 0, 1], w: [1, 0, 0, 0] }) - 1);
  }
  if (has(4) && RA) put(4, parts.push({ n: 'rotor', k: 'rot', slot: 1, p: RA.p, a: RA.a, w: [0, 1, 0, 0] }) - 1);
  if (has(5) && QA) put(5, parts.push({ n: 'trotor', k: 'rot', slot: 2, p: QA.p, a: QA.a, w: [0, 0, 1, 0] }) - 1);
  // 绘制段：每个材质段按「车体 / 各部件」重排三角形、拆成几段，删掉的不画
  const out = [];
  for (const [mi, pi0, i0, cnt] of m.lod[0]) {
    if (pi0 >= 0) { out.push([mi, pi0, i0, cnt]); continue; }
    const B = new Map();
    for (let t = i0; t + 2 < i0 + cnt; t += 3) { const q = pidx[pv[IB[t]]]; if (q === -2) continue; let L = B.get(q); if (!L) B.set(q, L = []); L.push(IB[t], IB[t + 1], IB[t + 2]); }
    let o = i0;
    for (const [q, L] of [...B.entries()].sort((a, b) => a[0] - b[0])) { IB.set(L, o); out.push([mi, q, o, L.length]); o += L.length; }
  }
  m.lod = [out, out, out]; m.parts = parts;
  modAnimSplit(key, m, IB, pv);   // 动画分组：每组的三角形单独一段（游戏里播动画时各组各自摆）
  if (typeof VFN === 'object' && (MOD.lib[key] || {}).kind !== 'air' && (ti >= 0 || gi >= 0 || mti >= 0 || mgi >= 0)) {
    const r2 = (a, d) => Array.isArray(a) && a.length === 2 && a.every(modNum) ? [Math.min(a[0], a[1]), Math.max(a[0], a[1])] : d, rc = modNum(pt.rc) && pt.rc >= 0 ? pt.rc : .3;
    VFN[key] = { trav: +pt.trav > 0 ? +pt.trav : 40, ta: 1, ...(gi >= 0 ? { rc, ...(rc >= .15 ? { rock: .03 } : {}) } : {}), ...(gi >= 0 && GA ? { el: r2(pt.el, [-6, 18]), elR: +pt.elR > 0 ? +pt.elR : 20 } : {}),
      ...(mti >= 0 || mgi >= 0 ? { mg: { trav: +pt.mtr > 0 ? +pt.mtr : 90, el: MB && mgi >= 0 ? r2(pt.mel, [-10, 60]) : null, elR: +pt.melR > 0 ? +pt.melR : 60, yaw: !!MA, hz: (MB || MA || { p: [0, 0, 2.5] }).p[2] } } : {}) };
  }
}
// —— 车辆（按型号）——
const modVehKey = v => { const M = typeof rlModelOf === 'function' ? rlModelOf(v) : null; return M ? M.key : null; };
const modVehOf = v => { const k = v && modVehKey(v); return k ? MOD.veh[k] || null : null; };
const modLvl = mm => Math.max(.1, mm / MOD_MM);
function modVehApply(v) {
  v.modK = 1;
  // 第一次套之前记下这辆车的原值；每次重新套（编辑器里又改了、恢复了默认）先还原再套
  if (!v.mod0) v.mod0 = { armor: v.armor, maxhp: v.maxhp, mod: v.mod ? { ...v.mod } : null };
  const B = v.mod0, f0 = v.maxhp ? clamp(v.hp / v.maxhp, 0, 1) : 1;
  v.armor = B.armor; v.maxhp = B.maxhp; v.hp = B.maxhp * f0; v.mod = B.mod ? { ...B.mod } : undefined;
  delete v.armX; delete v.penL; delete v.sightM; delete v.eraLeft; delete v.accA; delete v.turnK; delete v.travM;
  const o = modVehOf(v);
  if (!o) { if (!v.mod) delete v.mod; return; }
  const sp = vehSp(v), g = sp.gun, md = v.mod = { ...(v.mod || {}) };
  if (modNum(o.hp) && o.hp > 0) { v.maxhp = o.hp; v.hp = o.hp * f0; }
  if (modNum(o.armF) && o.armF > 0) v.armor = modLvl(o.armF);
  v.armX = ['armS', 'armR', 'armT'].map(f => modNum(o[f]) && o[f] > 0 ? modLvl(o[f]) : null);
  if (g && modNum(o.pen) && o.pen > 0) v.penL = modLvl(o.pen); else delete v.penL;
  if (g && modNum(o.range) && o.range > 0) md.rng = o.range / g.range;
  if (g && modNum(o.rof) && o.rof > 0) md.rof = g.rof / o.rof;
  if (modNum(o.speed) && o.speed > 0) md.spd = o.speed / 3.6 / sp.speed;
  if (modNum(o.acc) && o.acc > 0) v.accA = o.acc;   // 加速度（米 / 秒²）：vehicles.js 起步、转弯后按它加速（不设就是原来的一下到速）
  if (modNum(o.turn) && o.turn > 0 && sp.turn) v.turnK = o.turn * Math.PI / 180 / sp.turn;   // 车体转向（度 / 秒）
  if (modNum(o.trav) && o.trav > 0) v.travM = o.trav * Math.PI / 180;   // 炮塔回转（度 / 秒，vfn.js vfnTrav）
  if (modNum(o.sight) && o.sight > 0) v.sightM = o.sight; else delete v.sightM;
  if (o.era === 'on' && modNum(o.eraN)) v.eraLeft = o.eraN;
}
// 一辆车的某一面（'s' 侧面 / 'r' 后部 / 't' 车顶）：编辑器单独设了就用设的
const modArc = (v, arc) => { const X = v.armX, i = arc === 's' ? 0 : arc === 'r' ? 1 : arc === 't' ? 2 : -1; return X && i >= 0 && X[i] != null ? X[i] : null; };
// 爆反：o.era 'off' 拆掉；'on' 没有块布局的车型按覆盖率和块数估算；eraHeat / eraKe：挡掉破甲弹 / 穿甲弹的百分比
function modEra(v, dmg, src, sx, sy) {
  const o = modVehOf(v);
  if (!o || !o.era || o.era === 'auto') return null;
  if (o.era === 'off') return dmg;
  const M = typeof rlModelOf === 'function' ? rlModelOf(v) : null;
  if (M && M.era) return null;   // 模型上本来就有块：照块算（era.js），只换挡弹的百分比
  if (!(v.eraLeft > 0) || (src === 'ap' && !(o.eraKe > 0)) || Math.random() * 100 >= (modNum(o.eraCov) ? o.eraCov : 60)) return dmg;
  v.eraLeft--;
  S.fx.push({ kind: 'flash', x: v.x + (sx - v.x) * .02, y: v.y + (sy - v.y) * .02, r: 7, life: 0, max: .35, side: v.side });
  return dmg * (1 - clamp((src === 'ap' ? o.eraKe : (modNum(o.eraHeat) ? o.eraHeat : 92)) / 100, 0, 1));
}
// 块布局车型的挡弹百分比
const modEraK = (v, src) => { const o = modVehOf(v); if (!o) return null; const p = src === 'ap' ? o.eraKe : o.eraHeat; return modNum(p) ? 1 - clamp(p / 100, 0, 1) : null; };
// 战场大小（程序生成的「海岸登陆」地图，米；默认 8400 × 5600）：太大的按 20 米一格
function modWorld() {
  const w = clamp(Math.round((+MOD.map.w || W0) / 100) * 100, 4000, 30000), h = clamp(Math.round((+MOD.map.h || H0) / 100) * 100, 3000, 20000);
  return { w, h, cell: w * h / 100 > 2.4e6 ? 20 : 10 };
}
// 推演里：新出现的车辆第一次见到时套上编辑器的改动
HOOK.step.push(() => { if (S && S.veh) for (const v of S.veh) if (!v.modK) modVehApply(v); });

// —— 导入的文件（IndexedDB：键 → 记录）：模型 { meta, bin: ArrayBuffer }，序列帧贴图 { blob } ——
const MOD_DB = 'bh-mod-files';
function modDb() {
  if (MODX.db) return MODX.db;
  return (MODX.db = new Promise((ok, no) => {
    if (typeof indexedDB === 'undefined') { no(new Error('这个环境不能存文件（没有 IndexedDB）')); return; }
    const r = indexedDB.open(MOD_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('f');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  }));
}
const modTx = (mode, fn) => modDb().then(db => new Promise((ok, no) => { const tx = db.transaction('f', mode), st = tx.objectStore('f'); let out; const r = fn(st); if (r) r.onsuccess = () => { out = r.result; }; tx.oncomplete = () => ok(out); tx.onerror = tx.onabort = () => no(tx.error || new Error('存储失败')); }));
const modFilePut = (id, rec) => modTx('readwrite', st => st.put(rec, id));
const modFileGet = id => modTx('readonly', st => st.get(id));
const modFileDel = id => modTx('readwrite', st => st.delete(id));
const modNewId = p => p + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
// 登记：模型交给 v3g.js（V3G.def，v3gDecode 认 bin），贴图交给 v3vfx.js
function modReg(id, rec) {
  const L = MOD.lib[id];
  if (!L || !rec) return false;
  if (L.k === 'mdl' && rec.meta && rec.bin && typeof V3G === 'object') {
    MODX.raw[id] = { meta: rec.meta, bin: rec.bin };
    modRegMdl(id);
    const cr = rec.meta.credit;   // 模型自带的署名（Sketchfab 导出的 glTF 里有）：列进「素材致谢」
    if (cr && typeof V3G_CRED === 'object' && Array.isArray(V3G_CRED) && !V3G_CRED.some(c => c.uid === id)) V3G_CRED.push({ uid: id, name: L.nm + '（导入）', title: cr.title || L.nm, author: cr.author || '', license: cr.license || '', url: cr.url || '' });
    return true;
  }
  if (L.k === 'fx' && rec.blob && typeof v3vUser === 'function') { v3vUser(id, rec.blob, L.n || 8, L.f || 64, L.mode ?? 2); return true; }
  return false;
}
// 导入的模型交给 v3g.js 解码：每次给原件 meta 的一份拷贝（解码时 modPrep 会改绘制段、部件，原件留着下次再拆）；
//   换下来的旧模型：显卡缓冲区、贴图放掉，实例列表里挂着它的也去掉（不然还拿着已经删掉的缓冲区画）
function modRegMdl(id) {
  const rec = MODX.raw[id];
  if (typeof V3G !== 'object') return;
  const old = V3G.M[id], gl = V3G.gl;
  if (old && old.ready && gl) { try { gl.deleteBuffer(old.vb); gl.deleteBuffer(old.ib); for (const t of old.tex || []) if (t) gl.deleteTexture(t); } catch (e) { /* 换掉旧的 */ } }
  for (const [k, L] of [...V3G.inst.entries()]) if (k.slice(0, k.lastIndexOf('#')) === id) { if (gl) for (const b of [L.gb, L.gbv]) if (b) gl.deleteBuffer(b); V3G.inst.delete(k); }
  delete V3G.M[id]; V3G.fail.delete(id);
  if (typeof VFN === 'object') delete VFN[id];
  if (rec) { V3G.def[id] = { meta: modClone(rec.meta), bin: rec.bin }; MODX.sig[id] = modISig(id); }
  if (typeof modAnimDrop === 'function') modAnimDrop(id);
  else { delete V3G.def[id]; delete MODX.sig[id]; }
}
// 删掉一个导入的模型（编辑器里点「删除这个模型」）
function modUnreg(id) { delete MODX.raw[id]; modRegMdl(id); }
// 开机时：把库里的文件都读出来登记；读不出来的（换了浏览器、被清掉了）标记成坏的，绑定退回原来的模型
async function modLibInit() {
  const ids = Object.keys(MOD.lib);
  for (const id of ids) {
    try { const rec = await modFileGet(id); if (!modReg(id, rec)) MODX.bad.add(id); }
    catch (e) { MODX.bad.add(id); }
  }
  MODX.ready = true;
  modApply();
}
// —— 模组包：导出 / 导入 ——
// full：连同导入的模型、贴图一起（base64，文件会大）
async function modExport(full) {
  const o = { name: '暗剑模组包', v: 1, t: new Date().toISOString() };
  for (const k of MOD_SEC) o[k] = MOD[k];
  o.set = typeof SETTINGS === 'object' ? { rdist: SETTINGS.rdist, quality: SETTINGS.quality, bloom: SETTINGS.bloom, shadow: SETTINGS.shadow, cloud: SETTINGS.cloud, vfx: SETTINGS.vfx, film: SETTINGS.film } : {};
  if (full) {
    o.files = {};
    const b64 = async u8 => { const s = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsDataURL(new Blob([u8])); }); return s.slice(s.indexOf(',') + 1); };
    for (const id in MOD.lib) {
      const rec = await modFileGet(id).catch(() => null);
      if (!rec) continue;
      if (rec.bin) o.files[id] = { meta: rec.meta, b64: await b64(new Uint8Array(rec.bin)) };
      else if (rec.blob) o.files[id] = { mime: rec.blob.type, b64: await b64(rec.blob) };
    }
  }
  return JSON.stringify(o, null, full ? 0 : 1);
}
async function modImport(txt) {
  const o = JSON.parse(txt);
  if (!o || o.v !== 1) throw new Error('不是暗剑的模组包');
  const lib0 = MOD.lib;
  for (const k of MOD_SEC) MOD[k] = o[k] && typeof o[k] === 'object' ? o[k] : {};
  MOD.lib = { ...lib0, ...(o.lib && typeof o.lib === 'object' ? o.lib : {}) };   // 这台设备上已经导入的模型、贴图留着
  if (o.set && typeof SETTINGS === 'object' && typeof setClean === 'function') for (const k in o.set) { const v = setClean(k, o.set[k]); if (v !== undefined) SETTINGS[k] = v; }
  if (typeof saveSettings === 'function') saveSettings();
  if (o.files) for (const id in o.files) {
    const F = o.files[id], u8 = typeof v3gBytes === 'function' ? await v3gBytes(F.b64) : Uint8Array.from(atob(F.b64), c => c.charCodeAt(0));
    const rec = F.meta ? { meta: F.meta, bin: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) } : { blob: new Blob([u8], { type: F.mime || 'image/png' }) };
    try { await modFilePut(id, rec); MODX.bad.delete(id); modReg(id, rec); } catch (e) { MODX.bad.add(id); }
  }
  // 包里提到、但没带文件的（只导出了参数）：这台设备上也没有的标成读不出来——用到它的型号退回原来的模型（不然那一型在画面上就没了）
  for (const id in o.lib || {}) if (!(o.files && o.files[id]) && !(id in lib0)) { const rec = await modFileGet(id).catch(() => null); if (rec && modReg(id, rec)) MODX.bad.delete(id); else MODX.bad.add(id); }
  modSave();
}
modLoad();
modApply();
// —— 动画（用户：能自己设计动画，比如坦克开火时原地分成 10 块碎片跳舞；自由度拉满、好上手）——
//   MOD.mdl[模型键].ag 动画组 [{ nm 名字, id 块号（区间字符串，同部件的块号）, cp 转动缩放的中心（模型坐标）}]——每块只属于一组（先列的算）；
//   .an 各个时机的动画 { fire 开炮、hit 挨打、move 走着、idle 停着、die 被打掉 }：{ dur 时长, loop 循环, back 播完回原位, tr: { 组号: [关键帧 { t 秒, p 平移 [x, y, z] 米, r 转 [x, y, z] 度, s 缩放, e 缓动 }] } }
//   游戏里：解码时每组的三角形各成一段（modAnimSplit，绘制段第 5 项是组号）；播的时候整辆车画成「不动的部分 + 每组一个实例」，每组按此刻的姿势单独摆（v3g.js v3gAnimDraw），
//   不用改着色器：组的平移、绕中心转、缩放折算成这个实例的位置、朝向、俯仰、侧滚和比例
function modAnimSplit(key, m, IB, pv) {
  const A = MOD.mdl[key], G = A && Array.isArray(A.ag) ? A.ag : null;
  if (!G || !G.length || !pv) return;
  let n = 0;
  for (let i = 0; i < pv.length; i++) if (pv[i] + 1 > n) n = pv[i] + 1;
  const pg = new Int16Array(n).fill(-1);
  G.forEach((g, gi) => { for (const i of modIdsDec(g && g.id)) if (i < n && pg[i] < 0) pg[i] = gi; });
  m.lod = m.lod.map(L => {
    const out = [];
    for (const e of L) {
      const [mi, pi, i0, cnt] = e, B = new Map();
      for (let t = i0; t + 2 < i0 + cnt; t += 3) { const g = pg[pv[IB[t]]] ?? -1; let Q = B.get(g); if (!Q) B.set(g, Q = []); Q.push(IB[t], IB[t + 1], IB[t + 2]); }
      let o = i0;
      for (const [g, Q] of [...B.entries()].sort((a, b) => a[0] - b[0])) { IB.set(Q, o); out.push([mi, pi, o, Q.length, g]); o += Q.length; }
    }
    return out;
  });
  m.agN = G.length;
}
// 缓动
const MOD_EASE = { lin: u => u, io: u => u * u * (3 - 2 * u), in: u => u * u, out: u => 1 - (1 - u) * (1 - u), back: u => { const c = 1.70158; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; }, bounce: u => { const n = 7.5625, d = 2.75; if (u < 1 / d) return n * u * u; if (u < 2 / d) return n * (u -= 1.5 / d) * u + .75; if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + .9375; return n * (u -= 2.625 / d) * u + .984375; }, step: u => u < 1 ? 0 : 1 };
// 一组此刻的姿势：{ p, r（度）, s }；没有关键帧的组不动
function modAnimPose(K, t, dur, back) {
  if (!Array.isArray(K) || !K.length) return null;
  const Z = { t: 0, p: [0, 0, 0], r: [0, 0, 0], s: 1 }, L = K.filter(k => k && modNum(k.t)).slice().sort((a, b) => a.t - b.t);
  if (!L.length) return null;
  if (L[0].t > 1e-4) L.unshift({ ...Z, t: 0 });
  if (back !== false && L[L.length - 1].t < dur - 1e-4) L.push({ ...Z, t: dur });
  let i = 0;
  while (i + 1 < L.length && L[i + 1].t <= t) i++;
  const a = L[i], b = L[Math.min(i + 1, L.length - 1)], u = b === a || b.t <= a.t ? 0 : clamp((t - a.t) / (b.t - a.t), 0, 1), w = (MOD_EASE[b.e] || MOD_EASE.io)(u);
  const v3 = (x, y, d) => [0, 1, 2].map(j => { const p = Array.isArray(x) ? +x[j] || 0 : d, q = Array.isArray(y) ? +y[j] || 0 : d; return p + (q - p) * w; });
  const sa = modNum(a.s) ? a.s : 1, sb = modNum(b.s) ? b.s : 1;
  return { p: v3(a.p, b.p, 0), r: v3(a.r, b.r, 0), s: sa + (sb - sa) * w };
}
// 一个动画片段在 t 秒时每组的姿势
function modAnimEval(c, t) {
  const dur = Math.max(.05, +c.dur || 1), out = {};
  for (const gi in c.tr || {}) { const P = modAnimPose(c.tr[gi], t, dur, c.back); if (P) out[gi] = P; }
  return out;
}
// 这辆车此刻该播哪段、播到哪：被打掉 → 挨打 → 开炮 → 走着 → 停着
function modAnimNow(key, v, fs, dead) {
  const A = MOD.mdl[key], an = A && A.an;
  if (!an || !Array.isArray(A.ag) || !A.ag.length || !v) return null;
  const t = S.t;
  let c = null, ct = 0;
  if (dead) { if (!an.die) return null; c = an.die; ct = t - (v.deadT ?? t); }
  else if (an.hit && t - (v.hitT ?? -99) < (an.hit.dur || 1)) { c = an.hit; ct = t - v.hitT; }
  else if (an.fire && fs >= 0 && fs < (an.fire.dur || 1)) { c = an.fire; ct = fs; }
  else if (an.move && v.moving) { c = an.move; ct = t + (v.id || 0) * .37; }
  else if (an.idle && !v.moving) { c = an.idle; ct = t + (v.id || 0) * .37; }   // 停着时：走着、飞着的不播（舱盖开着飞不像话）
  if (!c || !c.tr) return null;
  const dur = Math.max(.05, +c.dur || 1);
  ct = c.loop ? ((ct % dur) + dur) % dur : Math.min(Math.max(ct, 0), dur);
  return modAnimEval(c, ct);
}
// 放掉某个模型的分组子模型（重新解码、换模型时）
function modAnimDrop(key) {
  if (typeof V3G !== 'object') return;
  const gl = V3G.gl, pre = key + '@';
  for (const k of Object.keys(V3G.M)) if (k.startsWith(pre)) delete V3G.M[k];
  for (const [ik, L] of [...V3G.inst.entries()]) if (ik.startsWith(pre)) { if (gl) for (const b of [L.gb, L.gbv]) if (b) gl.deleteBuffer(b); V3G.inst.delete(ik); }
}
if (typeof indexedDB !== 'undefined' && Object.keys(MOD.lib).length) modLibInit().catch(e => console.warn('编辑器导入的文件读不出来', e)); else MODX.ready = true;
