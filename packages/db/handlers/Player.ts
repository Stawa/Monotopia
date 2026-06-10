import { type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import { players } from "../shared/schemas/Player";
import bcrypt from "bcryptjs";
import { DEFAULT_SKIN_COLOR, ROLE } from "@monotopia/const";
import { PeerData } from "@monotopia/types";

export class PlayerDB {
  private static schemaReady: Promise<void> | undefined;

  constructor(private db: PostgresJsDatabase<Record<string, never>>) {}

  private async ensureSchema() {
    PlayerDB.schemaReady ??= Promise.all([
      this.db.execute(
        sql.raw(
          `ALTER TABLE players ADD COLUMN IF NOT EXISTS skin_color BIGINT DEFAULT ${DEFAULT_SKIN_COLOR}`,
        ),
      ),
      this.db.execute(
        sql.raw("ALTER TABLE players ADD COLUMN IF NOT EXISTS home_world TEXT"),
      ),
      this.db.execute(
        sql.raw(
          "ALTER TABLE players ADD COLUMN IF NOT EXISTS friends TEXT DEFAULT '[]'",
        ),
      ),
    ])
      .then(() => undefined)
      .catch((error) => {
        PlayerDB.schemaReady = undefined;
        throw error;
      });

    await PlayerDB.schemaReady;
  }

  public async get(name: string) {
    await this.ensureSchema();

    const res = await this.db
      .select()
      .from(players)
      .where(eq(players.name, name.toLowerCase()))
      .limit(1)
      .execute();

    if (res.length) return res[0];
    return undefined;
  }

  public async getByUID(userID: number) {
    await this.ensureSchema();

    const res = await this.db
      .select()
      .from(players)
      .where(eq(players.id, userID))
      .limit(1)
      .execute();

    if (res.length) return res[0];
    return undefined;
  }

  public async has(name: string) {
    await this.ensureSchema();

    const res = await this.db
      .select({ count: sql`count(*)` })
      .from(players)
      .where(eq(players.name, name.toLowerCase()))
      .limit(1)
      .execute();

    return (res[0].count as number) > 0;
  }

  public async set(name: string, password: string) {
    await this.ensureSchema();

    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(password, salt);

    const res = await this.db
      .insert(players)
      .values({
        display_name: name,
        name: name.toLowerCase(),
        password: hashPassword,
        role: ROLE.BASIC,
        skin_color: DEFAULT_SKIN_COLOR,
        friends: JSON.stringify([]),
        heart_monitors: JSON.stringify({}),
      })
      .returning({ id: players.id });

    if (res.length && res[0].id) return res[0].id;
    return 0;
  }

  public async save(data: PeerData) {
    if (!data.userID) return false;
    await this.ensureSchema();

    const res = await this.db
      .update(players)
      .set({
        name: data.name.toLowerCase(),
        display_name: data.displayName,
        role: data.role,
        inventory: JSON.stringify(data.inventory),
        clothing: JSON.stringify(data.clothing),
        skin_color: data.skinColor ?? DEFAULT_SKIN_COLOR,
        home_world: data.homeWorld ?? null,
        gems: data.gems,
        level: data.level,
        exp: data.exp,
        friends: JSON.stringify(data.friends ?? []),
        last_visited_worlds: JSON.stringify(data.lastVisitedWorlds),
        updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        heart_monitors: JSON.stringify(Object.fromEntries(data.heartMonitors)),
      })
      .where(eq(players.id, data.userID))
      .returning({ id: players.id });

    if (res.length) return true;
    else return false;
  }
}
