'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const {chromium}=require('playwright');
const mysql=require('../lib/mysql');
const security=require('../lib/security');
const {createServer}=require('../server');
const {listCandidates,grantAdministrator}=require('../lib/staff-provision');
test('Fase 6: concessao local confirmada, recusas, auditoria atomica e painel no MySQL isolado',{skip:process.env.RENOLINK_PHASE6_TEST_APPROVED!=='1'},async t=>{
 const options=mysql.config(process.env,'TEST_MYSQL_');
 assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');
 const files=['data/db.json','data/runtime/db.json'].map(f=>path.join(__dirname,'..',f));
 const hashes=files.map(f=>security.digest(fs.readFileSync(f)));
 const password=crypto.randomBytes(32).toString('base64url');
 const credentials=await security.passwordHash(password);
 const suffix=crypto.randomBytes(8).toString('hex');
 const pool=mysql.pool(options);
 let user;
 try{
  await mysql.transaction(pool,async client=>{
   const db=await mysql.load(client);assert.equal(db.meta.schemaVersion,5);
   user={id:db.meta.nextUserId++,name:'Pessoa de teste Fase 6',email:`phase6-${suffix}@teste.invalid`,role:'creator',company:'',...credentials,createdAt:new Date().toISOString()};
   await client.execute('INSERT INTO renolink_users(id,name,email,role,company,salt,password_hash,created_at,extra) VALUES (?,?,?,?,?,?,?,?,?)',[user.id,user.name,user.email,user.role,user.company,user.salt,user.passwordHash,new Date(user.createdAt),'{}']);
   await client.execute('UPDATE renolink_meta SET payload=? WHERE id=1',[JSON.stringify(db.meta)]);
  });
  const baseline=await mysql.transaction(pool,mysql.load);
  await assert.rejects(listCandidates({options}),/recusada/,'Conta de teste exige autorizacao explicita.');
  await assert.rejects(listCandidates({options:{...options,database:'renolink_dev'},testApproved:true}),/recusada/);
  await assert.rejects(listCandidates({options:{...options,database:'renolink_dev',user:'renolink_migrator'},testApproved:true}),/recusada/);
  await assert.rejects(listCandidates({options:{...options,user:'renolink_app'},testApproved:true}),/recusada/);
  await assert.rejects(listCandidates({options:{...options,host:'example.invalid'},testApproved:true}),/recusada/);
  const list=await listCandidates({options,testApproved:true});
  const selected=list.users.find(u=>u.id===user.id);assert.ok(selected);
  assert.equal('passwordHash' in selected,false);assert.equal('salt' in selected,false);
  const confirmation={userId:user.id,name:user.name,email:user.email,fingerprint:selected.fingerprint,phrase:`CONCEDER ADMIN ${user.id} EM renolink_test`};
  for(const attempt of [
   {approved:false,confirmation},
   {approved:true,confirmation:{...confirmation,email:'outra-pessoa@teste.invalid'}},
   {approved:true,confirmation:{...confirmation,name:'Outra pessoa'}},
   {approved:true,confirmation:{...confirmation,phrase:'SIM'}},
   {approved:true,confirmation:{...confirmation,phrase:`CONCEDER ADMIN ${user.id} EM renolink_dev`}},
   {approved:true,confirmation:{...confirmation,fingerprint:'0'.repeat(64)}},
   {approved:true,confirmation:{...confirmation,userId:Number.MAX_SAFE_INTEGER}}
  ]){
   await assert.rejects(grantAdministrator({options,testApproved:true,...attempt}),/recusada/);
   mysql.verify(baseline,await mysql.transaction(pool,mysql.load));
  }
  const receipt=await grantAdministrator({options,testApproved:true,approved:true,confirmation});
  const granted=await mysql.transaction(pool,mysql.load);
  assert.equal(granted.staff.find(s=>s.userId===user.id).accessRole,'admin');
  const event=granted.audit.find(e=>e.id===receipt.auditId);
  assert.equal(event.action,'staff.provision');assert.equal(event.targetId,user.id);assert.equal(event.initiator,'local-operator');assert.equal(event.databaseAccount,'renolink_tester@127.0.0.1');
  for(const key of Object.keys(mysql.mappings))assert.deepEqual(granted[key],baseline[key],'Colecoes historicas preservadas na concessao.');
  assert.deepEqual(granted.audit.slice(0,-1),baseline.audit);
  assert.deepEqual(granted.staff.slice(0,-1),baseline.staff);
  const expectedMeta={...baseline.meta,nextAuditId:baseline.meta.nextAuditId+1};assert.deepEqual(granted.meta,expectedMeta);
  await assert.rejects(grantAdministrator({options,testApproved:true,approved:true,confirmation}),/recusada/);
  mysql.verify(granted,await mysql.transaction(pool,mysql.load));
  const store=mysql.mysqlStore(options),server=createServer(store);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  let browser;
  try{
   const base=`http://127.0.0.1:${server.address().port}`;
   const denied=await fetch(base+'/api/admin/dashboard');assert.equal(denied.status,401);
   const escalation=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Tentativa proibida',email:`bad-${suffix}@teste.invalid`,password:crypto.randomBytes(24).toString('hex'),role:'admin'})});assert.equal(escalation.status,400);
   const publicCookie=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password})});assert.equal(publicCookie.status,200);
   const unrelatedUser=baseline.users.find(u=>!granted.staff.some(s=>s.userId===u.id));
   // A fabricated browser cookie grants nothing, even with a forged admin label.
   const forged=await fetch(base+'/api/admin/users',{headers:{Cookie:'renolink_session='+crypto.randomBytes(32).toString('hex'),'X-Role':'admin','X-User-Id':String(unrelatedUser?.id||1)}});assert.equal(forged.status,401);
   browser=await chromium.launch({channel:'chrome',headless:true});
   const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
   await page.addInitScript(()=>localStorage.setItem('renolinkSession',JSON.stringify({user:{id:1,role:'admin',teamRole:'admin'}})));
   await page.goto(base+'/admin.html');assert.ok(page.url().endsWith('/admin-login.html'));
   await page.locator('#adminEmail').fill(user.email);await page.locator('#adminPassword').fill(password);
   await page.getByRole('button',{name:'Entrar no painel'}).click();await page.waitForURL('**/admin.html');await page.locator('.team-metric').first().waitFor();
   await page.getByRole('button',{name:'Visitantes',exact:true}).click();await page.locator('#userSearch').fill(user.email);await page.locator('#userRows').getByText(user.email,{exact:true}).waitFor();
   await page.getByRole('button',{name:'Histórico de ações',exact:true}).click();await page.locator('#adminContent').getByText('staff.provision',{exact:true}).first().waitFor();
  }catch{throw Error('Validacao de painel/permissoes falhou; entradas sensiveis nao registradas.');}
  finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await store.close();}
  fs.writeFileSync(path.join(__dirname,'../data/runtime/phase6-test-report.json'),JSON.stringify({status:'passed',database:'renolink_test',testUserId:user.id,auditId:receipt.auditId,rejectedAttempts:7,wrongDatabaseAndAccountBlocked:true,historicalCollectionsPreservedOnGrant:true,repeatRejectedWithoutExtraAudit:true,browserTamperingBlocked:true,adminPanelVerified:true,realGrantExecuted:false},null,2));
 }finally{await pool.end();files.forEach((f,i)=>assert.equal(security.digest(fs.readFileSync(f)),hashes[i]));}
});
