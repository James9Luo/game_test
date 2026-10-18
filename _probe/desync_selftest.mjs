import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: '', storage: {} });
const P = H.P;
const r = P.desyncSelftest ? P.desyncSelftest() : null;
console.log('selftest =', JSON.stringify(r, null, 0).slice(0, 900));
