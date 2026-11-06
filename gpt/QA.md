# ChatGPT Yada MacBook verification

## 4.1.7 toolbar fix — 2026-11-06

- Candidate branch: `work/gpt-yada-native-compat`; base commit `094abe4`. Implemented on the candidate branch; main was not changed.
- Updated `pageFacts.ts` to prefer the app-shell main titlebar's trailing action obstacle, exclude its clickable title from action discovery, and reject hidden duplicate buttons.
- Gates passed: 23 test files / 226 tests, `verify:copy`, build, `verify:gate`, `git diff --check`, package. Two regression tests cover the clickable title and waiting for unmounted actions.
- Package: `ChatGPT-Yada-v4.1.7-official-only-UNVERIFIED.zip`; SHA-256 `61598944c101d7b6bbf86b1279dcf8a7f0897a722368f2d9cb34abb2055ddf65`. The existing package suffix still reflects the independent official-navigation limitation below; the toolbar itself was verified live.
- Original installed ID `abdfkmhjbchcmblijimlonobmklkpkjg` is enabled at `/Users/harsonru/Documents/ChatGPT-Yada-v2.1.0`, manifest 4.1.7. Its files match the built dist; content SHA-256 `50b82833c09de4b350863e0d7096100d5bef5ffe42e544ba21534cc8b2e22fa4`.
- Edge's Reload resolved the old symlink into the deployment directory and temporarily generated a second ID, `mompcddmjbmceiaabmnefjnpjgkdlaoa`. That new copy was disabled and removed. The original Documents path is now a real directory so updates retain the original ID; its previous symlink and 4.1.6 files are backed up under `/Users/harsonru/.codex/tmp/yada-toolbar-20261106-4.1.6-backup/`. No original extension storage was removed or reset.
- One existing, empty-draft, non-streaming conversation was refreshed. At 1912px viewport width, one toolbar Host is positioned at (1572, 11.5), width 158px, 8px left of the actual right-side actions at x=1738. More, Share and summary-toggle center hit tests all reach their native buttons.
- Sidebar collapse retained right-side placement. Sidebar was restored to its original pinned-open state; prompt library opened and closed with existing entries present. Navigation briefly visited Home to access the sidebar pin and returned to the original conversation. No message was sent and no conversation created.
- Screenshot: `/Users/harsonru/Code/Sandbox-lab/yada-toolbar-20261106/fixed-4.1.7.jpg`.
- Raw CDP was used during diagnosis. After refresh, the browser bridge reported a paused-document-response restriction for raw CDP; final geometry and hit tests used its read-only DOM inspection API. No claim is made about live window resize, zoom, or official-navigator restoration in this fix.

## Historical 4.1.6 closeout

BRANCH = work/gpt-yada-native-compat
BASE_COMMIT = 4ca5e7a0c559aff53d430fc9f4e9e6d34a092c4e
HOST = HarsondeMBP (Harson 的 MacBook Pro)
EDGE = 153.0.4234.48 (installed runtime; page UA Edg/153.0.0.0)
EXTENSION_ID = abdfkmhjbchcmblijimlonobmklkpkjg
LOAD_PATH = /Users/harsonru/Documents/ChatGPT-Yada-v2.1.0
VERSION = 4.1.6
OFFICIAL_NAV_AUTO_RESTORE = BLOCKED
OFFICIAL_NAV_BOOTSTRAP_PATH = NONE
MAIN_UPDATED = NO
HOSTED_CI = NOT_USED_BY_POLICY

## Confirmed fixes and engineering evidence

- Toolbar cleans all owned duplicate Hosts before mounting. A two-host regression test and remount lifecycle tests verify one Host.
- pageFacts recognizes real User bubble / Assistant role marker / Timeline scroller. Stable IDs come from owning message containers, never body text. Generic overflow requires actual scroll range; negative scrollTop and overflow-anchor:none are supported.
- Stable available navigation parks independently from count completeness: 89/88 remains mismatch. Waiting does not block quota maintenance.
- Failed prepare no longer wakes from its own handshake ACK. A real request start/completion remains wake evidence.
- Zero-size anchors never start Floating UI layout. Shell/app unit tests isolate Floating UI asynchronous jsdom pipeline; toolbar suite dropped from 13.573 seconds to about 0.05 seconds. Baseline tests passed locally with exit 0 but the slow synchronous layout could starve worker updates. The prior worker timeout was not reproduced locally; its precise cause is not claimed proven. No timeout increase or error suppression.
- Sanitized live structure: test/fixtures/macbook-timeline-20260927.json (tags, attribute names, stable ID hashes, rectangles, state, counts; no chat bodies).

