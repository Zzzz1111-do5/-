const ERA_NAME = ['远古', '古典', '中世纪', '文艺复兴', '工业', '现代', '信息', '未来', '星际'];
const NERA = ERA_NAME.length;
const BRANCH = {
  agri: { name: '农业', color: '#8fcf5a' }, med: { name: '医学', color: '#4fd6a8' }, soc: { name: '社会', color: '#b8a2ff' },
  pol: { name: '政治', color: '#ec7aa8' }, sci: { name: '科学', color: '#5cc4e6' }, nav: { name: '交通', color: '#7fa8ff' },
  ind: { name: '工业', color: '#ffb547' }, mil: { name: '军事', color: '#ff6b6b' }, space: { name: '太空', color: '#d7a6ff' },
};
const BRANCH_ORDER = ['agri', 'med', 'soc', 'pol', 'sci', 'nav', 'ind', 'mil', 'space'];
// per-tech research cost by era; ERA_REF paces the world against a reference history
const COST = [1040, 11500, 16500, 15000, 16100, 24700, 94000, 1060000, 2500000];
const ERA_REF = [-3500, -1000, 500, 1450, 1760, 1890, 1975, 2035, 2250, 2600];
const WEAPON_NAME = ['石矛', '青铜矛', '铁剑', '骑士', '火枪', '步枪', '坦克', '无人机', '机甲'];

