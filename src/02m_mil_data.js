/* =====================================================================
   Military data: unit catalog, military techs, doctrines, AI tables.
   Military techs (t.mil) run on their own research track (n.mtarget /
   n.mresearch, funded by the military budget) and never count toward
   the civil era. Civil techs never depend on military ones.
   ===================================================================== */
const ROLES = { land: ['inf', 'art', 'arm', 'at', 'aa'], sea: ['scr', 'cap', 'cv', 'sub'], air: ['fi', 'cas', 'bomb', 'nb', 'uav'] };
const DOMS = ['land', 'sea', 'air'], DOM = { land: 0, sea: 1, air: 2 }, DOM_NAME = { land: '陆军', sea: '海军', air: '空军' };
// role names (the contract's ROLE_NAME; that identifier is already the civilian job table in 15_people.js)
const MIL_ROLE_NAME = { inf: '步兵', art: '炮兵', arm: '装甲', at: '反坦克', aa: '防空', scr: '护航舰', cap: '主力舰', cv: '航母', sub: '潜艇',
  fi: '战斗机', cas: '攻击机', bomb: '轰炸机', nb: '海航', uav: '无人机', siege: '攻城', sup: '支援', strat: '战略', msl: '导弹' };
const ROLE_OF_DOM = {}; for (const d of DOMS) for (const r of ROLES[d]) ROLE_OF_DOM[r] = d;
// who beats whom (for unit cards and the AI's counter logic)
const ROLE_COUNTER = {
  inf: { beats: ['inf'], beatenBy: ['art', 'arm'] }, art: { beats: ['inf', 'at'], beatenBy: ['cas', 'arm'] }, arm: { beats: ['inf', 'art'], beatenBy: ['at', 'cas', 'uav'] },
  at: { beats: ['arm'], beatenBy: ['inf', 'art'] }, aa: { beats: ['cas', 'bomb', 'uav'], beatenBy: ['arm', 'art'] },
  scr: { beats: ['sub'], beatenBy: ['cap', 'nb'] }, cap: { beats: ['scr'], beatenBy: ['cv', 'sub', 'nb'] }, cv: { beats: ['cap', 'scr'], beatenBy: ['sub'] }, sub: { beats: ['cap', 'cv'], beatenBy: ['scr'] },
  fi: { beats: ['bomb', 'cas', 'nb'], beatenBy: ['aa'] }, cas: { beats: ['arm', 'inf'], beatenBy: ['fi', 'aa'] }, bomb: { beats: [], beatenBy: ['fi', 'aa'] },
  nb: { beats: ['cap', 'scr'], beatenBy: ['fi'] }, uav: { beats: ['arm', 'art'], beatenBy: ['aa'] },
};

/* ---------- units ----------
   U(id, name, dom, roles, tech, [atk, def, hp, sp, range, cost], spr, vis, obs, desc)
   rating = (atk + def) / 2 is the combat value of one "share" of a role; sp is map px/s, range in map px (battle visuals).
   spr is the sprite family, vis its parameters (15m_mil_draw.js); obs = the unit that replaces it. */
