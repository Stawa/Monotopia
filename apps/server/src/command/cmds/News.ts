import { Command } from "../Command";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { ROLE } from "@monotopia/const";
import { Variant } from "growtopia.js";
import { DialogBuilder } from "@monotopia/utils";

export default class News extends Command {
  constructor(
    public base: Base,
    public peer: Peer,
    public text: string,
    public args: string[],
  ) {
    super(base, peer, text, args);
    this.opt = {
      command:     ["news"],
      description: "Show current server news.",
      cooldown:    5,
      ratelimit:   1,
      category:    "`oBasic",
      usage:       "/news",
      example:     ["/news"],
      permission:  [ROLE.BASIC, ROLE.SUPPORTER, ROLE.DEVELOPER],
    };
  }

  public async execute(): Promise<void> {
    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon("`wMonotopia News``", "5016", "big")
      .addSpacer("small")
      .raw(
        "add_image_button||interface/banner-transparent.rttex|bannerlayout|||\n",
      )
      .addTextBox("Welcome to Monotopia.")
      .addSmallText("`2New commands: `w/status, /stats, /who, /news``")
      .addSmallText(
        "`2Item effects: `wMore wearable effects now use wiki-backed data.``",
      )
      .addSmallText(
        "`2Tip: `wUse /help to see commands available to your role.``",
      )
      .addSmallText(
        `Online now: \`w${this.base.getPlayersOnline()}\`\` players.`,
      )
      .addQuickExit()
      .endDialog("news_end", "Close", "");

    this.peer.send(Variant.from("OnDialogRequest", dialog.str()));
  }
}
