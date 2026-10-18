/**
 * gen60.mjs —— v0.4 的 60 关配置生成器（唯一入口，改这里是唯一正确的改法）
 *
 * 规则：
 *  - 季 1（L1–15）：逐字保留 v0.3 备份的 15 行，只补 season/sine/inertia 字段（0）
 *  - 季 2–4：池 = 上一季池 + 本季新增，**按 k 降序排**（宽容在前、敏感在后）
 *            → 周期递减 + k 递减 ⇒ 窗口天然递减
 *  - 变量引入关（每季前 3 关）周期与季首持平：一关只引入一个新机制
 *  - 双物体关一律 h_line（bounce/arc 的双车道 uStar 曾有 bug，已修但仍不放开）
 *
 * 用法：
 *   node _probe/gen60.mjs            挑战 60 关 → 01_策划文档/levels.csv
 *   node _probe/gen60.mjs --relax    催眠 60 关 → 01_策划文档/levels_relax.csv
 */
import fs from 'node:fs';

const CSV = '01_策划文档/levels.csv';
const SRC15 = '01_策划文档/levels_v0.3_backup.csv';
const RELAX = '01_策划文档/levels_relax.csv';

const K = {
    cup_tumbler: 0.0371, car_hatch: 0.0467, can_cola: 0.0426, slipper: 0.0329, book: 0.0710, mug: 0.0482,
    guitar: 0.0254, wrench: 0.0252, rocket: 0.0200, tv: 0.0449, skateboard: 0.0195, camera: 0.0504,
    handheld: 0.0518, dessert: 0.0322, octopus: 0.0413, cat: 0.0433, duck: 0.0433, burger: 0.0499,
    toilet: 0.0283, banana: 0.0245, hammer: 0.0222, crab: 0.0460, mecha_doll: 0.0341,
    toaster: 0.0505, teapot: 0.0448, headphone: 0.0315, sneaker: 0.0446, icecream: 0.0334,
    saxophone: 0.0198, lobster: 0.0329, cactus: 0.0291, dino: 0.0320,
    windmill: 0.0293, satellite: 0.0313, anchor: 0.0246, dragon: 0.0315,
};

const NEW2 = ['toaster', 'teapot', 'headphone', 'sneaker', 'icecream'];
const OLD8 = ['book', 'mug', 'skateboard', 'camera', 'handheld', 'dessert', 'crab', 'mecha_doll'];
const NEW3 = ['saxophone', 'lobster', 'cactus', 'dino'];
const NEW4 = ['windmill', 'satellite', 'anchor', 'dragon'];

const PATHS = ['h_line', 'diag_dl', 'arc_up', 'diag_ur', 'h_line_rl', 'arc_down', 'bounce_floor'];

/* v0.6 双物体错拍（D-064）：只做 2 关 + 1 关对照。
 * L50 phase 0.38 / L60 phase 0.40 / L55 保持同步（phase 0）→ A/B 能看出错拍难度。
 * 错拍关时限 20 秒（15 秒连续卡两次太紧）。*/
const DESYNC = { 50: 0.38, 60: 0.4 };

const SEASONS = [
    { s: 2, from: 16, to: 30, turns: [2, 2], sine: [0.04, 0.10], inertia: 0, cycStart: 2200, cycEnd: 1500 },
    { s: 3, from: 31, to: 45, turns: [2, 2], sine: [0.06, 0.12], inertia: [2, 5], cycStart: 1900, cycEnd: 1350 },
    { s: 4, from: 46, to: 60, turns: [3, 3], sine: [0.08, 0.14], inertia: [4, 6], cycStart: 1700, cycEnd: 1200 },
];

const lerp = (a, b, t) => a + (b - a) * t;
const byKDesc = (arr) => arr.slice().sort((a, b) => (K[b] || 0.035) - (K[a] || 0.035));

/* ============ v0.5 机制节奏表（每 3 关一段，段首 = 机制节点，速度持平） ============
 * 设计原则：一个新机制换一次速度提升；机制关只加机制不提速（一关最多两个难度变量）。
 * 季 2 引入正弦（弱→强）、季 3 引入惯性（横→纵→斜）、季 4 引入 3 圈与相位镜像。
 */
