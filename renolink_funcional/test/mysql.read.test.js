'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const mysql=require('../lib/mysql');
const {fixture}=require('./fixtures/mysql');
function setup({rollbackFails=false,version='8.0.46'}={}){
 const calls=[],db=fixture();db.users[0].custom={unicode:'ação 💡',items:[1,null,true]};
 const client={
  async execute(sql,params){calls.push({sql,params});
   if(sql.includes('VERSION()'))return[[{db:'renolink_test',version}]];
   if(sql.startsWith('SELECT payload'))return[[{payload:JSON.stringify(db.meta)}]];
   if(sql.includes('JSON_OBJECT'))return[Object.entries(mysql.mappings).flatMap(([key,fields])=>db[key].map(row=>({collection:key,record:{...row,extra:Object.fromEntries(Object.entries(row).filter(([field])=>!fields.includes(field)))}})))];
   if(sql.includes('WHERE email_normalized = ?'))return[[{id:1,password_hash:db.users[0].passwordHash,salt:db.users[0].salt}]];
   throw Error('SQL inesperado');
  },
  async query(sql){calls.push({sql});return[[]];},async beginTransaction(){calls.push({sql:'BEGIN'});},async commit(){calls.push({sql:'COMMIT'});},async rollback(){calls.push({sql:'ROLLBACK'});if(rollbackFails)throw Error('Conexao perdida');},release(){calls.push({sql:'RELEASE'});},destroy(){calls.push({sql:'DESTROY'});}
 };
 const store=mysql.mysqlStore({}, {connectionPool:{getConnection:async()=>client,end:async()=>{}}});return{store,calls,db};
}
test('Leitura MySQL usa snapshot READ ONLY sem lock de escrita, preservando tipos e extras',async()=>{
 const {store,calls,db}=setup();const read=await store.read(state=>structuredClone(state));mysql.verify(db,read);
 assert.ok(calls.some(c=>c.sql==='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'));
 assert.ok(!calls.some(c=>/GET_LOCK|UPDATE |INSERT |DELETE /.test(c.sql)));
 assert.equal(calls.filter(c=>c.sql.includes('JSON_OBJECT')).length,1);assert.equal(calls.at(-1).sql,'RELEASE');
});
test('Erro em leitura executa rollback; falha no rollback descarta a conexao',async()=>{
 for(const broken of [false,true]){const {store,calls}=setup({rollbackFails:broken});await assert.rejects(store.read(()=>{throw Error('Falha de leitura');}),/Falha de leitura/);assert.ok(calls.some(c=>c.sql==='ROLLBACK'));assert.equal(calls.at(-1).sql,broken?'DESTROY':'RELEASE');assert.ok(!calls.some(c=>c.sql==='COMMIT'));}
});
test('Leitura recusa versao MySQL incompatível antes de abrir transacao',async()=>{
 const {store,calls}=setup({version:'5.7.44'});await assert.rejects(store.read(()=>{}),/MySQL/);assert.equal(calls.at(-1).sql,'DESTROY');assert.ok(!calls.some(c=>c.sql==='BEGIN'));
});
test('Busca de credenciais usa indice normalizado com parametro e somente campos necessarios',async()=>{
 const {store,calls}=setup(),value="x' OR 1=1 --";const result=await store.credentials(value);assert.equal(result.id,1);
 const query=calls.find(c=>c.sql.includes('email_normalized'));assert.deepEqual(query.params,[value]);assert.ok(!query.sql.includes(value));assert.deepEqual(Object.keys(result).sort(),['id','passwordHash','salt']);assert.equal(calls.at(-1).sql,'RELEASE');
});
