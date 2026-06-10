import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { config, frontend } from "@monotopia/config";
import { createServer } from "https";
import {
  downloadMkcert,
  downloadWebsite,
  setupMkcert,
  setupWebsite,
  writeWebLoginToken,
} from "@monotopia/utils";
import logger from "@monotopia/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "fs";
import { join } from "path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Database } from "@monotopia/db";

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

  const validateLoginToken = (ctx: Context) => {
    try {
      const query = ctx.req.query();
      const token = query.token;
      if (!token) throw new Error("No token provided");

      jwt.verify(token, process.env.JWT_SECRET as string);

      writeWebLoginToken(token);

      return authSuccess(ctx, token);
    } catch (e) {
      return authError(ctx, "No login token provided.", e);
    }
  };

  app.get("/player/growid/login/validate", validateLoginToken);
  app.get("/player/growid/login/validate/", validateLoginToken);

  const validateGrowId = async (ctx: Context) => {
    const shouldRenderLoginPage = ctx.req.path.includes("/growid/");
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

      const token = jwt.sign(
        { growId, password },
        process.env.JWT_SECRET as string,
      );

      if (ctx.req.path.includes("/growid/"))
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

      const token = jwt.sign(
        { growId: cleanGrowId, password },
        process.env.JWT_SECRET as string,
      );

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

  app.post("/player/login/validate", validateGrowId);
  app.post("/player/login/validate/", validateGrowId);
  app.post("/player/growid/login/validate", validateGrowId);
  app.post("/player/growid/login/validate/", validateGrowId);

  app.get("/player/growid/login", (ctx) => {
    return ctx.html(authPageHtml("login"));
  });
  app.get("/player/growid/login/", (ctx) => {
    return ctx.html(authPageHtml("login"));
  });

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

      const token = refreshToken;
      jwt.verify(token, process.env.JWT_SECRET as string);

      return ctx.redirect(clientLoginValidatePath(token));
    } catch (e) {
      return authError(
        ctx,
        "Saved login token is invalid. Please log in again.",
        e,
      );
    }
  };

  app.on(["GET", "POST"], "/player/growid/checktoken", checkToken);
  app.on(["GET", "POST"], "/player/growid/checktoken/", checkToken);

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

  app.get("/player/link/dashboard/validate/:token", validateDashboardToken);
  app.get("/player/link/dashboard/validate/*", validateDashboardToken);

  app.get("/player/signup", (ctx) => ctx.html(authPageHtml("register")));
  app.get("/player/growid/signup", (ctx) => ctx.html(authPageHtml("register")));
  app.get("/player/signup/", (ctx) => ctx.html(authPageHtml("register")));
  app.get("/player/growid/signup/", (ctx) =>
    ctx.html(authPageHtml("register")),
  );
  app.post("/player/signup", createGrowId);
  app.post("/player/growid/signup", createGrowId);
  app.post("/player/signup/", createGrowId);
  app.post("/player/growid/signup/", createGrowId);

  const dashboardHtml = () =>
    readFileSync(
      join(__dirname, "..", ".cache", "website", "index.html"),
      "utf-8",
    );

  const dashboardResponse = (ctx: Context) => {
    if (ctx.req.method === "HEAD") {
      return ctx.body(null, 200, {
        "Content-Type": "text/html; charset=UTF-8",
      });
    }

    return ctx.html(dashboardHtml());
  };

  app.post("/player/login/dashboard", (ctx) => {
    return ctx.redirect("/player/growid/login");
  });
  app.post("/player/login/dashboard/*", (ctx) => {
    return ctx.redirect("/player/growid/login");
  });

  app.on(["GET", "HEAD"], "/player/login/dashboard", dashboardResponse);
  app.on(["GET", "HEAD"], "/player/login/dashboard/*", dashboardResponse);
  app.on(["GET", "HEAD"], "/", dashboardResponse);
  app.on(["GET", "HEAD"], "*", (ctx) => {
    const path = ctx.req.path;
    if (path.includes(".") || path.startsWith("/assets/"))
      return ctx.notFound();

    return dashboardResponse(ctx);
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
