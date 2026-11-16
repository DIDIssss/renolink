'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SERVICE_NAME,
  SERVICE_IDENTITY,
  validateFairBootstrapPlan,
  safeBootstrapLog
} = require('../lib/fair-mysql-bootstrap-plan');

const root = 'D:\\RenoLinkFair';
const operator = 'FAIR-BOOTSTRAP-OPERATOR';
const acl = principals => ({ verified: true, principals });
const trusted = ['SYSTEM', 'Administrators'];

function plan(overrides = {}) {
  return {
    repositoryPath: 'D:\\Downloads\\renolink\\renolink_funcional',
    mysqldPath: 'D:\\MySQL\\bin\\mysqld.exe',
    serviceName: SERVICE_NAME,
    serviceStartMode: 'manual',
    autoStart: false,
    serviceExists: false,
    port: 3307,
    bindAddress: '127.0.0.1',
    mysqlxEnabled: false,
    datadir: `${root}\\mysql\\data`,
    datadirExists: false,
    runtimeLogsDirectory: `${root}\\mysql\\logs`,
    bootstrapSecretDirectory: `${root}\\mysql\\bootstrap-secret`,
    bootstrapConfig: 'C:\\ProgramData\\RenoLink\\mysql-fair\\bootstrap.ini',
    bootstrapConfigExists: false,
    bootstrapSecretDirectoryExists: false,
    bootstrapErrorLogExists: false,
    bootstrapErrorLog: `${root}\\mysql\\bootstrap-secret\\initialize.err`,
    bootstrapOperator: operator,
    mysqlTlsReady: true,
    acls: {
      datadir: acl([...trusted, SERVICE_IDENTITY]),
      runtimeLogs: acl([...trusted, SERVICE_IDENTITY]),
      bootstrapSecret: acl([...trusted, operator]),
      configuration: acl([...trusted, SERVICE_IDENTITY])
    },
    ...overrides
  };
}

test('bootstrap plans only the isolated manual instance and never starts a service', () => {
  const result = validateFairBootstrapPlan(plan());
  assert.equal(result.executable, false);
  assert.equal(result.serviceName, SERVICE_NAME);
  assert.equal(result.serviceStartMode, 'manual');
  assert.equal(result.startsService, false);
  assert.equal(result.createsDatabaseOrUsers, false);
  assert.deepEqual(result.requiresSeparateAuthorization, ['initialize', 'register-service', 'start-service']);
  assert.match(result.initializeCommand, /--initialize$/);
  assert.doesNotMatch(result.initializeCommand, /initialize-insecure|Start-Service|--install/);
});

test('rejects shared paths and repository-contained files', () => {
  assert.throws(() => validateFairBootstrapPlan(plan({
    bootstrapSecretDirectory: `${root}\\mysql\\data\\bootstrap-secret`,
    bootstrapErrorLog: `${root}\\mysql\\data\\bootstrap-secret\\initialize.err`
  })), /compartilham escopo|exclusivamente/);
  assert.throws(() => validateFairBootstrapPlan(plan({
    runtimeLogsDirectory: 'D:\\Downloads\\renolink\\renolink_funcional\\logs'
  })), /fora do repositório/);
});

test('rejects configuration using the existing MySQL port or a non-loopback bind', () => {
  assert.throws(() => validateFairBootstrapPlan(plan({ port: 3306 })), /rede MySQL/);
  assert.throws(() => validateFairBootstrapPlan(plan({ bindAddress: '0.0.0.0' })), /rede MySQL/);
  assert.throws(() => validateFairBootstrapPlan(plan({ mysqlxEnabled: true })), /rede MySQL/);
});

test('rejects executable paths that could alter a copied command', () => {
  assert.throws(() => validateFairBootstrapPlan(plan({
    mysqldPath: 'D:\\MySQL\\bin\\mysqld.exe"\n--initialize-insecure'
  })), /caminhos.*absolutos/);
});

test('rejects an existing datadir without modifying or replacing it', () => {
  assert.throws(() => validateFairBootstrapPlan(plan({ datadirExists: true })), /novo/);
  assert.throws(() => validateFairBootstrapPlan(plan({ serviceExists: true })), /Serviço Feira/);
  assert.throws(() => validateFairBootstrapPlan(plan({ bootstrapConfigExists: true })), /novo/);
});

test('fails closed when any effective ACL evidence is missing or unverified', () => {
  assert.throws(() => validateFairBootstrapPlan(plan({
    acls: { ...plan().acls, bootstrapSecret: { verified: false, principals: [...trusted, operator] } }
  })), /ACL efetiva.*não comprovada/);
  assert.throws(() => validateFairBootstrapPlan(plan({
    acls: { ...plan().acls, bootstrapSecret: acl([...trusted, operator, 'Users']) }
  })), /não autorizados/);
});

test('bootstrap secret values never enter status logs', () => {
  const secret = 'synthetic-temporary-password-never-log';
  const serialized = safeBootstrapLog({
    phase: 'initialize',
    status: 'failed',
    exitCode: 1,
    timestamp: '2026-11-01T00:00:00Z',
    password: secret,
    error: `failed with ${secret}`,
    logContents: secret
  });
  assert.equal(serialized.includes(secret), false);
  assert.deepEqual(JSON.parse(serialized), {
    phase: 'initialize',
    status: 'failed',
    exitCode: 1,
    timestamp: '2026-11-01T00:00:00Z'
  });
  const invalidFields = safeBootstrapLog({
    phase: secret,
    status: secret,
    timestamp: secret
  });
  assert.equal(invalidFields.includes(secret), false);
});

test('rejects implicit automatic startup and requires TLS before service start', () => {
  assert.throws(() => validateFairBootstrapPlan(plan({ autoStart: true })), /início manual/);
  assert.throws(() => validateFairBootstrapPlan(plan({ serviceStartMode: 'auto' })), /início manual/);
  assert.throws(() => validateFairBootstrapPlan(plan({ mysqlTlsReady: false })), /TLS MySQL/);
});
