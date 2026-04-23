Practitioner Dashboard Prototype

This is a minimal, runnable prototype to demonstrate a non-technical practitioner workflow for creating invoices/claims, submitting them, seeing exceptions, and simulating payment/webhook events.

Files:
- `index.html` — static UI to create/list invoices and view exception inbox.
- `app.js` — client-side logic calling the mock API.
- `mock-server.js` — lightweight Express mock server implementing invoice APIs and webhook history.
- `package.json` — dev dependencies and run scripts.

Run locally (use the same repo API and DB)

1. Start the repository API server (root of repo). Ensure the server is running on `http://localhost:3000`.

2. Enable test-mode so the prototype can use a development API key bypass. In your root `.env` or environment, set:

```bash
AGENTPAY_TEST_MODE=true
```

3. Open a browser to the prototype folder and open `index.html` directly, or serve the folder statically. The prototype will call the repo API at `http://localhost:3000/api/merchants` and uses the test key `sk_test_sim` automatically.

4. Create a draft invoice in the UI, then click `Submit` to create a transaction via the real API. Use `Simulate Pay` to call the verification endpoint and mark it confirmed.

Notes
- This prototype now uses the real API and DB; drafts are stored locally in `localStorage` and merged with server transactions for display.
- For production flows, replace the local draft persistence with a proper datastore and add authentication for real users.
