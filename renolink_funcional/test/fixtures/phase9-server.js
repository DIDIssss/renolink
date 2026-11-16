'use strict';
const assert=require('node:assert/strict'),mysql=require('../../lib/mysql'),{createServer}=require('../../server'),hosting=require('../../lib/hosting');
assert.equal(process.env.RENOLINK_PHASE9_APPROVED,'1');const options=mysql.config(process.env,'TEST_MYSQL_');assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');assert.equal(options.host,'127.0.0.1');
const store=mysql.mysqlStore(options);let fault=false;
for(const key of ['health','api','readRealtime']){const original=store[key];store[key]=(...args)=>{if(fault)return Promise.reject(Object.assign(Error('Indisponibilidade sintetica.'),{status:503}));return original(...args);};}
const server=createServer(store,{hosting:hosting.policy({...process.env,NODE_ENV:'production',MYSQL_SSL:'1',STORAGE_DRIVER:'mysql',COOKIE_SECURE:'1',TRUST_PROXY:'loopback'})});
server.listen(0,'127.0.0.1',()=>process.send({type:'ready',port:server.address().port}));
process.on('message',async m=>{if(m.type==='fault'){fault=m.value;process.send({type:'fault',value:fault});}if(m.type==='close'){await new Promise(r=>server.close(r));await store.close();process.exit(0);}});
