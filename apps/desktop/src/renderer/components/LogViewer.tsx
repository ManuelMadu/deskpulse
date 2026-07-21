import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { LogRow } from '../logs-store.js';
import type { ReactElement } from 'react';

const ROW_HEIGHT = 18;

/**
 * Virtualized log view (PDD §12, §18): renders only visible rows over the
 * 5,000-line ring buffer. Auto-scroll pins to the bottom until the user
 * scrolls up, then pauses so they can read; a filter narrows client-side.
 * Lines render as text — never HTML, no dangerouslySetInnerHTML.
 */
export function LogViewer({ rows, filter }: { rows: LogRow[]; filter: string }): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const visible = useMemo(() => {
    if (filter.trim() === '') {
      return rows;
    }
    const needle = filter.toLowerCase();
    return rows.filter((r) => r.kind === 'marker' || r.text.toLowerCase().includes(needle));
  }, [rows, filter]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // Auto-scroll to the newest row while pinned.
  useEffect(() => {
    if (pinned && visible.length > 0) {
      virtualizer.scrollToIndex(visible.length - 1, { align: 'end' });
    }
  }, [visible.length, pinned, virtualizer]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distanceFromBottom < ROW_HEIGHT * 2);
  };

  return (
    <div className="log-view" ref={scrollRef} onScroll={onScroll} data-testid="log-view">
      <div className="log-view-sizer" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = visible[item.index];
          if (!row) {
            return null;
          }
          return (
            <div
              key={row.key}
              className={row.kind === 'marker' ? 'log-row marker' : 'log-row'}
              style={{ transform: `translateY(${item.start}px)`, height: `${ROW_HEIGHT}px` }}
            >
              {row.text === '' ? ' ' : row.text}
            </div>
          );
        })}
      </div>
      {!pinned && (
        <button type="button" className="jump-latest" onClick={() => setPinned(true)}>
          Jump to latest ↓
        </button>
      )}
    </div>
  );
}
