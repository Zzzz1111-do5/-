-- 军事大亨：场景——光影、地形世界（起伏的山丘和树林、四周的雪山、基地后面的湖、战场北边的河和桥）、
-- 基地外围（带立柱和铁丝网的围墙、四角哨塔和探照灯、北门岗亭和栏杆、路灯、沙袋、物资堆、停着的卡车）、
-- 战场战区（绿野、沙漠、雪原、城市废墟、火山：地面材质、两边地形、主题道具，换战区时整个重摆）
-- 都是锚定的静态零件和地形；小装饰不挡人、不挡射线、不投影，省性能
local Lighting = game:GetService("Lighting")

local Scenery = {}

local V = Vector3.new
local CF = CFrame.new
local RGB = Color3.fromRGB
local MAT = Enum.Material
local CYL = Enum.PartType.Cylinder
local BALL = Enum.PartType.Ball
local UP = CFrame.Angles(0, 0, math.pi / 2)   -- Roblox 圆柱的轴在 X：转 90° 立起来

-- 零件：solid 挡人（墙、塔、楼），否则是装饰（不挡人、不挡射线、小的不投影）
local function part(parent, size, cf, color, mat, shape, solid)
  local p = Instance.new("Part")
  if shape then p.Shape = shape end
  p.Anchored = true
  p.Size = size
  p.CFrame = cf
  p.Color = color
  p.Material = mat or MAT.SmoothPlastic
  p.TopSurface = Enum.SurfaceType.Smooth
  p.BottomSurface = Enum.SurfaceType.Smooth
  if not solid then
    p.CanCollide = false
    p.CanQuery = false
    p.CanTouch = false
    if size.Magnitude < 6 then p.CastShadow = false end
  end
  p.Parent = parent
  return p
end
Scenery.part = part
local function cyl(parent, h, dia, cf, color, mat, solid)   -- 竖直圆柱：cf 是中心
  return part(parent, V(h, dia, dia), cf * UP, color, mat, CYL, solid)
end
local function ball(parent, d, cf, color, mat)
  return part(parent, V(d, d, d), cf, color, mat, BALL, false)
end

---------------------------------------------------------------- 光影

function Scenery.lighting()
  pcall(function()
    Lighting.ClockTime = 14.6
    Lighting.GeographicLatitude = 32
    Lighting.Brightness = 3
    Lighting.GlobalShadows = true
    Lighting.Ambient = RGB(64, 66, 74)
    Lighting.OutdoorAmbient = RGB(128, 132, 140)
    Lighting.ColorShift_Top = RGB(255, 242, 222)
    Lighting.EnvironmentDiffuseScale = 1
    Lighting.EnvironmentSpecularScale = 1
    Lighting.ShadowSoftness = 0.22
    Lighting.ExposureCompensation = 0.1
  end)
  local function ensure(cls, props)
    local o = Lighting:FindFirstChildOfClass(cls)
    if not o then
      o = Instance.new(cls)
      for k, v in pairs(props) do pcall(function() o[k] = v end) end
      o.Parent = Lighting
    end
    return o
  end
  ensure("Atmosphere", { Density = 0.3, Offset = 0.22, Haze = 1.5, Glare = 0.35, Color = RGB(200, 214, 232), Decay = RGB(104, 112, 128) })
  ensure("Sky", { SunAngularSize = 12, MoonAngularSize = 9, StarCount = 3000, CelestialBodiesShown = true })
  ensure("BloomEffect", { Intensity = 0.55, Size = 26, Threshold = 1.35 })
  ensure("ColorCorrectionEffect", { Contrast = 0.08, Saturation = 0.12, Brightness = 0.02, TintColor = RGB(255, 250, 242) })
  ensure("SunRaysEffect", { Intensity = 0.06, Spread = 0.55 })
  -- 体积云
  pcall(function()
    local T = workspace.Terrain
    if not T:FindFirstChildOfClass("Clouds") then
      local c = Instance.new("Clouds")
      c.Cover = 0.52
      c.Density = 0.55
      c.Color = RGB(250, 250, 252)
      c.Parent = T
    end
    T.Decoration = true   -- 草地上长草
    T.WaterColor = RGB(38, 92, 112)
    T.WaterTransparency = 0.6
    T.WaterReflectance = 0.6
    T.WaterWaveSize = 0.12
    T.WaterWaveSpeed = 9
  end)
end

---------------------------------------------------------------- 地形世界

-- 地形要避开的地方：基地、路、战场、空军基地跑道、竞技场（返回 true 表示这里不能起伏）
local function reserved(Config, x, z, margin)
  local F = Config.Field
  margin = margin or 0
  local hs = Config.BaseSize / 2
  for i = 1, Config.PlotCount do
    local cx = (i - (Config.PlotCount + 1) / 2) * Config.PlotSpacing
    local dx = x - cx
    if math.abs(dx) < hs + 30 + margin and z > -hs - 30 - margin and z < hs + 40 + margin then return true end              -- 基地
    if math.abs(dx) < F.width / 2 + 30 + margin and z > hs - margin and z < F.center + F.length / 2 + 40 + margin then return true end   -- 路 + 战场
    if dx > 150 - margin and dx < 262 + margin and z > -hs - 20 - margin and z < hs + margin then return true end           -- 空军基地
    local I = Config.Industry
    if dx > I.x0 - 12 - margin and dx < I.x1 + margin and z > I.z0 - 12 - margin and z < I.z1 + 12 + margin then return true end   -- 西边工业区
    if math.abs(dx) < 404 + margin and z > -314 - margin and z < -126 + margin then return true end   -- 南门外的路、重生开放的三块新区域
    if math.abs(dx) < 36 + margin and z > -356 - margin and z < -300 + margin then return true end    -- 港口区伸进湖里的码头
  end
  for _, ax in ipairs(Config.Arena.xs) do
    if math.abs(x - ax) < F.width / 2 + 40 + margin and z > Config.Arena.z + F.center - F.length / 2 - 40 - margin and z < Config.Arena.z + F.center + F.length / 2 + 40 + margin then return true end
  end
  return false
end
Scenery.reserved = reserved

