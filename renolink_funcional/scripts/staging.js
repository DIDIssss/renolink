'use strict';
const {configuration,diagnose}=require('../lib/staging');
async function main(){const command=process.argv[2];if(!['check','diagnose','start'].includes(command))throw Error('Comando invalido.');const settings=configuration();
 if(command==='check'){console.log(JSON.stringify({ok:true,configurationOnly:true,networkAccess:false,database:'renolink_staging'}));return;}
 if(command==='start'&&process.env.RENOLINK_STAGING_START_APPROVED!=='1')throw Error('Inicio de homologacao exige autorizacao explicita.');
 console.log(JSON.stringify(await diagnose(settings.mysql)));
 if(command==='start'){
  if(process.env.RENOLINK_STAGING_START_APPROVED!=='1')throw Error('Inicio de homologacao exige autorizacao explicita.');
  await require('../server').start();
 }
}
main().catch(()=>{console.error('Homologacao recusada; verificar configuracao, TLS, identidade e autorizacao. Nenhum segredo exibido.');process.exitCode=1;});
