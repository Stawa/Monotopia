"use strict";

import { setupSeeds } from "./seeds";

async function seed() {
  await setupSeeds();
  process.exit(0);
}

(async () => {
  await seed();
})();
