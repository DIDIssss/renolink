'use strict';
const fs=require('node:fs'),mysql=require('../lib/mysql'),{configuration}=require('../lib/staging'),{seed}=require('../lib/staging-fixture');
async function main(){
 if(process.env.RENOLINK_STAGING_SEED_APPROVED!=='1'||process.env.MYSQL_USER!=='renolink_staging_migrator')throw Error('Operador nao autorizado.');
 configuration({...process.env,MYSQL_USER:'renolink_staging_app'});
 const file=process.env.STAGING_FIXTURE_PASSWORD_FILE,info=fs.lstatSync(file);
 if(!info.isFile()||info.size>512||(process.platform!=='win32'&&(info.mode&0o077)))throw Error('Arquivo secreto deve ser privado e regular.');
 const password=fs.readFileSync(file,'utf8').replace(/\r?\n$/,'');
 const options=mysql.config(),pool=mysql.pool(options);
 try{const [[row]]=await pool.query('SELECT DATABASE() AS db,CURRENT_USER() AS account');const [tls]=await pool.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");if(row.db!=='renolink_staging'||row.account.split('@')[0]!=='renolink_staging_migrator'||!tls[0]?.Value)throw Error('Destino, identidade ou TLS divergente.');}finally{await pool.end();}
 const store=mysql.mysqlStore(options);try{console.log(JSON.stringify(await seed(store,password)));}finally{await store.close();}
}
main().catch(()=>{console.error('Fixture recusada; nenhum segredo ou conta real foi exibido ou modificado.');process.exitCode=1;});
