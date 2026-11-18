'use strict';
// Offline planner only. Never imports a driver, reads JSON originals or connects.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
function plan(){
 const files=['001_initial.sql','002_phase5.sql'];
 const sources=files.map(name=>fs.readFileSync(path.join(__dirname,'../database/mysql',name),'utf8').replace(/\r\n/g,'\n'));
 const statements=sources.flatMap(text=>text.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean));
 const tables=statements.map(sql=>{
  const match=/^CREATE TABLE IF NOT EXISTS (renolink_[a-z_]+)\s*\(/.exec(sql);
  if(!match||/\b(DROP|TRUNCATE|DELETE|ALTER|GRANT|REVOKE)\b/i.test(sql.replace(/ON DELETE RESTRICT/g,'')))throw Error('SQL fora do escopo de criacao revisado.');
  return match[1];
 });
 if(tables.length!==12||new Set(tables).size!==12)throw Error('Conjunto de tabelas divergente.');
 const meta=require('../lib/phase5-data').initialize({meta:{schemaVersion:1,nextUserId:1,nextIdeaId:1,nextMessageId:1,nextNegotiationId:1},users:[],ideas:[],messages:[],negotiations:[],sessions:[]}).meta;
 meta.phase5MigrationHash=createHash('sha256').update(sources[1]).digest('hex');
 const guard=tables.map(name=>`NOT EXISTS (SELECT 1 FROM ${name})`).join('\n AND ');
 const bootstrap=`INSERT INTO renolink_meta (id,payload)\nSELECT 1, '${JSON.stringify(meta)}'\nWHERE ${guard}`;
 return {schemaVersion:5,meta,tables,statements:[...statements,bootstrap],sql:[...statements,bootstrap,'SELECT JSON_EXTRACT(payload, \'$.schemaVersion\') AS schema_version FROM renolink_meta WHERE id=1'].join(';\n\n')+';\n'};
}
if(require.main===module){
 try{
  if(process.argv.length!==3||!['--check','--sql'].includes(process.argv[2]))throw Error('Use --check ou --sql.');
  const result=plan();
  if(process.argv[2]==='--sql')process.stdout.write(result.sql);
  else console.log(JSON.stringify({mode:'offline-plan-only',schemaVersion:result.schemaVersion,tables:result.tables,statements:result.statements.length,sqlSha256:createHash('sha256').update(result.sql).digest('hex'),connected:false}));
 }catch{console.error('Plano Render recusado. Nenhuma conexao ou migracao executada.');process.exitCode=1;}
}
module.exports={plan};
