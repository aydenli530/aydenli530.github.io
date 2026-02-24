let state = { 
    bIdx: 0, chap: 1, vStart: 1, vEnd: 1, 
    history: [], 
    selectedVers: ["unv", "ncv", "kjv"],
    sugCursor: -1, 
    currentMatches: [] 
};

let searchTimer;

window.onload = () => {
    const savedTheme = localStorage.getItem('bible-theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
    
    renderFilter();
    
const isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);
if (!isMobile || window.innerWidth > 768) {
    renderHintWindow();
}

    renderCopyGrid();
    renderDevSpecs();
    setupSearch();

    const pSelect = document.getElementById('previewVerSelect');
    if (pSelect) pSelect.innerHTML = BIBLE_DATA.versions.map(v => `<option value="${v.id}">${v.n}</option>`).join('');

    window.addEventListener('keydown', (e) => {
        if (e.altKey && e.key.toLowerCase() === 's') { 
            e.preventDefault(); const i = document.getElementById('bibleSearch'); i.focus(); i.select(); 
        }
        if (e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); toggleTheme(); }
    });
};


// --- 新增/補回的功能：對應 HTML 第 52 行的 onclick 事件 ---
function copyToClipboard(id) {
    const content = document.getElementById(id).innerText;
    navigator.clipboard.writeText(content).then(() => {
        showToast("內容已複製到剪貼簿");
    });
}

function toggleTheme() {
    const target = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', target);
    localStorage.setItem('bible-theme', target);
    showToast(`模式：${target === 'dark' ? '深色' : '淺色'}`);
}

function setupSearch() {
    const input = document.getElementById('bibleSearch');
    const sugBox = document.getElementById('suggestions');

    // 1. 鍵盤導航邏輯簡化
    input.addEventListener('keydown', (e) => {
        const { currentMatches: matches, sugCursor: cursor } = state;
        if (sugBox.style.display !== 'block' || !matches.length) return;

        const keys = {
            ArrowDown: () => state.sugCursor = (cursor + 1) % matches.length,
            ArrowUp: () => state.sugCursor = (cursor - 1 + matches.length) % matches.length,
            Enter: () => {
                quickFill(matches[Math.max(0, cursor)].s);
                sugBox.style.display = 'none';
            }
        };

        if (keys[e.key]) {
            e.preventDefault();
            keys[e.key]();
            renderSuggestionsUI();
        }
    });

    // 2. 輸入解析邏輯簡化
    input.addEventListener('input', () => {
        const raw = input.value.trim();
        const val = raw.toLowerCase();

        // 處理建議選單
        const isNumeric = /^\d+$/.test(raw);
        state.currentMatches = (val && !isNumeric) 
            ? BIBLE_DATA.books.filter(b => b.n.includes(val) || b.s.toLowerCase().startsWith(val) || b.k.toLowerCase().startsWith(val)).slice(0, 5)
            : [];
        
        sugBox.style.display = state.currentMatches.length ? 'block' : 'none';
        if (state.currentMatches.length) { state.sugCursor = -1; renderSuggestionsUI(); }

        // 解析正則表達式
        const regex = /^([1-3]?\s*[a-zA-Z\u4e00-\u9fa5]+)?\s*(\d+)(?:[:\s](\d+)(?:-(\d+))?)?$/i;
        const match = val.match(regex);
        if (!match) return;

        const [_, bookPartRaw, chap, vStart, vEnd] = match;
        const bookPart = bookPartRaw?.replace(/\s/g, '').toLowerCase();
        
        const idx = bookPart 
            ? BIBLE_DATA.books.findIndex(b => b.n.toLowerCase().includes(bookPart) || b.s.toLowerCase() === bookPart || b.k.toLowerCase() === bookPart)
            : state.bIdx;

        if (idx === -1) return;

        // 更新狀態 (比對是否有變化)
        const s = { bIdx: idx, chap: parseInt(chap), vStart: parseInt(vStart) || 0, vEnd: parseInt(vEnd) || parseInt(vStart) || 0 };
        if (state.bIdx === s.bIdx && state.chap === s.chap && state.vStart === s.vStart && state.vEnd === s.vEnd) return;
        Object.assign(state, s);

        // UI 反饋與歷史紀錄
        updatePreview();
        renderCopyGrid();
        checkAllSelectedVersons();

        const ref = `${BIBLE_DATA.books[idx].n} ${s.chap}${s.vStart > 0 ? ':' + s.vStart + (s.vEnd > s.vStart ? '-' + s.vEnd : '') : ''}`;
        
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { addHistory(ref); showToast(`已定位：${ref}`); }, 1000);
    });

    document.addEventListener('click', (e) => e.target !== input && (sugBox.style.display = 'none'));
}


