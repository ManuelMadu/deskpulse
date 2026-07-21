// Strips ANSI escape sequences before display (PDD §30 threat 3). Log content
// is always rendered as text, never HTML; this only removes terminal control
// codes so colored logs read cleanly.
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}
