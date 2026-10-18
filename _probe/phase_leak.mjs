import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: '', storage: {} });
const P = H.P, a = P.app;
P.startRun('challenge', 49);
console.log('startRun → phase=', a.phase, 'fb=', a.fb ? 'set' : 'null');
P.startLevel(49);
console.log('startLevel → phase=', a.phase, 'fb=', a.fb ? 'set' : 'null', 'frozen=', JSON.stringify(a.frozen));
// 直接走一次失败：在 t=attemptStart+1 按下
const t = a.attemptStart + 1;
P.freeze(t); P.press(t);
console.log('press@+1ms → phase=', a.phase, 'pct=', a.fb && a.fb.res ? a.fb.res.pct.toFixed(2) : 'n/a');
