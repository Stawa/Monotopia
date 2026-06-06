import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";

export interface WebLoginToken {
  token: string;
  createdAt: number;
}

const TOKEN_MAX_AGE_MS = 60_000;

function tokenPath() {
  return join(resolve(process.cwd(), "..", "..", ".cache"), "web-login.json");
}

function deleteToken(path: string) {
  try {
    unlinkSync(path);
  } catch {
    // The game server may have consumed it first.
  }
}

export function writeWebLoginToken(token: string) {
  const path = tokenPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ token, createdAt: Date.now() }));
}

export function consumeWebLoginToken(maxAgeMs = TOKEN_MAX_AGE_MS) {
  const path = tokenPath();
  if (!existsSync(path)) return undefined;

  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as WebLoginToken;
    if (
      typeof data.token !== "string" ||
      typeof data.createdAt !== "number" ||
      Date.now() - data.createdAt > maxAgeMs
    ) {
      deleteToken(path);
      return undefined;
    }

    deleteToken(path);
    return data;
  } catch {
    deleteToken(path);
    return undefined;
  }
}
