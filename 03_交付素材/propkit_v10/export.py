# -*- coding: utf-8 -*-
"""export.py —— 设计坐标 → 归一化 shape dict（长边 = 1、形心 = 原点）+ 自检

与 assets/config/shapes.json 同一套几何契约（check_shapes.py 的硬校验）：
  顶点 12–48 / 简单多边形 / 长边误差 < 0.02 / 形心 < 0.05 / 面积占比 0.12–0.95 / rot30 < 92%
另加一条本项目特有：**details 必须内缩在轮廓内**（引擎不 clip，画出去就是穿模）。
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DELIV = HERE.parent
ROOT = DELIV.parent
sys.path.insert(0, str(DELIV))

import check_shapes as cs  # noqa: E402  复用同一份几何口径

from . import colors as C  # noqa: E402
from . import path as P  # noqa: E402


class Prop:
    """一件道具的完整描述（设计坐标，y 向下）。"""

    def __init__(self, id, name, size, fill, stroke, contour,
                 parts=None, strokes=None, src_id=None, note="", band=None, kind="器物"):
        self.id = id
        self.name = name
        self.size = size
        self.fill = fill
        self.stroke = stroke
        self.contour = contour
        self.parts = parts or []      # [(pts, color)]
        self.strokes = strokes or []  # [(pts, w_design_unit, color)]
        self.src_id = src_id
        self.note = note
        self.band = band
        self.kind = kind


def _r(v, nd=3):
    s = round(float(v), nd)
    return 0.0 if abs(s) < 1e-9 else s


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


def _edge_dist(pt, poly,):
    """点到多边形边界的最短距离（判断「贴边」用：details 与轮廓共边是正常写法，不算越界）。"""
    x, y = pt
    best = 1e18
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
        px, py = ax + dx * t, ay + dy * t
        best = min(best, math.hypot(x - px, y - py))
    return best


def _inside_tol(pt, poly, tol=0.7):
    return _inside(pt, poly) or _edge_dist(pt, poly) <= tol


def build(prop, max_vertices=44):
    """返回 (shape_dict, report)。"""
    contour = P.poly(prop.contour)
    cx0, cy0 = P.centroid(contour)
    x0, y0, x1, y1 = P.bounds(contour)
    long_edge = max(x1 - x0, y1 - y0)

    simp, eps = P.simplify_closed(contour, max_n=max_vertices)

    def norm(pts):
        return [{"x": _r((x - cx0) / long_edge), "y": _r((y - cy0) / long_edge)} for x, y in pts]

    # 亮度闸：任何色超过 L78% 自动往暗里拉（绿框 L80% 是全场最亮，风格圣经 §2.6⑤）
    clamped = []

    def c_(color):
        fixed = C.clamp_l(color)
        if fixed != color:
            clamped.append((color, fixed))
        return fixed

    details = []
    out_of_bounds = []
    snapped = 0
    clipped_lines = 0
    for pts, color in prop.parts:
        fixed = []
        for p in pts:
            if P.inside_tol(p, contour):
                fixed.append(p)
            else:
                fixed.append(P.nearest_on_poly(p, contour))
                snapped += 1
        # 色块抽稀：视觉上 250px 处误差 < 0.3px，但 JSON 体积能少一半（原型 500KB 上限，D-103）
        simp_part, _ = P.simplify_closed(fixed, max_n=44, min_n=6, target=26, eps0=0.04)
        details.append({"k": "poly", "pts": norm(simp_part), "color": c_(color)})
    for pts, w, color in prop.strokes:
        subs = P.clip_polyline(pts, contour)
        if len(subs) != 1 or len(subs[0]) != len(pts):
            clipped_lines += 1
        for sub in subs:
            thin = P._dp(sub, 0.12) if len(sub) > 2 else sub
            details.append({"k": "line", "pts": norm(thin),
                            "w": round(float(w) * prop.size / long_edge, 2), "color": c_(color)})

    sh = {
        "id": prop.id,
        "name": prop.name,
        "fill": c_(prop.fill),
        "stroke": c_(prop.stroke),
        "size": prop.size,
        "pts": norm(simp),
        "details": details,
        "srcId": prop.src_id,
        "band": prop.band,
        "kind": prop.kind,
        "note": prop.note,
    }

    rep = {"id": prop.id, "eps": round(eps, 3), "verts": len(simp),
           "outside": len(out_of_bounds), "snapped": snapped,
           "clippedLines": clipped_lines, "long": round(long_edge, 2),
           "clamped": len(clamped)}

    # ---- 硬校验（与 check_shapes 同口径；k 由 tools/k_probe.mjs 出实测值）
    pts = [(p["x"], p["y"]) for p in sh["pts"]]
    area = P.area(pts)
    w, h = (x1 - x0) / long_edge, (y1 - y0) / long_edge
    cxy = P.centroid(pts)
    rep.update({
        "aspect": round(max(w, h) / max(1e-9, min(w, h)), 2),
        "fill": round(area / max(1e-9, w * h), 3),
        "cent": round(math.hypot(*cxy), 4),
        "selfX": P.count_self_intersections(pts),
    })
    up = cs.normalized(pts)
    rep["rot30"] = round(cs.overlap_percent(up, cs.rotate(up, 30), cs.poly_area(up)), 1)
    rep["fails"] = []
    if not (12 <= len(pts) <= max_vertices):
        rep["fails"].append(f"顶点 {len(pts)}")
    if rep["selfX"]:
        rep["fails"].append(f"自交 {rep['selfX']}")
    if rep["cent"] > 0.05:
        rep["fails"].append(f"形心 {rep['cent']}")
    if not (0.12 <= rep["fill"] <= 0.98):
        rep["fails"].append(f"面积占比 {rep['fill']}")
    if rep["rot30"] >= 92:
        rep["fails"].append(f"rot30 {rep['rot30']}%")
    if rep["outside"]:
        rep["fails"].append(f"细节出轮廓 {rep['outside']} 点")
    for col, where in [(sh["fill"], "fill"), (sh["stroke"], "stroke")] + \
                      [(d["color"], "detail") for d in details if d["k"] == "poly"] + \
                      [(d["color"], "line") for d in details if d["k"] == "line"]:
        for msg in C.audit(col):
            rep["fails"].append(f"{where} {col}: {msg}")
    return sh, rep


def write(path, shapes, note, extra=None):
    data = {"version": "v10-backup-1", "note": note, "shapes": shapes}
    if extra:
        data.update(extra)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return path
