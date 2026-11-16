'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { fork } = require('node:child_process');
const mysql = require('../lib/mysql');
const { apply } = require('../scripts/migrate-phase5');
const { createServer } = require('../server');
const { seed, scenarios } = require('./fixtures/phase5');
const { digest } = require('../lib/security');
test('Fase 5 MySQL isolado: migracao aditiva, HTTP completo e persistencia em outro processo', { skip: process.env.RENOLINK_PHASE5_TEST_APPROVED !== '1' }, async t => {
  const options = mysql.config(process.env, 'TEST_MYSQL_');
  assert.equal(options.database, 'renolink_test'); assert.equal(options.user, 'renolink_tester');
  await assert.rejects(apply({ options:{...options,database:'renolink_dev',user:'renolink_migrator'}, approved:true }), /Destino ou conta nao autorizados/);
  const originals = ['data/db.json','data/runtime/db.json'].map(f => path.join(__dirname, '..', f));
  const hashes = originals.map(f => digest(fs.readFileSync(f)));
  const probe = mysql.pool(options);
  let previous;
  try { previous = await mysql.transaction(probe, mysql.load); } finally { await probe.end(); }
  const migration = await apply({ options, approved: true });
  assert.ok(['applied','already-applied'].includes(migration.mode));
  assert.equal((await apply({ options, approved: true })).mode, 'already-applied');
  const store = mysql.mysqlStore(options);
  const ids = await store.transaction(db => seed(db));
  const server = createServer(store); server.listen(0,'127.0.0.1'); await once(server,'listening');
  let closed = false;
  t.after(async()=> { if (!closed) { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await store.close(); } originals.forEach((f,i)=>assert.equal(digest(fs.readFileSync(f)),hashes[i])); });
  const result = await scenarios(`http://127.0.0.1:${server.address().port}`,ids,{disableSupport:()=>store.transaction(db=>{db.staff.find(s=>s.userId === ids.support).active = 0;})});
  const snapshot = await store.transaction(db=>structuredClone(db));
  for (const key of Object.keys(mysql.mappings)) {
    const primary = key === 'sessions' ? 'tokenHash':'id';
    for (const row of previous[key]) assert.deepEqual(snapshot[key].find(r=>r[primary] === row[primary]),row,'Dados sinteticos anteriores preservados.');
  }
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await store.close(); closed = true;
  const env = { ...process.env, STORAGE_DRIVER:'mysql', NODE_ENV:'development', COOKIE_SECURE:'0', PORT:'0' };
  delete env.APP_ORIGIN; delete env.NODE_TEST_CONTEXT;
  for (const key of ['HOST','PORT','DATABASE','USER','PASSWORD','SSL','SSL_CA']) {
    delete env['MYSQL_' + key]; if (process.env['TEST_MYSQL_' + key] !== undefined) env['MYSQL_' + key] = process.env['TEST_MYSQL_' + key];
  }
  const child = fork(path.join(__dirname,'fixtures/mysql-server.js'),[],{env,execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
  const exited = new Promise(resolve=>child.once('exit',resolve));
  try {
    const port = await new Promise((resolve,reject)=>{
      const timer = setTimeout(()=>reject(Error('START_TIMEOUT')),15000);
      child.once('message',m=>{clearTimeout(timer);resolve(m.port);});
      child.once('exit',()=>{clearTimeout(timer);reject(Error('START_FAILED'));});
      child.once('error',()=>{clearTimeout(timer);reject(Error('START_FAILED'));});
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/team/conversations/${result.conversationId}/messages`,{headers:{Cookie:result.visitorCookie},signal:AbortSignal.timeout(5000)});
    assert.equal(response.status,200); assert.equal((await response.json()).messages.length,2);
    const reopened = mysql.mysqlStore(options);
    try { await reopened.transaction(actual=>mysql.verify(snapshot,actual)); } finally { await reopened.close(); }
  } finally { child.kill(); await exited; }
  fs.writeFileSync(path.join(__dirname,'../data/runtime/phase5-mysql-report.json'), JSON.stringify({ status:'passed', database:options.database, migration, counts:mysql.verify(snapshot,snapshot), ids, persistedAfterNodeRestart:true, previousSyntheticRowsPreserved:true, originalHashes:hashes, devSchemaApplied:false },null,2));
});
