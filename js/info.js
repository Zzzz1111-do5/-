'use strict';
// 型号卡（v8）：选中一个我方单位（步兵排、车辆、舰船、驱逐舰、航母），或用鼠标点一下看得见 / 已标定的敌方目标，
// 左下角显示型号、编成与武器、弹药、油料、士气与当前状态。进攻方是解放军装备，守方是美军装备（名称与 catalog.js 一致）。
// 只读界面：不改 S。U.info = { k: 'team' | 'veh' | 'st' | 'car', id } 记点中的敌方目标；每秒刷新 4 次
const INFO_ROLE = {
  p: { rifle: ['步枪手', '191 式自动步枪'], mg: ['机枪手', 'QJY-201 通用机枪'], radio: ['通讯兵', '191 式步枪＋电台'], eng: ['工兵', '爆破器材'], aa: ['防空导弹手', '前卫-2 便携防空导弹'] },
  e: { rifle: ['步枪手', 'M4A1 卡宾枪'], mg: ['机枪手', 'M240 通用机枪'], radio: ['通讯兵', 'M4A1＋电台'], eng: ['工兵', '爆破器材'], aa: ['防空导弹手', 'FIM-92 毒刺'] }
};
// 主武器（按车型、阵营）
const INFO_GUN = {
  p: { lt_tank: '105 毫米线膛炮', tank: '125 毫米滑膛炮', hv_tank: '125 毫米滑膛炮（可发射炮射导弹）', amtank: '105 毫米线膛炮', apc: '12.7 毫米机枪', spg: '122 毫米榴弹炮', td: '100 毫米滑膛炮',
    aa_veh: '双 35 毫米高炮', sam_veh: '双 30 毫米机关炮＋8 枚近程防空导弹', recon: '12.7 毫米机枪', flame_tank: '温压火箭', mine_tank: '125 毫米滑膛炮＋扫雷连枷' },
  e: { lt_tank: '105 毫米线膛炮', tank: '120 毫米滑膛炮', hv_tank: '120 毫米滑膛炮', amtank: '12.7 毫米机枪＋40 毫米榴弹', apc: '25 毫米链炮＋陶式导弹', spg: '155 毫米榴弹炮', td: '陶-2B 反坦克导弹',
    aa_veh: '20 毫米火神炮', sam_veh: '30 毫米机关炮＋毒刺导弹', recon: '12.7 毫米机枪', flame_tank: '直列爆破装药＋温压弹', mine_tank: '扫雷犁＋直列爆破装药' }
};
const INFO_PH = { idle: '待命', stage: '前往集结', wait: '集结待攻', go: '攻击', garrison: '留守', supply: '回补弹药', regroup: '后撤重整', help: '增援', gap: '填补空隙', icpt: '拦截渗透之敌' };
const infoEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const infoPct = f => Math.round(clamp(f, 0, 1) * 100) + '%';

