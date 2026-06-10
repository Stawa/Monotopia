"use strict";

import postgres from "postgres";
import { config } from "dotenv";
import { DEFAULT_SKIN_COLOR } from "@monotopia/const";

config({
  path: "../../.env",
});

export async function setupSeeds() {
  const connection = postgres(process.env.DATABASE_URL!);

  await connection.unsafe(`DROP TABLE IF EXISTS players CASCADE;`);
  await connection.unsafe(`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL CONSTRAINT players_name_unique UNIQUE,
      display_name TEXT NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      gems INTEGER DEFAULT 0,
      level INTEGER DEFAULT 0,
      exp INTEGER DEFAULT 0,
      clothing TEXT,
      inventory TEXT,
      skin_color BIGINT DEFAULT ${DEFAULT_SKIN_COLOR},
      home_world TEXT,
      last_visited_worlds TEXT,
      friends TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp),
      heart_monitors TEXT NOT NULL
    );
  `);

  await connection.end();
}