const UNITS = [];
function U(id, name, dom, roles, tech, st, spr, vis, obs, desc) {
  UNITS.push({ id, name, dom, roles, tech, atk: st[0], def: st[1], hp: st[2], sp: st[3], range: st[4], cost: st[5], spr, vis, obs: obs || null, desc: desc || '' });
}
// ---- land (30) ----
U('spear', '石矛战士', 'land', ['inf'], 'agri', [1, 1, 1, 4.6, 1.9, 1], 'foot', { garb: 'hide', helm: 'none', wpn: 'spear' }, 'bronze_inf', '兽皮短衣，木杆石矛，冲锋时上下戳刺。');
U('bronze_inf', '青铜矛兵', 'land', ['inf'], 'bronze', [1.3, 1.2, 1, 4.6, 1.9, 1.3], 'foot', { garb: 'tunic', helm: 'bronze', wpn: 'spear', shield: 'round' }, 'legion', '铜色矛尖与国家色圆盾。');
U('legion', '铁甲步兵', 'land', ['inf'], 'iron', [1.8, 1.8, 1, 4.4, 1.9, 1.8], 'foot', { garb: 'mail', helm: 'iron', crest: 1, wpn: 'sword', shield: 'rect' }, 'musketeer', '铁盔红缨、长方大盾，短剑挥砍。');
U('musketeer', '火枪兵', 'land', ['inf'], 'musket', [5.8, 5.2, 1, 4.4, 9, 4], 'foot', { garb: 'coat', helm: 'tricorn', wpn: 'musket', smoke: 1, line: 1 }, 'rifleman', '三角帽、国家色外套，列成横队齐射，一团白烟。');
U('rifleman', '步枪兵', 'land', ['inf'], 'rifling', [11, 11, 1, 4.8, 11, 7], 'foot', { garb: 'coat', helm: 'kepi', wpn: 'rifle', prone: 1 }, 'inf_ww', '平顶军帽与线膛步枪，卧倒射击。');
U('inf_ww', '步兵师', 'land', ['inf'], 'infww', [18, 20, 1, 5, 12, 14], 'foot', { garb: 'drab', helm: 'steel', wpn: 'smg', tracer: 1, truck: 1 }, 'mech_inf', '钢盔与冲锋枪，曳光弹划过战场；摩托化后乘卡车开到前线再下车。');
U('mech_inf', '机械化步兵', 'land', ['inf'], 'mechinf', [38, 38, 3, 6, 13, 32], 'tracked', { hull: 'ifv', len: 5, turret: 'small', gun: 2.5, dismount: 2 }, 'exo_inf', '履带步兵战车伴随坦克冲锋，车顶小炮塔点射，下车即战。');
U('exo_inf', '外骨骼步兵', 'land', ['inf'], 'exosuit', [76, 76, 2, 6, 14, 60], 'foot', { garb: 'exo', helm: 'visor', wpn: 'heavy', scale: 1.3, visor: '#4ff' }, null, '动力外骨骼让每个士兵都扛得动重机枪。');
U('archer', '弓箭手', 'land', ['art'], 'archery', [1.4, 0.9, 1, 4.4, 13, 1.2], 'foot', { garb: 'tunic', helm: 'none', wpn: 'bow', proj: 'arrow' }, 'crossbowman', '抛射箭雨的远程步兵。');
U('crossbowman', '弩手', 'land', ['art'], 'crossbow', [2.6, 1.6, 1, 4.4, 14, 2], 'foot', { garb: 'mail', helm: 'iron', wpn: 'xbow', proj: 'bolt' }, 'cannon', '横置弩臂平射短箭，平民也能射穿铠甲。');
U('catapult', '投石机', 'land', ['siege'], 'siege', [3, 1, 1, 2.5, 24, 3], 'gun', { type: 'catapult', proj: 'stone', arc: 14 }, 'cannon', '木架摆臂抛出石块，只在攻打有城墙的城市时出现。');
U('cannon', '射石炮', 'land', ['art'], 'gunpowder', [4, 1.6, 1, 3, 26, 4], 'gun', { type: 'bombard', proj: 'ball', arc: 12 }, 'fieldgun', '木轮黑炮管，发射实心弹。');
U('fieldgun', '野战炮', 'land', ['art'], 'artillery', [9.5, 4.5, 1, 3.4, 28, 7], 'gun', { type: 'field', crew: 2, proj: 'ball', arc: 12 }, 'howitzer', '细长青铜炮管与大辐条轮，两名炮手。');
U('howitzer', '榴弹炮', 'land', ['art'], 'howitzer', [20, 8, 1, 3.4, 32, 14], 'gun', { type: 'howitzer', crew: 2, recoil: 1, proj: 'shell', arc: 16 }, 'spg', '短粗炮管大仰角，开火时后坐，炮弹越过山头。');
U('spg', '自行火炮', 'land', ['art'], 'spg', [40, 18, 3, 5, 32, 30], 'tracked', { hull: 'spg', len: 6.5, turret: 'open', gun: 6, proj: 'shell', arc: 14 }, 'mlrs', '履带底盘加开顶战斗室，打完就走。');
U('mlrs', '火箭炮', 'land', ['art'], 'rocketart', [70, 30, 3, 5.5, 36, 55], 'tracked', { hull: 'truck', len: 6, launcher: 'box', salvo: 6, proj: 'rocket' }, 'railgun', '后部方形发射箱，一次齐射六枚带白烟的火箭。');
U('railgun', '电磁轨道炮', 'land', ['art'], 'directenergy', [120, 50, 3, 5, 40, 100], 'tracked', { hull: 'heavy', len: 7, turret: 'rails', gun: 8, beam: '#8ff' }, null, '双轨长炮管闪着蓝白电弧，弹道是一条平直的青色亮线。');
U('aa_gun', '高射炮', 'land', ['aa'], 'aagun', [22, 18, 1, 3.4, 22, 12], 'gun', { type: 'aa', proj: 'flak', antiAir: 1 }, 'sam', '四脚架与竖起的炮管，在目标高度炸出黑色烟团。');
U('sam', '防空导弹车', 'land', ['aa'], 'sam', [60, 40, 2, 5.5, 34, 45], 'tracked', { hull: 'truck', len: 6, launcher: 'tubes4', proj: 'sam', antiAir: 1 }, 'laser_aa', '卡车与倾斜的四联发射筒，导弹拖着白烟向上追踪。');
U('laser_aa', '激光防空车', 'land', ['aa'], 'directenergy', [130, 90, 3, 5.5, 36, 90], 'tracked', { hull: 'med', len: 6, turret: 'optic', beam: '#6ff', antiAir: 1 }, null, '圆形光学塔射出青色光束。');
U('chariot', '战车', 'land', ['arm'], 'chariot', [1.6, 1, 2, 6.5, 1.9, 2], 'horse', { cart: 1, horses: 2, crew: 2, wpn: 'spear' }, 'horse', '双马拉的两轮车，驭手与持矛战士冲过平原。');
U('horse', '轻骑兵', 'land', ['arm'], 'horseback', [2, 1.2, 2, 6.8, 1.9, 2.5], 'horse', { rider: 'light', wpn: 'spear' }, 'knight', '驰骋草原的骑手。');
U('knight', '具装骑士', 'land', ['arm'], 'heavycav', [3.6, 2.4, 2, 6, 1.9, 4], 'horse', { rider: 'knight', barding: 1, wpn: 'lance' }, 'tank_light', '人马俱甲，国家色马衣，平举长枪冲锋。');
U('tank_light', '轻型坦克', 'land', ['arm'], 'tank', [20, 14, 3, 6, 12, 16], 'tracked', { hull: 'light', len: 5, turret: 'small', gun: 3, early: 'rhomb' }, 'tank_medium', '短车体小炮塔；最早的型号是菱形车体。');
U('tank_medium', '中型坦克', 'land', ['arm'], 'tankmed', [34, 30, 4, 5.5, 14, 26], 'tracked', { hull: 'med', len: 6, turret: 'round', gun: 4 }, 'mbt', '火力、装甲与机动的平衡点，战争的主力。');
U('tank_heavy', '重型坦克', 'land', ['arm'], 'tankheavy', [40, 46, 6, 3.8, 15, 40], 'tracked', { hull: 'heavy', len: 7.5, turret: 'box', gun: 5.5, shake: 1 }, 'mbt', '移动的钢铁堡垒，慢，却几乎打不穿。');
U('tank_destroyer', '坦克歼击车', 'land', ['at'], 'tankdes', [42, 22, 3, 5, 16, 24], 'tracked', { hull: 'td', len: 6.5, turret: 'none', gun: 7, prefer: 'arm' }, null, '无炮塔的低矮车体与超长炮管，专门猎杀坦克。');
U('mbt', '主战坦克', 'land', ['arm'], 'mbt', [64, 60, 6, 6.5, 16, 50], 'tracked', { hull: 'mbt', len: 7, turret: 'wedge', gun: 5.5, skirts: 1 }, 'mech', '楔形炮塔与侧裙板，行进间射击，一种坦克包打天下。');
U('mech', '机甲', 'land', ['arm'], 'mech', [120, 104, 6, 5, 16, 110], 'mech', { scale: 1 }, 'grav_tank', '钢铁巨人走上战场。');
U('grav_tank', '反重力坦克', 'land', ['arm'], 'gravtank', [200, 180, 7, 8, 18, 180], 'hover', { len: 7, glow: '#5ff', float: 1.5 }, null, '无履带的流线车体悬浮在地面之上，底部泛着青色光晕。');
// ---- sea (23) ----
U('galley', '桨帆战船', 'sea', ['cap'], 'trireme', [1.6, 1.4, 2, 5, 3, 3], 'oared', { len: 9, oars: 1, sail: 1, ram: 1 }, 'carrack', '低矮长船体、一面方帆，两侧船桨交替划动，以撞角接舷。');
U('carrack', '卡拉克战舰', 'sea', ['cap'], 'carrack', [3, 2.8, 3, 4.5, 10, 6], 'sail', { len: 9, masts: 2, castles: 1 }, 'galleon', '高耸的艏艉楼，能扛住风浪的远洋战船。');
U('galleon', '盖伦战舰', 'sea', ['cap'], 'galleon', [5.5, 5, 4, 4.5, 12, 10], 'sail', { len: 10, masts: 3, ports: 1 }, 'ship_line', '三桅武装帆船，船侧一排炮门。');
U('frigate', '巡航舰', 'sea', ['scr'], 'frigate', [4.6, 3.6, 3, 6.5, 12, 7], 'sail', { len: 9, masts: 3, ports: 1, slim: 1 }, 'torpedo_boat', '修长的单层炮甲板快船，舰队的眼睛。');
U('ship_line', '风帆战列舰', 'sea', ['cap'], 'shipline', [8, 7, 6, 3.8, 14, 16], 'sail', { len: 12, masts: 3, decks: 2, broadside: 4 }, 'ironclad', '三桅满帆、两层炮门，舷侧齐射时沿船身腾起一排硝烟。');
U('ironclad', '铁甲舰', 'sea', ['cap'], 'ironclad', [14, 16, 6, 4.5, 16, 26], 'steam', { len: 9, funnels: 1, turrets: 1, smoke: 'black', low: 1 }, 'battleship', '灰黑低干舷、一根冒黑烟的烟囱和一座炮塔。');
U('torpedo_boat', '鱼雷艇', 'sea', ['scr'], 'torpedo', [13, 5, 2, 8.5, 9, 10], 'steam', { len: 6, funnels: 1, torp: 1, wake: 1 }, 'destroyer', '小而快，船头翘起，拖着白色尾浪发射鱼雷。');
U('destroyer', '驱逐舰', 'sea', ['scr'], 'destroyer', [22, 16, 4, 8, 14, 20], 'steam', { len: 9, funnels: 2, turrets: 2, zigzag: 1, depth: 1, smokeScreen: 1 }, 'missile_destroyer', '细长灰船、两根细烟囱，之字形机动，向潜艇投掷深水炸弹。');
U('light_cruiser', '轻巡洋舰', 'sea', ['scr'], 'cruiser', [28, 22, 5, 7, 16, 28], 'steam', { len: 11, funnels: 2, turrets: 3 }, 'missile_destroyer', '快速的侦察与护航舰，三座小炮塔。');
U('heavy_cruiser', '重巡洋舰', 'sea', ['cap'], 'hcruiser', [36, 32, 7, 6.5, 20, 40], 'steam', { len: 12, funnels: 2, turrets: 4, bridge: 'tall' }, 'missile_cruiser', '四座双联炮塔与高耸舰桥。');
U('battleship', '无畏战列舰', 'sea', ['cap'], 'dreadnought', [48, 52, 10, 4.5, 24, 60], 'steam', { len: 14, funnels: 2, turrets: 4, mast: 'pagoda', salvo: 3, bigSplash: 1 }, 'missile_cruiser', '最长的船体与宝塔桅，三发齐射在落点掀起高大水柱。');
U('carrier', '航空母舰', 'sea', ['cv'], 'carrier', [50, 26, 8, 5.5, 40, 55], 'carrier', { len: 15, island: 1, planes: 'prop' }, 'supercarrier', '平直的飞行甲板与右侧小舰岛，停在后方放飞舰载机。');
U('submarine', '潜艇', 'sea', ['sub'], 'submarine', [34, 12, 3, 4, 10, 18], 'sub', { len: 7, tower: 1, periscope: 1 }, 'nuke_sub', '只露出指挥塔与潜望镜，开火前上浮，鱼雷在水面拖出白色航迹。');
U('nuke_sub', '攻击核潜艇', 'sea', ['sub'], 'nukesub', [64, 36, 4, 6, 14, 50], 'sub', { len: 9, teardrop: 1 }, 'uuv', '水滴形黑色艇身，几乎不露出水面，可以在水下绕地球一周。');
U('ssbn', '战略核潜艇', 'sea', ['strat'], 'ssbn', [20, 40, 5, 4.5, 0, 80], 'sub', { len: 10, teardrop: 1, tubes: 1 }, null, '深海里的第二次打击力量，平时不参战。');
U('transport', '登陆舰', 'sea', ['sup'], 'landingcraft', [2, 8, 3, 5, 0, 8], 'steam', { len: 8, ramp: 1, troops: 3 }, 'amphib', '方头船冲上滩头，跳板放下后士兵冲出。');
U('missile_destroyer', '导弹驱逐舰', 'sea', ['scr'], 'aegis', [66, 62, 6, 8, 30, 60], 'steam', { len: 11, vls: 1, radar: 'octa', intercept: 1 }, 'stealth_destroyer', '八角形相控阵舰桥，垂直发射的导弹先升后平飞，能拦截来袭导弹。');
U('missile_cruiser', '导弹巡洋舰', 'sea', ['cap'], 'mslcruiser', [80, 66, 8, 7, 34, 80], 'steam', { len: 13, vls: 2, salvo: 4, bridge: 'tall' }, null, '两组垂直发射系统与大型舰桥，一次齐射四枚导弹。');
U('supercarrier', '核动力超级航母', 'sea', ['cv'], 'supercarrier', [110, 60, 12, 6, 50, 120], 'carrier', { len: 18, island: 1, angled: 1, planes: 'jet', catapult: 1 }, 'drone_carrier', '十万吨级斜角甲板，弹射起飞的喷气机。');
U('amphib', '两栖攻击舰', 'sea', ['sup'], 'amphibassault', [30, 40, 8, 5.5, 30, 60], 'carrier', { len: 14, island: 1, heli: 1, hovercraft: 1 }, null, '全通甲板起降直升机，登陆时放出气垫艇。');
U('stealth_destroyer', '隐身驱逐舰', 'sea', ['scr'], 'stealthship', [130, 120, 7, 9, 36, 110], 'steam', { len: 12, stealth: 1, vls: 1, smoke: 'none' }, null, '内倾穿浪船体与多棱面上层，几乎不冒烟，在雷达上只有渔船大小。');
U('drone_carrier', '无人机母舰', 'sea', ['cv'], 'dronecarrier', [170, 110, 12, 6.5, 55, 180], 'carrier', { len: 17, island: 0, planes: 'drone', swarm: 1 }, null, '没有舰岛的平板甲板上，一群无人机持续起降。');
U('uuv', '无人潜航器', 'sea', ['sub'], 'uuv', [130, 90, 3, 7, 16, 70], 'sub', { len: 3, count: 3, light: '#4af' }, null, '水下若隐若现的三个小黑影，偶尔闪一下蓝灯。');
// ---- air (21) ----
U('airship', '硬式飞艇', 'air', ['bomb'], 'airship', [16, 10, 4, 4, 0, 12], 'airship', { len: 14, gondola: 1, alt: 18 }, 'strat_bomber', '银灰色的巨大雪茄艇体，缓缓飘过敌城投下炸弹。');
U('biplane', '双翼战斗机', 'air', ['fi'], 'milaviation', [18, 16, 1, 12, 8, 6], 'plane', { wings: 2, prop: 1, body: 'wood', roundel: 1 }, 'fighter', '上下两层机翼与木色机身，螺旋桨闪烁。');
U('fighter', '单翼战斗机', 'air', ['fi'], 'monoplane', [32, 30, 2, 15, 9, 10], 'plane', { wings: 1, prop: 1, canopy: 1, tracer: '#ffd84a' }, 'jet_fighter', '全金属下单翼与气泡座舱，缠斗时机翼两侧喷出黄色曳光。');
U('dive_bomber', '俯冲轰炸机', 'air', ['cas'], 'divebomber', [34, 18, 2, 13, 6, 12], 'plane', { wings: 1, gull: 1, prop: 1, fixedGear: 1, dive: 1 }, 'attack_heli', '鸥形翼与固定起落架，尖啸着垂直俯冲投弹。');
U('tac_bomber', '战术轰炸机', 'air', ['bomb'], 'tacbomber', [34, 24, 3, 12, 6, 16], 'plane', { engines: 2, prop: 1, size: 1.4, bombs: 4 }, 'strat_bomber', '双引擎中型轰炸机，掠过敌军后方投下一串炸弹。');
U('naval_bomber', '鱼雷轰炸机', 'air', ['nb'], 'navalbomber', [38, 20, 2, 12, 10, 14], 'plane', { wings: 1, prop: 1, torp: 1, low: 1 }, 'multirole', '贴着浪尖低飞投放鱼雷。');
U('strat_bomber', '战略轰炸机', 'air', ['bomb'], 'stratbomber', [46, 30, 4, 11, 6, 28], 'plane', { engines: 4, prop: 1, size: 2, bombs: 6, formation: 8 }, 'stealth_bomber', '四引擎大机组成编队飞过敌城，一路都是高射炮的黑烟。');
U('transport_plane', '运输机', 'air', ['sup'], 'paratroop', [0, 8, 2, 11, 0, 10], 'plane', { engines: 2, prop: 1, size: 1.6, fat: 1, para: 4 }, null, '圆胖机身，飞过敌后时落下一串白色降落伞。');
U('jet_fighter', '喷气式战斗机', 'air', ['fi'], 'jetfighter', [50, 44, 2, 20, 10, 22], 'plane', { wings: 1, swept: 1, jet: 1, trail: 1 }, 'multirole', '后掠翼、没有螺旋桨，拖着白色尾迹。');
U('multirole', '多用途战斗机', 'air', ['fi', 'nb'], 'multirole', [72, 66, 2, 20, 12, 40], 'plane', { wings: 1, swept: 1, jet: 1, tails: 2, msl: 1 }, 'stealth_fighter', '双垂尾、翼下挂弹，既能空战也能对地对海攻击。');
U('attack_heli', '武装直升机', 'air', ['cas'], 'helicopter', [70, 40, 2, 8, 14, 35], 'heli', { alt: 6, rotor: 1, atgm: 1, prefer: 'arm' }, null, '树梢高度悬停，向坦克发射反坦克导弹。');
U('awacs', '空中预警机', 'air', ['sup'], 'awacs', [0, 20, 3, 10, 0, 45], 'plane', { engines: 4, jet: 1, size: 1.8, dome: 1, orbit: 1 }, null, '背着圆盘雷达在后方缓慢盘旋，己方命中率提高。');
U('drone', '察打无人机', 'air', ['uav'], 'stealth', [66, 40, 1, 9, 12, 20], 'drone', { pusher: 1 }, 'drone_swarm', '细长机身与尾部推进桨，长时间盘旋后精确打击。');
U('stealth_fighter', '隐身战斗机', 'air', ['fi', 'nb'], 'stealthfighter', [96, 100, 2, 22, 14, 80], 'plane', { wings: 1, diamond: 1, jet: 1, tails: 2, body: '#4a4e55' }, 'spacefighter', '菱形机身与内倾双垂尾，先敌发现、先敌开火。');
U('stealth_bomber', '隐身轰炸机', 'air', ['bomb'], 'stealthbomber', [110, 90, 4, 14, 8, 90], 'plane', { flyingWing: 1, jet: 1, size: 2, body: '#222428' }, null, '黑色飞翼与锯齿后缘，悄然掠过防空网。');
U('drone_swarm', '蜂群无人机', 'air', ['uav'], 'swarm', [150, 110, 1, 12, 10, 60], 'drone', { swarm: 10, jitter: 1 }, null, '成百上千架廉价无人机自主协同，落点炸出一串小火花。');
U('spacefighter', '空天战机', 'air', ['fi'], 'spacefighter', [150, 140, 3, 26, 16, 140], 'plane', { wedge: 1, jet: 1, plasma: '#6af', body: '#e8eef5' }, null, '白色楔形机身、尾部蓝色等离子焰，从跑道直入近地轨道。');
U('cruise_missile', '巡航导弹', 'air', ['msl'], 'cruisemsl', [70, 0, 1, 18, 0, 8], 'missile', { kind: 'cruise' }, 'hypersonic', '贴地飞行上千公里，精确命中目标。');
U('icbm', '洲际导弹', 'air', ['msl'], 'icbm', [300, 0, 1, 30, 0, 60], 'missile', { kind: 'icbm', arc: 'global' }, null, '三十分钟抵达地球另一端，只在核打击时出现。');
U('hypersonic', '高超音速导弹', 'air', ['msl'], 'hypersonic', [140, 0, 1, 30, 0, 20], 'missile', { kind: 'hyper', trail: '#f84' }, null, '五倍音速以上机动滑翔，拖着橙红色等离子尾焰。');
U('orbital_platform', '天基动能平台', 'air', ['msl'], 'orbitalwar', [220, 60, 0, 0, 0, 200], 'missile', { kind: 'beam' }, null, '在轨道上投下钨棒，从天而降一道白色光柱。');
const UNIT_BY_ID = Object.fromEntries(UNITS.map(u => [u.id, u]));
const UNITS_BY_ROLE = {}; for (const u of UNITS) for (const r of u.roles) (UNITS_BY_ROLE[r] = UNITS_BY_ROLE[r] || []).push(u);
for (const u of UNITS) { u.rating = (u.atk + u.def) / 2; u.obsBy = UNITS.filter(o => o.obs === u.id).map(o => o.id); }
function unitScore(u, sp, c) { return u.rating * Math.pow(u.sp / 5, sp) * Math.pow(u.cost, -c); }

