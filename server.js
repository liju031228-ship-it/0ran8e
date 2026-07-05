const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { URL } = require("url");
const { promisify } = require("util");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const CACHE_TTL_MINUTES = Number(process.env.CACHE_TTL_MINUTES || 180);
const CACHE_TTL_MS = CACHE_TTL_MINUTES * 60 * 1000;
const MAX_ITEMS_PER_CATEGORY = 28;
const REQUEST_TIMEOUT_MS = 15000;

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const CACHE_FILE = path.join(DATA_DIR, "news-cache.json");
const DOT_ENV_FILE = path.join(ROOT_DIR, ".env");
const PUSH_LOG_FILE = path.join(DATA_DIR, "push-log.json");
const PUSH_SCRIPT_FILE = path.join(ROOT_DIR, "scripts", "push-wecom.js");
const LAUNCH_AGENT_FILE = path.join(
  process.env.HOME || "",
  "Library",
  "LaunchAgents",
  "com.daily-hotspot.wecom.plist"
);

const execFileAsync = promisify(execFile);

const CATEGORY_DEFS = [
  {
    id: "global",
    label: "全球热点",
    intent: "重大国际事件、政策冲突、灾害、公共卫生和全球议题",
    googleQuery: '(world OR global OR international OR "breaking news") when:1d',
    gdeltQuery: '(world OR global OR international OR "breaking news")',
    keywords: [
      "world",
      "global",
      "international",
      "war",
      "election",
      "climate",
      "court",
      "summit",
      "breaking",
      "conflict",
      "crisis",
      "privacy",
      "security",
      "supreme",
      "warrant"
    ]
  },
  {
    id: "ai",
    label: "AI科技",
    intent: "AI、芯片、软件、创业公司、科研突破和大型科技公司动态",
    googleQuery:
      '(AI OR "artificial intelligence" OR OpenAI OR Anthropic OR Nvidia OR chip OR startup OR technology) when:1d',
    gdeltQuery:
      '("artificial intelligence" OR OpenAI OR Anthropic OR Nvidia OR "machine learning" OR "large language model" OR semiconductor OR startup OR technology)',
    hnQuery: "AI OR artificial intelligence OR OpenAI OR Anthropic OR Nvidia OR LLM",
    keywords: [
      "ai",
      "artificial intelligence",
      "openai",
      "anthropic",
      "nvidia",
      "llm",
      "model",
      "benchmark",
      "chip",
      "code",
      "computer",
      "cpu",
      "data",
      "database",
      "developer",
      "http",
      "kernel",
      "kubernetes",
      "linux",
      "microcontroller",
      "nixos",
      "programming",
      "robot",
      "security",
      "semiconductor",
      "software",
      "startup",
      "tech",
      "technology",
      "wasm",
      "windows",
      "科技",
      "人工智能",
      "芯片"
    ]
  },
  {
    id: "finance",
    label: "金融加密",
    intent: "宏观经济、股票市场、央行政策、加密资产和金融监管",
    googleQuery:
      '(finance OR markets OR stocks OR economy OR bitcoin OR ethereum OR crypto OR "central bank") when:1d',
    gdeltQuery:
      '(finance OR markets OR stocks OR economy OR bitcoin OR ethereum OR crypto OR "central bank")',
    hnQuery: "bitcoin OR ethereum OR crypto OR fintech OR market",
    keywords: [
      "finance",
      "markets",
      "market",
      "shares",
      "stocks",
      "stock",
      "economy",
      "inflation",
      "fed",
      "central bank",
      "oil",
      "prices",
      "wall street",
      "bitcoin",
      "ethereum",
      "crypto",
      "金融",
      "加密",
      "经济"
    ]
  },
  {
    id: "sports_entertainment",
    label: "体育娱乐",
    intent: "体育赛事、影视、音乐、游戏、明星和流媒体趋势",
    googleQuery:
      '(sports OR NBA OR football OR soccer OR tennis OR entertainment OR movie OR music OR streaming OR celebrity) when:1d',
    gdeltQuery:
      '(sports OR basketball OR football OR soccer OR tennis OR entertainment OR movie OR music OR streaming OR celebrity)',
    keywords: [
      "sports",
      "nba",
      "football",
      "soccer",
      "tennis",
      "entertainment",
      "movie",
      "music",
      "streaming",
      "celebrity",
      "体育",
      "娱乐",
      "电影",
      "音乐"
    ]
  },
  {
    id: "china_us",
    label: "中国/美国",
    intent: "中国、美国及中美关系相关的政治、经济、科技和社会议题",
    googleQuery:
      '(China OR Chinese OR Beijing OR "United States" OR America OR Washington OR "US China" OR "China US") when:1d',
    gdeltQuery:
      '(China OR Chinese OR Beijing OR "United States" OR America OR Washington OR "Sino American")',
    keywords: [
      "china",
      "chinese",
      "beijing",
      "united states",
      "america",
      "washington",
      "us",
      "u.s.",
      "sino",
      "中国",
      "美国",
      "中美"
    ]
  }
];

