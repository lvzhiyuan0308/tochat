/* ToChat UI talks only to the local Windows API or Android's private asset bridge. */
const $=id=>document.getElementById(id);
const el=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
let selected=null,state=null,busy=false,polling=false,lastRender='',lastContacts='',notice='',toastTimer;
const native=!!window.ToChat;
const modes=new Map(),openedTransfers=new Map(),savingTransfers=new Set();let activeAI=null;
async function action(c){let r;if(native)r=JSON.parse(window.ToChat.request(JSON.stringify(c)));else{const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c)});if(response.status===401)throw new Error('请从启动脚本输出的地址重新打开界面');r=await response.json();}if(r.error)throw new Error(r.error);return r;}
function toast(text,undo){$('toast').replaceChildren(el('span','',text));if(undo){const b=el('button','secondary','撤销');b.onclick=undo;$('toast').append(b);}$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,undo?8000:5000);}
const status=c=>c===2?'UDP 连接':c===1?'TCP 中继':'离线';
const initials=p=>(p?.name||p?.peer||'T').slice(0,1).toUpperCase();
const name=p=>p.name||p.peer.slice(0,8)+'…';
const time=ts=>new Date(ts).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
const sizes=n=>n<1024?n+' B':n<1024**2?(n/1024).toFixed(1)+' KB':(n/1024**2).toFixed(1)+' MB';
function open(id){$(id).showModal();}
function select(peer){selected=peer;$('ai-mode').checked=!!modes.get(peer);lastRender='';document.querySelector('.workspace').classList.add('selected');refresh();}
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
  if(!p.capabilities.includes('agent'))$('ai-mode').checked=false;
  syncMode(p);
  const ai=$('ai-mode').checked;
  $('queue-hint').textContent=p.connection?(ai?'保留当前 AI 会话上下文':'消息直接发给对方'):(ai?'对方离线 · 上线后处理':'对方离线 · 消息已保留，等待重连');
  $('send').textContent=p.connection?'发送':'排队';
  activeAI=[...state.messages].reverse().find(m=>m.direction==='out'&&m.kind==='agent.request'&&!['answered','failed','cancelled'].includes(m.status)&&!state.messages.some(r=>r.id===m.id+'-reply'&&['stored','error','cancelled'].includes(r.status)));
  $('stop-ai').hidden=!activeAI;$('stop-ai').disabled=!!activeAI&&(activeAI.status==='cancelling'||(!p.capabilities.includes('ai-cancel')&&activeAI.status!=='queued'));
  $('stop-ai').textContent=activeAI?.status==='cancelling'?'等待停止…':activeAI?.status==='queued'?'取消排队':'停止生成';
  const messageKey=JSON.stringify([state.messages,state.transfers]);if(messageKey!==lastRender){
    const area=$('messages'),atEnd=area.scrollHeight-area.scrollTop-area.clientHeight<70||!lastRender,oldTop=area.scrollTop;
    const anchor=[...area.querySelectorAll('[data-key]')].find(e=>e.getBoundingClientRect().bottom>area.getBoundingClientRect().top);
    const anchorKey=anchor?.dataset.key,anchorOffset=anchor?anchor.getBoundingClientRect().top-area.getBoundingClientRect().top:0;
    lastRender=messageKey;area.replaceChildren();let previous='',session=null;
    const entries=[...state.messages.map(m=>({...m,entry:'message'})),...state.transfers.map(t=>({...t,entry:'file'}))].sort((a,b)=>a.ts-b.ts||(a.sort||0)-(b.sort||0));
    for(const m of entries){
      const day=m.ts?new Date(m.ts).toLocaleDateString('zh-CN'):'较早附件（升级前）';if(day!==previous){area.append(el('div','day-label',day));previous=day;}
      if(m.entry==='file'){area.append(fileCard(m,p.peer));continue;}
      if(m.kind==='agent.request'&&m.session!==session){if(m.session&&m.session!=='legacy')area.append(el('div','session-label','新的 AI 对话'));session=m.session;}
      const row=el('div','message-row '+m.direction);row.dataset.key='message-'+m.id;const bubble=el('div','bubble'+(m.kind==='stream'?' ai':''));
      if(m.kind==='stream'||m.kind==='agent.request')bubble.append(el('span','message-label',m.kind==='stream'?'AI 回答':'AI 提问'));
      const text=el('div','message-text'+(m.kind==='stream'?' markdown':''));if(m.kind==='stream'&&m.text)text.append(tochatMarkdown.render(m.text));else text.textContent=m.text||'正在生成…';bubble.append(text);
      const labels={queued:m.kind==='agent.request'?'已排队 · 上线后处理':'已排队',sending:'等待对方接收',delivered:m.kind==='agent.request'?'对方已收到 · 等待处理':'对方已收到',stored:'',streaming:'回答中…',processing:'AI 已开始回答',answered:'已回答',failed:'处理失败',cancelling:'等待停止…',cancelled:'已停止',error:'回答中断'};
      const meta=el('div','message-meta'+(m.status==='error'?' error':''));meta.append(el('span','',time(m.ts)),el('span','',labels[m.status]||''));bubble.append(meta);
      if(m.kind==='stream'&&m.text){const tools=el('div','message-tools');const copy=el('button','quiet','复制回答');copy.type='button';copy.onclick=()=>copyText(m.text);tools.append(copy);bubble.append(tools);}
      row.append(bubble);area.append(row);
    }
    if(!entries.length)area.append(el('div','empty-chat','发送第一条消息，开始你们的连接。'));
    if(atEnd)area.scrollTop=area.scrollHeight;else{const restored=[...area.querySelectorAll('[data-key]')].find(e=>e.dataset.key===anchorKey);area.scrollTop=oldTop;if(restored)area.scrollTop+=restored.getBoundingClientRect().top-area.getBoundingClientRect().top-anchorOffset;}
    updateLatest();
  }
  updateLatest();
  const lastError=state.errors?.at(-1);const newNotice=lastError&&Date.now()-lastError.time<30000?lastError.message:'';if(newNotice!==notice){notice=newNotice;$('notice').textContent=notice;$('notice').hidden=!notice;}
}
function syncMode(p){
  const ai=$('ai-mode').checked;$('chat-mode').setAttribute('aria-pressed',String(!ai));$('assistant-mode').setAttribute('aria-pressed',String(ai));$('assistant-mode').disabled=!p?.capabilities.includes('agent');
  $('new-session').hidden=!ai;$('new-session').disabled=!p?.capabilities.includes('ai-session');$('new-session').title=p?.capabilities.includes('ai-session')?'开始新对话，旧聊天记录仍保留':'升级对方的 ToChat 后可开始新会话';
  $('message').placeholder=ai?'向此设备的 AI 提问…':'写下消息…';
}
function updateLatest(){const a=$('messages');$('latest').hidden=a.scrollHeight-a.scrollTop-a.clientHeight<80;}
async function copyText(text){try{if(native)await action({op:'copy',text});else await navigator.clipboard.writeText(text);toast('已复制');}catch{toast('复制失败，请长按文字复制');}}
function fileCard(t,peer){
  const row=el('div','message-row '+(t.inbound?'in':'out'));row.dataset.key='file-'+t.id;const card=el('details','file-card');card.open=openedTransfers.get(t.id)??['offered','transferring'].includes(t.status);card.ontoggle=()=>openedTransfers.set(t.id,card.open);
  const summary=el('summary'),copy=el('div','transfer-copy'),labels={offered:t.inbound?'等待接收':'等待对方接收',transferring:'正在传输',complete:'已完成',cancelled:'已取消',interrupted:'连接中断 · 请重发'};
  if(t.status==='complete'&&t.size<=8*1024*1024&&/\.(png|jpe?g|gif|webp)$/i.test(t.name)){
    const img=el('img','file-thumb');img.loading='lazy';img.alt='图片附件';img.src=(native?'/preview':'/api/preview')+'?peer='+encodeURIComponent(peer)+'&id='+encodeURIComponent(t.id);img.onerror=()=>img.remove();
    img.onclick=e=>{e.preventDefault();e.stopPropagation();$('preview-name').textContent=t.name;$('preview-image').src=img.src;open('preview-dialog');};summary.append(img);
  }else summary.append(el('span','file-badge','文件'));
  copy.append(el('strong','',t.name),el('span','',sizes(t.size)+' · '+labels[t.status]+(t.ts?' · '+time(t.ts):'')));summary.append(copy,el('span','file-expand','⌄'));card.append(summary);
  const body=el('div','file-actions');
  if(t.status==='transferring'){const bar=el('progress');bar.max=t.size||1;bar.value=t.done;body.append(bar,el('span','muted',Math.floor(t.done/(t.size||1)*100)+'%'));}
  function button(label,callback){const b=el('button','secondary',label);b.type='button';b.onclick=async()=>{b.disabled=true;try{await callback();}catch(e){toast(e.message);}finally{b.disabled=false;}};body.append(b);return b;}
  for(const [op,label] of t.status==='offered'&&t.inbound?[['acceptFile','接收'],['cancelFile','拒绝']]:['offered','transferring'].includes(t.status)?[['cancelFile','取消']]:[])button(label,async()=>{await action({op,peer,id:t.id});await refresh();});
  if(t.status==='complete'&&t.inbound){const b=button(savingTransfers.has(t.id)?'选择保存位置…':'保存副本',async()=>{savingTransfers.add(t.id);b.textContent='选择保存位置…';try{if(!native)toast('已打开 Windows 保存窗口');const r=await action({op:'saveFile',peer,id:t.id});if(!native)toast(r.cancelled?'已取消保存':'副本已保存至：'+r.path);}finally{savingTransfers.delete(t.id);b.textContent='保存副本';}});b.disabled=savingTransfers.has(t.id);}
  if(['cancelled','interrupted'].includes(t.status)){
    if(!t.inbound)button('重新发送',async()=>{await action({op:'retryFile',peer,id:t.id});await refresh();toast('已重新发送');});else body.append(el('span','muted','请让对方重新发送此附件'));
    button('移除记录',async()=>{await action({op:'hideTransfer',peer,id:t.id});await refresh();toast('已移除附件记录，原文件仍保留',async()=>{try{await action({op:'restoreTransfer',peer,id:t.id});await refresh();toast('已恢复记录');}catch(e){toast(e.message);}});});
  }
  if(!body.childNodes.length)body.append(el('span','muted','附件已发送完成'));card.append(body);row.append(card);return row;
}
$('messages').onscroll=updateLatest;$('latest').onclick=()=>{$('messages').scrollTop=$('messages').scrollHeight;updateLatest();};
window.addEventListener('resize',updateLatest);
$('chat-mode').onclick=()=>{$('ai-mode').checked=false;modes.set(selected,false);state&&render();};
$('assistant-mode').onclick=()=>{$('ai-mode').checked=true;modes.set(selected,true);state&&render();};
$('new-session').onclick=async()=>{try{await action({op:'newAISession',peer:selected});await refresh();toast('已开始新的 AI 对话，旧聊天记录仍保留');}catch(e){toast(e.message);}};
$('stop-ai').onclick=async()=>{if(!activeAI)return;$('stop-ai').disabled=true;try{const r=await action({op:'cancelAI',peer:selected,id:activeAI.id});await refresh();toast(r.local?'已取消排队，此问题不会发送':state.peers.find(p=>p.peer===selected)?.connection?'已请求停止':'停止请求已排队，上线后生效');}catch(e){toast(e.message);}finally{state&&render();}};
function resizeInput(){const input=$('message');input.style.height='auto';input.style.height=Math.min(120,Math.max(48,input.scrollHeight))+'px';}
$('message').oninput=resizeInput;
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
for(const d of document.querySelectorAll('dialog'))d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();});
$('add').onclick=$('welcome-add').onclick=()=>{$('add-error').textContent='';open('add-dialog');};
$('search').oninput=()=>state&&render();$('back').onclick=()=>document.querySelector('.workspace').classList.remove('selected');
$('add-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const r=await action({op:'add',address:$('tox-address').value,name:$('contact-name').value.trim()});$('add-dialog').close();$('add-form').reset();select(r.peer);toast('好友请求已发送，等待对方接受');}catch(err){$('add-error').textContent=err.message;}finally{button.disabled=false;}};
$('identity').onclick=()=>{if(!state)return;$('my-address').textContent=state.address;$('device-name').value=state.name;$('qr').replaceChildren();const qr=qrcode(0,'M');qr.addData('tox:'+state.address);qr.make();const wrapper=el('div');wrapper.innerHTML=qr.createSvgTag({cellSize:4,margin:2,scalable:true});wrapper.querySelector('svg').setAttribute('aria-label','我的 Tox ID 二维码');$('qr').append(wrapper);$('ai-config-info').textContent=state.aiConfigured?'模型已配置 · 需逐个授权联系人':'未配置模型';$('model-settings').hidden=native;$('android-mode').hidden=!native;$('realtime').checked=!!state.realtime;open('identity-dialog');};
$('model-settings').onclick=async()=>{try{const c=await action({op:'modelSettings'});$('model-enabled').checked=c.enabled;$('model-base-url').value=c.baseURL;$('model-name').value=c.model;$('model-key').value='';$('model-key').placeholder=c.hasKey?'已保存，留空则保持原密钥':'无鉴权的服务可留空';$('model-key-hint').textContent=c.hasKey?'已有密钥；填写新值可以替换，留空则保留。':'密钥仅保存在此设备，不会发送给联系人。';$('model-clear-key').checked=false;$('model-error').textContent='';$('identity-dialog').close();open('model-dialog');}catch(e){toast(e.message);}};
$('model-key').oninput=()=>{if($('model-key').value)$('model-clear-key').checked=false;};
$('model-clear-key').onchange=()=>{if($('model-clear-key').checked)$('model-key').value='';};
$('model-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;$('model-error').textContent='';try{await action({op:'saveModel',enabled:$('model-enabled').checked,baseURL:$('model-base-url').value,model:$('model-name').value,key:$('model-key').value,clearKey:$('model-clear-key').checked});$('model-key').value='';await refresh();$('model-dialog').close();toast(state.aiConfigured?'模型配置已保存并启用，记得授权联系人':'配置已保存，AI 已停用');}catch(err){$('model-error').textContent=err.message;}finally{button.disabled=false;}};
$('model-dialog').addEventListener('close',()=>{$('model-key').value='';});
$('copy-id').onclick=async()=>{try{if(native)await action({op:'copy',text:state.address});else await navigator.clipboard.writeText(state.address);toast('已复制 Tox ID');}catch{toast('请长按或选中上方 ID 复制');}};
$('name-form').onsubmit=async e=>{e.preventDefault();try{await action({op:'name',name:$('device-name').value});toast('设备名称已保存');await refresh();}catch(err){toast(err.message);}};
$('realtime').onchange=async()=>{try{await action({op:'mode',realtime:$('realtime').checked});await refresh();}catch(e){toast(e.message);}};
$('peer-details').onclick=()=>{const p=state.peers.find(p=>p.peer===selected);$('peer-id').textContent=p.peer;$('ai-permission').hidden=!state.aiConfigured;$('allow-ai').checked=!!p.allow_ai;open('peer-dialog');};
$('allow-ai').onchange=async()=>{try{await action({op:'allowAI',peer:selected,allow:$('allow-ai').checked});toast($('allow-ai').checked?'已授权此联系人使用 AI':'已撤销 AI 授权');await refresh();}catch(e){toast(e.message);}};
$('composer').onsubmit=async e=>{e.preventDefault();if(busy||!selected||!$('message').value.trim())return;busy=true;$('send').disabled=true;try{await action({op:$('ai-mode').checked?'agent.request':'chat',peer:selected,text:$('message').value});$('message').value='';resizeInput();await refresh();}catch(err){toast(err.message);}finally{busy=false;$('send').disabled=false;$('message').focus();}};
$('message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!matchMedia('(max-width:600px)').matches){e.preventDefault();$('composer').requestSubmit();}};
$('attach').onclick=async()=>{if(!state.peers.find(p=>p.peer===selected)?.connection){toast('文件发送需要对方在线');return;}if(native){try{await action({op:'pickFile',peer:selected});}catch(e){toast(e.message);}}else $('file-picker').click();};
$('file-picker').onchange=async e=>{const file=e.target.files[0];if(!file)return;$('attach').disabled=true;try{toast('正在准备文件…');const r=await (await fetch('/api/upload?peer='+encodeURIComponent(selected)+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file})).json();if(r.error)throw new Error(r.error);await refresh();}catch(err){toast(err.message);}finally{$('attach').disabled=false;e.target.value='';}};
$('scan').onclick=()=>$('qr-picker').click();
$('qr-picker').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const bitmap=await createImageBitmap(file);const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=bitmap.width*scale;canvas.height=bitmap.height*scale;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const code=jsQR(pixels.data,pixels.width,pixels.height);if(!code)throw new Error('没有识别到二维码，请选择清晰、完整的二维码图片');$('tox-address').value=code.data;$('add-error').textContent='已读取二维码，请确认后发送好友请求';}catch(err){$('add-error').textContent=err.message;}finally{e.target.value='';}};
window.tochatFileResult=msg=>{toast(msg);refresh();};refresh();setInterval(refresh,1000);
