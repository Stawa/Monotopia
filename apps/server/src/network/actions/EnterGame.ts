import { Variant } from "growtopia.js";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { DialogBuilder } from "@monotopia/utils";
import { APP_NAME } from "@monotopia/const";
import { type NonEmptyObject } from "type-fest";
import { World } from "../../core/World";
import { tileFrom, tileUpdateMultiple } from "../../world/tiles";
import { HeartMonitorTile } from "../../world/tiles/HeartMonitorTile";
import { buildWorldSelectMenu } from "../../core/WorldSelectMenu";

export class EnterGame {
  constructor(
    public base: Base,
    public peer: Peer,
  ) {}

  public async execute(
    _action: NonEmptyObject<Record<string, string>>,
  ): Promise<void> {
    const tes = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon(`\`wThe ${APP_NAME} Gazette\`\``, "5016", "big")
      .addSpacer("small")
      .raw(
        "add_image_button||interface/banner-transparent.rttex|bannerlayout|||\n",
      )
      .addTextBox(`Welcome to ${APP_NAME}`)
      .addQuickExit()
      .endDialog("gazzette_end", "Cancel", "Ok")
      .str();
    this.peer.send(
      Variant.from(
        "OnRequestWorldSelectMenu",
        buildWorldSelectMenu(this.base, this.peer),
      ),
      Variant.from(
        "OnConsoleMessage",
        `Welcome ${this.peer.data.displayName}\`\` There are \`w${this.base.getPlayersOnline()}\`\` players online.`,
      ),
      Variant.from({ delay: 100 }, "OnDialogRequest", tes),
    );

    this.peer.data.heartMonitors.forEach((indexes, worldName) => {
      const tiles = new Array<HeartMonitorTile>();
      const worldData = this.base.cache.worlds.get(worldName);

      if (!worldData || worldData.playerCount == 0) return;

      const world = new World(this.base, worldName);

      for (const index of indexes) {
        const heartMonitorTile = tileFrom(
          this.base,
          world,
          worldData.blocks[index],
        );

        tiles.push(heartMonitorTile as HeartMonitorTile);
      }

      tileUpdateMultiple(world, tiles);
    });
  }
}
