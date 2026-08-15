/**
 * Help coverage drift check (#146).
 *
 * Resolves `src/help/helpCoverage.ts` against the codebase: every Settings
 * section, every Destination, and every `#[tauri::command]` must have exactly
 * one manifest entry, and every `covered` entry must point at a real topic in
 * `src/help/helpContent.ts`.
 *
 * The check *detects* gaps — a human or agent writes the words. See
 * `.agents/skills/help-coverage/SKILL.md`.
 *
 * Run directly: `node scripts/help-coverage.mjs`
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(...parts) {
  return readFileSync(join(root, ...parts), "utf8");
}

function walkFiles(dir, predicate, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walkFiles(path, predicate, acc);
    } else if (predicate(name)) {
      acc.push(path);
    }
  }
  return acc;
}

/** Settings sections shipped in the Settings destination, including nested folders. */
export function settingsSurfaces() {
  return walkFiles(join(root, "src", "settings"), (name) =>
    name.endsWith("Section.tsx"),
  )
    .map((path) => {
      const file = path.split(/[/\\]/).pop();
      return `settings:${file.replace(/\.tsx$/, "")}`;
    })
    .sort();
}

/** Sidebar destinations from the `Destination` union. */
export function destinationSurfaces() {
  const source = read("src", "shell", "destinations.ts");
  const union = /export type Destination\s*=\s*([^;]+);/.exec(source);
  if (!union) throw new Error("could not read the Destination union");
  return [...union[1].matchAll(/"([a-z-]+)"/g)]
    .map((match) => `destination:${match[1]}`)
    .sort();
}

function annotatedCommands() {
  const files = walkFiles(join(root, "src-tauri", "src"), (name) =>
    name.endsWith(".rs"),
  );
  const names = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const parts = source.split("#[tauri::command]");
    for (const part of parts.slice(1)) {
      const match = /pub\s+(?:async\s+)?fn\s+([a-z0-9_]+)/.exec(part);
      if (!match) {
        const rel = relative(root, file).replaceAll("\\", "/");
        throw new Error(
          `#[tauri::command] in ${rel} is not followed by pub fn — Help coverage cannot skip it`,
        );
      }
      names.push(match[1]);
    }
  }
  return names;
}

function registeredCommands() {
  const source = read("src-tauri", "src", "lib.rs");
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(source);
  if (!block) {
    throw new Error("could not read generate_handler in src-tauri/src/lib.rs");
  }
  const names = [...block[1].matchAll(/\b([a-z][a-z0-9_]*)\b/g)].map(
    (match) => match[1],
  );
  if (names.length === 0) {
    throw new Error("generate_handler listed no commands");
  }
  return names;
}

/** Tauri commands exposed to the frontend. */
export function commandSurfaces() {
  const annotated = annotatedCommands();
  const registered = registeredCommands();
  const annotatedSet = new Set(annotated);
  const registeredSet = new Set(registered);
  const problems = [];
  for (const name of registered) {
    if (!annotatedSet.has(name)) {
      problems.push(
        `${name} is in generate_handler but has no #[tauri::command]`,
      );
    }
  }
  for (const name of annotated) {
    if (!registeredSet.has(name)) {
      problems.push(
        `${name} has #[tauri::command] but is not in generate_handler`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `command discovery mismatch:\n  - ${problems.join("\n  - ")}`,
    );
  }
  return [...registeredSet].map((name) => `command:${name}`).sort();
}

/** All surfaces that need a manifest entry. */
export function expectedSurfaces() {
  return [
    ...destinationSurfaces(),
    ...settingsSurfaces(),
    ...commandSurfaces(),
  ];
}

/** Topic ids declared in `helpContent.ts`. */
export function helpTopicIds() {
  const source = read("src", "help", "helpContent.ts");
  return [...source.matchAll(/^\s*id:\s*"([^"]+)",/gm)].map(
    (match) => match[1],
  );
}

/**
 * Parses `HELP_COVERAGE` out of `helpCoverage.ts` by source scan — the
 * manifest is TypeScript so it stays beside the content it maps to, and the
 * scripts here run on plain Node without a TS loader.
 */
export function coverageEntries() {
  const source = read("src", "help", "helpCoverage.ts");
  const start = source.indexOf("export const HELP_COVERAGE");
  if (start < 0) throw new Error("could not find HELP_COVERAGE");
  const body = source.slice(start);
  const marks = [...body.matchAll(/surface:\s*"([^"]+)"/g)];
  return marks.map((mark, index) => {
    const from = mark.index;
    const to = index + 1 < marks.length ? marks[index + 1].index : body.length;
    const chunk = body.slice(from, to);
    return {
      surface: mark[1],
      status: /status:\s*"([^"]+)"/.exec(chunk)?.[1] ?? null,
      topicId: /topicId:\s*"([^"]+)"/.exec(chunk)?.[1] ?? null,
      note: /note:\s*"([^"]*)"/.exec(chunk)?.[1] ?? null,
    };
  });
}

/** Returns human-readable problems; empty means Help coverage is in sync. */
export function checkHelpCoverage() {
  const problems = [];
  const entries = coverageEntries();
  const topics = new Set(helpTopicIds());
  const expected = expectedSurfaces();
  const bySurface = new Map();

  for (const entry of entries) {
    if (bySurface.has(entry.surface)) {
      problems.push(`duplicate manifest entry for ${entry.surface}`);
      continue;
    }
    bySurface.set(entry.surface, entry);
  }

  for (const surface of expected) {
    if (!bySurface.has(surface)) {
      problems.push(
        `${surface} has no entry in src/help/helpCoverage.ts — add a Help topic or mark it intentionally-not-user-facing`,
      );
    }
  }

  const expectedSet = new Set(expected);
  for (const entry of bySurface.values()) {
    if (!expectedSet.has(entry.surface)) {
      problems.push(
        `${entry.surface} no longer exists in the codebase — remove it from src/help/helpCoverage.ts`,
      );
      continue;
    }
    if (entry.status === "covered") {
      if (!entry.topicId) {
        problems.push(`${entry.surface} is covered but names no topicId`);
      } else if (!topics.has(entry.topicId)) {
        problems.push(
          `${entry.surface} points at topic "${entry.topicId}", which is not in src/help/helpContent.ts`,
        );
      }
    } else if (entry.status === "intentionally-not-user-facing") {
      if (!entry.note) {
        problems.push(
          `${entry.surface} opts out of Help without a note explaining why`,
        );
      }
    } else {
      problems.push(
        `${entry.surface} has an unknown status ${JSON.stringify(entry.status)}`,
      );
    }
  }

  return problems;
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const problems = checkHelpCoverage();
  if (problems.length > 0) {
    console.error("Help coverage is out of date:");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "\nSee .agents/skills/help-coverage/SKILL.md for how to fix this.",
    );
    process.exit(1);
  }
  console.log(
    `Help coverage OK — ${expectedSurfaces().length} surfaces mapped across ${helpTopicIds().length} Help topics.`,
  );
}
