import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import type { RecentFile } from '@deskpulse/contracts';

const MRU_LIMIT = 10;

interface TokenEntry {
  realPath: string;
  displayPath: string;
}

/**
 * Maps opaque tokens to real filesystem paths (PDD §17). The renderer only
 * ever holds tokens, so it can never submit an arbitrary path. Tokens live in
 * memory only; the MRU list of paths is what persists (Phase 9), and tokens
 * are re-minted for MRU entries on demand.
 */
export class PathTokenRegistry {
  private readonly byToken = new Map<string, TokenEntry>();
  private readonly byPath = new Map<string, string>();
  private readonly mru: string[] = [];

  /** Mint (or reuse) a token for a real path and record it in the MRU. */
  register(realPath: string): { pathToken: string; displayPath: string } {
    const existing = this.byPath.get(realPath);
    const token = existing ?? randomUUID();
    const displayPath = realPath;
    if (!existing) {
      this.byToken.set(token, { realPath, displayPath });
      this.byPath.set(realPath, token);
    }
    this.touchMru(realPath);
    return { pathToken: token, displayPath };
  }

  resolve(pathToken: string): string | undefined {
    return this.byToken.get(pathToken)?.realPath;
  }

  recentFiles(): RecentFile[] {
    return this.mru.map((realPath) => {
      const token = this.byPath.get(realPath) ?? this.register(realPath).pathToken;
      return { pathToken: token, displayPath: basename(realPath) };
    });
  }

  private touchMru(realPath: string): void {
    const at = this.mru.indexOf(realPath);
    if (at !== -1) {
      this.mru.splice(at, 1);
    }
    this.mru.unshift(realPath);
    if (this.mru.length > MRU_LIMIT) {
      this.mru.length = MRU_LIMIT;
    }
  }
}
