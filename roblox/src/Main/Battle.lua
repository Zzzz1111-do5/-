-- 军事大亨：战斗推演（服务器）。只管数字：位置、血量、选目标、开火、溅射、炮弹落地；
-- 模型和特效交给 Main 传进来的回调 B.cb（world / muzzle / aim / fx / hurt / die）。
-- 坐标都是相对基地中心的 (x, z)；y 是离地高度（直升机）；h 是朝向角（CFrame.Angles(0, h, 0)，模型正前方 -Z）
local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))

local Battle = {}

local F = Config.Field
local XMAX = F.width / 2 - 5
local ZMIN = F.center - F.length / 2 + 4
local ZMAX = F.center + F.length / 2 - 4

local function canHit(ad, td)
  if td.air then return ad.hitsAir == true end
  return true
end

-- 伤害倍数：按目标是飞机 / 装甲 / 步兵
local function mult(ad, td)
  if td.air then return ad.vsAir or 0 end
  if td.armor then return ad.vsArmor or 1 end
  return ad.vsInf or 1
end

local function prefers(ad, td)
  local p = ad.prefer
  if p == "air" then return td.air == true end
  if p == "armor" then return td.armor == true end
  if p == "inf" then return not td.armor and not td.air end
  return false
end

-- 选目标：最近的、能打的；喜欢的兵种算近四成；火炮够不着的近距离目标往后排；原来的目标稍微优先（别来回换）
local function pick(U, u)
  local d = u.def
  local best, bs = nil, math.huge
  for _, e in ipairs(U) do
    if e.alive and e.team ~= u.team and canHit(d, e.def) then
      local dx, dz = e.x - u.x, e.z - u.z
      local s = math.sqrt(dx * dx + dz * dz)
      if d.minRange and s < d.minRange then s = s + 400 end
      if prefers(d, e.def) then s = s * 0.6 end
      if e == u.tgt then s = s * 0.85 end
      if s < bs then
        bs, best = s, e
      end
    end
  end
  return best
end

local function hurt(B, u, dmg)
  if not u.alive or dmg <= 0 then return end
  u.hp = u.hp - dmg
  if u.hp <= 0 then
    u.hp = 0
    u.alive = false
    B.cb.die(u)
  else
    B.cb.hurt(u)
  end
end

-- 溅射：att 只要有 team、def；地面单位按离爆点的距离衰减（中心满伤，边上四成）
local function splash(B, att, x, z, r, dmg, skip)
  for _, e in ipairs(B.units) do
    if e.alive and e.team ~= att.team and e ~= skip and not e.def.air then
      local dx, dz = e.x - x, e.z - z
      local dd = math.sqrt(dx * dx + dz * dz)
      local reach = r + e.def.size * 0.3
      if dd < reach then
        local k = 1 - 0.6 * math.min(1, dd / reach)
        hurt(B, e, dmg * k * mult(att.def, e.def))
      end
    end
  end
end

local function fire(B, u, t, dist)
  local d = u.def
  if d.minRange and d.splash then
    -- 火炮：抛物线炮弹，飞一会儿才落地；落点有散布，打移动目标往前估一点
    local fl = 1.2 + dist / 170
    local a = math.random() * math.pi * 2
    local r = math.random() * 6
    local sx = t.x + math.cos(a) * r + (t.vx or 0) * fl * 0.5
    local sz = t.z + math.sin(a) * r + (t.vz or 0) * fl * 0.5
    table.insert(B.shells, { at = B.t + fl, x = sx, z = sz, team = u.team, def = d, dm = u.dm })
    B.cb.fx({ k = "shell", a = B.cb.muzzle(u), b = B.cb.world(sx, 0, sz), t = fl })
    return
  end
  local hitP = 0.92
  if t.def.air then
    hitP = 0.75
    if u.t == "inf" then hitP = 0.5 end
  end
  local hit = math.random() < hitP
  local dmg = d.dmg * u.dm
  if hit then hurt(B, t, dmg * mult(d, t.def)) end
  if d.splash and not t.def.air then splash(B, u, t.x, t.z, d.splash, dmg * 0.5, t) end
  B.cb.fx({ k = "shot", u = u.t, a = B.cb.muzzle(u), b = B.cb.aim(t, hit) })
end

local function shells(B)
  local i = 1
  while i <= #B.shells do
    local s = B.shells[i]
    if B.t >= s.at then
      table.remove(B.shells, i)
      splash(B, s, s.x, s.z, s.def.splash, s.def.dmg * s.dm, nil)
      B.cb.fx({ k = "boom", p = B.cb.world(s.x, 0, s.z), s = 1.3 })
    else
      i = i + 1
    end
  end
end

