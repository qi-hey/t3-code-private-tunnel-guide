import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowedIpv4 = (ip) => {
  const p = ip.split(".").map(Number);
  return ip === "0.0.0.0" || p[0] === 127 || p[0] === 10 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    ip.startsWith("192.0.2.") || ip.startsWith("198.51.100.") || ip.startsWith("203.0.113.");
};
const patterns = [
  ["access token", /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["literal WireGuard key", /["'](?:private-key|public-key|pre-shared-key|serverPrivateKey|serverPublicKey|phonePrivateKey|phonePublicKey|presharedKey)["']\s*[:=]\s*["'][A-Za-z0-9+/]{43}=["']/],
  ["personal Windows home", /[A-Za-z]:[\\/]+Users[\\/]+(?!<USER>|%USERNAME%|\$env:USERNAME)[^\\/\s"'<>]+[\\/]/i],
  ["personal Unix home", /\/(?:home|Users)\/(?!<USER>|\$USER)[A-Za-z0-9._-]+\//],
  ["session or attachment identifier", /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i],
];
export function scanRepository(repository, deny = []) {
  if (!Array.isArray(deny) || deny.some((value) => typeof value !== "string" || value.length < 4)) {
    throw new Error("The private deny file must contain an array of strings of at least four characters.");
  }
  const list = (args) => execFileSync("git", ["ls-files", ...args, "-z"],
    { cwd: repository, encoding: "utf8" }).split("\0").filter(Boolean);
  const staged = new Set(list(["--cached"]));
  const files = [...new Set([...staged, ...list(["--others", "--exclude-standard"])])];
  const findings = [];
  function inspect(name, bytes, source) {
    if (bytes.includes(0)) {
      findings.push({ file: name, source, rule: "binary requires manual privacy review" });
      return;
    }
    const text = bytes.toString("utf8");
    for (const [rule, pattern] of patterns) {
      if (pattern.test(text)) findings.push({ file: name, source, rule });
    }
    for (const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      if (isIP(match[0]) === 4 && !allowedIpv4(match[0])) {
        findings.push({ file: name, source, rule: "non-example public IPv4 address" });
        break;
      }
    }
    if (deny.some((value) => text.toLowerCase().includes(value.toLowerCase()))) {
      findings.push({ file: name, source, rule: "private deny-list match" });
    }
  }
  for (const name of files) {
    const absolute = path.join(repository, name);
    if (/(?:^|\/)(?:\.env(?:\.|$)|private|\.private|generated)(?:\/|$)|\.(?:key|pem|pfx|p12|db|sqlite|log|bak)$/i.test(name)) {
      findings.push({ file: name, rule: "private file included" });
    }
    let indexBytes;
    if (staged.has(name)) {
      try {
        indexBytes = execFileSync("git", ["show", `:${name}`], { cwd: repository, stdio: ["ignore", "pipe", "pipe"] });
        inspect(name, indexBytes, "index");
      } catch {
        findings.push({ file: name, rule: "could not inspect Git index" });
      }
    }
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      const workingBytes = fs.readFileSync(absolute);
      if (!indexBytes || !indexBytes.equals(workingBytes)) inspect(name, workingBytes, "worktree");
    }
  }
  return { files: files.length, findings, privateDenyListChecked: deny.length > 0 };
}

function main(args) {
  if (args.length && (args.length !== 2 || args[0] !== "--deny-file")) {
    throw new Error("Usage: node scripts/check-privacy.mjs [--deny-file <private-json-array>]");
  }
  const deny = args.length ? JSON.parse(fs.readFileSync(args[1], "utf8")) : [];
  const result = scanRepository(root, deny);
  if (result.findings.length) {
    console.error(JSON.stringify({ status: "failed", ...result }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ status: "passed", files: result.files, privateDenyListChecked: result.privateDenyListChecked }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof SyntaxError ? "Invalid JSON in the private deny file." :
      error.code ? `Privacy check could not complete (${error.code}).` : error.message);
    process.exitCode = 1;
  }
}
