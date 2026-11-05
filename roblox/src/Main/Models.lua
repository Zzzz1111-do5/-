-- 军事大亨：零件拼的模型（地图、建筑、购买按钮、兵种、血条）
-- 建筑、地面是锚定的静态零件；兵种是一个锚定的隐形 Root，其余零件用 Weld 焊在它上面——只改 Root.CFrame，整台车跟着动
-- 兵种模型的正前方是 -Z（和 CFrame.lookAt 一致）；原点在车底中心
local RS = game:GetService("ReplicatedStorage")
local CollectionService = game:GetService("CollectionService")
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
  local h = rng:NextNumber(5, 8)
  cyl(f, base, h, 1.3, CF(0, h / 2, 0), RGB(108, 80, 56), MAT.Wood)
  local d = rng:NextNumber(7, 11)
  local g = RGB(56 + rng:NextInteger(0, 30), 116 + rng:NextInteger(0, 40), 48)
  block(f, base, V(d, d, d), CF(0, h + d * 0.3, 0), g, MAT.Grass, BALL)
  if rng:NextNumber() < 0.5 then
    local d2 = d * 0.7
    block(f, base, V(d2, d2, d2), CF(d * 0.3, h + d * 0.62, d * 0.15), g:Lerp(RGB(255, 255, 255), 0.06), MAT.Grass, BALL)
  end
end

-- 一块基地：地面、围墙、路、战场（部署区 / 敌军区）、树、出生点、头顶的名字。返回 { field, sign }
function Models.plot(f, origin, color, index)
  local base = CF(origin)
  local B = Config.BaseSize
  local hs = B / 2
  local Fd = Config.Field
  local D, E = Fd.deploy, Fd.enemy
  local rng = Random.new(index * 97 + 13)

  local slab = block(f, base, V(B, 1, B), CF(0, 0.5, 0), RGB(146, 148, 146), MAT.Concrete)
  slab.Name = "Base"
  -- 部队开出去的通道（深色）：横穿 z = 42，再从中间往前到路上
  ghostly(block(f, base, V(B - 10, 0.08, 9), CF(0, 1.04, 42), RGB(92, 94, 96), MAT.Asphalt))
  ghostly(block(f, base, V(66, 0.08, 40), CF(-4, 1.04, 66), RGB(92, 94, 96), MAT.Asphalt))
  -- 围墙：后面和两边，前面敞开对着战场
  block(f, base, V(B, 3, 1.2), CF(0, 2.5, -hs + 0.6), RGB(120, 122, 118), MAT.Concrete)
  block(f, base, V(1.2, 3, B), CF(-hs + 0.6, 2.5, 0), RGB(120, 122, 118), MAT.Concrete)
  block(f, base, V(1.2, 3, B), CF(hs - 0.6, 2.5, 0), RGB(120, 122, 118), MAT.Concrete)
  -- 出生点
  cyl(f, base, 0.3, 10, CF(0, 1.15, -76), color, MAT.SmoothPlastic)
  cyl(f, base, 0.32, 7, CF(0, 1.16, -76), C.white, MAT.SmoothPlastic)
  -- 路（基地和战场之间）
  local roadZ = (hs + Fd.center - Fd.length / 2) / 2
  local roadL = Fd.center - Fd.length / 2 - hs
  block(f, base, V(B, 1, roadL), CF(0, 0.5, roadZ), C.asphalt, MAT.Asphalt)
  for k = -6, 6 do
    ghostly(block(f, base, V(6, 0.06, 0.6), CF(k * 12, 1.03, roadZ), C.white, MAT.SmoothPlastic))
  end
  -- 战场
  local field = block(f, base, V(Fd.width, 1, Fd.length), CF(0, 0.5, Fd.center), C.ground, MAT.Ground)
  field.Name = "Field"
  local dz = ghostly(block(f, base, V(Fd.width - 4, 0.1, D[2] - D[1]), CF(0, 1.06, (D[1] + D[2]) / 2), color, MAT.SmoothPlastic))
  dz.Name = "DeployZone"
  dz.Transparency = 0.7
  local ez = ghostly(block(f, base, V(Fd.width - 4, 0.1, E[2] - E[1]), CF(0, 1.06, (E[1] + E[2]) / 2), RGB(190, 50, 40), MAT.SmoothPlastic))
  ez.Name = "EnemyZone"
  ez.Transparency = 0.75
  -- 部署区前沿一条亮线
  ghostly(block(f, base, V(Fd.width - 4, 0.12, 0.5), CF(0, 1.08, D[2]), color, MAT.Neon))
  -- 战场四周沙袋
  block(f, base, V(2, 2.4, Fd.length), CF(-Fd.width / 2 - 1, 2.2, Fd.center), C.sand, MAT.Fabric)
  block(f, base, V(2, 2.4, Fd.length), CF(Fd.width / 2 + 1, 2.2, Fd.center), C.sand, MAT.Fabric)
  block(f, base, V(Fd.width + 4, 2.4, 2), CF(0, 2.2, Fd.center + Fd.length / 2 + 1), C.sand, MAT.Fabric)
  -- 战场中间的弹坑、石头（只是装饰，不挡部队）
  for _ = 1, 9 do
    local d = rng:NextNumber(6, 13)
    local p = cyl(f, base, 0.1, d, CF(rng:NextNumber(-90, 90), 1.04, rng:NextNumber(D[2] + 15, E[1] - 15)), RGB(92, 80, 60), MAT.Ground)
    ghostly(p)
  end
  for _ = 1, 6 do
    local d = rng:NextNumber(2.5, 5)
    local side = (rng:NextNumber() < 0.5) and -1 or 1
    ghostly(block(f, base, V(d, d, d), CF(side * rng:NextNumber(80, 104), 1, rng:NextNumber(D[2] + 10, E[1] - 10)), RGB(120, 118, 112), MAT.Slate, BALL))
  end
  -- 树：基地右边的空地（第一块基地左边也种）
  local sides = { 1 }
  if index == 1 then sides = { 1, -1 } end
  for _, s in ipairs(sides) do
    for _ = 1, 26 do
      local x = s * rng:NextNumber(hs + 40, Config.PlotSpacing - Fd.width / 2 - 14)
      local z = rng:NextNumber(-hs + 5, Fd.center + Fd.length / 2)
      tree(f, origin + V(x, 0, z), rng)
    end
  end
  -- 头顶的名字
  local anchor = ghostly(block(f, base, V(1, 1, 1), CF(0, 2, -20), C.white))
  anchor.Transparency = 1
  local _, label = Models.sign(anchor, "空基地", 46, 70, 9, color, 1200)
  return { field = field, sign = label }
