import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../shared/storage.js';
import { Engine } from '../desktop/src/engine.js';
import { envelope } from '../protocol/envelope.js';
const peer='A'.repeat(64);
class FakeNode {constructor(){this.sent=[];}call(c){if(c.op==='info')return {address:'id',connection:2,friends:[{peer,name:'Friend',connection:0}]};if(c.op==='send')this.sent.push(JSON.parse(c.data));return {ok:true};}poll(){return [];}close(){}}
test('changing model configuration updates local status and announces capabilities to online peers',()=>{
  const node=new FakeNode();const engine=new Engine(node,new Store(':memory:'),{name:'Test',downloads:'.'});
  engine.connections.set(peer,2);engine.setModel({baseURL:'http://localhost/v1',model:'test',key:''});
  assert.equal(engine.snapshot().aiConfigured,true);assert.ok(node.sent.at(-1).body.capabilities.includes('agent'));
  engine.setModel(null);assert.equal(engine.snapshot().aiConfigured,false);assert.ok(!node.sent.at(-1).body.capabilities.includes('agent'));engine.close();
});
test('outbox survives restart and waits for an application ACK from the correct peer',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'tochat-test-'));let store=new Store(path.join(dir,'db'));let node=new FakeNode();let engine=new Engine(node,store,{name:'Test',downloads:dir});
  const {id}=engine.action({op:'chat',peer,text:'Offline hello'});assert.equal(store.get('SELECT status FROM messages').status,'queued');assert.equal(node.sent.length,0);engine.close();
  store=new Store(path.join(dir,'db'));node=new FakeNode();engine=new Engine(node,store,{name:'Test',downloads:dir});engine.event({type:'connection',peer,connection:2});engine.flush();assert.equal(store.get('SELECT status FROM messages').status,'sending');
  assert.throws(()=>engine.receive('B'.repeat(64),envelope('ack',{id})));assert.equal(store.get('SELECT COUNT(*) AS n FROM outbox').n,1);engine.receive(peer,envelope('ack',{id}));assert.equal(store.get('SELECT status FROM messages').status,'delivered');assert.equal(store.get('SELECT COUNT(*) AS n FROM outbox').n,0);engine.close();rmSync(dir,{recursive:true});
});
test('duplicate incoming messages are committed once and acknowledged again',()=>{
  const store=new Store(':memory:');const node=new FakeNode();const engine=new Engine(node,store,{name:'Test',downloads:'.'});const p=envelope('chat',{text:'hi'});engine.receive(peer,p);engine.receive(peer,p);assert.equal(store.all('SELECT * FROM messages').length,1);assert.equal(node.sent.filter(p=>p.t==='ack').length,2);engine.close();
});
test('reassembles AI chunks arriving after the end marker and rejects unsolicited streams',()=>{
  const store=new Store(':memory:');const node=new FakeNode();const engine=new Engine(node,store,{name:'Test',downloads:'.'});const {id}=engine.action({op:'agent.request',peer,text:'hello'});
  engine.receive(peer,envelope('stream.end',{stream:id,total:2}));engine.receive(peer,envelope('stream.chunk',{stream:id,seq:1,text:'世界'}));assert.equal(store.get("SELECT status FROM messages WHERE kind='stream'").status,'streaming');engine.receive(peer,envelope('stream.chunk',{stream:id,seq:0,text:'你好'}));assert.equal(store.get("SELECT text FROM messages WHERE kind='stream'").text,'你好世界');assert.equal(store.get("SELECT status FROM messages WHERE kind='stream'").status,'stored');
  assert.throws(()=>engine.receive(peer,envelope('stream.chunk',{stream:'unknown',seq:0,text:'x'})));engine.close();
});
test('AI is denied until a friend is explicitly authorized',async()=>{
  const store=new Store(':memory:');const engine=new Engine(new FakeNode(),store,{name:'Test',downloads:'.',llm:{baseURL:'http://127.0.0.1:1',model:'test'}});const p=envelope('agent.request',{text:'hello'});engine.receive(peer,p);await new Promise(r=>setImmediate(r));const out=store.all('SELECT packet FROM outbox').map(r=>JSON.parse(r.packet));assert.equal(out.length,1);assert.equal(out[0].t,'stream.error');assert.match(out[0].body.text,/尚未授权/);engine.close();
});
test('failed transfer records may be hidden and restored without deleting source files or active transfers',()=>{
  const s=new Store(':memory:'),e=new Engine(new FakeNode(),s,{name:'Test',downloads:'.'});
  s.run('INSERT INTO transfers(id,peer,number,name,size,inbound,status,path) VALUES(?,?,?,?,?,?,?,?)','file',peer,0,'keep.bin',5,1,'interrupted','keep.bin');
  e.action({op:'hideTransfer',peer,id:'file'});assert.equal(e.snapshot(peer).transfers.length,0);assert.equal(s.get('SELECT path FROM transfers').path,'keep.bin');e.action({op:'restoreTransfer',peer,id:'file'});assert.equal(e.snapshot(peer).transfers.length,1);
  s.run("UPDATE transfers SET status='transferring'");assert.throws(()=>e.action({op:'hideTransfer',peer,id:'file'}));assert.throws(()=>e.action({op:'restoreTransfer',peer:'other',id:'file'}));e.close();
});
