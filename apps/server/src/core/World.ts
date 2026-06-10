import { PeerData, TankPacket, TextPacket, Variant } from "growtopia.js";
import { TileData, WorldData } from "@monotopia/types";
import { Base } from "./Base";
import {
  ActionTypes,
  ITEM_RAINBOW_SHOES,
  ITEM_ROYAL_LOCK,
  LockPermission,
  PacketTypes,
  ROLE,
  TankTypes,
  TileCollisionTypes,
  TileFlags,
} from "@monotopia/const";
import { Peer } from "./Peer";
// import { tileParse } from "../world/tiles";
import { Default } from "../world/generation/Default";
import { Tile } from "../world/Tile";
import { tileFrom } from "../world/tiles";
import { ItemDefinition, ItemsDatMeta } from "grow-items";
import { buildWorldSelectMenu } from "./WorldSelectMenu";

const WORLD_TIMER_MINUTES_TO_MS = 60 * 1000;

export class World {
  public data: WorldData;
  public worldName;

  constructor(
    private base: Base,
    worldName: string,
  ) {
    this.base = base;
    this.worldName = worldName;

    const data = this.base.cache.worlds.get(worldName);
    if (data) {
      this.data = data;
    } else
      this.data = {
        name:    "",
        width:   0,
        height:  0,
        blocks:  [],
        weather: { id: 41 },
        dropped: { items: [], uid: 0 },
      };
  }

  public async saveToCache() {
    this.base.cache.worlds.set(this.worldName, this.data);
    return true;
  }

  public async saveToDatabase() {
    if (await this.base.database.worlds.has(this.worldName))
      return await this.base.database.worlds.save(this.data);
    else return await this.base.database.worlds.set(this.data);
  }

  public leave(peer: Peer, sendMenu = true) {
    this.data.playerCount = this.data.playerCount
      ? this.data.playerCount - 1
      : 0;

    peer.data.lastCheckpoint = undefined;
    peer.data.worldEnteredAt = undefined;
    this.clearWorldTimer(peer);

    peer.send(
      TextPacket.from(
        PacketTypes.ACTION,
        "action|play_sfx",
        "file|audio/door_shut.wav",
        "delayMS|0",
      ),
    );
    const world = peer.currentWorld();
    if (world) {
      world.every((p) => {
        if (p.data.netID !== peer.data.netID) {
          p.send(
            Variant.from(
              "OnRemove",
              `netID|${peer.data?.netID}`,
              `pId|${peer.data?.userID}`,
            ),
            Variant.from(
              "OnConsoleMessage",
              `\`5<${peer.data.displayName}\`\` left, \`w${this.data.playerCount}\`\` others here\`5>\`\``,
            ),
            Variant.from(
              "OnTalkBubble",
              peer.data.netID,
              `\`5<${peer.data.displayName}\`\` left, \`w${this.data.playerCount}\`\` others here\`5>\`\``,
              0,
              1,
            ),
            TextPacket.from(
              PacketTypes.ACTION,
              "action|play_sfx",
              "file|audio/door_shut.wav",
              "delayMS|0",
            ),
          );
        }
      });
    }

    if (sendMenu)
      peer.send(
        Variant.from(
          { delay: 500 },
          "OnRequestWorldSelectMenu",
          buildWorldSelectMenu(this.base, peer),
        ),
        Variant.from(
          { delay: 500 },
          "OnConsoleMessage",
          `Where would you like to go? (\`w${this.base.getPlayersOnline()}\`\` online)`,
        ),
      );

    peer.data.world = "EXIT";
    this.saveToCache();
    peer.saveToCache();

    if ((this.data.playerCount as number) < 1) {
      // TODO: delete the cache (if needed) & save it to db
    }
  }

