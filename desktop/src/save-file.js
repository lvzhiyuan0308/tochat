import { spawn } from 'node:child_process';
import { copyFile, stat } from 'node:fs/promises';
import path from 'node:path';

export function chooseSavePath(name) {
  // An asynchronous STA process keeps Tox polling and chat active while the
  // user chooses a destination. Inputs are data on stdin, never shell code.
  const script=`
    $ErrorActionPreference = 'Stop'
    [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    Add-Type -AssemblyName System.Windows.Forms
    $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $owner.ShowInTaskbar = $false
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Title = 'ToChat - 保存附件副本'
    $dialog.FileName = $inputData.name
    $dialog.Filter = '所有文件 (*.*)|*.*'
    $dialog.OverwritePrompt = $true
    $dialog.CheckPathExists = $true
    $dialog.RestoreDirectory = $true
    try {
      if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::Out.Write((@{path=$dialog.FileName} | ConvertTo-Json -Compress))
      } else { [Console]::Out.Write('null') }
    } finally { $dialog.Dispose(); $owner.Dispose() }
  `;
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-STA','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{stdout+=chunk;});
    // Drain stderr, but don't expose internal paths or PowerShell diagnostics.
    child.stderr.resume();child.once('error',()=>reject(new Error('无法打开 Windows 保存窗口')));
    child.once('close',code=>{
      if(code!==0){reject(new Error('无法打开 Windows 保存窗口'));return;}
      try{resolve(JSON.parse(stdout)?.path||null);}catch{reject(new Error('Windows 保存窗口未返回有效结果'));}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({name}));
  });
}

export function createFileSaver(store,downloads,choose=chooseSavePath) {
  let saving=false;
  return async ({id,peer})=>{
    if(saving)throw new Error('保存窗口已打开，请先完成或取消');
    const t=store.get("SELECT * FROM transfers WHERE id=? AND peer=? AND inbound=1 AND status='complete'",id,peer);
    if(!t)throw new Error('附件尚未接收完成或不存在');
    const source=path.resolve(t.path),root=path.resolve(downloads),relative=path.relative(root,source);
    if(!relative||relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw new Error('附件路径无效');
    saving=true;
    try{
      try{if(!(await stat(source)).isFile())throw new Error();}catch{throw new Error('附件文件已不存在，请让对方重新发送');}
      const name=path.basename(t.name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')||'attachment';
      const destination=await choose(name);
      if(!destination)return {cancelled:true};
      if(!path.isAbsolute(destination))throw new Error('请选择完整的保存路径');
      // The original remains in the application history; exports are copies.
      if(path.resolve(destination).toLowerCase()!==source.toLowerCase()){
        try{await copyFile(source,destination);}catch{throw new Error('保存失败，请检查目标文件夹权限或磁盘空间');}
      }
      return {ok:true,path:destination};
    }finally{saving=false;}
  };
}
