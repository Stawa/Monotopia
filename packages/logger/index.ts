import pino from "pino";
import { config } from "@monotopia/config";
import { APP_NAME } from "@monotopia/const";

const isDevelopment = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: config.server.logLevel,
  base: {
    app: APP_NAME.toLowerCase(),
  },
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:mm:ss",
          ignore: "pid,hostname",
          messageFormat: "{if name}[{name}] {end}{msg}",
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
});

export const createLogger = (name: string) => {
  return logger.child({ name });
};

export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const fatal = logger.fatal.bind(logger);

export default logger;
