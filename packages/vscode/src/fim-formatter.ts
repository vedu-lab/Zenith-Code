import { FimModelFamily, FimPrompt } from './types.js';

export function formatFimPrompt(
  prefix: string,
  suffix: string,
  modelFamily: FimModelFamily,
): FimPrompt {
  let prompt = '';

  switch (modelFamily) {
    case 'qwen':
      // Qwen2.5-Coder FIM prompt template
      prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
      break;

    case 'deepseek':
      // DeepSeek-Coder FIM prompt template
      prompt = `<｜fim begin｜>${prefix}<｜fim hole｜>${suffix}<｜fim end｜>`;
      break;

    case 'starcoder':
      // StarCoder / StarCoder2 FIM prompt template
      prompt = `<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>`;
      break;

    case 'generic':
    default:
      // Generic cloud fallback
      prompt = `/* Language: code completion */\n/* Prefix: */\n${prefix}\n/* Suffix: */\n${suffix}\n/* Insert completion here */\n`;
      break;
  }

  return {
    prefix,
    suffix,
    prompt,
    modelFamily,
  };
}

const STOP_PATTERNS: readonly RegExp[] = [
  /<\|fim_prefix\|>/g,
  /<\|fim_suffix\|>/g,
  /<\|fim_middle\|>/g,
  /<\|endoftext\|>/g,
  /<\|im_end\|>/g,
  /<｜fim begin｜>/g,
  /<｜fim hole｜>/g,
  /<｜fim end｜>/g,
  /<\|EOT\|>/g,
  /<fim_prefix>/g,
  /<fim_suffix>/g,
  /<fim_middle>/g,
  /<file_sep>/g,
];

export function cleanFimCompletion(rawText: string): string {
  let cleaned = rawText;
  for (const pattern of STOP_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}
