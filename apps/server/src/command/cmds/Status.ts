import { Command } from "../Command";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import {
  CharacterState,
  getRoleName,
  ModsEffects,
  ROLE,
} from "@growserver/const";
import { Variant } from "growtopia.js";
import { DialogBuilder } from "@growserver/utils";
import { inferItemEffects } from "../../items/ItemDetails";

function formatEffects(base: Base, peer: Peer): string {
  const effects = new Set<string>();
  const state = peer.data.state;

  if (state.isGhost) effects.add("Ghost");
  if (state.mod & CharacterState.DOUBLE_JUMP) effects.add("Double Jump");
  if (state.mod & CharacterState.WALK_IN_BLOCKS) effects.add("Walk In Blocks");
  if (state.modsEffect & ModsEffects.SPEEDY) effects.add("Speedy");
  if (state.modsEffect & ModsEffects.HIGH_JUMP) effects.add("High Jump");
  if (state.modsEffect & ModsEffects.SLOW_FALL) effects.add("Slow Fall");
  if (state.modsEffect & ModsEffects.PUNCH_DAMAGE) effects.add("Punch Damage");
  if (state.modsEffect & ModsEffects.HARVESTER) effects.add("Harvester");

  Object.values(peer.data.clothing).forEach((itemID) => {
    if (!itemID) return;

    const item = base.items.metadata.items.get(itemID.toString());
    const itemInfo = base.items.wiki.find((wikiItem) => wikiItem.id === itemID);
    inferItemEffects(item, itemInfo).forEach((effect) => effects.add(effect));
  });

  return effects.size ? [...effects].join(", ") : "None";
}

function formatSlotName(slot: string): string {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

function formatEquipment(base: Base, peer: Peer): string {
  const equipped = Object.entries(peer.data.clothing)
    .filter(([, itemID]) => !!itemID)
    .map(([slot, itemID]) => {
      const item = base.items.metadata.items.get(itemID.toString());
      return `${formatSlotName(slot)}: ${item?.name ?? itemID}`;
    });

  return equipped.length ? equipped.join(", ") : "None";
}

export default class Status extends Command {
  constructor(
    public base: Base,
    public peer: Peer,
    public text: string,
    public args: string[],
  ) {
    super(base, peer, text, args);
    this.opt = {
      command:     ["status"],
      description: "Show your current player status.",
      cooldown:    5,
      ratelimit:   1,
      category:    "`oBasic",
      usage:       "/status",
      example:     ["/status"],
      permission:  [ROLE.BASIC, ROLE.SUPPORTER, ROLE.DEVELOPER],
    };
  }

  public async execute(): Promise<void> {
    const world = this.peer.currentWorld();
    const inventory = this.peer.data.inventory;
    const usedSlots = inventory?.items?.length ?? 0;
    const maxSlots = inventory?.max ?? 0;
    const x = Math.floor((this.peer.data.x ?? 0) / 32);
    const y = Math.floor((this.peer.data.y ?? 0) / 32);
    const level = this.peer.data.level ?? 0;
    const exp = this.peer.data.exp ?? 0;
    const requiredExp = this.peer.calculateRequiredLevelXp(level);
    const lastVisited = this.peer.data.lastVisitedWorlds?.length
      ? [...this.peer.data.lastVisitedWorlds].reverse().join(", ")
      : "None";

    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon("`wStatus``", "32", "big")
      .addSpacer("small")
      .addPlayerInfo(this.peer.data.displayName, level, exp, requiredExp)
      .addSpacer("small")
      .addLabelWithIcon("`wPlayer``", "32", "small")
      .addSmallText(`Role: \`w${getRoleName(this.peer.data.role)}\`\``)
      .addSmallText(`GrowID: \`w${this.peer.data.name}\`\``)
      .addSmallText(`NetID: \`w${this.peer.data.netID}\`\``)
      .addSpacer("small")
      .addLabelWithIcon("`wWorld``", "6", "small")
      .addSmallText(`World: \`w${this.peer.data.world || "EXIT"}\`\``)
      .addSmallText(`Position: \`w${x}, ${y}\`\``)
      .addSmallText(`Players here: \`w${world?.data.playerCount ?? 0}\`\``)
      .addSpacer("small")
      .addLabelWithIcon("`wBackpack``", "112", "small")
      .addSmallText(`Backpack: \`w${usedSlots}/${maxSlots}\`\``)
      .addSmallText(`Gems: \`w${this.peer.data.gems ?? 0}\`\``)
      .addTextBox(`Equipped: \`w${formatEquipment(this.base, this.peer)}\`\``)
      .addSpacer("small")
      .addLabelWithIcon("`wEffects``", "18", "small")
      .addTextBox(`\`w${formatEffects(this.base, this.peer)}\`\``)
      .addSpacer("small")
      .addLabelWithIcon("`wRecent Worlds``", "6", "small")
      .addTextBox(`\`w${lastVisited}\`\``)
      .addQuickExit()
      .endDialog("status_end", "Close", "");

    this.peer.send(Variant.from("OnDialogRequest", dialog.str()));
  }
}
