# Issuebridge OAuth exchange

Tiny HTTPS backend that holds the GitHub App **client secret** and exchanges Authorization Code + PKCE tokens for the desktop app.

Official NSIS builds bake only `ISSUEBRIDGE_OAUTH_EXCHANGE_URL` (public). They never embed the client secret.

Free Cloudflare Workers (100k requests/day) is enough for limited users. The same JSON contract works on cPanel PHP if you prefer shared hosting.

## Contract

`POST /` (or your PHP path) with `Content-Type: application/json`:

```json
{
  "client_id": "<GitHub App client id>",
  "code": "<authorization code>",
  "code_verifier": "<PKCE verifier>",
  "redirect_uri": "http://127.0.0.1:17863/oauth/callback"
}
```

- `redirect_uri` must be exactly that loopback value.
- `client_id` must match the App configured on the server.
- Response: GitHub’s token JSON (`access_token`, optional `refresh_token`, or `error`).
- Never log codes, verifiers, tokens, or the client secret.

## Cloudflare Worker (recommended)

```bash
cd services/oauth-exchange
npm install
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler deploy
```

Copy the deployed `https://….workers.dev` URL (or custom domain) into:

- Local: `$env:ISSUEBRIDGE_OAUTH_EXCHANGE_URL = "https://…"`
- Release / Actions secret: `ISSUEBRIDGE_OAUTH_EXCHANGE_URL`

Workers Free plan is fine for Sign-in traffic.

## cPanel PHP (alternative)

1. Upload [`cpanel/exchange.php`](cpanel/exchange.php) to a HTTPS site you control.
2. Place [`cpanel/config.example.php`](cpanel/config.example.php) beside it as `config.php` (outside public HTML if you can) with real `client_id` / `client_secret`.
3. Point `ISSUEBRIDGE_OAUTH_EXCHANGE_URL` at that PHP URL.

No app code changes when switching hosts — only the URL.

## After first production deploy

1. Smoke-test Sign-in with a build that has **no** `ISSUEBRIDGE_GITHUB_CLIENT_SECRET` in the environment or binary.
2. **Rotate** the GitHub App client secret so older installers that embedded it can no longer exchange codes.
3. Ship a Release; mark ledger `client-secret-in-release-binary` as `fixed`; publish the GHSA when ready.
