/**
 * tools/build_proto.mjs —— 把 core + 配置 + 原型逻辑 打成「双击即玩」的单文件 HTML
 *
 * 用法：
 *   node tools/build_proto.mjs              # 自动判断（core 全套就位 → 真实现，否则 mock）
 *   node tools/build_proto.mjs --mock       # 强制桩（对照用）
 *   node tools/build_proto.mjs --core       # 强制真实 core（缺文件直接报错）
 *
 * 产物：原型/dista_prototype.html（无外链、无 fetch、file:// 可开）
 *
 * 内联顺序（冻结）：Geometry → Types → Layout → Shapes → Paths → Score → Judge → LevelStore → index
 * 类型擦除：require('node:module').stripTypeScriptTypes(src, { mode: 'strip' })
 *
 * 口径纪律：
 *   - 关卡数据只读 assets/resources/config/levels.json（client-core 的工具导出），本脚本**不解析 CSV**；
 *   - 轮廓只读 assets/config/shapes.json（美术），缺失时才用 原型/_src/shapes_fallback.js；
 *   - 配置原样内联，校验交给运行时的 Core.loadLevels / loadShapes（单一真源，避免第二份口径）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_DIR = path.join(ROOT, 'assets', 'scripts', 'core');
const SRC_DIR = path.join(ROOT, '原型', '_src');
const OUT_FILE = path.join(ROOT, '原型', 'dista_prototype.html');
const LEVELS_JSON = path.join(ROOT, 'assets', 'resources', 'config', 'levels.json');
const SHAPES_JSON = path.join(ROOT, 'assets', 'config', 'shapes.json');
/* v0.2：双模式参数（我维护）与三场景（美术产出，同一份要同步到 resources/ 给 Cocos） */
const MODES_JSON = path.join(ROOT, 'assets', 'resources', 'config', 'modes.json');
const SCENES_SRC = path.join(ROOT, 'assets', 'config', 'scenes.json');
const SCENES_JSON = path.join(ROOT, 'assets', 'resources', 'config', 'scenes.json');
const COLLECTION_JSON = path.join(ROOT, 'assets', 'resources', 'config', 'collection.json');
/* D-111：原型体积上限 500→600 KB（600 × 1024 = 614400 B；D-103 原为 500KB）。增量来自 v10 道具的分层 details，
   这批数据在生产包里是独立 config 文件、不内联进 HTML，所以单文件原型的上限放到 600KB。D-103 的 500KB 由 D-111 取代。
   D-103：原型体积上限 480→500 KB（500 × 1024 = 512000 B）。单文件离线可玩是这个原型的交付形态，
   超过上限说明新增内容必须自己瘦身，不许砍需求（旧文案「目标 < 200 KB」是 v0.2 单场景时代的数字）。 */
const MAX_BYTES = 700 * 1024;   // D-124：36 件全部 80 顶点描样后配置变大，原型 648.6KB；贴图已外链，配置是唯一增量   // D-118：图鉴贴图改外链（不再 base64 内联），单文件约束解除   // D-114：36 件图鉴贴图内联（112px/48 色，336KB 源 → base64 460KB）   // D-113：图鉴贴图内联（12 件 160px 量化 = 186KB 源 → base64 229KB），单文件原型 818KB   // D-111：v10 道具换形后 shapes 数据 93→237KB（details 分层），单文件原型 571.1KB；生产包不内联配置，故上限放到 600KB

const ARGV = process.argv.slice(2);
const FORCE_MOCK = ARGV.includes('--mock');
const FORCE_CORE = ARGV.includes('--core');

/* ---------------- 1. 类型擦除 ---------------- */

let stripTypeScriptTypes = null;
try {
    stripTypeScriptTypes = require('node:module').stripTypeScriptTypes || null;
} catch (e) {
    stripTypeScriptTypes = null;
}
if (typeof stripTypeScriptTypes !== 'function') {
    console.warn('[build] WARN 当前 node 没有 module.stripTypeScriptTypes（需要 ≥22.13），改用保守剥离');
}

function stripTypes(src, file) {
    if (typeof stripTypeScriptTypes === 'function') {
        try {
            return stripTypeScriptTypes(src, { mode: 'strip' });
        } catch (e) {
            console.warn('[build] WARN stripTypeScriptTypes 失败（' + path.basename(file) + '）：' + e.message + ' → 改用保守剥离');
        }
    }
    return conservativeStrip(src);
}

/** 兜底：只处理本项目 core 实际用到的语法；一旦 stripTypeScriptTypes 可用就走不到这里 */
function conservativeStrip(src) {
    let out = src;
    out = out.replace(/^\s*import\b[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*;?/gm, '');
    out = out.replace(/^\s*export\s+type\s+[^;]+;\s*$/gm, '');
    out = out.replace(/^(\s*)export\s+interface\s+[\s\S]*?^\}\s*$/gm, '');
    out = out.replace(/^\s*type\s+\w+\s*=[\s\S]*?;\s*$/gm, '');
    out = out.replace(/\bexport\s+(?=(const|let|var|function|class|async)\b)/g, '');
    out = out.replace(/(\bfunction\s+\w+\s*\([^)]*\))\s*:\s*[\w<>{}\[\]|., '"']+\s*\{/g, '$1 {');
    out = out.replace(/\b(const|let|var)\s+(\w+)\s*:\s*[\w<>{}\[\]|., '"']+\s*=/g, '$1 $2 =');
    return out;
}

