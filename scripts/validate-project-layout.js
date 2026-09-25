const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const forbidden=[
  'market-topic-taxonomy.js','company-business-tags.js','company-business-seeds.js','fundflow-xy.js',
  'validate-market-topics.js','validate-company-business-tags.js','validate-fundflow-xy.js','validate-fundflow-ui.js','validate-fundflow-browser.js'
];
const bad=forbidden.filter(f=>fs.existsSync(path.join(root,f)));
if(bad.length){console.error('Project layout validation FAILED: patch files were flattened into repo root:',bad.join(', '));process.exit(1)}
for(const f of ['lib/market-topic-taxonomy.js','lib/company-business-tags.js','lib/company-business-seeds.js','lib/fundflow-xy.js','scripts/validate-market-topics.js']){
  if(!fs.existsSync(path.join(root,f))){console.error('Project layout validation FAILED: missing',f);process.exit(1)}
}
console.log('Project layout validation PASS — no flattened shadow files in repository root');
