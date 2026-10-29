import { VoicevoxClient } from '../src/tts/voicevox.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { voice, voiceListEmbeds } from '../src/commands/voice.js';
import type { CommandContext } from '../src/commands/types.js';
import { openDatabase } from '../src/store/database.js';
import { SqliteSettings } from '../src/store/settings.js';
import { SpeakerCatalog, MAIN_SPEAKER_UUIDS } from '../src/tts/speakers.js';
import { createVoiceResolver } from '../src/voice/resolver.js';
import { skip } from '../src/commands/skip.js';
import { leave } from '../src/commands/leave.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function setup(sub = 'set', value: string | number = '3') {
  const db = openDatabase(':memory:');
  databases.push(db);
  const store = new SqliteSettings(db);
  const catalog = new SpeakerCatalog(
    {
      styles: async () => [
        {
          styleId: 3,
          speakerName: 'ずんだもん',
          styleName: 'ノーマル',
          speakerUuid: MAIN_SPEAKER_UUIDS[1],
        },
      ],
    },
    store,
  );
  const context: CommandContext = {
    engine: new VoicevoxClient({ baseUrl: 'http://unused' }),
    logger: { warn: vi.fn() },
    store,
    catalog,
    resolveVoice: createVoiceResolver(store, catalog, 3, { debug: vi.fn() }),
    sessions: { join: vi.fn(), get: vi.fn(), leave: vi.fn() },
  };
  const interaction = {
    guildId: 'g',
    user: { id: 'u' },
    options: {
      getSubcommand: () => sub,
      getString: () => String(value),
      getNumber: () => Number(value),
    },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    followUp: vi.fn(),
  };
  return {
    store,
    context,
    interaction,
    run: () => voice.execute(interaction as unknown as ChatInputCommandInteraction, context),
  };
}
describe('/voice', () => {
  it('利用可能な話者を保存して非公開で確認する', async () => {
    const s = setup();
    await s.run();
    expect(s.store.user('g', 'u')?.styleId).toBe(3);
    expect(s.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(s.interaction.editReply).toHaveBeenCalledWith(
      '話者を ずんだもん（ノーマル） に設定しました',
    );
  });
  it.each(['999', 'abc', '', '-1', '3.5'])(
    '不正・選択不可の話者 %s を保存しない',
    async (value) => {
      const s = setup('set', value);
      await s.run();
      expect(s.store.user('g', 'u')).toBeUndefined();
      expect(s.interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('利用できません'),
      );
    },
  );
  it.each(['speed', 'pitch'])('%s のみを保存して既定話者に追従する', async (sub) => {
    const value = sub === 'speed' ? 1.2 : -0.1;
    const s = setup(sub, value);
    await s.run();
    expect(s.store.user('g', 'u')).toMatchObject({ styleId: null, [sub]: value });
    expect(s.interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });
  it.each([
    ['speed', 2.1],
    ['pitch', 0.2],
    ['speed', NaN],
  ] as const)('範囲外の %s を拒否する', async (sub, value) => {
    const s = setup(sub, value);
    await s.run();
    expect(s.store.user('g', 'u')).toBeUndefined();
  });
  it('show は既定の話者・速度・ピッチを示す', async () => {
    const s = setup('show');
    await s.run();
    expect(s.interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/ずんだもん.*グローバル既定.*\n話速: 1\nピッチ: 0/),
    );
  });
  it('reset はユーザー行を削除する', async () => {
    const s = setup('reset');
    s.store.setUser('g', 'u', { styleId: 3, speed: 2, pitch: 0 });
    await s.run();
    expect(s.store.user('g', 'u')).toBeUndefined();
  });
  it('list は非公開 embed とクレジットを表示する', async () => {
    const s = setup('list');
    await s.run();
    expect(s.interaction.editReply.mock.calls[0][0].embeds[0].toJSON()).toMatchObject({
      description: 'ずんだもん（ノーマル）',
      footer: { text: expect.stringContaining('VOICEVOX:キャラ名') },
    });
  });
  it('長い一覧を Discord のメッセージ文字数制限内に分割する', () => {
    const embeds = voiceListEmbeds(Array(500).fill('あ'.repeat(100)));
    expect(embeds.length).toBeGreaterThan(1);
    for (const embed of embeds)
      expect(embed.toJSON().description!.length).toBeLessThanOrEqual(3800);
  });
});
describe('公開返信', () => {
  it.each([skip, leave])('/$data.name は実行結果を公開する', async (command) => {
    const s = setup();
    await command.execute(s.interaction as unknown as ChatInputCommandInteraction, s.context);
    expect(s.interaction.reply.mock.calls[0][0].flags).toBeUndefined();
  });
});
