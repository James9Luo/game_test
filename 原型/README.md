# 原型 · 单文件可玩 HTML

## 一句话

`原型/dista_prototype.html` 是**构建产物**：双击即玩、无外链、无 fetch、可 `file://` 打开。  
改任何东西都改源文件，然后重新 build，**不要手改 HTML**。

```
node tools/build_proto.mjs          # 构建（自动判断走真 core 还是 mock）
node tools/selfcheck_proto.mjs      # 不开浏览器的逻辑断言（12 条）
powershell -ExecutionPolicy Bypass -File tools/verify_proto.ps1   # 一条命令：build + 自测 + 截图 + DOM
```

## 文件职责

| 文件                                    | 作用                                                   | 谁写              |
| ------------------------------------- | ---------------------------------------------------- | --------------- |
| `原型/_src/game.js`                     | 全部 UI / 流程 / 渲染 / 调试入口（纯浏览器 JS，不 import）             | 我（client-proto） |
| `原型/_src/mock_core.js`                | 核心桩：core 未落地时的兜底，签名与 `CoreApi` 一致                    | 我               |
| `原型/_src/shapes_fallback.js`          | 美术 `shapes.json` 缺失时的占位轮廓                            | 我               |
| `tools/build_proto.mjs`               | 构建：擦类型 → 剥 import/export → 拼 IIFE → 内联配置 → 语法自检 → 落盘 | 我               |
| `tools/selfcheck_proto.mjs`           | 在 `node:vm` 里用假 canvas 跑整包，断言判定/流程/热力图               | 我               |
| `tools/verify_proto.ps1`              | 一条命令跑完 build + 自测 + 4 张截图 + 3 份 DOM                  | 我               |
| `assets/scripts/core/*.ts`            | 冻结核心（判定/路径/评分/关卡构建）                                  | client-core     |
| `assets/resources/config/levels.json` | 15 关配置（由 CSV 导出）                                     | client-core     |
| `assets/config/shapes.json`           | 15 个可判定轮廓                                            | art             |

构建时内联顺序（冻结）：`Geometry → Types → Layout → Shapes → Paths → Score → Judge → LevelStore → index`。  
所有 core 调用都从一个 `CORE` 对象取（`buildLevel / poseAt / objectPtsAt / judge / ratingOf / starsOfResult / overlapStrips / missStrips`），  
切换 mock ↔ 真实现只改 `build_proto.mjs` 里的自动判断（或 `--mock` / `--core` 强制），`game.js` 一行不动。

## URL 调试参数（测试/截图用）

页面支持用 URL 参数把状态**冻结**在任意一帧，所以截图是确定性的（不靠等动画）：

| 参数                  | 取值                                      | 作用                                                                  |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| `screen`            | `home` / `play` / `result` / `complete` | 直接锁到某个画面                                                            |
| `lvl`               | `1`–`15`                                | 直接进第 n 关（**只有调试入口看它；正常启动永远是首页 + 第 1 关待命**）                          |
| `press`             | `0`–`1`                                 | 在周期的哪个比例按下；**0.5 = 完美时机**（h_line 类），>0.5 = 按晚，<0.5 = 按早             |
| `fxAt`              | 毫秒                                      | 把**特效时钟**固定在按下后 N ms（`screen=result` 用；截图统一 400 → 环扩散中/微尘半空/面板刚滑上来） |
| `att`               | `1`–`3`                                 | 强制剩余机会数（`1` → 失败一次就出现「重试本关」）                                        |
| `freeze`            | 毫秒，默认 `620`                             | 没给 `fxAt` 时的等效参数（旧名，保留兼容）                                           |
| `progress`          | `1`–`15`                                | 伪造存档进度（**只在调试/截图时播种**），用来出「继续 · 第 N 关」那张图                           |
| `unlocked` / `best` | 数字                                      | 同上，旧名，保留兼容                                                          |
| `tap`               | `start` / `continue`                    | 200ms 后真的“点”一次首页按钮（验证「开始=第 1 关」，比读启动值可靠）                            |
| `variant`           | `dual`                                  | 落到第一个双物体关（截图/联调用）                                                   |
| `diag`              | `1`                                     | 底部叠 5 行诊断数字（时间/坐标/缩放/viewport）                                      |
| `autoplay`          | `1`                                     | 真实时间里自动按一次（配合 `--virtual-time-budget`）                              |

