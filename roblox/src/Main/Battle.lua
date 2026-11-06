-- 军事大亨：战斗推演（服务器）。只管数字：位置、血量、选目标、开火、溅射、炮弹 / 火箭弹 / 炸弹落地、导弹飞行、拦截、机降；
-- 模型、特效、玩家角色的血交给调用方传进来的回调 B.cb（world / muzzle / aim / fx / hurt / die / heroHurt / kill / hit / spawn）。
-- 伤害来源 src = { team, player（玩家亲手：开枪、开车、支援技能）, drive, unit（哪个单位打的：记老兵战功）}；
-- 打死的单位记进 B.deaths（战报滚动条用，Combat 每半秒发一次）。
-- 坐标都是相对战场原点的 (x, z)；y 是离地高度（飞机）；h 是车身朝向（CFrame.Angles(0, h, 0)，模型正前方 −Z），ty 是炮塔相对车身的转角。
-- 单位：u = { t, def, team, x, y, z, h, ty, hp, max, dm（伤害倍数）, cd, rt, alive, tgt, hero（玩家本人）, driver（玩家在开）, hold（守着不出击）, temp（机降的步兵）}
local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))

local Battle = {}

local F = Config.Field
local UNITS = Config.Units
local XMAX = F.width / 2 - 6
local ZMIN = F.center - F.length / 2 + 5
local ZMAX = F.center + F.length / 2 - 5
-- 喷气机转弯半径大，可以飞出战场一些（别飞到隔壁基地的战场上）
local JX = F.width / 2 + 160
local JZ0, JZ1 = ZMIN - 200, ZMAX + 200
Battle.JX, Battle.JZ0, Battle.JZ1 = JX, JZ0, JZ1
local BOMB_FALL = 2.2   -- 炸弹从投下到落地几秒（往前飘 speed × 这么远）
local nextShell = 0     -- 炮弹编号（客户端按编号找到半空中的炮弹，拦截时打爆它）

Battle.HERO = { name = "玩家", hp = Config.Hero.hp, size = Config.Hero.size, speed = 0, range = 0, hero = true, foot = true }

-- 打得到吗：飞机看飞多高（reach 是能打多高；还在地上的飞机谁都能打），只打飞机的打不了地面
local function canHit(ad, e)
  if e.def.stealth and not (ad.homing and (ad.reach or 0) >= 400) then return false end   -- 隐身：只有爱国者、战斗机够得着
  if e.def.air then return (ad.reach or 0) >= (e.y or 0) - 3 end
  return not ad.airOnly
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

-- 选目标：最近的、打得到的；喜欢的兵种算近四成；破障车（诱饵）算近一半多；够不着的近距离目标（火炮）往后排；
-- 原来的目标稍微优先；玩家本人略微优先（敌人认得出指挥官）
local function pick(U, u)
  local d = u.def
  local best, bs = nil, math.huge
  for _, e in ipairs(U) do
    if e.alive and e.team ~= u.team and canHit(d, e) then
      local dx, dz = e.x - u.x, e.z - u.z
      local s = math.sqrt(dx * dx + dz * dz)
      if d.minRange and s < d.minRange then s = s + 400 end
      if prefers(d, e.def) then s = s * 0.6 end
      if e.def.decoy then s = s * 0.45 end
      if e.def.camo then s = s * 1.6 end   -- 伪装：不显眼，排得靠后
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
    B.cb.heroHurt(u, dmg, src)
    return false
  end
  u.hp = u.hp - dmg
  local killed = false
  if u.hp <= 0 then
    u.hp = 0
    u.alive = false
    killed = true
    B.cb.die(u)
    if src then
      if src.unit and src.unit.team ~= u.team then src.unit.kills = (src.unit.kills or 0) + 1 end
      if B.cb.kill then B.cb.kill(u, src) end
    end
    if B.deaths then
      table.insert(B.deaths, { t = u.t, team = u.team, by = src and src.player and src.player.UserId or nil, uid = u.uid, owner = u.owner and u.owner.pl.UserId or nil })
    end
  else
    B.cb.hurt(u)
  end
  if src and src.player and B.cb.hit then B.cb.hit(u, dmg, killed, src) end
  return killed
end

