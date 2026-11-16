'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {fixture}=require('./fixtures/mysql');
const {initialize}=require('../lib/phase5-data');
const {validate}=require('../lib/data');
const security=require('../lib/security');
const {createServer}=require('../server');
test('Resumo do portal preserva filtros e autorizacao dos endpoints individuais',async t=>{
 const db=initialize(fixture());db.ideas.push({...db.ideas[1],id:db.meta.nextIdeaId++,userId:3,title:'Privada do outro visitante'});
 db.requests.push({id:db.meta.nextRequestId++,ideaId:1,visitorId:3,status:'Solicitada',createdAt:db.users[0].createdAt,updatedAt:db.users[0].createdAt});
 const cookies=[1,2,3].map(userId=>security.issueSession({userId},db).cookie.split(';')[0]);validate(db);
 const store={transaction:async fn=>fn(structuredClone(db)),read:async fn=>fn(structuredClone(db))};
 const server=createServer(store);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const get=async(route,cookie)=>{const response=await fetch(base+route,{headers:cookie?{Cookie:cookie}:{}});return{status:response.status,body:await response.json()};};
 for(const route of ['/api/portal/dashboard','/api/portal/deals'])assert.equal((await get(route)).status,401);
 for(let i=0;i<cookies.length;i++){
  const cookie=cookies[i],summary=await get('/api/portal/dashboard?userId=1&role=admin',cookie);assert.equal(summary.status,200);
  assert.deepEqual(summary.body.ideas,(await get(i===1?'/api/ideas?public=1':'/api/ideas?mine=1',cookie)).body.ideas);
  assert.deepEqual(summary.body.negotiations,(await get('/api/negotiations',cookie)).body.negotiations);
  const deals=await get('/api/portal/deals',cookie);assert.equal(deals.status,200);
  assert.deepEqual(deals.body.requests,(await get('/api/requests',cookie)).body.requests);
  assert.deepEqual(deals.body.negotiations,summary.body.negotiations);assert.equal(deals.body.features.phase5,true);
  assert.equal(JSON.stringify(summary.body).includes('passwordHash'),false);assert.equal(JSON.stringify(summary.body).includes('tokenHash'),false);
 }
});
