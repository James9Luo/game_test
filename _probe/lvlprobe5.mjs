import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: '', storage: {} });   /* 就像用户双击打开：无参数 */
const P = H.P;
H.setNow(1000); console.log('A 首页: now=' + P.now().toFixed(1) + ' scene=' + P.app.scene);
H.setNow(2000); console.log('B 首页: now=' + P.now().toFixed(1));
/* 点「催眠放松」按钮（首页主按钮） */
const b = P.HOME_BTN ? P.HOME_BTN : null;
console.log('HOME_BTN 可用: ' + (b ? JSON.stringify(Object.keys(b)) : 'no'));
