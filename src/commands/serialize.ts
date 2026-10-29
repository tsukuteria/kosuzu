import { ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import type { Command } from './types.js';

export function toCommandBodies(commands: Command[]) {
  return commands.map((command) => ({
    ...command.data.toJSON(),
    integration_types: [ApplicationIntegrationType.GuildInstall],
    contexts: [InteractionContextType.Guild],
  }));
}
