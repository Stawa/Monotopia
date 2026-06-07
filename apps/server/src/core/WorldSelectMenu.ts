import { WORLD_CATEGORIES } from "@growserver/const";
import type { WorldData } from "@growserver/types";
import type { Base } from "./Base";
import type { Peer } from "./Peer";

const TOP_WORLD_COLOR = 3529161471;
const RECENT_WORLD_COLOR = 3417414143;
const CATEGORY_WORLD_COLOR = 4287123967;

function getWorldLockData(world: WorldData) {
  if (world.worldLockIndex === undefined) return undefined;

  return world.blocks[world.worldLockIndex]?.worldLockData;
}

function getWorldCategory(world: WorldData): string {
  return getWorldLockData(world)?.category ?? "None";
}

function getWorldPlayerCount(base: Base, worldName: string): number {
  return base.cache.worlds.get(worldName)?.playerCount ?? 0;
}

function addFloater(
  base: Base,
  worldName: string,
  color: number,
  count = getWorldPlayerCount(base, worldName),
): string {
  return `add_floater|${worldName}|${count}|0.5|${color}\n`;
}

function buildTopWorlds(base: Base): string {
  return Array.from(base.cache.worlds.values())
    .sort((a, b) => (b.playerCount || 0) - (a.playerCount || 0))
    .slice(0, 6)
    .map((world) => {
      if (!world.playerCount) return "";

      return addFloater(base, world.name, TOP_WORLD_COLOR, world.playerCount);
    })
    .join("\n");
}

function buildRecentWorlds(base: Base, peer: Peer): string {
  return [...(peer.data.lastVisitedWorlds ?? [])]
    .reverse()
    .map((worldName) => addFloater(base, worldName, RECENT_WORLD_COLOR))
    .join("\n");
}

function buildCategorizedWorlds(base: Base): string {
  const activeWorlds = Array.from(base.cache.worlds.values()).filter(
    (world) => !!world.playerCount,
  );

  return WORLD_CATEGORIES.filter((category) => category !== "None")
    .map((category) => {
      const worlds = activeWorlds
        .filter((world) => getWorldCategory(world) === category)
        .sort((a, b) => (b.playerCount || 0) - (a.playerCount || 0))
        .slice(0, 6);

      if (!worlds.length) return "";

      return `
add_heading|${category}<CR>|
${worlds
  .map((world) =>
    addFloater(base, world.name, CATEGORY_WORLD_COLOR, world.playerCount),
  )
  .join("\n")}
`;
    })
    .join("\n");
}

export function buildWorldSelectMenu(base: Base, peer: Peer): string {
  return `
add_heading|Top Worlds|
add_floater|START|0|0.5|${TOP_WORLD_COLOR}
${buildTopWorlds(base)}
${buildCategorizedWorlds(base)}
add_heading|Recently Visited Worlds<CR>|
${buildRecentWorlds(base, peer)}
`;
}
