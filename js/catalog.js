'use strict';
// 兵力目录（无 DOM，可在 Node 中运行）：约 110 种模块，建立在二十余种引擎原型之上；spawn 只给 sandbox.js 用
// stats 为 0–10 归一化展示值：hp 耐久 · armor 装甲 · firepower 火力 · range 射程 · speed 速度 · sight 视野 · men 人数
// spawn.at 放置规则：land 陆地 · coast 岸边 300 内陆地 · shore 水际（浅滩 / 滩头）· line 两点连线（陆地）· sea 集结海域
//   cargo 装载到登陆舰（步兵）· vcargo 装载到坦克登陆舰（车辆）· air 无需位置（航母舰载机）· none 无需位置 · target 敌岸目标点
const CAT_NAMES = { inf: '步兵', armor: '装甲', arty: '火炮', air: '航空', naval: '舰艇', fort: '工事', support: '支援' };
const ARCH_NAMES = {
  inf_p: '登陆步兵组', eng_p: '登陆工兵组', inf_e: '守备步兵', eng_e: '守军工兵', bunker: '碉堡掩体', coastal: '岸防炮', arty: '野战炮兵', mortar: '迫击炮',
  aa: '防空炮', mines: '雷区', wire: '铁丝网', obst: '反登陆障碍', trench: '堑壕', post: '观察与雷达', decoy: '假目标', depot_e: '弹药库',
  veh: '装甲车辆', car_e: '守军装甲车', ship: '登陆舰艇', fire_ship: '火力支援艇', sweep: '扫雷舰', dd: '驱护舰 / 巡洋舰', cv: '航空母舰',
  wing: '舰载机', asset: '后勤资源', sortie: '战前出击', wave_e: '增援波次', missile: '战术导弹', airfield: '野战机场', ewing: '守军航空'
};

