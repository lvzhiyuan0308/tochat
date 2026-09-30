param([switch]$AI, [string]$Model = 'deepseek-v4-flash', [string]$BaseURL = 'http://127.0.0.1:4000/v1')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$bundledNode = "$projectRoot\runtime\node.exe"
$workBuddyNode = 'C:\Users\lvzhiyuan\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } elseif (Test-Path -LiteralPath $workBuddyNode) { $workBuddyNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
if ($AI) { $env:LLM_BASE_URL = $BaseURL; $env:LLM_MODEL = $Model }
$env:TOCHAT_OPEN = '1'
Push-Location $projectRoot
try { & $nodePath desktop/src/main.js } finally { Pop-Location }
