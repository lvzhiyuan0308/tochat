/* ToChat UI talks only to the local Windows API or Android's private asset bridge. */
const $=id=>document.getElementById(id);
const el=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
let selected=null,state=null,busy=false,polling=false,lastRender='',lastContacts='',notice='',toastTimer;
const native=!!window.ToChat;
async function action(c){let r;if(native)r=JSON.parse(window.ToChat.request(JSON.stringify(c)));else{const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c)});if(response.status===401)throw new Error('请从启动脚本输出的地址重新打开界面');r=await response.json();}if(r.error)throw new Error(r.error);return r;}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
const status=c=>c===2?'UDP 连接':c===1?'TCP 中继':'离线';
const initials=p=>(p?.name||p?.peer||'T').slice(0,1).toUpperCase();
const name=p=>p.name||p.peer.slice(0,8)+'…';
const time=ts=>new Date(ts).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
const sizes=n=>n<1024?n+' B':n<1024**2?(n/1024).toFixed(1)+' KB':(n/1024**2).toFixed(1)+' MB';
function open(id){$(id).showModal();}
function select(peer){selected=peer;lastRender='';document.querySelector('.workspace').classList.add('selected');refresh();}
async function refresh(){
  if(polling)return;polling=true;
  try{state=await action({op:'snapshot',peer:selected});render();}catch(e){$('self-status').textContent='本地节点未响应';$('self-dot').className='dot';$('notice').textContent='无法读取此设备的节点状态：'+e.message;$('notice').hidden=false;}finally{polling=false;}
}
function render(){
  $('self-name').textContent=state.name;$('self-status').textContent=status(state.connection);$('self-dot').className='dot'+(state.connection?' online':'');
  $('outbox-count').textContent=state.outbox?state.outbox+' 个数据包等待送达':'历史保存在此设备';
  const query=$('search').value.toLowerCase();const list=state.peers.filter(p=>(name(p)+' '+p.peer).toLowerCase().includes(query));
  const contactKey=JSON.stringify([list,state.requests,selected]);
  if(contactKey!==lastContacts){lastContacts=contactKey;$('contacts').replaceChildren();
    for(const p of list){const button=el('button','contact'+(p.peer===selected?' active':''));const avatar=el('span','avatar',initials(p));const copy=el('span','contact-copy');copy.append(el('strong','',name(p)),el('p','',p.preview||status(p.connection)));button.append(avatar,copy,el('span','contact-meta',p.connection?'在线':'离线'));button.onclick=()=>select(p.peer);$('contacts').append(button);}
    if(!list.length)$('contacts').append(el('p','empty-chat',state.peers.length?'没有匹配的联系人':'还没有联系人。点击 ＋ 添加。'));
    $('requests').replaceChildren();for(const r of state.requests){const card=el('div','request');card.append(el('strong','',r.peer.slice(0,12)+'…'),el('p','',r.message));const buttons=el('div','buttons');for(const [op,label] of [['accept','接受'],['reject','忽略']]){const button=el('button','secondary',label);button.onclick=async()=>{try{await action({op,peer:r.peer});if(op==='accept')select(r.peer);await refresh();}catch(e){toast(e.message);}};buttons.append(button);}card.append(buttons);$('requests').append(card);}
  }
  const p=state.peers.find(p=>p.peer===selected);if(!p)return;
  $('composer').hidden=false;$('peer-details').hidden=false;$('peer-name').textContent=name(p);$('peer-avatar').textContent=initials(p);
  $('peer-status').textContent=status(p.connection)+(p.capabilities.includes('agent')?' · 个人 AI 节点':' · Tox 联系人');
  $('queue-hint').textContent=p.connection?'消息直接发给对方':'对方离线，消息会保存在此设备等待重连';
  if(!p.capabilities.includes('agent'))$('ai-mode').checked=false;$('ai-mode').disabled=!p.capabilities.includes('agent');
  const messageKey=JSON.stringify([state.messages,state.transfers]);if(messageKey!==lastRender){
    const area=$('messages');const atEnd=area.scrollHeight-area.scrollTop-area.clientHeight<120||!lastRender;lastRender=messageKey;area.replaceChildren();let previous='';
    for(const m of state.messages){const day=new Date(m.ts).toLocaleDateString('zh-CN');if(day!==previous){area.append(el('div','day-label',day));previous=day;}
      const row=el('div','message-row '+m.direction);const bubble=el('div','bubble'+(m.kind==='stream'?' ai':''));
      if(m.kind==='stream'||m.kind==='agent.request')bubble.append(el('span','message-label',m.kind==='stream'?'AI 回答':'AI 提问'));
      bubble.append(el('span','message-text',m.text||'正在思考…'));const labels={queued:'待发送',sending:'等待送达',delivered:'已送达',stored:'',streaming:'回答中…',processing:'处理中…',error:'回答中断'};
      const meta=el('div','message-meta'+(m.status==='error'?' error':''));meta.append(el('span','',time(m.ts)),el('span','',labels[m.status]||''));bubble.append(meta);row.append(bubble);area.append(row);
    }
    if(!state.messages.length)area.append(el('div','empty-chat','你们的聊天历史将保存在此设备。发送第一条消息吧。'));
    if(atEnd)area.scrollTop=area.scrollHeight;
    $('transfers').replaceChildren();for(const t of state.transfers){const card=el('div','transfer');const copy=el('div','transfer-copy');const labels={offered:t.inbound?'等待接收':'等待对方接收',transferring:'正在传输',complete:'已完成',cancelled:'已取消',interrupted:'连接中断，请重新发送'};copy.append(el('strong','',t.name),el('span','',sizes(t.size)+' · '+labels[t.status]));if(t.status==='transferring'){const bar=el('progress');bar.max=t.size||1;bar.value=t.done;copy.append(bar);}card.append(copy);
      for(const [op,label] of t.status==='offered'&&t.inbound?[['acceptFile','接收'],['cancelFile','拒绝']]:['offered','transferring'].includes(t.status)?[['cancelFile','取消']]:[]){const b=el('button','secondary',label);b.onclick=async()=>{try{await action({op,peer:selected,id:t.id});await refresh();}catch(e){toast(e.message);}};card.append(b);} $('transfers').append(card);
      if(t.status==='complete'&&t.inbound){const b=el('button','secondary','保存副本');b.onclick=async()=>{try{if(native)await action({op:'saveFile',peer:selected,id:t.id});else{const link=el('a');link.href='/api/download?peer='+encodeURIComponent(selected)+'&id='+encodeURIComponent(t.id);link.download=t.name;link.click();}}catch(e){toast(e.message);}};card.append(b);}
    }
  }
  const lastError=state.errors?.at(-1);const newNotice=lastError&&Date.now()-lastError.time<30000?lastError.message:'';if(newNotice!==notice){notice=newNotice;$('notice').textContent=notice;$('notice').hidden=!notice;}
}
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
for(const d of document.querySelectorAll('dialog'))d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();});
$('add').onclick=$('welcome-add').onclick=()=>{$('add-error').textContent='';open('add-dialog');};
$('search').oninput=()=>state&&render();$('back').onclick=()=>document.querySelector('.workspace').classList.remove('selected');
$('add-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const r=await action({op:'add',address:$('tox-address').value,name:$('contact-name').value.trim()});$('add-dialog').close();$('add-form').reset();select(r.peer);toast('好友请求已发送，等待对方接受');}catch(err){$('add-error').textContent=err.message;}finally{button.disabled=false;}};
$('identity').onclick=()=>{if(!state)return;$('my-address').textContent=state.address;$('device-name').value=state.name;$('qr').replaceChildren();const qr=qrcode(0,'M');qr.addData('tox:'+state.address);qr.make();const wrapper=el('div');wrapper.innerHTML=qr.createSvgTag({cellSize:4,margin:2,scalable:true});wrapper.querySelector('svg').setAttribute('aria-label','我的 Tox ID 二维码');$('qr').append(wrapper);$('ai-config-info').textContent=state.aiConfigured?'模型已配置 · 需逐个授权联系人':'未配置模型';$('android-mode').hidden=!native;$('realtime').checked=!!state.realtime;open('identity-dialog');};
$('copy-id').onclick=async()=>{try{if(native)await action({op:'copy',text:state.address});else await navigator.clipboard.writeText(state.address);toast('已复制 Tox ID');}catch{toast('请长按或选中上方 ID 复制');}};
$('name-form').onsubmit=async e=>{e.preventDefault();try{await action({op:'name',name:$('device-name').value});toast('设备名称已保存');await refresh();}catch(err){toast(err.message);}};
$('realtime').onchange=async()=>{try{await action({op:'mode',realtime:$('realtime').checked});await refresh();}catch(e){toast(e.message);}};
$('peer-details').onclick=()=>{const p=state.peers.find(p=>p.peer===selected);$('peer-id').textContent=p.peer;$('ai-permission').hidden=!state.aiConfigured;$('allow-ai').checked=!!p.allow_ai;open('peer-dialog');};
$('allow-ai').onchange=async()=>{try{await action({op:'allowAI',peer:selected,allow:$('allow-ai').checked});toast($('allow-ai').checked?'已授权此联系人使用 AI':'已撤销 AI 授权');await refresh();}catch(e){toast(e.message);}};
$('composer').onsubmit=async e=>{e.preventDefault();if(busy||!selected||!$('message').value.trim())return;busy=true;$('send').disabled=true;try{await action({op:$('ai-mode').checked?'agent.request':'chat',peer:selected,text:$('message').value});$('message').value='';await refresh();}catch(err){toast(err.message);}finally{busy=false;$('send').disabled=false;$('message').focus();}};
$('message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('composer').requestSubmit();}};
$('attach').onclick=async()=>{if(!state.peers.find(p=>p.peer===selected)?.connection){toast('文件发送需要对方在线');return;}if(native){try{await action({op:'pickFile',peer:selected});}catch(e){toast(e.message);}}else $('file-picker').click();};
$('file-picker').onchange=async e=>{const file=e.target.files[0];if(!file)return;$('attach').disabled=true;try{toast('正在准备文件…');const r=await (await fetch('/api/upload?peer='+encodeURIComponent(selected)+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file})).json();if(r.error)throw new Error(r.error);await refresh();}catch(err){toast(err.message);}finally{$('attach').disabled=false;e.target.value='';}};
$('scan').onclick=()=>$('qr-picker').click();
$('qr-picker').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const bitmap=await createImageBitmap(file);const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=bitmap.width*scale;canvas.height=bitmap.height*scale;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const code=jsQR(pixels.data,pixels.width,pixels.height);if(!code)throw new Error('没有识别到二维码，请选择清晰、完整的二维码图片');$('tox-address').value=code.data;$('add-error').textContent='已读取二维码，请确认后发送好友请求';}catch(err){$('add-error').textContent=err.message;}finally{e.target.value='';}};
window.tochatFileResult=msg=>{toast(msg);refresh();};refresh();setInterval(refresh,1000);
