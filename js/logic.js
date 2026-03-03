/* logic1.fixed.js — Paragraph title in Times New Roman + underline; copy button only in paragraph mode
 * Author: Ayden & Copilot
 */

// (Keeping the previous complete file body, with only the CSS rule adjusted)



let state = { bIdx: 0, chap: 1, vStart: 1, vEnd: 1, history: [], selectedVers: BIBLE_DATA.versions.filter(v=>v.pinned).map(v=>v.id), sugCursor: -1, currentMatches: [] };
let searchTimer; const bibleCache = new Map(); let fetchStatus = {};

// NEW: debounce 與 refKey（用於淘汰過期請求/渲染）
let debounceTimer = null;           // NEW
let currentRefKey = '';             // NEW

const buildCacheKey=(verId,bookS,chap,vStart,vEnd)=>`${verId}|${bookS}|${chap}|${vStart||0}-${vEnd||0}`;
const getCachedVerses=(verId,bookS,chap,vStart,vEnd)=>bibleCache.get(buildCacheKey(verId,bookS,chap,vStart,vEnd))||null;
const setCachedVerses=(verId,bookS,chap,vStart,vEnd,verses)=>bibleCache.set(buildCacheKey(verId,bookS,chap,vStart,vEnd),verses);
// 你的 Cloudflare Worker 端點（根路徑即可；使用 ?url= 轉發）
const WORKER_ENDPOINT = "https://bible.q8g9tnm8r7.workers.dev";

/**
 * 智慧 CORS 回退：
 * - 先直連 FHL
 * - 若遇到 CORS / 非 JSON / 解析失敗 → 自動改打 Worker
 */
async function fetchWithSmartCORS(targetJsonUrl, { timeoutMs = 10000 } = {}) {
  async function timedFetch(url, init, ms) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  }

  // 1) 直連 FHL
  try {
    const res = await timedFetch(targetJsonUrl, {
      method: "GET",
      headers: { "Accept": "application/json,text/plain;q=0.9,*/*;q=0.8" }
      // 預設 mode='cors'；若被 CORS 擋，通常會拋 TypeError
    }, timeoutMs);

    if (!res.ok) throw new Error(`DirectFetchHTTP${res.status}`);

    const ct = res.headers.get("content-type") || "";
    const looksJson = ct.toLowerCase().includes("application/json") || ct.toLowerCase().includes("text/json");

    const text = (await res.text()).trim();
    if (!looksJson) throw new Error("DirectFetchNonJSON");

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/[\u3000\u000A\u000D]+/g, ' '));
    } catch {
      throw new Error("DirectFetchJSONParseError");
    }
    return parsed;

  } catch (directErr) {
    // 2) 直連失敗 → 走 Worker
    const workerUrl = new URL(WORKER_ENDPOINT);
    workerUrl.searchParams.set("url", targetJsonUrl);

    const res2 = await fetch(workerUrl.toString(), {
      method: "GET",
      headers: { "Accept": "application/json,text/plain;q=0.9,*/*;q=0.8" }
    });

    if (!res2.ok) {
      if (res2.status === 403) throw new Error("Host Not Allowed");
      if (res2.status === 405) throw new Error("Method Not Allowed");
      throw new Error(`HTTP ${res2.status}`);
    }

    const rawText = (await res2.text()).trim();
    if (rawText.startsWith('Fail:')) throw new Error('譯本資料庫 SQL 異常');

    let parsed2;
    try {
      parsed2 = JSON.parse(rawText.replace(/[\u3000\u000A\u000D]+/g, ' '));
    } catch {
      throw new Error("JSON 格式錯誤");
    }
    return parsed2;
  }
}

// NEW: 以目前 passage 形成參考鍵（與 cache 維度一致）
function buildRefKey(bookS, chap, vStart, vEnd) {           // NEW
  return `${bookS}-${chap}-${vStart}-${vEnd}`;
}

document.addEventListener('DOMContentLoaded',()=>{ const savedTheme=localStorage.getItem('bible-theme')||'light'; document.body.setAttribute('data-theme',savedTheme); renderFilter(); const isMobile=/Mobi|Android|iPhone/i.test(navigator.userAgent); if(!isMobile||window.innerWidth>768){ renderHintWindow(); } renderCopyGrid(); renderDevSpecs(); setupSearch(); bindOptionListeners(); ensurePreviewSelectorsAndCopy(); window.addEventListener('keydown',(e)=>{ if(e.altKey&&e.key.toLowerCase()==='s'){ e.preventDefault(); const i=document.getElementById('bibleSearch'); i?.focus(); i?.select(); } if(e.altKey&&e.key.toLowerCase()==='d'){ e.preventDefault(); toggleTheme(); } }); });