/* ---------- military techs ----------
   MT(id, name, era, branch, req, refYear, desc, effect text, fx, opt) — declare in ref-year order inside an era. */
function MT(id, name, era, br, req, ry, desc, fxt, fx, opt) { TECHS.push(Object.assign({ id, name, era, br, req, desc, fxt, fx, ry, mil: true }, opt || {})); }
const docFx = (dom, id) => m => { m.doc[dom] = id; };
// ---- 远古 / 古典 / 中世纪 ----
MT('chariot', '战车', 0, 'arm', ['wheel', 'bronze'], -2000, '马拉双轮战车冲过平原。', '解锁战车', m => {});
MT('trireme', '桨帆战船', 1, 'ncap', ['sailing', 'bronze'], -500, '三列桨座与青铜撞角，海上第一次有了战舰。', '解锁桨帆战船，可以组建海军', m => { m.navyOK = 1; });
MT('siege', '攻城器械', 1, 'art', ['archery', 'construction'], -400, '投石机、攻城槌与云梯，城墙不再坚不可摧。', '攻城 +30%（抵消城墙），解锁投石机', m => { m.siege += 0.3; });
MT('heavycav', '具装骑兵', 2, 'arm', ['horseback', 'steel'], 900, '人马俱甲，马镫让骑士可以持矛冲锋。', '解锁具装骑士', m => {});
MT('carrack', '卡拉克战舰', 2, 'ncap', ['trireme', 'compass'], 1350, '高耸的艏艉楼，能扛住风浪的远洋战船。', '解锁卡拉克战舰', m => {});
// ---- 文艺复兴 ----
MT('galleon', '盖伦战舰', 3, 'ncap', ['carrack', 'navigation'], 1540, '大航海时代的武装帆船。', '解锁盖伦战舰', m => {});
MT('starfort', '棱堡', 3, 'log', ['gunpowder', 'construction'], 1550, '星形要塞让火炮无处下手。', '城市防御 +20%', m => { m.def *= 1.2; });
MT('frigate', '巡航舰', 3, 'nscr', ['carrack', 'navigation'], 1650, '快速的单层炮甲板战舰，舰队的眼睛。', '解锁巡航舰', m => {});
MT('bayonet', '燧发枪与刺刀', 3, 'inf', ['musket'], 1690, '燧发机让射击更可靠，插上刺刀的火枪兵也能白刃冲锋，线列步兵登场。', '步兵 +20%，步兵反骑兵/反装甲 +0.2', m => { m.q.inf *= 1.2; m.infAT += 0.2; });
MT('shipline', '风帆战列舰', 3, 'ncap', ['galleon', 'artillery'], 1700, '上百门火炮排成两三层，舷侧齐射。', '解锁风帆战列舰', m => {});
// ---- 工业 ----
MT('ironclad', '铁甲舰', 4, 'ncap', ['shipline', 'steam'], 1860, '蒸汽动力与铁甲，木船时代结束。', '解锁铁甲舰', m => {});
MT('railmil', '铁路军运', 4, 'log', ['rail'], 1860, '铁路一夜之间把一个军送到前线。', '补给 +1，战损恢复 +20%', m => { m.supply += 1; m.recov += 0.2; });
MT('howitzer', '后膛榴弹炮', 4, 'art', ['artillery', 'industrialize'], 1870, '后装线膛炮与间接瞄准，炮弹越过山头落进敌阵。', '解锁榴弹炮，攻城 +20%', m => { m.siege += 0.2; });
MT('torpedo', '鱼雷艇', 4, 'nscr', ['frigate', 'steam'], 1878, '自航鱼雷让小艇也能击沉巨舰。', '解锁鱼雷艇，可以使用鱼雷', m => { m.torp = 1; });
// ---- 现代 ----
MT('destroyer', '驱逐舰', 5, 'nscr', ['torpedo', 'combustion'], 1900, '为驱逐鱼雷艇而生，后来成了舰队的万能护卫。', '解锁驱逐舰，反潜 +0.3', m => { m.asw += 0.3; });
MT('airship', '硬式飞艇', 5, 'abo', ['combustion'], 1900, '巨大的飞艇在夜空中投下炸弹。', '解锁硬式飞艇，可以战略轰炸', m => {});
MT('submarine', '潜艇', 5, 'nsub', ['torpedo', 'combustion'], 1905, '水面之下的猎手。', '解锁潜艇', m => {});
MT('dreadnought', '无畏舰', 5, 'ncap', ['ironclad', 'electricity'], 1906, '全重型火炮与蒸汽轮机，一出现就让所有旧战列舰过时。', '解锁无畏战列舰', m => {});
MT('cruiser', '轻巡洋舰', 5, 'nscr', ['destroyer', 'electricity'], 1910, '快速的侦察与护航舰。', '解锁轻巡洋舰', m => {});
MT('milaviation', '军用航空', 5, 'afi', ['flight'], 1912, '飞机第一次被用于侦察和空战。', '解锁双翼战斗机，可以组建空军', m => { m.airOK = 1; });
MT('tacbomber', '战术轰炸机', 5, 'abo', ['milaviation'], 1917, '双引擎轰炸机袭击前线后方。', '解锁战术轰炸机', m => {});
MT('carrier', '航空母舰', 5, 'ncv', ['cruiser', 'milaviation'], 1922, '把机场开到大洋上。', '解锁航空母舰', m => {});
MT('hcruiser', '重巡洋舰', 5, 'ncap', ['cruiser', 'dreadnought'], 1925, '条约限制下的八英寸炮巡洋舰。', '解锁重巡洋舰', m => {});
MT('codebreak', '密码破译', 5, 'elec', ['radio'], 1930, '机械密码机与破译机：读懂敌人的电报。', '情报优势 +0.25', m => { m.crypto += 0.25; });
MT('motorized', '摩托化步兵', 5, 'inf', ['machinegun', 'combustion'], 1935, '卡车把步兵送上前线。', '步兵 +10%，补给 +1，攻城节奏 +10%', m => { m.q.inf *= 1.1; m.supply += 1; m.tempo += 0.1; });
MT('divebomber', '俯冲轰炸机', 5, 'aatk', ['milaviation'], 1935, '尖啸着垂直俯冲，把炸弹投进坦克舱盖。', '解锁俯冲轰炸机', m => {});
MT('dfleet', '战列线决战', 5, 'dsea', ['dreadnought'], 1935, '巨舰大炮，一战定乾坤。信息时代演化为「水面打击群」。', '主力舰 +30%，护航舰 +10%，海战占优时再 +15%', docFx('sea', 'dfleet'), { excl: 'sea' });
MT('infww', '步兵武器·半自动步枪', 5, 'inf', ['machinegun', 'massprod'], 1936, '半自动步枪、冲锋枪与钢盔：一个步兵师就是一座移动的军火库。', '解锁步兵师', m => {});
MT('monoplane', '单翼战斗机', 5, 'afi', ['milaviation', 'massprod'], 1936, '全金属单翼、可收放起落架。', '解锁单翼战斗机', m => {});
MT('dmobile', '闪电战', 5, 'dland', ['tank', 'radio'], 1936, '装甲集群在俯冲轰炸机掩护下撕开防线、长驱直入。信息时代演化为「空地一体战」。', '装甲 +25%，攻城节奏 +25%，补给 −0.5；偏好快速的中型坦克', docFx('land', 'dmobile'), { excl: 'land' });
MT('dfire', '优势火力', 5, 'dland', ['howitzer', 'radio'], 1936, '用钢铁代替血肉。信息时代演化为「精确火力打击」。', '炮兵 +25%，攻击机 +15%，陆军战损 −20%', docFx('land', 'dfire'), { excl: 'land' });
MT('dplan', '大战役计划', 5, 'dland', ['machinegun', 'radio'], 1936, '周密计划，步步为营。信息时代演化为「纵深防御体系」。', '步兵 +15%，城市防御 +20%，战争每持续 1 年进攻 +3%（至多 +30%）；偏好重型坦克', docFx('land', 'dplan'), { excl: 'land' });
MT('dmass', '大纵深作战', 5, 'dland', ['rifling', 'massprod'], 1936, '以纵深与数量压垮敌人。信息时代演化为「人民战争」。', '兵员 +30%，步兵 +10%，战损恢复 +40%；偏好廉价装备', docFx('land', 'dmass'), { excl: 'land' });
MT('navalbomber', '鱼雷轰炸机', 5, 'aatk', ['divebomber', 'torpedo'], 1937, '贴着浪尖投下鱼雷。', '解锁鱼雷轰炸机，舰载机 +0.2', m => { m.cvAir += 0.2; });
MT('aagun', '高射炮', 5, 'art', ['howitzer', 'flight'], 1937, '对空弹幕在天上炸开一朵朵黑云。', '解锁高射炮，舰队防空 +0.15', m => { m.fleetAA += 0.15; });
MT('tankmed', '中型坦克', 5, 'arm', ['tank', 'massprod'], 1938, '火力、装甲与机动的平衡点，战争的主力。', '解锁中型坦克', m => {});
MT('radar', '雷达', 5, 'elec', ['radio', 'electricity'], 1938, '电波照亮了黑夜与云层。', '雷达 +0.4：战斗机、舰队与防空都更强', m => { m.radar += 0.4; });
MT('paratroop', '空降兵', 5, 'log', ['milaviation'], 1938, '从天而降，攻占敌后。', '解锁运输机；拥有制空权时可以攻占更远的城市', m => { m.para = 1; });
MT('dcarrier', '航母特混舰队', 5, 'dsea', ['carrier'], 1938, '谁控制了天空，谁就控制了海洋。信息时代演化为「航母战斗群」。', '航母 +30%，舰载机 +0.25，舰队防空 +0.2', docFx('sea', 'dcarrier'), { excl: 'sea' });
MT('draid', '狼群战术', 5, 'dsea', ['submarine'], 1938, '切断敌人的海上生命线。信息时代演化为「无限制潜艇战」。', '潜艇 +30%，破交 +50%，潜艇隐蔽 +0.2', docFx('sea', 'draid'), { excl: 'sea' });
MT('dcas', '近距空中支援', 5, 'dair', ['divebomber'], 1938, '飞行的炮兵。信息时代演化为「空中骑兵」。', '攻击机与无人机 +25%，对地支援 +30%', docFx('air', 'dcas'), { excl: 'air' });
MT('stratbomber', '战略轰炸机', 5, 'abo', ['tacbomber', 'massprod'], 1939, '千机大轰炸。', '解锁战略轰炸机，战略轰炸 +0.3', m => { m.sbomb += 0.3; });
MT('dsup', '制空优先', 5, 'dair', ['monoplane', 'radar'], 1939, '先夺取天空，其余一切随之而来。信息时代演化为「全域空中优势」。', '战斗机 +25%，制空 +20%，空战战损 −20%', docFx('air', 'dsup'), { excl: 'air' });
MT('landingcraft', '登陆艇', 5, 'log', ['destroyer', 'combustion'], 1940, '跳板放下，士兵冲上滩头。', '解锁登陆舰，两栖作战 +0.4', m => { m.amphib += 0.4; });
MT('dstrat', '战略轰炸', 5, 'dair', ['stratbomber'], 1940, '炸毁工厂就是摧毁前线。信息时代演化为「核威慑三位一体」。', '轰炸机 +25%，战略轰炸 +0.5，核威慑 +0.2', docFx('air', 'dstrat'), { excl: 'air' });
MT('infat', '步兵反坦克武器', 5, 'inf', ['infww'], 1942, '火箭筒与无后坐力炮，步兵第一次能独自击毁坦克。', '步兵反装甲 +0.4，反坦克 +15%', m => { m.infAT += 0.4; m.q.at *= 1.15; });
MT('tankdes', '坦克歼击车', 5, 'arm', ['tankmed', 'artillery'], 1942, '为猎杀坦克而生的长身管火炮。', '解锁坦克歼击车', m => {});
MT('spg', '自行火炮', 5, 'art', ['howitzer', 'tankmed'], 1943, '把火炮装上坦克底盘，打完就走。', '解锁自行火炮', m => {});
MT('tankheavy', '重型坦克', 5, 'arm', ['tankmed'], 1943, '移动的钢铁堡垒，慢，却几乎打不穿。', '解锁重型坦克', m => {});
MT('jetfighter', '喷气式战斗机', 5, 'afi', ['monoplane', 'radar'], 1945, '螺旋桨时代结束了。', '解锁喷气式战斗机', m => {});
MT('hbomb', '热核武器', 5, 'msl', ['nukeweapons', 'computer'], 1952, '氢弹，威力是原子弹的上千倍。', '核当量 ×2，核威慑 +0.1', m => { m.nukeY = 2; m.deter += 0.1; });
MT('nukesub', '核动力攻击潜艇', 5, 'nsub', ['submarine', 'nuclear'], 1957, '无限续航，可以在水下绕地球一周。', '解锁攻击核潜艇', m => {});
MT('icbm', '洲际弹道导弹', 5, 'msl', ['nukeweapons', 'rocketry'], 1959, '三十分钟抵达地球另一端。', '解锁洲际导弹；核打击不再依赖轰炸机', m => { m.icbm = 1; });
// ---- 信息 ----
MT('awacs', '空中预警机', 6, 'elec', ['radar', 'multirole'], 1977, '天上的指挥所。', '解锁预警机，雷达 +0.3', m => { m.radar += 0.3; });
MT('multirole', '多用途战斗机', 6, 'afi', ['jetfighter', 'computer'], 1978, '一架飞机既能空战，也能对地对海攻击。', '解锁多用途战斗机（兼任海航）', m => {});
MT('mbt', '主战坦克', 6, 'arm', ['tankheavy', 'computer'], 1979, '火控计算机、稳像火炮与燃气轮机，一种坦克包打天下。', '解锁主战坦克', m => {});
MT('mechinf', '机械化步兵', 6, 'inf', ['motorized', 'tankmed'], 1980, '步兵战车伴随坦克冲锋，下车即战。', '解锁机械化步兵', m => {});
MT('supercarrier', '核动力超级航母', 6, 'ncv', ['carrier', 'jetfighter', 'nuclear'], 1980, '十万吨级、核动力、四条弹射器。', '解锁超级航母，舰载机 +0.3', m => { m.cvAir += 0.3; });
MT('sam', '防空导弹', 6, 'art', ['aagun', 'computer'], 1981, '机动防空导弹营让低空也不再安全。', '解锁防空导弹车，反导 +0.1', m => { m.abm += 0.1; });
MT('ssbn', '战略核潜艇', 6, 'nsub', ['nukesub', 'icbm'], 1981, '深海里的第二次打击力量，确保相互毁灭。', '解锁战略核潜艇，获得核反击能力', m => { m.secondStrike = 1; });
MT('rocketart', '多管火箭炮', 6, 'art', ['spg', 'computer'], 1983, '一次齐射覆盖一整片阵地。', '解锁火箭炮', m => {});
MT('mslcruiser', '导弹巡洋舰', 6, 'ncap', ['hcruiser', 'cruisemsl'], 1983, '垂直发射系统里装着上百枚导弹。', '解锁导弹巡洋舰', m => {});
MT('aegis', '导弹驱逐舰', 6, 'nscr', ['destroyer', 'sam'], 1983, '相控阵雷达同时追踪上百个目标。', '解锁导弹驱逐舰；舰队防空 +0.35，反导 +0.1，反潜 +0.2', m => { m.fleetAA += 0.35; m.abm += 0.1; m.asw += 0.2; });
MT('helicopter', '武装直升机', 6, 'aatk', ['divebomber', 'computer'], 1984, '树梢高度的坦克杀手。', '解锁武装直升机', m => {});
MT('cruisemsl', '巡航导弹', 6, 'msl', ['icbm', 'satellite'], 1985, '贴地飞行上千公里，精确命中窗户。', '解锁巡航导弹，远程精确打击', m => { m.msl += 1; });
MT('amphibassault', '两栖攻击舰', 6, 'log', ['landingcraft', 'helicopter', 'carrier'], 1989, '直升机与气垫船从海上发起立体登陆。', '解锁两栖攻击舰，两栖作战 +0.4', m => { m.amphib += 0.4; });
MT('comparmor', '复合装甲', 6, 'arm', ['mbt', 'plastics'], 1990, '陶瓷与钢的夹层装甲，加上主动防护系统。', '装甲 +25%，抵消敌方反坦克 30%', m => { m.q.arm *= 1.25; m.armorRes += 0.3; });
MT('gps', '卫星导航', 6, 'log', ['satellite'], 1993, '每一枚炸弹都知道自己在哪里。', '炮兵 +20%，轰炸机 +15%，导弹 +0.5', m => { m.q.art *= 1.2; m.q.bomb *= 1.15; m.msl += 0.5; });
MT('abm', '反导系统', 6, 'msl', ['sam', 'icbm'], 1995, '用导弹拦截导弹。', '反导 +0.4', m => { m.abm += 0.4; });
MT('stealthbomber', '隐身轰炸机', 6, 'abo', ['stratbomber', 'stealthfighter'], 2000, '飞翼悄然掠过防空网。', '解锁隐身轰炸机', m => {});
MT('stealthfighter', '隐身战斗机', 6, 'afi', ['multirole', 'semiconductor'], 2005, '先敌发现，先敌开火。', '解锁隐身战斗机，隐身 +0.4', m => { m.stealth += 0.4; });
// ---- 未来 ----
MT('hypersonic', '高超音速武器', 7, 'msl', ['cruisemsl', 'nanotech'], 2035, '五倍音速以上机动滑翔，几乎无法拦截。', '解锁高超音速导弹；无视 60% 反导', m => { m.msl += 1; m.mslPen = 0.6; });
MT('stealthship', '隐身驱逐舰', 7, 'nscr', ['aegis', 'nanotech'], 2040, '在雷达上只有一艘渔船大小。', '解锁隐身驱逐舰', m => {});
MT('uuv', '无人潜航器', 7, 'nsub', ['nukesub', 'ai'], 2040, '成群的无人潜航器在洋底巡逻。', '解锁无人潜航器', m => {});
MT('swarm', '蜂群无人机', 7, 'auav', ['stealth', 'ai'], 2040, '上千架廉价无人机自主协同。', '解锁蜂群无人机', m => {});
MT('exosuit', '外骨骼步兵', 7, 'inf', ['mechinf', 'robotics'], 2045, '动力外骨骼让每个士兵都扛得动重机枪。', '解锁外骨骼步兵，步兵 +10%', m => { m.q.inf *= 1.1; });
MT('directenergy', '定向能武器', 7, 'art', ['sam', 'fusion'], 2050, '激光与高能微波以光速拦截来袭目标。', '解锁激光防空车与电磁轨道炮；反导 +0.3，炮兵 +20%', m => { m.abm += 0.3; m.q.art *= 1.2; });
MT('dronecarrier', '无人机母舰', 7, 'ncv', ['supercarrier', 'swarm'], 2050, '甲板上起降的全是无人机。', '解锁无人机母舰', m => {});
MT('spacefighter', '空天战机', 7, 'afi', ['stealthfighter', 'fusion'], 2060, '从跑道起飞，直入近地轨道。', '解锁空天战机', m => {});
// ---- 星际 ----
MT('gravtank', '反重力坦克', 8, 'arm', ['mech', 'antimatter'], 2400, '悬浮在地面之上，地形不再是障碍。', '解锁反重力坦克，补给 +1', m => { m.supply += 1; });
// reference years of the old military techs declared in 02_tech.js
const RY0 = { archery: -2800, horseback: -700, crossbow: 800, gunpowder: 1250, musket: 1520, artillery: 1680, rifling: 1840, machinegun: 1884, tank: 1917, nukeweapons: 1945, stealth: 1995, cyberwar: 2008, mech: 2080, orbitalwar: 2300 };