const BEATS = {
    2: [
        { label: '正弦弱', sine: 0.04, inertia: 0, iphase: 0 },
        { label: '正弦中', sine: 0.08, inertia: 0, iphase: 0 },
        { label: '正弦强', sine: 0.12, inertia: 0, iphase: 0 },
        { label: '双物体', sine: 0.12, inertia: 0, iphase: 0 },
        { label: '正弦强+斜线', sine: 0.12, inertia: 0, iphase: 0 },
    ],
    3: [
        { label: '惯性横向首现', sine: 0.06, inertia: 2, iphase: 0 },
        { label: '惯性纵向', sine: 0.10, inertia: 3, iphase: 0.25 },
        { label: '惯性斜向', sine: 0.10, inertia: 4, iphase: 0.125 },
        { label: '双物体+惯性', sine: 0.10, inertia: 5, iphase: 0 },
        { label: '强惯性+弧线', sine: 0.12, inertia: 5, iphase: 0.25 },
    ],
    4: [
        { label: '三圈首现', sine: 0.10, inertia: 4, iphase: 0, turns: 3 },
        { label: '三圈+强正弦', sine: 0.14, inertia: 5, iphase: 0.125, turns: 3 },
        { label: '三圈+斜线', sine: 0.14, inertia: 6, iphase: 0, turns: 3 },
        { label: '呼吸加快+双物体', sine: 0.14, inertia: 6, iphase: 0.25, turns: 3, sratio: 0.35 },
        { label: '全机制收紧（弹跳）', sine: 0.14, inertia: 6, iphase: 0.5, turns: 3, sratio: 0.35 },
    ],
};
function beatOf(season, i) {
    const list = BEATS[season] || [{ label: '匀速', sine: 0, inertia: 0, iphase: 0 }];
    return list[Math.min(list.length - 1, Math.floor(i / 3))];
}

function readCsv(p) {
    const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0].split(',');
    const rows = lines.slice(1).map((l) => {
        const c = l.split(',');
        const o = {};
        header.forEach((h, i) => (o[h.trim()] = (c[i] ?? '').trim()));
        return o;
    });
    return { header, rows };
}

function buildChallenge() {
    const { header, rows } = readCsv(SRC15);
    if (rows.length !== 15) throw new Error('季 1 源文件不是 15 行，实际 ' + rows.length);
    for (const r of rows) {
        r.season = '1'; r.sine_amp = '0'; r.sine_period_ms = '960'; r.inertia_px = '0';
        r.inertia_hz = '1.0'; r.inertia_phase = '0'; r.sine_phase = '0';
        r.phase_2 = '0'; r.cycle_2_ms = '0'; r.time_limit_sec = '';
    }
    const extra = ['season', 'sine_amp', 'sine_period_ms', 'sine_phase', 'inertia_px', 'inertia_hz', 'inertia_phase', 'phase_2', 'cycle_2_ms', 'time_limit_sec'];
    const fullHeader = header.concat(extra.filter((k) => !header.includes(k)));

    const s1Pool = [...new Set(rows.map((r) => r.object_id))];
    const pool2 = byKDesc([...NEW2, ...OLD8, ...s1Pool]);
    const pool3 = byKDesc([...NEW3, ...pool2]);
    const pool4 = byKDesc([...NEW4, ...pool3]);

    for (const def of SEASONS) {
        const pool = def.s === 2 ? pool2 : def.s === 3 ? pool3 : pool4;
        const n = def.to - def.from + 1;
        let prevCyc = Math.round(def.cycStart);
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            const beat = beatOf(def.s, i);          /* 机制节奏表（每 3 关一段） */
            const beatStart = i % 3 === 0;          /* 机制节点关：速度持平 */
            const cyc = beatStart ? prevCyc
                : (i === 0 ? Math.round(def.cycStart) : Math.round(lerp(def.cycStart, def.cycEnd, t)));
            prevCyc = cyc;
            const dual = i % 5 === 4;
            const shape = pool[i % pool.length];
            const shape2 = dual ? pool[(i + 7) % pool.length] : '';
            const turns = beat.turns != null ? beat.turns : def.turns[i % def.turns.length];
            const sine = beat.sine;
            const inert = beat.inertia;
            const note = beatStart ? '\u673a\u5236\uff1a' + beat.label : '\u5b63\u5185\u63d0\u901f';
            /* v0.5 路径渐进放开（D-059）：季 2 只加 diag、季 3 加 arc、季 4 全开；
               **按关序渐进**（越靠季末路径越弯），不做 %len 循环——循环会让难度跳动。
               双物体关仍强制 h_line（车道 1 等距变换后弧线可能飞出可玩区）。 */
            const pathsOfSeason = def.s === 2 ? ['h_line', 'diag_dl']
                : def.s === 3 ? ['h_line', 'diag_dl', 'arc_up']
                    : ['h_line', 'diag_dl', 'arc_up', 'bounce_floor'];
            const pathIdx = Math.min(pathsOfSeason.length - 1, Math.floor((i * pathsOfSeason.length) / n));
            const path = dual ? 'h_line' : pathsOfSeason[pathIdx];
            rows.push({
                id: String(def.from + i),
                name: '\u7b2c' + def.s + '\u5b63\u00b7' + String(i + 1).padStart(2, '0'),
                object_id: shape,
                outline_id: shape,
                motion_type: inert > 0 ? '\u7ec4\u5408' : '\u65cb\u8f6c',
                ang_speed_min: String(Math.round(((360 * turns * 1000) / cyc) * 0.98)),
                ang_speed_max: String(Math.round(((360 * turns * 1000) / cyc) * 1.02)),
                lin_speed_min: String(Math.round((1000 / cyc) * 0.98)),
                lin_speed_max: String(Math.round((1000 / cyc) * 1.02)),
                jitter: def.s === 2 ? '0.05' : def.s === 3 ? '0.08' : '0.10',
                tolerance_deg: '5',
                pass_rate: def.s === 2 ? '0.62' : def.s === 3 ? '0.66' : '0.70',
                star3_rate: '0.94',
                est_seconds: '5',
                weight: '0.5',
                note: note,
                path: path, /* v0.5 渐进放开，见上面 pathsOfSeason（D-059） */
                cycle_ms: String(cyc),
                turns: String(turns),
                speed_stage: '1',
                variant: dual ? 'dual' : 'single',
                object_id_2: shape2,
                attempts: '3',
                hit_target_ms: '0',
                season: String(def.s),
                sine_amp: String(sine),
                sine_period_ms: String(Math.max(600, Math.min(1600, Math.round(cyc * (beat.sratio || 0.5))))),
                sine_phase: String(beat.sphase != null ? beat.sphase : 0),
                inertia_px: String(inert),
                inertia_hz: String((0.7 + (i % 3) * 0.2).toFixed(1)),
                inertia_phase: String(beat.iphase != null ? beat.iphase : 0),
                phase_2: String(DESYNC[def.from + i] || 0),
                cycle_2_ms: '0',
                time_limit_sec: DESYNC[def.from + i] ? '20' : '',
            });
        }
    }
    const out = [fullHeader.join(','), ...rows.map((r) => fullHeader.map((h) => r[h] ?? '').join(','))].join('\n') + '\n';
    fs.writeFileSync(CSV, out, 'utf8');
    return rows.length;
}