function ensurePreviewSelectorsAndCopy(){ let pSelect=document.getElementById('previewVerSelect'); if(!pSelect){ const anchor=document.getElementById('previewHeader')||document.getElementById('previewTitle')||document.body; anchor.insertAdjacentHTML('afterend',`<select id="previewVerSelect"></select>`); pSelect=document.getElementById('previewVerSelect'); } if(!pSelect.__bound){ pSelect.addEventListener('change',updatePreview); pSelect.__bound=true; }
  let fmtSel=document.getElementById('previewFormatSelect'); if(!fmtSel){ pSelect.insertAdjacentHTML('afterend',`<select id="previewFormatSelect" style="margin-left:8px;"><option value="list">標準格式</option><option value="paragraph">講章格式</option></select>`); fmtSel=document.getElementById('previewFormatSelect'); } const savedFmt=localStorage.getItem('preview-format')||'list'; if(fmtSel.value!==savedFmt) fmtSel.value=savedFmt; if(!fmtSel.__bound){ fmtSel.addEventListener('change',()=>{ localStorage.setItem('preview-format',fmtSel.value); updateCopyButtonVisibility(fmtSel.value); updatePreview(); }); fmtSel.__bound=true; }
  ensureParagraphSingleColumnStyle(); let copyBtn=document.getElementById('previewCopyBtn'); if(!copyBtn){ fmtSel.insertAdjacentHTML('afterend',`<button id="previewCopyBtn" style="margin-left:8px;">📋 一鍵複製</button>`); copyBtn=document.getElementById('previewCopyBtn'); } if(!copyBtn.__bound){ copyBtn.addEventListener('click',copyCurrentPreview); copyBtn.__bound=true; } updatePreviewVersionOptions(); updateCopyButtonVisibility(fmtSel.value); }

function updateCopyButtonVisibility(fmt){ const btn=document.getElementById('previewCopyBtn'); if(!btn) return; btn.style.display=(fmt==='paragraph')?'':'none'; }

function ensureParagraphSingleColumnStyle(){ if(document.getElementById('preview-paragraph-style')) return; const css=`
  .preview-paragraph{font-family:"DFKai-SB","BiauKai","KaiTi","STKaiti",serif;font-size:16px;line-height:2.0;letter-spacing:.5px;word-break:break-all;white-space:normal;text-align:justify;max-width:760px;margin-inline:auto}
  .preview-paragraph .quote-open{margin-right:4px}
  .preview-paragraph .quote-close{margin-left:4px}
  .preview-paragraph sup.vnum{font-size:.75em;line-height:1;vertical-align:super;margin-right:2px}
  /* Title: Times New Roman + underline */
  .preview-paragraph .preview-paragraph-title{margin-left:6px;font-weight:600;font-family:'Times New Roman',Times,serif;text-decoration:underline}
`; const style=document.createElement('style'); style.id='preview-paragraph-style'; style.textContent=css; document.head.appendChild(style); }

function toggleTheme(){ const target=document.body.getAttribute('data-theme')==='dark'?'light':'dark'; document.body.setAttribute('data-theme',target); localStorage.setItem('bible-theme',target); showToast(`模式：${target==='dark'?'深色':'淺色'}`); }

function hasCacheFor(verId){ const book=BIBLE_DATA.books[state.bIdx]; if(!book) return false; const cached=getCachedVerses(verId,book.s,state.chap,state.vStart,state.vEnd); return !!(cached&&cached.length); }
function updatePreviewVersionOptions(){ const pSelect=document.getElementById('previewVerSelect'); if(!pSelect) return null; const book=BIBLE_DATA.books[state.bIdx]; if(!book) return null; const before=pSelect.value; const avail=BIBLE_DATA.versions.filter(v=>state.selectedVers.includes(v.id)).filter(v=>hasCacheFor(v.id)); const html=avail.map(v=>`<option value="${v.id}">${v.n}</option>`).join(''); pSelect.innerHTML=html||`<option value="" disabled>尚未有可預覽的譯本</option>`; pSelect.value=avail.some(v=>v.id===before)?before:(avail[0]?.id||''); return pSelect.value||null; }

