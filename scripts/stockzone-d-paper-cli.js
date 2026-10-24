'use strict';
/** Manual execution ONLY. No live API, scheduled cron, automatic order, or Neon write. */
const {getDPreview}=require('../lib/stockzone-d-neon-readonly');
const {freezeToday,settleNext}=require('../lib/stockzone-d-paper-runner');
const {createBlobJournal}=require('../lib/stockzone-d-paper-store');
const {summarize}=require('../lib/stockzone-d-paper-report');
async function main(){
 const [cmd,arg]=process.argv.slice(2);
 const store=createBlobJournal();
 if(cmd==='preview'){
  const p=await getDPreview({withBaseline:true});
  console.log(JSON.stringify({asOfDate:p.asOfDate,mode:p.mode,
   d:p.recommendations,v4:p.baseline?.core||[],notStored:true,simulatedOnly:true},null,2));return;
 }
 if(cmd==='capture'){
  console.log(JSON.stringify(await freezeToday({journal:store}),null,2));return;
 }
 if(cmd==='settle'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(arg||'')))throw Error('Usage: node scripts/stockzone-d-paper-cli.js settle YYYY-MM-DD');
  console.log(JSON.stringify(await settleNext({signalDate:arg,journal:store}),null,2));return;
 }
 if(cmd==='report'){
  const days=await store.listExecutionDates();
  const executions=await Promise.all(days.map(d=>store.getExecution(d)));
  console.log(JSON.stringify(summarize(executions),null,2));return;
 }
 throw Error('Usage: node scripts/stockzone-d-paper-cli.js preview | capture | settle YYYY-MM-DD | report');
}
main().catch(e=>{console.error('StockZone D PAPER:',e?.message||e);process.exitCode=1});
