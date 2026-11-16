'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const publicFiles=['index.html','empresa.html','explorar.html','ideia.html','cadastro.html','login.html','dashboard.html','nova-ideia.html','mensagens.html','negociacoes.html','admin.html','admin-login.html','assets/css/style.css','assets/css/phase5.css','assets/js/app.js','assets/js/security.js','assets/js/admin.js','assets/js/realtime.js','assets/img/logo-renolink.svg'];
function packageRelease(destination){
 const target=path.resolve(destination);if(!target.startsWith(path.join(root,'data/runtime/releases')+path.sep))throw Error('Destino fora de releases locais.');fs.mkdirSync(path.dirname(target),{recursive:true});fs.mkdirSync(target);
 const files=[...publicFiles,'server.js','package.json','package-lock.json',...fs.readdirSync(path.join(root,'lib')).filter(f=>f.endsWith('.js')).map(f=>'lib/'+f),'scripts/staging.js','scripts/staging-seed.js','scripts/staging-homologate.js','scripts/healthcheck.js'];const hashes={};
 for(const file of files){const source=path.join(root,file);if(!fs.lstatSync(source).isFile())throw Error('Release recusa links e arquivos especiais.');const content=fs.readFileSync(source);hashes[file]=crypto.createHash('sha256').update(content).digest('hex');const output=path.join(target,file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,content,{flag:'wx'});}
 fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),files:hashes,noDataOrSecrets:true},null,2),{flag:'wx'});return {files:files.length,manifest:path.relative(root,path.join(target,'manifest.json'))};
}
module.exports={packageRelease};
if(require.main===module){try{console.log(JSON.stringify(packageRelease(path.join(root,'data/runtime/releases/staging-'+Date.now()))));}catch{console.error('Empacotamento recusado.');process.exitCode=1;}}
