'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),releases=path.join(root,'data/runtime/releases');
const directories=fs.readdirSync(releases).filter(n=>/^staging-\d+$/.test(n)).sort((a,b)=>Number(b.slice(8))-Number(a.slice(8)));assert.ok(directories.length);
const directory=path.join(releases,directories[0]),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const [file,expected]of Object.entries(manifest.files)){
 assert.ok(!path.isAbsolute(file)&&!file.split('/').includes('..')&&!/^data\/|^node_modules\/|^\.env|\.clixml$|\.pfx$|\.pem$|\.key$|\.log$|\.sql$/.test(file));
 const bytes=fs.readFileSync(path.join(directory,file));assert.equal(sha(bytes),expected);assert.equal(sha(fs.readFileSync(path.join(root,file))),expected,'Release desatualizado.');
 const content=bytes.toString('utf8');assert.equal(/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----|scrypt\$32768\$8\$3\$[a-f0-9]{128}/.test(content),false,'Material de credencial no release.');
}
const lock=JSON.parse(fs.readFileSync(path.join(directory,'package-lock.json')));for(const pkg of Object.values(lock.packages))if(pkg.resolved){const u=new URL(pkg.resolved);assert.equal(u.protocol,'https:');assert.equal(u.username,'');assert.equal(u.password,'');}
const result={status:'passed',directory:path.relative(root,directory),files:Object.keys(manifest.files).length,manifestSha256:sha(fs.readFileSync(path.join(directory,'manifest.json'))),noOriginalJson:true,noVault:true,noPrivateKeys:true,noEmbeddedScryptHashes:true,sourceMatches:true,gitHistoryReviewed:false};
fs.writeFileSync(path.join(root,'data/runtime/phase9-release.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