/** 去掉 import / export / `export *` 后，把多个模块拼进同一个作用域 */
function modulize(src, file) {
    let out = stripTypes(src, file);
    /* 多行 import 也要能整段删掉 */
    out = out.replace(/^\s*import\b[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*;?/gm, '');
    out = out.replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
    out = out.replace(/^\s*export\s+\*\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
    out = out.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
    out = out.replace(/\bexport\s+default\s+/g, '');
    out = out.replace(/\bexport\s+(?=(const|let|var|function|class|async)\b)/g, '');
    /* 残留的 import 一律清掉（防止漏网行导致 SyntaxError） */
    if (/(^|\n)\s*import\s/.test(out)) {
        console.warn('[build] WARN ' + path.basename(file) + ' 还有残留 import，已按行剔除');
        out = out.replace(/^\s*import\b.*$/gm, '');
    }
    if (/(^|\n)\s*export\s/.test(out)) {
        console.warn('[build] WARN ' + path.basename(file) + ' 还有残留 export，已按行剔除');
        out = out.replace(/^\s*export\s+/gm, '');
    }
    return out;
}

/* ---------------- 2. core 模块选择 ---------------- */

const CORE_ORDER = ['Geometry', 'Types', 'Layout', 'Shapes', 'Paths', 'Score', 'Judge', 'LevelStore', 'index'];
const IMPL_FILES = ['Shapes.ts', 'Paths.ts', 'Score.ts', 'Judge.ts', 'LevelStore.ts', 'index.ts'];

const implReady = IMPL_FILES.every((f) => fs.existsSync(path.join(CORE_DIR, f)));
let coreMode = implReady ? 'core' : 'mock';
if (FORCE_MOCK) coreMode = 'mock';
if (FORCE_CORE) {
    if (!implReady) {
        const missing = IMPL_FILES.filter((f) => !fs.existsSync(path.join(CORE_DIR, f)));
        console.error('[build] --core 要求 core 全套就位，缺：' + missing.join(', '));
        process.exit(2);
    }
    coreMode = 'core';
}

/* ---------------- 3. 配置 ---------------- */

function loadJson(p) {
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
        throw new Error('JSON 解析失败：' + path.relative(ROOT, p) + ' — ' + e.message);
    }
}

const levelsRaw = loadJson(LEVELS_JSON);
const shapesRaw = loadJson(SHAPES_JSON);

const sources = {
    levels: levelsRaw ? 'core' : 'generated',
    shapes: shapesRaw ? 'core' : 'fallback'
};

/**
 * levels.json 未就绪时的占位关卡：**只用来跑通流程与视觉，不代表策划数值**。
 * 页面左下角会打 MOCK 水印并标明 levels=generated。
 */
function generatedLevels() {
    const paths = ['h_line', 'h_line', 'h_line', 'h_line_rl', 'diag_dl', 'arc_up', 'diag_ur', 'bounce_floor', 'h_line', 'h_line', 'h_line', 'diag_dl', 'arc_down', 'bounce_floor', 'h_line'];
    const ids = ['cup_tumbler', 'cup_tumbler', 'car_hatch', 'car_hatch', 'slipper', 'banana', 'wrench', 'guitar', 'tv', 'duck', 'cat', 'octopus', 'rocket', 'burger', 'tv'];
    const out = [];
    for (let i = 0; i < 15; i++) {
        const dual = i === 8 || i === 14;
        out.push({
            id: i + 1,
            name: '占位关 ' + (i + 1),
            shapeId: ids[i],
            outlineId: ids[i],
            variant: dual ? 'dual' : 'single',
            motion: i % 3 === 2 ? '抛物' : '旋转',
            path: paths[i],
            cycleMs: 2700 - i * 95,
            turns: i < 4 ? 1 : i < 10 ? 2 : 3,
            jitter: i < 3 ? 0 : 0.02 + i * 0.004,
            toleranceDeg: i < 3 ? 15 : 8,
            passRate: 0.6,
            star3Rate: 0.93,
            estSec: 4,
            weight: 1,
            attempts: 3,
            note: 'generated placeholder (levels.json 未就绪)',
            speedStage: i === 4 ? 0.75 : 1,
            shapeId2: dual ? 'hammer' : undefined,
            linSpeed: [400, 440],
            angSpeed: [140, 170]
        });
    }
    return out;
}

let CONFIG_LEVELS;
if (levelsRaw) {
    CONFIG_LEVELS = levelsRaw; /* 原样内联，运行时交给 Core.loadLevels 校验 */
} else {
    CONFIG_LEVELS = { levels: generatedLevels() };
    console.warn('[build] WARN assets/resources/config/levels.json 不存在 → 使用占位关卡（不代表策划数值）');
}

let CONFIG_SHAPES;
if (shapesRaw) {
    CONFIG_SHAPES = shapesRaw;
} else {
    const fbSrc = fs.readFileSync(path.join(SRC_DIR, 'shapes_fallback.js'), 'utf8');
    CONFIG_SHAPES = { shapes: new Function(fbSrc + '\nreturn FALLBACK_SHAPES;')() };
    console.warn('[build] WARN assets/config/shapes.json 不存在 → 使用 _src/shapes_fallback.js 占位轮廓');
}

/* ================================================================
 * 形状门禁（v0.4 加的工程防御）：**在读数据之后、拼 bundle 之前**跑校验，
 * 坏形状直接 exit 5 —— 绝不打出"看起来成功、启动即挂"的坏包。
 * 起因：美术数据里 windmill 只有 10 个顶点，build 打出了 340KB 的产物，
 *       运行时 loadShapes 才 throw，产物看起来是好的（比运行时崩更糟）。
 * 规则与 Core.loadShapes 对齐：顶点 12–48 / 点有限 / 简单多边形 / 长边归一化 1±2%。
 * ================================================================ */
function validateShapes(raw) {
    const fatal = [];
    const warn = [];
    const list = (raw && raw.shapes) || raw || [];
    if (Object.prototype.toString.call(list) !== '[object Array]') return { fatal: ['shapes 不是数组'], warn: [] };
    const seen = new Set();
    for (const s of list) {
        const id = (s && s.id) || '(无 id)';
        if (!s || !s.id) { fatal.push('shape: 缺 id'); continue; }
        if (seen.has(s.id)) fatal.push('shape[' + id + ']: id 重复');
        seen.add(s.id);
        const pts = s.pts;
        if (!pts || pts.length < 3) { fatal.push('shape[' + id + ']: 没有 pts'); continue; }
        if (pts.length < 12 || pts.length > 80) fatal.push('shape[' + id + ']: 顶点数 ' + pts.length + ' 超出 12–80');
        let badPt = false;
        for (const p of pts) if (!p || !isFinite(p.x) || !isFinite(p.y)) badPt = true;
        if (badPt) { fatal.push('shape[' + id + ']: pts 含非有限坐标'); continue; }
        /* 面积必须非零（退化多边形画不出来） */
        let area2 = 0;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            area2 += a.x * b.y - b.x * a.y;
        }
        if (Math.abs(area2 / 2) < 1e-4) fatal.push('shape[' + id + ']: 面积≈0（退化）');
        /* 以下两条只告警不拦截：现实数据里可能有共线点/微调过的归一化，
           一律硬拦会误伤合法轮廓；真正的硬门禁是上面的顶点数与坐标。 */
        const n = pts.length;
        const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        let selfX = false;
        for (let i = 0; i < n && !selfX; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            for (let j = i + 2; j < n; j++) {
                if (i === 0 && j === n - 1) continue;
                const c = pts[j], d = pts[(j + 1) % n];
                const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
                if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
                    ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) { selfX = true; break; }
            }
        }
        if (selfX) warn.push('shape[' + id + ']: 疑似自相交（请美术确认）');
        // 归一化口径 = 包围盒长边（与 check_shapes.longSideOf 一致）。
        // 旧版这里算的是「最长单条边」，任何多边形都不可能接近 1，于是 36 件全部误报。
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const q of pts) {
            if (q.x < minX) minX = q.x;
            if (q.x > maxX) maxX = q.x;
            if (q.y < minY) minY = q.y;
            if (q.y > maxY) maxY = q.y;
        }
        const maxL = Math.max(maxX - minX, maxY - minY);
        if (!(maxL > 0)) fatal.push('shape[' + id + ']: 最长边为 0');
        else if (Math.abs(maxL - 1) > 0.02) warn.push('shape[' + id + ']: 最长边 ' + maxL.toFixed(4) + ' 未归一化到 1±2%');
    }
    return { fatal, warn };
}

