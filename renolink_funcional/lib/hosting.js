'use strict';
const {isIP,BlockList}=require('node:net');
const {randomBytes}=require('node:crypto');
const logRoutes=new Set(['/api/auth/login','/api/auth/register','/api/auth/logout','/api/auth/logout-all','/api/me','/api/ideas','/api/ideas/:id','/api/ideas/:id/edit','/api/ideas/:id/interest','/api/messages','/api/negotiations','/api/requests','/api/events','/api/stats','/api/features','/api/health','/api/portal/dashboard','/api/portal/deals','/api/team/conversations','/api/team/conversations/:id/messages','/api/admin/auth/login','/api/admin/me','/api/admin/dashboard','/api/admin/users','/api/admin/ideas','/api/admin/ideas/:id','/api/admin/ideas/:id/review','/api/admin/audit','/api/admin/negotiations','/api/admin/requests/:id/status','/api/admin/negotiations/:id/status','/api/admin/conversations','/api/admin/conversations/:id/messages','/api/admin/conversations/:id/status','/health/live','/health/ready']);
function policy(env=process.env){
 const production=env.NODE_ENV==='production',proxy=env.TRUST_PROXY||'off';
 const render=env.RENDER==='true';
 if(!['off','loopback','render'].includes(proxy))throw Error('TRUST_PROXY deve ser off, loopback ou render.');
 if((render||proxy==='render'||env.APP_ENV==='render')&&(!render||proxy!=='render'||env.APP_ENV!=='render'||!production))throw Error('Render exige perfil de producao explicito e TRUST_PROXY=render.');
 let origin;
 if(production){
  if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('Validacao TLS nao pode ser desativada.');
  const [major,minor]=process.versions.node.split('.').map(Number);if(major!==24||minor<19)throw Error('Runtime homologado: Node 24.19+ da linha 24 LTS.');
  try{origin=new URL(env.APP_ORIGIN);}catch{throw Error('APP_ORIGIN HTTPS obrigatoria.');}
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||origin.origin!==env.APP_ORIGIN)throw Error('APP_ORIGIN deve ser uma origem HTTPS canonica.');
  if(env.STORAGE_DRIVER!=='mysql'||env.COOKIE_SECURE!=='1'||env.MYSQL_SSL!=='1')throw Error('Producao exige MySQL TLS e cookies seguros.');
  if(render){
   if(!/^srv-[a-z0-9]+$/.test(env.RENDER_SERVICE_ID||'')||origin.hostname!==env.RENDER_EXTERNAL_HOSTNAME||origin.port)throw Error('Identidade do servico Render e APP_ORIGIN divergentes.');
  }else if(proxy!=='loopback')throw Error('Este servidor HTTP exige proxy TLS em loopback na producao.');
 }
 return {production,proxy,origin:origin?.origin,log:env.APP_LOG_FORMAT==='json',...(render?{render:true}: {})};
}
const loopback=ip=>ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1';
const internal=new BlockList(),edge=new BlockList();
for(const [ip,bits]of [['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16],['127.0.0.0',8]])internal.addSubnet(ip,bits,'ipv4');
internal.addSubnet('fc00::',7,'ipv6');internal.addAddress('::1','ipv6');
// Published Cloudflare proxy ranges, reviewed 2026-11-16. No network fetch at startup.
for(const range of ['173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18','190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13','131.0.72.0/22','2400:cb00::/32','2606:4700::/32','2803:f800::/32','2405:b500::/32','2405:8100::/32','2a06:98c0::/29','2c0f:f248::/32']){
 const [ip,bits]=range.split('/');edge.addSubnet(ip,Number(bits),isIP(ip)===4?'ipv4':'ipv6');
}
const normalizeIP=ip=>typeof ip==='string'?ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i,'$1'):'';
const listed=(list,ip)=>!!isIP(ip)&&list.check(ip,isIP(ip)===4?'ipv4':'ipv6');
const denied=()=>Object.assign(Error('Proxy HTTPS invalido.'),{status:403});
function renderContext(req,p){
 const peer=normalizeIP(req.socket.remoteAddress);
 if(!listed(internal,peer))throw denied();
 for(const name of ['host','x-forwarded-for','x-forwarded-proto','cf-connecting-ip']){
  if((req.rawHeaders||[]).filter((v,i)=>i%2===0&&v.toLowerCase()===name).length>1)throw denied();
 }
 if(req.headers.host!==new URL(p.origin).host)throw denied();
 // Render's direct HTTP probes have no edge headers. This bypass cannot reach API,
 // static files, authentication or SSE; no forwarded client identity is accepted.
 if(req.method==='GET'&&['/health/live','/health/ready'].includes(req.url)&&
    req.headers['x-forwarded-for']===undefined&&req.headers['cf-connecting-ip']===undefined&&req.headers['x-forwarded-proto']===undefined)return {ip:peer,secure:false};
 const forwarded=req.headers['x-forwarded-for'],client=normalizeIP(req.headers['cf-connecting-ip']);
 if(req.headers['x-forwarded-proto']!=='https'||typeof forwarded!=='string'||forwarded.length>2048||!isIP(client)||listed(internal,client))throw denied();
 const chain=forwarded.split(',').map(v=>normalizeIP(v.trim()));
 if(chain.length>16||chain.some(ip=>!isIP(ip)))throw denied();
 // Skip only known proxy subnets from the right, never select an untrusted prefix.
 let index=chain.length-1;
 while(index>=0&&(listed(internal,chain[index])||listed(edge,chain[index])))index--;
 if(index<0||chain[index]!==client)throw denied();
 return {ip:client,secure:true};
}
function binding(env=process.env){
 const port=Number(env.PORT||3000);
 if(!Number.isInteger(port)||port<0||port>65535||(env.RENDER==='true'&&port===0))throw Error('Porta invalida.');
 return {port,host:env.RENDER==='true'?'0.0.0.0':'127.0.0.1'};
}
function context(req,p){
 if(p.proxy==='render')return renderContext(req,p);
 let ip=req.socket.remoteAddress,secure=!!req.socket.encrypted;
 if(p.proxy==='loopback'&&loopback(ip)){
  const forwarded=req.headers['x-forwarded-for'],proto=req.headers['x-forwarded-proto'];
  if(typeof forwarded!=='string'||!isIP(forwarded)||proto!=='https')throw Object.assign(Error('Proxy HTTPS invalido.'),{status:403});
  ip=forwarded;secure=true;
 }
 if(p.production&&!secure)throw Object.assign(Error('HTTPS obrigatorio.'),{status:403});
 return {ip,secure};
}
function logRequest(req,res,write=entry=>process.stdout.write(JSON.stringify(entry)+'\n')){
 const id=randomBytes(12).toString('hex'),at=performance.now();res.setHeader('X-Request-Id',id);
 const pathname=new URL(req.url,'http://localhost').pathname.replace(/\/\d+(?=\/|$)/g,'/:id');
 const route=logRoutes.has(pathname)?pathname:'other';
 let done=false;const finish=()=>{if(done)return;done=true;write({event:'http',id,method:['GET','POST','HEAD','OPTIONS'].includes(req.method)?req.method:'other',route,status:res.statusCode,durationMs:Math.round((performance.now()-at)*100)/100,aborted:!res.writableFinished});};
 res.once('finish',finish);res.once('close',finish);
}
module.exports={policy,context,loopback,logRequest,binding};
