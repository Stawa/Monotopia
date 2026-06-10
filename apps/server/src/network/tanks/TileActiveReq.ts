import { TankPacket, Variant } from "growtopia.js";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { World } from "../../core/World";
import { TileData } from "@monotopia/types";
import { LockPermission, TileFlags } from "@monotopia/const";

export class TileActiveReq {
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

    if (!this.block || !this.block.door) return;
    if (this.block.fg === 6) return this.peer.leaveWorld();

    if (!(await this.canUseDoor(this.block))) return;

    const [rawWorldName, rawDoorID] = (this.block.door.destination ?? "").split(
      ":",
    );
    const worldName = this.normalize(rawWorldName || this.peer.data.world);
    const id = this.normalize(rawDoorID);

    if (!worldName || worldName === "EXIT") return this.peer.leaveWorld();

    if (worldName === this.normalize(this.peer.data.world)) {
      const door =
        this.findDoorByID(this.world, id) ?? this.findMainDoor(this.world);

      if (!door) {
        this.peer.sendTextBubble(
          "That destination door couldn't be found.",
          true,
        );
        return;
      }

      this.setPeerPosition(this.world, door);
      return;
    }

    const destinationWorld = new World(this.base, worldName);
    await destinationWorld.getData();

    const door =
      this.findDoorByID(destinationWorld, id) ??
      this.findMainDoor(destinationWorld);

    if (!door) {
      this.peer.sendTextBubble(
        "That destination world has no usable door.",
        true,
      );
      return;
    }

    this.world.leave(this.peer, false);
    await this.peer.enterWorld(worldName, door.x, door.y);
  }

  private async canUseDoor(block: TileData): Promise<boolean> {
    if (block.flags & TileFlags.PUBLIC) return true;

    const canUse = await this.world.hasTilePermission(
      this.peer.data.userID,
      block,
      LockPermission.BUILD,
    );

    if (!canUse) {
      this.peer.sendTextBubble("This door is closed to the public.", true);
      this.peer.sendOnPlayPositioned("audio/punch_locked.wav", {
        netID: this.peer.data.netID,
      });
    }

    return canUse;
  }

  private normalize(value?: string): string {
    return (value ?? "").trim().toUpperCase();
  }

  private findDoorByID(world: World, id: string): TileData | undefined {
    if (!id) return undefined;

    return world.data.blocks.find(
      (block) => block.door && this.normalize(block.door.id) === id,
    );
  }

  private findMainDoor(world: World): TileData | undefined {
    return world.data.blocks.find((block) => block.fg === 6);
  }

  private setPeerPosition(world: World, door: TileData): void {
    const doorX = (door.x || 0) * 32;
    const doorY = (door.y || 0) * 32;

    this.peer.data.x = doorX;
    this.peer.data.y = doorY;
    this.peer.saveToCache();
    this.peer.send(Variant.from("OnZoomCamera", [10000], 1000));

    world.every((p) => {
      p.send(
        Variant.from({ netID: this.peer.data.netID }, "OnSetFreezeState", 0),
        Variant.from({ netID: this.peer.data.netID }, "OnSetPos", [
          doorX,
          doorY,
        ]),
        Variant.from(
          { netID: this.peer.data.netID },
          "OnPlayPositioned",
          "audio/door_open.wav",
        ),
      );
    });
  }
}
