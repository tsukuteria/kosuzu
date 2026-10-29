import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';

export const leave: Command = {
  data: new SlashCommandBuilder().setName('leave').setDescription('VC から退出します'),
  async execute(interaction, context) {
    const left = interaction.guildId && context.sessions.leave(interaction.guildId);
    await interaction.reply({
      content: left ? '退出しました' : '接続していません',
      flags: MessageFlags.Ephemeral,
    });
  },
};
