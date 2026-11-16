'use strict';
const https=require('node:https'),fs=require('node:fs');
const started=performance.now();
try{
 if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error();
 const origin=new URL(process.env.HEALTHCHECK_ORIGIN||process.env.APP_ORIGIN);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error();
 const req=https.get(new URL('/health/ready',origin),{rejectUnauthorized:true,...(process.env.HEALTHCHECK_CA?{ca:fs.readFileSync(process.env.HEALTHCHECK_CA)}:{})},res=>{let body='';res.on('data',chunk=>{body+=chunk;if(body.length>2048)res.destroy();});res.on('end',()=>{let ok=false;try{ok=res.statusCode===200&&JSON.parse(body).ok===true;}catch{}console.log(JSON.stringify({ok,status:res.statusCode,durationMs:Math.round(performance.now()-started)}));if(!ok)process.exitCode=1;});res.on('error',fail);});
 req.setTimeout(5000,()=>req.destroy());req.on('error',fail);
}catch{fail();}
function fail(){console.error('Healthcheck HTTPS falhou; nenhum detalhe de credenciais exibido.');process.exitCode=1;}
