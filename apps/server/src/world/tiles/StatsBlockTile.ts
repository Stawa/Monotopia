import { BlockFlags } from "@monotopia/const";
import { type ItemDefinition } from "grow-items";
import type { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import type { World } from "../../core/World";
import type { TileData } from "@monotopia/types";
import { sendGrowScanDialog } from "../../network/dialogs/GrowScan";
import { Tile } from "../Tile";

export class StatsBlockTile extends Tile {
  constructor(
    public base: Base,
    public world: World,
    public data: TileData,
  ) {
    super(base, world, data);
  }

  public async onPlaceForeground(
    peer: Peer,
    itemMeta: ItemDefinition,
  ): Promise<boolean> {
    if ((itemMeta.flags ?? 0) & BlockFlags.WORLD_LOCKED) {
      if (!this.world.getOwnerUID()) {
        peer.sendTextBubble(
          `${itemMeta.name ?? "This item"} can only be placed in World Locked worlds.`,
          false,
        );
        peer.sendOnPlayPositioned("audio/cant_place_tile.wav", {
          netID: peer.data?.netID,
        });
        return false;
      }
    }

    return super.onPlaceForeground(peer, itemMeta);
  }

  public async onWrench(peer: Peer): Promise<boolean> {
    if (!(await super.onWrench(peer))) {
      await this.onPlaceFail(peer);
      return false;
    }

    sendGrowScanDialog(this.base, peer, {
      mode:  "blocks",
      tileX: this.data.x,
      tileY: this.data.y,
    });
    return true;
  }
}
