const dgram = require("dgram");
const fs = require("fs");
const net = require("net");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const HOSTS_PATH = path.join(ROOT, "hosts.txt");
const LISTEN_HOST = process.env.MOBILE_DNS_HOST || getDefaultListenHost();
const LISTEN_PORT = Number(process.env.MOBILE_DNS_PORT || "53");
const UPSTREAM_HOST = process.env.MOBILE_DNS_UPSTREAM || "1.1.1.1";
const UPSTREAM_PORT = Number(process.env.MOBILE_DNS_UPSTREAM_PORT || "53");
const DEFAULT_TTL_SECONDS = 30;

function stripAddressBrackets(address) {
  return address.replace(/^\[|\]$/g, "");
}

function getDefaultListenHost() {
  const hosts = parseHosts();
  const firstIPv4 = [...hosts.values()].flatMap((entry) => entry[4])[0];

  return firstIPv4 || "0.0.0.0";
}

function ensureHostEntry(hosts, domain) {
  const key = domain.toLowerCase();
  const existing = hosts.get(key);
  if (existing) return existing;

  const entry = { 4: [], 6: [] };
  hosts.set(key, entry);
  return entry;
}

function parseHosts() {
  const hosts = new Map();
  const lines = fs.existsSync(HOSTS_PATH)
    ? fs.readFileSync(HOSTS_PATH, "utf-8").split(/\r?\n/)
    : [];

  for (const line of lines) {
    const cleanLine = line.replace(/#.*/, "").trim();
    if (!cleanLine) continue;

    const [rawAddress, ...domains] = cleanLine.split(/\s+/);
    const address = stripAddressBrackets(rawAddress);
    const family = net.isIP(address);
    if (family !== 4 && family !== 6) continue;

    for (const domain of domains) {
      const entry = ensureHostEntry(hosts, domain);
      if (!entry[family].includes(address)) entry[family].push(address);
    }
  }

  return hosts;
}

function readName(packet, offset) {
  const labels = [];
  let cursor = offset;

  while (cursor < packet.length) {
    const length = packet[cursor];
    if (length === 0)
      return { name: labels.join(".").toLowerCase(), offset: cursor + 1 };
    if ((length & 0xc0) !== 0)
      throw new Error("Compressed question names are not supported");

    const start = cursor + 1;
    const end = start + length;
    if (end > packet.length) throw new Error("Invalid DNS question name");

    labels.push(packet.subarray(start, end).toString("ascii"));
    cursor = end;
  }

  throw new Error("Unterminated DNS question name");
}

function parseQuestion(packet) {
  if (packet.length < 12) throw new Error("DNS packet too short");

  const questions = packet.readUInt16BE(4);
  if (questions < 1) return undefined;

  const name = readName(packet, 12);
  const questionEnd = name.offset + 4;
  if (questionEnd > packet.length) throw new Error("Invalid DNS question");

  return {
    name: name.name,
    section: packet.subarray(12, questionEnd),
    type: packet.readUInt16BE(name.offset),
    klass: packet.readUInt16BE(name.offset + 2),
  };
}

function ipv4Bytes(address) {
  return Buffer.from(address.split(".").map((part) => Number(part)));
}

function expandEmbeddedIPv4(address) {
  if (!address.includes(".")) return address;

  const lastColon = address.lastIndexOf(":");
  const ipv4 = address.slice(lastColon + 1);
  const bytes = ipv4.split(".").map((part) => Number(part));
  if (bytes.length !== 4 || bytes.some((byte) => byte < 0 || byte > 255))
    throw new Error("Invalid embedded IPv4 address");

  const hextets = [
    ((bytes[0] << 8) | bytes[1]).toString(16),
    ((bytes[2] << 8) | bytes[3]).toString(16),
  ];

  return `${address.slice(0, lastColon)}:${hextets.join(":")}`;
}

function ipv6Bytes(address) {
  const cleanAddress = expandEmbeddedIPv4(address.split("%")[0]);
  if (net.isIP(cleanAddress) !== 6) throw new Error("Invalid IPv6 address");

  const halves = cleanAddress.split("::");
  if (halves.length > 2) throw new Error("Invalid IPv6 address");

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const parts = [...head, ...Array(missing).fill("0"), ...tail];
  if (parts.length !== 8) throw new Error("Invalid IPv6 address");

  const bytes = Buffer.alloc(16);
  parts.forEach((part, index) => {
    const value = Number.parseInt(part || "0", 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff)
      throw new Error("Invalid IPv6 address");
    bytes.writeUInt16BE(value, index * 2);
  });

  return bytes;
}

function addressBytes(address, type) {
  if (!address) return undefined;
  if (type === 1) return ipv4Bytes(address);
  if (type === 28) return ipv6Bytes(address);
  return undefined;
}

function createResponse(query, question, address) {
  const data = addressBytes(address, question.type);
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2);
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(data ? 1 : 0, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);

  if (!data) return Buffer.concat([header, question.section]);

  const answer = Buffer.alloc(12 + data.length);
  answer.writeUInt16BE(0xc00c, 0);
  answer.writeUInt16BE(question.type, 2);
  answer.writeUInt16BE(1, 4);
  answer.writeUInt32BE(DEFAULT_TTL_SECONDS, 6);
  answer.writeUInt16BE(data.length, 10);
  data.copy(answer, 12);

  return Buffer.concat([header, question.section, answer]);
}

