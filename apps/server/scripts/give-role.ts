import "dotenv/config";
import { eq } from "drizzle-orm";
import { getRoleName, parseRole } from "@monotopia/const";
import { Database, players, type Players } from "@monotopia/db";
import { formatToDisplayName, parseUserTarget } from "@monotopia/utils";

const usage = () => {
  console.log("Usage: pnpm give:role <target> <role>");
  console.log("Target: /username or #userID");
  console.log("Role: regular/user/2, supporter/3, mod/4, developer/1");
  console.log("Example: pnpm give:role /admin developer");
};

const [targetArg, roleArg] = process.argv.slice(2);

if (!targetArg || !roleArg || targetArg === "--help" || targetArg === "-h") {
  usage();
  process.exit(targetArg ? 0 : 1);
}

const target = parseUserTarget(targetArg);
if (!target) {
  console.error("Invalid target. Use /username or #userID.");
  usage();
  process.exit(1);
}

const role = parseRole(roleArg);
if (!role) {
  console.error(`Invalid role: ${roleArg}`);
  usage();
  process.exit(1);
}

const db = new Database();

const findPlayer = async (): Promise<Players | undefined> => {
  if (target.type === "name") {
    return db.players.get((target.value as string).toLowerCase());
  }

  return db.players.getByUID(target.value as number);
};

const main = async () => {
  const player = await findPlayer();

  if (!player) {
    console.error(`Player not found: ${targetArg}`);
    process.exit(1);
  }

  const displayName = formatToDisplayName(player.name, role);

  await db.db
    .update(players)
    .set({
      role,
      display_name: displayName,
      updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    })
    .where(eq(players.id, player.id));

  console.log(
    `Updated ${player.name} (#${player.id}) from ${getRoleName(
      player.role,
    )} to ${getRoleName(role)}.`,
  );
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to update role:", error);
    process.exit(1);
  });