const CATEGORY_BY_ID = new Map(CATEGORY_DEFS.map((category) => [category.id, category]));

const GDELT_ALL_QUERY =
  '("artificial intelligence" OR OpenAI OR Nvidia OR bitcoin OR crypto OR markets OR sports OR entertainment OR China OR "United States" OR international)';

const DISPLAY_LANGUAGE_RE = /^[\p{Script=Han}\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]+$/u;
const HAN_RE = /\p{Script=Han}/u;
const LATIN_RE = /\p{Script=Latin}/u;
const ASCII_LATIN_RE = /^[A-Za-z]$/;
const ENGLISH_TITLE_WORDS = new Set([
  "about",
  "accountable",
  "after",
  "against",
  "ai",
  "all",
  "and",
  "are",
  "as",
  "at",
  "be",
  "beats",
  "before",
  "best",
  "building",
  "breakdown",
  "can",
  "case",
  "could",
  "cuda",
  "damage",
  "data",
  "does",
  "enough",
  "escalate",
  "extend",
  "game",
  "for",
  "from",
  "has",
  "held",
  "higher",
  "how",
  "iran",
  "in",
  "into",
  "instructions",
  "interpreter",
  "is",
  "it",
  "latest",
  "learn",
  "lite",
  "lose",
  "losses",
  "market",
  "markets",
  "memory",
  "microsoft",
  "near",
  "native",
  "needs",
  "new",
  "news",
  "nixos",
  "of",
  "oil",
  "on",
  "over",
  "price",
  "prices",
  "protections",
  "releases",
  "right",
  "rise",
  "rules",
  "salaries",
  "says",
  "see",
  "should",
  "show",
  "shares",
  "social",
  "spot",
  "stocks",
  "sued",
  "takes",
  "tech",
  "technical",
  "the",
  "their",
  "them",
  "this",
  "to",
  "top",
  "trades",
  "under",
  "up",
  "want",
  "wants",
  "war",
  "was",
  "what",
  "when",
  "where",
  "why",
  "will",
  "windows",
  "with",
  "without",
  "world",
  "working",
  "you"
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8"
  });
  res.end(text);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent": "DailyHotspotRecommender/0.1 (+https://localhost)",
        accept: "application/json,text/xml,application/xml,text/html;q=0.9,*/*;q=0.8",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeEntities(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .trim();
}

function stripHtml(value = "") {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function readTag(block, tagName) {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = block.match(pattern);
  return match ? stripHtml(match[1]) : "";
}

function readLink(block) {
  const atomLink = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
  if (atomLink) return decodeEntities(atomLink[1]);
  return readTag(block, "link");
}

function parseRssItems(xml) {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return itemBlocks
    .map((block) => ({
      title: readTag(block, "title"),
      url: normalizeGoogleNewsLink(readLink(block)),
      source: readTag(block, "source") || extractHostname(readLink(block)) || "Google News",
      publishedAt: parseDate(readTag(block, "pubDate")),
      snippet: readTag(block, "description")
    }))
    .filter((item) => item.title && item.url);
}

function parseDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function normalizeGoogleNewsLink(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const direct = parsed.searchParams.get("url");
    return direct || url;
  } catch {
    return url;
  }
}

function extractHostname(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanTitle(title = "") {
  return stripHtml(title)
    .replace(/\s+-\s+[^-]{2,80}$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(title = "") {
  return cleanTitle(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSupportedDisplayText(text = "") {
  const value = String(text);
  const compact = value.replace(/\s+/g, "");
  if (!compact || !DISPLAY_LANGUAGE_RE.test(compact)) return false;
  if (HAN_RE.test(value)) return true;
  if (!LATIN_RE.test(value)) return false;

  for (const char of value) {
    if (LATIN_RE.test(char) && !ASCII_LATIN_RE.test(char)) {
      return false;
    }
  }

  return isLikelyEnglishTitle(value);
}

function isLikelyEnglishTitle(text) {
  const words = (text.toLowerCase().match(/[a-z]+/g) || []).filter((word) => word.length > 1);
  const hits = words.filter((word) => ENGLISH_TITLE_WORDS.has(word)).length;
  if (words.length <= 2) return hits >= 1;
  if (words.length <= 4) return hits >= 1;

  return hits >= 2 && hits / words.length >= 0.18;
}

function textMatchesKeywords(text, keywords) {
  return keywords.some((keyword) => keywordMatches(text, keyword));
}

function inferCategoryDetails(title, url) {
  const titleText = String(title || "").toLowerCase();
  const urlText = String(url || "").toLowerCase();
  let best = { id: null, hits: 0, titleHits: 0, urlHits: 0 };

  for (const category of CATEGORY_DEFS) {
    const titleHits = category.keywords.reduce(
      (total, keyword) => total + (keywordMatches(titleText, keyword) ? 1 : 0),
      0
    );
    const urlHits = category.keywords.reduce(
      (total, keyword) => total + (keywordMatches(urlText, keyword) ? 1 : 0),
      0
    );
    const hits = titleHits * 3 + urlHits;
    if (hits > best.hits || (hits === best.hits && titleHits > best.titleHits)) {
      best = { id: category.id, hits, titleHits, urlHits };
    }
  }

  return best;
}

function inferCategory(title, url, fallbackCategoryId) {
  const best = inferCategoryDetails(title, url);
  return best.id || fallbackCategoryId || "global";
}

function keywordMatches(text, keyword) {
  const value = String(text || "").toLowerCase();
  const needle = String(keyword || "").toLowerCase();
  if (!needle) return false;

  if (/[\u4e00-\u9fff]/.test(needle)) {
    return value.includes(needle);
  }

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/^[a-z0-9.]+$/.test(needle)) {
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(value);
  }

  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(value);
}

async function fetchGoogleNews(category) {
  const params = new URLSearchParams({
    q: category.googleQuery,
    hl: "zh-CN",
    gl: "CN",
    ceid: "CN:zh-Hans"
  });
  const url = `https://news.google.com/rss/search?${params.toString()}`;
  const response = await fetchWithTimeout(url, {
    headers: { accept: "application/rss+xml,application/xml,text/xml" }
  });
  const xml = await response.text();

  return parseRssItems(xml).map((item) => ({
    ...item,
    sourceType: "Google News",
    category: category.id,
    rawScore: 42
  }));
}

async function fetchGdelt(category) {
  const params = new URLSearchParams({
    query: category.gdeltQuery,
    mode: "ArtList",
    format: "json",
    maxrecords: "75",
    sort: "HybridRel",
    timespan: "1d"
  });
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
  const response = await fetchWithTimeout(url);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`GDELT returned non-JSON response: ${text.slice(0, 120)}`);
  }
  const articles = Array.isArray(payload.articles) ? payload.articles : [];

  return articles
    .map((article) => ({
      title: cleanTitle(article.title || ""),
      url: article.url || "",
      source: article.domain || article.sourceCountry || "GDELT",
      publishedAt: parseGdeltDate(article.seendate || article.socialimage),
      snippet: article.title || "",
      sourceType: "GDELT",
      category: category.id,
      rawScore: 52
    }))
    .filter((item) => item.title && item.url);
}

async function fetchGdeltAll() {
  const params = new URLSearchParams({
    query: GDELT_ALL_QUERY,
    mode: "ArtList",
    format: "json",
    maxrecords: "125",
    sort: "HybridRel",
    timespan: "1d"
  });
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
  const response = await fetchWithTimeout(url);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`GDELT returned non-JSON response: ${text.slice(0, 120)}`);
  }
  const articles = Array.isArray(payload.articles) ? payload.articles : [];

  return articles
    .map((article) => {
      const title = cleanTitle(article.title || "");
      const url = article.url || "";
      return {
        title,
        url,
        source: article.domain || article.sourceCountry || "GDELT",
        publishedAt: parseGdeltDate(article.seendate),
        snippet: title,
        sourceType: "GDELT",
        category: inferCategory(`${title} ${article.domain || ""}`, url, "global"),
        rawScore: 52
      };
    })
    .filter((item) => item.title && item.url);
}

function parseGdeltDate(value) {
  if (!value || typeof value !== "string") return null;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/);
  if (compact) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = compact;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
  }
  return parseDate(value);
}

