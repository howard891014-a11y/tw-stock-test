'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const pkg=require('../package.json');
const config=require('../vercel.json');
const slice=(start,end)=>{
  const i=app.indexOf(start),j=app.indexOf(end,i+start.length);
  assert(i>=0&&j>i,`${start} / ${end} not found`);return app.slice(i,j);
};
const basicNum=v=>v==null?null:(Number.isFinite(Number(v))&&Number(v)>0?Number(v):null);
const asPlain=x=>JSON.parse(JSON.stringify(x));
assert.equal(pkg.version,'2.7.0.51');
assert.equal(config.proxy.entrypoint,'proxy.js');
assert.equal(config.crons.length,23);
assert.equal(config.rewrites.length,3);
assert.match(html,/stockzone-version" content="2\.7\.0\.51"/);
// Admin remains hidden without authenticated role, but is located inside Developer Mode.
const developerStart=html.indexOf('<details class="sz-settings-fold" id="szDeveloperMode">');
const developerEnd=html.indexOf('</details>',developerStart);
const adminPos=html.indexOf('id="szAccessAdminEntry"');
assert(developerStart>=0&&adminPos>developerStart&&adminPos<developerEnd,'admin link must be nested in developer section');
assert.equal((html.match(/id="szAccessAdminEntry"/g)||[]).length,1);
assert.match(html,/#szAccessAdminEntry\[hidden\]\{display:none!important\}/);
assert.match(app,/status\?\.authorized===true&&status\?\.role==='admin'/);
// Only the composite gap's shared small-label style loses its colored background.
assert.match(html,/#valuation \.valuation-summary-modern \.valuation-summary-price>small\{[^}]*background:transparent!important/);
const canonical=vm.runInNewContext(slice('function resonanceDisplayPrices(','function drawOverviewResonance(')+'\nresonanceDisplayPrices',{positionNumber:basicNum});
const expected={price:1260,plan:{resonance:{main:{center:1513.31},secondary:{center:1596.5}}},mainPullback:{valid:true,price:1113},downside:{levels:[{value:826},{value:762.57}]}};
const prices=asPlain(canonical(expected));
assert.deepEqual(prices,{price:1260,main:1513.31,secondary:1596.5,pullback:1113,defense:826},'chart price identity must not swap deep reference and main pullback');
const values=vm.runInNewContext(slice('function szLabValues(','function szLabFmt(')+'\nszLabValues',{resonanceDisplayPrices:canonical,szLabCurrentDate:()=> '2026-11-01'});
const v=asPlain(values({key:'long-swing',operationProfile:{basePct:65}},expected));
for(const [key,val] of Object.entries(prices))assert.equal(v[key],val,`snapshot must share ${key} with chart`);
const mkSnapshot=({classification,lab=v,code='6187'}={})=>{
  const ctx={latestPlayStyleResult:{key:'long-swing',period:'長波',operationProfile:{basePct:65,tacticalPct:35}},
    szLabRecent:lab?{code,v:lab}:null,latestPlayStyleResultDummy:false,
    currentStock:{code,name:'萬潤'},
    currentStockCode:()=>code,szResonanceIsLoading:()=>false,
    fiveYearRecommendation:()=>classification,
    szLabCachedRisk:{score:41,summary:'test'},shortStockName:s=>s,positionNumber:basicNum};
  return vm.runInNewContext(slice('function holdingPlanSnapshot(','// Previously saved manual plans')+'\nholdingPlanSnapshot',ctx)('6187');
};
const result=asPlain(mkSnapshot({classification:{status:'selected',key:'swing',displayLabel:'波段'}}));
assert.equal(result.play,'波段');assert.equal(result.playKey,'swing');
assert.deepEqual(result.targets,{main:1513.31,secondary:1596.5,pullback:1113,defense:826});
assert.equal(result.allocation.core,65,'existing V4 core/tactical research weights are unchanged');
const ref=mkSnapshot({classification:{status:'reference',referenceKey:'long',displayLabel:'長期（參考）'}});
assert.equal(ref.play,'長期（參考）');assert.equal(ref.playKey,'long');
assert.equal(mkSnapshot({classification:null}),null,'unconfirmed five-year strategy must not be falsely captured as a formal play');
assert.equal(mkSnapshot({classification:{status:'selected',key:'swing',displayLabel:'波段'},code:'2330'}),null,'never save different-stock result');
const quoteSrc=slice('function freshestDatedClose(','const MIS_CLOSE_VERIFY_KEY=');
async function checkQuotes(){
  const cached={code:'6187',last:1260,tradeDate:'2026-10-22',source:'cached'},
    official={code:'6187',last:1190,tradeDate:'2026-10-30',source:'Neon price_snapshot',officialClose:true},
    yahoo={code:'6187',last:1260,tradeDate:'2026-10-22',source:'Yahoo Finance'};
  const stored=[];
  const scope={validPositivePrice:basicNum,dayKey:x=>String(x||'').slice(0,10),
    readLocalCloseQuote:async()=>cached,dbCloseQuote:async()=>official,yahooQuote:async()=>yahoo,
    writeLocalCloseQuote:async(...args)=>stored.push(args),console};
  vm.createContext(scope);vm.runInContext(quoteSrc,scope);
  const fixed=await scope.verifiedNonTradingClose('6187','上櫃','6187');
  assert.equal(fixed.tradeDate,'2026-10-30');assert.equal(fixed.last,1190);
  assert(stored.some(x=>x[2].tradeDate==='2026-10-30'));
  // Alternate provider is allowed when official row is temporarily missing.
  scope.dbCloseQuote=async()=>null;scope.yahooQuote=async()=>({...yahoo,last:1180,tradeDate:'2026-10-31'});
  const alternative=await scope.verifiedNonTradingClose('6187','上櫃','6187');
  assert.equal(alternative.last,1180);
  // Verify non-trading day quote() does not shortcut the cache directly.
  const quoteBlock=slice('async function quote(query,market="",options={}){','async function autoListQuote(');
  assert(!quoteBlock.includes('if(phase.weekend||marketSessionForToday()?.status==="holiday")return cached;'));
  assert.match(quoteBlock,/return verifiedNonTradingClose\(query,market,codeHint\)/);
  assert.match(app,/async function autoListQuote\(code,market=""\)\{\s*return quote\(code,market,\{verifyClose:false\}\)/);
  console.log('PASS .51: stale October 22 weekend cache replaced by October 30 verified official close; provider fallback and cache refresh');
}
checkQuotes().then(()=>console.log('PASS .51: R1 snapshot play, matching 4 resonance chart values, stock isolation, admin-in-developer, valuation background, unchanged cron/proxy')).catch(e=>{console.error(e);process.exitCode=1});