-- 铺地形；返回 groundY(x, z)（山丘表面的高度，种树用）和河、湖的范围
function Scenery.terrain(Config)
  local T = workspace.Terrain
  local F = Config.Field
  local rng = Random.new(20241106)
  local W = Config.PlotCount * Config.PlotSpacing / 2
  local X0, X1 = -W - 700, W + 700
  local Z0, Z1 = -1050, Config.Arena.z + F.center + F.length / 2 + 650
  -- 1) 底：一整层草地，顶面 y = 0（分块填）
  local x = X0
  while x < X1 do
    local w = math.min(512, X1 - x)
    local z = Z0
    while z < Z1 do
      local d = math.min(512, Z1 - z)
      T:FillBlock(CFrame.new(x + w / 2, -8, z + d / 2), V(w, 16, d), MAT.Grass)
      z = z + d
    end
    x = x + w
  end
  local hills = {}
  local function hill(cx, cz, r, mat, k)
    local cy = -r * (k or 0.55)
    T:FillBall(V(cx, cy, cz), r, mat or MAT.Grass)
    table.insert(hills, { x = cx, y = cy, z = cz, r = r })
  end
  -- 2) 湖：基地后面一长条（先挖空、再灌水、两边沙滩）
  local lakeZ0, lakeZ1 = -330, -470
  T:FillBlock(CFrame.new(0, -1, (lakeZ0 + lakeZ1) / 2), V(X1 - X0, 2, lakeZ0 - lakeZ1 + 50), MAT.Sand)
  T:FillBlock(CFrame.new(0, -6, (lakeZ0 + lakeZ1) / 2), V(X1 - X0 - 40, 12, lakeZ0 - lakeZ1), MAT.Air)
  T:FillBlock(CFrame.new(0, -7.5, (lakeZ0 + lakeZ1) / 2), V(X1 - X0 - 40, 9, lakeZ0 - lakeZ1), MAT.Water)
  -- 3) 河：战场北边、竞技场南边
  local rz0 = F.center + F.length / 2 + 120
  local rz1 = rz0 + 90
  T:FillBlock(CFrame.new(0, -1, (rz0 + rz1) / 2), V(X1 - X0, 2, rz1 - rz0 + 40), MAT.Sand)
  T:FillBlock(CFrame.new(0, -6, (rz0 + rz1) / 2), V(X1 - X0, 12, rz1 - rz0), MAT.Air)
  T:FillBlock(CFrame.new(0, -7.5, (rz0 + rz1) / 2), V(X1 - X0, 9, rz1 - rz0), MAT.Water)
  -- 4) 起伏的山丘：基地之间、战场之间的空地（避开基地、路、战场、跑道），草地上点缀林地、泥土、岩石
  local tries = 0
  local placed = 0
  while placed < 150 and tries < 3000 do
    tries = tries + 1
    local hx = rng:NextNumber(X0 + 200, X1 - 200)
    local hz = rng:NextNumber(-300, Config.Arena.z + F.center + F.length / 2 + 200)
    local r = rng:NextNumber(55, 130)
    local inRiver = hz + r > rz0 - 30 and hz - r < rz1 + 30
    if not inRiver and not reserved(Config, hx, hz, r * 0.75) then
      local m = MAT.Grass
      local roll = rng:NextNumber()
      if roll < 0.3 then m = MAT.LeafyGrass elseif roll < 0.4 then m = MAT.Ground end
      hill(hx, hz, r, m, rng:NextNumber(0.5, 0.7))
      if rng:NextNumber() < 0.25 then T:FillBall(V(hx + rng:NextNumber(-r, r) * 0.4, -r * 0.2, hz + rng:NextNumber(-r, r) * 0.4), r * 0.35, MAT.Rock) end
      placed = placed + 1
    end
  end
  -- 5) 四周的大山（顶上积雪）：南边湖后面、北边竞技场后面、东西两头
  local function mountain(mx, mz, r)
    local cy = -r * 0.25
    T:FillBall(V(mx, cy, mz), r, MAT.Rock)
    T:FillBall(V(mx, cy - r * 0.15, mz), r * 1.08, MAT.Grass)
    T:FillBall(V(mx, cy + r * 0.62, mz), r * 0.42, MAT.Snow)
    T:FillBall(V(mx + r * 0.25, cy + r * 0.45, mz - r * 0.1), r * 0.3, MAT.Slate)
  end
  for mx = X0 + 100, X1 - 100, 380 do
    mountain(mx + rng:NextNumber(-80, 80), lakeZ1 - 330 + rng:NextNumber(-60, 60), rng:NextNumber(230, 360))
    mountain(mx + rng:NextNumber(-80, 80), Z1 - 120 + rng:NextNumber(-60, 60), rng:NextNumber(250, 380))
  end
  for mz = -300, Z1 - 300, 420 do
    mountain(X0 + 40 + rng:NextNumber(-40, 40), mz + rng:NextNumber(-80, 80), rng:NextNumber(220, 340))
    mountain(X1 - 40 + rng:NextNumber(-40, 40), mz + rng:NextNumber(-80, 80), rng:NextNumber(220, 340))
  end
  local function groundY(px, pz)
    local y = 0
    for _, h in ipairs(hills) do
      local dx, dz = px - h.x, pz - h.z
      local d2 = dx * dx + dz * dz
      if d2 < h.r * h.r then y = math.max(y, h.y + math.sqrt(h.r * h.r - d2)) end
    end
    return y
  end
  return groundY, { rz0 = rz0, rz1 = rz1, lakeZ0 = lakeZ0, lakeZ1 = lakeZ1, X0 = X0, X1 = X1, hills = hills }
end

---------------------------------------------------------------- 植物、石头

-- 阔叶树：树干 + 几团树冠；针叶树：树干 + 一层层往上收的「圆盘」；snow 给针叶树顶上积雪
local function broadleaf(f, pos, rng, s)
  s = s or 1
  local h = rng:NextNumber(7, 12) * s
  cyl(f, h, 1.6 * s, CF(pos + V(0, h / 2, 0)), RGB(98, 74, 52), MAT.Wood)
  local g = RGB(52 + rng:NextInteger(0, 26), 108 + rng:NextInteger(0, 40), 44)
  for i = 1, 3 do
    local d = rng:NextNumber(7, 12) * s
    local o = V(rng:NextNumber(-2.5, 2.5) * s, h + rng:NextNumber(-1, 3) * s, rng:NextNumber(-2.5, 2.5) * s)
    if i == 1 then o = V(0, h + 2 * s, 0) end
    ball(f, d, CF(pos + o), g:Lerp(RGB(30, 60, 20), rng:NextNumber() * 0.25), MAT.Grass)
  end
end
local function pine(f, pos, rng, s, snow)
  s = s or 1
  local h = rng:NextNumber(14, 22) * s
  cyl(f, h * 0.45, 1.1 * s, CF(pos + V(0, h * 0.22, 0)), RGB(84, 62, 44), MAT.Wood)
  local g = snow and RGB(46, 78, 58) or RGB(38 + rng:NextInteger(0, 18), 82 + rng:NextInteger(0, 26), 46)
  local n = 5
  for i = 1, n do
    local k = (i - 1) / (n - 1)
    local dia = (10 - 7.5 * k) * s
    local y = h * (0.22 + 0.66 * k)
    cyl(f, 2.6 * s, dia, CF(pos + V(0, y, 0)), g, MAT.Grass)
    if snow then cyl(f, 0.5 * s, dia * 0.86, CF(pos + V(0, y + 1.4 * s, 0)), RGB(240, 244, 250), MAT.Snow) end
  end
end
local function rock(f, pos, rng, s)
  local d = rng:NextNumber(3, 8) * (s or 1)
  local p = part(f, V(d, d * rng:NextNumber(0.5, 0.8), d * rng:NextNumber(0.7, 1.1)), CF(pos + V(0, d * 0.2, 0)) * CFrame.Angles(rng:NextNumber(-0.3, 0.3), rng:NextNumber(0, 6), rng:NextNumber(-0.3, 0.3)),
    RGB(118, 116, 110):Lerp(RGB(80, 80, 76), rng:NextNumber()), MAT.Slate, BALL)
  return p
end
local function bush(f, pos, rng)
  for _ = 1, 3 do
    local d = rng:NextNumber(3, 5.5)
    ball(f, d, CF(pos + V(rng:NextNumber(-1.5, 1.5), d * 0.3, rng:NextNumber(-1.5, 1.5))), RGB(58, 100 + rng:NextInteger(0, 30), 46), MAT.Grass)
  end
end
Scenery.broadleaf, Scenery.pine, Scenery.rock, Scenery.bush = broadleaf, pine, rock, bush