async function fetchHackerNews() {
  const topResponse = await fetchWithTimeout(
    "https://hacker-news.firebaseio.com/v0/topstories.json",
    { headers: { accept: "application/json" } }
  );
  const ids = (await topResponse.json()).slice(0, 45);
  const detailRequests = ids.map(async (id) => {
    const response = await fetchWithTimeout(
      `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
      { headers: { accept: "application/json" } }
    );
    return response.json();
  });
  const stories = (await Promise.allSettled(detailRequests))
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((story) => story && story.type === "story" && story.title);

  return stories
    .map((story) => {
      const url = story.url || `https://news.ycombinator.com/item?id=${story.id}`;
      const categoryInfo = inferCategoryDetails(story.title, url);
      const category = categoryInfo.id;
      return {
        title: cleanTitle(story.title),
        url,
        source: extractHostname(url) || "news.ycombinator.com",
        publishedAt: story.time ? new Date(story.time * 1000).toISOString() : null,
        snippet: "",
        sourceType: "Hacker News",
        category,
        rawScore: Math.min(95, 35 + Math.log2((story.score || 1) + 1) * 7 + Math.log2((story.descendants || 0) + 1) * 4),
        hnScore: story.score || 0,
        commentCount: story.descendants || 0,
        hnUrl: `https://news.ycombinator.com/item?id=${story.id}`
      };
    })
    .filter((item) => item.category === "ai" || item.category === "finance" || item.category === "global");
}

async function collectFromSources() {
  const errors = [];
  const googleTasks = [];

  for (const category of CATEGORY_DEFS) {
    googleTasks.push({
      name: `Google News / ${category.label}`,
      run: () => fetchGoogleNews(category)
    });
  }

  const gdeltTasks = [{
    name: "GDELT",
    run: fetchGdeltAll
  }];

  const hnTasks = [{
    name: "Hacker News",
    run: fetchHackerNews
  }];

  const settledGroups = await Promise.all([
    runSourceGroup(googleTasks, 2, 250),
    runSourceGroup(gdeltTasks, 1, 0),
    runSourceGroup(hnTasks, 1, 0)
  ]);
  const items = [];

  for (const result of settledGroups.flat()) {
    if (result.ok) {
      items.push(...result.items);
      continue;
    }

    errors.push({
      source: result.source,
      message: result.message
    });
  }

  return { items, errors };
}

async function runSourceGroup(sourceTasks, concurrency, gapMs) {
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < sourceTasks.length) {
      const source = sourceTasks[cursor];
      cursor += 1;

      try {
        const items = await source.run();
        results.push({ ok: true, source: source.name, items });
      } catch (error) {
        results.push({
          ok: false,
          source: source.name,
          message: error?.message || String(error)
        });
      }

      if (gapMs > 0 && cursor < sourceTasks.length) {
        await sleep(gapMs);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, sourceTasks.length) }, worker));
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hoursSince(isoDate) {
  if (!isoDate) return 18;
  const delta = Date.now() - Date.parse(isoDate);
  if (!Number.isFinite(delta)) return 18;
  return Math.max(0, delta / 36e5);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function recencyScore(publishedAt) {
  const hours = hoursSince(publishedAt);
  if (hours <= 2) return 18;
  if (hours <= 6) return 14;
  if (hours <= 12) return 10;
  if (hours <= 24) return 7;
  if (hours <= 48) return 3;
  return 0;
}

function buildSummary(item) {
  const category = CATEGORY_BY_ID.get(item.category);
  const categoryLabel = category?.label || "热点";
  const source = item.source || item.sourceType || "相关来源";
  const title = cleanTitle(item.title).replace(/[。.!?！？]+$/g, "");
  const snippet = cleanSnippet(item.snippet);

  if (snippet && snippet !== title && HAN_RE.test(snippet)) {
    return `据${source}，${ensureChineseSentence(truncateText(snippet, 82))}`;
  }

  const text = `${title} ${snippet}`.toLowerCase();
  const topic = readableTopic(title);

  if (matchesAny(text, ["supreme court", "court", "warrant", "constitutional", "lawsuit", "sued", "regulator", "regulation", "antitrust"])) {
    return `${source} 报道了与「${topic}」相关的法律或监管进展，可能影响政策边界、平台责任或用户权益。`;
  }

  if (matchesAny(text, ["ai", "artificial intelligence", "llm", "model", "benchmark", "claude", "openai", "nvidia"])) {
    return `${source} 的这条动态与 AI 应用、模型能力或相关产业变化有关，适合快速判断技术趋势。`;
  }

  if (matchesAny(text, ["bug", "vulnerability", "breach", "leak", "security", "exploit", "privacy"])) {
    return `${source} 披露了软件安全、隐私或数据风险相关信息，值得关注潜在影响和后续修复。`;
  }

  if (matchesAny(text, ["bitcoin", "crypto", "stock", "stocks", "market", "markets", "shares", "oil", "prices", "wall street", "etf", "inflation", "fed", "price fixing"])) {
    return `${source} 报道了市场、资产价格或金融监管相关变化，可作为宏观和资产风险的观察信号。`;
  }

  if (matchesAny(text, ["launch", "launched", "release", "released", "announce", "announced", "introduces", "unveils", "version"])) {
    return `${source} 提到「${topic}」的新发布或版本变化，适合关注产品路线和生态动向。`;
  }

  if (matchesAny(text, ["how", "guide", "reading", "building", "working with", "what happens", "internals", "tutorial"])) {
    return `${source} 这篇内容偏实践解析，围绕「${topic}」提供开发、系统或工程经验参考。`;
  }

  if (matchesAny(text, ["windows", "linux", "kernel", "database", "postgresql", "http", "wasm", "programming", "microcontroller", "nixos", "cuda"])) {
    return `${source} 关注「${topic}」这类软件、硬件或开发者生态话题，适合作为技术趋势补充阅读。`;
  }

  if (matchesAny(text, ["salary", "salaries", "san francisco", "startup", "entrepreneurship", "tech industry"])) {
    return `${source} 报道了科技行业、创业环境或人才成本变化，可帮助观察产业侧压力。`;
  }

  if (item.sourceType === "Hacker News") {
    return `这条在 Hacker News 引发讨论，主题是「${topic}」，可作为开发者社区正在关注的${categoryLabel}信号。`;
  }

  return `${source} 报道了「${topic}」，可作为${categoryLabel}中的一条趋势线索继续跟进。`;
}

function cleanSnippet(snippet = "") {
  const cleaned = stripHtml(snippet)
    .replace(/\s+-\s+[^-]{2,80}$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 12 ? cleaned : "";
}

function readableTopic(title) {
  return truncateText(title.replace(/\s+/g, " ").trim(), 72);
}

function matchesAny(text, keywords) {
  return keywords.some((keyword) => keywordMatches(text, keyword));
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function ensureChineseSentence(value) {
  const text = String(value || "").trim();
  if (!text) return "相关信息值得继续关注。";
  return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

function buildReason(item) {
  const reasons = [];

  if (item.sourceTypes?.length > 1) {
    reasons.push(`被 ${item.sourceTypes.join("、")} 同时捕捉`);
  } else if (item.sourceType === "Hacker News") {
    reasons.push(`在 Hacker News 获得 ${item.hnScore || 0} 分和 ${item.commentCount || 0} 条讨论`);
  } else {
    reasons.push(`来自 ${item.sourceType} 的高相关度结果`);
  }

  const hours = hoursSince(item.publishedAt);
  if (hours <= 6) {
    reasons.push("发布时间很近");
  } else if (hours <= 24) {
    reasons.push("仍处在今日信息窗口内");
  }

  if (item.duplicateCount > 1) {
    reasons.push(`相似报道 ${item.duplicateCount} 条`);
  }

  return reasons.join("，") + "。";
}

function combineItems(rawItems) {
  const grouped = new Map();

  for (const item of rawItems) {
    const title = cleanTitle(item.title);
    const url = item.url || item.hnUrl || "";
    const normalized = normalizeTitle(title);
    if (!normalized || normalized.length < 8) continue;
    if (!isSupportedDisplayText(title)) continue;

    const host = extractHostname(url);
    const key = `${item.category}:${normalized.slice(0, 120)}`;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...item,
        id: makeId(`${key}:${url}`),
        title,
        url,
        source: item.source || host || item.sourceType,
        domain: host,
        duplicateCount: 1,
        sourceTypes: [item.sourceType],
        relatedSources: [item.source || host || item.sourceType],
        rawScores: [item.rawScore || 35],
        hnScore: item.hnScore || 0,
        commentCount: item.commentCount || 0
      });
      continue;
    }

    existing.duplicateCount += 1;
    existing.relatedSources = uniquePush(existing.relatedSources, item.source || host || item.sourceType);
    existing.sourceTypes = uniquePush(existing.sourceTypes, item.sourceType);
    existing.rawScores.push(item.rawScore || 35);
    existing.hnScore = Math.max(existing.hnScore || 0, item.hnScore || 0);
    existing.commentCount = Math.max(existing.commentCount || 0, item.commentCount || 0);

    if (Date.parse(item.publishedAt || 0) > Date.parse(existing.publishedAt || 0)) {
      existing.publishedAt = item.publishedAt;
    }

    if (item.sourceType === "Hacker News" && !existing.hnUrl) {
      existing.hnUrl = item.hnUrl;
    }
  }

  const scored = Array.from(grouped.values()).map((item) => {
    const averageRaw = item.rawScores.reduce((total, score) => total + score, 0) / item.rawScores.length;
    const multiSourceBoost = Math.min(14, (item.sourceTypes.length - 1) * 8 + (item.duplicateCount - 1) * 2);
    const heatScore = Math.round(
      clamp(averageRaw + recencyScore(item.publishedAt) + multiSourceBoost, 1, 100)
    );

    const completed = {
      ...item,
      heatScore,
      summaryZh: buildSummary(item)
    };

    completed.reason = buildReason(completed);
    delete completed.rawScores;
    return completed;
  });

  return CATEGORY_DEFS.flatMap((category) =>
    scored
      .filter((item) => item.category === category.id)
      .sort((a, b) => b.heatScore - a.heatScore || Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
      .slice(0, MAX_ITEMS_PER_CATEGORY)
  );
}

function uniquePush(list, value) {
  if (!value || list.includes(value)) return list;
  return [...list, value];
}

function makeId(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function buildStats(items, errors) {
  const byCategory = Object.fromEntries(CATEGORY_DEFS.map((category) => [category.id, 0]));
  const bySource = {};

  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    for (const sourceType of item.sourceTypes || [item.sourceType]) {
      bySource[sourceType] = (bySource[sourceType] || 0) + 1;
    }
  }

  return {
    total: items.length,
    byCategory,
    bySource,
    sourceErrors: errors.length
  };
}

async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isCacheFresh(cache) {
  if (!cache?.generatedAt || cache.cacheDate !== todayKey()) return false;
  return Date.now() - Date.parse(cache.generatedAt) < CACHE_TTL_MS;
}

async function writeCache(payload) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), "utf8");
}