-- 外部伤害（玩家开枪、开的车开火）：src = { team, player, drive }；返回打没打死
function Battle.damage(B, u, dmg, src)
  return hurt(B, u, dmg, src)
end

-- 溅射：地面单位按离爆点的距离衰减（中心满伤，边上四成）；ad 是攻击方的兵种（算伤害倍数）
local function splash(B, team, ad, x, z, r, dmg, skip, src)
  for _, e in ipairs(B.units) do
    if e.alive and e.team ~= team and e ~= skip and not (e.def.air and e.y > 3) then
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

-- 这一发算谁的：玩家在开的车算玩家的（亲手击毁），其余算这个单位的（老兵战功）
local function srcOf(u)
  if u.driver then return { team = u.team, player = u.driver, drive = true, unit = u } end
  return { team = u.team, unit = u }
end

-- 抛射弹（炮弹、火箭炮火箭弹、炸弹）：飞一会儿才落地；拦截炮能在半空打掉炮弹、火箭弹（炸弹不行）
local function lob(B, u, x, z, scatter, flight, kind, src)
  local a = math.random() * math.pi * 2
  local r = math.random() * scatter
  local sx, sz = x + math.cos(a) * r, z + math.sin(a) * r
  nextShell = nextShell + 1
  table.insert(B.shells, { id = nextShell, t0 = B.t, at = B.t + flight, x = sx, z = sz, team = u.team, def = u.def, dm = u.dm, src = src, kind = kind })
  B.cb.fx({ k = kind, id = nextShell, u = u.t, a = B.cb.muzzle(u), b = B.cb.world(sx, 0, sz), t = flight })
end

-- 支援火力（迫击炮急袭、炮火覆盖、空袭）：从 from（世界坐标）打一发到 (x, z) 附近（scatter 散布），flight 秒后落地；
-- def 给伤害、溅射、各类目标的倍数（同兵种表），dm 是战力倍数；kind：shell 炮弹（拦截炮能打）/ bomb 炸弹（打不了）
function Battle.strike(B, team, def, dm, x, z, scatter, flight, kind, src, from)
  local a = math.random() * math.pi * 2
  local r = math.sqrt(math.random()) * scatter
  local sx = math.clamp(x + math.cos(a) * r, -XMAX, XMAX)
  local sz = math.clamp(z + math.sin(a) * r, ZMIN, ZMAX)
  nextShell = nextShell + 1
  table.insert(B.shells, { id = nextShell, t0 = B.t, at = B.t + flight, x = sx, z = sz, team = team, def = def, dm = dm, src = src, kind = kind })
  B.cb.fx({ k = kind, id = nextShell, u = def.fxu or "skill", a = from, b = B.cb.world(sx, 0, sz), t = flight })
end
Battle.XMAX, Battle.ZMIN, Battle.ZMAX = XMAX, ZMIN, ZMAX
Battle.hurt = hurt

-- 导弹：飞到目标（客户端跟着目标画），到了才算伤害；没有目标（玩家对着地面打）就打那个点
local function missile(B, u, t, dmg, dist, src, px, py, pz)
  local d = u.def
  local fl = 0.35 + dist / (d.homing or 300)
  table.insert(B.missiles, { at = B.t + fl, tgt = t, dmg = dmg, def = d, team = u.team, src = src, x = px, z = pz })
  B.cb.fx({ k = "missile", u = u.t, a = B.cb.muzzle(u), b = t and B.cb.aim(t, true) or B.cb.world(px, py or 0, pz), bid = t and t.bid or nil, t = fl })
end

