import test from 'node:test';
import assert from 'node:assert/strict';
import { getDeployedReleases } from './utils.js';

test('returns only the release deployed in the selected environment', () => {
  const releases = [
    { version: '0.0.1', status: 'available' },
    { version: '0.0.3', status: 'deployed' },
    { version: '0.0.4', status: 'available' },
  ];

  assert.deepEqual(getDeployedReleases(releases), [
    { version: '0.0.3', status: 'deployed' },
  ]);
});

test('returns no header releases when the environment has no deployment', () => {
  assert.deepEqual(getDeployedReleases([
    { version: '0.0.1', status: 'available' },
  ]), []);
  assert.deepEqual(getDeployedReleases(null), []);
});