async function readEnvConfig() {
  const config = {};

  try {
    const raw = await fs.readFile(DOT_ENV_FILE, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      let value = rawValue.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      config[key] = value;
    }
  } catch {
  }

  return {
    webhookUrl: config.WECOM_WEBHOOK_URL || process.env.WECOM_WEBHOOK_URL || "",
    pushTime: config.PUSH_TIME || process.env.PUSH_TIME || "08:30",
    topPerCategory: Number(config.PUSH_TOP_PER_CATEGORY || process.env.PUSH_TOP_PER_CATEGORY || 3)
  };
}

function maskWebhook(webhookUrl) {
  if (!webhookUrl) return "";
  try {
    const parsed = new URL(webhookUrl);
    const key = parsed.searchParams.get("key") || "";
    if (key) {
      parsed.searchParams.set("key", `${key.slice(0, 8)}********${key.slice(-4)}`);
    }
    return parsed.toString();
  } catch {
    return webhookUrl.replace(/key=([^&]+)/, (_, key) => `key=${key.slice(0, 8)}********${key.slice(-4)}`);
  }
}

function nextPushAt(pushTime) {
  const match = String(pushTime || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const next = new Date();
  next.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

async function readPushLog() {
  try {
    const raw = await fs.readFile(PUSH_LOG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readLaunchAgentStatus() {
  const status = {
    installed: false,
    loaded: false,
    lastExitStatus: null,
    nodePath: "",
    plistPath: LAUNCH_AGENT_FILE,
    stdoutPath: "",
    stderrPath: ""
  };

  try {
    const plist = await fs.readFile(LAUNCH_AGENT_FILE, "utf8");
    status.installed = true;
    const strings = Array.from(plist.matchAll(/<string>([\s\S]*?)<\/string>/g)).map((match) =>
      decodeEntities(match[1])
    );
    status.nodePath = strings.find((value) => value.endsWith("/node")) || "";
    status.stdoutPath = strings.find((value) => value.endsWith(".out.log")) || "";
    status.stderrPath = strings.find((value) => value.endsWith(".err.log")) || "";
  } catch {
  }

  try {
    const { stdout } = await execFileAsync("launchctl", ["list", "com.daily-hotspot.wecom"], {
      timeout: 5000,
      maxBuffer: 256 * 1024
    });
    status.loaded = true;
    const exitStatusMatch = stdout.match(/"LastExitStatus"\s*=\s*(-?\d+)/);
    if (exitStatusMatch) {
      status.lastExitStatus = Number(exitStatusMatch[1]);
    }
  } catch {
  }

  return status;
}

async function getPushStatus() {
  const config = await readEnvConfig();
  const log = await readPushLog();
  const lastPush = log.length ? log[log.length - 1] : null;
  const launchAgent = await readLaunchAgentStatus();

  return {
    configured: Boolean(config.webhookUrl),
    webhookMasked: maskWebhook(config.webhookUrl),
    pushTime: config.pushTime,
    topPerCategory: config.topPerCategory,
    nextPushAt: nextPushAt(config.pushTime),
    lastPush,
    launchAgent,
    logCount: log.length
  };
}

async function runPushScript(args, timeoutMs = 120000) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [PUSH_SCRIPT_FILE, ...args], {
    cwd: ROOT_DIR,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024
  });

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim()
  };
}

async function previewPushReport() {
  const result = await runPushScript(["--dry-run", "--no-refresh"], 30000);
  return {
    markdown: result.stdout,
    stderr: result.stderr,
    generatedAt: new Date().toISOString()
  };
}

async function triggerPushSend({ force = false, refresh = true } = {}) {
  const args = [];
  if (refresh) {
    args.push("--refresh");
  } else {
    args.push("--no-refresh");
  }
  if (force) args.push("--force");

  const result = await runPushScript(args, 150000);
  return {
    ...result,
    generatedAt: new Date().toISOString()
  };
}

async function getNews({ refresh = false } = {}) {
  const cache = await readCache();
  if (!refresh && isCacheFresh(cache)) {
    return { ...cache, cacheHit: true };
  }

  const { items: rawItems, errors } = await collectFromSources();
  const items = combineItems(rawItems);

  const payload = {
    generatedAt: new Date().toISOString(),
    cacheDate: todayKey(),
    cacheTtlMinutes: CACHE_TTL_MINUTES,
    categories: CATEGORY_DEFS.map(({ id, label, intent }) => ({ id, label, intent })),
    items,
    stats: buildStats(items, errors),
    errors
  };

  if (items.length > 0) {
    await writeCache(payload);
    return { ...payload, cacheHit: false };
  }

  if (cache?.items?.length) {
    return {
      ...cache,
      cacheHit: true,
      stale: true,
      errors: [...(cache.errors || []), ...errors]
    };
  }

  return { ...payload, cacheHit: false };
}

function safeStaticPath(requestPath) {
  const pathname = decodeURIComponent(requestPath.split("?")[0]);
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, normalizedPath));
  return filePath.startsWith(PUBLIC_DIR) ? filePath : null;
}