-- 地图上的树林（长在山丘上、湖边、河边）、石头、灌木，河上的桥
function Scenery.nature(parent, Config, groundY, info)
  local f = Instance.new("Folder")
  f.Name = "Nature"
  local rng = Random.new(77001)
  local F = Config.Field
  local n, tries = 0, 0
  while n < 460 and tries < 9000 do
    tries = tries + 1
    local x = rng:NextNumber(info.X0 + 250, info.X1 - 250)
    local z = rng:NextNumber(-300, Config.Arena.z + F.center + F.length / 2 + 220)
    local inRiver = z > info.rz0 - 25 and z < info.rz1 + 25
    if not inRiver and not reserved(Config, x, z, 6) then
      local y = groundY(x, z)
      local pos = V(x, y - 0.5, z)
      local r = rng:NextNumber()
      -- 山丘上（高处）多针叶，平地多阔叶
      if r < 0.45 then
        pine(f, pos, rng, rng:NextNumber(0.8, 1.3), false)
      elseif r < 0.8 then
        broadleaf(f, pos, rng, rng:NextNumber(0.8, 1.25))
      elseif r < 0.92 then
        bush(f, pos, rng)
      else
        rock(f, pos, rng, rng:NextNumber(0.8, 2))
      end
      n = n + 1
    end
  end
  -- 湖边一排树
  for x = info.X0 + 300, info.X1 - 300, 34 do
    if rng:NextNumber() < 0.6 then
      local z = info.lakeZ0 + rng:NextNumber(10, 40)
      if not reserved(Config, x, z, 4) then
        if rng:NextNumber() < 0.5 then pine(f, V(x, -0.5, z), rng, 1) else broadleaf(f, V(x, -0.5, z), rng, 1) end
      end
    end
  end
  -- 河上的桥：每个基地正北一座（木桥面、石墩、栏杆）
  for i = 1, Config.PlotCount do
    local cx = (i - (Config.PlotCount + 1) / 2) * Config.PlotSpacing
    local len = info.rz1 - info.rz0 + 60
    local zc = (info.rz0 + info.rz1) / 2
    part(f, V(24, 1.6, len), CF(cx, 1.6, zc), RGB(122, 92, 62), MAT.WoodPlanks, nil, true)
    for _, s in ipairs({ -1, 1 }) do
      part(f, V(1, 3.4, len), CF(cx + s * 11.5, 4.1, zc), RGB(104, 78, 54), MAT.Wood, nil, true)
      for k = -2, 2 do part(f, V(4, 12, 4), CF(cx + s * 9, -4, zc + k * len / 5), RGB(128, 126, 120), MAT.Cobblestone) end
    end
  end
  f.Parent = parent
  return f
end

---------------------------------------------------------------- 基地外围

