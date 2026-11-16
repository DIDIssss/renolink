'use strict';
const {isIP}=require('node:net');
const {randomBytes}=require('node:crypto');
const logRoutes=new Set(['/api/auth/login','/api/auth/register','/api/auth/logout','/api/auth/logout-all','/api/me','/api/ideas','/api/ideas/:id','/api/ideas/:id/edit','/api/ideas/:id/interest','/api/messages','/api/negotiations','/api/requests','/api/events','/api/stats','/api/features','/api/health','/api/portal/dashboard','/api/portal/deals','/api/team/conversations','/api/team/conversations/:id/messages','/api/admin/auth/login','/api/admin/me','/api/admin/dashboard','/api/admin/users','/api/admin/ideas','/api/admin/ideas/:id','/api/admin/ideas/:id/review','/api/admin/audit','/api/admin/negotiations','/api/admin/requests/:id/status','/api/admin/negotiations/:id/status','/api/admin/conversations','/api/admin/conversations/:id/messages','/api/admin/conversations/:id/status','/health/live','/health/ready']);
function policy(env=process.env){
 const production=env.NODE_ENV==='production',proxy=env.TRUST_PROXY||'off';
 if(!['off','loopback'].includes(proxy))throw Error('TRUST_PROXY deve ser off ou loopback.');
 let origin;
 if(production){
  if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('Validacao TLS nao pode ser desativada.');
  const [major,minor]=process.versions.node.split('.').map(Number);if(major!==24||minor<19)throw Error('Runtime homologado: Node 24.19+ da linha 24 LTS.');
  try{origin=new URL(env.APP_ORIGIN);}catch{throw Error('APP_ORIGIN HTTPS obrigatoria.');}
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||origin.origin!==env.APP_ORIGIN)throw Error('APP_ORIGIN deve ser uma origem HTTPS canonica.');
  if(env.STORAGE_DRIVER!=='mysql'||env.COOKIE_SECURE!=='1'||env.MYSQL_SSL!=='1')throw Error('Producao exige MySQL TLS e cookies seguros.');
  if(proxy!=='loopback')throw Error('Este servidor HTTP exige proxy TLS em loopback na producao.');
 }
 return {production,proxy,origin:origin?.origin,log:env.APP_LOG_FORMAT==='json'};
}
const loopback=ip=>ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1';
function context(req,p){
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
module.exports={policy,context,loopback,logRequest};