示例：

```
?screen=home
?screen=home&progress=6&tap=continue      # 点「继续」→ HUD 必须是「第 7 / 15 关」
?screen=home&progress=6&tap=start         # 点「开始」→ HUD 必须是「第 1 / 15 关」
?screen=play&lvl=1&press=0.57
?screen=result&lvl=1&press=0.515&fxAt=400 # 结算（按晚，特效停在 400ms）
?screen=result&lvl=3&press=0.5&fxAt=400   # 神级：3 环 + 24 微尘 + 背景偏暖
?screen=result&lvl=1&press=0.8&fxAt=400   # 失败：物体 α0.65、无环无粒子、不抖不红闪
?screen=result&lvl=10&variant=dual&press=0.58&fxAt=400
```

## 音频与动效（v0.1.1）

### 数据结构（`原型/_src/audio.js`）

| 对象           | 内容                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `SPEC`       | 64 BPM / `beat 0.9375s` / `bar 3.75s` / 8 小节 = **30.0s**；delay `0.28s · fb 0.30 · wet 0.25`；duck `×0.55 · 250ms`；五声音阶 `{D,E,F#,A,B}` |
| `BGM_EVENTS` | 8 小节事件表（pad / 拨弦 / 低音 / 沙锤），每条 `{t, dur, wave, freq, cents, gainDb, env:{a,d}, lp\|band, name}`                                      |
| `SFX`        | `god / perfect / good / ok / fail / press` 六张表：音名序列 + 时值 + 包络 + 音色 + 相对 dB                                                           |
| `WHOOSH`     | 带通噪声 `300→900Hz`，`-22dB`                                                                                                             |
| `model`      | 不依赖 WebAudio 的状态：`{master, bgm, whoosh, muted, lastOps, pressFrames}` —— A5/A6/A8 就是在 node 里断言它                                      |

### 两个渲染器（同一份 events，不可能跑味）

| 消费者          | 入口                                      | 用在哪                                                          |
| ------------ | --------------------------------------- | ------------------------------------------------------------ |
| 离线（纯数学）      | `renderBgm / renderSfx / renderWhoosh`  | `tools/render_audio.mjs` → `03_交付素材/audio/*.wav`（node，不需要声卡） |
| 实时（WebAudio） | `scheduleBgm / scheduleEvent / playSfx` | 浏览器里真正出声                                                     |

归一化：BGM 离线 RMS 归一到 **-18 dBFS**、五档 SFX **组归一化**（最响档峰值 -1.5 dBFS，保留 +6/…/-6 dB 相对差），最后统一软限幅 -1.5 dBFS。

### 静音与自动播放策略

- **只有用户手势**（点「开始」/「继续」）才 `new AudioContext()` + `resume()`；未手势前不创建上下文。
- 构造失败 / 没有 `AudioContext`：catch 住，全部降级为只更新 `model`，**游戏照常跑**（A8）。
- 静音开关：右上角视觉 44×44 / 热区 88×88（读 `Layout.MUTE_BTN`），α0.4，点击只改 α 到 0.8 停 100ms，**不缩放不发光**；状态存 `dista.muted`，默认**开**。

### 动效分级（读 `Layout.RATING_FX`，不自己写死）

