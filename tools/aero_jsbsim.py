# 飞行姿态数据：用 JSBSim（开源六自由度飞行动力学引擎，pip install jsbsim）离线算，写成 js/aero.js 给画面用
#   用法：python3 tools/aero_jsbsim.py
#   气动模型用 JSBSim 自带的 F-16（NASA TP-1538 风洞数据，飞行力学研究里最常用的战斗机非线性模型）：
#   国产机的气动数据没有公开，这里借同类电传战斗机的升力线、平尾配平规律，重量按翼载换算成满载舰载机（约 500 公斤 / 平方米）
#   1) 弹射离舰：空速 100 米/秒（弹射末速约 85 + 甲板风约 15）、机头抬起约 5°、全加力起步，俯仰姿态回路带杆（约 2 秒带到 14° 保持着加速爬升，
#      速度过 135 米/秒逐渐压到 10°），2 秒收起落架，记 14 秒
#   2) 平飞配平：各速度下的迎角、平尾、前缘襟翼，拟合升力线（CL = CLa (α − α0)）与平尾随迎角的规律
#   只在开发时跑；游戏里只用算出来的数（js/aero.js），不带 JSBSim 与它的模型文件
import json, math, os, sys
import jsbsim

FT, LB, G = 0.3048, 0.45359237, 9.80665
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASS = 14000.0   # 公斤：F-16 翼面积 27.9 平方米，翼载约 500 公斤 / 平方米（满载歼-35 弹射起飞的翼载）


def mk(h_m, v_ms, alpha=None):
    f = jsbsim.FGFDMExec(jsbsim.get_default_root_dir())
    f.set_debug_level(0)
    f.load_model('f16')
    f['ic/h-sl-ft'] = h_m / FT
    if alpha is None:
        f['ic/u-fps'] = v_ms / FT
    else:   # 速度水平、机头抬起 alpha（航迹角 0）
        f['ic/vt-fps'] = v_ms / FT
        f['ic/gamma-deg'] = 0.0
        f['ic/alpha-deg'] = alpha
    f.run_ic()
    base = f['inertia/weight-lbs']
    for ax in 'XYZ':   # 加的重量放在原重心上（放在默认位置会把重心拉到机头，机头沉得拉不起来）
        f['inertia/pointmass-location-%s-inches' % ax] = f['inertia/cg-%s-in' % ax.lower()]
    f['inertia/pointmass-weight-lbs'] = max(0.0, MASS / LB - base)
    f['propulsion/set-running'] = -1
    return f


def launch():
    """弹射离舰：迎角回路带杆，记高度（离甲板）、俯仰、迎角、速度、平尾、前缘襟翼、起落架"""
    f = mk(18.0, 100.0, 5.0)   # 空速：弹射末速约 85（相对甲板）+ 航母逆风航行的甲板风约 15；行程末端前起落架伸长，机头已抬起约 5°
    f['fcs/throttle-cmd-norm'] = 2.0   # 全加力
    f['propulsion/engine/n2'] = 100.0   # 挂杆时已经全加力几秒
    f['gear/gear-cmd-norm'] = 1.0
    dt, I, out = f.get_delta_t(), 0.0, []
    per = round(0.1 / dt)
    for k in range(int(round(14.0 / dt)) + 1):
        t = k * dt
        # 俯仰姿态：离舰后约 2 秒带到 14° 保持着加速爬升（不是保持迎角——推力富余时保持迎角航迹会一直上弯）；速度过 135 后逐渐压到 10°
        v = f['velocities/vt-fps'] * FT
        tt = 5.0 + 9.0 * min(1.0, max(0.0, t / 2.0)) ** .8 - 4.0 * min(1.0, max(0.0, (v - 135.0) / 10.0))
        a, th, q = f['aero/alpha-deg'], f['attitude/theta-deg'], math.degrees(f['velocities/q-rad_sec'])
        e = tt - th
        I = max(-30.0, min(30.0, I + e * dt))
        f['fcs/elevator-cmd-norm'] = max(-1.0, min(1.0, -(0.1 * e + 0.03 * I) + 0.03 * q))
        if t >= 2.0:
            f['gear/gear-cmd-norm'] = 0.0
        if k % per == 0:
            out.append([round(f['position/h-sl-ft'] * FT - 18.0, 2), round(f['attitude/theta-deg'], 2), round(a, 2),
                        round(f['velocities/vt-fps'] * FT, 1), round(f['fcs/elevator-pos-deg'], 2), round(f['fcs/lef-pos-deg'], 2),
                        round(f['gear/gear-pos-norm'], 2)])
        f.run()
    return out


