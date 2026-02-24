/* --- 全域狀態 --- */
let state = { 
    bIdx: 0, chap: 1, vStart: 1, vEnd: 1, 
    history: [], 
    selectedVers: ["unv", "ncv", "kjv"] 
};

const tttt = { 
    "unv": "和合本", "rcuv": "和合修訂版", "ncv": "新譯本", 
    "kjv": "KJV", "niv": "NIV", "cnv": "當代譯本",
    "asv": "ASV", "nasb": "NASB"
};

let searchTimer = null; // 用於 Debounce

/* --- 初始化 --- */
window.onload = () => {
    if (typeof BIBLE_DATA === 'undefined') return;
    renderFilter(); 
    renderHintWindow();
    renderCopyGrid(); 
    renderDevSpecs(); 
    setupSearch();
    
    const prevSelect = document.getElementById('previewVerSelect');
    if (prevSelect) {
        prevSelect.innerHTML = BIBLE_DATA.versions.map(v => `<option value="${v.id}">${v.n}</option>`).join('');
    }
    
    window.addEventListener('keydown', (e) => {
        if (e.altKey && e.key.toLowerCase() === 's') { 
            e.preventDefault(); 
            const i = document.getElementById('bibleSearch'); i.focus(); i.select(); 
        }
        if (e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); toggleTheme(); }
    });
};

/* --- 核心渲染功能 --- */
function renderFilter() {
    const box = document.getElementById('verFilter');
    if (!box) return;
    box.innerHTML = `<span class="filter-label">選擇展示譯本：</span>` + BIBLE_DATA.versions.map(v => `
        <label class="check-item">
            <input type="checkbox" value="${v.id}" ${state.selectedVers.includes(v.id)?'checked':''} onchange="updateSelectedVers()"> ${v.n}
        </label>
    `).join('');
}

function updateSelectedVers() {
    state.selectedVers = Array.from(document.querySelectorAll('#verFilter input:checked')).map(i => i.value);
    renderCopyGrid();
    checkAllSelectedVersons(); // 更新選中的譯本時立即檢查
}

function renderCopyGrid() {
    const grid = document.getElementById('copyGrid');
    if (!grid) return;
    const activeVers = BIBLE_DATA.versions.filter(v => state.selectedVers.includes(v.id));
    
    grid.innerHTML = activeVers.map(v => `
        <div class="ver-card" id="card-${v.id}">
            <div class="ver-info">
                <span class="ver-name">${v.n}</span>
                <span class="status-dot"></span>
            </div>
            <div class="card-btns">
                <button class="quick-copy-btn" onclick="copyAction('${v.id}', 'full')">⚡ 複製經文</button>
                <button class="copy-title-btn" onclick="copyAction('${v.id}', 'title')">📋 僅標題</button>
            </div>
            <div class="error-msg">⚠️ 抓取失敗</div>
        </div>`).join('');
}

/* --- API 通訊 --- */
async function fetchBibleData(verId, bookName, chap, vStart, vEnd) {
    const card = document.getElementById(`card-${verId}`);
    if (card) resetCardStatus(verId);

    return new Promise((resolve, reject) => {
        let secParam = (vStart === 0) ? "" : ((vStart === vEnd) ? `&sec=${vStart}` : `&sec=${vStart}-${vEnd}`);
        const url = `https://bible.fhl.net/json/qb.php?chineses=${encodeURIComponent(bookName)}&chap=${chap}&sec=${secParam}&version=${verId}&gb=0&strong=0`;
       
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.timeout = 5000;
        xhr.onload = function() {
            if (this.status === 200) {
                const rawText = this.responseText.trim();
                if (rawText.startsWith("Fail:")) {
                    if (card) markCardError(verId);
                    reject("譯本資料庫 SQL 異常");
                    return;
                }
                try {
                    let res = JSON.parse(rawText.replace(/[\u3000\u000A\u000D]+/g, " "));
                    if (!res.record || res.record.length === 0) {
                        if (card) markCardError(verId);
                        reject("查無資料");
                    } else {
                        resolve(processFhlData(res));
                    }
                } catch(e) { 
                    if (card) markCardError(verId);
                    reject("JSON 格式錯誤"); 
                }
            } else { 
                if (card) markCardError(verId);
                reject(`HTTP ${this.status}`); 
            }
        };
        xhr.onerror = () => { if (card) markCardError(verId); reject("網路失敗"); };
        xhr.send();
    });
}

