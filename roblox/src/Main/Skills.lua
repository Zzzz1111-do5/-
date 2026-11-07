-- 军事大亨：战场支援技能（打仗时玩家自己放的：迫击炮急袭、战地急救、炮火覆盖、空投援军、空袭、巡航导弹；盖了雷达站冷却快两成）
-- 客户端点技能键、再点战场上的位置 → Action "skill"（id，x，z：相对战场原点）；服务器检查盖没盖那栋楼、冷却、在不在打仗，再放；
-- 伤害、援军强度跟着全军战力（军工科技 × 重生）走；冷却每一仗开打时清零
local Skills = {}

function Skills.init(G)
  local Config, Battle = G.Config, G.Battle
  local V = Vector3.new
  local F = Config.Field
  local RB = G.R.Battle

  -- 这个玩家有哪些技能、各还要冷却几秒（跟着状态发给客户端画技能栏）
  function G.skillInfo(st)
    local d = st.data
    local out = {}
    local now = os.clock()
    st.skillCD = st.skillCD or {}
    for _, sk in ipairs(Config.Skills) do
      if d.owned[sk.need] then
        table.insert(out, { id = sk.id, left = math.max(0, math.ceil((st.skillCD[sk.id] or 0) - now)) })
      end
    end
    return out
  end
  function G.skillsReset(st)
    st.skillCD = {}
  end

  -- 支援炮弹从己方后方远处打过来（客户端画弧线）；空袭从己方一侧飞过来
  local function rear(B, team, x)
    local z = (team == 1) and (F.deploy[1] - 160) or (F.enemy[2] + 160)
    return B.origin + V(x + math.random(-80, 80), 60, z)
  end

  function G.useSkill(st, id, x, z)
    local B = st.battle
    local sk = type(id) == "string" and Config.SkillById[id]
    if not sk or not B or B.over then return end
    if type(x) ~= "number" or type(z) ~= "number" or x ~= x or z ~= z then return end
    if not st.data.owned[sk.need] then
      G.toast(st, "先盖「" .. Config.BuildingById[sk.need].name .. "」才有「" .. sk.name .. "」", "bad")
      return
    end
    st.skillCD = st.skillCD or {}
    local now = os.clock()
    if now < (st.skillCD[id] or 0) then return end
    local cd = Config.SkillCD(sk, st.data.owned)
    st.skillCD[id] = now + cd
    local team = B.teamOf[st.pl] or 1
    x = math.clamp(x, -Battle.XMAX, Battle.XMAX)
    z = math.clamp(z, Battle.ZMIN, Battle.ZMAX)
    local power = G.powerOf(st.data)
    local src = { team = team, player = st.pl, skill = id }
    local dir = (team == 1) and 1 or -1   -- 进攻方向：第 1 队往 +Z 打
    if sk.kind == "barrage" then
      local def = { dmg = sk.dmg, splash = sk.splash, vsArmor = sk.vsArmor, vsInf = sk.vsInf, vsAir = 0, fxu = (id == "mortar") and "mortar" or "heavyarty" }
      local gap = (id == "mortar") and 0.18 or 0.22
      for i = 1, sk.n do
        task.delay((i - 1) * gap, function()
          if B.over then return end
          Battle.strike(B, team, def, power, x, z, sk.r, sk.flight + math.random() * 0.5, "shell", src, rear(B, team, x))
        end)
      end
    elseif sk.kind == "strike" then
      local def = { dmg = sk.dmg, splash = sk.splash, vsArmor = sk.vsArmor, vsInf = sk.vsInf, vsAir = 0, fxu = "bomber" }
      local z0 = z - dir * sk.len / 2
      G.fx({ k = "flyover", a = B.origin + V(x, 95, z0 - dir * 420), b = B.origin + V(x, 95, z0 + dir * (sk.len + 420)), t = 4.2, jet = true })
      for i = 1, sk.n do
        local bz = z0 + dir * (i - 1) * sk.len / math.max(1, sk.n - 1)
        task.delay(1.55 + (i - 1) * 0.11, function()
          if B.over then return end
          Battle.strike(B, team, def, power, x + math.random(-6, 6), bz, 4, 1.1, "bomb", src, B.origin + V(x, 92, bz - dir * 30))
        end)
      end
    elseif sk.kind == "missile" then   -- 巡航导弹：发射井的井盖拉开、冒烟，导弹从工业区升空，划一道高弧线落到目标
      local def = { dmg = sk.dmg, splash = sk.splash, vsArmor = sk.vsArmor, vsInf = sk.vsInf, vsAir = 0, fxu = "cruise" }
      local sb = Config.BuildingById.silo
      local pad = st.plot.origin + V(sb.x, 1, sb.z)
      G.fx({ k = "silo", p = pad })
      task.delay(1.0, function()
        if B.over then return end
        Battle.strike(B, team, def, power, x, z, 0, sk.flight, "cruise", src, pad + V(0, 6, 0))
      end)
    elseif sk.kind == "heal" then
      local r2 = sk.r * sk.r
      local n = 0
      for _, u in ipairs(B.units) do
        if u.alive and u.team == team then
          local dx, dz = u.x - x, u.z - z
          if dx * dx + dz * dz <= r2 then
            if u.hero then
              local hum = u.model and u.model:FindFirstChildOfClass("Humanoid")
              if hum and hum.Health > 0 then hum.Health = math.min(hum.MaxHealth, hum.Health + hum.MaxHealth * sk.pct) end
            else
              u.hp = math.min(u.max, u.hp + u.max * sk.pct)
              B.cb.hurt(u)
            end
            n = n + 1
          end
        end
      end
      G.fx({ k = "heal", p = B.origin + V(x, 1, z), s = sk.r })
      G.toast(st, "战地急救：" .. n .. " 个单位回了血", (n > 0) and "good" or "info")
    elseif sk.kind == "drop" then
      local folder = st.plot and st.plot.Units
      local h = (team == 1) and math.pi or 0
      G.fx({ k = "flyover", a = B.origin + V(x - 60, 70, z - dir * 380), b = B.origin + V(x + 60, 70, z + dir * 380), t = 3.2, heli = true })
      local spawnSrc = { owner = st, team = team, h = h, dm = power, model = { Parent = folder } }
      for i = 1, sk.squads do
        task.delay(1.4 + i * 0.25, function()
          if B.over or not B.cb.spawn then return end
          local a = (i / sk.squads) * math.pi * 2
          local px = math.clamp(x + math.cos(a) * 12, -Battle.XMAX, Battle.XMAX)
          local pz = math.clamp(z + math.sin(a) * 12, Battle.ZMIN, Battle.ZMAX)
          local bu = B.cb.spawn(spawnSrc, "inf", px, pz)
          if bu then
            bu.owner = st
            table.insert(B.units, bu)   -- 不在推演那一步里：直接加
            G.fx({ k = "drop", p = B.origin + V(px, 1, pz), s = 1 })
          end
        end)
      end
    end
    RB:FireClient(st.pl, { phase = "skill", id = id, cd = cd })
    G.progress(st, "skill", 1)
  end
end

return Skills
