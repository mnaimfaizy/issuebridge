import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkPackagingContract,
  checkReleaseCredentials,
  llamaDllsColocatedWithSidecar,
  resourcesIncludeGguf,
  whisperDllsColocatedWithSidecar,
} from "./packaging-contract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const validExternalBin = ["binaries/whisper-cli", "binaries/llama-cli"];

const validResourcesMap = {
  "resources/models/ggml-base.bin": "resources/models/ggml-base.bin",
  "binaries/*.dll": "./",
};

function assertArchiveIntegrity(
  scriptName,
  expectedSha256,
  mutate = (script) => script,
) {
  const script = mutate(
    readFileSync(join(root, "scripts", scriptName), "utf8"),
  );
  const download = script.indexOf("Invoke-WebRequest");
  const verify = script.indexOf("$ZipHash =", download);
  const extract = script.indexOf("Expand-Archive", download);

  assert.match(
    script,
    new RegExp(`\\$ExpectedZipSha256\\s*=\\s*"${expectedSha256}"`),
  );
  assert.ok(download >= 0, `${scriptName} must download the archive`);
  assert.ok(verify > download, `${scriptName} must verify after download`);
  assert.ok(extract > verify, `${scriptName} must verify before extraction`);
  const gate = script.slice(verify, extract);
  assert.match(
    gate,
    /\$ZipHash\s*=\s*\(Get-FileHash -Algorithm SHA256 -Path \$ZipPath\)\.Hash\.ToLowerInvariant\(\)/,
  );
  assert.match(
    gate,
    /if \(\$ZipHash -ne \$ExpectedZipSha256\) \{\s*throw .*SHA-256 mismatch.*\s*\}/,
  );
}

