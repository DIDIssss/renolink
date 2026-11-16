'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {waitFor}=require('./fixtures/events');
function harness(){
 const window=new EventTarget(),document=new EventTarget(),sources=[];
 const node=()=>({dataset:{},className:'',textContent:'',setAttribute(){},append(){},classList:{toggle(){}}});
 document.body={...node(),dataset:{auth:'required',page:'dashboard'}};document.hidden=false;document.createElement=node;document.querySelector=()=>document.body;document.querySelectorAll=()=>[];
 class Source extends EventTarget{static OPEN=1;static CONNECTING=0;static CLOSED=2;constructor(){super();this.readyState=1;sources.push(this);}close(){this.readyState=2;}}
 window.EventSource=Source;
 const context={window,document,EventSource:Source,AbortSignal,navigator:{onLine:true},location:{href:'',reload(){}},fetch:async()=>({status:200}),setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,25)),clearTimeout,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/realtime.js'),'utf8'),context);
 return{client:window.RenoLinkRealtime,sources,context,send(source,id='abcdef0123456789:1'){source.dispatchEvent(new MessageEvent('changes',{data:JSON.stringify({topics:['ideas']}),lastEventId:id}));}};
}
test('Cliente SSE conserva invalidacao apos falha HTTP e repete somente a leitura',async()=>{
 const h=harness();let calls=0;h.client.start(async()=>{calls++;if(calls===1)throw Error('Temporary HTTP failure');});
 try{h.send(h.sources[0]);await waitFor(()=>calls>=2,1000);assert.equal(calls,2);}finally{h.client.stop();}
});
test('Cliente SSE reconecta apos erro terminal com sessao valida',async()=>{
 const h=harness();h.client.start(async()=>{});
 try{h.sources[0].readyState=2;h.sources[0].onerror();await waitFor(()=>h.sources.length===2,1000);}finally{h.client.stop();}
});
