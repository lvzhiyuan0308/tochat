import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../shared/storage.js';
import { createFileSaver } from '../desktop/src/save-file.js';

async function fixture(t){
  const root=await mkdtemp(path.join(tmpdir(),'tochat-export-')),downloads=path.join(root,'downloads');await mkdir(downloads);
  const store=new Store(':memory:');t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const source=path.join(downloads,'received.bin'),content=Buffer.from('附件内容\0你好😀');await writeFile(source,content);
  store.run("INSERT INTO transfers(id,peer,number,name,size,inbound,status,path) VALUES(?,?,?,?,?,?,?,?)",'id','peer',0,'照片与附件.bin',content.length,1,'complete',source);
  return {root,downloads,store,source,content};
}
test('save a completed incoming attachment to the chosen Windows destination without changing the original',async t=>{
  const f=await fixture(t),destination=path.join(f.root,'保存副本.bin');let suggested;
  const save=createFileSaver(f.store,f.downloads,async name=>{suggested=name;return destination;});
  assert.deepEqual(await save({id:'id',peer:'peer'}),{ok:true,path:destination});assert.equal(suggested,'照片与附件.bin');
  const hash=x=>createHash('sha256').update(x).digest('hex');assert.equal(hash(await readFile(destination)),hash(f.content));assert.deepEqual(await readFile(f.source),f.content);
});
test('cancelled save writes nothing and permits another save',async t=>{
  const f=await fixture(t);let choices=0;const destination=path.join(f.root,'copy.bin');
  const save=createFileSaver(f.store,f.downloads,async()=>++choices===1?null:destination);
  assert.deepEqual(await save({id:'id',peer:'peer'}),{cancelled:true});await assert.rejects(readFile(destination));
  assert.equal((await save({id:'id',peer:'peer'})).ok,true);
});
test('rejects wrong peers, outgoing or incomplete attachments, and paths outside the download directory',async t=>{
  const f=await fixture(t);const save=createFileSaver(f.store,f.downloads,async()=>{throw new Error('chooser must not open');});
  await assert.rejects(save({id:'id',peer:'other'}),/不存在/);
  f.store.run("UPDATE transfers SET status='transferring'");await assert.rejects(save({id:'id',peer:'peer'}),/尚未接收完成/);
  f.store.run("UPDATE transfers SET status='complete',inbound=0");await assert.rejects(save({id:'id',peer:'peer'}),/不存在/);
  f.store.run('UPDATE transfers SET inbound=1,path=?',path.join(f.root,'private.txt'));await assert.rejects(save({id:'id',peer:'peer'}),/路径无效/);
  f.store.run('UPDATE transfers SET path=?',path.join(f.downloads,'missing.bin'));await assert.rejects(save({id:'id',peer:'peer'}),/重新发送/);
});
test('only opens one save window and reports destination failures with a retryable error',async t=>{
  const f=await fixture(t);let finish;const choice=new Promise(r=>{finish=r;});const save=createFileSaver(f.store,f.downloads,()=>choice);
  const pending=save({id:'id',peer:'peer'});await assert.rejects(save({id:'id',peer:'peer'}),/已打开/);finish(path.join(f.root,'missing-directory','copy.bin'));
  await assert.rejects(pending,/保存失败/);await assert.rejects(save({id:'id',peer:'peer'}),/保存失败/);
});