function createServerFailure(query) {
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, Math.min(12, query.length));
  header.writeUInt16BE(0x8182, 2);
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  return header;
}

function forwardQuery(query, callback) {
  const upstream = dgram.createSocket(
    net.isIP(UPSTREAM_HOST) === 6 ? "udp6" : "udp4",
  );
  const done = (response) => {
    clearTimeout(timeout);
    upstream.close();
    callback(response);
  };
  const timeout = setTimeout(() => done(createServerFailure(query)), 2500);

  upstream.once("message", done);
  upstream.once("error", () => done(createServerFailure(query)));
  upstream.send(query, UPSTREAM_PORT, UPSTREAM_HOST);
}

function addressForQuestion(entry, question) {
  if (question.type === 1) return entry[4][0];
  if (question.type === 28) return entry[6][0];
  return undefined;
}

function isOverrideQuestion(question) {
  return question.klass === 1 && (question.type === 1 || question.type === 28);
}

const hosts = parseHosts();
const socketType = net.isIP(LISTEN_HOST) === 6 ? "udp6" : "udp4";
const server = dgram.createSocket(socketType);

server.on("message", (query, rinfo) => {
  try {
    const question = parseQuestion(query);
    if (!question) {
      forwardQuery(query, (response) =>
        server.send(response, rinfo.port, rinfo.address),
      );
      return;
    }

    const entry = hosts.get(question.name);
    if (entry && isOverrideQuestion(question)) {
      const address = addressForQuestion(entry, question);
      const response = createResponse(query, question, address);
      server.send(response, rinfo.port, rinfo.address);
      console.log(
        `${question.name} ${question.type === 28 ? "AAAA" : "A"} -> ${
          address || "empty"
        }`,
      );
      return;
    }

    forwardQuery(query, (response) =>
      server.send(response, rinfo.port, rinfo.address),
    );
  } catch (error) {
    server.send(createServerFailure(query), rinfo.port, rinfo.address);
    console.warn(
      `DNS error for ${rinfo.address}:${rinfo.port}: ${error.message}`,
    );
  }
});

server.on("error", (error) => {
  console.error(error.message);
  if (error.code === "EADDRINUSE") {
    console.error("");
    console.error(
      `Port ${LISTEN_PORT} is already in use. Run this in Administrator PowerShell:`,
    );
    console.error("");
    console.error("  net stop SharedAccess");
    console.error(
      '  netsh advfirewall firewall add rule name="Monotopia Mobile DNS UDP 53" dir=in action=allow protocol=UDP localport=53',
    );
    console.error("");
    console.error("Then start this again:");
    console.error("");
    console.error("  pnpm run mobile:dns");
  }
  process.exitCode = 1;
});

server.bind(LISTEN_PORT, LISTEN_HOST, () => {
  const overrideCount = [...hosts.values()].reduce(
    (count, entry) => count + entry[4].length + entry[6].length,
    0,
  );
  console.log(
    `Monotopia mobile DNS listening on ${LISTEN_HOST}:${LISTEN_PORT} (${socketType})`,
  );
  console.log(`Loaded ${overrideCount} host overrides from ${HOSTS_PATH}`);
  console.log(
    `Forwarding everything else to ${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
  );
});
