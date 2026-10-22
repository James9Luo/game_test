# -*- coding: utf-8 -*-
"""path.py —— v1.0 备份道具的路径/多边形工具（只用标准库）

约定：设计单位随意（约 100 宽），y 向下；最终由 export.py 归一化成「长边 = 1、形心 = 原点」，
与 assets/config/shapes.json 同口径（check_shapes.py 的 fix_shapes 规则一致）。

为什么自己写：新风格的圆角/贝塞尔边必须落成**多边形**（引擎只认 fill 多边形，见 D-029），
所以每条曲线都要先采样再抽稀到 ≤48 顶点（判定轮廓）或直接采样（details，无顶点上限）。
"""
import math


# ---------------------------------------------------------------- 路径
class Path:
    """M / L / Q / C / Z。Pt 用 tuple。"""

    def __init__(self, x=0.0, y=0.0):
        self.segs = [("M", (x, y))]
        self.cur = (x, y)

    # -- 构造 --
    def l(self, x, y):
        self.segs.append(("L", (x, y)))
        self.cur = (x, y)
        return self

    def q(self, cx, cy, x, y):
        self.segs.append(("Q", (cx, cy, x, y)))
        self.cur = (x, y)
        return self

    def c(self, c1x, c1y, c2x, c2y, x, y):
        self.segs.append(("C", (c1x, c1y, c2x, c2y, x, y)))
        self.cur = (x, y)
        return self

    def z(self):
        self.segs.append(("Z", None))
        return self

    def pts(self, nq=10, nc=14):
        """采样成折线（闭合路径不重复首点）。"""
        out = []
        for s in self.segs:
            k = s[0]
            if k == "M":
                out.append(s[1])
            elif k == "L":
                out.append(s[1])
            elif k == "Q":
                cx, cy = s[1]
                x, y = s[2]
                px, py = out[-1]
                for i in range(1, nq + 1):
                    t = i / nq
                    mt = 1 - t
                    out.append((mt * mt * px + 2 * mt * t * cx + t * t * x,
                                mt * mt * py + 2 * mt * t * cy + t * t * y))
            elif k == "C":
                c1x, c1y, c2x, c2y, x, y = s[1], s[2], s[3], s[4], s[5], s[6]
                px, py = out[-1]
                for i in range(1, nc + 1):
                    t = i / nc
                    mt = 1 - t
                    a = mt * mt * mt
                    b = 3 * mt * mt * t
                    c_ = 3 * mt * t * t
                    d = t * t * t
                    out.append((a * px + b * c1x + c_ * c2x + d * x,
                                a * py + b * c1y + c_ * c2y + d * y))
            elif k == "Z":
                pass
        if len(out) > 1 and _near(out[0], out[-1]):
            out.pop()
        return out

    def close(self):
        """补一段回到起点的直线（闭合用）。"""
        x0, y0 = self.segs[0][1]
        return self.l(x0, y0)


def _near(a, b, eps=1e-9):
    return abs(a[0] - b[0]) < eps and abs(a[1] - b[1]) < eps


# ---------------------------------------------------------------- 基础形状
def ellipse(cx, cy, rx, ry, rot=0.0, n=96):
    pts = []
    co, si = math.cos(rot), math.sin(rot)
    for i in range(n):
        a = 2 * math.pi * i / n
        x, y = rx * math.cos(a), ry * math.sin(a)
        pts.append((cx + x * co - y * si, cy + x * si + y * co))
    return pts


def circle(cx, cy, r, n=64):
    return ellipse(cx, cy, r, r, 0.0, n)


def rrect(x0, y0, x1, y1, r, n_per_corner=6):
    """圆角矩形（顺序：左上 → 右上 → 右下 → 左下，y 向下）。"""
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    pts = []
    corners = [((x1 - r, y0 + r), -90, 0), ((x1 - r, y1 - r), 0, 90),
               ((x0 + r, y1 - r), 90, 180), ((x0 + r, y0 + r), 180, 270)]
    for (cx, cy), a0, a1 in corners:
        for i in range(n_per_corner + 1):
            a = math.radians(a0 + (a1 - a0) * i / n_per_corner)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return _dedupe(pts)


def poly(pts):
    return [tuple(p) for p in pts]


def arc(cx, cy, rx, ry, a0, a1, n=24, rot=0.0):
    """开口圆弧折线（度，y 向下顺时针）。"""
    pts = []
    co, si = math.cos(rot), math.sin(rot)
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        x, y = rx * math.cos(a), ry * math.sin(a)
        pts.append((cx + x * co - y * si, cy + x * si + y * co))
    return pts


def _dedupe(pts, eps=1e-7):
    out = []
    for p in pts:
        if not out or not _near(out[-1], p, eps):
            out.append(p)
    if len(out) > 2 and _near(out[0], out[-1], eps):
        out.pop()
    return out