const shapesCheck = validateShapes(CONFIG_SHAPES);
if (shapesCheck.warn.length) {
    console.warn('[build] WARN shapes 有 ' + shapesCheck.warn.length + ' 条非致命提醒：');
    for (const w of shapesCheck.warn.slice(0, 8)) console.warn('    · ' + w);
}
if (shapesCheck.fatal.length) {
    console.error('[build] ✗ shapes.json 校验失败（' + shapesCheck.fatal.length + ' 条致命），已中止，不产出坏包：');
    for (const b of shapesCheck.fatal.slice(0, 30)) console.error('    - ' + b);
    if (shapesCheck.fatal.length > 30) console.error('    … 还有 ' + (shapesCheck.fatal.length - 30) + ' 条');
    console.error('[build] 修完再跑：node tools\\build_proto.mjs  （退出码 5）');
    process.exit(5);
}
console.log('[build] shapes 门禁 OK：' + (((CONFIG_SHAPES || {}).shapes || []).length) + ' 个轮廓（12–80 顶点 / 坐标有限 / 非退化）');


/* ---- v0.2：把美术的 scenes.json 同步一份到 resources/（Cocos 的 resources.load 只认那里）----
   与 shapes.json 同一个坑（can_cola 那次）：源文件改了但副本没跟上 → 运行时读到旧数据。
   规则：源比副本新 / 副本缺失 → 覆盖；副本更新（有人手改过后台）→ 保留并 WARN。 */
if (fs.existsSync(SCENES_SRC)) {
    let needCopy = true;
    if (fs.existsSync(SCENES_JSON)) {
        const a = fs.statSync(SCENES_SRC).mtimeMs;
        const b = fs.statSync(SCENES_JSON).mtimeMs;
        needCopy = a > b + 1;
    }
    if (needCopy) {
        try {
            fs.mkdirSync(path.dirname(SCENES_JSON), { recursive: true });
            fs.copyFileSync(SCENES_SRC, SCENES_JSON);
            console.log('[build] scenes.json 已同步 → assets/resources/config/scenes.json（' + Math.round(fs.statSync(SCENES_SRC).size / 1024 * 10) / 10 + ' KB）');
        } catch (e) {
            console.warn('[build] WARN scenes.json 同步失败：' + e.message);
        }
    }
}

