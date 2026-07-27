//! GitHub HTTP adapter for PAT validation and OAuth code exchange.

use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION};
use serde::Deserialize;

use crate::core::{GitHub, GitHubError, StoredCredentials};

const USER_AGENT_VALUE: &str = "Issuebridge/0.1";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const USER_URL: &str = "https://api.github.com/user";

/// Maintainer GitHub App client id (public). Secret injected at build time when present.
pub fn github_client_id() -> &'static str {
    option_env!("ISSUEBRIDGE_GITHUB_CLIENT_ID").unwrap_or("Iv23li6Ao8URyrvbNZOq")
}

pub fn github_client_secret() -> Option<&'static str> {
    option_env!("ISSUEBRIDGE_GITHUB_CLIENT_SECRET")
}

pub const OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:17863/oauth/callback";

#[derive(Debug)]
pub struct HttpGitHub {
    client: Client,
    client_id: String,
    client_secret: Option<String>,
}

impl Default for HttpGitHub {
    fn default() -> Self {
        Self::new(
            github_client_id().to_string(),
            github_client_secret().map(str::to_string),
        )
    }
}

impl HttpGitHub {
    pub fn new(client_id: String, client_secret: Option<String>) -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT_VALUE)
            .build()
            .expect("reqwest client");
        Self {
            client,
            client_id,
            client_secret,
        }
    }
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    error: Option<String>,
}

impl GitHub for HttpGitHub {
    fn validate_pat(&self, pat: &str) -> Result<(), GitHubError> {
        let response = self
            .client
            .get(USER_URL)
            .header(AUTHORIZATION, format!("Bearer {pat}"))
            .header(ACCEPT, "application/vnd.github+json")
            .send()
            .map_err(|_| GitHubError::Unavailable)?;

        match response.status().as_u16() {
            200 => Ok(()),
            401 | 403 => Err(GitHubError::InvalidCredentials),
            _ => Err(GitHubError::Unavailable),
        }
    }

    fn exchange_oauth_code(
        &self,
        code: &str,
        code_verifier: &str,
    ) -> Result<StoredCredentials, GitHubError> {
        let secret = self
            .client_secret
            .as_deref()
            .ok_or(GitHubError::Unavailable)?;

        let response = self
            .client
            .post(TOKEN_URL)
            .header(ACCEPT, "application/json")
            .json(&serde_json::json!({
                "client_id": self.client_id,
                "client_secret": secret,
                "code": code,
                "redirect_uri": OAUTH_REDIRECT_URI,
                "code_verifier": code_verifier,
            }))
            .send()
            .map_err(|_| GitHubError::Unavailable)?;

        if !response.status().is_success() {
            return Err(GitHubError::Unavailable);
        }

        let body: TokenResponse = response.json().map_err(|_| GitHubError::Unavailable)?;

        if body.error.is_some() {
            return Err(GitHubError::InvalidCredentials);
        }

        let access_token = body.access_token.ok_or(GitHubError::InvalidCredentials)?;
        if access_token.is_empty() {
            return Err(GitHubError::InvalidCredentials);
        }

        Ok(StoredCredentials {
            access_token,
            refresh_token: body.refresh_token.filter(|t| !t.is_empty()),
        })
    }
}
