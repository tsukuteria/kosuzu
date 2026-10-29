import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Collection, type Guild, type VoiceState } from 'discord.js';
import { AutoJoin, countHumans, selectChannel, sessionStarted } from '../src/voice/autoJoin.js';
import { GuildVoiceSession } from '../src/voice/session.js';

afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  let session: GuildVoiceSession | undefined;
  const settings = {
    autojoin: true,
    excludedVoiceChannels: [] as string[],
    defaultStyleId: null,
    lastTextChannelId: null,
  };
  const player = { play: vi.fn(), stop: vi.fn(), onIdle: vi.fn(), onError: vi.fn() };
  const logger = { warn: vi.fn() };
  const sessions = {
    get: () => session,
    join: vi.fn(async (c: { id: string }) => {
      session = new GuildVoiceSession(
        c.id,
        ['text'],
        player,
        { destroy: vi.fn() },
        async () => Buffer.alloc(4),
        20,
        logger,
      );
      return session;
    }),
    leave: vi.fn(() => {
      session?.destroy();
      session = undefined;
      return true;
    }),
    updateVoiceState: vi.fn((_id: string, channelId: string | null) => {
      if (channelId) session?.move(channelId);
      else sessions.leave();
    }),
    onChange: new Set<(id: string) => void>(),
    onShutdown: new Set<() => void>(),
  };
  const channel = (id: string, position = 0) => ({
    id,
    position,
    type: ChannelType.GuildVoice as ChannelType,
    members: new Collection<string, { user: { bot: boolean } }>(),
    permissionsFor: vi.fn(() => ({ has: (): boolean => true })),
    isVoiceBased: () => true,
  });
  const a = channel('10'),
    b = channel('20', 1),
    c = channel('30', 1);
  const guild = {
    id: 'g',
    afkChannelId: null as string | null,
    client: { user: { id: 'bot' } },
    members: { me: {} },
    channels: {
      cache: new Collection([
        [a.id, a],
        [b.id, b],
        [c.id, c],
      ]),
    },
  };
  const auto = new AutoJoin(
    sessions,
    { guild: () => settings },
    async () => ({ styleId: 3, speedScale: 1, pitchScale: 0 }),
    100,
    logger,
  );
  const event = (old: string | null, next: string | null, id = 'u', bot = false) =>
    auto.update(
      { channelId: old } as VoiceState,
      { guild, channelId: next, id, member: { user: { bot } } } as unknown as VoiceState,
    );
  const human = { user: { bot: false } };
  return {
    auto,
    sessions,
    settings,
    a,
    b,
    c,
    guild,
    event,
    human,
    logger,
    current: () => session,
    scan: () => auto.scan([guild as unknown as Guild]),
  };
}

