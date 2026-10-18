/* ------------------------------------------------------------------
 * 原型/_src/mock_core.js —— 核心桩（仅当 PROTO_CORE_MODE === 'mock' 时被 build 打进单文件）
 *
 * 为什么存在：client-core 的 Judge / Paths / LevelStore / Score 尚未落地，
 *            本文件用「匀速直线 + 旋转」把全流程与视觉先跑通。
 * 约束：
 *   1) 函数签名严格对齐 assets/scripts/core/Types.ts 的 CoreApi；
 *   2) 不含任何 UI / 渲染逻辑；
 *   3) 真实现落地后，build 脚本切 PROTO_CORE_MODE='core'，本文件整段删除。
 * 待验证（需要主策划确认，写进《数值与判定表》后本桩同步）：
 *   - RATINGS 阈值 92 / 82 / 72 / 60 与 baseScore 1000 / 700 / 450 / 250 为暂定值；
 *   - onTime 判定窗口暂定 ±8ms（半帧），需与「按早了/按晚了」文案口径对齐。
 * ------------------------------------------------------------------ */

/** 确定性随机：同一 seed 逐帧可复现（录屏/回归的前提） */
function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 评级表 —— 待主策划确认后与 core/Score.ts 对齐 */
var RATINGS = [
    { id: 'god', minPercent: 92, baseScore: 1000, label: '神级定格' },
    { id: 'perfect', minPercent: 82, baseScore: 700, label: '完美' },
    { id: 'good', minPercent: 72, baseScore: 450, label: '不错' },
    { id: 'ok', minPercent: 60, baseScore: 250, label: '及格' },
    { id: 'fail', minPercent: 0, baseScore: 0, label: '差得有点远' }
];

function ratingOf(pct) {
    for (var i = 0; i < RATINGS.length; i++) {
        if (pct >= RATINGS[i].minPercent) return RATINGS[i];
    }
    return RATINGS[RATINGS.length - 1];
}

/* ---------------- 数据装载（与 core 同签名，兼容数组 / 字典两种 json 形态） ---------------- */

function loadShapes(json) {
    var src = json && json.shapes ? json.shapes : json || {};
    var out = {};
    var i;
    if (Object.prototype.toString.call(src) === '[object Array]') {
        for (i = 0; i < src.length; i++) if (src[i] && src[i].id) out[src[i].id] = src[i];
    } else {
        for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    }
    return out;
}

function loadLevels(json) {
    var src = json && json.levels ? json.levels : json || [];
    return Object.prototype.toString.call(src) === '[object Array]' ? src : [];
}

/* ---------------- 轨迹：几何模板（与 PathId 一一对应） ---------------- */

function sampleLineInto(out, a, b, n) {
    for (var i = 0; i <= n; i++) {
        var t = i / n;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
}

function sampleQuadInto(out, p0, p1, p2, n) {
    for (var i = 0; i <= n; i++) {
        var t = i / n;
        var mt = 1 - t;
        out.push({
            x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
            y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
        });
    }
}

/**
 * 轨迹折线（世界坐标）。dir = -1 时整体绕目标中心镜像 x（双物体第二车道）。
 * 约定：所有轨迹都保证「存在一点恰好落在目标中心」，uStar 由弧长最近点求得。
 */
function buildPathPolyline(pathId, c, dir) {
    var x = c.cx;
    var y = c.cy;
    var pts = [];
    var mx = dir === -1 ? function (px) { return 2 * x - px; } : function (px) { return px; };
    var floor = PLAY.bottom - 36;

    switch (pathId) {
        case 'h_line_rl':
            sampleLineInto(pts, { x: mx(x + 540), y: y }, { x: mx(x - 540), y: y }, 40);
            break;
        case 'diag_dl':
            sampleLineInto(pts, { x: mx(x - 360), y: y - 220 }, { x: mx(x + 360), y: y + 220 }, 40);
            break;
        case 'diag_ur':
            sampleLineInto(pts, { x: mx(x - 360), y: y + 220 }, { x: mx(x + 360), y: y - 220 }, 40);
            break;
        case 'arc_up':
            sampleQuadInto(pts, { x: mx(x - 360), y: y + 320 }, { x: mx(x), y: y - 320 }, { x: mx(x + 360), y: y + 320 }, 48);
            break;
        case 'arc_down':
            sampleQuadInto(pts, { x: mx(x - 360), y: y - 320 }, { x: mx(x), y: y + 320 }, { x: mx(x + 360), y: y - 320 }, 48);
            break;
        case 'bounce_floor':
            /* 左上落下 → 触地反弹 → 恰好上穿目标中心 → 右上飞出 */
            sampleLineInto(pts, { x: mx(x - 470), y: y - 520 }, { x: mx(x - 250), y: floor }, 16);
            pts.pop();
            sampleLineInto(pts, { x: mx(x - 250), y: floor }, { x: mx(x), y: y }, 16);
            pts.pop();
            sampleLineInto(pts, { x: mx(x), y: y }, { x: mx(x + 470), y: PLAY.top - 90 }, 16);
            break;
        case 'h_line':
        default:
            sampleLineInto(pts, { x: mx(x - 540), y: y }, { x: mx(x + 540), y: y }, 40);
            break;
    }
    return pts;
}

function pathCumulative(pts) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
        var dx = pts[i].x - pts[i - 1].x;
        var dy = pts[i].y - pts[i - 1].y;
        cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    return cum;
}

