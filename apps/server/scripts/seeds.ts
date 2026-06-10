"use strict";

import { Database } from "@monotopia/db";

async function seed() {
  const db = new Database();
  await db.setup();
  process.exit(0);
}

(async () => {
  await seed();
})();
