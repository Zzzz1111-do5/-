-- 军事大亨（客户端）：地图指引——
--   ① 地上一串往前流动的绿色箭头 + 一条发光的线，从你脚下指到下一个要去的地方（补给箱优先，其次是左上角「当前目标」说的那个按钮）；
--      目标头顶一个上下跳、一直转的立体箭头（钱不够时变黄）；目标不在画面里时，屏幕边上一个箭头指方向；
--      目标是界面上的按钮（兵工厂里买兵、开战、建筑）时，那个按钮一闪一闪；左边菜单「指引」能关；
--   ② 左边的小地图（上面是战场）：自己的基地、盖好的楼、能买的按钮（绿点）、补给箱（金点）、你（白箭头）、你的部队（蓝点）；右上角「－」收起
local Players = game:GetService("Players")

local Guide = {}

function Guide.init(G)
  local Config = G.Config
  local V = Vector3.new
  local RGB = Color3.fromRGB
  local V2 = Vector2.new
  local player = Players.LocalPlayer
  local ui = G.ui
  local mk, text, round = G.mk, G.text, G.round
  local cam = workspace.CurrentCamera
  local GREEN, AMBER = RGB(120, 255, 150), RGB(255, 205, 80)
  local on = true
  function G.guideOn() return on end
  function G.toggleGuide(v)
    if v == nil then on = not on else on = v end
    if ui.guideBtn then ui.guideBtn.Text = on and "指引：开" or "指引：关" end
    if not on then G.toast("指引关了：左边菜单「指引」可以再打开", "info") end
  end

  ---------------------------------------------------------------- ① 地上的箭头

  -- 一个箭头 = 两根斜着的发光细条拼成的「V」（尖朝前）；一池子反复用
  local N, GAP, SPEED = 24, 7, 11
  local pool = {}
  for i = 1, N do
    local a = G.fxPart(nil, V(0.55, 0.14, 3.2), CFrame.new(), RGB(120, 255, 150), Enum.Material.Neon, 1)
    local b = G.fxPart(nil, V(0.55, 0.14, 3.2), CFrame.new(), RGB(120, 255, 150), Enum.Material.Neon, 1)
    pool[i] = { a, b }
  end
  local LA = CFrame.new(-0.92, 0, 1.31) * CFrame.Angles(0, math.rad(-35), 0)
  local LB = CFrame.new(0.92, 0, 1.31) * CFrame.Angles(0, math.rad(35), 0)
  local phase = 0
  local function hideAll(from)
    for i = from, N do
      pool[i][1].Transparency = 1
      pool[i][2].Transparency = 1
    end
  end
  -- 现在要去哪：补给箱 > 目标按钮；打仗、布阵、开车时不指
  local function target()
    local S = G.S
    if not S or G.battle or G.mode ~= "free" then return nil, nil end
    if typeof(S.crate) == "Vector3" then return S.crate, RGB(255, 214, 80) end
    local pad = G.goalPadPart and G.goalPadPart()
    if pad and pad.Parent then return pad.CFrame.Position, (G.goalOk and not G.goalOk()) and AMBER or GREEN end
    return nil, nil
  end

  -- 目标头顶的立体箭头：竖杆 + 两片斜板拼成「V」（朝下），一直转
  local big = {
    G.fxPart(nil, V(0.9, 4.2, 0.9), CFrame.new(), GREEN, Enum.Material.Neon, 1),
    G.fxPart(nil, V(0.9, 3.2, 0.9), CFrame.new(), GREEN, Enum.Material.Neon, 1),
    G.fxPart(nil, V(0.9, 3.2, 0.9), CFrame.new(), GREEN, Enum.Material.Neon, 1),
  }
  -- 一条发光的线（Beam）：脚底 → 目标
  local anchor = G.fxPart(nil, V(0.2, 0.2, 0.2), CFrame.new(), GREEN, Enum.Material.Neon, 1)
  local a1 = Instance.new("Attachment")
  a1.Parent = anchor
  local beam = Instance.new("Beam")
  beam.Attachment1 = a1
  beam.LightEmission = 1
  beam.Transparency = NumberSequence.new(0.45)
  beam.Width0, beam.Width1 = 0.6, 0.6
  beam.FaceCamera = true
  beam.Segments = 2
  beam.Enabled = false
  beam.Parent = anchor
  local function attach(char)
    local hrp = char and char:WaitForChild("HumanoidRootPart", 10)
    if not hrp then return end
    local a0 = Instance.new("Attachment")
    a0.Name = "GuideA0"
    a0.Position = V(0, -2.4, 0)
    a0.Parent = hrp
    beam.Attachment0 = a0
  end
  player.CharacterAdded:Connect(attach)
  if player.Character then task.spawn(attach, player.Character) end
  -- 屏幕边上的箭头（另开一个铺满屏幕的界面，坐标和 WorldToViewportPoint 一样）：两根短棒拼成「>」，整个转向目标
  local edgeGui = mk("ScreenGui", { Name = "GuideEdge", ResetOnSpawn = false, IgnoreGuiInset = true, DisplayOrder = 2 }, player:WaitForChild("PlayerGui"))
  local edge = mk("Frame", { AnchorPoint = V2(0.5, 0.5), Size = UDim2.fromOffset(46, 46), BackgroundTransparency = 1, Visible = false }, edgeGui)
  local edgeBars = {}
  for _, sgn in ipairs({ -1, 1 }) do
    local bar = mk("Frame", { AnchorPoint = V2(0.5, 0.5), Position = UDim2.new(0.5, -3, 0.5, sgn * 8), Size = UDim2.fromOffset(26, 7), BackgroundColor3 = GREEN,
      BorderSizePixel = 0, Rotation = sgn * 40 }, edge)
    round(bar, 3)
    table.insert(edgeBars, bar)
  end
  -- 界面上要点的按钮：一圈粗描边一闪一闪
  local pulse = mk("UIStroke", { Color = AMBER, Thickness = 4, ApplyStrokeMode = Enum.ApplyStrokeMode.Border })

  ---------------------------------------------------------------- ② 小地图

  local MAP = { x0 = -150, x1 = 250, z0 = -145, z1 = 345 }   -- 相对基地原点的范围（含路和部署区）
  local MW, MH = 128, 156
  local mm = mk("Frame", { BackgroundColor3 = RGB(14, 18, 24), BackgroundTransparency = 0.2, BorderSizePixel = 0, Position = UDim2.fromOffset(158, 276), Size = UDim2.fromOffset(MW + 12, MH + 30) }, ui.root)
  round(mm, 10)
  text(mm, { Position = UDim2.fromOffset(8, 2), Size = UDim2.new(1, -16, 0, 22), TextSize = 13, Font = Enum.Font.GothamBold, TextColor3 = RGB(255, 214, 90), Text = "地图（上面是战场）" })
  local area = mk("Frame", { BackgroundColor3 = RGB(70, 96, 58), BorderSizePixel = 0, Position = UDim2.fromOffset(6, 24), Size = UDim2.fromOffset(MW, MH), ClipsDescendants = true }, mm)
  round(area, 6)
  ui.minimap = mm
  ui.minimapC = G.collapsible and G.collapsible(mm, function() return 28 end)
  -- 世界（相对原点的 x、z）→ 小地图上的位置：北（+Z）朝上，从上往下看时 +X 在左边
  local function at(x, z)
    return UDim2.fromScale(1 - (x - MAP.x0) / (MAP.x1 - MAP.x0), 1 - (z - MAP.z0) / (MAP.z1 - MAP.z0))
  end
  local function sizeOf(w, d)
    return UDim2.fromScale(w / (MAP.x1 - MAP.x0), d / (MAP.z1 - MAP.z0))
  end
  local function rect(x, z, w, d, color, tr, z0)
    return mk("Frame", { AnchorPoint = V2(0.5, 0.5), Position = at(x, z), Size = sizeOf(w, d), BackgroundColor3 = color, BackgroundTransparency = tr or 0, BorderSizePixel = 0, ZIndex = z0 or 1 }, area)
  end
  local hs = Config.BaseSize / 2
  local F = Config.Field
  rect(0, 0, Config.BaseSize, Config.BaseSize, RGB(150, 152, 150), 0, 1)                            -- 基地地面
  rect(0, (hs + F.center - F.length / 2) / 2, Config.BaseSize, F.center - F.length / 2 - hs, RGB(52, 54, 58), 0, 1)   -- 路
  local dep = rect(0, (F.deploy[1] + F.deploy[2]) / 2, F.width, F.deploy[2] - F.deploy[1], RGB(60, 120, 220), 0.45, 1)   -- 部署区
  text(dep, { Size = UDim2.fromScale(1, 1), TextXAlignment = Enum.TextXAlignment.Center, TextSize = 11, Font = Enum.Font.GothamBold, Text = "部署区", ZIndex = 2 })
  local dyn = mk("Frame", { Name = "Dynamic", BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), ZIndex = 2 }, area)
  local me = text(area, { AnchorPoint = V2(0.5, 0.5), Size = UDim2.fromOffset(16, 16), TextXAlignment = Enum.TextXAlignment.Center, TextSize = 15, Font = Enum.Font.GothamBold,
    TextColor3 = RGB(255, 255, 255), TextStrokeTransparency = 0.2, Text = "▲", ZIndex = 6 })
  local ring = mk("Frame", { AnchorPoint = V2(0.5, 0.5), Size = UDim2.fromOffset(14, 14), BackgroundTransparency = 1, ZIndex = 5, Visible = false }, area)
  mk("UIStroke", { Color = RGB(120, 255, 150), Thickness = 2 }, ring)
  round(ring, 7)

  local function dot(x, z, size, color, zi)
    local f = mk("Frame", { AnchorPoint = V2(0.5, 0.5), Position = at(x, z), Size = UDim2.fromOffset(size, size), BackgroundColor3 = color, BorderSizePixel = 0, ZIndex = zi or 3 }, dyn)
    round(f, size)
    return f
  end
  -- 楼、按钮、补给箱、部队：状态变了或隔半秒重画
  local function redraw()
    local S = G.S
    if not S then return end
    for _, c in ipairs(dyn:GetChildren()) do c:Destroy() end
    local owned = S.owned or {}
    for _, b in ipairs(Config.Buildings) do
      if owned[b.id] then
        local r = rect(b.x, b.z, b.size[1], b.size[3], RGB(84, 92, 100), 0, 2)
        r.Parent = dyn
      elseif (not b.req or owned[b.req]) and Config.AreaOpen(b, S.rebirth) then
        local px, pz = b.x, b.z - b.size[3] / 2 - 6
        if b.pad then px, pz = b.x + b.pad[1], b.z + b.pad[2] end
        dot(px, pz, 7, (S.cash >= b.price) and RGB(90, 255, 120) or RGB(230, 90, 70), 3)
      end
    end
    local o = S.origin
    for m in pairs(G.vis or {}) do
      if m.Parent and m:GetAttribute("Owner") == player.UserId and not m:GetAttribute("Dead") then
        local r = m:FindFirstChild("Root")
        if r and o then
          local p = r.CFrame.Position - o
          dot(p.X, p.Z, 4, RGB(110, 170, 255), 3)
        end
      end
    end
    if typeof(S.crate) == "Vector3" and o then
      local p = S.crate - o
      dot(p.X, p.Z, 9, RGB(255, 214, 80), 4)
    end
  end

  ---------------------------------------------------------------- 每帧

  local t = 0
  function G.stepGuide(dt)
    phase = (phase + dt * SPEED) % GAP
    t = t + dt
    local S = G.S
    local char = player.Character
    local root = char and char:FindFirstChild("HumanoidRootPart")
    -- 地上的箭头（指引关了就都不画）
    local goal, color = target()
    if not on then goal = nil end
    local used = 0
    if goal and root and S and S.origin then
      local from = root.CFrame.Position
      local y = S.origin.Y + 1.15
      local a = V(from.X, y, from.Z)
      local b = V(goal.X, y, goal.Z)
      -- 在围墙里、目标在墙外：先指到门口（南边的新区域走南门，西边工业区走西门），出了门再直接指过去
      local hs = Config.BaseSize / 2
      local pr, gr = from - S.origin, goal - S.origin
      if math.abs(pr.X) < hs and math.abs(pr.Z) < hs then
        if gr.Z < -hs - 2 then
          b = S.origin + V((Config.SouthGate[1] + Config.SouthGate[2]) / 2, 1.15, -hs - 8)
        elseif gr.X < -hs - 2 then
          b = S.origin + V(-hs - 8, 1.15, (Config.Industry.gate[1] + Config.Industry.gate[2]) / 2)
        end
      end
      local d = b - a
      local len = d.Magnitude
      if len > 12 then
        local dir = d / len
        local base0 = CFrame.lookAt(a, a + dir)
        for i = 1, N do
          local s = phase + (i - 1) * GAP + 4
          if s > len - 5 then break end
          local cf = base0 * CFrame.new(0, 0, -s)
          local p = pool[i]
          p[1].CFrame = cf * LA
          p[2].CFrame = cf * LB
          local fade = math.clamp(math.min(s - 4, len - 5 - s) / 6, 0, 1)
          local tr = 1 - 0.75 * fade
          p[1].Transparency, p[2].Transparency = tr, tr
          p[1].Color, p[2].Color = color, color
          used = i
        end
      end
    end
    hideAll(used + 1)
    -- 头顶的立体箭头、发光的线、屏幕边的箭头
    local hrp = beam.Attachment0 and beam.Attachment0.Parent
    if goal and root and hrp then
      local tgt = goal + V(0, 0.6, 0)
      anchor.CFrame = CFrame.new(tgt)
      beam.Color = ColorSequence.new(color)
      beam.Enabled = (tgt - root.CFrame.Position).Magnitude > 14
      local now = os.clock()
      local base = CFrame.new(tgt + V(0, 9 + math.sin(now * 3) * 1.2, 0)) * CFrame.Angles(0, now * 2, 0)
      big[1].CFrame = base * CFrame.new(0, 2.6, 0)
      big[2].CFrame = base * CFrame.new(-0.9, 0.2, 0) * CFrame.Angles(0, 0, math.rad(40))
      big[3].CFrame = base * CFrame.new(0.9, 0.2, 0) * CFrame.Angles(0, 0, math.rad(-40))
      for _, p in ipairs(big) do
        p.Color = color
        p.Transparency = 0.05
      end
      local sp, onScreen = cam:WorldToViewportPoint(tgt)
      if onScreen and sp.Z > 0 then
        edge.Visible = false
      else
        local vs = cam.ViewportSize
        local cx, cy = vs.X / 2, vs.Y / 2
        local dx, dy = sp.X - cx, sp.Y - cy
        if sp.Z < 0 then dx, dy = -dx, -dy end
        local l = math.sqrt(dx * dx + dy * dy)
        if l < 1e-3 then dx, dy, l = 0, 1, 1 end
        dx, dy = dx / l, dy / l
        local k = math.min((cx - 50) / math.max(math.abs(dx), 1e-3), (cy - 50) / math.max(math.abs(dy), 1e-3))
        edge.Position = UDim2.fromOffset(cx + dx * k, cy + dy * k)
        edge.Rotation = math.deg(math.atan2(dy, dx))
        for _, b in ipairs(edgeBars) do b.BackgroundColor3 = color end
        edge.Visible = true
      end
    else
      beam.Enabled = false
      edge.Visible = false
      for _, p in ipairs(big) do p.Transparency = 1 end
    end
    -- 界面上要点的按钮：闪
    local btn = on and G.goalUiTarget and G.goalUiTarget() or nil
    if btn and btn.Visible and not G.battle then
      pulse.Parent = btn
      pulse.Transparency = 0.15 + 0.6 * (0.5 + 0.5 * math.sin(os.clock() * 6))
    else
      pulse.Parent = nil
    end
    -- 小地图
    local show = S ~= nil and not G.battle and G.mode ~= "drive" and not G.compact   -- 手机屏幕小，不放小地图（地上的箭头照样指路）
    mm.Visible = show
    if not show then return end
    if t > 0.5 then
      t = 0
      redraw()
    end
    if root and S.origin then
      local p = root.CFrame.Position - S.origin
      me.Position = at(p.X, p.Z)
      local lv = root.CFrame.LookVector
      me.Rotation = math.deg(math.atan2(-lv.X, lv.Z))
    end
    if goal and S.origin then
      local p = goal - S.origin
      ring.Visible = true
      ring.Position = at(p.X, p.Z)
      local k = 1 + 0.35 * math.sin(os.clock() * 5)
      ring.Size = UDim2.fromOffset(14 * k, 14 * k)
    else
      ring.Visible = false
    end
  end
end

return Guide
