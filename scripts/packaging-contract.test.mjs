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
  it("accepts client id and secret from env", () => {
    const result = checkReleaseCredentials({
      ISSUEBRIDGE_GITHUB_CLIENT_ID: "Iv23li6Ao8URyrvbNZOq",
      ISSUEBRIDGE_GITHUB_CLIENT_SECRET: "not-a-real-secret",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects missing client secret for official release builds", () => {
    const result = checkReleaseCredentials({
      ISSUEBRIDGE_GITHUB_CLIENT_ID: "Iv23li6Ao8URyrvbNZOq",
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /CLIENT_SECRET/);
  });

  it("rejects missing client id for official release builds", () => {
    const result = checkReleaseCredentials({
      ISSUEBRIDGE_GITHUB_CLIENT_SECRET: "not-a-real-secret",
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /CLIENT_ID/);
  });
});
