-- 军事大亨：共享配置（ReplicatedStorage.Config，服务器和客户端都 require）
-- 数值都在这里调：建筑、兵种、关卡敌军、武器、军衔、重生、每日奖励与任务、突袭与约战、战场支援、老兵、补给空投
local Config = {}

Config.Version = "0.9"
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
Config.Spawn = { x = -10, z = -118 }   -- 出生点（基地里，相对基地中心）：在中轴大道南头，面朝大门和战场
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
  { id = "barracks", name = "兵营", kind = "mil", units = { "inf", "mg", "mortar", "sniper", "at", "manpad", "medic", "flamer", "commando" }, price = 300, req = "house1", x = -95, z = 30, size = { 32, 12, 24 } },
  { id = "house2", name = "居民楼 B", kind = "house", price = 300, income = 10, req = "house1", x = -40, z = -95, size = { 18, 22, 18 } },
  { id = "hq", name = "指挥部", kind = "hq", price = 800, req = "barracks", x = -95, z = 100, size = { 30, 14, 24 }, cap = { 10, 18, 30, 40 }, up = { 3000, 15000, 60000 } },
  { id = "factory1", name = "轻工厂", kind = "factory", price = 900, income = 20, req = "house2", x = -95, z = -45, size = { 26, 13, 22 } },
  { id = "tankfac", name = "装甲车厂", kind = "mil", units = { "jeep", "ifv", "td", "tank", "miner", "breacher", "repair", "railgun", "heavytank" }, price = 2500, req = "factory1", x = -40, z = 30, size = { 36, 18, 30 } },
  { id = "house3", name = "居民楼 C", kind = "house", price = 2000, income = 30, req = "factory1", x = 15, z = -95, size = { 18, 30, 18 } },
  { id = "power", name = "发电厂", kind = "power", price = 4000, req = "factory1", x = 15, z = -45, size = { 22, 20, 22 } },
  { id = "aafac", name = "防空车间", kind = "mil", units = { "aa", "spaag", "cram", "laser", "sam", "ew" }, price = 6000, req = "tankfac", x = 15, z = 30, size = { 30, 14, 24 } },
  { id = "artyfac", name = "炮兵阵地", kind = "mil", units = { "howitzer", "arty", "heavyarty", "mlrs", "ballistic" }, price = 9000, req = "tankfac", x = 80, z = 30, size = { 32, 9, 32 } },
  { id = "factory2", name = "重工厂", kind = "factory", price = 12000, income = 60, req = "power", x = -40, z = -45, size = { 28, 16, 24 } },
  { id = "helipad", name = "直升机场", kind = "mil", units = { "heli", "transport", "drone", "loiter", "swarm" }, price = 20000, req = "factory2", x = 85, z = 100, size = { 48, 3, 48 } },
  -- 空军基地在围墙外面（基地右边），购买按钮在围墙里面靠右（pad 是按钮相对建筑中心的位置）
  { id = "airbase", name = "空军基地", kind = "mil", units = { "attacker", "fighter", "gunship", "bomber", "stealth" }, price = 40000, req = "helipad", x = 205, z = -10, size = { 60, 12, 240 }, pad = { -90, 0 } },
  { id = "factory3", name = "军工联合体", kind = "factory", price = 45000, income = 150, req = "factory2", x = 80, z = -45, size = { 30, 20, 26 } },
  { id = "bank", name = "银行", kind = "bank", price = 120000, income = 350, req = "factory3", x = 80, z = -95, size = { 22, 28, 22 } },
  -- 西边工业区（围墙外；西墙南段有工业区大门）：油井（炼油厂加成）、弹药厂、钢铁厂、矿场（算工厂，发电厂、核电站加成）、核电站
  { id = "oil1", name = "油井 A", kind = "oil", price = 1500, income = 15, req = "house2", x = -185, z = -100, size = { 18, 12, 22 } },
  { id = "oil2", name = "油井 B", kind = "oil", price = 5000, income = 30, req = "oil1", x = -215, z = -100, size = { 18, 12, 22 } },
  { id = "oil3", name = "油井 C", kind = "oil", price = 15000, income = 60, req = "oil2", x = -245, z = -100, size = { 18, 12, 22 } },
  { id = "refinery", name = "炼油厂", kind = "refinery", price = 30000, income = 100, req = "oil2", x = -330, z = -100, size = { 52, 26, 34 } },
  { id = "ammo", name = "弹药厂", kind = "factory", price = 60000, income = 200, req = "factory2", x = -205, z = -30, size = { 46, 14, 30 } },
  { id = "steel", name = "钢铁厂", kind = "factory", price = 160000, income = 450, req = "ammo", x = -320, z = -30, size = { 46, 22, 34 } },
  { id = "mine", name = "矿场", kind = "factory", price = 300000, income = 800, req = "steel", x = -205, z = 45, size = { 46, 18, 34 } },
  { id = "nuclear", name = "核电站", kind = "nuclear", price = 800000, income = 1500, req = "mine", x = -320, z = 40, size = { 60, 40, 48 } },
  -- 工业区里的两座战略设施：雷达站（打仗时所有支援技能冷却快两成）、导弹发射井（多一个支援技能「巡航导弹」）
  { id = "radar", name = "雷达站", kind = "radar", price = 25000, req = "hq", x = -280, z = -100, size = { 26, 22, 26 } },
  { id = "silo", name = "导弹发射井", kind = "silo", price = 150000, req = "radar", x = -258, z = 45, size = { 26, 10, 26 } },
  -- 重生开放的新区域（area = 重生第几次开放，范围见 Config.Areas；从后墙的南门出去，门外一条东西向的路连着三块；买的按钮在楼北边、挨着路）
  { id = "dock", name = "码头仓库", kind = "port", area = 1, price = 250000, income = 700, x = -78, z = -214, size = { 44, 14, 34 }, pad = { 0, 24 } },
  { id = "shipyard", name = "造船厂", kind = "port", area = 1, price = 650000, income = 1700, req = "dock", x = 2, z = -222, size = { 54, 26, 46 }, pad = { 0, 30 } },
  { id = "navalhq", name = "海军司令部", kind = "port", area = 1, price = 1600000, income = 4000, req = "shipyard", x = 84, z = -212, size = { 36, 24, 32 }, pad = { 0, 23 } },
  { id = "propellant", name = "推进剂工厂", kind = "missile", area = 2, price = 2600000, income = 6500, x = 186, z = -214, size = { 44, 18, 36 }, pad = { 0, 25 } },
  { id = "assembly", name = "导弹总装厂", kind = "missile", area = 2, price = 6500000, income = 16000, req = "propellant", x = 266, z = -220, size = { 50, 28, 44 }, pad = { 0, 29 } },
  { id = "strategic", name = "战略导弹营", kind = "missile", area = 2, price = 16000000, income = 38000, req = "assembly", x = 346, z = -214, size = { 40, 16, 40 }, pad = { 0, 27 } },
  { id = "satfac", name = "卫星工厂", kind = "space", area = 3, price = 32000000, income = 75000, x = -186, z = -214, size = { 44, 22, 36 }, pad = { 0, 25 } },
  { id = "launchpad", name = "火箭发射台", kind = "space", area = 3, price = 85000000, income = 190000, req = "satfac", x = -266, z = -226, size = { 46, 70, 46 }, pad = { 0, 30 } },
  { id = "spacecmd", name = "太空指挥中心", kind = "space", area = 3, price = 220000000, income = 450000, req = "launchpad", x = -346, z = -212, size = { 40, 26, 34 }, pad = { 0, 24 } },
}
-- 重生开放的新区域：重生第 n 次开放 Areas[n]（相对基地中心的范围，都在基地南边、湖北岸；没开放的围着铁丝网、立着牌子）
Config.Areas = {
  { n = 1, id = "port", name = "港口区", x0 = -128, x1 = 128, z0 = -302, z1 = -158, color = Color3.fromRGB(60, 130, 210), desc = "湖边的码头仓库、造船厂、海军司令部" },
  { n = 2, id = "missile", name = "导弹基地", x0 = 140, x1 = 392, z0 = -302, z1 = -158, color = Color3.fromRGB(214, 120, 40), desc = "推进剂工厂、导弹总装厂、战略导弹营" },
  { n = 3, id = "space", name = "航天中心", x0 = -392, x1 = -140, z0 = -302, z1 = -158, color = Color3.fromRGB(150, 110, 230), desc = "卫星工厂、火箭发射台、太空指挥中心" },
}
Config.SouthGate = { -16, 16 }              -- 后墙中间的南门（x 范围）
Config.SouthRoad = { z0 = -154, z1 = -138 }  -- 门外东西向的路（z 范围），x 从最西的区域通到最东的
-- 这栋楼现在能不能盖：老区域一直开着，新区域要重生够次数
function Config.AreaOpen(b, rebirth)
  return b.area == nil or (rebirth or 0) >= b.area
