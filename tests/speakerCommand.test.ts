import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { speaker } from '../src/commands/speaker.js';
import { credits, creditEmbeds } from '../src/commands/credits.js';
import type { CommandContext } from '../src/commands/types.js';
import { VoicevoxClient, flattenStyles, type Speaker } from '../src/tts/voicevox.js';
import { MAIN_SPEAKER_UUIDS, SpeakerCatalog } from '../src/tts/speakers.js';
import { openDatabase } from '../src/store/database.js';
import { SqliteSettings } from '../src/store/settings.js';
import { createVoiceResolver } from '../src/voice/resolver.js';
import { downloadLibrary } from '../src/tts/library.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.unstubAllGlobals();
});
const builtin: Speaker = {
  name: '四国めたん',
  speaker_uuid: MAIN_SPEAKER_UUIDS[0],
  version: '1',
  styles: [{ id: 2, name: 'ノーマル' }],
};
const extra: Speaker = {
  name: '追加キャラ',
  speaker_uuid: 'extra',
  version: '1',
  styles: [
    { id: 90, name: '通常' },
    { id: 91, name: '別' },
  ],
};
const library = {
  uuid: 'lib-uuid',
  name: '追加ライブラリ',
  version: '1',
  download_url: 'https://example.com/a.zip',
  policy: '利用規約 https://example.com/terms',
};
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
function setup(sub = 'install', value = 'extra') {
  const db = openDatabase(':memory:');
  databases.push(db);
  const store = new SqliteSettings(db);
  const engine = new VoicevoxClient({ baseUrl: 'http://unused', fetch: vi.fn() });
  vi.spyOn(engine, 'version').mockResolvedValue('0.26.0');
  vi.spyOn(engine, 'speakers').mockResolvedValue([builtin, extra]);
  vi.spyOn(engine, 'styles').mockImplementation(async () => flattenStyles(await engine.speakers()));
  vi.spyOn(engine, 'engineManifest').mockResolvedValue({
    name: 'ENGINE',
    brand_name: 'VOICEVOX',
    supported_features: { manage_library: false },
  });
  vi.spyOn(engine, 'speakerInfo').mockResolvedValue({
    policy: 'クレジットが必要です\nhttps://example.com/terms',
  });
  vi.spyOn(engine, 'initializeSpeaker').mockResolvedValue();
  vi.spyOn(engine, 'installLibrary').mockResolvedValue();
  vi.spyOn(engine, 'downloadableLibraries').mockResolvedValue([library]);
  vi.spyOn(engine, 'installedLibraries').mockResolvedValue({});
  vi.spyOn(engine, 'refreshSpeakers').mockResolvedValue([
    builtin,
    extra,
    { ...extra, speaker_uuid: 'new', name: '新規キャラ' },
  ]);
  const catalog = new SpeakerCatalog(engine, store);
  const context: CommandContext = {
    engine,
    store,
    catalog,
    logger: { warn: vi.fn() },
    sessions: { join: vi.fn(), leave: vi.fn(), get: vi.fn() },
    resolveVoice: createVoiceResolver(store, catalog, 2, { debug: vi.fn() }),
  };
  const collector = Object.assign(new EventEmitter(), {
    stop: vi.fn((reason: string) => collector.emit('end', [], reason)),
  });
  const createMessageComponentCollector = vi.fn(() => collector);
  const interaction = {
    guildId: 'g',
    user: { id: 'admin' },
    memberPermissions: { has: vi.fn(() => true) },
    options: { getSubcommand: () => sub, getString: () => value, getFocused: () => '' },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
    followUp: vi.fn(),
    respond: vi.fn(),
    channel: { isSendable: () => true, send: vi.fn().mockResolvedValue(undefined) },
  };
  const press = async (customId = 'install', user = 'admin', allowed = true) => {
    const button = {
      customId,
      user: { id: user },
      memberPermissions: { has: () => allowed },
      deferUpdate: vi.fn(),
      reply: vi.fn(),
    };
    collector.emit('collect', button);
    await flush();
    return button;
  };
  return {
    store,
    engine,
    context,
    interaction,
    collector,
    press,
    createMessageComponentCollector,
    run: () => speaker.execute(interaction as unknown as ChatInputCommandInteraction, context),
    autocomplete: () =>
      speaker.autocomplete!(interaction as unknown as AutocompleteInteraction, context),
    credits: () => credits.execute(interaction as unknown as ChatInputCommandInteraction, context),
  };
}
describe('/speaker', () => {
  it('ManageGuild を登録し、実行時と候補取得時も確認する', async () => {
    expect(speaker.data.toJSON()).toMatchObject({
      default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    });
    const s = setup();
    s.interaction.memberPermissions.has.mockReturnValue(false);
    await s.run();
    await s.autocomplete();
    expect(s.interaction.reply).toHaveBeenCalledWith({
      content: '「サーバー管理」権限が必要です',
      flags: MessageFlags.Ephemeral,
    });
    expect(s.interaction.respond).toHaveBeenCalledWith([]);
    expect(s.engine.speakers).not.toHaveBeenCalled();
  });
  it('install 候補から標準・導入済み・グローバル有効化を除く', async () => {
    const s = setup();
    await s.autocomplete();
    expect(s.interaction.respond).toHaveBeenLastCalledWith([{ name: extra.name, value: 'extra' }]);
    s.store.enableSpeaker('g', 'extra', 'a');
    await s.autocomplete();
    expect(s.interaction.respond).toHaveBeenLastCalledWith([]);
    s.store.disableSpeaker('g', 'extra');
    s.store.enableSpeaker(null, 'extra', 'a');
    await s.autocomplete();
    expect(s.interaction.respond).toHaveBeenLastCalledWith([]);
    expect(s.engine.downloadableLibraries).not.toHaveBeenCalled();
  });
  it('名前で候補を絞り25件以内にする', async () => {
    const s = setup();
    vi.mocked(s.engine.speakers).mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({
        ...extra,
        speaker_uuid: String(i),
        name: `キャラ${i}`,
      })),
    );
    await s.autocomplete();
    expect(s.interaction.respond.mock.calls[0][0]).toHaveLength(25);
    s.interaction.options.getFocused = () => 'キャラ39';
    await s.autocomplete();
    expect(s.interaction.respond).toHaveBeenLastCalledWith([{ name: 'キャラ39', value: '39' }]);
  });
  it('確認前は書き込まず規約とクレジットを非公開表示する', async () => {
    const s = setup();
    await s.run();
    expect(s.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(s.interaction.editReply.mock.calls[0][0].content).toContain('VOICEVOX:追加キャラ');
    expect(s.interaction.editReply.mock.calls[0][0].content).toContain('https://example.com/terms');
    expect(s.store.enabledSpeakers('g')).toEqual([]);
    expect(s.createMessageComponentCollector).toHaveBeenCalledWith(
      expect.objectContaining({ time: 60000 }),
    );
  });
  it('他ユーザーは操作できず、実行者の確定で全スタイルを順にロードしDBと公開通知を更新する', async () => {
    const s = setup();
    await s.run();
    const other = await s.press('install', 'other');
    expect(other.reply).toHaveBeenCalled();
    expect(s.store.enabledSpeakers('g')).toEqual([]);
    await s.press();
    expect(s.engine.initializeSpeaker).toHaveBeenNthCalledWith(1, 90, { skipReinit: true });
    expect(s.engine.initializeSpeaker).toHaveBeenNthCalledWith(2, 91, { skipReinit: true });
    expect(s.store.speakerInstalls('g')).toEqual([
      { speakerUuid: 'extra', installedBy: 'admin', installedAt: expect.any(String) },
    ]);
    expect(s.interaction.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          '追加キャラ をインストールしました（VOICEVOX:追加キャラ）。/voice set で選択できます',
      }),
    );
    expect(await s.context.catalog.search('g', '追加')).toHaveLength(2);
    await s.press();
    expect(s.engine.initializeSpeaker).toHaveBeenCalledTimes(2);
  });
  it('最初のスタイルの初期化完了を待ってから次のスタイルを初期化する', async () => {
    const s = setup();
    let release!: () => void;
    vi.mocked(s.engine.initializeSpeaker).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await s.run();
    await s.press();
    expect(s.engine.initializeSpeaker).toHaveBeenCalledTimes(1);
    expect(s.store.enabledSpeakers('g')).toEqual([]);
    release();
    await flush();
    expect(s.engine.initializeSpeaker).toHaveBeenCalledTimes(2);
    expect(s.store.enabledSpeakers('g')).toEqual(['extra']);
  });
  it('期限切れ後の確定は書き込まない', async () => {
    const s = setup();
    await s.run();
    s.collector.emit('end');
    await s.press();
    expect(s.store.enabledSpeakers('g')).toEqual([]);
    expect(s.engine.initializeSpeaker).not.toHaveBeenCalled();
  });
  it('部分初期化失敗を記録し、導入して管理者に報告する', async () => {
    const s = setup();
    vi.mocked(s.engine.initializeSpeaker).mockRejectedValueOnce(new Error('init'));
    await s.run();
    await s.press();
    expect(s.store.enabledSpeakers('g')).toEqual(['extra']);
    expect(s.interaction.editReply.mock.calls.at(-1)![0].content).toContain('ID: 90');
  });
  it('公開通知の失敗は保存を取り消さず管理者へ報告する', async () => {
    const s = setup();
    s.interaction.channel.send.mockRejectedValue(new Error('denied'));
    await s.run();
    await s.press();
    expect(s.store.enabledSpeakers('g')).toEqual(['extra']);
    expect(s.interaction.editReply.mock.calls.at(-1)![0].content).toContain(
      '公開通知を送信できません',
    );
  });
  it.each(['cancel', 'timeout', 'permission'])('%s で導入せずボタンを無効化する', async (kind) => {
    const s = setup();
    await s.run();
    if (kind === 'timeout') s.collector.emit('end');
    else await s.press(kind === 'cancel' ? 'cancel' : 'install', 'admin', kind !== 'permission');
    await flush();
    expect(s.store.enabledSpeakers('g')).toEqual([]);
    const reply = s.interaction.editReply.mock.calls.at(-1)![0];
    expect(reply.content).toContain(
      kind === 'cancel' ? 'キャンセル' : kind === 'timeout' ? 'タイムアウト' : '権限',
    );
    expect(
      reply.components[0].toJSON().components.every((b: { disabled: boolean }) => b.disabled),
    ).toBe(true);
  });
  it('非対応エンジンへのライブラリ指定を案内する', async () => {
    const s = setup('install', 'lib:lib-uuid');
    await s.run();
    expect(s.interaction.editReply).toHaveBeenCalledWith(
      'このエンジンは音声ライブラリの追加に対応していません。エンジンを更新してください',
    );
  });
  it('対応エンジンでは未導入ライブラリを候補に追加し、確認後ZIPを渡して新規キャラを有効化する', async () => {
    const s = setup('install', 'lib:lib-uuid');
    vi.mocked(s.engine.engineManifest).mockResolvedValue({
      name: 'E',
      brand_name: 'V',
      supported_features: { manage_library: true },
    });
    await s.autocomplete();
    expect(s.interaction.respond.mock.calls[0][0]).toContainEqual({
      name: '音声ライブラリ: 追加ライブラリ',
      value: 'lib:lib-uuid',
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('zip'));
    vi.stubGlobal('fetch', fetch);
    await s.run();
    await s.press();
    expect(s.engine.installLibrary).toHaveBeenCalledWith('lib-uuid', expect.any(Blob));
    expect(s.engine.refreshSpeakers).toHaveBeenCalled();
    expect(s.store.enabledSpeakers('g')).toEqual(['new']);
    vi.mocked(s.engine.installedLibraries).mockResolvedValue({
      [library.uuid]: { ...library, uninstallable: true },
    });
    await s.autocomplete();
    expect(
      s.interaction.respond.mock.calls
        .at(-1)![0]
        .some((c: { value: string }) => c.value.startsWith('lib:')),
    ).toBe(false);
  });
  it('ZIPのサイズ超過は捕捉しライブラリもDBも変更しない', async () => {
    const s = setup('install', 'lib:lib-uuid');
    vi.mocked(s.engine.engineManifest).mockResolvedValue({
      name: 'E',
      brand_name: 'V',
      supported_features: { manage_library: true },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('zip', { headers: { 'content-length': String(256 * 1024 * 1024 + 1) } }),
        ),
    );
    await s.run();
    await s.press();
    expect(s.engine.installLibrary).not.toHaveBeenCalled();
    expect(s.store.enabledSpeakers('g')).toEqual([]);
    expect(s.interaction.editReply.mock.calls.at(-1)![0].content).toContain('インストールに失敗');
    expect(s.context.logger.warn).toHaveBeenCalled();
  });
  it('規約メタデータがないライブラリは配布元での確認を案内する', async () => {
    const s = setup('install', 'lib:lib-uuid');
    vi.mocked(s.engine.engineManifest).mockResolvedValue({
      name: 'E',
      brand_name: 'V',
      supported_features: { manage_library: true },
    });
    const { policy: _policy, ...withoutPolicy } = library;
    void _policy;
    vi.mocked(s.engine.downloadableLibraries).mockResolvedValue([withoutPolicy]);
    await s.run();
    expect(s.createMessageComponentCollector).toHaveBeenCalled();
    expect(s.interaction.editReply.mock.calls[0][0].content).toContain('配布元の利用規約');
    expect(s.interaction.editReply.mock.calls[0][0].content).toContain(library.download_url);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('zip')));
    await s.press();
    expect(s.engine.installLibrary).toHaveBeenCalled();
  });
  it('uninstall は標準キャラを拒否する', async () => {
    const s = setup('uninstall', builtin.speaker_uuid);
    await s.run();
    expect(s.interaction.editReply).toHaveBeenCalledWith('標準キャラはアンインストールできません');
  });
  it('uninstall 候補はギルド導入分だけで、削除直後に保存話者がフォールバックする', async () => {
    const s = setup('uninstall');
    s.store.enableSpeaker('g', 'extra', 'admin');
    s.store.setUser('g', 'u', { styleId: 90, speed: 1.2, pitch: 0 });
    expect((await s.context.resolveVoice('g', 'u')).styleId).toBe(90);
    await s.autocomplete();
    expect(s.interaction.respond).toHaveBeenCalledWith([{ name: '追加キャラ', value: 'extra' }]);
    await s.run();
    expect(s.interaction.editReply.mock.calls.at(-1)![0]).toContain('1 人');
    expect(s.store.enabledSpeakers('g')).toEqual([]);
    expect((await s.context.resolveVoice('g', 'u')).styleId).toBe(2);
    expect(await s.context.catalog.search('g', '追加')).toEqual([]);
    expect(s.interaction.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: '追加キャラ をアンインストールしました' }),
    );
  });
  it('list は標準・導入者・日時・追加可能数をembedで表示する', async () => {
    const s = setup('list');
    s.store.enableSpeaker('g', 'extra', 'admin');
    await s.run();
    const embed = s.interaction.editReply.mock.calls[0][0].embeds[0].toJSON();
    expect(embed.description).toContain('四国めたん');
    expect(embed.description).toContain('<@admin>');
    expect(embed.description).toContain('UTC');
    expect(embed.description).toContain('追加可能: 0');
  });
});
describe('/credits', () => {
  it('選択可能なキャラをスタイル間で重複させず公開表示する', async () => {
    const s = setup();
    s.store.enableSpeaker('g', 'extra', 'admin');
    await s.credits();
    expect(s.interaction.deferReply).toHaveBeenCalledWith();
    const text = s.interaction.editReply.mock.calls[0][0].embeds[0].toJSON().description;
    expect(text).toContain('VOICEVOX\nhttps://voicevox.hiroshiba.jp/');
    expect(text).toContain('VOICEVOX:四国めたん');
    expect(text.match(/VOICEVOX:追加キャラ/g)).toHaveLength(1);
    expect(text).toContain('https://example.com/terms');
  });
  it('policy 取得失敗ならURLを省略する', async () => {
    const s = setup();
    vi.mocked(s.engine.speakerInfo).mockRejectedValue(new Error('not found'));
    await s.credits();
    expect(s.interaction.editReply.mock.calls[0][0].embeds[0].toJSON().description).toContain(
      'VOICEVOX:四国めたん',
    );
  });
  it('エンジン停止を案内する', async () => {
    const s = setup();
    vi.mocked(s.engine.speakers).mockRejectedValue(new Error('down'));
    await s.credits();
    expect(s.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('VOICEVOX ENGINE に接続できません'),
    );
  });
  it('複数ページを公開followUpへ送り、極端に長い行も上限内にする', async () => {
    const s = setup();
    vi.mocked(s.engine.styles).mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({
        styleId: i,
        speakerUuid: builtin.speaker_uuid,
        speakerName: '四国めたん',
        styleName: String(i),
      })),
    );
    vi.mocked(s.engine.speakerInfo).mockResolvedValue({
      policy: `https://example.com/${'a'.repeat(8000)}`,
    });
    await s.credits();
    expect(s.interaction.followUp).toHaveBeenCalled();
    for (const [message] of [
      ...s.interaction.editReply.mock.calls,
      ...s.interaction.followUp.mock.calls,
    ]) {
      expect(message.embeds[0].toJSON().description!.length).toBeLessThanOrEqual(3800);
      expect(message.flags).toBeUndefined();
    }
  });
  it('カタログがキャッシュ済みでもエンジン停止を検出する', async () => {
    const s = setup();
    await s.context.catalog.list('g');
    vi.mocked(s.engine.version).mockRejectedValue(new Error('down'));
    await s.credits();
    expect(s.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('VOICEVOX ENGINE に接続できません'),
    );
  });
  it('長い一覧をメッセージごとのembedへ分割する', () => {
    const pages = creditEmbeds(
      Array.from(
        { length: 200 },
        (_, i) => `VOICEVOX:キャラ${i} https://example.com/${'a'.repeat(100)}`,
      ),
    );
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page.toJSON().description!.length).toBeLessThanOrEqual(3800);
  });
});
describe('ZIP のダウンロード', () => {
  it.each([true, false])('Content-Length の有無によらず上限を守る (%s)', async (header) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response('oversized', { headers: header ? { 'content-length': '9' } : {} }),
      );
    await expect(downloadLibrary(library.download_url, fetch, 3)).rejects.toThrow('サイズ上限');
    expect(fetch.mock.calls[0][1]!.signal).toBeInstanceOf(AbortSignal);
  });
  it('HTTP エラーとタイムアウトを伝播する', async () => {
    await expect(
      downloadLibrary(
        library.download_url,
        vi.fn().mockResolvedValue(new Response('', { status: 500 })),
      ),
    ).rejects.toThrow();
    await expect(
      downloadLibrary(
        library.download_url,
        vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')),
      ),
    ).rejects.toThrow('timeout');
  });
});