function processFhlData(data) {
    return data.record.map(r => {
        let text = r.bible_text.replace(/<h[1-6]>.*?<\/h[1-6]>/g, "").replace(/<[^>]*>/g, "").replace(/【[^>]*】/g, "");
        return { sec: r.sec, text: text.trim() };
    });
}

/* --- 搜尋邏輯 (自動搜尋優化) --- */
function setupSearch() {
    const input = document.getElementById('bibleSearch');
    const sugBox = document.getElementById('suggestions');

    input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        
        // 1. 處理提示詞框
        if (val.length > 0) {
            const matches = BIBLE_DATA.books.filter(b => b.n.includes(val) || b.s.toLowerCase().startsWith(val)).slice(0, 5);
            sugBox.innerHTML = matches.map(b => `<div class="sug-item" onclick="quickFill('${b.s}')">📖 ${b.n} (${b.s})</div>`).join('');
            sugBox.style.display = 'block';
        } else { 
            sugBox.style.display = 'none'; 
        }

        // 2. 免按 Enter 自動搜尋 (Debounce)
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            if (val.length >= 2) { // 避免輸入一個字就狂搜
                parseSearch(val, true); // true 表示為自動觸發
            }
        }, 600); // 停止打字 0.6 秒後執行
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            clearTimeout(searchTimer);
            sugBox.style.display = 'none';
            parseSearch(input.value, false);
        }
    });
}

