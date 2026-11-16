'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// No real mysql2 module or filesystem writes are available inside this sandbox.
function harness({ dbs = [], users = [], logRaw = 0, partialRevokes = 0, failGrant = false } = {}) {
  const queries = [], reports = [], outputs = [];
  const env = { RENOLINK_SETUP_ADMIN_USER: 'synthetic-admin', RENOLINK_SETUP_ADMIN_PASSWORD: 'synthetic-only',
    RENOLINK_SETUP_APP_PASSWORD: 'Aa1!' + '1'.repeat(64), RENOLINK_SETUP_MIGRATOR_PASSWORD: 'Aa1!' + '2'.repeat(64), RENOLINK_SETUP_TESTER_PASSWORD: 'Aa1!' + '3'.repeat(64) };
  const specs = { renolink_app: ['renolink_dev', 'SELECT, INSERT, UPDATE'], renolink_migrator: ['renolink_dev', 'SELECT, INSERT, UPDATE, CREATE, INDEX, REFERENCES'], renolink_tester: ['renolink_test', 'SELECT, INSERT, UPDATE, CREATE, INDEX, REFERENCES'] };
  const driver = { async createConnection(options) {
    return {
      escape: value => "'" + value.replace(/'/g, "''") + "'",
      async query(sql) {
        queries.push(sql);
        if (sql.startsWith('SELECT VERSION')) return [[{ version: '8.0.46', logRaw, partialRevokes }]];
        if (sql.startsWith('GRANT ') && failGrant) throw Object.assign(Error('synthetic driver detail'), { code: 'ER_DBACCESS_DENIED_ERROR' });
        if (sql.startsWith('SELECT CURRENT_USER')) return [[{ account: options.user + '@127.0.0.1' }]];
        if (sql === 'SHOW GRANTS') {
          const [database, privileges] = specs[options.user];
          const scope = partialRevokes ? database : database.replace(/_/g, '\\_');
          return [[{ grant: 'GRANT USAGE ON *.* TO `' + options.user + '`@`127.0.0.1`' },
            { grant: 'GRANT ' + privileges + ' ON `' + scope + '`.* TO `' + options.user + '`@`127.0.0.1`' }]];
        }
        return [[]];
      },
      async execute(sql) {
        queries.push(sql);
        if (sql.includes('information_schema.schemata')) return [dbs];
        if (sql.includes('mysql.user')) return [users];
        if (sql.includes('COUNT(*)')) return [[{ count: 0 }]];
        throw Error('Unexpected synthetic query');
      },
      async end() {}
    };
  } };
  const scriptModule = { exports: {} };
  const sandbox = { module: scriptModule, __dirname: path.resolve(__dirname, '../scripts'), process: { argv: ['node', 'script', '--apply'], env },
    console: { log: line => outputs.push(line), error: line => outputs.push(line) },
    require(name) {
      if (name === 'node:fs') return { mkdirSync() {}, writeFileSync(file, text) { reports.push(JSON.parse(text)); } };
      if (name === 'node:path') return path;
      if (name === 'mysql2/promise') return driver;
      if (name === '../lib/mysql') return { assertVersion: require('../lib/mysql').assertVersion };
      throw Error('Unexpected import');
    } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/provision-mysql.js'), 'utf8'), sandbox);
  return { run: scriptModule.exports.main, queries, reports, outputs, env };
}
test('Provisionamento recusa banco, usuario em qualquer host e log_raw antes de qualquer CREATE', async () => {
  for (const scenario of [{ dbs: [{ name: 'renolink_test' }] }, { users: [{ user: 'renolink_app', host: '%' }] }, { logRaw: 1 }]) {
    const h = harness(scenario);
    await assert.rejects(h.run());
    assert.ok(h.queries.every(sql => sql.startsWith('SELECT ')));
    assert.equal(h.reports.length, 0);
  }
});
test('Provisionamento limita contas a loopback e GRANT ao banco exato com ambas politicas de sublinhado', async () => {
  for (const partialRevokes of [0, 1]) {
    const h = harness({ partialRevokes }); await h.run();
    const mutations = h.queries.filter(sql => !sql.startsWith('SELECT ') && sql !== 'SHOW GRANTS');
    assert.equal(mutations.filter(sql => sql.startsWith('CREATE DATABASE ')).length, 2);
    const accounts = mutations.filter(sql => sql.startsWith('CREATE USER '));
    assert.equal(accounts.length, 3);
    assert.ok(accounts.every(sql => sql.includes("@'127.0.0.1'") && !sql.includes('IF NOT EXISTS')));
    assert.ok(mutations.filter(sql => sql.startsWith('GRANT ')).every(sql => !sql.includes(' ON *.* ') && !sql.includes('WITH GRANT OPTION')));
    const report = h.reports.at(-1);
    assert.equal(report.status, 'provisioned'); assert.equal(report.devEmpty, true);
    for (const secret of Object.values(h.env).filter(v => v.startsWith('Aa1!'))) {
      assert.ok(!JSON.stringify(h.reports).includes(secret));
      assert.ok(!JSON.stringify(h.outputs).includes(secret));
    }
  }
});
test('Falha parcial de GRANT preserva recursos e nao executa DROP, reset ou ALTER', async () => {
  const h = harness({ failGrant: true });
  await assert.rejects(h.run(), { code: 'ER_DBACCESS_DENIED_ERROR' });
  assert.equal(h.reports.at(-1).createdDatabases.length, 2);
  assert.equal(h.reports.at(-1).createdAccounts.length, 1);
  assert.ok(h.queries.every(sql => !/^(DROP|ALTER|DELETE|TRUNCATE|REVOKE|SET GLOBAL)/.test(sql)));
});
