/* ------------------------------------------------------------------
 * 原型/_src/game.js —— 全流程 UI / 渲染 / 调试入口（纯浏览器 JS，无 import、无 fetch）
 *
 * 由 tools/build_proto.mjs 内联到单文件 HTML 的尾部，运行时可见的全局量只有两个：
 *   CORE        —— 冻结的核心（真实 assets/scripts/core/*.ts 或 _src/mock_core.js）
 *   __CONFIG__  —— { levels, shapes, coreMode, sources }
 *
 * 切换 mock ↔ 真实现：只改 build_proto.mjs 的 PROTO_CORE_MODE 常量，本文件不动。
 *
 * URL 调试入口（测试/截图用）：
 *   ?screen=home|play|result|complete   锁定到某个画面（时间冻结，任何时刻截图都一样）
 *   ?lvl=5                              直接进第 5 关（1 起）
 *   ?press=0.62                         在周期的 62% 处按下；0.5 = 完美时机（h_line 类）
 *   ?att=1                              强制只剩 1 次机会（验证「重试本关」面板）
 *   ?autoplay=1                         真实时间里自动按一次（配合 --virtual-time-budget）
 * ------------------------------------------------------------------ */

var CFG = window.__CONFIG__ || { levels: [], shapes: {}, coreMode: 'mock', sources: {} };
var LAY = CORE;
var W = (LAY && LAY.DESIGN_W) || 720;
var H = (LAY && LAY.DESIGN_H) || 1280;

/* ---------------- 视觉常量（配色以 02_美术源文件/风格圣经.md §2 的 hex 为准） ---------------- */
var COL = {
    bg0: '#0E1626',
    bg1: '#070B13',
    main: '#2EE59D',
    text: '#E8F1FF',
    sub: '#8FA3C0',
    fail: '#FF5A5A',
    ring: '#2BFFB0',
    ringLight: '#8FE9B0',
    gap: '#FFC44D',
    gold: '#FFD24D',
    goldInner: '#FFF3C4',
    moteGold: '#FFE9A8',
    moteMint: '#CFF7E4',
    ink: '#08111C',
    panel: '#14203A',
    line: '#22314E'
};
var GLOW = {
    inMs: 140,
    outMs: 260,
    peak: 0.22,
    color: '#2BFFB0'
};
var FONT = 'system-ui, "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
var HEAT_BAND_PX = 6; /** 热力图条带高度（设计像素）：绿=core 的交集矩形，红=并集−交集，同一条带网格 */

/* ---------------- 小工具 ---------------- */
function font(w, s) { return w + ' ' + s + 'px ' + FONT; }
function fmt(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function easeOut(x) { var t = clamp01(x); return 1 - (1 - t) * (1 - t); }

function roundRectPath(x, y, w, h, r) {
    var rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
}

function polyPath(pts) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
        else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.closePath();
}

function starPath(cx, cy, R, r, n) {
    ctx.beginPath();
    for (var i = 0; i < n * 2; i++) {
        var a = -Math.PI / 2 + (i * Math.PI) / n;
        var rad = i % 2 === 0 ? R : r;
        var px = cx + Math.cos(a) * rad;
        var py = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
}

/* ---------------- 画布与自适应（letterbox，DPR 感知） ---------------- */
var cv = document.getElementById('cv');
var ctx = cv.getContext('2d');
var view = { scale: 1, ox: 0, oy: 0, dpr: 1, w: 0, h: 0 };

function resize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = window.innerWidth || W;
    var h = window.innerHeight || H;
    view.w = w;
    view.h = h;
    view.dpr = dpr;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    var s = Math.min(w / W, h / H);
    view.scale = s;
    view.ox = (w - W * s) * 0.5;
    view.oy = (h - H * s) * 0.5;
    applyTransform();

    /**
     * 让文档至少和设计高度一样高（1280px）。
     * 原因：无头截图（--headless=new）的窗口 720×1280 里，viewport 只有 680×1149，
     * 文档若只有 viewport 高，截图底部那 131px 就落在文档外，被浏览器用「初始 base 色」填充，
     * 于是浅底场景会出现一条纯黑边。把 html/body 撑到 ≥1280 后，这条区域属于文档，
     * 会跟着 setBodyBg() 的场景色走。真机上 h≥1280 时 minHeight 不产生任何影响。
     */
    try {
        var mh = Math.max(h, H);
        document.documentElement.style.minHeight = mh + 'px';
        document.body.style.minHeight = mh + 'px';
    } catch (e) { /* 吃掉 */ }
}

function applyTransform() {
    var s = view.scale * view.dpr;
    ctx.setTransform(s, 0, 0, s, view.ox * view.dpr, view.oy * view.dpr);
}

/* ---------------- 时间基准（调试可冻结，保证截图可复现） ---------------- */
var timeFreeze = null;
function nowMs() { return timeFreeze === null ? performance.now() : timeFreeze; }

/* ---------------- 存档 ---------------- */
var SAVE_KEY = 'dista.progress';
function readProgress() {
    try {
        var raw = window.localStorage.getItem(SAVE_KEY);
        var o = raw ? JSON.parse(raw) : null;
        if (o && typeof o === 'object') {
            /* v0.9：cleared / godTotal 是收集系统的两个输入量（只增不减）。
               · cleared = 已通关的挑战关数。旧存档没有这个字段：unlocked 只表示"下一关"，
                 清完 L60 与停在 L60 都是 60，所以旧档按 unlocked≥60 视为已全通（宁多点亮、不少点亮）。
               · godTotal = 累计神级次数（挑战）。旧档只有单局最高 god，按它迁移。 */
            var unlocked = o.unlocked || 1;
            var cleared = (typeof o.cleared === 'number' && isFinite(o.cleared))
                ? Math.max(0, Math.min(60, o.cleared))
                : (unlocked >= 60 ? 60 : Math.max(0, unlocked - 1));
            return {
                unlocked: unlocked,
                bestScore: o.bestScore || 0,
                god: o.god || 0,
                cleared: cleared,
                godTotal: Math.max(0, o.godTotal || o.god || 0),
                /* v0.9.1：还没被玩家"看过详情"的新道具（NEW 点的持久状态）。只存 id，最多 36。 */
                newIds: (Object.prototype.toString.call(o.newIds) === '[object Array]')
                    ? o.newIds.filter(function (x) { return typeof x === 'string'; }).slice(0, 36)
                    : []
            };
        }
    } catch (e) { /* file:// 下 localStorage 可能被禁，静默降级 */ }
    return { unlocked: 1, bestScore: 0, god: 0, cleared: 0, godTotal: 0, newIds: [] };
}
function writeProgress() {
    try {
        window.localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
    } catch (e) { /* 同上 */ }
}
var progress = readProgress();

/* ---------------- 音频（规格 §0–§4；没有 AudioContext 也照常跑，见 A8） ---------------- */
var AUDIO = (typeof window !== 'undefined' && window.DISTA_AUDIO) || null;
var MUTE_KEY = 'dista.muted';
/** 静音开关：视觉 44×44、热区 88×88，位置/尺寸一律读 Layout（冻结件），别在这里另抄一份 */
var MUTE_BTN = (LAY && LAY.MUTE_BTN) || { x: 652, y: 44, size: 44, hit: 88 };

function readMuted() {
    try {
        return window.localStorage.getItem(MUTE_KEY) === '1';
    } catch (e) {
        return false; /* 默认开：用户要的就是音乐（§4） */
    }
}
function writeMuted(m) {
    try { window.localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (e) { /* 吃掉 */ }
}
function applyMuted() {
    if (!AUDIO) return;
    try { AUDIO.setMuted(readMuted()); } catch (e) { /* 吃掉 */ }
}
function toggleMute() {
    if (!AUDIO) return;
    var next = !AUDIO.isMuted();
    try { AUDIO.setMuted(next); } catch (e) { /* 吃掉 */ }
    writeMuted(next);
}

/** 只允许在用户手势里建上下文（§4 浏览器自动播放策略）；失败也必须能吃住（A8） */
function audioUnlock() {
    if (!AUDIO) return false;
    try {
        var ok = AUDIO.ensure();
        if (ok) {
            AUDIO.resume();
            /* v0.7 A3：起播那一刻就按场景定曲，别先听 25 秒 warm/minimal 再切。
               场景 id 在 startLevel → applySceneForLevel() 里已经定好（冷启动顺序：
               resolveSceneId() → startBgm(映射后的曲)），这里只把映射查出来。 */
            if (!AUDIO.model.playing) AUDIO.startBgm(bgmTrackForScene());
        }
        return ok;
    } catch (e) {
        return false;
    }
}

/** 飞行风声：越接近绿框越响；按下那一帧由 AUDIO.pressFrame() 硬切为 0（§2） */
function updateWhoosh() {
    if (!AUDIO) return;
    if (app.scene !== 'play') return;
    try {
        var d = 900;
        var movers = (app.rt && app.rt.movers) || [];
        for (var i = 0; i < movers.length; i++) {
            var pose = CORE.poseAt(movers[i], elapsed());
            var dx = pose.x - movers[i].targetCenter.x;
            var dy = pose.y - movers[i].targetCenter.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < d) d = dist;
        }
        AUDIO.setWhoosh(Math.max(0, Math.min(1, 1 - d / 520)));
    } catch (e) { /* 风声出错不许影响玩法 */ }
}

applyMuted();

/* ---------------- 数据（校验交给 core：单一真源，脏数据启动即报错） ---------------- */
var LOAD_ERRORS = [];
var LEVELS = [];
var SHAPES = {};

(function loadData() {
    var rawShapes = CFG.shapes;
    try {
        SHAPES = CORE.loadShapes(rawShapes);
    } catch (e) {
        LOAD_ERRORS.push('shapes.json 校验失败：' + (e && e.message ? e.message : e));
        var list = (rawShapes && rawShapes.shapes) || rawShapes || [];
        SHAPES = {};
        if (Object.prototype.toString.call(list) === '[object Array]') {
            for (var i = 0; i < list.length; i++) if (list[i] && list[i].id) SHAPES[list[i].id] = list[i];
        } else {
            SHAPES = list;
        }
    }
    try {
        LEVELS = CORE.loadLevels(CFG.levels);
    } catch (e) {
        LOAD_ERRORS.push('levels.json 校验失败：' + (e && e.message ? e.message : e));
        var lv = (CFG.levels && CFG.levels.levels) || CFG.levels || [];
        LEVELS = Object.prototype.toString.call(lv) === '[object Array]' ? lv : [];
    }
})();

/* ================================================================
 * v0.4：催眠 60 关（独立关卡表，前端直连 __CONFIG__.levelsRelax）
 * core 还没产 levels_relax.json 时，build 会临时解析 01_策划文档/levels_relax.csv 顶上；
 * 运行时先尝试 Core.loadLevels 校验，失败就用原始数组（buildLevel 本身容错）。
 * ================================================================ */
var RELAX_LEVELS = null;
(function () {
    var raw = CFG.levelsRelax || null;
    if (!raw) { RELAX_LEVELS = null; return; }
    try {
        RELAX_LEVELS = CORE.loadLevels(raw);
    } catch (e) {
        LOAD_ERRORS.push('levels_relax 校验失败（回退原始数组）：' + (e && e.message ? e.message : e));
        var lv = raw.levels || raw;
        RELAX_LEVELS = Object.prototype.toString.call(lv) === '[object Array]' ? lv : null;
    }
})();
if (!RELAX_LEVELS || !RELAX_LEVELS.length) RELAX_LEVELS = LEVELS;

var CORE_MODE = CFG.coreMode || 'mock';

/* ================================================================
 * v0.4：特效外置（assets/config/fx.json → build 同步 resources/ 并内联进产物）
 *   · rating 五档：rings / motes / breath / 环几何 / 粒子时长
 *   · seasonTint：四季的 accent / ring2 / ring3 —— **只作用于特效与文字**
 *   · levelIntro / seasonIntro / seasonEnd / breath
 * DEFAULT_FX 是 fx.json 缺失时的兜底，数值与 v0.3 的硬编码一致（S5 会因此变红，别依赖它）。
 * ================================================================ */
var DEFAULT_FX = {
    schema: 'dista.fx/1',
    rating: {
        god: { rings: 3, motes: 24, breath: true, bgWarmDeg: 8, energy: 138, ring: { alpha: 0.35, gapMs: 180, durMs: 900, w0: 3, spread: 1.9 }, moteStyle: { durMs: 1200, alpha: 0.5 } },
        perfect: { rings: 1, motes: 12, breath: false, energy: 48, ring: { alpha: 0.28, gapMs: 0, durMs: 600, w0: 3, spread: 1.6 }, moteStyle: { durMs: 900, alpha: 0.4 } },
        good: { rings: 0, motes: 0, breath: true, energy: 18, ring: { alpha: 0.3, gapMs: 0, durMs: 600, w0: 2.5, spread: 1.35 }, moteStyle: { durMs: 600, alpha: 0.3 } },
        ok: { rings: 1, motes: 0, breath: false, energy: 10, ringAlpha: 0.12, ring: { alpha: 0.12, gapMs: 0, durMs: 500, w0: 2, spread: 1.35 }, moteStyle: { durMs: 500, alpha: 0.2 } },
        fail: { rings: 0, motes: 0, breath: false, energy: 0, objectAlpha: 0.35, ring: { alpha: 0, gapMs: 0, durMs: 1, w0: 0, spread: 1 }, moteStyle: { durMs: 1, alpha: 0 } }
    },
    seasonTint: [
        { season: 1, accent: '#2BFFB0', ring2: '#8FE9B0', ring3: '#FFD24D', label: '第一季 · 初见' },
        { season: 2, accent: '#7FE8C4', ring2: '#B9F0D8', ring3: '#FFC44D', label: '第二季 · 起风' },
        { season: 3, accent: '#9FD8FF', ring2: '#C6E8FF', ring3: '#FFB86B', label: '第三季 · 失重' },
        { season: 4, accent: '#FFD24D', ring2: '#FFE9A8', ring3: '#FF8FA3', label: '第四季 · 定格' }
    ],
    levelIntro: { titleMs: 400, ease: 'easeOutCubic', yShift: 10, alpha: [0.25, 1] },
    seasonIntro: { labelMs: 600, holdMs: 900, ease: 'easeOutCubic' },
    seasonEnd: { breathSpeed: 1.5 },
    breath: { alphaMin: 0.35, alphaMax: 0.55, periodMs: 4000 },
    relaxStageHint: { everyN: 15, fadeMs: 2000 }
};
var FX = (CFG.fx && CFG.fx.rating) ? CFG.fx : DEFAULT_FX;
var LEVELS_PER_SEASON = 15;


/* ================================================================
 * v0.3 双模式（规格 20261018_v0.3_双模式改为时间限制.md）
 * 两个模式的判定/评分/星级/特效/音效/HUD **完全相同**；
 * 唯一差异 = 挑战模式每关限时 timeLimitMs（relax 为 null），以及 relax 打完 15 关循环。
 * ================================================================ */
var MODES = (CFG.modes && CFG.modes.relax && CFG.modes.challenge) ? CFG.modes : {
    challenge: {
        source: 'levels.json', timeLimitMs: 15000, bgmGain: 1.0, sfxGain: 1.0,
        ratingSfx: true, showScore: true, autoNext: true, loop: false, recordBest: true
    },
    relax: {
        /* 与 assets/resources/config/modes.json 的 relax.source 对齐（F2）：催眠读 levels_relax.json。
           原型本身直连 __CONFIG__.levelsRelax，不消费 source —— 这里只是缺失 modes.json 时的兜底文案。 */
        source: 'levels_relax.json', timeLimitMs: null, bgmGain: 1.0, sfxGain: 1.0,
        ratingSfx: true, showScore: true, autoNext: true, loop: true, recordBest: false
    }
};

/* ---------------- v0.2 三场景（规格 §2 / §5；美术 scenes.json 缺失时用内置占位） ---------------- */
var SCENE_KEY = 'dista.scene';
/** 场景切换图标：与静音并列（视觉 44 / 热区 88），y 与静音同排，横坐标在静音左侧 */
var SCENE_BTN = { x: 596, y: 44, size: 44, hit: 88 };

function normalizeScenes(raw) {
    var list = (raw && raw.scenes) || raw || [];
    var out = [];
    if (Object.prototype.toString.call(list) === '[object Array]') {
        for (var i = 0; i < list.length; i++) {
            var s = list[i];
            if (!s || !s.id) continue;
            out.push({
                id: s.id,
                name: s.name || s.id,
                bg: (s.bg && s.bg.length >= 2) ? s.bg : ['#0E1626', '#070B13'],
                layers: s.layers || [],
                allowed: s.allowed || ['relax', 'challenge']
            });
        }
    }
    if (!out.length) {
        out = [{ id: 'minimal', name: '极简纯净', bg: ['#141A24', '#0E1420'], layers: [{ k: 'dust', n: 16, alpha: [0.06], periodMs: 30000 }], allowed: ['relax', 'challenge'] }];
    }
    return out;
}
var SCENES = normalizeScenes(CFG.scenes);

function sceneById(id) {
    for (var i = 0; i < SCENES.length; i++) if (SCENES[i].id === id) return SCENES[i];
    return null;
}
/** 本地时间；?hour=N 可伪造（M5 断言用） */
function localHour() {
    if (DBG.hour !== undefined && DBG.hour !== '') {
        var h = parseInt(DBG.hour, 10);
        if (isFinite(h)) return ((h % 24) + 24) % 24;
    }
    try { return new Date().getHours(); } catch (e) { return 20; }
}
/** 07:00–18:59 → noon_window；19:00–06:59 → night_station；minimal 只允许手动 */
function autoSceneId() {
    var h = localHour();
    var want = (h >= 7 && h <= 18) ? 'noon_window' : 'night_station';
    return sceneById(want) ? want : (SCENES[0] && SCENES[0].id) || 'minimal';
}
function readScenePref() {
    try {
        var v = window.localStorage.getItem(SCENE_KEY);
        return v || 'auto';
    } catch (e) { return 'auto'; }
}
function writeScenePref(v) {
    try { window.localStorage.setItem(SCENE_KEY, v); } catch (e) { /* 吃掉 */ }
}
/** D-094：渲染期覆盖（瓶子卡 sceneId 用）。**只影响这一次渲染/这一张卡，不写 pref**。 */
var SCENE_OVERRIDE = null;
function setSceneOverride(id) {
    SCENE_OVERRIDE = (id && sceneById(id)) ? id : null;
    if (typeof app !== 'undefined' && app) app.sceneOverride = SCENE_OVERRIDE;
    return SCENE_OVERRIDE;
}
function clearSceneOverride() {
    SCENE_OVERRIDE = null;
    if (typeof app !== 'undefined' && app) app.sceneOverride = null;
}
function getSceneOverride() { return SCENE_OVERRIDE; }
/** 手动 pref > 自动；**渲染期覆盖优先于手动 pref**（D-099：看别人的瓶子卡就该看到那张卡的背景）。
 *  覆盖只活一关、不写 localStorage['dista.scene']，所以不会改掉玩家自己的设置。 */
function resolveSceneId() {
    if (SCENE_OVERRIDE && sceneById(SCENE_OVERRIDE)) return SCENE_OVERRIDE;
    var pref = readScenePref();
    if (pref && pref !== 'auto' && sceneById(pref)) return pref;
    return autoSceneId();
}

/* ---------------- 场景 → 曲目（v0.7 · A3 / D-075） ----------------
 * night_station → lofi（它的 mood 原文就是"候车场景"）
 * noon_window   → minimal（最干净、无噪声层，白天不抢注意力）
 * minimal       → ambient（弦乐垫 = "最远"，配极简的静态感）
 * 缺省（未知 scene / 没有 scenes.json）→ minimal：三轨里最稀的一轨。
 * 为什么默认不是 lofi：三轨里只有它带打击乐（每拍刷镲 0.8s 一个脉冲），
 * 在"卡时机"的玩法里可数的拍点会和物体周期抢锚点（D-075，音频规格 §1b）。 */
var BGM_BY_SCENE = { night_station: 'lofi', noon_window: 'minimal', minimal: 'ambient' };
function bgmTrackForScene(sceneId) {
    return BGM_BY_SCENE[sceneId || app.sceneId || resolveSceneId()] || 'minimal';
}

/**
 * 把曲目对齐到当前背景场景。**只在场景真的变了时才登记**（幂等）：
 * 这个函数每关都会被 applySceneForLevel() 调一次，不幂等的话每关都往 AUDIO 里塞一次 pending，
 * 换曲会被无限推迟（一个循环边界都走不到）。真正的切点由 audio.js 落在循环边界（A3-a）。
 */
function syncBgmToScene() {
    if (!AUDIO) return;
    if (app.bgmSceneId === app.sceneId) return;
    app.bgmSceneId = app.sceneId;
    try { AUDIO.setBgmTrack(bgmTrackForScene(app.sceneId)); } catch (e) { /* 吃掉 */ }
}

/** 只在关卡之间调用（避免判定帧背景突变） */
function applySceneForLevel() {
    app.sceneId = resolveSceneId();
    var s = sceneById(app.sceneId) || SCENES[0];
    if (s && s.allowed && s.allowed.indexOf(app.mode) < 0) {
        app.sceneId = autoSceneId();
    }
    /* D-077：silhouette 的 phaseBase='levelStart' 以此为零点。
       必须在这里写（场景真正生效的时刻），否则回退墙钟 → 截图 67% 概率拍到"没有台灯"的 minimal。 */
    app.sceneAppliedAtMs = nowMs();
    syncBgmToScene(); /* 场景定了曲目才跟着定（D-039：场景只在关卡之间变，所以玩家感知不到换曲） */
}
function sceneTheme() {
    var s = sceneById(app.sceneId) || SCENES[0];
    /* noon_window 是浅底：文字必须换深色，否则对比度不够 */
    var light = s && s.id === 'noon_window';
    return {
        bg: s ? s.bg : ['#0E1626', '#070B13'],
        light: !!light,
        text: light ? '#1B2B45' : COL.text,
        sub: light ? '#4A5568' : COL.sub,
        line: light ? 'rgba(27,43,69,0.18)' : 'rgba(232,241,255,0.10)'
    };
}

/**
 * 模式切音：D-047 —— 两模式音效参数完全相同，差异只有计时。
 * （modes.json 里 challenge/relax 的 bgmGain·sfxGain 都是 1.0、ratingSfx 都是 true；
 *   这个函数只是把配置值透给 AUDIO，不含任何"relax 要更轻"的判断——别在这里塞模式分支。）
 */
function applyModeAudio() {
    if (!AUDIO) return;
    var cfg = MODES[app.mode] || MODES.challenge;
    try {
        if (AUDIO.setBgmGain) AUDIO.setBgmGain(cfg.bgmGain);
        else if (AUDIO.model) AUDIO.model.bgmBase = cfg.bgmGain;
    } catch (e) { /* 吃掉 */ }
    try {
        if (AUDIO.setSfxGain) AUDIO.setSfxGain(cfg.sfxGain);
    } catch (e) { /* 吃掉 */ }
}

function modeCfg() { return MODES[app.mode] || MODES.challenge; }
function isRelax() { return app.mode === 'relax'; }

function shapeOf(id) {
    if (SHAPES[id]) return SHAPES[id];
    for (var k in SHAPES) if (Object.prototype.hasOwnProperty.call(SHAPES, k)) return SHAPES[k];
    return { id: 'fallback', name: '占位', size: 150, fill: '#8FA3BF', stroke: '#EAF2FF', pts: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }] };
}

/* ================================================================
 * v0.9 道具收集（mock 图鉴）· D-091/D-092/D-095/D-096/D-097
 *
 * 边界（三条硬约束，见 v0.9 §5）：
 *   ① 不参与 judge / stars / bestScore / 星级 / 连击——本段只读 progress 与 LEVELS；
 *   ② 不设每日任务（S35 会扫代码）；
 *   ③ 助眠零收集：无图鉴入口、无 collect_* 事件（S32）。
 *
 * 解锁状态是**纯函数**（cleared + godTotal → 已点亮集合），不额外存一份可漂移的解锁表：
 *   主线 = 已通关关卡的主物体去重（21 个）；
 *   稀有 = 累计神级次数 ≥ thresholds[i] 时点亮 rare[i]（15 个）。
 * 状态可重算 = 存档坏了也能自愈，断言也能直接喂合成存档（S30）。
 * ================================================================ */
var COLLECTION = (function normalizeCollection(raw) {
    var out = {
        thresholds: [], pools: { mainline: [], rare: [] }, order: [], items: {},
        rules: { collectInRelax: false, dailyTasks: false, affectsJudge: false },
        relaxCycle2: { fromRound: 2, stepPerRound: 12, orders: {} }
    };
    if (!raw || typeof raw !== 'object') return out;
    if (raw.thresholds && raw.thresholds.length) out.thresholds = raw.thresholds.slice();
    if (raw.pools) {
        out.pools.mainline = (raw.pools.mainline || []).slice();
        out.pools.rare = (raw.pools.rare || []).slice();
    }
    if (raw.order && raw.order.length) out.order = raw.order.slice();
    if (raw.items && typeof raw.items === 'object') out.items = raw.items;
    if (raw.rules) {
        out.rules.collectInRelax = !!raw.rules.collectInRelax;
        out.rules.dailyTasks = !!raw.rules.dailyTasks;
        out.rules.affectsJudge = !!raw.rules.affectsJudge;
    }
    if (raw.relaxCycle2) {
        out.relaxCycle2.fromRound = raw.relaxCycle2.fromRound || 2;
        out.relaxCycle2.stepPerRound = raw.relaxCycle2.stepPerRound || 12;
        out.relaxCycle2.orders = raw.relaxCycle2.orders || {};
    }
    return out;
})(CFG.collection);

/** 图鉴格子的展示顺序 = collection.json 的 order（主线按首次通关顺序，其后稀有按阈值顺序） */
function collectionItem(id) {
    var it = COLLECTION.items[id];
    if (it) return it;
    return { name: shapeOf(id).name, k: 0, band: '', source: 'main', rareIndex: -1, levelIds: [], firstLevel: 0, hint: '' };
}

/** 已通关的挑战关数（旧存档没有 cleared 时按 unlocked 推断） */
function clearedCount(src) {
    var p = src || progress;
    if (typeof p.cleared === 'number' && isFinite(p.cleared)) {
        return Math.max(0, Math.min(LEVELS.length, Math.floor(p.cleared)));
    }
    var u = p.unlocked || 1;
    return u >= LEVELS.length ? LEVELS.length : Math.max(0, u - 1);
}

function godTotalOf(src) {
    var p = src || progress;
    var g = Math.max(0, Math.floor(p.godTotal || 0));
    return isFinite(g) ? g : 0;
}

