//! Rewrite eligibility, built-in Rewrite styles, and last-used resolution.

use crate::core::ports::{CustomRewriteStyle, RewriteStyleInfo};

/// Built-in Clear style id (product default and last-used fallback).
pub const CLEAR_STYLE_ID: &str = "clear";

const TITLE_MIN: usize = 8;
const BODY_MIN: usize = 40;

/// True when trimmed title length < 8 **and** trimmed body length < 40.
pub fn is_too_thin_for_rewrite(title: &str, body: &str) -> bool {
    title.trim().len() < TITLE_MIN && body.trim().len() < BODY_MIN
}

/// Built-in Rewrite styles in display order (Clear first).
pub fn builtin_rewrite_styles() -> Vec<RewriteStyleInfo> {
    vec![
        RewriteStyleInfo {
            id: CLEAR_STYLE_ID.into(),
            name: "Clear".into(),
            instruction: "Rewrite as a clear GitHub issue title and body. Preserve facts; improve skimability. Free-form — no required headings.".into(),
            builtin: true,
        },
        RewriteStyleInfo {
            id: "bug_report".into(),
            name: "Bug report".into(),
            instruction: "Rewrite as a bug report. Use headings Problem / Steps to reproduce / Expected / Actual / Environment when the material supports them; omit empty sections; do not invent steps, environment, or root cause.".into(),
            builtin: true,
        },
        RewriteStyleInfo {
            id: "feature_request".into(),
            name: "Feature request".into(),
            instruction: "Rewrite as a feature request. Use headings Problem / Proposal / Why it matters when the material supports them; omit empty sections; do not invent product scope.".into(),
            builtin: true,
        },
        RewriteStyleInfo {
            id: "question".into(),
            name: "Question".into(),
            instruction: "Rewrite as a question. Use headings Question / Context when the material supports them; omit empty sections; do not invent answers.".into(),
            builtin: true,
        },
        RewriteStyleInfo {
            id: "concise".into(),
            name: "Concise".into(),
            instruction: "Rewrite title and body to be concise. Free-form — no required headings. Preserve facts; drop filler.".into(),
            builtin: true,
        },
    ]
}

/// Resolve the style to pre-select: last-used if still present, else Clear.
pub fn resolve_last_used_style_id(
    last_used: Option<&str>,
    custom: &[CustomRewriteStyle],
) -> String {
    let Some(id) = last_used.map(str::trim).filter(|s| !s.is_empty()) else {
        return CLEAR_STYLE_ID.into();
    };
    if builtin_rewrite_styles().iter().any(|s| s.id == id) {
        return id.to_string();
    }
    if custom.iter().any(|s| s.id == id) {
        return id.to_string();
    }
    CLEAR_STYLE_ID.into()
}

/// Built-ins followed by user-defined styles.
pub fn all_rewrite_styles(custom: &[CustomRewriteStyle]) -> Vec<RewriteStyleInfo> {
    let mut styles = builtin_rewrite_styles();
    styles.extend(custom.iter().map(|c| RewriteStyleInfo {
        id: c.id.clone(),
        name: c.name.clone(),
        instruction: c.instruction.clone(),
        builtin: false,
    }));
    styles
}

pub fn find_rewrite_style(
    style_id: &str,
    custom: &[CustomRewriteStyle],
) -> Option<RewriteStyleInfo> {
    all_rewrite_styles(custom)
        .into_iter()
        .find(|s| s.id == style_id)
}
