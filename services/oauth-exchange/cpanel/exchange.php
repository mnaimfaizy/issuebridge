<?php
/**
 * Issuebridge OAuth code exchange (cPanel / shared hosting).
 * Same JSON contract as the Cloudflare Worker — point ISSUEBRIDGE_OAUTH_EXCHANGE_URL here.
 *
 * Place config.php beside this file (see config.example.php). Prefer a path outside the web root.
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

$configPath = __DIR__ . '/config.php';
if (!is_readable($configPath)) {
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
