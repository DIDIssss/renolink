'use strict';
const {passwordHash}=require('./security');
async function seed(store,password){
 if(typeof password!=='string'||password.length<20||password.length>128)throw Error('Segredo sintetico de homologacao invalido.');
 const credentials=await Promise.all([1,2,3].map(()=>passwordHash(password)));
 return store.transaction(db=>{
  if(db.meta.schemaVersion!==5||Object.entries(db).some(([,value])=>Array.isArray(value)&&value.length)||Object.entries(db.meta).some(([key,value])=>key.startsWith('next')&&value!==1))throw Error('Somente homologacao vazia e inicial pode receber fixtures.');
  const now=new Date().toISOString(),names=['Criador Demo','Empresa Demo','Equipe Demo'];
  for(let i=0;i<3;i++)db.users.push({id:db.meta.nextUserId++,name:names[i],email:['criador','empresa','equipe'][i]+'@homologacao.invalid',role:i===1?'company':'creator',company:i===1?'Empresa Ficticia':'',...credentials[i],createdAt:now});
  db.staff.push({userId:3,accessRole:'admin',active:1,createdAt:now});
  db.audit.push({id:db.meta.nextAuditId++,actorId:3,action:'staff.granted.local',targetType:'staff',targetId:3,detail:'Bootstrap sintetico de homologacao autorizado; papel admin.',createdAt:now});
  return {created:3,syntheticOnly:true,audited:true};
 });
}
module.exports={seed};
