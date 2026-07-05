#!/usr/bin/env node

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { CATEGORY_DEFS, getNews, isSupportedDisplayText, todayKey } = require("../server");

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const PUSH_LOG_FILE = path.join(DATA_DIR, "push-log.json");
const args = new Set(process.argv.slice(2));

loadDotEnv(path.join(ROOT_DIR, ".env"));

const WEBHOOK_URL = process.env.WECOM_WEBHOOK_URL || "";
const TOP_PER_CATEGORY = Number(process.env.PUSH_TOP_PER_CATEGORY || 3);
const PUSH_TIME = process.env.PUSH_TIME || "08:30";
const MARKDOWN_LIMIT = Number(process.env.WECOM_MARKDOWN_LIMIT || 3900);

async function main() {
  if (args.has("--schedule")) {
    scheduleDailyPush();
    return;
  }

  await pushOnce({
    dryRun: args.has("--dry-run"),
    force: args.has("--force"),
    refresh: !args.has("--no-refresh")
  });
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function pushOnce({ dryRun, force, refresh }) {
  const sendDate = todayKey();
  if (!dryRun && !force && (await hasPushedToday(sendDate))) {
    console.log(`Already pushed for ${sendDate}. Use --force to send again.`);
    return;
  }

  const payload = await getNews({ refresh });
  const report = buildDailyReport(payload);
  const chunks = splitMarkdownBlocks(report.blocks, MARKDOWN_LIMIT);

  if (dryRun) {
    console.log(chunks.join("\n\n--- message split ---\n\n"));
    return;
  }

  if (!WEBHOOK_URL) {
    throw new Error("Missing WECOM_WEBHOOK_URL. Put it in .env or export it before running.");
  }

  for (let index = 0; index < chunks.length; index += 1) {
    const content =
      chunks.length === 1 ? chunks[index] : `${chunks[index]}\n\n> 第 ${index + 1}/${chunks.length} 段`;
    await sendWecomMarkdown(content);
  }

  await appendPushLog({
    date: sendDate,
    pushedAt: new Date().toISOString(),
    total: report.selectedCount,
    chunks: chunks.length,
    cacheHit: Boolean(payload.cacheHit),
    stale: Boolean(payload.stale)
  });

  console.log(`Pushed ${report.selectedCount} items to WeCom.`);
}

function buildDailyReport(payload) {
  const generatedAt = formatDateTime(payload.generatedAt);
  const displayItems = payload.items.filter((item) => isSupportedDisplayText(item.title));
  const selectedByCategory = selectItemsByCategory(displayItems);
  const selectedCount = selectedByCategory.reduce((total, group) => total + group.items.length, 0);
  const filteredOut = payload.items.length - displayItems.length;
  const sourceNames = Object.keys(payload.stats?.bySource || {});
  const sourceText = sourceNames.length ? sourceNames.join("、") : "暂无可用来源";
  const sourceErrors = payload.errors?.length || 0;
  const blocks = [];
  const header = [
    `# 每日热点信息推荐｜${todayKey()}`,
    `> 更新时间：${generatedAt}`,
    `> 本次推送：${selectedCount} 条｜候选：${displayItems.length} 条｜来源：${escapeMarkdown(sourceText)}`,
    filteredOut ? `> 已过滤：${filteredOut} 条非中文/英文标题。` : "",
    sourceErrors ? `> 提醒：${sourceErrors} 个来源暂时不可用，已使用可用数据生成日报。` : ""
  ].filter(Boolean);
  blocks.push(header.join("\n"));

  for (const group of selectedByCategory) {
    if (!group.items.length) {
      blocks.push([`## ${group.category.label}`, "> 暂无高热度条目。"].join("\n"));
      continue;
    }

    const categoryLines = [`## ${group.category.label}`];
    for (const [index, item] of group.items.entries()) {
      categoryLines.push(renderPushItem(item, index));
    }
    blocks.push(categoryLines.join("\n"));
  }

  blocks.push("> 打开本地网页可查看完整列表和原文链接。");

  return {
    blocks,
    displayCount: displayItems.length,
    filteredOut,
    selectedByCategory,
    selectedCount
  };
}

function selectItemsByCategory(items) {
  return CATEGORY_DEFS.map((category) => ({
    category,
    items: items
      .filter((item) => item.category === category.id)
      .sort((a, b) => b.heatScore - a.heatScore)
      .slice(0, Math.max(1, TOP_PER_CATEGORY))
  }));
}

function renderPushItem(item, index) {
  const title = escapeMarkdown(item.title);
  const url = item.url || item.hnUrl || "";
  const source = escapeMarkdown(item.source || item.sourceType || "未知来源");
  const summary = escapeMarkdown(truncate(item.summaryZh || "", 92));
  const reason = escapeMarkdown(truncate(item.reason || "", 88));
  const time = formatDateTime(item.publishedAt);

  return [
    `${index + 1}. [${title}](${url})`,
    `   热度：${item.heatScore}｜来源：${source}｜时间：${time}`,
    `   ${summary}`,
    `   推荐理由：${reason}`
  ].join("\n");
}

function splitMarkdownBlocks(blocks, limit) {
  const chunks = [];
  let current = "";

  for (const block of blocks) {
    if (Buffer.byteLength(block, "utf8") > limit) {
      const splitBlock = splitOversizedBlock(block, limit);
      for (const part of splitBlock) {
        const next = current ? `${current}\n\n${part}` : part;
        if (Buffer.byteLength(next, "utf8") > limit && current) {
          chunks.push(current);
          current = part;
        } else {
          current = next;
        }
      }
      continue;
    }

    const next = current ? `${current}\n\n${block}` : block;
    if (Buffer.byteLength(next, "utf8") > limit && current) {
      chunks.push(current);
      current = block;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitOversizedBlock(block, limit) {
  const parts = [];
  let current = "";
  for (const line of block.split("\n")) {
    const next = current ? `${current}\n${line}` : line;
    if (Buffer.byteLength(next, "utf8") > limit && current) {
      parts.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

async function sendWecomMarkdown(content) {
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: {
        content
      }
    })
  });

  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    result = { raw: text };
  }

  if (!response.ok || result.errcode !== 0) {
    throw new Error(`WeCom push failed: HTTP ${response.status}, ${text}`);
  }
}

function scheduleDailyPush() {
  if (!WEBHOOK_URL) {
    throw new Error("Missing WECOM_WEBHOOK_URL. Put it in .env before starting schedule mode.");
  }

  const scheduleNext = () => {
    const next = nextRunAt(PUSH_TIME);
    const delayMs = next.getTime() - Date.now();
    console.log(`Next WeCom push scheduled at ${next.toLocaleString("zh-CN")}.`);

    setTimeout(async () => {
      try {
        await pushOnce({ dryRun: false, force: false, refresh: true });
      } catch (error) {
        console.error(error.message);
      } finally {
        scheduleNext();
      }
    }, delayMs);
  };

  scheduleNext();
}

function nextRunAt(timeText) {
  const match = timeText.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error("PUSH_TIME must be HH:mm, for example 08:30.");
  }

  const [, hourText, minuteText] = match;
  const next = new Date();
  next.setHours(Number(hourText), Number(minuteText), 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

async function hasPushedToday(date) {
  const log = await readPushLog();
  return log.some((entry) => entry.date === date);
}

async function readPushLog() {
  try {
    const raw = await fsp.readFile(PUSH_LOG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendPushLog(entry) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const log = await readPushLog();
  log.push(entry);
  await fsp.writeFile(PUSH_LOG_FILE, JSON.stringify(log.slice(-120), null, 2), "utf8");
}

function formatDateTime(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function escapeMarkdown(value = "") {
  return String(value)
    .replace(/\r?\n/g, " ")
    .replace(/\]/g, "）")
    .replace(/\[/g, "（")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
