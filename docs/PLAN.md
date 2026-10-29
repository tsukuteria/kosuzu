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

### 4.1 スラッシュコマンド

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
| `/config autojoin enabled:<boolean>` | 管理者 | 自動参加の有効/無効 |
| `/config exclude` / `include channel:<voice>` | 管理者 | 自動参加の除外 VC を追加・解除 |
| `/config show` | 管理者 | サーバー設定と環境設定の実効値を表示 |
| `/config channel set channel:<text>` / `channel reset` | 管理者 | 固定読み上げチャンネルを設定・解除 |
| `/config max-length` / `max-length-reset` | 管理者 | 本文の文字数上限・環境設定への復帰 |
| `/config skip-prefix` / `skip-prefix-reset` | 管理者 | 除外接頭辞・環境設定への復帰 |
| `/config announce` / `read-name` / `dict-permission` | 管理者 | 接続音声・名前・辞書変更権限 |
| `/config default-voice speaker:<speaker>` / `default-voice-reset`       | 管理者 | サーバー既定の話者                                                                     |
| `/speaker install <speaker>`     | 管理者 | 新規キャラのインストール（§4.5）                                                       |
| `/speaker uninstall <speaker>`   | 管理者 | キャラの無効化                                                                         |
| `/speaker list`               | 管理者 | 標準・導入済み（導入者・日時）・追加可能数を非公開表示 |
| `/credits`                    | 全員   | VOICEVOX および各キャラのクレジット表記                                                |

- `/voice` の返信はすべて非公開。`/join`・`/skip`・`/leave` の実行結果は公開、入力・権限エラーは非公開。
- 管理者向けコマンドは `setDefaultMemberPermissions(ManageGuild)` で既定非表示にし、ハンドラ側でも権限を再チェックする。
- コマンド登録は `npm run deploy-commands` で行う（開発時はギルドコマンド、本番はグローバルコマンド）。

### 4.2 自動参加・自動退出（R4）

`voice/autoJoin.ts` が `voiceStateUpdate` と起動時スキャンを処理する。人数・開始条件・候補選択は純粋関数、Discord キャッシュと権限の取得は小さな変換関数に分離する。

- **開始検知**: Bot が未接続で、通常 VC の人間（Bot 以外）が 0 → 1 以上になったとき自動参加。サーバー設定 `autojoin` は既定で有効。
- AFK・ステージ・除外 VC・Bot に Connect + Speak 権限のない VC は自動参加の対象外。
- **終了検知**: 手動・自動とも接続 VC が無人なら `AUTO_LEAVE_GRACE_MS`（既定 10000ms、0〜2147483647）後に退出。再入室で取消し、期限時にも人数・セッションを確認する。
- 退出後は他の対象 VC に人間がいれば参加。起動時も同じく、人間の人数が多い順 → チャンネル位置の昇順 → ID の辞書順で選択する。接続中は他 VC の開始だけでは移動しない。
- `autojoin` 無効化・除外変更は次回の自動参加判定から適用し、現在の接続は維持する。無人時の退出は無効化中も行う。有効化時には即時スキャンせず、次の開始イベントまたは再起動から参加する。
- 読み上げ対象は ID の集合。手動 `/join` は実行チャンネルと VC 内蔵チャットと固定チャンネルを対象とし、`last_text_channel_id` を保存。自動参加は VC チャットと固定チャンネル（未設定なら最後の実行チャンネル）を読む。追加先は閲覧・送信可能な場合に限る。
- Bot が外部から移動されたらセッションの VC ID と VC チャット対象を即時更新し、追加の非 VC 対象は保持する。外部切断なら即時破棄し、自動再参加しない。通常の Disconnected 復旧待機は維持するが、破棄後は Ready 待機や復旧失敗ログを抑止する。
- 接続音声は設定で無効化できる。接続・クレジットの公開投稿は常に行う（§4.8）。
- ギルドごとに自動判定を直列化し、manager の join 待機列内でも auto の既存接続を再確認する。接続失敗は warn を記録し、定期再試行は行わない（次の新規セッション開始は再試行可能）。
- manager のセッション変更通知で手動接続も監視し、`destroyAll()` / シャットダウンでタイマー・待機中の自動判定を停止する。

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
- M5 migration 2: `guild_settings` に `autojoin INTEGER NOT NULL DEFAULT 1`、`excluded_voice_channels TEXT NOT NULL DEFAULT '[]'`（VC ID の JSON 配列）を追加。既存行も既定で有効。
- M7 migration 3: `dictionary(guild_id, surface, reading, created_by, created_at)` を追加し、表記は NFKC と ASCII 小文字に正規化してギルド内で一意とする。`guild_settings` に固定チャンネル、文字数上限、除外接頭辞、接続音声、名前読み、辞書変更権限を追加する。NULL の文字数・接頭辞は環境設定に従い、空の接頭辞は無効を意味する。
- 辞書は通常の正規化後、本文の文字数制限前に最長一致で一度だけ適用する。正規化で生成した「URL省略」などにも辞書が適用される。名前にも辞書を適用し、20 書記素で末尾表記なしに切り詰める。空でなければ発話者が変わった場合のみ付け、本文の文字数上限には含めない。

