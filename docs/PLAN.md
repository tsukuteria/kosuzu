# kosuzu 開発計画

Discord 用 VOICEVOX 読み上げ Bot。個人・サークル規模で、メンバーの自宅 PC / 個人サーバーに常駐させて運用する。

## 1. 要件

| # | 要件 | 備考 |
|---|------|------|
| R1 | 個人・サークル規模（数サーバー程度）で利用、自宅 PC / 個人サーバーで運用 | シャーディング不要。導入の手軽さを優先 |
| R2 | GUI なし、CLI で起動し 24/365 常駐 | 自動再起動・再接続・ログ出力が必要 |
| R3 | スラッシュコマンド対応 | メッセージコマンド（prefix）は実装しない |
| R4 | `/join` `/leave` による手動参加に加え、VC セッション開始/終了を検知して自動参加・自動退出 | `voiceStateUpdate` を監視 |
| R5 | VOICEVOX の主要キャラクターで読み上げ、ユーザーごとに話者を切り替え可能 | サーバー単位 × ユーザー単位で保存 |
| R6 | 管理者はスラッシュコマンドから新規キャラを「インストール」できる | 下記 §4.5 参照 |

## 2. 技術スタック

| 領域 | 採用 | 理由 |
|------|------|------|
| 言語 / ランタイム | TypeScript / Node.js 24 LTS | discord.js のエコシステムが最も成熟 |
| Discord | discord.js v14 + @discordjs/voice | スラッシュコマンド・Voice・DAVE（E2EE 音声）に公式対応 |
| 音声エンコード | @discordjs/opus（または opusscript）, prism-media | VOICEVOX が返す WAV を Opus に変換 |
| 音声合成 | VOICEVOX ENGINE（HTTP API, 既定 `http://127.0.0.1:50021`） | Bot とは別プロセス。Docker 公式イメージ or ローカル版 |
| 永続化 | SQLite（`node:sqlite`） | ネイティブビルド不要、ファイル 1 つでバックアップ容易 |
| 設定 | `.env`（トークン等の秘密）+ DB（サーバー別設定） | |
| ログ | pino | 構造化ログ、常駐運用で調査しやすい |
| テスト | Vitest | |
| Lint / Format | ESLint + Prettier | |
| パッケージ管理 | npm | |
| 常駐 | Docker Compose（`restart: unless-stopped`）を第一推奨。代替として pm2 / systemd / Windows タスクスケジューラ | |

## 3. アーキテクチャ

```
                ┌──────────────────────── kosuzu (Node.js) ────────────────────────┐
Discord Gateway │  commands/   スラッシュコマンド定義・ハンドラ                      │
  ─────────────▶│  events/     messageCreate / voiceStateUpdate / ready ...         │
                │  voice/      GuildVoiceSession（接続・再生キュー・自動入退室）     │
                │  tts/        テキスト正規化 → VoicevoxClient → WAV                │
                │  store/      SQLite リポジトリ（ユーザー話者・サーバー設定・辞書）│
                └───────────────────────────────┬──────────────────────────────────┘
                                                │ HTTP
                                     ┌──────────▼──────────┐
                                     │   VOICEVOX ENGINE   │
                                     └─────────────────────┘
```

- **GuildVoiceSession**: サーバーごとに 1 インスタンス。VC 接続、読み上げ対象テキストチャンネル、再生キュー（FIFO・直列再生）を保持する。
- **読み上げパイプライン**: メッセージ受信 → フィルタ（Bot・コマンド・対象外チャンネル除外）→ 正規化（URL・メンション・絵文字・コードブロック置換、ユーザー辞書適用、文字数上限で切り詰め）→ `audio_query` → `synthesis` → キュー投入 → 再生。
- 合成は再生と並行して先読みし、待ち時間を短くする。
- M3: 正規化した発話を先にキューに入れ、最大 2 件を並行合成する。再生順は FIFO。未再生上限（既定 20）では新着を拒否し警告ログを出す。Unicode 絵文字は保持する。
- M3: WAV は 48 kHz / ステレオ / PCM 16-bit を要求し、チャンクを検証して Raw 再生するため FFmpeg は不要。Opus は Windows / Node 24 でネイティブ導入が失敗したため opusscript を採用。
- **TtsEngine**: 後続の処理はこのインターフェースに依存し、`index.ts` で `VoicevoxClient` を構築する。GET の通信失敗のみ最大 2 回再試行し、POST は再試行しない。話者カタログは 5 分キャッシュし、明示的な更新・無効化とスタイル検索を提供する。

## 4. 機能設計

### 4.1 スラッシュコマンド（初期案）

