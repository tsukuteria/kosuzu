import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { VoiceSessionManager } from '../voice/manager.js';
import type { SettingsStore } from '../store/settings.js';
import type { SpeakerCatalog } from '../tts/speakers.js';
import type { ResolvedVoice } from '../voice/resolver.js';

export interface CommandContext {
  sessions: Pick<VoiceSessionManager, 'join' | 'leave' | 'get'>;
  store: SettingsStore;
  catalog: Pick<SpeakerCatalog, 'list' | 'find' | 'search'>;
  resolveVoice(guildId: string, userId: string): Promise<ResolvedVoice>;
}

export interface Command {
  data: { name: string; toJSON(): object };
  execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, context: CommandContext): Promise<void>;
}