function parseSearch(raw, isAuto = false) {
    // 正則支援：創1:1, 創1 1, 1cor 1:1-5
    const regex = /^([1-3]?[\u4e00-\u9fa5a-zA-Z]+)?\s*(\d+)(?:[:\s](\d+)(?:-(\d+))?)?$/i;
    const match = raw.match(regex);

    if (match) {
        const bookPart = match[1] ? match[1].replace(/\s/g,'').toLowerCase() : "";
        const idx = BIBLE_DATA.books.findIndex(b => b.n.includes(bookPart) || b.s.toLowerCase() === bookPart || b.k.toLowerCase() === bookPart);
        
        if (idx !== -1) {
            console.log("找到書籍:", BIBLE_DATA.books[idx].n); // 除錯用
            const newChap = parseInt(match[2]);
            const newStart = match[3] ? parseInt(match[3]) : 0;
            const newEnd = match[4] ? parseInt(match[4]) : newStart;

            // 如果自動搜尋時參數沒變，就不重複跑 API
            if (isAuto && state.bIdx === idx && state.chap === newChap && state.vStart === newStart && state.vEnd === newEnd) return;

            state.bIdx = idx;
            state.chap = newChap;
            state.vStart = newStart;
            state.vEnd = newEnd;
            
            const book = BIBLE_DATA.books[idx];
            if (!isAuto) showToast(`定位：${book.n} ${state.chap}`);

            renderCopyGrid(); 
            checkAllSelectedVersons();
            if (document.getElementById('previewView').style.display !== 'none') updatePreview();
        }
        else {
    console.log("正則匹配失敗或找不到對應書籍");
            ｝
    }
}

async function checkAllSelectedVersons() {
    const book = BIBLE_DATA.books[state.bIdx];
    state.selectedVers.forEach(async (verId) => {
        try {
            await fetchBibleData(verId, book.s, state.chap, state.vStart, state.vEnd);
        } catch (err) {
            console.warn(`[AutoCheck] ${verId} 失敗: ${err}`);
        }
    });
}

/* --- 預覽與功能模組 --- */
async function updatePreview() {
    const previewSelect = document.getElementById('previewVerSelect');
    const prevContent = document.getElementById('previewContent');
    const prevTitle = document.getElementById('previewTitle');
    
    if (!previewSelect || !prevContent || !BIBLE_DATA) return;

    const verId = previewSelect.value;
    const book = BIBLE_DATA.books[state.bIdx];
    const rangeStr = state.vStart === 0 ? "" : `:${state.vStart}${state.vEnd > state.vStart ? '-' + state.vEnd : ''}`;
    
    if (prevTitle) prevTitle.innerText = `${book.n} ${state.chap}${rangeStr}`;
    prevContent.innerHTML = `<div style="padding:40px; text-align:center;"><div class="loading-spinner">⏳</div></div>`;

    try {
        const verses = await fetchBibleData(verId, book.s, state.chap, state.vStart, state.vEnd);
        if (verses && verses.length > 0) {
            prevContent.innerHTML = verses.map(v => `
                <div class="verse-line">
                    <span style="color:var(--accent); font-weight:bold; margin-right:12px; font-size:0.85em;">${v.sec}</span>
                    <span class="verse-text">${v.text}</span>
                </div>
            `).join('');
        }
    } catch (err) {
        prevContent.innerHTML = `<div style="padding:20px; color:var(--error);">⚠️ 載入失敗: ${err}</div>`;
    }
}

async function copyAction(verId, type) {
    const book = BIBLE_DATA.books[state.bIdx];
    try {
        const verses = await fetchBibleData(verId, book.s, state.chap, state.vStart, state.vEnd);
        const ref = `${book.n} ${state.chap}${state.vStart === 0 ? '' : ':' + state.vStart + (state.vEnd > state.vStart ? '-' + state.vEnd : '')}`;
        if (type === 'title') {
            await navigator.clipboard.writeText(`${ref} (${tttt[verId] || verId})`);
        } else {
            // 中文不加空格，英文加空格
            const sep = ["unv", "rcuv", "ncv", "cnv"].includes(verId) ? "" : " ";
            let content = verses.map(v => (verses.length > 1 ? `${v.sec}` : "") + v.text).join(sep);
            await navigator.clipboard.writeText(`${ref} ${content}`);
        }
        showToast("已複製");
    } catch (err) { showToast("錯誤：" + err); }
}

/* --- UI 輔助 --- */
function switchMode(m) {
    document.querySelectorAll('.m-tab').forEach(t => t.classList.remove('active'));
    const targetTab = document.getElementById('tab-' + m);
    if (targetTab) targetTab.classList.add('active');
    ['copyView', 'previewView', 'specView'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = 'none';
    });
    const targetView = document.getElementById(m + 'View');
    if(targetView) targetView.style.display = 'block';
    if (m === 'preview') updatePreview();
}

function markCardError(verId) {
    const card = document.getElementById(`card-${verId}`);
    if (card) card.classList.add('has-error');
}

function resetCardStatus(verId) {
    const card = document.getElementById(`card-${verId}`);
    if (card) card.classList.remove('has-error');
}

function toggleTheme() {
    const theme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', theme);
}

function showToast(m) {
    const t = document.getElementById('toast');
    if(!t) return;
    t.innerText = m; t.style.display = 'block'; t.style.opacity = '1';
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.style.display = 'none', 300); }, 2000);
}

function quickFill(s) {
    const input = document.getElementById('bibleSearch');
    input.value = s + " ";
    input.focus();
    document.getElementById('suggestions').style.display = 'none';
    parseSearch(input.value, false); // 點擊提示直接觸發
}

function renderHintWindow() {
    const win = document.getElementById('hintWindow');
    if (!win) return;
    const groups = [...new Set(BIBLE_DATA.books.map(b => b.g))];
    win.innerHTML = groups.map(g => `
        <div class="hint-group"><div class="hint-title">${g}</div>
        <div class="hint-items">${BIBLE_DATA.books.filter(b => b.g === g).map(b => `<span class="hint-item" onclick="quickFill('${b.s}')">${b.s}</span>`).join('')}</div></div>`).join('');
}

function renderDevSpecs() {
    const p = document.getElementById('promptContent');
    const c = document.getElementById('checklistContent');
    if(p) p.innerText = "FHL API 自動化整合引擎...";
    if(c) c.innerText = "1. 免 Enter 搜尋 [OK]\n2. Debounce 防護 [OK]\n3. 譯本 SQL 監測 [OK]";
}
