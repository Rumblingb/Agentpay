import test from 'node:test';
import assert from 'node:assert/strict';

import gestureApi from './desk/gesture-recognizer.js';
import { approvalPacketFromOutput, canMandateTransition, isApprovableAction, ruleClassify, safetyFloor, serviceHealthy, settlementPayload, signApprovalWithKey, signMandateWithKey, verifyApprovalWithKey, verifyMandateWithKey, walletAdapterReady, walletReceiptLooksValid, workerCommand, workerOutcome } from './bee.mjs';

test('fund execution always reaches the founder approval wall', () => {
  const route = safetyFloor('Buy a futures position for Bill');
  assert.equal(route.lane, 'fund');
  assert.equal(route.assignee, 'rajiv');
  assert.equal(route.needs_human, 1);
});

test('OAuth and publishing cannot be delegated to the model', () => {
  for (const request of ['Complete YouTube OAuth', 'publish the release', 'submit the store listing', 'deploy to production', 'rotate the API_KEY']) {
    const route = safetyFloor(request);
    assert.equal(route.assignee, 'rajiv', request);
    assert.equal(route.needs_human, 1, request);
  }
  assert.equal(safetyFloor('draft a social post'), null);
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
  const codex = workerCommand('codex', 'task', '/repo');
  assert.deepEqual(codex.args.slice(0, 5), ['exec', '--sandbox', 'danger-full-access', '--ask-for-approval', 'never']);
  assert.equal(codex.args.includes('--full-auto'), false);

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

test('mandate integrity covers every authorization-critical field', () => {
  const key = Buffer.alloc(32, 7);
  const mandate = {
    sig_v: 2, id: 'mnd_test', task_id: 't_test', agent: 'bee', mode: 'live', intent: 'pay hosting',
    merchant: 'vercel.com', amount: 8, currency: 'USD', cap: 8, rail: 'stripe', nonce: 'n_test',
    issued_at: 1000, expires_at: 2000,
  };
  mandate.sig = signMandateWithKey(mandate, key);
  assert.equal(verifyMandateWithKey(mandate, key), true);
  for (const [field, value] of [['rail', 'usdc'], ['amount', 9], ['cap', 20], ['intent', 'buy credits'], ['expires_at', 9000], ['task_id', 't_other']]) {
    assert.equal(verifyMandateWithKey({ ...mandate, [field]: value }, key), false, field);
  }
});

test('mandate state machine does not reopen terminal decisions', () => {
  assert.equal(canMandateTransition('proposed', 'approved'), true);
  assert.equal(canMandateTransition('approved', 'ready_to_settle'), true);
  assert.equal(canMandateTransition('ready_to_settle', 'executed'), true);
  assert.equal(canMandateTransition('rejected', 'approved'), false);
  assert.equal(canMandateTransition('executed', 'rejected'), false);
  assert.equal(canMandateTransition('expired', 'approved'), false);
});

test('Casper rail stages a Casper-native x402 receipt payload', () => {
  const payload = settlementPayload({
    id: 'mnd_casper',
    intent: 'buy verified MCP capability data',
    merchant: 'casper-capability-feed',
    amount: 3,
    rail: 'casper',
    nonce: 'n_casper',
    approval_sig: 'b'.repeat(64),
  });

  assert.equal(payload.protocol, 'x402-casper');
  assert.equal(payload.chain, 'casper');
  assert.equal(payload.asset, 'CSPR');
  assert.equal(payload.memo, 'mnd_casper');
  assert.match(payload.attestation.intent_hash, /^[a-f0-9]{64}$/);
  assert.equal(payload.attestation.approval_sig, 'b'.repeat(64));
});

test('coinbase rail stages an institutional wallet payload', () => {
  const payload = settlementPayload({
    id: 'mnd_coinbase',
    intent: 'top up agent treasury',
    merchant: 'treasury-hot-wallet',
    amount: 25,
    rail: 'coinbase',
    nonce: 'n_coinbase',
    sig: 'c'.repeat(64),
    approval_sig: 'd'.repeat(64),
    currency: 'USD',
  });
  assert.equal(payload.protocol, 'wallet-institutional');
  assert.equal(payload.provider, 'coinbase');
  assert.equal(payload.idempotency_key, 'mnd:mnd_coinbase:n_coinbase');
  assert.equal(payload.provider_fields.memo, 'mnd_coinbase');
});

test('coinbase alias normalizes into the same payload', () => {
  const payload = settlementPayload({
    id: 'mnd_cb_alias',
    intent: 'pay vendor',
    merchant: 'vendor-wallet',
    amount: 4,
    rail: 'cbw',
    nonce: 'n_cb_alias',
    sig: 'e'.repeat(64),
    approval_sig: 'f'.repeat(64),
    currency: 'USD',
  });
  assert.equal(payload.protocol, 'wallet-institutional');
  assert.equal(payload.provider, 'coinbase');
});

test('fireblocks and bitgo rails stage wallet providers', () => {
  const fireblocks = settlementPayload({
    id: 'mnd_fireblocks',
    intent: 'reserve gas wallet',
    merchant: 'ops-wallet',
    amount: 12,
    rail: 'fireblocks',
    nonce: 'n_fireblocks',
    sig: 'a'.repeat(64),
    approval_sig: 'b'.repeat(64),
    currency: 'USD',
  });
  const bitgo = settlementPayload({
    id: 'mnd_bitgo',
    intent: 'pay settlement partner',
    merchant: 'partner-wallet',
    amount: 9,
    rail: 'bitgo',
    nonce: 'n_bitgo',
    sig: 'a'.repeat(64),
    approval_sig: 'b'.repeat(64),
    currency: 'USD',
  });
  assert.equal(fireblocks.provider, 'fireblocks');
  assert.equal(bitgo.provider, 'bitgo');
});

test('approval proof binds who approved, when, and how', () => {
  const key = Buffer.alloc(32, 9);
  const approval = { sig: 'a'.repeat(64), approved_by: 'rajiv', approved_at: 1234, approval_method: 'gesture' };
  approval.approval_sig = signApprovalWithKey(approval, key);
  assert.equal(verifyApprovalWithKey(approval, key), true);
  assert.equal(verifyApprovalWithKey({ ...approval, approved_at: 9999 }, key), false);
  assert.equal(verifyApprovalWithKey({ ...approval, approval_method: 'cli' }, key), false);
});

test('gesture approval requires a deliberate asymmetric tick', () => {
  const tick = [[
    { x: 10, y: 20 }, { x: 18, y: 35 }, { x: 26, y: 50 }, { x: 34, y: 66 },
    { x: 44, y: 76 }, { x: 62, y: 62 }, { x: 82, y: 44 }, { x: 104, y: 24 }, { x: 132, y: 2 },
  ]];
  const verticalU = [[
    { x: 50, y: 10 }, { x: 49, y: 25 }, { x: 50, y: 45 }, { x: 49, y: 65 },
    { x: 50, y: 85 }, { x: 51, y: 68 }, { x: 50, y: 48 }, { x: 51, y: 28 }, { x: 50, y: 8 },
  ]];
  assert.equal(gestureApi.recognize(tick), 'approve');
  assert.equal(gestureApi.recognize(verticalU), null);
});

test('gesture rejection requires two long crossing diagonals', () => {
  const cross = [
    [{ x: 10, y: 10 }, { x: 45, y: 45 }, { x: 90, y: 90 }],
    [{ x: 90, y: 10 }, { x: 45, y: 45 }, { x: 10, y: 90 }],
  ];
  const parallel = [
    [{ x: 10, y: 10 }, { x: 45, y: 45 }, { x: 90, y: 90 }],
    [{ x: 30, y: 10 }, { x: 65, y: 45 }, { x: 110, y: 90 }],
  ];
  assert.equal(gestureApi.recognize(cross), 'reject');
  assert.equal(gestureApi.recognize(parallel), null);
});

test('external submissions are executable only after approval while credentials and money stay manual', () => {
  assert.equal(isApprovableAction('publish the prepared release'), true);
  assert.equal(isApprovableAction('upload the signed app build'), true);
  assert.equal(isApprovableAction('submit the completed store listing'), true);
  assert.equal(isApprovableAction('log in then publish the release'), false);
  assert.equal(isApprovableAction('pay the store fee and submit'), false);
  assert.equal(isApprovableAction('submit a futures order'), false);
});

test('approval preparation cannot become ready without concrete evidence', () => {
  assert.equal(approvalPacketFromOutput('BEE_APPROVAL_SUMMARY: Looks ready\nBEE_OUTCOME: blocked'), null);
  assert.deepEqual(approvalPacketFromOutput('BEE_APPROVAL_SUMMARY: Build is staged\nBEE_APPROVAL_EVIDENCE: app.aab exists, 57 MB\nBEE_APPROVAL_URL: https://play.google.com/console/'), {
    summary: 'Build is staged', evidence: 'app.aab exists, 57 MB', url: 'https://play.google.com/console/',
  });
});

test('merchant and receipt regexes block obvious control-character injection', () => {
  const merchantRe = /^[a-zA-Z0-9._:@/-]{2,160}$/;
  const receiptRe = /^[a-zA-Z0-9._:@/-]{6,240}$/;
  assert.equal(merchantRe.test('vendor\nrm -rf /'), false);
  assert.equal(merchantRe.test('valid-merchant_01'), true);
  assert.equal(receiptRe.test('pi_1AbCdEFghiJKL-1234'), true);
  assert.equal(receiptRe.test('rcpt\tbad'), false);
});

test('wallet adapters expose readiness and missing env keys deterministically', () => {
  const coinbase = walletAdapterReady('coinbase');
  assert.equal(Array.isArray(coinbase.missing), true);
  assert.equal(typeof coinbase.ok, 'boolean');
  const unknown = walletAdapterReady('unknown-wallet');
  assert.equal(unknown.ok, false);
});

test('wallet receipt validation is provider-aware', () => {
  assert.equal(walletReceiptLooksValid('coinbase', 'cb_txn_123456'), true);
  assert.equal(walletReceiptLooksValid('coinbase', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'), true);
  assert.equal(walletReceiptLooksValid('coinbase', 'random receipt value'), false);
});
