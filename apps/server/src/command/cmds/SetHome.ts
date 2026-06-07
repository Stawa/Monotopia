import { Variant } from "growtopia.js";
import { ROLE } from "@growserver/const";
import { Command } from "../Command";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";

export default class SetHome extends Command {
  constructor(
    public base: Base,
    public peer: Peer,
    public text: string,
    public args: string[],
  ) {
    super(base, peer, text, args);
    this.opt = {
      command:     ["sethome"],
      description: "Set the current World-Locked world as your Home World.",
      cooldown:    5,
      ratelimit:   1,
      category:    "`oBasic",
      usage:       "/sethome",
      example:     ["/sethome"],
      permission:  [ROLE.BASIC, ROLE.SUPPORTER, ROLE.DEVELOPER],
    };
  }

  public async execute(): Promise<void> {
    const world = this.peer.currentWorld();

    if (!world || this.peer.data.world === "EXIT") {
      this.peer.send(
        Variant.from("OnConsoleMessage", "`4You need to be in a world first."),
      );
      return;
    }

    await world.getData();

    if (!world.hasWorldLockAccess(this.peer.data.userID)) {
      this.peer.send(
        Variant.from(
          "OnConsoleMessage",
          "`4You need World Lock access here to set this as your Home World.",
        ),
      );
      return;
    }

    this.peer.data.homeWorld = world.worldName;
    await this.peer.saveToCache();
    await this.peer.saveToDatabase();

    this.peer.send(
      Variant.from(
        "OnConsoleMessage",
        `\`2Home World set to \`w${world.worldName}\`\`.`,
      ),
    );
  }
}
