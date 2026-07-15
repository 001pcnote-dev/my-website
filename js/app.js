// ==========================================
// 1. UIアニメーション共通関数
// ==========================================
function toggleMenuState(menu, isOpen) {
    if (!menu) return;
    if (isOpen) {
        menu.classList.remove('opacity-0', 'scale-90', 'pointer-events-none');
        menu.classList.add('opacity-100', 'scale-100');
    } else {
        menu.classList.remove('opacity-100', 'scale-100');
        menu.classList.add('opacity-0', 'scale-90', 'pointer-events-none');
    }
}

function animateModal(modal, isShow) {
    if (!modal) return;
    const inner = modal.querySelector('.transform');
    if (isShow) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modal.classList.add('opacity-100');
            if (inner) {
                inner.classList.remove('scale-95');
                inner.classList.add('scale-100');
            }
        }, 10);
    } else {
        modal.classList.remove('opacity-100');
        modal.classList.add('opacity-0');
        if (inner) {
            inner.classList.remove('scale-100');
            inner.classList.add('scale-95');
        }
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
}

// ==========================================
// 2. グローバル変数 & 状態管理
// ==========================================
let searchDebounceTimeout = null;

function debouncedFilter() {
    clearTimeout(searchDebounceTimeout);
    // 300ミリ秒入力がなければ filterDiaryItems() を実行
    searchDebounceTimeout = setTimeout(() => {
        filterDiaryItems();
    }, 300);
}

let listScrollPosition = 0;
let dirHandle = null;
let diaryItems = [];
let currentMediaFiles = [];
let currentPeriodFilter = 'ALL';
let viewMode = 'list';
let currentCalDate = new Date();

let isSettingsOpen = false;
let isAdvancedSearchOpen = false;
let isViewMenuOpen = false;
let isFolderMenuOpen = false;
let isOriginalSize = false;
let isAlbumHeaderVisible = false;

let lastScrollY = window.scrollY;
let saveTimeout = null;
let headerHideTimeout = null;
let filterHideTimeout = null;
let longPressTimer;
let isLongPress = false;
let viewMenuLongPressTimer;
let isViewMenuLongPress = false;

let currentDisplayLimit = 30;
let currentFilteredItems = [];
let globalSelectedIds = new Set();
let savedFolders = [];

let activeCalendarTag = null;
let calendarPopupTimer = null;
let isLongPressTriggered = false;

let globalSelectedImageIds = new Set();
let dragStartIndex = -1;

let pendingImportConflicts = [];
let pendingImportSafeItems = [];

function generateUniqueId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}

const weatherConfig = {
    sunny: { icon: 'fa-sun', color: 'text-amber-500', label: '晴れ' },
    cloudy: { icon: 'fa-cloud', color: 'text-blue-400', label: '曇り' },
    rainy: { icon: 'fa-cloud-showers-heavy', color: 'text-indigo-400', label: '雨' },
    snowy: { icon: 'fa-snowflake', color: 'text-slate-400', label: '雪' }
};

// ==========================================
// 3. メモリ管理 (Blob URL)
// ==========================================
const mediaUrlCache = new Map();

function base64ToBlob(base64, type) {
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    const bin = atob(base64Data);
    const chunkSize = 1024 * 10; // データを10KBずつ小分けにして処理
    const byteArrays = [];

    for (let offset = 0; offset < bin.length; offset += chunkSize) {
        const chunk = bin.slice(offset, offset + chunkSize);
        const bytes = new Uint8Array(chunk.length);
        for (let i = 0; i < chunk.length; i++) {
            bytes[i] = chunk.charCodeAt(i);
        }
        byteArrays.push(bytes);
    }
    return new Blob(byteArrays, { type: type });
}

async function loadMediaUrl(mediaName) {
    if (!mediaName || !dirHandle) return '';
    if (mediaUrlCache.has(mediaName)) return mediaUrlCache.get(mediaName);
    try {
        const mediaDir = await dirHandle.getDirectoryHandle('media');
        const fileHandle = await mediaDir.getFileHandle(mediaName);
        const file = await fileHandle.getFile();
        const url = URL.createObjectURL(file);
        mediaUrlCache.set(mediaName, url);
        return url;
    } catch (e) {
        return '';
    }
}

async function applyMediaUrls() {
    const els = document.querySelectorAll('[data-pending-media]');
    for (const el of els) {
        const mediaName = el.getAttribute('data-pending-media');
        if (mediaName) {
            const url = await loadMediaUrl(mediaName);
            if (url) {
                if (el.tagName === 'IMG') el.src = url;
                if (el.tagName === 'VIDEO' && el.hasAttribute('poster')) el.poster = url;
            }
            el.removeAttribute('data-pending-media');
        }
    }
}

// キャッシュ済みの不要なメディアURLを解放し、メモリリークを防止
function clearMediaUrlCache() {
    mediaUrlCache.forEach(url => {
        URL.revokeObjectURL(url);
    });
    mediaUrlCache.clear();
}

function showCalendarPopup(items, cellElement) {
    const popup = document.getElementById('calendar-popup');
    const content = document.getElementById('calendar-popup-content');
    content.innerHTML = '';

    items.forEach(item => {
        const d = getSafeDate(item.date);
        const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        
        // 記号が崩れないよう、先に安全化処理をしてから文字を切り取る
        let safeContent = item.content ? DOMPurify.sanitize(item.content, { ALLOWED_TAGS: [] }) : '内容なし';
        let text = safeContent.substring(0, 40) + (safeContent.length > 40 ? '...' : '');

        let weatherIcon = item.weather && weatherConfig[item.weather] ? `<i class="fa-solid ${weatherConfig[item.weather].icon} ${weatherConfig[item.weather].color} ml-1"></i>` : '';
        const mFiles = item.mediaFiles || (item.media ? [item.media] : []);
        let mediaIcon = '';

        if (mFiles.length > 0) {
            const hasImage = mFiles.some(m => m.type?.startsWith('image/'));
            const hasVideo = mFiles.some(m => m.type?.startsWith('video/'));
            if (hasImage) mediaIcon += `<i class="fa-regular fa-image text-indigo-400 ml-1"></i>`;
            if (hasVideo) mediaIcon += `<i class="fa-solid fa-film text-indigo-400 ml-1"></i>`;
        }

        content.innerHTML += `
            <div class="border-b border-slate-700/50 dark:border-slate-200/50 pb-2.5 last:border-0 last:pb-0">
                <div class="text-[11px] text-slate-300 dark:text-slate-500 font-bold mb-1 flex items-center">
                    <i class="fa-regular fa-clock mr-1"></i>${time} ${weatherIcon} ${mediaIcon}
                </div>
                <div class="text-[11px] leading-relaxed font-medium break-words whitespace-pre-wrap line-clamp-3">${text}</div>
            </div>
        `;
    });

    const rect = cellElement.getBoundingClientRect();
    const cellCenterX = rect.left + rect.width / 2;

    popup.classList.remove('hidden');

    const popupWidth = popup.offsetWidth;
    const screenWidth = window.innerWidth;
        const margin = 12;

        let popupLeft = cellCenterX;

        // はみ出しを防ぐため、一番左・一番右の限界値を設定
        const minLeft = popupWidth / 2 + margin;
        const maxLeft = screenWidth - popupWidth / 2 - margin;

        if (popupLeft < minLeft) {
            popupLeft = minLeft;
        } else if (popupLeft > maxLeft) {
            popupLeft = maxLeft;
        }

        popup.style.left = popupLeft + 'px';
        popup.style.top = (rect.top - 10) + 'px';

        const arrow = popup.lastElementChild;
        if (arrow) {
            const offset = cellCenterX - popupLeft;
            // 矢印が吹き出しの枠外（角の部分）に飛び出さないよう、動ける範囲を制限
            const maxOffset = (popupWidth / 2) - 16;
            const safeOffset = Math.max(-maxOffset, Math.min(offset, maxOffset));
            arrow.style.left = `calc(50% + ${safeOffset}px)`;
        }

        setTimeout(() => popup.classList.remove('opacity-0'), 10);
}

function hideCalendarPopup() {
    clearTimeout(calendarPopupTimer);
    const popup = document.getElementById('calendar-popup');
    if (popup) {
        popup.classList.add('opacity-0');
        setTimeout(() => popup.classList.add('hidden'), 200);
    }
}

function toggleCalendarTagHighlight(tag) {
    if (activeCalendarTag === tag) {
        activeCalendarTag = null;
    } else {
        activeCalendarTag = tag;
        if (navigator.vibrate) navigator.vibrate(30);
    }
    renderCalendar();
}

function fuzzyString(str) {
    if (!str) return '';
    return str.toLowerCase().normalize('NFKC')
        .replace(/[\u30a1-\u30f6]/g, match => String.fromCharCode(match.charCodeAt(0) - 0x60))
        .replace(/[、。，．・！？!?\s ]/g, '');
}

function showToast(text) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-text').innerText = text;
    toast.classList.replace('opacity-0', 'opacity-100');
    setTimeout(() => toast.classList.replace('opacity-100', 'opacity-0'), 2500);
}

function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

function addTagAutomatically(newTag) {
    const tagsInput = document.getElementById('entry-tags');
    if (!tagsInput) return;
    let currentTags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t.length > 0);
    if (!currentTags.includes(newTag)) {
        currentTags.push(newTag);
        tagsInput.value = currentTags.join(', ');
    }
}

function getSafeDate(dateStr) {
    if (!dateStr) return new Date(0);
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
    return new Date(dateStr.replace(/-/g, '/').replace(/T/g, ' '));
}

function getAllImagesFromItem(item) {
    const images = [];
    let idx = 0;
    const mFiles = item.mediaFiles || (item.media ? [item.media] : []);

    mFiles.forEach((m) => {
        const isVideo = m.type?.startsWith('video/');
        const oldBase64 = isVideo ? m.thumbnail : m.data;
        const srcValue = m.mediaName ? '' : (oldBase64 || '');
        const pendingAttr = m.mediaName ? `data-pending-media="${m.mediaName}"` : '';

        images.push({
            id: `${item.id}-media-${idx}`,
            src: srcValue,
            pendingAttr: pendingAttr,
            mediaName: m.mediaName,
            name: m.originalName || (isVideo ? `video_${idx}` : `image_${idx}`),
            isOriginal: !!m.originalName,
            originalName: m.originalName,
            type: m.type,
            isVideo: isVideo,
            metadata: m.metadata
        });
        idx++;
    });
    return images;
}

// ==========================================
// 4. File System Access API & フォルダ同期
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    // 初期表示時のテーマ切り替えによる画面のチラつき（白点滅）を防ぐため、アニメーションを一時無効化
    document.body.classList.remove('transition-colors', 'duration-300');

    await appDB.init();

    // 初期のキャッシュ設定を読み込み
    await appSettings.loadSettings();

    initTheme();
    initExtensionsData();
    await loadDiaryFromLocalDB();
    loadFolders();

    const savedSize = appSettings.get('diary-font-size');
    if (savedSize) {
        document.documentElement.style.setProperty('--diary-font-size', savedSize);
        const select = document.querySelector('select[onchange="changeFontSize(this.value)"]');
        if (select) select.value = savedSize;
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeLightbox();
            closeModal();
            closeSearchModal();
            closeStartupSyncModal();
            closeAutotagModal();
            closeFolderEditModal();
            closeImageGallery();
            closeConflictModal();
            if (isSettingsOpen) toggleSettings();
        }
    });

    window.addEventListener('click', (e) => {
        const vMenu = document.getElementById('view-menu');
        const vBtn = document.getElementById('view-menu-btn');
        if (!vBtn?.contains(e.target) && !vMenu?.contains(e.target)) closeViewMenu();

        const fMenu = document.getElementById('folder-menu');
        if (isFolderMenuOpen && !fMenu?.contains(e.target) && !document.getElementById('folder-edit-modal')?.contains(e.target)) {
            closeFolderMenu();
        }
    });

    setupLongPress();
    setupViewMenuLongPress();

    await checkAndShowStartupSync();

    // Androidスマホ等でのPDF出力時に、全部の日記がプレビューに出ないよう制御
    window.addEventListener('beforeprint', () => {
        const container = document.getElementById('diary-container');
        const editorModal = document.getElementById('editor-modal');
        const header = document.getElementById('main-header');
        
        // 1. 日記の編集・詳細画面を開いている場合、裏のリスト全体を隠す
        if (editorModal && !editorModal.classList.contains('hidden')) {
            if (container) container.classList.add('hidden', 'no-print-temp');
            if (header) header.classList.add('hidden', 'no-print-temp');
            return;
        }

        // 2. チェックボックスで選択した日記がある場合、選択していないものを隠す
        if (globalSelectedIds && globalSelectedIds.size > 0 && container) {
            container.querySelectorAll('.diary-card').forEach(card => {
                const id = card.getAttribute('data-id');
                if (!globalSelectedIds.has(id)) {
                    card.classList.add('hidden', 'no-print-temp');
                }
            });
        }
    });

    window.addEventListener('afterprint', () => {
        // 印刷完了・キャンセル後に、非表示にした日記を元に戻す
        document.querySelectorAll('.no-print-temp').forEach(el => {
            el.classList.remove('hidden', 'no-print-temp');
        });
    });

    // 全ての初期化が完了した後、安全にアニメーションを再有効化
    setTimeout(() => {
        document.body.classList.add('transition-colors', 'duration-300');
    }, 50);
});

// 共通のフォルダセットアップ処理
async function setupFolder(handle) {
    dirHandle = handle;
    
    // 1. メモリ上のデータを一度リセット（重要）
    diaryItems = [];
    clearMediaUrlCache(); // 古い画像のキャッシュを解放してメモリを節約
    
    // 2. フォルダ構造の確保
    await dirHandle.getDirectoryHandle('originals', { create: true });
    await dirHandle.getDirectoryHandle('media', { create: true });
    
    // 3. フォルダからデータを読み込み
    await loadDiaryFromFolder();
    
    // 4. 表示の更新
    renderDiaryItems();
    updateTagFilterOptions();
    
    // 5. DBを最新状態に同期
    await appDB.clear('diary_items');
    for (const item of diaryItems) {
        await appDB.put('diary_items', item);
    }
    await appDB.set('system_state', 'dirHandle', dirHandle);
    
    const dot = document.getElementById('sync-status-dot');
    if (dot) dot.className = "absolute top-2 right-2 w-2 h-2 bg-emerald-500 rounded-full border border-white dark:border-slate-900"; 
    
    showToast('フォルダを同期しました');
}

async function checkAndShowStartupSync() {
    await appDB.init();
    const storedHandle = await appDB.get('system_state', 'dirHandle');
    const modal = document.getElementById('startup-sync-modal');

    if (storedHandle) {
        try {
            // 既に許可されているかチェック
            if ((await storedHandle.queryPermission({ mode: 'readwrite' })) === 'granted') {
                await setupFolder(storedHandle);
                return;
            } else {
                // 許可が必要な場合、UIを「再接続モード」に書き換えて表示
                modal.querySelector('h3').textContent = '前回のフォルダに再接続';
                modal.querySelector('p').innerHTML = '前回の保存先フォルダが記憶されています。<br>再接続して同期を再開しますか？';
                modal.querySelector('.flex.flex-col.gap-3').innerHTML = `
                    <button onclick="reconnectPreviousFolder()" class="w-full px-5 py-3 text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl shadow-md hover:opacity-90 active:scale-98 transition-all flex items-center justify-center gap-2">
                        <i class="fa-solid fa-plug"></i> 再接続する
                    </button>
                    <button onclick="handleStartupSync()" class="w-full px-5 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-all flex items-center justify-center gap-2">
                        <i class="fa-solid fa-folder-open"></i> 別のフォルダを選択
                    </button>
                    <button onclick="closeStartupSyncModal()" class="w-full px-5 py-3 text-sm font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-all">
                        キャンセル
                    </button>
                `;
                showSyncModal(modal);
                return;
            }
        } catch (error) {
            console.warn("Permission check failed:", error);
        }
    }
    
    // 初回または記憶がない場合の通常UI
    if (modal) {
        modal.querySelector('h3').textContent = '保存先フォルダを同期';
        modal.querySelector('p').innerHTML = '日記のデータや画像ファイルを保存するフォルダを選択してください。<br><span class="text-xs">※同期しなくてもローカルで利用可能です</span>';
        modal.querySelector('.flex.flex-col.gap-3').innerHTML = `
            <button onclick="handleStartupSync()" class="w-full px-5 py-3 text-sm font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl shadow-md hover:opacity-90 active:scale-98 transition-all flex items-center justify-center gap-2">
                <i class="fa-solid fa-folder-open"></i> フォルダを選択
            </button>
            <button onclick="closeStartupSyncModal()" class="w-full px-5 py-3 text-sm font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-all">
                キャンセル
            </button>
        `;
        showSyncModal(modal);
    }
}

function showSyncModal(modal) {
    animateModal(modal, true);
}

let isFolderSyncing = false; // 処理の重複実行を防ぐための目印（ロック）

