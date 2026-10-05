// 旧カレンダーのIDと見本の順序を保ち、対応する公式シンボルへ切り替える。
const legacySymbolMappings = [
  ["builtin-wake", "203010", "起きる"],
  ["builtin-breakfast", "301010", "朝ごはん"],
  ["builtin-brush", "203060", "歯みがき"],
  ["builtin-school", "502012", "学校"],
  ["builtin-lunch", "301011", "お昼ごはん"],
  ["builtin-sports", "404011", "運動"],
  ["builtin-study", "204011", "勉強"],
  ["builtin-play", "204010", "遊ぶ"],
  ["builtin-bath", "203014", "おふろ"],
  ["builtin-dinner", "301012", "夜ごはん"],
  ["builtin-sleep", "203011", "寝る"],
  ["builtin-special", "201089", "たのしみ"]
];
const legacyAssets = legacySymbolMappings.map(([id, code, label]) => ({ ...dropsAssets.find(asset => asset.code === code), id, label }));
const legacyCodes = new Set(legacySymbolMappings.map(([, code]) => code));
const standardAssets = [...legacyAssets, ...dropsAssets.filter(asset => !legacyCodes.has(asset.code))];
const standardAssetsById = new Map([...dropsAssets, ...standardAssets].map(asset => [asset.id, asset]));
const starterCodes = new Set(["203005", "203016", "203019", "203028", "203099", "204015", "204047", "204048", "502014", "603029", "602060", "602037", "602038"]);
const starterAssetIds = standardAssets.filter(asset => asset.id.startsWith("builtin-") || starterCodes.has(asset.code)).map(asset => asset.id);
let settingsAssetDraft = new Set();
let settingsAssetPage = 0;
const settingsPageSize = 48;

const defaultTimes = ["07:00", "08:00", "09:00", "12:00", "15:00", "18:00", "21:00"];
const storageKey = "calendar-ui-refresh";
const drawingColors = ["#29352e", "#3f7659", "#e45454", "#f0a23b", "#4386c6", "#8b63b8", "#ef7dad", "#ffffff"];
const weekdayKanji = ["日", "月", "火", "水", "木", "金", "土"];
const weekdayHiragana = ["にち", "げつ", "か", "すい", "もく", "きん", "ど"];
const assetCategories = {
  "builtin-wake": "life", "builtin-breakfast": "life", "builtin-brush": "life",
  "builtin-school": "school", "builtin-lunch": "life", "builtin-sports": "play",
  "builtin-study": "school", "builtin-play": "play", "builtin-bath": "life",
  "builtin-dinner": "life", "builtin-sleep": "life", "builtin-special": "event"
};

const loginView = document.querySelector("#loginView");
const dashboardView = document.querySelector("#dashboardView");
const editorView = document.querySelector("#editorView");
const drawingView = document.querySelector("#drawingView");
const calendarGrid = document.querySelector("#calendarGrid");
const calendarCanvas = document.querySelector("#calendarCanvas");
const createDialog = document.querySelector("#createDialog");
const fileDialog = document.querySelector("#fileDialog");
const imageEditDialog = document.querySelector("#imageEditDialog");
const settingsDialog = document.querySelector("#settingsDialog");
const saveChoiceDialog = document.querySelector("#saveChoiceDialog");
const drawingCanvas = document.querySelector("#drawingCanvas");
const drawingContext = drawingCanvas.getContext("2d");

let activeFilter = "all";
let calendarSearchText = "";
let activeCalendarId = null;
let activeEditingAssetId = null;
let imageEditorFromLibrary = false;
let selectedAssetIndex = 0;
let draggedAssetIndex = null;
let selectedCreateType = "day";
let activeAssetCategory = "all";
let assetSearchText = "";
let drawingMode = "pen";
let drawing = false;
let drawingHistory = [];
let drawingHistoryIndex = -1;
let pendingLibraryFiles = [];

// カレンダーや画像を画面内で一意に扱うためのIDを作る。
function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ユーザー入力をHTMLへ安全に表示できる文字列へ変換する。
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

// 日付入力で使える今日の日付をローカル時間から作る。
function getTodayString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

// 標準画像の編集済み属性を重ね、自作画像も含めた一覧を返す。
function getAllAssets() {
  return [...standardAssets.map(asset => ({ ...asset, ...(state.preferences.assetMetadata?.[asset.id] || {}) })), ...state.customAssets];
}

// 表示対象だけを絞り、配置済みデータと全素材のID・配列位置は変更しない。
function isAssetEnabled(asset) {
  if (asset.custom) return !(state.preferences.hiddenCustomAssetIds || []).includes(asset.id);
  return (state.preferences.enabledStandardAssetIds || starterAssetIds).includes(asset.id);
}

// 設定は保存するまで下書きとして扱い、閉じる操作で変更を破棄できるようにする。
function openSettings() {
  applyPreferences();
  settingsAssetDraft = new Set(getAllAssets().filter(isAssetEnabled).map(asset => asset.id));
  settingsAssetPage = 0;
  document.querySelector("#managedAssetSearch").value = "";
  document.querySelector("#managedAssetFilter").value = "selected";
  renderManagedAssets();
  settingsDialog.showModal();
}

// 大量の素材は設定内で検索・ページ分割し、普段のパレットには選んだ画像だけを出す。
function renderManagedAssets() {
  const search = document.querySelector("#managedAssetSearch").value.trim().toLowerCase();
  const selectedOnly = document.querySelector("#managedAssetFilter").value === "selected";
  const matches = getAllAssets().filter(asset => (!selectedOnly || settingsAssetDraft.has(asset.id)) && `${asset.label} ${asset.sourceName || ""} ${asset.code || ""}`.toLowerCase().includes(search));
  const pages = Math.max(1, Math.ceil(matches.length / settingsPageSize));
  settingsAssetPage = Math.min(settingsAssetPage, pages - 1);
  document.querySelector("#managedAssetGrid").innerHTML = matches.slice(settingsAssetPage * settingsPageSize, (settingsAssetPage + 1) * settingsPageSize).map(asset => `<label class="managed-asset">${assetVisual(asset, "", true)}<span>${escapeHtml(asset.label)}</span><input type="checkbox" data-managed-asset="${escapeHtml(asset.id)}" aria-label="${escapeHtml(asset.label)}を選択画面に表示" ${settingsAssetDraft.has(asset.id) ? "checked" : ""}></label>`).join("");
  document.querySelector("#managedAssetCount").textContent = `${settingsAssetDraft.size}件選択中`;
  document.querySelector("#managedAssetPage").textContent = `${settingsAssetPage + 1} / ${pages}`;
  document.querySelector("#managedAssetPrevious").disabled = settingsAssetPage === 0;
  document.querySelector("#managedAssetNext").disabled = settingsAssetPage === pages - 1;
}

// 保存失敗時は元の設定を戻し、成功した場合だけパレットと選択位置を更新する。
function saveSettings(event) {
  event.preventDefault();
  const previous = state.preferences;
  state.preferences = {
    ...previous,
    largeText: document.querySelector("#largeTextSetting").checked,
    highContrast: document.querySelector("#contrastSetting").checked,
    enabledStandardAssetIds: standardAssets.filter(asset => settingsAssetDraft.has(asset.id)).map(asset => asset.id),
    hiddenCustomAssetIds: state.customAssets.filter(asset => !settingsAssetDraft.has(asset.id)).map(asset => asset.id)
  };
  if (!persistState("設定を保存しました")) { state.preferences = previous; return; }
  const assets = getAllAssets();
  if (!assets[selectedAssetIndex] || !isAssetEnabled(assets[selectedAssetIndex])) selectedAssetIndex = assets.findIndex(isAssetEnabled);
  draggedAssetIndex = null;
  applyPreferences();
  renderAssets();
  settingsDialog.close();
}

// 標準画像は登録済みの同一サイト内URLで描画し、旧データ内の絵文字も置き換える。
function assetVisual(asset, className = "", lazy = false) {
  const standard = !asset?.custom && standardAssetsById.get(asset?.id);
  if (standard) {
    return `<img class="${className}" src="${escapeHtml(standard.icon)}" alt="" loading="${lazy ? "lazy" : "eager"}" decoding="async" draggable="false">`;
  }
  if (asset?.custom && String(asset.icon).startsWith("data:image/")) {
    return `<img class="${className}" src="${asset.icon}" alt="">`;
  }
  return escapeHtml(asset?.icon || "");
}

// DAY形式で編集する時刻別の予定枠を作る。
function createDaySlots(assetIndexes = []) {
  return defaultTimes.map((time, index) => ({
    id: createId("slot"),
    time,
    items: assetIndexes[index] === undefined ? [] : [{ ...standardAssets[assetIndexes[index]] }],
    note: ""
  }));
}

// WEEK形式で曜日別の予定枠を作る。
function createWeekDays(assetIndexes = []) {
  return [1, 2, 3, 4, 5, 6, 0].map((dayIndex, index) => ({
    dayIndex,
    items: assetIndexes[index] === undefined ? [] : [{ ...standardAssets[assetIndexes[index]] }],
    note: ""
  }));
}

