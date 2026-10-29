import type { Message } from 'discord.js';
import type { Logger } from 'pino';
import type { CommandContext } from '../commands/types.js';
import { normalizeText } from '../tts/normalize.js';
import { applyDictionary } from '../tts/dictionary.js';
import type { GuildVoiceSession } from '../voice/session.js';

const pending = new WeakMap<GuildVoiceSession, Promise<void>>();

export async function handleMessage(
  message: Message,
  context: CommandContext,
  options: { readSkipPrefix: string; readMaxLength: number },
  logger: Pick<Logger, 'error'>,
): Promise<void> {
  try {
    if (!message.guildId || message.author.bot || message.system) return;
    const settings = context.store.guild(message.guildId);
    const skipPrefix = settings?.skipPrefix ?? options.readSkipPrefix;
    const session = context.sessions.get(message.guildId);
    if (
      !session ||
      !session.readsChannel(message.channelId) ||
      (skipPrefix && message.content.startsWith(skipPrefix))
    )
      return;
    const text = normalizeText(message.content, {
      maxLength: settings?.readMaxLength ?? options.readMaxLength,
      transform: (value) => applyDictionary(value, context.store.dictionary(message.guildId!)),
      hasAttachments: message.attachments.size > 0,
      resolve: (kind, id) => {
        if (kind === 'user')
          return (
            message.mentions.members?.get(id)?.displayName ??
            message.guild?.members.cache.get(id)?.displayName ??
            message.mentions.users.get(id)?.displayName
          );
        if (kind === 'role')
          return message.mentions.roles.get(id)?.name ?? message.guild?.roles.cache.get(id)?.name;
        const channel = message.mentions.channels.get(id);
        return (
          (channel && 'name' in channel ? channel.name : undefined) ??
          message.guild?.channels.cache.get(id)?.name
        );
      },
    });
    if (text) {
      const previous = pending.get(session) ?? Promise.resolve();
      const guildId = message.guildId;
      const voiceResult = context.resolveVoice(guildId, message.author.id).then(
        (voice) => ({ voice }),
        (error: unknown) => ({ error }),
      );
      const task = previous
        .catch(() => {})
        .then(async () => {
          const result = await voiceResult;
          if ('error' in result) throw result.error;
          const voice = result.voice;
          const name = normalizeText(
            message.member?.displayName ?? message.author.displayName ?? message.author.id,
            {
              maxLength: 20,
              truncateSuffix: '',
              transform: (value) => applyDictionary(value, context.store.dictionary(guildId)),
            },
          );
          const prefix =
            name && settings?.readName === 'on_change' && session.lastSpeakerId !== message.author.id
              ? `${name}さん、`
              : '';
          if (session.enqueue({ text: prefix + text, ...voice }))
            session.lastSpeakerId = message.author.id;
        });
      pending.set(session, task);
      await task;
    }
  } catch (error) {
    logger.error({ err: error }, 'メッセージの読み上げ処理に失敗しました');
  }
}