local function fire(B, u, t, dist)
  local d = u.def
  if d.kamikaze then   -- 巡飞弹：一头撞上去，连自己一起炸了
    local src = srcOf(u)
    local dmg = d.dmg * u.dm
    hurt(B, t, dmg * mult(d, t.def), src)
    splash(B, u.team, d, t.x, t.z, d.splash or 12, dmg * 0.5, t, src)
    B.cb.fx({ k = "boom", p = B.cb.world(t.x, (t.y or 0) + 2, t.z), s = 1.5 })
    u.hp = 0
    u.alive = false
    u.spent = true
    B.cb.die(u)
    return
  end
  if d.salvo then   -- 火箭炮：一轮几发，陆续发射
    u.salvoLeft = d.salvo
    u.salvoAt = B.t
    u.salvoX, u.salvoZ = t.x + (t.vx or 0) * 2, t.z + (t.vz or 0) * 2
    return
  end
  if d.bombs then   -- 轰炸机：投一串
    u.bombLeft = d.bombs
    u.bombAt = B.t
    return
  end
  if d.minRange and d.splash then   -- 火炮、迫击炮：抛物线炮弹，落点有散布，打移动目标往前估一点
    local fl = 1.2 + dist / 170
    lob(B, u, t.x + (t.vx or 0) * fl * 0.5, t.z + (t.vz or 0) * fl * 0.5, d.foot and 10 or 14, fl, "shell", srcOf(u))
    return
  end
  local dmg = d.dmg * u.dm
  if d.homing then
    missile(B, u, t, dmg, dist, srcOf(u))
    return
  end
  local hitP = d.hit or 0.92
  if t.def.air then
    hitP = t.def.jet and 0.55 or 0.75
    if d.foot then hitP = hitP * 0.65 end
  end
  if t.hero then hitP = hitP * 0.7 end
  local hit = math.random() < hitP
  local src = srcOf(u)
  if hit then hurt(B, t, dmg * mult(d, t.def), src) end
  if d.splash and not t.def.air then splash(B, u.team, d, t.x, t.z, d.splash, dmg * 0.5, t, src) end
  B.cb.fx({ k = "shot", u = u.t, a = B.cb.muzzle(u), b = B.cb.aim(t, hit) })
end

local function salvoStep(B, u)
  if not u.salvoLeft or u.salvoLeft <= 0 then return end
  if B.t < u.salvoAt then return end
  u.salvoLeft = u.salvoLeft - 1
  u.salvoAt = B.t + 0.25
  local dx, dz = u.salvoX - u.x, u.salvoZ - u.z
  local fl = 2 + math.sqrt(dx * dx + dz * dz) / 220
  lob(B, u, u.salvoX, u.salvoZ, 30, fl, "mrocket", srcOf(u))
end

-- 炸弹：一颗一颗往下扔，带着飞机的速度往前飘
local function bombStep(B, u)
  if not u.bombLeft or u.bombLeft <= 0 or B.t < u.bombAt then return end
  u.bombLeft = u.bombLeft - 1
  u.bombAt = B.t + 0.16
  lob(B, u, u.x + (u.vx or 0) * BOMB_FALL, u.z + (u.vz or 0) * BOMB_FALL, 8, BOMB_FALL, "bomb", srcOf(u))
end

local function shells(B)
  local i = 1
  while i <= #B.shells do
    local s = B.shells[i]
    if s.dead then
      table.remove(B.shells, i)
    elseif B.t >= s.at then
      table.remove(B.shells, i)
      splash(B, s.team, s.def, s.x, s.z, s.def.splash or 10, s.def.dmg * s.dm, nil, s.src)
      local size = 1.3
      if s.kind == "bomb" then size = 1.9 elseif s.def.salvo then size = 1.5 elseif s.def.foot then size = 0.9 end
      if s.kind == "cruise" then
        B.cb.fx({ k = "bigboom", p = B.cb.world(s.x, 0, s.z), s = 3.6 })   -- 巡航导弹：大火球、冲击波、震屏
      else
        B.cb.fx({ k = "boom", p = B.cb.world(s.x, 0, s.z), s = size })
      end
    else
      i = i + 1
    end
  end
end

local function missiles(B)
  local i = 1
  while i <= #B.missiles do
    local m = B.missiles[i]
    if B.t >= m.at then
      table.remove(B.missiles, i)
      local t = m.tgt
      if t then
        local p = 0.9
        if t.def.jet then p = 0.75 end   -- 喷气机放热诱弹、机动
        local jammed = false
        for _, e in ipairs(B.units) do   -- 目标附近有对方的电子战车：干扰
          if e.alive and e.def.jam and e.team ~= m.team then
            local dx, dz = e.x - t.x, e.z - t.z
            if dx * dx + dz * dz <= e.def.jam.r * e.def.jam.r then
              p = p * e.def.jam.p
              jammed = true
              break
            end
          end
        end
        if t.alive and math.random() < p then
          hurt(B, t, m.dmg * mult(m.def, t.def), m.src)
        elseif jammed and t.alive then
          B.cb.fx({ k = "jam", p = B.cb.world(t.x, (t.y or 0) + 6, t.z) })   -- 被干扰偏掉了
        end
      elseif m.x then
        splash(B, m.team, m.def, m.x, m.z, m.def.splash or 10, m.dmg, nil, m.src)
      end
    else
      i = i + 1
    end
  end