function bindOptionListeners(){ const godBox=document.getElementById('checkboxGodName')||document.getElementById('shen'); if(godBox&&!godBox.__bound){ godBox.addEventListener('change',rerenderWithGodNamePreference); godBox.__bound=true; } const scBox=document.getElementById('checkboxSimplifiedChinese'); if(scBox&&!scBox.__bound){ scBox.addEventListener('change',()=>{ invalidateCacheForCurrentPassage(); updatePreviewVersionOptions(); startQuery(); }); scBox.__bound=true; } const pSelect=document.getElementById('previewVerSelect'); if(pSelect&&!pSelect.__bound){ pSelect.addEventListener('change',updatePreview); pSelect.__bound=true; }}

function invalidateCacheForCurrentPassage(){ const book=BIBLE_DATA.books?.[state.bIdx]; if(!book) return; const keySuffix=`|${book.s}|${state.chap}|${state.vStart||0}-${state.vEnd||0}`; for(const key of Array.from(bibleCache.keys())){ if(key.endsWith(keySuffix)) bibleCache.delete(key); } const statusSuffix=`${book.s}-${state.chap}-${state.vStart}-${state.vEnd}`; for(const k of Object.keys(fetchStatus)){ if(k.endsWith(statusSuffix)) delete fetchStatus[k]; } }

// CHANGED: startQuery 也帶 refKey，避免競態（例如切換簡/繁或勾選版本後）
function startQuery(){ const input=document.getElementById('bibleSearch'); const hasText=!!input?.value?.trim(); if(hasText){ input.dispatchEvent(new Event('input',{bubbles:true})); } const book=BIBLE_DATA.books?.[state.bIdx]; if(!book||!Number.isInteger(state.chap)) return;
  // 產生並設定最新 refKey
  currentRefKey = buildRefKey(book.s, state.chap, state.vStart, state.vEnd); // NEW
  updatePreviewVersionOptions();
  updatePreviewWithRefKey(currentRefKey); // NEW
  renderCopyGrid();
  checkAllSelectedVersons(true, null, currentRefKey);      // NEW
  const ref=`${book.n} ${state.chap}${state.vStart>0?':'+state.vStart+(state.vEnd>state.vStart?'-'+state.vEnd:''):''}`;
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{ addHistory(ref); showToast(`已定位：${ref}`); },300);
}

function setupSearch(){ const input=document.getElementById('bibleSearch'); const sugBox=document.getElementById('suggestions'); if(!input) return;
  input.addEventListener('keydown',(e)=>{ const {currentMatches:matches,sugCursor:cursor}=state; if(sugBox.style.display!=='block'||!matches.length) return; const keys={ArrowDown:()=>state.sugCursor=(cursor+1)%matches.length,ArrowUp:()=>state.sugCursor=(cursor-1+matches.length)%matches.length,Enter:()=>{ quickFill(matches[Math.max(0,cursor)].s); sugBox.style.display='none'; }}; if(keys[e.key]){ e.preventDefault(); keyse.key; renderSuggestionsUI(); } });
  input.addEventListener('input',()=>{ const raw=input.value; const INVIS_WS=/[\u200B-\u200D\u2060\u00A0\u180E\u202F\u205F\u3000]/g; const NORM=raw.replace(INVIS_WS,'').replace(/\s+/g,' ').replace(/[\uFF1A:]/g,':').replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFF0D-]/g,'-').trim(); const val=NORM.toLowerCase(); const isNumeric=/^\d+$/.test(NORM);
    state.currentMatches=(val&&!isNumeric)?BIBLE_DATA.books.filter(b=>b.n.includes(val)||b.s.toLowerCase().startsWith(val)||b.k.toLowerCase().startsWith(val)).slice(0,5):[];
    sugBox.style.display=state.currentMatches.length?'block':'none'; if(state.currentMatches.length){ state.sugCursor=-1; renderSuggestionsUI(); }
    const regex=/^([1-3]?\s*[a-zA-Z\u4e00-\u9fa5]+)?\s*(\d+)(?:(?::|\s)(\d+)(?:-(\d+))?)?$/i; const match=val.match(regex); if(!match) return;
    const [_,bookPartRaw,chap,vStart,vEnd]=match; const bookPart=bookPartRaw?.replace(/\s/g,'').toLowerCase(); const idx=bookPart?BIBLE_DATA.books.findIndex(b=> b.n.toLowerCase().includes(bookPart)||b.s.toLowerCase()===bookPart||b.k.toLowerCase()===bookPart):state.bIdx; if(idx===-1) return;
    const s={ bIdx:idx, chap:parseInt(chap,10), vStart:parseInt(vStart,10)||0, vEnd:parseInt(vEnd,10)||parseInt(vStart,10)||0 };
    if(state.bIdx===s.bIdx&&state.chap===s.chap&&state.vStart===s.vStart&&state.vEnd===s.vEnd) return;

    // 立即更新 state（保留即時性）
    Object.assign(state,s);

    // 生成並記錄新的查詢 refKey
    const book=BIBLE_DATA.books[state.bIdx];                 // NEW
    currentRefKey = buildRefKey(book.s, state.chap, state.vStart, state.vEnd); // NEW

    // Debounce：延遲 300ms 後才進行昂貴操作（抓取 / 渲染）
    clearTimeout(debounceTimer);                             // NEW
    debounceTimer = setTimeout(()=>{                         // NEW
      updatePreviewVersionOptions();
      updatePreviewWithRefKey(currentRefKey);               // NEW：只在 refKey 仍是最新時渲染
      renderCopyGrid();
      checkAllSelectedVersons(true, null, currentRefKey);   // NEW：帶入 refKey，淘汰過期請求
      const ref=`${BIBLE_DATA.books[idx].n} ${s.chap}${s.vStart>0?':'+s.vStart+(s.vEnd>s.vStart?'-'+s.vEnd:''):''}`;
      clearTimeout(searchTimer);
      searchTimer=setTimeout(()=>{ addHistory(ref); showToast(`已定位：${ref}`); },500);
    }, 300); // 調整成你覺得最順的延遲（建議 250~400ms）
  });
  document.addEventListener('click',(e)=> e.target!==input && (sugBox.style.display='none'));
}

