import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';

export const ping: Command = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Bot の応答速度を確認します'),
  async execute(interaction) {
    await interaction.reply({
      content: `Pong! ${interaction.client.ws.ping}ms`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