  public async getData() {
    if (!this.base.cache.worlds.has(this.worldName)) {
      const world = await this.base.database.worlds.get(this.worldName);
      if (world) {
        const blocks = world.blocks ? JSON.parse(world.blocks.toString()) : [];

        this.data = {
          name:        world.name,
          width:       world.width,
          height:      world.height,
          blocks,
          // admins: [],
          playerCount: 0,
          jammers:     [],
          dropped:     world.dropped
            ? JSON.parse(world.dropped.toString())
            : { uid: 0, items: [] },
          // owner: world.owner ? JSON.parse(world.owner.toString()) : null,
          weather:        { id: world.weather_id || 41 },
          worldLockIndex: this.resolveWorldLockIndex(
            blocks,
            world.worldlock_index,
          ),
          // minLevel: world.minimum_level || 1,
        };
      } else {
        await this.generate(true);
      }
    } else this.data = this.base.cache.worlds.get(this.worldName) as WorldData;
  }

  /**
   * Emulate TileChangeReq
   *
   * if `overrideTile` is true, the target tile will be replaced.
   * else it will simulate TileChangeReq behaviour.
   * @param peer peer that initiate the place.
   * @param param2 See the function description.
   */
  public async place(
    peer: Peer,
    x: number,
    y: number,
    itemID: ItemDefinition,
    { overrideTile }: { overrideTile: boolean } = { overrideTile: false },
  ): Promise<boolean> {
    const targetTile = tileFrom(
      this.base,
      this,
      this.data.blocks[y * this.data.width + x],
    );

    if (itemID.type == ActionTypes.BACKGROUND) {
      return targetTile.onPlaceBackground(peer, itemID);
    } else if (targetTile.data.fg == 0) {
      return targetTile.onPlaceForeground(peer, itemID);
    } else {
      return targetTile.onItemPlace(peer, itemID);
    }
  }

