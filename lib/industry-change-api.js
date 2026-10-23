'use strict';
// Only authorized developer can read or manage pending candidates. Cron can only scan.
const crypto=require('node:crypto');
const monitor=require('./industry-change-monitor');
function secureEquals(a,b){const x=crypto.createHash('sha256').update(String(a||'')).digest(),y=crypto.createHash('sha256').update(String(b||'')).digest();return crypto.timingSafeEqual(x,y)}
function authorized(req,secret){return Boolean(secret)&&secureEquals(req.headers?.authorization||'',`Bearer ${secret}`)}
function respond(res,status,body){res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.status(status).json(body)}
module.exports=async function handler(req,res){
  try{
    const act=String(req.query?.action||'list');const method=String(req.method||'GET').toUpperCase();
    if(!process.env.BLOB_READ_WRITE_TOKEN)return respond(res,503,{ok:false,error:'尚未連結 Private Blob（BLOB_READ_WRITE_TOKEN）'});
    const dev=authorized(req,process.env.STOCKZONE_DEV_SECRET),cron=authorized(req,process.env.CRON_SECRET);
    if(!dev&&!(act==='scan'&&cron))return respond(res,401,{ok:false,error:'需要開發者密鑰，且不能使用一般前端開發者模式代替驗證'});
    if(act==='list'&&method==='GET')return respond(res,200,{ok:true,rows:await monitor.listChanges()});
    if(act==='scan'&&['POST','GET'].includes(method)){
      if(!dev&&method!=='GET')return respond(res,405,{ok:false,error:'Cron 只允許 GET'});
      return respond(res,200,await monitor.scan());
    }
    if(act==='confirm'&&method==='POST'&&dev){
      const ids=req.body?.ids;if(!Array.isArray(ids)||ids.some(x=>typeof x!=='string'))return respond(res,400,{ok:false,error:'ids 格式錯誤'});
      return respond(res,200,await monitor.confirm(ids));
    }
    if(act==='delete'&&method==='POST'&&dev){
      const id=String(req.body?.id||'');if(!/^[a-f0-9]{24}$/.test(id))return respond(res,400,{ok:false,error:'紀錄代碼格式錯誤'});
      return respond(res,200,await monitor.removeConfirmed(id));
    }
    return respond(res,405,{ok:false,error:'不支援的操作'});
  }catch(e){return respond(res,503,{ok:false,error:String(e?.message||e)});}
};
