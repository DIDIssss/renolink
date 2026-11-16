'use strict';
const fs=require('node:fs');
const path=require('node:path');
const mysql=require('../lib/mysql');
const {stable}=require('../lib/data');
const {digest}=require('../lib/security');
async function main(){
 const options=mysql.config();
 if(options.host!=='127.0.0.1'||options.database!=='renolink_dev'||options.user!=='renolink_app')throw Error();
 const pool=mysql.pool(options);
 try{
  const [[identity]]=await pool.execute('SELECT CURRENT_USER() AS account');
  if(identity.account!=='renolink_app@127.0.0.1')throw Error();
  const report=await mysql.transaction(pool,async client=>{
   const db=await mysql.load(client);
   return{database:'renolink_dev',schemaVersion:db.meta.schemaVersion,counts:Object.fromEntries(Object.keys(mysql.mappings).map(k=>[k,db[k].length])),staffAssociations:db.staff.length,activeAdministrators:db.staff.filter(s=>s.accessRole==='admin'&&s.active===1).length,auditEvents:db.audit.length,historicalRowsSha256:digest(stable(Object.fromEntries(Object.keys(mysql.mappings).map(k=>[k,db[k]])))),readOnly:true,realGrantExecuted:false};
  });
  fs.writeFileSync(path.join(__dirname,'../data/runtime/phase6-dev-inspection.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await pool.end();}
}
main().catch(()=>{console.error('Inspecao somente de leitura recusada; nenhuma concessao foi executada.');process.exitCode=1;});
