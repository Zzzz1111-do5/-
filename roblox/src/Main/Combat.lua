-- 军事大亨：战斗编排——打 AI 关卡（pve）、突袭别人的防线（raid）、和真人对战（duel：同服点名约战是友谊赛，匹配来的是排位赛 ranked）；
-- 玩家本人上阵（小人：开战时传送到己方后方，敌人会打你，死了在基地复活、可以重返战场）、亲自驾驶自己的车 / 直升机
local Players = game:GetService("Players")
local Debris = game:GetService("Debris")

local Combat = {}

function Combat.init(G)
  local Config, Models, Battle = G.Config, G.Models, G.Battle
  local V = Vector3.new
  local F = Config.Field
  local UNITS = Config.Units
  local RB = G.R.Battle
  local XMAX = F.width / 2 - 6
  local ZMIN, ZMAX = F.center - F.length / 2 + 5, F.center + F.length / 2 - 5
  local nextBid = 0

  -- later：推演进行中加进来的（机降的步兵）先不放进 B.units，由推演这一步结束时统一加
  local function addUnit(B, bu, later)
    nextBid = nextBid + 1
    bu.bid = nextBid
    B.byId[nextBid] = bu
    if bu.model and bu.model.Parent then bu.model:SetAttribute("BU", nextBid) end
    if not later then table.insert(B.units, bu) end
  end

  -- 两队玩家本人上阵的位置：第 1 队在部署区后面朝北，第 2 队在敌军区后面朝南
  local function heroSpot(B, team)
    if team == 1 then return B.origin + V(0, 4, F.deploy[1] + 14), 1 end
    return B.origin + V(0, 4, F.enemy[2] - 14), -1
  end

  local function callbacks(B)
    local cb = {}
    cb.fx = G.fx
    function cb.world(x, y, z)
      return B.origin + V(x, 1 + y, z)
    end
    function cb.muzzle(u)
      if not (u.root and u.root.Parent) then return B.origin + V(u.x, 4, u.z) end
      local cf = u.root.CFrame
      if u.ty and u.ty ~= 0 then cf = cf * CFrame.Angles(0, u.ty, 0) end
      return cf:PointToWorldSpace(Models.muzzle(u.t))
    end
    function cb.aim(t, hit)
      local p = B.origin + V(t.x, 1 + (t.y or 0) + (t.h3 or 2.5), t.z)
      if not hit then p = p + V(math.random() * 12 - 6, math.random() * 3, math.random() * 12 - 6) end
      return p
    end
    function cb.hurt(u)
      if u.fill then u.fill.Size = UDim2.fromScale(math.clamp(u.hp / u.max, 0, 1), 1) end
    end
    function cb.heroHurt(u, dmg, src)
      local hum = u.model and u.model:FindFirstChildOfClass("Humanoid")
      if hum and hum.Health > 0 then
        hum:TakeDamage(dmg * 0.5)
        if src and src.player and src.player ~= u.hero then cb.hit(u, dmg * 0.5, hum.Health <= 0, src) end
      end
    end
    -- 玩家亲手打中的（开枪、开车、支援技能）：告诉他——准星上的命中标记、飘出来的伤害数字、击毁提示
    function cb.hit(u, dmg, killed, src)
      local pl = src.player
      if not (pl and pl.Parent) then return end
      RB:FireClient(pl, { phase = "hit", p = B.origin + V(u.x, 1 + (u.y or 0) + (u.h3 or 2.5), u.z), d = math.floor(dmg + 0.5), k = killed, t = u.t, hero = u.hero ~= nil })
    end
    function cb.kill(u, src)
      local st = src.player and G.states[src.player]
      if not st or not st.data then return end
      B.pk = B.pk or {}
      B.pk[st] = (B.pk[st] or 0) + 1
      st.data.kills = st.data.kills + 1
      G.addXP(st, u.def.boss and 25 or 2)
      G.progress(st, "kill", 1)
      if src.drive then G.progress(st, "drivekill", 1) end
    end
    function cb.die(u)
      if u.bar then u.bar.Enabled = false end
      if u.driver then
        local st = G.states[u.driver]
        if st then G.driveStop(st) end
      end
      local m = u.model
      if not m or not m.Parent then return end
      m:SetAttribute("Dead", true)   -- 残骸：客户端布阵时不能选、画成烧黑的
      m:SetAttribute("Fly", false)
      local p = B.origin + V(u.x, 1 + u.y, u.z)
      if u.def.foot then
        G.fx({ k = "boom", p = p + V(0, 2, 0), s = 0.7 })
        m:Destroy()
        return
      end
      G.fx({ k = "boom", p = p + V(0, 3, 0), s = (u.def.boss or u.def.bombs) and 3 or 2 })
      if u.def.air then   -- 飞机摔到地上
        u.root.CFrame = G.unitCF(B.origin, u.x, 0, u.z, u.h) * CFrame.Angles(0.25, 0, 0.6)
        G.fx({ k = "boom", p = B.origin + V(u.x, 3, u.z), s = 1.6 })
      end
      for _, part in ipairs(m:GetDescendants()) do
        if part:IsA("BasePart") and part.Transparency < 1 and part.Name ~= "TeamRing" then
          part.Color = Color3.fromRGB(38, 35, 32)
          part.Material = Enum.Material.CorrodedMetal
        end
      end
      local fire = Instance.new("Fire")
      fire.Size = 8
      fire.Heat = 12
      fire.Parent = u.root
      local smoke = Instance.new("Smoke")
      smoke.Color = Color3.fromRGB(40, 40, 40)
      smoke.Opacity = 0.35
      smoke.RiseVelocity = 9
      smoke.Size = 6
      smoke.Parent = u.root
      Debris:AddItem(m, 6)
    end
    -- 运兵直升机放下的步兵：临时单位，模型放在直升机同一个文件夹里（客户端照样平滑显示），打完就删
    function cb.spawn(src, t, x, z)
      local def = UNITS[t]
      local color = (src.owner and src.owner.plot and src.owner.plot.color) or Config.EnemyColor
      local model, root = Models.unit(t, color)
      model.Name = "T" .. t
      model:SetAttribute("Type", t)
      model:SetAttribute("Fly", false)
      model.Parent = (src.model and src.model.Parent) or workspace
      root.CFrame = G.unitCF(B.origin, x, 0, z, src.h)
      local bar, fill = Models.hpBar(root, Models.heightOf(t) + 3, color)
      bar.Enabled = true
      local bu = { t = t, def = def, team = src.team, x = x, y = 0, z = z, h = src.h, ty = 0, hp = def.hp * src.dm, max = def.hp * src.dm, dm = src.dm,
        cd = math.random() * math.min(def.rate, 3), rt = 0, alive = true, temp = true, model = model, root = root, bar = bar, fill = fill, h3 = Models.heightOf(t) * 0.45 }
      addUnit(B, bu, true)
      return bu
    end
    return cb
  end

  local function newBattle(mode, origin)
    local B = { mode = mode, origin = origin, units = {}, shells = {}, missiles = {}, pending = {}, deaths = {}, t = 0, alive1 = 0, alive2 = 0, byId = {}, teamOf = {}, sts = {}, over = false }
    B.cb = callbacks(B)
    return B
  end

  -- 把玩家的部队加进战斗；mirror：放到对面（约战的应战方）
  local function enlist(B, st, team, mirror)
    local tm = G.powerOf(st.data)
    for _, u in pairs(st.units) do
      local def = UNITS[u.t]
      local stars = Config.StarsOf(u.v)
      local um = tm * (1 + Config.Vet.bonus * stars)   -- 老兵每星再加成
      u.path = nil
      local x, z, h = u.sx, u.sz, math.pi
      if mirror then x, z, h = -u.sx, F.enemy[1] + (F.deploy[2] - u.sz), 0 end
      u.x, u.y, u.z, u.h = x, 0, z, h
      if not u.bar then u.bar, u.fill = Models.hpBar(u.root, Models.heightOf(u.t) + 3, st.plot.color) end
      u.bar.Enabled = true
      u.fill.Size = UDim2.fromScale(1, 1)
      if def.air then G.setFly(u, true) end
      addUnit(B, {
        uid = u.uid, owner = st, t = u.t, def = def, team = team, x = x, y = 0, z = z, h = h, ty = 0, stars = stars, kills = 0,
        hp = def.hp * um, max = def.hp * um, dm = um, cd = math.random() * math.min(def.rate, 3), rt = 0, alive = true,
        model = u.model, root = u.root, bar = u.bar, fill = u.fill, h3 = Models.heightOf(u.t) * 0.45,
      })
    end
  end

  -- AI（或者防线快照）的部队：list = { { t, x, z, model?, root? } }，坐标是战场坐标
  local function enlistAI(B, list, hm, dm, hold, folder)
    for i, a in ipairs(list) do
      local def = UNITS[a.t]
      local model, root = a.model, a.root
      if not model then
        model, root = Models.unit(a.t, Config.EnemyColor)
        model.Name = "E" .. i
        model:SetAttribute("Type", a.t)
        model:SetAttribute("Fly", false)
        model.Parent = folder
      end
      root.CFrame = G.unitCF(B.origin, a.x, 0, a.z, 0)
      local bar, fill = Models.hpBar(root, Models.heightOf(a.t) + 3, Config.EnemyColor)
      bar.Enabled = true
      if def.air then model:SetAttribute("Fly", true) end
      local vm = 1 + Config.Vet.bonus * Config.StarsOf(a.v)   -- 突袭别人的防线：他的老兵也有加成
      addUnit(B, {
        t = a.t, def = def, team = 2, x = a.x, y = 0, z = a.z, h = 0, ty = 0, hp = def.hp * hm * vm, max = def.hp * hm * vm, dm = dm * vm,
        cd = math.random() * math.min(def.rate, 3), rt = 0, alive = true, hold = hold, model = model, root = root, bar = bar, fill = fill,
        h3 = Models.heightOf(a.t) * 0.45,
      })
    end
  end

  -- 把推演里的位置摆到模型上（没动的不改，省同步）；炮塔转角写在模型属性 TY 上（客户端转炮塔）
  local function placeAll(B)
    for _, u in ipairs(B.units) do
      if u.alive and not u.hero and u.root and u.root.Parent then
        local pitch = u.pitch or 0
        if u.px == nil or math.abs(u.x - u.px) > 0.02 or math.abs(u.z - u.pz) > 0.02 or math.abs(u.y - u.py) > 0.02 or math.abs(u.h - u.ph) > 0.004 or math.abs(pitch - (u.ppitch or 0)) > 0.004 then
          u.px, u.pz, u.py, u.ph, u.ppitch = u.x, u.z, u.y, u.h, pitch
          local cf = G.unitCF(B.origin, u.x, u.y, u.z, u.h)
          if u.def.air and u.moving and not u.def.jet then cf = cf * CFrame.Angles(-0.14, 0, 0) end   -- 直升机往前飞时低头（喷气机的坡度客户端算）
          if u.def.jet and pitch > 0.002 then cf = cf * CFrame.Angles(pitch, 0, 0) end   -- 喷气机起飞爬升：机头抬起来
          u.root.CFrame = cf
        end
        local ty = math.floor((u.ty or 0) * 50 + 0.5) / 50
        if ty ~= u.pty then
          u.pty = ty
          u.model:SetAttribute("TY", ty)
        end
      end
    end
  end

  local function syncHeroes(B)
    for _, u in ipairs(B.units) do
      if u.hero and u.alive then
        local char = u.model
        local hum = char and char.Parent and char:FindFirstChildOfClass("Humanoid")
        if not hum or hum.Health <= 0 or not (u.root and u.root.Parent) then
          u.alive = false
          local st = G.states[u.hero]
          if st and st.hero == u then
            st.hero = nil
            RB:FireClient(u.hero, { phase = "hero", alive = false })
          end
        else
          local p = u.root.Position - B.origin
          u.x, u.z = p.X, p.Z
        end
      end
    end
  end

  -- 玩家本人上阵：传送到己方后方，血量加到上阵的量；at 给了就在那里下车
  function G.heroJoin(st, at)
    local B = st.battle
    if not B or B.over or st.driving then return end
    local team = B.teamOf[st.pl]
    local char = st.pl.Character
    local hum = char and char:FindFirstChildOfClass("Humanoid")
    local hrp = char and char:FindFirstChild("HumanoidRootPart")
    if not (hum and hrp) or hum.Health <= 0 then return end
    local pos, dir = heroSpot(B, team)
    if at then pos = at end
    char:PivotTo(CFrame.lookAt(pos, pos + V(0, 0, dir * 10)))
    hum.MaxHealth = Config.Hero.hp
    if not at then hum.Health = Config.Hero.hp end
    if st.hero then st.hero.alive = false end
    local bu = { hero = st.pl, owner = st, t = "hero", def = Battle.HERO, team = team, x = pos.X - B.origin.X, z = pos.Z - B.origin.Z, y = 0, h = 0,
      hp = 1, max = 1, dm = 1, cd = 0, rt = 0, alive = true, model = char, root = hrp, h3 = 2.5 }
    addUnit(B, bu)
    char:SetAttribute("BU", bu.bid)
    st.hero = bu
    RB:FireClient(st.pl, { phase = "hero", alive = true })
  end

  -- 开车时把角色藏起来（锚定、透明），下车放回车旁
  local function hideChar(st, hide, at)
    local char = st.pl.Character
    if not char then return end
    local hrp = char:FindFirstChild("HumanoidRootPart")
    if hide then
      st.hidden = {}
      for _, d in ipairs(char:GetDescendants()) do
        if d:IsA("BasePart") or d:IsA("Decal") then
          st.hidden[d] = d.Transparency
          d.Transparency = 1
        end
      end
      if hrp then hrp.Anchored = true end
    else
      for d, tr in pairs(st.hidden or {}) do
        if d.Parent then d.Transparency = tr end
      end
      st.hidden = nil
      if hrp then
        hrp.Anchored = false
        if at then char:PivotTo(CFrame.new(at)) end
      end
    end
  end

  function G.driveStart(st, uid)
    local B = st.battle
    if not B or B.over or st.driving or type(uid) ~= "number" then return end
    local bu
    for _, u in ipairs(B.units) do
      if u.owner == st and u.uid == uid and u.alive and not u.hero then bu = u end
    end
    if not bu then return end
    if bu.def.foot then
      G.toast(st, bu.def.name .. "不能开——你本人就是步兵", "info")
      return
    end
    bu.driver = st.pl
    bu.tgt = nil
    bu.salvoLeft = 0
    st.driving = bu
    st.driveT = os.clock()
    if st.hero then
      st.hero.alive = false
      st.hero = nil
    end
    hideChar(st, true)
    RB:FireClient(st.pl, { phase = "drive", uid = uid, t = bu.t, bid = bu.bid, origin = B.origin, cd = math.max(0, bu.cd) })   -- cd：还要装填几秒
  end

  function G.driveStop(st)
    local bu = st.driving
    if not bu then return end
    st.driving = nil
    bu.driver = nil
    local B = st.battle
    local at = nil
    if B then at = B.origin + V(bu.x + bu.def.size * 0.6 + 3, 4, bu.z) end
    hideChar(st, false, at)
    RB:FireClient(st.pl, { phase = "exit" })
    if B and not B.over then G.heroJoin(st, at) end
  end

  -- 玩家开的车：客户端算位置（不卡），服务器只检查速度、边界；喷气机的范围大一些
  function G.driveInput(st, d)
    local bu = st.driving
    if not bu or not bu.alive or type(d) ~= "table" then return end
    local x, z, h, y, ty = d.x, d.z, d.h, d.y, d.ty
    if type(x) ~= "number" or type(z) ~= "number" or type(h) ~= "number" or x ~= x or z ~= z or h ~= h then return end
    local def = bu.def
    local now = os.clock()
    local dt = math.min(0.5, now - (st.driveT or now))
    st.driveT = now
    local maxStep = def.speed * 1.5 * math.max(dt, 0.05) + 3
    local dx, dz = x - bu.x, z - bu.z
    local dist = math.sqrt(dx * dx + dz * dz)
    if dist > maxStep then x, z = bu.x + dx / dist * maxStep, bu.z + dz / dist * maxStep end
    if def.static then   -- 固定阵地（密集阵）：只能转炮塔瞄准、开火，车不动
      bu.vx, bu.vz, bu.moving = 0, 0, false
      if type(ty) == "number" and ty == ty then bu.ty = ty end
      return
    end
    local ox, oz = bu.x, bu.z
    if def.jet then
      bu.x = math.clamp(x, -Battle.JX, Battle.JX)
      bu.z = math.clamp(z, Battle.JZ0, Battle.JZ1)
    else
      bu.x = math.clamp(x, -XMAX, XMAX)
      bu.z = math.clamp(z, ZMIN, ZMAX)
    end
    local step = math.max(dt, 0.05)
    bu.vx, bu.vz = (bu.x - ox) / step, (bu.z - oz) / step   -- 轰炸机投弹要用速度
    bu.h = h
    bu.moving = dist > 0.05
    if def.air then
      local oy = bu.y
      bu.y = (type(y) == "number" and y == y) and math.clamp(y, def.jet and 0 or (def.cargo and 5 or 12), def.jet and 230 or 160) or def.alt   -- 喷气机接手时可能还在起飞
      if def.jet then   -- 别的玩家看到的机头跟着升降（AI 不推演玩家开的飞机，这里按升降速度算）
        bu.spd = math.max(dist / step, def.speed * 0.6)
        bu.pitch = math.clamp(math.atan2((bu.y - oy) / step, bu.spd), -0.4, 0.4)
      end
    end
    if type(ty) == "number" and ty == ty then bu.ty = ty end
  end

  function G.driveFire(st, aim)
    local bu = st.driving
    local B = st.battle
    if not bu or not bu.alive or not B or typeof(aim) ~= "Vector3" then return end
    local a = aim - B.origin
    Battle.driveFire(B, bu, a.X, a.Z, a.Y - 1)
  end

  -- 每半秒：双方还剩多少、这半秒里谁被打掉了（战报滚动条：en 是不是敌方的、me 是不是你亲手打的、mine 是不是你的部队）
  local function tick(B)
    local deaths = B.deaths or {}
    B.deaths = {}
    for st, team in pairs(B.sts) do
      if G.states[st.pl] == st then
        local a, e = B.alive1, B.alive2
        if team == 2 then a, e = e, a end
        local feed = nil
        for _, dd in ipairs(deaths) do
          feed = feed or {}
          if #feed >= 8 then break end
          table.insert(feed, { t = dd.t, en = dd.team ~= team, me = dd.by == st.pl.UserId, mine = dd.owner == st.pl.UserId })
        end
        RB:FireClient(st.pl, { phase = "tick", t = B.t, a = a, e = e, feed = feed })
      end
    end
  end

  -- 火山战区：隔一会儿在战场上随机一处先亮出红圈预警，再砸下几颗火山弹（敌我都伤）
  local LAVA = { dmg = 110, splash = 22, vsArmor = 0.7, vsInf = 1.2, vsAir = 0, fxu = "lava" }
  local function quakeStep(B, dt)
    B.quakeT = (B.quakeT or B.quake * 0.6) - dt
    if B.quakeT > 0 then return end
    B.quakeT = B.quake * (0.8 + math.random() * 0.4)
    local x = (math.random() - 0.5) * (F.width - 60)
    local z = F.deploy[2] + math.random() * (F.enemy[1] - F.deploy[2])
    local dm = 1 + (B.level or 41) * 0.05
    G.fx({ k = "quake", p = B.origin + V(x, 1, z), s = 30 })
    for i = 1, 3 do
      Battle.strike(B, 0, LAVA, dm, x, z, 24, 1.6 + i * 0.35, "bomb", nil, B.origin + V(x + math.random(-120, 120), 300, z + math.random(-120, 120)))
    end
  end

  -- 战况（打关卡时按关卡定）：大雾、夜战射程短；雷区开打前埋好；敌机突袭、空降增援到时候来
  local function eventSetup(B)
    local ev = B.event
    if ev.id == "fog" then
      B.rangeK = (B.rangeK or 1) * 0.7
    elseif ev.id == "night" then
      B.rangeK = (B.rangeK or 1) * 0.8
    elseif ev.id == "minefield" then   -- 中立的雷：谁踩上都炸
      local pseudo = { def = { mines = { dmg = 300, splash = 16, r = 11 } }, team = 0, dm = 1 }
      for _ = 1, 16 do
        Battle.layMine(B, pseudo, (math.random() - 0.5) * (F.width - 80), F.deploy[2] + 100 + math.random() * (F.enemy[1] - F.deploy[2] - 200))
      end
    end
  end
  local function eventSay(B, text, sub)
    for st in pairs(B.sts) do
      if G.states[st.pl] == st then RB:FireClient(st.pl, { phase = "event", text = text, sub = sub }) end
    end
  end
  local function eventStep(B)
    local ev = B.event
    if B.evDone then return end
    if ev.id == "airraid" and B.t >= (ev.at or 8) then
      B.evDone = true
      local sx, sz, n = 0, 0, 0
      for _, u in ipairs(B.units) do
        if u.alive and u.team == 1 and not u.hero and not u.def.air then sx, sz, n = sx + u.x, sz + u.z, n + 1 end
      end
      if n == 0 then return end
      local x, z = sx / n, sz / n
      local def = { dmg = 120, splash = 22, vsArmor = 0.9, vsInf = 1.3, vsAir = 0, fxu = "bomber" }
      local len, cnt, dm = 170, 12, B.enemyDm or 1
      eventSay(B, "敌机突袭！", "轰炸机从北边飞过来，沿着你的阵线扔炸弹")
      G.fx({ k = "flyover", a = B.origin + V(x, 95, z + len / 2 + 420), b = B.origin + V(x, 95, z - len / 2 - 420), t = 4.2, jet = true })
      for i = 1, cnt do
        local bz = z + len / 2 - (i - 1) * len / (cnt - 1)
        task.delay(1.55 + (i - 1) * 0.11, function()
          if B.over then return end
          Battle.strike(B, 2, def, dm, x + math.random(-8, 8), bz, 5, 1.1, "bomb", nil, B.origin + V(x, 92, bz + 30))
        end)
      end
    elseif ev.id == "reinforce" and B.t >= (ev.at or 10) then
      B.evDone = true
      eventSay(B, "敌军空降增援！", "战场中间落下一批步兵和机枪车")
      local x0, z0 = (math.random() - 0.5) * 160, F.center + 60
      G.fx({ k = "flyover", a = B.origin + V(x0 + 60, 70, z0 + 380), b = B.origin + V(x0 - 60, 70, z0 - 380), t = 3.2, heli = true })
      local src = { team = 2, h = 0, dm = B.enemyDm or 1, model = { Parent = B.enemyFolder } }
      local list = { "inf", "inf", "inf", "inf", "jeep", "jeep" }
      for i, t in ipairs(list) do
        task.delay(1.4 + i * 0.25, function()
          if B.over or not B.cb.spawn then return end
          local a = (i / #list) * math.pi * 2
          local px = math.clamp(x0 + math.cos(a) * 26, -Battle.XMAX, Battle.XMAX)
          local pz = math.clamp(z0 + math.sin(a) * 26, Battle.ZMIN, Battle.ZMAX)
          local bu = B.cb.spawn(src, t, px, pz)
          if bu then
            table.insert(B.units, bu)   -- 不在推演那一步里：直接加
            G.fx({ k = "drop", p = B.origin + V(px, 1, pz), s = 1 })
          end
        end)
      end
    else
      if ev.id ~= "airraid" and ev.id ~= "reinforce" then B.evDone = true end
    end
  end

  -- 单位技能：观战时点开自己的一个单位放（按兵种的页签：冲锋、烟幕、全力开火、急速射、加力冲刺），每个单位各自冷却
  function G.useAbility(st, bid)
    local B = st.battle
    if not B or B.over or type(bid) ~= "number" then return end
    local u = B.byId[bid]
    if not u or not u.alive or u.owner ~= st or u.hero or u.temp then return end
    local ab = Config.Abilities[u.def.cat or ""]
    if not ab then return end
    if (u.abReady or 0) > B.t then
      G.toast(st, "「" .. ab.name .. "」还要冷却 " .. math.ceil(u.abReady - B.t) .. " 秒", "info")
      return
    end
    u.abReady = B.t + ab.cd
    Battle.ability(B, u)
    RB:FireClient(st.pl, { phase = "ability", bid = bid, id = ab.id, name = ab.name, cd = ab.cd })
    G.progress(st, "skill", 1)
  end

  local finish, forceEnd
  local function begin(B, sides, title)
    for team, st in pairs(sides) do
      st.battle = B
      B.teamOf[st.pl] = team
      B.sts[st] = team
      if G.skillsReset then G.skillsReset(st) end
    end
    placeAll(B)
    for st, team in pairs(B.sts) do
      RB:FireClient(st.pl, { phase = "start", mode = B.mode, title = title, level = st.data.level, team = team, time = Config.BattleTime, origin = B.origin, boss = B.boss == true,
        event = B.event and { id = B.event.id, name = B.event.name, desc = B.event.desc } or nil })
      G.push(st)
      G.heroJoin(st)
    end
    task.spawn(function()
      local tickT, bad = 0, 0
      while not B.over do
        local dt = task.wait(Config.Tick)
        if B.over then break end
        G.try("战斗：玩家本人", syncHeroes, B)
        local ok, res = xpcall(Battle.step, debug.traceback, B, math.min(dt, 0.2))
        if not ok then
          G.reportError("战斗推演", res)
          bad = bad + 1
          res = (bad > 40) and "timeout" or nil   -- 偶尔一步出错就跳过这一步；一直出错才收场
        end
        G.try("战斗：摆模型", placeAll, B)
        if B.quake then G.try("战斗：火山弹", quakeStep, B, dt) end
        if B.event then G.try("战斗：战况", eventStep, B) end
        tickT = tickT + dt
        if tickT >= 0.5 then
          tickT = 0
          G.try("战斗：战报", tick, B)
        end
        if res then
          if not G.try("战斗结算", finish, B, res) then forceEnd(B) end
          break
        end
      end
    end)
  end

  -- 剩下的兵力（按价格算）：约战打到时间按这个判输赢
  local function valueLeft(B, team)
    local v = 0
    for _, u in ipairs(B.units) do
      if u.alive and not u.hero and u.team == team then v = v + (u.def.price or 0) * (u.hp / math.max(1, u.max)) end
    end
    return v
  end
  local function armyValue(st)
    local v = 0
    for _, u in pairs(st.units) do v = v + UNITS[u.t].price end
    return v
  end

  -- 老兵：活下来的 +1 经验，每击毁一个敌人再 +1；升星了记下来（打完一起提示）
  local function vetGain(st, u, bu, promos)
    local old = Config.StarsOf(u.v)
    u.v = (u.v or 0) + 1 + (bu.kills or 0)
    local new = Config.StarsOf(u.v)
    if new > old then
      table.insert(promos, UNITS[u.t].name .. " " .. string.rep("★", new))
      if G.vetTag then G.vetTag(st, u) end
    end
  end
  local function promoToast(st, promos)
    if #promos == 0 then return end
    local list = {}
    for i = 1, math.min(4, #promos) do list[i] = promos[i] end
    G.toast(st, "老兵晋升：" .. table.concat(list, "、") .. ((#promos > 4) and ("等 " .. #promos .. " 个") or "") ..
      "（每颗星血量、伤害 +" .. math.floor(Config.Vet.bonus * 100 + 0.5) .. "%）", "good")
  end

  -- 打完：清理、按模式算奖励；res 是第 1 队的结果
  function finish(B, res)
    if B.over then return end
    B.over = true
    for st in pairs(B.sts) do
      if st.driving then G.driveStop(st) end
      st.hero = nil
      local char = st.pl.Character
      local hum = char and char:FindFirstChildOfClass("Humanoid")
      if hum then
        hum.MaxHealth = 100
        if hum.Health > 100 then hum.Health = 100 end
      end
      if char then char:SetAttribute("BU", nil) end
    end
    for _, bu in ipairs(B.units) do
      if bu.bar then bu.bar.Enabled = false end
      if bu.temp then   -- 机降的步兵打完就撤
        if bu.model then bu.model:Destroy() end
      elseif bu.model and bu.model.Parent and not bu.hero then
        bu.model:SetAttribute("BU", nil)
        bu.model:SetAttribute("TY", 0)
      end
    end
    if B.mode == "duel" then
      local t1, t2 = B.sides[1], B.sides[2]   -- 中途走掉的人不在 B.sts 里了，排位照样算他输
      local winner = 0
      if res == "win" then winner = 1 elseif res == "lose" then winner = 2
      else
        local v1, v2 = valueLeft(B, 1), valueLeft(B, 2)
        winner = (v1 >= v2) and 1 or 2
      end
      if B.arena then B.arena.busy = false end
      -- 排位：ELO（赢的涨、输的掉同样多；走掉的人的存档在 PlayerRemoving 里存）
      local delta = 0
      local MC = Config.Match
      if B.ranked and t1 and t2 and t1.data and t2.data then
        local d1, d2 = t1.data, t2.data
        local E1 = 1 / (1 + 10 ^ ((d2.pvp - d1.pvp) / 400))
        delta = math.max(1, math.floor(MC.k * math.abs(((winner == 1) and 1 or 0) - E1) + 0.5))
        local w, l = d1, d2
        if winner == 2 then w, l = d2, d1 end
        w.pvp = w.pvp + delta
        l.pvp = math.max(0, l.pvp - delta)
        w.pvpWins = w.pvpWins + 1
        d1.pvpGames = d1.pvpGames + 1
        d2.pvpGames = d2.pvpGames + 1
      end
      for st, team in pairs(B.sts) do
        if G.states[st.pl] == st then
          local other = (team == 1) and t2 or t1
          local won = team == winner
          local reward = 0
          if B.ranked then
            reward = won and math.floor(MC.reward + MC.share * (other and armyValue(other) or 0)) or MC.lose
            G.addXP(st, won and 40 or 15)
          elseif won then
            reward = math.floor(Config.Duel.reward + Config.Duel.share * (other and armyValue(other) or 0))
            G.addXP(st, 30)
          else
            G.addXP(st, 10)
          end
          st.data.cash = st.data.cash + reward
          if won then st.data.duelWins = st.data.duelWins + 1 end
          G.progress(st, "duel", 1)
          -- 约战不损失部队：打没了的换新模型，全部放回阵位；活下来的照样攒老兵经验
          local promos = {}
          for _, bu in ipairs(B.units) do
            if bu.owner == st and not bu.hero and not bu.temp then
              local u = st.units[bu.uid]
              if u and not bu.alive then G.respawnModel(st, u) elseif u then vetGain(st, u, bu, promos) end
            end
          end
          G.homeSnap(st)
          promoToast(st, promos)
          st.battle = nil
          local oname = other and other.pl.DisplayName or "对手"
          local text = won and ("你赢了 " .. oname .. "！") or ("输给了 " .. oname .. "，部队没有损失")
          if B.ranked then
            text = text .. "\n对战积分 " .. (won and "+" or "-") .. delta .. "（现在 " .. st.data.pvp .. "）"
            if G.matchServer then text = text .. "\n" .. MC.back .. " 秒后送你回普通服务器" end
          end
          RB:FireClient(st.pl, { phase = "end", mode = "duel", ranked = B.ranked, result = won and "win" or "lose", reward = reward, lost = {}, lostN = 0, level = st.data.level, text = text,
            pk = (B.pk and B.pk[st]) or 0 })
          G.push(st)
          task.spawn(G.save, st)
        end
      end
      if G.onDuelEnd then G.onDuelEnd(B) end
      return
    end
    -- 关卡、突袭：第 1 队是玩家
    local st = nil
    for s in pairs(B.sts) do st = s end
    if not st or G.states[st.pl] ~= st then return end
    local d = st.data
    local lost, lostN, total = {}, 0, 0
    local promos = {}
    for _, bu in ipairs(B.units) do
      if bu.owner == st and not bu.hero and not bu.temp then
        local u = st.units[bu.uid]
        total = total + 1
        if u then
          if bu.alive then   -- 活着的开回战前的阵位，下一仗满血；攒老兵经验
            u.x, u.y, u.z, u.h = bu.x, bu.y, bu.z, bu.h
            u.pv = bu.def.jet and bu.spd or nil   -- 喷气机按打仗时的速度接着飞回去（不在半空一下停住）
            G.goTo(u, u.sx, u.sz)
            vetGain(st, u, bu, promos)
          elseif bu.spent then   -- 巡飞弹撞上去了：用掉了，不算损失
            st.units[bu.uid] = nil
            total = total - 1
          else
            st.units[bu.uid] = nil
            lost[u.t] = (lost[u.t] or 0) + 1
            lostN = lostN + 1
          end
        end
      elseif bu.team == 2 and bu.alive and bu.model and bu.model.Parent then
        bu.model:SetAttribute("Fly", false)
      end
    end
    local reward, text, stars = 0, nil, nil
    local oldBest = d.best
    if B.mode == "pve" then
      if res == "win" then
        local beaten = d.level
        reward = Config.Reward(beaten)
        d.cash = d.cash + reward
        if Config.IsBoss(beaten) then
          G.progress(st, "boss", 1)
          text = "打掉了首领！奖励翻倍"
        end
        -- 评星：一个没丢三星，丢的不超过三成两星，其余一星
        stars = (lostN == 0) and 3 or ((lostN <= total * 0.3) and 2 or 1)
        local M = Config.Milestone
        if M and beaten % M.every == 0 then
          local bonus = math.floor(Config.Reward(beaten) * M.k)
          d.cash = d.cash + bonus
          reward = reward + bonus
          text = (text and (text .. "\n") or "") .. "里程碑：打通第 " .. beaten .. " 关，额外奖励 $" .. Config.Fmt(bonus)
        end
        G.addXP(st, 10 + d.level * 2)
        G.progress(st, "win", 1)
        d.level = d.level + 1
        d.best = math.max(d.best, d.level)
        d.wins = (d.wins or 0) + 1
        -- 打进新战区：战场整个换样子，过一会儿大字播报
        local th = Config.TheaterOf(d.level)
        if G.setTheater and G.setTheater(st, th) then
          text = (text and (text .. "\n") or "") .. "解锁新战区：" .. th.name .. "！" .. th.desc
          task.delay(3.5, function()
            if G.states[st.pl] == st then RB:FireClient(st.pl, { phase = "theater", name = th.name, desc = th.desc }) end
          end)
        end
      end
    else   -- 突袭
      local opp = B.raid
      local E = 1 / (1 + 10 ^ ((opp.rating - d.rating) / 400))
      local won = res == "win"
      local delta = math.floor(Config.Raid.k * ((won and 1 or 0) - E) + (won and 0.5 or -0.5))
      d.rating = math.max(0, d.rating + delta)
      if won then
        reward = math.floor(Config.Reward(opp.level) * Config.Raid.loot)
        d.cash = d.cash + reward
        d.raidWins = d.raidWins + 1
        G.addXP(st, 25)
        G.progress(st, "raidwin", 1)
      end
      text = "突袭" .. (won and "成功" or "失败") .. "：积分 " .. ((delta >= 0) and "+" or "") .. delta .. "（现在 " .. d.rating .. "）"
      if opp.key then G.logRaid(opp.key, { n = st.pl.DisplayName, w = not won, t = os.time() }) end
    end
    st.enemy = {}
    st.battle = nil
    RB:FireClient(st.pl, { phase = "end", mode = B.mode, result = res, reward = reward, lost = lost, lostN = lostN, level = d.level, text = text,
      stars = stars, record = d.best > oldBest and d.best > 2, pk = (B.pk and B.pk[st]) or 0, total = total })
    promoToast(st, promos)
    G.push(st)
    task.spawn(G.save, st)
    task.delay((res == "win") and 3 or 2, function()
      if G.states[st.pl] == st and not st.battle then
        G.makeEnemy(st)
        G.push(st)
      end
    end)
  end

  -- 结算出错时的保底收尾：至少让人退出「打仗中」、部队回到阵位，不然什么都点不了
  function forceEnd(B)
    B.over = true
    if B.arena then B.arena.busy = false end
    for st in pairs(B.sts) do
      pcall(function()
        if st.driving then G.driveStop(st) end
        st.hero = nil
        st.battle = nil
        for _, bu in ipairs(B.units) do
          if bu.temp and bu.model then pcall(function() bu.model:Destroy() end) end
          if bu.owner == st and not bu.hero and not bu.temp then
            local u = st.units[bu.uid]
            if u and not bu.alive then
              if B.mode == "duel" then G.respawnModel(st, u) else st.units[bu.uid] = nil end
            end
          end
        end
        G.homeSnap(st)
        RB:FireClient(st.pl, { phase = "end", mode = B.mode, result = "timeout", reward = 0, lost = {}, lostN = 0, level = st.data.level,
          text = "这一仗结算的时候出错了，已经强制结束，部队放回了阵位（出错信息在屏幕上方的红条里）" })
        G.push(st)
      end)
    end
  end

  -- 人走了：约战算他输；关卡、突袭直接结束（不算输赢、不扣兵）
  function G.abandon(st)
    local B = st.battle
    if not B or B.over then return end
    if B.mode == "duel" then
      B.sts[st] = nil
      if not G.try("约战结算", finish, B, (B.teamOf[st.pl] == 1) and "lose" or "win") then forceEnd(B) end
    else
      B.over = true
    end
  end

  local function canFight(st)
    if not st.ready or st.battle or st.busy then return false end
    if G.count(st) == 0 then
      G.toast(st, "还没有部队：先盖兵营，再在右边「兵工厂」生产", "bad")
      return false
    end
    return true
  end

  function G.startBattle(st)
    if not canFight(st) then return end
    if G.matchCancel then G.matchCancel(st, "开始打关卡，取消了匹配") end
    if #st.enemy == 0 then G.makeEnemy(st) end
    local B = newBattle("pve", st.plot.origin)
    B.level = st.data.level
    B.boss = Config.IsBoss(st.data.level)
    -- 战区：速度、射程倍数，火山弹
    local th = Config.TheaterOf(st.data.level)
    if G.setTheater then G.setTheater(st, th) end
    B.theater = th
    B.speedK = th.speed or 1
    B.rangeK = th.range or 1
    B.quake = th.quake
    enlist(B, st, 1, false)
    local list = {}
    for _, e in ipairs(st.enemy) do table.insert(list, { t = e.t, x = e.x, z = e.z, model = e.model, root = e.root }) end
    local hm, dm = 1, 1
    if st.enemy[1] then hm, dm = st.enemy[1].hm, st.enemy[1].dm end
    enlistAI(B, list, hm, dm, false, st.plot.Enemies)
    B.event = Config.EventOf(st.data.level)
    B.enemyDm, B.enemyFolder = dm, st.plot.Enemies
    if B.event then eventSetup(B) end
    local title = "第 " .. st.data.level .. " 关" .. (Config.IsBoss(st.data.level) and "（首领）" or "") .. (B.event and ("  · " .. B.event.name) or "")
    begin(B, { [1] = st }, title)
  end

  -- 找不到真人对手（或者存档服务不可用）：AI 指挥官，兵力和你差不多
  local BOTNAMES = { "雷霆", "钢铁", "猎鹰", "磐石", "暴风", "长弓", "铁壁", "毒蛇" }
  local function botOpponent(st)
    local value = armyValue(st) * G.powerOf(st.data)
    local budget = math.max(300, value * 0.85)
    local types = Config.EnemyTypes(math.max(5, st.data.level))
    local list, spent = {}, 0
    while #list < Config.MaxEnemy do
      local t = types[math.random(1, #types)]
      if spent + UNITS[t].price > budget then break end
      table.insert(list, t)
      spent = spent + UNITS[t].price
    end
    if #list == 0 then list = { "inf", "inf" } end
    local slots = Battle.formation(list, F.deploy[2] - 4, -1, F.deploy[2] - F.deploy[1] - 8)
    local army = {}
    for _, s in ipairs(slots) do table.insert(army, { t = s.t, x = s.x, z = s.z }) end
    return { key = nil, name = "AI 指挥官·" .. BOTNAMES[math.random(1, #BOTNAMES)], level = st.data.level, tech = st.data.tech, rebirth = 0, rating = st.data.rating, army = army }
  end

  function G.startRaid(st)
    if not canFight(st) then return end
    local now = os.clock()
    if now < (st.raidCD or 0) then
      G.toast(st, "部队还在休整：" .. math.ceil(st.raidCD - now) .. " 秒后才能再突袭", "info")
      return
    end
    st.raidCD = now + Config.Raid.cooldown
    if G.matchCancel then G.matchCancel(st, "开始突袭，取消了匹配") end
    st.busy = true
    G.toast(st, "侦察中：找一条差不多强的防线……", "info")
    local opp = G.findOpponent(st)
    st.busy = false
    if G.states[st.pl] ~= st or st.battle or not st.ready then return end
    if not opp then opp = botOpponent(st) end
    st.plot.Enemies:ClearAllChildren()
    st.enemy = {}
    local B = newBattle("raid", st.plot.origin)
    B.raid = opp
    enlist(B, st, 1, false)
    local tm = (1 + Config.Tech.bonus * opp.tech) * (1 + Config.Rebirth.power * opp.rebirth)
    local list = {}
    for _, a in ipairs(opp.army) do
      local z = math.clamp(F.enemy[1] + (F.deploy[2] - a.z), F.enemy[1] + 4, F.enemy[2] - 4)
      table.insert(list, { t = a.t, x = math.clamp(-a.x, -XMAX, XMAX), z = z, v = a.v })
    end
    enlistAI(B, list, tm, tm, true, st.plot.Enemies)
    begin(B, { [1] = st }, "突袭：" .. opp.name .. " 的防线（第 " .. opp.level .. " 关水平）")
  end

  -- 约战：挑战同服的玩家，对方接受后两边的部队、本人都传到竞技场
  function G.duelInvite(st, targetUid)
    if type(targetUid) ~= "number" or not canFight(st) then return end
    local target = Players:GetPlayerByUserId(targetUid)
    local ts = target and G.states[target]
    if not ts or ts == st or not ts.ready then return end
    if ts.battle then
      G.toast(st, target.DisplayName .. " 正在打仗，等一会儿", "info")
      return
    end
    if G.count(ts) == 0 then
      G.toast(st, target.DisplayName .. " 还没有部队", "info")
      return
    end
    ts.invite = { from = st.pl, untilT = os.clock() + Config.Duel.invite }
    G.R.Duel:FireClient(target, { from = st.pl.UserId, name = st.pl.DisplayName, level = st.data.level, n = G.count(st), rank = (Config.RankOf(st.data.xp)), time = Config.Duel.invite })
    G.toast(st, "已经向 " .. target.DisplayName .. " 发起约战，等对方接受", "info")
  end

  function G.duelAnswer(ts, fromUid, yes)
    local inv = ts.invite
    ts.invite = nil
    if not inv or inv.from.UserId ~= fromUid or os.clock() > inv.untilT then return end
    local st = G.states[inv.from]
    if not st then return end
    if not yes then
      G.toast(st, ts.pl.DisplayName .. " 拒绝了约战", "info")
      return
    end
    if not canFight(st) or not canFight(ts) then
      G.toast(ts, "约战没开成（对方在忙或者没有部队）", "info")
      return
    end
    G.startDuel(st, ts, false)
  end

  -- 两个人的部队、本人都传到空着的竞技场开打（st 在南边、ts 在北边）；ranked 排位赛记对战积分；返回开没开成
  function G.startDuel(st, ts, ranked)
    if not canFight(st) or not canFight(ts) then return false end
    local arena = nil
    for _, a in ipairs(G.arenas) do
      if not a.busy then
        arena = a
        break
      end
    end
    if not arena then
      G.toast(st, "竞技场都在用，过一会儿再打", "info")
      G.toast(ts, "竞技场都在用，过一会儿再打", "info")
      return false
    end
    if G.matchCancel then   -- 在排队的话不用排了
      G.matchCancel(st, true)
      G.matchCancel(ts, true)
    end
    arena.busy = true
    local B = newBattle("duel", arena.origin)
    B.arena = arena
    B.ranked = ranked == true
    B.sides = { [1] = st, [2] = ts }
    enlist(B, st, 1, false)
    enlist(B, ts, 2, true)
    begin(B, { [1] = st, [2] = ts }, (ranked and "排位对战：" or "约战：") .. st.pl.DisplayName .. " vs " .. ts.pl.DisplayName)
    return true
  end

  -- 战后或者想回去了：传送回自己的基地出生点
  function G.sendHome(st)
    if st.battle and not st.battle.over then return end
    local char = st.pl.Character
    if char then
      local S = Config.Spawn
      local o = st.plot.origin
      char:PivotTo(CFrame.lookAt(o + V(S.x, 5, S.z), o + V(S.x, 5, S.z + 10)))
    end
  end
end

return Combat
