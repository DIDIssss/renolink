'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mysql = require('../lib/mysql');
const { safeSessions, validate } = require('../lib/data');
const { digest } = require('../lib/security');
const root = path.resolve(__dirname, '..');
async function main() {
  const options = mysql.config();
  assert.equal(options.host, '127.0.0.1'); assert.equal(options.database, 'renolink_dev'); assert.equal(options.user, 'renolink_app');
  const report = { status: 'pending', url: 'http://127.0.0.1:3000' };
  const preflight = JSON.parse(fs.readFileSync(path.join(root, 'data/runtime/mysql-dev-preflight-report.json')));
  for (const entry of preflight.sources) {
    assert.equal(digest(fs.readFileSync(entry.file)), entry.sha256);
    assert.equal(digest(fs.readFileSync(entry.backup)), entry.sha256);
    const manifest = JSON.parse(fs.readFileSync(entry.backupManifest));
    assert.equal(manifest.sha256, entry.sha256); assert.deepEqual(manifest.counts, entry.counts);
  }
  const source = safeSessions(validate(JSON.parse(fs.readFileSync(path.join(root, 'data/runtime/db.json')))));
  const pool = mysql.pool(options);
  try {
    const [[identity]] = await pool.execute('SELECT CURRENT_USER() AS account, DATABASE() AS db, VERSION() AS version');
    assert.equal(identity.account, 'renolink_app@127.0.0.1'); report.identity = identity;
    report.counts = await mysql.transaction(pool, async client => {
      const actual = await mysql.load(client);
      if (actual.meta.schemaVersion === 5) {
        require('../lib/phase5-data').initialize(source);
        assert.equal(actual.meta.phase5MigrationHash,require('./migrate-phase5').schemaHash());
        source.meta.phase5MigrationHash=actual.meta.phase5MigrationHash;
        source.meta.phase5AppliedAt=actual.meta.phase5AppliedAt;
      }
      const counts=mysql.verify(source,actual);
      report.schemaVersion=actual.meta.schemaVersion || 1;
      const [tables]=await client.execute('SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE()');
      report.tables=tables;
      if(actual.meta.schemaVersion===5){
        assert.equal(tables.length,12);assert.ok(tables.every(t=>t.engine==='InnoDB'));
        const [constraints]=await client.execute('SELECT TABLE_NAME AS name,CONSTRAINT_TYPE AS type FROM information_schema.table_constraints WHERE CONSTRAINT_SCHEMA=DATABASE()');
        const planned=['renolink_staff','renolink_conversations','renolink_support_messages','renolink_requests','renolink_audit'];
        const added=constraints.filter(c=>planned.includes(c.name));
        assert.equal(added.filter(c=>c.type==='PRIMARY KEY').length,5);
        assert.equal(added.filter(c=>c.type==='FOREIGN KEY').length,7);
        assert.equal(added.filter(c=>c.type==='CHECK').length,10);
        assert.equal(added.filter(c=>c.type==='UNIQUE').length,2);
        report.newTableConstraints={primaryKeys:5,foreignKeys:7,checks:10,uniqueKeys:2};
      }
      return counts;
    });
    const [[imports]] = await pool.execute('SELECT COUNT(*) AS count FROM renolink_imports');
    assert.equal(Number(imports.count), 1); report.importMarkers = 1;
  } finally { await pool.end(); }
  for (const route of ['/', '/api/stats', '/api/ideas']) {
    const response = await fetch(report.url + route, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200); await response.arrayBuffer();
  }
  if(report.schemaVersion===5){
    const features=await (await fetch(report.url+'/api/features')).json();assert.equal(features.phase5,true);
    for(const route of ['/api/admin/me','/api/admin/users','/api/admin/ideas','/api/admin/audit','/api/team/conversations','/api/requests']){
      const response=await fetch(report.url+route);assert.equal(response.status,401);
    }
    const page=await fetch(report.url+'/admin.html',{redirect:'manual'});assert.equal(page.status,303);
    const login=await fetch(report.url+'/admin-login.html');assert.equal(login.status,200);
    report.phase5Active=true;report.unauthorizedAccessBlocked=true;
  }
  report.status = 'passed'; report.fullSourceComparison = true; report.originalsAndBackupsUnchanged = true;
  report.checkedAtUtc = new Date().toISOString();
  fs.writeFileSync(path.join(root, 'data/runtime/mysql-dev-live-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('Inspecao final interrompida. Nenhum segredo foi registrado.'); process.exitCode = 1; });