def mirror(pts, axis="x"):
    if axis == "x":
        return [(-x, y) for x, y in pts]
    return [(x, -y) for x, y in pts]


def shift(pts, dx, dy):
    return [(x + dx, y + dy) for x, y in pts]


# ---------------------------------------------------------------- 多边形运算
def area(pts):
    s = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return abs(s) * 0.5


def centroid(pts):
    a = cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        px, py = pts[i]
        qx, qy = pts[(i + 1) % n]
        cr = px * qy - qx * py
        a += cr
        cx += (px + qx) * cr
        cy += (py + qy) * cr
    if abs(a) < 1e-12:
        return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
    return (cx / (3 * a), cy / (3 * a))


def bounds(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def clip_half(pts, nx, ny, d):
    """保留 nx*x + ny*y <= d 的部分（Sutherland–Hodgman，凸裁剪对任意简单多边形成立）。"""
    if not pts:
        return []
    out = []
    n = len(pts)
    for i in range(n):
        a = pts[i]
        b = pts[(i + 1) % n]
        da = nx * a[0] + ny * a[1] - d
        db = nx * b[0] + ny * b[1] - d
        if da <= 0:
            out.append(a)
        if (da < 0 < db) or (db < 0 < da):
            t = da / (da - db)
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return _dedupe(out)


def slab(pts, nx, ny, d0, d1):
    """保留 d0 <= n·p <= d1 的条带。"""
    return clip_half(clip_half(pts, -nx, -ny, -d0), nx, ny, d1)


def dark_side(pts, k=0.34, angle=0.9):
    """右下暗面：沿 (cos,sin) 方向、按包围盒尺度的 k 处切一刀，保留远侧。"""
    x0, y0, x1, y1 = bounds(pts)
    nx, ny = math.cos(angle), math.sin(angle)
    d = (nx * x0 + ny * y0) * (1 - k) + (nx * x1 + ny * y1) * k
    return clip_half(pts, -nx, -ny, -d)


def light_side(pts, k=0.30, width=0.26, angle=-2.2):
    """左上亮带：沿 (cos,sin) 法向取一条窄带。"""
    x0, y0, x1, y1 = bounds(pts)
    nx, ny = math.cos(angle), math.sin(angle)
    lo = nx * x0 + ny * y0
    hi = nx * x1 + ny * y1
    span = hi - lo
    return slab(pts, nx, ny, lo + span * k, lo + span * min(1.0, k + width))


def top(pts, y):
    """保留 y ≤ y 的部分（画面上半）。"""
    return clip_half(pts, 0, 1, y)


def bottom(pts, y):
    """保留 y ≥ y 的部分。"""
    return clip_half(pts, 0, -1, -y)


def left(pts, x):
    """保留 x ≤ x 的部分。"""
    return clip_half(pts, 1, 0, x)


def right(pts, x):
    """保留 x ≥ x 的部分。"""
    return clip_half(pts, -1, 0, -x)


def band_y(pts, y0, y1):
    return top(bottom(pts, y0), y1)


def band_x(pts, x0, x1):
    return right(left(pts, x1), x0)


def _inside(pt, poly):
    x, y = pt
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            t = (y - yi) / (yj - yi) if abs(yj - yi) > 1e-12 else 0
            if x < xi + t * (xj - xi):
                inside = not inside
        j = i
    return inside


def edge_dist(pt, poly):
    x, y = pt
    best = 1e18
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
        best = min(best, math.hypot(x - (ax + dx * t), y - (ay + dy * t)))
    return best


def nearest_on_poly(pt, poly):
    """返回多边形边界上离 pt 最近的点（details 越界时把它们「按」回边界用）。"""
    x, y = pt
    best, bp = 1e18, poly[0]
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
        px, py = ax + dx * t, ay + dy * t
        d = math.hypot(x - px, y - py)
        if d < best:
            best, bp = d, (px, py)
    return bp


def inside_tol(pt, poly, tol=0.7):
    return _inside(pt, poly) or edge_dist(pt, poly) <= tol


def clip_polyline(pts, poly, tol=0.7, samples=14):
    """把开口折线裁进轮廓：返回若干子折线（每段都含边界交点，视觉上贴着边）。

    只做「端点内外判断 + 二分找交点」，不追求布尔运算的完备性——
    details 全部是装饰线，少一段不会穿模，多一段就会。
    """
    inside = [inside_tol(p, poly, tol) for p in pts]
    if not any(inside):
        return []
    if all(inside):
        return [pts]

    def cross(a, b):
        """a 在内、b 在外（或反之）时二分出边界点。"""
        lo, hi = (a, b) if inside_tol(a, poly, tol) else (b, a)
        p_lo, p_hi = lo, hi
        for _ in range(samples):
            mid = ((p_lo[0] + p_hi[0]) / 2, (p_lo[1] + p_hi[1]) / 2)
            if inside_tol(mid, poly, tol):
                p_lo = mid
            else:
                p_hi = mid
        return p_lo if inside_tol(p_lo, poly, tol) else p_hi

    out, cur = [], []
    for i, p in enumerate(pts):
        if inside[i]:
            if not cur and i > 0 and not inside[i - 1]:
                cur.append(cross(p, pts[i - 1]))
            cur.append(p)
        else:
            if cur:
                cur.append(cross(pts[i - 1], p))
                if len(cur) >= 2:
                    out.append(cur)
                cur = []
    if len(cur) >= 2:
        out.append(cur)
    return out


def offset_poly(pts, d):
    """沿形心方向整体缩放（近似内缩/外扩），用于做描边内圈或内阴影。"""
    cx, cy = centroid(pts)
    x0, y0, x1, y1 = bounds(pts)
    s = 1.0 - d / max(x1 - x0, y1 - y0)
    return [(cx + (x - cx) * s, cy + (y - cy) * s) for x, y in pts]


# ---------------------------------------------------------------- 抽稀
def _dp(pts, eps):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True

    def rec(i, j):
        if j <= i + 1:
            return
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for t in range(i + 1, j):
            px, py = pts[t]
            if L < 1e-12:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / L
            if d > best:
                best, bi = d, t
        if best > eps:
            keep[bi] = True
            rec(i, bi)
            rec(bi, j)

    rec(0, len(pts) - 1)
    return [p for p, k in zip(pts, keep) if k]


def simplify_closed(pts, max_n=44, min_n=12, target=34, eps0=0.02):
    """把闭合折线抽稀：顶点数尽量接近 target，上限 max_n、下限 min_n；抽稀后必须不自交。

    返回 (pts, eps)。**顶点的取舍只看几何误差**，不看"好不好看"——判定口径要可复现。
    为什么要有下限：顶点太少（<12）会让「歪一点就掉分」失效，check_shapes 也会判失败。
    """
    # 原始顶点已经够用（且不自交）就别抽稀：抽稀会把凹口切掉，反而造出自交
    if len(pts) <= max_n and count_self_intersections(pts) == 0:
        return pts, 0.0
    best = None
    best_score = None
    eps = eps0
    for _ in range(40):
        half = len(pts) // 2
        a = _dp(pts[:half + 1], eps)
        b = _dp(pts[half:] + [pts[0]], eps)
        cand = _dedupe(a[:-1] + b[:-1])
        n = len(cand)
        if min_n <= n <= max_n and count_self_intersections(cand) == 0:
            score = abs(n - target)
            if best_score is None or score < best_score:
                best, best_score = (cand, eps), score
            if n >= target:      # 已经到目标附近（再放稀只会更少）
                break
        eps *= 1.22
    if best:
        return best
    # 兜底：按弧长等距取点
    for n in (target, 20, 14, 12):
        cand = sample_even(pts, n)
        if count_self_intersections(cand) == 0:
            return cand, -1.0
    return sample_even(pts, 12), -1.0


def sample_even(pts, n):
    """闭合折线上按弧长等距取 n 个点（兜底用）。"""
    segs = []
    total = 0.0
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        segs.append((a, b, d))
        total += d
    out = []
    for i in range(n):
        target = total * i / n
        acc = 0.0
        for a, b, d in segs:
            if acc + d >= target and d > 0:
                t = (target - acc) / d
                out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
                break
            acc += d
    return out


def count_self_intersections(pts):
    """相邻边不算；其余相交 = 1（返回对数）。"""
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    def on_seg(a, b, p, eps=1e-9):
        if abs(orient(a, b, p)) > eps:
            return False
        return (min(a[0], b[0]) - eps <= p[0] <= max(a[0], b[0]) + eps and
                min(a[1], b[1]) - eps <= p[1] <= max(a[1], b[1]) + eps)

    n = len(pts)
    bad = 0
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        for j in range(i + 1, n):
            if j == (i + 1) % n or i == (j + 1) % n:
                continue
            c, d = pts[j], pts[(j + 1) % n]
            o1, o2 = orient(a, b, c), orient(a, b, d)
            o3, o4 = orient(c, d, a), orient(c, d, b)
            if ((o1 > 1e-9 and o2 < -1e-9) or (o1 < -1e-9 and o2 > 1e-9)) and \
               ((o3 > 1e-9 and o4 < -1e-9) or (o3 < -1e-9 and o4 > 1e-9)):
                bad += 1
            elif on_seg(a, b, c) or on_seg(a, b, d) or on_seg(c, d, a) or on_seg(c, d, b):
                bad += 1
    return bad
