// Isolated preview data for responsive/layout QA; no real contacts or model calls.
import { spawn } from 'node:child_process';
import { mkdirSync,copyFileSync,readFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../shared/storage.js';
const root=path.resolve('build/ui-layout');mkdirSync(path.join(root,'downloads'),{recursive:true});
const store=new Store(path.join(root,'history.sqlite')),peer='C'.repeat(64),now=Date.now();
store.peer(peer,'家里的 AI 电脑');store.run("UPDATE peers SET capabilities=? WHERE peer=?",JSON.stringify(['chat','file','agent','llm','ai-session','ai-cancel']),peer);
store.run('DELETE FROM messages');store.run('DELETE FROM outbox');store.run('DELETE FROM transfers');
const message=(id,direction,kind,text,status,ts)=>store.run('INSERT INTO messages(id,peer,direction,kind,text,status,ts) VALUES(?,?,?,?,?,?,?)',id,peer,direction,kind,text,status,ts);
for(let i=0;i<10;i++)message('earlier-'+i,i%2?'in':'out','chat','这是较早的聊天记录 '+(i+1)+'，用于验证翻看历史时不会被新消息打断。','stored',now-600000+i*1000);
message('city','out','agent.request','介绍下北京','answered',now-100000);
message('city-reply','in','stream','# 北京\n\n北京是中国的**首都**，历史与现代生活在这里交汇。\n\n### 值得一去\n- 故宫：沿中轴线走进历史。\n- 颐和园：湖畔的皇家园林。\n- 胡同：感受老北京的日常。','stored',now-90000);
const img=path.join(root,'downloads','example.png');copyFileSync('docs/qa-desktop.png',img);
store.run('INSERT INTO transfers(id,peer,number,name,size,done,inbound,status,path,ts) VALUES(?,?,?,?,?,?,?,?,?,?)','sample-file',peer,0,'旅行清单截图.png',readFileSync(img).length,readFileSync(img).length,1,'complete',img,now-80000);
store.run('INSERT INTO transfers(id,peer,number,name,size,inbound,status,ts) VALUES(?,?,?,?,?,?,?,?)','failed-file',peer,1,'行程资料.pdf',430080,1,'interrupted',now-70000);
message('follow','out','agent.request','刚才介绍的是哪个城市？','answered',now-60000);
message('follow-reply','in','stream','刚才介绍的是 **北京**。\n\n我会保留当前会话的上下文，你可以继续问景点、路线或美食。','stored',now-50000);
if(process.env.TOCHAT_UI_SECURITY==='1')message('security','in','stream','<img src=x onerror="window.BAD=true">\n[坏链接](javascript:alert(1))\n```html\n<script>alert(1)</script>\n```','stored',now-40000);
const child=spawn(process.execPath,['desktop/src/main.js'],{env:{...process.env,TOCHAT_DATA:root,TOCHAT_PORT:'0',TOCHAT_OPEN:'0'},stdio:['ignore','pipe','inherit']});child.stdout.pipe(process.stdout);
process.stdin.setEncoding('utf8');process.stdin.on('data',command=>{if(command.trim()==='append'){message('append-'+Date.now(),'in','chat','新消息到达，阅读位置应保持稳定。','stored',Date.now());console.log('APPENDED');}if(command.trim()==='security'){message('security-'+Date.now(),'in','stream','<img src=x onerror="alert(1)">\n[坏链接](javascript:alert(1))\n```html\n<script>alert(1)</script>\n```','stored',Date.now());console.log('SECURITY FIXTURE ADDED');}});
function close(){child.kill();store.close();}
process.once('SIGINT',()=>{close();process.exit(0);});process.once('SIGTERM',()=>{close();process.exit(0);});child.once('exit',code=>process.exit(code||0));
