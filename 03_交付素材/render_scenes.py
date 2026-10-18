# -*- coding: utf-8 -*-
"""
render_scenes.py —— v0.2 三场景预览（一条命令出图）

用法（仓库根目录）：
    python 03_交付素材/render_scenes.py

输出（写死）：
    03_交付素材/scene_night.png     night_station（暗底，frameStyle=glow）
    03_交付素材/scene_noon.png      noon_window（白底，frameStyle=shadow ← 最容易失锚的一张）
    03_交付素材/scene_minimal.png   minimal（极简，frameStyle=glow）
    03_交付素材/scene_thumbs.png    三张 240px 宽缩略并排 —— 验收口径就是"240px 缩略下背景不抢绿框"

每张图内容：底色渐变 + 该场景全部动态层的**静态代表位**（静帧看不出运动，只用来判"背景抢不抢主体"）
+ 绿框（按 frameStyle 两种画法）+ 一个物体（cup_tumbler，转 -9°/偏 14px，故意不完美）。

依赖 scenes.json 的真实参数，不另抄一份；改场景请改 json 后重跑本脚本。
"""
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SCENES = ROOT / "assets" / "config" / "scenes.json"
SHAPES = ROOT / "assets" / "config" / "shapes.json"

sys.path.insert(0, str(HERE))
import render_preview as rp          # 复用字体/放置/绘制，保证与局内预览同一套画法

W, H, S = 720, 1280, 2              # 设计尺寸 + 超采样倍数
OUT = {
    "night_station": HERE / "scene_night.png",
    "noon_window": HERE / "scene_noon.png",
    "minimal": HERE / "scene_minimal.png",
}
OUT_THUMBS = HERE / "scene_thumbs.png"


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lum(rgb):
    """§6.1 相对亮度 L（百分比）"""
    return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 * 100


def gradient(size, top, bottom, angle=180):
    """竖直线性渐变（angle=180 从上到下）。先在 1×H 上算再放大，省时且无 banding。"""
    w, h = size
    t, b = hex_rgb(top), hex_rgb(bottom)
    col = Image.new("RGB", (1, h))
    px = col.load()
    for y in range(h):
        k = y / max(1, h - 1)
        px[0, y] = (round(t[0] + (b[0] - t[0]) * k),
                    round(t[1] + (b[1] - t[1]) * k),
                    round(t[2] + (b[2] - t[2]) * k))
    return col.resize((w, h), Image.BILINEAR).convert("RGBA")


def soft(canvas, draw_fn, blur_px):
    """在一张透明层上画，再高斯模糊后叠回（软边靠模糊，不靠硬描边）。"""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer), layer)
    if blur_px > 0:
        layer = layer.filter(ImageFilter.GaussianBlur(blur_px))
    return Image.alpha_composite(canvas, layer)


