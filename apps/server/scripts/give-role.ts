import "dotenv/config";
import { eq } from "drizzle-orm";
import { ROLE } from "@growserver/const";
import { Database, players, type Players } from "@growserver/db";
import { formatToDisplayName, parseUserTarget } from "@growserver/utils";

const ROLE_BY_FLAG: Record<string, string> = {
  "0": ROLE.BASIC,
  basic: ROLE.BASIC,
  user: ROLE.BASIC,
  "1": ROLE.SUPPORTER,
  supporter: ROLE.SUPPORTER,
  support: ROLE.SUPPORTER,
  "2": ROLE.DEVELOPER,
  developer: ROLE.DEVELOPER,
  dev: ROLE.DEVELOPER,
  admin: ROLE.DEVELOPER,
};

const ROLE_LABEL: Record<string, string> = {
  [ROLE.BASIC]: "Basic",
  [ROLE.SUPPORTER]: "Supporter",
  [ROLE.DEVELOPER]: "Developer",
};

const usage = () => {
  console.log("Usage: pnpm give:role <target> <role>");
  console.log("Target: /username or #userID");
  console.log("Role: 0/basic, 1/supporter, 2/developer");
  console.log("Example: pnpm give:role /admin 2");
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

const role = ROLE_BY_FLAG[roleArg.toLowerCase()];
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
      updated_at:   new Date().toISOString().slice(0, 19).replace("T", " "),
    })
    .where(eq(players.id, player.id));

  console.log(
    `Updated ${player.name} (#${player.id}) from ${
      ROLE_LABEL[player.role] ?? player.role
    } to ${ROLE_LABEL[role]}.`,
  );
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to update role:", error);
    process.exit(1);
  });
