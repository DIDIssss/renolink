'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{once}=require('node:events'),fs=require('node:fs'),path=require('node:path');
const hosting=require('../lib/hosting'),staging=require('../lib/staging'),mysql=require('../lib/mysql'),{createServer}=require('../server');
const environment={NODE_ENV:'production',APP_ENV:'staging',STORAGE_DRIVER:'mysql',APP_ORIGIN:'https://staging.renolink.test',COOKIE_SECURE:'1',TRUST_PROXY:'loopback',MYSQL_SSL:'1',MYSQL_HOST:'mysql.renolink.test',MYSQL_DATABASE:'renolink_staging',MYSQL_USER:'renolink_staging_app',MYSQL_PASSWORD:'synthetic-test-only',PORT:'3000'};
test('Producao recusa origem nao canonica, HTTP, cookie inseguro, banco sem TLS e proxy indefinido',()=>{
 assert.equal(hosting.policy(environment).production,true);
 for(const patch of [{APP_ORIGIN:'http://example.test'},{APP_ORIGIN:'https://user:pw@example.test'},{APP_ORIGIN:'https://example.test/path'},{APP_ORIGIN:'https://example.test/'},{COOKIE_SECURE:'0'},{MYSQL_SSL:'0'},{STORAGE_DRIVER:'json'},{TRUST_PROXY:'off'},{TRUST_PROXY:'*'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'}])assert.throws(()=>hosting.policy({...environment,...patch}));
});
test('Cabecalhos de encaminhamento sao ignorados sem confianca e rejeitados de peer nao local em producao',()=>{
 const req={socket:{remoteAddress:'198.51.100.1'},headers:{'x-forwarded-for':'203.0.113.2','x-forwarded-proto':'https'}};
 assert.deepEqual(hosting.context(req,{production:false,proxy:'off'}),{ip:'198.51.100.1',secure:false});assert.throws(()=>hosting.context(req,hosting.policy(environment)),e=>e.status===403);
});
test('Proxy loopback exige IP unico valido e HTTPS; listas ou protocolos forjados nao sao aceitos',()=>{
 const p=hosting.policy(environment),req={socket:{remoteAddress:'::ffff:127.0.0.1'},headers:{'x-forwarded-for':'203.0.113.8','x-forwarded-proto':'https'}};
 assert.deepEqual(hosting.context(req,p),{ip:'203.0.113.8',secure:true});
 for(const headers of [{},{'x-forwarded-for':'a','x-forwarded-proto':'https'},{'x-forwarded-for':'203.0.113.8, 203.0.113.9','x-forwarded-proto':'https'},{'x-forwarded-for':'203.0.113.8','x-forwarded-proto':'http'},{'x-forwarded-for':'203.0.113.8','x-forwarded-proto':'https, https'}])assert.throws(()=>hosting.context({...req,headers},p),e=>e.status===403);
});
test('Homologacao exige banco e conta separados; dev/test e modelos incompletos falham antes de conectar',()=>{
 assert.equal(staging.configuration(environment).mysql.database,'renolink_staging');
 for(const patch of [{MYSQL_DATABASE:'renolink_dev'},{MYSQL_DATABASE:'renolink_test'},{MYSQL_USER:'renolink_app'},{MYSQL_USER:'root'},{APP_ENV:'production'},{APP_ORIGIN:'https://staging.renolink.invalid'},{MYSQL_PASSWORD:''},{PORT:'0'}])assert.throws(()=>staging.configuration({...environment,...patch}));
});
test('Readiness MySQL consulta apenas meta, libera conexao em sucesso ou falha e nao adquire lock',async()=>{
 const queries=[];let releases=0,broken=false;
 const pool={getConnection:async()=>({execute:async sql=>{queries.push(sql);if(broken)throw Error('driver secret');return sql.includes('VERSION()')?[[{db:'mock',version:'8.0.46'}]]:[[{version:5}]];},release:()=>releases++}),end:async()=>{}};
 const store=mysql.mysqlStore({},{connectionPool:pool});assert.equal(await store.health(),true);broken=true;await assert.rejects(store.health());assert.equal(releases,2);
 assert.equal(queries.filter(q=>q.includes('VERSION()')).length,2);assert.equal(queries.filter(q=>q.startsWith('SELECT JSON_EXTRACT')).length,1);assert.ok(queries.every(q=>!q.includes('GET_LOCK')));
});
test('Revisao de grants recusa globais, roles, GRANT OPTION, wildcard de schema e privilegios incompletos',()=>{
 const g='GRANT SELECT ON `renolink_staging`.* TO `renolink_staging_app`@`127.0.0.1`',grants=[g,...['meta','users','ideas','messages','negotiations','sessions','conversations','support_messages','requests'].map(n=>'GRANT INSERT, UPDATE ON `renolink_staging`.`renolink_'+n+'` TO x'),'GRANT INSERT ON `renolink_staging`.`renolink_audit` TO x'];assert.equal(staging.verifyGrants(grants,true),true);assert.equal(staging.verifyGrants(grants.map(g=>g.includes('.*')?g.replace('`renolink_staging`','`renolink\\_staging`'):g),false),true);
 for(const grant of [g+' WITH GRANT OPTION',g.replace('`renolink_staging`.*','*.*'),g,g.replace('SELECT','ALL PRIVILEGES'),'GRANT USAGE ON *.* TO x WITH GRANT OPTION','GRANT `admin` TO x','GRANT SELECT, INSERT, UPDATE ON `renolink_staging`.* TO x'])assert.throws(()=>staging.verifyGrants([grant],true));assert.throws(()=>staging.verifyGrants(grants,false));
});
test('Metricas de runtime sao limitadas, numericas e nao registram segredos de requisicoes',()=>{
 const entries=[],dc=require('node:diagnostics_channel'),m=require('../lib/runtime-metrics').monitor({realtime:{connectionCount:()=>2}},{write:v=>entries.push(v),intervalMs:60000});try{for(let i=0;i<600;i++)dc.channel('renolink.mysql.pool.wait').publish(i);dc.channel('renolink.crypto.timing').publish({queueMs:5,serviceMs:10});m.sample();assert.equal(entries[0].timings.poolWait.samples,512);assert.equal(entries[0].crypto.concurrency,4);assert.equal(entries[0].sse,2);assert.equal(JSON.stringify(entries).includes('password'),false);}finally{m.close();}
});
test('Health separa liveness e readiness; nao vaza erro e logs excluem cookie, origem, query e arquivos internos',async()=>{
 const logs=[],store={health:async()=>{throw Error('driver-password-never-log');}},server=createServer(store,{hosting:{...hosting.policy(environment),log:true},logger:entry=>logs.push(entry)});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port,headers={'x-forwarded-for':'203.0.113.8','x-forwarded-proto':'https',cookie:'secret-cookie-never-log'};
 try{const live=await fetch(base+'/health/live',{headers});assert.equal(live.status,200);assert.match(live.headers.get('strict-transport-security'),/max-age/);const ready=await fetch(base+'/health/ready',{headers});assert.equal(ready.status,503);assert.deepEqual(await ready.json(),{ok:false});assert.equal((await fetch(base+'/scripts/staging-seed.js?secret-query-never-log',{headers})).status,404);assert.equal((await fetch(base+'/api/me')).status,403);await new Promise(r=>setImmediate(r));const output=JSON.stringify(logs);for(const value of ['driver-password','secret-cookie','secret-query','203.0.113.8','staging-seed'])assert.equal(output.includes(value),false);assert.equal(logs.length,4);}finally{await new Promise(r=>server.close(r));}
});
test('Fixture sintetica cria papeis auditados em estado vazio e recusa repeticao sem sobrescrever',async()=>{
 const db={meta:{schemaVersion:5,nextUserId:1,nextIdeaId:1,nextMessageId:1,nextNegotiationId:1,nextConversationId:1,nextSupportMessageId:1,nextRequestId:1,nextAuditId:1},users:[],ideas:[],messages:[],negotiations:[],sessions:[],staff:[],conversations:[],supportMessages:[],requests:[],audit:[]},store={transaction:async fn=>fn(db)},seed=require('../lib/staging-fixture').seed;
 await seed(store,'Synthetic-only-password2026!');require('../lib/data').validate(db);assert.equal(db.staff.length,1);assert.equal(db.audit[0].action,'staff.granted.local');assert.ok(db.users.every(u=>u.email.endsWith('@homologacao.invalid')&&u.passwordHash.startsWith('scrypt$32768$8$3$')));const before=JSON.stringify(db);await assert.rejects(seed(store,'Synthetic-only-password2026!'),/vazia/);assert.equal(JSON.stringify(db),before);
});
test('Pacote de release usa allowlist sem JSON, cofre, node_modules ou logs e recusa sobrescrita',()=>{
 const root=path.resolve(__dirname,'..'),target=path.join(root,'data/runtime/releases/test-'+require('node:crypto').randomBytes(8).toString('hex')),fn=require('../scripts/package-staging').packageRelease,result=fn(target),manifest=JSON.parse(fs.readFileSync(path.join(root,result.manifest)));
 assert.ok(Object.keys(manifest.files).every(f=>!/^data\/|^node_modules\/|^\.env|\.clixml$|\.log$/.test(f)));assert.ok(manifest.files['server.js']);assert.ok(manifest.files['scripts/staging.js']);assert.throws(()=>fn(target));assert.throws(()=>fn(path.join(root,'other')));
});