// —— 图标（24×24 描边，与 hud.js ICON 同风格；class="f" 为实心）——
const ctDots = n => Array.from({ length: n }, (_, i) => `<circle class="f" cx="${21 - i * 3}" cy="3" r="1.1"/>`).join('');
const ctBars = n => Array.from({ length: n }, (_, i) => `<path d="M${2 + i * 2.6} 2.5v3"/>`).join('');
const CT_SOLDIER = '<circle cx="12" cy="5" r="2.4"/><path d="M12 7.5v7.5M7.5 11h9M8.5 21l3.5-6 3.5 6"/>';
const CT_HELM = '<path d="M5 13a7 7 0 0 1 14 0z"/><path d="M3 13h18"/>';
const CT_BUNK = '<path d="M3 19h18M5 19v-7a7 5.5 0 0 1 14 0v7"/><path d="M8.5 14h7" stroke-width="2.2"/>';
const CT_CAS = '<rect x="3" y="9" width="18" height="10"/><path d="M3 9l3-3h12l3 3"/><path d="M7 13.5h10" stroke-width="2.2"/>';
const CT_GUN = '<circle cx="8" cy="16" r="4.5"/><path d="M10.5 13l10-8.5M11.5 15l9.5-7.5"/><path d="M2 21h12"/>';
const CT_HOW = '<circle cx="8" cy="17" r="3.5"/><path d="M9.5 14.5l10-9.5M4 21l4-4M12 21l-4-4"/>';
const CT_MORT = '<path d="M8.5 19L14 5.5"/><path d="M4 20h11M8.5 19l-3-5"/><circle cx="15" cy="4" r="1.4"/>';
const CT_AA = '<path d="M4 20h16M8 20l4-6 4 6M12 14L7.5 3.5M12 14l4.5-10.5"/><circle class="f" cx="12" cy="14" r="1.6"/>';
const CT_TRK = '<path d="M5.5 5v15M18.5 5v15" stroke-dasharray="1.6 1.4"/>';
const ctTank = (hw, hh, tr, bl, thick) => {
  const x = 12 - hw, y = 13 - hh;
  return `<rect x="${x}" y="${y}" width="${hw * 2}" height="${hh * 2}" rx="1"/><path d="M${x} ${y + 1.5}v${hh * 2 - 3}M${24 - x} ${y + 1.5}v${hh * 2 - 3}" stroke-dasharray="1.5 1.3"/>` +
    (tr ? `<circle cx="12" cy="13.5" r="${tr}"/>` : '') + (bl ? `<path d="M12 ${13.5 - tr}V${13.5 - tr - bl}"${thick ? ' stroke-width="2.4"' : ''}/>` : '');
};
const CT_WHEEL = '<circle cx="7" cy="7" r="1.5"/><circle cx="17" cy="7" r="1.5"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/>';
const ctHull = (w, l, bow) => `<path d="M${12 - w} ${21}V${21 - l + bow}L12 ${21 - l}l${w} ${bow}V21z"/>`;
const ctFlatHull = (w, l) => `<path d="M${12 - w} ${21 - l}h${w * 2}v${l - 1.5}l-1.5 1.5h-${w * 2 - 3}l-1.5-1.5z"/><path d="M${12 - w} ${23.5 - l}h${w * 2}"/>`;
const CT_AIR = typeof CARRIER_ICONS === 'object' ? CARRIER_ICONS : {};
const CT_IC = {
  rifle: CT_SOLDIER, mg: '<circle cx="6.5" cy="6" r="2"/><path d="M6.5 8v6M4.5 20l2-6 2 6M10 12h11M15 12l-2 7.5M17 12l2 7.5"/>',
  marine: CT_SOLDIER.replace('M8.5 21l3.5-6 3.5 6', 'M9 18l3-3 3 3') + '<path d="M3 21.5q2.25-2 4.5 0t4.5 0 4.5 0 4.5 0"/>',
  ranger: CT_SOLDIER + '<path class="f" d="M12 9.5l1.6 1.5-1.6 1.5-1.6-1.5z"/>',
  sniper: '<circle cx="12" cy="12" r="7"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><circle class="f" cx="12" cy="12" r="1.3"/>',
  at: '<path d="M3 16.5L19 7.5l1.4 2.5-16 9z"/><path d="M19.7 8.7l2.3-1.3M9.5 13.5l1.6 4"/>',
  flame: '<path d="M12 2.5c1 4 5.5 5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-3 2-4.5 2-6.5 1.5 1 2.2 2.6 2.2 4.2 1-2 1.3-5 1.3-8.2z"/>',
  eng: '<path d="M4 20L14 10M12 8l4.5-4.5 4 4L16 12zM19.5 20L9 9.5M7.5 8a2.5 2.5 0 1 1 0-.01"/>',
  medic: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8" stroke-width="2.2"/>',
  fo: '<circle cx="7.5" cy="15.5" r="3.5"/><circle cx="16.5" cy="15.5" r="3.5"/><path d="M4.8 13l2-6.5h3l1 6.5M19.2 13l-2-6.5h-3l-1 6.5M11 14h2"/>',
  pmortar: CT_MORT + '<circle cx="19.5" cy="17" r="2.2"/>',
  hq: '<path d="M6 21.5V2.5M6 3.5h12l-3 4 3 4H6"/><path d="M3 21.5h6"/>',
  demo: '<rect x="4.5" y="10" width="15" height="10" rx="1"/><path d="M9 10V7h6v3M12 7c0-2 2-3.5 3.5-4.5"/><circle class="f" cx="16.5" cy="2.8" r="1.1"/>',
  egar: CT_HELM + '<path d="M7 17v4M12 17v4M17 17v4"/>', emg: CT_HELM + '<path d="M4 20a3 2 0 0 1 6 0M9 20a3 2 0 0 1 6 0M14 20a3 2 0 0 1 6 0"/>',
  eamb: CT_HELM + '<path d="M4 21l2-4 2 4M10 21l2-4 2 4M16 21l2-4 2 4"/>', eres: CT_HELM + '<path d="M12 16v6M9 19l3 3 3-3"/>',
  easlt: CT_HELM + '<path d="M6 21l6-4 6 4M6 18l6-4 6 4" transform="translate(0 1)"/>', emil: '<path d="M5 13a7 7 0 0 1 14 0z" stroke-dasharray="2 1.6"/><path d="M3 13h18M9 17l3 4 3-4"/>',
  eeng: CT_HELM + '<path d="M8 21l8-5M14 15.5l2.5-1.5 1.5 2.5-2.5 1.5z"/>',
  bunker: CT_BUNK, casemate: CT_CAS, atcas: CT_CAS.replace('M7 13.5h10', 'M7 13.5h4') + '<path d="M12 13.5h10" stroke-width="1.8"/>',
  pillbox: '<path d="M6 19v-4a6 4.5 0 0 1 12 0v4M3 19h18"/><circle class="f" cx="12" cy="15" r="1.2"/>',
  flak: '<rect x="5" y="9" width="14" height="12"/><path d="M5 12h14M9 9L6 2M15 9l3-7M12 9V3"/>',
  coastal: CT_GUN, rail: CT_GUN.replace('M2 21h12', 'M1 21h22M4 23v-2M10 23v-2M16 23v-2M22 23v-2'), radgun: CT_GUN + '<path d="M17 21a4 4 0 0 1 4-4M15 21a6 6 0 0 1 6-6"/>',
  fgun: '<circle cx="8" cy="16" r="3.5"/><path d="M10 14.5l12-4M3 21l5-5M13 21l-5-5"/>', how: CT_HOW, hhow: CT_HOW.replace('M9.5 14.5l10-9.5', 'M9.5 14.5l10-9.5M11 15.5l9.5-8.8'),
  rkt: '<rect x="2.5" y="14" width="13" height="5"/><circle cx="5.5" cy="20.5" r="1.4"/><circle cx="12.5" cy="20.5" r="1.4"/><path d="M5 13L18 5.5M7.5 13.5L20.5 6M10 14l12-6.5"/>',
  mortar: CT_MORT, hmortar: CT_MORT.replace('M8.5 19L14 5.5', 'M8 19l5.5-13.5M10 19l5.5-13.5'), aa: CT_AA, haa: CT_AA.replace('M4 20h16', 'M3 20h18M3 17h18'),
  raa: CT_AA + '<path d="M2 9a6 6 0 0 1 4-5M2.5 13a10 10 0 0 1 6.5-10"/>',
  mine: '<circle cx="12" cy="14" r="5"/><path d="M12 9V6M8.5 10.5l-2-2M15.5 10.5l2-2"/><path d="M3 21h18" stroke-dasharray="2 2"/>',
  atmine: '<ellipse cx="12" cy="14" rx="8" ry="3.5"/><path d="M8.5 11.2V9h7v2.2"/><path d="M3 21h18" stroke-dasharray="2 2"/>',
  mixmine: '<circle cx="7" cy="12" r="3.5"/><path d="M7 8.5V6"/><ellipse cx="16" cy="16" rx="5" ry="2.4"/><path d="M3 21h18" stroke-dasharray="2 2"/>',
  dmine: '<circle cx="6" cy="9" r="3"/><circle cx="17" cy="8" r="3"/><circle cx="11.5" cy="16" r="3"/><path d="M3 21.5h18" stroke-dasharray="2 2"/>',
  wire: '<path d="M2 12h20"/><path d="M3 8l4 8M7 8l-4 8M11 8l4 8M15 8l-4 8M19 8l3 6"/>',
  wire2: '<path d="M2 8h20M2 16h20"/><path d="M4 5l3 6M7 5l-3 6M14 5l3 6M17 5l-3 6M9 13l3 6M12 13l-3 6M19 13l3 6"/>',
  conc: '<path d="M2 13c0-5 4-5 4 0s4 5 4 0 4-5 4 0 4 5 4 0 4-5 4 0"/><path d="M2 13h20" stroke-dasharray="1.5 2"/>',
  hedge: '<path d="M5 20L19 6M5 6l14 14M12 3v18"/>', stakes: '<path d="M5 21l3.5-15M12 21V4M19 21l-3.5-15"/><path d="M2 21h20"/>',
  tetra: '<path d="M12 4L4 19h16zM12 4v15M4 19l8-5 8 5"/>',
  trench: '<path d="M2 11h5v5h5v-5h5v5h5"/>', zz: '<path d="M2 17l5-9 5 9 5-9 5 9"/>', ditch: '<path d="M2 8h6l2 9h4l2-9h6"/><path d="M10 17h4M11 13h2"/>',
  op: '<path d="M8 21.5l2-12h4l2 12M6.5 9.5h11M9 9.5v-4h6v4M12 5.5V2"/>', radar: '<path d="M4 13.5a8 8 0 0 0 11-9z"/><path d="M9 9.5l7-7M8 21h8M12 14.5V21"/>',
  slight: '<circle cx="7" cy="15" r="4"/><path d="M10 12l11-8M11 15.5l11-3"/><path d="M5 21h4"/>',
  decoy: '<path d="M3 19h18M5 19v-7a7 5.5 0 0 1 14 0v7" stroke-dasharray="2 2"/><path d="M9 10l6 6M15 10l-6 6"/>',
  ammo: '<rect x="3" y="12" width="8" height="8"/><rect x="13" y="12" width="8" height="8"/><rect x="8" y="4" width="8" height="8"/><path d="M5 16h4M15 16h4M10 8h4"/>',
  ewave: '<path d="M6 3v11M2.5 10.5L6 14l3.5-3.5M18 3v11M14.5 10.5L18 14l3.5-3.5M3 20h18"/>',
  lt: ctTank(4.5, 6, 2.4, 5), tank: ctTank(5.5, 7, 3, 7), tank76: ctTank(5.5, 7, 3, 9.5), hv: ctTank(6.5, 8, 3.6, 7.5, 1),
  amt: '<path d="M6 21V8l6-5 6 5v13z"/><circle cx="12" cy="13" r="2.6"/><path d="M12 10.4V5.5"/><path d="M2 22q2.5-2 5 0M17 22q2.5-2 5 0"/>',
  amh: '<path d="M6 21V8l6-5 6 5v13z"/><circle cx="12" cy="13" r="3.2"/><path d="M12 9.8V7" stroke-width="2.6"/><path d="M2 22q2.5-2 5 0M17 22q2.5-2 5 0"/>',
  apc: '<path d="M6 21V7l2-3h8l2 3v14z"/><path d="M8.5 9h7M8.5 13h7M8.5 17h7"/>', ifv: '<path d="M6 21V7l2-3h8l2 3v14z"/><rect x="9.5" y="10" width="5" height="5"/><path d="M12 10V4.5"/>',
  spg: '<path d="M5.5 21V6h13v15z"/><path d="M8 12h8v6H8z"/><path d="M12 12V2" stroke-width="2"/><circle class="f" cx="12" cy="2.5" r="1"/>',
  td: '<path d="M5.5 21V9l3-4h7l3 4v12z"/><path d="M12 9V1" stroke-width="2"/>', aav: ctTank(5, 6.5, 2.8, 0) + '<path d="M10.8 10.7V3M13.2 10.7V3"/>',
  rcn: CT_WHEEL + '<path d="M8 5h8l2 3v10l-2 2H8l-2-2V8z"/><circle cx="12" cy="12" r="2"/><path d="M12 10V4"/>',
  flt: ctTank(5.5, 7, 3, 4) + '<path d="M12 6.5c-1.5-1-1.5-3 0-4.5 1.5 1.5 1.5 3.5 0 4.5z"/>', mnt: ctTank(5.5, 6.5, 2.6, 3) + '<rect x="5" y="1.5" width="14" height="3"/><path d="M8 4.5v2M16 4.5v2"/>',
  dozer: ctTank(5.5, 6.5, 2.6, 3) + '<path d="M4 4.5q8-3.5 16 0"/>', ecar: CT_WHEEL + '<path d="M7 4h10l1.5 3v12L17 21H7l-1.5-2V7z"/><circle cx="12" cy="12" r="2.6"/><path d="M12 9.4V3"/>',
  lct: ctFlatHull(6, 18) + '<circle class="f" cx="9.5" cy="11" r="1"/><circle class="f" cx="14.5" cy="11" r="1"/><circle class="f" cx="9.5" cy="15" r="1"/><circle class="f" cx="14.5" cy="15" r="1"/>',
  lci: ctHull(5, 20, 5) + '<path d="M9 12h6M9 15h6M9 18h6"/>', lcvp: ctFlatHull(4.5, 12) + '<circle class="f" cx="12" cy="15" r="1"/>',
  lst: ctFlatHull(7, 20) + '<rect x="8" y="8" width="3" height="5"/><rect x="13" y="8" width="3" height="5"/><rect x="10.5" y="14" width="3" height="5"/>',
  lsm: ctFlatHull(6, 17) + '<rect x="8.5" y="10" width="3" height="5"/><rect x="12.5" y="10" width="3" height="5"/>',
  ls: ctHull(6, 19, 6) + '<rect x="9" y="11" width="6" height="5"/><path d="M9 11l6 5M15 11l-6 5"/>',
  rlct: ctFlatHull(6, 18) + '<path d="M8 9l8-3M8 12l8-3M8 15l8-3"/>', lcs: ctHull(5, 19, 6) + '<circle cx="12" cy="11" r="2.4"/><path d="M12 8.6V4"/><circle cx="12" cy="17" r="1.6"/>',
  sweep: ctHull(4.5, 16, 5) + '<path d="M8 21l-5 2.5M16 21l5 2.5" stroke-dasharray="1.5 1.5"/>',
  dd: ctHull(4, 21, 6) + '<circle cx="12" cy="10" r="1.6"/><circle cx="12" cy="17" r="1.6"/>', ddh: ctHull(4.5, 21, 6) + '<circle cx="12" cy="9.5" r="1.8"/><circle cx="12" cy="14" r="1.4"/><circle cx="12" cy="18" r="1.8"/>',
  dde: ctHull(3.5, 17, 5) + '<circle cx="12" cy="12" r="1.5"/>', cl: ctHull(5.5, 22, 7) + '<circle cx="12" cy="9" r="2"/><circle cx="12" cy="14" r="2"/><circle cx="12" cy="19" r="2"/>',
  ca: ctHull(6, 22, 7) + '<rect x="10" y="7" width="4" height="3"/><rect x="10" y="11.5" width="4" height="3"/><rect x="10" y="16" width="4" height="3"/><path d="M7 21h10"/>',
  cv: CT_AIR.cv || '<path d="M10 2h4l2 3v15.5l-1 1.5H9l-1-1.5V16l-2.5-1.5v-4L8 9V5z"/>',
  cve: '<path d="M10 4h4l1.5 3v13l-1 1.5h-5l-1-1.5V7z"/><path d="M10 8v9" stroke-dasharray="1.5 1.5"/>',
  arecon: CT_AIR.recon || '<path d="M12 2v19M2.5 11.5L12 10l9.5 1.5M8.5 20.5L12 19l3.5 1.5"/>',
  astrike: CT_AIR.strike || '<path d="M12 2l1.6 5 7.4 7v2l-7.4-2.6-.4 5 2.8 2v1.6L12 21l-4 1.4v-1.6l2.8-2-.4-5L3 16v-2l7.4-7z"/>',
  acas: CT_AIR.cas || '<path d="M12 3v17M3 10.5h18M7.5 20h9"/>',
  heavy: '<path d="M12 2v20M1.5 11h21M8 21h8"/><path d="M5 11v3M9 11v3M15 11v3M19 11v3"/>', heli: '<path d="M2 6h20M12 6v4"/><ellipse cx="12" cy="13" rx="3.5" ry="4"/><path d="M12 17v5M9 21h6"/>',
  reserve: '<path class="f" d="M12 3l6 7-6 7-6-7z"/><path d="M5 21h14"/>', rline: '<path d="M4 20L18 6" stroke-dasharray="2.5 3"/><path d="M12 5h7v7"/>',
  smoke: '<path d="M7 18a4 4 0 010-8 5 5 0 019.5-1.5A4 4 0 1117 18z"/>', relay: '<path d="M12 22V9M8 22h8M12 9l-5-6M12 9l5-6"/><path d="M5 13a8 8 0 0 1 0-8M19 13a8 8 0 0 0 0-8"/>',
  depot: '<rect x="4" y="11" width="16" height="10"/><path d="M4 15h16M12 11v10M12 11V2l6 2.5-6 2.5"/>', deck: '<path d="M3 20h18M6 20l2-5h8l2 5"/><path d="M12 3v9M7 8l5-2 5 2"/>',
  srecon: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  sbomb: '<path d="M12 3v4"/><ellipse cx="12" cy="13" rx="4" ry="6"/><path d="M9 20l-2 2M15 20l2 2M12 19v3"/>',
  snaval: '<path d="M4 20L17 7"/><path d="M15 3l6 6M12 21a3 3 0 0 1 6 0"/><circle class="f" cx="18" cy="6" r="1.4"/>',
  // v7：单兵防空导弹、战术导弹、发射车、岸舰导弹、野战机场、守军攻击机 / 武装直升机
  manpads: '<circle cx="9" cy="6.5" r="2.2"/><path d="M9 8.8v6.7M6 21l3-5.5 3 5.5M9 11.5l4.5-1.2"/><path d="M3.5 10.5L20 4.5" stroke-width="2.4"/><path d="M20.5 2.5l1.2 3.3"/>',
  emanpads: CT_HELM + '<path d="M3 20.5l17-5.5" stroke-width="2.4"/><path d="M20.5 13l1 3.2"/>',
  tbm: '<path d="M12 1.5l3 5v10.5l2.5 2.5v2.5h-11V19.5L9 17V6.5z"/><path d="M9 10.5h6"/><path d="M10.5 23h3" stroke-dasharray="1 1"/>',
  tel: '<rect x="2" y="15" width="20" height="4" rx=".6"/><circle cx="6" cy="20.6" r="1.4"/><circle cx="12" cy="20.6" r="1.4"/><circle cx="18" cy="20.6" r="1.4"/><path d="M7 14.5L19 4l1.6 1.8L9 16"/><path d="M5 15V11h3"/>',
  ascm: '<rect x="2" y="15" width="20" height="4" rx=".6"/><circle cx="6" cy="20.6" r="1.4"/><circle cx="18" cy="20.6" r="1.4"/><path d="M4 12.5L19 6.5M5.5 15L20.5 9"/><path d="M19 6.5l1.5 2.5"/>',
  airfield: '<rect x="2" y="9.5" width="20" height="5" rx=".6"/><path d="M4.5 12h3M10.5 12h3M16.5 12h3"/><path d="M3 21.5a4 3 0 0 1 8 0z"/><path d="M15 2.5l2.5 4.5M13 4.5l4.5-.5"/>',
  ega: '<path d="M12 2l1.8 6.5 7.2 7.5v2l-7.2-2.8-.4 3.3 2.6 2v1.5L12 20.5l-4 1.5v-1.5l2.6-2-.4-3.3L3 18v-2l7.2-7.5z"/><path d="M6 13.5v3.5M18 13.5v3.5"/>',
  eheli: '<path d="M2 5.5h20M12 5.5v4"/><ellipse cx="12" cy="13" rx="3.5" ry="4"/><path d="M12 17v5M9 21.5h6M4 14h4.5M15.5 14H20"/>'
};

