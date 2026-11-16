'use strict';

const path = require('node:path');

const SERVICE_NAME = 'MYSQL_RENLINK_FEIRA';
const SERVICE_IDENTITY = `NT SERVICE\\${SERVICE_NAME}`;
const TRUSTED_PRINCIPALS = new Set(['SYSTEM', 'Administrators']);
const LOG_PHASES = new Set(['preflight', 'initialize', 'service-registration', 'service-start', 'credential-rotation', 'complete']);
const LOG_STATUSES = new Set(['started', 'succeeded', 'failed', 'blocked']);

function normalizedWindowsPath(value) {
  if (typeof value !== 'string' || /["\r\n\0]/.test(value) || !path.win32.isAbsolute(value)) {
    throw new Error('Todos os caminhos do bootstrap devem ser absolutos.');
  }
  return path.win32.resolve(value);
}

function isWithin(parent, child) {
  const relative = path.win32.relative(parent, child);
  return relative === '' || (!relative.startsWith('..\\') && relative !== '..' && !path.win32.isAbsolute(relative));
}

function assertDisjointDirectories(directories) {
  for (let left = 0; left < directories.length; left += 1) {
    for (let right = left + 1; right < directories.length; right += 1) {
      if (isWithin(directories[left].path, directories[right].path) ||
          isWithin(directories[right].path, directories[left].path)) {
        throw new Error(`Diretórios do bootstrap compartilham escopo: ${directories[left].name}/${directories[right].name}.`);
      }
    }
  }
}

function assertAcl(evidence, expectedPrincipals, label) {
  if (!evidence || evidence.verified !== true || !Array.isArray(evidence.principals)) {
    throw new Error(`ACL efetiva de ${label} não comprovada.`);
  }
  const actual = new Set(evidence.principals);
  if (actual.size !== expectedPrincipals.size ||
      [...actual].some(principal => !expectedPrincipals.has(principal))) {
    throw new Error(`ACL de ${label} contém principals ausentes ou não autorizados.`);
  }
}

function validateFairBootstrapPlan(plan) {
  if (!plan || plan.serviceName !== SERVICE_NAME ||
      plan.serviceStartMode !== 'manual' || plan.autoStart !== false ||
      plan.serviceExists !== false) {
    throw new Error('Serviço Feira deve ser exclusivo e configurado para início manual.');
  }
  if (Number(plan.port) !== 3307 || plan.bindAddress !== '127.0.0.1' ||
      plan.mysqlxEnabled !== false) {
    throw new Error('Configuração de rede MySQL Feira não corresponde ao destino isolado.');
  }
  if (plan.datadirExists !== false || plan.bootstrapConfigExists !== false ||
      plan.bootstrapSecretDirectoryExists !== false || plan.bootstrapErrorLogExists !== false) {
    throw new Error('Serviço, configuração, log e datadir devem ser novos antes do bootstrap.');
  }
  if (plan.mysqlTlsReady !== true) {
    throw new Error('TLS MySQL deve estar preparado antes do primeiro início do serviço.');
  }

  const repo = normalizedWindowsPath(plan.repositoryPath);
  const datadir = normalizedWindowsPath(plan.datadir);
  const runtimeLogs = normalizedWindowsPath(plan.runtimeLogsDirectory);
  const bootstrapLogs = normalizedWindowsPath(plan.bootstrapSecretDirectory);
  const config = normalizedWindowsPath(plan.bootstrapConfig);
  const errorLog = normalizedWindowsPath(plan.bootstrapErrorLog);
  const executable = normalizedWindowsPath(plan.mysqldPath);

  if ([datadir, runtimeLogs, bootstrapLogs, config, errorLog]
    .some(candidate => isWithin(repo, candidate)) || isWithin(repo, executable)) {
    throw new Error('Configuração, datadir e logs devem permanecer fora do repositório.');
  }
  if (path.win32.basename(executable).toLowerCase() !== 'mysqld.exe') {
    throw new Error('Executável deve ser o mysqld.exe aprovado.');
  }
  if (isWithin(datadir, errorLog) || isWithin(runtimeLogs, errorLog) ||
      !isWithin(bootstrapLogs, errorLog)) {
    throw new Error('Log de senha temporária deve ficar exclusivamente no diretório protegido de bootstrap.');
  }
  if (isWithin(datadir, config) || isWithin(runtimeLogs, config) ||
      isWithin(bootstrapLogs, config)) {
    throw new Error('Configuração MySQL deve ser exclusiva e separada dos diretórios de dados/logs.');
  }

  assertDisjointDirectories([
    { name: 'datadir', path: datadir },
    { name: 'logs-runtime', path: runtimeLogs },
    { name: 'logs-bootstrap', path: bootstrapLogs }
  ]);

  const operator = plan.bootstrapOperator;
  if (typeof operator !== 'string' || !operator || TRUSTED_PRINCIPALS.has(operator) ||
      operator === SERVICE_IDENTITY) {
    throw new Error('Identidade do operador de bootstrap deve ser informada e individual.');
  }
  assertAcl(plan.acls?.datadir, new Set([...TRUSTED_PRINCIPALS, SERVICE_IDENTITY]), 'datadir');
  assertAcl(plan.acls?.runtimeLogs, new Set([...TRUSTED_PRINCIPALS, SERVICE_IDENTITY]), 'logs de runtime');
  assertAcl(plan.acls?.bootstrapSecret, new Set([...TRUSTED_PRINCIPALS, operator]), 'log secreto do bootstrap');
  assertAcl(plan.acls?.configuration, new Set([...TRUSTED_PRINCIPALS, SERVICE_IDENTITY]), 'configuração');

  return Object.freeze({
    executable: false,
    serviceName: SERVICE_NAME,
    serviceStartMode: 'manual',
    initializeCommand: `"${executable}" --defaults-file="${config}" --initialize`,
    requiresSeparateAuthorization: ['initialize', 'register-service', 'start-service'],
    startsService: false,
    createsDatabaseOrUsers: false
  });
}

function safeBootstrapLog(event) {
  const safe = {
    phase: LOG_PHASES.has(event?.phase) ? event.phase : 'unknown',
    status: LOG_STATUSES.has(event?.status) ? event.status : 'unknown'
  };
  if (Number.isInteger(event?.exitCode)) safe.exitCode = event.exitCode;
  if (typeof event?.timestamp === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(event.timestamp)) {
    safe.timestamp = event.timestamp;
  }
  return JSON.stringify(safe);
}

module.exports = {
  SERVICE_NAME,
  SERVICE_IDENTITY,
  validateFairBootstrapPlan,
  safeBootstrapLog
};
