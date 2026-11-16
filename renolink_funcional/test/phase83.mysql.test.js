'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{once}=require('node:events'),{fork}=require('node:child_process');
const mysql=require('../lib/mysql'),{createServer}=require('../server'),{seed,scenarios}=require('./fixtures/phase5'),{digest}=require('../lib/security');
test('Fase8.3 MySQL: autenticacao, papeis, fluxos completos e persistencia em outro processo sem DDL',{skip:process.env.RENOLINK_PHASE83_APPROVED!=='1'},async()=>{
 const options=mysql.config(process.env,'TEST_MYSQL_');assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');assert.equal(options.host,'127.0.0.1');
 const root=path.resolve(__dirname,'..'),originals=['data/db.json','data/runtime/db.json'].map(f=>path.join(root,f)),hashes=originals.map(f=>digest(fs.readFileSync(f))),store=mysql.mysqlStore(options),previous=await store.read(db=>structuredClone(db));
 const ids=await store.transaction(db=>{assert.equal(db.meta.schemaVersion,5);return seed(db);}),server=createServer(store);server.listen(0,'127.0.0.1');await once(server,'listening');let snapshot,result;
 try{result=await scenarios(`http://127.0.0.1:${server.address().port}`,ids,{disableSupport:()=>store.transaction(db=>{db.staff.find(s=>s.userId===ids.support).active=0;})});snapshot=await store.read(db=>structuredClone(db));
  for(const key of Object.keys(previous).filter(k=>Array.isArray(previous[k]))){const pk=key==='sessions'?'tokenHash':key==='staff'?'userId':'id';for(const row of previous[key])assert.deepEqual(snapshot[key].find(r=>r[pk]===row[pk]),row);}
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await store.close();}
 const env={...process.env,STORAGE_DRIVER:'mysql',NODE_ENV:'development',COOKIE_SECURE:'0',PORT:'0'};delete env.APP_ORIGIN;delete env.NODE_TEST_CONTEXT;
 for(const key of ['HOST','PORT','DATABASE','USER','PASSWORD','SSL','SSL_CA']){delete env['MYSQL_'+key];if(process.env['TEST_MYSQL_'+key]!==undefined)env['MYSQL_'+key]=process.env['TEST_MYSQL_'+key];}
 const child=fork(path.join(root,'test/fixtures/mysql-server.js'),[],{env,execArgv:[],stdio:['ignore','ignore','ignore','ipc']}),exit=new Promise(r=>child.once('exit',r));
 try{const port=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('START_TIMEOUT')),15000);child.once('message',m=>{clearTimeout(t);resolve(m.port);});child.once('exit',()=>{clearTimeout(t);reject(Error('START_FAILED'));});});
 const response=await fetch(`http://127.0.0.1:${port}/api/team/conversations/${result.conversationId}/messages`,{headers:{Cookie:result.visitorCookie},signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);assert.equal((await response.json()).messages.length,2);
 const reopened=mysql.mysqlStore(options);try{await reopened.read(db=>mysql.verify(snapshot,db));}finally{await reopened.close();}
 }finally{child.kill();await exit;}
 originals.forEach((f,i)=>assert.equal(digest(fs.readFileSync(f)),hashes[i]));
 fs.writeFileSync(path.join(root,'data/runtime/phase83-functional.json'),JSON.stringify({status:'passed',database:'renolink_test',schemaChanged:false,persistedAfterNodeRestart:true,previousRowsPreserved:true,flows:'login, admin authorization, approval/rejection, ideas, private conversations, requests, negotiations, audit and staff revocation',counts:mysql.verify(snapshot,snapshot)},null,2));
});