function renderSuggestionsUI(){ const sugBox=document.getElementById('suggestions'); sugBox.innerHTML=state.currentMatches.map((b,i)=>`<div class=\"sug-item\" style=\"${i===state.sugCursor?'background:var(--accent);color:white;':''}\" onclick=\"quickFill('${b.s}')\">📖 ${b.n} (${b.s})</div>`).join(''); }

function rerenderWithGodNamePreference(){ updatePreview(); renderCopyGrid(); showToast('已套用神名偏好'); }
function applyGodNamePreferenceToVerses(verses){ const isShen=document.getElementById('checkboxGodName')?.checked||document.getElementById('shen')?.checked; if(!isShen) return verses; return verses.map(v=>({sec:v.sec,text:v.text.replace(/上帝/g,'神')})); }

function toChineseNum(num){ const chinese=["零","一","二","三","四","五","六","七","八","九","十"]; if(num<=10) return chinese[num]; if(num<20) return "十"+(num%10===0?"":chinese[num%10]); if(num<100){ let t=Math.floor(num/10),u=num%10; return chinese[t]+"十"+(u===0?"":chinese[u]); } let h=Math.floor(num/100),remainder=num%100; let t=Math.floor(remainder/10),u=remainder%10; return chinese[h]+"百"+(t===0&&u!==0?"零":"")+(t!==0?chinese[t]+"十":"")+(u!==0?chinese[u]:""); }

async function copyCurrentPreview(){ const previewSelect=document.getElementById('previewVerSelect'); const fmtSelect=document.getElementById('previewFormatSelect'); const verId=previewSelect?.value; if(!verId){ showToast('沒有可複製的預覽內容'); return; } const book=BIBLE_DATA.books[state.bIdx]; const cached=getCachedVerses(verId,book.s,state.chap,state.vStart,state.vEnd); if(!cached||!cached.length){ showToast('尚未有預覽內容'); return; } const verses=applyGodNamePreferenceToVerses(cached); const chapChinese=toChineseNum(state.chap); const versePart=state.vStart===0?'':(state.vStart+(state.vEnd>state.vStart?'-'+state.vEnd:'')); const versionMap=Object.fromEntries(BIBLE_DATA.versions.map(v=>[v.id,v.n])); const versionName=versionMap[verId]||verId; const fullTitle=`${book.s}${chapChinese}${versePart?versePart:''}(${versionName})`; let text; const fmt=(fmtSelect&&fmtSelect.value)||'list'; if(fmt==='paragraph'){ const body=verses.map(v=>`${v.sec}${v.text.replace(/─/g,'——')}`).join(''); text=`「${body}」 ${fullTitle}`; } else { const maxDigits=Math.max(...verses.map(v=>String(v.sec).length)); const lines=verses.map(v=>`${String(v.sec).padStart(maxDigits,' ')} ${v.text.replace(/─/g,'——')}`); text=lines.join('\n'); } if(navigator.clipboard&&window.ClipboardItem){ try{ const blob=new Blob([text],{type:'text/plain'}); const item=new ClipboardItem({'text/plain':blob}); await navigator.clipboard.write([item]); showToast('已複製'); return; }catch(e){} } try{ const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('已複製 (備案)'); }catch{ showToast('複製失敗，請手動複製'); } }

