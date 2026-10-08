import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "../../../test/helpers.js";
import {
  sourceFingerprint,
  sourcePaths,
  requireInstallation,
  type SourceSpec,
} from "../src/source.js";

test("local source changes require reinstall, while generated Python state and tests do not", async (t) => {
  const { home } = await fixture(t);
  const source = join(home, "source");
  await mkdir(source);
  await writeFile(join(source, "main.py"), "# original\n");
  await writeFile(join(source, "uv.lock"), "version = 1\n");
  const spec: SourceSpec = { app: "telegram", directory: source, project: "." };
  const paths = sourcePaths(home, spec);
  await mkdir(join(paths.runtime, ".venv", "bin"), { recursive: true });
  await writeFile(paths.python, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await writeFile(
    paths.receipt,
    JSON.stringify({ source, fingerprint: await sourceFingerprint(spec) }),
  );
  await requireInstallation(home, spec);
  await mkdir(join(source, "__pycache__"));
  await writeFile(join(source, "__pycache__", "generated.py"), "ignored");
  await requireInstallation(home, spec);
  await mkdir(join(source, "tests"));
  await writeFile(join(source, "tests", "test_main.py"), "# test only\n");
  await writeFile(join(source, "main_test.go"), "package main\n");
  await requireInstallation(home, spec);
  await writeFile(join(source, "uv.lock"), "version = 2\n");
  await assert.rejects(requireInstallation(home, spec), /source changed.*telegram install/);
});
