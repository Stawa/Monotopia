"use strict";

import {
  downloadMkcert,
  downloadWebsite,
  setupMkcert,
  setupWebsite,
} from "@monotopia/utils";

async function setup() {
  await downloadMkcert();
  await downloadWebsite();

  await setupMkcert();
  await setupWebsite();
}

(async () => {
  await setup();
  process.exit(0);
})();
