import { describe, expect, it } from 'vitest';

import { createRedactStream, redactLine } from './redactor.js';

describe('redactLine', () => {
  it.each([
    ['Authorization: Bearer abc.def.ghi', 'Authorization: [REDACTED:auth-header]'],
    ['authorization: Basic Zm9vOmJhcg==', 'authorization: [REDACTED:auth-header]'],
    ['sent Bearer eyJhbGciOi.JIUzI1_Ni-J9 to api', 'sent Bearer [REDACTED:bearer] to api'],
    ['GET /login?password=hunter2&next=/', 'GET /login?password=[REDACTED:secret]&next=/'],
    ['token=deadbeef secret=s3cr3t', 'token=[REDACTED:secret] secret=[REDACTED:secret]'],
    ['api_key=ABC123 api-key=XYZ', 'api_key=[REDACTED:secret] api-key=[REDACTED:secret]'],
    ['creds AKIAIOSFODNN7EXAMPLE end', 'creds [REDACTED:aws-key] end'],
  ])('redacts %s', (input, expected) => {
    expect(redactLine(input)).toBe(expected);
  });

  it.each([
    'the password reset email was sent', // "password" without =value
    'authorization is required for this route', // no colon+value
    'a bearer of good news', // "bearer" not followed by a token
    'AKIASHORT and AKIA123 are too short', // not 16 trailing chars
    'GET /api 200 12ms',
  ])('leaves non-secret text untouched: %s', (line) => {
    expect(redactLine(line)).toBe(line);
  });

  it('redacts multiple secrets on one line and preserves surrounding text', () => {
    expect(redactLine('user=bob password=p@ss token=t0k done')).toBe(
      'user=bob password=[REDACTED:secret] token=[REDACTED:secret] done',
    );
  });
});

describe('createRedactStream', () => {
  async function run(chunks: string[]): Promise<string> {
    const stream = createRedactStream();
    const out: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => out.push(Buffer.from(chunk)));
    for (const chunk of chunks) {
      stream.write(Buffer.from(chunk, 'utf8'));
    }
    await new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
      stream.end();
    });
    return Buffer.concat(out).toString('utf8');
  }

  it('redacts a multi-line stream and preserves line structure', async () => {
    const input = 'line one\nAuthorization: Bearer xyz\npassword=secret\nlast line no newline';
    expect(await run([input])).toBe(
      'line one\nAuthorization: [REDACTED:auth-header]\npassword=[REDACTED:secret]\nlast line no newline',
    );
  });

  it('catches a secret split across chunk boundaries', async () => {
    // "password=hunter2" arrives split mid-value across two writes.
    expect(await run(['first line\npass', 'word=hunter2\n'])).toBe(
      'first line\npassword=[REDACTED:secret]\n',
    );
  });
});