// フォルダを選択し直さずに1クリックで再接続する処理
async function reconnectPreviousFolder() {
    if (isFolderSyncing) return; // 既に処理中なら何もしない
    isFolderSyncing = true;
    
    try {
        const storedHandle = await appDB.get('system_state', 'dirHandle');
        if (storedHandle) {
            // ボタンを押したら、ブラウザの許可画面が出る前にすぐモーダルを閉じる
            closeStartupSyncModal();

            // ブラウザの許可プロンプトを呼び出す
            if ((await storedHandle.requestPermission({ mode: 'readwrite' })) === 'granted') {
                showToast("前回のフォルダに再接続中...");
                
                await setupFolder(storedHandle);
                
                showToast("前回のフォルダに再接続しました");
                return;
            } else {
                // ユーザーが許可を拒否した場合は、安全に処理を終了する
                showToast("再接続がキャンセルされました");
                return; 
            }
        }
        // 保存情報がない場合のみフォールバック
        await handleStartupSync();
    } catch (err) {
        console.error("再接続エラー:", err);
        showToast("再接続に失敗しました");
        return;
    } finally {
        isFolderSyncing = false; // 処理が完了、またはエラーになったら確実にロックを解除
    }
}

async function handleStartupSync() {
    if (isFolderSyncing) return; // 既に処理中なら何もしない
    isFolderSyncing = true;
    
    try {
        if (!window.showDirectoryPicker) {
            throw new Error("File System Access API is not supported on this browser.");
        }
        
        // フォルダ選択画面が出る前にすぐモーダルを閉じる
        closeStartupSyncModal();

        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        
        showToast("フォルダの同期を開始します...");
        
        await appDB.set('system_state', 'dirHandle', handle);
        await setupFolder(handle);
        
        showToast("フォルダの同期が完了しました");
    } catch (err) {
        console.error("handleStartupSync error:", err);
        if (err.name !== 'AbortError') {
            showToast("フォルダの同期に失敗しました");
        } else {
            showToast("フォルダの選択がキャンセルされました");
        }
    } finally {
        isFolderSyncing = false; // 処理が完了、またはエラーになったら確実にロックを解除
    }
}

function closeStartupSyncModal() {
    animateModal(document.getElementById('startup-sync-modal'), false);
}

function initExtensionsData() {
    const includeDateCb = document.getElementById('custom-search-include-date');
    let savedIncludeDate = appSettings.get('smart_diary_include_date');
    if (includeDateCb) includeDateCb.checked = (savedIncludeDate === 'true');
    
    const synonymInput = document.getElementById('custom-synonym-input');
    let savedSynonyms = appSettings.get('smart_diary_synonyms');
    if (synonymInput) synonymInput.value = savedSynonyms;
    
    const autotagTextarea = document.getElementById('autotag-rules-textarea');
    let savedRules = appSettings.get('smart_diary_autotag_rules');
    if (autotagTextarea) autotagTextarea.value = savedRules;
}

async function handleEntryContentInput(textarea) {
    autoResizeTextarea(textarea);
    const val = textarea.value;
    if (val === '/t' || val.endsWith('\n/t')) {
        const savedTemplate = appSettings.get('smartdiary_user_template');
        textarea.value = val.slice(0, -2) + savedTemplate; 
        autoResizeTextarea(textarea);
        addTagAutomatically('日記');
        showToast("テンプレートを挿入しました");
    } else if (val.endsWith('/save-t') && (val === '/save-t' || val.charAt(val.length - 8) === '\n')) {
        const newTemplate = val.slice(0, -7).trim();
        if (newTemplate) { 
            await appSettings.set('smartdiary_user_template', newTemplate);
            textarea.value = newTemplate;
            showToast("現在の内容をテンプレート保存しました"); 
        }
    }
}
window.addEventListener('scroll', () => {
    const currentScrollY = window.scrollY;
    const header = document.getElementById('main-header');
    const filterArea = document.getElementById('search-filter-area');
    
    if (viewMode === 'album') {
            if (isAlbumHeaderVisible && Math.abs(currentScrollY - lastScrollY) > 5) {
                isAlbumHeaderVisible = false;
                if (header) {
                    header.classList.add('header-hidden');
                    clearTimeout(headerHideTimeout);
                    headerHideTimeout = setTimeout(() => header?.classList.add('hidden'), 300);
                }
                if (filterArea) {
                    filterArea.classList.add('filter-hidden');
                    clearTimeout(filterHideTimeout);
                    filterHideTimeout = setTimeout(() => filterArea?.classList.add('hidden'), 300);
                }
                document.body.classList.remove('pt-14');
                const albumToggleBtn = document.getElementById('album-header-toggle-btn');
            if (albumToggleBtn) albumToggleBtn.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
        }
    } else {
        if (currentScrollY > 100) {
            if (currentScrollY > lastScrollY) {
                header?.classList.add('header-hidden');
                filterArea?.classList.add('filter-hidden');
            } else {
                clearTimeout(headerHideTimeout);
                clearTimeout(filterHideTimeout);
                header?.classList.remove('header-hidden', 'hidden');
                filterArea?.classList.remove('filter-hidden', 'hidden');
            }
        } else {
            clearTimeout(headerHideTimeout);
            clearTimeout(filterHideTimeout);
            header?.classList.remove('header-hidden', 'hidden');
            filterArea?.classList.remove('filter-hidden', 'hidden');
        }
    }
        lastScrollY = currentScrollY;

    if ((viewMode === 'list' || viewMode === 'album') && (window.innerHeight + currentScrollY) >= document.documentElement.scrollHeight - 300) {
        if (currentDisplayLimit < currentFilteredItems.length) {
            const prevLimit = currentDisplayLimit;
            currentDisplayLimit += 30;
            
            if (viewMode === 'list') {
                const container = document.getElementById('diary-container'); 
                const isSearching = checkIsSearching();
                currentFilteredItems.slice(prevLimit, currentDisplayLimit).forEach(item => {
                    container.appendChild(createCardElement(item, isSearching));
                });
                
                // 追加した要素が画面に確実に描画されたのを確認してから画像を読み込むように修正
                requestAnimationFrame(() => {
                    setTimeout(applyMediaUrls, 10);
                });
            } else if (viewMode === 'album') {
                renderAlbum(); // アルバムの続きを描画
            }
        }
    }
});

// ======= UI・表示系関数 =======
function initTheme() {
    const savedTheme = appSettings.get('theme');
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.getElementById('theme-icon').classList.replace('fa-moon', 'fa-sun');
    } else {
        document.documentElement.classList.remove('dark');
        document.getElementById('theme-icon').classList.replace('fa-sun', 'fa-moon');
    }
}

async function toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    const themeIcon = document.getElementById('theme-icon');
    
    if (isDark) {
        themeIcon.classList.replace('fa-moon', 'fa-sun');
        await appSettings.set('theme', 'dark');
    } else {
        themeIcon.classList.replace('fa-sun', 'fa-moon');
        await appSettings.set('theme', 'light');
    }
}

async function changeFontSize(size) {
    document.documentElement.style.setProperty('--diary-font-size', size);
    await appSettings.set('diary-font-size', size);
}

function toggleViewMenu(event) {
    if (isViewMenuLongPress) {
        if (event) event.preventDefault();
        isViewMenuLongPress = false;
        return;
    }
    if (event) event.stopPropagation();
    isViewMenuOpen = !isViewMenuOpen;
    toggleMenuState(document.getElementById('view-menu'), isViewMenuOpen);
}

function closeViewMenu() { 
    isViewMenuOpen = false;
    toggleMenuState(document.getElementById('view-menu'), false);
}

function setViewMode(mode) {
    closeViewMenu(); 
    hideCalendarPopup();

    if (viewMode === 'list' && mode !== 'list') {
        listScrollPosition = window.scrollY;
    }
    viewMode = mode;
    
    const header = document.getElementById('main-header');
    const filterArea = document.getElementById('search-filter-area'); 
    const albumToggleBtn = document.getElementById('album-header-toggle-btn');
    
    if (mode === 'album') {
        isAlbumHeaderVisible = false;
        if (header) header.classList.add('hidden', 'header-hidden'); 
        if (filterArea) filterArea.classList.add('hidden', 'filter-hidden'); 
        document.body.classList.remove('pt-14');
        if (albumToggleBtn) {
            albumToggleBtn.classList.remove('hidden');
            albumToggleBtn.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
        }
    } else {
        if (header) header.classList.remove('hidden', 'header-hidden'); 
        if (filterArea) filterArea.classList.remove('hidden', 'filter-hidden'); 
        document.body.classList.add('pt-14');
        if (albumToggleBtn) albumToggleBtn.classList.add('hidden');
    }
    
    document.getElementById('diary-container').classList.toggle('hidden', mode !== 'list'); 
    document.getElementById('calendar-view').classList.toggle('hidden', mode !== 'calendar'); 
    document.getElementById('album-view').classList.toggle('hidden', mode !== 'album');
    
    const btnIcon = document.getElementById('current-view-icon');
    if (btnIcon) {
        if (mode === 'list') btnIcon.className = "fa-solid fa-list-ul"; 
        else if (mode === 'calendar') btnIcon.className = "fa-regular fa-calendar"; 
        else if (mode === 'album') btnIcon.className = "fa-regular fa-image";
    }
    
    updateEmptyState(); 
    if (mode === 'calendar') renderCalendar(); 
    if (mode === 'album') renderAlbum();

    setTimeout(() => {
        if (mode === 'list') {
            window.scrollTo(0, listScrollPosition);
        } else {
            window.scrollTo(0, 0);
        }
    }, 10);
}

function toggleAlbumHeader() {
    const header = document.getElementById('main-header');
    const filterArea = document.getElementById('search-filter-area');
    const albumToggleBtn = document.getElementById('album-header-toggle-btn');
    
    isAlbumHeaderVisible = !isAlbumHeaderVisible;
    if (isAlbumHeaderVisible) {
        header?.classList.remove('hidden');
        filterArea?.classList.remove('hidden');
        setTimeout(() => {
            header?.classList.remove('header-hidden');
            filterArea?.classList.remove('filter-hidden');
        }, 10);
        
        document.body.classList.add('pt-14');
        if (albumToggleBtn) albumToggleBtn.innerHTML = '<i class="fa-solid fa-angle-up"></i>';
    } else {
        header?.classList.add('header-hidden');
        filterArea?.classList.add('filter-hidden');
        setTimeout(() => {
            header?.classList.add('hidden');
            filterArea?.classList.add('hidden');
        }, 300);
        
        document.body.classList.remove('pt-14');
        if (albumToggleBtn) albumToggleBtn.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
    }
}

function updateEmptyState() {
    const container = document.getElementById('diary-container');
    const emptyState = document.getElementById('empty-state');
    
    if (viewMode === 'calendar' || viewMode === 'album') {
        emptyState?.classList.add('hidden');
        emptyState?.classList.remove('flex');
        return;
    }
    
    if (currentFilteredItems.length === 0) { 
        container?.classList.add('hidden');
        emptyState?.classList.remove('hidden');
        emptyState?.classList.add('flex'); 
    } else { 
        container?.classList.remove('hidden');
        emptyState?.classList.add('hidden');
        emptyState?.classList.remove('flex'); 
    }
}

function syncSortChange(sourceId, targetId) {
    const source = document.getElementById(sourceId);
    const target = document.getElementById(targetId);
    if (source && target) {
        target.value = source.value;
        filterDiaryItems();
    }
}

function handleMainSortChange() {
    syncSortChange('main-sort-select', 'modal-sort-select');
}

function handleModalSortChange() {
    syncSortChange('modal-sort-select', 'main-sort-select');
}

function sortDiaryItemsByDateData() {
    diaryItems.sort((a, b) => {
        const timeA = getSafeDate(a.date).getTime();
        const timeB = getSafeDate(b.date).getTime();
        return timeB - timeA;
    });
}

async function saveLocally() { 
    try {
        await appDB.set('system_state', 'smart_diary_backup', diaryItems);
        
        // --- 修正箇所：現在の配列にない古いID（ゴースト）をIndexedDBから確実に消去 ---
        const validIds = new Set(diaryItems.map(i => i.id));
        const cachedItems = await appDB.getAll('diary_items');
        if (cachedItems && cachedItems.length > 0) {
            for (const cached of cachedItems) {
                if (!validIds.has(cached.id)) {
                    await appDB.delete('diary_items', cached.id);
                }
            }
        }
        // -------------------------------------------------------------------------
        
        for (const item of diaryItems) {
            await appDB.put('diary_items', item);
        }
    } catch (e) {
        console.error("IndexedDB save error:", e);
        alert("データのローカルキャッシュ保存中にエラーが発生しました。");
    }
    debouncedSave(); 
}

function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { saveDiaryToFolder(); }, 1500);
}

async function manualSave() {
    clearTimeout(saveTimeout);
    await saveDiaryToFolder();
    await saveSettingsToFolder();
    showToast("手動保存しました");
}

async function saveDiaryToFolder() { 
    if (!dirHandle) return;
    return writeQueue.add(async () => {
        try { 
            const yearlyData = {};
            diaryItems.forEach(item => {
                const year = getSafeDate(item.date).getFullYear() || 'unknown';
                if (!yearlyData[year]) yearlyData[year] = [];
                yearlyData[year].push(item);
            });

            for (const year of Object.keys(yearlyData)) {
                const fileName = `diary_data_${year}.json`;
                const fileHandle = await dirHandle.getFileHandle(fileName, { create: true }); 
                const writable = await fileHandle.createWritable(); 
                await writable.write(JSON.stringify(yearlyData[year], null, 2)); 
                await writable.close(); 
            }
        } catch (e) {
            console.error("saveDiaryToFolder error:", e);
        }
    });
}

async function saveSettingsToFolder() {
    if (!dirHandle) return;
    return appSettings.saveSettings();
}

async function loadDiaryFromLocalDB() { 
    try { 
        const items = await appDB.getAll('diary_items');
        if (items && items.length > 0) {
            diaryItems = items;
            diaryItems.sort((a, b) => getSafeDate(b.date).getTime() - getSafeDate(a.date).getTime());
            renderDiaryItems();
            if (typeof updateTagFilterOptions === 'function') updateTagFilterOptions();
            return;
        }

        const localData = await appDB.get('system_state', 'smart_diary_backup'); 
        if (localData && Array.isArray(localData)) { 
            diaryItems = localData; 
            renderDiaryItems();
            updateTagFilterOptions(); 
            await saveLocally();
        } else {
            const oldLocalData = localStorage.getItem('smart_diary_backup');
            if (oldLocalData) {
                try {
                    const parsed = JSON.parse(oldLocalData);
                    diaryItems = Array.isArray(parsed) ? parsed : [];
                    renderDiaryItems();
                    updateTagFilterOptions();
                    await saveLocally();
                    localStorage.removeItem('smart_diary_backup');
                } catch (e) { console.error(e); }
            } else {
                updateEmptyState();
            }
        }
    } catch (e) {
        console.error("loadDiaryFromLocalDB error:", e);
        updateEmptyState();
    } 
}

async function initFolderAccess() { 
    try { 
        if (!window.showDirectoryPicker) {
            alert("このブラウザはフォルダ同期機能に対応していません。");
            return;
        }
        
        if (dirHandle) {
            if (!confirm("現在フォルダに同期中です。別のフォルダに変更しますか？")) return;
        } else {
            const storedHandle = await appDB.get('system_state', 'dirHandle');
            if (storedHandle) {
                if ((await storedHandle.requestPermission({ mode: 'readwrite' })) === 'granted') {
                    await setupFolder(storedHandle);
                    showToast("前回のフォルダに再接続しました");
                    return;
                }
            }
        }

        const handle = await window.showDirectoryPicker({ mode: 'readwrite' }); 
        await appDB.set('system_state', 'dirHandle', handle);
        await setupFolder(handle);
        showToast("フォルダと同期しました"); 
    } catch (err) {
        console.warn(err);
    } 
}