  public async enter(peer: Peer, x: number, y: number): Promise<boolean> {
    await this.getData();

    if (typeof x !== "number") x = -1;
    if (typeof y !== "number") y = -1;

    if (!this.canEnterByLevel(peer)) {
      const minLevel = this.getWorldMinimumLevel();

      peer.data.world = "EXIT";
      peer.send(
        Variant.from("OnFailedToEnterWorld", 1),
        Variant.from(
          "OnConsoleMessage",
          `You must be level \`w${minLevel}\`\` to enter \`2${this.worldName}\`\`.`,
        ),
      );
      await peer.saveToCache();
      return false;
    }

    // Validate world data
    if (!this.data || !this.data.blocks || this.data.blocks.length === 0) {
      console.error("World data is invalid or empty!");
      peer.send(
        Variant.from("OnConsoleMessage", "`4Error: World data is corrupted!"),
      );
      return false;
    }

    const HEADER_LENGTH = this.worldName.length + 20;
    const buffer = Buffer.alloc(HEADER_LENGTH);
    const blockCount = this.data.height * this.data.width;

    // Verify block count matches
    if (this.data.blocks.length !== blockCount) {
      console.warn(
        `Block count mismatch! Expected: ${blockCount}, Got: ${this.data.blocks.length}`,
      );
    }

    // World data
    buffer.writeUint16LE(0x14); // Version/Type byte (20 in decimal)
    buffer.writeUint32LE(0x40, 2); // Flags or version
    buffer.writeUint16LE(this.worldName.length, 6);
    buffer.write(this.worldName, 8);
    buffer.writeUint32LE(this.data.width, 8 + this.worldName.length);
    buffer.writeUint32LE(this.data.height, 12 + this.worldName.length);
    buffer.writeUint32LE(blockCount, 16 + this.worldName.length);

    console.log(
      "Header bytes:",
      buffer.slice(0, Math.min(20, buffer.length)).toString("hex"),
    );

    // Tambahan 5 bytes, gatau ini apaan
    const unk1 = Buffer.alloc(5);
    // For 5.34, these bytes might matter - try setting to 0
    unk1.fill(0);

    // Block data
    const blockBytes: number[] = [];

    try {
      for (const block of this.data.blocks) {
        const visibleBlock = this.getVisibleTileForPeer(block, peer);
        // const item = this.base.items.metadata.items.find(
        //   (i) => i.id === block.fg
        // );

        // const blockBuf = new Tile(this.base, this, block).serialize(item?.type as number);
        // const type = item?.type as number;
        // const blockBuf = await tileParse(type, this.base, this, block);
        const blockBuf = (await tileFrom(this.base, this, visibleBlock).parse())
          .data;

        blockBuf.forEach((b) => blockBytes.push(b));
      }

      // Log first block for debugging
      if (blockBytes.length > 0) {
        console.log(
          "First block data (first 32 bytes):",
          Buffer.from(blockBytes.slice(0, 32)).toString("hex"),
        );
      }
    } catch (error) {
      console.error("Error serializing blocks:", error);
      throw error;
    }

    // Tambahan 12 bytes, gatau ini apaan
    const unk2 = Buffer.alloc(12);

    // Drop data
    const droppedItemsCount = this.data.dropped?.items?.length || 0;
    const droppedUid = this.data.dropped?.uid || 0;
    const dropData = Buffer.alloc(8 + droppedItemsCount * 16);
    dropData.writeUInt32LE(droppedItemsCount);
    dropData.writeUInt32LE(droppedUid, 4);

    let pos = 8;
    this.data.dropped?.items?.forEach((item) => {
      dropData.writeUInt16LE(item.id, pos);
      dropData.writeFloatLE(item.x, pos + 2);
      dropData.writeFloatLE(item.y, pos + 6);
      dropData.writeUInt8(item.amount < -1 ? 0 : item.amount, pos + 10);
      // ignore flags / 0x0
      dropData.writeUInt32LE(item.uid, pos + 12);

      pos += 16;
    });

    // Weather
    const weatherData = Buffer.alloc(12);
    weatherData.writeUint16LE(this.data.weather.id); // weather id
    const weatherOnOff = this.data.weather.id === 41 ? 0x0 : 0x1; // 0 = off when clear, 1 = on otherwise
    weatherData.writeUint16LE(weatherOnOff, 2);
    weatherData.writeUint32LE(0x0, 4); // ??
    weatherData.writeUint32LE(0x0, 8); // ??

    const worldMap = Buffer.concat([
      buffer,
      Buffer.concat([unk1, Buffer.from(blockBytes)]),
      Buffer.concat([unk2, dropData, weatherData]),
    ]);

    const tank = TankPacket.from({
      type:  TankTypes.SEND_MAP_DATA,
      state: 8,
      data:  () => worldMap,
    });

    const mainDoor = this.data.blocks.find((block) => block.fg === 6);

    const xPos = (x < 0 ? mainDoor?.x || 0 : x) * 32;
    const yPos = (y < 0 ? mainDoor?.y || 0 : y) * 32;

    peer.send(tank);
    // Applly current weather on join
    peer.send(Variant.from("OnSetCurrentWeather", this.data.weather.id));
    peer.data.x = xPos;
    peer.data.y = yPos;
    peer.data.world = this.worldName;
    peer.data.worldEnteredAt = Date.now();

    peer.send(
      Variant.from(
        { delay: -1 },
        "OnSpawn",
        `spawn|avatar\nnetID|${peer.data?.netID}\nuserID|${peer.data?.userID}\ncolrect|0|0|20|30\nposXY|${peer.data?.x}|${peer.data?.y}\nname|\`w${peer.data.displayName}\`\`\ncountry|${peer.country}\ninvis|0\nmstate|0\nsmstate|0\nonlineID|\ntype|local`,
      ),

      Variant.from(
        {
          netID: peer.data?.netID,
        },
        "OnSetClothing",
        [
          peer.data.clothing.hair,
          peer.data.clothing.shirt,
          peer.data.clothing.pants,
        ],
        [
          peer.data.clothing.feet,
          peer.data.clothing.face,
          peer.data.clothing.hand,
        ],
        [
          peer.data.clothing.back,
          peer.data.clothing.mask,
          peer.data.clothing.necklace,
        ],
        peer.getSkinColor(),
        [peer.data.clothing.ances, 0.0, 0.0],
      ),
    );

    const ownerUserID = this.getOwnerUID();
    if (ownerUserID) {
      const ownerData = await this.base.database.players.getByUID(ownerUserID);
      peer.send(
        Variant.from(
          "OnConsoleMessage",
          `\`p[\`0${this.data.name} \`oWorld Locked by ${ownerData?.display_name}\`#]`,
        ),
      );
    }

    const world = peer.currentWorld();
    if (world) {
      world.every((p) => {
        if (p.data.netID !== peer.data.netID) {
          p.send(
            Variant.from(
              { delay: -1 },
              "OnSpawn",
              `spawn|avatar\nnetID|${peer.data?.netID}\nuserID|${peer.data?.userID}\ncolrect|0|0|20|30\nposXY|${peer.data?.x}|${peer.data?.y}\nname|\`w${peer.data.displayName}\`\`\ncountry|${peer.country}\ninvis|0\nmstate|0\nsmstate|0\nonlineID|\n`,
            ),
            Variant.from(
              {
                netID: peer.data?.netID,
              },
              "OnSetClothing",
              [
                peer.data.clothing.hair,
                peer.data.clothing.shirt,
                peer.data.clothing.pants,
              ],
              [
                peer.data.clothing.feet,
                peer.data.clothing.face,
                peer.data.clothing.hand,
              ],
              [
                peer.data.clothing.back,
                peer.data.clothing.mask,
                peer.data.clothing.necklace,
              ],
              peer.getSkinColor(),
              [peer.data.clothing.ances, 0.0, 0.0],
            ),
            Variant.from(
              "OnConsoleMessage",
              `\`5<${peer.data.displayName}\`\` joined, \`w${this.data.playerCount}\`\` others here\`5>\`\``,
            ),
            Variant.from(
              "OnTalkBubble",
              peer.data.netID,
              `\`5<${peer.data.displayName}\`\` joined, \`w${this.data.playerCount}\`\` others here\`5>\`\``,
              0,
              1,
            ),
            TextPacket.from(
              PacketTypes.ACTION,
              "action|play_sfx",
              "file|audio/door_open.wav",
              "delayMS|0",
            ),
          );

          peer.send(
            Variant.from(
              { delay: -1 },
              "OnSpawn",
              `spawn|avatar\nnetID|${p.data?.netID}\nuserID|${p.data?.userID}\ncolrect|0|0|20|30\nposXY|${p.data?.x}|${p.data?.y}\nname|\`w${p.data.displayName}\`\`\ncountry|${p.country}\ninvis|0\nmstate|0\nsmstate|0\nonlineID|\n`,
            ),
            Variant.from(
              {
                netID: p.data?.netID,
              },
              "OnSetClothing",
              [
                p.data.clothing.hair,
                p.data.clothing.shirt,
                p.data.clothing.pants,
              ],
              [
                p.data.clothing.feet,
                p.data.clothing.face,
                p.data.clothing.hand,
              ],
              [
                p.data.clothing.back,
                p.data.clothing.mask,
                p.data.clothing.necklace,
              ],
              p.getSkinColor(),
              [p.data.clothing.ances, 0.0, 0.0],
            ),
          );
        }
      });
    }

    this.data.playerCount = this.data.playerCount
      ? this.data.playerCount + 1
      : 1;

    await this.saveToCache();
    this.scheduleWorldTimer(peer);
    await peer.saveToCache();
    this.refreshRoyalRainbowVisuals();

    return true;
  }

