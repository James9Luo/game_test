/**
 * tools/_geom_baseline.mjs —— 【A/B 基线】Optimize 前 Geometry.overlapAreaExact 的逐行 JS 快照
 *
 * 用途：geometry_test.mjs 用它和优化后的 assets/scripts/core/Geometry.ts 做逐位对照，
 *      证明「加了边对预筛 / 插入排序 / scratch 复用」之后结果**一位都没变**。
 * 纪律：本文件只读，不许随 Geometry.ts 一起改（否则对照就失去意义）。
 * 来源：2026-10-18 冻结版 Geometry.ts（扫描线 + 梯形法，O(S·V log V)）。
 */

function segCrossY(a, b, c, d) {
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return [];
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return [];
    return [a.y + t * ry];
}

function crossingsAt(pts, y) {
    const xs = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
            xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
    }
    xs.sort((m, n2) => m - n2);
    return xs;
}

function sectionOverlap(P, Q, y) {
    const xp = crossingsAt(P, y);
    const xq = crossingsAt(Q, y);
    if (xp.length < 2 || xq.length < 2) return 0;
    let s = 0;
    for (let i = 0; i + 1 < xp.length; i += 2) {
        for (let j = 0; j + 1 < xq.length; j += 2) {
            const lo = Math.max(xp[i], xq[j]);
            const hi = Math.min(xp[i + 1], xq[j + 1]);
            if (hi > lo) s += hi - lo;
        }
    }
    return s;
}

export function overlapAreaExactBaseline(P, Q) {
    if (P.length < 3 || Q.length < 3) return 0;
    const ys = [];
    for (const p of P) ys.push(p.y);
    for (const q of Q) ys.push(q.y);
    for (let i = 0; i < P.length; i++) {
        const a = P[i];
        const b = P[(i + 1) % P.length];
        for (let j = 0; j < Q.length; j++) {
            const c = Q[j];
            const d = Q[(j + 1) % Q.length];
            const got = segCrossY(a, b, c, d);
            for (const y of got) ys.push(y);
        }
    }
    ys.sort((m, n) => m - n);

    const slabs = [];
    for (const y of ys) {
        if (slabs.length === 0 || y - slabs[slabs.length - 1] > 1e-9) slabs.push(y);
    }
    if (slabs.length < 2) return 0;

    let area = 0;
    for (let i = 0; i + 1 < slabs.length; i++) {
        const y0 = slabs[i];
        const y1 = slabs[i + 1];
        const h = y1 - y0;
        if (h < 1e-9) continue;
        const eps = Math.min(1e-7, h * 1e-3);
        const s0 = sectionOverlap(P, Q, y0 + eps);
        const s1 = sectionOverlap(P, Q, y1 - eps);
        area += ((s0 + s1) * 0.5) * h;
    }
    return area;
}

/** 基线版重合率（口径与 Geometry.overlapPercent 相同，用于整条链路对照） */
export function overlapPercentBaseline(objectPts, targetPts) {
    const areaOf = (pts) => {
        let s = 0;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            s += a.x * b.y - b.x * a.y;
        }
        return Math.abs(s) * 0.5;
    };
    const ao = areaOf(objectPts);
    const at = areaOf(targetPts);
    const denom = Math.max(ao, at);
    if (denom <= 1e-9) return 0;
    const p = (overlapAreaExactBaseline(objectPts, targetPts) / denom) * 100;
    return p < 0 ? 0 : p > 100 ? 100 : p;
}
