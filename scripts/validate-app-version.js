const fs=require('fs');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const html=fs.readFileSync('index.html','utf8');
const version=String(pkg.version||'').trim();
const errors=[];
if(!version) errors.push('package.json version missing');
if(!html.includes(`⚙ 設定 <span>v${version}</span>`)) errors.push(`sidebar version is not v${version}`);
if(!html.includes(`app.js?v=${version}`)) errors.push(`app.js cache-buster is not ${version}`);
if(!html.includes(`resonance-lab-v1.js?v=${version}`)) errors.push(`resonance-lab cache-buster is not ${version}`);
const lab=fs.readFileSync('lib/resonance-lab-v1.js','utf8');
if(/querySelector\(['\"]\.sidebar-foot\.settings-open span['\"]\).*?textContent\s*=/.test(lab)) errors.push('legacy lab must not overwrite sidebar version');
if(/setAttribute\(['\"]data-stockzone-ui-version['\"]/.test(lab)) errors.push('legacy lab must not overwrite UI version');
if(errors.length){console.error('App version validation FAILED');for(const e of errors)console.error('-',e);process.exit(1)}
console.log(`App version validation PASS — v${version}`);
