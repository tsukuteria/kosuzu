import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { config } from '../src/commands/config.js';
import type { CommandContext } from '../src/commands/types.js';
import { openDatabase } from '../src/store/database.js';
import { SqliteSettings } from '../src/store/settings.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function setup(sub = 'show', value = '3') {
  const db = openDatabase(':memory:');
  databases.push(db);
  const store = new SqliteSettings(db);
  const style = {
    styleId: 3,
    speakerName: 'ずんだもん',
    styleName: 'ノーマル',
    speakerUuid: 'uuid',
  };
  const context: CommandContext = {
    store,
    sessions: { join: vi.fn(), leave: vi.fn(), get: vi.fn() },
    catalog: {
      list: vi.fn(),
      find: vi.fn(async (_id, n) => (n === 3 ? style : undefined)),
      search: vi.fn(async () => [{ name: 'ずんだもん', value: '3' }]),
    },
    resolveVoice: vi.fn(),
  };
  const interaction = {
    guildId: 'g' as string | null,
    memberPermissions: { has: vi.fn((): boolean => true) },
    options: {
      getSubcommand: () => sub,
      getBoolean: () => false,
      getString: () => value,
      getChannel: () => ({ id: 'vc', type: ChannelType.GuildVoice }),
      getFocused: () => 'ずんだ',
    },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    followUp: vi.fn(),
    respond: vi.fn(),
  };
  return {
    store,
    context,
    interaction,
    run: () => config.execute(interaction as unknown as ChatInputCommandInteraction, context),
  };
}
describe('/config', () => {
  it('登録時に ManageGuild を要求する', () => {
    expect(config.data.toJSON()).toMatchObject({
      default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    });
  });
  it.each(['autojoin', 'exclude', 'include', 'default-voice', 'default-voice-reset', 'show'])(
    '%s は実行時にも管理権限を確認する',
    async (sub) => {
      const s = setup(sub);
      s.interaction.memberPermissions.has.mockReturnValue(false);
      await s.run();
      expect(s.store.guild('g')).toBeUndefined();
      expect(s.interaction.reply).toHaveBeenCalledWith({
        content: '「サーバー管理」権限が必要です',
        flags: MessageFlags.Ephemeral,
      });
      expect(s.context.catalog.find).not.toHaveBeenCalled();
    },
  );
  it('サーバー外は拒否する', async () => {
    const s = setup();
    s.interaction.guildId = null;
    await s.run();
    expect(s.interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'サーバー内で実行してください' }),
    );
  });
  it('autojoin を保存する', async () => {
    const s = setup('autojoin');
    await s.run();
    expect(s.store.guild('g')?.autojoin).toBe(false);
  });
  it('exclude/include は重複せず除外を追加・解除する', async () => {
    const s = setup('exclude');
    await s.run();
    await s.run();
    expect(s.store.guild('g')?.excludedVoiceChannels).toEqual(['vc']);
    s.interaction.options.getSubcommand = () => 'include';
    await s.run();
    expect(s.store.guild('g')?.excludedVoiceChannels).toEqual([]);
  });
  it('default-voice と reset は他の設定を保つ', async () => {
    const s = setup('default-voice');
    s.store.setLastTextChannel('g', 'text');
    await s.run();
    expect(s.store.guild('g')?.defaultStyleId).toBe(3);
    s.interaction.options.getSubcommand = () => 'default-voice-reset';
    await s.run();
    expect(s.store.guild('g')).toMatchObject({ defaultStyleId: null, lastTextChannelId: 'text' });
  });
  it.each(['abc', '-1', '999', '3.5'])('不正な話者 %s を保存しない', async (value) => {
    const s = setup('default-voice', value);
    await s.run();
    expect(s.store.guild('g')).toBeUndefined();
  });
  it('show は自動参加・除外・最後の join・サーバー話者を表示する', async () => {
    const s = setup();
    s.store.setDefaultStyle('g', 3);
    s.store.setLastTextChannel('g', 'text');
    s.store.setVoiceChannelExcluded('g', 'vc', true);
    await s.run();
    expect(s.interaction.editReply).toHaveBeenCalledWith(
      '自動参加: 有効\n除外 VC: <#vc>\n最後の /join: <#text>\nサーバー既定話者: ずんだもん（ノーマル）',
    );
  });
  it('候補は既存カタログ検索を再利用し、管理権限を確認する', async () => {
    const s = setup();
    await config.autocomplete!(s.interaction as unknown as AutocompleteInteraction, s.context);
    expect(s.context.catalog.search).toHaveBeenCalledWith('g', 'ずんだ');
    s.interaction.memberPermissions.has.mockReturnValue(false);
    await config.autocomplete!(s.interaction as unknown as AutocompleteInteraction, s.context);
    expect(s.interaction.respond).toHaveBeenLastCalledWith([]);
  });
});