  public async generate(cache?: boolean) {
    if (!this.worldName) throw new Error("World name required.");
    const worldGen = new Default(this.worldName);

    await worldGen.generate();
    this.data = worldGen.data;
    if (cache) this.saveToCache();
  }

  public drop(
    peer: Peer,
    x: number,
    y: number,
    id: number,
    amount: number,
    { tree, noSimilar }: { tree?: boolean; noSimilar?: boolean } = {},
  ) {
    const tank = TankPacket.from({
      type:        TankTypes.ITEM_CHANGE_OBJECT,
      netID:       -1,
      targetNetID: tree ? -1 : peer.data?.netID,
      state:       0,
      info:        id,
      xPos:        x,
      yPos:        y,
    });

    const position = Math.trunc(x / 32) + Math.trunc(y / 32) * this.data.width;
    const block = this.data.blocks[position];

    const similarDrops = noSimilar
      ? null
      : this.data.dropped?.items
        .filter(
          (i) =>
            i.id === id && block.x === i.block.x && block.y === i.block.y,
        )
        .sort((a, b) => a.amount - b.amount);

    const similarDrop = Array.isArray(similarDrops) ? similarDrops[0] : null;

    if (similarDrop && similarDrop.amount < 200) {
      if (similarDrop.amount + amount > 200) {
        const extra = similarDrop.amount + amount - 200;

        amount = 0;
        similarDrop.amount = 200;

        this.drop(peer, x, y, id, extra, { tree: true });
      }

      tank.data!.netID = -3;
      tank.data!.targetNetID = similarDrop.uid;

      tank.data!.xPos = similarDrop.x;
      tank.data!.yPos = similarDrop.y;

      amount += similarDrop.amount;

      similarDrop.amount = amount;
    } else
      this.data.dropped?.items.push({
        id,
        amount,
        x,
        y,
        uid:   ++this.data.dropped.uid,
        block: { x: block.x, y: block.y },
      });

    const buffer = tank.parse() as Buffer;
    buffer.writeFloatLE(amount, 20);

    this.every((p) => {
      p.send(buffer);
    });

    this.saveToCache();
  }

