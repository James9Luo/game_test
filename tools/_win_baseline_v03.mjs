/**
 * tools/_win_baseline_v03.mjs —— 【S8 回归基线】v0.3 时季 1 的 15 关三窗口实测值
 *
 * 来源：v0.3 导出产物 `assets/resources/config/levels.json`（2026-10-18，真 shapes.json，seed=0），
 *       数值为 `round1` 后写入 JSON 的正式值，未做任何重算。
 *
 * 纪律：本文件只读，**不许随核心层一起改**。v0.4 加了正弦/惯性之后，
 *       季 1 的 `sine_amp=0 & inertia=0` 必须走「零调制兼容分支」，三窗口与这里**逐位相同**。
 * 校验：`node tools/geometry_test.mjs` 的 `[S8]` 段会逐个比对；不一致 = 回归。
 */

export const WIN_BASELINE_V03 = {
    version: 'v0.3',
    capturedFrom: 'assets/resources/config/levels.json（v0.3 导出，真 shapes.json，seed=0）',
    metric: 'hitWindow / godWindow / starWindow，单位 ms，[早, 晚]，已 round1',
    levels: [
        { id: 1, cycleMs: 3776, turns: 1, passRate: 0.6, star3Rate: 0.93, hit: [-140.4, 140], god: [-17, 17], star: [-23.9, 23.9] },
        { id: 2, cycleMs: 3453, turns: 1, passRate: 0.6, star3Rate: 0.93, hit: [-128.4, 128], god: [-15.6, 15.6], star: [-21.9, 21.9] },
        { id: 3, cycleMs: 2398, turns: 2, passRate: 0.6, star3Rate: 0.93, hit: [-122.2, 112], god: [-10.5, 10.5], star: [-14.9, 15.2] },
        { id: 4, cycleMs: 2330, turns: 2, passRate: 0.62, star3Rate: 0.94, hit: [-110.8, 102], god: [-10.2, 10.2], star: [-12.5, 12.5] },
        { id: 5, cycleMs: 2694, turns: 2, passRate: 0.62, star3Rate: 0.94, hit: [-92, 92.3], god: [-11.2, 11.2], star: [-13.5, 13.5] },
        { id: 6, cycleMs: 2858, turns: 2, passRate: 0.64, star3Rate: 0.94, hit: [-82, 88.2], god: [-10.3, 10.3], star: [-12.4, 12.4] },
        { id: 7, cycleMs: 3909, turns: 2, passRate: 0.64, star3Rate: 0.94, hit: [-74, 74], god: [-7.5, 7.5], star: [-9, 9] },
        { id: 8, cycleMs: 3268, turns: 2, passRate: 0.66, star3Rate: 0.94, hit: [-68, 66], god: [-7.1, 7.1], star: [-8.6, 8.3] },
        { id: 9, cycleMs: 5107, turns: 2, passRate: 0.66, star3Rate: 0.94, hit: [-60.3, 62.4], god: [-8.3, 8], star: [-10.1, 9.8] },
        { id: 10, cycleMs: 1636, turns: 2, passRate: 0.6, star3Rate: 0.94, hit: [-55, 59.7], god: [-5.9, 5.9], star: [-7.1, 7.1] },
        { id: 11, cycleMs: 4153, turns: 3, passRate: 0.68, star3Rate: 0.94, hit: [-50, 51.5], god: [-7.4, 7.4], star: [-8.9, 8.9] },
        { id: 12, cycleMs: 3138, turns: 3, passRate: 0.7, star3Rate: 0.94, hit: [-46, 47.1], god: [-6, 6], star: [-7.1, 7.1] },
        { id: 13, cycleMs: 2881, turns: 3, passRate: 0.7, star3Rate: 0.94, hit: [-44.7, 42], god: [-6.5, 6.1], star: [-7.5, 7.5] },
        { id: 14, cycleMs: 4135, turns: 3, passRate: 0.72, star3Rate: 0.94, hit: [-38, 39], god: [-5.8, 5.8], star: [-7.3, 7.3] },
        { id: 15, cycleMs: 3586, turns: 3, passRate: 0.72, star3Rate: 0.94, hit: [-34, 34], god: [-5.1, 5.1], star: [-5.9, 5.9] },
    ],
};

/** 按 id 取基线；不存在返回 null（60 关表里季 1 只有 1–15） */
export function baselineOf(id) {
    return WIN_BASELINE_V03.levels.find((l) => l.id === id) || null;
}
