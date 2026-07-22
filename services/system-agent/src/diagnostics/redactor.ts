import { Transform } from 'node:stream';

/**
 * Secret redaction for diagnostic bundles (PDD §27, FR-23). A best-effort,
 * line-oriented filter applied ONLY to DeskPulse's own logs and health history
 * — never to user-selected logs, whose formats we can't know (§27). Patterns
 * become `[REDACTED:<kind>]`. Pure per-line function + a streaming Transform so
 * multi-MiB logs are never buffered whole.
 */

interface Rule {
  pattern: RegExp;
  replace: string;
}

// Order matters: the Authorization header rule swallows the whole value first
// (including any inline "Bearer …"), so the standalone Bearer rule only catches
// bearer tokens that appear outside a header.
const RULES: Rule[] = [
  { pattern: /(Authorization:\s*)([^\r\n"',}]+)/gi, replace: '$1[REDACTED:auth-header]' },
  { pattern: /Bearer\s+[A-Za-z0-9._~+/-]+=*/g, replace: 'Bearer [REDACTED:bearer]' },
  {
    pattern: /\b(password|token|secret|api[_-]?key)=([^&\s"']+)/gi,
    replace: '$1=[REDACTED:secret]',
  },
  { pattern: /AKIA[0-9A-Z]{16}/g, replace: '[REDACTED:aws-key]' },
];

/** Redact one line (no trailing newline). Safe to call on any string. */
export function redactLine(line: string): string {
  let out = line;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
}

/**
 * A Transform that redacts UTF-8 text line by line, carrying a partial trailing
 * line between chunks so a secret split across a chunk boundary is still caught.
 */
export function createRedactStream(): Transform {
  let carry = '';
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const text = carry + chunk.toString('utf8');
      const lastNewline = text.lastIndexOf('\n');
      if (lastNewline === -1) {
        carry = text;
        callback(null, '');
        return;
      }
      const complete = text.slice(0, lastNewline + 1);
      carry = text.slice(lastNewline + 1);
      const redacted = complete.split('\n').map(redactLine).join('\n');
      callback(null, redacted);
    },
    flush(callback) {
      callback(null, carry ? redactLine(carry) : '');
    },
  });
}
