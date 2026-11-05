-- 军事大亨：共享配置（ReplicatedStorage.Config，服务器和客户端都 require）
-- 数值都在这里调：建筑、兵种、关卡敌军、武器、军衔、重生、每日奖励与任务、突袭与约战
local Config = {}

Config.Version = "0.3"
Config.SaveKey = "MilitaryTycoon_v1"   -- DataStore 名字（改了就是新存档）
Config.StartCash = 300
Config.BaseCap = 4                     -- 没有指挥部时最多几个单位
Config.OfflineHours = 2                -- 离线收益最多算几小时
Config.OfflineRate = 0.2               -- 离线时按在线收入的几成算
Config.PlotCount = 6                   -- 一个服务器几块基地（游戏设置里「最多玩家数」也设成 6）
Config.PlotSpacing = 900               -- 基地之间的间距（X 方向）
Config.BaseSize = 260                  -- 基地边长
-- 战场在基地 +Z 方向；deploy / enemy 是我方部署区、敌军区的 Z 范围（相对基地中心）。单位按真实比例（约 2.2 格 = 1 米），战场跟着放大
Config.Field = { center = 570, width = 520, length = 820, deploy = { 170, 330 }, enemy = { 810, 970 } }
-- 约战竞技场：和战场一样大小，摆在所有基地的战场后面（原点 z = Arena.z），挑战方在南边（部署区），应战方在北边（敌军区）
Config.Arena = { z = 1300, xs = { -450, 450 } }
Config.Spawn = { x = 0, z = -120 }     -- 出生点（基地里，相对基地中心）
Config.BattleTime = 240                -- 一场最多几秒，到时算没打赢（活着的照样回来）
Config.Tick = 0.05                     -- 战斗推演步长（秒）
Config.MaxEnemy = 40                   -- 敌军最多几个单位；预算再多就加强属性

-- 每块基地的颜色（队伍色圈、旗子、部署区）；敌军统一暗红
Config.PlotColors = {
  Color3.fromRGB(52, 120, 220), Color3.fromRGB(70, 170, 80), Color3.fromRGB(230, 140, 40),
  Color3.fromRGB(150, 90, 210), Color3.fromRGB(40, 180, 180), Color3.fromRGB(215, 190, 50),
}
Config.EnemyColor = Color3.fromRGB(200, 50, 45)

