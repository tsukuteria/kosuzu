# kosuzu

VOICEVOX を使う Discord 読み上げ Bot です。現在は骨組みと `/ping` を実装しています。

## 準備

- Node.js 24
- Discord アプリケーションの Developer Portal で Message Content Intent を有効化
- `bot` と `applications.commands` のスコープで Bot をサーバーに招待

## 起動

1. `npm install` を実行します。
2. `.env.example` を `.env` にコピーし、トークンとアプリケーション ID を設定します。開発用サーバー ID を指定すると、そのサーバーにコマンドを登録します。
3. `npm run deploy-commands` でコマンドを登録します。
4. `npm start` でビルドして起動します。
