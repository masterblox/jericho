import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

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
  private readonly usedNonces = new Set<string>();
  private active_ = true;

  constructor(options: CommandAuthorityOptions) {
    this.sessionId = options.sessionId;
    this.clock = options.clock ?? (() => Date.now());
  }

  get active(): boolean {
    return this.active_;
  }

  activate(): void {
    this.active_ = true;
  }

  deactivate(): void {
    this.active_ = false;
  }

  mint(options: MintOptions): AuthorityToken {
    const nonce = randomUUID();
    const commandDigest = computeDigest(options.toolName, options.args);
    const now = this.clock();

    return {
      sessionId: this.sessionId,
      commandDigest,
      expiryMs: now + options.maxAgeMs,
      source: 'voice',
      speakerVerified: options.speakerVerified ?? false,
      nonce,
    };
  }

  validate(token: AuthorityToken, actualToolName: string, actualArgs: Record<string, unknown>): { ok: true } | { ok: false; reason: AuthorityRejectionReason } {
    if (!this.active_) return { ok: false, reason: AuthorityRejectionReason.Inactive };

    if (!token || typeof token !== 'object') {
      return { ok: false, reason: AuthorityRejectionReason.InvalidToken };
    }

    if (token.sessionId !== this.sessionId) {
      return { ok: false, reason: AuthorityRejectionReason.InvalidToken };
    }

    if (token.source !== 'voice') {
      return { ok: false, reason: AuthorityRejectionReason.PointerOrigin };
    }

    if (this.clock() > token.expiryMs) {
      return { ok: false, reason: AuthorityRejectionReason.Expired };
    }

    if (this.usedNonces.has(token.nonce)) {
      return { ok: false, reason: AuthorityRejectionReason.Replayed };
    }

    if (typeof token.commandDigest !== 'string' || !token.commandDigest) {
      return { ok: false, reason: AuthorityRejectionReason.InvalidToken };
    }

    const expectedDigest = computeDigest(actualToolName, actualArgs);
    if (!timingSafeEqual(Buffer.from(token.commandDigest), Buffer.from(expectedDigest))) {
      return { ok: false, reason: AuthorityRejectionReason.Altered };
    }

    if (!token.speakerVerified) {
      return { ok: false, reason: AuthorityRejectionReason.SpeakerUnverified };
    }

    this.usedNonces.add(token.nonce);
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
  return JSON.stringify(value, Object.keys(value as object).sort());
}
