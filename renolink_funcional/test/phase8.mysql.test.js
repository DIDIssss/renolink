'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const mysql=require('../lib/mysql');
const {stable}=require('../lib/data');
test('MySQL isolado: rollback depois de SQL real e gravacao diferencial preservam registros', {skip:process.env.RENOLINK_PHASE8_TEST_APPROVED!=='1'},async()=>{
 const options=mysql.config(process.env,'TEST_MYSQL_');assert.equal(options.database,'renolink_test');assert.equal(options.user,'renolink_tester');
 const pool=mysql.pool(options);
 try{
  const before=await mysql.transaction(pool,mysql.load);const user=before.users.at(-1);assert.ok(user);
  await assert.rejects(mysql.transaction(pool,async client=>{
   await client.execute('UPDATE renolink_users SET name = ? WHERE id = ?',['Rollback sintetico',user.id]);
   await client.execute('INSERT INTO renolink_staff (user_id, access_role, active, created_at, extra) VALUES (?, ?, ?, ?, ?)',[-1,'admin',1,new Date(),'{}']);
  }),error=>error.sqlState==='23000'&&((error.errno===1452&&error.code==='ER_NO_REFERENCED_ROW_2')||(error.errno===1216&&error.code==='ER_NO_REFERENCED_ROW')));
  const after=await mysql.transaction(pool,mysql.load);assert.equal(stable(after),stable(before));
  await mysql.transaction(pool,async client=>{
   const queries=[],execute=client.execute.bind(client);client.execute=async(sql,params)=>{queries.push(sql);return execute(sql,params);};
   try{await mysql.save(client,structuredClone(after),false,after);assert.deepEqual(queries,[]);}finally{client.execute=execute;}
  });
 }finally{await pool.end();}
});