/**
 * 解锁状态（纯函数）。返回 map[id] = 'main' | 'rare'，以及计数与下一档阈值。
 * @param {{cleared?:number, unlocked?:number, godTotal?:number}} [src] 缺省读 progress
 */
function collectionState(src) {
    var p = src || progress;
    var cleared = clearedCount(p);
    var god = godTotalOf(p);
    var map = {};
    var main = [];
    for (var i = 0; i < cleared && i < LEVELS.length; i++) {
        var id = LEVELS[i] && LEVELS[i].shapeId;
        if (id && !map[id]) { map[id] = 'main'; main.push(id); }
    }
    var rare = [];
    for (var t = 0; t < COLLECTION.thresholds.length && t < COLLECTION.pools.rare.length; t++) {
        if (god >= COLLECTION.thresholds[t]) {
            var rid = COLLECTION.pools.rare[t];
            if (rid && !map[rid]) { map[rid] = 'rare'; rare.push(rid); }
        }
    }
    var nextAt = 0;
    for (var q = 0; q < COLLECTION.thresholds.length; q++) {
        if (god < COLLECTION.thresholds[q]) { nextAt = COLLECTION.thresholds[q]; break; }
    }
    return {
        cleared: cleared, godTotal: god, main: main, rare: rare, map: map,
        mainCount: main.length, rareCount: rare.length,
        unlockedCount: main.length + rare.length,
        total: COLLECTION.order.length || 36,
        nextRareAt: nextAt
    };
}

/** 解锁来源文案（图鉴详情用） */
function unlockLabel(id) {
    var it = collectionItem(id);
    if (it.source === 'rare') {
        var th = COLLECTION.thresholds[it.rareIndex];
        return '累计神级 ' + th + ' 次点亮';
    }
    return it.firstLevel ? '通关第 ' + it.firstLevel + ' 关点亮' : '通关主线点亮';
}

/** 解锁事件：只在挑战模式、且真的新增时上报（relax 不产生 collect_*，S32） */
function emitUnlockEvents(before, fb) {
    if (isRelax()) return [];
    var after = collectionState();
    var ids = [];
    for (var i = 0; i < COLLECTION.order.length; i++) {
        var id = COLLECTION.order[i];
        if (!after.map[id] || (before && before.map[id])) continue;
        ids.push(id);
        if (progress.newIds.indexOf(id) < 0) progress.newIds.push(id);
        var it = collectionItem(id);
        track('collect_unlock', {
            id: id, source: it.source, cleared: after.cleared, god_total: after.godTotal
        });
        if (it.source === 'rare') {
            track('rare_unlock', {
                id: id, threshold: COLLECTION.thresholds[it.rareIndex], god_total: after.godTotal
            });
        }
    }
    if (ids.length) {
        if (fb) fb.unlocks = ids;
        writeProgress(); /* newIds 要立刻落盘：玩家关掉页面也不丢 NEW 点 */
        track('unlock_card_shown', { ids: ids, count: ids.length });
    }
    return ids;
}

/** 看过详情 = 清掉这一件的 NEW（只清这一件） */
function markGallerySeen(id) {
    if (!id) return;
    var i = progress.newIds.indexOf(id);
    if (i >= 0) {
        progress.newIds.splice(i, 1);
        writeProgress();
    }
}

/* ---------------- 助眠第 2 圈：36 池轮换（D-093） ---------------- */
/** 当前场景的顺序表；场景无表时回落 minimal 表 */
function relaxOrderForScene(sceneId) {
    var orders = COLLECTION.relaxCycle2.orders || {};
    var sid = sceneId || resolveSceneId();
    var arr = orders[sid] || orders.minimal || [];
    return (arr && arr.length) ? arr : [];
}

/**
 * 第 2 圈起把一关的 shapeId/outlineId 换成 36 池里的下一个；其余字段一律照抄
 * （cycleMs/turns/path/passRate/variant 不动 = 不动难度阶梯，只换内容）。
 * 撞上该关第二件时顺延，避免同一关两个物体同形。
 */
function relaxRotatedDef(def, idx, round, sceneId) {
    if (!def) return def;
    var arr = relaxOrderForScene(sceneId);
    if (!arr.length) return def;
    var from = COLLECTION.relaxCycle2.fromRound || 2;
    var base = Math.max(0, (round || from) - from);
    var offset = base * (COLLECTION.relaxCycle2.stepPerRound || 12) + idx;
    var start = ((offset % arr.length) + arr.length) % arr.length;
    var pick = arr[start];
    var guard = 0;
    while (def.shapeId2 && pick === def.shapeId2 && guard < arr.length) {
        guard++;
        pick = arr[(start + guard) % arr.length];
    }
    if (!pick) return def;
    var out = {};
    for (var k in def) if (Object.prototype.hasOwnProperty.call(def, k)) out[k] = def[k];
    out.shapeId = pick;
    out.outlineId = pick;
    return out;
}

/** 给断言用：某场景第 N 圈的 60 关映射（只返回 shapeId/outlineId/shapeId2，便于独立核对） */
function relaxRotationForScene(sceneId, round) {
    var list = RELAX_LEVELS || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
        var d = relaxRotatedDef(list[i], i, round || 2, sceneId);
        out.push({ level: i + 1, shapeId: d.shapeId, outlineId: d.outlineId, shapeId2: d.shapeId2 || null });
    }
    return out;
}

/* ---------------- 应用状态 ---------------- */
var app = {
    scene: 'home', /* home | play | feedback | complete */
    mode: 'challenge', /* v0.2：challenge | relax */
    sceneId: null,     /* 当前背景场景 id（只在关卡之间切换） */
    bgmSceneId: null,  /* 上一次把 BGM 对齐到哪个场景（幂等用；见 syncBgmToScene） */
    sceneAppliedAtMs: 0, /* 场景生效时刻：silhouette 的 phaseBase='levelStart' 零点（D-077 §3.5.7） */
    relaxIdx: 0,       /* 历史字段（v0.2 无限流用），v0.3 起不再使用 */
    relaxCount: 0,
    relaxStreak: 0,
    lvlEnterAt: 0,     /* 进关时刻：关卡名 400ms 淡入上滑 */
    seasonShown: 0,    /* 已经展示过入场的赛季号（跨季才重放「第 N 季」） */
    seasonIntroAt: -1e9,
    /* v0.6 错拍关状态（同步关全程保持 phase='aim'→'result'，不新增任何可见变化） */
    phase: 'aim',      /* 'aim' 待定格 | 'frozen' 400ms 反馈中 | 'result' 已结算（S17 断言用） */
    frozen: null,      /* 每个 mover 是否已定格（true/false），错拍关才有意义 */
    desyncHintAt: null,/* 「这一关按两次」提示的起始时刻 */
    desyncResolve: null, /* 错拍关两次定格的结果累计 { first, second, worstRating } */
    /* v0.3：挑战模式限时 */
    timeLimitMs: null, /* 本关时限；relax = null */
    timerStart: null,  /* 计时起点 = 本关第一次物体进场 */
    timerStopAt: null, /* 面板出现即停表 */
    round: 1,          /* relax 轮次（打完 15 关 +1） */
    runStartAt: 0,     /* 本局开始时刻（通关页显示用时） */
    toast: null,       /* 轻提示：{text, until} */
    lvl: 0,
    def: null,
    rt: null,
    attempts: 3,
    combo: 0,
    levelScore: 0,
    totalScore: 0,
    godCount: 0,
    attemptStart: 0,
    freezeT: 0,
    fb: null,
    pressGlow: -1e9,
    homeStart: 0,
    complete: null,
    /* v0.7 分享（B1·D-080）：只存"点了之后有什么变化"，链接本身每次现算（见 shareLinkUrl） */
    shareCopiedAt: -1e9, /* 复制成功的时刻：按钮显示「链接已复制」1.6s，之后复原 */
    shareFailed: false,  /* 复制失败：链接以文本形式留在通关页上，不许"点了没反应" */
    shareUrl: '',        /* 失败时要显示的那行链接（成功/未点过时为空） */
    /* v0.9 道具收集（mock 图鉴） */
    galleryFrom: 'home', /* 从哪个画面进的图鉴（返回时回到那里） */
    gallerySel: null,    /* 图鉴里选中的道具 id（详情区） */
    galleryDetail: null, /* v0.9.1：全屏详情看的是哪一件（null = 分页大格总览） */
    galleryPage: 0,      /* v0.9.1：4×3 分页，当前页（0 基） */
    galleryStart: 0,     /* 进图鉴的时刻（剪影摆动的相位零点） */
    fbHeldAt: 0,         /* 进图鉴时结算面板的暂停时刻（返回时把面板时钟推后，别让 auto-next 偷跑） */
    sceneOverride: null  /* D-094：渲染期场景覆盖（瓶子卡用，不写 pref） */
};

function cycleMs() {
    var m = app.rt && app.rt.movers && app.rt.movers[0];
    return m ? m.cycleMs : 2000;
}
function elapsed() {
    var t = nowMs() - app.attemptStart;
    var c = cycleMs();
    return ((t % c) + c) % c;
}

/* ---------------- 关卡流程（v0.3：两模式判定/评分完全一致，唯一差异是挑战限时） ---------------- */
/**
 * 首页入口：mode='challenge' 每关限时 15s、15 关通关结算；mode='relax' 同样判定/计分，
 * 但没有倒计时，打完 15 关回到第 1 关循环。
 */
function startRun(modeName, fromLevel) {
    app.mode = (modeName === 'relax') ? 'relax' : 'challenge';
    app.totalScore = 0;
    app.godCount = 0;
    app.combo = 0;
    app.levelScore = 0;
    app.round = 1;
    app.runStartAt = nowMs();
    app.seasonShown = 0;      /* 新一局重新展示「第 1 季」 */
    app.seasonIntroAt = -1e9;
    applyModeAudio();
    hideShareTextOverlay(); /* 离开通关页就收起"复制失败"的那层可选文本，别让它悬在游戏画面上 */
    var i = typeof fromLevel === 'number' ? fromLevel : 0;
    i = Math.max(0, Math.min(LEVELS.length - 1, i));
    startLevel(i);
    audioUnlock(); /* §4：只有用户手势里才建 AudioContext + 起 BGM */
}

/** 本关时限（ms）：挑战 = modes.challenge.timeLimitMs，可被单关 timeLimitSec 覆盖；relax = null */
function levelTimeLimit(def) {
    var cfg = MODES[app.mode] || MODES.challenge;
    if (cfg.timeLimitMs === null || cfg.timeLimitMs === undefined) return null;
    if (def && def.timeLimitSec) return Math.round(def.timeLimitSec * 1000);
    return cfg.timeLimitMs;
}

/* ---------------- 关卡表 / 赛季辅助 ---------------- */

/** 当前模式的关卡表（挑战 60 / 催眠 60；催眠读 levelsRelax） */
function curLevels() { return (isRelax() && RELAX_LEVELS && RELAX_LEVELS.length) ? RELAX_LEVELS : LEVELS; }
/** 赛季号：优先读 def.season，缺省按 id 推导（每 15 关一季） */
function seasonOf(def) {
    if (!def) return 1;
    if (def.season) return def.season;
    return Math.max(1, Math.ceil((def.id || 1) / LEVELS_PER_SEASON));
}
/** 每季最后一关（15/30/45/60）→ 绿框呼吸加速 */
function isSeasonEndIdx(idx) { return ((idx + 1) % LEVELS_PER_SEASON) === 0; }
/** 季展示只在挑战模式（催眠不分季，只在 15/30/45/60 给「已完成 N 段」） */
function seasonUiOn() { return !isRelax(); }

function startLevel(i) {
    var list = curLevels();
    if (!list.length) { onErr(new Error('没有关卡数据：__CONFIG__.levels 为空')); return; }
    app.lvl = Math.max(0, Math.min(list.length - 1, i));
    /* D-093：助眠第 2 圈起按 36 池 + 场景顺序表换 shapeId/outlineId；第 1 圈用原表（S2/S3 不动）。
       只换内容、不换难度：cycleMs/turns/path/passRate/variant 全部照抄原关。
       注意：必须在 applySceneForLevel() 之后再换（顺序表按"这一关实际生效的场景"取）。 */
    app.def = list[app.lvl];
    app.attempts = app.def.attempts || 3;
    app.levelScore = 0;
    app.lvlEnterAt = nowMs(); /* 关卡名 400ms 淡入上滑（让"过关了"看得见） */
    app.timeLimitMs = levelTimeLimit(app.def);
    /* v0.4 季入场：「第 N 季」600ms 淡入（只在季首次进入时，跨季才触发） */
    var sea = seasonOf(app.def);
    if (seasonUiOn() && sea !== app.seasonShown) {
        app.seasonShown = sea;
        app.seasonIntroAt = nowMs();
    }
    applySceneForLevel(); /* 只在关卡之间换背景（D-039） */
    /* D-093：场景定下来之后再取这一关的顺序表（第 2 圈起 36 池轮换；第 1 圈用原表）。
       只换内容、不换难度：cycleMs/turns/path/passRate/variant 全部照抄原关（S36 逐字段核）。 */
    if (isRelax() && (app.round || 1) >= (COLLECTION.relaxCycle2.fromRound || 2)) {
        app.def = relaxRotatedDef(app.def, app.lvl, app.round);
    }
    try {
        app.rt = CORE.buildLevel(app.def, SHAPES, 1337 + app.lvl * 97);
    } catch (e) {
        onErr(e);
        return;
    }
    /* v0.6 错拍关：per-mover「已定格」标记（同步关保持 null，HUD/流程完全不受影响）。
       注意 beginAttempt() 会把 frozen 清成 null，所以必须在它之后重置。 */
    beginAttempt();
    if (isDesync()) {
        var n2 = (app.rt && app.rt.movers) ? app.rt.movers.length : 2;
        var fz2 = [];
        for (var k2 = 0; k2 < n2; k2++) fz2.push(false);
        app.frozen = fz2;
    }
}

function beginAttempt() {
    app.scene = 'play';
    app.fb = null;
    app.freezeT = 0;
    app.attemptStart = nowMs();
    /* 计时起点 = 本关第一次物体进场（不是进关那一帧）；重试即重置（M16） */
    app.timerStart = null;
    app.timerStopAt = null;
    /* v0.6 错拍关：每次尝试/重试都把"已定格"标记清零（S21 要求失败后两个 mover 全部重置） */
    app.phase = 'aim';
    app.frozen = null;
    app.desyncResolve = null;
}

function restartLevel() {
    app.attempts = app.def.attempts || 3;
    app.levelScore = 0;
    beginAttempt();
}

/** 已用时（毫秒）：面板出现即停表 */
function timerElapsed() {
    if (!app.timeLimitMs) return 0;
    if (app.timerStart == null) return 0;
    var end = (app.timerStopAt != null) ? app.timerStopAt : nowMs();
    return Math.max(0, end - app.timerStart);
}
function timerLeftMs() {
    if (!app.timeLimitMs) return null;
    return Math.max(0, app.timeLimitMs - timerElapsed());
}

/** 超时 = 本关失败：进结算、评级 fail、文案「时间到」、扣掉最后一次机会（M14/M15） */
function triggerTimeout() {
    if (app.scene !== 'play') return;
    var t = nowMs();
    app.timerStopAt = t;
    app.phase = 'result';
    /* 错拍关超时：已定格的半个状态也要清掉（不允许"一个已定格"残留到面板/重试） */
    app.frozen = null;
    app.desyncJudged = null;
    app.attempts = Math.max(0, app.attempts - 1);
    app.combo = 0;
    app.fb = {
        t0: t, pressMs: 0,
        res: {
            pct: 0, rating: 'fail', baseScore: 0, score: 0, pass: false, star3: false,
            timing: { deltaMs: 0, verdict: 'onTime' }, objects: []
        },
        elapsed: 0, revealed: false, settled: true, pass: false, stars: 0,
        attemptsLeft: app.attempts, tier: 'fail', sfxPlayed: true, timeout: true
    };
    app.scene = 'feedback';
    if (AUDIO && MODES[app.mode] && MODES[app.mode].ratingSfx) {
        try { AUDIO.playSfx('fail'); } catch (e) { /* 吃掉 */ }
    }
}

function nextLevel() {
    clearSceneOverride(); /* D-094：渲染期覆盖只活一关，关卡结束即失效 */
    var list = curLevels();
    var done = app.lvl + 1;
    /* 催眠：每 15 关给一次轻提示「已完成 N 段」（不分季展示） */
    if (isRelax() && (FX.relaxStageHint && FX.relaxStageHint.everyN || 15) && done % (FX.relaxStageHint.everyN || 15) === 0 && done < list.length) {
        showToast('已完成 ' + (done / (FX.relaxStageHint.everyN || 15)) + ' 段');
    }
    if (app.lvl + 1 < list.length) { startLevel(app.lvl + 1); return; }
    /* 最后一关之后：挑战 → 通关页；relax → 回到第 1 关继续（记轮次） */
    if (MODES[app.mode] && MODES[app.mode].loop) {
        showToast('第 ' + (app.round || 1) + ' 轮完成');
        app.round = (app.round || 1) + 1;
        startLevel(0);
        return;
    }
    showComplete();
}

function showToast(text) {
    app.toast = { text: text, until: nowMs() + 2000 };
}

function showComplete() {
    var t = nowMs();
    clearSceneOverride();
    app.scene = 'complete';
    var ms = Math.max(0, t - (app.runStartAt || t));
    /* 最高分只在挑战模式记录（relax 不参与，别让助眠玩家被分数绑架） */
    if (MODES[app.mode] && MODES[app.mode].recordBest) {
        progress.bestScore = Math.max(progress.bestScore || 0, app.totalScore);
    }
    progress.god = Math.max(progress.god || 0, app.godCount);
    progress.unlocked = Math.max(progress.unlocked || 1, LEVELS.length);
    writeProgress();
    app.complete = {
        score: app.totalScore,
        god: app.godCount,
        best: progress.bestScore || 0,
        ms: ms,
        timeText: Math.floor(ms / 60000) + ':' + ('0' + Math.floor((ms % 60000) / 1000)).slice(-2),
        /* v0.7 B1：文案末尾追加场景名（"· 深夜候车"），名字取 scenes.json 的 name */
        share: buildShareText(app.godCount, app.totalScore)
    };
    /* 进通关页时清掉上一次的复制结果，否则上一局的"链接已复制"会残留在这一局 */
    app.shareCopiedAt = -1e9;
    app.shareFailed = false;
    app.shareUrl = '';
}

function goHome() {
    app.scene = 'home';
    app.fb = null;
    app.homeStart = nowMs();
    app.mode = 'challenge';
    app.timeLimitMs = null;
    clearSceneOverride(); /* 回首页 = 一局结束，卡片覆盖不许带出来 */
    hideShareTextOverlay();
    applyModeAudio();
}

