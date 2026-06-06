import logger from "@growserver/logger";
import { DialogBuilder } from "@growserver/utils";
import { Variant } from "growtopia.js";
import { type NonEmptyObject } from "type-fest";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { getItemDetails, hasItemDetails } from "../../items/ItemDetails";

export class Info {
  constructor(
    public base: Base,
    public peer: Peer,
  ) {}

  public async execute(
    action: NonEmptyObject<Record<string, string>>,
  ): Promise<void> {
    const id = Number.parseInt(action.itemID, 10);
    if (!Number.isFinite(id)) return this.sendMessage("Invalid item ID.");
    if (!hasItemDetails(this.base, id)) return this.sendMessage("Item not found.");

    const details = getItemDetails(this.base, id);

    const dlg = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon(`\`wAbout ${details.name} (${details.id})\`\``, id, "big")
      .addSpacer("small")
      .addTextBox(details.description)
      .addSpacer("small")
      .addLabelWithIcon("`wDetails``", id, "small")
      .addSmallText(`Rarity: \`w${details.rarity}\`\``)
      .addSmallText(`Type: \`w${details.type}\`\``)
      .addSmallText(`Max stack: \`w${details.maxAmount}\`\``)
      .addSmallText(`Flags: \`w${details.flags}\`\``);

    if (details.playMods.length) {
      dlg.addSmallText(`Effects: \`w${details.playMods.join(", ")}\`\``);
    }

    if (details.growTime > 0) {
      dlg.addSmallText(`Grow time: \`w${details.growTime} seconds\`\``);
    }

    if (details.breakHits > 0) {
      dlg.addSmallText(`Break hits: \`w${details.breakHits}\`\``);
    }

    if (details.recipe) {
      dlg
        .addSpacer("small")
        .addLabelWithIcon("`wRecipe``", id, "small")
        .addSmallText(`Splice: \`w${details.recipe}\`\``);
    } else {
      dlg.addSmallText("`oThis item cannot be spliced.");
    }

    if (details.permanent) {
      dlg
        .addSpacer("small")
        .addSmallText(
          "`3This item can't be destroyed - smashing it will return it to your backpack if you have room!",
        );
    }

    this.peer.send(
      Variant.from("OnDialogRequest", dlg.endDialog("info_end", "Close", "OK").str()),
    );
    logger.debug?.(`Sent item info for ${details.name} (${details.id})`);
  }

  private sendMessage(msg: string) {
    this.peer.send(Variant.from("OnTextOverlay", msg));
  }
}

export { Info as InfoCommand };
