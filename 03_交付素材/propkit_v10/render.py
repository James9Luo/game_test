# -*- coding: utf-8 -*-
"""render.py —— v1.0 备份道具渲染器（Pillow，4× 超采样）

输入是**归一化后的 shape dict**（和导出的 json 逐字段一致），所以预览图就是玩家看到的东西：
预览 ≠ 数据是这个项目最容易翻车的地方（提案 §7 R7），这里从根上避免。

细节三种 kind 与原型 drawDetails() 完全一致：poly（填充多边形）/ line（折线，w 为设计 px）/ circle。
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from . import colors as C

FONTS = [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\simsun.ttc"]
FONTS_BOLD = [r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\simhei.ttf"]
_FONT_NOTE = [""]


def font(size, bold=False):
    for p in (FONTS_BOLD if bold else []) + FONTS:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    _FONT_NOTE[0] = "默认字体（无中文）"
    try:
        return ImageFont.load_default(size)
    except Exception:
        return ImageFont.load_default()


def _rgb(h):
    return C.hex2rgb(h)


def render_shape(sh, long_px, ss=4, pad=1.25):
    """把一个 shape dict 画成 RGBA 图（正方形画布，长边 = long_px 像素）。"""
    S = int(round(long_px * ss))
    if S < 8:
        S = 8
    W = int(round(S * pad))
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    cx = cy = W / 2.0
    scale = S  # 归一化后长边 = 1

    def tp(p):
        return (cx + p["x"] * scale, cy + p["y"] * scale)

    poly = [tp(p) for p in sh["pts"]]
    d = ImageDraw.Draw(img)
    d.polygon(poly, fill=_rgb(sh["fill"]) + (255,))

    size_px = float(sh.get("size") or 250)
    wf = long_px / size_px * ss  # 设计 px → 像素

    for det in sh.get("details") or []:
        k = det["k"]
        col = _rgb(det["color"]) + (255,)
        if k == "poly":
            pts = [tp(p) for p in det["pts"]]
            if len(pts) >= 3:
                d.polygon(pts, fill=col)
        elif k == "line":
            pts = [tp(p) for p in det["pts"]]
            if len(pts) < 2:
                continue
            w = max(1, int(round(float(det.get("w") or 2) * wf)))
            d.line(pts, fill=col, width=w, joint="curve")
            r = w / 2.0
            for q in (pts[0], pts[-1]):
                d.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=col)
        elif k == "circle":
            cpt = tp(det["c"])
            r = det["r"] * scale
            box = [cpt[0] - r, cpt[1] - r, cpt[0] + r, cpt[1] + r]
            if det.get("filled", True):
                d.ellipse(box, fill=col)
            else:
                d.ellipse(box, outline=col, width=max(1, int(round(float(det.get("w") or 2) * wf))))

    # 剪影遮罩：保证任何越界像素不会跑到轮廓外（同时暴露美术画超了的问题）
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    img.putalpha(mask)

    # 深色主描边（2px @ size 设计 px；风格圣经 §2.3「stroke 取同色系深两档」）
    ink = sh.get("stroke") or "#141E2C"
    lw = max(2, int(round(3.2 * wf * 1.0)))
    d.line(poly + [poly[0]], fill=_rgb(ink) + (255,), width=lw, joint="curve")

    return img.resize((max(1, int(round(W / ss))), max(1, int(round(W / ss)))), Image.LANCZOS)


def paste_prop(base, sh, long_px, cx, cy, rot=0.0, ss=4):
    """把物体按长边 long_px 放到 (cx, cy)，rot 度（顺时针，与 canvas 一致）。"""
    img = render_shape(sh, long_px, ss=ss)
    if abs(rot) > 1e-6:
        img = img.rotate(-rot, resample=Image.BICUBIC, expand=False)
    base.alpha_composite(img, (int(round(cx - img.width / 2)), int(round(cy - img.height / 2))))


def text(d, xy, s, size, color="#E8F1FF", anchor="la", bold=False):
    d.text(xy, s, font=font(size, bold), fill=color, anchor=anchor)