| 评级 | 环                                             | 微尘                                             | 其它                               |
| -- | --------------------------------------------- | ---------------------------------------------- | -------------------------------- |
| 神级 | 3 环，间隔 180ms，**最外那环是 gold `#FFD24D`**，环 900ms | 24 颗（沿**轮廓周长**采样），1.2s，向上 40–70px + 横向 ±6px 正弦 | 背景色相 +8°、金色徽章、HUD 数字更亮           |
| 完美 | 1 环 600ms                                     | 12 颗 0.9s                                      | 绿框描边 6→7px 300ms 后回 6px          |
| 不错 | 无                                             | 无                                              | 绿框描边呼吸一次（400ms）                  |
| 及格 | 极淡 1 环 500ms                                  | 无                                              | 只有文案                             |
| 失败 | 无                                             | 无                                              | 物体 α→0.65（200ms）；不抖屏 / 不红闪 / 不回弹 |

热力图条带之间每条 **+0.5px 重叠**，避免 6px 条带接缝出现细横纹。

```
node tools/audio_check.mjs     # A1–A10 断言（削波/电平/五声/同调/按下静音/静音开关/重开/无音频/A9/A10）
node tools/render_audio.mjs    # 03_交付素材/audio/*.wav（bgm_loop 30.0s + 5 档 sfx + press/whoosh）
```

## 重开规则（规格 §5）

| 入口             | 行为                               |
| -------------- | -------------------------------- |
| 首页「开始」         | **永远第 1 关**（重置本局分数/连击，不清空存档最好成绩） |
| 首页「继续 · 第 N 关」 | 仅 `unlocked > 1` 时出现；回到存档那一关     |
| 结算「重试本关」       | 同关卡号重来，不改进度                      |
| 通关页「再玩一次」      | 回第 1 关（点其它处回首页）                  |

## 反馈动画（relax 版，规格 §3 + 风格圣经 §6）

z 序锁死：`背景 < 柔光 < 环 < 绿框 < 物体 < 粒子 < 热力图 < 面板`。  
全屏闪白已废弃；按下走**柔光呼吸**（`glowIn 140 / glowOut 260`，峰值 α0.22，色 `#2BFFB0`）。  
五档分级见上表（读 `Layout.RATING_FX`）；**不做时间缩放、不抖屏、不红闪、不回弹**。

## 自测钩子

`window.__PROTO__` 暴露 `{ CORE, CFG, app, progress, audio, levels, shapes, press, startLevel, startRun, homePress, canContinue, settle, heatStyle, ratingFx, freeze, unfreeze, update, render }`，  
`tools/selfcheck_proto.mjs` / `tools/audio_check.mjs` 靠它在 Node 里驱动逻辑（不需要浏览器）。

## 热力图口径（与判分同源，但**不参与判分**）

三色，α 与颜色都是规格值：

| 区域         | 颜色        | α    | 说明                                           |
| ---------- | --------- | ---- | -------------------------------------------- |
| 重合         | `#2BFFB0` | 0.35 | 最淡：对的不用吵                                     |
| 偏差（物体溢出）   | `#FF5A5A` | 0.60 | 最亮 + **各边 2px 外扩**（90%+ 重合时否则只剩 1–3px 细边看不见） |
| 空缺（绿框没被盖住） | `#E8F1FF` | 0.25 | 去饱和中性灰，不能是 mint/琥珀（会看起来像“物体还在框里”）            |

并且**恒定画两套轮廓**：物体实线（`rgba(232,241,255,0.75)`）+ 绿框虚线（dash 6/6，α0.55）。  
绿区优先用 `Core.overlapStrips`；偏差/空缺必须本地按横截面算（`missStrips` 把两者合并了，分不出来）；两套实现面积差 < 2% 有断言咬合。

## 反馈时序（冻结，不许改顺序）

按下当帧冻结 + 风声硬切 → 柔光呼吸（`glowIn 140` / `glowOut 260`，峰值 α0.22）→ 热力图 120ms 淡入 → 评级面板 260ms 上滑（`easeOutCubic`，位移 70px，无回弹）。  
失败自动重试 `RETRY_DELAY_MS=700`；通关 1 秒后自动进下一关。

