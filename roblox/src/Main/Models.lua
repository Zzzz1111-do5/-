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
local function battlefield(f, origin, colorA, colorB, rng)
  local base = CF(origin)
  local Fd = Config.Field
  local D, E = Fd.deploy, Fd.enemy
  local field = block(f, base, V(Fd.width, 1, Fd.length), CF(0, 0.5, Fd.center), C.ground, MAT.Ground)
  field.Name = "Field"
  local dz = ghostly(block(f, base, V(Fd.width - 6, 0.1, D[2] - D[1]), CF(0, 1.06, (D[1] + D[2]) / 2), colorA, MAT.SmoothPlastic))
  dz.Name = "DeployZone"
  dz.Transparency = 0.72
  local ez = ghostly(block(f, base, V(Fd.width - 6, 0.1, E[2] - E[1]), CF(0, 1.06, (E[1] + E[2]) / 2), colorB, MAT.SmoothPlastic))
  ez.Name = "EnemyZone"
  ez.Transparency = 0.75
  ghostly(block(f, base, V(Fd.width - 6, 0.12, 0.8), CF(0, 1.08, D[2]), colorA, MAT.Neon))
  ghostly(block(f, base, V(Fd.width - 6, 0.12, 0.8), CF(0, 1.08, E[1]), colorB, MAT.Neon))
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

  local slab = block(f, base, V(B, 1, B), CF(0, 0.5, 0), RGB(146, 148, 146), MAT.Concrete)
  slab.Name = "Base"
  -- 部队开出去的通道（深色）：横穿 z = 60，再从中间往前到路上
  ghostly(block(f, base, V(B - 12, 0.08, 28), CF(0, 1.04, 60), RGB(92, 94, 96), MAT.Asphalt))
  ghostly(block(f, base, V(120, 0.08, hs - 60), CF(-10, 1.04, (hs + 60) / 2), RGB(92, 94, 96), MAT.Asphalt))
  -- 围墙：后面和两边，前面敞开对着战场
  block(f, base, V(B, 4, 1.5), CF(0, 3, -hs + 0.75), RGB(120, 122, 118), MAT.Concrete)
  block(f, base, V(1.5, 4, B), CF(-hs + 0.75, 3, 0), RGB(120, 122, 118), MAT.Concrete)
  block(f, base, V(1.5, 4, B), CF(hs - 0.75, 3, 0), RGB(120, 122, 118), MAT.Concrete)
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
  local field = battlefield(f, origin, color, RGB(190, 50, 40), rng)
  -- 树：基地右边的空地（空军基地再往右；第一块基地左边也种）
  local sides = { 1 }
  if index == 1 then sides = { 1, -1 } end
  for _, sd in ipairs(sides) do
    for _ = 1, 34 do
      local x = sd * rng:NextNumber(hs + 140, Config.PlotSpacing - Fd.width / 2 - 20)
      local z = rng:NextNumber(-hs + 5, Fd.center + Fd.length / 2)
      tree(f, origin + V(x, 0, z), rng)
    end
  end
  -- 头顶的名字
  local anchor = ghostly(block(f, base, V(1, 1, 1), CF(0, 2, -20), C.white))
  anchor.Transparency = 1
  local _, label = Models.sign(anchor, "空基地", 70, 100, 13, color, 1600)
  -- 排行榜牌子（出生点后面的墙上，朝出生点）
  local board = block(f, base, V(54, 22, 1), CF(0, 14, -hs + 2), RGB(24, 28, 34), MAT.SmoothPlastic)
  board.Name = "Board"
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
  local field = battlefield(f, origin, RGB(60, 140, 230), RGB(230, 70, 60), rng)
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
  return body
end

local function barracks(m, base, b, team)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  slabUnder(m, base, w, d)
  local body = block(m, base, V(w, h, d), CF(0, 0.6 + h / 2, 0), C.olive, MAT.Concrete)
  block(m, base, V(w + 1.2, 0.8, d + 1.2), CF(0, 0.6 + h + 0.4, 0), C.oliveDark, MAT.Concrete)
  block(m, base, V(w + 0.2, 1.2, d + 0.2), CF(0, 0.6 + h * 0.6, 0), C.glass, MAT.Glass)
  block(m, base, V(5, 6, 0.6), CF(0, 0.6 + 3, d / 2 + 0.15), C.dark)
  flag(m, base, CF(w / 2 + 2, 0, d / 2 + 2), team)
  block(m, base, V(7, 1.8, 1.4), CF(-6, 0.6 + 0.9, d / 2 + 4), C.sand, MAT.Fabric)
  block(m, base, V(7, 1.8, 1.4), CF(6, 0.6 + 0.9, d / 2 + 4), C.sand, MAT.Fabric)
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
  return body
