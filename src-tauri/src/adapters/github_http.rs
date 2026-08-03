//! GitHub HTTP adapter for PAT validation, OAuth code exchange, App install listing, and issues.

use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION, LINK};
use serde::Deserialize;

use crate::core::{
    AppInstallSnapshot, CreatedIssue, GitHub, GitHubError, RepoId, RepoLabel, StoredCredentials,
};

const USER_AGENT_VALUE: &str = "Issuebridge/0.1";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const USER_URL: &str = "https://api.github.com/user";
const INSTALLATIONS_URL: &str = "https://api.github.com/user/installations";
const API_VERSION: &str = "2022-11-28";

/// Public install URL for the maintainer GitHub App (selected repositories).
pub const APP_INSTALL_URL: &str = "https://github.com/apps/issuebridge-dev/installations/new";

/// Maintainer GitHub App client id (public). Override via env at runtime or build time.
pub fn github_client_id() -> String {
    std::env::var("ISSUEBRIDGE_GITHUB_CLIENT_ID")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| option_env!("ISSUEBRIDGE_GITHUB_CLIENT_ID").map(str::to_string))
        .unwrap_or_else(|| "Iv23li6Ao8URyrvbNZOq".to_string())
}

/// GitHub App client secret. Prefer runtime env for local `tauri dev`; release builds
/// can also inject via `option_env!` at compile time. Never commit the value.
pub fn github_client_secret() -> Option<String> {
    std::env::var("ISSUEBRIDGE_GITHUB_CLIENT_SECRET")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| option_env!("ISSUEBRIDGE_GITHUB_CLIENT_SECRET").map(str::to_string))
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
        Self::new(github_client_id(), github_client_secret())
    }
}

impl HttpGitHub {
    pub fn new(client_id: String, client_secret: Option<String>) -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT_VALUE)
            .timeout(std::time::Duration::from_secs(15))
            .connect_timeout(std::time::Duration::from_secs(10))
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
    error_description: Option<String>,
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

