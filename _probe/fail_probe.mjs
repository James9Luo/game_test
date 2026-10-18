import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: '', storage: {} });
const P = H.P, a = P.app, T = P.CORE.moverTiming;
P.startRun('challenge', 49);
const pm = a.rt.movers.map(m => T(m).perfectMs);
let t = a.attemptStart + pm[0];
P.freeze(t); P.press(t);
P.freeze(t + 401); P.update(); P.update();
// 第二次故意打偏：完美点之后 200ms（远超 ±24ms 窗口）
const far = a.attemptStart + pm[1] + 200;
P.freeze(far); P.press(far);
P.freeze(far + 401); P.update(); P.update();
const r = a.fb && a.fb.res;
console.log('偏打结果: phase=', a.phase, 'pass=', r ? r.pass : 'n/a', 'pct=', r ? r.pct.toFixed(2) : 'n/a', 'frozen=', JSON.stringify(a.frozen), 'attempts=', a.attempts);
