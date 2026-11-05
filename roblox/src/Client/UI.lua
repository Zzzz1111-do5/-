-- 军事大亨（客户端）：界面——钱、关卡、兵工厂、按钮、提示；任务、武器、排行榜、约战、重生、致谢；每日奖励、约战邀请；战斗中的面板、结果
local Players = game:GetService("Players")
local UIS = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")

local UI = {}

-- 模型署名（CC-BY 要求在游戏里写明；和 roblox/models/credits.txt 一致）
local CREDITS = {
  "步兵：Army Character 2 —— MirzaArrafiERV_45",
  "步兵战车：M2 Bradley IFV —— 42manako",
  "主战坦克：M1A1 Abrams Main Battle Tank —— MirzaArrafiERV_45",
  "防空车：M163 VADS —— 42manako",
  "自行火炮：M109 PALADIN ARTILLERY —— Muhamad Mirza Arrafi",
  "火箭炮：Free M270 —— Mr. Penguin",
  "武装直升机：Boeing AH-64D Apache Combat Helicopter —— Muhamad Mirza Arrafi",
  "运兵直升机：Sikorsky UH-60M Blackhawk —— Muhamad Mirza Arrafi",
  "察打无人机：MQ-9 —— IProZenoN",
  "攻击机：A-10 Thunderbolt II —— AIRMAN Magazine",
  "战斗机：Chengdu J-20 Fighter —— andertan",
  "轰炸机：Chinese Xi'an H-6 —— 42manako",
  "机枪车：Oshkosh M-ATV —— 42manako",
  "突击炮：Chinese PTL-02 —— 42manako",
  "破障车：M1150 ABV —— Kalibrovshik",
  "弹炮防空车：Type-625 Anti Aircraft Gun Missile System —— Muhamad Mirza Arrafi",
  "拦截炮：Centurion C-RAM —— Muhamad Mirza Arrafi",
  "防空导弹：MIM-104 Patriot Air Defense System —— Muhamad Mirza Arrafi",
  "牵引榴弹炮：M777 howitzer —— miloschnack",
  "重型自行火炮：PANZERHAUBITZE 2000 ARTILLERY (PzH-2000) —— Muhamad Mirza Arrafi",
  "标枪：FGM-148 Javelin (Low-Poly) —— GoldbergR",
  "毒刺：FIM-92 Stinger (Low-Poly) —— GoldbergR",
  "迫击炮：Mortar - M224 —— jcherry3d",
  "机枪：Low-Poly M240B —— TastyTony",
  "以上模型都来自 Sketchfab，CC-BY-4.0 授权；只缩小了贴图、用了简化网格（PzH 2000 的贴图调亮了）",
}

