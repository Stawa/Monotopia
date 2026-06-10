import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { config, logon } from "@monotopia/config";
import { homedir } from "os";
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import logger from "@monotopia/logger";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Database } from "@monotopia/db";
import { isIP } from "net";
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
import { writeWebLoginToken } from "@monotopia/utils";

const DEFAULT_CDN_UPSTREAM = "https://monotopia-cache.netlify.app";
const CDN_UPSTREAM = process.env.CDN_UPSTREAM || DEFAULT_CDN_UPSTREAM;
const HOSTS_TXT_DOMAINS = [
  "www.growtopia1.com",
  "www.growtopia2.com",
  "login.growtopiagame.com",
];
const LOGIN_HOST_DOMAINS = [
  "login.growtopiagame.com",
];
const FEATURE_ENABLE_FLAGS_YAML = [
  "EnableSQLChatFilter: 'true'",
  "ChatFilterWebApiOverride: api.growtopiagame.com",
  "EnableNewFTUE: 'false'",
  "EnableNewFTU: 'false'",
  "EnableProfileHUD: 'true'",
  "EnableStore: 'true'",
  "EnableCommunityButton: 'true'",
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
  "game/vilpix.rttex",
  "GameData/Configs/FeatureEnableFlags.yaml",
  "GameData/UI/StartScreen.rcss",
  "GameData/UI/EventPanel.rml",
  "GameData/UI/EventPanel.rcss",
  "GameData/UI/WorldUI.rml",
  "GameData/UI/WorldUI.rcss",
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

function unwrapFeatureFlag(body: string, flagId: string) {
  const pattern = new RegExp(
    `<FeatureEnableFlag flag-id="${flagId}">\\s*([\\s\\S]*?)\\s*<\\/FeatureEnableFlag>`,
    "g",
  );

  return body.replace(pattern, "$1");
}

function patchRightMenuPanelRml(body: string) {
  return ["EnableProfileHUD", "EnableCommunityButton", "EnableStore"].reduce(
    (patchedBody, flagId) => unwrapFeatureFlag(patchedBody, flagId),
    body,
  );
}

function patchRootWorldUiRml(body: string) {
  let patchedBody = body;

  if (!patchedBody.includes('href="WorldUI/RightMenuPanel.rml"')) {
    patchedBody = patchedBody.replace(
      /(\s*<link\s+type="text\/template"\s+href="EventPanel\.rml"\s*\/>\s*)/i,
      `$1        <link type="text/template" href="WorldUI/RightMenuPanel.rml" />\n`,
    );
  }

  if (!patchedBody.includes('template src="RightMenuPanel"')) {
    patchedBody = patchedBody.replace(
      /\s*<\/body>/i,
      `\n        <div id="right_panel">\n            <template src="RightMenuPanel" />\n        </div>\n    </body>`,
    );
  }

  return patchedBody;
}

function patchWorldUiRcss(body: string) {
  if (body.includes("decorator: image(dungeonAvatar0);")) return body;

  return body.replace(
    /(\.avatar\s*\{\s*)/i,
    "$1\n    decorator: image(dungeonAvatar0);",
  );
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
  const authHeaders = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Expires: "0",
    Pragma: "no-cache",
  };

  const firstString = (...values: unknown[]) =>
    values.find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );

  type AuthView = "login" | "register";

  type AuthPageOptions = {
    message?: string;
    growId?: string;
  };

  const escapeHtml = (value = "") =>
    value.replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });

  const shouldRenderAuthPage = (ctx: Context) => {
    const contentType = ctx.req.header("content-type") ?? "";
    const accept = ctx.req.header("accept") ?? "";

    if (contentType.includes("application/json")) return false;
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    )
      return true;

    return accept.includes("text/html");
  };

  const authError = (
    ctx: Context,
    message: string,
    cause?: unknown,
    page?: AuthPageOptions & { view: AuthView },
  ) => {
    if (cause) logger.warn(`${message}: ${cause}`);
    if (page && shouldRenderAuthPage(ctx))
      return ctx.html(
        authPageHtml(page.view, {
          growId: page.growId,
          message,
        }),
        200,
        authHeaders,
      );

    return ctx.json(
      {
        status: "failed",
        message,
        token: "",
        ltoken: "",
        refreshToken: "",
        valkey: "",
        url: "",
        accountType: "growtopia",
        accountAge: 2,
      },
      200,
      authHeaders,
    );
  };

  const authSuccess = (ctx: Context, token: string) =>
    ctx.html(
      JSON.stringify({
        status: "success",
        message: "Account Validated.",
        token,
        ltoken: token,
        refreshToken: token,
        valkey: token,
        url: "",
        accountType: "growtopia",
        accountAge: 2,
      }),
      200,
      authHeaders,
    );

  const clientLoginValidatePath = (token: string) =>
    `/player/growid/login/validate?token=${encodeURIComponent(token)}`;

  type NodeSocketEnv = {
    incoming?: {
      socket?: {
        localAddress?: string;
        remoteAddress?: string;
      };
    };
    server?: NodeSocketEnv;
  };

  const nodeSocket = (ctx: Context) => {
    const env = ctx.env as unknown as NodeSocketEnv;
    return (env.server ?? env).incoming?.socket;
  };

  const getCredentials = async (ctx: Context) => {
    const contentType = ctx.req.header("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = await ctx.req.json();
      return {
        growId: body.data?.growId ?? body.growId,
        password: body.data?.password ?? body.password,
        confirmPassword: body.data?.confirmPassword ?? body.confirmPassword,
      };
    }

    const formData = await ctx.req.formData();
    return {
      growId: formData.get("growId")?.toString(),
      password: formData.get("password")?.toString(),
      confirmPassword: formData.get("confirmPassword")?.toString(),
    };
  };

  const authPageHtml = (
    view: AuthView = "login",
    options: AuthPageOptions = {},
  ) => {
    const isRegister = view === "register";
    const title = isRegister
      ? "Create your Grow ID"
      : "Log in with your Grow ID";
    const formAction = isRegister
      ? "/player/signup"
      : "/player/growid/login/validate";
    const submitText = isRegister ? "Register" : "Log in";
    const switchCopy = isRegister
      ? "Already have an account?"
      : "Need a Grow ID?";
    const switchHref = isRegister ? "/player/growid/login" : "/player/signup";
    const switchLabel = isRegister ? "Log in" : "Register";
    const growIdAutocomplete = isRegister ? "off" : "username";
    const passwordAutocomplete = isRegister
      ? "new-password"
      : "current-password";
    const errorMessage = options.message
      ? `<div class="auth-alert" role="alert">${escapeHtml(options.message)}</div>`
      : "";
    const growIdValue = options.growId
      ? ` value="${escapeHtml(options.growId)}"`
      : "";
    const confirmPasswordField = isRegister
      ? `<label>
          <span>Confirm password</span>
          <input name="confirmPassword" type="password" placeholder="Confirm your password *" autocomplete="new-password" required>
        </label>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} | Monotopia</title>
    <style>
      :root {
        color-scheme: dark;
        --panel: #173d5b;
        --panel-dark: #102f47;
        --panel-light: #215b79;
        --line: #a9e7f6;
        --line-soft: rgba(132, 201, 221, 0.55);
        --input: #155f75;
        --input-focus: #1f7388;
        --button: #1ec7ee;
        --button-dark: #0eaad1;
        --yellow: #f3cf2f;
        --yellow-dark: #d2ad17;
        --text: #ffffff;
        --muted: #e6f8ff;
        --danger: #ff8176;
        --text-shadow-strong:
          -1px -1px 0 rgba(0, 0, 0, 0.55),
          1px -1px 0 rgba(0, 0, 0, 0.55),
          -1px 1px 0 rgba(0, 0, 0, 0.55),
          1px 1px 0 rgba(0, 0, 0, 0.55),
          0 3px 0 rgba(0, 0, 0, 0.48);
        --text-shadow-soft:
          -1px -1px 0 rgba(0, 0, 0, 0.42),
          1px -1px 0 rgba(0, 0, 0, 0.42),
          -1px 1px 0 rgba(0, 0, 0, 0.42),
          1px 1px 0 rgba(0, 0, 0, 0.42),
          0 2px 0 rgba(0, 0, 0, 0.38);
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", Arial, sans-serif;
        color: var(--text);
      }

      body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        box-sizing: border-box;
      }

      main {
        width: min(720px, 100%);
        box-sizing: border-box;
        padding: 38px 48px 40px;
        border: 5px solid var(--line);
        border-radius: 6px;
        background:
          linear-gradient(180deg, rgba(38, 91, 123, 0.96), rgba(18, 56, 85, 0.98)),
          var(--panel);
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.22) inset,
          0 20px 52px rgba(0, 0, 0, 0.48);
      }

      form {
        margin: 0 auto;
        max-width: 520px;
      }

      form h2 {
        margin: 0 0 24px;
        color: var(--text);
        font-size: 36px;
        line-height: 1.2;
        font-weight: 800;
        letter-spacing: 0;
        text-align: center;
        text-shadow: var(--text-shadow-strong);
      }

      .auth-alert {
        box-sizing: border-box;
        width: 100%;
        margin: 0 0 14px;
        padding: 13px 18px;
        border-radius: 4px;
        background: #ffc9d4;
        color: #a04a55;
        font-size: 16px;
        font-weight: 800;
        line-height: 1.45;
        text-shadow: none;
      }

      label {
        display: block;
        margin-bottom: 16px;
      }

      label span {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      input {
        width: 100%;
        box-sizing: border-box;
        min-height: 54px;
        padding: 13px 18px;
        border: 2px solid var(--line);
        border-radius: 4px;
        background: var(--input);
        color: var(--text);
        font-size: 17px;
        font-weight: 800;
        outline: none;
        text-shadow: var(--text-shadow-soft);
        transition:
          border-color 160ms ease,
          box-shadow 160ms ease,
          background-color 160ms ease;
      }

      input::placeholder {
        color: rgba(255, 255, 255, 0.94);
        opacity: 1;
        text-shadow: var(--text-shadow-soft);
      }

      input:focus {
        border-color: #b8f0ff;
        background: var(--input-focus);
        box-shadow: 0 0 0 3px rgba(31, 199, 238, 0.18);
      }

      button {
        width: 100%;
        min-height: 52px;
        margin-top: 8px;
        padding: 12px 18px;
        border: 0;
        border-radius: 4px;
        background: var(--button);
        color: var(--text);
        font-size: 17px;
        font-weight: 800;
        cursor: pointer;
        text-shadow: var(--text-shadow-strong);
        box-shadow:
          0 3px 0 #08799a,
          0 0 0 2px rgba(255, 255, 255, 0.25) inset;
        transition:
          background-color 160ms ease,
          transform 160ms ease,
          box-shadow 160ms ease;
      }

      button:hover {
        background: var(--button-dark);
        transform: translateY(-1px);
      }

      button:active {
        box-shadow:
          0 1px 0 #08799a,
          0 0 0 2px rgba(255, 255, 255, 0.2) inset;
        transform: translateY(2px);
      }

      .switcher {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-top: 24px;
        color: var(--muted);
        font-size: 16px;
        font-weight: 700;
        text-shadow: var(--text-shadow-soft);
      }

      .switcher a {
        min-width: 120px;
        box-sizing: border-box;
        padding: 10px 18px;
        border-radius: 4px;
        background: var(--yellow);
        color: #ffffff;
        font-weight: 800;
        text-align: center;
        text-decoration: none;
        text-shadow: var(--text-shadow-strong);
        box-shadow:
          0 3px 0 #9c7f0c,
          0 0 0 2px rgba(255, 255, 255, 0.24) inset;
        transition: transform 160ms ease, background-color 160ms ease;
      }

      .switcher a:hover {
        background: var(--yellow-dark);
        transform: translateY(-1px);
      }

      @media (max-width: 760px) {
        body {
          min-height: 100%;
          padding: 12px;
        }

        main {
          padding: 26px 20px 28px;
        }

        form h2 {
          font-size: 30px;
        }

        .switcher {
          flex-direction: column;
        }

        .switcher a {
          width: 100%;
        }
      }

      @media (max-height: 440px) {
        body {
          align-items: flex-start;
          padding: 8px 12px;
        }

        main {
          padding: 18px 36px 20px;
          border-width: 4px;
        }

        form h2 {
          margin-bottom: 14px;
          font-size: 30px;
        }

        label {
          margin-bottom: 10px;
        }

        input {
          min-height: 48px;
          padding: 10px 16px;
          font-size: 16px;
        }

        button {
          min-height: 46px;
          margin-top: 4px;
          padding: 10px 18px;
          font-size: 16px;
        }

        .switcher {
          flex-direction: row;
          margin-top: 14px;
        }

        .switcher a {
          width: auto;
          padding: 8px 18px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <form method="POST" action="${formAction}" autocomplete="off">
        <h2>${title}</h2>
        ${errorMessage}
        <label>
          <span>Grow ID</span>
          <input name="growId" type="text" placeholder="Your Growtopia Name *" autocomplete="${growIdAutocomplete}"${growIdValue} required>
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" placeholder="Your Growtopia Password *" autocomplete="${passwordAutocomplete}" required>
        </label>
        ${confirmPasswordField}
        <button type="submit">${submitText}</button>
        <div class="switcher">
          <span>${switchCopy}</span>
          <a href="${switchHref}">${switchLabel}</a>
        </div>
      </form>
    </main>
  </body>
</html>`;
  };

  const validateGrowId = async (
    ctx: Context,
    options: { redirectToDashboard?: boolean } = {},
  ) => {
    const shouldRenderLoginPage =
      options.redirectToDashboard || ctx.req.path.includes("/growid/");
    const loginErrorPage = (growId?: string) =>
      shouldRenderLoginPage ? { view: "login" as const, growId } : undefined;

    try {
      const { growId, password } = await getCredentials(ctx);

      if (!growId || !password)
        return authError(
          ctx,
          "Missing GrowID or password.",
          undefined,
          loginErrorPage(growId),
        );

      const user = await db.players.get(growId.toLowerCase());
      if (!user)
        return authError(
          ctx,
          "GrowID not found. Register first or use an existing account.",
          undefined,
          loginErrorPage(growId),
        );

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid)
        return authError(
          ctx,
          "Password invalid.",
          undefined,
          loginErrorPage(growId),
        );

      const token = createLoginToken(ctx, growId, password);

      if (options.redirectToDashboard)
        return ctx.redirect(clientLoginValidatePath(token));

      return authSuccess(ctx, token);
    } catch (e) {
      return authError(
        ctx,
        "Unable to validate login request.",
        e,
        loginErrorPage(),
      );
    }
  };

  const createGrowId = async (ctx: Context) => {
    try {
      const { growId, password, confirmPassword } = await getCredentials(ctx);
      const contentType = ctx.req.header("content-type") ?? "";
      const registerErrorPage = (submittedGrowId?: string) => ({
        view: "register" as const,
        growId: submittedGrowId,
      });

      if (!growId || !password || !confirmPassword)
        return authError(
          ctx,
          "Missing GrowID, password, or confirmation.",
          undefined,
          registerErrorPage(growId),
        );

      const cleanGrowId = growId.trim();
      if (!/^[A-Za-z0-9_]{3,18}$/.test(cleanGrowId))
        return authError(
          ctx,
          "GrowID must be 3-18 characters using letters, numbers, or underscore.",
          undefined,
          registerErrorPage(cleanGrowId),
        );

      const user = await db.players.get(cleanGrowId.toLowerCase());
      if (user)
        return authError(
          ctx,
          "GrowID already exists.",
          undefined,
          registerErrorPage(cleanGrowId),
        );

      if (password !== confirmPassword)
        return authError(
          ctx,
          "Password and Confirm Password does not match.",
          undefined,
          registerErrorPage(cleanGrowId),
        );

      await db.players.set(cleanGrowId, password);

      const token = createLoginToken(ctx, cleanGrowId, password);

      jwt.verify(token, process.env.JWT_SECRET as string);

      if (!contentType.includes("application/json"))
        return ctx.redirect(clientLoginValidatePath(token));

      return authSuccess(ctx, token);
    } catch (e) {
      return authError(ctx, "Unable to sign up.", e, {
        view: "register",
      });
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
    const noStoreExtensions = new Set([".rml", ".rcss", ".yaml", ".yml"]);
    const shouldNoStore = noStoreExtensions.has(
      extname(localPath).toLowerCase(),
    );
    const baseHeaders: Record<string, string> = {
      "Accept-Ranges": "bytes",
      "Cache-Control": shouldNoStore
        ? "no-store, no-cache, must-revalidate, max-age=0"
        : "public, max-age=300",
      "Content-Type": contentTypeFor(localPath),
      ETag: `"${stat.size}-${Math.floor(stat.mtimeMs)}"`,
      "Last-Modified": stat.mtime.toUTCString(),
    };
    if (shouldNoStore) {
      baseHeaders.Expires = "0";
      baseHeaders.Pragma = "no-cache";
    }

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
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Content-Type": "text/yaml; charset=UTF-8",
        Expires: "0",
        Pragma: "no-cache",
      });
    }

    if (
      /^GameData[\\/]UI[\\/]WorldUI[\\/]RightMenuPanel\.rml$/i.test(assetPath)
    ) {
      const localPath = resolveCdnAsset(ctx.req.path);
      if (localPath) {
        const body = patchRightMenuPanelRml(readFileSync(localPath, "utf-8"));
        appendRequestLog(
          `${new Date().toISOString()} CDN-HIT patched ${ctx.req.path} -> ${localPath}`,
        );
        return ctx.text(body, 200, {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          "Content-Type": "text/plain; charset=UTF-8",
          Expires: "0",
          Pragma: "no-cache",
        });
      }
    }

    if (/^GameData[\\/]UI[\\/]WorldUI\.rml$/i.test(assetPath)) {
      const localPath = resolveCdnAsset(ctx.req.path);
      if (localPath) {
        const body = patchRootWorldUiRml(readFileSync(localPath, "utf-8"));
        appendRequestLog(
          `${new Date().toISOString()} CDN-HIT patched ${ctx.req.path} -> ${localPath}`,
        );
        return ctx.text(body, 200, {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          "Content-Type": "text/plain; charset=UTF-8",
          Expires: "0",
          Pragma: "no-cache",
        });
      }
    }

    if (/^GameData[\\/]UI[\\/]WorldUI[\\/]WorldUI\.rcss$/i.test(assetPath)) {
      const localPath = resolveCdnAsset(ctx.req.path);
      if (localPath) {
        const body = patchWorldUiRcss(readFileSync(localPath, "utf-8"));
        appendRequestLog(
          `${new Date().toISOString()} CDN-HIT patched ${ctx.req.path} -> ${localPath}`,
        );
        return ctx.text(body, 200, {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          "Content-Type": "text/plain; charset=UTF-8",
          Expires: "0",
          Pragma: "no-cache",
        });
      }
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
      let refreshToken: string | undefined = firstString(
        query.refreshToken,
        query.token,
        query.ltoken,
        query.LToken,
        query.valkey,
      );

      if (!refreshToken && contentType.includes("application/json")) {
        const body = await ctx.req.json();
        refreshToken = firstString(
          body.refreshToken,
          body.token,
          body.ltoken,
          body.LToken,
          body.valkey,
          body.data?.refreshToken,
          body.data?.token,
          body.data?.ltoken,
          body.data?.LToken,
          body.data?.valkey,
        );
      }

      if (
        !refreshToken &&
        ctx.req.method === "POST" &&
        (contentType.includes("application/x-www-form-urlencoded") ||
          contentType.includes("multipart/form-data"))
      ) {
        const formData = (await ctx.req.formData()) as FormData;
        refreshToken = firstString(
          formData.get("refreshToken")?.toString(),
          formData.get("token")?.toString(),
          formData.get("ltoken")?.toString(),
          formData.get("LToken")?.toString(),
          formData.get("valkey")?.toString(),
        );
      }

      if (!refreshToken)
        return authError(ctx, "No saved login token. Please log in again.");

      const data = jwt.verify(
        refreshToken,
        process.env.JWT_SECRET as string,
      ) as { growId?: string; password?: string };
      const token =
        data.growId && data.password
          ? createLoginToken(ctx, data.growId, data.password)
          : refreshToken;

      return ctx.redirect(clientLoginValidatePath(token));
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
      const prefix = "/player/link/dashboard/validate/";
      const pathToken = ctx.req.path.startsWith(prefix)
        ? decodeURIComponent(
            ctx.req.path.slice(prefix.length).split("/")[0] ?? "",
          )
        : "";
      const token = firstString(
        ctx.req.query("token"),
        ctx.req.query("ltoken"),
        ctx.req.query("LToken"),
        ctx.req.query("refreshToken"),
        ctx.req.query("valkey"),
        pathToken,
        ctx.req.param("token"),
      );

      if (!token) throw new Error("No token provided");

      jwt.verify(token, process.env.JWT_SECRET as string);
      writeWebLoginToken(token);

      return ctx.redirect(clientLoginValidatePath(token));
    } catch (e) {
      return authError(ctx, "Please try login again.", e);
    }
  };

  app.use("*", async (ctx, next) => {
    const method = ctx.req.method;
    const path = ctx.req.path;
    const url = new URL(ctx.req.url);
    logger.info(`[${method}] ${path}`);
    await next();
    appendRequestLog(
      `${new Date().toISOString()} ${method} ${url.hostname}${url.pathname}${url.search} -> ${ctx.res.status}`,
    );
  });

  const stripAddressBrackets = (address: string) =>
    address.trim().replace(/^\[|\]$/g, "");

  const normalizeAddress = (address = "") => {
    const cleanAddress = stripAddressBrackets(address);
    const ipv4Mapped = cleanAddress.match(
      /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i,
    );

    return ipv4Mapped?.[1] ?? cleanAddress;
  };

  const addressFamily = (address = "") => isIP(normalizeAddress(address));

  const isLocalAddress = (address = "") => {
    const normalizedAddress = normalizeAddress(address);

    return (
      normalizedAddress === "::1" ||
      normalizedAddress === "localhost" ||
      normalizedAddress.startsWith("127.")
    );
  };

  const preferIPv6 = (ctx?: Context) => {
    if (process.env.MONOTOPIA_PREFER_IPV6 === "1") return true;
    if (process.env.MONOTOPIA_PREFER_IPV6 === "0") return false;

    const remoteAddress = nodeSocket(ctx as Context)?.remoteAddress;
    return addressFamily(remoteAddress) === 6 && !isLocalAddress(remoteAddress);
  };

  const isLoopbackHost = (host: string) =>
    ["127.0.0.1", "localhost", "::1"].includes(normalizeAddress(host));

  const readHostsAddresses = () => {
    const addresses = {
      ipv4: [] as string[],
      ipv6: [] as string[],
    };
    const hostsPath = join(repoRoot(), "hosts.txt");
    if (!existsSync(hostsPath)) return addresses;

    for (const line of readFileSync(hostsPath, "utf-8").split(/\r?\n/)) {
      const cleanLine = line.replace(/#.*/, "").trim();
      if (!cleanLine) continue;

      const [rawAddress, ...domains] = cleanLine.split(/\s+/);
      const address = stripAddressBrackets(rawAddress);
      const family = isIP(address);
      const isGrowtopiaHost = domains.some((domain) =>
        HOSTS_TXT_DOMAINS.includes(domain.toLowerCase()),
      );
      if (!isGrowtopiaHost) continue;

      if (family === 4 && !addresses.ipv4.includes(address))
        addresses.ipv4.push(address);
      if (family === 6 && !addresses.ipv6.includes(address))
        addresses.ipv6.push(address);
    }

    return addresses;
  };

  const fallbackHostsAddress = (useIPv6 = false) => {
    const overrideAddress = process.env.MONOTOPIA_SERVER_ADDRESS?.trim();
    if (overrideAddress) return stripAddressBrackets(overrideAddress);

    const addresses = readHostsAddresses();
    if (useIPv6)
      return addresses.ipv6[0] ?? addresses.ipv4[0] ?? config.web.address;

    return addresses.ipv4[0] ?? addresses.ipv6[0] ?? config.web.address;
  };

  const clientServerAddress = (ctx: Context) =>
    fallbackHostsAddress(preferIPv6(ctx));

  const createLoginToken = (ctx: Context, growId: string, password: string) =>
    jwt.sign(
      {
        growId,
        password,
        serverAddress: clientServerAddress(ctx),
      },
      process.env.JWT_SECRET as string,
    );

  const serverData = (ctx: Context) => {
    let str = "";
    const requestHost = normalizeAddress(new URL(ctx.req.url).hostname);
    const configuredAddress = normalizeAddress(config.web.address);
    const requestFamily = isIP(requestHost);
    const serverAddress =
      isLoopbackHost(configuredAddress) &&
      requestHost &&
      !isLoopbackHost(requestHost)
        ? HOSTS_TXT_DOMAINS.includes(requestHost.toLowerCase())
          ? clientServerAddress(ctx)
          : requestFamily
            ? requestHost
            : clientServerAddress(ctx)
        : configuredAddress;

    str += `server|${serverAddress}\n`;

    const randPort =
      config.web.ports[Math.floor(Math.random() * config.web.ports.length)];

    const socket = nodeSocket(ctx);
    appendRequestLog(
      `${new Date().toISOString()} SERVER-DATA remote=${normalizeAddress(socket?.remoteAddress ?? "unknown")} local=${normalizeAddress(socket?.localAddress ?? "unknown")} host=${requestHost} server=${serverAddress}:${randPort}`,
    );

    str += `port|${randPort}\nloginurl|${config.web.loginUrl}\ntype|1\n${config.web.maintenance.enable ? "maint" : "#maint"}|
      ${config.web.maintenance.message}
      \ntype2|1\nmeta|ignoremeta\nRTENDMARKERBS1001`;

    return ctx.body(str);
  };

  const hostsTxt = (ctx: Context) => {
    const requestHost = stripAddressBrackets(new URL(ctx.req.url).hostname);
    const requestFamily = isIP(requestHost);
    const addresses = readHostsAddresses();
    const ipv4 =
      requestFamily === 4
        ? [requestHost]
        : addresses.ipv4.length
          ? addresses.ipv4
          : [fallbackHostsAddress(false)].filter(
              (address) => isIP(address) === 4,
            );
    const ipv6 =
      requestFamily === 6
        ? [requestHost]
        : addresses.ipv6.length
          ? addresses.ipv6
          : [fallbackHostsAddress(true)].filter(
              (address) => isIP(address) === 6,
            );
    const body = `${HOSTS_TXT_DOMAINS.flatMap((domain) => [
      ...ipv4.map((address) => `${address} ${domain}`),
      ...ipv6.map((address) => `${address} ${domain}`),
    ]).join("\n")}\n`;
    const headers = {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Content-Type": "text/plain; charset=UTF-8",
      Expires: "0",
      Pragma: "no-cache",
    };

    if (ctx.req.method === "HEAD") return ctx.body(null, 200, headers);

    return ctx.text(body, 200, headers);
  };

  const hostsTxtForFamily = (family: 4 | 6) => (ctx: Context) => {
    const addresses = readHostsAddresses();
    const selectedAddresses =
      family === 6
        ? addresses.ipv6.length
          ? addresses.ipv6
          : [fallbackHostsAddress(true)].filter(
              (address) => isIP(address) === 6,
            )
        : addresses.ipv4.length
          ? addresses.ipv4
          : [fallbackHostsAddress(false)].filter(
              (address) => isIP(address) === 4,
            );
    const body = `${HOSTS_TXT_DOMAINS.flatMap((domain) =>
      selectedAddresses.map((address) => `${address} ${domain}`),
    ).join("\n")}\n`;
    const headers = {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Content-Type": "text/plain; charset=UTF-8",
      Expires: "0",
      Pragma: "no-cache",
    };

    if (ctx.req.method === "HEAD") return ctx.body(null, 200, headers);

    return ctx.text(body, 200, headers);
  };

  const rootCa = (ctx: Context) => {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    const rootCaPath = join(localAppData, "mkcert", "rootCA.pem");

    if (!existsSync(rootCaPath)) return ctx.notFound();

    const headers = {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Content-Disposition": 'attachment; filename="monotopia-rootCA.pem"',
      "Content-Type": "application/x-x509-ca-cert",
      Expires: "0",
      Pragma: "no-cache",
    };

    if (ctx.req.method === "HEAD") return ctx.body(null, 200, headers);

    return ctx.body(readFileSync(rootCaPath), 200, headers);
  };

  const emptyFavicon = (ctx: Context) =>
    ctx.body(null, 204, {
      "Cache-Control": "public, max-age=86400",
    });
  const isLoginHost = (hostname: string) =>
    [config.web.loginUrl, ...LOGIN_HOST_DOMAINS].some(
      (domain) => domain.toLowerCase() === hostname.toLowerCase(),
    );

  void prewarmCriticalCdnAssets();

  app.on(["GET", "HEAD"], "/favicon.ico", emptyFavicon);
  app.on(["GET", "HEAD"], "/hosts.txt", hostsTxt);
  app.on(["GET", "HEAD"], "/growtopia/hosts.txt", hostsTxt);
  app.on(["GET", "HEAD"], "/hosts-ipv4.txt", hostsTxtForFamily(4));
  app.on(["GET", "HEAD"], "/growtopia/hosts-ipv4.txt", hostsTxtForFamily(4));
  app.on(["GET", "HEAD"], "/hosts-ipv6.txt", hostsTxtForFamily(6));
  app.on(["GET", "HEAD"], "/growtopia/hosts-ipv6.txt", hostsTxtForFamily(6));
  app.on(["GET", "HEAD"], "/rootCA.pem", rootCa);
  app.on(["GET", "HEAD"], "/rootCA.crt", rootCa);
  app.on(["GET", "POST"], "/server_data.php", serverData);
  app.on(["GET", "POST"], "/server_data.php/", serverData);
  app.on(["GET", "POST"], "/growtopia/server_data.php", serverData);
  app.on(["GET", "POST"], "/growtopia/server_data.php/", serverData);

  app.on(["GET", "HEAD"], "/growtopia/*", cdnResponse);

  app.get("/player/login/dashboard", (ctx) => ctx.html(authPageHtml("login")));
  app.post("/player/login/dashboard", (ctx) =>
    ctx.redirect("/player/growid/login"),
  );
  app.get("/player/login/dashboard/*", (ctx) =>
    ctx.html(authPageHtml("login")),
  );
  app.post("/player/login/dashboard/*", (ctx) =>
    ctx.redirect("/player/growid/login"),
  );

  app.get("/player/growid/login", (ctx) => {
    return ctx.html(authPageHtml("login"));
  });

  app.on(["GET", "HEAD"], "/", (ctx) => {
    if (ctx.req.method === "HEAD") {
      return ctx.body(null, 200, {
        "Content-Type": "text/html; charset=UTF-8",
      });
    }

    return ctx.html(authPageHtml("login"));
  });

  app.get("/player/growid/login/validate", (ctx) => {
    try {
      const token = ctx.req.query("token");
      if (!token) throw new Error("No token provided");

      jwt.verify(token, process.env.JWT_SECRET as string);
      writeWebLoginToken(token);

      return authSuccess(ctx, token);
    } catch (e) {
      return authError(ctx, "No login token provided.", e);
    }
  });
  app.post("/player/login/validate", (ctx) => validateGrowId(ctx));
  app.post("/player/login/validate/", (ctx) => validateGrowId(ctx));
  app.post("/player/growid/login/validate", (ctx) =>
    validateGrowId(ctx, { redirectToDashboard: true }),
  );
  app.post("/player/growid/login/validate/", (ctx) =>
    validateGrowId(ctx, { redirectToDashboard: true }),
  );
  app.get("/player/signup", (ctx) => ctx.html(authPageHtml("register")));
  app.get("/player/growid/signup", (ctx) => ctx.html(authPageHtml("register")));
  app.post("/player/signup", createGrowId);
  app.post("/player/growid/signup", createGrowId);
  app.on(["GET", "POST"], "/player/growid/checktoken", checkToken);
  app.on(["GET", "POST"], "/player/growid/checktoken/", checkToken);
  app.get("/player/link/dashboard/validate/:token", validateDashboardToken);
  app.get("/player/link/dashboard/validate/*", validateDashboardToken);

  app.on(["GET", "HEAD", "POST"], "*", (ctx) => {
    const hostname = new URL(ctx.req.url).hostname;
    if (!isLoginHost(hostname)) return ctx.notFound();

    if (ctx.req.method === "HEAD") {
      return ctx.body(null, 200, {
        "Content-Type": "text/html; charset=UTF-8",
      });
    }

    if (ctx.req.method === "POST") {
      const path = ctx.req.path.toLowerCase();
      if (path.includes("checktoken")) return checkToken(ctx);
      if (path.includes("signup") || path.includes("register"))
        return createGrowId(ctx);

      return validateGrowId(ctx);
    }

    return ctx.html(authPageHtml("login"));
  });

  const ssl = logon();

  if (process.env.RUNTIME_ENV === "node") {
    serve(
      {
        fetch: app.fetch,
        createServer: createHttpsServer,
        serverOptions: {
          key: ssl.tls.key,
          cert: ssl.tls.cert,
        },
        port: config.web.port,
        hostname: "::",
      },
      (info) => {
        logger.info(`Node Logon Server is running on port ${info.port}`);
      },
    );
    serve(
      {
        fetch: app.fetch,
        createServer: createHttpServer,
        port: 80,
        hostname: "::",
      },
      (info) => {
        logger.info(`Node Logon HTTP Server is running on port ${info.port}`);
      },
    );
  } else if (process.env.RUNTIME_ENV === "bun") {
    logger.info(`Bun Logon Server is running on port ${config.web.port}`);
    Bun.serve({
      fetch: app.fetch,
      port: config.web.port,
      hostname: "::",
      tls: {
        key: ssl.tls.key,
        cert: ssl.tls.cert,
      },
    });
    logger.info("Bun Logon HTTP Server is running on port 80");
    Bun.serve({
      fetch: app.fetch,
      port: 80,
      hostname: "::",
    });
  }
}

init();
