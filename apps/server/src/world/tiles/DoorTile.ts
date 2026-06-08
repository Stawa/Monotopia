import { Variant } from "growtopia.js";
import { LockPermission, TileExtraTypes, TileFlags } from "@growserver/const";
import type { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import type { World } from "../../core/World";
import type { TileData } from "@growserver/types";
import { ExtendBuffer, DialogBuilder } from "@growserver/utils";
import { Tile } from "../Tile";
import { ItemDefinition } from "grow-items";

export class DoorTile extends Tile {
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
    if (!(await super.onPlaceForeground(peer, itemMeta))) {
      return false;
    }

    // by default, it is public
    // in real growtopia server, they dont use this. But because im lazy, im gonna use TileFlags instead - Badewen
    this.data.flags |= TileFlags.TILEEXTRA | TileFlags.PUBLIC;
    this.data.door = {
      destination: "",
      id:          "",
      label:       "",
    };

    return true;
  }

  public async onDestroy(peer: Peer): Promise<void> {
    await super.onDestroy(peer);
    this.data.door = undefined;
  }

  private getDoorData() {
    this.data.door ??= {
      destination: "",
      id:          "",
      label:       "",
    };

    return this.data.door;
  }

  private getDestinationLabel(destination?: string): string {
    const [worldName, doorID] = (destination ?? "").split(":");

    return (worldName || doorID || "").trim();
  }

  private getDisplayLabel(): string {
    const door = this.getDoorData();
    const label = (door.label ?? "").trim();

    return label || this.getDestinationLabel(door.destination);
  }

  public async serialize(dataBuffer: ExtendBuffer): Promise<void> {
    await super.serialize(dataBuffer);
    const label = this.getDisplayLabel();
    const labelTotalSize = 2 + label.length;
    dataBuffer.grow(1 + labelTotalSize + 1);

    dataBuffer.writeU8(this.extraType);
    dataBuffer.writeString(label);
    // 0x8 = Locked
    dataBuffer.writeU8(this.data.flags & TileFlags.PUBLIC ? 0x0 : 0x8);
  }

  public async setFlags(flags: number): Promise<number> {
    flags = await super.setFlags(flags);
    flags |= TileFlags.TILEEXTRA;

    if (this.data.flags & TileFlags.PUBLIC) {
      flags |= TileFlags.OPEN;
    } else {
      flags &= ~TileFlags.OPEN;
    }

    return flags;
  }

  public async onWrench(peer: Peer): Promise<boolean> {
    if (
      !(await this.world.hasTilePermission(
        peer.data.userID,
        this.data,
        LockPermission.BUILD,
      ))
    ) {
      this.onPlaceFail(peer);
      return false;
    }

    const door = this.getDoorData();
    const itemMeta = this.base.items.metadata.items.get(
      this.data.fg.toString(),
    )!;
    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon(
        `\`wEdit ${itemMeta.name}\`\``,
        itemMeta.id as number,
        "big",
      )
      .addInputBox("label", "Label", door.label, 100)
      .addInputBox("target", "Destination", door.destination, 24)
      .addSmallText("Leave Label blank to show the Destination name.")
      .addSmallText("Enter a Destination in this format: `2WORLDNAME:ID``")
      .addSmallText(
        "Leave `2WORLDNAME`` blank (:ID) to go to the door with `2ID`` in the `2Current World``.",
      )
      .addInputBox("id", "ID", door.id, 11)
      .addSmallText(
        "Set a unique `2ID`` to target this door as a Destination from another!",
      )
      .addCheckbox(
        "checkbox_public",
        "Open to public",
        this.data.flags & TileFlags.PUBLIC ? "selected" : "not_selected",
      )
      .embed("tilex", this.data.x)
      .embed("tiley", this.data.y)
      .embed("itemID", itemMeta.id)
      .endDialog("door_edit", "Cancel", "OK")
      .str();

    peer.send(Variant.from("OnDialogRequest", dialog));
    return true;
  }
}
