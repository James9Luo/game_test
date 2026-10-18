/**
 * tools/_core.mjs —— 工具侧加载核心层的唯一入口
 *
 * 核心层源码是「无后缀」相对 import（Cocos/tsc 要求），所以：
 *   1) 先装 .ts 解析钩子（./_ts_boot.mjs）；
 *   2) 再用**动态 import** 载入 core/index.ts（静态 import 会在钩子装好之前就解析，来不及）。
 *
 * 工具里统一写：
 *   import { core } from './_core.mjs';
 *   const { judge, buildLevel } = core;
 */

import { TS_HOOK } from './_ts_boot.mjs';

let mod = null;
let err = '';
try {
    mod = await import('../assets/scripts/core/index.ts');
} catch (e) {
    err = e && e.message ? e.message : String(e);
}

if (!mod) {
    console.error('\n[tools/_core] 加载核心层失败：' + err);
    if (!TS_HOOK.installed) console.error('  根因：.ts 解析钩子没装上 —— ' + TS_HOOK.error);
    else console.error('  根因：核心层源码自身报错（看上面堆栈）。');
    process.exit(2);
}

export const core = mod;
export const CORE_LOADED = {
    hookInstalled: TS_HOOK.installed,
    exports: Object.keys(mod).length,
};
