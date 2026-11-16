'use strict';
const assert=require('node:assert/strict');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn,timeout=5000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const result=fn();if(result)return result;await sleep(15);}throw Error('Timeout aguardando atualizacao autorizada.');}
async function subscribe(base,cookie,lastId){
 const controller=new AbortController();
 const response=await fetch(base+'/api/events',{headers:{Cookie:cookie,...(lastId?{'Last-Event-ID':lastId}:{})},signal:controller.signal});
 assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
 const reader=response.body.getReader(),events=[];let ended=false;
 const pump=(async()=>{let buffer='';const decoder=new TextDecoder();try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let pos;while((pos=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,pos);buffer=buffer.slice(pos+2);const type=/^event: (.+)$/m.exec(frame)?.[1],id=/^id: (.+)$/m.exec(frame)?.[1],data=/^data: (.+)$/m.exec(frame)?.[1];if(type&&data)events.push({type,id,data:JSON.parse(data)});}}}catch(error){if(error.name!=='AbortError'&&!controller.signal.aborted)throw error;}finally{ended=true;}})();
 return{events,wait:fn=>waitFor(()=>events.find(fn)),ended:()=>ended,close:async()=>{controller.abort();await pump;}};
}
module.exports={subscribe,waitFor,sleep};