  public collect(peer: Peer, uid: number) {
    const droppedItem = this.data.dropped?.items.find((i) => i.uid === uid);
    if (!droppedItem) return;
    const item = this.base.items.metadata.items.get(droppedItem.id.toString());
    if ((item?.id ?? 0) <= 1) return;

    const itemInInv = peer.data.inventory.items.find(
      (i) => i.id === droppedItem.id,
    );

    if (
      (!itemInInv &&
        peer.data.inventory.items.length >= peer.data.inventory.max) ||
      (itemInInv && itemInInv.amount >= 200)
    )
      return;

    const world = peer.currentWorld();
    if (world) {
      world.every((p) => {
        p.send(
          TankPacket.from({
            type:        TankTypes.ITEM_CHANGE_OBJECT,
            netID:       peer.data?.netID,
            targetNetID: -1,
            info:        uid,
          }),
        );
      });
    }

    if (itemInInv) {
      if (droppedItem.amount + itemInInv.amount > 200) {
        const extra = droppedItem.amount + itemInInv.amount - 200;
        peer.send(
          Variant.from(
            "OnConsoleMessage",
            `Collected \`w${200 - itemInInv.amount} ${item?.name}`,
          ),
        );
        itemInInv.amount = 200;

        this.drop(peer, droppedItem.x, droppedItem.y, droppedItem.id, extra, {
          noSimilar: true,
          tree:      true,
        });
      } else {
        if (droppedItem.id !== 112) {
          itemInInv.amount += droppedItem.amount;
          peer.send(
            Variant.from(
              "OnConsoleMessage",
              `Collected \`w${droppedItem.amount} ${item?.name}`,
            ),
          );
        } else {
          peer.data.gems += droppedItem.amount;
        }
      }
    } else {
      if (droppedItem.id !== 112) {
        peer.addItemInven(droppedItem.id, droppedItem.amount, true);
        peer.send(
          Variant.from(
            "OnConsoleMessage",
            `Collected \`w${droppedItem.amount} ${item?.name}`,
          ),
        );
      } else {
        peer.data.gems += droppedItem.amount;
      }
    }

    this.data.dropped!.items = this.data.dropped!.items.filter(
      (i) => i.uid !== droppedItem.uid,
    );

    peer.saveToCache();
    this.saveToCache();
  }

