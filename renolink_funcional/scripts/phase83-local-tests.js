'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),files=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).scripts.test.split(' ').slice(2),env={...process.env};
for(const key of Object.keys(env))if(/^(TEST_)?MYSQL_|^RENOLINK_PHASE.*APPROVED$/.test(key))delete env[key];
const at=performance.now(),result=spawnSync(process.execPath,['--test',...files],{cwd:root,env,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024}),output=(result.stdout||'')+(result.stderr||'');process.stdout.write(output);
const count=Number(/(?:#|ℹ)?\s*tests\s+(\d+)/.exec(output)?.[1]),passed=Number(/(?:#|ℹ)?\s*pass\s+(\d+)/.exec(output)?.[1]),failed=Number(/(?:#|ℹ)?\s*fail\s+(\d+)/.exec(output)?.[1]);
fs.writeFileSync(path.join(root,'data/runtime/phase83-local-tests.json'),JSON.stringify({status:result.status===0&&failed===0?'passed':'failed',tests:count,passed,failed,exitCode:result.status,durationMs:performance.now()-at,node:process.version,files},null,2));
assert.equal(result.status,0);assert.equal(failed,0);assert.equal(passed,count);