// 小组型号：沙盒目录条目；否则按特长（反坦克 / 狙击 / 温压）与阵营推定
function infoTeamModel(q) {
  const c = q.cat && typeof catalogById === 'function' && catalogById(q.cat);
  if (c) return c.name;
  const M = q.mod || {}, p = q.side === 'p';
  if (M.at) return p ? '反坦克火箭组（PF-98）' : '标枪反坦克组（FGM-148）';
  if ((M.rng || 1) >= 1.6) return p ? '狙击小组（QBU-202）' : '狙击手（M2010）';
  if (q.sbxTag === 'flame') return p ? '温压火箭组（PF-97）' : '突击破障组';
  if (q.kind === 'eng') return p ? '战斗工兵组' : '工兵组';
  if (q.men.includes('aa')) return p ? '便携防空导弹组（前卫-2）' : '毒刺防空组（FIM-92）';
  return p ? '步枪组（191 式步枪）' : '步兵班（M4A1 卡宾枪）';
}
// 兵员与武器：按角色汇总，特长武器另列
function infoMen(ts, side) {
  const R = INFO_ROLE[side] || INFO_ROLE.p, n = {};
  for (const q of ts) for (const m of q.men) n[m] = (n[m] || 0) + 1;
  const out = Object.keys(n).map(m => { const r = R[m] || [m, '']; return `${r[0]} ×${n[m]}${r[1] ? `（${r[1]}）` : ''}`; });
  const at = ts.filter(q => q.mod && q.mod.at).length, sn = ts.filter(q => q.mod && (q.mod.rng || 1) >= 1.6).length;
  if (at) out.push(`${at} 个组携${side === 'p' ? ' PF-98 反坦克火箭筒' : ' FGM-148 标枪导弹'}`);
  if (sn) out.push(`${sn} 个组为狙击手（${side === 'p' ? 'QBU-202' : 'M2010'}）`);
  return out;
}
// 隶属：团 · 营 · 排（每 2 秒由 hq.js hqAffil 刷新；还没刷到的按阵营给个临时建制，不出现「没有隶属」）
function infoOrg(u, i) {
  if (!u) return '';
  const o = u.org, nm = typeof hqUName === 'function' ? hqUName(u, i ?? 0) : unitName(u);
  if (o) return [o.b, o.r, nm].filter(Boolean).join(' · ');
  return u.side === 'p' ? `登陆兵团 · ${nm}（编组中）` : `海防守备团 · ${nm}（编组中）`;
}
const infoVOrg = v => v.org ? [v.org.b, v.org.r].filter(Boolean).join(' · ') : v.side === 'p' ? '登陆兵团 · 装甲分队（编组中）' : '海防守备团 · 装甲分队（编组中）';
function infoRows(rows) { return rows.filter(Boolean).map(([k, v]) => `<dt>${infoEsc(k)}</dt><dd>${v}</dd>`).join(''); }

