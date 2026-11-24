import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { render, validateConfig, writeConfigs } from "../scripts/render-config.mjs";

function config() {
  const input = JSON.parse(fs.readFileSync(new URL("../examples/inputs.example.json", import.meta.url), "utf8"));
  for (const key of ["serverPrivateKey", "serverPublicKey", "phonePrivateKey", "phonePublicKey", "presharedKey"]) {
    input[key] = randomBytes(32).toString("base64");
  }
  return input;
}

test("phone extension preserves the subscription and is idempotent", () => {
  const input = config();
  const files = render(input);
  const context = vm.createContext({});
  vm.runInContext(files["flclash-extension.js"], context);
  const original = {
    proxies: [{ name: "Existing", type: "direct" }],
    "proxy-groups": [{ name: "Selection", type: "select", proxies: ["Existing"] }],
    rules: ["MATCH,Selection"],
    dns: { enable: true },
    tun: { enable: true },
  };
  const before = structuredClone(original);
  const once = context.main(original);
  const twice = context.main(once);
  assert.deepEqual(original, before);
  assert.equal(JSON.stringify(once), JSON.stringify(twice));
  assert.deepEqual(once.dns, before.dns);
  assert.deepEqual(once["proxy-groups"], before["proxy-groups"]);
  assert.equal(once.rules.at(-1), "MATCH,Selection");
  assert.equal(once.proxies.filter((proxy) => proxy.name === "T3-Home-WireGuard").length, 1);
  assert.equal(once.proxies.at(-1)["dialer-proxy"], "DIRECT");
  assert.deepEqual(Array.from(once.proxies.at(-1).peers[0]["allowed-ips"]), [`${input.t3Host}/32`]);
  assert.ok(once.rules[1].includes(`(DST-PORT,${input.t3Port})`));
});

test("secrets are separated between server and phone outputs", () => {
  const input = config();
  const files = render(input);
  assert.ok(files["openwrt-network.uci"].includes(input.serverPrivateKey));
  assert.ok(!files["openwrt-network.uci"].includes(input.phonePrivateKey));
  assert.ok(files["flclash-extension.js"].includes(input.phonePrivateKey));
  assert.ok(!files["flclash-extension.js"].includes(input.serverPrivateKey));
  assert.ok(!files["openwrt-firewall.uci"].includes(input.presharedKey));
  assert.ok(files["openwrt-firewall.uci"].includes("forward='REJECT'"));
  assert.ok(files["openwrt-firewall.uci"].includes(`dest_port='${input.t3Port}'`));
});

test("literal endpoint IPs receive a direct rule", () => {
  const input = { ...config(), endpoint: "203.0.113.10" };
  const fragment = JSON.parse(render(input)["mihomo-fragment.json"]);
  assert.equal(fragment.rules[0], "IP-CIDR,203.0.113.10/32,DIRECT,no-resolve");
});

test("changing the T3 port replaces this extension's old routed rule", () => {
  const firstConfig = config();
  const secondConfig = { ...firstConfig, t3Port: 3774 };
  const first = vm.createContext({});
  const second = vm.createContext({});
  vm.runInContext(render(firstConfig)["flclash-extension.js"], first);
  vm.runInContext(render(secondConfig)["flclash-extension.js"], second);
  const changed = second.main(first.main({ rules: ["MATCH,DIRECT"] }));
  assert.equal(changed.rules.filter((rule) => rule.endsWith(",T3-Home-WireGuard")).length, 1);
  assert.ok(changed.rules.some((rule) => rule.includes("DST-PORT,3774")));
  assert.ok(!changed.rules.some((rule) => rule.includes("DST-PORT,3773")));
});

test("placeholders, command injection, overlapping addresses and unknown fields are rejected", () => {
  const example = JSON.parse(fs.readFileSync(new URL("../examples/inputs.example.json", import.meta.url), "utf8"));
  assert.throws(() => validateConfig(example), /replace the placeholder/);
  assert.throws(() => validateConfig({ ...config(), ingressZone: "lan';reboot" }), /zone name/);
  assert.throws(() => validateConfig({ ...config(), endpoint: "host.invalid,REJECT" }), /hostname/);
  assert.throws(() => validateConfig({ ...config(), phoneAddress: "10.77.0.1/32" }), /distinct/);
  assert.throws(() => validateConfig({ ...config(), phoneAddress: "10.78.0.2/32" }), /inside/);
  assert.throws(() => validateConfig({ ...config(), t3Host: "10.77.0.9" }), /outside/);
  assert.throws(() => validateConfig({ ...config(), unrelatedCredential: "ignored" }), /Unexpected/);
});

test("writing uses a new external directory and never overwrites a deployment", (t) => {
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(temporaryParent, "t3-guide-test-"));
  t.after(() => {
    const target = fs.realpathSync(temporary);
    assert.equal(path.dirname(target), temporaryParent);
    assert.ok(path.basename(target).startsWith("t3-guide-test-"));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const input = path.join(temporary, "private-input.json");
  const output = path.join(temporary, "output");
  fs.writeFileSync(input, JSON.stringify(config()), { mode: 0o600 });
  assert.equal(writeConfigs(input, output), 5);
  assert.throws(() => writeConfigs(input, output), /already exists/);
  const inside = fileURLToPath(new URL("../never-create-secret-output", import.meta.url));
  assert.throws(() => writeConfigs(input, inside), /outside this repository/);
  assert.ok(!fs.existsSync(inside));
});
