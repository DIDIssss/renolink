'use strict';

const net = require('node:net');
const tls = require('node:tls');
const { X509Certificate } = require('node:crypto');

function checkMysqlServerIdentity(host, certificate) {
  if (typeof tls.checkServerIdentity !== 'function') {
    return new Error('Verificador de identidade TLS indisponível.');
  }
  if (typeof host !== 'string' || !host || !certificate || !certificate.raw) {
    return new Error('Certificado ou identidade TLS do MySQL ausente.');
  }

  if (net.isIP(host)) {
    let subjectAltName;
    try {
      subjectAltName = new X509Certificate(certificate.raw).subjectAltName;
    } catch {
      return new Error('Certificado TLS do MySQL inválido.');
    }

    const ipSan = new RegExp(
      `(?:^|,\\s*)IP Address:${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:,|$)`
    );
    if (typeof subjectAltName !== 'string' || !ipSan.test(subjectAltName)) {
      return new Error('Certificado TLS do MySQL não contém o SAN IP esperado.');
    }
  }

  try {
    return tls.checkServerIdentity(host, certificate);
  } catch {
    return new Error('Não foi possível verificar a identidade TLS do MySQL.');
  }
}

module.exports = { checkMysqlServerIdentity };