end

-- 拦截炮：每隔一会儿挑一发要落进自己附近的敌方炮弹 / 火箭弹打（每发只试一次，成功率 p）
local function interceptStep(B, u, dt)
  local ic = u.def.intercept
  u.icd = (u.icd or 0) - dt
  if u.icd > 0 then return end
  local best, bt = nil, math.huge
  local r2 = ic.range * ic.range
  for _, s in ipairs(B.shells) do
    if not s.dead and s.team ~= u.team and s.kind ~= "bomb" and s.kind ~= "cruise" and not (s.tried and s.tried[u]) and B.t >= s.t0 + (s.at - s.t0) * 0.3 then
      local dx, dz = s.x - u.x, s.z - u.z
      if dx * dx + dz * dz < r2 and s.at < bt then best, bt = s, s.at end
    end
  end
  if not best then return end
  u.icd = ic.rate
  best.tried = best.tried or {}
  best.tried[u] = true
  if math.random() < ic.p then
    best.dead = true
    B.cb.fx({ k = "intercept", id = best.id, a = B.cb.muzzle(u) })
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

-- 运兵直升机放下步兵（机降的步兵这一仗打完就没了，不算损失）
local function dropTroops(B, u)
  local n = u.cargo or 0
  u.cargo = 0
  if n <= 0 or not B.cb.spawn then return end
  local rx, rz = math.cos(u.h), -math.sin(u.h)   -- 机身右边
  for i = 1, n do
    local side = (i % 2 == 1) and 1 or -1
    local off = side * (10 + math.floor((i - 1) / 2) * 10)
    local bu = B.cb.spawn(u, "inf", u.x + rx * off, u.z + rz * off)
    if bu then table.insert(B.pending, bu) end
  end
  B.cb.fx({ k = "boom", p = B.cb.world(u.x, 0, u.z), s = 0.5 })
end

-- 医疗兵、抢修车：半径里受伤的友军（步兵 / 车辆）每秒回 hps（跟着战力倍数）；玩家本人也算步兵；隔一会儿冒一圈绿光
local function healStep(B, u, dt)
  local h = u.def.heal
  local r2 = h.r * h.r
  local amt = h.hps * dt * (u.dm or 1)
  local any = false
  for _, e in ipairs(B.units) do
    if e.alive and e.team == u.team and e ~= u then
      local kind = e.def.foot or e.hero
      if (h.foot and kind) or (h.armor and not kind and not e.def.air) then
        local dx, dz = e.x - u.x, e.z - u.z
        if dx * dx + dz * dz <= r2 then
          if e.hero then
            local hum = e.model and e.model:FindFirstChildOfClass("Humanoid")
            if hum and hum.Health > 0 and hum.Health < hum.MaxHealth then
              hum.Health = math.min(hum.MaxHealth, hum.Health + amt * 0.6)
              any = true
            end
          elseif e.hp < e.max then
            e.hp = math.min(e.max, e.hp + amt)
            B.cb.hurt(e)
            any = true
          end
        end
      end
    end
  end
  u.healT = (u.healT or 0) - dt
  if any and u.healT <= 0 then
    u.healT = 2.5
    B.cb.fx({ k = "heal", p = B.cb.world(u.x, 0, u.z), s = h.r * 0.5 })
  end
end