## 已知问题

见 `04_项目管理/原型_自测清单.md` 第 4 节（评级阈值与 passRate 不同源、双物体关 pass 按最差物体、空挥也扣次数等）。

---

## v0.3 双模式 = 同判定 + 挑战限时（2026-10-18）

> **v0.3 推翻了 v0.2 的"relax 简化"**（规格：`01_策划文档/20261018_v0.3_双模式改为时间限制.md`）。  
> 现在两个模式的**判定/评分/星级/特效/音效/HUD 完全相同**；唯一差异 = **挑战模式每关限时 15 秒**，以及 relax 打完 15 关循环。

### 双模式对照

| 维度          | 闯关挑战 `challenge`                                                                                                                                                           | 催眠放松 `relax`                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 入口          | 首页**主按钮**「闯关挑战 · 15 关」（实心 mint + 阴影）                                                                                                                                       | 首页**次按钮**「催眠放松 · 无尽循环」（描边 + 半透明）         |
| 说明小字        | `每关 15 秒，有星级与连击`                                                                                                                                                           | `无倒计时，随时可停`                              |
| 时限          | **每关 15000ms**（`modes.json` 的 `timeLimitMs`；单关可被 `levels.csv` 新列 `time_limit_sec` 覆盖 → 经 `export_levels` 变成 `levels.json` 的 `timeLimitSec`，运行时按 `Math.round(sec*1000)` 取值） | **null（无时限）**                            |
| 判定/评级/分数/星级 | 完整                                                                                                                                                                         | **完全相同**（M17 断言 pct/rating/score 三者逐位相等） |
| 失败表现        | 失败面板 + 扣 1 次                                                                                                                                                               | 相同                                       |
| 音效          | 五档特效音                                                                                                                                                                      | **相同**（不再降 BGM、不再静音评级音）                  |
| HUD         | 关卡 / 次数 / 连击 / 分数 **+ 右上角倒计时**                                                                                                                                             | 关卡 / 次数 / 连击 / 分数（**仅少倒计时**）             |
| 15 关之后      | 通关页（本局总分 + 历史最高 + 神级次数 + 用时）                                                                                                                                               | 回到第 1 关继续，轻提示「第 N 轮完成」2 秒消失              |
| bestScore   | **记录**（只增不减）                                                                                                                                                               | **不记录**（别让助眠玩家被分数绑架）                     |

### 倒计时规则（挑战）

- **起点 = 物体中心第一次进入画面**那一帧（`0 ≤ pose.x ≤ 720 && 0 ≤ pose.y ≤ 1280`，四条件、不用包围盒）——  
  只有这个判据对 7 种路径都成立：`arc_up` / `bounce_floor` 是从画面**下方**进场的，用 `x ≥ 0` 会提前开表；  
  也不能用"进 play 那一帧"（L1 会白送约 640ms 的空屏）。**结算面板出现即停表**；重试本关重置为 15s。
- HUD 右上竖排**固定槽位**（不用"相对某个元素偏移"）：图标行 y 44–88（场景 x596 / 静音 x652）→ 得分 y=100 →  
  连击 y=132 → **倒计时 y=164（等宽数字，底边 ≤170，不越 y=190；与图标行间距 76px）**；
- **≤3000ms**（含边界）切琥珀 `#FFC44D` + α 呼吸 ±0.28（周期 1s）；**只改透明度，不动字号/基线**（数字不跳）；
- **relax 不画这个槽位，连占位空白都没有** —— 两模式 HUD 并排比对时除倒计时外逐项对齐。
- **超时 = 本关失败**：直接进结算、评级 `fail`、标题「时间到」、**扣掉最后一次机会**；次数还有则自动重试本关。
- 超时面板不显示重合率/按早按晚（没有按下），只显示「本关没有在限时内完成定格」。

### 结算与最高分