-- 转向：最多每秒 rate 弧度
local function turn(u, dx, dz, dt, rate)
  if dx == 0 and dz == 0 then return end
  local want = math.atan2(-dx, -dz)
  local diff = (want - u.h + math.pi) % (2 * math.pi) - math.pi
  local m = rate * dt
  if diff > m then diff = m elseif diff < -m then diff = -m end
  u.h = u.h + diff
end
Battle.turn = turn

local function act(B, u, dt)
  local d = u.def
  u.cd = u.cd - dt
  if d.air and u.y < d.alt then u.y = math.min(d.alt, u.y + 12 * dt) end
  local t = u.tgt
  local mx, mz = 0, 0
  local inRange = false
  if t then
    local dx, dz = t.x - u.x, t.z - u.z
    local dist = math.sqrt(dx * dx + dz * dz)
    local tooClose = d.minRange ~= nil and dist < d.minRange
    if tooClose then
      mx, mz = -dx, -dz            -- 火炮被贴近：往后退
    elseif dist > d.range * 0.92 then
      mx, mz = dx, dz              -- 够不着：往前走
    end
    if dist <= d.range and not tooClose then
      inRange = true
      turn(u, dx, dz, dt, d.air and 3 or 2.4)
      local ready = (not d.air) or u.y >= d.alt * 0.5
      if u.cd <= 0 and ready then
        fire(B, u, t, dist)
        u.cd = d.rate * (0.85 + math.random() * 0.3)
      end
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
    if not inRange then turn(u, mx, mz, dt, 4) end
  end
  if u.x > XMAX then u.x = XMAX elseif u.x < -XMAX then u.x = -XMAX end
  if u.z > ZMAX then u.z = ZMAX elseif u.z < ZMIN then u.z = ZMIN end
end

-- 挤在一起的推开一点（地面和地面、飞机和飞机）
local function separate(U)
  local n = #U
  for i = 1, n do
    local a = U[i]
    if a.alive then
      for j = i + 1, n do
        local b = U[j]
        if b.alive and (a.def.air == true) == (b.def.air == true) then
          local dx, dz = b.x - a.x, b.z - a.z
          local need = (a.def.size + b.def.size) * 0.5
          local d2 = dx * dx + dz * dz
          if d2 < need * need then
            local dd = math.sqrt(d2)
            if dd < 0.01 then
              local r = math.random() * math.pi * 2
              dx, dz, dd = math.cos(r), math.sin(r), 1
            end
            local push = math.min(0.6, (need - dd) * 0.5)
            local ux, uz = dx / dd, dz / dd
            a.x, a.z = a.x - ux * push, a.z - uz * push
            b.x, b.z = b.x + ux * push, b.z + uz * push
          end
        end
      end
    end
  end
end

-- 推演一步；返回 nil（继续）或 "win" / "lose" / "timeout"
function Battle.step(B, dt)
  B.t = B.t + dt
  local U = B.units
  for _, u in ipairs(U) do
    if u.alive then
      u.rt = u.rt - dt
      if u.rt <= 0 or not (u.tgt and u.tgt.alive) then
        u.tgt = pick(U, u)
        u.rt = 0.4 + math.random() * 0.4
      end
    end
  end
  for _, u in ipairs(U) do
    if u.alive then act(B, u, dt) end
  end
  separate(U)
  shells(B)
  local a, e = 0, 0
  for _, u in ipairs(U) do
    if u.alive then
      if u.team == 1 then a = a + 1 else e = e + 1 end
    end
  end
  B.alive1, B.alive2 = a, e
  if e == 0 then return "win" end
  if a == 0 then return "lose" end
  if B.t >= Config.BattleTime then return "timeout" end
  return nil
end

-- 关卡敌军：按预算随机买兵（同一关每次都一样）；超过人数上限的预算换成属性加成
local W = { inf = 3, tank = 2.2, aa = 1, arty = 1.2, heli = 1.4 }
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
  return list, m, m   -- 兵种列表、血量倍数、伤害倍数
end

-- 排阵：前排步兵，然后坦克、防空、直升机，最后火炮；同兵种一排排开（太宽就分两排）
-- zFront 是第一排前沿的 Z，dir 是往后排的方向（我方 -1，敌方 +1），depth 是可用纵深（排不下就压紧）
Battle.ROW = { inf = 1, tank = 2, aa = 3, heli = 4, arty = 5 }
function Battle.formation(types, zFront, dir, depth)
  local ROW = Battle.ROW
  local list = {}
  for i, t in ipairs(types) do list[i] = t end
  table.sort(list, function(a, b) return ROW[a] < ROW[b] end)
  local rows = {}
  local i = 1
  while i <= #list do
    local t = list[i]
    local s = Config.Units[t].size + 4
    local maxN = math.max(1, math.floor((F.width - 24) / s))
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
