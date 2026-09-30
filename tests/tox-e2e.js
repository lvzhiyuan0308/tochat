import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { ToxNode } from '../desktop/src/tox-node.js';
import { Engine } from '../desktop/src/engine.js';
import { Store } from '../shared/storage.js';
import { toxAddress } from '../protocol/envelope.js';
import http from 'node:http';
const dir=mkdtempSync(path.join(tmpdir(),'tochat-tox-'));let a,b,ea,eb;
const password=randomBytes(32).toString('hex');
const tcp=process.env.TOCHAT_E2E_TCP==='1';
const nodes=tcp?JSON.parse(readFileSync(new URL('../shared/bootstrap.json',import.meta.url),'utf8')):[];
const answer='北京是中国的首都。你好，ToChat 流式回答🙂。'.repeat(2000);
const llm=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const messages=JSON.parse(raw).messages,last=messages.at(-1).content;res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(last==='慢速回答'){const timer=setInterval(()=>res.write('data: '+JSON.stringify({choices:[{delta:{content:'生成中…'}}]})+'\n\n'),100);res.on('close',()=>clearInterval(timer));return;}
  const output=last==='刚才介绍的是哪个城市？'?(JSON.stringify(messages.slice(0,-1)).includes('北京')?'刚才介绍的是北京。':'上下文缺失'):last==='新会话是否有旧上下文？'?(messages.length===2?'新会话没有旧上下文。':'会话隔离失败'):answer;
  for(let i=0;i<output.length;i+=240)res.write('data: '+JSON.stringify({choices:[{delta:{content:output.slice(i,i+240)}}]})+'\n\n');res.end('data: [DONE]\n\n');});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=tcp?120000:60000){const start=Date.now();while(!fn()){if(Date.now()-start>ms)throw new Error('Tox E2E timed out');ea?.tick();eb?.tick();await sleep(100);}}
try{
  await new Promise(r=>llm.listen(0,'127.0.0.1',r));
  a=new ToxNode({profile:path.join(dir,'a.tox'),password,name:'Alice',port:34561,udp:!tcp});b=new ToxNode({profile:path.join(dir,'b.tox'),password,name:'Bob',port:34562,udp:!tcp});
  const ai=a.call({op:'info'}),bi=b.call({op:'info'});assert.equal(toxAddress(ai.address),ai.address);
  a.call({op:'add',address:bi.address});b.call({op:'accept',peer:ai.address.slice(0,64)});
  const pkA=ai.address.slice(0,64),pkB=bi.address.slice(0,64);
  ea=new Engine(a,new Store(path.join(dir,'a.db')),{name:'Alice',downloads:path.join(dir,'downloads'),bootstrap:nodes});eb=new Engine(b,new Store(path.join(dir,'b.db')),{name:'Bob',downloads:path.join(dir,'downloads'),bootstrap:nodes,llm:{baseURL:`http://127.0.0.1:${llm.address().port}/v1`,model:'test'}});
  if(!tcp){a.call({op:'bootstrap',host:'127.0.0.1',port:bi.port,key:bi.dht});b.call({op:'bootstrap',host:'127.0.0.1',port:ai.port,key:ai.dht});}
  await until(()=>ea.connections.get(pkB)===(tcp?1:2)&&eb.connections.get(pkA)===(tcp?1:2));console.log('PASS native encrypted Tox '+(tcp?'public TCP relay':'UDP')+' peers connected');
  const text='离线消息🙂'.repeat(500);const {id}=ea.action({op:'chat',peer:pkB,text});await until(()=>ea.store.get('SELECT status FROM messages WHERE id=?',id)?.status==='delivered');assert.equal(eb.store.get('SELECT text FROM messages WHERE id=?',id).text,text);console.log('PASS UTF-8 fragmentation, SQLite commit and application ACK');
  eb.action({op:'allowAI',peer:pkA,allow:true});const request=ea.action({op:'agent.request',peer:pkB,text:'介绍北京'});await until(()=>ea.store.get("SELECT status FROM messages WHERE id=?",request.id+'-reply')?.status==='stored');const actual=ea.store.get('SELECT text FROM messages WHERE id=?',request.id+'-reply').text;assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(answer).digest('hex'));console.log('PASS authorized LLM SSE → Tox stream → SQLite: '+Buffer.byteLength(answer)+' UTF-8 bytes');
  const follow=ea.action({op:'agent.request',peer:pkB,text:'刚才介绍的是哪个城市？'});await until(()=>ea.store.get('SELECT status FROM messages WHERE id=?',follow.id+'-reply')?.status==='stored');assert.equal(ea.store.get('SELECT text FROM messages WHERE id=?',follow.id+'-reply').text,'刚才介绍的是北京。');console.log('PASS real Tox multi-turn history and bounded older summary');
  ea.action({op:'newAISession',peer:pkB});const fresh=ea.action({op:'agent.request',peer:pkB,text:'新会话是否有旧上下文？'});await until(()=>ea.store.get('SELECT status FROM messages WHERE id=?',fresh.id+'-reply')?.status==='stored');assert.equal(ea.store.get('SELECT text FROM messages WHERE id=?',fresh.id+'-reply').text,'新会话没有旧上下文。');console.log('PASS AI session reset preserves history and isolates model input');
  await until(()=>ea.store.get('SELECT capabilities FROM peers WHERE peer=?',pkB)?.capabilities.includes('ai-cancel'));const slow=ea.action({op:'agent.request',peer:pkB,text:'慢速回答'});await until(()=>ea.store.get('SELECT text FROM messages WHERE id=?',slow.id+'-reply')?.text.includes('生成中'));ea.action({op:'cancelAI',peer:pkB,id:slow.id});await until(()=>ea.store.get('SELECT status FROM messages WHERE id=?',slow.id+'-reply')?.status==='cancelled');assert.equal(eb.jobs.size,0);console.log('PASS real Tox stop-generation control and terminal acknowledgement');
  const file=path.join(dir,'test.bin');const bytes=randomBytes(1024*1024+19);writeFileSync(file,bytes);ea.action({op:'sendFile',peer:pkB,path:file});await until(()=>eb.store.get("SELECT id FROM transfers WHERE status='offered'"));const transfer=eb.store.get('SELECT * FROM transfers');eb.action({op:'acceptFile',peer:pkA,id:transfer.id});await until(()=>eb.store.get('SELECT status FROM transfers WHERE id=?',transfer.id).status==='complete');const received=readFileSync(eb.store.get('SELECT path FROM transfers WHERE id=?',transfer.id).path);assert.equal(createHash('sha256').update(received).digest('hex'),createHash('sha256').update(bytes).digest('hex'));console.log('PASS Tox native file transfer: 1 MiB, SHA-256 identical');
  ea.close();ea=null;a=null;eb.close();eb=null;b=null;
  const saved=readFileSync(path.join(dir,'a.tox'));assert.equal(saved.subarray(0,8).toString(),'toxEsave');a=new ToxNode({profile:path.join(dir,'a.tox'),password,name:'Alice'});assert.equal(a.call({op:'info'}).address,ai.address);a.close();a=null;
  assert.throws(()=>new ToxNode({profile:path.join(dir,'a.tox'),password:'f'.repeat(64),name:'Wrong key'}),/decrypt/);console.log('PASS encrypted identity restored; wrong key never replaces identity');
}finally{ea?.close();eb?.close();if(!ea)a?.close();if(!eb)b?.close();llm.close();rmSync(dir,{recursive:true,force:true});}
