'use strict';
const hosting=require('./hosting'),mysql=require('./mysql');
function configuration(env=process.env){
 const p=hosting.policy(env);
 if(!p.production||env.APP_ENV!=='staging'||env.MYSQL_DATABASE!=='renolink_staging'||env.MYSQL_USER!=='renolink_staging_app')throw Error('Homologacao exige ambiente, banco e conta exclusivos.');
 if(!Number.isInteger(Number(env.PORT))||Number(env.PORT)<1024||Number(env.PORT)>65535)throw Error('PORT de homologacao invalida.');
 if(/(?:\.invalid|\.example)$/.test(new URL(p.origin).hostname))throw Error('Substitua a origem de exemplo pela origem autorizada.');
 return {policy:p,mysql:mysql.config(env)};
}
async function diagnose(options){
 const pool=mysql.pool(options);
 try{const [[identity]]=await pool.query('SELECT DATABASE() AS db, CURRENT_USER() AS account, VERSION() AS version');mysql.assertVersion(identity.version);
 if(identity.db!=='renolink_staging'||identity.account.split('@')[0]!=='renolink_staging_app')throw Error('Identidade de homologacao divergente.');
 const [tls]=await pool.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");if(!tls[0]?.Value)throw Error('TLS MySQL nao confirmado.');
 const [[settings]]=await pool.query('SELECT @@GLOBAL.partial_revokes AS partialRevokes');const [grants]=await pool.query('SHOW GRANTS FOR CURRENT_USER');verifyGrants(grants.map(row=>Object.values(row)[0]),Number(settings.partialRevokes)===1);
 const [tables]=await pool.query('SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE()');
 const required=['meta','imports','users','ideas','messages','negotiations','sessions','staff','audit','conversations','support_messages','requests'].map(n=>'renolink_'+n);if(tables.length!==required.length||tables.some(t=>!required.includes(t.name)||t.engine!=='InnoDB'))throw Error('Estrutura de homologacao divergente.');
 const store=mysql.mysqlStore(options);try{if(!await store.health())throw Error('Schema de homologacao incompleto.');}finally{await store.close();}
 return {ok:true,database:'renolink_staging',mysqlVersion:identity.version,tls:true,privilegesReviewed:true};
 }finally{await pool.end();}
}
function verifyGrants(grants,partialRevokes){
 const names=['meta','imports','users','ideas','messages','negotiations','sessions','staff','audit','conversations','support_messages','requests'].map(n=>'renolink_'+n),allowed=Object.fromEntries(names.map(n=>[n,new Set(n==='renolink_staff'||n==='renolink_imports'?['SELECT']:n==='renolink_audit'?['SELECT','INSERT']:['SELECT','INSERT','UPDATE'])])),seen=Object.fromEntries(names.map(n=>[n,new Set()])),scope=partialRevokes?'`renolink_staging`':'`renolink\\_staging`';
 for(const sql of grants){
  if(/WITH GRANT OPTION/.test(sql))throw Error('GRANT OPTION nao autorizado.');if(/^GRANT USAGE ON \*\.\* TO /.test(sql))continue;
  const match=/^GRANT (.+) ON (`[^`]+`)\.(\*|`[^`]+`) TO /.exec(sql);if(!match||match[2]!==((match[3]==='*')?scope:'`renolink_staging`'))throw Error('Escopo de runtime fora do plano.');const targets=match[3]==='*'?names:[match[3].slice(1,-1)];
  for(const target of targets)for(const p of match[1].split(', ')){if(!allowed[target]?.has(p))throw Error('Privilegios de runtime fora do plano.');seen[target].add(p);}
 }
 if(names.some(n=>seen[n].size!==allowed[n].size))throw Error('Privilegios necessarios incompletos.');
 return true;
}
module.exports={configuration,diagnose,verifyGrants};
