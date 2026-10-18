# -*- coding: utf-8 -*-
"""
check_shapes.py —— 《定格瞬间》可判定轮廓自检（独立校验 assets/config/shapes.json）

只用标准库。输出为可 grep 的竖线分隔表：一行一个形状。

用法：
    python 03_交付素材/check_shapes.py             # 全量检查（含 k2 二分窗口，约 10–30 秒）
    python 03_交付素材/check_shapes.py --quick     # 跳过 angle80/angle60/k2（快速看基本项）
    python 03_交付素材/check_shapes.py --md        # 末尾额外打印 markdown 表（贴进美术_轮廓规格.md）
    python 03_交付素材/check_shapes.py --fix       # 精确归一化（形心归零、长边=1）写回 json，再检查
    python 03_交付素材/check_shapes.py --merge 02_美术源文件/shapes_src/redesign_v2.json --fix
                                                   # 按 id 用补丁覆盖形状（不许增删 id），再归一化+检查
    输出同时落盘 03_交付素材/check_report.txt

列定义（竖线分隔，第 4 列是 k2）：
    id | 长宽比 | rot30 | k2 | 顶点数 | angle80 | angle60 | 等效长宽比 | 面积占比 | 自交对数 | 长边误差 | 形心偏移 | rot180 | 难度档 | 结果

k2 = 命中窗口 / 周期（2 圈、passRate 0.6）。与主策划同口径（tools/export_levels.mjs 的
windowMetrics：从 perfectMs 向早/晚二分到 judge().pass 的边界），本脚本按同一定义自算：
    v = 1080/2600 px/ms（h_line：x 从 -180 到 900），ω = 2·360/2600 °/ms
    pose(dt) = 自转 ω·dt + 平移 v·dt，二分到 overlap < 60% 的早/晚边界
自算值比主策划 tool 的实测大约 2–4 倍（不含 jitter / 两段变速 / 帧量化），所以脚本会用
「已验收且本轮未改动」的形状做**运行时校准**：K_SCALE = median(k_lead / k_self)，
再按 `0.020 ≤ k2·K_SCALE ≤ 0.047` 判定。校准的残差会打在报告里。

硬校验（任一不过 = FAIL）：
  1. 顶点数 12–48
  2. 简单多边形：非相邻边不自交
  3. 长边 = 1（误差 < 0.02）、形心距原点 < 0.05
  4. 面积 > 0，且 填充面积/包围盒面积 ∈ [0.12, 0.95]
  5. 转 30° 后重合率 < 92%（主策划硬指标：歪 30° 必须明显掉分）
  6. **k2 ∈ [0.020, 0.047]** ← 主判据：玩家真正感受到的命中窗口宽窄
  7. （参考项，不 FAIL）旋转 180° 自重合：玩法内玩家偏离上限约 ±40°（L15 窗口 ±5ms ≈ ±2°），
     转不到 90°/180°，所以\"倒过来也一样\"不影响手感——只打印，不判红。

参考列（不进 gate）：angle80/angle60 = 重合率掉到 80%/60% 的角度；aEquiv = 等效矩形长宽比
= 58.6/(angle80+3.8)（由主策划给的矩形实测表拟合，只用来和「2.2:1 矩形」这条线对照）。

重合率口径与游戏一致（Geometry.ts）：交集面积 / 两者较大面积 × 100，交集用精确扫描线解。
"""
import json
import math
import sys
import atexit
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHAPES = ROOT / "assets" / "config" / "shapes.json"
LEVELS = ROOT / "01_策划文档" / "levels.csv"
LEVELS_JSON = ROOT / "assets" / "resources" / "config" / "levels.json"
LOG_PATH = Path(__file__).resolve().parent / "check_report.txt"


class _Tee:
    """把 stdout 同时写进内存，退出时落盘成 check_report.txt（队友/CI 不用复制粘贴）。"""

    def __init__(self, stream):
        self.stream = stream
        self.buf = []

    def write(self, s):
        self.stream.write(s)
        self.buf.append(s)

    def flush(self):
        self.stream.flush()


_TEE = None


def _install_log():
    global _TEE
    _TEE = _Tee(sys.stdout)
    sys.stdout = _TEE
    atexit.register(_flush_log)


def _flush_log():
    if _TEE is None:
        return
    try:
        LOG_PATH.write_text("".join(_TEE.buf), encoding="utf-8")
        sys.stdout = _TEE.stream
        print(f"LOG|{LOG_PATH}")
    except Exception:
        pass

