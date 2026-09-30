export async function* completion({baseURL,key,model,text,messages,signal}) {
  const url=new URL(baseURL);if(!['http:','https:'].includes(url.protocol))throw new Error('Invalid LLM URL');
  const response=await fetch(url.href.replace(/\/$/,'')+'/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},
    body:JSON.stringify({model,stream:true,messages:messages||[{role:'system',content:'你是 ToChat 的个人 AI 助手，请用用户使用的语言回答。'},{role:'user',content:text}]}),signal
  });
  if(!response.ok)throw new Error('模型服务返回 HTTP '+response.status);if(!response.body)throw new Error('模型没有返回流');
  const decoder=new TextDecoder();let pending='',done=false,surrogate='';
  for await(const chunk of response.body){
    pending+=decoder.decode(chunk,{stream:true});if(pending.length>1024*1024)throw new Error('模型 SSE 数据过大');
    const lines=pending.split('\n');pending=lines.pop();
    for(const line of lines){if(!line.startsWith('data:'))continue;const raw=line.slice(5).trim();if(raw==='[DONE]'){done=true;break;}if(!raw)continue;
      const event=JSON.parse(raw);if(event.error)throw new Error('模型服务返回错误');const delta=event.choices?.[0]?.delta?.content;
      if(typeof delta==='string'&&delta){let text=surrogate+delta;surrogate='';const last=text.charCodeAt(text.length-1);if(last>=0xd800&&last<=0xdbff){surrogate=text.slice(-1);text=text.slice(0,-1);}if(text)yield text;}
    }
    if(done)break;
  }
  if(!done)throw new Error('模型流中断，请重试');
  if(surrogate)throw new Error('模型返回了不完整的 Unicode 字符');
}
