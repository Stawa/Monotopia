import { type NonEmptyObject } from "type-fest";
import { Variant } from "growtopia.js";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import {
  ActionTypes,
  ITEM_ROYAL_LOCK,
  LockPermission,
  LOCKS,
  ROLE,
  TileFlags,
  WORLD_CATEGORIES,
} from "@growserver/const";
import { TileData } from "@growserver/types";
import { Floodfill } from "../../world/FloodFill";
import { World } from "../../core/World";
import { Tile } from "../../world/Tile";
import { ItemDefinition } from "grow-items";
import { tileFrom } from "../../world/tiles";
import { DialogBuilder } from "@growserver/utils";

export class AreaLockEdit {
  private world: World;
  private pos: number;
  private block: TileData;
  private itemMeta: ItemDefinition;

  constructor(
    public base: Base,
    public peer: Peer,
    public action: NonEmptyObject<{
      dialog_name: string;
      tilex: string;
      tiley: string;
      playerNetID: string;
      allow_break_build: string;
      ignore_empty: string;
      build_only: string;
      limit_admin: string;
      disable_music?: string;
      home_world?: string;
      invisible_music?: string;
      tempo?: string;
      minimum_level?: string;
      royal_silence?: string;
      royal_rainbows?: string;
      buttonClicked: string;
    }>,
  ) {
    this.world = this.peer.currentWorld()!;
    this.pos =
      parseInt(this.action.tilex) +
      parseInt(this.action.tiley) * (this.world?.data.width as number);
    this.block = this.world?.data.blocks[this.pos] as TileData;
    this.itemMeta = this.base.items.metadata.items.get(
      this.block.fg.toString(),
    )!;
  }

  public async execute(): Promise<void> {
    if (!this.block.lock || this.itemMeta?.type != ActionTypes.LOCK) return;
    const mLock = LOCKS.find((l) => l.id === this.block.fg);

    if (
      this.block.lock?.ownerUserID !== this.peer.data?.userID &&
      this.peer.data.role != ROLE.DEVELOPER
    )
      return;

    const openToPublic = this.action.allow_break_build === "1" ? true : false;
    const ignoreEmpty = this.action.ignore_empty === "1" ? true : false;
    const allowBuildOnly = this.action.build_only === "1" ? true : false;
    const adminLimitedAccess = this.action.limit_admin === "1" ? true : false;
    let homeWorldChanged = false;

    if (openToPublic) this.block.flags |= TileFlags.PUBLIC;
    else this.block.flags &= ~TileFlags.PUBLIC;

    this.block.lock.ignoreEmptyAir = ignoreEmpty;
    this.block.lock.permission = allowBuildOnly
      ? LockPermission.BUILD
      : (mLock?.defaultPermission ?? this.block.lock.permission);
    this.block.lock.adminLimited = adminLimitedAccess;

    if (this.block.worldLockData) {
      this.block.worldLockData.category ??= WORLD_CATEGORIES[0];
      this.block.worldLockData.timerMinutes ??= 0;
      this.block.worldLockData.customMusicBlocksDisabled =
        this.getCheckboxValue(
          this.action.disable_music,
          this.block.worldLockData.customMusicBlocksDisabled,
        );
      this.block.worldLockData.invisMusicBlocks = this.getCheckboxValue(
        this.action.invisible_music,
        this.block.worldLockData.invisMusicBlocks,
      );
      this.block.worldLockData.bpm = this.getClampedNumber(
        this.action.tempo,
        this.block.worldLockData.bpm,
        1,
        999,
      );
      this.block.worldLockData.minLevel = this.getClampedNumber(
        this.action.minimum_level,
        this.block.worldLockData.minLevel,
        1,
        125,
      );

      const homeWorldSelected = this.getCheckboxValue(
        this.action.home_world,
        this.peer.data.homeWorld === this.world.worldName,
      );

      if (
        homeWorldSelected &&
        this.peer.data.homeWorld !== this.world.worldName
      ) {
        this.peer.data.homeWorld = this.world.worldName;
        homeWorldChanged = true;
        this.peer.sendConsoleMessage(
          `\`2Home World set to \`w${this.world.worldName}\`\`.`,
        );
      } else if (
        !homeWorldSelected &&
        this.peer.data.homeWorld === this.world.worldName
      ) {
        this.peer.data.homeWorld = undefined;
        homeWorldChanged = true;
        this.peer.sendConsoleMessage("`oHome World cleared.");
      }

      if (this.block.fg === ITEM_ROYAL_LOCK) {
        this.block.worldLockData.royalSilence = this.getCheckboxValue(
          this.action.royal_silence,
          !!this.block.worldLockData.royalSilence,
        );
        this.block.worldLockData.royalRainbows = this.getCheckboxValue(
          this.action.royal_rainbows,
          !!this.block.worldLockData.royalRainbows,
        );
        this.block.worldLockData.royalRadar = true;
      }
    }

    if (this.action.buttonClicked === "reapply_lock" && mLock) {
      for (const ownedTiles of this.block.lock.ownedTiles) {
        this.world.data.blocks[ownedTiles].lockedBy = undefined;
      }

      this.block.lock.ownedTiles = [];
      const algo = new Floodfill({
        s_node: {
          x: parseInt(this.action.tilex),
          y: parseInt(this.action.tiley),
        },
        max:        mLock.maxTiles,
        width:      this.world.data.width,
        height:     this.world.data.height,
        blocks:     this.world.data.blocks,
        s_block:    this.block,
        base:       this.base,
        noEmptyAir: ignoreEmpty,
      });
      algo.exec();
      algo.apply(this.world, this.peer);

      this.world.every((p) =>
        p.sendOnPlayPositioned("audio/use_lock.wav", {
          netID: this.peer.data.netID,
        }),
      );
    } else if (this.action.playerNetID) {
      const targetPeer = this.world.getPeerByNetID(
        parseInt(this.action.playerNetID),
      );
      if (!targetPeer) {
        this.peer.sendTextBubble(
          "Oops, it looks like that player has already left the world.",
          false,
        );
        return;
      }

      if (targetPeer.data.userID == this.block.lock.ownerUserID) {
        this.peer.sendTextBubble("I already have access!", false);
        return;
      }

      if (this.block.lock.adminIDs?.includes(targetPeer.data.userID)) {
        this.peer.sendTextBubble(
          `${targetPeer.data.displayName} already has access to the lock.`,
          false,
        );
        return;
      }

      this.block.lock.adminIDs?.push(targetPeer.data.userID);
      this.peer.sendTextBubble(
        `Added ${targetPeer.data.displayName} access to lock`,
        false,
      );
      this.world.every((p) =>
        p.sendConsoleMessage(
          `${this.peer.data.displayName} added ${targetPeer.data.displayName} to a ${this.itemMeta.name}.`,
        ),
      );
      targetPeer.sendSFX("audio/secret.wav", 0);
    }

    for (const unaccessedPlayer of this.getUnaccessedPlayers()) {
      const playerData =
        await this.base.database.players.getByUID(unaccessedPlayer);
      if (!playerData) continue;

      const index = this.block.lock!.adminIDs!.indexOf(unaccessedPlayer);
      if (index == -1) continue;

      this.block.lock!.adminIDs?.splice(index, 1);

      this.world.every((p) => {
        p.sendConsoleMessage(
          `${playerData.name} was removed from a ${this.itemMeta.name}`,
        );
      });
    }

    const tile = tileFrom(this.base, this.world, this.block);
    this.world.every((p) => tile.tileUpdate(p));

    await this.world.saveToCache();
    await this.world.saveToDatabase();

    if (homeWorldChanged) {
      await this.peer.saveToCache();
      await this.peer.saveToDatabase();
    }

    if (this.block.worldLockData) {
      await this.world.refreshMusicBlockVisibility();
      this.world.refreshWorldTimers();
      if (this.block.fg === ITEM_ROYAL_LOCK) {
        this.world.refreshRoyalRainbowVisuals();
      }

      if (this.action.buttonClicked === "session_length") {
        this.sendWorldTimerDialog();
        return;
      }

      if (this.action.buttonClicked === "set_category") {
        this.sendWorldCategoryDialog();
      }
    }
  }

