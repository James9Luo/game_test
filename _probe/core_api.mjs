import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: '', storage: {} });
const C = H.P.CORE || {};
console.log('judgeNearest:', typeof C.judgeNearest, '| duoVerdict:', typeof C.duoVerdict);
console.log('P.judgeNearest:', typeof H.P.judgeNearest, '| P.desyncSelftest:', typeof H.P.desyncSelftest);
