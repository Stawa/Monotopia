import { type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import { worlds } from "../shared/schemas/World";
import { WorldData } from "@monotopia/types";

export class WorldDB {
  constructor(private db: PostgresJsDatabase<Record<string, never>>) {}

  private getWorldLockIndex(data: WorldData): number | undefined {
    const index = data.worldLockIndex;

    if (
      index !== undefined &&
      data.blocks[index]?.lock &&
      data.blocks[index]?.worldLockData
    ) {
      return index;
    }

    const foundIndex = data.blocks.findIndex(
      (block) => !!block.lock && !!block.worldLockData,
    );

    return foundIndex >= 0 ? foundIndex : undefined;
  }

  public async get(name: string) {
    const res = await this.db
      .select()
      .from(worlds)
      .where(eq(worlds.name, name))
      .limit(1)
      .execute();

    if (res.length) return res[0];
    return undefined;
  }

  public async has(name: string) {
    const res = await this.db
      .select({ count: sql`count(*)` })
      .from(worlds)
      .where(eq(worlds.name, name))
      .limit(1)
      .execute();

    return (res[0].count as number) > 0;
  }

  public async set(data: WorldData) {
    if (!data.name && !data.blocks && !data.width && !data.height) return 0;

    const worldLockIndex = this.getWorldLockIndex(data);
    const worldLockData =
      worldLockIndex !== undefined ? data.blocks[worldLockIndex].lock : null;

    const res = await this.db
      .insert(worlds)
      .values({
        name: data.name,
        ownedBy: worldLockData?.ownerUserID ?? null,
        width: data.width,
        height: data.height,
        blocks: JSON.stringify(data.blocks),
        // owner: data.owner ? Buffer.from(JSON.stringify(data.owner)) : null,
        dropped: JSON.stringify(data.dropped),
        updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        weather_id: data.weather.id,
        worldlock_index: worldLockIndex ?? null,
        // minimum_level: data.minLevel
      })
      .returning({ id: worlds.id });

    if (res.length && res[0].id) return res[0].id;
    return 0;
  }

  public async save(data: WorldData) {
    if (!data.name && !data.blocks && !data.width && !data.height) return false;

    const worldLockIndex = this.getWorldLockIndex(data);
    const worldLockData =
      worldLockIndex !== undefined ? data.blocks[worldLockIndex].lock : null;

    const res = await this.db
      .update(worlds)
      .set({
        ownedBy: worldLockData?.ownerUserID ?? null,
        width: data.width,
        height: data.height,
        blocks: JSON.stringify(data.blocks), // only save tile data here.
        // owner: data.owner ? Buffer.from(JSON.stringify(data.owner)) : null,
        dropped: JSON.stringify(data.dropped),
        updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        weather_id: data.weather.id,
        worldlock_index: worldLockIndex ?? null,
        // minimum_level: data.minLevel
      })
      .where(eq(worlds.name, data.name))
      .returning({ id: worlds.id });

    if (res.length) return true;
    return false;
  }
}
