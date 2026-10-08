const fs=require('fs'),assert=require('assert');
const html=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('app.js','utf8');
const labels=['還在睡','富貴險中求','可能有料','準備發車','先別急','可能回檔','小心偷跑','眼瞎才買','這是賭博不是投資'];
const keys=['sleep','rebound','potential','ready','wait','pullback','sneak','avoid','gamble'];
for(let i=0;i<keys.length;i++){assert(html.includes(`data-fundflow-path="${keys[i]}"`));assert(app.includes(labels[i]));}
assert(html.includes('id="marketW3Regime"'));
assert(!html.includes('data-fundflow-path="cold"'));
assert(app.includes('stockzoneW3Regime'));
console.log('V2.8 九狀態與大盤環境介面靜態檢查 PASS');