end
-- 重生进度：开放了的区域里盖了几栋、一共几栋
function Config.RebirthProgress(owned, rebirth)
  local built, total = 0, 0
  for _, b in ipairs(Config.Buildings) do
    if Config.AreaOpen(b, rebirth) then
      total = total + 1
      if owned and owned[b.id] then built = built + 1 end
    end
  end
  return built, total
end
Config.PowerBoost = 1.5     -- 有发电厂时工厂收入乘几
Config.RefineryBoost = 1.5  -- 有炼油厂时油井收入乘几
Config.NuclearBoost = 1.3   -- 有核电站时工厂收入再乘几
Config.RadarCD = 0.8        -- 有雷达站时支援技能冷却乘几
-- 工业区的范围（相对基地中心，在西墙外）、西墙上大门的 z 范围、工业区里那条南北向主路的 x
Config.Industry = { x0 = -392, x1 = -138, z0 = -132, z1 = 84, gate = { -98, -80 }, roadX = -152 }

-- 建筑升级：有收入的建筑能升到 max 级；每升一级收入多原来的 inc 倍（5 级是 3 倍），升级价 = 原价 × cost ^ 现在的级数
Config.Upgrade = { max = 5, inc = 0.5, cost = 1.7 }
function Config.UpgradeCost(b, lv)
  return math.floor(b.price * Config.Upgrade.cost ^ (lv or 1))
