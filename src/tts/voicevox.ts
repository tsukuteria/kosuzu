import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from 'pino';

export interface Speaker {
  name: string;
  speaker_uuid: string;
  styles: { name: string; id: number; type?: string }[];
  version: string;
}

export interface AudioQuery {
  outputSamplingRate: number;
  outputStereo: boolean;
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  [key: string]: unknown;
}

export interface EngineManifest {
  name: string;
  brand_name: string;
  supported_features: { manage_library?: boolean; [key: string]: unknown };
}

export interface DownloadableLibrary {
  name: string;
  uuid: string;
  version: string;
  download_url: string;
}

export interface InstalledLibrary extends DownloadableLibrary {
  uninstallable: boolean;
}

export interface SpeakerStyle {
  styleId: number;
  speakerName: string;
  styleName: string;
  speakerUuid: string;
}

export type AudioQueryOverrides = Partial<
  Pick<
    AudioQuery,
    | 'speedScale'
    | 'pitchScale'
    | 'intonationScale'
    | 'volumeScale'
    | 'prePhonemeLength'
    | 'postPhonemeLength'
    | 'outputSamplingRate'
    | 'outputStereo'
  >
>;

export interface TtsEngine {
  version(): Promise<string>;
  speakers(): Promise<Speaker[]>;
  refreshSpeakers(): Promise<Speaker[]>;
  invalidateSpeakers(): void;
  styles(): Promise<SpeakerStyle[]>;
  findStyle(styleId: number): Promise<SpeakerStyle | undefined>;
  engineManifest(): Promise<EngineManifest>;
  audioQuery(text: string, styleId: number): Promise<AudioQuery>;
  synthesis(query: AudioQuery, styleId: number): Promise<Buffer>;
  synthesize(text: string, styleId: number, overrides?: AudioQueryOverrides): Promise<Buffer>;
  initializeSpeaker(styleId: number, options: { skipReinit: boolean }): Promise<void>;
  isInitializedSpeaker(styleId: number): Promise<boolean>;
  downloadableLibraries(): Promise<DownloadableLibrary[]>;
  installedLibraries(): Promise<Record<string, InstalledLibrary>>;
  installLibrary(uuid: string, archive: Blob): Promise<void>;
}

export class VoicevoxError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'http' | 'invalid_response',
    message: string,
    readonly status?: number,
    readonly responseBody?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'VoicevoxError';
  }
}

export interface VoicevoxClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  metadataTimeoutMs?: number;
  speakerCacheTtlMs?: number;
  fetch?: typeof globalThis.fetch;
  logger?: Pick<Logger, 'warn'>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSpeaker(value: unknown): value is Speaker {
  return (
    isObject(value) &&
    typeof value.name === 'string' &&
    typeof value.speaker_uuid === 'string' &&
    typeof value.version === 'string' &&
    Array.isArray(value.styles) &&
    value.styles.every(
      (style: unknown) =>
        isObject(style) &&
        typeof style.name === 'string' &&
        Number.isInteger(style.id) &&
        (style.type === undefined || typeof style.type === 'string'),
    )
  );
}

function isLibrary(value: unknown): value is DownloadableLibrary {
  return (
    isObject(value) &&
    ['name', 'uuid', 'version', 'download_url'].every((key) => typeof value[key] === 'string')
  );
}

export function flattenStyles(speakers: readonly Speaker[]): SpeakerStyle[] {
  return speakers.flatMap((speaker) =>
    speaker.styles.map((style) => ({
      styleId: style.id,
      speakerName: speaker.name,
      styleName: style.name,
      speakerUuid: speaker.speaker_uuid,
    })),
  );
}

export class VoicevoxClient implements TtsEngine {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly metadataTimeoutMs: number;
  private readonly speakerCacheTtlMs: number;
  private speakerCache?: { value: Speaker[]; expiresAt: number };
  private catalogGeneration = 0;

  constructor(private readonly options: VoicevoxClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.metadataTimeoutMs = options.metadataTimeoutMs ?? Math.min(this.timeoutMs, 5_000);
    this.speakerCacheTtlMs = options.speakerCacheTtlMs ?? 300_000;
  }

  version(): Promise<string> {
    return this.json('/version', (value) => typeof value === 'string');
  }

  async speakers(): Promise<Speaker[]> {
    if (this.speakerCache && this.speakerCache.expiresAt > Date.now()) {
      return structuredClone(this.speakerCache.value);
    }
    const generation = this.catalogGeneration;
    const value = await this.json<Speaker[]>(
      '/speakers',
      (value) => Array.isArray(value) && value.every(isSpeaker),
    );
    if (generation === this.catalogGeneration) {
      this.speakerCache = { value, expiresAt: Date.now() + this.speakerCacheTtlMs };
    }
    return structuredClone(value);
  }

  invalidateSpeakers(): void {
    this.catalogGeneration++;
    this.speakerCache = undefined;
  }

