param([string]$BaseToolchain = 'C:\Users\lvzhiyuan\WorkBuddy\2026-09-06-18-01-12\gmmff-chat\toolchain')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$packageVersion = (Get-Content -LiteralPath "$projectRoot\package.json" -Raw | ConvertFrom-Json).version
$env:JAVA_HOME = "$BaseToolchain\jdk-17.0.20.1+1"
$env:ANDROID_HOME = "$BaseToolchain\sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
New-Item -ItemType Directory -Force "$projectRoot\build\tmp" | Out-Null
# JDK 17 AF_UNIX loopback fails with Windows 8.3 TEMP paths on this host.
$taskJavaOptions = "-Djava.io.tmpdir=$projectRoot\build\tmp -Djdk.net.unixdomain.tmpdir=$projectRoot\build\tmp"
$env:JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS $taskJavaOptions".Trim()
if (!(Test-Path -LiteralPath "$env:JAVA_HOME\bin\java.exe")) { throw 'JDK 17 not found; provide -BaseToolchain.' }
$sdkEscaped = $env:ANDROID_HOME.Replace('\','\\').Replace(':','\:')
Set-Content -LiteralPath "$projectRoot\mobile\android\local.properties" -Value "sdk.dir=$sdkEscaped" -Encoding ascii
Copy-Item "$projectRoot\desktop\ui\*" -Destination "$projectRoot\mobile\android\app\src\main\assets" -Force
Copy-Item -LiteralPath "$projectRoot\shared\bootstrap.json" -Destination "$projectRoot\mobile\android\app\src\main\assets\bootstrap.json" -Force
Push-Location "$projectRoot\mobile\android"
try {
  & .\gradlew.bat --no-daemon assembleDebug assembleRelease
  if ($LASTEXITCODE) { throw 'Android build failed' }
} finally { Pop-Location }
New-Item -ItemType Directory -Force "$projectRoot\dist\android" | Out-Null
Copy-Item -LiteralPath "$projectRoot\mobile\android\app\build\outputs\apk\debug\app-debug.apk" -Destination "$projectRoot\dist\android\ToChat-$packageVersion-debug.apk"
Copy-Item -LiteralPath "$projectRoot\mobile\android\app\build\outputs\apk\release\app-release-unsigned.apk" -Destination "$projectRoot\dist\android\ToChat-$packageVersion-release-unsigned.apk"
