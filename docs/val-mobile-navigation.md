# VAL: mobile conversation and navigation

The mobile chat uses the visible viewport (VisualViewport, with dynamic viewport fallback), not a desktop minimum height. The fixed navigation reserves its measured height, including the safe area. During keyboard input the navigation and secondary chat controls are hidden, while the message field and send button remain in the visible panel. Zoom is not disabled.

Opening a mobile conversation or menu locks the background page. Nested overlays share the lock; the last close restores the scroll position. Navigating to another page resets that restoration target. Conversation state, producer scope, pending draft and explicitly started voice remain in the same mounted copilot. Minimizing changes presentation only.

Mobile controls expose producer selection and history, hide desktop pin/full-screen controls, use 44px touch targets, and provide a compact VAL shortcut. The Produtores tab opens the portfolio, not the last selected producer. Menus close before opening the copilot and when changing pages. The active navigation indicator follows the visible conversation.

New replies follow the conversation's own scroll container. Reading older messages does not scroll the background page. General open questions outside agronomy can use the existing governed model fallback without requiring a producer. Private account fields, live-data requests and calculator/tool requests retain their dedicated routes and evidence requirements. No new seed data, automatic facts or database migration.

## Verification

- Unit tests cover keyboard resizing, browser chrome, pinch zoom, focus dismissal, orientation, event cleanup, nested scroll locks and navigation resets.
- React interaction tests exercise the real mobile menu and its five destinations; persistent-copilot tests exercise the real App and voice hook across pages.
- General knowledge tests cover an out-of-agronomy model answer while retaining unverified provenance. Existing Fact First, current-data, tool and producer-scope tests remain required.
- The remote validation browser could not open localhost (`ERR_BLOCKED_BY_CLIENT`). This change has **not** been visually validated on a physical iPhone/Safari. Do not describe automated DOM/unit checks as native keyboard testing.

## Staging acceptance on iPhone

1. Open VAL from a scrolled page. Scroll the conversation: the background must stay still.
2. Focus the text field: no zoom; send remains visible above the keyboard; the bottom navigation disappears. Dismiss the keyboard and verify navigation returns.
3. Minimize and switch to Produtores, Visitas and Início. Restore VAL: draft and conversation remain, with the correct producer.
4. Open Mais and Registrar; scroll their contents; close by backdrop or close control. No menu remains over the chat.
5. If voice was explicitly started, navigation/minimization must preserve it. Closing VAL must release microphone and audio.
6. Test general questions and account questions separately; missing or unavailable evidence must never become invented producer facts.
