# kosuzu

VOICEVOX を使う Discord 読み上げ Bot です。`/ping`、`/join`、`/leave`、`/skip` と手動接続での読み上げに対応しています。

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

VOICEVOX ENGINE を起動し、VC に参加して、読み上げたいテキストチャンネルで `/join` を実行します。Bot が「接続しました」と読み上げ、そのチャンネルのメッセージを順番に読み上げます。`/skip` で現在の発話を飛ばし、`/leave` で退出します。同じ VC で `/join` を再実行すると読み上げ対象を変更でき、別の VC から実行すると移動します。

既定の話者はスタイル ID 3（VOICEVOX:ずんだもん）。Bot プロフィール等にクレジットを表記し、利用するキャラクターの規約に従ってください。`DEFAULT_STYLE_ID` で話者を変更できます（ユーザー別設定は M4）。

Bot・システム投稿と `;` で始まる投稿は除外します。`READ_SKIP_PREFIX` で接頭辞を変更できます（未設定なら `;`、空文字なら除外なし）。URL・コードブロック・伏せ字を省略し、メンションは表示名、カスタム絵文字は名前に置換します。Unicode 絵文字はそのまま保持し、連続する `w` / `ｗ` は「わらわら」にまとめます。添付だけなら「添付ファイル」と読みます。

`READ_MAX_LENGTH` は既定 100 文字で、超過時に「以下略」を追加します。`MAX_QUEUE_LENGTH` は再生中を除く未再生発話の上限（既定 20）です。満杯なら新しい発話を警告ログ付きで拒否します。最大 2 件を先読み合成し、再生は FIFO、合成・再生に失敗した発話だけをスキップします。

音声は VOICEVOX に 48 kHz・ステレオを要求し、PCM 16-bit WAV の data チャンクを検証・抽出して直接 Opus に変換します。FFmpeg は不要です。DAVE は `@discordjs/voice` 同梱の `@snazzah/davey`、Opus は Windows / Node 24 で導入できる `opusscript` を使用します。
