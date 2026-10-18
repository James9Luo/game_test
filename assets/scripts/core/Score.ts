/**
 * Score.ts —— 评级表 / 连击系数 / 星级
 *
 * 口径（主策划冻结，不许在这里「调手感」）：
 *   神级 ≥95%（1000 分）/ 完美 ≥80%（600）/ 不错 ≥60%（350）/ 及格 ≥40%（150）/ 失败 <40%（0）
 *   score = round(base × min(2, 1 + 0.1×combo) × MODE_COEF)
 * 评级阈值同时写进 assets/resources/config/judge_rule.json（工具导出，线上配置可核对）。
 */

import type { LevelDef, RatingId, RatingRule } from './Types';
import { COMBO, MODE_COEF, STAR_SPLIT } from './Layout';

/** 判定容差：|Δ| ≤ 16.7ms（1 帧 @60fps）算「时机刚好」 */
export const ON_TIME_MS = 16.7;

/** 评级表：从高到低，先命中先返回 */
export const RATINGS: RatingRule[] = [
    { id: 'god', minPercent: 95, baseScore: 1000, label: '神级定格' },
    { id: 'perfect', minPercent: 80, baseScore: 600, label: '完美' },
    { id: 'good', minPercent: 60, baseScore: 350, label: '不错' },
    { id: 'ok', minPercent: 40, baseScore: 150, label: '及格' },
    { id: 'fail', minPercent: 0, baseScore: 0, label: '差得有点远' },
];

/** 重合率 → 评级规则（pct 为 0–100 的百分数） */
export function ratingOf(pct: number): RatingRule {
    for (let i = 0; i < RATINGS.length; i++) {
        if (pct >= RATINGS[i].minPercent) return RATINGS[i];
    }
    return RATINGS[RATINGS.length - 1];
}

export function ratingIdOf(pct: number): RatingId {
    return ratingOf(pct).id;
}

/** 连击倍率：1 + 0.1×combo，上限 2.0（combo 为「已连续成功次数」） */
export function comboMultiplier(combo: number): number {
    const n = combo > 0 ? combo : 0;
    return Math.min(COMBO.max, 1 + COMBO.step * n);
}

/** 单次得分；modeCoef 默认闯关 1.0，无尽 1.15 */
export function scoreOf(pct: number, combo: number = 0, modeCoef: number = MODE_COEF.campaign): number {
    return Math.round(ratingOf(pct).baseScore * comboMultiplier(combo) * modeCoef);
}

/**
 * 星级阈值：3 = star3Rate，2 = passRate + 0.7×gap，1 = passRate，0 = 未过
 *
 * ⚠️ 本函数只看「平均 pct」，不知道多物体关是否每个物体都达标。
 * 面板展示请用 `Judge.starsOfResult(rt, result)` —— 它会先用 `result.pass` 门控（没过一律 0 星），
 * 避免出现「平均 90% 给了三星、但其实有一个物体没进框」的展示矛盾。
 */
export function starsOf(pct: number, def: LevelDef): number {
    const pass = def.passRate * 100;
    const s3 = def.star3Rate * 100;
    if (pct < pass) return 0;
    if (pct >= s3) return 3;
    const two = pass + STAR_SPLIT * (s3 - pass);
    if (pct >= two) return 2;
    return 1;
}

/** 导出给 judge_rule.json 的快照（工具与运行时同源，防止「文档写的」和「代码判的」不一致） */
export function judgeRuleSnapshot(): Record<string, unknown> {
    return {
        version: 1,
        metric: 'intersection / max(objectArea, targetArea) × 100',
        metricName: '轮廓重合面积（不是中心点）',
        onTimeMs: ON_TIME_MS,
        combo: { step: COMBO.step, max: COMBO.max, formula: 'min(2, 1 + step × combo)' },
        modeCoef: { campaign: MODE_COEF.campaign, endless: MODE_COEF.endless },
        starSplit: STAR_SPLIT,
        ratings: RATINGS.map((r) => ({ id: r.id, minPercent: r.minPercent, baseScore: r.baseScore, label: r.label })),
    };
}
