const state = {
  payload: null,
  activeCategory: "all",
  query: ""
};

const elements = {
  refreshButton: document.querySelector("#refreshButton"),
  updatedAt: document.querySelector("#updatedAt"),
  totalCount: document.querySelector("#totalCount"),
  cacheState: document.querySelector("#cacheState"),
  categoryTabs: document.querySelector("#categoryTabs"),
  searchInput: document.querySelector("#searchInput"),
  errorBox: document.querySelector("#errorBox"),
  sourceStats: document.querySelector("#sourceStats"),
  feedTitle: document.querySelector("#feedTitle"),
  feedSubtitle: document.querySelector("#feedSubtitle"),
  visibleCount: document.querySelector("#visibleCount"),
  loadingState: document.querySelector("#loadingState"),
  newsList: document.querySelector("#newsList"),
  emptyState: document.querySelector("#emptyState"),
  pushWebhook: document.querySelector("#pushWebhook"),
  pushScheduleState: document.querySelector("#pushScheduleState"),
  pushNextAt: document.querySelector("#pushNextAt"),
  pushLastAt: document.querySelector("#pushLastAt"),
  pushLastCount: document.querySelector("#pushLastCount"),
  pushPreviewButton: document.querySelector("#pushPreviewButton"),
  pushSendButton: document.querySelector("#pushSendButton"),
  pushResult: document.querySelector("#pushResult"),
  pushPreview: document.querySelector("#pushPreview")
};

const allTab = {
  id: "all",
  label: "全部热点",
  intent: "按热度、时效和多源信号排序"
};

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatFullDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function timeAgo(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function categoryLabel(categoryId) {
  return [allTab, ...(state.payload?.categories || [])].find((category) => category.id === categoryId)?.label || categoryId;
}

function activeCategory() {
  return [allTab, ...(state.payload?.categories || [])].find((category) => category.id === state.activeCategory) || allTab;
}

function setLoading(isLoading) {
  elements.refreshButton.disabled = isLoading;
  elements.loadingState.classList.toggle("hidden", !isLoading);
  if (isLoading) {
    elements.newsList.innerHTML = "";
    elements.emptyState.classList.add("hidden");
  }
}

async function loadNews({ refresh = false } = {}) {
  setLoading(true);
  hideErrors();

  try {
    const response = await fetch(`/api/news${refresh ? "?refresh=1" : ""}`, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`接口返回 ${response.status}`);
    }
    state.payload = await response.json();
    render();
  } catch (error) {
    showErrors([`加载失败：${error.message}`]);
  } finally {
    setLoading(false);
  }
}

async function loadPushStatus() {
  try {
    const response = await fetch("/api/push/status", {
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`接口返回 ${response.status}`);
    }
    renderPushStatus(await response.json());
  } catch (error) {
    showPushResult(`推送状态读取失败：${error.message}`, true);
  }
}

function render() {
  if (!state.payload) return;
  renderStatus();
  renderTabs();
  renderSourceStats();
  renderErrors();
  renderFeed();
}

function renderStatus() {
  const { generatedAt, stats, cacheHit, stale } = state.payload;
  elements.updatedAt.textContent = generatedAt ? formatDateTime(generatedAt) : "尚未生成";
  elements.totalCount.textContent = stats?.total || state.payload.items?.length || 0;
  elements.cacheState.textContent = stale ? "使用旧缓存" : cacheHit ? "命中缓存" : "刚刚刷新";
}

function renderTabs() {
  const categories = [allTab, ...(state.payload.categories || [])];
  elements.categoryTabs.innerHTML = categories
    .map((category) => {
      const count =
        category.id === "all"
          ? state.payload.items.length
          : state.payload.items.filter((item) => item.category === category.id).length;

      return `
        <button class="tab ${category.id === state.activeCategory ? "active" : ""}" type="button" data-category="${escapeHtml(category.id)}" role="tab">
          ${escapeHtml(category.label)} · ${count}
        </button>
      `;
    })
    .join("");
}

function renderSourceStats() {
  const bySource = state.payload.stats?.bySource || {};
  const entries = Object.entries(bySource).sort((a, b) => b[1] - a[1]);

  elements.sourceStats.innerHTML =
    entries
      .map(
        ([source, count]) => `
          <div class="source-stat">
            <span>${escapeHtml(source)}</span>
            <strong>${count}</strong>
          </div>
        `
      )
      .join("") || '<div class="source-stat"><span>暂无来源数据</span><strong>0</strong></div>';
}

function renderErrors() {
  const errors = state.payload.errors || [];
  if (!errors.length) {
    hideErrors();
    return;
  }

  const messages = errors.slice(0, 4).map((error) => `${error.source || "来源"}：${error.message || error}`);
  showErrors(messages);
}

