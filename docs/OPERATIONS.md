# kosuzu 運用ガイド

初回の Discord 設定・環境変数・コマンド一覧は [README](../README.md) を参照してください。同じトークンの Bot は1プロセスだけ起動します。以下の非 Docker 例は Node.js 24 LTS、ビルド済み `dist/`、設定済み `.env`、別途起動した ENGINE を前提にしています。

## Docker Compose

```sh
docker compose up -d --build
docker compose logs -f --tail=100 bot
docker compose restart bot
docker compose stop bot
```

Bot は `node`（UID/GID 1000）で動き、`./data` を `/app/data` にマウントします。Linux の bind mount はホスト側も UID/GID 1000 の書き込みを許可してください。イメージ内のディレクトリ所有権は bind mount に引き継がれません。ENGINE のホスト向けポートは loopback のみ、Bot の公開ポートはありません。

`init: true` でシグナル転送と子プロセス回収を行い、`stop_grace_period: 15s` を確保しています。Bot は新規処理を止め、VC・自動参加タイマーを破棄し、実行中の DB 利用を待って Discord クライアントを破棄し、DB を一度だけ閉じ、ログを flush して終了します。通常はすぐに終了し、通信待ち等で10秒を超えた場合はエラー終了します（flush 停止時も12秒で終了）。この場合の未完了操作は再実行してください。SQLite の確定済みデータは WAL で保持します。

CPU 版 ENGINE の runtime は curl・Python の存在が保証されないため healthcheck は付けず、`depends_on: service_started` を使います。ENGINE の準備完了前や停止中でも Bot は稼働し、合成エラーをログに残します。ENGINE 復旧後の投稿から再開します。

### 任意: NVIDIA GPU

NVIDIA GPU とホストの NVIDIA Container Toolkit が利用できる環境では、次の `compose.gpu.yaml` をローカルで作成します。CPU/GPU の両 ENGINE を同時起動する必要はありません。

```yaml
services:
  voicevox:
    image: voicevox/voicevox_engine:nvidia-latest
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

```sh
docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
```

以後の pull・stop・logs 等も同じ `-f` 指定で実行します。Bot イメージは amd64 / arm64 の GNU DAVE 依存を lockfile に含め、ビルド時に対象アーキテクチャのロードを検証します。ENGINE イメージの対応 CPU アーキテクチャは別途確認してください。

## ログ

`NODE_ENV=production` では JSON を標準出力へ出します。非 TTY の出力も JSON です。`LOG_LEVEL` は通常 `info`、障害調査中のみ `debug` を推奨します。`warn`・`error` に絞ることもできます。変更後はプロセスを再起動し、Compose の `.env` 変更時は `docker compose up -d --force-recreate bot` で再作成します。

未捕捉例外は fatal ログを flush して終了し、Docker / pm2 / systemd が再起動します。個々のイベント・コマンド・合成失敗はログに残し、Bot 全体は終了しません。Docker ログのディスク使用量は Docker 側の logging 設定、pm2 はログローテーション、systemd は journald の保存上限で管理してください。トークンをログへ追記しないでください。

## pm2

リポジトリ直下に [ecosystem.config.cjs](../ecosystem.config.cjs) を用意しています。1プロセス、異常終了時に5秒待って再起動、メモリ512 MB超で再起動、停止猶予15秒です。JSON ログは `logs/kosuzu-out.log` / `logs/kosuzu-error.log` に出ます。

```sh
npm install -g pm2
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Linux では `pm2 startup` が表示するコマンドを実行し、起動ユーザーの保存済みプロセスを復元できるようにします。`pm2 logs kosuzu` で確認、`pm2 restart kosuzu --update-env` で更新、`pm2 stop kosuzu` で停止します。pm2 自体はアプリの production dependencies に含めません。

## systemd（Linux）

例として `/opt/kosuzu` に配置し、専用ユーザー `kosuzu` に `data/` の書き込み権限と `.env` の読み取り権限を与えます。Node.js 24 が `/usr/bin/node` にある想定です。配置先・実行ユーザー・Node の絶対パスは環境に合わせて変更してください。nvm の対話シェル設定は systemd から自動では読み込まれません。

`/etc/systemd/system/kosuzu.service`:

```ini
[Unit]
Description=kosuzu Discord VOICEVOX bot
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=kosuzu
Group=kosuzu
WorkingDirectory=/opt/kosuzu
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/kosuzu/dist/index.js
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

`.env` は Bot が WorkingDirectory から読み込みます。ENGINE は別サービスまたは Compose で起動してください。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now kosuzu
journalctl -u kosuzu -f
sudo systemctl restart kosuzu
sudo systemctl stop kosuzu
```

## Windows タスクスケジューラ

[scripts/start-windows.ps1](../scripts/start-windows.ps1) はリポジトリ直下へ移動し、production 設定で `npm.cmd start` を実行、`logs/kosuzu-task.log` に追記します。

タスクの作成で次を指定します。

- トリガー: **スタートアップ時**（ネットワーク待ち用に30秒程度遅延）。
- 実行ユーザー: Node.js / npm を利用でき、リポジトリへアクセスできるユーザー。「ユーザーがログオンしているかどうかにかかわらず実行する」。
- 操作: プログラム `powershell.exe`、引数 `-NoProfile -File "C:\path\kosuzu\scripts\start-windows.ps1"`、開始場所 `C:\path\kosuzu`。スクリプト実行ポリシーは端末の設定に従い、必要に応じてファイルのブロックを解除します。
- 設定: 失敗時1分後に再起動、二重起動しない、既定の「3日で停止」などの実行時間制限を解除。

ENGINE も起動するよう別途設定します。タスクの「終了」は子 Node の正常停止を保証しないため、更新やファイルコピーによるバックアップ前に Node が停止したことを確認してください。オンラインバックアップには次節の `.backup` を使えます。通常の対話起動なら Ctrl+C で正常終了できます。

