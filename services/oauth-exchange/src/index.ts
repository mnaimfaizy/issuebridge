/**
 * Issuebridge OAuth code exchange (Cloudflare Worker).
 * Holds GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET as Worker secrets.
 */

const ALLOWED_REDIRECT_URI = "http://127.0.0.1:17863/oauth/callback";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

interface ExchangeBody {
  client_id?: string;
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    let body: ExchangeBody;
    try {
      body = (await request.json()) as ExchangeBody;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const clientId = (body.client_id ?? "").trim();
    const code = (body.code ?? "").trim();
    const codeVerifier = (body.code_verifier ?? "").trim();
    const redirectUri = (body.redirect_uri ?? "").trim();

    if (!clientId || !code || !codeVerifier || !redirectUri) {
      return json({ error: "invalid_request" }, 400);
    }
    if (redirectUri !== ALLOWED_REDIRECT_URI) {
      return json({ error: "invalid_redirect_uri" }, 400);
    }
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return json({ error: "server_misconfigured" }, 500);
    }
    if (clientId !== env.GITHUB_CLIENT_ID) {
      return json({ error: "invalid_client" }, 400);
    }

    const gh = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Issuebridge-OAuth-Exchange/0.1",
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: ALLOWED_REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    const text = await gh.text();
    return new Response(text, {
      status: gh.status,
      headers: { "Content-Type": "application/json" },
    });
  },
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