end

local function aaShop(m, base, b)
  local w, h, d = b.size[1], b.size[2], b.size[3]
  local hh = h * 0.6
  slabUnder(m, base, w, d)
  local body = block(m, base, V(w, hh, d), CF(0, 0.6 + hh / 2, 0), RGB(118, 126, 112), MAT.Concrete)
  block(m, base, V(w * 0.55, hh * 0.8, 0.6), CF(0, 0.6 + hh * 0.4, d / 2 + 0.15), C.dark, MAT.DiamondPlate)
  cyl(m, base, 7, 0.6, CF(-w / 2 + 3, 0.6 + hh + 3.5, -d / 2 + 3), C.metal, MAT.Metal)
  block(m, base, V(6, 3, 0.4), CF(-w / 2 + 3, 0.6 + hh + 7.5, -d / 2 + 3) * CFrame.Angles(math.rad(-20), math.rad(30), 0), C.white, MAT.Metal)
  block(m, base, V(3, 1.6, 3), CF(w / 4, 0.6 + hh + 0.8, 0), C.olive, MAT.Metal)
  for _, s in ipairs({ -1, 1 }) do
    block(m, base, V(0.3, 0.3, 4), CF(w / 4 + s * 0.7, 0.6 + hh + 2.4, 1.4) * CFrame.Angles(math.rad(-35), 0, 0), C.gun, MAT.Metal)
  end
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

local function helipad(m, base, b)
  local w, d = b.size[1], b.size[3]
  local body = block(m, base, V(w, 0.8, d), CF(0, 0.4, 0), C.asphalt, MAT.Asphalt)
  ghostly(cyl(m, base, 0.1, w * 0.78, CF(0, 0.85, 0), C.yellow))
  ghostly(cyl(m, base, 0.12, w * 0.7, CF(0, 0.86, 0), C.asphalt, MAT.Asphalt))
  ghostly(block(m, base, V(2, 0.1, 14), CF(-4.5, 0.95, 0), C.white))
  ghostly(block(m, base, V(2, 0.1, 14), CF(4.5, 0.95, 0), C.white))
  ghostly(block(m, base, V(9, 0.1, 2), CF(0, 0.95, 0), C.white))
  for _, sx in ipairs({ -1, 1 }) do
    for _, sz in ipairs({ -1, 1 }) do block(m, base, V(1, 1, 1), CF(sx * (w / 2 - 1), 1.2, sz * (d / 2 - 1)), RGB(80, 255, 120), MAT.Neon) end
  end
  cyl(m, base, 9, 0.3, CF(w / 2 + 2, 4.5, -d / 2 + 2), C.metal, MAT.Metal)
  block(m, base, V(0.9, 0.9, 3), CF(w / 2 + 2, 8.5, -d / 2 + 3.5), RGB(240, 120, 30), MAT.Fabric)
  return body
end

-- 空军基地：在围墙外的草地上（底板从地面铺起），跑道沿 Z（喷气机从 −Z 那头滑跑，往战场方向起飞），右边两座机库，左边塔台
local function airbase(m, base, b)
  local w, d = b.size[1], b.size[3]
  local body = block(m, base, V(w, 1.2, d), CF(0, -0.4, 0), RGB(150, 152, 148), MAT.Concrete)
  ghostly(block(m, base, V(22, 0.1, d - 8), CF(0, 0.25, 0), C.asphalt, MAT.Asphalt))
  for k = -7, 7 do ghostly(block(m, base, V(0.8, 0.06, 8), CF(0, 0.32, k * 15), C.white)) end
  for _, sx in ipairs({ -1, 1 }) do ghostly(block(m, base, V(0.5, 0.06, d - 10), CF(sx * 10, 0.32, 0), C.white)) end
  for _, sz in ipairs({ -1, 1 }) do
    for k = -4, 4 do block(m, base, V(0.6, 0.4, 0.6), CF(k * 2.4, 0.4, sz * (d / 2 - 2)), (sz < 0) and RGB(80, 255, 120) or RGB(255, 80, 70), MAT.Neon) end
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
  block(m, base, V(0.7, 0.7, 0.7), CF(w * 0.3, 0.6 + h1 + 14.2, -d * 0.25), C.red, MAT.Neon)
  block(m, base, V(5, 2.4, 0.4), CF(w * 0.25, 0.6 + h1 + 2, d * 0.2) * CFrame.Angles(math.rad(-15), math.rad(-25), 0), C.white, MAT.Metal)
  flag(m, base, CF(-w / 2 - 2, 0, d / 2 + 2), team)
  block(m, base, V(5, 5, 0.6), CF(0, 0.6 + 2.5, d / 2 + 0.15), C.dark)
  return body