## バックアップと復元

ユーザー音声・辞書・サーバー設定・追加キャラの有効化は `data/kosuzu.db`（`DATABASE_PATH` 変更時はそのパス）に保存します。秘密情報の `.env` も別途安全な場所へ保管してください。

**稼働中の DB 本体だけをコピーしないでください。** WAL モードでは更新が `kosuzu.db-wal` に残ることがあります。`-shm` も SQLite が管理する付随ファイルです。稼働中にこれらを削除したり、別々の時刻にコピーしてバックアップにしないでください。

SQLite CLI が使えるホストでは、オンラインバックアップが可能です（Bot イメージに sqlite3 CLI は含みません）。

```sh
mkdir -p backups
sqlite3 data/kosuzu.db ".backup 'backups/kosuzu-2026-10-29.db'"
```

CLI がなければ Bot を正常停止し、プロセスが終了してから `data/` 全体をコピーします。`-wal` / `-shm` が残っている場合も一緒に保存してください。ENGINE は動作したままでも構いません。

```sh
docker compose stop bot
# この間に data/ 全体をバックアップ先へコピー
docker compose up -d bot
```

復元時は必ず Bot を停止し、現在の `data/` を退避します。`.backup` の出力を `data/kosuzu.db` に配置し、古い DB の `-wal` / `-shm` を混ぜないようにします。停止時のディレクトリコピーから戻す場合は、保存した一式を空の復元先へ戻します。所有者・書き込み権限を確認してから起動し、ログと `/voice show`・`/dict list`・`/config show` を確認します。

## 更新

更新前に DB をバックアップし、Bot を停止します。

非 Docker（リポジトリ直下）:

```sh
git pull
npm ci --include=dev
npm run build
# コマンド定義が変わったときだけ実行
npm run deploy-commands:prod
# 利用中の方法で再起動
pm2 restart kosuzu --update-env
# または sudo systemctl restart kosuzu / Windows タスクを開始
```

ビルド済みファイルと production dependencies だけでも起動・登録でき、`npm start` はビルドをしません。`.env` の `DISCORD_DEV_GUILD_ID` を変えると登録先も変わります。ギルド登録からグローバル登録に移行する場合、古いギルドコマンドが残ることがあるため、不要な登録は Discord API 側で削除してください。

Docker:

```sh
git pull
# ENGINE も更新する場合のみ（cpu-latest は可変タグ）
docker compose pull voicevox
docker compose build bot
# コマンド定義が変わったときだけ実行
docker compose run --rm --no-deps bot npm run deploy-commands:prod
docker compose up -d --build
```

Node ベースの patch 更新も取り込む場合は `docker compose build --pull bot` を使用します。DB のマイグレーションは起動時に自動適用します。古いコードに戻す際、新しい DB の版を読めない場合は更新前バックアップから復元します。

## 困ったとき

| 症状                           | 確認すること                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| コマンドが表示されない         | Developer Portal の Installation で Guild Install、scopes `bot` + `applications.commands` を確認。`DISCORD_CLIENT_ID` と登録先 `DISCORD_DEV_GUILD_ID` が正しいか、`deploy-commands:prod` が成功したか確認。登録は `integration_types: GuildInstall` / guild context に限定しています。Discord を Ctrl+R で再読み込みし、グローバル反映を待つ。サーバーの連携設定やチャンネルのコマンド権限も確認。管理コマンドは「サーバー管理」権限が必要 |
| VC に入るが音が出ない          | チャンネル上書きを含む Connect / Speak / Use Voice Activity、サーバーミュート、クライアントの Bot 音量、外向き UDP を確認。`voicevox:smoke:prod` と warn ログで合成失敗か再生失敗か切り分ける。DAVE 対応依存を省略していないか確認（下記）                                                                                                                                                                                                 |
| ENGINE に接続できない          | `docker compose logs voicevox`、`docker compose ps`、ホストなら `http://127.0.0.1:50021/version` を確認。Bot コンテナ内は `http://voicevox:50021`。`localhost` はそのコンテナ自身。起動完了後に smoke を再実行。必要なら `VOICEVOX_TIMEOUT_MS` を調整                                                                                                                                                                                      |
| 接続音声は出るが投稿を読まない | Message Content Intent が Developer Portal で有効か確認。対象チャンネル・固定先・`;` 等の除外接頭辞・Bot 投稿でないことを確認                                                                                                                                                                                                                                                                                                              |
| SQLite の権限エラー            | `DATABASE_PATH` が永続化先の配下か、`data/` が実行ユーザーに書き込み可能か確認。Linux bind mount は UID/GID 1000 に合わせる                                                                                                                                                                                                                                                                                                                |
| 再起動を繰り返す               | fatal ログ、必須環境変数、トークン、Node.js の版、DB の版・権限を確認                                                                                                                                                                                                                                                                                                                                                                      |

DAVE / Opus のインストール確認（コンテナ内で実際の GNU バイナリをロード）:

```sh
docker compose run --rm --no-deps bot node -e "require('@snazzah/davey-linux-' + process.arch + '-gnu'); require('@snazzah/davey'); require('opusscript')"
# トークン不要・Discord 通信なしの登録定義検証
docker compose run --rm --no-deps bot npm run deploy-commands:prod -- --dry-run
```

`@snazzah/davey-linux-x64-gnu` / `@snazzah/davey-linux-arm64-gnu` は production 依存の optionalDependencies です。`--omit=dev` でも対象 OS/CPU 分はインストールされます。`--omit=optional` は使わないでください。Dockerfile は `--include=optional` を明示し、Bookworm の glibc 上で実際にロードできない場合はビルドを失敗させます。
