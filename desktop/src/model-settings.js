import { spawnSync } from 'node:child_process';

// Secrets travel over stdin, never command arguments, and remain account-bound.
export function protectSecret(value, decrypt=false) {
  const operation=decrypt?'Unprotect':'Protect';
  const script=`Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const input=decrypt?value:Buffer.from(value,'utf8').toString('base64');
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input,encoding:'utf8',windowsHide:true});
  if(r.status!==0||!r.stdout.trim())throw new Error('Windows 无法读取或保存模型密钥');
  return decrypt?Buffer.from(r.stdout.trim(),'base64').toString('utf8'):r.stdout.trim();
}

export function validateModel(c) {
  const baseURL=String(c.baseURL||'').trim().replace(/\/+$/,'');
  const model=String(c.model||'').trim();
  if(baseURL){
    let url;try{url=new URL(baseURL);}catch{throw new Error('请输入完整的模型服务地址');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('模型服务地址需为 HTTP(S)，不能包含密钥、查询参数或片段');
  }
  if(baseURL.length>2048||model.length>200)throw new Error('模型地址或名称过长');
  if(c.enabled&&(!baseURL||!model))throw new Error('启用模型时，请填写服务地址和模型名称');
  if(typeof c.key!=='string'||c.key.length>8192||/[\r\n]/.test(c.key))throw new Error('API 密钥格式无效');
  return {enabled:!!c.enabled,baseURL,model};
}

export function modelFromSaved(saved,decode=protectSecret) {
  if(!saved?.enabled)return null;
  return {baseURL:saved.baseURL,model:saved.model,key:saved.protectedKey?decode(saved.protectedKey,true):''};
}

export function prepareModel(c,previous,encode=protectSecret) {
  const saved=validateModel(c);
  saved.protectedKey=c.clearKey?'':c.key?encode(c.key):previous?.protectedKey||'';
  return saved;
}

export function publicModel(saved,llm) {
  return {enabled:!!llm,baseURL:saved?.baseURL||llm?.baseURL||'',model:saved?.model||llm?.model||'',hasKey:!!(saved?.protectedKey||llm?.key)};
}
