import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, createWriteStream, createReadStream, existsSync, writeFileSync, openSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { ToxNode } from './tox-node.js';
import { profileKey } from './profile-key.js';
import { Store } from '../../shared/storage.js';
import { Engine } from './engine.js';
import { modelFromSaved, prepareModel, publicModel, protectSecret } from './model-settings.js';
import { createFileSaver } from './save-file.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const data=path.resolve(process.env.TOCHAT_DATA||path.join(root,'data/windows'));
mkdirSync(data,{recursive:true});mkdirSync(path.join(data,'downloads'),{recursive:true});mkdirSync(path.join(data,'uploads'),{recursive:true});
const lock=path.join(data,'node.lock');
if(existsSync(lock)){
  let active=false;try{const pid=Number(readFileSync(lock,'utf8'));if(Number.isInteger(pid)&&pid>0){process.kill(pid,0);active=true;}}catch{}
  if(active){console.log('此数据目录的 ToChat 已在运行，请打开 '+path.join(data,'launcher.url'));process.exit(0);}
  unlinkSync(lock);
}
const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));closeSync(fd);
process.once('exit',()=>{try{unlinkSync(lock);}catch{}});
const configPath=path.join(data,'settings.json');const config=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')):{};
const name=config.name||process.env.TOCHAT_NAME||'我的 Windows';
const llm=config.llm?modelFromSaved(config.llm):process.env.LLM_BASE_URL?{baseURL:process.env.LLM_BASE_URL,key:process.env.LLM_API_KEY||'',model:process.env.LLM_MODEL||'local-model'}:null;
function saveConfig(next){writeFileSync(configPath+'.tmp',JSON.stringify(next,null,2));renameSync(configPath+'.tmp',configPath);Object.assign(config,next);}
const bootstrap=JSON.parse(readFileSync(path.join(root,'shared/bootstrap.json'),'utf8'));
let engine;
try{engine=new Engine(new ToxNode({profile:path.join(data,'identity.tox'),password:profileKey(path.join(data,'identity.key')),name,udp:process.env.TOCHAT_TCP_ONLY!=='1'}),new Store(path.join(data,'history.sqlite')),{name,downloads:path.join(data,'downloads'),llm,bootstrap});}
catch(e){console.error('ToChat 启动失败：'+e.message);console.error('首次运行请先执行 npm run build:native。');process.exit(1);}
const timer=setInterval(()=>{try{engine.tick();}catch(e){engine.error(e);}},100);
const saveFile=createFileSaver(engine.store,path.join(data,'downloads'));
const token=randomBytes(32).toString('hex');
const eq=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
  try{
    const host=req.headers.host,allowed='127.0.0.1:'+server.address().port;
    if(host!==allowed)throw new Error('Invalid host');
    const url=new URL(req.url,'http://'+allowed);
    if(url.pathname==='/'&&eq(url.searchParams.get('token'),token)) {res.setHeader('Set-Cookie',`tochat=${token}; HttpOnly; SameSite=Strict; Path=/`);res.writeHead(303,{Location:'/'});res.end();return;}
    const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('tochat='))?.slice(7);
    if(!eq(cookie,token)){res.writeHead(401);res.end('请使用启动脚本输出的 ToChat 地址打开界面。');return;}
    if(req.method==='POST'&&req.headers.origin!=='http://'+allowed)throw new Error('Invalid origin');
    if(url.pathname==='/api/action'&&req.method==='POST'){
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>100000)throw new Error('Request too large');}
      const c=JSON.parse(raw);if(['sendFile'].includes(c.op))throw new Error('Use the file picker');
      let r;
      if(c.op==='saveFile')r=await saveFile(c);
      else if(c.op==='modelSettings')r=publicModel(config.llm,engine.llm);
      else if(c.op==='saveModel'){
        const previous=config.llm||{protectedKey:engine.llm?.key?protectSecret(engine.llm.key):''};
        const saved=prepareModel(c,previous);const nextLLM=modelFromSaved(saved);
        saveConfig({...config,llm:saved});engine.setModel(nextLLM);r=publicModel(saved,nextLLM);
      }else r=engine.action(c);
      if(c.op==='name')saveConfig({...config,name:engine.name});
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(r));return;
    }
    if(url.pathname==='/api/upload'&&req.method==='POST'){
      const peer=url.searchParams.get('peer');if(!engine.store.get('SELECT peer FROM peers WHERE peer=?',peer)||!engine.connections.get(peer))throw new Error('联系人离线，请上线后发送文件');
      const name=path.basename(url.searchParams.get('name')||'file').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');const dest=path.join(data,'uploads',randomUUID()+'-'+name);
      let size=0;const limit=new Transform({transform(chunk,encoding,cb){size+=chunk.length;cb(size>1024**3?new Error('File exceeds 1 GiB'):null,chunk);}});
      await pipeline(req,limit,createWriteStream(dest,{flags:'wx'}));const r=engine.action({op:'sendFile',peer,path:dest,name});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(r));return;
    }
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    if(url.pathname==='/api/download'){
      const t=engine.store.get("SELECT * FROM transfers WHERE id=? AND peer=? AND inbound=1 AND status='complete'",url.searchParams.get('id'),url.searchParams.get('peer'));
      if(!t||!existsSync(t.path))throw new Error('文件不存在');
      res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(t.name));await pipeline(createReadStream(t.path),res);return;
    }
    const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/qrcode.js':'qrcode.js','/jsQR.js':'jsQR.js'};
    if(!files[url.pathname]){res.writeHead(404);res.end();return;}
    const filename=path.join(root,'desktop/ui',files[url.pathname]);res.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');res.end(readFileSync(filename));
  }catch(e){if(res.headersSent)res.destroy();else{res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.message}));}}
});
server.listen(Number(process.env.TOCHAT_PORT||8788),'127.0.0.1',()=>{
  const url=`http://127.0.0.1:${server.address().port}/?token=${token}`;
  console.log('ToChat 0.1 已启动，聊天通过 Tox 对等网络传输。');console.log('打开界面：'+url);console.log('数据目录：'+data);
  writeFileSync(path.join(data,'launcher.url'),'[InternetShortcut]\r\nURL='+url+'\r\n');
  if(process.env.TOCHAT_OPEN==='1')import('node:child_process').then(({spawn})=>spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}));
});
server.on('error',e=>{console.error('ToChat 界面启动失败：'+e.message);close();process.exit(1);});
function close(){clearInterval(timer);server.close();engine.close();}
process.once('SIGINT',()=>{close();process.exit(0);});process.once('SIGTERM',()=>{close();process.exit(0);});
