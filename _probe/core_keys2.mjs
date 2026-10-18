import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: '', storage: {} });
const C = H.P.CORE || {};
const keys = Object.keys(C);
console.log('CORE 键数 =', keys.length);
console.log('含 judgeNearest =', keys.includes('judgeNearest'), '| duoVerdict =', keys.includes('duoVerdict'), '| judgeMover =', keys.includes('judgeMover'));
console.log('缺的候选 =', ['judgeNearest','duoVerdict','perMoverWindows','isDesyncRuntime','readDuo'].filter(k => !keys.includes(k)).join(','));
const d = (H.P.levels || []).find(x => x.id === 60);
console.log('L60 phase2 =', d && d.phase2, '| timeLimitSec =', d && d.timeLimitSec, '| keys 含 phase2 =', d ? ('phase2' in d) : 'n/a');
