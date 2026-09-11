# Backend contract verification without a product dependency

`@superche/persistent-repl-testing` exports `verifyBackendContract(fixture)`. It uses only the public Core and CUA packages and the supplied `CuaClient`. The built-in fixture is synthetic. No Hi or Codex service is loaded by this runner.

```js
// owned-fixture.mjs: trusted host code, never code supplied by the model.
export async function createFixture() {
  const client = await createYourAlreadyAuthorizedClient();
  return {
    client,
    evidence: 'device', // use 'synthetic' for simulated backends
    browserId: 'owned-browser-target',
    nativeId: 'owned-native-target',
    identity: { ownerKey: 'test-owner', taskKey: 'test-task', authorizationRevision: '1' },
    close: () => client.close(), // optional host cleanup
  };
}
```

Run `node examples/backend-contract.mjs /absolute/path/to/owned-fixture.mjs`. The module acquires/releases only the targets that the host supplies; use a dedicated test session. An unavailable capability must fail with a diagnostic instead of being silently treated as passed.

The six checks cover Browser/Native acquisition identity, reuse of the original Browser object across cells/target switches, host identity rejection, reset epoch/binding invalidation, and confirmed session disposal. This is an acquisition/lifecycle contract, not a blanket backend certification. It does not type/click/navigate a device or claim that a real model consumed images.

The automated CUA suite separately covers synthetic actions, receipts, unknown/post-observation errors, waiter order, image guards and independent output/preview consumers. A chosen real driver must supply target-specific action outcomes and real model-image acknowledgement evidence before making those device/model claims. These follow-ups can use any host and are not conditional on Hi.
