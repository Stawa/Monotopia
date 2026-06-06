import { Command } from "../Command";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { ROLE } from "@growserver/const";
import { Variant } from "growtopia.js";
import { DialogBuilder } from "@growserver/utils";

function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatWorldList(
  worlds: Array<{ name: string; playerCount?: number }>,
): string {
  if (!worlds.length) return "None";

  return worlds
    .slice(0, 5)
    .map((world) => `${world.name} (${world.playerCount ?? 0})`)
    .join(", ");
}

export default class Stats extends Command {
  constructor(
    public base: Base,
    public peer: Peer,
    public text: string,
    public args: string[],
  ) {
    super(base, peer, text, args);
    this.opt = {
      command:     ["stats"],
      description: "Show server stats.",
      cooldown:    5,
      ratelimit:   1,
      category:    "`oBasic",
      usage:       "/stats",
      example:     ["/stats"],
      permission:  [ROLE.BASIC, ROLE.SUPPORTER, ROLE.DEVELOPER],
    };
  }

  public async execute(): Promise<void> {
    const worlds = Array.from(this.base.cache.worlds.values());
    const activeWorlds = worlds
      .filter((world) => (world.playerCount ?? 0) > 0)
      .sort((a, b) => (b.playerCount ?? 0) - (a.playerCount ?? 0));
    const memory = process.memoryUsage();
    const itemCount =
      this.base.items.metadata.itemCount ??
      this.base.items.metadata.items?.size ??
      0;

    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon("`wServer Stats``", "32", "big")
      .addSpacer("small")
      .addTextBox(
        `\`w${this.base.getPlayersOnline()}\`\` players online across ` +
          `\`w${activeWorlds.length}\`\` active worlds.`,
      )
      .addSpacer("small")
      .addLabelWithIcon("`wRuntime``", "32", "small")
      .addSmallText(`Server version: \`w${this.base.package.version}\`\``)
      .addSmallText(`Growtopia version: \`w${this.base.cdn.version || "Unknown"}\`\``)
      .addSmallText(`Node.js: \`w${process.version}\`\``)
      .addSmallText(`Uptime: \`w${formatDuration(process.uptime())}\`\``)
      .addSpacer("small")
      .addLabelWithIcon("`wWorlds & Players``", "6", "small")
      .addSmallText(`Online players: \`w${this.base.getPlayersOnline()}\`\``)
      .addSmallText(`Cached players: \`w${this.base.cache.peers.size}\`\``)
      .addSmallText(`Cached worlds: \`w${worlds.length}\`\``)
      .addSmallText(`Active worlds: \`w${activeWorlds.length}\`\``)
      .addTextBox(`Top worlds: \`w${formatWorldList(activeWorlds)}\`\``)
      .addSpacer("small")
      .addLabelWithIcon("`wData``", "112", "small")
      .addSmallText(`Items loaded: \`w${itemCount}\`\``)
      .addSmallText(`Items.dat: \`w${this.base.cdn.itemsDatName || "Unknown"}\`\``)
      .addSpacer("small")
      .addLabelWithIcon("`wMemory``", "112", "small")
      .addSmallText(`RSS: \`w${formatBytes(memory.rss)}\`\``)
      .addSmallText(`Heap used: \`w${formatBytes(memory.heapUsed)}\`\``)
      .addSmallText(`Heap total: \`w${formatBytes(memory.heapTotal)}\`\``)
      .addQuickExit()
      .endDialog("stats_end", "Close", "");

    this.peer.send(Variant.from("OnDialogRequest", dialog.str()));
  }
}
