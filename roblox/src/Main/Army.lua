-- 军事大亨：部队（平时）：生产（从工厂开出来停到部署区）、阵位、挪位置、排阵、解散、关卡敌军预览
local Army = {}

function Army.init(G)
  local Config, Models, Battle = G.Config, G.Models, G.Battle
  local F = Config.Field
  local UNITS, BDEF = Config.Units, Config.BuildingById
  local hs = Config.BaseSize / 2
  local ROADZ = (hs + F.center - F.length / 2) / 2

  function G.count(st)
    local n = 0
    for _ in pairs(st.units) do n = n + 1 end
    return n
  end

  local function setFly(u, on)
    if u.model and u.model.Parent then u.model:SetAttribute("Fly", on) end
  end
  G.setFly = setFly

  local function newModel(st, u)
    local model, root = Models.unit(u.t, st.plot.color)
    model.Name = "U" .. u.uid
    model:SetAttribute("Uid", u.uid)
    model:SetAttribute("Type", u.t)
    model:SetAttribute("Owner", st.pl.UserId)
    model:SetAttribute("Fly", false)
    model.Parent = st.plot.Units
    u.model, u.root, u.bar, u.fill = model, root, nil, nil
    root.CFrame = G.unitCF(st.plot.origin, u.x, u.y, u.z, u.h)
  end

  function G.spawnUnit(st, t, x, z, y, h)
    st.nextUid = st.nextUid + 1
    local u = { uid = st.nextUid, t = t, x = x, y = y or 0, z = z, h = h or math.pi, sx = x, sz = z }
    newModel(st, u)
    st.units[u.uid] = u
    return u
  end

  -- 约战里打没了的单位：战后在阵位上换一个新模型（约战不损失部队）
  function G.respawnModel(st, u)
    if u.model then u.model:Destroy() end
    u.x, u.y, u.z, u.h, u.path = u.sx, 0, u.sz, math.pi, nil
    newModel(st, u)
  end

  -- 全部开回（直接放回）阵位
  function G.homeSnap(st)
    for _, u in pairs(st.units) do
      u.path = nil
      u.x, u.y, u.z, u.h = u.sx, 0, u.sz, math.pi
      setFly(u, false)
      if u.root and u.root.Parent then u.root.CFrame = G.unitCF(st.plot.origin, u.x, 0, u.z, u.h) end
    end
  end

  -- (x, z) 这个阵位空不空（跟别的部队的阵位比）
  local function spotFree(st, x, z, size, skip)
    for _, o in pairs(st.units) do
      if o ~= skip then
        local need = (size + UNITS[o.t].size) / 2 + 2
        local dx, dz = o.sx - x, o.sz - z
        if dx * dx + dz * dz < need * need then return false end
      end
    end
    return true
  end

  -- 找个空阵位：默认按兵种的 row 排在部署区里（步兵最前，火炮、火箭炮、飞机最后），从中间往两边一圈圈找
  local function rowOff(t)
    return 8 + ((UNITS[t].row or 5) - 1) * 15
  end
  local function zoneOf(size)
    local D = F.deploy
    return F.width / 2 - 10 - size / 2, D[1] + size / 2 + 2, D[2] - size / 2 - 2
  end
  local function freeSpot(st, t, nearX, nearZ, skip)
    local size = UNITS[t].size
    local xmax, z1, z2 = zoneOf(size)
    local x0 = math.clamp(nearX or 0, -xmax, xmax)
    local z0 = math.clamp(nearZ or (F.deploy[2] - rowOff(t)), z1, z2)
    local step = size + 3
    for ring = 0, 16 do
      local n = math.max(1, ring * 8)
      for k = 0, n - 1 do
        local a = k / n * math.pi * 2
        local x = x0 + math.cos(a) * ring * step
        local z = z0 + math.sin(a) * ring * step * 0.6
        if math.abs(x) <= xmax and z >= z1 and z <= z2 and spotFree(st, x, z, size, skip) then
          return x, z
        end
      end
    end
    return x0, z0
  end

  -- 新兵从工厂开出来：出门 → 横通道（z = 60）→ 中间通道 → 路上 → 阵位（直升机直接飞过去；喷气机在空军基地的跑道上滑跑起飞）
  local function exitPath(u, b)
    local def = UNITS[u.t]
    if def.jet and b.id == "airbase" then
      local rz0, rz1 = b.z - b.size[3] / 2 + 14, b.z + b.size[3] / 2 - 10
      u.x, u.z, u.h = b.x, rz0, math.pi
      u.path = { { x = b.x, z = rz1, y = 0 }, { x = b.x, z = rz1 + 90, y = 30 }, { x = u.sx, z = u.sz, y = 50 }, { x = u.sx, z = u.sz, y = 0 } }
      setFly(u, true)
    elseif def.air then
      u.path = { { x = b.x, z = b.z, y = 40 }, { x = u.sx, z = u.sz, y = 40 }, { x = u.sx, z = u.sz, y = 0 } }
      setFly(u, true)
    else
      local gx = math.clamp(b.x, -60, 45)
      u.path = {
        { x = b.x, z = b.z + b.size[3] / 2 + 6, y = 0 },
        { x = b.x, z = 60, y = 0 },
        { x = gx, z = 60, y = 0 },
        { x = gx, z = ROADZ, y = 0 },
        { x = u.sx, z = u.sz, y = 0 },
      }
    end
  end

  -- 开到新位置（直升机先升空再落）
  function G.goTo(u, x, z)
    if UNITS[u.t].air then
      local cruise = math.max(u.y, 24)
      u.path = { { x = u.x, z = u.z, y = cruise }, { x = x, z = z, y = cruise }, { x = x, z = z, y = 0 } }
      setFly(u, true)
    else
      u.path = { { x = x, z = z, y = 0 } }
    end
  end

  local function stepPath(st, u, dt)
    local wp = u.path[1]
    local def = UNITS[u.t]
    local sp = (def.jet and 90 or def.air and 50 or def.speed * 1.6) * dt
    local dx, dy, dz = wp.x - u.x, wp.y - u.y, wp.z - u.z
    local dist = math.sqrt(dx * dx + dy * dy + dz * dz)
    if dist <= sp then
      u.x, u.y, u.z = wp.x, wp.y, wp.z
      table.remove(u.path, 1)
      if #u.path == 0 then
        u.path = nil
        u.h = math.pi
        setFly(u, false)
      end
    else
      u.x = u.x + dx / dist * sp
      u.y = u.y + dy / dist * sp
      u.z = u.z + dz / dist * sp
      if dx * dx + dz * dz > 0.04 then Battle.turn(u, dx, dz, dt, 4) end
    end
    if u.root and u.root.Parent then u.root.CFrame = G.unitCF(st.plot.origin, u.x, u.y, u.z, u.h) end
  end

  -- 每帧：平时（不在打仗）的部队开来开去
  function G.armyStep(dt)
    for _, st in pairs(G.states) do
      if st.ready and not st.battle then
        for _, u in pairs(st.units) do
          if u.path then stepPath(st, u, dt) end
        end
      end
    end
  end

  function G.buyUnit(st, t)
    if not st.ready then return end
    local def = UNITS[t]
    if not def or def.boss then return end
    local d = st.data
    local src = BDEF[Config.UnitSource[t]]
    if not src or not d.owned[src.id] then
      G.toast(st, "先盖" .. (src and src.name or "工厂") .. "才能生产" .. def.name, "bad")
      return
    end
    if def.needHQ and d.hq < def.needHQ then
      G.toast(st, def.name .. "要指挥部 " .. def.needHQ .. " 级", "bad")
      return
    end
    if st.battle then
      G.toast(st, "打仗的时候不能生产", "bad")
      return
    end
    local cap = G.capOf(d)
    if G.count(st) >= cap then
      G.toast(st, "部队满了（" .. cap .. "）：" .. (d.owned.hq and "升级指挥部能带更多" or "盖指挥部能带更多"), "bad")
      return
    end
    if d.cash < def.price then
      G.toast(st, "钱不够：" .. def.name .. " 还差 $" .. Config.Fmt(def.price - d.cash), "bad")
      return
    end
    d.cash = d.cash - def.price
    local x, z = freeSpot(st, t)
    local u = G.spawnUnit(st, t, src.x, src.z, def.air and 0.8 or 0, math.pi)
    u.sx, u.sz = x, z
    exitPath(u, src)
    G.progress(st, "make", 1)
    G.push(st)
  end

  function G.moveUnit(st, uid, x, z)
    if st.battle then return end
    if type(uid) ~= "number" or type(x) ~= "number" or type(z) ~= "number" then return end
    if x ~= x or z ~= z then return end
    local u = st.units[uid]
    if not u then return end
    local size = UNITS[u.t].size
    local xmax, z1, z2 = zoneOf(size)
    x = math.clamp(x, -xmax, xmax)
    z = math.clamp(z, z1, z2)
    if not spotFree(st, x, z, size, u) then x, z = freeSpot(st, u.t, x, z, u) end
    u.sx, u.sz = x, z
    G.goTo(u, x, z)
  end

  function G.sellUnit(st, uid)
    if st.battle then return end
    local u = st.units[uid]
    if not u then return end
    local refund = math.floor(UNITS[u.t].price * 0.5)
    st.data.cash = st.data.cash + refund
    if u.model then u.model:Destroy() end
    st.units[uid] = nil
    G.toast(st, "解散" .. UNITS[u.t].name .. "，退回 $" .. Config.Fmt(refund), "info")
    G.push(st)
  end

  function G.arrange(st)
    if st.battle then return end
    local list = {}
    for _, u in pairs(st.units) do table.insert(list, u) end
    if #list == 0 then return end
    -- 和 Battle.formation 一样的顺序（row，再按兵种名），同兵种按编号
    table.sort(list, function(a, b)
      if a.t ~= b.t then return Battle.order(a.t, b.t) end
      return a.uid < b.uid
    end)
    local types = {}
    for i, u in ipairs(list) do types[i] = u.t end
    local slots = Battle.formation(types, F.deploy[2] - 4, -1, F.deploy[2] - F.deploy[1] - 8)
    for i, u in ipairs(list) do
      local s = slots[i]
      if s then
        u.sx, u.sz = s.x, s.z
        G.goTo(u, s.x, s.z)
      end
    end
    G.toast(st, "排好了：步兵在前，装甲、防空、直升机，火炮、火箭炮、飞机在最后", "info")
  end

  -- 这一关的敌军先摆在敌军区（开打前就能看到对面有什么）
  function G.makeEnemy(st)
    st.plot.Enemies:ClearAllChildren()
    st.enemy = {}
    local list, hm, dm = Battle.genEnemy(st.data.level)
    local slots = Battle.formation(list, F.enemy[1] + 4, 1, F.enemy[2] - F.enemy[1] - 8)
    for i, s in ipairs(slots) do
      local model, root = Models.unit(s.t, Config.EnemyColor)
      model.Name = "E" .. i
      model:SetAttribute("Type", s.t)
      model:SetAttribute("Fly", false)
      model.Parent = st.plot.Enemies
      root.CFrame = G.unitCF(st.plot.origin, s.x, 0, s.z, 0)
      table.insert(st.enemy, { t = s.t, x = s.x, z = s.z, model = model, root = root, hm = hm, dm = dm })
    end
  end

  -- 进服：按存档摆部队（阵位不在部署区里的重新找）
  function G.armySetup(st)
    local cap = G.capOf(st.data)
    for _, a in ipairs(st.data.army) do
      if G.count(st) < cap then
        local size = UNITS[a.t].size
        local xmax, z1, z2 = zoneOf(size)
        local x, z = a.x, a.z
        if math.abs(x) > xmax or z < z1 or z > z2 or not spotFree(st, x, z, size) then
          x, z = freeSpot(st, a.t)
        end
        G.spawnUnit(st, a.t, x, z, 0, math.pi)
      end
    end
    st.data.army = {}
  end
end

return Army