// 指定された年月の日数を月間カレンダーの生成に使える形で返す。
function getDaysInMonth(dateString) {
  const date = new Date(`${dateString || getTodayString()}T00:00:00`);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// MONTH形式で日付別の予定枠を作る。
function createMonthDays(dateString, assetIndexes = []) {
  const days = {};
  for (let day = 1; day <= getDaysInMonth(dateString); day += 1) {
    days[day] = {
      items: assetIndexes[day - 1] === undefined ? [] : [{ ...standardAssets[assetIndexes[day - 1]] }],
      note: ""
    };
  }
  return days;
}

// 選択形式に必要なデータを揃えた新しいカレンダーを作る。
function createCalendar(type, title, date, createdOffset = 0) {
  const createdAt = new Date(Date.now() - createdOffset).toISOString();
  const calendar = {
    id: createId("calendar"), title, date, type, createdAt, updatedAt: createdAt, author: "ゲスト",
    background: "#ffffff", colorPreset: "white", scheduleColors: {}, textStyle: "kanji", timeStyle: "kanji",
    weekStart: type === "month" ? "sunday" : "monday", monthCellCount: 1
  };
  if (type === "day") calendar.slots = createDaySlots();
  if (type === "week") calendar.weekDays = createWeekDays();
  if (type === "month") calendar.monthDays = createMonthDays(date);
  return calendar;
}

// 初回表示で3形式の違いが分かる見本カレンダーを作る。
function createDefaultState() {
  const today = getTodayString();
  const day = createCalendar("day", "わたしの1日", today, 0);
  day.slots = createDaySlots([0, 1, 2, 3, 4, 9, 10]);
  const week = createCalendar("week", "こんしゅうの予定", today, 60000);
  week.weekDays = createWeekDays([2, 3, 4, 5, 6, 7, 8]);
  const month = createCalendar("month", `${Number(today.slice(5, 7))}月のカレンダー`, today, 120000);
  month.monthDays = createMonthDays(today, [4, 5, 6, 7, 8, 9, 11]);
  return { customAssets: [], calendars: [day, week, month], preferences: { largeText: false, highContrast: false } };
}

// 旧版のデータを残しながら新しい形式別データを補う。
function normalizeCalendar(calendar, index) {
  const fallbackType = ["day", "week", "month"][index] || "day";
  calendar.type ||= fallbackType;
  calendar.date ||= getTodayString();
  calendar.createdAt ||= new Date(Date.now() - index * 60000).toISOString();
  calendar.updatedAt ||= calendar.createdAt;
  calendar.author ||= "ゲスト";
  calendar.background ||= "#fffdf7";
  calendar.textStyle ||= "kanji";
  if (!["kanji", "hiragana", "clock"].includes(calendar.timeStyle)) calendar.timeStyle = "kanji";
  calendar.weekStart ||= "monday";
  calendar.monthCellCount ||= 2;
  if (calendar.type === "day") {
    calendar.slots ||= createDaySlots();
    calendar.slots.forEach(slot => {
      slot.id ||= createId("slot");
      slot.items ||= [];
      slot.note ||= "";
    });
  }
  if (calendar.type === "week") {
    if (!Array.isArray(calendar.weekDays)) {
      calendar.weekDays = createWeekDays();
      calendar.weekDays.forEach((day, dayIndex) => { day.items = calendar.slots?.[dayIndex]?.items || []; });
    }
    calendar.weekDays.forEach(day => { day.items ||= []; day.note ||= ""; });
  }
  if (calendar.type === "month") {
    if (!calendar.monthDays || Array.isArray(calendar.monthDays)) {
      calendar.monthDays = createMonthDays(calendar.date);
      (calendar.slots || []).slice(0, 7).forEach((slot, dayIndex) => { calendar.monthDays[dayIndex + 1].items = slot.items || []; });
    }
    for (let day = 1; day <= getDaysInMonth(calendar.date); day += 1) {
      calendar.monthDays[day] ||= { items: [], note: "" };
    }
  }
  return calendar;
}

// ブラウザ保存を読み込み、壊れた場合は安全な見本へ戻す。
function loadState() {
  const fallback = createDefaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved?.calendars)) {
      saved.customAssets ||= [];
      saved.customAssets.forEach(asset => { asset.id ||= createId("asset"); asset.custom = true; asset.category ||= ""; });
      saved.preferences ||= { largeText: false, highContrast: false };
      saved.calendars = saved.calendars.map(normalizeCalendar);
      return saved;
    }
  } catch (_) {
    // 保存データが壊れていても作成画面を利用できるよう見本へ戻す。
  }
  return fallback;
}

let state = loadState();
selectedAssetIndex = getAllAssets().findIndex(isAssetEnabled);

// 現在編集中のカレンダーを返す。
function getActiveCalendar() {
  return state.calendars.find(calendar => calendar.id === activeCalendarId);
}

// 状態をブラウザへ保存し、容量不足などの失敗を画面へ伝える。
function persistState(message = "") {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    if (message) showToast(message);
    return true;
  } catch (_) {
    showToast("保存容量が足りません。登録画像を減らしてください");
    return false;
  }
}

// 操作結果を短時間表示して完了を伝える。
function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

