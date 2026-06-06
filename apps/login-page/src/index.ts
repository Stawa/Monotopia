import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { config, frontend } from "@growserver/config";
import { createServer } from "https";
import {
  downloadMkcert,
  downloadWebsite,
  setupMkcert,
  setupWebsite,
  writeWebLoginToken,
} from "@growserver/utils";
import logger from "@growserver/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "fs";
import { join } from "path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Database } from "@growserver/db";

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

  await downloadMkcert();
  await downloadWebsite();

  await setupMkcert();
  await setupWebsite();

  app.use("*", async (ctx, next) => {
    const method = ctx.req.method;
    const path = ctx.req.path;
    logger.info(`[${method}] ${path}`);
    await next();
  });

  app.use(
    "/*",
    process.env.RUNTIME_ENV === "bun" && process.versions.bun
      ? // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
        buns?.serveStatic({ root: config.webFrontend.root })!
      : serveStatic({
          root: config.webFrontend.root,
        }),
  );

  app.get("/player/growid/login/validate", (ctx) => {
    try {
      const query = ctx.req.query();
      const token = query.token;
      if (!token) throw new Error("No token provided");

      jwt.verify(token, process.env.JWT_SECRET as string);

      return ctx.redirect(linkDashboardValidatePath(token));
    } catch (e) {
      return authError(ctx, "No login token provided.", e);
    }
  });

  const validateGrowId = async (ctx: Context) => {
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

      if (ctx.req.path.includes("/growid/"))
        return ctx.redirect(linkDashboardValidatePath(token));

      return authSuccess(ctx, token);
    } catch (e) {
      return authError(ctx, "Unable to validate login request.", e);
    }
  };

  app.post("/player/login/validate", validateGrowId);
  app.post("/player/growid/login/validate", validateGrowId);

  app.get("/player/growid/login", (ctx) => {
    return ctx.html(legacyLoginHtml());
  });

  app.on(["GET", "POST"], "/player/growid/checktoken", async (ctx) => {
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
  });

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

  app.get("/player/link/dashboard/validate/:token", validateDashboardToken);
  app.get("/player/link/dashboard/validate/*", validateDashboardToken);

  app.post("/player/signup", async (ctx) => {
    try {
      const body = await ctx.req.json();
      const growId = body.data?.growId;
      const password = body.data?.password;
      const confirmPassword = body.data?.confirmPassword;

      if (!growId || !password || !confirmPassword)
        return authError(ctx, "Missing GrowID, password, or confirmation.");

      // Check if user already exists
      const user = await db.players.get(growId.toLowerCase());
      if (user) return authError(ctx, "GrowID already exists.");

      // Check if password and confirm password match
      if (password !== confirmPassword)
        return authError(ctx, "Password and Confirm Password does not match.");

      // Save player to database
      await db.players.set(growId, password);

      // Login user:
      const token = jwt.sign(
        { growId, password },
        process.env.JWT_SECRET as string,
      );

      if (!token) return authError(ctx, "Unable to create login token.");

      jwt.verify(token, process.env.JWT_SECRET as string);

      return authSuccess(ctx, token);
    } catch (e) {
      return authError(ctx, "Unable to sign up.", e);
    }
  });

  const dashboardHtml = () =>
    readFileSync(
      join(__dirname, "..", ".cache", "website", "index.html"),
      "utf-8",
    );

  app.post("/player/login/dashboard", (ctx) => {
    return ctx.redirect("/player/growid/login");
  });

  app.get("/player/login/dashboard", (ctx) => {
    return ctx.html(dashboardHtml());
  });

  app.on("HEAD", "/player/login/dashboard", (ctx) => {
    return ctx.body(null, 200, {
      "Content-Type": "text/html; charset=UTF-8",
    });
  });

  app.get("/", (ctx) => {
    return ctx.html(dashboardHtml());
  });

  const fe = frontend();

  if (process.env.RUNTIME_ENV === "node") {
    serve(
      {
        fetch: app.fetch,
        createServer,
        serverOptions: {
          key: fe.tls.key,
          cert: fe.tls.cert,
        },
        port: config.webFrontend.port,
      },
      (info) => {
        logger.info(`Node Login Page Server is running on port ${info.port}`);
      },
    );
  } else if (process.env.RUNTIME_ENV === "bun") {
    logger.info(`Bun Login Page Server is running on port ${config.web.port}`);
    Bun.serve({
      fetch: app.fetch,
      port: config.webFrontend.port,
      tls: {
        key: fe.tls.key,
        cert: fe.tls.cert,
      },
    });
  }
}

init();
