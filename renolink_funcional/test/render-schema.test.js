'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{plan}=require('../scripts/render-schema');
const mysql=require('../lib/mysql'),{validate}=require('../lib/data');
test('offline Render schema plan has 12 ordered non-destructive tables and guarded empty v5 metadata',()=>{
 const result=plan();assert.equal(result.schemaVersion,5);assert.equal(result.tables.length,12);
 assert.equal(result.statements.length,13);assert.equal(result.sql,plan().sql);
 assert.ok(result.statements.slice(0,-1).every(sql=>/^CREATE TABLE IF NOT EXISTS renolink_/.test(sql)));
 assert.doesNotMatch(result.sql.replace(/ON DELETE RESTRICT/g,''),/\b(?:DROP|TRUNCATE|DELETE|GRANT|REVOKE|ALTER)\b/i);
 const bootstrap=result.statements.at(-1);assert.match(bootstrap,/^INSERT INTO renolink_meta/);
 for(const table of result.tables)assert.ok(bootstrap.includes(`NOT EXISTS (SELECT 1 FROM ${table})`));
 assert.doesNotMatch(bootstrap,/ON DUPLICATE|REPLACE|UPDATE/i);
 const meta=JSON.parse(/SELECT 1, '(.*?)'/.exec(bootstrap)[1]);
 const db=structuredClone(require('./fixtures/empty.json'));db.meta=meta;validate(db);
 assert.match(meta.phase5MigrationHash,/^[a-f0-9]{64}$/);
});
test('supported MySQL versions and incompatible engines remain explicitly checked',()=>{
 for(const version of ['8.0.17','8.0.46','8.4.0','8.4.7'])assert.doesNotThrow(()=>mysql.assertVersion(version));
 for(const version of ['8.0.16','5.7.44','9.0.0','10.11-MariaDB'])assert.throws(()=>mysql.assertVersion(version));
});
