import { describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, type VoiceBasedChannel } from 'discord.js';
import {
  collectCharacters,
  formatCharacters,
  SessionCredits,
  prepareAutoCredits,
} from '../src/voice/credits.js';
import { createVoiceResolver } from '../src/voice/resolver.js';
import { GuildVoiceSession } from '../src/voice/session.js';

const zunda = { speakerUuid: 'z', speakerName: 'ずんだもん' };
const metan = { speakerUuid: 'm', speakerName: '四国めたん' };
const styles = [
  { ...zunda, styleId: 3, styleName: 'ノーマル' },
  { ...zunda, styleId: 1, styleName: 'あまあま' },
  { ...metan, styleId: 2, styleName: 'ノーマル' },
];
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function setup() {
  const logger = { warn: vi.fn(), debug: vi.fn() };
  const find = vi.fn(async (id: number) => styles.find((s) => s.styleId === id));
  const credits = new SessionCredits(find, logger);
  const send = vi.fn<(content: string) => Promise<unknown>>().mockResolvedValue(undefined);
  const player = { play: vi.fn(), stop: vi.fn(), onIdle: vi.fn(), onError: vi.fn() };
  const synthesize = vi.fn(async ({ text }: { text: string }) => Buffer.from(text));
  const session = new GuildVoiceSession(
    'vc',
    ['text'],
    player,
    { destroy: vi.fn() },
    synthesize,
    20,
    logger,
    undefined,
    credits,
  );
  return { logger, find, credits, send, session, synthesize, player };
}

describe('クレジット', () => {
  it('接続投稿前の発話を通知先決定後に補完する', async () => {
    const s = setup();
    s.credits.characters = [zunda];
    s.credits.use({ styleId: 2, character: metan });
    s.credits.use({ styleId: 3, character: zunda });
    await s.credits.announce('text', s.send, '接続しました。');
    expect(s.send.mock.calls).toEqual([
      ['接続しました。\n現在設定されているキャラクター：VOICEVOX:ずんだもん'],
      ['VOICEVOX:四国めたん を追加で使用します'],
    ]);
  });

  it('未知の styleId は補完後に通知・合成し、後続の再生が先行しない', async () => {
    const s = setup();
    let release!: (style: (typeof styles)[number]) => void;
    s.find.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await s.credits.announce('text', s.send, '接続しました。');
    s.session.enqueue({ text: 'first', styleId: 3 });
    s.session.enqueue({ text: 'second', styleId: 2, character: metan });
    await flush();
    expect(s.synthesize.mock.calls.map(([u]) => u.text)).toEqual(['second']);
    expect(s.player.play).not.toHaveBeenCalled();
    release(styles[0]);
    await flush();
    expect(s.send).toHaveBeenCalledWith('VOICEVOX:ずんだもん を追加で使用します');
    expect(s.player.play).toHaveBeenCalledWith(Buffer.from('first'));
  });

  it('ENGINE 停止時の一覧取得・公開送信の失敗も捕捉する', async () => {
    const s = setup();
    await s.credits.prepare({ guild: { id: 'g' } } as unknown as VoiceBasedChannel, {
      catalog: {
        list: async () => {
          throw new Error('engine');
        },
        find: async () => undefined,
      },
      resolveVoice: vi.fn(),
    });
    await s.credits.announce('text', s.send, '接続しました。');
    expect(s.send).toHaveBeenCalledWith(
      '接続しました。\n現在設定されているキャラクター：取得できませんでした',
    );
    s.send.mockRejectedValue(new Error('send'));
    await expect(s.credits.announce('text', s.send, '接続しました。')).resolves.toBeUndefined();
    expect(s.logger.warn).toHaveBeenCalledTimes(2);
  });

  it('既存 resolver のフォールバックを使い、Bot を除外しメンバー順に UUID でまとめる', async () => {
    const s = setup();
    const store = {
      guild: () => ({
        defaultStyleId: 2,
        autojoin: true,
        excludedVoiceChannels: [],
        lastTextChannelId: null,
      }),
      user: (_guild: string, id: string) => ({
        styleId: id === 'a' ? 1 : id === 'b' ? 3 : 999,
        speed: 1,
        pitch: 0,
      }),
    };
    const catalog = { list: async () => styles, find: (_guild: string, id: number) => s.find(id) };
    const resolveVoice = createVoiceResolver(store, catalog, 3, s.logger);
    const members = ['a', 'b', 'c', 'bot'].map(
      (id) => [id, { id, user: { bot: id === 'bot' } }] as const,
    );
    await s.credits.prepare(
      { guild: { id: 'g' }, members: new Map(members) } as unknown as VoiceBasedChannel,
      { catalog, resolveVoice },
    );
    expect(s.credits.characters.map((c) => c.speakerUuid)).toEqual(['z', 'm']);
    expect(formatCharacters(s.credits.characters)).toBe(
      '現在設定されているキャラクター：VOICEVOX:ずんだもん、VOICEVOX:四国めたん',
    );
    expect(
      collectCharacters([{ styleId: 2 }, { styleId: 1 }, { styleId: 3 }], styles).map(
        (c) => c.speakerUuid,
      ),
    ).toEqual(['m', 'z']);
    const global = createVoiceResolver(
      { user: () => undefined, guild: () => undefined },
      catalog,
      3,
      s.logger,
    );
    expect(collectCharacters([await global('g', 'u')], styles)[0]).toMatchObject(zunda);
  });

  it('設定済みキャラを再通知せず、VC 外ユーザー・話者変更・スタイル変更も UUID で判定する', async () => {
    const s = setup();
    s.credits.characters = [zunda];
    await s.credits.announce('text', s.send, '接続しました。');
    s.send.mockClear();
    s.session.enqueue({ text: '既定', styleId: 3, character: zunda });
    s.session.enqueue({ text: '別スタイル', styleId: 1, character: zunda });
    s.session.enqueue({ text: 'VC 外または変更後', styleId: 2, character: metan });
    s.session.enqueue({ text: '再利用', styleId: 2, character: metan });
    expect(s.send.mock.calls).toEqual([['VOICEVOX:四国めたん を追加で使用します']]);
    s.session.move('next');
    s.session.enqueue({ text: '移動後', styleId: 2, character: metan });
    expect(s.credits.announceChannelId).toBe('text');
    expect(s.send).toHaveBeenCalledTimes(1);
    const next = setup();
    await next.credits.announce('text', next.send, '接続しました。');
    next.send.mockClear();
    next.session.enqueue({ text: '新規セッション', styleId: 2, character: metan });
    expect(next.send).toHaveBeenCalledWith('VOICEVOX:四国めたん を追加で使用します');
  });

  it('追加通知が保留中でもキュー投入・合成・再生順を変えない', async () => {
    const s = setup();
    await s.credits.announce('text', s.send, '接続しました。');
    s.send.mockImplementation(() => new Promise(() => {}));
    s.session.enqueue({ text: 'first', styleId: 3, character: zunda });
    s.session.enqueue({ text: 'second', styleId: 2, character: metan });
    expect(s.send.mock.calls.slice(1).map(([line]) => line)).toEqual([
      'VOICEVOX:ずんだもん を追加で使用します',
      'VOICEVOX:四国めたん を追加で使用します',
    ]);
    await flush();
    expect(s.synthesize.mock.calls.map(([u]) => u.text)).toEqual(['first', 'second']);
    expect(s.player.play).toHaveBeenCalledWith(Buffer.from('first'));
  });

  it.each(['sync', 'async'] as const)(
    '送信の %s 失敗は読み上げを妨げず次の利用で再試行する',
    async (kind) => {
      const s = setup();
      await s.credits.announce('text', s.send, '接続しました。');
      s.send.mockImplementation(() => {
        if (kind === 'sync') throw new Error('send');
        return Promise.reject(new Error('send'));
      });
      expect(s.session.enqueue({ text: 'first', styleId: 3, character: zunda })).toBe(true);
      await flush();
      expect(s.player.play).toHaveBeenCalled();
      expect(s.logger.warn).toHaveBeenCalled();
      expect(s.credits.credited.has('z')).toBe(false);
      s.send.mockResolvedValue(undefined);
      s.session.enqueue({ text: 'retry', styleId: 3, character: zunda });
      expect(s.credits.credited.has('z')).toBe(true);
    },
  );

  it('styleId だけの発話もカタログで補完し、満杯・破棄済みの発話は通知しない', async () => {
    const s = setup();
    await s.credits.announce('text', s.send, '接続しました。');
    for (let i = 0; i < 20; i++) s.session.enqueue({ text: String(i), styleId: 3 });
    expect(s.session.enqueue({ text: '拒否', styleId: 2, character: metan })).toBe(false);
    await flush();
    expect(s.find).toHaveBeenCalledTimes(1);
    expect(s.credits.credited).toEqual(new Set(['z']));
    s.session.destroy();
    expect(s.session.enqueue({ text: '破棄後', styleId: 2, character: metan })).toBe(false);
    expect(s.credits.credited.has('m')).toBe(false);
  });
});