async function loadDiaryFromFolder() { 
    if (!dirHandle) return; 
    try {
        const settingsHandle = await dirHandle.getFileHandle('settings.json');
        const settingsText = await (await settingsHandle.getFile()).text();
        const settings = JSON.parse(settingsText);
        
        const rules = settings.smart_diary_autotag_rules !== undefined ? settings.smart_diary_autotag_rules : (settings.autotagRules || '');
        const syns = settings.smart_diary_synonyms !== undefined ? settings.smart_diary_synonyms : (settings.synonyms || '');
        const incDate = settings.smart_diary_include_date !== undefined ? String(settings.smart_diary_include_date) : (settings.includeDate !== undefined ? String(settings.includeDate) : 'true');
        const tpl = settings.smartdiary_user_template !== undefined ? settings.smartdiary_user_template : (settings.userTemplate || '');
        const theme = settings.theme || 'light';
        const fontSize = settings['diary-font-size'] || '16px';

        await appSettings.set('smart_diary_autotag_rules', rules); 
        await appSettings.set('smart_diary_synonyms', syns); 
        await appSettings.set('smart_diary_include_date', incDate); 
        await appSettings.set('smartdiary_user_template', tpl);
        await appSettings.set('theme', theme); 
        await appSettings.set('diary-font-size', fontSize); 
        
        if (settings.folders) {
            savedFolders = settings.folders;
            await appDB.set('system_state', 'smart_diary_folders', savedFolders);
            renderFolderList();
        }
        
        const autotagTextarea = document.getElementById('autotag-rules-textarea');
        if (autotagTextarea) autotagTextarea.value = rules;
        
        const synonymInput = document.getElementById('custom-synonym-input');
        if (synonymInput) synonymInput.value = syns;
        
        const includeDateCb = document.getElementById('custom-search-include-date');
        if (includeDateCb) includeDateCb.checked = (incDate === 'true');

        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
            document.getElementById('theme-icon').classList.replace('fa-moon', 'fa-sun');
        } else {
            document.documentElement.classList.remove('dark');
            document.getElementById('theme-icon').classList.replace('fa-sun', 'fa-moon');
        }
        document.documentElement.style.setProperty('--diary-font-size', fontSize);
        const fontSelect = document.querySelector('select[onchange="changeFontSize(this.value)"]');
        if (fontSelect) fontSelect.value = fontSize;

    } catch(e) {
        console.warn("Settings file not found or invalid.");
    }

    try { 
        let hasOldFormat = false;
        const filePromises = [];

        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && entry.name.startsWith('diary_data') && entry.name.endsWith('.json')) {
                filePromises.push((async () => {
                    try {
                        const file = await entry.getFile();
                        const text = await file.text();
                        if (text.trim().length > 0) {
                            const parsed = JSON.parse(text);
                            let items = [];
                            if (!Array.isArray(parsed) && parsed.diaryItems) {
                                items = parsed.diaryItems;
                                if (parsed.autotagRules) {
                                    await appSettings.set('smart_diary_autotag_rules', parsed.autotagRules);
                                }
                                hasOldFormat = true;
                            } else {
                                items = Array.isArray(parsed) ? parsed : [];
                            }
                            
                            return items.map(item => ({
                                ...item,
                                tags: Array.isArray(item.tags) ? item.tags : (item.tags ? item.tags.split(',').map(t => t.trim()).filter(Boolean) : [])
                            }));
                        }
                    } catch (fileErr) {
                        console.error(`ファイルの読み込みに失敗しました: ${entry.name}`, fileErr);
                    }
                    return [];
                })());
            }
        }

        const results = await Promise.all(filePromises);
        let allItems = results.flat();

        if (allItems.length > 0) {
            const uniqueItems = new Map();
            allItems.forEach(item => uniqueItems.set(item.id, item));
            diaryItems = Array.from(uniqueItems.values());
            
            if (hasOldFormat) {
                saveDiaryToFolder();
                saveSettingsToFolder();
            }
            
            sortDiaryItemsByDateData();
            try {
                await appDB.set('system_state', 'smart_diary_backup', diaryItems);
            } catch(e) { console.error(e); }
        }
    } catch (e) {
        console.error("loadDiaryFromFolder error:", e);
    } 
    
    renderDiaryItems();
    updateTagFilterOptions();
    if (typeof setViewMode === 'function') setViewMode(viewMode);
}

function renderMediaPreview() {
    const previewContainer = document.getElementById('media-preview-container');
    previewContainer.innerHTML = '';
    
    if (currentMediaFiles.length === 0) {
        previewContainer.classList.add('hidden');
        return;
    }
    previewContainer.classList.remove('hidden');

    const clearDragHighlight = () => {
        document.querySelectorAll('#media-preview-container > div').forEach(node => {
            node.classList.remove('ring-2', 'ring-indigo-500', 'scale-105');
        });
    };
    
    currentMediaFiles.forEach((media, index) => {
        let innerHtml = '';
        const srcValue = media.mediaName ? '' : (media.data || media.thumbnail || '');
        const pendingAttr = media.mediaName ? `data-pending-media="${media.mediaName}"` : '';

        if (media.type?.startsWith('image/')) { 
            innerHtml = `<img src="${srcValue}" ${pendingAttr} class="w-full h-full object-contain pointer-events-none"/>`; 
        } else if (media.type?.startsWith('video/')) { 
            if (media.mediaName || media.thumbnail) {
                innerHtml = `<img src="${srcValue}" ${pendingAttr} class="w-full h-full object-contain pointer-events-none"/><div class="absolute top-1 left-1 text-white bg-black/50 rounded px-1 text-[8px] pointer-events-none"><i class="fa-solid fa-video"></i></div>`;
            } else {
                innerHtml = `<i class="fa-solid fa-film text-3xl pointer-events-none"></i>`;
            }
        }
        
        const el = document.createElement('div');
        el.className = `relative rounded-xl overflow-hidden aspect-square ${media.thumbnail || media.mediaName ? 'bg-slate-100' : 'bg-slate-900 text-white'} flex items-center justify-center group cursor-move`;
        el.draggable = true;
        el.dataset.index = index;
        el.innerHTML = `
            ${innerHtml}
            <div class="absolute top-1 left-1 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-md pointer-events-none opacity-80"><i class="fa-solid fa-grip-vertical"></i></div>
            <button type="button" onclick="removeSelectedMedia(${index})" class="absolute top-1 right-1 w-6 h-6 bg-red-500/80 hover:bg-red-600 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100 z-10"><i class="fa-solid fa-xmark text-xs"></i></button>
        `;
        
        el.addEventListener('dragstart', function(e) {
            dragStartIndex = parseInt(this.dataset.index);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragStartIndex);
            setTimeout(() => this.classList.add('opacity-50'), 0);
        });
        
        el.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            return false;
        });
        
        el.addEventListener('dragenter', function(e) {
            e.preventDefault();
            this.classList.add('ring-2', 'ring-indigo-500', 'scale-105');
        });
        
        el.addEventListener('dragleave', function(e) {
            this.classList.remove('ring-2', 'ring-indigo-500', 'scale-105');
        });
        
        el.addEventListener('drop', function(e) {
            e.stopPropagation();
            this.classList.remove('ring-2', 'ring-indigo-500', 'scale-105');
            const dragEndIndex = parseInt(this.dataset.index);
            if (dragStartIndex !== dragEndIndex && dragStartIndex > -1) {
                const movedItem = currentMediaFiles.splice(dragStartIndex, 1)[0];
                currentMediaFiles.splice(dragEndIndex, 0, movedItem);
                renderMediaPreview();
            }
            return false;
        });
        
        el.addEventListener('dragend', function(e) {
            this.classList.remove('opacity-50');
            clearDragHighlight();
        });

        el.addEventListener('touchstart', function(e) {
            dragStartIndex = parseInt(this.dataset.index);
            setTimeout(() => this.classList.add('opacity-50'), 0);
        }, { passive: true });

        el.addEventListener('touchmove', function(e) {
            e.preventDefault(); 
            const touch = e.touches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            
            clearDragHighlight();

            if (target) {
                const dropTarget = target.closest('#media-preview-container > div');
                if (dropTarget && dropTarget !== this) {
                    dropTarget.classList.add('ring-2', 'ring-indigo-500', 'scale-105');
                }
            }
        }, { passive: false });

        el.addEventListener('touchend', function(e) {
            this.classList.remove('opacity-50');
            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            
            clearDragHighlight();

            if (target) {
                const dropTarget = target.closest('#media-preview-container > div');
                if (dropTarget && dropTarget !== this) {
                    const dragEndIndex = parseInt(dropTarget.dataset.index);
                    if (dragStartIndex !== dragEndIndex && dragStartIndex > -1) {
                        const movedItem = currentMediaFiles.splice(dragStartIndex, 1)[0];
                        currentMediaFiles.splice(dragEndIndex, 0, movedItem);
                        renderMediaPreview();
                    }
                }
            }
        });
        
        previewContainer.appendChild(el);
    });
    setTimeout(applyMediaUrls, 10);
}

async function removeSelectedMedia(index) {
    // --- 修正箇所：単なるプレビュー配列からの削除だけでなく、フォルダ内の実体ファイルも削除する処理を追加 ---
    const mediaToDelete = currentMediaFiles[index];
    
    if (mediaToDelete && dirHandle) {
        if (!confirm('この画像を削除しますか？\n（元のフォルダからも完全に削除されます）')) return;
        
        try {
            // originalsフォルダからの削除
            if (mediaToDelete.originalName) {
                const originalsDir = await dirHandle.getDirectoryHandle('originals', { create: false }).catch(() => null);
                if (originalsDir) {
                    await originalsDir.removeEntry(mediaToDelete.originalName).catch(e => console.warn("原本ファイル削除スキップ:", e));
                }
            }
            
            // mediaフォルダ(サムネイル等)からの削除
            if (mediaToDelete.mediaName) {
                const mediaDir = await dirHandle.getDirectoryHandle('media', { create: false }).catch(() => null);
                if (mediaDir) {
                    await mediaDir.removeEntry(mediaToDelete.mediaName).catch(e => console.warn("メディアファイル削除スキップ:", e));
                }
            }
            showToast('画像を完全に削除しました');
        } catch (e) {
            console.error('画像ファイルの削除に失敗しました:', e);
            showToast('画像ファイルの削除に失敗しました');
        }
    }
    // -----------------------------------------------------------------------------------

    currentMediaFiles.splice(index, 1);
    renderMediaPreview();

    // --- 修正箇所：保存ボタンを押さなくても、日記本体のデータから画像を即座に消去する ---
    const entryId = document.getElementById('entry-id')?.value;
    if (entryId) {
        const itemIndex = diaryItems.findIndex(i => i.id === entryId);
        if (itemIndex !== -1) {
            // 日記データの上書きと即時保存
            diaryItems[itemIndex].mediaFiles = [...currentMediaFiles];
            saveLocally(); 
            
            // 後ろに隠れている日記一覧画面からも、消した画像のサムネイルをすぐに消去する
            if (typeof renderDiaryItems === 'function') {
                renderDiaryItems();
            }
        }
    }
    // -----------------------------------------------------------------------------------
}

async function handleMediaSelect(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    
    if (!dirHandle) {
        alert("【重要】画像や動画の原本を保存するには、先に右上のフォルダアイコンから保存先を同期してください。");
    }

    const previewContainer = document.getElementById('media-preview-container');
    previewContainer.classList.remove('hidden');
    
    let originalDir = null;
    if (dirHandle) {
        originalDir = await dirHandle.getDirectoryHandle('originals', { create: true });
    }
    
    for (const file of files) {
        // --- 修正箇所：ファイル名を「年月日_ランダム4文字_元の名前」に変更して自動ソート対応 ---
        const now = new Date();
        const dateStr = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
        const randomStr = Math.random().toString(36).substring(2, 6);
        const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
        const nameWithoutExt = file.name.includes('.') ? file.name.substring(0, file.name.lastIndexOf('.')) : file.name;
        const originalName = `${dateStr}_${randomStr}_${nameWithoutExt}${ext ? '.' + ext : ''}`;
        // -------------------------------------------------------------------------

        const type = file.type;
        const metadata = await getMediaMetadata(file);
        let newMedia = null;

        if (type.startsWith('image/')) {
            const compressedData = await compressImage(file); 
            newMedia = { type, data: compressedData, originalName, metadata };
            addTagAutomatically('Photo');
        } else if (type.startsWith('video/')) {
            const thumbnail = await generateVideoThumbnail(file); 
            newMedia = { type, thumbnail: thumbnail, originalName, metadata };
            addTagAutomatically('Video');
        }

        if (newMedia) {
            currentMediaFiles.push(newMedia);
            if (originalDir) {
                try {
                    const fileHandle = await originalDir.getFileHandle(originalName, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(file);
                    await writable.close();
                } catch (e) {
                    console.warn(e);
                } 
            }
        }
    }
    renderMediaPreview();
    event.target.value = ''; 
}

function compressImage(file, maxSize = 2560) {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file); 
        
        img.onload = () => {
            URL.revokeObjectURL(url); 
            let width = img.width, height = img.height;
            if (width > height) { 
                if (width > maxSize) {
                    height = Math.round(height * maxSize / width);
                    width = maxSize;
                } 
            } else { 
                if (height > maxSize) {
                    width = Math.round(width * maxSize / height);
                    height = maxSize;
                } 
            }
            const canvas = document.createElement('canvas'); 
            canvas.width = width;
            canvas.height = height; 
            const ctx = canvas.getContext('2d'); 
            ctx.drawImage(img, 0, 0, width, height); 
            
            const mimeType = file.type === 'image/png' ? 'image/jpeg' : file.type;
            const dataUrl = canvas.toDataURL(mimeType, 0.85);
            
            canvas.width = 0;
            canvas.height = 0;
            
            resolve(dataUrl);
        }; 
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        img.src = url;
    });
}

async function openOriginal(fileName) {
    if (!dirHandle) {
        alert("オリジナルファイルを開くには、上部のフォルダアイコンから保存先を同期してください。");
        return;
    }
    try {
        const originalDir = await dirHandle.getDirectoryHandle('originals'); 
        const fileHandle = await originalDir.getFileHandle(fileName); 
        const file = await fileHandle.getFile(); 
        const url = URL.createObjectURL(file);
        const newWindow = window.open(url, '_blank');
        
        if (newWindow) {
            setTimeout(() => { URL.revokeObjectURL(url); }, 60000);
        } else {
            alert("ポップアップがブロックされました。設定を確認してください。");
            URL.revokeObjectURL(url);
        }
    } catch (e) {
        alert("オリジナルファイルが見つからないか、読み込めませんでした。");
    }
}

async function generateVideoThumbnail(file) {
    return new Promise((resolve) => {
        const video = document.createElement('video'); 
        const url = URL.createObjectURL(file); 
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto"; 
        
        const cleanup = () => {
            URL.revokeObjectURL(url);
            video.removeAttribute('src');
            video.load();
        };
        const timeoutId = setTimeout(() => { cleanup(); resolve(null); }, 8000);
        
        video.addEventListener('loadeddata', () => { video.currentTime = 0.1; });
        video.addEventListener('seeked', () => {
            clearTimeout(timeoutId);
            try { 
                const canvas = document.createElement('canvas'); 
                const scale = Math.min(640 / video.videoWidth, 360 / video.videoHeight, 1); 
                canvas.width = (video.videoWidth * scale) || 640; 
                canvas.height = (video.videoHeight * scale) || 360; 
                canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height); 
                
                const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                
                canvas.width = 0;
                canvas.height = 0;
                
                cleanup(); 
                resolve(dataUrl); 
            } catch (e) {
                cleanup();
                resolve(null);
            }
        }); 
        video.src = url;
        video.load(); 
    });
}

function getMediaMetadata(file) {
    return new Promise((resolve) => {
        const metadata = { date: null, location: null };
        if (file.lastModified) { 
            const d = new Date(file.lastModified); 
            metadata.date = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; 
        }
        if (file.type.startsWith('image/')) {
            try {
                if (typeof EXIF !== 'undefined') {
                    EXIF.getData(file, function() {
                        try {
                            const dateTime = EXIF.getTag(this, "DateTimeOriginal") || EXIF.getTag(this, "DateTime"); 
                            if (dateTime) {
                                const parts = dateTime.split(' ');
                                if (parts[0]) {
                                    metadata.date = parts[0].replace(/:/g, '/') + (parts[1] ? ' ' + parts[1].substring(0, 5) : '');
                                }
                            }
                            const lat = EXIF.getTag(this, "GPSLatitude");
                            const lng = EXIF.getTag(this, "GPSLongitude"); 
                            const latRef = EXIF.getTag(this, "GPSLatitudeRef");
                            const lngRef = EXIF.getTag(this, "GPSLongitudeRef");
                            
                            if (lat && lng) { 
                                const convertDMS = (dms, ref) => {
                                    let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
                                    if (ref === "S" || ref === "W") dd *= -1;
                                    return dd;
                                }; 
                                metadata.location = `${convertDMS(lat, latRef).toFixed(4)}, ${convertDMS(lng, lngRef).toFixed(4)}`; 
                            }
                        } catch(e) {}
                        resolve(metadata);
                    });
                } else {
                    resolve(metadata);
                }
            } catch(err) {
                resolve(metadata);
            }
        } else {
            resolve(metadata);
        }
    });
}

async function saveDiaryItem() {
    const idInput = document.getElementById('entry-id').value;
    const isNew = !idInput;
    const itemId = idInput || generateUniqueId();
    
    const contentVal = document.getElementById('entry-content').value;
    const rulesStr = appSettings.get('smart_diary_autotag_rules');
    if (rulesStr) {
        const rules = rulesStr.split('\n').filter(r => r.includes(':'));
        rules.forEach(rule => {
            const [tag, keywords] = rule.split(':').map(s => s.trim());
            const kwArray = keywords.split(',').map(k => k.trim()).filter(k => k !== '');
            if (kwArray.length > 0 && kwArray.some(kw => contentVal.includes(kw))) {
                addTagAutomatically(tag);
            }
        });
    }

    const item = {
        id: itemId,
        date: document.getElementById('entry-date').value,
        weather: document.querySelector('input[name="weather"]:checked')?.value || '',
        content: contentVal,
        tags: document.getElementById('entry-tags').value.split(',').map(t => t.trim()).filter(Boolean),
        updatedAt: new Date().toISOString(),
        mediaFiles: typeof currentMediaFiles !== 'undefined' ? currentMediaFiles : []
    };

    const existingIndex = diaryItems.findIndex(i => i.id === item.id);
    if (existingIndex >= 0) {
        diaryItems[existingIndex] = item;
    } else {
        diaryItems.push(item);
    }
    
    diaryItems.sort((a, b) => getSafeDate(b.date).getTime() - getSafeDate(a.date).getTime());

    await saveLocally();
    showToast('保存しました');

    if (typeof closeModal === 'function') closeModal();
    if (typeof renderDiaryItems === 'function') renderDiaryItems();
    if (typeof updateTagFilterOptions === 'function') updateTagFilterOptions();
}