local function act(B, u, dt)
  local d = u.def
  local range = d.range * (B.rangeK or 1)   -- 战区：巷战射程短
  u.cd = u.cd - dt
  salvoStep(B, u)
  if d.heal then healStep(B, u, dt) end
  if d.cargo and u.cargo == nil then u.cargo = d.cargo end
  local t = u.tgt
  if t and not (t.alive and canHit(d, t)) then
    u.tgt, u.rt, t = nil, 0, nil
  end
  local mx, mz = 0, 0
  local inRange = false
  local wantY = d.alt or 0
  if t then
    local dx, dz = t.x - u.x, t.z - u.z
    local dist = math.sqrt(dx * dx + dz * dz)
    local tooClose = d.minRange ~= nil and dist < d.minRange
    local landing = d.cargo and (u.cargo or 0) > 0 and dist < d.drop
    if landing then                -- 运兵直升机：悬停、降低，放下步兵
      wantY = 6
      if u.y <= 7 then dropTroops(B, u) end
    elseif tooClose then
      mx, mz = -dx, -dz            -- 火炮被贴近：往后退
    elseif dist > range * 0.92 and not (u.hold and dist > range * 1.6) then
      mx, mz = dx, dz              -- 够不着：往前走（守方等敌人走近了才出击）
    end
    if dist <= range and not tooClose then
      inRange = true
      local err = 0
      if d.turret then
        err = aimTurret(u, dx, dz, dt)
        if mx == 0 and mz == 0 then turn(u, dx, dz, dt, 0.8) end   -- 停下打的时候车身慢慢转正
      elseif d.side then
        turn(u, dz, -dx, dt, 1.6)  -- 火箭炮发射箱朝右：右侧对准目标
        local want = math.atan2(-dz, dx)
        err = math.abs(wrap(want - u.h))
      else
        turn(u, dx, dz, dt, d.air and 3 or 2.4)
        err = math.abs(wrap(math.atan2(-dx, -dz) - u.h))
      end
      local ready = ((not d.air) or u.y >= d.alt * 0.5) and err < 0.35
      if u.cd <= 0 and ready then
        fire(B, u, t, dist)
        u.cd = d.rate * (0.85 + math.random() * 0.3)
      end
    elseif d.turret then
      aimTurret(u, dx, dz, dt)
    end
  end
  if d.air then
    if u.y < wantY then u.y = math.min(wantY, u.y + 16 * dt) elseif u.y > wantY then u.y = math.max(wantY, u.y - 22 * dt) end
  end
  u.moving = false
  u.vx, u.vz = 0, 0
  if mx ~= 0 or mz ~= 0 then
    local l = math.sqrt(mx * mx + mz * mz)
    local sp = d.speed * dt * (d.air and 1 or (B.speedK or 1))   -- 战区：沙地、雪地走得慢
    local nx, nz = mx / l * sp, mz / l * sp
    u.x = u.x + nx
    u.z = u.z + nz
    u.vx, u.vz = nx / dt, nz / dt
    u.moving = true
    if d.turret or not inRange then turn(u, mx, mz, dt, 3) end
  end
  if u.x > XMAX then u.x = XMAX elseif u.x < -XMAX then u.x = -XMAX end
  if u.z > ZMAX then u.z = ZMAX elseif u.z < ZMIN then u.z = ZMIN end
end

