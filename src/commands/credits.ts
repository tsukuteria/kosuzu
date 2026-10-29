import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';
import { termsUrl } from '../tts/policy.js';

export function creditEmbeds(lines: string[]): EmbedBuilder[] {
  const pages = [
    'VOICEVOX\nhttps://voicevox.hiroshiba.jp/\n各キャラクターの利用規約が適用されます。',
  ];
  for (const line of lines.flatMap((line) => line.match(/[\s\S]{1,3799}/g) ?? [''])) {
    if (pages[pages.length - 1].length + line.length + 1 > 3800) pages.push('');
    pages[pages.length - 1] += `\n${line}`;
  }
  return pages.map((page) => new EmbedBuilder().setTitle('クレジット').setDescription(page));
}

export const credits: Command = {
  data: new SlashCommandBuilder()
    .setName('credits')
    .setDescription('利用可能なキャラのクレジットと規約を表示します'),
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'サーバー内で実行してください',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply();
    try {
      await context.engine.version();
      const styles = await context.catalog.list(interaction.guildId);
      const characters = new Map(styles.map((style) => [style.speakerUuid, style.speakerName]));
      const lines: string[] = [];
      for (const [uuid, name] of characters) {
        let url: string | undefined;
        try {
          url = termsUrl((await context.engine.speakerInfo(uuid)).policy);
        } catch (error) {
          context.logger.warn({ err: error, uuid }, 'キャラの規約を取得できませんでした');
        }
        lines.push(`VOICEVOX:${name}${url ? ` — ${url}` : ''}`);
      }
      const embeds = creditEmbeds(lines);
      await interaction.editReply({ embeds: [embeds[0]], allowedMentions: { parse: [] } });
      for (const embed of embeds.slice(1))
        await interaction.followUp({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (error) {
      context.logger.warn({ err: error }, 'クレジットの取得に失敗しました');
      await interaction.editReply(
        'VOICEVOX ENGINE に接続できません。起動状態を確認してから再実行してください',
      );
    }
  },
};
