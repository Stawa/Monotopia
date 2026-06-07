import { Command } from "../Command";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { ROLE } from "@growserver/const";
import { Variant } from "growtopia.js";
import { DialogBuilder } from "@growserver/utils";

export default class Search extends Command {
  constructor(
    public base: Base,
    public peer: Peer,
    public text: string,
    public args: string[],
  ) {
    super(base, peer, text, args);
    this.opt = {
      command:     ["search"],
      description: "Search items and add them to your inventory.",
      cooldown:    5,
      ratelimit:   5,
      category:    "`bDev",
      usage:       "/search [item name or id]",
      example:     ["/search dirt", "/search 242"],
      permission:  [ROLE.DEVELOPER],
    };
  }

  public async execute(): Promise<void> {
    const query = this.args.join(" ").slice(0, 40);
    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon("`wDeveloper Item Search``", 32, "big")
      .addSmallText("Search by item name or ID, then click an item to add it.")
      .addInputBox("n", "Search:", query, 40)
      .addInputBox("amount", "Amount:", 200, 3)
      .addCheckbox("show_seeds", "Show seeds too", "not_selected")
      .addButton("search_items", "`2Search``")
      .addSpacer("small")
      .endDialog("search_item", "Close", "")
      .str();

    this.peer.send(Variant.from("OnDialogRequest", dialog));
  }
}
