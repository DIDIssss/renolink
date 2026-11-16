'use strict';
// Route-scoped, reference-closed working sets for the existing domain handlers.
// Unsupported routes keep the full-state path; no partial state is cached.
const security=require('./security');
const {validate}=require('./data');
const column=value=>value.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
const publicWhere="status IN ('Publicada','Empresa interessada')";
const STATS=Symbol('mysql public aggregates');
function supports(req,url){
 const path=url.pathname,method=req.method;
 if(method==='GET')return ['/api/health','/api/features','/api/stats','/api/me','/api/ideas','/api/negotiations','/api/messages','/api/requests','/api/portal/dashboard','/api/portal/deals','/api/team/conversations'].includes(path)||/^\/api\/ideas\/\d+$/.test(path)||/^\/api\/team\/conversations\/\d+\/messages$/.test(path);
 if(method==='POST')return ['/api/auth/register','/api/auth/login','/api/admin/auth/login','/api/auth/logout','/api/auth/logout-all','/api/ideas','/api/messages','/api/requests','/api/team/conversations'].includes(path)||/^\/api\/ideas\/\d+\/(edit|interest)$/.test(path)||/^\/api\/team\/conversations\/\d+\/(messages|status)$/.test(path)||/^\/api\/admin\/ideas\/\d+\/review$/.test(path);
 return false;
}
async function load(client,context,observe=()=>{}){
 const mysql=require('./mysql'),{mappings:extensions}=require('./phase5-data');
 const [meta]=await client.execute('SELECT payload FROM renolink_meta WHERE id = 1');if(meta.length!==1)throw Error('Destino nao inicializado.');
 const db={meta:typeof meta[0].payload==='string'?JSON.parse(meta[0].payload):meta[0].payload};
 const mapping=db.meta.schemaVersion===5?{...mysql.mappings,...extensions}:mysql.mappings;
 for(const key of Object.keys(mapping))db[key]=[];
 const validated=()=>{const start=performance.now(),value=validate(db);observe('scopedValidate',performance.now()-start);return value;};
 const fallback=async()=>{const start=performance.now(),value=await mysql.loadSnapshot(client);observe('scopedFallbackFull',performance.now()-start);return value;};
 const decode=(row,fields)=>({...((typeof row.extra==='string'?JSON.parse(row.extra):row.extra)||{}),...Object.fromEntries(fields.map(field=>{let value=row[column(field)];if(value instanceof Date)value=value.toISOString();if(field==='id'||field.endsWith('Id'))value=value===null?null:Number(value);return[field,value];}))});
 async function fetch(key,where='1=1',params=[],suffix=''){
  if(!mapping[key])return;
  const [rows]=await client.execute(`SELECT * FROM renolink_${column(key)} WHERE ${where} ${suffix}`,params),primary=key==='sessions'?'tokenHash':key==='staff'?'userId':'id';
  const started=performance.now(),known=new Set(db[key].map(row=>row[primary]));for(const raw of rows){const row=decode(raw,mapping[key]);if(!known.has(row[primary])){db[key].push(row);known.add(row[primary]);}}observe('scopedDecode',performance.now()-started);
 }
 const ids=(values)=>[...new Set(values.filter(value=>value!==null&&value!==undefined&&(typeof value!=='number'||(Number.isSafeInteger(value)&&value>0))))],checkedStaff=new Set();
 async function byIds(key,values,field='id'){
  const selected=ids(values).filter(value=>key!=='staff'||!checkedStaff.has(value));if(key==='staff')for(const id of selected)checkedStaff.add(id);if(selected.length)await fetch(key,'`'+column(field)+'` IN ('+selected.map(()=>'?').join(',')+')',selected,'ORDER BY '+(key==='staff'?'user_id':'id'));
 }
 async function owned(key,fields,userIds){const selected=ids(userIds);if(!selected.length)return;await fetch(key,fields.map(field=>'`'+column(field)+'` IN ('+selected.map(()=>'?').join(',')+')').join(' OR '),fields.flatMap(()=>selected),'ORDER BY id');}
 async function closeReferences(){
  const users=ids([...db.ideas.map(i=>i.userId),...db.negotiations.flatMap(n=>[n.creatorUserId,n.companyUserId]),...db.messages.flatMap(m=>[m.fromUserId,m.toUserId]),...db.sessions.map(s=>s.userId),...(db.staff||[]).map(s=>s.userId),...(db.conversations||[]).map(c=>c.visitorId),...(db.supportMessages||[]).map(m=>m.senderId),...(db.requests||[]).map(r=>r.visitorId),...(db.audit||[]).map(a=>a.actorId)]);
  const ideaIds=ids([...db.negotiations.map(n=>n.ideaId),...(db.requests||[]).map(r=>r.ideaId)]);await byIds('ideas',ideaIds.filter(id=>!db.ideas.some(i=>i.id===id)));
  await byIds('conversations',(db.supportMessages||[]).map(m=>m.conversationId).filter(id=>!db.conversations.some(c=>c.id===id)));
  users.push(...db.ideas.map(i=>i.userId),...(db.conversations||[]).map(c=>c.visitorId));await byIds('users',ids(users).filter(id=>!db.users.some(u=>u.id===id)));
  await byIds('staff',ids([...(db.supportMessages||[]).map(m=>m.senderId),...(db.audit||[]).map(a=>a.actorId)]).filter(id=>!db.staff?.some(s=>s.userId===id)),'userId');
  return validated();
 }
 const req=context.req,requests=context.requests||[req];
 if(!context.realtime&&req.method==='GET'&&context.url.pathname==='/api/stats'){
  const [[row]]=await client.execute("SELECT (SELECT COUNT(*) FROM renolink_ideas WHERE "+publicWhere+") AS ideas, (SELECT COUNT(*) FROM renolink_users WHERE role='company') AS companies, (SELECT COUNT(*) FROM renolink_negotiations) AS negotiations");
  const stats=Object.fromEntries(Object.entries(row).map(([key,value])=>[key,Number(value)]));if(Object.values(stats).some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Contagem invalida.');db[STATS]={...stats,publicIdeas:stats.ideas};return validated();
 }
 const tokens=ids(requests.map(r=>security.sessionToken(r)).filter(Boolean).map(security.digest));
 if(tokens.length)await fetch('sessions','token_hash IN ('+tokens.map(()=>'?').join(',')+')',tokens);
 await byIds('users',db.sessions.map(s=>s.userId));await byIds('staff',db.users.map(u=>u.id),'userId');
 if(context.realtime){
  const current=requests.map(r=>security.auth(r,db)).filter(Boolean),userIds=ids(current.map(a=>a.user.id));
  if(!userIds.length)return validated();
  if(current.some(a=>db.staff?.some(s=>s.userId===a.user.id&&s.active===1)))return fallback();
  await fetch('ideas',publicWhere+' OR user_id IN ('+userIds.map(()=>'?').join(',')+')',userIds,'ORDER BY id');
  await owned('negotiations',['creatorUserId','companyUserId'],userIds);await owned('messages',['fromUserId','toUserId'],userIds);await owned('requests',['visitorId'],userIds);await owned('conversations',['visitorId'],userIds);
  await byIds('supportMessages',(db.conversations||[]).map(c=>c.id),'conversationId');return closeReferences();
 }
 const path=context.url.pathname,method=req.method,data=req.data||{},auth=security.auth(req,db),user=auth?.user;
 if(db.meta.schemaVersion!==5&&(/\/team\/|\/requests|\/admin\//.test(path)))return fallback();
 if(['/api/auth/register','/api/auth/login','/api/admin/auth/login'].includes(path)){
  // Authentication is proven outside the write transaction, then checked again
  // by the existing handler against this freshly selected row and staff record.
  await fetch('users','email_normalized = ?',[String(data.email||'').trim().toLowerCase()]);await byIds('staff',db.users.map(u=>u.id),'userId');return closeReferences();
 }
 if(!user&&(method==='POST'||['/api/me','/api/negotiations','/api/messages','/api/requests'].includes(path)||path.startsWith('/api/portal/')||path.startsWith('/api/team/')))return validated();
 if(path==='/api/auth/logout-all'&&user)await fetch('sessions','user_id = ?',[user.id]);
 if(path==='/api/messages'){
  if(method==='GET'&&user)await owned('messages',['fromUserId','toUserId'],[user.id]);
  if(method==='POST'&&Number.isSafeInteger(Number(data.toUserId)))await byIds('users',[Number(data.toUserId)]);
 }
 const ideaMatch=/^\/api\/ideas\/(\d+)(?:\/(edit|interest))?$/.exec(path),review=/^\/api\/admin\/ideas\/(\d+)\/review$/.exec(path);
 if(ideaMatch||review){const id=Number((ideaMatch||review)[1]);await byIds('ideas',[id]);if(Number.isSafeInteger(id)&&id>0&&(method==='GET'||ideaMatch?.[2]==='interest'))await fetch('negotiations','idea_id = ?',[id],'ORDER BY id');}
 async function listing(mine,pagination=false){
  if(mine&&!user)return;
  let suffix='ORDER BY updated_at DESC, id ASC';
  if(pagination&&(context.url.searchParams.has('limit')||context.url.searchParams.has('offset'))){const limit=Number(context.url.searchParams.get('limit')||100),offset=Number(context.url.searchParams.get('offset')||0);if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw security.fail(400,'Paginacao invalida.');suffix+=` LIMIT ${limit} OFFSET ${offset}`;}
  await fetch('ideas',mine?'user_id = ?':publicWhere,mine?[user.id]:[],suffix);
  await byIds('negotiations',db.ideas.map(i=>i.id),'ideaId');
 }
 if(path==='/api/ideas'&&method==='GET')await listing(context.url.searchParams.get('mine')==='1',true);
 if(path==='/api/negotiations'&&user)await owned('negotiations',[user.role==='company'?'companyUserId':'creatorUserId'],[user.id]);
 if(path==='/api/requests'&&user){
  if(method==='GET')await owned('requests',['visitorId'],[user.id]);
  else if(Number.isSafeInteger(Number(data.ideaId))){await byIds('ideas',[Number(data.ideaId)]);await fetch('requests','visitor_id = ? AND idea_id = ?',[user.id,Number(data.ideaId)]);}
 }
 if(path.startsWith('/api/portal/')&&user){
  await owned('negotiations',[user.role==='company'?'companyUserId':'creatorUserId'],[user.id]);
  if(path.endsWith('/dashboard'))await listing(user.role==='creator');
  if(path.endsWith('/dashboard')&&user.role==='company')await owned('messages',['fromUserId','toUserId'],[user.id]);
  if(db.meta.schemaVersion===5&&(path.endsWith('/deals')||user.role==='creator'))await owned('requests',['visitorId'],[user.id]);
 }
 if(path==='/api/team/conversations'&&user)await owned('conversations',['visitorId'],[user.id]);
 const conversation=/^\/api\/team\/conversations\/(\d+)\/(messages|status)$/.exec(path);
 if(conversation){await byIds('conversations',[Number(conversation[1])]);if(method==='GET')await byIds('supportMessages',[Number(conversation[1])],'conversationId');}
 return closeReferences();
}
module.exports={supports,load,STATS};