end
-- 升级后长高：每升一级，这几类楼的高度多原来的几成（工业区那些按固定外形画，只是牌子挂高一点）
Config.UpgradeHeight = { house = 0.25, factory = 0.12, bank = 0.2 }
function Config.SizeAt(b, lv)
  local k = 1 + (Config.UpgradeHeight[b.kind] or 0) * ((lv or 1) - 1)
  return { b.size[1], b.size[2] * k, b.size[3] }
end
-- 一栋楼现在每秒挣多少（算上级数和加成；owned 是已经盖了的建筑表，lv 是这栋的级数）
function Config.BuildingIncome(b, owned, lv)
  if not b.income then return 0 end
  local v = b.income * (1 + Config.Upgrade.inc * ((lv or 1) - 1))
  if b.kind == "factory" then
    if owned.power then v = v * Config.PowerBoost end
    if owned.nuclear then v = v * Config.NuclearBoost end
  elseif b.kind == "oil" and owned.refinery then
    v = v * Config.RefineryBoost
  end
  return v
end

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
--   prefer 优先打的目标（inf / armor / air）；model 用哪个导入模型（没导入就用零件拼的）；needHQ 指挥部几级才能造；
--   heal 给附近的友军回血（r 半径、hps 每秒回多少、foot / armor 给步兵还是车辆）；flame 喷火（画成火焰）；camo 伪装（敌人不爱打它）；
--   kamikaze 一次性：飞到跟前一头撞上（打完不回来，不算损失）；jam 电子干扰（半径 r 里的友军被导弹打中的几率 × p）；
--   stealth 隐身：只有带导弹、够得着 400 格高的（爱国者、战斗机）才打得到；
--   lob 从飞机上往下打炮弹（空中炮艇）；swarm 放自杀无人机（n 架、t 兵种）；laser 激光（瞬间命中、画成光束）；pierce 贯穿（电磁炮：一条线上的都打，长度）；
--   mines 开战时在前方布雷（n 颗、dmg、splash、r 触发半径、re 隔几秒补一颗、more 最多补几颗）；ballistic 弹道导弹（打敌人最密的地方，高抛，只有爱国者拦得住）；
--   abm 反导（爱国者拦弹道导弹：range、rate、p）；hidden 不在兵工厂里卖（蜂群放出来的小无人机）
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
  medic = { name = "医疗兵", short = "医疗", cat = "foot", row = 2, lv = 9, ew = 0.6, price = 160, hp = 100, dmg = 5, rate = 0.8, range = 110, speed = 14, size = 8,
    foot = true, squad = 2, heal = { r = 70, hps = 14, foot = true }, vsArmor = 0.05, vsAir = 0.2, vsInf = 1, prefer = "inf", model = "soldier",
    desc = "跟着部队走，附近受伤的步兵（还有你本人）慢慢回血" },
  flamer = { name = "火焰喷射组", short = "火焰", cat = "foot", row = 1, lv = 10, ew = 0.7, price = 220, hp = 150, dmg = 13, rate = 0.25, range = 75, speed = 14, size = 8,
    foot = true, squad = 2, flame = true, splash = 10, vsArmor = 0.25, vsAir = 0, vsInf = 1.6, prefer = "inf", model = "soldier",
    desc = "冲到跟前喷火，一片步兵都烧着；打车不太行，怕被远处的机枪点名" },
  commando = { name = "特种小队", short = "特种", cat = "foot", row = 1, lv = 15, ew = 0.5, price = 520, hp = 280, dmg = 26, rate = 0.3, range = 210, speed = 18, size = 8,
    foot = true, squad = 3, camo = true, reach = 90, vsArmor = 0.35, vsAir = 0.45, vsInf = 1.4, prefer = "inf", needHQ = 3, model = "soldier",
    desc = "跑得快、枪法准，穿着伪装敌人不爱打它；贵" },
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
  repair = { name = "抢修车", short = "抢修", cat = "armor", row = 4, lv = 12, ew = 0.5, price = 480, hp = 460, dmg = 7, rate = 0.5, range = 110, speed = 26, size = 14, len = 13,
    armor = true, turret = true, heal = { r = 80, hps = 32, armor = true }, vsArmor = 0.05, vsAir = 0.2, vsInf = 0.7, prefer = "inf", model = "jeep",
    desc = "跟在车队后面，附近的坦克、装甲车、火炮慢慢修好" },
  railgun = { name = "电磁炮", short = "电磁炮", cat = "armor", row = 4, lv = 21, ew = 0.5, price = 1500, hp = 520, dmg = 360, rate = 5.5, range = 480, speed = 20, size = 18, len = 18,
    armor = true, turret = true, pierce = 430, vsArmor = 1.3, vsInf = 0.9, prefer = "armor", needHQ = 3, model = "td",
    desc = "电磁轨道炮：一发蓝光贯穿一整条线，路上的车、人都打穿（越往后越弱）；射程远、装填慢" },
  miner = { name = "布雷车", short = "布雷", cat = "armor", row = 2, lv = 14, ew = 0.6, price = 800, hp = 700, dmg = 12, rate = 1, range = 130, speed = 24, size = 18, len = 18,
    armor = true, mines = { n = 10, dmg = 320, splash = 16, r = 11, re = 14, more = 4 }, vsArmor = 0.2, vsInf = 0.8, vsAir = 0, prefer = "inf", needHQ = 2, model = "breacher",
    desc = "开战就在部队前方撒一片地雷（10 颗，撒在敌人停下来开火的那一带），敌人的车、步兵踩上就炸；之后每 14 秒再补一颗" },
  heavytank = { name = "重型坦克", short = "重坦", cat = "armor", row = 4, lv = 19, ew = 0.5, price = 1800, hp = 2400, dmg = 170, rate = 2.8, range = 240, speed = 17, size = 26, len = 27,
    armor = true, turret = true, splash = 18, vsArmor = 1.15, vsInf = 1.2, prefer = "armor", needHQ = 4, model = "tank",
    desc = "又大又硬：血是主战坦克的三倍多，炮也更狠；走得慢，怕攻击机和反坦克导弹" },
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
    armor = true, homing = 420, reach = 1000, airOnly = true, vsAir = 1, abm = { range = 760, rate = 4, p = 0.6 }, prefer = "air", needHQ = 3, model = "sam",
    desc = "爱国者防空导弹：射程最远，一发打掉一架直升机；只打飞机（也只有它和战斗机打得到隐身轰炸机），还能拦截敌人的弹道导弹" },
  laser = { name = "激光防空车", short = "激光", cat = "aa", row = 5, lv = 20, ew = 0.4, price = 1700, hp = 420, dmg = 45, rate = 0.35, range = 300, speed = 22, size = 16, len = 12,
    armor = true, turret = true, laser = true, reach = 320, vsAir = 2.6, vsArmor = 0.25, vsInf = 0.4, intercept = { range = 300, rate = 0.45, p = 0.85, laser = true },
    prefer = "air", needHQ = 3, model = "cram", desc = "高能激光：光束一扫，无人机、直升机冒烟掉下来；还能把飞来的炮弹、火箭弹烧爆在半空" },
  ew = { name = "电子战车", short = "电战", cat = "aa", row = 5, lv = 17, ew = 0.4, price = 950, hp = 400, dmg = 8, rate = 0.4, range = 150, speed = 22, size = 20, len = 20,
    armor = true, jam = { r = 230, p = 0.45 }, vsArmor = 0.1, vsAir = 0.6, vsInf = 0.8, reach = 120, prefer = "inf", needHQ = 2, model = "sam",
    desc = "干扰敌人的导弹：附近的友军被反坦克导弹、防空导弹打中的几率少一半多" },
  -- 炮兵（炮兵阵地）
  howitzer = { name = "牵引榴弹炮", short = "榴弹炮", cat = "arty", row = 8, lv = 11, ew = 1, price = 480, hp = 220, dmg = 80, rate = 5, range = 620, minRange = 100, splash = 30,
    speed = 7, size = 18, len = 20, vsArmor = 0.8, vsInf = 1.4, prefer = "inf", model = "howitzer", desc = "M777 155 毫米榴弹炮：便宜、射程远；挪得慢，没装甲" },
  arty = { name = "自行火炮", short = "自行炮", cat = "arty", row = 8, lv = 7, ew = 1.2, price = 650, hp = 280, dmg = 75, rate = 4.5, range = 560, minRange = 100, splash = 32,
    speed = 18, size = 18, len = 16, armor = true, turret = true, vsArmor = 0.8, vsInf = 1.4, prefer = "inf", model = "arty", desc = "射程很远，炮弹溅射，专打扎堆的步兵；被贴近就危险" },
  heavyarty = { name = "重型自行火炮", short = "重炮", cat = "arty", row = 9, lv = 18, ew = 0.6, price = 1500, hp = 420, dmg = 120, rate = 5.5, range = 760, minRange = 120, splash = 36,
    speed = 16, size = 22, len = 24, armor = true, turret = true, vsArmor = 0.9, vsInf = 1.4, prefer = "inf", needHQ = 3, model = "heavyarty",
    desc = "PzH 2000：射程最远的火炮，炮弹大、炸一大片" },
  ballistic = { name = "弹道导弹车", short = "弹道", cat = "arty", row = 9, lv = 26, ew = 0.3, price = 2600, hp = 360, dmg = 650, rate = 20, range = 1000, minRange = 150, splash = 48,
    speed = 14, size = 22, len = 22, armor = true, ballistic = true, vsArmor = 1.2, vsInf = 1.3, prefer = "armor", needHQ = 4, model = "sam",
    desc = "每 20 秒朝敌人扎堆最密的地方打一枚弹道导弹，炸平一大片（满场都打得到）；只有敌人的爱国者拦得住" },
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
  loiter = { name = "巡飞弹", short = "巡飞弹", cat = "air", row = 6, lv = 16, ew = 0.6, price = 380, hp = 90, dmg = 420, rate = 1, range = 14, speed = 72, size = 10, len = 7,
    air = true, alt = 40, kamikaze = true, splash = 16, vsArmor = 1.5, vsInf = 1, vsAir = 0, prefer = "armor", model = "drone",
    desc = "一次性的自杀式无人机：飞过去一头撞上，专炸坦克（撞了就没了，不算损失）；路上会被防空打下来" },
  swarm = { name = "蜂群无人机车", short = "蜂群", cat = "air", row = 7, lv = 23, ew = 0.4, price = 2000, hp = 380, dmg = 0, rate = 11, range = 420, speed = 20, size = 20, len = 16,
    armor = true, swarm = { n = 4, t = "swarmling" }, vsArmor = 0, vsInf = 0, vsAir = 0, prefer = "armor", needHQ = 3, model = "mlrs",
    desc = "每 11 秒放出 4 架自杀小无人机，一窝蜂扑向敌人的车（小无人机会被防空、步兵打下来）" },
  swarmling = { name = "自杀小无人机", short = "小无人机", cat = "air", row = 6, hidden = true, price = 0, hp = 35, dmg = 140, rate = 1, range = 12, speed = 85, size = 6, len = 4,
    air = true, alt = 32, kamikaze = true, splash = 10, vsArmor = 1.2, vsInf = 1, vsAir = 0, prefer = "armor", model = "drone", desc = "蜂群无人机车放出来的" },
  attacker = { name = "攻击机", short = "攻击机", cat = "air", row = 10, lv = 16, ew = 0.6, price = 2200, hp = 1100, dmg = 160, rate = 1.6, range = 200, speed = 110, size = 26, len = 24,
    air = true, alt = 75, jet = true, turn = 1.1, cone = 0.35, splash = 12, vsArmor = 1.4, vsInf = 1.1, prefer = "armor", model = "attacker",
    desc = "A-10 雷电：低空俯冲，30 毫米机炮扫车队；皮很厚" },
  fighter = { name = "战斗机", short = "战斗机", cat = "air", row = 10, lv = 20, ew = 0.5, price = 2600, hp = 800, dmg = 260, rate = 3, range = 450, speed = 170, size = 30, len = 30,
    air = true, alt = 150, jet = true, turn = 1.6, cone = 0.5, homing = 520, reach = 1000, airOnly = true, vsAir = 1.2, prefer = "air", model = "fighter",
    desc = "歼-20：最快，专打敌方飞机（直升机、无人机、攻击机、轰炸机）；打不了地面" },
  bomber = { name = "轰炸机", short = "轰炸机", cat = "air", row = 10, lv = 22, ew = 0.4, price = 4500, hp = 2200, dmg = 180, rate = 14, bombs = 8, splash = 34, range = 260, speed = 90,
    size = 44, len = 46, air = true, alt = 170, jet = true, turn = 0.6, cone = 0.25, vsArmor = 0.9, vsInf = 1.5, prefer = "inf", needHQ = 4, model = "bomber",
    desc = "轰-6K：飞到敌人头顶扔一串八颗炸弹，炸平一大片；转弯慢" },
  gunship = { name = "空中炮艇", short = "炮艇", cat = "air", row = 10, lv = 24, ew = 0.3, price = 3800, hp = 1600, dmg = 95, rate = 1.6, range = 440, speed = 70, size = 40, len = 36,
    air = true, alt = 175, jet = true, turn = 0.55, orbit = true, cone = 4, lob = true, splash = 20, vsArmor = 0.9, vsInf = 1.4, prefer = "inf", needHQ = 4, model = "bomber",
    desc = "在战场上空绕大圈，侧舷的 105 毫米炮一发一发往下砸；飞得高，只有防空车、弹炮、激光、爱国者、战斗机够得着" },
  stealth = { name = "隐身轰炸机", short = "隐轰", cat = "air", row = 10, lv = 25, ew = 0.3, price = 6500, hp = 1700, dmg = 260, rate = 16, bombs = 6, splash = 40, range = 260, speed = 110,
    size = 40, len = 34, air = true, alt = 210, jet = true, turn = 0.7, cone = 0.25, stealth = true, vsArmor = 1.1, vsInf = 1.5, prefer = "armor", needHQ = 4, model = "stealth",
    desc = "飞翼隐身轰炸机：雷达看不见，只有爱国者和战斗机打得到；扔六颗重磅炸弹" },
  boss = { name = "猛犸重坦", short = "首领", row = 4, price = 0, hp = 9000, dmg = 220, rate = 3, range = 260, speed = 14, size = 32, len = 30, armor = true, turret = true,
    vsArmor = 1.2, vsInf = 1.2, splash = 22, prefer = "armor", model = "tank", boss = true, desc = "每十关的首领：血极厚" },
}
-- 单位技能：观战时点开自己的一个单位（跟随它），按「技能」（电脑按 F）——按兵种的页签：dur 管几秒、cd 冷却几秒；
--   sp 速度倍数、rate 射击间隔倍数（越小越快）、dmg 伤害倍数、taken 挨打倍数、reload 放的时候马上装填好
Config.Abilities = {
  foot = { id = "charge", name = "冲锋", dur = 6, cd = 25, sp = 1.8, dmg = 1.35, desc = "6 秒里跑得快一倍、打得更狠" },
  armor = { id = "smoke", name = "烟幕", dur = 6, cd = 25, taken = 0.35, desc = "放一圈烟幕：6 秒里挨打只受三成多伤害" },
  aa = { id = "rapid", name = "全力开火", dur = 6, cd = 25, rate = 0.45, reload = true, desc = "6 秒里射速翻一倍多" },
  arty = { id = "barrage", name = "急速射", dur = 6, cd = 25, rate = 0.4, reload = true, desc = "马上装填好，6 秒里射速翻一倍多" },
  air = { id = "burner", name = "加力冲刺", dur = 6, cd = 25, sp = 1.5, rate = 0.6, desc = "6 秒里飞得快一半、打得更快" },
}

