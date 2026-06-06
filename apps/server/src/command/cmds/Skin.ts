import { Command } from "../Command";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { DEFAULT_SKIN_COLOR } from "@growserver/const";
import { Variant } from "growtopia.js";

function parseSkinColor(value: string): number | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  if (["default", "reset"].includes(raw.toLowerCase())) {
    return DEFAULT_SKIN_COLOR;
  }

  const hex = raw.replace(/^#/, "").replace(/^0x/i, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return parseInt(`${hex}ff`, 16) >>> 0;
  if (/^[0-9a-f]{8}$/i.test(hex)) return parseInt(hex, 16) >>> 0;

  const decimal = Number(raw);
  if (Number.isFinite(decimal) && decimal >= 0 && decimal <= 0xffffffff) {
    return decimal >>> 0;
  }

  return undefined;
}

export default class Skin extends Command {
  constructor(
    public base: Base,
    public peer: Peer,
    public text: string,
    public args: string[],
  ) {
    super(base, peer, text, args);
    this.opt = {
      command:     ["skin", "setskin"],
      description: "Change your skin color.",
      cooldown:    1,
      ratelimit:   1,
      category:    "`oBasic",
      usage:       "/skin <hex|decimal|reset>",
      example:     ["/skin #ffccaa", "/skin 0x8295c3ff", "/skin reset"],
      permission:  [],
    };
  }

  public async execute(): Promise<void> {
    const color = parseSkinColor(this.args[0] ?? "");
    if (color === undefined) {
      this.peer.send(
        Variant.from(
          "OnConsoleMessage",
          "`4Usage: /skin <hex|decimal|reset>``",
        ),
      );
      return;
    }

    this.peer.setSkin(color);
    this.peer.send(
      Variant.from(
        "OnConsoleMessage",
        `\`2Skin color changed to \`o0x${color.toString(16).padStart(8, "0")}\`2.\`\``,
      ),
    );
  }
}
