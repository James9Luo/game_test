# -*- coding: utf-8 -*-
"""lookdev.py v3（正式版）：位图 → shape dict

v2→v3 的两处关键改动：
  · 色块来源从「亮度分位」改成「先量化颜色、再按色块描边」——亮度分位会把渐变噪声切成碎块
  · 族色阶按「与 9 个族基色的最近距离」判定（HSV 阈值会把低饱和的琥珀误判成米色 → 整只鸭子发褐）
  · 每个色块按 4 邻连通分量分别描边（一档色常由多块组成）
"""
from PIL import Image, ImageFilter

from . import colors as C
from . import path as P
from . import trace as T

WHITE = 246
MIN_COMP_PCT = 0.6

FAMILIES = {
    "ice": "#9BBBD9", "sky": "#79A5CD", "amber": "#D8A54C", "coral": "#DC5348",
    "magenta": "#DE7C9C", "purple": "#B79CF5", "cream": "#C6B183",
    "silver": "#AFBECD", "porcelain": "#B6C2D1",
}


def _rgb(h):
    return C.hex2rgb(h)


def family_of(rgb):
    best, name = 1e18, "cream"
    for k, hexc in FAMILIES.items():
        r, g, b = _rgb(hexc)
        d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2
        if d < best:
            best, name = d, k
    return name


def ramp_of(rgb, n=5):
    base = FAMILIES[family_of(rgb)]
    light = C.light(base, 0.18)
    dark = C.shade(base, 0.18)
    deep = C.deep(base, 0.45)
    steps = [C.clamp_l(deep, 0.60), C.clamp_l(dark, 0.72), C.clamp_l(base, 0.78),
             C.clamp_l(light, 0.78), C.clamp_l(C.light(light, 0.10), 0.78)]
    return steps[:n] if n <= 5 else steps + [steps[-1]] * (n - 5)


def _piece_color(rgb, t):
    """t = 该块在整体亮度谱上的位置（0 最暗 → 1 最亮）；按块自己的族取档。"""
    fam = FAMILIES[family_of(rgb)]
    light = C.light(fam, 0.18)
    dark = C.shade(fam, 0.18)
    deep = C.deep(fam, 0.45)
    steps = [C.clamp_l(deep, 0.60), C.clamp_l(dark, 0.72), C.clamp_l(fam, 0.78),
             C.clamp_l(light, 0.78), C.clamp_l(C.light(light, 0.10), 0.78)]
    idx = min(4, max(0, int(round(t * 4))))
    return steps[idx]


def _load_scaled(path, long_px=560):
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    f = long_px / max(w, h)
    img = img.resize((max(1, int(w * f)), max(1, int(h * f))), Image.LANCZOS)
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 200 and r >= WHITE and g >= WHITE and b >= WHITE:
                px[x, y] = (r, g, b, 0)
    return img


