'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events');
const {fixture}=require('./fixtures/mysql'),{initialize}=require('../lib/phase5-data'),{createServer}=require('../server'),security=require('../lib/security'),{subscribe,sleep}=require('./fixtures/events');
test('SSE com escopo mantém conexão que entra durante uma varredura em andamento',async()=>{
 const state=initialize(fixture()),cookies=[1,3].map(userId=>security.issueSession({userId},state).cookie.split(';')[0]);let armed=false,reached,resume;
 const paused=new Promise(r=>reached=r),gate=new Promise(r=>resume=r),store={transaction:async fn=>fn(state),readRealtime:async(reqs,fn)=>{const copy=structuredClone(state),tokens=reqs.map(req=>security.digest(security.sessionToken(req)));copy.sessions=copy.sessions.filter(s=>tokens.includes(s.tokenHash));if(armed){armed=false;reached();await gate;}return fn(copy);}};
 const server=createServer(store,{realtime:{pollIntervalMs:1000000}});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,streams=[];
 try{
  const first=await subscribe(base,cookies[0]);streams.push(first);await first.wait(e=>e.type==='ready');armed=true;const scan=server.realtime.scan();await paused;
  const second=await subscribe(base,cookies[1]);streams.push(second);await second.wait(e=>e.type==='ready');resume();await scan;await sleep(40);
  assert.equal(server.realtime.connectionCount(),2);assert.equal(second.events.some(e=>e.type==='session-expired'),false);
  state.ideas.push({...state.ideas[0],id:state.meta.nextIdeaId++,userId:3,status:'Em análise'});await server.realtime.scan();await second.wait(e=>e.type==='changes'&&e.data.topics.includes('ideas'));
 }finally{resume();for(const stream of streams)await stream.close();await new Promise(r=>server.close(r));}
});
