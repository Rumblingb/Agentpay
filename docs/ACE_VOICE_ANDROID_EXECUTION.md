# Ace voice + Android execution contract

## Product outcome

Ace should let a traveller ask once, understand the whole trip, present only two or three meaningful choices, take one explicit selection, obtain governed payment authority, execute, and stay with the journey through recovery and proof.

The voice surface is a front door. AgentPay remains the authority layer for mandate, identity release, approval, funding, execution continuity, receipts, and audit.

## End-to-end state machine

1. Listen and understand intent. Keep interruptions and corrections in the same session.
2. Resolve only missing constraints. Do not make the traveller repeat known context.
3. Plan against live supplier data and return two or three ranked options.
4. Require an explicit option selection. Never send an unchosen default to payment.
5. Freeze the selected option, total, currency, traveller set, expiry, and supplier into a canonical plan digest.
6. Ask the device for local authentication, then confirm the server-held approval token bound to that digest.
7. Atomically consume the approved action once, ignore any client-mutated plan, and return the cached result on retry.
8. Confirm funding before supplier dispatch.
9. Return supplier proof, AgentPay receipt, and a resumable journey state.
10. On expiry, auth failure, price change, or supplier failure, preserve context and offer at most three recovery choices.

## What this pass now enforces

Hotel search returns exactly three options. Each option can carry a short-lived Google Places image and required author attribution. No Maps key is sent to the mobile app.

Ace does not ask for biometric or payment confirmation until the traveller selects a hotel. The selected hotel becomes the single bestOption carried into the existing confirmation and execution flow.

Android uses the device-appropriate label: Fingerprint, Face recognition, or Device security. iOS continues to use Face ID where available.

AgentPay Core now stores the exact actionable plan, principal, amount, currency, action kind, expiry, and canonical digest in a one-time execution approval. Ace confirms that session after the local device gate. Execution reloads the stored plan, atomically claims it once, and caches the completed response for idempotent retry.

The database change is in migrations/20260722_execution_approvals.sql and must be applied before deploying the Worker changes.

## Native attestation still required

The current expo-local-authentication result is a local boolean. It is useful as a device gate, but it is not cryptographic proof to AgentPay and is not sufficient for high-value replay-safe authorization.

The remaining Android security step is to sign the existing server challenge through Credential Manager/passkeys or an Android Keystore auth-per-use key exposed through BiometricPrompt CryptoObject. The server must then verify signature, origin or app binding, and challenge before marking the already plan-bound session approved.

Do not wire the local boolean into the universal approval route and describe that as secure approval. Do not accept a mutable client plan after approval.

## Voice runtime direction

Keep speech continuous across tool calls, approval pauses, and recoveries. Use semantic turn detection where supported, allow interruption, keep tool execution cancellable, and use ephemeral client tokens. Approval-required tools must pause without losing the voice session and resume with the original call ID after AgentPay authority is restored.

Voice narration should lead with the recommendation and one reason, then offer the other one or two options. The screen supplies imagery and comparison detail; speech should not read every field.

## QA release gate

Walk each flow on an Android device and an older iPhone:

- fresh install and returning traveller
- microphone denied, interrupted, and background/resume
- slow or failed speech, planning, image, payment, and supplier calls
- first, second, and third hotel selected by voice and tap
- stale image URL and missing attribution fallback
- price or availability changes after selection
- biometric unavailable, cancelled, failed, and device-credential fallback
- approval replay, mutated plan rejection, expiry, and cached-result retry
- payment success with supplier failure and exact-action recovery
- live journey resume and reroute notification tap

## Current delivery boundary

Hotel prices may still be indicative and hotel execution may end at a partner checkout link. Train fulfilment can remain operations-assisted, and flight planning currently carries one selected offer. These surfaces must not be described as fully autonomous until supplier confirmation is real. The plan-bound approval seam prevents client tampering and replay, but it does not turn an operations-assisted supplier path into autonomous fulfilment.

## Primary references

- Android biometric authentication: https://developer.android.com/identity/sign-in/biometric-auth
- Android BiometricPrompt CryptoObject: https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt.CryptoObject.html
- Google passkeys developer guide: https://developers.google.com/identity/passkeys/developer-guides
- Google Places photos: https://developers.google.com/maps/documentation/places/web-service/place-photos
- OpenAI voice agents: https://openai.github.io/openai-agents-js/guides/voice-agents/
- OpenAI human-in-the-loop approvals: https://openai.github.io/openai-agents-js/guides/human-in-the-loop/
