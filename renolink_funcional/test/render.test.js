'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter,once}=require('node:events');
const hosting=require('../lib/hosting'),{createServer,start,startupFailureLog}=require('../server'),mysql=require('../lib/mysql');
const env={NODE_ENV:'production',APP_ENV:'render',RENDER:'true',RENDER_SERVICE_ID:'srv-synthetic',RENDER_EXTERNAL_HOSTNAME:'renolink-test.onrender.com',APP_ORIGIN:'https://renolink-test.onrender.com',STORAGE_DRIVER:'mysql',COOKIE_SECURE:'1',MYSQL_SSL:'1',TRUST_PROXY:'render',PORT:'10000'};
const headers={host:'renolink-test.onrender.com','x-forwarded-proto':'https','cf-connecting-ip':'203.0.113.8','x-forwarded-for':'203.0.113.8, 172.71.1.2, 10.1.1.2'};
const request=(changes={})=>({method:'GET',url:'/api/me',socket:{remoteAddress:'10.2.3.4'},headers:{...headers},...changes});
test('Render bind respects PORT and local bind remains loopback; invalid ports fail',()=>{
 assert.deepEqual(hosting.binding(env),{host:'0.0.0.0',port:10000});
 assert.deepEqual(hosting.binding({PORT:'3100'}),{host:'127.0.0.1',port:3100});
 assert.deepEqual(hosting.binding({}),{host:'127.0.0.1',port:3000});
 for(const PORT of ['abc','-1','65536','1.5','0'])assert.throws(()=>hosting.binding({...env,PORT}));
});
test('Render SSE supports authenticated simultaneous streams and reconnects; private invalidations remain scoped',async()=>{
 const security=require('../lib/security'),{fixture}=require('./fixtures/mysql');
 const db=require('../lib/phase5-data').initialize(fixture());
 const cookies=[1,2].map(id=>security.issueSession({userId:id},db).cookie.split(';')[0]);
 const store={transaction:async fn=>fn(db)},server=createServer(store,{hosting:hosting.policy(env),realtime:{pollIntervalMs:30,heartbeatMs:50}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port,streams=[];
 const open=(cookie,cursor)=>new Promise((resolve,reject)=>{
  const req=require('node:http').get(base+'/api/events',{headers:{...headers,cookie,...(cursor?{'last-event-id':cursor}:{})}},res=>{
   if(res.statusCode!==200){res.resume();reject(Error('Unexpected SSE status '+res.statusCode));return;}
   assert.match(res.headers['content-type'],/text\/event-stream/);assert.equal(res.headers['x-accel-buffering'],'no');
   const stream={text:'',close:()=>req.destroy()};streams.push(stream);
   const timer=setTimeout(()=>reject(Error('SSE ready timeout')),3000);timer.unref();
   res.on('data',chunk=>{stream.text+=chunk.toString();if(stream.text.includes('event: ready')){clearTimeout(timer);resolve(stream);}});
  });req.on('error',reject);
 });
 const wait=async predicate=>{const until=Date.now()+3000;while(!predicate()){if(Date.now()>until)throw Error('SSE event timeout');await new Promise(r=>setTimeout(r,15));}};
 try{
  const a=await open(cookies[0]),b=await open(cookies[1]);
  const last=[...a.text.matchAll(/id: ([^\n]+)/g)].at(-1)[1];
  const stamp=new Date().toISOString();db.ideas.push({id:db.meta.nextIdeaId++,userId:1,title:'Synthetic private Render idea',category:'Tecnologia',problem:'Synthetic',solution:'Synthetic',beneficiaries:'',participation:'Ainda nao sei',status:'Em análise',potential:'',createdAt:stamp,updatedAt:stamp});
  await wait(()=>a.text.includes('event: changes'));await new Promise(r=>setTimeout(r,100));
  assert.equal(b.text.includes('event: changes'),false);assert.equal(a.text.includes('Synthetic private Render idea'),false);
  a.close();const resumed=await open(cookies[0],last);await wait(()=>resumed.text.includes('event: changes'));
  const ids=[...resumed.text.matchAll(/id: ([^\n]+)/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
 }finally{for(const stream of streams)stream.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Render requires platform identity and production security; local profiles remain distinct',()=>{
 assert.equal(hosting.policy(env).render,true);
 for(const patch of [{RENDER:undefined},{RENDER_SERVICE_ID:''},{APP_ENV:'fair'},{NODE_ENV:'development'},{TRUST_PROXY:'loopback'},{TRUST_PROXY:'*'},{RENDER_EXTERNAL_HOSTNAME:'other.onrender.com'},{COOKIE_SECURE:'0'},{MYSQL_SSL:'0'},{STORAGE_DRIVER:'json'}])assert.throws(()=>hosting.policy({...env,...patch}));
 assert.equal(hosting.policy({}).proxy,'off');
});
test('Render MySQL requires external DNS, isolated database and non-root runtime credentials with TLS identity',()=>{
 const database={...env,MYSQL_HOST:'mysql.provider.test',MYSQL_DATABASE:'renolink_render',MYSQL_USER:'renolink_runtime',MYSQL_PASSWORD:'synthetic-only'};
 const config=mysql.config(database);assert.equal(config.ssl.verifyIdentity,true);assert.equal(config.ssl.rejectUnauthorized,true);
 for(const patch of [{MYSQL_HOST:'127.0.0.1'},{MYSQL_HOST:'::1'},{MYSQL_HOST:'localhost'},{MYSQL_HOST:'db.local'},{MYSQL_HOST:'mysql://bad.host'},{MYSQL_DATABASE:'renolink_dev'},{MYSQL_DATABASE:'renolink_test_copy'},{MYSQL_DATABASE:'mysql'},{MYSQL_USER:'root'},{MYSQL_SSL:'0'}])assert.throws(()=>mysql.config({...database,...patch}));
});
test('Render ignores spoofed XFF prefixes, Forwarded, X-Real-IP and X-Forwarded-Host',()=>{
 const p=hosting.policy(env),r=request();assert.deepEqual(hosting.context(r,p),{ip:'203.0.113.8',secure:true});
 r.headers['x-forwarded-for']='192.0.2.99, '+headers['x-forwarded-for'];
 r.headers.forwarded='for=192.0.2.99;proto=http';r.headers['x-real-ip']='192.0.2.99';r.headers['x-forwarded-host']='evil.invalid';
 assert.deepEqual(hosting.context(r,p),{ip:'203.0.113.8',secure:true});
 for(const [name,value]of [['x-forwarded-proto','http'],['x-forwarded-proto','https,http'],['cf-connecting-ip','192.0.2.99'],['cf-connecting-ip','10.1.1.1'],['x-forwarded-for','garbage'],['x-forwarded-for','203.0.113.8, 198.51.100.7'],['host','evil.invalid']])assert.throws(()=>hosting.context(request({headers:{...headers,[name]:value}}),p),e=>e.status===403);
 assert.throws(()=>hosting.context(request({socket:{remoteAddress:'198.51.100.1'}}),p),e=>e.status===403);
 assert.throws(()=>hosting.context(request({rawHeaders:['X-Forwarded-For','a','x-forwarded-for','b']}),p),e=>e.status===403);
 assert.deepEqual(hosting.context(request({socket:{remoteAddress:'::ffff:10.2.3.4'}}),p),{ip:'203.0.113.8',secure:true});
});
test('only exact GET health routes can use direct internal probes without forwarding headers',()=>{
 const p=hosting.policy(env),r=request({url:'/health/ready',headers:{host:headers.host}});
 assert.deepEqual(hosting.context(r,p),{ip:'10.2.3.4',secure:false});
 for(const change of [{url:'/api/events'},{url:'/api/auth/login'},{url:'/health/ready?x=1'},{method:'POST'},{socket:{remoteAddress:'198.51.100.1'}}])assert.throws(()=>hosting.context({...r,...change},p),e=>e.status===403);
});
test('startup uses Render host and port only after initialized storage; unavailable MySQL never opens HTTP',async()=>{
 let initialized=false,bound,closed=false;
 const baseline=new Map(['SIGINT','SIGTERM','exit'].map(s=>[s,process.listeners(s)]));
 const fake=new EventEmitter();fake.listen=(port,host)=>{assert.equal(initialized,true);bound={port,host};};
 try{
  await start({env,storageFactory:()=>({initialize:async()=>{initialized=true;},close:async()=>{}}),serverFactory:()=>fake});
  assert.deepEqual(bound,{port:10000,host:'0.0.0.0'});
 }finally{for(const [s,previous]of baseline)for(const handler of process.listeners(s))if(!previous.includes(handler))process.removeListener(s,handler);}
 const pool={getConnection:async()=>{throw Error('synthetic unavailable');},end:async()=>{closed=true;}};
 const store=mysql.mysqlStore({database:'synthetic'}, {connectionPool:pool});
 const stages=[];let created=false;await assert.rejects(start({env,storageFactory:()=>store,serverFactory:()=>{created=true;},onStartupStage:stage=>stages.push(stage)}));
 assert.deepEqual(stages,['hosting_configuration','storage_configuration','storage_initialization']);
 assert.equal(closed,true);assert.equal(created,false);
});
test('startup diagnostic identifies stage and safe category without serializing error details',()=>{
 const error=Object.assign(Error('synthetic secret sentinel'),{code:'ER_ACCESS_DENIED_ERROR'});
 const entry=startupFailureLog('storage_initialization',error,env);
 assert.deepEqual(JSON.parse(entry),{event:'startup_failed',environment:'render',stage:'storage_initialization',category:'mysql_authentication'});
 assert.equal(entry.includes('synthetic secret sentinel'),false);
 assert.equal(JSON.parse(startupFailureLog('hosting_configuration',Error('private'))).category,'hosting_configuration');
 assert.equal(JSON.parse(startupFailureLog('storage_configuration',Error('private'))).category,'mysql_configuration');
 assert.equal(JSON.parse(startupFailureLog('storage_initialization',Object.assign(Error(),{code:'RENOLINK_SCHEMA_INVALID'}))).category,'mysql_schema');
 assert.equal(JSON.parse(startupFailureLog('storage_initialization',Object.assign(Error(),{code:'ERR_TLS_CERT_ALTNAME_INVALID'}))).category,'mysql_tls');
 assert.equal(JSON.parse(startupFailureLog('storage_initialization',Object.assign(Error(),{code:'ENOTFOUND'}))).category,'mysql_network');
 assert.equal(JSON.parse(startupFailureLog('http_listen',Object.assign(Error(),{code:'EADDRINUSE'}))).category,'port_in_use');
});
test('Render HTTP integration: health, CSRF, secure cookies and logs without secrets',async()=>{
 const fetch=(url,options={})=>new Promise((resolve,reject)=>{
  const req=require('node:http').request(url,options,res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
    const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:{get:name=>{const value=res.headers[name];return Array.isArray(value)?value.join('; '):value;}},json:async()=>JSON.parse(text)});
   });
  });req.on('error',reject);req.end(options.body);
 });
 const security=require('../lib/security'),{fixture}=require('./fixtures/mysql');
 const db=require('../lib/phase5-data').initialize(fixture()),logs=[];
 const store={transaction:async fn=>fn(db),health:async()=>true};
 const server=createServer(store,{hosting:{...hosting.policy(env),log:true},logger:x=>logs.push(x)});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const oldOrigin=process.env.APP_ORIGIN,oldCookie=process.env.COOKIE_SECURE;process.env.APP_ORIGIN=env.APP_ORIGIN;process.env.COOKIE_SECURE='1';
 const post=(url,data,extra={})=>fetch(base+url,{method:'POST',headers:{...headers,'content-type':'application/json',origin:env.APP_ORIGIN,...extra},body:JSON.stringify(data)});
 try{
  assert.equal((await fetch(base+'/health/ready',{headers:{host:headers.host}})).status,200);
  assert.equal((await fetch(base+'/health/live',{headers:{host:headers.host}})).status,200);
  const login=await post('/api/auth/login',{email:'pessoa1@teste.invalid',password:'123456'});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');
  for(const token of ['HttpOnly','Secure','SameSite=Strict'])assert.ok(cookie.includes(token));
  assert.equal((await fetch(base+'/api/me',{headers:{...headers,cookie:cookie.split(';')[0]}})).status,200);
  assert.equal((await post('/api/auth/login',{email:'pessoa1@teste.invalid',password:'123456'},{origin:'https://evil.invalid'})).status,403);
  assert.equal((await fetch(base+'/api/admin/dashboard',{headers:{...headers,cookie:cookie.split(';')[0]}})).status,403);
  assert.equal((await fetch(base+'/data/db.json',{headers})).status,404);
  assert.equal((await fetch(base+'/api/me',{headers:{...headers,'x-forwarded-proto':'http'}})).status,403);
  await new Promise(r=>setImmediate(r));const output=JSON.stringify(logs);for(const secret of ['123456',cookie,'pessoa1@teste.invalid'])assert.equal(output.includes(secret),false);
  assert.equal(db.sessions.length,1);assert.ok(!db.sessions[0].token);assert.match(db.sessions[0].tokenHash,/^[a-f0-9]{64}$/);
 }finally{
  if(oldOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=oldOrigin;
  if(oldCookie===undefined)delete process.env.COOKIE_SECURE;else process.env.COOKIE_SECURE=oldCookie;
  server.closeAllConnections();await new Promise(r=>server.close(r));
 }
});
