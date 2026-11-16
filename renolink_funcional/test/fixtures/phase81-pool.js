'use strict';
const assert=require('node:assert/strict');
const mysql=require('../../lib/mysql');
const tables=['meta','users','ideas','negotiations','messages','sessions','staff','conversations','support_messages','requests','audit','imports'];
function mappedPool(options,prefix,observe=()=>{}){
 assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');assert.match(prefix,/^b81_[a-f0-9]{8}_(seed|[abcd](10|25|50))_$/);
 const source=mysql.pool(options),connections=new Set();let active=0,peakActive=0;
 const rewrite=sql=>sql.replace(/\brenolink_([a-z_]+)\b/g,(all,name)=>tables.includes(name)?prefix+name:all);
 return{
  async getConnection(){
   const start=performance.now(),client=await source.getConnection();observe('poolWait',performance.now()-start);connections.add(client.threadId);active++;peakActive=Math.max(peakActive,active);
   let released=false;
   const finish=()=>{if(!released){active--;released=true;}};
   const run=async(method,sql,args)=>{const started=performance.now();let result;let label=/GET_LOCK\(/.test(sql)?'namedLock':/RELEASE_LOCK\(/.test(sql)?'releaseLock':sql.replace(/\s+/g,' ').slice(0,150);try{result=await client[method](rewrite(sql),args);return result;}finally{observe('sql:'+label,performance.now()-started,{rows:Array.isArray(result?.[0])?result[0].length:0});}};
   return{execute:(sql,args)=>run('execute',sql,args),query:(sql,args)=>run('query',sql,args),beginTransaction:()=>run('query','START TRANSACTION'),commit:()=>run('query','COMMIT'),rollback:()=>run('query','ROLLBACK'),release(){finish();client.release();},destroy(){finish();client.destroy();}};
  },
  metrics:()=>({createdConnections:connections.size,active,peakActive,connectionLimit:options.connectionLimit}),end:()=>source.end()
 };
}
module.exports={mappedPool,tables};