  // get the player that the owner just un-accessed
  // WARNING: This is kinda hackery
  private getUnaccessedPlayers(): number[] {
    const players = [];

    for (const key in this.action) {
      const prefixIndex = key.search(/^access_.*/);
      // need to disable this to access it like a "JSON" object
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (prefixIndex != -1 && (this.action as any)[key] == "0") {
        const userID = parseInt(key.substring(prefixIndex + "access_".length));
        if (
          this.block.lock?.adminIDs &&
          this.block.lock.adminIDs.includes(userID)
        ) {
          players.push(userID);
        }
      }
    }

    return players;
  }

  private getCheckboxValue(
    value: string | undefined,
    currentValue: boolean,
  ): boolean {
    if (value === undefined) return currentValue;

    return value === "1";
  }

  private getClampedNumber(
    value: string | undefined,
    currentValue: number,
    min: number,
    max: number,
  ): number {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed)) return currentValue;

    return Math.min(max, Math.max(min, parsed));
  }

  private sendWorldTimerDialog(): void {
    const timerMinutes = this.block.worldLockData?.timerMinutes ?? 0;
    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon("`wWorld Timer``", this.block.fg, "big")
      .addSmallText(
        "Visitors without World Lock access are kicked after this many minutes.",
      )
      .addSmallText("Set to 0 to disable the timer.")
      .addInputBox("timer_minutes", "Minutes:", timerMinutes, 4)
      .addButton("clear_timer", "`4Disable Timer``")
      .embed("tilex", this.block.x)
      .embed("tiley", this.block.y)
      .endDialog("world_timer_edit", "Cancel", "OK");

    this.peer.send(Variant.from("OnDialogRequest", dialog.str()));
  }

  private sendWorldCategoryDialog(): void {
    const currentCategory =
      this.block.worldLockData?.category ?? WORLD_CATEGORIES[0];
    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon("`wWorld Category``", this.block.fg, "big")
      .addSmallText("Pick the category that best describes this world.")
      .addSmallText(`Current category: \`w${currentCategory}\`\``)
      .embed("tilex", this.block.x)
      .embed("tiley", this.block.y);

    for (const category of WORLD_CATEGORIES) {
      const label =
        category === currentCategory ? `\`2${category}\`\`` : category;
      dialog.addButton(`category_${category.toLowerCase()}`, label);
    }

    dialog.endDialog("world_category_edit", "Cancel", "");

    this.peer.send(Variant.from("OnDialogRequest", dialog.str()));
  }
}
