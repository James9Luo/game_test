# -*- coding: utf-8 -*-
"""build_prop_backup.py —— 一条命令：造型 → 归一化 → 自检 → 出图 → 出口径

用法（仓库根目录）：
    python 03_交付素材/build_prop_backup.py                 # 全量：12 件备份集 + 2 件风格样张
    python 03_交付素材/build_prop_backup.py --only cup_tumbler,car_hatch   # 只跑几件（调形用）
    python 03_交付素材/build_prop_backup.py --sheet-only    # 只重出预览图

输出：
    02_美术源文件/shapes_src/v10_backup_shapes.json   备份集数据（旧 shapes.json 一个字节不动）
    03_交付素材/shapes_v10_preview.png                新 vs 旧 对照接触表
    03_交付素材/shapes_v10_ingame.png                 局内同姿态对照（新/旧 各一张，看绿框还压不压得住）
    stdout 报告（逐件自检 + 需要主策划 tool 复测的项）
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from PIL import Image, ImageDraw  # noqa: E402

from propkit_v10 import colors as C  # noqa: E402
from propkit_v10 import defs as D  # noqa: E402
from propkit_v10 import export as EX  # noqa: E402
from propkit_v10 import render as R  # noqa: E402

OUT_JSON = ROOT / "02_美术源文件" / "shapes_src" / "v10_backup_shapes.json"
OUT_SHEET = HERE / "shapes_v10_preview.png"
OUT_GAME = HERE / "shapes_v10_ingame.png"

PAGE = [  # 备份集 12 件（= 一页图鉴 4×3；也是前 10 关 + 图鉴第一批最常看见的那批）
    "cup_tumbler", "car_hatch", "can_cola", "slipper",
    "guitar", "wrench", "rocket", "toilet",
    "cat", "tv", "burger", "duck",
]
SAMPLES = ["hot_balloon", "songbird"]


def build_all(only=None):
    shapes, reports = [], []
    for key, fn in D.ALL.items():
        if only and key not in only:
            continue
        sh, rep = EX.build(fn())
        shapes.append(sh)
        reports.append(rep)
    return shapes, reports


def old_shapes():
    p = ROOT / "assets" / "config" / "shapes.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    arr = data["shapes"] if isinstance(data, dict) else data
    return {s["id"]: s for s in arr}


# ---------------------------------------------------------------- 对照接触表
K_CAL = 0.486   # 自算/探针 k → 主策划口径 k 的换算（check_shapes.py 用 36 件实测校准，中位比值 0.486）


def contact_sheet(shapes, olds, out):
    cols, margin, gap = 4, 24, 14
    cell_w, cell_h = 344, 372
    n = len(shapes)
    rows = max(1, (n + cols - 1) // cols)
    W = margin * 2 + cols * cell_w + (cols - 1) * gap
    head = 96
    strip_h = 150
    H = head + rows * cell_h + (rows - 1) * gap + strip_h + 64
    img = Image.new("RGBA", (W, H), "#0E1626")
    d = ImageDraw.Draw(img)
    for x in range(0, W, 60):
        d.line([(x, 0), (x, H)], fill="#101B2C")
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill="#101B2C")

    R.text(d, (margin, 18), "《定格瞬间》道具备份集 v1.0 · 分层平涂重绘", 26, "#E8F1FF", bold=True)
    R.text(d, (margin, 54),
           "旧 36 件零改动（assets/config/shapes.json 不碰）· 本集 = 02_美术源文件/shapes_src/v10_backup_shapes.json"
           "· 轮廓仍走判定口径（顶点 ≤48 / 不自交 / k 用 tools/k_probe.mjs 实测）", 13, "#8FA3C0")
    R.text(d, (W - margin, 22), f"{n} 件", 16, "#8FA3C0", anchor="ra")

    for i, sh in enumerate(shapes):
        cx0 = margin + (i % cols) * (cell_w + gap)
        cy0 = head + (i // cols) * (cell_h + gap)
        d.rounded_rectangle([cx0, cy0, cx0 + cell_w, cy0 + cell_h], radius=10,
                            fill="#14203A", outline="#22314E")
        img2 = R.render_shape(sh, 168)
        img.alpha_composite(img2, (int(cx0 + cell_w / 2 - img2.width / 2), int(cy0 + 8)))
        d = ImageDraw.Draw(img)

        old = olds.get(sh.get("srcId") or sh["id"])
        if old:
            oimg = R.render_shape(old, 48)
            img.alpha_composite(oimg, (int(cx0 + 12), int(cy0 + 12)))
            d = ImageDraw.Draw(img)
            R.text(d, (cx0 + 12, cy0 + 62), "旧", 10, "#5C6B84")

        m = sh.get("_m") or {}
        R.text(d, (cx0 + cell_w / 2, cy0 + 232), sh["name"], 19, "#E8F1FF", anchor="ma", bold=True)
        R.text(d, (cx0 + cell_w / 2, cy0 + 256), f"#{i+1} {sh['id']}", 11, "#8FA3C0", anchor="ma")
        R.text(d, (cx0 + cell_w / 2, cy0 + 274),
               f"{m.get('verts','?')}顶点 · {m.get('aspect','?')}:1 · rot30 {m.get('rot30','?')}%",
               11, "#8FA3C0", anchor="ma")
        k = m.get("k")
        if isinstance(k, (int, float)):
            ok = 0.020 <= k <= 0.047 or m.get("accepted")
            kk = f"k {k:.4f} · " + ("接受（越界已记录）" if m.get("accepted") else ("在区间内 ✅" if ok else "越界 ❌"))
            col = "#FFC44D" if m.get("accepted") else ("#2BFFB0" if ok else "#FF5A5A")
        else:
            kk, col = "k 待实测", "#FFC44D"
        R.text(d, (cx0 + cell_w / 2, cy0 + 294), kk, 11, col, anchor="ma")
        R.text(d, (cx0 + cell_w / 2, cy0 + 314), sh.get("band", ""), 11, "#5C6B84", anchor="ma")

    # ---- 96px 灰度剪影条（V4：缩到图鉴小格还认不认得）
    y0 = head + rows * cell_h + (rows - 1) * gap + 24
    d.line([(margin, y0 - 12), (W - margin, y0 - 12)], fill="#22314E")
    R.text(d, (margin, y0), "96px 灰度剪影（V4 可辨识门槛：4/5 人能叫出名字才算过）", 13, "#8FA3C0")
    step = (W - margin * 2) / n
    for i, sh in enumerate(shapes):
        g = R.render_shape(sh, 84).convert("LA").convert("RGBA")
        g = Image.merge("RGB", (g.split()[0],) * 3).convert("RGBA")
        g.putalpha(R.render_shape(sh, 84).split()[3])
        img.alpha_composite(g, (int(margin + i * step + step / 2 - g.width / 2), int(y0 + 24)))
    d = ImageDraw.Draw(img)

    R.text(d, (margin, H - 40),
           "看三件事：① 缩小到 96px 还认得出来吗（V4）② 亮部有没有比绿框更亮（V3）③ 结构线是不是都内缩在轮廓里（V5）",
           12, "#5C6B84")
    img.convert("RGB").save(out)
    return out


def main():
    argv = sys.argv[1:]
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    shapes, reports = build_all(only)
    olds = old_shapes()

    # k 由 tools/k_probe.mjs 实测（2 圈 / 2600ms / passRate 0.6，与 check_shapes 同口径），
    # 再乘 K_CAL 换到主策划口径（check_shapes 用 36 件旧形状校准的中位比值）
    kfile = HERE / "_k_probe.json"
    kmap = {}
    if kfile.exists():
        kmap = json.loads(kfile.read_text(encoding="utf-8"))
    ACCEPTED = {"burger_v10": "0.0584：咬痕已加深到 x=27，再削就不像汉堡；本件只进图鉴/助眠池，不进 60 关（同 D-022 口径）"}

    print("# 逐件自检")
    print("id|verts|aspect|fill|cent|rot30|k_raw|k_cal|selfX|snapped|fails")
    fails = 0
    for sh, rep in zip(shapes, reports):
        kraw = (kmap.get(sh["id"]) or {}).get("k")
        kcal = round(kraw * K_CAL, 4) if kraw is not None else None
        sh["_m"] = {"verts": rep["verts"], "aspect": rep["aspect"], "rot30": rep["rot30"], "k": kcal,
                    "accepted": sh["id"] in ACCEPTED}
        if kcal is not None:
            if not (0.020 <= kcal <= 0.047):
                if sh["id"] in ACCEPTED:
                    rep.setdefault("notes", []).append(f"k {kcal} 越界已接受：{ACCEPTED[sh['id']]}")
                else:
                    rep["fails"].append(f"k {kcal:.4f} 越界 [0.020,0.047]")
        print("|".join([sh["id"], str(rep["verts"]), str(rep["aspect"]), str(rep["fill"]),
                        str(rep["cent"]), str(rep["rot30"]),
                        f"{kraw:.4f}" if kraw is not None else "待测",
                        f"{kcal:.4f}" if kcal is not None else "待测",
                        str(rep["selfX"]), str(rep["snapped"])] + (["; ".join(rep["fails"])] if rep["fails"] else [])))
        fails += 1 if rep["fails"] else 0
    print(f"SUMMARY|shapes={len(shapes)}|fail={fails}")

    if "--sheet-only" not in argv:
        EX.write(OUT_JSON, shapes, note=(
            "v1.0 道具备份集（2026-10-20，用户反馈「形状不像真实物品、不美观」）。"
            "旧道具零改动：assets/config/shapes.json 的 36 件一个字节不动，本文件独立存在，后缀 _v10。"
            "字段与 shapes.json 完全一致（id/name/fill/stroke/size/pts/details），可直接用 check_shapes.py --merge --add 并入；"
            "额外字段 srcId（对应旧 id）/band（难度档）/kind（器物|动物|样张）/note（设计意图）只供管线读取，不影响加载。"),
            extra={"source": "03_交付素材/build_prop_backup.py", "page": PAGE, "samples": SAMPLES})
        print(f"OK|{OUT_JSON}")

    p1 = contact_sheet(shapes, olds, OUT_SHEET)
    print(f"OK|{p1}")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
