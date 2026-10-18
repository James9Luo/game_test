/**
 * GameBridge.ts —— **全工程唯一调用 core 的地方**
 *
 * 谁负责：客户端程序（Cocos 生产层）
 * 改这里之前先打招呼：Boot / LevelRunner / Mover 只通过本文件碰 core；
 * 若 core 的目录结构或导出名变了，**只改本文件的 3 行 import**，调用方不动。
 *
 * 契约来源（冻结，只读）：`assets/scripts/core/Types.ts` 的 `CoreApi`。
 * 已与 client-core 对齐（2026-10-18 消息确认）：
 *   - `core/index.ts` 导出 `Core`（完整 CoreApi 对象）+ 全部具名函数；
 *   - `overlapStrips(obj, tgt, bandPx)` → 交集矩形（绿）；`missStrips(obj, tgt, bandPx)` → 并集−交集矩形（红）；
 *     两者都返回轴对齐 `{x,y,w,h}`、设计坐标 y 向下，只用于可视化（不参与判分，容差 ±1px）；
 *   - `objectScaleOf(mover)` → 物体绘制倍率（按**面积**反推，保证「物体面积 = 目标面积」）。
 *   - `hitWindow(rt)` / `windowMetrics(rt)`（命中窗口，给提示文案/调参用）本版**未接**：
 *     它们内部连调约 40 次 judge，不能放进 update；要接时按同样方式在本文件加 2 个转发方法。
 *
 * ⚠ 与根 README 旧契约的差异（已报主策划）：旧文档写 `assets/config/levels.json`，
 *   但 `resources.load` 只能读 `assets/resources/` 下，故实际路径是
 *   `assets/resources/config/levels.json` 与 `assets/resources/config/shapes.json`。
 *   数值来源仍是 `01_策划文档/levels.csv`，导出工具不变。
 */

import { JsonAsset, resources } from 'cc';
import { Core, missStrips, objectScaleOf, overlapStrips, starsOfResult } from '../../core/index';
import type {
    CoreApi,
    JudgeResult,
    LevelDef,
    LevelRuntime,
    MoverRuntime,
    Pose,
    RatingRule,
    ShapeDef,
} from '../../core/Types';
import type { Vec2 } from '../../core/Geometry';

/** resources 相对路径（不带扩展名）：assets/resources/config/levels.json */
export const CONFIG_LEVELS = 'config/levels';
/** resources 相对路径（不带扩展名）：assets/resources/config/shapes.json */
export const CONFIG_SHAPES = 'config/shapes';

/**
 * 热力图条带高度（设计像素）。core 的 `overlapStrips / missStrips` 按这个高度切水平条带：
 * 6px 在 720 宽屏幕上肉眼连续、条数约 40。这是**渲染采样参数**，不参与判定。
 */
export const HEAT_BAND_PX = 6;

/** 一条轴对齐矩形（设计坐标，原点左上、y 向下）—— core 直接返回的就是这个形状 */
export interface HeatRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * 热力图数据，口径由 client-core 给定（2026-10-18 确认，P1 已修）：
 * - `overlap`（绿）= 交集：物体与绿框真正重合的部分；
 * - `miss`（红）= 并集 − 交集：物体探出绿框 / 绿框没被填满的部分，也就是「哪里歪了」。
 */
export interface HeatData {
    overlap: HeatRect[];
    miss: HeatRect[];
}

export class GameBridge {
    /** 全部关卡（顺序 = levels.json 数组顺序 = 关卡 id 升序） */
    readonly levels: LevelDef[];
    /** 全部轮廓，key = shape id */
    readonly shapes: Record<string, ShapeDef>;

    private readonly api: CoreApi;

    private constructor(levelsJson: unknown, shapesJson: unknown) {
        const api: CoreApi = Core;
        this.api = api;
        this.shapes = api.loadShapes(shapesJson);
        this.levels = api.loadLevels(levelsJson);
    }

    /**
     * 异步读两份配置并建桥。
     * 失败时 reject，Boot 负责把它变成屏幕上的一行错误文案（不弹 toast、不卡死主流程）。
     */
    static load(): Promise<GameBridge> {
        return new Promise<GameBridge>((resolve, reject) => {
            resources.load(CONFIG_LEVELS, JsonAsset, (err: Error | null, levelsAsset: JsonAsset) => {
                if (err || !levelsAsset) {
                    reject(err || new Error('levels.json 读取失败：' + CONFIG_LEVELS));
                    return;
                }
                resources.load(CONFIG_SHAPES, JsonAsset, (err2: Error | null, shapesAsset: JsonAsset) => {
                    if (err2 || !shapesAsset) {
                        reject(err2 || new Error('shapes.json 读取失败：' + CONFIG_SHAPES));
                        return;
                    }
                    try {
                        resolve(new GameBridge(levelsAsset.json, shapesAsset.json));
                    } catch (e) {
                        reject(e instanceof Error ? e : new Error(String(e)));
                    }
                });
            });
        });
    }

