import { type NonEmptyObject } from "type-fest";
import { Variant } from "growtopia.js";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";

export class GoHomeWorld {
  constructor(
    public base: Base,
    public peer: Peer,
  ) {}

  public async execute(
    _action: NonEmptyObject<Record<string, string>>,
  ): Promise<void> {
    const homeWorld = this.peer.data.homeWorld;

    if (!homeWorld) {
      this.peer.send(
        Variant.from(
          "OnConsoleMessage",
          "`oYou don't have a Home World set yet.",
        ),
      );
      return;
    }

    if (this.peer.data.world === homeWorld) {
      this.peer.send(
        Variant.from(
          "OnConsoleMessage",
          "`oYou're already in your Home World.",
        ),
      );
      return;
    }

    this.peer.send(
      Variant.from(
        "OnConsoleMessage",
        `Warping home to \`2${homeWorld}\`\`...`,
      ),
    );

    if (this.peer.data.world !== "EXIT") {
      this.peer.leaveWorld(false);
    }

    setTimeout(() => {
      void this.peer.enterWorld(homeWorld);
    }, 200);
  }
}
