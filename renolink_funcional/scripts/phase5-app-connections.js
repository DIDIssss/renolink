'use strict';
const assert=require('node:assert/strict');
const mysql=require('../lib/mysql');
async function main(){
 const options=mysql.config();assert.equal(options.database,'renolink_dev');assert.equal(options.user,'renolink_app');
 const pool=mysql.pool(options);
 try{
  const [[identity]]=await pool.execute('SELECT CONNECTION_ID() AS id,CURRENT_USER() AS account');
  assert.equal(identity.account,'renolink_app@127.0.0.1');
  const [processes]=await pool.query('SHOW PROCESSLIST');
  assert.equal(processes.filter(p=>p.db==='renolink_dev'&&Number(p.Id)!==Number(identity.id)).length,0);
  console.log('Nenhuma outra conexao da conta da aplicacao em renolink_dev.');
 }finally{await pool.end();}
}
main().catch(()=>{console.error('Verificacao de concorrencia da aplicacao falhou. Interrompa.');process.exitCode=1;});
