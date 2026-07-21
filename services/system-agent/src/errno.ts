import { ERROR_CODES } from '@deskpulse/contracts';

import type { DeskPulseErrorShape, ErrorCode } from '@deskpulse/contracts';

interface NodeErrno {
  code?: string;
  errno?: number;
  path?: string;
}

/**
 * Maps Node filesystem errno codes to the structured error envelope (PDD §31).
 * One place, unit-tested, so every subsystem classifies EACCES/ENOENT/etc.
 * identically. Unknown errors collapse to INTERNAL with a generic message.
 */
export function errnoToError(
  error: unknown,
  context?: Record<string, unknown>,
): DeskPulseErrorShape {
  const err = error as NodeErrno;
  const code = err.code;

  let mapped: ErrorCode;
  let message: string;
  let retryable = false;

  switch (code) {
    case 'ENOENT':
      mapped = ERROR_CODES.FILE_NOT_FOUND;
      message = 'The file no longer exists.';
      break;
    case 'EACCES':
    case 'EPERM':
      mapped = ERROR_CODES.PERMISSION_DENIED;
      message =
        'This file requires elevated permissions; DeskPulse does not run privileged helpers.';
      retryable = true;
      break;
    case 'EISDIR':
      mapped = ERROR_CODES.NOT_A_FILE;
      message = 'That path is a directory, not a file.';
      break;
    case 'EBUSY':
      mapped = ERROR_CODES.FILE_BUSY;
      message = 'The file is busy.';
      retryable = true;
      break;
    case 'EMFILE':
    case 'ENFILE':
      mapped = ERROR_CODES.INTERNAL;
      message = 'Too many open files. Close some watches and try again.';
      break;
    default:
      mapped = ERROR_CODES.INTERNAL;
      message = 'An unexpected filesystem error occurred.';
      break;
  }

  const details: Record<string, unknown> = { ...context };
  if (code !== undefined) {
    details['errno'] = code;
  }
  if (err.path !== undefined) {
    details['path'] = err.path;
  }

  return {
    code: mapped,
    message,
    ...(Object.keys(details).length > 0 ? { details } : {}),
    retryable,
  };
}