/** 按弧长参数 u（0–1）取轨迹点 */
function pointAtPathU(pts, cum, total, u) {
    var target = (u < 0 ? 0 : u > 1 ? 1 : u) * total;
    var lo = 0;
    var hi = cum.length - 1;
    while (lo < hi - 1) {
        var mid = (lo + hi) >> 1;
        if (cum[mid] <= target) lo = mid;
        else hi = mid;
    }
    var seg = cum[hi] - cum[lo] || 1;
    var k = (target - cum[lo]) / seg;
    return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * k, y: pts[lo].y + (pts[hi].y - pts[lo].y) * k };
}

/** 完美时机对应的 u：轨迹上离目标中心最近的点（细化到 1/200 段，避免 ms 级误差） */
function findUStar(pts, cum, total, c) {
    var bestI = 0;
    var bestD = Infinity;
    var i;
    for (i = 0; i < pts.length; i++) {
        var dx = pts[i].x - c.cx;
        var dy = pts[i].y - c.cy;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestI = i; }
    }
    var lo = bestI > 0 ? bestI - 1 : 0;
    var hi = bestI < pts.length - 1 ? bestI + 1 : pts.length - 1;
    var bestU = cum[bestI] / total;
    for (var s = 0; s <= 200; s++) {
        var u = (cum[lo] + (cum[hi] - cum[lo]) * (s / 200)) / total;
        var p = pointAtPathU(pts, cum, total, u);
        var ex = p.x - c.cx;
        var ey = p.y - c.cy;
        if (ex * ex + ey * ey < bestD) { bestD = ex * ex + ey * ey; bestU = u; }
    }
    return bestU;
}

/* ---------------- 两段变速（speedStage）：切换点固定 u = 0.4，确定性、可练可背 ---------------- */

var STAGE_CUT = 0.4;

function stageSpeeds(stage) {
    var s = stage && stage > 0 ? stage : 1;
    return { v1: s, v2: 1 / s };
}

function uToTraw(u, stage) {
    var v = stageSpeeds(stage);
    if (u <= STAGE_CUT) return u / v.v1;
    return STAGE_CUT / v.v1 + (u - STAGE_CUT) / v.v2;
}

function tOfU(u, stage, cycleMs) {
    return (cycleMs * uToTraw(u, stage)) / uToTraw(1, stage);
}

function uOfT(tMs, stage, cycleMs) {
    var cyc = cycleMs || 1;
    var tn = ((tMs % cyc) + cyc) % cyc;
    var rt = (tn / cyc) * uToTraw(1, stage);
    var v = stageSpeeds(stage);
    var t1 = STAGE_CUT / v.v1;
    if (rt <= t1) return rt * v.v1;
    return STAGE_CUT + (rt - t1) * v.v2;
}

/* ---------------- 关卡构建 ---------------- */

function fallbackShape() {
    return {
        id: 'fallback',
        name: '占位',
        size: 160,
        fill: '#8FA3BF',
        stroke: '#EAF2FF',
        pts: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }]
    };
}

function makeMover(def, shapes, center, scale, dir, cycle, shapeId, outlineId) {
    var objectShapeId = shapeId || def.shapeId;
    var targetShapeId = outlineId || def.outlineId || objectShapeId;
    var shape = shapes[objectShapeId] || shapes[targetShapeId] || fallbackShape();
    var outline = shapes[targetShapeId] || shape;
    var pts = buildPathPolyline(def.path, center, dir);
    var cum = pathCumulative(pts);
    var total = cum[cum.length - 1] || 1;

    var mover = {
        shape: shape,
        targetPts: place(scaleLocal(outline.pts, outline.size * scale), center.cx, center.cy, 0),
        targetArea: 0,
        targetCenter: { x: center.cx, y: center.cy },
        targetRotDeg: 0,
        pathPts: pts,
        pathLen: total,
        uStar: 0.5,
        startRot: 0,
        turns: def.turns || 1,
        speedStage: def.speedStage || 1,
        cycleMs: cycle,
        dir: dir,
        /* 双物体车道缩放；单物体恒为 1（多出的字段仅原型使用，不影响 core 契约） */
        scale: scale,
        _cum: cum
    };
    mover.targetArea = polyArea(mover.targetPts);
    mover.uStar = findUStar(pts, cum, total, center);
    mover.startRot = normDeg(-(mover.turns * 360 * mover.uStar));
    return mover;
}

