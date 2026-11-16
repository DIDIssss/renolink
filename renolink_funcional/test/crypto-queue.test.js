'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createQueue}=require('../lib/crypto-queue'),security=require('../lib/security');
const tick=()=>new Promise(r=>setImmediate(r));
test('Fila criptografica limita execucao, preserva FIFO e nunca perde trabalho admitido',async()=>{
 const observations=[],queue=createQueue({concurrency:2,maxPending:3,observe:v=>observations.push(v)}),release=[],started=[];
 const calls=Array.from({length:5},(_,i)=>queue.run(()=>new Promise(resolve=>{started.push(i);release.push(()=>resolve(i));})));
 await tick();assert.deepEqual(started,[0,1]);assert.deepEqual(queue.metrics(),{active:2,pending:3,concurrency:2,maxPending:3});
 release.shift()();await tick();assert.deepEqual(started,[0,1,2]);while(release.length){release.shift()();await tick();}
 assert.deepEqual(await Promise.all(calls),[0,1,2,3,4]);assert.equal(observations.length,5);assert.equal(queue.metrics().active,0);assert.ok(observations.every(v=>v.queueMs>=0&&v.serviceMs>=0));
});
test('Sobrecarga falha com 503 sem iniciar tarefa nem remover trabalho existente',async()=>{
 const events=[],queue=createQueue({concurrency:1,maxPending:1,observe:v=>events.push(v)});let release,ran=false;
 const first=queue.run(()=>new Promise(r=>release=r)),second=queue.run(()=>42);await tick();
 await assert.rejects(queue.run(()=>{ran=true;}),e=>e.status===503);assert.equal(ran,false);assert.equal(queue.metrics().pending,1);release();await first;assert.equal(await second,42);assert.equal(events.filter(v=>v.rejected).length,1);
});
test('Erro sincrono ou rejeicao libera o slot e preserva tarefas seguintes',async()=>{
 const queue=createQueue({concurrency:1,maxPending:3,observe:()=>{}});
 const a=assert.rejects(queue.run(()=>{throw Error('synthetic');}),/synthetic/),b=assert.rejects(queue.run(()=>Promise.reject(Error('synthetic async'))),/synthetic async/),c=queue.run(()=>7);
 await Promise.all([a,b]);assert.equal(await c,7);assert.equal(queue.metrics().active,0);
});
test('Configuracoes criptograficas inseguras ou invalidas sao recusadas',()=>{
 for(const concurrency of [0,9,1.5,NaN])assert.throws(()=>createQueue({concurrency}));for(const maxPending of [-1,257,1.5])assert.throws(()=>createQueue({maxPending}));
});
test('Tarefas e diagnosticos preservam o contexto do solicitante mesmo apos esperar',async()=>{
 const {AsyncLocalStorage}=require('node:async_hooks'),als=new AsyncLocalStorage(),seen=[],queue=createQueue({concurrency:1,maxPending:2,observe:()=>seen.push('metric:'+als.getStore())});let release;
 const a=als.run('A',()=>queue.run(()=>new Promise(r=>release=r)));const b=als.run('B',()=>queue.run(()=>{seen.push('task:'+als.getStore());}));await tick();release();await Promise.all([a,b]);assert.ok(seen.includes('task:B'));assert.deepEqual(seen.filter(s=>s.startsWith('metric:')).sort(),['metric:A','metric:B']);
});
test('Hash mantem parametros e compatibilidade, rejeita senha incorreta e formato adulterado',async()=>{
 const password='Sintetica2026!Teste',value=await security.passwordHash(password);
 assert.match(value.passwordHash,/^scrypt\$32768\$8\$3\$[a-f0-9]{128}$/);assert.equal(await security.verifyPassword(password,value),true);assert.equal(await security.verifyPassword(password+'!',value),false);
 assert.equal(await security.verifyPassword(password,{...value,passwordHash:value.passwordHash.replace('$32768$','$16384$')}),false);
 assert.equal(await security.verifyPassword(password,{salt:'legacy-synthetic',passwordHash:security.digest('legacy-synthetic:'+password)}),true);
});
test('Atualizacao de hash legado e preparada antes da transacao e prova rejeita credencial alterada',async()=>{
 const password='Sintetica2026!Legado',user={id:1,email:'legacy@teste.invalid',salt:'synthetic',passwordHash:security.digest('synthetic:'+password)},req={authAttempt:'login',data:{email:user.email,password}};
 await security.prepareAuthentication(req,{credentials:async()=>({...user}),transaction:()=>assert.fail('Nao deve adquirir transacao para hashing')});
 assert.match(req.preparedPasswordUpgrade.passwordHash,/^scrypt\$32768\$8\$3\$/);assert.equal(await security.verifyRequestPassword(req,password,user),true);assert.equal(await security.verifyRequestPassword(req,password,{...user,...req.preparedPasswordUpgrade}),false);assert.equal(await security.verifyRequestPassword(req,password,{...user,id:2}),false);
 const wrong={authAttempt:'login',data:{email:user.email,password:password+'!'}};await security.prepareAuthentication(wrong,{credentials:async()=>({...user})});assert.equal(wrong.preparedPasswordUpgrade,undefined);assert.equal(await security.verifyRequestPassword(wrong,wrong.data.password,user),false);
});
