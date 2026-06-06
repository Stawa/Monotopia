import { ActionTypes, BlockFlags } from "@growserver/const";
import type { Base } from "../core/Base";
import type { TileData } from "@growserver/types";
import type { ItemDefinition } from "grow-items";

const WRENCHABLE_TILE_TYPES = new Set<number>([
  ActionTypes.DOOR,
  ActionTypes.LOCK,
  ActionTypes.GATEWAY,
  ActionTypes.SIGN,
  ActionTypes.MAIN_DOOR,
  ActionTypes.PORTAL,
  ActionTypes.SWITCHEROO,
  ActionTypes.DICE,
  ActionTypes.DISPLAY_BLOCK,
  ActionTypes.VENDING_MACHINE,
  ActionTypes.VIP_ENTRANCE,
  ActionTypes.RED_FACTION,
  ActionTypes.GREEN_FACTION,
  ActionTypes.BLUE_FACTION,
  ActionTypes.FRIENDS_ENTRANCE,
]);

export function isWrenchableTile(
  base: Base,
  tileData: TileData,
  itemMeta?: ItemDefinition,
): boolean {
  if (
    tileData.door ||
    tileData.sign ||
    tileData.lock ||
    tileData.worldLockData ||
    tileData.entrace ||
    tileData.displayBlock ||
    tileData.vendingMachine ||
    tileData.dice
  ) {
    return true;
  }

  const meta =
    itemMeta ?? base.items.metadata.items.get((tileData.fg || tileData.bg).toString());

  if (!meta) return false;
  if ((meta.flags ?? 0) & BlockFlags.WRENCHABLE) return true;

  return WRENCHABLE_TILE_TYPES.has(meta.type ?? -1);
}
