import { type NonEmptyObject } from "type-fest";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { TileData } from "@monotopia/types";
import { World } from "../../core/World";
import { tileFrom } from "../../world/tiles";
import { LockPermission, ROLE, TileFlags } from "@monotopia/const";

export class GatewayEdit {
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
      itemID?: string;
      checkbox_public?: string;
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
      Number.isNaN(this.pos) ||
      !this.block
    ) {
      return;
    }

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
      this.action.itemID !== undefined &&
      this.block.fg !== Number.parseInt(this.action.itemID, 10)
    ) {
      return;
    }

    const openToPublic = this.isChecked(this.action.checkbox_public);

    this.block.entrace = undefined;
    this.block.flags &= ~(TileFlags.TILEEXTRA | TileFlags.OPEN);

    if (openToPublic) {
      this.block.flags |= TileFlags.PUBLIC;
    } else {
      this.block.flags &= ~TileFlags.PUBLIC;
    }

    const gatewayTile = tileFrom(this.base, this.world, this.block);
    this.world.every((p) => gatewayTile.tileUpdate(p));
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
