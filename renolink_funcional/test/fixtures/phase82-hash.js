'use strict';
const crypto=require('node:crypto'),security=require('../../lib/security'),{stats}=require('../phase8.load');
if(process.env.RENOLINK_PHASE82_APPROVED!=='1')process.exit(1);
(async()=>{
 const password=crypto.randomBytes(32).toString('base64url'),samples=[],hashes=[];let peak=0;const timer=setInterval(()=>peak=Math.max(peak,process.memoryUsage().rss),50),start=performance.now(),cpuStart=process.cpuUsage();
 await Promise.all(Array.from({length:50},async()=>{const started=performance.now(),value=await security.passwordHash(password);samples.push(performance.now()-started);hashes.push(value);}));
 const cpu=process.cpuUsage(cpuStart),wallMs=performance.now()-start;clearInterval(timer);
 const compatible=await security.verifyPassword(password,hashes[0])&&!(await security.verifyPassword(password+'wrong',hashes[0]))&&await security.verifyPassword(password,{salt:'synthetic',passwordHash:security.digest('synthetic:'+password)});
 process.send({workers:Number(process.env.UV_THREADPOOL_SIZE),calls:stats(samples),wallMs,cpuMs:(cpu.user+cpu.system)/1000,peakRssMiB:peak/1048576,compatible,parameters:{N:32768,r:8,p:3},databaseQueries:0});
})().catch(()=>process.exitCode=1);
