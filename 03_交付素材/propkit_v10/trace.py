# -*- coding: utf-8 -*-
"""trace.py —— 「拼件 → 栅格化 → 描边 → 抽稀」：把若干个填充多边形并成一个外轮廓

为什么需要它：
    判定要的是**一个简单多边形**（绿框 = 它）。可插画式的道具是"身体 + 头 + 耳朵 + 尾巴"几块拼出来的，
    手写一个并集多边形每次都要自己排绕向，尾巴一拐就自交（v2–v7 就栽在这）。
    正确做法和美术一样：先各自画好、合成一张图，再把**外轮廓**描出来。

做法：
    1) 设计坐标 → 8× 栅格（每个小区是 1 单位）
    2) 每个部件按奇偶填成 mask
    3) 取"实心格与空格之间的边"，首尾串成环（无孔时唯一）
    4) 环 → 设计坐标 → Douglas–Peucker 抽稀到 ≤ max_n（保留转角）
"""
import math
from PIL import Image, ImageDraw

from . import path as P


def _bbox(parts, pad=2.0):
    xs, ys = [], []
    for pts in parts:
        for x, y in pts:
            xs.append(x)
            ys.append(y)
    return min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad


def raster_union(parts, ss=8):
    x0, y0, x1, y1 = _bbox(parts)
    w = int(math.ceil((x1 - x0) * ss)) + 2
    h = int(math.ceil((y1 - y0) * ss)) + 2
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    for pts in parts:
        d.polygon([((x - x0) * ss + 1, (y - y0) * ss + 1) for x, y in pts], fill=255)
    return m, (x0, y0, ss)


def _edges(mask):
    """返回 {(x,y): (nx,ny)} 的有向边表（实心格的四条边，逆时针绕行）。"""
    w, h = mask.size
    px = mask.load()
    edges = {}
    for y in range(h):
        for x in range(w):
            if not px[x, y]:
                continue
            # 上边（若上方为空）
            if y == 0 or not px[x, y - 1]:
                edges[(x, y)] = (x + 1, y)
            # 右边
            if x == w - 1 or not px[x + 1, y]:
                edges[(x + 1, y)] = (x + 1, y + 1)
            # 下边
            if y == h - 1 or not px[x, y + 1]:
                edges[(x + 1, y + 1)] = (x, y + 1)
            # 左边
            if x == 0 or not px[x - 1, y]:
                edges[(x, y + 1)] = (x, y)
    return edges


def trace_outline(parts, ss=8, max_n=44, tol=0.25):
    mask, (x0, y0, scale) = raster_union(parts, ss)
    edges = _edges(mask)
    if not edges:
        raise ValueError("trace_outline: 空 mask")
    # 从一个必然在边界上的点出发（最上最左）
    start = min(edges.keys(), key=lambda p: (p[1], p[0]))
    loop = [start]
    cur = start
    guard = 0
    while True:
        nxt = edges.get(cur)
        if nxt is None:
            raise ValueError("trace_outline: 边界不闭合（有孔或接触）")
        loop.append(nxt)
        cur = nxt
        guard += 1
        if cur == start or guard > len(edges) + 8:
            break
    loop = loop[:-1]
    pts = [((x - 1) / scale + x0, (y - 1) / scale + y0) for x, y in loop]
    pts = P._dedupe(pts, 1e-6)
    simp = P._dp_circular(pts, tol) if hasattr(P, "_dp_circular") else _dp_closed(pts, tol)
    if len(simp) > max_n:
        step = len(simp) / max_n
        simp = [simp[int(i * step)] for i in range(max_n)]
    return simp


def _dp_closed(pts, tol):
    n = len(pts)
    # 从最远的两点切开，各自 DP，再合并
    i0 = min(range(n), key=lambda i: (pts[i][1], pts[i][0]))
    i1 = max(range(n), key=lambda i: (pts[i][0] - pts[i0][0]) ** 2 + (pts[i][1] - pts[i0][1]) ** 2)
    if i1 < i0:
        i0, i1 = i1, i0
    a = P._dp(pts[i0:i1 + 1], tol)
    b = P._dp(pts[i1:] + pts[:i0 + 1], tol)
    return P._dedupe(a[:-1] + b[:-1])


def resample_closed(loop, n):
    """按弧长把闭合折线均匀重采样到 n 个点。
    相比 DP 的「删点」，均匀采样保持点的先后顺序，**不会引入新的自交**，
    适合细长/带肢体的物体（龙虾、飞龙、卫星这类）。"""
    if len(loop) < 3:
        return list(loop)
    n = max(3, int(n))
    pts = [(float(x), float(y)) for x, y in loop]
    segs = []
    total = 0.0
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        segs.append((a, b, d))
        total += d
    if total <= 1e-9:
        return pts[:n]
    step = total / n
    out = []
    idx = 0
    acc = 0.0
    for k in range(n):
        want = k * step
        while idx < len(segs) and acc + segs[idx][2] < want:
            acc += segs[idx][2]
            idx += 1
        if idx >= len(segs):
            out.append(pts[0])
            continue
        a, b, d = segs[idx]
        t = 0.0 if d <= 1e-9 else (want - acc) / d
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out
