/**
 * A transient status line for the verbs that cannot answer instantly.
 *
 * `gossip` and `standup` crawl every agent journal on the machine and then wait
 * on a model before a single byte of the answer exists. That is ten to twenty
 * seconds of nothing on screen, during which working and wedged look exactly
 * the same — and the tool that looks wedged is the one that gets ^C'd and then
 * stops being reached for at all.
 *
 * Writes to stderr, and only when stderr is a terminal. Piped, redirected and
 * agent-captured output stays byte-identical to before: the status line exists
 * for the person watching, and there is nobody watching a pipe.
 */

export interface StatusLine {
  /** Replace the current status with `msg`. No-op when not attached to a terminal. */
  show(msg: string): void;
  /** Erase the status line. Safe to call when nothing is showing. */
  clear(): void;
}

const NO_STATUS: StatusLine = { show() {}, clear() {} };

export function createStatusLine(stream: NodeJS.WriteStream = process.stderr): StatusLine {
  if (!stream.isTTY) return NO_STATUS;

  let showing = false;
  return {
    show(msg: string) {
      // \r to column 0, then erase the whole line, so a shorter message never
      // leaves the tail of a longer one behind.
      stream.write(`\r\x1b[2K\x1b[2m⋯ ${msg}\x1b[0m`);
      showing = true;
    },
    clear() {
      if (!showing) return;
      stream.write('\r\x1b[2K');
      showing = false;
    },
  };
}