/* ---------- doctrines (one per domain; ×1.5 and an evolved name from the information era) ---------- */
const DOCTRINES = {
  dmobile: { dom: 'land', q: { arm: 0.25 }, tempo: 0.25, supply: -0.5, sp: 0.6, c: 0.3, name2: '空地一体战' },
  dfire: { dom: 'land', q: { art: 0.25, cas: 0.15 }, lossK: -0.2, sp: 0.2, c: 0.3, name2: '精确火力打击' },
  dplan: { dom: 'land', q: { inf: 0.15 }, def: 0.2, planK: 0.03, sp: 0, c: 0.1, name2: '纵深防御体系' },
  dmass: { dom: 'land', q: { inf: 0.10 }, manpower: 0.3, recov: 0.4, sp: 0.3, c: 0.6, name2: '人民战争' },
  dfleet: { dom: 'sea', q: { cap: 0.30, scr: 0.10 }, decisive: 0.15, name2: '水面打击群' },
  dcarrier: { dom: 'sea', q: { cv: 0.30 }, cvAir: 0.25, fleetAA: 0.2, name2: '航母战斗群' },
  draid: { dom: 'sea', q: { sub: 0.30 }, raid: 0.5, subStealth: 0.2, name2: '无限制潜艇战' },
  dstrat: { dom: 'air', q: { bomb: 0.25 }, sbomb: 0.5, deter: 0.2, name2: '核威慑三位一体' },
  dcas: { dom: 'air', q: { cas: 0.25, uav: 0.25 }, casK: 0.3, name2: '空中骑兵' },
  dsup: { dom: 'air', q: { fi: 0.25 }, supK: 0.2, airLossK: -0.2, name2: '全域空中优势' },
};
const DOC_SKIP = { dom: 1, q: 1, sp: 1, c: 1, name2: 1 };
function doctrineName(id, n) { const t = TECH_BY_ID[id], D = DOCTRINES[id]; return n && n.mult && n.mult.era >= 6 && D ? `${t.name} → ${D.name2}` : t.name; }

