// The screen stays on while the chat is on: a hands-free chat has no taps, and a phone that locks
// sends the page to the background, where iOS cuts the mic. Ported from Chatty's main.ts: the
// Screen Wake Lock can be refused (Low Power Mode, iOS Home Screen apps before 18.4, no gesture
// yet) or revoked by the system, so while it's wanted it is asked for again on release, when the
// page is visible again, on the next tap, and every 5 s.

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener?(type: 'release', listener: () => void): void;
}

const wakeLock = (): { request(type: 'screen'): Promise<WakeLockSentinelLike> } | undefined =>
  (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock;

let wanted = false;
let pending = false;
let sentinel: WakeLockSentinelLike | null = null;
let retryTimer = 0;
let listening = false;

const held = () => !!sentinel && !sentinel.released;

export function keepAwake(on: boolean): void {
  wanted = on;
  if (!listening) {
    listening = true;
    const retry = () => {
      if (wanted && !held()) keepAwake(true);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') retry();
    });
    // A gesture can succeed where an unprompted request was refused
    window.addEventListener('pointerdown', retry, { capture: true, passive: true });
  }
  if (on) {
    retryTimer ||= window.setInterval(() => {
      if (wanted && !held()) keepAwake(true);
    }, 5000);
    const lock = wakeLock();
    if (!lock || held() || pending || document.visibilityState !== 'visible') return;
    pending = true;
    lock
      .request('screen')
      .then((got) => {
        sentinel = got;
        // Asked again if the system takes it back while still wanted
        got.addEventListener?.('release', () => {
          if (sentinel === got) sentinel = null;
          if (wanted && document.visibilityState === 'visible') keepAwake(true);
        });
        if (!wanted) void got.release().catch(() => {});
      })
      .catch(() => {
        // Refused for now; asked again later
      })
      .finally(() => {
        pending = false;
      });
  } else {
    if (retryTimer) window.clearInterval(retryTimer);
    retryTimer = 0;
    const was = sentinel;
    sentinel = null;
    if (was) void was.release().catch(() => {});
  }
}
