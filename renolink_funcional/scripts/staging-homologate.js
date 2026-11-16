'use strict';
// Operator tool. No arbitrary URL/database is accepted. Never run against dev.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{configuration,diagnose}=require('../lib/staging'),mysql=require('../lib/mysql');
function stats(values){const v=[...values].sort((a,b)=>a-b),p=q=>v[Math.min(v.length-1,Math.floor(v.length*q))]||0;return{count:v.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99)};}
async function main(){
 assert.equal(process.env.RENOLINK_STAGING_WRITE_APPROVED,'1','Escrita de homologacao nao autorizada.');
 const scenario=process.argv[2];assert.ok(['A','B','C','flows'].includes(scenario));const settings=configuration();await diagnose(settings.mysql);
 const store=mysql.mysqlStore(settings.mysql);let before;try{before=await store.read(db=>structuredClone(db));assert.ok(before.users.every(u=>u.email.endsWith('.invalid')),'Destino contem contas fora da fixture.');}finally{await store.close();}
 const origin=settings.policy.origin,password=crypto.randomBytes(32).toString('base64url'),batch=crypto.randomBytes(8).toString('hex'),samples=[],connections=[],identities=[],errors=[],abort=new AbortController(),duration=Number(process.env.STAGING_SSE_WINDOW_SECONDS||60);assert.ok(Number.isInteger(duration)&&duration>=60&&duration<=3600);
 const file=path.resolve('data/runtime/staging-'+scenario+'-'+Date.now()+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});let measured=false;
 async function request(route,data,cookie,expected){abort.signal.throwIfAborted();const at=performance.now();let status=0;try{const r=await fetch(origin+route,{method:data===undefined?'GET':'POST',redirect:'error',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(60000)])});status=r.status;const body=await r.json();if(expected!==undefined)assert.equal(status,expected);else assert.ok(status>=200&&status<300);return{body,cookie:r.headers.get('set-cookie')?.split(';')[0]};}finally{if(measured)samples.push({operation:(data===undefined?'GET':'POST')+' '+route.split('?')[0].replace(/\/\d+/g,'/:id'),status,ms:performance.now()-at});if(status<200||status>=400)errors.push(status);}}
 async function register(i){const r=await request('/api/auth/register',{name:'Visitante ficticio '+i,email:`stage-${batch}-${i}@homologacao.invalid`,password,role:'creator'},undefined,201);return{id:r.body.user.id,email:r.body.user.email,cookie:r.cookie};}
 async function connect(cookie){abort.signal.throwIfAborted();const controller=new AbortController(),at=performance.now(),r=await fetch(origin+'/api/events',{headers:{Cookie:cookie},signal:AbortSignal.any([abort.signal,controller.signal])});assert.equal(r.status,200);samples.push({operation:'GET /api/events',status:r.status,ms:performance.now()-at});const reader=r.body.getReader(),seen=new Set();let ready=false,failed=false,duplicates=0;
  const pump=(async()=>{let buffer='';const decoder=new TextDecoder();try{for(;;){const v=await reader.read();if(v.done){if(!controller.signal.aborted)failed=true;break;}buffer+=decoder.decode(v.value,{stream:true});let p;while((p=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,p);buffer=buffer.slice(p+2);if(/^event: ready$/m.test(frame))ready=true;if(/^event: changes$/m.test(frame)){const id=/^id: (.+)$/m.exec(frame)?.[1];if(seen.has(id))duplicates++;seen.add(id);}}}}catch{if(!controller.signal.aborted)failed=true;}})();
  connections.push({check:()=>{assert.equal(ready,true);assert.equal(failed,false);assert.equal(duplicates,0);},close:async()=>{controller.abort();await pump;}});
 }
 let activeMs=0,success=false;
 try{
  if(scenario==='flows'){
   const secret=process.env.STAGING_FIXTURE_PASSWORD_FILE,info=fs.lstatSync(secret);assert.ok(info.isFile()&&info.size<=512&&(process.platform==='win32'||(info.mode&0o077)===0));const adminPassword=fs.readFileSync(secret,'utf8').replace(/\r?\n$/,'');measured=true;
   const admin=await request('/api/admin/auth/login',{email:'equipe@homologacao.invalid',password:adminPassword},undefined,200),visitor=await register(0);identities.push(visitor);
   await request('/api/admin/dashboard',undefined,visitor.cookie,403);await request('/api/admin/dashboard',undefined,admin.cookie,200);
   let idea=(await request('/api/ideas',{title:'Ideia sintetica '+batch,category:'Tecnologia',problem:'Problema sintetico',solution:'Solucao sintetica'},visitor.cookie,201)).body.idea;
   await request('/api/admin/ideas/'+idea.id+'/review',{decision:'approve',updatedAt:idea.updatedAt},admin.cookie,200);
   const conversation=(await request('/api/team/conversations',{text:'Mensagem sintetica '+batch},visitor.cookie,201)).body.conversation;
   await request('/api/admin/conversations/'+conversation.id+'/messages',{text:'Resposta sintetica'},admin.cookie,201);
   await request('/api/team/conversations/'+conversation.id+'/messages',undefined,visitor.cookie,200);
   const solicitation=(await request('/api/requests',{ideaId:idea.id},visitor.cookie,201)).body.request;await request('/api/admin/requests/'+solicitation.id+'/status',{status:'Em contato',updatedAt:solicitation.updatedAt},admin.cookie,200);
   const company=await request('/api/auth/login',{email:'empresa@homologacao.invalid',password:adminPassword},undefined,200),negotiation=(await request('/api/ideas/'+idea.id+'/interest',{},company.cookie,201)).body.negotiation;
   await request('/api/admin/negotiations/'+negotiation.id+'/status',{status:'Em contato',updatedAt:negotiation.updatedAt},admin.cookie,200);await request('/api/negotiations',undefined,visitor.cookie,200);await connect(visitor.cookie);
  }else{
   // Setup remains outside timings but still consumes the real anti-abuse budget.
   for(let i=0;i<(scenario==='C'?40:50);i++)identities.push(await register(i));
   measured=true;const at=performance.now();
   await Promise.all(Array.from({length:50},async(_,i)=>{let u;if(scenario==='C'&&i<10){u=await register(40+i);identities.push(u);}else u=identities[scenario==='C'?i-10:i];let cookie=u.cookie;
    if(scenario==='B'||(scenario==='C'&&i>=10&&i<30)){const r=await request('/api/auth/login',{email:u.email,password},undefined,200);assert.equal(r.body.user.id,u.id);cookie=r.cookie;}
    await connect(cookie);
    if(scenario==='A')for(const route of ['/api/me','/api/ideas?mine=1','/api/negotiations','/api/team/conversations','/api/portal/dashboard'])await request(route,undefined,cookie,200);
    if(scenario==='C'){const idea=(await request('/api/ideas',{title:'Carga sintetica '+batch+' '+i,category:'Tecnologia',problem:'Problema sintetico',solution:'Solucao sintetica'},cookie,201)).body.idea;assert.equal(idea.userId,u.id);const conversation=(await request('/api/team/conversations',{text:'Mensagem sintetica '+batch+' '+i},cookie,201)).body.conversation;await request('/api/ideas?mine=1',undefined,cookie,200);await request('/api/team/conversations/'+conversation.id+'/messages',undefined,cookie,200);await request('/api/negotiations',undefined,cookie,200);}
   }));activeMs=performance.now()-at;
  }
  for(let elapsed=0;elapsed<duration;elapsed+=5){console.log(JSON.stringify({event:'staging-observe',scenario,elapsedSeconds:elapsed,sse:connections.length}));await new Promise(r=>setTimeout(r,Math.min(5,duration-elapsed)*1000));}for(const c of connections)c.check();
  const check=mysql.mysqlStore(settings.mysql);try{const after=await check.read(db=>structuredClone(db));for(const key of Object.keys(before).filter(k=>Array.isArray(before[k]))){const pk=key==='sessions'?'tokenHash':key==='staff'?'userId':'id';for(const row of before[key])assert.equal(require('../lib/security').digest(require('../lib/data').stable(after[key].find(r=>r[pk]===row[pk]))),require('../lib/security').digest(require('../lib/data').stable(row)));}for(const u of identities)assert.ok(after.users.some(r=>r.id===u.id));if(scenario==='C'){for(const u of identities){assert.equal(after.ideas.filter(i=>i.userId===u.id).length,1);const c=after.conversations.find(c=>c.visitorId===u.id);assert.ok(c);assert.equal(after.supportMessages.filter(m=>m.conversationId===c.id).length,1);}}}finally{await check.close();}success=true;
 }finally{
  abort.abort();
  for(const c of connections)await c.close();
  const operations=Object.fromEntries([...new Set(samples.map(s=>s.operation))].map(op=>{const v=samples.filter(s=>s.operation===op);return[op,{...stats(v.map(s=>s.ms)),httpErrors:v.filter(s=>s.status>=400||s.status===0).length}];}));
  fs.writeFileSync(file,JSON.stringify({status:success?'passed':'failed',scenario,database:'renolink_staging',windowSeconds:duration,activeMs,activeRps:activeMs?samples.length/(activeMs/1000):null,operations,sse:connections.length,expectedNegativeCases:scenario==='flows',httpErrors:errors.length,serverResourceMetrics:'Collect private runtime JSON logs separately; these timings are HTTP/client only.'},null,2),{flag:'wx'});
 }
}
main().catch(()=>{console.error('Homologacao interrompida; conferir relatorio local, identidade, limites e disponibilidade. Sem repeticao automatica de POST.');process.exitCode=1;});
