---
name: code-review
description: Review the changes since a fixed point (commit, branch, tag, or merge-base) along three axes — Standards (does the code follow this repo's documented coding standards?), Spec (does the code match what the originating issue/PRD asked for?), and Correctness (does the code actually work?). Runs the axes in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X".
---

Three-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards** — does the code conform to this repo's documented coding standards?
- **Spec** — does the code faithfully implement the originating issue / PRD / spec?
- **Correctness** — does the code actually do what it says, on every path?

Each axis runs as its own **parallel sub-agent** so they don't pollute each other's context, then this skill aggregates their findings.

The issue tracker should have been provided to you — run `/setup-matt-pocock-skills` if `docs/agents/issue-tracker.md` is missing. When it is missing and no spec is supplied another way, say so and continue; the other axes do not depend on it.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point — a commit SHA, branch name, tag, `main`, `HEAD~5`, etc. If they didn't specify one, ask for it. When you are running unattended (CI, no one to ask), the caller must have supplied it; if it is genuinely absent, fall back to the merge-base with the default branch and say so in the report rather than stopping.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here — not inside two parallel sub-agents.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.) — fetch via the workflow in `docs/agents/issue-tracker.md`.
2. A path the user passed as an argument.
3. A PRD/spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
4. A spec the caller pasted directly — an agent-pipeline plan comment, an issue body. Unattended runs use this instead of the tracker.
5. If nothing is found, ask the user where the spec is. If they say there isn't one, or nobody is there to ask, the **Spec** sub-agent skips and reports "no spec available".

### 3. Identify the standards sources

Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below — a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation — and, like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Note the correctness hunt list

The Correctness axis carries its own fixed list, the way Standards carries the smell baseline. It needs no repo docs and no spec — only the diff and the files around it.

The bar is a **concrete failure scenario**: named inputs or state, and the wrong output, crash, or corruption that follows. A finding you cannot land as "given X, this does Y and should do Z" is not a Correctness finding — send it to Standards as a judgement call, or drop it.

- **Inverted or wrong condition** — a branch that fires when it shouldn't, or an `&&` that wanted `||`.
- **Early return before an invariant is restored** — `?`, `return`, `break`, `throw`, or `continue` that skips a flag reset, unlock, or cleanup the rest of the code assumes happened.
- **Ignored failure** — a discarded `Result`/error/promise (`let _ =`, bare `catch {}`, missing `await`) where the caller then acts as if the operation succeeded.
- **Off-by-one and boundary** — empty collection, single element, first/last index, zero, negative, max.
- **Null / None / undefined** — a value dereferenced on a path where it can legitimately be absent.
- **Fallback that outranks the decision** — a default or cached value consulted when an explicit decision already exists, so the stale answer wins.
- **Broken caller** — a changed signature, return type, error variant, or semantic that some existing call site still reads the old way. Grep every caller of anything the diff changed.
- **Race and ordering** — state read before it is written, an await/lock boundary that lets another path interleave, or a listener registered without a matching teardown.
- **Resource held too long** — a lock or guard held across I/O, so unrelated work blocks behind it.

Two rules bind the list:

- **Tests passing is not evidence.** Check whether a path is *reachable* by the test doubles at all. A fake that always returns success makes the failure branch untestable, and a green suite says nothing about it. Call that out explicitly when you see it.
- **Read the surrounding file, not just the hunk.** Most correctness bugs are a changed hunk meeting unchanged code that no longer holds.

### 5. Spawn the sub-agents in parallel

Send a single message with three `Agent` tool calls — Standards, Spec, Correctness. Use the `general-purpose` subagent for each. If the Spec source is missing, send two and note the skip.

**Unattended / CI:** this is a one-shot session — ending the turn kills background work and the job still goes green. Pass `run_in_background: false` on every Agent call (several in one message still run in parallel and wait). Never end the turn until the aggregated report is posted. If Agent is denied or unavailable, run the axes sequentially in this session instead.

If sub-agents are unavailable in the current environment, run the axes sequentially in this session instead, keeping their findings in separate sections and never letting one axis's conclusions bleed into another's.

**Standards sub-agent prompt** — include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full — the sub-agent has no other access to it.
- The brief: "Report — per file/hunk where relevant — (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent prompt** — include:

- The diff command and commit list.
- The path or fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words."

If the spec is missing, skip the Spec sub-agent and note this in the final report.

**Correctness sub-agent prompt** — include:

- The diff command and commit list.
- **The correctness hunt list from step 4 pasted in full** — the sub-agent has no other access to it.
- The brief: "Report every place the diff can misbehave. Each finding must carry a concrete failure scenario: the inputs or state that trigger it, and the wrong result that follows. Cite `file:line`. Read the surrounding files, not only the changed hunks — grep the callers of anything whose signature, return type, or error semantics changed. Where a failure path exists but no test double can reach it, say so. Drop anything you cannot land as a concrete scenario. Under 400 words."

### 6. Aggregate

Present the reports under `## Standards`, `## Spec` and `## Correctness` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings — the axes are deliberately separate (see _Why separate axes_).

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes — that's the reranking the separation exists to prevent.

## Why separate axes

A change can pass on one axis and fail on another:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**
- Code that is idiomatic and matches the spec line for line, but breaks on a path nobody exercised → **Standards pass, Spec pass, Correctness fail.**

That third case is the one green CI is worst at. A failure branch no test double can reach is invisible to the suite and to both other axes; only a reader asking "what happens when this call fails?" finds it.

Reporting the axes separately stops any one of them from masking the others.
