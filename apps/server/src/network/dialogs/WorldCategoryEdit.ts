import { type NonEmptyObject } from "type-fest";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { World } from "../../core/World";
import { TileData } from "@growserver/types";
import { ROLE, WORLD_CATEGORIES } from "@growserver/const";
import { tileFrom } from "../../world/tiles";

export class WorldCategoryEdit {
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
      buttonClicked?: string;
    }>,
  ) {
    this.world = this.peer.currentWorld()!;
    this.pos =
      parseInt(this.action.tilex) +
      parseInt(this.action.tiley) * (this.world?.data.width as number);
    this.block = this.world?.data.blocks[this.pos] as TileData;
  }

  public async execute(): Promise<void> {
    const buttonClicked = this.action.buttonClicked;

    if (
      !this.action.dialog_name ||
      !this.action.tilex ||
      !this.action.tiley ||
      Number.isNaN(this.pos) ||
      !this.block?.lock ||
      !this.block.worldLockData ||
      !buttonClicked?.startsWith("category_")
    ) {
      return;
    }

    if (
      this.block.lock.ownerUserID !== this.peer.data.userID &&
      this.peer.data.role !== ROLE.DEVELOPER
    ) {
      return;
    }

    const categoryKey = buttonClicked.slice("category_".length);
    const category = WORLD_CATEGORIES.find(
      (worldCategory) => worldCategory.toLowerCase() === categoryKey,
    );

    if (!category) return;

    this.block.worldLockData.category = category;

    const tile = tileFrom(this.base, this.world, this.block);
    this.world.every((p) => tile.tileUpdate(p));
    await this.world.saveToCache();
    await this.world.saveToDatabase();

    this.peer.sendConsoleMessage(
      `\`2World category set to \`w${category}\`\`.`,
    );
  }
}
