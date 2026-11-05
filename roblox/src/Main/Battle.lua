-- 军事大亨：战斗推演（服务器）。只管数字：位置、血量、选目标、开火、溅射、炮弹 / 火箭弹落地；
-- 模型、特效、玩家角色的血交给调用方传进来的回调 B.cb（world / muzzle / aim / fx / hurt / die / heroHurt / kill）。
-- 坐标都是相对战场原点的 (x, z)；y 是离地高度（直升机）；h 是车身朝向（CFrame.Angles(0, h, 0)，模型正前方 −Z），ty 是炮塔相对车身的转角。
-- 单位：u = { t, def, team, x, y, z, h, ty, hp, max, dm（伤害倍数）, cd, rt, alive, tgt, hero（玩家本人）, driver（玩家在开）, hold（守着不出击）}
local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))

local Battle = {}

local F = Config.Field
local XMAX = F.width / 2 - 6
local ZMIN = F.center - F.length / 2 + 5
local ZMAX = F.center + F.length / 2 - 5
local TURRET = { ifv = true, tank = true, aa = true, arty = true, boss = true }

Battle.HERO = { name = "玩家", hp = Config.Hero.hp, size = Config.Hero.size, speed = 0, range = 0, hero = true }

local function canHit(ad, td)
  if td.air then return ad.hitsAir == true end
  return true
end
Battle.canHit = canHit

-- 伤害倍数：按目标是飞机 / 装甲 / 步兵（玩家本人算步兵）
local function mult(ad, td)
  if td.air then return ad.vsAir or 0 end
  if td.armor then return ad.vsArmor or 1 end
  return ad.vsInf or 1
end
Battle.mult = mult

local function prefers(ad, td)
  local p = ad.prefer
  if p == "air" then return td.air == true end
  if p == "armor" then return td.armor == true end
  if p == "inf" then return not td.armor and not td.air end
  return false
end

local function wrap(a)
  return (a + math.pi) % (2 * math.pi) - math.pi
end

-- 选目标：最近的、能打的；喜欢的兵种算近四成；够不着的近距离目标（火炮）往后排；原来的目标稍微优先；玩家本人略微优先（敌人认得出指挥官）
local function pick(U, u)
  local d = u.def
  local best, bs = nil, math.huge
  for _, e in ipairs(U) do
    if e.alive and e.team ~= u.team and canHit(d, e.def) then
      local dx, dz = e.x - u.x, e.z - u.z
      local s = math.sqrt(dx * dx + dz * dz)
      if d.minRange and s < d.minRange then s = s + 400 end
      if prefers(d, e.def) then s = s * 0.6 end
      if e.hero then s = s * 0.8 end
      if e == u.tgt then s = s * 0.85 end
      if s < bs then
        bs, best = s, e
      end
    end
  end
  return best
end

local function hurt(B, u, dmg, src)
  if not u.alive or dmg <= 0 then return false end
  if u.hero then
    B.cb.heroHurt(u, dmg)
    return false
  end
  u.hp = u.hp - dmg
  if u.hp <= 0 then
    u.hp = 0
    u.alive = false
    B.cb.die(u)
    if src and B.cb.kill then B.cb.kill(u, src) end
    return true
  end
  B.cb.hurt(u)
  return false
end

-- 外部伤害（玩家开枪、开的车开火）：src = { team, player, drive }；返回打没打死
function Battle.damage(B, u, dmg, src)
  return hurt(B, u, dmg, src)
end

-- 溅射：地面单位按离爆点的距离衰减（中心满伤，边上四成）；ad 是攻击方的兵种（算伤害倍数）
local function splash(B, team, ad, x, z, r, dmg, skip, src)
  for _, e in ipairs(B.units) do
    if e.alive and e.team ~= team and e ~= skip and not e.def.air then
      local dx, dz = e.x - x, e.z - z
      local dd = math.sqrt(dx * dx + dz * dz)
      local reach = r + e.def.size * 0.3
      if dd < reach then
        local k = 1 - 0.6 * math.min(1, dd / reach)
        hurt(B, e, dmg * k * mult(ad, e.def), src)
      end
    end
  end
end
Battle.splash = splash

