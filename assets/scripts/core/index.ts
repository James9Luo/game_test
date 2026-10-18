/**
 * index.ts —— 核心层唯一入口（Cocos / H5 原型 / 工具链都只 import 这里）
 *
 * 用法：
 *   import { Core } from '../core/index';
 *   const shapes = Core.loadShapes(shapesJson);
 *   const levels = Core.loadLevels(levelsJson);
 *   const rt = Core.buildLevel(levels[0], shapes, seed);
 *   const r = Core.judge(rt, pressMs, combo);               // 同步关：一次判全部（取 min）
 *   const n = Core.judgeNearest(rt, tMs, skipIdx, combo);   // 错拍关：一次只判「最近的那个」
 *
 * ⚠️ 打包纪律（v0.6 踩过）：`tools/build_proto.mjs` **不会展开 `export *`**，
 * 它按下面 `Core` 对象的**显式键**收集运行时命名空间。新增对外 API 必须三件事一起做：
 *   ① 顶部 `import`；② 加进 `Core` 对象；③ 文件末尾 `export { ... }` 再列一次。
 * 只写 `export * from './X'` 时：TS 类型能用，但**运行时是 `undefined`**（judgeNearest 就这样丢过一次）。
 *
 * 本层不含任何引擎 API：不依赖 cc / DOM / 资源加载，只吃 JSON、吐数据。
 */

import type { CoreApi } from './Types';
import { buildLevel, loadLevels, readMotion, readDuo, isStaggered } from './LevelStore';
import { loadShapes } from './Shapes';
import { objectPtsAt, poseAt, uAt, localT, moverTiming, moverMotion, objectScaleOf, wrapT, wrapDelta } from './Paths';
import {
    judge,
    judgeMover,
    judgeNearest,
    duoVerdict,
    hitWindow,
    godWindow,
    starWindow,
    windowMetrics,
    hitWindowForMover,
    godWindowForMover,
    starWindowForMover,
    moverWindowAt,
    perMoverWindows,
    tighterWindow,
    hitWindowByMover,
    godWindowByMover,
    perfectMsByMover,
    perfectMsOf,
    isDesyncRuntime,
    heatBands,
    overlapStrips,
    missStrips,
    starsOfResult,
} from './Judge';
import { RATINGS, ratingOf, scoreOf, starsOf } from './Score';

/** 冻结接口的实现体：签名对不上会在 TypeScript 编译期直接报错 */
const api: CoreApi = {
    loadShapes,
    loadLevels,
    buildLevel,
    uAt,
    poseAt,
    objectPtsAt,
    judge,
    ratingOf,
    RATINGS,
};

/**
 * 运行时命名空间（**必须显式列**；`export *` 在 proto 打包链路里不会展开）。
 * 前半段 = 冻结 API；后半段 = v0.4–v0.6 扩展（运动调制 / 窗口 / 错拍 / 热力图）。
 */
export const Core = {
    ...api,
    // 运动与时间轴
    localT,
    moverTiming,
    moverMotion,
    objectScaleOf,
    wrapT,
    wrapDelta,
    // 判定与结算
    judgeMover,
    judgeNearest,
    duoVerdict,
    ratingOf,
    scoreOf,
    starsOf,
    starsOfResult,
    RATINGS,
    // 窗口
    hitWindow,
    godWindow,
    starWindow,
    windowMetrics,
    hitWindowForMover,
    godWindowForMover,
    starWindowForMover,
    moverWindowAt,
    perMoverWindows,
    tighterWindow,
    hitWindowByMover,
    godWindowByMover,
    perfectMsByMover,
    perfectMsOf,
    isDesyncRuntime,
    // 配置读取
    readMotion,
    readDuo,
    isStaggered,
    // 热力图
    overlapStrips,
    missStrips,
    heatBands,
};

export * from './Geometry';
export * from './Layout';
export * from './Types';
export * from './Shapes';
export * from './Paths';
export * from './Score';
export * from './Judge';
export * from './LevelStore';

// 运行时也显式导出一次（`export *` 只够 TS 用；打包链路按名字取）
export {
    judgeNearest,
    duoVerdict,
    perMoverWindows,
    hitWindowForMover,
    godWindowForMover,
    starWindowForMover,
    moverWindowAt,
    tighterWindow,
    perfectMsOf,
    isDesyncRuntime,
    hitWindow,
    godWindow,
    starWindow,
    windowMetrics,
    judgeMover,
    starsOfResult,
    overlapStrips,
    missStrips,
    heatBands,
    readMotion,
    readDuo,
    isStaggered,
    localT,
    moverTiming,
    moverMotion,
    objectScaleOf,
    wrapT,
    wrapDelta,
    scoreOf,
    starsOf,
};