| コマンド                      | 権限   | 内容                                                                                   |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `/join`                       | 全員   | 実行者のいる VC に参加し、実行チャンネルと VC チャットを読み上げ対象にする（公開返信） |
| `/leave`                      | 全員   | VC から退出（公開返信）                                                                |
| `/skip`                       | 全員   | 再生中の読み上げをスキップ（公開返信）                                                 |
| `/voice set <speaker>`        | 全員   | 自分の話者（キャラ・スタイル）を設定。オートコンプリートで候補表示                     |
| `/voice show`                 | 全員   | 自分の現在の話者・速度等を表示                                                         |
| `/voice speed` `/voice pitch` | 全員   | 自分の話速・ピッチ調整                                                                 |
| `/voice reset`                | 全員   | 自分の音声設定を削除（非公開）                                                         |
| `/voice list`                 | 全員   | 利用可能なキャラ一覧                                                                   |
| `/dict add\|remove\|list` | 全員（設定で制限可） | サーバー辞書（読み替え）管理 |
| `/config autojoin on\|off` | 管理者 | 自動参加の有効/無効 |
| `/config channel <text>`      | 管理者 | 自動参加時の読み上げ対象テキストチャンネル                                             |
| `/config default-voice`       | 管理者 | サーバー既定の話者                                                                     |
| `/speaker install <name>`     | 管理者 | 新規キャラのインストール（§4.5）                                                       |
| `/speaker uninstall <name>`   | 管理者 | キャラの無効化                                                                         |
| `/credits`                    | 全員   | VOICEVOX および各キャラのクレジット表記                                                |

- `/voice` の返信はすべて非公開。`/join`・`/skip`・`/leave` の実行結果は公開、入力・権限エラーは非公開。
- 管理者向けコマンドは `setDefaultMemberPermissions(ManageGuild)` で既定非表示にし、ハンドラ側でも権限を再チェックする。
- コマンド登録は `npm run deploy-commands` で行う（開発時はギルドコマンド、本番はグローバルコマンド）。

### 4.2 自動参加・自動退出（R4）

`voiceStateUpdate` で各 VC の「人間（Bot 以外）の人数」を追跡する。

- **開始検知**: Bot が未接続のサーバーで、ある VC の人間が 0 → 1 になったら参加。
- **終了検知**: Bot が接続中の VC の人間が 0 になったら退出（短い猶予時間を設けて瞬断・移動に耐える）。
- 複数の VC で同時にセッションがある場合は先着の VC に留まる（1 サーバー 1 接続の Discord 制約）。
- 読み上げ対象はチャンネル ID の集合。手動 `/join` は実行チャンネルと VC 内蔵チャット（VC と同じ ID）。VC 移動時は移動先のチャットに追従する。
- `/join` 実行時に `last_text_channel_id` を保存。M4 の `sessions.join(channel, 'auto')` は VC チャットと最後の実行チャンネル（現在も存在し、Bot が閲覧・送信可能な場合）を読む。M5 で自動参加検出からこの経路を利用する。`/config channel` の拡張は M7。
- AFK チャンネルや、設定で除外した VC は対象外。
- 参加・退出時に「接続しました」等の短いアナウンスを読み上げる（設定で切替）。
- Bot 起動時は既存の VC 状態をスキャンし、セッション中の VC があれば参加する。

### 4.3 ユーザーごとの話者（R5）

- 保存単位は `(guild_id, user_id)`。未設定ならサーバー既定 → グローバル既定の順にフォールバック。
- 話者は VOICEVOX の `style_id` で保持し、表示時は `/speakers` から名前を引く。
- 初期状態で選択可能にする「主要キャラ」はホワイトリスト（例: 四国めたん、ずんだもん、春日部つむぎ、雨晴はう、波音リツ、玄野武宏、白上虎太郎、青山龍星、冥鳴ひまり、九州そら）の UUID 定数で定義する。追加有効化は DB の全体・ギルド別行を利用し、ENGINE に存在する話者との積集合だけを公開する。

### 4.4 データモデル（SQLite）

- M4 migration 1（TypeScript 内の連番 SQL、STRICT テーブル）:
  - `guild_settings(guild_id TEXT PK, default_style_id INTEGER NULL, last_text_channel_id TEXT NULL)`
  - `user_voices(guild_id TEXT, user_id TEXT, style_id INTEGER NULL, speed REAL NOT NULL DEFAULT 1 CHECK(0.5〜2.0), pitch REAL NOT NULL DEFAULT 0 CHECK(-0.15〜0.15), PK(guild_id,user_id))`
  - `enabled_speakers(guild_id TEXT NULL=global, speaker_uuid TEXT NOT NULL, installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, installed_by TEXT NOT NULL)`