// Android版ではネイティブ保存画面を使い、ブラウザ版では通常のダウンロードを行う。
function saveTextDownload(text, fileName, mimeType) {
  if (window.AndroidBridge?.saveTextFile) {
    window.AndroidBridge.saveTextFile(fileName, mimeType, text);
    return;
  }
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

// Data URL画像をAndroidまたはブラウザの保存処理へ渡す。
function saveDataUrlDownload(dataUrl, fileName, mimeType) {
  if (window.AndroidBridge?.saveBase64File) {
    window.AndroidBridge.saveBase64File(fileName, mimeType, dataUrl.split(",")[1] || "");
    return;
  }
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.click();
}

// 編集が保存前であることを操作直後に伝える。
function markDirty() {
  document.querySelector("#saveStatus").textContent = "未保存の変更";
}

// ホーム・編集・お絵描きの表示を切り替える。
function showView(viewName) {
  loginView.hidden = true;
  dashboardView.hidden = viewName !== "dashboard";
  editorView.hidden = viewName !== "editor";
  drawingView.hidden = viewName !== "drawing";
  document.body.dataset.view = viewName;
  if (viewName === "dashboard") renderCards();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// 認証方式が決まるまで利用できるログイン選択画面を表示する。
function showLoginView() {
  loginView.hidden = false;
  dashboardView.hidden = true;
  editorView.hidden = true;
  drawingView.hidden = true;
  document.body.dataset.view = "login";
}

// 現在のタブをゲスト利用として扱い、既存のローカル保存画面へ進める。
function enterGuestMode() {
  try {
    sessionStorage.setItem("make-calendar-session-mode", "guest");
  } catch (_) {
    // セッション保存が使えない環境でもゲスト利用自体は続けられる。
  }
  showView("dashboard");
}

// 同じタブでゲスト利用を選択済みかを安全に確認する。
function hasGuestSession() {
  try {
    return sessionStorage.getItem("make-calendar-session-mode") === "guest";
  } catch (_) {
    return false;
  }
}

// 設定した文字サイズとコントラストを画面全体へ反映する。
function applyPreferences() {
  document.body.classList.toggle("large-text", Boolean(state.preferences.largeText));
  document.body.classList.toggle("high-contrast", Boolean(state.preferences.highContrast));
  document.querySelector("#largeTextSetting").checked = Boolean(state.preferences.largeText);
  document.querySelector("#contrastSetting").checked = Boolean(state.preferences.highContrast);
}

// 一覧やカレンダーの小さなプレビュー用に画像を描画する。
function previewAsset(item) {
  return `<span class="preview-asset">${assetVisual(item)}</span>`;
}

// DAYカード用の時間割プレビューを作る。
function renderDayPreview(calendar) {
  return renderPaperPreview(calendar, renderDayCalendar(calendar));
}

// WEEKカード用の7列プレビューを作る。
function renderWeekPreview(calendar) {
  return renderPaperPreview(calendar, renderWeekCalendar(calendar));
}

// MONTHカード用の月間マス目プレビューを作る。
function renderMonthPreview(calendar) {
  return renderPaperPreview(calendar, renderMonthCalendar(calendar));
}

// カードと作成ダイアログに、操作部品を除いた同じ用紙を縮小表示する。
function renderPaperPreview(calendar, paper) {
  return '<div class="preview-paper preview-' + calendar.type + '" style="--calendar-bg:' + escapeHtml(calendar.background) + '" inert>' + paper + '</div>';
}

// カレンダー形式に合った一覧カードのプレビューを選ぶ。
function renderCardPreview(calendar) {
  if (calendar.type === "week") return renderWeekPreview(calendar);
  if (calendar.type === "month") return renderMonthPreview(calendar);
  return renderDayPreview(calendar);
}

// 保存済みカレンダーを新しい順に3列のカードとして描画する。
function renderCards() {
  const visible = state.calendars
    .filter(calendar => activeFilter === "all" || calendar.type === activeFilter)
    .filter(calendar => !calendarSearchText || calendar.title.toLowerCase().includes(calendarSearchText))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  calendarGrid.innerHTML = visible.map(calendar => {
    const updated = new Date(calendar.updatedAt || calendar.createdAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
    return `<article class="calendar-card" data-type="${calendar.type}">
      <div class="card-information"><div class="card-title-row" data-card-title="${calendar.id}"><h2>${escapeHtml(calendar.title)}</h2></div><button class="edit-card-button" type="button" data-rename-card="${calendar.id}" aria-label="カレンダー名を変更">✎</button><p class="card-meta">最終更新：${updated}</p></div>
      <div class="card-preview">${renderCardPreview(calendar)}</div>
      <div class="card-actions"><button class="card-action" type="button" data-print-card="${calendar.id}">印刷</button><button class="card-action" type="button" data-save-card="${calendar.id}">保存</button><button class="card-action" type="button" data-edit="${calendar.id}">編集</button></div>
    </article>`;
  }).join("");
}

// Homeカードのタイトルを、その場で編集できる入力欄へ切り替える。
function startCardRename(calendarId) {
  const calendar = state.calendars.find(item => item.id === calendarId);
  const titleRow = calendarGrid.querySelector(`[data-card-title="${CSS.escape(calendarId)}"]`);
  if (!calendar || !titleRow) return;
  titleRow.innerHTML = `<input class="card-title-input" data-rename-input="${calendar.id}" value="${escapeHtml(calendar.title)}" maxlength="60" aria-label="カレンダー名">`;
  const input = titleRow.querySelector("input");
  input.focus();
  input.select();
}

// Homeカードで入力された名前を保存し、一覧表示へ戻す。
function finishCardRename(input, cancel = false) {
  if (!input?.isConnected) return;
  const calendar = state.calendars.find(item => item.id === input.dataset.renameInput);
  if (!calendar) return;
  if (!cancel) {
    calendar.title = input.value.trim() || calendar.title;
    calendar.updatedAt = new Date().toISOString();
    persistState("カレンダー名を変更しました");
  }
  renderCards();
}

// 選択中のカテゴリと検索語に一致する画像と元の配列位置を返す。
function getVisibleAssets() {
  return getAllAssets().map((asset, index) => ({ asset, index })).filter(({ asset }) => {
    const categoryMatches = activeAssetCategory === "all" || (asset.category ?? assetCategories[asset.id]) === activeAssetCategory;
    const searchMatches = !assetSearchText || `${asset.label} ${asset.sourceName || ""} ${asset.keywords || ""} ${asset.code || ""}`.toLowerCase().includes(assetSearchText);
    return isAssetEnabled(asset) && categoryMatches && searchMatches;
  });
}

// 左のパレットへ絞り込み後の画像を描画する。
function renderAssets() {
  document.querySelector("#assetGrid").innerHTML = getVisibleAssets().map(({ asset, index }) => `
    <div class="asset-tile"><button class="asset-button ${index === selectedAssetIndex ? "selected" : ""}" type="button" data-asset="${index}" draggable="true" aria-label="${escapeHtml(asset.label)}" title="${escapeHtml(asset.label)}（ドラッグできます）" aria-pressed="${index === selectedAssetIndex}">${assetVisual(asset, "", true)}</button><button class="asset-more asset-edit-button" type="button" data-edit-library-asset="${asset.id}" aria-label="${escapeHtml(asset.label)}を編集">•••</button></div>
  `).join("");
}

// 有効な標準画像とアップロード済み画像を、ファイル画面の左側へ並べる。
function renderLibraryAssets() {
  const search = document.querySelector("#librarySearch").value.trim().toLowerCase();
  document.querySelector("#libraryAssetGrid").innerHTML = getAllAssets().filter(asset => asset.custom || isAssetEnabled(asset)).filter(asset => !search || `${asset.label} ${asset.sourceName || ""} ${asset.keywords || ""} ${asset.code || ""}`.toLowerCase().includes(search)).map(asset => `<div class="library-asset-card"><button class="library-asset" type="button" data-library-asset="${asset.id}" title="${escapeHtml(asset.label)}">${assetVisual(asset)}</button><button class="asset-more asset-edit-button" type="button" data-edit-library-asset="${asset.id}" aria-label="${escapeHtml(asset.label)}を編集">•••</button></div>`).join("");
}

// 標準・自作画像の編集を、呼び出し元を保持したポップアップで開く。
function openImageEditor(assetId) {
  const asset = getAllAssets().find(item => item.id === assetId);
  if (!asset) return;
  activeEditingAssetId = asset.id;
  imageEditorFromLibrary = fileDialog.open;
  document.querySelector('#imageEditPreview').innerHTML = assetVisual(asset);
  document.querySelector('#imageEditName').value = asset.label;
  document.querySelector('#imageEditCategory').value = asset.category ?? assetCategories[asset.id] ?? '';
  if (fileDialog.open) fileDialog.close();
  imageEditDialog.showModal();
}

// 元の標準素材を変更せず、利用者が変更した名前とカテゴリを保存する。
function saveImageMetadata() {
  const asset = getAllAssets().find(item => item.id === activeEditingAssetId);
  if (!asset) return true;
  const metadata = {
    label: document.querySelector('#imageEditName').value.trim() || asset.label,
    category: document.querySelector('#imageEditCategory').value
  };
  const previous = structuredClone(state);
  if (asset.custom) Object.assign(state.customAssets.find(item => item.id === asset.id), metadata);
  else {
    state.preferences.assetMetadata ||= {};
    state.preferences.assetMetadata[asset.id] = metadata;
  }
  if (!persistState()) { state = previous; return false; }
  renderAssets();
  renderIllustrationGallery();
  return true;
}

// 編集を保存して閉じ、画像選択から開いた場合はそのまま編集画面へ戻す。
function returnToImageLibrary() {
  if (!saveImageMetadata()) return;
  imageEditDialog.close();
  activeEditingAssetId = null;
  renderLibraryAssets();
  if (imageEditorFromLibrary) fileDialog.showModal();
}

// 標準画像は選択一覧から外し、自作画像は登録を削除する。配置済み画像は残す。
function deleteEditingImage() {
  const asset = getAllAssets().find(item => item.id === activeEditingAssetId);
  if (!asset) return;
  const previous = structuredClone(state);
  if (asset.custom) state.customAssets = state.customAssets.filter(item => item.id !== asset.id);
  else state.preferences.enabledStandardAssetIds = (state.preferences.enabledStandardAssetIds || starterAssetIds).filter(id => id !== asset.id);
  if (!persistState()) { state = previous; return; }
  activeEditingAssetId = null;
  selectedAssetIndex = getAllAssets().findIndex(isAssetEnabled);
  renderAssets();
  renderIllustrationGallery();
  imageEditDialog.close();
  renderLibraryAssets();
  if (imageEditorFromLibrary) fileDialog.showModal();
}

// 漢字・ひらがなの設定に合った曜日名を返す。
function getWeekdayLabel(dayIndex, textStyle, long = false) {
  const source = textStyle === "hiragana" ? weekdayHiragana : weekdayKanji;
  return `${source[dayIndex]}${long ? (textStyle === "hiragana" ? "ようび" : "曜日") : ""}`;
}

// Weekは指定日の曜日から7日間、Monthは週の始まり設定に合わせて並べる。
function getWeekOrder(calendar) {
  if (calendar.type === "week") {
    const firstDay = new Date(`${calendar.date}T00:00:00`).getDay();
    return Array.from({ length: 7 }, (_, index) => (firstDay + index) % 7);
  }
  return calendar.weekStart === "sunday" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
}

// Weekは指定日そのもの、その他は設定された曜日の週頭を返す。
function getWeekStartDate(calendar) {
  const date = new Date(`${calendar.date}T00:00:00`);
  if (calendar.type === "week") return date;
  const firstDay = calendar.weekStart === "sunday" ? 0 : 1;
  const difference = (date.getDay() - firstDay + 7) % 7;
  date.setDate(date.getDate() - difference);
  return date;
}

// 旧データにも位置を補い、削除しても他の画像が左や上へ詰まらないようにする。
function getPositionedItems(items) {
  const used = new Set();
  return items.map(item => {
    let cellIndex = Number.isInteger(item.cellIndex) && item.cellIndex >= 0 && item.cellIndex < 100 ? item.cellIndex : 0;
    while (used.has(cellIndex)) cellIndex += 1;
    used.add(cellIndex);
    return { ...item, cellIndex };
  });
}

// 空きマスを含む配置ボタンを描画し、クリックとドロップの位置を共通化する。
function renderPlacedItems(items, targetKey, baseCount = 5) {
  const positioned = getPositionedItems(items);
  const count = Math.max(baseCount, ...positioned.map(item => item.cellIndex + 1));
  return Array.from({ length: count }, (_, cellIndex) => {
    const index = positioned.findIndex(item => item.cellIndex === cellIndex);
    const item = positioned[index];
    const common = 'type="button" data-drop-key="' + targetKey + '" data-cell-index="' + cellIndex + '"';
    if (!item) return '<button class="placement-cell empty-cell" ' + common + ' data-add-key="' + targetKey + '" aria-label="' + (cellIndex + 1) + '番目の枠に画像を配置"></button>';
    return '<button class="placement-cell placed-item" ' + common + ' data-remove-index="' + index + '" data-target-key="' + targetKey + '" aria-label="' + escapeHtml(item.label) + 'を外す"><span class="placed-icon">' + assetVisual(item) + '</span><span class="remove-mark">×</span></button>';
  }).join('');
}

// 時刻を数字と漢字・ひらがなの単位で表し、分のある予定も省略しない。
function formatDayTime(time, style) {
  const [hour, minute] = time.split(':').map(Number);
  if (style === 'hiragana') return hour + 'じ' + (minute ? minute + 'ふん' : '');
  return hour + '時' + (minute ? minute + '分' : '');
}

// 最も長い時間に合わせた共通の座標幅を求め、全行の文字サイズを揃える。
function getDayTimeWidth(slots, style) {
  const context = document.createElement('canvas').getContext('2d');
  context.font = '80px "Yu Gothic UI", "Hiragino Sans", Meiryo, sans-serif';
  return Math.ceil(Math.max(1, ...slots.map(slot => context.measureText(formatDayTime(slot.time, style)).width))) + 4;
}

// ドロップレットの正時素材または共通縮尺の文字を、時間欄いっぱいに表示する。
function renderDayTime(time, style, textWidth) {
  const label = formatDayTime(time, style);
  if (style === 'clock') {
    const [hour, minute] = time.split(':').map(Number);
    const clock = dropsAssets.find(asset => asset.code === String(604026 + (hour % 12 || 12)));
    if (clock) return '<span class="day-clock"><img src="' + escapeHtml(clock.icon) + '" alt="' + (hour % 12 || 12) + '時の時計">' + (minute ? '<small>' + hour + '時＋' + minute + '分</small>' : '') + '</span>';
  }
  return '<svg class="day-time-label" viewBox="0 0 ' + textWidth + ' 96" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + escapeHtml(label) + '"><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="80" fill="black">' + escapeHtml(label) + '</text></svg>';
}

// 保存・共有データから渡る色を安全な16進色へ揃える。
function safeCalendarColor(value, fallback = '#ffffff') {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
}

// 旧カレンダーの背景色を引き継ぎ、新規作成時は真っ白にする。
function getColorPreset(calendar) {
  const allowed = calendar.type === 'day' ? ['white', 'auto', 'custom'] : ['white', 'weekend', 'custom'];
  return allowed.includes(calendar.colorPreset) ? calendar.colorPreset : (safeCalendarColor(calendar.background) === '#ffffff' ? 'white' : 'custom');
}

// 用紙全体の背景色を一覧・編集・印刷で共通に決める。
function getPaperColor(calendar) {
  return getColorPreset(calendar) === 'white' ? '#ffffff' : safeCalendarColor(calendar.background);
}

// 時間帯または曜日の配色を求め、ユーザーの個別指定を優先する。
function getScheduleColor(calendar, key, time = '') {
  const preset = getColorPreset(calendar);
  if (preset === 'white') return '#ffffff';
  const override = calendar.scheduleColors?.[key];
  if (override && /^#[0-9a-f]{6}$/i.test(override)) return override;
  if (preset === 'auto' && calendar.type === 'day') {
    const hour = Number(time.split(':')[0]);
    if (hour < 6) return '#e4dff4';
    if (hour < 10) return '#fff0b3';
    if (hour < 14) return '#dceec8';
    if (hour < 18) return '#d5eafa';
    if (hour < 21) return '#ffe0c2';
    return '#e4dff4';
  }
  if (preset === 'weekend') {
    if (Number(key) === 6) return '#b9d9ff';
    if (Number(key) === 0) return '#ffc4c4';
  }
  return getPaperColor(calendar);
}

// カレンダー設定に配色プリセットと時間・曜日別の色入力を並べる。
function renderColorSettings(calendar) {
  const preset = getColorPreset(calendar);
  document.querySelector('#calendarColorPreset').innerHTML = '<option value="white">真っ白</option>' + (calendar.type === 'day' ? '<option value="auto">自動カラー</option>' : '<option value="weekend">土曜：青・日曜：赤</option>') + '<option value="custom">カスタム</option>';
  document.querySelector('#calendarColorPreset').value = preset;
  document.querySelector('#calendarBackground').value = getPaperColor(calendar);
  const entries = calendar.type === 'day'
    ? calendar.slots.slice().sort((a, b) => a.time.localeCompare(b.time)).map(slot => ({ key: slot.id, label: formatDayTime(slot.time, calendar.timeStyle), time: slot.time }))
    : getWeekOrder(calendar).map(day => ({ key: String(day), label: getWeekdayLabel(day, calendar.textStyle, true), time: '' }));
  document.querySelector('#scheduleColorFields').innerHTML = entries.map(entry => '<label class="schedule-color-field"><span>' + escapeHtml(entry.label) + '</span><input type="color" data-schedule-color="' + escapeHtml(entry.key) + '" value="' + getScheduleColor(calendar, entry.key, entry.time) + '" aria-label="' + escapeHtml(entry.label) + 'の色"></label>').join('');
}

// DAY形式の時刻別編集画面を、全行共通の文字縮尺で描画する。
function renderDayCalendar(calendar) {
  const date = new Date(`${calendar.date}T00:00:00`);
  const slots = calendar.slots.slice().sort((left, right) => left.time.localeCompare(right.time));
  const timeWidth = getDayTimeWidth(slots, calendar.timeStyle);
  return `<article style="--calendar-bg:${getPaperColor(calendar)}" class="calendar-paper day-paper ${calendar.textStyle === "hiragana" ? "hiragana" : ""}">
    <header class="calendar-paper-header"><h2>${date.getMonth() + 1}${calendar.textStyle === "hiragana" ? "がつ" : "月"}${date.getDate()}${calendar.textStyle === "hiragana" ? "にち" : "日"}</h2></header>
    <div class="day-grid" style="--row-count:${Math.max(1, slots.length)}">${slots.map(slot => {
      const key = `day:${slot.id}`;
      return `<div class="schedule-row" style="background-color:${getScheduleColor(calendar, slot.id, slot.time)}"><div class="schedule-time-editor">${renderDayTime(slot.time, calendar.timeStyle, timeWidth)}<input class="schedule-time-input" type="time" value="${slot.time}" data-time-id="${slot.id}" aria-label="時間を変更"><button class="delete-time-button" type="button" data-delete-time="${slot.id}" aria-label="${slot.time}の枠を削除">×</button></div><div class="drop-cell" data-drop-key="${key}"><div class="placed-items">${renderPlacedItems(slot.items, key)}</div></div></div>`;
    }).join("")}</div>
  </article>`;
}

// WEEK形式の7列編集画面を描画する。
function renderWeekCalendar(calendar) {
  const order = getWeekOrder(calendar);
  return `<article style="--calendar-bg:${getPaperColor(calendar)}" class="calendar-paper week-paper ${calendar.textStyle === "hiragana" ? "hiragana" : ""}">
    <div class="week-grid">${order.map(dayIndex => {
      const day = calendar.weekDays.find(item => item.dayIndex === dayIndex);
      const key = `week:${dayIndex}`;
      return `<section class="week-column" style="background-color:${getScheduleColor(calendar, String(dayIndex))}"><div class="week-heading">${getWeekdayLabel(dayIndex, calendar.textStyle)}</div><div class="drop-cell week-drop" data-drop-key="${key}"><div class="placed-items">${renderPlacedItems(day.items, key)}</div></div></section>`;
    }).join("")}</div>
  </article>`;
}

// MONTH形式の月間グリッド編集画面を描画する。
function renderMonthCalendar(calendar) {
  const date = new Date(`${calendar.date}T00:00:00`);
  const days = getDaysInMonth(calendar.date);
  const firstDate = new Date(date.getFullYear(), date.getMonth(), 1);
  const order = getWeekOrder(calendar);
  const firstOffset = order.indexOf(firstDate.getDay());
  const cells = Array.from({ length: firstOffset }, () => '<div class="month-cell blank"></div>');
  for (let dayNumber = 1; dayNumber <= days; dayNumber += 1) {
    const entry = calendar.monthDays[dayNumber] || { items: [], note: "" };
    const key = `month:${dayNumber}`;
    cells.push(`<div class="month-cell drop-cell" style="background-color:${getScheduleColor(calendar, String(new Date(date.getFullYear(), date.getMonth(), dayNumber).getDay()))}" data-drop-key="${key}"><span class="month-day-number">${dayNumber}</span><div class="placed-items">${renderPlacedItems(entry.items, key, Number(calendar.monthCellCount))}</div></div>`);
  }
  return `<article style="--calendar-bg:${getPaperColor(calendar)}" class="calendar-paper month-paper ${calendar.textStyle === "hiragana" ? "hiragana" : ""}"><header class="calendar-paper-header"><h2>${date.getMonth() + 1}${calendar.textStyle === "hiragana" ? "がつ" : "月"}</h2></header><div class="month-grid" style="--month-rows:${Math.ceil((firstOffset + days) / 7)}">${order.map(dayIndex => `<div class="month-weekday" style="background-color:${getScheduleColor(calendar, String(dayIndex))}">${getWeekdayLabel(dayIndex, calendar.textStyle)}</div>`).join("")}${cells.join("")}</div></article>`;
}

// 選択形式に対応したカレンダー編集面を描画する。
function renderCalendar() {
  const calendar = getActiveCalendar();
  if (!calendar) return;
  calendarCanvas.style.setProperty("--calendar-bg", calendar.background);
  if (calendar.type === "week") calendarCanvas.innerHTML = renderWeekCalendar(calendar);
  else if (calendar.type === "month") calendarCanvas.innerHTML = renderMonthCalendar(calendar);
  else calendarCanvas.innerHTML = renderDayCalendar(calendar);
  renderColorSettings(calendar);
}

// 編集中の形式に必要な設定だけを表示する。
function renderEditorSettings(calendar) {
  document.querySelector("#calendarTitle").value = calendar.title;
  document.querySelector("#editorTypeBadge").textContent = calendar.type.toUpperCase();
  const dateInput = document.querySelector("#calendarDate");
  dateInput.type = calendar.type === "month" ? "month" : "date";
  dateInput.value = calendar.type === "month" ? calendar.date.slice(0, 7) : calendar.date;
  document.querySelector("#calendarDateLabel").textContent = calendar.type === "month" ? "カレンダーの月" : calendar.type === "week" ? "カレンダーの初めの日付" : "カレンダーの日付";
  document.querySelector("#textStyleLabel").textContent = calendar.type === "week" ? "曜日の表記" : "日付の表記";
  document.querySelector("#calendarBackground").value = calendar.background;
  document.querySelector("#textStyle").value = calendar.textStyle;
  document.querySelector("#timeStyle").value = calendar.timeStyle;
  document.querySelector("#weekStart").value = calendar.weekStart;
  document.querySelector("#monthCellCount").value = String(calendar.monthCellCount);
  document.querySelectorAll(".day-only-setting").forEach(element => { element.hidden = calendar.type !== "day"; });
  document.querySelectorAll(".week-only-setting").forEach(element => { element.hidden = calendar.type !== "week"; });
  document.querySelectorAll(".week-month-setting").forEach(element => { element.hidden = !["week", "month"].includes(calendar.type); });
  document.querySelectorAll(".month-only-setting").forEach(element => { element.hidden = calendar.type !== "month"; });
}

// 指定された保存済みカレンダーを対応形式の編集画面で開く。
function openEditor(calendarId) {
  activeCalendarId = calendarId;
  const calendar = getActiveCalendar();
  if (!calendar) return;
  document.querySelector("#saveStatus").textContent = "保存済み";
  renderEditorSettings(calendar);
  renderAssets();
  renderCalendar();
  showEditorSidePanel("assets");
  showView("editor");
}

// 編集画面の画像一覧とカレンダー設定を選択項目に応じて切り替える。
function showEditorSidePanel(panelName, activeButton = document.querySelector("#backButton")) {
  document.querySelector("#palettePanel").hidden = panelName !== "assets";
  document.querySelector("#calendarSettingsPanel").hidden = panelName !== "settings";
  document.querySelectorAll(".rail-button").forEach(button => button.classList.toggle("active", button === activeButton));
}

// DAY・WEEK・MONTHのキーから対象の予定枠を返す。
function getTargetByKey(targetKey) {
  const calendar = getActiveCalendar();
  const [type, value] = String(targetKey).split(":");
  if (type === "day") return calendar.slots.find(slot => slot.id === value);
  if (type === "week") return calendar.weekDays.find(day => day.dayIndex === Number(value));
  if (type === "month") return calendar.monthDays[Number(value)];
  return null;
}

// 選んだ画像を押したマスへ配置し、他のマスの位置を保つ。
function addAssetToTarget(targetKey, assetIndex, cellIndex) {
  const target = getTargetByKey(targetKey);
  const asset = getAllAssets()[assetIndex];
  if (!target || !asset || !isAssetEnabled(asset)) return;
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= 100) return;
  target.items = getPositionedItems(target.items);
  const existingIndex = target.items.findIndex(item => item.cellIndex === cellIndex);
  const placed = { ...asset, cellIndex };
  if (existingIndex >= 0) target.items[existingIndex] = placed;
  else target.items.push(placed);
  markDirty();
  renderCalendar();
}

// 編集内容をブラウザへ保存してホームのカードにも反映する。
function saveCalendar() {
  const calendar = getActiveCalendar();
  if (!calendar) return false;
  calendar.title = document.querySelector("#calendarTitle").value.trim() || calendar.title;
  calendar.updatedAt = new Date().toISOString();
  if (persistState("カレンダーを保存しました")) {
    document.querySelector("#saveStatus").textContent = "保存済み";
    renderCards();
    return true;
  }
  return false;
}

// 保存を確定してからPDFまたは共有形式の選択画面を開く。
function openSaveChoices() {
  if (saveCalendar()) saveChoiceDialog.showModal();
}

// カレンダー形式ごとの予定枠から配置済み画像の配列を集める。
function getCalendarItemCollections(calendar) {
  if (calendar.type === "day") return calendar.slots.map(slot => slot.items);
  if (calendar.type === "week") return calendar.weekDays.map(day => day.items);
  return Object.values(calendar.monthDays).map(day => day.items);
}

// ファイル名に使えない文字を置き換えて共有ファイル名を作る。
function createExportFileName(title) {
  const safeTitle = String(title || "calendar").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return `${safeTitle || "calendar"}.makecal`;
}

// 編集中カレンダーと必要な自作画像を.makecalファイルへ書き出す。
function exportCurrentCalendar() {
  const calendar = getActiveCalendar();
  if (!calendar) return;
  // 一覧から削除しても予定に残っている画像を、共有先で復元できるよう同梱する。
  const usedAssets = new Map(getCalendarItemCollections(calendar).flat().filter(item => item.custom).map(item => [item.id, item]));
  const payload = {
    format: "make-illustration-calendar",
    version: 1,
    exportedAt: new Date().toISOString(),
    calendar: structuredClone(calendar),
    assets: [...usedAssets.values()].map(asset => structuredClone(asset))
  };
  saveTextDownload(JSON.stringify(payload, null, 2), createExportFileName(calendar.title), "application/vnd.make-calendar+json");
  showToast("共有ファイルを書き出しました");
}

// 各予定枠が画像配列を持つ安全なオブジェクトかを確認する。
function isValidItemCollection(collection) {
  return Array.isArray(collection) && collection.every(item => item && typeof item === "object" && Array.isArray(item.items) && item.items.every(asset => asset && typeof asset === "object"));
}

// 読み込んだ共有データが対応形式かを安全に確認する。
function validateImportPayload(payload) {
  if (payload?.format !== "make-illustration-calendar" || payload.version !== 1) return false;
  const calendar = payload.calendar;
  if (!calendar || !["day", "week", "month"].includes(calendar.type)) return false;
  if (calendar.type === "day" && !isValidItemCollection(calendar.slots)) return false;
  if (calendar.type === "week" && !isValidItemCollection(calendar.weekDays)) return false;
  if (calendar.type === "month" && (!calendar.monthDays || Array.isArray(calendar.monthDays) || !isValidItemCollection(Object.values(calendar.monthDays)))) return false;
  return true;
}

// インポート値を画面で扱える範囲へ揃え、想定外の表示値を持ち込まない。
function sanitizeImportedCalendar(calendar) {
  calendar.colorPreset = getColorPreset(calendar);
  calendar.scheduleColors = Object.fromEntries(Object.entries(calendar.scheduleColors && typeof calendar.scheduleColors === 'object' && !Array.isArray(calendar.scheduleColors) ? calendar.scheduleColors : {}).filter(([key, color]) => key !== '__proto__' && /^#[0-9a-f]{6}$/i.test(color)));
  calendar.title = typeof calendar.title === "string" ? calendar.title.trim().slice(0, 100) || "インポートしたカレンダー" : "インポートしたカレンダー";
  calendar.date = /^\d{4}-\d{2}-\d{2}$/.test(calendar.date || "") ? calendar.date : getTodayString();
  calendar.author = typeof calendar.author === "string" ? calendar.author.slice(0, 100) : "ゲスト";
  calendar.background = /^#[0-9a-f]{6}$/i.test(calendar.background || "") ? calendar.background : "#fffdf7";
  calendar.textStyle = ["kanji", "hiragana"].includes(calendar.textStyle) ? calendar.textStyle : "kanji";
  calendar.timeStyle = ["kanji", "hiragana", "clock"].includes(calendar.timeStyle) ? calendar.timeStyle : "kanji";
  calendar.weekStart = ["monday", "sunday"].includes(calendar.weekStart) ? calendar.weekStart : "monday";
  calendar.monthCellCount = [1, 2, 3].includes(Number(calendar.monthCellCount)) ? Number(calendar.monthCellCount) : 2;
}

// 共有データ内の画像IDを新しいIDへ置き換え、既存画像との衝突を防ぐ。
function remapImportedAssets(calendar, assets) {
  const assetMap = new Map();
  const importedAssets = assets.filter(asset => asset?.custom && typeof asset.id === "string" && typeof asset.label === "string" && /^data:image\/(png|jpeg|webp);base64,/i.test(asset.icon || "")).map(asset => {
    const newId = createId("asset");
    const importedAsset = { id: newId, label: asset.label.slice(0, 100), icon: asset.icon, custom: true, category: ["life", "school", "people", "play", "action", "event"].includes(asset.category) ? asset.category : "" };
    assetMap.set(asset.id, importedAsset);
    return importedAsset;
  });
  getCalendarItemCollections(calendar).forEach(items => {
    const safeItems = getPositionedItems(items).flatMap(item => {
      if (item.custom) return assetMap.has(item.id) ? [{ ...assetMap.get(item.id), cellIndex: item.cellIndex }] : [];
      const standardAsset = standardAssetsById.get(item.id);
      return standardAsset ? [{ ...standardAsset, cellIndex: item.cellIndex }] : [];
    });
    items.splice(0, items.length, ...safeItems);
  });
  return importedAssets;
}

// .makecalを検証し、新しい保存済みカレンダーとして追加する。
async function importCalendarFile(file) {
  if (!file || file.size > 10 * 1024 * 1024) {
    showToast("10MB以下の.makecalファイルを選んでください");
    return false;
  }
  try {
    const payload = JSON.parse(await file.text());
    if (!validateImportPayload(payload)) throw new Error("invalid-format");
    const calendar = structuredClone(payload.calendar);
    sanitizeImportedCalendar(calendar);
    calendar.id = createId("calendar");
    calendar.createdAt = new Date().toISOString();
    calendar.updatedAt = calendar.createdAt;
    if (calendar.type === "day") {
      const colors = {};
      calendar.slots.forEach(slot => {
        const color = calendar.scheduleColors[slot.id];
        slot.id = createId("slot");
        if (color) colors[slot.id] = color;
      });
      calendar.scheduleColors = colors;
    }
    normalizeCalendar(calendar, state.calendars.length);
    const assets = remapImportedAssets(calendar, Array.isArray(payload.assets) ? payload.assets : []);
    const previousAssets = state.customAssets;
    const previousCalendars = state.calendars;
    state.customAssets = [...assets, ...previousAssets];
    state.calendars = [calendar, ...previousCalendars];
    if (!persistState()) {
      state.customAssets = previousAssets;
      state.calendars = previousCalendars;
      return false;
    }
    renderAssets();
    renderLibraryAssets();
    renderIllustrationGallery();
    renderCards();
    return true;
  } catch (_) {
    showToast("この共有ファイルは読み込めません");
    return false;
  }
}

// 現在の形式に配置された画像をすべて外す。
function clearCurrentCalendar() {
  const calendar = getActiveCalendar();
  if (calendar.type === "day") calendar.slots.forEach(slot => { slot.items = []; });
  if (calendar.type === "week") calendar.weekDays.forEach(day => { day.items = []; });
  if (calendar.type === "month") Object.values(calendar.monthDays).forEach(day => { day.items = []; });
  markDirty();
  renderCalendar();
}

// 新規作成ポップアップへ選択形式の簡易プレビューを描画する。
function renderCreatePreview() {
  const preview = document.querySelector("#createPreview");
  const mock = createDefaultState().calendars.find(calendar => calendar.type === selectedCreateType);
  if (selectedCreateType === "week") preview.innerHTML = renderWeekPreview(mock);
  else if (selectedCreateType === "month") preview.innerHTML = renderMonthPreview(mock);
  else preview.innerHTML = renderDayPreview(mock);
}

// 画像ファイルをブラウザ保存向けの小さなPNGへ変換する。
function fileToAsset(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read-error"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("image-error"));
      image.onload = () => {
        const size = 320;
        const scale = Math.min(size / image.width, size / image.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({ id: createId("asset"), icon: canvas.toDataURL("image/png"), label: file.name.replace(/\.[^.]+$/, "").slice(0, 30) || "追加画像", custom: true, category: "" });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// 選択された複数画像をパレットへ登録する。
async function addUploadedFiles(fileList, showResult = true) {
  const files = [...fileList].filter(file => file.type.startsWith("image/"));
  if (!files.length) return [];
  try {
    const added = await Promise.all(files.map(fileToAsset));
    state.customAssets.push(...added);
    selectedAssetIndex = getAllAssets().length - 1;
    persistState();
    renderAssets();
    renderLibraryAssets();
    renderIllustrationGallery();
    if (showResult) showToast(`${added.length}件の画像を追加しました`);
    return added;
  } catch (_) {
    showToast("画像を読み込めませんでした");
    return [];
  }
}

// ファイル画面で確定前の画像と共有ファイルを右側へプレビュー表示する。
function renderPendingLibraryFiles() {
  const empty = document.querySelector("#libraryDropzoneEmpty");
  const grid = document.querySelector("#pendingUploadGrid");
  empty.hidden = pendingLibraryFiles.length > 0;
  grid.innerHTML = pendingLibraryFiles.map((item, index) => item.previewUrl
    ? `<span class="pending-upload-item"><img src="${item.previewUrl}" alt=""><small>${escapeHtml(item.file.name)}</small><button type="button" data-remove-pending="${index}" aria-label="${escapeHtml(item.file.name)}を外す">×</button></span>`
    : `<span class="pending-upload-item pending-file-item"><strong>.makecal</strong><small>${escapeHtml(item.file.name)}</small><button type="button" data-remove-pending="${index}" aria-label="${escapeHtml(item.file.name)}を外す">×</button></span>`).join("");
}

// 選択されたファイルをアップロードせず、確定待ちの一覧へ追加する。
function stageLibraryFiles(fileList) {
  const accepted = [...fileList].filter(file => file.type.startsWith("image/") || /\.(makecal|json)$/i.test(file.name));
  accepted.forEach(file => {
    const duplicate = pendingLibraryFiles.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified);
    if (!duplicate) pendingLibraryFiles.push({ file, previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "" });
  });
  document.querySelector("#libraryFileInput").value = "";
  renderPendingLibraryFiles();
  if (!accepted.length) showToast("画像または.makecalファイルを選んでください");
}

// 未確定ファイルのプレビューURLを解放し、選択状態を空に戻す。
function clearPendingLibraryFiles() {
  pendingLibraryFiles.forEach(item => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
  pendingLibraryFiles = [];
  document.querySelector("#libraryFileInput").value = "";
  renderPendingLibraryFiles();
}

// 確定操作を受けて、待機中の画像登録とカレンダー読込をまとめて実行する。
async function confirmLibraryFiles() {
  if (!pendingLibraryFiles.length) {
    showToast("ファイルを選んでください");
    return;
  }
  const confirmButton = document.querySelector("#libraryConfirmButton");
  confirmButton.disabled = true;
  try {
    const files = pendingLibraryFiles.map(item => item.file);
    const imageFiles = files.filter(file => file.type.startsWith("image/"));
    const calendarFiles = files.filter(file => !file.type.startsWith("image/"));
    const addedImages = await addUploadedFiles(imageFiles, false);
    let importedCalendars = 0;
    for (const file of calendarFiles) {
      if (await importCalendarFile(file)) importedCalendars += 1;
    }
    clearPendingLibraryFiles();
    fileDialog.close();
    renderCards();
    if (importedCalendars) showView("dashboard");
    const results = [];
    if (addedImages.length) results.push(`画像${addedImages.length}件`);
    if (importedCalendars) results.push(`カレンダー${importedCalendars}件`);
    if (results.length) showToast(`${results.join("、")}を追加しました`);
  } finally {
    confirmButton.disabled = false;
  }
}

// 入力内容と選択形式から新しいカレンダーを作成する。
async function createNewCalendar() {
  const title = document.querySelector("#newCalendarName").value.trim() || "新しいカレンダー";
  const date = document.querySelector("#newCalendarDate").value || getTodayString();
  const calendar = createCalendar(selectedCreateType, title, date);
  const file = document.querySelector("#createImageUpload").files[0];
  if (file) {
    const added = await addUploadedFiles([file]);
    if (added[0]) {
      if (calendar.type === "day") calendar.slots[0].items.push({ ...added[0] });
      if (calendar.type === "week") calendar.weekDays[0].items.push({ ...added[0] });
      if (calendar.type === "month") calendar.monthDays[1].items.push({ ...added[0] });
    }
  }
  state.calendars.unshift(calendar);
  persistState();
  createDialog.close();
  document.querySelector("#createImageUpload").value = "";
  document.querySelector("#selectedFileName").textContent = "";
  openEditor(calendar.id);
}

// 標準シンボルの読込完了を待ってから印刷し、初回のPDFでも画像抜けを防ぐ。
async function printCurrentCalendar(asPdf = false) {
  if (!saveCalendar()) return;
  try {
    await Promise.all([...calendarCanvas.querySelectorAll("img")].map(image => image.decode()));
  } catch (_) {
    showToast("画像を読み込めませんでした。再読み込みしてから印刷してください");
    return;
  }
  if (asPdf) showToast("印刷画面で「PDFに保存」を選んでください");
  window.setTimeout(() => {
    if (window.AndroidBridge?.printPage) window.AndroidBridge.printPage();
    else window.print();
  }, asPdf ? 450 : 50);
}

// 一覧カードから対象カレンダーを開いて印刷する。
function printCalendarCard(calendarId, asPdf = false) {
  openEditor(calendarId);
  window.setTimeout(() => printCurrentCalendar(asPdf), 120);
}

// 一覧カードの保存から対象を開き、PDFまたは.makecalの選択画面を表示する。
function openCalendarSaveChoices(calendarId) {
  openEditor(calendarId);
  window.setTimeout(openSaveChoices, 120);
}

// キャンバス上のポインター位置を描画座標へ変換する。
function getCanvasPoint(event) {
  const bounds = drawingCanvas.getBoundingClientRect();
  return { x: (event.clientX - bounds.left) * drawingCanvas.width / bounds.width, y: (event.clientY - bounds.top) * drawingCanvas.height / bounds.height };
}

// 消しゴムでも透明にならないようキャンバスを白で初期化する。
function paintCanvasWhite() {
  drawingContext.save();
  drawingContext.fillStyle = "#ffffff";
  drawingContext.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  drawingContext.restore();
}

// 描画履歴へ現在のキャンバスを追加して戻す・やり直すを可能にする。
function commitDrawingHistory() {
  drawingHistory = drawingHistory.slice(0, drawingHistoryIndex + 1);
  drawingHistory.push(drawingCanvas.toDataURL("image/png"));
  if (drawingHistory.length > 24) drawingHistory.shift();
  drawingHistoryIndex = drawingHistory.length - 1;
  updateHistoryButtons();
}

// 保存した履歴画像からキャンバスを復元する。
function restoreDrawing(dataUrl) {
  const image = new Image();
  image.onload = () => { paintCanvasWhite(); drawingContext.drawImage(image, 0, 0); };
  image.src = dataUrl;
}

// 履歴位置に応じて操作ボタンの有効状態を更新する。
function updateHistoryButtons() {
  document.querySelector("#undoButton").disabled = drawingHistoryIndex <= 0;
  document.querySelector("#redoButton").disabled = drawingHistoryIndex >= drawingHistory.length - 1;
}

// ペンと消しゴムを切り替えて選択状態を表示する。
function setDrawingMode(mode) {
  drawingMode = mode;
  document.querySelectorAll(".draw-mode-button").forEach(button => {
    const active = button.dataset.drawMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

// 選びやすい定番色を色見本として表示する。
function renderColorSwatches() {
  const currentColor = document.querySelector("#colorPicker").value.toLowerCase();
  document.querySelector("#colorSwatches").innerHTML = drawingColors.map(color => `<button class="color-swatch ${color === currentColor ? "active" : ""}" type="button" data-color="${color}" style="background:${color}" aria-label="${color}を選択"></button>`).join("");
}

// ポインターを押した位置から新しい線を描き始める。
function startDrawing(event) {
  drawing = true;
  drawingCanvas.setPointerCapture(event.pointerId);
  const point = getCanvasPoint(event);
  drawingContext.beginPath();
  drawingContext.moveTo(point.x, point.y);
}

// ポインター移動に合わせて選択中の道具で線を描く。
function continueDrawing(event) {
  if (!drawing) return;
  const point = getCanvasPoint(event);
  drawingContext.lineWidth = Number(document.querySelector("#brushSize").value);
  drawingContext.lineCap = "round";
  drawingContext.lineJoin = "round";
  drawingContext.strokeStyle = drawingMode === "eraser" ? "#ffffff" : document.querySelector("#colorPicker").value;
  drawingContext.lineTo(point.x, point.y);
  drawingContext.stroke();
}

// 1本の線が完成した時点で履歴へ保存する。
function stopDrawing(event) {
  if (!drawing) return;
  drawing = false;
  if (drawingCanvas.hasPointerCapture(event.pointerId)) drawingCanvas.releasePointerCapture(event.pointerId);
  commitDrawingHistory();
}

// キャンバスを白紙へ戻し、その操作も履歴へ残す。
function clearDrawingCanvas() {
  paintCanvasWhite();
  commitDrawingHistory();
}

// 描いた絵をカレンダー向けの小さな画像へ変換する。
function createDrawingThumbnail() {
  const canvas = document.createElement("canvas");
  canvas.width = 320; canvas.height = 214;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(drawingCanvas, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

// 描いた絵を自作イラストへ登録してパレットで再利用可能にする。
function addDrawingToAssets() {
  const asset = { id: createId("asset"), icon: createDrawingThumbnail(), label: document.querySelector("#drawingName").value.trim() || "わたしのイラスト", custom: true, category: "" };
  state.customAssets.push(asset);
  selectedAssetIndex = getAllAssets().length - 1;
  persistState();
  renderAssets();
  renderIllustrationGallery();
  showToast(`「${asset.label}」をイラスト一覧へ追加しました`);
}

// 描いた原寸画像をPNGとして端末へ保存する。
function downloadDrawing() {
  saveDataUrlDownload(drawingCanvas.toDataURL("image/png"), `${document.querySelector("#drawingName").value.trim() || "illustration"}.png`, "image/png");
}

// 登録した写真と自作イラストをお絵描き画面にも一覧表示する。
function renderIllustrationGallery() {
  const gallery = document.querySelector("#illustrationGallery");
  if (!state.customAssets.length) {
    gallery.innerHTML = '<p class="gallery-empty">まだ登録画像はありません</p>';
    return;
  }
  gallery.innerHTML = state.customAssets.map(asset => `<div class="illustration-card"><img src="${asset.icon}" alt=""><span>${escapeHtml(asset.label)}</span></div>`).join("");
}

document.querySelector("#openCreateButton").addEventListener("click", () => {
  document.querySelector("#newCalendarDate").value = getTodayString();
  renderCreatePreview();
  createDialog.showModal();
});

document.querySelector("#guestLoginButton").addEventListener("click", enterGuestMode);
document.querySelector("#chatgptLoginButton").addEventListener("click", () => showToast("ログインの保存方式を相談中です"));

document.querySelector("#openFileButton").addEventListener("click", () => {
  document.querySelector("#librarySearch").value = "";
  clearPendingLibraryFiles();
  renderLibraryAssets();
  fileDialog.showModal();
});

document.querySelectorAll(".type-tab").forEach(button => button.addEventListener("click", () => {
  selectedCreateType = button.dataset.type;
  document.querySelectorAll(".type-tab").forEach(tab => {
    const selected = tab === button;
    tab.classList.toggle("selected", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  renderCreatePreview();
}));

document.querySelector("#createImageUpload").addEventListener("change", event => {
  document.querySelector("#selectedFileName").textContent = event.target.files[0]?.name || "";
});
document.querySelector("#createButton").addEventListener("click", createNewCalendar);

calendarGrid.addEventListener("click", event => {
  const renameButton = event.target.closest("[data-rename-card]");
  const editButton = event.target.closest("[data-edit]");
  const printButton = event.target.closest("[data-print-card]");
  const saveButton = event.target.closest("[data-save-card]");
  const moreButton = event.target.closest("[data-more-card]");
  if (renameButton) startCardRename(renameButton.dataset.renameCard);
  else if (editButton) openEditor(editButton.dataset.edit);
  else if (printButton) printCalendarCard(printButton.dataset.printCard);
  else if (saveButton) openCalendarSaveChoices(saveButton.dataset.saveCard);
  else if (moreButton) showToast("カードを開くと詳しく編集できます");
});

calendarGrid.addEventListener("keydown", event => {
  const input = event.target.closest("[data-rename-input]");
  if (!input || !["Enter", "Escape"].includes(event.key)) return;
  event.preventDefault();
  finishCardRename(input, event.key === "Escape");
});

calendarGrid.addEventListener("focusout", event => {
  const input = event.target.closest("[data-rename-input]");
  if (input) window.setTimeout(() => finishCardRename(input), 0);
});

document.querySelectorAll(".filter-chip").forEach(button => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll(".filter-chip").forEach(chip => chip.classList.toggle("active", chip === button));
  renderCards();
}));

document.querySelector("#calendarSearch").addEventListener("input", event => {
  calendarSearchText = event.target.value.trim().toLowerCase();
  renderCards();
});

document.querySelector("#assetSearch").addEventListener("input", event => {
  assetSearchText = event.target.value.trim().toLowerCase();
  renderAssets();
});

document.querySelectorAll(".asset-category-button").forEach(button => button.addEventListener("click", () => {
  activeAssetCategory = button.dataset.assetCategory;
  showEditorSidePanel("assets", button);
  renderAssets();
}));

document.querySelector("#librarySearch").addEventListener("input", renderLibraryAssets);
document.querySelector("#libraryAssetGrid").addEventListener("click", event => {
  const editButton = event.target.closest("[data-edit-library-asset]");
  if (editButton) openImageEditor(editButton.dataset.editLibraryAsset);
});
document.querySelector("#libraryFileInput").addEventListener("change", event => stageLibraryFiles(event.target.files));
document.querySelector("#libraryConfirmButton").addEventListener("click", confirmLibraryFiles);
fileDialog.addEventListener("close", clearPendingLibraryFiles);

document.querySelector("#pendingUploadGrid").addEventListener("click", event => {
  const removeButton = event.target.closest("[data-remove-pending]");
  if (!removeButton) return;
  event.preventDefault();
  event.stopPropagation();
  const [removed] = pendingLibraryFiles.splice(Number(removeButton.dataset.removePending), 1);
  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  renderPendingLibraryFiles();
});

document.querySelector("#libraryDropzone").addEventListener("dragover", event => {
  event.preventDefault();
  event.currentTarget.classList.add("is-drag-over");
});
document.querySelector("#libraryDropzone").addEventListener("dragleave", event => event.currentTarget.classList.remove("is-drag-over"));
document.querySelector("#libraryDropzone").addEventListener("drop", event => {
  event.preventDefault();
  event.currentTarget.classList.remove("is-drag-over");
  stageLibraryFiles(event.dataTransfer.files);
});

document.querySelector("#assetGrid").addEventListener("click", event => {
  const editButton = event.target.closest("[data-edit-library-asset]");
  if (editButton) { openImageEditor(editButton.dataset.editLibraryAsset); return; }
  const button = event.target.closest("[data-asset]");
  if (!button) return;
  selectedAssetIndex = Number(button.dataset.asset);
  renderAssets();
});

document.querySelector("#assetGrid").addEventListener("dragstart", event => {
  const button = event.target.closest("[data-asset]");
  if (!button) return;
  draggedAssetIndex = Number(button.dataset.asset);
  selectedAssetIndex = draggedAssetIndex;
  button.classList.add("dragging");
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("text/plain", String(draggedAssetIndex));
});

document.querySelector("#assetGrid").addEventListener("dragend", event => {
  event.target.closest("[data-asset]")?.classList.remove("dragging");
  calendarCanvas.querySelectorAll(".is-drag-over").forEach(element => element.classList.remove("is-drag-over"));
  draggedAssetIndex = null;
  renderAssets();
});

calendarCanvas.addEventListener("dragover", event => {
  const target = event.target.closest("[data-drop-key]");
  if (!target || draggedAssetIndex === null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  calendarCanvas.querySelectorAll(".is-drag-over").forEach(element => element.classList.toggle("is-drag-over", element === target));
});

calendarCanvas.addEventListener("dragleave", event => {
  const target = event.target.closest("[data-drop-key]");
  if (target && !target.contains(event.relatedTarget)) target.classList.remove("is-drag-over");
});

calendarCanvas.addEventListener("drop", event => {
  const target = event.target.closest("[data-drop-key]");
  if (!target) return;
  event.preventDefault();
  const transferredIndex = Number(event.dataTransfer.getData("text/plain"));
  addAssetToTarget(target.dataset.dropKey, Number.isInteger(transferredIndex) ? transferredIndex : draggedAssetIndex, Number(target.dataset.cellIndex));
});

calendarCanvas.addEventListener("click", event => {
  const removeButton = event.target.closest("[data-remove-index]");
  const addButton = event.target.closest("[data-add-key]");
  const deleteButton = event.target.closest("[data-delete-time]");
  if (removeButton) {
    const target = getTargetByKey(removeButton.dataset.targetKey);
    target.items = getPositionedItems(target.items);
    target.items.splice(Number(removeButton.dataset.removeIndex), 1);
    markDirty(); renderCalendar();
  } else if (addButton) {
    addAssetToTarget(addButton.dataset.addKey, selectedAssetIndex, Number(addButton.dataset.cellIndex));
  } else if (deleteButton) {
    const calendar = getActiveCalendar();
    calendar.slots = calendar.slots.filter(slot => slot.id !== deleteButton.dataset.deleteTime);
    markDirty(); renderCalendar();
  }
});

calendarCanvas.addEventListener("change", event => {
  if (!event.target.matches("[data-time-id]")) return;
  const calendar = getActiveCalendar();
  const slot = calendar.slots.find(item => item.id === event.target.dataset.timeId);
  if (calendar.slots.some(item => item.id !== slot.id && item.time === event.target.value)) {
    event.target.value = slot.time;
    showToast("同じ時間の枠はすでにあります");
    return;
  }
  slot.time = event.target.value;
  markDirty(); renderCalendar();
});

// 設定パネルから時間枠を追加し、既存時刻との重複を防ぐ。
function addTimeSlot() {
  const input = document.querySelector("#newTimeInput");
  const calendar = getActiveCalendar();
  if (!calendar || calendar.type !== "day" || !input.value) return;
  if (calendar.slots.some(slot => slot.time === input.value)) { showToast("同じ時間の枠はすでにあります"); return; }
  calendar.slots.push({ id: createId("slot"), time: input.value, items: [], note: "" });
  markDirty(); renderCalendar();
}
document.querySelector("#addTimeButton").addEventListener("click", addTimeSlot);

document.querySelector("#calendarTitle").addEventListener("input", markDirty);
document.querySelector("#calendarDate").addEventListener("change", event => {
  const calendar = getActiveCalendar();
  if (!event.target.value) { renderEditorSettings(calendar); return; }
  calendar.date = calendar.type === "month" ? event.target.value + "-01" : event.target.value;
  if (calendar.type === "month") {
    for (let day = 1; day <= getDaysInMonth(calendar.date); day += 1) calendar.monthDays[day] ||= { items: [], note: "" };
  }
  markDirty(); renderCalendar();
});
// 背景色を選んだら白固定を解除し、個別に色指定していない枠にも反映する。
document.querySelector('#calendarBackground').addEventListener('input', event => {
  const calendar = getActiveCalendar();
  if (getColorPreset(calendar) === 'white') { calendar.colorPreset = 'custom'; calendar.scheduleColors = {}; }
  calendar.background = event.target.value;
  markDirty(); renderCalendar();
});

// プリセット選択で個別色をリセットし、いつでも真っ白や自動配色へ戻せるようにする。
document.querySelector('#calendarColorPreset').addEventListener('change', event => {
  const calendar = getActiveCalendar();
  calendar.colorPreset = event.target.value;
  calendar.scheduleColors = {};
  calendar.background = '#ffffff';
  markDirty(); renderCalendar();
});

// 白からの個別変更ではカスタムへ切り替え、自動・曜日配色ではその枠だけ上書きする。
document.querySelector('#scheduleColorFields').addEventListener('change', event => {
  const key = event.target.dataset.scheduleColor;
  if (key === undefined) return;
  const calendar = getActiveCalendar();
  if (getColorPreset(calendar) === 'white') { calendar.colorPreset = 'custom'; calendar.background = '#ffffff'; calendar.scheduleColors = {}; }
  calendar.scheduleColors ||= {};
  calendar.scheduleColors[key] = safeCalendarColor(event.target.value);
  markDirty(); renderCalendar();
});
document.querySelector("#textStyle").addEventListener("change", event => { getActiveCalendar().textStyle = event.target.value; markDirty(); renderCalendar(); });
document.querySelector("#timeStyle").addEventListener("change", event => { getActiveCalendar().timeStyle = event.target.value; markDirty(); renderCalendar(); });
document.querySelector("#weekStart").addEventListener("change", event => { getActiveCalendar().weekStart = event.target.value; markDirty(); renderCalendar(); });
document.querySelector("#monthCellCount").addEventListener("change", event => { getActiveCalendar().monthCellCount = Number(event.target.value); markDirty(); renderCalendar(); });

document.querySelector("#saveButton").addEventListener("click", openSaveChoices);
document.querySelector("#footerSaveButton").addEventListener("click", openSaveChoices);
document.querySelector("#saveAsPdfButton").addEventListener("click", () => { saveChoiceDialog.close(); printCurrentCalendar(true); });
document.querySelector("#saveMakecalButton").addEventListener("click", () => { saveChoiceDialog.close(); exportCurrentCalendar(); });
document.querySelector("#clearButton").addEventListener("click", clearCurrentCalendar);
document.querySelector("#backButton").addEventListener("click", event => {
  activeAssetCategory = "all";
  showEditorSidePanel("assets", event.currentTarget);
  renderAssets();
});
document.querySelector("#calendarSettingsButton").addEventListener("click", event => showEditorSidePanel("settings", event.currentTarget));
document.querySelector("#editorPrintButton").addEventListener("click", () => printCurrentCalendar());
document.querySelector("#imageUploadInput").addEventListener("change", event => { addUploadedFiles(event.target.files); event.target.value = ""; });
document.querySelector("#railUploadButton").addEventListener("click", () => document.querySelector("#openFileButton").click());
document.querySelector("#imageEditBackButton").addEventListener("click", returnToImageLibrary);
// Escapeでも戻るボタンと同じ保存・復帰処理に揃える。
imageEditDialog.addEventListener("cancel", event => { event.preventDefault(); returnToImageLibrary(); });
imageEditDialog.querySelector("form").addEventListener("submit", event => { event.preventDefault(); returnToImageLibrary(); });
document.querySelector("#deleteImageButton").addEventListener("click", deleteEditingImage);
document.querySelector("#collapsePaletteButton").addEventListener("click", event => {
  const collapsed = document.querySelector("#editorLayout").classList.toggle("palette-collapsed");
  event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
  event.currentTarget.title = collapsed ? "イラスト一覧を開く" : "イラスト一覧を収納";
});

document.querySelector("#settingsButton").addEventListener("click", openSettings);
document.querySelector("#settingsSaveButton").addEventListener("click", saveSettings);
document.querySelector("#managedAssetSearch").addEventListener("input", () => { settingsAssetPage = 0; renderManagedAssets(); });
document.querySelector("#managedAssetFilter").addEventListener("change", () => { settingsAssetPage = 0; renderManagedAssets(); });
document.querySelector("#managedAssetPrevious").addEventListener("click", () => { settingsAssetPage -= 1; renderManagedAssets(); });
document.querySelector("#managedAssetNext").addEventListener("click", () => { settingsAssetPage += 1; renderManagedAssets(); });
document.querySelector("#managedAssetGrid").addEventListener("change", event => {
  const input = event.target.closest("[data-managed-asset]");
  if (!input) return;
  if (input.checked) settingsAssetDraft.add(input.dataset.managedAsset);
  else settingsAssetDraft.delete(input.dataset.managedAsset);
  document.querySelector("#managedAssetCount").textContent = `${settingsAssetDraft.size}件選択中`;
});

document.querySelector(".brand").addEventListener("click", event => { event.preventDefault(); showView("dashboard"); });
document.querySelectorAll(".tool-nav-button").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
document.querySelector("#openDrawingButton").addEventListener("click", () => showView("drawing"));
document.querySelector("#drawingToCalendarButton").addEventListener("click", () => activeCalendarId ? openEditor(activeCalendarId) : showView("dashboard"));

document.querySelectorAll(".draw-mode-button").forEach(button => button.addEventListener("click", () => setDrawingMode(button.dataset.drawMode)));
document.querySelector("#colorSwatches").addEventListener("click", event => {
  const button = event.target.closest("[data-color]");
  if (!button) return;
  document.querySelector("#colorPicker").value = button.dataset.color;
  setDrawingMode("pen"); renderColorSwatches();
});
document.querySelector("#colorPicker").addEventListener("input", () => { setDrawingMode("pen"); renderColorSwatches(); });
document.querySelector("#brushSize").addEventListener("input", event => { document.querySelector("#brushSizeOutput").textContent = event.target.value; });
document.querySelector("#undoButton").addEventListener("click", () => { if (drawingHistoryIndex > 0) { drawingHistoryIndex -= 1; restoreDrawing(drawingHistory[drawingHistoryIndex]); updateHistoryButtons(); } });
document.querySelector("#redoButton").addEventListener("click", () => { if (drawingHistoryIndex < drawingHistory.length - 1) { drawingHistoryIndex += 1; restoreDrawing(drawingHistory[drawingHistoryIndex]); updateHistoryButtons(); } });
document.querySelector("#clearCanvasButton").addEventListener("click", clearDrawingCanvas);
document.querySelector("#addDrawingButton").addEventListener("click", addDrawingToAssets);
document.querySelector("#downloadDrawingButton").addEventListener("click", downloadDrawing);
drawingCanvas.addEventListener("pointerdown", startDrawing);
drawingCanvas.addEventListener("pointermove", continueDrawing);
drawingCanvas.addEventListener("pointerup", stopDrawing);
drawingCanvas.addEventListener("pointercancel", stopDrawing);

paintCanvasWhite();
commitDrawingHistory();
renderColorSwatches();
renderIllustrationGallery();
renderAssets();
renderCards();
applyPreferences();
if (hasGuestSession()) showView("dashboard");
else showLoginView();