let modesRaw = loadJson(MODES_JSON);
if (modesRaw) {
    sources.modes = 'core';
} else {
    modesRaw = {
        relax: {
            cycleMs: [5200, 6800], turns: 1, jitter: 0, passRate: null, attempts: null,
            bgmGain: 0.5, sfxGain: 0.5, ratingSfx: false, showScore: false, autoNext: false,
            objectPool: ['cup_tumbler', 'car_hatch', 'can_cola', 'slipper', 'guitar', 'wrench', 'rocket', 'tv'],
            paths: ['h_line', 'arc_up', 'diag_dl', 'h_line_rl', 'arc_down', 'diag_ur', 'bounce_floor'],
            softPassRate: 0.6, holdMs: 900, fadeOutMs: 300
        },
        challenge: { source: 'levels.json', bgmGain: 1.0, sfxGain: 1.0, ratingSfx: true, showScore: true, autoNext: true }
    };
    sources.modes = 'fallback';
    console.warn('[build] WARN assets/resources/config/modes.json 不存在 → 使用内置默认值');
}

let scenesRaw = loadJson(SCENES_JSON) || loadJson(SCENES_SRC);
if (scenesRaw) {
    sources.scenes = 'core';
} else {
    const fbSrc = fs.readFileSync(path.join(SRC_DIR, 'scenes_fallback.js'), 'utf8');
    scenesRaw = new Function(fbSrc + '\nreturn FALLBACK_SCENES;')();
    sources.scenes = 'fallback';
    console.warn('[build] WARN scenes.json 不存在 → 使用 _src/scenes_fallback.js 占位场景');
}

/* ================================================================
 * v0.4：fx.json（特效外置，美术可直接改，不用重编译）
 * 源 = assets/config/fx.json（与 shapes/scenes 同级），build 自动同步到 resources/
 * ================================================================ */
const FX_SRC = path.join(ROOT, 'assets', 'config', 'fx.json');
const FX_JSON = path.join(ROOT, 'assets', 'resources', 'config', 'fx.json');
if (fs.existsSync(FX_SRC)) {
    let needCopy = true;
    if (fs.existsSync(FX_JSON)) {
        needCopy = fs.statSync(FX_SRC).mtimeMs > fs.statSync(FX_JSON).mtimeMs + 1;
    }
    if (needCopy) {
        try {
            fs.mkdirSync(path.dirname(FX_JSON), { recursive: true });
            fs.copyFileSync(FX_SRC, FX_JSON);
            console.log('[build] fx.json 已同步 → assets/resources/config/fx.json（' + Math.round(fs.statSync(FX_SRC).size / 1024 * 10) / 10 + ' KB）');
        } catch (e) {
            console.warn('[build] WARN fx.json 同步失败：' + e.message);
        }
    }
}
const fxRaw = loadJson(FX_JSON) || loadJson(FX_SRC) || null;
if (fxRaw) {
    sources.fx = 'core';
} else {
    console.warn('[build] WARN assets/config/fx.json 不存在 → game.js 用内置 DEFAULT_FX 兜底（S5 会红）');
}

/* ================================================================
 * v0.9：collection.json（36 道具图鉴 + 15 档阈值 + 助眠第 2 圈顺序表）
 * 单源 = assets/resources/config/collection.json；缺失时留 null，
 * game.js 的 normalizeCollection 会给空表（S30/S34/S36 会红，不会静默变绿）。
 * 这里做一次**构建期门禁**：36 个 id 必须与 shapes.json 完全一致，池子口径必须是 21/15。
 * ================================================================ */
const collectionRaw = loadJson(COLLECTION_JSON);
if (collectionRaw) {
    sources.collection = 'core';
    const shapeIds = (CONFIG_SHAPES && CONFIG_SHAPES.shapes ? CONFIG_SHAPES.shapes : []).map((s) => s.id).sort();
    const order = (collectionRaw.order || []).slice().sort();
    const missing = shapeIds.filter((id) => order.indexOf(id) < 0);
    const extra = order.filter((id) => shapeIds.indexOf(id) < 0);
    const mainN = ((collectionRaw.pools || {}).mainline || []).length;
    const rareN = ((collectionRaw.pools || {}).rare || []).length;
    const thN = (collectionRaw.thresholds || []).length;
    const problems = [];
    if (missing.length) problems.push('图鉴缺形状 ' + missing.join(','));
    if (extra.length) problems.push('图鉴里有 shapes.json 不存在的 id ' + extra.join(','));
    if (order.length !== shapeIds.length) problems.push('图鉴格数 ' + order.length + ' ≠ 形状数 ' + shapeIds.length);
    if (mainN !== 21) problems.push('主线池应为 21，实际 ' + mainN);
    if (rareN !== 15) problems.push('稀有池应为 15，实际 ' + rareN);
    if (thN !== rareN) problems.push('阈值数 ' + thN + ' ≠ 稀有池 ' + rareN);
    const badOrders = [];
    for (const [sid, arr] of Object.entries((collectionRaw.relaxCycle2 || {}).orders || {})) {
        if (!Array.isArray(arr) || arr.length !== shapeIds.length || new Set(arr).size !== shapeIds.length) badOrders.push(sid);
    }
    if (badOrders.length) problems.push('助眠顺序表不是 36 的排列：' + badOrders.join(','));
    if (problems.length) {
        console.error('[build] collection.json 门禁失败：' + problems.join('；'));
        process.exit(6);
    }
    console.log('[build] collection 门禁 OK：36 格 / 主线 21 + 稀有 15 · 阈值 ' + thN + ' 档 · 三场景顺序表 36 项');
} else {
    sources.collection = 'none';
    console.warn('[build] WARN assets/resources/config/collection.json 不存在 → 图鉴为空（S30/S34/S36 会红）');
}

