'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const scopes=require('../lib/mysql-scopes'),mysql=require('../lib/mysql'),security=require('../lib/security'),{fixture}=require('./fixtures/mysql');
function fake(cookie=true){
 const db=fixture(),session=security.issueSession({userId:1},db),calls=[];
 const raw=(key,row)=>({...Object.fromEntries(mysql.mappings[key].map(field=>[field.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),row[field]])),extra:{}});
 const client={async execute(sql,args=[]){calls.push({sql,args});if(sql.startsWith('SELECT payload'))return[[{payload:db.meta}]];
  for(const key of ['sessions','users','ideas','negotiations'])if(sql.includes('FROM renolink_'+key+' ')){
   let rows=key==='negotiations'?[]:db[key];if(key==='sessions')rows=rows.filter(s=>args.includes(s.tokenHash));if(key==='users')rows=rows.filter(u=>args.includes(u.id));if(key==='ideas'){rows=rows.filter(i=>i.userId===args[0]);const limit=/LIMIT (\d+)/.exec(sql);if(limit)rows=rows.slice(0,Number(limit[1]));}return[rows.map(row=>raw(key,row))];
  }throw Error('Consulta inesperada');
 }};return{client,calls,req:{method:'GET',headers:cookie?{cookie:session.cookie.split(';')[0]}:{}}};
}
test('Escopo MySQL filtra pelo usuário da sessão e parametriza IDs sem confiar na URL',async()=>{
 const h=fake(),url=new URL('http://local/api/ideas?mine=1&userId=2&limit=1');const db=await scopes.load(h.client,{req:h.req,url});assert.equal(db.users.length,1);assert.equal(db.users[0].id,1);assert.equal(db.ideas.length,1);
 const query=h.calls.find(c=>c.sql.includes('FROM renolink_ideas'));assert.ok(query.sql.includes('WHERE user_id = ?'));assert.deepEqual(query.args,[1]);assert.ok(query.sql.includes('LIMIT 1 OFFSET 0'));assert.ok(!h.calls.some(c=>/INSERT|UPDATE|DELETE/.test(c.sql)));
});
test('Paginação recusa valores fora dos limites antes de compor o SQL',async()=>{
 for(const value of ['1000','-1','1;DROP TABLE users']){const h=fake();await assert.rejects(scopes.load(h.client,{req:h.req,url:new URL('http://local/api/ideas?mine=1&limit='+encodeURIComponent(value))}),e=>e.status===400);assert.ok(!h.calls.some(c=>c.sql.includes('DROP')));}
});
test('Escopo privado anônimo não consulta ideias e rotas não planejadas usam fallback',async()=>{
 const h=fake(false),url=new URL('http://local/api/ideas?mine=1');const db=await scopes.load(h.client,{req:h.req,url});assert.deepEqual(db.ideas,[]);assert.ok(!h.calls.some(c=>c.sql.includes('FROM renolink_ideas')));assert.equal(scopes.supports(h.req,new URL('http://local/api/admin/users')),false);assert.equal(scopes.supports({method:'DELETE'},url),false);
});
