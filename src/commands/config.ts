import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';
import { styleLabel } from '../tts/speakers.js';

export const config: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('サーバー設定を変更します')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup((g) =>
      g
        .setName('channel')
        .setDescription('固定読み上げチャンネル')
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('固定先を設定します')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('テキストチャンネル')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true),
            ),
        )
        .addSubcommand((s) => s.setName('reset').setDescription('固定先を解除します')),
    )
    .addSubcommand((s) =>
      s
        .setName('max-length')
        .setDescription('最大文字数を設定します')
        .addIntegerOption((o) =>
          o
            .setName('value')
            .setDescription('10〜500')
            .setMinValue(10)
            .setMaxValue(500)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('max-length-reset').setDescription('最大文字数を環境設定に戻します'),
    )
    .addSubcommand((s) =>
      s
        .setName('skip-prefix')
        .setDescription('除外接頭辞を設定します')
        .addStringOption((o) =>
          o.setName('value').setDescription('省略すると無効').setMaxLength(5),
        ),
    )
    .addSubcommand((s) =>
      s.setName('skip-prefix-reset').setDescription('除外接頭辞を環境設定に戻します'),
    )
    .addSubcommand((s) =>
      s
        .setName('announce')
        .setDescription('接続音声を切り替えます')
        .addBooleanOption((o) =>
          o.setName('enabled').setDescription('有効にする').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('read-name')
        .setDescription('名前の読み上げを設定します')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('モード')
            .addChoices(
              { name: 'オフ', value: 'off' },
              { name: '発話者の変更時', value: 'on_change' },
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('dict-permission')
        .setDescription('辞書の変更権限を設定します')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('権限')
            .addChoices({ name: '全員', value: 'everyone' }, { name: '管理者', value: 'admin' })
            .setRequired(true),
        ),
    )
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
    const group = interaction.options.getSubcommandGroup?.(false);
    if (group === 'channel') {
      const channel = sub === 'set' ? interaction.options.getChannel('channel', true) : null;
      if (channel && channel.type !== ChannelType.GuildText) {
        await reply('テキストチャンネルを指定してください');
        return;
      }
      context.store.setGuildOption(id, 'fixed_text_channel_id', channel?.id ?? null);
      await reply(channel ? `固定先を <#${channel.id}> に設定しました` : '固定先を解除しました');
      return;
    }
    if (sub === 'max-length' || sub === 'max-length-reset') {
      const value = sub === 'max-length' ? interaction.options.getInteger('value', true) : null;
      if (value !== null && (!Number.isInteger(value) || value < 10 || value > 500)) {
        await reply('10〜500の整数を指定してください');
        return;
      }
      context.store.setGuildOption(id, 'read_max_length', value);
      await reply('最大文字数を更新しました');
      return;
    }
    if (sub === 'skip-prefix' || sub === 'skip-prefix-reset') {
      const value = sub === 'skip-prefix' ? (interaction.options.getString('value') ?? '') : null;
      if (value !== null && Array.from(value).length > 5) {
        await reply('接頭辞は5文字以内で指定してください');
        return;
      }
      context.store.setGuildOption(id, 'skip_prefix', value);
      await reply('除外接頭辞を更新しました');
      return;
    }
    if (sub === 'announce') {
      context.store.setGuildOption(
        id,
        'announce_join',
        Number(interaction.options.getBoolean('enabled', true)),
      );
      await reply('接続音声の設定を更新しました');
      return;
    }
    if (sub === 'read-name' || sub === 'dict-permission') {
      const value = interaction.options.getString('mode', true);
      if (!(sub === 'read-name' ? ['off', 'on_change'] : ['everyone', 'admin']).includes(value)) {
        await reply('モードが不正です');
        return;
      }
      context.store.setGuildOption(
        id,
        sub === 'read-name' ? 'read_name' : 'dict_permission',
        value,
      );
      await reply('設定を更新しました');
      return;
    }
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
        const content = `自動参加: ${settings?.autojoin === false ? '無効' : '有効'}\n除外 VC: ${excluded}\n最後の /join: ${settings?.lastTextChannelId ? `<#${settings.lastTextChannelId}>` : '未設定'}\nサーバー既定話者: ${style ? styleLabel(style) : (settings?.defaultStyleId ?? '環境設定')}\n固定チャンネル: ${settings?.fixedTextChannelId ? `<#${settings.fixedTextChannelId}>` : '未設定'}\n最大文字数: ${settings?.readMaxLength ?? `${context.readDefaults?.readMaxLength ?? 100}（環境設定）`}\n除外接頭辞: ${settings?.skipPrefix === null || settings?.skipPrefix === undefined ? `${context.readDefaults?.readSkipPrefix ?? ';'}（環境設定）` : settings.skipPrefix || '無効'}\n接続音声: ${settings?.announceJoin === false ? '無効' : '有効'}\n名前: ${settings?.readName ?? 'off'}\n辞書変更権限: ${settings?.dictPermission ?? 'everyone'}`;
        for (let offset = 0; offset < content.length; offset += 1900) {
          const page = content.slice(offset, offset + 1900);
          if (offset === 0) await interaction.editReply(page);
          else await interaction.followUp({ content: page, flags: MessageFlags.Ephemeral });
        }
      }
    }
  },
};
