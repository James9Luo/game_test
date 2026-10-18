import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: 'screen=play', storage: {} });
const P = H.P;
H.setNow(1000); console.log('A: setNow(1000) -> P.now()=' + P.now());
H.setNow(1500); console.log('B: setNow(1500) -> P.now()=' + P.now());
P.press(1200);  console.log('C: press(1200) -> P.now()=' + P.now());