-- 一块基地的围墙、哨塔、大门、路灯、沙袋、物资堆、停着的卡车（origin 是基地中心地面，color 是队伍色）
function Scenery.base(f, origin, color, Config)
  local base = CF(origin)
  local hs = Config.BaseSize / 2
  local g = Instance.new("Folder")
  g.Name = "Perimeter"
  local WALL = RGB(150, 150, 142)
  local DARK = RGB(48, 50, 52)
  local rng = Random.new(math.floor(origin.X) + 5)
  -- 围墙：墙身 + 每 26 格一根立柱 + 顶上两道铁丝 + 斜撑
  local function wall(x0, z0, x1, z1, h)
    local a, b = V(x0, 0, z0), V(x1, 0, z1)
    local len = (b - a).Magnitude
    local mid = (a + b) / 2
    local rot = CFrame.lookAt(mid, b)
    part(g, V(1.6, h, len), base * CF(mid + V(0, 1 + h / 2, 0)) * (rot - rot.Position), WALL, MAT.Concrete, nil, true)
    part(g, V(2.2, 0.5, len), base * CF(mid + V(0, 1 + h + 0.25, 0)) * (rot - rot.Position), RGB(120, 120, 114), MAT.Concrete)
    local n = math.max(1, math.floor(len / 26))
    for k = 0, n do
      local p = a:Lerp(b, k / n)
      part(g, V(2.8, h + 1.2, 2.8), base * CF(p + V(0, 1 + (h + 1.2) / 2, 0)) * (rot - rot.Position), RGB(132, 132, 126), MAT.Concrete, nil, true)
      part(g, V(0.25, 2.6, 0.25), base * CF(p + V(0, 1 + h + 1.8, 0)), DARK, MAT.Metal)
    end
    for _, dy in ipairs({ 1.4, 2.6 }) do
      part(g, V(0.12, 0.12, len), base * CF(mid + V(0, 1 + h + dy, 0)) * (rot - rot.Position), RGB(70, 70, 72), MAT.Metal)
    end
  end
  -- 后墙：中间开南门（门外一条东西向的大路，通重生开放的新区域）
  local sg0, sg1 = Config.SouthGate[1], Config.SouthGate[2]
  wall(-hs, -hs, sg0 - 3, -hs, 8)
  wall(sg1 + 3, -hs, hs, -hs, 8)
  for _, gx in ipairs({ sg0 - 2.5, sg1 + 2.5 }) do
    part(g, V(5, 12, 5), base * CF(gx, 7, -hs), RGB(124, 124, 118), MAT.Concrete, nil, true)
    part(g, V(5.6, 0.8, 5.6), base * CF(gx, 13.4, -hs), RGB(100, 100, 96), MAT.Concrete)
    part(g, V(1, 1, 1), base * CF(gx, 14.3, -hs), RGB(255, 170, 60), MAT.Neon):SetAttribute("Anim", "blink")
  end
  local sl = part(g, V(sg1 - sg0 + 6, 2.4, 1), base * CF((sg0 + sg1) / 2, 14, -hs), RGB(214, 170, 40), MAT.SmoothPlastic)
  for _, face in ipairs({ Enum.NormalId.Front, Enum.NormalId.Back }) do
    local sg = Instance.new("SurfaceGui")
    sg.Face = face
    sg.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
    sg.PixelsPerStud = 24
    sg.LightInfluence = 0
    local t = Instance.new("TextLabel")
    t.Size = UDim2.fromScale(1, 1)
    t.BackgroundTransparency = 1
    t.Font = Enum.Font.GothamBlack
    t.TextScaled = true
    t.TextColor3 = RGB(40, 36, 30)
    t.Text = (face == Enum.NormalId.Back) and "南门 · 新区域" or "回基地"
    t.Parent = sg
    sg.Parent = sl
  end
  -- 门外的大路（东西向，接三块新区域）和门口那一小段
  local R = Config.SouthRoad
  local rz = (R.z0 + R.z1) / 2
  part(g, V(800, 1, R.z1 - R.z0 + 4), base * CF(0, 0.5, rz), RGB(150, 150, 142), MAT.Concrete, nil, true)
  part(g, V(sg1 - sg0 + 4, 1, -hs - R.z1 + 1), base * CF((sg0 + sg1) / 2, 0.5, (R.z1 - hs) / 2), RGB(150, 150, 142), MAT.Concrete, nil, true)
  part(g, V(796, 0.1, R.z1 - R.z0), base * CF(0, 1.05, rz), RGB(62, 64, 68), MAT.Asphalt)
  for x = -390, 390, 16 do part(g, V(6, 0.06, 0.5), base * CF(x, 1.12, rz), RGB(236, 232, 210), MAT.SmoothPlastic) end
  -- 左墙（西）：南段开一个工业区大门（门柱、门楣上写「工业区」）
  local gz0, gz1 = Config.Industry.gate[1], Config.Industry.gate[2]
  wall(-hs, -hs, -hs, gz0 - 3, 8)
  wall(-hs, gz1 + 3, -hs, hs, 8)
  for _, gz in ipairs({ gz0 - 2.5, gz1 + 2.5 }) do
    part(g, V(5, 12, 5), base * CF(-hs, 7, gz), RGB(124, 124, 118), MAT.Concrete, nil, true)
    part(g, V(5.6, 0.8, 5.6), base * CF(-hs, 13.4, gz), RGB(100, 100, 96), MAT.Concrete)
    part(g, V(1, 1, 1), base * CF(-hs, 14.3, gz), RGB(255, 170, 60), MAT.Neon):SetAttribute("Anim", "blink")
  end
  local lintel = part(g, V(1, 2.4, gz1 - gz0 + 6), base * CF(-hs, 14, (gz0 + gz1) / 2), RGB(214, 170, 40), MAT.SmoothPlastic)
  for _, face in ipairs({ Enum.NormalId.Left, Enum.NormalId.Right }) do
    local sg = Instance.new("SurfaceGui")
    sg.Face = face
    sg.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
    sg.PixelsPerStud = 24
    sg.LightInfluence = 0
    local t = Instance.new("TextLabel")
    t.Size = UDim2.fromScale(1, 1)
    t.BackgroundTransparency = 1
    t.Font = Enum.Font.GothamBlack
    t.TextScaled = true
    t.TextColor3 = RGB(40, 36, 30)
    t.Text = (face == Enum.NormalId.Right) and "工业区 →" or "← 回基地"
    t.Parent = sg
    sg.Parent = lintel
  end
  wall(hs, -hs, hs, hs, 8)             -- 右墙
  -- 前面（朝战场）：两段矮墙，中间是大门（和中间那条路对齐）
  local g0, g1 = -72, 52
  wall(-hs, hs, g0 - 6, hs, 4)
  wall(g1 + 6, hs, hs, hs, 4)
  for _, gx in ipairs({ g0 - 3, g1 + 3 }) do
    part(g, V(5, 12, 5), base * CF(gx, 7, hs), RGB(124, 124, 118), MAT.Concrete, nil, true)
    part(g, V(5.6, 0.8, 5.6), base * CF(gx, 13.4, hs), RGB(100, 100, 96), MAT.Concrete)
    part(g, V(1, 1, 1), base * CF(gx, 14.3, hs), RGB(255, 170, 60), MAT.Neon):SetAttribute("Anim", "blink")
  end
  -- 门楣横幅（队伍色）
  part(g, V(g1 - g0 + 6, 2.2, 1), base * CF((g0 + g1) / 2, 14, hs), color, MAT.SmoothPlastic)
  -- 抬起的栏杆 + 岗亭
  for _, side in ipairs({ { g0 + 4, 1 }, { g1 - 4, -1 } }) do
    local bx, dir = side[1], side[2]
    part(g, V(1.4, 3, 1.4), base * CF(bx, 2.5, hs + 4), RGB(220, 200, 60), MAT.SmoothPlastic)
    part(g, V(26, 0.5, 0.5), base * CF(bx + dir * 6, 3.8 + 6, hs + 4) * CFrame.Angles(0, 0, dir * math.rad(62)), RGB(236, 70, 60), MAT.SmoothPlastic)
  end
  local function booth(x, z)
    part(g, V(7, 0.6, 7), base * CF(x, 1.3, z), RGB(120, 120, 114), MAT.Concrete)
    part(g, V(6, 6, 6), base * CF(x, 4.6, z), RGB(214, 210, 196), MAT.SmoothPlastic, nil, true)
    part(g, V(6.2, 1.6, 6.2), base * CF(x, 5.4, z), RGB(70, 110, 140), MAT.Glass)
    part(g, V(7.4, 0.6, 7.4), base * CF(x, 7.9, z), DARK, MAT.Metal)
  end
  booth(g0 - 12, hs + 8)
  booth(g1 + 12, hs + 8)
  -- 四角的哨塔：四条腿、平台、岗楼、屋顶、探照灯
  local function tower(x, z, faceX, faceZ)
    local c = base * CF(x, 0, z)
    for _, o in ipairs({ { -2.6, -2.6 }, { 2.6, -2.6 }, { -2.6, 2.6 }, { 2.6, 2.6 } }) do
      part(g, V(0.8, 16, 0.8), c * CF(o[1], 9, o[2]), RGB(86, 82, 74), MAT.Metal, nil, true)
    end
    part(g, V(8, 0.6, 8), c * CF(0, 17, 0), RGB(96, 92, 84), MAT.WoodPlanks, nil, true)
    part(g, V(7, 1.4, 7), c * CF(0, 18, 0), RGB(84, 96, 70), MAT.Concrete)
    part(g, V(6.6, 2.2, 6.6), c * CF(0, 19.8, 0), RGB(70, 104, 130), MAT.Glass)
    part(g, V(8.4, 0.6, 8.4), c * CF(0, 21.2, 0), DARK, MAT.Metal)
    local lamp = cyl(g, 1.2, 1.6, c * CF(0, 22.2, 0), RGB(40, 40, 42), MAT.Metal)
    local head = part(g, V(1.4, 1.4, 1.8), CFrame.lookAt((c * CF(0, 22.6, 0)).Position, (base * CF(faceX, 0, faceZ)).Position), RGB(230, 230, 220), MAT.Neon)
    local sl = Instance.new("SpotLight")
    sl.Brightness = 3
    sl.Range = 70
    sl.Angle = 40
    sl.Face = Enum.NormalId.Front
    sl.Color = RGB(255, 246, 220)
    sl.Parent = head
    head:SetAttribute("Anim", "spin")
    head:SetAttribute("Spd", 0.05)
    lamp.CastShadow = false
  end
  tower(-hs + 4, -hs + 4, 0, 0)
  tower(hs - 4, -hs + 4, 0, 0)
  tower(-hs + 4, hs - 4, 0, hs + 200)
  tower(hs - 4, hs - 4, 0, hs + 200)
  -- 路灯：横路两边、中间那条路两边
  local function lamp(x, z)
    cyl(g, 10, 0.5, base * CF(x, 6, z), RGB(70, 72, 76), MAT.Metal)
    part(g, V(3, 0.4, 0.9), base * CF(x + 1.2, 11, z), RGB(70, 72, 76), MAT.Metal)
    local bulb = part(g, V(1.2, 0.4, 0.8), base * CF(x + 2.2, 10.7, z), RGB(255, 236, 190), MAT.Neon)
    local pl = Instance.new("PointLight")
    pl.Brightness = 1.2
    pl.Range = 26
    pl.Color = RGB(255, 228, 180)
    pl.Parent = bulb
  end
  for _, x in ipairs({ -120, -70, 50, 100 }) do lamp(x, 76) end
  for _, z in ipairs({ 96, 118 }) do
    lamp(-74, z)
    lamp(54, z)
  end
  -- 沙袋掩体（大门里面两侧）
  local function sandbags(x, z, w, rot)
    local c = base * CF(x, 0, z) * CFrame.Angles(0, rot or 0, 0)
    for row = 0, 2 do
      for k = -math.floor(w / 2), math.floor(w / 2) do
        part(g, V(1.9, 0.9, 1.1), c * CF(k * 1.95 + (row % 2) * 0.95, 1.45 + row * 0.85, 0), RGB(176, 158, 112), MAT.Fabric)
      end
    end
  end
  sandbags(g0 + 14, hs - 12, 6, 0)
  sandbags(g1 - 14, hs - 12, 6, 0)
  -- 物资堆：沿左墙内侧一排（木箱、绿色弹药箱、油桶），右墙内侧几堆
  local function crates(x, z)
    local c = base * CF(x, 0, z) * CFrame.Angles(0, rng:NextNumber(-0.3, 0.3), 0)
    for i = 1, rng:NextInteger(3, 6) do
      local s = rng:NextNumber(2.2, 3.4)
      local col = (rng:NextNumber() < 0.5) and RGB(150, 116, 74) or RGB(84, 98, 62)
      part(g, V(s, s * 0.8, s), c * CF(rng:NextNumber(-3, 3), 1 + s * 0.4 + ((i > 3) and s * 0.8 or 0), rng:NextNumber(-3, 3)), col, (col.R > 0.5) and MAT.WoodPlanks or MAT.Metal)
    end
  end
  local function drums(x, z)
    for i = 1, rng:NextInteger(3, 7) do
      local col = (rng:NextNumber() < 0.6) and RGB(60, 84, 60) or RGB(160, 50, 40)
      cyl(g, 2.6, 1.8, base * CF(x + (i % 3) * 2 - 2, 2.3, z + math.floor(i / 3) * 2 - 2), col, MAT.Metal)
    end
  end
  for z = -110, 110, 44 do
    if rng:NextNumber() < 0.5 then crates(-121, z) else drums(-121, z) end
  end
  crates(120, 40)
  drums(120, 64)
  crates(121, -60)
  -- 停着的军用卡车（右墙内侧，车头朝北）
  local function truck(x, z, col)
    local c = base * CF(x, 0, z)
    for _, sx in ipairs({ -1.4, 1.4 }) do
      for _, sz in ipairs({ -3.2, 0.6, 3.0 }) do part(g, V(0.8, 2.2, 2.2), c * CF(sx, 2.1, sz), RGB(30, 30, 32), MAT.SmoothPlastic, CYL) end
    end
    part(g, V(3.4, 0.8, 10), c * CF(0, 2.6, 0), RGB(50, 52, 50), MAT.Metal)
    part(g, V(3.2, 2.6, 2.8), c * CF(0, 4.3, -3.6), col, MAT.Metal, nil, true)
    part(g, V(3.0, 1.0, 0.2), c * CF(0, 4.9, -5.05), RGB(60, 90, 110), MAT.Glass)
    part(g, V(3.4, 3.2, 6.2), c * CF(0, 4.6, 1.6), col:Lerp(RGB(40, 40, 40), 0.15), MAT.Fabric, nil, true)
  end
  truck(-113, 64, RGB(86, 98, 66))
  truck(-113, -12, RGB(86, 98, 66))
  -- 伪装网棚（左后角）
  for _, o in ipairs({ { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } }) do cyl(g, 7, 0.4, base * CF(-108 + o[1] * 9, 4.5, -118 + o[2] * 5), RGB(90, 74, 50), MAT.Wood) end
  local net = part(g, V(22, 0.3, 14), base * CF(-108, 8.2, -118), RGB(80, 98, 58), MAT.Fabric)
  net.Transparency = 0.1
  g.Parent = f
  return g
