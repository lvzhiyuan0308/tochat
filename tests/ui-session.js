// Isolated, real Tox peer for manual browser QA. Never uses data/windows.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ToxNode } from '../desktop/src/tox-node.js';
import { Engine } from '../desktop/src/engine.js';
import { Store } from '../shared/storage.js';
const root=path.resolve('build/ui-qa');mkdirSync(root,{recursive:true});
const peer=new ToxNode({profile:path.join(root,'friend.tox'),password:'9'.repeat(64),name:'另一台测试设备'});
const bootstrap=JSON.parse(readFileSync(new URL('../shared/bootstrap.json',import.meta.url),'utf8'));
const engine=new Engine(peer,new Store(path.join(root,'friend.sqlite')),{name:'另一台测试设备',downloads:path.join(root,'downloads'),bootstrap});
const child=spawn(process.execPath,['desktop/src/main.js'],{env:{...process.env,TOCHAT_PORT:'8790',TOCHAT_DATA:path.join(root,'desktop'),TOCHAT_NAME:'界面验收设备',TOCHAT_OPEN:'0'},stdio:'inherit'});
const timer=setInterval(()=>engine.tick(),100);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const launcher=path.join(root,'desktop','launcher.url');
try{
  const deadline=Date.now()+30000;while(!existsSync(launcher)){if(Date.now()>deadline)throw new Error('UI QA startup timed out');await sleep(100);}
  const url=readFileSync(launcher,'utf8').match(/URL=(.*)/)[1].trim();const token=new URL(url).searchParams.get('token');
  const action=async c=>{const response=await fetch('http://127.0.0.1:8790/api/action',{method:'POST',headers:{Origin:'http://127.0.0.1:8790',Cookie:'tochat='+token,'Content-Type':'application/json'},body:JSON.stringify(c)});const r=await response.json();if(r.error)throw new Error(r.error);return r;};
  const other=peer.call({op:'info'});const snapshot=await action({op:'snapshot'});if(!snapshot.peers.length)await action({op:'add',address:other.address,name:'另一台测试设备'});
  engine.action({op:'accept',peer:snapshot.address.slice(0,64)});
  console.log('UI QA URL: '+url);
  await sleep(1000);
  for(let i=0;i<600;i++){
    const s=await action({op:'snapshot',peer:other.address.slice(0,64)});const row=s.peers.find(x=>x.peer===other.address.slice(0,64));
    if(row?.connection){engine.action({op:'chat',peer:snapshot.address.slice(0,64),text:'你好，这是通过真实 Tox 通道送达的界面验收消息。'});console.log('UI QA peer online');break;}await sleep(100);
  }
}catch(e){console.error(e.message);clearInterval(timer);engine.close();child.kill();process.exit(1);}
process.once('SIGINT',()=>{clearInterval(timer);engine.close();child.kill();process.exit(0);});
