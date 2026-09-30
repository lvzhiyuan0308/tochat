import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../shared/storage.js';
import { conversation,CONTEXT_BYTES,RECENT_TURNS } from '../desktop/src/conversation.js';
const insert=(s,id,peer,kind,text,session='legacy',status='stored',direction='in')=>s.run('INSERT INTO messages(id,peer,direction,kind,text,status,ts,session) VALUES(?,?,?,?,?,?,?,?)',id,peer,direction,kind,text,status,Date.now(),session);
test('AI context includes previous complete question/answer pairs but excludes other peers, sessions, human chat and failed replies',()=>{
  const s=new Store(':memory:');
  insert(s,'city','A','agent.request','介绍下北京');insert(s,'city-reply','A','stream','北京是中国的首都。','legacy','stored','out');
  insert(s,'other','B','agent.request','别人的秘密');insert(s,'other-reply','B','stream','不能泄露','legacy','stored','out');
  insert(s,'private','A','chat','普通聊天的私密信息');insert(s,'failed','A','agent.request','失败问题');insert(s,'failed-reply','A','stream','不能使用的错误回答','legacy','error','out');
  insert(s,'question','A','agent.request','刚才是哪个城市？');
  const messages=conversation(s,'A',{id:'question',body:{text:'刚才是哪个城市？'}});
  assert.deepEqual(messages.slice(1),[{role:'user',content:'介绍下北京'},{role:'assistant',content:'北京是中国的首都。'},{role:'user',content:'刚才是哪个城市？'}]);
  insert(s,'new','A','agent.request','新问题','new-session');assert.equal(conversation(s,'A',{id:'new',body:{text:'新问题',session:'new-session'}}).length,2);s.close();
});
test('context is bounded and older summary excerpts persist across restart without repeating archived rounds',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'tochat-memory-'));let s=new Store(path.join(dir,'history.sqlite'));
  try{
    for(let i=0;i<45;i++){insert(s,'q'+i,'A','agent.request','问题 '+i);insert(s,'q'+i+'-reply','A','stream',('回答 '+i+' 北京。').repeat(80),'legacy','stored','out');}
    insert(s,'current','A','agent.request','当前问题');const request={id:'current',body:{text:'当前问题'}};const first=conversation(s,'A',request);
    assert.ok(first.filter(m=>m.role==='assistant').length<=RECENT_TURNS);assert.ok(first.reduce((n,m)=>n+Buffer.byteLength(m.content),0)<CONTEXT_BYTES);assert.match(first[1].content,/摘要摘录/);
    const memory=s.get('SELECT * FROM ai_memory');assert.ok(memory.last_row>0);s.close();s=new Store(path.join(dir,'history.sqlite'));
    assert.deepEqual(conversation(s,'A',request),first);assert.deepEqual(s.get('SELECT * FROM ai_memory'),memory);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('upgrades a v1 database while preserving identities of messages and transfer records',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'tochat-migration-')),file=path.join(dir,'old.sqlite');const old=new DatabaseSync(file);
  old.exec("CREATE TABLE peers(peer TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',capabilities TEXT NOT NULL DEFAULT '[]',allow_ai INTEGER NOT NULL DEFAULT 0); CREATE TABLE messages(id TEXT,peer TEXT,direction TEXT,kind TEXT,text TEXT,status TEXT,ts INTEGER,total INTEGER,PRIMARY KEY(id,peer)); CREATE TABLE transfers(id TEXT PRIMARY KEY,peer TEXT,number INTEGER,name TEXT,size INTEGER,done INTEGER DEFAULT 0,inbound INTEGER,status TEXT,path TEXT); INSERT INTO peers(peer) VALUES('A'); INSERT INTO messages VALUES('old','A','in','chat','旧历史','stored',123,NULL); INSERT INTO transfers VALUES('file','A',0,'old.bin',5,5,1,'complete','old.bin'); PRAGMA user_version=1;");old.close();
  const s=new Store(file);try{assert.equal(s.get('SELECT text,session FROM messages').text,'旧历史');assert.equal(s.get('SELECT ai_session FROM peers').ai_session,'legacy');assert.equal(s.get('SELECT hidden,ts FROM transfers').hidden,0);assert.equal(s.get('PRAGMA user_version').user_version,2);}finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