TOL_SIZE = 0.02      # 长边归一化误差上限
TOL_CENT = 0.05      # 形心偏移上限
MIN_FILL, MAX_FILL = 0.12, 0.95
MAX_ROT30 = 92.0     # 硬指标：转 30° 重合率上限
MAX_SELF_ROT = 92.0  # 180° 自重合上限
MIN_AEQUIV = 2.15    # 等效长宽比下限（参考列）
K_MIN, K_MAX = 0.020, 0.047   # k2 可用区间（主策划定，窗口 34–140ms @2600ms）

# 主策划实测 k（2 圈 / cycle 2600 / passRate 0.6，用真 core + windowMetrics 跑）。v3 冻结版。
# 形状一改这列就失效 → 只用来给自算模型做校准、以及对照。真正验收以主策划 tool 为准。
REF_LEAD_K = {
    # ---- v0.1 冻结版 15 个（k 已定稿）
    "cup_tumbler": 0.0315, "car_hatch": 0.0467, "slipper": 0.0329,
    "wrench": 0.0252, "guitar": 0.0254, "duck": 0.0433, "cat": 0.0433,
    "rocket": 0.0200, "toilet": 0.0283, "hammer": 0.0222, "can_cola": 0.0426,
    "banana": 0.0245, "tv": 0.0449, "octopus": 0.0413, "burger": 0.0499,
    # ---- v0.2 新增 8 个（第二轮实测定稿）
    "book": 0.0710, "mug": 0.0482, "skateboard": 0.0195, "dessert": 0.0322,
    "mecha_doll": 0.0341, "camera": 0.0504, "handheld": 0.0518, "crab": 0.0460,
    # ---- v0.4 季 2/3/4（主策划实测，13 个全部定稿）
    "headphone": 0.0315, "icecream": 0.0334, "teapot": 0.0448, "sneaker": 0.0446,
    "saxophone": 0.0198, "lobster": 0.0329, "cactus": 0.0291, "dino": 0.0320,
    "windmill": 0.0293, "satellite": 0.0313, "anchor": 0.0246, "dragon": 0.0315,
    "toaster": 0.0505,   # 超季 2 上限 10%，主策划拍板接受（见 ACCEPTED_K）
}
# 本轮刚改过、实测值已失效的形状（全部已重测 → 空）
CHANGED_SHAPES = set()

# 物体分层（v0.2 §3 + 主策划 2026-10-18 定稿）：按「功能归属」——形状归哪层，取决于它服务哪一段关卡，
# 而不是它的 k 值。例：hammer k=0.0222 属中段敏感，但用在 L11（tier3 区段）→ 归 tier3。
# v0.4 起新增 s2/s3/s4：按「季」分池（季 2 = L16–30，季 3 = L31–45，季 4 = L46–60）。
TIER = {
    "cup_tumbler": 1, "car_hatch": 1, "can_cola": 1, "slipper": 1, "book": 1, "mug": 1,
    "guitar": 2, "wrench": 2, "rocket": 2, "tv": 2,
    "skateboard": 2, "camera": 2, "handheld": 2, "dessert": 2,
    "octopus": 3, "cat": 3, "duck": 3, "burger": 3, "toilet": 3, "banana": 3,
    "crab": 3, "mecha_doll": 3, "hammer": 3,
    "toaster": "s2", "teapot": "s2", "headphone": "s2", "sneaker": "s2", "icecream": "s2",
    "saxophone": "s3", "lobster": "s3", "cactus": "s3", "dino": "s3",
    "windmill": "s4", "satellite": "s4", "anchor": "s4", "dragon": "s4",
}
# tier 门禁（2026-10-18）：tier1 只设下限；tier2 上下限都放宽（camera/handheld 已验收）；
# tier3 上限 0.048；季 2/3/4 按 v0.4 §1.1 各自区间（季越后越严）
TIER_BAND = {
    1: (0.030, None), 2: (0.018, 0.052), 3: (0.020, 0.048),
    "s2": (0.026, 0.046), "s3": (0.020, 0.038), "s4": (0.020, 0.032),
}


def band_of(sid):
    t = TIER.get(sid, 2)
    return TIER_BAND[t] + (t,)

