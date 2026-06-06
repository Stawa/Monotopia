import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { config, logon } from "@growserver/config";
import { createServer } from "https";
import logger from "@growserver/logger";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Database } from "@growserver/db";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, extname, join, resolve } from "path";
import { writeWebLoginToken } from "@growserver/utils";

const DEFAULT_CDN_UPSTREAM = "https://growserver-cache.netlify.app";
const CDN_UPSTREAM = process.env.CDN_UPSTREAM || DEFAULT_CDN_UPSTREAM;
const FEATURE_ENABLE_FLAGS_YAML = [
  "EnableSQLChatFilter: true",
  "ChatFilterWebApiOverride: api.growtopiagame.com",
  "EnableNewFTUE: false",
  "EnableNewFTU: false",
  "EnableProfileHUD: true",
  "EnableStore: true",
  "EnableCommunityButton: true",
].join("\n");
const CRITICAL_CDN_ASSETS = [
  "interface/currencies.json",
  "interface/cash_icon_overlay.rttex",
  "interface/large/news_banner.rttex",
  "interface/large/btn_shop2.rttex",
  "interface/large/chat_button.rttex",
  "interface/large/event_button4.rttex",
  "interface/large/friend_button.rttex",
  "interface/large/gui_buy_plus.rttex",
  "interface/large/gui_store_top_scale9.rttex",
  "interface/large/gui_shop_buybanner5.rttex",
  "interface/large/gui_shop_featured_header.rttex",
  "interface/large/gui_shop_g4g_operationsmile_banner.rttex",
  "interface/large/gui_shop_grow_pass.rttex",
  "interface/large/gui_shop_grow_pass_buy.rttex",
  "interface/large/menu_button.rttex",
  "interface/large/PhotomodeOff.rttex",
  "interface/large/PhotomodeOn.rttex",
  "interface/large/shop_button.rttex",
  "interface/large/store_buttons/store_buttons.rttex",
  "interface/large/store_buttons/store_buttons40.rttex",
  "interface/large/store_buttons/store_buttons44.rttex",
  "GameData/Configs/FeatureEnableFlags.yaml",
  "GameData/UI/StartScreen.rcss",
  "GameData/UI/WorldUI/EventPanel.rml",
  "GameData/UI/WorldUI/EventPanel.rcss",
  "GameData/UI/WorldUI/RightMenuPanel.rml",
  "GameData/UI/WorldUI/RightMenuPanel.rcss",
  "GameData/UI/WorldUI/WorldUI.rml",
  "GameData/UI/WorldUI/WorldUI.rcss",
  "GameData/UI/WorldUI/EventButtons/BaseEventButton.rml",
  "GameData/UI/WorldUI/EventButtons/EventButtons.rcss",
  "game/gui_sn1.rttex",
  "game/gui_sn2.rttex",
  "game/gui_sn3.rttex",
  "game/gui_sn4.rttex",
  "game/gui_sn5.rttex",
  "game/gui_sn6.rttex",
  "game/gui_sn_bg.rttex",
];

function repoRoot() {
  return resolve(process.cwd(), "..", "..");
}

function requestLogPath() {
  return join(repoRoot(), ".cache", "logon-requests.log");
}

