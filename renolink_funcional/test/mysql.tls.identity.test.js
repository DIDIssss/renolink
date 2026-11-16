'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');
const { X509Certificate } = require('node:crypto');
const mysql2 = require('mysql2/promise');
const { checkMysqlServerIdentity } = require('../lib/mysql-tls-identity');
const { config } = require('../lib/mysql');

const fixtureDirectory = path.join(__dirname, 'fixtures', 'mysql-tls');
const readFixture = name => fs.readFileSync(path.join(fixtureDirectory, name));
const ca = readFixture('ca.pem');

function certificate(name) {
  const parsed = new X509Certificate(readFixture(name));
  return {
    raw: parsed.raw,
    subject: parsed.subject,
    subjectaltname: parsed.subjectAltName
  };
}

function mysqlPacket(sequence, payload) {
  const header = Buffer.alloc(4);
  header.writeUIntLE(payload.length, 0, 3);
  header.writeUInt8(sequence, 3);
  return Buffer.concat([header, payload]);
}

function mysqlGreeting() {
  const capabilities = 0x00000001 | 0x00000004 | 0x00000200 |
    0x00000800 | 0x00008000 | 0x00080000;
  const payload = Buffer.alloc(1 + 1 + Buffer.byteLength('8.0.46-test') + 1 + 4 + 8 + 1 + 2 + 1 + 2 + 2 + 1 + 10 + 13 + Buffer.byteLength('mysql_native_password') + 1);
  let offset = 0;
  payload.writeUInt8(10, offset++);
  offset += payload.write('8.0.46-test', offset, 'ascii');
  payload.writeUInt8(0, offset++);
  payload.writeUInt32LE(7, offset);
  offset += 4;
  Buffer.from('12345678').copy(payload, offset);
  offset += 8;
  payload.writeUInt8(0, offset++);
  payload.writeUInt16LE(capabilities & 0xffff, offset);
  offset += 2;
  payload.writeUInt8(45, offset++);
  payload.writeUInt16LE(2, offset);
  offset += 2;
  payload.writeUInt16LE(capabilities >>> 16, offset);
  offset += 2;
  payload.writeUInt8(21, offset++);
  offset += 10;
  Buffer.from('abcdefghijkl').copy(payload, offset);
  offset += 12;
  payload.writeUInt8(0, offset++);
  offset += payload.write('mysql_native_password', offset, 'ascii');
  payload.writeUInt8(0, offset);
  return mysqlPacket(0, payload);
}

function createTlsMysqlServer(pairName) {
  const secureContext = tls.createSecureContext({
    key: readFixture(`${pairName}.key.pem`),
    cert: readFixture(`${pairName}.cert.pem`)
  });
  let authResponseReceived = false;
  let serverError;
  let sslRequestReceived = false;
  let tlsHandshakeCompleted = false;
  const server = net.createServer(socket => {
    socket.write(mysqlGreeting());
    let pending = Buffer.alloc(0);

    const onPlainData = data => {
      pending = Buffer.concat([pending, data]);
      if (pending.length < 4) return;
      const payloadLength = pending.readUIntLE(0, 3);
      if (pending.length < payloadLength + 4) return;
      const packet = pending.subarray(4, payloadLength + 4);
      socket.removeListener('data', onPlainData);
      if (packet.length !== 32) {
        serverError = new Error('Expected MySQL SSLRequest packet.');
        socket.destroy();
        return;
      }
      sslRequestReceived = true;
      socket.pause();
      const remainder = pending.subarray(payloadLength + 4);
      if (remainder.length) socket.unshift(remainder);

      const secureSocket = new tls.TLSSocket(socket, {
        isServer: true,
        secureContext
      });
      secureSocket.on('error', error => {
        if (!serverError) serverError = error;
      });
      secureSocket.on('secure', () => {
        tlsHandshakeCompleted = true;
        let securePending = Buffer.alloc(0);
        secureSocket.on('data', secureData => {
          securePending = Buffer.concat([securePending, secureData]);
          if (securePending.length < 4) return;
          const length = securePending.readUIntLE(0, 3);
          if (securePending.length < length + 4) return;
          const sequence = securePending.readUInt8(3);
          authResponseReceived = true;
          secureSocket.write(mysqlPacket(sequence + 1, Buffer.from([0, 0, 0, 2, 0, 0, 0])));
        });
      });
    };

    socket.on('data', onPlainData);
    socket.on('error', error => {
      if (error.code !== 'ECONNRESET' && !serverError) serverError = error;
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve({
        port: server.address().port,
        get authResponseReceived() { return authResponseReceived; },
        get sslRequestReceived() { return sslRequestReceived; },
        get tlsHandshakeCompleted() { return tlsHandshakeCompleted; },
        get error() { return serverError; },
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done()))
      });
    });
  });
}

