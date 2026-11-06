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
    let client_id = github_client_id();
    let mut url = Url::parse("https://github.com/login/oauth/authorize").expect("authorize url");
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("client_id", &client_id);
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

                // This branch runs before the state check, so any page can reach
                // it: answer with fixed text and never echo the `error` value.
                if error.is_some() {
                    let _ = write_html_response(
                        &mut stream,
                        400,
                        "Sign-in was cancelled or failed. You can close this tab and try again from Issuebridge.",
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

type CallbackQuery = (Option<String>, Option<String>, Option<String>);

fn parse_callback_request(request: &str) -> Result<CallbackQuery, OAuthLoopbackError> {
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

fn write_html_response(stream: &mut impl Write, status: u16, message: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        _ => "Bad Request",
    };
    let body = format!(
        "<!doctype html><html><body><p>{}</p></body></html>",
        escape_html(message)
    );
    // The page is plain text: no script, no framing, no type sniffing, no caching.
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Security-Policy: default-src 'none'\r\nX-Frame-Options: DENY\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

/// Escape text for an HTML element body, so no message can become markup.
fn escape_html(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn random_url_safe(byte_len: usize) -> String {
    let mut bytes = vec![0u8; byte_len];
    rand::thread_rng().fill(bytes.as_mut_slice());
    URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream;

    /// Send one raw request to a test listener and return the full response.
    fn callback_round_trip(request_target: &str) -> (Result<String, OAuthLoopbackError>, String) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let request = format!("GET {request_target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream.write_all(request.as_bytes()).unwrap();
            let mut response = String::new();
            let _ = stream.read_to_string(&mut response);
            response
        });
        let result =
            wait_for_authorization_code(&listener, "expected-state", Duration::from_secs(5));
        (result, client.join().unwrap())
    }

    #[test]
    fn denied_callback_does_not_reflect_its_error_value() {
        // The error branch runs before the state check, so any page can reach it.
        let (result, response) =
            callback_round_trip("/oauth/callback?error=%3Cb%3Eprobe%3C%2Fb%3E");
        assert!(matches!(result, Err(OAuthLoopbackError::Denied)));
        assert!(
            !response.contains("probe"),
            "error value reflected: {response}"
        );
        assert!(!response.contains("<b>"), "markup reflected: {response}");
    }

    #[test]
    fn callback_pages_forbid_script_framing_and_sniffing() {
        for target in [
            "/oauth/callback?error=access_denied",
            "/oauth/callback?code=c&state=wrong",
            "/oauth/callback?code=c&state=expected-state",
        ] {
            let (_, response) = callback_round_trip(target);
            let head = response
                .split("\r\n\r\n")
                .next()
                .unwrap()
                .to_ascii_lowercase();
            assert!(
                head.contains("content-security-policy: default-src 'none'"),
                "{target}: {head}"
            );
            assert!(head.contains("x-frame-options: deny"), "{target}: {head}");
            assert!(
                head.contains("x-content-type-options: nosniff"),
                "{target}: {head}"
            );
        }
    }

    #[test]
    fn response_writer_escapes_markup() {
        let mut out = Vec::new();
        write_html_response(&mut out, 400, "a <b>&\"'</b>").unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(
            text.contains("a &lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;"),
            "{text}"
        );
        assert!(!text.contains("<b>"));
    }

    #[test]
    fn successful_callback_still_returns_the_code() {
        let (result, response) =
            callback_round_trip("/oauth/callback?code=abc&state=expected-state");
        assert_eq!(result.unwrap(), "abc");
        assert!(response.starts_with("HTTP/1.1 200 OK"));
    }
}