def _flood_bg(img):
    px = img.load()
    w, h = img.size
    bg = [[False] * w for _ in range(h)]
    stack = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)]
    stack += [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h or bg[y][x]:
            continue
        r, g, b, a = px[x, y]
        if a > 200 and not (r >= WHITE and g >= WHITE and b >= WHITE):
            continue
        bg[y][x] = True
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            if not bg[y][x] and px[x, y][3] > 60:
                mp[x, y] = 255
                xs.append(x)
                ys.append(y)
    if not xs:
        raise ValueError("lookdev: 没抠出主体")
    return mask, (min(xs), min(ys), max(xs) + 1, max(ys) + 1)


def _components(mask, min_px):
    w, h = mask.size
    px = mask.load()
    seen = [[False] * w for _ in range(h)]
    out = []
    for y in range(h):
        for x in range(w):
            if not px[x, y] or seen[y][x]:
                continue
            comp, stack = [], [(x, y)]
            seen[y][x] = True
            while stack:
                cx, cy = stack.pop()
                comp.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            if len(comp) >= min_px:
                out.append(comp)
    out.sort(key=len, reverse=True)
    return out


def _trace_component(comp, tol, max_n):
    cells = set(comp)
    edges = {}
    for (x, y) in cells:
        if (x, y - 1) not in cells:
            edges[(x, y)] = (x + 1, y)
        if (x + 1, y) not in cells:
            edges[(x + 1, y)] = (x + 1, y + 1)
        if (x, y + 1) not in cells:
            edges[(x + 1, y + 1)] = (x, y + 1)
        if (x - 1, y) not in cells:
            edges[(x, y + 1)] = (x, y)
    if not edges:
        return []
    start = min(edges.keys(), key=lambda p: (p[1], p[0]))
    loop, cur = [start], start
    for _ in range(len(edges) + 8):
        nxt = edges.get(cur)
        if nxt is None:
            break
        loop.append(nxt)
        cur = nxt
        if cur == start:
            break
    if loop and loop[-1] == start:
        loop = loop[:-1]
    if len(loop) < 8:
        return []
    if len(loop) > 900:
        step = len(loop) / 900
        loop = [loop[int(i * step)] for i in range(900)]
    simp = T._dp_closed(loop, tol)
    if len(simp) > max_n:
        step = len(simp) / max_n
        simp = [simp[int(i * step)] for i in range(max_n)]
    return simp


def _median(px, cells):
    vals = sorted(tuple(px[x, y][:3]) for x, y in cells)
    return vals[len(vals) // 2] if vals else (128, 128, 128)


def image_to_shape(path, name, size=252, max_verts=44, colors=8, merge_dist=60):
    img = _load_scaled(path)
    sil, box = _flood_bg(img)
    w, h = img.size
    x0, y0, x1, y1 = box
    scale = 100.0 / max(x1 - x0, y1 - y0)

    rgb = img.convert("RGB").filter(ImageFilter.MedianFilter(3))
    obj = Image.new("RGB", (w, h), (0, 0, 0))
    mp = sil.load()
    for y in range(h):
        for x in range(w):
            if mp[x, y]:
                obj.putpixel((x, y), rgb.getpixel((x, y)))

    q = obj.quantize(colors=colors, method=Image.MEDIANCUT)
    pal = q.getpalette()
    qi = q.load()
    counts = {}
    for y in range(y0, y1):
        for x in range(x0, x1):
            if mp[x, y]:
                counts[qi[x, y]] = counts.get(qi[x, y], 0) + 1

    clusters = []
    for idx, cnt in sorted(counts.items(), key=lambda kv: -kv[1]):
        c = tuple(pal[idx * 3: idx * 3 + 3])
        for cl in clusters:
            if sum(abs(c[i] - cl["color"][i]) for i in range(3)) < merge_dist:
                cl["idxs"].append(idx)
                cl["count"] += cnt
                break
        else:
            clusters.append({"idxs": [idx], "color": c, "count": cnt})
    clusters.sort(key=lambda c: -c["count"])

    all_cells = set()
    for comp in _components(sil, 40):
        all_cells |= set(comp)
    outline = [((x - x0) * scale, (y - y0) * scale) for x, y in _trace_component(list(all_cells), 0.9, max_verts)]

    total = sum(cl["count"] for cl in clusters)
    min_comp = max(40, int(total * MIN_COMP_PCT / 100))
    pieces = []
    for cl in clusters:
        m = Image.new("L", (w, h), 0)
        mpx = m.load()
        for y in range(y0, y1):
            for x in range(x0, x1):
                if mp[x, y] and qi[x, y] in cl["idxs"]:
                    mpx[x, y] = 255
        for comp in _components(m, min_comp):
            loop = _trace_component(comp, 1.1, 110)
            if len(loop) < 6:
                continue
            col = cl["color"]
            pieces.append({"pts": [((x - x0) * scale, (y - y0) * scale) for x, y in loop],
                           "area": len(comp), "rgb": col,
                           "lum": 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2]})
    if not pieces:
        raise ValueError("lookdev: 没提取到色块")
    pieces.sort(key=lambda d: -d["area"])

    base_rgb = _median(img.load(), list(all_cells))
    lums = [pc["lum"] for pc in pieces]
    lo, hi = min(lums), max(lums)
    span = max(1e-6, hi - lo)
    for pc in pieces:
        t = (pc["lum"] - lo) / span
        pc["color"] = _piece_color(pc.get("rgb", base_rgb), t)
    base = _piece_color(base_rgb, 0.5)

    cx, cy = P.centroid(outline)
    bx0, by0, bx1, by1 = P.bounds(outline)
    long_edge = max(bx1 - bx0, by1 - by0)
    norm = lambda pts: [{"x": round((x - cx) / long_edge, 3), "y": round((y - cy) / long_edge, 3)} for x, y in pts]

    return {
        "id": None, "name": name, "fill": base,
        "stroke": C.clamp_l(C.deep(base, 0.45), 0.60), "size": size,
        "pts": norm(outline),
        "details": [{"k": "poly", "color": pc["color"], "pts": norm(pc["pts"])} for pc in pieces],
        "note": f"lookdev→多边形（{len(clusters)} 簇 / ≤{max_verts} 顶点 / {len(pieces)} 块）",
    }
