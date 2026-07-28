//! GitHub HTTP adapter for PAT validation, OAuth code exchange, and App install listing.

use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION, LINK};
use serde::Deserialize;

use crate::core::{AppInstallSnapshot, GitHub, GitHubError, RepoId, StoredCredentials};

const USER_AGENT_VALUE: &str = "Issuebridge/0.1";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const USER_URL: &str = "https://api.github.com/user";
const INSTALLATIONS_URL: &str = "https://api.github.com/user/installations";
const API_VERSION: &str = "2022-11-28";

/// Public install URL for the maintainer GitHub App (selected repositories).
pub const APP_INSTALL_URL: &str = "https://github.com/apps/issuebridge-dev/installations/new";

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

#[derive(Debug, Deserialize)]
struct InstallationsResponse {
    installations: Vec<Installation>,
}

#[derive(Debug, Deserialize)]
struct Installation {
    id: u64,
    app_slug: Option<String>,
    repository_selection: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReposResponse {
    repositories: Vec<RepoJson>,
}

#[derive(Debug, Deserialize)]
struct RepoJson {
    name: String,
    owner: OwnerJson,
}

#[derive(Debug, Deserialize)]
struct OwnerJson {
    login: String,
}

impl GitHub for HttpGitHub {
    fn validate_pat(&self, pat: &str) -> Result<(), GitHubError> {
        let response = self
            .client
            .get(USER_URL)
            .header(AUTHORIZATION, format!("Bearer {pat}"))
            .header(ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
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

    fn list_app_install_snapshot(
        &self,
        token: &str,
    ) -> Result<AppInstallSnapshot, GitHubError> {
        let installations = self.fetch_installations(token)?;
        let ours: Vec<&Installation> = installations
            .iter()
            .filter(|inst| inst.app_slug.as_deref() == Some("issuebridge-dev"))
            .collect();

        if ours.is_empty() {
            return Ok(AppInstallSnapshot {
                has_install: false,
                repos: Vec::new(),
                all_repositories: false,
            });
        }

        let all_repositories = ours.iter().any(|inst| {
            inst.repository_selection
                .as_deref()
                .is_some_and(|s| s.eq_ignore_ascii_case("all"))
        });

        let mut repos = Vec::new();
        for inst in ours {
            let mut page_repos = self.fetch_installation_repos(token, inst.id)?;
            repos.append(&mut page_repos);
        }
        repos.sort_by(|a, b| (&a.owner, &a.name).cmp(&(&b.owner, &b.name)));
        repos.dedup();

        Ok(AppInstallSnapshot {
            has_install: true,
            repos,
            all_repositories,
        })
    }
}

impl HttpGitHub {
    fn fetch_installations(&self, token: &str) -> Result<Vec<Installation>, GitHubError> {
        let mut url = Some(format!("{INSTALLATIONS_URL}?per_page=100"));
        let mut all = Vec::new();

        while let Some(current) = url {
            let response = self
                .client
                .get(&current)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header(ACCEPT, "application/vnd.github+json")
                .header("X-GitHub-Api-Version", API_VERSION)
                .send()
                .map_err(|_| GitHubError::Unavailable)?;

            match response.status().as_u16() {
                200 => {}
                401 | 403 => return Err(GitHubError::InvalidCredentials),
                _ => return Err(GitHubError::Unavailable),
            }

            let next = next_link(response.headers().get(LINK).and_then(|v| v.to_str().ok()));
            let body: InstallationsResponse =
                response.json().map_err(|_| GitHubError::Unavailable)?;
            all.extend(body.installations);
            url = next;
        }

        Ok(all)
    }

    fn fetch_installation_repos(
        &self,
        token: &str,
        installation_id: u64,
    ) -> Result<Vec<RepoId>, GitHubError> {
        let mut url = Some(format!(
            "{INSTALLATIONS_URL}/{installation_id}/repositories?per_page=100"
        ));
        let mut repos = Vec::new();

        while let Some(current) = url {
            let response = self
                .client
                .get(&current)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header(ACCEPT, "application/vnd.github+json")
                .header("X-GitHub-Api-Version", API_VERSION)
                .send()
                .map_err(|_| GitHubError::Unavailable)?;

            match response.status().as_u16() {
                200 => {}
                401 | 403 => return Err(GitHubError::InvalidCredentials),
                _ => return Err(GitHubError::Unavailable),
            }

            let next = next_link(response.headers().get(LINK).and_then(|v| v.to_str().ok()));
            let body: ReposResponse = response.json().map_err(|_| GitHubError::Unavailable)?;
            for r in body.repositories {
                repos.push(RepoId {
                    owner: r.owner.login,
                    name: r.name,
                });
            }
            url = next;
        }

        Ok(repos)
    }
}

/// Parse GitHub `Link` header for `rel="next"`.
fn next_link(header: Option<&str>) -> Option<String> {
    let header = header?;
    for part in header.split(',') {
        let part = part.trim();
        let mut href = None;
        let mut is_next = false;
        for section in part.split(';') {
            let section = section.trim();
            if let Some(rest) = section.strip_prefix('<').and_then(|s| s.strip_suffix('>')) {
                href = Some(rest.to_string());
            } else if section == "rel=\"next\"" || section == "rel='next'" {
                is_next = true;
            }
        }
        if is_next {
            return href;
        }
    }
    None
}

