param([switch]$InstallDependencies)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectDirectory = [System.IO.Path]::GetFullPath($PSScriptRoot)
Set-Location -LiteralPath $projectDirectory

# 确保上游清理脚本的目标始终处于当前项目目录中。
foreach ($relativeTarget in @('work', 'dist', 'node_modules')) {
    $targetDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectDirectory $relativeTarget))
    if (-not $targetDirectory.StartsWith($projectDirectory + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "清理目标超出项目目录：$targetDirectory"
    }
}

$nodeDirectory = Join-Path $projectDirectory 'temp\build-tools\node-v24.21.0-win-x64'
$yarnDirectory = Join-Path $projectDirectory 'temp\build-tools\yarn\node_modules\.bin'
$env:Path = "$nodeDirectory;$yarnDirectory;$env:Path"
$env:npm_config_legacy_peer_deps = 'true'
$env:npm_config_ignore_scripts = 'true'
$env:npm_config_audit = 'false'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

# 统一检查原生命令退出码，避免留下看似成功的半成品。
function Invoke-BuildCommand {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "构建失败：$Command，退出码 $LASTEXITCODE" }
}

if ($InstallDependencies -or -not (Test-Path -LiteralPath 'node_modules')) {
    Invoke-BuildCommand 'npm.cmd' @('ci', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund')
}

if (-not (Test-Path -LiteralPath 'node_modules/electron/dist/electron.exe')) {
    $electronVersion = (Get-Content -LiteralPath 'node_modules/electron/package.json' -Encoding UTF8 -Raw | ConvertFrom-Json).version
    $archiveName = "electron-v$electronVersion-win32-x64.zip"
    $archivePath = Join-Path $projectDirectory "temp\build-tools\$archiveName"
    # 全新克隆没有下载缓存目录，先创建目录再保存官方压缩包。
    New-Item -ItemType Directory -Path (Split-Path -Parent $archivePath) -Force | Out-Null
    if (-not (Test-Path -LiteralPath $archivePath)) {
        Invoke-WebRequest -Uri "https://github.com/electron/electron/releases/download/v$electronVersion/$archiveName" -OutFile $archivePath -UseBasicParsing
    }
    $checksums = Get-Content -LiteralPath 'node_modules/electron/checksums.json' -Encoding UTF8 -Raw | ConvertFrom-Json
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $checksums.$archiveName) { throw 'Electron 校验失败' }
    Expand-Archive -LiteralPath $archivePath -DestinationPath 'node_modules/electron/dist' -Force
    Set-Content -LiteralPath 'node_modules/electron/path.txt' -Value 'electron.exe' -Encoding UTF8 -NoNewline
}

Invoke-BuildCommand 'npm.cmd' @('run', 'b')
Invoke-BuildCommand 'npm.cmd' @('run', 'pb')
Invoke-BuildCommand '.\node_modules\.bin\electron-builder.cmd' @('--win', 'nsis', 'zip', '--x64', '--publish', 'never', '-c.npmRebuild=false', '-c.electronDist=node_modules/electron/dist')
Write-Output '构建完成，产物位于 dist\personal'