/* ================================================================
 * v0.4：60 关数据
 *   挑战：优先 assets/resources/config/levels.json（core 导出，含 season/sine/inertia 派生窗口）；
 *         若它还是旧的 15 关（core 正在重出），build 直接解析 01_策划文档/levels.csv 临时顶上，
 *         并在报告里写 sources.levels='csv-fallback' —— 这份只喂原型，不动 core 的数据流。
 *   催眠：优先 assets/resources/config/levels_relax.json；否则解析 01_策划文档/levels_relax.csv。
 * ================================================================ */

/** 极简 CSV 解析（带引号/逗号；本项目数据里没有跨行字段） */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (ch === '\r') { /* skip */ }
        else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.length && r.some((c) => String(c).trim() !== ''));
}

function num(v, dflt) {
    const n = parseFloat(String(v == null ? '' : v));
    return isFinite(n) ? n : dflt;
}

/** CSV 行 → core 期望的 level 定义（字段名与 levels.json 对齐） */
function csvRowToDef(h, r) {
    const g = (k) => {
        const i = h.indexOf(k);
        return i < 0 ? '' : r[i];
    };
    const variant = g('variant') || 'single';
    const def = {
        id: num(g('id'), 0),
        name: g('name'),
        shapeId: g('object_id'),
        outlineId: g('outline_id') || g('object_id'),
        variant: variant,
        motion: g('motion_type') || '旋转',
        path: g('path'),
        cycleMs: num(g('cycle_ms'), 2000),
        turns: num(g('turns'), 1),
        jitter: num(g('jitter'), 0),
        toleranceDeg: num(g('tolerance_deg'), 15),
        passRate: num(g('pass_rate'), 0.6),
        star3Rate: num(g('star3_rate'), 0.93),
        estSec: num(g('est_seconds'), 5),
        weight: num(g('weight'), 1),
        attempts: num(g('attempts'), 3),
        note: g('note') || '',
        speedStage: num(g('speed_stage'), 1),
        hitTargetMs: num(g('hit_target_ms'), 0),
        season: num(g('season'), 1)
    };
    if (variant === 'dual' && g('object_id_2')) def.shapeId2 = g('object_id_2');
    /* v0.4 运动属性 + v0.6 错拍字段：**全部可选**（core 没导出时缺省忽略） */
    ['sine_amp', 'sine_period_ms', 'inertia_px', 'inertia_hz', 'inertia_phase', 'inertia_phase2',
        'sine_phase', 'phase_2', 'cycle_2_ms', 'time_limit_sec'].forEach((k) => {
        const v = g(k);
        if (String(v).trim() === '') return;
        const camel = k.replace(/_([a-z0-9])/g, (m, c) => c.toUpperCase());
        def[camel] = num(v, 0);
    });
    return def;
}

function loadCsvLevels(file, label) {
    if (!fs.existsSync(file)) return null;
    try {
        const rows = parseCsv(fs.readFileSync(file, 'utf8'));
        if (rows.length < 2) return null;
        const h = rows[0].map((s) => String(s).trim());
        const levels = rows.slice(1).map((r) => csvRowToDef(h, r)).filter((d) => d.id > 0 && d.shapeId);
        return levels.length ? { version: 4, levelCount: levels.length, source: path.basename(file), levels: levels } : null;
    } catch (e) {
        console.warn('[build] WARN ' + label + ' 解析失败：' + e.message);
        return null;
    }
}

const LEVELS_CSV = path.join(ROOT, '01_策划文档', 'levels.csv');
const RELAX_CSV = path.join(ROOT, '01_策划文档', 'levels_relax.csv');
const RELAX_JSON = path.join(ROOT, 'assets', 'resources', 'config', 'levels_relax.json');

/**
 * 挑战：core JSON 若已含 60 关则优先，否则用 CSV 临时顶上。
 * v0.6 追加一条：CSV 里已经有而 JSON 里还没有的**新字段**（`phase_2`/`cycle_2_ms`/`time_limit_sec`）
 * 也要能从 CSV 生效 —— 否则策划把 L50/L60 的错拍写进 CSV 后，build 仍读旧 JSON，
 * 前端 `isDesync()` 永远是 false，会得出"错拍没实现"的假结论。
 * 规则：JSON 缺 `phase2` 而 CSV 有任一行 `phase_2 > 0` → 用 CSV，并在报告里写明原因。
 */
const coreLevelsCount = (CONFIG_LEVELS && CONFIG_LEVELS.levelCount) || ((CONFIG_LEVELS && CONFIG_LEVELS.levels) || []).length;
const jsonHasPhase2 = (((CONFIG_LEVELS || {}).levels) || []).some((d) => Number(d.phase2 || d.phase_2 || 0) > 0);
if (coreLevelsCount < 60 || !jsonHasPhase2) {
    const csvLv = loadCsvLevels(LEVELS_CSV, 'levels.csv');
    const csvHasPhase2 = csvLv && (csvLv.levels || []).some((d) => Number(d.phase2 || 0) > 0);
    if (csvLv && csvLv.levelCount >= coreLevelsCount && (coreLevelsCount < 60 || csvHasPhase2)) {
        CONFIG_LEVELS = csvLv;
        sources.levels = 'csv-fallback';
        console.log('[build] ' + (coreLevelsCount < 60
            ? 'levels.json 只有 ' + coreLevelsCount + ' 关 → '
            : 'levels.json 缺 phase_2（错拍字段），CSV 已有 → ') +
            '临时直连 01_策划文档/levels.csv（' + csvLv.levelCount + ' 关' +
            (csvHasPhase2 ? '，含错拍关' : '') + '）');
    }
}