- `enabled_speakers` はギルド行 `(guild_id,speaker_uuid)` とグローバル行 `(speaker_uuid)` に別々の部分 UNIQUE INDEX を設定し、NULL の重複を防ぐ。
- `style_id NULL` は速度・ピッチのみ指定して既定話者に追従するため。話者の解決はユーザー → サーバー既定 → 環境設定。利用不可の保存 ID は debug ログ付きで飛ばす。速度・ピッチはユーザー値、未設定なら 1 / 0。設定の既定 ID も利用不可なら解決失敗（発話単位で捕捉）。カタログは既存の ENGINE クライアントの TTL キャッシュを利用。
- `DATABASE_PATH` の既定は `data/kosuzu.db`。親ディレクトリ自動作成、WAL・foreign_keys・busy_timeout 有効化。`PRAGMA user_version` で版を管理し、未適用分を起動時に単一トランザクションで順番に適用。未来版は拒否。正常終了時は DB を閉じる。
- `dictionary` や autojoin 等の設定列は後続マイルストーンのマイグレーションで追加する。

### 4.5 キャラの「インストール」（R6）

VOICEVOX ENGINE の話者は通常エンジン同梱の音声モデル（VVM）で決まるため、2 段構えで実装する。

1. **有効化（必須実装）**: エンジンが持つが Bot 側で未公開の話者を、選択可能リストに追加する。`/speaker install` のオートコンプリートには「エンジンにあるが未有効」の話者を出し、実行時に `POST /initialize_speaker` で事前ロードしてから `enabled_speakers` に登録する。
2. **ライブラリ追加（エンジンが対応している場合）**: `GET /engine_manifest` の `supported_features.manage_library` が真なら、`GET /downloadable_libraries` → `POST /install_library/{uuid}` でエンジンに音声ライブラリを追加できるようにする。非対応エンジンでは「エンジンの更新が必要」と案内する。

   `install_library` は ZIP 本体をリクエストボディに要求するため、M2 の `installLibrary(uuid, archive: Blob)` は呼び出し元から ZIP を受け取る。取得・規約確認は M6 で実装する。`installed_libraries` の応答は UUID をキーとするオブジェクト。インストール成功時は話者キャッシュを無効化する。

新キャラの利用規約・クレジット表記が必要なため、インストール時に規約 URL を表示し `/credits` に自動反映する。

### 4.6 運用（R2）

- `npm start` でフォアグラウンド常駐、`docker compose up -d` で Bot + VOICEVOX ENGINE をまとめて常駐。
- Gateway / Voice の切断は discord.js の自動再接続に任せ、Voice は `Disconnected` 状態で再接続を試み、失敗時はセッション破棄。
- VOICEVOX ENGINE 未起動・応答なしの場合はリトライし、ログに警告。Bot 自体は落とさない。
- 未捕捉例外はログ出力して終了 → プロセスマネージャーが再起動。
- `SIGINT` / `SIGTERM` で VC から退出してから終了（グレースフルシャットダウン）。
- GPU 版エンジンの利用は任意（CPU 版で個人規模は十分）。

### 4.7 必要な Discord 設定

- Privileged Intent: **Message Content**（読み上げに必須）
- Intents: `Guilds`, `GuildVoiceStates`, `GuildMessages`, `MessageContent`
- Developer Portal の「Installation」で Guild Install を有効にし、スコープに `bot`, `applications.commands` を設定（User Install は無効でも可）
- 招待スコープ: `bot`, `applications.commands`
- Bot 権限: View Channels, Send Messages, Read Message History, Connect, Speak, Use Voice Activity

## 5. マイルストーン

| M | 内容 | 完了条件 |
|---|------|----------|
| M0 | リポジトリ初期化（本コミット） | `.gitignore` / AGENTS.md / 計画書 |
| M1 | プロジェクト骨組み | TS・ESLint・Vitest・pino・設定ロード、`npm start` でログイン、`/ping` が応答 |
| M2 | VOICEVOX クライアント | `/speakers` 取得、`audio_query`→`synthesis` を単体テスト（モック）で検証 |
| M3 | 手動入退室と読み上げ | `/join` `/leave` `/skip`、テキスト正規化、再生キュー |
| M4 | ユーザー別話者 | SQLite 導入、`/voice` 系コマンド、オートコンプリート |
| M5 | 自動入退室 | `voiceStateUpdate` 追跡、起動時スキャン、`/config autojoin` |
| M6 | キャラのインストール | `/speaker install/uninstall`、`/credits` |
| M7 | 辞書・サーバー設定 | `/dict`、`/config` 一式 |
| M8 | 運用整備 | Dockerfile / compose、README の導入手順、グレースフルシャットダウン |

## 6. リスク・留意点

- **VOICEVOX 利用規約**: 各キャラの規約に従い「VOICEVOX:キャラ名」のクレジット表記が必要。`/credits` と Bot のプロフィール（About Me）で表記する。
- **DAVE（音声 E2EE）**: Discord は音声接続の E2EE 対応を必須化している。@discordjs/voice を最新に保つ。
- **自宅回線**: Voice は UDP を使用。ルーター・ファイアウォールで外向き UDP が塞がれていないこと。
- **長文・連投**: 文字数上限・キュー長上限を設けて読み上げの滞留を防ぐ。
