import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareModel, publicModel, modelFromSaved, protectSecret } from '../desktop/src/model-settings.js';

test('model settings validate addresses and preserve, replace or clear the encrypted key',()=>{
  const encode=x=>'encrypted:'+x,decode=x=>x.slice(10);
  const input={enabled:true,baseURL:' http://127.0.0.1:4000/v1/ ',model:' model ',key:'secret'};
  let saved=prepareModel(input,null,encode);
  assert.equal(saved.baseURL,'http://127.0.0.1:4000/v1');
  assert.equal(publicModel(saved,modelFromSaved(saved,decode)).hasKey,true);
  assert.ok(!JSON.stringify(publicModel(saved,modelFromSaved(saved,decode))).includes('secret'));
  saved=prepareModel({...input,key:''},saved,encode);assert.equal(modelFromSaved(saved,decode).key,'secret');
  saved=prepareModel({...input,key:'replacement'},saved,encode);assert.equal(modelFromSaved(saved,decode).key,'replacement');
  saved=prepareModel({...input,key:'',clearKey:true},saved,encode);assert.equal(modelFromSaved(saved,decode).key,'');
  assert.equal(modelFromSaved({...saved,enabled:false},decode),null);
  for(const baseURL of ['file:///tmp/key','http://user:pass@localhost/v1','http://localhost/v1?key=secret','invalid'])assert.throws(()=>prepareModel({...input,baseURL},null,encode));
  assert.throws(()=>prepareModel({...input,model:''},null,encode));
});

test('Windows DPAPI encrypted model keys round-trip without storing plaintext',{skip:process.platform!=='win32'},()=>{
  const key='test-only-secret-你好';const encrypted=protectSecret(key);
  assert.ok(!encrypted.includes(key));assert.equal(protectSecret(encrypted,true),key);
});
