/**
 * Types.ts —— 【冻结接口】主策划在开工前定死的契约，程序照此实现，不许中途改口径。
 *
 * 改这个文件 = 策划/程序/测试三方返工。要改先写 04_项目管理/决策记录.md。
 */

import type { Vec2 } from './Geometry';

/** 评级 id（与文案、音效、埋点一一对应） */
export type RatingId = 'god' | 'perfect' | 'good' | 'ok' | 'fail';

export interface RatingRule {
    id: RatingId;
    /** 重合率下界（含），单位 % */
    minPercent: number;
    baseScore: number;
    label: string;
}

/** 一个物体的视觉轮廓（判定与绘制共用同一份多边形，保证「看到的」=「判到的」） */
export interface ShapeDef {
    id: string;
    /** 给玩家看的名字 */
    name: string;
    /** 长边像素（设计分辨率 720×1280 下） */
    size: number;
    /** 主体填充色 #RRGGBB */
    fill: string;
    /** 描边色 */
    stroke: string;
    /** 归一化轮廓：长边 = 1，形心≈原点，y 向下，顶点顺序任意但不许自交 */
    pts: Vec2[];
    /** 仅用于绘制的装饰（不参与判定） */
    details?: ShapeDetail[];
    /**
     * 附件轮廓（D-124）：分离部件（龙虾钳、卫星太阳能板、掌机按钮）画在这里。
     * **不参与判定**——判定只用 pts 主体；渲染时与主体同变换（缩放/旋转）。
     * 坐标口径与 pts 相同：长边 = 1、形心≈原点（附件可以离原点很远，只要落在主体尺寸范围内）。
     */
    attach?: ShapeAttachment[];
}

export interface ShapeAttachment {
    /** 附件轮廓（简单多边形，3–80 顶点） */
    pts: Vec2[];
    /** 填充色 #RRGGBB */
    fill: string;
    /** 描边色 #RRGGBB（缺省用主体 stroke） */
    stroke?: string;
}

export type ShapeDetail =
    | { k: 'line'; pts: Vec2[]; w: number; color: string }
    | { k: 'circle'; c: Vec2; r: number; color: string; filled: boolean }
    | { k: 'poly'; pts: Vec2[]; color: string };

/** 运动类型（CSV 的 motion_type，给人看的大类） */
export type MotionKind = '旋转' | '抛物' | '弹跳' | '组合';

/** 运动模板 id：几何形状，与「变速」正交 */
export type PathId =
    | 'h_line' /** 左→右，y = 目标中心 y，x 从 -180 到 900 */
    | 'h_line_rl' /** 右→左，同上镜像 */
    | 'diag_dl' /** 左上→右下，端点 = 目标中心 ±(-360,-220) */
    | 'diag_ur' /** 左下→右上，端点 = 目标中心 ±(-360,220) */
    | 'arc_up' /** 从下方起，抛物线向上，在顶点附近恰好穿过目标中心，再落回下方 */
    | 'arc_down' /** 从上方起步的镜像 */
    | 'bounce_floor'; /** 左上落下 → 触地反弹 → 上穿目标中心，读作「弹跳」 */

export interface LevelDef {
    id: number;
    name: string;
    /** 物体轮廓 id（shapes.json） */
    shapeId: string;
    /** 目标绿框轮廓 id（可与物体不同，制造难度；v0.1 默认同形） */
    outlineId: string;
    variant: 'single' | 'dual';
    motion: MotionKind;
    path: PathId;
    /** 一次穿越的周期（毫秒）：物体从进场到离场的总时长 */
    cycleMs: number;
    /** 一次穿越滚过多少整圈（可负 = 反向） */
    turns: number;
    /** 速度微扰上限（0–0.15），每周期随机 ±，不改路径 */
    jitter: number;
    /** 设计容错角度（度），用于提示文案与验收，不直接改判定公式 */
    toleranceDeg: number;
    /** 通关阈值（0–1） */
    passRate: number;
    /** 三星阈值（0–1） */
    star3Rate: number;
    /** 单次尝试合理耗时（秒） */
    estSec: number;
    /** 无尽模式出场权重 */
    weight: number;
    /** 本关尝试次数（默认 3） */
    attempts: number;
    note: string;
    /**
     * 两段变速：1 = 匀速；0.75 = 前段 0.75×、后段 1.25×；1.25 = 前段 1.25×、后段 0.75×。
     * 切换点固定在 u=0.4（可练、可背），全天候确定性，不随机。
     */
    speedStage: number;
    /** 双物体关卡的第二物体 */
    shapeId2?: string;
    /** 派生字段（工具写入，程序只读） */
    linSpeed: [number, number];
    angSpeed: [number, number];
}

/** 单个物体的运行时（由 buildLevel 生成，之后只读） */
export interface MoverRuntime {
    shape: ShapeDef;
    /** 世界坐标的绿色目标轮廓（固定不动，每秒都不许变） */
    targetPts: Vec2[];
    targetArea: number;
    targetCenter: Vec2;
    /** 目标轮廓的「完美姿态」旋转角（固定为 0，绿框永远正立） */
    targetRotDeg: number;
    /** 物体轨迹折线（世界坐标） */
    pathPts: Vec2[];
    pathLen: number;
    /** 轨迹参数 u（0–1，按弧长），完美时机 u = uStar */
    uStar: number;
    /** t=0 时的物体旋转角 */
    startRot: number;
    turns: number;
    speedStage: number;
    /** 本周期实际周期（含微扰），毫秒 */
    cycleMs: number;
    /** 双物体镜像（dir=-1 时轨迹 x 取反） */
    dir: 1 | -1;
}

export interface LevelRuntime {
    def: LevelDef;
    movers: MoverRuntime[];
    /** 完美时机（毫秒，从本周期 t=0 起算） */
    perfectMs: number;
}

export interface Pose {
    x: number;
    y: number;
    rotDeg: number;
}

/** 单个物体的判定明细（给热力图、提示文案、埋点用） */
export interface ObjectJudge {
    shapeId: string;
    pct: number;
    interArea: number;
    targetArea: number;
    /** 角度偏差（度，带符号，正 = 物体比目标多转了） */
    angleDev: number;
    /** 形心位移（像素） */
    offsetPx: number;
    pose: Pose;
    objectPts: Vec2[];
    targetPts: Vec2[];
}

export interface JudgeResult {
    /** 主口径：各物体重合率的算术平均（单物体即自身） */
    pct: number;
    rating: RatingId;
    baseScore: number;
    score: number;
    pass: boolean;
    star3: boolean;
    /** 按早了 / 按晚了，毫秒（负 = 早） */
    timing: { deltaMs: number; verdict: 'early' | 'late' | 'onTime' };
    objects: ObjectJudge[];
}

/** 冻结 API：程序必须实现这些签名，其余自由 */
export interface CoreApi {
    loadShapes(json: unknown): Record<string, ShapeDef>;
    loadLevels(json: unknown): LevelDef[];
    buildLevel(def: LevelDef, shapes: Record<string, ShapeDef>, seed: number): LevelRuntime;
    /** 轨迹参数 u（0–1）；t 已按本周期 cycleMs 取模 */
    uAt(mover: MoverRuntime, tMs: number): number;
    poseAt(mover: MoverRuntime, tMs: number): Pose;
    objectPtsAt(mover: MoverRuntime, tMs: number): Vec2[];
    judge(rt: LevelRuntime, pressMs: number, combo?: number): JudgeResult;
    ratingOf(pct: number): RatingRule;
    RATINGS: RatingRule[];
}
