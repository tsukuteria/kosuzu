import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { VoiceSessionManager } from '../voice/manager.js';

export interface CommandContext {
  sessions: Pick<VoiceSessionManager, 'join' | 'leave' | 'get'>;
  resolveStyle(guildId: string, userId: string): number;
}

export interface Command {
  data: { name: string; toJSON(): object };
  execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}
