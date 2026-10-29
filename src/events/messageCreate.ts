import type { Message } from 'discord.js';
import type { Logger } from 'pino';
import type { CommandContext } from '../commands/types.js';
import { normalizeText } from '../tts/normalize.js';

export async function handleMessage(
  message: Message,
  context: CommandContext,
  options: { readSkipPrefix: string; readMaxLength: number },
  logger: Pick<Logger, 'error'>,
): Promise<void> {
  try {
    if (!message.guildId || message.author.bot || message.system) return;
    const session = context.sessions.get(message.guildId);
    if (
      !session ||
      !session.readsChannel(message.channelId) ||
      (options.readSkipPrefix && message.content.startsWith(options.readSkipPrefix))
    )
      return;
    const text = normalizeText(message.content, {
      maxLength: options.readMaxLength,
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
    if (text)
      session.enqueue({
        text,
        ...(await context.resolveVoice(message.guildId, message.author.id)),
      });
  } catch (error) {
    logger.error({ err: error }, 'メッセージの読み上げ処理に失敗しました');
  }
}