# 主策划拍板接受、不判 FAIL 的越界值：id -> (决策号, 说明)
ACCEPTED_K = {
    "burger": ("D-022", "0.0499 由主策划拍板接受：压到 0.047 只换来 5ms 窗口差，玩家感知不到，"
                        "再削几何会越来越不像汉堡；该形状目前不进正式 15 关"),
    "toaster": ("lead-accept", "0.0505 由主策划接受：仅超季 2 上限 10%（周期 2200ms 时窗口 111ms vs 101ms，"
                               "感知不到）；已迭代三轮（槽深 0.12→0.17、梯形机身），再压辨识度先崩"),
    "saxophone": ("lead-accept", "0.0198 由主策划接受：仅低于季 3 下限 1%（窗口差 <2ms，不可感知）；"
                                 "再改一次几何的收益为负"),
}
K_SCALE = 1.0        # 自算 → 实测的换算系数，运行时用校准集中位数覆盖（2026-10-18 实测约 0.484）

PATH_LEN_H_LINE = 1080.0   # Types.ts h_line：x 从 -180 到 900
K_TURNS, K_CYCLE, K_PASS = 2, 2600.0, 60.0


# ---------------------------------------------------------------- 几何
def poly_area(pts):
    s = 0.0
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        s += ax * by - bx * ay
    return abs(s) * 0.5


def poly_centroid(pts):
    a = cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        px, py = pts[i]
        qx, qy = pts[(i + 1) % n]
        cross = px * qy - qx * py
        a += cross
        cx += (px + qx) * cross
        cy += (py + qy) * cross
    if abs(a) < 1e-12:
        n = len(pts)
        return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
    return (cx / (3 * a), cy / (3 * a))


