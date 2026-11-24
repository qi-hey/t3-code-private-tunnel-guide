import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";

const projectRoot = fs.realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const nodeName = "T3-Home-WireGuard";
const fields = [
  "endpoint", "listenPort", "t3Host", "t3Port", "wireguardSubnet",
  "serverAddress", "phoneAddress", "serverPrivateKey", "serverPublicKey",
  "phonePrivateKey", "phonePublicKey", "presharedKey", "ingressZone",
  "lanZone", "mtu", "keepalive",
];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function ipv4Number(address) {
  return address.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
}

function parseCidr(value, field) {
  requireCondition(typeof value === "string", `${field}: expected IPv4 CIDR.`);
  const parts = value.split("/");
  const prefix = Number(parts[1]);
  requireCondition(
    parts.length === 2 && isIP(parts[0]) === 4 &&
      /^\d+$/.test(parts[1]) && prefix >= 0 && prefix <= 32,
    `${field}: expected IPv4 CIDR.`,
  );
  const block = 2 ** (32 - prefix);
  const number = ipv4Number(parts[0]);
  return { address: parts[0], prefix, start: Math.floor(number / block) * block, block, number };
}

export function validateConfig(config) {
  requireCondition(config && typeof config === "object" && !Array.isArray(config), "Expected an object.");
  requireCondition(Object.keys(config).every((field) => fields.includes(field)), "Unexpected configuration field.");
  requireCondition(fields.every((field) => Object.hasOwn(config, field)), "Required configuration fields are missing.");
  requireCondition(isIP(config.t3Host) === 4, "t3Host: expected an IPv4 address.");
  requireCondition(
    typeof config.endpoint === "string" &&
      (isIP(config.endpoint) === 4 ||
        (config.endpoint.length <= 253 && config.endpoint.split(".").length >= 2 &&
          config.endpoint.split(".").every((label) =>
            /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))),
    "endpoint: expected an IPv4 address or hostname, without a scheme or port.",
  );
  for (const field of ["listenPort", "t3Port"]) {
    requireCondition(Number.isInteger(config[field]) && config[field] >= 1 && config[field] <= 65535,
      `${field}: expected a port from 1 to 65535.`);
  }
  for (const field of ["serverPrivateKey", "serverPublicKey", "phonePrivateKey", "phonePublicKey", "presharedKey"]) {
    const value = config[field];
    requireCondition(typeof value === "string" && /^[A-Za-z0-9+/]{43}=$/.test(value) &&
      Buffer.from(value, "base64").length === 32 && Buffer.from(value, "base64").toString("base64") === value,
    `${field}: replace the placeholder with a canonical 32-byte base64 key.`);
  }
  requireCondition(config.serverPublicKey !== config.phonePublicKey, "Server and phone must use separate key pairs.");
  for (const field of ["ingressZone", "lanZone"]) {
    requireCondition(typeof config[field] === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,14}$/.test(config[field]),
      `${field}: expected an existing OpenWrt zone name.`);
  }
  requireCondition(Number.isInteger(config.mtu) && config.mtu >= 1280 && config.mtu <= 1500,
    "mtu: expected an integer from 1280 to 1500.");
  requireCondition(Number.isInteger(config.keepalive) && config.keepalive >= 0 && config.keepalive <= 65535,
    "keepalive: expected an integer from 0 to 65535.");
  const subnet = parseCidr(config.wireguardSubnet, "wireguardSubnet");
  const server = parseCidr(config.serverAddress, "serverAddress");
  const phone = parseCidr(config.phoneAddress, "phoneAddress");
  requireCondition(subnet.prefix >= 16 && subnet.prefix <= 30 && subnet.number === subnet.start,
    "wireguardSubnet: use a canonical /16 through /30 network.");
  requireCondition(server.prefix === subnet.prefix && phone.prefix === 32,
    "Server prefix must match the subnet; the phone must use /32.");
  const usable = (address) => address.number > subnet.start && address.number < subnet.start + subnet.block - 1;
  requireCondition(usable(server) && usable(phone) && server.number !== phone.number,
    "Server and phone must have distinct usable addresses inside the WireGuard subnet.");
  const t3Number = ipv4Number(config.t3Host);
  requireCondition(t3Number < subnet.start || t3Number >= subnet.start + subnet.block,
    "The T3 host must be outside the WireGuard subnet in this routed topology.");
  return config;
}

