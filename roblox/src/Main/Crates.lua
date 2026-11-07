-- 军事大亨：补给空投——不打仗的时候，隔一会儿往自己基地里空投一个补给箱（挂着降落伞慢慢落下，头顶有绿色信标），
-- 走过去碰一下（或按 E）就拿钱：这么多秒的收入，至少 Config.Crate.min；一直没人捡就收走
local Players = game:GetService("Players")

local Crates = {}

function Crates.init(G)
  local Config, Models = G.Config, G.Models
  local V = Vector3.new
  local C = Config.Crate
  local hs = Config.BaseSize / 2

  -- 落点：基地里空着的地方（离建筑、按钮远一点）；找不到就落在出生点旁边
  local function spot(st)
    local o = st.plot.origin
    for _ = 1, 40 do
      local x = math.random(-hs + 18, hs - 18)
      local z = math.random(-hs + 18, hs - 18)
      local ok = true
      for _, b in ipairs(Config.Buildings) do
        if math.abs(x - b.x) < b.size[1] / 2 + 14 and math.abs(z - b.z) < b.size[3] / 2 + 16 then
          ok = false
          break
        end
      end
      if ok and math.abs(x - Config.Spawn.x) < 10 and math.abs(z - Config.Spawn.z) < 10 then ok = false end
      if ok then return o + V(x, 1, z) end
    end
    return o + V(Config.Spawn.x + 22, 1, Config.Spawn.z + 18)
  end

  local function amountOf(st)
    return math.max(C.min, math.floor(st.income * C.sec))
  end

  local function give(st, crate)
    if st.crate ~= crate or crate.taken then return end
    crate.taken = true
    st.crate = nil
    local amt = amountOf(st)
    st.data.cash = st.data.cash + amt
    G.fx({ k = "coins", p = crate.pos + V(0, 3, 0), s = 1 })
    G.toast(st, "捡到补给箱：+$" .. Config.Fmt(amt), "good")
    G.progress(st, "crate", 1)
    crate.model:Destroy()
    G.push(st)
  end

  local function drop(st)
    local pos = spot(st)
    local amt = amountOf(st)
    local m, box, chute, label = Models.crate(st.plot.Drops, pos, "补给箱 +$" .. Config.Fmt(amt))
    local crate = { model = m, box = box, pos = pos, expire = os.clock() + C.life, taken = false }
    st.crate = crate
    box.Touched:Connect(function(hit)
      local who = Players:GetPlayerFromCharacter(hit.Parent)
      if who == st.pl and crate.landed then give(st, crate) end
    end)
    local pp = Instance.new("ProximityPrompt")
    pp.ActionText = "打开补给箱"
    pp.ObjectText = "+$" .. Config.Fmt(amt)
    pp.HoldDuration = 0
    pp.MaxActivationDistance = 14
    pp.RequiresLineOfSight = false
    pp.Parent = box
    pp.Triggered:Connect(function(who)
      if who == st.pl and crate.landed then give(st, crate) end
    end)
    G.toast(st, "补给空投来了！去基地里找绿色信标下面的箱子", "info")
    -- 挂着伞从天上慢慢落下来（服务器挪根零件，每秒 20 次）
    task.spawn(function()
      local h0, dur = 70, 3.2
      local t = 0
      while t < dur and m.Parent do
        local dt = task.wait(0.05)
        t = t + dt
        local k = math.min(1, t / dur)
        box.CFrame = CFrame.new(pos + V(0, 1.5 + h0 * (1 - k), 0)) * CFrame.Angles(0, t * 0.6, 0)
      end
      if not m.Parent then return end
      crate.landed = true
      if chute and chute.Parent then chute:Destroy() end
      if label then label.Enabled = true end
      G.fx({ k = "boom", p = pos + V(0, 1, 0), s = 0.45 })
    end)
  end

  task.spawn(function()
    while true do
      task.wait(2)
      local now = os.clock()
      for _, st in pairs(G.states) do
        G.try("补给空投", function()
          if not (st.ready and st.data) or G.matchServer then return end
          if st.crate then
            if now > st.crate.expire then
              st.crate.model:Destroy()
              st.crate = nil
            end
            return
          end
          st.nextCrate = st.nextCrate or (now + 35)   -- 进服 35 秒后先来一个
          if now >= st.nextCrate and not st.battle then
            st.nextCrate = now + C.every + math.random(-C.jitter, C.jitter)
            drop(st)
          end
        end)
      end
    end
  end)
end

return Crates
