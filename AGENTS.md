# AGENTS.md

AI コーディングエージェント向けのリポジトリガイド。人間の開発者も参照してよい。

## プロジェクト概要

kosuzu は VOICEVOX を使った Discord 読み上げ Bot。個人・サークル規模での自宅 PC / 個人サーバー常駐運用を想定している。
要件・設計・マイルストーンは [docs/PLAN.md](docs/PLAN.md) にある。作業前に必ず目を通し、設計を変えた場合は PLAN.md も更新すること。

## 技術スタック

- TypeScript / Node.js 24 LTS（ESM）
- discord.js v14, @discordjs/voice
- VOICEVOX ENGINE（別プロセス、HTTP API）
- SQLite（`node:sqlite`）
- pino（ログ）, Vitest（テスト）, ESLint + Prettier

## ディレクトリ構成（予定）

```
src/
  index.ts          エントリポイント（起動・シャットダウン）
  config.ts         環境変数の読み込みと検証
  commands/         スラッシュコマンド（1 コマンド 1 ファイル）
  events/           Discord イベントハンドラ
  voice/            VC 接続・再生キュー・自動入退室
  tts/              テキスト正規化・VOICEVOX クライアント
  store/            SQLite アクセスとマイグレーション
scripts/            コマンド登録などの補助スクリプト
docs/               設計ドキュメント
tests/              テスト
```

M3: `voice/manager.ts` がギルド別セッションと接続を管理し、`voice/session.ts` が先読み・FIFO 再生を担当する。`events/messageCreate.ts` で対象投稿を処理し、`tts/normalize.ts` と `tts/wav.ts` は純粋関数。コマンドは `execute(interaction, context)` でセッション管理と話者解決を受け取る。

## コマンド（M1 以降で整備）

- `npm install` 依存関係のインストール
- `npm run dev` 開発起動（ファイル監視）
- `npm start` 本番起動
- `npm run build` 型チェック・ビルド
- `npm test` テスト
- `npm run lint` Lint
- `npm run deploy-commands` スラッシュコマンドの登録

変更を加えたら、コミット前に `npm run build`・`npm run lint`・`npm test` が通ることを確認する。

## コーディング規約

- メッセージコマンド（prefix コマンド）は実装しない。ユーザー操作はすべてスラッシュコマンド。
- 管理者向けコマンドは `setDefaultMemberPermissions` で既定非表示にし、ハンドラでも権限を再チェックする。
- Bot は常駐前提。個々のコマンドやイベント処理の例外で全体を落とさない（捕捉してログ・ユーザーへエラー返信）。
- VOICEVOX ENGINE が落ちていても Bot は起動・稼働を続ける。
- Discord / VOICEVOX との通信部分はインターフェースで切り出し、テストではモックする。
- ログは `console` ではなく pino ロガーを使う。
- ユーザー向けメッセージは日本語。コード中の識別子は英語。コメントは日本語可。

## 秘密情報

- Bot トークン等は `.env` に置き、絶対にコミットしない。必要なキーは `.env.example` に値なしで列挙する。
- SQLite の DB ファイル（`data/`）もコミットしない。

## Git

- ブランチ: `main` に直接コミットせず、作業ブランチから PR を出す（初期セットアップを除く）。
- コミットメッセージ: 日本語または英語で、1 行目に変更の要約。

## VOICEVOX 利用上の注意

- 各キャラクターの利用規約に従い「VOICEVOX:キャラ名」のクレジット表記を行う。キャラ追加時は `/credits` に反映されることを確認する。