export function render(config) {
  validateConfig(config);
  const phoneIp = config.phoneAddress.split("/")[0];
  const node = {
    name: nodeName,
    type: "wireguard",
    ip: phoneIp,
    "private-key": config.phonePrivateKey,
    mtu: config.mtu,
    udp: true,
    "persistent-keepalive": config.keepalive,
    "dialer-proxy": "DIRECT",
    peers: [{
      server: config.endpoint,
      port: config.listenPort,
      "public-key": config.serverPublicKey,
      "pre-shared-key": config.presharedKey,
      "allowed-ips": [`${config.t3Host}/32`],
    }],
  };
  const endpointRule = isIP(config.endpoint) === 4
    ? `IP-CIDR,${config.endpoint}/32,DIRECT,no-resolve`
    : `DOMAIN,${config.endpoint},DIRECT`;
  const rules = [
    endpointRule,
    `AND,((IP-CIDR,${config.t3Host}/32),(DST-PORT,${config.t3Port})),${nodeName}`,
  ];
  const network = [
    "# Private UCI batch: inspect named sections before applying. No commit included.",
    "set network.wg_t3='interface'",
    "set network.wg_t3.proto='wireguard'",
    `set network.wg_t3.private_key='${config.serverPrivateKey}'`,
    `set network.wg_t3.listen_port='${config.listenPort}'`,
    `set network.wg_t3.mtu='${config.mtu}'`,
    `add_list network.wg_t3.addresses='${config.serverAddress}'`,
    "set network.t3_phone='wireguard_wg_t3'",
    "set network.t3_phone.description='T3 phone'",
    `set network.t3_phone.public_key='${config.phonePublicKey}'`,
    `set network.t3_phone.preshared_key='${config.presharedKey}'`,
    `add_list network.t3_phone.allowed_ips='${config.phoneAddress}'`,
    "set network.t3_phone.route_allowed_ips='1'",
    "",
  ].join("\n");
  const firewall = [
    "# Private UCI batch: verify ingressZone and lanZone on the target router.",
    "set firewall.t3_wg='zone'",
    "set firewall.t3_wg.name='t3wg'",
    "add_list firewall.t3_wg.network='wg_t3'",
    "set firewall.t3_wg.input='REJECT'",
    "set firewall.t3_wg.output='ACCEPT'",
    "set firewall.t3_wg.forward='REJECT'",
    "set firewall.t3_wg_udp='rule'",
    "set firewall.t3_wg_udp.name='T3 WireGuard handshake'",
    `set firewall.t3_wg_udp.src='${config.ingressZone}'`,
    "set firewall.t3_wg_udp.proto='udp'",
    `set firewall.t3_wg_udp.dest_port='${config.listenPort}'`,
    "set firewall.t3_wg_udp.family='ipv4'",
    "set firewall.t3_wg_udp.target='ACCEPT'",
    "set firewall.t3_wg_t3='rule'",
    "set firewall.t3_wg_t3.name='T3 WireGuard only T3'",
    "set firewall.t3_wg_t3.src='t3wg'",
    `set firewall.t3_wg_t3.src_ip='${phoneIp}'`,
    `set firewall.t3_wg_t3.dest='${config.lanZone}'`,
    `set firewall.t3_wg_t3.dest_ip='${config.t3Host}'`,
    `set firewall.t3_wg_t3.dest_port='${config.t3Port}'`,
    "set firewall.t3_wg_t3.proto='tcp'",
    "set firewall.t3_wg_t3.family='ipv4'",
    "set firewall.t3_wg_t3.target='ACCEPT'",
    "",
  ].join("\n");
  const extension = `function main(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Expected a Clash configuration object.");
  }
  var tunnel = ${JSON.stringify(node, null, 2)};
  var ownedRules = ${JSON.stringify(rules, null, 2)};
  var proxies = config.proxies || [];
  var rules = config.rules || [];
  if (!Array.isArray(proxies) || !Array.isArray(rules)) {
    throw new Error("Existing proxies and rules must be arrays.");
  }
  var result = Object.assign({}, config);
  result.proxies = proxies.filter(function (proxy) { return proxy.name !== tunnel.name; }).concat([tunnel]);
  result.rules = ownedRules.concat(rules.filter(function (rule) {
    return typeof rule !== "string" ||
      (rule.split(",").pop().trim() !== tunnel.name && ownedRules.indexOf(rule) === -1);
  }));
  return result;
}
`;
  return {
    "openwrt-network.uci": network,
    "openwrt-firewall.uci": firewall,
    "flclash-extension.js": extension,
    "mihomo-fragment.json": JSON.stringify({ proxies: [node], rules }, null, 2) + "\n",
    "PRIVATE-DO-NOT-PUBLISH.txt": "This directory contains private keys and network identifiers.\nDo not commit, upload, screenshot, or paste its files into public conversations.\nThe JSON fragment is additive; it is not a complete Clash subscription.\n",
  };
}

function insideProject(candidate) {
  const relative = path.relative(projectRoot, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function writeConfigs(inputPath, outputPath) {
  const realInput = fs.realpathSync(inputPath);
  requireCondition(!insideProject(realInput), "Keep the private input JSON outside this repository.");
  const config = JSON.parse(fs.readFileSync(realInput, "utf8"));
  const files = render(config);
  const absoluteOutput = path.resolve(outputPath);
  const parent = fs.realpathSync(path.dirname(absoluteOutput));
  const realOutput = fs.existsSync(absoluteOutput)
    ? fs.realpathSync(absoluteOutput)
    : path.join(parent, path.basename(absoluteOutput));
  requireCondition(!insideProject(realOutput), "Output must be outside this repository.");
  requireCondition(!fs.existsSync(realOutput), "Output directory already exists; choose a new private directory.");
  fs.mkdirSync(realOutput, { mode: 0o700 });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(realOutput, name), content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
  return Object.keys(files).length;
}

function main(args) {
  if (args.length !== 4 || args[0] !== "--config" || args[2] !== "--out-dir") {
    throw new Error("Usage: node scripts/render-config.mjs --config <private-json> --out-dir <new-private-directory>");
  }
  const count = writeConfigs(args[1], args[3]);
  console.log(`Generated ${count} private files. No router, app, or subscription was changed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    // JSON parser and filesystem errors can contain private values or paths.
    console.error(error instanceof SyntaxError ? "Invalid JSON in the private input file." :
      error.code ? `Filesystem operation failed (${error.code}).` : error.message);
    process.exitCode = 1;
  }
}
