-- 军事大亨：客户端（StarterPlayerScripts.Client）
-- 界面（钱、关卡、兵工厂、按钮、提示）；布阵（点选自己的部队，再点部署区放下）；观战镜头；开火 / 爆炸 / 建成特效；直升机旋翼
local Players = game:GetService("Players")
local RS = game:GetService("ReplicatedStorage")
local UIS = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Debris = game:GetService("Debris")
local CollectionService = game:GetService("CollectionService")
local PPS = game:GetService("ProximityPromptService")

local Config = require(RS:WaitForChild("Config"))
local Remotes = RS:WaitForChild("Remotes")
local RState = Remotes:WaitForChild("State")
local RToast = Remotes:WaitForChild("Toast")
local RAction = Remotes:WaitForChild("Action")
local RFx = Remotes:WaitForChild("Fx")
local RBattle = Remotes:WaitForChild("Battle")

local player = Players.LocalPlayer
local cam = workspace.CurrentCamera
local V = Vector3.new
local RGB = Color3.fromRGB
local F = Config.Field
local UNITS = Config.Units
local FONT = Enum.Font.GothamBold
local FONT2 = Enum.Font.GothamMedium
local mobile = UIS.TouchEnabled and not UIS.KeyboardEnabled

local S = nil          -- 服务器发来的最新状态
local mode = "free"    -- free 在基地里走 / deploy 布阵 / battle 观战
local sel = nil        -- 布阵时选中的部队 { model, uid, t }

---------------------------------------------------------------- 界面零件

local function mk(cls, props, parent)
  local o = Instance.new(cls)
  for k, v in pairs(props) do o[k] = v end
  if parent then o.Parent = parent end
  return o
end
local function round(o, r)
  mk("UICorner", { CornerRadius = UDim.new(0, r or 8) }, o)
  return o
end
local function outline(o, tr)
  mk("UIStroke", { Color = RGB(255, 255, 255), Transparency = tr or 0.86, Thickness = 1, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }, o)
  return o
end
local function text(parent, props)
  local t = mk("TextLabel", { BackgroundTransparency = 1, Font = FONT2, TextSize = 16, TextColor3 = RGB(236, 240, 244), TextXAlignment = Enum.TextXAlignment.Left, Text = "" })
  for k, v in pairs(props) do t[k] = v end
  t.Parent = parent
  return t
end
local function button(parent, txt, color, props)
  local b = mk("TextButton", { Text = txt, Font = FONT, TextSize = 18, TextColor3 = RGB(255, 255, 255), BackgroundColor3 = color, AutoButtonColor = true, BorderSizePixel = 0 })
  round(b, 8)
  for k, v in pairs(props or {}) do b[k] = v end
  b.Parent = parent
  return b
end
local function panel(parent, props)
  local f = mk("Frame", { BackgroundColor3 = RGB(14, 18, 24), BackgroundTransparency = 0.2, BorderSizePixel = 0 })
  round(f, 10)
  outline(f, 0.88)
  for k, v in pairs(props) do f[k] = v end
  f.Parent = parent
  return f
end

local gui = mk("ScreenGui", { Name = "TycoonUI", ResetOnSpawn = false, ZIndexBehavior = Enum.ZIndexBehavior.Sibling }, player:WaitForChild("PlayerGui"))
-- 按屏幕大小整体缩放：根框架先放大 1/s 倍再用 UIScale 缩 s 倍，正好铺满屏幕
local root = mk("Frame", { BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1) }, gui)
local uiScale = mk("UIScale", {}, root)
local function rescale()
  local vs = cam.ViewportSize
  local s = math.clamp(math.min(vs.X / 1280, vs.Y / 720) * 1.08, 0.5, 1.3)
  uiScale.Scale = s
  root.Size = UDim2.fromScale(1 / s, 1 / s)
end
rescale()
cam:GetPropertyChangedSignal("ViewportSize"):Connect(rescale)

-- 顶上：钱、收入
local top = panel(root, { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 8), Size = UDim2.fromOffset(400, 56) })
local cashL = text(top, { Position = UDim2.fromOffset(18, 0), Size = UDim2.new(0.6, -18, 1, 0), Font = FONT, TextSize = 30, TextColor3 = RGB(255, 214, 90), Text = "$0" })
local incL = text(top, { Position = UDim2.new(0.6, 0, 0, 0), Size = UDim2.new(0.4, -16, 1, 0), TextSize = 18, TextColor3 = RGB(130, 235, 140), TextXAlignment = Enum.TextXAlignment.Right, Text = "+0 / 秒" })

-- 左边：关卡、部队、这一关的敌军
local info = panel(root, { Position = UDim2.fromOffset(10, 72), Size = UDim2.fromOffset(260, 150) })
local lvL = text(info, { Position = UDim2.fromOffset(14, 8), Size = UDim2.new(1, -28, 0, 28), Font = FONT, TextSize = 22, Text = "第 1 关" })
local armyL = text(info, { Position = UDim2.fromOffset(14, 38), Size = UDim2.new(1, -28, 0, 20), Text = "部队 0 / 4" })
local enemyL = text(info, { Position = UDim2.fromOffset(14, 62), Size = UDim2.new(1, -28, 0, 52), TextSize = 15, TextWrapped = true, TextYAlignment = Enum.TextYAlignment.Top, TextColor3 = RGB(255, 165, 150) })
local rewardL = text(info, { Position = UDim2.fromOffset(14, 118), Size = UDim2.new(1, -28, 0, 22), TextSize = 15, TextColor3 = RGB(255, 214, 90) })

