import { SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';

export const skip: Command = {
  data: new SlashCommandBuilder().setName('skip').setDescription('現在の読み上げをスキップします'),
  async execute(interaction, context) {
    const session = interaction.guildId ? context.sessions.get(interaction.guildId) : undefined;
    session?.skip();
    await interaction.reply({
      content: session ? 'スキップしました' : '接続していません',
    });
  },
};
