import { Variant } from "growtopia.js";
import { TileExtraTypes, TileFlags } from "@growserver/const";
import type { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import type { World } from "../../core/World";
import type { TileData } from "@growserver/types";
import { DialogBuilder, ExtendBuffer } from "@growserver/utils";
import { Tile } from "../Tile";
import { ItemDefinition } from "grow-items";

export class GatewayTile extends Tile {
  public extraType = TileExtraTypes.DOOR;

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
    if (!(await super.onPlaceForeground(peer, itemMeta))) return false;

    this.data.flags |= TileFlags.TILEEXTRA | TileFlags.PUBLIC;
    this.data.entrace = {
      open: true,
    };

    return true;
  }

  public async onDestroy(peer: Peer): Promise<void> {
    await super.onDestroy(peer);
    this.data.entrace = undefined;
  }

  public async serialize(dataBuffer: ExtendBuffer): Promise<void> {
    await super.serialize(dataBuffer);

    dataBuffer.grow(4);
    dataBuffer.writeU8(this.extraType);
    dataBuffer.writeString("");
    dataBuffer.writeU8(this.isPublic() ? 0x0 : 0x8);
  }

  public async setFlags(flags: number): Promise<number> {
    flags = await super.setFlags(flags);
    flags |= TileFlags.TILEEXTRA;

    if (this.isPublic()) {
      flags |= TileFlags.OPEN;
    } else {
      flags &= ~TileFlags.OPEN;
    }

    return flags;
  }

  public async onWrench(peer: Peer): Promise<boolean> {
    if (!(await super.onWrench(peer))) {
      this.onPlaceFail(peer);
      return false;
    }

    const itemMeta = this.base.items.metadata.items.get(
      this.data.fg.toString(),
    );
    if (!itemMeta) return false;

    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon(
        `\`wEdit ${itemMeta.name}\`\``,
        itemMeta.id as number,
        "big",
      )
      .addCheckbox(
        "checkbox_public",
        "Open to public",
        this.isPublic() ? "selected" : "not_selected",
      )
      .embed("tilex", this.data.x)
      .embed("tiley", this.data.y)
      .embed("itemID", itemMeta.id)
      .endDialog("gateway_edit", "Cancel", "OK")
      .str();

    peer.send(Variant.from("OnDialogRequest", dialog));
    return true;
  }

  private isPublic(): boolean {
    return Boolean(this.data.flags & TileFlags.PUBLIC);
  }
}
