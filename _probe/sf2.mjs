import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: '', storage: {} });
const P = H.P, a = P.app;
const r = P.desyncSelftest();
console.log('selftest =', JSON.stringify(r));
