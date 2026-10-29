import { MessageFlags, type Interaction } from 'discord.js';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { Command, CommandContext } from '../src/commands/types.js';
import { handleInteraction } from '../src/events/interactionCreate.js';

function setup(execute = vi.fn().mockResolvedValue(undefined)) {
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'ping',
    replied: false,
    deferred: false,
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
  const command: Command = { data: { name: 'ping', toJSON: () => ({}) }, execute };
  const logger = { error: vi.fn() };
  const context: CommandContext = {
    sessions: { join: vi.fn(), leave: vi.fn(), get: vi.fn() },
    resolveStyle: () => 3,
  };
  return {
    interaction,
    command,
    logger,
    context,
    run: () =>
      handleInteraction(
        interaction as unknown as Interaction,
        [command],
        logger as unknown as Logger,
        context,
      ),
  };
}

describe('handleInteraction', () => {
  it('未知のコマンドを無視する', async () => {
    const context = setup();
    context.interaction.commandName = 'unknown';
    await context.run();
    expect(context.command.execute).not.toHaveBeenCalled();
    expect(context.interaction.reply).not.toHaveBeenCalled();
  });
  it('コマンドを実行する', async () => {
    const context = setup();
    await context.run();
    expect(context.command.execute).toHaveBeenCalledWith(context.interaction, context.context);
  });
  it('失敗を記録して非公開で返信する', async () => {
    const context = setup(vi.fn().mockRejectedValue(new Error('failure')));
    await context.run();
    expect(context.logger.error).toHaveBeenCalled();
    expect(context.interaction.reply).toHaveBeenCalledWith({
      content: 'コマンドの実行中にエラーが発生しました。',
      flags: MessageFlags.Ephemeral,
    });
  });
  it('応答済みの場合は追加で返信する', async () => {
    const context = setup(vi.fn().mockRejectedValue(new Error('failure')));
    context.interaction.deferred = true;
    await context.run();
    expect(context.interaction.followUp).toHaveBeenCalled();
  });
});