-- 抛射弹（火炮炮弹、火箭炮火箭弹）：飞一会儿才落地
local function lob(B, u, x, z, scatter, flight, kind, src)
  local a = math.random() * math.pi * 2
  local r = math.random() * scatter
  local sx, sz = x + math.cos(a) * r, z + math.sin(a) * r
  table.insert(B.shells, { at = B.t + flight, x = sx, z = sz, team = u.team, def = u.def, dm = u.dm, src = src })
  B.cb.fx({ k = kind, a = B.cb.muzzle(u), b = B.cb.world(sx, 0, sz), t = flight })
end

local function fire(B, u, t, dist)
  local d = u.def
  if d.salvo then   -- 火箭炮：一轮几发，陆续发射
    u.salvoLeft = d.salvo
    u.salvoAt = B.t
    u.salvoX, u.salvoZ = t.x + (t.vx or 0) * 2, t.z + (t.vz or 0) * 2
    return
  end
  if d.minRange and d.splash then   -- 火炮：抛物线炮弹，落点有散布，打移动目标往前估一点
    local fl = 1.2 + dist / 170
    lob(B, u, t.x + (t.vx or 0) * fl * 0.5, t.z + (t.vz or 0) * fl * 0.5, 14, fl, "shell")
    return
  end
  local hitP = 0.92
  if t.def.air then
    hitP = 0.75
    if u.t == "inf" then hitP = 0.5 end
  end
  if t.hero then hitP = hitP * 0.7 end
  local hit = math.random() < hitP
  local dmg = d.dmg * u.dm
  if hit then hurt(B, t, dmg * mult(d, t.def)) end
  if d.splash and not t.def.air then splash(B, u.team, d, t.x, t.z, d.splash, dmg * 0.5, t) end
  B.cb.fx({ k = "shot", u = u.t, a = B.cb.muzzle(u), b = B.cb.aim(t, hit) })
end

local function salvoStep(B, u)
  if not u.salvoLeft or u.salvoLeft <= 0 then return end
  if B.t < u.salvoAt then return end
  u.salvoLeft = u.salvoLeft - 1
  u.salvoAt = B.t + 0.25
  local dx, dz = u.salvoX - u.x, u.salvoZ - u.z
  local fl = 2 + math.sqrt(dx * dx + dz * dz) / 220
  lob(B, u, u.salvoX, u.salvoZ, 30, fl, "mrocket", u.driver and { team = u.team, player = u.driver, drive = true } or nil)
end

local function shells(B)
  local i = 1
  while i <= #B.shells do
    local s = B.shells[i]
    if B.t >= s.at then
      table.remove(B.shells, i)
      splash(B, s.team, s.def, s.x, s.z, s.def.splash or 10, s.def.dmg * s.dm, nil, s.src)
      B.cb.fx({ k = "boom", p = B.cb.world(s.x, 0, s.z), s = (s.def.salvo and 1.5) or 1.3 })
    else
      i = i + 1
    end
  end
end

-- 转向：最多每秒 rate 弧度，朝 (dx, dz)
local function turn(u, dx, dz, dt, rate)
  if dx == 0 and dz == 0 then return end
  local want = math.atan2(-dx, -dz)
  local diff = wrap(want - u.h)
  local m = rate * dt
  if diff > m then diff = m elseif diff < -m then diff = -m end
  u.h = u.h + diff
end
Battle.turn = turn

-- 炮塔对准世界方向 (dx, dz)：转角相对车身
local function aimTurret(u, dx, dz, dt)
  local want = wrap(math.atan2(-dx, -dz) - u.h)
  local diff = wrap(want - (u.ty or 0))
  local m = 2.6 * dt
  if diff > m then diff = m elseif diff < -m then diff = -m end
  u.ty = wrap((u.ty or 0) + diff)
  return math.abs(wrap(want - u.ty))
end
Battle.aimTurret = aimTurret

