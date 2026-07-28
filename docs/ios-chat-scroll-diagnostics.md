# Temporary iOS chat scroll diagnostics

This instrumentation is active only in a non-production build on an iOS device and only while the Match Hub chat component is mounted. Every entry begins with `[TM_IOS_CHAT_SCROLL]`; it does not include message text, user IDs, names, or conversation data.

## Reproduce and capture

1. Run a development build on an iPhone and attach Safari Web Inspector to the app WebView.
2. Open a Match Hub conversation with enough messages for the list to scroll.
3. Clear the Web Inspector console and filter it to `TM_IOS_CHAT_SCROLL`.
4. Tap the composer once, wait for the keyboard animation to finish, type one character, then wait again.
5. Save or copy every filtered console entry from `composer-pointer-down` through the final settled `message-list-scroll` event. Do not capture unrelated application logs.

## Identify the jump

Sort by `eventId` (it is monotonically increasing), then find the first `message-list-scroll` entry where `scrollTop` moves unexpectedly or differs materially from `maxScrollTop`. The immediately preceding `scroll-before` / `scroll-after` pair identifies an application scroll source. If there is no application scroll pair immediately before it, compare the preceding `visualViewport.scroll`, `visualViewport.resize`, `window.resize`, and `windowScrollY` entries; that pattern indicates WebKit/native focus scrolling or layout anchoring. Pay particular attention to root, composer, viewport, and `clientHeight` changes between the before/after pair and the first visibly bad list-scroll event.

Remove this note and the `[TM_IOS_CHAT_SCROLL]` instrumentation after runtime evidence has identified the cause.