- 挑战 15 关全通 → 通关页显示 **本局总分 + 历史最高分（`localStorage`，只增不减）+ 神级次数 + 用时**；
- 中途次数用尽 → 面板「重试本关」/返回首页，**总分不清零**；
- **最高分只在挑战模式写入**，且**只有一处写**：`showComplete()` 里带 `MODES[mode].recordBest` 门控。  
  （`settle()` 里曾有一句裸写 `progress.bestScore = Math.max(...)`，导致 relax 也能写进去，被 M20 抓到后删除；  
  以后不要在任何逐关路径上写 bestScore。）

### v0.3 关键实现位置（改之前先读）

| 关注点      | 位置                                                                       |
| -------- | ------------------------------------------------------------------------ |
| 本关时限取值   | `levelTimeLimit(def)`（读 `modes[mode].timeLimitMs`，`def.timeLimitSec` 优先） |
| 计时起点/停表  | `update()` 里"物体中心进入画面"判定 + `fb.revealed` 时钉 `timerStopAt`                |
| 超时结算     | `triggerTimeout()`（减 attempts、造 `fb.timeout=true` 的 fail 面板、放 `fail` 音）  |
| 面板差异     | `drawPanel()` 里 `isTimeout` 分支（没有重合率/按早按晚）                               |
| 下一关 / 循环 | `nextLevel()`（`MODES[mode].loop` → `round+1` + toast + 回第 1 关）           |
| 倒计时绘制    | `drawTimer()`（`timeLimitMs=null` 直接 return，relax 无槽位）                    |

### 调试参数（v0.3 新增）

| 参数                              | 作用                        |
| ------------------------------- | ------------------------- |
| `?timeLeft=2.4`                 | 把挑战倒计时拨到剩 2.4s（验 ≤3s 琥珀色） |
| `?timeout=1`                    | 直接触发超时结算（验「时间到」面板）        |
| `?tap=challenge` / `?tap=relax` | 200ms 后真的点一次对应入口          |

```
?mode=challenge&screen=play&lvl=1&press=0.57&timeLeft=2.4   # 倒计时琥珀
?mode=challenge&screen=play&timeout=1                       # 时间到 结算
?mode=relax&screen=play&lvl=3&press=0.55                    # 与 challenge 并排比对 HUD
```

### 三场景（`scenes.json`，美术产出；缺失时用 `_src/scenes_fallback.js`）

| id              | 名称   | 底色                  | 动态层（≤3，周期 ≥14s）          |
| --------------- | ---- | ------------------- | ------------------------ |
| `night_station` | 深夜候车 | `#0B1424 → #111E33` | 柔云 ×2 / 远处车灯 ×1 / 星点 ×12 |
| `noon_window`   | 午休窗边 | `#F6F1E7 → #E8EEF4` | 窗格光斑 ×3 / 窗帘正弦微动         |
| `minimal`       | 极简纯净 | `#141A24 → #0E1420` | 细碎粒子 ×16 超慢上浮            |

- **日夜自适应**：本地 07:00–18:59 → `noon_window`；19:00–06:59 → `night_station`；`minimal` 只能手动。
- **手动优先**：点场景图标循环切换并写 `localStorage['dista.scene']`，优先于自动。
- **只在关卡之间切换**（`applySceneForLevel()` 在 `startLevel` / `startRelaxLevel` 调用），避免判定帧背景突变。
- 浅色场景（noon_window）自动切深色文字；场景**只换背景与氛围层**，绿框位置/物体颜色/判定一律不动。

### 绿框「发光呼吸」（D-040）

只改外发光 α：`0.35 + 0.20 × (0.5 − 0.5·cos(2π·t/4000))`，周期 4s；**轮廓几何逐点不动**（M8 断言）。

### 新增调试参数

