'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { digest } = require('./security');
const collections = ['users', 'ideas', 'messages', 'negotiations', 'sessions'];
const stable = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
function validate(db) {
  if (!db.meta || collections.some(k => !Array.isArray(db[k]))) throw Error('Estrutura do banco inválida.');
  const sets = {};
  for (const key of collections.filter(k => k !== 'sessions')) {
    sets[key] = new Set();
    for (const row of db[key]) {
      if (!Number.isSafeInteger(row.id) || row.id < 1 || sets[key].has(row.id)) throw Error(`IDs inválidos em ${key}.`);
      sets[key].add(row.id);
      if (!Number.isFinite(Date.parse(row.createdAt)) || ('updatedAt' in row && !Number.isFinite(Date.parse(row.updatedAt)))) throw Error(`Data inválida em ${key}.`);
    }
  }
  const emails = new Set();
  for (const u of db.users) {
    if (typeof u.email !== 'string' || emails.has(u.email.trim().toLowerCase()) || !['creator', 'company'].includes(u.role) || typeof u.passwordHash !== 'string' || typeof u.salt !== 'string') throw Error('Usuários inválidos ou duplicados.');
    emails.add(u.email.trim().toLowerCase());
  }
  const ref = (set, id) => { if (!sets[set].has(id)) throw Error(`Relacionamento inválido: ${set}.`); };
  for (const i of db.ideas) if (i.userId !== null) ref('users', i.userId);
  const pairs = new Set();
  for (const n of db.negotiations) {
    ref('ideas', n.ideaId); ref('users', n.creatorUserId); ref('users', n.companyUserId);
    if (db.ideas.find(i => i.id === n.ideaId).userId !== n.creatorUserId || db.users.find(u => u.id === n.creatorUserId).role !== 'creator' || db.users.find(u => u.id === n.companyUserId).role !== 'company') throw Error('Participantes inválidos na negociação.');
    const pair = `${n.ideaId}:${n.companyUserId}`;
    if (pairs.has(pair)) throw Error('Negociação duplicada.');
    pairs.add(pair);
  }
  for (const m of db.messages) { ref('users', m.fromUserId); ref('users', m.toUserId); }
  const tokens = new Set();
  for (const s of db.sessions) {
    ref('users', s.userId);
    const token = s.tokenHash || (typeof s.token === 'string' ? digest(s.token) : '');
    if (!/^[a-f0-9]{64}$/.test(token) || tokens.has(token)) throw Error('Sessão inválida ou duplicada.');
    tokens.add(token);
    if (!Number.isFinite(Date.parse(s.createdAt)) || (s.expiresAt && !Number.isFinite(Date.parse(s.expiresAt))) || (s.revokedAt && !Number.isFinite(Date.parse(s.revokedAt)))) throw Error('Data de sessão inválida.');
  }
  for (const [key, counter] of Object.entries({ users: 'nextUserId', ideas: 'nextIdeaId', messages: 'nextMessageId', negotiations: 'nextNegotiationId' })) {
    if (!Number.isSafeInteger(db.meta[counter]) || db.meta[counter] <= Math.max(0, ...sets[key])) throw Error(`Contador inválido: ${counter}.`);
  }
  require('./phase5-data').validate(db);
  return db;
}
function backup(source, directory) {
  const bytes = fs.readFileSync(source);
  validate(JSON.parse(bytes.toString('utf8')));
  const sha256 = digest(bytes);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `db-${sha256}.json`);
  try { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (digest(fs.readFileSync(file)) !== sha256) throw Error('Falha de verificação do backup.');
  const manifest = { sha256, bytes: bytes.length, file: path.basename(file), counts: Object.fromEntries(collections.map(k => [k, JSON.parse(bytes)[k].length])) };
  const manifestFile = file + '.manifest.json';
  try { fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (stable(JSON.parse(fs.readFileSync(manifestFile, 'utf8'))) !== stable(manifest)) throw Error('Manifesto de backup inválido.');
  return { ...manifest, path: file };
}
function safeSessions(db) {
  // Sessões antigas são preservadas como registros revogados, sem token bruto.
  for (const s of db.sessions) {
    if (s.token) { s.tokenHash = digest(s.token); delete s.token; s.revokedAt = s.revokedAt || s.createdAt; }
    if (!s.expiresAt) s.expiresAt = s.createdAt;
    if (!s.revokedAt) s.revokedAt = null;
  }
  return db;
}
function writeAtomic(file, db) {
  const temp = file + `.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(validate(db), null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function localStore({ source, file, backupDir }) {
  if (path.resolve(source).toLowerCase() === path.resolve(file).toLowerCase() || (fs.existsSync(file) && fs.realpathSync(source).toLowerCase() === fs.realpathSync(file).toLowerCase())) throw Error('O banco original não pode ser usado como banco de execução.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Bloqueio exclusivo de processo; nunca remover automaticamente um lock existente.
  const lock = file + '.lock';
  const fd = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(fd, String(process.pid));
  const close = () => { if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock); };
  fs.closeSync(fd);
  try {
    if (!fs.existsSync(file)) {
      const verified = backup(source, backupDir);
      writeAtomic(file, safeSessions(JSON.parse(fs.readFileSync(verified.path, 'utf8'))));
    }
    validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) { close(); throw e; }
  let queue = Promise.resolve();
  return {
    async transaction(fn) {
      const operation = queue.then(async () => {
        const db = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
        const before = stable(db);
        const result = await fn(db);
        validate(db);
        if (stable(db) !== before) writeAtomic(file, db);
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    },
    close,
    file
  };
}
module.exports = { validate, backup, safeSessions, localStore, stable, collections };