  refreshSpeakers(): Promise<Speaker[]> {
    this.invalidateSpeakers();
    return this.speakers();
  }

  async styles(): Promise<SpeakerStyle[]> {
    return flattenStyles(await this.speakers());
  }

  async findStyle(styleId: number): Promise<SpeakerStyle | undefined> {
    return (await this.styles()).find((style) => style.styleId === styleId);
  }

  engineManifest(): Promise<EngineManifest> {
    return this.json(
      '/engine_manifest',
      (value) =>
        isObject(value) &&
        typeof value.name === 'string' &&
        typeof value.brand_name === 'string' &&
        isObject(value.supported_features) &&
        (value.supported_features.manage_library === undefined ||
          typeof value.supported_features.manage_library === 'boolean'),
    );
  }

  audioQuery(text: string, styleId: number): Promise<AudioQuery> {
    return this.json(
      '/audio_query',
      (value) =>
        isObject(value) &&
        [
          'speedScale',
          'pitchScale',
          'intonationScale',
          'volumeScale',
          'prePhonemeLength',
          'postPhonemeLength',
        ].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key])),
      { method: 'POST' },
      { text, speaker: styleId },
    );
  }

  synthesis(query: AudioQuery, styleId: number): Promise<Buffer> {
    return this.request(
      '/synthesis',
      async (response) => {
        const wav = Buffer.from(await response.arrayBuffer());
        if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
          throw new VoicevoxError('invalid_response', 'VOICEVOX の WAV 応答が不正です');
        }
        return wav;
      },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      },
      { speaker: styleId },
    );
  }

  async synthesize(
    text: string,
    styleId: number,
    overrides: AudioQueryOverrides = {},
  ): Promise<Buffer> {
    const query = await this.audioQuery(text, styleId);
    return this.synthesis({ ...query, ...overrides }, styleId);
  }

  initializeSpeaker(styleId: number, { skipReinit }: { skipReinit: boolean }): Promise<void> {
    return this.request(
      '/initialize_speaker',
      async () => {},
      { method: 'POST' },
      {
        speaker: styleId,
        skip_reinit: skipReinit,
      },
    );
  }

  isInitializedSpeaker(styleId: number): Promise<boolean> {
    return this.json(
      '/is_initialized_speaker',
      (value) => typeof value === 'boolean',
      {},
      {
        speaker: styleId,
      },
    );
  }

  downloadableLibraries(): Promise<DownloadableLibrary[]> {
    return this.json(
      '/downloadable_libraries',
      (value) => Array.isArray(value) && value.every(isLibrary),
    );
  }

  installedLibraries(): Promise<Record<string, InstalledLibrary>> {
    return this.json(
      '/installed_libraries',
      (value) =>
        isObject(value) &&
        Object.values(value).every(
          (library) =>
            isLibrary(library) && isObject(library) && typeof library.uninstallable === 'boolean',
        ),
    );
  }

  async installLibrary(uuid: string, archive: Blob): Promise<void> {
    await this.request(`/install_library/${encodeURIComponent(uuid)}`, async () => {}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: archive,
    });
    this.invalidateSpeakers();
  }

  private json<T>(
    path: string,
    validate: (value: unknown) => boolean,
    init: RequestInit = {},
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    return this.request(
      path,
      async (response) => {
        const text = await response.text();
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch (cause) {
          throw new VoicevoxError(
            'invalid_response',
            'VOICEVOX の JSON 応答が不正です',
            undefined,
            undefined,
            { cause },
          );
        }
        if (!validate(value)) {
          throw new VoicevoxError('invalid_response', 'VOICEVOX の応答形式が不正です');
        }
        return value as T;
      },
      init,
      params,
    );
  }

  private async request<T>(
    path: string,
    read: (response: Response) => Promise<T>,
    init: RequestInit = {},
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const method = init.method ?? 'GET';
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.fetch(url, {
          ...init,
          method,
          signal: AbortSignal.timeout(method === 'GET' ? this.metadataTimeoutMs : this.timeoutMs),
        });
        if (!response.ok) {
          let body = '';
          let cause: unknown;
          try {
            body = (await response.text()).slice(0, 512);
          } catch (error) {
            cause = error;
          }
          throw new VoicevoxError(
            'http',
            `VOICEVOX HTTP ${response.status}`,
            response.status,
            body,
            { cause },
          );
        }
        return await read(response);
      } catch (cause) {
        const error =
          cause instanceof VoicevoxError
            ? cause
            : new VoicevoxError('unavailable', 'VOICEVOX に接続できません', undefined, undefined, {
                cause,
              });
        if (method !== 'GET' || error.kind !== 'unavailable' || attempt >= 2) throw error;
        this.options.logger?.warn(
          { err: error, path, attempt: attempt + 1 },
          'VOICEVOX への接続を再試行します',
        );
        await delay(100);
      }
    }
  }
}
