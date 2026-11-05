-- 军事大亨：共享配置（ReplicatedStorage.Config，服务器和客户端都 require）
-- 数值都在这里调：建筑、兵种、关卡敌军、武器、军衔、重生、每日奖励与任务、突袭与约战
local Config = {}

Config.Version = "0.2"
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
Config.Buildings = {
  { id = "house1", name = "居民楼 A", kind = "house", price = 60, income = 5, x = -95, z = -95, size = { 18, 16, 18 } },
  { id = "barracks", name = "兵营", kind = "mil", units = { "inf" }, price = 300, req = "house1", x = -95, z = 30, size = { 26, 10, 18 } },
  { id = "house2", name = "居民楼 B", kind = "house", price = 300, income = 10, req = "house1", x = -40, z = -95, size = { 18, 22, 18 } },
  { id = "hq", name = "指挥部", kind = "hq", price = 800, req = "barracks", x = -95, z = 100, size = { 30, 14, 24 }, cap = { 10, 18, 30, 40 }, up = { 3000, 15000, 60000 } },
  { id = "factory1", name = "轻工厂", kind = "factory", price = 900, income = 20, req = "house2", x = -95, z = -45, size = { 26, 13, 22 } },
  { id = "tankfac", name = "装甲车厂", kind = "mil", units = { "ifv", "tank" }, price = 2500, req = "factory1", x = -40, z = 30, size = { 36, 18, 30 } },
  { id = "house3", name = "居民楼 C", kind = "house", price = 2000, income = 30, req = "factory1", x = 15, z = -95, size = { 18, 30, 18 } },
  { id = "power", name = "发电厂", kind = "power", price = 4000, req = "factory1", x = 15, z = -45, size = { 22, 20, 22 } },
  { id = "aafac", name = "防空车间", kind = "mil", units = { "aa" }, price = 6000, req = "tankfac", x = 15, z = 30, size = { 30, 14, 24 } },
  { id = "artyfac", name = "炮兵阵地", kind = "mil", units = { "arty", "mlrs" }, price = 9000, req = "tankfac", x = 80, z = 30, size = { 32, 9, 32 } },
  { id = "factory2", name = "重工厂", kind = "factory", price = 12000, income = 60, req = "power", x = -40, z = -45, size = { 28, 16, 24 } },
  { id = "helipad", name = "直升机场", kind = "mil", units = { "heli" }, price = 20000, req = "factory2", x = 85, z = 100, size = { 48, 3, 48 } },
  { id = "factory3", name = "军工联合体", kind = "factory", price = 45000, income = 150, req = "factory2", x = 80, z = -45, size = { 30, 20, 26 } },
  { id = "bank", name = "银行", kind = "bank", price = 120000, income = 350, req = "factory3", x = 80, z = -95, size = { 22, 28, 22 } },
}
Config.PowerBoost = 1.5   -- 有发电厂时工厂收入乘几

-- 军工科技：花钱升级，每级全军（我方）血量、伤害各 +bonus；后期的钱主要花在这里，高关卡靠它
Config.Tech = { base = 2500, growth = 1.5, bonus = 0.1, max = 40 }
function Config.TechCost(level)
  return math.floor(Config.Tech.base * Config.Tech.growth ^ level)
end

-- 兵种：dmg 每发伤害、rate 几秒一发（火箭炮是一轮齐射的间隔）、range 射程、speed 速度（格 / 秒）、size 占地（排阵、推开用）、len 模型长度（格）；
--   air 会飞（alt 飞行高度）；hitsAir 能打飞机；armor 装甲；vsArmor / vsAir / vsInf 打装甲 / 飞机 / 步兵的伤害倍数；
--   splash 溅射半径；minRange 最近射程；salvo 一轮几发；side 侧面朝敌开火（M270 的发射箱朝右）；prefer 优先打的目标（inf / armor / air）；
--   model 用哪个导入模型（没导入就用零件拼的）；needHQ 指挥部几级才能造
-- 克制：坦克克步兵，直升机克坦克，防空车克直升机，步兵人多能打直升机，火炮、火箭炮打扎堆的步兵，步战车什么都能打一点
Config.Units = {
  inf = { name = "步兵班", price = 60, hp = 110, dmg = 10, rate = 0.6, range = 120, speed = 14, size = 8, hitsAir = true,
    vsArmor = 0.2, vsAir = 0.3, vsInf = 1, prefer = "inf", model = "soldier", desc = "便宜，人多能打下直升机；打坦克几乎没用" },
  ifv = { name = "步兵战车", price = 350, hp = 460, dmg = 30, rate = 0.7, range = 170, speed = 26, size = 16, len = 15, armor = true, hitsAir = true,
    vsArmor = 0.45, vsAir = 0.7, vsInf = 1.3, prefer = "inf", model = "ifv", desc = "25 毫米机关炮，打步兵、直升机都行，挡不住坦克" },
  tank = { name = "主战坦克", price = 450, hp = 700, dmg = 90, rate = 2.4, range = 210, speed = 24, size = 22, len = 22, armor = true,
    vsArmor = 1, vsInf = 1.25, splash = 14, prefer = "armor", model = "tank", desc = "又硬又狠，克步兵、克装甲；怕直升机" },
  aa = { name = "防空车", price = 500, hp = 340, dmg = 28, rate = 0.5, range = 280, speed = 26, size = 14, len = 12, armor = true, hitsAir = true,
    vsAir = 3.2, vsArmor = 0.35, vsInf = 0.5, prefer = "air", model = "aa", desc = "加特林高炮，专打直升机；打地面很弱" },
  arty = { name = "自行火炮", price = 650, hp = 280, dmg = 75, rate = 4.5, range = 560, minRange = 100, speed = 18, size = 18, len = 16, armor = true,
    vsArmor = 0.8, vsInf = 1.4, splash = 32, prefer = "inf", model = "arty", desc = "射程很远，炮弹溅射，专打扎堆的步兵；被贴近就危险" },
  mlrs = { name = "火箭炮", price = 1400, hp = 300, dmg = 60, rate = 10, salvo = 6, range = 700, minRange = 150, speed = 18, size = 22, len = 16, armor = true,
    vsArmor = 0.7, vsInf = 1.3, splash = 26, side = true, prefer = "inf", model = "mlrs", needHQ = 2, desc = "一轮六发覆盖一片，射程最远；装填慢、怕近身" },
  heli = { name = "武装直升机", price = 900, hp = 420, dmg = 115, rate = 2.8, range = 300, speed = 50, size = 30, len = 30, air = true, alt = 70,
    vsArmor = 1.45, vsInf = 0.6, prefer = "armor", model = "heli", desc = "又快又狠，专克坦克；只有防空车、步兵、步战车打得到" },
  boss = { name = "猛犸重坦", price = 0, hp = 9000, dmg = 220, rate = 3, range = 260, speed = 14, size = 32, len = 30, armor = true,
    vsArmor = 1.2, vsInf = 1.2, splash = 22, prefer = "armor", model = "tank", boss = true, desc = "每十关的首领：血极厚" },
}
Config.UnitOrder = { "inf", "ifv", "tank", "aa", "arty", "mlrs", "heli" }
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
  local t = { "inf" }
  if level >= 5 then table.insert(t, "ifv") end
  if level >= 6 then table.insert(t, "tank") end
  if level >= 7 then table.insert(t, "arty") end
  if level >= 8 then table.insert(t, "aa") end
  if level >= 9 then table.insert(t, "heli") end
  if level >= 12 then table.insert(t, "mlrs") end
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
