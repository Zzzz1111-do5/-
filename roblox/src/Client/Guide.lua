-- 军事大亨（客户端）：指引——告诉玩家下一步干什么、去哪儿
--   地上一条发光的线从脚下连到要去的按钮，光点顺着线往前跑；按钮头顶一个上下跳、一直转的箭头；
--   目标不在画面里时，屏幕边上一个箭头指方向；屏幕上方一行「下一步：……」；要点的界面按钮（兵工厂、开战）一闪一闪。
--   新手一路是：居民楼 A → 兵营 → 买一个步兵班 → 开战；之后一直指向买得起的最便宜的建筑（都买不起就指最便宜的，写还差多少）。
--   左边菜单「指引」能开关；全都自己画在本地，不占网络。只依赖 G.S（状态）、workspace.Plots 里的按钮（Pads 下的 Pad_<建筑 id>）。
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local Guide = {}

function Guide.init(G)
  local Config = G.Config
  local BDEF = Config.BuildingById
  local player = Players.LocalPlayer
  local cam = workspace.CurrentCamera
  local V, V2 = Vector3.new, Vector2.new
  local RGB = Color3.fromRGB
  local ui = G.ui
  local GREEN, AMBER = RGB(110, 255, 140), RGB(255, 200, 70)
  local on = true

  ---------------------------------------------------------------- 3D：线、光点、箭头

  local folder = Instance.new("Folder")
  folder.Name = "ClientGuide"
  folder.Parent = workspace
  local function part(size, shape)
    local p = Instance.new("Part")
    if shape then p.Shape = shape end
    p.Size = size
    p.Color = GREEN
    p.Material = Enum.Material.Neon
    p.Anchored = true
    p.CanCollide = false
    p.CanQuery = false
    p.CanTouch = false
    p.CastShadow = false
    p.Transparency = 1
    p.Parent = folder
    return p
  end
  -- 箭头（朝下）：竖杆 + 两片斜板拼成「V」
  local arrow = { part(V(0.9, 4.2, 0.9)), part(V(0.9, 3.2, 0.9)), part(V(0.9, 3.2, 0.9)) }
  local dots = {}
  for i = 1, 8 do dots[i] = part(V(0.9, 0.9, 0.9), Enum.PartType.Ball) end
  local anchor = part(V(0.2, 0.2, 0.2))
  local a1 = Instance.new("Attachment")
  a1.Parent = anchor
  local beam = Instance.new("Beam")
  beam.Attachment1 = a1
  beam.LightEmission = 1
  beam.Transparency = NumberSequence.new(0.35)
  beam.Width0, beam.Width1 = 0.7, 0.7
  beam.FaceCamera = true
  beam.Segments = 2
  beam.Enabled = false
  beam.Parent = anchor
  local function attach(char)
    local hrp = char and char:WaitForChild("HumanoidRootPart", 10)
    if not hrp then return end
    local a0 = Instance.new("Attachment")
    a0.Name = "GuideA0"
    a0.Position = V(0, -2.4, 0)   -- 脚底
    a0.Parent = hrp
    beam.Attachment0 = a0
  end
  player.CharacterAdded:Connect(attach)
  if player.Character then task.spawn(attach, player.Character) end

  ---------------------------------------------------------------- 界面：提示条、屏幕边的箭头、按钮闪

  local hint = G.mk("Frame", { AnchorPoint = V2(0.5, 0), Position = UDim2.new(0.5, 0, 0, 70), Size = UDim2.fromOffset(560, 36), BackgroundColor3 = RGB(18, 40, 26),
    BackgroundTransparency = 0.15, BorderSizePixel = 0, Visible = false, ZIndex = 3 }, ui.root)
  G.round(hint, 8)
  G.mk("UIStroke", { Color = GREEN, Transparency = 0.5, Thickness = 1, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }, hint)
  local hintL = G.text(hint, { Position = UDim2.fromOffset(12, 0), Size = UDim2.new(1, -54, 1, 0), TextSize = 15, Font = Enum.Font.GothamBold, TextColor3 = RGB(200, 255, 210),
    TextScaled = true, ZIndex = 3 })
  G.mk("UITextSizeConstraint", { MaxTextSize = 15, MinTextSize = 10 }, hintL)
  G.button(hint, "×", RGB(60, 70, 64), { AnchorPoint = V2(1, 0.5), Position = UDim2.new(1, -5, 0.5, 0), Size = UDim2.fromOffset(30, 26), TextSize = 16, ZIndex = 3 },
    function() G.toggleGuide(false) end)
  ui.guideHint = hint

  -- 屏幕边上的箭头（另开一个铺满整个屏幕的界面，坐标和 WorldToViewportPoint 一样）
  local edgeGui = G.mk("ScreenGui", { Name = "GuideEdge", ResetOnSpawn = false, IgnoreGuiInset = true, DisplayOrder = 2 }, player:WaitForChild("PlayerGui"))
  local edge = G.mk("Frame", { AnchorPoint = V2(0.5, 0.5), Size = UDim2.fromOffset(46, 46), BackgroundTransparency = 1, Visible = false }, edgeGui)
  for _, s in ipairs({ -1, 1 }) do   -- 两根短棒拼成「>」，整个框转到朝目标
    local bar = G.mk("Frame", { AnchorPoint = V2(0.5, 0.5), Position = UDim2.new(0.5, -3, 0.5, s * 8), Size = UDim2.fromOffset(26, 7), BackgroundColor3 = GREEN,
      BorderSizePixel = 0, Rotation = s * 40 }, edge)
    G.round(bar, 3)
  end

  local pulse = G.mk("UIStroke", { Color = AMBER, Thickness = 4, ApplyStrokeMode = Enum.ApplyStrokeMode.Border })

  ---------------------------------------------------------------- 下一步

  local function myPads()
    local S = G.S
    local plots = workspace:FindFirstChild("Plots")
    local plot = S and plots and plots:FindFirstChild("Plot" .. tostring(S.plot))
    local pads = plot and plot:FindFirstChild("Pads")
    local list = {}
    if pads then
      for _, m in ipairs(pads:GetChildren()) do
        local id = string.match(m.Name, "^Pad_(.+)$")
        local b = id and BDEF[id]
        local pad = m:FindFirstChild("Pad")
        if b and pad then table.insert(list, { b = b, pad = pad }) end
      end
    end
    table.sort(list, function(x, y) return x.b.price < y.b.price end)
    return list
  end

  -- 返回 { text, pos（3D 目标）, ok（买得起）, btn（要闪的界面按钮）, tab（兵工厂翻到哪页）}；没什么要做的返回 nil
  local function nextStep()
    local S = G.S
    if not S or S.battle or S.matchServer or S.teleporting then return nil end
    local owned = S.owned or {}
    local list = myPads()
    local function padStep(e)
      local ok = (S.cash or 0) >= e.b.price
      local text
      if ok then
        text = "下一步：去盖「" .. e.b.name .. "」（$" .. Config.Fmt(e.b.price) .. "），跟着地上的绿线走，踩一下发光的按钮"
      else
        text = "攒钱盖「" .. e.b.name .. "」：还差 $" .. Config.Fmt(e.b.price - (S.cash or 0)) .. "（每秒 +" .. Config.Fmt(S.income or 0) .. "）"
      end
      return { text = text, pos = e.pad.Position, ok = ok }
    end
    local function find(id)
      for _, e in ipairs(list) do
        if e.b.id == id then return e end
      end
    end
    if not owned.house1 and find("house1") then return padStep(find("house1")) end
    if not owned.barracks and find("barracks") then return padStep(find("barracks")) end
    if (S.n or 0) == 0 and owned.barracks then
      return { text = "下一步：在右边「兵工厂」的步兵页买一个步兵班（$" .. Config.Units.inf.price .. "）", btn = G.shopBtn and G.shopBtn("inf"), tab = "foot" }
    end
    if (S.level or 1) == 1 and (S.n or 0) > 0 then
      return { text = "下一步：点下面的「开战！」打第 1 关——你本人也会上战场", btn = ui.fightBtn }
    end
    for _, e in ipairs(list) do
      if (S.cash or 0) >= e.b.price then return padStep(e) end
    end
    if list[1] then return padStep(list[1]) end
    return nil
  end

  function G.toggleGuide(v)
    if v == nil then on = not on else on = v end
    if ui.guideBtn then ui.guideBtn.Text = on and "指引：开" or "指引：关" end
    if not on then G.toast("指引关了：左边菜单「指引」可以再打开", "info") end
  end

  local function hide3D()
    beam.Enabled = false
    for _, p in ipairs(arrow) do p.Transparency = 1 end
    for _, p in ipairs(dots) do p.Transparency = 1 end
  end

  local t = 0
  local lastTab = nil
  RunService.RenderStepped:Connect(function(dt)
    t = t + dt
    local st = on and nextStep() or nil
    -- 提示条（匹配状态条在的时候往下挪一格）
    if st then
      hint.Visible = true
      hintL.Text = st.text
      hint.Position = UDim2.new(0.5, 0, 0, (ui.mbar and ui.mbar.Visible) and 116 or 70)
    else
      hint.Visible = false
    end
    -- 要点的界面按钮：闪
    if st and st.btn and st.btn.Visible then
      pulse.Parent = st.btn
      pulse.Transparency = 0.15 + 0.6 * (0.5 + 0.5 * math.sin(t * 6))
    else
      pulse.Parent = nil
    end
    if st and st.tab and st.tab ~= lastTab and G.shopTab then G.shopTab(st.tab) end
    lastTab = st and st.tab or nil
    -- 3D：只在平时（自己走动）显示
    local a0 = beam.Attachment0
    local hrp = a0 and a0.Parent
    if not (st and st.pos and G.mode == "free" and hrp and hrp.Parent) then
      hide3D()
      edge.Visible = false
      return
    end
    local col = st.ok and GREEN or AMBER
    local target = st.pos + V(0, 0.6, 0)
    anchor.CFrame = CFrame.new(target)
    beam.Color = ColorSequence.new(col)
    local foot = hrp.Position - V(0, 2.4, 0)
    local far = (target - foot).Magnitude > 12
    beam.Enabled = far
    -- 光点顺着线往目标跑
    for i, p in ipairs(dots) do
      local k = ((i - 1) / #dots + t * 0.25) % 1
      p.CFrame = CFrame.new(foot:Lerp(target, k) + V(0, 0.4, 0))
      p.Color = col
      p.Transparency = far and 0.15 or 1
    end
    -- 头顶的箭头：上下跳、转
    local base = CFrame.new(target + V(0, 9 + math.sin(t * 3) * 1.2, 0)) * CFrame.Angles(0, t * 2, 0)
    arrow[1].CFrame = base * CFrame.new(0, 2.6, 0)
    arrow[2].CFrame = base * CFrame.new(-0.9, 0.2, 0) * CFrame.Angles(0, 0, math.rad(40))
    arrow[3].CFrame = base * CFrame.new(0.9, 0.2, 0) * CFrame.Angles(0, 0, math.rad(-40))
    for _, p in ipairs(arrow) do
      p.Color = col
      p.Transparency = 0.05
    end
    -- 目标不在画面里：屏幕边上的箭头指过去
    local sp, onScreen = cam:WorldToViewportPoint(target)
    local vs = cam.ViewportSize
    if onScreen and sp.Z > 0 then
      edge.Visible = false
    else
      local cx, cy = vs.X / 2, vs.Y / 2
      local dx, dy = sp.X - cx, sp.Y - cy
      if sp.Z < 0 then dx, dy = -dx, -dy end
      local l = math.sqrt(dx * dx + dy * dy)
      if l < 1e-3 then dx, dy, l = 0, 1, 1 end
      dx, dy = dx / l, dy / l
      local m = 50
      local k = math.min((cx - m) / math.max(math.abs(dx), 1e-3), (cy - m) / math.max(math.abs(dy), 1e-3))
      edge.Position = UDim2.fromOffset(cx + dx * k, cy + dy * k)
      edge.Rotation = math.deg(math.atan2(dy, dx))
      for _, b in ipairs(edge:GetChildren()) do
        if b:IsA("Frame") then b.BackgroundColor3 = col end
      end
      edge.Visible = true
    end
  end)
end

return Guide
