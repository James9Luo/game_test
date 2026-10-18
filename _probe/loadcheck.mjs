import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: '', storage: {} });
console.log('title   =', H.title());
console.log('jsError =', H.htmlError());
console.log('scene   =', H.P && H.P.app ? H.P.app.scene : 'no __PROTO__');
console.log('shapes  =', H.P && H.P.app && H.P.app.shapes ? Object.keys(H.P.app.shapes).length : 'n/a');
