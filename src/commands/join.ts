import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';
import { JOIN_ANNOUNCEMENT } from '../voice/manager.js';

export const join: Command = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('VC に参加し、このチャンネルを読み上げます'),
  async execute(interaction, context) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: 'サーバー内で実行してください',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    context.store.setLastTextChannel(interaction.guildId, interaction.channelId);
    const channel = interaction.member.voice.channel;
    if (!channel) {
      await interaction.reply({
        content: '先にボイスチャンネルに参加してください',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const me = interaction.guild.members.me;
    if (
      !me ||
      !channel.permissionsFor(me)?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])
    ) {
      await interaction.reply({
        content: 'Bot にこの VC の「接続」と「発言」権限が必要です',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply();
    let session;
    try {
      session = await context.sessions.join(channel, interaction.channelId);
    } catch {
      await interaction.editReply('VC に接続できませんでした。権限や接続状態を確認してください');
      return;
    }
    await interaction.editReply(`${channel.name} に接続しました。このチャンネルを読み上げます`);
    session.enqueue({
      text: JOIN_ANNOUNCEMENT,
      ...(await context.resolveVoice(interaction.guildId, interaction.user.id)),
    });
  },
};