async function deleteDiaryItem(id) {
    if (!confirm('本当に削除しますか？')) return;

    const itemToDelete = diaryItems.find(i => i.id === id);
    diaryItems = diaryItems.filter(i => i.id !== id);

    if (itemToDelete && dirHandle) {
        try {
            const originalsDir = await dirHandle.getDirectoryHandle('originals', { create: false }).catch(() => null);
            const mediaDir = await dirHandle.getDirectoryHandle('media', { create: false }).catch(() => null);
            const mediaFiles = itemToDelete.mediaFiles || (itemToDelete.media ? [itemToDelete.media] : []);
            
            for (const media of mediaFiles) {
                const isUsedElsewhere = diaryItems.some(i => i.id !== id && (i.mediaFiles || (i.media ? [i.media] : [])).some(m => m.originalName === media.originalName));
                
                if (originalsDir && media.originalName && !isUsedElsewhere) {
                    await originalsDir.removeEntry(media.originalName).catch(() => {});
                }
                if (mediaDir && media.mediaName && !isUsedElsewhere) {
                    await mediaDir.removeEntry(media.mediaName).catch(() => {});
                }
            }
        } catch (e) {
            console.error('ファイルの削除に失敗しました:', e);
        }
    }

    try {
        await appDB.delete('diary_items', id);
        await saveLocally();
        showToast('削除しました');
    } catch (e) {
        console.error('削除の反映に失敗しました:', e);
    }

    const editorModal = document.getElementById('editor-modal');
    if (editorModal && !editorModal.classList.contains('hidden')) {
        if (typeof closeModal === 'function') closeModal();
    }

    if (typeof renderDiaryItems === 'function') renderDiaryItems();
    if (typeof updateTagFilterOptions === 'function') updateTagFilterOptions();
}

async function toggleFixed(id) { 
    const item = diaryItems.find(i => i.id === id);
    if (item) {
        item.fixed = !item.fixed;
        await saveLocally(); 
        filterDiaryItems();
        showToast(item.fixed ? "固定しました" : "固定解除しました");
    }
}

function moveItem(id, direction) {
    const isSearching = checkIsSearching(); 
    if (isSearching) { 
        alert("検索中、または並び替え順の変更中は手動並び替えできません。「手動順」に戻してください。"); 
        return; 
    }
    
    const idx = diaryItems.findIndex(i => i.id === id); 
    if (idx === -1) return; 
    
    if (diaryItems[idx].fixed) { 
        showToast("このアイテムは固定されています"); 
        return; 
    }
    
    const fixedPositions = []; 
    const nonFixedItems = []; 
    
    diaryItems.forEach((item, index) => { 
        if (item.fixed) {
            fixedPositions.push({ index, item });
        } else {
            nonFixedItems.push(item);
        }
    });
    
    const nonFixedIdx = nonFixedItems.findIndex(i => i.id === id); 
    const newNonFixedIdx = nonFixedIdx + direction; 
    if (newNonFixedIdx < 0 || newNonFixedIdx >= nonFixedItems.length) return;
    
    const temp = nonFixedItems[nonFixedIdx]; 
    nonFixedItems.splice(nonFixedIdx, 1); 
    nonFixedItems.splice(newNonFixedIdx, 0, temp);
    
    const newDiaryItems = new Array(diaryItems.length); 
    fixedPositions.forEach(p => newDiaryItems[p.index] = p.item); 
    
    let ptr = 0; 
    for (let i = 0; i < newDiaryItems.length; i++) { 
        if (!newDiaryItems[i]) newDiaryItems[i] = nonFixedItems[ptr++]; 
    }
    
    const container = document.getElementById('diary-container'); 
    const firstTops = {}; 
    container.querySelectorAll('.diary-card').forEach(card => { 
        firstTops[card.getAttribute('data-id')] = card.getBoundingClientRect().top; 
    });
    
    diaryItems = newDiaryItems; 
    saveLocally(); 
    
    diaryItems.forEach(item => { 
        const card = container.querySelector(`.diary-card[data-id="${item.id}"]`); 
        if (card) {
            container.appendChild(card);
        } 
    });
    
    const lastTops = {}; 
    container.querySelectorAll('.diary-card').forEach(card => { 
        lastTops[card.getAttribute('data-id')] = card.getBoundingClientRect().top; 
    }); 
    
    const targetDeltaY = firstTops[id] - lastTops[id]; 
    window.scrollBy(0, -targetDeltaY);
    
    const postScrollTops = {}; 
    container.querySelectorAll('.diary-card').forEach(card => { 
        postScrollTops[card.getAttribute('data-id')] = card.getBoundingClientRect().top; 
    });
    
    const movedCard = container.querySelector(`.diary-card[data-id="${id}"]`);
    if (movedCard) { 
        movedCard.classList.add('z-30', 'scale-[1.02]', 'shadow-2xl', 'ring-2', 'ring-indigo-400'); 
        if (movedCard.dataset.timeoutId) clearTimeout(parseInt(movedCard.dataset.timeoutId)); 
        movedCard.dataset.timeoutId = setTimeout(() => { 
            movedCard.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.4s, transform 0.4s'; 
            movedCard.classList.remove('scale-[1.02]', 'shadow-2xl', 'ring-2', 'ring-indigo-400'); 
            setTimeout(() => movedCard.classList.remove('z-30'), 400); 
        }, 400); 
    }
    
    container.querySelectorAll('.diary-card').forEach(card => { 
        const cid = card.getAttribute('data-id'); 
        const firstY = firstTops[cid]; 
        const currentY = postScrollTops[cid]; 
        if (firstY !== undefined && currentY !== undefined) { 
            const deltaY = firstY - currentY; 
            if (deltaY !== 0) { 
                card.style.transform = `translateY(${deltaY}px)`; 
                card.style.transition = 'none'; 
            } 
        } 
    });
    
    requestAnimationFrame(() => { 
        container.querySelectorAll('.diary-card').forEach(card => { 
            card.getBoundingClientRect(); 
            card.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)'; 
            card.style.transform = ''; 
        }); 
    });
}

async function loadFolders() {
    try {
        const localFolders = await appDB.get('system_state', 'smart_diary_folders');
        if (localFolders && Array.isArray(localFolders)) {
            savedFolders = localFolders;
            renderFolderList();
        } else {
            const oldFolders = localStorage.getItem('smart_diary_folders');
            if (oldFolders) {
                savedFolders = JSON.parse(oldFolders);
                renderFolderList();
                await appDB.set('system_state', 'smart_diary_folders', savedFolders);
                localStorage.removeItem('smart_diary_folders');
            }
        }
    } catch (e) {
        console.error("loadFolders error:", e);
    }
}

function renderFolderList() {
    const list = document.getElementById('folder-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (savedFolders.length === 0) {
        list.innerHTML = '<p class="text-[10px] text-slate-400 py-2 text-center">保存された条件はありません</p>';
        return;
    }
    
    savedFolders.forEach(folder => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 group cursor-pointer transition-colors";
        
        const btn = document.createElement('div');
        btn.className = "flex-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 truncate";
        btn.innerHTML = `<i class="fa-solid fa-folder text-amber-400 mr-1.5"></i>${folder.name}`;
        btn.onclick = () => applyFolder(folder.id);
        
        const actions = document.createElement('div');
        actions.className = "flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity px-1";
        
        const editBtn = document.createElement('button');
        editBtn.className = "text-slate-400 hover:text-indigo-500 text-[10px]";
        editBtn.innerHTML = '<i class="fa-solid fa-gear"></i>';
        editBtn.onclick = (e) => { e.stopPropagation(); editFolder(folder.id); };
        
        const delBtn = document.createElement('button');
        delBtn.className = "text-slate-400 hover:text-rose-500 text-[10px] ml-2";
        delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        delBtn.onclick = (e) => { e.stopPropagation(); deleteFolder(folder.id); };
        
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        item.appendChild(btn);
        item.appendChild(actions);
        list.appendChild(item);
    });
}

function toggleFolderMenu(e) {
    if (e) e.stopPropagation();
    isFolderMenuOpen = !isFolderMenuOpen;
    toggleMenuState(document.getElementById('folder-menu'), isFolderMenuOpen);
}

function closeFolderMenu() {
    isFolderMenuOpen = false;
    toggleMenuState(document.getElementById('folder-menu'), false);
}

async function saveCurrentAsFolder() {
    const name = prompt("この検索条件に付ける名前を入力してください：");
    if (!name || !name.trim()) return;
    
    const folder = {
        id: generateUniqueId(),
        name: name.trim(),
        search: document.getElementById('search-input')?.value || '',
        tag: document.getElementById('tag-filter')?.value || '',
        and: document.getElementById('and-input')?.value || '',
        or: document.getElementById('or-input')?.value || '',
        not: document.getElementById('not-input')?.value || '',
        tab: currentPeriodFilter
    };
    
    savedFolders.push(folder);
    await appDB.set('system_state', 'smart_diary_folders', savedFolders);
    renderFolderList();
    saveSettingsToFolder();
    showToast("条件をフォルダに保存しました");
}

function editFolder(id) {
    const folder = savedFolders.find(f => f.id === id);
    if (!folder) return;
    
    document.getElementById('edit-folder-id').value = folder.id;
    document.getElementById('edit-folder-name').value = folder.name || '';
    document.getElementById('edit-folder-search').value = folder.search || '';
    document.getElementById('edit-folder-tag').value = folder.tag || '';
    document.getElementById('edit-folder-and').value = folder.and || '';
    document.getElementById('edit-folder-or').value = folder.or || '';
    document.getElementById('edit-folder-not').value = folder.not || '';
    document.getElementById('edit-folder-tab').value = folder.tab || 'ALL';
    
    const modal = document.getElementById('folder-edit-modal');
    animateModal(modal, true);
    closeFolderMenu();
}

function closeFolderEditModal() {
    animateModal(document.getElementById('folder-edit-modal'), false);
}

async function saveFolderEdit() {
    const id = document.getElementById('edit-folder-id').value;
    const folderIndex = savedFolders.findIndex(f => f.id === id);
    if (folderIndex === -1) return;
    
    const name = document.getElementById('edit-folder-name').value.trim();
    if (!name) {
        alert('フォルダ名を入力してください');
        return;
    }
    
    savedFolders[folderIndex] = {
        id: id,
        name: name,
        search: document.getElementById('edit-folder-search').value,
        tag: document.getElementById('edit-folder-tag').value,
        and: document.getElementById('edit-folder-and').value,
        or: document.getElementById('edit-folder-or').value,
        not: document.getElementById('edit-folder-not').value,
        tab: document.getElementById('edit-folder-tab').value
    };
    
    await appDB.set('system_state', 'smart_diary_folders', savedFolders);
    renderFolderList();
    closeFolderEditModal();
    saveSettingsToFolder();
    showToast("検索フォルダを更新しました");
}

function applyFolder(id) {
    const folder = savedFolders.find(f => f.id === id);
    if (!folder) return;
    
    if (document.getElementById('search-input')) document.getElementById('search-input').value = folder.search; 
    if (document.getElementById('tag-filter')) document.getElementById('tag-filter').value = folder.tag; 
    if (document.getElementById('and-input')) document.getElementById('and-input').value = folder.and; 
    if (document.getElementById('or-input')) document.getElementById('or-input').value = folder.or; 
    if (document.getElementById('not-input')) document.getElementById('not-input').value = folder.not;
    
    setPeriodFilter(folder.tab || 'ALL');
    closeFolderMenu();
    applyAdvancedSearch();
    showToast(`フォルダ「${folder.name}」を適用`);
}

async function deleteFolder(id) {
    if (!confirm("この疑似フォルダを削除しますか？")) return;
    savedFolders = savedFolders.filter(f => f.id !== id);
    await appDB.set('system_state', 'smart_diary_folders', savedFolders);
    renderFolderList();
    saveSettingsToFolder();
}