function renderPreviewAsList(prevContent,verses){ const maxDigits=Math.max(...verses.map(v=>String(v.sec).length)); const vnumWidthCh=Math.max(2,Math.min(4,maxDigits))+"ch"; const rows=verses.map(v=>`<div class=\"vnum\">${v.sec}</div><div class=\"vtext\">${v.text}</div>`).join(''); prevContent.innerHTML=`<div class=\"preview-list\" style=\"--vnumw:${vnumWidthCh}\">${rows}</div>`; }

function renderPreviewAsParagraph(prevContent,verses,fullTitle,opts={useShen:false}){ let html=`<span class=\"quote-open\">「</span>`; const fragments=verses.map(v=>{ let t=v.text; if(opts.useShen) t=t.replace(/上帝/g,'神'); t=t.replace(/─/g,'——'); return `<sup class=\"vnum\">${v.sec}</sup>${t}`; }); html+=fragments.join(''); html+=`<span class=\"quote-close\">」</span>`; prevContent.innerHTML=`<div class=\"preview-paragraph\">${html} <span class=\"preview-paragraph-title\">${fullTitle}</span></div>`; }

// NEW: 只有在 refKey 仍等於最新的 currentRefKey 時才真正渲染
function updatePreviewWithRefKey(refKey) {                 // NEW
  if (refKey && refKey !== currentRefKey) return;
  updatePreview();
}

async function updatePreview(){ const prevContent=document.getElementById('previewContent'); const prevTitle=document.getElementById('previewTitle'); const fmtSel=document.getElementById('previewFormatSelect'); const pSelect=document.getElementById('previewVerSelect'); if(!prevContent||!BIBLE_DATA) return; const currentVer=updatePreviewVersionOptions(); const fmt=(fmtSel&&fmtSel.value)||localStorage.getItem('preview-format')||'list'; if(prevTitle) prevTitle.style.display=(fmt==='list')?'':'none'; if(prevTitle&&fmt==='list'){ const book=BIBLE_DATA.books[state.bIdx]; const rangeStr=state.vStart===0?"":`:${state.vStart}${state.vEnd>state.vStart?'-'+state.vEnd:''}`; prevTitle.innerText=`${book.n} ${state.chap}${rangeStr}`; } updateCopyButtonVisibility(fmt); prevContent.innerHTML=`<div style=\"padding:40px; text-align:center;\"><div class=\"loading-spinner\">⏳</div></div>`; if(!currentVer){ prevContent.innerHTML=`<div style=\"padding:20px; color:var(--muted);\">尚未有可預覽的譯本，請先在上方搜尋欄定位或勾選譯本後抓取</div>`; return; } const book=BIBLE_DATA.books[state.bIdx]; const cached=getCachedVerses(currentVer,book.s,state.chap,state.vStart,state.vEnd); if(!cached||!cached.length){ prevContent.innerHTML=`<div style=\"padding:20px; color:var(--muted);\">尚未快取本段落</div>`; return; } const verses=applyGodNamePreferenceToVerses(cached); const chapChinese=toChineseNum(state.chap); const versePart=state.vStart===0?'':(state.vStart+(state.vEnd>state.vStart?'-'+state.vEnd:'')); const versionMap=Object.fromEntries(BIBLE_DATA.versions.map(v=>[v.id,v.n])); const versionName=versionMap[currentVer]||currentVer; const fullTitle=`${book.s}${chapChinese}${versePart?versePart:''}(${versionName})`; if(fmt==='paragraph'){ const useShen=document.getElementById('checkboxGodName')?.checked; renderPreviewAsParagraph(prevContent,verses,fullTitle,{useShen}); } else { renderPreviewAsList(prevContent,verses); } }

