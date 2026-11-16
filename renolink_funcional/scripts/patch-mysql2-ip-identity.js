'use strict';

const fs = require('node:fs');
const path = require('node:path');

const packagePath = require.resolve('mysql2/package.json');
const installed = require(packagePath);
if (installed.version !== '3.24.6') {
  throw new Error(`Patch TLS requer mysql2 3.24.6; encontrado ${installed.version}.`);
}

const connectionPath = path.join(path.dirname(packagePath), 'lib', 'base', 'connection.js');
const source = fs.readFileSync(connectionPath, 'utf8');
const marker = 'const identityCheck = this.config.ssl.checkServerIdentity;';
const finalTlsOptions = `        checkServerIdentity: verifyIdentity
          ? identityCheck && Net.isIP(this.config.host)
            ? function () {
                return undefined;
              }
            : identityCheck || Tls.checkServerIdentity
          : function () {
              return undefined;
            },`;

if (source.includes(marker) && source.includes(finalTlsOptions)) {
  process.stdout.write('mysql2 TLS IP identity patch already applied.\n');
  process.exit(0);
}

const originalTlsSetup = `    const verifyIdentity = this.config.ssl.verifyIdentity;
    const servername = Net.isIP(this.config.host)
      ? undefined
      : this.config.host;`;
const patchedTlsSetup = `    const verifyIdentity = this.config.ssl.verifyIdentity;
    const identityCheck = this.config.ssl.checkServerIdentity;
    const servername = Net.isIP(this.config.host)
      ? undefined
      : this.config.host;`;

const originalTlsOptions = `        checkServerIdentity: verifyIdentity
          ? Tls.checkServerIdentity
          : function () {
              return undefined;
            },`;
const previousTlsOptions = `        checkServerIdentity: verifyIdentity
          ? identityCheck || Tls.checkServerIdentity
          : function () {
              return undefined;
            },`;

const originalIdentityBlock = `        if (rejectUnauthorized && !secureSocket.isSessionReused()) {
          if (typeof servername === 'string' && verifyIdentity) {
            const cert = secureSocket.getPeerCertificate(true);
            const serverIdentityCheckError = Tls.checkServerIdentity(
              servername,
              cert
            );
            if (serverIdentityCheckError) {
              sessionSlot.delete();
              onSecure(serverIdentityCheckError);
              return;
            }
          }
        }`;
const patchedIdentityBlock = `        if (rejectUnauthorized && identityCheck) {
          if (!verifyIdentity || typeof identityCheck !== 'function') {
            sessionSlot.delete();
            onSecure(new Error('MySQL TLS identity verifier is unavailable.'));
            return;
          }
          const cert = secureSocket.getPeerCertificate(true);
          let serverIdentityCheckError;
          try {
            serverIdentityCheckError = identityCheck(this.config.host, cert);
          } catch (error) {
            serverIdentityCheckError = error;
          }
          if (serverIdentityCheckError) {
            sessionSlot.delete();
            onSecure(serverIdentityCheckError);
            return;
          }
        } else if (rejectUnauthorized && !secureSocket.isSessionReused()) {
          if (typeof servername === 'string' && verifyIdentity) {
            const cert = secureSocket.getPeerCertificate(true);
            const serverIdentityCheckError = Tls.checkServerIdentity(
              servername,
              cert
            );
            if (serverIdentityCheckError) {
              sessionSlot.delete();
              onSecure(serverIdentityCheckError);
              return;
            }
          }
        }`;

for (const [before, description] of [
  [source.includes(marker) ? patchedTlsSetup : originalTlsSetup, 'TLS identity hook'],
  [source.includes(marker) ? patchedIdentityBlock : originalIdentityBlock, 'post-handshake identity check']
]) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Unexpected mysql2 3.24.6 source; cannot apply ${description} patch.`);
  }
}

let patched = source;
if (patched.includes(originalTlsSetup)) {
  patched = patched.replace(originalTlsSetup, patchedTlsSetup);
}
if (patched.includes(originalTlsOptions)) {
  patched = patched.replace(originalTlsOptions, finalTlsOptions);
} else if (patched.includes(previousTlsOptions)) {
  patched = patched.replace(previousTlsOptions, finalTlsOptions);
} else {
  throw new Error('Unexpected mysql2 3.24.6 source; cannot apply TLS options patch.');
}
patched = patched.replace(originalIdentityBlock, patchedIdentityBlock);
fs.writeFileSync(connectionPath, patched);
process.stdout.write('Applied mysql2 TLS IP identity patch.\n');