-- 右边：兵工厂
local ROWH = 64
local shop = panel(root, { AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -10, 0, 72), Size = UDim2.fromOffset(300, 46 + (#Config.UnitOrder + 1) * ROWH) })
text(shop, { Position = UDim2.fromOffset(14, 8), Size = UDim2.new(1, -28, 0, 28), Font = FONT, TextSize = 20, Text = "兵工厂" })
local rows = {}
for i, t in ipairs(Config.UnitOrder) do
  local def = UNITS[t]
  local row = mk("Frame", { BackgroundColor3 = RGB(255, 255, 255), BackgroundTransparency = 0.94, BorderSizePixel = 0, Position = UDim2.fromOffset(8, 42 + (i - 1) * ROWH), Size = UDim2.new(1, -16, 0, ROWH - 6) }, shop)
  round(row, 8)
  local nameL = text(row, { Position = UDim2.fromOffset(10, 5), Size = UDim2.new(1, -112, 0, 22), Font = FONT, TextSize = 17, Text = def.name })
  text(row, { Position = UDim2.fromOffset(10, 28), Size = UDim2.new(1, -112, 0, 28), TextSize = 12, TextWrapped = true, TextYAlignment = Enum.TextYAlignment.Top, TextColor3 = RGB(170, 180, 192), Text = def.desc })
  local btn = button(row, "$" .. Config.Fmt(def.price), RGB(60, 150, 80), { AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -8, 0.5, 0), Size = UDim2.fromOffset(94, 42), TextSize = 16 })
  btn.Activated:Connect(function()
    RAction:FireServer("buy", t)
  end)
  rows[t] = { name = nameL, btn = btn }
end
-- 最后一行：军工科技（全军血量、伤害）
local techRow = mk("Frame", { BackgroundColor3 = RGB(255, 214, 90), BackgroundTransparency = 0.9, BorderSizePixel = 0, Position = UDim2.fromOffset(8, 42 + #Config.UnitOrder * ROWH), Size = UDim2.new(1, -16, 0, ROWH - 6) }, shop)
round(techRow, 8)
local techName = text(techRow, { Position = UDim2.fromOffset(10, 5), Size = UDim2.new(1, -112, 0, 22), Font = FONT, TextSize = 17, TextColor3 = RGB(255, 222, 130), Text = "军工科技 Lv.0" })
local techDesc = text(techRow, { Position = UDim2.fromOffset(10, 28), Size = UDim2.new(1, -112, 0, 28), TextSize = 12, TextWrapped = true, TextYAlignment = Enum.TextYAlignment.Top, TextColor3 = RGB(200, 190, 160), Text = "" })
local techBtn = button(techRow, "", RGB(150, 120, 40), { AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -8, 0.5, 0), Size = UDim2.fromOffset(94, 42), TextSize = 15 })
techBtn.Activated:Connect(function()
  RAction:FireServer("tech")
end)

-- 下面：按钮
local bar = mk("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -14), Size = UDim2.fromOffset(760, 56) }, root)
mk("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Center, VerticalAlignment = Enum.VerticalAlignment.Center, Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }, bar)
local deployBtn = button(bar, "布阵", RGB(45, 95, 165), { Size = UDim2.fromOffset(140, 52), LayoutOrder = 1 })
local arrangeBtn = button(bar, "一键排阵", RGB(70, 115, 75), { Size = UDim2.fromOffset(130, 52), LayoutOrder = 2, Visible = false })
local sellBtn = button(bar, "解散", RGB(120, 62, 52), { Size = UDim2.fromOffset(160, 52), LayoutOrder = 3, Visible = false })
local fightBtn = button(bar, "开战！", RGB(195, 52, 45), { Size = UDim2.fromOffset(150, 52), LayoutOrder = 4, TextSize = 22 })
local hqBtn = button(bar, "升级指挥部", RGB(125, 102, 40), { Size = UDim2.fromOffset(220, 52), LayoutOrder = 5, TextSize = 16, Visible = false })

local hint = text(root, {
  AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -76), Size = UDim2.fromOffset(760, 24),
  TextXAlignment = Enum.TextXAlignment.Center, TextSize = 15, TextStrokeTransparency = 0.4, Visible = false,
  Text = mobile and "点自己的部队选中，再点蓝色部署区放下 · 单指拖动转镜头 · 双指缩放"
    or "点自己的部队选中，再点蓝色部署区放下 · 右键拖动转镜头 · 滚轮缩放 · WASD 移动 · Q / E 转向",
})

-- 战斗中：关卡、剩余时间、双方还剩几个
local bpanel = panel(root, { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 72), Size = UDim2.fromOffset(360, 62), Visible = false })
local bTitle = text(bpanel, { Position = UDim2.fromOffset(0, 4), Size = UDim2.new(1, 0, 0, 28), Font = FONT, TextSize = 22, TextXAlignment = Enum.TextXAlignment.Center })
local bInfo = text(bpanel, { Position = UDim2.fromOffset(0, 33), Size = UDim2.new(1, 0, 0, 22), TextSize = 16, TextXAlignment = Enum.TextXAlignment.Center, RichText = true })

-- 结果
local result = panel(root, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.45), Size = UDim2.fromOffset(440, 260), Visible = false, ZIndex = 5 })
local resTitle = text(result, { Position = UDim2.fromOffset(0, 18), Size = UDim2.new(1, 0, 0, 52), Font = FONT, TextSize = 44, TextXAlignment = Enum.TextXAlignment.Center, ZIndex = 5 })
local resBody = text(result, { Position = UDim2.fromOffset(24, 80), Size = UDim2.new(1, -48, 0, 100), TextSize = 18, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Center, TextYAlignment = Enum.TextYAlignment.Top, ZIndex = 5 })
local resDeploy = button(result, "布阵再打", RGB(45, 95, 165), { AnchorPoint = Vector2.new(1, 1), Position = UDim2.new(0.5, -8, 1, -18), Size = UDim2.fromOffset(160, 48), ZIndex = 5 })
local resHome = button(result, "回基地", RGB(70, 80, 92), { AnchorPoint = Vector2.new(0, 1), Position = UDim2.new(0.5, 8, 1, -18), Size = UDim2.fromOffset(160, 48), ZIndex = 5 })

-- 提示条
local toastBox = mk("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 142), Size = UDim2.fromOffset(580, 220) }, root)
mk("UIListLayout", { HorizontalAlignment = Enum.HorizontalAlignment.Center, Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, toastBox)
local KIND = { good = RGB(36, 118, 58), bad = RGB(140, 44, 40), info = RGB(28, 38, 54) }
local toastN = 0
local function toast(msg, kind)
  toastN = toastN + 1
  local t = mk("TextLabel", {
    Text = tostring(msg), Font = FONT2, TextSize = 17, TextColor3 = RGB(255, 255, 255), TextWrapped = true,
    BackgroundColor3 = KIND[kind] or KIND.info, BackgroundTransparency = 0.12, BorderSizePixel = 0,
    Size = UDim2.fromOffset(560, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = toastN,
  }, toastBox)
  round(t, 8)
  mk("UIPadding", { PaddingTop = UDim.new(0, 8), PaddingBottom = UDim.new(0, 8), PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12) }, t)
  -- 最多留 4 条
  local kids = {}
  for _, c in ipairs(toastBox:GetChildren()) do
    if c:IsA("TextLabel") then table.insert(kids, c) end
  end
  table.sort(kids, function(a, b) return a.LayoutOrder < b.LayoutOrder end)
  for i = 1, #kids - 4 do kids[i]:Destroy() end
  task.delay(4.5, function()
    if t.Parent then
      TweenService:Create(t, TweenInfo.new(0.4), { BackgroundTransparency = 1, TextTransparency = 1 }):Play()
      task.wait(0.45)
      t:Destroy()
    end
  end)
end
RToast.OnClientEvent:Connect(toast)

---------------------------------------------------------------- 特效（都在本地画，不占网络）

local FXF = Instance.new("Folder")
FXF.Name = "ClientFx"
FXF.Parent = workspace

local function fxPart(shape, size, cf, color, mat, tr)
  local p = Instance.new("Part")
  if shape then p.Shape = shape end
  p.Size = size
  p.CFrame = cf
  p.Color = color
  p.Material = mat or Enum.Material.Neon
  p.Transparency = tr or 0
  p.Anchored = true
  p.CanCollide = false
  p.CanQuery = false
  p.CanTouch = false
  p.CastShadow = false
  p.Parent = FXF
  return p
end
local function tween(o, t, props, style, dir)
  local tw = TweenService:Create(o, TweenInfo.new(t, style or Enum.EasingStyle.Quad, dir or Enum.EasingDirection.Out), props)
  tw:Play()
  return tw
end
local BALL = Enum.PartType.Ball
local CYL = Enum.PartType.Cylinder
local FLAT = CFrame.Angles(0, 0, math.pi / 2)   -- 圆柱立起来（贴地的圈）

-- 音效（Config.Sounds 里填了 ID 才放；同一时间别放太多）
local soundT, soundN = 0, 0
local function playSound(name, pos)
  local id = Config.Sounds and Config.Sounds[name]
  if not id or id == "" then return end
  local now = os.clock()
  if now - soundT > 0.1 then
    soundT = now
    soundN = 0
  end
  soundN = soundN + 1
  if soundN > 6 then return end
  local p = fxPart(nil, V(0.2, 0.2, 0.2), CFrame.new(pos), RGB(0, 0, 0), Enum.Material.SmoothPlastic, 1)
  local snd = Instance.new("Sound")
  snd.SoundId = id
  snd.Volume = 0.6
  snd.RollOffMaxDistance = 600
  snd.Parent = p
  snd:Play()
  Debris:AddItem(p, 5)
end

local function flash(p, s)
  local f = fxPart(BALL, V(s, s, s), CFrame.new(p), RGB(255, 222, 140), Enum.Material.Neon, 0)
  tween(f, 0.09, { Transparency = 1, Size = V(s, s, s) * 1.6 })
  Debris:AddItem(f, 0.12)
end

local function beam(a, b, w, color, life)
  local len = (b - a).Magnitude
  if len < 0.2 then return end
  local p = fxPart(nil, V(w, w, len), CFrame.lookAt(a, b) * CFrame.new(0, 0, -len / 2), color, Enum.Material.Neon, 0.1)
  tween(p, life, { Transparency = 1 })
  Debris:AddItem(p, life + 0.05)
end

local function boom(p, s)
  local fb = fxPart(BALL, V(2.5, 2.5, 2.5) * s, CFrame.new(p), RGB(255, 175, 70), Enum.Material.Neon, 0.05)
  local light = Instance.new("PointLight")
  light.Color = RGB(255, 170, 90)
  light.Range = 16 * s
  light.Brightness = 3
  light.Parent = fb
  tween(fb, 0.35, { Size = V(8, 8, 8) * s, Transparency = 1 })
  tween(light, 0.35, { Brightness = 0 })
  Debris:AddItem(fb, 0.4)
  local n = (s >= 1) and 3 or 1
  for i = 1, n do   -- 翻滚上升的烟
    local o = V(math.random() - 0.5, 0, math.random() - 0.5) * 3 * s
    local sm = fxPart(BALL, V(3, 3, 3) * s, CFrame.new(p + o), RGB(72, 68, 62), Enum.Material.SmoothPlastic, 0.2)
    tween(sm, 1.4 + i * 0.3, { Size = V(10, 10, 10) * s, Transparency = 1, CFrame = CFrame.new(p + o + V(0, (6 + i * 2) * s, 0)) })
    Debris:AddItem(sm, 1.6 + i * 0.3)
  end
  -- 地面尘土圈（地面顶在 y = 1）
  local ring = fxPart(CYL, V(0.3, 2 * s, 2 * s), CFrame.new(p.X, 1.15, p.Z) * FLAT, RGB(200, 185, 150), Enum.Material.SmoothPlastic, 0.35)
  tween(ring, 0.6, { Size = V(0.3, 14 * s, 14 * s), Transparency = 1 })
  Debris:AddItem(ring, 0.65)
  if s >= 1 then   -- 碎片
    for _ = 1, 5 do
      local d = V(math.random() - 0.5, math.random() * 0.8 + 0.4, math.random() - 0.5).Unit
      local c = fxPart(nil, V(0.5, 0.5, 0.5), CFrame.new(p), RGB(50, 48, 45), Enum.Material.SmoothPlastic, 0)
      tween(c, 0.7, { CFrame = CFrame.new(p + d * 10 * s) * CFrame.Angles(math.random() * 6, math.random() * 6, 0), Transparency = 1 })
      Debris:AddItem(c, 0.75)
    end
  end
end

-- 飞行中的火箭弹、炮弹（抛物线），每帧更新位置，落地时火箭弹自己炸（炮弹的爆炸服务器另发）
local flying = {}
local function launch(a, b, dur, arc, kind)
  local p
  if kind == "shell" then
    p = fxPart(BALL, V(0.9, 0.9, 0.9), CFrame.new(a), RGB(255, 200, 120), Enum.Material.Neon, 0)
  else
    p = fxPart(nil, V(0.35, 0.35, 2.4), CFrame.new(a), RGB(255, 190, 90), Enum.Material.Neon, 0)
  end
  table.insert(flying, { p = p, a = a, b = b, t0 = os.clock(), dur = math.max(0.05, dur), arc = arc, kind = kind, puff = 0 })
end
local function arcPos(f, k)
  return f.a:Lerp(f.b, k) + V(0, f.arc * 4 * k * (1 - k), 0)
end
local function stepFlying()
  local now = os.clock()
  for i = #flying, 1, -1 do
    local f = flying[i]
    local k = (now - f.t0) / f.dur
    if k >= 1 then
      f.p:Destroy()
      table.remove(flying, i)
      if f.kind == "rocket" then boom(f.b, 0.55) end
    else
      local pos = arcPos(f, k)
      local ahead = arcPos(f, math.min(1, k + 0.02))
      if (ahead - pos).Magnitude > 0.001 then
        f.p.CFrame = CFrame.lookAt(pos, ahead)
      else
        f.p.CFrame = CFrame.new(pos)
      end
      f.puff = f.puff + 1
      if f.puff % 3 == 0 then   -- 尾烟
        local s = fxPart(BALL, V(0.9, 0.9, 0.9), CFrame.new(pos), RGB(150, 146, 140), Enum.Material.SmoothPlastic, 0.4)
        tween(s, 0.8, { Size = V(2.6, 2.6, 2.6), Transparency = 1 })
        Debris:AddItem(s, 0.85)
      end
    end
  end
end

local SHOT = {
  inf = { w = 0.12, c = RGB(255, 232, 130), life = 0.06, fl = 0.8, snd = "rifle" },
  tank = { w = 0.45, c = RGB(255, 185, 90), life = 0.12, fl = 3, hit = 0.7, snd = "cannon" },
  aa = { w = 0.2, c = RGB(255, 214, 100), life = 0.07, fl = 1.2, n = 2, snd = "aa" },
}
local function shot(e)
  if e.u == "heli" then
    launch(e.a, e.b, 0.35, 0, "rocket")
    flash(e.a, 1.4)
    playSound("rocket", e.a)
    return
  end
  local s = SHOT[e.u] or SHOT.inf
  for i = 1, (s.n or 1) do
    local off = V(0, 0, 0)
    if i > 1 then off = V(math.random() - 0.5, math.random() - 0.5, math.random() - 0.5) * 1.2 end
    beam(e.a + off, e.b + off, s.w, s.c, s.life)
  end
  flash(e.a, s.fl)
  if s.hit then boom(e.b, s.hit) end
  playSound(s.snd, e.a)
end

local function buildFx(p, s)
  local ring = fxPart(CYL, V(0.4, s * 0.5, s * 0.5), CFrame.new(p.X, 1.2, p.Z) * FLAT, RGB(220, 210, 180), Enum.Material.SmoothPlastic, 0.2)
  tween(ring, 0.9, { Size = V(0.4, s * 1.8, s * 1.8), Transparency = 1 })
  Debris:AddItem(ring, 1)
  for i = 1, 8 do
    local a = i / 8 * math.pi * 2
    local q = p + V(math.cos(a) * s * 0.5, 1, math.sin(a) * s * 0.5)
    local sm = fxPart(BALL, V(4, 4, 4), CFrame.new(q), RGB(200, 192, 170), Enum.Material.SmoothPlastic, 0.3)
    tween(sm, 1.2, { Size = V(9, 9, 9), Transparency = 1, CFrame = CFrame.new(q + V(0, 5, 0)) })
    Debris:AddItem(sm, 1.3)
  end
  local sp = fxPart(BALL, V(2, 2, 2), CFrame.new(p + V(0, 4, 0)), RGB(255, 225, 120), Enum.Material.Neon, 0.1)
  tween(sp, 0.6, { Size = V(s, s, s) * 0.8, Transparency = 1 })
  Debris:AddItem(sp, 0.65)
  playSound("build", p)
end

-- 楼顶冒出来的「+$5」
local function popText(p, str, color)
  local anchor = fxPart(nil, V(0.2, 0.2, 0.2), CFrame.new(p), RGB(0, 0, 0), Enum.Material.SmoothPlastic, 1)
  local bb = mk("BillboardGui", { Size = UDim2.new(8, 0, 2, 0), LightInfluence = 0, MaxDistance = 220, AlwaysOnTop = true }, anchor)
  local t = mk("TextLabel", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Text = str, TextColor3 = color, TextStrokeTransparency = 0.3, Font = FONT, TextScaled = true }, bb)
  tween(bb, 1.6, { StudsOffsetWorldSpace = V(0, 6, 0) })
  tween(t, 1.6, { TextTransparency = 1, TextStrokeTransparency = 1 }, Enum.EasingStyle.Quad, Enum.EasingDirection.In)
  Debris:AddItem(anchor, 1.7)
end

RFx.OnClientEvent:Connect(function(list)
  if type(list) ~= "table" then return end
  local cp = cam.CFrame.Position
  for _, e in ipairs(list) do
    local at = e.a or e.p
    if typeof(at) == "Vector3" and (at - cp).Magnitude < 900 then   -- 太远的（别人的战场）不画
      if e.k == "shot" then
        shot(e)
      elseif e.k == "shell" then
        launch(e.a, e.b, e.t or 2, (e.b - e.a).Magnitude * 0.28, "shell")
        flash(e.a, 2.4)
        playSound("cannon", e.a)
      elseif e.k == "boom" then
        boom(e.p, e.s or 1)
        playSound("boom", e.p)
      elseif e.k == "build" then
        buildFx(e.p, e.s or 20)
      end
    end
  end
end)

-- 直升机旋翼：飞的时候转（服务器在模型上设 Fly 属性）
local rotorA = 0
local function spinRotors(dt)
  rotorA = (rotorA + dt * 28) % (math.pi * 2)
  for _, m in ipairs(CollectionService:GetTagged("Rotor")) do
    if m:IsA("Motor6D") then
      local hub = m.Parent
      local model = hub and hub.Parent
      if model and model:GetAttribute("Fly") then
        m.Transform = CFrame.Angles(0, rotorA, 0)
      end
    end
  end
end

---------------------------------------------------------------- 布阵：选部队、放下

local function myPlot()
  if not S then return nil end
  local plotsF = workspace:FindFirstChild("Plots")
  return plotsF and plotsF:FindFirstChild("Plot" .. tostring(S.plot))
end

local rayParams = RaycastParams.new()
rayParams.FilterType = Enum.RaycastFilterType.Include
-- 只打自己的部队和自己的战场地面；viewport 为真时 (x, y) 是 GetMouseLocation 的坐标
local function cast(x, y, viewport)
  local pf = myPlot()
  if not pf then return nil end
  local list = {}
  local units = pf:FindFirstChild("Units")
  local field = pf:FindFirstChild("Field")
  if units then table.insert(list, units) end
  if field then table.insert(list, field) end
  rayParams.FilterDescendantsInstances = list
  local ray
  if viewport then ray = cam:ViewportPointToRay(x, y) else ray = cam:ScreenPointToRay(x, y) end
  return workspace:Raycast(ray.Origin, ray.Direction * 3000, rayParams)
end

local function inDeploy(x, z)
  return z >= F.deploy[1] and z <= F.deploy[2] and math.abs(x) <= F.width / 2 - 4
end

local hl = nil
local ghostP = nil
local updateButtons

local function deselect()
  sel = nil
  if hl then
    hl:Destroy()
    hl = nil
  end
  if ghostP then ghostP.Transparency = 1 end
  if updateButtons then updateButtons() end
end

local function selectModel(m)
  deselect()
  local uid = m:GetAttribute("Uid")
  if not uid then return end
  sel = { model = m, uid = uid, t = m:GetAttribute("Type") }
  hl = mk("Highlight", { FillColor = RGB(255, 220, 80), FillTransparency = 0.55, OutlineColor = RGB(255, 240, 160), OutlineTransparency = 0, DepthMode = Enum.HighlightDepthMode.AlwaysOnTop }, m)
  local def = UNITS[sel.t]
  if def then sellBtn.Text = "解散 +$" .. Config.Fmt(math.floor(def.price * 0.5)) end
  updateButtons()
end

local function clickAt(x, y)
  if mode ~= "deploy" or not S or S.battle then return end
  local res = cast(x, y, false)
  if not res then return end
  local m = res.Instance:FindFirstAncestorOfClass("Model")
  if m and m:GetAttribute("Uid") and not m:GetAttribute("Dead") then
    if sel and sel.model == m then deselect() else selectModel(m) end
    return
  end
  if not sel then
    toast("先点一下自己的部队，再点要放的位置", "info")
    return
  end
  local rel = res.Position - S.origin
  if not inDeploy(rel.X, rel.Z) then
    toast("只能摆在蓝色的部署区里", "bad")
    return
  end
  RAction:FireServer("move", sel.uid, rel.X, rel.Z)
  deselect()
end

-- 电脑上：选中部队后，鼠标下面画个圈（绿色能放、红色不能放）
local function ghostUpdate()
  if mode ~= "deploy" or not sel or mobile or not S then
    if ghostP then ghostP.Transparency = 1 end
    return
  end
  if not ghostP then
    ghostP = fxPart(CYL, V(0.3, 8, 8), CFrame.new(), RGB(90, 220, 120), Enum.Material.Neon, 1)
  end
  local mp = UIS:GetMouseLocation()
  local res = cast(mp.X, mp.Y, true)
  if not res or res.Instance.Name ~= "Field" then
    ghostP.Transparency = 1
    return
  end
  local rel = res.Position - S.origin
  local def = UNITS[sel.t]
  local d = (def and def.size or 6) + 2
  ghostP.Size = V(0.3, d, d)
  ghostP.CFrame = CFrame.new(res.Position.X, 1.2, res.Position.Z) * FLAT
  ghostP.Color = inDeploy(rel.X, rel.Z) and RGB(90, 220, 120) or RGB(230, 80, 70)
  ghostP.Transparency = 0.45
end

---------------------------------------------------------------- 镜头与模式

local orbit = { yaw = 0, pitch = math.rad(52), dist = 240, focus = V(0, 0, 0) }
local camCF = nil
local rotating = false
local controls = nil
task.spawn(function()
  local ok, res = pcall(function()
    local pm = require(player:WaitForChild("PlayerScripts"):WaitForChild("PlayerModule", 15))
    return pm:GetControls()
  end)
  if ok then controls = res end
end)

local function setMode(m)
  mode = m
  local o = S and S.origin or V(0, 0, 0)
  if m == "free" then
    cam.CameraType = Enum.CameraType.Custom
    local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
    if hum then cam.CameraSubject = hum end
    if controls then controls:Enable() end
    UIS.MouseBehavior = Enum.MouseBehavior.Default
    rotating = false
  else
    camCF = cam.CFrame
    cam.CameraType = Enum.CameraType.Scriptable
    if controls then controls:Disable() end
    if m == "deploy" then
      orbit.focus = o + V(0, 0, (F.deploy[1] + F.deploy[2]) / 2 + 40)
      orbit.yaw, orbit.pitch, orbit.dist = 0, math.rad(55), 230
    else
      orbit.focus = o + V(0, 0, F.center)
      orbit.yaw, orbit.pitch, orbit.dist = 0, math.rad(46), 320
    end
  end
  PPS.Enabled = (m == "free")   -- 布阵 / 观战时别误触建筑旁的 E 提示
  deselect()
end

function updateButtons()
  local fighting = S ~= nil and S.battle == true
  deployBtn.Text = (mode == "deploy") and "回基地" or "布阵"
  deployBtn.Visible = mode ~= "battle"
  fightBtn.Visible = mode ~= "battle"
  fightBtn.Text = fighting and "战斗中…" or "开战！"
  arrangeBtn.Visible = mode == "deploy"
  sellBtn.Visible = mode == "deploy" and sel ~= nil
  hqBtn.Visible = mode == "free" and S ~= nil and S.hqNext ~= nil
  if S ~= nil and S.hqNext ~= nil then hqBtn.Text = "升级指挥部 $" .. Config.Fmt(S.hqNext) end
  shop.Visible = mode ~= "battle"
  hint.Visible = mode == "deploy"
  bpanel.Visible = mode == "battle"
end

local function refresh()
  if not S then return end
  cashL.Text = "$" .. Config.Fmt(S.cash)
  incL.Text = "+" .. Config.Fmt(S.income) .. " / 秒"
  lvL.Text = "第 " .. tostring(S.level) .. " 关"
  armyL.Text = "部队 " .. tostring(S.n) .. " / " .. tostring(S.cap)
  local parts = {}
  for _, t in ipairs(Config.UnitOrder) do
    local n = S.enemy and S.enemy[t]
    if n and n > 0 then table.insert(parts, UNITS[t].name .. "×" .. n) end
  end
  enemyL.Text = (#parts > 0) and ("敌军：" .. table.concat(parts, "  ")) or "敌军：侦察中…"
  rewardL.Text = "胜利奖励 $" .. Config.Fmt(S.reward or 0)
  for _, t in ipairs(Config.UnitOrder) do
    local r = rows[t]
    local def = UNITS[t]
    local src = Config.BuildingById[Config.UnitSource[t]]
    local have = (S.counts and S.counts[t]) or 0
    r.name.Text = def.name .. ((have > 0) and ("  ×" .. have) or "")
    if not (S.owned and S.owned[src.id]) then
      r.btn.Text = "需" .. src.name
      r.btn.TextSize = 13
      r.btn.BackgroundColor3 = RGB(70, 74, 80)
    else
      local ok = S.cash >= def.price and S.n < S.cap and not S.battle
      r.btn.Text = "$" .. Config.Fmt(def.price)
      r.btn.TextSize = 16
      r.btn.BackgroundColor3 = ok and RGB(60, 150, 80) or RGB(96, 72, 62)
    end
  end
  local tl = S.tech or 0
  techName.Text = "军工科技 Lv." .. tostring(tl)
  techDesc.Text = "全军血量、伤害 +" .. math.floor(tl * Config.Tech.bonus * 100 + 0.5) .. "%，每级再 +" .. math.floor(Config.Tech.bonus * 100 + 0.5) .. "%"
  if S.techNext then
    techBtn.Text = "$" .. Config.Fmt(S.techNext)
    techBtn.BackgroundColor3 = (S.cash >= S.techNext) and RGB(170, 135, 40) or RGB(96, 82, 52)
  else
    techBtn.Text = "满级"
    techBtn.BackgroundColor3 = RGB(70, 74, 80)
  end
  updateButtons()
end

RState.OnClientEvent:Connect(function(s)
  if type(s) ~= "table" then return end
  S = s
  refresh()
end)

deployBtn.Activated:Connect(function()
  if mode == "deploy" then
    setMode("free")
  elseif S then
    if S.n == 0 then toast("还没有部队：先盖兵营，再在右边「兵工厂」生产", "info") end
    setMode("deploy")
  end
end)
fightBtn.Activated:Connect(function()
  if S and not S.battle then RAction:FireServer("battle") end
end)
arrangeBtn.Activated:Connect(function()
  RAction:FireServer("arrange")
end)
sellBtn.Activated:Connect(function()
  if sel then
    RAction:FireServer("sell", sel.uid)
    deselect()
  end
end)
hqBtn.Activated:Connect(function()
  RAction:FireServer("hq")
end)
resDeploy.Activated:Connect(function()
  result.Visible = false
  setMode("deploy")
end)
resHome.Activated:Connect(function()
  result.Visible = false
  setMode("free")
end)

---------------------------------------------------------------- 战斗

local battleT0, battleLen, battleLevel = 0, Config.BattleTime, 1
local battleEnemy = nil

local function counterTip(enemy)
  if not enemy then return "多造一些兵再来" end
  if (enemy.heli or 0) > 0 then return "敌方有直升机：带上防空车，或者多带步兵" end
  if (enemy.tank or 0) >= 2 then return "敌方坦克多：武装直升机专克坦克" end
  if (enemy.arty or 0) > 0 then return "敌方有火炮：别把步兵挤成一团，用坦克冲上去" end
  return "多造一些兵再来，坦克克步兵"
end

local function showResult(ev)
  local win = ev.result == "win"
  resTitle.Text = win and "胜利！" or ((ev.result == "timeout") and "时间到" or "失败")
  resTitle.TextColor3 = win and RGB(255, 214, 90) or RGB(240, 110, 100)
  local lines = {}
  if win then
    table.insert(lines, "奖励 $" .. Config.Fmt(ev.reward or 0) .. "，下一关：第 " .. tostring(ev.level) .. " 关")
  else
    table.insert(lines, counterTip(battleEnemy))
  end
  if (ev.lostN or 0) > 0 then
    local parts = {}
    for _, t in ipairs(Config.UnitOrder) do
      local n = ev.lost and ev.lost[t]
      if n then table.insert(parts, UNITS[t].name .. "×" .. n) end
    end
    table.insert(lines, "损失：" .. table.concat(parts, "  "))
  else
    table.insert(lines, "一个都没损失！")
  end
  resBody.Text = table.concat(lines, "\n")
  result.Visible = true
  playSound(win and "win" or "lose", cam.CFrame.Position)
end

RBattle.OnClientEvent:Connect(function(ev)
  if type(ev) ~= "table" then return end
  if ev.phase == "start" then
    result.Visible = false
    battleLen = ev.time or Config.BattleTime
    battleT0 = os.clock()
    battleLevel = ev.level or 1
    battleEnemy = S and S.enemy
    bInfo.Text = ""
    setMode("battle")
  elseif ev.phase == "tick" then
    battleT0 = os.clock() - (ev.t or 0)
    bInfo.Text = "<font color=\"#7CFC8A\">我方 " .. tostring(ev.a) .. "</font>      <font color=\"#FF8A80\">敌方 " .. tostring(ev.e) .. "</font>"
  elseif ev.phase == "end" then
    showResult(ev)
  end
end)

---------------------------------------------------------------- 输入

UIS.InputBegan:Connect(function(input, gp)
  if input.UserInputType == Enum.UserInputType.MouseButton2 and mode ~= "free" then
    rotating = true
    UIS.MouseBehavior = Enum.MouseBehavior.LockCurrentPosition
  end
  if gp then return end
  if input.UserInputType == Enum.UserInputType.MouseButton1 then
    clickAt(input.Position.X, input.Position.Y)
  end
end)
UIS.InputEnded:Connect(function(input)
  if input.UserInputType == Enum.UserInputType.MouseButton2 then
    rotating = false
    if mode ~= "free" then UIS.MouseBehavior = Enum.MouseBehavior.Default end
  end
end)
UIS.InputChanged:Connect(function(input, gp)
  if mode == "free" then return end
  if input.UserInputType == Enum.UserInputType.MouseMovement and rotating then
    orbit.yaw = orbit.yaw - input.Delta.X * 0.008
    orbit.pitch = math.clamp(orbit.pitch + input.Delta.Y * 0.006, 0.25, 1.45)
  elseif input.UserInputType == Enum.UserInputType.MouseWheel and not gp then
    orbit.dist = math.clamp(orbit.dist * (1 - 0.12 * input.Position.Z), 50, 650)
  end
end)
UIS.TouchTap:Connect(function(positions, gp)
  if gp then return end
  local p = positions[1]
  if p then clickAt(p.X, p.Y) end
end)
local pan0 = nil
UIS.TouchPan:Connect(function(positions, total, velocity, state, gp)
  if mode == "free" or gp or #positions ~= 1 then return end
  if state == Enum.UserInputState.Begin then
    pan0 = { yaw = orbit.yaw, pitch = orbit.pitch }
  elseif pan0 then
    orbit.yaw = pan0.yaw - total.X * 0.006
    orbit.pitch = math.clamp(pan0.pitch + total.Y * 0.004, 0.25, 1.45)
    if state == Enum.UserInputState.End then pan0 = nil end
  end
end)
local pinch0 = nil
UIS.TouchPinch:Connect(function(positions, scale, velocity, state, gp)
  if mode == "free" then return end
  if state == Enum.UserInputState.Begin then
    pinch0 = orbit.dist
  elseif pinch0 and scale > 0 then
    orbit.dist = math.clamp(pinch0 / scale, 50, 650)
    if state == Enum.UserInputState.End then pinch0 = nil end
  end
end)

---------------------------------------------------------------- 每帧

local popT = 0
RunService.RenderStepped:Connect(function(dt)
  if mode ~= "free" then
    if not UIS:GetFocusedTextBox() then
      local cf = cam.CFrame
      local fwd = V(cf.LookVector.X, 0, cf.LookVector.Z)
      local right = V(cf.RightVector.X, 0, cf.RightVector.Z)
      if fwd.Magnitude > 0.01 then fwd = fwd.Unit end
      if right.Magnitude > 0.01 then right = right.Unit end
      local mv = V(0, 0, 0)
      if UIS:IsKeyDown(Enum.KeyCode.W) or UIS:IsKeyDown(Enum.KeyCode.Up) then mv = mv + fwd end
      if UIS:IsKeyDown(Enum.KeyCode.S) or UIS:IsKeyDown(Enum.KeyCode.Down) then mv = mv - fwd end
      if UIS:IsKeyDown(Enum.KeyCode.D) or UIS:IsKeyDown(Enum.KeyCode.Right) then mv = mv + right end
      if UIS:IsKeyDown(Enum.KeyCode.A) or UIS:IsKeyDown(Enum.KeyCode.Left) then mv = mv - right end
      if UIS:IsKeyDown(Enum.KeyCode.Q) then orbit.yaw = orbit.yaw + dt * 1.5 end
      if UIS:IsKeyDown(Enum.KeyCode.E) then orbit.yaw = orbit.yaw - dt * 1.5 end
      if mv.Magnitude > 0 then orbit.focus = orbit.focus + mv.Unit * dt * 120 * (orbit.dist / 250) end
    end
    if S then   -- 别跑出自己的战场太远
      local o = S.origin
      orbit.focus = V(math.clamp(orbit.focus.X, o.X - 180, o.X + 180), 0, math.clamp(orbit.focus.Z, o.Z - 60, o.Z + F.center + F.length / 2 + 40))
    end
    local cp = math.cos(orbit.pitch)
    local off = V(-math.sin(orbit.yaw) * cp, math.sin(orbit.pitch), -math.cos(orbit.yaw) * cp) * orbit.dist
    local want = CFrame.lookAt(orbit.focus + off, orbit.focus)
    if camCF then camCF = camCF:Lerp(want, 1 - math.exp(-dt * 7)) else camCF = want end
    cam.CFrame = camCF
  end
  if mode == "battle" then
    local left = math.max(0, battleLen - (os.clock() - battleT0))
    bTitle.Text = string.format("第 %d 关   %d:%02d", battleLevel, math.floor(left / 60), math.floor(left % 60))
  end
  spinRotors(dt)
  stepFlying()
  ghostUpdate()
  -- 自己基地的楼顶隔几秒冒「+$」
  popT = popT + dt
  if popT >= 3 and S and mode == "free" and S.owned then
    popT = 0
    for id in pairs(S.owned) do
      local b = Config.BuildingById[id]
      if b and b.income then
        local v = b.income
        if b.kind == "factory" and S.owned.power then v = v * Config.PowerBoost end
        local p = S.origin + V(b.x, 1 + b.size[2] + 2, b.z)
        if (p - cam.CFrame.Position).Magnitude < 200 then popText(p, "+$" .. Config.Fmt(v * 3), RGB(130, 235, 140)) end
      end
    end
  end
end)