function setupLongPress() {
    const btns = document.querySelectorAll('.search-trigger-btn');
    btns.forEach(btn => {
        const startPress = (e) => { 
            if (e.type === 'mousedown' && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
            isLongPress = false; 
            clearTimeout(longPressTimer); 
            longPressTimer = setTimeout(() => { 
                isLongPress = true; 
                clearAllSearchSettings(); 
                showToast("検索・フィルタをクリアしました"); 
                if (navigator.vibrate) navigator.vibrate(50); 
            }, 600); 
        };
        const cancelPress = () => clearTimeout(longPressTimer);
        btn.addEventListener('touchstart', startPress, {passive: true}); 
        btn.addEventListener('touchend', cancelPress); 
        btn.addEventListener('touchcancel', cancelPress); 
        btn.addEventListener('mousedown', startPress); 
        btn.addEventListener('mouseup', cancelPress); 
        btn.addEventListener('mouseleave', cancelPress);
    });
}
function setupViewMenuLongPress() {
    const btn = document.getElementById('view-menu-btn'); 
    if (!btn) return;
    const startPress = (e) => { 
        if (e.type === 'mousedown' && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
        isViewMenuLongPress = false; 
        clearTimeout(viewMenuLongPressTimer); 
        viewMenuLongPressTimer = setTimeout(() => { 
            isViewMenuLongPress = true; 
            clearAllSelections(); 
            showToast("選択をすべて解除しました"); 
            if (navigator.vibrate) navigator.vibrate(50); 
        }, 600); 
    };
    const cancelPress = () => clearTimeout(viewMenuLongPressTimer);
    btn.addEventListener('touchstart', startPress, {passive: true}); 
    btn.addEventListener('touchend', cancelPress); 
    btn.addEventListener('touchcancel', cancelPress); 
    btn.addEventListener('mousedown', startPress); 
    btn.addEventListener('mouseup', cancelPress); 
    btn.addEventListener('mouseleave', cancelPress);
}

function createCardElement(item, isSearching) {
    const weatherObj = weatherConfig[item.weather] || null; 
    const weatherIconHtml = weatherObj ? `<i class="fa-solid ${weatherObj.icon} ${weatherObj.color} text-sm" title="${weatherObj.label}"></i>` : '';
    
    let mediaHtml = '';
    const images = getAllImagesFromItem(item);

    if (images.length > 0) {
        const generateOverlays = (img, mediaData) => {
            let originalBtn = img.isOriginal ? `<button onclick="event.stopPropagation(); openOriginal('${img.originalName}')" class="absolute bottom-2 right-2 bg-black/40 hover:bg-black/60 text-white/90 backdrop-blur-md rounded-lg px-2 py-1 text-[10px] font-bold tracking-wide transition-all z-10 flex items-center gap-1.5 shadow-sm"><i class="fa-solid fa-arrow-up-right-from-square"></i> Original</button>` : '';
            let metaBadge = '';
            if (mediaData?.metadata) {
                const meta = mediaData.metadata; 
                let parts = [];
                if (meta.date) parts.push(`<span class="inline-flex items-center gap-1"><i class="fa-solid fa-camera"></i>${meta.date.split(' ')[0]}</span>`); 
                if (meta.location) parts.push(`<span class="inline-flex items-center gap-1"><i class="fa-solid fa-location-dot"></i></span>`);
                if (parts.length > 0) metaBadge = `<div class="absolute top-2 left-2 bg-black/50 text-white/90 backdrop-blur-md rounded-lg px-1.5 py-0.5 text-[9px] font-medium tracking-wide z-10 flex items-center gap-1.5 shadow-sm pointer-events-none">${parts.join('')}</div>`;
            }
            return { originalBtn, metaBadge };
        };

        const generateMediaHtml = (img, index, wrapperClasses, imgClasses) => {
            const { originalBtn, metaBadge } = generateOverlays(img, item.mediaFiles?.[index] || item.media);
            let html = `<div class="${wrapperClasses} relative media-item-container group" data-media-index="${index}">`;
            
            if (!img.isVideo) {
                html += `<img src="${img.src}" ${img.pendingAttr} alt="Media" class="${imgClasses} cursor-zoom-in transition-transform duration-300" onclick="event.stopPropagation(); openLightboxFromCard('${item.id}', ${index})"/>${metaBadge} ${originalBtn}`;
            } else {
                const posterAttr = img.src ? `poster="${img.src}"` : (img.pendingAttr ? `poster="" ${img.pendingAttr}` : ''); 
                const videoId = `video-${item.id}-${index}`;
                html += `<video id="${videoId}" ${posterAttr} controls preload="none" class="${imgClasses} bg-black"></video>${metaBadge} ${originalBtn}`;
                
                if (dirHandle && img.originalName) { 
                    dirHandle.getDirectoryHandle('originals')
                        .then(dir => dir.getFileHandle(img.originalName))
                        .then(handle => handle.getFile())
                        .then(file => {
                            const videoEl = document.getElementById(videoId);
                            if (videoEl) videoEl.src = URL.createObjectURL(file);
                        })
                        .catch(e => {}); 
                }
            }
            html += `</div>`;
            return html;
        };

        if (images.length === 1) {
            mediaHtml = `<div class="mt-3 silver-ratio-container mx-auto">`;
            mediaHtml += generateMediaHtml(images[0], 0, "rounded-xl overflow-hidden h-full", "w-full h-full object-contain");
            mediaHtml += `</div>`;
        } else {
            const gridCols = images.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3';
            mediaHtml = `<div class="mt-3 grid ${gridCols} gap-2">`;
            images.forEach((img, index) => {
                mediaHtml += generateMediaHtml(img, index, "overflow-hidden rounded-xl border border-slate-100 dark:border-slate-700 aspect-square sm:max-h-60 bg-slate-50 dark:bg-slate-900 flex items-center justify-center", "w-full h-full object-contain bg-slate-100 dark:bg-slate-900 hover:scale-[1.02]");
            });
            mediaHtml += `</div>`;
        }
    }
    
    let tagsHtml = '';
    if (item.tags && item.tags.length > 0) {
        tagsHtml = `<div class="flex flex-wrap gap-1.5 mt-3">${item.tags.map(tag => `<span class="bg-slate-50 dark:bg-slate-700 text-slate-500 dark:text-slate-300 border border-slate-100 dark:border-slate-600 text-[11px] px-2 py-0.5 rounded-md font-medium">#${DOMPurify.sanitize(tag)}</span>`).join('')}</div>`;
    }
    
    const formattedDate = getSafeDate(item.date).toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
    let updateInfo = '';
    if (item.updatedAt) {
        const upDate = new Date(item.updatedAt).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        updateInfo = `<span class="text-[10px] text-slate-400 font-normal ml-2 tracking-normal" title="最終更新"><i class="fa-solid fa-clock-rotate-left mr-1"></i>${upDate}</span>`;
    }
    
    const card = document.createElement('div');
    let borderStyle = '';
    let synonymBadge = '';
    
    if (item.__isSynonymOnlyHit) {
        borderStyle = 'border-left: 4px solid #f59e0b;';
        synonymBadge = `<div class="absolute top-3 right-12 bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 text-[10px] px-1.5 py-0.5 rounded-md font-bold flex items-center gap-1 z-10 border border-amber-500/10 pointer-events-none"><i class="fa-solid fa-lightbulb text-[9px]"></i>関連</div>`;
    }
    
    card.className = "diary-card relative bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 p-3.5 rounded-2xl shadow-sm hover:shadow-md group transition-colors";
    if (borderStyle) card.style = borderStyle;
    card.setAttribute('data-id', item.id);
    
    const isFixed = item.fixed || false;
    const isCheckedAttr = globalSelectedIds.has(item.id) ? 'checked' : '';
    
    let sortButtonsHTML = `
        <button onclick="toggleFixed('${item.id}')" class="w-7 h-7 flex items-center justify-center ${isFixed ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-300 dark:text-slate-500 hover:text-slate-500 dark:hover:text-slate-300'} rounded-lg transition-colors" title="固定/解除"><i class="fa-solid fa-thumbtack ${isFixed ? '' : '-rotate-45'} text-xs"></i></button>
        <button onclick="moveItem('${item.id}', -1)" class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-lg transition-colors" title="上に移動" ${isSearching ? 'style="display:none;"' : ''}><i class="fa-solid fa-arrow-up text-xs"></i></button>
        <button onclick="moveItem('${item.id}', 1)" class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-lg transition-colors" title="下に移動" ${isSearching ? 'style="display:none;"' : ''}><i class="fa-solid fa-arrow-down text-xs"></i></button>
        <div class="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" ${isSearching ? 'style="display:none;"' : ''}></div>`;
        
    card.innerHTML = `
        ${synonymBadge}
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-700 pb-2 mb-2.5 gap-2">
            <div class="flex items-center justify-between sm:justify-start sm:space-x-2.5 min-w-0 w-full sm:w-auto">
                <div class="flex items-center space-x-2 min-w-0">
                    <span class="text-sm font-bold text-slate-700 dark:text-slate-200 tracking-tight whitespace-nowrap">${formattedDate}${updateInfo}</span>
                    <div class="flex-shrink-0">${weatherIconHtml}</div>
                </div>
                <div class="export-checkbox-container no-print sm:hidden flex items-center">
                    <input type="checkbox" class="export-checkbox entry-checkbox w-4 h-4 rounded text-indigo-600 dark:border-slate-600" value="${item.id}" ${isCheckedAttr} onchange="syncCheckboxes(this)">
                </div>
            </div>
            <div class="flex items-center justify-end space-x-3 w-full sm:w-auto">
                <div class="sort-buttons-container flex items-center space-x-0.5 sm:opacity-0 group-hover:opacity-100 transition-opacity duration-200 ml-auto sm:ml-0">
                    ${sortButtonsHTML}
                    <button onclick="openModal('${item.id}')" class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-lg transition-colors" title="編集"><i class="fa-solid fa-pen text-xs"></i></button>
                    <button onclick="deleteDiaryItem('${item.id}')" class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-slate-700 rounded-lg transition-colors" title="削除"><i class="fa-solid fa-trash-can text-xs"></i></button>
                </div>
                <div class="export-checkbox-container hidden sm:flex items-center no-print border-l border-slate-200 dark:border-slate-700 pl-3 h-5">
                    <input type="checkbox" class="export-checkbox entry-checkbox w-4 h-4 rounded text-indigo-600 dark:border-slate-600" value="${item.id}" ${isCheckedAttr} onchange="syncCheckboxes(this)">
                </div>
            </div>
        </div>
        <div class="prose prose-slate prose-sm max-w-none text-slate-600 dark:text-slate-300 font-normal leading-relaxed break-words">${DOMPurify.sanitize(marked.parse(item.content || ''))}</div>
        ${mediaHtml}
        ${tagsHtml}
    `;
    return card;
}

function checkIsSearching() {
    return (
        document.getElementById('search-input').value.trim() !== '' || 
        document.getElementById('tag-filter').value !== '' || 
        document.getElementById('modal-sort-select').value !== 'custom' || 
        document.querySelector('input[name="filter-weather"]:checked')?.value !== '' || 
        currentPeriodFilter !== 'ALL' || 
        !document.getElementById('active-search-indicator').classList.contains('hidden')
    );
}

async function saveSearchOptions() {
    const includeDateCb = document.getElementById('custom-search-include-date'); 
    if(includeDateCb) await appSettings.set('smart_diary_include_date', String(includeDateCb.checked));
    
    const synonymInput = document.getElementById('custom-synonym-input'); 
    if(synonymInput) await appSettings.set('smart_diary_synonyms', synonymInput.value);
    
    saveSettingsToFolder();
    filterDiaryItems();
}

function filterDiaryItems(resetLimit = true) {
    if (resetLimit) currentDisplayLimit = 30;
    
    try {
        const quickInput = document.getElementById('search-input').value.trim(); 
        const quickQueries = quickInput ? quickInput.split(/[\s ,]+/).map(s => fuzzyString(s)).filter(s => s) : [];
        const tagFilter = document.getElementById('tag-filter').value; 
        const weatherFilter = document.querySelector('input[name="filter-weather"]:checked')?.value || ""; 
        const sortOrder = document.getElementById('modal-sort-select').value;
        const andInput = document.getElementById('and-input').value; 
        const andTerms = andInput ? andInput.split(/[\s ,]+/).map(s => fuzzyString(s)).filter(s => s) : [];
        const orInput = document.getElementById('or-input').value; 
        const orTerms = orInput ? orInput.split(/[\s ,]+/).map(s => fuzzyString(s)).filter(s => s) : [];
        const notInput = document.getElementById('not-input').value; 
        const notTerms = notInput ? notInput.split(/[\s ,]+/).map(s => fuzzyString(s)).filter(s => s) : [];
        const dateStart = document.getElementById('search-date-start').value; 
        const dateEnd = document.getElementById('search-date-end').value; 
        const reqImg = document.getElementById('search-media-img').checked; 
        const reqVid = document.getElementById('search-media-vid').checked;
        const advWeathers = Array.from(document.querySelectorAll('.search-weather-cb:checked')).map(cb => cb.value);
        const includeDateCb = document.getElementById('custom-search-include-date'); 
        const includeDate = includeDateCb ? includeDateCb.checked : true;
        const synonymInput = document.getElementById('custom-synonym-input'); 
        const synonymText = synonymInput ? synonymInput.value : "";
        const synonymGroups = synonymText.split('\n')
                                .map(line => line.split(',').map(item => fuzzyString(item.trim())).filter(item => item))
                                .filter(group => group.length > 0);

        const expandKeywords = (kw) => { 
            const fuzzyKw = fuzzyString(kw); 
            let expanded = [fuzzyKw]; 
            for (const group of synonymGroups) { 
                if (group.includes(fuzzyKw)) {
                    expanded = Array.from(new Set(expanded.concat(group)));
                } 
            } 
            return expanded; 
        };

        currentFilteredItems = diaryItems.filter(item => {
            const contentStr = fuzzyString(item.content); 
            const dateStr = fuzzyString(item.date); 
            const tagsStr = fuzzyString((item.tags || []).join(' ')); 
            const weatherLabel = (item.weather && weatherConfig[item.weather]) ? fuzzyString(weatherConfig[item.weather].label) : '';
            
            const mFiles = item.mediaFiles || (item.media ? [item.media] : []);
            const hasImage = mFiles.some(m => m.type?.startsWith('image/'));
            const hasVideo = mFiles.some(m => m.type?.startsWith('video/'));

            const checkMatch = (kw) => {
                if (kw === '画像' || kw === 'がぞう') return { match: hasImage, synonymOnly: false };
                if (kw === '動画' || kw === 'どうが') return { match: hasVideo, synonymOnly: false };
                
                const fuzzyK = fuzzyString(kw); 
                if (!fuzzyK) return { match: false, synonymOnly: false };
                
                const isDateFormat = /^\d{4}-\d{2}-\d{2}$/.test(fuzzyK); 
                const matchOriginalDate = (includeDate || isDateFormat) ? dateStr.includes(fuzzyK) : false; 
                const matchOriginal = contentStr.includes(fuzzyK) || matchOriginalDate || tagsStr.includes(fuzzyK) || weatherLabel.includes(fuzzyK);
                
                if (matchOriginal) return { match: true, synonymOnly: false };
                
                const synonyms = expandKeywords(kw); 
                let matchSynonym = false;
                for (const syn of synonyms) { 
                    if (syn === fuzzyK) continue; 
                    const matchSynDate = includeDate ? dateStr.includes(syn) : false; 
                    if (contentStr.includes(syn) || matchSynDate || tagsStr.includes(syn) || weatherLabel.includes(syn)) { 
                        matchSynonym = true; 
                        break; 
                    } 
                }
                if (matchSynonym) return { match: true, synonymOnly: true };
                return { match: false, synonymOnly: false };
            };

            const evaluateTerms = (terms, isOr = false) => {
                if (terms.length === 0) return { match: true, synonymOnly: false };
                let anySynonymOnly = false;
                let finalMatch = !isOr;

                for (const t of terms) {
                    const res = checkMatch(t);
                    if (isOr) {
                        if (res.match) {
                            finalMatch = true;
                            if (res.synonymOnly) anySynonymOnly = true;
                        }
                    } else {
                        if (!res.match) {
                            finalMatch = false;
                            break;
                        }
                        if (res.synonymOnly) anySynonymOnly = true;
                    }
                }
                return { match: finalMatch, synonymOnly: anySynonymOnly };
            };

            const quickRes = evaluateTerms(quickQueries);
            const andRes = evaluateTerms(andTerms);
            const orRes = orTerms.length > 0 ? evaluateTerms(orTerms, true) : { match: true, synonymOnly: false };
            
            let matchesNot = true; 
            if (notTerms.length > 0) {
                matchesNot = notTerms.every(t => !checkMatch(t).match);
            }
            
            const matchesTag = tagFilter === "" || (item.tags || []).includes(tagFilter); 
            const matchesMainWeather = weatherFilter === "" || item.weather === weatherFilter; 
            const matchesAdvWeather = advWeathers.length === 0 || advWeathers.includes(item.weather || "");
            
            let matchesDate = true; 
            const itemTime = getSafeDate(item.date).getTime();
            if (dateStart) { const ds = getSafeDate(dateStart).getTime(); if (itemTime < ds) matchesDate = false; } 
            if (dateEnd) { const de = getSafeDate(dateEnd).getTime(); if (itemTime > de) matchesDate = false; }
            
            let matchesMedia = true; 
            if (reqImg && !hasImage) matchesMedia = false; 
            if (reqVid && !hasVideo) matchesMedia = false;
            
            let matchesPeriod = true;
            if (currentPeriodFilter !== 'ALL') {
                const todayMidnight = new Date().setHours(0,0,0,0); 
                const itemMidnight = getSafeDate(item.date).setHours(0,0,0,0); 
                const diffDays = Math.round((todayMidnight - itemMidnight) / 86400000);
                
                if (currentPeriodFilter === 'DAILY') {
                    matchesPeriod = diffDays >= 0 && diffDays <= 1;
                } else if (currentPeriodFilter === 'WEEKLY') {
                    matchesPeriod = diffDays >= 0 && diffDays <= 7;
                } else if (currentPeriodFilter === 'MONTHLY') {
                    matchesPeriod = diffDays >= 0 && diffDays <= 31;
                }
            }
            
            const isMatched = quickRes.match && andRes.match && orRes.match && matchesNot && matchesTag && matchesMainWeather && matchesAdvWeather && matchesDate && matchesMedia && matchesPeriod;
            item.__isSynonymOnlyHit = isMatched && ((quickQueries.length > 0 && quickRes.synonymOnly) || (andTerms.length > 0 && andRes.synonymOnly) || (orTerms.length > 0 && orRes.synonymOnly));
            return isMatched;
        });
        
        const indexMap = new Map(diaryItems.map((item, index) => [item, index]));
        
        currentFilteredItems.sort((a, b) => {
            const fixedA = a.fixed || false;
            const fixedB = b.fixed || false; 
            if (fixedA && !fixedB) return -1;
            if (!fixedA && fixedB) return 1;
            
            const timeA = getSafeDate(a.date).getTime();
            const timeB = getSafeDate(b.date).getTime(); 
            const upA = a.updatedAt ? new Date(a.updatedAt).getTime() : timeA;
            const upB = b.updatedAt ? new Date(b.updatedAt).getTime() : timeB;
            
            if (sortOrder === 'date-desc') return (timeB - timeA) || (indexMap.get(a) - indexMap.get(b)); 
            if (sortOrder === 'date-asc') return (timeA - timeB) || (indexMap.get(a) - indexMap.get(b)); 
            if (sortOrder === 'updated-desc') return (upB - upA) || (indexMap.get(a) - indexMap.get(b)); 
            return indexMap.get(a) - indexMap.get(b);
        });
        
        const container = document.getElementById('diary-container'); 
        container.innerHTML = ''; 
        const isSearching = checkIsSearching();
        
        currentFilteredItems.slice(0, currentDisplayLimit).forEach(item => { 
            container.appendChild(createCardElement(item, isSearching)); 
        });
        
        const countDisplay = document.getElementById('search-count-display');
        if (isSearching || currentPeriodFilter !== 'ALL') { 
            countDisplay.innerHTML = `<i class="fa-solid fa-chart-simple mr-1"></i>${currentFilteredItems.length} 件の日記がヒット`; 
            countDisplay.classList.remove('hidden'); 
        } else { 
            countDisplay.classList.add('hidden'); 
        }
        
        updateEmptyState(); 
        if (viewMode === 'calendar') renderCalendar(); 
        if (viewMode === 'album') renderAlbum();
        setTimeout(applyMediaUrls, 10);
    } catch(e) {
        console.error(e);
    }         
}

function renderDiaryItems() { 
    currentDisplayLimit = 30;
    filterDiaryItems(false); 
}

function updateTagFilterOptions() {
    const tagFilter = document.getElementById('tag-filter');
    if (!tagFilter) return;
    const currentVal = tagFilter.value;
    const tags = new Set();
    diaryItems.forEach(item => {
        if (item.tags) {
            const tagList = Array.isArray(item.tags) ? item.tags : item.tags.split(',').map(t => t.trim());
            tagList.forEach(t => {
                if (t) tags.add(t);
            });
        }
    });
    let optionsHtml = '<option value="">全タグ</option>';
    Array.from(tags).sort().forEach(tag => {
        optionsHtml += `<option value="${tag}">${tag}</option>`;
    });
    tagFilter.innerHTML = optionsHtml;
    if (tags.has(currentVal)) {
        tagFilter.value = currentVal;
    }
}

function setPeriodFilter(period) { 
    currentPeriodFilter = period; 
    document.querySelectorAll('.period-tab').forEach(tab => tab.classList.remove('active')); 
    document.getElementById(`tab-${period}`).classList.add('active'); 
    filterDiaryItems(); 
}

function renderCalendar() {
    try {
        const year = currentCalDate.getFullYear();
        const month = currentCalDate.getMonth(); 
        document.getElementById('calendar-month-label').textContent = `${year}年 ${month + 1}月`;
        
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate(); 
        const grid = document.getElementById('calendar-grid');
        grid.innerHTML = '';
        
        const diaryMap = {}; 
        diaryItems.forEach(item => { 
            const d = getSafeDate(item.date); 
            if (!isNaN(d) && d.getFullYear() === year && d.getMonth() === month) { 
                const day = d.getDate();
                if (!diaryMap[day]) diaryMap[day] = [];
                diaryMap[day].push(item); 
            } 
        });
        
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
        
        for (let i = 0; i < firstDay; i++) {
            grid.appendChild(document.createElement('div'));
        }
        
        for (let i = 1; i <= daysInMonth; i++) {
            const cell = document.createElement('div'); 
            let cellClasses = "aspect-square flex flex-col items-center justify-start pt-1 sm:pt-2 pb-1 rounded-xl transition-all relative border cursor-pointer ";
            
            if (diaryMap[i]) {
                let totalChars = diaryMap[i].reduce((sum, item) => sum + (item.content ? item.content.length : 0), 0);
                if (totalChars >= 500) {
                    cellClasses += "bg-indigo-300 dark:bg-indigo-700 border-indigo-400 text-slate-900 dark:text-white hover:scale-105 active:scale-95";
                } else if (totalChars >= 200) {
                    cellClasses += "bg-indigo-200 dark:bg-indigo-800 border-indigo-300 text-slate-900 dark:text-slate-100 hover:scale-105 active:scale-95";
                } else {
                    cellClasses += "bg-indigo-50 dark:bg-indigo-900/40 border-indigo-100 hover:scale-105 active:scale-95";
                }
            } else { 
                cellClasses += "bg-slate-50/50 dark:bg-slate-800/50 border-transparent text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"; 
            }
            
            if (isCurrentMonth && today.getDate() === i) {
                cellClasses += " ring-2 ring-indigo-400 dark:ring-indigo-500";
            }

            let tagCountForDay = 0;
            if (activeCalendarTag && diaryMap[i]) {
                tagCountForDay = diaryMap[i].filter(item => item.tags && item.tags.includes(activeCalendarTag)).length;
            }
            if (tagCountForDay > 0) {
                cellClasses += " !bg-amber-100 dark:!bg-amber-900/40 !border-amber-400 dark:!border-amber-500 !ring-2 !ring-amber-400 transform scale-105 z-10";
            }

            cell.className = cellClasses;
            
            const dayNum = document.createElement('span'); 
            dayNum.className = `text-xs sm:text-sm font-bold ${diaryMap[i] ? (diaryMap[i].reduce((s,it)=>s+(it.content?it.content.length:0),0) >= 500 ? '' : 'text-indigo-600 dark:text-indigo-300') : ''}`; 
            if (tagCountForDay > 0) dayNum.classList.add('!text-amber-700', 'dark:!text-amber-300');
            dayNum.textContent = i; 
            cell.appendChild(dayNum);
            
            if (diaryMap[i]) { 
                const indicatorContainer = document.createElement('div'); 
                indicatorContainer.className = "flex gap-1 mt-0.5 sm:mt-1 items-center justify-center"; 
                diaryMap[i].slice(0, 3).forEach((item) => { 
                    if (item.weather && weatherConfig[item.weather]) {
                        const w = weatherConfig[item.weather];
                        const icon = document.createElement('i');
                        icon.className = `fa-solid ${w.icon} ${w.color} text-[8px] sm:text-[10px] drop-shadow-sm`;
                        indicatorContainer.appendChild(icon);
                    } else {
                        const dot = document.createElement('div'); 
                        dot.className = "w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-indigo-300 dark:bg-indigo-500"; 
                        indicatorContainer.appendChild(dot); 
                    }
                }); 
                cell.appendChild(indicatorContainer); 
            }

            if (tagCountForDay > 0) {
                const tagBadge = document.createElement('div');
                tagBadge.className = "absolute -top-1.5 -right-1.5 bg-gradient-to-tr from-amber-500 to-orange-500 text-white text-[10px] font-bold w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center rounded-full shadow-md border border-white dark:border-slate-800 pointer-events-none";
                tagBadge.textContent = tagCountForDay;
                cell.appendChild(tagBadge);
            }

            if (diaryMap[i]) {
                const triggerPopup = (e) => {
                    isLongPressTriggered = false;
                    calendarPopupTimer = setTimeout(() => {
                        isLongPressTriggered = true;
                        showCalendarPopup(diaryMap[i], cell);
                        if (navigator.vibrate) navigator.vibrate(50);
                    }, 500);
                };
                const cancelPopup = () => {
                    clearTimeout(calendarPopupTimer);
                    hideCalendarPopup();
                };

                cell.addEventListener('mouseenter', triggerPopup);
                cell.addEventListener('mouseleave', cancelPopup);
                cell.addEventListener('touchstart', triggerPopup, {passive: true});
                cell.addEventListener('touchend', cancelPopup);
                cell.addEventListener('touchmove', cancelPopup);
                cell.addEventListener('touchcancel', cancelPopup);

                cell.onclick = (e) => { 
                    if (isLongPressTriggered) { e.preventDefault(); isLongPressTriggered = false; return; }
                    document.getElementById('search-input').value = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`; 
                    setViewMode('list');
                    setPeriodFilter('ALL'); 
                };
            } else {
                cell.onclick = () => { 
                    openModal();
                    const now = new Date();
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0'); 
                    document.getElementById('entry-date').value = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}T${hours}:${minutes}`; 
                };
            }
            grid.appendChild(cell);
        }
        renderCalendarStats(year, month);
    } catch(e) {}
}

function renderCalendarStats(year, month) {
    const statsContainer = document.getElementById('calendar-stats'); 
    if (!statsContainer) return;
    
    let monthlyCount = 0;
    let monthlyChars = 0;
    const tagCounts = {};
    
    diaryItems.forEach(item => { 
        const d = getSafeDate(item.date); 
        if (!isNaN(d) && d.getFullYear() === year && d.getMonth() === month) { 
            monthlyCount++;
            monthlyChars += (item.content ? item.content.length : 0); 
            if (item.tags) {
                item.tags.forEach(t => {
                    tagCounts[t] = (tagCounts[t] || 0) + 1;
                });
            }
        } 
    });
    
    const topTags = Object.entries(tagCounts).sort((a,b) => b[1] - a[1]).slice(0, 5); 
    let tagsHtml = topTags.map(([tag, count]) => {
        const isActive = activeCalendarTag === tag;
        const baseClass = isActive 
            ? "bg-amber-100 dark:bg-amber-900/60 border-amber-400 dark:border-amber-500 text-amber-700 dark:text-amber-300 ring-2 ring-amber-400/50 shadow-sm" 
            : "bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 cursor-pointer";
        return `<button type="button" onclick="toggleCalendarTagHighlight('${tag}')" class="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold border transition-all ${baseClass}">#${tag} <span class="ml-1 text-[9px] opacity-70">(${count})</span></button>`;
    }).join(' ');
    
    statsContainer.innerHTML = `
        <div class="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase">
            <span><i class="fa-solid fa-chart-pie mr-1"></i> 今月の概況</span>
            <span>作成: ${monthlyCount}件 / 文字数: ${monthlyChars}文字</span>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap mt-1">
            <span class="text-[10px] text-slate-400">頻出タグ:</span>
            ${tagsHtml || '<span class="text-slate-400 italic text-[10px]">なし</span>'}
        </div>`;
}

function changeMonth(diff) {
    currentCalDate = new Date(currentCalDate.getFullYear(), currentCalDate.getMonth() + diff, 1);
    renderCalendar();
}

function renderAlbum() {
    try {
        const container = document.getElementById('album-view'); 
        container.innerHTML = ''; 
        
        const visibleItems = currentFilteredItems.filter(item => (item.mediaFiles && item.mediaFiles.length > 0) || item.media);
        const emptyState = document.getElementById('empty-state');
        
        if (visibleItems.length === 0) { 
            container.classList.add('hidden');
            emptyState.classList.remove('hidden');
            emptyState.classList.add('flex');
            return; 
        }
        
        emptyState.classList.add('hidden');
        emptyState.classList.remove('flex');
        container.classList.remove('hidden');
        container.classList.add('grid');
        
        visibleItems.forEach(item => {
            const images = getAllImagesFromItem(item);
            const wrapper = document.createElement('div');
            wrapper.className = "group relative aspect-square rounded-2xl overflow-hidden bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/70 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col cursor-pointer";
            
            wrapper.onclick = (e) => {
                if (e.target.closest('.export-checkbox') || e.target.closest('.gallery-badge')) return;
                openLightboxFromCard(item.id, 0); 
            };

            let mediaHtml = '';
            if (images.length === 1) {
                mediaHtml = `<div class="relative w-full h-full flex items-center justify-center p-3 overflow-hidden">`;
                if (images[2]) mediaHtml += `<img src="${images[2].src}" ${images[2].pendingAttr} class="absolute w-[85%] h-[85%] object-contain bg-slate-100 dark:bg-slate-900 rounded-xl shadow-sm transform rotate-4 translate-x-2 translate-y-1 opacity-40 blur-[0.5px]" />`;
                if (images[1]) mediaHtml += `<img src="${images[1].src}" ${images[1].pendingAttr} class="absolute w-[88%] h-[88%] object-contain bg-slate-100 dark:bg-slate-900 rounded-xl shadow-md transform -rotate-3 -translate-x-1 -translate-y-1 opacity-70" />`;
                mediaHtml += `<img src="${images[0].src}" ${images[0].pendingAttr} class="relative w-[92%] h-[92%] object-contain bg-slate-100 dark:bg-slate-900 rounded-xl shadow-md transition-transform duration-300 group-hover:scale-[1.02] z-10" />`;
                mediaHtml += `</div>`;
            } else {
                const gridCount = Math.min(images.length, 4);
                const gridCols = gridCount === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2';
                
                mediaHtml = `<div class="w-full h-full grid ${gridCols} gap-1 p-1">`;
                for (let i = 0; i < gridCount; i++) {
                    if (i === 3 && images.length > 4) {
                        mediaHtml += `
                            <div class="relative w-full h-full rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
                                <img src="${images[i].src}" ${images[i].pendingAttr} class="w-full h-full object-contain" />
                                <div class="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs font-bold">+${images.length - 3}</div>
                            </div>`;
                    } else {
                        mediaHtml += `
                            <div class="relative w-full h-full rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
                                <img src="${images[i].src}" ${images[i].pendingAttr} class="w-full h-full object-contain" />
                            </div>`;
                    }
                }
                mediaHtml += `</div>`;
            }

            let badgeHtml = '';
            if (images.length > 1) {
                badgeHtml = `
                    <div onclick="openImageGallery('${item.id}', event)" class="gallery-badge absolute top-2.5 left-2.5 z-30 bg-slate-900/70 hover:bg-slate-900/90 cursor-pointer backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-md flex items-center gap-1.5 transition-colors transform hover:scale-105 active:scale-95">
                        <i class="fa-solid fa-images text-indigo-300"></i> ${images.length}枚を展開
                    </div>`;
            }

            const formattedDate = new Date(item.date).toLocaleString('ja-JP', { month: 'short', day: 'numeric' });
            const isCheckedAttr = globalSelectedIds.has(item.id) ? 'checked' : '';
            
            wrapper.innerHTML = `
                ${badgeHtml}
                <div class="absolute top-2.5 right-2.5 z-30 opacity-90 group-hover:opacity-100 transition-opacity">
                    <input type="checkbox" value="${item.id}" class="entry-checkbox export-checkbox shadow-md" ${isCheckedAttr} onchange="syncCheckboxes(this)" />
                </div>
                <div class="flex-1 min-h-0 relative">
                    ${mediaHtml}
                    <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2 sm:p-3 z-20 pointer-events-none rounded-t-2xl">
                        <div class="flex justify-end w-full">
                            <button onclick="event.stopPropagation(); jumpToDiary('${item.id}')" class="pointer-events-auto shrink-0 bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/20 text-white rounded-lg px-2.5 py-1.5 text-[10px] sm:text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                                <i class="fa-solid fa-arrow-right"></i> 日記へ
                            </button>
                        </div>
                    </div>
                </div>
                <div class="p-2.5 bg-slate-50/90 dark:bg-slate-800/90 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between text-left shrink-0 z-10 backdrop-blur-sm">
                    <span class="text-xs font-bold text-slate-700 dark:text-slate-300 truncate max-w-[70%]">${item.content?.replace(/<[^>]*>?/gm, '').replace(/[#*`\n]/g, '').substring(0, 15) || '画像記録'}</span>
                    <span class="text-[10px] font-bold text-indigo-500 dark:text-indigo-400">${formattedDate}</span>
                </div>
            `;
            container.appendChild(wrapper);
        });
        
        setTimeout(applyMediaUrls, 10);
        
    } catch(e) {}
}

function scrollGallery(direction) {
    const container = document.getElementById('gallery-scroll-container');
    if (container) {
        const firstItem = container.firstElementChild;
        const scrollAmount = firstItem ? firstItem.offsetWidth + 16 : (window.innerWidth < 640 ? 288 + 16 : 384 + 24);
        container.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
    }
}

function openImageGallery(itemId, event) {
    if(event) event.stopPropagation();
    const item = diaryItems.find(i => i.id === itemId);
    if (!item) return;
    const images = getAllImagesFromItem(item);

    let galleryModal = document.getElementById('gallery-expanded-modal');
    if (!galleryModal) {
        galleryModal = document.createElement('div');
        galleryModal.id = 'gallery-expanded-modal';
        galleryModal.className = 'fixed inset-0 bg-black/95 z-[90] hidden opacity-0 transition-opacity duration-300 flex flex-col no-print';
        document.body.appendChild(galleryModal);
    }
    
    let imgsHtml = '';
    images.forEach((img, index) => {
        let videoOverlay = img.isVideo ? `<div class="absolute top-4 left-4 bg-black/50 backdrop-blur-sm text-white rounded-lg px-2 py-1 text-xs"><i class="fa-solid fa-video"></i></div>` : '';
        
        imgsHtml += `
            <div class="relative flex-shrink-0 w-72 sm:w-96 aspect-square bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10 group snap-center">
                <img src="${img.src}" ${img.pendingAttr} class="w-full h-full object-contain cursor-zoom-in" onclick="openLightboxFromCard('${item.id}', ${index})" />
                ${videoOverlay}
                <div class="absolute top-4 right-4 bg-black/40 backdrop-blur-sm p-2 rounded-xl flex items-center gap-2">
                    <input type="checkbox" value="${img.id}" class="image-checkbox export-checkbox" ${globalSelectedImageIds.has(img.id) ? 'checked' : ''} onchange="syncImageCheckbox(this)" style="position:static;" />
                    <span class="text-white text-xs font-bold select-none">出力対象</span>
                </div>
            </div>`;
    });

    galleryModal.innerHTML = `
        <div class="w-full max-w-4xl mx-auto flex justify-between items-center py-2 shrink-0">
            <div class="text-white text-sm font-bold flex items-center gap-2">
                <i class="fa-solid fa-images text-indigo-400"></i> ${item.date.split('T')[0]} の画像 (${images.length}枚)
            </div>
            <button onclick="closeImageGallery()" class="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"><i class="fa-solid fa-xmark text-lg"></i></button>
        </div>
        <div class="relative flex-1 w-full flex items-center justify-center min-h-0 py-2">
            <button onclick="scrollGallery(-1)" class="absolute left-2 sm:left-4 z-20 w-10 h-10 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/70 backdrop-blur-sm transition-colors shadow-lg border border-white/10"><i class="fa-solid fa-chevron-left"></i></button>
            
            <div id="gallery-scroll-container" class="w-full h-full flex items-center justify-start gap-4 sm:gap-6 overflow-x-auto px-14 sm:px-20 no-scrollbar snap-x snap-mandatory ${images.length < 3 ? 'sm:justify-center' : ''}" style="overscroll-behavior-x: none;">
                ${imgsHtml}
            </div>
            
            <button onclick="scrollGallery(1)" class="absolute right-2 sm:right-4 z-20 w-10 h-10 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/70 backdrop-blur-sm transition-colors shadow-lg border border-white/10"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <div class="w-full max-w-sm mx-auto pb-4 shrink-0 text-center">
            <p class="text-white/40 text-[11px] mb-2"><i class="fa-solid fa-arrows-left-right"></i> 横スクロール・ホイール操作で個別出力指定</p>
            <button onclick="closeImageGallery(); toggleSettings();" class="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl shadow-lg transition-all">選択した画像を出力画面で処理する</button>
        </div>
    `;

    galleryModal.classList.remove('hidden');
    setTimeout(() => {
        galleryModal.classList.add('opacity-100');
        const container = document.getElementById('gallery-scroll-container');
        if (container) {
            container.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0 || e.deltaX !== 0) {
                    e.preventDefault();
                    const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
                    container.scrollBy({ left: delta > 0 ? 300 : -300, behavior: 'auto' });
                }
            }, { passive: false });
        }
        applyMediaUrls();
    }, 10);
}

function closeImageGallery() {
    const galleryModal = document.getElementById('gallery-expanded-modal');
    if (galleryModal) {
        galleryModal.classList.remove('opacity-100');
        setTimeout(() => {
            galleryModal.classList.add('hidden');
            if (viewMode === 'album') renderAlbum();
        }, 300);
    }
}

function syncImageCheckbox(source) {
    if (source.checked) {
        globalSelectedImageIds.add(source.value);
    } else {
        globalSelectedImageIds.delete(source.value);
    }
}

function openSearchModal() {
    const modal = document.getElementById('search-modal');
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.add('opacity-100');
        modal.querySelector('.transform').classList.remove('translate-y-full', 'sm:scale-95');
    }, 10);
}

function closeSearchModal() {
    const modal = document.getElementById('search-modal');
    if (!modal) return;
    modal.classList.remove('opacity-100');
    const transformEl = modal.querySelector('.transform');
    if (transformEl) {
        transformEl.classList.add('translate-y-full');
        if (window.innerWidth >= 640) transformEl.classList.add('sm:scale-95');
    }
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function handleAdvancedSearchBtnClick(event) { 
    if (isLongPress) {
        event.preventDefault();
        isLongPress = false;
        return;
    } 
    openSearchModal(); 
}

function applyAdvancedSearch() {
    closeSearchModal();
    filterDiaryItems();
    
    const hasAdvanced = 
        document.getElementById('and-input').value.trim() !== '' ||
        document.getElementById('or-input').value.trim() !== '' ||
        document.getElementById('not-input').value.trim() !== '' ||
        document.getElementById('search-date-start').value !== '' ||
        document.getElementById('search-date-end').value !== '' ||
        document.getElementById('search-media-img').checked ||
        document.getElementById('search-media-vid').checked ||
        document.querySelectorAll('.search-weather-cb:checked').length > 0 ||
        document.getElementById('modal-sort-select').value !== 'custom';
        
    const badge1 = document.getElementById('active-search-indicator');
    const badge2 = document.getElementById('nav-active-search-indicator');
    
    if (hasAdvanced) {
        if (badge1) badge1.classList.remove('hidden');
        if (badge2) badge2.classList.remove('hidden');
    } else {
        if (badge1) badge1.classList.add('hidden');
        if (badge2) badge2.classList.add('hidden');
    }
}

function clearAdvancedSearch() { 
    try { 
        const textInputs = ['and-input', 'or-input', 'not-input', 'search-date-start', 'search-date-end'];
        textInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        const checkboxes = ['search-media-img', 'search-media-vid'];
        checkboxes.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = false;
        });
        
        document.querySelectorAll('.search-weather-cb').forEach(cb => cb.checked = false);
        
        const sortModal = document.getElementById('modal-sort-select');
        const sortMain = document.getElementById('main-sort-select');
        if (sortModal) sortModal.value = 'custom';
        if (sortMain) sortMain.value = 'custom';

        applyAdvancedSearch(); 
    } catch(e) {
        console.error("clearAdvancedSearch Error:", e);
    } 
}

function clearAllSearchSettings() { 
    try { 
        document.getElementById('search-input').value = '';
        document.getElementById('tag-filter').value = ''; 
        const defaultWeather = document.querySelector('input[name="filter-weather"][value=""]');
        if(defaultWeather) defaultWeather.checked = true; 
        setPeriodFilter('ALL');
        clearAdvancedSearch(); 
    } catch(e) {} 
}

function syncCheckboxes(source) { 
    const isChecked = source.checked;
    const val = source.value; 
    if (isChecked) {
        globalSelectedIds.add(val);
    } else {
        globalSelectedIds.delete(val);
    }
    document.querySelectorAll(`.entry-checkbox[value="${val}"]`).forEach(cb => {
        if (cb !== source) cb.checked = isChecked;
    }); 
}

function clearAllSelections() { 
    globalSelectedIds.clear();
    globalSelectedImageIds.clear(); 
    document.querySelectorAll('.entry-checkbox, .image-checkbox').forEach(cb => { cb.checked = false; }); 
    if (viewMode === 'album') renderAlbum(); 
}

function jumpToDiary(id) {
    setViewMode('list');
    const targetIndex = currentFilteredItems.findIndex(i => i.id === id);
    
    if (targetIndex !== -1 && targetIndex >= currentDisplayLimit) { 
        currentDisplayLimit = targetIndex + 5; 
        const container = document.getElementById('diary-container'); 
        container.innerHTML = ''; 
        const isSearching = checkIsSearching(); 
        currentFilteredItems.slice(0, currentDisplayLimit).forEach(item => { 
            container.appendChild(createCardElement(item, isSearching)); 
        }); 
        setTimeout(applyMediaUrls, 10);
    }
    
    setTimeout(() => {
        const card = document.querySelector(`.diary-card[data-id="${id}"]`);
        if (card) {
            const offsetPosition = card.getBoundingClientRect().top + window.scrollY - 64;
            window.scrollTo({ top: offsetPosition, behavior: "smooth" });
            card.classList.add('ring-2', 'ring-indigo-500', 'shadow-xl', 'scale-[1.01]', 'z-30');
            setTimeout(() => card.classList.remove('ring-2', 'ring-indigo-500', 'shadow-xl', 'scale-[1.01]', 'z-30'), 1500);
        }
    }, 50);
}

function openModal(id = null) {
    const modal = document.getElementById('editor-modal');
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.add('opacity-100');
        modal.querySelector('.transform').classList.remove('translate-y-full', 'sm:scale-95');
    }, 10);
    
    document.getElementById('entry-id').value = '';
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0'); 
    
    document.getElementById('entry-date').value = `${year}-${month}-${date}T${hours}:${minutes}`;
    
    const contentTextarea = document.getElementById('entry-content');
    contentTextarea.value = '';
    contentTextarea.style.height = 'auto';
    document.getElementById('entry-tags').value = '';
    document.querySelectorAll('input[name="weather"]').forEach(r => r.checked = false); 
    
    currentMediaFiles = [];
    document.getElementById('media-preview-container').innerHTML = '';
    document.getElementById('media-preview-container').classList.add('hidden');
    renderTagSuggestions();
    
    if (id) {
        document.getElementById('modal-title').textContent = "日記を編集";
        const item = diaryItems.find(i => i.id === id);
        if (item) {
            document.getElementById('entry-id').value = item.id;
            let entryDate = item.date || '';
            if (entryDate && !entryDate.includes('T')) { entryDate = `${entryDate}T00:00`; }
            document.getElementById('entry-date').value = entryDate;
            
            contentTextarea.value = item.content || '';
            autoResizeTextarea(contentTextarea);
            document.getElementById('entry-tags').value = (item.tags || []).join(', ');
            
            if (item.weather) {
                const r = document.querySelector(`input[name="weather"][value="${item.weather}"]`);
                if(r) r.checked = true;
            }
            
            let loadedMedia = item.mediaFiles || (item.media ? [item.media] : []);
            if (loadedMedia.length > 0) {
                currentMediaFiles = [...loadedMedia];
                renderMediaPreview();
            }
        }
    } else {
        document.getElementById('modal-title').textContent = "日記を書く";
    }
}

function renderTagSuggestions() { 
    const container = document.getElementById('tag-suggestions');
    if(!container) return;
    
    const counts = {};
    diaryItems.forEach(i => (i.tags || []).forEach(t => counts[t] = (counts[t] || 0) + 1));
    const topTags = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 15); 
    
    if (topTags.length === 0) {
        container.innerHTML = '<span class="text-[10px] text-slate-400 italic">タグの履歴がありません</span>';
        return;
    } 
    
    container.innerHTML = topTags.map(([tag]) => `<button type="button" onclick="addTagFromSuggestion('${tag}')" class="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-[10px] text-slate-600 dark:text-slate-300 hover:border-indigo-400 transition-colors">#${tag}</button>`).join(''); 
}

function addTagFromSuggestion(tag) {
    const input = document.getElementById('entry-tags');
    let tags = input.value.split(',').map(t=>t.trim()).filter(Boolean);
    if(!tags.includes(tag)) {
        tags.push(tag);
        input.value = tags.join(', ') + ', ';
    }
    input.focus();
}

function closeModal() {
    const modal = document.getElementById('editor-modal');
    if (!modal) return;
    modal.classList.remove('opacity-100');
    const transformEl = modal.querySelector('.transform');
    if (transformEl) {
        transformEl.classList.add('translate-y-full');
        if (window.innerWidth >= 640) transformEl.classList.add('sm:scale-95');
    }
    setTimeout(() => modal.classList.add('hidden'), 300);
}

let activeLightboxGallery = [];
let activeLightboxIndex = 0;

function openLightbox(src, title, type = 'image', metadata = null) {
    const lightbox = document.getElementById('lightbox-modal');
    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');
    const metaContainer = document.getElementById('lightbox-metadata');
    
    const prevBtn = document.getElementById('lightbox-prev-btn');
    const nextBtn = document.getElementById('lightbox-next-btn');
    
    if (prevBtn && nextBtn) {
        if (activeLightboxGallery && activeLightboxGallery.length > 1) {
            prevBtn.classList.remove('hidden');
            nextBtn.classList.remove('hidden');
        } else {
            prevBtn.classList.add('hidden');
            nextBtn.classList.add('hidden');
        }
    }
    
    document.getElementById('lightbox-caption').textContent = getSafeDate(title).toLocaleDateString('ja-JP');
    
    if (metadata) {
        let parts = [];
        if (metadata.date) parts.push(`<i class="fa-solid fa-camera mr-1"></i>${metadata.date}`);
        if (metadata.location) parts.push(`<i class="fa-solid fa-location-dot mr-1 ml-2"></i>${metadata.location}`);
        metaContainer.innerHTML = parts.join('');
        metaContainer.classList.remove('hidden');
    } else {
        metaContainer.innerHTML = '';
        metaContainer.classList.add('hidden');
    }
    
    if (type === 'video') {
        img.classList.add('hidden');
        video.classList.remove('hidden');
        video.src = src;
        video.load();
        document.getElementById('zoom-indicator').classList.add('hidden');
    } else {
        video.classList.add('hidden');
        video.src = '';
        img.classList.remove('hidden');
        img.src = src;
        document.getElementById('zoom-indicator').classList.remove('hidden');
        isOriginalSize = false;
        img.className = "max-w-full max-h-[90vh] rounded-lg shadow-2xl object-contain transition-all duration-300 transform cursor-zoom-in";
        document.getElementById('zoom-indicator').innerHTML = '<i class="fa-solid fa-magnifying-glass-plus"></i> フィット';
    }
    lightbox.classList.remove('hidden');
    setTimeout(() => lightbox.classList.add('opacity-100'), 10);
}

async function openLightboxFromCard(id, mediaIndex = 0) {
    const item = diaryItems.find(i => i.id === id); 
    const mediaFiles = item?.mediaFiles || (item?.media ? [item.media] : []);
    
    activeLightboxGallery = mediaFiles.map(m => ({
        type: m.type?.startsWith('video/') ? 'video' : 'image',
        data: m.data || m.thumbnail || '',
        mediaName: m.mediaName,
        originalName: m.originalName,
        metadata: m.metadata,
        title: item.date
    }));
    activeLightboxIndex = mediaIndex;
    
    const targetMedia = activeLightboxGallery[activeLightboxIndex];
    if (!targetMedia) return;
    
    let srcUrl = targetMedia.data;
    if (targetMedia.mediaName) srcUrl = await loadMediaUrl(targetMedia.mediaName);

    if (targetMedia.type === 'image') { 
        openLightbox(srcUrl, item.date, 'image', targetMedia.metadata); 
    } else if (targetMedia.type === 'video') {
        if (dirHandle && targetMedia.originalName) { 
            dirHandle.getDirectoryHandle('originals')
                .then(dir => dir.getFileHandle(targetMedia.originalName))
                .then(handle => handle.getFile())
                .then(file => {
                    openLightbox(URL.createObjectURL(file), item.date, 'video', targetMedia.metadata);
                })
                .catch(e => {
                    openLightbox(srcUrl, item.date, 'video', targetMedia.metadata);
                }); 
        } else { 
            openLightbox(srcUrl, item.date, 'video', targetMedia.metadata); 
        }
    }
}

async function navigateLightbox(direction, event) {
    if (event) event.stopPropagation();
    if (!activeLightboxGallery || activeLightboxGallery.length <= 1) return;
    
    activeLightboxIndex += direction;
    if (activeLightboxIndex < 0) activeLightboxIndex = activeLightboxGallery.length - 1;
    if (activeLightboxIndex >= activeLightboxGallery.length) activeLightboxIndex = 0;
    
    const targetMedia = activeLightboxGallery[activeLightboxIndex];
    let srcUrl = targetMedia.data;
    if (targetMedia.mediaName) srcUrl = await loadMediaUrl(targetMedia.mediaName);
    
    if (targetMedia.type === 'image') { 
        openLightbox(srcUrl, targetMedia.title, 'image', targetMedia.metadata); 
    } else if (targetMedia.type === 'video') {
        if (dirHandle && targetMedia.originalName) { 
            dirHandle.getDirectoryHandle('originals')
                .then(dir => dir.getFileHandle(targetMedia.originalName))
                .then(handle => handle.getFile())
                .then(file => {
                    openLightbox(URL.createObjectURL(file), targetMedia.title, 'video', targetMedia.metadata);
                })
                .catch(e => {
                    openLightbox(srcUrl, targetMedia.title, 'video', targetMedia.metadata);
                }); 
        } else { 
            openLightbox(srcUrl, targetMedia.title, 'video', targetMedia.metadata); 
        }
    }
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox-modal');
    const video = document.getElementById('lightbox-video');
    if (video) {
        video.pause();
        video.removeAttribute('src'); 
        video.load();                 
    }
    lightbox.classList.remove('opacity-100');
    setTimeout(() => lightbox.classList.add('hidden'), 300);
}

function toggleImageZoom(e) {
    if (e) e.stopPropagation();
    const img = document.getElementById('lightbox-img');
    isOriginalSize = !isOriginalSize;
    
    img.className = isOriginalSize ? "w-auto h-auto max-w-none max-h-none cursor-zoom-out transition-all duration-300 transform" : "max-w-full max-h-[90vh] rounded-lg shadow-2xl object-contain transition-all duration-300 transform cursor-zoom-in";
    document.getElementById('zoom-indicator').innerHTML = isOriginalSize ? '<i class="fa-solid fa-magnifying-glass-minus"></i> 原寸大' : '<i class="fa-solid fa-magnifying-glass-plus"></i> フィット';
}

function openAutotagModal() {
    const modal = document.getElementById('autotag-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.add('opacity-100');
        modal.querySelector('.transform').classList.remove('scale-95');
        modal.querySelector('.transform').classList.add('scale-100');
    }, 10);
}

function closeAutotagModal() {
    const modal = document.getElementById('autotag-modal');
    if (!modal) return;
    modal.classList.remove('opacity-100');
    modal.querySelector('.transform').classList.remove('scale-100');
    modal.querySelector('.transform').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

async function saveAutotagRules() {
    const textarea = document.getElementById('autotag-rules-textarea');
    if (textarea) {
        await appSettings.set('smart_diary_autotag_rules', textarea.value);
        saveSettingsToFolder();
        showToast("設定を保存しました");
    }
    closeAutotagModal();
    await applyAutoTags();
}

async function applyAutoTags(force = false) {
    const contentTextarea = document.getElementById('entry-content');
    const tagsInput = document.getElementById('entry-tags');
    if (!contentTextarea || !tagsInput) return;
    
    const savedRules = appSettings.get('smart_diary_autotag_rules');
    if (!savedRules) return;
    
    const content = fuzzyString(contentTextarea.value);
    let tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
    const autoTags = [];
    
    savedRules.split('\n').forEach(line => { 
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) return;
        
        const tag = line.substring(0, colonIdx).trim();
        const keywordsText = line.substring(colonIdx + 1);
        const keywords = keywordsText.split(',').map(k => k.trim()).filter(Boolean); 
        
        const matched = keywords.some(keyword => content.includes(fuzzyString(keyword)));
        if (matched) autoTags.push(tag); 
    });
    
    if (force) {
        autoTags.forEach(tag => {
            if (!tags.includes(tag)) {
                tags.push(tag);
            }
        });
        tagsInput.value = tags.join(', ');
    }
}

function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    isSettingsOpen = !isSettingsOpen;
    
    if (isSettingsOpen) { 
        document.getElementById('settings-filter-label').textContent = currentPeriodFilter;
        modal.classList.remove('hidden'); 
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modal.querySelector('div').classList.remove('scale-95');
        }, 10); 
    } else { 
        modal.classList.add('opacity-0');
        modal.querySelector('div').classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300); 
    }
}

