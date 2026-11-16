'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const {chromium}=require('playwright');
const mysql=require('../lib/mysql');
const {createServer}=require('../server');
const {seed}=require('./fixtures/phase5');
const root=path.resolve(__dirname,'..');
async function main(){
 assert.equal(process.env.RENOLINK_PHASE8_TEST_APPROVED,'1');const options=mysql.config(process.env,'TEST_MYSQL_');assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');
 const store=mysql.mysqlStore(options),ids=await store.transaction(db=>seed(db));
 const server=createServer(store);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const report={database:'renolink_test',physicalDevicesTested:false,browsers:[],findings:[]},directory=path.join(root,'data/runtime/phase8-mobile');fs.mkdirSync(directory,{recursive:true});
 try{
  for(const engine of ['Chrome','Opera GX']){
   let browser;
   try{browser=await chromium.launch(engine==='Chrome'?{channel:'chrome',headless:true,timeout:20000}:{executablePath:'C:/Users/diego/AppData/Local/Programs/Opera GX/137.0.6036.65/opera.exe',headless:true,timeout:20000});}
   catch{report.browsers.push({engine,status:'launch-failed'});continue;}
   const result={engine,version:browser.version(),status:'passed',pages:[],errors:[]};
   try{
    for(const width of [1366,390]){
     const visitor=await browser.newContext({viewport:{width,height:900},locale:'pt-BR'}),staff=await browser.newContext({viewport:{width,height:900},locale:'pt-BR'});
     const page=await visitor.newPage(),admin=await staff.newPage();for(const p of [page,admin])p.on('pageerror',()=>result.errors.push('browser-page-error'));
     for(const route of ['/','/empresa.html','/explorar.html','/ideia.html?id=1','/login.html','/cadastro.html','/admin-login.html']){
      await page.goto(base+route);await page.waitForTimeout(150);
      const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);result.pages.push({route,width,fits});if(!fits)report.findings.push({engine,route,width,type:'page-overflow'});
     }
     await page.goto(base+'/login.html');await page.locator('input[name=email]').fill(ids.visitorEmail);await page.locator('input[name=password]').fill('SenhaTeste2026!');await page.locator('#loginForm button[type=submit]').click();await page.waitForURL('**/dashboard.html');await page.waitForFunction(()=>document.getElementById('realtimeStatus')?.dataset.state==='online');
     let releaseInitial,enteredInitial;const initialGate=new Promise(r=>releaseInitial=r),initialRead=new Promise(r=>enteredInitial=r);
     await page.route('**/api/team/conversations',async route=>{enteredInitial();await initialGate;await route.continue();});
     await page.goto(base+'/mensagens.html',{waitUntil:'domcontentloaded'});await initialRead;
     assert.equal(await page.locator('#messageForm button').isDisabled(),true);assert.equal(await page.locator('#messageText').isDisabled(),true);
     releaseInitial();await page.waitForFunction(()=>!document.querySelector('#messageForm button').disabled);await page.unroute('**/api/team/conversations');result.initialMessageFormGuarded=true;
     for(const route of ['/dashboard.html','/nova-ideia.html','/mensagens.html','/negociacoes.html']){
      await page.goto(base+route);await page.waitForFunction(()=>document.getElementById('realtimeStatus')?.dataset.state==='online');const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);result.pages.push({route,width,fits});if(!fits)report.findings.push({engine,route,width,type:'page-overflow'});
     }
     await page.goto(base+'/nova-ideia.html');await page.locator('#ideaForm button[type=submit]').click();assert.equal(await page.locator('#titulo').evaluate(el=>el.validity.valueMissing),true);
     await page.route('**/api/ideas',route=>route.fulfill({status:503,contentType:'text/html',body:'<html>Service unavailable</html>'}));
     await page.locator('#titulo').fill('Formulario preservado');await page.locator('#problema').fill('Problema');await page.locator('#solucao').fill('Solucao');await page.locator('#ideaForm button[type=submit]').click();await page.locator('#formAlert').waitFor({state:'visible'});
     result.errorMessage=await page.locator('#formAlert').innerText();assert.equal(await page.locator('#titulo').inputValue(),'Formulario preservado');
     if(/Unexpected token|JSON|Failed to fetch/i.test(result.errorMessage))report.findings.push({engine,width,type:'technical-error-message'});
     await page.unroute('**/api/ideas');
     await admin.goto(base+'/admin-login.html');await admin.locator('#adminEmail').fill(ids.adminEmail);await admin.locator('#adminPassword').fill('SenhaTeste2026!');await admin.locator('#adminLoginForm button').click();await admin.waitForURL('**/admin.html');await admin.locator('.team-metric').first().waitFor();
     for(const section of ['dashboard','ideas','users','conversations','negotiations','audit']){
      if(width<700&&await admin.locator(`[data-section="${section}"]`).isHidden())await admin.locator('#teamMenu').click();
      await admin.locator(`[data-section="${section}"]`).click();await admin.locator('#adminContent[aria-busy="false"]').waitFor();await admin.waitForTimeout(150);
      const fits=await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);result.pages.push({route:'admin:'+section,width,fits});if(!fits){report.findings.push({engine,width,section,type:'page-overflow',elements:await admin.evaluate(()=>[...document.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>innerWidth).slice(0,12).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width,text:el.textContent.slice(0,60)})))});await admin.screenshot({path:path.join(directory,`${engine.replace(/ /g,'-')}-${width}-${section}-overflow.png`),fullPage:true});}
     }
     if(width===1366){
      let release,entered;const gate=new Promise(r=>release=r),intercepted=new Promise(r=>entered=r);
      await admin.route('**/api/admin/users',async route=>{entered();await gate;await route.continue();});
      await admin.locator('[data-section=users]').click();await intercepted;
      await admin.locator('[data-section=ideas]').click();await admin.locator('#ideaRows').waitFor();
      const response=admin.waitForResponse('**/api/admin/users');release();await response;await admin.waitForTimeout(300);
      assert.equal(await admin.locator('#ideaRows').count(),1);assert.equal(await admin.locator('#userRows').count(),0);await admin.unroute('**/api/admin/users');result.staleNavigationResponseIgnored=true;
      await admin.route('**/api/admin/ideas',route=>route.fulfill({status:503,contentType:'text/html',body:'<html>Unavailable</html>'}));
      await admin.locator('#refreshAdmin').click();await admin.locator('#adminAlert').waitFor({state:'visible'});
      assert.doesNotMatch(await admin.locator('#adminAlert').innerText(),/Unexpected token|JSON|Failed to fetch/i);result.adminUnavailableHandled=true;await admin.unroute('**/api/admin/ideas');
     }
     await page.screenshot({path:path.join(directory,`${engine.replace(/ /g,'-')}-${width}-visitor.png`),fullPage:true});await admin.screenshot({path:path.join(directory,`${engine.replace(/ /g,'-')}-${width}-admin.png`),fullPage:true});
     await visitor.close();await staff.close();
    }
    const tablet=await browser.newContext({viewport:{width:850,height:900}});const page=await tablet.newPage();await page.goto(base+'/login.html');await page.locator('input[name=email]').fill(ids.visitorEmail);await page.locator('input[name=password]').fill('SenhaTeste2026!');await page.locator('#loginForm button[type=submit]').click();await page.waitForURL('**/dashboard.html');
    result.tabletNavigationLabelsVisible=await page.locator('.sidebar-menu a span').first().isVisible();
    if(!result.tabletNavigationLabelsVisible)report.findings.push({engine,width:850,type:'tablet-icon-only-navigation-depends-on-external-font'});
    await tablet.close();
    assert.deepEqual(result.errors,[]);
   }catch(error){result.status='failed';result.failureLocation=String(error.stack||'').split('\n').find(l=>l.includes('phase8.mobile.js:'))?.trim();}
   finally{await browser.close();}
   report.browsers.push(result);fs.writeFileSync(path.join(root,'data/runtime/phase8-mobile-report.json'),JSON.stringify(report,null,2));
   console.log(JSON.stringify({engine,status:result.status,pages:result.pages.length,findings:report.findings.filter(f=>f.engine===engine)}));
  }
  assert.equal(report.browsers.length,2);assert.ok(report.browsers.every(b=>b.status==='passed'));assert.deepEqual(report.findings,[]);
 }finally{await new Promise(resolve=>server.close(resolve));await store.close();}
}
main().catch(()=>{console.error('Auditoria mobile isolada interrompida; nenhum segredo exibido.');process.exitCode=1;});