end

---------------------------------------------------------------- 战场战区

local TH_TINT = { grass = RGB(150, 140, 100), desert = RGB(214, 190, 140), snow = RGB(236, 240, 246), urban = RGB(140, 138, 132), volcano = RGB(70, 62, 58) }
local THEME = {
  grass = { field = RGB(104, 122, 72), fmat = MAT.Grass, road = RGB(128, 104, 72), flank = MAT.Grass, crater = RGB(84, 74, 54), ground = RGB(116, 96, 70) },
  desert = { field = RGB(214, 190, 138), fmat = MAT.Sand, road = RGB(180, 150, 104), flank = MAT.Sand, crater = RGB(164, 136, 96), ground = RGB(200, 172, 120) },
  snow = { field = RGB(232, 238, 246), fmat = MAT.Snow, road = RGB(170, 160, 150), flank = MAT.Snow, crater = RGB(150, 146, 140), ground = RGB(220, 226, 236) },
  urban = { field = RGB(118, 118, 120), fmat = MAT.Concrete, road = RGB(62, 62, 66), flank = MAT.Concrete, crater = RGB(70, 68, 66), ground = RGB(130, 128, 124) },
  volcano = { field = RGB(62, 56, 54), fmat = MAT.Basalt, road = RGB(44, 40, 40), flank = MAT.Basalt, crater = RGB(40, 34, 32), ground = RGB(70, 62, 58) },
}
Scenery.THEME = THEME

-- 一辆打坏的车（坦克或卡车的残骸，焦黑），可以冒烟
local function wreck(g, cf, rng, smoke)
  local c = RGB(44, 40, 36)
  if rng:NextNumber() < 0.5 then
    part(g, V(7, 2, 11), cf * CF(0, 1.6, 0), c, MAT.CorrodedMetal)
    part(g, V(5, 1.6, 5), cf * CF(0.5, 3.4, 0.6) * CFrame.Angles(0, 0.5, 0.15), c, MAT.CorrodedMetal)
    part(g, V(0.6, 0.6, 7), cf * CF(1.5, 3.6, -3) * CFrame.Angles(0.3, 0.6, 0), RGB(30, 30, 30), MAT.Metal)
  else
    part(g, V(4, 2.6, 9), cf * CF(0, 2, 0) * CFrame.Angles(0, 0, 0.3), c, MAT.CorrodedMetal)
    part(g, V(3.6, 2.4, 3), cf * CF(0.6, 3.6, -3) * CFrame.Angles(0, 0, 0.3), c, MAT.CorrodedMetal)
  end
  if smoke then
    local s = Instance.new("Smoke")
    s.Color = RGB(52, 50, 48)
    s.Opacity = 0.18
    s.RiseVelocity = 7
    s.Size = 6
    local holder = part(g, V(1, 1, 1), cf * CF(0, 4, 0), c, MAT.SmoothPlastic)
    holder.Transparency = 1
    s.Parent = holder
    if rng:NextNumber() < 0.5 then
      local fire = Instance.new("Fire")
      fire.Size = 5
      fire.Heat = 9
      fire.Parent = holder
    end
  end
end

-- 战壕（一段一段，中间留口子给部队过）：深色壕沟 + 朝敌人那边一溜沙袋
local function trench(g, base, z, facing, half, gap, rng, colTrench, colBag)
  local x = -half
  while x < half do
    local len = rng:NextNumber(40, 70)
    local x1 = math.min(half, x + len)
    local mid, w = (x + x1) / 2, x1 - x
    part(g, V(w, 0.12, 5), base * CF(mid, 1.07, z), colTrench, MAT.Mud)
    part(g, V(w, 1.2, 1.8), base * CF(mid, 1.6, z + facing * 3.3), colBag, MAT.Fabric)
    part(g, V(w - 2, 0.9, 1.2), base * CF(mid, 2.6, z + facing * 3.4), colBag:Lerp(RGB(120, 108, 80), 0.2), MAT.Fabric)
    x = x1 + gap
  end
end

