'use strict';
const crypto=require('node:crypto');
const security=require('./security');
const {stable}=require('./data');
const {member}=require('./phase5');
const hash=rows=>security.digest(stable(rows));
const sorted=rows=>[...rows].sort((a,b)=>(a.id||a.userId)-(b.id||b.userId));
function scope(db,req){
 const current=security.auth(req,db);if(!current)return null;
 const id=current.user.id,staff=member(db,id),role=staff?.accessRole||'visitor';
 const conversations=(db.conversations||[]).filter(c=>staff||c.visitorId===id);
 const conversationIds=new Set(conversations.map(c=>c.id));
 const topics={
  ideas:hash(sorted(db.ideas.filter(i=>role==='admin'||i.userId===id||['Publicada','Empresa interessada'].includes(i.status)).map(i=>{
   if(role==='admin'||i.userId===id)return i;
   const {moderation,...publicIdea}=i;return publicIdea;
  }))),
  messages:hash({conversations:sorted(conversations),support:sorted((db.supportMessages||[]).filter(m=>conversationIds.has(m.conversationId))),legacy:sorted(db.messages.filter(m=>m.fromUserId===id||m.toUserId===id))}),
  deals:hash({requests:sorted((db.requests||[]).filter(r=>role==='admin'||r.visitorId===id)),legacy:sorted(db.negotiations.filter(n=>role==='admin'||n.creatorUserId===id||n.companyUserId===id))})
 };
 if(role==='support')delete topics.ideas;
 if(role==='support')delete topics.deals;
 if(role==='admin'){
  topics.users=hash(sorted(db.users.map(security.publicUser)));
  topics.audit=hash(sorted(db.audit||[]));
 }
 return{key:`${id}:${role}`,userId:id,role,topics};
}
function createRealtime(store,{pollIntervalMs=1000,heartbeatMs=15000,historyLimit=100,retentionMs=300000,maxConnections=100,maxPerUser=3,observe=()=>{}}={}){
 const read=(fn,requests)=>store.readRealtime?store.readRealtime(requests,fn):store.read?store.read(fn):store.transaction(fn);
 const clients=new Set(),records=new Map();let timer=null,heartbeat=null,busy=false,closed=false,wakeTimer=null;
 function prune(){
  const active=new Set([...clients].map(c=>c.key));
  for(const [key,record]of records)if(!active.has(key)&&Date.now()-record.used>retentionMs)records.delete(key);
  if(records.size>256)for(const [key]of records){if(!active.has(key))records.delete(key);if(records.size<=256)break;}
 }
 function write(client,type,data,id){
  if(client.res.destroyed||client.res.writableEnded)return false;
  const frame=(id?`id: ${id}\n`:'')+`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  try{if(!client.res.write(frame)){client.res.end();return false;}return true;}catch{client.res.destroy();return false;}
 }
 function stopIdle(){if(clients.size)return;if(timer)clearInterval(timer);if(heartbeat)clearInterval(heartbeat);if(wakeTimer)clearTimeout(wakeTimer);timer=null;heartbeat=null;wakeTimer=null;}
 function remove(client){clients.delete(client);stopIdle();}
 function recordFor(view){
  let record=records.get(view.key);
  if(!record){record={prefix:crypto.randomBytes(8).toString('hex'),seq:0,hashes:view.topics,history:[],used:Date.now()};records.set(view.key,record);append(record,Object.keys(view.topics));}
  else{
   const topics=Object.keys(view.topics).filter(k=>record.hashes[k]!==view.topics[k]);
   record.hashes=view.topics;if(topics.length)append(record,topics);
  }
  record.used=Date.now();return record;
 }
 function append(record,topics){record.seq++;record.latest=`${record.prefix}:${record.seq}`;record.history.push({id:record.latest,topics});if(record.history.length>historyLimit)record.history.shift();}
 function deliver(client,record){
  const index=record.history.findIndex(e=>e.id===client.last);
  if(index<0){write(client,'reset',{topics:Object.keys(record.hashes)},record.latest);client.last=record.latest;return;}
  for(const event of record.history.slice(index+1)){if(!write(client,'changes',{topics:event.topics},event.id))break;client.last=event.id;}
 }
 async function scan(){
  if(busy||closed||!clients.size)return;busy=true;const started=performance.now();
  try{
   const batch=[...clients];
   const views=await read(db=>{
    const cache=new Map();
    return batch.map(client=>{
     const current=security.auth(client.req,db);
     if(!current)return{client,view:null};
     const key=current.user.id+':'+(member(db,current.user.id)?.accessRole||'visitor');
     if(!cache.has(key))cache.set(key,scope(db,client.req));
     return{client,view:cache.get(key)};
    });
   },batch.map(client=>client.req));
   for(const {client,view}of views){
    if(!clients.has(client))continue;
    if(!view){write(client,'session-expired',{});client.res.end();continue;}
    if(view.key!==client.key){write(client,'access-changed',{});client.res.end();continue;}
    deliver(client,recordFor(view));
   }
   prune();
  }catch{for(const client of clients)client.res.end();}
  finally{busy=false;observe('sseScan',performance.now()-started);}
 }
 function start(){
  if(!timer){timer=setInterval(()=>{void scan();},pollIntervalMs);timer.unref();}
  if(!heartbeat){heartbeat=setInterval(()=>{for(const client of clients){try{if(client.res.destroyed||client.res.writableEnded){remove(client);continue;}if(!client.res.write(': keepalive\n\n'))client.res.end();}catch{client.res.destroy();}}},heartbeatMs);heartbeat.unref();}
 }
 async function attach(req,res){
  security.sameOrigin(req);
  const cursor=req.headers['last-event-id'];
  if(cursor!==undefined&&(typeof cursor!=='string'||! /^[a-f0-9]{16}:\d{1,12}$/.test(cursor)))throw security.fail(400,'Cursor de atualizações inválido.');
  const view=await read(db=>scope(db,req),[req]);
  if(!view)throw security.fail(401,'Faça login para receber atualizações.');
  if(closed)throw security.fail(503,'Atualizações temporariamente indisponíveis.');
  if(clients.size>=maxConnections||[...clients].filter(c=>c.userId===view.userId).length>=maxPerUser)throw security.fail(429,'Limite de conexões de atualização atingido.');
  prune();const record=recordFor(view);
  req.setTimeout(0);res.setTimeout(0);
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write('retry: 2000\n\n');
  const client={req,res,key:view.key,userId:view.userId,last:cursor||record.latest};
  clients.add(client);res.once('close',()=>remove(client));
  res.once('error',()=>{remove(client);res.destroy();});
  if(cursor){deliver(client,record);write(client,'ready',{topics:[]});}
  else write(client,'ready',{topics:Object.keys(view.topics)},record.latest);
  start();
 }
 function wake(){if(!clients.size||wakeTimer||closed)return;wakeTimer=setTimeout(()=>{wakeTimer=null;void scan();},20);wakeTimer.unref();}
 function disconnectAll(){for(const client of [...clients])client.res.end();}
 function close(){closed=true;disconnectAll();if(timer)clearInterval(timer);if(heartbeat)clearInterval(heartbeat);if(wakeTimer)clearTimeout(wakeTimer);records.clear();}
 return{attach,wake,close,disconnectAll,scan,connectionCount:()=>clients.size};
}
module.exports={createRealtime,scope};
