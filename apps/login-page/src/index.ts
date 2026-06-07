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

  type AuthView = "login" | "register";

  const authPageHtml = (view: AuthView = "login") => {
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
        --line: #84c9dd;
        --line-soft: rgba(132, 201, 221, 0.55);
        --input: #236f83;
        --input-focus: #2d8197;
        --button: #1ec7ee;
        --button-dark: #0eaad1;
        --yellow: #f3cf2f;
        --yellow-dark: #d2ad17;
        --text: #ffffff;
        --muted: #b7d5e1;
        --danger: #ff8176;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", Arial, sans-serif;
        background:
          linear-gradient(rgba(0, 0, 0, 0.58), rgba(0, 0, 0, 0.58)),
          radial-gradient(circle at 20% 15%, rgba(62, 174, 188, 0.26), transparent 34%),
          radial-gradient(circle at 82% 78%, rgba(8, 72, 103, 0.56), transparent 36%),
          #05090d;
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
        width: min(680px, 100%);
        box-sizing: border-box;
        padding: 34px 44px 36px;
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
        max-width: 470px;
      }

      form h2 {
        margin: 0 0 24px;
        color: var(--text);
        font-size: 34px;
        line-height: 1.2;
        font-weight: 800;
        letter-spacing: 0;
        text-align: center;
        text-shadow: 0 2px 0 rgba(0, 0, 0, 0.32);
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
        min-height: 48px;
        padding: 12px 16px;
        border: 2px solid var(--line);
        border-radius: 4px;
        background: var(--input);
        color: var(--text);
        font-size: 16px;
        font-weight: 700;
        outline: none;
        transition:
          border-color 160ms ease,
          box-shadow 160ms ease,
          background-color 160ms ease;
      }

      input::placeholder {
        color: rgba(255, 255, 255, 0.72);
      }

      input:focus {
        border-color: #b8f0ff;
        background: var(--input-focus);
        box-shadow: 0 0 0 3px rgba(31, 199, 238, 0.18);
      }

      button {
        width: 100%;
        min-height: 46px;
        margin-top: 8px;
        padding: 11px 18px;
        border: 0;
        border-radius: 4px;
        background: var(--button);
        color: var(--text);
        font-size: 16px;
        font-weight: 800;
        cursor: pointer;
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.32);
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
        font-size: 15px;
        font-weight: 700;
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
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.28);
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
          font-size: 28px;
        }

        .switcher {
          flex-direction: column;
        }

        .switcher a {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <form method="POST" action="${formAction}" autocomplete="off">
        <h2>${title}</h2>
        <label>
          <span>Grow ID</span>
          <input name="growId" type="text" placeholder="Your Growtopia Name *" autocomplete="${growIdAutocomplete}" required>
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
    return ctx.html(authPageHtml("login"));
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

  app.get("/player/signup", (ctx) => ctx.html(authPageHtml("register")));
  app.get("/player/growid/signup", (ctx) => ctx.html(authPageHtml("register")));
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