function getTargetsForExport() { 
    const targets = []; 
    const hasDiaryCheck = globalSelectedIds.size > 0;
    const hasImageCheck = globalSelectedImageIds.size > 0;

    if (!hasDiaryCheck && !hasImageCheck) {
        return currentFilteredItems;
    }

    currentFilteredItems.forEach(item => { 
        const isDiaryChecked = globalSelectedIds.has(item.id);
        const mFiles = item.mediaFiles || (item.media ? [item.media] : []);
        const checkedImageIndices = [];
        
        mFiles.forEach((m, idx) => {
            if (globalSelectedImageIds.has(`${item.id}-media-${idx}`)) {
                checkedImageIndices.push(idx);
            }
        });

        if (isDiaryChecked || checkedImageIndices.length > 0) {
            let exportItem = { ...item };
            
            if (checkedImageIndices.length > 0) {
                exportItem.mediaFiles = mFiles.filter((_, idx) => checkedImageIndices.includes(idx));
            }
            targets.push(exportItem);
        }
    }); 
    return targets; 
}

function exportData(type) {
    const targets = getTargetsForExport(); 
    if (targets.length === 0) return alert("出力するデータがありません。");
    const dateStr = new Date().toISOString().split('T')[0];
    
    const content = type === 'json' ? JSON.stringify(targets, null, 2) : targets.map(i => {
    const displayDate = i.date ? i.date.replace('T', ' ') : (i.date || '');
    let md = `## ${displayDate}\n\n`;
    
    const weatherVal = i.weather ? String(i.weather).toLowerCase().trim() : '';
    if (weatherVal && weatherConfig[weatherVal]) {
        md += `**天気**: ${weatherConfig[weatherVal].label}\n\n`;
    } else if (i.weather) {
        md += `**天気**: ${i.weather}\n\n`;
    }
    
    if (i.content) md += `${i.content}\n\n`;
    
    const images = getAllImagesFromItem(i);
    images.forEach(img => {
        const fileRelPath = img.isOriginal ? `originals/${img.originalName}` : (img.mediaName ? `media/${img.mediaName}` : img.src);

        if (img.isVideo) {
            md += `[動画ファイル](${fileRelPath})\n\n`;
        } else {
            if (img.isOriginal) {
                md += `<img src="${fileRelPath}" alt="画像" style="max-width:100%; height:auto;" />\n\n`;
            } else {
                md += `![](${fileRelPath})\n\n`; 
            }
        }
    });
    
    if (i.tags && i.tags.length > 0) {
        md += `${i.tags.map(tag => `#${tag}`).join(' ')}\n\n`;
    } 
    return md;
}).join('---\n\n');
    
    const blob = new Blob([content], { type: type === 'json' ? 'application/json' : 'text/markdown' }); 
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); 
    a.download = `SmartDiary_Export_${dateStr}.${type === 'json' ? 'json' : 'md'}`;
    a.click(); 
    URL.revokeObjectURL(a.href);
    toggleSettings();
}

