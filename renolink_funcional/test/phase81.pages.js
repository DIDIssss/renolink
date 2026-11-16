'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {chromium}=require('playwright');
const mysql=require('../lib/mysql');
const security=require('../lib/security');
const {seed}=require('./fixtures/phase5');
const {createServer}=require('../server');
const {scope}=require('../lib/realtime');
const {stats}=require('./phase8.load');
async function main(){
 assert.equal(process.env.RENOLINK_PHASE81_APPROVED,'1');const options=mysql.config(process.env,'TEST_MYSQL_');assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');
 const store=mysql.mysqlStore(options),ids=await store.transaction(db=>seed(db));
 const server=createServer(store);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;let browser;
 const report={database:'renolink_test',pages:[],scopeBenchmark:{},physicalDevicesTested:false};
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext(),page=await context.newPage();let requests=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/'))requests.push({method:request.method(),route:url.pathname.replace(/\/\d+/g,'/:id')+url.search});});
  const login=await context.request.post(base+'/api/auth/login',{data:{email:ids.visitorEmail,password:'SenhaTeste2026!'}});assert.equal(login.status(),200);
  for(const route of ['dashboard.html','nova-ideia.html','mensagens.html','negociacoes.html','explorar.html']){
   requests=[];await page.goto(base+'/'+route,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('realtimeStatus')?.dataset.state==='online');await page.waitForTimeout(600);
   report.pages.push({route,requests:[...requests],apiRequests:requests.length,eventConnections:requests.filter(r=>r.route==='/api/events').length});
  }
  const admin=await browser.newContext();const response=await admin.request.post(base+'/api/admin/auth/login',{data:{email:ids.adminEmail,password:'SenhaTeste2026!'}});assert.equal(response.status(),200);
  const team=await admin.newPage();let teamRequests=[];team.on('request',r=>{const url=new URL(r.url());if(url.pathname.startsWith('/api/'))teamRequests.push(url.pathname.replace(/\/\d+/g,'/:id'));});
  await team.goto(base+'/admin.html',{waitUntil:'domcontentloaded'});await team.waitForFunction(()=>document.getElementById('realtimeStatus')?.dataset.state==='online');await team.waitForTimeout(600);report.pages.push({route:'admin:initial',apiRequests:teamRequests.length,requests:[...teamRequests]});
  for(const section of ['ideas','users','conversations','negotiations','audit']){teamRequests=[];await team.locator(`[data-section=${section}]`).click();await team.locator('#adminContent[aria-busy=false]').waitFor();await team.waitForTimeout(200);report.pages.push({route:'admin:'+section,apiRequests:teamRequests.length,requests:[...teamRequests]});}
  // Scope CPU is measured separately, with 50 private sessions in memory only.
  const db=await store.read(db=>structuredClone(db)),visitors=db.users.filter(u=>!db.staff.some(s=>s.userId===u.id)).slice(0,50);assert.equal(visitors.length,50);
  const reqs=visitors.map(user=>({headers:{cookie:security.issueSession({userId:user.id},db).cookie.split(';')[0]}}));
  const perScope=[],perBatch=[];for(let i=0;i<10;i++){const batch=performance.now();for(const req of reqs){const start=performance.now();assert.ok(scope(db,req));perScope.push(performance.now()-start);}perBatch.push(performance.now()-batch);}
  report.scopeBenchmark={users:50,repetitions:10,perUserMs:stats(perScope),batch50Ms:stats(perBatch),databaseWrites:false};
  const runId=process.env.PHASE81_RUN_ID||'default';assert.match(runId,/^[a-z0-9-]{1,40}$/);const directory=path.resolve(__dirname,'../data/runtime/'+(runId==='default'?'phase81':'phase81-'+runId));fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'pages.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pages:report.pages.map(p=>({page:p.route,requests:p.apiRequests})),scope:report.scopeBenchmark}));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));await store.close();}
}
main().catch(error=>{console.error(JSON.stringify({status:'interrupted',type:error.name,location:String(error.stack).split('\n').find(l=>l.includes('phase81.pages.js:'))?.trim()}));process.exitCode=1;});