def draw_layers(img, scene, rnd):
    for L in scene["layers"]:
        k = L["k"]
        a = L["alpha"]
        al = a if isinstance(a, (int, float)) else a
        col = hex_rgb(L["color"])

        if k == "cloud":
            n = L["n"]
            alphas = L["alpha"] if isinstance(L["alpha"], list) else [L["alpha"]] * n
            yps = L["yPct"] if isinstance(L["yPct"], list) else [L["yPct"]] * n

            def fn(d, layer, alphas=alphas, yps=yps, n=n, col=col):
                for i in range(n):
                    cx = W * (0.30 + 0.18 * i) * S
                    cy = H * yps[i] * S
                    rx = W * 0.42 * S * (1 + 0.12 * i)
                    ry = H * 0.085 * S * (1 - 0.12 * i)
                    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry],
                              fill=(col[0], col[1], col[2], round(255 * alphas[i])))
            img = soft(img, fn, L["blurPx"] * S)

        elif k == "carLight":
            def fn(d, layer):
                y = H * L["yPct"] * S
                x0 = W * (0.18 + 0.30 * 0.5) * S
                d.rounded_rectangle([x0, y - L["hPx"] * S / 2, x0 + L["wPx"] * S, y + L["hPx"] * S / 2],
                                    radius=L["hPx"] * S, fill=(col[0], col[1], col[2], round(255 * al)))
            img = soft(img, fn, L["blurPx"] * S)

        elif k == "star":
            pts = [(rnd.uniform(0.06, 0.94), rnd.uniform(0.05, 0.62)) for _ in range(L["n"])]
            def fn(d, layer, pts=pts):
                for (xp, yp) in pts:
                    r = L["rPx"] * S
                    cx, cy = W * xp * S, H * yp * S
                    d.ellipse([cx - r, cy - r, cx + r, cy + r],
                              fill=(col[0], col[1], col[2], round(255 * al)))
            img = soft(img, fn, 1 * S)

        elif k == "windowSpot":
            n = L["n"]
            def fn(d, layer, n=n):
                for i in range(n):
                    rx = L["rxPx"][i] * S
                    ry = L["ryPx"][i] * S
                    cx = W * (0.32 + 0.20 * i) * S
                    cy = H * L["yPct"][i] * S
                    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry],
                              fill=(col[0], col[1], col[2], round(255 * al)))
            img = soft(img, fn, L["blurPx"] * S)

        elif k == "curtain":
            x0 = W * L["edgePct"] * S
            def fn(d, layer):
                d.rectangle([0, 0, x0, H * S], fill=(col[0], col[1], col[2], round(255 * al)))
                d.rectangle([W * S - x0, 0, W * S, H * S], fill=(col[0], col[1], col[2], round(255 * al)))
            img = soft(img, fn, L["blurPx"] * S)

        elif k == "dust":
            pts = [(rnd.uniform(0.05, 0.95), rnd.uniform(0.10, 0.90)) for _ in range(L["n"])]
            def fn(d, layer, pts=pts):
                for (xp, yp) in pts:
                    r = L["rPx"] * S
                    cx, cy = W * xp * S, H * yp * S
                    d.ellipse([cx - r, cy - r, cx + r, cy + r],
                              fill=(col[0], col[1], col[2], round(255 * al)))
            img = soft(img, fn, 1 * S)
    return img


def draw_frame(img, shape, scene):
    """两种画法：暗底 glow（三层外发光）/ 亮底 shadow（深色外环 + 柔影）。"""
    size, cx, cy = 250, 360, 596
    poly, _ = rp.place(shape, size * S, cx * S, cy * S, 0)
    style = scene.get("frameStyle", "glow")

    if style == "glow":
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(layer)
        for w, a in ((26, 26), (18, 34), (10, 60)):
            gd.line(list(poly) + [poly[0]], fill=(43, 255, 176, a), width=w * S, joint="curve")
        layer = layer.filter(ImageFilter.GaussianBlur(9 * S))
        img = Image.alpha_composite(img, layer)
        d = ImageDraw.Draw(img)
        d.polygon(poly, fill=(43, 255, 176, 20))
    else:
        # 亮底渲染变体：细硬边 + 轻柔影（参数全部来自 scenes.json，别在这里硬编码）
        P = scene.get("frameStyleParams") or {}
        ring_w = float(P.get("ringWidthPx", 1.0))
        ring_a = float(P.get("ringAlpha", 0.50))
        ring_c = hex_rgb(P.get("ringColor", "#0E1626"))
        ring_blur = float(P.get("ringBlurPx", 0))
        sh_blur = float(P.get("shadowBlurPx", 10))
        sh_a = float(P.get("shadowAlpha", 0.10))
        sh_dy = float(P.get("shadowOffsetYPx", 2))
        fill_a = float(P.get("innerFillAlpha", 0.06))
        fill_c = hex_rgb(P.get("innerFillColor", "#0B1424"))

        # 1) 底部柔影（只往下偏移，不做四周发光）
        shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sd.line([(x, y + sh_dy * S) for x, y in poly] + [(poly[0][0], poly[0][1] + sh_dy * S)],
                fill=(*ring_c, round(255 * sh_a)), width=10 * S, joint="curve")
        shadow = shadow.filter(ImageFilter.GaussianBlur(sh_blur * S))
        img = Image.alpha_composite(img, shadow)

        d = ImageDraw.Draw(img)
        d.polygon(poly, fill=(*fill_c, round(255 * fill_a)))       # 内填充：深色，不是 mint 8%
        w = max(1, round(ring_w * S))
        if ring_blur > 0:
            layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
            ImageDraw.Draw(layer).line(list(poly) + [poly[0]], fill=(*ring_c, round(255 * ring_a)),
                                       width=w, joint="curve")
            img = Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(ring_blur * S)))
            d = ImageDraw.Draw(img)
        else:
            d.line(list(poly) + [poly[0]], fill=(*ring_c, round(255 * ring_a)), width=w, joint="curve")

    d = ImageDraw.Draw(img)
    d.line(list(poly) + [poly[0]], fill=(43, 255, 176, 255), width=6 * S, joint="curve")
    return img, poly


