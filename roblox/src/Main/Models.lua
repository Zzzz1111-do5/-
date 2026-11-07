-- 军事大亨：模型（地图、竞技场、建筑、购买按钮、兵种、武器、排行榜牌子、血条）
-- 兵种：优先用玩家在 Studio 里「导入 3D」进来的原模型（roblox/models/*.glb，名字 = 槽位：soldier、tank、heli、fighter……和 prop_* 道具），
--   没导入就用零件拼的。模型结构都一样：锚定的隐形 Root（原点在车底中心、正前方 −Z），其余零件焊在 Root 上；
--   炮塔、旋翼、尾桨各挂在一个用 Motor6D 接到 Root 的「毂」上（TurretMotor / RotorMotor / TailMotor），客户端转它们的 Transform。
-- 建筑、地面是锚定的静态零件。
local RS = game:GetService("ReplicatedStorage")
local CollectionService = game:GetService("CollectionService")
local ServerStorage = game:GetService("ServerStorage")
local Config = require(RS:WaitForChild("Config"))

local Models = {}

local V = Vector3.new
local CF = CFrame.new
local RGB = Color3.fromRGB
local MAT = Enum.Material
local CYL = Enum.PartType.Cylinder
local BALL = Enum.PartType.Ball
local UP = CFrame.Angles(0, 0, math.pi / 2)   -- Roblox 圆柱的轴在 X 方向，转 90° 立起来

local C = {
  concrete = RGB(168, 168, 162), asphalt = RGB(52, 54, 58), dark = RGB(38, 40, 44), glass = RGB(66, 104, 134),
  olive = RGB(92, 104, 70), oliveDark = RGB(62, 72, 48), sand = RGB(196, 176, 128), metal = RGB(122, 126, 130),
  track = RGB(36, 36, 38), gun = RGB(46, 48, 50), skin = RGB(230, 188, 150), uniform = RGB(86, 96, 64),
  white = RGB(236, 236, 230), red = RGB(200, 50, 45), yellow = RGB(236, 190, 40), brick = RGB(150, 82, 62),
  roof = RGB(70, 72, 76), green = RGB(70, 220, 100), ground = RGB(124, 108, 78),
}
Models.C = C

local function darker(c, k)
  return c:Lerp(Color3.new(0, 0, 0), k or 0.35)
end

-- 静态零件：base 是整体的位置，off 是相对它的偏移（Shape 要在 Size 之前设，球会被改成等边）
local function block(parent, base, size, off, color, mat, shape)
  local p = Instance.new("Part")
  if shape then p.Shape = shape end
  p.Anchored = true
  p.Size = size
  p.CFrame = base * off
  p.Color = color
  p.Material = mat or MAT.SmoothPlastic
  p.TopSurface = Enum.SurfaceType.Smooth
  p.BottomSurface = Enum.SurfaceType.Smooth
  p.Parent = parent
  return p
end
Models.block = block

-- 竖直圆柱：height 高，dia 直径，off 是圆柱中心
local function cyl(parent, base, height, dia, off, color, mat)
  return block(parent, base, V(height, dia, dia), off * UP, color, mat, CYL)
end

-- 客户端播的小动画：零件属性 Anim = "spin"（绕竖轴转，Spd 每秒几圈）/ "blink"（一闪一闪，Spd 每秒几次）
local function anim(p, kind, spd)
  p:SetAttribute("Anim", kind)
  p:SetAttribute("Spd", spd)
  return p
end

-- 不挡人、不挡射线的装饰零件
local function ghostly(p)
  p.CanCollide = false
  p.CanQuery = false
  p.CanTouch = false
  return p
end

-- 头顶的字（大小按格算，离远了跟着变小）
function Models.sign(part, text, height, w, h, color, maxDist)
  local bb = Instance.new("BillboardGui")
  bb.Size = UDim2.new(w or 16, 0, h or 3, 0)
  bb.StudsOffsetWorldSpace = V(0, height, 0)
  bb.LightInfluence = 0
  bb.MaxDistance = maxDist or 220
  bb.Parent = part
  local t = Instance.new("TextLabel")
  t.Size = UDim2.fromScale(1, 1)
  t.BackgroundTransparency = 1
  t.Font = Enum.Font.GothamBold
  t.TextScaled = true
  t.RichText = true
  t.TextColor3 = color or Color3.new(1, 1, 1)
  t.TextStrokeTransparency = 0.35
  t.Text = text
  t.Parent = bb
  return bb, t
end

---------------------------------------------------------------- 地图

local function tree(f, pos, rng)
  local base = CF(pos)
  local h = rng:NextNumber(7, 12)
  cyl(f, base, h, 1.8, CF(0, h / 2, 0), RGB(108, 80, 56), MAT.Wood)
  local d = rng:NextNumber(10, 16)
  local g = RGB(56 + rng:NextInteger(0, 30), 116 + rng:NextInteger(0, 40), 48)
  block(f, base, V(d, d, d), CF(0, h + d * 0.3, 0), g, MAT.Grass, BALL)
  if rng:NextNumber() < 0.5 then
    local d2 = d * 0.7
    block(f, base, V(d2, d2, d2), CF(d * 0.3, h + d * 0.62, d * 0.15), g:Lerp(RGB(255, 255, 255), 0.06), MAT.Grass, BALL)
  end
end

-- 战场（基地前面的，或者竞技场）：地面、部署区、敌军区、沙袋、弹坑；colorA / colorB 是两边区域的颜色
-- 地上一块区域头顶的大字（总是面朝镜头，远处也看得见）
local function zoneLabel(f, base, at, text, color)
  local a = ghostly(block(f, base, V(1, 1, 1), at, C.white))
  a.Transparency = 1
  local bb = Models.sign(a, text, 0, 60, 7, color, 1400)
  bb.AlwaysOnTop = false
  return bb
end

local function battlefield(f, origin, colorA, colorB, rng, labels)
  local base = CF(origin)
  local Fd = Config.Field
  local D, E = Fd.deploy, Fd.enemy
  local field = block(f, base, V(Fd.width, 1, Fd.length), CF(0, 0.5, Fd.center), C.ground, MAT.Ground)
  field.Name = "Field"
  local dz = ghostly(block(f, base, V(Fd.width - 6, 0.1, D[2] - D[1]), CF(0, 1.06, (D[1] + D[2]) / 2), colorA, MAT.SmoothPlastic))
  dz.Name = "DeployZone"
  dz.Transparency = 0.86
  local ez = ghostly(block(f, base, V(Fd.width - 6, 0.1, E[2] - E[1]), CF(0, 1.06, (E[1] + E[2]) / 2), colorB, MAT.SmoothPlastic))
  ez.Name = "EnemyZone"
  ez.Transparency = 0.88
  -- 两个区的四条边：发光的边框
  for _, zone in ipairs({ { D, colorA }, { E, colorB } }) do
    local z0, z1, col = zone[1][1], zone[1][2], zone[2]
    ghostly(block(f, base, V(Fd.width - 6, 0.12, 0.8), CF(0, 1.08, z0), col, MAT.Neon))
    ghostly(block(f, base, V(Fd.width - 6, 0.12, 0.8), CF(0, 1.08, z1), col, MAT.Neon))
    for _, sx in ipairs({ -1, 1 }) do ghostly(block(f, base, V(0.8, 0.12, z1 - z0), CF(sx * (Fd.width / 2 - 3), 1.08, (z0 + z1) / 2), col, MAT.Neon)) end
  end
  if labels then
    zoneLabel(f, base, CF(0, 16, (D[1] + D[2]) / 2), labels[1], colorA:Lerp(Color3.new(1, 1, 1), 0.45))
    zoneLabel(f, base, CF(0, 16, (E[1] + E[2]) / 2), labels[2], RGB(255, 150, 140))
  end
  local z0, z1 = Fd.center - Fd.length / 2, Fd.center + Fd.length / 2
  block(f, base, V(3, 3, Fd.length), CF(-Fd.width / 2 - 1.5, 2.5, Fd.center), C.sand, MAT.Fabric)
  block(f, base, V(3, 3, Fd.length), CF(Fd.width / 2 + 1.5, 2.5, Fd.center), C.sand, MAT.Fabric)
  block(f, base, V(Fd.width + 6, 3, 3), CF(0, 2.5, z1 + 1.5), C.sand, MAT.Fabric)
  for _ = 1, 14 do   -- 弹坑、石头（只是装饰，不挡部队）
    local d = rng:NextNumber(10, 26)
    ghostly(cyl(f, base, 0.1, d, CF(rng:NextNumber(-200, 200), 1.04, rng:NextNumber(D[2] + 30, E[1] - 30)), RGB(92, 80, 60), MAT.Ground))
  end
  for _ = 1, 10 do
    local d = rng:NextNumber(4, 9)
    local side = (rng:NextNumber() < 0.5) and -1 or 1
    ghostly(block(f, base, V(d, d, d), CF(side * rng:NextNumber(190, 245), 1, rng:NextNumber(z0 + 40, z1 - 40)), RGB(120, 118, 112), MAT.Slate, BALL))
  end
  return field
end

-- 一块基地：地面、围墙、出生点、路、战场、树、头顶的名字、排行榜牌子。返回 { field, sign, board }
function Models.plot(f, origin, color, index)
  local base = CF(origin)
  local B = Config.BaseSize
  local hs = B / 2
  local Fd = Config.Field
  local rng = Random.new(index * 97 + 13)

  local S0 = Config.Spawn
  local slab = block(f, base, V(B, 1, B), CF(0, 0.5, 0), RGB(146, 148, 146), MAT.Concrete)
  slab.Name = "Base"
  -- 中轴大道：出生点往北一直通到横路（出生就能顺着它看到大门、战场）
  ghostly(block(f, base, V(22, 0.08, 60 - 14 - (S0.z - 6)), CF(S0.x, 1.04, (60 - 14 + S0.z - 6) / 2), RGB(92, 94, 96), MAT.Asphalt))
  for k = 0, 9 do ghostly(block(f, base, V(0.6, 0.06, 6), CF(S0.x, 1.09, S0.z + 12 + k * 16), C.white, MAT.SmoothPlastic)) end
  -- 部队开出去的通道（深色）：横穿 z = 60，再从中间往前到路上
  ghostly(block(f, base, V(B - 12, 0.08, 28), CF(0, 1.04, 60), RGB(92, 94, 96), MAT.Asphalt))
  ghostly(block(f, base, V(120, 0.08, hs - 60), CF(-10, 1.04, (hs + 60) / 2), RGB(92, 94, 96), MAT.Asphalt))
  -- 围墙、哨塔、大门在 Scenery.base 里
  -- 出生点
  local S = Config.Spawn
  cyl(f, base, 0.3, 12, CF(S.x, 1.15, S.z), color, MAT.SmoothPlastic)
  cyl(f, base, 0.32, 8, CF(S.x, 1.16, S.z), C.white, MAT.SmoothPlastic)
  -- 路（基地和战场之间）
  local fz0 = Fd.center - Fd.length / 2
  local roadZ, roadL = (hs + fz0) / 2, fz0 - hs
  block(f, base, V(B, 1, roadL), CF(0, 0.5, roadZ), C.asphalt, MAT.Asphalt)
  for k = -8, 8 do
    ghostly(block(f, base, V(8, 0.06, 0.8), CF(k * 15, 1.03, roadZ), C.white, MAT.SmoothPlastic))
  end
  local field = battlefield(f, origin, color, RGB(190, 50, 40), rng, { "我方部署区 · 布阵时把部队摆在这里", "敌军区 · 这一关的敌人在这" })
  -- 路牌：出生点北边，牌面朝出生点（面朝战场站着的时候正好看见）
  do
    local at = CF(S.x + 16, 0, S.z + 16)
    cyl(f, base, 9, 0.5, at * CF(0, 1 + 4.5, 0), C.metal, MAT.Metal)
    local board = block(f, base, V(13, 6.2, 0.4), at * CF(0, 1 + 8.6, 0), RGB(28, 70, 40), MAT.SmoothPlastic)
    board.Name = "Signpost"
    local sg = Instance.new("SurfaceGui")
    sg.Face = Enum.NormalId.Front
    sg.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
    sg.PixelsPerStud = 24
    sg.LightInfluence = 0
    sg.Parent = board
    local t = Instance.new("TextLabel")
    t.Size = UDim2.fromScale(1, 1)
    t.BackgroundTransparency = 1
    t.Font = Enum.Font.GothamBold
    t.TextScaled = true
    t.TextColor3 = C.white
    t.Text = "↑ 战场、部署区（往前走过马路）\n← 空军基地（左边围墙外）\n踩亮绿色的圆按钮盖楼"
    t.Parent = sg
  end
  -- 树林在 Scenery.nature 里（长在基地之间的山丘上）
  -- 头顶的名字
  local anchor = ghostly(block(f, base, V(1, 1, 1), CF(0, 2, -20), C.white))
  anchor.Transparency = 1
  local _, label = Models.sign(anchor, "空基地", 70, 100, 13, color, 1600)
  -- 排行榜牌子（出生点后面的墙上，朝出生点）
  local board = block(f, base, V(54, 22, 1), CF(0, 14, -hs + 2), RGB(36, 42, 52), MAT.SmoothPlastic)
  board.Name = "Board"
  block(f, base, V(57, 1.4, 1.6), CF(0, 25.7, -hs + 2), RGB(60, 64, 70), MAT.Metal)
  block(f, base, V(57, 1.4, 1.6), CF(0, 2.3, -hs + 2), RGB(60, 64, 70), MAT.Metal)
  for _, sx in ipairs({ -1, 1 }) do block(f, base, V(1.6, 25, 1.6), CF(sx * 28, 13.5, -hs + 2), RGB(60, 64, 70), MAT.Metal) end
  ghostly(block(f, base, V(54, 0.4, 0.5), CF(0, 26.6, -hs + 1.6), color, MAT.Neon))
  local sg = Instance.new("SurfaceGui")
  sg.Face = Enum.NormalId.Back
  sg.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
  sg.PixelsPerStud = 20
  sg.LightInfluence = 0
  sg.Parent = board
  local cols = {}
  for i, title in ipairs({ "最高关卡", "突袭积分", "对战积分" }) do
    local col = Instance.new("TextLabel")
    col.Name = "Col" .. i
    col.BackgroundTransparency = 1
    col.Position = UDim2.fromScale((i - 1) / 3, 0)
    col.Size = UDim2.fromScale(1 / 3, 1)
    col.Font = Enum.Font.GothamBold
    col.TextScaled = true
    col.TextColor3 = C.white
    col.TextYAlignment = Enum.TextYAlignment.Top
    col.Text = title .. "\n（读取中）"
    col.Parent = sg
    cols[i] = col
  end
  return { field = field, sign = label, board = cols }
end

-- 约战竞技场：只有战场，南北两边的出发区，看台边上一圈旗子
function Models.arena(f, origin, index)
  local rng = Random.new(index * 53 + 991)
  local field = battlefield(f, origin, RGB(60, 140, 230), RGB(230, 70, 60), rng, { "挑战方出发区", "应战方出发区" })
  local Fd = Config.Field
  local base = CF(origin)
  local anchor = ghostly(block(f, base, V(1, 1, 1), CF(0, 2, Fd.center), C.white))
  anchor.Transparency = 1
  Models.sign(anchor, "约战竞技场 " .. index, 90, 120, 15, RGB(255, 220, 120), 2400)
  for k = -4, 4 do
    local z = Fd.center + k * Fd.length / 9
    for _, sx in ipairs({ -1, 1 }) do
      cyl(f, base, 18, 0.5, CF(sx * (Fd.width / 2 + 8), 9, z), C.metal, MAT.Metal)
      block(f, base, V(0.2, 3.5, 6), CF(sx * (Fd.width / 2 + 8), 16, z + 3), (k % 2 == 0) and RGB(60, 140, 230) or RGB(230, 70, 60), MAT.Fabric)
    end
  end
  return { field = field }
end

---------------------------------------------------------------- 建筑

-- 军工建筑能造什么（牌子上写；太多就写前两个加「等 N 种」）
function Models.milDesc(b)
  local names = {}
  for i, u in ipairs(b.units) do
    if i <= 2 then table.insert(names, Config.Units[u].name) end
  end
  local s = "生产" .. table.concat(names, "、")
  if #b.units > 2 then s = s .. "等 " .. #b.units .. " 种" end
  return s
end

local HOUSE = { house1 = RGB(226, 212, 186), house2 = RGB(186, 206, 222), house3 = RGB(222, 192, 180) }

local function slabUnder(m, base, w, d, color, mat)
  block(m, base, V(w + 3, 0.6, d + 3), CF(0, 0.3, 0), color or C.concrete, mat or MAT.Concrete)
end

-- 楼面上的招牌：一块板子 + 发光的字（face 是板子哪一面朝外）
local function facadeSign(m, base, cf, w, h, text, color, face)
  local board = block(m, base, V(w, h, 0.3), cf, RGB(28, 32, 38), MAT.SmoothPlastic)
  board.CastShadow = false
  local sg = Instance.new("SurfaceGui")
  sg.Face = face or Enum.NormalId.Front
  sg.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
  sg.PixelsPerStud = 30
  sg.LightInfluence = 0
  sg.Parent = board
  local t = Instance.new("TextLabel")
  t.Size = UDim2.fromScale(1, 1)
  t.BackgroundTransparency = 1
  t.Font = Enum.Font.GothamBlack
  t.TextScaled = true
  t.TextColor3 = color or RGB(255, 214, 90)
  t.Text = text
  t.Parent = sg
  return board
end
-- 屋顶的空调外机、通风口
local function roofStuff(m, base, w, d, y, n)
  for i = 1, n do
    local x = (i - (n + 1) / 2) * (w / (n + 1)) + ((i % 2 == 0) and 1.2 or -1.2)
    local z = ((i % 2 == 0) and 1 or -1) * d * 0.22
    block(m, base, V(2.4, 1.4, 1.8), CF(x, y + 0.7, z), RGB(190, 192, 190), MAT.Metal)
    ghostly(cyl(m, base, 0.1, 1.2, CF(x, y + 1.42, z), RGB(60, 60, 62), MAT.Metal))
  end
end

local function flag(m, base, at, color)
  cyl(m, base, 18, 0.4, at * CF(0, 0.6 + 9, 0), C.metal, MAT.Metal)
  block(m, base, V(0.15, 3, 5), at * CF(0, 0.6 + 16.4, 2.6), color, MAT.Fabric)
end

local function house(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  slabUnder(m, base, w, d)
  local body = block(m, base, V(w, h, d), CF(0, 0.6 + h / 2, 0), HOUSE[b.id] or C.white, MAT.SmoothPlastic)
  for k = 1, math.floor(h / 4) do   -- 每层一圈窗户带
    local y = 0.6 + (k - 1) * 4 + 2.4
    if y + 1 < 0.6 + h then block(m, base, V(w + 0.3, 1.4, d + 0.3), CF(0, y, 0), C.glass, MAT.Glass) end
  end
  block(m, base, V(w + 0.8, 0.7, d + 0.8), CF(0, 0.6 + h + 0.35, 0), C.roof, MAT.Concrete)
  block(m, base, V(w * 0.3, 1.8, d * 0.3), CF(w * 0.2, 0.6 + h + 1.6, d * 0.15), C.metal, MAT.Metal)
  block(m, base, V(3.2, 4.4, 0.6), CF(0, 0.6 + 2.2, -d / 2 - 0.2), C.dark)
  block(m, base, V(w * 0.5, 0.4, 2.4), CF(0, 0.6 + 4.7, -d / 2 - 1.2), C.roof)
  for k = 1, math.floor(h / 4) - 1 do   -- 东边一层一个阳台
    local y = 0.6 + k * 4
    block(m, base, V(2.2, 0.35, d * 0.5), CF(w / 2 + 1.1, y, 0), RGB(200, 200, 196), MAT.Concrete)
    local rail = block(m, base, V(0.2, 1.1, d * 0.5), CF(w / 2 + 2.1, y + 0.7, 0), RGB(150, 190, 210), MAT.Glass)
    rail.Transparency = 0.4
  end
  for _, sx in ipairs({ -1, 1 }) do   -- 四角的竖线条
    for _, sz in ipairs({ -1, 1 }) do block(m, base, V(0.8, h, 0.8), CF(sx * (w / 2 + 0.1), 0.6 + h / 2, sz * (d / 2 + 0.1)), (HOUSE[b.id] or C.white):Lerp(C.dark, 0.25), MAT.SmoothPlastic) end
  end
  local roofY = 0.6 + h + 0.7
  for _, sx in ipairs({ -1, 1 }) do   -- 屋顶水箱（四条腿）
    for _, sz in ipairs({ -1, 1 }) do block(m, base, V(0.3, 2.2, 0.3), CF(-w * 0.22 + sx * 1.3, roofY + 1.1, -d * 0.18 + sz * 1.3), C.metal, MAT.Metal) end
  end
  cyl(m, base, 3, 3.6, CF(-w * 0.22, roofY + 3.7, -d * 0.18), RGB(120, 128, 132), MAT.Metal)
  roofStuff(m, base, w, d, roofY, 2)
  cyl(m, base, 6, 0.2, CF(w * 0.3, roofY + 3, -d * 0.3), C.metal, MAT.Metal)
  block(m, base, V(5, 0.5, 1.6), CF(0, 0.85, -d / 2 - 2.6), RGB(170, 170, 166), MAT.Concrete)
  for _, sx in ipairs({ -1, 1 }) do
    block(m, base, V(2.2, 1, 2.2), CF(sx * 3.6, 1.1, -d / 2 - 1.6), RGB(130, 110, 90), MAT.Brick)
    ghostly(block(m, base, V(1.8, 1.4, 1.8), CF(sx * 3.6, 2, -d / 2 - 1.6), RGB(70, 130, 60), MAT.Grass, BALL))
  end
  return body
end

local function factory(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local hh = h * 0.62
  slabUnder(m, base, w, d)
  local body = block(m, base, V(w, hh, d), CF(0, 0.6 + hh / 2, 0), C.brick, MAT.Brick)
  block(m, base, V(w + 0.6, 0.6, d + 0.6), CF(0, 0.6 + hh + 0.3, 0), C.roof, MAT.Metal)
  for _, s in ipairs({ -1, 1 }) do
    block(m, base, V(w * 0.8, 1.6, 2.4), CF(0, 0.6 + hh + 1.4, s * d * 0.22), C.glass, MAT.Glass)
  end
  block(m, base, V(w * 0.38, hh * 0.62, 0.6), CF(-w * 0.15, 0.6 + hh * 0.31, -d / 2 - 0.15), C.dark, MAT.DiamondPlate)
  local n = (b.id == "factory3") and 2 or 1
  for k = 1, n do   -- 烟囱冒烟
    local cx = w / 2 - 3 - (k - 1) * 5
    local top = h + 4
    cyl(m, base, top, 2.6, CF(cx, 0.6 + top / 2, d / 2 - 3), C.brick, MAT.Brick)
    local tip = ghostly(block(m, base, V(1.5, 1, 1.5), CF(cx, 0.6 + top + 0.6, d / 2 - 3), C.dark))
    tip.Transparency = 1
    local s = Instance.new("Smoke")
    s.Color = RGB(96, 96, 98)
    s.Opacity = 0.22
    s.RiseVelocity = 6
    s.Size = 3
    s.Parent = tip
  end
  block(m, base, V(3, 3, 3), CF(-w / 2 + 2, 0.6 + 1.5, -d / 2 - 3), C.olive, MAT.WoodPlanks)
  for k = 0, 3 do   -- 卷帘门上方的黄黑警示条
    block(m, base, V(w * 0.38 / 4, 0.5, 0.3), CF(-w * 0.15 - w * 0.19 + (k + 0.5) * w * 0.095, 0.6 + hh * 0.62 + 0.3, -d / 2 - 0.5), (k % 2 == 0) and C.yellow or C.dark)
  end
  for _, y in ipairs({ hh * 0.55, hh * 0.75 }) do   -- 东墙上的两根管道
    cyl(m, base, d * 0.9, 0.7, CF(w / 2 + 0.5, 0.6 + y, 0) * CFrame.Angles(math.pi / 2, 0, 0), RGB(150, 152, 150), MAT.Metal)
  end
  block(m, base, V(w * 0.3, 1.2, 4), CF(w * 0.25, 0.6 + 0.6, -d / 2 - 2), RGB(120, 120, 116), MAT.Concrete)   -- 装卸台
  for i = 1, 3 do block(m, base, V(1.8, 1.6, 1.8), CF(w * 0.25 + (i - 2) * 2.1, 0.6 + 2.0, -d / 2 - 1.8), RGB(150, 116, 74), MAT.WoodPlanks) end
  roofStuff(m, base, w, d, 0.6 + hh + 0.6, 3)
  facadeSign(m, base, CF(-w * 0.15, 0.6 + hh * 0.82, -d / 2 - 0.35), w * 0.36, 1.6, b.name, RGB(255, 214, 90))
  return body
end

local function power(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  slabUnder(m, base, w, d)
  local tx = -w / 2 + 6.5
  local body = cyl(m, base, h, 12, CF(tx, 0.6 + h / 2, 0), RGB(205, 205, 200), MAT.Concrete)   -- 冷却塔
  cyl(m, base, 1, 12.6, CF(tx, 0.6 + h - 0.5, 0), RGB(176, 176, 172), MAT.Concrete)
  local tip = ghostly(block(m, base, V(6, 1, 6), CF(tx, 0.6 + h + 1, 0), C.white))
  tip.Transparency = 1
  local s = Instance.new("Smoke")
  s.Color = RGB(240, 240, 240)
  s.Opacity = 0.3
  s.RiseVelocity = 8
  s.Size = 6
  s.Parent = tip
  block(m, base, V(8, 8, d - 2), CF(w / 2 - 4.5, 0.6 + 4, 0), RGB(110, 120, 130), MAT.Metal)
  for k = -1, 1 do block(m, base, V(2, 2.4, 2), CF(w / 2 - 4.5, 0.6 + 9.2, k * 4), C.yellow, MAT.Metal) end
  anim(block(m, base, V(0.8, 0.8, 0.8), CF(w / 2 - 4.5, 0.6 + 11, 0), RGB(255, 220, 90), MAT.Neon), "blink", 2)
  for _, sz in ipairs({ -1, 1 }) do   -- 变电站围栏
    block(m, base, V(10, 2.4, 0.15), CF(w / 2 - 4.5, 0.6 + 1.2, sz * (d / 2 - 0.5)), RGB(120, 124, 126), MAT.DiamondPlate)
  end
  for _, px in ipairs({ -w / 2 - 6, w / 2 + 6 }) do   -- 高压电塔（两根斜腿 + 横担）
    local c = CF(px, 0, -d / 2 - 4)
    for _, s2 in ipairs({ -1, 1 }) do block(m, base, V(0.5, 20, 0.5), c * CF(s2 * 1.6, 0.6 + 10, 0) * CFrame.Angles(0, 0, s2 * -0.08), RGB(150, 150, 154), MAT.Metal) end
    block(m, base, V(8, 0.5, 0.5), c * CF(0, 0.6 + 18, 0), RGB(150, 150, 154), MAT.Metal)
    block(m, base, V(5, 0.4, 0.4), c * CF(0, 0.6 + 14, 0), RGB(150, 150, 154), MAT.Metal)
  end
  for _, dz in ipairs({ -0.4, 0, 0.4 }) do   -- 电线
    ghostly(block(m, base, V(w + 12, 0.1, 0.1), CF(0, 0.6 + 17.8, -d / 2 - 4 + dz), RGB(40, 40, 40), MAT.Metal))
  end
  facadeSign(m, base, CF(w / 2 - 4.5, 0.6 + 5, -d / 2 + 0.85), 7, 1.4, "发电厂", RGB(255, 230, 120))
  return body
end

local function bank(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  block(m, base, V(w + 3, 1.2, d + 3), CF(0, 0.6, 0), RGB(220, 218, 210), MAT.Marble)
  local hb = h * 0.72
  local body = block(m, base, V(w - 2, hb, d - 5), CF(0, 1.2 + hb / 2, 2), RGB(236, 233, 224), MAT.Marble)
  for k = 0, 3 do
    cyl(m, base, hb, 1.6, CF(-w / 2 + 2.5 + k * (w - 5) / 3, 1.2 + hb / 2, -d / 2 + 2), RGB(242, 240, 232), MAT.Marble)
  end
  block(m, base, V(w, 2.4, d), CF(0, 1.2 + hb + 1.2, 0), RGB(225, 222, 212), MAT.Marble)
  block(m, base, V(w * 0.6, 3, d * 0.6), CF(0, 1.2 + hb + 3.9, 0), RGB(212, 175, 55), MAT.Metal)
  block(m, base, V(4, 6, 0.5), CF(0, 1.2 + 3, -d / 2 + 4.6), C.dark)
  for k = 0, 2 do block(m, base, V(w * 0.6 - k * 1.2, 0.4, 1.4), CF(0, 0.2 + k * 0.4, -d / 2 - 1.8 + k * 0.7), RGB(226, 224, 216), MAT.Marble) end
  facadeSign(m, base, CF(0, 1.2 + hb + 1.2, -d / 2 - 0.2), w * 0.55, 2, "银  行", RGB(255, 210, 90))
  return body
end

-- 兵营里、操场上的小人（不挡人、不挡射线）：cf 是脚底中心，面朝 −Z；pose = stand 站 / sit 坐（cf 在椅子前沿的地面上）/
--   lie 躺（cf 是床面中心，头朝 −Z）/ plank 俯卧撑（脚在 cf，头朝 −Z）。nod 给了的话，整个人绕脚尖一起点头（客户端 Anim = "nod"）
local function figure(m, base, cf, pose, nod)
  local U, P, S, H = C.uniform, darker(C.uniform, 0.25), C.skin, C.oliveDark
  local parts = {}
  local function add(size, off, color)
    local p = ghostly(block(m, base, size, cf * off, color, MAT.SmoothPlastic))
    table.insert(parts, p)
    return p
  end
  if pose == "stand" then
    add(V(1.0, 2.1, 0.6), CF(0, 1.05, 0), P)
    add(V(1.3, 1.8, 0.75), CF(0, 3.0, 0), U)
    add(V(0.4, 1.7, 0.45), CF(-0.86, 2.95, 0), U)
    add(V(0.4, 1.7, 0.45), CF(0.86, 2.95, 0), U)
    add(V(0.8, 0.8, 0.8), CF(0, 4.3, 0), S)
    add(V(1.0, 0.4, 1.0), CF(0, 4.8, 0), H)
  elseif pose == "sit" then
    add(V(1.0, 1.9, 0.5), CF(0, 0.95, -0.25), P)          -- 小腿
    add(V(1.0, 0.5, 1.7), CF(0, 2.05, 0.6), P)            -- 大腿（坐在 1.8 高的椅面上）
    add(V(1.3, 1.8, 0.75), CF(0, 3.2, 1.3), U)
    add(V(0.4, 0.45, 1.5), CF(-0.86, 3.05, 0.6), U)       -- 胳膊往前搭在桌上
    add(V(0.4, 0.45, 1.5), CF(0.86, 3.05, 0.6), U)
    add(V(0.8, 0.8, 0.8), CF(0, 4.5, 1.25), S)
    add(V(1.0, 0.36, 1.0), CF(0, 4.98, 1.25), H)
  elseif pose == "lie" then
    add(V(1.0, 0.6, 2.2), CF(0, 0.3, 1.1), P)
    add(V(1.3, 0.75, 1.8), CF(0, 0.38, -0.9), U)
    add(V(0.8, 0.8, 0.8), CF(0, 0.42, -2.3), S)
  elseif pose == "plank" then
    local a = math.rad(17)
    local ax = CF(0, 0.35, 0) * CFrame.Angles(a, 0, 0)    -- 身子从脚尖斜着往前上方
    add(V(1.0, 0.6, 2.3), ax * CF(0, 0, -1.15), P)
    add(V(1.3, 0.75, 1.9), ax * CF(0, 0, -3.2), U)
    add(V(0.8, 0.8, 0.8), ax * CF(0, 0.1, -4.6), S)
    local sh = (ax * CF(0, 0, -3.9)).Position
    add(V(0.4, sh.Y, 0.45), CF(-0.86, sh.Y / 2, sh.Z), U)
    add(V(0.4, sh.Y, 0.45), CF(0.86, sh.Y / 2, sh.Z), U)
  end
  if nod then
    local w = base * cf
    for _, p in ipairs(parts) do
      p:SetAttribute("Anim", "nod")
      p:SetAttribute("Piv", (w * CF(0, 0.3, 0)).Position)
      p:SetAttribute("Ax", w.RightVector)
      p:SetAttribute("Amp", nod.amp or 6)
      p:SetAttribute("Spd", nod.spd or 0.6)
      p:SetAttribute("Ph", nod.ph or 0)
    end
  end
  return parts
end

-- 一面墙：沿 X（along = "x"）或 Z 的一段，中心 (cx, cz)、长 L、厚 T；底下一段实墙（门洞挖掉）、中间一圈高窗（窗洞装玻璃、窗台）、顶上一段实墙
--   holes：门洞在这面墙上的区间（沿墙方向的坐标）；wins：窗户中心位置（沿墙方向）；y0 地面高、h 墙高；out = 墙外侧的法线方向（±1）
local function wallRun(m, base, along, cx, cz, L, T, y0, h, holes, wins, out, color)
  local yA, yB = y0 + 7.0, y0 + 10.0   -- 下段顶、窗带顶
  local function seg(a, b, ylo, yhi, col, mat)
    if b - a < 0.05 then return end
    local c = (a + b) / 2
    local size = (along == "x") and V(b - a, yhi - ylo, T) or V(T, yhi - ylo, b - a)
    local off = (along == "x") and CF(cx + c, (ylo + yhi) / 2, cz) or CF(cx, (ylo + yhi) / 2, cz + c)
    return block(m, base, size, off, col or color, mat or MAT.Concrete)
  end
  local function solids(a, b, cut)
    local out2, x = {}, a
    table.sort(cut, function(p, q) return p[1] < q[1] end)
    for _, hseg in ipairs(cut) do
      if hseg[1] > x then table.insert(out2, { x, hseg[1] }) end
      x = math.max(x, hseg[2])
    end
    if x < b then table.insert(out2, { x, b }) end
    return out2
  end
  for _, s in ipairs(solids(-L / 2, L / 2, holes or {})) do seg(s[1], s[2], y0, yA) end
  local wcut = {}
  for _, wx in ipairs(wins or {}) do table.insert(wcut, { wx - 1.9, wx + 1.9 }) end
  for _, s in ipairs(solids(-L / 2, L / 2, wcut)) do seg(s[1], s[2], yA, yB) end
  seg(-L / 2, L / 2, yB, y0 + h)
  for _, wx in ipairs(wins or {}) do
    local g = seg(wx - 1.9, wx + 1.9, yA, yB, C.glass, MAT.Glass)
    g.Size = (along == "x") and V(3.8, 3.0, 0.2) or V(0.2, 3.0, 3.8)
    g.Transparency = 0.45
    local sill = (along == "x") and V(4.4, 0.3, T + 0.8) or V(T + 0.8, 0.3, 4.4)
    local so = (along == "x") and CF(cx + wx, yA - 0.15, cz + out * 0.2) or CF(cx + out * 0.2, yA - 0.15, cz + wx)
    block(m, base, sill, so, RGB(196, 196, 186), MAT.Concrete)
  end
end

-- 兵营：能走进去。前面（+Z）正中一扇门，四面高窗；左边宿舍（双层床、床头箱、储物柜、有人在睡觉），右边作战室（作战桌和地图、椅子、
--   枪架、公告栏、电台、饮水机）；天花板三条日光灯；门口操场上一排人做俯卧撑、教官看着，旁边单杠和轮胎
local function barracks(m, base, b, team)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local T, y0 = 0.8, 0.6
  local WALL, INNER, DADO = RGB(116, 126, 96), RGB(212, 208, 190), RGB(94, 106, 78)
  local METAL, WOOD = RGB(70, 82, 64), RGB(132, 98, 64)
  slabUnder(m, base, w, d)
  -- 主体：看不见、不挡人的整块（挂牌子、提示、升起动画的脚手架用它的大小）
  local body = ghostly(block(m, base, V(w, h, d), CF(0, y0 + h / 2, 0), WALL, MAT.Concrete))
  body.Transparency = 1
  body.CastShadow = false
  -- 墙、门洞、窗、屋顶
  local ix, iz = w / 2 - T, d / 2 - T   -- 屋里的半宽、半深
  wallRun(m, base, "x", 0, -d / 2 + T / 2, w, T, y0, h, nil, { -11, -4, 4, 11 }, -1, WALL)
  wallRun(m, base, "x", 0, d / 2 - T / 2, w, T, y0, h, { { -2.6, 2.6 } }, { -10, 10 }, 1, WALL)
  wallRun(m, base, "z", -w / 2 + T / 2, 0, d - 2 * T, T, y0, h, nil, { -5, 5 }, -1, WALL)
  wallRun(m, base, "z", w / 2 - T / 2, 0, d - 2 * T, T, y0, h, nil, { -5, 5 }, 1, WALL)
  block(m, base, V(w + 1.2, 0.8, d + 1.2), CF(0, y0 + h + 0.4, 0), C.oliveDark, MAT.Concrete)
  roofStuff(m, base, w, d, y0 + h + 0.8, 3)
  -- 屋里墙面：下半截墙裙、上半截浅色（门洞那段不贴）
  local function clad(along, cx, cz, a, bb)
    for _, band in ipairs({ { y0, y0 + 3.2, DADO }, { y0 + 3.2, y0 + 7.0, INNER } }) do
      local len, c = bb - a, (a + bb) / 2
      local size = (along == "x") and V(len, band[2] - band[1], 0.1) or V(0.1, band[2] - band[1], len)
      local off = (along == "x") and CF(c, (band[1] + band[2]) / 2, cz) or CF(cx, (band[1] + band[2]) / 2, c)
      ghostly(block(m, base, size, off, band[3], MAT.SmoothPlastic))
    end
  end
  clad("x", 0, -iz - 0.05 + 0.1, -ix, ix)
  clad("x", 0, iz - 0.05, -ix, -2.6)
  clad("x", 0, iz - 0.05, 2.6, ix)
  clad("z", -ix + 0.05, 0, -iz, iz)
  clad("z", ix - 0.05, 0, -iz, iz)
  -- 地面：水磨石地、中间一条走道地胶
  ghostly(block(m, base, V(2 * ix, 0.08, 2 * iz), CF(0, y0 + 0.04, 0), RGB(156, 152, 140), MAT.Slate))
  ghostly(block(m, base, V(2 * ix - 2, 0.06, 3.2), CF(0, y0 + 0.1, 0), RGB(64, 84, 62), MAT.Fabric))
  -- 门：门框、开着的门板、门口台阶、门上的灯
  block(m, base, V(0.5, 7.2, T + 0.4), CF(-2.85, y0 + 3.6, d / 2 - T / 2), C.dark, MAT.Metal)
  block(m, base, V(0.5, 7.2, T + 0.4), CF(2.85, y0 + 3.6, d / 2 - T / 2), C.dark, MAT.Metal)
  block(m, base, V(6.2, 0.5, T + 0.4), CF(0, y0 + 7.25, d / 2 - T / 2), C.dark, MAT.Metal)
  ghostly(block(m, base, V(2.6, 6.9, 0.25), CF(-2.6, y0 + 3.45, d / 2 + 0.1) * CFrame.Angles(0, math.rad(-80), 0) * CF(1.3, 0, 0), METAL, MAT.Metal))
  ghostly(block(m, base, V(2.6, 6.9, 0.25), CF(2.6, y0 + 3.45, d / 2 + 0.1) * CFrame.Angles(0, math.rad(80), 0) * CF(-1.3, 0, 0), METAL, MAT.Metal))
  block(m, base, V(7, 0.3, 2.2), CF(0, y0 + 0.15, d / 2 + 1.1), RGB(150, 150, 142), MAT.Concrete)
  local lampO = ghostly(block(m, base, V(1.6, 0.5, 0.6), CF(0, y0 + 8.1, d / 2 + 0.3), RGB(255, 240, 200), MAT.Neon))
  local pl0 = Instance.new("PointLight")
  pl0.Range, pl0.Brightness, pl0.Color = 14, 0.9, RGB(255, 226, 170)
  pl0.Parent = lampO
  -- 天花板日光灯（三条，带灯光）
  for _, lx in ipairs({ -9.5, 0, 9.5 }) do
    block(m, base, V(6.4, 0.25, 1.1), CF(lx, y0 + h - 0.35, 0), RGB(200, 200, 196), MAT.Metal)
    local tube = ghostly(block(m, base, V(6, 0.18, 0.7), CF(lx, y0 + h - 0.55, 0), RGB(250, 248, 236), MAT.Neon))
    local pl = Instance.new("PointLight")
    pl.Range, pl.Brightness, pl.Color, pl.Shadows = 22, 1.25, RGB(255, 246, 228), false
    pl.Parent = tube
  end

  ---------------- 左边宿舍
  -- 双层床：四根柱子、上下两层床板和床垫、枕头、叠好的军被；爬梯在床尾
  local function bunk(x, z, headSign)   -- headSign：床头朝 −Z（-1）还是 +Z（+1）
    local L = 7.2
    for _, ox in ipairs({ -1.6, 1.6 }) do
      for _, oz in ipairs({ -L / 2 + 0.15, L / 2 - 0.15 }) do block(m, base, V(0.25, 6.6, 0.25), CF(x + ox, y0 + 3.3, z + oz), METAL, MAT.Metal) end
    end
    for _, ly in ipairs({ 1.5, 4.7 }) do
      block(m, base, V(3.4, 0.3, L), CF(x, y0 + ly, z), METAL, MAT.Metal)
      ghostly(block(m, base, V(3.0, 0.5, L - 0.4), CF(x, y0 + ly + 0.4, z), RGB(214, 210, 196), MAT.Fabric))
      ghostly(block(m, base, V(2.2, 0.35, 1.0), CF(x, y0 + ly + 0.82, z + headSign * (L / 2 - 0.9)), RGB(236, 236, 230), MAT.Fabric))
      ghostly(block(m, base, V(2.6, 0.32, 1.6), CF(x, y0 + ly + 0.8, z - headSign * (L / 2 - 1.3)), RGB(84, 98, 66), MAT.Fabric))   -- 叠成豆腐块的被子
    end
    local fz = z - headSign * (L / 2 - 0.05)
    for _, ox in ipairs({ 0.6, 1.4 }) do ghostly(block(m, base, V(0.14, 4.6, 0.14), CF(x + ox, y0 + 2.9, fz - headSign * 0.12), METAL, MAT.Metal)) end
    for _, ly in ipairs({ 2.6, 3.6 }) do ghostly(block(m, base, V(0.95, 0.12, 0.14), CF(x + 1.0, y0 + ly, fz - headSign * 0.12), METAL, MAT.Metal)) end
    -- 床尾的床头箱
    block(m, base, V(2.6, 1.3, 1.2), CF(x, y0 + 0.65, z - headSign * (L / 2 + 0.75)), RGB(70, 80, 56), MAT.WoodPlanks)
  end
  local bz = -iz + 3.7
  for i, bx in ipairs({ -12.4, -8.0, -3.6 }) do
    bunk(bx, bz, -1)
    if i == 2 then ghostly(block(m, base, V(1.0, 0.5, 1.1), CF(bx, y0 + 1.55, bz + 3.6 + 0.75), C.oliveDark, MAT.SmoothPlastic)) end   -- 箱子上的头盔
  end
  for _, bx in ipairs({ -12.4, -8.0 }) do bunk(bx, iz - 3.7, 1) end
  figure(m, base, CF(-8.0, y0 + 2.15, bz), "lie")   -- 下铺有人在睡觉
  -- 储物柜：左墙，一排三个（门缝、通风口、把手）
  for k, lz in ipairs({ -1.95, 0, 1.95 }) do
    local lx = -ix + 0.75
    block(m, base, V(1.5, 6.4, 1.9), CF(lx, y0 + 3.2, lz), RGB(104, 116, 92), MAT.Metal)
    for v = 0, 2 do ghostly(block(m, base, V(0.06, 0.12, 1.2), CF(lx + 0.76, y0 + 5.6 + v * 0.3, lz), C.dark, MAT.Metal)) end
    ghostly(block(m, base, V(0.1, 0.7, 0.14), CF(lx + 0.78, y0 + 3.4, lz + 0.6), RGB(200, 200, 196), MAT.Metal))
    if k < 3 then ghostly(block(m, base, V(0.06, 6.2, 0.08), CF(lx + 0.76, y0 + 3.2, lz + 0.97), C.dark, MAT.Metal)) end
  end
  figure(m, base, CF(-11.2, y0, 0) * CFrame.Angles(0, math.rad(90), 0), "stand")   -- 在储物柜前

  ---------------- 右边作战室
  -- 作战桌：桌面上一张地图（SurfaceGui 画的：地块、河、路、红蓝两方的标记和箭头）、四把椅子
  local tx, tz = 8.0, -4.6
  block(m, base, V(6.4, 0.3, 4.0), CF(tx, y0 + 3.0, tz), WOOD, MAT.Wood)
  for _, o in ipairs({ { -2.9, -1.7 }, { 2.9, -1.7 }, { -2.9, 1.7 }, { 2.9, 1.7 } }) do block(m, base, V(0.3, 2.85, 0.3), CF(tx + o[1], y0 + 1.43, tz + o[2]), RGB(70, 60, 48), MAT.Wood) end
  local map = ghostly(block(m, base, V(5.6, 0.06, 3.4), CF(tx, y0 + 3.18, tz), RGB(120, 140, 96), MAT.SmoothPlastic))
  do
    local sg = Instance.new("SurfaceGui")
    sg.Face = Enum.NormalId.Top
    sg.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
    sg.PixelsPerStud = 40
    sg.LightInfluence = 1
    sg.Parent = map
    local function fr(x, y, ww, hh, col, rot)
      local f = Instance.new("Frame")
      f.Position = UDim2.fromScale(x, y)
      f.Size = UDim2.fromScale(ww, hh)
      f.AnchorPoint = Vector2.new(0.5, 0.5)
      f.BackgroundColor3 = col
      f.BorderSizePixel = 0
      f.Rotation = rot or 0
      f.Parent = sg
      return f
    end
    fr(0.5, 0.5, 1, 1, RGB(206, 196, 160))
    fr(0.25, 0.35, 0.4, 0.45, RGB(150, 172, 112))
    fr(0.75, 0.62, 0.38, 0.5, RGB(162, 182, 120))
    fr(0.5, 0.5, 1.1, 0.07, RGB(80, 130, 190), 12)        -- 河
    fr(0.45, 0.5, 0.05, 1.1, RGB(120, 100, 80))           -- 路
    for _, e in ipairs({ { 0.2, 0.75, RGB(60, 110, 210) }, { 0.32, 0.8, RGB(60, 110, 210) }, { 0.7, 0.22, RGB(210, 50, 45) }, { 0.82, 0.3, RGB(210, 50, 45) }, { 0.6, 0.15, RGB(210, 50, 45) } }) do
      fr(e[1], e[2], 0.07, 0.11, e[3])
    end
    fr(0.4, 0.52, 0.32, 0.03, RGB(60, 110, 210), -35)     -- 进攻箭头
    local t = Instance.new("TextLabel")
    t.BackgroundTransparency = 1
    t.Position = UDim2.fromScale(0.02, 0.02)
    t.Size = UDim2.fromScale(0.5, 0.14)
    t.Font = Enum.Font.GothamBold
    t.TextScaled = true
    t.TextXAlignment = Enum.TextXAlignment.Left
    t.TextColor3 = RGB(60, 50, 40)
    t.Text = "作战地图"
    t.Parent = sg
  end
  local function chair(x, z, yaw)
    local c = CF(x, 0, z) * CFrame.Angles(0, yaw, 0)
    block(m, base, V(1.2, 1.6, 1.2), c * CF(0, y0 + 0.8, 0), C.dark, MAT.Metal)
    block(m, base, V(1.6, 0.25, 1.6), c * CF(0, y0 + 1.75, 0), RGB(60, 70, 52), MAT.Fabric)
    block(m, base, V(1.6, 1.9, 0.22), c * CF(0, y0 + 2.8, 0.75), RGB(60, 70, 52), MAT.Fabric)
  end
  chair(tx - 1.6, tz + 3.0, 0)
  chair(tx + 1.6, tz + 3.0, 0)
  chair(tx - 1.6, tz - 3.0, math.pi)
  chair(tx + 4.6, tz, math.rad(90))
  figure(m, base, CF(tx - 1.6, y0, tz + 2.2), "sit")                                   -- 坐着看地图
  figure(m, base, CF(tx + 1.6, y0, tz - 2.9) * CFrame.Angles(0, math.pi, 0), "stand")  -- 对面站着讲解的军官
  -- 枪架：右墙，一排六支步枪（枪托、枪身、弹匣）
  local rx = ix - 0.6
  block(m, base, V(0.4, 4.6, 7.2), CF(rx + 0.25, y0 + 2.3, 3.6), WOOD, MAT.Wood)
  block(m, base, V(1.6, 0.3, 7.2), CF(rx - 0.3, y0 + 0.45, 3.6), WOOD, MAT.Wood)
  block(m, base, V(1.2, 0.25, 7.2), CF(rx - 0.15, y0 + 3.6, 3.6), WOOD, MAT.Wood)
  for k = 0, 5 do
    local gz = 1.0 + k * 1.05
    ghostly(block(m, base, V(0.35, 1.0, 0.3), CF(rx - 0.45, y0 + 1.1, gz), RGB(96, 72, 48), MAT.Wood))
    ghostly(block(m, base, V(0.22, 3.4, 0.22), CF(rx - 0.45, y0 + 3.2, gz), RGB(40, 42, 44), MAT.Metal))
    ghostly(block(m, base, V(0.26, 0.7, 0.2), CF(rx - 0.75, y0 + 2.4, gz), RGB(40, 42, 44), MAT.Metal))
  end
  figure(m, base, CF(rx - 2.4, y0, 2.4) * CFrame.Angles(0, math.rad(-90), 0), "stand")   -- 在枪架前
  -- 公告栏（后墙，SurfaceGui：标题和几张贴着的纸）
  local board = block(m, base, V(5.2, 3.2, 0.15), CF(tx, y0 + 4.8, -iz + 0.08), RGB(150, 112, 70), MAT.Wood)
  do
    local sg = Instance.new("SurfaceGui")
    sg.Face = Enum.NormalId.Back
    sg.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
    sg.PixelsPerStud = 40
    sg.Parent = board
    local t = Instance.new("TextLabel")
    t.BackgroundTransparency = 1
    t.Size = UDim2.fromScale(1, 0.24)
    t.Font = Enum.Font.GothamBlack
    t.TextScaled = true
    t.TextColor3 = RGB(255, 240, 200)
    t.Text = "公 告 栏"
    t.Parent = sg
    for k, txt in ipairs({ "值班表", "训练计划", "作战命令", "内务条令" }) do
      local p = Instance.new("TextLabel")
      p.Position = UDim2.fromScale(0.04 + (k - 1) * 0.24, 0.3 + (k % 2) * 0.08)
      p.Size = UDim2.fromScale(0.2, 0.55)
      p.BackgroundColor3 = RGB(244, 242, 232)
      p.BorderSizePixel = 0
      p.Rotation = (k % 2 == 0) and 3 or -2
      p.Font = Enum.Font.GothamBold
      p.TextScaled = true
      p.TextYAlignment = Enum.TextYAlignment.Top
      p.TextColor3 = RGB(50, 50, 60)
      p.Text = txt
      p.Parent = sg
    end
  end
  -- 电台桌（右前角）、坐着值班的通信兵；饮水机、灭火器；墙上的队旗和钟
  local dx, dz = ix - 2.2, iz - 1.3
  block(m, base, V(3.6, 0.25, 1.8), CF(dx, y0 + 2.8, dz), WOOD, MAT.Wood)
  block(m, base, V(3.4, 2.7, 0.2), CF(dx, y0 + 1.35, dz + 0.75), RGB(70, 60, 48), MAT.Wood)
  block(m, base, V(1.8, 1.1, 1.0), CF(dx - 0.5, y0 + 3.5, dz + 0.2), RGB(64, 78, 58), MAT.Metal)
  anim(ghostly(block(m, base, V(0.2, 0.2, 0.06), CF(dx - 0.9, y0 + 3.6, dz - 0.31), RGB(90, 255, 120), MAT.Neon)), "blink", 1.5)
  ghostly(cyl(m, base, 2.6, 0.08, CF(dx + 0.2, y0 + 5.3, dz + 0.4), C.dark, MAT.Metal))
  chair(dx, dz - 2.2, math.pi)
  figure(m, base, CF(dx, y0, dz - 1.4) * CFrame.Angles(0, math.pi, 0), "sit")
  block(m, base, V(1.3, 2.8, 1.3), CF(3.8, y0 + 1.4, iz - 1.0), RGB(226, 226, 222), MAT.SmoothPlastic)
  local jug = ghostly(cyl(m, base, 1.6, 1.0, CF(3.8, y0 + 3.6, iz - 1.0), RGB(140, 190, 230), MAT.Glass))
  jug.Transparency = 0.35
  ghostly(cyl(m, base, 1.4, 0.55, CF(-3.4, y0 + 0.9, iz - 0.6), RGB(200, 40, 36), MAT.SmoothPlastic))
  ghostly(block(m, base, V(0.1, 2.6, 3.6), CF(ix - 0.06, y0 + 8.5, 0), team or C.red, MAT.Fabric))
  local clock = ghostly(cyl(m, base, 0.15, 1.6, CF(0, y0 + 8.6, iz - 0.1) * CFrame.Angles(math.rad(90), 0, 0), RGB(240, 240, 236), MAT.SmoothPlastic))
  clock.CastShadow = false
  ghostly(block(m, base, V(0.12, 0.6, 0.06), CF(0, y0 + 8.85, iz - 0.2), C.dark, MAT.SmoothPlastic))
  ghostly(block(m, base, V(0.45, 0.12, 0.06), CF(0.18, y0 + 8.6, iz - 0.2), C.dark, MAT.SmoothPlastic))

  ---------------- 外面
  flag(m, base, CF(w / 2 + 2, 0, d / 2 + 2), team)
  for _, sx in ipairs({ -6.5, 6.5 }) do block(m, base, V(5, 1.8, 1.4), CF(sx, y0 + 0.9, d / 2 + 4.2), C.sand, MAT.Fabric) end
  facadeSign(m, base, CF(0, y0 + h - 1.3, d / 2 + 0.35), 9, 1.6, "兵  营", RGB(255, 226, 140), Enum.NormalId.Back)
  -- 门前操场：一排人做俯卧撑（客户端让他们一起一上一下），教官在旁边看着；西头单杠、轮胎
  local pz = d / 2 + 8.5   -- 操场靠着兵营（再往北是部队开出去的横通道，吉普车在那上面跑）
  ghostly(block(m, base, V(w, 0.06, 8), CF(0, 0.66, pz), RGB(110, 112, 104), MAT.SmoothPlastic))
  for k = -2, 2 do ghostly(block(m, base, V(0.5, 0.08, 6.4), CF(k * 4 + 2, 0.7, pz), C.white, MAT.SmoothPlastic)) end
  for _, fx in ipairs({ -5, -1.5, 2, 5.5 }) do figure(m, base, CF(fx, 0.7, pz + 3.2), "plank", { amp = 6, spd = 0.55 }) end
  figure(m, base, CF(10.5, 0.7, pz + 0.5) * CFrame.Angles(0, math.rad(90), 0), "stand")
  for _, sx in ipairs({ -15.4, -10.6 }) do cyl(m, base, 7.4, 0.35, CF(sx, 0.7 + 3.7, pz - 2.4), C.metal, MAT.Metal) end
  cyl(m, base, 5.0, 0.25, CF(-13, 0.7 + 7.0, pz - 2.4) * CFrame.Angles(0, 0, math.pi / 2), C.metal, MAT.Metal)
  for r = 0, 1 do
    for k = 0, 2 do
      block(m, base, V(0.8, 2.4, 2.4), CF(-14.6 + k * 2.6 + r * 1.3, 0.7 + 0.4, pz + 0.6 + r * 2.4) * UP, RGB(32, 32, 34), MAT.SmoothPlastic, CYL)
    end
  end
  return body
end

local function hangar(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local wall = h * 0.5
  slabUnder(m, base, w, d)
  local body = block(m, base, V(w, wall, d), CF(0, 0.6 + wall / 2, 0), RGB(112, 120, 100), MAT.Metal)
  local r = w * 0.47
  block(m, base, V(d, r * 2, r * 2), CF(0, 0.6 + wall - r * 0.42, 0) * CFrame.Angles(0, math.pi / 2, 0), RGB(100, 108, 90), MAT.CorrodedMetal, CYL)
  block(m, base, V(w * 0.62, wall * 0.92, 0.6), CF(0, 0.6 + wall * 0.46, d / 2 + 0.15), C.dark, MAT.DiamondPlate)
  local seg = w * 0.62 / 6
  for k = 0, 5 do
    block(m, base, V(seg, 0.8, 0.7), CF(-w * 0.31 + (k + 0.5) * seg, 0.6 + wall * 0.92 + 0.4, d / 2 + 0.2), (k % 2 == 0) and C.yellow or C.dark)
  end
  for _, sx in ipairs({ -1, 1 }) do block(m, base, V(0.4, 4, 3), CF(sx * (w / 2 + 0.1), 0.6 + 2, -d * 0.2), C.dark, MAT.DiamondPlate) end
  for k = -1, 1 do
    local sky = block(m, base, V(2, 0.3, d * 0.7), CF(k * w * 0.2, 0.6 + wall + r * 0.52, 0) * CFrame.Angles(0, 0, -k * 0.35), C.glass, MAT.Glass)
    sky.CastShadow = false
  end
  facadeSign(m, base, CF(0, 0.6 + wall + 2.2, d / 2 + 0.5), 12, 1.8, "装甲车厂", RGB(255, 214, 90), Enum.NormalId.Back)
  return body
end

local function aaShop(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local hh = h * 0.6
  slabUnder(m, base, w, d)
  local body = block(m, base, V(w, hh, d), CF(0, 0.6 + hh / 2, 0), RGB(118, 126, 112), MAT.Concrete)
  block(m, base, V(w * 0.55, hh * 0.8, 0.6), CF(0, 0.6 + hh * 0.4, d / 2 + 0.15), C.dark, MAT.DiamondPlate)
  cyl(m, base, 7, 0.6, CF(-w / 2 + 3, 0.6 + hh + 3.5, -d / 2 + 3), C.metal, MAT.Metal)
  anim(block(m, base, V(6, 3, 0.4), CF(-w / 2 + 3, 0.6 + hh + 7.5, -d / 2 + 3) * CFrame.Angles(math.rad(-20), math.rad(30), 0), C.white, MAT.Metal), "spin", 0.4)
  block(m, base, V(3, 1.6, 3), CF(w / 4, 0.6 + hh + 0.8, 0), C.olive, MAT.Metal)
  for _, s in ipairs({ -1, 1 }) do
    block(m, base, V(0.3, 0.3, 4), CF(w / 4 + s * 0.7, 0.6 + hh + 2.4, 1.4) * CFrame.Angles(math.rad(-35), 0, 0), C.gun, MAT.Metal)
  end
  block(m, base, V(3, 1, 3), CF(w / 2 + 4, 0.6 + 0.5, d * 0.2), C.oliveDark, MAT.Metal)   -- 门外的发射架
  block(m, base, V(2.4, 2.2, 6), CF(w / 2 + 4, 0.6 + 3.2, d * 0.2) * CFrame.Angles(math.rad(-40), 0, 0), C.olive, MAT.Metal)
  facadeSign(m, base, CF(0, 0.6 + hh - 1.2, d / 2 + 0.35), 10, 1.5, "防空车间", RGB(255, 214, 90), Enum.NormalId.Back)
  return body
end

local function artyPos(m, base, b)
  local w, d = b.size[1], b.size[3]
  block(m, base, V(w + 3, 0.6, d + 3), CF(0, 0.3, 0), C.sand, MAT.Sand)
  block(m, base, V(w, 3, 2), CF(0, 0.6 + 1.5, -d / 2 + 1), C.sand, MAT.Fabric)
  block(m, base, V(2, 3, d - 2), CF(-w / 2 + 1, 0.6 + 1.5, 0), C.sand, MAT.Fabric)
  block(m, base, V(2, 3, d - 2), CF(w / 2 - 1, 0.6 + 1.5, 0), C.sand, MAT.Fabric)
  local body = block(m, base, V(3.6, 1.2, 5), CF(0, 0.6 + 1.6, -1), C.olive, MAT.Metal)
  for _, s in ipairs({ -1, 1 }) do
    block(m, base, V(0.8, 2.6, 2.6), CF(s * 2.2, 0.6 + 1.3, -0.5), C.track, MAT.Metal, CYL)
    block(m, base, V(0.4, 0.4, 6), CF(s * 1.2, 0.6 + 0.6, -5) * CFrame.Angles(0, s * 0.25, 0), C.olive, MAT.Metal)
  end
  block(m, base, V(0.5, 0.5, 8), CF(0, 0.6 + 3.2, 2.5) * CFrame.Angles(math.rad(-28), 0, 0), C.gun, MAT.Metal)
  for k = 0, 2 do block(m, base, V(2.2, 1.2, 1.4), CF(-w / 2 + 4, 0.6 + 0.6 + k * 1.2, -d / 2 + 4), C.oliveDark, MAT.WoodPlanks) end
  local net = block(m, base, V(w * 0.85, 0.2, d * 0.75), CF(0, 0.6 + 7, 0), RGB(70, 88, 52), MAT.Fabric)
  net.Transparency = 0.15
  for _, sx in ipairs({ -1, 1 }) do
    for _, sz in ipairs({ -1, 1 }) do cyl(m, base, 7, 0.3, CF(sx * w * 0.4, 0.6 + 3.5, sz * d * 0.35), C.oliveDark, MAT.Wood) end
  end
  return body
end

-- 停在直升机场 / 机场上的展示飞机：客户端（Anim.lua）按属性 Show 隔一会儿让它起飞、飞一圈、落回来（服务器上一直停着）
local function showPlane(m, base, t, cf, team)
  local ok, um, root = pcall(function() return Models.unit(t, team or C.olive) end)
  if not ok or not um then return end
  local r = um:FindFirstChild("TeamRing")
  if r then r:Destroy() end
  for _, d in ipairs(um:GetDescendants()) do
    if d:IsA("BasePart") then
      d.CanQuery = false
      d.CanTouch = false
      d.CanCollide = false
    end
  end
  root.CFrame = base * cf
  um.Name = "Show"
  um:SetAttribute("Show", t)
  um.Parent = m
end

local function helipad(m, base, b, team)
  local w, d = b.size[1], b.size[3]
  local body = block(m, base, V(w, 0.8, d), CF(0, 0.4, 0), C.asphalt, MAT.Asphalt)
  ghostly(cyl(m, base, 0.1, w * 0.78, CF(0, 0.85, 0), C.yellow))
  ghostly(cyl(m, base, 0.12, w * 0.7, CF(0, 0.86, 0), C.asphalt, MAT.Asphalt))
  ghostly(block(m, base, V(2, 0.1, 14), CF(-4.5, 0.95, 0), C.white))
  ghostly(block(m, base, V(2, 0.1, 14), CF(4.5, 0.95, 0), C.white))
  ghostly(block(m, base, V(9, 0.1, 2), CF(0, 0.95, 0), C.white))
  for _, sx in ipairs({ -1, 1 }) do
    for _, sz in ipairs({ -1, 1 }) do anim(block(m, base, V(1, 1, 1), CF(sx * (w / 2 - 1), 1.2, sz * (d / 2 - 1)), RGB(80, 255, 120), MAT.Neon), "blink", 0.8) end
  end
  cyl(m, base, 9, 0.3, CF(w / 2 + 2, 4.5, -d / 2 + 2), C.metal, MAT.Metal)
  block(m, base, V(0.9, 0.9, 3), CF(w / 2 + 2, 8.5, -d / 2 + 3.5), RGB(240, 120, 30), MAT.Fabric)
  showPlane(m, base, "heli", CF(0, 0.9, 0), team)
  return body
end

-- 空军基地：在围墙外的草地上（底板从地面铺起），跑道沿 Z（喷气机从 −Z 那头滑跑，往战场方向起飞），右边两座机库，左边塔台
local function airbase(m, base, b, team)
  local w, d = b.size[1], b.size[3]
  local body = block(m, base, V(w, 1.2, d), CF(0, -0.4, 0), RGB(150, 152, 148), MAT.Concrete)
  ghostly(block(m, base, V(22, 0.1, d - 8), CF(0, 0.25, 0), C.asphalt, MAT.Asphalt))
  for k = -7, 7 do ghostly(block(m, base, V(0.8, 0.06, 8), CF(0, 0.32, k * 15), C.white)) end
  for _, sx in ipairs({ -1, 1 }) do ghostly(block(m, base, V(0.5, 0.06, d - 10), CF(sx * 10, 0.32, 0), C.white)) end
  for _, sz in ipairs({ -1, 1 }) do
    for k = -4, 4 do anim(block(m, base, V(0.6, 0.4, 0.6), CF(k * 2.4, 0.4, sz * (d / 2 - 2)), (sz < 0) and RGB(80, 255, 120) or RGB(255, 80, 70), MAT.Neon), "blink", 1.2) end
  end
  for _, hz in ipairs({ -60, 20 }) do   -- 机库：门朝跑道
    local hb = CF(21, 0.2, hz)
    block(m, base, V(16, 6, 22), hb * CF(0, 3, 0), RGB(112, 120, 100), MAT.Metal)
    block(m, base, V(16, 22, 22), hb * CF(0, 6 - 11 * 0.42, 0), RGB(100, 108, 90), MAT.CorrodedMetal, CYL)
    block(m, base, V(0.4, 5.4, 14), hb * CF(-8.1, 2.7, 0), C.dark, MAT.DiamondPlate)
  end
  cyl(m, base, 12, 4, CF(-22, 6.2, -90), C.concrete, MAT.Concrete)   -- 塔台
  block(m, base, V(6, 3, 6), CF(-22, 13.7, -90), C.glass, MAT.Glass)
  block(m, base, V(6.6, 0.6, 6.6), CF(-22, 15.5, -90), C.roof, MAT.Metal)
  cyl(m, base, 8, 0.3, CF(-22, 4.2, 40), C.metal, MAT.Metal)   -- 风向袋
  block(m, base, V(0.9, 0.9, 3), CF(-22, 8, 41.5), RGB(240, 120, 30), MAT.Fabric)
  showPlane(m, base, "fighter", CF(0, 0.3, -d / 2 + 20) * CFrame.Angles(0, math.pi, 0), team)   -- 跑道南头，机头朝北
  return body
end

local function hq(m, base, b, team)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  slabUnder(m, base, w, d)
  local h1 = h * 0.6
  local body = block(m, base, V(w, h1, d), CF(0, 0.6 + h1 / 2, 0), RGB(96, 104, 86), MAT.Concrete)
  block(m, base, V(w + 0.3, 1.2, d + 0.3), CF(0, 0.6 + h1 * 0.6, 0), C.glass, MAT.Glass)
  local h2 = h * 0.4
  block(m, base, V(w * 0.55, h2, d * 0.55), CF(-w * 0.12, 0.6 + h1 + h2 / 2, 0), RGB(84, 92, 76), MAT.Concrete)
  block(m, base, V(w * 0.55 + 0.3, 1, d * 0.55 + 0.3), CF(-w * 0.12, 0.6 + h1 + h2 * 0.55, 0), C.glass, MAT.Glass)
  cyl(m, base, 14, 0.4, CF(w * 0.3, 0.6 + h1 + 7, -d * 0.25), C.metal, MAT.Metal)
  anim(block(m, base, V(0.7, 0.7, 0.7), CF(w * 0.3, 0.6 + h1 + 14.2, -d * 0.25), C.red, MAT.Neon), "blink", 1)
  anim(block(m, base, V(5, 2.4, 0.4), CF(w * 0.25, 0.6 + h1 + 2, d * 0.2) * CFrame.Angles(math.rad(-15), math.rad(-25), 0), C.white, MAT.Metal), "spin", 0.25)
  flag(m, base, CF(-w / 2 - 2, 0, d / 2 + 2), team)
  block(m, base, V(5, 5, 0.6), CF(0, 0.6 + 2.5, d / 2 + 0.15), C.dark)
  local top = 0.6 + h1 + h2
  cyl(m, base, 2, 0.8, CF(-w * 0.12, top + 1, -d * 0.12), C.metal, MAT.Metal)
  anim(block(m, base, V(0.6, 6, 6), CF(-w * 0.12, top + 4, -d * 0.12) * CFrame.Angles(0, 0, math.rad(55)), RGB(232, 232, 228), MAT.SmoothPlastic, CYL), "spin", 0.08)
  for k = 0, 2 do cyl(m, base, 6 + k * 2, 0.15, CF(-w * 0.32 + k * 1.4, top + 3 + k, d * 0.18), C.metal, MAT.Metal) end
  for _, sx in ipairs({ -1, 1 }) do cyl(m, base, 5, 0.9, CF(sx * 3.4, 0.6 + 2.5, d / 2 + 2.2), RGB(200, 200, 192), MAT.Concrete) end
  block(m, base, V(9, 0.6, 3.4), CF(0, 0.6 + 5.2, d / 2 + 1.7), RGB(84, 92, 76), MAT.Concrete)
  facadeSign(m, base, CF(0, 0.6 + h1 - 1.4, d / 2 + 0.35), 10, 1.6, "指 挥 部", RGB(255, 226, 140), Enum.NormalId.Back)
  return body
end

---------------------------------------------------------------- 西边工业区的建筑

-- 看不见、不挡人的整块主体（挂牌子、提示、升起动画的脚手架用它的大小）
local function hiddenBody(m, base, w, h, d)
  local body = ghostly(block(m, base, V(w, h, d), CF(0, 0.6 + h / 2, 0), C.concrete, MAT.Concrete))
  body.Transparency = 1
  body.CastShadow = false
  return body
end

-- 两点之间的一根杆（size 是粗细，沿杆方向自动拉长）
local function rod(m, base, a, b, t, color, mat)
  local mid, len = (a + b) / 2, (b - a).Magnitude
  return block(m, base, V(t, t, len), CFrame.lookAt(mid, b), color, mat or MAT.Metal)
end

-- 客户端动画的属性：绕 piv 点、ax 轴转 / 来回摆
local function spinAbout(p, piv, ax, spd)
  anim(p, "spin", spd)
  p:SetAttribute("Piv", piv)
  p:SetAttribute("Ax", ax)
  return p
end
local function nodAbout(p, piv, ax, amp, spd, ph)
  p:SetAttribute("Anim", "nod")
  p:SetAttribute("Piv", piv)
  p:SetAttribute("Ax", ax)
  p:SetAttribute("Amp", amp)
  p:SetAttribute("Spd", spd)
  p:SetAttribute("Ph", ph or 0)
  return p
end

-- 冒烟（服务器上放的粒子，客户端自己放，不占网络）：color 烟色、size 从多大长到多大、rate 每秒几团
local function smoke(p, color, s0, s1, rate, life, speed)
  local e = Instance.new("ParticleEmitter")
  e.Texture = "rbxasset://textures/particles/smoke_main.dds"
  e.Color = ColorSequence.new(color)
  e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, s0), NumberSequenceKeypoint.new(1, s1) })
  e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.12, 0.45), NumberSequenceKeypoint.new(1, 1) })
  e.Lifetime = NumberRange.new(life * 0.8, life * 1.2)
  e.Speed = NumberRange.new(speed * 0.7, speed * 1.2)
  e.Rate = rate
  e.EmissionDirection = Enum.NormalId.Top
  e.SpreadAngle = Vector2.new(12, 12)
  e.Acceleration = V(1.2, 0.4, 0.4)
  e.Rotation = NumberRange.new(0, 360)
  e.RotSpeed = NumberRange.new(-15, 15)
  e.LightInfluence = 1
  e.Parent = p
  return e
end

-- 一盏灯（PointLight）挂在零件上
local function glow(p, range, bright, color)
  local l = Instance.new("PointLight")
  l.Range, l.Brightness, l.Color, l.Shadows = range, bright, color, false
  l.Parent = p
  return l
end

-- 油井：一台抽油机（游梁带着驴头绕支架顶上下点头、后面的曲柄和配重一圈圈转、电机）、井口采油树、小储油罐和管子、地上一摊油
local function oilWell(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(146, 142, 132), MAT.Concrete)
  local Y = 0.6
  local ph = (#b.id + string.byte(b.id, -1)) % 7   -- 几口井别一起点头
  local W = base   -- 世界坐标换算
  local DARK, BODY, HEAD = RGB(58, 60, 64), RGB(214, 170, 40), RGB(40, 42, 46)
  block(m, base, V(3.4, 0.8, 15), CF(0, Y + 0.4, 0.5), DARK, MAT.Metal)
  -- 支架：四条斜腿撑到顶上的轴
  local top = V(0, Y + 7.4, 0)
  for _, sx in ipairs({ -1.2, 1.2 }) do
    for _, sz in ipairs({ -2.6, 2.6 }) do rod(m, base, V(sx, Y + 0.8, sz), V(sx * 0.45, top.Y - 0.2, 0), 0.4, BODY) end
  end
  block(m, base, V(2.2, 0.6, 0.8), CF(0, top.Y, 0), DARK, MAT.Metal)
  -- 游梁和驴头：绕轴点头
  local piv, ax = (W * CF(top)).Position, V(1, 0, 0)
  nodAbout(block(m, base, V(0.9, 1.1, 14), CF(0, top.Y + 0.75, -1), BODY, MAT.Metal), piv, ax, 13, 0.32, ph)
  nodAbout(block(m, base, V(1.3, 4.6, 1.4), CF(0, top.Y - 0.5, -8.4), HEAD, MAT.Metal), piv, ax, 13, 0.32, ph)
  nodAbout(block(m, base, V(1.3, 1.6, 1.6), CF(0, top.Y + 1.4, -7.6), HEAD, MAT.Metal), piv, ax, 13, 0.32, ph)
  -- 曲柄、配重：绕横轴转（和点头一个周期）
  local cpiv = (W * CF(0, Y + 3.2, 5.6)).Position
  for _, sx in ipairs({ -1.6, 1.6 }) do
    spinAbout(block(m, base, V(0.45, 6.4, 1.2), CF(sx, Y + 3.2, 5.6), BODY, MAT.Metal), cpiv, ax, 0.32)
    spinAbout(block(m, base, V(0.9, 1.8, 2.8), CF(sx, Y + 3.2 - 2.4, 5.6), RGB(170, 40, 34), MAT.Metal), cpiv, ax, 0.32)
  end
  block(m, base, V(2.4, 1.2, 1.2), CF(0, Y + 3.2, 5.6), DARK, MAT.Metal, CYL)
  -- 电机和皮带罩
  block(m, base, V(1.8, 1.8, 2.6), CF(0, Y + 1.7, 8.6), RGB(70, 110, 150), MAT.Metal)
  block(m, base, V(0.5, 2.6, 3.6), CF(1.3, Y + 2.4, 7.2), DARK, MAT.Metal)
  -- 井口采油树、阀门、通到储罐的管子；储罐、爬梯
  cyl(m, base, 3.0, 1.0, CF(0, Y + 1.5, -8.4), RGB(150, 150, 150), MAT.Metal)
  block(m, base, V(2.6, 0.5, 0.5), CF(0, Y + 2.2, -8.4), RGB(150, 150, 150), MAT.Metal)
  for _, sx in ipairs({ -1.4, 1.4 }) do block(m, base, V(0.15, 1.0, 1.0), CF(sx, Y + 2.2, -8.4), C.red, MAT.Metal, CYL) end
  block(m, base, V(5.2, 0.45, 0.45), CF(2.9, Y + 0.6, -8.4), DARK, MAT.Metal, CYL)
  cyl(m, base, 6, 4.6, CF(6.0, Y + 3.0, -7.0), RGB(226, 226, 220), MAT.Metal)
  cyl(m, base, 0.3, 4.9, CF(6.0, Y + 6.15, -7.0), RGB(180, 60, 50), MAT.Metal)
  block(m, base, V(0.6, 6, 0.15), CF(6.0, Y + 3.0, -4.6), DARK, MAT.Metal)
  local puddle = ghostly(block(m, base, V(4, 0.06, 3), CF(-1.6, Y + 0.03, -6.5), RGB(18, 18, 20), MAT.Glass))
  puddle.CastShadow = false
  return body
end

-- 炼油厂：两个大储罐、两座蒸馏塔（黄色平台圈）、管廊上红黄蓝三根管子、火炬顶上烧着火、控制室
local function refinery(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(150, 148, 140), MAT.Concrete)
  local Y = 0.6
  local GREY = RGB(96, 98, 102)
  for _, x in ipairs({ -15, -1 }) do
    cyl(m, base, 11, 12, CF(x, Y + 5.5, -7), RGB(234, 234, 228), MAT.Metal)
    cyl(m, base, 0.7, 12.6, CF(x, Y + 11.2, -7), RGB(196, 196, 192), MAT.Metal)
    block(m, base, V(1.2, 0.25, 13), CF(x + 6.4, Y + 5.6, -7) * CFrame.Angles(math.rad(-52), 0, 0), GREY, MAT.Metal)
    ghostly(block(m, base, V(6, 1.2, 0.1), CF(x, Y + 6, -0.95), RGB(40, 90, 160), MAT.SmoothPlastic))   -- 罐身上的蓝色条
  end
  for i, x in ipairs({ 11, 17.5 }) do
    local th = 20 + i * 3
    cyl(m, base, th, 3.4, CF(x, Y + th / 2, -6), RGB(196, 198, 194), MAT.Metal)
    for k = 1, 3 do cyl(m, base, 0.3, 5.2, CF(x, Y + k * 6.5, -6), RGB(236, 190, 40), MAT.Metal) end
    cyl(m, base, 1.2, 2.2, CF(x, Y + th + 0.6, -6), GREY, MAT.Metal)
  end
  -- 管廊
  for k = -2, 2 do block(m, base, V(0.7, 6.4, 0.7), CF(k * 9.5, Y + 3.2, 9), GREY, MAT.Metal) end
  block(m, base, V(42, 0.5, 2.8), CF(0, Y + 6.6, 9), GREY, MAT.Metal)
  for k, col in ipairs({ RGB(196, 62, 50), RGB(230, 196, 60), RGB(70, 116, 176) }) do
    block(m, base, V(42, 0.75, 0.75), CF(0, Y + 7.3, 9 + (k - 2) * 0.9), col, MAT.Metal, CYL)
  end
  -- 火炬：细高的烟囱，顶上烧着火、亮光一闪一闪
  local fx, fz = 22.5, -13
  cyl(m, base, 30, 1.1, CF(fx, Y + 15, fz), RGB(160, 160, 158), MAT.Metal)
  for k = 1, 3 do rod(m, base, V(fx, Y + k * 8, fz), V(fx - 4, Y, fz + 3 - k * 0.5), 0.3, GREY) end
  local flame = ghostly(block(m, base, V(1.4, 2.2, 1.4), CF(fx, Y + 31.2, fz), RGB(255, 160, 50), MAT.Neon))
  anim(flame, "blink", 5)
  local fire = Instance.new("Fire")
  fire.Size, fire.Heat = 7, 14
  fire.Color, fire.SecondaryColor = RGB(255, 150, 40), RGB(255, 60, 20)
  fire.Parent = flame
  glow(flame, 32, 2.2, RGB(255, 170, 90))
  -- 控制室
  block(m, base, V(11, 5, 7), CF(-17, Y + 2.5, 10), RGB(214, 210, 196), MAT.SmoothPlastic)
  block(m, base, V(11.2, 1.3, 7.2), CF(-17, Y + 3.3, 10), C.glass, MAT.Glass)
  block(m, base, V(11.6, 0.4, 7.6), CF(-17, Y + 5.2, 10), C.roof, MAT.Metal)
  facadeSign(m, base, CF(-17, Y + 6.4, 13.6), 9, 1.6, "炼 油 厂", RGB(255, 226, 140), Enum.NormalId.Back)
  return body
end

-- 弹药厂：锯齿屋顶的车间，侧门出来一条传送带（客户端在上面跑弹药箱），尽头停着装货的卡车；成垛的弹药箱、叉车、屋顶通风帽
local function ammoPlant(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(150, 148, 140), MAT.Concrete)
  local Y = 0.6
  local hx, hw, hd = -7, 30, 24
  block(m, base, V(hw, 10, hd), CF(hx, Y + 5, 0), RGB(126, 96, 74), MAT.Brick)
  block(m, base, V(hw + 0.4, 1.2, hd + 0.4), CF(hx, Y + 6.8, 0), C.glass, MAT.Glass)
  for k = 0, 3 do   -- 锯齿屋顶：四道斜面（玻璃那面朝北）
    local x = hx - hw / 2 + 3.75 + k * 7.5
    local wd = Instance.new("WedgePart")
    wd.Anchored = true
    wd.Size = V(hd, 3.2, 7.5)
    wd.CFrame = base * CF(x, Y + 10 + 1.6, 0) * CFrame.Angles(0, math.rad(90), 0)
    wd.Color = RGB(96, 100, 104)
    wd.Material = MAT.Metal
    wd.Parent = m
    block(m, base, V(0.3, 3.0, hd), CF(x + 3.6, Y + 10 + 1.5, 0), C.glass, MAT.Glass)
  end
  -- 侧门、传送带（皮带 + 支腿 + 滚筒），皮带上 Anim = belt：客户端让一个个弹药箱从门里出来往卡车走
  block(m, base, V(0.4, 6, 5), CF(hx + hw / 2 + 0.1, Y + 3, -6), C.dark, MAT.Metal)
  local belt = block(m, base, V(11, 0.4, 2.4), CF(hx + hw / 2 + 5.6, Y + 2.2, -6), RGB(34, 34, 36), MAT.Fabric)
  belt:SetAttribute("Anim", "belt")
  belt:SetAttribute("Spd", 3.2)
  belt:SetAttribute("N", 4)
  belt:SetAttribute("Item", "crate")
  for k = 0, 3 do
    for _, sz in ipairs({ -1.1, 1.1 }) do block(m, base, V(0.3, 2.0, 0.3), CF(hx + hw / 2 + 1.2 + k * 3.0, Y + 1.0, -6 + sz), RGB(230, 190, 40), MAT.Metal) end
  end
  block(m, base, V(11, 0.3, 0.3), CF(hx + hw / 2 + 5.6, Y + 2.5, -7.3), RGB(230, 190, 40), MAT.Metal)
  block(m, base, V(11, 0.3, 0.3), CF(hx + hw / 2 + 5.6, Y + 2.5, -4.7), RGB(230, 190, 40), MAT.Metal)
  -- 卡车（车尾对着传送带）
  local tx, tz = hx + hw / 2 + 14, -6
  for _, sz in ipairs({ -1.5, 1.5 }) do
    for _, sx in ipairs({ -2.4, 1.6, 3.6 }) do block(m, base, V(0.8, 2.2, 2.2), CF(tx + sx, Y + 1.1, tz + sz) * CFrame.Angles(0, math.rad(90), 0), RGB(30, 30, 32), MAT.SmoothPlastic, CYL) end
  end
  block(m, base, V(9.6, 0.8, 3.4), CF(tx + 0.8, Y + 1.9, tz), RGB(52, 54, 52), MAT.Metal)
  block(m, base, V(6.2, 3.4, 3.4), CF(tx - 0.6, Y + 4.0, tz), RGB(84, 96, 64), MAT.Fabric)
  block(m, base, V(2.8, 2.8, 3.2), CF(tx + 4.2, Y + 3.7, tz), RGB(84, 96, 64), MAT.Metal)
  block(m, base, V(0.2, 1.1, 2.8), CF(tx + 5.62, Y + 4.4, tz), RGB(60, 90, 110), MAT.Glass)
  -- 成垛的弹药箱（托盘 + 一垛箱子 + 黄色标记）
  for i, p in ipairs({ { 12, 7 }, { 17, 7 }, { 12, 11.5 }, { -20, 13.5 } }) do
    block(m, base, V(4, 0.4, 3.6), CF(p[1], Y + 0.2, p[2]), RGB(140, 104, 66), MAT.WoodPlanks)
    local hh = (i % 2 == 0) and 2.6 or 3.6
    block(m, base, V(3.6, hh, 3.2), CF(p[1], Y + 0.4 + hh / 2, p[2]), RGB(78, 92, 58), MAT.Metal)
    ghostly(block(m, base, V(3.65, 0.3, 3.25), CF(p[1], Y + 0.4 + hh * 0.7, p[2]), RGB(236, 196, 50), MAT.SmoothPlastic))
  end
  -- 叉车
  local kx, kz = 18, 1.5
  block(m, base, V(2.2, 1.6, 3.2), CF(kx, Y + 1.3, kz), RGB(236, 190, 40), MAT.Metal)
  block(m, base, V(1.8, 1.4, 1.4), CF(kx, Y + 2.8, kz + 0.6), C.dark, MAT.Metal)
  block(m, base, V(0.3, 4.4, 0.3), CF(kx - 0.7, Y + 2.2, kz - 1.8), C.dark, MAT.Metal)
  block(m, base, V(0.3, 4.4, 0.3), CF(kx + 0.7, Y + 2.2, kz - 1.8), C.dark, MAT.Metal)
  block(m, base, V(1.8, 0.2, 2.2), CF(kx, Y + 0.6, kz - 3.0), C.dark, MAT.Metal)
  for _, sx in ipairs({ -1.15, 1.15 }) do block(m, base, V(0.5, 1.2, 1.2), CF(kx + sx, Y + 0.6, kz + 0.9) * CFrame.Angles(0, 0, math.pi / 2), RGB(30, 30, 32), MAT.SmoothPlastic, CYL) end
  -- 屋顶通风帽
  for _, x in ipairs({ hx - 9, hx + 2 }) do cyl(m, base, 2.4, 1.6, CF(x, Y + 14.4, 6), RGB(150, 150, 150), MAT.Metal) end
  facadeSign(m, base, CF(hx, Y + 8.8, hd / 2 + 0.25), 10, 1.6, "弹 药 厂", RGB(255, 226, 140), Enum.NormalId.Back)
  return body
end

-- 钢铁厂：人字屋顶的厂房、高炉（炉口发光、出铁沟里流着铁水）、三座热风炉、两根冒烟的大烟囱、钢梁和钢卷
local function steelMill(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(120, 118, 112), MAT.Concrete)
  local Y = 0.6
  local RUST, DARK = RGB(120, 70, 50), RGB(54, 56, 60)
  -- 厂房
  block(m, base, V(24, 13, 22), CF(-9, Y + 6.5, 4), RGB(84, 90, 96), MAT.CorrodedMetal)
  for _, s in ipairs({ -1, 1 }) do
    block(m, base, V(24.6, 0.6, 12.4), CF(-9, Y + 13 + 2.2, 4 + s * 5.4) * CFrame.Angles(s * math.rad(21), 0, 0), RGB(70, 74, 80), MAT.Metal)
  end
  block(m, base, V(24.4, 1.4, 22.4), CF(-9, Y + 9.6, 4), C.glass, MAT.Glass)
  -- 高炉：一节节往上收的炉身、炉顶、下降管
  local fx, fz = 10, -6
  cyl(m, base, 6, 10, CF(fx, Y + 3, fz), RUST, MAT.Metal)
  cyl(m, base, 9, 8.6, CF(fx, Y + 10.5, fz), RGB(130, 80, 58), MAT.Metal)
  cyl(m, base, 4, 6, CF(fx, Y + 17, fz), RUST, MAT.Metal)
  cyl(m, base, 3, 3.4, CF(fx, Y + 20.5, fz), DARK, MAT.Metal)
  rod(m, base, V(fx + 1.4, Y + 21.5, fz), V(fx + 7, Y + 14, fz + 6), 1.0, DARK)
  for k = 1, 3 do cyl(m, base, 0.3, 11, CF(fx, Y + k * 4.5, fz), RGB(230, 190, 40), MAT.Metal) end
  -- 炉口发光、出铁沟里的铁水
  local mouth = ghostly(block(m, base, V(3.2, 2.4, 0.4), CF(fx, Y + 1.6, fz + 5.05), RGB(255, 120, 30), MAT.Neon))
  anim(mouth, "blink", 2)
  glow(mouth, 22, 2, RGB(255, 140, 60))
  block(m, base, V(1.8, 0.3, 8), CF(fx, Y + 0.25, fz + 9), RGB(70, 66, 62), MAT.Slate)
  ghostly(block(m, base, V(1.0, 0.1, 7.6), CF(fx, Y + 0.45, fz + 9), RGB(255, 110, 20), MAT.Neon))
  -- 热风炉
  for i = 0, 2 do cyl(m, base, 18, 4, CF(17 + (i % 2) * 3, Y + 9, -14 + i * 4.2), RGB(150, 96, 74), MAT.Metal) end
  -- 烟囱（冒烟）
  for i, p in ipairs({ { -18, -10 }, { -12.5, -12 } }) do
    cyl(m, base, 26, 2.6, CF(p[1], Y + 13, p[2]), RGB(176, 74, 60), MAT.Brick)
    cyl(m, base, 2.4, 2.9, CF(p[1], Y + 21, p[2]), RGB(236, 236, 230), MAT.SmoothPlastic)
    local top = ghostly(block(m, base, V(2, 0.2, 2), CF(p[1], Y + 26.2, p[2]), DARK, MAT.Metal))
    smoke(top, RGB(110, 108, 106), 3, 11, 3 + i, 7, 6)
  end
  -- 钢梁、钢卷
  for k = 0, 2 do block(m, base, V(12, 0.9, 0.9), CF(-8, Y + 0.45 + k * 0.9, -14 + (k % 2) * 0.4), RGB(120, 124, 130), MAT.DiamondPlate) end
  for k = 0, 2 do block(m, base, V(2.4, 3.2, 3.2), CF(6 + k * 3, Y + 1.6, 14), RGB(150, 154, 160), MAT.Metal, CYL) end
  facadeSign(m, base, CF(-9, Y + 11.5, 15.3), 10, 1.6, "钢 铁 厂", RGB(255, 226, 140), Enum.NormalId.Back)
  return body
end

-- 矿场：一座石头山，山脚的坑道口（木支架），铁轨从坑道一直铺到矿仓（客户端让矿车来回跑），井架顶上的天轮在转，几堆矿石
local function mine(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(138, 122, 98), MAT.Ground)
  local Y = 0.6
  local ROCK, WOOD = RGB(118, 112, 104), RGB(112, 84, 56)
  -- 石头山（几个大球叠起来，埋一半在地里）
  for _, r in ipairs({ { -12, -4, 24 }, { -2, -9, 18 }, { -17, 7, 16 }, { 5, -11, 12 } }) do
    block(m, base, V(r[3], r[3], r[3]), CF(r[1], Y - r[3] * 0.18, r[2]), ROCK, MAT.Slate, BALL)
  end
  -- 坑道口：黑洞 + 木框
  local ex, ez = -4, 0.5
  ghostly(block(m, base, V(5.2, 6, 0.6), CF(ex, Y + 3, ez), RGB(12, 12, 14), MAT.SmoothPlastic))
  for _, sx in ipairs({ -2.9, 2.9 }) do block(m, base, V(0.8, 6.8, 0.8), CF(ex + sx, Y + 3.4, ez + 0.6), WOOD, MAT.Wood) end
  block(m, base, V(7.4, 0.9, 0.9), CF(ex, Y + 7.1, ez + 0.6), WOOD, MAT.Wood)
  -- 铁轨（两根轨 + 枕木），从坑道口往东铺到矿仓；皮带式动画让矿车沿着跑
  local rx0, rx1, rz = ex, 20, ez + 6
  local len = rx1 - rx0
  for k = 0, math.floor(len / 2.2) do ghostly(block(m, base, V(0.6, 0.2, 3.6), CF(rx0 + 1 + k * 2.2, Y + 0.1, rz), WOOD, MAT.Wood)) end
  for _, sz in ipairs({ -1.1, 1.1 }) do ghostly(block(m, base, V(len, 0.25, 0.25), CF((rx0 + rx1) / 2, Y + 0.32, rz + sz), RGB(90, 90, 94), MAT.Metal)) end
  local track = ghostly(block(m, base, V(len, 0.1, 2.6), CF((rx0 + rx1) / 2, Y + 0.3, rz), RGB(90, 90, 94), MAT.Metal))
  track.Transparency = 1
  track:SetAttribute("Anim", "belt")
  track:SetAttribute("Spd", 2.6)
  track:SetAttribute("N", 3)
  track:SetAttribute("Item", "cart")
  -- 坑道口和矿车之间：铁轨先从山里出来（-Z 那边转过来）
  ghostly(block(m, base, V(2.6, 0.2, 5.4), CF(ex, Y + 0.12, ez + 3.2), WOOD, MAT.Wood))
  -- 矿仓（高架的漏斗仓，下面能过矿车）
  local bx = rx1 + 1
  for _, o in ipairs({ { -2.6, -2.6 }, { 2.6, -2.6 }, { -2.6, 2.6 }, { 2.6, 2.6 } }) do block(m, base, V(0.7, 7, 0.7), CF(bx + o[1], Y + 3.5, rz + o[2]), WOOD, MAT.Wood) end
  block(m, base, V(6.6, 4, 6.6), CF(bx, Y + 9, rz), RGB(96, 84, 70), MAT.WoodPlanks)
  -- 井架和天轮
  local hx, hz = 13, -8
  for _, o in ipairs({ { -2.4, -2.4 }, { 2.4, -2.4 }, { -2.4, 2.4 }, { 2.4, 2.4 } }) do rod(m, base, V(hx + o[1] * 1.6, Y, hz + o[2] * 1.6), V(hx + o[1] * 0.5, Y + 16, hz + o[2] * 0.5), 0.6, RGB(150, 60, 44)) end
  for k = 1, 3 do block(m, base, V(6.4 - k * 1.1, 0.4, 6.4 - k * 1.1), CF(hx, Y + k * 4.4, hz), RGB(150, 60, 44), MAT.Metal) end
  local wheelC = CF(hx, Y + 17.6, hz)
  spinAbout(block(m, base, V(0.5, 5.4, 5.4), wheelC, RGB(70, 72, 78), MAT.Metal, CYL), (base * wheelC).Position, V(1, 0, 0), 0.25)
  for _, a in ipairs({ 0, 60, 120 }) do spinAbout(block(m, base, V(0.6, 5.0, 0.35), wheelC * CFrame.Angles(math.rad(a), 0, 0), RGB(200, 170, 50), MAT.Metal), (base * wheelC).Position, V(1, 0, 0), 0.25) end
  ghostly(block(m, base, V(0.15, 0.15, 14), CF(hx, Y + 17.6 - 2.6, hz + 6.5) * CFrame.Angles(math.rad(-48), 0, 0), C.dark, MAT.Metal))
  -- 矿石堆
  for _, p in ipairs({ { 18, 13, 7 }, { 13, 14.5, 5 }, { 22, 6, 5 } }) do
    block(m, base, V(p[3], p[3], p[3]), CF(p[1], Y - p[3] * 0.25, p[2]), RGB(74, 62, 52), MAT.Pebble, BALL)
  end
  facadeSign(m, base, CF(bx, Y + 11.6, rz + 3.35), 7, 1.4, "矿  场", RGB(255, 226, 140), Enum.NormalId.Back)
  return body
end

-- 核电站：两座冷却塔（一节节收腰的塔身，顶上冒白汽、塔顶红色航空障碍灯）、圆顶反应堆、汽轮机厂房、变压器和电线杆、辐射警告牌
local function nuclear(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(156, 156, 150), MAT.Concrete)
  local Y = 0.6
  local CON = RGB(222, 222, 216)
  for _, tx in ipairs({ -17, 5 }) do
    local tz = 7
    local y = Y
    for _, sec in ipairs({ { 21, 7 }, { 18.5, 7 }, { 16.5, 7 }, { 16.8, 6 }, { 18, 6 } }) do
      cyl(m, base, sec[2], sec[1], CF(tx, y + sec[2] / 2, tz), CON, MAT.Concrete)
      y = y + sec[2]
    end
    cyl(m, base, 0.6, 18.4, CF(tx, y + 0.3, tz), RGB(170, 170, 166), MAT.Concrete)
    local hole = ghostly(cyl(m, base, 0.2, 15.6, CF(tx, y + 0.65, tz), RGB(40, 42, 44), MAT.SmoothPlastic))
    -- 白汽：大团、慢慢往上飘、被风吹歪
    local e = smoke(hole, RGB(250, 250, 252), 10, 26, 4, 11, 5)
    e.SpreadAngle = Vector2.new(8, 8)
    e.Acceleration = V(1.6, 0.5, 0.6)
    e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.6), NumberSequenceKeypoint.new(0.2, 0.25), NumberSequenceKeypoint.new(1, 1) })
    for _, sx in ipairs({ -1, 1 }) do anim(ghostly(block(m, base, V(0.8, 0.8, 0.8), CF(tx + sx * 9.1, y + 0.9, tz), RGB(255, 40, 30), MAT.Neon)), "blink", 0.7) end
  end
  -- 反应堆：圆柱 + 圆顶
  local rx, rz = 21, -12
  cyl(m, base, 14, 15, CF(rx, Y + 7, rz), RGB(206, 206, 200), MAT.Concrete)
  block(m, base, V(15, 15, 15), CF(rx, Y + 14, rz), RGB(214, 214, 208), MAT.Concrete, BALL)
  for _, a in ipairs({ 0, 120, 240 }) do ghostly(block(m, base, V(15.2, 0.6, 0.6), CF(rx, Y + 9 + a / 60, rz) * CFrame.Angles(0, math.rad(a), 0), RGB(170, 170, 166), MAT.Concrete)) end
  -- 汽轮机厂房、连廊
  block(m, base, V(22, 11, 11), CF(-1, Y + 5.5, -16), RGB(96, 120, 150), MAT.Metal)
  block(m, base, V(22.4, 1.2, 11.4), CF(-1, Y + 8.4, -16), C.glass, MAT.Glass)
  block(m, base, V(6, 4, 4), CF(12.5, Y + 6, -14), RGB(170, 170, 166), MAT.Concrete)
  -- 变压器、电线杆
  for k = 0, 2 do
    block(m, base, V(3, 3.4, 2.4), CF(-26 + k * 4.2, Y + 1.7, -18), RGB(110, 116, 110), MAT.Metal)
    for j = 0, 2 do cyl(m, base, 1.4, 0.35, CF(-26.8 + k * 4.2 + j * 0.8, Y + 4.1, -18), RGB(140, 100, 70), MAT.Glass) end
  end
  for _, px in ipairs({ -27, -15 }) do
    block(m, base, V(0.8, 16, 0.8), CF(px, Y + 8, -22.5), RGB(120, 124, 130), MAT.Metal)
    block(m, base, V(7, 0.5, 0.6), CF(px, Y + 15.4, -22.5), RGB(120, 124, 130), MAT.Metal)
  end
  for _, sz in ipairs({ -2.8, 0, 2.8 }) do ghostly(block(m, base, V(12, 0.1, 0.1), CF(-21, Y + 15.9, -22.5 + sz * 0.1), C.dark, MAT.Metal)) end
  -- 辐射警告牌（黄底黑圈）
  for _, sx in ipairs({ -8, 8 }) do
    block(m, base, V(0.3, 4, 0.3), CF(rx + sx, Y + 2, rz + 9.5), RGB(90, 90, 94), MAT.Metal)
    local sign = block(m, base, V(3, 3, 0.2), CF(rx + sx, Y + 4.5, rz + 9.5), RGB(240, 200, 30), MAT.SmoothPlastic)
    ghostly(cyl(m, base, 0.22, 1.6, CF(rx + sx, Y + 4.5, rz + 9.6) * CFrame.Angles(math.rad(90), 0, 0), RGB(30, 30, 30), MAT.SmoothPlastic))
    sign.CastShadow = false
  end
  facadeSign(m, base, CF(-1, Y + 12.2, -10.35), 12, 1.8, "核 电 站", RGB(255, 226, 140), Enum.NormalId.Back)
  return body
end

-- 雷达站：钢架塔顶上一面大雷达天线一直转（天线板、底框、馈源支臂绕塔的竖轴一起转）；白色球形雷达罩、两个设备方舱、带红灯的天线杆
local function radarStation(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(150, 150, 144), MAT.Concrete)
  local Y = 0.6
  local STEEL, WHITE = RGB(120, 124, 130), RGB(232, 232, 226)
  local tz = -3
  for _, o in ipairs({ { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } }) do rod(m, base, V(o[1] * 4.4, Y, tz + o[2] * 4.4), V(o[1] * 1.5, Y + 14, tz + o[2] * 1.5), 0.5, STEEL) end
  for k = 1, 3 do block(m, base, V(8.8 - k * 1.8, 0.35, 8.8 - k * 1.8), CF(0, Y + k * 3.6, tz), STEEL, MAT.Metal) end
  block(m, base, V(4.6, 1.0, 4.6), CF(0, Y + 14.4, tz), RGB(90, 92, 96), MAT.Metal)
  local dc = CF(0, Y + 18.2, tz)
  local piv, up = (base * dc).Position, V(0, 1, 0)
  anim(block(m, base, V(1.8, 1.6, 1.8), CF(0, Y + 15.7, tz), RGB(70, 72, 76), MAT.Metal), "spin", 0.18)
  spinAbout(block(m, base, V(11, 4.6, 0.5), dc * CF(0, 0, -0.9) * CFrame.Angles(math.rad(-14), 0, 0), WHITE, MAT.SmoothPlastic), piv, up, 0.18)
  spinAbout(block(m, base, V(11.4, 0.45, 0.9), dc * CF(0, -2.4, -0.5), STEEL, MAT.Metal), piv, up, 0.18)
  spinAbout(block(m, base, V(0.6, 2.6, 0.6), dc * CF(0, -1.3, 0.2), STEEL, MAT.Metal), piv, up, 0.18)
  spinAbout(block(m, base, V(0.3, 0.3, 4.2), dc * CF(0, 0.3, -3.2), STEEL, MAT.Metal), piv, up, 0.18)
  spinAbout(block(m, base, V(1.0, 1.0, 1.0), dc * CF(0, 0.3, -5.3), RGB(60, 62, 66), MAT.Metal), piv, up, 0.18)
  -- 球形雷达罩
  cyl(m, base, 2.4, 8, CF(8, Y + 1.2, 7), RGB(170, 170, 166), MAT.Concrete)
  block(m, base, V(9, 9, 9), CF(8, Y + 6.2, 7), WHITE, MAT.SmoothPlastic, BALL)
  -- 设备方舱（门、空调外机）
  for i, sz in ipairs({ 8, 2 }) do
    block(m, base, V(6.4, 3.4, 4.2), CF(-7.5, Y + 1.7, sz), RGB(92, 104, 74), MAT.Metal)
    block(m, base, V(1.4, 2.4, 0.15), CF(-7.5 + 1.6, Y + 1.2, sz + 2.15), C.dark, MAT.Metal)
    block(m, base, V(1.4, 1.0, 0.9), CF(-7.5 - 1.8, Y + 0.5, sz + 2.6), RGB(190, 192, 190), MAT.Metal)
    if i == 1 then facadeSign(m, base, CF(-7.5, Y + 2.6, sz + 2.2), 5.6, 1.1, "雷 达 站", RGB(255, 226, 140), Enum.NormalId.Back) end
  end
  -- 天线杆和顶上的红灯
  cyl(m, base, 19, 0.45, CF(10, Y + 9.5, -9), STEEL, MAT.Metal)
  anim(ghostly(block(m, base, V(0.8, 0.8, 0.8), CF(10, Y + 19.3, -9), RGB(255, 40, 30), MAT.Neon)), "blink", 0.8)
  for _, a in ipairs({ 0, 120, 240 }) do
    local r = math.rad(a)
    ghostly(rod(m, base, V(10, Y + 17, -9), V(10 + math.cos(r) * 6, Y, -9 + math.sin(r) * 6), 0.08, C.dark))
  end
  return body
end

-- 导弹发射井：带黄黑警示圈的混凝土台子，中间井口上两扇井盖（DoorL / DoorR：放「巡航导弹」时客户端把它们滑开、冒烟，导弹从井里升空），
--   井里白色的弹头，控制地堡（门、潜望镜、天线、状态灯），四角的警示灯，旁边停着一辆导弹运输车
local function missileSilo(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 1.2, d), CF(0, 0.6, 0), RGB(140, 140, 134), MAT.Concrete)
  local Y = 1.2
  local sx, sz = -2, -3   -- 井口中心
  ghostly(cyl(m, base, 0.06, 15, CF(sx, Y + 0.03, sz), RGB(236, 196, 40), MAT.SmoothPlastic))
  for k = 0, 7 do   -- 警示圈上的黑条
    local a = k * math.pi / 4
    ghostly(block(m, base, V(1.2, 0.08, 3.4), CF(sx + math.cos(a) * 6.6, Y + 0.05, sz + math.sin(a) * 6.6) * CFrame.Angles(0, -a, 0), RGB(30, 30, 30), MAT.SmoothPlastic))
  end
  ghostly(cyl(m, base, 0.1, 10, CF(sx, Y + 0.08, sz), RGB(16, 16, 18), MAT.SmoothPlastic))
  block(m, base, V(2.8, 2.8, 2.8), CF(sx, Y - 0.8, sz), RGB(240, 240, 236), MAT.SmoothPlastic, BALL)
  ghostly(block(m, base, V(1.0, 1.0, 1.0), CF(sx, Y + 0.3, sz), RGB(200, 50, 40), MAT.SmoothPlastic, BALL))
  for _, side in ipairs({ { "DoorL", -1 }, { "DoorR", 1 } }) do
    local x = sx + side[2] * 2.6
    local door = block(m, base, V(5.2, 0.6, 11), CF(x, Y + 0.45, sz), RGB(96, 102, 92), MAT.DiamondPlate)
    door.Name = side[1]
    for _, oz in ipairs({ -3, 0, 3 }) do
      local st = ghostly(block(m, base, V(4.6, 0.06, 1.0), CF(x, Y + 0.78, sz + oz) * CFrame.Angles(0, math.rad(35), 0), RGB(236, 196, 40), MAT.SmoothPlastic))
      st.Name = side[1]
    end
  end
  -- 控制地堡
  local bx, bz = -7, 8.5
  block(m, base, V(9, 4.2, 6.5), CF(bx, Y + 2.1, bz), RGB(120, 124, 112), MAT.Concrete)
  block(m, base, V(9.6, 0.6, 7.1), CF(bx, Y + 4.5, bz), RGB(100, 104, 94), MAT.Concrete)
  block(m, base, V(1.8, 2.8, 0.2), CF(bx + 2.2, Y + 1.4, bz - 3.3), C.dark, MAT.Metal)
  cyl(m, base, 2.6, 0.4, CF(bx - 2.5, Y + 6.1, bz), C.dark, MAT.Metal)
  ghostly(cyl(m, base, 5, 0.12, CF(bx + 3.4, Y + 7.3, bz + 2), C.dark, MAT.Metal))
  anim(ghostly(block(m, base, V(0.6, 0.4, 0.12), CF(bx - 1.2, Y + 2.9, bz - 3.3), RGB(90, 255, 120), MAT.Neon)), "blink", 1.2)
  facadeSign(m, base, CF(bx, Y + 3.3, bz - 3.35), 7, 1.1, "导弹发射井", RGB(255, 226, 140), Enum.NormalId.Front)
  -- 四角警示灯
  for _, o in ipairs({ { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } }) do
    cyl(m, base, 1.4, 0.6, CF(o[1] * (w / 2 - 1.2), Y + 0.7, o[2] * (d / 2 - 1.2)), RGB(80, 80, 84), MAT.Metal)
    anim(ghostly(block(m, base, V(0.7, 0.7, 0.7), CF(o[1] * (w / 2 - 1.2), Y + 1.7, o[2] * (d / 2 - 1.2)), RGB(255, 120, 30), MAT.Neon)), "blink", 1.4)
  end
  -- 导弹运输车（车头朝 −Z，车上一根发射筒）
  local tx, tz = 8.5, 4
  for _, ox in ipairs({ -1.6, 1.6 }) do
    for _, oz in ipairs({ -4.2, -1.6, 1.6, 4.2 }) do block(m, base, V(0.8, 2.0, 2.0), CF(tx + ox, Y + 1.0, tz + oz), RGB(30, 30, 32), MAT.SmoothPlastic, CYL) end
  end
  block(m, base, V(3.6, 0.8, 12), CF(tx, Y + 1.9, tz), RGB(60, 66, 52), MAT.Metal)
  block(m, base, V(3.4, 2.6, 2.8), CF(tx, Y + 3.6, tz - 5.2), RGB(84, 96, 64), MAT.Metal)
  block(m, base, V(3.0, 1.0, 0.2), CF(tx, Y + 4.2, tz - 6.65), RGB(60, 90, 110), MAT.Glass)
  block(m, base, V(9.6, 2.2, 2.2), CF(tx, Y + 3.6, tz + 1.2) * CFrame.Angles(0, math.pi / 2, 0), RGB(84, 96, 64), MAT.Metal, CYL)
  block(m, base, V(0.3, 2.3, 2.3), CF(tx, Y + 3.6, tz + 6.0) * CFrame.Angles(0, math.pi / 2, 0), RGB(60, 62, 56), MAT.Metal, CYL)
  return body
end

---------------------------------------------------------------- 重生开放的新区域：港口区、导弹基地、航天中心

-- 一排集装箱（两层、颜色随机）
local CONT = { RGB(176, 64, 48), RGB(52, 104, 160), RGB(214, 160, 40), RGB(70, 130, 80), RGB(150, 150, 154), RGB(200, 96, 40) }
local function containers(m, base, x0, z, n, rng)
  for i = 0, n - 1 do
    for tier = 0, (rng:NextNumber() < 0.6) and 1 or 0 do
      local c = CONT[rng:NextInteger(1, #CONT)]
      block(m, base, V(5.8, 5.2, 2.6), CF(x0 + i * 6.2, 0.6 + 2.6 + tier * 5.3, z), c, MAT.CorrodedMetal)
    end
  end
end

-- 码头仓库：瓦楞铁皮的大仓库（两扇卷帘门、屋顶天窗）、门口两排集装箱、一台叉车、系船柱
local function dockWarehouse(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  local rng = Random.new(301)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(150, 150, 144), MAT.Concrete)
  local Y = 0.6
  local hw, hd = w * 0.6, d * 0.86
  local wx = -w / 2 + hw / 2 + 1
  block(m, base, V(hw, h - 1.5, hd), CF(wx, Y + (h - 1.5) / 2, 0), RGB(170, 160, 140), MAT.CorrodedMetal)
  block(m, base, V(hw + 1, 1, hd + 1), CF(wx, Y + h - 1, 0), RGB(96, 100, 104), MAT.Metal)
  for _, oz in ipairs({ -hd * 0.22, hd * 0.22 }) do
    block(m, base, V(0.3, h * 0.55, hd * 0.3), CF(wx + hw / 2 + 0.1, Y + h * 0.275, oz), RGB(70, 74, 78), MAT.DiamondPlate)
  end
  for k = -1, 1 do block(m, base, V(hw * 0.7, 0.4, 2), CF(wx, Y + h - 0.4, k * hd * 0.28), C.glass, MAT.Glass) end
  facadeSign(m, base, CF(wx + hw / 2 + 0.25, Y + h * 0.78, 0) * CFrame.Angles(0, math.pi / 2, 0), 14, 2.2, "码 头 仓 库", RGB(255, 226, 140))
  local cx = wx + hw / 2 + 4
  containers(m, base, cx, d * 0.32, 2, rng)
  containers(m, base, cx, -d * 0.36, 2, rng)
  -- 叉车：车身、门架、货叉
  local fx, fz = cx + 3, 0
  block(m, base, V(2.4, 1.6, 3.6), CF(fx, Y + 1.4, fz), RGB(236, 180, 30), MAT.Metal)
  block(m, base, V(2.2, 1.6, 0.3), CF(fx, Y + 2.9, fz + 0.6), C.dark, MAT.Metal)
  block(m, base, V(0.3, 4.2, 0.3), CF(fx - 0.9, Y + 2.7, fz - 1.9), C.dark, MAT.Metal)
  block(m, base, V(0.3, 4.2, 0.3), CF(fx + 0.9, Y + 2.7, fz - 1.9), C.dark, MAT.Metal)
  block(m, base, V(2.2, 0.2, 2.2), CF(fx, Y + 0.9, fz - 3), C.dark, MAT.Metal)
  for _, ox in ipairs({ -w / 2 + 4, 0, w / 2 - 4 }) do cyl(m, base, 1.4, 1.2, CF(ox, Y + 0.7, -d / 2 + 1.5), RGB(40, 40, 42), MAT.Metal) end
  return body
end

-- 造船厂：干船坞里一条造了一半的军舰（灰色船体、上层建筑、炮塔）、跨在船坞上的龙门吊（小车来回、顶上红灯）
local function shipyard(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(140, 140, 136), MAT.Concrete)
  local Y = 0.6
  -- 船坞：两边的坞墙、坞底
  block(m, base, V(w * 0.9, 0.2, d * 0.5), CF(0, Y + 0.1, 0), RGB(60, 64, 70), MAT.Concrete)
  for _, sz in ipairs({ -1, 1 }) do block(m, base, V(w * 0.9, 3, 2), CF(0, Y + 1.5, sz * d * 0.26), RGB(120, 120, 116), MAT.Concrete) end
  -- 船：船体（船头收窄）、甲板、舰桥、桅杆、主炮
  local HULL = RGB(120, 128, 136)
  block(m, base, V(w * 0.62, 4.2, d * 0.3), CF(-w * 0.06, Y + 2.3, 0), HULL, MAT.Metal)
  block(m, base, V(w * 0.16, 4.2, d * 0.21), CF(w * 0.31, Y + 2.3, 0), HULL, MAT.Metal)
  block(m, base, V(w * 0.08, 4.2, d * 0.11), CF(w * 0.42, Y + 2.3, 0), HULL, MAT.Metal)
  block(m, base, V(w * 0.86, 0.3, d * 0.3), CF(w * 0.05, Y + 4.55, 0), RGB(96, 100, 104), MAT.Metal)
  block(m, base, V(w * 0.18, 5, d * 0.2), CF(-w * 0.12, Y + 7.2, 0), RGB(150, 156, 162), MAT.Metal)
  block(m, base, V(w * 0.12, 3, d * 0.16), CF(-w * 0.14, Y + 11.2, 0), RGB(150, 156, 162), MAT.Metal)
  block(m, base, V(w * 0.12, 0.8, d * 0.165), CF(-w * 0.14, Y + 11.6, 0), C.glass, MAT.Glass)
  cyl(m, base, 8, 0.5, CF(-w * 0.14, Y + 16.6, 0), C.metal, MAT.Metal)
  block(m, base, V(3.2, 1.6, 3.2), CF(w * 0.22, Y + 5.5, 0), RGB(140, 146, 152), MAT.Metal)
  block(m, base, V(4, 0.4, 0.4), CF(w * 0.22 + 2.4, Y + 5.7, 0), C.gun, MAT.Metal)
  -- 焊花（一闪一闪）
  for _, p in ipairs({ { w * 0.1, 3.5 }, { -w * 0.3, 2.6 } }) do anim(ghostly(block(m, base, V(0.7, 0.7, 0.7), CF(p[1], Y + p[2], d * 0.15 + 0.4), RGB(180, 220, 255), MAT.Neon)), "blink", 2.6) end
  -- 龙门吊：两条腿、横梁、小车、吊钩
  local GY = RGB(236, 180, 30)
  for _, sx in ipairs({ -1, 1 }) do
    for _, sz in ipairs({ -1, 1 }) do block(m, base, V(1.4, h - 2, 1.4), CF(sx * w * 0.2, Y + (h - 2) / 2, sz * d * 0.4), GY, MAT.Metal) end
    block(m, base, V(1.6, 1.6, d * 0.84), CF(sx * w * 0.2, Y + h - 1.4, 0), GY, MAT.Metal)
  end
  block(m, base, V(w * 0.44, 1.8, 2), CF(0, Y + h - 0.2, 0), GY, MAT.Metal)
  block(m, base, V(3, 1.6, 3), CF(w * 0.05, Y + h - 1.8, 0), C.dark, MAT.Metal)
  ghostly(block(m, base, V(0.15, 8, 0.15), CF(w * 0.05, Y + h - 6.6, 0), C.dark, MAT.Metal))
  block(m, base, V(1.2, 1, 1.2), CF(w * 0.05, Y + h - 11, 0), GY, MAT.Metal)
  for _, sx in ipairs({ -1, 1 }) do anim(ghostly(block(m, base, V(0.8, 0.8, 0.8), CF(sx * w * 0.2, Y + h + 0.4, 0), RGB(255, 40, 30), MAT.Neon)), "blink", 0.8) end
  facadeSign(m, base, CF(0, Y + 4, -d / 2 + 0.6), 14, 2.2, "造 船 厂", RGB(255, 226, 140), Enum.NormalId.Front)
  return body
end

-- 海军司令部：白楼蓝腰线、玻璃大门、楼顶转的雷达、两根旗杆、门口的锚
local function navalHQ(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(160, 160, 156), MAT.Concrete)
  local Y = 0.6
  local WH, BL = RGB(236, 238, 240), RGB(40, 80, 150)
  block(m, base, V(w * 0.9, h * 0.62, d * 0.7), CF(0, Y + h * 0.31, 0), WH, MAT.SmoothPlastic)
  block(m, base, V(w * 0.92, 1.4, d * 0.72), CF(0, Y + h * 0.22, 0), BL, MAT.SmoothPlastic)
  block(m, base, V(w * 0.92, 1, d * 0.72), CF(0, Y + h * 0.62, 0), RGB(200, 204, 208), MAT.Concrete)
  for k = -2, 2 do block(m, base, V(w * 0.1, h * 0.18, 0.2), CF(k * w * 0.17, Y + h * 0.43, -d * 0.35 - 0.05), C.glass, MAT.Glass) end
  block(m, base, V(w * 0.3, h * 0.3, d * 0.4), CF(0, Y + h * 0.77, 0), WH, MAT.SmoothPlastic)
  block(m, base, V(w * 0.2, h * 0.22, 0.4), CF(0, Y + h * 0.13, -d * 0.35 - 0.1), C.glass, MAT.Glass)
  -- 雷达：杆子 + 转的天线
  local rx, rz = w * 0.08, 0
  cyl(m, base, 6, 0.8, CF(rx, Y + h * 0.92 + 3, rz), C.metal, MAT.Metal)
  local piv = (base * CF(rx, 0, rz)).Position
  spinAbout(block(m, base, V(9, 1.6, 0.6), CF(rx, Y + h * 0.92 + 6.4, rz), RGB(220, 222, 226), MAT.Metal), piv, V(0, 1, 0), 0.25)
  spinAbout(block(m, base, V(1, 1, 1.6), CF(rx, Y + h * 0.92 + 6.4, rz - 0.8), C.dark, MAT.Metal), piv, V(0, 1, 0), 0.25)
  for _, sx in ipairs({ -1, 1 }) do flag(m, base, CF(sx * w * 0.42, 0, -d * 0.45), (sx < 0) and BL or RGB(200, 40, 40)) end
  -- 锚：竖杆、横杆、两个爪
  local ax, az = -w * 0.3, -d * 0.45
  block(m, base, V(0.6, 4, 0.6), CF(ax, Y + 2.6, az), C.dark, MAT.Metal)
  block(m, base, V(3, 0.5, 0.5), CF(ax, Y + 3.8, az), C.dark, MAT.Metal)
  block(m, base, V(3.6, 0.5, 0.5), CF(ax, Y + 0.9, az), C.dark, MAT.Metal)
  facadeSign(m, base, CF(0, Y + h * 0.53, -d * 0.35 - 0.2), 14, 2, "海 军 司 令 部", RGB(255, 230, 150), Enum.NormalId.Front)
  return body
end

-- 推进剂工厂：三个球形储罐（支腿、黄黑警示带）、管廊、控制楼、火炬（一直烧着）
local function propellantPlant(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(150, 146, 136), MAT.Concrete)
  local Y = 0.6
  for i, tx in ipairs({ -w * 0.3, 0, w * 0.3 }) do
    local tz, r = d * 0.12, 11 - i
    for _, o in ipairs({ { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } }) do block(m, base, V(0.6, r * 0.7, 0.6), CF(tx + o[1] * r * 0.32, Y + r * 0.35, tz + o[2] * r * 0.32), C.metal, MAT.Metal) end
    block(m, base, V(r, r, r), CF(tx, Y + r * 0.62 + r * 0.3, tz), RGB(236, 236, 232), MAT.SmoothPlastic, BALL)
    ghostly(block(m, base, V(r + 0.2, 0.5, r + 0.2), CF(tx, Y + r * 0.62 + r * 0.3, tz), RGB(236, 190, 40), MAT.SmoothPlastic, CYL) )
  end
  -- 管廊
  block(m, base, V(w * 0.85, 0.6, 0.6), CF(0, Y + 4.5, -d * 0.18), RGB(170, 60, 50), MAT.Metal)
  block(m, base, V(w * 0.85, 0.6, 0.6), CF(0, Y + 5.4, -d * 0.18), RGB(60, 110, 170), MAT.Metal)
  for k = -2, 2 do block(m, base, V(0.5, 5.4, 0.5), CF(k * w * 0.2, Y + 2.7, -d * 0.18), C.metal, MAT.Metal) end
  -- 控制楼
  block(m, base, V(12, 6, 8), CF(-w * 0.3, Y + 3, -d * 0.36), RGB(200, 196, 186), MAT.Concrete)
  block(m, base, V(12.2, 1.2, 8.2), CF(-w * 0.3, Y + 4.4, -d * 0.36), C.glass, MAT.Glass)
  facadeSign(m, base, CF(-w * 0.3, Y + 7, -d * 0.36 - 4.2), 12, 1.8, "推 进 剂 工 厂", RGB(255, 226, 140), Enum.NormalId.Front)
  -- 火炬
  local fx, fz = w * 0.38, -d * 0.36
  cyl(m, base, h, 1, CF(fx, Y + h / 2, fz), C.metal, MAT.Metal)
  local fl = anim(ghostly(block(m, base, V(1.6, 2.4, 1.6), CF(fx, Y + h + 1.2, fz), RGB(255, 140, 40), MAT.Neon, BALL)), "blink", 3)
  local fire = Instance.new("Fire")
  fire.Size = 4
  fire.Heat = 9
  fire.Parent = fl
  return body
end

-- 导弹总装厂：高大的总装厂房（带黄黑条的大门、天窗）、门口运输车上一枚整弹（弹体、弹头、尾翼）
local function missileAssembly(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(146, 146, 140), MAT.Concrete)
  local Y = 0.6
  local hz = d * 0.12
  block(m, base, V(w * 0.86, h - 2, d * 0.62), CF(0, Y + (h - 2) / 2, hz), RGB(178, 176, 166), MAT.Concrete)
  block(m, base, V(w * 0.88, 1.2, d * 0.64), CF(0, Y + h - 1.4, hz), RGB(110, 112, 116), MAT.Metal)
  block(m, base, V(w * 0.44, h * 0.62, 0.4), CF(0, Y + h * 0.31, hz - d * 0.31 - 0.1), RGB(70, 74, 80), MAT.DiamondPlate)
  for k = 0, 5 do
    ghostly(block(m, base, V(1.4, h * 0.62, 0.1), CF(-w * 0.2 + k * w * 0.08, Y + h * 0.31, hz - d * 0.31 - 0.35), (k % 2 == 0) and RGB(236, 190, 40) or RGB(30, 30, 30), MAT.SmoothPlastic))
  end
  facadeSign(m, base, CF(0, Y + h * 0.78, hz - d * 0.31 - 0.3), 16, 2.4, "导 弹 总 装 厂", RGB(255, 226, 140), Enum.NormalId.Front)
  -- 运输车 + 导弹
  local tx, tz = w * 0.18, -d * 0.36
  block(m, base, V(22, 1.4, 4), CF(tx, Y + 1.6, tz), RGB(70, 84, 60), MAT.Metal)
  block(m, base, V(4, 3.4, 4), CF(tx + 12, Y + 2.6, tz), RGB(78, 94, 66), MAT.Metal)
  for k = 0, 4 do
    for _, sz in ipairs({ -1.9, 1.9 }) do block(m, base, V(1.8, 1.8, 0.8), CF(tx - 9 + k * 5, Y + 0.9, tz + sz), RGB(30, 30, 32), MAT.SmoothPlastic, CYL) end
  end
  local MS = RGB(228, 230, 226)
  block(m, base, V(18, 2.6, 2.6), CF(tx - 1, Y + 3.8, tz), MS, MAT.SmoothPlastic, CYL)
  block(m, base, V(2.6, 2.6, 2.6), CF(tx + 8.2, Y + 3.8, tz), RGB(60, 64, 60), MAT.SmoothPlastic, BALL)
  for _, a in ipairs({ 0, math.pi / 2 }) do block(m, base, V(2.4, 4.4, 0.2), CF(tx - 9, Y + 3.8, tz) * CFrame.Angles(a, 0, 0), RGB(60, 64, 60), MAT.Metal) end
  ghostly(block(m, base, V(2, 0.1, 2.7), CF(tx + 3, Y + 5.1, tz), RGB(200, 40, 40), MAT.SmoothPlastic))
  return body
end

-- 战略导弹营：两辆起竖的导弹发射车（发射筒斜着竖起来）、半埋的指挥掩体、伪装网
local function strategicBattalion(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(126, 130, 116), MAT.Concrete)
  local Y = 0.6
  local GR = RGB(70, 84, 58)
  for i, tx in ipairs({ -w * 0.22, w * 0.22 }) do
    local tz = d * 0.05
    block(m, base, V(4.4, 1.6, 20), CF(tx, Y + 2, tz), GR, MAT.Metal)
    block(m, base, V(4.4, 3.2, 4), CF(tx, Y + 2.6, tz - 10.5), RGB(80, 96, 64), MAT.Metal)
    block(m, base, V(4.2, 1, 0.2), CF(tx, Y + 3.4, tz - 12.55), C.glass, MAT.Glass)
    for k = 0, 3 do
      for _, sx in ipairs({ -2.3, 2.3 }) do block(m, base, V(0.9, 2, 2), CF(tx + sx, Y + 1, tz - 7 + k * 4.6), RGB(30, 30, 32), MAT.SmoothPlastic, CYL) end
    end
    local ang = (i == 1) and math.rad(62) or math.rad(40)   -- 一辆竖着，一辆在起竖
    block(m, base, V(2.8, 2.8, 18), CF(tx, Y + 3.2, tz + 6) * CFrame.Angles(ang, 0, 0) * CF(0, 0, -6), RGB(96, 110, 80), MAT.Metal)
    ghostly(block(m, base, V(2.9, 0.4, 0.4), CF(tx, Y + 3.2, tz + 6) * CFrame.Angles(ang, 0, 0) * CF(0, 1.5, -10), RGB(200, 40, 40), MAT.SmoothPlastic))
  end
  -- 掩体
  block(m, base, V(12, 4, 8), CF(0, Y + 2, -d * 0.38), RGB(120, 124, 110), MAT.Concrete)
  block(m, base, V(13, 0.8, 9), CF(0, Y + 4.4, -d * 0.38), RGB(100, 104, 92), MAT.Concrete)
  block(m, base, V(2.4, 2.8, 0.2), CF(0, Y + 1.4, -d * 0.38 - 4.05), C.dark, MAT.Metal)
  anim(ghostly(block(m, base, V(0.6, 0.4, 0.12), CF(1.8, Y + 3, -d * 0.38 - 4.05), RGB(90, 255, 120), MAT.Neon)), "blink", 1.1)
  local net = block(m, base, V(w * 0.9, 0.3, d * 0.5), CF(0, Y + 13.5, d * 0.08), RGB(80, 98, 58), MAT.Fabric)
  net.Transparency = 0.35
  for _, o in ipairs({ { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } }) do cyl(m, base, 13.5, 0.4, CF(o[1] * w * 0.44, Y + 6.75, d * 0.08 + o[2] * d * 0.24), RGB(90, 74, 50), MAT.Wood) end
  facadeSign(m, base, CF(0, Y + 6.2, -d * 0.38 - 4.6), 12, 1.8, "战 略 导 弹 营", RGB(255, 226, 140), Enum.NormalId.Front)
  return body
end

-- 卫星工厂：白色洁净厂房（一排窗、蓝色腰线）、屋顶一颗卫星样机（本体、两块太阳能板）、旁边三面测试天线
local function satelliteFactory(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(176, 178, 182), MAT.Concrete)
  local Y = 0.6
  local WH = RGB(240, 242, 246)
  block(m, base, V(w * 0.72, h * 0.6, d * 0.7), CF(-w * 0.1, Y + h * 0.3, 0), WH, MAT.SmoothPlastic)
  block(m, base, V(w * 0.73, 1, d * 0.71), CF(-w * 0.1, Y + h * 0.2, 0), RGB(50, 110, 200), MAT.SmoothPlastic)
  for k = -3, 3 do block(m, base, V(w * 0.06, h * 0.14, 0.2), CF(-w * 0.1 + k * w * 0.09, Y + h * 0.42, -d * 0.35 - 0.05), C.glass, MAT.Glass) end
  -- 卫星样机
  local sx, sy = -w * 0.1, Y + h * 0.6
  block(m, base, V(4, 4, 4), CF(sx, sy + 2.6, 0), RGB(214, 170, 60), MAT.Foil)
  for _, o in ipairs({ -1, 1 }) do
    block(m, base, V(8, 0.2, 3.4), CF(sx + o * 6.4, sy + 2.6, 0), RGB(30, 50, 110), MAT.Glass)
    block(m, base, V(1.6, 0.2, 0.2), CF(sx + o * 2.6, sy + 2.6, 0), C.metal, MAT.Metal)
  end
  cyl(m, base, 0.6, 2.6, CF(sx, sy + 4.9, 0), RGB(230, 230, 230), MAT.SmoothPlastic)
  -- 测试天线（碗朝天，慢慢转）
  for i, ax in ipairs({ w * 0.32, w * 0.32, w * 0.42 }) do
    local az = (i == 1) and -d * 0.25 or ((i == 2) and d * 0.2 or -d * 0.02)
    cyl(m, base, 4, 0.8, CF(ax, Y + 2, az), C.metal, MAT.Metal)
    local dish = block(m, base, V(0.6, 6, 6), CF(ax, Y + 5, az) * CFrame.Angles(0, 0, math.rad(60)), RGB(236, 236, 232), MAT.SmoothPlastic, CYL)
    spinAbout(dish, (base * CF(ax, 0, az)).Position, V(0, 1, 0), 0.05 + i * 0.02)
  end
  facadeSign(m, base, CF(-w * 0.1, Y + h * 0.53, -d * 0.35 - 0.2), 14, 2, "卫 星 工 厂", RGB(120, 200, 255), Enum.NormalId.Front)
  return body
end

-- 火箭发射台：混凝土台、导流槽、钢架发射塔（顶上红灯、摆杆）、一枚立着的运载火箭（芯级、两个助推器、整流罩）
local function launchPad(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 1.2, d), CF(0, 0.6, 0), RGB(160, 160, 156), MAT.Concrete)
  local Y = 1.2
  block(m, base, V(w * 0.3, 0.2, d * 0.9), CF(0, Y + 0.05, 0), RGB(40, 40, 42), MAT.Concrete)
  -- 发射塔
  local tx, tz, tw = w * 0.28, 0, 6
  local ST = RGB(200, 70, 40)
  for _, o in ipairs({ { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } }) do block(m, base, V(0.8, h, 0.8), CF(tx + o[1] * tw / 2, Y + h / 2, tz + o[2] * tw / 2), ST, MAT.Metal) end
  for y = 6, h - 4, 8 do
    block(m, base, V(tw, 0.5, 0.5), CF(tx, Y + y, tz - tw / 2), ST, MAT.Metal)
    block(m, base, V(tw, 0.5, 0.5), CF(tx, Y + y, tz + tw / 2), ST, MAT.Metal)
    block(m, base, V(0.5, 0.5, tw), CF(tx - tw / 2, Y + y, tz), ST, MAT.Metal)
    block(m, base, V(0.5, 0.5, tw), CF(tx + tw / 2, Y + y, tz), ST, MAT.Metal)
  end
  for _, y in ipairs({ h * 0.45, h * 0.78 }) do block(m, base, V(tx - 4, 0.8, 1.6), CF(tx / 2 + 1, Y + y, tz), RGB(170, 170, 166), MAT.Metal) end
  anim(ghostly(block(m, base, V(1.2, 1.2, 1.2), CF(tx, Y + h + 0.6, tz), RGB(255, 40, 30), MAT.Neon)), "blink", 0.7)
  -- 火箭
  local RW = RGB(240, 240, 236)
  local rh = h * 0.86
  cyl(m, base, rh * 0.8, 6, CF(0, Y + 1 + rh * 0.4, 0), RW, MAT.SmoothPlastic)
  for _, k in ipairs({ { 0.86, 5.4 }, { 0.92, 4.2 }, { 0.97, 2.6 } }) do cyl(m, base, rh * 0.06, k[2], CF(0, Y + 1 + rh * k[1], 0), RW, MAT.SmoothPlastic) end
  block(m, base, V(2, 2, 2), CF(0, Y + 1 + rh, 0), RW, MAT.SmoothPlastic, BALL)
  for _, y in ipairs({ 0.25, 0.55 }) do cyl(m, base, 1.2, 6.1, CF(0, Y + 1 + rh * y, 0), RGB(30, 30, 32), MAT.SmoothPlastic) end
  for _, sx in ipairs({ -1, 1 }) do
    cyl(m, base, rh * 0.4, 2.8, CF(sx * 4.4, Y + 1 + rh * 0.2, 0), RW, MAT.SmoothPlastic)
    block(m, base, V(2.8, 2.8, 2.8), CF(sx * 4.4, Y + 1 + rh * 0.4, 0), RW, MAT.SmoothPlastic, BALL)
  end
  ghostly(block(m, base, V(0.2, rh * 0.3, 3), CF(-3.05, Y + 1 + rh * 0.5, 0), RGB(200, 40, 40), MAT.SmoothPlastic))
  facadeSign(m, base, CF(0, Y + 3, -d / 2 + 0.6), 14, 2.2, "火 箭 发 射 台", RGB(120, 200, 255), Enum.NormalId.Front)
  return body
end

-- 太空指挥中心：玻璃幕墙的指挥楼、半个圆顶、屋顶一面大天线（慢慢转）、天线杆
local function spaceCommand(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local body = hiddenBody(m, base, w, h, d)
  block(m, base, V(w, 0.6, d), CF(0, 0.3, 0), RGB(176, 178, 182), MAT.Concrete)
  local Y = 0.6
  block(m, base, V(w * 0.8, h * 0.45, d * 0.6), CF(0, Y + h * 0.225, d * 0.05), RGB(60, 70, 86), MAT.Metal)
  block(m, base, V(w * 0.81, h * 0.36, d * 0.605), CF(0, Y + h * 0.24, d * 0.05), RGB(90, 150, 200), MAT.Glass)
  block(m, base, V(w * 0.82, 1, d * 0.62), CF(0, Y + h * 0.45, d * 0.05), RGB(220, 222, 226), MAT.Concrete)
  block(m, base, V(w * 0.5, w * 0.5, w * 0.5), CF(-w * 0.12, Y + h * 0.45, d * 0.05), RGB(236, 238, 242), MAT.SmoothPlastic, BALL)
  -- 大天线：底座、斜着的碗、馈源
  local ax, az = w * 0.24, d * 0.05
  local piv = (base * CF(ax, 0, az)).Position
  cyl(m, base, 4, 2, CF(ax, Y + h * 0.45 + 2, az), C.metal, MAT.Metal)
  spinAbout(block(m, base, V(0.8, 11, 11), CF(ax, Y + h * 0.45 + 8, az) * CFrame.Angles(0, 0, math.rad(55)), RGB(240, 240, 236), MAT.SmoothPlastic, CYL), piv, V(0, 1, 0), 0.04)
  spinAbout(block(m, base, V(0.4, 0.4, 5), CF(ax + 2, Y + h * 0.45 + 10, az), C.dark, MAT.Metal), piv, V(0, 1, 0), 0.04)
  cyl(m, base, 9, 0.4, CF(-w * 0.36, Y + h * 0.45 + 4.5, -d * 0.1), C.metal, MAT.Metal)
  anim(ghostly(block(m, base, V(0.8, 0.8, 0.8), CF(-w * 0.36, Y + h * 0.45 + 9.2, -d * 0.1), RGB(255, 40, 30), MAT.Neon)), "blink", 0.9)
  facadeSign(m, base, CF(0, Y + h * 0.53, d * 0.05 - d * 0.3 - 0.2), 16, 2.2, "太 空 指 挥 中 心", RGB(120, 200, 255), Enum.NormalId.Front)
  return body
end

-- 新区域的地皮：开放了的铺地面、北边一条路接南门外的大路、竖区域名（港口区还有伸进湖里的码头）；
-- 没开放的围一圈铁丝网，路边立块牌子「第 n 次重生开放」，摆几个路障
function Models.area(f, origin, a, open, team)
  local base = CF(origin)
  local w, d = a.x1 - a.x0, a.z1 - a.z0
  local cx, cz = (a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2
  local g = Instance.new("Folder")
  g.Name = "Area_" .. a.id
  if open then
    local col = (a.id == "port") and RGB(146, 148, 146) or ((a.id == "missile") and RGB(138, 136, 124) or RGB(178, 180, 186))
    block(g, base, V(w, 1, d), CF(cx, 0.5, cz), col, MAT.Concrete)
    ghostly(block(g, base, V(w - 6, 0.08, 10), CF(cx, 1.04, a.z1 - 8), C.asphalt, MAT.Asphalt))
    for x = a.x0 + 10, a.x1 - 10, 14 do ghostly(block(g, base, V(6, 0.06, 0.5), CF(x, 1.1, a.z1 - 8), C.white, MAT.SmoothPlastic)) end
    for _, x in ipairs({ a.x0 + 3, a.x1 - 3 }) do ghostly(block(g, base, V(0.6, 0.06, d - 4), CF(x, 1.06, cz), a.color, MAT.Neon)) end
    if a.id == "port" then   -- 码头：木栈桥伸进湖里、系船柱、一条小艇
      block(g, base, V(16, 1, 50), CF(0, 0.6, a.z0 - 24), RGB(122, 92, 62), MAT.WoodPlanks)
      for k = 0, 4 do
        for _, sx in ipairs({ -7, 7 }) do block(g, base, V(1, 8, 1), CF(sx, -2.8, a.z0 - 4 - k * 11), RGB(104, 78, 54), MAT.Wood) end
      end
      for k = 0, 3 do cyl(g, base, 1.4, 1.2, CF(7.4, 1.8, a.z0 - 8 - k * 12), RGB(40, 40, 42), MAT.Metal) end
      block(g, base, V(5, 2.4, 16), CF(13, -2.2, a.z0 - 30), RGB(120, 128, 136), MAT.Metal)
      block(g, base, V(3.4, 2, 4), CF(13, -0.2, a.z0 - 27), RGB(200, 204, 208), MAT.SmoothPlastic)
    end
    zoneLabel(g, base, CF(cx, 34, cz), a.name, a.color:Lerp(Color3.new(1, 1, 1), 0.35))
  else
    local POST, MESH = RGB(84, 86, 90), RGB(150, 156, 160)
    local function fence(x0, z0, x1, z1)
      local p0, p1 = V(x0, 0, z0), V(x1, 0, z1)
      local len = (p1 - p0).Magnitude
      local mid = (p0 + p1) / 2
      local rot = CFrame.lookAt(mid, p1)
      rot = rot - rot.Position
      local mesh = block(g, base, V(0.15, 5, len), CF(mid + V(0, 3.5, 0)) * rot, MESH, MAT.SmoothPlastic)
      mesh.Transparency = 0.8
      ghostly(block(g, base, V(0.2, 0.2, len), CF(mid + V(0, 6.2, 0)) * rot, POST, MAT.Metal))
      local n = math.max(1, math.floor(len / 18))
      for k = 0, n do cyl(g, base, 6.4, 0.45, CF(p0:Lerp(p1, k / n) + V(0, 4.2, 0)), POST, MAT.Metal) end
    end
    fence(a.x0, a.z1, a.x1, a.z1)
    fence(a.x0, a.z0, a.x1, a.z0)
    fence(a.x0, a.z0, a.x0, a.z1)
    fence(a.x1, a.z0, a.x1, a.z1)
    -- 路边的牌子（朝北，对着路）
    for _, x in ipairs({ cx - 10, cx + 10 }) do block(g, base, V(0.5, 9, 0.5), CF(x, 5.5, a.z1 + 3), POST, MAT.Metal) end
    local board = block(g, base, V(24, 7, 0.4), CF(cx, 9, a.z1 + 3), RGB(28, 32, 38), MAT.SmoothPlastic)
    local sg = Instance.new("SurfaceGui")
    sg.Face = Enum.NormalId.Back
    sg.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
    sg.PixelsPerStud = 24
    sg.LightInfluence = 0
    sg.Parent = board
    local t = Instance.new("TextLabel")
    t.Size = UDim2.fromScale(1, 1)
    t.BackgroundTransparency = 1
    t.Font = Enum.Font.GothamBlack
    t.TextScaled = true
    t.RichText = true
    t.TextColor3 = a.color:Lerp(Color3.new(1, 1, 1), 0.4)
    t.Text = a.name .. "\n<font size=\"40\" color=\"#FFD24A\">第 " .. a.n .. " 次重生开放</font>"
    t.Parent = sg
    for k = -2, 2 do   -- 红白路障
      block(g, base, V(4, 1.4, 0.6), CF(cx + k * 6, 1.7, a.z1 - 1.5), (k % 2 == 0) and RGB(220, 50, 40) or C.white, MAT.SmoothPlastic)
    end
    zoneLabel(g, base, CF(cx, 30, cz), a.name .. "（第 " .. a.n .. " 次重生开放）", RGB(200, 200, 200))
  end
  g.Parent = f
  return g
end

local IND = { oil1 = oilWell, oil2 = oilWell, oil3 = oilWell, refinery = refinery, ammo = ammoPlant, steel = steelMill, mine = mine, nuclear = nuclear,
  radar = radarStation, silo = missileSilo, dock = dockWarehouse, shipyard = shipyard, navalhq = navalHQ, propellant = propellantPlant, assembly = missileAssembly,
  strategic = strategicBattalion, satfac = satelliteFactory, launchpad = launchPad, spacecmd = spaceCommand }
Models.IND = IND

local KIND = { house = house, factory = factory, power = power, bank = bank, hq = hq }
local MIL = { barracks = barracks, tankfac = hangar, aafac = aaShop, artyfac = artyPos, helipad = helipad, airbase = airbase }

-- 建筑：pos 是地面中心（基地地面顶上）；返回 model、主体零件（挂牌子、提示用）
function Models.building(parent, b, pos, team, builtAt, lv)
  local m = Instance.new("Model")
  m.Name = b.id
  if lv and lv > 1 then   -- 升过级的：照升级后的大小画（居民楼、工厂、银行更高）
    b = table.clone(b)
    b.size = Config.SizeAt(b, lv)
  end
  local f = IND[b.id] or KIND[b.kind]
  if b.kind == "mil" then f = MIL[b.id] or barracks end
  if not f then f = house end
  local body = f(m, CF(pos), b, team)
  body.Name = "Body"
  m.PrimaryPart = body
  if builtAt then m:SetAttribute("BuiltAt", builtAt) end   -- 刚盖的：客户端播「从地里升起来」（属性在放进场景前设好，和模型一起到客户端）
  m.Parent = parent
  return m, body
end

-- 购买按钮：建筑位置上一个全息虚影，前面（−Z 那边）一个发光的圆按钮，踩上去或按 E 就买
function Models.pad(parent, b, pos, team)
  local m = Instance.new("Model")
  m.Name = "Pad_" .. b.id
  local base = CF(pos)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local ghost = ghostly(block(m, base, V(w, h, d), CF(0, h / 2, 0), team, MAT.ForceField))
  ghost.CastShadow = false
  local px, pz = 0, -d / 2 - 6
  if b.pad then px, pz = b.pad[1], b.pad[2] end
  local pad = block(m, base, V(0.7, 7, 7), CF(px, 0.35, pz) * UP, C.green, MAT.Neon, CYL)
  pad.Name = "Pad"
  local desc = ""
  if b.income then desc = "收入 +" .. Config.Fmt(b.income) .. "/秒"
  elseif b.kind == "mil" then desc = Models.milDesc(b)
  elseif b.kind == "hq" then desc = "部队上限 " .. b.cap[1]
  elseif b.kind == "power" then desc = "工厂收入 ×" .. Config.PowerBoost
  end
  if b.kind == "radar" then desc = "支援技能冷却 -" .. math.floor((1 - Config.RadarCD) * 100 + 0.5) .. "%"
  elseif b.kind == "silo" then desc = "支援技能「巡航导弹」" end
  if b.kind == "refinery" then desc = desc .. "\n油井收入 ×" .. Config.RefineryBoost
  elseif b.kind == "nuclear" then desc = desc .. "\n工厂收入再 ×" .. Config.NuclearBoost end
  local _, label = Models.sign(pad, "<b>" .. b.name .. "</b>\n$" .. Config.Fmt(b.price) .. "  " .. desc, 5.5, 17, 4.2, nil, 220)
  local pp = Instance.new("ProximityPrompt")
  pp.ActionText = "建造"
  pp.ObjectText = b.name .. "  $" .. Config.Fmt(b.price)
  pp.HoldDuration = 0
  pp.MaxActivationDistance = 14
  pp.RequiresLineOfSight = false
  pp.Parent = pad
  m.Parent = parent
  return m, pad, pp, label
end

---------------------------------------------------------------- 兵种：零件

local function newPart(m, size, cf, color, mat, shape)
  local p = Instance.new("Part")
  if shape then p.Shape = shape end
  p.Size = size
  p.CFrame = cf
  p.Color = color
  p.Material = mat or MAT.SmoothPlastic
  p.TopSurface = Enum.SurfaceType.Smooth
  p.BottomSurface = Enum.SurfaceType.Smooth
  p.Anchored = false
  p.CanCollide = false
  p.CanTouch = false
  p.Massless = true
  p.Parent = m
  return p
end

local function weld(p0, p1, c0)
  local w = Instance.new("Weld")
  w.Part0 = p0
  w.Part1 = p1
  w.C0 = c0
  w.Parent = p1
  return w
end

-- 毂：一个隐形小零件，用 Motor6D 接在 root 上（转轴点 pivot），挂在它上面的零件跟着转
local function hub(m, root, name, pivot, tag)
  local h = newPart(m, V(0.2, 0.2, 0.2), CF(pivot), C.gun)
  h.Name = name .. "Hub"
  h.Transparency = 1
  local mot = Instance.new("Motor6D")
  mot.Name = name .. "Motor"
  mot.Part0 = root
  mot.Part1 = h
  mot.C0 = CF(pivot)
  mot.Parent = h
  if tag then CollectionService:AddTag(mot, tag) end
  return h
end

-- 零件模型的骨架：k 是按设计尺寸放大的倍数；add(尺寸, 相对位置, …) 焊在 root 上，turret(转轴点) 开一个炮塔毂，之后 addT 焊在炮塔毂上
local function kit(k)
  local m = Instance.new("Model")
  local root = Instance.new("Part")
  root.Name = "Root"
  root.Anchored = true
  root.CanCollide = false
  root.CanTouch = false
  root.Transparency = 1
  root.Size = V(1, 1, 1)
  root.CFrame = CF()
  root.Parent = m
  m.PrimaryPart = root
  local K = {}
  local function sc(off) return off - off.Position + off.Position * k end
  function K.add(size, off, color, mat, shape)
    local o = sc(off)
    local p = newPart(m, size * k, o, color, mat, shape)
    weld(root, p, o)
    return p
  end
  local th, tp = nil, nil
  function K.turret(pivot)
    tp = pivot * k
    th = hub(m, root, "Turret", tp)
  end
  function K.addT(size, off, color, mat, shape)
    local o = sc(off)
    local p = newPart(m, size * k, o, color, mat, shape)
    weld(th, p, CF(tp):Inverse() * o)
    return p
  end
  function K.rotor(y, span, color)
    local h = hub(m, root, "Rotor", V(0, y * k, 0), "Rotor")
    for _, sz in ipairs({ V(0.7, 0.12, span), V(span, 0.12, 0.7) }) do
      local blade = newPart(m, sz * k, CF(0, (y + 0.22) * k, 0), color, MAT.Metal)
      weld(h, blade, CF(0, 0.22 * k, 0))
    end
  end
  return m, root, K
end

local function soldier(K, ox, oz, col)
  K.add(V(0.9, 1.6, 0.55), CF(ox, 0.8, oz), C.uniform:Lerp(C.dark, 0.3))
  K.add(V(1.15, 1.5, 0.65), CF(ox, 2.35, oz), C.uniform)
  K.add(V(0.9, 1.0, 0.4), CF(ox, 2.4, oz + 0.5), C.oliveDark)
  K.add(V(0.7, 0.7, 0.7), CF(ox, 3.45, oz), C.skin)
  K.add(V(0.92, 0.38, 0.92), CF(ox, 3.86, oz), col)
  K.add(V(0.16, 0.22, 1.7), CF(ox + 0.42, 2.45, oz - 0.75), C.gun, MAT.Metal)
end

-- 设计尺寸（老版本的零件模型）× k = 配置里的长度
local PART = {}
PART.inf = { len = 4.1, h = 4.1, build = function(K, col)
  for _, o in ipairs({ { -1.8, 1 }, { 1.8, 1 }, { 0, -1.3 } }) do soldier(K, o[1], o[2], col) end
end }
PART.ifv = { len = 7.4, build = function(K, col)
  local dk = darker(col, 0.3)
  K.add(V(1.3, 1.5, 7.2), CF(-2.4, 0.75, 0), C.track, MAT.Metal)
  K.add(V(1.3, 1.5, 7.2), CF(2.4, 0.75, 0), C.track, MAT.Metal)
  K.add(V(3.9, 1.7, 7.0), CF(0, 1.7, 0.1), col, MAT.Metal)
  K.add(V(4.9, 0.3, 7.2), CF(0, 2.6, 0.1), dk, MAT.Metal)
  K.turret(V(0, 2.75, 0.4))
  K.addT(V(2.6, 1.0, 2.6), CF(0, 3.25, 0.4), col, MAT.Metal)
  K.addT(V(0.22, 0.22, 2.9), CF(0, 3.3, -2.3), C.gun, MAT.Metal)
  K.addT(V(0.7, 0.6, 1.6), CF(1.5, 3.3, 0.6), dk, MAT.Metal)
end }
PART.tank = { len = 12, build = function(K, col)
  local dk = darker(col, 0.3)
  K.add(V(1.5, 1.6, 9.2), CF(-2.85, 0.8, 0), C.track, MAT.Metal)
  K.add(V(1.5, 1.6, 9.2), CF(2.85, 0.8, 0), C.track, MAT.Metal)
  K.add(V(4.4, 1.3, 8.6), CF(0, 1.65, 0.1), col, MAT.Metal)
  K.add(V(5.9, 0.35, 8.8), CF(0, 2.45, 0.2), dk, MAT.Metal)
  K.turret(V(0, 2.6, 0.8))
  K.addT(V(3.8, 1.3, 4.4), CF(0, 3.25, 0.8), col, MAT.Metal)
  K.addT(V(3.2, 0.9, 1.4), CF(0, 3.2, 3.4), dk, MAT.Metal)
  K.addT(V(0.45, 0.45, 5.6), CF(0, 3.35, -4.0), C.gun, MAT.Metal)
  K.addT(V(0.75, 0.75, 0.8), CF(0, 3.35, -7.0), C.gun, MAT.Metal)
  K.addT(V(0.9, 0.55, 0.9), CF(1.0, 4.15, 1.6), dk, MAT.Metal)
end }
PART.aa = { len = 8.2, build = function(K, col)
  local dk = darker(col, 0.3)
  K.add(V(1.4, 1.4, 8.2), CF(-2.6, 0.7, 0), C.track, MAT.Metal)
  K.add(V(1.4, 1.4, 8.2), CF(2.6, 0.7, 0), C.track, MAT.Metal)
  K.add(V(4.2, 1.3, 7.8), CF(0, 1.55, 0), col, MAT.Metal)
  K.add(V(5.4, 0.3, 8.0), CF(0, 2.3, 0), dk, MAT.Metal)
  K.turret(V(0, 2.45, 0.6))
  K.addT(V(3.4, 1.8, 3.6), CF(0, 3.35, 0.6), col, MAT.Metal)
  for _, s in ipairs({ -1, 1 }) do
    K.addT(V(0.9, 1.0, 2.0), CF(s * 2.15, 3.4, 0.3), dk, MAT.Metal)
    K.addT(V(0.28, 0.28, 3.6), CF(s * 2.15, 4.4, -1.4) * CFrame.Angles(math.rad(32), 0, 0), C.gun, MAT.Metal)
  end
  K.addT(V(0.3, 1.6, 0.3), CF(0, 4.9, 2.0), C.metal, MAT.Metal)
  K.addT(V(2.6, 1.3, 0.25), CF(0, 5.9, 2.0) * CFrame.Angles(math.rad(-15), 0, 0), C.white, MAT.Metal)
end }
PART.arty = { len = 14.2, build = function(K, col)
  local dk = darker(col, 0.3)
  K.add(V(1.5, 1.6, 9.4), CF(-2.9, 0.8, 0), C.track, MAT.Metal)
  K.add(V(1.5, 1.6, 9.4), CF(2.9, 0.8, 0), C.track, MAT.Metal)
  K.add(V(4.4, 1.3, 9.0), CF(0, 1.65, 0), col, MAT.Metal)
  K.add(V(5.9, 0.3, 9.2), CF(0, 2.45, 0), dk, MAT.Metal)
  K.turret(V(0, 2.6, 1.4))
  K.addT(V(4.6, 2.3, 5.4), CF(0, 3.75, 1.4), col, MAT.Metal)
  local a = math.rad(22)
  local dir = V(0, math.sin(a), -math.cos(a))
  local r0 = V(0, 4.0, -1.2)
  K.addT(V(0.55, 0.55, 7.6), CF(r0 + dir * 3.8) * CFrame.Angles(a, 0, 0), C.gun, MAT.Metal)
  K.addT(V(0.85, 0.85, 0.9), CF(r0 + dir * 7.6) * CFrame.Angles(a, 0, 0), C.gun, MAT.Metal)
end }
PART.mlrs = { len = 8, build = function(K, col)
  local dk = darker(col, 0.3)
  K.add(V(1.4, 1.5, 8), CF(-2.5, 0.75, 0), C.track, MAT.Metal)
  K.add(V(1.4, 1.5, 8), CF(2.5, 0.75, 0), C.track, MAT.Metal)
  K.add(V(4.2, 1.6, 7.6), CF(0, 1.7, 0), col, MAT.Metal)
  K.add(V(4.2, 1.8, 2.4), CF(0, 3.3, -2.6), dk, MAT.Metal)   -- 驾驶室
  -- 发射箱朝右（+X）起竖：侧面朝敌开火
  K.add(V(3.6, 2.4, 4.6), CF(1.6, 4.0, 1.4) * CFrame.Angles(0, 0, math.rad(-35)), col:Lerp(C.olive, 0.3), MAT.Metal)
  for i = 0, 1 do
    for j = 0, 2 do
      K.add(V(0.2, 0.55, 0.55), CF(3.15, 4.9 + i * 0.75, 0.2 + j * 1.1) * CFrame.Angles(0, 0, math.rad(-35)), C.dark, MAT.Metal)
    end
  end
end }
PART.heli = { len = 15.2, build = function(K, col)
  local dk = darker(col, 0.3)
  for _, s in ipairs({ -1, 1 }) do
    K.add(V(0.25, 0.25, 6.2), CF(s * 1.5, 0.15, 0), C.gun, MAT.Metal)
    K.add(V(0.2, 1.4, 0.2), CF(s * 1.3, 0.9, -1.6), C.gun, MAT.Metal)
    K.add(V(0.2, 1.4, 0.2), CF(s * 1.3, 0.9, 1.6), C.gun, MAT.Metal)
  end
  K.add(V(2.4, 2.2, 6.4), CF(0, 2.7, 0.2), col, MAT.Metal)
  K.add(V(2.0, 1.6, 2.2), CF(0, 2.6, -3.9), col, MAT.Metal)
  local glass = K.add(V(1.7, 1.2, 2.6), CF(0, 3.5, -2.6), RGB(120, 180, 210), MAT.Glass)
  glass.Transparency = 0.25
  K.add(V(0.8, 0.8, 6.6), CF(0, 3.1, 6.6), col, MAT.Metal)
  K.add(V(0.25, 2.4, 1.4), CF(0, 4.0, 9.6), dk, MAT.Metal)
  K.add(V(3.2, 0.2, 1.0), CF(0, 3.0, 9.2), dk, MAT.Metal)
  K.add(V(5.8, 0.25, 1.3), CF(0, 2.5, 0.4), dk, MAT.Metal)
  for _, s in ipairs({ -1, 1 }) do K.add(V(0.7, 0.7, 2.0), CF(s * 2.6, 2.05, 0.2), C.gun, MAT.Metal) end
  K.add(V(0.15, 1.8, 0.15), CF(0.3, 4.0, 9.9), C.gun, MAT.Metal)
  K.add(V(0.15, 0.15, 1.8), CF(0.3, 4.0, 9.9), C.gun, MAT.Metal)
  K.add(V(0.6, 0.8, 0.6), CF(0, 4.1, 0), C.gun, MAT.Metal)
  K.rotor(4.6, 13, dk)
end }

-- 步兵组：几个士兵 + 武器（零件版）；squad 2 / 3 个人的站位
local FOOTPOS = { [2] = { { -1.4, 0.5 }, { 1.4, 0.5 } }, [3] = { { -1.8, 1 }, { 1.8, 1 }, { 0, -1.3 } } }
local function footPart(extra)
  return { len = 4.1, h = 4.1, build = function(K, col, def)
    for _, o in ipairs(FOOTPOS[def.squad or 3]) do soldier(K, o[1], o[2], col) end
    if extra then extra(K, col) end
  end }
end
PART.mg = footPart(function(K)
  K.add(V(0.3, 0.3, 2.2), CF(0, 0.45, -2.4), C.gun, MAT.Metal)
  K.add(V(0.12, 0.5, 0.12), CF(0, 0.2, -3.2), C.gun, MAT.Metal)
end)
PART.sniper = footPart(function(K)
  K.add(V(0.12, 0.12, 2.4), CF(-1.0, 2.5, -1.2), C.gun, MAT.Metal)
end)
PART.mortar = footPart(function(K)
  K.add(V(1.2, 0.15, 1.2), CF(0, 0.08, 0.6), C.gun, MAT.Metal)
  K.add(V(0.35, 0.35, 2.2), CF(0, 0.95, 0.1) * CFrame.Angles(math.rad(50), 0, 0), C.gun, MAT.Metal)
end)
PART.at = footPart(function(K)
  K.add(V(0.45, 0.45, 2.6), CF(-0.95, 3.0, 0.4), C.oliveDark, MAT.Metal)
end)
PART.manpad = footPart(function(K)
  K.add(V(0.32, 0.32, 3.0), CF(-0.95, 3.1, 0.4) * CFrame.Angles(math.rad(20), 0, 0), C.oliveDark, MAT.Metal)
end)
PART.jeep = { len = 6.5, build = function(K, col)
  local dk = darker(col, 0.3)
  for _, sx in ipairs({ -1, 1 }) do
    for _, sz in ipairs({ -1, 1 }) do K.add(V(0.7, 1.6, 1.6), CF(sx * 1.35, 0.8, sz * 2.0), C.track, MAT.Metal, CYL) end
  end
  K.add(V(2.6, 1.3, 6.2), CF(0, 1.55, 0), col, MAT.Metal)
  K.add(V(2.4, 1.2, 3.0), CF(0, 2.75, 0.4), col, MAT.Metal)
  K.add(V(2.2, 0.5, 1.4), CF(0, 2.4, -2.5), C.glass, MAT.Glass)
  K.turret(V(0, 3.35, 0.6))
  K.addT(V(1.4, 0.6, 1.4), CF(0, 3.65, 0.6), dk, MAT.Metal)
  K.addT(V(0.18, 0.18, 1.8), CF(0, 3.9, -0.6), C.gun, MAT.Metal)
end }
PART.td = { len = 9, build = function(K, col)
  local dk = darker(col, 0.3)
  for _, sz in ipairs({ -2.9, -0.6, 2.6 }) do
    for _, sx in ipairs({ -1, 1 }) do K.add(V(0.7, 1.7, 1.7), CF(sx * 1.6, 0.85, sz), C.track, MAT.Metal, CYL) end
  end
  K.add(V(3.0, 1.4, 8.4), CF(0, 1.8, 0), col, MAT.Metal)
  K.add(V(3.6, 0.3, 8.4), CF(0, 2.6, 0), dk, MAT.Metal)
  K.turret(V(0, 2.75, 0.8))
  K.addT(V(2.8, 1.1, 3.2), CF(0, 3.3, 0.8), col, MAT.Metal)
  K.addT(V(0.38, 0.38, 5.6), CF(0, 3.35, -2.6), C.gun, MAT.Metal)
  K.addT(V(0.6, 0.6, 0.6), CF(0, 3.35, -5.4), C.gun, MAT.Metal)
end }
PART.breacher = { len = 10, build = function(K, col)
  local dk = darker(col, 0.3)
  K.add(V(1.5, 1.6, 8.6), CF(-2.85, 0.8, 0), C.track, MAT.Metal)
  K.add(V(1.5, 1.6, 8.6), CF(2.85, 0.8, 0), C.track, MAT.Metal)
  K.add(V(4.4, 1.4, 8.2), CF(0, 1.7, 0.3), col, MAT.Metal)
  K.add(V(3.6, 1.2, 3.6), CF(0, 3.0, 1.2), dk, MAT.Metal)
  K.add(V(6.4, 1.4, 0.5), CF(0, 0.9, -5.0) * CFrame.Angles(math.rad(-25), 0, 0), C.metal, MAT.DiamondPlate)   -- 扫雷犁
  for i = -2, 2 do K.add(V(0.25, 0.9, 1.0), CF(i * 1.4, 0.4, -5.5), C.metal, MAT.Metal) end
  K.add(V(0.8, 0.8, 2.6), CF(1.4, 3.6, 2.6), dk, MAT.Metal)   -- 直线装药发射器
end }
PART.cram = { len = 6, build = function(K, col)
  K.add(V(5.2, 1.6, 6), CF(0, 0.8, 0), darker(col, 0.2), MAT.Metal)
  K.turret(V(0, 1.6, 0))
  K.addT(V(2.4, 1.2, 2.4), CF(0, 2.2, 0), col, MAT.Metal)
  K.addT(V(3.0, 1.6, 1.6), CF(0, 4.3, 0.4) * UP, C.white, MAT.SmoothPlastic, CYL)   -- 雷达罩
  K.addT(V(0.5, 0.5, 2.6), CF(0, 2.9, -1.6), C.gun, MAT.Metal)
end }
PART.sam = { len = 11, build = function(K, col)
  local dk = darker(col, 0.3)
  for _, sz in ipairs({ -3.6, -1.6, 2.4, 4.0 }) do
    for _, sx in ipairs({ -1, 1 }) do K.add(V(0.6, 1.4, 1.4), CF(sx * 1.3, 0.7, sz), C.track, MAT.Metal, CYL) end
  end
  K.add(V(2.6, 0.6, 10.4), CF(0, 1.5, 0), dk, MAT.Metal)
  K.add(V(2.6, 2.0, 2.2), CF(0, 2.6, -4.2), col, MAT.Metal)
  K.add(V(3.0, 2.4, 5.6), CF(0, 3.6, 1.6) * CFrame.Angles(math.rad(38), 0, 0), col, MAT.Metal)   -- 发射箱起竖
end }
PART.howitzer = { len = 10, build = function(K, col)
  local dk = darker(col, 0.3)
  for _, sx in ipairs({ -1, 1 }) do
    K.add(V(0.7, 1.8, 1.8), CF(sx * 1.5, 0.9, 0.4), C.track, MAT.Metal, CYL)
    K.add(V(0.35, 0.35, 5), CF(sx * 1.4, 0.4, 3.0) * CFrame.Angles(0, sx * 0.35, 0), col, MAT.Metal)   -- 大架
  end
  K.add(V(2.4, 0.8, 2.0), CF(0, 1.4, 0.4), col, MAT.Metal)
  local a = math.rad(25)
  local dir = V(0, math.sin(a), -math.cos(a))
  local r0 = V(0, 1.9, 0.4)
  K.add(V(0.5, 0.5, 7.4), CF(r0 + dir * 3.0) * CFrame.Angles(a, 0, 0), C.gun, MAT.Metal)
  K.add(V(0.8, 0.8, 0.8), CF(r0 + dir * 6.6) * CFrame.Angles(a, 0, 0), C.gun, MAT.Metal)
  K.add(V(2.6, 1.4, 0.2), CF(0, 2.3, -0.6), dk, MAT.Metal)   -- 防盾
end }
-- 固定翼：机身、机头、座舱、机翼、平尾、垂尾、发动机（参数按设计尺寸）
local function plane(p)
  return { len = p.len, h = p.h, build = function(K, col)
    local dk = darker(col, 0.25)
    local L, D, y = p.len, p.dia, p.y
    K.add(V(D, D, L * 0.8), CF(0, y, 0), col, MAT.Metal)
    K.add(V(D * 0.7, D * 0.7, L * 0.14), CF(0, y - D * 0.05, -L * 0.46), col, MAT.Metal)
    K.add(V(D * 0.55, D * 0.35, L * 0.12), CF(0, y + D * 0.5, -L * 0.3), C.glass, MAT.Glass)
    K.add(V(p.span, D * 0.12, p.chord), CF(0, y + p.wingY, p.wingZ), col, MAT.Metal)
    K.add(V(p.span * 0.38, D * 0.1, p.chord * 0.5), CF(0, y + D * 0.1, L * 0.38), dk, MAT.Metal)
    for _, fx in ipairs(p.fins) do K.add(V(D * 0.08, p.fin, p.chord * 0.55), CF(fx, y + D * 0.5 + p.fin / 2, L * 0.36), dk, MAT.Metal) end
    for _, e in ipairs(p.eng or {}) do K.add(V(e[4], e[4], e[5]), CF(e[1], y + e[2], e[3]), dk, MAT.Metal) end
  end }
end
PART.fighter = plane({ len = 20, h = 4.5, dia = 2.0, y = 2.2, span = 13, chord = 6, wingY = -0.2, wingZ = 2, fins = { -1.2, 1.2 }, fin = 3 })
PART.attacker = plane({ len = 16, h = 4.5, dia = 1.8, y = 2.0, span = 17, chord = 3, wingY = -0.4, wingZ = 0, fins = { -2.8, 2.8 }, fin = 2.6,
  eng = { { -1.2, 0.9, 3.5, 1.3, 2.6 }, { 1.2, 0.9, 3.5, 1.3, 2.6 } } })
PART.bomber = plane({ len = 34, h = 7, dia = 3.0, y = 3.0, span = 34, chord = 6, wingY = 0.4, wingZ = 0, fins = { 0 }, fin = 6,
  eng = { { -4.5, -0.4, -1.5, 1.6, 4 }, { 4.5, -0.4, -1.5, 1.6, 4 } } })
PART.drone = plane({ len = 11, h = 3, dia = 1.2, y = 1.6, span = 20, chord = 1.4, wingY = 0, wingZ = 0, fins = { -0.8, 0.8 }, fin = 1.4 })
PART.spaag = PART.aa
PART.heavyarty = PART.arty
PART.transport = PART.heli
PART.heavytank = PART.tank
-- 医疗兵：背上白色急救包、红十字
PART.medic = footPart(function(K)
  for _, x in ipairs({ -1.4, 1.4 }) do
    K.add(V(0.9, 0.8, 0.5), CF(x, 2.5, 1.0), C.white, MAT.SmoothPlastic)
    K.add(V(0.5, 0.15, 0.52), CF(x, 2.5, 1.02), C.red, MAT.Neon)
    K.add(V(0.15, 0.5, 0.52), CF(x, 2.5, 1.02), C.red, MAT.Neon)
  end
end)
-- 火焰兵：背两个燃料罐、手里喷管
PART.flamer = footPart(function(K)
  for _, x in ipairs({ -1.4, 1.4 }) do
    for _, dx in ipairs({ -0.25, 0.25 }) do K.add(V(1.3, 0.42, 0.42), CF(x + dx, 2.4, 1.0) * UP, RGB(150, 60, 40), MAT.Metal, CYL) end
    K.add(V(0.22, 0.22, 1.6), CF(x + 0.42, 2.2, -0.9), C.gun, MAT.Metal)
  end
end)
-- 特种小队：三个人，夜视仪、短天线
PART.commando = footPart(function(K)
  for _, o in ipairs({ { -1.8, 1 }, { 1.8, 1 }, { 0, -1.3 } }) do
    K.add(V(0.5, 0.25, 0.3), CF(o[1], 3.75, o[2] - 0.4), RGB(30, 32, 30), MAT.Metal)
    K.add(V(0.06, 1.2, 0.06), CF(o[1] - 0.3, 4.4, o[2] + 0.4), RGB(30, 32, 30), MAT.Metal)
  end
end)
-- 抢修车：车身 + 后面的吊臂
PART.repair = { len = 6.5, build = function(K, col)
  for _, sx in ipairs({ -1, 1 }) do
    for _, sz in ipairs({ -1, 1 }) do K.add(V(0.7, 1.6, 1.6), CF(sx * 1.35, 0.8, sz * 2.0), C.track, MAT.Metal, CYL) end
  end
  K.add(V(2.6, 1.3, 6.2), CF(0, 1.55, 0), col, MAT.Metal)
  K.add(V(2.4, 1.1, 2.4), CF(0, 2.75, -1.6), col, MAT.Metal)
  K.add(V(2.0, 0.4, 1.0), CF(0, 2.4, -2.9), C.glass, MAT.Glass)
  K.turret(V(0, 2.3, 1.6))
  K.addT(V(0.9, 0.9, 0.9), CF(0, 2.75, 1.6), C.yellow, MAT.Metal)
  K.addT(V(0.35, 0.35, 3.2), CF(0, 3.6, 0.4) * CFrame.Angles(math.rad(30), 0, 0), C.yellow, MAT.Metal)
  K.addT(V(0.08, 1.4, 0.08), CF(0, 3.6, -1.0), C.gun, MAT.Metal)
  K.add(V(0.5, 0.25, 0.5), CF(0.8, 3.4, -1.6), RGB(255, 140, 40), MAT.Neon)
end }
-- 电子战车：卡车 + 后面的方舱、碟形天线、几根鞭状天线
PART.ew = { len = 9, build = function(K, col)
  for _, sz in ipairs({ -3.0, 1.0, 3.0 }) do
    for _, sx in ipairs({ -1, 1 }) do K.add(V(0.6, 1.4, 1.4), CF(sx * 1.3, 0.7, sz), C.track, MAT.Metal, CYL) end
  end
  K.add(V(2.6, 0.6, 8.6), CF(0, 1.5, 0), darker(col, 0.3), MAT.Metal)
  K.add(V(2.6, 2.0, 2.2), CF(0, 2.6, -3.2), col, MAT.Metal)
  K.add(V(2.8, 2.6, 5.0), CF(0, 3.1, 1.4), col:Lerp(C.olive, 0.3), MAT.Metal)
  K.add(V(0.3, 2.4, 2.4), CF(0, 5.2, 0.6) * CFrame.Angles(0, 0, math.rad(90)) * CFrame.Angles(math.rad(25), 0, 0), C.white, MAT.SmoothPlastic, CYL)
  for _, x in ipairs({ -1.1, 1.1 }) do K.add(V(0.06, 3, 0.06), CF(x, 5.8, 3.4), C.gun, MAT.Metal) end
end }
-- 巡飞弹：小无人机
PART.loiter = plane({ len = 6, h = 1.6, dia = 0.7, y = 1.0, span = 5.5, chord = 1.0, wingY = 0, wingZ = 0.4, fins = { 0 }, fin = 0.8 })
-- 0.9 的新兵种没导入专门的模型时，借外形最像的零件模型（导入了用 def.model 那一个）
PART.swarmling = PART.loiter
PART.gunship = PART.bomber
PART.swarm = PART.mlrs
PART.laser = PART.cram
PART.railgun = PART.td
PART.miner = PART.breacher
PART.ballistic = PART.sam
-- 隐身轰炸机：飞翼（中间机身 + 两边后掠翼，锯齿后缘）
PART.stealth = { len = 20, h = 3, build = function(K, col)
  local dark = RGB(44, 46, 52)
  K.add(V(4.5, 1.6, 12), CF(0, 2.2, 0), dark, MAT.SmoothPlastic)
  K.add(V(2.2, 0.6, 3), CF(0, 3.1, -3.2), RGB(30, 34, 40), MAT.Glass)
  for _, sx in ipairs({ -1, 1 }) do
    K.add(V(14, 0.5, 6), CF(sx * 7.5, 2.0, 2.2) * CFrame.Angles(0, sx * math.rad(-33), 0), dark, MAT.SmoothPlastic)
    K.add(V(3, 0.4, 3), CF(sx * 13.6, 2.0, 7.2) * CFrame.Angles(0, math.rad(45), 0), dark, MAT.SmoothPlastic)
  end
  K.add(V(0.6, 0.2, 0.6), CF(0, 3.05, 4), col, MAT.Neon)
end }

---------------------------------------------------------------- 兵种：导入的原模型

-- 槽位：各兵种的 model，加上步兵组用的道具（值是道具沿前后方向的长度，格）
local PROPLEN = { prop_javelin = 2.6, prop_stinger = 3.4, prop_mortar = 2.4, prop_mg = 2.8 }
local SLOTS = {}
for name in pairs(PROPLEN) do SLOTS[name] = true end
for _, d in pairs(Config.Units) do
  if d.model then SLOTS[d.model] = true end
end
local TEMPLATES = {}   -- 槽位 → { parts = { { part, role } }, pivots = {…}, h = 高度 }
local MARKS = { _Front = true, _Top = true, _PivotTurret = true, _PivotRotor = true, _PivotTail = true, _AxisTail = true }

local function rotOnly(cf)
  return cf - cf.Position
end

-- 一组零件的包围盒（世界坐标，按每个零件的 8 个角）
local function bounds(parts)
  local mn = V(math.huge, math.huge, math.huge)
  local mx = V(-math.huge, -math.huge, -math.huge)
  for _, p in ipairs(parts) do
    local h = p.Size / 2
    for _, sx in ipairs({ -1, 1 }) do
      for _, sy in ipairs({ -1, 1 }) do
        for _, sz in ipairs({ -1, 1 }) do
          local w = p.CFrame:PointToWorldSpace(V(h.X * sx, h.Y * sy, h.Z * sz))
          mn = V(math.min(mn.X, w.X), math.min(mn.Y, w.Y), math.min(mn.Z, w.Z))
          mx = V(math.max(mx.X, w.X), math.max(mx.Y, w.Y), math.max(mx.Z, w.Z))
        end
      end
    end
  end
  return mn, mx
end

-- 合并包 all_units.glb 里零件名带兵种前缀（tank__Turret_1、heli___PivotRotor）：拆成 兵种、原名
local function splitName(n)
  local slot, rest = string.match(n, "^(.-)__(.+)$")
  if slot and SLOTS[slot] then return slot, rest end
  return nil, n
end

-- 把导入的模型整理成模板：用 _Front / _Top 标记摆正（不管导入时坐标怎么换的），缩放到长度 len（士兵按身高 5.2），底面中心放到原点，读转轴标记
local function prepare(slot, model)
  local parts, marks = {}, {}
  for _, d in ipairs(model:GetDescendants()) do
    if d:IsA("BasePart") then
      d.Anchored = true   -- 导入时没锚定的话，一开始游戏就会往下掉、散开
      local s2, rest = splitName(d.Name)
      if s2 == slot then d.Name = rest end
      if MARKS[d.Name] then marks[d.Name] = d else table.insert(parts, d) end
    end
  end
  if #parts == 0 then return nil end
  local all = {}
  for _, p in ipairs(parts) do table.insert(all, p) end
  for _, p in pairs(marks) do table.insert(all, p) end
  local mn, mx = bounds(parts)
  local c = (mn + mx) / 2
  -- 1）摆正：前 = 指向 _Front，上 = 指向 _Top
  local cur = CF(c)
  if marks._Front and marks._Top then
    local up = (marks._Top.CFrame.Position - c).Unit
    local f = marks._Front.CFrame.Position - c
    local fwd = (f - up * f:Dot(up)).Unit
    local right = fwd:Cross(up)
    cur = CFrame.fromMatrix(c, right, up, -fwd)
  end
  local inv = cur:Inverse()
  for _, p in ipairs(all) do p.CFrame = inv * p.CFrame end
  -- 2）缩放
  mn, mx = bounds(parts)
  local size = mx - mn
  local def = Config.Units[slot]
  local k
  if slot == "soldier" then k = 5.2 / math.max(0.01, size.Y)
  elseif PROPLEN[slot] then k = PROPLEN[slot] / math.max(0.01, size.Z)
  else k = (def and def.len or 15) / math.max(0.01, size.Z) end
  for _, p in ipairs(all) do
    local pos = p.CFrame.Position * k
    p.Size = p.Size * k
    p.CFrame = CF(pos) * rotOnly(p.CFrame)
  end
  -- 3）底面中心到原点
  mn, mx = bounds(parts)
  local shift = V((mn.X + mx.X) / 2, mn.Y, (mn.Z + mx.Z) / 2)
  for _, p in ipairs(all) do p.CFrame = p.CFrame - shift end
  mn, mx = bounds(parts)
  local T = { parts = {}, pivots = {}, h = mx.Y - mn.Y, len = mx.Z - mn.Z }
  for name, p in pairs(marks) do T.pivots[name] = p.CFrame.Position end
  for _, p in ipairs(parts) do
    local role = "Body"
    local n = p.Name
    if n:sub(1, 9) == "TailRotor" then role = "Tail"
    elseif n:sub(1, 5) == "Rotor" then role = "Rotor"
    elseif n:sub(1, 6) == "Turret" then role = "Turret"
    end
    if role == "Turret" and not T.pivots._PivotTurret then role = "Body" end
    if role == "Rotor" and not T.pivots._PivotRotor then role = "Body" end
    if role == "Tail" and not T.pivots._PivotTail then role = "Body" end
    table.insert(T.parts, { part = p, role = role })
  end
  return T
end

-- 开服时找导入的模型，整理成模板收进 ServerStorage：
--   ① 叫兵种名的 Model（一个一个导入的 tank.glb……；放在 ReplicatedStorage.UnitModels、ServerStorage、Workspace、ReplicatedStorage 里，套几层都行）
--   ② 合并包 all_units.glb 导进来的：零件名带「兵种名__」前缀，不管 Studio 保没保留层级，都按前缀分回各个兵种
function Models.loadImported()
  local store = Instance.new("Folder")
  store.Name = "UnitTemplates"
  store.Parent = ServerStorage
  local places = { ServerStorage, workspace, RS }
  local um = RS:FindFirstChild("UnitModels")
  if um then table.insert(places, 1, um) end
  local found = {}
  local function take(slot, model)
    local ok, T = pcall(prepare, slot, model)
    if ok and T then
      TEMPLATES[slot] = T
      model.Name = slot
      model.Parent = store
      table.insert(found, slot)
    elseif not ok then
      warn("[军事大亨] 导入的模型 " .. slot .. " 整理失败：" .. tostring(T))
    end
  end
  -- ①
  for _, place in ipairs(places) do
    for _, ch in ipairs(place:GetDescendants()) do
      if ch:IsA("Model") and SLOTS[ch.Name] and not TEMPLATES[ch.Name] and not ch:IsDescendantOf(store) then take(ch.Name, ch) end
    end
  end
  -- ②
  local groups = {}
  for _, place in ipairs(places) do
    for _, d in ipairs(place:GetDescendants()) do
      if d:IsA("BasePart") and not d:IsDescendantOf(store) then
        local slot = splitName(d.Name)
        if slot and not TEMPLATES[slot] then
          groups[slot] = groups[slot] or {}
          table.insert(groups[slot], d)
        end
      end
    end
  end
  local emptied = {}
  for slot, list in pairs(groups) do
    local m = Instance.new("Model")
    m.Name = slot
    for _, p in ipairs(list) do
      if p.Parent then emptied[p.Parent] = true end
      p.Parent = m
    end
    take(slot, m)
  end
  -- 合并包导进来剩下的空壳（Model / 文件夹）收掉，免得留在地图里
  for holder in pairs(emptied) do
    local top = holder
    while top.Parent and top.Parent ~= workspace and top.Parent ~= RS and top.Parent ~= ServerStorage and top.Parent ~= um do top = top.Parent end
    if top ~= workspace and top ~= RS and top ~= ServerStorage and top ~= um and top.Parent then
      local anyPart = false
      for _, d in ipairs(top:GetDescendants()) do
        if d:IsA("BasePart") then
          anyPart = true
          break
        end
      end
      if not anyPart then top:Destroy() end
    end
  end
  table.sort(found)
  return found
end

---------------------------------------------------------------- 兵种：生成

-- 兵种的高度（血条、瞄准点）：导入模型按模板，零件模型按设计
-- 几个兵种共用一个导入模型（重型坦克用坦克的、巡飞弹用无人机的……）：按各自的长度缩放
local function tplK(def, T)
  if T and T.len and T.len > 0.01 and def.len then return def.len / T.len end
  return def.boss and 1.36 or 1
end

local function heightOf(t)
  local def = Config.Units[t]
  if def.foot then return 5.2 end
  local T = TEMPLATES[def.model]
  if T then return T.h * tplK(def, T) end
  local k = def.boss and 1.36 or 1
  local P = PART[t] or PART.tank
  local base = P.h or (def.air and 5 or 4.6)
  return base * ((def.len or 4) / P.len) * k
end
Models.heightOf = heightOf

-- 炮口（模型坐标，炮塔不转时）：大致在车头、炮塔高度
local MUZ = { at = V(-1.3, 4.4, -1.6), manpad = V(-1.3, 4.7, -1.6), mortar = V(0, 2.2, -0.4), mg = V(0, 0.7, -4.2) }
function Models.muzzle(t)
  local def = Config.Units[t]
  local h = heightOf(t)
  if MUZ[t] then return MUZ[t] end
  if def.foot then return V(0.5, 3.1, -2.6) end
  if def.bombs then return V(0, h * 0.25, 0) end
  if def.jet then return V(0, h * 0.35, -def.len * 0.45) end
  if def.air then return V(def.len * 0.08, h * 0.35, -def.len * 0.3) end
  if def.side then return V(def.size * 0.45, h * 0.75, 0) end
  return V(0, h * 0.62, -(def.len or 10) * 0.55)
end

local function ring(m, root, size, color)
  local r = newPart(m, V(0.12, size, size), CF(0, 0.12, 0) * UP, color, MAT.Neon, CYL)
  r.Name = "TeamRing"
  r.Transparency = 0.45
  r.CastShadow = false
  r.CanQuery = false
  weld(root, r, CF(0, 0.12, 0) * UP)
end

local function newRoot()
  local m = Instance.new("Model")
  local root = Instance.new("Part")
  root.Name = "Root"
  root.Anchored = true
  root.CanCollide = false
  root.CanTouch = false
  root.Transparency = 1
  root.Size = V(1, 1, 1)
  root.CFrame = CF()
  root.Parent = m
  m.PrimaryPart = root
  return m, root
end

-- 往模型里加一份模板（k 额外放大，offs 一个或几个摆放位置（CFrame）——步兵组是几个士兵；flat 全部焊死在 Root 上，不建炮塔、旋翼）
local function addTemplate(m, root, T, k, offs, flat)
  local hubs = {}
  local function hubFor(role)
    if hubs[role] then return hubs[role] end
    local h
    if role == "Turret" then h = hub(m, root, "Turret", T.pivots._PivotTurret * k)
    elseif role == "Rotor" then h = hub(m, root, "Rotor", T.pivots._PivotRotor * k, "Rotor")
    else
      h = hub(m, root, "Tail", T.pivots._PivotTail * k, "TailRotor")
      local ax = T.pivots._AxisTail and (T.pivots._AxisTail - T.pivots._PivotTail) or V(1, 0, 0)
      h:FindFirstChild("TailMotor"):SetAttribute("Axis", ax.Unit)
    end
    hubs[role] = h
    return h
  end
  for _, off in ipairs(offs) do
    for _, e in ipairs(T.parts) do
      local p = e.part:Clone()
      p.Anchored = false
      p.CanCollide = false
      p.CanTouch = false
      p.Massless = true
      p.Size = p.Size * k
      local cf = off * CF(p.CFrame.Position * k) * rotOnly(p.CFrame)
      p.CFrame = cf
      p.Parent = m
      if e.role == "Body" or flat then
        weld(root, p, cf)
      else
        local h = hubFor(e.role)
        weld(h, p, h:FindFirstChildOfClass("Motor6D").C0:Inverse() * cf)
      end
    end
  end
end

-- 步兵组：几个士兵的站位，武器道具摆在哪（机枪、迫击炮在地上，标枪、毒刺扛在第一个人右肩上）
local FOOT = { [2] = { CF(-1.8, 0, 0.6), CF(1.8, 0, 0.6) }, [3] = { CF(-2.6, 0, 1.6), CF(2.6, 0, 1.6), CF(0, 0, -2.2) } }
local PROPAT = {
  prop_mg = CF(0, 0, -2.9), prop_mortar = CF(0, 0, 0.1),
  prop_javelin = CF(-1.3, 4.25, 0.9), prop_stinger = CF(-1.3, 4.25, 0.9) * CFrame.Angles(math.rad(20), 0, 0),
}

-- 兵种模型（还没放进 workspace；放进去以后改 root.CFrame 摆位置）。color 是队伍颜色（零件模型的车身、脚下的色圈）
function Models.unit(t, color)
  local def = Config.Units[t]
  local T = TEMPLATES[def.model]
  local k = def.boss and 1.36 or 1
  local m, root
  if T and def.foot then
    m, root = newRoot()
    addTemplate(m, root, T, 1, FOOT[def.squad or 3], true)
    local P = def.prop and TEMPLATES[def.prop]
    if P then addTemplate(m, root, P, 1, { PROPAT[def.prop] }, true) end
  elseif T then
    m, root = newRoot()
    addTemplate(m, root, T, tplK(def, T), { CF() }, false)
  else
    local P = PART[t] or PART.tank
    local K
    m, root, K = kit(((def.len or P.len) / P.len) * k * (def.foot and 1.27 or 1))
    local col = color:Lerp(C.olive, 0.2)
    if def.boss then col = RGB(40, 40, 44) end
    P.build(K, col, def)
  end
  ring(m, root, def.size * 0.95 * k, color)
  if def.jet then m:SetAttribute("Jet", true) end
  m:SetAttribute("H", heightOf(t))   -- 模型多高：客户端把名字、选中框摆在头顶
  m.Name = t
  return m, root
end

-- 血条（战斗时才显示）
function Models.hpBar(root, height, color)
  local bb = Instance.new("BillboardGui")
  bb.Name = "HP"
  bb.Size = UDim2.fromOffset(50, 6)
  bb.StudsOffsetWorldSpace = V(0, height, 0)
  bb.AlwaysOnTop = true
  bb.LightInfluence = 0
  bb.MaxDistance = 1400
  bb.Enabled = false
  local bg = Instance.new("Frame")
  bg.Size = UDim2.fromScale(1, 1)
  bg.BackgroundColor3 = RGB(20, 20, 20)
  bg.BorderSizePixel = 0
  bg.Parent = bb
  local fill = Instance.new("Frame")
  fill.Name = "Fill"
  fill.Size = UDim2.fromScale(1, 1)
  fill.BackgroundColor3 = color
  fill.BorderSizePixel = 0
  fill.Parent = bg
  bb.Parent = root
  return bb, fill
end

---------------------------------------------------------------- 补给空投箱

-- 根零件是箱子（锚定，服务器挪它落下来），捆带、伞（子模型 Chute，落地后拆掉）、绿色信标焊在上面；返回 模型、箱子、伞、头顶的字
function Models.crate(parent, pos, text)
  local m = Instance.new("Model")
  m.Name = "SupplyCrate"
  local box = Instance.new("Part")
  box.Name = "Box"
  box.Size = V(4.2, 3.2, 4.2)
  box.Color = RGB(104, 116, 74)
  box.Material = MAT.WoodPlanks
  box.Anchored = true
  box.CanCollide = false
  box.TopSurface = Enum.SurfaceType.Smooth
  box.BottomSurface = Enum.SurfaceType.Smooth
  box.CFrame = CF(pos + V(0, 71.5, 0))
  box.Parent = m
  m.PrimaryPart = box
  local function deco(holder, size, off, color, mat, shape, tr)
    local p = newPart(holder, size, box.CFrame * off, color, mat, shape)
    p.CanQuery = false
    if tr then p.Transparency = tr end
    weld(box, p, off)
    return p
  end
  deco(m, V(4.35, 0.18, 0.7), CF(0, 1.62, 0), RGB(40, 40, 36), MAT.Metal)
  deco(m, V(0.7, 0.18, 4.35), CF(0, 1.62, 0), RGB(40, 40, 36), MAT.Metal)
  deco(m, V(4.35, 0.7, 0.18), CF(0, 0, 2.12), RGB(236, 236, 230), MAT.SmoothPlastic)
  local beacon = deco(m, V(70, 1.1, 1.1), CF(0, 36.6, 0) * UP, RGB(90, 255, 130), MAT.Neon, CYL, 0.45)
  beacon.CastShadow = false
  local chute = Instance.new("Model")
  chute.Name = "Chute"
  chute.Parent = m
  local canopy = deco(chute, V(16, 5, 16), CF(0, 13, 0), RGB(232, 120, 40), MAT.Fabric, BALL)
  canopy.CastShadow = false
  for _, c in ipairs({ { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } }) do
    local a = V(c[1] * 1.9, 1.6, c[2] * 1.9)
    local b = V(c[1] * 6.5, 11.5, c[2] * 6.5)
    local mid = (a + b) / 2
    deco(chute, V(0.08, 0.08, (b - a).Magnitude), CFrame.lookAt(mid, b), RGB(220, 220, 210), MAT.SmoothPlastic)
  end
  local bb = Models.sign(box, text, 4.2, 12, 2.2, RGB(150, 255, 170), 400)
  bb.AlwaysOnTop = true
  m.Parent = parent
  return m, box, chute, bb
end

---------------------------------------------------------------- 武器（玩家背包里的工具）

-- 枪：Handle 的原点在握把，枪口朝 −Z（Roblox 工具默认握法下朝前）；Muzzle 附件在枪口
local GUNS = {
  rifle = { len = 3.2, parts = { { V(0.32, 0.55, 2.0), V(0, 0.08, -0.4) }, { V(0.28, 0.5, 0.9), V(0, 0, 1.0) }, { V(0.14, 0.14, 1.4), V(0, 0.14, -2.0) }, { V(0.22, 0.7, 0.35), V(0, -0.45, -0.6) } }, col = RGB(40, 42, 40) },
  smg = { len = 2.2, parts = { { V(0.3, 0.5, 1.4), V(0, 0.06, -0.3) }, { V(0.12, 0.12, 0.7), V(0, 0.12, -1.3) }, { V(0.2, 0.8, 0.3), V(0, -0.5, -0.3) } }, col = RGB(52, 54, 58) },
  sniper = { len = 4.6, parts = { { V(0.3, 0.5, 2.2), V(0, 0.06, -0.4) }, { V(0.26, 0.5, 1.2), V(0, -0.02, 1.2) }, { V(0.14, 0.14, 2.4), V(0, 0.12, -2.7) }, { V(0.24, 0.24, 1.0), V(0, 0.48, -0.4) } }, col = RGB(70, 76, 58) },
  rpg = { len = 4.2, parts = { { V(0.5, 0.5, 4.2), V(0, 0.25, -0.6) }, { V(0.7, 0.7, 1.0), V(0, 0.25, -2.9) }, { V(0.2, 0.6, 0.3), V(0, -0.3, -0.2) } }, col = RGB(72, 86, 60) },
}
function Models.tool(id)
  local w = Config.Weapons[id]
  local G = GUNS[id] or GUNS.rifle
  local tool = Instance.new("Tool")
  tool.Name = w.name
  tool.ToolTip = w.name
  tool.CanBeDropped = false
  tool.RequiresHandle = true
  tool:SetAttribute("Weapon", id)
  local handle = Instance.new("Part")
  handle.Name = "Handle"
  handle.Size = V(0.3, 0.3, 0.6)
  handle.Color = G.col
  handle.Material = MAT.Metal
  handle.CanCollide = false
  handle.Massless = true
  handle.TopSurface = Enum.SurfaceType.Smooth
  handle.BottomSurface = Enum.SurfaceType.Smooth
  handle.Parent = tool
  for i, e in ipairs(G.parts) do
    local p = Instance.new("Part")
    p.Name = "Gun" .. i
    p.Size = e[1]
    p.Color = G.col
    p.Material = MAT.Metal
    p.CanCollide = false
    p.CanTouch = false
    p.Massless = true
    p.TopSurface = Enum.SurfaceType.Smooth
    p.BottomSurface = Enum.SurfaceType.Smooth
    p.CFrame = CF(e[2])
    p.Parent = tool
    weld(handle, p, CF(e[2]))
  end
  local mz = Instance.new("Attachment")
  mz.Name = "Muzzle"
  mz.Position = V(0, 0.14, -G.len + 0.2)
  mz.Parent = handle
  return tool
end

return Models
