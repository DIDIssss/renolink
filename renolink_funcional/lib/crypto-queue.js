'use strict';
const channel=require('node:diagnostics_channel').channel('renolink.crypto.timing');
const {AsyncResource}=require('node:async_hooks');
// Diagnostics contain only durations and queue sizes, never credentials.
function createQueue({concurrency=4,maxPending=128,observe=value=>channel.publish(value)}={}){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8||!Number.isInteger(maxPending)||maxPending<0||maxPending>256)throw Error('Configuracao criptografica invalida.');
 let active=0;const pending=[];
 function start(item){item.resource.runInAsyncScope(()=>{active++;const began=performance.now(),queueMs=began-item.at,depth=pending.length;
  Promise.resolve().then(item.fn).then(value=>finish(null,value),error=>finish(error));
  function finish(error,value){active--;const detail={queueMs,serviceMs:performance.now()-began,active,pending:pending.length,depth,failed:!!error};const next=pending.shift();if(next)start(next);try{observe(detail);}finally{item.resource.emitDestroy();error?item.reject(error):item.resolve(value);}}
 });
 }
 return {run(fn){return new Promise((resolve,reject)=>{if(active>=concurrency&&pending.length>=maxPending){observe({rejected:true,active,pending:pending.length});reject(Object.assign(Error('Autenticacao ocupada. Tente novamente em instantes.'),{status:503}));return;}const item={fn,resolve,reject,at:performance.now(),resource:new AsyncResource('RenoLinkCrypto')};if(active<concurrency)start(item);else pending.push(item);});},metrics:()=>({active,pending:pending.length,concurrency,maxPending})};
}
const concurrency=Number(process.env.RENOLINK_CRYPTO_CONCURRENCY||Math.min(4,Number(process.env.UV_THREADPOOL_SIZE||4)));
if(concurrency>Number(process.env.UV_THREADPOOL_SIZE||4))throw Error('Concorrencia criptografica excede o pool configurado do Node.js.');
const queue=createQueue({concurrency});
module.exports={createQueue,run:fn=>queue.run(fn),metrics:queue.metrics};
