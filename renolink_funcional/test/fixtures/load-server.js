'use strict';
const {monitorEventLoopDelay,performance}=require('node:perf_hooks');
const mysql=require('../../lib/mysql');
const {createServer}=require('../../server');
const options=mysql.config(process.env,'TEST_MYSQL_');
if(process.env.RENOLINK_PHASE8_TEST_APPROVED!=='1'||options.database!=='renolink_test'||options.user!=='renolink_tester')process.exit(1);
const store=mysql.mysqlStore(options),latencies=[];let active=0,peakActive=0;
const wrapped={transaction:async fn=>{const start=performance.now();active++;peakActive=Math.max(peakActive,active);try{return await store.transaction(fn);}finally{active--;latencies.push(performance.now()-start);}}};
const delay=monitorEventLoopDelay({resolution:20});delay.enable();
const cpuStart=process.cpuUsage(),wallStart=performance.now();let peakRss=0,peakHeap=0;
const sample=setInterval(()=>{const m=process.memoryUsage();peakRss=Math.max(peakRss,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);},100);sample.unref();
const server=createServer(wrapped);server.listen(0,'127.0.0.1',()=>process.send({type:'ready',port:server.address().port}));
process.on('message',async message=>{
 if(message?.type==='metrics'){
  const cpu=process.cpuUsage(cpuStart),wallMs=performance.now()-wallStart,ordered=[...latencies].sort((a,b)=>a-b);
  process.send({type:'metrics',active,peakActive,transactions:latencies.length,transactionP95Ms:ordered[Math.min(ordered.length-1,Math.floor(ordered.length*.95))]||0,wallMs,cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000,cpuOneCorePercent:(cpu.user+cpu.system)/(wallMs*10),peakRssMiB:peakRss/1048576,peakHeapMiB:peakHeap/1048576,eventLoopP95Ms:delay.percentile(95)/1e6,sseConnections:server.realtime.connectionCount()});
 }
 if(message?.type==='close'){clearInterval(sample);delay.disable();await new Promise(resolve=>server.close(resolve));await store.close();process.exit(0);}
});