function exportPDF() {
    const hasDiaryCheck = globalSelectedIds.size > 0;
    const hasImageCheck = globalSelectedImageIds.size > 0;
    toggleSettings(); 
    
    const targets = getTargetsForExport();
    if (targets.length === 0) {
        showToast("印刷するデータがありません");
        return;
    }

    const container = document.getElementById('diary-container'); 
    const wasContainerHidden = container.classList.contains('hidden'); 
    if (wasContainerHidden) container.classList.remove('hidden');
    
    const originalFilteredItems = currentFilteredItems;
    const prevLimit = currentDisplayLimit; 
    
    currentFilteredItems = targets;
    currentDisplayLimit = targets.length; 
    
    container.innerHTML = '';
    targets.forEach(item => { 
        container.appendChild(createCardElement(item, true)); 
    });
    
    setTimeout(async () => {
        const allCards = document.querySelectorAll('.diary-card'); 
        allCards.forEach(card => { 
            const itemId = card.getAttribute('data-id'); 
            
            if (hasDiaryCheck || hasImageCheck) {
                const isDiaryChecked = globalSelectedIds.has(itemId);
                
                if (!isDiaryChecked) {
                    const prose = card.querySelector('.prose');
                    if (prose) prose.classList.add('print-hide');
                    
                    const tags = card.querySelector('.flex.flex-wrap.gap-1\\.5.mt-3');
                    if (tags) tags.classList.add('print-hide');
                    
                    const updateInfo = card.querySelector('.fa-clock-rotate-left')?.parentNode;
                    if (updateInfo) updateInfo.classList.add('print-hide');
                }
            }
        });

        showToast("印刷レイアウトを準備中...");
        await applyMediaUrls();

        const visibleImages = Array.from(container.querySelectorAll('img:not(.print-hide)'));
        const imagePromises = visibleImages.map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve; 
            });
        });

        await Promise.all(imagePromises);

        requestAnimationFrame(() => {
            setTimeout(() => {
                window.print(); 
                
                currentFilteredItems = originalFilteredItems;
                currentDisplayLimit = prevLimit; 
                
                allCards.forEach(c => {
                    c.classList.remove('print-hide');
                    c.querySelectorAll('.print-hide').forEach(el => el.classList.remove('print-hide'));
                }); 
                
                if (wasContainerHidden) container.classList.add('hidden'); 
                filterDiaryItems(false); 
            }, 100);
        });
        
    }, 50); 
}