// —— 各类目标的卡片内容：{ t 标题, s 副标题, rows [[项, 值（已转义的 HTML）]] } ——
function infoUnit(u) {
  const ts = teamsOf(u).filter(q => q.men.length), men = ts.reduce((a, q) => a + q.men.length, 0);
  if (!ts.length) return null;
  const am = ts.reduce((a, q) => a + q.ammo, 0) / ts.length, cons = ts.some(q => q.sf && q.ammo < 25), pl = S.autoPlan && S.autoPlan.u && S.autoPlan.u[u.id];
  const models = [...new Set(ts.map(infoTeamModel))];
  const st = u.state === 'rout' ? '溃退' : u.state === 'waver' ? '动摇' : '稳定', ph = pl ? INFO_PH[pl.ph] || pl.ph : null, obj = pl && pl.obj ? (S.points.find(p => p.key === pl.obj) || {}).name : null;
  return { t: unitName(u), s: u.kind === 'eng' ? '工兵分队' : u.emblem === 'para' ? '海军陆战队蛟龙突击队（特种部队，运-20 伞降）' : '步兵分队',
    rows: [['隶属', infoEsc(infoOrg(u))], ['编成', `${ts.length} 个组 ${men} 人`], ['小组型号', infoEsc(models.join('、'))], ['兵员与武器', infoEsc(infoMen(ts, 'p').join('；'))],
      ['弹药', `平均 ${Math.round(am)}/60${cons ? ' · <em>补给远，节约弹药</em>' : ''}`], ['士气', `${Math.round(u.morale)}（${st}）`],
      ['指挥', u.auto ? `自动${ph ? ` · ${ph}${obj ? ' ' + infoEsc(obj) : ''}` : ''}` : '手动']] };
}
function infoVeh(v, enemy) {
  const sp = vehSp(v), gun = (INFO_GUN[v.side] || INFO_GUN.p)[v.type] || '', vis = !enemy || specAll() || inVision(v.x, v.y);
  if (enemy) return { t: '敌 ' + vehModel(v), s: vis ? '目视' : '已标定位置（未在视野内）',
    rows: [['隶属', infoEsc(infoVOrg(v))], ['主武器', infoEsc(gun)], ['车组', `${vehCrew(v)} 人`], vis && ['车体', `约 ${infoPct(v.hp / v.maxhp)}`], v.immob && ['状态', '履带被打断']] };
  const am = sp.gun && sp.ammo ? `${Math.round(v.ammo)}/${sp.ammo} 发` : '机枪（弹药充足）', fu = v.fuel ?? 1;
  const st = [v.ai === 'repair' && '轮换补给中', v.cons && '补给远，节约弹药', fu <= 0 && '油料耗尽', v.immob && '履带被打断', v.burn > 0 && '起火', v.blk && '前方有敌步兵，停车以火力解决'].filter(Boolean);
  const form = v.esc && v.esc.form ? v.esc.form : v.vform;
  return { t: vehName(v), s: v.lst ? '在坦克登陆舰上' : v.swim ? '泅渡中' : '装甲车辆',
    rows: [['隶属', infoEsc(infoVOrg(v))], ['主武器', infoEsc(gun)], sp.sam && ['防空导弹', `${v.samN ?? sp.sam.n}/${sp.sam.n} 枚`], ['车组', `${vehCrew(v)} 人`], ['车体', `${Math.ceil(v.hp)}/${v.maxhp}（装甲等级 ${v.armor}）`],
      ['炮弹', am], ['油料', infoPct(fu)], form && typeof TF_VFORM === 'object' && ['队形', TF_VFORM[form] || form], ['状态', st.length ? infoEsc(st.join('、')) : '正常'], ['指挥', v.auto ? '自动' : '手动']] };
}
function infoShip(s) {
  const c = s.cat && typeof catalogById === 'function' && catalogById(s.cat), sp = SHIP_SPEC[s.kind] || {};
  const L = s.load || {}, veh = Array.isArray(L.veh) ? L.veh.length : 0;
  const V = s.kind === 'dd' && typeof vlsOf === 'function' ? vlsOf(s) : null;
  return { t: `${s.label || ''} ${c ? c.name : sp.name || '舰船'}`, s: s.kind === 'dd' ? '护航舰' : '登陆舰艇',
    rows: [['舰体', `${Math.ceil(s.hp)}/${s.maxhp || sp.hp || '?'}`], V && ['垂发', infoEsc(`${VLS_CLS[s.vlsC].cells} 单元：${vlsText(s)}`)], (L.teams || L.eng) && ['载员', `${(L.teams || 0) * 3 + (L.eng || 0)} 人`], veh && ['载车', `${veh} 辆`], ['状态', infoEsc({ idle: '待命', move: '航行', unloading: '卸载', beached: '已抢滩', sunk: '沉没' }[s.state] || s.state || '')]] };
}
function infoDD() {
  const d = S.dd;
  const V = typeof vlsOf === 'function' && d.state !== 'sunk' ? vlsOf(d) : null, C = V && VLS_CLS[d.vlsC];
  return { t: `${d.name || '055 型驱逐舰'} DD-101`, s: '旗舰（舰炮火力支援、垂发导弹）',
    rows: [['舰体', d.state === 'sunk' ? '沉没' : `${d.hull}/${d.hull0 || 3}`], ['主炮', '130 毫米舰炮'], ['烟幕弹', `${S.assets.smoke ?? 0} 发`],
      V && ['垂发', infoEsc(`${C.cells} 单元：${vlsText(d)}${d.vls0.yu8 ? ` · 鱼-8 ${V.yu8}` : ''}`)],
      V && (V.cj10 != null || V.yj18 != null) && ['对陆导弹', infoEsc(`亚音速：长剑-10 ${V.cj10 ?? 0}；超音速：鹰击-18A ${V.yj18 ?? 0}、鹰击-21 ${V.yj21 ?? 0}`)],
      S.aor && ['补给舰', infoEsc(`${AOR.name}${S.aor.st === 'go' ? '驶来' : S.aor.st === 'rep' ? `补给中 ${Math.round(S.aor.p * 100)}%` : '返航'}`)],
      ['战术导弹', `${S.assets.msl ?? 0} 枚（东风-15B，战区火箭军）`],
      ['状态', d.state === 'repair' ? '损管抢修中' : d.state === 'sunk' ? '—' : d.cool > 0 ? '装填中' : '待命'], ['指挥', d.auto ? '自动掩护' : '手动']] };
}
function infoCV() {
  const c = S.cv, w = S.air ? S.air.wing : [], cnt = st => w.filter(o => o.state === st).length;
  const types = {};
  for (const o of w) if (o.state !== 'lost') { const n = typeof airName === 'function' ? airName(o.type, o.v) : o.type; types[n] = (types[n] || 0) + 1; }
  return { t: c.name || '003 型航母（福建舰）', s: '航空母舰',
    rows: [['甲板', `${Math.ceil(c.hp)}/${c.maxhp}`], ['舰载机', `${w.length - cnt('lost')} 架（甲板待命 ${cnt('deck')}、整备 ${cnt('rearm')}、出击 ${cnt('out')}、损失 ${cnt('lost')}）`],
      ['机型', infoEsc(Object.entries(types).map(([k, n]) => `${k} ×${n}`).join('、') || '—')],
      ['自卫火力', `1130 型近防炮 ×3、红旗-10 防空导弹 ×4 座（余 ${c.hq10 ?? (typeof CV_DEF === 'object' ? CV_DEF.hq10 : 72)} 枚）——拦截来袭导弹、打靠近的敌机`], ['派机', c.auto ? '自动' : '手动']] };
}
function infoEnemyTeam(q) {
  const vis = specAll() || inVision(q.x, q.y);
  const u = unitOf(q), i = u ? S.units.filter(o => o.side === u.side && o.org && u.org && o.org.r === u.org.r).indexOf(u) : 0;
  return { t: '敌 ' + infoTeamModel(q), s: vis ? '目视' : '最后发现位置',
    rows: [['隶属', infoEsc(u ? infoOrg(u, Math.max(0, i)) : '海防守备团（散兵）')], ['人数', vis ? `${q.men.length} 人` : '不明'], vis && ['兵员与武器', infoEsc(infoMen([q], 'e').join('；'))], vis && ['状态', q.sup > 60 ? '被压制' : q.sup > 30 ? '受到压制' : '正常']] };
}
function infoEnemySt(e) {
  const vis = specAll() || inVision(e.x, e.y), nm = e.name || (ENEMY_SPEC[e.kind] || {}).name || '火力点';
  return { t: '敌 ' + nm, s: e.dead ? '已摧毁' : vis ? '目视' : '已标定',
    rows: [['隶属', infoEsc(e.org ? [e.org.b, e.org.r].filter(Boolean).join(' · ') : '海防守备团 · 团火力群')], !e.dead && vis && ['耐久', `约 ${infoPct(e.hp / ((ENEMY_SPEC[e.kind] || {}).hp || e.hp || 1))}`], !e.dead && ['状态', (e.sup || 0) > 50 ? '被压制' : e.moving ? '转移阵地' : '正常'], e.kind === 'tel' && ['载弹', `${e.n ?? 2} 枚`], e.kind === 'ascm' && ['载弹', `${e.n ?? 4} 枚`], e.kind === 'typhon' && ['载弹', `战斧 ${e.n ?? 16} 枚`], e.kind === 'typhon' && !e.dead && vis && typeof tyEnsure === 'function' && ['各车', (T => TY_U.map((o, i) => `${o.nm}${T.u[i].dead ? '（被毁）' : o.k === 'L' ? `（${T.u[i].r} 枚）` : ''}`).join('、'))(tyEnsure(e))]] };
}