async function serveStatic(req, res) {
  const filePath = safeStaticPath(req.url);
  if (!filePath) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "cache-control": "public, max-age=180"
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(res, 404, "Not found");
    } else {
      sendText(res, 500, "Static file error");
    }
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    try {
      if (requestUrl.pathname === "/api/health") {
        sendJson(res, 200, {
          ok: true,
          cacheFile: CACHE_FILE,
          cacheTtlMinutes: CACHE_TTL_MINUTES,
          now: new Date().toISOString()
        });
        return;
      }

      if (requestUrl.pathname === "/api/news") {
        const refresh = requestUrl.searchParams.get("refresh") === "1";
        const payload = await getNews({ refresh });
        sendJson(res, 200, payload);
        return;
      }

      if (requestUrl.pathname === "/api/push/status") {
        const payload = await getPushStatus();
        sendJson(res, 200, payload);
        return;
      }

      if (requestUrl.pathname === "/api/push/preview") {
        const payload = await previewPushReport();
        sendJson(res, 200, payload);
        return;
      }

      if (requestUrl.pathname === "/api/push/send") {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        const payload = await triggerPushSend({
          force: requestUrl.searchParams.get("force") === "1",
          refresh: requestUrl.searchParams.get("refresh") !== "0"
        });
        sendJson(res, 200, payload);
        return;
      }

      await serveStatic(req, res);
    } catch (error) {
      sendJson(res, 500, {
        error: "Internal server error",
        message: error.message
      });
    }
  });
}

function startServer() {
  const server = createServer();

  server.on("error", (error) => {
    console.error(`Server failed to start: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(PORT, HOST, () => {
    console.log(`Daily hotspot recommender listening on http://${HOST}:${PORT}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  CACHE_FILE,
  CATEGORY_DEFS,
  createServer,
  getNews,
  isSupportedDisplayText,
  startServer,
  todayKey
};
