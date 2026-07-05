// ==========================================
// 1. 基盤: IndexedDB キャッシュ & 永続化層
// ==========================================
class CacheDB {
    constructor() {
        this.dbName = 'SmartDiary_TempCacheDB';
        // 【修正】新しくオブジェクトストア(diary_items)を追加したため、バージョンを2から3に上げる
        this.version = 3; 
        this.db = null;
        this.initPromise = null; // 重複初期化を防ぐフラグ
    }

    async init() {
        if (this.db) return;
        if (this.initPromise) return this.initPromise; // 初期化中なら待機
        
        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('system_state')) {
                    db.createObjectStore('system_state');
                }
                if (!db.objectStoreNames.contains('render_cache')) {
                    db.createObjectStore('render_cache');
                }
                // 【追加】設定データ用ストアをIndexedDBに統合するための準備
                if (!db.objectStoreNames.contains('settings_state')) {
                    db.createObjectStore('settings_state');
                }
                // 【追加】日記データ用ストアをIndexedDBに追加
                if (!db.objectStoreNames.contains('diary_items')) {
                    db.createObjectStore('diary_items', { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = (e) => {
                this.initPromise = null;
                reject(e.target.error);
            };
        });
        return this.initPromise;
    }

    async get(storeName, key) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async set(storeName, key, value) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async clear(storeName) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // 【追加】ストア内の全データを取得するメソッド
    async getAll(storeName) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // 【追加】データを上書き・追加保存するメソッド (keyPathがあるストア用)
    async put(storeName, value) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(value);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // 【追加】指定したキーのデータを削除するメソッド
    async delete(storeName, key) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
}
const appDB = new CacheDB();

// データの本体をJSONとし、IndexedDBをキャッシュとして扱う設定管理マネージャー
class SettingsManager {
    constructor() {
        this.settings = {
            'diary-font-size': '16px',
            'smart_diary_include_date': 'true',
            'smart_diary_synonyms': "くるま,車,自動車,カー\nパソコン,PC,Mac,Windows\nスマホ,スマートフォン,携帯,iPhone,Android\nご飯,食事,ごはん,ランチ,ディナー",
            'smart_diary_autotag_rules': "スマホ: 携帯, android, iphone\n旅行: 出張, おでかけ, 京都\n仕事: 会議, パソコン, 残業",
            'smartdiary_user_template': "### 1. 今日一番良かったこと\n- \n\n### 2. 今日の反省点\n- \n\n### 3. 明日絶対にやること\n- ",
            'theme': 'light'
        };
    }

    async loadSettings() {
        // 1. キャッシュから読み込み（高速化）
        try {
            const cached = await appDB.get('settings_state', 'app_settings');
            if (cached) this.settings = { ...this.settings, ...cached };
        } catch (e) { console.warn("Cache load failed", e); }

        // 2. 本体であるJSONファイル(settings.json)から読み込んで上書き
        if (typeof dirHandle !== 'undefined' && dirHandle) {
            try {
                const fileHandle = await dirHandle.getFileHandle('settings.json');
                const file = await fileHandle.getFile();
                const text = await file.text();
                const jsonData = JSON.parse(text);
                this.settings = { ...this.settings, ...jsonData };
                
                // キャッシュを最新化
                await appDB.set('settings_state', 'app_settings', this.settings);
            } catch (e) {
                // ファイルがない場合は新規作成として扱う
                console.log("settings.json not found, using default/cache.");
            }
        }
    }

    async saveSettings() {
        // 1. キャッシュを更新
        await appDB.set('settings_state', 'app_settings', this.settings);

        // 2. 本体であるJSONファイルへ書き込み (一元管理のため最新のデータを統合し、キューで安全に保存)
        if (typeof dirHandle !== 'undefined' && dirHandle) {
            try {
                const unifiedSettings = {
                    ...this.settings,
                    folders: typeof savedFolders !== 'undefined' ? savedFolders : []
                };
                await writeQueue.add(async () => {
                    const fileHandle = await dirHandle.getFileHandle('settings.json', { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(JSON.stringify(unifiedSettings, null, 2));
                    await writable.close();
                });
            } catch (e) {
                console.error("Failed to save settings.json", e);
            }
        }
    }

    get(key) {
        return this.settings[key];
    }

    async set(key, value) {
        this.settings[key] = value;
        await this.saveSettings();
    }
}
const appSettings = new SettingsManager();

class AsyncQueue {
    constructor() {
        this.queue = Promise.resolve();
    }
    add(operation) {
        return new Promise((resolve, reject) => {
            this.queue = this.queue.then(() => operation()).then(resolve).catch(reject);
        });
    }
}
const writeQueue = new AsyncQueue();