# タスクスケジューラから呼ぶ。node/npm をインストールした実行ユーザーを使用する。
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$env:NODE_ENV = 'production'
New-Item -ItemType Directory -Path logs -Force | Out-Null
& npm.cmd start >> logs/kosuzu-task.log 2>&1
exit $LASTEXITCODE
