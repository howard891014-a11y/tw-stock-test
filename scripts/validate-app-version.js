const fs=require('fs');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const html=fs.readFileSync('index.html','utf8');
const version=String(pkg.version||'').trim();
const errors=[];
if(!version) errors.push('package.json version missing');
if(!html.includes(`⚙ 設定 <span>v${version}</span>`)) errors.push(`sidebar version is not v${version}`);
if(!html.includes(`app.js?v=${version}`)) errors.push(`app.js cache-buster is not ${version}`);
if(errors.length){console.error('App version validation FAILED');for(const e of errors)console.error('-',e);process.exit(1)}
console.log(`App version validation PASS — v${version}`);
