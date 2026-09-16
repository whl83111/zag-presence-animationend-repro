<!---
Thanks for creating an issue 😄!

Please search open/closed issues before submitting. Someone
might have asked the same thing before 😉!

Please fill out all of the sections of this template marked as REQUIRED! We
ask for this information because we need it in order to understand your issue
and quickly diagnose it or provide a solution. Failure to provide the
required information will result in your issue being closed.

We're all volunteers here, so help us help you by taking the time to
accurately fill out this template. ❤️
-->

# 🐛 Bug report

<!-- REQUIRED: Provide a brief description of your bug below -->

**How we found it.** Our Playwright e2e suite runs on GitHub Actions against Chromium, Firefox and WebKit. On WebKit only, and only on slow nights, tests started failing after closing an Ark UI popover or combobox: the closed panel stayed in the DOM at `opacity: 0` and intercepted every later click. The same tests never failed locally. The investigation below, the reproduction and the proposed fix were worked out with an AI assistant (Claude Code). I reproduced it by hand in Safari; the Playwright and container numbers below are from the assistant's runs on my machine, which I reviewed.

In WebKit, a presence-controlled element with a CSS exit `animation` can stay mounted forever after `present` turns false: `data-state="closed"`, `opacity: 0` held by the `animation-fill-mode: forwards` the machine sets, still hit-testable.

The machine attaches its `animationend` listener inside a `requestAnimationFrame` callback (`syncPresence` → `raf(...)` → `UNMOUNT.SUSPEND` → `trackAnimationEvents`, named `trackExitAnimation` on `main`) and never checks whether the animation already finished. WebKit gives every animation created during one task the timeline time cached for that task as its start time ([`AnimationTimelinesController::cacheCurrentTime`](https://github.com/WebKit/WebKit/blob/e887d63b2279cb6d55355d649fc5f42e7322ab1f/Source/WebCore/animation/AnimationTimelinesController.cpp#L349-L382)). So when a task after the closing commit resolves the element's style (`getComputedStyle`, `getBoundingClientRect`, `getAnimations`) and the next frame arrives later than the exit duration, WebKit dispatches `animationstart` and `animationend` in that one frame, before frame callbacks. The listener is attached after both events and nothing unmounts the element.

Both conditions are routine in end-to-end tests: every Playwright visibility assertion does the style read, and a loaded CI runner supplies the late frame.

## 💥 Steps to reproduce

<!-- REQUIRED -->

```bash
git clone https://github.com/whl83111/zag-presence-animationend-repro && cd zag-presence-animationend-repro
pnpm install && pnpm exec playwright install webkit
pnpm dev                # in a second terminal
pnpm probe              # stranded
READ=none pnpm probe    # control without the style read: unmounts
BLOCK=50 pnpm probe     # control with the next frame less than 100ms late: unmounts
```

`probe.mjs` clicks Close, reads `getComputedStyle(panel).animationName` in the same task, then keeps that task busy for 300ms so the next frame is late. The busy loop stands in for a slow machine; the probe's init script only logs events and does not change any behaviour. Output (WebKit 26.6):

```
 729 closed; style read: animation-name=fade-out
1033 task ends
1034 animationstart (fade-out)
1034 animationend (fade-out)
1034 zag attaches its animationend listener   <- nothing unmounts the panel after this
```

By hand in Safari: click **Open**, then **Close + simulate a slow e2e frame**. That button does the same three steps inside the page (`closeLikeAnE2eRun` in `src/App.tsx`). "Panel in DOM" stays **yes**. After plain **Close**, or either button in Chrome or Firefox, it turns **no** once the 100ms exit ends. Playwright's WebKit 26.6 strands on every click; Safari 27.0 strands on about 4 clicks in 5. Add `?debug` to see the event order: in the runs that unmount, `animationstart` lands on the next frame and the listener is in time. My reading of the WebKit source: the cached time is cleared by a one-shot timer of one frame interval, and a pending animation only gets the cached time if its processing task runs before that timer, so which of the two runs first after a long task decides the outcome.

## 💻 Link to reproduction

<!--
REQUIRED

Create a minimal reproduction in CodeSandbox.
-->

StackBlitz (open it in Safari, click **Open**, then **Close + simulate a slow e2e frame**): https://stackblitz.com/github/whl83111/zag-presence-animationend-repro

Static build of the same page, no editor around it: https://whl83111.github.io/zag-presence-animationend-repro/

Repository with the Playwright scripts: https://github.com/whl83111/zag-presence-animationend-repro

`src/App.tsx` is `@zag-js/presence` driven through `@zag-js/react` the way Ark UI's `usePresence` does it, with `unmountOnExit`; one panel, one 100ms `fade-out` on `[data-state="closed"]`.

## 🧐 Expected behavior

<!-- Explain what you expected to happen -->

The element unmounts after its exit animation, whatever the frame timing.

## 🧭 Possible Solution

<!-- Not required, but feel free to suggest a possible solution below if you
have one in mind. -->

In `syncPresence`'s frame callback, before sending `UNMOUNT.SUSPEND`, check `node.getAnimations()` for a running animation whose name matches the computed `animation-name`; when none is running, send `UNMOUNT` directly. Environments without the Web Animations API keep the current behaviour. With this change applied to a local build of 1.44.0, every run above unmounts in WebKit, Chromium and Firefox. I have the patch with unit tests ready and can open a PR if you want it.

## 🌍 System information

<!-- REQUIRED -->

| Software         | Version(s) |
| ---------------- | ---------- |
| Zag Version      | `@zag-js/presence` 1.41.2; same code path on `main` (1.44.0) and in the published 2.0.0-next.3 |
| Browser          | WebKit 26.6 (Playwright 1.63) and Safari 27.0; not Chromium 153, not Firefox 155 |
| Operating System | macOS 26.6 and the Playwright `v1.63.0-noble` Linux image |

## 🧢 Your Company/Team

<!-- Optional: Which company or team is this bug impacting? (e.g., Acme/Dashboard) -->

## 📝 Additional information

<!-- Use this section to provide any additional information you might have,
like screenshots, notes, or links to ideas. -->

- A sibling of this was fixed in `@zag-js/presence` 0.75.0 ([571a30d](https://github.com/chakra-ui/zag/commit/571a30d7ce6729b0885e65c2d044f8b2684cb5a9)): an element stuck in the unmount state when the tab was hidden. This is the same state, missing the event a different way.
- Chromium resolves a pending animation's start time at the frame, and Firefox dispatches animation events after frame callbacks, so neither is affected (see the probe output for both).
- I have not filed this with WebKit. Its behaviour may be a spec-allowed choice (a document timeline's current time is fixed within a task), and the machine should not depend on event order either way. Chromium and Firefox happen to order things so that the listener is in time.
- The app is on Ark UI React 5.37.2 (Popover, Combobox, Dialog). In one CI run every exit stranded: a popover, a combobox list and a nested popover.
- `natural.mjs` in the repository is the same flow with no stand-ins (real clicks, a `toBeHidden` assertion, no busy loop), run in the Playwright Linux image under a CPU quota (`container.sh`). Stock presence at 0.1 CPU: WebKit 4/15 rounds stranded, Chromium 0/10, Firefox 0/10 (at 0.3 CPU); WebKit at 2 CPUs 0/10; WebKit at 0.1 CPU with the fix 0/15.