### 4.5 キャラの「インストール」（R6）

公式 VOICEVOX ENGINE 0.26.0 は `manage_library=false` で、`/downloadable_libraries` も提供しない。「インストール」は ENGINE に同梱済みのキャラをギルドで有効化する操作とする。標準10キャラは常に選択可能。

- `/speaker` は ManageGuild を登録時・実行時・候補取得時に確認する。install 候補は未選択可能のキャラ名（最大25件、値は UUID）。
- install は非公開で defer し、`speaker_info?resource_format=url` の policy から抜粋（先頭8行・最大600文字）・最初の規約 URL・`VOICEVOX:キャラ名` を表示する。policy はクライアントでメモリキャッシュし、失敗はキャッシュしない。
- 実行者だけが「規約を確認してインストール」/「キャンセル」を操作できる。60秒で期限切れ、終了後はボタン無効化。確定時にも管理権限を確認する。
- 全スタイルを `initializeSpeaker(styleId, { skipReinit: true })` で順番に事前ロードし、個々の失敗はログ・非公開返信で報告して続行する。ギルド行を installed_by 付きで保存し、チャンネルにクレジットと `/voice set` の案内を公開する。通知失敗時も登録は保持し管理者へ案内する。
- uninstall はギルドの導入行だけを削除する（ENGINE のモデルやグローバル行は削除しない）。標準キャラは拒否する。保存話者が利用不可になるユーザー数を非公開返信へ含め、公開通知する。保存設定は保持し、既存 resolver の既定話者へのフォールバックを使う。
- カタログは ENGINE のキャッシュと毎回の DB 有効化設定の積集合を使う。有効化リストのキャッシュは持たないため `/voice set`・resolver・`/credits` に変更が即時反映される。
- `manage_library=true` のエンジンだけは、未導入ライブラリを「音声ライブラリ」付き・`lib:<uuid>` の候補に追加する。メタデータの policy または terms_of_service を表示し（未提供なら配布元での規約確認を案内）、確認後にZIP を60秒・最大256 MiB（ヘッダーと受信量の両方）で取得して `installLibrary` へ渡す。話者を再取得して新たに現れたキャラを有効化する。追加キャラがない場合は失敗として案内する。非対応エンジンへの直接指定は更新を案内する。
- `/credits` は全員が実行できる公開返信。ENGINE の接続を確認し、選択可能な全キャラを UUID でまとめ、VOICEVOX 本体・公式サイト・各 `VOICEVOX:キャラ名` と取得できた規約 URL を表示する。各キャラの規約が適用される旨を付記し、1メッセージ1 embed（説明3800文字以内）へ分割する。ENGINE 停止時は再実行を案内する。

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

### 4.8 音声利用時のクレジット表示

