import { describe, expect, it } from 'vitest';

import { errnoToError } from './errno.js';

describe('errnoToError', () => {
  it('maps the filesystem errnos the tailer and watch endpoint care about', () => {
    expect(errnoToError({ code: 'ENOENT' }).code).toBe('FILE_NOT_FOUND');
    expect(errnoToError({ code: 'EACCES' }).code).toBe('PERMISSION_DENIED');
    expect(errnoToError({ code: 'EPERM' }).code).toBe('PERMISSION_DENIED');
    expect(errnoToError({ code: 'EISDIR' }).code).toBe('NOT_A_FILE');
    expect(errnoToError({ code: 'EBUSY' }).code).toBe('FILE_BUSY');
    expect(errnoToError({ code: 'EMFILE' }).code).toBe('INTERNAL');
  });

  it('marks permission and busy errors retryable, not-found not', () => {
    expect(errnoToError({ code: 'EACCES' }).retryable).toBe(true);
    expect(errnoToError({ code: 'EBUSY' }).retryable).toBe(true);
    expect(errnoToError({ code: 'ENOENT' }).retryable).toBe(false);
  });

  it('collapses unknown errors to INTERNAL with a generic message', () => {
    const shape = errnoToError({ code: 'EWEIRD' });
    expect(shape.code).toBe('INTERNAL');
    expect(shape.message).not.toContain('EWEIRD');
  });

  it('carries errno and path in details but keeps the message safe', () => {
    const shape = errnoToError({ code: 'EACCES', path: '/var/log/secret.log' });
    expect(shape.details).toMatchObject({ errno: 'EACCES', path: '/var/log/secret.log' });
  });
});
