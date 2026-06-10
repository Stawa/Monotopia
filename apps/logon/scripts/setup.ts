"use strict";

import { downloadMkcert, setupMkcert } from "@monotopia/utils";

async function setup() {
  await downloadMkcert();
  await setupMkcert();
}

(async () => {
  await setup();
})();
