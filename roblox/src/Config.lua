-- 军事大亨：共享配置（ReplicatedStorage.Config，服务器和客户端都 require）
-- 数值都在这里调：建筑（解锁顺序、价格、收入）、兵种（价格、血量、伤害、射程、克制）、关卡敌军
local Config = {}

Config.Version = "0.1"
Config.SaveKey = "MilitaryTycoon_v1"   -- DataStore 名字（改了就是新存档）
Config.StartCash = 300
Config.BaseCap = 4                     -- 没有指挥部时最多几个单位
Config.OfflineHours = 2                -- 离线收益最多算几小时
Config.OfflineRate = 0.2               -- 离线时按在线收入的几成算
Config.PlotCount = 6                   -- 一个服务器几块基地（游戏设置里「最多玩家数」也设成 6）
Config.PlotSpacing = 440               -- 基地之间的间距（X 方向）
Config.BaseSize = 170                  -- 基地边长
-- 战场在基地 +Z 方向；deploy / enemy 是我方部署区、敌军区的 Z 范围（相对基地中心）
Config.Field = { center = 280, width = 220, length = 340, deploy = { 114, 190 }, enemy = { 372, 446 } }
Config.BattleTime = 180                -- 一场最多几秒，到时算没打赢（活着的照样回来）
Config.Tick = 0.05                     -- 战斗推演步长（秒）
Config.MaxEnemy = 40                   -- 敌军最多几个单位；预算再多就加强属性

-- 每块基地的颜色（部队、旗子、部署区都用它）；敌军统一暗红
Config.PlotColors = {
  Color3.fromRGB(52, 120, 220), Color3.fromRGB(70, 170, 80), Color3.fromRGB(230, 140, 40),
  Color3.fromRGB(150, 90, 210), Color3.fromRGB(40, 180, 180), Color3.fromRGB(215, 190, 50),
}
Config.EnemyColor = Color3.fromRGB(150, 50, 45)

-- 建筑：req 是前置（盖好它才出现这个的购买按钮）；x, z 是在基地里的位置；size 是外形 { 宽, 高, 深 }
--   kind：house 居民楼 / factory 工厂 / power 发电厂 / bank 银行 / mil 军工（unit：能生产的兵种）/ hq 指挥部（cap：各级部队上限，up：升级价）
--   基地朝 +Z 是战场；z = 25 那一排是军工，z = 62 是指挥部、直升机场，中间留出部队开出去的通道（x 在 -38 到 30 之间）
Config.Buildings = {
  { id = "house1", name = "居民楼 A", kind = "house", price = 60, income = 5, x = -55, z = -55, size = { 18, 16, 18 } },
  { id = "barracks", name = "兵营", kind = "mil", unit = "inf", price = 300, req = "house1", x = -55, z = 25, size = { 22, 9, 16 } },
  { id = "house2", name = "居民楼 B", kind = "house", price = 300, income = 10, req = "house1", x = -20, z = -55, size = { 18, 22, 18 } },
  { id = "hq", name = "指挥部", kind = "hq", price = 800, req = "barracks", x = -55, z = 62, size = { 26, 12, 20 }, cap = { 10, 18, 30, 40 }, up = { 3000, 15000, 60000 } },
  { id = "factory1", name = "轻工厂", kind = "factory", price = 900, income = 20, req = "house2", x = -55, z = -15, size = { 24, 12, 20 } },
  { id = "tankfac", name = "坦克工厂", kind = "mil", unit = "tank", price = 2500, req = "factory1", x = -20, z = 25, size = { 26, 14, 22 } },
  { id = "house3", name = "居民楼 C", kind = "house", price = 2000, income = 30, req = "factory1", x = 15, z = -55, size = { 18, 30, 18 } },
  { id = "power", name = "发电厂", kind = "power", price = 4000, req = "factory1", x = 15, z = -15, size = { 20, 18, 20 } },
  { id = "aafac", name = "防空车间", kind = "mil", unit = "aa", price = 6000, req = "tankfac", x = 15, z = 25, size = { 22, 12, 18 } },
  { id = "artyfac", name = "炮兵阵地", kind = "mil", unit = "arty", price = 9000, req = "tankfac", x = 50, z = 25, size = { 22, 8, 22 } },
  { id = "factory2", name = "重工厂", kind = "factory", price = 12000, income = 60, req = "power", x = -20, z = -15, size = { 26, 16, 22 } },
  { id = "helipad", name = "直升机场", kind = "mil", unit = "heli", price = 20000, req = "factory2", x = 50, z = 62, size = { 30, 3, 30 } },
  { id = "factory3", name = "军工联合体", kind = "factory", price = 45000, income = 150, req = "factory2", x = 50, z = -15, size = { 26, 20, 24 } },
  { id = "bank", name = "银行", kind = "bank", price = 120000, income = 350, req = "factory3", x = 50, z = -55, size = { 20, 26, 20 } },
}
Config.PowerBoost = 1.5   -- 有发电厂时工厂收入乘几

