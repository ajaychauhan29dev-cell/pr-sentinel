# acme-shop (fixture)

This tiny repository is the checked-out **head** of the demo pull request
`demo/acme-shop#42` used by PR Sentinel's offline demo. The PR (see
`../fixtures/demo-pr.json`) intentionally contains:

- a boundary-condition regression in `src/pricing.js` (caught by `test/pricing.test.js`)
- a leftover debug `console.log` in `src/format.js`
- a removed defensive default in `src/cart.js` (a plausible concern that the existing tests do **not** confirm)
- an empty `catch` block in `src/webhooks.js` (no tests cover this file)

Tests use the built-in `node:test` runner, so no install is needed.
