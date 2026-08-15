# userscript-ios-test

Shared iOS Safari transport and test-controller infrastructure for local
userscript repositories.

## Documentation

- [Manual iPhone Safari control](docs/manual-control.md): install and trust the
  universal debugger, verify foreground control, run one-off commands, follow
  navigation clients, prove bfcache, diagnose connections, and clean up.
- [Greenfield integration guide](docs/greenfield-guide.md): add a safe phone
  suite to a userscript repository.
- [Controller API](docs/api.md): session and low-level controller reference.
- [Successful suite patterns](docs/successful-implementations.md): proven
  consumer designs.

Adding tests to a repository that currently has none:

1. Read [`docs/greenfield-guide.md`](docs/greenfield-guide.md).
2. Copy the [`templates/`](templates/) starter files.
3. Use [`docs/api.md`](docs/api.md) while implementing assertions.
4. Consult
   [`docs/successful-implementations.md`](docs/successful-implementations.md)
   for three proven suite designs.

## One-time phone debugger

Build the single debugger userscript:

```bash
npm run build
```

Install [`dist/userscript-ios-test-debug.user.js`](dist/userscript-ios-test-debug.user.js)
on the phone once. Every consuming repository uses the same debugger identity
and port, so only one suite should run at a time.

To verify that this computer can control the foreground Safari tab, keep the
phone unlocked on `https://example.com/` and run:

```bash
npm run manual:probe
```

This is a one-shot probe: it closes its bridge after reporting success. Its
green page banner can remain visible, but a later investigation must create
and verify its own connection. For one-chance navigation, keep preflight,
navigation, inspection, and cleanup in one controller process.

See the [manual-control guide](docs/manual-control.md) for certificate trust,
connection diagnosis, direct commands, navigation, injection, and bfcache
verification.

Each consuming repository owns its application assertions and a small
`tests/ios/config.json`. This package owns:

- the HTTPS bridge and certificate setup;
- the generated debugger userscript;
- connectivity and round-trip probes;
- foreground Safari client selection;
- safe navigation and new-page client detection;
- remote command dispatch and timeouts;
- local build hooks;
- PASS/FAIL/SKIP reporting primitives;
- common `--test`, `--site`, and `--tag` argument parsing;
- complete phone-session ownership and exact start-URL cleanup;
- shared build-step, phase-banner, and case-matrix helpers;
- bridge cleanup.

Repository assertions can use `createSession()` for claiming the foreground
tab, commands, navigation, reloads, injection, phase updates, and cleanup.
`runCaseMatrix()` provides consistent continue-on-failure behavior, while
`createReporter()` supports requirement-oriented PASS/FAIL/SKIP groups.

```js
const controller = createController({
    root,
    name: config.name,
});
const session = createSession({ controller });

try {
    await session.connect({
        allowedHosts: ["provider.example"],
        controlledCode: `return Boolean(document.querySelector(".my-app"));`,
    });
    await session.navigate("https://provider.example/reader");
    await session.inject(bundle, { label: "my-userscript.test.user.js" });
    await session.command(`return document.title;`);
} finally {
    await session.cleanup();
    session.close();
}
```

Application repositories should keep only provider URL equivalence, DOM
selectors, fixtures, state restoration, and behavior assertions. They should
not start bridges, select foreground tabs, track replacement clients, or
implement final navigation cleanup themselves.

Example configuration:

```json
{
  "name": "manga-reader"
}
```

Consumer script:

```json
{
  "tests": "node tests/ios/run.mjs"
}
```

The repository-specific runner imports `createController` from
`userscript-ios-test/controller`. Connecting a session starts the shared bridge
and creates its shared HTTPS certificate when needed; certificate and bridge
state never live in the consumer repository.
