//! Authorization Code + PKCE helpers and fixed loopback callback listener.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::Rng;
use sha2::{Digest, Sha256};
use url::Url;

use super::github_http::{github_client_id, OAUTH_REDIRECT_URI};

pub const LOOPBACK_ADDR: &str = "127.0.0.1:17863";
const CALLBACK_PATH: &str = "/oauth/callback";

#[derive(Debug, Clone)]
pub struct PkcePair {
    pub verifier: String,
    pub challenge: String,
}

#[derive(Debug, thiserror::Error)]
pub enum OAuthLoopbackError {
    #[error("could not bind {LOOPBACK_ADDR} — is another Issuebridge sign-in in progress?")]
    PortBusy,
    #[error("timed out waiting for GitHub callback")]
    Timeout,
    #[error("OAuth state mismatch")]
    StateMismatch,
    #[error("callback missing authorization code")]
    MissingCode,
    #[error("authorization denied or failed")]
    Denied,
    #[error("loopback I/O error")]
    Io,
}

pub fn generate_state() -> String {
    random_url_safe(32)
}

pub fn generate_pkce() -> PkcePair {
    let verifier = random_url_safe(64);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest);
    PkcePair {
        verifier,
        challenge,
    }
}

pub fn authorize_url(state: &str, pkce: &PkcePair) -> String {
    let mut url = Url::parse("https://github.com/login/oauth/authorize").expect("authorize url");
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("client_id", github_client_id());
        query.append_pair("redirect_uri", OAUTH_REDIRECT_URI);
        query.append_pair("state", state);
        query.append_pair("code_challenge", &pkce.challenge);
        query.append_pair("code_challenge_method", "S256");
    }
    url.to_string()
}

/// Bind the fixed loopback port before opening the system browser.
pub fn bind_loopback() -> Result<TcpListener, OAuthLoopbackError> {
    let listener = TcpListener::bind(LOOPBACK_ADDR).map_err(|err| {
        if err.kind() == std::io::ErrorKind::AddrInUse {
            OAuthLoopbackError::PortBusy
        } else {
            OAuthLoopbackError::Io
        }
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|_| OAuthLoopbackError::Io)?;
    Ok(listener)
}

/// Wait for the GitHub redirect on an already-bound listener; verify `state`; return `code`.
pub fn wait_for_authorization_code(
    listener: &TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<String, OAuthLoopbackError> {
    let start = std::time::Instant::now();
    loop {
        if start.elapsed() > timeout {
            return Err(OAuthLoopbackError::Timeout);
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let (code, state, error) = parse_callback_request(&request)?;

                if let Some(err) = error {
                    let _ = write_html_response(
                        &mut stream,
                        400,
                        &format!("Sign-in failed ({err}). You can close this tab."),
                    );
                    return Err(OAuthLoopbackError::Denied);
                }

                if state.as_deref() != Some(expected_state) {
                    let _ = write_html_response(
                        &mut stream,
                        400,
                        "Sign-in failed (state mismatch). You can close this tab.",
                    );
                    return Err(OAuthLoopbackError::StateMismatch);
                }

                let code = code.ok_or(OAuthLoopbackError::MissingCode)?;
                let _ = write_html_response(
                    &mut stream,
                    200,
                    "Signed in to Issuebridge. You can close this tab and return to the app.",
                );
                return Ok(code);
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return Err(OAuthLoopbackError::Io),
        }
    }
}

fn parse_callback_request(
    request: &str,
) -> Result<(Option<String>, Option<String>, Option<String>), OAuthLoopbackError> {
    let first_line = request.lines().next().unwrap_or("");
    let path = first_line.split_whitespace().nth(1).unwrap_or("");
    let url = Url::parse(&format!("http://127.0.0.1{path}")).map_err(|_| OAuthLoopbackError::Io)?;

    if url.path() != CALLBACK_PATH {
        return Err(OAuthLoopbackError::MissingCode);
    }

    let mut code = None;
    let mut state = None;
    let mut error = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            _ => {}
        }
    }
    Ok((code, state, error))
}

fn write_html_response(
    stream: &mut impl Write,
    status: u16,
    message: &str,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        _ => "Bad Request",
    };
    let body = format!("<!doctype html><html><body><p>{message}</p></body></html>");
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

fn random_url_safe(byte_len: usize) -> String {
    let mut bytes = vec![0u8; byte_len];
    rand::thread_rng().fill(bytes.as_mut_slice());
    URL_SAFE_NO_PAD.encode(bytes)
}
