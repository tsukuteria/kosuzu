# kosuzu

VOICEVOX を使う Discord 読み上げ Bot です。現在は骨組み、`/ping`、VOICEVOX クライアントを実装しています。

## 準備

- Node.js 24
- Discord アプリケーションの Developer Portal で Message Content Intent を有効化
- Developer Portal の「Installation」で Guild Install を有効にし、スコープに `bot` と `applications.commands` を設定（User Install は無効でも可）
- `bot` と `applications.commands` のスコープで Bot をサーバーに招待

## 起動

1. `npm install` を実行します。
2. `.env.example` を `.env` にコピーし、トークンとアプリケーション ID を設定します。開発用サーバー ID を指定すると、そのサーバーにコマンドを登録します。
3. `npm run deploy-commands` でコマンドを登録します。表示されない場合は Discord クライアントの再読み込み（Ctrl+R）が必要なことがあります。
4. `npm start` でビルドして起動します。

## VOICEVOX ENGINE の起動

`docker compose up -d` で CPU 版エンジンを起動します（Bot は `npm start` で別途起動）。Docker を使わない場合は、VOICEVOX デスクトップ版または ENGINE をローカルで起動してください。既定の接続先は `http://127.0.0.1:50021` です。変更する場合は `.env` の `VOICEVOX_URL` を設定します。

エンジンの起動後、`npm run voicevox:smoke` でバージョン・話者を確認し、短い音声を `data/smoke.wav` に保存できます。`npm run voicevox:smoke -- 3` のようにスタイル ID を指定できます（既定は 3、ずんだもん ノーマル）。Discord の設定は不要です。生成音声を公開する際は、ログに出る `VOICEVOX:キャラ名` のクレジットを表記し、各キャラクターの利用規約に従ってください。

`VOICEVOX_TIMEOUT_MS` でリクエストのタイムアウトを変更できます（既定 15000ms、GET は最大 5000ms）。エンジンが停止していても Bot は起動・稼働を続けます。
