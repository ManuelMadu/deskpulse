import { LIMITS } from '@deskpulse/contracts';

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

export interface SplitLine {
  text: string;
  /** Raw bytes this line consumed from the file, including its newline. */
  byteLength: number;
  /** True when a >32 KiB line was force-flushed without a newline (FR-7). */
  truncated: boolean;
}

/**
 * Splits a byte stream into lines. Operates on raw bytes, not decoded text:
 * 0x0A never appears inside a UTF-8 multibyte sequence, so newline splitting
 * is encoding-safe, and carrying raw bytes across reads means a multibyte
 * character split across a read boundary decodes correctly once its line
 * completes (PDD §24). Byte lengths are exact, so file offsets stay accurate.
 */
export class LineSplitter {
  private carry: Buffer = Buffer.alloc(0);
  private readonly maxBytes = LIMITS.maxLineLengthBytes;

  constructor(private readonly encoding: 'utf8' | 'latin1' = 'utf8') {}

  push(chunk: Buffer): SplitLine[] {
    const lines: SplitLine[] = [];
    const data = this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk;
    let start = 0;

    for (;;) {
      const nl = data.indexOf(NEWLINE, start);
      if (nl === -1) {
        break;
      }
      this.emitComplete(lines, data.subarray(start, nl));
      start = nl + 1;
    }

    let remaining = start === 0 ? data : data.subarray(start);

    // Unterminated carry longer than the cap: force-flush cap-sized truncated
    // segments so a giant line without a newline can never grow the carry
    // without bound (FR-7). The tail stays buffered for the next push.
    while (remaining.length > this.maxBytes) {
      lines.push({
        text: this.decode(remaining.subarray(0, this.maxBytes)),
        byteLength: this.maxBytes,
        truncated: true,
      });
      remaining = remaining.subarray(this.maxBytes);
    }

    // Copy: `remaining` is a view into `data`, reused on the next push.
    this.carry = Buffer.from(remaining);
    return lines;
  }

  /** Emit one newline-terminated segment, capping it if it exceeds 32 KiB. */
  private emitComplete(lines: SplitLine[], segment: Buffer): void {
    let seg = segment;
    while (seg.length > this.maxBytes) {
      lines.push({
        text: this.decode(seg.subarray(0, this.maxBytes)),
        byteLength: this.maxBytes,
        truncated: true,
      });
      seg = seg.subarray(this.maxBytes);
    }
    lines.push({
      text: this.decode(stripTrailingCr(seg)),
      byteLength: seg.length + 1, // + the newline byte
      truncated: false,
    });
  }

  private decode(raw: Buffer): string {
    return raw.toString(this.encoding);
  }
}

function stripTrailingCr(raw: Buffer): Buffer {
  return raw.length > 0 && raw[raw.length - 1] === CARRIAGE_RETURN
    ? raw.subarray(0, raw.length - 1)
    : raw;
}