-- 军工科技：花钱升级，每级全军（我方）血量、伤害各 +bonus；后期的钱主要花在这里，高关卡靠它
Config.Tech = { base = 2500, growth = 1.5, bonus = 0.1, max = 40 }
function Config.TechCost(level)
  return math.floor(Config.Tech.base * Config.Tech.growth ^ level)
end

-- 兵种：dmg 每发伤害、rate 几秒一发、range 射程、speed 速度（格 / 秒）、size 占地；
--   air 会飞（alt 飞行高度）；hitsAir 能打飞机；armor 装甲；vsArmor / vsAir / vsInf 打装甲 / 飞机 / 步兵的伤害倍数；
--   splash 溅射半径；minRange 最近射程；prefer 优先打的目标（inf / armor / air）
-- 克制：坦克克步兵，直升机克坦克，防空车克直升机，步兵人多能打直升机，火炮打扎堆的步兵
Config.Units = {
  inf = { name = "步兵班", price = 60, hp = 110, dmg = 10, rate = 0.6, range = 48, speed = 9, size = 4, hitsAir = true,
    vsArmor = 0.2, vsAir = 0.3, vsInf = 1, prefer = "inf", desc = "便宜，人多能打下直升机；打坦克几乎没用" },
  tank = { name = "主战坦克", price = 450, hp = 700, dmg = 90, rate = 2.4, range = 85, speed = 11, size = 9, armor = true,
    vsArmor = 1, vsInf = 1.25, splash = 6, prefer = "armor", desc = "又硬又狠，克步兵；怕直升机" },
  aa = { name = "防空车", price = 500, hp = 340, dmg = 28, rate = 0.5, range = 115, speed = 12, size = 8, armor = true, hitsAir = true,
    vsAir = 3.2, vsArmor = 0.35, vsInf = 0.5, prefer = "air", desc = "专打直升机；打地面很弱" },
  arty = { name = "自行火炮", price = 650, hp = 280, dmg = 75, rate = 4.5, range = 240, minRange = 40, speed = 8, size = 9, armor = true,
    vsArmor = 0.8, vsInf = 1.4, splash = 14, prefer = "inf", desc = "射程最远，炮弹溅射，专打扎堆的步兵；被贴近就危险" },
  heli = { name = "武装直升机", price = 900, hp = 400, dmg = 115, rate = 2.8, range = 125, speed = 22, size = 10, air = true, alt = 40,
    vsArmor = 1.45, vsInf = 0.6, prefer = "armor", desc = "又快又狠，专克坦克；只有防空车和步兵打得到它" },
}
Config.UnitOrder = { "inf", "tank", "aa", "arty", "heli" }

-- 音效：填 "rbxassetid://数字"（Studio 工具箱 → 音频里搜，复制 ID）；留空就不放
Config.Sounds = { rifle = "", cannon = "", aa = "", rocket = "", boom = "", build = "", buy = "", win = "", lose = "" }

-- 关卡敌军：预算按关卡往上涨，兵种逐渐解锁（同一关的敌军每次都一样，开打前就能看到）
function Config.EnemyBudget(level)
  return math.floor(150 * (1.28 ^ (level - 1)))
end
function Config.EnemyTypes(level)
  local t = { "inf" }
  if level >= 6 then table.insert(t, "tank") end
  if level >= 7 then table.insert(t, "arty") end
  if level >= 8 then table.insert(t, "aa") end
  if level >= 9 then table.insert(t, "heli") end
  return t
end
function Config.Reward(level)
  return math.floor(Config.EnemyBudget(level) * 0.9 + 100 * level)
end

-- 查表：建筑 id → 建筑；兵种 → 生产它的建筑 id
Config.BuildingById = {}
Config.UnitSource = {}
for _, b in ipairs(Config.Buildings) do
  Config.BuildingById[b.id] = b
  if b.unit then Config.UnitSource[b.unit] = b.id end
end

-- 数字加千位分隔：12345 → 12,345
function Config.Fmt(n)
  local s = string.format("%.0f", math.floor(math.abs(n)))
  local out = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
  if out:sub(1, 1) == "," then out = out:sub(2) end
  if n < 0 then out = "-" .. out end
  return out
end

return Config