local function act(B, u, dt)
  local d = u.def
  u.cd = u.cd - dt
  salvoStep(B, u)
  if d.air and u.y < d.alt then u.y = math.min(d.alt, u.y + 16 * dt) end
  local t = u.tgt
  local mx, mz = 0, 0
  local inRange = false
  if t then
    local dx, dz = t.x - u.x, t.z - u.z
    local dist = math.sqrt(dx * dx + dz * dz)
    local tooClose = d.minRange ~= nil and dist < d.minRange
    if tooClose then
      mx, mz = -dx, -dz            -- 火炮被贴近：往后退
    elseif dist > d.range * 0.92 and not (u.hold and dist > d.range * 1.6) then
      mx, mz = dx, dz              -- 够不着：往前走（守方等敌人走近了才出击）
    end
    if dist <= d.range and not tooClose then
      inRange = true
      local err = 0
      if TURRET[u.t] then
        err = aimTurret(u, dx, dz, dt)
        if mx == 0 and mz == 0 then turn(u, dx, dz, dt, 0.8) end   -- 停下打的时候车身慢慢转正
      elseif d.side then
        turn(u, dz, -dx, dt, 1.6)  -- 火箭炮发射箱朝右：右侧对准目标
        local want = math.atan2(-dz, dx)
        err = math.abs(wrap(want - u.h))
      else
        turn(u, dx, dz, dt, d.air and 3 or 2.4)
      end
      local ready = ((not d.air) or u.y >= d.alt * 0.5) and err < 0.35
      if u.cd <= 0 and ready then
        fire(B, u, t, dist)
        u.cd = d.rate * (0.85 + math.random() * 0.3)
      end
    elseif TURRET[u.t] then
      aimTurret(u, dx, dz, dt)
    end
  end
  u.moving = false
  u.vx, u.vz = 0, 0
  if mx ~= 0 or mz ~= 0 then
    local l = math.sqrt(mx * mx + mz * mz)
    local sp = d.speed * dt
    local nx, nz = mx / l * sp, mz / l * sp
    u.x = u.x + nx
    u.z = u.z + nz
    u.vx, u.vz = nx / dt, nz / dt
    u.moving = true
    if TURRET[u.t] or not inRange then turn(u, mx, mz, dt, 3) end
  end
  if u.x > XMAX then u.x = XMAX elseif u.x < -XMAX then u.x = -XMAX end
  if u.z > ZMAX then u.z = ZMAX elseif u.z < ZMIN then u.z = ZMIN end
end

-- 挤在一起的推开一点（地面和地面、飞机和飞机；玩家本人和玩家在开的车不推——位置归玩家）
local function separate(U)
  local n = #U
  for i = 1, n do
    local a = U[i]
    if a.alive and not a.hero then
      for j = i + 1, n do
        local b = U[j]
        if b.alive and not b.hero and (a.def.air == true) == (b.def.air == true) then
          local dx, dz = b.x - a.x, b.z - a.z
          local need = (a.def.size + b.def.size) * 0.5
          local d2 = dx * dx + dz * dz
          if d2 < need * need then
            local dd = math.sqrt(d2)
            if dd < 0.01 then
              local r = math.random() * math.pi * 2
              dx, dz, dd = math.cos(r), math.sin(r), 1
            end
            local push = math.min(1.2, (need - dd) * 0.5)
            local ux, uz = dx / dd, dz / dd
            if not a.driver then a.x, a.z = a.x - ux * push, a.z - uz * push end
            if not b.driver then b.x, b.z = b.x + ux * push, b.z + uz * push end
          end
        end
      end
    end
  end
end

-- 玩家开的车开火：打瞄准点附近的敌人（直瞄），没打着也在瞄准点炸（有溅射的）；返回开没开火
function Battle.driveFire(B, u, ax, az, ay)
  local d = u.def
  if not u.alive or u.cd > 0 then return false end
  local dx, dz = ax - u.x, az - u.z
  local dist = math.sqrt(dx * dx + dz * dz)
  if dist > d.range * 1.15 then return false end
  if d.minRange and dist < d.minRange * 0.6 then return false end
  u.cd = d.rate
  local src = { team = u.team, player = u.driver, drive = true }
  if d.salvo then
    u.salvoLeft = d.salvo
    u.salvoAt = B.t
    u.salvoX, u.salvoZ = ax, az
    return true
  end
  if d.minRange and d.splash then
    lob(B, u, ax, az, 6, 1.2 + dist / 170, "shell", src)
    return true
  end
  -- 直瞄：瞄准点附近（目标大小以内）最近的敌人
  local best, bd = nil, math.huge
  for _, e in ipairs(B.units) do
    if e.alive and e.team ~= u.team and canHit(d, e.def) then
      local ex, ez = e.x - ax, e.z - az
      local ey = (e.y or 0) - (ay or 0)
      local dd = math.sqrt(ex * ex + ez * ez + ey * ey * 0.3)
      if dd < e.def.size * 0.6 + 6 and dd < bd then best, bd = e, dd end
    end
  end
  local dmg = d.dmg * u.dm
  if best then hurt(B, best, dmg * mult(d, best.def), src) end
  if d.splash then splash(B, u.team, d, ax, az, d.splash, dmg * 0.5, best, src) end
  B.cb.fx({ k = "shot", u = u.t, a = B.cb.muzzle(u), b = best and B.cb.aim(best, true) or B.cb.world(ax, ay or 0, az) })
  return true
