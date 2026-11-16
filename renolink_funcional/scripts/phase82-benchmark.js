'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),os=require('node:os');
const mysql=require('../lib/mysql'),{stable}=require('../lib/data'),{mappedPool,tables}=require('../test/fixtures/phase81-pool'),{run}=require('../test/phase8.load');
const runId=process.env.PHASE82_RUN_ID||'default';assert.match(runId,/^[a-z0-9-]{1,40}$/);
const directory=path.resolve(__dirname,'../data/runtime/'+(runId==='default'?'phase82':'phase82-'+runId));fs.mkdirSync(directory,{recursive:true});
const file=path.join(directory,'manifest.json'),hash=value=>crypto.createHash('sha256').update(stable(value)).digest('hex');
async function state(options,prefix){const pool=mappedPool(options,prefix);try{return await mysql.transaction(pool,mysql.load);}finally{await pool.end();}}
function shape(db,meta,raw=false){
 const value=structuredClone(db);const counters={users:'nextUserId',ideas:'nextIdeaId',conversations:'nextConversationId',supportMessages:'nextSupportMessageId'};
 // New IDs are allocated in completion order, which legitimately changes with
 // concurrency. Canonicalize only the new synthetic cohort by its VU identity.
 // Existing records/IDs are never rewritten, including in this in-memory view.
 const userMap=new Map();
 for(const user of value.users.filter(u=>u.id>=meta.nextUserId)){const offset=user.id-meta.nextUserId,local=offset%85,cohort=Math.floor(offset/85)*85+(local<10?0:local<35?10:35),match=/^Visitante carga (\d+)$/.exec(user.name);assert.ok(match);userMap.set(user.id,meta.nextUserId+cohort+Number(match[1]));}
 assert.equal(new Set(userMap.values()).size,userMap.size);
 const ideaMap=new Map(value.ideas.filter(i=>i.id>=meta.nextIdeaId).map(i=>[i.id,meta.nextIdeaId+userMap.get(i.userId)-meta.nextUserId]));
 const conversationMap=new Map(value.conversations.filter(c=>c.id>=meta.nextConversationId).map(c=>[c.id,meta.nextConversationId+userMap.get(c.visitorId)-meta.nextUserId]));
 for(const user of value.users)if(userMap.has(user.id))user.id=userMap.get(user.id);
 for(const idea of value.ideas)if(ideaMap.has(idea.id)){idea.id=ideaMap.get(idea.id);idea.userId=userMap.get(idea.userId);}
 for(const c of value.conversations)if(conversationMap.has(c.id)){c.id=conversationMap.get(c.id);c.visitorId=userMap.get(c.visitorId);}
 for(const m of value.supportMessages)if(m.id>=meta.nextSupportMessageId){m.id=meta.nextSupportMessageId+userMap.get(m.senderId)-meta.nextUserId;m.senderId=userMap.get(m.senderId);m.conversationId=conversationMap.get(m.conversationId);}
 for(const session of value.sessions)if(userMap.has(session.userId))session.userId=userMap.get(session.userId);
 for(const [key,counter]of Object.entries(counters))for(const row of value[key].filter(r=>r.id>=meta[counter])){
  for(const field of ['createdAt','updatedAt'])if(field in row)row[field]='GENERATED';
  if(key==='users'){row.email=row.email.replace(/^load-[a-f0-9]+-/,'load-BATCH-');row.salt='GENERATED';row.passwordHash=row.passwordHash.split('$').slice(0,4).join('$');}
  if(key==='ideas')row.title=row.title.replace(/^Carga [a-f0-9]+ /,'Carga BATCH ');
 }
 const sessions=value.sessions.filter(s=>s.userId>=meta.nextUserId).sort((a,b)=>a.userId-b.userId||a.createdAt.localeCompare(b.createdAt));let last,ordinal=0;
 for(const s of sessions){if(last!==s.userId){last=s.userId;ordinal=0;}s.tokenHash=`GENERATED-${s.userId}-${ordinal++}`;for(const key of ['createdAt','expiresAt'])s[key]='GENERATED';}
 for(const key of Object.keys(value).filter(k=>Array.isArray(value[k]))){const primary=key==='sessions'?'tokenHash':key==='staff'?'userId':'id';value[key].sort((a,b)=>String(a[primary]).localeCompare(String(b[primary])));}
 return raw?value:hash(value);
}
function atProgress(final,manifest,progress){
 const db=structuredClone(final),counters={users:'nextUserId',ideas:'nextIdeaId',conversations:'nextConversationId',supportMessages:'nextSupportMessageId'};
 for(const [key,counter]of Object.entries(counters))db[key]=db[key].filter(row=>row.id<manifest.meta[counter]+progress);
 db.sessions=db.sessions.filter(row=>row.userId<manifest.meta.nextUserId+progress);db.meta=structuredClone(manifest.meta);for(const counter of Object.values(counters))db.meta[counter]+=progress;
 require('../lib/data').validate(db);return db;
}
async function emptyGroups(pool){
 const [rows]=await pool.query("SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME REGEXP '^b81_[a-f0-9]{8}_seed_'");const groups=[...new Set(rows.map(r=>r.name.match(/^b81_[a-f0-9]{8}_seed_/)[0]))],empty=[];
 for(const prefix of groups){if(!tables.every(t=>rows.some(r=>r.name===prefix+t)))continue;let valid=true;for(const table of tables){const [[r]]=await pool.query('SELECT COUNT(*) AS n FROM `'+prefix+table+'`');if(Number(r.n)){valid=false;break;}}if(valid)empty.push(prefix);}return empty.sort();
}
async function copyIntoEmpty(pool,prefix){
 await mysql.withLock(pool,async()=>{const client=await pool.getConnection();try{
  const normalize=sql=>sql.replace(new RegExp(prefix,'g'),'renolink_').replace(/ CHARACTER SET utf8mb4(?= COLLATE utf8mb4_0900_bin)/g,'').replace(/CONSTRAINT `[^`]+`/g,'CONSTRAINT `NAME`').replace(/\bKEY `[^`]+`/g,'KEY `NAME`');
  for(const table of tables){const [[count]]=await client.query('SELECT COUNT(*) AS n FROM `'+prefix+table+'`');assert.equal(Number(count.n),0);const [[a]]=await client.query('SHOW CREATE TABLE `renolink_'+table+'`'),[[b]]=await client.query('SHOW CREATE TABLE `'+prefix+table+'`');if(normalize(b['Create Table'])!==normalize(a['Create Table']))fs.writeFileSync(path.join(directory,'schema-diff.json'),JSON.stringify({table,source:normalize(a['Create Table']),destination:normalize(b['Create Table'])},null,2));assert.equal(normalize(b['Create Table']),normalize(a['Create Table']),'Estrutura divergente: nenhuma alteracao autorizada.');}
  await client.beginTransaction();try{for(const table of tables){const [fields]=await client.execute("SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND GENERATION_EXPRESSION='' ORDER BY ORDINAL_POSITION",['renolink_'+table]);const columns=fields.map(f=>{assert.match(f.name,/^[a-z_][a-z_0-9]*$/);return '`'+f.name+'`';}).join(',');await client.query('INSERT INTO `'+prefix+table+'` ('+columns+') SELECT '+columns+' FROM `renolink_'+table+'`');}await client.commit();}catch(e){await client.rollback();throw e;}
 }finally{client.release();}});
}
async function main(){
 assert.equal(process.env.RENOLINK_PHASE82_APPROVED,'1');const options=mysql.config(process.env,'TEST_MYSQL_');assert.equal(options.host,'127.0.0.1');assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');const resume=process.argv[2]==='resume',mode=resume?'after':process.argv[2],pool=mysql.pool(options);
 try{
  if(mode==='explain'){
   const [[user]]=await pool.query('SELECT id,email_normalized FROM renolink_users LIMIT 1'),[[owner]]=await pool.query('SELECT user_id FROM renolink_ideas WHERE user_id IS NOT NULL ORDER BY id LIMIT 1'),[[session]]=await pool.query('SELECT token_hash FROM renolink_sessions LIMIT 1'),[[conv]]=await pool.query('SELECT id,visitor_id FROM renolink_conversations LIMIT 1'),[[neg]]=await pool.query('SELECT creator_user_id FROM renolink_negotiations LIMIT 1');
   const queries=[['SELECT * FROM renolink_sessions WHERE token_hash=?',[session.token_hash]],['SELECT id,password_hash,salt FROM renolink_users WHERE email_normalized=?',[user.email_normalized]],['SELECT * FROM renolink_ideas WHERE user_id=? ORDER BY updated_at DESC,id ASC LIMIT 20',[owner.user_id]],['SELECT * FROM renolink_conversations WHERE visitor_id=?',[conv.visitor_id]],['SELECT * FROM renolink_support_messages WHERE conversation_id=? ORDER BY id',[conv.id]],['SELECT * FROM renolink_negotiations WHERE creator_user_id=?',[neg.creator_user_id]]];const results=[];for(const [sql,args]of queries){const [plan]=await pool.execute('EXPLAIN '+sql,args);let analyze;if(!/token_hash|email_normalized/.test(sql)){const [rows]=await pool.execute('EXPLAIN ANALYZE '+sql,args);analyze=rows.map(row=>row.EXPLAIN);}results.push({sql,plan,analyze});}fs.writeFileSync(path.join(directory,'explain.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));return;
  }
  if(mode==='hash'){
   const results=[];for(const workers of [4,8]){const env={...process.env,UV_THREADPOOL_SIZE:String(workers)};for(const key of Object.keys(env))if(/^(TEST_)?MYSQL_/.test(key))delete env[key];
    const result=await new Promise((resolve,reject)=>{let result;const child=require('node:child_process').fork(path.resolve(__dirname,'../test/fixtures/phase82-hash.js'),[],{env,execArgv:[],stdio:['ignore','ignore','ignore','ipc']});child.once('message',value=>{result=value;});child.once('exit',code=>code===0&&result?resolve(result):reject(Error('Hash diagnostic failed')));child.once('error',reject);});assert.equal(result.compatible,true);results.push(result);
   }fs.writeFileSync(path.join(directory,'hash.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));return;
  }
  if(mode==='inspect'){console.log(JSON.stringify({emptyGroups:await emptyGroups(pool),schemaWrites:false}));return;}
  if(mode==='prepare'){
   assert.equal(fs.existsSync(file),false);
   const reuse=process.env.PHASE82_REUSE_FROM;
   if(reuse){assert.match(reuse,/^[a-z0-9-]{1,40}$/);assert.notEqual(reuse,runId);const source=path.resolve(directory,'..',reuse==='default'?'phase82':'phase82-'+reuse),previous=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));assert.equal(JSON.parse(fs.readFileSync(path.join(source,'integrity.json'))).status,'passed');const a=await state(options,previous.before),b=await state(options,previous.after),origin=previous.originMeta||previous.meta;assert.equal(shape(a,origin),shape(b,origin));const next={...previous,createdAt:new Date().toISOString(),meta:a.meta,originMeta:origin,counts:mysql.verify(a,a),initialHash:hash(a),reuseFrom:reuse};fs.writeFileSync(file,JSON.stringify(next,null,2));console.log(JSON.stringify({status:'prepared-existing-pair-no-writes',counts:next.counts}));return;}
   const groups=await emptyGroups(pool);assert.ok(groups.length>=2,'Sem duas estruturas vazias: plano e autorizacao de schema necessarios.');const before=await mysql.transaction(pool,mysql.load);
   for(const prefix of groups.slice(0,2)){await copyIntoEmpty(pool,prefix);mysql.verify(before,await state(options,prefix));}
   const [[configuration]]=await pool.query('SELECT @@version AS version, @@max_connections AS maxConnections, @@innodb_buffer_pool_size AS bufferPoolBytes, @@innodb_flush_log_at_trx_commit AS flushAtCommit, @@sync_binlog AS syncBinlog');
   const manifest={createdAt:new Date().toISOString(),before:groups[0],after:groups[1],initialHash:hash(before),meta:before.meta,counts:mysql.verify(before,before),configuration,node:process.version,workers:process.env.UV_THREADPOOL_SIZE||'default(4)',windowMs:60000,host:{cpus:os.cpus().length,model:os.cpus()[0].model,memoryGiB:os.totalmem()/1073741824},baselineHash:crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../test/fixtures/phase82-baseline-mysql.js'))).digest('hex')};fs.writeFileSync(file,JSON.stringify(manifest,null,2));console.log(JSON.stringify({status:'prepared-without-DDL',counts:manifest.counts}));return;
  }
  const manifest=JSON.parse(fs.readFileSync(file));assert.equal(process.version,manifest.node);assert.equal(process.env.UV_THREADPOOL_SIZE||'default(4)',manifest.workers);assert.equal(os.cpus().length,manifest.host.cpus);assert.equal(os.cpus()[0].model,manifest.host.model);const [[config]]=await pool.query('SELECT @@version AS version, @@max_connections AS maxConnections, @@innodb_buffer_pool_size AS bufferPoolBytes, @@innodb_flush_log_at_trx_commit AS flushAtCommit, @@sync_binlog AS syncBinlog');assert.deepEqual(config,manifest.configuration);
  if(mode==='verify'){
   const results=['before','after'].map(mode=>JSON.parse(fs.readFileSync(path.join(directory,mode+'.json'))));assert.equal(results[0].cases.length,3);assert.equal(results[1].cases.length,3);
   for(const report of results)for(const c of report.cases){assert.equal(c.errors,0);assert.equal(c.counts.completeUsers,c.virtualUsers);assert.equal(c.verifiedFlows,c.virtualUsers);assert.equal(c.oldRowsPreserved,true);assert.equal(c.sse.ready,c.virtualUsers);assert.equal(c.sse.failures,0);assert.equal(c.sse.duplicateFrames,0);}
   const final=await state(options,manifest.before);let progress=0;const equivalence=[];
   for(let i=0;i<3;i++){const expected=shape(atProgress(final,manifest,progress),manifest.originMeta||manifest.meta);if(i>0||results[1].cases[i].equivalenceVersion>=3)assert.equal(expected,results[1].cases[i].initialShapeHash);equivalence.push({n:results[0].cases[i].virtualUsers,initialShapeV3:expected});progress+=results[0].cases[i].virtualUsers;}
   const a=await state(options,manifest.before),b=await state(options,manifest.after);assert.equal(shape(a,manifest.originMeta||manifest.meta),shape(b,manifest.originMeta||manifest.meta));
   for(const db of [a,b]){assert.equal(db.users.length-manifest.counts.users,85);assert.equal(db.ideas.length-manifest.counts.ideas,85);assert.equal(db.supportMessages.length-manifest.counts.supportMessages,85);for(const u of db.users.filter(u=>u.id>=manifest.meta.nextUserId)){assert.equal(db.ideas.filter(i=>i.userId===u.id).length,1);const c=db.conversations.find(c=>c.visitorId===u.id);assert.ok(c);assert.equal(db.supportMessages.filter(m=>m.conversationId===c.id&&m.senderId===u.id).length,1);assert.equal(db.sessions.filter(s=>s.userId===u.id).length,2);}}
   fs.writeFileSync(path.join(directory,'integrity.json'),JSON.stringify({status:'passed',equivalenceVersion:3,equivalence,allInitialShapesEquivalent:true,relationshipsVerified:true,counts:mysql.verify(a,a)},null,2));const files=['lib/mysql.js','lib/mysql-scopes.js','lib/security.js','lib/realtime.js','server.js','test/fixtures/phase82-baseline-mysql.js','test/fixtures/phase82-server.js','test/phase8.load.js'];fs.writeFileSync(path.join(directory,'implementation.json'),JSON.stringify(Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',file))).digest('hex')])),null,2));console.log('Integridade, SSE e equivalencia aprovados.');return;
  }
  assert.ok(['before','after'].includes(mode));const output=path.join(directory,mode+'.json');let report={mode,cases:[]};
  if(resume){assert.equal(mode,'after');const backup=path.join(directory,'after-interrupted.json');if(!fs.existsSync(backup))fs.copyFileSync(output,backup,fs.constants.COPYFILE_EXCL);report=JSON.parse(fs.readFileSync(output));assert.deepEqual(report.cases.map(c=>c.virtualUsers),[10]);assert.equal(report.cases[0].errors,0);assert.equal(report.cases[0].oldRowsPreserved,true);}else assert.equal(fs.existsSync(output),false,'Resultado existente: nao sobrescrever.');
  const referenceFinal=mode==='after'?await state(options,manifest.before):null;
  for(const count of [10,25,50]){if(report.cases.some(c=>c.virtualUsers===count))continue;const progress=report.cases.reduce((n,c)=>n+c.virtualUsers,0),initial=await state(options,manifest[mode]),initialShapeHash=shape(initial,manifest.originMeta||manifest.meta);if(mode==='before'&&count===10)assert.equal(hash(initial),manifest.initialHash);
   if(mode==='after'){
    const expected=atProgress(referenceFinal,manifest,progress),expectedHash=shape(expected,manifest.originMeta||manifest.meta);
    if(initialShapeHash!==expectedHash){const a=shape(initial,manifest.meta,true),b=shape(expected,manifest.meta,true),diff=[];function compare(x,y,p){if(stable(x)===stable(y))return;if(x&&y&&typeof x==='object'&&typeof y==='object'){for(const key of new Set([...Object.keys(x),...Object.keys(y)])){if(diff.length<30)compare(x[key],y[key],p+'.'+key);}}else diff.push({path:p,typeA:typeof x,typeB:typeof y,...(/meta\./.test(p)?{a:x,b:y}:{})});}compare(a,b,'db');fs.writeFileSync(path.join(directory,'equivalence-diff.json'),JSON.stringify(diff,null,2));}
    assert.equal(initialShapeHash,expectedHash,'Dados iniciais nao equivalentes.');
   }
   console.log(`Fase 8.2 ${mode}: ${count} visitantes, janela 60 s`);
   const result=await run(count,options,{poolFactory:()=>mappedPool(options,manifest[mode]),childFile:path.resolve(__dirname,'../test/fixtures/phase82-server.js'),childEnv:{...process.env,PHASE82_PREFIX:manifest[mode],PHASE82_VARIANT:mode},minimumDurationMs:60000,includeNegotiations:true});result.initialShapeHash=initialShapeHash;result.equivalenceVersion=3;result.activeRps=result.requests/(result.operationsCompletedMs/1000);result.windowRps=result.requests/60;report.cases.push(result);fs.writeFileSync(output,JSON.stringify(report,null,2));
   assert.equal(result.errors,0);assert.equal(result.counts.completeUsers,count);assert.equal(result.verifiedFlows,count);assert.equal(result.oldRowsPreserved,true);assert.equal(result.sse.ready,count);assert.equal(result.sse.duplicateFrames,0);assert.equal(result.sse.failures,0);assert.ok(result.operationsCompletedMs+3000<60000);
   console.log(JSON.stringify({n:count,p95:result.http.p95Ms,errors:result.errors,rss:result.resources.peakRssMiB}));
  }
 }finally{await pool.end();}
}
main().catch(e=>{console.error(JSON.stringify({status:'interrupted',type:e.name,code:e.code,errno:e.errno,location:String(e.stack).split('\n').find(s=>s.includes('phase82-benchmark.js:'))?.trim()}));process.exitCode=1;});
