// Contract: the shared-hosting OAuth exchange keeps its secret-bearing config
// out of reach of a plain download. Concept: cpanel-exchange-secret-in-web-root
// (rejected below the security bar; this guards the hardening that followed).
//
// PHP is not run here. The config lookup order was exercised in a PHP 8.3
// container when it was written; this suite holds the parts a static check can:
// the .htaccess deny pattern, and the shape of the lookup in exchange.php.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cpanel = (name) =>
  readFileSync(
    join(root, "services", "oauth-exchange", "cpanel", name),
    "utf8",
  );

/** The FilesMatch pattern as a JS RegExp (Apache's leading `(?i)` becomes the `i` flag). */
function filesMatchPattern() {
  const source = cpanel(".htaccess").match(/<FilesMatch "([^"]+)">/)?.[1];
  assert.ok(source, "expected a FilesMatch block in cpanel/.htaccess");
  assert.ok(source.startsWith("(?i)"), "the deny pattern must ignore case");
  return new RegExp(source.slice("(?i)".length), "i");
}

describe("cPanel OAuth exchange config protection", () => {
  it("denies every config copy, backup and editor swap file beside the script", () => {
    const pattern = filesMatchPattern();
    for (const name of [
      "config.php",
      "Config.PHP",
      "config.example.php",
      "issuebridge-oauth-config.php",
      "config.php.bak",
      "config.php.old",
      "config.php.orig",
      "config.php.save",
      "config.php.tmp",
      "config.php.txt",
      "config.php~",
      ".config.php.swp",
      ".config.php.swo",
      "#config.php#",
      ".#config.php",
      "issuebridge-oauth-config.php.bak",
      ".issuebridge-oauth-config.php.swp",
    ]) {
      assert.match(name, pattern, `${name} must be refused`);
    }
  });

  it("still serves the exchange script itself", () => {
    const pattern = filesMatchPattern();
    for (const name of ["exchange.php", "index.php", "myconfiguration.html"]) {
      assert.doesNotMatch(name, pattern, `${name} must stay servable`);
    }
  });

  it("does not need an override beyond AuthConfig", () => {
    // `Options` needs AllowOverride Options, which many hosts withhold; on such
    // a host the whole folder, exchange.php included, would answer 500.
    const code = cpanel(".htaccess")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(code, /^\s*Options\b/m);
    assert.match(code, /Require all denied/);
  });

  it("looks for the config outside the web root before the legacy sibling", () => {
    const php = cpanel("exchange.php");
    const explicit = php.indexOf("getenv('ISSUEBRIDGE_OAUTH_CONFIG')");
    const above = php.indexOf(
      "dirname(__DIR__) . '/issuebridge-oauth-config.php'",
    );
    const legacy = php.indexOf("__DIR__ . '/config.php'");
    assert.ok(
      explicit >= 0 && above >= 0 && legacy >= 0,
      "expected all three lookups",
    );
    assert.ok(explicit < above && above < legacy, "lookup order changed");
    // An explicit path that is unusable fails closed instead of falling back.
    assert.match(
      php,
      /return \$absolute && \$usable\(\$explicit\) \? \$explicit : null;/,
    );
    assert.match(php, /'server_misconfigured'/);
  });
});