-- 建筑：req 是前置（盖好它才出现这个的购买按钮）；x, z 是在基地里的位置；size 是外形 { 宽, 高, 深 }
--   kind：house 居民楼 / factory 工厂 / power 发电厂 / bank 银行 / mil 军工（units：能生产的兵种）/ hq 指挥部（cap：各级部队上限，up：升级价）
--   四排：z = -95 居民楼和银行、-45 工厂、30 军工、100 指挥部和直升机场；z = 60 那条横通道和中间 x ∈ [-70, 50] 的竖通道是部队开出去的路
--   pad：购买按钮的位置（相对建筑中心，默认在建筑 −Z 那边）
Config.Buildings = {
  { id = "house1", name = "居民楼 A", kind = "house", price = 60, income = 5, x = -95, z = -95, size = { 18, 16, 18 } },
  { id = "barracks", name = "兵营", kind = "mil", units = { "inf", "mg", "mortar", "sniper", "at", "manpad" }, price = 300, req = "house1", x = -95, z = 30, size = { 26, 10, 18 } },
  { id = "house2", name = "居民楼 B", kind = "house", price = 300, income = 10, req = "house1", x = -40, z = -95, size = { 18, 22, 18 } },
  { id = "hq", name = "指挥部", kind = "hq", price = 800, req = "barracks", x = -95, z = 100, size = { 30, 14, 24 }, cap = { 10, 18, 30, 40 }, up = { 3000, 15000, 60000 } },
  { id = "factory1", name = "轻工厂", kind = "factory", price = 900, income = 20, req = "house2", x = -95, z = -45, size = { 26, 13, 22 } },
  { id = "tankfac", name = "装甲车厂", kind = "mil", units = { "jeep", "ifv", "td", "tank", "breacher" }, price = 2500, req = "factory1", x = -40, z = 30, size = { 36, 18, 30 } },
  { id = "house3", name = "居民楼 C", kind = "house", price = 2000, income = 30, req = "factory1", x = 15, z = -95, size = { 18, 30, 18 } },
  { id = "power", name = "发电厂", kind = "power", price = 4000, req = "factory1", x = 15, z = -45, size = { 22, 20, 22 } },
  { id = "aafac", name = "防空车间", kind = "mil", units = { "aa", "spaag", "cram", "sam" }, price = 6000, req = "tankfac", x = 15, z = 30, size = { 30, 14, 24 } },
  { id = "artyfac", name = "炮兵阵地", kind = "mil", units = { "howitzer", "arty", "heavyarty", "mlrs" }, price = 9000, req = "tankfac", x = 80, z = 30, size = { 32, 9, 32 } },
  { id = "factory2", name = "重工厂", kind = "factory", price = 12000, income = 60, req = "power", x = -40, z = -45, size = { 28, 16, 24 } },
  { id = "helipad", name = "直升机场", kind = "mil", units = { "heli", "transport", "drone" }, price = 20000, req = "factory2", x = 85, z = 100, size = { 48, 3, 48 } },
  -- 空军基地在围墙外面（基地右边），购买按钮在围墙里面靠右（pad 是按钮相对建筑中心的位置）
  { id = "airbase", name = "空军基地", kind = "mil", units = { "attacker", "fighter", "bomber" }, price = 40000, req = "helipad", x = 205, z = -10, size = { 60, 12, 240 }, pad = { -90, 0 } },
  { id = "factory3", name = "军工联合体", kind = "factory", price = 45000, income = 150, req = "factory2", x = 80, z = -45, size = { 30, 20, 26 } },
  { id = "bank", name = "银行", kind = "bank", price = 120000, income = 350, req = "factory3", x = 80, z = -95, size = { 22, 28, 22 } },
}
Config.PowerBoost = 1.5   -- 有发电厂时工厂收入乘几

-- 军工科技：花钱升级，每级全军（我方）血量、伤害各 +bonus；后期的钱主要花在这里，高关卡靠它
Config.Tech = { base = 2500, growth = 1.5, bonus = 0.1, max = 40 }
function Config.TechCost(level)
  return math.floor(Config.Tech.base * Config.Tech.growth ^ level)
end