#[derive(Debug, Deserialize)]
struct IssueResponse {
    number: u64,
    html_url: String,
    title: String,
    body: Option<String>,
    labels: Vec<LabelJson>,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct LabelJson {
    name: String,
    #[serde(default)]
    color: Option<String>,
}

impl GitHub for HttpGitHub {
    fn validate_pat(&self, pat: &str) -> Result<(), GitHubError> {
        eprintln!("[issuebridge] GitHub GET /user …");
        let response = self
            .client
            .get(USER_URL)
            .header(AUTHORIZATION, format!("Bearer {pat}"))
            .header(ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .send()
            .map_err(|err| {
                eprintln!("[issuebridge] GitHub /user request failed: {err}");
                GitHubError::Unavailable
            })?;

        let status = response.status().as_u16();
        eprintln!("[issuebridge] GitHub /user status={status}");
        match status {
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
        let secret = match self.client_secret.as_deref() {
            Some(secret) => secret,
            None => {
                eprintln!(
                    "[issuebridge] OAuth exchange blocked: ISSUEBRIDGE_GITHUB_CLIENT_SECRET is not set"
                );
                return Err(GitHubError::Unavailable);
            }
        };

        eprintln!("[issuebridge] OAuth POST access_token …");
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
            .map_err(|err| {
                eprintln!("[issuebridge] OAuth token request failed: {err}");
                GitHubError::Unavailable
            })?;

        let status = response.status().as_u16();
        eprintln!("[issuebridge] OAuth token status={status}");
        if !response.status().is_success() {
            let body = response.text().unwrap_or_default();
            eprintln!(
                "[issuebridge] OAuth token error body={}",
                truncate_for_log(&body)
            );
            return Err(GitHubError::Unavailable);
        }

        let body: TokenResponse = response.json().map_err(|err| {
            eprintln!("[issuebridge] OAuth token JSON parse failed: {err}");
            GitHubError::Unavailable
        })?;

        if let Some(ref err) = body.error {
            eprintln!(
                "[issuebridge] OAuth token error={} desc={}",
                err,
                body.error_description.as_deref().unwrap_or("")
            );
            return Err(GitHubError::InvalidCredentials);
        }

        let access_token = body.access_token.ok_or(GitHubError::InvalidCredentials)?;
        if access_token.is_empty() {
            return Err(GitHubError::InvalidCredentials);
        }

        eprintln!(
            "[issuebridge] OAuth exchange ok (access_len={})",
            access_token.len()
        );
        Ok(StoredCredentials {
            access_token,
            refresh_token: body.refresh_token.filter(|t| !t.is_empty()),
        })
    }

    fn list_app_install_snapshot(&self, token: &str) -> Result<AppInstallSnapshot, GitHubError> {
        let installations = self.fetch_installations(token)?;
        let ours: Vec<&Installation> = installations
            .iter()
            .filter(|inst| inst.app_slug.as_deref() == Some("issuebridge-dev"))
            .collect();
        eprintln!(
            "[issuebridge] issuebridge-dev installs matched={}",
            ours.len()
        );

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

    fn create_issue(
        &self,
        token: &str,
        repo: &RepoId,
        title: &str,
        body: &str,
        label_names: &[String],
    ) -> Result<CreatedIssue, GitHubError> {
        let op = format!("POST issues {}/{}", repo.owner, repo.name);
        eprintln!("[issuebridge] GitHub {op} … (labels={})", label_names.len());
        let url = format!(
            "https://api.github.com/repos/{}/{}/issues",
            repo.owner, repo.name
        );
        let response = self
            .client
            .post(&url)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .json(&serde_json::json!({
                "title": title,
                "body": body,
                "labels": label_names,
            }))
            .send()
            .map_err(|err| map_request_error(&op, err))?;

        let response = match_github_status(&op, response, 201)?;
        let issue: IssueResponse = response.json().map_err(|err| map_json_error(&op, err))?;
        eprintln!("[issuebridge] GitHub {op} ok number={}", issue.number);
        Ok(issue_from_response(issue))
    }

    fn get_issue(
        &self,
        token: &str,
        repo: &RepoId,
        number: u64,
    ) -> Result<CreatedIssue, GitHubError> {
        let op = format!("GET issues {}/{}/{number}", repo.owner, repo.name);
        eprintln!("[issuebridge] GitHub {op} …");
        let url = format!(
            "https://api.github.com/repos/{}/{}/issues/{number}",
            repo.owner, repo.name
        );
        let response = self
            .client
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .send()
            .map_err(|err| map_request_error(&op, err))?;

        let response = match_github_status(&op, response, 200)?;
        let issue: IssueResponse = response.json().map_err(|err| map_json_error(&op, err))?;
        Ok(issue_from_response(issue))
    }

    fn update_issue(
        &self,
        token: &str,
        repo: &RepoId,
        number: u64,
        title: &str,
        body: &str,
        label_names: &[String],
    ) -> Result<CreatedIssue, GitHubError> {
        let op = format!("PATCH issues {}/{}/{number}", repo.owner, repo.name);
        eprintln!("[issuebridge] GitHub {op} … (labels={})", label_names.len());
        let url = format!(
            "https://api.github.com/repos/{}/{}/issues/{number}",
            repo.owner, repo.name
        );
        let response = self
            .client
            .patch(&url)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .json(&serde_json::json!({
                "title": title,
                "body": body,
                "labels": label_names,
            }))
            .send()
            .map_err(|err| map_request_error(&op, err))?;

        let response = match_github_status(&op, response, 200)?;
        let issue: IssueResponse = response.json().map_err(|err| map_json_error(&op, err))?;
        Ok(issue_from_response(issue))
    }

    fn list_labels(&self, token: &str, repo: &RepoId) -> Result<Vec<RepoLabel>, GitHubError> {
        let op = format!("GET labels {}/{}", repo.owner, repo.name);
        eprintln!("[issuebridge] GitHub {op} …");
        let mut url = Some(format!(
            "https://api.github.com/repos/{}/{}/labels?per_page=100",
            repo.owner, repo.name
        ));
        let mut labels = Vec::new();

        while let Some(current) = url {
            let response = self
                .client
                .get(&current)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header(ACCEPT, "application/vnd.github+json")
                .header("X-GitHub-Api-Version", API_VERSION)
                .send()
                .map_err(|err| map_request_error(&op, err))?;

            let response = match_github_status(&op, response, 200)?;
            let next = next_link(response.headers().get(LINK).and_then(|v| v.to_str().ok()));
            let page: Vec<LabelJson> = response.json().map_err(|err| map_json_error(&op, err))?;
            for label in page {
                labels.push(RepoLabel {
                    name: label.name,
                    color: label.color.unwrap_or_else(|| "ededed".into()),
                });
            }
            url = next;
        }

        eprintln!("[issuebridge] GitHub {op} ok count={}", labels.len());
        Ok(labels)
    }

    fn create_label(
        &self,
        token: &str,
        repo: &RepoId,
        name: &str,
        color: &str,
    ) -> Result<RepoLabel, GitHubError> {
        let op = format!("POST labels {}/{}", repo.owner, repo.name);
        eprintln!("[issuebridge] GitHub {op} name={name:?} …");
        let url = format!(
            "https://api.github.com/repos/{}/{}/labels",
            repo.owner, repo.name
        );
        let response = self
            .client
            .post(&url)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .json(&serde_json::json!({
                "name": name,
                "color": color,
            }))
            .send()
            .map_err(|err| map_request_error(&op, err))?;

        let response = match_github_status(&op, response, 201)?;
        let label: LabelJson = response.json().map_err(|err| map_json_error(&op, err))?;
        Ok(RepoLabel {
            name: label.name,
            color: label.color.unwrap_or_else(|| color.to_string()),
        })
    }
}

fn map_request_error(op: &str, err: reqwest::Error) -> GitHubError {
    eprintln!("[issuebridge] GitHub {op} request failed: {err}");
    GitHubError::Unavailable
}

fn map_json_error(op: &str, err: reqwest::Error) -> GitHubError {
    eprintln!("[issuebridge] GitHub {op} JSON parse failed: {err}");
    GitHubError::Unavailable
}

fn match_github_status(
    op: &str,
    response: reqwest::blocking::Response,
    ok_status: u16,
) -> Result<reqwest::blocking::Response, GitHubError> {
    let status = response.status().as_u16();
    eprintln!("[issuebridge] GitHub {op} status={status}");
    if status == ok_status {
        return Ok(response);
    }
    let body = response.text().unwrap_or_default();
    eprintln!(
        "[issuebridge] GitHub {op} error status={status} body={}",
        truncate_for_log(&body)
    );
    match status {
        401 | 403 => Err(GitHubError::InvalidCredentials),
        _ => Err(GitHubError::Unavailable),
    }
}

fn issue_from_response(issue: IssueResponse) -> CreatedIssue {
    CreatedIssue {
        number: issue.number,
        html_url: issue.html_url,
        title: issue.title,
        body: issue.body.unwrap_or_default(),
        label_names: issue.labels.into_iter().map(|l| l.name).collect(),
        updated_at: issue.updated_at,
    }
}

impl HttpGitHub {
    fn fetch_installations(&self, token: &str) -> Result<Vec<Installation>, GitHubError> {
        let mut url = Some(format!("{INSTALLATIONS_URL}?per_page=100"));
        let mut all = Vec::new();

        while let Some(current) = url {
            eprintln!("[issuebridge] GitHub GET installations …");
            let response = self
                .client
                .get(&current)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header(ACCEPT, "application/vnd.github+json")
                .header("X-GitHub-Api-Version", API_VERSION)
                .send()
                .map_err(|err| {
                    eprintln!("[issuebridge] installations request failed: {err}");
                    GitHubError::Unavailable
                })?;

            let status = response.status().as_u16();
            eprintln!("[issuebridge] installations status={status}");
            match status {
                200 => {}
                401 | 403 => {
                    let body = response.text().unwrap_or_default();
                    eprintln!(
                        "[issuebridge] installations auth error body={}",
                        body.chars().take(300).collect::<String>()
                    );
                    return Err(GitHubError::InvalidCredentials);
                }
                other => {
                    let body = response.text().unwrap_or_default();
                    eprintln!(
                        "[issuebridge] installations unexpected status={other} body={}",
                        body.chars().take(300).collect::<String>()
                    );
                    return Err(GitHubError::Unavailable);
                }
            }

            let next = next_link(response.headers().get(LINK).and_then(|v| v.to_str().ok()));
            let body: InstallationsResponse = response.json().map_err(|err| {
                eprintln!("[issuebridge] installations JSON parse failed: {err}");
                GitHubError::Unavailable
            })?;
            eprintln!(
                "[issuebridge] installations page count={} slugs={:?}",
                body.installations.len(),
                body.installations
                    .iter()
                    .map(|i| i.app_slug.as_deref().unwrap_or("(none)"))
                    .collect::<Vec<_>>()
            );
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

fn truncate_for_log(body: &str) -> String {
    body.chars().take(300).collect()
}
