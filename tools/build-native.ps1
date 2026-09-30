param([string]$CompilerRoot = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (!$CompilerRoot) { $CompilerRoot = (Get-ChildItem -LiteralPath "$projectRoot\toolchain" -Directory -Filter 'llvm-mingw*' | Select-Object -First 1).FullName }
if (!$CompilerRoot) { throw 'Run tools/setup.ps1 to download the compiler first.' }
$env:PATH = "$CompilerRoot\bin;$env:PATH"
& cmake -S "$projectRoot\native\toxbridge" -B "$projectRoot\build\windows" -G Ninja "-DCMAKE_C_COMPILER=$CompilerRoot/bin/x86_64-w64-mingw32-clang.exe" "-DCMAKE_CXX_COMPILER=$CompilerRoot/bin/x86_64-w64-mingw32-clang++.exe" -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE) { throw 'Native configuration failed' }
& cmake --build "$projectRoot\build\windows" --parallel 4
if ($LASTEXITCODE) { throw 'Native build failed' }
New-Item -ItemType Directory -Force "$projectRoot\dist\windows" | Out-Null
try { Copy-Item -LiteralPath "$projectRoot\build\windows\libtoxbridge.dll" -Destination "$projectRoot\dist\windows\toxbridge.dll" } catch { throw 'Close the running ToChat app and Tox test peers before rebuilding the native DLL.' }
Get-ChildItem -LiteralPath "$CompilerRoot\bin" -Filter '*pthread*.dll' | Copy-Item -Destination "$projectRoot\dist\windows"
