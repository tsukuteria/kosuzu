import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';
import { styleLabel } from '../tts/speakers.js';

export const config: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('サーバー設定を変更します')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('autojoin')
        .setDescription('自動参加を切り替えます')
        .addBooleanOption((o) =>
          o.setName('enabled').setDescription('有効にする').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('exclude')
        .setDescription('自動参加から除外します')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('VC')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('include')
        .setDescription('自動参加の除外を解除します')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('VC')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('show').setDescription('現在の設定を表示します'))
    .addSubcommand((sub) =>
      sub
        .setName('default-voice')
        .setDescription('サーバー既定の話者を設定します')
        .addStringOption((o) =>
          o
            .setName('speaker')
            .setDescription('キャラ・スタイル')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('default-voice-reset').setDescription('既定話者を環境設定に戻します'),
    ),
  async autocomplete(interaction, context) {
    await interaction.respond(
      interaction.guildId && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
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
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await reply('「サーバー管理」権限が必要です');
      return;
    }
    const id = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    if (sub === 'autojoin') {
      const enabled = interaction.options.getBoolean('enabled', true);
      context.store.setAutojoin(id, enabled);
      await reply(`自動参加を${enabled ? '有効' : '無効'}にしました`);
    } else if (sub === 'exclude' || sub === 'include') {
      const channel = interaction.options.getChannel('channel', true);
      if (channel.type !== ChannelType.GuildVoice) {
        await reply('ボイスチャンネルを指定してください');
        return;
      }
      context.store.setVoiceChannelExcluded(id, channel.id, sub === 'exclude');
      await reply(
        `<#${channel.id}> の自動参加${sub === 'exclude' ? 'を除外しました' : 'の除外を解除しました'}`,
      );
    } else if (sub === 'default-voice-reset') {
      context.store.setDefaultStyle(id, null);
      await reply('サーバー既定の話者を環境設定に戻しました');
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (sub === 'default-voice') {
        const value = interaction.options.getString('speaker', true);
        const style =
          /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
            ? await context.catalog.find(id, Number(value))
            : undefined;
        if (!style) {
          await interaction.editReply('指定された話者は利用できません。候補から選択してください');
          return;
        }
        context.store.setDefaultStyle(id, style.styleId);
        await interaction.editReply(`サーバー既定の話者を ${styleLabel(style)} に設定しました`);
      } else if (sub === 'show') {
        const settings = context.store.guild(id);
        const style =
          settings?.defaultStyleId == null
            ? undefined
            : await context.catalog.find(id, settings.defaultStyleId);
        const excluded = settings?.excludedVoiceChannels.map((c) => `<#${c}>`).join('、') || 'なし';
        const content = `自動参加: ${settings?.autojoin === false ? '無効' : '有効'}\n除外 VC: ${excluded}\n最後の /join: ${settings?.lastTextChannelId ? `<#${settings.lastTextChannelId}>` : '未設定'}\nサーバー既定話者: ${style ? styleLabel(style) : (settings?.defaultStyleId ?? '環境設定')}`;
        for (let offset = 0; offset < content.length; offset += 1900) {
          const page = content.slice(offset, offset + 1900);
          if (offset === 0) await interaction.editReply(page);
          else await interaction.followUp({ content: page, flags: MessageFlags.Ephemeral });
        }
      }
    }
  },
};
