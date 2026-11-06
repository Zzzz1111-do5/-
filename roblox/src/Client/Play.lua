-- 军事大亨（客户端）：操作和镜头——
--   free 在基地里走 / 战场上自己当兵（Roblox 默认镜头）；deploy 布阵（俯瞰自己的部署区，点部队、点位置）；
--   battle 俯瞰战场；drive 开车 / 开直升机 / 开喷气机（追尾镜头，本地算位置，20 次 / 秒发给服务器）。
--   拿枪：按住左键连发（狙击枪、火箭筒一下一发），R 换弹；手机点屏幕开火
--   支援技能：点技能键（或按 Z X V B N），地上出现范围圈跟着鼠标，左键放下（手机点一下战场），右键 / Esc 取消
--   战斗事件：命中标记、飘伤害数字、连杀播报、战报滚动条、首领来袭、结算评星
local Players = game:GetService("Players")
local UIS = game:GetService("UserInputService")
local PPS = game:GetService("ProximityPromptService")

local Play = {}

function Play.init(G)
  local Config = G.Config
  local UNITS = Config.Units
  local F = Config.Field
  local V = Vector3.new
  local RGB = Color3.fromRGB
  local player = Players.LocalPlayer
  local cam = workspace.CurrentCamera
  local ui = G.ui
  local RA, RShoot, RDrive = G.R.Action, G.R.Shoot, G.R.Drive
  local mouse = player:GetMouse()
  local XMAX = F.width / 2 - 6
  local ZMIN, ZMAX = F.center - F.length / 2 + 5, F.center + F.length / 2 - 5
  local JX, JZ0, JZ1 = F.width / 2 + 160, ZMIN - 200, ZMAX + 200   -- 喷气机能飞的范围（和服务器 Battle 一样）
  G.mode = "free"

  local function wrap(a)
    return (a + math.pi) % (2 * math.pi) - math.pi
  end

  local controls = nil
  task.spawn(function()
    local ok, res = pcall(function()
      local pm = require(player:WaitForChild("PlayerScripts"):WaitForChild("PlayerModule", 15))
      return pm:GetControls()
    end)
    if ok then controls = res end
  end)

  ---------------------------------------------------------------- 镜头

  local orbit = { yaw = 0, pitch = math.rad(52), dist = 520, focus = V(0, 0, 0), origin = V(0, 0, 0) }
  local camCF = nil
  local rotating = false

  local hl = nil
  local ghostP = nil
  local function deselect()
    G.sel = nil
    if hl then
      hl:Destroy()
      hl = nil
    end
    if ghostP then ghostP.Transparency = 1 end
    G.updateButtons()
  end

  function G.setMode(m)
    G.mode = m
    local S = G.S
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
      if m == "drive" then
        if controls then controls:Enable() end
      else
        if controls then controls:Disable() end
      end
      if m == "deploy" then
        orbit.origin = S and S.origin or V(0, 0, 0)
        orbit.focus = orbit.origin + V(0, 0, (F.deploy[1] + F.deploy[2]) / 2 + 100)
        orbit.yaw, orbit.pitch, orbit.dist = 0, math.rad(55), 520
      elseif m == "battle" then
        local b = G.battle
        orbit.origin = b and b.origin or (S and S.origin) or V(0, 0, 0)
        orbit.focus = orbit.origin + V(0, 0, F.center)
        orbit.yaw = (b and b.team == 2) and math.pi or 0
        orbit.pitch, orbit.dist = math.rad(48), 900
      end
    end
    PPS.Enabled = (m == "free")   -- 布阵、俯瞰、开车时别误触建筑旁的 E 提示
    deselect()
    G.updateButtons()
  end

  function G.toggleDeploy()
    if G.mode == "deploy" then
      G.setMode("free")
    elseif G.S then
      if G.S.n == 0 then G.toast("还没有部队：先盖兵营，再在右边「兵工厂」生产", "info") end
      G.setMode("deploy")
    end
  end
  function G.toggleOverview()
    if not G.battle then return end
    if G.mode == "battle" then G.setMode("free") else G.setMode("battle") end
  end

  ---------------------------------------------------------------- 布阵

  local rayParams = RaycastParams.new()
  rayParams.FilterType = Enum.RaycastFilterType.Include
  local function myField()
    local S = G.S
    if not S then return nil end
    local plotsF = workspace:FindFirstChild("Plots")
    local p = plotsF and plotsF:FindFirstChild("Plot" .. tostring(S.plot))
    return p and p:FindFirstChild("Field")
  end
  local function cast(x, y, viewport)
    local list = { G.unitFolder }
    local field = myField()
    if field then table.insert(list, field) end
    rayParams.FilterDescendantsInstances = list
    local ray
    if viewport then ray = cam:ViewportPointToRay(x, y) else ray = cam:ScreenPointToRay(x, y) end
    return workspace:Raycast(ray.Origin, ray.Direction * 5000, rayParams)
  end
  local function inDeploy(x, z)
    return z >= F.deploy[1] and z <= F.deploy[2] and math.abs(x) <= F.width / 2 - 8
  end

  local function selectModel(clone)
    deselect()
    local uid = clone:GetAttribute("Uid")
    if not uid then return end
    G.sel = { clone = clone, uid = uid, t = clone:GetAttribute("Type") }
    hl = G.mk("Highlight", { FillColor = RGB(255, 220, 80), FillTransparency = 0.55, OutlineColor = RGB(255, 240, 160), OutlineTransparency = 0, DepthMode = Enum.HighlightDepthMode.AlwaysOnTop }, clone)
    local def = UNITS[G.sel.t]
    if def then ui.sellBtn.Text = "解散 +$" .. Config.Fmt(math.floor(def.price * 0.5)) end
    G.updateButtons()
  end
  function G.sellSelected()
    if G.sel then
      RA:FireServer("sell", G.sel.uid)
      deselect()
    end
  end

  local function clickAt(x, y)
    if G.mode ~= "deploy" or not G.S or G.S.battle then return end
    local res = cast(x, y, false)
    if not res then return end
    local m = res.Instance:FindFirstAncestorOfClass("Model")
    if m and m:GetAttribute("Uid") and m:GetAttribute("Owner") == player.UserId and not m:GetAttribute("Dead") then
      if G.sel and G.sel.clone == m then deselect() else selectModel(m) end
      return
    end
    if not G.sel then
      G.toast("先点一下自己的部队，再点要放的位置", "info")
      return
    end
    local rel = res.Position - G.S.origin
    if not inDeploy(rel.X, rel.Z) then
      G.toast("只能摆在蓝色的部署区里", "bad")
      return
    end
    RA:FireServer("move", G.sel.uid, rel.X, rel.Z)
    deselect()
  end

  local function ghostUpdate()
    if G.mode ~= "deploy" or not G.sel or G.mobile or not G.S then
      if ghostP then ghostP.Transparency = 1 end
      return
    end
    if not ghostP then ghostP = G.fxPart(Enum.PartType.Cylinder, V(0.3, 8, 8), CFrame.new(), RGB(90, 220, 120), Enum.Material.Neon, 1) end
    local mp = UIS:GetMouseLocation()
    local res = cast(mp.X, mp.Y, true)
    if not res or res.Instance.Name ~= "Field" then
      ghostP.Transparency = 1
      return
    end
    local rel = res.Position - G.S.origin
    local def = UNITS[G.sel.t]
    local d = (def and def.size or 8) + 2
    ghostP.Size = V(0.3, d, d)
    ghostP.CFrame = CFrame.new(res.Position.X, 1.2, res.Position.Z) * CFrame.Angles(0, 0, math.pi / 2)
    ghostP.Color = inDeploy(rel.X, rel.Z) and RGB(90, 220, 120) or RGB(230, 80, 70)
    ghostP.Transparency = 0.45
  end

  ---------------------------------------------------------------- 瞄准点

  local aimParams = RaycastParams.new()
  aimParams.FilterType = Enum.RaycastFilterType.Exclude
  -- 电脑：鼠标指着的地方；手机（或开车时的手机）：屏幕中间的准星
  local function aimPoint(skip)
    local ex = { G.fxFolder }
    if player.Character then table.insert(ex, player.Character) end
    if skip then table.insert(ex, skip) end
    aimParams.FilterDescendantsInstances = ex
    local ray
    if G.mobile then
      local vs = cam.ViewportSize
      ray = cam:ViewportPointToRay(vs.X / 2, vs.Y / 2)
    else
      local mp = UIS:GetMouseLocation()
      ray = cam:ViewportPointToRay(mp.X, mp.Y)
    end
    local res = workspace:Raycast(ray.Origin, ray.Direction * 3000, aimParams)
    if res then return res.Position end
    return ray.Origin + ray.Direction * 3000
  end

  ---------------------------------------------------------------- 开车

  local function moveVector()
    if controls then
      local ok, mv = pcall(function() return controls:GetMoveVector() end)
      if ok and typeof(mv) == "Vector3" then return mv end
    end
    local x, z = 0, 0
    if UIS:IsKeyDown(Enum.KeyCode.W) or UIS:IsKeyDown(Enum.KeyCode.Up) then z = z - 1 end
    if UIS:IsKeyDown(Enum.KeyCode.S) or UIS:IsKeyDown(Enum.KeyCode.Down) then z = z + 1 end
    if UIS:IsKeyDown(Enum.KeyCode.D) or UIS:IsKeyDown(Enum.KeyCode.Right) then x = x + 1 end
    if UIS:IsKeyDown(Enum.KeyCode.A) or UIS:IsKeyDown(Enum.KeyCode.Left) then x = x - 1 end
    return V(x, 0, z)
  end

  local function startDrive(ev)
    local m = nil
    for sm in pairs(G.vis or {}) do
      if sm.Parent and sm:GetAttribute("BU") == ev.bid then m = sm end
    end
    if not m then   -- 本地还没这辆车的模型：别让服务器以为在开（角色会一直藏着），直接下车
      RA:FireServer("exit")
      G.toast("这辆车还没加载出来，过一秒再试", "info")
      return
    end
    local root = m:FindFirstChild("Root")
    local o = ev.origin or (G.battle and G.battle.origin) or V(0, 0, 0)
    local p = root.CFrame.Position - o
    local lv = root.CFrame.LookVector
    local h = math.atan2(-lv.X, -lv.Z)
    local def = UNITS[ev.t]
    G.drive = { bid = ev.bid, t = ev.t, origin = o, x = p.X, z = p.Z, y = def.air and math.max(def.alt, p.Y - 1) or 0, h = h, ty = 0, spd = def.speed, roll = 0,
      camYaw = h, camPitch = math.rad(def.air and 20 or 16), sendT = 0, nextFire = os.clock() + (ev.cd or 0), firing = false, model = m, clone = G.cloneOf(m) }
    G.drive.cf = root.CFrame
    G.setMode("drive")
    ui.cross.Visible = true
    ui.fireBtn.Visible = G.mobile
    ui.upBtn.Visible = G.mobile and def.air == true
    ui.downBtn.Visible = G.mobile and def.air == true
    local tip
    if def.jet then
      tip = G.mobile and "摇杆左右转弯、上下加减速，按住「升高」「降低」调高度，转镜头瞄准，按「开火」" or "W / S 加减速，A / D 转弯，空格升高、C 降低，鼠标瞄准、按住左键开火"
      if def.bombs then tip = tip .. "；轰炸机按一下扔一串炸弹（落在飞机前方）" end
    else
      tip = (G.mobile and "摇杆开车，转镜头瞄准，按「开火」" or "WASD 开车，鼠标瞄准，按住左键开火，右键拖动转镜头") ..
        (def.air and (G.mobile and "，按住「升高」「降低」调高度" or "，空格升高、C 降低") or "")
      if def.cargo then tip = tip .. (G.mobile and "；降到最低（按住「降低」）自动放下步兵" or "；降到最低（按住 C）自动放下步兵") end
    end
    G.toast(tip .. (G.mobile and "；下车点「下车」" or "；下车按 F"), "info")
  end

  local function stopDrive()
    G.drive = nil
    ui.cross.Visible = false
    ui.fireBtn.Visible = false
    ui.upBtn.Visible = false
    ui.downBtn.Visible = false
    if G.mode == "drive" then G.setMode("free") end
  end

  local function driveStep(dt)
    local dr = G.drive
    if not dr then return end
    local def = UNITS[dr.t]
    local mv = moveVector()
    if not rotating then dr.camYaw = dr.camYaw + wrap(dr.h - dr.camYaw) * math.min(1, dt * ((def.air and not def.jet) and 0 or 1.5)) end
    if def.jet then   -- 喷气机：一直往前飞，W / S 加减速，A / D 转弯（压坡度），空格 / C 升降
      dr.spd = math.clamp(dr.spd + (-mv.Z) * def.speed * 0.8 * dt, def.speed * 0.6, def.speed * 1.15)
      dr.h = dr.h - mv.X * def.turn * 1.2 * dt
      dr.roll = dr.roll + (-mv.X * 0.8 - dr.roll) * math.min(1, dt * 4)
      dr.x = dr.x - math.sin(dr.h) * dr.spd * dt
      dr.z = dr.z - math.cos(dr.h) * dr.spd * dt
      if UIS:IsKeyDown(Enum.KeyCode.Space) or dr.climb == 1 then dr.y = math.min(220, dr.y + 40 * dt) end
      if UIS:IsKeyDown(Enum.KeyCode.C) or UIS:IsKeyDown(Enum.KeyCode.LeftControl) or dr.climb == -1 then dr.y = math.max(40, dr.y - 40 * dt) end
    elseif def.air then
      local yaw = dr.camYaw
      local fwd, right = V(-math.sin(yaw), 0, -math.cos(yaw)), V(math.cos(yaw), 0, -math.sin(yaw))
      local move = right * mv.X + fwd * (-mv.Z)
      if move.Magnitude > 1 then move = move.Unit end
      dr.x = dr.x + move.X * def.speed * dt
      dr.z = dr.z + move.Z * def.speed * dt
      if UIS:IsKeyDown(Enum.KeyCode.Space) or dr.climb == 1 then dr.y = math.min(150, dr.y + 30 * dt) end
      if UIS:IsKeyDown(Enum.KeyCode.C) or UIS:IsKeyDown(Enum.KeyCode.LeftControl) or dr.climb == -1 then dr.y = math.max(def.cargo and 6 or 15, dr.y - 30 * dt) end
      dr.h = dr.h + wrap(yaw - dr.h) * math.min(1, dt * 3)
    else
      local throttle = -mv.Z
      dr.h = dr.h - mv.X * 1.4 * dt
      local sp = def.speed * 1.1 * throttle
      dr.x = dr.x - math.sin(dr.h) * sp * dt
      dr.z = dr.z - math.cos(dr.h) * sp * dt
    end
    if def.jet then
      dr.x = math.clamp(dr.x, -JX, JX)
      dr.z = math.clamp(dr.z, JZ0, JZ1)
    else
      dr.x = math.clamp(dr.x, -XMAX, XMAX)
      dr.z = math.clamp(dr.z, ZMIN, ZMAX)
    end
    local aim = aimPoint(dr.clone)
    dr.aim = aim
    local rel = aim - dr.origin
    if def.turret then dr.ty = wrap(math.atan2(-(rel.X - dr.x), -(rel.Z - dr.z)) - dr.h) end
    dr.cf = CFrame.new(dr.origin + V(dr.x, 1 + dr.y, dr.z)) * CFrame.Angles(0, dr.h, 0) * CFrame.Angles(0, 0, dr.roll)
    dr.sendT = dr.sendT + dt
    local fire = nil
    local now = os.clock()
    if dr.firing and now >= dr.nextFire then
      fire = aim
      dr.nextFire = now + (def.bombs and def.rate * 0.5 or def.rate)
    end
    if dr.sendT >= 0.05 or fire then
      dr.sendT = 0
      RDrive:FireServer({ x = dr.x, z = dr.z, h = dr.h, y = dr.y, ty = dr.ty, fire = fire })
    end
    -- 追尾镜头
    local pos = dr.cf.Position
    local back, up = def.size * 1.5 + 22, def.size * 0.6 + 9
    local yaw, pitch = dr.camYaw, dr.camPitch
    local look = V(-math.sin(yaw) * math.cos(pitch), -math.sin(pitch), -math.cos(yaw) * math.cos(pitch))
    local want = CFrame.lookAt(pos - look * back + V(0, up, 0), pos + look * 30 + V(0, up * 0.4, 0))
    camCF = camCF and camCF:Lerp(want, 1 - math.exp(-dt * 10)) or want
    cam.CFrame = camCF
  end

  ---------------------------------------------------------------- 拿枪

  local gun = { id = nil, tool = nil, nextShot = 0, firing = false }
  local ammo = {}
  local function ammoOf(id)
    local w = Config.Weapons[id]
    local a = ammo[id]
    if not a then
      a = { n = w.mag, r = 0 }
      ammo[id] = a
    end
    if a.r > 0 and os.clock() >= a.r then
      a.n = w.mag
      a.r = 0
    end
    return a
  end
  local shotParams = RaycastParams.new()
  shotParams.FilterType = Enum.RaycastFilterType.Exclude
  local function tryFire()
    local id, tool = gun.id, gun.tool
    local char = player.Character
    if not id or not tool or not char or G.drive then return end
    local w = Config.Weapons[id]
    local a = ammoOf(id)
    local now = os.clock()
    if a.r > 0 or now < gun.nextShot then return end
    if a.n <= 0 then
      a.r = now + w.reload
      return
    end
    local head = char:FindFirstChild("Head")
    local handle = tool:FindFirstChild("Handle")
    if not head or not handle then return end
    gun.nextShot = now + w.rate
    a.n = a.n - 1
    if a.n <= 0 then a.r = now + w.reload end
    local aim = aimPoint()
    if G.mobile and mouse.Hit then aim = mouse.Hit.Position end
    local dir = aim - head.Position
    if dir.Magnitude < 0.5 then return end
    shotParams.FilterDescendantsInstances = { char, G.fxFolder }
    local res = workspace:Raycast(head.Position, dir.Unit * w.range, shotParams)
    local endP = res and res.Position or (head.Position + dir.Unit * w.range)
    local mz = handle:FindFirstChild("Muzzle")
    local muzzle = mz and mz.WorldPosition or head.Position
    G.gunFx(id, muzzle, endP, w.proj and ((endP - muzzle).Magnitude / w.speed) or nil)
    RShoot:FireServer(id, aim)
  end
  local function reload()
    local id = gun.id
    if not id then return end
    local w = Config.Weapons[id]
    local a = ammoOf(id)
    if a.r > 0 or a.n >= w.mag then return end
    a.r = os.clock() + w.reload
    RA:FireServer("reload", id)
  end
  local function onChar(char)
    task.spawn(function()
      local hum = char:WaitForChild("Humanoid", 10)
      if not hum then return end
      local last, lastT = hum.Health, 0
      hum.HealthChanged:Connect(function(h)
        if h < last - 4 and G.battle and os.clock() - lastT > 0.35 then
          lastT = os.clock()
          G.playSound("hurt")
        end
        last = h
      end)
    end)
    char.ChildAdded:Connect(function(c)
      if c:IsA("Tool") and c:GetAttribute("Weapon") then
        gun.id, gun.tool = c:GetAttribute("Weapon"), c
        c.Activated:Connect(function()
          if G.mobile then tryFire() end
        end)
      end
    end)
    char.ChildRemoved:Connect(function(c)
      if c == gun.tool then
        gun.id, gun.tool, gun.firing = nil, nil, false
      end
    end)
  end
  player.CharacterAdded:Connect(onChar)
  if player.Character then onChar(player.Character) end

  local function ammoHud()
    local dr = G.drive
    if dr then   -- 开车：显示还要装填几秒
      local def = UNITS[dr.t]
      local left = dr.nextFire - os.clock()
      ui.ammo.Visible = true
      ui.reloadBar.Visible = false
      ui.ammo.Text = def.name .. ((left > 0.05) and string.format("  装填 %.1f 秒", left) or "  可以开火")
      return
    end
    if not gun.id then
      ui.ammo.Visible = false
      ui.reloadBar.Visible = false
      return
    end
    local w = Config.Weapons[gun.id]
    local a = ammoOf(gun.id)
    ui.ammo.Visible = true
    if a.r > 0 then
      ui.ammo.Text = w.name .. "  换弹中…"
      ui.reloadBar.Visible = true
      ui.reloadBar.Size = UDim2.fromOffset(260 * math.clamp(1 - (a.r - os.clock()) / w.reload, 0, 1), 4)
    else
      ui.ammo.Text = w.name .. "  " .. a.n .. " / " .. w.mag .. (G.mobile and "" or "   R 换弹")
      ui.reloadBar.Visible = false
    end
  end

  ---------------------------------------------------------------- 支援技能

  G.aim = nil
  local aimRing, aimStrip = nil, nil
  local aimTipShown = false
  -- 屏幕上一点对应的战场地面（战场顶面 y = 原点 + 1 的平面）
  local function groundPoint(x, y, viewport)
    local B = G.battle
    if not B or not B.origin then return nil end
    local ray = viewport and cam:ViewportPointToRay(x, y) or cam:ScreenPointToRay(x, y)
    if math.abs(ray.Direction.Y) < 1e-4 then return nil end
    local t = (B.origin.Y + 1 - ray.Origin.Y) / ray.Direction.Y
    if t <= 0 or t > 6000 then return nil end
    return ray.Origin + ray.Direction * t
  end
  function G.toggleAim(id)
    if G.aim == id then
      G.aim = nil
      return
    end
    local sk = Config.SkillById[id]
    if not sk or not G.battle or not (G.skillHave and G.skillHave[id]) then return end
    local left = (G.skillReady[id] or 0) - os.clock()
    if left > 0 then
      G.toast("「" .. sk.name .. "」还要冷却 " .. math.ceil(left) .. " 秒", "info")
      return
    end
    G.aim = id
    if not aimTipShown then
      aimTipShown = true
      G.toast(G.mobile and "点战场上的位置放下「" .. sk.name .. "」（再点一次技能键取消）" or "左键点战场放下「" .. sk.name .. "」，右键或 Esc 取消（俯瞰战场更好瞄）", "info")
    end
  end
  local function castAt(x, y, viewport)
    local id = G.aim
    if not id then return false end
    local p = groundPoint(x, y, viewport)
    if not p then return true end
    local rel = p - G.battle.origin
    RA:FireServer("skill", id, rel.X, rel.Z)
    G.skillReady[id] = os.clock() + Config.SkillById[id].cd   -- 先在本地进入冷却，服务器放了会再确认
    G.aim = nil
    return true
  end
  local function aimUpdate()
    local sk = G.aim and Config.SkillById[G.aim]
    if sk and not G.battle then G.aim, sk = nil, nil end
    if not aimRing then
      aimRing = G.fxPart(Enum.PartType.Cylinder, V(0.3, 10, 10), CFrame.new(), RGB(255, 200, 70), Enum.Material.Neon, 1)
      aimStrip = G.fxPart(nil, V(20, 0.3, 100), CFrame.new(), RGB(255, 120, 60), Enum.Material.Neon, 1)
    end
    aimRing.Transparency, aimStrip.Transparency = 1, 1
    if not sk then return end
    local mp = G.mobile and (cam.ViewportSize / 2) or UIS:GetMouseLocation()
    local p = groundPoint(mp.X, mp.Y, true)
    if not p then return end
    if sk.kind == "strike" then
      local dir = (G.battle.team == 2) and -1 or 1
      aimStrip.Size = V(22, 0.3, sk.len)
      aimStrip.CFrame = CFrame.new(p.X, p.Y + 0.4, p.Z) * CFrame.Angles(0, (dir < 0) and math.pi or 0, 0)
      aimStrip.Transparency = 0.5
    else
      local r = sk.r or 14
      aimRing.Size = V(0.3, r * 2, r * 2)
      aimRing.Color = (sk.kind == "heal") and RGB(90, 255, 140) or ((sk.kind == "drop") and RGB(120, 190, 255) or RGB(255, 200, 70))
      aimRing.CFrame = CFrame.new(p.X, p.Y + 0.4, p.Z) * CFrame.Angles(0, 0, math.pi / 2)
      aimRing.Transparency = 0.5
    end
  end
  local KEYSK = {}
  for _, sk in ipairs(Config.Skills) do KEYSK[Enum.KeyCode[sk.key]] = sk.id end

  ---------------------------------------------------------------- 战斗事件

  -- 连杀：4 秒内接着亲手击毁算连杀
  local streak, lastKill = 0, 0
  local STREAK = { [2] = "双杀！", [3] = "三杀！", [4] = "四杀！", [5] = "五杀！" }
  local function onKill(ev)
    local now = os.clock()
    streak = (now - lastKill < 4) and (streak + 1) or 1
    lastKill = now
    if streak >= 2 then G.announce(STREAK[streak] or "超神！", RGB(255, 120, 70), nil, 1.2) end
    local def = UNITS[ev.t]
    G.feedLine("你击毁了 <font color=\"#FF8A80\">敌方" .. (def and def.name or (ev.hero and "玩家" or "单位")) .. "</font>", RGB(255, 226, 120))
  end

  G.battle = nil
  local function counterTip(enemy)
    if not enemy then return "多造一些兵再来" end
    local function n(...)
      local s = 0
      for _, t in ipairs({ ... }) do s = s + (enemy[t] or 0) end
      return s
    end
    if n("stealth") > 0 then return "敌方有隐身轰炸机：只有爱国者和战斗机打得到它" end
    if n("drone", "fighter", "bomber") > 0 then return "敌方有高空的飞机（无人机 / 战斗机 / 轰炸机）：带弹炮防空车、爱国者、单兵防空组，或者自己的战斗机" end
    if n("loiter") > 0 then return "敌方有巡飞弹：一头撞上来专炸坦克，带防空车、步战车早点把它打下来" end
    if n("ew") > 0 then return "敌方有电子战车：导弹容易被干扰偏掉，多用坦克炮、火炮，或者先端掉它" end
    if n("heavytank") > 0 then return "敌方有重型坦克：反坦克导弹组、武装直升机、攻击机、巡飞弹专克它" end
    if n("heli", "transport", "attacker") > 0 then return "敌方有直升机 / 攻击机：带上防空车、步战车、单兵防空组，或者多带步兵" end
    if n("tank", "boss", "td", "breacher") >= 2 then return "敌方装甲多：武装直升机、反坦克导弹组、突击炮、攻击机专克装甲，火箭筒也行" end
    if n("cram") > 0 then return "敌方有拦截炮：炮弹、火箭弹会被打下来，用坦克、攻击机去端掉它" end
    if n("arty", "mlrs", "howitzer", "heavyarty", "mortar") > 0 then return "敌方有炮兵：别把步兵挤成一团；拦截炮能挡炮弹，开快车冲上去端掉它" end
    if n("sniper") > 0 then return "敌方有狙击手：用迫击炮、火炮、机枪车压制，你本人也小心" end
    return "多造一些兵再来，或者升级军工科技"
  end

  function G.onBattle(ev)
    if type(ev) ~= "table" then return end
    if ev.phase == "start" then
      ui.result.Visible = false
      ui.closeModals()
      G.battle = { origin = ev.origin, team = ev.team or 1, mode = ev.mode, title = ev.title or "", t0 = os.clock(), len = ev.time or Config.BattleTime,
        enemy = G.S and G.S.enemy }
      ui.bInfo.Text = ""
      G.skillReady = {}
      G.aim = nil
      streak = 0
      G.setMode("free")
      if ev.boss then
        G.announce("首领来袭！", RGB(255, 90, 70), "第 " .. tostring(ev.level) .. " 关 · 猛犸重坦——血极厚，集中火力、用支援技能", 2.6)
        G.jingle("alarm")
        G.shake(0.5)
      else
        G.announce("开战！", RGB(255, 214, 90), ev.title, 1.4)
      end
      G.toast("你本人也在战场上：拿起枪（物品栏 1）、点「开车 / 开飞机」，下面的支援技能点一下再点战场就放", "info")
    elseif ev.phase == "tick" then
      if G.battle then G.battle.t0 = os.clock() - (ev.t or 0) end
      ui.bInfo.Text = "<font color=\"#7CFC8A\">我方 " .. tostring(ev.a) .. "</font>      <font color=\"#FF8A80\">敌方 " .. tostring(ev.e) .. "</font>"
      for _, f in ipairs(ev.feed or {}) do
        local def = UNITS[f.t]
        local nm = def and def.name or "单位"
        if f.en and not f.me then
          G.feedLine("击毁 <font color=\"#FF8A80\">敌方" .. nm .. "</font>", RGB(220, 230, 240))
          if f.t == "boss" then G.announce("首领被击毁！", RGB(255, 214, 90), nil, 1.8) end
        elseif not f.en and f.mine then
          G.feedLine("<font color=\"#FF8A80\">我方" .. nm .. " 被击毁</font>", RGB(255, 140, 130))
        end
      end
    elseif ev.phase == "hit" then
      if typeof(ev.p) == "Vector3" then
        G.popText(ev.p, (ev.k and "击毁 " or "") .. "-" .. tostring(ev.d), ev.k and RGB(255, 200, 60) or RGB(255, 255, 255))
      end
      G.hitMarker(ev.k)
      G.playSound(ev.k and "kill" or "hit")
      if ev.k then onKill(ev) end
    elseif ev.phase == "theater" then
      G.announce("进入新战区：" .. tostring(ev.name), RGB(120, 220, 255), ev.desc, 3.2)
      G.jingle("win")
    elseif ev.phase == "skill" then
      G.skillReady[ev.id] = os.clock() + (ev.cd or 0)
      G.playSound("buy")
    elseif ev.phase == "hero" then
      ui.rejoinBtn.Visible = (not ev.alive) and G.battle ~= nil and G.drive == nil
    elseif ev.phase == "drive" then
      startDrive(ev)
    elseif ev.phase == "exit" then
      stopDrive()
    elseif ev.phase == "end" then
      local enemy = G.battle and G.battle.enemy
      G.battle = nil
      G.aim = nil
      stopDrive()
      ui.rejoinBtn.Visible = false
      if G.mode == "battle" then G.setMode("free") end
      local win = ev.result == "win"
      ui.resTitle.Text = win and "胜利！" or ((ev.result == "timeout") and "时间到" or "失败")
      ui.resTitle.TextColor3 = win and RGB(255, 214, 90) or RGB(240, 110, 100)
      ui.resStars.Text = ev.stars and (string.rep("★", ev.stars) .. string.rep("☆", 3 - ev.stars)) or ""
      local lines = {}
      if ev.record then table.insert(lines, "新纪录！最高打到第 " .. tostring(ev.level) .. " 关") end
      if ev.text then table.insert(lines, ev.text) end
      local rewardLine = nil
      if win and (ev.reward or 0) > 0 then
        table.insert(lines, "")
        rewardLine = #lines
      elseif not win and ev.mode == "pve" then
        table.insert(lines, counterTip(enemy))
      end
      if (ev.pk or 0) > 0 then table.insert(lines, "你亲手击毁 " .. tostring(ev.pk) .. " 个敌方单位") end
      if (ev.lostN or 0) > 0 then
        local parts = {}
        for _, t in ipairs(Config.UnitOrder) do
          local n = ev.lost and ev.lost[t]
          if n then table.insert(parts, UNITS[t].name .. "×" .. n) end
        end
        table.insert(lines, "损失：" .. table.concat(parts, "  "))
      elseif ev.mode ~= "duel" then
        table.insert(lines, "一个都没损失！")
      end
      local function rewardText(v)
        return "奖励 $" .. Config.Fmt(v) .. ((ev.mode == "pve") and ("，下一关：第 " .. tostring(ev.level) .. " 关") or "")
      end
      if rewardLine then lines[rewardLine] = rewardText(0) end
      ui.resBody.Text = table.concat(lines, "\n")
      ui.result.Visible = true
      G.jingle(win and "win" or "lose")
      if win then G.announce("胜利！", RGB(255, 214, 90), ev.stars and (string.rep("★", ev.stars) .. string.rep("☆", 3 - ev.stars)) or nil, 1.6) end
      -- 奖励数字滚上去
      if rewardLine then
        task.spawn(function()
          local t0 = os.clock()
          while ui.result.Visible do
            local k = math.min(1, (os.clock() - t0) / 0.9)
            lines[rewardLine] = rewardText(math.floor(ev.reward * k * (2 - k)))
            ui.resBody.Text = table.concat(lines, "\n")
            if k >= 1 then break end
            task.wait(0.03)
          end
        end)
      end
    end
    G.updateButtons()
  end

  ---------------------------------------------------------------- 输入

  UIS.InputBegan:Connect(function(input, gp)
    if input.UserInputType == Enum.UserInputType.MouseButton2 and G.aim then
      G.aim = nil   -- 右键取消技能瞄准
      return
    end
    if input.UserInputType == Enum.UserInputType.MouseButton2 and G.mode ~= "free" then
      rotating = true
      UIS.MouseBehavior = Enum.MouseBehavior.LockCurrentPosition
    end
    if gp then return end
    if input.KeyCode == Enum.KeyCode.Escape and G.aim then
      G.aim = nil
      return
    end
    local skk = KEYSK[input.KeyCode]
    if skk and G.battle then
      G.toggleAim(skk)
      return
    end
    if input.UserInputType == Enum.UserInputType.MouseButton1 then
      if G.aim and G.battle then
        castAt(input.Position.X, input.Position.Y, false)
      elseif G.mode == "deploy" then
        clickAt(input.Position.X, input.Position.Y)
      elseif G.drive then
        G.drive.firing = true
      elseif gun.id then
        gun.firing = true
        tryFire()
      end
    elseif input.KeyCode == Enum.KeyCode.F and G.drive then
      RA:FireServer("exit")
    elseif input.KeyCode == Enum.KeyCode.R and gun.id then
      reload()
    end
  end)
  UIS.InputEnded:Connect(function(input)
    if input.UserInputType == Enum.UserInputType.MouseButton2 then
      rotating = false
      if G.mode ~= "free" then UIS.MouseBehavior = Enum.MouseBehavior.Default end
    elseif input.UserInputType == Enum.UserInputType.MouseButton1 then
      gun.firing = false
      if G.drive then G.drive.firing = false end
    end
  end)
  UIS.InputChanged:Connect(function(input, gp)
    if G.mode == "free" then return end
    if input.UserInputType == Enum.UserInputType.MouseMovement and rotating then
      if G.drive then
        G.drive.camYaw = G.drive.camYaw - input.Delta.X * 0.008
        G.drive.camPitch = math.clamp(G.drive.camPitch + input.Delta.Y * 0.005, -0.1, 1.2)
      else
        orbit.yaw = orbit.yaw - input.Delta.X * 0.008
        orbit.pitch = math.clamp(orbit.pitch + input.Delta.Y * 0.006, 0.25, 1.45)
      end
    elseif input.UserInputType == Enum.UserInputType.MouseWheel and not gp and not G.drive then
      orbit.dist = math.clamp(orbit.dist * (1 - 0.12 * input.Position.Z), 80, 1600)
    end
  end)
  UIS.TouchTap:Connect(function(positions, gp)
    if gp then return end
    local p = positions[1]
    if not p then return end
    if G.aim and G.battle then
      castAt(p.X, p.Y, false)
    else
      clickAt(p.X, p.Y)
    end
  end)
  local pan0 = nil
  UIS.TouchPan:Connect(function(positions, total, velocity, state, gp)
    if G.mode == "free" or gp or #positions ~= 1 then return end
    if state == Enum.UserInputState.Begin then
      pan0 = G.drive and { yaw = G.drive.camYaw, pitch = G.drive.camPitch } or { yaw = orbit.yaw, pitch = orbit.pitch }
    elseif pan0 then
      if G.drive then
        G.drive.camYaw = pan0.yaw - total.X * 0.006
        G.drive.camPitch = math.clamp(pan0.pitch + total.Y * 0.004, -0.1, 1.2)
      else
        orbit.yaw = pan0.yaw - total.X * 0.006
        orbit.pitch = math.clamp(pan0.pitch + total.Y * 0.004, 0.25, 1.45)
      end
      if state == Enum.UserInputState.End then pan0 = nil end
    end
  end)
  local pinch0 = nil
  UIS.TouchPinch:Connect(function(positions, scale, velocity, state, gp)
    if G.mode == "free" or G.drive then return end
    if state == Enum.UserInputState.Begin then
      pinch0 = orbit.dist
    elseif pinch0 and scale > 0 then
      orbit.dist = math.clamp(pinch0 / scale, 80, 1600)
      if state == Enum.UserInputState.End then pinch0 = nil end
    end
  end)
  -- 走到军工建筑旁按 E：兵工厂翻到这个建筑的页签
  PPS.PromptTriggered:Connect(function(prompt)
    local tab = prompt:GetAttribute("Tab")
    if tab and G.shopTab then G.shopTab(tab) end
  end)
  ui.fireBtn.MouseButton1Down:Connect(function()
    if G.drive then G.drive.firing = true end
  end)
  ui.fireBtn.MouseButton1Up:Connect(function()
    if G.drive then G.drive.firing = false end
  end)
  -- 手机：按住「升高」「降低」（松手或手指滑出按钮都停）
  for _, e in ipairs({ { ui.upBtn, 1 }, { ui.downBtn, -1 } }) do
    e[1].MouseButton1Down:Connect(function()
      if G.drive then G.drive.climb = e[2] end
    end)
    local function stop()
      if G.drive and G.drive.climb == e[2] then G.drive.climb = 0 end
    end
    e[1].MouseButton1Up:Connect(stop)
    e[1].MouseLeave:Connect(stop)
  end

  ---------------------------------------------------------------- 每帧

  local popT = 0
  function G.stepPlay(dt)
    if G.drive then
      driveStep(dt)
    elseif G.mode == "deploy" or G.mode == "battle" then
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
        if mv.Magnitude > 0 then orbit.focus = orbit.focus + mv.Unit * dt * 260 * (orbit.dist / 600) end
      end
      local o = orbit.origin
      orbit.focus = V(math.clamp(orbit.focus.X, o.X - 420, o.X + 420), o.Y, math.clamp(orbit.focus.Z, o.Z - 160, o.Z + F.center + F.length / 2 + 120))
      local cp = math.cos(orbit.pitch)
      local off = V(-math.sin(orbit.yaw) * cp, math.sin(orbit.pitch), -math.cos(orbit.yaw) * cp) * orbit.dist
      local want = CFrame.lookAt(orbit.focus + off, orbit.focus)
      camCF = camCF and camCF:Lerp(want, 1 - math.exp(-dt * 7)) or want
      cam.CFrame = camCF
    end
    if gun.firing and gun.id and Config.Weapons[gun.id].auto and not G.aim then tryFire() end
    ammoHud()
    ghostUpdate()
    aimUpdate()
    if G.battle then
      local left = math.max(0, G.battle.len - (os.clock() - G.battle.t0))
      ui.bTitle.Text = string.format("%s   %d:%02d", G.battle.title, math.floor(left / 60), math.floor(left % 60))
    end
    -- 自己基地的楼顶隔几秒冒「+$」
    popT = popT + dt
    local S = G.S
    if popT >= 3 and S and G.mode == "free" and S.owned and not G.battle then
      popT = 0
      local mul = 1 + Config.Rebirth.income * (S.rebirth or 0)
      for id in pairs(S.owned) do
        local b = Config.BuildingById[id]
        if b and b.income then
          local v = Config.BuildingIncome(b, S.owned, S.lv and S.lv[id]) * mul
          local p = S.origin + V(b.x, 1 + b.size[2] + 2, b.z)
          if (p - cam.CFrame.Position).Magnitude < 260 then G.popText(p, "+$" .. Config.Fmt(v * 3), RGB(130, 235, 140)) end
        end
      end
    end
  end
end

return Play