const TECHS = [];
function T(id, name, era, br, req, desc, fxt, fx) { TECHS.push({ id, name, era, br, req, desc, fxt, fx }); }
// ---- 远古 ----
T('agri', '农业', 0, 'agri', [], '驯化小麦与稻谷，人类开始定居耕作。', '可以定居与耕种', m => {});
T('husbandry', '畜牧', 0, 'agri', ['agri'], '驯养牛、羊和马，肉奶与畜力从此进入生活。', '粮食 +10%，陆地扩张距离 +1', m => { m.food *= 1.1; m.range += 1; });
T('fishing', '捕鱼', 0, 'agri', ['agri'], '独木舟与渔网。', '渔业 +30%', m => { m.fish *= 1.3; });
T('pottery', '制陶', 0, 'soc', ['agri'], '陶罐让粮食和水得以储存。', '城市承载 +8%', m => { m.food *= 1.08; });
T('shamanism', '萨满信仰', 0, 'pol', ['agri'], '祭司开始解释天地与生死。', '社会更稳定', m => { m.stab += 0.05; });
T('bronze', '青铜冶炼', 0, 'mil', ['agri'], '铜锡合金，第一批矿山出现。', '可以开矿，军力 +30%，士兵换上青铜矛', m => { m.mine = 1; m.mil *= 1.3; m.weapon = Math.max(m.weapon, 1); });
T('writing', '文字', 0, 'sci', ['pottery'], '知识第一次被刻在泥板上。', '科研 +40%，城市出现学堂', m => { m.sci *= 1.4; m.lab += 0.3; });
T('wheel', '车轮', 0, 'nav', ['husbandry'], '牛车与道路让疆域扩张。', '陆地扩张距离 +1.5', m => { m.range += 1.5; });
T('archery', '弓箭', 0, 'mil', ['husbandry'], '远程武器改变了狩猎与战争。', '军力 +20%，出现弓箭手', m => { m.mil *= 1.2; m.bow = 1; });
T('masonry', '石工', 0, 'soc', ['bronze'], '石墙与石屋拔地而起。', '城市修筑城墙，防御 +25%', m => { m.def *= 1.25; m.wall = 1; });
// ---- 古典 ----
T('iron', '铁器', 1, 'mil', ['bronze'], '铁制农具与兵器普及。', '粮食 +20%，军力 +35%，士兵换上铁剑', m => { m.food *= 1.2; m.mil *= 1.35; m.weapon = Math.max(m.weapon, 2); });
T('irrigation', '灌溉', 1, 'agri', ['pottery', 'wheel'], '水渠把干旱土地变成良田。', '粮食 +25%，干旱土地可以耕种', m => { m.food *= 1.25; m.dry = 1; });
T('math', '数学', 1, 'sci', ['writing'], '几何与算术奠定科学的基础。', '科研 +20%', m => { m.sci *= 1.2; });
T('sailing', '航海', 1, 'nav', ['wheel'], '帆船开始跨越近海。', '可跨海 12 格殖民，渔业 +50%', m => { m.sea = Math.max(m.sea, 12); m.fish *= 1.5; });
T('currency', '货币', 1, 'soc', ['writing', 'bronze'], '钱币让远方的交易成为可能。', '科研 +5%，社会更稳定', m => { m.sci *= 1.05; m.stab += 0.05; });
T('philosophy', '哲学', 1, 'sci', ['math'], '百家争鸣，思想启蒙。', '科研 +15%，社会更稳定', m => { m.sci *= 1.15; m.stab += 0.1; });
T('horseback', '骑术', 1, 'mil', ['husbandry', 'wheel'], '骑兵驰骋于草原。', '军力 +25%，陆地扩张 +1', m => { m.mil *= 1.25; m.range += 1; });
T('construction', '建筑学', 1, 'soc', ['masonry', 'math'], '拱券、道路与引水渠。', '城市承载 +5%，防御 +15%', m => { m.food *= 1.05; m.def *= 1.15; });
T('law', '法典', 1, 'pol', ['writing', 'currency'], '成文法开始约束权力。', '叛乱与分裂减少', m => { m.stab += 0.15; });
T('herbal', '草药学', 1, 'med', ['pottery', 'writing'], '用草药治疗伤病。', '人口增长加快，瘟疫伤害 -10%', m => { m.growth += 0.001; m.plague *= 0.9; });
T('theology', '神学', 1, 'pol', ['shamanism', 'writing'], '经典与教会，信仰被系统化。', '解锁神权政体，社会更稳定', m => { m.stab += 0.08; });
T('monarchy', '君主制', 1, 'pol', ['law'], '王冠代代相传。', '解锁君主专制，军力 +5%', m => { m.stab += 0.05; m.mil *= 1.05; });
T('republic', '共和制', 1, 'pol', ['philosophy', 'law'], '元老院与公民大会。', '解锁古典共和，科研 +5%', m => { m.sci *= 1.05; });
// ---- 中世纪 ----
T('croprot', '轮作制', 2, 'agri', ['iron', 'irrigation'], '土地轮流休耕，产量倍增。', '粮食 +35%', m => { m.food *= 1.35; });
T('astronomy', '天文学', 2, 'sci', ['math', 'sailing'], '观星定位，历法精确。', '科研 +10%，跨海距离 18 格', m => { m.sci *= 1.1; m.sea = Math.max(m.sea, 18); });
T('paper', '造纸术', 2, 'sci', ['writing', 'currency'], '廉价的书写材料。', '科研 +10%', m => { m.sci *= 1.1; m.lab += 0.1; });
T('printing', '印刷术', 2, 'sci', ['paper', 'philosophy'], '知识开始大规模传播。', '科研 +30%，科技与思想扩散加快', m => { m.sci *= 1.3; m.diff *= 1.3; m.spread *= 1.1; });
T('alchemy', '炼金术', 2, 'sci', ['herbal', 'bronze'], '在寻找点金石的路上发现了化学反应。', '科研 +5%', m => { m.sci *= 1.05; });
T('gunpowder', '火药', 2, 'mil', ['alchemy', 'iron'], '火炮轰开了城墙。', '军力 +50%，出现火炮', m => { m.mil *= 1.5; m.cannon = 1; });
T('feudalism', '封建制度', 2, 'pol', ['law', 'horseback'], '领主、骑士与城堡。', '军力 +20%，更稳定，出现骑士', m => { m.mil *= 1.2; m.stab += 0.1; m.weapon = Math.max(m.weapon, 3); });
T('steel', '钢铁', 2, 'ind', ['iron', 'construction'], '坩埚炼出更坚韧的钢。', '军力 +20%，防御 +10%', m => { m.mil *= 1.2; m.def *= 1.1; });
T('compass', '指南针', 2, 'nav', ['sailing', 'astronomy'], '磁针指引方向。', '跨海距离 +6', m => { m.sea += 6; });
T('university', '大学', 2, 'sci', ['philosophy', 'paper'], '学者聚在一起辩论与教学。', '科研 +20%，研究所增多', m => { m.sci *= 1.2; m.lab += 0.4; });
T('crossbow', '弩', 2, 'mil', ['archery', 'iron'], '平民也能射穿铠甲。', '军力 +20%', m => { m.mil *= 1.2; });
T('diplomacy', '外交术', 2, 'pol', ['currency', 'writing'], '常驻使节与条约。', '国家之间更愿意合作（重复博弈中的耐心 +）', m => { m.coop += 0.1; });
T('guilds', '行会', 2, 'soc', ['currency', 'construction'], '工匠组织起来。', '城市承载 +3%，人口增长加快', m => { m.food *= 1.03; m.growth += 0.0005; });
// ---- 文艺复兴 ----
T('navigation', '远洋航行', 3, 'nav', ['compass'], '大帆船开启环球航行。', '可跨洋 70 格殖民，渔业 +30%', m => { m.sea = Math.max(m.sea, 70); m.fish *= 1.3; });
T('scimethod', '科学方法', 3, 'sci', ['printing', 'astronomy'], '实验与理性取代教条。', '科研 +40%', m => { m.sci *= 1.4; m.lab += 0.3; });
T('banking', '银行', 3, 'soc', ['printing', 'currency'], '资本积累为工业铺路。', '科研 +5%，更稳定', m => { m.sci *= 1.05; m.stab += 0.05; });
T('anatomy', '解剖学', 3, 'med', ['scimethod', 'herbal'], '近代医学起步。', '人口增长加快，瘟疫伤害 -20%', m => { m.growth += 0.002; m.plague *= 0.8; });
T('optics', '光学', 3, 'sci', ['astronomy', 'university'], '望远镜与显微镜。', '科研 +10%', m => { m.sci *= 1.1; });
T('physics', '物理学', 3, 'sci', ['scimethod', 'math'], '力学三定律。', '科研 +15%', m => { m.sci *= 1.15; });
T('musket', '火枪', 3, 'mil', ['gunpowder', 'steel'], '火枪方阵取代了骑士。', '军力 +70%，士兵换上火枪', m => { m.mil *= 1.7; m.weapon = Math.max(m.weapon, 4); });
T('mercantile', '重商主义', 3, 'soc', ['banking', 'navigation'], '远洋贸易与殖民公司。', '渔业与贸易 +20%', m => { m.fish *= 1.2; m.stab += 0.05; });
T('chemistry', '化学', 3, 'sci', ['alchemy', 'scimethod'], '元素与化合物。', '科研 +5%', m => { m.sci *= 1.05; });
T('enlightenment', '启蒙运动', 3, 'pol', ['philosophy', 'printing', 'scimethod'], '自由、理性与人权。', '科研 +10%，更稳定', m => { m.sci *= 1.1; m.stab += 0.1; });
T('socialcontract', '社会契约论', 3, 'pol', ['enlightenment'], '权力来自被统治者的同意。', '解锁自由民主', m => { m.stab += 0.03; });
T('nationalism', '民族主义', 3, 'pol', ['printing', 'musket'], '“我们是一个民族。”', '军力 +15%，思想传播加快', m => { m.mil *= 1.15; m.spread *= 1.1; });
T('artillery', '野战炮兵', 3, 'mil', ['gunpowder', 'physics'], '弹道学走上战场。', '军力 +30%', m => { m.mil *= 1.3; m.cannon = 1; });
T('economics', '政治经济学', 3, 'soc', ['banking', 'enlightenment'], '看不见的手与比较优势。', '贸易合作收益提高，科研 +3%', m => { m.coop += 0.05; m.sci *= 1.03; m.tradeK += 0.5; });
// ---- 工业 ----
T('steam', '蒸汽机', 4, 'ind', ['physics', 'banking'], '工业革命，第一批工厂冒出浓烟。', '可以建工厂', m => { m.ind = Math.max(m.ind, 1); m.food *= 1.05; });
T('rail', '铁路', 4, 'nav', ['steam', 'steel'], '钢铁动脉把城市连在一起。', '粮食 +30%，工业 +15%，开采更快', m => { m.ind *= 1.15; m.food *= 1.3; m.range += 2; m.rail = 1; m.rate *= 1.5; });
T('vaccine', '疫苗', 4, 'med', ['anatomy', 'chemistry'], '天花不再可怕。', '人口增长加快，瘟疫伤害 -50%', m => { m.growth += 0.006; m.plague *= 0.5; });
T('electricity', '电力', 4, 'ind', ['physics', 'steam'], '电灯照亮了夜晚。', '工业 +25%，科研 +15%', m => { m.ind *= 1.25; m.sci *= 1.15; m.light = 1; });
T('fertilizer', '化肥', 4, 'agri', ['chemistry', 'croprot', 'electricity'], '合成氨养活了数十亿人。', '粮食 ×3.5', m => { m.food *= 3.5; });
T('telegraph', '电报', 4, 'nav', ['electricity'], '消息瞬间跨越大陆。', '科技扩散加快', m => { m.diff *= 1.2; });
T('industrialize', '工业化', 4, 'ind', ['steam', 'mercantile'], '工厂制度席卷城市。', '工业 +15%', m => { m.ind *= 1.15; });
T('rifling', '线膛枪', 4, 'mil', ['musket', 'steel'], '精准的步枪。', '军力 +60%，士兵换上步枪', m => { m.mil *= 1.6; m.weapon = Math.max(m.weapon, 5); });
T('sanitation', '公共卫生', 4, 'med', ['vaccine', 'construction'], '下水道与自来水。', '人口增长加快，瘟疫伤害 -30%', m => { m.growth += 0.002; m.plague *= 0.7; });
T('photography', '摄影', 4, 'soc', ['optics', 'chemistry'], '光影第一次被定格。', '科研 +3%', m => { m.sci *= 1.03; });
T('evolution', '进化论', 4, 'sci', ['scimethod', 'anatomy'], '物种起源。', '科研 +5%', m => { m.sci *= 1.05; });
T('marxism', '马克思主义', 4, 'pol', ['industrialize', 'enlightenment'], '“全世界无产者，联合起来！”', '解锁共产主义', m => { m.spread *= 1.05; });
T('suffrage', '普选权', 4, 'pol', ['socialcontract', 'sanitation'], '一人一票。', '社会更稳定', m => { m.stab += 0.08; });
T('propaganda', '大众宣传', 4, 'pol', ['photography', 'nationalism'], '报纸、海报与口号。', '思想传播 +30%，解锁法西斯主义', m => { m.spread *= 1.3; });
T('machinegun', '机枪', 4, 'mil', ['rifling', 'industrialize'], '堑壕与弹幕。', '军力 +40%，防御 +20%', m => { m.mil *= 1.4; m.def *= 1.2; });
// ---- 现代 ----
T('combustion', '内燃机', 5, 'ind', ['electricity', 'industrialize'], '石油时代来临，拖拉机开进农田。', '工业 +15%，粮食 +20%，开始用石油', m => { m.ind *= 1.15; m.oil = 1; m.rate *= 1.5; m.food *= 1.2; });
T('antibiotics', '抗生素', 5, 'med', ['vaccine', 'chemistry'], '青霉素拯救了亿万生命。', '人口增长大幅加快，瘟疫伤害 -60%', m => { m.growth += 0.008; m.plague *= 0.4; });
T('flight', '航空', 5, 'nav', ['combustion', 'physics'], '天涯若比邻。', '科技扩散加快，扩张 +2', m => { m.diff *= 1.2; m.range += 2; });
T('radio', '无线电', 5, 'sci', ['telegraph'], '电波穿越天空。', '科研 +5%，思想传播加快', m => { m.diff *= 1.1; m.sci *= 1.05; m.spread *= 1.1; });
T('relativity', '相对论', 5, 'sci', ['physics', 'electricity'], '时间与空间是相对的。', '科研 +15%', m => { m.sci *= 1.15; });
T('nuclear', '核裂变', 5, 'ind', ['relativity'], '原子之力。', '核电站，军力 +20%', m => { m.nuke = 1; m.mil *= 1.2; });
T('computer', '计算机', 5, 'sci', ['electricity', 'radio'], '电子大脑诞生。', '科研 +60%', m => { m.sci *= 1.6; m.lab += 0.6; });
T('rocketry', '航天', 5, 'space', ['flight', 'computer'], '人造卫星升空。', '发射卫星，开启登月竞赛', m => { m.space = 1; });
T('plastics', '塑料', 5, 'ind', ['combustion', 'chemistry'], '万能的新材料。', '工业 +5%', m => { m.ind *= 1.05; });
T('tank', '机械化战争', 5, 'mil', ['combustion', 'rifling'], '坦克与装甲车。', '军力 +70%，坦克上阵', m => { m.mil *= 1.7; m.weapon = Math.max(m.weapon, 6); });
T('massprod', '流水线', 5, 'ind', ['industrialize', 'electricity'], '大规模标准化生产。', '工业 +15%', m => { m.ind *= 1.15; });
T('greenrev', '绿色革命', 5, 'agri', ['fertilizer', 'combustion'], '高产杂交作物。', '粮食 +50%', m => { m.food *= 1.5; });
T('gametheory', '博弈论', 5, 'sci', ['economics', 'relativity'], '冯·诺依曼与纳什：理性者的策略互动。', '更看重长远合作，博弈中的耐心大幅提高', m => { m.gt = 1; m.coop += 0.1; });
T('intelligence', '情报机构', 5, 'pol', ['radio', 'propaganda'], '间谍、密码与秘密行动。', '意识形态输出 +10%', m => { m.spread *= 1.1; });
T('nukeweapons', '核武器', 5, 'mil', ['nuclear'], '能毁灭城市的炸弹。', '军力 +40%，相互确保毁灭让大国不敢轻易开战', m => { m.nukeW = 1; m.mil *= 1.4; });
T('unitednations', '国际组织', 5, 'pol', ['diplomacy', 'radio', 'flight'], '集体安全与国际法。', '战争减少，合作倾向 +', m => { m.un = 1; m.peace *= 0.7; m.coop += 0.1; });
T('welfare', '福利国家', 5, 'pol', ['suffrage', 'massprod'], '从摇篮到坟墓的保障。', '社会更稳定，人口增长加快', m => { m.stab += 0.08; m.growth += 0.001; });
// ---- 信息 ----
T('internet', '互联网', 6, 'sci', ['computer', 'radio'], '全球即时互联。', '科研 +40%，扩散大幅加快，战争减少，生育率下降', m => { m.sci *= 1.4; m.diff *= 1.6; m.peace *= 0.5; m.birth *= 0.85; });
T('renewables', '可再生能源', 6, 'ind', ['computer', 'electricity'], '风电与光伏开始替代煤炭。', '清洁能源逐步取代化石燃料', m => { m.renew = 1; });
T('genetics', '基因工程', 6, 'med', ['antibiotics', 'computer'], '改写生命的代码。', '粮食 +60%，瘟疫伤害 -40%', m => { m.food *= 1.6; m.plague *= 0.6; });
T('ai', '人工智能', 6, 'sci', ['internet'], '机器开始思考。', '科研 +80%，工业 +15%，解锁技术官僚', m => { m.sci *= 1.8; m.ind *= 1.15; m.rate *= 1.4; m.birth *= 0.85; });
T('semiconductor', '半导体', 6, 'sci', ['computer'], '芯片上的亿万晶体管。', '科研 +15%', m => { m.sci *= 1.15; m.lab += 0.3; });
T('satellite', '卫星通信', 6, 'space', ['rocketry', 'computer'], '天上的眼睛。', '科技扩散加快', m => { m.diff *= 1.2; });
T('robotics', '机器人', 6, 'ind', ['computer', 'massprod'], '无人工厂。', '工业 +20%', m => { m.ind *= 1.2; });
T('stealth', '精确制导', 6, 'mil', ['tank', 'computer'], '无人机与制导武器。', '军力 +60%，无人机出现', m => { m.mil *= 1.6; m.weapon = Math.max(m.weapon, 7); });
T('battery', '储能电池', 6, 'ind', ['renewables', 'chemistry'], '把风和阳光存起来。', '清洁能源普及加快 60%', m => { m.renewK *= 1.6; });
T('globalization', '全球化', 6, 'soc', ['internet', 'flight'], '地球村。', '战争减少，科研 +5%，贸易收益提高', m => { m.peace *= 0.6; m.sci *= 1.05; m.tradeK += 0.5; });
T('socialmedia', '社交媒体', 6, 'pol', ['internet'], '每个人都有麦克风。', '思想传播 ×1.8，社会更不稳定', m => { m.spread *= 1.8; m.stab -= 0.05; m.media = 1; });
T('cyberwar', '网络战', 6, 'mil', ['internet', 'intelligence'], '看不见的战场。', '军力 +30%', m => { m.mil *= 1.3; });
T('crypto', '数字货币', 6, 'soc', ['internet', 'economics'], '去中心化的价值网络。', '科研 +3%，贸易收益提高', m => { m.sci *= 1.03; m.tradeK += 0.3; });
T('climatepact', '气候公约', 6, 'pol', ['renewables', 'unitednations'], '各国共同减排。', '清洁能源普及 +30%，合作倾向 +', m => { m.renewK *= 1.3; m.coop += 0.05; });
// ---- 未来 ----
T('ccs', '碳捕集', 7, 'ind', ['renewables', 'chemistry'], '把二氧化碳从天空中取回来。', '主动降低大气 CO₂', m => { m.ccs = 1; });
T('fusion', '可控核聚变', 7, 'ind', ['nuclear', 'ai'], '人造太阳带来无尽的清洁能源。', '聚变能源，工业 +30%', m => { m.fusion = 1; m.ind *= 1.3; });
T('nanotech', '纳米技术', 7, 'sci', ['ai', 'genetics'], '原子尺度的制造。', '工业 +30%，粮食 +20%', m => { m.ind *= 1.3; m.food *= 1.2; });
T('spacecol', '轨道城市', 7, 'space', ['rocketry', 'fusion'], '人类开始移居近地轨道。', '轨道人口增长', m => { m.orbital = 1; });
T('quantum', '量子计算', 7, 'sci', ['semiconductor', 'ai'], '叠加态里的算力。', '科研 +50%', m => { m.sci *= 1.5; });
T('longevity', '长寿医学', 7, 'med', ['genetics', 'nanotech'], '衰老可以被治疗。', '人口增长加快', m => { m.growth += 0.003; });
T('mech', '机甲', 7, 'mil', ['robotics', 'ai', 'stealth'], '钢铁巨人走上战场。', '军力 ×2，机甲参战', m => { m.mil *= 2; m.weapon = Math.max(m.weapon, 8); });
T('geoeng', '地球工程', 7, 'space', ['ccs', 'satellite'], '太空遮阳伞为地球降温。', '全球气温逐步回落', m => { m.geo = 1; });
T('vertfarm', '垂直农场', 7, 'agri', ['genetics', 'robotics'], '摩天楼里种庄稼。', '粮食 +40%', m => { m.food *= 1.4; });
T('moonbase', '月球基地', 7, 'space', ['rocketry', 'robotics'], '月面上的第一座城市。', '可以殖民月球，解锁太阳系视角', m => { m.sci *= 1.05; m.moon = 1; });
T('dyson', '戴森云', 7, 'space', ['fusion', 'spacecol'], '环绕太阳的能量收集阵列。', '工业 +30%', m => { m.ind *= 1.3; });
T('warp', '曲率航行', 7, 'space', ['spacecol', 'nanotech', 'quantum'], '方舟驶向群星。', '可以建造星际方舟', m => { m.warp = 1; });
T('marscol', '火星殖民', 7, 'space', ['moonbase', 'fusion'], '红色星球上的穹顶城市。', '可以殖民火星', m => { m.mars = 1; });
T('asteroidmining', '小行星采矿', 7, 'space', ['moonbase', 'robotics'], '把小行星拖回来开采。', '可以殖民谷神星，补充稀土与铁矿', m => { m.asteroid = 1; });
T('terraforming', '行星改造', 7, 'space', ['geoeng', 'marscol'], '给死去的星球注入大气与海洋。', '殖民星球逐步变得宜居', m => { m.terra2 = 1; });
T('mindupload', '意识上传', 7, 'sci', ['ai', 'longevity'], '思想离开大脑。', '科研 +10%，解锁超人类主义', m => { m.sci *= 1.1; });
T('worldgov', '世界政府', 7, 'pol', ['globalization', 'unitednations', 'ai'], '一个人类，一个议会。', '战争大幅减少，解锁全球联邦，国家更容易和平合并', m => { m.coop += 0.15; m.peace *= 0.6; m.unionK = 1; });
// ---- 星际 ----
T('outercol', '外太阳系殖民', 8, 'space', ['marscol', 'fusion'], '木卫二的冰下海洋与土卫六的甲烷湖。', '可以殖民木卫二、木卫三与土卫六', m => { m.outer = 1; });
T('venusfloat', '金星浮空城', 8, 'space', ['marscol', 'nanotech'], '漂浮在酸云之上的城市。', '可以殖民金星', m => { m.venus = 1; });
T('gasharvest', '气态巨行星采集', 8, 'ind', ['outercol'], '从木星大气里抽取氦-3。', '工业 +20%', m => { m.ind *= 1.2; });
T('antimatter', '反物质引擎', 8, 'space', ['fusion', 'quantum'], '飞船速度提高一个量级。', '太空航行时间减半', m => { m.shipK = 2; });
T('exoplanet', '系外行星殖民', 8, 'space', ['warp', 'antimatter'], '人类第一次在另一颗恒星旁定居。', '可以殖民比邻星 b 与特拉比斯特-1e', m => { m.exo = 1; });
T('galacticnet', '星际互联网', 8, 'sci', ['quantum', 'outercol'], '量子纠缠通讯。', '科研 +30%，扩散加快', m => { m.sci *= 1.3; m.diff *= 1.3; });
T('postscarcity', '后稀缺经济', 8, 'soc', ['nanotech', 'dyson', 'worldgov'], '物质不再稀缺。', '社会非常稳定，战争大幅减少，粮食 +30%', m => { m.stab += 0.2; m.peace *= 0.5; m.food *= 1.3; });
T('hivemind', '集体意识', 8, 'pol', ['mindupload', 'galacticnet'], '亿万心灵连成一体。', '科研 +20%，解锁蜂巢集体', m => { m.sci *= 1.2; });
T('stellareng', '恒星工程', 8, 'space', ['dyson', 'antimatter'], '移动恒星，点亮星系。', '工业 +30%', m => { m.ind *= 1.3; });
T('xenobiology', '外星生物学', 8, 'med', ['exoplanet', 'genetics'], '另一颗星球上的生命。', '粮食 +20%，人口增长加快', m => { m.food *= 1.2; m.growth += 0.002; });
T('orbitalwar', '轨道战争', 8, 'mil', ['spacecol', 'mech'], '从太空发起打击。', '军力 +50%', m => { m.mil *= 1.5; });
T('wormhole', '虫洞', 8, 'space', ['exoplanet', 'stellareng'], '时空的捷径。', '星际航行时间缩短 80%', m => { m.shipK = Math.max(m.shipK, 6); });
T('singularity', '技术奇点', 8, 'sci', ['hivemind', 'wormhole'], '智能爆炸之后，一切都无法预测。', '科研 ×2', m => { m.sci *= 2; });
for (let e = 0; e < NERA; e++) { const ts = TECHS.filter(t => t.era === e); ts.forEach((t, k) => { t.idx = k; t.per = ts.length; }); }
const TECH_BY_ID = Object.fromEntries(TECHS.map(t => [t.id, t]));
const UNLOCKS = {}; for (const t of TECHS) for (const r of t.req) (UNLOCKS[r] = UNLOCKS[r] || []).push(t.id);

