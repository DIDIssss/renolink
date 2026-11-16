'use strict';
const {monitorEventLoopDelay}=require('node:perf_hooks');
const path=require('node:path');
const mysql=require('../../lib/mysql');
const {mappedPool}=require('./phase81-pool');
const {stats}=require('../phase8.load');
const {createServer}=require('../../server');
if(process.env.RENOLINK_PHASE81_APPROVED!=='1')process.exit(1);
const options=mysql.config(process.env,'TEST_MYSQL_'),samples={};
const observe=(stage,ms)=>(samples[stage]??=[]).push(ms);
require('node:diagnostics_channel').channel('renolink.hash.timing').subscribe(ms=>observe('scryptWithThreadQueue',ms));
const pool=mappedPool(options,process.env.PHASE81_PREFIX,observe);
const implementation=process.env.PHASE81_VARIANT==='before'?require('./phase81-baseline-mysql'):mysql;
const store=implementation.mysqlStore(options,{connectionPool:pool,observe});
const server=createServer(store,{observe});
const loop=monitorEventLoopDelay({resolution:20});loop.enable();let peakRss=0,peakHeap=0;
const started=performance.now(),cpuStart=process.cpuUsage();
const sampler=setInterval(()=>{const m=process.memoryUsage();peakRss=Math.max(peakRss,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);},100);sampler.unref();
server.listen(0,'127.0.0.1',()=>process.send({type:'ready',port:server.address().port}));
process.on('message',async message=>{
 if(message.type==='metrics'){
  const cpu=process.cpuUsage(cpuStart),wallMs=performance.now()-started;
  process.send({type:'metrics',wallMs,cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000,cpuOneCorePercent:(cpu.user+cpu.system)/(wallMs*10),peakRssMiB:peakRss/1048576,peakHeapMiB:peakHeap/1048576,eventLoopP95Ms:loop.percentile(95)/1e6,mysqlConnections:pool.metrics(),sseConnections:server.realtime.connectionCount(),stages:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,{...stats(v),totalMs:v.reduce((a,b)=>a+b,0)}]))});
 }
 if(message.type==='close'){clearInterval(sampler);loop.disable();await new Promise(r=>server.close(r));await store.close();process.exit(0);}
});
