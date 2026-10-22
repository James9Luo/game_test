/**
 * Layout.ts —— 【冻结】屏幕布局与判定文案，单位 = 设计分辨率像素（720×1280，y 向下）
 *
 * 改这里等于改体验节奏，必须主策划签字。数值来源见 01_策划文档/20261018_数值与判定表.md。
 */

export const DESIGN_W = 720;
export const DESIGN_H = 1280;

/** 竖屏安全区（上下留白，避开刘海与手势条） */
export const SAFE = { top: 44, bottom: 34, left: 24, right: 24 };

/** 顶部 HUD 占位 */
export const HUD = { h: 132, y: 44 };

/** 可玩区（物体只在这个区间内被判定/绘制） */
export const PLAY = { top: 176, bottom: 1010 };

/** 【暂停】按钮：唯一操作，保证单手拇指可达 */
export const PAUSE_BTN = { cx: 360, cy: 1122, r: 106 };

/** 目标绿框（固定不动）——单物体关 */
export const TARGET_SINGLE = { cx: 360, cy: 596 };

/**
 * 双物体关：上下两条车道，绿框在各自车道中心。
 * 物体各自沿车道飞过，必须**同一帧**同时卡位（同一周期、同一 u*）。
 *
 * 车道位置受结算面板约束：面板顶边在 y≈745，所以下车道中心必须 ≤ 640
 * （物体半高 ≈ 80px），否则按下的瞬间热力图会被面板挡住——玩家看不到
 * 第二个物体错在哪，「双轮廓」就变成了盲猜。改这两个数前先看结算截图。
 */
export const TARGET_DUAL = [
    { cx: 360, cy: 318, scale: 0.70 },   // D-122：0.62→0.70（玩家反馈双物体关「小了点」）
    { cx: 360, cy: 618, scale: 0.70 },
];

/** 美术/程序都要用的判定文案（不含数字，数字由 judge 返回） */
export const VERDICT_TEXT = {
    god: { title: '神级定格', sub: '这一帧，值得发出去' },
    perfect: { title: '完美', sub: '卡得漂亮' },
    good: { title: '不错', sub: '就差一点' },
    ok: { title: '及格', sub: '手慢了一点' },
    fail: { title: '差得有点远', sub: '再试一次？' },
} as const;

/** 按早/按晚提示模板：{ms} = 毫秒，{deg} = 角度 */
export const TIMING_TEXT = {
    early: '按早了 {ms}ms（少转 {deg}°）',
    late: '按晚了 {ms}ms（多转 {deg}°）',
    onTime: '时机刚好',
} as const;

/** 连击系数：1 + 0.1 × 连击，上限 2.0 */
export const COMBO = { step: 0.1, max: 2.0 };

/** 各模式分值系数（v0.1 只有闯关） */
export const MODE_COEF = { campaign: 1.0, endless: 1.15 } as const;

/** 反馈时序（毫秒，从按下那一帧开始）——顺序固定不可调换
 *  relax 版（D-028）：取消全屏闪白，改为以绿框为中心的柔光呼吸。
 *  `flash` 保留只为兼容旧代码，新代码请用 glowIn/glowOut；`freeze` 恒为 0（当帧生效）。
 */
export const FEEDBACK_MS = {
    flash: 90 /** @deprecated 旧的全屏闪白，relax 版已废弃，别再接新逻辑 */,
    freeze: 0 /** 冻结：当帧生效 */,
    glowIn: 140 /** 柔光呼吸淡入 */,
    glowOut: 260 /** 柔光呼吸淡出 */,
    heatmap: 120 /** 热力图淡入 */,
    panel: 260 /** 评级弹出 */,
    resultHold: 900 /** 结算停留后允许「再来一次」 */,
} as const;

/** 评级特效的能量预算（用于验收：五档必须严格单调递减，截图排序不能反）
 *  能量分 = 环数×30 + 粒子数×2 + 呼吸(有=18, 无=0)
 *  138(神级) > 48(完美) > 18(不错) > 10(及格) > 0(失败)
 */
export const RATING_FX = {
    god: { rings: 3, motes: 24, breath: 18, energy: 138 },
    perfect: { rings: 1, motes: 12, breath: 0, energy: 48 },
    good: { rings: 0, motes: 0, breath: 18, energy: 18 },
    ok: { rings: 1, motes: 0, breath: 0, energy: 10 },
    fail: { rings: 0, motes: 0, breath: 0, energy: 0 },
} as const;

/** 静音开关：右上角 44×44 视觉、88×88 热区；与 HUD 右列不重叠（HUD 右列右对齐 x=640） */
export const MUTE_BTN = { x: 652, y: 44, size: 44, hit: 88 };

/** 关内重试：失败后自动重新进场 */
export const RETRY_DELAY_MS = 700;

/** 星级显示：三星 = star3Rate，二星 = passRate + 0.7×gap，一星 = passRate */
export const STAR_SPLIT = 0.7;
