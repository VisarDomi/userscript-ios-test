# iOS Safari regression tests

## Safe smoke contract

1. The userscript activates on its supported route.
2. Its primary UI becomes usable within a bounded wait.
3. One primary read-only interaction succeeds.
4. Safari returns to `https://example.com/`.

## Run

```bash
npm run tests -- --test smoke --site example
```

Keep Safari unlocked and foregrounded. The default suite must not mutate
external account state.
