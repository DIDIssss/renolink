'use strict';
const dc=require('node:diagnostics_channel'),{monitorEventLoopDelay}=require('node:perf_hooks');
function monitor(server,{write=entry=>process.stdout.write(JSON.stringify(entry)+'\n'),intervalMs=15000}={}){
 const loop=monitorEventLoopDelay({resolution:20});loop.enable();const buckets=new Map();let cpu=process.cpuUsage(),at=performance.now(),rejected=0;
 const record=(key,value)=>{if(!Number.isFinite(value))return;let b=buckets.get(key);if(!b){b=[];buckets.set(key,b);}if(b.length===512)b.shift();b.push(value);};
 const cryptoEvent=v=>{if(v.rejected)rejected++;else{record('cryptoQueue',v.queueMs);record('cryptoSubmittedToCallback',v.serviceMs);}};
 const poolEvent=ms=>record('poolWait',ms);
 dc.channel('renolink.crypto.timing').subscribe(cryptoEvent);dc.channel('renolink.mysql.pool.wait').subscribe(poolEvent);
 const timer=setInterval(sample,intervalMs);timer.unref();
 function sample(){const now=performance.now(),delta=process.cpuUsage(cpu);cpu=process.cpuUsage();const wallMs=now-at;at=now;
  const timings=Object.fromEntries([...buckets].map(([key,values])=>{const v=[...values].sort((a,b)=>a-b),p=q=>v[Math.min(v.length-1,Math.floor(v.length*q))]||0;return[key,{samples:v.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99)}];}));buckets.clear();
  write({event:'runtime',windowMs:Math.round(wallMs),cpuOneCorePercent:(delta.user+delta.system)/(wallMs*10),rssMiB:process.memoryUsage().rss/1048576,eventLoopP95Ms:loop.percentile(95)/1e6,eventLoopP99Ms:loop.percentile(99)/1e6,sse:server.realtime.connectionCount(),crypto:require('./crypto-queue').metrics(),cryptoRejected:rejected,timings});rejected=0;loop.reset();
 }
 return {sample,close(){clearInterval(timer);loop.disable();dc.channel('renolink.crypto.timing').unsubscribe(cryptoEvent);dc.channel('renolink.mysql.pool.wait').unsubscribe(poolEvent);}};
}
module.exports={monitor};
