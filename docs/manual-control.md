# Manual iPhone Safari control

This is the operator guide for controlling a foreground iPhone Safari tab from
this Linux machine. The shared debugger and bridge can execute JavaScript in a
live Safari page, navigate the tab, inject a userscript bundle, and inspect the
result. They cannot unlock the phone, operate Settings, switch Safari tabs, or
interact with browser chrome.

Use this guide for one-off investigation and for the manual connection check
that precedes an automated phone suite.

## How control works

The universal debugger userscript runs at `document-start` on the iPhone. It
polls the HTTPS bridge on this computer, executes commands inside its page, and
returns serializable results. Each page load has a unique debugger client ID.

```text
Node controller on this computer
        |
        | HTTPS commands and results on port 37777
        v
shared bridge
        |
        | GM_xmlhttpRequest over the LAN
        v
universal debugger userscript in iPhone Safari
        |
        | JavaScript in the live page
        v
userscript or website under investigation
```

Every real navigation or reload creates a new page and therefore a new client.
Do not retain a client ID across navigation. Use `createSession()` and its
navigation methods so control follows the correct page. A bfcache restoration
is different: it revives the original page and its original client.

## One-time setup

The phone and computer must be on the same LAN.

1. From this repository, build the universal debugger:

   ```bash
   npm run build
   ```

   This project intentionally increments its package/debugger version on every
   build. Do not reset or reuse the previous version number.

2. Start certificate setup from a consumer repository that contains
   `tests/ios/config.json`:

   ```bash
   npx userscript-ios-test setup
   ```

   The command prints the CA profile URL and debugger URL for the current LAN
   address. The bridge also performs setup automatically when needed, but the
   phone must trust the generated CA before it can poll the HTTPS bridge.

3. On the iPhone, open the printed CA URL, install the downloaded profile, and
   enable full trust for that root certificate in iOS certificate trust
   settings.

4. Install `dist/userscript-ios-test-debug.user.js` in the iPhone userscript
   manager and grant it access to every site used by phone tests. Only one
   universal debugger is needed for every consumer repository.

5. If the computer's LAN address changes, rebuild and reinstall the debugger.
   Its bridge origin is embedded in the generated userscript.

All repositories share port `37777`; run only one phone controller or suite at
a time.

## Verify foreground control

Keep the iPhone unlocked, leave Safari foregrounded on
`https://example.com/`, and enable the universal debugger userscript. Then run
from this repository:

```bash
npm run manual:probe
```

The probe starts the bridge, waits up to two minutes for the phone, identifies
the foreground Safari tab, and injects a green `CONNECTION SUCCESSFUL` banner.
It also prints the controlled URL and page title on the computer.

The probe is deliberately one-shot. After printing success it closes the
bridge and exits. The green banner remains in the page, but it does **not** mean
that a later Node process is already connected. Every controller process owns
its own live bridge/session and must establish its own debugger round trip.
Never treat an earlier probe as the connection for a later investigation.

If it prints `Waiting for iPhone debugger`, leave it running while checking the
phone. The printed debugger URL is the exact script served for the current
host and port.

No page command or navigation has happened while the process only says
`Waiting for iPhone debugger`. A session has actually claimed the tab only
after it prints `Claimed foreground Safari tab at ...` or the manual probe
prints `Foreground Safari control confirmed`.

## Own one complete command session

For a real investigation, connection, readiness proof, navigation, commands,
and cleanup must happen in the same Node process. Do not run `manual:probe`,
let it exit, and then assume a separate investigation script inherits that
connection.

Use this lifecycle:

```js
const controller = createController({
    root,
    name: "manual-investigation",
    connectionTimeoutMs: 120_000,
});
const session = createSession({ controller });

try {
    await session.connect({
        allowedHosts: ["provider.example"],
        controlledCode: `return Boolean(globalThis.__myInvestigation);`,
    });

    // This proves command execution in the same session that will navigate.
    const ready = await session.command(`
        return {
            href: location.href,
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus(),
        };
    `);
    if (
        ready.href !== "https://example.com/" ||
        ready.visibilityState !== "visible" ||
        !ready.hasFocus
    ) {
        throw new Error(`Safari preflight failed: ${JSON.stringify(ready)}`);
    }
    console.log("SAME-SESSION PREFLIGHT CONFIRMED");

    await session.navigate("https://provider.example/supported-route");
    const result = await session.command(`return document.title;`);
    console.log(result);
} finally {
    await session.cleanup();
    session.close();
}
```

Keep Safari unlocked and foregrounded from before `session.connect()` until
cleanup finishes. Run only this controller on port `37777`. If the script is
still at `Waiting for iPhone debugger`, stop there and repair connectivity;
do not continue toward a one-chance target.

## Prepare a one-chance navigation

When a target can be visited only once, rehearse the exact same script against
a disposable site first. The production run must keep one controller alive
for all of these stages:

1. claim foreground `https://example.com/` with `session.connect()`;
2. complete a same-session command round trip and verify focus/visibility;
3. install or otherwise prepare every recorder that must exist before the
   target navigation;
4. navigate exactly once with `session.navigate()`;
5. adopt the replacement page client and collect bounded snapshots;
6. return to `https://example.com/` in `finally` and close the bridge.

There is an important document-start boundary. The universal debugger reports
its own `connected` event at document start, but ordinary remote commands are
available only after the replacement page client begins polling the bridge.
The bridge intentionally does not deliver old broadcast commands to a newly
seen client. Therefore a command sent before navigation cannot install a DOM,
`fetch`, or XHR observer in the future page.

