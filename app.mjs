import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { classify } from "./mock-ai.mjs";

const MODEL_TIMEOUT_MS = 300;
const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);
const INVALID_INPUT_BODY = { status: "invalid_input" };
const MANUAL_REVIEW_BODY = { status: "manual_review", topic: null, draft: null };

const html = await readFile(new URL("./index.html", import.meta.url));

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunkList = [];
  for await (const chunk of request) chunkList.push(chunk);

  return Buffer.concat(chunkList).toString("utf8");
}

function extractText(rawBody) {
  let parsed;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const { text } = parsed;

  if (typeof text !== "string" || text.trim() === "") return null;

  return text.trim();
}

async function classifyWithTimeout(text) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("model_timeout"));
    }, MODEL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([classify(text, { signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function parseModelAnswer(answer) {
  if (typeof answer !== "string") return null;

  let parsed;

  try {
    parsed = JSON.parse(answer);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const { topic, draft } = parsed;

  if (!ALLOWED_TOPICS.has(topic)) return null;
  if (typeof draft !== "string" || draft.trim() === "") return null;

  return { topic, draft: draft.trim() };
}

async function handleTriage(request, response) {
  const text = extractText(await readBody(request));

  if (text === null) return json(response, 400, INVALID_INPUT_BODY);

  let result = null;

  try {
    result = parseModelAnswer(await classifyWithTimeout(text));
  } catch {
    result = null;
  }

  if (result === null) return json(response, 200, MANUAL_REVIEW_BODY);

  return json(response, 200, { status: "ready", topic: result.topic, draft: result.draft });
}

export function createApp() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }

    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }

    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}
