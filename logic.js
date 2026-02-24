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
    renderFilter(); renderHintWindow(); renderCopyGrid(); renderDevSpecs(); setupSearch();
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
    
    input.addEventListener('keydown', (e) => {
        if (sugBox.style.display === 'block' && state.currentMatches.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.sugCursor = (state.sugCursor + 1) % state.currentMatches.length;
                renderSuggestionsUI();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.sugCursor = (state.sugCursor - 1 + state.currentMatches.length) % state.currentMatches.length;
                renderSuggestionsUI();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const targetIdx = state.sugCursor === -1 ? 0 : state.sugCursor;
                quickFill(state.currentMatches[targetIdx].s);
                sugBox.style.display = 'none';
            }
        }
    });

    input.addEventListener('input', () => {
        const raw = input.value.trim();
        const val = raw.toLowerCase();
        
        if (val.length > 0 && !/^\d+$/.test(raw)) {
            state.currentMatches = BIBLE_DATA.books.filter(b => 
                b.n.includes(val) || b.s.toLowerCase().startsWith(val) || b.k.toLowerCase().startsWith(val)
            ).slice(0, 5);
            
            if (state.currentMatches.length > 0) {
                state.sugCursor = -1;
                renderSuggestionsUI();
                sugBox.style.display = 'block';
            } else sugBox.style.display = 'none';
        } else {
            sugBox.style.display = 'none';
            state.currentMatches = [];
        }

        const regex = /^([1-3]?\s*[a-zA-Z\u4e00-\u9fa5]+)?\s*(\d+)(?:[:\s](\d+)(?:-(\d+))?)?$/i;
        const match = val.match(regex);
        if (match) {
            const bookPart = match[1] ? match[1].replace(/\s/g,'').toLowerCase() : "";
            const idx = bookPart ? BIBLE_DATA.books.findIndex(b => 
                b.n.toLowerCase().includes(bookPart) || b.s.toLowerCase() === bookPart || b.k.toLowerCase() === bookPart
            ) : state.bIdx;

            if (idx !== -1) {
                state.bIdx = idx;
                state.chap = Math.min(parseInt(match[2]), BIBLE_DATA.books[idx].c);
                state.vStart = parseInt(match[3]) || 1;
                state.vEnd = parseInt(match[4]) || state.vStart;
                updatePreview(); 
                
                const ref = `${BIBLE_DATA.books[idx].n}${state.chap}:${state.vStart}${state.vEnd > state.vStart ? '-' + state.vEnd : ''}`;
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => { addHistory(ref); showToast(`已定位：${ref}`); }, 1000); 
            }
        }
    });

    document.addEventListener('click', (e) => { if (e.target !== input) sugBox.style.display = 'none'; });
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
    const ver = BIBLE_DATA.versions.find(v => v.id === verId);
    const ref = `${book.n} ${state.chap}:${state.vStart}${state.vEnd > state.vStart ? '-' + state.vEnd : ''}`;
    if (type === 'title') { await navigator.clipboard.writeText(`${ref} (${ver.n})`); showToast(`已複製標題`); return; }
    
    let text = ""; 
    for (let i = state.vStart; i <= state.vEnd; i++) {
        text += `[${i}] 這是${book.n}${state.chap}章${i}節的${ver.n}內容。\n`;
    }
    await navigator.clipboard.writeText(text.trim());
    showToast(`已複製 ${ver.n} (${state.vStart}-${state.vEnd}節)`);
}

function updatePreview() {
    const vs = document.getElementById('previewVerSelect');
    if (!vs) return;
    const book = BIBLE_DATA.books[state.bIdx];
    const ref = `${book.n} ${state.chap}:${state.vStart}${state.vEnd > state.vStart ? '-' + state.vEnd : ''}`;
    document.getElementById('previewTitle').innerText = ref;
    let html = "";
    for (let i = state.vStart; i <= state.vEnd; i++) {
        html += `<div class="verse-line"><span style="color:var(--accent); font-weight:bold; margin-right:12px;">${i}</span>這是${book.n}${state.chap}:${i}的預覽內容。</div>`;
    }
    document.getElementById('previewContent').innerHTML = html;
}

function renderFilter() {
    document.getElementById('verFilter').innerHTML = `<span class="filter-label">展示譯本：</span>` + BIBLE_DATA.versions.map(v => `
        <label class="check-item"><input type="checkbox" value="${v.id}" ${state.selectedVers.includes(v.id)?'checked':''} onchange="updateSelectedVers()"> ${v.n}</label>
    `).join('');
}

function updateSelectedVers() {
    state.selectedVers = Array.from(document.querySelectorAll('#verFilter input:checked')).map(i => i.value);
    renderCopyGrid();
}

function renderCopyGrid() {
    const activeVers = BIBLE_DATA.versions.filter(v => state.selectedVers.includes(v.id));
    document.getElementById('copyGrid').innerHTML = activeVers.map(v => `
        <div class="ver-card"><span class="ver-name">${v.n}</span><button class="quick-copy-btn" onclick="copyAction('${v.id}', 'full')">⚡ 複製純經文</button><button class="copy-title-btn" onclick="copyAction('${v.id}', 'title')">📋 僅標題</button></div>
    `).join('');
}

function renderHintWindow() {
    const groups = [...new Set(BIBLE_DATA.books.map(b => b.g))];
    document.getElementById('hintWindow').innerHTML = groups.map(g => `
        <div class="hint-group"><div class="hint-title">${g}</div><div class="hint-items">${BIBLE_DATA.books.filter(b => b.g === g).map(b => `<span class="hint-item" onclick="quickFill('${b.s}')">${b.s}</span>`).join('')}</div></div>
    `).join('');
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

function renderDevSpecs() {
    const data = window.DEV_DATA; // 直接讀取，不需要 fetch
    document.getElementById('promptContent').innerText = data.prompt;
    document.getElementById('checklistContent').innerText = data.checklist;
}