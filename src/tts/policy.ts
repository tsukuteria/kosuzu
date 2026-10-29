import { escapeMarkdown } from 'discord.js';

export function termsUrl(policy: string): string | undefined {
  const match = policy.match(/https?:\/\/[^\s<>"\])]+/i);
  if (!match) return undefined;
  try {
    return new URL(match[0]).href;
  } catch {
    return undefined;
  }
}

export function policyExcerpt(policy: string): string {
  return escapeMarkdown(
    policy
      .replace(/<[^>]*>/g, '')
      .replace(/@/g, '＠')
      .trim()
      .split(/\r?\n/)
      .slice(0, 8)
      .join('\n'),
  ).slice(0, 600);
}
