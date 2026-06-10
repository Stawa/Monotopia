import { Client } from "growtopia.js";
import {
  downloadMkcert,
  setupMkcert,
  checkPortInUse,
  downloadWebsite,
  setupWebsite,
  downloadItemsDat,
  downloadMacOSItemsDat,
  Collection,
  RTTEX,
} from "@monotopia/utils";
import { basename, join } from "path";
import { createSocket, type RemoteInfo, type Socket } from "dgram";
import { ConnectListener } from "../events/Connect";
import { DisconnectListener } from "../events/Disconnect";
import { type PackageJson } from "type-fest";
import { RawListener } from "../events/Raw";
import { readFileSync, readdirSync } from "fs";
import {
  Cache,
  CDNContent,
  CustomItemsConfig,
  ItemsData,
  ItemsInfo,
} from "@monotopia/types";
import { Database } from "@monotopia/db";
import { Peer } from "./Peer";
import { World } from "./World";
import { mkdir, writeFile, readFile } from "fs/promises";
import chokidar from "chokidar";
import {
  APP_COPYRIGHT_START_YEAR,
  APP_NAME,
  APP_ORIGINAL_AUTHOR,
  APP_ORIGINAL_PROJECT,
  APP_ORIGINAL_REPOSITORY,
  APP_OWNER,
  ActionTypes,
  BlockFlags,
  ITEM_ROYAL_LOCK,
  ITEMS_DAT_NAME,
} from "@monotopia/const";
import { ItemsDat, ItemsDatMeta, type ItemDefinition } from "grow-items";
import { config as configServer } from "@monotopia/config";
import logger from "@monotopia/logger";
import { decodeItemsDatCompat } from "../items/ItemsDatCompat";

__dirname = process.cwd();

const CORE_ITEM_OVERRIDES: Record<number, Partial<ItemDefinition>> = {
  0: { name: "Blank", type: ActionTypes.FOREGROUND, collisionType: 0 },
  2: { name: "Dirt", type: ActionTypes.FOREGROUND, collisionType: 1 },
  3: { name: "Dirt Seed", type: ActionTypes.SEED, growTime: 30 },
  4: { name: "Lava", type: ActionTypes.FOREGROUND, collisionType: 1 },
  5: { name: "Lava Seed", type: ActionTypes.SEED, growTime: 30 },
  6: {
    name: "Main Door",
    type: ActionTypes.MAIN_DOOR,
    flags: BlockFlags.WRENCHABLE | BlockFlags.MOD | BlockFlags.PUBLIC,
    collisionType: 0,
    breakHits: 999999,
  },
  8: {
    name: "Bedrock",
    type: ActionTypes.FOREGROUND,
    flags: BlockFlags.MOD,
    collisionType: 1,
    breakHits: 999999,
  },
  9: { name: "Bedrock Seed", type: ActionTypes.SEED, growTime: 30 },
  10: { name: "Rock", type: ActionTypes.FOREGROUND, collisionType: 1 },
  11: { name: "Rock Seed", type: ActionTypes.SEED, growTime: 30 },
  14: {
    name: "Cave Background",
    type: ActionTypes.BACKGROUND,
    collisionType: 0,
  },
  15: { name: "Cave Background Seed", type: ActionTypes.SEED, growTime: 30 },
  18: { name: "Fist", type: ActionTypes.FIST, maxAmount: 1 },
  32: { name: "Wrench", type: ActionTypes.WRENCH, maxAmount: 1 },
  112: { name: "Gem", type: ActionTypes.GEMS, maxAmount: 200 },
  202: {
    name: "Small Lock",
    type: ActionTypes.LOCK,
    flags: BlockFlags.WRENCHABLE,
  },
  204: {
    name: "Big Lock",
    type: ActionTypes.LOCK,
    flags: BlockFlags.WRENCHABLE,
  },
  206: {
    name: "Huge Lock",
    type: ActionTypes.LOCK,
    flags: BlockFlags.WRENCHABLE,
  },
  242: {
    name: "World Lock",
    type: ActionTypes.LOCK,
    flags: BlockFlags.WRENCHABLE,
  },
  1796: {
    name: "Diamond Lock",
    type: ActionTypes.LOCK,
    flags: BlockFlags.WRENCHABLE,
  },
  [ITEM_ROYAL_LOCK]: {
    name: "Royal Lock",
    type: ActionTypes.LOCK,
    flags: BlockFlags.WRENCHABLE,
  },
  4994: {
    name: "Builder's Lock",
    type: ActionTypes.LOCK,
    flags: BlockFlags.WRENCHABLE,
  },
  7188: {
    name: "Blue Gem Lock",
    type: ActionTypes.LOCK,
    flags: BlockFlags.WRENCHABLE,
  },
};

