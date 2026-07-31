import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkPackagingContract,
  checkReleaseCredentials,
  whisperDllsColocatedWithSidecar,
} from "./packaging-contract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const validResourcesMap = {
  "resources/models/ggml-base.bin": "resources/models/ggml-base.bin",
  "binaries/*.dll": "./",
};

describe("packaging contract", () => {
  it("requires NSIS-only targets and currentUser installMode with whisper assets", () => {
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
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects targets all (would also emit MSI)", () => {
    const result = checkPackagingContract({
      bundle: {
        targets: "all",
        externalBin: ["binaries/whisper-cli"],
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
        externalBin: ["binaries/whisper-cli"],
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

  it("rejects nested binaries/whisper.dll layout that breaks installed PTT (#55)", () => {
    const result = checkPackagingContract({
      bundle: {
        targets: ["nsis"],
        externalBin: ["binaries/whisper-cli"],
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
        externalBin: ["binaries/whisper-cli"],
        resources: {
          "resources/models/ggml-base.bin": "resources/models/ggml-base.bin",
          "binaries/whisper.dll": "whisper.dll",
          "binaries/ggml.dll": "ggml.dll",
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
