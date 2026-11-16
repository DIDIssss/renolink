'use strict';
// One authenticated EventSource per page. Events contain invalidation topics only.
window.RenoLinkRealtime=(()=>{
 let source=null,handler=null,timer=null,reconnectTimer=null,stopped=false,retryDelay=1000,connectDelay=2000,running=false,pending=new Set(),seen=new Set(),status=null,notice=null;
 function connection(state){
  if(!status){status=document.createElement('span');status.id='realtimeStatus';status.className='realtime-status';status.setAttribute('role','status');(document.querySelector('.team-topbar')||document.querySelector('.app-topbar')||document.body).append(status);}
  status.dataset.state=state;
  status.textContent=state==='online'?'Atualizações ativas':state==='connecting'?'Reconectando…':state==='offline'?'Sem conexão. Tentando reconectar…':'Atualizações pausadas';
 }
 function announce(topics){
  if(!notice){notice=document.createElement('div');notice.id='realtimeNotice';notice.className='realtime-notice';notice.setAttribute('role','status');document.body.append(notice);}
  const active=document.body.dataset.page;
  const text=topics.includes('messages')?'Nova atualização nas conversas':topics.includes('deals')?'Solicitações ou negociações atualizadas':topics.includes('ideas')?'Ideias atualizadas':'Dados atualizados';
  notice.textContent=text;notice.hidden=false;
  if(notice.hideTimer)clearTimeout(notice.hideTimer);notice.hideTimer=setTimeout(()=>{notice.hidden=true;},4000);
  document.querySelectorAll('[data-section="conversations"], [data-nav="messages"], .visitor-mobile-nav a[href="mensagens.html"]').forEach(el=>el.classList.toggle('realtime-unread',topics.includes('messages')&&active!=='messages'&&!el.classList.contains('active')));
  document.querySelectorAll('[data-section="negotiations"], [data-nav="deals"], .visitor-mobile-nav a[href="negociacoes.html"]').forEach(el=>el.classList.toggle('realtime-unread',topics.includes('deals')&&active!=='deals'&&!el.classList.contains('active')));
 }
 async function flush(){
  timer=null;if(running||!handler||!pending.size)return;
  if(document.hidden)return;
  running=true;const topics=[...pending];pending.clear();
  let failed=false;
  try{await handler(topics);retryDelay=1000;if(!stopped&&source?.readyState===EventSource.OPEN)connection('online');}catch{failed=true;if(!stopped){for(const topic of topics)pending.add(topic);connection('offline');}}
  finally{running=false;if(!stopped&&pending.size&&!timer){timer=setTimeout(flush,failed?retryDelay:150);if(failed)retryDelay=Math.min(retryDelay*2,30000);}}
 }
 function queue(topics){for(const topic of topics)if(['ideas','messages','deals','users','audit'].includes(topic))pending.add(topic);if(!timer)timer=setTimeout(flush,150);}
 function receive(event,notify){
  let data;try{data=JSON.parse(event.data);}catch{return;}
  if(!Array.isArray(data.topics))return;
  if(event.lastEventId){if(seen.has(event.lastEventId))return;seen.add(event.lastEventId);if(seen.size>200)seen.delete(seen.values().next().value);}
  queue(data.topics);if(notify&&data.topics.length)announce(data.topics);
 }
 function start(onChange){
  if(source)return;handler=onChange;stopped=false;
  if(!window.EventSource){connection('paused');return;}
  connection('connecting');source=new EventSource('/api/events');
  source.onopen=()=>{connectDelay=2000;connection('online');};source.onerror=()=>{
    connection(source?.readyState===EventSource.CLOSED?'paused':navigator.onLine?'connecting':'offline');
    if(source?.readyState===EventSource.CLOSED&&!reconnectTimer){
     const reconnect=()=>{if(stopped)return;if(source)source.close();source=null;start(handler);};
     reconnectTimer=setTimeout(async()=>{reconnectTimer=null;if(stopped)return;try{const r=await fetch('/api/me',{credentials:'same-origin',signal:AbortSignal.timeout(15000)});if(stopped)return;if(r.status===401){stop();location.href=document.body.dataset.page==='admin'?'admin-login.html':'login.html';return;}}catch{}reconnect();},connectDelay);connectDelay=Math.min(connectDelay*2,30000);
    }
  };
  source.addEventListener('ready',e=>receive(e,false));source.addEventListener('changes',e=>receive(e,true));source.addEventListener('reset',e=>receive(e,false));
  source.addEventListener('session-expired',()=>{stop();location.href=document.body.dataset.page==='admin'?'admin-login.html':'login.html';});
  source.addEventListener('access-changed',()=>{stop();location.reload();});
 }
 function stop(){stopped=true;if(source)source.close();source=null;if(timer)clearTimeout(timer);if(reconnectTimer)clearTimeout(reconnectTimer);timer=null;reconnectTimer=null;pending.clear();}
 document.addEventListener('visibilitychange',()=>{if(handler&&!document.hidden){queue(['ideas','messages','deals','users','audit']);}});
 window.addEventListener('offline',()=>{if(handler)connection('offline');});
 window.addEventListener('online',()=>{if(source)connection('connecting');});
 window.addEventListener('pagehide',stop);
 window.addEventListener('pageshow',e=>{if(e.persisted&&handler)start(handler);});
 return{start,stop};
})();
