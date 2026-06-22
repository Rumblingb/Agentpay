import test from 'node:test';
import assert from 'node:assert/strict';

import { ruleClassify, safetyFloor, serviceHealthy, workerCommand, workerOutcome } from './bee.mjs';

test('fund execution always reaches the founder approval wall', () => {
  const route = safetyFloor('Buy a futures position for Bill');
  assert.equal(route.lane, 'fund');
  assert.equal(route.assignee, 'rajiv');
  assert.equal(route.needs_human, 1);
});

test('OAuth and publishing cannot be delegated to the model', () => {
  for (const request of ['Complete YouTube OAuth', 'publish the release', 'rotate the API_KEY']) {
    const route = safetyFloor(request);
    assert.equal(route.assignee, 'rajiv', request);
    assert.equal(route.needs_human, 1, request);
  }
});

test('read-only fund research remains autonomous', () => {
  assert.equal(safetyFloor('Research futures market structure'), null);
  const route = ruleClassify('Research futures market structure');
  assert.equal(route.lane, 'fund');
  assert.equal(route.assignee, 'hermes-lenovo');
  assert.equal(route.needs_human, 0);
});

test('ordinary implementation remains in the Labs lane', () => {
  const route = ruleClassify('Fix the dashboard test failure');
  assert.equal(route.lane, 'labs');
  assert.equal(route.assignee, 'codex');
  assert.equal(route.needs_human, 0);
});

test('launchd health accepts a running PID and clean idle jobs', () => {
  assert.equal(serviceHealthy('44511\t-15\tcom.agentpay.bee.daemon'), true);
  assert.equal(serviceHealthy('-\t0\tcom.agentpay.bee.pull'), true);
  assert.equal(serviceHealthy('-\t1\tcom.agentpay.bee.pull'), false);
});

test('headless worker commands use non-interactive modes', () => {
  const hermes = workerCommand('nemotron', 'task', '/repo');
  assert.deepEqual(hermes.args, ['-z', 'task', '--provider', 'nvidia', '-m', 'nvidia/nemotron-3-super-120b-a12b']);
  assert.equal(hermes.args.includes('--cli'), false);

  const claude = workerCommand('claude', 'task', '/repo');
  assert.equal(claude.args[0], '-p');
  assert.equal(claude.args.includes('--no-session-persistence'), true);
});

test('workers cannot close no-change or founder-blocked cards', () => {
  assert.equal(workerOutcome('BEE_OUTCOME: done'), 'done');
  assert.equal(workerOutcome('BEE_OUTCOME: blocked\nBEE_BLOCKER: auth'), 'blocked');
  assert.equal(workerOutcome('Changes I made: none. Required founder action: login.'), 'blocked');
  assert.equal(workerOutcome('Exploration text without an outcome line.'), 'blocked');
});
