# -*- coding: utf-8 -*-
"""colors.py —— 配色与明度（口径与 02_美术源文件/风格圣经.md §2 / §6.1 同一套）

三条硬线（新备份集必须满足，验收表里逐条可测）：
  ① 局部 L ≤ 78%（绿框描边 L=80% 是全场最亮，任何像素不许比它亮；琥珀亮档已是既有例外）
  ② 同色系三档：base / shade（压暗）/ light（提亮），色相差 ≤ 10°
  ③ 不得进入 mint 色相 158°±20°（138–178°）——绿是判定专用
  
不引入 alpha：明暗面全部预烘焙成不透明多边形（引擎 Graphics 的 alpha 有未验证风险，见提案 §3.2/R3）。
"""
import colorsys

MINT_HUE = 158.0


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb2hex(r, g, b):
    f = lambda v: max(0, min(255, int(round(v))))
    return "#%02X%02X%02X" % (f(r), f(g), f(b))


def lum(h):
    """风格圣经 §6.1 的相对亮度（0–1）。"""
    r, g, b = hex2rgb(h)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


def hue(h):
    r, g, b = [v / 255 for v in hex2rgb(h)]
    hh, _, _ = colorsys.rgb_to_hsv(r, g, b)
    return hh * 360


def mix(h1, h2, t):
    a, b = hex2rgb(h1), hex2rgb(h2)
    return rgb2hex(*(a[i] + (b[i] - a[i]) * t for i in range(3)))


DARK = "#141E2C"
LIGHT = "#FFF4DC"


def shade(h, t=0.22):
    return mix(h, DARK, t)


def light(h, t=0.18):
    return mix(h, LIGHT, t)


def deep(h, t=0.42):
    return mix(h, DARK, t)


def clamp_l(h, cap=0.78):
    """超过亮度上限就往暗里拉（保色相，不保饱和）。"""
    v = lum(h)
    if v <= cap:
        return h
    t = 0.0
    out = h
    while t < 0.9:
        t += 0.05
        out = mix(h, DARK, t)
        if lum(out) <= cap:
            return out
    return out


def audit(h):
    """返回该色的问题列表（空 = 通过）。"""
    bad = []
    hv = hue(h)
    if 138.0 <= hv <= 178.0:
        bad.append(f"色相 {hv:.0f}° 落入 mint 独占区")
    lv = lum(h)
    if lv > 0.78 + 1e-6:
        bad.append(f"L {lv*100:.1f}% > 78%")
    return bad
