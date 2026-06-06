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
        font-family:
          Inter, Segoe UI, Arial, sans-serif;
        background: #0d1117;
        color: #f5f7fb;
      }

      body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        box-sizing: border-box;
      }

      main {
        width: min(940px, 100%);
        display: grid;
        grid-template-columns: 0.95fr 1.05fr;
        gap: 20px;
        align-items: stretch;
      }

      .brand {
        min-height: 520px;
        padding: 34px;
        box-sizing: border-box;
        border: 1px solid #263040;
        border-radius: 12px;
        background: #111926;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }

      .brand-mark {
        width: 48px;
        height: 48px;
        border-radius: 10px;
        background: #2f80ed;
        display: grid;
        place-items: center;
        font-size: 24px;
        font-weight: 800;
        color: #ffffff;
      }

      .brand h1 {
        margin: 28px 0 10px;
        font-size: 38px;
        line-height: 1.05;
        font-weight: 800;
      }

      .brand p {
        margin: 0;
        color: #b8c4d6;
        font-size: 15px;
        line-height: 1.6;
      }

      .status {
        display: flex;
        gap: 10px;
        color: #d9e6f8;
        font-size: 13px;
      }

      .status span {
        padding: 8px 10px;
        border: 1px solid #334153;
        border-radius: 999px;
        background: #151f2d;
      }

      .auth {
        display: grid;
        gap: 14px;
      }

      form {
        box-sizing: border-box;
        padding: 26px;
        background: #f8fafc;
        border: 1px solid #dce3ec;
        border-radius: 12px;
        color: #172033;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.2);
      }

      form h2 {
        margin: 0 0 4px;
        font-size: 22px;
        font-weight: 700;
      }

      form p {
        margin: 0 0 18px;
        color: #617089;
        font-size: 14px;
      }

      input {
        width: 100%;
        box-sizing: border-box;
        margin-bottom: 10px;
        padding: 13px 14px;
        border: 1px solid #c7d1df;
        border-radius: 8px;
        background: #ffffff;
        color: #172033;
        font-size: 15px;
        outline: none;
      }

      input:focus {
        border-color: #2f80ed;
        box-shadow: 0 0 0 3px rgba(47, 128, 237, 0.16);
      }

      button {
        width: 100%;
        margin-top: 4px;
        padding: 13px 14px;
        border: 0;
        border-radius: 8px;
        background: #2f80ed;
        color: #ffffff;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
      }

      button:hover {
        background: #1f6fd1;
      }

      .secondary {
        background: #ffffff;
      }

      .secondary button {
        background: #18976f;
      }

      .secondary button:hover {
        background: #117b5c;
      }

      @media (max-width: 760px) {
        body {
          align-items: flex-start;
          padding: 14px;
        }

        main {
          grid-template-columns: 1fr;
        }

        .brand {
          min-height: auto;
          padding: 24px;
        }

        .brand h1 {
          font-size: 30px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="brand">
        <div>
          <div class="brand-mark">M</div>
          <h1>Monotopia</h1>
          <p>Sign in or create a GrowID to enter the server.</p>
        </div>
        <div class="status">
          <span>Secure login</span>
          <span>Local server</span>
        </div>
      </section>
      <section class="auth">
        <form method="POST" action="/player/growid/login/validate" autocomplete="off">
          <h2>Log in</h2>
          <p>Use your existing GrowID.</p>
          <input name="growId" type="text" placeholder="GrowID" required>
          <input name="password" type="password" placeholder="Password" required>
          <button type="submit">Log in</button>
        </form>
        <form class="secondary" method="POST" action="/player/signup" autocomplete="off">
          <h2>Register</h2>
          <p>Create a new GrowID.</p>
          <input name="growId" type="text" placeholder="GrowID" required>
          <input name="password" type="password" placeholder="Password" required>
          <input name="confirmPassword" type="password" placeholder="Confirm password" required>
          <button type="submit">Create account</button>
        </form>
      </section>
    </main>
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

  const createGrowId = async (ctx: Context) => {
    try {
      const { growId, password, confirmPassword } = await getCredentials(ctx);
      const contentType = ctx.req.header("content-type") ?? "";

      if (!growId || !password || !confirmPassword)
        return authError(ctx, "Missing GrowID, password, or confirmation.");

      const cleanGrowId = growId.trim();
      if (!/^[A-Za-z0-9_]{3,18}$/.test(cleanGrowId))
        return authError(
          ctx,
          "GrowID must be 3-18 characters using letters, numbers, or underscore.",
        );

      const user = await db.players.get(cleanGrowId.toLowerCase());
      if (user) return authError(ctx, "GrowID already exists.");

      if (password !== confirmPassword)
        return authError(ctx, "Password and Confirm Password does not match.");

      await db.players.set(cleanGrowId, password);

      const token = jwt.sign(
        { growId: cleanGrowId, password },
        process.env.JWT_SECRET as string,
      );

      jwt.verify(token, process.env.JWT_SECRET as string);

      if (!contentType.includes("application/json"))
        return ctx.redirect(linkDashboardValidatePath(token));

      return authSuccess(ctx, token);
    } catch (e) {
      return authError(ctx, "Unable to sign up.", e);
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

  app.get("/player/signup", (ctx) => ctx.html(legacyLoginHtml()));
  app.post("/player/signup", createGrowId);
  app.post("/player/growid/signup", createGrowId);

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
