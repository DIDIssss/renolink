'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const mysql=require('../lib/mysql');
const {stable}=require('../lib/data');
const {mappedPool,tables}=require('../test/fixtures/phase81-pool');
const {run,stats}=require('../test/phase8.load');
const runId=process.env.PHASE81_RUN_ID||'default';assert.match(runId,/^[a-z0-9-]{1,40}$/);
const output=path.resolve(__dirname,'../data/runtime/'+(runId==='default'?'phase81':'phase81-'+runId));fs.mkdirSync(output,{recursive:true});
const manifestFile=path.join(output,'manifest.json');
async function clone(pool,sourcePrefix,destination){
 assert.match(destination,/^b81_[a-f0-9]{8}_(seed|[abcd](10|25|50))_$/);
 const client=await pool.getConnection();
 try{
  for(const table of tables){
   const source=sourcePrefix+table,name=destination+table;
   const [existing]=await client.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[name]);assert.equal(existing.length,0,'Tabela de ensaio existente: nao sobrescrever.');
   const [[row]]=await client.query('SHOW CREATE TABLE `'+source+'`');
   let ddl=row['Create Table'].replace(new RegExp('`'+sourcePrefix+'([a-z_]+)`','g'),(_,suffix)=>'`'+destination+suffix+'`');
   ddl=ddl.replace(/CONSTRAINT `([^`]+)`/g,(_,constraint)=>'CONSTRAINT `'+destination+constraint.slice(-30)+'`');
   await client.query(ddl);
  }
  await client.beginTransaction();
  try{for(const table of tables){
   const [fields]=await client.execute("SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND GENERATION_EXPRESSION='' ORDER BY ORDINAL_POSITION",[sourcePrefix+table]);
   assert.ok(fields.length);const columns=fields.map(field=>{assert.match(field.name,/^[a-z_][a-z_0-9]*$/);return '`'+field.name+'`';}).join(',');
   await client.query('INSERT INTO `'+destination+table+'` ('+columns+') SELECT '+columns+' FROM `'+sourcePrefix+table+'`');
  }await client.commit();}catch(error){await client.rollback();throw error;}
 }finally{client.release();}
}
async function snapshot(options,prefix){const pool=mappedPool(options,prefix);try{return await mysql.transaction(pool,mysql.load);}finally{await pool.end();}}
async function main(){
 assert.equal(process.env.RENOLINK_PHASE81_APPROVED,'1');const mode=process.argv[2];assert.ok(['init','before','after','candidate','balanced','explain','verify','hash'].includes(mode));
 const options=mysql.config(process.env,'TEST_MYSQL_');assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');
 const pool=mysql.pool(options);
 try{
  if(mode==='hash'){
   const password=crypto.randomBytes(32).toString('base64url');
   async function measure(count,parallel){const timings=[],started=performance.now(),cpuStart=process.cpuUsage();const job=async()=>{const begin=performance.now();await require('../lib/security').passwordHash(password);timings.push(performance.now()-begin);};if(parallel)await Promise.all(Array.from({length:count},job));else for(let i=0;i<count;i++)await job();const cpu=process.cpuUsage(cpuStart);return{count,parallel,wallMs:performance.now()-started,cpuMs:(cpu.user+cpu.system)/1000,calls:stats(timings)};}
   const report={parameters:{N:32768,r:8,p:3},threadPool:process.env.UV_THREADPOOL_SIZE||'default(4)',sequential:await measure(10,false),burst:await measure(50,true),databaseQueries:0};
   fs.writeFileSync(path.join(output,'hash.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return;
  }
  if(mode==='explain'){
   const [[user]]=await pool.query('SELECT email_normalized FROM renolink_users LIMIT 1');const results=[];
   for(const sql of ['SELECT id,password_hash,salt FROM renolink_users WHERE email=?','SELECT id,password_hash,salt FROM renolink_users WHERE email_normalized=?']){const [plan]=await pool.execute('EXPLAIN '+sql,[user.email_normalized]);results.push({sql,plan});}
   fs.writeFileSync(path.join(output,'explain.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));return;
  }
  if(mode==='verify'){
   const manifest=JSON.parse(fs.readFileSync(manifestFile)),initial=await snapshot(options,manifest.seed),results=[];
   const modes=['before','after','candidate','balanced'].filter(mode=>fs.existsSync(path.join(output,mode+'.json')));assert.ok(modes.includes('before')&&modes.includes('balanced'));
   for(const mode of modes)for(const result of JSON.parse(fs.readFileSync(path.join(output,mode+'.json'))).cases){
    const db=await snapshot(options,result.prefix),count=result.virtualUsers;
    for(const key of Object.keys(mysql.verify(initial,initial))){const primary=key==='sessions'?'tokenHash':key==='staff'?'userId':'id';for(const row of initial[key])assert.deepEqual(db[key].find(r=>r[primary]===row[primary]),row);}
    const added=db.users.filter(u=>!initial.users.some(old=>old.id===u.id));assert.equal(added.length,count);
    for(const user of added){assert.equal(db.ideas.filter(i=>i.userId===user.id&&i.status==='Em análise').length,1);const conversations=db.conversations.filter(c=>c.visitorId===user.id);assert.equal(conversations.length,1);assert.equal(db.supportMessages.filter(m=>m.conversationId===conversations[0].id&&m.senderId===user.id).length,1);assert.equal(db.sessions.filter(s=>s.userId===user.id).length,2);}
    results.push({mode,count,oldRowsPreserved:true,newRelationshipsVerified:true,duplicateRecords:false});
   }
   fs.writeFileSync(path.join(output,'integrity.json'),JSON.stringify(results,null,2));
   const files=['lib/mysql.js','lib/security.js','server.js','lib/realtime.js','test/fixtures/phase81-baseline-mysql.js'];const hashes=Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',file))).digest('hex')]));
   fs.writeFileSync(path.join(output,'implementation.json'),JSON.stringify(hashes,null,2));console.log(JSON.stringify(results));return;
  }
  if(mode==='init'){
   assert.equal(fs.existsSync(manifestFile),false,'Manifesto existente: nao reinicializar.');
   const id=crypto.randomBytes(4).toString('hex'),seed=`b81_${id}_seed_`;
   const before=await mysql.transaction(pool,mysql.load);
   await mysql.withLock(pool,()=>clone(pool,'renolink_',seed));
   const copied=await snapshot(options,seed);mysql.verify(before,copied);
   const client=await pool.getConnection();let configuration,plans=[];
   try{
    [[configuration]]=await client.query('SELECT @@version AS version, @@max_connections AS maxConnections, @@innodb_buffer_pool_size AS bufferPoolBytes, @@innodb_flush_log_at_trx_commit AS flushAtCommit, @@sync_binlog AS syncBinlog');
    for(const sql of ['SELECT * FROM renolink_users','SELECT id,password_hash,salt FROM renolink_users WHERE email=?','SELECT * FROM renolink_sessions WHERE token_hash=?','SELECT * FROM renolink_conversations WHERE visitor_id=?','SELECT * FROM renolink_support_messages WHERE conversation_id=?']){
     const [plan]=await client.execute('EXPLAIN '+sql,sql.includes('?')?[sql.includes('email')?'explain@teste.invalid':sql.includes('token')?'0'.repeat(64):1]:[]);plans.push({sql,plan});
    }
   }finally{client.release();}
   const manifest={id,seed,createdAt:new Date().toISOString(),fixtureHash:crypto.createHash('sha256').update(stable(copied)).digest('hex'),counts:mysql.verify(copied,copied),configuration,node:process.version,uvThreadpoolSize:process.env.UV_THREADPOOL_SIZE||'default(4)',poolLimit:options.connectionLimit,host:{cpus:os.cpus().length,cpuModel:os.cpus()[0].model,memoryGiB:os.totalmem()/1073741824},windowMs:60000,plans,baselineCodeHash:crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../test/fixtures/phase81-baseline-mysql.js'))).digest('hex')};
   fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));console.log(JSON.stringify({status:'fixture-cloned',counts:manifest.counts,plans:plans.map(p=>({sql:p.sql,access:p.plan[0].type,key:p.plan[0].key,rows:p.plan[0].rows}))}));return;
  }
  const manifest=JSON.parse(fs.readFileSync(manifestFile));
  assert.equal(process.version,manifest.node);assert.equal(options.connectionLimit,manifest.poolLimit);assert.equal(process.env.UV_THREADPOOL_SIZE||'default(4)',manifest.uvThreadpoolSize);assert.equal(os.cpus().length,manifest.host.cpus);assert.equal(os.cpus()[0].model,manifest.host.cpuModel);
  assert.deepEqual((await pool.query('SELECT @@version AS version, @@max_connections AS maxConnections, @@innodb_buffer_pool_size AS bufferPoolBytes, @@innodb_flush_log_at_trx_commit AS flushAtCommit, @@sync_binlog AS syncBinlog'))[0][0],manifest.configuration);
  const report={mode,manifest:path.basename(manifestFile),cases:[]};const file=path.join(output,mode+'.json');assert.equal(fs.existsSync(file),false,'Resultado existente: nao sobrescrever.');
  for(const count of [10,25,50]){
   const prefix=`b81_${manifest.id}_${mode==='before'?'b':mode==='after'?'a':mode==='candidate'?'c':'d'}${count}_`;await clone(pool,manifest.seed,prefix);
   const initial=await snapshot(options,prefix);assert.equal(crypto.createHash('sha256').update(stable(initial)).digest('hex'),manifest.fixtureHash);
   console.log(`Comparativo ${mode}: ${count} visitantes, fixture identica, janela 60 s`);
   const result=await run(count,options,{poolFactory:()=>mappedPool(options,prefix),childFile:path.resolve(__dirname,'../test/fixtures/phase81-server.js'),childEnv:{...process.env,PHASE81_PREFIX:prefix,PHASE81_VARIANT:mode},minimumDurationMs:manifest.windowMs});
   result.prefix=prefix;result.initialFixtureHash=manifest.fixtureHash;result.throughputRps=result.requests/(manifest.windowMs/1000);result.activeThroughputRps=result.requests/(result.operationsCompletedMs/1000);
   report.cases.push(result);fs.writeFileSync(file,JSON.stringify(report,null,2));
   assert.equal(result.errors,0);assert.equal(result.counts.completeUsers,count);assert.equal(result.oldRowsPreserved,true);assert.equal(result.sse.ready,count);assert.equal(result.sse.failures,0);assert.equal(result.sse.duplicateFrames,0);assert.deepEqual(result.persistedNew,{users:count,ideas:count,supportMessages:count});assert.ok(result.operationsCompletedMs+3000<=manifest.windowMs,'Janela insuficiente: comparacao interrompida.');
   console.log(JSON.stringify({count,p50:result.http.p50Ms,p95:result.http.p95Ms,p99:result.http.p99Ms,errors:result.errors,cpu:result.resources.cpuOneCorePercent,rss:result.resources.peakRssMiB,connections:result.resources.mysqlConnections}));
  }
  const seed=await snapshot(options,manifest.seed);assert.equal(crypto.createHash('sha256').update(stable(seed)).digest('hex'),manifest.fixtureHash);
 }finally{await pool.end();}
}
main().catch(error=>{console.error(JSON.stringify({status:'interrupted',type:error.name,code:error.code,errno:error.errno,location:String(error.stack).split('\n').find(s=>s.includes('phase81-benchmark.js:'))?.trim()}));process.exitCode=1;});