| 参数      | 取值                                                   | 作用                                      |
| ------- | ---------------------------------------------------- | --------------------------------------- |
| `mode`  | `relax` / `challenge`                                | 直接进某个模式                                 |
| `scene` | `night_station` / `noon_window` / `minimal` / `auto` | 走**手动选择**通道（写 localStorage；`auto` 恢复自动） |
| `hour`  | `0`–`23`                                             | 伪造本地时间，验日夜自适应                           |
| `relax` | 数字                                                   | relax 无限流里取第 n 个物体                      |

### `modes.json` 字段（我维护，`assets/resources/config/modes.json`）

| 字段                                   | 含义                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `relax.cycleMs`                      | `[5200, 6800]`，按 5 档确定性轮转（**无随机**）                                                        |
| `relax.turns` / `relax.jitter`       | `1` / `0`（完全可预期）                                                                          |
| `relax.passRate` / `relax.attempts`  | `null` / `null` → 无限次数、不判失败                                                               |
| `relax.bgmGain` / `relax.sfxGain`    | `0.5` / `0.5`（约 -3dB / -6dB）                                                              |
| `relax.ratingSfx`                    | `false`（relax 不放五档评级音）                                                                    |
| `relax.showScore` / `relax.autoNext` | `false` / `false`                                                                         |
| `relax.objectPool` / `relax.paths`   | 物体与轨迹池；**运行时过滤掉 shapes.json 里不存在的 id**                                                    |
| `relax.softPassRate`                 | `0.6`：≥ 它 = 「卡准了」（轻响 + 柔光）；< 它 = 物体淡出重飞（不是失败）                                             |
| `relax.holdMs` / `relax.fadeOutMs`   | `900` / `300`（卡准后停留 / 淡出时长）                                                               |
| `challenge.*`                        | 全部沿用 15 关现状：`bgmGain 1.0 / sfxGain 1.0 / ratingSfx true / showScore true / autoNext true` |


### `scenes.json` 字段（美术维护，`assets/config/scenes.json`；build 自动同步到 `resources/`）

| 字段 | 含义 |
| --- | --- |
| `scenes[].id` / `name` | `night_station` / `noon_window` / `minimal` |
| `scenes[].bg` | `[上, 下]` 渐变色；**浅色场景会自动切深色文字** |
| `scenes[].layers[]` | ≤3 层，`k` ∈ `cloud / carlight / stars / sunpatch / curtain / dust`；`periodMs ≥ 14000` |
| `scenes[].allowed` | 允许该场景的模式列表（`relax` / `challenge`） |
| 同步规则 | build 时若源文件比副本新 → 覆盖 `assets/resources/config/scenes.json` 并打印「已同步」；副本更新则保留 |

### 图标取色随主题（lead 复核项）

静音 / 场景两个图标、relax 的 × 与「换一个」，颜色全部走 `sceneTheme()`：

| 场景 | 图标色 | 常态 α | 点击态 α |
| --- | --- | --- | --- |
| 暗底（night_station / minimal） | `#E8F1FF` | 0.40 | 0.80–0.90 |
| 浅底（noon_window） | `#1B2B45` | 0.55 | 0.85 |

### 画布外那一截（无头截图黑边的根因）

`--headless=new` 的 `--window-size=720,1280` 里 **viewport 只有 680×1149**，而 PNG 按 720×1280 出图 →
画布外那 131px 落在**文档之外**，浏览器用「导航开始时的初始 base 色」填充，JS 改 body 背景**改不到它**。
解法：`resize()` 里把 `html/body` 的 `minHeight` 撑到 `max(视口高, 1280)`，让这段区域回到文档内，
再跟着 `setBodyBg(sceneTheme().bg[1])` 走场景色。真机 `h ≥ 1280` 时无副作用。


### 断言与体积

- `tools/modes_check.mjs`：现行口径见 v0.3/v0.4 两节（v0.2 的 M1/M2/M4/M11 已作废）。
- 体积上限按 **D-038** 放宽到 400 KB；200 KB 只是原型自设目标，不是平台限制。

---

## v0.4 四季 60 关 + 道具库 + 特效落盘（2026-10-18）