function renderSuggestionsUI() {
    const sugBox = document.getElementById('suggestions');
    sugBox.innerHTML = state.currentMatches.map((b, i) => `
        <div class="sug-item" 
             style="${i === state.sugCursor ? 'background:var(--accent);color:white;' : ''}"
             onclick="quickFill('${b.s}')">
             📖 ${b.n} (${b.s})
        </div>
    `).join('');
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

function renderHintWindow() {
    // 1. 檢查是否已存在，避免重複渲染
    if (document.getElementById('hintWindow')) return;

    // 2. 動態建立容器
    const hintWindow = document.createElement('div');
    hintWindow.id = 'hintWindow';
    hintWindow.className = 'hint-window';

    // 3. 處理資料與生成內容
    const groups = [...new Set(BIBLE_DATA.books.map(b => b.g))];
    hintWindow.innerHTML = groups.map(g => `
        <div class="hint-group">
            <div class="hint-title">${g}</div>
            <div class="hint-items">
                ${BIBLE_DATA.books
                    .filter(b => b.g === g)
                    .map(b => `<span class="hint-item" onclick="quickFill('${b.s}')">${b.s}</span>`)
                    .join('')}
            </div>
        </div>
    `).join('');

    // 4. 將元素加入到 body 中
    document.body.appendChild(hintWindow);
}


function addHistory(q) {
    if (state.history[0] === q) return;
    state.history = [q, ...state.history.filter(x => x !== q)].slice(0, 10);
    document.getElementById('historyTags').innerHTML = state.history.map(h => `<span class="history-tag" onclick="quickSearch('${h}')">${h}</span>`).join('');
}

function quickFill(s) { 
    const i = document.getElementById('bibleSearch');
    i.value = s + " "; i.focus(); 
    i.dispatchEvent(new Event('input')); 
}

function quickSearch(h) { 
    const i = document.getElementById('bibleSearch');
    i.value = h; i.dispatchEvent(new Event('input')); 
}

function switchMode(m) {
    document.querySelectorAll('.m-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + m).classList.add('active');
    ['copyView', 'previewView', 'specView'].forEach(id => document.getElementById(id).style.display = 'none');
    document.getElementById(m + 'View').style.display = 'block';
    if (m === 'preview') updatePreview();
}

function showToast(m) {
    const t = document.getElementById('toast'); t.innerText = m; t.style.display = 'block';
    setTimeout(() => { t.style.opacity = '1'; }, 10);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => { t.style.display = 'none'; }, 300); }, 2000);
}

function markCardError(verId) {
    const card = document.getElementById(`card-${verId}`);
    if (card) card.classList.add('has-error');
}

function resetCardStatus(verId) {
    const card = document.getElementById(`card-${verId}`);
    if (card) card.classList.remove('has-error');
}

function renderDevSpecs() {
    const data = window.DEV_DATA; // 直接讀取，不需要 fetch
    document.getElementById('promptContent').innerText = data.prompt;
    document.getElementById('checklistContent').innerText = data.checklist;
}
