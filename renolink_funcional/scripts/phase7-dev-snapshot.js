'use strict';
const fs=require('node:fs');
const path=require('node:path');
const mysql=require('../lib/mysql');
const {stable}=require('../lib/data');
const {digest}=require('../lib/security');
async function main(){
 const stage=process.argv[2],prefix=process.argv[3]||'phase7';if(!['before','after'].includes(stage)||(!['phase7','phase8','phase81','phase82','phase9'].includes(prefix)&&!/^phase8[123]-[a-z0-9-]{1,40}$/.test(prefix)))throw Error();
 const options=mysql.config();if(options.host!=='127.0.0.1'||options.database!=='renolink_dev'||options.user!=='renolink_app')throw Error();
 const pool=mysql.pool(options);
 try{
  const report=await mysql.transaction(pool,async client=>{
   const [[identity]]=await client.execute('SELECT CURRENT_USER() AS account');if(identity.account!=='renolink_app@127.0.0.1')throw Error();
   const db=await mysql.load(client);
   const [tables]=await client.execute('SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE()');
   const ddl={};for(const table of tables.sort((a,b)=>a.name.localeCompare(b.name))){if(!/^renolink_[a-z_]+$/.test(table.name))throw Error();const [[row]]=await client.query('SHOW CREATE TABLE `'+table.name+'`');ddl[table.name]=row['Create Table'];}
   return{database:'renolink_dev',stage,stateSha256:digest(stable(db)),schemaSha256:digest(stable(ddl)),staffSha256:digest(stable(db.staff)),counts:mysql.verify(db,db),readOnly:true};
  });
  const output=path.join(__dirname,'../data/runtime/'+prefix+'-dev-'+stage+'.json');
  if(stage==='after'){
   const before=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/runtime/'+prefix+'-dev-before.json')));
   report.unchanged=report.stateSha256===before.stateSha256&&report.schemaSha256===before.schemaSha256&&report.staffSha256===before.staffSha256;
  }
  fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(stage==='after'&&!report.unchanged)throw Error('Dados ou estrutura divergentes.');
 }finally{await pool.end();}
}
main().catch(()=>{console.error('Snapshot somente de leitura recusado; nenhum segredo exibido.');process.exitCode=1;});