/** 催眠 60 关 */
let levelsRelax = loadJson(RELAX_JSON);
if (levelsRelax) sources.levelsRelax = 'core';
if (!levelsRelax || !((levelsRelax.levels || []).length >= 60)) {
    const csvRelax = loadCsvLevels(RELAX_CSV, 'levels_relax.csv');
    if (csvRelax) {
        levelsRelax = csvRelax;
        sources.levelsRelax = 'csv-fallback';
        console.log('[build] levels_relax.json 不可用 → 临时直连 01_策划文档/levels_relax.csv（' + csvRelax.levelCount + ' 关）');
    }
}
if (!levelsRelax) {
    levelsRelax = CONFIG_LEVELS; /* 最差情况：催眠复用挑战表，不让产物变砖 */
    sources.levelsRelax = 'fallback-levels';
    console.warn('[build] WARN 没有催眠关卡数据 → 复用挑战表');
}


/* ---------------- 4. core 拼装 ---------------- */

const sizes = [];
const coreParts = [];
const declared = new Map(); /* 顶层标识符 → 首次出现的文件（查重名） */

function noteDeclarations(text, file) {
    const re = /^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        const name = m[1] || m[2];
        if (declared.has(name)) {
            console.warn('[build] WARN 顶层重名 "' + name + '"：' + declared.get(name) + ' ↔ ' + path.basename(file) + '（拼接后后者覆盖前者）');
        } else {
            declared.set(name, path.basename(file));
        }
    }
}

for (const name of CORE_ORDER) {
    const file = path.join(CORE_DIR, name + '.ts');
    if (!fs.existsSync(file)) {
        if (coreMode === 'core') {
            console.error('[build] --core 模式缺文件：' + path.relative(ROOT, file));
            process.exit(2);
        }
        continue;
    }
    const src = fs.readFileSync(file, 'utf8');
    const out = modulize(src, file);
    noteDeclarations(out, file);
    sizes.push({ file: 'assets/scripts/core/' + name + '.ts', bytes: Buffer.byteLength(out, 'utf8') });
    coreParts.push('/* ==== core/' + name + '.ts (' + Buffer.byteLength(out, 'utf8') + ' B) ==== */\n' + out.trim() + '\n');
}

if (coreMode === 'mock') {
    const mockFile = path.join(SRC_DIR, 'mock_core.js');
    const out = fs.readFileSync(mockFile, 'utf8');
    noteDeclarations(out, mockFile);
    sizes.push({ file: '原型/_src/mock_core.js', bytes: Buffer.byteLength(out, 'utf8') });
    coreParts.push('/* ==== 原型/_src/mock_core.js (' + Buffer.byteLength(out, 'utf8') + ' B) ==== */\n' + out.trim() + '\n');
}

/* 导出表：用 typeof 守卫，core 里还没实现的 API 不会让整包炸掉 */
const EXPORTS = [
    /* Layout 冻结常量 */
    'DESIGN_W', 'DESIGN_H', 'SAFE', 'HUD', 'PLAY', 'PAUSE_BTN', 'TARGET_SINGLE', 'TARGET_DUAL',
    'VERDICT_TEXT', 'TIMING_TEXT', 'COMBO', 'MODE_COEF', 'FEEDBACK_MS', 'RETRY_DELAY_MS', 'STAR_SPLIT',
    'RATING_FX', 'MUTE_BTN',
    /* Geometry */
    'v', 'clamp', 'normDeg', 'polyArea', 'polyCentroid', 'polyBounds', 'rotateAbout', 'place', 'scaleLocal',
    'pointInPoly', 'overlapAreaExact', 'overlapAreaRaster', 'overlapPercent',
    /* CoreApi */
    'loadShapes', 'loadLevels', 'buildLevel', 'uAt', 'poseAt', 'objectPtsAt', 'judge', 'ratingOf', 'RATINGS',
    /* 绘制/判定辅助（原型按需取用） */
    'objectScaleOf', 'shapeUnitArea', 'requireShape', 'starsOf', 'starsOfResult', 'scoreOf', 'comboMultiplier',
    'ON_TIME_MS', 'overlapStrips', 'missStrips', 'heatBands', 'hitWindow', 'windowMetrics',
    'wrapT', 'wrapDelta', 'PATH_IDS',
    /* v0.6 错拍（白名单只作兜底：正常路径由 Core 命名空间整体拷入） */
    'judgeNearest', 'duoVerdict'
];

const exportLines = EXPORTS.map((n) => "  API." + n + " = (typeof " + n + " !== 'undefined') ? " + n + ' : undefined;');

/* ================================================================
 * 运行时 API 组装：**先吃 core 自己的 `Core` 对象，白名单只当兜底**（lead 2026-10-18 裁定方案 B）
 * 起因：core 的 index.ts 里 `Core = {...}` 已含 `judgeNearest`/`duoVerdict`，但这里的 EXPORTS 是硬编码
 *       白名单，没列到 → 产物里 `CORE.judgeNearest === undefined` → 错拍关静默失效、M20 假红。
 * 教训：**"core 有、产物没有"是一类独立故障**——白名单每加一个 API 就要改第二处，必然继续漏。
 * 现在 core 往 `Core` 里加任何东西，产物自动就有；白名单只负责 mock 模式/`Core` 缺失时凑出必需 API。
 * ================================================================ */
const coreBlock = [
    'var CORE = (function () {',
    coreParts.join('\n'),
    '  var API = {};',
    '  if (typeof Core !== "undefined" && Core) { for (var _k in Core) { if (Object.prototype.hasOwnProperty.call(Core, _k)) API[_k] = Core[_k]; } }',
    exportLines.join('\n'),
    '  return API;',
    '})();'
].join('\n');

