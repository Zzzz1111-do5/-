-- 军事大亨（客户端）：特效——开火曳光、炮口火光、炮弹 / 火箭弹弧线、导弹（跟着目标飞）、炸弹、拦截炮把炮弹打爆在半空、爆炸、建成、楼顶冒钱；
-- 都在本地画，不占网络
local TweenService = game:GetService("TweenService")
local Debris = game:GetService("Debris")
local Players = game:GetService("Players")

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

  -- 音效（Config.Sounds 里填了 ID 才放；同一时间别放太多）
  local soundT, soundN = 0, 0
  function G.playSound(name, pos)
    local id = Config.Sounds and Config.Sounds[name]
    if not id or id == "" then return end
    local now = os.clock()
    if now - soundT > 0.1 then
      soundT = now
      soundN = 0
    end
    soundN = soundN + 1
    if soundN > 6 then return end
    local p = part(nil, V(0.2, 0.2, 0.2), CFrame.new(pos or cam.CFrame.Position), RGB(0, 0, 0), Enum.Material.SmoothPlastic, 1)
    local snd = Instance.new("Sound")
    snd.SoundId = id
    snd.Volume = 0.6
    snd.RollOffMaxDistance = 1500
    snd.Parent = p
    snd:Play()
    Debris:AddItem(p, 5)
  end

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
    if f.kind == "bomb" then
      local p = f.a:Lerp(b, k)
      return V(p.X, f.a.Y + (b.Y - f.a.Y) * k * k, p.Z)
    end
    return f.a:Lerp(b, k) + V(0, f.arc * 4 * k * (1 - k), 0)
  end
  function G.stepFx()
    local now = os.clock()
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
        if f.kind ~= "bomb" and f.puff % 2 == 0 then   -- 尾烟
          local s = part(BALL, V(1.6, 1.6, 1.6), CFrame.new(pos), RGB(160, 156, 150), Enum.Material.SmoothPlastic, 0.4)
          tween(s, 1, { Size = V(5, 5, 5), Transparency = 1 })
          Debris:AddItem(s, 1.05)
        end
      end
    end
  end

  -- 拦截炮打掉一发炮弹：几道曳光打过去，炮弹在半空炸开
  local function intercept(e)
    local f = e.id and byId[e.id]
    if not f or f.dead then return end
    local k = math.clamp((os.clock() - f.t0) / f.dur, 0, 1)
    local pos = arcPos(f, k)
    f.dead = true
    f.p:Destroy()
    byId[e.id] = nil
    for _ = 1, 3 do
      local j = V(math.random() - 0.5, math.random() - 0.5, math.random() - 0.5) * 3
      beam(e.a, pos + j, 0.2, RGB(255, 226, 130), 0.14)
    end
    flash(e.a, 1.6)
    boom(pos, 0.45)
    G.playSound("aa", e.a)
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
  }
  local GUN = {
    rifle = { w = 0.12, c = RGB(255, 236, 150), life = 0.05 },
    smg = { w = 0.1, c = RGB(255, 236, 150), life = 0.04 },
    sniper = { w = 0.22, c = RGB(200, 230, 255), life = 0.18 },
  }
  local function shot(e)
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
          launch(e.a, e.b, e.t or 2, 0, "bomb", e.id)
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
        elseif e.k == "boom" then
          boom(e.p, e.s or 1)
          G.playSound("boom", e.p)
        elseif e.k == "build" then
          buildFx(e.p, e.s or 20)
        end
      end
    end
  end
end

return Fx
