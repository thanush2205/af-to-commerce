const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

let sink = (entry) => process.stdout.write(`${entry}\n`);

export function setSink(fn) {
  sink = fn;
}

function write(level, message, meta = {}) {
  const ts = new Date().toISOString();
  const base = { ts, level, message };
  const entry =
    Object.keys(meta).length > 0 ? { ...base, ...meta } : base;
  sink(JSON.stringify(entry));
}

export const log = {
  debug: (message, meta) => write("debug", message, meta),
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};

export function errorSummary(fn, label) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      log.error(`${label} failed`, {
        message: err.message,
        stack: err.stack,
      });
      throw err;
    }
  };
}