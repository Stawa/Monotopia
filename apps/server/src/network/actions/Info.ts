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
    if (!hasItemDetails(this.base, id))
      return this.sendMessage("Item not found.");

    const details = getItemDetails(this.base, id);

    const dlg = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon(
        `\`wAbout ${this.cleanDialogText(details.name)}\`\``,
        id,
        "big",
      )
      .addSpacer("small")
      .addTextBox(details.description);

    if (this.hasRarity(details)) {
      dlg
        .addSpacer("small")
        .addSmallText(`Rarity: \`w${details.rarityText}\`\``);
    }

    if (details.playMods.length) {
      dlg.addTextBox(`This item has effects: ${details.playMods.join(", ")}.`);
    }

    if (details.growTime > 0) {
      dlg.addTextBox(`This item grows in ${details.growTimeText}.`);
    }

    if (details.recipe) {
      dlg.addTextBox(`Splice: ${details.recipe}`);
    } else {
      dlg.addTextBox(this.infoLine("This item can't be spliced."));
    }

    for (const message of this.getImportantMessages(details)) {
      dlg.addTextBox(this.infoLine(message));
    }

    this.peer.send(
      Variant.from(
        "OnDialogRequest",
        dlg.endDialog("info_end", "Close", "OK").str(),
      ),
    );
    logger.debug?.(`Sent item info for ${details.name} (${details.id})`);
  }

  private sendMessage(msg: string) {
    this.peer.send(Variant.from("OnTextOverlay", msg));
  }

  private cleanDialogText(value?: string): string {
    return (value ?? "")
      .replace(/\|/g, "/")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 60);
  }

  private hasRarity(details: ReturnType<typeof getItemDetails>): boolean {
    return details.rarity > 0 && details.rarityText !== "N/A";
  }

  private infoLine(message: string): string {
    return `\`3${message}\`\``;
  }

  private getImportantMessages(details: ReturnType<typeof getItemDetails>) {
    const messages: string[] = [];

    if (details.flags.includes("Seedless")) {
      messages.push("This item never drops any seeds.");
    }
    if (details.permanent) {
      messages.push(
        "This item can't be destroyed - smashing it will return it to your backpack if you have room!",
      );
    }
    if (details.flags.includes("Multi Facing")) {
      messages.push(
        "This item can be placed in two directions, depending on your facing.",
      );
    }
    if (details.tradeStatus === "Untradeable") {
      messages.push("This item can't be dropped or traded.");
    }
    if (details.placementInfo.includes("World Locked")) {
      messages.push("This item can only be used in World Locked worlds.");
    }

    return messages;
  }
}

export { Info as InfoCommand };