def poly_bounds(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _orient(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_seg(a, b, p, eps=1e-9):
    if abs(_orient(a, b, p)) > eps:
        return False
    return min(a[0], b[0]) - eps <= p[0] <= max(a[0], b[0]) + eps and \
           min(a[1], b[1]) - eps <= p[1] <= max(a[1], b[1]) + eps


def seg_intersect(a, b, c, d, eps=1e-9):
    """两线段是否相交（含端点接触、共线重叠）。"""
    o1 = _orient(a, b, c)
    o2 = _orient(a, b, d)
    o3 = _orient(c, d, a)
    o4 = _orient(c, d, b)
    if ((o1 > eps and o2 < -eps) or (o1 < -eps and o2 > eps)) and \
       ((o3 > eps and o4 < -eps) or (o3 < -eps and o4 > eps)):
        return True
    if _on_seg(a, b, c, eps) or _on_seg(a, b, d, eps) or \
       _on_seg(c, d, a, eps) or _on_seg(c, d, b, eps):
        return True
    return False


def count_self_intersections(pts):
    n = len(pts)
    bad = []
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        for j in range(i + 1, n):
            if j == (i + 1) % n or i == (j + 1) % n:   # 相邻边共享端点
                continue
            c, d = pts[j], pts[(j + 1) % n]
            if seg_intersect(a, b, c, d):
                bad.append((i, j))
    return len(bad), bad


def _crossings_at(pts, y):
    xs = []
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        if (ay <= y < by) or (by <= y < ay):
            xs.append(ax + (y - ay) * (bx - ax) / (by - ay))
    xs.sort()
    return xs


def _section_overlap(P, Q, y):
    xp = _crossings_at(P, y)
    xq = _crossings_at(Q, y)
    if len(xp) < 2 or len(xq) < 2:
        return 0.0
    s = 0.0
    for i in range(0, len(xp) - 1, 2):
        for j in range(0, len(xq) - 1, 2):
            lo = max(xp[i], xq[j])
            hi = min(xp[i + 1], xq[j + 1])
            if hi > lo:
                s += hi - lo
    return s


def _seg_cross_y(a, b, c, d):
    rx = b[0] - a[0]
    ry = b[1] - a[1]
    sx = d[0] - c[0]
    sy = d[1] - c[1]
    den = rx * sy - ry * sx
    if abs(den) < 1e-12:
        return []
    t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den
    u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den
    if t <= 0 or t >= 1 or u <= 0 or u >= 1:
        return []
    return [a[1] + t * ry]


def overlap_area_exact(P, Q):
    """两简单多边形交集面积（与 Geometry.ts overlapAreaExact 同算法）。"""
    if len(P) < 3 or len(Q) < 3:
        return 0.0
    ys = [p[1] for p in P] + [q[1] for q in Q]
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        for j in range(len(Q)):
            c, d = Q[j], Q[(j + 1) % len(Q)]
            ys.extend(_seg_cross_y(a, b, c, d))
    ys.sort()
    slabs = []
    for y in ys:
        if not slabs or y - slabs[-1] > 1e-9:
            slabs.append(y)
    if len(slabs) < 2:
        return 0.0
    area = 0.0
    for i in range(len(slabs) - 1):
        y0, y1 = slabs[i], slabs[i + 1]
        h = y1 - y0
        if h < 1e-9:
            continue
        eps = min(1e-7, h * 1e-3)
        area += (_section_overlap(P, Q, y0 + eps) + _section_overlap(P, Q, y1 - eps)) * 0.5 * h
    return area


def overlap_percent(P, Q, aP=None, aQ=None):
    aP = poly_area(P) if aP is None else aP
    aQ = poly_area(Q) if aQ is None else aQ
    den = max(aP, aQ)
    if den <= 1e-12:
        return 0.0
    return max(0.0, min(100.0, overlap_area_exact(P, Q) / den * 100.0))


def rotate(pts, deg):
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    return [(x * c - y * s, x * s + y * c) for x, y in pts]


def mirror_x(pts):
    return [(-x, y) for x, y in pts]


def normalized(pts):
    """按长边 = 1 归一（只缩放，不平移），用于量角度敏感度。"""
    x0, y0, x1, y1 = poly_bounds(pts)
    f = 1.0 / max(x1 - x0, y1 - y0)
    return [(x * f, y * f) for x, y in pts]


def angle_at(up, a_up, target, iters=12):
    """重合率随角度单调下降；返回重合率掉到 target% 的角度。永远到不了返回 -1。"""
    if overlap_percent(up, rotate(up, 90.0), a_up) > target:
        return -1.0
    lo, hi = 0.0, 90.0
    for _ in range(iters):
        mid = (lo + hi) * 0.5
        if overlap_percent(up, rotate(up, mid), a_up) > target:
            lo = mid
        else:
            hi = mid
    return hi


def a_equiv(angle80):
    """把角度敏感度折算成等效矩形长宽比（见文件头拟合式）。"""
    if angle80 <= 0:
        return float("inf")
    return 58.6 / (angle80 + 3.8)


def hit_windows(sh):
    """
    复刻主策划口径的命中窗口（2 圈 / cycle 2600 / passRate 0.6，h_line 匀速 + 匀速自转）：
    以 perfectMs 为中心，向早/晚二分到 overlap < 60% 的边界。
      v = 1080/cycle (px/ms)，ω = turns·360/cycle (°/ms)
      pose(dt) = 自转 ω·dt + 平移 v·dt
    返回 (earlyMs 负值, lateMs 正值, k = 总窗口/cycle)。
    与主策划 tool 的差别：不含 jitter/两段变速/帧量化，绝对值为其 2–4 倍，靠 K_SCALE 校准。
    """
    pts = pts_of(sh)
    L = float(sh.get("size") or 250)
    base = [(x * L, y * L) for x, y in pts]      # 目标姿态 = 物体完美姿态
    v = PATH_LEN_H_LINE / K_CYCLE
    w = K_TURNS * 360.0 / K_CYCLE

    def pct(dt):
        p = [(x + v * dt, y) for x, y in rotate(base, w * dt)]
        return overlap_percent(p, base)

    def edge(sign):
        lo, hi = 0.0, K_CYCLE * 0.5
        if pct(sign * hi) >= K_PASS:
            return hi
        for _ in range(11):
            mid = (lo + hi) * 0.5
            if pct(sign * mid) >= K_PASS:
                lo = mid
            else:
                hi = mid
        return hi

    early, late = edge(-1.0), edge(1.0)
    return -early, late, (early + late) / K_CYCLE


def grade_of(k2):
    """k 的描述性档位（只描述，不判合格——合格与否由 tier 区间决定）。"""
    if k2 == float("inf"):
        return "不合格"
    if k2 < K_MIN:
        return "极敏感"
    if k2 < 0.026:
        return "偏敏感"
    if k2 <= 0.038:
        return "舒适"
    if k2 <= K_MAX:
        return "偏宽容"
    return "极宽容"


# ---------------------------------------------------------------- 载入 / 写回
def load_shapes(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        arr = data
    elif isinstance(data, dict) and isinstance(data.get("shapes"), list):
        arr = data["shapes"]
    elif isinstance(data, dict) and all(isinstance(v, dict) and "pts" in v for v in data.values()):
        arr = list(data.values())
    else:
        raise SystemExit("无法识别的 shapes.json 结构：需要 {shapes:[...]} / 裸数组 / 按 id 的对象")
    return data, arr


def pts_of(shape):
    return [(float(p["x"]), float(p["y"])) for p in shape["pts"]]


def merge_shapes(arr, patch_path, allow_new=False):
    """按 id 覆盖 arr 里的形状。
    allow_new=False（默认，守契约）：patch 里出现未知 id 直接失败——防误删/改名。
    allow_new=True（--add）：未知 id 追加到末尾——v0.2 起扩充物体池才允许。
    """
    p = Path(patch_path)
    if not p.exists():
        raise SystemExit(f"MERGE FAIL|补丁文件不存在: {p}")
    data = json.loads(p.read_text(encoding="utf-8"))
    items = data["shapes"] if isinstance(data, dict) and "shapes" in data else data
    idx = {sh.get("id"): i for i, sh in enumerate(arr)}
    applied, added = [], []
    for new in items:
        sid = new.get("id")
        if not sid:
            raise SystemExit("MERGE FAIL|patch 里有形状缺 id")
        if sid in idx:
            arr[idx[sid]] = new
            applied.append(sid)
        elif allow_new:
            arr.append(new)
            idx[sid] = len(arr) - 1
            added.append(sid)
        else:
            raise SystemExit(f"MERGE FAIL|patch 里的 id={sid} 不在 shapes.json（不许增删 id；新增物体请加 --add）")
    return applied, added


def _fmt(v, nd):
    s = f"{v:.{nd}f}"
    if s.startswith("-0.") and float(s) == 0:
        s = s[1:]
    return s


def fix_shapes(arr):
    """精确归一化：形心 → (0,0)，长边 → 1（pts 与 details 一起变换）。"""
    changed = 0
    for sh in arr:
        pts = pts_of(sh)
        cx, cy = poly_centroid(pts)
        x0, y0, x1, y1 = poly_bounds(pts)
        long_edge = max(x1 - x0, y1 - y0)
        if long_edge <= 1e-12:
            continue
        k = 1.0 / long_edge

        def tf(x, y):
            return (round((x - cx) * k, 4), round((y - cy) * k, 4))

        new_pts = [{"x": tf(x, y)[0], "y": tf(x, y)[1]} for x, y in pts]
        new_details = []
        for d in sh.get("details") or []:
            d2 = dict(d)
            if d.get("k") in ("line", "poly"):
                d2["pts"] = [{"x": tf(p["x"], p["y"])[0], "y": tf(p["x"], p["y"])[1]} for p in d["pts"]]
            elif d.get("k") == "circle":
                nx, ny = tf(d["c"]["x"], d["c"]["y"])
                d2["c"] = {"x": nx, "y": ny}
                d2["r"] = round(float(d["r"]) * k, 4)
            new_details.append(d2)
        if not _same_pts(new_pts, sh["pts"]) and (
                abs(cx) > 1e-6 or abs(cy) > 1e-6 or abs(long_edge - 1.0) > 1e-6):
            sh["pts"] = new_pts
            if sh.get("details"):
                sh["details"] = new_details
            changed += 1
    return changed


def _same_pts(a, b):
    if len(a) != len(b):
        return False
    return all(abs(p["x"] - q["x"]) <= 5e-5 and abs(p["y"] - q["y"]) <= 5e-5 for p, q in zip(a, b))


# ---------------------------------------------------------------- 主流程
def measure(sh, quick=False):
    pts = pts_of(sh)
    n = len(pts)
    x0, y0, x1, y1 = poly_bounds(pts)
    w, h = x1 - x0, y1 - y0
    long_edge, short_edge = max(w, h), min(w, h)
    area = poly_area(pts)
    cx, cy = poly_centroid(pts)
    up = normalized(pts)
    a_up = poly_area(up)
    selfx, pairs = count_self_intersections(pts)

    m = {
        "id": sh.get("id", "?"), "name": sh.get("name", ""), "size": sh.get("size"),
        "n": n, "w": w, "h": h, "long": long_edge,
        "aspect": long_edge / short_edge if short_edge > 1e-12 else float("inf"),
        "fill": area / (w * h) if w * h > 1e-12 else 0.0,
        "selfx": selfx, "pairs": pairs,
        "sizeErr": abs(long_edge - 1.0), "centErr": math.hypot(cx, cy), "cent": (cx, cy),
        "flags": [], "notes": [],
        "rot30": overlap_percent(up, rotate(up, 30), a_up),
        "rot180": overlap_percent(up, rotate(up, 180), a_up),
        "angle80": -1.0, "angle60": -1.0, "aequiv": float("inf"),
        "k2": float("inf"), "k2lead": REF_LEAD_K.get(sh.get("id")), "earlyMs": 0.0, "lateMs": 0.0,
    }
    if not quick:
        m["angle80"] = angle_at(up, a_up, 80.0)
        m["angle60"] = angle_at(up, a_up, 60.0)
        m["aequiv"] = a_equiv(m["angle80"]) if m["angle80"] > 0 else float("inf")
        early, late, kk = hit_windows(sh)
        m["earlyMs"], m["lateMs"], m["k2"] = early, late, kk
    m["grade"] = grade_of(m["k2"]) if not quick else "?"

    if not (12 <= n <= 48):
        m["flags"].append(f"顶点数 {n} 不在 12–48")
    if selfx > 0:
        m["flags"].append(f"自交 {selfx} 对 e.g.{pairs[:3]}")
    if m["sizeErr"] > TOL_SIZE:
        m["flags"].append(f"长边误差 {m['sizeErr']:.4f}>{TOL_SIZE}")
    if m["centErr"] > TOL_CENT:
        m["flags"].append(f"形心偏移 {m['centErr']:.4f}>{TOL_CENT}")
    if not (MIN_FILL <= m["fill"] <= MAX_FILL):
        m["flags"].append(f"面积占比 {m['fill']:.3f} 不在 [{MIN_FILL},{MAX_FILL}]")
    if m["rot30"] >= MAX_ROT30:
        m["flags"].append(f"rot30 {m['rot30']:.1f}%≥{MAX_ROT30}（歪 30° 还是高分）")
    if m["rot180"] > MAX_SELF_ROT:
        m["notes"].append(f"180°自重合 {m['rot180']:.1f}%（参考项：玩法内偏离上限约 ±40°，不影响手感）")
    if m["size"] is None or not (240 <= float(m["size"]) <= 280):
        m["flags"].append(f"size={m['size']} 不在 240–280")
    return m


def main():
    _install_log()
    args = sys.argv[1:]
    do_fix = "--fix" in args
    do_md = "--md" in args
    quick = "--quick" in args
    do_merge = None
    if "--merge" in args:
        i = args.index("--merge")
        if i + 1 < len(args):
            do_merge = args[i + 1]
        else:
            print("FAIL|--merge 后面要跟补丁 json 路径")
            return 1

    if not SHAPES.exists():
        print(f"FAIL|shapes.json 不存在: {SHAPES}")
        return 1

    if do_merge:
        data, arr = load_shapes(SHAPES)
        applied, added = merge_shapes(arr, do_merge, allow_new=("--add" in args))
        SHAPES.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"MERGE|补丁 {do_merge}：覆盖 {len(applied)} 个（{', '.join(applied) or '无'}）"
              f"；新增 {len(added)} 个（{', '.join(added) or '无'}）")

    if do_fix:
        data, arr = load_shapes(SHAPES)
        changed = fix_shapes(arr)
        SHAPES.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"FIX|已精确归一化 {changed}/{len(arr)} 个形状并写回 {SHAPES}")

    data, arr = load_shapes(SHAPES)

    # ---- 第一遍：全部量一遍（含 k2 的二分窗口）
    metrics = [measure(sh, quick=quick) for sh in arr]

    # ---- 校准：用「已验收且未改动」的形状，把自算 k2 换算成主策划口径
    global K_SCALE
    ratios = []
    for m in metrics:
        if m["id"] in CHANGED_SHAPES or m["k2lead"] is None or m["k2"] == float("inf"):
            continue
        if m["k2"] > 0:
            ratios.append(m["k2lead"] / m["k2"])
    if ratios:
        ratios.sort()
        K_SCALE = ratios[len(ratios) // 2]
    for m in metrics:
        m["k2cal"] = m["k2"] * K_SCALE if m["k2"] != float("inf") else float("inf")
        # 最终判据优先用主策划实测（k2lead）：自算模型在边界上有误差，
        # 会给出 car 0.0474 / rocket 0.0196 这种假 FAIL，而实测是 0.0467 / 0.0200（合格）。
        use_lead = (m["k2lead"] is not None) and (m["id"] not in CHANGED_SHAPES)
        m["kfinal"] = m["k2lead"] if use_lead else m["k2cal"]
        m["ksrc"] = "实测" if use_lead else "自算"
        lo, hi, tier = band_of(m["id"])
        m["tier"] = tier
        m["band"] = (lo, hi)
        m["grade"] = grade_of(m["kfinal"])
        if not quick:
            out_of_band = (m["kfinal"] < lo) or (hi is not None and m["kfinal"] > hi)
            acc = ACCEPTED_K.get(m["id"])
            if out_of_band and acc:
                m["grade"] = "接受"
                m["notes"].append(f"k {m['kfinal']:.4f} 越界但已拍板接受（{acc[0]}）：{acc[1]}")
            elif out_of_band:
                band_txt = f"[{lo}, {hi if hi is not None else '∞'}]"
                m["flags"].append(
                    f"k {m['kfinal']:.4f} 超出 tier{tier} 区间 {band_txt}（{m['ksrc']}；窗口 {m['kfinal']*2600:.0f}ms）")

    print(f"# shapes.json = {SHAPES}")
    print(f"# 形状数 = {len(arr)}" + ("（--quick：跳过 angle80/angle60/k2）" if quick else ""))
    print(f"# 校准：自算 k2 × K_SCALE={K_SCALE:.3f} = 主策划口径（取 {len(ratios)} 个已验收形状的中位比值；"
          f"区间 {min(ratios):.2f}–{max(ratios):.2f}）" if ratios else "# 校准：无可用样本，K_SCALE=1")
    print("# tier 门禁：tier1 ≥0.030（只设下限）/ tier2 [0.018,0.052] / tier3 [0.020,0.048] / "
          "s2 [0.026,0.046] / s3 [0.020,0.038] / s4 [0.020,0.032]")
    print("# 列: id | tier | 长宽比 | rot30% | k | k来源 | 顶点数 | angle80 | angle60 | aEquiv | 面积占比 | 自交对数 | 长边误差 | 形心偏移 | rot180 | 难度档 | 结果")
    print("# 说明: k = 命中窗口/周期（2圈/2600ms/60%）。「实测」= 主策划 tool；「自算」= 模型×K_SCALE（形状刚改、实测未更新时用）")
    print("id|tier|aspect|rot30|k|kSrc|verts|angle80|angle60|aEquiv|fillRatio|selfX|sizeErr|centErr|rot180|grade|verdict")

    fails = [m for m in metrics if m["flags"]]
    for m in metrics:
        print("|".join([
            m["id"], str(m["tier"]), _fmt(m["aspect"], 2), _fmt(m["rot30"], 1),
            _fmt(m["kfinal"], 4) if m["kfinal"] != float("inf") else "n/a", m["ksrc"], str(m["n"]),
            _fmt(m["angle80"], 1) if m["angle80"] > 0 else "n/a",
            _fmt(m["angle60"], 1) if m["angle60"] > 0 else "n/a",
            _fmt(m["aequiv"], 2) if m["aequiv"] != float("inf") else "n/a",
            _fmt(m["fill"], 3), str(m["selfx"]), _fmt(m["sizeErr"], 4), _fmt(m["centErr"], 4),
            _fmt(m["rot180"], 1), m["grade"], "OK" if not m["flags"] else "FAIL",
        ]))

    # ---- 参考项（不 FAIL）：180° 自重合等提示
    note_rows = [m for m in metrics if m["notes"]]
    if note_rows:
        print("")
        print("# 参考项（不判红）")
        for m in note_rows:
            for n in m["notes"]:
                print(f"NOTE|{m['id']}|{n}")

    # ---- 关卡命中窗口：优先读 levels.json 的 hitWindow（与主策划 tool 同一份派生数据）
    if LEVELS.exists():
        try:
            import csv
            rows = list(csv.DictReader(LEVELS.open(encoding="utf-8-sig", newline="")))
            by_id = {m["id"]: m for m in metrics}
            lj = {}
            if LEVELS_JSON.exists():
                try:
                    ljd = json.loads(LEVELS_JSON.read_text(encoding="utf-8"))
                    for lv in (ljd.get("levels") or []):
                        lj[lv.get("id")] = lv
                except Exception as e:
                    print(f"# levels.json 读取失败，k 退回估算：{e}")
            print("")
            print("# 关卡命中窗口：halfWinMs = (|early|+late)/2（玩家实际可用的毫秒数，可与 hit_target_ms 对照）；"
                  "k 为该关自身口径（圈数/周期不同），不要拿上面的 0.020–0.047 判它")
            print("level|shape|turns|cycleMs|earlyMs|lateMs|halfWinMs|k|toleranceDeg|passRate|overlapAtTol")
            cache = {}
            for r in rows:
                sid = (r.get("object_id") or "").strip()
                if sid not in by_id:
                    print(f"{r.get('id')}|{sid}|-|-|-|-|-|-|-|-|形状缺失")
                    continue
                try:
                    tol = float(r.get("tolerance_deg"))
                    pr = float(r.get("pass_rate"))
                    turns = int(float(r.get("turns") or 1))
                except (TypeError, ValueError):
                    continue
                sh = next(x for x in arr if x.get("id") == sid)
                key = (sid, round(tol, 3))
                if key not in cache:
                    up = normalized(pts_of(sh))
                    cache[key] = overlap_percent(up, rotate(up, tol), poly_area(up))
                ov = cache[key]

                lv = lj.get(int(float(r.get("id") or 0)))
                hw = (lv or {}).get("hitWindow") or {}
                if hw.get("earlyMs") is not None and hw.get("lateMs") is not None:
                    cyc = float(lv.get("cycleMs") or r.get("cycle_ms") or 2600)
                    early = abs(float(hw["earlyMs"]))
                    late = abs(float(hw["lateMs"]))
                    kk = (early + late) / cyc
                    ktxt = f"{kk:.4f}"
                    e_txt, l_txt, c_txt = f"{early:.1f}", f"{late:.1f}", f"{cyc:.0f}"
                    half = (early + late) / 2.0
                else:
                    a60 = by_id[sid]["angle60"]
                    kk = (a60 / (180.0 * turns)) if a60 > 0 else float("inf")
                    ktxt = (f"{kk:.4f}est" if kk != float("inf") else "n/a")
                    e_txt = l_txt = c_txt = "-"
                    half = kk * 2600 / 2.0
                print(f"{r.get('id')}|{sid}|{turns}|{c_txt}|{e_txt}|{l_txt}|{half:.1f}|{ktxt}|{tol:g}|{pr * 100:.0f}|{ov:.1f}")
        except Exception as e:
            print(f"# levels.csv 读取失败（跳过）: {e}")

    print("")
    if fails:
        print(f"SUMMARY|shapes={len(arr)}|fail={len(fails)}")
        for m in fails:
            print(f"FAILED|{m['id']}|" + " ; ".join(m["flags"]))
        return 1
    print(f"SUMMARY|shapes={len(arr)}|fail=0|allGreen=1")
    print("ALL GREEN")

    if do_md:
        print("")
        print("<!-- markdown：可直接贴进 04_项目管理/美术_轮廓规格.md -->")
        print("| # | id | 名称 | 顶点 | 长宽比 | 面积占比 | rot30 | k（实测） | size | 进哪几关 |")
        print("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
        lvmap = {}
        if LEVELS.exists():
            try:
                import csv
                for r in csv.DictReader(LEVELS.open(encoding="utf-8-sig", newline="")):
                    for key in ("object_id", "object_id_2", "outline_id"):
                        sid = (r.get(key) or "").strip()
                        if sid:
                            tag = f"L{r.get('id')}"
                            if tag not in lvmap.setdefault(sid, []):
                                lvmap[sid].append(tag)
            except Exception:
                pass
        for i, m in enumerate(metrics, 1):
            kk = f"{m['kfinal']:.4f}" if m["kfinal"] != float("inf") else "n/a"
            lv = " ".join(lvmap.get(m["id"], [])) or "备用"
            print(f"| {i} | `{m['id']}` | {m['name']} | {m['n']} | {m['aspect']:.2f}:1 | "
                  f"{m['fill']:.2f} | {m['rot30']:.1f}% | {kk} | {m['size']} | {lv} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
