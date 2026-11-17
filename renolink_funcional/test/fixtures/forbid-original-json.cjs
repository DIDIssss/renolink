'use strict';
// Test-only read barrier: the portable Render suite must work on a clean clone.
const fs=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url');
const privatePaths=new Set(['db.json','db.seed.json'].map(name=>path.resolve(__dirname,'../../data',name).toLowerCase()));
function guard(value){
 if(value instanceof URL)value=fileURLToPath(value);
 if(Buffer.isBuffer(value))value=value.toString();
 if(typeof value==='string'&&privatePaths.has(path.resolve(value).toLowerCase()))throw Error('Test attempted to read a private original JSON. Use synthetic fixtures.');
}
for(const method of ['readFileSync','readFile','openSync','open','copyFileSync','copyFile']){
 const original=fs[method];fs[method]=function(file,...args){guard(file);return original.call(this,file,...args);};
}
for(const method of ['readFile','open','copyFile']){
 const original=fs.promises[method];fs.promises[method]=async function(file,...args){guard(file);return original.call(this,file,...args);};
}