-- 固定翼（攻击机、战斗机、轰炸机、无人机）：一直往前飞，按转弯角速度追目标；冲过头先直飞一段再掉头（打一个来回）；
-- 机头对准目标 cone 以内才开火；无人机绕着目标转圈打；轰炸机在目标前方正好的距离开始投弹；飞出范围就掉头回来
local function actJet(B, u, dt)
  local d = u.def
  u.cd = u.cd - dt
  bombStep(B, u)
  if u.y < d.alt then u.y = math.min(d.alt, u.y + 26 * dt) end
  local t = u.tgt
  if t and not (t.alive and canHit(d, t)) then
    u.tgt, u.rt, t = nil, 0, nil
  end
  local out = math.abs(u.x) > JX or u.z < JZ0 or u.z > JZ1
  local dx, dz, dist, err = 0, 0, 0, math.pi
  if t then
    dx, dz = t.x - u.x, t.z - u.z
    dist = math.sqrt(dx * dx + dz * dz)
    err = math.abs(wrap(math.atan2(-dx, -dz) - u.h))
  end
  local R = d.speed / d.turn   -- 转弯半径
  if out then
    turn(u, -u.x, F.center - u.z, dt, d.turn)
  elseif not t then
    turn(u, -u.x, F.center - u.z, dt, d.turn * 0.5)   -- 没有目标：在战场上空盘旋
  elseif d.orbit and dist < d.range * 0.8 then
    -- 绕目标转圈：切线方向（挑和现在机头同一边的），离得远往里收、太近往外放
    local tx, tz = -dz / dist, dx / dist
    if tx * -math.sin(u.h) + tz * -math.cos(u.h) < 0 then tx, tz = -tx, -tz end
    local k = (dist - d.range * 0.55) / (d.range * 0.55)
    turn(u, tx + dx / dist * k, tz + dz / dist * k, dt, d.turn)
  elseif u.extendT and B.t < u.extendT then
    -- 冲过头了：直飞拉开距离
  elseif dist < R * 1.3 and err > 1.6 then
    u.extendT = B.t + 1.4 + R / d.speed
  else
    turn(u, dx, dz, dt, d.turn)
  end
  u.vx, u.vz = -math.sin(u.h) * d.speed, -math.cos(u.h) * d.speed
  u.x = math.clamp(u.x + u.vx * dt, -JX - 220, JX + 220)
  u.z = math.clamp(u.z + u.vz * dt, JZ0 - 220, JZ1 + 220)
  u.moving = true
  if not t or u.cd > 0 or u.y < d.alt * 0.5 then return end
  if d.bombs then
    local lead = d.speed * BOMB_FALL
    if err < d.cone and math.abs(dist - lead) < 60 then
      fire(B, u, t, dist)
      u.cd = d.rate
    end
  elseif dist <= d.range * (B.rangeK or 1) and err <= d.cone then
    fire(B, u, t, dist)
    u.cd = d.rate * (0.85 + math.random() * 0.3)
  end
end

-- 挤在一起的推开一点（地面和地面、直升机和直升机；喷气机不推；玩家本人和玩家在开的车不推——位置归玩家）
local function separate(U)
  local n = #U
  for i = 1, n do
    local a = U[i]
    if a.alive and not a.hero and not a.def.jet then
      for j = i + 1, n do
        local b = U[j]
        if b.alive and not b.hero and not b.def.jet and (a.def.air == true) == (b.def.air == true) then
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

-- 玩家开的车开火：打瞄准点附近的敌人（直瞄 / 导弹），没打着也在瞄准点炸（有溅射的）；轰炸机按一下投一串；返回开没开火
function Battle.driveFire(B, u, ax, az, ay)
  local d = u.def
  if not u.alive or u.cd > 0.2 then return false end   -- 客户端按服务器给的装填时间算，留一点网络误差
  local src = { team = u.team, player = u.driver, drive = true, unit = u }
  if d.bombs then
    u.cd = d.rate * 0.5
    u.bombLeft = d.bombs
    u.bombAt = B.t
    return true
  end
  local dx, dz = ax - u.x, az - u.z
  local dist = math.sqrt(dx * dx + dz * dz)
  if dist > d.range * 1.15 then return false end
  if d.minRange and dist < d.minRange * 0.6 then return false end
  u.cd = d.rate
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
  -- 瞄准点附近（目标大小以内，导弹放宽一些）最近的、打得到的敌人
  local best, bd = nil, math.huge
  local slack = d.homing and 30 or 6
  for _, e in ipairs(B.units) do
    if e.alive and e.team ~= u.team and canHit(d, e) then
      local ex, ez = e.x - ax, e.z - az
      local ey = (e.y or 0) - (ay or 0)
      local dd = math.sqrt(ex * ex + ez * ez + ey * ey * 0.3)
      if dd < e.def.size * 0.6 + slack and dd < bd then best, bd = e, dd end
    end
  end
  local dmg = d.dmg * u.dm
  if d.homing then
    if best then
      local ex, ez = best.x - u.x, best.z - u.z
      missile(B, u, best, dmg, math.sqrt(ex * ex + ez * ez), src)
    elseif not d.airOnly then
      missile(B, u, nil, dmg, dist, src, ax, ay, az)
    else
      u.cd = 0
      return false
    end
    return true
  end
  if best then hurt(B, best, dmg * mult(d, best.def), src) end
  if d.splash then splash(B, u.team, d, ax, az, d.splash, dmg * 0.5, best, src) end
  B.cb.fx({ k = "shot", u = u.t, a = B.cb.muzzle(u), b = best and B.cb.aim(best, true) or B.cb.world(ax, ay or 0, az) })
  return true