-- 战况：打关卡时每关一个（第 1～3 关、首领关、逢 5 的关没有），开打前信息栏写着，开战时播报
Config.Events = {
  { id = "fog", name = "大雾", desc = "能见度低：两边射程都短三成" },
  { id = "minefield", name = "雷区", desc = "两军中间埋着一片地雷，谁踩上都炸" },
  { id = "airraid", name = "敌机突袭", desc = "两军快接上火时（开打 8 秒），敌方轰炸机沿你的阵线扔一串炸弹", at = 8 },
  { id = "reinforce", name = "空降增援", desc = "开打 10 秒，敌军在战场中间空降一批步兵和机枪车", at = 10 },
  { id = "night", name = "夜战", desc = "天黑了：两边射程短两成" },
}
function Config.EventOf(level)
  if level <= 3 or Config.IsBoss(level) or level % 5 == 0 then return nil end
  return Config.Events[(level + math.floor(level / 5)) % #Config.Events + 1]
end

-- 兵工厂的页签和兵种顺序
Config.Tabs = { { id = "foot", name = "步兵" }, { id = "armor", name = "装甲" }, { id = "aa", name = "防空" }, { id = "arty", name = "炮兵" }, { id = "air", name = "空中" } }
Config.UnitOrder = { "inf", "mg", "mortar", "sniper", "at", "manpad", "medic", "flamer", "commando", "jeep", "ifv", "td", "tank", "miner", "breacher", "repair", "railgun", "heavytank",
  "aa", "spaag", "cram", "laser", "sam", "ew", "howitzer", "arty", "heavyarty", "mlrs", "ballistic", "heli", "transport", "drone", "loiter", "swarm", "attacker", "fighter", "gunship", "bomber", "stealth" }
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

-- 重生：基地里（含已经开放的新区域）的建筑全部盖好就能重生，最多 max 次——建筑、现金、关卡、部队、科技清零，
--   换永久加成（每次收入 +income、部队血量伤害 +power），再开放一块新区域（Config.Areas）；武器、经验、军衔、积分留着
Config.Rebirth = { max = 3, income = 0.5, power = 0.1 }

-- 战场支援（打仗时屏幕下方的技能键：点一下技能，再点战场上的位置；电脑上也能按 Z X V B N）：
--   need 盖了哪栋楼才有；cd 冷却秒数（每一仗开打时全部就绪）；伤害、援军强度跟着全军战力（军工科技 × 重生）走
--   kind：barrage 炮弹覆盖（n 发落在半径 r 里，每发 dmg、溅射 splash，flight 秒后陆续落地；拦截炮挡得住）/ heal 治疗（半径 r 内我方回 pct 成血）/
--         drop 空投援军（squads 个步兵班，这一仗打完就撤）/ strike 空袭（沿进攻方向 len 格长扔 n 颗炸弹；拦截炮挡不住）
Config.Skills = {
  { id = "mortar", name = "迫击炮急袭", key = "Z", need = "barracks", cd = 25, kind = "barrage", n = 6, r = 20, dmg = 55, splash = 16, flight = 2.2,
    vsArmor = 0.35, vsInf = 1.5, desc = "6 发迫击炮弹砸向一片，专炸扎堆的步兵" },
  { id = "heal", name = "战地急救", key = "X", need = "hq", cd = 40, kind = "heal", r = 70, pct = 0.4, desc = "范围里的我方部队和你本人回四成血" },
  { id = "barrage", name = "炮火覆盖", key = "V", need = "artyfac", cd = 40, kind = "barrage", n = 12, r = 36, dmg = 95, splash = 26, flight = 3,
    vsArmor = 0.9, vsInf = 1.4, desc = "12 发 155 毫米炮弹覆盖一大片（敌方拦截炮挡得住）" },
  { id = "drop", name = "空投援军", key = "B", need = "helipad", cd = 60, kind = "drop", squads = 3, desc = "把 3 个步兵班空投到指定位置，这一仗打完就撤" },
  { id = "strike", name = "空袭", key = "N", need = "airbase", cd = 55, kind = "strike", n = 12, len = 150, dmg = 140, splash = 24,
    vsArmor = 1.1, vsInf = 1.4, desc = "轰炸机沿进攻方向扔下一串 12 颗炸弹（拦截炮挡不住）" },
  { id = "cruise", name = "巡航导弹", key = "M", need = "silo", cd = 90, kind = "missile", dmg = 1100, splash = 46, flight = 5,
    vsArmor = 1.5, vsInf = 1.3, desc = "从工业区的导弹发射井打出一枚巡航导弹，炸平一大片（拦截炮挡不住）" },
}
-- 这个玩家的技能冷却（有雷达站快两成）
function Config.SkillCD(sk, owned)
  return sk.cd * ((owned and owned.radar) and Config.RadarCD or 1)
end
Config.SkillById = {}
for _, sk in ipairs(Config.Skills) do Config.SkillById[sk.id] = sk end

-- 老兵：打完一仗活下来的部队攒经验（活下来 +1，每亲手击毁一个敌人再 +1），够 need 里的数就升一星（最多 3 星），每星血量、伤害 +bonus；星级跟着存档
Config.Vet = { need = { 3, 8, 16 }, bonus = 0.15 }
function Config.StarsOf(v)
  local s = 0
  for i, n in ipairs(Config.Vet.need) do
    if (v or 0) >= n then s = i end
  end
  return s
end

-- 补给空投：不打仗的时候每隔 every 秒（± jitter）往基地里空投一个补给箱，走过去碰一下就拿钱（= sec 秒的收入，至少 min），life 秒没捡就收走
Config.Crate = { every = 80, jitter = 25, sec = 45, min = 150, life = 120 }
-- 里程碑：打赢第 5、10、15……关时额外奖励（= 这一关的奖励 × k）
Config.Milestone = { every = 5, k = 1.5 }

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
  { id = "skill5", text = "打仗时放 5 次战场支援", kind = "skill", goal = 5 },
  { id = "crate3", text = "捡 3 个补给空投箱", kind = "crate", goal = 3 },
  { id = "up3", text = "升级 3 次建筑", kind = "upgrade", goal = 3 },
}
Config.MissionRewardSec = 120   -- 任务奖励 = 这么多秒的收入（至少 400）

