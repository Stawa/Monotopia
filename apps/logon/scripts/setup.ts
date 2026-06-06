"use strict";

import { downloadMkcert, setupMkcert } from "@growserver/utils";

async function setup() {
  await downloadMkcert();
  await setupMkcert();
}

(async () => {
  await setup();
})();
