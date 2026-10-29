# kosuzu

VOICEVOX で Discord の投稿を読み上げる Bot です。サークルの自宅 PC・個人サーバーで常駐させて使います。

- `/join`・`/leave` による手動入退室と、VC の利用開始・無人化に応じた自動入退室。
- テキストチャンネルと VC チャットの読み上げ、URL・コード等の省略、順番どおりの再生。
- メンバーごとのキャラ・スタイル・話速・ピッチ、サーバー辞書、固定読み上げ先などの設定。
- 管理者による追加キャラの有効化、利用キャラのクレジット公開。設定は SQLite に保存。

## 必要なもの

- Bot を招待できる Discord サーバーと、Discord アプリケーション。
- Docker 運用: Docker Engine / Docker Desktop と Docker Compose v2。
- Docker を使わない運用: Node.js **24 LTS** と npm、VOICEVOX デスクトップ版または VOICEVOX ENGINE。導入・ビルドには開発依存も必要です。
- Discord へ HTTPS・WebSocket・外向き UDP で接続できるネットワーク。Bot のポート公開は不要です。

音声は PCM を直接処理するため FFmpeg は不要です。Opus は `opusscript`、DAVE（音声 E2EE）は `@discordjs/voice` の依存 `@snazzah/davey` を使用します。

## Discord の準備