function visibleItems() {
  const query = state.query.trim().toLowerCase();
  return (state.payload?.items || [])
    .filter((item) => state.activeCategory === "all" || item.category === state.activeCategory)
    .filter((item) => {
      if (!query) return true;
      const haystack = [
        item.title,
        item.source,
        item.sourceType,
        item.summaryZh,
        item.reason,
        ...(item.relatedSources || [])
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => b.heatScore - a.heatScore || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
}

function renderFeed() {
  const category = activeCategory();
  const items = visibleItems();

  elements.feedTitle.textContent = category.label;
  elements.feedSubtitle.textContent = category.intent;
  elements.visibleCount.textContent = `${items.length} 条`;
  elements.emptyState.classList.toggle("hidden", items.length > 0);

  elements.newsList.innerHTML = items.map(renderItem).join("");
}

function renderPushStatus(status) {
  elements.pushWebhook.textContent = status.configured
    ? `Webhook 已配置：${status.webhookMasked}`
    : "Webhook 未配置";
  elements.pushScheduleState.textContent = status.launchAgent?.loaded
    ? `已加载 · ${status.launchAgent.lastExitStatus === 0 ? "正常" : `退出码 ${status.launchAgent.lastExitStatus ?? "-"}`}`
    : status.launchAgent?.installed
      ? "已安装，未加载"
      : "未安装";
  elements.pushNextAt.textContent = formatFullDateTime(status.nextPushAt);
  elements.pushLastAt.textContent = status.lastPush?.pushedAt ? formatFullDateTime(status.lastPush.pushedAt) : "暂无记录";
  elements.pushLastCount.textContent = status.lastPush
    ? `${status.lastPush.total || 0} 条 · ${status.lastPush.chunks || 0} 段`
    : "-";
}

function renderItem(item) {
  const related = (item.relatedSources || [])
    .slice(0, 4)
    .map((source) => `<span>${escapeHtml(source)}</span>`)
    .join("");
  const hnLink = item.hnUrl
    ? `<a class="hn-link" href="${escapeHtml(item.hnUrl)}" target="_blank" rel="noopener noreferrer">HN 讨论</a>`
    : "";

  return `
    <article class="news-card">
      <div class="news-main">
        <div class="meta-row">
          <span class="category-chip">${escapeHtml(categoryLabel(item.category))}</span>
          <span class="source-chip">${escapeHtml(item.sourceType || "来源")}</span>
          <span>${escapeHtml(item.source || "未知来源")}</span>
          <span>${escapeHtml(formatDateTime(item.publishedAt))}</span>
          <span>${escapeHtml(timeAgo(item.publishedAt))}</span>
        </div>
        <a class="news-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(item.title)}
        </a>
        <p class="summary">${escapeHtml(item.summaryZh)}</p>
        <p class="reason">${escapeHtml(item.reason)}</p>
        <div class="related">${related}${hnLink}</div>
      </div>
      <div class="score-box" aria-label="热度分数 ${escapeHtml(String(item.heatScore))}">
        <strong>${escapeHtml(String(item.heatScore))}</strong>
        <span>热度</span>
      </div>
    </article>
  `;
}

function showErrors(messages) {
  elements.errorBox.innerHTML = messages.map((message) => `<div>${escapeHtml(message)}</div>`).join("");
  elements.errorBox.classList.remove("hidden");
}

function hideErrors() {
  elements.errorBox.innerHTML = "";
  elements.errorBox.classList.add("hidden");
}

function setPushBusy(isBusy) {
  elements.pushPreviewButton.disabled = isBusy;
  elements.pushSendButton.disabled = isBusy;
}

function showPushResult(message, isError = false) {
  elements.pushResult.textContent = message;
  elements.pushResult.classList.toggle("error", isError);
  elements.pushResult.classList.remove("hidden");
}

function hidePushResult() {
  elements.pushResult.textContent = "";
  elements.pushResult.classList.remove("error");
  elements.pushResult.classList.add("hidden");
}

async function previewPush() {
  setPushBusy(true);
  hidePushResult();

  try {
    const response = await fetch("/api/push/preview", {
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`接口返回 ${response.status}`);
    }
    const payload = await response.json();
    elements.pushPreview.textContent = payload.markdown || "暂无预览内容";
    elements.pushPreview.classList.remove("hidden");
    showPushResult("日报预览已更新。");
  } catch (error) {
    showPushResult(`预览失败：${error.message}`, true);
  } finally {
    setPushBusy(false);
  }
}

async function sendPushNow() {
  if (!confirm("现在发送企业微信日报？")) return;

  setPushBusy(true);
  hidePushResult();

  try {
    const response = await fetch("/api/push/send", {
      method: "POST",
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`接口返回 ${response.status}`);
    }
    const payload = await response.json();
    showPushResult(payload.stdout || "推送命令已完成。");
    await loadPushStatus();
  } catch (error) {
    showPushResult(`推送失败：${error.message}`, true);
  } finally {
    setPushBusy(false);
  }
}

elements.categoryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.activeCategory = button.dataset.category;
  renderTabs();
  renderFeed();
});

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderFeed();
});

elements.refreshButton.addEventListener("click", () => {
  loadNews({ refresh: true });
});

elements.pushPreviewButton.addEventListener("click", previewPush);
elements.pushSendButton.addEventListener("click", sendPushNow);

loadNews();
loadPushStatus();