/* ---------------- 输入 ---------------- */
function inRect(x, y, r) {
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** 把屏幕坐标换算到设计坐标（letterbox）。
 *  ⚠️ clientX 是 **CSS 像素**；view.scale / view.ox / view.oy 也都是 CSS 像素。
 *  canvas 的 backing store 才乘 dpr（见 applyTransform）。这里**绝不能再除 dpr**——
 *  2026-10-20 实测：1440×900 @dpr2 上多除一次会把首页图鉴卡点到 (-260,44)，落进"点屏幕任意处=开局"。
 */
function toDesign(clientX, clientY) {
    return {
        x: (clientX - view.ox) / view.scale,
        y: (clientY - view.oy) / view.scale
    };
}

/** 首页按钮矩形（与 drawHome 用同一份常量）——v0.2：两个模式入口 + 挑战模式的「继续」 */
var HOME_BTN = {
    relax: { x: 180, y: 764, w: 360, h: 96 },      /* 催眠放松（主） */
    challenge: { x: 180, y: 876, w: 360, h: 84 },  /* 闯关挑战 */
    cont: { x: 206, y: 976, w: 308, h: 60 },       /* 继续 · 第 N 关（仅 challenge 有进度时） */
    start: { x: 180, y: 764, w: 360, h: 96 }       /* 兼容旧名 = relax */
};
/** 通关页「再玩一次」→ 回第 1 关（§5） */
var COMPLETE_BTN = { x: 200, y: 860, w: 320, h: 88 };
/**
 * 通关页「复制链接」（v0.7 B1·D-080）。放在「再玩一次」正下方：
 * 960 起、64 高，与下方"点其它任意处回首页"（1072）留 8px，复制失败的链接文本从 1112 起。
 */
var SHARE_BTN = { x: 180, y: 960, w: 360, h: 64 };

/** 静音热区（视觉 44、热区 88，居中） */
function muteHitRect() {
    var b = MUTE_BTN;
    var s = b.size || 44;
    var h = b.hit || 88;
    return { x: b.x + s / 2 - h / 2, y: b.y + s / 2 - h / 2, w: h, h: h };
}
function sceneHitRect() {
    var b = SCENE_BTN;
    var s = b.size || 44;
    var h = b.hit || 88;
    return { x: b.x + s / 2 - h / 2, y: b.y + s / 2 - h / 2, w: h, h: h };
}
/** relax HUD 的「退出」热区（视觉胶囊 88×44 @(24,136)，热区外扩成 88 高：expandRect 0,22）
 *  v0.9.1 修：原来的 (24,44) 88×88 视觉胶囊压在「第 N / 60 关」上，下移到关卡名/门数点下方。 */
var EXIT_BTN = { x: 24, y: 136, w: 88, h: 44 };
var SWAP_BTN = { x: 36, y: 1040, w: 168, h: 64 };

/**
 * 首页按钮矩形（与 drawHome 用同一份常量）。
 * v0.3：**主按钮 = 闯关挑战**（实心 mint，主位），次按钮 = 催眠放松（描边，次位）。
 * 理由：玩家的默认预期是"游戏会推进"，放松模式是少数派用法；主 CTA 必须给会推进的那条路。
 */
var HOME_BTN = {
    challenge: { x: 180, y: 748, w: 360, h: 96 },  /* 主：闯关挑战 · 15 关 */
    relax: { x: 180, y: 890, w: 360, h: 78 },      /* 次：催眠放松 · 无尽循环 */
    cont: { x: 206, y: 1012, w: 308, h: 52 },      /* 继续 · 第 N 关（仅 challenge 有进度时） */
    start: { x: 180, y: 748, w: 360, h: 96 }       /* 兼容旧名 = 主按钮（challenge） */
};
/** 每个按钮下方那行 24px 说明 */
var HOME_SUB = {
    challenge: { y: 870, text: '每关 15 秒，有星级与连击' },
    relax: { y: 992, text: '无倒计时，随时可停' }
};

/* ---------------- v0.9.1 图鉴入口（首页卡片 / 局内图标 / 结算按钮 / 通关页卡片；助眠全无） ---------------- */
var HOME_GALLERY_BTN = { x: 24, y: 44, w: 240, h: 88 };     /* 首页卡片：最近 3 个剪影 + 计数 */
var PLAY_GALLERY_BTN = { x: 24, y: 1166, w: 118, h: 44 };   /* 挑战局内左下胶囊：书本 + 「图鉴 数」（热区 162×88） */
var COMPLETE_GALLERY_BTN = { x: 24, y: 44, w: 200, h: 44 };  /* 通关页左上卡片 */
var PANEL_GALLERY_BTN = { x: 516, y: 894, w: 116, h: 34 }; /* 结算面板右上角，与居中标题水平错开 */
var UNLOCK_CARD_RECT = { x: 120, y: 812, w: 480, h: 56 };  /* v0.9.1 新图鉴卡（面板上方，D-105） */
var GALLERY_BACK = { x: 24, y: 44, w: 120, h: 44 };        /* 返回 / 返回列表共用（v0.9.1：96→120，四字不再挤） */
/* v0.9.1 用户拍板：4×3 分页大格（12 件/页，共 3 页）；点格子再进 240px 详情 */
var GALLERY_GRID = { cols: 4, rows: 3, perPage: 12, cw: 150, ch: 190, gx: 18, gy: 18, x0: 33, y0: 240 };
var GALLERY_PAGE_PREV = { x: 36, y: 924, w: 88, h: 64 };
var GALLERY_PAGE_NEXT = { x: 596, y: 924, w: 88, h: 64 };
/* 全屏详情：剪影 240px，左右翻页热区，底部信息三行 */
var GALLERY_BIG = { cx: 360, cy: 548, size: 240 };
var GALLERY_PREV = { x: 20, y: 488, w: 80, h: 120 };
var GALLERY_NEXT = { x: 620, y: 488, w: 80, h: 120 };

function galleryCellRect(slot) {
    var col = slot % GALLERY_GRID.cols;
    var row = Math.floor(slot / GALLERY_GRID.cols);
    return {
        x: GALLERY_GRID.x0 + col * (GALLERY_GRID.cw + GALLERY_GRID.gx),
        y: GALLERY_GRID.y0 + row * (GALLERY_GRID.ch + GALLERY_GRID.gy),
        w: GALLERY_GRID.cw, h: GALLERY_GRID.ch
    };
}
/** 总页数（36 / 12 = 3） */
function galleryPageCount() { return Math.max(1, Math.ceil(COLLECTION.order.length / GALLERY_GRID.perPage)); }
/** 某道具在哪一页（0 基） */
function galleryPageOf(id) {
    var i = COLLECTION.order.indexOf(id);
    return i < 0 ? 0 : Math.floor(i / GALLERY_GRID.perPage);
}

/** 热区外扩：视觉可以小，手不能要求准（项目既有惯例：图标视觉 44 / 热区 88） */
function expandRect(r, px, py) {
    var dx = px || 0, dy = py || 0;
    return { x: r.x - dx, y: r.y - dy, w: r.w + dx * 2, h: r.h + dy * 2 };
}
/** 首页图鉴卡片热区：卡片 240×88，热区 268×132 */
function homeGalleryHitRect() { return expandRect(HOME_GALLERY_BTN, 14, 22); }
/** 局内书本图标热区：视觉 118×44，热区 162×88（项目惯例：热区 88 高） */
function playGalleryHitRect() { return expandRect(PLAY_GALLERY_BTN, 22, 22); }
/** 助眠「退出」热区：视觉 88×44，热区 88 高（expandRect 0,22） */
function exitHitRect() { return expandRect(EXIT_BTN, 0, 22); }
/** 通关页卡片热区 */
function completeGalleryHitRect() { return expandRect(COMPLETE_GALLERY_BTN, 14, 22); }

/** 结算面板滑入位移（与 drawPanel 的 slide 同源）：面板 200ms 上滑 70px */
function panelSlidePx(fb) {
    var e = (fb && fb.elapsed) || 0;
    var dt = Math.max(0, e - LAY.FEEDBACK_MS.panel);
    return (1 - easeOut(dt / 200)) * 70;
}
/** 结算面板图鉴入口热区：外扩到 88 高 + 跟随滑入位移（动画中点到视觉位置也能进） */
function panelGalleryHitRect(fb) {
    var r = expandRect(PANEL_GALLERY_BTN, 14, 27);
    r.y += panelSlidePx(fb);
    return r;
}

/** 图鉴入口是否可见：助眠模式永远没有（v0.9 §4 硬条款） */
function galleryEntryVisible() { return !isRelax(); }

/** 打开图鉴。返回 false = 当前模式没有图鉴（relax）。 */
function openGallery(from) {
    if (!galleryEntryVisible()) return false;
    app.galleryFrom = from || app.scene || 'home';
    app.galleryStart = nowMs();
    app.gallerySel = app.gallerySel || null;
    app.galleryDetail = null;
    app.galleryPage = progress.newIds.length ? galleryPageOf(progress.newIds[0]) : 0;
    app.scene = 'gallery';
    if (app.galleryFrom === 'feedback') app.fbHeldAt = nowMs(); /* 面板时钟暂停，返回时补回来 */
    var st = collectionState();
    track('gallery_view', { from: app.galleryFrom, lit: st.unlockedCount, total: st.total });
    try { renderFrame(); } catch (e) { /* 吃掉 */ }
    return true;
}

/** 关闭图鉴：回到进来的那个画面；从结算面板进来的要把面板时钟补回去（别让 auto-next 偷跑） */
function closeGallery() {
    if (app.scene !== 'gallery') return;
    app.galleryDetail = null;
    var back = app.galleryFrom || 'home';
    if (back === 'feedback' && app.fb) {
        var held = Math.max(0, nowMs() - (app.fbHeldAt || nowMs()));
        app.fb.t0 += held;
        if (app.fb.resolveAt) app.fb.resolveAt += held;
    }
    app.scene = back;
    if (back === 'home') app.homeStart = nowMs();
    try { renderFrame(); } catch (e) { /* 吃掉 */ }
}

/** v0.9.1：打开某一件的全屏详情（看过 = 清掉这一件的 NEW，D-105） */
function openGalleryDetail(id) {
    if (!id || !collectionItem(id)) return false;
    app.galleryDetail = id;
    app.gallerySel = id;
    markGallerySeen(id);
    var st = collectionState();
    track('gallery_tile_tap', { id: id, unlocked: !!st.map[id], source: collectionItem(id).source });
    track('gallery_detail_view', { id: id, unlocked: !!st.map[id], source: collectionItem(id).source });
    try { renderFrame(); } catch (e) { /* 吃掉 */ }
    return true;
}

/** 详情里左右翻页（循环，不会翻到空） */
function stepGalleryDetail(dir) {
    var id = app.galleryDetail;
    if (!id) return false;
    var list = COLLECTION.order;
    var i = list.indexOf(id);
    if (i < 0) return false;
    var next = list[((i + (dir || 1)) % list.length + list.length) % list.length];
    return openGalleryDetail(next);
}

/** 循环切换场景（手动选择，存 localStorage，优先于自动） */
function cycleScene() {
    var cur = app.sceneId || resolveSceneId();
    var idx = -1;
    for (var i = 0; i < SCENES.length; i++) if (SCENES[i].id === cur) idx = i;
    var next = SCENES[(idx + 1) % SCENES.length];
    if (!next) return;
    writeScenePref(next.id);
    app.sceneId = next.id; /* 图标立刻反映；真正切背景在下一关（D-039） */
    /* 曲目也跟着登记 pending（切点仍在下一个循环边界，A3-a）：
       背景既然已经变成新场景，BGM 不该还停在旧曲上等下一关 —— 最多晚一个循环，不会硬切。 */
    syncBgmToScene();
}

function handlePressAt(dx, dy) {
    var t = nowMs();
    /* 浏览器只允许在用户手势里恢复音频。?start=N 试玩入口是"无手势直接开局"，
       所以第一次点击先把音频拉起来；正常从首页进入时这里已是 playing，等于 no-op。 */
    if (AUDIO) { try { audioUnlock(); } catch (e) { /* 吃掉 */ } }
    app.pressGlow = t;

    /* 静音 / 场景两个图标在所有画面都可用（不算玩法按钮） */
    if (inRect(dx, dy, muteHitRect())) {
        toggleMute();
        app.muteGlow = t;
        return;
    }
    if (inRect(dx, dy, sceneHitRect())) {
        cycleScene();
        app.sceneGlow = t;
        return;
    }

    if (app.scene === 'home') {
        /* v0.9：左上角图鉴入口（助眠没有入口，且 goHome 回挑战，所以这里恒可见） */
        if (galleryEntryVisible() && inRect(dx, dy, homeGalleryHitRect())) { openGallery('home'); return; }
        if (canContinue() && inRect(dx, dy, HOME_BTN.cont)) {
            startRun('challenge', (progress.unlocked || 1) - 1); /* 「继续 · 第 N 关」 */
            return;
        }
        if (inRect(dx, dy, HOME_BTN.challenge)) {
            startRun('challenge', 0); /* 主按钮：闯关挑战（永远第 1 关） */
            return;
        }
        if (inRect(dx, dy, HOME_BTN.relax)) {
            startRun('relax', 0); /* 次按钮：催眠放松 */
            return;
        }
        /* 画面其余处：走主按钮（会推进的那条路） */
        startRun('challenge', 0);
        return;
    }
    if (app.scene === 'complete') {
        if (inRect(dx, dy, COMPLETE_BTN)) { hideShareTextOverlay(); startRun('challenge', 0); return; } /* 「再玩一次」 */
        if (inRect(dx, dy, completeGalleryHitRect())) { openGallery('complete'); return; } /* v0.9.1 通关页图鉴 */
        /* v0.7 B1：复制链接。这里必须 return —— 否则"点复制"会顺带回首页（点了就跑，比没反应更糟） */
        if (inRect(dx, dy, SHARE_BTN)) { copyShareLink(); return; }
        hideShareTextOverlay();
        app.scene = 'home';
        app.homeStart = t;
        return;
    }
    if (app.scene === 'gallery') {
        if (app.galleryDetail) {
            if (inRect(dx, dy, GALLERY_BACK)) { app.galleryDetail = null; try { renderFrame(); } catch (e) { /* 吃掉 */ } return; }
            if (inRect(dx, dy, GALLERY_PREV)) { stepGalleryDetail(-1); return; }
            if (inRect(dx, dy, GALLERY_NEXT)) { stepGalleryDetail(1); return; }
            return;
        }
        if (inRect(dx, dy, GALLERY_BACK)) { closeGallery(); return; }
        var pageNow = Math.min(Math.max(0, app.galleryPage || 0), galleryPageCount() - 1);
        if (inRect(dx, dy, GALLERY_PAGE_PREV) && pageArrowEnabled(-1)) {
            app.galleryPage = pageNow - 1;
            try { renderFrame(); } catch (e) { /* 吃掉 */ }
            return;
        }
        if (inRect(dx, dy, GALLERY_PAGE_NEXT) && pageArrowEnabled(1)) {
            app.galleryPage = pageNow + 1;
            try { renderFrame(); } catch (e) { /* 吃掉 */ }
            return;
        }
        var startIdx2 = pageNow * GALLERY_GRID.perPage;
        for (var gi = 0; gi < GALLERY_GRID.perPage; gi++) {
            var gidx = startIdx2 + gi;
            if (gidx >= COLLECTION.order.length) break;
            if (!inRect(dx, dy, galleryCellRect(gi))) continue;
            openGalleryDetail(COLLECTION.order[gidx]);
            return;
        }
        return; /* 图鉴里点空白不做任何事（避免误触回上一屏） */
    }
    if (app.scene === 'play') {
        /* D-106：助眠局内「退出」与挑战局内「图鉴」都必须先于判定——否则点 UI 会被当成一次按下 */
        if (isRelax() && inRect(dx, dy, exitHitRect())) { goHome(); return; }
        if (!isRelax() && inRect(dx, dy, playGalleryHitRect())) { openGallery('play'); return; }
        doPress(t);
        return;
    }
    if (app.scene === 'feedback') {
        if (isRelax() && inRect(dx, dy, exitHitRect())) { goHome(); return; }
        /* v0.9：结算面板上的图鉴入口（只在面板已滑出后可点；助眠没有）。先于"重试"判断，
           否则失败且没次数时点这个位置会被当作"重试本关"。 */
        if (app.fb && app.fb.revealed && galleryEntryVisible() && inRect(dx, dy, panelGalleryHitRect(app.fb))) {
            openGallery('feedback');
            return;
        }
        if (app.fb && app.fb.revealed && !app.fb.pass && app.fb.attemptsLeft <= 0) {
            restartLevel(); /* 结算「重试本关」：同关卡号重来，不改进度 */
        }
    }
    /* 暂停/结算展示期间的其余点击一律丢弃（连点只取第一次） */
}

function canContinue() {
    return (progress.unlocked || 1) > 1 && LEVELS.length > 1;
}

function handlePress() {
    /* 无坐标（键盘/程序触发）→ 视作点主按钮 */
    handlePressAt(360, HOME_BTN.start.y + HOME_BTN.start.h / 2);
}

function pressMsAt(t) {
    var cyc = cycleMs();
    var raw = t - app.attemptStart;
    return ((raw % cyc) + cyc) % cyc; /* 归一化：任何情况下都落在 [0, cycleMs) */
}

/**
 * 第 idx 个 mover 的完美时刻（**关卡时间轴**里的 ms，含错拍的 offset）。
 * core 的 `moverTiming(mv).perfectMs` 已经是关卡时间；缺 API 时逐级回落。
 */
function moverPerfectMs(idx) {
    var mv = app.rt && app.rt.movers && app.rt.movers[idx];
    if (!mv) return 0;
    try {
        if (typeof CORE.moverTiming === 'function') {
            var tm = CORE.moverTiming(mv);
            if (tm && isFinite(tm.perfectMs)) return tm.perfectMs;
        }
    } catch (e) { /* 回落 */ }
    try {
        if (typeof CORE.perfectMsOf === 'function') {
            var v = CORE.perfectMsOf(mv);
            if (isFinite(v)) return v;
        }
    } catch (e2) { /* 回落 */ }
    if (mv.perfectMs !== undefined && isFinite(mv.perfectMs)) return mv.perfectMs;
    return (mv.cycleMs || 0) * 0.25;
}

/**
 * **当前时钟**下"第 idx 个 mover 恰好完美"的时刻。
 * 关键：错拍关解冻时 `attemptStart` 被推后了固定时长，所以后面的完美时刻必须加上这段偏移
 * （`attemptStart` 已经在里面，所以这里就是 `attemptStart + perfectMs`）。
 * 教训（2026-10-18）：测试若用"理论完美值"而不换算时钟，会把**正确实现**判成失败。
 */
function perfectPressClockMs(idx) {
    return app.attemptStart + moverPerfectMs(idx);
}

function doPress(t) {
    /* §2 铁律：按下这一帧，风声硬切为 0，并与 sfx_press 同帧（A5）。
       放在最前面，保证中间插不进任何别的音频操作。 */
    if (AUDIO) {
        try { AUDIO.pressFrame(); } catch (e) { /* 吃掉 */ }
    }
    /* v0.6 错拍关只走"两次定格"这一条路径。
       若 CORE 里没有 judgeNearest（例如 core 的 index.ts 漏了显式 export，build 不展开 export *），
       则**不处理这次按下**并大声警告——绝不用单次判定偷偷兜底：
       那会让错拍关"按一次就结算"，而现象看起来像正常，是最难查的一类假象。 */
    if (isDesync()) {
        if (typeof CORE.judgeNearest === 'function') { desyncPress(t); return; }
        drawFault('CORE.judgeNearest 未导出', '错拍关按下被忽略（不会用单次判定兜底）');
        return;
    }
    var pressMs = pressMsAt(t);
    var res = null;
    try {
        res = CORE.judge(app.rt, pressMs, app.combo);
    } catch (e) { onErr(e); return; }
    if (!res) return;
    app.freezeT = pressMs; /* 冻结当帧：不动，不隔帧 */
    app.phase = 'result';
    app.fb = {
        t0: t, pressMs: pressMs, res: res, elapsed: 0, revealed: false, settled: false,
        pass: false, stars: 0, attemptsLeft: app.attempts,
        tier: res.rating, sfxPlayed: false
    };
    app.scene = 'feedback';
}

/* ================================================================
 * v0.6 错拍关：一关按两次，每次定格"当前最接近绿框的那个物体"
 * 流程（规格 §2.2）：
 *   按下 → judgeNearest(skipIdx=已定格) → 该 mover 标记已定格 → 冻结 400ms 展示反馈
 *        → 还有未定格：解冻继续（**400ms 不吃时间轴**，见 desyncResumeFrozen）
 *        → 全部已定格：本关结算（评级取较差者、分数只算一次）
 *   任一 mover 不合格 → 本关失败：扣 1 次机会、两个 mover 全部重置（S21）
 * ================================================================ */
var DESYNC_FREEZE_MS = 400;

function desyncFrozenIdx() {
    var out = [];
    if (app.frozen) for (var i = 0; i < app.frozen.length; i++) if (app.frozen[i]) out.push(i);
    return out;
}
function desyncAllFrozen() {
    if (!app.frozen || !app.frozen.length) return false;
    for (var i = 0; i < app.frozen.length; i++) if (!app.frozen[i]) return false;
    return true;
}

function desyncPress(t) {
    var pressMs = pressMsAt(t);
    var skip = desyncFrozenIdx();
    var r = null;
    try {
        r = CORE.judgeNearest(app.rt, pressMs, skip, app.combo);
    } catch (e) { onErr(e); return; }
    if (!r) return; /* 全部已定格 → 防御性返回（正常流程不会走到这里） */

    if (!app.frozen) app.frozen = [];
    app.frozen[r.moverIndex] = true;
    if (!app.desyncJudged) app.desyncJudged = [];
    /* 同一个 mover 只记一次（S16 幂等：已定格的会被 skipIdx 排除，这里再兜一层） */
    var existed = false;
    for (var i = 0; i < app.desyncJudged.length; i++) if (app.desyncJudged[i].moverIndex === r.moverIndex) existed = true;
    if (!existed) app.desyncJudged.push({ moverIndex: r.moverIndex, pct: r.pct });

    app.freezeT = pressMs;
    app.desyncLast = r;
    app.phase = 'frozen';
    app.fb = {
        t0: t, pressMs: pressMs, res: r, elapsed: 0, revealed: false, settled: true,
        pass: false, stars: 0, attemptsLeft: app.attempts,
        tier: r.rating, sfxPlayed: true,
        desync: true, moverIndex: r.moverIndex,   /* 热力图只画这一个 mover */
        resolveAt: t + DESYNC_FREEZE_MS
    };
    app.scene = 'feedback';
    if (AUDIO && MODES[app.mode] && MODES[app.mode].ratingSfx) {
        try { AUDIO.playSfx(r.rating); } catch (e) { /* 吃掉 */ }
    }
}

/**
 * 400ms 冻结结束：
 *  · 还有未定格 → **把两把时间轴一起推后 400ms**（attemptStart/timerStart 各 +400），
 *    这样"计时没被吃掉"（timerElapsed 不变）且"运动相位没被吃掉"（attemptStart +400）——S19 两个量。
 *  · 全部已定格 → 本关结算（duoVerdict：评级取较差者、分数只算一次）。
 */
function desyncResolveFrozen() {
    var fb = app.fb;
    var paused = DESYNC_FREEZE_MS;
    if (!desyncAllFrozen()) {
        app.attemptStart += paused;                  /* 运动相位推后 */
        if (app.timerStart != null) app.timerStart += paused; /* 计时重置起点（S19 停表） */
        app.desyncPausedMs = (app.desyncPausedMs || 0) + paused;
        app.fb = null;
        app.phase = 'aim';
        app.scene = 'play';
        return;
    }
    finalizeDesync(fb);
}

function finalizeDesync(fb) {
    var dv = null;
    try {
        dv = CORE.duoVerdict(app.rt, app.desyncJudged || [], app.combo);
    } catch (e) { onErr(e); return; }
    var last = app.desyncLast || { timing: { deltaMs: 0, verdict: 'onTime' }, objects: [] };
    /* 结算面板用"最差那次"的口径，但热力图保留**最后一次**定格的那个 mover（分次展示，不叠两张） */
    fb.res = {
        pct: dv.worstPct,
        rating: dv.rating,
        baseScore: dv.baseScore,
        score: dv.score,
        pass: dv.pass,
        star3: dv.worstPct >= (app.def.star3Rate || 0.93) * 100,
        timing: last.timing,
        objects: last.objects || []
    };
    fb.tier = dv.rating;
    fb.pass = !!dv.pass;
    fb.settled = true;
    fb.revealed = true;
    fb.desyncDone = true;
    fb.moverIndex = last.moverIndex !== undefined ? last.moverIndex : null;
    app.phase = 'result';

    var r = fb.res;
    fb.stars = fb.pass ? starsFor(dv.worstPct, app.def) : 0;
    fb.gain = fb.pass ? (dv.score || 0) : 0;
    var collBefore = collectionState();
    if (fb.pass) {
        app.combo += 1;
        app.totalScore += fb.gain;
        app.levelScore += fb.gain;
        if (dv.rating === 'god') app.godCount += 1;
        if (!isRelax()) {
            progress.unlocked = Math.max(progress.unlocked || 1, Math.min(LEVELS.length, app.lvl + 2));
            progress.cleared = Math.max(progress.cleared || 0, Math.min(LEVELS.length, app.lvl + 1));
            if (dv.rating === 'god') progress.godTotal = godTotalOf() + 1;
            emitUnlockEvents(collBefore, fb);
        }
        writeProgress();
    } else {
        app.combo = 0;
        app.attempts = Math.max(0, app.attempts - 1);
    }
    fb.attemptsLeft = app.attempts;
    fb.combo = app.combo;
    fb.totalScore = app.totalScore;
    /* S21：失败后两个 mover 必须全部重置（不允许"一个已定格、一个重来"） */
    if (!fb.pass) {
        app.frozen = null;
        app.desyncJudged = null;
    }
    void r;
}

/* ---------------- 结算（只结算一次） ---------------- */
function starsFor(pct, def) {
    var pass = (def.passRate || 0.6) * 100;
    var s3 = (def.star3Rate || 0.93) * 100;
    if (pct >= s3) return 3;
    if (pct >= pass + (s3 - pass) * (LAY.STAR_SPLIT || 0.7)) return 2;
    if (pct >= pass) return 1;
    return 0;
}

/**
 * 星级：必须走 Core.starsOfResult（先按 pass 门控、再按平均 pct 分档）。
 * 直接用 starsOf(pct) 会在双物体关出现「平均很高但星级却亮着、实际没过」的矛盾。
 */
function starsForResult(rt, res) {
    if (typeof CORE.starsOfResult === 'function') {
        try {
            var s = CORE.starsOfResult(rt, res);
            if (typeof s === 'number') return s;
        } catch (e) { /* 回落 */ }
    }
    if (!res.pass) return 0;
    return starsFor(res.pct, (rt && rt.def) || app.def);
}

function settle(fb) {
    if (fb.settled) return;
    fb.settled = true;
    app.phase = 'result'; /* v0.6：结算后状态机进入 result（S17 用它区分"只定格 1 个"） */
    var r = fb.res;
    fb.pass = !!r.pass;
    fb.stars = starsForResult(app.rt, r);
    fb.gain = fb.pass ? r.score || 0 : 0;
    fb.tier = r.rating;
    var collBefore = collectionState(); /* 解锁事件用：结算前的点亮集合 */

    /* §2 特效音：按评级触发（god/perfect/good/ok/fail 五档，全部在五声音阶内）。
       触发时 BGM ×0.55、250ms 恢复 —— ducking 在 audio.js 里统一做。 */
    if (AUDIO && !fb.sfxPlayed) {
        fb.sfxPlayed = true;
        try { AUDIO.playSfx(r.rating); } catch (e) { /* 吃掉 */ }
    }

    if (fb.pass) {
        app.combo += 1;
        app.totalScore += fb.gain;
        app.levelScore += fb.gain;
        if (r.rating === 'god') app.godCount += 1;
        if (!isRelax()) {
            progress.unlocked = Math.max(progress.unlocked || 1, Math.min(LEVELS.length, app.lvl + 2));
            /* v0.9 收集：已通关关数 + 累计神级（只挑战）。两个量都只增不减。 */
            progress.cleared = Math.max(progress.cleared || 0, Math.min(LEVELS.length, app.lvl + 1));
            if (r.rating === 'god') progress.godTotal = godTotalOf() + 1;
        }
        /* 最高分**只在一处写**：showComplete() 里带 MODES[app.mode].recordBest 门控。
           这里以前裸写过一次 → relax 也能写进去（M20 抓到）。删掉，别再长回来。 */
        writeProgress();
        if (!isRelax()) emitUnlockEvents(collBefore, fb);
        fb.attemptsLeft = app.attempts;
    } else {
        app.combo = 0;
        app.attempts = Math.max(0, app.attempts - 1);
        fb.attemptsLeft = app.attempts;
    }
    fb.combo = app.combo;
    fb.totalScore = app.totalScore;
}

/* ---------------- 主循环 ---------------- */
function update() {
    /* 音频每帧推进：ducking 到期恢复 + 飞行风声随距离变化（按下那一帧会被硬切） */
    if (AUDIO) {
        try { AUDIO.tick(); } catch (e) { /* 吃掉 */ }
        updateWhoosh();
    }

    /* v0.3 倒计时：起点 = **物体中心第一次进入画面**那一帧（不是进 play、也不是 x>=0：
       arc_up / bounce_floor 是从画面下方进场的，x 早就 >0，只有"中心点进矩形"对 7 种路径都成立）。
       到点直接判超时失败。 */
    if (app.scene === 'play' && app.timeLimitMs) {
        if (app.timerStart == null) {
            var entered = false;
            try {
                var mv = (app.rt && app.rt.movers) || [];
                var tt = elapsed();
                for (var mi = 0; mi < mv.length; mi++) {
                    var pp = CORE.poseAt(mv[mi], tt);
                    if (pp.x >= 0 && pp.y >= 0 && pp.x <= W && pp.y <= H) { entered = true; break; }
                }
            } catch (e) { entered = false; }
            if (entered) app.timerStart = nowMs();
        }
        if (app.timerStart != null && timerLeftMs() <= 0) triggerTimeout();
    }

    if (app.scene !== 'feedback' || !app.fb) return;
    var fb = app.fb;

    /* v0.6 错拍关：400ms 冻结结束 → 要么解冻继续（时间轴推后 400ms），要么本关结算 */
    if (fb.desync && !fb.desyncDone && nowMs() >= fb.resolveAt) {
        desyncResolveFrozen();
        fb = app.fb;
        if (!fb || app.scene !== 'feedback') return; /* 解冻回到 play：本帧不再走结算逻辑 */
    }
    /* 仍处于 400ms 冻结展示中：只推进特效时钟，不结算、不弹面板 */
    if (fb.desync && !fb.desyncDone) {
        fb.elapsed = nowMs() - fb.t0;
        return;
    }

    var e = nowMs() - fb.t0;
    fb.elapsed = e;

    if (!fb.settled && e >= LAY.FEEDBACK_MS.heatmap) settle(fb);
    if (e >= LAY.FEEDBACK_MS.panel) {
        fb.revealed = true;
        if (app.timerStopAt == null && app.timeLimitMs) app.timerStopAt = fb.t0; /* 面板出现即停表 */
    }
    if (!fb.settled) return;

    if (fb.pass) {
        /* D-105：神级专属停留 1000→1800ms（只改 god；其它评级不动）——给"新图鉴卡"与三道环留出可感知时间 */
        var holdMs = feedbackHoldMs(fb.tier);
        if (e >= LAY.FEEDBACK_MS.panel + holdMs) nextLevel(); /* 通关后停留，再自动进下一关 */
    } else if (fb.attemptsLeft > 0) {
        if (e >= Math.max(LAY.RETRY_DELAY_MS, LAY.FEEDBACK_MS.panel + 300)) beginAttempt(); /* 失败自动重试 */
    }
}

/** v0.6 自测驱动：给 modes_check 的 S17/S19/S21 提供确定性数据（不依赖 rAF） */
function desyncSelftest() {
    var out = { afterFirst: {}, afterSecond: {}, freeze: {}, afterFail: {} };
    var list = curLevels();
    var dzIdx = -1;
    for (var i = 0; i < list.length; i++) if (desyncPhase(list[i]) > 0) { dzIdx = i; break; }
    if (dzIdx < 0 || typeof CORE.judgeNearest !== 'function') return out;

    var prevFreeze = timeFreeze;
    app.mode = 'challenge';
    /* ---- 第一次定格：钉在 mover0 的完美点 ---- */
    startLevel(dzIdx);
    app.attemptStart = 0;
    var t1 = perfectPressClockMs(0);
    timeFreeze = t1;
    desyncPress(t1);
    out.afterFirst.phase = app.phase;

    /* ---- 400ms 后解冻：两个量都要成立 ---- */
    var timerBefore = timerElapsed();
    var attBefore = app.attemptStart;
    timeFreeze = t1 + DESYNC_FREEZE_MS;
    update();
    out.freeze.timerBefore = timerBefore;
    out.freeze.timerAfter = timerElapsed();
    out.freeze.timerEqual = Math.abs(out.freeze.timerAfter - out.freeze.timerBefore) < 1e-6;
    out.freeze.attemptStartDelta = app.attemptStart - attBefore;

    /* ---- 第二次定格：**必须用换算后的时钟时刻**（attemptStart 已 +400） ---- */
    var t2 = perfectPressClockMs(1);
    timeFreeze = t2;
    desyncPress(t2);
    timeFreeze = t2 + DESYNC_FREEZE_MS;
    update();
    out.afterSecond.phase = app.phase;
    out.afterSecond.pass = !!(app.fb && app.fb.pass);
    /* 把"实际用的第二次时刻"和两个 mover 的完美值都带出来：
       自测里凡是用 || 兜底过时间，必须能一眼看出兜底有没有生效（2026-10-18 教训）。 */
    out.afterSecond.t2Used = t2;
    out.afterSecond.perfect0 = moverPerfectMs(0);
    out.afterSecond.perfect1 = moverPerfectMs(1);
    out.afterSecond.worstPct = (app.fb && app.fb.res && app.fb.res.pct) || 0;

    /* ---- S21：第二次**必然**不合格 → 两个 mover 全部重置 + 扣一次机会 ----
       配方（lead 2026-10-18 实测）：偏移量 = **mover1 自己的完美时刻 + 200ms**。
       · 不能半周期：h_line + passRate 0.70 下物体在另一端仍可能 ≥70% 重合（场景不成立）；
       · 不能 attemptStart+1：那一按落在起飞段，常常根本没进入可判定状态；
       · 200ms 安全：季 4 最宽的 mover 窗口只有 ±36ms，200 必然出窗；又 < cycle(≥1200) 不会跨周期。 */
    startLevel(dzIdx);
    app.attemptStart = 0;
    var attBeforeFail = app.attempts;
    timeFreeze = perfectPressClockMs(0);
    desyncPress(timeFreeze);
    timeFreeze = timeFreeze + DESYNC_FREEZE_MS;
    update();
    var far = app.attemptStart + moverPerfectMs(1) + 200;
    timeFreeze = far;
    desyncPress(far);
    timeFreeze = far + DESYNC_FREEZE_MS;
    update();
    out.afterFail.pass = !!(app.fb && app.fb.pass);
    out.afterFail.pct = (app.fb && app.fb.res && app.fb.res.pct) || 0;
    out.afterFail.failIsReal = out.afterFail.pass === false; /* 先证明"这次真的失败了" */
    out.afterFail.frozen = app.frozen;
    out.afterFail.attemptsDelta = attBeforeFail - app.attempts; /* 失败必须扣 1 次 */
    out.afterFail.allFrozenReset = (app.frozen === null) ||
        (app.frozen || []).every(function (v) { return v === false; });

    timeFreeze = prevFreeze;
    return out;
}

var rafId = 0;
var errCount = 0;
function loop() {
    try {
        update();
        renderFrame();
    } catch (e) {
        onErr(e);
    }
    if (errCount > 8) return;
    rafId = window.requestAnimationFrame(loop);
}

/* ---------------- 渲染 ---------------- */
var _lastBodyBg = null;
/**
 * 无头截图 / 真机都可能出现「画布高度 < 窗口高度」（Chromium 无头窗口含 chrome，
 * viewport 只有 680×1149，而 PNG 是 720×1280）。画布外那一条会露 body 底色 ——
 * 以前是 #060A12 的纯黑，在浅底场景上就是一条脏黑边。
 * 这里把 body/html 底色跟随当前场景，保证「窗口最底部 = 场景底色」，而不是黑。
 */
function setBodyBg(color) {
    if (color === _lastBodyBg) return;
    _lastBodyBg = color;
    try {
        if (document && document.body && document.body.style) document.body.style.background = color;
        if (document && document.documentElement && document.documentElement.style) document.documentElement.style.background = color;
    } catch (e) { /* 吃掉 */ }
}

function renderFrame() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.restore();
    applyTransform();

    /* 神级：背景色相 +8°（更暖），600ms 内淡入、900ms 后淡出 */
    app.bgWarm = 0;
    if (app.scene === 'feedback' && app.fb && app.fb.tier === 'god') {
        var e0 = app.fb.elapsed;
        app.bgWarm = 8 * clamp01(e0 / 200) * (1 - clamp01((e0 - 900) / 300));
    }
    /* 画布外（窗口底部/侧边）跟场景同色，避免浅底场景出现一条纯黑边 */
    var thBg = sceneTheme();
    setBodyBg(thBg.bg[1]);
    drawBg(app.bgWarm || 0);
    if (app.scene === 'home') drawHome();
    else if (app.scene === 'complete') drawComplete();
    else if (app.scene === 'gallery') drawGallery();
    else drawPlayLayers();
    drawWatermark();
    drawDiag();
}

