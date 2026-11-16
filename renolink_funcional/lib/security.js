'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const cryptoQueue = require('./crypto-queue');
const SESSION_MS = 8 * 60 * 60 * 1000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const started=performance.now();
  const key = await cryptoQueue.run(()=>scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }));
  require('node:diagnostics_channel').channel('renolink.hash.timing').publish(performance.now()-started);
  return { salt, passwordHash: `scrypt$32768$8$3$${key.toString('hex')}` };
}
async function verifyPassword(password, user) {
  if (user.passwordHash.startsWith('scrypt$')) {
    if (!/^scrypt\$32768\$8\$3\$[a-f0-9]{128}$/.test(user.passwordHash)) return false;
    return equal((await passwordHash(password, user.salt)).passwordHash, user.passwordHash);
  }
  return /^[a-f0-9]{64}$/.test(user.passwordHash) && equal(digest(`${user.salt}:${password}`), user.passwordHash);
}
// Expensive scrypt runs before the write transaction. The proof is request-local
// and accepted only if the account credentials still match the committed row.
async function prepareAuthentication(req, store) {
  const data=req.data, password=typeof data.password==='string'?data.password:'';
  const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
  if(!validEmail(email)||!password||password.length>128)return;
  if(req.authAttempt==='register') {
    if(password.length>=10)req.preparedPassword=await passwordHash(password);
  } else if(req.authAttempt==='login') {
    const lookupStarted=performance.now();
    const user=store.credentials?await store.credentials(email):await store.transaction(db=>{const row=db.users.find(u=>u.email===email);return row?{id:row.id,passwordHash:row.passwordHash,salt:row.salt}:null;});
    require('node:diagnostics_channel').channel('renolink.auth.lookup').publish(performance.now()-lookupStarted);
    const valid=user?await verifyPassword(password,user):(await passwordHash(password,'renolink-dummy-password-salt'),false);
    req.authenticationProof={user,valid};
    // Preserve the old proof. A changed credential must still fail revalidation
    // inside the transaction; never overwrite a concurrent password change.
    if(valid&&!user.passwordHash.startsWith('scrypt$'))req.preparedPasswordUpgrade=await passwordHash(password);
  }
}
async function verifyRequestPassword(req,password,user) {
  if(req.authenticationProof){const proof=req.authenticationProof;return !!(proof.valid&&user&&proof.user&&proof.user.id===user.id&&proof.user.passwordHash===user.passwordHash&&proof.user.salt===user.salt);}
  return user?verifyPassword(password,user):(await passwordHash(password,'renolink-dummy-password-salt'),false);
}
function sessionToken(req) {
  const cookie = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('renolink_session='));
  const value = cookie ? cookie.slice('renolink_session='.length) : '';
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}
function issueSession(req, db) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session = { tokenHash: digest(token), userId: req.userId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_MS).toISOString(), revokedAt: null };
  db.sessions.push(session);
  return { session, cookie: cookieValue(token, SESSION_MS / 1000) };
}
function cookieValue(token, age) {
  return `renolink_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`;
}
function auth(req, db) {
  const token = sessionToken(req);
  if (!token) return null;
  const session = db.sessions.find(s => s.tokenHash === digest(token) && !s.revokedAt && Date.parse(s.expiresAt) > Date.now());
  const user = session && db.users.find(u => u.id === session.userId);
  return user ? { session, user } : null;
}
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, company: user.company, createdAt: user.createdAt };
}
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(value);
function text(value, min, max, label) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw fail(400, `${label}: informe entre ${min} e ${max} caracteres.`);
  return value.trim();
}
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Origem não permitida.');
  if (!req.headers.origin) return;
  const expected = process.env.APP_ORIGIN || `http://${req.headers.host}`;
  if (req.headers.origin !== expected) throw fail(403, 'Origem não permitida.');
}
function limiter() {
  const entries = new Map();
  const consume = (key, limit, windowMs) => {
    const now = Date.now();
    for (const [k, entry] of entries) if (entry.until <= now) entries.delete(k);
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= 10000) throw fail(429, 'Muitas solicitações. Tente novamente mais tarde.');
      entries.set(key, entry = { count: 0, until: now + windowMs });
    }
    if (++entry.count > limit) throw fail(429, 'Muitas solicitações. Tente novamente mais tarde.');
  };
  consume.check = (key,limit) => {
    const entry=entries.get(key);
    if(entry&&entry.until>Date.now()&&entry.count>=limit)throw fail(429,'Muitas solicitações. Tente novamente mais tarde.');
  };
  return consume;
}
module.exports = { passwordHash, verifyPassword, prepareAuthentication, verifyRequestPassword, digest, fail, sessionToken, issueSession, cookieValue, auth, publicUser, validEmail, text, sameOrigin, limiter };
