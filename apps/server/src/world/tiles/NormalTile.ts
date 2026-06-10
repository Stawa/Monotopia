import type { Base } from "../../core/Base";
import type { World } from "../../core/World";
import type { TileData } from "@monotopia/types";
import { TileFlags } from "@monotopia/const";
import { Tile } from "../Tile";

export class NormalTile extends Tile {
  constructor(
    public base: Base,
    public world: World,
    public block: TileData,
  ) {
    super(base, world, block);
  }

  public async setFlags(flags: number): Promise<number> {
    flags = await super.setFlags(flags);

    return flags & ~TileFlags.TILEEXTRA;
  }
}