// 飞机参数卡：我方（S.planes）与敌机（S.eair.fly）
const INFO_AIRK = { fighter: '制空', strike: '对地攻击', cas: '近距空中支援', bomber: '轰炸', recon: '侦察 / 预警', transport: '运输' };
const INFO_AIRPH = { cat: '弹射起飞', roll: '起飞滑跑', out: '出航', loiter: '巡逻 / 待机', rtb: '返航', trap: '着舰', final: '进近', land: '着陆', cap: '空中巡逻', atk: '攻击', hold: '盘旋待命', app: '进近', drop: '空投', abort: '放弃任务返航' };
const infoStl = st => st ? `隐身（雷达发现距离约为普通飞机的 ${Math.round(Math.min(1, st * 1.2) * 100)}%）` : '非隐身';
// 隐身机在敌雷达覆盖下待久了的暴露程度（airwar.js awStl）
const infoExp = o => !o || !(o.exp > 0) || typeof AW_EXP !== 'object' ? '' : o.exp > AW_EXP.t0 ? `；已被敌雷达持续照射 ${Math.round(o.exp)} 秒，隐身失效 ${Math.round(clamp((o.exp - AW_EXP.t0) / AW_EXP.t1, 0, 1) * 100)}%` : `；在敌雷达覆盖下 ${Math.round(o.exp)} 秒（超过 ${AW_EXP.t0} 秒开始暴露）`;
function infoPlane(p) {
  const sp = typeof airSpec === 'function' ? airSpec(p.kind, p.v) : {}, nm = typeof airName === 'function' ? airName(p.kind, p.v) : p.kind;
  const wpn = [p.aam > 0 && `中远程空空导弹 ${p.aam} 枚`, p.aamL > 0 && `远程空空导弹（霹雳-17）${p.aamL} 枚`, p.gbN > 0 && `制导炸弹 / 导弹 ${p.gbN} 枚`, p.agmN > 0 && `对地导弹 / 滑翔炸弹 ${p.agmN} 枚`,
    !sp.stealth && p.gun > 0 && `航炮 ${p.gun} 发`].filter(Boolean).join('；');
  return { t: nm, s: `${INFO_AIRK[p.kind] || p.kind}`,
    rows: [['状态', infoEsc(INFO_AIRPH[p.phase] || p.phase || '')], ['速度', `${Math.round(p.spd || 0)}（最大 ${sp.spd || '?'}）`], ['隐身', infoEsc(infoStl(sp.stealth) + infoExp(p))],
      sp.radar && ['机载雷达', `发现距离 ${sp.radar}`], wpn && ['挂载', infoEsc(wpn)], p.flares != null && ['干扰弹', `${p.flares} 组`],
      sp.stealth && p.kind === 'fighter' && ['空战打法', '超视距：发射后侧转保持照射，敌机逼近就拖开，不进格斗'], ['起降', sp.land ? '战区陆基机场' : '航母']] };
}
function infoEair(a) {
  const sp = (typeof EA_SPEC === 'object' && EA_SPEC[a.type]) || {}, F = typeof EA_FTR === 'object' && EA_FTR[a.type];
  const wpn = [a.aam > 0 && `AIM-120D 空空导弹 ${a.aam} 枚`, a.sdb > 0 && `GBU-53/B 小直径炸弹 ${a.sdb} 枚`, a.mav > 0 && `AGM-65 小牛导弹 ${a.mav} 枚`, a.rk > 0 && `火箭弹 ${a.rk} 组`, a.atgm > 0 && `地狱火导弹 ${a.atgm} 组`,
    !sp.stealth && a.gun > 0 && `航炮 ${a.gun} 发`].filter(Boolean).join('；');
  return { t: '敌 ' + (sp.name || a.type), s: specAll() || inVision(a.x, a.y) ? '目视' : '雷达发现',
    rows: [['状态', infoEsc(INFO_AIRPH[a.ph] || a.ph || '')], ['耐久', `${a.hp ?? '?'}/${sp.hp ?? '?'}`], ['速度', `${Math.round(a.spd || 0)}（最大 ${sp.spd || '?'}）`], ['隐身', infoEsc(infoStl(sp.stealth) + infoExp(a))],
      F && ['机载雷达', `发现距离 ${F.radar}`], wpn && ['挂载', infoEsc(wpn)], a.flares != null && ['干扰弹', `${a.flares} 组`],
      sp.stealth && F && ['空战打法', '超视距：发射后侧转，被逼近就拖开'], a.type === 'c17' && ['机上', `${(a.sq || []).length} 个班、${(a.veh || []).length} 辆空投车辆`]] };
}