/* ---------------- 5. 游戏逻辑 + 音频 ---------------- */

const audioFile = path.join(SRC_DIR, 'audio.js');
const audioSrc = fs.readFileSync(audioFile, 'utf8');
sizes.push({ file: '原型/_src/audio.js', bytes: Buffer.byteLength(audioSrc, 'utf8') });

const gameFile = path.join(SRC_DIR, 'game.js');
const gameSrc = fs.readFileSync(gameFile, 'utf8');
sizes.push({ file: '原型/_src/game.js', bytes: Buffer.byteLength(gameSrc, 'utf8') });


/* v11：图鉴贴图（位图只用于静态展示；局内仍是多边形）。D-118：改为相对路径外链 */
const SPRITE_DIR = path.join(ROOT, '03_交付素材', 'gallery_sprites_112');
function loadGallerySprites() {
    if (!fs.existsSync(SPRITE_DIR)) return {};
    const out = {};
    for (const f of fs.readdirSync(SPRITE_DIR)) {
        if (!f.endsWith('.png')) continue;
        const id = f.replace(/\.png$/, '');
        /* D-118：外链（原型与 03_交付素材 同级），不再 base64 内联 */
        out[id] = '../03_交付素材/gallery_sprites_112/' + f;
    }
    return out;
}
const GALLERY_SPRITES = loadGallerySprites();


/* D-125：局内也画贴图（与图鉴同一张 256px 图），判定仍用多边形 */
const GAME_SPRITE_DIR = path.join(ROOT, '03_交付素材', 'gallery_sprites');
function loadGameSprites() {
    if (!fs.existsSync(GAME_SPRITE_DIR)) return {};
    const out = {};
    for (const f of fs.readdirSync(GAME_SPRITE_DIR)) {
        if (!f.endsWith('.png')) continue;
        out[f.replace(/\.png$/, '')] = '../03_交付素材/gallery_sprites/' + f;
    }
    return out;
}
const GAME_SPRITES = loadGameSprites();

const configJson = JSON.stringify({
    levels: CONFIG_LEVELS,
    levelsRelax: levelsRelax,
    shapes: CONFIG_SHAPES,
    modes: modesRaw,
    scenes: scenesRaw,
    fx: fxRaw,
    collection: collectionRaw,
    gallerySprites: GALLERY_SPRITES,
    gameSprites: GAME_SPRITES,
    coreMode,
    sources
})
    .replace(/<\//g, '<\\/'); /* 防止数据里出现 </script> 把 HTML 截断 */
sizes.push({ file: '__CONFIG__ (levels+shapes+modes+scenes+collection 内联)', bytes: Buffer.byteLength(configJson, 'utf8') });

/* REQUIRED_API：既检查"core 源码里有没有"，也检查"产物 API 里有没有"。
   v0.6 的教训：函数写好了、`Core` 里也有了，但 EXPORTS 白名单没列 → 产物里是 undefined。
   所以这里列出**所有运行时必需**的名字（含错拍），并把它们同时加入 EXPORTS 兜底。 */
const REQUIRED_API = [
    'buildLevel', 'poseAt', 'objectPtsAt', 'judge', 'ratingOf', 'loadShapes', 'loadLevels',
    /* v0.6 错拍：少了这两个，错拍关会静默失效（按一次就结算的假象最难看） */
    'judgeNearest', 'duoVerdict'
];
const coreSrcAll = coreParts.join('\n');
const missingApi = REQUIRED_API.filter((n) => !new RegExp('\\b(function|var|const|let)\\s+' + n + '\\b').test(coreSrcAll));
if (missingApi.length) {
    console.error('[build] core 源码缺少必需 API：' + missingApi.join(', '));
    process.exit(3);
}
/* 运行时可见性：**真的把 coreBlock 求值一次**，看产物 API 里到底有没有这些名字。
   这比正则猜"源码里写没写"可靠得多 —— v0.6 的坑正是"写了、也在 Core 里，但白名单没列"。
   求值失败（core 引用了 window 等）时回落到正则启发式，并明确 WARN 一声。 */
let coreKeys = null;
try {
    coreKeys = new Function(coreBlock + '\nreturn Object.keys(CORE);')();
} catch (e) {
    console.warn('[build] WARN coreBlock 无法在 node 里求值（' + (e && e.message ? e.message.split('\n')[0] : e) + '）→ 退回源码正则检查');
}
if (coreKeys) {
    const notExported = REQUIRED_API.filter((n) => coreKeys.indexOf(n) < 0);
    if (notExported.length) {
        console.error('[build] 产物 API 缺少必需成员：' + notExported.join(', '));
        console.error('[build] 说明：core 里可能有实现，但既不在 Core 命名空间、也不在 EXPORTS 白名单 → 运行时会 undefined。');
        process.exit(3);
    }
    console.log('[build] 运行时 API 检查通过：' + coreKeys.length + ' 个成员，必需 ' + REQUIRED_API.length + ' 个齐全');
} else {
    const notInNs = REQUIRED_API.filter((n) => !new RegExp('\\b' + n + '\\s*[:,]').test(coreSrcAll));
    if (notInNs.length) {
        console.warn('[build] WARN 这些名字在 core 源码里没有明显的命名空间条目（可能只在 EXPORTS 兜底）：' + notInNs.join(', '));
    }
}

/* ---------------- 6. HTML 外壳 ---------------- */

const HTML_HEAD = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="color-scheme" content="dark">
<title>定格瞬间 · 原型</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #060A12; }
  body { -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; }
  #cv { display: block; width: 100vw; height: 100vh; touch-action: manipulation; }
  #errbar {
    display: none; position: fixed; left: 0; right: 0; top: 0; z-index: 99;
    background: #FF6B6B; color: #1A0404; padding: 8px 12px;
    font: 600 14px/1.5 system-ui, "Microsoft YaHei", sans-serif; white-space: pre-wrap;
  }