export class Base {
  public server: Client;
  public items: ItemsData;
  public package: PackageJson;
  public config;
  public cdn: CDNContent;
  public cache: Cache;
  public database: Database;
  private ipv6Proxy?: Socket;
  private ipv6ProxyClients = new Map<
    string,
    {
      address: string;
      port: number;
      socket: Socket;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor() {
    this.server = new Client({
      enet: {
        ip: "0.0.0.0",
        useNewServerPacket: true,
      },
    });
    this.package = JSON.parse(
      readFileSync(join(__dirname, "package.json"), "utf-8"),
    );
    this.config = configServer;
    this.cdn = { version: "", uri: "0000/0000", itemsDatName: "" };
    this.items = {
      content: Buffer.alloc(0),
      hash: "",
      metadata: {} as ItemsDatMeta,
      wiki: [],
    };
    this.cache = {
      peers: new Collection(),
      worlds: new Collection(),
      cooldown: new Collection(),
    };

    this.database = new Database();
  }

  public async start() {
    try {
      this.logStartupBanner();

      // Check if port is available
      const port = this.server.config.enet?.port || 17091;
      const portInUse = await checkPortInUse(port);

      if (portInUse) {
        throw new Error(
          `Port ${port} is already in use. Please choose a different port.`,
        );
      }

      this.cdn = await this.getLatestCdn();
      if (!this.cdn.itemsDatName) {
        const cachedItemsDatName = this.getCachedItemsDatName();
        if (!cachedItemsDatName) {
          throw new Error(
            "No cached items.dat found and items.dat metadata is unavailable.",
          );
        }

        this.cdn = {
          version: this.getItemsDatVersion(cachedItemsDatName),
          uri: "",
          itemsDatName: cachedItemsDatName,
        };
        logger.warn(`Using cached items.dat: ${cachedItemsDatName}`);
      }

      await downloadItemsDat(this.cdn.itemsDatName);
      await downloadMacOSItemsDat(this.cdn.itemsDatName);

      logger.info(`Parsing ${this.cdn.itemsDatName}`);
      const datDir = join(__dirname, ".cache", "growtopia", "dat");
      const datName = join(datDir, this.cdn.itemsDatName);
      const itemsDat = readFileSync(datName);

      this.items = {
        hash: `${RTTEX.hash(itemsDat)}`,
        content: itemsDat,
        metadata: {} as ItemsDatMeta,
        wiki: [] as ItemsInfo[],
      };

      logger.info(`Starting ENet server on port ${port}`);

      // Add error handling for server start
      await new Promise((resolve, reject) => {
        try {
          this.server.listen();
          this.startIPv6UdpProxy(port);
          resolve(true);
        } catch (err) {
          reject(err);
        }
      });

      await this.loadItems();
      await this.loadEvents();
    } catch (err) {
      logger.error(`Failed to start server: ${err}`);
      process.exit(1);
    }
  }

  private startIPv6UdpProxy(port: number) {
    if (process.env.MONOTOPIA_IPV6_PROXY === "0") return;
    if (this.ipv6Proxy) return;

    const proxy = createSocket({ type: "udp6", ipv6Only: true });

    proxy.on("message", (message, rinfo) => {
      const client = this.getIPv6ProxyClient(rinfo);
      client.socket.send(message, port, "127.0.0.1");
    });

    proxy.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        logger.warn(`IPv6 UDP proxy skipped: [::]:${port} is already in use.`);
        return;
      }

      logger.warn(`IPv6 UDP proxy error: ${error.message}`);
    });

    proxy.bind(port, "::", () => {
      logger.info(`IPv6 UDP proxy listening on [::]:${port}`);
      logger.info(`Forwarding IPv6 UDP to 127.0.0.1:${port}`);
    });

    this.ipv6Proxy = proxy;
  }

  private ipv6ProxyClientKey(rinfo: RemoteInfo) {
    return `${rinfo.address}:${rinfo.port}`;
  }

  private refreshIPv6ProxyClient(key: string) {
    const client = this.ipv6ProxyClients.get(key);
    if (!client) return;

    clearTimeout(client.timeout);
    client.timeout = setTimeout(() => this.closeIPv6ProxyClient(key), 120000);
  }

  private closeIPv6ProxyClient(key: string) {
    const client = this.ipv6ProxyClients.get(key);
    if (!client) return;

    clearTimeout(client.timeout);
    client.socket.close();
    this.ipv6ProxyClients.delete(key);
    logger.info(`IPv6 UDP proxy closed ${key}`);
  }

  private getIPv6ProxyClient(rinfo: RemoteInfo) {
    const key = this.ipv6ProxyClientKey(rinfo);
    const existingClient = this.ipv6ProxyClients.get(key);
    if (existingClient) {
      this.refreshIPv6ProxyClient(key);
      return existingClient;
    }

    const socket = createSocket("udp4");
    const client = {
      address: rinfo.address,
      port: rinfo.port,
      socket,
      timeout: setTimeout(() => this.closeIPv6ProxyClient(key), 120000),
    };

    socket.on("message", (message) => {
      this.ipv6Proxy?.send(message, client.port, client.address);
      this.refreshIPv6ProxyClient(key);
    });

    socket.on("error", (error) => {
      logger.warn(`IPv6 UDP proxy target error for ${key}: ${error.message}`);
      this.closeIPv6ProxyClient(key);
    });

    this.ipv6ProxyClients.set(key, client);
    logger.info(`IPv6 UDP proxy opened ${key}`);
    return client;
  }

  private async loadEvents() {
    const connect = new ConnectListener(this);
    const disconnect = new DisconnectListener(this);
    const raw = new RawListener(this);

    this.server.on("connect", (netID) => connect.run(netID));
    this.server.on("disconnect", (netID) => disconnect.run(netID));
    this.server.on("raw", (netID, channelID, data) =>
      raw.run(netID, channelID, data),
    );

    await this.registerCommandAliases();

    chokidar
      .watch(join(__dirname, "assets", "custom-items"), { persistent: true })
      .on("change", async (path) => {
        const fileName = basename(path);

        logger.info(`Detected custom-items change: ${fileName}`);
        logger.info("Refreshing items data");
        await this.loadItems();
      });
  }

  private logStartupBanner() {
    const currentYear = Math.max(
      new Date().getFullYear(),
      APP_COPYRIGHT_START_YEAR,
    );
    const copyrightYears =
      currentYear === APP_COPYRIGHT_START_YEAR
        ? `${APP_COPYRIGHT_START_YEAR}`
        : `${APP_COPYRIGHT_START_YEAR}-${currentYear}`;
    const rows = [
      `${APP_NAME} v${this.package.version}`,
      `Copyright (c) ${copyrightYears} ${APP_OWNER}`,
      `Based on ${APP_ORIGINAL_PROJECT} by ${APP_ORIGINAL_AUTHOR}`,
      APP_ORIGINAL_REPOSITORY,
    ];
    const width = Math.max(...rows.map((row) => row.length)) + 4;
    const line = "=".repeat(width);
    const body = rows.map((row) => `| ${row.padEnd(width - 4)} |`).join("\n");

    logger.info(`\n${line}\n${body}\n${line}`);
  }

  private async registerCommandAliases() {
    try {
      const { registerAliases } = await import("../command/cmds/index");
      await registerAliases();
      logger.info("Command aliases registered successfully");
    } catch (error) {
      logger.error("Failed to register command aliases");
    }
  }

  private normalizeItemMetadata(metadata: ItemsDatMeta) {
    const parsedItems = new Map<string | number, ItemDefinition>(
      metadata.items as unknown as Iterable<[string | number, ItemDefinition]>,
    );
    const parsedSize = parsedItems.size;
    const maxKnownItemId = Math.max(
      ...Object.keys(CORE_ITEM_OVERRIDES).map(Number),
    );
    const itemCount = Math.max(
      metadata.itemCount ?? 0,
      parsedSize,
      maxKnownItemId + 1,
    );

    metadata.itemCount = itemCount;
    metadata.items.clear();

    const normalizedItems = metadata.items as unknown as Map<
      string | number,
      ItemDefinition
    >;

    for (let id = 0; id < itemCount; id++) {
      const item = this.normalizeItemDefinition(
        id,
        parsedItems.get(id) ?? parsedItems.get(id.toString()),
      );

      normalizedItems.set(id, item);
    }

    this.useFlexibleItemLookup(normalizedItems);

    if (parsedSize < itemCount) {
      logger.warn(
        `Item metadata parser returned ${parsedSize}/${itemCount} entries; filled missing item definitions with safe defaults`,
      );
    }
  }

  private useFlexibleItemLookup(items: Map<string | number, ItemDefinition>) {
    items.get = ((key: string | number) => {
      const direct = Map.prototype.get.call(items, key) as
        | ItemDefinition
        | undefined;
      if (direct !== undefined) return direct;

      if (typeof key === "string" && /^-?\d+$/.test(key)) {
        return Map.prototype.get.call(items, Number(key)) as
          | ItemDefinition
          | undefined;
      }

      if (typeof key === "number") {
        return Map.prototype.get.call(items, key.toString()) as
          | ItemDefinition
          | undefined;
      }

      return undefined;
    }) as typeof items.get;
  }

  private normalizeItemDefinition(
    id: number,
    item?: ItemDefinition,
  ): ItemDefinition {
    const normalized: ItemDefinition = { ...(item ?? {}) };
    const fallback: ItemDefinition = {
      id,
      name: `Item ${id}`,
      flags: 0,
      flags2: 0,
      flags3: 0,
      type: ActionTypes.FOREGROUND,
      materialType: 0,
      collisionType: 1,
      breakHits: 6,
      resetStateAfter: 4,
      bodyPartType: 0,
      blockType: 0,
      growTime: 0,
      rarity: 1,
      maxAmount: 200,
      texture: "",
      textureHash: 0,
      textureX: 0,
      textureY: 0,
      storageType: 0,
      visualEffectType: 0,
      cookingTime: 0,
      extraFile: "",
      extraFileHash: 0,
      audioVolume: 0,
      seedBase: 0,
      seedOverlay: 0,
      treeBase: 0,
      treeLeaves: 0,
      seedColor: 0,
      seedOverlayColor: 0,
      isMultiFace: 0,
      isStripeyWallpaper: 0,
      extraOptions: "",
      texture2: "",
      extraOptions2: "",
      punchOptions: "",
      tileRange: 4,
      ...CORE_ITEM_OVERRIDES[id],
    };

    for (const [key, value] of Object.entries(fallback)) {
      if (normalized[key] === undefined) normalized[key] = value;
    }

    normalized.id = id;

    if (!normalized.name) normalized.name = `Item ${id}`;

    return normalized;
  }

  private loadWikiItems(wikiFile: string): ItemsInfo[] {
    let parsed: ItemsInfo[] = [];
    try {
      const json = JSON.parse(wikiFile);
      if (Array.isArray(json)) parsed = json as ItemsInfo[];
    } catch (error) {
      logger.warn(`Ignoring invalid items_info_new.json: ${error}`);
    }

    const itemCount =
      this.items.metadata.itemCount ?? this.items.metadata.items.size;
    const wikiById = new Map<number, ItemsInfo>();

    for (const item of parsed) {
      if (
        !Number.isInteger(item?.id) ||
        item.id < 0 ||
        item.id >= itemCount ||
        typeof item.name !== "string"
      ) {
        continue;
      }

      wikiById.set(item.id, {
        id: item.id,
        name: item.name,
        desc: item.desc ?? "",
        recipe: { splice: item.recipe?.splice ?? [] },
        func: {
          add: item.func?.add ?? "",
          rem: item.func?.rem ?? "",
        },
        playMods: item.playMods ?? [],
        chi: item.chi ?? "",
      });
    }

    if (wikiById.size < parsed.length) {
      logger.warn(
        `Filtered invalid item-info entries: kept ${wikiById.size}/${parsed.length}`,
      );
    }

    for (const item of this.items.metadata.items.values()) {
      if (!Number.isInteger(item.id) || wikiById.has(item.id!)) continue;

      wikiById.set(item.id!, {
        id: item.id!,
        name: item.name ?? `Item ${item.id}`,
        desc: "",
        recipe: { splice: [] },
        func: { add: "", rem: "" },
        playMods: [],
        chi: "",
      });
    }

    return Array.from(wikiById.values());
  }

  private async loadItems() {
    const itemsDatPath = join(
      __dirname,
      ".cache",
      "growtopia",
      "dat",
      this.cdn.itemsDatName,
    );
    const rawItemsDat = await readFile(itemsDatPath);
    const itemsDat = new ItemsDat(Array.from(rawItemsDat));
    await decodeItemsDatCompat(itemsDat);
    // logger.info("Loading custom items...");

    // Disable temporarily (TODO: remaking this later)
    // try {
    //   const itemsConf = JSON.parse(
    //     await readFile(
    //       join(__dirname, "assets", "custom-items", "items-config.json"),
    //       "utf-8"
    //     )
    //   ) as CustomItemsConfig;

    //   for (const asset of itemsConf.assets) {
    //     if (!asset.id) throw "Item ID are required to replace specific item";

    //     const item = itemsDat.meta.items.get(asset.id.toString())!;

    //     consola.start(`Modifying item ID: ${item.id} | ${item.name}`);

    //     Object.assign(item, {
    //       ...asset.item,
    //     });

    //     if (asset.item.extraFile) {
    //       const image = await readFile(
    //         join(
    //           __dirname,
    //           "assets",
    //           "custom-items",
    //           asset.item.extraFile.pathAsset
    //         )
    //       );
    //       const rttex = await RTTEX.encode(image);

    //       item.extraFile = asset.item.extraFile.pathResult;
    //       item.extraFileHash = RTTEX.hash(rttex);

    //       await mkdir(
    //         join(__dirname, ".cache", "growtopia", "cache", asset.storePath),
    //         {
    //           recursive: true,
    //         }
    //       );
    //       await writeFile(
    //         join(
    //           __dirname,
    //           ".cache",
    //           "growtopia",
    //           "cache",
    //           asset.storePath,
    //           asset.item.extraFile.fileName
    //         ),
    //         rttex,
    //         {
    //           flush: true,
    //         }
    //       );
    //     }

    //     if (asset.item.texture) {
    //       const image = await readFile(
    //         join(
    //           __dirname,
    //           "assets",
    //           "custom-items",
    //           asset.item.texture.pathAsset
    //         )
    //       );
    //       const rttex = await RTTEX.encode(image);

    //       item.texture = asset.item.texture.pathResult;
    //       item.textureHash = RTTEX.hash(rttex);

    //       await mkdir(
    //         join(__dirname, ".cache", "growtopia", "cache", asset.storePath),
    //         {
    //           recursive: true,
    //         }
    //       );
    //       await writeFile(
    //         join(
    //           __dirname,
    //           ".cache",
    //           "growtopia",
    //           "cache",
    //           asset.storePath,
    //           asset.item.texture.fileName
    //         ),
    //         rttex,
    //         {
    //           flush: true,
    //         }
    //       );
    //     }

    //     consola.success(
    //       `Successfully modifying item ID: ${item.id} | ${item.name}`
    //     );
    //   }
    // } catch (e) {
    //   consola.error("Failed to load custom items: " + e);
    // }

    const hash = RTTEX.hash(rawItemsDat);
    this.normalizeItemMetadata(itemsDat.meta);

    this.items.content = rawItemsDat;
    this.items.hash = `${hash}`;
    this.items.metadata = itemsDat.meta;

    const cdnCacheDir = join(__dirname, ".cache", "growtopia", "cache");
    const cdnRootDir = join(__dirname, ".cache", "growtopia");
    await mkdir(cdnCacheDir, { recursive: true });
    await writeFile(join(cdnRootDir, "items.dat"), rawItemsDat);
    await writeFile(join(cdnRootDir, this.cdn.itemsDatName), rawItemsDat);
    await writeFile(join(cdnCacheDir, "items.dat"), rawItemsDat);
    await writeFile(join(cdnCacheDir, this.cdn.itemsDatName), rawItemsDat);

    const wikiFile = await readFile(
      join(__dirname, "assets", "items_info_new.json"),
      "utf-8",
    );
    this.items.wiki = this.loadWikiItems(wikiFile);

    logger.info(`Items data hash: ${hash}`);
    logger.info("Successfully parsing items data");
  }

  public async getLatestCdn() {
    const data: CDNContent = {
      version: this.getItemsDatVersion(ITEMS_DAT_NAME),
      uri: "",
      itemsDatName: ITEMS_DAT_NAME,
    };

    return data;
  }

  private getItemsDatVersion(itemsDatName: string) {
    return itemsDatName.match(/^items-v(\d+\.\d+)\.dat$/)?.[1] ?? "";
  }

  private getCachedItemsDatName(): string {
    try {
      const datDir = join(__dirname, ".cache", "growtopia", "dat");
      const versions = readdirSync(datDir)
        .map((fileName) => ({
          fileName,
          version: Number(this.getItemsDatVersion(fileName)),
        }))
        .filter(({ version }) => Number.isFinite(version))
        .sort((a, b) => b.version - a.version);

      return versions[0]?.fileName ?? "";
    } catch {
      return "";
    }
  }

  public async saveAll(disconnectAll = false): Promise<boolean> {
    logger.info(
      `Saving ${this.cache.peers.size} peers & ${this.cache.worlds.size} worlds`,
    );

    const worldsSaved = await this.saveWorlds();
    const playersSaved = await this.savePlayers(disconnectAll);

    return worldsSaved && playersSaved;
  }

  public async saveWorlds() {
    try {
      let savedCount = 0;
      for (const [, world] of this.cache.worlds) {
        const wrld = new World(this, world.name);
        if (typeof wrld.worldName === "string")
          await wrld.saveToDatabase().catch((e) => logger.error(e));
        else
          logger.warn(
            `Oh no there's undefined (${savedCount}) world, skipping..`,
          );
        savedCount++;
      }
      logger.info(`Saved ${savedCount} worlds`);
      return true;
    } catch (err) {
      logger.error(`Failed to save worlds: ${err}`);
      return false;
    }
  }

  public async savePlayers(disconenctAll: boolean) {
    try {
      let savedCount = 0;
      for (const [, peer] of this.cache.peers) {
        const player = new Peer(this, peer.netID);
        await player.saveToDatabase();
        if (disconenctAll) {
          player.disconnect("now");
        }
        savedCount++;
      }
      logger.info(`Saved ${savedCount} players`);
      return true;
    } catch (err) {
      logger.error(`Failed to save players: ${err}`);
      return false;
    }
  }

  // Added from your updated version (version 2)
  public getPlayersOnline(ignoredNetIDs: number[] = [0]): number {
    if (!this.cache.peers || this.cache.peers.size === 0) {
      return 0;
    }

    let playerCount = 0;
    this.cache.peers.forEach((peerData, netID) => {
      if (!ignoredNetIDs.includes(netID)) {
        playerCount++;
      }
    });
    return playerCount;
  }

  public async shutdown() {
    logger.info("Shutting down server...");
    await this.saveAll(true);
    for (const key of this.ipv6ProxyClients.keys()) {
      this.closeIPv6ProxyClient(key);
    }
    this.ipv6Proxy?.close();
    process.exit(0);
  }
}