  public async hasTilePermission(
    userID: number,
    tile: TileData,
    permissionType: LockPermission,
  ): Promise<boolean> {
    // a lock owns this tile
    const userData = await this.base.database.players.getByUID(userID);
    if (userData && userData.role == ROLE.DEVELOPER) return true;

    // the tile being asked is the lock itself. No one have permission except the owner
    if (tile.lock) {
      return userID == tile.lock.ownerUserID;
    } else if (tile.lockedBy) {
      const owningLock =
        this.data.blocks[
          tile.lockedBy.parentY! * this.data.width + tile.lockedBy.parentX!
        ];
      if (owningLock.lock) {
        if (owningLock.lock.ownerUserID == userID) {
          return true;
        }

        if (
          owningLock.lock.adminIDs &&
          owningLock.lock.adminIDs.includes(userID)
        ) {
          if (owningLock.lock.adminLimited) {
            return (
              !!(owningLock.lock.permission & permissionType) ||
              owningLock.lock.permission == permissionType
            );
          }
          return true;
        }
        // not admin?
        if (owningLock.flags & TileFlags.PUBLIC) {
          return (
            !!(owningLock.lock.permission & permissionType) ||
            owningLock.lock.permission == permissionType
          );
        }
      }
    } else {
      const worldLock = this.getWorldLockTile();
      if (!worldLock?.lock) return true;

      if (worldLock.flags & TileFlags.PUBLIC) return true;
      else if (
        worldLock.lock!.adminIDs &&
        worldLock.lock!.adminIDs.includes(userID)
      ) {
        return true;
      } else if (worldLock.lock!.ownerUserID == userID) {
        return true;
      }
    }

    return permissionType == LockPermission.NONE || false;
  }

  public async every(
    callbackfn: (peer: Peer, netID: number) => void,
  ): Promise<void> {
    for (const peer of this.getPeers()) {
      callbackfn(peer, peer.data.netID);
    }
  }

  public getPeers(): Peer[] {
    const peers: Peer[] = [];

    if (this.data.playerCount == 0) {
      return peers;
    }

    this.base.cache.peers.forEach((p) => {
      const pp = new Peer(this.base, p.netID);
      if (pp.data.world == this.data.name) {
        peers.push(pp);
      }
    });

    return peers;
  }

  public getPeerByNetID(netID: number): Peer | undefined {
    let peer = undefined;
    this.every((p) => {
      if (p.data.netID == netID) {
        peer = p;
      }
    });

    return peer;
  }

  public getWorldLockTile(): TileData | undefined {
    const worldLockIndex = this.refreshWorldLockIndex();
    if (worldLockIndex === undefined) return undefined;

    return this.data.blocks[worldLockIndex];
  }

  public getOwnerUID(): number | undefined {
    const lock = this.getWorldLockTile();
    if (lock?.lock && lock.worldLockData) {
      return lock.lock.ownerUserID;
    }
    return undefined;
  }

  public hasWorldLockAccess(userID: number): boolean {
    const lock = this.getWorldLockTile();
    if (!lock?.lock || !lock.worldLockData) return false;

    return (
      lock.lock.ownerUserID === userID || !!lock.lock.adminIDs?.includes(userID)
    );
  }

  public getWorldMinimumLevel(): number {
    return this.getWorldLockTile()?.worldLockData?.minLevel ?? 1;
  }

