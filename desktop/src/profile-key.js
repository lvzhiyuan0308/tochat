import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
// Keep the 32-byte encryption secret protected by the current Windows account.
// Binary values use stdin/stdout; they never enter command arguments or logs.
export function profileKey(file) {
  if(process.platform!=='win32')throw new Error('This launcher requires Windows DPAPI');
  const decrypt=existsSync(file),operation=decrypt?'Unprotect':'Protect';
  const script=`Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const raw=decrypt?readFileSync(file):randomBytes(32);
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:raw.toString('base64'),encoding:'utf8',windowsHide:true});
  if(r.status!==0||!r.stdout.trim())throw new Error('Windows DPAPI could not unlock the profile key');
  if(decrypt)return Buffer.from(r.stdout.trim(),'base64').toString('hex');
  writeFileSync(file,Buffer.from(r.stdout.trim(),'base64'),{flag:'wx'});return raw.toString('hex');
}
