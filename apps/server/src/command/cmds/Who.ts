import { Command } from "../Command";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { ROLE } from "@growserver/const";
import { Variant } from "growtopia.js";

export default class Who extends Command {
  constructor(
    public base: Base,
    public peer: Peer,
    public text: string,
    public args: string[],
  ) {
    super(base, peer, text, args);
    this.opt = {
      command:     ["who"],
      description: "List players in your current world.",
      cooldown:    5,
      ratelimit:   1,
      category:    "`oBasic",
      usage:       "/who",
      example:     ["/who"],
      permission:  [ROLE.BASIC, ROLE.SUPPORTER, ROLE.DEVELOPER],
    };
  }

  public async execute(): Promise<void> {
    const world = this.peer.currentWorld();
    if (!world) {
      this.peer.send(
        Variant.from("OnConsoleMessage", "`4You are not in a world right now."),
      );
      return;
    }

    const players: Peer[] = [];
    await world.every((player) => {
      players.push(player);
    });

    players.sort((a, b) =>
      (a.data.displayName || a.data.name).localeCompare(
        b.data.displayName || b.data.name,
      ),
    );

    this.peer.send(
      Variant.from(
        "OnConsoleMessage",
        `\`w${players.length}\`\` players currently in \`w${world.data.name}\`\`.`,
      ),
    );

    players.forEach((player) => {
      this.peer.send(
        Variant.from(
          "OnTalkBubble",
          player.data.netID,
          player.data.displayName || player.data.name,
          0,
          1,
        ),
      );
    });
  }
}