async function exportOriginalMedia() {
    const targets = getTargetsForExport(); 
    let targetImages = [];
    
    targets.forEach(item => {
        const images = getAllImagesFromItem(item);
        images.forEach(img => {
            if (img.isOriginal) {
                targetImages.push(img);
            }
        });
    });
    
    if (targetImages.length === 0) return alert("出力対象の日記にオリジナルメディア（画像・動画）が含まれていません、または選択されていません。"); 
    if (!dirHandle) return alert("オリジナルメディアを出力するには、先に上部のフォルダアイコンから保存先フォルダを同期してください。");
    
    try {
        const originalsDir = await dirHandle.getDirectoryHandle('originals'); 
        document.getElementById('toast-text').innerText = "対象ファイルを計算中...";
        document.getElementById('toast').classList.replace('opacity-0', 'opacity-100');
        
        let totalSize = 0;
        const filesToExport = [];
        for (const img of targetImages) { 
            try { 
                const fileHandle = await originalsDir.getFileHandle(img.originalName);
                const file = await fileHandle.getFile(); 
                totalSize += file.size;
                filesToExport.push({ name: img.originalName, file: file }); 
            } catch (e) {
                console.warn("File not found in originals: " + img.originalName);
            } 
        }
        
        document.getElementById('toast').classList.replace('opacity-100', 'opacity-0'); 
        if (filesToExport.length === 0) return alert("原本のメディアファイルが見つかりませんでした。");
        
        const THRESHOLD_MB = 100;
        const totalMB = (totalSize / (1024 * 1024)).toFixed(1);
        
        if (totalSize > THRESHOLD_MB * 1024 * 1024) { 
            if (!confirm(`選択されたメディアの合計容量が ${totalMB} MB と大きくなっています。\n\nコピー処理に時間がかかる可能性がありますが、続行しますか？`)) return; 
        }
        
        alert(`合計 ${filesToExport.length} 件 (${totalMB} MB) のメディアを出力します。\n「OK」を押した後に【出力先のフォルダ】を選択してください。`); 
        const destDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); 
        toggleSettings();
        showToast("コピーを開始しました...");
        
        let copiedCount = 0;
        for (const { name, file } of filesToExport) {
            try {
                const newFileHandle = await destDirHandle.getFileHandle(name, { create: true });
                const writable = await newFileHandle.createWritable();
                await writable.write(file);
                await writable.close();
                copiedCount++;
            } catch (e) {}
        }
        showToast(`${copiedCount}件のメディアを出力しました！`);
    } catch (err) {
        if (err.name !== 'AbortError') alert("メディアの出力中にエラーが発生しました。");
    }
}

const SmartPrintAdapter = {
    openInSmartPrint: async function() {
        const entries = getTargetsForExport();
        if (!entries || entries.length === 0) return alert("出力する日記データがありません。"); 
        if (!dirHandle) return alert("SmartPrintへの書き出しには、先に上部のフォルダアイコンから保存先フォルダを同期してください。");
        
        try {
            const dataStr = JSON.stringify({ 
                version: 1, 
                chapters: entries.map(e => {
                    const images = getAllImagesFromItem(e);
                    const imageNames = [];
                    
                    images.forEach(img => {
                        if (img.isOriginal && !img.isVideo && img.originalName) { 
                            imageNames.push(`originals/${img.originalName}`); 
                        } else if (img.mediaName) {
                            imageNames.push(`media/${img.mediaName}`);
                        } else if (img.src && !img.isVideo) {
                            imageNames.push(img.src);
                        }
                    });
                    
                    let contentBlock = e.content || "";
                    contentBlock = contentBlock.replace(/\r\n/g, '\n');
                    if (e.tags && e.tags.length > 0) {
                        contentBlock += `\n\n${e.tags.map(tag => `#${tag}`).join(' ')}`;
                    }
                    
                    const formattedDate = e.date ? e.date.replace('T', ' ') : '';
                    const formattedTitle = e.title || `${e.date ? e.date.split('T')[0] : ''} の日記`;

                    return {
                        id: e.id,
                        title: formattedTitle,
                        date: formattedDate,
                        blocks: contentBlock,
                        content: contentBlock,
                        text: contentBlock,
                        images: imageNames
                    };
                }) 
            }, null, 2);
            
            const fileHandle = await dirHandle.getFileHandle('smartprint_export_data.json', { create: true }); 
            const writable = await fileHandle.createWritable();
            await writable.write(dataStr);
            await writable.close();
            
            toggleSettings();
            showToast("SmartPrint用のデータを出力しました");
        } catch (e) {
            alert("出力に失敗しました。");
        }
    }
};

async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedItems = JSON.parse(e.target.result);
            if (!Array.isArray(importedItems)) {
                alert("無効なファイル形式です。JSONの配列データを選択してください。");
                return;
            }

            pendingImportConflicts = [];
            pendingImportSafeItems = [];
            let exactMatchCount = 0;

            importedItems.forEach(incoming => {
                const exactMatch = diaryItems.find(existing =>
                    existing.date === incoming.date && 
                    existing.content === incoming.content && 
                    existing.weather === incoming.weather &&
                    existing.updatedAt === incoming.updatedAt
                );
                if (exactMatch) {
                    exactMatchCount++;
                    return;
                }

                const conflictingExisting = diaryItems.filter(existing => existing.date === incoming.date);
                if (conflictingExisting.length > 0) {
                    pendingImportConflicts.push({ incoming: incoming, existing: conflictingExisting });
                } else {
                    pendingImportSafeItems.push(incoming);
                }
            });

            if (pendingImportConflicts.length === 0) {
                executeSafeImport(exactMatchCount);
            } else {
                showConflictModal(exactMatchCount);
            }
        } catch (error) {
            console.error("インポートエラー:", error);
            alert("ファイルの読み込み中にエラーが発生しました。");
        } finally {
            event.target.value = ''; 
        }
    };
    reader.readAsText(file);
}

async function executeSafeImport(exactMatchCount) {
    let addedCount = 0;
    pendingImportSafeItems.forEach(incoming => {
        const isIdExists = diaryItems.some(i => i.id === incoming.id);
        if (isIdExists || !incoming.id) {
            incoming.id = generateUniqueId();
        }
        diaryItems.push(incoming);
        addedCount++;
    });

    if (addedCount > 0) {
        sortDiaryItemsByDateData();
        await saveLocally();
        renderDiaryItems();
        updateTagFilterOptions();
        if (isSettingsOpen) toggleSettings();
        alert(`${addedCount}件を新しく追加しました。（${exactMatchCount}件は重複のためスキップ）`);
    } else {
        alert(`取り込む新しいデータはありませんでした。（${exactMatchCount}件は完全に一致したためスキップ）`);
    }
}

function showConflictModal(exactMatchCount) {
    const modal = document.getElementById('conflict-modal');
    const container = document.getElementById('conflict-list-container');
    container.innerHTML = '';

    pendingImportConflicts.forEach((conflict, index) => {
        const incoming = conflict.incoming;
        let text = incoming.content ? incoming.content.replace(/<[^>]*>?/gm, '').substring(0, 50) + '...' : '(内容なし / 画像などのみ)';
        const displayDate = incoming.date ? incoming.date.replace('T', ' ') : '日時不明';

        const itemDiv = document.createElement('div');
        itemDiv.className = "bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3.5";
        itemDiv.innerHTML = `
            <div class="mb-3">
                <span class="text-xs font-bold text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/50 px-2 py-1 rounded-md"><i class="fa-regular fa-clock mr-1"></i>${displayDate}</span>
                <p class="text-xs font-medium text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">${DOMPurify.sanitize(text)}</p>
            </div>
            <div class="space-y-2 mt-3 text-xs bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-100 dark:border-slate-700/50 shadow-sm">
                <label class="flex items-center space-x-2.5 cursor-pointer p-1">
                    <input type="radio" name="conflict_${index}" value="overwrite" class="text-indigo-600 focus:ring-indigo-500 w-4 h-4" checked>
                    <span class="text-slate-700 dark:text-slate-200 font-bold">既存の日記に上書きする <span class="text-[10px] text-rose-500 font-normal">(元の内容は消去されます)</span></span>
                </label>
                <div class="w-full h-px bg-slate-100 dark:bg-slate-700/50"></div>
                <label class="flex items-center space-x-2.5 cursor-pointer p-1">
                    <input type="radio" name="conflict_${index}" value="new" class="text-indigo-600 focus:ring-indigo-500 w-4 h-4">
                    <span class="text-slate-700 dark:text-slate-200 font-bold">別の日記として新規作成 <span class="text-[10px] text-emerald-500 font-normal">(新しいIDを発行)</span></span>
                </label>
                <div class="w-full h-px bg-slate-100 dark:bg-slate-700/50"></div>
                <label class="flex items-center space-x-2.5 cursor-pointer p-1">
                    <input type="radio" name="conflict_${index}" value="skip" class="text-indigo-600 focus:ring-indigo-500 w-4 h-4">
                    <span class="text-slate-700 dark:text-slate-200 font-bold">取り込まずにスキップ</span>
                </label>
            </div>
        `;
        container.appendChild(itemDiv);
    });

    modal.dataset.exactMatchCount = exactMatchCount;
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.add('opacity-100');
        modal.querySelector('.transform').classList.remove('scale-95');
    }, 10);
    if (isSettingsOpen) toggleSettings();
}

function closeConflictModal() {
    const modal = document.getElementById('conflict-modal');
    if (!modal) return;
    modal.classList.remove('opacity-100');
    const transformEl = modal.querySelector('.transform');
    if (transformEl) transformEl.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

async function resolveImportConflicts() {
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = parseInt(document.getElementById('conflict-modal').dataset.exactMatchCount || 0);

    pendingImportSafeItems.forEach(incoming => {
        const isIdExists = diaryItems.some(i => i.id === incoming.id);
        if (isIdExists || !incoming.id) {
            incoming.id = generateUniqueId();
        }
        diaryItems.push(incoming);
        addedCount++;
    });

    pendingImportConflicts.forEach((conflict, index) => {
        const action = document.querySelector(`input[name="conflict_${index}"]:checked`).value;
        const incoming = conflict.incoming;

        if (action === 'overwrite') {
            const targetExisting = conflict.existing[0];
            diaryItems = diaryItems.filter(existing => existing.date !== incoming.date);
            incoming.id = targetExisting.id;
            diaryItems.push(incoming);
            updatedCount++;
        } else if (action === 'new') {
            incoming.id = generateUniqueId();
            diaryItems.push(incoming);
            addedCount++;
        } else {
            skippedCount++;
        }
    });

    closeConflictModal();

    if (addedCount > 0 || updatedCount > 0) {
        sortDiaryItemsByDateData();
        await saveLocally();
        renderDiaryItems();
        updateTagFilterOptions();
        alert(`インポート完了: ${addedCount}件を追加、${updatedCount}件を上書きしました。（${skippedCount}件スキップ）`);
    } else {
        alert(`取り込まれたデータはありませんでした。（${skippedCount}件スキップ）`);
    }
}

if ('serviceWorker' in navigator) { 
    window.addEventListener('load', () => { 
        navigator.serviceWorker.register('./sw.js')
            .then((registration) => { console.log('ServiceWorker registration successful'); })
            .catch((err) => { console.log('ServiceWorker registration failed: ', err); }); 
    }); 
}

function toggleImageZoom(event) {
    if (event) event.stopPropagation();
    const img = document.getElementById('lightbox-img');
    const wrapper = document.getElementById('lightbox-content-wrapper');
    const container = document.getElementById('lightbox-scroll-container');
    const indicator = document.getElementById('zoom-indicator');
    
    if (!img || img.classList.contains('hidden')) return;

    isOriginalSize = !isOriginalSize;
    
    if (isOriginalSize) {
        img.classList.remove('max-w-full', 'max-h-[90vh]', 'object-contain', 'cursor-zoom-in');
        img.classList.add('cursor-zoom-out');
        
        wrapper.classList.remove('flex', 'items-center', 'justify-center', 'max-w-full', 'max-h-[90vh]');
        if (container) container.classList.remove('flex');
        
        img.style.width = 'auto';
        img.style.minWidth = '150vw';
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
        img.style.height = 'auto';
        
        setTimeout(() => {
            if (container) {
                container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
                container.scrollTop = (container.scrollHeight - container.clientHeight) / 2;
            }
        }, 10);
        
        if (indicator) indicator.innerHTML = '<i class="fa-solid fa-magnifying-glass-minus"></i> 縮小';
    } else {
        img.classList.add('max-w-full', 'max-h-[90vh]', 'object-contain', 'cursor-zoom-in');
        img.classList.remove('cursor-zoom-out');
        
        wrapper.classList.add('flex', 'items-center', 'justify-center', 'max-w-full', 'max-h-[90vh]');
        if (container) container.classList.add('flex');
        
        img.style.width = '';
        img.style.minWidth = '';
        img.style.maxWidth = '';
        img.style.maxHeight = '';
        img.style.height = '';
        
        if (indicator) indicator.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus"></i> フィット';
    }
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox-modal');
    if (!lightbox) return;
    
    if (isOriginalSize) {
        toggleImageZoom();
    }
    
    lightbox.classList.add('opacity-0');
    setTimeout(() => {
        lightbox.classList.add('hidden');
        const video = document.getElementById('lightbox-video');
        if (video) {
            video.pause();
            video.src = '';
        }
    }, 300);
}