/* ---------- ideology military doctrine: budget split [land, sea, air], force templates, preferred doctrines ---------- */
const MD = (split, land, sea, air, doc) => ({ split, land: { inf: land[0], art: land[1], arm: land[2], at: land[3], aa: land[4] }, sea: { scr: sea[0], cap: sea[1], cv: sea[2], sub: sea[3] }, air: { fi: air[0], cas: air[1], bomb: air[2], nb: air[3], uav: air[4] }, doc: { land: doc[0], sea: doc[1], air: doc[2] } });
const MIL_DOCT = {
  tribal: MD([0.90, 0.10, 0], [0.60, 0.25, 0.15, 0, 0], [0.30, 0.70, 0, 0], [0.5, 0.3, 0.1, 0.1, 0], ['dmass', 'dfleet', 'dcas']),
  theocracy: MD([0.78, 0.17, 0.05], [0.55, 0.20, 0.17, 0.05, 0.03], [0.35, 0.50, 0.05, 0.10], [0.45, 0.30, 0.15, 0.05, 0.05], ['dmass', 'dfleet', 'dcas']),
  monarchy: MD([0.62, 0.33, 0.05], [0.45, 0.20, 0.25, 0.05, 0.05], [0.35, 0.55, 0.05, 0.05], [0.45, 0.25, 0.15, 0.10, 0.05], ['dplan', 'dfleet', 'dsup']),
  republic: MD([0.55, 0.40, 0.05], [0.45, 0.25, 0.20, 0.05, 0.05], [0.40, 0.45, 0.10, 0.05], [0.45, 0.20, 0.15, 0.15, 0.05], ['dfire', 'dfleet', 'dsup']),
  liberal: MD([0.42, 0.30, 0.28], [0.38, 0.25, 0.22, 0.05, 0.10], [0.40, 0.15, 0.35, 0.10], [0.40, 0.15, 0.30, 0.10, 0.05], ['dfire', 'dcarrier', 'dstrat']),
  communist: MD([0.68, 0.12, 0.20], [0.48, 0.27, 0.17, 0.05, 0.03], [0.35, 0.15, 0, 0.50], [0.45, 0.35, 0.10, 0.05, 0.05], ['dmass', 'draid', 'dcas']),
  fascist: MD([0.60, 0.13, 0.27], [0.33, 0.15, 0.37, 0.10, 0.05], [0.30, 0.25, 0.05, 0.40], [0.35, 0.40, 0.15, 0.05, 0.05], ['dmobile', 'draid', 'dcas']),
  technocracy: MD([0.38, 0.27, 0.35], [0.30, 0.30, 0.25, 0.05, 0.10], [0.40, 0.20, 0.30, 0.10], [0.35, 0.15, 0.15, 0.10, 0.25], ['dfire', 'dcarrier', 'dsup']),
  cosmo: MD([0.45, 0.27, 0.28], [0.40, 0.20, 0.15, 0.10, 0.15], [0.45, 0.15, 0.30, 0.10], [0.45, 0.10, 0.10, 0.10, 0.25], ['dplan', 'dcarrier', 'dsup']),
  transhuman: MD([0.40, 0.20, 0.40], [0.35, 0.20, 0.30, 0.05, 0.10], [0.40, 0.15, 0.30, 0.15], [0.30, 0.15, 0.10, 0.05, 0.40], ['dmobile', 'dcarrier', 'dsup']),
  hive: MD([0.55, 0.15, 0.30], [0.55, 0.15, 0.20, 0.05, 0.05], [0.35, 0.10, 0.15, 0.40], [0.30, 0.20, 0.10, 0.05, 0.35], ['dmass', 'draid', 'dcas']),
};
// military research preference by branch and ideology
const BR_W = {
  fascist: { arm: 2.2, aatk: 1.8, nsub: 1.6, afi: 1.3, art: 1.1, ncap: 0.6, ncv: 0.5 },
  communist: { inf: 1.6, art: 1.8, arm: 1.4, nsub: 1.5, aatk: 1.4, msl: 1.4, ncv: 0.4 },
  liberal: { afi: 1.6, abo: 1.6, ncv: 1.8, nscr: 1.3, elec: 1.5, art: 1.2, msl: 1.2 },
  monarchy: { ncap: 1.8, nscr: 1.2, arm: 1.2, inf: 1.1, log: 1.2 },
  republic: { ncap: 1.4, nscr: 1.3, inf: 1.1, log: 1.2 },
  theocracy: { inf: 1.5, art: 1.2, log: 1.2 },
  technocracy: { auav: 2.2, elec: 1.8, afi: 1.4, msl: 1.3 },
  transhuman: { auav: 2.0, arm: 1.4, inf: 1.3, elec: 1.3 },
  hive: { auav: 2.0, inf: 1.6, nsub: 1.3 },
  cosmo: { elec: 1.4, art: 1.3, log: 1.3, afi: 1.2 },
  tribal: { inf: 1.3, arm: 1.3 },
};
const MIL_PRESET = { balanced: null, land: [0.75, 0.12, 0.13], sea: [0.35, 0.5, 0.15], air: [0.4, 0.2, 0.4] };
const MIL_PRESET_NAME = { balanced: '均衡', land: '陆权', sea: '海权', air: '空权' };