end

-- 推演一步；返回 nil（继续）或 "win" / "lose" / "timeout"（按第 1 队算；玩家本人不算兵力）
function Battle.step(B, dt)
  B.t = B.t + dt
  B.missiles = B.missiles or {}
  B.deaths = B.deaths or {}
  B.pending = {}
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
      local d = u.def
      if u.driver then
        u.cd = u.cd - dt
        salvoStep(B, u)
        bombStep(B, u)
        if d.cargo then   -- 玩家开的运兵直升机：飞起来以后再降到低空，自动放下步兵
          if u.cargo == nil then u.cargo = d.cargo end
          if u.y > 30 then u.flew = true end
          if u.flew and u.cargo > 0 and u.y <= 12 then dropTroops(B, u) end
        end
      elseif d.jet then
        actJet(B, u, dt)
      else
        act(B, u, dt)
      end
      if d.intercept then interceptStep(B, u, dt) end
    end
  end
  for _, bu in ipairs(B.pending) do table.insert(U, bu) end
  separate(U)
  shells(B)
  missiles(B)
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
function Battle.genEnemy(level)
  local budget = Config.EnemyBudget(level)
  local types = Config.EnemyTypes(level)
  local rng = Random.new(level * 7919 + 101)
  local list, spent = {}, 0
  while #list < Config.MaxEnemy do
    local cand, tw = {}, 0
    for _, t in ipairs(types) do
      if spent + UNITS[t].price <= budget then
        table.insert(cand, t)
        tw = tw + (UNITS[t].ew or 1)
      end
    end
    if #cand == 0 then break end
    local r = rng:NextNumber() * tw
    local pickT = cand[#cand]
    for _, t in ipairs(cand) do
      r = r - (UNITS[t].ew or 1)
      if r <= 0 then
        pickT = t
        break
      end
    end
    table.insert(list, pickT)
    spent = spent + UNITS[pickT].price
  end
  if #list == 0 then
    list = { "inf" }
    spent = UNITS.inf.price
  end
  local k = 1
  if budget > spent * 1.05 then k = budget / spent end
  local m = math.sqrt(k)
  if Config.IsBoss(level) then table.insert(list, "boss") end
  return list, m, m   -- 兵种列表、血量倍数、伤害倍数
end

-- 排阵：按兵种的 row 从前往后（步兵、轻车、步战车、坦克、防空、直升机、迫击炮狙击、火炮、火箭炮、飞机），一行排满再起一行
-- zFront 是第一行前沿的 Z，dir 是往后排的方向（我方 −1，敌方 +1），depth 是可用纵深（排不下就压紧）
-- 同一 row 里按兵种名排（Army.arrange 用同样的顺序把部队对上位置）
Battle.ROW = {}
for t, d in pairs(UNITS) do Battle.ROW[t] = d.row or 5 end
function Battle.order(a, b)
  local ROW = Battle.ROW
  if ROW[a] ~= ROW[b] then return ROW[a] < ROW[b] end
  return a < b
end
function Battle.formation(types, zFront, dir, depth)
  local list = {}
  for i, t in ipairs(types) do list[i] = t end
  table.sort(list, Battle.order)
  local maxW = F.width - 40
  local lines, cur = {}, nil
  for _, t in ipairs(list) do
    local s = UNITS[t].size + 6
    if not cur or cur.w + s > maxW then
      cur = { items = {}, w = 0, deep = 0 }
      table.insert(lines, cur)
    end
    table.insert(cur.items, { t = t, s = s })
    cur.w = cur.w + s
    cur.deep = math.max(cur.deep, s)
  end
  local total = 0
  for _, l in ipairs(lines) do total = total + l.deep end
  local k = 1
  if depth and total > depth then k = depth / total end
  local out = {}
  local z = zFront
  for _, l in ipairs(lines) do
    local zc = z + dir * l.deep * k / 2
    local x = -l.w / 2
    for _, it in ipairs(l.items) do
      table.insert(out, { t = it.t, x = x + it.s / 2, z = zc })
      x = x + it.s
    end
    z = z + dir * l.deep * k
  end
  return out
end

return Battle