end

local KIND = { house = house, factory = factory, power = power, bank = bank, hq = hq }
local MIL = { barracks = barracks, tankfac = hangar, aafac = aaShop, artyfac = artyPos, helipad = helipad, airbase = airbase }

-- 建筑：pos 是地面中心（基地地面顶上）；返回 model、主体零件（挂牌子、提示用）
function Models.building(parent, b, pos, team)
  local m = Instance.new("Model")
  m.Name = b.id
  local f = KIND[b.kind]
  if b.kind == "mil" then f = MIL[b.id] or barracks end
  local body = f(m, CF(pos), b, team)
  body.Name = "Body"
  m.PrimaryPart = body
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

-- 把导入的模型整理成模板：用 _Front / _Top 标记摆正（不管导入时坐标怎么换的），缩放到长度 len（士兵按身高 5.2），底面中心放到原点，读转轴标记
local function prepare(slot, model)
  local parts, marks = {}, {}
  for _, d in ipairs(model:GetDescendants()) do
    if d:IsA("BasePart") then
      d.Anchored = true   -- 导入时没锚定的话，一开始游戏就会往下掉、散开
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
    local up = (marks._Top.Position - c).Unit
    local f = marks._Front.Position - c
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
    local pos = p.Position * k
    p.Size = p.Size * k
    p.CFrame = CF(pos) * rotOnly(p.CFrame)
  end
  -- 3）底面中心到原点
  mn, mx = bounds(parts)
  local shift = V((mn.X + mx.X) / 2, mn.Y, (mn.Z + mx.Z) / 2)
  for _, p in ipairs(all) do p.CFrame = p.CFrame - shift end
  mn, mx = bounds(parts)
  local T = { parts = {}, pivots = {}, h = mx.Y - mn.Y }
  for name, p in pairs(marks) do T.pivots[name] = p.Position end
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

-- 开服时找导入的模型（ReplicatedStorage.UnitModels、ServerStorage、Workspace、ReplicatedStorage 里叫这些名字的 Model），整理成模板收进 ServerStorage
function Models.loadImported()
  local store = Instance.new("Folder")
  store.Name = "UnitTemplates"
  store.Parent = ServerStorage
  local places = { ServerStorage, workspace, RS }
  local um = RS:FindFirstChild("UnitModels")
  if um then table.insert(places, 1, um) end
  local found = {}
  for _, place in ipairs(places) do
    for _, ch in ipairs(place:GetChildren()) do
      if ch:IsA("Model") and SLOTS[ch.Name] and not TEMPLATES[ch.Name] then
        local ok, T = pcall(prepare, ch.Name, ch)
        if ok and T then
          TEMPLATES[ch.Name] = T
          ch.Parent = store
          table.insert(found, ch.Name)
        elseif not ok then
          warn("[军事大亨] 导入的模型 " .. ch.Name .. " 整理失败：" .. tostring(T))
        end
      end
    end
  end
  return found
end

---------------------------------------------------------------- 兵种：生成

-- 兵种的高度（血条、瞄准点）：导入模型按模板，零件模型按设计
local function heightOf(t)
  local def = Config.Units[t]
  if def.foot then return 5.2 end
  local T = TEMPLATES[def.model]
  local k = def.boss and 1.36 or 1
  if T then return T.h * k end
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
      local cf = off * CF(p.Position * k) * rotOnly(p.CFrame)
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
    addTemplate(m, root, T, k, { CF() }, false)
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
