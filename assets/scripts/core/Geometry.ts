/**
 * Geometry.ts —— 纯几何：面积 / 变换 / 轮廓相交面积
 *
 * 铁律：判定只认「轮廓重合面积」，不认中心点距离。
 * 本文件不引用任何引擎 API，可被 node 直接单测（见 tools/geometry_test.mjs）。
 *
 * 坐标约定：设计分辨率 720×1280，原点左上，y 向下（与 Canvas 一致）。
 */

export type Vec2 = { x: number; y: number };

export function v(x: number, y: number): Vec2 {
    return { x, y };
}

/** 鞋带公式，返回绝对面积 */
export function polyArea(pts: Vec2[]): number {
    let s = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) * 0.5;
}

/** 多边形形心（面积加权；退化时退化为顶点均值） */
export function polyCentroid(pts: Vec2[]): Vec2 {
    let a = 0;
    let cx = 0;
    let cy = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % n];
        const cross = p.x * q.y - q.x * p.y;
        a += cross;
        cx += (p.x + q.x) * cross;
        cy += (p.y + q.y) * cross;
    }
    if (Math.abs(a) < 1e-12) {
        let sx = 0;
        let sy = 0;
        for (const p of pts) {
            sx += p.x;
            sy += p.y;
        }
        return v(sx / n, sy / n);
    }
    return v(cx / (3 * a), cy / (3 * a));
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function polyBounds(pts: Vec2[]): Bounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

/** 绕 (cx,cy) 旋转 deg 度 */
export function rotateAbout(pts: Vec2[], cx: number, cy: number, deg: number): Vec2[] {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const out: Vec2[] = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].x - cx;
        const dy = pts[i].y - cy;
        out[i] = { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
    }
    return out;
}

/**
 * 把「以 (0,0) 为中心的局部轮廓」放到世界坐标。
 * @param local 归一化局部轮廓（已乘过 size）
 * @param cx 形心世界 x
 * @param cy 形心世界 y
 * @param rotDeg 逆时针为正（屏幕上顺时针）
 */
export function place(local: Vec2[], cx: number, cy: number, rotDeg: number): Vec2[] {
    return rotateAbout(local, 0, 0, rotDeg).map((p) => v(p.x + cx, p.y + cy));
}

/** 缩放局部轮廓并保持形心在原点 */
export function scaleLocal(pts: Vec2[], k: number): Vec2[] {
    return pts.map((p) => v(p.x * k, p.y * k));
}

/** 射线法判断点是否在多边形内（even-odd，允许凹多边形） */
export function pointInPoly(px: number, py: number, pts: Vec2[]): boolean {
    let inside = false;
    const n = pts.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = pts[i];
        const b = pts[j];
        if (a.y > py !== b.y > py) {
            const x = a.x + ((py - a.y) * (b.x - a.x)) / (b.y - a.y);
            if (px < x) inside = !inside;
        }
    }
    return inside;
}

/**
 * 扫描线临时缓冲 + 插入排序。
 * 优化（2026-10-18，主策划批准，仅内层常数优化，行为与结果逐位不变）：
 *  - 每次判定不再 new 数组（scoring 在按键那一帧调用，GC 要 0 B）；
 *  - 交叉点数量 ≤ V ≤ 48，插入排序比 Array.prototype.sort 快且零分配；
 *  - 结果与优化前**逐位相同**，用 tools/_geom_baseline.mjs 做 A/B 对照（见 tools/geometry_test.mjs [1b]）。
 */
const _npAsc = (a: number, b: number): number => a - b;

/** 升序插入排序（原地，零分配） */
function insertSort(arr: number[]): void {
    for (let i = 1; i < arr.length; i++) {
        const v = arr[i];
        let j = i - 1;
        while (j >= 0 && arr[j] > v) {
            arr[j + 1] = arr[j];
            j--;
        }
        arr[j + 1] = v;
    }
}

const _xp: number[] = [];
const _xq: number[] = [];

/** 扫描线：把 y 处的所有交点 x 写入 out（升序，偶数个），返回个数。out 由调用方复用。 */
function crossingsInto(pts: Vec2[], y: number, out: number[]): number {
    let n = 0;
    const len = pts.length;
    for (let i = 0; i < len; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % len];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
            out[n++] = a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
        }
    }
    out.length = n;
    insertSort(out);
    return n;
}

/** y 处两多边形横截面的交集长度（区间两两取交，因各自区间互不相交，不会重复计） */
function sectionOverlap(P: Vec2[], Q: Vec2[], y: number): number {
    const np = crossingsInto(P, y, _xp);
    const nq = crossingsInto(Q, y, _xq);
    if (np < 2 || nq < 2) return 0;
    let s = 0;
    for (let i = 0; i + 1 < np; i += 2) {
        for (let j = 0; j + 1 < nq; j += 2) {
            const lo = Math.max(_xp[i], _xq[j]);
            const hi = Math.min(_xp[i + 1], _xq[j + 1]);
            if (hi > lo) s += hi - lo;
        }
    }
    return s;
}

