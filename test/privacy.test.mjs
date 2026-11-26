import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scanRepository } from "../scripts/check-privacy.mjs";

function repository(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, "t3-guide-privacy-test-"));
  execFileSync("git", ["init", "--quiet", directory]);
  t.after(() => {
    const target = fs.realpathSync(directory);
    assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith("t3-guide-privacy-test-"));
    fs.rmSync(target, { recursive: true, force: true });
  });
  return directory;
}

test("a sanitized working file does not hide private data already staged", (t) => {
  const directory = repository(t);
  const marker = "PRIVATE_TEST_VALUE_NOT_A_REAL_SECRET";
  const file = path.join(directory, "README.md");
  fs.writeFileSync(file, marker + "\n");
  execFileSync("git", ["add", "README.md"], { cwd: directory });
  fs.writeFileSync(file, "Sanitized documentation.\n");
  const result = scanRepository(directory, [marker]);
  assert.ok(result.findings.some((item) => item.source === "index" && item.rule === "private deny-list match"));
  assert.ok(!JSON.stringify(result).includes(marker));
});

test("untracked private text and binary files are also inspected", (t) => {
  const directory = repository(t);
  const marker = "SECOND_PRIVATE_TEST_VALUE";
  fs.writeFileSync(path.join(directory, "note.txt"), marker);
  fs.writeFileSync(path.join(directory, "capture.bin"), Buffer.from([0, 1, 2]));
  const result = scanRepository(directory, [marker]);
  assert.ok(result.findings.some((item) => item.file === "note.txt" && item.source === "worktree"));
  assert.ok(result.findings.some((item) => item.rule === "binary requires manual privacy review"));
  assert.ok(!JSON.stringify(result).includes(marker));
});

test("hardware MAC addresses and bearer tokens are caught while RFC 6598 base CIDR is allowed", (t) => {
  const directory = repository(t);
  fs.writeFileSync(path.join(directory, "ok.md"), "Filter CGNAT 100.64.0.0/10 and example MAC 00:00:5e:00:53:01.\n");
  assert.equal(scanRepository(directory).findings.length, 0);
  const sampleMac = ["aa", "bb", "cc", "dd", "ee", "ff"].join(":");
  const sampleAuth = ["Authorization", `Bearer ${"x".repeat(28)}`].join(": ");
  fs.writeFileSync(path.join(directory, "bad.md"), `Host ${sampleMac} with ${sampleAuth}\n`);
  const result = scanRepository(directory);
  assert.ok(result.findings.some((item) => item.rule === "hardware MAC address"));
  assert.ok(result.findings.some((item) => item.rule === "bearer authorization token"));
});