// —— 条目 —— e(id, 名称, 阵营, 分类, 原型, 点数, 图标, [耐久, 装甲, 火力, 射程, 速度, 视野, 人数], 说明, spawn, 附加)
const CATALOG = [];
function ctE(id, name, side, cat, arch, cost, icon, st, desc, spawn, extra) {
  const [hp, armor, firepower, range, speed, sight, men] = st;
  CATALOG.push({ id, name, side, cat, arch, cost, icon, stats: { hp, armor, firepower, range, speed, sight, men }, desc, spawn, ...extra });
}

// ———— 进攻方 · 登陆步兵（装载到登陆舰，抢滩后按此编成下船；每条 = 1 个小组）————
ctE('p_rifle', '步枪组', 'p', 'inf', 'inf_p', 10, CT_IC.rifle, [3, 0, 3, 5, 5, 6, 3], '标准三人突击组：通讯兵、步枪手、机枪手，攻守均衡，是滩头兵力的骨干。怕炮火与碉堡交叉火力。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'mg'] }, { counters: ['inf_e'], weakTo: ['bunker', 'arty'] });
ctE('p_mg', '机枪组', 'p', 'inf', 'inf_p', 13, CT_IC.mg + ctDots(1), [3, 0, 4, 6, 4, 6, 3], '双机枪火力组，压制能力强，掩护友军前进；精度一般，移动慢时最有用。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'mg', 'mg'], mod: { sup: 1.35, pow: .9 } }, { counters: ['inf_e'], weakTo: ['mortar', 'arty'] });
ctE('p_marine', '陆战突击组', 'p', 'inf', 'inf_p', 14, CT_IC.marine, [3, 0, 5, 5, 6, 6, 3], '经过抢滩训练的陆战队员，射速与命中更高、士气坚韧；价格稍贵。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'mg'], mod: { pow: 1.15, rof: 1.15 }, morale: 90 }, { counters: ['inf_e', 'p_rifle'], weakTo: ['bunker'] });
ctE('p_ranger', '游骑兵组', 'p', 'inf', 'inf_p', 18, CT_IC.ranger, [3, 0, 6, 6, 6, 7, 3], '精锐突击队，射程与精度俱佳，最不容易溃退，适合攻打岸防炮台等要点。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'mg'], mod: { pow: 1.3, rng: 1.1, rof: 1.1 }, morale: 98 }, { counters: ['coastal', 'inf_e'], weakTo: ['arty'] });
ctE('p_sniper', '狙击小组', 'p', 'inf', 'inf_p', 14, CT_IC.sniper, [2, 0, 4, 9, 5, 8, 2], '两人狙击组：远距离精确射杀机枪手与通讯兵，压制力弱、怕被炮火覆盖。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle'], mod: { pow: 2.2, rng: 1.7, rof: .55, sup: .5 } }, { counters: ['inf_e'], weakTo: ['mortar'] });
ctE('p_at', '反坦克火箭组', 'p', 'inf', 'inf_p', 15, CT_IC.at, [3, 0, 3, 4, 5, 5, 3], '携带火箭筒，专打装甲车辆与坦克；对步兵火力偏弱。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'rifle'], mod: { at: 1.5, pow: .85 } }, { counters: ['veh', 'car_e'], weakTo: ['inf_e', 'mortar'] });
ctE('p_flame', '喷火组', 'p', 'inf', 'inf_p', 16, CT_IC.flame, [3, 0, 7, 2, 5, 5, 3], '近距离喷火，压制与杀伤极强，贴近碉堡后还能直接烧毁工事；射程很短，接近途中伤亡大。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'rifle'], mod: { rng: .45, sup: 2.6, pow: 1.7 }, tag: 'flame' }, { counters: ['bunker', 'trench'], weakTo: ['e_mg_nest', 'e_ambush'] });
ctE('p_eng', '战斗工兵组', 'p', 'inf', 'eng_p', 12, CT_IC.eng, [3, 0, 1, 2, 5, 4, 3], '排除雷区、剪开铁丝网、修建补给网；本身几乎没有火力，需要步兵掩护。',
  { kind: 'cargo', at: 'cargo', men: ['eng', 'eng', 'eng'], eng: true }, { counters: ['mines', 'wire'], weakTo: ['inf_e', 'mortar'] });
ctE('p_demo', '爆破突击组', 'p', 'inf', 'eng_p', 16, CT_IC.demo, [3, 0, 5, 1, 5, 4, 3], '携带炸药包的突击工兵：摸到碉堡 25 以内即可爆破，是拔除火力点的利器。',
  { kind: 'cargo', at: 'cargo', men: ['rifle', 'eng', 'rifle'], tag: 'demo' }, { counters: ['bunker', 'coastal'], weakTo: ['e_mg_nest'] });
ctE('p_medic', '卫生组', 'p', 'inf', 'inf_p', 12, CT_IC.medic, [3, 0, 1, 4, 5, 5, 3], '随队卫生员：附近连队士气恢复更快、更难溃退；自身火力很弱。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'rifle'], mod: { pow: .6 }, tag: 'medic' }, { weakTo: ['arty'] });
ctE('p_fo', '前进观察组', 'p', 'inf', 'inf_p', 14, CT_IC.fo, [3, 0, 1, 4, 5, 9, 3], '双电台观察组：视野远超普通小组，为舰炮、航空兵和自动指挥提供目标。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'radio', 'rifle'], mod: { pow: .7 }, tag: 'fo' }, { counters: ['arty', 'mortar'], weakTo: ['inf_e'] });
ctE('p_mortar', '连属迫击炮组', 'p', 'inf', 'inf_p', 18, CT_IC.pmortar, [3, 0, 5, 7, 4, 5, 3], '随登陆连上岸的轻迫击炮：对 380 以内看得见的敌人与工事间接射击，压制碉堡与机枪阵地。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'rifle'], mod: { pow: .6 }, tag: 'mortar' }, { counters: ['inf_e', 'trench'], weakTo: ['arty'] });
ctE('p_hq', '营部指挥组', 'p', 'inf', 'inf_p', 16, CT_IC.hq, [3, 0, 2, 4, 5, 7, 3], '营指挥所：150 内的连队士气稳定、压制恢复更快；被打掉会让附近部队动摇。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'radio', 'rifle'], tag: 'hq' }, { weakTo: ['e_sniper', 'arty'] });
ctE('p_manpads', '便携防空导弹组', 'p', 'inf', 'inf_p', 18, CT_IC.manpads, [3, 0, 2, 7, 5, 6, 3], '肩扛式防空导弹（每组 3 枚）：230–260 内击落低飞的敌攻击机与武装直升机，补给点附近每分钟补 1 枚；对地火力弱。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'aa'], mod: { pow: .8 }, tag: 'manpads' }, { counters: ['e_air_ga', 'e_air_heli'], weakTo: ['inf_e', 'mortar'] });

// ———— 进攻方 · 装甲（两栖车辆在集结海域自行泅渡；其余装载到坦克登陆舰）————
ctE('p_lt_tank', '轻型坦克', 'p', 'armor', 'veh', 30, CT_IC.lt, [4, 2, 4, 5, 8, 6, 4], '机动快、价格低，可伴随步兵扫清机枪火力点；装甲薄，怕反坦克炮。',
  { kind: 'veh', at: 'vcargo', type: 'lt_tank' }, { counters: ['inf_e', 'car_e'], weakTo: ['e_at_casemate', 'e_at'] });
ctE('p_tank', '中型坦克', 'p', 'armor', 'veh', 45, CT_IC.tank, [6, 3, 6, 6, 6, 6, 5], '主力坦克，攻防均衡，能正面摧毁碉堡、碾压守军步兵；需步兵贴身保护以防近战反坦克。',
  { kind: 'veh', at: 'vcargo', type: 'tank' }, { counters: ['bunker', 'inf_e'], weakTo: ['e_at_casemate', 'coastal'] });
ctE('p_tank76', '中型坦克（长身管）', 'p', 'armor', 'veh', 52, CT_IC.tank76, [6, 3, 7, 7, 6, 6, 5], '换装长身管火炮的中型坦克，穿甲与射程提升，适合对付守军坦克。',
  { kind: 'veh', at: 'vcargo', type: 'tank', mod: { pow: 1.2, rng: 1.15 } }, { counters: ['e_tank', 'car_e'], weakTo: ['e_at_casemate'] });
ctE('p_hv_tank', '重型坦克', 'p', 'armor', 'veh', 70, CT_IC.hv, [9, 4, 8, 6, 3, 5, 5], '厚重装甲几乎免疫轻型火炮，主炮可一两发拆毁碉堡；速度慢、过桥与沼泽困难。',
  { kind: 'veh', at: 'vcargo', type: 'hv_tank' }, { counters: ['bunker', 'e_tank'], weakTo: ['coastal', 'mines'] });
ctE('p_amtank', '两栖坦克', 'p', 'armor', 'veh', 40, CT_IC.amt, [5, 2, 5, 5, 5, 5, 4], '可从集结海域自行泅渡上滩，与第一波同时登陆提供直射火力；水上行动缓慢、易被岸炮击中。',
  { kind: 'veh', at: 'sea', type: 'amtank' }, { counters: ['bunker', 'inf_e'], weakTo: ['coastal', 'obst'] });
ctE('p_amtank_how', '两栖火力支援车', 'p', 'armor', 'veh', 42, CT_IC.amh, [5, 2, 6, 5, 5, 5, 4], '短身管榴弹炮型两栖车，榴弹威力更大、射速稍慢，专门支援滩头步兵。',
  { kind: 'veh', at: 'sea', type: 'amtank', mod: { pow: 1.3, rof: .8 } }, { counters: ['bunker', 'trench'], weakTo: ['coastal'] });
ctE('p_apc', '装甲运兵车', 'p', 'armor', 'veh', 28, CT_IC.apc, [5, 2, 2, 4, 7, 5, 2], '把步兵从滩头快速输送到前线，随后以车载机枪支援；没有主炮。',
  { kind: 'veh', at: 'vcargo', type: 'apc' }, { counters: ['inf_e'], weakTo: ['e_at', 'veh'] });
ctE('p_ifv', '步兵战车', 'p', 'armor', 'veh', 36, CT_IC.ifv, [5, 2, 4, 5, 7, 5, 2], '加装小口径机关炮的运兵车，火力更强，能压制机枪阵地。',
  { kind: 'veh', at: 'vcargo', type: 'apc', mod: { pow: 1.5, rof: 1.3 } }, { counters: ['inf_e', 'car_e'], weakTo: ['e_at'] });
ctE('p_spg', '自行火炮', 'p', 'armor', 'veh', 50, CT_IC.spg, [4, 1, 7, 9, 5, 4, 4], '上岸后对已知目标间接射击，射程约 600；装甲薄，不宜靠前。',
  { kind: 'veh', at: 'vcargo', type: 'spg' }, { counters: ['arty', 'bunker', 'mortar'], weakTo: ['inf_e', 'car_e'] });
ctE('p_td', '坦克歼击车', 'p', 'armor', 'veh', 48, CT_IC.td, [5, 3, 7, 8, 6, 5, 4], '高初速反坦克炮，专门猎杀装甲目标；对步兵与工事效果一般。',
  { kind: 'veh', at: 'vcargo', type: 'td' }, { counters: ['e_tank', 'e_hv_tank', 'car_e'], weakTo: ['inf_e', 'arty'] });
ctE('p_aa_veh', '自行高炮', 'p', 'armor', 'veh', 35, CT_IC.aav, [4, 1, 6, 5, 6, 5, 4], '四联装机枪 / 高射炮，对步兵毁灭性压制；装甲薄。',
  { kind: 'veh', at: 'vcargo', type: 'aa_veh' }, { counters: ['inf_e'], weakTo: ['e_at_casemate', 'arty'] });
ctE('p_recon', '侦察装甲车', 'p', 'armor', 'veh', 22, CT_IC.rcn, [3, 1, 2, 4, 9, 9, 3], '轮式侦察车：速度快、视野远，用来发现纵深火力点；一碰就伤。',
  { kind: 'veh', at: 'vcargo', type: 'recon' }, { counters: ['arty', 'mortar'], weakTo: ['bunker', 'e_at'] });
ctE('p_flame_tank', '喷火坦克', 'p', 'armor', 'veh', 50, CT_IC.flt, [6, 3, 8, 2, 5, 5, 4], '近距离喷火，对碉堡与堑壕极具毁灭性；射程很短，必须抵近。',
  { kind: 'veh', at: 'vcargo', type: 'flame_tank' }, { counters: ['bunker', 'trench', 'inf_e'], weakTo: ['e_at_casemate', 'coastal'] });
ctE('p_mine_tank', '扫雷坦克', 'p', 'armor', 'veh', 46, CT_IC.mnt, [6, 3, 3, 4, 4, 5, 4], '车前滚压装置引爆地雷，为后续部队开出安全通路。',
  { kind: 'veh', at: 'vcargo', type: 'mine_tank' }, { counters: ['mines'], weakTo: ['e_at_casemate'] });
ctE('p_dozer', '工程坦克（推土铲）', 'p', 'armor', 'veh', 44, CT_IC.dozer, [6, 3, 2, 3, 4, 5, 4], '推土铲清除障碍物与铁丝网、也能扫雷，打通滩头出口。',
  { kind: 'veh', at: 'vcargo', type: 'mine_tank', mod: { pow: .7 }, tag: 'dozer' }, { counters: ['obst', 'wire'], weakTo: ['e_at_casemate'] });

// ———— 进攻方 · 舰艇 ————
ctE('p_lct', '突击登陆艇 LCT', 'p', 'naval', 'ship', 20, CT_IC.lct, [5, 1, 0, 0, 5, 3, 10], '标准突击登陆艇，可装载 5 个小组；首波抢滩主力。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 5, hp: 10, pre: 'LA', def: ['p_rifle', 'p_rifle', 'p_mg', 'p_at', 'p_eng'] }, { weakTo: ['coastal', 'obst', 'bunker'] });
ctE('p_lci', '步兵登陆舰 LCI', 'p', 'naval', 'ship', 28, CT_IC.lci, [6, 1, 0, 0, 5, 3, 10], '载 8 个小组的较大舰艇，一次送上一个加强连；目标大，抢滩时更招火。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 8, hp: 12, pre: 'LI', def: ['p_hq', 'p_rifle', 'p_rifle', 'p_rifle', 'p_mg', 'p_mg', 'p_at', 'p_medic'] }, { weakTo: ['coastal', 'obst'] });
ctE('p_lcvp', '小型登陆艇 LCVP', 'p', 'naval', 'ship', 12, CT_IC.lcvp, [3, 0, 0, 0, 6, 3, 9], '只载 3 个小组的小艇，便宜、目标小，适合佯攻与分散登陆。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 3, hp: 6, pre: 'LV', def: ['p_rifle', 'p_rifle', 'p_mg'] }, { weakTo: ['bunker', 'obst'] });
ctE('p_lst', '坦克登陆舰 LST', 'p', 'naval', 'ship', 35, CT_IC.lst, [8, 1, 0, 0, 4, 3, 0], '抢滩后放下首门，把装载的坦克与装甲车逐辆开上岸（最多 3 辆）；建议作为第二波。',
  { kind: 'ship', at: 'sea', ship: 'lst', vcap: 3, hp: 16, pre: 'LT', wave: 2, def: ['p_tank', 'p_tank', 'p_apc'] }, { weakTo: ['coastal'] });
ctE('p_lsm', '中型登陆舰 LSM', 'p', 'naval', 'ship', 30, CT_IC.lsm, [6, 1, 0, 0, 5, 3, 6], '载 2 辆车与 2 个小组的中型登陆舰，兼顾人员与装甲。',
  { kind: 'ship', at: 'sea', ship: 'lst', vcap: 2, cap: 2, hp: 13, pre: 'LM', wave: 2, def: ['p_tank', 'p_apc', 'p_rifle', 'p_mg'] }, { weakTo: ['coastal'] });
ctE('p_supply', '补给登陆舰', 'p', 'naval', 'ship', 30, CT_IC.ls, [6, 1, 0, 0, 4, 3, 10], '自带 4 个小组与 3 名工兵：抢滩后建立滩头补给站与浮桥补给线，为附近部队补充弹药、恢复士气。',
  { kind: 'ship', at: 'sea', ship: 'supply', teams: 4, eng: 3, hp: 11, pre: 'LS', wave: 2 }, { weakTo: ['arty', 'coastal'] });
ctE('p_supply_h', '补给舰（加固）', 'p', 'naval', 'ship', 38, CT_IC.ls + ctDots(1), [8, 2, 0, 0, 4, 3, 10], '加装装甲与损管的补给舰，更能扛住岸炮，补给站更稳。',
  { kind: 'ship', at: 'sea', ship: 'supply', teams: 4, eng: 3, hp: 16, pre: 'LS', wave: 2 }, { weakTo: ['coastal'] });
ctE('p_rocket', '火箭登陆艇 LCT(R)', 'p', 'naval', 'fire_ship', 40, CT_IC.rlct, [4, 1, 9, 6, 5, 3, 0], '开战后驶近目标滩头，一次齐射数十枚火箭覆盖滩头阵地；只能齐射两轮。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 0, hp: 8, pre: 'LR', role: 'rocket' }, { counters: ['inf_e', 'wire', 'mines'], weakTo: ['coastal'] });
ctE('p_lcs', '火力支援艇 LCS', 'p', 'naval', 'fire_ship', 32, CT_IC.lcs, [5, 1, 5, 5, 6, 4, 0], '近岸游弋的炮艇，持续以 40 毫米炮射击滩头 350 内看得见的敌人。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 0, hp: 9, pre: 'GS', role: 'gun' }, { counters: ['inf_e', 'bunker'], weakTo: ['coastal'] });
ctE('p_sweep', '扫雷舰', 'p', 'naval', 'sweep', 30, CT_IC.sweep, [4, 1, 0, 0, 5, 4, 0], '驶往目标滩头近岸，清除水下障碍并标定滩头雷区，为登陆艇开辟航道。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 0, hp: 8, pre: 'MS', role: 'sweep' }, { counters: ['obst', 'mines'], weakTo: ['coastal'] });
ctE('p_dd', '驱逐舰', 'p', 'naval', 'dd', 120, CT_IC.dd, [6, 3, 7, 9, 7, 5, 0], '标准驱逐舰：舰炮射程 1000，可打烟幕弹；开火时会暴露位置招来反炮兵射击。全舰队只能编入一艘驱护舰或巡洋舰。',
  { kind: 'dd', at: 'sea', hull: 3, rof: 1, salvo: 1, rep: 16 }, { counters: ['bunker', 'coastal'], weakTo: ['coastal'] });
ctE('p_dd_h', '重型驱逐舰', 'p', 'naval', 'dd', 150, CT_IC.ddh, [7, 3, 8, 9, 7, 5, 0], '多一座炮塔、射速更快，船体能多扛一发。',
  { kind: 'dd', at: 'sea', hull: 4, rof: 1.3, salvo: 1, rep: 15 }, { counters: ['bunker', 'coastal'], weakTo: ['coastal'] });
ctE('p_dd_e', '护航驱逐舰', 'p', 'naval', 'dd', 90, CT_IC.dde, [4, 2, 5, 9, 8, 5, 0], '便宜的护航舰，火力较弱、损管快，额外携带 2 发烟幕弹。',
  { kind: 'dd', at: 'sea', hull: 2, rof: .85, salvo: 1, rep: 10, smoke: 2, hit: .8 }, { weakTo: ['coastal'] });
ctE('p_cl', '轻巡洋舰', 'p', 'naval', 'dd', 200, CT_IC.cl, [8, 4, 9, 9, 6, 6, 0], '每次射击两发齐射，船体 5，能长时间压制滩头；仍会被岸防重炮威胁。',
  { kind: 'dd', at: 'sea', hull: 5, rof: .9, salvo: 2, rep: 18, hit: 1.1 }, { counters: ['coastal', 'bunker', 'arty'], weakTo: ['coastal'] });
ctE('p_ca', '重巡洋舰', 'p', 'naval', 'dd', 260, CT_IC.ca, [10, 5, 10, 9, 5, 6, 0], '三发齐射的重炮舰，船体 6；昂贵但足以单舰拔除一整段岸防。',
  { kind: 'dd', at: 'sea', hull: 6, rof: .75, salvo: 3, rep: 20, hit: 1.2 }, { counters: ['coastal', 'bunker', 'arty'] });
ctE('p_cv', '舰队航母', 'p', 'air', 'cv', 150, CT_IC.cv, [9, 2, 0, 0, 3, 5, 0], '搭载最多 12 架舰载机；没有航母就没有空中支援。甲板中弹会影响起降。',
  { kind: 'cv', at: 'sea', hp: 30, wing: 12 }, { weakTo: ['coastal'] });
ctE('p_cve', '护航航母', 'p', 'air', 'cv', 90, CT_IC.cve, [6, 1, 0, 0, 3, 5, 0], '小型航母，最多 6 架舰载机，甲板更脆弱。',
  { kind: 'cv', at: 'sea', hp: 18, wing: 6 }, { weakTo: ['coastal'] });

// ———— 进攻方 · 舰载机（需要航母，无需位置）————
ctE('p_air_recon', '侦察机', 'p', 'air', 'wing', 15, CT_IC.arecon, [2, 0, 0, 0, 9, 10, 0], '纵贯飞越敌岸照相侦察，揭示火力点；易被高炮击落。',
  { kind: 'wing', at: 'air', type: 'recon', n: 1 }, { counters: ['arty', 'coastal'], weakTo: ['aa'] });
ctE('p_air_recon_lr', '远程侦察机', 'p', 'air', 'wing', 20, CT_IC.arecon + ctDots(1), [3, 0, 0, 0, 9, 10, 0], '高空远程侦察，照相成果保留更久、覆盖更宽。',
  { kind: 'wing', at: 'air', type: 'recon', n: 1, v: 'lr' }, { counters: ['arty', 'coastal'], weakTo: ['e_aa_radar'] });
ctE('p_air_strike', '攻击机', 'p', 'air', 'wing', 22, CT_IC.astrike, [3, 0, 7, 0, 8, 4, 0], '沿进场方向投下三连弹，可摧毁已标定的炮位与碉堡。',
  { kind: 'wing', at: 'air', type: 'strike', n: 1 }, { counters: ['coastal', 'arty', 'bunker'], weakTo: ['aa'] });
ctE('p_air_dive', '俯冲轰炸机', 'p', 'air', 'wing', 26, CT_IC.astrike + ctDots(1), [3, 0, 8, 0, 8, 4, 0], '轰炸机（Y 键）。对点目标俯冲，投下两枚重磅炸弹，几乎正中岸防炮、碉堡；俯冲时更容易被高炮打中。',
  { kind: 'wing', at: 'air', type: 'bomber', n: 1, v: 'dive' }, { counters: ['coastal', 'bunker'], weakTo: ['aa'] });
ctE('p_air_heavy', '重型轰炸机', 'p', 'air', 'wing', 34, CT_IC.heavy, [4, 0, 10, 0, 6, 3, 0], '轰炸机（Y 键）。沿进场方向投下六枚重磅炸弹地毯轰炸，覆盖炮兵阵地群与堑壕；飞得高，轻型高炮不易打中；散布大，离我军 150 以内慎用。',
  { kind: 'wing', at: 'air', type: 'bomber', n: 1, v: 'heavy' }, { counters: ['arty', 'trench', 'wire'], weakTo: ['e_aa_heavy'] });
ctE('p_air_cas', '对地支援机', 'p', 'air', 'wing', 22, CT_IC.acas, [3, 0, 6, 0, 8, 5, 0], '在受压制的我军上空盘旋扫射，持续约 40 秒。',
  { kind: 'wing', at: 'air', type: 'cas', n: 1 }, { counters: ['inf_e', 'mortar'], weakTo: ['aa'] });
ctE('p_air_fb', '战斗轰炸机', 'p', 'air', 'wing', 28, CT_IC.acas + ctDots(1), [3, 0, 7, 0, 9, 5, 0], '到场先投一枚炸弹再扫射，盘旋时间较短。',
  { kind: 'wing', at: 'air', type: 'cas', n: 1, v: 'fb' }, { counters: ['inf_e', 'bunker'], weakTo: ['aa'] });
ctE('p_air_heli', '武装直升机', 'p', 'air', 'wing', 30, CT_IC.heli, [3, 1, 6, 0, 5, 6, 0], '低空悬停时间长达 70 秒，扫射压制更强；速度慢。',
  { kind: 'wing', at: 'air', type: 'cas', n: 1, v: 'heli' }, { counters: ['inf_e', 'mortar'], weakTo: ['aa', 'e_aa_heavy'] });

// ———— 进攻方 · 支援 ————
ctE('p_reserve', '后备步兵（3 组）', 'p', 'support', 'asset', 24, CT_IC.reserve, [0, 0, 3, 0, 0, 0, 9], '后方待命的预备队，经增援线乘艇上岸。需要至少一条增援线。',
  { kind: 'asset', at: 'none', key: 'reserve', add: 3 }, {});
ctE('p_rline', '增援线额度', 'p', 'support', 'asset', 15, CT_IC.rline, [0, 0, 0, 0, 0, 0, 0], '多开辟一条从后方到滩头的增援航线（基础 1 条）。',
  { kind: 'asset', at: 'none', key: 'rline', add: 1 }, {});
ctE('p_smoke', '烟幕弹（3 发）', 'p', 'support', 'asset', 12, CT_IC.smoke, [0, 0, 0, 9, 0, 0, 0], '舰炮烟幕弹，遮断双方视线，掩护抢滩与冲击。',
  { kind: 'asset', at: 'none', key: 'smoke', add: 3 }, { counters: ['bunker', 'coastal'] });
ctE('p_relay', '无线电中继', 'p', 'support', 'asset', 25, CT_IC.relay, [0, 0, 0, 0, 0, 0, 0], '舰队通信中继：通讯兵阵亡后命令仍能传达，减少指挥失误。',
  { kind: 'flag', at: 'none', key: 'relay' }, {});
ctE('p_depot', '野战补给站', 'p', 'support', 'asset', 30, CT_IC.depot, [3, 0, 0, 0, 0, 0, 0], '预制的前沿补给点：首艘补给舰抢滩后立即在滩头出口建成，无需工兵施工。',
  { kind: 'flag', at: 'none', key: 'depot' }, {});
ctE('p_deck', '甲板整备队', 'p', 'support', 'asset', 20, CT_IC.deck, [0, 0, 0, 0, 0, 0, 0], '加强航母整备：舰载机着舰后重新出击的整备时间缩短 40%。',
  { kind: 'flag', at: 'none', key: 'deck' }, {});
ctE('p_tbm', '战术导弹（2 枚）', 'p', 'support', 'missile', 60, CT_IC.tbm, [0, 0, 10, 10, 0, 0, 0], '战术弹道导弹：驱逐舰垂直发射（无驱逐舰时由战区导弹部队发射），约 6–8 秒命中，一发可摧毁碉堡或岸防炮；雷达高炮可能拦截。快捷键 I。',
  { kind: 'asset', at: 'none', key: 'msl', add: 2 }, { counters: ['coastal', 'e_tel', 'e_ascm', 'e_airfield'], weakTo: ['e_aa_radar'] });
ctE('p_sortie_recon', '战前空中侦察', 'p', 'support', 'sortie', 15, CT_IC.srecon, [0, 0, 0, 0, 0, 9, 0], '开战时对指定地点照相侦察 30 秒，半径约 160。',
  { kind: 'sortie', at: 'target', t: 'recon', r: 160 }, { counters: ['coastal', 'arty'] });
ctE('p_sortie_bomb', '战前轰炸', 'p', 'support', 'sortie', 35, CT_IC.sbomb, [0, 0, 8, 0, 0, 0, 0], '开战后 6 秒内对指定地点投下 8 枚炸弹；看不见的目标也会被覆盖，但散布较大。',
  { kind: 'sortie', at: 'target', t: 'bomb', n: 8 }, { counters: ['bunker', 'wire', 'mines'] });
ctE('p_sortie_naval', '舰炮火力准备', 'p', 'support', 'sortie', 30, CT_IC.snaval, [0, 0, 7, 0, 0, 0, 0], '开战后 3–15 秒，外海舰队对指定地点进行 6 发舰炮覆盖射击。',
  { kind: 'sortie', at: 'target', t: 'naval', n: 6 }, { counters: ['bunker', 'trench'] });

// ———— 防守方 · 步兵（放在陆上；按最近据点编入守备、预备或伏击）————
ctE('e_garrison', '守备步兵排', 'e', 'inf', 'inf_e', 24, CT_IC.egar, [5, 0, 4, 5, 3, 6, 9], '三个三人组，就近守备据点并利用掩体；据点受威胁时坚守或反击。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 3, men: ['rifle', 'rifle', 'mg'] }, { counters: ['p_rifle'], weakTo: ['p_flame', 'veh', 'arty'] });
ctE('e_mg_nest', '机枪班', 'e', 'inf', 'inf_e', 22, CT_IC.emg, [4, 0, 5, 6, 2, 6, 6], '两挺机枪的火力班，压制能力强，专封滩头出口。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 2, men: ['mg', 'mg', 'rifle'], mod: { sup: 1.3 } }, { counters: ['p_rifle', 'p_marine'], weakTo: ['p_mortar', 'veh'] });
ctE('e_ambush', '滩头伏击组', 'e', 'inf', 'inf_e', 18, CT_IC.eamb, [4, 0, 4, 4, 3, 5, 6], '潜伏在滩顶堑壕，敌人上滩到 80 以内才开火；被压倒时撤向出口据点。',
  { kind: 'einf', at: 'land', role: 'ambush', teams: 2, men: ['rifle', 'rifle', 'mg'] }, { counters: ['p_eng', 'p_rifle'], weakTo: ['arty', 'p_rocket'] });
ctE('e_reserve', '机动预备队', 'e', 'inf', 'inf_e', 28, CT_IC.eres, [5, 0, 4, 5, 4, 6, 9], '驻扎在镇子或路口，由守军指挥官调往压力最大的据点。',
  { kind: 'einf', at: 'land', role: 'reserve', teams: 3, men: ['rifle', 'rifle', 'mg'] }, { counters: ['p_rifle'], weakTo: ['p_air_cas', 'veh'] });
ctE('e_assault', '反击突击连', 'e', 'inf', 'inf_e', 40, CT_IC.easlt, [7, 0, 6, 5, 4, 6, 10], '四个精锐小组，士气高、射击准，用于夺回失守的据点。',
  { kind: 'einf', at: 'land', role: 'reserve', teams: 4, men: ['rifle', 'mg', 'mg'], mod: { pow: 1.15 }, morale: 92 }, { counters: ['p_rifle', 'p_eng'], weakTo: ['p_air_cas', 'arty'] });
ctE('e_sniper', '狙击手', 'e', 'inf', 'inf_e', 12, CT_IC.sniper, [2, 0, 4, 9, 3, 8, 2], '两人狙击组，优先射杀通讯兵，令登陆部队视野与指挥中断。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 1, men: ['rifle', 'rifle'], mod: { pow: 2.2, rng: 1.6, rof: .55, sup: .5 } }, { counters: ['p_fo', 'p_hq'], weakTo: ['mortar', 'p_air_cas'] });
ctE('e_at', '反坦克小组', 'e', 'inf', 'inf_e', 20, CT_IC.at, [4, 0, 3, 4, 3, 5, 6], '两个携带反坦克火箭的小组，伏击上岸的坦克与装甲车。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 2, men: ['rifle', 'rifle', 'rifle'], mod: { at: 1.5, pow: .85 } }, { counters: ['veh'], weakTo: ['p_rifle', 'p_mg'] });
ctE('e_militia', '民兵', 'e', 'inf', 'inf_e', 14, CT_IC.emil, [4, 0, 2, 4, 3, 5, 9], '便宜的地方武装，人数多但射击差、容易溃散；适合填充次要据点。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 3, men: ['rifle', 'rifle', 'rifle'], mod: { pow: .65, sup: .8 }, morale: 40 }, { weakTo: ['p_rifle', 'p_mg', 'veh'] });
ctE('e_eng', '守军工兵', 'e', 'inf', 'eng_e', 15, CT_IC.eeng, [3, 0, 2, 4, 3, 5, 3], '抢修 40 以内受损的碉堡与炮位，每秒恢复少量耐久。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 1, men: ['rifle', 'rifle', 'rifle'], mod: { pow: .7 }, tag: 'eeng' }, { weakTo: ['inf_p'] });
ctE('e_manpads', '单兵防空组', 'e', 'inf', 'inf_e', 22, CT_IC.emanpads, [3, 0, 2, 7, 3, 6, 3], '携带 3 枚单兵防空导弹的守备组，专打低空盘旋的对地支援机、俯冲的攻击机与武装直升机；发射即暴露位置。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 1, men: ['rifle', 'rifle', 'aa'], tag: 'manpads' }, { counters: ['p_air_cas', 'p_air_heli', 'p_air_dive'], weakTo: ['inf_p', 'p_mortar'] });

// ———— 防守方 · 装甲 ————
ctE('e_car', '装甲侦察车', 'e', 'armor', 'car_e', 25, CT_IC.ecar, [4, 2, 3, 5, 8, 7, 3], '轮式装甲车：在镇子待命，据点受威胁时驰援，以车载机枪扫射；轻武器打不穿。',
  { kind: 'car', at: 'land' }, { counters: ['p_rifle', 'p_eng'], weakTo: ['p_at', 'p_td', 'p_air_strike'] });
ctE('e_lt_tank', '守军轻型坦克', 'e', 'armor', 'veh', 30, CT_IC.lt, [4, 2, 4, 5, 8, 6, 4], '快速机动的轻坦克，作为预备队反击滩头。',
  { kind: 'veh', at: 'land', type: 'lt_tank' }, { counters: ['inf_p'], weakTo: ['p_at', 'p_td'] });
ctE('e_tank', '守军中型坦克', 'e', 'armor', 'veh', 45, CT_IC.tank, [6, 3, 6, 6, 6, 6, 5], '主力反击坦克，与步兵协同时对登陆部队威胁极大。',
  { kind: 'veh', at: 'land', type: 'tank' }, { counters: ['inf_p', 'p_lt_tank'], weakTo: ['p_td', 'p_air_strike', 'p_dd'] });
ctE('e_hv_tank', '守军重型坦克', 'e', 'armor', 'veh', 72, CT_IC.hv, [9, 4, 8, 6, 3, 5, 5], '重装甲坦克，正面几乎打不穿；行动迟缓，空袭与舰炮是克星。',
  { kind: 'veh', at: 'land', type: 'hv_tank' }, { counters: ['p_tank', 'inf_p'], weakTo: ['p_air_dive', 'p_ca'] });
ctE('e_td', '守军坦克歼击车', 'e', 'armor', 'veh', 48, CT_IC.td, [5, 3, 7, 8, 5, 5, 4], '隐蔽在出口后方，专打上岸的坦克。',
  { kind: 'veh', at: 'land', type: 'td' }, { counters: ['p_tank', 'p_amtank'], weakTo: ['inf_p', 'arty'] });
ctE('e_spg', '守军自行榴弹炮', 'e', 'armor', 'veh', 48, CT_IC.spg, [4, 1, 7, 9, 5, 4, 4], '机动的炮兵：对已发现的目标间接射击，打完就换位。',
  { kind: 'veh', at: 'land', type: 'spg' }, { counters: ['inf_p'], weakTo: ['p_air_strike', 'p_recon'] });
ctE('e_apc', '守军装甲运兵车', 'e', 'armor', 'veh', 28, CT_IC.apc, [5, 2, 2, 4, 7, 5, 2], '车载机枪支援反击，轻武器打不穿。',
  { kind: 'veh', at: 'land', type: 'apc' }, { counters: ['inf_p'], weakTo: ['p_at', 'veh'] });
ctE('e_aa_veh', '守军自行高炮', 'e', 'armor', 'veh', 34, CT_IC.aav, [4, 1, 6, 5, 6, 5, 4], '伴随预备队的机动高炮，也能平射压制步兵。',
  { kind: 'veh', at: 'land', type: 'aa_veh' }, { counters: ['wing', 'inf_p'], weakTo: ['p_tank', 'p_dd'] });
ctE('e_recon', '守军侦察车', 'e', 'armor', 'veh', 22, CT_IC.rcn, [3, 1, 2, 4, 9, 9, 3], '快速侦察，为炮兵指示目标。',
  { kind: 'veh', at: 'land', type: 'recon' }, { counters: ['p_eng'], weakTo: ['p_mg', 'veh'] });
ctE('e_flame_tank', '守军喷火坦克', 'e', 'armor', 'veh', 48, CT_IC.flt, [6, 3, 8, 2, 5, 5, 4], '近距离反击滩头步兵，对挤在一起的登陆部队极其致命。',
  { kind: 'veh', at: 'land', type: 'flame_tank' }, { counters: ['inf_p'], weakTo: ['p_td', 'p_at'] });

// ———— 防守方 · 碉堡与火炮 ————
ctE('e_mg_bunker', '机枪碉堡', 'e', 'fort', 'bunker', 30, CT_IC.bunker, [6, 4, 5, 6, 0, 6, 3], '钢筋混凝土机枪堡，覆盖 170 以内的滩头；只怕舰炮、炸弹与爆破。碉堡未拔除前据点无法占领。',
  { kind: 'enemy', at: 'land', ek: 'bunker', hp: 1 }, { counters: ['inf_p', 'p_lct'], weakTo: ['p_flame', 'p_demo', 'p_dd', 'p_tank'] });
ctE('e_casemate', '重型掩体', 'e', 'fort', 'bunker', 45, CT_IC.casemate, [9, 6, 6, 6, 0, 6, 4], '厚重掩体，耐久翻倍、火力更猛，射速略慢。',
  { kind: 'enemy', at: 'land', ek: 'bunker', hp: 2, mod: { pow: 1.2, rof: .9 } }, { counters: ['inf_p'], weakTo: ['p_ca', 'p_air_heavy', 'p_demo'] });
ctE('e_at_casemate', '反坦克炮掩体', 'e', 'fort', 'bunker', 40, CT_IC.atcas, [7, 5, 4, 8, 0, 6, 3], '藏在掩体里的反坦克炮，射程远、专打装甲车辆与登陆艇；对步兵杀伤一般。',
  { kind: 'enemy', at: 'land', ek: 'bunker', hp: 1.5, mod: { at: 1.4, rng: 1.3, pow: .6 } }, { counters: ['veh', 'p_lct'], weakTo: ['inf_p', 'p_dd'] });
ctE('e_pillbox', '小型碉堡', 'e', 'fort', 'bunker', 18, CT_IC.pillbox, [4, 3, 4, 5, 0, 5, 2], '便宜的混凝土小堡，耐久与射程较低，用来补全交叉火力。',
  { kind: 'enemy', at: 'land', ek: 'bunker', hp: .65, mod: { rng: .85 } }, { counters: ['inf_p'], weakTo: ['p_flame', 'veh'] });
ctE('e_flak_tower', '高射炮塔', 'e', 'fort', 'aa', 45, CT_IC.flak, [9, 5, 5, 6, 0, 5, 4], '钢筋混凝土高炮塔，耐久极高，持续威胁舰载机。',
  { kind: 'enemy', at: 'land', ek: 'aa', hp: 3, mod: { aa: 1.3 } }, { counters: ['wing'], weakTo: ['p_ca'] });
ctE('e_coastal_l', '轻型岸防炮', 'e', 'arty', 'coastal', 35, CT_IC.coastal + ctBars(1), [5, 3, 5, 6, 0, 7, 4], '中小口径速射岸炮，射程较近但射速快，专打登陆艇。',
  { kind: 'enemy', at: 'coast', ek: 'coastal', hp: .65, mod: { rof: 1.7, rng: .8 } }, { counters: ['p_lct', 'p_lcvp'], weakTo: ['p_dd', 'p_air_strike'] });
ctE('e_coastal_m', '中型岸防炮', 'e', 'arty', 'coastal', 48, CT_IC.coastal + ctBars(2), [6, 4, 7, 8, 0, 7, 5], '兼顾射速与射程的岸炮。',
  { kind: 'enemy', at: 'coast', ek: 'coastal', hp: .85, mod: { rof: 1.25, rng: .92 } }, { counters: ['ship'], weakTo: ['p_dd', 'p_air_strike'] });
ctE('e_coastal_h', '岸防重炮', 'e', 'arty', 'coastal', 60, CT_IC.coastal + ctBars(3), [8, 5, 9, 9, 0, 8, 6], '射程 600 的重炮，可威胁驱逐舰与航母；雷达站在时可夜视海面。',
  { kind: 'enemy', at: 'coast', ek: 'coastal', hp: 1 }, { counters: ['dd', 'cv', 'ship'], weakTo: ['p_ranger', 'p_air_dive', 'p_ca'] });
ctE('e_rail', '列车炮', 'e', 'arty', 'coastal', 75, CT_IC.rail, [6, 3, 10, 10, 0, 7, 8], '超远射程的铁道重炮，射程是普通岸炮的 1.4 倍，射速慢。',
  { kind: 'enemy', at: 'coast', ek: 'coastal', hp: .8, mod: { rng: 1.4, rof: .55 } }, { counters: ['cv', 'dd'], weakTo: ['p_air_heavy'] });
ctE('e_coastal_r', '雷达引导岸防炮', 'e', 'arty', 'coastal', 80, CT_IC.radgun, [7, 4, 9, 9, 0, 10, 6], '自带火控雷达：不依赖雷达站也能远距离发现海面目标，射速更快。',
  { kind: 'enemy', at: 'coast', ek: 'coastal', hp: .9, mod: { rof: 1.15, rng: 1.05 }, vis: { r: 460, h: 4 } }, { counters: ['ship', 'dd'], weakTo: ['p_air_dive'] });
ctE('e_fgun', '野战炮', 'e', 'arty', 'arty', 30, CT_IC.fgun, [4, 1, 5, 6, 0, 4, 5], '轻型野战炮，射程较近、射速快。',
  { kind: 'enemy', at: 'land', ek: 'arty', hp: .8, mod: { rof: 1.35, rng: .8 } }, { counters: ['inf_p'], weakTo: ['p_air_strike', 'p_spg'] });
ctE('e_how', '榴弹炮阵地', 'e', 'arty', 'arty', 40, CT_IC.how, [5, 1, 7, 8, 0, 4, 6], '标准榴弹炮：射程 1100，打完数轮就转移阵地；对滩头与登陆舰威胁很大。',
  { kind: 'enemy', at: 'land', ek: 'arty', hp: 1 }, { counters: ['inf_p', 'ship'], weakTo: ['p_air_strike', 'p_fo'] });
ctE('e_hhow', '重型榴弹炮', 'e', 'arty', 'arty', 60, CT_IC.hhow, [6, 1, 9, 9, 0, 4, 8], '大口径重炮：射程更远、单发威力接近岸防重炮，射速慢。',
  { kind: 'enemy', at: 'land', ek: 'arty', hp: 1.2, mod: { rof: .6, rng: 1.3, shell: 'coastal' } }, { counters: ['inf_p', 'ship', 'veh'], weakTo: ['p_air_heavy'] });
ctE('e_rkt', '火箭炮连', 'e', 'arty', 'arty', 45, CT_IC.rkt, [3, 0, 8, 7, 0, 4, 6], '一次三发齐射，覆盖面大但散布也大，装填快；阵地脆弱。',
  { kind: 'enemy', at: 'land', ek: 'arty', hp: .7, mod: { salvo: 3, pow: .55, rof: 1.3 } }, { counters: ['inf_p'], weakTo: ['p_air_cas', 'p_spg'] });
ctE('e_mortar', '迫击炮组', 'e', 'arty', 'mortar', 20, CT_IC.mortar, [3, 0, 4, 4, 0, 4, 3], '射程 420 的轻迫击炮，覆盖滩头与出口，不能打海上目标。',
  { kind: 'enemy', at: 'land', ek: 'mortar', hp: 1 }, { counters: ['inf_p', 'p_eng'], weakTo: ['p_mortar', 'p_air_cas'] });
ctE('e_hmortar', '重型迫击炮', 'e', 'arty', 'mortar', 30, CT_IC.hmortar, [4, 0, 6, 5, 0, 4, 4], '大口径迫击炮：射程提升 35%、炮弹威力接近榴弹炮。',
  { kind: 'enemy', at: 'land', ek: 'mortar', hp: 1.3, mod: { rng: 1.35, shell: 'arty', rof: .85 } }, { counters: ['inf_p', 'trench'], weakTo: ['p_air_cas'] });
ctE('e_aa', '防空炮', 'e', 'arty', 'aa', 25, CT_IC.aa, [4, 1, 4, 5, 0, 4, 3], '190 以内射击舰载机，开火会暴露位置。',
  { kind: 'enemy', at: 'land', ek: 'aa', hp: 1 }, { counters: ['wing'], weakTo: ['p_air_strike', 'p_dd'] });
ctE('e_aa_heavy', '重型高炮', 'e', 'arty', 'aa', 38, CT_IC.haa, [6, 2, 6, 7, 0, 5, 5], '大口径高炮：射程与命中率更高，对轰炸机威胁很大。',
  { kind: 'enemy', at: 'land', ek: 'aa', hp: 1.5, mod: { aa: 1.6, rng: 1.25 } }, { counters: ['wing'], weakTo: ['p_dd'] });
ctE('e_aa_radar', '雷达高炮', 'e', 'arty', 'aa', 50, CT_IC.raa, [5, 2, 7, 8, 0, 9, 5], '火控雷达指挥的高炮群，命中率接近普通高炮两倍，并能远距离发现目标。',
  { kind: 'enemy', at: 'land', ek: 'aa', hp: 1.25, mod: { aa: 1.9, rng: 1.35 }, vis: { r: 260, h: 3 } }, { counters: ['wing'], weakTo: ['p_air_dive', 'p_dd'] });
ctE('e_tel', '战术导弹发射车', 'e', 'arty', 'missile', 90, CT_IC.tel, [3, 1, 10, 10, 2, 0, 0], '纵深 450 以外的机动发射车，载弹 2 枚：打击滩头卸载中的登陆舰与密集部队，射程 300–1800；发射后暴露并转移阵地。',
  { kind: 'enemy', at: 'land', ek: 'tel', minDepth: 450, n: 2 }, { counters: ['ship', 'inf_p', 'p_depot'], weakTo: ['p_tbm', 'p_air_strike', 'p_air_recon'] });
ctE('e_ascm', '岸舰导弹连', 'e', 'arty', 'missile', 110, CT_IC.ascm, [4, 1, 10, 10, 0, 7, 0], '岸边的反舰导弹连（4 枚，两枚一组齐射）：掠海飞行打击射程 1600 内的坦克登陆舰、满载登陆舰与驱逐舰；驱逐舰近防炮可拦截，发射后暴露 90 秒。',
  { kind: 'enemy', at: 'coast', ek: 'ascm', n: 4 }, { counters: ['p_lst', 'p_lct', 'dd'], weakTo: ['p_tbm', 'p_air_dive'] });

// ———— 防守方 · 航空（需要野战机场；每座机场最多 4 架）————
ctE('e_airfield', '野战机场', 'e', 'air', 'airfield', 50, CT_IC.airfield, [8, 1, 0, 0, 0, 0, 0], '纵深 500 以外的简易跑道：守军攻击机与武装直升机在此起降、整备；跑道被炸后暂停出击，被毁则地面飞机全部损失。',
  { kind: 'enemy', at: 'land', ek: 'airfield', minDepth: 500 }, { weakTo: ['p_tbm', 'p_air_heavy', 'p_air_strike'] });
ctE('e_air_ga', '对地攻击机', 'e', 'air', 'ewing', 38, CT_IC.ega, [2, 0, 7, 0, 9, 4, 0], '一次通场：6 枚火箭齐射加机炮扫射，专打卸载中的登陆舰与密集步兵；携 2 枚干扰弹，怕便携防空导弹与自行高炮。需要野战机场。',
  { kind: 'ewing', at: 'air', type: 'ga' }, { counters: ['ship', 'inf_p'], weakTo: ['p_manpads', 'p_aa_veh', 'p_dd'] });
ctE('e_air_heli', '武装直升机', 'e', 'air', 'ewing', 40, CT_IC.eheli, [3, 1, 6, 6, 4, 6, 0], '在 300–380 外悬停，以反坦克导弹猎杀坦克与登陆舰，再用火箭覆盖步兵；速度慢、低空，机枪也能把它打下来。需要野战机场。',
  { kind: 'ewing', at: 'air', type: 'heli' }, { counters: ['veh', 'p_lst'], weakTo: ['p_manpads', 'p_aa_veh', 'p_mg'] });

// ———— 防守方 · 工事 ————
ctE('e_mines_ap', '防步兵雷区', 'e', 'fort', 'mines', 15, CT_IC.mine, [0, 0, 5, 0, 0, 0, 0], '半径约 24 的雷区，踩中即伤亡并暴露；工兵可以排除。',
  { kind: 'mine', at: 'land', r: 24, n: 1 }, { counters: ['inf_p'], weakTo: ['p_eng', 'p_mine_tank'] });
ctE('e_mines_at', '反坦克雷区', 'e', 'fort', 'mines', 18, CT_IC.atmine, [0, 0, 6, 0, 0, 0, 0], '专炸车辆的重型地雷，步兵踩中的概率较低。',
  { kind: 'mine', at: 'land', r: 26, n: 1, at2: 1, clr: .75 }, { counters: ['veh'], weakTo: ['p_mine_tank', 'p_eng'] });
ctE('e_mines_mx', '混合雷区', 'e', 'fort', 'mines', 22, CT_IC.mixmine, [0, 0, 6, 0, 0, 0, 0], '防步兵雷与反坦克雷混布，人车皆伤。',
  { kind: 'mine', at: 'land', r: 28, n: 1, at2: 1 }, { counters: ['inf_p', 'veh'], weakTo: ['p_eng'] });
ctE('e_mines_dense', '密集雷区', 'e', 'fort', 'mines', 30, CT_IC.dmine, [0, 0, 8, 0, 0, 0, 0], '三片相连的雷区，覆盖整个出口通道，排除很费时。',
  { kind: 'mine', at: 'land', r: 26, n: 3 }, { counters: ['inf_p'], weakTo: ['p_sortie_bomb', 'p_eng'] });
ctE('e_wire', '铁丝网', 'e', 'fort', 'wire', 6, CT_IC.wire, [2, 0, 0, 0, 0, 0, 0], '两点连线放置（每 100 长约 6 点）：大幅迟滞步兵，炮火可炸开缺口。',
  { kind: 'wire', at: 'line', rows: 1, per: 6 }, { counters: ['inf_p'], weakTo: ['p_eng', 'p_rocket'] });
ctE('e_wire2', '双层铁丝网', 'e', 'fort', 'wire', 10, CT_IC.wire2, [3, 0, 0, 0, 0, 0, 0], '前后两道铁丝网，需要两次剪开或炸开。',
  { kind: 'wire', at: 'line', rows: 2, per: 10 }, { counters: ['inf_p'], weakTo: ['p_eng', 'p_air_heavy'] });
ctE('e_wire_c', '蛇腹形铁丝网', 'e', 'fort', 'wire', 12, CT_IC.conc, [4, 0, 0, 0, 0, 0, 0], '蛇腹形钢丝卷，工兵剪开所需时间是普通铁丝网的 2.5 倍。',
  { kind: 'wire', at: 'line', rows: 1, per: 12, prog: -1.5 }, { counters: ['p_eng'], weakTo: ['p_rocket', 'p_dozer'] });
ctE('e_hedgehog', '钢刺猬', 'e', 'fort', 'obst', 12, CT_IC.hedge, [5, 0, 0, 0, 0, 0, 0], '水际一排四个钢刺猬：撞上的登陆艇受损，车辆无法通过。放在滩头前的浅滩或出口。',
  { kind: 'obst', at: 'shore', n: 4, sp: 14 }, { counters: ['ship', 'veh'], weakTo: ['p_sweep', 'p_dozer'] });
ctE('e_stakes', '木桩障碍', 'e', 'fort', 'obst', 10, CT_IC.stakes, [3, 0, 0, 0, 0, 0, 0], '浅滩上的六根木桩，分布更散、覆盖更宽，但更容易被发现。',
  { kind: 'obst', at: 'shore', n: 6, sp: 22 }, { counters: ['ship'], weakTo: ['p_sweep'] });
ctE('e_tetra', '混凝土四面体', 'e', 'fort', 'obst', 14, CT_IC.tetra, [7, 0, 0, 0, 0, 0, 0], '三个紧密排列的混凝土四面体，形成短而密的阻塞带。',
  { kind: 'obst', at: 'shore', n: 3, sp: 9 }, { counters: ['ship', 'veh'], weakTo: ['p_dozer'] });
ctE('e_trench', '堑壕', 'e', 'fort', 'trench', 5, CT_IC.trench, [0, 0, 0, 0, 0, 0, 0], '两点连线（每 100 长约 5 点）：壕内守军受来自海面一侧的火力伤害大减。',
  { kind: 'trench', at: 'line', per: 5 }, { counters: ['inf_p'], weakTo: ['p_flame', 'p_flame_tank'] });
ctE('e_trench_zz', '之字形堑壕', 'e', 'fort', 'trench', 7, CT_IC.zz, [0, 0, 0, 0, 0, 0, 0], '之字形走向，覆盖更宽的纵深，更难被一发炮弹覆盖。',
  { kind: 'trench', at: 'line', per: 7, zz: 1 }, { counters: ['inf_p'], weakTo: ['p_flame'] });
ctE('e_atditch', '反坦克壕', 'e', 'fort', 'trench', 10, CT_IC.ditch, [6, 0, 0, 0, 0, 0, 0], '深壕阻挡车辆（壕边设障碍），步兵可以利用它作为掩体。',
  { kind: 'trench', at: 'line', per: 10, ditch: 1 }, { counters: ['veh'], weakTo: ['p_dozer'] });
ctE('e_op', '观察哨', 'e', 'fort', 'post', 15, CT_IC.op, [2, 0, 0, 0, 0, 8, 2], '高处观察哨：视野约 300，为炮兵与岸炮指示目标。放在高地效果最好。',
  { kind: 'post', at: 'land', r: 300, h: 2.5, hp: 5 }, { counters: ['ship', 'inf_p'], weakTo: ['p_air_strike', 'p_sniper'] });
ctE('e_radar', '雷达站', 'e', 'fort', 'post', 35, CT_IC.radar, [3, 0, 0, 0, 0, 10, 2], '对空对海雷达：视野约 480，提早发现舰队与飞机。',
  { kind: 'post', at: 'land', r: 480, h: 4, hp: 8 }, { counters: ['ship', 'wing'], weakTo: ['p_air_strike'] });
ctE('e_slight', '探照灯', 'e', 'fort', 'post', 10, CT_IC.slight, [1, 0, 0, 0, 0, 6, 1], '照亮滩头约 240 范围，烟幕可以遮挡。',
  { kind: 'post', at: 'land', r: 240, h: 1, hp: 3 }, { counters: ['p_lct'], weakTo: ['p_smoke'] });
ctE('e_decoy', '假目标', 'e', 'fort', 'decoy', 6, CT_IC.decoy, [1, 0, 0, 0, 0, 0, 0], '伪装成碉堡的假阵地，吸引敌方空袭与舰炮浪费火力；一打就碎。',
  { kind: 'enemy', at: 'land', ek: 'bunker', hp: .2, mod: { pow: 0, rng: .05, rof: .1 }, decoy: 1 }, { counters: ['p_air_strike', 'p_dd'] });
ctE('e_ammo', '弹药库', 'e', 'support', 'depot_e', 25, CT_IC.ammo, [4, 0, 0, 0, 0, 0, 0], '前沿弹药库：900 以内的火炮与迫击炮装填加快 25%；被炸毁则失效。',
  { kind: 'post', at: 'land', r: 0, h: 0, hp: 6, ammo: 1 }, { counters: ['arty'], weakTo: ['p_air_strike', 'p_sortie_bomb'] });
ctE('e_wave', '增援波次', 'e', 'support', 'wave_e', 30, CT_IC.ewave, [0, 0, 4, 0, 0, 0, 9], '开战约 4 分钟后，三个小组从北面开到受威胁最大的据点。可叠加，每次晚 1 分钟。',
  { kind: 'ewave', at: 'none', teams: 3, t: 240 }, { counters: ['inf_p'] });

// v7 守方导弹、机场与守方航空、单兵防空尚未接入推演：先不出现在沙盒与图鉴（对应模块完成后删掉这一行过滤）
const CT_WIP = new Set(['e_tel', 'e_ascm', 'e_airfield', 'e_air_ga', 'e_air_heli', 'p_manpads', 'e_manpads']);
for (let i = CATALOG.length - 1; i >= 0; i--) if (CT_WIP.has(CATALOG[i].id)) CATALOG.splice(i, 1);

const CATALOG_MAP = new Map(CATALOG.map(c => [c.id, c]));
const catalogById = id => CATALOG_MAP.get(id) || null;
