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
  cram: CT_WHEEL + '<path d="M7 5h10l2 3v11l-2 2H7l-2-2V8z"/><circle cx="12" cy="11" r="3.2"/><path d="M12 7.8V2.5M10.6 8.2l-.8-4.6M13.4 8.2l.8-4.6"/><circle class="f" cx="12" cy="11" r="1"/>',
  samv: ctTank(5, 6.5, 2.2, 0) + '<path d="M11.2 11.3V3.5M12.8 11.3V3.5"/><rect x="7.6" y="10" width="1.8" height="5" rx=".4"/><rect x="14.6" y="10" width="1.8" height="5" rx=".4"/><path d="M9.8 18h4.4"/>',
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
  aftr: CT_AIR.fighter || '<path d="M12 2l1.4 5.6 7.6 6.4v2l-7.6-2.2-.3 3.8 2.6 2v1.6L12 20.4l-3.7 1.2V20l2.6-2-.3-3.8L3 16v-2l7.6-6.4z"/>',
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
  para: '<path d="M4 11a8 6.5 0 0 1 16 0z"/><path d="M4 11l8 7 8-7M9 11l3 7 3-7"/><circle class="f" cx="12" cy="19.6" r="1.7"/>',
  drop: '<path d="M4 9a8 6 0 0 1 16 0z"/><path d="M4 9l5 6.5M20 9l-5 6.5"/><rect x="8.5" y="15" width="7" height="6" rx=".6"/><path d="M8.5 18h7M12 15v6"/>',
  tel: '<rect x="2" y="15" width="20" height="4" rx=".6"/><circle cx="6" cy="20.6" r="1.4"/><circle cx="12" cy="20.6" r="1.4"/><circle cx="18" cy="20.6" r="1.4"/><path d="M7 14.5L19 4l1.6 1.8L9 16"/><path d="M5 15V11h3"/>',
  ascm: '<rect x="2" y="15" width="20" height="4" rx=".6"/><circle cx="6" cy="20.6" r="1.4"/><circle cx="18" cy="20.6" r="1.4"/><path d="M4 12.5L19 6.5M5.5 15L20.5 9"/><path d="M19 6.5l1.5 2.5"/>',
  airfield: '<rect x="2" y="9.5" width="20" height="5" rx=".6"/><path d="M4.5 12h3M10.5 12h3M16.5 12h3"/><path d="M3 21.5a4 3 0 0 1 8 0z"/><path d="M15 2.5l2.5 4.5M13 4.5l4.5-.5"/>',
  ega: '<path d="M12 2l1.8 6.5 7.2 7.5v2l-7.2-2.8-.4 3.3 2.6 2v1.5L12 20.5l-4 1.5v-1.5l2.6-2-.4-3.3L3 18v-2l7.2-7.5z"/><path d="M6 13.5v3.5M18 13.5v3.5"/>',
  eheli: '<path d="M2 5.5h20M12 5.5v4"/><ellipse cx="12" cy="13" rx="3.5" ry="4"/><path d="M12 17v5M9 21.5h6M4 14h4.5M15.5 14H20"/>',
  eftr: '<path d="M12 2l1.4 5.6 7.6 6.4v2l-7.6-2.2-.3 3.8 2.6 2v1.6L12 20.4l-3.7 1.2V20l2.6-2-.3-3.8L3 16v-2l7.6-6.4z"/><path d="M7 20.5h10" stroke-dasharray="1.5 1.5"/>'
};
// 照真实装备外形重画的图标（icons.js）：单兵武器、装甲车辆、火炮、舰艇侧视，飞机俯视
if (typeof WI === 'object') Object.assign(CT_IC, {
  rifle: WI.qbz191, mg: WI.qjy201, marine: WI.qbz191 + '<path d="M3 21.5q2.25-2 4.5 0t4.5 0 4.5 0 4.5 0"/>', ranger: WI.qbz191 + '<path class="f" d="M20 2.6l1.6 1.6L20 5.8l-1.6-1.6z"/>',
  sniper: WI.qbu202, at: WI.pf98, flame: WI.pf97, pmortar: WI.pp87, manpads: WI.qw2,
  egar: WI.m4a1, emg: WI.m240, emanpads: WI.stinger, esniper: WI.m2010, eat: WI.javelin,
  lt: WI.ztq15, tank: WI.ztz96b, tank76: WI.ztz96b + ctDots(1), hv: WI.ztz99a, amt: WI.ztd05, amh: WI.ztd05f, apc: WI.zsl92b, ifv: WI.zbd05, spg: WI.plz07, td: WI.ptl02,
  aav: WI.pgz07, samv: WI.pgl625, cram: WI.ld2000, rcn: WI.zbl08, flt: WI.zbd04a, mnt: WI.ztz96m, dozer: WI.gcz110,
  ecar: WI.m1117, m10: WI.m10, m1a1: WI.m1a1, m1a2: WI.m1a2, m1134: WI.m1134, m109: WI.m109, m2a3: WI.m2a3, m163: WI.m163, mshorad: WI.mshorad, lpws: WI.lpws, m1127: WI.m1127, m1150: WI.m1150,
  fgun: WI.m119, how: WI.m777, hhow: WI.m110, rkt: WI.m270, mortar: WI.m252, hmortar: WI.m120, aa: WI.m167, haa: WI.bofors, raa: WI.cram, tel: WI.himars, ascm: WI.nmesis, radar: WI.tps80,
  ecoastl: WI.m119 + '<path d="M3 21.5q2.25-1.6 4.5 0t4.5 0 4.5 0 4.5 0" stroke-dasharray="1.4 1.4"/>', ecoastm: WI.m777 + '<path d="M13 21.5q2.25-1.6 4.5 0t4.5 0" stroke-dasharray="1.4 1.4"/>',
  lct: WI.t271, lci: WI.t074a, lcvp: WI.lcvp, lst: WI.t072a, lsm: WI.t073a, ls: WI.t072, rlct: WI.rkboat, lcs: WI.gunboat, sweep: WI.t082,
  dd: WI.t052d, ddh: WI.t052d + ctDots(1), dde: WI.t054a, cl: WI.t055, ca: WI.t055 + ctDots(1), cv: WI.t003, cve: WI.t075,
  arecon: WI.kj600, awz7: WI.wz7, astrike: WI.j35, aj35: WI.j35, agj11: WI.gj11, aj15: WI.j15, acas: WI.gj2, aftr: WI.j20, heavy: WI.h6k, heli: WI.z10,
  ega: WI.a10, eheli: WI.ah64, eftr: WI.f35, ef22: WI.f22, aj36: WI.j36, aj50: WI.j50, tbm: WI.df15b, hj12: WI.hj12, lcac: WI.lcac, nuke: WI.nuke, uh60: WI.uh60, c17: WI.c17, b2: WI.b2
});

// —— 条目 —— e(id, 名称, 阵营, 分类, 原型, 点数, 图标, [耐久, 装甲, 火力, 射程, 速度, 视野, 人数], 说明, spawn, 附加)
const CATALOG = [];
function ctE(id, name, side, cat, arch, cost, icon, st, desc, spawn, extra) {
  const [hp, armor, firepower, range, speed, sight, men] = st;
  CATALOG.push({ id, name, side, cat, arch, cost, icon, stats: { hp, armor, firepower, range, speed, sight, men }, desc, spawn, ...extra });
}

