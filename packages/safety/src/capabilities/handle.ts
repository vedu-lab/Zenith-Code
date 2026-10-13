import { ToolActionIntent } from '@forge/core';
import { ICapabilityHandle, CapabilityAction, CapabilityToken } from './types.js';
import { TokenSigner } from './tokens.js';

export class CapabilityHandle implements ICapabilityHandle {
  private consumed = false;

  constructor(
    readonly token: CapabilityToken,
    readonly action: CapabilityAction,
    readonly target: string,
    readonly intent: ToolActionIntent,
    private readonly signer: TokenSigner,
  ) {}

  get tokenId(): string {
    return this.token.id;
  }

  isValid(): boolean {
    if (!this.signer.verifySignature(this.token)) {
      return false;
    }
    if (this.signer.isExpired(this.token)) {
      return false;
    }
    return true;
  }

  consume(): boolean {
    if (this.consumed && this.token.maxUses !== Number.POSITIVE_INFINITY) {
      return false;
    }
    if (!this.isValid()) {
      return false;
    }

    if (this.token.remainingUses > 0) {
      this.token.remainingUses--;
      this.consumed = true;
      return true;
    }

    return false;
  }
}