-- 铁丝网：一排 X 形木桩 + 两道铁丝
local function wire(g, base, z, x0, x1)
  local len = x1 - x0
  for k = 0, math.floor(len / 12) do
    local x = x0 + k * 12
    part(g, V(0.3, 3.6, 0.3), base * CF(x, 2.4, z) * CFrame.Angles(0, 0, 0.5), RGB(92, 74, 52), MAT.Wood)
    part(g, V(0.3, 3.6, 0.3), base * CF(x, 2.4, z) * CFrame.Angles(0, 0, -0.5), RGB(92, 74, 52), MAT.Wood)
  end
  for _, y in ipairs({ 2.2, 3.4 }) do part(g, V(len, 0.1, 0.1), base * CF((x0 + x1) / 2, y, z), RGB(70, 70, 70), MAT.Metal) end
end

-- 反坦克拒马（三根交叉的钢梁）
local function hedgehog(g, cf)
  local c = RGB(70, 66, 60)
  part(g, V(0.6, 0.6, 6), cf * CF(0, 1.9, 0) * CFrame.Angles(0.7, 0, 0), c, MAT.Metal)
  part(g, V(0.6, 0.6, 6), cf * CF(0, 1.9, 0) * CFrame.Angles(-0.7, 0, 0) * CFrame.Angles(0, math.pi / 2, 0), c, MAT.Metal)
  part(g, V(6, 0.6, 0.6), cf * CF(0, 1.9, 0) * CFrame.Angles(0, 0.4, 0.7), c, MAT.Metal)
end

-- 一栋打坏的房子（墙、窗洞、塌掉的屋顶）：style = brick / adobe / cabin / concrete
local function ruin(g, cf, rng, style)
  local col, mat = RGB(150, 84, 64), MAT.Brick
  if style == "adobe" then col, mat = RGB(196, 160, 112), MAT.Sandstone
  elseif style == "cabin" then col, mat = RGB(110, 80, 56), MAT.WoodPlanks
  elseif style == "concrete" then col, mat = RGB(150, 148, 142), MAT.Concrete end
  local w, d = rng:NextNumber(14, 24), rng:NextNumber(12, 20)
  local floors = (style == "concrete") and rng:NextInteger(2, 4) or 1
  local h = 7 * floors
  -- 四面墙各自有高有低（塌了一部分），留窗洞
  local sides = { { V(w, 0, 0), V(0, 0, -d / 2), 0 }, { V(w, 0, 0), V(0, 0, d / 2), 0 }, { V(d, 0, 0), V(-w / 2, 0, 0), math.pi / 2 }, { V(d, 0, 0), V(w / 2, 0, 0), math.pi / 2 } }
  for _, sd in ipairs(sides) do
    local len = sd[1].X
    local hh = h * rng:NextNumber(0.45, 1)
    local segs = math.max(2, math.floor(len / 5))
    for k = 0, segs - 1 do
      local sh = hh * rng:NextNumber(0.6, 1)
      if rng:NextNumber() > 0.12 then
        local x = -len / 2 + (k + 0.5) * len / segs
        part(g, V(len / segs - ((k % 2 == 1) and 1.6 or 0), sh, 1.2), cf * CF(sd[2]) * CFrame.Angles(0, sd[3], 0) * CF(x, 1 + sh / 2, 0), col:Lerp(RGB(60, 56, 52), rng:NextNumber() * 0.25), mat, nil, true)
      end
    end
  end
  for f2 = 1, floors - 1 do   -- 楼板（塌了一角）
    part(g, V(w * 0.8, 0.8, d * 0.7), cf * CF(-w * 0.08, 1 + f2 * 7, d * 0.1) * CFrame.Angles(rng:NextNumber(-0.15, 0.15), 0, rng:NextNumber(-0.1, 0.1)), RGB(140, 138, 132), MAT.Concrete, nil, true)
  end
  for _ = 1, rng:NextInteger(5, 10) do   -- 瓦砾
    local s = rng:NextNumber(1, 3)
    part(g, V(s, s * 0.6, s), cf * CF(rng:NextNumber(-w / 2, w / 2), 1.2, rng:NextNumber(-d / 2 - 3, d / 2 + 3)) * CFrame.Angles(rng:NextNumber(0, 1), rng:NextNumber(0, 6), 0), col, mat)
  end
end

local function palm(g, pos, rng)
  local h = rng:NextNumber(12, 18)
  local lean = rng:NextNumber(-0.25, 0.25)
  for k = 0, 5 do
    local y = k * h / 6
    part(g, V(1.3 - k * 0.1, h / 6 + 0.3, 1.3 - k * 0.1), CF(pos + V(lean * y, y + h / 12, 0)) * CFrame.Angles(0, 0, -lean), RGB(130, 100, 64), MAT.Wood)
  end
  local top = pos + V(lean * h, h, 0)
  for i = 1, 7 do
    local a = i / 7 * math.pi * 2
    part(g, V(1.6, 0.2, 9), CF(top) * CFrame.Angles(0, a, 0) * CFrame.Angles(-0.45, 0, 0) * CF(0, -1.2, -4), RGB(70, 130, 50), MAT.Grass)
  end
end

-- 战区：地面材质、两边的地形、道具（g 是这一块战场的装饰文件夹，清空重摆）
---------------------------------------------------------------- 西边工业区的场地（围墙外，从西墙南段的大门出去）

