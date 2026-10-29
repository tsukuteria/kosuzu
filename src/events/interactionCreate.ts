import { MessageFlags, type Interaction } from 'discord.js';
import type { Logger } from 'pino';
import type { Command, CommandContext } from '../commands/types.js';

export async function handleInteraction(
  interaction: Interaction,
  commands: readonly Command[],
  logger: Logger,
  context: CommandContext,
): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commands.find((item) => item.data.name === interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction, context);
      } catch (error) {
        logger.error(
          { err: error, command: interaction.commandName },
          'コマンドの実行に失敗しました',
        );
        const message = {
          content: 'コマンドの実行中にエラーが発生しました。',
          flags: MessageFlags.Ephemeral as const,
        };
        if (interaction.replied || interaction.deferred) await interaction.followUp(message);
        else await interaction.reply(message);
      }
    } else if (interaction.isAutocomplete()) {
      const command = commands.find((item) => item.data.name === interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction);
    }
  } catch (error) {
    logger.error({ err: error }, 'インタラクションの処理に失敗しました');
  }
}