/** 两条线段的真交点（只取严格内部相交）的 y */
function segCrossY(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number[] {
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

/**
 * 两简单多边形（允许凹，不允许自交）的交集面积，**精确解**。
 *
 * 算法：按「所有顶点 y + 所有边-边交点 y」切水平层；层内横截面长度随 y
 * 线性变化（层内无端点交换顺序），故用梯形法即可得到解析面积。
 * 复杂度 O(S·V log V)，V≈24 时单次 < 0.1ms，满足「判定 ≤0.2ms」。
 *
 * 优化说明（2026-10-18）：只做常数优化（边对 y 区间预筛 + scratch 复用 + 插入排序），
 * **不改变精度、不改变算法**；结果与优化前逐位相同（tools/geometry_test.mjs [1b] 对照证明）。
 */
const _ys: number[] = [];
const _slabs: number[] = [];

export function overlapAreaExact(P: Vec2[], Q: Vec2[]): number {
    if (P.length < 3 || Q.length < 3) return 0;

    // 包围盒不相交 → 0（与逐层算出的 0 完全等价，只是省掉整轮扫描）
    let pMinX = Infinity;
    let pMaxX = -Infinity;
    let pMinY = Infinity;
    let pMaxY = -Infinity;
    for (const p of P) {
        if (p.x < pMinX) pMinX = p.x;
        if (p.x > pMaxX) pMaxX = p.x;
        if (p.y < pMinY) pMinY = p.y;
        if (p.y > pMaxY) pMaxY = p.y;
    }
    let qMinX = Infinity;
    let qMaxX = -Infinity;
    let qMinY = Infinity;
    let qMaxY = -Infinity;
    for (const q of Q) {
        if (q.x < qMinX) qMinX = q.x;
        if (q.x > qMaxX) qMaxX = q.x;
        if (q.y < qMinY) qMinY = q.y;
        if (q.y > qMaxY) qMaxY = q.y;
    }
    if (pMaxX <= qMinX || qMaxX <= pMinX || pMaxY <= qMinY || qMaxY <= pMinY) return 0;

    _ys.length = 0;
    for (const p of P) _ys.push(p.y);
    for (const q of Q) _ys.push(q.y);
    const pn = P.length;
    const qn = Q.length;
    for (let i = 0; i < pn; i++) {
        const a = P[i];
        const b = P[(i + 1) % pn];
        const aLo = a.y < b.y ? a.y : b.y;
        const aHi = a.y < b.y ? b.y : a.y;
        for (let j = 0; j < qn; j++) {
            const c = Q[j];
            const d = Q[(j + 1) % qn];
            const cLo = c.y < d.y ? c.y : d.y;
            const cHi = c.y < d.y ? d.y : c.y;
            // 边对预筛：两条边的 y 区间不重叠时不可能有内部交点（segCrossY 必然返回空）
            if (aHi < cLo || cHi < aLo) continue;
            const got = segCrossY(a, b, c, d);
            for (let k = 0; k < got.length; k++) _ys.push(got[k]);
        }
    }
    _ys.sort(_npAsc);

    let ns = 0;
    for (let i = 0; i < _ys.length; i++) {
        const y = _ys[i];
        if (ns === 0 || y - _slabs[ns - 1] > 1e-9) _slabs[ns++] = y;
    }
    _slabs.length = ns;
    if (ns < 2) return 0;

    let area = 0;
    for (let i = 0; i + 1 < ns; i++) {
        const y0 = _slabs[i];
        const y1 = _slabs[i + 1];
        const h = y1 - y0;
        if (h < 1e-9) continue;
        const eps = Math.min(1e-7, h * 1e-3);
        const s0 = sectionOverlap(P, Q, y0 + eps);
        const s1 = sectionOverlap(P, Q, y1 - eps);
        area += ((s0 + s1) * 0.5) * h;
    }
    return area;
}

/** 栅格采样交集面积（只用于交叉校验，主判定走 overlapAreaExact） */
export function overlapAreaRaster(P: Vec2[], Q: Vec2[], step: number): number {
    const bp = polyBounds(P);
    const bq = polyBounds(Q);
    const minX = Math.max(bp.minX, bq.minX);
    const maxX = Math.min(bp.maxX, bq.maxX);
    const minY = Math.max(bp.minY, bq.minY);
    const maxY = Math.min(bp.maxY, bq.maxY);
    if (maxX <= minX || maxY <= minY) return 0;
    let hit = 0;
    let total = 0;
    for (let y = minY + step * 0.5; y < maxY; y += step) {
        for (let x = minX + step * 0.5; x < maxX; x += step) {
            total++;
            if (pointInPoly(x, y, P) && pointInPoly(x, y, Q)) hit++;
        }
    }
    return total === 0 ? 0 : (hit / total) * (maxX - minX) * (maxY - minY);
}

/** 重合率口径（写死在文档里，中途不许改）：交集 / 两者较大面积 × 100 */
export function overlapPercent(objectPts: Vec2[], targetPts: Vec2[], objArea?: number, tgtArea?: number): number {
    const aObj = objArea ?? polyArea(objectPts);
    const aTgt = tgtArea ?? polyArea(targetPts);
    const denom = Math.max(aObj, aTgt);
    if (denom <= 1e-9) return 0;
    const inter = overlapAreaExact(objectPts, targetPts);
    const p = (inter / denom) * 100;
    return p < 0 ? 0 : p > 100 ? 100 : p;
}

/** 角度归一到 (-180, 180] */
export function normDeg(d: number): number {
    let x = d % 360;
    if (x > 180) x -= 360;
    if (x <= -180) x += 360;
    return x;
}

export function clamp(x: number, lo: number, hi: number): number {
    return x < lo ? lo : x > hi ? hi : x;
}
