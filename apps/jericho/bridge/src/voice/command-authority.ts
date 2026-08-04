import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export interface CommandAuthorityOptions {
  sessionId: string;
  clock?: () => number;
}

export interface AuthorityToken {
  sessionId: string;
  commandDigest: string;
  expiryMs: number;
  source: 'voice';
  speakerVerified: boolean;
  nonce: string;
}

export interface MintOptions {
  toolName: string;
  args: Record<string, unknown>;
  maxAgeMs: number;
  speakerVerified?: boolean;
}

export enum AuthorityRejectionReason {
  Inactive = 'authority_inactive',
  Expired = 'token_expired',
  Replayed = 'nonce_replayed',
  Altered = 'digest_mismatch',
  PointerOrigin = 'pointer_origin_not_permitted',
  SpeakerUnverified = 'speaker_verification_required',
  InvalidToken = 'invalid_token_format',
}

export class CommandAuthority {
  private readonly sessionId: string;
  private readonly clock: () => number;
  private readonly issued = new Map<string, {
    commandDigest: string;
    expiryMs: number;
    speakerVerified: boolean;
  }>();
  private readonly usedNonces = new Map<string, number>();
  private active_ = false;

  constructor(options: CommandAuthorityOptions) {
    if (!options.sessionId.trim() || options.sessionId.length > 128) {
      throw new Error('authority_session_id_invalid');
    }
    this.sessionId = options.sessionId;
    this.clock = options.clock ?? (() => Date.now());
  }

  get active(): boolean {
    return this.active_;
  }

  activate(): void {
    this.active_ = true;
    this.#purgeExpired();
  }

  deactivate(): void {
    this.active_ = false;
    this.issued.clear();
  }

  mint(options: MintOptions): AuthorityToken {
    if (!this.active_) throw new Error(AuthorityRejectionReason.Inactive);
    if (!options.toolName.trim() || options.toolName.length > 256) {
      throw new Error('authority_tool_name_invalid');
    }
    if (!Number.isInteger(options.maxAgeMs) || options.maxAgeMs < 1 || options.maxAgeMs > 120_000) {
      throw new Error('authority_max_age_invalid');
    }
    this.#purgeExpired();
    const nonce = randomUUID();
    const commandDigest = computeDigest(options.toolName, options.args);
    const now = this.clock();
    const expiryMs = now + options.maxAgeMs;
    const speakerVerified = options.speakerVerified ?? false;
    this.issued.set(nonce, { commandDigest, expiryMs, speakerVerified });

    return {
      sessionId: this.sessionId,
      commandDigest,
      expiryMs,
      source: 'voice',
      speakerVerified,
      nonce,
    };
  }

  validate(token: AuthorityToken, actualToolName: string, actualArgs: Record<string, unknown>): { ok: true } | { ok: false; reason: AuthorityRejectionReason } {
    if (!this.active_) return { ok: false, reason: AuthorityRejectionReason.Inactive };
    this.#purgeExpired();
    if (!token || typeof token !== 'object' || Array.isArray(token)) {
      return { ok: false, reason: AuthorityRejectionReason.InvalidToken };
    }
    if (
      token.sessionId !== this.sessionId ||
      typeof token.nonce !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(token.nonce) ||
      typeof token.expiryMs !== 'number' ||
      !Number.isFinite(token.expiryMs) ||
      typeof token.speakerVerified !== 'boolean' ||
      typeof token.commandDigest !== 'string' ||
      !/^[0-9a-f]{64}$/iu.test(token.commandDigest)
    ) {
      return { ok: false, reason: AuthorityRejectionReason.InvalidToken };
    }
    if (token.source !== 'voice') {
      return { ok: false, reason: AuthorityRejectionReason.PointerOrigin };
    }
    if (this.clock() > token.expiryMs) {
      this.issued.delete(token.nonce);
      return { ok: false, reason: AuthorityRejectionReason.Expired };
    }
    if (this.usedNonces.has(token.nonce)) {
      return { ok: false, reason: AuthorityRejectionReason.Replayed };
    }
    const issued = this.issued.get(token.nonce);
    if (!issued) {
      return { ok: false, reason: AuthorityRejectionReason.InvalidToken };
    }
    if (
      issued.expiryMs !== token.expiryMs ||
      issued.speakerVerified !== token.speakerVerified ||
      !safeDigestEqual(issued.commandDigest, token.commandDigest)
    ) return { ok: false, reason: AuthorityRejectionReason.Altered };
    const expectedDigest = computeDigest(actualToolName, actualArgs);
    if (!safeDigestEqual(token.commandDigest, expectedDigest)) {
      return { ok: false, reason: AuthorityRejectionReason.Altered };
    }
    if (!token.speakerVerified) {
      return { ok: false, reason: AuthorityRejectionReason.SpeakerUnverified };
    }
    this.issued.delete(token.nonce);
    this.usedNonces.set(token.nonce, token.expiryMs);
    return { ok: true };
  }

  rejectIfNotVerified(
    token: AuthorityToken,
    actualToolName: string,
    actualArgs: Record<string, unknown>,
  ): void | never {
    const result = this.validate(token, actualToolName, actualArgs);
    if (!result.ok) {
      const error = new Error(result.reason);
      (error as unknown as Record<string, unknown>).code = result.reason;
      throw error;
    }
  }

  resetNonces(): void {
    this.usedNonces.clear();
    this.issued.clear();
  }

  #purgeExpired(): void {
    const now = this.clock();
    for (const [nonce, issued] of this.issued) {
      if (issued.expiryMs < now) this.issued.delete(nonce);
    }
    for (const [nonce, expiryMs] of this.usedNonces) {
      if (expiryMs < now) this.usedNonces.delete(nonce);
    }
  }
}

function computeDigest(toolName: string, args: Record<string, unknown>): string {
  const hash = createHash('sha256');
  hash.update(`tool:${toolName}`);
  hash.update('\0');
  hash.update(canonicalize(args));
  return hash.digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('authority_arguments_invalid');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  throw new Error('authority_arguments_invalid');
}

function safeDigestEqual(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first, 'utf8');
  const secondBuffer = Buffer.from(second, 'utf8');
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}
