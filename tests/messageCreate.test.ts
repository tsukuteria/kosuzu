import { Collection, type Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../src/commands/types.js';
import { handleMessage } from '../src/events/messageCreate.js';
import type { GuildVoiceSession } from '../src/voice/session.js';

function setup() {
  const enqueue = vi.fn();
  const session = { textChannelId: 'text', enqueue } as unknown as GuildVoiceSession;
  const get = vi.fn((): GuildVoiceSession | undefined => session);
  const context: CommandContext = {
    sessions: { get, join: vi.fn(), leave: vi.fn() },
    resolveStyle: vi.fn(() => 8),
  };
  const logger = { error: vi.fn() };
  const message = {
    guildId: 'guild',
    channelId: 'text',
    author: { id: 'user', bot: false },
    system: false,
    content: 'こんにちは',
    attachments: new Collection(),
    mentions: {
      members: new Collection([['1', { displayName: '名前' }]]),
      users: new Collection(),
      roles: new Collection(),
      channels: new Collection(),
    },
  };
  const options = { readSkipPrefix: ';', readMaxLength: 100 };
  const run = () => handleMessage(message as unknown as Message, context, options, logger);
  return { message, options, run, enqueue, context, get, logger };
}
describe('handleMessage', () => {
  it('対象チャンネルの本文を正規化して話者を解決する', () => {
    const s = setup();
    s.message.content = '<@1> www';
    s.run();
    expect(s.enqueue).toHaveBeenCalledWith({ text: '名前 わらわら', styleId: 8 });
    expect(s.context.resolveStyle).toHaveBeenCalledWith('guild', 'user');
  });
  it.each(['bot', 'system', 'channel', 'guild', 'session', 'prefix', 'empty'])(
    '%s を無視する',
    (kind) => {
      const s = setup();
      if (kind === 'bot') s.message.author.bot = true;
      if (kind === 'system') s.message.system = true;
      if (kind === 'channel') s.message.channelId = 'other';
      if (kind === 'guild') s.message.guildId = '';
      if (kind === 'session') s.get.mockReturnValue(undefined);
      if (kind === 'prefix') s.message.content = ';skip';
      if (kind === 'empty') s.message.content = ' \n ';
      s.run();
      expect(s.enqueue).not.toHaveBeenCalled();
    },
  );
  it('除外接頭辞を変更・無効化できる', () => {
    const s = setup();
    s.options.readSkipPrefix = '!';
    s.message.content = '!skip';
    s.run();
    expect(s.enqueue).not.toHaveBeenCalled();
    s.options.readSkipPrefix = '';
    s.run();
    expect(s.enqueue).toHaveBeenCalled();
  });
  it('例外を捕捉する', () => {
    const s = setup();
    s.enqueue.mockImplementation(() => {
      throw new Error('failure');
    });
    expect(s.run).not.toThrow();
    expect(s.logger.error).toHaveBeenCalled();
  });
});
