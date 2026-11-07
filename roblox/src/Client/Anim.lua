-- 军事大亨（客户端）：建筑动画（都在本地播，不占网络）——
--   新盖的楼（模型属性 BuiltAt 是刚才）：零件从地下按高度一层层升上来，四角搭着脚手架、落地扬尘；
--   零件属性 Anim = "spin" 的绕竖轴转（雷达；有 Ax 就绕这根轴转，比如抽油机的曲柄），"blink" 的一闪一闪（指示灯、跑道灯），
--   "nod" 的绕 Piv 点、Ax 轴来回摆 Amp 度（做俯卧撑的兵、抽油机的驴头）；spin 有 Piv 的绕那个点转（抽油机的配重）；
--   "belt" 的零件当传送带 / 铁轨：本地摆 N 个弹药箱 / 矿车，沿零件的 X 方向以 Spd 格每秒一直往前走（弹药厂、矿场）；
--   买得起的绿色购买按钮一呼一吸，隔一会儿冒一圈光；
--   机场跑道头停着的战斗机隔一会儿滑跑起飞、飞向战场，过一阵从南边进场降落、滑回停机位；直升机场的直升机起飞绕一圈落回来
--   （建筑里叫 Show 的模型，服务器上一直停着，只在本地动）
local TweenService = game:GetService("TweenService")
local Debris = game:GetService("Debris")

local Anim = {}