function appendRequestLog(line: string) {
  const path = requestLogPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${line}\n`);
}

function growtopiaCacheRoot() {
  return join(repoRoot(), "apps", "server", ".cache", "growtopia");
}

function localCdnRoots() {
  return [
    join(repoRoot(), "monotopia-cache", "public", "growtopia"),
    "C:/Users/krish/Desktop/Monotopia/monotopia-cache/public/growtopia",
    "C:/Users/krish/Desktop/Monotopia Cache/public/growtopia",
  ];
}

function cdnSourceName(path: string) {
  const resolvedPath = resolve(path).toLowerCase();
  const serverRoot = resolve(growtopiaCacheRoot()).toLowerCase();

  if (resolvedPath.startsWith(serverRoot)) return "server-cache";

  for (const root of localCdnRoots()) {
    if (resolvedPath.startsWith(resolve(root).toLowerCase()))
      return basename(resolve(root, "..", ".."));
  }

  return "unknown-cache";
}

function latestItemsDatPath(osx = false) {
  const datDir = join(growtopiaCacheRoot(), "dat");
  if (!existsSync(datDir)) return "";

  const files = readdirSync(datDir)
    .map((file) => {
      const match = file.match(/^items-v(\d+\.\d+)(-osx)?\.dat$/i);
      if (!match) return null;
      if (osx !== Boolean(match[2])) return null;

      return {
        file,
        version: parseFloat(match[1]),
      };
    })
    .filter((file): file is { file: string; version: number } => !!file)
    .sort((a, b) => b.version - a.version);

  return files[0] ? join(datDir, files[0].file) : "";
}

function safeCdnRelativePath(path: string) {
  const decoded = decodeURIComponent(path.replace(/^\/growtopia\/?/i, ""));
  const parts = decoded
    .split(/[\\/]+/)
    .filter((part) => part && part !== "." && part !== "..");

  return parts.length ? join(...parts) : "";
}

function resolveCdnAsset(path: string) {
  const relativePath = safeCdnRelativePath(path);
  if (!relativePath) return "";

  const root = growtopiaCacheRoot();
  const fileName = basename(relativePath);
  const isItemsDat = /^items(?:-v\d+\.\d+)?(?:-osx)?\.dat$/i.test(fileName);
  const candidates = [
    ...localCdnRoots().map((localRoot) => join(localRoot, relativePath)),
    join(root, relativePath),
  ];

  if (isItemsDat) {
    const osx = /-osx\.dat$/i.test(fileName);
    candidates.push(join(root, "dat", fileName));

    if (/^items(?:-osx)?\.dat$/i.test(fileName)) {
      const latest = latestItemsDatPath(osx);
      if (latest) candidates.push(latest);
    }
  }

  return (
    candidates.find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    ) ?? ""
  );
}

async function proxyCdnAsset(ctx: Context) {
  const relativePath = safeCdnRelativePath(ctx.req.path);
  const cachePath = relativePath
    ? join(growtopiaCacheRoot(), relativePath)
    : "";
  const upstreamUrl = `${CDN_UPSTREAM}${ctx.req.path}`;
  const upstreamHeaders = new Headers();

  for (const header of [
    "accept",
    "accept-encoding",
    "if-match",
    "if-modified-since",
    "if-none-match",
    "if-range",
    "range",
    "user-agent",
  ]) {
    const value = ctx.req.header(header);
    if (value) upstreamHeaders.set(header, value);
  }

  const response = await fetch(upstreamUrl, {
    method: ctx.req.method,
    headers: upstreamHeaders,
    redirect: "follow",
  });

  appendRequestLog(
    `${new Date().toISOString()} CDN ${response.status} ${ctx.req.path} -> ${upstreamUrl}`,
  );

  if (!response.ok) {
    logger.warn(`Upstream CDN failed: ${response.status} ${upstreamUrl}`);
    return new Response(
      ctx.req.method === "HEAD" ? null : await response.text(),
      {
        status: response.status,
        headers: {
          "Content-Type": response.headers.get("content-type") ?? "text/plain",
        },
      },
    );
  }

  logger.info(`Proxying CDN asset: ${ctx.req.path}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, body);
  }

  const headers = {
    "Content-Length": `${body.length}`,
    "Content-Type":
      response.headers.get("content-type") ?? "application/octet-stream",
  };

  return new Response(ctx.req.method === "HEAD" ? null : body, {
    status: response.status,
    headers,
  });
}

