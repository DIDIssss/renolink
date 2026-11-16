'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const mysql=require('../lib/mysql');
const {seed}=require('./fixtures/phase5');
test('MySQL: snapshot de leitura consistente permite escrita concorrente sem misturar versoes', {skip:process.env.RENOLINK_PHASE81_APPROVED!=='1'},async()=>{
 const options=mysql.config(process.env,'TEST_MYSQL_');assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');
 const writer=mysql.mysqlStore(options),pool=mysql.pool(options);let resume,paused;
 const gate=new Promise(r=>resume=r),reached=new Promise(r=>paused=r);
 const intercepted={getConnection:async()=>{
  const client=await pool.getConnection(),execute=client.execute.bind(client);let first=true;
  const wrapper={execute:async(sql,args)=>{const result=await execute(sql,args);if(first&&sql==='SELECT payload FROM renolink_meta WHERE id = 1'){first=false;paused();await gate;}return result;},query:client.query.bind(client),beginTransaction:client.beginTransaction.bind(client),commit:client.commit.bind(client),rollback:client.rollback.bind(client),release:client.release.bind(client),destroy:client.destroy.bind(client)};return wrapper;
 },end:()=>pool.end()};
 const reader=mysql.mysqlStore(options,{connectionPool:intercepted});
 try{
  const ids=await writer.transaction(db=>seed(db));const old=await writer.read(db=>structuredClone(db));
  mysql.verify(await mysql.transaction(pool,mysql.load),old);
  const reading=reader.read(db=>structuredClone(db));await reached;
  const ideaId=await writer.transaction(db=>{const id=db.meta.nextIdeaId++;db.ideas.push({id,userId:ids.visitor,title:'Snapshot concorrente',category:'Tecnologia',problem:'Problema',solution:'Solucao',beneficiaries:'',participation:'Ainda não sei',status:'Em análise',potential:'Alto',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});return id;});
  resume();const snapshot=await reading;mysql.verify(old,snapshot);assert.equal(snapshot.ideas.some(i=>i.id===ideaId),false);
  assert.equal(await writer.read(db=>db.ideas.some(i=>i.id===ideaId)),true);
  const credentials=await writer.credentials(ids.visitorEmail);assert.equal(credentials.id,ids.visitor);assert.deepEqual(Object.keys(credentials).sort(),['id','passwordHash','salt']);
  // A read callback cannot persist accidental mutations.
  await writer.read(db=>{db.users.find(u=>u.id===ids.visitor).name='Nao persistir';});
  assert.equal(await writer.read(db=>db.users.find(u=>u.id===ids.visitor).name),'Teste visitor');
 }finally{resume();await reader.close();await writer.close();}
});
