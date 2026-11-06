-- 军事大亨（客户端）：界面——钱、关卡、兵工厂、按钮、提示；任务、武器、排行榜、真人对战（排位匹配、同服约战）、重生、致谢；
-- 每日奖励、约战邀请、匹配中的状态条；战斗中的面板、支援技能栏、战报滚动条、命中标记、大字播报、结果（评星）；
-- 新手目标（左上角 + 指着下一个按钮的箭头）、低血量红边、出错红条
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
  -- 手机（触屏、屏幕窄边不到 600）：界面放大一些，换一套紧凑排版（ui.layout）；平板照电脑的排
  local function isCompact()
    local vs = cam.ViewportSize
    return mobile and math.min(vs.X, vs.Y) < 600
  end
  G.compact = isCompact()
  -- Roblox 自带的玩家列表在右上角，会盖住兵工厂和战报；同服务器的玩家在「真人对战」里能看到
  pcall(function() game:GetService("StarterGui"):SetCoreGuiEnabled(Enum.CoreGuiType.PlayerList, false) end)
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
    if onClick then
      b.Activated:Connect(function(...)
        if G.playSound then G.playSound("click") end
        onClick(...)
      end)
    end
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
    G.compact = isCompact()
    local s
    if G.compact then
      s = math.clamp(vs.Y / 470, 0.62, 0.92)   -- 手机横屏 390 高：约 0.83，画布约 900 × 390
    else
      s = math.clamp(math.min(vs.X / 1280, vs.Y / 720) * 1.08, 0.5, 1.3)
    end
    uiScale.Scale = s
    root.Size = UDim2.fromScale(1 / s, 1 / s)
    if ui.layout then ui.layout() end
  end
  rescale()
  cam:GetPropertyChangedSignal("ViewportSize"):Connect(rescale)
  ui.root = root

  ---------------------------------------------------------------- 常驻面板

  local top = panel(root, { AnchorPoint = V2(0.5, 0), Position = UDim2.new(0.5, 0, 0, 8), Size = UDim2.fromOffset(420, 56) })
  local cashL = text(top, { Position = UDim2.fromOffset(18, 0), Size = UDim2.new(0.6, -18, 1, 0), Font = FONT, TextSize = 30, TextColor3 = RGB(255, 214, 90), Text = "$0" })
  local incL = text(top, { Position = UDim2.new(0.6, 0, 0, 0), Size = UDim2.new(0.4, -16, 1, 0), TextSize = 18, TextColor3 = RGB(130, 235, 140), TextXAlignment = Enum.TextXAlignment.Right, Text = "+0 / 秒" })

  -- 匹配中 / 传送中 / 对战服务器 的状态条（钱的下面）
  local mbar = panel(root, { AnchorPoint = V2(0.5, 0), Position = UDim2.new(0.5, 0, 0, 70), Size = UDim2.fromOffset(460, 40), Visible = false, ZIndex = 3 })
  local mbarL = text(mbar, { Position = UDim2.fromOffset(14, 0), Size = UDim2.new(1, -120, 1, 0), TextSize = 15, Font = FONT, TextColor3 = RGB(255, 220, 140), ZIndex = 3 })
  local mbarBtn = button(mbar, "取消", RGB(120, 60, 52), { AnchorPoint = V2(1, 0.5), Position = UDim2.new(1, -8, 0.5, 0), Size = UDim2.fromOffset(90, 30), TextSize = 14, ZIndex = 3 },
    function() RA:FireServer("matchCancel") end)

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
  local menuList = mk("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, menu)
  local menuGrid = mk("UIGridLayout", { CellSize = UDim2.fromOffset(76, 34), CellPadding = UDim2.fromOffset(6, 6), SortOrder = Enum.SortOrder.LayoutOrder, FillDirection = Enum.FillDirection.Horizontal })
  local modals = {}
  local modalSize = {}
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
  local btnBuild = button(menu, "建筑", RGB(64, 112, 70), { Size = UDim2.fromOffset(140, 40), LayoutOrder = 2, TextSize = 16 }, function() open("build") end)
  local btnWeapon = button(menu, "武器", RGB(60, 74, 60), { Size = UDim2.fromOffset(140, 40), LayoutOrder = 3, TextSize = 16 }, function() open("weapons") end)
  local btnBoard = button(menu, "排行榜", RGB(84, 70, 40), { Size = UDim2.fromOffset(140, 40), LayoutOrder = 4, TextSize = 16 }, function() open("board") end)
  local btnDuel = button(menu, "真人对战", RGB(150, 50, 46), { Size = UDim2.fromOffset(140, 40), LayoutOrder = 5, TextSize = 16 }, function() open("duel") end)
  local btnRebirth = button(menu, "重生", RGB(150, 110, 30), { Size = UDim2.fromOffset(140, 40), LayoutOrder = 6, TextSize = 16, Visible = false }, function() open("rebirth") end)
  local btnCredits = button(menu, "致谢", RGB(54, 58, 66), { Size = UDim2.fromOffset(140, 34), LayoutOrder = 7, TextSize = 14 }, function() open("credits") end)
  local menuBtns = { btnMission, btnBuild, btnWeapon, btnBoard, btnDuel, btnRebirth, btnCredits }

  -- 右边：兵工厂（按页签分类：步兵 / 装甲 / 防空 / 炮兵 / 空中，可以滚动；最下面一行是军工科技）
  local ROWH = 62
  local shop = panel(root, { AnchorPoint = V2(1, 0), Position = UDim2.new(1, -10, 0, 72), Size = UDim2.new(0, 330, 1, -212) })
  local shopTitle = text(shop, { Position = UDim2.fromOffset(14, 6), Size = UDim2.new(1, -28, 0, 28), Font = FONT, TextSize = 20, Text = "兵工厂" })
  -- 手机上兵工厂占的地方大：能收起，收起后右上角一个按钮再打开；布阵时自动收起
  local shopOpen = true
  local shopClose = button(shop, "收起", RGB(60, 66, 76), { AnchorPoint = V2(1, 0), Position = UDim2.new(1, -8, 0, 5), Size = UDim2.fromOffset(60, 24), TextSize = 13, Visible = false }, function()
    shopOpen = false
    G.updateButtons()
  end)
  local shopToggle = button(root, "打开兵工厂", RGB(45, 95, 165), { AnchorPoint = V2(1, 0), Position = UDim2.new(1, -6, 0, 4), Size = UDim2.fromOffset(124, 40), TextSize = 15, Visible = false }, function()
    shopOpen = true
    G.updateButtons()
  end)
  local tabBar = mk("Frame", { BackgroundTransparency = 1, Position = UDim2.fromOffset(10, 38), Size = UDim2.new(1, -20, 0, 30) }, shop)
  mk("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, tabBar)
  local list = mk("ScrollingFrame", { BackgroundTransparency = 1, BorderSizePixel = 0, Position = UDim2.fromOffset(6, 74), Size = UDim2.new(1, -12, 1, -80),
    CanvasSize = UDim2.fromOffset(0, 0), ScrollBarThickness = 5 }, shop)
  local rows = {}
  local rowParts = {}   -- 每一行（含科技行）的框、名字、说明、按钮：排版时一起改大小
  local function row(color)
    local r = mk("Frame", { BackgroundColor3 = color or RGB(255, 255, 255), BackgroundTransparency = color and 0.9 or 0.94, BorderSizePixel = 0, Size = UDim2.new(1, -10, 0, ROWH - 6) }, list)
    round(r, 8)
    local n = text(r, { Position = UDim2.fromOffset(10, 4), Size = UDim2.new(1, -112, 0, 22), Font = FONT, TextSize = 16 })
    local d = text(r, { Position = UDim2.fromOffset(10, 26), Size = UDim2.new(1, -112, 0, 28), TextSize = 11, TextWrapped = true, TextScaled = true, TextYAlignment = Enum.TextYAlignment.Top, TextColor3 = RGB(170, 180, 192) })
    local dc = mk("UITextSizeConstraint", { MaxTextSize = 11, MinTextSize = 8 }, d)   -- 说明长的自动缩小，两行放得下
    table.insert(rowParts, { r = r, n = n, d = d, dc = dc })
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
    rowParts[#rowParts].b = b
  end
  local techRow, techName, techDesc = row(RGB(255, 214, 90))
  local techBtn = button(techRow, "", RGB(150, 120, 40), { AnchorPoint = V2(1, 0.5), Position = UDim2.new(1, -8, 0.5, 0), Size = UDim2.fromOffset(94, 40), TextSize = 15 },
    function() RA:FireServer("tech") end)
  rowParts[#rowParts].b = techBtn
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
  -- 走到军工建筑旁按 E：打开兵工厂、翻到这个建筑的页签
  G.shopTab = function(id)
    showTab(id)
    if not shopOpen then
      shopOpen = true
      G.updateButtons()
    end
  end
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
  ui.exitBtn = button(bbar, mobile and "下车" or "下车（F）", RGB(150, 70, 30), { Size = UDim2.fromOffset(140, 48), LayoutOrder = 4, Visible = false }, function() RA:FireServer("exit") end)

  -- 准星（开车、手机上拿枪时）、手机的开火键、弹药
  ui.cross = text(root, { AnchorPoint = V2(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(40, 40), Text = "+", Font = FONT, TextSize = 34,
    TextXAlignment = Enum.TextXAlignment.Center, TextStrokeTransparency = 0.3, Visible = false })
  ui.fireBtn = button(root, "开火", RGB(190, 50, 45), { AnchorPoint = V2(1, 1), Position = UDim2.new(1, -150, 1, -150), Size = UDim2.fromOffset(110, 110), TextSize = 24, Visible = false })
  round(ui.fireBtn, 55)
  -- 手机开直升机、飞机时没有空格 / C：按住这两个键升降（运输直升机降到最低才放兵）
  ui.upBtn = button(root, "升高 ▲", RGB(45, 95, 165), { AnchorPoint = V2(1, 1), Position = UDim2.new(1, -272, 1, -205), Size = UDim2.fromOffset(96, 50), TextSize = 17, Visible = false })
  ui.downBtn = button(root, "降低 ▼", RGB(45, 95, 165), { AnchorPoint = V2(1, 1), Position = UDim2.new(1, -272, 1, -150), Size = UDim2.fromOffset(96, 50), TextSize = 17, Visible = false })
  ui.ammo = text(root, { AnchorPoint = V2(1, 1), Position = UDim2.new(1, -20, 1, -20), Size = UDim2.fromOffset(260, 30), Font = FONT, TextSize = 22,
    TextXAlignment = Enum.TextXAlignment.Right, TextStrokeTransparency = 0.4, Visible = false })
  ui.reloadBar = mk("Frame", { BackgroundColor3 = RGB(255, 214, 90), BorderSizePixel = 0, AnchorPoint = V2(1, 1), Position = UDim2.new(1, -20, 1, -14), Size = UDim2.fromOffset(0, 4), Visible = false }, root)

  -- 结果
  local result = panel(root, { AnchorPoint = V2(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.45), Size = UDim2.fromOffset(480, 310), Visible = false, ZIndex = 5 })
  ui.result = result
  ui.resTitle = text(result, { Position = UDim2.fromOffset(0, 12), Size = UDim2.new(1, 0, 0, 50), Font = FONT, TextSize = 44, TextXAlignment = Enum.TextXAlignment.Center, ZIndex = 5 })
  ui.resStars = text(result, { Position = UDim2.fromOffset(0, 60), Size = UDim2.new(1, 0, 0, 34), Font = FONT, TextSize = 32, TextXAlignment = Enum.TextXAlignment.Center, TextColor3 = RGB(255, 210, 70), ZIndex = 5 })
  ui.resBody = text(result, { Position = UDim2.fromOffset(24, 98), Size = UDim2.new(1, -48, 0, 130), TextSize = 17, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Center, TextYAlignment = Enum.TextYAlignment.Top, ZIndex = 5 })
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
    modalSize[name] = { w, h }
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
      text(mBody, { Position = UDim2.new(1, -116, 0, y + 38), Size = UDim2.fromOffset(110, 20), Text = p .. " / " .. m.goal, ZIndex = 4, TextSize = 13 })
      local done = p >= m.goal
      button(mBody, m.claimed and "已领" or (done and ("领 $" .. Config.Fmt(S.missionReward or 0)) or "进行中"), m.claimed and RGB(60, 64, 70) or (done and RGB(60, 150, 80) or RGB(70, 74, 80)),
        { AnchorPoint = V2(1, 0), Position = UDim2.new(1, 0, 0, y + 6), Size = UDim2.fromOffset(104, 40), TextSize = 14, ZIndex = 4 }, function()
          if done and not m.claimed then RA:FireServer("mission", i) end
        end)
    end
    mBody.CanvasSize = UDim2.fromOffset(0, 3 * 76)
  end

  -- 建筑升级：盖了的、有收入的楼一栋一行（级数、现在每秒挣多少、升级后多少、升级价）；数据没变就不重画
  local _, uBody = modal("build", "建筑升级（走到楼旁边按住 E 也能升）", 600, 420)
  local upSig = nil
  ui.fill.build = function()
    local S = G.S
    if not S then return end
    local MAX = Config.Upgrade.max
    local sig = {}
    for _, b in ipairs(Config.Buildings) do
      if b.income and S.owned and S.owned[b.id] then
        local lv = (S.lv and S.lv[b.id]) or 1
        table.insert(sig, b.id .. lv .. ((lv < MAX and S.cash >= Config.UpgradeCost(b, lv)) and "+" or "-"))
      end
    end
    sig = table.concat(sig, ",") .. "|" .. tostring(S.rebirth) .. tostring(S.owned and S.owned.power) .. tostring(S.owned and S.owned.refinery) .. tostring(S.owned and S.owned.nuclear)
    if sig == upSig and #uBody:GetChildren() > 0 then return end
    upSig = sig
    clear(uBody)
    local mul = 1 + Config.Rebirth.income * (S.rebirth or 0)
    local y = 0
    for _, b in ipairs(Config.Buildings) do
      if b.income and S.owned and S.owned[b.id] then
        local lv = (S.lv and S.lv[b.id]) or 1
        local now = Config.BuildingIncome(b, S.owned, lv) * mul
        line(uBody, y, 24, { Text = b.name .. "   Lv." .. lv .. "  " .. string.rep("★", lv) .. string.rep("☆", MAX - lv), TextColor3 = RGB(255, 222, 130) })
        local nextTxt = (lv < MAX) and ("   →   升级后 +" .. Config.Fmt(Config.BuildingIncome(b, S.owned, lv + 1) * mul) .. "/秒") or "   （满级）"
        line(uBody, y + 24, 20, { Text = "现在 +" .. Config.Fmt(now) .. "/秒" .. nextTxt, TextColor3 = RGB(170, 205, 175) })
        local id = b.id
        if lv < MAX then
          local cost = Config.UpgradeCost(b, lv)
          button(uBody, "升级 $" .. Config.Fmt(cost), (S.cash >= cost) and RGB(60, 150, 80) or RGB(96, 72, 62),
            { AnchorPoint = V2(1, 0), Position = UDim2.new(1, -4, 0, y + 4), Size = UDim2.fromOffset(104, 38), TextSize = 13, ZIndex = 4 }, function()
              RA:FireServer("upgrade", id)
            end)
        else
          button(uBody, "满级", RGB(70, 74, 80), { AnchorPoint = V2(1, 0), Position = UDim2.new(1, -4, 0, y + 4), Size = UDim2.fromOffset(104, 38), TextSize = 14, ZIndex = 4, AutoButtonColor = false })
        end
        y = y + 52
      end
    end
    if y == 0 then
      line(uBody, 0, 60, { Text = "还没有能升级的楼：先盖居民楼、工厂、油井……盖好以后在这里一级一级升（每级收入多一半，5 级是 3 倍）" })
      y = 60
    end
    uBody.CanvasSize = UDim2.fromOffset(0, y)
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
  local _, bBody = modal("board", "排行榜（全服）", 680, 420)
  G.board = { level = {}, rating = {}, pvp = {} }
  local BOARDS = { { "level", "最高关卡" }, { "rating", "突袭积分" }, { "pvp", "对战积分" } }
  ui.fill.board = function()
    clear(bBody)
    for c, e0 in ipairs(BOARDS) do
      local lines = { e0[2] }
      for i, e in ipairs(G.board[e0[1]] or {}) do table.insert(lines, i .. ". " .. tostring(e.name) .. "   " .. Config.Fmt(e.value or 0)) end
      if #lines == 1 then table.insert(lines, "（读取中，或者存档服务不可用）") end
      text(bBody, { Position = UDim2.new((c - 1) / 3, 0, 0, 0), Size = UDim2.new(1 / 3, -8, 0, 340), Text = table.concat(lines, "\n"), TextSize = 14, TextWrapped = true,
        TextYAlignment = Enum.TextYAlignment.Top, ZIndex = 4 })
    end
  end
  function G.onBoard(data)
    if type(data) ~= "table" then return end
    G.board = data
    if modals.board.Visible then ui.fill.board() end
  end

  -- 真人对战：排位匹配（服内 / 跨服）+ 同服点名约战（友谊赛）
  local _, dBody = modal("duel", "真人对战", 540, 460)
  ui.fill.duel = function()
    clear(dBody)
    local S = G.S
    if not S then return end
    local games = S.pvpGames or 0
    line(dBody, 0, 24, { Text = "对战积分 " .. tostring(S.pvp or Config.Match.start) .. "    排位战绩 " .. tostring(S.pvpWins or 0) .. " 胜 / " .. games .. " 场", TextColor3 = RGB(255, 216, 106) })
    line(dBody, 28, 66, { Text = "排位赛：先找同一个服务器里也在匹配的玩家，没有就在全服找对战积分差不多的；找到后两个人一起传送到对战服务器，打完自动送回来。部队不会损失，赢了涨积分、拿奖金。",
      TextColor3 = RGB(170, 180, 192) })
    local queued = S.match ~= nil
    button(dBody, queued and "取消匹配" or "开始匹配（排位）", queued and RGB(120, 60, 52) or RGB(190, 60, 50), { Position = UDim2.fromOffset(0, 100), Size = UDim2.fromOffset(240, 46), TextSize = 17, ZIndex = 4 },
      function()
        RA:FireServer(queued and "matchCancel" or "match")
        modals.duel.Visible = false
      end)
    line(dBody, 160, 24, { Text = "同服务器的玩家（点名约战，友谊赛不算积分）：", TextColor3 = RGB(200, 210, 220) })
    local y = 190
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
    if y == 190 then
      line(dBody, y, 40, { Text = "服务器里还没有别的玩家（排位匹配会去全服找）。", TextColor3 = RGB(150, 160, 170) })
      y = y + 40
    end
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

  ---------------------------------------------------------------- 新手目标：左上角一行字 + 基地里指着下一个按钮的箭头

  -- 宽度让开正中间的现金条（窄屏上现金条左边大约在 380 处）
  local goal = panel(root, { Position = UDim2.fromOffset(10, 6), Size = UDim2.fromOffset(360, 60) })
  local goalT = text(goal, { Position = UDim2.fromOffset(12, 3), Size = UDim2.new(1, -24, 0, 16), TextSize = 13, Font = FONT, TextColor3 = RGB(255, 214, 90), Text = "当前目标" })
  local goalL = text(goal, { Position = UDim2.fromOffset(12, 20), Size = UDim2.new(1, -24, 0, 38), TextSize = 14, TextWrapped = true, TextScaled = true, TextYAlignment = Enum.TextYAlignment.Top })
  mk("UITextSizeConstraint", { MaxTextSize = 14, MinTextSize = 9 }, goalL)
  local arrow = mk("BillboardGui", { Name = "GoalArrow", Size = UDim2.fromOffset(140, 90), AlwaysOnTop = true, LightInfluence = 0, MaxDistance = 600, Enabled = false, ResetOnSpawn = false })
  arrow.Parent = player:WaitForChild("PlayerGui")
  local arrowT = text(arrow, { Size = UDim2.new(1, 0, 0, 30), Font = FONT, TextSize = 18, TextXAlignment = Enum.TextXAlignment.Center, TextColor3 = RGB(140, 255, 160), TextStrokeTransparency = 0.2, Text = "下一步" })
  text(arrow, { Position = UDim2.fromOffset(0, 26), Size = UDim2.new(1, 0, 0, 60), Font = FONT, TextSize = 52, TextXAlignment = Enum.TextXAlignment.Center, TextColor3 = RGB(140, 255, 160), TextStrokeTransparency = 0.2, Text = "▼" })
  local goalPad = nil
  -- 现在该干什么：没盖第一栋楼 → 没兵营 → 没兵 → 没打过仗 → 没指挥部 → 之后提示下一栋楼 / 下一关
  local function objective(S)
    local o = S.owned or {}
    local B = Config.BuildingById
    if not o.house1 then return "踩亮绿色的圆按钮，盖第一栋「居民楼 A」（$" .. B.house1.price .. "）：楼会一直给你赚钱", "house1" end
    if not o.barracks then return "攒到 $" .. B.barracks.price .. " 盖「兵营」：有兵营才能造兵（现在 $" .. Config.Fmt(S.cash) .. "）", "barracks" end
    if (S.n or 0) == 0 then return "在右边「兵工厂」造 2～3 个步兵班（$" .. Config.Units.inf.price .. " 一个）", nil end
    if (S.wins or 0) == 0 and (S.level or 1) <= 1 then return "点下面的「开战！」打第 1 关——你本人也会上战场，打仗时下面有支援技能", nil end
    if not o.hq then return "盖「指挥部」：部队上限 4 → 10，还多一个「战地急救」技能", "hq" end
    local best = nil
    for _, b in ipairs(Config.Buildings) do
      if not o[b.id] and (not b.req or o[b.req]) and (not best or b.price < best.price) then best = b end
    end
    if best and S.cash >= best.price * 0.6 then
      return "下一栋：「" .. best.name .. "」$" .. Config.Fmt(best.price) .. "（现在 $" .. Config.Fmt(S.cash) .. "）", best.id
    end
    -- 钱够升级一栋楼了：提示去升级（最便宜的那个）
    local up, upCost = nil, nil
    for _, b in ipairs(Config.Buildings) do
      local lv = (S.lv and S.lv[b.id]) or 1
      if b.income and o[b.id] and lv < Config.Upgrade.max then
        local c = Config.UpgradeCost(b, lv)
        if not upCost or c < upCost then up, upCost = b, c end
      end
    end
    if up and S.cash >= upCost and (not best or S.cash < best.price * 0.6) then
      return "升级「" .. up.name .. "」到 Lv." .. (((S.lv and S.lv[up.id]) or 1) + 1) .. "：$" .. Config.Fmt(upCost) .. "（左边「建筑」，或走到楼旁边按住 E）", nil
    end
    local tip = "打第 " .. tostring(S.level) .. " 关拿 $" .. Config.Fmt(S.reward or 0)
    if (S.vets or 0) > 0 then tip = tip .. "；活下来的部队会升星变强" end
    if best then tip = tip .. "；攒钱盖「" .. best.name .. "」$" .. Config.Fmt(best.price) end
    return tip, nil
  end
  local function padPart(id)
    local S = G.S
    local plots = workspace:FindFirstChild("Plots")
    local p = S and plots and plots:FindFirstChild("Plot" .. tostring(S.plot))
    local m = p and p:FindFirstChild("Pads") and p.Pads:FindFirstChild("Pad_" .. id)
    return m and m:FindFirstChild("Pad")
  end
  local function updateGoal()
    local S = G.S
    if not S then return end
    local txt, padId = objective(S)
    goalL.Text = txt
    goalPad = padId and padPart(padId) or nil
    if padId then arrowT.Text = "下一步：" .. Config.BuildingById[padId].name end
  end
  ui.goal = goal
  function G.goalPadPart() return goalPad end
  local bob = 0
  function G.stepUI(dt)
    bob = bob + dt * 4
    local show = goalPad ~= nil and goalPad.Parent ~= nil and G.mode == "free" and not G.battle
    arrow.Enabled = show
    if show then
      arrow.Adornee = goalPad
      arrow.StudsOffsetWorldSpace = Vector3.new(0, 9 + math.sin(bob) * 1.2, 0)
    end
    if G.stepSkills then G.stepSkills() end
    if G.stepVignette then G.stepVignette(dt) end
  end

  ---------------------------------------------------------------- 打仗时：支援技能栏（点一下，再点战场上的位置；电脑上按 Z X V B N）

  local sbar = mk("Frame", { BackgroundTransparency = 1, AnchorPoint = V2(0.5, 1), Position = UDim2.new(0.5, 0, 1, -138), Size = UDim2.fromOffset(700, 64), Visible = false }, root)
  local sbarList = mk("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Center, Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }, sbar)
  ui.sbar = sbar
  G.skillReady = {}   -- [id] = 什么时候冷却好（os.clock）
  local sbtn = {}
  for i, sk in ipairs(Config.Skills) do
    local b = button(sbar, "", RGB(40, 64, 96), { Size = UDim2.fromOffset(128, 60), LayoutOrder = i, Visible = false, TextSize = 14 }, function()
      if G.toggleAim then G.toggleAim(sk.id) end
    end)
    local nm = text(b, { Position = UDim2.fromOffset(6, 4), Size = UDim2.new(1, -12, 0, 20), Font = FONT, TextSize = 15, TextXAlignment = Enum.TextXAlignment.Center, Text = sk.name })
    local sub = text(b, { Position = UDim2.fromOffset(6, 26), Size = UDim2.new(1, -12, 0, 16), TextSize = 12, TextXAlignment = Enum.TextXAlignment.Center, TextColor3 = RGB(190, 205, 220),
      Text = (mobile and "" or ("[" .. sk.key .. "]  ")) .. "冷却 " .. sk.cd .. " 秒" })
    local cdF = mk("Frame", { BackgroundColor3 = RGB(0, 0, 0), BackgroundTransparency = 0.45, BorderSizePixel = 0, AnchorPoint = V2(0, 1), Position = UDim2.fromScale(0, 1), Size = UDim2.fromScale(1, 0), ZIndex = 2 }, b)
    round(cdF, 8)
    local cdT = text(b, { Position = UDim2.fromOffset(0, 40), Size = UDim2.new(1, 0, 0, 18), Font = FONT, TextSize = 14, TextXAlignment = Enum.TextXAlignment.Center, TextColor3 = RGB(255, 214, 90), ZIndex = 3 })
    sbtn[sk.id] = { b = b, cd = cdF, cdT = cdT, sk = sk, nm = nm, sub = sub }
  end
  -- 有哪些技能跟着状态走（盖了对应的楼才有）
  local function refreshSkills(S)
    local have = {}
    for _, e in ipairs(S.skills or {}) do
      have[e.id] = true
      if G.skillReady[e.id] == nil then G.skillReady[e.id] = os.clock() + (e.left or 0) end
    end
    for id, e in pairs(sbtn) do
      e.b.Visible = have[id] == true
      e.sub.Text = (mobile and "" or ("[" .. e.sk.key .. "]  ")) .. "冷却 " .. math.floor(Config.SkillCD(e.sk, S.owned) + 0.5) .. " 秒"
    end
    G.skillHave = have
  end
  function G.stepSkills()
    if not sbar.Visible then return end
    local now = os.clock()
    for id, e in pairs(sbtn) do
      if e.b.Visible then
        local left = (G.skillReady[id] or 0) - now
        if left > 0 then
          e.cd.Size = UDim2.fromScale(1, math.clamp(left / e.sk.cd, 0, 1))
          e.cdT.Text = string.format("%d", math.ceil(left))
        else
          e.cd.Size = UDim2.fromScale(1, 0)
          e.cdT.Text = (G.aim == id) and "点战场放下" or "就绪"
        end
        e.b.BackgroundColor3 = (G.aim == id) and RGB(190, 140, 40) or ((left > 0) and RGB(34, 42, 54) or RGB(40, 92, 140))
      end
    end
  end

  ---------------------------------------------------------------- 打仗时：战报滚动条（右上）、命中标记、大字播报、低血量红边

  local feed = mk("Frame", { BackgroundTransparency = 1, AnchorPoint = V2(1, 0), Position = UDim2.new(1, -10, 0, 150), Size = UDim2.fromOffset(330, 240), Visible = false }, root)
  local feedList = mk("UIListLayout", { HorizontalAlignment = Enum.HorizontalAlignment.Right, Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, feed)
  ui.feed = feed
  local feedN = 0
  function G.feedLine(msg, color)
    feedN = feedN + 1
    local t = mk("TextLabel", { Text = msg, Font = FONT2, TextSize = 15, TextColor3 = color or RGB(240, 240, 240), RichText = true, BackgroundColor3 = RGB(10, 14, 20),
      BackgroundTransparency = 0.35, BorderSizePixel = 0, Size = UDim2.fromOffset(0, 24), AutomaticSize = Enum.AutomaticSize.X, LayoutOrder = feedN, TextXAlignment = Enum.TextXAlignment.Right }, feed)
    round(t, 6)
    mk("UIPadding", { PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8) }, t)
    local kids = {}
    for _, c in ipairs(feed:GetChildren()) do
      if c:IsA("TextLabel") then table.insert(kids, c) end
    end
    table.sort(kids, function(a, b) return a.LayoutOrder < b.LayoutOrder end)
    for i = 1, #kids - 7 do kids[i]:Destroy() end
    task.delay(6, function()
      if t.Parent then
        TweenService:Create(t, TweenInfo.new(0.5), { BackgroundTransparency = 1, TextTransparency = 1 }):Play()
        task.wait(0.55)
        t:Destroy()
      end
    end)
  end

  -- 命中标记：准星（鼠标）位置一个小叉，打死变红、大一点
  local hm = mk("Frame", { BackgroundTransparency = 1, AnchorPoint = V2(0.5, 0.5), Size = UDim2.fromOffset(34, 34), Visible = false, ZIndex = 8 }, gui)
  local hmBars = {}
  for i, a in ipairs({ 45, -45, 135, -135 }) do
    local r = math.rad(a)
    hmBars[i] = mk("Frame", { BackgroundColor3 = RGB(255, 255, 255), BorderSizePixel = 0, AnchorPoint = V2(0.5, 0.5), Size = UDim2.fromOffset(11, 3), Rotation = a,
      Position = UDim2.new(0.5, math.cos(r) * 10, 0.5, -math.sin(r) * 10), ZIndex = 8 }, hm)
  end
  local hmT = 0
  function G.hitMarker(kill)
    local GuiService = game:GetService("GuiService")
    local mp = (G.mobile or G.drive) and (cam.ViewportSize / 2) or UIS:GetMouseLocation()
    local inset = GuiService:GetGuiInset()
    hm.Position = UDim2.fromOffset(mp.X, mp.Y - inset.Y)
    hm.Size = kill and UDim2.fromOffset(44, 44) or UDim2.fromOffset(32, 32)
    for _, b in ipairs(hmBars) do b.BackgroundColor3 = kill and RGB(255, 70, 60) or RGB(255, 255, 255) end
    hm.Visible = true
    hmT = os.clock()
    task.delay(kill and 0.35 or 0.16, function()
      if os.clock() - hmT >= (kill and 0.34 or 0.15) then hm.Visible = false end
    end)
  end

  -- 大字播报（首领来袭、连杀、胜利）
  local ann = text(root, { AnchorPoint = V2(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.3), Size = UDim2.fromOffset(900, 70), Font = FONT, TextSize = 46,
    TextXAlignment = Enum.TextXAlignment.Center, TextStrokeTransparency = 0.25, Visible = false, ZIndex = 7 })
  local annSub = text(ann, { Position = UDim2.new(0, 0, 1, 0), Size = UDim2.new(1, 0, 0, 26), TextSize = 20, TextXAlignment = Enum.TextXAlignment.Center, TextStrokeTransparency = 0.3, ZIndex = 7 })
  local annN = 0
  function G.announce(msg, color, sub, dur)
    annN = annN + 1
    local my = annN
    ann.Text = msg
    ann.TextColor3 = color or RGB(255, 214, 90)
    annSub.Text = sub or ""
    ann.TextTransparency, ann.TextStrokeTransparency = 0, 0.25
    annSub.TextTransparency = 0
    ann.Visible = true
    local sc = mk("UIScale", { Scale = 1.5 }, ann)
    TweenService:Create(sc, TweenInfo.new(0.25, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
    task.delay(dur or 1.6, function()
      if annN ~= my then
        sc:Destroy()
        return
      end
      TweenService:Create(ann, TweenInfo.new(0.4), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
      TweenService:Create(annSub, TweenInfo.new(0.4), { TextTransparency = 1 }):Play()
      task.wait(0.45)
      if annN == my then ann.Visible = false end
      sc:Destroy()
    end)
  end

  -- 低血量：屏幕四边泛红（越少越红）
  local vig = {}
  for i, e in ipairs({ { V2(0, 0), UDim2.new(0, 120, 1, 0), 0 }, { V2(1, 0), UDim2.new(0, 120, 1, 0), 180 }, { V2(0, 0), UDim2.new(1, 0, 0, 90), 90 }, { V2(0, 1), UDim2.new(1, 0, 0, 90), -90 } }) do
    local f = mk("Frame", { BackgroundColor3 = RGB(200, 20, 20), BorderSizePixel = 0, AnchorPoint = e[1], Position = UDim2.fromScale(e[1].X, e[1].Y), Size = e[2], BackgroundTransparency = 1, ZIndex = 0 }, gui)
    mk("UIGradient", { Rotation = e[3], Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.2), NumberSequenceKeypoint.new(1, 1) }) }, f)
    vig[i] = f
  end
  local vigLevel = 0
  function G.stepVignette(dt)
    local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
    local want = 0
    if hum and hum.Health > 0 and hum.MaxHealth > 0 then
      local k = hum.Health / hum.MaxHealth
      if k < 0.4 then want = (0.4 - k) / 0.4 end
    end
    vigLevel = vigLevel + (want - vigLevel) * math.min(1, dt * 5)
    for _, f in ipairs(vig) do f.BackgroundTransparency = 1 - vigLevel * 0.85 end
  end

  ---------------------------------------------------------------- 出错红条（服务器、本地脚本出的错都写在这里，方便截图）

  local errBox = nil
  local errSeen = {}
  function G.showError(msg)
    msg = tostring(msg)
    if errSeen[msg] then return end
    errSeen[msg] = true
    if not errBox then
      errBox = button(gui, "", RGB(130, 24, 24), { AnchorPoint = V2(0.5, 0), Position = UDim2.new(0.5, 0, 0, 4), Size = UDim2.new(0.94, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y,
        TextSize = 13, Font = FONT2, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 20, AutoButtonColor = false })
      mk("UISizeConstraint", { MaxSize = Vector2.new(760, 2000) }, errBox)
      mk("UIPadding", { PaddingTop = UDim.new(0, 6), PaddingBottom = UDim.new(0, 6), PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10) }, errBox)
      errBox.Text = "游戏出错了（截图发给开发者；点这里关掉）："
      errBox.Activated:Connect(function()
        errBox:Destroy()
        errBox = nil
      end)
    end
    errBox.Text = errBox.Text .. "\n· " .. string.sub(msg, 1, 260)
  end

  ---------------------------------------------------------------- 排版：电脑、平板一套；手机（G.compact）一套紧凑的
  -- 手机画布约 900 × 390：左下角留给摇杆，右下角留给跳跃键，底部中间留给背包栏（枪）；兵工厂能收起
  local function place(o, anchor, pos, size)
    o.AnchorPoint = anchor
    o.Position = pos
    if size then o.Size = size end
  end
  local function sizes(list)
    for _, e in ipairs(list) do
      e[1].Size = UDim2.fromOffset(e[2], e[3])
      if e[4] then e[1].TextSize = e[4] end
    end
  end
  function ui.layout()
    local c = G.compact
    local O, N = UDim2.fromOffset, UDim2.new
    if c then
      place(top, V2(0.5, 0), N(0.5, 0, 0, 4), O(280, 44))
      cashL.TextSize, incL.TextSize = 24, 15
      place(mbar, V2(0.5, 0), N(0.5, 0, 0, 52), O(400, 36))
      place(goal, V2(0, 0), O(6, 4), O(290, 54))
      goalT.Position, goalT.Size, goalT.TextSize = O(10, 2), N(1, -20, 0, 14), 12
      goalL.Position, goalL.Size = O(10, 16), N(1, -20, 0, 36)
      place(info, V2(0, 0), O(6, 64), O(236, 94))
      lvL.Position, lvL.Size, lvL.TextSize = O(10, 3), N(1, -20, 0, 24), 18
      armyL.Position, armyL.Size, armyL.TextSize = O(10, 27), N(1, -20, 0, 18), 14
      enemyL.Position, enemyL.Size = O(10, 46), N(1, -20, 0, 20)
      rewardL.Position, rewardL.Size, rewardL.TextSize = O(10, 68), N(1, -20, 0, 18), 14
      place(menu, V2(0, 0), O(6, 164), O(240, 116))
      menuList.Parent, menuGrid.Parent = nil, menu
      for _, b in ipairs(menuBtns) do b.TextSize = 14 end
      place(shop, V2(1, 0), N(1, -6, 0, 4), N(0, 296, 1, -118))
      shopTitle.Position, shopTitle.Size, shopTitle.TextSize = O(12, 4), N(1, -80, 0, 24), 18
      tabBar.Position, tabBar.Size = O(8, 32), N(1, -16, 0, 26)
      for _, b in pairs(tabBtns) do b.Size = O(52, 26) end
      list.Position, list.Size = O(4, 62), N(1, -8, 1, -66)
      ROWH = 56
      for _, e in ipairs(rowParts) do
        e.r.Size = N(1, -10, 0, ROWH - 6)
        e.n.Position, e.n.Size, e.n.TextSize = O(10, 3), N(1, -102, 0, 20), 15
        e.d.Position, e.d.Size, e.dc.MaxTextSize = O(10, 23), N(1, -102, 0, 28), 12
        e.b.Size = O(84, 36)
      end
      place(bar, V2(0.5, 1), N(0.5, 0, 1, -68), O(700, 44))
      sizes({ { ui.deployBtn, 96, 44, 17 }, { ui.arrangeBtn, 110, 44, 16 }, { ui.sellBtn, 96, 44, 16 }, { ui.fightBtn, 110, 44, 20 }, { ui.raidBtn, 96, 44, 17 }, { ui.hqBtn, 170, 44, 14 } })
      place(ui.hint, V2(0.5, 1), N(0.5, 0, 1, -116), O(820, 22))
      place(bpanel, V2(0.5, 0), N(0.5, 0, 0, 4), O(300, 50))
      ui.bTitle.Position, ui.bTitle.Size, ui.bTitle.TextSize = O(0, 2), N(1, 0, 0, 24), 18
      ui.bInfo.Position, ui.bInfo.Size, ui.bInfo.TextSize = O(0, 26), N(1, 0, 0, 20), 15
      place(bbar, V2(0.5, 1), N(0.5, 0, 1, -68), O(700, 44))
      sizes({ { ui.driveBtn, 150, 44, 16 }, { ui.viewBtn, 120, 44, 16 }, { ui.rejoinBtn, 120, 44, 16 }, { ui.exitBtn, 110, 44, 16 } })
      -- 技能：右边一竖列，右手拇指够得着
      place(sbar, V2(1, 0), N(1, -6, 0, 4), O(112, 300))
      sbarList.FillDirection, sbarList.HorizontalAlignment, sbarList.Padding = Enum.FillDirection.Vertical, Enum.HorizontalAlignment.Right, UDim.new(0, 5)
      for _, e in pairs(sbtn) do   -- 六个技能一竖列：每个 44 高，到不了右下角的跳跃键
        e.b.Size = O(112, 44)
        e.nm.Position, e.nm.Size, e.nm.TextSize = O(4, 3), N(1, -8, 0, 18), 14
        e.sub.Visible = false
        e.cdT.Position, e.cdT.Size, e.cdT.TextSize = O(0, 23), N(1, 0, 0, 16), 13
      end
      -- 战报：打仗时左上角是空的
      place(feed, V2(0, 0), O(6, 4), O(300, 150))
      feedList.HorizontalAlignment = Enum.HorizontalAlignment.Left
      place(ui.ammo, V2(0.5, 0), N(0.5, 0, 0, 56), O(300, 26))
      ui.ammo.TextSize, ui.ammo.TextXAlignment = 18, Enum.TextXAlignment.Center
      place(ui.reloadBar, V2(0, 0), N(0.5, -130, 0, 84))
      place(toastBox, V2(0.5, 0), N(0.5, 0, 0, 60), O(600, 220))
      place(invite, V2(0.5, 0), N(0.5, 0, 0, 40))
    else
      place(top, V2(0.5, 0), N(0.5, 0, 0, 8), O(420, 56))
      cashL.TextSize, incL.TextSize = 30, 18
      place(mbar, V2(0.5, 0), N(0.5, 0, 0, 70), O(460, 40))
      place(goal, V2(0, 0), O(10, 6), O(360, 60))
      goalT.Position, goalT.Size, goalT.TextSize = O(12, 3), N(1, -24, 0, 16), 13
      goalL.Position, goalL.Size = O(12, 20), N(1, -24, 0, 38)
      place(info, V2(0, 0), O(10, 72), O(280, 196))
      lvL.Position, lvL.Size, lvL.TextSize = O(14, 8), N(1, -28, 0, 28), 22
      armyL.Position, armyL.Size, armyL.TextSize = O(14, 38), N(1, -28, 0, 20), 16
      enemyL.Position, enemyL.Size = O(14, 60), N(1, -28, 0, 52)
      rewardL.Position, rewardL.Size, rewardL.TextSize = O(14, 112), N(1, -28, 0, 20), 14
      place(menu, V2(0, 0), O(10, 276), O(140, 300))
      menuGrid.Parent, menuList.Parent = nil, menu
      for _, b in ipairs(menuBtns) do b.TextSize = (b == btnCredits) and 14 or 16 end
      -- 兵工厂从上面一直到下面那排按钮的上方
      place(shop, V2(1, 0), N(1, -10, 0, 72), N(0, 330, 1, -212))
      shopTitle.Position, shopTitle.Size, shopTitle.TextSize = O(14, 6), N(1, -28, 0, 28), 20
      tabBar.Position, tabBar.Size = O(10, 38), N(1, -20, 0, 30)
      for _, b in pairs(tabBtns) do b.Size = O(58, 28) end
      list.Position, list.Size = O(6, 74), N(1, -12, 1, -80)
      ROWH = 62
      for _, e in ipairs(rowParts) do
        e.r.Size = N(1, -10, 0, ROWH - 6)
        e.n.Position, e.n.Size, e.n.TextSize = O(10, 4), N(1, -112, 0, 22), 16
        e.d.Position, e.d.Size, e.dc.MaxTextSize = O(10, 26), N(1, -112, 0, 28), 11
        e.b.Size = O(94, 40)
      end
      place(bar, V2(0.5, 1), N(0.5, 0, 1, -78), O(900, 52))
      sizes({ { ui.deployBtn, 120, 48, 18 }, { ui.arrangeBtn, 120, 48, 18 }, { ui.sellBtn, 150, 48, 18 }, { ui.fightBtn, 140, 48, 22 }, { ui.raidBtn, 120, 48, 18 }, { ui.hqBtn, 200, 48, 15 } })
      place(ui.hint, V2(0.5, 1), N(0.5, 0, 1, -136), O(820, 24))
      place(bpanel, V2(0.5, 0), N(0.5, 0, 0, 72), O(420, 62))
      ui.bTitle.Position, ui.bTitle.Size, ui.bTitle.TextSize = O(0, 4), N(1, 0, 0, 28), 21
      ui.bInfo.Position, ui.bInfo.Size, ui.bInfo.TextSize = O(0, 33), N(1, 0, 0, 22), 16
      place(bbar, V2(0.5, 1), N(0.5, 0, 1, -78), O(820, 52))
      sizes({ { ui.driveBtn, 170, 48, 18 }, { ui.viewBtn, 140, 48, 18 }, { ui.rejoinBtn, 150, 48, 18 }, { ui.exitBtn, 140, 48, 18 } })
      place(sbar, V2(0.5, 1), N(0.5, 0, 1, -138), O(820, 64))
      sbarList.FillDirection, sbarList.HorizontalAlignment, sbarList.Padding = Enum.FillDirection.Horizontal, Enum.HorizontalAlignment.Center, UDim.new(0, 8)
      for _, e in pairs(sbtn) do
        e.b.Size = O(124, 60)
        e.nm.Position, e.nm.Size, e.nm.TextSize = O(6, 4), N(1, -12, 0, 20), 15
        e.sub.Visible = true
        e.sub.Position, e.sub.Size = O(6, 26), N(1, -12, 0, 16)
        e.cdT.Position, e.cdT.Size, e.cdT.TextSize = O(0, 40), N(1, 0, 0, 18), 14
      end
      place(feed, V2(1, 0), N(1, -10, 0, 150), O(330, 240))
      feedList.HorizontalAlignment = Enum.HorizontalAlignment.Right
      place(ui.ammo, V2(1, 1), N(1, -20, 1, -20), O(260, 30))
      ui.ammo.TextSize, ui.ammo.TextXAlignment = 22, Enum.TextXAlignment.Right
      place(ui.reloadBar, V2(1, 1), N(1, -20, 1, -14))
      place(toastBox, V2(0.5, 0), N(0.5, 0, 0, 144), O(600, 220))
      place(invite, V2(0.5, 0), N(0.5, 0, 0, 200))
    end
    rankL.Visible, xpBg.Visible, ratingL.Visible = not c, not c, not c
    -- 弹出面板：手机上太高的按屏幕高度来
    for name, m in pairs(modals) do
      local wh = modalSize[name]
      m.Size = (c and wh[2] > 360) and N(0, wh[1], 1, -16) or O(wh[1], wh[2])
    end
    showTab(ui.tab or "foot")
    if G.updateButtons and G.S then G.updateButtons() end
  end
  ui.layout()

  ---------------------------------------------------------------- 刷新

  function G.refresh()
    local S = G.S
    if not S then return end
    refreshSkills(S)
    updateGoal()
    cashL.Text = "$" .. Config.Fmt(S.cash)
    incL.Text = "+" .. Config.Fmt(S.income) .. " / 秒"
    local th = Config.TheaterOf and Config.TheaterOf(S.level or 1)
    lvL.Text = "第 " .. tostring(S.level) .. " 关" .. (th and ("  · " .. th.name) or "") .. ((S.rebirth or 0) > 0 and ("   ★" .. S.rebirth) or "")
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
    ratingL.Text = "突袭积分 " .. tostring(S.rating) .. "   对战积分 " .. tostring(S.pvp or Config.Match.start) .. "   击毁 " .. tostring(S.kills)
    -- 匹配状态条
    if S.teleporting then
      mbar.Visible = true
      mbarL.Text = "正在传送……"
      mbarBtn.Visible = false
    elseif S.battle then
      mbar.Visible = false
    elseif S.matchServer then
      mbar.Visible = true
      mbarL.Text = "对战服务器：等对手进场、开打，打完自动送回去"
      mbarBtn.Visible = false
    elseif S.match then
      mbar.Visible = true
      mbarL.Text = string.format("匹配中 %d:%02d · 找对战积分 %d±%d 的对手", math.floor(S.match.since / 60), S.match.since % 60, S.pvp or 0, S.match.window or 0)
      mbarBtn.Visible = true
    else
      mbar.Visible = false
    end
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
    btnDuel.Text = S.match and "真人对战 ●" or "真人对战"
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

  local lastMode = nil
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
    -- 手机：布阵时兵工厂自动收起（看得到部署区），回基地再打开；打仗时不显示钱和关卡信息（地方留给战场）
    local c = G.compact
    if c and mode ~= lastMode then
      if mode == "deploy" then shopOpen = false elseif mode == "free" then shopOpen = true end
    end
    lastMode = mode
    local shopOk = not fighting and mode ~= "drive"
    shop.Visible = shopOk and (shopOpen or not c)
    shopToggle.Visible = shopOk and c and not shopOpen
    shopClose.Visible = c
    top.Visible = not (c and fighting)
    menu.Visible = not fighting
    info.Visible = mode ~= "drive" and not (c and fighting)
    ui.hint.Visible = mode == "deploy"
    bpanel.Visible = fighting
    bbar.Visible = fighting
    sbar.Visible = fighting and S ~= nil and S.skills ~= nil and #S.skills > 0
    feed.Visible = fighting
    goal.Visible = not fighting and mode ~= "drive"
    ui.driveBtn.Visible = fighting and G.drive == nil
    ui.exitBtn.Visible = G.drive ~= nil
    ui.viewBtn.Text = (mode == "battle") and "跟随自己" or "俯瞰战场"
  end
end

return UI