-- 兵种：dmg 每发伤害、rate 几秒一发（火箭炮是一轮齐射、轰炸机是一串炸弹的间隔）、range 射程、speed 速度（格 / 秒）、size 占地（排阵、推开用）、len 模型长度（格）；
--   cat 兵工厂的页签；row 排阵的前后（1 最前）；short 简称（敌军清单）；lv 关卡敌军从第几关开始有；ew 关卡敌军里出现的多少（权重）；
--   foot 步兵（squad 几个人，prop 手里 / 旁边的武器模型）；armor 装甲；turret 有炮塔；air 会飞（alt 飞行高度）；
--   jet 固定翼（一直往前飞，turn 转弯角速度，cone 机头对准目标多少弧度以内才开火，orbit 绕着目标转圈打）；
--   reach 打得到多高的飞机（没有就只能打地面）；airOnly 只打飞机；vsArmor / vsAir / vsInf 打装甲 / 飞机 / 步兵的伤害倍数；hit 命中率（狙击）；
--   splash 溅射半径；minRange 最近射程；salvo 一轮几发；side 侧面朝敌开火（M270 的发射箱朝右）；homing 导弹（数值是弹速）；bombs 一串几颗炸弹；
--   cargo 运几个步兵班（drop 离目标多远放下）；decoy 敌人优先打它；intercept 拦截炮弹（range 范围、rate 几秒拦一发、p 拦截成功率）；
--   prefer 优先打的目标（inf / armor / air）；model 用哪个导入模型（没导入就用零件拼的）；needHQ 指挥部几级才能造
-- 克制：坦克克步兵，直升机、攻击机、反坦克导弹克坦克，防空车、弹炮、单兵防空、爱国者、战斗机克飞机，火炮、迫击炮、轰炸机打扎堆的步兵，拦截炮挡炮弹
Config.Units = {
  -- 步兵（兵营）
  inf = { name = "步兵班", short = "步兵", cat = "foot", row = 1, lv = 1, ew = 3, price = 60, hp = 110, dmg = 10, rate = 0.6, range = 120, speed = 14, size = 8,
    foot = true, squad = 3, reach = 90, vsArmor = 0.2, vsAir = 0.3, vsInf = 1, prefer = "inf", model = "soldier", desc = "便宜，人多能打下直升机；打坦克几乎没用" },
  mg = { name = "机枪组", short = "机枪", cat = "foot", row = 1, lv = 2, ew = 1.3, price = 120, hp = 130, dmg = 6, rate = 0.13, range = 150, speed = 13, size = 8,
    foot = true, squad = 2, prop = "prop_mg", reach = 90, vsArmor = 0.05, vsAir = 0.25, vsInf = 1.1, prefer = "inf", model = "soldier",
    desc = "M240 机枪泼水一样扫步兵；打车没用" },
  mortar = { name = "迫击炮组", short = "迫炮", cat = "foot", row = 7, lv = 4, ew = 0.9, price = 180, hp = 90, dmg = 45, rate = 3.5, range = 380, minRange = 40, splash = 20,
    speed = 12, size = 9, foot = true, squad = 3, prop = "prop_mortar", vsArmor = 0.3, vsInf = 1.5, prefer = "inf", model = "soldier",
    desc = "60 毫米迫击炮：便宜的曲射火力，炸扎堆的步兵" },
  sniper = { name = "狙击组", short = "狙击", cat = "foot", row = 7, lv = 6, ew = 0.8, price = 150, hp = 80, dmg = 70, rate = 2.8, range = 420, speed = 12, size = 8,
    foot = true, squad = 2, hit = 0.95, vsArmor = 0.1, vsInf = 1.4, prefer = "inf", model = "soldier", desc = "射程很远、枪枪命中，专打步兵（也盯着敌方玩家本人）" },
  at = { name = "反坦克导弹组", short = "反坦", cat = "foot", row = 1, lv = 7, ew = 1, price = 260, hp = 100, dmg = 280, rate = 6.5, range = 320, speed = 12, size = 8,
    foot = true, squad = 2, prop = "prop_javelin", homing = 260, vsArmor = 1.4, vsInf = 0.3, prefer = "armor", needHQ = 2, model = "soldier",
    desc = "标枪导弹打坦克一打一个准；人很脆，怕机枪和炮" },
  manpad = { name = "单兵防空组", short = "单防", cat = "foot", row = 1, lv = 11, ew = 0.7, price = 280, hp = 90, dmg = 140, rate = 4.5, range = 300, speed = 12, size = 8,
    foot = true, squad = 2, prop = "prop_stinger", homing = 320, reach = 200, airOnly = true, vsAir = 2.4, prefer = "air", needHQ = 2, model = "soldier",
    desc = "毒刺导弹，专打飞机（直升机、无人机、攻击机、轰炸机）；打不了地面" },
  -- 装甲（装甲车厂）
  jeep = { name = "机枪车", short = "机枪车", cat = "armor", row = 2, lv = 5, ew = 1.2, price = 200, hp = 260, dmg = 9, rate = 0.15, range = 170, speed = 40, size = 14, len = 13,
    armor = true, turret = true, reach = 90, vsArmor = 0.15, vsAir = 0.35, vsInf = 1.1, prefer = "inf", model = "jeep", desc = "M-ATV 装甲车：跑得最快，车顶机枪扫步兵" },
  ifv = { name = "步兵战车", short = "步战", cat = "armor", row = 3, lv = 5, ew = 1.6, price = 350, hp = 460, dmg = 30, rate = 0.7, range = 170, speed = 26, size = 16, len = 15,
    armor = true, turret = true, reach = 110, vsArmor = 0.45, vsAir = 0.7, vsInf = 1.3, prefer = "inf", model = "ifv", desc = "25 毫米机关炮，打步兵、直升机都行，挡不住坦克" },
  td = { name = "突击炮", short = "突击炮", cat = "armor", row = 3, lv = 8, ew = 1.2, price = 520, hp = 480, dmg = 95, rate = 2.6, range = 230, speed = 34, size = 18, len = 18,
    armor = true, turret = true, splash = 10, vsArmor = 1.15, vsInf = 0.9, prefer = "armor", model = "td", desc = "PTL-02 轮式突击炮：射程比坦克远、跑得快，专打装甲；皮薄" },
  tank = { name = "主战坦克", short = "坦克", cat = "armor", row = 4, lv = 6, ew = 2.2, price = 450, hp = 700, dmg = 90, rate = 2.4, range = 210, speed = 24, size = 22, len = 22,
    armor = true, turret = true, vsArmor = 1, vsInf = 1.25, splash = 14, prefer = "armor", model = "tank", desc = "又硬又狠，克步兵、克装甲；怕直升机、反坦克导弹" },
  breacher = { name = "破障车", short = "破障", cat = "armor", row = 2, lv = 13, ew = 0.6, price = 650, hp = 1800, dmg = 20, rate = 1, range = 140, speed = 20, size = 22, len = 23,
    armor = true, decoy = true, vsArmor = 0.2, vsInf = 1, prefer = "inf", needHQ = 2, model = "breacher", desc = "M1150 突击破障车：皮最厚，开在最前面吸引敌人火力；自己几乎不打" },
  -- 防空（防空车间）
  aa = { name = "防空车", short = "防空", cat = "aa", row = 5, lv = 8, ew = 1, price = 500, hp = 340, dmg = 28, rate = 0.5, range = 280, speed = 26, size = 14, len = 12,
    armor = true, turret = true, reach = 180, vsAir = 3.2, vsArmor = 0.35, vsInf = 0.5, prefer = "air", model = "aa", desc = "加特林高炮，专打飞机；打地面很弱" },
  spaag = { name = "弹炮防空车", short = "弹炮", cat = "aa", row = 5, lv = 13, ew = 0.7, price = 900, hp = 520, dmg = 34, rate = 0.4, range = 330, speed = 30, size = 18, len = 20,
    armor = true, turret = true, reach = 260, vsAir = 3.4, vsArmor = 0.4, vsInf = 0.7, prefer = "air", needHQ = 2, model = "spaag",
    desc = "PGL-625 弹炮结合：比防空车射得远、射得高，皮也厚" },
  cram = { name = "拦截炮", short = "拦截", cat = "aa", row = 5, lv = 15, ew = 0.4, price = 1100, hp = 360, dmg = 14, rate = 0.15, range = 220, speed = 10, size = 16, len = 12,
    armor = true, turret = true, reach = 130, airOnly = true, vsAir = 2.2, intercept = { range = 280, rate = 0.35, p = 0.65 }, prefer = "air", needHQ = 2, model = "cram",
    desc = "C-RAM 陆基密集阵：把飞来的炮弹、火箭弹打爆在半空（附近 280 格）；顺手打低空的直升机" },
  sam = { name = "爱国者", short = "爱国者", cat = "aa", row = 5, lv = 18, ew = 0.4, price = 1600, hp = 380, dmg = 520, rate = 7, range = 700, speed = 12, size = 22, len = 22,
    armor = true, homing = 420, reach = 1000, airOnly = true, vsAir = 1, prefer = "air", needHQ = 3, model = "sam", desc = "爱国者防空导弹：射程最远，一发打掉一架直升机；只打飞机" },
  -- 炮兵（炮兵阵地）
  howitzer = { name = "牵引榴弹炮", short = "榴弹炮", cat = "arty", row = 8, lv = 11, ew = 1, price = 480, hp = 220, dmg = 80, rate = 5, range = 620, minRange = 100, splash = 30,
    speed = 7, size = 18, len = 20, vsArmor = 0.8, vsInf = 1.4, prefer = "inf", model = "howitzer", desc = "M777 155 毫米榴弹炮：便宜、射程远；挪得慢，没装甲" },
  arty = { name = "自行火炮", short = "自行炮", cat = "arty", row = 8, lv = 7, ew = 1.2, price = 650, hp = 280, dmg = 75, rate = 4.5, range = 560, minRange = 100, splash = 32,
    speed = 18, size = 18, len = 16, armor = true, turret = true, vsArmor = 0.8, vsInf = 1.4, prefer = "inf", model = "arty", desc = "射程很远，炮弹溅射，专打扎堆的步兵；被贴近就危险" },
  heavyarty = { name = "重型自行火炮", short = "重炮", cat = "arty", row = 9, lv = 18, ew = 0.6, price = 1500, hp = 420, dmg = 120, rate = 5.5, range = 760, minRange = 120, splash = 36,
    speed = 16, size = 22, len = 24, armor = true, turret = true, vsArmor = 0.9, vsInf = 1.4, prefer = "inf", needHQ = 3, model = "heavyarty",
    desc = "PzH 2000：射程最远的火炮，炮弹大、炸一大片" },
  mlrs = { name = "火箭炮", short = "火箭炮", cat = "arty", row = 9, lv = 12, ew = 0.7, price = 1400, hp = 300, dmg = 60, rate = 10, salvo = 6, range = 700, minRange = 150,
    speed = 18, size = 22, len = 16, armor = true, vsArmor = 0.7, vsInf = 1.3, splash = 26, side = true, prefer = "inf", model = "mlrs", needHQ = 2,
    desc = "一轮六发覆盖一片，射程很远；装填慢、怕近身" },
  -- 空中（直升机场、空军基地）
  heli = { name = "武装直升机", short = "武直", cat = "air", row = 6, lv = 9, ew = 1.4, price = 900, hp = 420, dmg = 115, rate = 2.8, range = 300, speed = 50, size = 30, len = 30,
    air = true, alt = 70, vsArmor = 1.45, vsInf = 0.6, prefer = "armor", model = "heli", desc = "又快又狠，专克坦克；步兵、步战车、防空都打得到它" },
  transport = { name = "运兵直升机", short = "运直", cat = "air", row = 6, lv = 12, ew = 0.6, price = 1200, hp = 520, dmg = 8, rate = 0.3, range = 140, speed = 55, size = 28, len = 30,
    air = true, alt = 60, cargo = 2, drop = 170, vsArmor = 0.05, vsInf = 1, prefer = "inf", model = "transport",
    desc = "UH-60 黑鹰：每一仗把两个步兵班直接送到敌人跟前（机降的步兵不算损失）；舱门机枪" },
  drone = { name = "察打无人机", short = "无人机", cat = "air", row = 6, lv = 14, ew = 0.6, price = 1300, hp = 300, dmg = 220, rate = 6, range = 420, speed = 45, size = 22, len = 18,
    air = true, alt = 160, jet = true, turn = 0.9, orbit = true, cone = 4, homing = 240, vsArmor = 1.3, vsInf = 0.8, prefer = "armor", needHQ = 3, model = "drone",
    desc = "MQ-9：在高空绕圈，远远地打导弹；只有防空车、弹炮、单兵防空、爱国者、战斗机够得着" },
  attacker = { name = "攻击机", short = "攻击机", cat = "air", row = 10, lv = 16, ew = 0.6, price = 2200, hp = 1100, dmg = 160, rate = 1.6, range = 200, speed = 110, size = 26, len = 24,
    air = true, alt = 75, jet = true, turn = 1.1, cone = 0.35, splash = 12, vsArmor = 1.4, vsInf = 1.1, prefer = "armor", model = "attacker",
    desc = "A-10 雷电：低空俯冲，30 毫米机炮扫车队；皮很厚" },
  fighter = { name = "战斗机", short = "战斗机", cat = "air", row = 10, lv = 20, ew = 0.5, price = 2600, hp = 800, dmg = 260, rate = 3, range = 450, speed = 170, size = 30, len = 30,
    air = true, alt = 150, jet = true, turn = 1.6, cone = 0.5, homing = 520, reach = 1000, airOnly = true, vsAir = 1.2, prefer = "air", model = "fighter",
    desc = "歼-20：最快，专打敌方飞机（直升机、无人机、攻击机、轰炸机）；打不了地面" },
  bomber = { name = "轰炸机", short = "轰炸机", cat = "air", row = 10, lv = 22, ew = 0.4, price = 4500, hp = 2200, dmg = 180, rate = 14, bombs = 8, splash = 34, range = 260, speed = 90,
    size = 44, len = 46, air = true, alt = 170, jet = true, turn = 0.6, cone = 0.25, vsArmor = 0.9, vsInf = 1.5, prefer = "inf", needHQ = 4, model = "bomber",
    desc = "轰-6K：飞到敌人头顶扔一串八颗炸弹，炸平一大片；转弯慢" },
  boss = { name = "猛犸重坦", short = "首领", row = 4, price = 0, hp = 9000, dmg = 220, rate = 3, range = 260, speed = 14, size = 32, len = 30, armor = true, turret = true,
    vsArmor = 1.2, vsInf = 1.2, splash = 22, prefer = "armor", model = "tank", boss = true, desc = "每十关的首领：血极厚" },
}
-- 兵工厂的页签和兵种顺序
Config.Tabs = { { id = "foot", name = "步兵" }, { id = "armor", name = "装甲" }, { id = "aa", name = "防空" }, { id = "arty", name = "炮兵" }, { id = "air", name = "空中" } }
Config.UnitOrder = { "inf", "mg", "mortar", "sniper", "at", "manpad", "jeep", "ifv", "td", "tank", "breacher", "aa", "spaag", "cram", "sam",
  "howitzer", "arty", "heavyarty", "mlrs", "heli", "transport", "drone", "attacker", "fighter", "bomber" }