If the investigation must capture work that can occur before the first poll
(for example, a short-lived anti-bot challenge or the earliest provider
requests), put a passive recorder in an installed `document-start` userscript
before the one-chance visit, or extend and verify the debugger's startup
instrumentation first. Rehearse that exact recorder on the disposable site.
Post-navigation commands can still inspect buffered Performance entries,
current DOM/state, and subsequent activity, but they cannot prove that they
saw every earlier event.

## Run one-off commands safely

For more than the connectivity probe, create a temporary investigation script
in the consumer repository and use the shared controller API:

```js
#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    createController,
    createSession,
} from "userscript-ios-test/controller";

const root = process.cwd();
const controller = createController({
    root,
    name: "manual-investigation",
    connectionTimeoutMs: 120_000,
});
const session = createSession({
    controller,
    sourceLabel: "manual-investigation.user.js",
});

try {
    await session.connect({
        allowedHosts: ["provider.example"],
        controlledCode: `
            return Boolean(document.querySelector(".my-userscript-app"));
        `,
    });

    await session.navigate("https://provider.example/supported-route");

    const bundle = await readFile(
        resolve(root, "dist/my-userscript.user.js"),
        "utf8",
    );
    await session.inject(bundle);

    const snapshot = await session.command(`
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 120; attempt++) {
            if (document.querySelector(".my-userscript-app")) break;
            await wait(250);
        }
        return {
            href: location.href,
            active: Boolean(document.querySelector(".my-userscript-app")),
            scrollY,
        };
    `);
    console.log(snapshot);
} finally {
    await session.cleanup();
    session.close();
}
```

Remote commands run as asynchronous function bodies, so they may use `await`
and must explicitly `return` a small serializable value. Do not return DOM
nodes, cyclic objects, or large page payloads.

## Navigation, reload, Back, and bfcache

Use real browser navigation when investigating browser lifecycle behavior:

```js
await session.navigate(targetUrl);
await session.reload();

await session.command(`history.back()`, { expectResult: false });
await session.waitForNavigation(
    client => new URL(client.href).pathname === expectedPath,
    "Back to list",
);
```

Set `expectResult: false` for commands that navigate away because the old page
may disappear before it reports a result.

To prove bfcache instead of merely proving that fallback restoration works,
install a probe before leaving the page:

```js
await session.command(`
    const row = document.querySelector(".gallery-row");
    globalThis.__bfcacheProbe = { row, persisted: false };
    addEventListener("pageshow", event => {
        globalThis.__bfcacheProbe.persisted = event.persisted;
    }, { once: true });
    return true;
`);
```

After Back, require both the persisted lifecycle signal and the original DOM
object:

```js
const restored = await session.command(`
    const probe = globalThis.__bfcacheProbe;
    return {
        persisted: probe?.persisted === true,
        sameRow: probe?.row === document.querySelector(".gallery-row"),
        connected: probe?.row?.isConnected === true,
    };
`);
```

A test that silently reinjects the application after Back only verifies a
reload fallback; it cannot claim that bfcache works.

## Inspect bridge state

For connection or client-handoff diagnosis, use the low-level controller:

```js
await controller.ensureServer();
await controller.waitForDebugger();
console.dir(await controller.state(), { depth: null });
```

The state contains:

- `clients`: page clients, URLs, titles, user agents, and last-seen times;
- `commands`: commands posted by the computer;
- `results`: returned values and remote errors;
- `boots`: debugger startup reports.

`controller.foregroundClient()` broadcasts a focus/visibility probe and chooses
the foreground Safari page. `createSession().connect()` wraps that operation
with the safe starting-page gate.

## Troubleshooting

### No debugger client connects

Check all of the following:

- the phone is unlocked and Safari is foregrounded;
- the universal debugger userscript is enabled on the current hostname;
- the phone and computer are on the same LAN;
- no other phone suite or bridge owns port `37777`;
- the installed debugger contains the computer's current LAN address;
- the iPhone trusts the shared mkcert root CA;
- the debugger URL printed by the waiting controller opens from the phone.

If the LAN address changed, rebuild and reinstall the universal debugger. Use
`IOS_DEBUG_HOST` to override address detection when necessary.

### The wrong tab is selected

Bring the intended Safari tab to the foreground before connecting. The harness
prefers a visible, focused client. If several tabs remain active and none can be
identified as foreground, it refuses to guess.

### Control is lost after navigation

Do not send commands to the pre-navigation client. Use `session.navigate()`,
`session.reload()`, or `session.waitForNavigation()` so the session adopts the
appropriate client. When writing lower-level tooling, snapshot all known client
IDs before navigating and require the replacement page to have a previously
unknown ID. For Back/bfcache, wait for the matching revived client instead.

### Injection appears to succeed on the wrong page

Navigation can briefly leave both the dying client and replacement client
visible to the bridge. Associate injection success with the client that
actually acknowledged the injection; do not infer success from URL equality or
from an unrelated new client. Consumer-specific custom injectors may be needed
when the injected application calls `document.open()`/`document.close()` during
takeover.

## Safety and cleanup

- Begin on `https://example.com/` unless the foreground tab is already an
  explicitly allowed provider or a page recognized by `controlledCode`.
- Keep `allowedHosts` narrow.
- Default investigations must be read-only. Snapshot and restore local storage
  around reversible mutations.
- Always put `session.cleanup()` and `session.close()` in an outer `finally`.
- Keep the phone foregrounded and avoid touching it while a controller owns the
  tab.

For the full API surface, see [api.md](api.md). For suite design, see
[greenfield-guide.md](greenfield-guide.md) and
[successful-implementations.md](successful-implementations.md).