规格：`01_策划文档/20261018_v0.4_四季60关与道具库.md`。**判定口径、`levels.csv` 数值、core 一行未改。**

### 一、60 关结构

| | 挑战 `challenge` | 催眠 `relax` |
| --- | --- | --- |
| 关卡表 | `__CONFIG__.levels`（core 导出 60 关；core 未出时 build 临时直连 `levels.csv`） | `__CONFIG__.levelsRelax`（core 未出时 build 临时直连 `levels_relax.csv`） |
| HUD | `第 N / 60 关` + 紧跟 `第 M 季`（小一号、季主题色） | `第 N / 60 关`（**无季标识**） |
| 季入场 | 跨季时 `第 N 季` 600ms 淡入 + 900ms 停留 + 400ms 淡出 | **不画** |
| 季末关 15/30/45/60 | 绿框呼吸周期 `/1.5`（只改 α 速度，几何不动） | 完成时轻提示 `已完成 N 段`（2s 淡出） |
| 关数来源 | 一律 `curLevels().length`，代码里**不写死 15** | 同左 |

**数据桥（临时）**：`levels.json` 里 ≥60 关 → 用 core；否则 build 解析 CSV 并按列名映射成 levels.json 同构对象，报告行写 `challenge=60 (csv-fallback)`。core 的 60 关 JSON 一落地自动切回，代码不动。

### 二、`assets/config/fx.json`（特效唯一来源，改它不用重编译）

| 段 | 内容 |
| --- | --- |
| `rating.{god/perfect/good/ok/fail}` | `rings` / `motes` / `breath` / `glowMs` / `bgWarmDeg` / `fxDurationScale` / `ringAlpha` / `objectAlpha` / `shake` + 环几何 `ring{alpha,gapMs,durMs,w0,spread}` + 粒子 `moteStyle{durMs,alpha}` + `energy` |
| `seasonTint[4]` | 每季 `accent` / `ring2` / `ring3` / `label` —— **只作用于特效与文字**（不改物体色、不改绿框色） |
| `levelIntro` | 关卡名 400ms 淡入上滑（`yShift 10`、`alpha [0.25,1]`） |
| `seasonIntro` | `labelMs 600` / `holdMs 900` |
| `seasonEnd` | `breathSpeed 1.5` |
| `breath` | 绿框呼吸 `alphaMin 0.35 / alphaMax 0.55 / periodMs 4000` |
| `relaxStageHint` | `everyN 15` / `fadeMs 2000`（「已完成 N 段」） |

- 运行时：`ratingFx()/ringCfg()/moteCfg()` 先读 `FX`（= fx.json），`Layout.RATING_FX` 降级为字段缺失时的兜底；
- 环色按**发出顺序**取当前季 `[accent, ring2, ring3]`；
- build 与 scenes.json 同一套单向同步：`assets/config/fx.json` → `assets/resources/config/fx.json`（源新则覆盖）。

### 三、build 的形状门禁（v0.4 新增，教训来自 windmill 10 顶点）

**读数据之后、拼 bundle 之前**校验，坏数据 `process.exit(5)`，**绝不打出"看起来成功、启动即挂"的坏包**：

| 致命（拦截） | 非致命（只 WARN） |
| --- | --- |
| 顶点数 12–48 / 坐标非有限 / 面积≈0（退化）/ id 缺失或重复 | 疑似自相交（共线点会误报）/ 最长边未归一化到 1±2% |

成功会打印 `[build] shapes 门禁 OK：N 个轮廓…`；`verify_proto.ps1` 在 build 非零时 `exit 3`，不会用旧产物出假红截图。

### 四、调试参数（v0.4 新增）

| 参数 | 作用 |
| --- | --- |
| `?season=N` | 跳到第 N 季首关，并**强制播放季入场**（时钟钉在 `nowMs()-300`） |
| `?relaxLvl=N` | 催眠第 N 关（走 `levelsRelax`） |
| `?at=god` | 把按下时刻钉在本关 `perfectMs`（截图要"神级三环"时用，比猜 `press` 可靠） |

