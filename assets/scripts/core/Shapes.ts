/**
 * Shapes.ts —— 轮廓数据加载与校验（数据源：美术的 assets/config/shapes.json）
 *
 * 本文件只做两件事：
 *  1) 把外部 JSON 变成 Record<id, ShapeDef>，并把「脏数据」挡在加载期（错误一次性列全，不静默修）；
 *  2) 提供判定要用到的派生量（单位面积缓存），保证「看到的轮廓」= 「判到的轮廓」。
 *
 * 坐标约定：局部归一化坐标，长边 = 1，形心≈原点，y 向下（与 Geometry/Layout 一致）。
 * 本文件不引用引擎 API，可被 node 直接 import（见 tools/shapes_check.mjs）。
 */

import type { ShapeDef } from './Types';
import type { Vec2 } from './Geometry';
import { polyArea, polyBounds, polyCentroid } from './Geometry';

/** 美术交付必须满足的硬性范围（改这里 = 改验收标准，先问主策划 + 美术） */
export const SHAPE_LIMITS = {
    /** 12 边形以下看起来像「用直尺画的圈」，48 以上判定开销翻倍而肉眼无差别 */
    minVerts: 12,
    maxVerts: 80,          // D-119：44→80 实测 k 只变 0.1–0.3%（窗口 ≤0.6ms），视觉更顺；上限仍由自交检查兜底
    /** 归一化长边目标值与容差（±2%） */
    longSide: 1,
    longSideTol: 0.02,
    /** 形心离原点距离上限（归一化单位） */
    centroidTol: 0.05,
    /** 单位面积下限，挡掉「压成一条线」的坏数据 */
    minUnitArea: 1e-4,
} as const;

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface ShapeInspectResult {
    shapes: Record<string, ShapeDef>;
    /** 致命问题：有一条就不许进运行时 */
    errors: string[];
    /** 非致命提醒 */
    warnings: string[];
}

/** 有向面积符号（用于判断三角形方向） */
function cross(o: Vec2, a: Vec2, b: Vec2): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSeg(a: Vec2, b: Vec2, p: Vec2): boolean {
    return (
        Math.min(a.x, b.x) - 1e-12 <= p.x &&
        p.x <= Math.max(a.x, b.x) + 1e-12 &&
        Math.min(a.y, b.y) - 1e-12 <= p.y &&
        p.y <= Math.max(a.y, b.y) + 1e-12
    );
}

/** 线段是否接触（含端点接触与共线重叠）；用于简单多边形自交检测 */
function segTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    if (Math.abs(d1) < 1e-12 && onSeg(c, d, a)) return true;
    if (Math.abs(d2) < 1e-12 && onSeg(c, d, b)) return true;
    if (Math.abs(d3) < 1e-12 && onSeg(a, b, c)) return true;
    if (Math.abs(d4) < 1e-12 && onSeg(a, b, d)) return true;
    return false;
}

/** 简单多边形判定：任意两条不相邻边不许相交/接触（凹多边形允许） */
export function isSimplePolygon(pts: Vec2[]): boolean {
    const n = pts.length;
    if (n < 3) return false;
    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        for (let j = i + 1; j < n; j++) {
            // 相邻边共享端点，跳过
            if (j === i + 1 || (i === 0 && j === n - 1)) continue;
            const c = pts[j];
            const d = pts[(j + 1) % n];
            if (segTouch(a, b, c, d)) return false;
        }
    }
    return true;
}

/** 归一化长边：取包围盒两边中的较大者（美术按「正立姿态」出图，故包围盒即长边） */
export function longSideOf(pts: Vec2[]): number {
    const b = polyBounds(pts);
    return Math.max(b.maxX - b.minX, b.maxY - b.minY);
}

/** 单位面积缓存：判定每帧都要用，避免重复鞋带公式 */
const UNIT_AREA_CACHE = new WeakMap<ShapeDef, number>();

/** 归一化轮廓（长边=1）的绝对面积 —— 世界面积 = 该值 × size² */
export function shapeUnitArea(shape: ShapeDef): number {
    const cached = UNIT_AREA_CACHE.get(shape);
    if (cached !== undefined) return cached;
    const a = polyArea(shape.pts);
    UNIT_AREA_CACHE.set(shape, a);
    return a;
}

