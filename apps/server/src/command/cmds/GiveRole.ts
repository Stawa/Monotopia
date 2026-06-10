import { Command } from "../Command";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { getRoleName, parseRole, ROLE } from "@monotopia/const";
import { Variant } from "growtopia.js";
import {
  formatToDisplayName,
  parseUserTarget,
  stripDisplayName,
} from "@monotopia/utils";
import { eq } from "drizzle-orm";
import { players, Players } from "@monotopia/db";

export default class GiveRole extends Command {
  constructor(
    public base: Base,
    public peer: Peer,
    public text: string,
    public args: string[],
  ) {
    super(base, peer, text, args);
    this.opt = {
      command: ["giverole"],
      description:
        "Change a user's role. Use /username for exact name or #id for user ID.",
      cooldown:   5,
      ratelimit:  1,
      category:   "`oBasic",
      usage:      "/giverole <target> <role>",
      example:    ["/giverole /testuser1 regular", "/giverole #172 mod"],
      permission: [ROLE.DEVELOPER],
    };
  }

  public async execute(): Promise<void> {
    if (this.args.length < 2) {
      this.peer.send(
        Variant.from(
          "OnConsoleMessage",
          "`4Usage: /giverole <target> <role>`o\n" +
            "Target can be:\n" +
            "  `/username` - Find user by exact username\n" +
            "  `#id` - Find user by user ID\n" +
            "Roles:\n" +
            "  `oregular` / `o2` - Regular User\n" +
            "  `osupporter` / `o3` - Supporter\n" +
            "  `omod` / `o4` - Moderator\n" +
            "  `odeveloper` / `o1` - Developer\n" +
            "Example: `/giverole /testuser1 regular` or `/giverole #172 mod`",
        ),
      );
      return;
    }

    const targetArg = this.args[0];
    const newRole = parseRole(this.args[1]);

    if (!newRole) {
      this.peer.send(
        Variant.from(
          "OnConsoleMessage",
          "`4Invalid role. Use regular, supporter, mod, developer, or original role values 1-4.``",
        ),
      );
      return;
    }

    const roleName = getRoleName(newRole);
    const parsedTarget = parseUserTarget(targetArg);
    if (!parsedTarget) {
      this.peer.send(
        Variant.from(
          "OnConsoleMessage",
          "`4Invalid target format. Use `/username` or `#id`.``",
        ),
      );
      return;
    }

    let targetPeer: Peer | undefined;
    let targetData: Players | undefined;

    if (parsedTarget.type === "name") {
      const targetName = stripDisplayName(parsedTarget.value as string);
      const targetPeerData = this.base.cache.peers.find(
        (p) =>
          p.name.toLowerCase() === targetName.toLowerCase() ||
          stripDisplayName(p.displayName ?? "").toLowerCase() ===
            targetName.toLowerCase(),
      );

      if (targetPeerData) {
        targetPeer = new Peer(this.base, targetPeerData.netID);
      } else {
        targetData = await this.base.database.players.get(targetName);
        if (!targetData) {
          this.peer.send(
            Variant.from(
              "OnConsoleMessage",
              "`4User with name `o" + targetName + "`4 not found.``",
            ),
          );
          return;
        }
      }
    } else if (parsedTarget.type === "id") {
      const targetPeerData = this.base.cache.peers.find(
        (p) => p.userID === parsedTarget.value,
      );

      if (targetPeerData) {
        targetPeer = new Peer(this.base, targetPeerData.netID);
      } else {
        targetData = await this.base.database.players.getByUID(
          parsedTarget.value as number,
        );
        if (!targetData) {
          this.peer.send(
            Variant.from(
              "OnConsoleMessage",
              "`4User with ID `o" + parsedTarget.value + "`4 not found.``",
            ),
          );
          return;
        }
      }
    }

    if (targetPeer) {
      targetPeer.data.role = newRole;
      const targetName =
        stripDisplayName(targetPeer.data.displayName ?? targetPeer.data.name) ||
        targetPeer.data.name;
      await targetPeer.updateDisplayName(
        formatToDisplayName(targetName, newRole),
      );

      const currentWorld = targetPeer.currentWorld();
      if (currentWorld) {
        await currentWorld.every((p) => {
          p.send(
            Variant.from(
              { netID: targetPeer.data.netID },
              "OnNameChanged",
              targetPeer.data.displayName,
            ),
          );
        });
      }

      this.peer.send(
        Variant.from(
          "OnConsoleMessage",
          "`2Successfully changed role of `o" +
            targetPeer.data.name +
            "`2 to `o" +
            roleName +
            "`2.``",
        ),
      );

      targetPeer.send(
        Variant.from(
          "OnConsoleMessage",
          "`2Your role has been changed to `o" +
            roleName +
            "`2 by an administrator!``",
        ),
      );
    } else if (targetData) {
      const targetName =
        stripDisplayName(targetData.display_name ?? targetData.name) ||
        targetData.name;

      await this.base.database.db
        .update(players)
        .set({
          role:         newRole,
          display_name: formatToDisplayName(targetName, newRole),
        })
        .where(eq(players.id, targetData.id));

      this.peer.send(
        Variant.from(
          "OnConsoleMessage",
          "`2Successfully changed role of `o" +
            targetData.name +
            "`2 to `o" +
            roleName +
            "`2 (offline).``",
        ),
      );
    }
  }
}