function buildRelax() {
    const { rows: chal } = readCsv(CSV);
    const pool = ['cup_tumbler', 'car_hatch', 'can_cola', 'slipper', 'book', 'mug',
        'guitar', 'wrench', 'tv', 'rocket', 'skateboard', 'camera', 'handheld', 'dessert', 'toilet'];
    const paths = ['h_line', 'diag_dl', 'arc_up', 'bounce_floor'];
    const header = ['id', 'season', 'name', 'object_id', 'motion_type', 'path', 'cycle_ms', 'turns',
        'jitter', 'sine_amp', 'inertia_px', 'variant', 'object_id_2', 'hit_target_ms'];
    const rows = [];
    for (let i = 0; i < 15; i++) {
        const c = chal[i];
        rows.push({
            id: String(i + 1), season: String(Math.ceil((i + 1) / 15)),
            name: '\u653e\u677e\u00b7' + String(i + 1).padStart(2, '0'),
            object_id: c.object_id, motion_type: '\u65cb\u8f6c', path: c.path,
            cycle_ms: String(5200 + ((i * 137) % 900)), turns: '1',
            jitter: '0', sine_amp: '0', inertia_px: '0',
            variant: c.variant || 'single', object_id_2: c.object_id_2 || '', hit_target_ms: '260',
        });
    }
    let n = 15;
    for (let round = 0; round < 3; round++) {
        for (let p = 0; p < pool.length; p++) {
            n++;
            const dual = n % 5 === 0;
            rows.push({
                id: String(n), season: String(Math.ceil(n / 15)),
                name: '\u653e\u677e\u00b7' + String(n).padStart(2, '0'),
                object_id: pool[p], motion_type: '\u65cb\u8f6c',
                path: dual ? 'h_line' : paths[(p + round) % 4],
                cycle_ms: String(5200 + ((n * 137) % 900)), turns: '1',
                jitter: '0', sine_amp: '0', inertia_px: '0',
                variant: dual ? 'dual' : 'single',
                object_id_2: dual ? pool[(p + 5) % pool.length] : '', hit_target_ms: '260',
            });
        }
    }
    const out = [header.join(','), ...rows.map((r) => header.map((h) => r[h] ?? '').join(','))].join('\n') + '\n';
    fs.writeFileSync(RELAX, out, 'utf8');
    return rows.length;
}

if (process.argv.includes('--relax')) console.log('relax 60 关：' + buildRelax() + ' 行 → ' + RELAX);
else console.log('挑战 60 关：' + buildChallenge() + ' 行 → ' + CSV + '（季 1 原样保留）');
