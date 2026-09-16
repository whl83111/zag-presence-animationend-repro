import * as presence from '@zag-js/presence';
import { normalizeProps, useMachine } from '@zag-js/react';
import { useEffect, useState } from 'react';

const PANEL = '[data-testid="panel"]';
const debug = new URLSearchParams(location.search).has('debug');
const log: string[] = [];
let showLog = () => {};
const note = (text: string) => {
  log.push(`${performance.now().toFixed(0).padStart(6)} ${text}`);
  showLog();
};

export function App(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [inDom, setInDom] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  showLog = () => setLines([...log]);

  useEffect(() => {
    const observer = new MutationObserver(() => setInDom(document.querySelector(PANEL) !== null));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // The two conditions in one task: a style read after the closing commit, then a late next frame (WebKit only).
  async function closeLikeAnE2eRun(): Promise<void> {
    const panel = document.querySelector(PANEL);
    if (!(panel instanceof HTMLElement)) return;
    setOpen(false);
    while (panel.dataset.state !== 'closed') await Promise.resolve(); // React 19 commits the discrete update in a microtask
    note(`closed; style read: animation-name=${getComputedStyle(panel).animationName}`); // what every e2e visibility assertion does
    const end = performance.now() + 300;
    while (performance.now() < end) {} // stands in for a slow machine's late frame
    note('task ends');
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <style>{`
        @keyframes fade-out { from { opacity: 1 } to { opacity: 0 } }
        ${PANEL} { background: white; border: 1px solid #888; padding: 16px; margin-top: 16px; width: 200px; }
        ${PANEL}[data-state="closed"] { animation: fade-out 100ms; }
      `}</style>

      <p data-testid="status">Panel in DOM: {inDom ? 'yes' : 'no'}</p>
      <button onClick={() => setOpen(true)}>Open</button> <button data-testid="close" onClick={() => setOpen(false)}>Close</button>{' '}
      <button data-testid="close-e2e" onClick={closeLikeAnE2eRun}>Close + simulate a slow e2e frame</button>

      <Panel open={open} />
      {debug && <pre data-testid="log">{lines.join('\n')}</pre>}
    </main>
  );
}

// The presence machine driven the way Ark UI's `usePresence` drives it, with `unmountOnExit`.
function Panel({ open }: { open: boolean }): React.JSX.Element | null {
  const service = useMachine(presence.machine, { present: open });
  const api = presence.connect(service, normalizeProps);
  if (!api.present) return null;
  return (
    <div ref={api.setNode} data-testid="panel" data-state={open ? 'open' : 'closed'}>
      Panel
    </div>
  );
}

// ?debug: record the panel's animation events and the moment zag attaches its `animationend` listener. Log only.
if (debug) {
  const isPanel = (n: EventTarget | null) => n instanceof HTMLElement && n.matches(PANEL);
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === 'animationend' && isPanel(this)) note('zag attaches its animationend listener');
    return add.call(this, type, ...rest);
  };
  for (const type of ['animationstart', 'animationend']) {
    document.addEventListener(type, (e) => e instanceof AnimationEvent && isPanel(e.target) && note(`${e.type} (${e.animationName})`), true);
  }
}
