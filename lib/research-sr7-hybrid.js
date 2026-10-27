'use strict';
/** Research only: protect R3's empirically stronger *near* levels;
 * try R7's longer 240d history for a genuinely independent major zone.
 * Missing major zones remain null; no fake R2/S2 from ATR or MA.
 */
const old=require('./research-sr4-zones'),modern=require('./research-sr7-zones');
const VERSION='SR7.1-hybrid-primary-R3-extended-major-R7';
function analyzeHybrid({bars=[],asOf}={}){
 const a=old.analyzeSupportResistance({bars,asOf,lookback:120});
 const b=modern.analyzeSR7({bars,asOf,lookback:240});
 if(!a.valid||!b.valid)return {valid:false,version:VERSION,reason:a.reason||b.reason};
 const S1=a.supportBounce||b.levels.S1,R1=a.resistanceFirst||b.levels.R1;
 const select=(legacy,extended,first,side)=>{
  const separate=z=>z&&first&&(side==='support'?z.upper<first.lower:z.lower>first.upper);
  if(separate(legacy))return{...legacy,origin:'R3-verified-major'};
  // S2/R2 must be independent high-evidence zones, not arbitrary distant lines.
  if(separate(extended)&&extended.strength>=5 &&(extended.testCount>=1||extended.pivotCount>=2))return{...extended,origin:'R7-240d-major-candidate'};
  return null;
 };
 const levels={S1:S1?{...S1,origin:a.supportBounce?'R3-near':'R7-near-fallback'}:null,
   S2:select(a.supportFinal,b.levels.S2,S1,'support'),
   R1:R1?{...R1,origin:a.resistanceFirst?'R3-near':'R7-near-fallback'}:null,
   R2:select(a.resistanceMajor,b.levels.R2,R1,'resistance')};
 return{valid:true,version:VERSION,asOf:a.asOf,historyBars:b.historyBars,price:a.price,atr20:a.atr20,levels,
  supportBounce:levels.S1,supportFinal:levels.S2,resistanceFirst:levels.R1,resistanceMajor:levels.R2,
  originalR3:a.version,extendedR7:b.version,
  note:'用R3近檔精度保護S1/R1，擴充240日歷史尋找S2/R2；R2較難突破仍須條件化回測證明',researchOnly:true};}
module.exports={VERSION,analyzeHybrid};
