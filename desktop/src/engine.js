import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { envelope, packets, Reassembler, toxAddress, validate } from '../../protocol/envelope.js';
import { completion } from './llm.js';
import { conversation } from './conversation.js';
const AI_CAPS=['chat','file','agent','llm','ai-session','ai-cancel'];
export class Engine {
  constructor(node,store,{name,downloads,llm=null,bootstrap=[]}) {
    this.node=node;this.store=store;this.name=name;this.downloads=downloads;this.llm=llm;this.bootstrap=bootstrap;
    this.reassembler=new Reassembler();this.jobs=new Map();this.errors=[];this.connections=new Map();this.closed=false;this.lastBootstrap=0;
    this.refresh();this.connect();
    // Previous requests must get an explicit terminal reply after a crash.
    for(const m of store.all("SELECT * FROM messages WHERE direction='in' AND kind='agent.request' AND status='processing'")){
      this.queue(m.peer,envelope('stream.error',{stream:m.id,text:'AI 节点已重启，请重新提问'}),false);store.run("UPDATE messages SET status='stored' WHERE id=? AND peer=?",m.id,m.peer);
    }
  }
  error(e){this.errors.push({time:Date.now(),message:e.message||String(e)});if(this.errors.length>10)this.errors.shift();}
  setModel(llm){
    this.llm=llm;
    for(const [peer,connection] of this.connections)if(connection){try{this.send(peer,envelope('hello',{name:this.name,capabilities:llm?AI_CAPS:['chat','file']}));}catch(e){this.error(e);}}
  }
  refresh(){this.info=this.node.call({op:'info'});for(const f of this.info.friends){this.connections.set(f.peer,f.connection);this.store.peer(f.peer,f.name);}}
  connect(){this.lastBootstrap=Date.now();for(const n of this.bootstrap){try{this.node.call({op:'bootstrap',host:n.host,key:n.key,port:n.port});for(const port of n.tcpPorts||[])this.node.call({op:'bootstrap',host:n.host,key:n.key,port,tcp:true});}catch(e){this.error(e);}}}
  send(peer,p){for(const data of packets(p))this.node.call({op:'send',peer,data});}
  queue(peer,p,show=true){validate(p);this.store.queue(peer,p,show);return p.id;}
  flush(now=Date.now()){
    for(const row of this.store.all('SELECT * FROM outbox WHERE last_attempt<? ORDER BY rowid LIMIT 128',now-5000)){
      if(!this.connections.get(row.peer))continue;
      try{this.send(row.peer,JSON.parse(row.packet));this.store.run('UPDATE outbox SET last_attempt=?,attempts=attempts+1 WHERE id=? AND peer=?',now,row.id,row.peer);this.store.run("UPDATE messages SET status='sending' WHERE id=? AND peer=? AND status='queued'",row.id,row.peer);}catch{break;}
    }
  }
  tick(){
    for(const e of this.node.poll()){try{this.event(e);}catch(err){this.error(err);}}
    if(!this.info.connection&&Date.now()-this.lastBootstrap>60000)this.connect();this.flush();
  }
  event(e){
    if(e.type==='selfConnection'){this.info.connection=e.connection;return;}
    if(e.type==='connection'){
      this.connections.set(e.peer,e.connection);
      if(e.connection){this.store.run('UPDATE outbox SET last_attempt=0 WHERE peer=?',e.peer);this.send(e.peer,envelope('hello',{name:this.name,capabilities:this.llm?AI_CAPS:['chat','file']}));}
      else {for(const t of this.store.all("SELECT * FROM transfers WHERE peer=? AND status IN ('offered','transferring')",e.peer))this.store.run("UPDATE transfers SET status='interrupted' WHERE id=?",t.id);}
      return;
    }
    if(e.type==='name'){this.store.peer(e.peer,e.name);return;}
    if(e.type==='friendRequest'){this.store.run('INSERT OR REPLACE INTO requests(peer,message) VALUES(?,?)',e.peer,e.message);return;}
    if(e.type==='packet'){const p=this.reassembler.read(e.peer,e.data);if(p)this.receive(e.peer,p);return;}
    if(e.type==='error'){this.error(e.message);return;}
    if(e.type==='fileOffer'){this.store.run('INSERT INTO transfers(id,peer,number,name,size,inbound,status,ts) VALUES(?,?,?,?,?,?,?,?)',randomUUID(),e.peer,e.number,e.name,e.size,1,'offered',Date.now());return;}
    if(e.type==='fileProgress')this.store.run("UPDATE transfers SET done=?,status='transferring' WHERE peer=? AND number=? AND status IN ('offered','transferring')",e.done,e.peer,e.number);
    if(e.type==='fileDone')this.store.run("UPDATE transfers SET done=size,status='complete',path=? WHERE peer=? AND number=? AND status IN ('offered','transferring')",e.path,e.peer,e.number);
    if(e.type==='fileCancelled')this.store.run("UPDATE transfers SET status='cancelled' WHERE peer=? AND number=? AND status IN ('offered','transferring')",e.peer,e.number);
  }
  receive(peer,p){
    const s=this.store,b=p.body;
    if(!s.get('SELECT peer FROM peers WHERE peer=?',peer))throw new Error('Unknown sender');
    if(p.t==='ack'){s.ack(peer,b.id);return;}
    if(p.t==='hello'){s.peer(peer,typeof b.name==='string'?b.name.slice(0,128):'');s.run('UPDATE peers SET capabilities=? WHERE peer=?',JSON.stringify(Array.isArray(b.capabilities)?b.capabilities.filter(x=>AI_CAPS.includes(x)):[]),peer);return;}
    const duplicate=s.get('SELECT id FROM received WHERE id=? AND peer=?',p.id,peer);
    if(!duplicate)s.transaction(()=>{
      s.run('INSERT INTO received VALUES(?,?,?)',p.id,peer,Date.now());
      if(p.t==='agent.cancel')s.run('INSERT OR IGNORE INTO ai_cancelled(peer,stream) VALUES(?,?)',peer,b.stream);
      if(p.t==='chat'||p.t==='agent.request')s.run('INSERT OR IGNORE INTO messages(id,peer,direction,kind,text,status,ts,session) VALUES(?,?,?,?,?,?,?,?)',p.id,peer,'in',p.t,b.text,p.t==='agent.request'?'processing':'stored',p.ts,b.session||'legacy');
      if(p.t.startsWith('stream.')){
        const request=s.get("SELECT id,session FROM messages WHERE peer=? AND id=? AND direction='out' AND kind='agent.request'",peer,b.stream);
        if(!request)throw new Error('Unsolicited AI stream');
        s.run('INSERT OR IGNORE INTO messages(id,peer,direction,kind,text,status,ts) VALUES(?,?,?,?,?,?,?)',b.stream+'-reply',peer,'in','stream','', 'streaming',p.ts);
        s.run('UPDATE messages SET session=? WHERE id=? AND peer=?',request.session,b.stream+'-reply',peer);
        if(p.t==='stream.begin'||p.t==='stream.chunk')s.run("UPDATE messages SET status='processing' WHERE id=? AND peer=? AND status NOT IN ('cancelling','cancelled','answered')",b.stream,peer);
        if(p.t==='stream.chunk'){
          const size=s.get('SELECT COALESCE(SUM(length(text)),0) AS n FROM chunks WHERE stream=? AND peer=?',b.stream,peer).n;if(size+b.text.length>256000)throw new Error('AI response too long');
          s.run('INSERT OR IGNORE INTO chunks VALUES(?,?,?,?)',b.stream,peer,b.seq,b.text);const chunks=s.all('SELECT seq,text FROM chunks WHERE stream=? AND peer=? ORDER BY seq',b.stream,peer);
          s.run('UPDATE messages SET text=? WHERE id=? AND peer=?',chunks.map(c=>c.text).join(''),b.stream+'-reply',peer);
        }
        if(p.t==='stream.end')s.run('UPDATE messages SET total=? WHERE id=? AND peer=?',b.total,b.stream+'-reply',peer);
        if(p.t==='stream.error'){
          s.run("UPDATE messages SET status=?,text=text || ? WHERE id=? AND peer=?",b.cancelled?'cancelled':'error','\n'+String(b.text||'AI 请求失败').slice(0,1000),b.stream+'-reply',peer);
          s.run('UPDATE messages SET status=? WHERE id=? AND peer=?',b.cancelled?'cancelled':'failed',b.stream,peer);
        }
        const m=s.get('SELECT total,status FROM messages WHERE id=? AND peer=?',b.stream+'-reply',peer);const chunks=s.get('SELECT COUNT(*) AS n,MIN(seq) AS lo,MAX(seq) AS hi FROM chunks WHERE stream=? AND peer=?',b.stream,peer);
        if(!['error','cancelled'].includes(m.status)&&m.total!==null&&chunks.n===m.total&&(m.total===0||(chunks.lo===0&&chunks.hi===m.total-1))){s.run("UPDATE messages SET status='stored' WHERE id=? AND peer=?",b.stream+'-reply',peer);s.run("UPDATE messages SET status='answered' WHERE id=? AND peer=?",b.stream,peer);}
      }
    });
    try{this.send(peer,envelope('ack',{id:p.id}));}catch(e){this.error(e);}
    if(!duplicate&&p.t==='agent.cancel'){const job=this.jobs.get(b.stream);if(job?.peer===peer){job.stopped=true;job.controller.abort(new Error('已停止生成'));}}
    if(!duplicate&&p.t==='agent.request')this.answer(peer,p).catch(e=>this.error(e));
  }
  async answer(peer,p){
    const b={stream:p.id};let controller;
    const reply=p.id+'-reply';
    this.store.run('INSERT OR IGNORE INTO messages(id,peer,direction,kind,text,status,ts) VALUES(?,?,?,?,?,?,?)',reply,peer,'out','stream','','streaming',Date.now());
    this.store.run('UPDATE messages SET session=? WHERE id=? AND peer=?',p.body.session||'legacy',reply,peer);
    try{
      if(!this.llm)throw new Error('此节点未配置本地模型');if(!this.store.get('SELECT allow_ai FROM peers WHERE peer=?',peer)?.allow_ai)throw new Error('此节点尚未授权你使用 AI');
      if(this.store.get('SELECT stream FROM ai_cancelled WHERE peer=? AND stream=?',peer,p.id))throw new Error('已停止生成');
      if(this.jobs.size>=2||[...this.jobs.values()].some(j=>j.peer===peer))throw new Error('AI 正在处理其他问题，请稍后重试');
      controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),120000);this.jobs.set(p.id,{peer,controller,timeout});
      this.queue(peer,envelope('stream.begin',b),false);let seq=0,size=0;
      for await(const delta of completion({...this.llm,messages:conversation(this.store,peer,p),signal:controller.signal})){
        size+=Buffer.byteLength(delta);if(size>256000||seq>=8192)throw new Error('回答超过上限');
        this.store.run('UPDATE messages SET text=text || ? WHERE id=? AND peer=?',delta,reply,peer);
        const characters=Array.from(delta);for(let i=0;i<characters.length;i+=256)this.queue(peer,envelope('stream.chunk',{...b,seq:seq++,text:characters.slice(i,i+256).join('')}),false);
        this.flush();
      }
      this.queue(peer,envelope('stream.end',{...b,total:seq}),false);
      this.store.run("UPDATE messages SET status='stored' WHERE id=? AND peer=?",reply,peer);
    }catch(e){if(!this.closed){const cancelled=e.message==='已停止生成'||this.jobs.get(p.id)?.stopped;const text=cancelled?'已停止生成':e.message;this.queue(peer,envelope('stream.error',{...b,text,cancelled:!!cancelled}),false);this.store.run("UPDATE messages SET status=?,text=text || ? WHERE id=? AND peer=?",cancelled?'cancelled':'error','\n'+text,reply,peer);}}
    finally{const job=this.jobs.get(p.id);if(job)clearTimeout(job.timeout);this.jobs.delete(p.id);if(!this.closed)this.store.run("UPDATE messages SET status='stored' WHERE id=? AND peer=?",p.id,peer);}
  }
  snapshot(peer){
    const s=this.store;return {platform:'windows',name:this.name,address:this.info.address,connection:this.info.connection,aiConfigured:!!this.llm,
      peers:s.all('SELECT * FROM peers ORDER BY name').map(p=>({...p,capabilities:JSON.parse(p.capabilities),connection:this.connections.get(p.peer)||0,...s.get('SELECT text AS preview,ts FROM messages WHERE peer=? ORDER BY ts DESC LIMIT 1',p.peer)})),
      requests:s.all('SELECT * FROM requests'),messages:peer?s.all('SELECT * FROM (SELECT rowid AS sort,* FROM messages WHERE peer=? ORDER BY ts DESC,rowid DESC LIMIT 300) ORDER BY ts,sort',peer):[],
      transfers:peer?s.all('SELECT * FROM transfers WHERE peer=? AND hidden=0 ORDER BY ts DESC,rowid DESC LIMIT 100',peer):[],outbox:s.get('SELECT COUNT(*) AS n FROM outbox').n,errors:this.errors};
  }
  action(c){
    if(c.op==='snapshot')return this.snapshot(c.peer);
    if(c.op==='add'){const r=this.node.call({op:'add',address:toxAddress(c.address)});this.store.peer(r.peer,c.name||'');this.refresh();return r;}
    if(c.op==='accept'){const r=this.node.call({op:'accept',peer:c.peer});this.store.peer(r.peer);this.store.run('DELETE FROM requests WHERE peer=?',c.peer);this.refresh();return r;}
    if(c.op==='reject'){this.store.run('DELETE FROM requests WHERE peer=?',c.peer);return {ok:true};}
    if(c.op==='name'){const name=String(c.name).trim();if(!name||Buffer.byteLength(name)>128)throw new Error('名称需在 1–128 字节内');this.node.call({op:'name',name});this.name=name;return {ok:true};}
    if(!this.store.get('SELECT peer FROM peers WHERE peer=?',c.peer))throw new Error('未找到联系人');
    if(c.op==='chat'||c.op==='agent.request'){const body={text:c.text};if(c.op==='agent.request')body.session=this.store.get('SELECT ai_session FROM peers WHERE peer=?',c.peer).ai_session;const p=envelope(c.op,body);this.queue(c.peer,p);this.flush();return {id:p.id};}
    if(c.op==='newAISession'){const session=randomUUID();this.store.run('UPDATE peers SET ai_session=? WHERE peer=?',session,c.peer);return {ok:true,session};}
    if(c.op==='cancelAI'){
      const request=this.store.get("SELECT status FROM messages WHERE id=? AND peer=? AND direction='out' AND kind='agent.request'",c.id,c.peer);
      if(!request||['answered','failed','cancelled'].includes(request.status))throw new Error('此问题已结束');
      const out=this.store.get('SELECT attempts FROM outbox WHERE id=? AND peer=?',c.id,c.peer);
      if(out?.attempts===0){this.store.run('DELETE FROM outbox WHERE id=? AND peer=?',c.id,c.peer);this.store.run("UPDATE messages SET status='cancelled' WHERE id=? AND peer=?",c.id,c.peer);return {ok:true,local:true};}
      if(!JSON.parse(this.store.get('SELECT capabilities FROM peers WHERE peer=?',c.peer).capabilities).includes('ai-cancel'))throw new Error('请先升级对方的 ToChat 以支持停止生成');
      this.queue(c.peer,envelope('agent.cancel',{stream:c.id}),false);this.store.run("UPDATE messages SET status='cancelling' WHERE id=? AND peer=?",c.id,c.peer);this.flush();return {ok:true};
    }
    if(c.op==='allowAI'){this.store.run('UPDATE peers SET allow_ai=? WHERE peer=?',c.allow?1:0,c.peer);return {ok:true};}
    if(c.op==='sendFile'){const r=this.node.call(c);this.store.run('INSERT INTO transfers(id,peer,number,name,size,inbound,status,path,ts) VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),c.peer,r.number,r.name,r.size,0,'offered',c.path,Date.now());return r;}
    if(['hideTransfer','restoreTransfer','retryFile'].includes(c.op)){
      const t=this.store.get("SELECT * FROM transfers WHERE id=? AND peer=? AND status IN ('cancelled','interrupted')",c.id,c.peer);if(!t)throw new Error('只能处理已取消或中断的附件');
      if(c.op==='retryFile'){if(t.inbound)throw new Error('请让发送方重新发送');if(!this.connections.get(c.peer))throw new Error('对方离线，请上线后重发');return this.action({op:'sendFile',peer:c.peer,path:t.path,name:t.name});}
      this.store.run('UPDATE transfers SET hidden=? WHERE id=? AND peer=?',c.op==='hideTransfer'?1:0,c.id,c.peer);return {ok:true};
    }
    if(c.op==='acceptFile'||c.op==='cancelFile'){
      const t=this.store.get('SELECT * FROM transfers WHERE id=? AND peer=?',c.id,c.peer);if(!t||!['offered','transferring'].includes(t.status))throw new Error('传输已结束');
      const filename=path.basename(t.name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');const dest=path.join(this.downloads,t.id+'-'+filename);
      const r=this.node.call({op:c.op,peer:c.peer,number:t.number,path:dest});this.store.run('UPDATE transfers SET status=?,path=? WHERE id=?',c.op==='acceptFile'?'transferring':'cancelled',dest,t.id);return r;
    }
    throw new Error('未知操作');
  }
  close(){this.closed=true;for(const job of this.jobs.values()){clearTimeout(job.timeout);job.controller.abort();}this.node.close();this.store.close();}
}
