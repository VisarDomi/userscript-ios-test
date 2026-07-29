# Add iPhone tests to a userscript with no existing tests

This guide starts with an ordinary userscript repository that has no debugger,
bridge, phone runner, test contract, or fixtures.

## 1. Discover the application before designing tests

Read the repository instructions, `package.json`, build configuration, route
matching, storage usage, and network calls. Write down:

- the userscript's build command and output file;
- every supported hostname and route type;
- how to recognize that the injected app is active;
- the smallest useful user journey;
- what state the app changes;
- which actions are read-only, reversible, or destructive;
- which behavior depends on real Safari navigation, scrolling, media, or Back.

Do not begin by copying assertions from another app. The shared harness is
generic; the test contract is application-specific.

## 2. Define the first safe contract

Create `test.md` describing the behavior in plain language and `test.txt`
containing stable entry URLs or frozen test data.

A good first suite normally proves:

1. the userscript activates on a real supported route;
2. its main UI becomes usable;
3. one primary interaction works;
4. URL/storage state is saved correctly;
5. real reload or Back restores the expected state;
6. the suite returns Safari to `https://example.com/`.

Start with one smoke case. Add a matrix only after the first case is reliable.

Avoid account mutations in the default suite. If live provider data is
unpredictable, assert identities and relationships rather than exact counts.

## 3. Add the shared package

If the new repository is two directories below `/home/visar/Documents/work`,
add this development dependency:

```json
{
  "devDependencies": {
    "userscript-ios-test": "file:../../userscript-ios-test"
  }
}
```

Adjust the relative path for the repository's actual location, then run:

```bash
npm install
```

Add scripts:

```json
{
  "scripts": {
    "tests": "node tests/ios/run.mjs"
  }
}
```

Create `tests/ios/config.json`:

```json
{
  "name": "my-userscript"
}
```

Do not add a repository-specific bridge or debugger userscript.

## 4. Install the universal phone debugger once

From this shared repository:

```bash
npm run build
```

Install
[`../dist/userscript-ios-test-debug.user.js`](../dist/userscript-ios-test-debug.user.js)
on the iPhone and grant it access to all sites used by tests.

The shared harness starts its bridge and creates shared certificate material
automatically on the first connection. If the LAN address changes, rebuild and
reinstall the universal debugger from this shared repository. Install/trust the
shared mkcert CA profile if the phone has not trusted it yet. No certificate,
bridge, or setup state belongs in a consumer repository. All repositories share
port 37777, so run only one suite at a time.

## 5. Create the first runner

Copy
[`../templates/tests/ios/run.mjs`](../templates/tests/ios/run.mjs)
to `tests/ios/run.mjs`.

[`../templates/package-scripts.json`](../templates/package-scripts.json)
contains the package.json fields to merge, and
[`../templates/test.txt`](../templates/test.txt) shows the entry-URL contract
file.

Replace:

- `my-userscript` selectors and source label;
- the build commands;
- `dist/my-userscript.user.js`;
- the supported URL;
- the activation and behavior assertions.

The important lifecycle is:

```js
const controller = createController({ root, name: config.name });
const session = createSession({ controller });

try {
    await session.connect({ allowedHosts, controlledCode });
    // Build, navigate, inject, and assert app behavior.
} finally {
    await session.cleanup();
    session.close();
}
```

`controlledCode` must recognize a page already owned by this app after an
interrupted test. It must not return true for arbitrary user tabs.

## 6. Put browser work inside remote commands

Code passed to `session.command()` runs on the iPhone page:

```js
const snapshot = await session.command(`
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    for (let i = 0; i < 120 && !document.querySelector(".my-app"); i++) {
        await wait(250);
    }
    return {
        active: Boolean(document.querySelector(".my-app")),
        href: location.href,
    };
`);

if (!snapshot.active) throw new Error("userscript did not activate");
```

Use bounded polling. Return small serializable snapshots and assert them on the
laptop. Do not return DOM nodes, cyclic objects, or large provider payloads.

## 7. Use real navigation for navigation behavior

Use:

- `session.navigate(url)` for a real new page;
- `session.reload(url)` for a real reload;
- `session.waitForNavigation(predicate, description)` after clicks or Back;
- `session.command(code, { expectResult: false })` when the command itself
  navigates away before it can report a result.

If a provider canonicalizes URLs, supply a custom matcher:

```js
await session.navigate(target, {
    matches: (client, expectedText) => {
        const actual = new URL(client.href);
        const expected = new URL(expectedText);
        return actual.hostname === expected.hostname
            && actual.pathname === expected.pathname;
    },
});
```

Keep that matcher local because it represents provider behavior.

## 8. Add test and site selection

Use `parseSelection()` and validate the names exposed by the repository:

```js
const selection = parseSelection(process.argv.slice(2));

if (!["full", "smoke"].includes(selection.test)) {
    throw new Error("Expected --test full or --test smoke");
}
if (selection.site && !["provider-a", "provider-b"].includes(selection.site)) {
    throw new Error("Unknown --site");
}
```

For independent site cases, use `runCaseMatrix()`. For many requirement-level
assertions in one dependent journey, use `createReporter()`.

## 9. Handle state and side effects explicitly

For local/session storage:

1. snapshot before the test;
2. make changes;
3. restore in an inner `finally`;
4. let the outer `finally` clean up the Safari tab and bridge.

For account actions:

- default: read-only;
- reversible mode: explicit flag plus restoration;
- destructive mode: separate flag and user authorization.

Never hide destructive behavior behind `--test full`.

## 10. Validate in increasing scope

Run:

1. runner syntax check;
2. repository type-check;
3. repository production build;
4. manual universal-debugger round trip on foreground `example.com`;
5. one smoke case;
6. one case per route/site type;
7. the complete safe suite.

Keep the phone unlocked, Safari foregrounded, and avoid touching it while a
suite controls the tab.

## Completion checklist

- No bridge/debugger copy exists in the consumer repository.
- `tests/ios/config.json` contains only repository identity.
- Default tests make no external account mutations.
- All waits are bounded.
- Navigation tests use real navigation/reload/Back.
- Modified storage is restored.
- Outer `finally` always calls `session.cleanup()` and `session.close()`.
- `--test` and `--site` reject unknown values before connecting.
- Type-check/build pass.
- Smoke and complete safe phone suites pass.