function renderFilter(){ const box=document.getElementById('verFilter'); if(!box) return; const sortedVersions=BIBLE_DATA.getSortedVersions(); box.innerHTML=`<span class=\"filter-label\">選擇展示譯本：</span>`+sortedVersions.map(v=>`<label class=\"check-item ${v.pinned?'is-pinned':''}\"><input type=\"checkbox\" value=\"${v.id}\" ${state.selectedVers.includes(v.id)?'checked':''} onchange=\"updateSelectedVers()\">${v.pinned?'📌':''}${v.n}</label>`).join(''); }

function updateSelectedVers(){ const before=new Set(state.selectedVers); const checkedIds=Array.from(document.querySelectorAll('#verFilter input:checked')).map(i=>i.value); const currentStr=[...state.selectedVers].sort().join(','); const nextStr=[...checkedIds].sort().join(','); if(currentStr===nextStr) return; state.selectedVers=BIBLE_DATA.getSortedVersions().map(v=>v.id).filter(id=>checkedIds.includes(id)); const after=new Set(state.selectedVers); const addedIds=[...after].filter(id=>!before.has(id)); renderCopyGrid();
  if(addedIds.length){
    // NEW：若需要抓取，帶入 currentRefKey 保障正確性
    checkAllSelectedVersons(true,addedIds,currentRefKey);   // NEW
  } else {
    checkAllSelectedVersons(false);
  }
  updatePreviewVersionOptions();
}

function renderCopyGrid(){ const grid=document.getElementById('copyGrid'); if(!grid) return; const book=BIBLE_DATA.books[state.bIdx]; const currentParams=`${book.s}-${state.chap}-${state.vStart}-${state.vEnd}`; const activeVers=BIBLE_DATA.versions.filter(v=>state.selectedVers.includes(v.id)); grid.innerHTML=activeVers.map(v=>{ const statusKey=`${v.id}-${currentParams}`; const isFailed=fetchStatus[statusKey]==='failed'; const hasCache=!!getCachedVerses(v.id,book.s,state.chap,state.vStart,state.vEnd); return `<div class=\"ver-card ${isFailed?'is-error':''}\" id=\"card-${v.id}\" data-ready=\"${hasCache?'1':'0'}\"><div class=\"ver-info\"><span class=\"ver-name\">${v.n}</span><span class=\"status-dot\"></span></div><div class=\"card-btns\"><button class=\"quick-copy-btn\" onclick=\"copyAction('${v.id}','full')\">⚡ 複製經文</button><button class=\"copy-title-btn\" onclick=\"copyAction('${v.id}','title')\">📋 僅標題</button></div><div class=\"error-msg\" style=\"${isFailed?'display: block;':'display: none;'}\">⚠️ 抓取失敗</div></div>`; }).join(''); }

// 直接改寫 fetchBibleData（保留你原本的 refKey、processFhlData 等）
async function fetchBibleData(verId, bookName, chap, vStart, vEnd, refKey = null) {
  const card = document.getElementById(`card-${verId}`);
  if (card) resetCardStatus(verId);

  if (refKey && refKey !== currentRefKey) {
    return Promise.reject('過期請求（已有新查詢）');
  }

  // 組你既有的參數（但不再拼 FHL URL）
  const gb = document.getElementById('checkboxSimplifiedChinese')?.checked ? 1 : 0;
  const sec = (vStart === 0) ? "" : ((vStart === vEnd) ? String(vStart) : `${vStart}-${vEnd}`);

  const payload = {
    version: verId,
    chineses: bookName, // 直接傳中文書名，Worker 會 encode
    chap: chap,
    sec: sec,           // "" | "1" | "1-5"
    gb: gb,
    strong: 0
  };

  try {
    // 用 POST 避免參數曝露在網址
    const res = await fetch(`${WORKER_ENDPOINT}/qb`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      if (card) markCardError(verId);
      if (res.status === 403) throw new Error("Host Not Allowed");
      if (res.status === 405) throw new Error("Method Not Allowed");
      throw new Error(`HTTP ${res.status}`);
    }

    const rawText = (await res.text()).trim();
    if (refKey && refKey !== currentRefKey) {
      return Promise.reject('過期結果（已有新查詢）');
    }

    if (rawText.startsWith('Fail:')) {
      if (card) markCardError(verId);
      throw new Error('譯本資料庫 SQL 異常');
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/[\u3000\u000A\u000D]+/g, ' '));
    } catch {
      if (card) markCardError(verId);
      throw new Error('JSON 格式錯誤');
    }

    if (!parsed.record || parsed.record.length === 0) {
      if (card) markCardError(verId);
      throw new Error('查無資料');
    }

    return processFhlData(parsed);

  } catch (err) {
    if (card) markCardError(verId);
    if (err.name === 'AbortError') {
      throw new Error('網路逾時');
    }
    throw err; // 交給上層既有的 UI/Toast 處理
  }
}

