'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const mysql = require('../lib/mysql');
const { initialize } = require('../lib/phase5-data');
const { apply, schemaHash } = require('./migrate-phase5');
const { digest } = require('../lib/security');
const root = path.resolve(__dirname,'..');
const output = path.join(root,'data/runtime/phase5-activation-report.json');
const planned = ['renolink_staff','renolink_conversations','renolink_support_messages','renolink_requests','renolink_audit'];
const legacy = ['renolink_users','renolink_ideas','renolink_negotiations','renolink_messages','renolink_sessions','renolink_meta','renolink_imports'];
const report = { status:'running', phase:'review', realAdministratorsCreated:false };
const save = () => fs.writeFileSync(output,JSON.stringify(report,null,2));
function review() {
  assert.equal(schemaHash(),'48ed1afad24d682df513bcf671a4e3533f9ef487d62b47d2b49f247b5fcab0fd');
  const sql = fs.readFileSync(path.join(root,'database/mysql/002_phase5.sql'),'utf8').replace(/^\s*--.*$/gm,'');
  const statements = sql.split(';').map(s=>s.trim()).filter(Boolean);
  assert.equal(statements.length,5);
  assert.deepEqual(statements.map(s=>/^CREATE TABLE IF NOT EXISTS (renolink_\w+)\s*\(/.exec(s)?.[1]),planned);
  assert.ok(statements.every(s=>!/(?:^|;)\s*(?:DROP|TRUNCATE|DELETE|ALTER|INSERT|UPDATE|SET)\b/im.test(s)));
  return statements;
}
async function structure(client,names) {
  const result = {};
  for (const name of names) {
    assert.ok([...legacy,...planned].includes(name));
    const [[row]] = await client.query('SHOW CREATE TABLE `' + name + '`');
    result[name] = row['Create Table'];
  }
  return result;
}
async function main() {
  review();
  const options = mysql.config();
  assert.equal(options.database,'renolink_dev'); assert.equal(options.user,'renolink_migrator'); assert.equal(options.host,'127.0.0.1');
  assert.equal(process.env.RENOLINK_PHASE5_DEV_SCHEMA_APPROVED,'1');
  const pool = mysql.pool(options); let before,ddl;
  try {
    const [[identity]] = await pool.execute('SELECT CURRENT_USER() AS account');
    assert.equal(identity.account,'renolink_migrator@127.0.0.1'); report.account=identity.account;
    const [processes] = await pool.query('SHOW PROCESSLIST');
    assert.equal(processes.filter(p=>p.db === 'renolink_dev').length,1,'Outra conexao migradora existe.');
  } finally { await pool.end(); }
  save();
  report.first = await apply({ options, approved:true, developmentApproved:true, beforeApply:async({client,before:state})=>{
    before=structuredClone(state);
    const initialCounts=mysql.verify(before,before);
    assert.deepEqual({users:initialCounts.users,ideas:initialCounts.ideas,negotiations:initialCounts.negotiations,messages:initialCounts.messages},{users:4,ideas:9,negotiations:1,messages:7});
    report.countsBefore=initialCounts;
    const [tables] = await client.execute('SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE()');
    assert.deepEqual(tables.map(t=>t.name).sort(),[...legacy].sort()); assert.ok(tables.every(t=>t.engine==='InnoDB'));
    const [triggers] = await client.execute('SELECT TRIGGER_NAME FROM information_schema.triggers WHERE TRIGGER_SCHEMA=DATABASE()');
    const [routines] = await client.execute('SELECT ROUTINE_NAME FROM information_schema.routines WHERE ROUTINE_SCHEMA=DATABASE()');
    const [events] = await client.execute('SELECT EVENT_NAME FROM information_schema.events WHERE EVENT_SCHEMA=DATABASE()');
    assert.equal(triggers.length+routines.length+events.length,0,'Objetos fora do schema documentado.');
    ddl=await structure(client,legacy);
    const dir=path.join(root,'data/backups/phase5-dev-full',new Date().toISOString().replace(/[:.]/g,'-'));
    fs.mkdirSync(dir,{recursive:true});
    const dumpFile=path.join(dir,'renolink_dev.sql'), snapshotFile=path.join(dir,'snapshot.json');
    fs.writeFileSync(snapshotFile,JSON.stringify({database:'renolink_dev',structure:ddl,data:before},null,2),{flag:'wx',mode:0o600});
    report.phase='full-backup'; save();
    execFileSync('C:/Program Files/MySQL/MySQL Workbench 8.0/mysqldump.exe',[
      '--no-defaults','--protocol=TCP','--host=127.0.0.1','--port=3306','--user=renolink_migrator',
      '--single-transaction','--no-tablespaces','--skip-lock-tables','--skip-add-locks','--skip-add-drop-table',
      '--skip-disable-keys','--skip-comments','--skip-triggers','--set-gtid-purged=OFF','--column-statistics=0',
      '--complete-insert','--skip-extended-insert','--hex-blob','--default-character-set=utf8mb4','--result-file='+dumpFile,'renolink_dev'
    ],{env:{...process.env,MYSQL_PWD:options.password},stdio:['ignore','ignore','pipe'],windowsHide:true,timeout:30000});
    const dump=fs.readFileSync(dumpFile,'utf8');
    const creates=[...dump.matchAll(/^CREATE TABLE `(renolink_\w+)`/gm)].map(m=>m[1]);
    assert.deepEqual(creates.sort(),[...legacy].sort());
    const tableCounts={};
    for(const name of legacy){
      const [[row]]=await client.execute('SELECT COUNT(*) AS count FROM `'+name+'`');
      tableCounts[name]=Number(row.count);
      assert.equal([...dump.matchAll(new RegExp('^INSERT INTO `'+name+'`','gm'))].length,Number(row.count),'Contagem do dump diverge.');
    }
    assert.ok(!/^\s*(DROP|TRUNCATE|DELETE|CREATE DATABASE|USE)\b/im.test(dump));
    const snapshot=JSON.parse(fs.readFileSync(snapshotFile)); assert.deepEqual(snapshot.structure,ddl); mysql.verify(before,snapshot.data);
    const manifest={database:'renolink_dev',createdAtUtc:new Date().toISOString(),tableCounts,files:[dumpFile,snapshotFile].map(file=>({file:path.basename(file),bytes:fs.statSync(file).size,sha256:digest(fs.readFileSync(file))})),schemaSha256:schemaHash()};
    const manifestFile=path.join(dir,'manifest.json'); fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
    for(const entry of manifest.files)assert.equal(digest(fs.readFileSync(path.join(dir,entry.file))),entry.sha256);
    mysql.verify(before,await mysql.load(client));
    report.backup={directory:dir,manifestFile,tableCounts,verified:true};
    report.phase='apply-schema'; save();
  }});
  assert.equal(report.first.mode,'applied');
  report.phase='postcheck'; save();
  report.second=await apply({options,approved:true,developmentApproved:true,beforeApply:async()=>{throw Error('Segunda execucao nao deve reaplicar DDL.');}});
  assert.equal(report.second.mode,'already-applied');
  const check=mysql.pool(options);
  try {
    await mysql.transaction(check,async client=>{
      assert.deepEqual(await structure(client,legacy),ddl,'Estrutura preexistente alterada.');
      const after=await mysql.load(client),expected=initialize(structuredClone(before));
      expected.meta.phase5MigrationHash=after.meta.phase5MigrationHash; expected.meta.phase5AppliedAt=after.meta.phase5AppliedAt;
      report.counts=mysql.verify(expected,after);
      for(const [key,value]of Object.entries(before.meta)) assert.deepEqual(after.meta[key],value,'Metadata anterior modificado.');
      for(const key of ['staff','conversations','supportMessages','requests','audit'])assert.equal(after[key].length,0);
      const [tables]=await client.execute('SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE()');
      assert.deepEqual(tables.map(t=>t.name).sort(),[...legacy,...planned].sort());assert.ok(tables.every(t=>t.engine==='InnoDB'));
      const [foreignKeys]=await client.execute('SELECT TABLE_NAME,CONSTRAINT_NAME FROM information_schema.referential_constraints WHERE CONSTRAINT_SCHEMA=DATABASE()');
      assert.equal(foreignKeys.filter(f=>planned.includes(f.TABLE_NAME)).length,7);
      report.newTableStructures=await structure(client,planned);
      report.existingSchemaAndRowsPreserved=true;
    });
  }finally{await check.end();}
  report.status='passed';report.phase='complete';report.completedAtUtc=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,counts:report.counts,first:report.first.mode,second:report.second.mode,backup:report.backup.directory,existingSchemaAndRowsPreserved:true,realAdministratorsCreated:false},null,2));
}
main().catch(error=>{report.status='failed';report.errorCode=/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'VERIFICATION_FAILED';save();console.error(`Ativacao interrompida na fase ${report.phase}: ${report.errorCode}. Consulte o relatorio; nenhum segredo foi exibido.`);process.exitCode=1;});
