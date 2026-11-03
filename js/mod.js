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
const MOD_SEC = ['veh', 'air', 'eair', 'wpn', 'msl', 'map', 'mdl', 'fx', 'lib'];
const MOD = { v: 1 };
for (const k of MOD_SEC) MOD[k] = {};
const MOD_DEF = { air: {}, eair: {}, wpn: {}, msl: {}, load: {}, ap: {}, fl: {}, gun: {}, st: {}, v3air: {} };   // 表里改之前的原值
const MOD_VMDL = {};   // 车辆型号 → 换上的 3D 模型（只管画面；推演里查型号功能表 vfn.js 仍按原来的模型）
const MODX = { db: null, bad: new Set(), ready: false };   // IndexedDB、读不出来的导入文件
// 各表能改的字段（别的字段不往表里写，免得和表里原有的字段撞名）
const MOD_F = {
  air: ['spd', 'aa', 'stealth', 'radar', 'aamR', 'pkK', 'agmR', 'std', 'turn', 'loiter'],
  eair: ['spd', 'turn', 'hp', 'flares', 'stealth'],
  wpn: ['M', 'R', 'Rmin', 'tb', 'g', 'cone', 'lk', 'pk', 'acc'],
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
}
// 模型上的点（模型坐标，米：x 前、y 左、z 上）
const modMdlOf = mk => (mk && MOD.mdl[mk]) || null;
const modNozOf = mk => { const o = modMdlOf(mk); return o && Array.isArray(o.noz) && o.noz.length ? o.noz : null; };   // 尾喷口 [x, y, z, 内半径, 深]（y 不为 0 时左右各一个）
const modFxOf = mk => { const o = modMdlOf(mk); return o && o.fx ? o.fx : null; };   // 尾焰：len 长度、bri 亮度、dia 马赫环数、wid 粗细、haze 热浪（倍数），spr 序列帧尾焰、sprS 大小、vol 体渲染尾焰开关
const modMuzOf = mk => { const o = modMdlOf(mk); return o && Array.isArray(o.muz) && o.muz.length === 3 ? o.muz : null; };   // 车辆主炮炮口
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
    const old = V3G.M[id];
    if (old && old.ready && V3G.gl) { try { V3G.gl.deleteBuffer(old.vb); V3G.gl.deleteBuffer(old.ib); } catch (e) { /* 换掉旧的 */ } }
    delete V3G.M[id]; V3G.fail.delete(id);
    V3G.def[id] = { meta: rec.meta, bin: rec.bin };
    const cr = rec.meta.credit;   // 模型自带的署名（Sketchfab 导出的 glTF 里有）：列进「素材致谢」
    if (cr && typeof V3G_CRED === 'object' && Array.isArray(V3G_CRED) && !V3G_CRED.some(c => c.uid === id)) V3G_CRED.push({ uid: id, name: L.nm + '（导入）', title: cr.title || L.nm, author: cr.author || '', license: cr.license || '', url: cr.url || '' });
    return true;
  }
  if (L.k === 'fx' && rec.blob && typeof v3vUser === 'function') { v3vUser(id, rec.blob, L.n || 8, L.f || 64, L.mode ?? 2); return true; }
  return false;
}
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
  for (const k of MOD_SEC) MOD[k] = o[k] && typeof o[k] === 'object' ? o[k] : (k === 'lib' ? MOD.lib : {});
  if (o.set && typeof SETTINGS === 'object' && typeof setClean === 'function') for (const k in o.set) { const v = setClean(k, o.set[k]); if (v !== undefined) SETTINGS[k] = v; }
  if (typeof saveSettings === 'function') saveSettings();
  if (o.files) for (const id in o.files) {
    const F = o.files[id], u8 = typeof v3gBytes === 'function' ? await v3gBytes(F.b64) : Uint8Array.from(atob(F.b64), c => c.charCodeAt(0));
    const rec = F.meta ? { meta: F.meta, bin: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) } : { blob: new Blob([u8], { type: F.mime || 'image/png' }) };
    try { await modFilePut(id, rec); MODX.bad.delete(id); modReg(id, rec); } catch (e) { MODX.bad.add(id); }
  }
  modSave();
}
modLoad();
modApply();
if (typeof indexedDB !== 'undefined' && Object.keys(MOD.lib).length) modLibInit().catch(e => console.warn('编辑器导入的文件读不出来', e)); else MODX.ready = true;
