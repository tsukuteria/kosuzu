import { speaker } from './speaker.js';
import { credits } from './credits.js';
import { ping } from './ping.js';
import { join } from './join.js';
import { leave } from './leave.js';
import { skip } from './skip.js';
import { voice } from './voice.js';
import { config } from './config.js';
import type { Command } from './types.js';

export const commands: Command[] = [ping, join, leave, skip, voice, config, speaker, credits];
