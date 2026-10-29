import { VoicevoxClient } from '../src/tts/voicevox.js';
import { openDatabase } from '../src/store/database.js';
import { SqliteSettings } from '../src/store/settings.js';
import { SpeakerCatalog } from '../src/tts/speakers.js';
import { MessageFlags, type Interaction } from 'discord.js';
import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, CommandContext } from '../src/commands/types.js';
import { handleInteraction } from '../src/events/interactionCreate.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function createStore() {
  const db = openDatabase(':memory:');
  databases.push(db);
  return new SqliteSettings(db);
}

function setup(execute = vi.fn().mockResolvedValue(undefined)) {
  const interaction = {
    isChatInputCommand: (): boolean => true,
    isAutocomplete: (): boolean => false,
    responded: false,
    respond: vi.fn().mockResolvedValue(undefined),
    commandName: 'ping',
    replied: false,
    deferred: false,
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
  const command: Command = { data: { name: 'ping', toJSON: () => ({}) }, execute };
  const logger = { error: vi.fn() };
  const context: CommandContext = {
    engine: new VoicevoxClient({ baseUrl: 'http://unused' }),
    logger: { warn: vi.fn() },
    sessions: { join: vi.fn(), leave: vi.fn(), get: vi.fn() },
    store: createStore(),
    catalog: new SpeakerCatalog({ styles: async () => [] }, { enabledSpeakers: () => [] }),
    resolveVoice: async () => ({ styleId: 3, speedScale: 1, pitchScale: 0 }),
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
  it.each([true, false])(
    '候補に context を渡し、失敗なら空候補を返信する (%s)',
    async (success) => {
      const s = setup();
      s.interaction.isChatInputCommand = () => false;
      s.interaction.isAutocomplete = () => true;
      s.command.autocomplete = vi.fn().mockImplementation(async () => {
        if (!success) throw new Error('engine');
      });
      await s.run();
      expect(s.command.autocomplete).toHaveBeenCalledWith(s.interaction, s.context);
      if (!success) expect(s.interaction.respond).toHaveBeenCalledWith([]);
    },
  );
});
