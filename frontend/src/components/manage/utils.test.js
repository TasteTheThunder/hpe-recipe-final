import test from 'node:test';
import assert from 'node:assert/strict';
import { getEnvironmentActions, getSourceReleaseOptions } from './utils.js';

const pipeline = ['dev', 'qa', 'integration', 'prod'];

const promotion = {
  deployedOn: {
    dev: true,
    qa: true,
    integration: true,
    prod: true,
  },
  activeVersionOnCluster: {
    dev: '0.0.8',
    qa: '0.0.7',
    integration: '0.0.6',
    prod: '0.0.5',
  },
  canRollback: {
    dev: true,
    qa: true,
    integration: true,
    prod: true,
  },
};

test('environment actions follow the selected pipeline stage', () => {
  assert.deepEqual(getEnvironmentActions(pipeline, 'dev', promotion), {
    promoteTarget: 'qa',
    rollbackTarget: 'dev',
  });
  assert.deepEqual(getEnvironmentActions(pipeline, 'qa', promotion), {
    promoteTarget: 'integration',
    rollbackTarget: 'qa',
  });
  assert.deepEqual(getEnvironmentActions(pipeline, 'integration', promotion), {
    promoteTarget: 'prod',
    rollbackTarget: 'integration',
  });
  assert.deepEqual(getEnvironmentActions(pipeline, 'prod', promotion), {
    promoteTarget: null,
    rollbackTarget: 'prod',
  });
});

test('environment actions hide no-op promotions when target already has same version', () => {
  const syncedPromotion = {
    deployedOn: {
      dev: true,
      qa: true,
      integration: true,
      prod: true,
    },
    activeVersionOnCluster: {
      dev: '0.0.5',
      qa: '0.0.5',
      integration: '0.0.5',
      prod: '0.0.5',
    },
    canRollback: {},
  };

  assert.deepEqual(getEnvironmentActions(pipeline, 'dev', syncedPromotion), {
    promoteTarget: null,
    rollbackTarget: null,
  });
  assert.deepEqual(getEnvironmentActions(pipeline, 'qa', syncedPromotion), {
    promoteTarget: null,
    rollbackTarget: null,
  });
  assert.deepEqual(getEnvironmentActions(pipeline, 'integration', syncedPromotion), {
    promoteTarget: null,
    rollbackTarget: null,
  });
});

test('environment actions remain hidden until they are available', () => {
  assert.deepEqual(getEnvironmentActions(pipeline, 'qa', null), {
    promoteTarget: null,
    rollbackTarget: null,
  });
  assert.deepEqual(getEnvironmentActions(pipeline, 'qa', {
    deployedOn: { qa: true },
    canRollback: { qa: false, integration: true },
  }), {
    promoteTarget: 'integration',
    rollbackTarget: null,
  });
});

test('edit source releases include only the active deployed DEV catalog', () => {
  const releases = [
    { version: '0.0.1', status: 'available' },
    { version: '0.0.3', status: 'available' },
    { version: '0.0.4', status: 'deployed' },
  ];

  assert.deepEqual(getSourceReleaseOptions(releases, true, '0.0.4'), [
    { version: '0.0.4', status: 'deployed' },
  ]);
});

test('new release source options continue to exclude the release being created', () => {
  const releases = [
    { version: '0.0.3', status: 'available' },
    { version: '0.0.4', status: 'deployed' },
  ];

  assert.deepEqual(getSourceReleaseOptions(releases, false, '0.0.4'), [
    { version: '0.0.3', status: 'available' },
  ]);
});
