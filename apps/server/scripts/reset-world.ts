import "dotenv/config";
import { eq } from "drizzle-orm";
import { Database, worlds } from "@monotopia/db";

const usage = () => {
  console.log("Usage: pnpm reset:world <worldName>");
  console.log("Example: pnpm reset:world START");
  console.log(
    "This deletes the saved world row; it regenerates on next enter.",
  );
};

const worldName = process.argv[2]?.trim().toUpperCase();

if (!worldName || worldName === "--HELP" || worldName === "-H") {
  usage();
  process.exit(worldName ? 0 : 1);
}

const db = new Database();

const main = async () => {
  const world = await db.worlds.get(worldName);

  if (!world) {
    console.log(`World ${worldName} does not exist; nothing to reset.`);
    process.exit(0);
  }

  const result = await db.db
    .delete(worlds)
    .where(eq(worlds.name, worldName))
    .returning({ id: worlds.id, name: worlds.name });

  if (!result.length) {
    console.log(`World ${worldName} was not deleted.`);
    process.exit(1);
  }

  console.log(`Reset world ${result[0].name} (#${result[0].id}).`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Failed to reset world ${worldName}:`, error);
    process.exit(1);
  });
