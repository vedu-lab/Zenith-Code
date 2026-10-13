export interface RedactionMatch {
  readonly secretType: string;
  readonly placeholder: string;
  readonly matchedLength: number;
}

export interface RedactionLogEntry {
  readonly timestamp: number;
  readonly secretType: string;
  readonly count: number;
}

export interface PrivacyConfig {
  readonly offline: boolean;
  readonly allowedEndpoints: readonly string[];
  readonly redactSecrets: boolean;
}
