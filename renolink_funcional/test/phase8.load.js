'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const os=require('node:os');
const {performance}=require('node:perf_hooks');
const {fork}=require('node:child_process');
const mysql=require('../lib/mysql');
const root=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function stats(values){const v=[...values].sort((a,b)=>a-b);return{count:v.length,meanMs:v.reduce((a,b)=>a+b,0)/(v.length||1),p50Ms:v[Math.min(v.length-1,Math.floor(v.length*.5))]||0,p95Ms:v[Math.min(v.length-1,Math.floor(v.length*.95))]||0,p99Ms:v[Math.min(v.length-1,Math.floor(v.length*.99))]||0,maxMs:v.at(-1)||0};}
async function run(count,options,{poolFactory=mysql.pool,childFile=path.join(__dirname,'fixtures/load-server.js'),childEnv=process.env,minimumDurationMs=0,includeNegotiations=false}={}){
 const pool=poolFactory(options);let before;
 try{before=await mysql.transaction(pool,mysql.load);}finally{await pool.end();}
 const child=fork(childFile,[],{env:childEnv,execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
 const exited=new Promise(resolve=>child.once('exit',resolve));
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SERVER_START_TIMEOUT')),15000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve(m);}});child.once('exit',()=>{clearTimeout(timer);reject(Error('SERVER_START_FAILED'));});});
 const base=`http://127.0.0.1:${ready.port}`,measurements=[],connections=[],sse={opened:0,ready:0,changes:0,duplicateFrames:0,failures:0};
 const password=crypto.randomBytes(32).toString('base64url'),batch=crypto.randomBytes(8).toString('hex');
 const counts={registered:0,loggedIn:0,ideas:0,messages:0,completeUsers:0};let verifiedFlows=0;
 const started=performance.now();
 async function request(route,data,cookie){const start=performance.now();let status=0,result={};
  try{const response=await fetch(base+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(60000)});status=response.status;result={body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  catch{result={body:{}};}
  measurements.push({route:route.replace(/\/\d+/g,'/:id'),status,ms:performance.now()-start});return{status,...result};
 }
 async function connect(cookie){
  const controller=new AbortController(),start=performance.now();const timeout=setTimeout(()=>controller.abort(),60000);
  try{
   const response=await fetch(base+'/api/events',{headers:{Cookie:cookie},signal:controller.signal});clearTimeout(timeout);
   measurements.push({route:'/api/events',status:response.status,ms:performance.now()-start});
   if(response.status!==200){controller.abort();sse.failures++;return;}
   sse.opened++;const reader=response.body.getReader();const seen=new Set();
   const pump=(async()=>{let buffer='';const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done){if(!controller.signal.aborted)sse.failures++;break;}buffer+=decoder.decode(value,{stream:true});let p;while((p=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,p);buffer=buffer.slice(p+2);const type=/^event: (.+)$/m.exec(frame)?.[1],id=/^id: (.+)$/m.exec(frame)?.[1];if(type==='ready')sse.ready++;if(type==='changes'){sse.changes++;if(seen.has(id))sse.duplicateFrames++;seen.add(id);}}}}catch{if(!controller.signal.aborted)sse.failures++;}})();
   connections.push({close:async()=>{controller.abort();await pump;}});
  }catch{clearTimeout(timeout);sse.failures++;measurements.push({route:'/api/events',status:0,ms:performance.now()-start});}
 }
 try{
  await Promise.all(Array.from({length:count},async(_,i)=>{
   const email=`load-${batch}-${i}@teste.invalid`;
   const registration=await request('/api/auth/register',{name:`Visitante carga ${i}`,email,password,role:'creator'});
   if(registration.status!==201)return;counts.registered++;
   const login=await request('/api/auth/login',{email,password});if(login.status!==200)return;counts.loggedIn++;
   await connect(login.cookie);
   const idea=await request('/api/ideas',{title:`Carga ${batch} ${i}`,category:'Tecnologia',problem:'Problema sintetico',solution:'Solucao sintetica'},login.cookie);if(idea.status===201)counts.ideas++;
   const message=await request('/api/team/conversations',{text:`Mensagem sintetica de carga ${i}`},login.cookie);if(message.status===201)counts.messages++;
   const mine=await request('/api/ideas?mine=1',undefined,login.cookie);const messages=message.body?.conversation?await request(`/api/team/conversations/${message.body.conversation.id}/messages`,undefined,login.cookie):{status:0};
   const negotiation=includeNegotiations?await request('/api/negotiations',undefined,login.cookie):{status:200};
   if(login.body?.user?.id===registration.body?.user?.id&&idea.body?.idea?.userId===login.body?.user?.id&&mine.body?.ideas?.some(row=>row.id===idea.body?.idea?.id&&row.userId===login.body?.user?.id)&&messages.body?.messages?.some(row=>row.text===`Mensagem sintetica de carga ${i}`&&row.senderId===login.body?.user?.id))verifiedFlows++;
   if(idea.status===201&&message.status===201&&mine.status===200&&messages.status===200&&negotiation.status===200)counts.completeUsers++;
  }));
  const operationsCompletedMs=performance.now()-started;
  await sleep(Math.max(3000,minimumDurationMs-operationsCompletedMs));
  const metrics=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('METRIC_TIMEOUT')),10000);const receive=m=>{if(m.type==='metrics'){clearTimeout(timer);child.off('message',receive);resolve(m);}};child.on('message',receive);child.send({type:'metrics'});});
  for(const c of connections)await c.close();
  const check=poolFactory(options);let after;
  try{after=await mysql.transaction(check,mysql.load);}finally{await check.end();}
  let preserved=true;
  for(const key of [...Object.keys(mysql.mappings),'staff','audit','conversations','supportMessages','requests']){
   const primary=key==='sessions'?'tokenHash':key==='staff'?'userId':'id';for(const row of before[key])try{assert.deepEqual(after[key].find(r=>r[primary]===row[primary]),row);}catch{preserved=false;}
  }
  const statuses={};for(const m of measurements)statuses[m.status]=(statuses[m.status]||0)+1;
  const routes={};for(const route of new Set(measurements.map(m=>m.route)))routes[route]=stats(measurements.filter(m=>m.route===route).map(m=>m.ms));
  return{virtualUsers:count,sharedIp:true,verifiedFlows,operationsCompletedMs,measurementWindowMs:metrics.wallMs,durationMs:performance.now()-started,counts,requests:measurements.length,statuses,errors:measurements.filter(m=>m.status<200||m.status>=400).length,http:stats(measurements.map(m=>m.ms)),routes,resources:metrics,sse,oldRowsPreserved:preserved,persistedNew:{users:after.users.length-before.users.length,ideas:after.ideas.length-before.ideas.length,supportMessages:after.supportMessages.length-before.supportMessages.length},initialRows:Object.fromEntries(['users','ideas','supportMessages'].map(k=>[k,before[k].length]))};
 }finally{for(const c of connections)await c.close();child.send({type:'close'});await exited;}
}
async function main(){
 assert.equal(process.env.RENOLINK_PHASE8_TEST_APPROVED,'1');const options=mysql.config(process.env,'TEST_MYSQL_');assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');
 const baseline=process.argv.includes('--baseline'),scenarios=baseline?[10]:[10,25,50];
 const report={label:baseline?'baseline':'final',database:'renolink_test',reset:false,applicationLimitsUnchangedDuringRun:true,host:{logicalCpus:os.cpus().length,totalMemoryGiB:os.totalmem()/1073741824},cases:[]};
 const output=path.join(root,'data/runtime/phase8-load-'+report.label+'.json');
 for(const count of scenarios){console.log(`Carga isolada: ${count} usuarios virtuais`);const result=await run(count,options);report.cases.push(result);fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({virtualUsers:count,counts:result.counts,statuses:result.statuses,p95Ms:result.http.p95Ms,peakRssMiB:result.resources.peakRssMiB}));if(!baseline){assert.equal(result.errors,0);assert.equal(result.counts.completeUsers,count);assert.equal(result.oldRowsPreserved,true);assert.equal(result.sse.ready,count);assert.equal(result.sse.failures,0);assert.equal(result.sse.duplicateFrames,0);assert.deepEqual(result.persistedNew,{users:count,ideas:count,supportMessages:count});}}
}
module.exports={run,stats};
if(require.main===module)main().catch(()=>{console.error('Teste de carga isolado interrompido. Nenhum segredo registrado.');process.exitCode=1;});
