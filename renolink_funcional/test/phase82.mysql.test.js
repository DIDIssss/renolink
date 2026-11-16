'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events');
const mysql=require('../lib/mysql'),legacy=require('./fixtures/phase82-baseline-mysql'),security=require('../lib/security'),{seed}=require('./fixtures/phase5'),{createServer}=require('../server'),{scope}=require('../lib/realtime');
test('Fase 8.2 MySQL: paridade de leitura, escopos privados, paginação, concorrência e rollback', {skip:process.env.RENOLINK_PHASE82_APPROVED!=='1'},async()=>{
 const options=mysql.config(process.env,'TEST_MYSQL_');assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');let full=0,scoped=0;
 const store=mysql.mysqlStore(options,{observe:stage=>{if(stage==='fullSnapshot')full++;if(stage==='scopedSnapshot')scoped++;}}),old=legacy.mysqlStore(options),servers=[createServer(store),createServer(old)];
 const ids=await store.transaction(db=>{
  const ids=seed(db),now=new Date().toISOString();ids.privateIdea=db.meta.nextIdeaId++;ids.publicIdea=db.meta.nextIdeaId++;
  for(const [id,status]of [[ids.privateIdea,'Em análise'],[ids.publicIdea,'Publicada']])db.ideas.push({id,userId:ids.visitor,title:'Paridade '+id,category:'Tecnologia',problem:'Problema',solution:'Solução',beneficiaries:'',participation:'Ainda não sei',status,potential:'Alto',createdAt:now,updatedAt:now});
  db.negotiations.push({id:db.meta.nextNegotiationId++,ideaId:ids.publicIdea,creatorUserId:ids.visitor,companyUserId:ids.outsider,status:'Interesse demonstrado',createdAt:now,updatedAt:now});
  db.requests.push({id:db.meta.nextRequestId++,ideaId:ids.publicIdea,visitorId:ids.visitor,status:'Solicitada',createdAt:now,updatedAt:now});
  ids.conversation=db.meta.nextConversationId++;db.conversations.push({id:ids.conversation,visitorId:ids.visitor,status:'Aberta',createdAt:now,updatedAt:now});
  db.supportMessages.push({id:db.meta.nextSupportMessageId++,conversationId:ids.conversation,senderId:ids.support,text:'Atendimento sintético',createdAt:now});
  ids.cookies={};for(const role of ['visitor','outsider','admin','support'])ids.cookies[role]=security.issueSession({userId:ids[role]},db).cookie.split(';')[0];return ids;
 });
 for(const s of servers){s.listen(0,'127.0.0.1');await once(s,'listening');}const bases=servers.map(s=>`http://127.0.0.1:${s.address().port}`);
 const request=async(index,path,cookie,data)=>{const r=await fetch(bases[index]+path,{method:data?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return{status:r.status,body:await r.json()};};
 try{
  const routes=['/api/health','/api/features','/api/stats','/api/me','/api/ideas?mine=1','/api/ideas?public=1',`/api/ideas/${ids.privateIdea}`,`/api/ideas/${ids.publicIdea}`,'/api/ideas/99999999999999999999999999999999999999999999999999','/api/negotiations','/api/messages','/api/requests','/api/portal/dashboard','/api/portal/deals','/api/team/conversations',`/api/team/conversations/${ids.conversation}/messages`];
  full=0;scoped=0;
  for(const cookie of [undefined,...Object.values(ids.cookies)])for(const route of routes)assert.deepEqual(await request(0,route,cookie),await request(1,route,cookie),route);
  assert.equal(full,0);assert.ok(scoped>0);
  const all=(await request(1,'/api/ideas?public=1')).body.ideas;assert.deepEqual((await request(0,'/api/ideas?public=1&limit=2&offset=2')).body.ideas,all.slice(2,4));assert.equal((await request(0,'/api/ideas?limit=1000')).status,400);
  const state=await store.read(db=>structuredClone(db));for(const roles of [['visitor'],['visitor','outsider'],['admin'],['support']]){
   const reqs=roles.map(role=>({headers:{cookie:ids.cookies[role]}})),expected=reqs.map(req=>scope(state,req));assert.deepEqual(await store.readRealtime(reqs,db=>reqs.map(req=>scope(db,req))),expected);
  }
  const creations=await Promise.all(Array.from({length:20},(_,i)=>request(i%2,'/api/ideas',ids.cookies.visitor,{title:'Concorrente '+i,category:'Tecnologia',problem:'Problema',solution:'Solução'})));
  assert.ok(creations.every(r=>r.status===201));assert.equal(new Set(creations.map(r=>r.body.idea.id)).size,20);
  const before=await store.read(db=>structuredClone(db)),pool=mysql.pool(options);
  const faultyPool={getConnection:async()=>{const c=await pool.getConnection();return new Proxy(c,{get(target,key){if(key==='execute')return async(sql,args)=>{const result=await target.execute(sql,args);if(sql.startsWith('UPDATE renolink_meta'))throw Error('Falha sintética após SQL');return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});},end:()=>pool.end()};
  const faulty=mysql.mysqlStore(options,{connectionPool:faultyPool}),server=createServer(faulty);server.listen(0,'127.0.0.1');await once(server,'listening');
  try{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/ideas`,{method:'POST',headers:{Cookie:ids.cookies.visitor,'Content-Type':'application/json'},body:JSON.stringify({title:'Rollback específico',category:'Tecnologia',problem:'Problema',solution:'Solução'})});assert.equal(response.status,500);assert.deepEqual(await response.json(),{error:'Erro interno do servidor local.'});mysql.verify(before,await store.read(db=>structuredClone(db)));}
  finally{await new Promise(r=>server.close(r));await faulty.close();}
 }finally{for(const s of servers)await new Promise(r=>s.close(r));await store.close();await old.close();}
});