function processFhlData(data){ return data.record.map(r=>{ let text=r.bible_text; text=text.replace(/<h[1-6]>.*?<\/h[1-6]>/g,''); const sepIndex=text.indexOf("|\uff09"); if(sepIndex!==-1){ text=text.substring(sepIndex+2); } text=text.replace(/<[^>]*>/g,''); text=text.replace(/【[^】]*】/g,''); text=text.replace(/─/g,'——'); text=text.replace(/[\u00A0\u200B-\u200D\u2060\u202F\u205F\u3000]/g,' '); text=text.replace(/\s+/g,' ').trim(); text=text.replace(/([，。；：！？、）】》])\s+/g,'$1'); text=text.replace(/\s+([（《【「『])/g,'$1'); text=text.replace(/（\s+/g,'（').replace(/\s+）/g,'）').replace(/《\s+/g,'《').replace(/\s+》/g,'》').replace(/【\s+/g,'【').replace(/\s+】/g,'】').replace(/「\s+/g,'「').replace(/\s+」/g,'」').replace(/『\s+/g,'『').replace(/\s+』/g,'』'); return {sec:r.sec,text}; }); }

// CHANGED: 支援 refKey；在循環與 await 回來點都會檢查是否過期
async function checkAllSelectedVersons(isSearch=false,onlyIds=null,refKey=null){ const book=BIBLE_DATA.books[state.bIdx]; const currentParams=`${book.s}-${state.chap}-${state.vStart}-${state.vEnd}`; const targetVerIds=Array.isArray(onlyIds)&&onlyIds.length?onlyIds:state.selectedVers.slice();
  for(const verId of targetVerIds){
    if (refKey && refKey !== currentRefKey) return; // NEW：若已過期，整個流程立即終止
    const statusKey=`${verId}-${currentParams}`;
    if(!isSearch){ renderCopyGrid(); continue; }
    const cached=getCachedVerses(verId,book.s,state.chap,state.vStart,state.vEnd);
    if(cached&&cached.length){
      if(fetchStatus[statusKey]==='failed') delete fetchStatus[statusKey];
      renderCopyGrid(); updatePreviewVersionOptions(); const pSel=document.getElementById('previewVerSelect'); if(pSel&&pSel.value===verId){ updatePreviewWithRefKey(refKey||currentRefKey); } continue;
    }
    try{
      const verses=await fetchBibleData(verId,book.s,state.chap,state.vStart,state.vEnd,refKey); // NEW：帶 refKey
      if (refKey && refKey !== currentRefKey) { // NEW：回來後再檢查
        continue; // 丟棄過期結果
      }
      setCachedVerses(verId,book.s,state.chap,state.vStart,state.vEnd,verses);
      if(fetchStatus[statusKey]==='failed') delete fetchStatus[statusKey];
      renderCopyGrid(); updatePreviewVersionOptions(); const pSel=document.getElementById('previewVerSelect'); if(pSel&&pSel.value===verId){ updatePreviewWithRefKey(refKey||currentRefKey); }
    }catch(err){
      fetchStatus[statusKey]='failed'; console.warn(`[AutoCheck] ${verId} 失敗: ${err}`); renderCopyGrid();
    }
  }
}