function UI.init(G)
  local Config = G.Config
  local UNITS = Config.Units
  local RGB = Color3.fromRGB
  local V2 = Vector2.new
  local player = Players.LocalPlayer
  local cam = workspace.CurrentCamera
  local FONT, FONT2 = Enum.Font.GothamBold, Enum.Font.GothamMedium
  local mobile = UIS.TouchEnabled and not UIS.KeyboardEnabled
  G.mobile = mobile
  local RA = G.R.Action
  local ui = {}
  G.ui = ui

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
  local function button(parent, txt, color, props, onClick)
    local b = mk("TextButton", { Text = txt, Font = FONT, TextSize = 18, TextColor3 = RGB(255, 255, 255), BackgroundColor3 = color, AutoButtonColor = true, BorderSizePixel = 0 })
    round(b, 8)
    for k, v in pairs(props or {}) do b[k] = v end
    b.Parent = parent
    if onClick then b.Activated:Connect(onClick) end
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
  G.mk, G.round, G.text, G.button = mk, round, text, button

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
  ui.root = root

  ---------------------------------------------------------------- 常驻面板

  local top = panel(root, { AnchorPoint = V2(0.5, 0), Position = UDim2.new(0.5, 0, 0, 8), Size = UDim2.fromOffset(420, 56) })
  local cashL = text(top, { Position = UDim2.fromOffset(18, 0), Size = UDim2.new(0.6, -18, 1, 0), Font = FONT, TextSize = 30, TextColor3 = RGB(255, 214, 90), Text = "$0" })
  local incL = text(top, { Position = UDim2.new(0.6, 0, 0, 0), Size = UDim2.new(0.4, -16, 1, 0), TextSize = 18, TextColor3 = RGB(130, 235, 140), TextXAlignment = Enum.TextXAlignment.Right, Text = "+0 / 秒" })

  local info = panel(root, { Position = UDim2.fromOffset(10, 72), Size = UDim2.fromOffset(280, 196) })
  local lvL = text(info, { Position = UDim2.fromOffset(14, 8), Size = UDim2.new(1, -28, 0, 28), Font = FONT, TextSize = 22, Text = "第 1 关" })
  local armyL = text(info, { Position = UDim2.fromOffset(14, 38), Size = UDim2.new(1, -28, 0, 20), Text = "部队 0 / 4" })
  local enemyL = text(info, { Position = UDim2.fromOffset(14, 60), Size = UDim2.new(1, -28, 0, 52), TextSize = 14, TextWrapped = true, TextScaled = true, TextYAlignment = Enum.TextYAlignment.Top, TextColor3 = RGB(255, 165, 150) })
  mk("UITextSizeConstraint", { MaxTextSize = 14, MinTextSize = 9 }, enemyL)
  local rewardL = text(info, { Position = UDim2.fromOffset(14, 112), Size = UDim2.new(1, -28, 0, 20), TextSize = 14, TextColor3 = RGB(255, 214, 90) })
  local rankL = text(info, { Position = UDim2.fromOffset(14, 134), Size = UDim2.new(1, -28, 0, 20), TextSize = 15, Font = FONT, TextColor3 = RGB(255, 216, 106) })
  local xpBg = mk("Frame", { BackgroundColor3 = RGB(40, 44, 50), BorderSizePixel = 0, Position = UDim2.fromOffset(14, 157), Size = UDim2.new(1, -28, 0, 6) }, info)
  round(xpBg, 3)
  local xpFill = mk("Frame", { BackgroundColor3 = RGB(255, 200, 80), BorderSizePixel = 0, Size = UDim2.fromScale(0, 1) }, xpBg)
  round(xpFill, 3)
  local ratingL = text(info, { Position = UDim2.fromOffset(14, 168), Size = UDim2.new(1, -28, 0, 20), TextSize = 13, TextColor3 = RGB(170, 190, 210) })

  -- 左边一列菜单按钮
  local menu = mk("Frame", { BackgroundTransparency = 1, Position = UDim2.fromOffset(10, 276), Size = UDim2.fromOffset(140, 300) }, root)
  mk("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, menu)
  local modals = {}
  local function closeModals()
    for _, m in pairs(modals) do m.Visible = false end
  end
  local function open(name)
    local m = modals[name]
    local was = m.Visible
    closeModals()
    m.Visible = not was
    if m.Visible and ui.fill[name] then ui.fill[name]() end
  end
  ui.fill = {}
  local btnMission = button(menu, "任务", RGB(52, 84, 120), { Size = UDim2.fromOffset(140, 40), LayoutOrder = 1, TextSize = 16 }, function() open("missions") end)
  button(menu, "武器", RGB(60, 74, 60), { Size = UDim2.fromOffset(140, 40), LayoutOrder = 2, TextSize = 16 }, function() open("weapons") end)
  button(menu, "排行榜", RGB(84, 70, 40), { Size = UDim2.fromOffset(140, 40), LayoutOrder = 3, TextSize = 16 }, function() open("board") end)
  local btnDuel = button(menu, "约战玩家", RGB(120, 52, 52), { Size = UDim2.fromOffset(140, 40), LayoutOrder = 4, TextSize = 16 }, function() open("duel") end)
  local btnRebirth = button(menu, "重生", RGB(150, 110, 30), { Size = UDim2.fromOffset(140, 40), LayoutOrder = 5, TextSize = 16, Visible = false }, function() open("rebirth") end)
  button(menu, "致谢", RGB(54, 58, 66), { Size = UDim2.fromOffset(140, 34), LayoutOrder = 6, TextSize = 14 }, function() open("credits") end)

  -- 右边：兵工厂（按页签分类：步兵 / 装甲 / 防空 / 炮兵 / 空中，可以滚动；最下面一行是军工科技）
  local ROWH = 62
  local shop = panel(root, { AnchorPoint = V2(1, 0), Position = UDim2.new(1, -10, 0, 72), Size = UDim2.fromOffset(330, 500) })
  text(shop, { Position = UDim2.fromOffset(14, 6), Size = UDim2.new(1, -28, 0, 28), Font = FONT, TextSize = 20, Text = "兵工厂" })
  local tabBar = mk("Frame", { BackgroundTransparency = 1, Position = UDim2.fromOffset(10, 38), Size = UDim2.new(1, -20, 0, 30) }, shop)
  mk("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, tabBar)
  local list = mk("ScrollingFrame", { BackgroundTransparency = 1, BorderSizePixel = 0, Position = UDim2.fromOffset(6, 74), Size = UDim2.new(1, -12, 1, -80),
    CanvasSize = UDim2.fromOffset(0, 0), ScrollBarThickness = 5 }, shop)
  local rows = {}
  local function row(color)
    local r = mk("Frame", { BackgroundColor3 = color or RGB(255, 255, 255), BackgroundTransparency = color and 0.9 or 0.94, BorderSizePixel = 0, Size = UDim2.new(1, -10, 0, ROWH - 6) }, list)
    round(r, 8)
    local n = text(r, { Position = UDim2.fromOffset(10, 4), Size = UDim2.new(1, -112, 0, 22), Font = FONT, TextSize = 16 })
    local d = text(r, { Position = UDim2.fromOffset(10, 26), Size = UDim2.new(1, -112, 0, 28), TextSize = 11, TextWrapped = true, TextYAlignment = Enum.TextYAlignment.Top, TextColor3 = RGB(170, 180, 192) })
    return r, n, d
  end
  for _, t in ipairs(Config.UnitOrder) do
    local def = UNITS[t]
    local r, n, d = row()
    n.Text = def.name
    d.Text = def.desc
    local b = button(r, "$" .. Config.Fmt(def.price), RGB(60, 150, 80), { AnchorPoint = V2(1, 0.5), Position = UDim2.new(1, -8, 0.5, 0), Size = UDim2.fromOffset(94, 40), TextSize = 15 },
      function() RA:FireServer("buy", t) end)
    rows[t] = { frame = r, name = n, btn = b }
  end
  local techRow, techName, techDesc = row(RGB(255, 214, 90))
  local techBtn = button(techRow, "", RGB(150, 120, 40), { AnchorPoint = V2(1, 0.5), Position = UDim2.new(1, -8, 0.5, 0), Size = UDim2.fromOffset(94, 40), TextSize = 15 },
    function() RA:FireServer("tech") end)
  techName.TextColor3 = RGB(255, 222, 130)
  local tabBtns = {}
  local function showTab(id)
    ui.tab = id
    local i = 0
    for _, t in ipairs(Config.UnitOrder) do
      local r = rows[t]
      local on = UNITS[t].cat == id
      r.frame.Visible = on
      if on then
        r.frame.Position = UDim2.fromOffset(2, i * ROWH)
        i = i + 1
      end
    end
    techRow.Position = UDim2.fromOffset(2, i * ROWH)
    list.CanvasSize = UDim2.fromOffset(0, (i + 1) * ROWH)
    list.CanvasPosition = V2(0, 0)
    for tid, b in pairs(tabBtns) do b.BackgroundColor3 = (tid == id) and RGB(60, 110, 170) or RGB(44, 50, 60) end
  end
  for i, tab in ipairs(Config.Tabs) do
    tabBtns[tab.id] = button(tabBar, tab.name, RGB(44, 50, 60), { Size = UDim2.fromOffset(58, 28), LayoutOrder = i, TextSize = 14 }, function() showTab(tab.id) end)
  end
  showTab("foot")
  G.shopTab = showTab
  ui.shop = shop

  -- 下面一排按钮（抬高一点，让开 Roblox 的物品栏）
  local bar = mk("Frame", { BackgroundTransparency = 1, AnchorPoint = V2(0.5, 1), Position = UDim2.new(0.5, 0, 1, -78), Size = UDim2.fromOffset(900, 52) }, root)
  mk("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Center, VerticalAlignment = Enum.VerticalAlignment.Center, Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }, bar)
  ui.deployBtn = button(bar, "布阵", RGB(45, 95, 165), { Size = UDim2.fromOffset(120, 48), LayoutOrder = 1 }, function() G.toggleDeploy() end)
  ui.arrangeBtn = button(bar, "一键排阵", RGB(70, 115, 75), { Size = UDim2.fromOffset(120, 48), LayoutOrder = 2, Visible = false }, function() RA:FireServer("arrange") end)
  ui.sellBtn = button(bar, "解散", RGB(120, 62, 52), { Size = UDim2.fromOffset(150, 48), LayoutOrder = 3, Visible = false }, function() G.sellSelected() end)
  ui.fightBtn = button(bar, "开战！", RGB(195, 52, 45), { Size = UDim2.fromOffset(140, 48), LayoutOrder = 4, TextSize = 22 }, function()
    if G.S and not G.S.battle then RA:FireServer("battle") end
  end)
  ui.raidBtn = button(bar, "突袭", RGB(150, 70, 30), { Size = UDim2.fromOffset(120, 48), LayoutOrder = 5 }, function()
    if G.S and not G.S.battle then RA:FireServer("raid") end
  end)
  ui.hqBtn = button(bar, "升级指挥部", RGB(125, 102, 40), { Size = UDim2.fromOffset(200, 48), LayoutOrder = 6, TextSize = 15, Visible = false }, function() RA:FireServer("hq") end)

  ui.hint = text(root, {
    AnchorPoint = V2(0.5, 1), Position = UDim2.new(0.5, 0, 1, -136), Size = UDim2.fromOffset(820, 24),
    TextXAlignment = Enum.TextXAlignment.Center, TextSize = 15, TextStrokeTransparency = 0.4, Visible = false,
    Text = mobile and "点自己的部队选中，再点蓝色部署区放下 · 单指拖动转镜头 · 双指缩放"
      or "点自己的部队选中，再点蓝色部署区放下 · 右键拖动转镜头 · 滚轮缩放 · WASD 移动 · Q / E 转向",
  })

  ---------------------------------------------------------------- 战斗中

  local bpanel = panel(root, { AnchorPoint = V2(0.5, 0), Position = UDim2.new(0.5, 0, 0, 72), Size = UDim2.fromOffset(420, 62), Visible = false })
  ui.bTitle = text(bpanel, { Position = UDim2.fromOffset(0, 4), Size = UDim2.new(1, 0, 0, 28), Font = FONT, TextSize = 21, TextXAlignment = Enum.TextXAlignment.Center })
  ui.bInfo = text(bpanel, { Position = UDim2.fromOffset(0, 33), Size = UDim2.new(1, 0, 0, 22), TextSize = 16, TextXAlignment = Enum.TextXAlignment.Center, RichText = true })
  ui.bpanel = bpanel
  local bbar = mk("Frame", { BackgroundTransparency = 1, AnchorPoint = V2(0.5, 1), Position = UDim2.new(0.5, 0, 1, -78), Size = UDim2.fromOffset(820, 52), Visible = false }, root)
  mk("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Center, VerticalAlignment = Enum.VerticalAlignment.Center, Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }, bbar)
  ui.bbar = bbar
  ui.driveBtn = button(bbar, "开车 / 开飞机", RGB(45, 95, 165), { Size = UDim2.fromOffset(170, 48), LayoutOrder = 1 }, function() open("drive") end)
  ui.viewBtn = button(bbar, "俯瞰战场", RGB(70, 80, 92), { Size = UDim2.fromOffset(140, 48), LayoutOrder = 2 }, function() G.toggleOverview() end)
  ui.rejoinBtn = button(bbar, "重返战场", RGB(60, 150, 80), { Size = UDim2.fromOffset(150, 48), LayoutOrder = 3, Visible = false }, function() RA:FireServer("rejoin") end)
  ui.exitBtn = button(bbar, "下车（F）", RGB(150, 70, 30), { Size = UDim2.fromOffset(140, 48), LayoutOrder = 4, Visible = false }, function() RA:FireServer("exit") end)

  -- 准星（开车、手机上拿枪时）、手机的开火键、弹药
  ui.cross = text(root, { AnchorPoint = V2(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(40, 40), Text = "+", Font = FONT, TextSize = 34,
    TextXAlignment = Enum.TextXAlignment.Center, TextStrokeTransparency = 0.3, Visible = false })
  ui.fireBtn = button(root, "开火", RGB(190, 50, 45), { AnchorPoint = V2(1, 1), Position = UDim2.new(1, -150, 1, -150), Size = UDim2.fromOffset(110, 110), TextSize = 24, Visible = false })
  round(ui.fireBtn, 55)
  ui.ammo = text(root, { AnchorPoint = V2(1, 1), Position = UDim2.new(1, -20, 1, -20), Size = UDim2.fromOffset(260, 30), Font = FONT, TextSize = 22,
    TextXAlignment = Enum.TextXAlignment.Right, TextStrokeTransparency = 0.4, Visible = false })
  ui.reloadBar = mk("Frame", { BackgroundColor3 = RGB(255, 214, 90), BorderSizePixel = 0, AnchorPoint = V2(1, 1), Position = UDim2.new(1, -20, 1, -14), Size = UDim2.fromOffset(0, 4), Visible = false }, root)

  -- 结果
  local result = panel(root, { AnchorPoint = V2(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.45), Size = UDim2.fromOffset(460, 280), Visible = false, ZIndex = 5 })
  ui.result = result
  ui.resTitle = text(result, { Position = UDim2.fromOffset(0, 18), Size = UDim2.new(1, 0, 0, 52), Font = FONT, TextSize = 44, TextXAlignment = Enum.TextXAlignment.Center, ZIndex = 5 })
  ui.resBody = text(result, { Position = UDim2.fromOffset(24, 80), Size = UDim2.new(1, -48, 0, 120), TextSize = 17, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Center, TextYAlignment = Enum.TextYAlignment.Top, ZIndex = 5 })
  button(result, "布阵再打", RGB(45, 95, 165), { AnchorPoint = V2(1, 1), Position = UDim2.new(0.5, -8, 1, -18), Size = UDim2.fromOffset(170, 48), ZIndex = 5 }, function()
    result.Visible = false
    RA:FireServer("home")
    G.setMode("deploy")
  end)
  button(result, "回基地", RGB(70, 80, 92), { AnchorPoint = V2(0, 1), Position = UDim2.new(0.5, 8, 1, -18), Size = UDim2.fromOffset(170, 48), ZIndex = 5 }, function()
    result.Visible = false
    RA:FireServer("home")
    G.setMode("free")
  end)

  -- 提示条
  local toastBox = mk("Frame", { BackgroundTransparency = 1, AnchorPoint = V2(0.5, 0), Position = UDim2.new(0.5, 0, 0, 144), Size = UDim2.fromOffset(600, 220) }, root)
  mk("UIListLayout", { HorizontalAlignment = Enum.HorizontalAlignment.Center, Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, toastBox)
  local KIND = { good = RGB(36, 118, 58), bad = RGB(140, 44, 40), info = RGB(28, 38, 54) }
  local toastN = 0
  function G.toast(msg, kind)
    toastN = toastN + 1
    local t = mk("TextLabel", {
      Text = tostring(msg), Font = FONT2, TextSize = 17, TextColor3 = RGB(255, 255, 255), TextWrapped = true,
      BackgroundColor3 = KIND[kind] or KIND.info, BackgroundTransparency = 0.12, BorderSizePixel = 0,
      Size = UDim2.fromOffset(580, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = toastN,
    }, toastBox)
    round(t, 8)
    mk("UIPadding", { PaddingTop = UDim.new(0, 8), PaddingBottom = UDim.new(0, 8), PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12) }, t)
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

  ---------------------------------------------------------------- 弹出的面板

  local function modal(name, title, w, h)
    local m = panel(root, { AnchorPoint = V2(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(w, h), Visible = false, ZIndex = 4 })
    text(m, { Position = UDim2.fromOffset(18, 10), Size = UDim2.new(1, -70, 0, 32), Font = FONT, TextSize = 22, Text = title, ZIndex = 4 })
    button(m, "×", RGB(80, 40, 40), { AnchorPoint = V2(1, 0), Position = UDim2.new(1, -10, 0, 10), Size = UDim2.fromOffset(36, 32), ZIndex = 4 }, function() m.Visible = false end)
    local body = mk("ScrollingFrame", { BackgroundTransparency = 1, BorderSizePixel = 0, Position = UDim2.fromOffset(14, 50), Size = UDim2.new(1, -28, 1, -62),
      CanvasSize = UDim2.fromOffset(0, 0), ScrollBarThickness = 5, ZIndex = 4 }, m)
    modals[name] = m
    return m, body
  end
  local function clear(body)
    for _, c in ipairs(body:GetChildren()) do
      if c:IsA("GuiObject") then c:Destroy() end
    end
  end
  local function line(body, y, h, props)
    return text(body, { Position = UDim2.fromOffset(0, y), Size = UDim2.new(1, -110, 0, h), TextWrapped = true, ZIndex = 4, TextSize = 15, TextYAlignment = Enum.TextYAlignment.Top, Text = props.Text or "", TextColor3 = props.TextColor3 or RGB(236, 240, 244) })
  end

  -- 任务
  local _, mBody = modal("missions", "每日任务", 520, 330)
  ui.fill.missions = function()
    clear(mBody)
    local S = G.S
    if not S then return end
    for i, m in ipairs(S.missions or {}) do
      local y = (i - 1) * 76
      line(mBody, y, 40, { Text = m.text })
      local p = math.min(m.prog, m.goal)
      local bg = mk("Frame", { BackgroundColor3 = RGB(40, 44, 50), BorderSizePixel = 0, Position = UDim2.fromOffset(0, y + 44), Size = UDim2.new(1, -120, 0, 10), ZIndex = 4 }, mBody)
      round(bg, 4)
      round(mk("Frame", { BackgroundColor3 = RGB(90, 200, 110), BorderSizePixel = 0, Size = UDim2.fromScale(p / m.goal, 1), ZIndex = 4 }, bg), 4)
      text(mBody, { Position = UDim2.new(1, -116, 0, y + 38), Size = UDim2.fromOffset(0, 20), Text = p .. " / " .. m.goal, ZIndex = 4, TextSize = 13 })
      local done = p >= m.goal
      button(mBody, m.claimed and "已领" or (done and ("领 $" .. Config.Fmt(S.missionReward or 0)) or "进行中"), m.claimed and RGB(60, 64, 70) or (done and RGB(60, 150, 80) or RGB(70, 74, 80)),
        { AnchorPoint = V2(1, 0), Position = UDim2.new(1, 0, 0, y + 6), Size = UDim2.fromOffset(104, 40), TextSize = 14, ZIndex = 4 }, function()
          if done and not m.claimed then RA:FireServer("mission", i) end
        end)
    end
    mBody.CanvasSize = UDim2.fromOffset(0, 3 * 76)
  end

  -- 武器
  local _, wBody = modal("weapons", "武器（买了永久有，复活自动带上）", 560, 380)
  ui.fill.weapons = function()
    clear(wBody)
    local S = G.S
    if not S then return end
    for i, id in ipairs(Config.WeaponOrder) do
      local w = Config.Weapons[id]
      local y = (i - 1) * 74
      local stat = "伤害 " .. w.dmg .. (w.splash and "（溅射）" or "") .. " · 每秒 " .. math.floor(1 / w.rate * 10 + 0.5) / 10 .. " 发 · 弹匣 " .. w.mag .. " · 射程 " .. w.range
      line(wBody, y, 24, { Text = w.name })
      line(wBody, y + 24, 40, { Text = stat, TextColor3 = RGB(170, 180, 192) })
      local own = S.weapons and S.weapons[id]
      button(wBody, own and "已拥有" or ("$" .. Config.Fmt(w.price)), own and RGB(60, 64, 70) or RGB(60, 150, 80),
        { AnchorPoint = V2(1, 0), Position = UDim2.new(1, 0, 0, y + 10), Size = UDim2.fromOffset(104, 40), TextSize = 14, ZIndex = 4 }, function()
          if not own then RA:FireServer("weapon", id) end
        end)
    end
    wBody.CanvasSize = UDim2.fromOffset(0, #Config.WeaponOrder * 74)
  end

  -- 排行榜
  local _, bBody = modal("board", "排行榜（全服）", 560, 420)
  G.board = { level = {}, rating = {} }
  ui.fill.board = function()
    clear(bBody)
    for c, key in ipairs({ "level", "rating" }) do
      local lines = { (key == "level") and "最高关卡" or "突袭积分" }
      for i, e in ipairs(G.board[key] or {}) do table.insert(lines, i .. ". " .. tostring(e.name) .. "   " .. Config.Fmt(e.value or 0)) end
      if #lines == 1 then table.insert(lines, "（读取中，或者存档服务不可用）") end
      text(bBody, { Position = UDim2.new((c - 1) * 0.5, 0, 0, 0), Size = UDim2.new(0.5, -8, 0, 340), Text = table.concat(lines, "\n"), TextSize = 15, TextWrapped = true,
        TextYAlignment = Enum.TextYAlignment.Top, ZIndex = 4 })
    end
  end
  function G.onBoard(data)
    if type(data) ~= "table" then return end
    G.board = data
    if modals.board.Visible then ui.fill.board() end
  end

  -- 约战：同服的玩家
  local _, dBody = modal("duel", "约战（同服的玩家）", 520, 380)
  ui.fill.duel = function()
    clear(dBody)
    local y = 0
    for _, p in ipairs(Players:GetPlayers()) do
      if p ~= player then
        local ls = p:FindFirstChild("leaderstats")
        local lv = ls and ls:FindFirstChild("关卡")
        local rk = ls and ls:FindFirstChild("军衔")
        line(dBody, y, 40, { Text = p.DisplayName .. "   " .. (rk and ("[" .. rk.Value .. "] ") or "") .. (lv and ("第 " .. lv.Value .. " 关") or "") })
        local uid = p.UserId
        button(dBody, "挑战", RGB(150, 60, 50), { AnchorPoint = V2(1, 0), Position = UDim2.new(1, 0, 0, y), Size = UDim2.fromOffset(104, 38), TextSize = 15, ZIndex = 4 }, function()
          RA:FireServer("duel", uid)
          modals.duel.Visible = false
        end)
        y = y + 50
      end
    end
    if y == 0 then line(dBody, 0, 60, { Text = "服务器里还没有别的玩家。叫朋友进同一个服务器，或者点「突袭」打别人存下的防线。" }) end
    dBody.CanvasSize = UDim2.fromOffset(0, y)
  end

  -- 重生
  local _, rBody = modal("rebirth", "重生", 520, 300)
  ui.fill.rebirth = function()
    clear(rBody)
    local S = G.S
    if not S then return end
    local n = (S.rebirth or 0) + 1
    line(rBody, 0, 150, { Text = "重生后：建筑、现金、关卡、部队、军工科技全部清零，从头再来。\n换来永久加成（第 " .. n .. " 次之后）：收入 +" ..
      math.floor(Config.Rebirth.income * 100 * n) .. "%，部队血量和伤害 +" .. math.floor(Config.Rebirth.power * 100 * n) .. "%。\n武器、经验、军衔、突袭积分都会保留。" })
    button(rBody, "确定重生", RGB(170, 120, 30), { Position = UDim2.fromOffset(0, 170), Size = UDim2.fromOffset(200, 48), ZIndex = 4 }, function()
      RA:FireServer("rebirth")
      modals.rebirth.Visible = false
    end)
  end

  -- 致谢
  local _, cBody = modal("credits", "致谢", 600, 360)
  text(cBody, { Size = UDim2.new(1, 0, 0, 300), Text = table.concat(CREDITS, "\n"), TextSize = 15, TextWrapped = true, TextYAlignment = Enum.TextYAlignment.Top, ZIndex = 4 })

  -- 开车：这一仗里自己还活着的车 / 直升机
  local _, vBody = modal("drive", "开哪一辆？（只能开自己的）", 480, 380)
  ui.fill.drive = function()
    clear(vBody)
    local y = 0
    for m in pairs(G.vis or {}) do
      local t = m:GetAttribute("Type")
      if m.Parent and m:GetAttribute("Owner") == player.UserId and m:GetAttribute("BU") and not m:GetAttribute("Dead") and UNITS[t] and not UNITS[t].foot then
        local uid = m:GetAttribute("Uid")
        line(vBody, y, 38, { Text = UNITS[t].name .. "  #" .. tostring(uid) })
        button(vBody, "开", RGB(45, 95, 165), { AnchorPoint = V2(1, 0), Position = UDim2.new(1, 0, 0, y), Size = UDim2.fromOffset(90, 36), TextSize = 15, ZIndex = 4 }, function()
          RA:FireServer("drive", uid)
          modals.drive.Visible = false
        end)
        y = y + 46
      end
    end
    if y == 0 then line(vBody, 0, 60, { Text = "这一仗里没有能开的车、飞机了（步兵不能开）。" }) end
    vBody.CanvasSize = UDim2.fromOffset(0, y)
  end
  ui.closeModals = closeModals

  -- 每日奖励（进服时弹出来）
  local daily = panel(root, { AnchorPoint = V2(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.42), Size = UDim2.fromOffset(420, 200), Visible = false, ZIndex = 6 })
  local dailyL = text(daily, { Position = UDim2.fromOffset(20, 16), Size = UDim2.new(1, -40, 0, 110), TextSize = 19, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Center, ZIndex = 6 })
  button(daily, "领取", RGB(60, 150, 80), { AnchorPoint = V2(0.5, 1), Position = UDim2.new(0.5, 0, 1, -16), Size = UDim2.fromOffset(180, 48), ZIndex = 6 }, function()
    RA:FireServer("daily")
    daily.Visible = false
  end)
  local dailyShown = false

  -- 约战邀请
  local invite = panel(root, { AnchorPoint = V2(0.5, 0), Position = UDim2.new(0.5, 0, 0, 200), Size = UDim2.fromOffset(460, 150), Visible = false, ZIndex = 6 })
  local invL = text(invite, { Position = UDim2.fromOffset(20, 12), Size = UDim2.new(1, -40, 0, 70), TextSize = 18, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Center, ZIndex = 6 })
  local invFrom = nil
  button(invite, "接受", RGB(60, 150, 80), { AnchorPoint = V2(1, 1), Position = UDim2.new(0.5, -8, 1, -14), Size = UDim2.fromOffset(150, 44), ZIndex = 6 }, function()
    invite.Visible = false
    if invFrom then RA:FireServer("duelYes", invFrom) end
  end)
  button(invite, "拒绝", RGB(120, 60, 52), { AnchorPoint = V2(0, 1), Position = UDim2.new(0.5, 8, 1, -14), Size = UDim2.fromOffset(150, 44), ZIndex = 6 }, function()
    invite.Visible = false
    if invFrom then RA:FireServer("duelNo", invFrom) end
  end)
  function G.onDuelInvite(ev)
    if type(ev) ~= "table" then return end
    invFrom = ev.from
    invL.Text = "[" .. tostring(ev.rank) .. "] " .. tostring(ev.name) .. "（第 " .. tostring(ev.level) .. " 关，" .. tostring(ev.n) .. " 个单位）向你发起约战！\n部队不会损失，赢了有奖励"
    invite.Visible = true
    local my = invFrom
    task.delay(ev.time or 20, function()
      if invFrom == my then invite.Visible = false end
    end)
  end

  ---------------------------------------------------------------- 刷新

  function G.refresh()
    local S = G.S
    if not S then return end
    cashL.Text = "$" .. Config.Fmt(S.cash)
    incL.Text = "+" .. Config.Fmt(S.income) .. " / 秒"
    lvL.Text = "第 " .. tostring(S.level) .. " 关" .. ((S.rebirth or 0) > 0 and ("   ★" .. S.rebirth) or "")
    armyL.Text = "部队 " .. tostring(S.n) .. " / " .. tostring(S.cap) .. "    战力 ×" .. string.format("%.1f", S.power or 1)
    local parts = {}
    if S.enemy and S.enemy.boss then table.insert(parts, "首领×" .. S.enemy.boss) end
    for _, t in ipairs(Config.UnitOrder) do
      local n = S.enemy and S.enemy[t]
      if n and n > 0 then table.insert(parts, UNITS[t].short .. "×" .. n) end
    end
    enemyL.Text = (#parts > 0) and ("敌军：" .. table.concat(parts, "  ")) or "敌军：侦察中…"
    rewardL.Text = "胜利奖励 $" .. Config.Fmt(S.reward or 0)
    rankL.Text = "军衔：" .. tostring(S.rank) .. (S.nextXp and ("   " .. Config.Fmt(S.xp) .. " / " .. Config.Fmt(S.nextXp)) or "（最高）")
    xpFill.Size = UDim2.fromScale(S.nextXp and math.clamp(S.xp / S.nextXp, 0, 1) or 1, 1)
    ratingL.Text = "突袭积分 " .. tostring(S.rating) .. "   亲手击毁 " .. tostring(S.kills)
    for _, t in ipairs(Config.UnitOrder) do
      local r = rows[t]
      local def = UNITS[t]
      local src = Config.BuildingById[Config.UnitSource[t]]
      local have = (S.counts and S.counts[t]) or 0
      r.name.Text = def.name .. ((have > 0) and ("  ×" .. have) or "")
      if not (S.owned and S.owned[src.id]) then
        r.btn.Text = "需" .. src.name
        r.btn.TextSize = 12
        r.btn.BackgroundColor3 = RGB(70, 74, 80)
      elseif def.needHQ and (S.hq or 0) < def.needHQ then
        r.btn.Text = "需指挥部" .. def.needHQ .. "级"
        r.btn.TextSize = 12
        r.btn.BackgroundColor3 = RGB(70, 74, 80)
      else
        local ok = S.cash >= def.price and S.n < S.cap and not S.battle
        r.btn.Text = "$" .. Config.Fmt(def.price)
        r.btn.TextSize = 15
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
    local claimable = false
    for _, m in ipairs(S.missions or {}) do
      if m.prog >= m.goal and not m.claimed then claimable = true end
    end
    btnMission.Text = claimable and "任务 ●" or "任务"
    btnMission.BackgroundColor3 = claimable and RGB(60, 150, 80) or RGB(52, 84, 120)
    btnRebirth.Visible = S.canRebirth == true
    btnDuel.Visible = #Players:GetPlayers() > 1
    ui.raidBtn.Text = (S.raidCD or 0) > 0 and ("突袭 " .. S.raidCD .. "s") or "突袭"
    if S.daily and S.daily.ok and not dailyShown then
      dailyShown = true
      dailyL.Text = "每日奖励\n连续登录第 " .. tostring(S.daily.streak) .. " 天：$" .. Config.Fmt(S.daily.amount) .. "\n（连续登录越多越多，最多叠 7 天）"
      daily.Visible = true
    end
    for name, m in pairs(modals) do
      if m.Visible and name ~= "drive" and name ~= "credits" and ui.fill[name] and name ~= "duel" then ui.fill[name]() end
    end
    G.updateButtons()
  end

  function G.updateButtons()
    local S = G.S
    local mode = G.mode
    local fighting = S ~= nil and S.battle == true
    ui.deployBtn.Text = (mode == "deploy") and "回基地" or "布阵"
    ui.deployBtn.Visible = not fighting
    ui.fightBtn.Visible = not fighting
    ui.raidBtn.Visible = not fighting and mode ~= "deploy"
    ui.arrangeBtn.Visible = mode == "deploy" and not fighting
    ui.sellBtn.Visible = mode == "deploy" and G.sel ~= nil and not fighting
    ui.hqBtn.Visible = mode == "free" and not fighting and S ~= nil and S.hqNext ~= nil
    if S ~= nil and S.hqNext ~= nil then ui.hqBtn.Text = "升级指挥部 $" .. Config.Fmt(S.hqNext) end
    shop.Visible = not fighting and mode ~= "drive"
    menu.Visible = not fighting
    info.Visible = mode ~= "drive"
    ui.hint.Visible = mode == "deploy"
    bpanel.Visible = fighting
    bbar.Visible = fighting
    ui.driveBtn.Visible = fighting and G.drive == nil
    ui.exitBtn.Visible = G.drive ~= nil
    ui.viewBtn.Text = (mode == "battle") and "跟随自己" or "俯瞰战场"
  end
end

return UI