def annotate(img, scene, shape_lum, bg_lum):
    d = ImageDraw.Draw(img)
    x, y = 24 * S, 1100 * S
    lines = [
        f"{scene['id']} · {scene['name']}",
        f"frameStyle={scene.get('frameStyle', 'glow')} · 最坏叠加 +{scene.get('worstAddPct', 0):.1f}% (上限 18%)",
        f"绿框描边 L={shape_lum:.0f}% / 背景 L={bg_lum:.0f}%",
    ]
    for i, s in enumerate(lines):
        rp.text(d, (x, y + i * 22 * S), s, 13 * S, rp.TXT_DIM)
    return img


def render_one(scene, shape):
    rnd = random.Random(20261018)
    img = gradient((W * S, H * S), scene["bg"][0], scene["bg"][1], scene.get("gradAngleDeg", 180))
    img = draw_layers(img, scene, rnd)
    img, poly = draw_frame(img, shape, scene)

    # 物体：转 -9°/偏 14px（故意不完美），画在绿框之上（z 序：绿框 < 物体）
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    rp.draw_shape(layer, shape, 250 * S, (360 + 14) * S, (596 - 6) * S, -9.0,
                  fill_alpha=255, stroke_w=3 * S)
    img = Image.alpha_composite(img, layer)

    bg_lum = (lum(hex_rgb(scene["bg"][0])) + lum(hex_rgb(scene["bg"][1]))) / 2
    img = annotate(img, scene, lum((43, 255, 176)), bg_lum)
    return img.resize((W, H), Image.LANCZOS).convert("RGB")


def main():
    if not SCENES.exists() or not SHAPES.exists():
        print(f"FAIL|缺文件：{SCENES} / {SHAPES}")
        return 1
    sdata = json.loads(SCENES.read_text(encoding="utf-8"))
    shdata = json.loads(SHAPES.read_text(encoding="utf-8"))
    shapes = shdata["shapes"] if isinstance(shdata, dict) and "shapes" in shdata else shdata
    shape = next((s for s in shapes if s["id"] == "cup_tumbler"), shapes[0])

    order = ["night_station", "noon_window", "minimal"]
    by_id = {s["id"]: s for s in sdata["scenes"]}
    outs = []
    for sid in order:
        scene = by_id.get(sid)
        if scene is None:
            print(f"FAIL|scenes.json 里没有 {sid}")
            return 1
        im = render_one(scene, shape)
        im.save(OUT[sid])
        outs.append((sid, im))
        print(f"OK|{OUT[sid]}")

    # 240px 宽缩略并排（验收口径：缩略下背景不能抢绿框）——按真实 240px 出图，不放大
    tw, th = 240, round(H * 240 / W)
    pad, gap, label_h = 16, 16, 72
    sheet = Image.new("RGB", (pad * 2 + tw * 3 + gap * 2, label_h + th + 52), rp.BG)
    d = ImageDraw.Draw(sheet)
    rp.text(d, (pad, 20), "三场景 240px 缩略：背景会不会抢主体", 30, rp.TXT)
    for i, (sid, im) in enumerate(outs):
        t = im.resize((tw, th), Image.LANCZOS)
        x = pad + i * (tw + gap)
        sheet.paste(t, (x, label_h))
        d.rectangle([x, label_h, x + tw - 1, label_h + th - 1], outline=rp.LINE)
        rp.text(d, (x, label_h + th + 12), sid, 22, rp.TXT_DIM)
    sheet.save(OUT_THUMBS)
    print(f"OK|{OUT_THUMBS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
