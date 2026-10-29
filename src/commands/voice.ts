import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';
import { styleLabel } from '../tts/speakers.js';

export function voiceListEmbeds(labels: string[]): EmbedBuilder[] {
  const pages: string[] = [];
  for (const label of labels) {
    const line = label.slice(0, 1000);
    if (!pages.length || pages[pages.length - 1].length + line.length + 1 > 3800) pages.push(line);
    else pages[pages.length - 1] += `\n${line}`;
  }
  return (pages.length ? pages : ['利用可能な話者がありません']).map((description) =>
    new EmbedBuilder()
      .setTitle('利用可能な話者')
      .setDescription(description)
      .setFooter({ text: 'Bot は接続時・追加利用時に「VOICEVOX:キャラ名」を公開表示します' }),
  );
}

export const voice: Command = {
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('自分の読み上げ音声を設定します')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('話者を設定します')
        .addStringOption((option) =>
          option
            .setName('speaker')
            .setDescription('キャラ・スタイル')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('show').setDescription('現在の設定を表示します'))
    .addSubcommand((sub) =>
      sub
        .setName('speed')
        .setDescription('話速を設定します')
        .addNumberOption((option) =>
          option
            .setName('value')
            .setDescription('0.5〜2.0')
            .setRequired(true)
            .setMinValue(0.5)
            .setMaxValue(2),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('pitch')
        .setDescription('ピッチを設定します')
        .addNumberOption((option) =>
          option
            .setName('value')
            .setDescription('-0.15〜0.15')
            .setRequired(true)
            .setMinValue(-0.15)
            .setMaxValue(0.15),
        ),
    )
    .addSubcommand((sub) => sub.setName('reset').setDescription('自分の設定をリセットします'))
    .addSubcommand((sub) => sub.setName('list').setDescription('利用可能な話者を表示します')),
  async autocomplete(interaction, context) {
    await interaction.respond(
      interaction.guildId
        ? await context.catalog.search(interaction.guildId, interaction.options.getFocused())
        : [],
    );
  },
  async execute(interaction, context) {
    const reply = async (content: string) => {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    };
    if (!interaction.guildId) {
      await reply('サーバー内で実行してください');
      return;
    }
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand();
    if (sub === 'reset') {
      context.store.resetUser(guildId, userId);
      await reply('自分の音声設定をリセットしました');
      return;
    }
    if (sub === 'speed' || sub === 'pitch') {
      const value = interaction.options.getNumber('value', true);
      const [min, max] = sub === 'speed' ? [0.5, 2] : [-0.15, 0.15];
      if (!Number.isFinite(value) || value < min || value > max) {
        await reply(`値は ${min}〜${max} で指定してください`);
        return;
      }
      const current = context.store.user(guildId, userId) ?? { styleId: null, speed: 1, pitch: 0 };
      context.store.setUser(guildId, userId, { ...current, [sub]: value });
      await reply(`${sub === 'speed' ? '話速' : 'ピッチ'}を ${value} に設定しました`);
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (sub === 'set') {
      const value = interaction.options.getString('speaker', true);
      const style =
        /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
          ? await context.catalog.find(guildId, Number(value))
          : undefined;
      if (!style) {
        await interaction.editReply('指定された話者は利用できません。候補から選択してください');
        return;
      }
      const current = context.store.user(guildId, userId) ?? { styleId: null, speed: 1, pitch: 0 };
      context.store.setUser(guildId, userId, { ...current, styleId: style.styleId });
      await interaction.editReply(`話者を ${styleLabel(style)} に設定しました`);
    } else if (sub === 'show') {
      const resolved = await context.resolveVoice(guildId, userId);
      const style = await context.catalog.find(guildId, resolved.styleId);
      const stored = context.store.user(guildId, userId);
      const defaultNote =
        stored?.styleId === resolved.styleId
          ? 'ユーザー設定'
          : context.store.guild(guildId)?.defaultStyleId === resolved.styleId
            ? 'サーバー既定'
            : 'グローバル既定';
      await interaction.editReply(
        `話者: ${style ? styleLabel(style) : resolved.styleId}（${defaultNote}）\n話速: ${resolved.speedScale}\nピッチ: ${resolved.pitchScale}`,
      );
    } else if (sub === 'list') {
      const embeds = voiceListEmbeds((await context.catalog.list(guildId)).map(styleLabel));
      // 各メッセージは 1 embed にして合計文字数制限も守る。
      await interaction.editReply({ embeds: [embeds[0]] });
      for (const embed of embeds.slice(1))
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
