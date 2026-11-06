<?php
/**
 * Issuebridge OAuth code exchange (cPanel / shared hosting).
 * Same JSON contract as the Cloudflare Worker — point ISSUEBRIDGE_OAUTH_EXCHANGE_URL here.
 *
 * The config file holds the GitHub App client secret, so keep it OUTSIDE the
 * served web root (see config.example.php). Resolution order:
 *   1. ISSUEBRIDGE_OAUTH_CONFIG — an absolute path, set in the host's environment;
 *   2. issuebridge-oauth-config.php in the directory ABOVE this script, which is
 *      outside the web root when this script sits at the top of public_html;
 *   3. config.php beside this script — legacy only, logged as deprecated, and
 *      refused over HTTP by the shipped .htaccess on Apache hosts.
 * When none is readable the exchange fails closed with `server_misconfigured`.
 */

declare(strict_types=1);

header('Content-Type: application/json');

const ALLOWED_REDIRECT_URI = 'http://127.0.0.1:17863/oauth/callback';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed']);
    exit;
}

/**
 * The secret-bearing config file to load, or null when none is usable.
 * An explicit ISSUEBRIDGE_OAUTH_CONFIG must be absolute and readable; it never
 * falls through to another location, so a typo fails closed rather than
 * silently picking up a file inside the web root.
 */
function issuebridge_config_path(): ?string
{
    $explicit = getenv('ISSUEBRIDGE_OAUTH_CONFIG');
    if (is_string($explicit) && $explicit !== '') {
        $absolute = str_starts_with($explicit, '/') || preg_match('/^[A-Za-z]:[\\\\\/]/', $explicit) === 1;
        return $absolute && is_file($explicit) && is_readable($explicit) ? $explicit : null;
    }

    $outsideWebRoot = dirname(__DIR__) . '/issuebridge-oauth-config.php';
    if (is_file($outsideWebRoot) && is_readable($outsideWebRoot)) {
        return $outsideWebRoot;
    }

    $legacy = __DIR__ . '/config.php';
    if (is_file($legacy) && is_readable($legacy)) {
        error_log('issuebridge-oauth-exchange: config.php beside exchange.php is deprecated; move it outside the web root (see README).');
        return $legacy;
    }

    return null;
}

$configPath = issuebridge_config_path();
if ($configPath === null) {
    http_response_code(500);
    echo json_encode(['error' => 'server_misconfigured']);
    exit;
}

/** @var array{client_id: string, client_secret: string} $config */
$config = require $configPath;

$raw = file_get_contents('php://input');
$body = json_decode($raw ?: '', true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_json']);
    exit;
}

$clientId = trim((string) ($body['client_id'] ?? ''));
$code = trim((string) ($body['code'] ?? ''));
$codeVerifier = trim((string) ($body['code_verifier'] ?? ''));
$redirectUri = trim((string) ($body['redirect_uri'] ?? ''));

if ($clientId === '' || $code === '' || $codeVerifier === '' || $redirectUri === '') {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_request']);
    exit;
}

if ($redirectUri !== ALLOWED_REDIRECT_URI) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_redirect_uri']);
    exit;
}

if (
    empty($config['client_id']) ||
    empty($config['client_secret']) ||
    $clientId !== $config['client_id']
) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_client']);
    exit;
}

$payload = json_encode([
    'client_id' => $config['client_id'],
    'client_secret' => $config['client_secret'],
    'code' => $code,
    'redirect_uri' => ALLOWED_REDIRECT_URI,
    'code_verifier' => $codeVerifier,
]);

$ch = curl_init(TOKEN_URL);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Accept: application/json',
        'Content-Type: application/json',
        'User-Agent: Issuebridge-OAuth-Exchange/0.1',
    ],
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
]);

$response = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'upstream_unavailable']);
    exit;
}

http_response_code($status > 0 ? $status : 502);
echo $response;