/* ---------- index tables (both tracks) ---------- */
for (const t of TECHS) { t.mil = MIL_BRANCH.has(t.br); if (t.mil && t.ry === undefined) t.ry = RY0[t.id]; t.cat = CAT_OF_BRANCH[t.br]; }
for (let e = 0; e < NERA; e++) for (const mil of [false, true]) {
  const ts = TECHS.filter(t => t.era === e && t.mil === mil);
  if (mil) ts.sort((a, b) => a.ry - b.ry);
  ts.forEach((t, k) => { t.idx = k; t.per = ts.length; if (!mil) t.ry = Math.round(ERA_REF[e] + (ERA_REF[e + 1] - ERA_REF[e]) * k / ts.length); });
}
const TECH_BY_ID = Object.fromEntries(TECHS.map(t => [t.id, t]));
const UNLOCKS = {}; for (const t of TECHS) for (const r of t.req) (UNLOCKS[r] = UNLOCKS[r] || []).push(t.id);
const TECH_UNITS = {}; for (const u of UNITS) (TECH_UNITS[u.tech] = TECH_UNITS[u.tech] || []).push(u.id);
for (const t of TECHS) t.units = TECH_UNITS[t.id] || [];
for (const u of UNITS) { const t = TECH_BY_ID[u.tech]; u.era = t ? t.era : 0; }
// rule: civil techs never require military ones (otherwise a nation with a small army budget would stall its era)
{ const bad = TECHS.filter(t => !t.mil && t.req.some(r => TECH_BY_ID[r].mil)).map(t => t.id); if (bad.length) throw new Error('civil techs depend on military techs: ' + bad.join(', ')); }
{ const bad = TECHS.filter(t => t.req.some(r => !TECH_BY_ID[r] || TECH_BY_ID[r].excl) || (t.mil && !(t.ry >= ERA_REF[t.era] && t.ry <= ERA_REF[t.era + 1]))).map(t => t.id); if (bad.length) throw new Error('bad tech data: ' + bad.join(', ')); }   // doctrines are never prerequisites

