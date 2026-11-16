'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/js/app.js'),'utf8');
function client(status){
 const context={authRule:'required',getSession:()=>({user:{id:1}}),api:async()=>{throw Object.assign(Error('Indisponivel'),{status});},location:{href:''},clearSession:()=>{context.cleared=true;}};
 vm.runInNewContext(source.slice(source.indexOf('async function hydratePrivateLayout()'),source.indexOf("document.querySelectorAll('[data-action=\"logout\"]')")),context);
 return context;
}
test('Indisponibilidade temporaria nao apaga a sessao nem redireciona para login',async()=>{
 const context=client(503);await assert.rejects(context.hydratePrivateLayout(),error=>error.status===503);assert.equal(context.cleared,undefined);assert.equal(context.location.href,'');
});
test('Sessao expirada limpa o estado local e exige novo login',async()=>{
 const context=client(401);assert.equal(await context.hydratePrivateLayout(),null);assert.equal(context.cleared,true);assert.equal(context.location.href,'login.html');
});
test('Resumo mantem compatibilidade com backend anterior sem repetir gravações',async()=>{
 const calls=[],context={api:async route=>{calls.push(route);if(route.startsWith('/portal/'))throw Object.assign(Error('Ausente'),{status:404});return {'/features':{phase5:true},'/negotiations':{negotiations:[]},'/ideas?mine=1':{ideas:[{id:1}]},'/requests':{requests:[]}}[route];}};
 vm.runInNewContext(source.slice(source.indexOf('async function phase5Enabled()'),source.indexOf('\nfunction showAlert')),context);
 const result=await context.portalSummary('dashboard',{role:'creator'});assert.equal(result.ideas[0].id,1);assert.equal(calls.length,5);assert.ok(calls.every(route=>!route.includes('auth')));
});
test('Resumo nao usa fallback para contornar erro de autenticacao',async()=>{
 let calls=0;const context={api:async()=>{calls++;throw Object.assign(Error('Sem sessao'),{status:401});}};
 vm.runInNewContext(source.slice(source.indexOf('async function phase5Enabled()'),source.indexOf('\nfunction showAlert')),context);
 await assert.rejects(context.portalSummary('deals'),error=>error.status===401);assert.equal(calls,1);
});
