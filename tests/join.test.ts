import { VoicevoxClient } from '../src/tts/voicevox.js';
import { openDatabase } from '../src/store/database.js';
import { SqliteSettings } from '../src/store/settings.js';
import { SpeakerCatalog } from '../src/tts/speakers.js';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from '../src/commands/join.js';
import type { CommandContext } from '../src/commands/types.js';
import type { GuildVoiceSession } from '../src/voice/session.js';
import { SessionCredits } from '../src/voice/credits.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function createStore() {
  const db = openDatabase(':memory:');
  databases.push(db);
  return new SqliteSettings(db);
}

function setup() {
  const enqueue = vi.fn();
  const credits = new SessionCredits(async () => undefined, { warn: vi.fn() });
  credits.characters = [{ speakerUuid: 'zunda', speakerName: 'ずんだもん' }];
  const session = { enqueue, credits, channelId: 'vc' } as unknown as GuildVoiceSession;
  const connect = vi.fn().mockResolvedValue(session);
  const context: CommandContext = {
    engine: new VoicevoxClient({ baseUrl: 'http://unused' }),
    logger: { warn: vi.fn() },
    sessions: { join: connect, get: vi.fn(), leave: vi.fn() },
    store: createStore(),
    catalog: new SpeakerCatalog({ styles: async () => [] }, { enabledSpeakers: () => [] }),
    resolveVoice: async () => ({ styleId: 3, speedScale: 1, pitchScale: 0 }),
  };
  const channel = {
    id: 'vc',
    name: '雑談',
    permissionsFor: vi.fn(() => ({ has: (): boolean => true })),
  };
  const send = vi.fn().mockResolvedValue(undefined);
  const interaction = {
    inCachedGuild: () => true,
    guildId: 'guild',
    channelId: 'text',
    user: { id: 'user' },
    guild: {
      members: { me: {} },
      channels: { fetch: async () => ({ isSendable: () => true, send }) },
    },
    member: { voice: { channel: channel as typeof channel | null } },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
  return {
    interaction,
    channel,
    connect,
    enqueue,
    context,
    session,
    credits,
    send,
    run: () => join.execute(interaction as unknown as ChatInputCommandInteraction, context),
  };
}
describe('/join', () => {
  it('VC 未参加は非公開で案内する', async () => {
    const s = setup();
    s.interaction.member.voice.channel = null;
    await s.run();
    expect(s.interaction.reply).toHaveBeenCalledWith({
      content: '先にボイスチャンネルに参加してください',
      flags: MessageFlags.Ephemeral,
    });
    expect(s.connect).not.toHaveBeenCalled();
  });
  it('権限不足なら接続しない', async () => {
    const s = setup();
    s.channel.permissionsFor.mockReturnValue({ has: () => false });
    await s.run();
    expect(s.interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('権限'),
        flags: MessageFlags.Ephemeral,
      }),
    );
    expect(s.connect).not.toHaveBeenCalled();
  });
  it('接続前に defer し、成功後にアナウンスをキューへ入れる', async () => {
    const s = setup();
    await s.run();
    expect(s.interaction.deferReply).toHaveBeenCalledWith();
    expect(s.context.store.guild('guild')?.lastTextChannelId).toBe('text');
    expect(s.interaction.deferReply.mock.invocationCallOrder[0]).toBeLessThan(
      s.connect.mock.invocationCallOrder[0],
    );
    expect(s.connect).toHaveBeenCalledWith(s.channel, 'text');
    expect(s.enqueue).toHaveBeenCalledWith({
      text: '接続しました',
      styleId: 3,
      speedScale: 1,
      pitchScale: 0,
    });
    expect(s.interaction.editReply).toHaveBeenCalledWith(
      '雑談 に接続しました。このチャンネルを読み上げます\n現在設定されているキャラクター：VOICEVOX:ずんだもん',
    );
  });
  it('同じ VC の対象更新では一覧と送信先を保ち、追加利用は新規投稿する', async () => {
    const s = setup();
    await s.run();
    vi.mocked(s.context.sessions.get).mockReturnValue(s.session);
    s.interaction.channelId = 'next';
    await s.run();
    expect(s.interaction.editReply).toHaveBeenLastCalledWith(
      '雑談 に接続しました。このチャンネルを読み上げます',
    );
    expect(s.credits.announceChannelId).toBe('text');
    s.credits.use({ styleId: 8, character: { speakerUuid: 'metan', speakerName: '四国めたん' } });
    await Promise.resolve();
    expect(s.send).toHaveBeenCalledWith('VOICEVOX:四国めたん を追加で使用します');
  });
  it('接続失敗は defer した返信にエラーを表示する', async () => {
    const s = setup();
    s.connect.mockRejectedValue(new Error('timeout'));
    await s.run();
    expect(s.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('接続できませんでした'),
    );
    expect(s.enqueue).not.toHaveBeenCalled();
  });
  it('サーバー外で実行できない', async () => {
    const s = setup();
    s.interaction.inCachedGuild = () => false;
    await s.run();
    expect(s.connect).not.toHaveBeenCalled();
    expect(s.interaction.reply).toHaveBeenCalled();
  });
  it('ENGINE 停止で話者解決が失敗しても接続結果は公開で表示済み', async () => {
    const s = setup();
    s.context.resolveVoice = async () => {
      throw new Error('engine');
    };
    await expect(s.run()).rejects.toThrow('engine');
    expect(s.interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('に接続しました'));
    expect(s.interaction.deferReply).toHaveBeenCalledWith();
  });
});
