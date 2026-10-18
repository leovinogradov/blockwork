# Navigation input decisions

Blockwork supports a mouse and trackpad in the same session without choosing or saving an active device. In 3D, pinch and mouse-wheel scroll zoom; a two-finger click held while dragging pans; a two-finger slide rotates with or without Shift. Sketches stay top-down, so recognized trackpad slides pan in 2D. The Orbit, Pan, and Zoom buttons remain explicit actions for one-finger dragging.

## Detection and mouse-wheel preference

Browsers deliver both wheel scrolling and trackpad sliding as [`wheel` events](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event). The app infers the action from the event and a short history. These thresholds are local design choices, not hardware identifiers. Ambiguity favors zoom to reduce accidental rotation from a mouse wheel.

The rules in [wheel-gesture.ts](../src/wheel-gesture.ts) run in this order:

| Evidence | Decision |
| --- | --- |
| Ctrl/Meta flag, or line/page units | Zoom immediately. Ctrl-wheel and a browser-reported pinch intentionally share this action. |
| Optional legacy tick near a nonzero multiple of 120, or pixel magnitude near a multiple of 100 or 120 | Zoom immediately, even during trackpad input. Horizontal wheel and Shift-wheel ticks follow this rule too. |
| Horizontal pixel movement above 0.01 pixels, without the preceding wheel signals | Orbit immediately. `deltaX` has strong weight; tiny axis noise is ignored. |
| Untagged vertical pixel movement | Inspect three consecutive samples in the same direction, no more than 35 ms apart. Keep at most three samples and expire history after 120 ms. |
| Two vertical magnitudes in the same direction forming repeated or integer-multiple steps within a 1% ratio tolerance, at most 120 ms apart | Resolve as zoom on the second event, including small fractional steps and slower mouse-wheel ticks. |
| A vertical wheel burst already resolved by matching steps or the bounded fallback | Zoom immediately while consecutive events remain within 120 ms, including acceleration and direction changes. Horizontal slides clear this short-lived confidence. |
| Both adjacent magnitude changes are at least 10%, and neither pair forms integer-multiple steps | Resolve as orbit and replay the buffered prefix as orbit. |
| Insufficient or conflicting vertical evidence | Buffer for up to 75 ms, then zoom. The queue is limited to 16 events. |

Small values, fractional values, and non-120 legacy ticks do not establish trackpad input by themselves. Until zoom is confirmed, a pause over 35 ms or a reversal starts a fresh vertical candidate unless a repeated wheel step resolves it first; the older unresolved prefix resolves as zoom. A pause over 120 ms expires confirmed wheel confidence. Optional legacy values provide supplemental mouse evidence because they are [deprecated and vary across browsers](https://developer.mozilla.org/en-US/docs/Web/API/Element/mousewheel_event).

## Interleaved devices and cancellation

There is no sticky trackpad classification. Clear wheel and pinch events always zoom immediately and do not enter the vertical sample history or establish wheel-burst confidence by themselves. This lets a wheel tick occur between trackpad samples without borrowing the trackpad's action. Horizontal input also acts independently; it clears vertical classification evidence without turning an unrelated buffered vertical prefix into orbit. A newly repeated vertical sequence can resolve back to zoom.

Buffered input is canceled before pointer gestures, navigation-tool changes, Fit or standard-view actions, projection replacement, window blur, and disposal. This prevents delayed camera movement after selecting, drawing, changing views, or leaving the viewport. Consumed wheel events are canceled immediately with a non-passive handler while classification is pending. Secondary-click and context-menu defaults are canceled within the viewport; Firefox's [reserved Shift-right-click override](https://developer.mozilla.org/en-US/docs/Web/API/Element/contextmenu_event) can still show the browser menu. A plain right-click retains the app's face actions.

## Limits and verification

A smooth mouse wheel can emit the same varying stream as a trackpad, and a trackpad can emit repeated wheel-like steps. Interleaving two indistinguishable streams cannot be resolved perfectly without a browser-provided device identity. Such input can zoom instead of rotate, or rotate instead of zoom; the mouse preference reduces false trackpad decisions but cannot eliminate them. Vertical trackpad input immediately after a confirmed wheel burst also zooms until a pause or horizontal slide clears confidence. Large trackpad deltas that match recognized wheel increments also favor zoom.

[Classifier tests](../tests/wheel-gesture.test.ts) cover horizontal evidence, wheel precedence, repeated fractional steps, vertical cadence, reversals, and expiry. [Camera tests](../tests/navigation-controls.test.ts) interleave a mouse wheel between vertical trackpad samples, verify cursor-anchored zoom and unchanged orbit distance, and check bounded fallback and cancellation for both projections. [Browser checks](../tests/viewport-input.html) verify the Shift alias, click-and-drag pan, menu cancellation, selection preservation, and pending-input cancellation. Synthetic events verify routing and camera behavior; physical devices and browser-specific input traces still need hardware testing when tuning the thresholds.
