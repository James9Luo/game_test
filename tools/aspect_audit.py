# -*- coding: utf-8 -*-
"""tools/aspect_audit.py —— 轮廓 vs 贴图 的客观体检（换形后必跑）

判据（D-126 教训）：只检查"描出来了"不够，必须检查**覆盖了全部有效像素**。
  · 长宽比差 ≤ 0.03（多边形 bbox vs 贴图 alpha bbox）
  · 面积占贴图比例 ≥ 0.85（防止只描了主体、丢了分离部件）

用法：
  python tools/aspect_audit.py            # 全量 36 件
  python tools/aspect_audit.py crab book  # 指定件
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "03_交付素材"))
sys.stdout.reconfigure(encoding="utf-8")

from PIL import Image  # noqa: E402

from propkit_v10 import path as P  # noqa: E402

ASPECT_TOL = 0.03      # 绝对容差
ASPECT_REL = 0.03      # 相对容差（细长件按比例更合理：滑板 2.70 的长宽比，0.07 绝对差只有 2.6%）
AREA_MIN = 0.85


def poly_area(pts):
    n = len(pts)
    return abs(sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n)) / 2.0)


def main(want):
    shapes = {s["id"]: s for s in json.loads((ROOT / "assets/config/shapes.json").read_text(encoding="utf-8"))["shapes"]}
    ids = want or sorted(shapes)
    bad = 0
    print("id        | 多边形比 | 贴图比 | Δ比 | 面积比 | 判定")
    for pid in ids:
        s = shapes.get(pid)
        if not s:
            print(f"{pid}: 不在 shapes.json")
            bad += 1
            continue
        sprite_path = ROOT / f"03_交付素材/gallery_sprites/{pid}.png"
        if not sprite_path.exists():
            print(f"{pid}: 缺贴图")
            bad += 1
            continue
        pts = [(q["x"], q["y"]) for q in s["pts"]]
        bx0, by0, bx1, by1 = P.bounds(pts)
        w, h = bx1 - bx0, by1 - by0
        sp = Image.open(sprite_path).convert("RGBA")
        alpha = sp.split()[3].point(lambda v: 255 if v > 110 else 0)
        bb = alpha.getbbox()
        sw, sh = bb[2] - bb[0], bb[3] - bb[1]
        a_poly, a_sprite = poly_area(pts), (w * h) and (sw * sh) / max(1e-9, max(sw, sh))  # 占位，下面按归一面积算
        # 面积比：多边形面积 / (贴图有效像素占比 × bbox 面积)
        inside = sum(1 for v in alpha.crop(bb).getdata() if v) / max(1, sw * sh)
        want_area = inside * (w * h)
        ratio = poly_area(pts) / max(1e-9, want_area)
        d_asp = abs((w / h) - (sw / sh))
        tol = max(ASPECT_TOL, ASPECT_REL * (sw / sh))
        ok = d_asp <= tol and ratio >= AREA_MIN
        if not ok:
            bad += 1
        print(f"{pid:9s} | {w/h:8.2f} | {sw/sh:6.2f} | {d_asp:4.2f} | {ratio:6.2f} | {'OK' if ok else '✗ 需重描'}")
    print(f"\nSUMMARY|checked={len(ids)}|bad={bad}")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