</style>
<script>
/* 最先执行的错误网：异常写进 <title>，并给 <html> 打 data-js-error 标记（供 --dump-dom 检查），
   同时在页面顶部画红条。注意：这里刻意不写完整的属性字面量，避免 dump-dom 全文匹配时误报。 */
(function () {
  function report(msg) {
    var s = String(msg == null ? 'unknown' : msg).replace(/\\s+/g, ' ').slice(0, 160);
    try { document.title = 'JS-ERROR: ' + s; } catch (e) {}
    try { document.documentElement.setAttribute('data-js-error', '1'); } catch (e) {}
    var bar = document.getElementById('errbar');
    if (bar) { bar.style.display = 'block'; bar.textContent = 'JS-ERROR: ' + s; }
  }
  window.__distaError = report;
  window.onerror = function (m, src, line, col, err) {
    report((err && (err.stack || err.message)) || m);
    return false;
  };
  window.addEventListener('unhandledrejection', function (ev) {
    report('unhandledrejection: ' + ((ev.reason && (ev.reason.stack || ev.reason.message)) || ev.reason));
  }, false);
})();
</script>
</head>
<body>
<canvas id="cv"></canvas>
<div id="errbar"></div>
<script>
/* 本文件由 tools/build_proto.mjs 生成，请勿手改。
   core=${coreMode}  levels=${sources.levels}  shapes=${sources.shapes} */
(function () {
window.__CONFIG__ = ${configJson};

${coreBlock}

/* ==== 原型/_src/audio.js ====  音乐/音效的唯一数据源 + 两个渲染器
   （浏览器走 WebAudio；node 离线渲染走 tools/render_audio.mjs —— 两边同一份 events） */
${audioSrc.trim()}

${gameSrc.trim()}
})();
</script>
</body>
</html>
`;

/* ---------------- 7. 落盘前先做语法自检（build 自己就能挡住拼接口径的错） ---------------- */

const bundleOnly = HTML_HEAD.slice(HTML_HEAD.indexOf('window.__CONFIG__ = '));
try {
    // eslint-disable-next-line no-new-func
    new Function(bundleOnly.slice(0, bundleOnly.lastIndexOf('})();')));
} catch (e) {
    console.error('[build] bundle 语法自检失败：' + e.message);
    console.error('[build] 提示：检查 core 里是否有未擦除的 TS 语法或残留 import/export');
    process.exit(4);
}

const totalBytes = Buffer.byteLength(HTML_HEAD, 'utf8');
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, HTML_HEAD, 'utf8');

/* ---------------- 8. 报告 ---------------- */

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log('');
console.log('==== build_proto ====');
console.log('core 模式        : ' + coreMode + (FORCE_MOCK ? ' (--mock)' : FORCE_CORE ? ' (--core)' : ' (auto)'));
console.log('levels 来源      : ' + sources.levels + (sources.levels === 'core' ? ' (assets/resources/config/levels.json)' : ' (generated placeholder)'));
console.log('shapes 来源      : ' + sources.shapes + (sources.shapes === 'core' ? ' (assets/config/shapes.json)' : ' (原型/_src/shapes_fallback.js)'));
console.log('modes 来源       : ' + sources.modes + (sources.modes === 'core' ? ' (assets/resources/config/modes.json)' : ' (built-in default)'));
console.log('fx 来源          : ' + (sources.fx || 'none') + (sources.fx === 'core' ? ' (assets/config/fx.json → 已同步 resources/)' : ' (game.js DEFAULT_FX 兜底)'));
console.log('collection 来源  : ' + (sources.collection || 'none') + (sources.collection === 'core' ? ' (assets/resources/config/collection.json)' : ''));
console.log('关数             : challenge=' + (((CONFIG_LEVELS || {}).levels || []).length) + ' (' + sources.levels + ')  relax=' + (((levelsRelax || {}).levels || []).length) + ' (' + (sources.levelsRelax || 'none') + ')');
console.log('scenes 来源      : ' + sources.scenes + (sources.scenes === 'core' ? ' (assets/config/scenes.json → 已同步 resources/)' : ' (原型/_src/scenes_fallback.js)'));
console.log('语法自检         : OK');
console.log('---------------------');
console.log(pad('文件', 42) + pad('字节', 10));
for (const s of sizes) console.log(pad(s.file, 42) + pad(String(s.bytes), 10));
console.log('---------------------');
console.log(pad('产物 原型/dista_prototype.html', 42) + pad(String(totalBytes), 10));
console.log('总大小           : ' + (totalBytes / 1024).toFixed(1) + ' KB（上限 ' + (MAX_BYTES / 1024) + ' KB = ' + MAX_BYTES + ' B · 占用 '
    + (totalBytes / MAX_BYTES * 100).toFixed(1) + '%）' + (totalBytes > MAX_BYTES ? '  [超出上限]' : ''));
console.log('');
if (totalBytes > MAX_BYTES) {
    console.error('[build] 体积超上限：' + totalBytes + ' B > ' + MAX_BYTES + ' B（D-103 500 KB）。'
        + '先压缩本次新增的冗余（注释/重复常量/未用分支），不许砍需求。');
    process.exit(7);
}