-- 硬化地面（一直铺到围墙）、从大门过来的路、南北主路和两条支路、三面围栏、路灯、门口的指示牌、几堆管子和油桶
function Scenery.industry(f, origin, Config)
  local I = Config.Industry
  local hs = Config.BaseSize / 2
  local base = CF(origin)
  local g = Instance.new("Folder")
  g.Name = "Industry"
  local x0, x1, z0, z1 = I.x0, -hs - 1, I.z0, I.z1
  local cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
  part(g, V(x1 - x0, 1, z1 - z0), base * CF(cx, 0.5, cz), RGB(158, 152, 136), MAT.Concrete, nil, true)
  local ROAD, LINE = RGB(62, 64, 68), RGB(236, 232, 210)
  local gz = (I.gate[1] + I.gate[2]) / 2
  local rx = I.roadX
  part(g, V(x1 - rx + 7, 0.1, 16), base * CF((x1 + rx - 7) / 2, 1.05, gz), ROAD, MAT.Asphalt)
  part(g, V(14, 0.1, z1 - z0 - 10), base * CF(rx, 1.05, cz), ROAD, MAT.Asphalt)
  for z = z0 + 12, z1 - 12, 14 do part(g, V(0.5, 0.06, 6), base * CF(rx, 1.12, z), LINE, MAT.SmoothPlastic) end
  for _, az in ipairs({ -64, 4 }) do
    part(g, V(rx - x0 - 14, 0.1, 10), base * CF((rx + x0 + 14) / 2, 1.05, az), ROAD, MAT.Asphalt)
    for x = rx - 14, x0 + 22, -14 do part(g, V(6, 0.06, 0.5), base * CF(x, 1.12, az), LINE, MAT.SmoothPlastic) end
  end
  -- 围栏：北、西、南三面（立柱、铁丝网、顶上一道铁丝）
  local function fence(ax, az, bx, bz)
    local a, b = V(ax, 0, az), V(bx, 0, bz)
    local len = (b - a).Magnitude
    local mid = (a + b) / 2
    local rot = CFrame.lookAt(mid, b)
    rot = rot - rot.Position
    local mesh = part(g, V(0.15, 5.2, len), base * CF(mid + V(0, 3.6, 0)) * rot, RGB(150, 156, 160), MAT.SmoothPlastic, nil, true)
    mesh.Transparency = 0.82
    part(g, V(0.2, 0.2, len), base * CF(mid + V(0, 6.3, 0)) * rot, RGB(70, 72, 76), MAT.Metal)
    local n = math.max(1, math.floor(len / 18))
    for k = 0, n do cyl(g, 6.4, 0.45, base * CF(a:Lerp(b, k / n) + V(0, 4.2, 0)), RGB(84, 86, 90), MAT.Metal, true) end
  end
  fence(x0, z1, x1, z1)
  fence(x0, z0, x0, z1)
  fence(x0, z0, x1, z0)
  -- 路灯（主路东边）
  for _, z in ipairs({ z0 + 18, -40, 20, z1 - 16 }) do
    local x = rx + 9.5
    cyl(g, 11, 0.5, base * CF(x, 6.5, z), RGB(70, 72, 76), MAT.Metal, true)
    part(g, V(3.2, 0.4, 0.9), base * CF(x - 1.3, 11.8, z), RGB(70, 72, 76), MAT.Metal)
    local bulb = part(g, V(1.2, 0.4, 0.8), base * CF(x - 2.4, 11.5, z), RGB(255, 236, 190), MAT.Neon)
    local pl = Instance.new("PointLight")
    pl.Brightness, pl.Range, pl.Color = 1.2, 28, RGB(255, 228, 180)
    pl.Parent = bulb
  end
  -- 门口的指示牌：工业区里能盖什么
  local board = part(g, V(0.6, 7, 14), base * CF(rx + 12, 6.5, gz + 16), RGB(36, 52, 40), MAT.SmoothPlastic, nil, true)
  for _, sx in ipairs({ -5.5, 5.5 }) do cyl(g, 6, 0.5, base * CF(rx + 12, 3, gz + 16 + sx), RGB(80, 82, 86), MAT.Metal, true) end
  local sg = Instance.new("SurfaceGui")
  sg.Face = Enum.NormalId.Right
  sg.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
  sg.PixelsPerStud = 24
  sg.LightInfluence = 0
  local t = Instance.new("TextLabel")
  t.Size = UDim2.fromScale(1, 1)
  t.BackgroundTransparency = 1
  t.Font = Enum.Font.GothamBold
  t.TextScaled = true
  t.TextColor3 = RGB(255, 236, 170)
  t.Text = "西 · 工业区\n油井 → 炼油厂（油井 ×1.5）\n弹药厂 → 钢铁厂 → 矿场\n核电站（工厂再 ×1.3）"
  t.Parent = sg
  sg.Parent = board
  -- 几堆管子、油桶
  for k = 0, 2 do part(g, V(16, 1.2, 1.2), base * CF(x0 + 30, 1.6 + k * 1.1, z1 - 14 + (k % 2) * 0.6), RGB(120, 124, 128), MAT.Metal, CYL, true) end
  for i = 0, 5 do cyl(g, 2.6, 1.8, base * CF(x0 + 52 + (i % 3) * 2.1, 2.3, z1 - 16 + math.floor(i / 3) * 2.1), (i % 2 == 0) and RGB(60, 84, 60) or RGB(160, 50, 40), MAT.Metal) end
  g.Parent = f
  return g
end

