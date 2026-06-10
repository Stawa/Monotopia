import { TankPacket, Variant } from "growtopia.js";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { World } from "../../core/World";
import { TileData } from "@monotopia/types";
import { ActionTypes, ITEM_RAINBOW_SHOES } from "@monotopia/const";

const ROYAL_RAINBOW_REFRESH_MS = 1000;
const ROYAL_RADAR_COOLDOWN_MS = 5000;
const VIEWPORT_HALF_WIDTH = 15 * 32;
const VIEWPORT_HALF_HEIGHT = 10 * 32;

export class State {
  private pos: number;
  private block: TileData;

  constructor(
    public base: Base,
    public peer: Peer,
    public tank: TankPacket,
    public world: World,
  ) {
    this.pos =
      (this.tank.data?.xPunch as number) +
      (this.tank.data?.yPunch as number) * this.world.data.width;
    this.block = this.world.data.blocks[this.pos];
  }

  public async execute() {
    if (this.peer.data.world === "EXIT") return;
    this.tank.data!.netID = this.peer.data.netID;

    this.peer.data.x = this.tank.data?.xPos;
    this.peer.data.y = this.tank.data?.yPos;
    this.peer.data.rotatedLeft = Boolean(
      (this.tank.data?.state as number) & 0x10,
    );

    this.peer.saveToCache();

    const world = this.peer.currentWorld();
    if (world) {
      world.every((p) => {
        if (p.data.netID !== this.peer.data.netID) p.send(this.tank);
      });

      this.handleRoyalLockMovement(world);
    }

    await this.onPlayerMove();
  }

  private async onPlayerMove() {
    if (
      (this.tank.data?.xPunch as number) > 0 ||
      (this.tank.data?.yPunch as number) > 0
    )
      return;
    if (this.block === undefined) return;

    const itemMeta = this.base.items.metadata.items.get(
      (this.block.fg || this.block.bg).toString(),
    )!;

    switch (itemMeta.type) {
      case ActionTypes.CHECKPOINT: {
        this.peer.send(
          Variant.from(
            { netID: this.peer.data.netID, delay: 0 },
            "SetRespawnPos",
            this.pos,
          ),
        );
        this.peer.data.lastCheckpoint = {
          x: Math.round((this.tank.data?.xPos as number) / 32),
          y: Math.round((this.tank.data?.yPos as number) / 32),
        };
        break;
      }

      case ActionTypes.FOREGROUND: {
        if (itemMeta.id === 3496 || itemMeta.id === 3270) {
          // Steam testing
        }
        break;
      }
    }
  }

  private handleRoyalLockMovement(world: World): void {
    if (
      world.isRoyalRainbowsEnabled() &&
      world.hasWorldLockAccess(this.peer.data.userID)
    ) {
      this.sendRoyalRainbowTrail();
    }

    if (world.isRoyalRadarEnabled()) {
      this.sendRoyalRadar(world);
    }
  }

  private sendRoyalRainbowTrail(): void {
    const key = `royal-rainbow-${this.peer.data.netID}`;
    const now = Date.now();
    const cooldown = this.base.cache.cooldown.get(key);

    if (cooldown && cooldown.time + ROYAL_RAINBOW_REFRESH_MS > now) return;

    this.base.cache.cooldown.set(key, { limit: 1, time: now });
    setTimeout(
      () => this.base.cache.cooldown.delete(key),
      ROYAL_RAINBOW_REFRESH_MS,
    );

    this.peer.sendClothes({ feet: ITEM_RAINBOW_SHOES });
  }

  private sendRoyalRadar(world: World): void {
    world.every((viewer) => {
      if (viewer.data.netID === this.peer.data.netID) return;
      if (!world.hasWorldLockAccess(viewer.data.userID)) return;
      if (!this.isOutOfView(viewer, this.peer)) return;

      const key =
        `royal-radar-${world.worldName}-${viewer.data.netID}-` +
        this.peer.data.netID;
      const now = Date.now();
      const cooldown = this.base.cache.cooldown.get(key);

      if (cooldown && cooldown.time + ROYAL_RADAR_COOLDOWN_MS > now) return;

      this.base.cache.cooldown.set(key, { limit: 1, time: now });
      setTimeout(
        () => this.base.cache.cooldown.delete(key),
        ROYAL_RADAR_COOLDOWN_MS,
      );
      viewer.send(
        Variant.from(
          "OnConsoleMessage",
          `\`2Peasant Radar:\`\` ${this.peer.data.displayName} is ` +
            `${this.getDirection(viewer, this.peer)}.`,
        ),
      );
    });
  }

  private isOutOfView(viewer: Peer, target: Peer): boolean {
    return (
      Math.abs((viewer.data.x ?? 0) - (target.data.x ?? 0)) >
        VIEWPORT_HALF_WIDTH ||
      Math.abs((viewer.data.y ?? 0) - (target.data.y ?? 0)) >
        VIEWPORT_HALF_HEIGHT
    );
  }

  private getDirection(viewer: Peer, target: Peer): string {
    const dx = (target.data.x ?? 0) - (viewer.data.x ?? 0);
    const dy = (target.data.y ?? 0) - (viewer.data.y ?? 0);
    const horizontal = dx < 0 ? "west" : dx > 0 ? "east" : "";
    const vertical = dy < 0 ? "north" : dy > 0 ? "south" : "";

    return [vertical, horizontal].filter(Boolean).join("-") || "nearby";
  }
}
