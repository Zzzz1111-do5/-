-- 军事大亨（客户端）：战区天气——镜头看着哪个战区的战场，就下那里的天气、换那里的天色（都在本地放，不占网络）：
--   沙漠：贴地吹过的沙尘团、细沙粒，天色发黄；雪原：下雪、风吹雪，天色冷白；
--   城市废墟：飘烟尘和碎屑，灰蒙蒙；火山：落灰、往上飘的火星，天色发红发暗；
--   绿野、基地里：晴天。换地方时两秒左右慢慢过渡
local Lighting = game:GetService("Lighting")

local Weather = {}

function Weather.init(G)
  local V = Vector3.new
  local RGB = Color3.fromRGB
  local NS, NK, CS, NR = NumberSequence.new, NumberSequenceKeypoint.new, ColorSequence.new, NumberRange.new
  local cam = workspace.CurrentCamera
  local SMOKE = "rbxasset://textures/particles/smoke_main.dds"
  local Q = G.mobile and 0.5 or 1   -- 手机上粒子减半

  -- 跟着镜头走的两块发射区（看不见、不碰撞）：上面那块往下落雪、落灰，下面那块吹沙、飘烟、冒火星
  local folder = Instance.new("Folder")
  folder.Name = "ClientWeather"
  folder.Parent = workspace
  local function area(name)
    local p = Instance.new("Part")
    p.Name = name
    p.Anchored = true
    p.CanCollide = false
    p.CanQuery = false
    p.CanTouch = false
    p.CastShadow = false
    p.Transparency = 1
    p.Size = V(200, 1, 200)
    p.Parent = folder
    return p
  end
  local top, low = area("Top"), area("Low")

  -- 各战区的粒子：part 放在哪块、y 相对镜头的高度、rate 满强度时每秒几个
  local FX = {
    desert = {
      { part = low, rate = 16, props = { Texture = SMOKE, Color = CS(RGB(216, 188, 142)), LightInfluence = 0.8,
        Size = NS({ NK(0, 5), NK(1, 14) }), Transparency = NS({ NK(0, 1), NK(0.2, 0.74), NK(0.8, 0.82), NK(1, 1) }),
        Lifetime = NR(5, 7), Speed = NR(22, 34), EmissionDirection = Enum.NormalId.Right, SpreadAngle = Vector2.new(10, 4), Acceleration = V(2, 0.4, 0),
        Rotation = NR(0, 360), RotSpeed = NR(-20, 20) } },
      { part = low, rate = 150, props = { Texture = SMOKE, Color = CS(RGB(202, 170, 122)), LightInfluence = 0.7,
        Size = NS(0.16), Transparency = NS({ NK(0, 1), NK(0.1, 0.3), NK(0.9, 0.4), NK(1, 1) }),
        Lifetime = NR(2, 3), Speed = NR(40, 60), EmissionDirection = Enum.NormalId.Right, SpreadAngle = Vector2.new(5, 8), Acceleration = V(0, -2, 0) } },
    },
    snow = {
      { part = top, rate = 240, props = { Texture = SMOKE, Color = CS(RGB(255, 255, 255)), LightInfluence = 0.5,
        Size = NS(0.42), Transparency = NS({ NK(0, 1), NK(0.06, 0.12), NK(0.9, 0.2), NK(1, 1) }),
        Lifetime = NR(7, 10), Speed = NR(8, 14), EmissionDirection = Enum.NormalId.Bottom, SpreadAngle = Vector2.new(18, 18), Acceleration = V(3, -1, 1.5),
        Rotation = NR(0, 360), RotSpeed = NR(-40, 40) } },
      { part = low, rate = 8, props = { Texture = SMOKE, Color = CS(RGB(240, 246, 255)), LightInfluence = 0.6,
        Size = NS({ NK(0, 4), NK(1, 10) }), Transparency = NS({ NK(0, 1), NK(0.25, 0.84), NK(1, 1) }),
        Lifetime = NR(4, 6), Speed = NR(16, 26), EmissionDirection = Enum.NormalId.Right, SpreadAngle = Vector2.new(8, 4), Acceleration = V(1, 0.3, 0) } },
    },
    urban = {
      { part = low, rate = 7, props = { Texture = SMOKE, Color = CS(RGB(150, 150, 148), RGB(112, 112, 114)), LightInfluence = 0.9,
        Size = NS({ NK(0, 6), NK(1, 18) }), Transparency = NS({ NK(0, 1), NK(0.25, 0.8), NK(1, 1) }),
        Lifetime = NR(8, 12), Speed = NR(3, 6), EmissionDirection = Enum.NormalId.Top, SpreadAngle = Vector2.new(40, 40), Acceleration = V(1.5, 0.6, 0.5),
        Rotation = NR(0, 360), RotSpeed = NR(-10, 10) } },
      { part = top, rate = 45, props = { Texture = SMOKE, Color = CS(RGB(70, 68, 66)), LightInfluence = 1,
        Size = NS(0.28), Transparency = NS({ NK(0, 1), NK(0.1, 0.25), NK(0.9, 0.35), NK(1, 1) }),
        Lifetime = NR(6, 9), Speed = NR(2, 5), EmissionDirection = Enum.NormalId.Bottom, SpreadAngle = Vector2.new(30, 30), Acceleration = V(2, -0.6, 1),
        Rotation = NR(0, 360), RotSpeed = NR(-90, 90) } },
    },
    volcano = {
      { part = top, rate = 170, props = { Texture = SMOKE, Color = CS(RGB(74, 70, 68)), LightInfluence = 1,
        Size = NS(0.34), Transparency = NS({ NK(0, 1), NK(0.08, 0.2), NK(0.9, 0.3), NK(1, 1) }),
        Lifetime = NR(8, 11), Speed = NR(4, 8), EmissionDirection = Enum.NormalId.Bottom, SpreadAngle = Vector2.new(20, 20), Acceleration = V(1.2, -0.8, 0.6),
        Rotation = NR(0, 360), RotSpeed = NR(-60, 60) } },
      { part = low, rate = 55, props = { Texture = SMOKE, Color = CS(RGB(255, 170, 70), RGB(255, 70, 24)), LightEmission = 1, LightInfluence = 0,
        Size = NS({ NK(0, 0.28), NK(1, 0.06) }), Transparency = NS({ NK(0, 0), NK(0.7, 0.2), NK(1, 1) }),
        Lifetime = NR(3, 5), Speed = NR(6, 12), EmissionDirection = Enum.NormalId.Top, SpreadAngle = Vector2.new(30, 30), Acceleration = V(0.8, 3, 0.4) } },
    },
  }
  -- 下面那块离镜头多低：火山的火星从下面往上飘
  local LOWY = { desert = -4, snow = -6, urban = -10, volcano = -28 }
  for _, list in pairs(FX) do
    for _, e in ipairs(list) do
      local pe = Instance.new("ParticleEmitter")
      pe.Enabled = false
      pe.Rate = 0
      for k, v in pairs(e.props) do pe[k] = v end
      pe.Parent = e.part
      e.pe = pe
    end
  end

  -- 天色：雾（Atmosphere）、调色、云
  local SKY = {
    desert = { aC = RGB(214, 186, 140), aD = RGB(176, 128, 82), haze = 2.4, dens = 0.38, glare = 0.5, tint = RGB(255, 236, 208), sat = 0.04, bri = 0.03, con = 0.08, cover = 0.25, cloud = RGB(255, 246, 232) },
    snow = { aC = RGB(222, 232, 246), aD = RGB(168, 186, 212), haze = 2.0, dens = 0.42, glare = 0.2, tint = RGB(228, 238, 255), sat = -0.08, bri = 0.06, con = 0.06, cover = 0.75, cloud = RGB(236, 240, 246) },
    urban = { aC = RGB(172, 172, 170), aD = RGB(108, 108, 112), haze = 2.6, dens = 0.38, glare = 0.1, tint = RGB(236, 236, 240), sat = -0.22, bri = -0.01, con = 0.12, cover = 0.7, cloud = RGB(200, 200, 204) },
    volcano = { aC = RGB(150, 92, 72), aD = RGB(92, 40, 28), haze = 2.8, dens = 0.44, glare = 0.3, tint = RGB(255, 214, 192), sat = 0, bri = -0.04, con = 0.14, cover = 0.85, cloud = RGB(92, 82, 80) },
  }
  local base = nil
  local atm, cc, clouds
  local function grab()
    atm = Lighting:FindFirstChildOfClass("Atmosphere")
    cc = Lighting:FindFirstChildOfClass("ColorCorrectionEffect")
    clouds = workspace.Terrain:FindFirstChildOfClass("Clouds")
    if atm and cc and not base then
      base = { aC = atm.Color, aD = atm.Decay, haze = atm.Haze, dens = atm.Density, glare = atm.Glare, tint = cc.TintColor, sat = cc.Saturation, bri = cc.Brightness, con = cc.Contrast,
        cover = clouds and clouds.Cover or 0.5, cloud = clouds and clouds.Color or RGB(250, 250, 252) }
    end
  end

  -- 镜头看着哪个战区：镜头所在的地方、视线落到地面的地方，有一个在某块战场（加一圈边）上就算
  local function theaterAt(p)
    for _, rootName in ipairs({ "Plots", "Arenas" }) do
      local r = workspace:FindFirstChild(rootName)
      if r then
        for _, f in ipairs(r:GetChildren()) do
          local th = f:GetAttribute("Theater")
          local fld = th and th ~= "grass" and f:FindFirstChild("Field")
          if fld then
            local lp = fld.CFrame:PointToObjectSpace(p)
            if math.abs(lp.X) < fld.Size.X / 2 + 90 and math.abs(lp.Z) < fld.Size.Z / 2 + 90 then return th end
          end
        end
      end
    end
    return nil
  end
  local function lookTheater()
    local cf = cam.CFrame
    local p = cf.Position
    local th = theaterAt(p)
    if th then return th end
    local lv = cf.LookVector
    if lv.Y < -0.05 then
      local t = math.min(1500, p.Y / -lv.Y)
      return theaterAt(p + lv * t)
    end
    return nil
  end

  local cur, w, want = nil, 0, nil
  local checkT, appliedKey = 0, nil
  local baseClock = nil   -- 夜战前的时间（打完放回去）
  function G.stepWeather(dt)
    checkT = checkT - dt
    if checkT <= 0 then
      checkT = 0.4
      want = lookTheater()
    end
    -- 换战区：先淡出旧的，再淡入新的
    if want ~= cur then
      w = math.max(0, w - dt * 0.6)
      if w <= 0 then cur = want end
    elseif cur then
      w = math.min(1, w + dt * 0.5)
    end
    -- 粒子：发射区跟着镜头（在视线前方一点）
    local cf = cam.CFrame
    local fl = V(cf.LookVector.X, 0, cf.LookVector.Z)
    fl = (fl.Magnitude > 0.01) and fl.Unit or V(0, 0, -1)
    local c0 = cf.Position + fl * 45
    top.CFrame = CFrame.new(c0 + V(0, 45, 0))
    low.CFrame = CFrame.new(c0 + V(0, LOWY[cur] or -6, 0))
    for th, list in pairs(FX) do
      local k = (th == cur) and w or 0
      for _, e in ipairs(list) do
        local on = k > 0.02
        if e.pe.Enabled ~= on then e.pe.Enabled = on end
        if on then e.pe.Rate = e.rate * k * Q end
      end
    end
    -- 天色（没变就不改）
    local k = cur and w or 0
    local key = tostring(cur) .. string.format("%.3f", k) .. tostring(G.skyEvent)   -- 战况（大雾、夜战）也算在里面
    if key == appliedKey then return end
    if not base then grab() end
    if not base then return end
    appliedKey = key
    local s = SKY[cur] or base
    atm.Color = base.aC:Lerp(s.aC, k)
    atm.Decay = base.aD:Lerp(s.aD, k)
    atm.Haze = base.haze + (s.haze - base.haze) * k
    atm.Density = base.dens + (s.dens - base.dens) * k
    atm.Glare = base.glare + (s.glare - base.glare) * k
    cc.TintColor = base.tint:Lerp(s.tint, k)
    cc.Saturation = base.sat + (s.sat - base.sat) * k
    cc.Brightness = base.bri + (s.bri - base.bri) * k
    cc.Contrast = base.con + (s.con - base.con) * k
    if clouds then
      clouds.Cover = base.cover + (s.cover - base.cover) * k
      clouds.Color = base.cloud:Lerp(s.cloud, k)
    end
    -- 战况：大雾雾气浓；夜战天黑（打完把时间放回去）
    local ev = G.skyEvent
    if ev == "fog" then
      atm.Density = math.min(0.9, atm.Density + 0.32)
      atm.Haze = atm.Haze + 3
    end
    if ev == "night" then
      if not baseClock then baseClock = Lighting.ClockTime end
      Lighting.ClockTime = 21.6
      cc.Brightness = cc.Brightness - 0.03
    elseif baseClock then
      Lighting.ClockTime = baseClock
      baseClock = nil
    end
  end
  function G.weatherNow() return cur, w end
end

return Weather
