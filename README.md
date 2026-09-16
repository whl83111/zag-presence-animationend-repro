# zag presence: WebKit ends the exit animation before zag listens for it

Upstream issue: https://github.com/chakra-ui/zag/issues/3349

`@zag-js/presence` 1.41.2 driven through `@zag-js/react` (logic unchanged in 1.44.0), React 19. `src/App.tsx`
drives the machine the way Ark UI's `usePresence` does, with `unmountOnExit`.

A closed element with a CSS exit `animation` unmounts only when the presence machine hears
`animationend`. The machine arms that listener inside a `requestAnimationFrame` callback and never
checks whether the animation already finished. When `animationend` fires before that callback, the
element stays mounted for good: `data-state="closed"`, `opacity: 0` held by
`animation-fill-mode: forwards`, still hit-testable.

WebKit gets there with plain page behaviour. It gives every animation created during one task the
timeline time cached for that task as its start time
([`AnimationTimelinesController::cacheCurrentTime`](https://github.com/WebKit/WebKit/blob/e887d63b2279cb6d55355d649fc5f42e7322ab1f/Source/WebCore/animation/AnimationTimelinesController.cpp#L349-L373)). Two things then have to happen:

1. After the commit that sets `data-state="closed"`, and before the next frame, some task resolves the
   element's style: `getComputedStyle`, `getBoundingClientRect`, `getAnimations`. Playwright does this
   on every visibility poll and every actionability check, so an e2e run does it after almost every close.
2. The next frame arrives later than the exit duration after that task. On a starved CI runner every
   frame is that late.

WebKit then dispatches `animationstart` and `animationend` in that one frame, both before frame
callbacks. zag arms its listener in the same frame's callback and nothing fires again. Chromium
resolves the start time at the frame, so the animation still has its full duration ahead. Firefox
dispatches animation events after frame callbacks, so the listener is there in time.

## Reproduce

```bash
pnpm install && pnpm exec playwright install chromium webkit firefox
pnpm dev
```

**1. See the event order (10 seconds, deterministic).**

```bash
pnpm probe                      # webkit; BROWSER=chromium|firefox for the others
READ=none pnpm probe            # control: same late frame, no style read
BLOCK=50 pnpm probe             # control: the next frame is late, but by less than the 100ms exit
```

`probe.mjs` closes the panel in one task, reads `getComputedStyle(panel).animationName`, then
keeps the task busy for `BLOCK` ms so the next frame arrives late. The busy loop is the one stand-in
for a slow machine; the style read is what any e2e assertion does. Nothing is patched.

By hand: open `http://localhost:5173/` (or the built page at https://whl83111.github.io/zag-presence-animationend-repro/) in Safari, click
**Open**, then **Close + simulate a slow e2e frame**. That button does the same three steps in the page. "Panel in DOM" stays **yes**; in Chrome or Firefox, and after
plain **Close** everywhere, it turns **no** once the 100ms exit ends. Add `?debug` to the URL to see the animation
events and the moment zag attaches its listener.
Playwright's WebKit 26.6 strands on every click; Safari 27.0 on about 4 in 5. In the runs that unmount, the
animation starts on the next frame instead: WebKit clears the cached time with a one-shot timer of one frame
interval, and whether that timer or the pending-animation task runs first after a long task decides it.

```
webkit 26.6 read=style block=300ms: mounted after 1.5s = 1 STRANDED
   729 closed; style read: animation-name=fade-out
  1033 task ends
  1034 animationstart (fade-out)
  1034 animationend (fade-out)
  1034 zag attaches its animationend listener
```

| stock `@zag-js/presence` 1.41.2 | webkit 26.6 | chromium 153 | firefox 155 |
|---|---|---|---|
| style read, frame 300ms late | stranded | ok | ok |
| no style read, frame 300ms late | ok | | |
| style read, frame 50ms late | ok | | |

**2. No stand-ins at all (a throttled container).** `natural.mjs` is a plain e2e flow: real clicks,
`expect(panel).toBeHidden()` for the style reads, no busy loop. The late frame comes from a CPU
quota. `container.sh` runs it in the Playwright Linux image; see its header for the commands. The page is
small, so the quota has to be tight before a frame is late enough.

| stock `@zag-js/presence` 1.41.2, 0.1 CPU | stranded |
|---|---|
| webkit 26.6, 15 rounds | 4/15 |
| chromium 153, 10 rounds | 0/10 |
| firefox 155, 10 rounds (0.3 CPU; it cannot keep up at 0.1) | 0/10 |
| webkit, 2 CPUs, 10 rounds | 0/10 |
| webkit, patched presence (fix below), 15 rounds | 0/15 |

With the patched presence, every row in both tables unmounts in all three browsers.

## Real-world instance

We hit this through Ark UI React 5.37.2 on GitHub Actions WebKit jobs: in one run every exit stranded,
a popover, a combobox list and a nested popover, and the closed panels kept intercepting clicks.

## Fix

`~/Projects/zag`, branch `fix/presence-finished-exit-animation`: in the frame callback, before
`UNMOUNT.SUSPEND`, check `node.getAnimations()` for a running animation whose name matches the
computed `animation-name`; when none is running, send `UNMOUNT`. To test it here, `pnpm pack` that
package and add to `package.json`:

```json
"pnpm": { "overrides": { "@zag-js/presence": "file:../zag/packages/machines/presence/zag-js-presence-1.44.0.tgz" } }
```

Earlier attempts and the investigation probes are on the `experiments` and `scratch/investigate`
branches. Load alone (stalls, jank, CPU throttle, a half-CPU container) never strands: the trigger
needs the style read between the commit and the late frame.
