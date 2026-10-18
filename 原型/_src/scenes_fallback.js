/* ------------------------------------------------------------------
 * 原型/_src/scenes_fallback.js —— 美术 assets/config/scenes.json 未就绪时的占位场景
 *
 * 只在 scenes.json 缺失时由 build 脚本内联（__CONFIG__.sources.scenes = 'fallback'）。
 * 结构与规格 §5 的 scenes.json 完全一致，美术的文件一到就自动替换，渲染代码不动。
 * 约束（规格 §2 / §4）：每场景 ≤3 个动态层，周期 ≥14s，元素叠加后亮度 < 背景 +18%。
 * ------------------------------------------------------------------ */

var FALLBACK_SCENES = {
    version: 1,
    auto: true,
    note: 'fallback scenes（美术 scenes.json 未就绪）',
    scenes: [
        {
            id: 'night_station',
            name: '深夜候车',
            bg: ['#0B1424', '#111E33'],
            layers: [
                { k: 'cloud', n: 2, alpha: [0.10, 0.06], periodMs: 22000 },
                { k: 'carlight', n: 1, alpha: [0.12], periodMs: 22000 },
                { k: 'stars', n: 12, alpha: [0.05], periodMs: 30000 }
            ],
            allowed: ['relax', 'challenge']
        },
        {
            id: 'noon_window',
            name: '午休窗边',
            bg: ['#F6F1E7', '#E8EEF4'],
            layers: [
                { k: 'sunpatch', n: 3, alpha: [0.14], periodMs: 26000 },
                { k: 'curtain', n: 1, alpha: [0.10], periodMs: 14000 }
            ],
            allowed: ['relax', 'challenge']
        },
        {
            id: 'minimal',
            name: '极简纯净',
            bg: ['#141A24', '#0E1420'],
            layers: [
                { k: 'dust', n: 16, alpha: [0.06], periodMs: 30000 }
            ],
            allowed: ['relax', 'challenge']
        }
    ]
};