function drawBg(warmDeg) {
    var th = sceneTheme();
    ctx.save();
    /* 神级：背景色相 +8°（更暖）。canvas filter 不可用时降级为极淡暖色叠层 */
    if (warmDeg) {
        if (supportsCtxFilter()) {
            ctx.filter = 'hue-rotate(' + warmDeg + 'deg) saturate(1.05)';
        } else {
            ctx.fillStyle = 'rgba(255,180,90,' + (0.03 * (warmDeg / 8)) + ')';
            ctx.fillRect(0, 0, W, H);
        }
    }
    var g = ctx.createLinearGradient(0, 0, W * 0.35, H);
    g.addColorStop(0, th.bg[0]);
    g.addColorStop(1, th.bg[1]);
    ctx.fillStyle = g;
    /* 覆盖整个画布（含 letterbox 留白），避免四周出现割裂的色带 */
    ctx.fillRect(-view.ox / view.scale, -view.oy / view.scale, view.w / view.scale, view.h / view.scale);

    /* 场景氛围层（≤3 层，周期 ≥14s，见规格 §2）；只换背景，不改绿框/物体。
       上限 3 是硬约束：night_station 正好用满 3 层（cloud/carLight/star），
       minimal 现在是 2 层（silhouette + dust），noon_window 2 层 —— 没有再塞第 4 层的余量，
       要加层必须先改这里再重过 worstAddPct 预算（D-077 §3.5.7 契约 ②）。 */
    drawSceneLayers(th);

    /* 目标区域的极淡底光（浅色场景会变脏，只在深色场景加） */
    if (!th.light) {
        var rg = ctx.createRadialGradient(360, 600, 20, 360, 600, 460);
        rg.addColorStop(0, 'rgba(43,255,176,0.08)');
        rg.addColorStop(1, 'rgba(43,255,176,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
}

/**
 * 三场景动态层。全部是 (t % period) 的确定性函数，周期取 JSON 里的 periodMs（≥14s），
 * 不引入任何随机，因此同一时刻的画面可复现（截图/回归）。
 */
/** 数值保险丝：任何非有限的绘制参数都退回默认值，并计一次故障（背景层绝不许拖垮整帧） */
function fin(v, dflt) {
    var n = typeof v === 'number' ? v : Number(v);
    return isFinite(n) ? n : dflt;
}
function drawFault(where, v) {
    app.drawFaults = (app.drawFaults || 0) + 1;
    if (!drawFault._warned) drawFault._warned = {};
    if (!drawFault._warned[where]) {
        drawFault._warned[where] = 1;
        if (window.console && window.console.warn) window.console.warn('[proto] 绘制参数非有限，已用默认值兜底：' + where + ' = ' + v);
    }
}

function drawSceneLayers(th) {
    var sc = sceneById(app.sceneId) || SCENES[0];
    if (!sc || !sc.layers) return;
    var t = fin(nowMs(), 0);
    if (!isFinite(nowMs())) drawFault('nowMs()', nowMs());
    for (var i = 0; i < sc.layers.length && i < 3; i++) {
        var L = sc.layers[i];
        if (!L || !L.k) continue;
        var per = Math.max(14000, fin(L.periodMs, 20000));
        var ph = (((t % per) + per) % per) / per; /* 0..1 */
        if (!isFinite(ph)) { drawFault('phase[' + L.k + ']', ph); ph = 0; }
        var n = Math.max(1, Math.min(24, Math.round(fin(L.n, 1))));
        var alphas = L.alpha;
        if (!(Object.prototype.toString.call(alphas) === '[object Array]')) alphas = [fin(alphas, 0.10)];
        var a = fin(alphas[0], 0.10);
        var k;
        if (L.k === 'cloud') {
            for (k = 0; k < n; k++) {
                var aa = fin(alphas[k], a);
                var x = -200 + ph * (W + 400) + k * 260;
                x = ((x % (W + 400)) + (W + 400)) % (W + 400) - 200;
                softEllipse(x, 300 + k * 180, 190, 62, 'rgba(210,230,255,' + aa + ')');
                softEllipse(x + 90, 330 + k * 180, 120, 46, 'rgba(210,230,255,' + (aa * 0.8) + ')');
            }
        } else if (L.k === 'carlight' || L.k === 'carLight') {
            var cx = -120 + ph * (W + 240);
            var lg = ctx.createLinearGradient(cx - 80, 0, cx + 80, 0);
            lg.addColorStop(0, 'rgba(255,214,140,0)');
            lg.addColorStop(0.5, 'rgba(255,214,140,' + a + ')');
            lg.addColorStop(1, 'rgba(255,214,140,0)');
            ctx.fillStyle = lg;
            ctx.fillRect(cx - 80, 812, 160, 3);
        } else if (L.k === 'stars' || L.k === 'star') {
            for (k = 0; k < n; k++) {
                var sx = 40 + ((k * 137) % (W - 80));
                var sy = 90 + ((k * 211) % 520);
                var tw = 0.6 + 0.4 * Math.sin(ph * Math.PI * 2 + k);
                ctx.fillStyle = 'rgba(232,241,255,' + (a * tw).toFixed(3) + ')';
                ctx.beginPath();
                ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (L.k === 'sunpatch' || L.k === 'windowSpot') {
            /* 美术的 scenes.json 用 windowSpot + rxPx/ryPx/yPct，这里一并吃下 */
            var rxs = Object.prototype.toString.call(L.rxPx) === '[object Array]' ? L.rxPx : [fin(L.rxPx, 150)];
            var rys = Object.prototype.toString.call(L.ryPx) === '[object Array]' ? L.ryPx : [fin(L.ryPx, 96)];
            var yps = Object.prototype.toString.call(L.yPct) === '[object Array]' ? L.yPct : [fin(L.yPct, 0.4)];
            for (k = 0; k < n; k++) {
                var pxx = 120 + k * 210 + Math.sin((ph + k * 0.2) * Math.PI * 2) * 26;
                var pyy = fin(yps[k], fin(yps[0], 0.4)) * H + Math.cos((ph + k * 0.2) * Math.PI * 2) * 18;
                softEllipse(pxx, pyy, fin(rxs[k], 150), fin(rys[k], 96), 'rgba(255,244,214,' + a + ')');
            }
        } else if (L.k === 'curtain') {
            /* 窗帘微动：只做一条两侧都柔化的竖带，振幅 1.2% 屏宽（硬边会在浅底上留一道缝） */
            var amp = W * (fin(L.amplitudePct, 1.2) / 100);
            var edge = W * (1 - fin(L.edgePct, 0.28)) + Math.sin(ph * Math.PI * 2) * amp;
            var cg = ctx.createLinearGradient(edge - 70, 0, edge + 40, 0);
            cg.addColorStop(0, 'rgba(255,255,255,0)');
            cg.addColorStop(0.55, 'rgba(255,255,255,' + a + ')');
            cg.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = cg;
            ctx.fillRect(edge - 70, 0, 110, H);
        } else if (L.k === 'dust') {
            for (k = 0; k < n; k++) {
                var dx = 40 + ((k * 173) % (W - 80));
                var dy = H - ((ph * H + k * 83) % (H + 120));
                ctx.fillStyle = 'rgba(232,241,255,' + a + ')';
                ctx.beginPath();
                ctx.arc(dx, dy, 1.8, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (L.k === 'silhouette') {
            /* D-077 第七种 k：具名静态剪影（原型/_src 侧本轮新加，此前落到链外 = 静默不画）。
               相位原点可以是"关卡开始"（phaseBase='levelStart'）—— 用 app.sceneAppliedAtMs 而不是墙钟，
               否则截图有 hiddenMs/periodMs（12/18 = 67%）概率拍到"没有台灯"的 minimal，C1-a 直接判死。
               其它取值沿用既有六种 k 的行为（绝对时刻 0 起算）。 */
            var origin = (L.phaseBase === 'levelStart') ? fin(app.sceneAppliedAtMs, 0) : 0;
            var age = t - origin;
            /* per 是本层循环顶部算好的周期（JSON 硬下限 14000），与 silAlpha 内部读的
               L.periodMs 同源，本文件里恒等；只有美术把 periodMs 写到 <14000 时才会分叉。 */
            var v = (((age % per) + per) % per);   /* 周期内位置 0..periodMs（负数也归到正区间） */
            if (!isFinite(v)) { drawFault('silhouette.age[' + L.k + ']', v); continue; }
            var a2 = silAlpha(v, L);
            if (a2 > 0.001) fillSilhouette(L, a2);  /* α≈0 时整段跳过：不画 = 0 draw call，也不弹故障 */
        }
    }
}

/**
 * silhouette 的透明度（0..alpha，四段式）：淡入 fadeInMs → 保持 → 淡出 fadeOutMs → 0。
 * 保持段长度用 visibleMs 减两段淡出入反推（不写死 4200）：美术改 visibleMs/fadeInMs 时不用改代码。
 * 缓动只用 easeInOutSine（relax 版禁止回弹）。
 * @param {number} v 周期内已过毫秒（0..periodMs）
 */
function silAlpha(v, L) {
    var peak = Math.max(0, fin(L.alpha, 0.07));
    var fadeIn = Math.max(0, fin(L.fadeInMs, 900));
    var fadeOut = Math.max(0, fin(L.fadeOutMs, 900));
    var visible = Math.max(0, fin(L.visibleMs, 6000));
    var period = Math.max(1, fin(L.periodMs, 18000));
    var hold = Math.max(0, visible - fadeIn - fadeOut);
    if (!(v >= 0) || v >= period) return 0;
    if (v < fadeIn) return peak * easeInOutSine(fadeIn > 0 ? v / fadeIn : 1);
    if (v < fadeIn + hold) return peak;
    if (v < visible) return peak * easeInOutSine(fadeOut > 0 ? (visible - v) / fadeOut : 1);
    return 0;
}

/** easeInOutSine：0→1 无回弹（钳到 0..1，避免脏数据把 α 推到负值/超峰值） */
function easeInOutSine(x) {
    var u = clamp01(fin(x, 0));
    return 0.5 - 0.5 * Math.cos(Math.PI * u);
}

/**
 * 画一个具名剪影：poly / rect / ellipse 全部追加到**同一个 path**，最后一次 nonzero 填充，
 * 不描边、不模糊、不加阴影（additive/描边会直接顶破 worstAddPct 18pp 的预算，见 D-077 §3.5.4）。
 * 归一化坐标（parts 内 0..1，y 向下）→ 包围盒 px：px = x0 + u*w，py = y0 + v*h。
 * **α 只乘一次**：烘进 fillStyle（rgba(...)），不再动 ctx.globalAlpha —— 两边都乘会变成 α²（0.0049 而不是 0.07）。
 * 只用 moveTo/lineTo/arc 三个原语：rect 手写四边、ellipse 靠 arc + 缩放，
 * 因为 tools/ 里的假 canvas（selfcheck_proto / proto_vm）没有 ctx.rect / ctx.ellipse，用了就会在 node 自测里抛。
 */
function fillSilhouette(L, a) {
    var parts = L.parts;
    if (Object.prototype.toString.call(parts) !== '[object Array]' || !parts.length) {
        drawFault('silhouette.parts', parts);
        return;
    }
    var w = fin(L.wPx, 210);
    var h = fin(L.hPx, 400);
    if (!(w > 0) || !(h > 0)) { drawFault('silhouette 包围盒', w + 'x' + h); return; }
    var x0 = fin(L.xPct, 0.5) * W - w / 2;
    var y0 = fin(L.yPct, 0.5) * H - h / 2;
    if (!isFinite(x0) || !isFinite(y0)) { drawFault('silhouette 中心', L.xPct + ',' + L.yPct); return; }
    var col = String(L.color || '');
    if (!/^#?[0-9a-fA-F]{6}$/.test(col)) { drawFault('silhouette.color', L.color); col = '#8FA6C4'; }
    ctx.save();
    ctx.fillStyle = rgba(col, Math.max(0, fin(a, 0)));
    ctx.beginPath();
    for (var i = 0; i < parts.length; i++) {
        var P = parts[i];
        if (!P || !P.t) continue;
        if (P.t === 'poly') {
            var pts = P.pts;
            if (Object.prototype.toString.call(pts) !== '[object Array]' || pts.length < 3) continue;
            var started = false;
            for (var j = 0; j < pts.length; j++) {
                var pj = pts[j];
                /* JSON 里是 [u, v] 二元数组。非二元数组的点直接跳过（别把脏数据当 (0,0) 画进去） */
                if (!pj || Object.prototype.toString.call(pj) !== '[object Array]') continue;
                var u = fin(pj[0], NaN);
                var vv = fin(pj[1], NaN);
                if (!isFinite(u) || !isFinite(vv)) continue;
                if (!started) { ctx.moveTo(x0 + u * w, y0 + vv * h); started = true; }
                else ctx.lineTo(x0 + u * w, y0 + vv * h);
            }
            if (started) ctx.closePath();
        } else if (P.t === 'rect') {
            /* 矩形手写 4 边；顺序与 poly 一致（屏幕坐标下顺时针）→ nonzero 填充时重叠区不会变洞 */
            var rx = x0 + fin(P.x, 0) * w, ry = y0 + fin(P.y, 0) * h;
            var rw = fin(P.w, 0) * w, rh = fin(P.h, 0) * h;
            if (!(rw > 0) || !(rh > 0)) continue;
            ctx.moveTo(rx, ry);
            ctx.lineTo(rx + rw, ry);
            ctx.lineTo(rx + rw, ry + rh);
            ctx.lineTo(rx, ry + rh);
            ctx.closePath();
        } else if (P.t === 'ellipse') {
            var erx = fin(P.rx, 0) * w, ery = fin(P.ry, 0) * h;
            if (!(erx > 0) || !(ery > 0)) continue;
            var ecx = x0 + fin(P.cx, 0.5) * w, ecy = y0 + fin(P.cy, 0.5) * h;
            ctx.save();
            ctx.translate(ecx, ecy);
            ctx.scale(1, ery / erx);            /* 只有 arc 原语：纵向压扁成椭圆 */
            ctx.moveTo(erx, 0);                 /* 先定位到弧起点，否则 arc 会从上一个子路径连一条线过来 */
            ctx.arc(0, 0, erx, 0, Math.PI * 2);
            ctx.closePath();
            ctx.restore();
        }
        /* 未知 t（美术加了新图元类型）：跳过不画，不抛错 —— 与未知 k 的既有行为一致 */
    }
    ctx.fill();
    if (fin(L.strokePx, 0) > 0) {
        /* 规格默认 0（纯剪影）。真给描边时也走同一 path，宽度按设计像素 */
        ctx.lineWidth = fin(L.strokePx, 0);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.stroke();
    }
    ctx.restore();
}

/** 柔边椭圆（径向渐变，无硬边）；参数非有限直接跳过并计一次故障 */
function softEllipse(cx0, cy0, rx, ry, color) {
    var x = fin(cx0, NaN), y = fin(cy0, NaN), ax = fin(rx, 0), ay = fin(ry, 0);
    if (!isFinite(x) || !isFinite(y)) { drawFault('softEllipse 中心', cx0 + ',' + cy0); return; }
    if (!(ax > 0) || !(ay > 0)) { drawFault('softEllipse 半径', rx + 'x' + ry); return; }
    var g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(ax, ay));
    g.addColorStop(0, color);
    g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ay / ax);
    ctx.translate(-x, -y);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, ax, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

var _filterOk = null;
function supportsCtxFilter() {
    if (_filterOk !== null) return _filterOk;
    _filterOk = false;
    try { _filterOk = typeof ctx.filter === 'string'; } catch (e) { _filterOk = false; }
    return _filterOk;
}

function drawWatermark() {
    if (CORE_MODE !== 'mock' && CFG.sources && CFG.sources.levels === 'core' && CFG.sources.shapes === 'core') return;
    ctx.save();
    ctx.font = font(600, 16);
    ctx.fillStyle = 'rgba(143,163,191,0.55)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('MOCK · core=' + CORE_MODE + ' · levels=' + ((CFG.sources && CFG.sources.levels) || '?') + ' · shapes=' + ((CFG.sources && CFG.sources.shapes) || '?'), 18, H - 14);
    ctx.restore();
}

/** 绿框「发光呼吸」：只改外发光 α——轮廓几何逐点不动（D-040）。
 *  v0.4：α 区间/周期读 fx.json 的 breath；季末关（15/30/45/60）按 seasonEnd.breathSpeed 加速（只改速度）。 */
function targetBreathAlpha() {
    var b = (FX && FX.breath) || { alphaMin: 0.35, alphaMax: 0.55, periodMs: 4000 };
    var period = b.periodMs || 4000;
    if (seasonUiOn() && isSeasonEndIdx(app.lvl)) {
        var sp = (FX && FX.seasonEnd && FX.seasonEnd.breathSpeed) || 1.5;
        period = Math.max(600, period / sp);
    }
    var ph = ((nowMs() % period) + period) % period;
    var mid = (b.alphaMin + b.alphaMax) / 2;
    var amp = (b.alphaMax - b.alphaMin) / 2;
    return mid - amp * Math.cos(2 * Math.PI * ph / period);
}

/** 绿框：6px #2BFFB0 描边（风格圣经 §3），8% 同色填充让「该套进哪里」一眼可见 */
function drawTarget(pts, strokeAlpha, strokeW) {
    var a = strokeAlpha === undefined ? 1 : strokeAlpha;
    var w = strokeW === undefined ? 6 : strokeW;
    ctx.save();
    polyPath(pts);
    ctx.fillStyle = 'rgba(43,255,176,0.08)';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(43,255,176,' + targetBreathAlpha().toFixed(3) + ')';
    ctx.shadowBlur = 14; /* ≤16，性能红线 */
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.strokeStyle = COL.ring;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1, w - 4.5);
    ctx.strokeStyle = 'rgba(232,241,255,0.42)';
    ctx.stroke();
    ctx.restore();
}

/* ================================================================
 * relax 反馈层（z 序锁死：背景 < 柔光 < 环 < 绿框 < 物体 < 粒子 < 热力图 < 面板）
 * 铁律：不做时间缩放（按下即冻结帧，世界里不存在慢动作），
 *       神级的「慢」只体现在特效时长：环 900ms、微尘 1.2s。
 * ================================================================ */

function easeInCubic(x) { var t = clamp01(x); return t * t * t; }
function lerp(a, b, p) { return a + (b - a) * p; }

/** v0.4：档位配置来自 fx.json（`FX.rating[tier]`），Layout.RATING_FX 只在缺字段时兜底 */
function ratingFx(tier) {
    var f = (FX && FX.rating && FX.rating[tier]) || null;
    var table = (LAY && LAY.RATING_FX) || null;
    var base = (table && table[tier]) || { rings: 0, motes: 0, breath: 0, energy: 0 };
    if (!f) return base;
    return {
        rings: f.rings !== undefined ? f.rings : base.rings,
        motes: f.motes !== undefined ? f.motes : base.motes,
        breath: f.breath !== undefined ? !!f.breath : base.breath,
        energy: f.energy !== undefined ? f.energy : base.energy
    };
}

/** §6.2 柔光呼吸：0→140ms 淡入（第 1 帧就有 ≈8%），140→400ms 淡出 */
function glowAlpha(e) {
    var inMs = (LAY.FEEDBACK_MS && LAY.FEEDBACK_MS.glowIn) || GLOW.inMs;
    var outMs = (LAY.FEEDBACK_MS && LAY.FEEDBACK_MS.glowOut) || GLOW.outMs;
    if (e < 0) return 0;
    if (e <= inMs) {
        var p = easeOut(e / inMs);
        return Math.max(0.08 * GLOW.peak / 0.22, GLOW.peak * p);
    }
    if (e <= inMs + outMs) return GLOW.peak * (1 - easeInCubic((e - inMs) / outMs));
    return 0;
}

function targetBBox(pts) {
    var b = localBounds(pts);
    return { w: b.maxX - b.minX, h: b.maxY - b.minY, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
}

/** R0 = 0.62 × 长边（规格：size 250 → R0≈155） */
function targetR0(pts) {
    var bb = targetBBox(pts);
    return Math.max(bb.w, bb.h) * 0.62;
}

function drawGlow(e) {
    var a = glowAlpha(e);
    if (a <= 0.004 || !app.rt) return;
    var movers = app.rt.movers || [];
    var dual = movers.length > 1;
    for (var i = 0; i < movers.length; i++) {
        var pts = movers[i].targetPts;
        var bb = targetBBox(pts);
        var R0 = targetR0(pts);
        var R = (dual ? 0.7 : 1.8) * R0;
        var peak = dual ? 0.15 : GLOW.peak;
        var k = peak > 0 ? a / GLOW.peak : 0;
        var g = ctx.createRadialGradient(bb.cx, bb.cy, 0, bb.cx, bb.cy, R);
        g.addColorStop(0, 'rgba(43,255,176,' + (peak * k).toFixed(3) + ')');
        g.addColorStop(0.55, 'rgba(43,255,176,' + (peak * 0.45 * k).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(43,255,176,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bb.cx, bb.cy, R, 0, Math.PI * 2);
        ctx.fill();
    }
}

/** v0.4：颜色取当前季的 seasonTint（accent→ring2→ring3，按**发出顺序**），数值取 fx.json */
/** 浅底场景里季主题色当文字会太淡（#7FE8C4 压 #EDE6D8 对比度不足）→ 混墨色压暗后再用 */
function mixHex(hex, targetHex, t) {
    var a = String(hex || '#2BFFB0').replace('#', '');
    var b = String(targetHex || '#101A26').replace('#', '');
    var out = [];
    for (var i = 0; i < 3; i++) {
        var va = parseInt(a.slice(i * 2, i * 2 + 2), 16);
        var vb = parseInt(b.slice(i * 2, i * 2 + 2), 16);
        if (!isFinite(va)) va = 43;
        if (!isFinite(vb)) vb = 16;
        out.push(Math.round(va + (vb - va) * t));
    }
    return 'rgb(' + out.join(',') + ')';
}
function tintText(accent, light) {
    return light ? mixHex(accent, '#0E1626', 0.55) : accent;
}

function seasonTintOf(season) {
    var list = (FX && FX.seasonTint) || [];
    /* 数字一律取整 + Number() 比较：json 里 season 若被写成 "3" 字符串，=== 会匹配失败 */
    var n = Number(season);
    if (!isFinite(n) || n < 1) n = 1;
    var s = Math.max(1, Math.min(list.length || 4, Math.round(n)));
    for (var i = 0; i < list.length; i++) {
        if (Number(list[i].season) === s) return list[i];
    }
    return list[s - 1] || { accent: '#2BFFB0', ring2: '#8FE9B0', ring3: '#FFD24D', label: '' };
}
/** 当前关卡所属赛季（判定以外的展示/特效统一从这里取） */
function curSeason() {
    return seasonOf(app.def);
}
function tintColors(season) {
    var t = seasonTintOf(season);
    return [t.accent, t.ring2, t.ring3];
}
function ringCfg(tier) {
    var f = (FX && FX.rating && FX.rating[tier]) || null;
    if (!f || !f.ring || !f.rings) return null;
    var cols = tintColors(curSeason());
    return {
        colors: cols.slice(0, Math.max(1, Math.min(3, f.rings))),
        alpha: f.ringAlpha !== undefined ? f.ringAlpha : f.ring.alpha,
        gap: f.ring.gapMs,
        dur: f.ring.durMs,
        w0: f.ring.w0,
        spread: f.ring.spread
    };
}
function moteCfg(tier) {
    var f = (FX && FX.rating && FX.rating[tier]) || null;
    if (!f || !f.moteStyle) return null;
    var cols = tintColors(curSeason());
    return {
        dur: f.moteStyle.durMs,
        colors: tier === 'god' ? [cols[2], cols[0]] : [cols[1]],
        colorMix: 0.7,
        alpha: f.moteStyle.alpha
    };
}

var RING_CFG = {
    /* 兜底（fx.json 缺失时用）；正常路径走 ringCfg(tier) */
    god: { colors: ['#2BFFB0', '#8FE9B0', '#FFD24D'], spread: 1.9, dur: 900, alpha: 0.35, w0: 3, gap: 180 },
    perfect: { colors: ['#2BFFB0'], spread: 1.6, dur: 600, alpha: 0.28, w0: 3, gap: 0 },
    ok: { colors: ['#2BFFB0'], spread: 1.35, dur: 500, alpha: 0.12, w0: 2, gap: 0 }
};

function drawRings(e, tier) {
    var cfg = ringCfg(tier) || RING_CFG[tier];
    if (!cfg || !app.rt) return;
    var movers = app.rt.movers || [];
    var dual = movers.length > 1;
    var trace = [];
    for (var r = 0; r < cfg.colors.length; r++) {
        var start = r * cfg.gap;
        var p = (e - start) / cfg.dur;
        if (p < 0 || p > 1) continue;
        var ep = easeOut(p);
        for (var i = 0; i < movers.length; i++) {
            var pts = movers[i].targetPts;
            var bb = targetBBox(pts);
            var R0 = targetR0(pts) * (dual ? 0.62 : 1);
            var R = lerp(R0, R0 * cfg.spread, ep);
            if (i === 0) trace.push(cfg.colors[r] + '@' + Math.round(R));
            ctx.save();
            ctx.globalAlpha = cfg.alpha * (1 - p);
            ctx.beginPath();
            ctx.arc(bb.cx, bb.cy, R, 0, Math.PI * 2);
            ctx.lineWidth = lerp(cfg.w0, 1, ep);
            ctx.strokeStyle = cfg.colors[r];
            ctx.stroke();
            ctx.restore();
        }
    }
    if (trace.length) app.diag = Object.assign(app.diag || {}, { rings: trace.join('  ') });
}

/** 沿轮廓周长均匀采样（粒子必须「从框的边缘渗出」，不是从外接圆冒烟） */
function perimeterPoints(pts, n) {
    var out = [];
    if (!pts || pts.length < 3 || n <= 0) return out;
    var total = 0;
    var i;
    for (i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length;
        total += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
    }
    if (total <= 1e-6) return out;
    for (var k = 0; k < n; k++) {
        var target = (k / n) * total;
        var acc = 0;
        for (i = 0; i < pts.length; i++) {
            var j2 = (i + 1) % pts.length;
            var dx = pts[j2].x - pts[i].x;
            var dy = pts[j2].y - pts[i].y;
            var seg = Math.hypot(dx, dy);
            if (acc + seg >= target || i === pts.length - 1) {
                var t = seg > 1e-9 ? (target - acc) / seg : 0;
                out.push({ x: pts[i].x + dx * t, y: pts[i].y + dy * t });
                break;
            }
            acc += seg;
        }
    }
    return out;
}

function hash01(i, salt) {
    var x = Math.sin((i + 1) * 12.9898 + (salt || 0) * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

var MOTE_CFG = {
    /* 兜底（fx.json 缺失时用）；正常路径走 moteCfg(tier) */
    god: { dur: 1200, colors: ['#FFE9A8', '#FFD24D'], colorMix: 0.7, alpha: 0.5 },
    perfect: { dur: 900, colors: ['#CFF7E4'], colorMix: 1, alpha: 0.4 }
};

function drawMotes(e, tier) {
    var cfg = moteCfg(tier) || MOTE_CFG[tier];
    var fx = ratingFx(tier);
    if (!cfg || !fx.motes || !app.rt) return;
    var p = e / cfg.dur;
    if (p < 0 || p > 1) return;
    var movers = app.rt.movers || [];
    var per = Math.ceil(fx.motes / Math.max(1, movers.length));
    for (var i = 0; i < movers.length; i++) {
        var pts = movers[i].targetPts;
        var seeds = perimeterPoints(pts, per);
        for (var k = 0; k < seeds.length; k++) {
            var idx = i * per + k;
            var r1 = hash01(idx, 1);
            var r2 = hash01(idx, 2);
            var r3 = hash01(idx, 3);
            /* 向上 33–58px/s → 1.2s 漂 40–70px；横向 ±6px 正弦，周期 700ms */
            var rise = lerp(40, 70, r1) * p;
            var sway = Math.sin((e / 700) * Math.PI * 2 + r2 * Math.PI * 2) * 6 * p;
            var x = seeds[k].x + sway;
            var y = seeds[k].y - rise;
            var a = cfg.alpha * (1 - p);
            if (a <= 0.01) continue;
            ctx.save();
            ctx.globalAlpha = a;
            ctx.fillStyle = (r3 < cfg.colorMix) ? cfg.colors[0] : cfg.colors[cfg.colors.length - 1];
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
}

/** 静音开关（§6.5）：44×44 视觉 / 88×88 热区 / 只改 α 不缩放不发光 */
function drawMuteButton() {
    var b = MUTE_BTN;
    var s = b.size || 44;
    var cx = b.x + s / 2;
    var cy = b.y + s / 2;
    var on = !(AUDIO && AUDIO.isMuted && AUDIO.isMuted());
    var hot = nowMs() - (app.muteGlow || -1e9) < 100;
    /* 浅底场景（noon_window）：图标走深色，否则一团灰看不清（lead 复核项） */
    var th = sceneTheme();
    var alpha = hot ? 0.85 : (th.light ? 0.55 : 0.4);
    var onColor = th.light ? '#1B2B45' : '#E8F1FF';
    var offColor = th.light ? '#4A5568' : '#8FA3C0';

    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = th.light ? '#1B2B45' : '#E8F1FF';
    ctx.beginPath();
    ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = on ? onColor : offColor;
    ctx.fillStyle = on ? onColor : offColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    /* 喇叭本体（24×24 居中） */
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy - 4);
    ctx.lineTo(cx - 6, cy - 4);
    ctx.lineTo(cx - 1, cy - 9);
    ctx.lineTo(cx - 1, cy + 9);
    ctx.lineTo(cx - 6, cy + 4);
    ctx.lineTo(cx - 11, cy + 4);
    ctx.closePath();
    ctx.fill();
    if (on) {
        ctx.beginPath();
        ctx.arc(cx - 1, cy, 6, -0.9, 0.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx - 1, cy, 10, -0.9, 0.9);
        ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.moveTo(cx + 1, cy - 8);
        ctx.lineTo(cx + 11, cy + 8);
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * 装饰绘制。注意：shapes.json 里 details 的 w 是**设计分辨率像素**，
 * 而这里已经 scale(k) 到局部单位（长边=1），所以线宽必须除以 k。
 */
function drawSceneButton() {
    var b = SCENE_BTN;
    var s = b.size || 44;
    var cx = b.x + s / 2;
    var cy = b.y + s / 2;
    var hot = nowMs() - (app.sceneGlow || -1e9) < 100;
    var th = sceneTheme();

    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = th.light ? '#1B2B45' : '#E8F1FF';
    ctx.beginPath();
    ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = hot ? 0.9 : (th.light ? 0.55 : 0.45);
    ctx.strokeStyle = th.text;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    /* 一扇窗 + 一轮日/月：白天是太阳，晚上是月亮 */
    ctx.strokeRect(cx - 11, cy - 9, 22, 18);
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy + 1);
    ctx.lineTo(cx + 11, cy + 1);
    ctx.stroke();
    var night = (app.sceneId || resolveSceneId()) === 'night_station';
    if (night) {
        ctx.beginPath();
        ctx.arc(cx + 5, cy - 3, 3.2, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.arc(cx + 5, cy - 3, 3.2, 0, Math.PI * 2);
        ctx.stroke();
        for (var i = 0; i < 4; i++) {
            var a = i * Math.PI / 2 + Math.PI / 4;
            ctx.beginPath();
            ctx.moveTo(cx + 5 + Math.cos(a) * 5, cy - 3 + Math.sin(a) * 5);
            ctx.lineTo(cx + 5 + Math.cos(a) * 6.5, cy - 3 + Math.sin(a) * 6.5);
            ctx.stroke();
        }
    }
    ctx.restore();
}

/**
 * 装饰绘制。注意：shapes.json 里 details 的 w 是**设计分辨率像素**，
 * 而这里已经 scale(k) 到局部单位（长边=1），所以线宽必须除以 k。
 */
function drawDetails(shape, k) {
    var px = k > 1e-6 ? 1 / k : 1;
    var ds = shape.details || [];
    for (var i = 0; i < ds.length; i++) {
        var d = ds[i];
        if (!d) continue;
        if ((d.k === 'line' || d.k === 'poly') && d.pts) {
            ctx.beginPath();
            for (var j = 0; j < d.pts.length; j++) {
                if (j === 0) ctx.moveTo(d.pts[j].x, d.pts[j].y);
                else ctx.lineTo(d.pts[j].x, d.pts[j].y);
            }
            if (d.k === 'poly') {
                ctx.closePath();
                ctx.fillStyle = d.color || '#08111C';
                ctx.fill();
            } else {
                ctx.lineWidth = Math.max(0.5 / k, (d.w || 2) * px);
                ctx.strokeStyle = d.color || '#08111C';
                ctx.lineCap = 'round';
                ctx.stroke();
            }
        } else if (d.k === 'circle' && d.c) {
            ctx.beginPath();
            ctx.arc(d.c.x, d.c.y, d.r || 0.05, 0, Math.PI * 2);
            if (d.filled) {
                ctx.fillStyle = d.color || '#08111C';
                ctx.fill();
            } else {
                ctx.lineWidth = Math.max(0.5 / k, (d.w || 2) * px);
                ctx.strokeStyle = d.color || '#08111C';
                ctx.stroke();
            }
        }
    }
}

function drawObject(shape, pose, scale) {
    var k = (shape.size || 160) * (scale || 1);
    if (!(k > 1)) k = 160;
    if (!isFinite(pose.x) || !isFinite(pose.y) || !isFinite(pose.rotDeg) || !isFinite(k)) {
        /* 非有限姿态 = 画不出来，一定要喊出来（否则就是「物体莫名消失」这种玄学 bug） */
        poseDiag('drawObject 非有限姿态 x=' + pose.x + ' y=' + pose.y + ' rot=' + pose.rotDeg + ' k=' + k);
        return;
    }
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate((pose.rotDeg || 0) * Math.PI / 180);
    ctx.scale(k, k);
    ctx.lineJoin = 'round';
    var lw = 2 / k; /* 深色描边 2px（设计分辨率） */
    polyPath(shape.pts);
    ctx.lineWidth = lw * 2;
    ctx.strokeStyle = COL.ink;
    ctx.stroke(); /* 先画更粗的深色外描边，保证与背景分离 */
    ctx.fillStyle = shape.fill || '#8FA3BF';
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = shape.stroke || COL.text;
    ctx.stroke();
    drawDetails(shape, k);
    ctx.restore();
}

/* ---------------- 首页（0 文字教学：直接演示一次定格） ---------------- */
var HOME_CYCLE = 2600;

function drawHome() {
    var t = nowMs() - app.homeStart;
    var u = (((t % HOME_CYCLE) + HOME_CYCLE) % HOME_CYCLE) / HOME_CYCLE;
    if (!isFinite(u)) u = 0.42; /* 兜底：任何时钟异常都不许让演示物体凭空消失 */

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    var th0 = sceneTheme();
    ctx.fillStyle = th0.text;
    ctx.font = font(800, 92);
    ctx.fillText('定格瞬间', 360, 236);

    ctx.font = font(500, 27);
    ctx.fillStyle = th0.sub;
    ctx.fillText('物体飞过，绿框不动。', 360, 300);
    ctx.fillText('重合的那一帧，按下暂停。', 360, 340);
    ctx.restore();

    /* 演示：物体从左飞到右，经过绿框那一瞬正好转正（与绿框同尺寸，一眼看出「要套进去」） */
    var demoShape = shapeOf('cup_tumbler');
    var demoSize = demoShape.size || 250;
    var cx = 360;
    var cy = 600;
    var targetPts = CORE.place(CORE.scaleLocal(demoShape.pts, demoSize), cx, cy, 0);
    drawTarget(targetPts, 1);

    var x = -160 + u * (W + 320);
    var rot = -180 + 360 * u;
    drawObject(demoShape, { x: x, y: cy, rotDeg: LAY.normDeg(rot) }, demoSize / demoShape.size);

    /* v0.3 首页主次对调：主 = 闯关挑战（实心），次 = 催眠放松（描边）；各自下方一行说明 */
    var th = sceneTheme();
    var pressed = nowMs() - app.pressGlow < 120;

    /* ── 主按钮：闯关挑战 · 15 关（实心 mint，阴影最重，唯一"会推进"的入口） ── */
    var bc = HOME_BTN.challenge;
    ctx.save();
    ctx.shadowColor = 'rgba(43,255,176,0.55)';
    ctx.shadowBlur = 16;
    roundRectPath(bc.x, bc.y, bc.w, bc.h, bc.h * 0.5);
    var bg1 = ctx.createLinearGradient(0, bc.y, 0, bc.y + bc.h);
    bg1.addColorStop(0, pressed ? '#9CFFD8' : '#2BFFB0');
    bg1.addColorStop(1, pressed ? '#5FE3AE' : '#17A97A');
    ctx.fillStyle = bg1;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#06251A';
    ctx.font = font(800, 38);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('闯关挑战 · 15 关', 360, bc.y + bc.h * 0.5);
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(500, 24);
    ctx.fillStyle = th.sub;
    ctx.fillText(HOME_SUB.challenge.text, 360, HOME_SUB.challenge.y);
    ctx.restore();

    /* ── 次按钮：催眠放松 · 无尽循环（描边 + 半透明，明显弱一档） ── */
    var br = HOME_BTN.relax;
    ctx.save();
    roundRectPath(br.x, br.y, br.w, br.h, br.h * 0.5);
    ctx.fillStyle = th.light ? 'rgba(27,43,69,0.05)' : 'rgba(43,255,176,0.07)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = th.light ? 'rgba(27,43,69,0.35)' : 'rgba(43,255,176,0.40)';
    ctx.stroke();
    ctx.fillStyle = th.text;
    ctx.font = font(600, 26);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('催眠放松 · 无尽循环', 360, br.y + br.h * 0.5);
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(500, 24);
    ctx.fillStyle = th.sub;
    ctx.fillText(HOME_SUB.relax.text, 360, HOME_SUB.relax.y);
    ctx.restore();

    if (canContinue()) {
        var c = HOME_BTN.cont;
        ctx.save();
        roundRectPath(c.x, c.y, c.w, c.h, c.h * 0.5);
        ctx.fillStyle = th.light ? 'rgba(27,43,69,0.06)' : 'rgba(232,241,255,0.07)';
        ctx.fill();
        ctx.fillStyle = th.sub;
        ctx.font = font(500, 21);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('继续 · 第 ' + Math.min(LEVELS.length, progress.unlocked || 1) + ' 关', 360, c.y + c.h * 0.54);
        ctx.restore();
    }

    drawMuteButton();
    drawSceneButton();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(500, 23);
    ctx.fillStyle = th.sub;
    var unlock = Math.max(1, Math.min(LEVELS.length || 15, progress.unlocked || 1));
    ctx.fillText('进度 ' + unlock + ' / ' + LEVELS.length + '　·　最高 ' + fmt(progress.bestScore) + ' 分', 360, 1104);
    ctx.font = font(500, 20);
    ctx.fillStyle = th.sub;
    ctx.fillText('屏幕任意处都能按 · 唯一按键：暂停', 360, 1138);
    ctx.restore();

    if (galleryEntryVisible()) drawHomeGalleryBtn();
}

/** 首页左上角的图鉴卡片（常驻；助眠模式不画，S32）。D-106：240×88，最近 3 件剪影 + 计数。 */
function drawHomeGalleryBtn() {
    var st = collectionState();
    var th = sceneTheme();
    var b = HOME_GALLERY_BTN;
    ctx.save();
    roundRectPath(b.x, b.y, b.w, b.h, 20);
    ctx.fillStyle = th.light ? 'rgba(27,43,69,0.06)' : 'rgba(232,241,255,0.07)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = th.light ? 'rgba(27,43,69,0.26)' : 'rgba(232,241,255,0.22)';
    ctx.stroke();
    /* 左边两行字 */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.sub;
    ctx.font = font(600, 18);
    ctx.fillText('图鉴', b.x + 16, b.y + 34);
    ctx.fillStyle = th.text;
    ctx.font = font(800, 26);
    ctx.fillText(st.unlockedCount + ' / ' + st.total, b.x + 16, b.y + 66);
    /* 右边三件最近获得的剪影（有 NEW 的排在前面）。v0.9.1 修：30→26px、间距 30→32、
       右对齐留 16px 内边距 —— 旧写法 cx = b.w-86+i*30 会让第 3 件中心落在 262（卡右沿 264），
       半个剪影压在卡片描边上。现在最右件右沿 = b.x+b.w-16，三件都完整在卡内。 */
    var ids = recentGalleryIds(3);
    var kg = 26, gap = 32, nIds = ids.length;
    for (var i = 0; i < nIds; i++) {
        var sh = shapeOf(ids[i]);
        var cx = b.x + b.w - 16 - kg / 2 - (nIds - 1 - i) * gap;
        var pts = CORE.place(CORE.scaleLocal(sh.pts, kg), cx, b.y + b.h * 0.5, 0);
        polyPath(pts);
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = sh.fill;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = sh.stroke;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
    if (progress.newIds.length) {
        ctx.beginPath();
        ctx.arc(b.x + b.w - 12, b.y + 12, 5, 0, Math.PI * 2);
        ctx.fillStyle = COL.gold;
        ctx.fill();
    }
    ctx.restore();
}

/** 最近获得的道具 id：NEW 优先，其次按图鉴顺序倒序（最多 n 个） */
function recentGalleryIds(n) {
    var st = collectionState();
    var out = [];
    var i;
    for (i = 0; i < progress.newIds.length && out.length < n; i++) {
        if (st.map[progress.newIds[i]] && out.indexOf(progress.newIds[i]) < 0) out.push(progress.newIds[i]);
    }
    for (i = COLLECTION.order.length - 1; i >= 0 && out.length < n; i--) {
        var id = COLLECTION.order[i];
        if (st.map[id] && out.indexOf(id) < 0) out.push(id);
    }
    return out.slice(0, n);
}

/** 挑战局内左下角的图鉴胶囊（书本 20px + 「图鉴 数」；视觉 118×44 / 热区 162×88；助眠不画）
 *  v0.9.1 修：44×44 纯图标辨识度太低（像电池/卡片），改成带字的胶囊；只在 play 画——
 *  结算/解锁卡出现时（feedback）左下角会被面板压住，且那条点击路径本来也不通。 */
function drawPlayGalleryBtn() {
    if (isRelax() || app.scene !== 'play') return;
    var b = PLAY_GALLERY_BTN;
    var th = sceneTheme();
    var st = collectionState();
    ctx.save();
    roundRectPath(b.x, b.y, b.w, b.h, b.h * 0.5);
    ctx.fillStyle = th.light ? 'rgba(27,43,69,0.06)' : 'rgba(232,241,255,0.07)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = th.light ? 'rgba(27,43,69,0.26)' : 'rgba(232,241,255,0.22)';
    ctx.stroke();
    /* 书本：两页 + 中缝，视觉宽 20px（cx 左侧 24px 处） */
    var cx = b.x + 24, cy = b.y + b.h * 0.5, hw = 10, hh = 7.5;
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy - hh + 1.5);
    ctx.quadraticCurveTo(cx - hw * 0.45, cy - hh - 0.5, cx, cy - hh + 2);
    ctx.quadraticCurveTo(cx + hw * 0.45, cy - hh - 0.5, cx + hw, cy - hh + 1.5);
    ctx.lineTo(cx + hw, cy + hh - 1);
    ctx.quadraticCurveTo(cx + hw * 0.45, cy + hh - 2.5, cx, cy + hh);
    ctx.quadraticCurveTo(cx - hw * 0.45, cy + hh - 2.5, cx - hw, cy + hh - 1);
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = th.sub;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh + 2);
    ctx.lineTo(cx, cy + hh);
    ctx.stroke();
    /* 文字：图鉴 + 计数（14px，左对齐在图标右侧 4px） */
    ctx.fillStyle = th.sub;
    ctx.font = font(600, 14);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('图鉴 ' + st.unlockedCount + '/' + st.total, b.x + 42, b.y + b.h * 0.54);
    if (progress.newIds.length) {
        ctx.beginPath();
        ctx.arc(b.x + b.w - 10, b.y + 9, 4, 0, Math.PI * 2);
        ctx.fillStyle = COL.gold;
        ctx.fill();
    }
    ctx.restore();
}

/** 助眠局内「退出」：可见胶囊（D-100 落地）。挑战模式不画（挑战的出口是关卡结算）。 */
function drawExitButton() {
    if (!isRelax()) return;
    var b = EXIT_BTN;
    var th = sceneTheme();
    ctx.save();
    roundRectPath(b.x, b.y, b.w, b.h, b.h * 0.5);
    ctx.fillStyle = th.light ? 'rgba(27,43,69,0.06)' : 'rgba(232,241,255,0.07)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = th.light ? 'rgba(27,43,69,0.26)' : 'rgba(232,241,255,0.22)';
    ctx.stroke();
    ctx.fillStyle = th.sub;
    ctx.font = font(600, 20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('退出', b.x + b.w / 2, b.y + b.h * 0.53);
    ctx.restore();
}

/** 通关页左上角的图鉴卡片（D-106） */function drawCompleteGalleryBtn() {
    var b = COMPLETE_GALLERY_BTN;
    var st = collectionState();
    var th = sceneTheme();
    ctx.save();
    roundRectPath(b.x, b.y, b.w, b.h, b.h * 0.5);
    ctx.fillStyle = th.light ? 'rgba(27,43,69,0.06)' : 'rgba(232,241,255,0.07)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = th.light ? 'rgba(27,43,69,0.26)' : 'rgba(232,241,255,0.22)';
    ctx.stroke();
    ctx.fillStyle = th.sub;
    ctx.font = font(600, 19);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('图鉴 ' + st.unlockedCount + ' / ' + st.total, b.x + b.w / 2, b.y + b.h * 0.54);
    if (progress.newIds.length) {
        ctx.beginPath();
        ctx.arc(b.x + b.w - 8, b.y + 8, 5, 0, Math.PI * 2);
        ctx.fillStyle = COL.gold;
        ctx.fill();
    }
    ctx.restore();
}

/* ---------------- v0.9 图鉴页（36 格；未点亮 = 灰色剪影 + ±15° 慢摆，不用锁图标） ---------------- */
function drawGallery() {
    var st = collectionState();
    var th = sceneTheme();
    var t = nowMs() - (app.galleryStart || nowMs());

    if (app.galleryDetail) { drawGalleryDetail(app.galleryDetail); return; }

    /* 返回 */
    var bk = GALLERY_BACK;
    ctx.save();
    roundRectPath(bk.x, bk.y, bk.w, bk.h, bk.h * 0.5);
    ctx.fillStyle = th.light ? 'rgba(27,43,69,0.06)' : 'rgba(232,241,255,0.07)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = th.light ? 'rgba(27,43,69,0.26)' : 'rgba(232,241,255,0.22)';
    ctx.stroke();
    ctx.fillStyle = th.sub;
    ctx.font = font(600, 20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('返回', bk.x + bk.w / 2, bk.y + bk.h * 0.53);
    ctx.restore();

    /* 顶栏两个全局图标（静音 / 换场景）在**所有**画面都要画：handlePressAt 里这两个热区是先于
       app.scene 分支判定的，图鉴里若只画不点/只点不画，就会出现"点右上角静音却没有任何视觉反馈"。
       图鉴是看图的画面，静音与换背景同样是合法操作。 */
    drawMuteButton();
    drawSceneButton();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.text;
    ctx.font = font(800, 42);
    ctx.fillText('道具图鉴', 360, 142);
    ctx.font = font(500, 22);
    ctx.fillStyle = th.sub;
    var pg = Math.min(Math.max(0, app.galleryPage || 0), galleryPageCount() - 1);
    ctx.fillText('已点亮 ' + st.unlockedCount + ' / ' + st.total + '　·　第 ' + (pg + 1) + ' / ' + galleryPageCount() + ' 页', 360, 188);
    ctx.restore();

    var startIdx = pg * GALLERY_GRID.perPage;
    for (var slot = 0; slot < GALLERY_GRID.perPage; slot++) {
        var i = startIdx + slot;
        if (i >= COLLECTION.order.length) break;
        var id = COLLECTION.order[i];
        if (!id) continue;
        var r = galleryCellRect(slot);
        var unlocked = !!st.map[id];
        var sel = app.gallerySel === id;
        ctx.save();
        roundRectPath(r.x, r.y, r.w, r.h, 18);
        ctx.fillStyle = th.light ? 'rgba(27,43,69,0.045)' : 'rgba(232,241,255,0.045)';
        ctx.fill();
        if (sel) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = COL.main;
            ctx.stroke();
        }
        var sh = shapeOf(id);
        /* 未点亮：灰色剪影 + ±15° 慢摆（v0.9 §3.2） */
        var rot = unlocked ? 0 : 15 * Math.sin((t / 4000) * Math.PI * 2 + i * 0.7);
        /* 100px 大格：pts 是 ±0.5 归一化坐标，直接给像素系数；旋转半展 50·(cos15+sin15)≈61 < 半格宽 75 */
        var k = 100;
        var cx = r.x + r.w / 2;
        var cy = r.y + 72;
        var pts = CORE.place(CORE.scaleLocal(sh.pts, k), cx, cy, isFinite(rot) ? rot : 0);
        polyPath(pts);
        ctx.globalAlpha = unlocked ? 1 : 0.9;
        ctx.fillStyle = unlocked ? sh.fill : (th.light ? 'rgba(27,43,69,0.22)' : 'rgba(232,241,255,0.16)');
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = unlocked ? sh.stroke : (th.light ? 'rgba(27,43,69,0.40)' : 'rgba(232,241,255,0.34)');
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (unlocked) {
            ctx.fillStyle = th.text;
            ctx.font = font(600, 20);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(collectionItem(id).name, cx, r.y + 162);
            ctx.fillStyle = th.sub;
            ctx.font = font(500, 14);
            ctx.fillText(collectionItem(id).band || '', cx, r.y + 181);
        }
        /* 稀有/主线小标记：右上角一个 6px 圆点（金=稀有，mint=主线；不让锁形泄密，只标已点亮的） */
        if (unlocked) {
            ctx.beginPath();
            ctx.arc(r.x + r.w - 14, r.y + 14, 4, 0, Math.PI * 2);
            ctx.fillStyle = collectionItem(id).source === 'rare' ? COL.gold : COL.main;
            ctx.fill();
        }
        /* NEW 点：没看过详情的解锁项（D-105） */
        if (progress.newIds.indexOf(id) >= 0) {
            ctx.beginPath();
            ctx.arc(r.x + r.w - 14, r.y + 30, 7, 0, Math.PI * 2);
            ctx.fillStyle = COL.gold;
            ctx.fill();
            ctx.fillStyle = '#3A2A00';
            ctx.font = font(800, 10);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('N', r.x + r.w - 14, r.y + 30);
        }
        ctx.restore();
    }

    /* 分页控件：左右箭头 + 页码；点格子进 240px 详情（D-107 用户拍板 4×3） */
    var pgN = galleryPageCount();
    drawPageArrow(GALLERY_PAGE_PREV, -1);
    drawPageArrow(GALLERY_PAGE_NEXT, 1);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = th.sub;
    ctx.font = font(600, 20);
    ctx.fillText((pg + 1) + ' / ' + pgN, 360, GALLERY_PAGE_PREV.y + 32);
    ctx.font = font(500, 16);
    ctx.fillText('点格子看大图 · 左右翻页', 360, 1040);
    ctx.restore();
}

/** 当前页在 dir 方向是否可翻（dir=-1 左 / +1 右）：第 0 页不能左、末页不能右（不循环）。
 *  v0.9.1：从 drawPageArrow 抽出来做**单一真源**——灰显（画）与"点了没反应"（handlePressAt）
 *  必须同源，否则会出现"箭头看着能点、点了没反应"或反之。断言（S42 硬门禁）也直接调这个。 */
function pageArrowEnabled(dir) {
    var pgN = galleryPageCount();
    var pg = Math.min(Math.max(0, app.galleryPage || 0), pgN - 1);
    return dir < 0 ? pg > 0 : pg < pgN - 1;
}

/** 分页箭头：到首页/末页时变灰且不可点（不循环，避免"翻回第 1 页却以为漏了"） */
function drawPageArrow(r, dir) {
    var th = sceneTheme();
    var enabled = pageArrowEnabled(dir);
    ctx.save();
    roundRectPath(r.x, r.y, r.w, r.h, r.h * 0.5);
    ctx.fillStyle = th.light ? 'rgba(27,43,69,0.06)' : 'rgba(232,241,255,0.07)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = th.light ? 'rgba(27,43,69,0.24)' : 'rgba(232,241,255,0.20)';
    ctx.stroke();
    ctx.beginPath();
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    /* 尖角必须朝**翻页方向**：dir=-1（上一页）指左、dir=+1（下一页）指右。
       写法：开口在 -dir 侧、尖点在 +dir 侧 → 端点 = cx - dir*hw，顶点 = cx + dir*hw。
       （v0.9.1 修：原写法两端反了，出现"左箭头指右、右箭头指左"。） */
    ctx.moveTo(cx - dir * 8, cy - 11);
    ctx.lineTo(cx + dir * 8, cy);
    ctx.lineTo(cx - dir * 8, cy + 11);
    ctx.lineWidth = 3;
    ctx.strokeStyle = enabled ? th.sub : (th.light ? 'rgba(27,43,69,0.18)' : 'rgba(232,241,255,0.16)');
    ctx.stroke();
    ctx.restore();
}

/** 详情标题：未解锁不泄露名字（S41 用） */
function galleryDetailTitle(id) {
    return collectionState().map[id] ? collectionItem(id).name : '未点亮';
}

/* ---------------- v0.9.1 图鉴详情：240px 大图 + 左右翻页（D-104） ---------------- */
function drawGalleryDetail(id) {
    var st = collectionState();
    var th = sceneTheme();
    var it = collectionItem(id);
    var unlocked = !!st.map[id];
    var t = nowMs() - (app.galleryStart || nowMs());
    var idx = COLLECTION.order.indexOf(id);

    /* 顶栏：返回列表 / 页码 / 全局图标 */
    var bk = GALLERY_BACK;
    ctx.save();
    roundRectPath(bk.x, bk.y, bk.w, bk.h, bk.h * 0.5);
    ctx.fillStyle = th.light ? 'rgba(27,43,69,0.06)' : 'rgba(232,241,255,0.07)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = th.light ? 'rgba(27,43,69,0.26)' : 'rgba(232,241,255,0.22)';
    ctx.stroke();
    ctx.fillStyle = th.sub;
    ctx.font = font(600, 20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('返回列表', bk.x + bk.w / 2, bk.y + bk.h * 0.53);
    ctx.restore();
    drawMuteButton();
    drawSceneButton();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.sub;
    ctx.font = font(500, 18);
    ctx.fillText((idx + 1) + ' / ' + st.total, 360, 72);

    /* 大剪影：解锁 = 完美姿态 + 缓慢呼吸（只改渲染缩放）；未解锁 = 灰剪影 ±15° 慢摆 */
    var sh = shapeOf(id);
    var rot = unlocked ? 0 : 15 * Math.sin((t / 4000) * Math.PI * 2 + idx * 0.7);
    var breathe = unlocked ? 1 + 0.015 * Math.sin((t / 4000) * Math.PI * 2) : 1;
    var size = GALLERY_BIG.size * breathe;
    var pts = CORE.place(CORE.scaleLocal(sh.pts, size), GALLERY_BIG.cx, GALLERY_BIG.cy, isFinite(rot) ? rot : 0);
    polyPath(pts);
    ctx.fillStyle = unlocked ? sh.fill : (th.light ? 'rgba(27,43,69,0.20)' : 'rgba(232,241,255,0.14)');
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = unlocked ? sh.stroke : (th.light ? 'rgba(27,43,69,0.42)' : 'rgba(232,241,255,0.34)');
    ctx.stroke();

    /* 名字 / 难度档 / 一句话 / 来源 */
    ctx.fillStyle = th.text;
    ctx.font = font(800, 38);
    ctx.fillText(galleryDetailTitle(id), 360, 748);    ctx.font = font(500, 19);
    ctx.fillStyle = th.sub;
    if (unlocked) {
        ctx.fillText((it.band || '') + (it.source === 'rare' ? '　·　稀有' : '　·　主线'), 360, 784);
        ctx.font = font(500, 19);
        wrapText(it.hint, 360, 824, 560, 28);
        ctx.fillStyle = th.sub;
        ctx.font = font(500, 17);
        ctx.fillText(unlockLabel(id), 360, 892);
    } else {
        ctx.fillText('回到挑战里把它卡进绿框，这里就会亮。', 360, 796);
        ctx.font = font(500, 17);
        ctx.fillStyle = 'rgba(143,163,191,0.75)';
        ctx.fillText('未点亮的剪影会慢慢摆——歪一点，就不给你满分。', 360, 840);
    }

    /* 左右翻页（循环）：画圆 + 三角；热区 80×120 */
    var chev = [
        { r: GALLERY_PREV, dir: -1, cx: GALLERY_PREV.x + GALLERY_PREV.w / 2, cy: 548 },
        { r: GALLERY_NEXT, dir: 1, cx: GALLERY_NEXT.x + GALLERY_NEXT.w / 2, cy: 548 }
    ];
    for (var c = 0; c < chev.length; c++) {
        var ch = chev[c];
        ctx.beginPath();
        ctx.arc(ch.cx, ch.cy, 26, 0, Math.PI * 2);
        ctx.fillStyle = th.light ? 'rgba(27,43,69,0.07)' : 'rgba(232,241,255,0.08)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = th.light ? 'rgba(27,43,69,0.25)' : 'rgba(232,241,255,0.22)';
        ctx.stroke();
        ctx.beginPath();
        /* 同 drawPageArrow：尖点朝翻页方向（prev 指左 / next 指右） */
        ctx.moveTo(ch.cx - ch.dir * 6, ch.cy - 9);
        ctx.lineTo(ch.cx + ch.dir * 6, ch.cy);
        ctx.lineTo(ch.cx - ch.dir * 6, ch.cy + 9);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = th.sub;
        ctx.stroke();
    }

    ctx.fillStyle = th.sub;
    ctx.font = font(500, 16);
    ctx.fillText('点左右翻看 · 返回列表', 360, 968);
    ctx.restore();
}


/** v0.6 错拍关判定：`phase_2`（或 `phase2`）> 0 即为错拍关；缺省/0 = 同步关，行为必须与 v0.5 逐位相同（S13/S20） */
function desyncPhase(def) {
    if (!def) return 0;
    var v = (def.phase2 !== undefined) ? def.phase2 : def.phase_2;
    var n = Number(v);
    return (isFinite(n) && n > 0) ? n : 0;
}
function isDesync() { return desyncPhase(app.def) > 0; }

function drawPlayLayers() {
    var fb = app.scene === 'feedback' ? app.fb : null;
    var e = fb ? fb.elapsed : 0;
    var tier = fb ? (fb.tier || 'ok') : '';
    var fx = tier ? ratingFx(tier) : null;

    drawHUD();
    drawTimer();                                             /* 只有挑战模式会画（relax timeLimit=null） */
    drawSeasonIntro();                                       /* 「第 N 季」600ms 淡入（仅挑战） */
    drawDesyncHud();                                         /* v0.6：只在错拍关画（同步关零像素变化，S20） */
    drawDesyncHint();                                        /* v0.6：本会话首次进错拍关的「这一关按两次」 */

    if (fb) drawGlow(e);                                    /* ① 柔光（绿框下方） */
    if (fb && fx && fx.rings > 0) drawRings(e, tier);        /* ② 评级环（绿框下方） */
    drawTargets(tier, e);                                    /* ③ 绿框 */
    drawObjects(tier, e);                                    /* ④ 物体 */
    if (fb && fx && fx.motes > 0) drawMotes(e, tier);        /* ⑤ 粒子（绿框上方） */
    if (fb) drawHeatmapLayer(fb, e);                         /* ⑥ 热力图（错拍关只画本次定格的那个 mover） */
    drawPauseButton();
    drawMuteButton();
    drawSceneButton();
    drawPlayGalleryBtn();                                   /* v0.9.1：挑战局内图鉴入口（左下，D-106） */
    drawExitButton();                                       /* D-100：助眠局内可见退出 */
    drawToast();
    if (fb && e >= LAY.FEEDBACK_MS.panel) {
        drawPanel(fb, e - LAY.FEEDBACK_MS.panel); /* ⑦ 面板 */
        drawUnlockCard(fb, e - LAY.FEEDBACK_MS.panel); /* ⑧ 新图鉴卡（面板上方，D-105） */
    }
}

/* ---------------- v0.6 错拍关的 HUD 与提示（同步关一个像素都不画） ---------------- */

/** 本会话是否已经给过「这一关按两次」提示（只在本会话第一次进错拍关时出现） */
var desyncHintShown = false;

/** 「还需定格 N 个」+ 两个小圆点（待定格=空心 / 已定格=实心）；同步关整块不画（S20） */
function drawDesyncHud() {
    if (!isDesync()) return;
    var th = sceneTheme();
    var total = Math.max(1, (app.rt && app.rt.movers) ? app.rt.movers.length : 2);
    var done = 0;
    for (var i = 0; i < total; i++) if (app.frozen && app.frozen[i]) done++;
    var left = Math.max(0, total - done);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(600, 21);
    ctx.fillStyle = th.sub;
    var label = left > 0 ? ('还需定格 ' + left + ' 个') : '全部定格';
    ctx.fillText(label, 36, 172);
    var lw = ctx.measureText(label).width;
    for (var k = 0; k < total; k++) {
        var cx0 = 36 + lw + 22 + k * 22;
        ctx.beginPath();
        ctx.arc(cx0, 165, 7, 0, Math.PI * 2);
        if (app.frozen && app.frozen[k]) {
            ctx.fillStyle = COL.main;
            ctx.fill();
        } else {
            ctx.lineWidth = 2;
            ctx.strokeStyle = th.light ? 'rgba(27,43,69,0.55)' : 'rgba(143,163,191,0.72)';
            ctx.stroke();
        }
    }
    ctx.restore();
}

/** 首次进错拍关：「这一关按两次」2 秒淡出（本会话只出现一次） */
function drawDesyncHint() {
    if (!isDesync()) return;
    if (!desyncHintShown) {
        desyncHintShown = true;
        app.desyncHintAt = nowMs();
    }
    var at = app.desyncHintAt;
    if (at == null || at < -1e8) return;
    var e = nowMs() - at;
    if (e < 0 || e > 2000) return;
    var a = 1 - clamp01((e - 1400) / 600);
    if (a <= 0.01) return;
    var th = sceneTheme();
    ctx.save();
    ctx.globalAlpha = 0.9 * a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(700, 26);
    ctx.fillStyle = th.text;
    ctx.fillText('这一关按两次', 360, 214);
    ctx.restore();
}

/**
 * v0.4 季入场：「第 N 季」labelMs(600) 淡入 + holdMs 停留 + 400ms 淡出。
 * 只画文字 + 季主题色，**不碰物体/绿框**（S6）。relax 模式整块不画（催眠不分季）。
 */
function drawSeasonIntro() {
    if (!seasonUiOn()) return;
    var at = app.seasonIntroAt;
    if (at == null || at < 0) return;
    var si = FX.seasonIntro || { labelMs: 600, holdMs: 900 };
    var e = nowMs() - at;
    var total = (si.labelMs || 600) + (si.holdMs || 0);
    if (e < 0 || e > total + 420) return;
    var aIn = clamp01(e / (si.labelMs || 600));
    var aOut = 1 - clamp01((e - total) / 420);
    var a = Math.min(aIn, aOut);
    if (a <= 0.01) return;
    var sea = seasonOf(app.def);
    var tint = seasonTintOf(sea);
    var y = 288 + (1 - easeOut(aIn)) * 14;
    var thI = sceneTheme();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.92 * a;
    ctx.font = font(800, 46);
    ctx.fillStyle = tintText(tint.accent, thI.light);   /* 浅底自动压暗，否则几乎看不见 */
    ctx.fillText('第 ' + sea + ' 季', 360, y);
    if (tint.label) {
        ctx.font = font(500, 21);
        ctx.fillStyle = sceneTheme().sub;
        ctx.globalAlpha = 0.72 * a;
        ctx.fillText(tint.label, 360, y + 46);
    }
    ctx.restore();
}

/** relax 打完一轮的轻提示：2 秒自动消失，不打断操作 */
function drawToast() {    if (!app.toast) return;
    if (nowMs() >= app.toast.until) { app.toast = null; return; }
    var th = sceneTheme();
    var left = app.toast.until - nowMs();
    var a = Math.min(1, left / 400);
    ctx.save();
    ctx.globalAlpha = 0.85 * a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(700, 30);
    ctx.fillStyle = th.text;
    ctx.fillText(app.toast.text, 360, 300);
    ctx.restore();
}

/**
 * v0.3 倒计时（**只有挑战模式画**；relax 连占位空白都没有，保证两模式 HUD 并排能对齐）：
 * 固定槽位：右对齐 x=640、基线 y=164（底边 ≤170，不越 y=190；与图标行间距 76px）。
 * ≤3000ms 切琥珀 #FFC44D，只改 α 呼吸（±0.28，周期 1s），**不动字号/基线**。
 */
function drawTimer() {
    if (!app.timeLimitMs) return;   /* relax：整个槽位不绘制 */
    var left = timerLeftMs();
    if (left == null) return;
    var th = sceneTheme();
    var low = left <= 3000;         /* 边界归属明确：正好 3000ms 仍算琥珀 */
    var a = low ? (0.72 + 0.28 * (0.5 - 0.5 * Math.cos(nowMs() / 500 * Math.PI))) : 1;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = a;
    ctx.fillStyle = low ? COL.gap : th.text;
    ctx.font = '700 26px ui-monospace, Consolas, "Courier New", monospace'; /* 等宽：数字不跳宽 */
    ctx.fillText((left / 1000).toFixed(1) + 's', 640, 164);
    ctx.restore();
}

/** 绿框：完美 = 6→7px 描边 300ms 后回 6px；不错 = 描边呼吸一次（α0.35→0.12→0.35，400ms） */
function drawTargets(tier, e) {
    if (!app.rt) return;
    var movers = app.rt.movers || [];
    for (var i = 0; i < movers.length; i++) {
        var w = 6;
        var a = 1;
        if (tier === 'perfect') {
            if (e < 150) w = lerp(6, 7, e / 150);
            else if (e < 300) w = lerp(7, 6, (e - 150) / 150);
            else w = 6;
        } else if (tier === 'good') {
            var p = clamp01(e / 400);
            var tri = p < 0.5 ? lerp(1, 0.34, p / 0.5) : lerp(0.34, 1, (p - 0.5) / 0.5);
            a = tri;
        }
        drawTarget(movers[i].targetPts, a, w);
    }
}

/** 物体：失败（含超时）时 α→0.65（200ms）；两模式一致 */
function drawObjects(tier, e) {
    if (!app.rt) return;
    var t = app.scene === 'feedback' ? app.freezeT : elapsed();
    var movers = app.rt.movers || [];
    var alpha = 1;
    if (tier === 'fail') alpha = lerp(1, 0.65, easeOut(clamp01(e / 200)));
    for (var i = 0; i < movers.length; i++) {
        var mv = movers[i];
        var pose;
        try {
            pose = CORE.poseAt(mv, t);
        } catch (err) {
            onErr(err);
            continue;
        }
        if (pose.x < -320 || pose.x > W + 320 || pose.y < 20 || pose.y > H - 20) continue;
        /* 绘制缩放必须与 objectPtsAt 同源：否则「看到的」≠「判到的」 */
        var sc = objectDrawScale(mv);
        if (i === 0) app.diag = Object.assign(app.diag || {}, { t: t, u: CORE.uAt ? CORE.uAt(mv, t) : 0, x: pose.x, y: pose.y, rot: pose.rotDeg, k: mv.shape.size * sc });
        ctx.save();
        ctx.globalAlpha = alpha;
        drawObject(mv.shape, pose, sc);
        ctx.restore();
    }
}

/**
 * 物体相对自身 shape.size 的缩放：双车道 0.62 之类由 core 反推，绘制与判定共用。
 * 注意：名字不能叫 objectScaleOf —— core/Paths.ts 里已有同名顶层函数，同作用域拼接会互相覆盖。
 */
function objectDrawScale(mover) {
    if (typeof CORE.objectScaleOf === 'function') {
        try {
            var k = CORE.objectScaleOf(mover);
            if (k > 0 && isFinite(k)) return k;
        } catch (e) { /* 回落 */ }
    }
    if (mover && mover.shape && mover.shape.size && mover.targetArea) {
        var unit = CORE.polyArea(mover.shape.pts);
        if (unit > 1e-9) return Math.sqrt(mover.targetArea / (unit * mover.shape.size * mover.shape.size));
    }
    return (mover && mover.scale) || 1;
}

function drawHUD() {
    if (!app.def) return;
    /* v0.3：两模式 HUD 完全相同（关卡/次数/连击/分数），唯一差异是右上角的倒计时 */
    var th = sceneTheme();
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(800, 34);
    ctx.fillStyle = th.text;
    var list = curLevels();
    var lvText = '第 ' + (app.lvl + 1) + ' / ' + list.length + ' 关';
    ctx.fillText(lvText, 36, 96);
    /* 季标识（只在挑战模式）：紧跟在关卡号后面，小一号，不加分隔线 */
    if (seasonUiOn()) {
        var lw = ctx.measureText(lvText).width;
        var sea = seasonOf(app.def);
        var tint = seasonTintOf(sea);
        ctx.font = font(700, 20);
        ctx.fillStyle = tintText(tint.accent, th.light);   /* 浅底自动压暗 */
        ctx.fillText('第 ' + sea + ' 季', 36 + lw + 14, 96);
    }

    ctx.font = font(500, 25);
    ctx.fillStyle = th.sub;
    /* v0.3：进关时关卡名 400ms 淡入上滑（只动文字，无音效、无闪） */
    var ep = clamp01((nowMs() - (app.lvlEnterAt || 0)) / 400);
    var eA = 0.25 + 0.75 * easeOut(ep);
    var eY = (1 - easeOut(ep)) * 10;
    ctx.save();
    ctx.globalAlpha = eA;
    ctx.fillText(app.def.name || '', 36, 134 + eY);
    ctx.restore();

    /* 剩余次数：圆点 */
    var total = app.def.attempts || 3;
    var x0 = 300;
    var y0 = 128;
    for (var i = 0; i < total; i++) {
        ctx.beginPath();
        ctx.arc(x0 + i * 28, y0, 8, 0, Math.PI * 2);
        if (i < app.attempts) {
            ctx.fillStyle = COL.main;
            ctx.fill();
        } else {
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(143,163,191,0.6)';
            ctx.stroke();
        }
    }

    /* 右上竖排固定槽位（不与图标行打架）：
       图标行 y 44..88（场景 x596 / 静音 x652）→ 得分 y=100 → 连击 y=132 → 倒计时 y=164（仅挑战） */
    var hudRight = 640;
    ctx.textAlign = 'right';
    ctx.font = font(700, 26);
    ctx.fillStyle = th.text;
    ctx.fillText(fmt(app.levelScore), hudRight, 100);
    ctx.font = font(600, 20);
    ctx.fillStyle = app.combo > 0 ? COL.main : th.sub;
    ctx.fillText('连击 ' + app.combo, hudRight, 132);
    ctx.restore();
}

function drawPauseButton() {
    var b = LAY.PAUSE_BTN;
    /* 面板弹出后进入 disabled 态（风格圣经 §4.2）：底色 #4A5568、图标 40% 透明、不发光 */
    var disabled = app.scene === 'feedback' && app.fb && app.fb.elapsed >= LAY.FEEDBACK_MS.panel;
    var pressed = !disabled && nowMs() - app.pressGlow < 120;
    ctx.save();
    if (!disabled) {
        ctx.shadowColor = pressed ? 'rgba(120,255,205,0.95)' : 'rgba(43,255,176,0.55)';
        ctx.shadowBlur = 16;
    }
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, b.r, 0, Math.PI * 2);
    if (disabled) {
        ctx.fillStyle = '#4A5568';
    } else {
        var g = ctx.createLinearGradient(0, b.cy - b.r, 0, b.cy + b.r);
        g.addColorStop(0, pressed ? '#9CFFD8' : '#4BF5B0');
        g.addColorStop(1, pressed ? '#5FE3AE' : '#12A06E');
        ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 4;
    ctx.strokeStyle = disabled ? 'rgba(143,163,192,0.5)' : 'rgba(232,241,255,0.9)';
    ctx.stroke();

    /* 两条竖杠 */
    ctx.globalAlpha = disabled ? 0.4 : 1;
    ctx.fillStyle = '#06231A';
    var bw = 22;
    var bh = 58;
    roundRectPath(b.cx - 30, b.cy - 44, bw, bh, 8);
    ctx.fill();
    roundRectPath(b.cx + 8, b.cy - 44, bw, bh, 8);
    ctx.fill();

    ctx.font = font(800, 28);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#06231A';
    ctx.fillText('暂停', b.cx, b.cy + 52);
    ctx.restore();
}

/* ---------------- 热力图（条带 + 半透明填充，不用逐像素 ImageData） ---------------- */
function localBounds(pts) {
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (var i = 0; i < pts.length; i++) {
        if (pts[i].x < b.minX) b.minX = pts[i].x;
        if (pts[i].y < b.minY) b.minY = pts[i].y;
        if (pts[i].x > b.maxX) b.maxX = pts[i].x;
        if (pts[i].y > b.maxY) b.maxY = pts[i].y;
    }
    return b;
}

function crossXs(pts, y) {
    var xs = [];
    var n = pts.length;
    for (var i = 0; i < n; i++) {
        var a = pts[i];
        var b = pts[(i + 1) % n];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
            xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
    }
    xs.sort(function (m, n2) { return m - n2; });
    return xs;
}

function xIntervals(pts, y) {
    var xs = crossXs(pts, y);
    var out = [];
    for (var i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    return out;
}

function intervalAnd(a, b) {
    var out = [];
    for (var i = 0; i < a.length; i++) {
        for (var j = 0; j < b.length; j++) {
            var lo = Math.max(a[i][0], b[j][0]);
            var hi = Math.min(a[i][1], b[j][1]);
            if (hi > lo) out.push([lo, hi]);
        }
    }
    return out;
}

function intervalMinus(a, b) {
    var rem = [];
    var i, j;
    for (i = 0; i < a.length; i++) rem.push([a[i][0], a[i][1]]);
    for (j = 0; j < b.length; j++) {
        var out = [];
        for (i = 0; i < rem.length; i++) {
            var s = rem[i];
            var lo = b[j][0];
            var hi = b[j][1];
            if (hi <= s[0] || lo >= s[1]) { out.push(s); continue; }
            if (lo > s[0]) out.push([s[0], lo]);
            if (hi < s[1]) out.push([hi, s[1]]);
        }
        rem = out;
    }
    return rem;
}

/**
 * 本地条带（三色口径，见 specs v0.1.1 §2 热力图）：
 *   green = 交集（重合）
 *   dev   = 物体 − 目标（物体溢出：玩家最需要知道错在哪）
 *   gap   = 目标 − 物体（绿框没被盖住）
 * core 的 overlapStrips 只给交集、missStrips 给「并集−交集」（分不出 dev/gap），
 * 所以 dev/gap 一定走本地这套；两者都只是**渲染**，判分仍走 overlapAreaExact。
 */
function localBands(objPts, tgtPts, bandPx) {
    var bo = localBounds(objPts);
    var bt = localBounds(tgtPts);
    var y0 = Math.min(bo.minY, bt.minY);
    var y1 = Math.max(bo.maxY, bt.maxY);
    var step = Math.max(2, bandPx);
    var out = [];
    for (var ya = y0; ya < y1; ya += step) {
        var yb = Math.min(ya + step, y1);
        var ym = (ya + yb) * 0.5;
        var A = xIntervals(objPts, ym);
        var B = xIntervals(tgtPts, ym);
        out.push({
            y0: ya,
            y1: yb,
            green: intervalAnd(A, B),
            dev: intervalMinus(A, B),
            gap: intervalMinus(B, A)
        });
    }
    return out;
}

/**
 * core 的条带 API 适配：green = overlapStrips（交集），red = missStrips（并集−交集）。
 * 返回 StripRect[]（{x,y,w,h}）；函数不存在或返回异常 → null，调用方回落本地条带。
 */
function coreRects(fnName, objPts, tgtPts) {
    if (typeof CORE[fnName] !== 'function') return null;
    try {
        var r = CORE[fnName](objPts, tgtPts, HEAT_BAND_PX);
        if (Object.prototype.toString.call(r) === '[object Array]') {
            if (r.length === 0 || typeof r[0].w === 'number') return r;
        }
    } catch (e) { /* 回落 */ }
    return null;
}

/**
 * 热力图三色口径（规格 v0.1.1）：
 *   重合 #2BFFB0 α0.35（最淡：对的不用吵）
 *   偏差 #FF5A5A α0.60（最亮：玩家最需要知道错在哪）+ 2px 外扩
 *   空缺 #6FE0B0 α0.30（青绿，不是琥珀：琥珀叠在绿+深底会变脏棕）
 * 并且**恒定画两套轮廓**：物体实线 + 绿框虚线（dash 6/6, α0.55）——
 * 不管重合率多少，偏移方向一眼可见（relax 靠形不靠亮）。
 */
var HEAT_STYLE = {
    overlap: { color: '#2BFFB0', alpha: 0.35 },
    dev: { color: '#FF5A5A', alpha: 0.60, dilate: 2 },
    /* 空缺必须是去饱和中性灰，不能用 mint/琥珀：叠在重合绿上会看起来"物体还在框里" */
    gap: { color: '#E8F1FF', alpha: 0.25 }
};

function rgba(hex, a) {
    var h = String(hex).replace('#', '');
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
}

/** 热力图淡入：120ms 起，用 heatmap 自身时长做淡入，之后保持口径 α */
function heatAlpha(e) {
    var start = LAY.FEEDBACK_MS.heatmap;
    var dur = Math.max(1, LAY.FEEDBACK_MS.heatmap);
    return clamp01((e - start) / dur);
}

function drawHeatmapLayer(fb, e) {
    var a = heatAlpha(e);
    if (a <= 0.002) return;
    /* v0.6 错拍关：每次定格只画**本次定格的那个 mover** 的热力图。
       两张叠一起时错拍关的重合/偏差会互相掩盖，玩家读不出"我这次差在哪"。 */
    drawHeatmap(fb.res, a, (fb.moverIndex === undefined ? null : fb.moverIndex));
}

function drawHeatmap(res, fade, onlyIndex) {
    var objs = (res && res.objects) || [];
    for (var i = 0; i < objs.length; i++) {
        if (onlyIndex != null && i !== onlyIndex) continue;
        var o = objs[i];
        if (!o || !o.objectPts || !o.targetPts) continue;
        var bands = localBands(o.objectPts, o.targetPts, HEAT_BAND_PX);
        var k, j;

        /* 每条颜色的所有矩形**合成一条 path 一次 fill**：
           逐条 fillRect 会在条带接缝处出现「缝隙」或「双 alpha 亮线」，一次 fill 则不会。 */
        var green = coreRects('overlapStrips', o.objectPts, o.targetPts);
        ctx.fillStyle = rgba(HEAT_STYLE.overlap.color, HEAT_STYLE.overlap.alpha * fade);
        ctx.beginPath();
        if (green) {
            for (k = 0; k < green.length; k++) ctx.rect(green[k].x, green[k].y, green[k].w, green[k].h + 0.5);
        } else {
            for (k = 0; k < bands.length; k++) {
                var g = bands[k].green;
                for (j = 0; j < g.length; j++) ctx.rect(g[j][0], bands[k].y0, g[j][1] - g[j][0], (bands[k].y1 - bands[k].y0) + 0.5);
            }
        }
        ctx.fill();

        /* ② 偏差：物体溢出。**先做差、再外扩 2px**，并且丢掉宽度 < 0.6px 的噪声细条——
           否则 100% 重合时 objectScaleOf 的浮点误差（1e-13px）会被 2px 外扩放大成一整圈
           「红褐色细边」，满分反而看着像「差了一点」。
           另加保险：pct ≥ 99.95 直接不画偏差/空缺层。 */
        var d = HEAT_STYLE.dev.dilate;
        var almostPerfect = (o.pct || 0) >= 99.95;
        ctx.fillStyle = rgba(HEAT_STYLE.dev.color, HEAT_STYLE.dev.alpha * fade);
        ctx.beginPath();
        for (k = 0; !almostPerfect && k < bands.length; k++) {
            var dv = bands[k].dev;
            for (j = 0; j < dv.length; j++) {
                var dw = dv[j][1] - dv[j][0];
                if (dw < 0.6) continue;
                ctx.rect(dv[j][0] - d, bands[k].y0 - d, dw + d * 2, (bands[k].y1 - bands[k].y0) + d * 2 + 0.5);
            }
        }
        ctx.fill();

        /* ③ 空缺：绿框没被盖住的那部分（同样丢掉噪声细条，单 path 一次 fill） */
        ctx.fillStyle = rgba(HEAT_STYLE.gap.color, HEAT_STYLE.gap.alpha * fade);
        ctx.beginPath();
        for (k = 0; !almostPerfect && k < bands.length; k++) {
            var gp = bands[k].gap;
            for (j = 0; j < gp.length; j++) {
                var gw = gp[j][1] - gp[j][0];
                if (gw < 0.6) continue;
                ctx.rect(gp[j][0], bands[k].y0, gw, (bands[k].y1 - bands[k].y0) + 0.5);
            }
        }
        ctx.fill();

        /* ④ 恒定两套轮廓：物体实线 + 绿框虚线 */
        if (o.objectPts) {
            polyPath(o.objectPts);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(232,241,255,0.75)';
            ctx.stroke();
        }
        polyPath(o.targetPts);
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.55 * fade;
        ctx.strokeStyle = COL.ring;
        if (ctx.setLineDash) ctx.setLineDash([6, 6]);
        ctx.stroke();
        if (ctx.setLineDash) ctx.setLineDash([]);
        ctx.globalAlpha = 1;
    }
}

/* v0.1.0 的全屏闪白已废弃（规格 §3 / 美术 §6.6：任何 α>0.3 的全屏白层都禁止），
   现有反馈由 drawGlow / drawRings / drawMotes / drawHeatmapLayer 分层承担。 */

/**
 * 失败时的副标题：必须说清「哪一头没进框」。
 * 双物体关的 pass 是「每个物体都 ≥ passRate」（core 冻结口径），只报平均会让玩家困惑。
 */
function failSubText(fb) {
    var res = fb.res;
    var vt = (LAY.VERDICT_TEXT && LAY.VERDICT_TEXT[res.rating]) || { sub: '' };
    if (fb.pass) return vt.sub || '';
    var need = Math.round((app.def.passRate || 0.6) * 100);
    var objs = res.objects || [];
    if (objs.length <= 1) return '重合率未达通关线 ' + need + '%';
    var wi = 0;
    for (var i = 1; i < objs.length; i++) if (objs[i].pct < objs[wi].pct) wi = i;
    var where = objs.length === 2 ? (wi === 0 ? '上方物体' : '下方物体') : '第 ' + (wi + 1) + ' 个物体';
    return where + ' ' + objs[wi].pct.toFixed(0) + '%（需 ≥ ' + need + '%）';
}

/** 通关后的面板停留（D-105：神级 1800ms，其它 1000ms） */
function feedbackHoldMs(tier) { return tier === 'god' ? 1800 : 1000; }

/** 解锁卡是否会出现（断言用：无新增 → 不画） */
function unlockCardVisible(fb) { return !!(fb && fb.unlocks && fb.unlocks.length); }

/**
 * v0.9.1 · D-105 新图鉴卡：面板上方一条，告诉玩家"刚刚得到了什么"。
 * 时间轴：淡入 160 → 停 1000 → 淡出 200（从面板出现算）。不挡评级标题/徽章。
 */
function drawUnlockCard(fb, dt) {
    if (!fb || !fb.unlocks || !fb.unlocks.length) return;
    var alpha = Math.min(clamp01(dt / 160), 1 - clamp01((dt - 1000) / 200));
    if (alpha <= 0.01) return;
    var ids = fb.unlocks.slice(0, 2);
    var rare = false;
    for (var i = 0; i < ids.length; i++) if (collectionItem(ids[i]).source === 'rare') rare = true;
    var box = UNLOCK_CARD_RECT;
    var th = sceneTheme();
    ctx.save();
    ctx.globalAlpha = alpha;
    roundRectPath(box.x, box.y, box.w, box.h, box.h * 0.5);
    ctx.fillStyle = 'rgba(22,36,56,0.94)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = rare ? COL.gold : 'rgba(46,229,157,0.85)';
    ctx.stroke();
    /* 左边一个 40px 剪影：让"得到的是哪一件"不靠文字才认得出 */
    var sh = shapeOf(ids[0]);
    var kk = 40 / 1.0;
    var pts = CORE.place(CORE.scaleLocal(sh.pts, kk), box.x + 38, box.y + box.h * 0.5, 0);
    polyPath(pts);
    ctx.fillStyle = sh.fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = sh.stroke;
    ctx.stroke();
    /* 文案：名字最多两个；稀有金点 */
    var label = '新图鉴 · ' + ids.map(function (id) { return collectionItem(id).name; }).join(' + ');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(700, 20);
    ctx.fillStyle = COL.text;
    ctx.fillText(label, box.x + 70, box.y + 27);
    var st = collectionState();
    ctx.font = font(500, 15);
    ctx.fillStyle = COL.sub;
    ctx.fillText('已收集 ' + st.unlockedCount + ' / ' + st.total + (rare ? '　· 稀有' : ''), box.x + 70, box.y + 47);
    if (rare) {
        ctx.beginPath();
        ctx.arc(box.x + box.w - 22, box.y + box.h * 0.5, 5, 0, Math.PI * 2);
        ctx.fillStyle = COL.gold;
        ctx.fill();
    }
    ctx.restore();
}

function drawPanel(fb, dt) {
    var k = easeOut(dt / 200);
    var res = fb.res;
    var vt = (LAY.VERDICT_TEXT && LAY.VERDICT_TEXT[res.rating]) || { title: res.rating, sub: '' };
    var box = { x: 72, y: 880, w: 576, h: 352 };
    var cx = box.x + box.w / 2;
    var slide = (1 - k) * 70;

    ctx.save();
    ctx.globalAlpha = clamp01(dt / 150);
    ctx.translate(0, slide);

    /* 背板：**不透明**（面板必须是最上层，半透明会让底下暂停按钮透出成暗斑） */
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 22;
    roundRectPath(box.x, box.y, box.w, box.h, 30);
    var pg = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
    pg.addColorStop(0, '#18263A');
    pg.addColorStop(1, '#0B121E');
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = fb.pass ? 'rgba(46,229,157,0.65)' : 'rgba(255,107,107,0.55)';
    ctx.stroke();
    /* 顶部色条：一眼分辨成/败 */
    ctx.beginPath();
    ctx.moveTo(box.x + 26, box.y + 1);
    ctx.lineTo(box.x + box.w - 26, box.y + 1);
    ctx.lineWidth = 4;
    ctx.strokeStyle = fb.pass ? COL.main : COL.fail;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    /* 评级：按 §6.3 静态分级表（字号/颜色/徽章都要能排序：神 > 完美 > 不错 > 及格 = 失败）
       v0.3：超时不走评级文案，直接写「时间到」 */
    var isTimeout = !!fb.timeout;
    var tier = fb.tier || res.rating;
    if (isTimeout) { vt = { title: '时间到', sub: '计时结束，这一关没卡准' }; }
    var titleSize = isTimeout ? 34 : (tier === 'god' || tier === 'perfect' ? 40 : tier === 'good' ? 36 : 32);
    var titleColor = isTimeout ? COL.gap : (tier === 'god' ? COL.gold : (tier === 'perfect' || tier === 'good') ? COL.text : COL.sub);
    ctx.font = font(800, titleSize);
    var titleW = ctx.measureText(vt.title).width;
    ctx.fillStyle = titleColor;
    ctx.fillText(vt.title, cx, box.y + 70);

    var badgeR = isTimeout ? 0 : (tier === 'god' ? 24 : tier === 'perfect' ? 20 : 0);
    if (badgeR > 0) {
        var bxx = cx + titleW / 2 + badgeR + 16;
        ctx.beginPath();
        ctx.arc(bxx, box.y + 58, badgeR, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = tier === 'god' ? COL.gold : COL.ring;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(bxx, box.y + 58, badgeR - 7, 0, Math.PI * 2);
        ctx.fillStyle = tier === 'god' ? COL.goldInner : 'rgba(43,255,176,0.20)';
        ctx.fill();
    }

    ctx.font = font(500, 22);
    ctx.fillStyle = isTimeout ? COL.gap : (tier === 'god' ? COL.gold : COL.sub);
    ctx.fillText(isTimeout ? vt.sub : failSubText(fb), cx, box.y + 102);

    if (!isTimeout) {
        /* 重合率 */
        ctx.font = font(700, 34);
        ctx.fillStyle = COL.text;
        ctx.fillText('重合率 ' + res.pct.toFixed(1) + '%', cx, box.y + 148);

        /* 按早了 / 按晚了
           角度**必须用 |ω|·Δt 反算**，不能用 objects[].angleDev：
           高速关（L60 = 3 圈 / 1200ms = 1080°/s）晚按 200ms 实际是 +216°，而 angleDev 经 normDeg
           会绕成 -144°，直接显示就会出现「晚按却写多转 168°」这种自相矛盾的文案。 */
        var tm = res.timing || { deltaMs: 0, verdict: 'onTime' };
        var turnsNow = (app.def && app.def.turns) || 1;
        var omega = (turnsNow * 360) / Math.max(1, cycleMs() / 1000); /* °/s */
        var devDeg = Math.abs(omega * Math.abs(tm.deltaMs || 0) / 1000);
        var line;
        if (tm.verdict === 'onTime') line = LAY.TIMING_TEXT.onTime;
        else {
            line = LAY.TIMING_TEXT[tm.verdict]
                .replace('{ms}', String(Math.abs(Math.round(tm.deltaMs))))
                .replace('{deg}', String(Math.round(devDeg)));
        }
        ctx.font = font(700, 27);
        ctx.fillStyle = tm.verdict === 'onTime' ? COL.main : tm.verdict === 'early' ? COL.gap : COL.fail;
        ctx.fillText(line, cx, box.y + 184);

        /* 位移偏差（辅助信息，验证「按早/按晚」因果；对玩家说人话 = 错位） */
        var offPx = 0;
        for (var j = 0; j < res.objects.length; j++) offPx += res.objects[j].offsetPx || 0;
        offPx = res.objects.length ? offPx / res.objects.length : 0;
        ctx.font = font(500, 19);
        ctx.fillStyle = 'rgba(143,163,191,0.9)';
        ctx.fillText('错位 ' + offPx.toFixed(0) + ' px', cx, box.y + 210);
    } else {
        /* 超时：没有 pct / 没有按早按晚，只说明"这一关没卡准" */
        ctx.font = font(500, 21);
        ctx.fillStyle = 'rgba(143,163,191,0.9)';
        ctx.fillText('本关没有在限时内完成定格', cx, box.y + 150);
    }

    if (fb.pass) {
        /* 星级 */
        var stars = fb.stars || 0;
        var sy = box.y + 256;
        for (var s = 0; s < 3; s++) {
            starPath(cx - 70 + s * 70, sy, 24, 10, 5);
            if (s < stars) {
                ctx.fillStyle = COL.main;
                ctx.fill();
            } else {
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(143,163,191,0.45)';
                ctx.stroke();
            }
        }
        ctx.font = font(800, 32);
        ctx.fillStyle = COL.text;
        ctx.fillText('本关 +' + fmt(fb.gain), cx, box.y + 308);
        ctx.font = font(500, 20);
        ctx.fillStyle = COL.sub;
        ctx.fillText('总分 ' + fmt(fb.totalScore) + ' · 连击 x' + fb.combo + ' · ' + (app.lvl + 2 <= curLevels().length ? '即将进入第 ' + (app.lvl + 2) + ' 关' : '即将通关'), cx, box.y + 336);
    } else {
        if (fb.attemptsLeft > 0) {
            ctx.font = font(800, 30);
            ctx.fillStyle = COL.fail;
            ctx.fillText('本关 0 分', cx, box.y + 262);
            ctx.font = font(500, 21);
            ctx.fillStyle = COL.sub;
            ctx.fillText('剩余 ' + fb.attemptsLeft + ' 次机会 · 自动重试', cx, box.y + 302);
        } else {
            var btn = { x: box.x + 138, y: box.y + 216, w: 300, h: 76 };
            roundRectPath(btn.x, btn.y, btn.w, btn.h, 38);
            ctx.fillStyle = COL.main;
            ctx.fill();
            ctx.fillStyle = '#06251A';
            ctx.font = font(800, 30);
            ctx.textBaseline = 'middle';
            ctx.fillText('重试本关', cx, btn.y + btn.h * 0.54);
            ctx.textBaseline = 'alphabetic';
            ctx.font = font(500, 19);
            ctx.fillStyle = COL.sub;
            ctx.fillText('点击按钮或屏幕任意处', cx, box.y + 330);
        }
    }

    /* v0.9：结算面板右上角的图鉴入口（助眠没有，S32）。面板底色恒为深色，所以用浅色文字。
       位置与居中的标题/徽章水平错开（标题最右 ≈ 464，按钮从 516 起），不会压字。 */
    if (galleryEntryVisible()) {
        var gb = PANEL_GALLERY_BTN;
        var gst = collectionState();
        roundRectPath(gb.x, gb.y, gb.w, gb.h, gb.h * 0.5);
        ctx.fillStyle = 'rgba(232,241,255,0.08)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(46,229,157,0.45)';
        ctx.stroke();
        ctx.fillStyle = COL.sub;
        ctx.font = font(600, 16);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('图鉴 ' + gst.unlockedCount + ' / ' + gst.total, gb.x + gb.w / 2, gb.y + gb.h * 0.54);
        ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
}

/* ---------------- 分享（v0.7 B1 · D-080：一条链接，只带 scene） ----------------
 * 分享 = 一条链接，接收方冷启动打开即同款背景：链接带 `?scene=<id>`，
 * 走的全是现成的基础设施（parseQuery → writeScenePref → resolveSceneId）。
 * 明确**不带** lvl（新玩家直接跳第 40 关是灾难）、**不带**分数（分数留在文案里）。
 * 不做二维码/出图（要引第三方库，违反 D-029）。
 * ------------------------------------------------------------------------- */

/** 埋点（原型只有内存缓冲，没有上报层；Cocos 侧由 Platform 层接真上报） */
var TRACK_LOG = (typeof window !== 'undefined' && window) ? (window.__TRACK__ = window.__TRACK__ || []) : [];
function track(ev, params) {
    try {
        TRACK_LOG.push({ ev: ev, params: params || {}, at: nowMs() });
        if (TRACK_LOG.length > 200) TRACK_LOG.shift(); /* 定长，长跑不涨内存 */
    } catch (e) { /* 埋点出错不许影响玩法 */ }
}

/** 分享用的场景 id：与画面同源（画面读 app.sceneId，没有才走 resolveSceneId） */
function shareSceneId() { return app.sceneId || resolveSceneId(); }

/**
 * 分享链接 = 当前页地址去掉查询串/锚点 + `?scene=<sceneId>`。
 * 为什么不用 `location.origin + location.pathname`：以 file:// 双击打开原型时
 * origin 是字符串 "null"，拼出来是 `null/dista_prototype.html?scene=…`（发出去别人打不开）；
 * 从 href 去壳对 http:// 与 file:// 都成立，也顺手避免 `?scene=a&scene=b`。
 */
function shareLinkUrl() {
    var loc = (typeof window !== 'undefined' && window.location) || {};
    var base = String(loc.href || '').split('#')[0].split('?')[0];
    if (!base) base = String(loc.origin || '') + String(loc.pathname || '');
    return base + '?scene=' + encodeURIComponent(shareSceneId());
}

/** 文案追加的场景名：直接取 scenes.json 的 name（不另写一套中文，改名不用改代码） */
function shareSceneLabel() {
    var s = sceneById(shareSceneId());
    return (s && s.name) ? String(s.name) : '';
}

/** 通关文案 = 原句（场景名不进文案：它会把句子挤成三行、末尾挂一个孤零零的"？ · 深夜候车"）。
 *  场景信息改用按钮下方一行小字单独说，见 drawComplete（D-088）。 */
function buildShareText(god, score) {
    return '我在《定格瞬间》定格了 ' + god + ' 次神级瞬间，总分 ' + fmt(score) + '。物体飞过，绿框不动——你也来试试？';
}

/** 复制结果落到 app 上：成功 → 按钮「链接已复制」1.6s；失败 → 链接以文本留在页面上 */
function setShareResult(ok) {
    app.shareFailed = !ok;
    app.shareCopiedAt = ok ? nowMs() : -1e9;
    app.shareUrl = ok ? '' : shareLinkUrl();
    if (ok) hideShareTextOverlay(); else showShareTextOverlay(app.shareUrl);
    /* 非 rAF 驱动（无头截图 / node 自测）下也要立刻看到结果，所以这里主动重画一帧 */
    try { renderFrame(); } catch (e) { /* 吃掉 */ }
}

/**
 * 优先 Clipboard API（异步；小程序 WebView 里可能是同步返回 undefined）。
 * @returns {boolean} 是否已经接管（true = 结果稍后在 then 里回写）
 */
function copyViaClipboard(text) {
    var nav = (typeof navigator !== 'undefined') ? navigator : null;
    if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') return false;
    try {
        var p = nav.clipboard.writeText(text);
        if (p && typeof p.then === 'function') {
            p.then(function () { setShareResult(true); },
                function () { setShareResult(false); }); /* 有 API 但被拒（无手势/权限）→ 走失败展示 */
        } else {
            setShareResult(true);
        }
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * execCommand('copy') 兜底：临时 textarea 全选后复制。
 * file:// 与老内核（没有 navigator.clipboard）里这是唯一能用的路径。
 * @returns {boolean} 是否复制成功
 */
function execCopyText(text) {
    try {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !document.body) return false;
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';   /* 不能 display:none：不可见元素选不中 */
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.select();
        try { ta.setSelectionRange(0, text.length); } catch (e2) { /* 老内核没有，忽略 */ }
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e3) { ok = false; }
        document.body.removeChild(ta);
        return !!ok;
    } catch (e) {
        return false;
    }
}

var SHARE_OVERLAY_ID = 'dista-share-link';

/**
 * 复制失败时把链接交给用户（§5.3：「老 WebView 没有 clipboard → 以可选择文本显示」）。
 * canvas 里的字选不中，所以叠一个 DOM textarea（已全选）。没有 DOM（node 自测的假 document）时
 * 返回 false —— 此时通关页上仍然画着那行链接，不会"点了没反应"。
 */
function showShareTextOverlay(text) {
    try {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !document.body) return false;
        var el = document.getElementById(SHARE_OVERLAY_ID);
        if (!el) {
            el = document.createElement('textarea');
            el.id = SHARE_OVERLAY_ID;
            el.setAttribute('readonly', 'readonly');
            el.style.position = 'fixed';
            el.style.left = '50%';
            el.style.bottom = '32px';
            el.style.transform = 'translateX(-50%)';
            el.style.width = '86vw';
            el.style.maxWidth = '640px';
            el.style.padding = '10px 12px';
            el.style.borderRadius = '10px';
            el.style.border = '1px solid rgba(46,229,157,0.5)';
            el.style.background = 'rgba(22,36,56,0.96)';
            el.style.color = '#E8F1FF';
            el.style.font = '14px/1.5 system-ui, "Microsoft YaHei", sans-serif';
            el.style.zIndex = '50';
            document.body.appendChild(el);
        }
        el.value = text;
        el.style.display = 'block';
        /* 全选后用户可以直接长按/右键复制，也可以照着手打 */
        try { el.focus(); el.select(); } catch (e4) { /* 吃掉 */ }
        return true;
    } catch (e) {
        return false;
    }
}

function hideShareTextOverlay() {
    try {
        if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
        var el = document.getElementById(SHARE_OVERLAY_ID);
        if (el && el.style) el.style.display = 'none';
    } catch (e) { /* 吃掉 */ }
}

/**
 * 点「复制链接」。三条路依次降级，**每一条都有可见结果**：
 *   1) navigator.clipboard.writeText → 成功：按钮变「链接已复制」
 *   2) textarea + execCommand('copy') → 同上
 *   3) 都不行 → 链接画在通关页上 + 叠一个可选择的 DOM 文本
 * 不论成败都记一次 share_click（channel = 场景 id，见 埋点与验收.md）。
 * @returns {'clipboard'|'exec'|'fallback'}
 */
function copyShareLink() {
    var url = shareLinkUrl();
    track('share_click', { channel: shareSceneId() });
    if (copyViaClipboard(url)) return 'clipboard';
    if (execCopyText(url)) { setShareResult(true); return 'exec'; }
    setShareResult(false);
    return 'fallback';
}

/* ---------------- 通关页 ---------------- */
function drawComplete() {
    var c = app.complete || { score: 0, god: 0, share: '' };
    var th = sceneTheme();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.font = font(800, 74);
    ctx.fillStyle = th.text;
    ctx.fillText('全部定格', 360, 250);

    ctx.font = font(500, 26);
    ctx.fillStyle = th.sub;
    ctx.fillText('15 关，一路卡在那一帧上', 360, 300);

    ctx.font = font(800, 96);
    ctx.fillStyle = COL.main;
    ctx.fillText(fmt(c.score), 360, 470);
    ctx.font = font(500, 24);
    ctx.fillStyle = th.sub;
    ctx.fillText('总得分', 360, 506);

    ctx.font = font(800, 54);
    ctx.fillStyle = th.text;
    ctx.fillText('神级次数 ' + c.god, 360, 596);

    /* v0.3：历史最高分（只增不减，只挑战记录）+ 本局用时 */
    ctx.font = font(500, 26);
    ctx.fillStyle = th.sub;
    ctx.fillText('历史最高 ' + fmt(c.best || 0) + ' 分　·　用时 ' + (c.timeText || '0:00'), 360, 646);

    var bx = 84;
    var by = 700;
    var bw = 552;
    var bh = 236;
    roundRectPath(bx, by, bw, bh, 28);
    ctx.fillStyle = 'rgba(22,36,56,0.9)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(46,229,157,0.5)';
    ctx.stroke();

    ctx.font = font(500, 24);
    ctx.fillStyle = COL.text;
    wrapText(c.share, 360, by + 70, bw - 48, 38);

    /* §5：通关页「再玩一次」→ 回第 1 关（点其它处 = 回首页） */
    var b = COMPLETE_BTN;
    var pressed = nowMs() - app.pressGlow < 120;
    ctx.save();
    ctx.shadowColor = 'rgba(43,255,176,0.45)';
    ctx.shadowBlur = 12;
    roundRectPath(b.x, b.y, b.w, b.h, b.h * 0.5);
    var bg2 = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    bg2.addColorStop(0, pressed ? '#9CFFD8' : '#2BFFB0');
    bg2.addColorStop(1, pressed ? '#5FE3AE' : '#17A97A');
    ctx.fillStyle = bg2;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#06251A';
    ctx.font = font(800, 34);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('再玩一次', 360, b.y + b.h * 0.52);
    ctx.restore();

    /* v0.7 B1：复制链接（分享 = 一条链接，接收方冷启动即同款背景）。次按钮 = 描边，不抢主 CTA 的位 */
    var sb = SHARE_BTN;
    var copied = (nowMs() - app.shareCopiedAt) < 1600;
    ctx.save();
    roundRectPath(sb.x, sb.y, sb.w, sb.h, sb.h * 0.5);
    ctx.fillStyle = 'rgba(22,36,56,0.9)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = copied ? 'rgba(46,229,157,0.95)' : 'rgba(46,229,157,0.5)';
    ctx.stroke();
    ctx.fillStyle = copied ? COL.main : COL.text;
    ctx.font = font(700, 26);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(copied ? '链接已复制' : '复制链接', 360, sb.y + sb.h * 0.52);
    ctx.restore();

    /* 复制失败：链接画在页面上（canvas 文字选不中，所以另叠了可选择的 DOM 文本，见 showShareTextOverlay）。
       位置从 1112 起，最多排到 ~1172，不会压到安全区或底部手势条。 */
    if (app.shareFailed && app.shareUrl) {
        ctx.font = font(500, 20);
        ctx.fillStyle = th.sub;
        wrapText(app.shareUrl, 360, 1112, 600, 30);
    }

    /* D-088：场景名单独一行小字，不塞进文案（塞进去会把句子挤成三行、末尾挂个孤零零的"？ · 深夜候车"）。
       复制失败时这行让位给链接文本（失败时链接比场景名重要）。 */
    var shareLabel = shareSceneLabel();
    if (shareLabel && !copied && !app.shareFailed) {
        ctx.font = font(500, 20);
        ctx.fillStyle = th.sub;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('链接会带上当前场景：' + shareLabel, 360, 1044);
    }

    ctx.font = font(500, 21);
    ctx.fillStyle = 'rgba(143,163,192,0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('点其它任意处回首页', 360, 1082);
    drawCompleteGalleryBtn(); /* v0.9.1：通关页也能进图鉴（D-106） */
    drawMuteButton();
    ctx.restore();
}

function wrapText(text, cx, y, maxW, lh) {
    var chars = String(text || '').split('');
    var line = '';
    var yy = y;
    for (var i = 0; i < chars.length; i++) {
        var test = line + chars[i];
        if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, cx, yy);
            line = chars[i];
            yy += lh;
        } else {
            line = test;
        }
    }
    if (line) ctx.fillText(line, cx, yy);
}

/* ---------------- 错误上报：写进 title + 顶部红条（--dump-dom 可 grep） ---------------- */
function onErr(e) {
    errCount++;
    var msg = (e && (e.stack || e.message)) || String(e);
    var bar = document.getElementById('errbar');
    if (bar) {
        bar.style.display = 'block';
        bar.textContent = 'JS-ERROR: ' + msg;
    }
    try { document.documentElement.setAttribute('data-js-error', '1'); } catch (e2) { /* noop */ }
    document.title = 'JS-ERROR: ' + msg.split('\n')[0].slice(0, 140);
    if (window.console && window.console.error) window.console.error(e);
}

/* ---------------- 调试入口（URL 参数，截图用） ---------------- */
function parseQuery() {
    var q = (window.location.search || '').replace(/^\?/, '');
    var o = {};
    if (!q) return o;
    var parts = q.split('&');
    for (var i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        var kv = parts[i].split('=');
        o[decodeURIComponent(kv[0])] = kv.length > 1 ? decodeURIComponent(kv[1]) : '';
    }
    return o;
}
var DBG = parseQuery();
var DBG_SCREEN = DBG.screen || DBG.shot || '';
var DBG_LVL = DBG.lvl ? parseInt(DBG.lvl, 10) : 0;
var DBG_PRESS = DBG.press !== undefined && DBG.press !== '' ? parseFloat(DBG.press) : null;
var DBG_ATT = DBG.att ? parseInt(DBG.att, 10) : null;
var DBG_FREEZE = DBG.freeze ? parseInt(DBG.freeze, 10) : 620;
var DBG_FXAT = DBG.fxAt ? parseInt(DBG.fxAt, 10) : null;

function applyDebug() {
    var s = DBG_SCREEN;
    if (DBG_LVL > 0) progress.unlocked = Math.max(progress.unlocked || 1, DBG_LVL);
    /* 截图用：伪造存档进度（首页「继续 · 第 N 关」那张图必须有进度）。只在 ?progress 时播种 */
    if (DBG.progress) progress.unlocked = Math.max(1, Math.min(LEVELS.length, parseInt(DBG.progress, 10) || 1));
    if (DBG.unlocked) progress.unlocked = Math.max(1, Math.min(LEVELS.length, parseInt(DBG.unlocked, 10) || 1));
    if (DBG.best) progress.bestScore = parseInt(DBG.best, 10) || 0;
    /* v0.9 图鉴截图用：?cleared=N 伪造已通关关数，?god=N 伪造累计神级（只影响点亮，不影响判定）。
       播种是**覆盖式**的：同一份 file:// 画像里 localStorage 会跨次留存（上一张截图里的 judge
       会写字），用 Math.max 保留旧值会让"同一个 URL 拍不出同一张图"，截图复核就不可复现了。 */
    if (DBG.cleared !== undefined && DBG.cleared !== '') {
        progress.cleared = Math.max(0, Math.min(LEVELS.length, parseInt(DBG.cleared, 10) || 0));
        if (!(DBG.progress || DBG.unlocked)) {
            progress.unlocked = Math.max(1, Math.min(LEVELS.length, (progress.cleared || 0) + 1));
        }
    } else if (DBG.progress || DBG.unlocked) {
        progress.cleared = Math.max(0, (progress.unlocked || 1) - 1);
    }
    if (DBG.god !== undefined && DBG.god !== '') progress.godTotal = Math.max(0, parseInt(DBG.god, 10) || 0);
    /* D-094：?cardScene=<id> 走"渲染期覆盖"通道——**不写 pref**（与 ?scene= 手动选择通道分开） */
    if (DBG.cardScene) setSceneOverride(DBG.cardScene);

    /* v0.2：?scene=<id|auto> 走"手动选择"通道（存 localStorage，优先于自动）；
       ?hour=N 伪造本地时间（M5）；?mode=relax|challenge
       v0.7：**非法 id 不写 pref**（v0.7 §5.1 边界：分享链接里的 ?scene=xxx 要回落 auto，
       写进 pref 等于把垃圾永久留在玩家存档里，下次冷启动还得靠回落兜着） */
    if (DBG.scene) {
        var wantScene = DBG.scene === 'auto' ? 'auto' : DBG.scene;
        if (wantScene === 'auto' || sceneById(wantScene)) writeScenePref(wantScene);
    }
    if (DBG.mode === 'relax' || DBG.mode === 'challenge') app.mode = DBG.mode;
    applyModeAudio();

    /* v0.9.1 试玩入口：?start=N 直接进第 N 关并**正常跑时钟**（不是截图冻结）。
       与 ?screen=play 的区别：screen=play 会把 timeFreeze 钉在按下的某一帧，只能看不能玩。
       challenge / relax 都支持：?start=31&mode=relax 即助眠第 31 关。 */
    if (DBG.start !== undefined && DBG.start !== '') {
        var startN = parseInt(DBG.start, 10);
        if (isFinite(startN)) {
            var startList = (app.mode === 'relax' && RELAX_LEVELS && RELAX_LEVELS.length) ? RELAX_LEVELS : LEVELS;
            startN = Math.max(1, Math.min(startList.length, startN));
            startRun(app.mode, startN - 1);
            timeFreeze = null; /* 真试玩：时钟必须走 */
            return;
        }
    }

    if (s === 'home') {
        app.scene = 'home';
        app.homeStart = 0;
        app.sceneId = resolveSceneId();
        timeFreeze = HOME_CYCLE * 0.42; /* 物体在绿框左侧，一眼看出「要套进去」 */
        return;
    }
    if (s === 'gallery') {
        /* 图鉴截图/验收入口。?mode=relax 时 openGallery 会拒绝（scene 仍是 home）——
           这正是 S32 要的证据：助眠没有图鉴入口。 */
        app.galleryStart = 0;
        app.homeStart = 0;
        app.sceneId = resolveSceneId();
        if (DBG.sel) app.gallerySel = DBG.sel;
        openGallery('home');
        if (app.scene === 'gallery') {
            if (DBG.page !== undefined && DBG.page !== '') {
                app.galleryPage = Math.max(0, Math.min(galleryPageCount() - 1, parseInt(DBG.page, 10) || 0));
            }
            if (DBG.detail) openGalleryDetail(DBG.detail);
            try { renderFrame(); } catch (e) { /* 吃掉 */ }
        }
        timeFreeze = 0;
        return;
    }
    if (s === 'complete') {
        app.scene = 'complete';
        /* 截图页也要有真场景 id：文案里的场景名、复制链接里的 ?scene= 都读它。
           之前这里是 null → sceneTheme() 回落 SCENES[0]，而 shareSceneLabel() 走 resolveSceneId()，
           同一张图里背景和文案可能不是同一个场景（浅底/深底会打架）。 */
        app.sceneId = resolveSceneId();
        app.complete = {
            score: DBG_LVL > 0 ? 0 : 18420,
            god: DBG_LVL > 0 ? 0 : 4,
            share: buildShareText(DBG_LVL > 0 ? 0 : 4, DBG_LVL > 0 ? 0 : 18420)
        };
        timeFreeze = 0;
        return;
    }
    if (s === 'play' || s === 'result') {
        /* v0.6 截图专用：?desyncStage=1 → 第一个错拍关定格一次，并停在 400ms 冻结中
           （画面应有：一个实心点、一个空心点，另一个物体还在飞；热力图只画已定格那个） */
        if (DBG.desyncStage) {
            var dlist = curLevels();
            var dIdx = -1;
            for (var q2 = 0; q2 < dlist.length; q2++) {
                if (desyncPhase(dlist[q2]) > 0) { dIdx = q2; break; }
            }
            if (dIdx >= 0 && typeof CORE.judgeNearest === 'function') {
                app.mode = 'challenge';
                startLevel(dIdx);
                /* 调试参数只影响"看到什么"，不影响"玩到什么"：
                   真实玩到 L50 时季入场早在 L46 就播完了，这里的季文字是调试分支制造的假象
                   （会压在被摄主体上），所以截图时跳过它。 */
                app.seasonIntroAt = -1e9;
                app.attemptStart = 0;
                var pt = perfectPressClockMs(0);
                timeFreeze = pt;
                desyncPress(pt);
                var holdAt = Math.min(DESYNC_FREEZE_MS - 20, DBG_FREEZE > 0 && DBG_FREEZE < DESYNC_FREEZE_MS ? DBG_FREEZE : 200);
                timeFreeze = pt + holdAt;
                if (app.fb) app.fb.elapsed = holdAt;
                return;
            }
            drawFault('?desyncStage 需要 judgeNearest', '回落到普通 play 截图');
        }
        /* 调试入口只认 ?lvl=；**绝不**用存档进度决定起始关（P0：重新开始必须回第 1 关） */
        var idx = Math.max(0, (DBG_LVL || 1) - 1);
        /* v0.4：?season=N → 直接跳到第 N 季首关，并强制播放季入场（截图用） */
        if (DBG.season) {
            var sn = parseInt(DBG.season, 10) || 1;
            idx = Math.max(0, (sn - 1) * LEVELS_PER_SEASON);
        }
        /* v0.4：?relaxLvl=N → 催眠第 N 关 */
        if (DBG.relaxLvl) {
            idx = Math.max(0, (parseInt(DBG.relaxLvl, 10) || 1) - 1);
        }
        /* ?variant=dual：没指定关或指定到单物体关时，自动落到第一个双物体关（截图/联调用） */
        if (DBG.variant === 'dual') {
            var dualIdx = -1;
            var dvList = curLevels();
            for (var q = 0; q < dvList.length; q++) {
                if (dvList[q].variant === 'dual') { dualIdx = q; break; }
            }
            if (DBG_LVL <= 0 && dualIdx >= 0) idx = dualIdx;
            else if (dvList[idx] && dvList[idx].variant !== 'dual' && dualIdx >= 0) idx = dualIdx;
        }
        startLevel(Math.max(0, Math.min(curLevels().length - 1, idx)));
        if (DBG_ATT !== null) app.attempts = Math.max(1, DBG_ATT);
        var cyc = cycleMs();
        var frac = DBG_PRESS === null ? 0.55 : DBG_PRESS;
        /* ?at=god：把按下时刻钉在本关完美点上（截图要"神级三环"时用，比猜 press 可靠）。
           防御：调试参数组合（比如 ?season=N 的跳季分支）可能让 rt 还没按季重建完，
           perfectMs 取到 undefined/NaN 时退化成"半周期"，绝不许把整帧打成 NaN。 */
        if (DBG.at === 'god' && app.rt && app.rt.movers && app.rt.movers[0]) {
            var pm = app.rt.movers[0].perfectMs;
            if (!isFinite(pm)) {
                pm = fin(app.rt.movers[0].cycleMs, 2000) * 0.5;
                drawFault('?at=god 的 perfectMs', pm);
            }
            frac = pm / cyc;
            if (!isFinite(frac)) frac = 0.5;
        }
        app.attemptStart = 0;
        timeFreeze = cyc * frac;
        /* 强制季入场可见：入场时钟要在 timeFreeze 定好之后再钉，否则 e 会算出很远 */
        if (DBG.season) app.seasonIntroAt = nowMs() - 300;

        /* v0.3 截图用：?timeLeft=2.4 → 把倒计时拨到剩 2.4s（验 ≤3s 琥珀色）；
           ?timeout=1 → 直接触发超时结算（验「时间到」面板） */
        if (DBG.timeLeft !== undefined && DBG.timeLeft !== '' && app.timeLimitMs) {
            app.timerStart = nowMs() - (app.timeLimitMs - parseFloat(DBG.timeLeft) * 1000);
        }
        if (DBG.timeout === '1') {
            /* 让截图里的倒计时诚实地显示 0.0s（而不是停表时的 15.0s） */
            if (app.timeLimitMs) {
                app.timerStart = nowMs() - app.timeLimitMs;
                app.timerStopAt = nowMs();
            }
            triggerTimeout();
            if (app.fb) {
                var fxT = DBG_FXAT !== null ? DBG_FXAT : 500;
                timeFreeze = app.fb.t0 + fxT;
                app.fb.elapsed = fxT;
            }
            return;
        }
        if (s === 'result') {
            doPress(nowMs());
            if (app.fb) {
                /* ?fxAt=400 → 把特效时钟固定在按下后 400ms（环扩散中/微尘半空/面板刚上滑），
                   否则截图抓在 1.2s 后，五档特效早消失、验收会误判「分不出来」 */
                var fxAt = DBG_FXAT !== null ? DBG_FXAT : DBG_FREEZE;
                timeFreeze = app.fb.t0 + fxAt;
                app.fb.elapsed = fxAt;
            }
        }
        return;
    }

    /* 无 screen 参数：正常首页开场。让演示从「物体刚进画面」起播，第一帧就有东西看 */
    app.scene = 'home';
    app.homeStart = nowMs() - HOME_CYCLE * 0.42;
    app.sceneId = resolveSceneId();
}

/* ---------------- 诊断叠层（?diag=1 才显示；截图定位问题用） ---------------- */
var diagOnce = {};
function poseDiag(msg) {
    if (diagOnce[msg]) return;
    diagOnce[msg] = 1;
    if (window.console && window.console.error) window.console.error('[proto] ' + msg);
    onErr(new Error(msg));
}

function num(x) {
    return (typeof x === 'number' && isFinite(x)) ? x.toFixed(1) : String(x);
}

function drawDiag() {
    if (DBG.diag !== '1') return;
    var d = app.diag || {};
    var lines = [
        'scene=' + app.scene + '  lvl=' + (app.lvl + 1) + '/' + curLevels().length + '  att=' + app.attempts + '  mode=' + app.mode + '  season=' + seasonOf(app.def),
        'timer=' + (app.timeLimitMs ? ((timerLeftMs() || 0) / 1000).toFixed(2) + 's left / ' + (app.timeLimitMs / 1000) + 's' : 'none') + '  round=' + (app.round || 1),
        'timeFreeze=' + (timeFreeze === null ? 'null' : num(timeFreeze)) + '  homeStart=' + num(app.homeStart) + '  attemptStart=' + num(app.attemptStart),
        't=' + num(d.t) + '  u=' + num(d.u) + '  x=' + num(d.x) + '  y=' + num(d.y) + '  rot=' + num(d.rot) + '  k=' + num(d.k),
        'rings=' + (d.rings || '(none)') + '   ← 颜色@半径，按发射顺序（第 3 个才是 gold）',
        'view=' + num(view.w) + 'x' + num(view.h) + '  dpr=' + num(view.dpr) + '  scale=' + num(view.scale) + '  ox=' + num(view.ox) + '  oy=' + num(view.oy),
        'core=' + CORE_MODE + '  shapes=' + Object.keys(SHAPES).length + '  movers=' + (app.rt && app.rt.movers ? app.rt.movers.length : 0)
    ];
    var lineH = 20;
    var boxH = lines.length * lineH + 14;
    var boxY = H - 12 - boxH;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(8, boxY, 704, boxH);
    ctx.fillStyle = '#7CFFC4';
    ctx.font = '600 14px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], 16, boxY + 16 + i * lineH);
    ctx.restore();
}

/* ---------------- 启动 ---------------- */
function bindInput() {
    var handler = function (ev) {
        if (ev && ev.cancelable && ev.preventDefault) ev.preventDefault();
        if (ev && typeof ev.clientX === 'number') {
            var p = toDesign(ev.clientX, ev.clientY);
            handlePressAt(p.x, p.y);
        } else {
            handlePress();
        }
    };
    if (cv && window.PointerEvent) cv.addEventListener('pointerdown', handler, false);
    else if (cv) {
        cv.addEventListener('mousedown', handler, false);
        cv.addEventListener('touchstart', handler, false);
    }
    window.addEventListener('keydown', function (ev) {
        if (ev.key === ' ' || ev.key === 'Enter' || ev.keyCode === 32) {
            if (ev.preventDefault) ev.preventDefault();
            handlePress();
        }
    }, false);
    window.addEventListener('resize', resize, false);
    window.addEventListener('orientationchange', resize, false);
}

function boot() {
    resize();
    bindInput();
    /* 配置校验失败必须在首帧就喊出来（红条 + title），不能静默降级 */
    if (LOAD_ERRORS.length) onErr(new Error(LOAD_ERRORS.join(' | ')));
    applyDebug();
    update();      /* 首帧同步渲染前先结算，保证截图里的面板数据是完整的 */
    renderFrame(); /* 同步画一帧：无头截图不依赖 rAF */
    if (document.body) document.body.setAttribute('data-core-mode', CORE_MODE);

    /* 自测钩子：tools/selfcheck_proto.mjs / audio_check.mjs 用它在 Node 里驱动逻辑（不需要浏览器） */
    window.__PROTO__ = {
        CORE: CORE,
        CFG: CFG,
        app: app,
        DBG: DBG,
        view: view,
        toDesign: toDesign,
        levels: LEVELS,
        shapes: SHAPES,
        progress: progress,
        audio: AUDIO,
        press: doPress,
        startLevel: startLevel,
        startRun: startRun,
        restartLevel: restartLevel,
        nextLevel: nextLevel,
        homePress: handlePressAt,
        canContinue: canContinue,
        settle: settle,
        heatStyle: HEAT_STYLE,
        ratingFx: ratingFx,
        /* v0.2/v0.3：双模式 + 三场景（M5–M8 / M13–M20 断言用） */
        MODES: MODES,
        SCENES: SCENES,
        modeCfg: modeCfg,
        /* v0.4：60 关 / 四季 / 特效外置（S1–S6 断言用） */
        FX: FX,
        DEFAULT_FX: DEFAULT_FX,
        RELAX_LEVELS: RELAX_LEVELS,
        curLevels: curLevels,
        seasonOf: seasonOf,
        seasonTintOf: seasonTintOf,
        curSeason: curSeason,
        /* v0.6 错拍 */
        desyncPhase: desyncPhase,
        isDesync: isDesync,
        desyncSelftest: desyncSelftest,
        desyncPress: desyncPress,
        moverPerfectMs: moverPerfectMs,
        perfectPressClockMs: perfectPressClockMs,
        DESYNC_FREEZE_MS: DESYNC_FREEZE_MS,
        ringCfg: ringCfg,
        moteCfg: moteCfg,
        isSeasonEndIdx: isSeasonEndIdx,
        LEVELS_PER_SEASON: LEVELS_PER_SEASON,
        isRelax: isRelax,
        respawn: beginAttempt,
        timerLeftMs: timerLeftMs,
        triggerTimeout: triggerTimeout,
        levelTimeLimit: levelTimeLimit,
        showToast: showToast,
        resolveSceneId: resolveSceneId,
        autoSceneId: autoSceneId,
        sceneById: sceneById,
        setScenePref: writeScenePref,
        readScenePref: readScenePref,
        localHour: localHour,
        cycleScene: cycleScene,
        /* D-094：场景两条通道（瓶子卡 = 渲染期覆盖，不写 pref；?scene= = 手动选择，写 pref） */
        setSceneOverride: setSceneOverride,
        clearSceneOverride: clearSceneOverride,
        getSceneOverride: getSceneOverride,
        /* v0.9 道具收集（mock 图鉴）：状态是纯函数，断言可直接喂合成存档（S30/S31/S34） */
        COLLECTION: COLLECTION,
        collectionState: collectionState,
        collectionItem: collectionItem,
        unlockCardVisible: unlockCardVisible,
        feedbackHoldMs: feedbackHoldMs,
        clearedCount: clearedCount,
        godTotalOf: godTotalOf,
        unlockLabel: unlockLabel,
        galleryEntryVisible: galleryEntryVisible,
        openGallery: openGallery,
        closeGallery: closeGallery,
        galleryCellRect: galleryCellRect,
        galleryPageCount: galleryPageCount,
        galleryPageOf: galleryPageOf,
        pageArrowEnabled: pageArrowEnabled,
        openGalleryDetail: openGalleryDetail,
        stepGalleryDetail: stepGalleryDetail,
        galleryDetailTitle: galleryDetailTitle,
        recentGalleryIds: recentGalleryIds,
        markGallerySeen: markGallerySeen,
        homeGalleryHitRect: homeGalleryHitRect,
        playGalleryHitRect: playGalleryHitRect,
        completeGalleryHitRect: completeGalleryHitRect,
        panelGalleryHitRect: panelGalleryHitRect,
        panelSlidePx: panelSlidePx,
        /* D-100：relax 退出的视觉矩形（(24,136,88,44)）与热区（expandRect 0,22 → 88 高）都从这里取，
           断言用 EXIT_BTN / exitHitRect 即可，不用在测试里另抄一份坐标 */
        EXIT_BTN: EXIT_BTN,
        exitHitRect: exitHitRect,
        HOME_GALLERY_BTN: HOME_GALLERY_BTN,
        PLAY_GALLERY_BTN: PLAY_GALLERY_BTN,
        COMPLETE_GALLERY_BTN: COMPLETE_GALLERY_BTN,
        PANEL_GALLERY_BTN: PANEL_GALLERY_BTN,
        UNLOCK_CARD_RECT: UNLOCK_CARD_RECT,
        GALLERY_BACK: GALLERY_BACK,
        GALLERY_GRID: GALLERY_GRID,
        GALLERY_PAGE_PREV: GALLERY_PAGE_PREV,
        GALLERY_PAGE_NEXT: GALLERY_PAGE_NEXT,
        GALLERY_BIG: GALLERY_BIG,
        GALLERY_PREV: GALLERY_PREV,
        GALLERY_NEXT: GALLERY_NEXT,
        relaxOrderForScene: relaxOrderForScene,
        relaxRotatedDef: relaxRotatedDef,
        relaxRotationForScene: relaxRotationForScene,
        /* v0.7：场景→曲（A3）与分享（B1）。明天验 A3-a/b/c、B-a/b/d 时直接用这几个符号，
           不用在浏览器里手点：__PROTO__.bgmTrackForScene('night_station') === 'lofi' */
        BGM_BY_SCENE: BGM_BY_SCENE,
        bgmTrackForScene: bgmTrackForScene,
        syncBgmToScene: syncBgmToScene,
        SHARE_BTN: SHARE_BTN,
        shareSceneId: shareSceneId,
        shareLinkUrl: shareLinkUrl,
        buildShareText: buildShareText,
        copyShareLink: copyShareLink,
        trackLog: function () { return TRACK_LOG; },
        /* D-077：silhouette 的透明度曲线（唯一需要单测的部分，画路径只能靠截图）
           __PROTO__.silAlpha(0, L)=0 → 450ms=0.035 → 2000ms=0.07 → 5550ms=0.035 → 6100ms=0 */
        silAlpha: silAlpha,
        goHome: goHome,
        targetBreathAlpha: targetBreathAlpha,
        now: nowMs,
        freeze: function (ms) { timeFreeze = ms; },
        unfreeze: function () { timeFreeze = null; },
        update: update,
        render: renderFrame
    };

    if (DBG.autoplay === '1' && !DBG_SCREEN) {
        var cyc = cycleMs();
        var frac = DBG_PRESS === null ? 0.6 : DBG_PRESS;
        window.setTimeout(function () {
            try { update(); if (app.scene === 'play') doPress(nowMs()); } catch (e) { onErr(e); }
        }, Math.max(60, cyc * frac));
    }

    /* ?tap=challenge|relax|continue（旧名 start = challenge）：200ms 后真的"点"一次首页按钮，
       比读启动值可靠。只在带参数时生效，不进正式逻辑。 */
    if (DBG.tap === 'challenge' || DBG.tap === 'start' || DBG.tap === 'relax' || DBG.tap === 'continue') {
        window.setTimeout(function () {
            try {
                var r = DBG.tap === 'continue' ? HOME_BTN.cont
                    : DBG.tap === 'relax' ? HOME_BTN.relax
                        : HOME_BTN.challenge;
                timeFreeze = null; /* 点完之后让时钟回到真实时间，截图里能看见物体在飞 */
                handlePressAt(r.x + r.w / 2, r.y + r.h / 2);
                renderFrame();
            } catch (e) { onErr(e); }
        }, 200);
    }
    rafId = window.requestAnimationFrame(loop);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
} else {
    boot();
}
