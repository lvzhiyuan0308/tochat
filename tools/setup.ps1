param([string]$NodeRoot = 'C:\Users\lvzhiyuan\.workbuddy\binaries\node\versions\22.22.2-3')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$env:PATH = "$NodeRoot;$env:PATH"
Push-Location $projectRoot
try {
    & git submodule update --init --recursive
    if ($LASTEXITCODE) { throw 'Submodule checkout failed' }
    & npm.cmd ci
    if ($LASTEXITCODE) { throw 'Dependency installation failed' }
    $compilerFolder = "$projectRoot\toolchain\llvm-mingw-20260922-ucrt-x86_64"
    if (!(Test-Path -LiteralPath "$compilerFolder\bin\clang.exe")) {
        New-Item -ItemType Directory -Force "$projectRoot\toolchain" | Out-Null
        $archive = "$projectRoot\toolchain\llvm-mingw.zip"
        Invoke-WebRequest 'https://github.com/mstorsjo/llvm-mingw/releases/download/20260922/llvm-mingw-20260922-ucrt-x86_64.zip' -OutFile $archive
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne 'E3AD77D117A4BEA19A7A3B333341824D79A5A371004A10E25B8504E7B3047666') { throw 'Compiler archive checksum mismatch' }
        Expand-Archive -LiteralPath $archive -DestinationPath "$projectRoot\toolchain" -Force
    }
    & "$projectRoot\tools\build-native.ps1"
} finally { Pop-Location }
