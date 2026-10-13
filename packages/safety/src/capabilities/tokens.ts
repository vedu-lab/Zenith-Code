import crypto from 'node:crypto';
import { CapabilityToken, IssueTokenOptions } from './types.js';

export class TokenSigner {
  private readonly secretKey: Buffer;

  constructor(secretKey?: Buffer) {
    this.secretKey = secretKey ?? crypto.randomBytes(32);
  }

  signTokenData(payload: string): string {
    return crypto.createHmac('sha256', this.secretKey).update(payload).digest('hex');
  }

  createPayload(
    id: string,
    resourcePattern: string,
    action: string,
    scope: string,
    taskId: string | undefined,
    expiresAtMs: number,
    maxUses: number,
    issuer: string,
  ): string {
    return `${id}|${resourcePattern}|${action}|${scope}|${taskId ?? ''}|${expiresAtMs}|${maxUses}|${issuer}`;
  }

  issueToken(options: IssueTokenOptions, nowMs = Date.now()): CapabilityToken {
    const id = `cap_${nowMs}_${crypto.randomBytes(6).toString('hex')}`;
    const scope = options.scope ?? 'task';
    const expiresAtMs = nowMs + (options.ttlMs ?? 5 * 60 * 1000); // 5 minutes default
    const maxUses = options.maxUses ?? Number.POSITIVE_INFINITY;

    const payload = this.createPayload(
      id,
      options.resourcePattern,
      options.action,
      scope,
      options.taskId,
      expiresAtMs,
      maxUses,
      options.issuer,
    );
    const signature = this.signTokenData(payload);

    return {
      id,
      resourcePattern: options.resourcePattern,
      action: options.action,
      scope,
      taskId: options.taskId,
      expiresAtMs,
      maxUses,
      remainingUses: maxUses,
      issuer: options.issuer,
      signature,
    };
  }

  verifySignature(token: CapabilityToken): boolean {
    const payload = this.createPayload(
      token.id,
      token.resourcePattern,
      token.action,
      token.scope,
      token.taskId,
      token.expiresAtMs,
      token.maxUses,
      token.issuer,
    );
    const expected = this.signTokenData(payload);
    // Constant-time comparison to prevent timing attacks
    return (
      expected.length === token.signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token.signature))
    );
  }

  isExpired(token: CapabilityToken, nowMs = Date.now()): boolean {
    return nowMs > token.expiresAtMs || token.remainingUses <= 0;
  }
}
