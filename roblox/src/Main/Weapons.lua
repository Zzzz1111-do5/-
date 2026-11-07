-- 军事大亨：玩家本人的武器（背包里的枪）：发枪、开枪（服务器校验射速、弹匣、射程，射线判定打中谁）、
-- 火箭筒弹道和溅射；打仗时打敌方单位，约战时也能打对面的玩家本人；不在打仗时开枪只有特效
local Weapons = {}

function Weapons.init(G)
  local Config, Models, Battle = G.Config, G.Models, G.Battle
  local V = Vector3.new
  local TOOLS = {}
  for _, id in ipairs(Config.WeaponOrder) do TOOLS[id] = Models.tool(id) end

  -- 背包里补上买了的枪（每次复活都要发）
  function G.giveTools(st)
    local pl = st.pl
    local bp = pl:FindFirstChild("Backpack")
    if not bp or not st.data then return end
    local have = {}
    local char = pl.Character
    for _, holder in ipairs({ bp, char }) do
      if holder then
        for _, c in ipairs(holder:GetChildren()) do
          if c:IsA("Tool") then have[c:GetAttribute("Weapon") or ""] = true end
        end
      end
    end
    for _, id in ipairs(Config.WeaponOrder) do
      if st.data.weapons[id] and not have[id] then TOOLS[id]:Clone().Parent = bp end
    end
  end

  local function ammoOf(st, id)
    st.ammo = st.ammo or {}
    local a = st.ammo[id]
    if not a then
      a = { n = Config.Weapons[id].mag, r = 0 }
      st.ammo[id] = a
    end
    if a.r > 0 and os.clock() >= a.r then
      a.n = Config.Weapons[id].mag
      a.r = 0
    end
    return a
  end

  function G.reload(st, id)
    local w = Config.Weapons[id]
    if not w then return end
    local a = ammoOf(st, id)
    if a.r > 0 or a.n >= w.mag then return end
    a.r = os.clock() + w.reload
  end

  -- 打中的零件属于哪个战斗单位（单位模型、玩家角色上都有 BU 属性）
  local function unitOf(B, inst)
    local m = inst
    while m and m ~= workspace do
      if m:IsA("Model") then
        local bid = m:GetAttribute("BU")
        if bid then return B.byId[bid] end
      end
      m = m.Parent
    end
    return nil
  end

  local function hitUnit(B, st, team, w, inst)
    local bu = unitOf(B, inst)
    if not bu or not bu.alive or bu.team == team then return end
    if bu.hero then   -- 约战：打到对面的玩家本人
      local hum = bu.model and bu.model:FindFirstChildOfClass("Humanoid")
      if hum and hum.Health > 0 then
        hum:TakeDamage(w.dmg * (w.pvp or 1))
        if hum.Health <= 0 then G.addXP(st, 10) end
      end
      return
    end
    Battle.damage(B, bu, w.dmg * Battle.mult(w, bu.def), { team = team, player = st.pl })
  end

  -- 火箭弹落地：地面单位（和玩家本人）按溅射，直升机要打得够近
  local function explode(B, st, team, w, pos)
    if B.over then return end
    local rel = pos - B.origin
    local src = { team = team, player = st.pl }
    Battle.splash(B, team, w, rel.X, rel.Z, w.splash, w.dmg, nil, src)
    for _, bu in ipairs(B.units) do
      if bu.alive and bu.team ~= team and bu.def.air then
        local p = B.origin + V(bu.x, 1 + bu.y + 3, bu.z)
        if (p - pos).Magnitude < bu.def.size * 0.6 + 4 then Battle.damage(B, bu, w.dmg * Battle.mult(w, bu.def), src) end
      end
    end
    G.fx({ k = "boom", p = pos, s = 1.2 })
  end

  local params = RaycastParams.new()
  params.FilterType = Enum.RaycastFilterType.Exclude

  function G.shoot(st, id, aim)
    local w = Config.Weapons[id]
    if not w or not st.ready or not st.data.weapons[id] or typeof(aim) ~= "Vector3" or aim.X ~= aim.X then return end
    local char = st.pl.Character
    local hum = char and char:FindFirstChildOfClass("Humanoid")
    local head = char and char:FindFirstChild("Head")
    if not hum or hum.Health <= 0 or not head or st.driving then return end
    local tool = char:FindFirstChildOfClass("Tool")
    if not tool or tool:GetAttribute("Weapon") ~= id then return end
    local now = os.clock()
    st.lastShot = st.lastShot or {}
    if now - (st.lastShot[id] or 0) < w.rate * 0.8 then return end
    local a = ammoOf(st, id)
    if a.r > 0 or a.n <= 0 then return end
    st.lastShot[id] = now
    a.n = a.n - 1
    if a.n <= 0 then a.r = now + w.reload end
    local origin = head.Position
    local dir = aim - origin
    if dir.Magnitude < 0.5 then return end
    dir = dir.Unit
    if w.spread > 0 then
      local s = math.rad(w.spread)
      dir = (dir + V((math.random() - 0.5) * 2 * s, (math.random() - 0.5) * 2 * s, (math.random() - 0.5) * 2 * s)).Unit
    end
    params.FilterDescendantsInstances = { char }
    local res = workspace:Raycast(origin, dir * w.range, params)
    local hitPos = res and res.Position or (origin + dir * w.range)
    local handle = tool:FindFirstChild("Handle")
    local mz = handle and handle:FindFirstChild("Muzzle")
    local muzzle = mz and mz.WorldPosition or origin
    local flight = nil
    if w.proj then flight = (hitPos - muzzle).Magnitude / w.speed end
    G.fx({ k = "gun", w = id, a = muzzle, b = hitPos, by = st.pl.UserId, t = flight })
    local B = st.battle
    if not B or B.over then return end
    local team = B.teamOf[st.pl]
    if w.proj then
      task.delay(flight, function() explode(B, st, team, w, hitPos) end)
    elseif res then
      hitUnit(B, st, team, w, res.Instance)
    end
  end
end

return Weapons