## Live blocker

The live sampled long conversation reports expectedPrompts=91. The saved previous probe reports 89, but its redacted records do not establish conversation identity; do not claim these are the same conversation. With 4.1.5 loaded in the original directory, a real native initial GET with num_turns=100 completed HTTP 200, yet the official index count remained zero, olderRequests=0, and the old sentinel count was zero. The old prepare ACK self-wake exhausted 60 seconds with no history progress.

Read-only inspection of the current native Timeline scroll handler shows history loading depends on user wheel/key/touch direction at the real boundary, or a ResizeObserver when content does not fill one screen. No safe public DOM history trigger was established. Production does not call private callbacks, scan Fiber, synthesize user gestures, move the reader, or fabricate a navigator.

A dedicated test tab of the same existing conversation was opened with empty message and reloaded once. HTTP 200 returned, but official index count remained zero. No automatic message fallback was added.

This is one remaining core blocker: no proven safe native bootstrap for the live Timeline. main must not advance until automatic restore and 100+ navigation acceptance pass.

## Gates

Run two consecutive npm test, verify:copy, build, verify:gate, git diff --check, package. ZIP/dist byte comparison is built into package. Final logs and live sampling are saved in /Users/harsonru/Desktop/yada-chatgpt-20260927-closeout/.

## Real acceptance scope

Only one existing safe ChatGPT tab was refreshed; other existing tabs were not refreshed or closed. Dedicated test tabs use existing conversations and send no messages. No uninstall, new extension identity, storage reset, cookie reset or Mac mini connection.

Core official-navigation restore and first/middle/last jumps are BLOCKED; unit/build success is not live acceptance. Remaining live feature checks are reported individually in the final task report.

## Final engineering results

- npm test twice: exit 0, 23 files / 224 tests each, no unhandled error or worker timeout; 7.80s and 7.52s.
- verify:copy / build / verify:gate / git diff --check / package: exit 0.
- ZIP SHA256: 4060cff9584802418ffda2a8c57f3bb318a018a76fbfa991271b0bb67195b889.
- ZIP equals final dist_chrome; original loaded directory equals all 10 final files.
- Edge extension manager confirmed 4.1.6 after Reload. No install identity, permissions, cookies, prompts, or quota storage reset.
- Final live sampling starts at the first readable extension runtime after reload, rather than claiming an exact reload+0s sample. Late isolated-context creation prevented exact 0/2/5s-from-reload diagnostics.

## Final live results and limits

- Final 60s sampling: 91-turn conversation, version 4.1.6, one Host, nativeFound=0, phase=sleeping, sleepReason=sentinel-unavailable, prepareActive=false, elapsedActiveMs=48, maxObservedDriftPx=0. Stable anchor hash/top and scrollTop across all six samples. This confirms the ACK self-wake fix, not automatic navigation restoration.
- Normal viewport, live Edge 980px emulated viewport, and native browser zoom 90%: toolbar/share/more intersection=0; native centers hit native buttons. Both viewport emulation and browser zoom were restored. Full native-window resize, controlled Header replacement, and all visibility exits remain unverified live.
- Short existing conversation: 2 turns, one Host, copying emitted 2 User and 2 Assistant sections with distinct real timestamps. A 91-turn copy returned success feedback “已复制 91 轮”. Clipboard counting on the long export is ambiguous because chat bodies themselves include quoted export headings; do not call the raw heading count a message count. Temporary metadata observers never persisted chat bodies and are removed at closeout. Native clipboard content verification remains limited by the browser session clipboard returning empty text.
- Prompts: original count 5; two disposable QA entries exercised add/edit/drag order/persistence/delete. Original entries retained, final count 5. The prompt copy button was exercised, but end-to-end native clipboard verification was inconclusive.
- Quota: rings/details and light-refresh control present; light refresh was invoked. Heatmap had zero cells; eligibility requires a complete trusted history baseline, which this live snapshot does not provide. This is not claimed a heatmap pass. No baseline or ledger was cleared.
- Other independently opened existing conversations reported 87 / 11 / 19 turns, one Host each, and sleeping without history progress. No verified 100+ sample was established. The original approximately 89-turn identity was not proven from redacted records. Therefore 89-turn / 100+ automatic restore and first/middle/last jump acceptance remain unverified/blocked.
- User interruption during active native loading, sustained multi-tab performance, Header replacement, all pageshow paths and end-to-end clipboard/heatmap acceptance remain unverified live. No main push is authorized by these results.
