# Release Workflow

Prepare and cut a release for the specified target.

## Target

$ARGUMENTS

Valid targets: `api` (Cloudflare Workers), `ios` (EAS TestFlight), `android` (EAS Play Store), `dashboard` (Vercel)

---

## API Release (Cloudflare Workers)

1. **Pre-flight checks**
   - [ ] `npx tsc --noEmit` passes in `apps/api-edge`
   - [ ] No TODO/FIXME/HACK comments in changed files
   - [ ] All secrets confirmed set: `npx wrangler secret list`
   - [ ] `CLAUDE.md` secrets reference is up to date

2. **Deploy**
   ```bash
   cd apps/api-edge && npx wrangler deploy
   ```

3. **Smoke test**
   ```bash
   curl -s https://api.agentpay.so/api/health
   curl -s https://api.agentpay.so/api/agents/match?limit=1
   ```

4. **Monitor**
   - Watch CF Tail for errors: `npx wrangler tail --format pretty`
   - Check for `broLog` entries with `level: error`

---

## iOS Release (EAS + TestFlight)

1. **Pre-flight**
   - [ ] `app.json` version / buildNumber incremented
   - [ ] All EAS secrets set: `npx eas secret:list`
   - [ ] Push notifications entitlement confirmed

2. **Build + Submit**
   ```bash
   cd apps/meridian
   npx eas build --platform ios --profile production
   npx eas submit --platform ios --latest
   ```

3. **Post-submit**
   - Monitor at expo.dev/accounts/rumblingb/projects/meridian
   - Wait for Apple processing (~15 min)
   - Add to TestFlight group when available

---

## Android Release (EAS + Play Store)

1. **Pre-flight**
   - [ ] EAS Android quota available (resets monthly — free tier)
   - [ ] `app.json` versionCode incremented

2. **Build**
   ```bash
   cd apps/meridian
   npx eas build --platform android --profile production
   ```

3. **Submit**
   ```bash
   npx eas submit --platform android --latest
   ```

---

## Dashboard Release (Vercel)

Vercel auto-deploys on push to main. Manual trigger:
```bash
cd dashboard && npx vercel --prod
```

---

After release, update `MEMORY.md` with session notes.
