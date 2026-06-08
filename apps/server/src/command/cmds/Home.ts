import { Variant } from "growtopia.js";
import { ROLE } from "@growserver/const";
import { Command } from "../Command";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";

export default class Home extends Command {
  constructor(
    public base: Base,
    public peer: Peer,
    public text: string,
    public args: string[],
  ) {
    super(base, peer, text, args);
    this.opt = {
      command:     ["home"],
      description: "Warp to your Home World.",
      cooldown:    5,
      ratelimit:   1,
      category:    "`oBasic",
      usage:       "/home",
      example:     ["/home"],
      permission:  [ROLE.BASIC, ROLE.SUPPORTER, ROLE.DEVELOPER],
    };
  }

  public async execute(): Promise<void> {
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