describe('自動入退室', () => {
  it('接続待機中のイベント連発を直列化する', async () => {
    const s = setup();
    s.a.members.set('u', s.human);
    s.b.members.set('v', s.human);
    const connect = s.sessions.join.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.sessions.join.mockImplementation(async (channel) => {
      await gate;
      return connect(channel);
    });
    const first = s.event(null, s.a.id);
    const second = s.event(null, s.b.id, 'v');
    await Promise.resolve();
    expect(s.sessions.join).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(s.sessions.join).toHaveBeenCalledTimes(1);
    expect(s.current()?.channelId).toBe(s.a.id);
  });
  it('起動時は人数の多い VC を選び、無効時は手動接続の無人退出だけ行う', async () => {
    const s = setup();
    s.a.members.set('u', s.human);
    s.b.members.set('v', s.human);
    s.b.members.set('w', s.human);
    await s.scan();
    expect(s.current()?.channelId).toBe(s.b.id);
    s.settings.autojoin = false;
    s.b.members.clear();
    await s.event(s.b.id, null);
    await vi.advanceTimersByTimeAsync(100);
    expect(s.current()).toBeUndefined();
    expect(s.sessions.join).toHaveBeenCalledTimes(1);
  });
  it('外部移動先が無人なら移動時点から猶予を開始する', async () => {
    const s = setup();
    await s.sessions.join(s.a);
    await s.event(s.a.id, null);
    await vi.advanceTimersByTimeAsync(75);
    await s.event(s.a.id, s.b.id, 'bot', true);
    await vi.advanceTimersByTimeAsync(99);
    expect(s.sessions.leave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.sessions.leave).toHaveBeenCalledTimes(1);
  });
  it('人数は Bot を除き、開始は未接続の 0→1 のみ', () => {
    expect(countHumans([{ user: { bot: true } }, { user: { bot: false } }])).toBe(1);
    expect(sessionStarted(0, 1, false, true, true)).toBe(true);
    expect(sessionStarted(1, 2, false, true, true)).toBe(false);
  });
  it('起動時と退出後の候補は人数・位置・ID 順', () => {
    const candidate = (id: string, humans: number, position = 0) => ({
      id,
      humans,
      position,
      eligible: true,
    });
    expect(selectChannel([candidate('30', 2), candidate('10', 2), candidate('20', 3)])?.id).toBe(
      '20',
    );
    expect(
      selectChannel([candidate('30', 2, 1), candidate('20', 2, 1), candidate('10', 2, 2)])?.id,
    ).toBe('20');
  });
  it.each(['afk', 'excluded', 'permission', 'stage', 'off', 'bot'])(
    '%s では自動参加しない',
    async (kind) => {
      const s = setup();
      s.a.members.set('u', kind === 'bot' ? { user: { bot: true } } : s.human);
      if (kind === 'afk') s.guild.afkChannelId = s.a.id;
      if (kind === 'excluded') s.settings.excludedVoiceChannels = [s.a.id];
      if (kind === 'permission') s.a.permissionsFor.mockReturnValue({ has: () => false });
      if (kind === 'stage') s.a.type = ChannelType.GuildStageVoice;
      if (kind === 'off') s.settings.autojoin = false;
      await s.event(null, s.a.id, 'u', kind === 'bot');
      await s.scan();
      expect(s.sessions.join).not.toHaveBeenCalled();
    },
  );
  it('0→1 で一度参加し、接続中は他 VC に移らない', async () => {
    const s = setup();
    s.a.members.set('u', s.human);
    await Promise.all(Array.from({ length: 10 }, () => s.event(null, s.a.id)));
    expect(s.sessions.join).toHaveBeenCalledTimes(1);
    expect(s.sessions.join).toHaveBeenCalledWith(s.a, 'auto');
    s.b.members.set('v', s.human);
    await s.event(null, s.b.id, 'v');
    expect(s.sessions.join).toHaveBeenCalledTimes(1);
  });
  it('起動時に既存 VC を選んで接続しアナウンスする', async () => {
    const s = setup();
    s.b.members.set('u', s.human);
    const enqueue = vi.spyOn(GuildVoiceSession.prototype, 'enqueue');
    try {
      await s.scan();
      expect(s.current()?.channelId).toBe(s.b.id);
      expect(enqueue).toHaveBeenCalledWith({
        text: '接続しました',
        styleId: 3,
        speedScale: 1,
        pitchScale: 0,
      });
    } finally {
      enqueue.mockRestore();
    }
  });
  it('手動接続も猶予後に退出し、別 VC を人数・位置・ID 順で選ぶ', async () => {
    const s = setup();
    await s.sessions.join(s.a);
    s.b.members.set('u', s.human);
    s.c.members.set('v', s.human);
    await s.event(s.a.id, s.b.id);
    await vi.advanceTimersByTimeAsync(99);
    expect(s.sessions.leave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.sessions.leave).toHaveBeenCalledTimes(1);
    expect(s.current()?.channelId).toBe(s.b.id);
  });
  it('再入室で猶予を取消し、次の退出で新しい猶予を開始する', async () => {
    const s = setup();
    await s.sessions.join(s.a);
    await s.event(s.a.id, null);
    await vi.advanceTimersByTimeAsync(50);
    s.a.members.set('u', s.human);
    await s.event(null, s.a.id);
    await vi.advanceTimersByTimeAsync(100);
    expect(s.sessions.leave).not.toHaveBeenCalled();
    s.a.members.clear();
    await s.event(s.a.id, null);
    await vi.advanceTimersByTimeAsync(100);
    expect(s.sessions.leave).toHaveBeenCalledTimes(1);
  });
  it('Bot 移動は VC チャットを差し替えて追加対象を保ち、キックで破棄する', async () => {
    const s = setup();
    await s.sessions.join(s.a);
    s.b.members.set('u', s.human);
    await s.event(s.a.id, s.b.id, 'bot', true);
    expect(s.current()?.channelId).toBe(s.b.id);
    expect(s.current()?.readsChannel(s.a.id)).toBe(false);
    expect(s.current()?.readsChannel(s.b.id)).toBe(true);
    expect(s.current()?.readsChannel('text')).toBe(true);
    await s.event(s.b.id, null, 'bot', true);
    expect(s.current()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.sessions.join).toHaveBeenCalledTimes(1);
  });
  it('接続失敗は warn を残し、ミュート更新などで再試行しない', async () => {
    const s = setup();
    s.a.members.set('u', s.human);
    s.sessions.join.mockRejectedValue(new Error('denied'));
    await s.event(null, s.a.id);
    await s.event(s.a.id, s.a.id);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.sessions.join).toHaveBeenCalledTimes(1);
    expect(s.logger.warn).toHaveBeenCalled();
  });
  it('destroyAll 通知はタイマーと待機処理を停止する', async () => {
    const s = setup();
    await s.sessions.join(s.a);
    await s.event(s.a.id, null);
    for (const listener of s.sessions.onShutdown) listener();
    await vi.advanceTimersByTimeAsync(1000);
    await s.scan();
    expect(vi.getTimerCount()).toBe(0);
    expect(s.sessions.leave).not.toHaveBeenCalled();
  });
});