1. [Discord Developer Portal](https://discord.com/developers/applications) で **New Application** を作成し、General Information の **Application ID** を控えます。
2. **Bot** ページで Bot トークンを発行（必要なら Reset Token）し、後述の `.env` の `DISCORD_TOKEN` に保存します。トークンをチャットや Git に貼らないでください。
3. 同じページの **Privileged Gateway Intents → Message Content Intent** を有効にして保存します。通常投稿の読み上げに必須です。
4. **Installation → Installation Contexts** で **Guild Install** を有効にします。User Install は不要です。Default Install Settings の Guild Install に scopes **bot** と **applications.commands** を設定します。[公式の導入手順](https://github.com/discord/discord-api-docs/blob/main/developers/quick-start/getting-started.mdx)も参照できます。
5. Bot Permissions に **View Channels / Send Messages / Read Message History / Connect / Speak / Use Voice Activity** を付けます。この6権限の整数値は **36768768** です。さらに一覧・クレジットの埋め込み表示用に **Embed Links** を付け、推奨値を **36785152** とします（[権限ビット定義](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx)）。Administrator は不要です。
6. 下記 URL の `<ID>` を Application ID に置き換えて開き、サーバーへ招待します。対象のテキストチャンネルと VC の権限上書きでも閲覧・送信・接続・発言を許可してください。

```text
https://discord.com/oauth2/authorize?client_id=<ID>&scope=bot+applications.commands&permissions=36785152
```

6権限だけのテンプレートは `https://discord.com/oauth2/authorize?client_id=<ID>&scope=bot+applications.commands&permissions=36768768` です。埋め込みを使うコマンドには Embed Links を追加してください。

## Docker で導入する（推奨）

リポジトリを取得し、そのディレクトリで実行します。

```sh
cp .env.example .env
```

PowerShell では `Copy-Item .env.example .env` を使えます。`.env` を編集し、最低限次を設定します。

```dotenv
DISCORD_TOKEN=発行したBotトークン
DISCORD_CLIENT_ID=Application_ID
DISCORD_DEV_GUILD_ID=利用するサーバーID
```

サーバー ID は Discord の設定で開発者モードを有効にしてサーバーを右クリック → ID をコピーで取得できます。`DISCORD_DEV_GUILD_ID` を空にすると全導入先向けのグローバルコマンド登録になります。初回はサーバー指定が確認しやすいです。

```sh
# イメージをビルド（Node.js のホストへのインストールは不要）
docker compose build bot
# Discord にコマンドを登録（初回・コマンド定義の更新時）
docker compose run --rm --no-deps bot npm run deploy-commands:prod
# Bot と CPU 版 ENGINE の両方を常駐起動
docker compose up -d --build
docker compose logs -f bot
```

**従来 ENGINE だけを動かしていた人も、引数なしの `docker compose up -d` は今後両方を起動します。** ローカル開発で ENGINE だけを使う場合は `docker compose up -d voicevox` としてください。

Compose 内の ENGINE 接続先は `http://voicevox:50021` に固定しています。ENGINE 起動中でも Bot は稼働を続けます。合成に失敗した場合は ENGINE の起動完了後に再度投稿してください。公式イメージの runtime に curl・Python があるとは限らないため healthcheck は設定せず、`depends_on: service_started` を使用します（[公式 Dockerfile](https://github.com/VOICEVOX/voicevox_engine/blob/master/Dockerfile)）。

DB は `./data:/app/data` に永続化します。`DATABASE_PATH` は空（既定 `data/kosuzu.db`）か `/app/data/kosuzu.db` にします。Linux の既存 bind mount はコンテナ内の `node`（UID/GID 1000）が書き込める必要があります。権限エラー時は Bot を止め、ホストで `sudo mkdir -p data` と `sudo chown -R 1000:1000 data` を実行します。Docker Desktop では通常この作業は不要です。

```sh
# ENGINE と合成の確認。data/smoke.wav に保存
docker compose exec bot npm run voicevox:smoke:prod -- 3
# 停止（設定データは残る）
docker compose down
```

GPU 版の任意設定、更新・バックアップ・ログの管理は [運用ガイド](docs/OPERATIONS.md) を参照してください。

## Docker を使わずに導入する

Node.js 24 LTS をインストールし、リポジトリ直下を作業ディレクトリにします。

```sh
npm ci
cp .env.example .env
```

Discord の値を前節と同じように設定します。VOICEVOX デスクトップ版か ENGINE を起動してください。既定の `VOICEVOX_URL` は `http://127.0.0.1:50021` です。ENGINE だけ Docker で起動する場合は `docker compose up -d voicevox` を使います。

本番運用では `.env` の `NODE_ENV=production` も設定します。JSON ログになり、開発用のログ整形依存は使いません。

```sh
npm run build
npm run voicevox:smoke:prod -- 3
npm run deploy-commands:prod
npm start
```

`npm start` はビルド済みの `dist/index.js` を起動します。自動ビルドは行いません。ビルド後は必要に応じ `npm prune --omit=dev` で開発依存を削除しても、本番起動・コマンド登録・合成確認は実行できます。次回ビルドの前に `npm ci` で開発依存を戻します（`NODE_ENV=production` の環境では `npm ci --include=dev`）。

開発時は `npm run dev`、`npm run deploy-commands`、`npm run voicevox:smoke -- 3`（tsx）を利用できます。`.env` と相対パスの `DATABASE_PATH`、`data/smoke.wav` はすべて**作業ディレクトリ基準**です。ソース版・ビルド版ともリポジトリ直下から実行します。Compose は `/app`、付属の pm2・systemd・Windows の設定例も作業ディレクトリを固定します。

常駐の設定は [運用ガイド](docs/OPERATIONS.md) の pm2 / systemd / Windows を参照してください。

## 使い方

VC に参加して読み上げたいテキストチャンネルで `/join` を実行します。実行先と VC 内蔵チャット、設定済みの固定先を読みます。同じ VC での再実行は読み上げ先を更新し、別 VC なら移動します。`/skip` で発話を飛ばし、`/leave` で退出します。

自動参加は既定で有効です。通常 VC に最初の人間が入ると参加し、起動時も利用中の VC をスキャンします。AFK・ステージ・除外 VC・権限のない VC は対象外です。接続中は別 VC に移動せず、無人になって既定10秒後に退出します。自動参加では VC チャットと固定先（なければ最後の `/join` 実行先）を読みます。

Bot・システム投稿を除外し、既定では `;` で始まる投稿も除外します。URL・コードブロック・伏せ字を省略し、メンションは表示名、カスタム絵文字は名前に置換します。Unicode 絵文字は保持します。本文は既定100文字、超過時に「以下略」を追加します。未再生キュー上限は20件で、満杯なら新着を拒否しログに残します。

## コマンド一覧

全操作はスラッシュコマンドです。「管理」は実行者に「サーバー管理」権限が必要です。

| コマンド                                                               | 対象  | 内容                                                 |
| ---------------------------------------------------------------------- | ----- | ---------------------------------------------------- |
| `/ping`                                                                | 全員  | Bot の応答確認                                       |
| `/join`                                                                | 全員  | 実行者の VC に参加し読み上げ先を設定                 |
| `/leave`                                                               | 全員  | 退出                                                 |
| `/skip`                                                                | 全員  | 再生中の発話をスキップ                               |
| `/voice set speaker:<候補>`                                            | 全員  | 自分のキャラ・スタイルを設定                         |
| `/voice show`                                                          | 全員  | 現在の話者・話速・ピッチを表示                       |
| `/voice speed value:<0.5〜2.0>`                                        | 全員  | 自分の話速を設定                                     |
| `/voice pitch value:<-0.15〜0.15>`                                     | 全員  | 自分のピッチを設定                                   |
| `/voice reset`                                                         | 全員  | 自分の音声設定を削除                                 |
| `/voice list`                                                          | 全員  | 利用可能なキャラ・スタイル一覧                       |
| `/dict add surface:<表記> reading:<読み>`                              | 全員※ | 登録・同じ表記の上書き                               |
| `/dict remove surface:<候補>`                                          | 全員※ | 辞書から削除                                         |
| `/dict list`                                                           | 全員  | 辞書一覧                                             |
| `/config show`                                                         | 管理  | サーバー設定・環境設定の実効値                       |
| `/config autojoin enabled:<boolean>`                                   | 管理  | 自動参加の切り替え                                   |
| `/config exclude channel:<VC>` / `/config include channel:<VC>`        | 管理  | 自動参加の除外・解除                                 |
| `/config channel set channel:<text>` / `/config channel reset`         | 管理  | 固定読み上げ先の設定・解除                           |
| `/config default-voice speaker:<候補>` / `/config default-voice-reset` | 管理  | サーバー既定話者の設定・解除                         |
| `/config max-length value:<10〜500>` / `/config max-length-reset`      | 管理  | 本文上限の設定・環境設定への復帰                     |
| `/config skip-prefix value:<最大5文字>` / `/config skip-prefix-reset`  | 管理  | 除外接頭辞の設定・環境設定への復帰。値省略で除外なし |
| `/config announce enabled:<boolean>`                                   | 管理  | 接続音声の切り替え。クレジット投稿は継続             |
| `/config read-name mode:<off/on_change>`                               | 管理  | 発話者が変わったときの名前読み                       |
| `/config dict-permission mode:<everyone/admin>`                        | 管理  | 辞書変更権限の切り替え                               |
| `/speaker install speaker:<候補>`                                      | 管理  | 規約確認後にキャラを有効化                           |
| `/speaker uninstall speaker:<候補>`                                    | 管理  | 追加キャラを無効化                                   |
| `/speaker list`                                                        | 管理  | 標準・導入済み・追加可能数の一覧                     |
| `/credits`                                                             | 全員  | 利用可能な全キャラのクレジット・規約を公開           |

※ 辞書変更は `/config dict-permission mode:admin` で管理者に制限できます。表記1〜50文字、読み1〜100文字、サーバーごとに最大500件。NFKC と ASCII 小文字で照合し、長い表記から一度だけ置換します。

`/voice`・`/config`・各一覧は非公開返信、入退室・スキップ・辞書変更・クレジットは公開です。追加キャラは非公開画面で60秒以内に規約を確認して確定すると公開通知されます。

## 設定とクレジット

`.env.example` に全環境変数を列挙しています。代表的な既定値は `LOG_LEVEL=info`、`DEFAULT_STYLE_ID=3`（ずんだもん）、`READ_MAX_LENGTH=100`、`MAX_QUEUE_LENGTH=20`、`AUTO_LEAVE_GRACE_MS=10000`、`VOICEVOX_TIMEOUT_MS=15000` です。`READ_SKIP_PREFIX` は未設定なら `;`、空なら除外なしです。設定ファイル例の空欄も必要に応じて編集してください。

話者はユーザー設定 → サーバー既定 → 環境既定の順で解決します。初期の主要キャラは四国めたん、ずんだもん、春日部つむぎ、雨晴はう、波音リツ、玄野武宏、白上虎太郎、青山龍星、冥鳴ひまり、九州そら。ENGINE に存在するものだけを選べます。公式 ENGINE の `/speaker install` は同梱キャラのサーバー単位の有効化です。標準10キャラは解除できません。

[VOICEVOX の利用規約](https://voicevox.hiroshiba.jp/term/)と各キャラクターの規約に従い、**VOICEVOX:キャラ名** のクレジットを表記してください。Bot は接続時とセッション内で新たなキャラを使う際に公開投稿し、`/credits` でも一覧を表示します。投稿失敗時も読み上げを継続するため、運用者は通知先の閲覧・送信権限と warn ログを確認してください。生成音声を録音・公開する場合にも必要な表記を行います。

バックアップ、更新、ログ、音が出ない場合の確認方法は [docs/OPERATIONS.md](docs/OPERATIONS.md)、設計は [docs/PLAN.md](docs/PLAN.md) にあります。