def trims(h_m=1000.0):
    """平飞配平：速度 → 迎角、平尾、前缘襟翼"""
    rows = []
    for v in range(80, 421, 20):
        f = mk(h_m, float(v))
        f['fcs/throttle-cmd-norm'] = 0.6
        f['gear/gear-cmd-norm'] = 0.0
        try:
            f['simulation/do_simple_trim'] = 1
        except Exception:
            continue
        a, de = f['aero/alpha-deg'], f['fcs/elevator-pos-deg']
        rho = f['atmosphere/rho-slugs_ft3'] * 515.379
        q = 0.5 * rho * v * v
        cl = MASS * G / (q * f['metrics/Sw-sqft'] * FT * FT)
        rows.append([v, round(a, 3), round(de, 3), round(f['fcs/lef-pos-deg'], 2), round(cl, 4)])
    return rows


def fit(xs, ys):
    n = len(xs); mx = sum(xs) / n; my = sum(ys) / n
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return my - b * mx, b


def main():
    L = launch()
    T = trims()
    lin = [r for r in T if r[1] < 14]   # 线性段
    a0b = fit([r[4] for r in lin], [r[1] for r in lin])   # α = α0 + CL / CLa
    deb = fit([r[1] for r in lin], [r[2] for r in lin])   # δe = d0 + d1 α
    data = {
        'src': 'JSBSim 1.3 · F-16（NASA TP-1538）· 翼载 %d 公斤/平方米' % round(MASS / 27.87),
        'ws': round(MASS / 27.87, 1),
        'launch': {'dt': 0.1, 'cols': ['h', 'theta', 'alpha', 'v', 'de', 'lef', 'gear'], 'rows': L},
        'trim': {'cols': ['v', 'alpha', 'de', 'lef', 'cl'], 'rows': T},
        'a0': round(a0b[0], 3), 'cla': round(1 / a0b[1], 5), 'd0': round(deb[0], 3), 'd1': round(deb[1], 4)
    }
    js = ("'use strict';\n// 飞行姿态数据（tools/aero_jsbsim.py 用 JSBSim 离线算出，不要手改）：" + data['src'] + "\n"
          "//   launch：弹射离舰后每 0.1 秒 [离甲板高 米, 俯仰 °, 迎角 °, 速度 米/秒, 平尾 °（负 = 后缘上偏）, 前缘襟翼 °, 起落架 0 收 – 1 放]\n"
          "//   trim：平飞配平 [速度, 迎角, 平尾, 前缘襟翼, 升力系数]；升力线 α = a0 + CL / cla，配平平尾 δe = d0 + d1 α\n"
          "const AERO = " + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ";\n")
    open(os.path.join(ROOT, 'js', 'aero.js'), 'w', encoding='utf-8').write(js)
    print('launch', len(L), 'rows; t=0,1,2,4,8,14:', [L[i] for i in (0, 10, 20, 40, 80, 140) if i < len(L)])
    print('trim', T[:3], '...', T[-2:])
    print('a0', data['a0'], 'cla', data['cla'], 'd0', data['d0'], 'd1', data['d1'])


if __name__ == '__main__':
    main()
