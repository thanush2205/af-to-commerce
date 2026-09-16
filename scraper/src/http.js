import axios from "axios";
import { config } from "./config.js";
import { log } from "./logger.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomJitter(baseMs) {
  return Math.round(baseMs * (0.5 + Math.random() * 0.5));
}

function isRetryable(status, error) {
  if (error) {
    const code = error.code;
    if (["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "ENOTFOUND", "EPIPE", "EAI_AGAIN"].includes(code)) {
      return true;
    }
  }
  return status >= 500 || status === 429;
}

export async function withRetries(options, { maxRetries, baseDelayMs, timeoutMs, label }) {
  let delay = baseDelayMs;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const { data } = await axios({ timeout: timeoutMs, ...options });
      return data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const retryable = isRetryable(status, err);

      log.warn(`http attempt ${attempt}/${maxRetries} failed`, {
        label,
        status: status ?? null,
        code: err.code ?? null,
        retryable,
        waitMs: delay,
      });

      if (!retryable || attempt === maxRetries) {
        break;
      }

      await sleep(delay);
      delay *= 2;
    }
  }

  throw lastError;
}

export async function getJson(url, { headers = {}, label = url } = {}) {
  const { maxRetries, retryBaseDelayMs, timeoutMs } = config.request;
  return withRetries(
    { method: "get", url, headers },
    { maxRetries, baseDelayMs: retryBaseDelayMs, timeoutMs, label }
  );
}