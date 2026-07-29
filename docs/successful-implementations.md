# Successful implementation patterns

These are three working suites added to different kinds of userscripts. They
are examples of how to design a new suite, not templates to copy wholesale.

## 1. Manga-reader: provider matrix and natural scrolling

Source:
[`../../manga/manga-reader/tests/ios/run.mjs`](../../manga/manga-reader/tests/ios/run.mjs)

Useful when a userscript supports many websites with the same behavior.

Proven patterns:

- URLs are frozen in `test.txt`.
- `--site` filters cases by configured provider/site identity.
- `runCaseMatrix()` continues across independent providers.
- A provider-specific matcher tolerates canonical path differences while still
  checking hostname, path tail, and hash.
- Reload restoration uses `session.reload()`.
- Lazy images are allowed to load naturally before scrolling.
- Tracking endpoints are intercepted on the phone so the regression can count
  calls without mutating the real service.

Representative custom URL matcher:

```js
await session.navigate(testCase.url, {
    matches: (client, expectedText) => {
        const actual = new URL(client.href);
        const expected = new URL(expectedText);
        const actualTail = actual.pathname.split("/").filter(Boolean).slice(-2).join("/");
        const expectedTail = expected.pathname.split("/").filter(Boolean).slice(-2).join("/");
        return actual.hostname === expected.hostname
            && actualTail === expectedTail
            && actual.hash === expected.hash;
    },
});
```

Use this pattern for readers, downloaders, or UI replacements that repeat the
same contract across multiple providers.

## 2. Gallery-reader: storage restoration, reload, and Back

Source:
[`../../manga/gallery-reader/tests/ios/run.mjs`](../../manga/gallery-reader/tests/ios/run.mjs)

Useful when tests temporarily alter user-local state and must validate browser
history.

Proven patterns:

- Local storage is snapshotted before a case and restored in an inner
  `finally`.
- Search/list position is captured before opening a reader.
- Reader position is saved, then checked after a real `session.reload()`.
- `history.back()` is issued without expecting a command result.
- `session.waitForNavigation()` adopts the restored search-page client.
- The suite verifies both selected page and scroll position.
- A custom injector waits for takeover to settle before assertions continue.

Representative Back pattern:

```js
await session.command(`history.back(); return "back";`, {
    expectResult: false,
});

await session.waitForNavigation(client => {
    const actual = new URL(client.href);
    return actual.hostname === expected.hostname
        && actual.pathname === expected.pathname
        && actual.search === expected.search;
}, "Back to search");
```

Use this pattern for userscripts that maintain favorites, filters, pagination,
reader position, or other browser-local state.

## 3. Stream-viewer: live provider plus deterministic fixtures

Source:
[`../../video/stream-viewer/tests/ios/run.mjs`](../../video/stream-viewer/tests/ios/run.mjs)

Useful when live data changes continuously or important edge cases are hard to
find on demand.

Proven patterns:

- The safe suite uses the signed-in live provider read-only.
- Assertions compare identities/order instead of exact live counts.
- `createReporter()` maps checks to requirement IDs.
- A fixture bundle replaces the provider for deterministic edge cases.
- Fixture scenarios are passed through `sessionStorage`.
- Synthetic media events exercise audio-only and unavailable-stream handling.
- Read-only, reversible, and destructive actions are separated.
- Destructive/account modes are skipped unless explicitly requested.

Representative requirement reporting:

```js
const { results, check, skip } = createReporter();

await check(["S1", "S2"], "Stream starts with adjacent media", async () => {
    const snapshot = await streamSnapshot();
    assert(!snapshot.error, snapshot.error, snapshot);
    assert(snapshot.slotCount === 3, "expected three slots", snapshot);
    return snapshot;
});

if (!actions) {
    skip(["A3"], "Confirmed block", "pass --actions to permit mutation");
}
```

Use this pattern for media userscripts, dashboards, or apps whose provider
state cannot supply every regression scenario reliably.

## Choosing a pattern for a new repository

- Same behavior across sites: start with the manga matrix.
- Storage/history correctness: add the gallery snapshot/reload/Back pattern.
- Volatile live data or rare failures: add a deterministic fixture provider
  and stream-style requirement reporting.

Patterns can be combined, but keep the initial smoke contract small.
