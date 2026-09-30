import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Engine } from '../desktop/src/engine.js';
import { Store } from '../shared/storage.js';
import { envelope } from '../protocol/envelope.js';
const peer='A'.repeat(64),other='B'.repeat(64);
class Node{call(c){if(c.op==='info')return {connection:0,address:'test',friends:[{peer,name:'Friend',connection:0}]};return {ok:true};}poll(){return [];}close(){}}
async function until(fn){const end=Date.now()+3000;while(!fn()){if(Date.now()>end)throw new Error('timeout');await new Promise(r=>setTimeout(r,10));}}
test('offline question can be cancelled before any transmission, and new sessions change only future questions',()=>{
  const s=new Store(':memory:'),e=new Engine(new Node(),s,{name:'Test',downloads:'.'});const first=e.action({op:'agent.request',peer,text:'问题'});e.action({op:'cancelAI',peer,id:first.id});assert.equal(s.get('SELECT COUNT(*) AS n FROM outbox').n,0);assert.equal(s.get('SELECT status FROM messages').status,'cancelled');
  const session=e.action({op:'newAISession',peer}).session;e.action({op:'agent.request',peer,text:'新问题'});assert.equal(JSON.parse(s.get('SELECT packet FROM outbox').packet).body.session,session);assert.equal(s.get('SELECT session FROM messages WHERE id=?',first.id).session,'legacy');e.close();
});
test('remote stop aborts only the requesting peer’s active model stream and preserves partial output',async()=>{
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'部分回答'}}]})+'\n\n');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const s=new Store(':memory:'),e=new Engine(new Node(),s,{name:'Test',downloads:'.',llm:{baseURL:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture'}});s.peer(other);e.action({op:'allowAI',peer,allow:true});const request=envelope('agent.request',{text:'问题'});
  try{e.receive(peer,request);await until(()=>s.get('SELECT text FROM messages WHERE id=?',request.id+'-reply')?.text==='部分回答');
    e.receive(other,envelope('agent.cancel',{stream:request.id}));assert.equal(e.jobs.get(request.id).controller.signal.aborted,false);
    e.receive(peer,envelope('agent.cancel',{stream:request.id}));await until(()=>!e.jobs.has(request.id));
    const reply=s.get('SELECT text,status FROM messages WHERE id=?',request.id+'-reply');assert.equal(reply.status,'cancelled');assert.match(reply.text,/部分回答/);
    const frames=s.all('SELECT packet FROM outbox').map(r=>JSON.parse(r.packet));assert.ok(frames.some(p=>p.t==='stream.error'&&p.body.cancelled));
  }finally{e.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('a cancellation received before a delayed request prevents starting the model',async()=>{
  const s=new Store(':memory:'),e=new Engine(new Node(),s,{name:'Test',downloads:'.',llm:{baseURL:'http://127.0.0.1:1',model:'fixture'}});e.action({op:'allowAI',peer,allow:true});const p=envelope('agent.request',{text:'问题'});e.receive(peer,envelope('agent.cancel',{stream:p.id}));e.receive(peer,p);await new Promise(r=>setImmediate(r));assert.equal(s.get('SELECT status FROM messages WHERE id=?',p.id+'-reply').status,'cancelled');assert.equal(e.jobs.size,0);e.close();
});