/** 单个形状的校验，返回问题清单（前缀已带 shape id） */
function validateOne(shape: ShapeDef, index: number, seen: Set<string>, errors: string[], warnings: string[]): void {
    const tag = `shape[${index}]${shape && shape.id ? ' ' + shape.id : ''}`;
    if (!shape || typeof shape !== 'object') {
        errors.push(`${tag}: 不是对象`);
        return;
    }
    if (typeof shape.id !== 'string' || shape.id.length === 0) errors.push(`${tag}: id 必须是非空字符串`);
    else if (seen.has(shape.id)) errors.push(`${tag}: id 重复 "${shape.id}"`);
    else seen.add(shape.id);

    if (typeof shape.name !== 'string' || shape.name.length === 0) warnings.push(`${tag}: name 缺失`);
    if (typeof shape.size !== 'number' || !(shape.size > 0)) errors.push(`${tag}: size 必须是 > 0 的数字`);
    if (typeof shape.fill !== 'string' || !HEX6.test(shape.fill)) errors.push(`${tag}: fill 必须是 #RRGGBB`);
    if (shape.stroke !== undefined && (typeof shape.stroke !== 'string' || !HEX6.test(shape.stroke))) {
        errors.push(`${tag}: stroke 必须是 #RRGGBB`);
    }
    if (!Array.isArray(shape.pts)) {
        errors.push(`${tag}: pts 必须是数组`);
        return;
    }
    const pts = shape.pts;
    if (pts.length < SHAPE_LIMITS.minVerts || pts.length > SHAPE_LIMITS.maxVerts) {
        errors.push(`${tag}: 顶点数 ${pts.length} 超出 ${SHAPE_LIMITS.minVerts}–${SHAPE_LIMITS.maxVerts}`);
    }
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !isFinite(p.x) || !isFinite(p.y)) {
            errors.push(`${tag}: pts[${i}] 不是有限数字坐标`);
            return;
        }
        const q = pts[(i + 1) % pts.length];
        if (q && Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9) {
            errors.push(`${tag}: pts[${i}] 与下一点重合`);
            return;
        }
    }
    /* D-124：附件轮廓校验（只画不判，但仍要求是合法简单多边形） */
    if (shape.attach !== undefined) {
        if (!Array.isArray(shape.attach)) errors.push(`${tag}: attach 必须是数组`);
        else {
            for (let ai = 0; ai < shape.attach.length; ai++) {
                const a = shape.attach[ai];
                const at = `${tag} attach[${ai}]`;
                if (!a || !Array.isArray(a.pts)) { errors.push(`${at}: pts 必须是数组`); continue; }
                if (a.pts.length < 3 || a.pts.length > SHAPE_LIMITS.maxVerts) {
                    errors.push(`${at}: 顶点数 ${a.pts.length} 超出 3–${SHAPE_LIMITS.maxVerts}`);
                    continue;
                }
                let bad = false;
                for (const q of a.pts) {
                    if (!q || !isFinite(q.x) || !isFinite(q.y)) { errors.push(`${at}: 坐标非有限数`); bad = true; break; }
                }
                if (bad) continue;
                if (typeof a.fill !== 'string' || !HEX6.test(a.fill)) errors.push(`${at}: fill 必须是 #RRGGBB`);
                if (a.stroke !== undefined && (typeof a.stroke !== 'string' || !HEX6.test(a.stroke))) {
                    errors.push(`${at}: stroke 必须是 #RRGGBB`);
                }
                if (!isSimplePolygon(a.pts)) errors.push(`${at}: 自交（必须简单多边形）`);
                if (!(polyArea(a.pts) > SHAPE_LIMITS.minUnitArea)) errors.push(`${at}: 面积过小（退化）`);
            }
        }
    }
    if (pts.length < 3) return;
    if (!isSimplePolygon(pts)) errors.push(`${tag}: 轮廓自交（必须简单多边形，凹可以，自交不行）`);
    const area = polyArea(pts);
    if (!(area > SHAPE_LIMITS.minUnitArea)) errors.push(`${tag}: 面积 ${area.toFixed(6)} 过小（退化多边形）`);
    const c = polyCentroid(pts);
    const cd = Math.hypot(c.x, c.y);
    if (cd > SHAPE_LIMITS.centroidTol) {
        errors.push(`${tag}: 形心离原点 ${cd.toFixed(4)} > ${SHAPE_LIMITS.centroidTol}（必须形心≈原点，否则旋转会甩）`);
    }
    const ls = longSideOf(pts);
    const dev = Math.abs(ls - SHAPE_LIMITS.longSide) / SHAPE_LIMITS.longSide;
    if (dev > SHAPE_LIMITS.longSideTol) {
        errors.push(`${tag}: 长边 ${ls.toFixed(4)} 偏离 1 超过 ±${SHAPE_LIMITS.longSideTol * 100}%`);
    }
}

/** 宽松读入：数组 或 { shapes: [...] } */
function toShapeArray(json: unknown): unknown[] {
    if (Array.isArray(json)) return json;
    if (json && typeof json === 'object' && Array.isArray((json as { shapes?: unknown[] }).shapes)) {
        return (json as { shapes: unknown[] }).shapes;
    }
    return [];
}

/** 校验但不抛异常：给工具打印全部问题用 */
export function inspectShapes(json: unknown): ShapeInspectResult {
    const list = toShapeArray(json);
    const errors: string[] = [];
    const warnings: string[] = [];
    const shapes: Record<string, ShapeDef> = {};
    if (list.length === 0) errors.push('shapes 为空或格式不对（支持 [ ... ] 或 { "shapes": [ ... ] }）');
    const seen = new Set<string>();
    for (let i = 0; i < list.length; i++) {
        const s = list[i] as ShapeDef;
        validateOne(s, i, seen, errors, warnings);
        if (s && typeof s.id === 'string' && s.id.length > 0) shapes[s.id] = s;
    }
    return { shapes, errors, warnings };
}

/**
 * 加载 shapes.json → Record<id, ShapeDef>
 * 有致命错误直接抛异常（带全部问题清单），绝不让脏数据进运行时。
 */
export function loadShapes(json: unknown): Record<string, ShapeDef> {
    const r = inspectShapes(json);
    if (r.errors.length > 0) {
        throw new Error(`shapes.json 校验失败（${r.errors.length} 项）：\n- ` + r.errors.join('\n- '));
    }
    return r.shapes;
}

/** 按 id 取形状，缺失时给出「谁缺」的可读错误（避免 undefined 静默传播） */
export function requireShape(shapes: Record<string, ShapeDef>, id: string, where: string): ShapeDef {
    const s = shapes[id];
    if (!s) throw new Error(`${where}: shapes.json 里没有 id="${id}"（现有 ${Object.keys(shapes).length} 个）`);
    return s;
}