// ———— 进攻方 · 登陆步兵（装载到登陆舰，抢滩后按此编成下船；每条 = 1 个小组）————
ctE('p_rifle', '步枪组（191 式步枪）', 'p', 'inf', 'inf_p', 10, CT_IC.rifle, [3, 0, 3, 5, 5, 6, 3], '标准三人突击组：通讯兵、步枪手、机枪手，攻守均衡，是滩头兵力的骨干。怕炮火与碉堡交叉火力。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'mg'] }, { counters: ['inf_e'], weakTo: ['bunker', 'arty'] });
ctE('p_mg', '机枪组（QJY-201 通用机枪）', 'p', 'inf', 'inf_p', 13, CT_IC.mg + ctDots(1), [3, 0, 4, 6, 4, 6, 3], '双机枪火力组，压制能力强，掩护友军前进；精度一般，移动慢时最有用。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'mg', 'mg'], mod: { sup: 1.35, pow: .9 } }, { counters: ['inf_e'], weakTo: ['mortar', 'arty'] });
ctE('p_marine', '陆战队突击组', 'p', 'inf', 'inf_p', 14, CT_IC.marine, [3, 0, 5, 5, 6, 6, 3], '经过抢滩训练的陆战队员，射速与命中更高、士气坚韧；价格稍贵。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'mg'], mod: { pow: 1.15, rof: 1.15 }, morale: 90 }, { counters: ['inf_e', 'p_rifle'], weakTo: ['bunker'] });
ctE('p_ranger', '蛟龙突击队小组', 'p', 'inf', 'inf_p', 24, CT_IC.ranger, [5, 1, 9, 7, 6, 7, 3], '海军陆战队特种部队：精度 1.6 倍、射速 1.3 倍、射程 1.2 倍，防弹插板让近一半的致命伤只是负伤，几乎压不住、最不容易溃退，适合攻打岸防炮台等要点。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'mg'], mod: { pow: 1.6, rng: 1.2, rof: 1.3, sup: 1.4, hard: .45, calm: .5 }, morale: 100 }, { counters: ['coastal', 'inf_e'], weakTo: ['arty'] });
ctE('p_sniper', '狙击小组（QBU-202）', 'p', 'inf', 'inf_p', 14, CT_IC.sniper, [2, 0, 4, 9, 5, 8, 2], '两人狙击组：远距离精确射杀机枪手与通讯兵，压制力弱、怕被炮火覆盖。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle'], mod: { pow: 2.2, rng: 1.7, rof: .55, sup: .5 } }, { counters: ['inf_e'], weakTo: ['mortar'] });
ctE('p_at', '反坦克火箭组（PF-98）', 'p', 'inf', 'inf_p', 15, CT_IC.at, [3, 0, 3, 4, 5, 5, 3], '携带火箭筒，专打装甲车辆与坦克；对步兵火力偏弱。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'rifle'], mod: { at: 1.5, pow: .85 } }, { counters: ['veh', 'car_e'], weakTo: ['inf_e', 'mortar'] });
ctE('p_hj12', '红箭-12 反坦克导弹组', 'p', 'inf', 'inf_p', 22, CT_IC.hj12, [3, 0, 4, 8, 5, 6, 3], '发射后不管的攻顶反坦克导弹：射程比火箭筒远得多（约 270），从顶部击穿主战坦克，专打 M1A2、布雷德利与反坦克车；对步兵火力弱，价格较贵。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'rifle'], mod: { at: 2, atPen: 3.4, rng: 1.6, pow: .7 } }, { counters: ['e_tank', 'e_hv_tank', 'e_td', 'e_apc', 'car_e'], weakTo: ['inf_e', 'mortar'] });
ctE('p_flame', '温压火箭组（PF-97）', 'p', 'inf', 'inf_p', 16, CT_IC.flame, [3, 0, 7, 2, 5, 5, 3], 'PF-97 单兵温压火箭：近距发射温压弹，对碉堡、堑壕毁灭性，压制与杀伤极强；射程很短，接近途中伤亡大。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'rifle'], mod: { rng: .45, sup: 2.6, pow: 1.7 }, tag: 'flame' }, { counters: ['bunker', 'trench'], weakTo: ['e_mg_nest', 'e_ambush'] });
ctE('p_eng', '战斗工兵组', 'p', 'inf', 'eng_p', 12, CT_IC.eng, [3, 0, 1, 2, 5, 4, 3], '排除雷区、剪开铁丝网、修建补给网；本身几乎没有火力，需要步兵掩护。',
  { kind: 'cargo', at: 'cargo', men: ['eng', 'eng', 'eng'], eng: true }, { counters: ['mines', 'wire'], weakTo: ['inf_e', 'mortar'] });
ctE('p_demo', '爆破突击组', 'p', 'inf', 'eng_p', 16, CT_IC.demo, [3, 0, 5, 1, 5, 4, 3], '携带炸药包的突击工兵：摸到碉堡 25 以内即可爆破，是拔除火力点的利器。',
  { kind: 'cargo', at: 'cargo', men: ['rifle', 'eng', 'rifle'], tag: 'demo' }, { counters: ['bunker', 'coastal'], weakTo: ['e_mg_nest'] });
ctE('p_medic', '卫生组', 'p', 'inf', 'inf_p', 12, CT_IC.medic, [3, 0, 1, 4, 5, 5, 3], '随队卫生员：附近连队士气恢复更快、更难溃退；自身火力很弱。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'rifle'], mod: { pow: .6 }, tag: 'medic' }, { weakTo: ['arty'] });
ctE('p_fo', '前进观察组', 'p', 'inf', 'inf_p', 14, CT_IC.fo, [3, 0, 1, 4, 5, 9, 3], '双电台观察组：视野远超普通小组，为舰炮、航空兵和自动指挥提供目标。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'radio', 'rifle'], mod: { pow: .7 }, tag: 'fo' }, { counters: ['arty', 'mortar'], weakTo: ['inf_e'] });
ctE('p_mortar', '迫击炮组（PP-87 82 毫米）', 'p', 'inf', 'inf_p', 18, CT_IC.pmortar, [3, 0, 5, 7, 4, 5, 3], '随登陆连上岸的轻迫击炮：对 380 以内看得见的敌人与工事间接射击，压制碉堡与机枪阵地。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'rifle'], mod: { pow: .6 }, tag: 'mortar' }, { counters: ['inf_e', 'trench'], weakTo: ['arty'] });
ctE('p_hq', '营部指挥组', 'p', 'inf', 'inf_p', 16, CT_IC.hq, [3, 0, 2, 4, 5, 7, 3], '营指挥所：150 内的连队士气稳定、压制恢复更快；被打掉会让附近部队动摇。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'radio', 'rifle'], tag: 'hq' }, { weakTo: ['e_sniper', 'arty'] });
ctE('p_manpads', '便携防空导弹组（前卫-2）', 'p', 'inf', 'inf_p', 18, CT_IC.manpads, [3, 0, 2, 7, 5, 6, 3], '肩扛式防空导弹（每组 3 枚）：230–260 内击落低飞的敌攻击机与武装直升机，补给点附近每分钟补 1 枚；对地火力弱。',
  { kind: 'cargo', at: 'cargo', men: ['radio', 'rifle', 'aa'], mod: { pow: .8 }, tag: 'manpads' }, { counters: ['e_air_ga', 'e_air_heli'], weakTo: ['inf_e', 'mortar'] });

// ———— 进攻方 · 装甲（两栖车辆在集结海域自行泅渡；其余装载到坦克登陆舰）————
ctE('p_lt_tank', 'ZTQ-15 轻型坦克', 'p', 'armor', 'veh', 30, CT_IC.lt, [4, 2, 4, 5, 8, 6, 4], '机动快、价格低，可伴随步兵扫清机枪火力点；装甲薄，怕反坦克炮。',
  { kind: 'veh', at: 'vcargo', type: 'lt_tank' }, { counters: ['inf_e', 'car_e'], weakTo: ['e_at_casemate', 'e_at'] });
ctE('p_tank', 'ZTZ-96B 主战坦克', 'p', 'armor', 'veh', 45, CT_IC.tank, [6, 3, 6, 6, 6, 6, 5], '主力坦克，攻防均衡，能正面摧毁碉堡、碾压守军步兵；需步兵贴身保护以防近战反坦克。',
  { kind: 'veh', at: 'vcargo', type: 'tank' }, { counters: ['bunker', 'inf_e'], weakTo: ['e_at_casemate', 'coastal'] });
ctE('p_tank76', 'ZTZ-96B 主战坦克（穿甲弹加强）', 'p', 'armor', 'veh', 52, CT_IC.tank76, [6, 3, 7, 7, 6, 6, 5], '换装长身管火炮的中型坦克，穿甲与射程提升，适合对付守军坦克。',
  { kind: 'veh', at: 'vcargo', type: 'tank', mod: { pow: 1.2, rng: 1.15 } }, { counters: ['e_tank', 'car_e'], weakTo: ['e_at_casemate'] });
ctE('p_hv_tank', 'ZTZ-99A 主战坦克', 'p', 'armor', 'veh', 70, CT_IC.hv, [9, 4, 8, 6, 4, 5, 5], '125 毫米滑膛炮、复合装甲加反应装甲，正面几乎免疫轻型火炮，主炮可一两发拆毁碉堡；车重大，过桥与沼泽困难。',
  { kind: 'veh', at: 'vcargo', type: 'hv_tank' }, { counters: ['bunker', 'e_tank'], weakTo: ['coastal', 'mines'] });
ctE('p_amtank', 'ZTD-05 两栖突击车', 'p', 'armor', 'veh', 40, CT_IC.amt, [5, 2, 5, 5, 5, 5, 4], '可从集结海域自行泅渡上滩，与第一波同时登陆提供直射火力；水上行动缓慢、易被岸炮击中。',
  { kind: 'veh', at: 'sea', type: 'amtank' }, { counters: ['bunker', 'inf_e'], weakTo: ['coastal', 'obst'] });
ctE('p_amtank_how', 'ZTD-05 两栖突击车（火力支援型）', 'p', 'armor', 'veh', 42, CT_IC.amh, [5, 2, 6, 5, 5, 5, 4], '短身管榴弹炮型两栖车，榴弹威力更大、射速稍慢，专门支援滩头步兵。',
  { kind: 'veh', at: 'sea', type: 'amtank', mod: { pow: 1.3, rof: .8 } }, { counters: ['bunker', 'trench'], weakTo: ['coastal'] });
ctE('p_apc', 'ZSL-92B 轮式装甲运兵车', 'p', 'armor', 'veh', 28, CT_IC.apc, [5, 2, 2, 4, 7, 5, 2], '把步兵从滩头快速输送到前线，随后以车载机枪支援；没有主炮。',
  { kind: 'veh', at: 'vcargo', type: 'apc' }, { counters: ['inf_e'], weakTo: ['e_at', 'veh'] });
ctE('p_ifv', 'ZBD-05 两栖步兵战车', 'p', 'armor', 'veh', 36, CT_IC.ifv, [5, 2, 4, 5, 7, 5, 2], '加装小口径机关炮的运兵车，火力更强，能压制机枪阵地。',
  { kind: 'veh', at: 'vcargo', type: 'apc', mod: { pow: 1.5, rof: 1.3 } }, { counters: ['inf_e', 'car_e'], weakTo: ['e_at'] });
ctE('p_spg', 'PLZ-07 自行榴弹炮', 'p', 'armor', 'veh', 50, CT_IC.spg, [4, 1, 7, 9, 5, 4, 4], '上岸后对已知目标间接射击，射程约 600；装甲薄，不宜靠前。',
  { kind: 'veh', at: 'vcargo', type: 'spg' }, { counters: ['arty', 'bunker', 'mortar'], weakTo: ['inf_e', 'car_e'] });
ctE('p_td', 'PTL-02 突击炮', 'p', 'armor', 'veh', 48, CT_IC.td, [5, 3, 7, 8, 6, 5, 4], '高初速反坦克炮，专门猎杀装甲目标；对步兵与工事效果一般。',
  { kind: 'veh', at: 'vcargo', type: 'td' }, { counters: ['e_tank', 'e_hv_tank', 'car_e'], weakTo: ['inf_e', 'arty'] });
ctE('p_aa_veh', 'PGZ-07 双 35 毫米自行高炮', 'p', 'armor', 'veh', 35, CT_IC.aav, [4, 1, 6, 5, 6, 5, 4], '双管 35 毫米高炮，打低空飞机，平射对步兵也是毁灭性压制；装甲薄。',
  { kind: 'veh', at: 'vcargo', type: 'aa_veh' }, { counters: ['inf_e'], weakTo: ['e_at_casemate', 'arty'] });
ctE('p_sam_veh', 'PGL-625 弹炮结合防空车', 'p', 'armor', 'veh', 55, CT_IC.samv, [4, 1, 6, 8, 6, 7, 3], '双联装机关炮加 8 枚近程防空导弹：机炮打 260 内的飞机，导弹打 520 内的飞机，还能拦截落向附近 450 以内的战术弹道导弹与飞近的岸舰导弹；每 30 秒补装一枚导弹。装甲薄，跟在步兵后面。',
  { kind: 'veh', at: 'vcargo', type: 'sam_veh' }, { counters: ['e_air_ga', 'e_air_heli', 'e_air_ftr', 'e_tel', 'e_ascm'], weakTo: ['e_at_casemate', 'arty'] });
ctE('p_ld2000', 'LD-2000 陆基近防炮', 'p', 'armor', 'veh', 50, CT_IC.cram, [4, 1, 5, 6, 6, 6, 3], '1130 型 11 管 30 毫米近防炮装上 8×8 越野车：在空中打掉 260 以内落向我军的榴弹、迫击炮弹、火箭弹，也打低空飞机；不能对付坦克，跟在步兵、补给点、指挥所旁边最有用。',
  { kind: 'veh', at: 'vcargo', type: 'aa_veh', mod: { cram: 1 } }, { counters: ['e_how', 'e_mortar', 'e_rkt', 'arty', 'mortar'], weakTo: ['e_tank', 'inf_e'] });
ctE('p_recon', '08 式轮式侦察车', 'p', 'armor', 'veh', 22, CT_IC.rcn, [3, 1, 2, 4, 9, 9, 3], '轮式侦察车：速度快、视野远，用来发现纵深火力点；一碰就伤。',
  { kind: 'veh', at: 'vcargo', type: 'recon' }, { counters: ['arty', 'mortar'], weakTo: ['bunker', 'e_at'] });
ctE('p_flame_tank', 'ZBD-04A 温压火箭突击车', 'p', 'armor', 'veh', 50, CT_IC.flt, [6, 3, 8, 3, 5, 5, 4], '解放军没有喷火坦克，这里改为步兵战车底盘的温压火箭车：近距发射温压弹，对碉堡与堑壕极具毁灭性；射程短，必须抵近。',
  { kind: 'veh', at: 'vcargo', type: 'flame_tank' }, { counters: ['bunker', 'trench', 'inf_e'], weakTo: ['e_at_casemate', 'coastal'] });
ctE('p_mine_tank', '96 式扫雷坦克', 'p', 'armor', 'veh', 46, CT_IC.mnt, [6, 3, 3, 4, 4, 5, 4], '车前滚压装置引爆地雷，为后续部队开出安全通路。',
  { kind: 'veh', at: 'vcargo', type: 'mine_tank' }, { counters: ['mines'], weakTo: ['e_at_casemate'] });
ctE('p_dozer', 'GCZ-110 重型工程车', 'p', 'armor', 'veh', 44, CT_IC.dozer, [6, 3, 2, 3, 4, 5, 4], '推土铲清除障碍物与铁丝网、也能扫雷，打通滩头出口。',
  { kind: 'veh', at: 'vcargo', type: 'mine_tank', mod: { pow: .7 }, tag: 'dozer' }, { counters: ['obst', 'wire'], weakTo: ['e_at_casemate'] });

// ———— 进攻方 · 舰艇 ————
ctE('p_lct', '271 型登陆艇', 'p', 'naval', 'ship', 20, CT_IC.lct, [5, 1, 0, 0, 5, 3, 10], '标准突击登陆艇，满载 5 个小组：放下就自带步枪组 ×2、机枪组、反坦克组、工兵组（兵员点数另计，右键可卸下换兵种）；首波抢滩主力。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 5, hp: 10, pre: 'LA', def: ['p_rifle', 'p_rifle', 'p_mg', 'p_at', 'p_eng'] }, { weakTo: ['coastal', 'obst', 'bunker'] });
ctE('p_lci', '074A 型登陆舰', 'p', 'naval', 'ship', 28, CT_IC.lci, [6, 1, 0, 0, 5, 3, 10], '载 8 个小组的较大舰艇，放下就自带一个加强连（营部、步枪组 ×3、机枪组 ×2、反坦克组、卫生组），一次送上；目标大，抢滩时更招火。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 8, hp: 12, pre: 'LI', def: ['p_hq', 'p_rifle', 'p_rifle', 'p_rifle', 'p_mg', 'p_mg', 'p_at', 'p_medic'] }, { weakTo: ['coastal', 'obst'] });
ctE('p_lcvp', '人员登陆艇', 'p', 'naval', 'ship', 12, CT_IC.lcvp, [3, 0, 0, 0, 6, 3, 9], '只载 3 个小组的小艇，自带步枪组 ×2 与机枪组；便宜、目标小，适合佯攻与分散登陆。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 3, hp: 6, pre: 'LV', def: ['p_rifle', 'p_rifle', 'p_mg'] }, { weakTo: ['bunker', 'obst'] });
ctE('p_lst', '072A 型坦克登陆舰', 'p', 'naval', 'ship', 35, CT_IC.lst, [8, 1, 0, 0, 4, 3, 0], '抢滩后放下首门，把装载的坦克与装甲车逐辆开上岸（最多 3 辆）；建议作为第二波。',
  { kind: 'ship', at: 'sea', ship: 'lst', vcap: 3, hp: 16, pre: 'LT', wave: 2, def: ['p_tank', 'p_tank', 'p_apc'] }, { weakTo: ['coastal'] });
ctE('p_lcac', '726 型气垫登陆艇', 'p', 'naval', 'ship', 34, CT_IC.lcac, [4, 1, 0, 0, 10, 3, 0], '气垫登陆艇：航速是普通登陆艇的两倍多，从水面障碍、浅滩上直接冲上滩头，载 1 辆坦克或装甲车，让装甲最先抵滩；艇体单薄，挨不住岸炮。',
  { kind: 'ship', at: 'sea', ship: 'lst', vcap: 1, hp: 8, pre: 'LC', spdK: 2.2, hover: true, def: ['p_tank'] }, { counters: ['obst', 'e_tetra', 'e_hedgehog'], weakTo: ['coastal', 'e_how'] });
ctE('p_lsm', '073A 型中型登陆舰', 'p', 'naval', 'ship', 30, CT_IC.lsm, [6, 1, 0, 0, 5, 3, 6], '载 2 辆车与 2 个小组的中型登陆舰，兼顾人员与装甲：自带步枪组与机枪组，车辆自选装载。',
  { kind: 'ship', at: 'sea', ship: 'lst', vcap: 2, cap: 2, hp: 13, pre: 'LM', wave: 2, def: ['p_tank', 'p_apc', 'p_rifle', 'p_mg'] }, { weakTo: ['coastal'] });
ctE('p_supply', '072 型后勤登陆舰', 'p', 'naval', 'ship', 30, CT_IC.ls, [6, 1, 0, 0, 4, 3, 10], '自带 4 个小组与 3 名工兵：抢滩后建立滩头补给站与浮桥补给线，为附近部队补充弹药、恢复士气。',
  { kind: 'ship', at: 'sea', ship: 'supply', teams: 4, eng: 3, hp: 11, pre: 'LS', wave: 2 }, { weakTo: ['arty', 'coastal'] });
ctE('p_supply_h', '072 型后勤登陆舰（加固）', 'p', 'naval', 'ship', 38, CT_IC.ls + ctDots(1), [8, 2, 0, 0, 4, 3, 10], '加装装甲与损管的补给舰，更能扛住岸炮，补给站更稳。',
  { kind: 'ship', at: 'sea', ship: 'supply', teams: 4, eng: 3, hp: 16, pre: 'LS', wave: 2 }, { weakTo: ['coastal'] });
ctE('p_rocket', '火箭支援艇（122 毫米）', 'p', 'naval', 'fire_ship', 40, CT_IC.rlct, [4, 1, 9, 6, 5, 3, 0], '开战后驶近目标滩头，一次齐射数十枚火箭覆盖滩头阵地；只能齐射两轮。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 0, hp: 8, pre: 'LR', role: 'rocket' }, { counters: ['inf_e', 'wire', 'mines'], weakTo: ['coastal'] });
ctE('p_lcs', '火力支援艇', 'p', 'naval', 'fire_ship', 32, CT_IC.lcs, [5, 1, 5, 5, 6, 4, 0], '近岸游弋的炮艇，持续以 40 毫米炮射击滩头 350 内看得见的敌人。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 0, hp: 9, pre: 'GS', role: 'gun' }, { counters: ['inf_e', 'bunker'], weakTo: ['coastal'] });
ctE('p_sweep', '082Ⅱ型扫雷舰', 'p', 'naval', 'sweep', 30, CT_IC.sweep, [4, 1, 0, 0, 5, 4, 0], '驶往目标滩头近岸，清除水下障碍并标定滩头雷区，为登陆艇开辟航道。',
  { kind: 'ship', at: 'sea', ship: 'assault', cap: 0, hp: 8, pre: 'MS', role: 'sweep' }, { counters: ['obst', 'mines'], weakTo: ['coastal'] });
ctE('p_dd', '052C 型驱逐舰', 'p', 'naval', 'dd', 120, CT_IC.dd, [6, 3, 7, 9, 7, 5, 0], '标准驱逐舰：舰炮射程 1000，可打烟幕弹；开火时会暴露位置招来反炮兵射击。48 个垂发单元全装红旗-9 舰空导弹（无对陆导弹）。',
  { kind: 'dd', at: 'sea', hull: 3, rof: 1, salvo: 1, rep: 16 }, { counters: ['bunker', 'coastal'], weakTo: ['coastal'] });
ctE('p_dd_h', '052D 型驱逐舰', 'p', 'naval', 'dd', 150, CT_IC.ddh, [7, 3, 8, 9, 7, 5, 0], '射速更快，船体能多扛一发。64 个垂发单元：红旗-9B 32、长剑-10 12、鹰击-18A 12、鱼-8 8。',
  { kind: 'dd', at: 'sea', hull: 4, rof: 1.3, salvo: 1, rep: 15 }, { counters: ['bunker', 'coastal'], weakTo: ['coastal'] });
ctE('p_dd_e', '054A 型护卫舰', 'p', 'naval', 'dd', 90, CT_IC.dde, [4, 2, 5, 9, 8, 5, 0], '便宜的护航舰，火力较弱、损管快，额外携带 2 发烟幕弹。32 个垂发单元装红旗-16 中程舰空导弹。',
  { kind: 'dd', at: 'sea', hull: 2, rof: .85, salvo: 1, rep: 10, smoke: 2, hit: .8 }, { weakTo: ['coastal'] });
ctE('p_cl', '055 型驱逐舰', 'p', 'naval', 'dd', 200, CT_IC.cl, [8, 4, 9, 9, 6, 6, 0], '每次射击两发齐射，船体 5。112 个垂发单元：红旗-9B 56、长剑-10（亚音速）24、鹰击-18A（超音速）16、鹰击-21（高超音速）8、鱼-8 8；打光由 901 型补给舰补给。',
  { kind: 'dd', at: 'sea', hull: 5, rof: .9, salvo: 2, rep: 18, hit: 1.1 }, { counters: ['coastal', 'bunker', 'arty'], weakTo: ['coastal'] });
ctE('p_ca', '055 型驱逐舰（加强火力型）', 'p', 'naval', 'dd', 260, CT_IC.ca, [10, 5, 10, 9, 5, 6, 0], '三发齐射的重炮舰，船体 6；垂发配比同 055 型（112 单元）。',
  { kind: 'dd', at: 'sea', hull: 6, rof: .75, salvo: 3, rep: 20, hit: 1.2 }, { counters: ['coastal', 'bunker', 'arty'] });
ctE('p_cv', '003 型航母（福建舰）', 'p', 'air', 'cv', 150, CT_IC.cv, [9, 2, 0, 0, 3, 5, 0], '搭载最多 30 架舰载机（甲板停 12 架，其余在机库待命）；没有航母就没有空中支援。甲板中弹会影响起降。',
  { kind: 'cv', at: 'sea', hp: 30, wing: 30 }, { weakTo: ['coastal'] });
ctE('p_cve', '075 型两栖攻击舰', 'p', 'air', 'cv', 90, CT_IC.cve, [6, 1, 0, 0, 3, 5, 0], '小型航母，最多 6 架舰载机，甲板更脆弱。',
  { kind: 'cv', at: 'sea', hp: 18, wing: 6 }, { weakTo: ['coastal'] });

// ———— 进攻方 · 舰载机（需要航母，无需位置）————
ctE('p_air_recon', '空警-600 舰载预警机', 'p', 'air', 'wing', 15, CT_IC.arecon, [2, 0, 0, 0, 7, 10, 0], '福建舰弹射起飞的固定翼预警机：纵贯飞越敌岸照相侦察、揭示火力点；涡桨机慢，易被高炮击落。',
  { kind: 'wing', at: 'air', type: 'recon', n: 1 }, { counters: ['arty', 'coastal'], weakTo: ['aa'] });
ctE('p_air_recon_lr', '无侦-7 高空无人侦察机（战区）', 'p', 'air', 'wing', 20, CT_IC.awz7, [3, 0, 0, 0, 7, 10, 0], '菱形连翼的高空长航时无人机，从战区机场起飞、不占航母机库：在两万米高空飞过，高炮够不着，照相带更宽、成果保留更久。',
  { kind: 'wing', at: 'none', type: 'recon', n: 1, v: 'lr', land: true }, { counters: ['arty', 'coastal'], weakTo: ['e_air_ftr'] });
ctE('p_air_strike', '歼-35 隐身舰载战斗机', 'p', 'air', 'wing', 30, CT_IC.aj35, [3, 0, 7, 6, 9, 5, 0], '攻击机（T 键）。隐身舰载战斗机：内埋弹舱的精确制导炸弹在目标 170 外投放后立即掉头，不飞进敌防空圈；雷达难发现、防空难打中。',
  { kind: 'wing', at: 'air', type: 'strike', n: 1 }, { counters: ['coastal', 'arty', 'bunker', 'aa'], weakTo: ['e_air_ftr'] });
ctE('p_air_ftr_adv', '歼-35（防空压制型）', 'p', 'air', 'wing', 32, CT_IC.aj35 + ctDots(1), [3, 0, 7, 8, 9, 6, 0], '攻击机（T 键）。挂反辐射导弹的歼-35：在 300 外自动瞄准目标附近已知的敌高炮、防空车与暴露的防空导弹组，为对地支援机、攻击机打开空中通道；指挥员会在敌防空强的地域先派它去。',
  { kind: 'wing', at: 'air', type: 'strike', n: 1, v: 'sead' }, { counters: ['aa', 'e_aa_radar', 'e_sam_veh', 'e_aa_veh', 'e_manpads'], weakTo: ['e_air_ftr'] });
ctE('p_air_dive', '攻击-11 隐身无人攻击机', 'p', 'air', 'wing', 26, CT_IC.agj11, [3, 0, 8, 0, 8, 4, 0], '轰炸机（Y 键）。飞翼布局的隐身无人攻击机：对点目标俯冲，投下两枚重磅炸弹，几乎正中岸防炮、碉堡；俯冲时更容易被高炮打中。',
  { kind: 'wing', at: 'air', type: 'bomber', n: 1, v: 'dive' }, { counters: ['coastal', 'bunker'], weakTo: ['aa'] });
ctE('p_air_heavy', '轰-6K 轰炸机（战区）', 'p', 'air', 'wing', 34, CT_IC.heavy, [4, 0, 10, 0, 6, 3, 0], '轰炸机（Y 键）。陆基中程轰炸机，从战区机场起飞、不占航母机库：沿进场方向投下六枚重磅炸弹地毯轰炸炮兵阵地群与堑壕；飞得高，轻型高炮不易打中；散布大，离我军 150 以内慎用。',
  { kind: 'wing', at: 'none', type: 'bomber', n: 1, v: 'heavy', land: true }, { counters: ['arty', 'trench', 'wire'], weakTo: ['e_aa_heavy', 'e_air_ftr'] });
ctE('p_air_cas', '攻击-2 察打一体无人机（战区）', 'p', 'air', 'wing', 22, CT_IC.acas, [3, 0, 6, 0, 5, 7, 0], '对地支援（V 键）。长航时察打一体无人机，从战区机场起飞、不占航母机库：在受压制的我军上空盘旋 60 秒，用机载导弹点名守军。',
  { kind: 'wing', at: 'none', type: 'cas', n: 1, land: true }, { counters: ['inf_e', 'mortar'], weakTo: ['aa', 'e_manpads'] });
ctE('p_air_fb', '歼-15T 舰载战斗机', 'p', 'air', 'wing', 28, CT_IC.aj15, [3, 0, 7, 0, 9, 5, 0], '对地支援（V 键）。福建舰弹射型歼-15：到场先投一枚炸弹再扫射，盘旋时间较短。',
  { kind: 'wing', at: 'air', type: 'cas', n: 1, v: 'fb' }, { counters: ['inf_e', 'bunker'], weakTo: ['aa'] });
ctE('p_air_ftr', '歼-20 隐身战斗机（战区）', 'p', 'air', 'wing', 36, CT_IC.aftr, [3, 0, 7, 9, 10, 8, 0], '制空战斗机（W 键），从战区机场起飞、不占航母机库：在指定空域巡逻 90 秒，4 枚霹雳-15（射程比敌 AIM-120 远）加 2 枚霹雳-10 拦截敌攻击机、武装直升机与 F-35A；隐身，敌雷达很晚才发现它。掌握制空权后敌机难以出动。',
  { kind: 'wing', at: 'none', type: 'fighter', n: 1, land: true }, { counters: ['e_air_ga', 'e_air_heli', 'e_air_ftr'], weakTo: ['e_aa_radar'] });
// 武器与机体参数记录（v13）：公开资料与估算（官方大多没有公布，数字有出入时取常见说法并注明），g = 游戏里的取值。目前用于歼-36 的挂载表（图鉴、沙盒条目）
const WPN = {
  pl15: { nm: '霹雳-15', kind: '中远程空空导弹', guide: '惯导 + 双向数据链中段修正，末段主动相控阵（AESA）雷达导引头（也有被动模式）', motor: '双脉冲固体火箭发动机',
    len: '约 4.0 米（3996 毫米）', dia: '203 毫米', mass: '约 210 公斤（出口型 PL-15E 公布值）', rng: '出口型 PL-15E 公布 145 公里；本型各方估计 200–300 公里不等', spd: '4 马赫以上（也有 5 马赫的说法，估算）',
    note: '为隐身战斗机内埋弹舱设计，控制舵面截短；歼-20 主弹舱挂 4 枚', g: '射程 560（还要飞进本机雷达对目标的锁定距离），间隔 1.2 秒连射，命中率随目标类型与隐身打折' },
  pl10: { nm: '霹雳-10', kind: '近距格斗空空导弹', guide: '红外成像导引头，配合头盔瞄准具可大离轴发射', motor: '固体火箭发动机 + 推力矢量',
    len: '约 3.0 米', dia: '约 160 毫米', mass: '约 89 公斤（公开估算）', rng: '约 20 公里（公开估算）', spd: '约 4 马赫（估算）',
    note: '歼-20 侧弹舱挂载的近距弹；游戏里五代机不进格斗，主要留作自卫', g: '计入导弹总数；超视距战法下很少用到' },
  pl17: { nm: '霹雳-17', kind: '超远程空空导弹', guide: '惯导 + 卫星导航 + 数据链中段制导，末段主动相控阵雷达 + 红外复合导引头', motor: '双脉冲固体火箭发动机',
    len: '约 6 米', dia: '未公开', mass: '未公开', rng: '估计 300–500 公里（英国皇家联合军种研究所称 400 公里级）', spd: '4 马赫以上（估算）',
    note: '主要用来打预警机、加油机这类大而笨的高价值目标，不是为了和战斗机格斗；平时由歼-16 外挂，歼-20 弹舱放不下；歼-36 主弹舱长约 7.6 米，内埋两枚属推测；也有人称它霹雳-20 / PL-XX', g: '射程 900；打运输机、攻击机、直升机命中率 ×1.15，打战斗机 ×0.75；在霹雳-15 射程外或霹雳-15 打光时才用' },
  ls6: { nm: '雷石-6', kind: '滑翔制导炸弹（加装套件）', guide: '惯导 + 卫星导航（改型可选激光、红外或景象匹配末制导）', motor: '无动力滑翔（2024 年珠海航展展出过加装涡喷发动机的增程方案）',
    len: '随弹体', dia: '随弹体', mass: '有 50 / 100 / 250 / 500 公斤级四种', rng: '公开资料没有可靠数字（高空投放可滑翔数十公里）', spd: '亚音速滑翔',
    note: '给普通航弹加装弹翼与制导组件的增程精确制导套件；游戏里歼-36 打击型挂 500 公斤级，内埋属推测', g: '投放距离 900，爆炸半径 30、对工事毁伤 30；飞得慢，敌防空车、陆基密集阵每次拦截有 35% 把握' }
};
// 机体参数（公开估算）
const AIRDATA = {
  j36: [['首次曝光', '2024 年 12 月 26 日在成都被拍到试飞，由一架歼-20S 伴飞；「歼-36」是外界按机头编号 36011 起的称呼'], ['研制', '成都飞机工业集团（外界判断）'],
    ['布局', '无尾双菱形（改进型三角）翼，翼尖开裂式方向舵；扁平尾喷口'], ['机长', '约 22.5–23 米（歼-20 约 21 米）'], ['翼展', '约 19 米（另有 24 米的估算）'],
    ['最大起飞重量', '约 50–60 吨，常见估算 55 吨（歼-20 约 37 吨）'], ['发动机', '3 台涡扇：两侧各一个进气道，背部一个进气道；型号未公开'],
    ['弹舱', '主弹舱长约 7.6 米；两侧小弹舱是否存在还没有定论'], ['作战半径', '估计约 3000 公里'], ['座舱', '有并列双座和单座两种说法'], ['官方参数', '未公布，以上均为公开报道中的估算'],
    ['游戏里', '隐身系数 0.2（F-22A 0.3、歼-20 0.35）；机载雷达 900（歼-20 520）；速度 300；转弯慢（1.7，歼-20 2.3）、不带航炮，敌战斗机逼近 300 就加速拉开；一次巡逻 4 分钟；陆基，不占航母机库']],
  j50: [['首次曝光', '2024 年 12 月 26 日在沈阳被拍到试飞；「歼-50」是外界的称呼（也有人叫歼-XDS），官方没有公布型号'], ['研制', '沈阳飞机工业集团（外界判断）'],
    ['布局', 'λ 形无尾翼（后掠前缘、后缘转折），翼尖可偏转控制面；双发、背部进气的说法未证实'], ['尺寸', '比歼-36 小，外界估算机长约 18–20 米'],
    ['舰载', '沈飞造过歼-15、歼-35 等舰载机，外界普遍推测它会发展舰载型，配合福建舰电磁弹射'], ['官方参数', '未公布，以上均为公开报道中的推测'],
    ['游戏里', '舰载（占航母机库），隐身系数 0.22；机载雷达 800；速度 290；6 枚霹雳-15 + 2 枚霹雳-10；不带航炮，只打超视距：发射后侧转、敌机逼近就拖开']]
};
// 挂载表 HTML（图鉴详情、沙盒条目说明共用）：c.load = [[武器键, 枚数], ...]，c.air = AIRDATA 键
function ctLoadHtml(c, esc) {
  if (!c || !(c.load || c.air)) return '';
  const row = (k, v) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
  const w = (c.load || []).map(([k, n]) => { const o = WPN[k]; return o ? `<section><h4>${esc(o.nm)} ×${n}<small>${esc(o.kind)}</small></h4><dl>${row('制导', o.guide)}${row('动力', o.motor)}${row('弹长', o.len)}${row('弹径', o.dia)}${row('重量', o.mass)}${row('射程', o.rng)}${row('速度', o.spd)}${row('说明', o.note)}${row('游戏里', o.g)}</dl></section>` : ''; }).join('');
  const a = c.air && AIRDATA[c.air] ? `<section><h4>机体<small>公开估算</small></h4><dl>${AIRDATA[c.air].map(([k, v]) => row(k, v)).join('')}</dl></section>` : '';
  return `<div class="ct-load"><b>挂载与参数（挂载按弹舱尺寸推测）</b>${w}${a}</div>`;
}
// 歼-36（v13）：官方未公布参数，外形尺寸按公开估算，挂载按弹舱尺寸推测；很贵（lim）
ctE('p_air_j36', '歼-36 第六代战斗机（制空型）', 'p', 'air', 'wing', 500, CT_IC.aj36 || CT_IC.aftr, [4, 0, 9, 10, 10, 10, 0], '成飞的第六代隐身战斗机原型机（2024 年 12 月 26 日首次被拍到试飞；「歼-36」是外界按机头编号 36011 起的称呼，官方没有公布任何参数）。按公开估算：机长约 23 米、翼展约 19 米、最大起飞重量约 55 吨（歼-20 约 37 吨），无尾双菱形翼，三台涡扇（两侧进气加一个背部进气），主弹舱长约 7.6 米，作战半径约 3000 公里。游戏里：比 F-22A 更难被发现（敌机要飞到约 200 以内才锁得住它），机头大雷达 900 外就能锁定普通目标、550 外锁定 F-35A；主弹舱按尺寸推测挂 2 枚霹雳-17 远程空空导弹（射程 900，打运输机、攻击机这种大目标最准）加 6 枚霹雳-15；一次巡逻 4 分钟，从战区机场起飞、不占航母机库。体型大又没有尾翼，转弯慢、不带航炮：敌战斗机逼近就加速拉开，不进缠斗。',
  { kind: 'wing', at: 'none', type: 'fighter', n: 1, v: 'j36', land: true }, { counters: ['e_air_f22', 'e_air_ftr', 'e_air_ga', 'e_air_heli', 'e_101'], weakTo: [], load: [['pl17', 2], ['pl15', 6]], air: 'j36' });
ctE('p_air_j50', '歼-50 第六代舰载战斗机', 'p', 'air', 'wing', 420, CT_IC.aj50 || CT_IC.aj36 || CT_IC.aftr, [4, 0, 9, 10, 10, 9, 0], '沈飞的第六代隐身战斗机原型机（2024 年 12 月 26 日被拍到试飞；「歼-50」是外界的称呼，官方没有公布任何参数），外界推测会发展舰载型。游戏里按舰载机：从航母弹射起飞、占机库；隐身系数 0.22（歼-20 0.35、F-22A 0.3），机载雷达 800，挂 6 枚霹雳-15 与 2 枚霹雳-10；不带航炮、不进格斗，按现实的超视距打法：先敌发现、远距离发射后侧转保持照射，敌机逼近就转身拖开，导弹打光即返航。',
  { kind: 'wing', at: 'none', type: 'fighter', n: 1, v: 'j50' }, { counters: ['e_air_f22', 'e_air_ftr', 'e_air_ga', 'e_air_heli', 'e_101'], weakTo: ['e_sam_veh'], load: [['pl15', 6], ['pl10', 2]], air: 'j50' });
ctE('p_air_j36s', '歼-36 第六代战斗机（打击型）', 'p', 'air', 'wing', 520, CT_IC.aj36 || CT_IC.aftr, [4, 0, 10, 10, 10, 10, 0], '同一机体换对地挂载（按弹舱尺寸推测）：4 枚雷石-6 滑翔制导炸弹加 4 枚霹雳-15。巡逻时在 900 以内自己挑已发现的高价值目标，一个一个用滑翔炸弹敲掉：防空炮、防空车、导弹发射车、岸舰导弹、岸炮、炮兵、机场跑道；遇到敌战斗机用霹雳-15 自卫、不进缠斗。滑翔炸弹飞得慢，敌防空车和陆基密集阵有机会拦下。其余性能同制空型。',
  { kind: 'wing', at: 'none', type: 'fighter', n: 1, v: 'j36s', land: true }, { counters: ['aa', 'e_aa_radar', 'e_sam_veh', 'e_aa_veh', 'e_tel', 'e_ascm', 'coastal', 'arty', 'e_airfield'], weakTo: ['e_air_f22', 'e_lpws'], load: [['ls6', 4], ['pl15', 4]], air: 'j36' });
ctE('p_air_heli', '直-10 武装直升机', 'p', 'air', 'wing', 30, CT_IC.heli, [3, 1, 6, 0, 5, 6, 0], '对地支援（V 键）。从两栖攻击舰起飞：低空悬停时间长达 70 秒，扫射压制更强；速度慢。',
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
ctE('p_tbm', '东风-15B 战术导弹（2 枚）', 'p', 'support', 'missile', 60, CT_IC.tbm, [0, 0, 10, 10, 0, 0, 0], '战术弹道导弹：战区火箭军发射，约 10 秒命中，一发可摧毁碉堡或岸防炮；雷达高炮可能拦截。快捷键 I。（驱逐舰自带的垂发巡航 / 超音速导弹按 Y）',
  { kind: 'asset', at: 'none', key: 'msl', add: 2 }, { counters: ['coastal', 'e_tel', 'e_ascm', 'e_airfield'], weakTo: ['e_aa_radar'] });
ctE('p_nuke', '战术核弹（低当量，1 枚）', 'p', 'support', 'missile', 1200, CT_IC.nuke, [0, 0, 10, 10, 0, 0, 0], '单独购买的战术核武器：战区火箭军发射，约 15 秒落地（发射即向全战场发出核打击预警）。爆心 60 米内一切人员、车辆、工事、舰船毁灭，140 米内重创，280 米内压制、士气崩溃；不分敌我，落点 300 米内有我军就拒绝发射。留下约 2 分 30 秒的辐射区，进入的人员持续伤亡。末段仍可能被拦截。支援栏「核」按钮。',
  { kind: 'asset', at: 'none', key: 'nuke', add: 1 }, { counters: ['coastal', 'arty', 'bunker', 'inf_e'], weakTo: ['e_aa_radar'] });
ctE('p_abn', '空降兵营（运-20 伞降夺取机场）', 'p', 'support', 'asset', 260, '<path d="M4 9a8 6 0 0 1 16 0z"/><path d="M4 9l8 6 8-6M9 9l3 6 3-6"/><circle class="f" cx="12" cy="16.2" r="1.5"/><rect x="2" y="19" width="20" height="3" rx=".5"/><path d="M5 20.5h2M11 20.5h2M17 20.5h2"/>', [5, 1, 8, 7, 7, 7, 60], '解放军空降兵一个营，专门用来夺取敌野战机场（敌方要有机场）：4 架运-20 从海上进场，伞降 60 人（三个连，含突击、机枪、红箭-12 反坦克、前卫防空和工兵组），并重装空投 ZBD-03 伞兵战车 2 辆、弹药 3 箱。夺取后工兵抢修跑道（守军炸过的要两分多钟），修通后运-20 依次机降 ZTQ-15 轻型坦克 2 辆、机降步兵连和弹药油料；有了油料，我方陆基飞机（歼-20、歼-36、轰-6K、攻击-2 等）改在这里降落整备，45 秒就能再出击。AI 指挥时会等主力在滩头站稳、先打掉航线上的防空再空降，并让主力向机场方向打通会师。快捷键 Shift+K，点敌机场附近。',
  { kind: 'asset', at: 'none', key: 'abn', add: 1 }, { counters: ['e_airfield', 'e_air_ga', 'e_air_heli', 'e_air_ftr', 'e_air_f22'], weakTo: ['aa', 'e_aa_radar', 'e_sam_veh', 'e_air_f22'] });
ctE('p_para', '蛟龙突击队（运-20 伞降）', 'p', 'support', 'asset', 140, CT_IC.para, [6, 1, 9, 8, 7, 8, 18], '海军陆战队特种部队：两架运-20 从海上飞来，高跳低开 6 个组 18 人——突击组 ×2、双机枪火力组、红箭-12 反坦克组、QBU-202 狙击组、前卫-2 防空组。射击精度 1.6 倍、射速 1.3 倍，防弹插板让近一半的致命伤只是负伤，被压制和伤亡对士气的打击减半；落地后自动夺取附近据点、与正面夹击。运输机仍可能被高炮、防空导弹与敌机击落。快捷键 Shift+P。',
  { kind: 'asset', at: 'none', key: 'para', add: 1 }, { counters: ['arty', 'mortar', 'coastal'], weakTo: ['aa', 'e_air_ftr'] });
ctE('p_airdrop', '空投补给（运-20，2 次）', 'p', 'support', 'asset', 30, CT_IC.drop, [0, 0, 0, 0, 0, 0, 0], '运输机向指定地点投下 3 箱弹药，形成 4 分钟的临时补给点：附近步兵与车辆就地补充弹药，补给线被切断也能接着打。快捷键 Shift+O。',
  { kind: 'asset', at: 'none', key: 'drop', add: 2 }, { weakTo: ['aa'] });
ctE('p_sortie_recon', '战前空中侦察', 'p', 'support', 'sortie', 15, CT_IC.srecon, [0, 0, 0, 0, 0, 9, 0], '开战时对指定地点照相侦察 30 秒，半径约 160。',
  { kind: 'sortie', at: 'target', t: 'recon', r: 160 }, { counters: ['coastal', 'arty'] });
ctE('p_sortie_bomb', '战前轰炸', 'p', 'support', 'sortie', 35, CT_IC.sbomb, [0, 0, 8, 0, 0, 0, 0], '开战后 6 秒内对指定地点投下 8 枚炸弹；看不见的目标也会被覆盖，但散布较大。',
  { kind: 'sortie', at: 'target', t: 'bomb', n: 8 }, { counters: ['bunker', 'wire', 'mines'] });
ctE('p_sortie_naval', '舰炮火力准备', 'p', 'support', 'sortie', 30, CT_IC.snaval, [0, 0, 7, 0, 0, 0, 0], '开战后 3–15 秒，外海舰队对指定地点进行 6 发舰炮覆盖射击。',
  { kind: 'sortie', at: 'target', t: 'naval', n: 6 }, { counters: ['bunker', 'trench'] });

// ———— 防守方 · 步兵（放在陆上；按最近据点编入守备、预备或伏击）————
ctE('e_garrison', '步兵排（M4A1 卡宾枪）', 'e', 'inf', 'inf_e', 24, CT_IC.egar, [5, 0, 4, 5, 3, 6, 9], '三个三人组，就近守备据点并利用掩体；据点受威胁时坚守或反击。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 3, men: ['rifle', 'rifle', 'mg'] }, { counters: ['p_rifle'], weakTo: ['p_flame', 'veh', 'arty'] });
ctE('e_mg_nest', 'M240 机枪班', 'e', 'inf', 'inf_e', 22, CT_IC.emg, [4, 0, 5, 6, 2, 6, 6], '两挺机枪的火力班，压制能力强，专封滩头出口。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 2, men: ['mg', 'mg', 'rifle'], mod: { sup: 1.3 } }, { counters: ['p_rifle', 'p_marine'], weakTo: ['p_mortar', 'veh'] });
ctE('e_ambush', '滩头伏击组', 'e', 'inf', 'inf_e', 18, CT_IC.eamb, [4, 0, 4, 4, 3, 5, 6], '潜伏在滩顶堑壕，敌人上滩到 80 以内才开火；被压倒时撤向出口据点。',
  { kind: 'einf', at: 'land', role: 'ambush', teams: 2, men: ['rifle', 'rifle', 'mg'] }, { counters: ['p_eng', 'p_rifle'], weakTo: ['arty', 'p_rocket'] });
ctE('e_reserve', '机动预备队（步兵连）', 'e', 'inf', 'inf_e', 28, CT_IC.eres, [5, 0, 4, 5, 4, 6, 9], '驻扎在镇子或路口，由守军指挥官调往压力最大的据点。',
  { kind: 'einf', at: 'land', role: 'reserve', teams: 3, men: ['rifle', 'rifle', 'mg'] }, { counters: ['p_rifle'], weakTo: ['p_air_cas', 'veh'] });
ctE('e_assault', '反击突击连', 'e', 'inf', 'inf_e', 40, CT_IC.easlt, [7, 0, 6, 5, 4, 6, 10], '四个精锐小组，士气高、射击准，用于夺回失守的据点。',
  { kind: 'einf', at: 'land', role: 'reserve', teams: 4, men: ['rifle', 'mg', 'mg'], mod: { pow: 1.15 }, morale: 92 }, { counters: ['p_rifle', 'p_eng'], weakTo: ['p_air_cas', 'arty'] });
ctE('e_sniper', '狙击手（M2010）', 'e', 'inf', 'inf_e', 12, CT_IC.esniper, [2, 0, 4, 9, 3, 8, 2], '两人狙击组，优先射杀通讯兵，令登陆部队视野与指挥中断。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 1, men: ['rifle', 'rifle'], mod: { pow: 2.2, rng: 1.6, rof: .55, sup: .5 } }, { counters: ['p_fo', 'p_hq'], weakTo: ['mortar', 'p_air_cas'] });
ctE('e_at', '标枪反坦克组（FGM-148）', 'e', 'inf', 'inf_e', 20, CT_IC.eat, [4, 0, 3, 4, 3, 5, 6], '两个标枪导弹组：发射后不管、攻顶，射程约 270，从顶部击穿上岸的坦克与装甲车。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 2, men: ['rifle', 'rifle', 'rifle'], mod: { at: 1.5, atPen: 3.4, rng: 1.6, pow: .8 } }, { counters: ['veh'], weakTo: ['p_rifle', 'p_mg'] });
ctE('e_militia', '国民警卫队步兵', 'e', 'inf', 'inf_e', 14, CT_IC.emil, [4, 0, 2, 4, 3, 5, 9], '便宜的地方武装，人数多但射击差、容易溃散；适合填充次要据点。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 3, men: ['rifle', 'rifle', 'rifle'], mod: { pow: .65, sup: .8 }, morale: 40 }, { weakTo: ['p_rifle', 'p_mg', 'veh'] });
ctE('e_eng', '守军工兵', 'e', 'inf', 'eng_e', 15, CT_IC.eeng, [3, 0, 2, 4, 3, 5, 3], '抢修 40 以内受损的碉堡与炮位，每秒恢复少量耐久。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 1, men: ['rifle', 'rifle', 'rifle'], mod: { pow: .7 }, tag: 'eeng' }, { weakTo: ['inf_p'] });
ctE('e_manpads', '毒刺防空组（FIM-92）', 'e', 'inf', 'inf_e', 22, CT_IC.emanpads, [3, 0, 2, 7, 3, 6, 3], '携带 3 枚单兵防空导弹的守备组，专打低空盘旋的对地支援机、俯冲的攻击机与武装直升机；发射即暴露位置。',
  { kind: 'einf', at: 'land', role: 'garrison', teams: 1, men: ['rifle', 'rifle', 'aa'], tag: 'manpads' }, { counters: ['p_air_cas', 'p_air_heli', 'p_air_dive'], weakTo: ['inf_p', 'p_mortar'] });

// ———— 防守方 · 装甲 ————
ctE('e_car', 'M1117 装甲警戒车', 'e', 'armor', 'car_e', 25, CT_IC.ecar, [4, 2, 3, 5, 8, 7, 3], '轮式装甲车：在镇子待命，据点受威胁时驰援，以车载机枪扫射；轻武器打不穿。',
  { kind: 'car', at: 'land' }, { counters: ['p_rifle', 'p_eng'], weakTo: ['p_at', 'p_td', 'p_air_strike'] });
ctE('e_lt_tank', 'M10 布克轻型坦克', 'e', 'armor', 'veh', 30, CT_IC.m10, [4, 2, 4, 5, 8, 6, 4], '快速机动的轻坦克，作为预备队反击滩头。',
  { kind: 'veh', at: 'land', type: 'lt_tank' }, { counters: ['inf_p'], weakTo: ['p_at', 'p_td'] });
ctE('e_tank', 'M1A1 艾布拉姆斯主战坦克', 'e', 'armor', 'veh', 45, CT_IC.m1a1, [6, 3, 6, 6, 6, 6, 5], '主力反击坦克，与步兵协同时对登陆部队威胁极大。',
  { kind: 'veh', at: 'land', type: 'tank' }, { counters: ['inf_p', 'p_lt_tank'], weakTo: ['p_td', 'p_air_strike', 'p_dd'] });
ctE('e_hv_tank', 'M1A2 SEPv3 艾布拉姆斯', 'e', 'armor', 'veh', 72, CT_IC.m1a2, [9, 4, 8, 6, 4, 5, 5], '120 毫米滑膛炮、贫铀复合装甲，正面几乎打不穿；车重 70 吨，空袭与舰炮是克星。',
  { kind: 'veh', at: 'land', type: 'hv_tank' }, { counters: ['p_tank', 'inf_p'], weakTo: ['p_air_dive', 'p_ca'] });
ctE('e_td', 'M1134 斯特赖克反坦克车', 'e', 'armor', 'veh', 48, CT_IC.m1134, [5, 3, 7, 8, 5, 5, 4], '隐蔽在出口后方，专打上岸的坦克。',
  { kind: 'veh', at: 'land', type: 'td' }, { counters: ['p_tank', 'p_amtank'], weakTo: ['inf_p', 'arty'] });
ctE('e_spg', 'M109A7 帕拉丁自行榴弹炮', 'e', 'armor', 'veh', 48, CT_IC.m109, [4, 1, 7, 9, 5, 4, 4], '机动的炮兵：对已发现的目标间接射击，打完就换位。',
  { kind: 'veh', at: 'land', type: 'spg' }, { counters: ['inf_p'], weakTo: ['p_air_strike', 'p_recon'] });
ctE('e_apc', 'M2A3 布雷德利步兵战车', 'e', 'armor', 'veh', 28, CT_IC.m2a3, [5, 2, 2, 4, 7, 5, 2], '车载机枪支援反击，轻武器打不穿。',
  { kind: 'veh', at: 'land', type: 'apc' }, { counters: ['inf_p'], weakTo: ['p_at', 'veh'] });
ctE('e_aa_veh', 'M163 火神自行高炮', 'e', 'armor', 'veh', 34, CT_IC.m163, [4, 1, 6, 5, 6, 5, 4], '伴随预备队的机动高炮，也能平射压制步兵。',
  { kind: 'veh', at: 'land', type: 'aa_veh' }, { counters: ['wing', 'inf_p'], weakTo: ['p_tank', 'p_dd'] });
ctE('e_sam_veh', 'M-SHORAD 防空车（斯特赖克）', 'e', 'armor', 'veh', 52, CT_IC.mshorad, [4, 1, 6, 8, 6, 7, 3], '弹炮合一的机动防空车：机关炮与近程导弹打 520 内的敌机，还能拦截落向附近的敌战术导弹；放在指挥所、机场、炮兵阵地附近最有用，导弹尾焰会暴露位置。',
  { kind: 'veh', at: 'land', type: 'sam_veh' }, { counters: ['wing', 'p_tbm'], weakTo: ['p_tank', 'p_air_dive'] });
ctE('e_lpws', 'LPWS 陆基密集阵（C-RAM）', 'e', 'armor', 'veh', 50, CT_IC.lpws, [4, 1, 5, 6, 3, 6, 3], '陆基型“密集阵”20 毫米近防炮：在空中打掉 260 以内落下的舰炮炮弹、迫击炮弹与火箭弹，保护指挥所、机场与炮兵阵地；开火曳光会暴露位置。',
  { kind: 'veh', at: 'land', type: 'aa_veh', mod: { cram: 1 } }, { counters: ['p_dd', 'p_mortar', 'p_rocket', 'p_spg'], weakTo: ['p_tank', 'p_air_strike'] });
ctE('e_recon', 'M1127 斯特赖克侦察车', 'e', 'armor', 'veh', 22, CT_IC.m1127, [3, 1, 2, 4, 9, 9, 3], '快速侦察，为炮兵指示目标。',
  { kind: 'veh', at: 'land', type: 'recon' }, { counters: ['p_eng'], weakTo: ['p_mg', 'veh'] });
ctE('e_flame_tank', 'M1150 突击破障车', 'e', 'armor', 'veh', 48, CT_IC.m1150, [6, 3, 8, 3, 5, 5, 4], '美军没有喷火坦克，这里改为艾布拉姆斯底盘的突击破障车：近距发射直列爆破装药与温压弹，对挤在一起的登陆部队与工事极其致命。',
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
ctE('e_coastal_l', '轻型岸防炮（M119 105 毫米）', 'e', 'arty', 'coastal', 35, CT_IC.ecoastl + ctBars(1), [5, 3, 5, 6, 0, 7, 4], '中小口径速射岸炮，射程较近但射速快，专打登陆艇。',
  { kind: 'enemy', at: 'coast', ek: 'coastal', hp: .65, mod: { rof: 1.7, rng: .8 } }, { counters: ['p_lct', 'p_lcvp'], weakTo: ['p_dd', 'p_air_strike'] });
ctE('e_coastal_m', '中型岸防炮（M777 155 毫米）', 'e', 'arty', 'coastal', 48, CT_IC.ecoastm + ctBars(2), [6, 4, 7, 8, 0, 7, 5], '兼顾射速与射程的岸炮。',
  { kind: 'enemy', at: 'coast', ek: 'coastal', hp: .85, mod: { rof: 1.25, rng: .92 } }, { counters: ['ship'], weakTo: ['p_dd', 'p_air_strike'] });
ctE('e_coastal_h', '岸防重炮', 'e', 'arty', 'coastal', 60, CT_IC.coastal + ctBars(3), [8, 5, 9, 9, 0, 8, 6], '射程 600 的重炮，可威胁驱逐舰与航母；雷达站在时可夜视海面。',
  { kind: 'enemy', at: 'coast', ek: 'coastal', hp: 1 }, { counters: ['dd', 'cv', 'ship'], weakTo: ['p_ranger', 'p_air_dive', 'p_ca'] });
ctE('e_rail', '列车炮', 'e', 'arty', 'coastal', 75, CT_IC.rail, [6, 3, 10, 10, 0, 7, 8], '超远射程的铁道重炮，射程是普通岸炮的 1.4 倍，射速慢。',
  { kind: 'enemy', at: 'coast', ek: 'coastal', hp: .8, mod: { rng: 1.4, rof: .55 } }, { counters: ['cv', 'dd'], weakTo: ['p_air_heavy'] });
ctE('e_coastal_r', '雷达引导岸防炮', 'e', 'arty', 'coastal', 80, CT_IC.radgun, [7, 4, 9, 9, 0, 10, 6], '自带火控雷达：不依赖雷达站也能远距离发现海面目标，射速更快。',
  { kind: 'enemy', at: 'coast', ek: 'coastal', hp: .9, mod: { rof: 1.15, rng: 1.05 }, vis: { r: 460, h: 4 } }, { counters: ['ship', 'dd'], weakTo: ['p_air_dive'] });
ctE('e_fgun', 'M119A3 105 毫米榴弹炮', 'e', 'arty', 'arty', 30, CT_IC.fgun, [4, 1, 5, 6, 0, 4, 5], '轻型野战炮，射程较近、射速快。',
  { kind: 'enemy', at: 'land', ek: 'arty', hp: .8, mod: { rof: 1.35, rng: .8 } }, { counters: ['inf_p'], weakTo: ['p_air_strike', 'p_spg'] });
ctE('e_how', 'M777A2 155 毫米榴弹炮阵地', 'e', 'arty', 'arty', 40, CT_IC.how, [5, 1, 7, 8, 0, 4, 6], '标准榴弹炮：射程 1100，打完数轮就转移阵地；对滩头与登陆舰威胁很大。',
  { kind: 'enemy', at: 'land', ek: 'arty', hp: 1 }, { counters: ['inf_p', 'ship'], weakTo: ['p_air_strike', 'p_fo'] });
ctE('e_hhow', '203 毫米重型榴弹炮', 'e', 'arty', 'arty', 60, CT_IC.hhow, [6, 1, 9, 9, 0, 4, 8], '大口径重炮：射程更远、单发威力接近岸防重炮，射速慢。',
  { kind: 'enemy', at: 'land', ek: 'arty', hp: 1.2, mod: { rof: .6, rng: 1.3, shell: 'coastal' } }, { counters: ['inf_p', 'ship', 'veh'], weakTo: ['p_air_heavy'] });
ctE('e_rkt', 'M270 多管火箭炮连', 'e', 'arty', 'arty', 45, CT_IC.rkt, [3, 0, 8, 7, 0, 4, 6], '一次三发齐射，覆盖面大但散布也大，装填快；阵地脆弱。',
  { kind: 'enemy', at: 'land', ek: 'arty', hp: .7, mod: { salvo: 3, pow: .55, rof: 1.3 } }, { counters: ['inf_p'], weakTo: ['p_air_cas', 'p_spg'] });
ctE('e_mortar', 'M252 81 毫米迫击炮', 'e', 'arty', 'mortar', 20, CT_IC.mortar, [3, 0, 4, 4, 0, 4, 3], '射程 420 的轻迫击炮，覆盖滩头与出口，不能打海上目标。',
  { kind: 'enemy', at: 'land', ek: 'mortar', hp: 1 }, { counters: ['inf_p', 'p_eng'], weakTo: ['p_mortar', 'p_air_cas'] });
ctE('e_hmortar', 'M120 120 毫米迫击炮', 'e', 'arty', 'mortar', 30, CT_IC.hmortar, [4, 0, 6, 5, 0, 4, 4], '大口径迫击炮：射程提升 35%、炮弹威力接近榴弹炮。',
  { kind: 'enemy', at: 'land', ek: 'mortar', hp: 1.3, mod: { rng: 1.35, shell: 'arty', rof: .85 } }, { counters: ['inf_p', 'trench'], weakTo: ['p_air_cas'] });
ctE('e_aa', '防空炮（M167 火神）', 'e', 'arty', 'aa', 25, CT_IC.aa, [4, 1, 4, 5, 0, 4, 3], '190 以内射击舰载机，开火会暴露位置。',
  { kind: 'enemy', at: 'land', ek: 'aa', hp: 1 }, { counters: ['wing'], weakTo: ['p_air_strike', 'p_dd'] });
ctE('e_aa_heavy', '重型高炮（40 毫米）', 'e', 'arty', 'aa', 38, CT_IC.haa, [6, 2, 6, 7, 0, 5, 5], '大口径高炮：射程与命中率更高，对轰炸机威胁很大。',
  { kind: 'enemy', at: 'land', ek: 'aa', hp: 1.5, mod: { aa: 1.6, rng: 1.25 } }, { counters: ['wing'], weakTo: ['p_dd'] });
ctE('e_aa_radar', 'C-RAM 陆基密集阵', 'e', 'arty', 'aa', 50, CT_IC.raa, [5, 2, 7, 8, 0, 9, 5], '火控雷达指挥的高炮群，命中率接近普通高炮两倍，并能远距离发现目标。',
  { kind: 'enemy', at: 'land', ek: 'aa', hp: 1.25, mod: { aa: 1.9, rng: 1.35 }, vis: { r: 260, h: 3 } }, { counters: ['wing'], weakTo: ['p_air_dive', 'p_dd'] });
ctE('e_tel', 'M142 海马斯（ATACMS）', 'e', 'arty', 'missile', 90, CT_IC.tel, [3, 1, 10, 10, 2, 0, 0], '纵深 450 以外的机动发射车，载弹 2 枚：打击滩头卸载中的登陆舰与密集部队，射程 300–1800；发射后暴露并转移阵地。',
  { kind: 'enemy', at: 'land', ek: 'tel', minDepth: 450, n: 2 }, { counters: ['ship', 'inf_p', 'p_depot'], weakTo: ['p_tbm', 'p_air_strike', 'p_air_recon'] });
ctE('e_ascm', 'NMESIS 岸舰导弹连（NSM）', 'e', 'arty', 'missile', 110, CT_IC.ascm, [4, 1, 10, 10, 0, 7, 0], '岸边的反舰导弹连（4 枚，两枚一组齐射）：掠海飞行打击射程 1600 内的坦克登陆舰、满载登陆舰与驱逐舰；驱逐舰近防炮可拦截，发射后暴露 90 秒。',
  { kind: 'enemy', at: 'coast', ek: 'ascm', n: 4 }, { counters: ['p_lst', 'p_lct', 'dd'], weakTo: ['p_tbm', 'p_air_dive'] });

// ———— 防守方 · 水面舰艇（navy.js；放在本方海岸外的深水区）————
ctE('e_lcs', 'LCS 独立级濒海战斗舰', 'e', 'naval', 'eship', 110, CT_IC.lcs, [4, 1, 5, 6, 10, 5, 0], '三体船型、40 节高速：8 枚 NSM 海军打击导弹（射程 1300），拉姆近防导弹；没有区域防空，扛不住饱和攻击。',
  { kind: 'eship', at: 'esea', cls: 'lcs' }, { counters: ['p_lct', 'p_lst', 'p_supply'], weakTo: ['p_dd', 'p_air_strike'] });
ctE('e_ffg', 'FFG-62 星座级护卫舰', 'e', 'naval', 'eship', 190, CT_IC.dde, [6, 2, 7, 8, 7, 6, 0], '16 枚 NSM 反舰导弹（射程 1300）、32 单元垂发（标准-2 / ESSM）、57 毫米炮、拉姆近防导弹；SPY-6 缩小型雷达。',
  { kind: 'eship', at: 'esea', cls: 'ffg' }, { counters: ['p_lst', 'p_dd_e', 'p_air_strike'], weakTo: ['p_cl', 'p_air_heavy'] });
ctE('e_ddg', 'DDG-51 阿利·伯克级驱逐舰（Flight IIA）', 'e', 'naval', 'eship', 260, CT_IC.dd, [8, 3, 8, 9, 7, 8, 0], '宙斯盾舰：SPY-1D 雷达、96 单元垂发（标准-2 / 标准-6 / ESSM 拦截来袭导弹与飞机）、8 枚鱼叉、127 毫米炮、密集阵近防炮。',
  { kind: 'eship', at: 'esea', cls: 'ddg' }, { counters: ['p_air_strike', 'p_air_heavy', 'p_dd'], weakTo: ['p_cl', 'p_tbm'] });
ctE('e_ddg3', 'DDG-125 阿利·伯克级驱逐舰（Flight III）', 'e', 'naval', 'eship', 320, CT_IC.ddh, [8, 3, 8, 10, 7, 10, 0], '最新批次：SPY-6 雷达看得更远，标准-6 更多，区域防空最强。',
  { kind: 'eship', at: 'esea', cls: 'ddg3' }, { counters: ['p_air_strike', 'p_air_heavy', 'p_cl'], weakTo: ['p_ca'] });
ctE('e_cg', 'CG-47 提康德罗加级巡洋舰', 'e', 'naval', 'eship', 300, CT_IC.cl, [9, 3, 8, 9, 6, 8, 0], '122 单元垂发、两门 127 毫米炮：编队防空指挥舰，耐打。',
  { kind: 'eship', at: 'esea', cls: 'cg' }, { counters: ['p_air_strike', 'p_air_heavy'], weakTo: ['p_ca', 'p_tbm'] });

// ———— 防守方 · 航空（需要野战机场；每座机场 50 个机位）————
ctE('e_airfield', '野战机场（含防御体系）', 'e', 'air', 'airfield', 1500, CT_IC.airfield, [9, 1, 6, 6, 0, 8, 26], '纵深 500 以外修建的大型野战机场，自带一整套防御体系：AN/TPS-80 雷达站（对空预警）、跑道两端各一辆 M-SHORAD 防空车、停机坪后方一套 LPWS 陆基密集阵、滑行道外侧两门 M167 火神高炮；两辆巡逻车沿机场外围固定路线巡逻，发现靠近的敌人就迎上去；常驻守备队两个排（6 个组，含 2 个毒刺组）守在外围阵地，专守机场、不被抽调。机场本体按真实比例布置，场区约 1100 × 800：920 米跑道（进近灯、拦阻索、航向台、下滑台）、平行滑行道与快速出口、两个加固机库群共 16 座机堡、两排 24 个机位的主停机线、三座维修机库、10 个直升机位与起降坪、塔台与消防站、弹药库区、油库、营区与双层围栏（放下时按地形自动定跑道方向，需要一大块平整陆地）。固定翼飞机沿跑道滑跑起降；跑道中弹后 60 秒无法起降，机位上的飞机可能被炸毁，机场被毁则地面飞机全部损失。受损后地勤自动抢修（附近有敌或刚挨炸时停工）；被毁约 4 分钟后可重建到四成耐久，停放的飞机不能恢复。',
  { kind: 'enemy', at: 'land', ek: 'airfield', minDepth: 500 }, { weakTo: ['p_tbm', 'p_air_heavy', 'p_air_strike'] });
ctE('e_air_ga', 'A-10C 雷电 II 攻击机', 'e', 'air', 'ewing', 38, CT_IC.ega, [2, 0, 7, 0, 9, 4, 0], '一次通场：6 枚火箭齐射加机炮扫射，专打卸载中的登陆舰与密集步兵；携 2 枚干扰弹，怕便携防空导弹与自行高炮。需要野战机场。',
  { kind: 'ewing', at: 'air', type: 'ga' }, { counters: ['ship', 'inf_p'], weakTo: ['p_manpads', 'p_aa_veh', 'p_dd'] });
ctE('e_air_heli', 'AH-64E 阿帕奇', 'e', 'air', 'ewing', 40, CT_IC.eheli, [3, 1, 6, 6, 4, 6, 0], '在 300–380 外悬停，以反坦克导弹猎杀坦克与登陆舰，再用火箭覆盖步兵；速度慢、低空，机枪也能把它打下来。需要野战机场。',
  { kind: 'ewing', at: 'air', type: 'heli' }, { counters: ['veh', 'p_lst'], weakTo: ['p_manpads', 'p_aa_veh', 'p_mg'] });

ctE('e_air_ftr', 'F-35A 闪电 II 战斗机', 'e', 'air', 'ewing', 40, CT_IC.eftr, [3, 0, 6, 7, 10, 7, 0], '从野战机场起飞，在防区上空巡逻、拦截敌舰载机，以 4 枚空空导弹与机炮与敌战斗机争夺制空权；我方掌握制空权后攻击机与直升机出击更频繁。需要野战机场。',
  { kind: 'ewing', at: 'air', type: 'ftr' }, { counters: ['p_air_cas', 'p_air_strike', 'p_air_ftr', 'wing'], weakTo: ['p_air_ftr', 'p_dd', 'p_tbm'] });
ctE('e_air_f22', 'F-22A 猛禽战斗机', 'e', 'air', 'ewing', 75, CT_IC.ef22 || CT_IC.eftr, [3, 0, 8, 8, 10, 8, 0], '美军最强的空优战斗机：比 F-35A 更难被雷达发现，超音速巡航、推力矢量，转弯追击更快；内埋 6 枚 AIM-120D 与 2 枚 AIM-9X（F-35A 只有 4 枚），AN/APG-77 雷达看得更远。有敌战斗机时打头阵，平时留在机场待命，让 F-35A 去巡逻。价格接近两架 F-35A。需要野战机场。',
  { kind: 'ewing', at: 'air', type: 'f22' }, { counters: ['p_air_ftr', 'p_air_cas', 'p_air_strike', 'wing'], weakTo: ['p_dd', 'p_tbm'] });
ctE('e_b2', 'B-2A 幽灵隐身轰炸机群（3 架）', 'e', 'air', 'asset', 3200, CT_IC.b2, [6, 0, 10, 10, 8, 2, 0], '美国空军战略隐身轰炸机，三机一组从本土远程奔袭，不需要机场。约 12000 米高空突防，雷达很难发现：高炮、单兵防空导弹与弹炮防空车够不着，只怕舰空导弹近距锁定和歼击机。两个内置弹舱载弹约 18 吨，三架按目标分工——GBU-38/B 500 磅 JDAM 80 枚（一次通场独立攻击 80 个瞄准点，炸上岸的步兵与车辆）、GBU-31 2000 磅钻地 JDAM 16 枚（炸抢滩的登陆舰与坦克）、AGM-158B JASSM-ER 隐身巡航导弹 16 枚（防区外打驱逐舰、航母）。敌军上岸后出击，打完返航，约 5 分钟后再来一波；只打守军看得见的目标。',
  { kind: 'asset', at: 'none', key: 'eb2', add: 1 }, { counters: ['p_lst', 'p_tank', 'p_rifle', 'p_dd', 'p_cv'], weakTo: ['p_air_ftr', 'p_air_j36', 'p_dd'] });

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
ctE('e_radar', 'AN/TPS-80 雷达站', 'e', 'fort', 'post', 35, CT_IC.radar, [3, 0, 0, 0, 0, 10, 2], '对空对海雷达：视野约 480，提早发现舰队与飞机。',
  { kind: 'post', at: 'land', r: 480, h: 4, hp: 8 }, { counters: ['ship', 'wing'], weakTo: ['p_air_strike'] });
ctE('e_slight', '探照灯', 'e', 'fort', 'post', 10, CT_IC.slight, [1, 0, 0, 0, 0, 6, 1], '照亮滩头约 240 范围，烟幕可以遮挡。',
  { kind: 'post', at: 'land', r: 240, h: 1, hp: 3 }, { counters: ['p_lct'], weakTo: ['p_smoke'] });
ctE('e_decoy', '假目标', 'e', 'fort', 'decoy', 6, CT_IC.decoy, [1, 0, 0, 0, 0, 0, 0], '伪装成碉堡的假阵地，吸引敌方空袭与舰炮浪费火力；一打就碎。',
  { kind: 'enemy', at: 'land', ek: 'bunker', hp: .2, mod: { pow: 0, rng: .05, rof: .1 }, decoy: 1 }, { counters: ['p_air_strike', 'p_dd'] });
ctE('e_ammo', '弹药库', 'e', 'support', 'depot_e', 25, CT_IC.ammo, [4, 0, 0, 0, 0, 0, 0], '前沿弹药库：900 以内的火炮与迫击炮装填加快 25%；被炸毁则失效。',
  { kind: 'post', at: 'land', r: 0, h: 0, hp: 6, ammo: 1 }, { counters: ['arty'], weakTo: ['p_air_strike', 'p_sortie_bomb'] });
ctE('e_wave', '增援波次', 'e', 'support', 'wave_e', 30, CT_IC.ewave, [0, 0, 4, 0, 0, 0, 9], '开战约 4 分钟后，三个小组从北面开到受威胁最大的据点。可叠加，每次晚 1 分钟。',
  { kind: 'ewave', at: 'none', teams: 3, t: 240 }, { counters: ['inf_p'] });
ctE('e_101', '第 101 空降师 · C-17 机械化空降战斗群', 'e', 'support', 'asset', 4800, CT_IC.c17, [10, 3, 10, 8, 10, 8, 60], '（沙盒为机械化空降，价格 4800）24 架 C-17A 按真实载重装机，三机一队纵列进场：伞兵 60 人（3 架）；重装空投 M1A2 SEPv3 主战坦克 8 辆、M1A1 主战坦克 6 辆（一架只装一辆）、M2A3 布雷德利步兵战车 4 辆、M109A7 帕拉丁自行榴弹炮 2 辆、复仇者与 M-SHORAD 防空车各 2 辆（备弹 12 枚、射程远）、JLTV 陶式反坦克车 2 辆；6 架 AH-64E 随队先到空降场压制我军；守军蓄力总攻时配合总攻空降，从另一个方向夹击。伞兵为精锐：精度 1.25 倍、两成致命伤只是负伤、不易被压制；落地在空降场集合后，坦克、步战车分别配属两个伞兵连步坦协同增援或反冲击，自行火炮在空降场后方支援。运输机与下降中的伞兵会挨我方防空火力与战斗机，跳伞前被击落则机上人员装备全损。每买一份多一波，两波间隔约 2.7 分钟。',
  { kind: 'asset', at: 'none', key: 'e101', add: 1 }, { counters: ['p_para', 'inf_p'], weakTo: ['p_manpads', 'p_aa_veh', 'p_air_ftr'] });

// 尚未接入推演的条目：先不出现在沙盒与图鉴（codex.js 也据此过滤关联条目）；v7 的条目已全部接入
const CT_WIP = new Set();
for (let i = CATALOG.length - 1; i >= 0; i--) if (CT_WIP.has(CATALOG[i].id)) CATALOG.splice(i, 1);

const CATALOG_MAP = new Map(CATALOG.map(c => [c.id, c]));
const catalogById = id => CATALOG_MAP.get(id) || null;