  public canEnterByLevel(peer: Peer): boolean {
    const minLevel = this.getWorldMinimumLevel();

    if (minLevel <= 1) return true;
    if (peer.data.level >= minLevel) return true;
    if (this.hasWorldLockAccess(peer.data.userID)) return true;

    return (
      peer.data.role === ROLE.MODERATOR || peer.data.role === ROLE.DEVELOPER
    );
  }

  public getWorldTimerMinutes(): number {
    return this.getWorldLockTile()?.worldLockData?.timerMinutes ?? 0;
  }

  public canBypassWorldTimer(peer: Peer): boolean {
    return (
      this.hasWorldLockAccess(peer.data.userID) ||
      peer.data.role === ROLE.MODERATOR ||
      peer.data.role === ROLE.DEVELOPER
    );
  }

  public scheduleWorldTimer(peer: Peer): void {
    const timerMinutes = this.getWorldTimerMinutes();

    if (timerMinutes <= 0 || this.canBypassWorldTimer(peer)) {
      this.clearWorldTimer(peer);
      return;
    }

    const enteredAt = peer.data.worldEnteredAt ?? Date.now();
    peer.data.worldEnteredAt = enteredAt;

    const delay = Math.max(
      1000,
      enteredAt + timerMinutes * WORLD_TIMER_MINUTES_TO_MS - Date.now(),
    );
    const fireAt = Date.now() + delay;
    const key = this.getWorldTimerKey(peer);
    const existingTimer = this.base.cache.cooldown.get(key);

    if (
      existingTimer &&
      existingTimer.limit === enteredAt &&
      existingTimer.time === fireAt
    ) {
      return;
    }

    this.base.cache.cooldown.set(key, {
      limit: enteredAt,
      time:  fireAt,
    });

    setTimeout(() => {
      void this.handleWorldTimerExpiry(peer.data.netID, enteredAt, fireAt);
    }, delay);
  }

  public refreshWorldTimers(): void {
    for (const peer of this.getPeers()) {
      this.scheduleWorldTimer(peer);
    }
  }

  private getWorldTimerKey(peer: Peer): string {
    return `world-timer-${this.worldName}-${peer.data.netID}`;
  }

  private clearWorldTimer(peer: Peer): void {
    this.base.cache.cooldown.delete(this.getWorldTimerKey(peer));
  }

  private async handleWorldTimerExpiry(
    netID: number,
    enteredAt: number,
    fireAt: number,
  ): Promise<void> {
    const peer = new Peer(this.base, netID);
    const key = this.getWorldTimerKey(peer);
    const timer = this.base.cache.cooldown.get(key);

    if (!timer || timer.limit !== enteredAt || timer.time !== fireAt) return;
    if (peer.data.world !== this.worldName) {
      this.base.cache.cooldown.delete(key);
      return;
    }

    await this.getData();

    const timerMinutes = this.getWorldTimerMinutes();
    if (timerMinutes <= 0 || this.canBypassWorldTimer(peer)) {
      this.base.cache.cooldown.delete(key);
      return;
    }

    const currentEnteredAt = peer.data.worldEnteredAt ?? enteredAt;
    const remaining =
      currentEnteredAt + timerMinutes * WORLD_TIMER_MINUTES_TO_MS - Date.now();

    if (remaining > 0) {
      this.scheduleWorldTimer(peer);
      return;
    }

    peer.sendConsoleMessage(
      `\`oThe World Timer for \`w${this.worldName}\`\` has expired.`,
    );
    peer.sendTextBubble("World Timer expired.", false);
    peer.leaveWorld();
    this.base.cache.cooldown.delete(key);
  }

  public isSheetMusicItem(itemID: number): boolean {
    const item = this.base.items.metadata.items.get(itemID.toString());

    return item?.type === ActionTypes.SHEET_MUSIC;
  }

