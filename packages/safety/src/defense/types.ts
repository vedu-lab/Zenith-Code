export type InjectionSource = 'file_content' | 'tool_output' | 'mcp_description' | 'user_input';

export type InjectionSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface InjectionFinding {
  readonly patternName: string;
  readonly matchedText: string;
  readonly severity: InjectionSeverity;
  readonly description: string;
}

export interface InjectionInspectionResult {
  readonly hasInjection: boolean;
  readonly riskScore: number; // 0 to 100
  readonly findings: readonly InjectionFinding[];
  readonly sanitizedContent?: string | undefined;
}