-- 玩家本人上阵（小人）：在推演里算一个步兵大小的目标，血量用角色的 Humanoid
Config.Hero = { hp = 200, size = 3, regen = 6, regenDelay = 5, respawn = 3 }

-- 玩家的武器（背包里的工具）：dmg 每发、rate 几秒一发、mag 弹匣、reload 换弹秒数、range 射程、spread 散布（度）；
--   proj 有弹道（火箭弹：speed 弹速，splash 溅射）；vsArmor / vsAir / vsInf 同兵种；pvp 打真人时的伤害倍数
Config.Weapons = {
  rifle = { name = "步枪", price = 0, dmg = 22, rate = 0.12, mag = 30, reload = 1.8, range = 450, spread = 0.8, vsArmor = 0.12, vsAir = 0.5, vsInf = 1, pvp = 1, auto = true },
  smg = { name = "冲锋枪", price = 3000, dmg = 14, rate = 0.065, mag = 40, reload = 1.6, range = 260, spread = 2.2, vsArmor = 0.08, vsAir = 0.4, vsInf = 1, pvp = 1, auto = true },
  sniper = { name = "狙击枪", price = 12000, dmg = 160, rate = 1.3, mag = 5, reload = 2.6, range = 1200, spread = 0, vsArmor = 0.3, vsAir = 0.7, vsInf = 1.2, pvp = 0.8 },
  rpg = { name = "火箭筒", price = 8000, dmg = 380, rate = 0.6, mag = 1, reload = 2.8, range = 700, spread = 0.6, proj = true, speed = 260, splash = 14,
    vsArmor = 1.6, vsAir = 1.1, vsInf = 0.8, pvp = 0.5 },
}
Config.WeaponOrder = { "rifle", "smg", "sniper", "rpg" }

