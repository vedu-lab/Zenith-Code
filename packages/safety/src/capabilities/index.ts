import { z } from 'zod';

export const CapabilityTypeSchema = z.enum([
  'fs:read',
  'fs:write',
  'exec:command',
  'net:request',
  'state:modify',
]);

export type CapabilityType = z.infer<typeof CapabilityTypeSchema>;

export interface CapabilityGrant {
  readonly type: CapabilityType;
  readonly scope?: readonly string[];
  readonly description: string;
}

export class CapabilityManager {
  private readonly grants = new Map<CapabilityType, Set<string>>();

  grant(type: CapabilityType, scope = '*'): void {
    let scopes = this.grants.get(type);
    if (!scopes) {
      scopes = new Set();
      this.grants.set(type, scopes);
    }
    scopes.add(scope);
  }

  revoke(type: CapabilityType, scope = '*'): void {
    const scopes = this.grants.get(type);
    if (scopes) {
      scopes.delete(scope);
    }
  }

  hasCapability(type: CapabilityType, target?: string): boolean {
    const scopes = this.grants.get(type);
    if (!scopes) {
      return false;
    }
    if (scopes.has('*')) {
      return true;
    }
    if (!target) {
      return scopes.size > 0;
    }
    return scopes.has(target);
  }

  listGrants(): readonly CapabilityGrant[] {
    const result: CapabilityGrant[] = [];
    for (const [type, scopes] of this.grants.entries()) {
      result.push({
        type,
        scope: Array.from(scopes),
        description: `Granted capabilities for ${type}`,
      });
    }
    return result;
  }
}