  public shouldHideSheetMusicFrom(peer: Peer, tile: TileData): boolean {
    const worldLockData = this.getWorldLockTile()?.worldLockData;
    if (!this.isSheetMusicItem(tile.bg)) return false;
    if (worldLockData?.customMusicBlocksDisabled) return true;
    if (!worldLockData?.invisMusicBlocks) return false;
    if (this.hasWorldLockAccess(peer.data.userID)) return false;

    return (
      peer.data.role !== ROLE.MODERATOR && peer.data.role !== ROLE.DEVELOPER
    );
  }

  public getVisibleTileForPeer(tile: TileData, peer: Peer): TileData {
    if (!this.shouldHideSheetMusicFrom(peer, tile)) return tile;

    return { ...tile, bg: 0 };
  }

  public async refreshMusicBlockVisibility(): Promise<void> {
    const musicBlocks = this.data.blocks.filter((block) =>
      this.isSheetMusicItem(block.bg),
    );

    for (const peer of this.getPeers()) {
      for (const block of musicBlocks) {
        await tileFrom(
          this.base,
          this,
          this.getVisibleTileForPeer(block, peer),
        ).tileUpdate(peer);
      }
    }
  }

  public refreshRoyalRainbowVisuals(): void {
    this.every((peer) => {
      if (
        this.isRoyalRainbowsEnabled() &&
        this.hasWorldLockAccess(peer.data.userID)
      ) {
        peer.sendClothes({ feet: ITEM_RAINBOW_SHOES });
      } else {
        peer.sendClothes();
      }
    });
  }

  public canBypassRoyalSilence(peer: Peer): boolean {
    return (
      peer.data.role === ROLE.MODERATOR ||
      peer.data.role === ROLE.DEVELOPER ||
      this.hasWorldLockAccess(peer.data.userID)
    );
  }

  public getRoyalLockTile(): TileData | undefined {
    const lock = this.getWorldLockTile();
    if (lock?.fg === ITEM_ROYAL_LOCK && lock.worldLockData) return lock;
    return undefined;
  }

  public isRoyalSilenceEnabled(): boolean {
    return !!this.getRoyalLockTile()?.worldLockData?.royalSilence;
  }

  public isRoyalRainbowsEnabled(): boolean {
    return !!this.getRoyalLockTile()?.worldLockData?.royalRainbows;
  }

  public isRoyalRadarEnabled(): boolean {
    return !!this.getRoyalLockTile()?.worldLockData?.royalRadar;
  }

  // Helper functino to get lock owner user ID on a specific tile.
  public getTileOwnerUID(tile: TileData): number | undefined {
    if (tile.lockedBy) {
      const owningLock =
        this.data.blocks[
          tile.lockedBy.parentY! * this.data.width + tile.lockedBy.parentX!
        ];
      if (owningLock.lock) {
        return owningLock.lock.ownerUserID;
      }
    }
    // the tile being asked is the lock itself. No one have permission except the owner
    else if (tile.lock) {
      return tile.lock.ownerUserID;
    }

    const worldLock = this.getWorldLockTile();
    return worldLock?.lock?.ownerUserID;
  }

  private refreshWorldLockIndex(): number | undefined {
    const worldLockIndex = this.resolveWorldLockIndex(
      this.data.blocks,
      this.data.worldLockIndex,
    );

    this.data.worldLockIndex = worldLockIndex;

    return worldLockIndex;
  }

  private resolveWorldLockIndex(
    blocks: TileData[],
    currentIndex?: number | null,
  ): number | undefined {
    if (
      typeof currentIndex === "number" &&
      this.isWorldLockBlock(blocks[currentIndex])
    ) {
      return currentIndex;
    }

    const worldLockIndex = blocks.findIndex((block) =>
      this.isWorldLockBlock(block),
    );

    return worldLockIndex >= 0 ? worldLockIndex : undefined;
  }

  private isWorldLockBlock(block?: TileData): boolean {
    return !!block?.lock && !!block.worldLockData;
  }
}