function renderHintWindow(){ const groups=[...new Set(BIBLE_DATA.books.map(b=>b.g))]; const el=document.getElementById('hintWindow'); if(!el) return; el.innerHTML=groups.map(g=>`<div class=\"hint-group\"><div class=\"hint-title\">${g}</div><div class=\"hint-items\">${BIBLE_DATA.books.filter(b=>b.g===g).map(b=>`<span class=\"hint-item\" onclick=\"quickFill('${b.s}')\">${b.s}</span>`).join('')}</div></div>`).join(''); }
function addHistory(q){ if(state.history[0]===q) return; state.history=[q,...state.history.filter(x=>x!==q)].slice(0,10); const el=document.getElementById('historyTags'); if(!el) return; el.innerHTML=state.history.map(h=>`<span class=\"history-tag\" onclick=\"quickSearch('${h}')\">${h}</span>`).join(''); }
function quickFill(s){ const i=document.getElementById('bibleSearch'); if(!i) return; i.value=s+" "; i.focus(); i.dispatchEvent(new Event('input',{bubbles:true})); }
function quickSearch(h){ const i=document.getElementById('bibleSearch'); if(!i) return; i.value=h; i.dispatchEvent(new Event('input',{bubbles:true})); }
function switchMode(m){ document.querySelectorAll('.m-tab').forEach(t=>t.classList.remove('active')); document.getElementById('tab-'+m)?.classList.add('active'); ['copyView','previewView','specView'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; }); const show=document.getElementById(m+'View'); if(show) show.style.display='block'; if(m==='preview') updatePreview(); }
function showToast(m){ const t=document.getElementById('toast'); if(!t) return; t.innerText=m; t.style.display='block'; setTimeout(()=>{ t.style.opacity='1'; },10); setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>{ t.style.display='none'; },300); },2000); }
function markCardError(verId){ const card=document.getElementById(`card-${verId}`); if(card) card.classList.add('has-error'); }
function resetCardStatus(verId){ const card=document.getElementById(`card-${verId}`); if(card) card.classList.remove('has-error'); }
function renderDevSpecs(){ const data=window.DEV_DATA||{}; const p=document.getElementById('TodolistContent'); const c=document.getElementById('checklistContent'); if(p) p.innerText=data.Todolist||''; if(c) c.innerText=data.checklist||''; }

async function copyAction(verId,type){ const book=BIBLE_DATA.books[state.bIdx]; const chapChinese=toChineseNum(state.chap); const versePart=state.vStart===0?'':(state.vStart+(state.vEnd>state.vStart?'-'+state.vEnd:'')); const shortRef=`${book.s}${chapChinese}${versePart}`; const versionMap=Object.fromEntries(BIBLE_DATA.versions.map(v=>[v.id,v.n])); const cached=getCachedVerses(verId,book.s,state.chap,state.vStart,state.vEnd); if(type!=='title'&&(!cached||!cached.length)){ showToast('尚未搜尋或未快取該譯本'); return; } const verses=type==='title'?[]:applyGodNamePreferenceToVerses(cached); const buildText=()=>{ if(type==='title'){ const versionName=versionMap[verId]||verId; return `${shortRef} (${versionName})`; } const maxDigits=Math.max(...verses.map(v=>String(v.sec).length)); return verses.map(v=>`${String(v.sec).padStart(maxDigits,' ')} ${v.text}`).join('\n'); }; if(navigator.clipboard&&window.ClipboardItem){ try{ const blob=new Blob([buildText()],{type:'text/plain'}); const item=new ClipboardItem({'text/plain':blob}); await navigator.clipboard.write([item]); showToast('已複製'); return; }catch(e){} } try{ const ta=document.createElement('textarea'); ta.value=buildText(); ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('已複製 (備案)'); }catch{ showToast('複製失敗'); } }

function normalizeVersions(rawVersions){ if(!Array.isArray(rawVersions)) return []; const enIds=new Set(["kjv","niv","nasb","asv","bbe","web","erv"]); const originalIds=new Set(["cbol","fhlwh"]); return rawVersions.map((v,idx)=>{ const isObj=v&&typeof v==='object'; const id=(isObj?(v.id||v.k||v.s):v)||""; const name=(isObj?(v.n||v.name):v)||""; let lang=isObj?v.lang:null; if(!lang){ if(originalIds.has(id.toLowerCase())) lang='original'; else if(enIds.has(id.toLowerCase())) lang='en'; else lang='zh'; } return {id,n:name,pinned:!!(isObj&&v.pinned),lang,type:(isObj&&v.type)?v.type:'modern',__origIndex:idx}; }); }
function getSortedVersions(data){ const src=(data&&Array.isArray(data.versions))?data.versions:[]; const normalized=normalizeVersions(src); const langRank={zh:0,en:1,original:2}; return normalized.slice().sort((a,b)=>{ if((a.pinned?1:0)!==(b.pinned?1:0)) return (b.pinned?1:0)-(a.pinned?1:0); const ar=(langRank[a.lang]!==undefined)?langRank[a.lang]:3; const br=(langRank[b.lang]!==undefined)?langRank[b.lang]:3; if(ar!==br) return ar-br; const ai=(typeof a.__origIndex==='number')?a.__origIndex:0; const bi=(typeof b.__origIndex==='number')?b.__origIndex:0; return ai-bi; }).map(v=>{ const {__origIndex,...rest}=v; return rest; }); }
BIBLE_DATA.getSortedVersions=function(){ return getSortedVersions(BIBLE_DATA); };