- `voice/credits.ts` が純粋なキャラ収集・書式関数とセッション単位の `SessionCredits` を持つ。送信関数を注入し、Discord 通信をモックできるようにする。
- 接続 VC の Bot 以外のメンバーを既存 resolver（ユーザー → サーバー → 環境既定）で解決し、カタログの speaker 名を `VOICEVOX:キャラ名` で表示する。VC メンバーの列挙順で並べ、speaker UUID で重複排除する。取得失敗は公開文面と warn で示す。
- 手動接続は `/join` の公開返信に一覧を含める。同じ VC の対象更新では一覧を再掲せず、通知先を保つ。別 VC への `/join` は新しい返信先へ変更する。
- 自動接続は VC 内蔵チャットの ViewChannel + SendMessages と送信可否を確認し、公開投稿する。不可なら最後の `/join` チャンネルが読み上げ対象かつ閲覧・送信可能な場合だけ使う。通知先がなければ warn を残す。
- セッションは通知先と表示済み speaker UUID 集合を保持する。VC 移動（手動の接続作り直しを含む）では集合を引き継ぎ、外部移動では通知先も保つ。退出後の新規セッションではリセットする。
- `session.enqueue` で未表示キャラの「VOICEVOX:キャラ名 を追加で使用します」を送信開始する。resolver は解決済み音声にキャラ情報も付け、同期的に判定・予約して送信完了を待たずキューへ入れるため、既存の resolve → enqueue の順序を変えない。接続時のカタログも保持し、styleId だけの発話を補完する。未知の ID はキュー内の順序を予約して非同期取得を試み、補完後に通知・合成を開始する。VC 外ユーザーの対象テキスト投稿、話者変更、接続音声も同じ経路で扱う。
- 送信失敗は warn とし、読み上げを止めず次の利用で再試行する。接続音声「接続しました」は従来どおり。`/voice list` の footer は自動公開表示を案内し、`/credits` は §4.5 の公開一覧を提供する。

## 5. マイルストーン

| M | 内容 | 完了条件 |
|---|------|----------|
| M0 | リポジトリ初期化（本コミット） | `.gitignore` / AGENTS.md / 計画書 |
| M1 | プロジェクト骨組み | TS・ESLint・Vitest・pino・設定ロード、`npm start` でログイン、`/ping` が応答 |
| M2 | VOICEVOX クライアント | `/speakers` 取得、`audio_query`→`synthesis` を単体テスト（モック）で検証 |
| M3 | 手動入退室と読み上げ | `/join` `/leave` `/skip`、テキスト正規化、再生キュー |
| M4 | ユーザー別話者 | SQLite 導入、`/voice` 系コマンド、オートコンプリート |
| M5 | 自動入退室 | `voiceStateUpdate` 追跡、起動時スキャン、`/config autojoin` |
| M6 | キャラのインストール（実装済み） | `/speaker install/uninstall/list`、`/credits` |
| M7 | 辞書・サーバー設定（実装済み） | `/dict`、`/config` 一式 |
| M8 | 運用整備 | Dockerfile / compose、README の導入手順、グレースフルシャットダウン |

## 6. リスク・留意点

- **VOICEVOX 利用規約**: 各キャラの規約に従い「VOICEVOX:キャラ名」のクレジット表記が必要。接続時とセッション内の追加利用時に公開表示する（§4.8）。`/credits` でも選択可能キャラと規約 URL を公開する。権限不足・送信障害では表示を保証できず、送信完了も再生の前提にしないため、運用者は通知先の閲覧・送信権限と warn ログを確認する。Bot プロフィールにも利用キャラの表記を推奨する。
- **DAVE（音声 E2EE）**: Discord は音声接続の E2EE 対応を必須化している。@discordjs/voice を最新に保つ。
- **自宅回線**: Voice は UDP を使用。ルーター・ファイアウォールで外向き UDP が塞がれていないこと。
- **長文・連投**: 文字数上限・キュー長上限を設けて読み上げの滞留を防ぐ。
