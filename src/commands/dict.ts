import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';
import { normalizeSurface } from '../tts/dictionary.js';

export const dict: Command = {
  data: new SlashCommandBuilder()
    .setName('dict')
    .setDescription('サーバー辞書を管理します')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('読みを登録します')
        .addStringOption((o) =>
          o.setName('surface').setDescription('表記').setRequired(true).setMaxLength(50),
        )
        .addStringOption((o) =>
          o.setName('reading').setDescription('読み').setRequired(true).setMaxLength(100),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('登録を削除します')
        .addStringOption((o) =>
          o.setName('surface').setDescription('表記').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('辞書を表示します')),
  async autocomplete(interaction, context) {
    const query = normalizeSurface(interaction.options.getFocused());
    const entries = interaction.guildId ? context.store.dictionary(interaction.guildId) : [];
    await interaction.respond(
      entries
        .filter((e) => e.surface.includes(query))
        .slice(0, 25)
        .map((e) => ({ name: e.surface, value: e.surface })),
    );
  },
  async execute(interaction, context) {
    const id = interaction.guildId;
    if (!id) {
      await interaction.reply({
        content: 'サーバー内で実行してください',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (
      sub !== 'list' &&
      context.store.guild(id)?.dictPermission === 'admin' &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      await interaction.reply({
        content: '「サーバー管理」権限が必要です',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (sub === 'list') {
      const entries = context.store.dictionary(id);
      const pages: string[] = [];
      let page = '';
      for (const entry of entries) {
        const line = `${entry.surface} → ${entry.reading}\n`;
        if (page.length + line.length > 3500) {
          pages.push(page);
          page = '';
        }
        page += line;
      }
      pages.push(page || '登録はありません');
      for (const [i, description] of pages.entries()) {
        const payload = {
          embeds: [
            new EmbedBuilder()
              .setTitle(`辞書 ${entries.length}/500 (${i + 1}/${pages.length})`)
              .setDescription(description),
          ],
          flags: MessageFlags.Ephemeral as const,
          allowedMentions: { parse: [] as never[] },
        };
        if (i === 0) await interaction.reply(payload);
        else await interaction.followUp(payload);
      }
      return;
    }
    const surface = interaction.options.getString('surface', true);
    try {
      let content: string;
      if (sub === 'add') {
        const reading = interaction.options.getString('reading', true);
        const overwritten = context.store.putDictionary(id, surface, reading, interaction.user.id);
        content = `辞書に${overwritten ? '上書きしました' : '登録しました'}：${surface} → ${reading}`;
      } else {
        if (!context.store.removeDictionary(id, surface)) {
          await interaction.reply({
            content: 'その表記は登録されていません',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        content = `辞書から削除しました：${surface}`;
      }
      await interaction.reply({ content, allowedMentions: { parse: [] } });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : '辞書の更新に失敗しました',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }
  },
};