end

---------------------------------------------------------------- 建筑

local HOUSE = { house1 = RGB(226, 212, 186), house2 = RGB(186, 206, 222), house3 = RGB(222, 192, 180) }

local function slabUnder(m, base, w, d, color, mat)
  block(m, base, V(w + 3, 0.6, d + 3), CF(0, 0.3, 0), color or C.concrete, mat or MAT.Concrete)
end

local function flag(m, base, at, color)
  cyl(m, base, 16, 0.35, at * CF(0, 0.6 + 8, 0), C.metal, MAT.Metal)
  block(m, base, V(0.15, 2.6, 4.2), at * CF(0, 0.6 + 14.5, 2.2), color, MAT.Fabric)
end

local function house(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  slabUnder(m, base, w, d)
  local body = block(m, base, V(w, h, d), CF(0, 0.6 + h / 2, 0), HOUSE[b.id] or C.white, MAT.SmoothPlastic)
  -- 每层一圈窗户带
  local floors = math.floor(h / 4)
  for k = 1, floors do
    local y = 0.6 + (k - 1) * 4 + 2.4
    if y + 1 < 0.6 + h then
      block(m, base, V(w + 0.3, 1.4, d + 0.3), CF(0, y, 0), C.glass, MAT.Glass)
    end
  end
  block(m, base, V(w + 0.8, 0.7, d + 0.8), CF(0, 0.6 + h + 0.35, 0), C.roof, MAT.Concrete)
  block(m, base, V(w * 0.3, 1.8, d * 0.3), CF(w * 0.2, 0.6 + h + 1.6, d * 0.15), C.metal, MAT.Metal)
  block(m, base, V(3.2, 4.4, 0.6), CF(0, 0.6 + 2.2, -d / 2 - 0.2), C.dark)          -- 门（朝出生点）
  block(m, base, V(w * 0.5, 0.4, 2.4), CF(0, 0.6 + 4.7, -d / 2 - 1.2), C.roof)       -- 雨棚
  return body
end

local function factory(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local hh = h * 0.62
  slabUnder(m, base, w, d)
  local body = block(m, base, V(w, hh, d), CF(0, 0.6 + hh / 2, 0), C.brick, MAT.Brick)
  block(m, base, V(w + 0.6, 0.6, d + 0.6), CF(0, 0.6 + hh + 0.3, 0), C.roof, MAT.Metal)
  for _, s in ipairs({ -1, 1 }) do   -- 天窗
    block(m, base, V(w * 0.8, 1.6, 2.4), CF(0, 0.6 + hh + 1.4, s * d * 0.22), C.glass, MAT.Glass)
  end
  block(m, base, V(w * 0.38, hh * 0.62, 0.6), CF(-w * 0.15, 0.6 + hh * 0.31, -d / 2 - 0.15), C.dark, MAT.DiamondPlate)
  -- 烟囱冒烟（军工联合体两根）
  local n = (b.id == "factory3") and 2 or 1
  for k = 1, n do
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
  block(m, base, V(3, 2, 3), CF(-w / 2 + 5.5, 0.6 + 1, -d / 2 - 3), C.olive, MAT.WoodPlanks)
  return body
end

local function power(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  slabUnder(m, base, w, d)
  local tx = -w / 2 + 6
  local body = cyl(m, base, h, 11, CF(tx, 0.6 + h / 2, 0), RGB(205, 205, 200), MAT.Concrete)   -- 冷却塔
  cyl(m, base, 1, 11.6, CF(tx, 0.6 + h - 0.5, 0), RGB(176, 176, 172), MAT.Concrete)
  local tip = ghostly(block(m, base, V(6, 1, 6), CF(tx, 0.6 + h + 1, 0), C.white))
  tip.Transparency = 1
  local s = Instance.new("Smoke")
  s.Color = RGB(240, 240, 240)
  s.Opacity = 0.3
  s.RiseVelocity = 8
  s.Size = 6
  s.Parent = tip
  block(m, base, V(8, 8, d - 2), CF(w / 2 - 4.5, 0.6 + 4, 0), RGB(110, 120, 130), MAT.Metal)  -- 汽轮机房
  for k = -1, 1 do  -- 变压器
    block(m, base, V(2, 2.4, 2), CF(w / 2 - 4.5, 0.6 + 9.2, k * 4), C.yellow, MAT.Metal)
  end
  return body
end

local function bank(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  block(m, base, V(w + 3, 1.2, d + 3), CF(0, 0.6, 0), RGB(220, 218, 210), MAT.Marble)
  local hb = h * 0.72
  local body = block(m, base, V(w - 2, hb, d - 5), CF(0, 1.2 + hb / 2, 2), RGB(236, 233, 224), MAT.Marble)
  for k = 0, 3 do   -- 门廊柱子（朝出生点）
    cyl(m, base, hb, 1.6, CF(-w / 2 + 2.5 + k * (w - 5) / 3, 1.2 + hb / 2, -d / 2 + 2), RGB(242, 240, 232), MAT.Marble)
  end
  block(m, base, V(w, 2.4, d), CF(0, 1.2 + hb + 1.2, 0), RGB(225, 222, 212), MAT.Marble)
  block(m, base, V(w * 0.6, 3, d * 0.6), CF(0, 1.2 + hb + 3.9, 0), RGB(212, 175, 55), MAT.Metal)  -- 金顶
  block(m, base, V(4, 6, 0.5), CF(0, 1.2 + 3, -d / 2 + 4.6), C.dark)
  return body
end

local function barracks(m, base, b, team)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  slabUnder(m, base, w, d)
  local body = block(m, base, V(w, h, d), CF(0, 0.6 + h / 2, 0), C.olive, MAT.Concrete)
  block(m, base, V(w + 1.2, 0.8, d + 1.2), CF(0, 0.6 + h + 0.4, 0), C.oliveDark, MAT.Concrete)
  block(m, base, V(w + 0.2, 1.2, d + 0.2), CF(0, 0.6 + h * 0.6, 0), C.glass, MAT.Glass)
  block(m, base, V(4, 5, 0.6), CF(0, 0.6 + 2.5, d / 2 + 0.15), C.dark)   -- 门朝战场
  flag(m, base, CF(w / 2 + 2, 0, d / 2 + 2), team)
  block(m, base, V(6, 1.6, 1.2), CF(-4.5, 0.6 + 0.8, d / 2 + 3), C.sand, MAT.Fabric)
  block(m, base, V(6, 1.6, 1.2), CF(4.5, 0.6 + 0.8, d / 2 + 3), C.sand, MAT.Fabric)
  return body
end

local function hangar(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local wall = h * 0.5
  slabUnder(m, base, w, d)
  local body = block(m, base, V(w, wall, d), CF(0, 0.6 + wall / 2, 0), RGB(112, 120, 100), MAT.Metal)
  -- 拱顶：沿 Z 的圆柱，下半截藏在墙里
  local r = w * 0.47
  block(m, base, V(d, r * 2, r * 2), CF(0, 0.6 + wall - r * 0.42, 0) * CFrame.Angles(0, math.pi / 2, 0), RGB(100, 108, 90), MAT.CorrodedMetal, CYL)
  block(m, base, V(w * 0.62, wall * 0.92, 0.6), CF(0, 0.6 + wall * 0.46, d / 2 + 0.15), C.dark, MAT.DiamondPlate)
  local seg = w * 0.62 / 6
  for k = 0, 5 do  -- 门上黄黑警示条
    block(m, base, V(seg, 0.8, 0.7), CF(-w * 0.31 + (k + 0.5) * seg, 0.6 + wall * 0.92 + 0.4, d / 2 + 0.2), (k % 2 == 0) and C.yellow or C.dark)
  end
  return body
end

local function aaShop(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local hh = h * 0.6
  slabUnder(m, base, w, d)
  local body = block(m, base, V(w, hh, d), CF(0, 0.6 + hh / 2, 0), RGB(118, 126, 112), MAT.Concrete)
  block(m, base, V(w * 0.55, hh * 0.8, 0.6), CF(0, 0.6 + hh * 0.4, d / 2 + 0.15), C.dark, MAT.DiamondPlate)
  -- 雷达
  cyl(m, base, 7, 0.6, CF(-w / 2 + 3, 0.6 + hh + 3.5, -d / 2 + 3), C.metal, MAT.Metal)
  block(m, base, V(6, 3, 0.4), CF(-w / 2 + 3, 0.6 + hh + 7.5, -d / 2 + 3) * CFrame.Angles(math.rad(-20), math.rad(30), 0), C.white, MAT.Metal)
  -- 楼顶的双管高炮
  block(m, base, V(3, 1.6, 3), CF(w / 4, 0.6 + hh + 0.8, 0), C.olive, MAT.Metal)
  for _, s in ipairs({ -1, 1 }) do
    block(m, base, V(0.3, 0.3, 4), CF(w / 4 + s * 0.7, 0.6 + hh + 2.4, 1.4) * CFrame.Angles(math.rad(-35), 0, 0), C.gun, MAT.Metal)
  end
  return body
end

local function artyPos(m, base, b)
  local w, d = b.size[1], b.size[3]
  block(m, base, V(w + 3, 0.6, d + 3), CF(0, 0.3, 0), C.sand, MAT.Sand)
  -- 沙袋围成 U 形，口朝战场
  block(m, base, V(w, 3, 2), CF(0, 0.6 + 1.5, -d / 2 + 1), C.sand, MAT.Fabric)
  block(m, base, V(2, 3, d - 2), CF(-w / 2 + 1, 0.6 + 1.5, 0), C.sand, MAT.Fabric)
  block(m, base, V(2, 3, d - 2), CF(w / 2 - 1, 0.6 + 1.5, 0), C.sand, MAT.Fabric)
  -- 一门牵引炮（炮口朝 +Z、往上翘）
  local body = block(m, base, V(3.6, 1.2, 5), CF(0, 0.6 + 1.6, -1), C.olive, MAT.Metal)
  for _, s in ipairs({ -1, 1 }) do
    block(m, base, V(0.8, 2.6, 2.6), CF(s * 2.2, 0.6 + 1.3, -0.5), C.track, MAT.Metal, CYL)
    block(m, base, V(0.4, 0.4, 6), CF(s * 1.2, 0.6 + 0.6, -5) * CFrame.Angles(0, s * 0.25, 0), C.olive, MAT.Metal)
  end
  block(m, base, V(0.5, 0.5, 8), CF(0, 0.6 + 3.2, 2.5) * CFrame.Angles(math.rad(-28), 0, 0), C.gun, MAT.Metal)
  -- 弹药箱、伪装网
  for k = 0, 2 do
    block(m, base, V(2.2, 1.2, 1.4), CF(-w / 2 + 4, 0.6 + 0.6 + k * 1.2, -d / 2 + 4), C.oliveDark, MAT.WoodPlanks)
  end
  local net = block(m, base, V(w * 0.85, 0.2, d * 0.75), CF(0, 0.6 + 7, 0), RGB(70, 88, 52), MAT.Fabric)
  net.Transparency = 0.15
  for _, sx in ipairs({ -1, 1 }) do
    for _, sz in ipairs({ -1, 1 }) do
      cyl(m, base, 7, 0.3, CF(sx * w * 0.4, 0.6 + 3.5, sz * d * 0.35), C.oliveDark, MAT.Wood)
    end
  end
  return body
end

local function helipad(m, base, b)
  local w, d = b.size[1], b.size[3]
  local body = block(m, base, V(w, 0.8, d), CF(0, 0.4, 0), C.asphalt, MAT.Asphalt)
  ghostly(cyl(m, base, 0.1, w * 0.78, CF(0, 0.85, 0), C.yellow))
  ghostly(cyl(m, base, 0.12, w * 0.7, CF(0, 0.86, 0), C.asphalt, MAT.Asphalt))
  ghostly(block(m, base, V(1.4, 0.1, 9), CF(-3, 0.95, 0), C.white))
  ghostly(block(m, base, V(1.4, 0.1, 9), CF(3, 0.95, 0), C.white))
  ghostly(block(m, base, V(6, 0.1, 1.4), CF(0, 0.95, 0), C.white))
  for _, sx in ipairs({ -1, 1 }) do
    for _, sz in ipairs({ -1, 1 }) do
      block(m, base, V(0.8, 0.8, 0.8), CF(sx * (w / 2 - 1), 1.2, sz * (d / 2 - 1)), RGB(80, 255, 120), MAT.Neon)
    end
  end
  cyl(m, base, 8, 0.3, CF(w / 2 + 1.5, 4, -d / 2 + 1.5), C.metal, MAT.Metal)            -- 风向袋
  block(m, base, V(0.8, 0.8, 2.6), CF(w / 2 + 1.5, 7.5, -d / 2 + 2.8), RGB(240, 120, 30), MAT.Fabric)
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
  cyl(m, base, 14, 0.4, CF(w * 0.3, 0.6 + h1 + 7, -d * 0.25), C.metal, MAT.Metal)        -- 天线
  block(m, base, V(0.7, 0.7, 0.7), CF(w * 0.3, 0.6 + h1 + 14.2, -d * 0.25), C.red, MAT.Neon)
  block(m, base, V(5, 2.4, 0.4), CF(w * 0.25, 0.6 + h1 + 2, d * 0.2) * CFrame.Angles(math.rad(-15), math.rad(-25), 0), C.white, MAT.Metal)
  flag(m, base, CF(-w / 2 - 2, 0, d / 2 + 2), team)
  block(m, base, V(5, 5, 0.6), CF(0, 0.6 + 2.5, d / 2 + 0.15), C.dark)
  return body
end

local KIND = { house = house, factory = factory, power = power, bank = bank, hq = hq }
local MIL = { inf = barracks, tank = hangar, aa = aaShop, arty = artyPos, heli = helipad }

-- 建筑：pos 是地面中心（基地地面顶上）；返回 model、主体零件（挂牌子、提示用）
function Models.building(parent, b, pos, team)
  local m = Instance.new("Model")
  m.Name = b.id
  local f = KIND[b.kind]
  if b.kind == "mil" then f = MIL[b.unit] end
  local body = f(m, CF(pos), b, team)
  body.Name = "Body"
  m.PrimaryPart = body
  m.Parent = parent
  return m, body
end

-- 购买按钮：建筑位置上一个全息虚影，前面（-Z 那边，朝出生点）一个发光的圆按钮，踩上去或按 E 就买
function Models.pad(parent, b, pos, team)
  local m = Instance.new("Model")
  m.Name = "Pad_" .. b.id
  local base = CF(pos)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local ghost = ghostly(block(m, base, V(w, h, d), CF(0, h / 2, 0), team, MAT.ForceField))
  ghost.CastShadow = false
  local pad = block(m, base, V(0.7, 7, 7), CF(0, 0.35, -d / 2 - 4.5) * UP, C.green, MAT.Neon, CYL)
  pad.Name = "Pad"
  local desc = ""
  if b.income then desc = "收入 +" .. Config.Fmt(b.income) .. "/秒"
  elseif b.kind == "mil" then desc = "生产" .. Config.Units[b.unit].name
  elseif b.kind == "hq" then desc = "部队上限 " .. b.cap[1]
  elseif b.kind == "power" then desc = "工厂收入 ×" .. Config.PowerBoost
  end
  local _, label = Models.sign(pad, "<b>" .. b.name .. "</b>\n$" .. Config.Fmt(b.price) .. "  " .. desc, 5.5, 15, 4.2, nil, 200)
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

---------------------------------------------------------------- 兵种

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

-- 一个兵种模型的骨架：返回 model、root、add(尺寸, 相对位置, 颜色, 材质, 形状)、rotor(高度, 桨长, 颜色)
local function unitKit()
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
  local function add(size, off, color, mat, shape)
    local p = newPart(m, size, off, color, mat, shape)
    weld(root, p, off)
    return p
  end
  -- 旋翼：桨毂用 Motor6D 接在 Root 上（打上 Rotor 标签，客户端每帧转它的 Transform），桨叶焊在桨毂上
  local function rotor(y, span, color)
    local hub = newPart(m, V(0.8, 0.4, 0.8), CF(0, y, 0), C.gun, MAT.Metal)
    hub.Name = "RotorHub"
    local mot = Instance.new("Motor6D")
    mot.Name = "RotorMotor"
    mot.Part0 = root
    mot.Part1 = hub
    mot.C0 = CF(0, y, 0)
    mot.Parent = hub
    CollectionService:AddTag(mot, "Rotor")
    for _, sz in ipairs({ V(0.7, 0.12, span), V(span, 0.12, 0.7) }) do
      local blade = newPart(m, sz, CF(0, y + 0.22, 0), color, MAT.Metal)
      weld(hub, blade, CF(0, 0.22, 0))
    end
  end
  return m, root, add, rotor
end

local function infantry(add, col)
  for _, o in ipairs({ V(-1.5, 0, 0.8), V(1.5, 0, 0.8), V(0, 0, -1.0) }) do
    local x, z = o.X, o.Z
    add(V(0.9, 1.6, 0.55), CF(x, 0.8, z), C.uniform:Lerp(C.dark, 0.3))     -- 腿
    add(V(1.15, 1.5, 0.65), CF(x, 2.35, z), C.uniform)                      -- 身子
    add(V(0.9, 1.0, 0.4), CF(x, 2.4, z + 0.5), C.oliveDark)                 -- 背包
    add(V(0.7, 0.7, 0.7), CF(x, 3.45, z), C.skin)                           -- 头
    add(V(0.92, 0.38, 0.92), CF(x, 3.86, z), col)                           -- 头盔（队伍颜色）
    add(V(0.16, 0.22, 1.7), CF(x + 0.42, 2.45, z - 0.75), C.gun, MAT.Metal) -- 步枪
  end
end

local function tank(add, col)
  local dk = darker(col, 0.3)
  add(V(1.5, 1.6, 9.2), CF(-2.85, 0.8, 0), C.track, MAT.Metal)
  add(V(1.5, 1.6, 9.2), CF(2.85, 0.8, 0), C.track, MAT.Metal)
  add(V(4.4, 1.3, 8.6), CF(0, 1.65, 0.1), col, MAT.Metal)
  add(V(5.9, 0.35, 8.8), CF(0, 2.45, 0.2), dk, MAT.Metal)        -- 挡泥板 / 车顶
  add(V(3.8, 1.3, 4.4), CF(0, 3.25, 0.8), col, MAT.Metal)        -- 炮塔
  add(V(3.2, 0.9, 1.4), CF(0, 3.2, 3.4), dk, MAT.Metal)          -- 炮塔尾舱
  add(V(0.45, 0.45, 5.6), CF(0, 3.35, -4.0), C.gun, MAT.Metal)   -- 炮管
  add(V(0.75, 0.75, 0.8), CF(0, 3.35, -7.0), C.gun, MAT.Metal)   -- 炮口
  add(V(0.9, 0.55, 0.9), CF(1.0, 4.15, 1.6), dk, MAT.Metal)      -- 车长舱盖
  add(V(0.15, 0.15, 1.6), CF(1.0, 4.6, 1.0), C.gun, MAT.Metal)   -- 机枪
end

local function aa(add, col)
  local dk = darker(col, 0.3)
  add(V(1.4, 1.4, 8.2), CF(-2.6, 0.7, 0), C.track, MAT.Metal)
  add(V(1.4, 1.4, 8.2), CF(2.6, 0.7, 0), C.track, MAT.Metal)
  add(V(4.2, 1.3, 7.8), CF(0, 1.55, 0), col, MAT.Metal)
  add(V(5.4, 0.3, 8.0), CF(0, 2.3, 0), dk, MAT.Metal)
  add(V(3.4, 1.8, 3.6), CF(0, 3.35, 0.6), col, MAT.Metal)        -- 炮塔
  for _, s in ipairs({ -1, 1 }) do
    add(V(0.9, 1.0, 2.0), CF(s * 2.15, 3.4, 0.3), dk, MAT.Metal) -- 炮箱
    -- 炮管往前上方翘 32°（绕 X 转正角，-Z 那头抬起来）
    add(V(0.28, 0.28, 3.6), CF(s * 2.15, 4.4, -1.4) * CFrame.Angles(math.rad(32), 0, 0), C.gun, MAT.Metal)
  end
  add(V(0.3, 1.6, 0.3), CF(0, 4.9, 2.0), C.metal, MAT.Metal)     -- 雷达杆
  add(V(2.6, 1.3, 0.25), CF(0, 5.9, 2.0) * CFrame.Angles(math.rad(-15), 0, 0), C.white, MAT.Metal)
end

local function arty(add, col)
  local dk = darker(col, 0.3)
  add(V(1.5, 1.6, 9.4), CF(-2.9, 0.8, 0), C.track, MAT.Metal)
  add(V(1.5, 1.6, 9.4), CF(2.9, 0.8, 0), C.track, MAT.Metal)
  add(V(4.4, 1.3, 9.0), CF(0, 1.65, 0), col, MAT.Metal)
  add(V(5.9, 0.3, 9.2), CF(0, 2.45, 0), dk, MAT.Metal)
  add(V(4.6, 2.3, 5.4), CF(0, 3.75, 1.4), col, MAT.Metal)        -- 大炮塔（靠后）
  local a = math.rad(22)
  local L = 7.6
  local dir = V(0, math.sin(a), -math.cos(a))
  local root = V(0, 4.0, -1.2)
  add(V(0.55, 0.55, L), CF(root + dir * (L / 2)) * CFrame.Angles(a, 0, 0), C.gun, MAT.Metal)
  add(V(0.85, 0.85, 0.9), CF(root + dir * L) * CFrame.Angles(a, 0, 0), C.gun, MAT.Metal)
  add(V(1.0, 0.5, 1.0), CF(1.2, 5.15, 2.6), dk, MAT.Metal)
end

local function heli(add, col, rotor)
  local dk = darker(col, 0.3)
  for _, s in ipairs({ -1, 1 }) do   -- 起落橇
    add(V(0.25, 0.25, 6.2), CF(s * 1.5, 0.15, 0), C.gun, MAT.Metal)
    add(V(0.2, 1.4, 0.2), CF(s * 1.3, 0.9, -1.6), C.gun, MAT.Metal)
    add(V(0.2, 1.4, 0.2), CF(s * 1.3, 0.9, 1.6), C.gun, MAT.Metal)
  end
  add(V(2.4, 2.2, 6.4), CF(0, 2.7, 0.2), col, MAT.Metal)         -- 机身
  add(V(2.0, 1.6, 2.2), CF(0, 2.6, -3.9), col, MAT.Metal)        -- 机头
  local glass = add(V(1.7, 1.2, 2.6), CF(0, 3.5, -2.6), RGB(120, 180, 210), MAT.Glass)
  glass.Transparency = 0.25
  add(V(0.8, 0.8, 6.6), CF(0, 3.1, 6.6), col, MAT.Metal)         -- 尾梁
  add(V(0.25, 2.4, 1.4), CF(0, 4.0, 9.6), dk, MAT.Metal)         -- 垂尾
  add(V(3.2, 0.2, 1.0), CF(0, 3.0, 9.2), dk, MAT.Metal)          -- 平尾
  add(V(5.8, 0.25, 1.3), CF(0, 2.5, 0.4), dk, MAT.Metal)         -- 短翼
  for _, s in ipairs({ -1, 1 }) do
    add(V(0.7, 0.7, 2.0), CF(s * 2.6, 2.05, 0.2), C.gun, MAT.Metal)  -- 火箭巢
  end
  add(V(0.15, 1.8, 0.15), CF(0.3, 4.0, 9.9), C.gun, MAT.Metal)   -- 尾桨
  add(V(0.15, 0.15, 1.8), CF(0.3, 4.0, 9.9), C.gun, MAT.Metal)
  add(V(0.6, 0.8, 0.6), CF(0, 4.1, 0), C.gun, MAT.Metal)         -- 旋翼轴
  rotor(4.6, 13, dk)
end

-- 兵种的高度（血条、瞄准点）和炮口位置（模型坐标）
Models.UnitInfo = {
  inf = { h = 4.3, muzzle = V(0.4, 2.5, -1.8) },
  tank = { h = 4.8, muzzle = V(0, 3.35, -7.5) },
  aa = { h = 6.4, muzzle = V(2.15, 5.35, -2.95) },
  arty = { h = 5.2, muzzle = V(0, 6.85, -8.3) },
  heli = { h = 5.0, muzzle = V(2.6, 2.05, -1.2) },
}

local BUILD_UNIT = { inf = infantry, tank = tank, aa = aa, arty = arty, heli = heli }

-- 兵种模型（还没放进 workspace；放进去以后改 root.CFrame 摆位置）
function Models.unit(t, color)
  local m, root, add, rotor = unitKit()
  m.Name = t
  BUILD_UNIT[t](add, color:Lerp(C.olive, 0.2), rotor)
  return m, root
end

-- 血条（战斗时才显示）
function Models.hpBar(root, height, color)
  local bb = Instance.new("BillboardGui")
  bb.Name = "HP"
  bb.Size = UDim2.fromOffset(46, 6)
  bb.StudsOffsetWorldSpace = V(0, height, 0)
  bb.AlwaysOnTop = true
  bb.LightInfluence = 0
  bb.MaxDistance = 700
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

return Models