describe('自動参加の公開通知先', () => {
  it.each(['vc', 'fallback', 'notTarget', 'denied', 'deleted', 'sendError'])(
    '%s の権限・対象・送信結果を扱う',
    async (kind) => {
      const s = setup();
      s.credits.characters = [zunda];
      const vcSend = vi.fn().mockResolvedValue(undefined);
      if (kind === 'sendError') vcSend.mockRejectedValue(new Error('send'));
      const lastSend = vi.fn().mockResolvedValue(undefined);
      const has = vi.fn(() => kind === 'vc' || kind === 'sendError');
      const last = {
        id: 'text',
        isSendable: () => true,
        send: lastSend,
        permissionsFor: () => ({ has: () => kind !== 'denied' }),
      };
      const fetch = vi.fn().mockResolvedValue(kind === 'deleted' ? null : last);
      const channel = {
        id: 'vc',
        isSendable: () => true,
        send: vcSend,
        permissionsFor: () => ({ has }),
        guild: { id: 'g', members: { me: {} }, channels: { fetch } },
      } as unknown as VoiceBasedChannel;
      await prepareAutoCredits(
        channel,
        { credits: s.credits, readsChannel: () => kind !== 'notTarget' },
        'text',
        s.logger,
      );
      await s.credits.announceCurrent('接続しました。');
      if (kind === 'vc' || kind === 'sendError') {
        expect(vcSend).toHaveBeenCalledWith(
          '接続しました。\n現在設定されているキャラクター：VOICEVOX:ずんだもん',
        );
        expect(has).toHaveBeenCalledWith([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
        ]);
        expect(fetch).not.toHaveBeenCalled();
      } else if (kind === 'fallback') {
        expect(lastSend).toHaveBeenCalled();
        expect(s.credits.announceChannelId).toBe('text');
      } else expect(s.logger.warn).toHaveBeenCalled();
      expect(lastSend).toHaveBeenCalledTimes(kind === 'fallback' ? 1 : 0);
      if (kind === 'sendError') expect(s.credits.credited.size).toBe(0);
    },
  );
});