/* ---------- per-nation military multipliers (called at the end of computeMult) ---------- */
// model choice per role: land models follow the land doctrine's taste for speed (sp) and cheapness (c)
for (const u of UNITS) { u.score = { '': unitScore(u, 0.2, 0.3) }; for (const id in DOCTRINES) if (DOCTRINES[id].dom === 'land') u.score[id] = unitScore(u, DOCTRINES[id].sp, DOCTRINES[id].c); }
function milMult(n, m) {
  const k = m.era >= 6 ? 1.5 : 1;
  for (const dom of DOMS) {
    const id = m.doc[dom], D = id && DOCTRINES[id]; if (!D) continue;
    for (const r in D.q) m.q[r] *= 1 + D.q[r] * k;
    for (const f in D) { if (DOC_SKIP[f]) continue; if (f === 'def' || f === 'manpower') m[f] *= 1 + D[f] * k; else m[f] += D[f] * k; }
  }
  const lk = DOCTRINES[m.doc.land] ? m.doc.land : '';
  for (const dom of DOMS) for (const r of ROLES[dom]) {
    let bu = null, bs = -1;
    const k = dom === 'land' ? lk : '';
    for (const u of UNITS_BY_ROLE[r]) if (n.techs[u.tech] !== undefined) { const s = u.score[k]; if (s > bs) { bs = s; bu = u; } }
    m.best[r] = bu ? bu.id : null;
  }
  const has = id => n.techs[UNIT_BY_ID[id].tech] !== undefined;
  const a = m.aux;
  a.siege = has('catapult') && !m.cannon ? 'catapult' : null;
  a.landing = has('amphib') ? 'amphib' : has('transport') ? 'transport' : null;
  a.para = has('transport_plane') ? 'transport_plane' : null;
  a.awacs = has('awacs') ? 'awacs' : null;
  a.ssbn = has('ssbn') ? 'ssbn' : null;
  a.msl = has('hypersonic') ? 'hypersonic' : has('cruise_missile') ? 'cruise_missile' : null;
  a.icbm = has('icbm') ? 'icbm' : null;
  a.orbital = has('orbital_platform') ? 'orbital_platform' : null;
  if (m.secondStrike) m.deter += 0.2;
}
