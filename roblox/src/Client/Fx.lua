-- 军事大亨（客户端）：特效——开火曳光、炮口火光、炮弹 / 火箭弹弧线、导弹（跟着目标飞）、炸弹、拦截炮把炮弹打爆在半空、爆炸、建成、楼顶冒钱；
-- 支援技能（飞机掠过、治疗光圈、空投）、补给箱金币、震屏、音效（默认用 Roblox 自带的声音变调）；都在本地画，不占网络
local TweenService = game:GetService("TweenService")
local Debris = game:GetService("Debris")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")

local Fx = {}

function Fx.init(G)
  local Config = G.Config
  local V = Vector3.new
  local RGB = Color3.fromRGB
  local cam = workspace.CurrentCamera
  local BALL = Enum.PartType.Ball
  local CYL = Enum.PartType.Cylinder
  local FLAT = CFrame.Angles(0, 0, math.pi / 2)   -- 圆柱立起来（贴地的圈）
  local me = Players.LocalPlayer

  local FXF = Instance.new("Folder")
  FXF.Name = "ClientFx"
  FXF.Parent = workspace
  G.fxFolder = FXF

  local function part(shape, size, cf, color, mat, tr)
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
  G.fxPart = part
  local function tween(o, t, props, style, dir)
    local tw = TweenService:Create(o, TweenInfo.new(t, style or Enum.EasingStyle.Quad, dir or Enum.EasingDirection.Out), props)
    tw:Play()
    return tw
  end
  G.tween = tween

  -- 音效：Config.Sounds 里填了 ID 就用自己的；没填用 Roblox 自带的（rbxasset://sounds/ 里现在只有爆炸、落地、滑块、哎哟这几个，
  -- 爆炸声调快了就是枪声、炮声）：{ 声音, 音量, 最慢, 最快 }；同一时间别放太多
  local EXP = "rbxasset://sounds/impact_explosion_03.mp3"
  local TICK = "rbxasset://sounds/volume_slider.ogg"
  local SND = {
    boom = { EXP, 0.8, 0.85, 1.05 }, cannon = { EXP, 0.5, 1.3, 1.5 }, rocket = { EXP, 0.36, 1.7, 2.0 },
    aa = { EXP, 0.16, 2.6, 3.0 }, rifle = { EXP, 0.12, 2.9, 3.3 }, gun = { EXP, 0.22, 2.6, 3.0 },
    build = { "rbxasset://sounds/action_jump_land.mp3", 1, 0.55, 0.65 }, click = { TICK, 0.5, 1.15, 1.15 },
    buy = { TICK, 0.7, 1.5, 1.5 }, coin = { TICK, 0.8, 2.0, 2.2 }, hit = { TICK, 0.55, 2.5, 2.7 }, kill = { EXP, 0.45, 2.1, 2.3 },
    hurt = { "rbxasset://sounds/ouch.ogg", 0.45, 1, 1.1 }, win = { TICK, 0.8, 1.6, 1.6 }, lose = { TICK, 0.8, 0.8, 0.8 }, alarm = { TICK, 0.9, 0.6, 0.6 },
  }
  local soundT, soundN = 0, 0
  function G.playSound(name, pos, speed)
    local custom = Config.Sounds and Config.Sounds[name]
    local def = SND[name]
    if (not custom or custom == "") and not def then return end
    local now = os.clock()
    if now - soundT > 0.1 then
      soundT = now
      soundN = 0
    end
    soundN = soundN + 1
    if soundN > 7 then return end
    local snd = Instance.new("Sound")
    if custom and custom ~= "" then
      snd.SoundId = custom
      snd.Volume = 0.6
    else
      snd.SoundId = def[1]
      snd.Volume = def[2]
      snd.PlaybackSpeed = speed or (def[3] + (def[4] - def[3]) * math.random())
    end
    snd.RollOffMinDistance = 30
    snd.RollOffMaxDistance = 1500
    if pos then
      if (pos - cam.CFrame.Position).Magnitude > 1500 then
        snd:Destroy()
        return
      end
      local p = part(nil, V(0.2, 0.2, 0.2), CFrame.new(pos), RGB(0, 0, 0), Enum.Material.SmoothPlastic, 1)
      snd.Parent = p
      snd:Play()
      Debris:AddItem(p, 5)
    else
      snd.Parent = SoundService   -- 界面音效：不分远近
      snd:Play()
      Debris:AddItem(snd, 5)
    end
  end
  -- 一串音：胜利升调、失败降调、警报
  function G.jingle(kind)
    local seq = (kind == "win") and { 1.2, 1.5, 1.9, 2.4 } or (kind == "lose") and { 1.0, 0.8, 0.62 } or { 0.6, 0.9, 0.6, 0.9 }
    task.spawn(function()
      for _, sp in ipairs(seq) do
        G.playSound((kind == "win" or kind == "lose") and kind or "alarm", nil, sp)
        task.wait(0.13)
      end
    end)
  end

  -- 震屏：附近的爆炸、开炮叠一点「震动量」，每帧按它晃视线（排在镜头脚本之后）
  local trauma = 0
  function G.shake(a)
    trauma = math.min(1, trauma + a)
  end
  pcall(function()
    RunService:BindToRenderStep("MTShake", Enum.RenderPriority.Last.Value, function(dt)
      if trauma <= 0.002 then return end
      local s = trauma * trauma
      local t = os.clock() * 26
      cam.CFrame = cam.CFrame * CFrame.Angles(math.noise(t, 1.7) * 0.06 * s, math.noise(t, 5.3) * 0.06 * s, math.noise(t, 9.1) * 0.035 * s)
      trauma = math.max(0, trauma - dt * 1.5)
    end)
  end)

  local function flash(p, s)
    local f = part(BALL, V(s, s, s), CFrame.new(p), RGB(255, 222, 140), Enum.Material.Neon, 0)
    tween(f, 0.09, { Transparency = 1, Size = V(s, s, s) * 1.6 })
    Debris:AddItem(f, 0.12)
  end
  G.flash = flash

  local function beam(a, b, w, color, life)
    local len = (b - a).Magnitude
    if len < 0.2 then return end
    local p = part(nil, V(w, w, len), CFrame.lookAt(a, b) * CFrame.new(0, 0, -len / 2), color, Enum.Material.Neon, 0.1)
    tween(p, life, { Transparency = 1 })
    Debris:AddItem(p, life + 0.05)
  end
  G.beam = beam

  local function boom(p, s)
    local dist = (p - cam.CFrame.Position).Magnitude
    if dist < 160 then G.shake(math.clamp((160 - dist) / 160, 0, 1) * 0.45 * math.min(2, s)) end
    local fb = part(BALL, V(5, 5, 5) * s, CFrame.new(p), RGB(255, 175, 70), Enum.Material.Neon, 0.05)
    local light = Instance.new("PointLight")
    light.Color = RGB(255, 170, 90)
    light.Range = 30 * s
    light.Brightness = 3
    light.Parent = fb
    tween(fb, 0.38, { Size = V(16, 16, 16) * s, Transparency = 1 })
    tween(light, 0.38, { Brightness = 0 })
    Debris:AddItem(fb, 0.42)
    local n = (s >= 1) and 3 or 1
    for i = 1, n do   -- 翻滚上升的烟
      local o = V(math.random() - 0.5, 0, math.random() - 0.5) * 6 * s
      local sm = part(BALL, V(6, 6, 6) * s, CFrame.new(p + o), RGB(72, 68, 62), Enum.Material.SmoothPlastic, 0.2)
      tween(sm, 1.5 + i * 0.35, { Size = V(20, 20, 20) * s, Transparency = 1, CFrame = CFrame.new(p + o + V(0, (12 + i * 4) * s, 0)) })
      Debris:AddItem(sm, 1.7 + i * 0.35)
    end
    local ring = part(CYL, V(0.3, 4 * s, 4 * s), CFrame.new(p.X, p.Y - 1, p.Z) * FLAT, RGB(200, 185, 150), Enum.Material.SmoothPlastic, 0.35)
    tween(ring, 0.6, { Size = V(0.3, 28 * s, 28 * s), Transparency = 1 })
    Debris:AddItem(ring, 0.65)
    if s >= 1 then   -- 碎片
      for _ = 1, 6 do
        local d = V(math.random() - 0.5, math.random() * 0.8 + 0.4, math.random() - 0.5).Unit
        local c = part(nil, V(1, 1, 1), CFrame.new(p), RGB(50, 48, 45), Enum.Material.SmoothPlastic, 0)
        tween(c, 0.7, { CFrame = CFrame.new(p + d * 20 * s) * CFrame.Angles(math.random() * 6, math.random() * 6, 0), Transparency = 1 })
        Debris:AddItem(c, 0.75)
      end
    end
  end
  G.boom = boom

  -- 飞行中的弹：抛物线（炮弹、火箭炮火箭弹）、直线（火箭筒、直升机火箭）、导弹（跟着目标的本地复制飞）、炸弹（先平飞再往下掉），每帧更新；
  -- 火箭、导弹到了自己炸（炮弹、炸弹落地的爆炸服务器发）；id 是服务器给的炮弹编号（拦截炮打掉时按它找）
  local flying = {}
  local byId = {}
  local function launch(a, b, dur, arc, kind, id, size)
    local p
    if kind == "shell" then
      local s = size or 1.4
      p = part(BALL, V(s, s, s), CFrame.new(a), RGB(255, 200, 120), Enum.Material.Neon, 0)
    elseif kind == "bomb" then
      p = part(nil, V(1.1, 1.1, 3.4), CFrame.new(a), RGB(62, 64, 60), Enum.Material.Metal, 0)
    elseif kind == "lava" then   -- 火山弹：发光的熔岩块
      p = part(BALL, V(3.4, 3.4, 3.4), CFrame.new(a), RGB(255, 110, 30), Enum.Material.Neon, 0)
      local glow = Instance.new("PointLight")
      glow.Color = RGB(255, 120, 40)
      glow.Range = 22
      glow.Brightness = 3
      glow.Parent = p
    elseif kind == "cruise" then   -- 巡航导弹：粗大的白弹体，尾焰发光
      p = part(nil, V(1.4, 1.4, 7.5), CFrame.new(a), RGB(238, 238, 232), Enum.Material.SmoothPlastic, 0)
      local glow = Instance.new("PointLight")
      glow.Color = RGB(255, 170, 80)
      glow.Range = 40
      glow.Brightness = 4
      glow.Parent = p
    elseif kind == "missile" then
      p = part(nil, V(0.5, 0.5, 3), CFrame.new(a), RGB(236, 236, 230), Enum.Material.SmoothPlastic, 0)
      local glow = Instance.new("PointLight")
      glow.Color = RGB(255, 190, 110)
      glow.Range = 10
      glow.Brightness = 2
      glow.Parent = p
    else
      p = part(nil, V(0.6, 0.6, 3.4), CFrame.new(a), RGB(255, 190, 90), Enum.Material.Neon, 0)
    end
    local f = { p = p, a = a, b = b, t0 = os.clock(), dur = math.max(0.05, dur), arc = arc, kind = kind, puff = 0, id = id }
    table.insert(flying, f)
    if id then byId[id] = f end
    return f
  end
  G.launch = launch
  local function arcPos(f, k)
    local b = f.b
    if f.track then   -- 导弹：盯着目标现在的位置（目标没了就飞到最后看到的地方）
      local r = f.track.root
      if r and r.Parent then
        b = r.CFrame.Position + V(0, f.th or 2, 0)
        f.b = b
      else
        f.track = nil
      end
    end
    if f.kind == "bomb" or f.kind == "lava" then
      local p = f.a:Lerp(b, k)
      return V(p.X, f.a.Y + (b.Y - f.a.Y) * k * k, p.Z)
    end
    return f.a:Lerp(b, k) + V(0, f.arc * 4 * k * (1 - k), 0)
  end
  local stepMinesF = nil
  function G.stepFx()
    local now = os.clock()
    if stepMinesF then stepMinesF() end
    for i = #flying, 1, -1 do
      local f = flying[i]
      local k = (now - f.t0) / f.dur
      if f.dead then
        table.remove(flying, i)
      elseif k >= 1 then
        f.p:Destroy()
        table.remove(flying, i)
        if f.id then byId[f.id] = nil end
        if f.kind == "rocket" then boom(f.b, 0.7) elseif f.kind == "missile" then boom(f.b, 0.9) end
      else
        local pos = arcPos(f, k)
        local ahead = arcPos(f, math.min(1, k + 0.02))
        if (ahead - pos).Magnitude > 0.001 then f.p.CFrame = CFrame.lookAt(pos, ahead) else f.p.CFrame = CFrame.new(pos) end
        f.puff = f.puff + 1
        if f.kind == "cruise" and f.puff % 2 == 0 then   -- 巡航导弹：一道粗白烟，留得久
          local s = part(BALL, V(2.8, 2.8, 2.8), CFrame.new(pos), RGB(220, 216, 210), Enum.Material.SmoothPlastic, 0.25)
          tween(s, 2.8, { Size = V(11, 11, 11), Transparency = 1 })
          Debris:AddItem(s, 2.85)
        elseif f.kind ~= "bomb" and f.kind ~= "cruise" and f.puff % 2 == 0 then   -- 尾烟（火山弹拖着黑烟）
          local s = part(BALL, V(1.6, 1.6, 1.6), CFrame.new(pos), RGB(160, 156, 150), Enum.Material.SmoothPlastic, 0.4)
          tween(s, 1, { Size = V(5, 5, 5), Transparency = 1 })
          Debris:AddItem(s, 1.05)
        end
      end
    end
  end

  -- 导弹发射井：两扇井盖往两边滑开、井口喷一大团白烟，几秒后合上（找离 p 最近的那口井）
  local function siloOpen(p)
    local plots = workspace:FindFirstChild("Plots")
    local silo = nil
    for _, pf in ipairs(plots and plots:GetChildren() or {}) do
      local bf = pf:FindFirstChild("Buildings")
      local s = bf and bf:FindFirstChild("silo")
      local body = s and s:FindFirstChild("Body")
      if body and (V(body.CFrame.Position.X, 0, body.CFrame.Position.Z) - V(p.X, 0, p.Z)).Magnitude < 8 then silo = s end
    end
    if silo then
      for _, d in ipairs(silo:GetChildren()) do
        if d:IsA("BasePart") and (d.Name == "DoorL" or d.Name == "DoorR") then
          local cf0 = d.CFrame
          local dx = (d.Name == "DoorL") and -5.6 or 5.6
          tween(d, 0.7, { CFrame = cf0 + V(dx, 0, 0) })
          task.delay(4.2, function()
            if d.Parent then tween(d, 1.0, { CFrame = cf0 }) end
          end)
        end
      end
    end
    local hole = p + V(-2, 1.4, -3)
    task.delay(0.6, function()
      flash(hole, 5)
      for i = 1, 8 do
        local o = V(math.random() - 0.5, 0, math.random() - 0.5) * 10
        local sm = part(BALL, V(7, 7, 7), CFrame.new(hole + o), RGB(226, 222, 216), Enum.Material.SmoothPlastic, 0.2)
        tween(sm, 2.2 + i * 0.15, { Size = V(24, 24, 24), Transparency = 1, CFrame = CFrame.new(hole + o * 2 + V(0, 10 + i * 3, 0)) })
        Debris:AddItem(sm, 2.5 + i * 0.15)
      end
    end)
    G.playSound("alarm", p, 0.6)
  end

  -- 巡航导弹炸了：大火球、贴地往外扩的冲击波、往上翻滚的火柱和黑烟顶，离得近的震得厉害
  local function bigBoom(p, s)
    boom(p, s)
    local dist = (p - cam.CFrame.Position).Magnitude
    if dist < 900 then G.shake(math.clamp((900 - dist) / 900, 0, 1) * 1.3) end
    local ring = part(CYL, V(0.4, 24, 24), CFrame.new(p.X, p.Y + 0.6, p.Z) * FLAT, RGB(255, 236, 200), Enum.Material.Neon, 0.3)
    tween(ring, 0.9, { Size = V(0.4, 280, 280), Transparency = 1 })
    Debris:AddItem(ring, 0.95)
    for i = 1, 4 do
      local q = p + V(0, i * 7, 0)
      local fb = part(BALL, V(16, 16, 16), CFrame.new(q), RGB(255, 160 - i * 18, 60), Enum.Material.Neon, 0.15)
      tween(fb, 1.6 + i * 0.25, { Size = V(38, 38, 38), Transparency = 1, CFrame = CFrame.new(q + V(0, 34 + i * 12, 0)) })
      Debris:AddItem(fb, 1.9 + i * 0.25)
    end
    local cap = part(BALL, V(30, 30, 30), CFrame.new(p + V(0, 30, 0)), RGB(60, 56, 52), Enum.Material.SmoothPlastic, 0.2)
    tween(cap, 4.5, { Size = V(110, 110, 110), Transparency = 1, CFrame = CFrame.new(p + V(0, 110, 0)) })
    Debris:AddItem(cap, 4.6)
  end
  G.bigBoom = bigBoom

  -- 拦截炮打掉一发炮弹：几道曳光打过去，炮弹在半空炸开
  local function intercept(e)
    local f = e.id and byId[e.id]
    if not f or f.dead then return end
    local k = math.clamp((os.clock() - f.t0) / f.dur, 0, 1)
    local pos = arcPos(f, k)
    f.dead = true
    f.p:Destroy()
    byId[e.id] = nil
    if e.laser then   -- 激光：一道红光，炮弹在半空烧爆
      beam(e.a, pos, 0.5, RGB(255, 70, 60), 0.18)
      beam(e.a, pos, 0.18, RGB(255, 230, 220), 0.12)
    else
      for _ = 1, 3 do
        local j = V(math.random() - 0.5, math.random() - 0.5, math.random() - 0.5) * 3
        beam(e.a, pos + j, 0.2, RGB(255, 226, 130), 0.14)
      end
    end
    flash(e.a, 1.6)
    boom(pos, 0.45)
    G.playSound("aa", e.a)
  end

  -- 爱国者拦截弹道导弹：一枚拦截弹拖着白烟飞上去，拦住了就在半空炸成一团（没拦住就擦过去）
  local function abm(e)
    local f = e.id and byId[e.id]
    if not f or f.dead then return end
    local k = math.clamp((os.clock() - f.t0) / f.dur, 0, 1)
    local pos = arcPos(f, k)
    local fl = launch(e.a, pos + (e.miss and V(30, 20, 0) or V(0, 0, 0)), 0.7, 40, "missile")
    flash(e.a, 2.4)
    G.playSound("rocket", e.a)
    if not e.miss then
      task.delay(0.7, function()
        local k2 = math.clamp((os.clock() - f.t0) / f.dur, 0, 1)
        local p2 = arcPos(f, k2)
        f.dead = true
        if f.p then f.p:Destroy() end
        byId[e.id] = nil
        boom(p2, 2.2)
        G.playSound("boom", p2, 0.7)
      end)
    end
    return fl
  end

  -- 地雷：布雷车撒下的（一块扁扁的雷，中间一颗红灯一闪一闪），踩上就炸
  local mines = {}
  local function mineFx(e)
    if not e.id or typeof(e.p) ~= "Vector3" then return end
    local m = part(CYL, V(0.5, 3.2, 3.2), CFrame.new(e.p.X, e.p.Y + 0.25, e.p.Z) * FLAT, RGB(74, 82, 58), Enum.Material.Metal, 0)
    local dot = part(BALL, V(0.7, 0.7, 0.7), CFrame.new(e.p + V(0, 0.6, 0)), RGB(255, 60, 40), Enum.Material.Neon, 0)
    mines[e.id] = { m, dot, t = os.clock() }
    Debris:AddItem(m, 400)
    Debris:AddItem(dot, 400)
  end
  -- 打完了：剩下的雷都收走
  function G.clearMines()
    for id, m in pairs(mines) do
      for _, p in ipairs(m) do p:Destroy() end
      mines[id] = nil
    end
  end
  local function mineBoom(e)
    local m = e.id and mines[e.id]
    if m then
      for _, p in ipairs(m) do p:Destroy() end
      mines[e.id] = nil
    end
    boom(e.p, 1.4)
    G.playSound("boom", e.p)
  end
  -- 地雷的红灯：一闪一闪（每帧 stepFx 里调）
  local function stepMines()
    local on = (os.clock() % 1) < 0.5
    for id, m in pairs(mines) do
      if not m[2].Parent then
        mines[id] = nil
      else
        m[2].Transparency = on and 0 or 0.85
      end
    end
  end

  stepMinesF = stepMines

  -- 电磁炮：一道粗的蓝白光贯穿过去，路上冒火花
  local function rail(e)
    beam(e.a, e.b, 1.6, RGB(110, 210, 255), 0.4)
    beam(e.a, e.b, 0.45, RGB(235, 250, 255), 0.25)
    flash(e.a, 5)
    local len = (e.b - e.a).Magnitude
    for i = 1, 6 do
      local p = e.a:Lerp(e.b, i / 7) + V(math.random() - 0.5, math.random() - 0.5, math.random() - 0.5) * 2
      local sp = part(BALL, V(1.4, 1.4, 1.4), CFrame.new(p), RGB(160, 230, 255), Enum.Material.Neon, 0.1)
      tween(sp, 0.35, { Size = V(4, 4, 4), Transparency = 1 })
      Debris:AddItem(sp, 0.4)
    end
    local dist = (e.a - cam.CFrame.Position).Magnitude
    if dist < 220 and len > 0 then G.shake(0.25) end
    G.playSound("cannon", e.a)
  end

  -- 单位技能：脚下一圈光（颜色按技能），烟幕再冒一圈烟
  local ABC = { charge = RGB(255, 214, 80), smoke = RGB(200, 200, 196), rapid = RGB(255, 150, 60), barrage = RGB(255, 90, 60), burner = RGB(110, 190, 255) }
  local function abilityFx(e)
    local p, s = e.p, (e.s or 10) + 8
    local ring = part(CYL, V(0.3, s, s), CFrame.new(p.X, p.Y + 0.6, p.Z) * FLAT, ABC[e.id] or RGB(255, 255, 255), Enum.Material.Neon, 0.2)
    tween(ring, 0.7, { Size = V(0.3, s * 3, s * 3), Transparency = 1 })
    Debris:AddItem(ring, 0.75)
    if e.id == "smoke" then
      for i = 1, 8 do
        local a = i / 8 * math.pi * 2
        local q = p + V(math.cos(a) * s * 0.6, 2, math.sin(a) * s * 0.6)
        local sm = part(BALL, V(8, 8, 8), CFrame.new(q), RGB(214, 214, 210), Enum.Material.SmoothPlastic, 0.3)
        tween(sm, (e.dur or 6), { Size = V(22, 22, 22), Transparency = 1, CFrame = CFrame.new(q + V(0, 6, 0)) })
        Debris:AddItem(sm, (e.dur or 6) + 0.1)
      end
    end
    G.playSound("buy", p)
  end

  local SHOT = {
    inf = { w = 0.15, c = RGB(255, 232, 130), life = 0.06, fl = 1.2, snd = "rifle" },
    ifv = { w = 0.3, c = RGB(255, 205, 110), life = 0.07, fl = 2.2, n = 2, hit = 0.35, snd = "aa" },
    tank = { w = 0.7, c = RGB(255, 185, 90), life = 0.12, fl = 5, hit = 0.9, snd = "cannon" },
    boss = { w = 1.1, c = RGB(255, 160, 70), life = 0.14, fl = 7, hit = 1.3, snd = "cannon" },
    aa = { w = 0.28, c = RGB(255, 214, 100), life = 0.07, fl = 1.8, n = 3, snd = "aa" },
    mg = { w = 0.14, c = RGB(255, 232, 130), life = 0.05, fl = 1, n = 2, snd = "rifle" },
    sniper = { w = 0.16, c = RGB(210, 235, 255), life = 0.16, fl = 1.2, snd = "rifle" },
    jeep = { w = 0.2, c = RGB(255, 220, 120), life = 0.06, fl = 1.4, n = 2, snd = "rifle" },
    td = { w = 0.6, c = RGB(255, 185, 90), life = 0.12, fl = 4.5, hit = 0.8, snd = "cannon" },
    breacher = { w = 0.2, c = RGB(255, 220, 120), life = 0.06, fl = 1.2, snd = "rifle" },
    spaag = { w = 0.3, c = RGB(255, 214, 100), life = 0.07, fl = 2, n = 4, snd = "aa" },
    cram = { w = 0.24, c = RGB(255, 236, 160), life = 0.06, fl = 1.6, n = 4, snd = "aa" },
    transport = { w = 0.16, c = RGB(255, 232, 130), life = 0.05, fl = 1, n = 2, snd = "rifle" },
    attacker = { w = 0.45, c = RGB(255, 200, 90), life = 0.1, fl = 3, n = 5, hit = 0.55, spread = 9, snd = "aa" },
    medic = { w = 0.12, c = RGB(255, 236, 150), life = 0.05, fl = 1, snd = "rifle" },
    commando = { w = 0.16, c = RGB(255, 236, 160), life = 0.06, fl = 1.2, n = 2, snd = "rifle" },
    repair = { w = 0.16, c = RGB(255, 232, 130), life = 0.05, fl = 1, n = 2, snd = "rifle" },
    ew = { w = 0.18, c = RGB(255, 226, 120), life = 0.05, fl = 1.2, n = 2, snd = "rifle" },
    heavytank = { w = 0.9, c = RGB(255, 170, 80), life = 0.14, fl = 6.5, hit = 1.1, snd = "cannon" },
    miner = { w = 0.2, c = RGB(255, 220, 120), life = 0.06, fl = 1.2, snd = "rifle" },
  }
  local GUN = {
    rifle = { w = 0.12, c = RGB(255, 236, 150), life = 0.05 },
    smg = { w = 0.1, c = RGB(255, 236, 150), life = 0.04 },
    sniper = { w = 0.22, c = RGB(200, 230, 255), life = 0.18 },
  }
  -- 喷火：一串由大变小的火团从喷口冲到目标，落点冒一团火
  local function flame(a, b)
    local n = 7
    for i = 1, n do
      local k = i / n
      local q = a:Lerp(b, k) + V((math.random() - 0.5) * 2 * k, (math.random() - 0.5) * 2 * k, (math.random() - 0.5) * 2 * k)
      local sz = 1 + 3 * k
      local f = part(BALL, V(sz, sz, sz), CFrame.new(a), (k < 0.4) and RGB(255, 230, 140) or RGB(255, 120 + math.random(0, 50), 30), Enum.Material.Neon, 0.15)
      tween(f, 0.12 + 0.18 * k, { CFrame = CFrame.new(q), Size = V(sz, sz, sz) * 1.5, Transparency = 0.9 })
      Debris:AddItem(f, 0.35)
    end
    local fb = part(BALL, V(4, 4, 4), CFrame.new(b), RGB(255, 140, 40), Enum.Material.Neon, 0.3)
    tween(fb, 0.4, { Size = V(7, 7, 7), Transparency = 1, CFrame = CFrame.new(b + V(0, 3, 0)) })
    Debris:AddItem(fb, 0.45)
  end

  local function shot(e)
    if e.u == "flamer" then
      flame(e.a, e.b)
      if math.random() < 0.3 then G.playSound("rocket", e.a, 0.7) end
      return
    end
    if e.u == "heli" then
      launch(e.a, e.b, 0.45, 0, "rocket")
      flash(e.a, 2)
      G.playSound("rocket", e.a)
      return
    end
    local s = SHOT[e.u] or SHOT.inf
    for i = 1, (s.n or 1) do
      local off = V(0, 0, 0)
      if i > 1 then off = V(math.random() - 0.5, math.random() - 0.5, math.random() - 0.5) * 2 end
      beam(e.a + off, e.b + off, s.w, s.c, s.life)
    end
    flash(e.a, s.fl)
    if s.spread then   -- 攻击机机炮：一溜弹着点
      for _ = 1, 3 do boom(e.b + V((math.random() - 0.5) * s.spread * 2, 0, (math.random() - 0.5) * s.spread * 2), s.hit) end
    elseif s.hit then
      boom(e.b, s.hit)
    end
    G.playSound(s.snd, e.a)
  end

  -- 玩家开枪（别人的；自己的在开枪那一刻就画了）
  function G.gunFx(id, a, b, flight)
    if id == "rpg" then
      launch(a, b, flight or 0.5, 0, "rocket")
      flash(a, 1.4)
      G.playSound("rocket", a)
      return
    end
    local s = GUN[id] or GUN.rifle
    beam(a, b, s.w, s.c, s.life)
    flash(a, 0.7)
    G.playSound("gun", a)
  end

  local function buildFx(p, s)
    local ring = part(CYL, V(0.4, s * 0.5, s * 0.5), CFrame.new(p.X, 1.2, p.Z) * FLAT, RGB(220, 210, 180), Enum.Material.SmoothPlastic, 0.2)
    tween(ring, 0.9, { Size = V(0.4, s * 1.8, s * 1.8), Transparency = 1 })
    Debris:AddItem(ring, 1)
    for i = 1, 8 do
      local a = i / 8 * math.pi * 2
      local q = p + V(math.cos(a) * s * 0.5, 1, math.sin(a) * s * 0.5)
      local sm = part(BALL, V(4, 4, 4), CFrame.new(q), RGB(200, 192, 170), Enum.Material.SmoothPlastic, 0.3)
      tween(sm, 1.2, { Size = V(9, 9, 9), Transparency = 1, CFrame = CFrame.new(q + V(0, 5, 0)) })
      Debris:AddItem(sm, 1.3)
    end
    local sp = part(BALL, V(2, 2, 2), CFrame.new(p + V(0, 4, 0)), RGB(255, 225, 120), Enum.Material.Neon, 0.1)
    tween(sp, 0.6, { Size = V(s, s, s) * 0.8, Transparency = 1 })
    Debris:AddItem(sp, 0.65)
    G.playSound("build", p)
  end

  -- 楼顶冒出来的「+$5」
  function G.popText(p, str, color)
    local anchor = part(nil, V(0.2, 0.2, 0.2), CFrame.new(p), RGB(0, 0, 0), Enum.Material.SmoothPlastic, 1)
    local bb = Instance.new("BillboardGui")
    bb.Size = UDim2.new(8, 0, 2, 0)
    bb.LightInfluence = 0
    bb.MaxDistance = 240
    bb.AlwaysOnTop = true
    bb.Parent = anchor
    local t = Instance.new("TextLabel")
    t.Size = UDim2.fromScale(1, 1)
    t.BackgroundTransparency = 1
    t.Text = str
    t.TextColor3 = color
    t.TextStrokeTransparency = 0.3
    t.Font = Enum.Font.GothamBold
    t.TextScaled = true
    t.Parent = bb
    tween(bb, 1.6, { StudsOffsetWorldSpace = V(0, 6, 0) })
    tween(t, 1.6, { TextTransparency = 1, TextStrokeTransparency = 1 }, Enum.EasingStyle.Quad, Enum.EasingDirection.In)
    Debris:AddItem(anchor, 1.7)
  end

  -- 支援：飞机从 a 直线飞到 b（t 秒），jet 是三角翼喷气机、heli 是直升机；身后一串烟
  local function flyover(e)
    local base0 = CFrame.lookAt(e.a, e.b)
    local base1 = CFrame.lookAt(e.b, e.b + (e.b - e.a).Unit)
    local parts = {}
    local function add(size, rel, color, mat, shape, tr)
      local p = part(shape, size, base0 * rel, color, mat or Enum.Material.Metal, tr or 0)
      table.insert(parts, { p = p, rel = rel })
      return p
    end
    if e.heli then
      add(V(3.4, 3.2, 11), CFrame.new(), RGB(66, 74, 56))
      add(V(1, 1, 9), CFrame.new(0, 0.6, 9), RGB(66, 74, 56))
      add(V(0.2, 26, 26), CFrame.new(0, 2.2, 0) * FLAT, RGB(30, 30, 30), Enum.Material.SmoothPlastic, CYL, 0.55)
    else
      add(V(3.2, 2.4, 30), CFrame.new(), RGB(72, 78, 88))
      add(V(34, 0.6, 10), CFrame.new(0, -0.2, 3), RGB(64, 70, 80))
      add(V(12, 0.5, 4), CFrame.new(0, 0.2, 13), RGB(64, 70, 80))
      add(V(0.5, 5, 5), CFrame.new(0, 2.6, 12), RGB(64, 70, 80))
      add(V(1.6, 1.6, 1.2), CFrame.new(0, 0, 15.4), RGB(255, 170, 80), Enum.Material.Neon, BALL)
    end
    local dur = e.t or 4
    for _, q in ipairs(parts) do
      tween(q.p, dur, { CFrame = base1 * q.rel }, Enum.EasingStyle.Linear, Enum.EasingDirection.InOut)
      Debris:AddItem(q.p, dur + 0.1)
    end
    G.playSound(e.heli and "aa" or "rocket", e.a:Lerp(e.b, 0.5), e.heli and 0.5 or 0.6)
    task.spawn(function()
      local t0 = os.clock()
      while os.clock() - t0 < dur do
        local k = (os.clock() - t0) / dur
        local q = e.a:Lerp(e.b, k)
        local sm = part(BALL, V(3, 3, 3), CFrame.new(q), RGB(200, 200, 196), Enum.Material.SmoothPlastic, 0.45)
        tween(sm, 1.4, { Size = V(9, 9, 9), Transparency = 1 })
        Debris:AddItem(sm, 1.5)
        task.wait(0.12)
      end
    end)
  end
  -- 战地急救：绿色光圈扩开、几颗绿光往上飘
  local function healFx(p, r)
    local ring = part(CYL, V(0.4, 6, 6), CFrame.new(p.X, p.Y + 0.6, p.Z) * FLAT, RGB(90, 255, 140), Enum.Material.Neon, 0.25)
    tween(ring, 0.8, { Size = V(0.4, r * 2, r * 2), Transparency = 1 })
    Debris:AddItem(ring, 0.85)
    for _ = 1, 14 do
      local q = p + V((math.random() - 0.5) * r * 1.4, 1, (math.random() - 0.5) * r * 1.4)
      local g = part(BALL, V(1.4, 1.4, 1.4), CFrame.new(q), RGB(120, 255, 160), Enum.Material.Neon, 0.1)
      tween(g, 1.2, { CFrame = CFrame.new(q + V(0, 14, 0)), Transparency = 1 })
      Debris:AddItem(g, 1.25)
    end
    G.playSound("coin", p, 1.6)
  end
  -- 空投：尘土圈、白色降落伞缩小消失
  local function dropFx(p)
    local chute = part(BALL, V(10, 4, 10), CFrame.new(p + V(0, 16, 0)), RGB(236, 236, 230), Enum.Material.Fabric, 0.1)
    tween(chute, 1.2, { CFrame = CFrame.new(p + V(0, 3, 0)), Size = V(2, 1, 2), Transparency = 1 })
    Debris:AddItem(chute, 1.25)
    local ring = part(CYL, V(0.3, 4, 4), CFrame.new(p.X, p.Y + 0.4, p.Z) * FLAT, RGB(196, 180, 140), Enum.Material.SmoothPlastic, 0.3)
    tween(ring, 0.7, { Size = V(0.3, 22, 22), Transparency = 1 })
    Debris:AddItem(ring, 0.75)
  end
  -- 金币：一把金色硬币往上蹦、转着消失
  local function coinsFx(p)
    for _ = 1, 10 do
      local d = V(math.random() - 0.5, 0, math.random() - 0.5)
      local c = part(CYL, V(0.25, 1.3, 1.3), CFrame.new(p) * CFrame.Angles(0, math.random() * 6, math.pi / 2), RGB(255, 210, 60), Enum.Material.Neon, 0)
      tween(c, 0.9, { CFrame = CFrame.new(p + d * 10 + V(0, 8 + math.random() * 6, 0)) * CFrame.Angles(math.random() * 6, math.random() * 6, 0), Transparency = 1 })
      Debris:AddItem(c, 0.95)
    end
    G.playSound("coin", p)
  end

  function G.onFx(list)
    if type(list) ~= "table" then return end
    local cp = cam.CFrame.Position
    for _, e in ipairs(list) do
      local at = e.a or e.p
      if typeof(at) == "Vector3" and (at - cp).Magnitude < 2200 then   -- 太远的（别人的战场）不画
        if e.k == "shot" then
          shot(e)
        elseif e.k == "gun" then
          if e.by ~= me.UserId then G.gunFx(e.w, e.a, e.b, e.t) end
        elseif e.k == "shell" then
          local small = e.u == "mortar"
          launch(e.a, e.b, e.t or 2, (e.b - e.a).Magnitude * 0.28, "shell", e.id, small and 0.9 or (e.u == "heavyarty" and 1.8 or 1.4))
          flash(e.a, small and 1.6 or 4)
          G.playSound("cannon", e.a)
        elseif e.k == "mrocket" then
          launch(e.a, e.b, e.t or 3, (e.b - e.a).Magnitude * 0.22, "mrocket", e.id)
          flash(e.a, 3)
          G.playSound("rocket", e.a)
        elseif e.k == "bomb" then
          launch(e.a, e.b, e.t or 2, 0, (e.u == "lava") and "lava" or "bomb", e.id)
        elseif e.k == "quake" then   -- 火山弹预警：地上一圈红光闪几下
          for i = 0, 2 do
            task.delay(i * 0.45, function()
              local r = part(CYL, V(0.3, (e.s or 30) * 2, (e.s or 30) * 2), CFrame.new(e.p.X, e.p.Y + 0.5, e.p.Z) * FLAT, RGB(255, 60, 30), Enum.Material.Neon, 0.35)
              tween(r, 0.4, { Transparency = 1 })
              Debris:AddItem(r, 0.45)
            end)
          end
          G.playSound("alarm", e.p, 0.5)
          G.shake(0.25)
        elseif e.k == "missile" then
          local f = launch(e.a, e.b, e.t or 1, (e.b - e.a).Magnitude * 0.06, "missile")
          local tr = e.bid and G.visByBid and G.visByBid(e.bid)
          if tr then
            f.track = tr
            f.th = tr.h3
          end
          flash(e.a, 1.6)
          G.playSound("rocket", e.a)
        elseif e.k == "intercept" then
          intercept(e)
        elseif e.k == "gshell" then   -- 空中炮艇：炮弹从天上直直地砸下来
          launch(e.a, e.b, e.t or 1.4, 0, "shell", e.id, 1.3)
          flash(e.a, 3)
          G.playSound("cannon", e.a, 0.8)
        elseif e.k == "ballistic" then   -- 弹道导弹：高高抛起来，拖一道粗白烟
          launch(e.a, e.b, e.t or 6.5, 320, "cruise", e.id)
          flash(e.a, 7)
          G.playSound("rocket", e.a, 0.6)
          G.playSound("alarm", e.b, 0.5)
        elseif e.k == "abm" then
          abm(e)
        elseif e.k == "rail" then
          rail(e)
        elseif e.k == "laser" then
          beam(e.a, e.b, 0.45, RGB(255, 70, 60), 0.12)
          beam(e.a, e.b, 0.15, RGB(255, 230, 220), 0.08)
          flash(e.b, 1.2)
          G.playSound("aa", e.a, 1.4)
        elseif e.k == "mine" then
          mineFx(e)
        elseif e.k == "mineboom" then
          mineBoom(e)
        elseif e.k == "swarm" then   -- 蜂群：发射箱一阵白烟
          for _ = 1, 3 do
            local o = V(math.random() - 0.5, 0, math.random() - 0.5) * 6
            local sm = part(BALL, V(4, 4, 4), CFrame.new(e.p + o), RGB(226, 222, 216), Enum.Material.SmoothPlastic, 0.3)
            tween(sm, 1.2, { Size = V(12, 12, 12), Transparency = 1, CFrame = CFrame.new(e.p + o + V(0, 8, 0)) })
            Debris:AddItem(sm, 1.25)
          end
          G.playSound("rocket", e.p)
        elseif e.k == "ability" then
          abilityFx(e)
        elseif e.k == "boom" then
          boom(e.p, e.s or 1)
          G.playSound("boom", e.p)
        elseif e.k == "bigboom" then
          bigBoom(e.p, e.s or 3.6)
          G.playSound("boom", e.p, 0.6)
        elseif e.k == "silo" then
          siloOpen(e.p)
        elseif e.k == "cruise" then
          launch(e.a, e.b, e.t or 5, (e.b - e.a).Magnitude * 0.45, "cruise", e.id)
          flash(e.a, 6)
          G.playSound("rocket", e.a, 0.7)
        elseif e.k == "build" then
          buildFx(e.p, e.s or 20)
        elseif e.k == "flyover" and typeof(e.b) == "Vector3" then
          flyover(e)
        elseif e.k == "heal" then
          healFx(e.p, e.s or 60)
        elseif e.k == "drop" then
          dropFx(e.p)
        elseif e.k == "coins" then
          coinsFx(e.p)
        elseif e.k == "jam" then   -- 电子干扰：导弹偏掉，冒一圈紫光
          local ring = part(CYL, V(0.2, 3, 3), CFrame.new(e.p) * FLAT, RGB(170, 110, 255), Enum.Material.Neon, 0.2)
          tween(ring, 0.5, { Size = V(0.2, 18, 18), Transparency = 1 })
          Debris:AddItem(ring, 0.55)
          G.popText(e.p, "干扰", RGB(190, 140, 255))
        end
      end
    end
  end
end

return Fx
