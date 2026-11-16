'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const {fork}=require('node:child_process');
const {chromium}=require('playwright');
const mysql=require('../lib/mysql');
const {createServer}=require('../server');
const {seed}=require('./fixtures/phase5');
const {digest}=require('../lib/security');
const root=path.resolve(__dirname,'..');
let stage='setup';
function progress(value){stage=value;console.log('SSE teste: '+value);}
async function childServer(port){
 const env={...process.env,STORAGE_DRIVER:'mysql',NODE_ENV:'development',COOKIE_SECURE:'0',PORT:String(port)};delete env.APP_ORIGIN;delete env.NODE_TEST_CONTEXT;
 for(const key of ['HOST','PORT','DATABASE','USER','PASSWORD','SSL','SSL_CA']){delete env['MYSQL_'+key];if(process.env['TEST_MYSQL_'+key]!==undefined)env['MYSQL_'+key]=process.env['TEST_MYSQL_'+key];}
 const child=fork(path.join(root,'test/fixtures/mysql-server.js'),[],{env,execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
 const exited=new Promise(resolve=>child.once('exit',resolve));
 try{
  const actualPort=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Child startup timeout')),15000);child.once('message',m=>{clearTimeout(timer);resolve(m.port);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Child exited'));});child.once('error',()=>{clearTimeout(timer);reject(Error('Child startup failed'));});});
  return{base:`http://127.0.0.1:${actualPort}`,port:actualPort,close:async()=>{child.kill();await exited;}};
 }catch(error){child.kill();await exited;throw error;}
}
async function main(){
 assert.equal(process.env.RENOLINK_PHASE7_TEST_APPROVED,'1');const options=mysql.config(process.env,'TEST_MYSQL_');assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');
 const originalFiles=['data/db.json','data/runtime/db.json'].map(f=>path.join(root,f)),originalHashes=originalFiles.map(f=>digest(fs.readFileSync(f)));
 const store=mysql.mysqlStore(options);const before=await store.transaction(db=>structuredClone(db));
 const ids=await store.transaction(db=>{assert.equal(db.meta.schemaVersion,5);return seed(db);});
 const server=createServer(store,{realtime:{pollIntervalMs:200}});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 let other=await childServer(0),browser;
 const checks=[],jsErrors=[],debugPages=[],network=[];const output=path.join(root,'data/runtime/phase7-preview');fs.mkdirSync(output,{recursive:true});
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const adminContext=await browser.newContext({viewport:{width:1440,height:1000},locale:'pt-BR'}),aContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'pt-BR'}),bContext=await browser.newContext({viewport:{width:1280,height:900},locale:'pt-BR'});
  for(const context of [adminContext,aContext,bContext])await context.addInitScript(()=>{
   window.__rtEvents=[];window.__rtRequests=[];
   const Native=window.EventSource;
   window.EventSource=class extends Native{constructor(url,options){super(url,options);window.__rtSource=this;for(const type of ['ready','changes','reset'])this.addEventListener(type,event=>{window.__rtEvents.push({type,id:event.lastEventId,data:JSON.parse(event.data)});});}};
  });
  const admin=await adminContext.newPage(),a=await aContext.newPage(),b=await bContext.newPage();
  debugPages.push(admin,a,b);for(const [index,p]of debugPages.entries())p.on('response',r=>{const url=new URL(r.url());if(url.pathname.startsWith('/api/'))network.push({page:index,method:r.request().method(),route:url.pathname,status:r.status()});});
  const reconnectHeaders=[];
  a.on('request',async req=>{if(req.url().endsWith('/api/events'))reconnectHeaders.push((await req.allHeaders())['last-event-id']||null);});
  for(const page of [admin,a,b])page.on('pageerror',e=>jsErrors.push(e.message));
  async function login(page,origin,email,isAdmin=false){
   await page.goto(origin+(isAdmin?'/admin-login.html':'/login.html'));
   await page.locator(isAdmin?'#adminEmail':'input[name=email]').fill(email);await page.locator(isAdmin?'#adminPassword':'input[name=password]').fill('SenhaTeste2026!');
   await page.locator(isAdmin?'#adminLoginForm button':'#loginForm button[type=submit]').click();await page.waitForURL(isAdmin?'**/admin.html':'**/dashboard.html');
   await page.waitForFunction(()=>document.getElementById('realtimeStatus')?.dataset.state==='online');
  }
  progress('login das tres sessoes');
  await login(admin,base,ids.adminEmail,true);await login(a,other.base,ids.visitorEmail);await login(b,base,ids.outsiderEmail);
  await admin.getByRole('button',{name:'Ideias recebidas',exact:true}).click();await admin.locator('#adminSearch').waitFor();
  await b.goto(base+'/mensagens.html');await b.waitForFunction(()=>document.getElementById('realtimeStatus')?.dataset.state==='online');
  const privateBaseline=await b.evaluate(()=>window.__rtEvents.filter(e=>e.type==='changes').length);
  progress('ideia privada entre processos');
  await a.locator('.visitor-mobile-nav').getByRole('link',{name:'Nova ideia',exact:true}).click();
  const title=`Ideia ao vivo ${ids.visitor}`;
  await a.locator('#titulo').fill(title);await a.locator('#categoria').selectOption('Tecnologia');await a.locator('#problema').fill('Um problema para testar eventos privados.');await a.locator('#solucao').fill('Uma solução colaborativa em tempo real.');
  await a.locator('#ideaForm button[type=submit]').click();await a.waitForURL('**/dashboard.html?created=1');
  await admin.locator('#ideaRows').getByText(title,{exact:true}).waitFor({timeout:15000});
  assert.equal(await b.evaluate(()=>window.__rtEvents.filter(e=>e.type==='changes').length),privateBaseline);
  checks.push('nova ideia privada aparece automaticamente no admin de outro processo; visitante B nao recebe evento');
  progress('aprovacao automatica para o autor');
  await admin.locator('#adminSearch').fill(title);await admin.locator('#ideaRows').getByRole('button',{name:'Analisar',exact:true}).click();await admin.locator('#approveIdea').click();await admin.locator('#ideaDialog').waitFor({state:'hidden'});
  await a.getByRole('row').filter({hasText:title}).getByText('Publicada',{exact:true}).waitFor({timeout:15000});
  checks.push('aprovacao atualiza o autor automaticamente no celular');
  progress('mensagens privadas e rascunhos');
  await a.locator('.visitor-mobile-nav').getByRole('link',{name:'Equipe',exact:true}).click();await a.waitForFunction(()=>!document.querySelector('#messageForm button').disabled);
  const beforePrivateMessages=await b.evaluate(()=>window.__rtEvents.filter(e=>e.type==='changes'&&e.data.topics.includes('messages')).length);
  const text=`Mensagem privada ao vivo ${ids.visitor}`;
  await a.locator('#messageText').fill(text);await a.locator('#messageForm button').click();await a.locator('#messageList').getByText(text,{exact:true}).waitFor();
  await admin.getByRole('button',{name:'Atendimento',exact:true}).click();
  const conversationId=await store.transaction(db=>db.conversations.find(c=>c.visitorId===ids.visitor).id);
  await admin.locator(`[data-conversation="${conversationId}"]`).click();await admin.locator('#teamChat').getByText(text,{exact:true}).waitFor();
  await a.locator('#messageText').fill('Rascunho do visitante preservado');
  await admin.locator('#replyText').fill('Resposta automatica da equipe');await admin.locator('#replyForm button').click();
  await a.locator('#messageList').getByText('Resposta automatica da equipe',{exact:true}).waitFor({timeout:15000});assert.equal(await a.locator('#messageText').inputValue(),'Rascunho do visitante preservado');
  await admin.locator('#replyText').fill('Rascunho da equipe preservado');await admin.locator('#replyText').focus();await admin.evaluate(()=>{window.__replyComposer=document.getElementById('replyText');});
  await a.locator('#messageText').fill('Outra mensagem ao vivo');await a.locator('#messageForm button').click();
  await admin.locator('#teamChat').getByText('Outra mensagem ao vivo',{exact:true}).waitFor({timeout:15000});assert.equal(await admin.locator('#replyText').inputValue(),'Rascunho da equipe preservado');
  assert.equal(await admin.evaluate(()=>window.__replyComposer===document.getElementById('replyText')),true);
  assert.equal(await b.evaluate(()=>window.__rtEvents.filter(e=>e.type==='changes'&&e.data.topics.includes('messages')).length),beforePrivateMessages);
  assert.equal(await b.getByText('Resposta automatica da equipe',{exact:true}).count(),0);
  checks.push('mensagens bidirecionais automaticas, isolamento e rascunhos preservados');
  progress('offline e reinicio do processo');
  await aContext.setOffline(true);await other.close();
  await admin.locator('#replyText').fill('Resposta persistida durante desconexao');await admin.locator('#replyForm button').click();await admin.locator('#teamChat').getByText('Resposta persistida durante desconexao',{exact:true}).waitFor();
  other=await childServer(other.port);await aContext.setOffline(false);
  await a.locator('#messageList').getByText('Resposta persistida durante desconexao',{exact:true}).waitFor({timeout:20000});
  await a.waitForFunction(()=>document.getElementById('realtimeStatus')?.dataset.state==='online');
  assert.equal(await a.locator('#messageList').getByText('Resposta persistida durante desconexao',{exact:true}).count(),1);
  assert.ok(reconnectHeaders.some(Boolean));assert.ok(await a.evaluate(()=>window.__rtEvents.some(e=>e.type==='reset')));
  progress('deduplicacao');
  const requestsBefore=await a.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/team/conversations')).length);
  await a.evaluate(()=>{const event=[...window.__rtEvents].reverse().find(e=>e.type==='changes'&&e.id);if(event)window.__rtSource.dispatchEvent(new MessageEvent('changes',{data:JSON.stringify(event.data),lastEventId:event.id}));});
  await a.waitForTimeout(500);
  assert.equal(await a.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/team/conversations')).length),requestsBefore);
  checks.push('reconexao nativa com Last-Event-ID apos offline e reinicio Node; reset recupera MySQL sem duplicar ou recarregar por evento repetido');
  progress('solicitacoes e negociacoes');
  await admin.getByRole('button',{name:'Negociações',exact:true}).click();
  await a.goto(other.base+'/dashboard.html');await a.getByRole('link',{name:title,exact:true}).click();await a.locator('#interestButton').click();await a.locator('#interestAlert').filter({hasText:'Solicitação enviada'}).waitFor();
  const requestId=await store.transaction(db=>db.requests.find(r=>r.visitorId===ids.visitor&&db.ideas.find(i=>i.id===r.ideaId)?.title===title).id);
  await admin.locator(`[data-deal="requests-${requestId}"]`).waitFor({timeout:15000});
  await a.locator('.visitor-mobile-nav').getByRole('link',{name:'Negociações',exact:true}).click();
  const dealRow=admin.getByRole('row').filter({has:admin.locator(`[data-deal="requests-${requestId}"]`)});await dealRow.getByRole('combobox').selectOption('Em contato');await dealRow.getByRole('button',{name:'Atualizar etapa'}).click();
  await a.locator('#negotiationList').getByText('Em contato',{exact:true}).waitFor({timeout:15000});
  checks.push('solicitacao nova e mudanca de etapa atualizam admin e visitante automaticamente');
  const idea=await store.transaction(db=>db.ideas.find(i=>i.title===title));
  const interest=await bContext.request.post(base+`/api/ideas/${idea.id}/interest`,{data:{}});assert.equal(interest.status(),201);const legacyId=(await interest.json()).negotiation.id;
  await admin.locator(`[data-deal="negotiations-${legacyId}"]`).waitFor({timeout:15000});await b.goto(base+'/negociacoes.html');
  const legacyRow=admin.getByRole('row').filter({has:admin.locator(`[data-deal="negotiations-${legacyId}"]`)});await legacyRow.getByRole('combobox').selectOption('Em negociação');await legacyRow.getByRole('button',{name:'Atualizar etapa'}).click();
  await b.locator('#negotiationList').getByText('Em negociação',{exact:true}).waitFor({timeout:15000});
  checks.push('negociacao anterior atualiza as partes autorizadas');
  progress('rejeicao e parecer');
  await a.goto(other.base+'/dashboard.html');await admin.getByRole('button',{name:'Ideias recebidas',exact:true}).click();await admin.locator('#adminSearch').fill('');
  const rejectedTitle=`Revisao ao vivo ${ids.visitor}`;
  const submitted=await aContext.request.post(other.base+'/api/ideas',{data:{title:rejectedTitle,category:'Tecnologia',problem:'Problema',solution:'Solucao'}});assert.equal(submitted.status(),201);
  await admin.locator('#ideaRows').getByText(rejectedTitle,{exact:true}).waitFor({timeout:15000});await admin.locator('#adminSearch').fill(rejectedTitle);await admin.locator('#ideaRows').getByRole('button',{name:'Analisar',exact:true}).click();await admin.locator('#reviewReason').fill('Precisamos de mais detalhes da proposta.');await admin.locator('#rejectIdea').click();
  await a.getByRole('row').filter({hasText:rejectedTitle}).getByText('Rejeitada',{exact:true}).waitFor({timeout:15000});
  checks.push('rejeicao e parecer chegam automaticamente ao autor');
  await admin.screenshot({path:path.join(output,'admin-live.png'),fullPage:true});await a.screenshot({path:path.join(output,'visitante-mobile-live.png'),fullPage:true});
  for(const page of [admin,a,b]){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const frames=await page.evaluate(()=>window.__rtEvents);assert.ok(frames.every(e=>Object.keys(e.data).every(k=>k==='topics')));}
  const after=await store.transaction(db=>structuredClone(db));
  for(const key of [...Object.keys(mysql.mappings),'staff','audit','conversations','supportMessages','requests']){
   const primary=key==='sessions'?'tokenHash':key==='staff'?'userId':'id';for(const row of before[key])assert.deepEqual(after[key].find(r=>r[primary]===row[primary]),row);
  }
  assert.deepEqual(jsErrors,[]);originalFiles.forEach((f,i)=>assert.equal(digest(fs.readFileSync(f)),originalHashes[i]));
  fs.writeFileSync(path.join(root,'data/runtime/phase7-test-report.json'),JSON.stringify({status:'passed',database:'renolink_test',transport:'SSE',sessions:3,nodeProcesses:2,browser:'Chrome',mobile:'390x844',desktop:'1440x1000 e 1280x900',checks,persistedInMySQL:true,reconnectedAfterProcessRestart:true,noDuplicateMessages:true,oldRowsPreserved:true,schemaChange:false,credentialsChanged:false,jsErrors,operaNativeTested:false,screenshots:output},null,2));
  console.log(JSON.stringify({status:'passed',checks},null,2));
 }catch(error){
  const diagnostic={stage,network:network.slice(-80),jsErrors,pages:[]};
  for(const p of debugPages)try{diagnostic.pages.push(await p.evaluate(()=>({path:location.pathname,status:document.getElementById('realtimeStatus')?.dataset.state,alert:document.getElementById('messageAlert')?.textContent||document.getElementById('adminAlert')?.textContent,replyLength:document.getElementById('replyText')?.value.length,events:window.__rtEvents?.slice(-6)})));}catch{}
  diagnostic.replyPersisted=await store.read(db=>db.supportMessages.some(m=>m.senderId===ids.admin&&m.text==='Resposta automatica da equipe'));
  fs.writeFileSync(path.join(root,'data/runtime/phase81-sse-failure.json'),JSON.stringify(diagnostic,null,2));throw error;
 }finally{if(browser)await browser.close();await other.close();await new Promise(resolve=>server.close(resolve));await store.close();}
}
main().catch(error=>{const location=String(error.stack||'').split('\n').find(line=>line.includes('phase7.browser.js:'))?.trim();console.error(JSON.stringify({status:'failed',stage,errorType:error.name,location,expected:typeof error.expected==='number'?error.expected:undefined,actual:typeof error.actual==='number'?error.actual:undefined}));process.exitCode=1;});