function infoPick() {
  if (U.info) {
    const I = U.info;
    if (I.k === 'team') { const q = S.teams.find(o => o.id === I.id && o.men.length); return q && infoEnemyTeam(q); }
    if (I.k === 'veh') { const v = vehById(I.id); return v && !v.dead && infoVeh(v, true); }
    if (I.k === 'st') { const e = S.enemies.find(o => o.id === I.id); return e && infoEnemySt(e); }
    if (I.k === 'plane') { const p = (S.planes || []).find(o => o.id === I.id && !o.dead); return p && infoPlane(p); }
    if (I.k === 'eair') { const a = S.eair && S.eair.fly.find(o => o.id === I.id && !o.dead); return a && infoEair(a); }
    if (I.k === 'car') { const a = (S.armor || []).find(o => o.id === I.id && !o.dead); return a && { t: '敌 M1117 装甲警戒车', s: '目视', rows: [['主武器', '40 毫米榴弹发射器＋12.7 毫米机枪'], ['车体', `约 ${infoPct(a.hp / a.maxhp)}`]] }; }
    return null;
  }
  if (S.sel.length !== 1) return S.sel.length > 1 ? { t: `已选 ${S.sel.length} 个单位`, s: '只选一个可查看型号', rows: [] } : null;
  const id = S.sel[0];
  if (id === 'DD') return S.dd ? infoDD() : null;
  if (id === 'CV') return S.cv ? infoCV() : null;
  const u = UNIT_MAP.get(id);
  if (u) return infoUnit(u);
  const v = (S.veh || []).find(o => o.id === id && !o.dead);
  if (v) return infoVeh(v, false);
  const s = S.ships.find(o => o.id === id);
  return s ? infoShip(s) : null;
}
let INFO_T = 0, INFO_HTML = '';
function infoRender(force) {
  const el = typeof $ === 'function' && $('info');
  if (!el || !S) return;
  const now = performance.now();
  if (!force && now - INFO_T < 250) return;
  INFO_T = now;
  const c = S.phase === 'sandbox' ? null : infoPick();
  if (!c) { if (!el.hidden) el.hidden = true; INFO_HTML = ''; return; }
  const html = `<header><b>${infoEsc(c.t)}</b><span>${infoEsc(c.s || '')}</span><button type="button" class="ic-x" aria-label="关闭" title="关闭">×</button></header><dl>${infoRows(c.rows)}</dl>`;
  if (html !== INFO_HTML) { el.innerHTML = html; INFO_HTML = html; }
  if (el.hidden) el.hidden = false;
}
if (typeof HOOK === 'object') {
  HOOK.frame.push(() => infoRender(false));
  // 点敌方目标：不改选择，只显示它的型号卡；点自己的单位或空地时清掉
  HOOK.pointer.push((e, ph, p) => {
    if (ph !== 'up' || e.button !== 0 || !S || S.phase === 'sandbox' || U.tool || U.box || !p) return false;
    const r = Math.max(14, px(16)), spec = specAll();
    let best = null, bd = r;
    const cand = (k, id, x, y) => { const d = dist(p.x, p.y, x, y); if (d < bd) { bd = d; best = { k, id }; } };
    for (const q of S.teams) if (q.side === 'e' && q.men.length && (spec || inVision(q.x, q.y))) cand('team', q.id, q.x, q.y);
    for (const v of S.veh || []) if (v.side === 'e' && !v.dead && (spec || inVision(v.x, v.y) || v.kx != null)) cand('veh', v.id, spec || inVision(v.x, v.y) ? v.x : v.kx, spec || inVision(v.x, v.y) ? v.y : v.ky);
    for (const o of S.enemies) if (spec || inVision(o.x, o.y) || o.kx != null) cand('st', o.id, o.kx ?? o.x, o.ky ?? o.y);
    for (const a of S.armor || []) if (!a.dead && (spec || inVision(a.x, a.y))) cand('car', a.id, a.x, a.y);
    bd = Math.min(bd, r) * 1.4;   // 飞机画得大：点中范围宽一点，并且优先于地面目标
    for (const o of S.planes || []) if (!o.dead && o.alt > .05) cand('plane', o.id, o.x, o.y);
    if (S.eair) for (const a of S.eair.fly) if (!a.dead && (spec || inVision(a.x, a.y) || (typeof awSeen === 'function' && awSeen('p', a.x, a.y, typeof eaStl === 'function' ? eaStl(a) : (EA_SPEC[a.type] || {}).stealth || 1)))) cand('eair', a.id, a.x, a.y);
    U.info = best;
    infoRender(true);
    return false;
  });
}
// 选择变化（hud.js updateHud 调用）：选了我方单位就不再显示之前点中的敌方目标
function infoOnSel() { if (S && S.sel.length && typeof U === 'object') U.info = null; infoRender(true); }
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#info .ic-x')) { if (typeof U === 'object') U.info = null; if (S) S.sel = []; if (typeof updateHud === 'function') updateHud(); infoRender(true); } });