function buildLevel(def, shapes, seed) {
    var rnd = mulberry32((seed | 0) || 1);
    var jitter = def.jitter || 0;
    /* 随机只做速度微扰：周期抖动，路径不变 */
    var k = 1 + (rnd() * 2 - 1) * jitter;
    var cycle = Math.max(400, (def.cycleMs || 2000) / k);

    var movers = [];
    if (def.variant === 'dual') {
        movers.push(makeMover(def, shapes, { cx: TARGET_DUAL[0].cx, cy: TARGET_DUAL[0].cy }, TARGET_DUAL[0].scale, 1, cycle, def.shapeId, def.outlineId));
        movers.push(makeMover(def, shapes, { cx: TARGET_DUAL[1].cx, cy: TARGET_DUAL[1].cy }, TARGET_DUAL[1].scale, -1, cycle, def.shapeId2, def.outlineId2 || def.outlineId));
    } else {
        movers.push(makeMover(def, shapes, { cx: TARGET_SINGLE.cx, cy: TARGET_SINGLE.cy }, 1, 1, cycle, def.shapeId, def.outlineId));
    }

    var perfectMs = tOfU(movers[0].uStar, def.speedStage || 1, cycle);
    return { def: def, movers: movers, perfectMs: perfectMs };
}

/* ---------------- 姿态查询 ---------------- */

function uAt(mover, tMs) {
    return uOfT(tMs, mover.speedStage, mover.cycleMs);
}

function poseAt(mover, tMs) {
    var u = uAt(mover, tMs);
    var p = pointAtPathU(mover.pathPts, mover._cum, mover.pathLen, u);
    return { x: p.x, y: p.y, rotDeg: normDeg(mover.startRot + mover.turns * 360 * u) };
}

function objectPtsAt(mover, tMs) {
    var pose = poseAt(mover, tMs);
    return place(scaleLocal(mover.shape.pts, mover.shape.size * (mover.scale || 1)), pose.x, pose.y, pose.rotDeg);
}

/* ---------------- 判定（纯函数：输入变换快照 → 输出分数） ---------------- */

function judge(rt, pressMs, combo) {
    var def = rt.def;
    var objects = [];
    var sum = 0;
    var i;

    for (i = 0; i < rt.movers.length; i++) {
        var mv = rt.movers[i];
        var pose = poseAt(mv, pressMs);
        var objPts = place(scaleLocal(mv.shape.pts, mv.shape.size * (mv.scale || 1)), pose.x, pose.y, pose.rotDeg);
        var pct = overlapPercent(objPts, mv.targetPts, undefined, mv.targetArea);
        var centroid = polyCentroid(objPts);
        objects.push({
            shapeId: mv.shape.id,
            pct: pct,
            interArea: overlapAreaExact(objPts, mv.targetPts),
            targetArea: mv.targetArea,
            angleDev: normDeg(pose.rotDeg - mv.targetRotDeg),
            offsetPx: Math.sqrt(
                (centroid.x - mv.targetCenter.x) * (centroid.x - mv.targetCenter.x) +
                (centroid.y - mv.targetCenter.y) * (centroid.y - mv.targetCenter.y)
            ),
            pose: pose,
            objectPts: objPts,
            targetPts: mv.targetPts
        });
        sum += pct;
    }

    var pctAvg = sum / objects.length;
    var rule = ratingOf(pctAvg);
    var deltaMs = pressMs - rt.perfectMs;
    var verdict = Math.abs(deltaMs) <= 8 ? 'onTime' : deltaMs < 0 ? 'early' : 'late';
    var coef = 1 + Math.min(COMBO.max - 1, COMBO.step * (combo || 0));
    var score = Math.round(rule.baseScore * coef);

    return {
        pct: pctAvg,
        rating: rule.id,
        baseScore: rule.baseScore,
        score: score,
        pass: pctAvg >= (def.passRate || 0.6) * 100,
        star3: pctAvg >= (def.star3Rate || 0.93) * 100,
        timing: { deltaMs: deltaMs, verdict: verdict },
        objects: objects
    };
}