function computeMult(n) {
  const m = { food: 1, sci: 1, ind: 0, mil: 1, growth: 0.008, range: 6, sea: 0, plague: 1, light: 0.18, fish: 1, lab: 0, era: 0,
    diff: 1, birth: 1, peace: 1, stab: 0, rate: 1, dry: 0, mine: 0, rail: 0, oil: 0, nuke: 0, space: 0, renew: 0, ccs: 0, fusion: 0,
    orbital: 0, warp: 0, count: 0, def: 1, wall: 0, weapon: 0, renewK: 1, geo: 0, spread: 1, coop: 0, gt: 0, nukeW: 0, un: 0, media: 0,
    tradeK: 0, unionK: 0, bow: 0, cannon: 0, moon: 0, mars: 0, asteroid: 0, terra2: 0, outer: 0, venus: 0, exo: 0, shipK: 1 };
  for (const t of TECHS) if (n.techs[t.id] !== undefined) { t.fx(m); if (t.era > m.era) m.era = t.era; m.count++; }
  const b = n.bonus;
  if (b) {
    m.food *= 1 + (b.food || 0); m.sci *= 1 + (b.sci || 0); m.mil *= 1 + (b.mil || 0); m.def *= 1 + (b.def || 0);
    if (m.ind > 0) m.ind *= 1 + (b.ind || 0);
    m.range += b.range || 0; if (m.sea > 0) m.sea += b.sea || 0;
    m.stab += b.stab || 0; m.spread *= 1 + (b.spread || 0); m.coop += b.coop || 0; m.renewK *= 1 + (b.renew || 0); m.tradeK += b.trade || 0; m.growth += b.growth || 0;
  }
  if (n.mobil) { m.mil *= 1 + 0.15 * n.mobil; m.sci *= 1 - 0.06 * n.mobil; m.growth *= 1 - 0.1 * n.mobil; m.stab -= 0.04 * n.mobil; }
  const I = typeof IDEO_BY_ID !== 'undefined' ? IDEO_BY_ID[n.ideo || 'tribal'] : null;
  if (I) { m.sci *= I.sci; m.mil *= I.mil; m.growth *= I.growth; m.stab += I.stab; m.spread *= I.spread; m.coop += I.coop; }
  const tp = n.trade ? Object.keys(n.trade).length : 0;
  if (tp) { m.sci *= 1 + Math.min(6, tp) * 0.025 * (1 + m.tradeK * 0.3); m.food *= 1 + Math.min(6, tp) * 0.02; }
  return m;
}
