# Issuebridge OAuth exchange

Tiny HTTPS backend that holds the GitHub App **client secret** and exchanges Authorization Code + PKCE tokens for the desktop app.

Official NSIS builds bake this URL and the public client id at compile time, and prefer the baked values over the process environment. They never embed the client secret.

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

Needs PHP 8.0+ with cURL.

1. Upload [`cpanel/exchange.php`](cpanel/exchange.php) and [`cpanel/.htaccess`](cpanel/.htaccess) to a HTTPS site you control.
2. Copy [`cpanel/config.example.php`](cpanel/config.example.php), fill in the real `client_id` / `client_secret`, and save it **outside the served web root** — never in the same folder as `exchange.php`. Either:
   - put it anywhere outside the web root and set the environment variable `ISSUEBRIDGE_OAUTH_CONFIG` to its absolute path (works wherever `exchange.php` lives), or
   - name it `issuebridge-oauth-config.php` and put it in the folder **above** `exchange.php`. This is only outside the web root when `exchange.php` sits directly in `public_html`. If `exchange.php` is in a subfolder such as `public_html/oauth/`, the folder above is `public_html` itself, which is served: use `ISSUEBRIDGE_OAUTH_CONFIG` instead.

   The exchange answers `server_misconfigured` until it finds one; the full lookup order is in the header of [`exchange.php`](cpanel/exchange.php).
3. Point `ISSUEBRIDGE_OAUTH_EXCHANGE_URL` at that PHP URL.

**Upgrading an existing deployment:**

- A `config.php` beside `exchange.php` still loads, but is deprecated and logged: move it out of the web root as above.
- If you followed the older advice to keep the config outside the web root by **editing the `require` path** in `exchange.php`, the new `exchange.php` will not find it, and Sign-in fails with `server_misconfigured`. Before uploading the new script, set `ISSUEBRIDGE_OAUTH_CONFIG` to that file's absolute path, or rename the file to `issuebridge-oauth-config.php` in the folder above `exchange.php`.

**About the `.htaccess`:** on Apache 2.4 it refuses to serve any config file, backup or editor swap copy that ends up beside `exchange.php`, as defence in depth. It is not a substitute for keeping the config outside the web root. It needs the host to allow `AllowOverride AuthConfig` (or `All`) for that folder; on a host that does not, Apache answers 500 for the whole folder, including `exchange.php`. If that happens, remove the `.htaccess` and rely on the config being outside the web root.

No app code changes when switching hosts — only the URL.

## After first production deploy

1. Smoke-test Sign-in with a build that has **no** `ISSUEBRIDGE_GITHUB_CLIENT_SECRET` in the environment or binary.
2. **Rotate** the GitHub App client secret so older installers that embedded it can no longer exchange codes.
3. Ship a Release; mark ledger `client-secret-in-release-binary` as `fixed`; publish the GHSA when ready.