    /** 自检：返回问题清单（空数组 = 通过）。Boot 在 start() 里打一次日志，不阻断游玩。 */
    validate(): string[] {
        const issues: string[] = [];
        if (this.levels.length === 0) {
            issues.push('levels.json 里没有任何关卡');
        }
        let lastId = -1;
        for (const def of this.levels) {
            if (def.id <= lastId) {
                issues.push('关卡 id 未升序或重复：' + def.id);
            }
            lastId = def.id;
            if (!this.shapes[def.shapeId]) {
                issues.push('关卡 ' + def.id + ' 的 shapeId 在 shapes.json 里找不到：' + def.shapeId);
            }
            if (!this.shapes[def.outlineId]) {
                issues.push('关卡 ' + def.id + ' 的 outlineId 在 shapes.json 里找不到：' + def.outlineId);
            }
            if (def.variant === 'dual' && !def.shapeId2) {
                issues.push('关卡 ' + def.id + ' 是 dual 但没有 shapeId2');
            }
        }
        return issues;
    }

    /** 第 index 关（0 基）；越界返回 null */
    levelAt(index: number): LevelDef | null {
        if (index < 0 || index >= this.levels.length) {
            return null;
        }
        return this.levels[index];
    }

    /** 按 id 找关（1 基）；找不到返回 null */
    levelById(id: number): LevelDef | null {
        for (const def of this.levels) {
            if (def.id === id) {
                return def;
            }
        }
        return null;
    }

    /** 建一关的运行时（seed 固定 → 同 seed 逐帧一致，可复现） */
    buildLevel(def: LevelDef, seed: number): LevelRuntime {
        return this.api.buildLevel(def, this.shapes, seed);
    }

    /** 轨道参数 u（0..1） */
    uAt(mover: MoverRuntime, tMs: number): number {
        return this.api.uAt(mover, tMs);
    }

    /** 物体在 tMs 时刻的姿态（位置 + 旋转度）；渲染与判定同源 */
    poseAt(mover: MoverRuntime, tMs: number): Pose {
        return this.api.poseAt(mover, tMs);
    }

    /** 物体在 tMs 时刻的世界多边形（设计坐标、y 向下） */
    objectPtsAt(mover: MoverRuntime, tMs: number): Vec2[] {
        return this.api.objectPtsAt(mover, tMs);
    }

    /**
     * 物体绘制倍率（core 按面积反推：物体面积 = 目标面积）。
     * 渲染层拿它乘 `shape.size` 得到像素长边，保证「看到的物体」与「被判定的绿框」同款。
     */
    objectScaleOf(mover: MoverRuntime): number {
        return objectScaleOf(mover);
    }

    /**
     * 判定：**pressMs 必须是按下那一刻的精确逻辑时间**（LevelRunner 里取的 clock.nowMs()），
     * 不许传下一帧时间。combo 传当前连击数，系数由 core 按 Layout.COMBO 算。
     */
    judge(rt: LevelRuntime, pressMs: number, combo: number): JudgeResult {
        return this.api.judge(rt, pressMs, combo);
    }

    /** 重合率 → 评级规则 */
    ratingOf(pct: number): RatingRule {
        return this.api.ratingOf(pct);
    }

    /**
     * 星数（0..3）**只信 core**：`starsOfResult` 先按 `result.pass` 门控（没过一律 0 星），
     * 双物体关不会出现「三星但没过」。客户端不许自己用 pct 阈值再算一遍。
     */
    starsOfResult(rt: LevelRuntime, result: JudgeResult): number {
        return starsOfResult(rt, result);
    }

    /** 全部评级规则（结算文案用 label / 排序用 minPercent） */
    ratings(): RatingRule[] {
        return this.api.RATINGS;
    }

    /**
     * 判定结果 → 热力图矩形（绿 = 交集，红 = 并集−交集）。
     * 双物体关把两个物体的矩形拼在一起（各画各的）。
     * 只用于可视化：不参与判分，容差 ±1px；一次按下只算一次，别放进 update。
     */
    heatData(result: JudgeResult): HeatData {
        const overlap: HeatRect[] = [];
        const miss: HeatRect[] = [];
        for (const obj of result.objects) {
            const hit = overlapStrips(obj.objectPts, obj.targetPts, HEAT_BAND_PX);
            for (let i = 0; i < hit.length; i++) {
                overlap.push(hit[i]);
            }
            const out = missStrips(obj.objectPts, obj.targetPts, HEAT_BAND_PX);
            for (let i = 0; i < out.length; i++) {
                miss.push(out[i]);
            }
        }
        return { overlap, miss };
    }
}
