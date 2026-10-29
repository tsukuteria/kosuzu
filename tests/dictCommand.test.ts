import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { dict } from '../src/commands/dict.js';
import { openDatabase } from '../src/store/database.js';
import { SqliteSettings } from '../src/store/settings.js';
import type { CommandContext } from '../src/commands/types.js';

let db: ReturnType<typeof openDatabase>;
let store: SqliteSettings;
beforeEach(() => {
  db = openDatabase(':memory:');
  store = new SqliteSettings(db);
});
afterEach(() => db.close());
function setup(sub: string) {
  const interaction = {
    guildId: 'g',
    user: { id: 'u' },
    memberPermissions: { has: vi.fn(() => false) },
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => (name === 'surface' ? '@everyone' : '読み'),
      getFocused: () => '@',
    },
    reply: vi.fn(),
    followUp: vi.fn(),
    respond: vi.fn(),
  };
  const context = { store } as unknown as CommandContext;
  return {
    interaction,
    context,
    run: () => dict.execute(interaction as unknown as ChatInputCommandInteraction, context),
  };
}
it('全員が登録・上書きでき公開返信ではメンションしない', async () => {
  const s = setup('add');
  await s.run();
  expect(s.interaction.reply).toHaveBeenLastCalledWith({
    content: '辞書に登録しました：@everyone → 読み',
    allowedMentions: { parse: [] },
  });
  await s.run();
  expect(s.interaction.reply).toHaveBeenLastCalledWith(
    expect.objectContaining({ content: expect.stringContaining('上書きしました') }),
  );
  await dict.autocomplete!(s.interaction as unknown as AutocompleteInteraction, s.context);
  expect(s.interaction.respond).toHaveBeenCalledWith([{ name: '@everyone', value: '@everyone' }]);
});
it('管理者限定では更新を拒否し一覧は許す', async () => {
  store.setGuildOption('g', 'dict_permission', 'admin');
  const s = setup('remove');
  await s.run();
  expect(s.interaction.reply).toHaveBeenCalledWith(
    expect.objectContaining({ flags: MessageFlags.Ephemeral }),
  );
  const list = setup('list');
  await list.run();
  expect(list.interaction.reply).toHaveBeenCalledWith(
    expect.objectContaining({ flags: MessageFlags.Ephemeral, embeds: expect.any(Array) }),
  );
  s.interaction.memberPermissions.has.mockReturnValue(true);
  store.putDictionary('g', '@everyone', '読み', 'u');
  await s.run();
  expect(s.interaction.reply).toHaveBeenLastCalledWith({
    content: '辞書から削除しました：@everyone',
    allowedMentions: { parse: [] },
  });
});
