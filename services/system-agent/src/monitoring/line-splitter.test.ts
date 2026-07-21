import { LIMITS } from '@deskpulse/contracts';
import { describe, expect, it } from 'vitest';

import { LineSplitter } from './line-splitter.js';

describe('LineSplitter', () => {
  it('emits complete lines and holds the trailing partial', () => {
    const s = new LineSplitter();
    expect(s.push(Buffer.from('one\ntwo\nthr'))).toEqual([
      { text: 'one', byteLength: 4, truncated: false },
      { text: 'two', byteLength: 4, truncated: false },
    ]);
    // "thr" is buffered; completes on the next push
    expect(s.push(Buffer.from('ee\n')).map((l) => l.text)).toEqual(['three']);
  });

  it('reports exact byte lengths including the newline', () => {
    const s = new LineSplitter();
    const [line] = s.push(Buffer.from('hello\n'));
    expect(line).toEqual({ text: 'hello', byteLength: 6, truncated: false });
  });

  it('strips a trailing CR so CRLF logs render cleanly, but counts its bytes', () => {
    const s = new LineSplitter();
    const [line] = s.push(Buffer.from('win\r\n'));
    expect(line?.text).toBe('win');
    expect(line?.byteLength).toBe(5); // 'win' + \r + \n
  });

  it('decodes a multibyte character split across two pushes', () => {
    const s = new LineSplitter();
    const euro = Buffer.from('€', 'utf8'); // 3 bytes: e2 82 ac
    expect(s.push(euro.subarray(0, 1))).toEqual([]);
    expect(s.push(euro.subarray(1))).toEqual([]);
    const [line] = s.push(Buffer.from('\n'));
    expect(line?.text).toBe('€');
    expect(line?.byteLength).toBe(4); // 3 bytes + newline
  });

  it('force-flushes a line longer than the 32 KiB cap as truncated segments', () => {
    const s = new LineSplitter();
    const huge = 'x'.repeat(LIMITS.maxLineLengthBytes + 100);
    const lines = s.push(Buffer.from(`${huge}\n`));
    expect(lines[0]?.truncated).toBe(true);
    expect(lines[0]?.byteLength).toBe(LIMITS.maxLineLengthBytes);
    // remainder + newline forms the final (non-truncated) piece
    expect(lines[lines.length - 1]?.truncated).toBe(false);
    expect(lines.map((l) => l.text).join('')).toBe(huge);
  });

  it('handles an empty line (bare newline)', () => {
    const s = new LineSplitter();
    expect(s.push(Buffer.from('\n')).map((l) => l.text)).toEqual(['']);
  });

  it('decodes latin1 when configured', () => {
    const s = new LineSplitter('latin1');
    const [line] = s.push(Buffer.from([0xe9, 0x0a])); // é in latin1
    expect(line?.text).toBe('é');
  });
});
