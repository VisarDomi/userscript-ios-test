# Agent instructions

This repository is the shared iOS Safari test harness for userscripts.

## Primary use case

Use this package to add the first iPhone regression tests to a userscript
repository that currently has no test harness.

Read these files before implementing a new suite:

1. `docs/greenfield-guide.md`
2. `docs/api.md`
3. `docs/successful-implementations.md`
4. `templates/tests/ios/run.mjs`

## Ownership boundary

Keep these concerns in `userscript-ios-test`:

- HTTPS bridge and certificate handling;
- universal phone debugger;
- foreground tab claiming;
- client identity across navigation and reload;
- exact cleanup to `https://example.com/`;
- remote commands and timeouts;
- test/site selection;
- build-step execution;
- phase banners and result reporting.

Keep these concerns in the consuming userscript repository:

- supported sites and real entry URLs;
- bundle build path;
- app-specific DOM selectors;
- behavior assertions;
- provider-specific URL equivalence;
- fixtures and mock provider data;
- state snapshot and restoration;
- classification of tests as read-only, reversible, or destructive.

Do not copy the bridge, debugger userscript, or session lifecycle into a
consumer repository.

## Safety

- Default phone tests must be read-only.
- Reversible account actions require an explicit mode and restoration logic.
- Destructive actions must be separately named, documented, and never run
  without explicit user authorization.
- Always restore modified local/session storage in `finally`.
- Always call `session.cleanup()` and `session.close()` in the outer `finally`.
- Run only one repository's phone suite at a time; all suites share port 37777.

## Validation

For changes to this package:

```bash
npm test
npm run build
```

For a newly integrated repository, run its required type-check/build commands,
then manually verify the universal debugger connection before running its
smallest smoke test. The canonical operator workflow is documented in
[`docs/manual-control.md`](docs/manual-control.md); keep manual-control
instructions in this shared repository rather than consumer repositories.
