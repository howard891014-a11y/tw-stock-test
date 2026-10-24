'use strict';
/** Private Vercel Blob append-only research journal, NEVER Neon writes. */
const {verifySeal}=require('./stockzone-d-paper');
const PREFIX='stockzone/d-forward/v1/';
const MAX_PATHS=1500;
const dateOK=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
const signalPath=d=>{if(!dateOK(d))throw Error('PAPER_LOCKED: bad signal date');return PREFIX+'signals/'+d+'.json';};
const execPath=d=>{if(!dateOK(d))throw Error('PAPER_LOCKED: bad execution date');return PREFIX+'executions/'+d+'.json';};
function createBlobJournal({client=null}={}){
 function blob(){
  if(!client&&!process.env.BLOB_READ_WRITE_TOKEN)throw Error('PAPER_LOCKED: no private BLOB_READ_WRITE_TOKEN');
  return client||require('@vercel/blob');
 }
 async function readPath(path){
  const b=await blob().get(path,{access:'private'});
  if(!b)return null;
  if(b.statusCode!==200||!b.stream)throw Error('PAPER_LOCKED: Blob not readable: '+path);
  return verifySeal(JSON.parse(await new Response(b.stream).text()));
 }
 async function firstWrite(path,record){
  verifySeal(record);
  const saved=await readPath(path);
  if(saved)return {created:false,record:saved};
  try{
   // No allowOverwrite even in retries; same deterministic date => first writer wins.
   await blob().put(path,JSON.stringify(record),{
    access:'private',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false,
   });
   return {created:true,record};
  }catch(e){
   if(!/already.?exist|conflict|409|overwrite/i.test(String(e?.message||e)))throw e;
   const persisted=await readPath(path);
   if(!persisted)throw Error('PAPER_LOCKED: Blob conflict could not be verified');
   return {created:false,record:persisted};
  }
 }
 async function listPaths(prefix){
  const paths=[];let cursor;
  do{
   const page=await blob().list({prefix,limit:1000,...(cursor?{cursor}:{})});
   for(const item of page.blobs||[])paths.push(item.pathname);
   if(paths.length>MAX_PATHS)throw Error('PAPER_LOCKED: journal page cap reached; no truncated replay');
   cursor=page.hasMore?page.cursor:null;
  }while(cursor);
  return paths;
 }
 async function listSignalDates(){
  const p=await listPaths(PREFIX+'signals/');
  return p.map(x=>x.slice((PREFIX+'signals/').length,-5)).filter(dateOK).sort();
 }
 async function listExecutionDates(){
  const p=await listPaths(PREFIX+'executions/');
  const dates=p.map(x=>x.slice((PREFIX+'executions/').length,-5)).filter(dateOK);
  return dates.sort();
 }
 return {
  getSignal:d=>readPath(signalPath(d)),
  saveSignal:r=>firstWrite(signalPath(r.signalDate),r),
  getExecution:d=>readPath(execPath(d)),
  saveExecution:r=>firstWrite(execPath(r.executionDate),r),
  listExecutionDates,listSignalDates,
 };
}
module.exports={PREFIX,signalPath,execPath,createBlobJournal};
