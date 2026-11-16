'use strict';
// Privileged local operation. Never wired to an HTTP route.
const os = require('node:os');
const mysql = require('./mysql');
const { stable } = require('./data');
const { digest } = require('./security');
function deny() { throw Error('Operacao administrativa local recusada.'); }
function checkTarget(options, testApproved) {
  if (options.host !== '127.0.0.1' || options.port !== 3306) deny();
  const dev = testApproved === false && options.database === 'renolink_dev' && options.user === 'renolink_migrator';
  const test = testApproved === true && options.database === 'renolink_test' && options.user === 'renolink_tester';
  if (!dev && !test) deny();
}
function fingerprint(user) {
  return digest(stable({ id:user.id, name:user.name, email:user.email, role:user.role, company:user.company, createdAt:user.createdAt, salt:user.salt, passwordHash:user.passwordHash }));
}
function candidate(db, id) {
  if (db.meta.schemaVersion !== 5) deny();
  const user = db.users.find(u => u.id === id);
  if (!user || db.staff.some(s => s.userId === id)) deny();
  return { id:user.id, name:user.name, email:user.email, role:user.role, createdAt:user.createdAt, fingerprint:fingerprint(user) };
}
async function operation(options, testApproved, fn) {
  checkTarget(options,testApproved);
  const pool = mysql.pool(options);
  try {
    return await mysql.transaction(pool, async client => {
      const [[identity]] = await client.execute('SELECT CURRENT_USER() AS account, DATABASE() AS db');
      if (identity.account !== options.user + '@127.0.0.1' || identity.db !== options.database) deny();
      const db = await mysql.load(client);
      if (db.meta.schemaVersion !== 5) deny();
      return fn(client,db,identity);
    });
  } finally { await pool.end(); }
}
async function listCandidates({ options, testApproved=false }) {
  return operation(options,testApproved,async(client,db) => ({ database:options.database,
    activeAdministrators:db.staff.filter(s=>s.active === 1 && s.accessRole === 'admin').length,
    users:db.users.filter(u=>!db.staff.some(s=>s.userId === u.id)).map(u=>candidate(db,u.id)) }));
}
async function grantAdministrator({ options, testApproved=false, approved=false, confirmation }) {
  if (approved !== true || !confirmation || !Number.isSafeInteger(confirmation.userId) || confirmation.userId < 1) deny();
  return operation(options,testApproved,async(client,db,identity) => {
    const selected = candidate(db,confirmation.userId);
    const phrase = `CONCEDER ADMIN ${selected.id} EM ${options.database}`;
    if (confirmation.email !== selected.email || confirmation.name !== selected.name || confirmation.fingerprint !== selected.fingerprint || confirmation.phrase !== phrase) deny();
    const timestamp = new Date().toISOString();
    const staff = { userId:selected.id, accessRole:'admin', active:1, createdAt:timestamp };
    const event = { id:db.meta.nextAuditId++, actorId:selected.id, action:'staff.provision', targetType:'staff', targetId:selected.id,
      detail:`Concessao ADMIN confirmada por operador local via ${identity.account}; o usuario beneficiario nao iniciou esta acao.`,
      createdAt:timestamp, initiator:'local-operator', databaseAccount:identity.account, localOperator:os.userInfo().username };
    db.staff.push(staff); db.audit.push(event);
    await client.execute('INSERT INTO renolink_staff(user_id,access_role,active,created_at,extra) VALUES (?,?,?,?,?)', [staff.userId,staff.accessRole,staff.active,new Date(timestamp),'{}']);
    await client.execute('INSERT INTO renolink_audit(id,actor_id,action,target_type,target_id,detail,created_at,extra) VALUES (?,?,?,?,?,?,?,?)',
      [event.id,event.actorId,event.action,event.targetType,event.targetId,event.detail,new Date(timestamp),JSON.stringify({initiator:event.initiator,databaseAccount:event.databaseAccount,localOperator:event.localOperator})]);
    await client.execute('UPDATE renolink_meta SET payload=? WHERE id=1',[JSON.stringify(db.meta)]);
    mysql.verify(db,await mysql.load(client));
    return { userId:selected.id, accessRole:'admin', auditId:event.id, database:options.database, historicalRowsUnchanged:true };
  });
}
module.exports = { listCandidates, grantAdministrator };