-- 突袭（打别的玩家存下来的防线，对方不在线也能打）和约战（同一个服务器里点名挑战，友谊赛不算积分）
Config.Raid = { cooldown = 25, range = 250, start = 1000, k = 32, loot = 0.6, minUnits = 1 }
Config.Duel = { invite = 20, reward = 300, share = 0.2 }
-- 真人对战（排位，服内或跨服匹配）：start 起始积分、k 每场最多涨跌；window / widen / maxWindow 能配的积分差（等得越久放得越宽，每秒 +widen）；
--   tick 每几秒配一次、expire 排队记录几秒过期、refresh 几秒刷新一次；waitMax 对战服务器里等对手最多几秒、countdown 到齐后几秒开打、back 打完几秒送回去；
--   reward 赢了的奖金（再加对方部队价值的 share）、lose 输了的安慰奖
Config.Match = { start = 1000, k = 32, window = 120, widen = 12, maxWindow = 900, tick = 3, expire = 60, refresh = 10, waitMax = 75, countdown = 5, back = 8,
  reward = 600, share = 0.25, lose = 150 }

-- 音效：留空就用 Roblox 自带的声音（爆炸声变调当枪炮声）；想换成自己的就填 "rbxassetid://数字"（Studio 工具箱 → 音频里搜，复制 ID）
Config.Sounds = { rifle = "", cannon = "", aa = "", rocket = "", boom = "", build = "", buy = "", win = "", lose = "", gun = "", hit = "", kill = "", coin = "", click = "", hurt = "", alarm = "" }

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
-- 战区：每 10 关换一个（打掉首领就进下一个），地面、两边的地形、道具都换；奖励加成 reward，speed 地面部队速度倍数，range 射程倍数，quake 每几秒一次火山弹
Config.Theaters = {
  { id = "grass", lv = 1, name = "绿野战区", reward = 0, desc = "开阔的田野和农舍废墟" },
  { id = "desert", lv = 11, name = "沙漠战区", reward = 0.2, speed = 0.9, desc = "沙地难走：地面部队慢一成；奖励 +20%" },
  { id = "snow", lv = 21, name = "雪原战区", reward = 0.4, speed = 0.85, desc = "积雪很深：地面部队慢一成半；奖励 +40%" },
  { id = "urban", lv = 31, name = "城市废墟", reward = 0.6, range = 0.88, desc = "巷战：大家射程短一成；奖励 +60%" },
  { id = "volcano", lv = 41, name = "火山战区", reward = 0.8, quake = 14, desc = "每隔十几秒有火山弹砸下来，敌我都伤；奖励 +80%" },
}
function Config.TheaterOf(level)
  local t = Config.Theaters[1]
  for _, th in ipairs(Config.Theaters) do
    if level >= th.lv then t = th end
  end
  return t
end
function Config.Reward(level)
  local r = math.floor(Config.EnemyBudget(level) * 0.9 + 100 * level)
  if Config.IsBoss(level) then r = r * 2 end
  return math.floor(r * (1 + (Config.TheaterOf(level).reward or 0)))
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