async function attemptConnection(pairName, { trustedCa = ca, verifier = checkMysqlServerIdentity } = {}) {
  const server = await createTlsMysqlServer(pairName);
  let connection;
  try {
    connection = await mysql2.createConnection({
      host: '127.0.0.1',
      port: server.port,
      user: 'synthetic-test',
      password: 'synthetic-password',
      connectTimeout: 3000,
      ssl: {
        ca: trustedCa,
        rejectUnauthorized: true,
        verifyIdentity: true,
        checkServerIdentity: verifier
      }
    });
    return { connected: true, server };
  } catch (error) {
    return { connected: false, error, server };
  } finally {
    if (connection) await connection.end();
    await server.close();
  }
}

test('Fair MySQL profile installs strict TLS IP-SAN verification without changing other profiles', () => {
  const caPath = path.join(fixtureDirectory, 'ca.pem');
  const env = {
    APP_ENV: 'fair',
    NODE_ENV: 'production',
    MYSQL_HOST: '127.0.0.1',
    MYSQL_PORT: '3307',
    MYSQL_DATABASE: 'renolink_feira',
    MYSQL_USER: 'renolink_feira_app',
    MYSQL_PASSWORD: 'synthetic-only',
    MYSQL_SSL: '1',
    MYSQL_SSL_CA: caPath,
    RENOLINK_FAIR_MYSQL_SERVER_UUID: '11111111-1111-4111-8111-111111111111'
  };
  const fair = config(env);
  assert.equal(fair.ssl.rejectUnauthorized, true);
  assert.equal(fair.ssl.verifyIdentity, true);
  assert.equal(fair.ssl.checkServerIdentity, checkMysqlServerIdentity);

  const existing = config({
    NODE_ENV: 'production',
    MYSQL_HOST: 'mysql.example.test',
    MYSQL_DATABASE: 'renolink_prod',
    MYSQL_USER: 'app',
    MYSQL_PASSWORD: 'synthetic-only',
    MYSQL_SSL: '1',
    MYSQL_SSL_CA: caPath
  });
  assert.equal(existing.ssl.checkServerIdentity, undefined);
  assert.equal(existing.ssl.rejectUnauthorized, true);
});

test('Identity helper accepts only matching IP SAN and fails closed if verification is unavailable', () => {
  assert.equal(checkMysqlServerIdentity('127.0.0.1', certificate('valid.cert.pem')), undefined);
  assert.match(checkMysqlServerIdentity('127.0.0.1', certificate('wrong-ip.cert.pem')).message, /SAN IP esperado/);
  assert.match(checkMysqlServerIdentity('127.0.0.1', certificate('no-ip-san.cert.pem')).message, /SAN IP esperado/);
  assert.match(checkMysqlServerIdentity('127.0.0.1', null).message, /Certificado ou identidade/);

  const original = tls.checkServerIdentity;
  try {
    tls.checkServerIdentity = undefined;
    assert.match(checkMysqlServerIdentity('127.0.0.1', certificate('valid.cert.pem')).message, /indisponível/);
  } finally {
    tls.checkServerIdentity = original;
  }
});

test('mysql2 performs real TLS chain, validity, and IP identity checks before sending auth response', async t => {
  const cases = [
    { pair: 'valid', accept: true },
    { pair: 'wrong-ip', accept: false },
    { pair: 'no-ip-san', accept: false },
    { pair: 'untrusted', accept: false },
    { pair: 'expired', accept: false }
  ];

  for (const scenario of cases) {
    await t.test(scenario.pair, async () => {
      const result = await attemptConnection(scenario.pair);
      assert.equal(
        result.connected,
        scenario.accept,
        `${result.error?.message}; sslRequest=${result.server.sslRequestReceived}; tls=${result.server.tlsHandshakeCompleted}; serverError=${result.server.error?.message}`
      );
      assert.equal(result.server.authResponseReceived, scenario.accept);
    });
  }
});

test('mysql2 fails closed when the configured identity verifier cannot execute', async () => {
  const noVerifier = () => new Error('TLS identity verifier unavailable for test.');
  const result = await attemptConnection('valid', { verifier: noVerifier });
  assert.equal(result.connected, false);
  assert.match(result.error.message, /identity verifier unavailable/);
  assert.equal(result.server.authResponseReceived, false);
});
