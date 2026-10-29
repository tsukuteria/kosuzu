# kosuzu

VOICEVOX を使う Discord 読み上げ Bot です。`/ping`、`/join`、`/leave`、`/skip` 、`/voice` と手動接続での読み上げに対応しています。

## 準備

- Node.js 24
- Discord アプリケーションの Developer Portal で Message Content Intent を有効化
- Developer Portal の「Installation」で Guild Install を有効にし、スコープに `bot` と `applications.commands` を設定（User Install は無効でも可）
- `bot` と `applications.commands` のスコープで Bot をサーバーに招待
- Bot に View Channel（チャンネルを見る）、Send Messages（メッセージを送信）、Connect（接続）、Speak（発言）の権限を付与

## 起動

1. `npm install` を実行します。
2. `.env.example` を `.env` にコピーし、トークンとアプリケーション ID を設定します。開発用サーバー ID を指定すると、そのサーバーにコマンドを登録します。
3. `npm run deploy-commands` でコマンドを登録します。表示されない場合は Discord クライアントの再読み込み（Ctrl+R）が必要なことがあります。
4. `npm start` でビルドして起動します。

## VOICEVOX ENGINE の起動

`docker compose up -d` で CPU 版エンジンを起動します（Bot は `npm start` で別途起動）。Docker を使わない場合は、VOICEVOX デスクトップ版または ENGINE をローカルで起動してください。既定の接続先は `http://127.0.0.1:50021` です。変更する場合は `.env` の `VOICEVOX_URL` を設定します。

エンジンの起動後、`npm run voicevox:smoke` でバージョン・話者を確認し、短い音声を `data/smoke.wav` に保存できます。`npm run voicevox:smoke -- 3` のようにスタイル ID を指定できます（既定は 3、ずんだもん ノーマル）。Discord の設定は不要です。生成音声を公開する際は、ログに出る `VOICEVOX:キャラ名` のクレジットを表記し、各キャラクターの利用規約に従ってください。

`VOICEVOX_TIMEOUT_MS` でリクエストのタイムアウトを変更できます（既定 15000ms、GET は最大 5000ms）。エンジンが停止していても Bot は起動・稼働を続けます。

## 読み上げ

VOICEVOX ENGINE を起動し、VC に参加して、読み上げたいテキストチャンネルで `/join` を実行します。Bot が「接続しました」と読み上げ、実行チャンネルと VC 内蔵チャットのメッセージを順番に読み上げます。`/join`・`/skip`・`/leave` の実行結果は公開返信です（入力・権限エラーは非公開）。`/skip` で現在の発話を飛ばし、`/leave` で退出します。同じ VC で `/join` を再実行すると読み上げ対象を変更でき、別の VC から実行すると移動します。

既定の話者はスタイル ID 3（VOICEVOX:ずんだもん）。Bot プロフィール等にクレジットを表記し、利用するキャラクターの規約に従ってください。`DEFAULT_STYLE_ID` で話者を変更できます。

Bot・システム投稿と `;` で始まる投稿は除外します。`READ_SKIP_PREFIX` で接頭辞を変更できます（未設定なら `;`、空文字なら除外なし）。URL・コードブロック・伏せ字を省略し、メンションは表示名、カスタム絵文字は名前に置換します。Unicode 絵文字はそのまま保持し、連続する `w` / `ｗ` は「わらわら」にまとめます。添付だけなら「添付ファイル」と読みます。

`READ_MAX_LENGTH` は既定 100 文字で、超過時に「以下略」を追加します。`MAX_QUEUE_LENGTH` は再生中を除く未再生発話の上限（既定 20）です。満杯なら新しい発話を警告ログ付きで拒否します。最大 2 件を先読み合成し、再生は FIFO、合成・再生に失敗した発話だけをスキップします。

音声は VOICEVOX に 48 kHz・ステレオを要求し、PCM 16-bit WAV の data チャンクを検証・抽出して直接 Opus に変換します。FFmpeg は不要です。DAVE は `@discordjs/voice` 同梱の `@snazzah/davey`、Opus は Windows / Node 24 で導入できる `opusscript` を使用します。

## ユーザー別音声

`/voice set <speaker>` の候補からキャラ・スタイルを選びます。`/voice show` で現在の話者・話速・ピッチと既定話者の利用状態を確認できます。`/voice speed <value>` は 0.5〜2.0、`/voice pitch <value>` は -0.15〜0.15。`/voice reset` で自分の設定を削除し、`/voice list` で利用可能なキャラ・スタイルを確認します。すべて非公開返信です。

初期の主要キャラは四国めたん、ずんだもん、春日部つむぎ、雨晴はう、波音リツ、玄野武宏、白上虎太郎、青山龍星、冥鳴ひまり、九州そら。ENGINE に存在する話者だけを表示します。ユーザー未設定・利用不可時はサーバー既定 → `DEFAULT_STYLE_ID` の順に解決します。速度・ピッチだけの設定では既定話者に追従します。設定の既定話者も利用不可なら、その発話をログ付きで処理失敗とします。

## データの保存

`DATABASE_PATH`（既定 `data/kosuzu.db`）に SQLite DB を作成し、ユーザー設定・サーバー既定・最後の `/join` 実行チャンネル・追加話者の有効化を保存します。`data/` はバックアップしてください。WAL 使用中は DB 本体だけのコピーを避け、Bot 停止後にコピーするか SQLite のバックアップ機能を使います。正常終了時に DB を閉じます。Node.js 24.22.0 では `node:sqlite` の ExperimentalWarning は発生しません。

M5 用に `sessions.join(channel, 'auto')` を用意しています。読み上げ対象は VC チャットと最後の `/join` 実行チャンネル（現在も存在し、Bot が閲覧・送信可能な場合）。自動参加の検出自体は M5 で実装します。