function Anim.init(G)
  local V = Vector3.new
  local RGB = Color3.fromRGB
  local cam = workspace.CurrentCamera
  local spinning = {}   -- [part] = { cf0, spd, model }
  local blinking = {}   -- [part] = { spd, tr0 }
  local nodding = {}    -- [part] = { cf0, piv, ax, amp, spd, ph, model }
  local belts = {}      -- [part] = { cf0, len, h, spd, n, item, model, items }
  local pads = {}       -- [pad] = true
  local busy = {}       -- [model] = 升起动画放完的时刻（这之前不转）
  local GREEN = RGB(70, 220, 100)

  local function beltItem(kind)
    local parts = {}
    local function add(size, off, color, mat, shape)
      local p = G.fxPart(shape, size, CFrame.new(), color, mat, 0)
      p.CastShadow = true
      table.insert(parts, { p = p, off = off })
    end
    if kind == "cart" then
      add(V(2.8, 1.4, 2.0), CFrame.new(0, 1.0, 0), RGB(70, 72, 78), Enum.Material.Metal)
      add(V(2.4, 0.5, 1.6), CFrame.new(0, 1.9, 0), RGB(96, 80, 64), Enum.Material.Pebble)
      for _, sx in ipairs({ -0.9, 0.9 }) do add(V(2.2, 0.7, 0.7), CFrame.new(sx, 0.35, 0) * CFrame.Angles(0, math.pi / 2, 0), RGB(36, 36, 38), Enum.Material.Metal, Enum.PartType.Cylinder) end
    else
      add(V(1.6, 1.1, 1.5), CFrame.new(0, 0.55, 0), RGB(78, 92, 58), Enum.Material.Metal)
      add(V(1.62, 0.22, 1.52), CFrame.new(0, 0.75, 0), RGB(236, 196, 50), Enum.Material.SmoothPlastic)
    end
    return parts
  end

  ---------------------------------------------------------------- 起降表演
  local shows = {}   -- [Show 模型] = { kind, root, cf0 停放位置, bm 所在建筑, t, rot 旋翼转角, rotor, tail, axis, parts, hidden }
  local function addShow(sm, bm)
    if shows[sm] then return end
    local root = sm:FindFirstChild("Root")
    if not root then return end
    local parts = {}
    for _, d in ipairs(sm:GetDescendants()) do
      if d:IsA("BasePart") then table.insert(parts, d) end
    end
    local tail = sm:FindFirstChild("TailMotor", true)
    shows[sm] = { kind = sm:GetAttribute("Show"), root = root, cf0 = root.CFrame, bm = bm, t = math.random() * 15, rot = 0,
      rotor = sm:FindFirstChild("RotorMotor", true), tail = tail, axis = tail and tail:GetAttribute("Axis") or V(1, 0, 0), parts = parts, hidden = false }
  end

  local function register(m)
    for _, d in ipairs(m:GetDescendants()) do
      if d:IsA("BasePart") then
        local a = d:GetAttribute("Anim")
        if a == "spin" then
          spinning[d] = { cf0 = d.CFrame, spd = d:GetAttribute("Spd") or 0.3, model = m, ax = d:GetAttribute("Ax"), piv = d:GetAttribute("Piv") }
        elseif a == "blink" then
          blinking[d] = { spd = d:GetAttribute("Spd") or 1, tr0 = d.Transparency, ph = math.random() * 6 }
        elseif a == "belt" then
          belts[d] = { cf0 = d.CFrame, len = d.Size.X, h = d.Size.Y, spd = d:GetAttribute("Spd") or 3, n = d:GetAttribute("N") or 4, item = d:GetAttribute("Item") or "crate", model = m }
        elseif a == "nod" then
          local piv, ax = d:GetAttribute("Piv"), d:GetAttribute("Ax")
          if typeof(piv) == "Vector3" and typeof(ax) == "Vector3" then
            nodding[d] = { cf0 = d.CFrame, piv = piv, ax = ax.Unit, amp = math.rad(d:GetAttribute("Amp") or 8), spd = d:GetAttribute("Spd") or 0.5, ph = d:GetAttribute("Ph") or 0, model = m }
          end
        end
      end
    end
    local sm = m:FindFirstChild("Show")
    if sm then addShow(sm, m) end
  end

  -- 从地里升起来：每个零件先沉到地下，按离地高度依次升回原位
  local function rise(m)
    local parts = {}
    local y0, y1 = math.huge, -math.huge
    for _, d in ipairs(m:GetDescendants()) do
      -- 展示飞机是焊在一起的一整架：只挪它的 Root，别的零件跟着走
      if d:IsA("BasePart") and (not d:FindFirstAncestor("Show") or (d.Name == "Root" and d.Parent and d.Parent.Name == "Show")) then
        table.insert(parts, d)
        local p = d.CFrame.Position
        y0 = math.min(y0, p.Y - d.Size.Y / 2)
        y1 = math.max(y1, p.Y + d.Size.Y / 2)
      end
    end
    if #parts == 0 then return end
    local h = math.max(4, y1 - y0)
    local total = 1.6
    busy[m] = os.clock() + total + 0.3
    for _, p in ipairs(parts) do
      local cf = p.CFrame
      local k = math.clamp((cf.Position.Y - y0) / h, 0, 1)
      p.CFrame = cf - V(0, h + 2, 0)
      task.delay(k * total * 0.55, function()
        if p.Parent then TweenService:Create(p, TweenInfo.new(0.55, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { CFrame = cf }):Play() end
      end)
    end
    -- 脚手架：四角的黄色立杆 + 顶上一圈，盖完淡掉
    local body = m.PrimaryPart
    if body and G.fxPart then
      local c = body.CFrame.Position
      local sx, sz = body.Size.X / 2 + 1.5, body.Size.Z / 2 + 1.5
      local poles = {}
      for _, o in ipairs({ { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } }) do
        local pole = G.fxPart(nil, V(0.5, h, 0.5), CFrame.new(c.X + o[1] * sx, y0 + h / 2, c.Z + o[2] * sz), RGB(240, 190, 40), Enum.Material.Metal, 0)
        table.insert(poles, pole)
      end
      for _, o in ipairs({ { 0, -1, 2 * sx, 0.4 }, { 0, 1, 2 * sx, 0.4 }, { -1, 0, 0.4, 2 * sz }, { 1, 0, 0.4, 2 * sz } }) do
        local bar = G.fxPart(nil, V(o[3], 0.4, o[4]), CFrame.new(c.X + o[1] * sx, y0 + h, c.Z + o[2] * sz), RGB(240, 190, 40), Enum.Material.Metal, 0)
        table.insert(poles, bar)
      end
      task.delay(total, function()
        for _, q in ipairs(poles) do
          if q.Parent then
            TweenService:Create(q, TweenInfo.new(0.5), { Transparency = 1 }):Play()
            Debris:AddItem(q, 0.55)
          end
        end
      end)
      -- 扬尘
      for i = 1, 10 do
        local a = i / 10 * math.pi * 2
        local q = V(c.X + math.cos(a) * sx, y0 + 1, c.Z + math.sin(a) * sz)
        local sm = G.fxPart(Enum.PartType.Ball, V(3, 3, 3), CFrame.new(q), RGB(196, 186, 160), Enum.Material.SmoothPlastic, 0.3)
        TweenService:Create(sm, TweenInfo.new(1.4), { Size = V(9, 9, 9), Transparency = 1, CFrame = CFrame.new(q + V(0, 4, 0)) }):Play()
        Debris:AddItem(sm, 1.5)
      end
      task.delay(total * 0.9, function()
        if G.playSound then G.playSound("build", c) end
      end)
    end
  end

  local function onBuilding(m)
    if not m:IsA("Model") then return end
    local at = m:GetAttribute("BuiltAt")
    local fresh = type(at) == "number" and (workspace:GetServerTimeNow() - at) < 4
    register(m)   -- 先记下原位（升起动画会先把零件沉到地下）
    if fresh then rise(m) end
  end
  local function onPad(m)
    local pad = m:FindFirstChild("Pad")
    if pad then pads[pad] = true end
  end

  local function watch(folder, fn)
    folder.ChildAdded:Connect(function(c)
      task.wait()
      if c.Parent then fn(c) end
    end)
    for _, c in ipairs(folder:GetChildren()) do fn(c) end
  end
  task.spawn(function()
    local plots = workspace:WaitForChild("Plots")
    local function onPlot(p)
      local b = p:WaitForChild("Buildings", 30)
      if b then watch(b, onBuilding) end
      local pd = p:WaitForChild("Pads", 30)
      if pd then watch(pd, onPad) end
    end
    plots.ChildAdded:Connect(onPlot)
    for _, p in ipairs(plots:GetChildren()) do task.spawn(onPlot, p) end
  end)

  ---------------------------------------------------------------- 自己基地里的「人气」：两个巡逻兵沿大道、横路来回走，一辆吉普在横路上来回开（只在本地画）
  local life = nil
  local ROUTE = { { -10, -104 }, { -10, 50 }, { 42, 60 }, { 42, 118 }, { -62, 118 }, { -62, 60 }, { -10, 50 } }
  local function soldierModel()
    local parts = {}
    local function add(size, off, color, shape)
      local p = G.fxPart(shape, size, CFrame.new(), color, Enum.Material.SmoothPlastic, 0)
      p.CastShadow = true
      table.insert(parts, { p = p, off = off })
      return p
    end
    add(V(1.0, 1.9, 0.6), CFrame.new(0, 0.95, 0), RGB(66, 74, 50))
    add(V(1.3, 1.7, 0.75), CFrame.new(0, 2.7, 0), RGB(86, 96, 64))
    add(V(0.8, 0.8, 0.8), CFrame.new(0, 3.95, 0), RGB(230, 188, 150))
    add(V(1.05, 0.45, 1.05), CFrame.new(0, 4.45, 0), RGB(70, 80, 52))
    add(V(0.18, 0.25, 2.0), CFrame.new(0.5, 2.8, -0.6), RGB(40, 40, 40))
    return parts
  end
  local function jeepModel()
    local parts = {}
    local function add(size, off, color, mat)
      local p = G.fxPart(nil, size, CFrame.new(), color, mat or Enum.Material.Metal, 0)
      p.CastShadow = true
      table.insert(parts, { p = p, off = off })
    end
    add(V(3.8, 1.6, 7.6), CFrame.new(0, 1.9, 0), RGB(86, 98, 66))
    add(V(3.4, 1.4, 3.4), CFrame.new(0, 3.3, 0.6), RGB(76, 88, 58))
    add(V(3.2, 0.8, 0.2), CFrame.new(0, 3.4, -1.2), RGB(80, 110, 130), Enum.Material.Glass)
    for _, sx in ipairs({ -1.9, 1.9 }) do
      for _, sz in ipairs({ -2.4, 2.4 }) do add(V(0.7, 1.8, 1.8), CFrame.new(sx, 0.9, sz), RGB(30, 30, 32), Enum.Material.SmoothPlastic) end
    end
    return parts
  end
  local function routeLen()
    local L = 0
    for i = 1, #ROUTE - 1 do
      local a, b = ROUTE[i], ROUTE[i + 1]
      L = L + math.sqrt((b[1] - a[1]) ^ 2 + (b[2] - a[2]) ^ 2)
    end
    return L
  end
  local RL = routeLen()
  local function along(s)   -- 来回走：0..RL 再走回去
    s = s % (RL * 2)
    local back = s > RL
    if back then s = RL * 2 - s end
    for i = 1, #ROUTE - 1 do
      local a, b = ROUTE[i], ROUTE[i + 1]
      local l = math.sqrt((b[1] - a[1]) ^ 2 + (b[2] - a[2]) ^ 2)
      if s <= l then
        local k = s / l
        local dx, dz = b[1] - a[1], b[2] - a[2]
        if back then dx, dz = -dx, -dz end
        return a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, dx, dz
      end
      s = s - l
    end
    local e = ROUTE[#ROUTE]
    return e[1], e[2], 0, 1
  end
  local function place(parts, cf)
    for _, q in ipairs(parts) do q.p.CFrame = cf * q.off end
  end
  -- 战斗机一圈（秒）：停 18 → 滑跑 7 → 爬升飞走 20 → 看不见 15 → 从战场那边反向进场 24 → 落地减速 6 → 滑到停机位 2 → 掉头 3 → 停
  --   （南边湖后面是雪山，不从那边进场）
  local UP = V(0, 1, 0)
  local ROLL_A = (62 - 4) / 6
  local ROLL_END = 205 - (62 * 6 - 0.5 * ROLL_A * 36)   -- 落地滑跑停在离停机位多远
  local JET_T = 18 + 7 + 20 + 15 + 24 + 6 + 2 + 3 + 6
  local function jetPose(s, t)
    local cf0 = s.cf0
    local P0, F = cf0.Position, cf0.LookVector
    local function at(d, h, pitch, back)
      local pos = P0 + F * d + UP * h
      return CFrame.lookAt(pos, pos + (back and -F or F)) * CFrame.Angles(pitch or 0, 0, 0)
    end
    if t < 18 then return at(0, 0) end
    t = t - 18
    if t < 7 then   -- 滑跑：加速，最后两秒抬头离地
      local lift = (t > 5.4) and (t - 5.4) ^ 2 * 2.6 or 0
      return at(0.5 * 8.6 * t * t, lift, math.rad(10) * math.clamp((t - 5) / 2, 0, 1))
    end
    t = t - 7
    if t < 20 then   -- 爬升，越飞越快，飞向战场那边
      return at(210 + 60 * t + 1.5 * t * t, 6.7 + 170 * (1 - math.exp(-t / 6)), math.rad(12) * math.exp(-t / 5))
    end
    t = t - 20
    if t < 15 then return nil end   -- 飞远了
    t = t - 15
    if t < 24 then   -- 从战场那边下滑进场，机头朝南对准跑道北头
      local k = t / 24
      return at(1800 - 1595 * k, 260 * (1 - k) ^ 1.3, math.rad(3), true)
    end
    t = t - 24
    if t < 6 then   -- 落地，减速
      return at(205 - (62 * t - 0.5 * ROLL_A * t * t), 0, math.rad(4) * math.max(0, 1 - t / 1.5), true)
    end
    t = t - 6
    if t < 2 then return at(ROLL_END * (1 - t / 2), 0, 0, true) end   -- 慢慢滑到停机位
    t = t - 2
    if t < 3 then return CFrame.lookAt(P0, P0 - F) * CFrame.Angles(0, math.pi * t / 3, 0) end   -- 原地掉头，机头朝跑道
    return at(0, 0)
  end

  -- 直升机一圈（秒）：停 24 → 旋翼转起来 4 → 升起 5 → 绕一圈 22 → 悬停转回原来的朝向 4 → 落下 5 → 旋翼停 5 → 停
  local HELI_T = 24 + 4 + 5 + 22 + 4 + 5 + 5 + 6
  local function heliPose(s, t)
    local cf0 = s.cf0
    local P0 = cf0.Position
    local rot0 = cf0 - P0
    if t < 24 then return cf0, 0 end
    t = t - 24
    if t < 4 then return cf0, 24 * t / 4 end
    t = t - 4
    if t < 5 then
      local k = t / 5
      return cf0 + UP * (35 * k * k * (3 - 2 * k)), 24
    end
    t = t - 5
    if t < 22 then   -- 绕停机坪北边一个半径 120 的圈，压坡度、低头
      local k = t / 22
      local C = P0 + V(0, 0, 120)
      local phi = math.pi + 2 * math.pi * k
      local pos = C + V(math.sin(phi), 0, math.cos(phi)) * 120 + UP * (35 + 20 * math.sin(math.pi * k))
      local look = CFrame.lookAt(pos, pos + V(math.cos(phi), 0, -math.sin(phi)))
      local side = (look.RightVector:Dot(C - pos) > 0) and -1 or 1
      local cf = look * CFrame.Angles(math.rad(-6), 0, side * math.rad(16) * math.min(1, k * 6, (1 - k) * 6))
      local blend = math.min(1, t / 2, (22 - t) / 2)   -- 头尾两秒从停放的朝向转过去、转回来
      if blend < 1 then cf = (CFrame.new(pos) * rot0):Lerp(cf, math.max(0, blend)) end
      return cf, 24
    end
    t = t - 22
    if t < 4 then return cf0 + UP * 35, 24 end
    t = t - 4
    if t < 5 then
      local k = t / 5
      return cf0 + UP * (35 * (1 - k * k * (3 - 2 * k))), 24
    end
    t = t - 5
    if t < 5 then return cf0, 24 * (1 - t / 5) end
    return cf0, 0
  end

  local function setHidden(s, hide)
    if s.hidden == hide then return end
    s.hidden = hide
    for _, p in ipairs(s.parts) do p.LocalTransparencyModifier = hide and 1 or 0 end
  end
  local function stepShows(dt)
    local now = os.clock()
    local cp = cam.CFrame.Position
    for sm, s in pairs(shows) do
      if not sm.Parent or not s.root.Parent then
        shows[sm] = nil
      elseif not (busy[s.bm] and now < busy[s.bm]) and (s.cf0.Position - cp).Magnitude < 3000 then
        s.t = s.t + dt
        if s.kind == "heli" then
          s.t = s.t % HELI_T
          local cf, spin = heliPose(s, s.t)
          s.root.CFrame = cf
          s.rot = s.rot + spin * dt
          if s.rotor then s.rotor.Transform = CFrame.Angles(0, s.rot, 0) end
          if s.tail then s.tail.Transform = CFrame.fromAxisAngle(s.axis, s.rot * 1.7) end
        else
          s.t = s.t % JET_T
          local cf = jetPose(s, s.t)
          setHidden(s, cf == nil)
          if cf then s.root.CFrame = cf end
        end
      end
    end
  end
  G.shows = shows

  local function stepLife(dt, now)
    local S = G.S
    if not (S and S.origin) then return end
    if not life then
      life = { soldiers = { soldierModel(), soldierModel() }, jeep = jeepModel(), t = 0 }
    end
    life.t = life.t + dt
    local o = S.origin
    for i, sm in ipairs(life.soldiers) do
      local x, z, dx, dz = along(life.t * 5 + i * RL * 0.6)
      local bob = math.abs(math.sin((life.t + i) * 9)) * 0.25
      local p = o + V(x + (i == 1 and -1.5 or 1.5), 1 + bob, z)
      place(sm, CFrame.lookAt(p, p + V(dx, 0, dz)))
    end
    -- 吉普：横路上从西到东再开回来
    local span = 230
    local s = (life.t * 14) % (span * 2)
    local jx = (s < span) and (-115 + s) or (-115 + span * 2 - s)
    local dir = (s < span) and 1 or -1
    local jp = o + V(jx, 1, 64 + dir * 4)   -- 两条车道 z = 60、68（兵营门口操场到 z = 55 为止）
    place(life.jeep, CFrame.lookAt(jp, jp + V(dir, 0, 0)))
  end

  local t, ringT = 0, 0
  function G.stepAnim(dt)
    stepLife(dt)
    stepShows(dt)
    t = t + dt
    ringT = ringT + dt
    local cp = cam.CFrame.Position
    local now = os.clock()
    for p, s in pairs(spinning) do
      if not p.Parent then
        spinning[p] = nil
      elseif not (busy[s.model] and now < busy[s.model]) and (s.cf0.Position - cp).Magnitude < 600 then
        local a = t * s.spd * math.pi * 2
        local r = s.ax and CFrame.fromAxisAngle(s.ax, a) or CFrame.Angles(0, a, 0)
        if s.piv then
          p.CFrame = CFrame.new(s.piv) * r * CFrame.new(-s.piv) * s.cf0
        else
          p.CFrame = CFrame.new(s.cf0.Position) * r * (s.cf0 - s.cf0.Position)
        end
      end
    end
    for p, s in pairs(belts) do
      if not p.Parent then
        for _, it in ipairs(s.items or {}) do
          for _, q in ipairs(it) do q.p:Destroy() end
        end
        belts[p] = nil
      elseif not (busy[s.model] and now < busy[s.model]) and (s.cf0.Position - cp).Magnitude < 450 then
        if not s.items then
          s.items = {}
          for i = 1, s.n do s.items[i] = beltItem(s.item) end
        end
        for i, it in ipairs(s.items) do
          local x = ((t * s.spd + (i - 1) * s.len / s.n) % s.len) - s.len / 2
          local cf = s.cf0 * CFrame.new(x, s.h / 2, 0)
          for _, q in ipairs(it) do q.p.CFrame = cf * q.off end
        end
      end
    end
    for p, s in pairs(nodding) do
      if not p.Parent then
        nodding[p] = nil
      elseif not (busy[s.model] and now < busy[s.model]) and (s.piv - cp).Magnitude < 450 then
        local a = math.sin(t * s.spd * math.pi * 2 + s.ph) * s.amp
        p.CFrame = CFrame.new(s.piv) * CFrame.fromAxisAngle(s.ax, a) * CFrame.new(-s.piv) * s.cf0
      end
    end
    for p, b in pairs(blinking) do
      if not p.Parent then
        blinking[p] = nil
      else
        local on = math.sin((t + b.ph) * b.spd * math.pi * 2) > -0.2
        p.Transparency = on and b.tr0 or 0.85
      end
    end
    local ring = ringT > 2.2
    if ring then ringT = 0 end
    for pad in pairs(pads) do
      if not pad.Parent then
        pads[pad] = nil
      elseif pad.Color == GREEN and (pad.CFrame.Position - cp).Magnitude < 400 then
        pad.Transparency = 0.25 * (0.5 + 0.5 * math.sin(t * 4))
        if ring and G.fxPart then   -- 买得起：冒一圈往外扩的光
          local c = pad.CFrame.Position
          local r = G.fxPart(Enum.PartType.Cylinder, V(0.2, 7, 7), CFrame.new(c.X, c.Y + 0.4, c.Z) * CFrame.Angles(0, 0, math.pi / 2), GREEN, Enum.Material.Neon, 0.35)
          TweenService:Create(r, TweenInfo.new(1), { Size = V(0.2, 16, 16), Transparency = 1 }):Play()
          Debris:AddItem(r, 1.05)
        end
      else
        pad.Transparency = 0
      end
    end
  end
end

return Anim