end

-- 推演一步；返回 nil（继续）或 "win" / "lose" / "timeout"（按第 1 队算；玩家本人不算兵力）
function Battle.step(B, dt)
  B.t = B.t + dt
  local U = B.units
  for _, u in ipairs(U) do
    if u.alive and not u.hero and not u.driver then
      u.rt = u.rt - dt
      if u.rt <= 0 or not (u.tgt and u.tgt.alive) then
        u.tgt = pick(U, u)
        u.rt = 0.4 + math.random() * 0.4
      end
    end
  end
  for _, u in ipairs(U) do
    if u.alive and not u.hero then
      if u.driver then
        u.cd = u.cd - dt
        salvoStep(B, u)
      else
        act(B, u, dt)
      end
    end
  end
  separate(U)
  shells(B)
  local a, e = 0, 0
  for _, u in ipairs(U) do
    if u.alive and not u.hero then
      if u.team == 1 then a = a + 1 else e = e + 1 end
    end
  end
  B.alive1, B.alive2 = a, e
  if e == 0 then return "win" end
  if a == 0 then return "lose" end
  if B.t >= Config.BattleTime then return "timeout" end
  return nil
end

-- 关卡敌军：按预算随机买兵（同一关每次都一样）；超过人数上限的预算换成属性加成；首领关多一辆猛犸重坦
local W = { inf = 3, ifv = 1.6, tank = 2.2, aa = 1, arty = 1.2, mlrs = 0.7, heli = 1.4 }
function Battle.genEnemy(level)
  local budget = Config.EnemyBudget(level)
  local types = Config.EnemyTypes(level)
  local rng = Random.new(level * 7919 + 101)
  local list, spent = {}, 0
  while #list < Config.MaxEnemy do
    local cand, tw = {}, 0
    for _, t in ipairs(types) do
      if spent + Config.Units[t].price <= budget then
        table.insert(cand, t)
        tw = tw + (W[t] or 1)
      end
    end
    if #cand == 0 then break end
    local r = rng:NextNumber() * tw
    local pickT = cand[#cand]
    for _, t in ipairs(cand) do
      r = r - (W[t] or 1)
      if r <= 0 then
        pickT = t
        break
      end
    end
    table.insert(list, pickT)
    spent = spent + Config.Units[pickT].price
  end
  if #list == 0 then
    list = { "inf" }
    spent = Config.Units.inf.price
  end
  local k = 1
  if budget > spent * 1.05 then k = budget / spent end
  local m = math.sqrt(k)
  if Config.IsBoss(level) then table.insert(list, "boss") end
  return list, m, m   -- 兵种列表、血量倍数、伤害倍数
end

-- 排阵：前排步兵，然后步战车、坦克、首领、防空、直升机，最后火炮、火箭炮；同兵种一排排开（太宽就分两排）
-- zFront 是第一排前沿的 Z，dir 是往后排的方向（我方 −1，敌方 +1），depth 是可用纵深（排不下就压紧）
Battle.ROW = { inf = 1, ifv = 2, tank = 3, boss = 4, aa = 5, heli = 6, arty = 7, mlrs = 8 }
function Battle.formation(types, zFront, dir, depth)
  local ROW = Battle.ROW
  local list = {}
  for i, t in ipairs(types) do list[i] = t end
  table.sort(list, function(a, b) return ROW[a] < ROW[b] end)
  local rows = {}
  local i = 1
  while i <= #list do
    local t = list[i]
    local s = Config.Units[t].size + 6
    local maxN = math.max(1, math.floor((F.width - 40) / s))
    local j = i
    while j <= #list and list[j] == t and j - i < maxN do j = j + 1 end
    table.insert(rows, { t = t, n = j - i, s = s })
    i = j
  end
  local total = 0
  for _, r in ipairs(rows) do total = total + r.s end
  local k = 1
  if depth and total > depth then k = depth / total end
  local out = {}
  local z = zFront
  for _, r in ipairs(rows) do
    local zc = z + dir * r.s * k / 2
    for c = 0, r.n - 1 do
      table.insert(out, { t = r.t, x = (c - (r.n - 1) / 2) * r.s, z = zc })
    end
    z = z + dir * r.s * k
  end
  return out
end

return Battle
