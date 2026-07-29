# API reference for consumer repositories

Import from:

```js
import {
    createController,
    createReporter,
    createSession,
    parseSelection,
    phaseBannerScript,
    runBuildSteps,
    runCaseMatrix,
    runSession,
    sleep,
} from "userscript-ios-test/controller";
```

## `createController(options)`

Creates the laptop-side bridge controller.

Important options:

- `root`: absolute consumer repository root;
- `name`: repository identity;
- `settleMs`: minimum delay between visible navigations/phases;
- `commandTimeoutMs`: remote command timeout;
- `clientTimeoutMs`: navigation/replacement-client timeout;
- `connectionTimeoutMs`: initial debugger connection timeout.

Normally do not override `port`, `debuggerName`, or `debuggerSlug`. All
repositories intentionally share the universal debugger on port 37777.

Useful low-level methods:

- `runLocal(command, args)`;
- `state()`;
- `request(path, options)`;
- `waitForResult(commandId)`.

Prefer `createSession()` for phone operations.

## `createSession({ controller, startUrl, sourceLabel })`

Owns the foreground Safari tab and its changing debugger client identity.

### `session.connect(options)`

Starts/connects the bridge, finds the foreground tab, validates that it is safe
to claim, and normalizes it to the exact start URL.

Options:

- `allowedHosts`: supported/controlled hostnames;
- `controlledCode`: remote code that recognizes an interrupted app-owned page.

### `session.command(code, options?)`

Runs asynchronous JavaScript in the currently controlled page and returns its
serialized result.

Set `{ expectResult: false }` when the code navigates away.

### `session.navigate(url, options?)`

Performs real navigation and adopts the replacement debugger client.

Options:

- `reloadIfSame`: defaults to `true`;
- `matches(client, expectedUrl)`: custom provider URL equivalence.

### `session.reload(url?, options?)`

Performs a real reload and adopts the replacement client.

Options:

- `before`: remote code run immediately before `history.replaceState`/reload;
- `matches(client, expectedUrl)`: custom URL equivalence.

### `session.waitForNavigation(predicate, description)`

Waits for and adopts a client matching an app-triggered navigation, such as a
link click or `history.back()`.

### `session.inject(bundle, options?)`

Injects a userscript bundle.

Options:

- `before`: remote setup code;
- `after`: remote post-injection code;
- `label`: source label shown in debugger errors.

Use a local custom injector only when takeover requires special settlement
logic, as gallery-reader does.

### `session.showPhase(options)`

Calls an installed phase-banner function.

Required:

- `globalName`;
- `text`.

Optional:

- `state`: `running`, `success`, or `error`;
- `pauseMs`.

### `session.cleanup()` / `session.close()`

`cleanup()` returns Safari to the exact configured start URL.
`close()` stops a bridge started by this process.

Always call both in the outer `finally`.

## `runSession(session, connectOptions, body)`

Optional convenience wrapper that connects, runs a callback, and guarantees
cleanup/close:

```js
await runSession(session, {
    allowedHosts: ["provider.example"],
    controlledCode: `return Boolean(document.querySelector(".my-app"));`,
}, async () => {
    await session.navigate("https://provider.example/");
    // Assertions...
});
```

Use an explicit outer `try/finally` instead when the runner needs custom
top-level failure reporting.

## `parseSelection(argv, options?)`

Parses common selectors:

- `--test NAME`;
- `--site NAME`;
- repeatable `--tag NAME`.

Returns `{ test, site, tags, args }`. The consumer must validate supported
names and interpret remaining arguments.

## `runBuildSteps(controller, steps)`

Runs ordered local commands:

```js
runBuildSteps(controller, [
    ["npx", ["tsc", "--noEmit"]],
    ["npx", ["vite", "build"]],
]);
```

## `phaseBannerScript(options)`

Returns remote JavaScript that installs a consistent on-phone phase banner.

```js
phaseBannerScript({
    globalName: "__myTestPhase",
    elementId: "__my-test-phase",
});
```

Insert the returned source before injecting the app.

## `runCaseMatrix(options)`

Runs independent cases, continues after failures, and returns
`{ results, failures }`.

Important options:

- `cases`;
- `pauseMs`;
- `run(testCase)`;
- `formatPass(result, testCase)`;
- `onFailure({ testCase, error, message })`.

## `createReporter()`

For a long dependent journey with requirement-oriented checks:

```js
const { results, check, skip } = createReporter();

await check(["H1"], "Home renders", async () => {
    const snapshot = await homeSnapshot();
    if (!snapshot.active) throw new Error("Home missing");
    return snapshot;
});

skip(["A1"], "Destructive account action", "requires --actions");
```

## `sleep(milliseconds)`

Laptop-side delay. Browser-side waits must be included inside remote command
source.