async function cacheCdnAsset(relativePath: string) {
  const safePath = safeCdnRelativePath(`/growtopia/${relativePath}`);
  if (!safePath) return;

  const cachePath = join(growtopiaCacheRoot(), safePath);
  if (/^GameData[\\/]Configs[\\/]FeatureEnableFlags\.yaml$/i.test(safePath)) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${FEATURE_ENABLE_FLAGS_YAML}\n`);
    appendRequestLog(
      `${new Date().toISOString()} CDN-PREWARM 200 /growtopia/${relativePath} -> generated feature flags`,
    );
    return;
  }

  const localPath = localCdnRoots()
    .map((root) => join(root, safePath))
    .find((path) => existsSync(path) && statSync(path).isFile());

  if (localPath) {
    appendRequestLog(
      `${new Date().toISOString()} CDN-PREWARM 200 /growtopia/${relativePath} -> ${localPath}`,
    );
    return;
  }

  if (existsSync(cachePath)) return;

  const upstreamUrl = `${CDN_UPSTREAM}/growtopia/${relativePath.replace(/\\/g, "/")}`;
  const response = await fetch(upstreamUrl);
  appendRequestLog(
    `${new Date().toISOString()} CDN-PREWARM ${response.status} /growtopia/${relativePath} -> ${upstreamUrl}`,
  );
  if (!response.ok) return;

  const body = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, body);
}

async function prewarmCriticalCdnAssets() {
  await Promise.allSettled(
    CRITICAL_CDN_ASSETS.map((asset) => cacheCdnAsset(asset)),
  );
}

async function init() {
  const app = new Hono();
  const buns = process.versions.bun ? await import("hono/bun") : undefined;
  const db = new Database();

  const authError = (ctx: Context, message: string, cause?: unknown) => {
    if (cause) logger.warn(`${message}: ${cause}`);
    return ctx.html(
      JSON.stringify({
        status: "failed",
        message,
        token: "",
        url: "",
        accountType: "growtopia",
        accountAge: 2,
      }),
      200,
      {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Expires: "0",
        Pragma: "no-cache",
      },
    );
  };

  const authSuccess = (ctx: Context, token: string) =>
    ctx.html(
      JSON.stringify({
        status: "success",
        message: "Account Validated.",
        token,
        url: "",
        accountType: "growtopia",
        accountAge: 2,
      }),
      200,
      {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Expires: "0",
        Pragma: "no-cache",
      },
    );

  const linkDashboardValidatePath = (token: string) =>
    `/player/link/dashboard/validate/${encodeURIComponent(token)}/growtopia`;

  const getCredentials = async (ctx: Context) => {
    const contentType = ctx.req.header("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = await ctx.req.json();
      return {
        growId: body.data?.growId ?? body.growId,
        password: body.data?.password ?? body.password,
      };
    }

    const formData = await ctx.req.formData();
    return {
      growId: formData.get("growId")?.toString(),
      password: formData.get("password")?.toString(),
    };
  };

  const legacyLoginHtml = () => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Growtopia Login</title>
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        font-family: Arial, sans-serif;
        background: #101521;
        color: #ffffff;
      }

      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      form {
        width: 320px;
        padding: 24px;
        background: #1c2433;
        border: 1px solid #33415c;
        border-radius: 6px;
      }

      h1 {
        margin: 0 0 18px;
        font-size: 22px;
        font-weight: 700;
        text-align: center;
      }

      input {
        width: 100%;
        box-sizing: border-box;
        margin-bottom: 12px;
        padding: 12px;
        border: 1px solid #536178;
        border-radius: 4px;
        font-size: 16px;
      }

      button {
        width: 100%;
        padding: 12px;
        border: 0;
        border-radius: 4px;
        background: #2374ff;
        color: #ffffff;
        font-size: 16px;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <form method="POST" action="/player/growid/login/validate" autocomplete="off">
      <h1>Growtopia Login</h1>
      <input name="growId" type="text" placeholder="GrowID" required>
      <input name="password" type="password" placeholder="Password" required>
      <button type="submit">Log in</button>
    </form>
  </body>
</html>`;

  const validateGrowId = async (
    ctx: Context,
    options: { redirectToDashboard?: boolean } = {},
  ) => {
    try {
      const { growId, password } = await getCredentials(ctx);

      if (!growId || !password)
        return authError(ctx, "Missing GrowID or password.");

      const user = await db.players.get(growId.toLowerCase());
      if (!user)
        return authError(
          ctx,
          "GrowID not found. Register first or use an existing account.",
        );

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) return authError(ctx, "Password invalid.");

      const token = jwt.sign(
        { growId, password },
        process.env.JWT_SECRET as string,
      );

      if (options.redirectToDashboard)
        return ctx.redirect(linkDashboardValidatePath(token));

      return authSuccess(ctx, token);
    } catch (e) {
      return authError(ctx, "Unable to validate login request.", e);
    }
  };

  const contentTypeFor = (filePath: string) => {
    switch (extname(filePath).toLowerCase()) {
      case ".json":
        return "application/json";
      case ".ogg":
        return "audio/ogg";
      case ".wav":
        return "audio/wav";
      case ".xml":
        return "application/xml";
      case ".yaml":
      case ".yml":
        return "text/yaml; charset=UTF-8";
      case ".rcss":
      case ".rml":
      case ".txt":
      case ".lua":
        return "text/plain; charset=UTF-8";
      case ".ttf":
        return "font/ttf";
      default:
        return "application/octet-stream";
    }
  };

  const cdnFileResponse = (ctx: Context, localPath: string) => {
    const stat = statSync(localPath);
    if (!stat.isFile()) return undefined;

    const range = ctx.req.header("range");
    const baseHeaders = {
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=300",
      "Content-Type": contentTypeFor(localPath),
      ETag: `"${stat.size}-${Math.floor(stat.mtimeMs)}"`,
      "Last-Modified": stat.mtime.toUTCString(),
    };

    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match) {
        return ctx.body(null, 416, {
          ...baseHeaders,
          "Content-Range": `bytes */${stat.size}`,
        });
      }

      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= stat.size
      ) {
        return ctx.body(null, 416, {
          ...baseHeaders,
          "Content-Range": `bytes */${stat.size}`,
        });
      }

      const safeEnd = Math.min(end, stat.size - 1);
      const length = safeEnd - start + 1;
      const headers = {
        ...baseHeaders,
        "Content-Length": `${length}`,
        "Content-Range": `bytes ${start}-${safeEnd}/${stat.size}`,
      };

      if (ctx.req.method === "HEAD") return ctx.body(null, 206, headers);

      return ctx.body(
        readFileSync(localPath).subarray(start, safeEnd + 1),
        206,
        headers,
      );
    }

    const headers = {
      ...baseHeaders,
      "Content-Length": `${stat.size}`,
    };

    if (ctx.req.method === "HEAD") return ctx.body(null, 200, headers);

    return ctx.body(readFileSync(localPath), 200, headers);
  };

  const cdnResponse = async (ctx: Context) => {
    const assetPath = safeCdnRelativePath(ctx.req.path);

    if (!assetPath || assetPath === "server_data.php") return ctx.notFound();

    if (
      /^GameData[\\/]Configs[\\/]FeatureEnableFlags\.yaml$/i.test(assetPath)
    ) {
      appendRequestLog(
        `${new Date().toISOString()} CDN-HIT generated ${ctx.req.path}`,
      );
      return ctx.text(`${FEATURE_ENABLE_FLAGS_YAML}\n`, 200, {
        "Content-Type": "text/yaml; charset=UTF-8",
      });
    }

    const localPath = resolveCdnAsset(ctx.req.path);
    if (localPath) {
      appendRequestLog(
        `${new Date().toISOString()} CDN-HIT ${cdnSourceName(localPath)} ${ctx.req.path} -> ${localPath}`,
      );
      logger.info(
        `Serving CDN asset from ${cdnSourceName(localPath)}: ${ctx.req.path}`,
      );
      return cdnFileResponse(ctx, localPath);
    }

    if (assetPath === "player_tribute.dat") {
      const headers = {
        "Cache-Control": "public, max-age=300",
        "Content-Length": "0",
        "Content-Type": "application/octet-stream",
      };

      if (ctx.req.method === "HEAD") return ctx.body(null, 200, headers);

      return ctx.body(Buffer.alloc(0), 200, headers);
    }

    return proxyCdnAsset(ctx);
  };

  const checkToken = async (ctx: Context) => {
    try {
      const query = ctx.req.query();
      const contentType = ctx.req.header("content-type") ?? "";
      let refreshToken: string | undefined =
        query.refreshToken ?? query.token ?? query.valkey;

      if (!refreshToken && contentType.includes("application/json")) {
        const body = await ctx.req.json();
        refreshToken =
          body.refreshToken ??
          body.token ??
          body.valkey ??
          body.data?.refreshToken ??
          body.data?.token ??
          body.data?.valkey;
      }

      if (
        !refreshToken &&
        ctx.req.method === "POST" &&
        (contentType.includes("application/x-www-form-urlencoded") ||
          contentType.includes("multipart/form-data"))
      ) {
        const formData = (await ctx.req.formData()) as FormData;
        refreshToken =
          formData.get("refreshToken")?.toString() ??
          formData.get("token")?.toString() ??
          formData.get("valkey")?.toString();
      }

      if (!refreshToken)
        return authError(ctx, "No saved login token. Please log in again.");

      const token = refreshToken;
      jwt.verify(token, process.env.JWT_SECRET as string);

      return ctx.redirect(linkDashboardValidatePath(token));
    } catch (e) {
      return authError(
        ctx,
        "Saved login token is invalid. Please log in again.",
        e,
      );
    }
  };

  const validateDashboardToken = (ctx: Context) => {
    try {
      const token =
        ctx.req.param("token") ??
        decodeURIComponent(
          ctx.req.path
            .slice("/player/link/dashboard/validate/".length)
            .split("/")[0] ?? "",
        );
      if (!token) throw new Error("No token provided");

      jwt.verify(token, process.env.JWT_SECRET as string);
      writeWebLoginToken(token);

      return authSuccess(ctx, token);
    } catch (e) {
      return authError(ctx, "Please try login again.", e);
    }
  };

  app.use("*", async (ctx, next) => {
    const method = ctx.req.method;
    const path = ctx.req.path;
    const url = new URL(ctx.req.url);
    appendRequestLog(
      `${new Date().toISOString()} ${method} ${url.hostname}${url.pathname}${url.search}`,
    );
    logger.info(`[${method}] ${path}`);
    await next();
  });

  const serverData = (ctx: Context) => {
    let str = "";

    str += `server|${config.web.address}\n`;

    const randPort =
      config.web.ports[Math.floor(Math.random() * config.web.ports.length)];

    str += `port|${randPort}\nloginurl|${config.web.loginUrl}\ntype|1\n${config.web.maintenance.enable ? "maint" : "#maint"}|
      ${config.web.maintenance.message}
      \ntype2|1\nmeta|ignoremeta\nRTENDMARKERBS1001`;

    return ctx.body(str);
  };

  void prewarmCriticalCdnAssets();

  app.get("/growtopia/server_data.php", serverData);
  app.post("/growtopia/server_data.php", serverData);

  app.on(["GET", "HEAD"], "/growtopia/*", cdnResponse);

  app.get("/player/login/dashboard", (ctx) => ctx.html(legacyLoginHtml()));
  app.post("/player/login/dashboard", (ctx) =>
    ctx.redirect("/player/growid/login"),
  );
  app.get("/player/login/dashboard/*", (ctx) => ctx.html(legacyLoginHtml()));
  app.post("/player/login/dashboard/*", (ctx) =>
    ctx.redirect("/player/growid/login"),
  );

  app.get("/player/growid/login", (ctx) => {
    return ctx.html(legacyLoginHtml());
  });

  app.get("/player/growid/login/validate", (ctx) => {
    const token = ctx.req.query("token");
    if (!token) return ctx.redirect("/player/login/dashboard");

    return ctx.redirect(linkDashboardValidatePath(token));
  });
  app.post("/player/login/validate", (ctx) => validateGrowId(ctx));
  app.post("/player/growid/login/validate", (ctx) =>
    validateGrowId(ctx, { redirectToDashboard: true }),
  );
  app.on(["GET", "POST"], "/player/growid/checktoken", checkToken);
  app.get("/player/link/dashboard/validate/:token", validateDashboardToken);
  app.get("/player/link/dashboard/validate/*", validateDashboardToken);

  const ssl = logon();

  if (process.env.RUNTIME_ENV === "node") {
    serve(
      {
        fetch: app.fetch,
        createServer,
        serverOptions: {
          key: ssl.tls.key,
          cert: ssl.tls.cert,
        },
        port: config.web.port,
      },
      (info) => {
        logger.info(`Node Logon Server is running on port ${info.port}`);
      },
    );
  } else if (process.env.RUNTIME_ENV === "bun") {
    logger.info(`Bun Logon Server is running on port ${config.web.port}`);
    Bun.serve({
      fetch: app.fetch,
      port: config.web.port,
      tls: {
        key: ssl.tls.key,
        cert: ssl.tls.cert,
      },
    });
  }
}

init();
