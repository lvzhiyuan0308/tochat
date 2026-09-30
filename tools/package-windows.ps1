param([string]$NodePath = 'C:\Users\lvzhiyuan\.workbuddy\binaries\node\versions\22.22.2-3\node.exe')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$portableRoot = "$projectRoot\build\portable-$(New-Guid)"
New-Item -ItemType Directory -Force $portableRoot,"$portableRoot\dist\windows","$portableRoot\runtime","$portableRoot\tools" | Out-Null
foreach ($dir in @('desktop','protocol','shared','node_modules')) { Copy-Item -LiteralPath "$projectRoot\$dir" -Destination $portableRoot -Recurse -Force }
Copy-Item "$projectRoot\dist\windows\*.dll" -Destination "$portableRoot\dist\windows" -Force
Copy-Item -LiteralPath $NodePath -Destination "$portableRoot\runtime\node.exe" -Force
Copy-Item -LiteralPath "$(Split-Path $NodePath -Parent)\LICENSE" -Destination "$portableRoot\runtime\LICENSE.txt" -Force
New-Item -ItemType Directory -Force "$portableRoot\licenses" | Out-Null
Copy-Item -LiteralPath "$projectRoot\vendor\libsodium-cmake\libsodium\LICENSE" -Destination "$portableRoot\licenses\libsodium-LICENSE.txt" -Force
Copy-Item -LiteralPath "$projectRoot\vendor\libsodium-cmake\LICENSE" -Destination "$portableRoot\licenses\libsodium-cmake-LICENSE.txt" -Force
foreach ($name in @('package.json','package-lock.json','README.md','LICENSE','THIRD_PARTY_NOTICES.md','Start-ToChat.cmd')) { Copy-Item -LiteralPath "$projectRoot\$name" -Destination $portableRoot -Force }
Copy-Item -LiteralPath "$projectRoot\tools\start-windows.ps1" -Destination "$portableRoot\tools" -Force
Compress-Archive -Path "$portableRoot\*" -DestinationPath "$projectRoot\dist\ToChat-0.1-windows.zip" -Force
