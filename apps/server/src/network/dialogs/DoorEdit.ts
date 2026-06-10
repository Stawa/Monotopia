import { type NonEmptyObject } from "type-fest";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { TileData } from "@monotopia/types";
import { World } from "../../core/World";
import { tileFrom } from "../../world/tiles";
import { LockPermission, ROLE, TileFlags } from "@monotopia/const";

export class DoorEdit {
  private world: World;
  private pos: number;
  private block: TileData;

  constructor(
    public base: Base,
    public peer: Peer,
    public action: NonEmptyObject<{
      dialog_name: string;
      tilex: string;
      tiley: string;
      itemID: string;
      label?: string;
      target?: string;
      destination?: string;
      checkbox_public?: string;
      id?: string;
    }>,
  ) {
    this.world = this.peer.currentWorld()!;
    this.pos =
      parseInt(this.action.tilex) +
      parseInt(this.action.tiley) * (this.world?.data.width as number);
    this.block = this.world?.data.blocks[this.pos] as TileData;
  }

  public async execute(): Promise<void> {
    if (
      !this.action.dialog_name ||
      !this.action.tilex ||
      !this.action.tiley ||
      !this.action.itemID ||
      Number.isNaN(this.pos) ||
      !this.block
    )
      return;
    if (
      this.peer.data.role !== ROLE.DEVELOPER &&
      !(await this.world.hasTilePermission(
        this.peer.data.userID,
        this.block,
        LockPermission.BUILD,
      ))
    ) {
      return;
    }

    if (
      !this.block.door ||
      this.block.fg !== Number.parseInt(this.action.itemID, 10)
    ) {
      return;
    }

    const label = (this.action.label ?? "").trim().slice(0, 100);
    const destination = (this.action.target ?? this.action.destination ?? "")
      .trim()
      .toUpperCase()
      .slice(0, 24);
    const id = (this.action.id ?? "").trim().toUpperCase().slice(0, 11);

    this.block.flags |= TileFlags.TILEEXTRA;
    this.block.door = {
      label,
      destination,
      id,
    };

    if (this.isChecked(this.action.checkbox_public)) {
      this.block.flags |= TileFlags.PUBLIC;
    } else {
      this.block.flags &= ~TileFlags.PUBLIC; // unset PUBLIC flag
    }

    const doorTile = tileFrom(this.base, this.world, this.block);
    this.world.every((p) => doorTile.tileUpdate(p));
    await this.world.saveToCache();
    await this.world.saveToDatabase();
  }

  private isChecked(value?: string): boolean {
    if (value === undefined) return false;

    switch (value.trim().toLowerCase()) {
      case "1":
      case "true":
      case "selected":
      case "on":
      case "yes":
        return true;

      default:
        return false;
    }
  }
}
