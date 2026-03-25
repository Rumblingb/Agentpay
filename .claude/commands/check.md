# Security & Quality Check

Run a comprehensive security and quality audit on the specified scope.

## Scope

$ARGUMENTS

If no scope specified, audit the full `apps/api-edge/src/routes/` directory.

---

## Checklist

### Authentication & Authorization
- [ ] All routes have auth checks (x-bro-key or x-admin-key where required)
- [ ] No route leaks data without checking ownership (hirerId, userId)
- [ ] Webhook endpoints verify signatures (Stripe HMAC, Razorpay HMAC)

### Injection & Input Validation
- [ ] No user input is string-interpolated into SQL — parameterized queries only
- [ ] No user input is passed to `eval()`, `exec()`, `Function()`, `shell`
- [ ] No user input is reflected into HTML without escaping (XSS)
- [ ] All JSON body parsing has error handling

### Secret Exposure
- [ ] No secrets in code (API keys, tokens, passwords)
- [ ] No secrets logged to console or CF Tail
- [ ] All secrets come from `env.VARIABLE` (Wrangler secrets / EAS secrets)

### Edge Compatibility
- [ ] No Node.js built-ins (`fs`, `path`, `crypto` from node)
- [ ] `crypto.subtle` used for hashing, not Node crypto
- [ ] No `require()` — use ES module `import`
- [ ] All DB connections closed in `finally` block

### Error Handling
- [ ] No stack traces returned to client (500 responses use generic messages)
- [ ] All async/await wrapped in try/catch
- [ ] Timeouts set on external API calls (AbortSignal.timeout)

### Rate Limiting & Abuse
- [ ] High-cost endpoints (Claude API calls, IRCTC, Darwin) have rate limiting
- [ ] Admin endpoints are not publicly accessible

### Payment Security
- [ ] Stripe checkout sessions use `payment_intent_data.metadata` for job tracking
- [ ] No amount manipulation possible from client
- [ ] Razorpay webhook verifies HMAC before processing

---

Report findings as: **CRITICAL** / **HIGH** / **MEDIUM** / **LOW** with file:line references.
Fix all CRITICAL and HIGH issues immediately.
