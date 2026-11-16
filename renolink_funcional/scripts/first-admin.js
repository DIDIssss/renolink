'use strict';
const mysql = require('../lib/mysql');
const { listCandidates, grantAdministrator } = require('../lib/staff-provision');
async function main() {
  if (process.env.RENOLINK_FIRST_ADMIN_OPERATOR !== '1') throw Error();
  const options=mysql.config();
  if (options.database !== 'renolink_dev' || options.user !== 'renolink_migrator') throw Error();
  const mode=process.argv[2];
  if (process.argv.length !== 3 || !['--list','--grant'].includes(mode)) throw Error();
  if(mode==='--list') { console.log(JSON.stringify(await listCandidates({options}))); return; }
  if(process.env.RENOLINK_STAFF_PROVISION_APPROVED !== '1') throw Error();
  let input='';
  for await(const chunk of process.stdin){ input+=chunk; if(Buffer.byteLength(input)>8192)throw Error(); }
  const confirmation=JSON.parse(input);
  const result=await grantAdministrator({options,approved:true,confirmation});
  console.log(JSON.stringify(result));
}
main().catch(()=>{console.error('Concessao recusada. Use o assistente local autorizado; nenhuma credencial foi exibida.');process.exitCode=1;});