-- 军衔：累计经验（打赢关卡、亲手击毁、突袭、约战）
Config.Ranks = {
  { 0, "列兵" }, { 50, "上等兵" }, { 150, "下士" }, { 350, "中士" }, { 700, "上士" }, { 1200, "少尉" }, { 2000, "中尉" }, { 3200, "上尉" },
  { 5000, "少校" }, { 7500, "中校" }, { 11000, "上校" }, { 16000, "大校" }, { 23000, "少将" }, { 33000, "中将" }, { 50000, "上将" },
}
function Config.RankOf(xp)
  local name, i = Config.Ranks[1][2], 1
  for k, r in ipairs(Config.Ranks) do
    if xp >= r[1] then name, i = r[2], k end
  end
  return name, i
end

-- 重生：打到 level 关、盖了银行就能重生——建筑、现金、关卡、部队、科技清零，换永久加成（每次收入 +income、部队血量伤害 +power）
Config.Rebirth = { level = 20, income = 0.5, power = 0.1 }

-- 每日奖励（连续登录，最多叠到 7 天）和每日任务（每天三个，按日期换）
Config.Daily = { base = 500, incomeSec = 90, step = 0.25, max = 7 }
Config.Missions = {
  { id = "win3", text = "打赢 3 场关卡", kind = "win", goal = 3 },
  { id = "kill10", text = "亲手（拿枪或开载具）击毁 10 个敌方单位", kind = "kill", goal = 10 },
  { id = "make8", text = "生产 8 个单位", kind = "make", goal = 8 },
  { id = "raid1", text = "突袭赢 1 次", kind = "raidwin", goal = 1 },
  { id = "drive3", text = "开载具击毁 3 个敌方单位", kind = "drivekill", goal = 3 },
  { id = "duel1", text = "和别的玩家约战 1 次", kind = "duel", goal = 1 },
  { id = "tech1", text = "升级 1 次军工科技", kind = "tech", goal = 1 },
  { id = "boss1", text = "打赢一场首领关", kind = "boss", goal = 1 },
  { id = "build2", text = "盖 2 栋建筑", kind = "build", goal = 2 },
}
Config.MissionRewardSec = 120   -- 任务奖励 = 这么多秒的收入（至少 400）