describe("packaging contract", () => {
  it("requires NSIS-only targets and currentUser installMode with whisper + llama assets", () => {
    const result = checkPackagingContract({
      bundle: {
        targets: ["nsis"],
        externalBin: validExternalBin,
        resources: validResourcesMap,
        windows: {
          nsis: { installMode: "currentUser" },
        },
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects targets all (would also emit MSI)", () => {
    const result = checkPackagingContract({
      bundle: {
        targets: "all",
        externalBin: validExternalBin,
        resources: validResourcesMap,
        windows: {
          nsis: { installMode: "currentUser" },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /NSIS-only|nsis/i);
  });

  it("rejects missing currentUser installMode", () => {
    const result = checkPackagingContract({
      bundle: {
        targets: ["nsis"],
        externalBin: validExternalBin,
        resources: validResourcesMap,
        windows: {
          nsis: { installMode: "perMachine" },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /currentUser/);
  });

  it("rejects missing whisper sidecar or model resource", () => {
    const result = checkPackagingContract({
      bundle: {
        targets: ["nsis"],
        externalBin: [],
        resources: [],
        windows: {
          nsis: { installMode: "currentUser" },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /whisper-cli/);
    assert.match(result.errors.join("\n"), /ggml-base\.bin/);
  });

  it("rejects missing llama-cli Rewrite sidecar (#68)", () => {
    const result = checkPackagingContract({
      bundle: {
        targets: ["nsis"],
        externalBin: ["binaries/whisper-cli"],
        resources: validResourcesMap,
        windows: {
          nsis: { installMode: "currentUser" },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /llama-cli/);
  });

  it("rejects GGUF models in NSIS resources (#68)", () => {
    const result = checkPackagingContract({
      bundle: {
        targets: ["nsis"],
        externalBin: validExternalBin,
        resources: {
          ...validResourcesMap,
          "resources/models/phi.gguf": "resources/models/phi.gguf",
        },
        windows: {
          nsis: { installMode: "currentUser" },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /GGUF/i);
  });

  it("rejects nested binaries/whisper.dll layout that breaks installed PTT (#55)", () => {
    const result = checkPackagingContract({
      bundle: {
        targets: ["nsis"],
        externalBin: validExternalBin,
        resources: [
          "resources/models/ggml-base.bin",
          "binaries/ggml.dll",
          "binaries/whisper.dll",
          "binaries/ggml-cpu-*.dll",
        ],
        windows: {
          nsis: { installMode: "currentUser" },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /install root|binaries\//i);
  });

  it("accepts explicit root DLL targets", () => {
    const result = checkPackagingContract({
      bundle: {
        targets: ["nsis"],
        externalBin: validExternalBin,
        resources: {
          "resources/models/ggml-base.bin": "resources/models/ggml-base.bin",
          "binaries/whisper.dll": "whisper.dll",
          "binaries/ggml.dll": "ggml.dll",
          "binaries/llama.dll": "llama.dll",
        },
        windows: {
          nsis: { installMode: "currentUser" },
        },
      },
    });
    assert.equal(result.ok, true, result.errors.join("\n"));
  });

  it("holds for the repo tauri.conf.json", () => {
    const config = JSON.parse(
      readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
    );
    const result = checkPackagingContract(config);
    assert.equal(result.ok, true, result.errors.join("\n"));
  });
});

describe("release sidecar archive integrity", () => {
  it("verifies the pinned Whisper archive before extraction", () => {
    assertArchiveIntegrity(
      "fetch-whisper-assets.ps1",
      "7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539",
    );
  });

  it("verifies the pinned llama.cpp archive before extraction", () => {
    assertArchiveIntegrity(
      "fetch-llama-assets.ps1",
      "ca7e53a15f6956a3627c7f1d462a4877b70878680ae1db482346e1c8bb22e67e",
    );
  });

  it("rejects an inverted archive integrity guard", () => {
    assert.throws(() =>
      assertArchiveIntegrity(
        "fetch-whisper-assets.ps1",
        "7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539",
        (script) =>
          script.replace(
            "$ZipHash -ne $ExpectedZipSha256",
            "$ZipHash -eq $ExpectedZipSha256",
          ),
      ),
    );
  });
});

describe("whisperDllsColocatedWithSidecar", () => {
  it("accepts binaries/*.dll mapped to ./", () => {
    assert.equal(
      whisperDllsColocatedWithSidecar([
        { source: "binaries/*.dll", target: "./" },
      ]),
      true,
    );
  });

  it("rejects nested binaries/ targets", () => {
    assert.equal(
      whisperDllsColocatedWithSidecar([
        { source: "binaries/whisper.dll", target: "binaries/whisper.dll" },
        { source: "binaries/ggml.dll", target: "binaries/ggml.dll" },
      ]),
      false,
    );
  });
});

describe("llamaDllsColocatedWithSidecar", () => {
  it("accepts binaries/*.dll mapped to ./ (CPU/Vulkan layout)", () => {
    assert.equal(
      llamaDllsColocatedWithSidecar([
        { source: "binaries/*.dll", target: "./" },
      ]),
      true,
    );
  });

  it("rejects nested binaries/llama.dll targets", () => {
    assert.equal(
      llamaDllsColocatedWithSidecar([
        { source: "binaries/llama.dll", target: "binaries/llama.dll" },
        { source: "binaries/ggml.dll", target: "binaries/ggml.dll" },
      ]),
      false,
    );
  });
});

describe("resourcesIncludeGguf", () => {
  it("detects .gguf paths", () => {
    assert.equal(
      resourcesIncludeGguf([
        { source: "models/x.gguf", target: "models/x.gguf" },
      ]),
      true,
    );
    assert.equal(
      resourcesIncludeGguf([
        {
          source: "resources/models/ggml-base.bin",
          target: "resources/models/ggml-base.bin",
        },
      ]),
      false,
    );
  });
});

describe("release credential injection", () => {
  it("accepts client id and exchange URL from env", () => {
    const result = checkReleaseCredentials({
      ISSUEBRIDGE_GITHUB_CLIENT_ID: "Iv23li6Ao8URyrvbNZOq",
      ISSUEBRIDGE_OAUTH_EXCHANGE_URL:
        "https://oauth-exchange.example.workers.dev/",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects missing exchange URL for official release builds", () => {
    const result = checkReleaseCredentials({
      ISSUEBRIDGE_GITHUB_CLIENT_ID: "Iv23li6Ao8URyrvbNZOq",
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /OAUTH_EXCHANGE_URL/);
  });

  it("rejects client secret present on official release builds", () => {
    const result = checkReleaseCredentials({
      ISSUEBRIDGE_GITHUB_CLIENT_ID: "Iv23li6Ao8URyrvbNZOq",
      ISSUEBRIDGE_OAUTH_EXCHANGE_URL:
        "https://oauth-exchange.example.workers.dev/",
      ISSUEBRIDGE_GITHUB_CLIENT_SECRET: "must-not-be-baked",
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /CLIENT_SECRET must not be set/);
  });

  it("rejects missing client id for official release builds", () => {
    const result = checkReleaseCredentials({
      ISSUEBRIDGE_OAUTH_EXCHANGE_URL:
        "https://oauth-exchange.example.workers.dev/",
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /CLIENT_ID/);
  });
});
