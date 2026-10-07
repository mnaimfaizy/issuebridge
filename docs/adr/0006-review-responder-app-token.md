# The Review responder pushes as the Claude App; a separate job speaks for it on GitHub

The Review responder (`claude-review-response.yml`, #199) addresses a code review on a pull request: it fixes or declines each finding, and the fixes have to be proven by CI. GitHub starts no workflow for a push made with `GITHUB_TOKEN`, so the responder's agent job exchanges OIDC for the Claude GitHub App token and pushes with that — the second job allowed to, after `implement`. The agent holds no `gh` rule at all. It writes a response file; a `publish` job on a fresh runner re-reads the review threads from GitHub, checks every claim in that file against them and against the commits actually pushed, and only then replies and resolves, with the job token. `scripts/ci-workflow-contract.test.mjs` names the two App-token jobs explicitly and fails on a third.

## Considered Options

- **Push with `GITHUB_TOKEN`, keeping the App token to `implement` alone** — rejected; the fixes would land without CI, and a thread resolved on an unverified fix is worse than an open one. Re-triggering CI by hand on every round defeats the agent.
- **Let the agent reply and resolve itself with `gh api`** — rejected; `gh api` also reaches merging, branch deletion and labels, and the agent could resolve threads it was never given. The same reasoning already keeps `gh api` from the implementer.
- **Reply and resolve in a later step of the agent's own job** — rejected; the agent runs `npm` and `cargo` on pull request code, so nothing on that runner is trustworthy afterwards, including a script staged outside the workspace. Resolving a thread also needs `contents: write` on the job token (replying does not), which should not sit beside that session.
- **Auto mode by label or by reusable workflow** — a label applied with the job token starts no run; a reusable workflow would make the reviewer workflow hold the responder's write permissions. The reviewer's `handoff` job dispatches the responder instead, and is the only job holding `actions: write`.
- **A bounded review → respond → review loop** — rejected; two agents from one model family converging on agreement is the failure to avoid. A response round never starts a review, so a maintainer begins every cycle, and automatic handoff stops after two rounds on a pull request.

## Consequences

The responder's job combines the App token, build tooling, pull request code and review text in one session — more than `implement`, which builds trusted default-branch code. This is accepted on the standing basis that anyone able to push a same-repository branch can already run an edited workflow with these secrets; fork pull requests are refused outright. Pull requests that change agent instruction files (`CLAUDE.md`, `.claude/`, skills, the agent runtime) are refused rather than restored from the base, because restoring them into a tree the agent commits from risks committing the reverts.

A dispatch runs the workflow file of whatever ref it names, so "the handoff runs trusted code" holds only because the `handoff` job names the default branch; the contract pins that. The round's summary comment contains no agent-written text, since its author and marker are what the round cap counts.
