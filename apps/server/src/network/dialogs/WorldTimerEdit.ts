import { type NonEmptyObject } from "type-fest";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { World } from "../../core/World";
import { TileData } from "@growserver/types";
import { ROLE } from "@growserver/const";
import { tileFrom } from "../../world/tiles";

const MAX_WORLD_TIMER_MINUTES = 1440;

export class WorldTimerEdit {
  private world: World;
  private pos: number;
  private block: TileData;

  constructor(
    public base: Base,
    public peer: Peer,
    public action: NonEmptyObject<{
      dialog_name: string;
      tilex: string;
      tiley: string;
      timer_minutes?: string;
      buttonClicked?: string;
    }>,
  ) {
    this.world = this.peer.currentWorld()!;
    this.pos =
      parseInt(this.action.tilex) +
      parseInt(this.action.tiley) * (this.world?.data.width as number);
    this.block = this.world?.data.blocks[this.pos] as TileData;
  }

  public async execute(): Promise<void> {
    if (
      !this.action.dialog_name ||
      !this.action.tilex ||
      !this.action.tiley ||
      Number.isNaN(this.pos) ||
      !this.block?.lock ||
      !this.block.worldLockData
    ) {
      return;
    }

    if (
      this.block.lock.ownerUserID !== this.peer.data.userID &&
      this.peer.data.role !== ROLE.DEVELOPER
    ) {
      return;
    }

    const timerMinutes =
      this.action.buttonClicked === "clear_timer"
        ? 0
        : this.getClampedNumber(
          this.action.timer_minutes,
          this.block.worldLockData.timerMinutes ?? 0,
          0,
          MAX_WORLD_TIMER_MINUTES,
        );

    this.block.worldLockData.timerMinutes = timerMinutes;

    const tile = tileFrom(this.base, this.world, this.block);
    this.world.every((p) => tile.tileUpdate(p));
    await this.world.saveToCache();
    await this.world.saveToDatabase();
    this.world.refreshWorldTimers();

    this.peer.sendConsoleMessage(
      timerMinutes > 0
        ? `\`2World Timer set to \`w${timerMinutes}\`\` minutes.`
        : "`oWorld Timer disabled.",
    );
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
}
