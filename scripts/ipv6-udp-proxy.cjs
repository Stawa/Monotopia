const dgram = require("dgram");

const LISTEN_HOST = process.env.IPV6_PROXY_LISTEN_HOST || "::";
const LISTEN_PORT = Number(process.env.IPV6_PROXY_LISTEN_PORT || "17091");
const TARGET_HOST = process.env.IPV6_PROXY_TARGET_HOST || "127.0.0.1";
const TARGET_PORT = Number(process.env.IPV6_PROXY_TARGET_PORT || "17091");
const CLIENT_TIMEOUT_MS = Number(process.env.IPV6_PROXY_TIMEOUT_MS || "120000");

const server = dgram.createSocket({ type: "udp6", ipv6Only: true });
const clients = new Map();

function clientKey(rinfo) {
  return `${rinfo.address}:${rinfo.port}`;
}

function closeClient(key) {
  const client = clients.get(key);
  if (!client) return;

  client.socket.close();
  clearTimeout(client.timeout);
  clients.delete(key);
  console.log(`IPv6 UDP proxy closed ${key}`);
}

function refreshClientTimeout(key) {
  const client = clients.get(key);
  if (!client) return;

  clearTimeout(client.timeout);
  client.timeout = setTimeout(() => closeClient(key), CLIENT_TIMEOUT_MS);
}

function getClient(rinfo) {
  const key = clientKey(rinfo);
  const existing = clients.get(key);
  if (existing) {
    refreshClientTimeout(key);
    return existing;
  }

  const socket = dgram.createSocket("udp4");
  const client = {
    address: rinfo.address,
    port: rinfo.port,
    socket,
    timeout: setTimeout(() => closeClient(key), CLIENT_TIMEOUT_MS),
  };

  socket.on("message", (message) => {
    server.send(message, client.port, client.address);
    refreshClientTimeout(key);
  });

  socket.on("error", (error) => {
    console.warn(`IPv6 UDP proxy target error for ${key}: ${error.message}`);
    closeClient(key);
  });

  clients.set(key, client);
  console.log(`IPv6 UDP proxy opened ${key}`);
  return client;
}

server.on("message", (message, rinfo) => {
  const client = getClient(rinfo);
  client.socket.send(message, TARGET_PORT, TARGET_HOST);
});

server.on("error", (error) => {
  console.error(error.message);
  if (error.code === "EADDRINUSE") {
    console.error("");
    console.error(
      `UDP ${LISTEN_PORT} is already in use for IPv6. Stop the other listener or change IPV6_PROXY_LISTEN_PORT.`,
    );
  }
  process.exitCode = 1;
});

process.on("SIGINT", () => {
  for (const key of clients.keys()) closeClient(key);
  server.close();
});

server.bind(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `Monotopia IPv6 UDP proxy listening on [${LISTEN_HOST}]:${LISTEN_PORT}`,
  );
  console.log(`Forwarding IPv6 UDP to ${TARGET_HOST}:${TARGET_PORT}`);
});