> ⚠️ **`?season=` 与 `?at=god` 不要同时用**：跳季分支下 `app.rt` 还没按季重建完时 `perfectMs` 可能是 `NaN`。
> 要截"某季的神级特效"请用 `lvl=<该季首关>`（季 3 首关 = `lvl=31`），语义相同且不走跳季分支。
> 代码里已加防御：`perfectMs` 非有限时退化为"半周期"，不会再把整帧打成 `NaN`。

```
?mode=challenge&screen=play&season=2&press=0.55           # 第 2 季入场
?mode=relax&screen=play&relaxLvl=46&press=0.55            # 催眠第 46 关（无季标识）
?mode=challenge&screen=result&lvl=31&at=god&fxAt=400      # 第 3 季主题色神级（= 季 3 首关）
```

### 五、断言（`modes_check` 新增 S1/S2/S3/S5/S6）

| # | 项 | 判据 |
| --- | --- | --- |
| S1 | 60 关结构 | 关数=60、季集合 {1,2,3,4}、单调、每季 15 关 |
| S2 | 两模式前 15 关道具一致 | 逐关 `shapeId` 相同（严格版，lead 裁定 A） |
| S3 | 催眠矩阵 | 前 15 关镜像挑战；后 45 关每道具 3 次；纯单物体路径不重复；L16–60 无双物体邻居撞路径；双物体 **11 关**（12 个 5 的倍数槽位 − 被挑战 L5 占住的单物体位）且路径全 `h_line`；详见清单 §10.2 |
| S5 | fx.json 外置生效 | json 值 ≠ `DEFAULT_FX`；**四季各钉一关**（L1/L16/L31/L46）逐一验 `ringCfg('god').colors[0] === seasonTint[季].accent` |
| S6 | 季主题不影响判定 | 同 rt 同 pressMs，`season` 改 1→4 时 `pct/rating/score` 完全相同，仅环色变 |

### 六、季主题色当文字：先降饱和再上（`tintText`）

季主题色是**高亮**色，只适合画特效；直接当文字压在浅底场景（`noon_window`，底色 `#EDE6D8→#DFE6EE`）上必然看不清
（季 2 的 `#7FE8C4` 压上去几乎消失）。规则：

```js
function tintText(accent, light) {
    return light ? mixHex(accent, '#0E1626', 0.55) : accent;  // 浅底混 55% 墨色
}
```
作用点：**季入场标题**「第 N 季」与 **HUD 的「第 N 季」小字**；暗底场景保持原色不动。
（与 v0.2「noon 场景图标/文字走深色」是同一类处理：**亮底上的彩色必须降饱和**。）

### 七、两层"不许坏帧"防护（v0.4 冻结项）

| 层 | 机制 | 位置 |
| --- | --- | --- |
| 代码层 | `fin(v, dflt)` 数值保险丝 + `drawFault()` 计数：背景层任何非有限参数退回默认、`console.warn` 同点只报一次、**不点亮错误红条**（能自我修复就不该判崩溃）；`app.drawFaults` 在 `?diag=1` 可见 | `game.js` 的 `drawSceneLayers/softEllipse`、`?at=god` 的 `perfectMs` |
| 流程层 | **每张截图必须过红条自检**：`tools/png_check.mjs` 用 node 内置 zlib 解 PNG，扫顶部 120 行找 `#FF6B6B`（错误网颜色，容差 26），≥40 像素即判该图 FAIL；`verify_proto.ps1` 第 6b 步把所有截图一次性喂进去 | `tools/png_check.mjs` + `verify_proto.ps1` 6b |

> 背景：`proto_fx_season.png` 曾经整张是 JS-ERROR 崩溃页，却因为"文件存在"被判 PASS。红条自检把判据从"截图存在"升级成"截图里没有错误红条"，28 张一次查完、不必再起浏览器。