-- 突袭（打别的玩家存下来的防线，对方不在线也能打）和约战（同一个服务器里实时对战）
Config.Raid = { cooldown = 25, range = 250, start = 1000, k = 32, loot = 0.6, minUnits = 1 }
Config.Duel = { invite = 20, reward = 300, share = 0.2 }

-- 音效：填 "rbxassetid://数字"（Studio 工具箱 → 音频里搜，复制 ID）；留空就不放
Config.Sounds = { rifle = "", cannon = "", aa = "", rocket = "", boom = "", build = "", buy = "", win = "", lose = "", gun = "" }

-- 关卡敌军：预算按关卡往上涨，兵种逐渐解锁；每十关多一辆首领（同一关的敌军每次都一样，开打前就能看到）
function Config.EnemyBudget(level)
  return math.floor(150 * (1.28 ^ (level - 1)))
end
function Config.EnemyTypes(level)
  local t = {}
  for _, id in ipairs(Config.UnitOrder) do
    if (Config.Units[id].lv or 99) <= level then table.insert(t, id) end
  end
  return t
end
function Config.IsBoss(level)
  return level % 10 == 0
end
function Config.Reward(level)
  local r = math.floor(Config.EnemyBudget(level) * 0.9 + 100 * level)
  if Config.IsBoss(level) then r = r * 2 end
  return r
end

-- 查表：建筑 id → 建筑；兵种 → 生产它的建筑 id
Config.BuildingById = {}
Config.UnitSource = {}
for _, b in ipairs(Config.Buildings) do
  Config.BuildingById[b.id] = b
  for _, u in ipairs(b.units or {}) do Config.UnitSource[u] = b.id end
end

-- 数字加千位分隔：12345 → 12,345
function Config.Fmt(n)
  local s = string.format("%.0f", math.floor(math.abs(n)))
  local out = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
  if out:sub(1, 1) == "," then out = out:sub(2) end
  if n < 0 then out = "-" .. out end
  return out
end

-- 天数（UTC），每日奖励、每日任务用
function Config.Day(t)
  return math.floor(t / 86400)
end

-- 某一天的三个任务（按日期定，同一天大家一样）
function Config.MissionsOf(day)
  local rng = Random.new(day * 131 + 7)
  local pool = {}
  for i = 1, #Config.Missions do pool[i] = i end
  local out = {}
  for _ = 1, 3 do
    local k = rng:NextInteger(1, #pool)
    table.insert(out, Config.Missions[pool[k]])
    table.remove(pool, k)
  end
  return out
end

return Config
