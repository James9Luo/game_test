# -*- coding: utf-8 -*-
"""
render_preview.py —— 《定格瞬间》轮廓预览图（一条命令出两张图）

用法（在仓库根目录）：
    python 03_交付素材/render_preview.py

输出（写死，直接放进汇报）：
    03_交付素材/shapes_preview.png   15 格接触表：轮廓 + 名称 + 顶点数 + 长宽比 + rot30
    03_交付素材/ingame_preview.png   720×1280 局内构图：绿框固定 (360,596)/size 250，
                                    物体冻结在「转 +12°、位移 +30px」，标出重合/偏差区域与暂停按钮

依赖：Pillow。中文字体 C:\\Windows\\Fonts\\msyh.ttc → simhei.ttf → 英文名兜底。
判定数字（重合率）与 Geometry.ts 同口径：交集 / 两者较大面积 × 100，像素级 0.1% 精度。
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SHAPES = ROOT / "assets" / "config" / "shapes.json"
OUT_SHEET = HERE / "shapes_preview.png"
OUT_GAME = HERE / "ingame_preview.png"

sys.path.insert(0, str(HERE))
try:                                    # 复用自检脚本里的几何（同一份口径）
    import check_shapes as cs
except Exception:                       # 极端情况下退化为纯渲染
    cs = None

# ---------------------------------------------------------------- 调色板（与 02_美术源文件/风格圣经.md 一致）
BG = "#0E1626"
BG_PANEL = "#14203A"
LINE = "#22314E"
GREEN = "#2BFFB0"
G_FILL = (43, 255, 176, 20)      # 绿框内填充 8%
G_STROKE = (43, 255, 176, 255)
OBJ_ALPHA = 150
HIT = (43, 255, 176, 150)        # 重合
MISS = (255, 90, 90, 130)        # 偏差
TXT = "#E8F1FF"
TXT_DIM = "#8FA3C0"
RED = "#FF5A5A"
AMBER = "#FFC44D"

FONTS = [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\simsun.ttc"]
FONTS_BOLD = [r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\simhei.ttf"]
FONT_NOTE = "msyh.ttc"


def font(size, bold=False):
    global FONT_NOTE
    for p in (FONTS_BOLD if bold else []) + FONTS:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    FONT_NOTE = "Pillow 默认字体（无中文）"
    try:
        return ImageFont.load_default(size)
    except Exception:
        return ImageFont.load_default()


# ---------------------------------------------------------------- 几何工具
def pts_of(sh):
    return [(float(p["x"]), float(p["y"])) for p in sh["pts"]]


def long_edge(sh):
    pts = pts_of(sh)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return max(max(xs) - min(xs), max(ys) - min(ys))


def place(sh, long_px, cx, cy, rot=0.0):
    """把归一化轮廓放到屏幕：长边 → long_px 像素，绕自身中心旋转 rot，再平移到 (cx,cy)。"""
    import math
    pts = pts_of(sh)
    f = long_px / long_edge(sh)
    r = math.radians(rot)
    co, si = math.cos(r), math.sin(r)
    out = []
    for x, y in pts:
        px, py = x * f, y * f
        out.append((cx + px * co - py * si, cy + px * si + py * co))
    return out, f


def detail_place(d, f, cx, cy, rot):
    import math
    r = math.radians(rot)
    co, si = math.cos(r), math.sin(r)

    def tp(x, y):
        px, py = x * f, y * f
        return (cx + px * co - py * si, cy + px * si + py * co)

    if d["k"] in ("line", "poly"):
        return [tp(p["x"], p["y"]) for p in d["pts"]]
    return tp(d["c"]["x"], d["c"]["y"])


def draw_shape(layer, sh, long_px, cx, cy, rot=0.0, fill_alpha=255, stroke_w=3,
               stroke=None, details=True, fill=None):
    d = ImageDraw.Draw(layer)
    poly, f = place(sh, long_px, cx, cy, rot)
    wscale = long_px / float(sh["size"])   # details 的线宽按「画多大 / 设计多大」等比缩放
    if fill_alpha > 0:
        base = fill or sh["fill"]
        rgb = base if isinstance(base, tuple) else tuple(int(base[i:i + 2], 16) for i in (1, 3, 5))
        d.polygon(poly, fill=(rgb[0], rgb[1], rgb[2], fill_alpha))
    if details:
        for det in sh.get("details") or []:
            col = det["color"] if isinstance(det["color"], tuple) else \
                tuple(int(det["color"][i:i + 2], 16) for i in (1, 3, 5))
            col = (col[0], col[1], col[2], fill_alpha if det["k"] != "circle" or not det.get("filled") else 255)
            if det["k"] == "line":
                pts = detail_place(det, f, cx, cy, rot)
                d.line(pts, fill=col, width=max(1, int(round(det["w"] * wscale))), joint="curve")
            elif det["k"] == "poly":
                d.polygon(detail_place(det, f, cx, cy, rot), fill=col)
            elif det["k"] == "circle":
                c = detail_place(det, f, cx, cy, rot)
                rr = det["r"] * f
                box = [c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr]
                d.ellipse(box, fill=col if det.get("filled") else None, outline=None if det.get("filled") else col,
                          width=2)
    if stroke_w > 0:
        scol = stroke or sh["stroke"]
        rgb = scol if isinstance(scol, tuple) else tuple(int(scol[i:i + 2], 16) for i in (1, 3, 5))
        d.line(list(poly) + [poly[0]], fill=(rgb[0], rgb[1], rgb[2], 255), width=stroke_w, joint="curve")
    return poly


def mask_of(size, poly):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).polygon(poly, fill=255)
    return m


def mask_area(m):
    return sum(i * c for i, c in enumerate(m.histogram())) / 255.0


def overlap_stats(size, poly_o, poly_t):
    mo, mt = mask_of(size, poly_o), mask_of(size, poly_t)
    from PIL import ImageChops
    inter = ImageChops.darker(mo, mt)
    only_o = ImageChops.subtract(mo, mt)
    only_t = ImageChops.subtract(mt, mo)
    ao, at, ai = mask_area(mo), mask_area(mt), mask_area(inter)
    pct = 0.0 if max(ao, at) <= 0 else ai / max(ao, at) * 100.0
    return pct, inter, only_o, only_t


def tint(base_size, mask, color, alpha=255):
    layer = Image.new("RGBA", base_size, (color[0], color[1], color[2], 0))
    a = mask.point(lambda v: v * alpha // 255)
    layer.putalpha(a)
    return layer


def text(d, xy, s, size, color=TXT, anchor="la", bold=False):
    f = font(size, bold)
    d.text(xy, s, font=f, fill=color, anchor=anchor)


# ---------------------------------------------------------------- 图一：接触表
def render_sheet(shapes):
    S = 2
    cols = 5
    n = len(shapes)
    rows = (n + cols - 1) // cols          # v0.2 起形状 23 个：行数按数量算，别写死 3 行
    mx, my, gap = 24, 96, 14
    cell_h = 298
    W = 1440
    H = my + rows * cell_h + (rows - 1) * gap + 70
    img = Image.new("RGBA", (W * S, H * S), BG)
    d = ImageDraw.Draw(img)

    # 背景网格
    for x in range(0, W, 60):
        d.line([(x * S, 0), (x * S, H * S)], fill=(20, 32, 58, 255), width=1)
    for y in range(0, H, 60):
        d.line([(0, y * S), (W * S, y * S)], fill=(20, 32, 58, 255), width=1)

    text(d, (24 * S, 18 * S), "《定格瞬间》可判定轮廓接触表", 30 * S, TXT, bold=True)
    text(d, (24 * S, 58 * S), "轮廓即数据：判定与绘制共用同一份多边形（assets/config/shapes.json）· 长边像素见各格 · 绿框与物体同形，完美重合 = 100%", 15 * S, TXT_DIM)
    text(d, (W * S - 24 * S, 18 * S), f"{n} shapes / 720×1280 设计分辨率", 16 * S, TXT_DIM, anchor="ra")

    cw = (W - 2 * mx - (cols - 1) * gap) / cols
    ch = cell_h

    for i, sh in enumerate(shapes):
        cx0 = mx + (i % cols) * (cw + gap)
        cy0 = my + (i // cols) * (ch + gap)
        d.rounded_rectangle([cx0 * S, cy0 * S, (cx0 + cw) * S, (cy0 + ch) * S], radius=10 * S,
                            fill=BG_PANEL, outline=LINE, width=1 * S)
        # 轮廓
        long_px = 168
        sx = (cx0 + cw / 2) * S
        sy = (cy0 + ch * 0.42) * S
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        draw_shape(layer, sh, long_px * S, sx, sy, 0, fill_alpha=235, stroke_w=3 * S)
        img = Image.alpha_composite(img, layer)
        d = ImageDraw.Draw(img)

        pts = pts_of(sh)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        aspect = max(w, h) / min(w, h)
        fill = 0.0
        if cs:
            fill = cs.poly_area(pts) / (w * h)
        rot30 = None
        if cs:
            up = cs.normalized(pts)
            rot30 = cs.overlap_percent(up, cs.rotate(up, 30), cs.poly_area(up))
        grade = ""
        if rot30 is not None:
            grade = "严苛" if rot30 < 58 else ("中等" if rot30 < 74 else "宽容")

        text(d, ((cx0 + cw / 2) * S, (cy0 + ch - 66) * S), f"{sh['name']}", 20 * S, TXT, anchor="ma", bold=True)
        text(d, ((cx0 + cw / 2) * S, (cy0 + ch - 44) * S), f"#{i + 1} {sh['id']}", 12 * S, TXT_DIM, anchor="ma")
        meta = f"{len(pts)}顶点 · {aspect:.2f}:1 · size{int(sh['size'])}"
        text(d, ((cx0 + cw / 2) * S, (cy0 + ch - 24) * S), meta, 12 * S, TXT_DIM, anchor="ma")
        if rot30 is not None:
            col = RED if rot30 >= 74 else (AMBER if rot30 >= 58 else GREEN)
            text(d, ((cx0 + cw / 2) * S, (cy0 + 10) * S), f"rot30 {rot30:.0f}% · {grade}",
                 12 * S, col, anchor="ma")

    # 页脚
    text(d, (24 * S, (H - 42) * S),
         "难度看 rot30（转 30° 后重合率）：≥74% 宽容 / 58–74% 中等 / <58% 严苛。绿框色 #2BFFB0，物体色见各格 fill。",
         13 * S, TXT_DIM)
    img = img.resize((W, H), Image.LANCZOS).convert("RGB")
    img.save(OUT_SHEET)
    return OUT_SHEET


# ---------------------------------------------------------------- 图二：局内构图
def render_ingame(shapes):
    S = 2
    W, H = 720, 1280
    img = Image.new("RGBA", (W * S, H * S), BG)
    d = ImageDraw.Draw(img)

    # 背景：轻微径向暗角 + 可玩区参考线
    vig = Image.new("L", (W * S, H * S), 0)
    dv = ImageDraw.Draw(vig)
    dv.ellipse([-W * 0.35 * S, -H * 0.10 * S, W * 1.35 * S, H * 1.05 * S], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(60 * S))
    img = Image.composite(img, Image.new("RGBA", img.size, (8, 12, 22, 255)), vig)
    d = ImageDraw.Draw(img)

    # 可玩区（PLAY.top 176 → PLAY.bottom 1010）
    dash = 10
    y0, y1 = 176, 1010
    for x in range(24, 696, dash * 2):
        d.line([(x * S, y0 * S), ((x + dash) * S, y0 * S)], fill=(34, 49, 78, 255), width=2)
        d.line([(x * S, y1 * S), ((x + dash) * S, y1 * S)], fill=(34, 49, 78, 255), width=2)

    # ---------- HUD
    text(d, (36 * S, 56 * S), "第 4 关 · 翻滚的车", 26 * S, TXT, bold=True)
    text(d, (36 * S, 92 * S), "物体：小汽车 · 轮廓 car_hatch", 15 * S, TXT_DIM)
    text(d, (684 * S, 56 * S), "★ ★ ★", 22 * S, "#FFC44D", anchor="ra")
    text(d, (684 * S, 92 * S), "得分 1240 · 连击 ×1.4", 15 * S, TXT_DIM, anchor="ra")

    # ---------- 绿框（固定不动）
    target_shape = next(s for s in shapes if s["id"] == "car_hatch")
    T_SIZE, T_CX, T_CY = 250, 360, 596
    tgt_poly, _ = place(target_shape, T_SIZE * S, T_CX * S, T_CY * S, 0)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for w, a in ((26, 26), (18, 34), (10, 60)):
        gd.line(list(tgt_poly) + [tgt_poly[0]], fill=(43, 255, 176, a), width=w * S, joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(9 * S))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)
    d.polygon(tgt_poly, fill=G_FILL)
    d.line(list(tgt_poly) + [tgt_poly[0]], fill=G_STROKE, width=6 * S, joint="curve")

    # ---------- 物体：冻结在「转 +12°、位移 +30px」
    ROT, DX, DY = 12.0, 30, 0
    obj_poly, _ = place(target_shape, T_SIZE * S, (T_CX + DX) * S, (T_CY + DY) * S, ROT)
    pct, inter, only_o, only_t = overlap_stats((W * S, H * S), obj_poly, tgt_poly)
    img = Image.alpha_composite(img, tint(img.size, only_t, (232, 241, 255), 64))   # 空缺：中性灰 α0.25（v0.1.1）
    img = Image.alpha_composite(img, tint(img.size, only_o, (255, 90, 90), 153))    # 偏差：红 α0.60
    img = Image.alpha_composite(img, tint(img.size, inter, (43, 255, 176), 89))     # 重合：mint α0.35
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw_shape(layer, target_shape, T_SIZE * S, (T_CX + DX) * S, (T_CY + DY) * S, ROT,
               fill_alpha=70, stroke_w=4 * S, stroke=(232, 241, 255))
    img = Image.alpha_composite(img, layer)
    d = ImageDraw.Draw(img)

    # ---------- 标注：偏角/位移/重合率
    ann = f"物体：转 +{ROT:.0f}° · 位移 +{DX}px"
    text(d, (T_CX * S, 250 * S), ann, 17 * S, TXT_DIM, anchor="ma")
    d.line([(T_CX * S, 268 * S), (T_CX * S, 292 * S)], fill=(60, 80, 116, 255), width=2)
    # 参考线：绿框中心 → 物体中心
    d.line([(T_CX * S, T_CY * S), ((T_CX + DX) * S, (T_CY + DY) * S)], fill=(255, 196, 77, 200), width=2)
    d.ellipse([T_CX * S - 4, T_CY * S - 4, T_CX * S + 4, T_CY * S + 4], fill=(43, 255, 176, 255))

    rating = "神级" if pct >= 95 else ("完美" if pct >= 88 else ("不错" if pct >= 72 else ("及格" if pct >= 60 else "差得远")))
    col = GREEN if pct >= 88 else (AMBER if pct >= 72 else RED)
    text(d, (T_CX * S, 778 * S), f"重合 {pct:.1f}%  →  {rating}", 26 * S, col, anchor="ma")
    text(d, (T_CX * S, 814 * S), "热力图（v0.1.1）：绿=重合 / 红=物体溢出 / 灰=绿框空着", 14 * S, TXT_DIM, anchor="ma")

    # ---------- 底部暂停按钮（PAUSE_BTN: 360,1122 r=106）
    bx, by, br = 360 * S, 1122 * S, 106 * S
    ring = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse([bx - br, by - br, bx + br, by + br],
                                 outline=(43, 255, 176, 70), width=10 * S)
    ring = ring.filter(ImageFilter.GaussianBlur(6 * S))
    img = Image.alpha_composite(img, ring)
    d = ImageDraw.Draw(img)
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=(245, 249, 255, 255))
    d.ellipse([bx - br, by - br, bx + br, by + br], outline=(27, 43, 69, 255), width=2 * S)
    bw, bh, gapw = 20 * S, 62 * S, 20 * S
    for sx in (-1, 1):
        x = bx + sx * (gapw / 2 + bw / 2)
        d.rounded_rectangle([x - bw / 2, by - bh / 2, x + bw / 2, by + bh / 2], radius=5 * S, fill=(16, 27, 46, 255))
    text(d, (bx, 1246 * S), "按早了 / 按晚了都会掉分", 14 * S, TXT_DIM, anchor="ma")

    # ---------- 图例（避开暂停按钮的圆形范围）
    lx, ly = 36, 962
    for i, (c, s) in enumerate(((GREEN, "重合"), (RED, "物体溢出"), ("#E8F1FF", "绿框空着"))):
        d.rounded_rectangle([(lx + i * 150) * S, ly * S, (lx + i * 150 + 16) * S, (ly + 16) * S],
                            radius=4 * S, fill=c)
        text(d, ((lx + i * 150 + 24) * S, (ly - 3) * S), s, 14 * S, TXT_DIM)

    text(d, (684 * S, 1020 * S), "720×1280 · 1x 构图检查", 13 * S, TXT_DIM, anchor="ra")

    img = img.resize((W, H), Image.LANCZOS).convert("RGB")
    img.save(OUT_GAME)
    return OUT_GAME, pct


def main():
    import json
    if not SHAPES.exists():
        print(f"FAIL|{SHAPES} 不存在")
        return 1
    data = json.loads(SHAPES.read_text(encoding="utf-8"))
    shapes = data["shapes"] if isinstance(data, dict) and "shapes" in data else data

    p1 = render_sheet(shapes)
    p2, pct = render_ingame(shapes)
    print(f"OK|{p1}")
    print(f"OK|{p2}")
    print(f"INFO|ingame: 转 +12° / 位移 +30px 时重合率 = {pct:.1f}%")
    print(f"INFO|font = {FONT_NOTE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