function Scenery.theater(plot, theater, Config)
  local F = Config.Field
  local th = THEME[theater] or THEME.grass
  local base = CF(plot.origin)
  local T = workspace.Terrain
  -- 地面零件换材质、颜色
  if plot.field then
    plot.field.Material = th.fmat
    plot.field.Color = th.field
  end
  -- 战场两边的地形换成这个战区的（草地 / 沙地 / 雪地 / 水泥 / 玄武岩）
  local z0, z1 = F.center - F.length / 2, F.center + F.length / 2
  for _, s in ipairs({ -1, 1 }) do
    T:FillBlock(CFrame.new(plot.origin + V(s * (F.width / 2 + 75), -1.5, F.center)), V(150, 3, F.length + 40), th.flank)
  end
  T:FillBlock(CFrame.new(plot.origin + V(0, -1.5, z1 + 40)), V(F.width + 300, 3, 70), th.flank)
  -- 装饰重摆
  local old = plot.folder:FindFirstChild("Decor")
  if old then old:Destroy() end
  local g = Instance.new("Folder")
  g.Name = "Decor"
  local rng = Random.new(plot.index * 1000 + #theater * 17)
  -- 中间的土路
  part(g, V(26, 0.1, F.length - 8), base * CF(0, 1.05, F.center), th.road, (theater == "urban") and MAT.Asphalt or MAT.Ground)
  if theater == "urban" then
    for k = 0, math.floor((F.length - 20) / 18) do part(g, V(0.8, 0.12, 8), base * CF(0, 1.1, z0 + 14 + k * 18), RGB(230, 220, 120), MAT.SmoothPlastic) end
  end
  -- 弹坑
  for _ = 1, 22 do
    local d = rng:NextNumber(8, 22)
    local x, z = rng:NextNumber(-F.width / 2 + 20, F.width / 2 - 20), rng:NextNumber(F.deploy[2] + 20, F.enemy[1] - 20)
    part(g, V(0.12, d, d), base * CF(x, 1.06, z) * UP, th.crater, MAT.Ground, CYL)
    part(g, V(0.4, d + 3, d + 3), base * CF(x, 1.02, z) * UP, th.ground, MAT.Ground, CYL)
  end
  -- 两条战壕（我方部署区前面、敌军区前面）、两道铁丝网、拒马
  local half = F.width / 2 - 12
  trench(g, base, F.deploy[2] + 14, 1, half, 18, rng, RGB(70, 58, 44):Lerp(th.crater, 0.4), RGB(176, 158, 112))
  trench(g, base, F.enemy[1] - 14, -1, half, 18, rng, RGB(70, 58, 44):Lerp(th.crater, 0.4), RGB(150, 136, 100))
  for _, z in ipairs({ F.deploy[2] + 110, F.enemy[1] - 110 }) do
    local x = -half
    while x < half do
      local x1 = math.min(half, x + rng:NextNumber(50, 90))
      wire(g, base, z, x, x1)
      x = x1 + rng:NextNumber(30, 50)
    end
  end
  for _ = 1, 14 do
    local x = rng:NextNumber(-half, half)
    local z = (rng:NextNumber() < 0.5) and (F.deploy[2] + rng:NextNumber(30, 60)) or (F.enemy[1] - rng:NextNumber(30, 60))
    hedgehog(g, base * CF(x, 0, z) * CFrame.Angles(0, rng:NextNumber(0, 6), 0))
  end
  -- 中间地带的残骸（几辆冒烟）、沙袋机枪巢
  for i = 1, 9 do
    local x, z = rng:NextNumber(-half + 20, half - 20), rng:NextNumber(F.deploy[2] + 80, F.enemy[1] - 80)
    wreck(g, base * CF(x, 0, z) * CFrame.Angles(0, rng:NextNumber(0, 6), 0), rng, i <= 4)
  end
  for _ = 1, 6 do
    local x, z = rng:NextNumber(-half + 30, half - 30), rng:NextNumber(F.deploy[2] + 60, F.enemy[1] - 60)
    local c = base * CF(x, 0, z) * CFrame.Angles(0, rng:NextNumber(0, 6), 0)
    for k = 1, 7 do   -- 一圈沙袋（缺一个口）
      local a = k / 8 * math.pi * 2
      part(g, V(3.6, 1.6, 1.4), c * CFrame.Angles(0, a, 0) * CF(0, 1.8, -4.4), RGB(176, 158, 112):Lerp(TH_TINT[theater] or RGB(176, 158, 112), 0.3), MAT.Fabric)
    end
    part(g, V(0.25, 0.25, 3), c * CF(0, 3, -4.6), RGB(40, 40, 40), MAT.Metal)
  end
  -- 两边（|x| > 190）的主题道具：废墟、树、主题特色
  local function flankPos()
    local s = (rng:NextNumber() < 0.5) and -1 or 1
    return s * rng:NextNumber(F.width / 2 - 62, F.width / 2 - 16), rng:NextNumber(z0 + 30, z1 - 30)
  end
  local style = ({ grass = "brick", desert = "adobe", snow = "cabin", urban = "concrete", volcano = "concrete" })[theater]
  for _ = 1, (theater == "urban") and 15 or 5 do
    local x, z = flankPos()
    ruin(g, base * CF(x, 0, z) * CFrame.Angles(0, rng:NextInteger(0, 3) * math.pi / 2, 0), rng, style)
  end
  for _ = 1, 26 do
    local x, z = flankPos()
    local p = (base * CF(x, 0.5, z)).Position
    if theater == "grass" then
      if rng:NextNumber() < 0.6 then broadleaf(g, p, rng, 0.9) else bush(g, p, rng) end
    elseif theater == "desert" then
      if rng:NextNumber() < 0.45 then palm(g, p, rng) else rock(g, p, rng, 1.4) end
    elseif theater == "snow" then
      if rng:NextNumber() < 0.7 then pine(g, p, rng, 1, true) else part(g, V(rng:NextNumber(6, 12), 3, rng:NextNumber(6, 12)), CF(p + V(0, 1, 0)), RGB(240, 244, 250), MAT.Snow, BALL) end
    elseif theater == "urban" then
      if rng:NextNumber() < 0.5 then   -- 路灯杆、水泥隔离墩
        cyl(g, 12, 0.5, CF(p + V(0, 6, 0)), RGB(80, 82, 86), MAT.Metal)
      else
        part(g, V(8, 2.6, 1.6), CF(p + V(0, 1.3, 0)) * CFrame.Angles(0, rng:NextNumber(0, 3), 0), RGB(170, 168, 160), MAT.Concrete, nil, true)
      end
    elseif theater == "volcano" then   -- 玄武岩柱、烧焦的树
      if rng:NextNumber() < 0.6 then
        local h = rng:NextNumber(8, 26)
        part(g, V(rng:NextNumber(4, 8), h, rng:NextNumber(4, 8)), CF(p + V(0, h / 2, 0)) * CFrame.Angles(0, rng:NextNumber(0, 3), rng:NextNumber(-0.08, 0.08)), RGB(46, 42, 42), MAT.Basalt, nil, true)
      else
        cyl(g, 9, 0.9, CF(p + V(0, 4.5, 0)) * CFrame.Angles(rng:NextNumber(-0.2, 0.2), 0, 0), RGB(28, 24, 22), MAT.Wood)
      end
    end
  end
  -- 主题特色
  if theater == "grass" then   -- 草垛、木栅栏
    for _ = 1, 8 do
      local x, z = flankPos()
      part(g, V(4, 5, 5), base * CF(x, 3.5, z) * CFrame.Angles(0, rng:NextNumber(0, 3), 0), RGB(214, 180, 90), MAT.Fabric, CYL)
    end
    for _ = 1, 5 do
      local x, z = flankPos()
      for k = 0, 5 do part(g, V(0.4, 3, 0.4), base * CF(x + k * 3, 2.5, z), RGB(120, 92, 60), MAT.Wood) end
      part(g, V(15, 0.4, 0.3), base * CF(x + 7.5, 3, z), RGB(120, 92, 60), MAT.Wood)
    end
  elseif theater == "desert" then   -- 帐篷、油桶
    for _ = 1, 5 do
      local x, z = flankPos()
      part(g, V(8, 4, 8), base * CF(x, 3, z) * CFrame.Angles(0, rng:NextNumber(0, 3), 0), RGB(196, 176, 130), MAT.Fabric)
    end
  elseif theater == "urban" then   -- 烧毁的汽车
    for _ = 1, 10 do
      local x, z = flankPos()
      local c = base * CF(x * 0.85, 0, z) * CFrame.Angles(0, rng:NextNumber(0, 6), rng:NextNumber(-0.1, 0.1))
      part(g, V(4.6, 1.6, 9), c * CF(0, 1.9, 0), RGB(48, 44, 40), MAT.CorrodedMetal)
      part(g, V(4.2, 1.4, 4.5), c * CF(0, 3.3, 0.5), RGB(40, 38, 36), MAT.CorrodedMetal)
    end
  elseif theater == "volcano" then   -- 熔岩池、熔岩裂缝（发光、有热光）、冒烟的地缝
    for _ = 1, 4 do
      local x, z = flankPos()
      local pool = part(g, V(0.3, rng:NextNumber(18, 30), rng:NextNumber(18, 30)), base * CF(x, 1.1, z) * UP, RGB(255, 100, 20), MAT.Neon, CYL)
      local pl = Instance.new("PointLight")
      pl.Color = RGB(255, 110, 30)
      pl.Brightness = 3
      pl.Range = 40
      pl.Parent = pool
      part(g, V(0.5, pool.Size.Y + 4, pool.Size.Z + 4), base * CF(x, 1.0, z) * UP, RGB(40, 34, 32), MAT.Basalt, CYL)
    end
    for _ = 1, 24 do
      local x, z = rng:NextNumber(-half, half), rng:NextNumber(z0 + 30, z1 - 30)
      if math.abs(x) > 40 then
        local crack = part(g, V(rng:NextNumber(1.2, 2.4), 0.16, rng:NextNumber(14, 34)), base * CF(x, 1.08, z) * CFrame.Angles(0, rng:NextNumber(0, 3), 0), RGB(255, 110, 30), MAT.Neon)
        if rng:NextNumber() < 0.35 then
          local pl = Instance.new("PointLight")
          pl.Color = RGB(255, 120, 40)
          pl.Brightness = 2
          pl.Range = 24
          pl.Parent = crack
          local s = Instance.new("Smoke")
          s.Color = RGB(60, 56, 54)
          s.Opacity = 0.15
          s.RiseVelocity = 5
          s.Size = 4
          s.Parent = crack
        end
      end
    end
  end
  -- 部署区四角的旗子（队伍色）、敌军区四角红旗
  for _, e in ipairs({ { F.deploy[1], plot.color }, { F.deploy[2], plot.color }, { F.enemy[1], RGB(200, 50, 45) }, { F.enemy[2], RGB(200, 50, 45) } }) do
    for _, s in ipairs({ -1, 1 }) do
      cyl(g, 14, 0.4, base * CF(s * (F.width / 2 - 4), 8, e[1]), RGB(170, 170, 170), MAT.Metal)
      part(g, V(0.15, 3, 5), base * CF(s * (F.width / 2 - 4), 13.4, e[1] + 2.6), e[2], MAT.Fabric)
    end
  end
  g.Parent = plot.folder
  plot.theater = theater
  plot.folder:SetAttribute("Theater", theater)   -- 客户端按它下天气、换天色
  return g
end

return Scenery
