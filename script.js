// 各ボタンに紐づくJSONファイルの定義（now.jsonは不要なため削除）
const jsonConfig = {
  '召喚': 'PU.json',
  'イベント': 'events.json'
};

// 読み込まれたすべての生イベントデータ（合体・フィルタ用）
let allFetchedEvents = [];
// 現在のタブやソートに応じて画面に表示すべきイベントデータ
let currentDisplayEvents = [];

// 指定されたJSONファイルからデータを取得する関数
async function fetchEventData(fileName) {
  try {
    const response = await fetch(fileName);
    if (!response.ok) {
      throw new Error(`${fileName} の読み込みに失敗しました（ステータス: ${response.status}）`);
    }
    return await response.json();
  } catch (error) {
    console.error(error);
    throw error;
  }
}

// 日付文字列（"2026/10/01 12:00" など）をDateオブジェクトに変換する関数
function parseDateTime(dateTimeStr) {
  if (!dateTimeStr) return null;
  const match = dateTimeStr.trim().match(/(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (match) {
    const [_, year, month, day, hour, minute] = match;
    const h = hour ? parseInt(hour) : 0;
    const m = minute ? parseInt(minute) : 0;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, m);
  }
  return null;
}

// 期間文字列（"開始 〜 終了"）を解析して [開始Date, 終了Date] を返す関数
function getEventPeriod(dateStr) {
  if (!dateStr) return [new Date(0), new Date(0)];
  
  // あらゆる区切り文字に対応
  const parts = dateStr.split(/[〜\-~]|--/);
  const startDate = parseDateTime(parts[0]);
  const endDate = parts[1] ? parseDateTime(parts[1]) : null;

  const start = startDate ? startDate : new Date(0);
  const end = endDate ? endDate : (startDate ? new Date(startDate.getTime()).setHours(23, 59, 59, 999) : new Date(0));
  
  return [start, new Date(end)];
}

// データを指定された順序（新しい順/古い順）に並び替える関数
function sortEvents(eventList, order) {
  return eventList.sort((a, b) => {
    const dateAStr = a.date || a.period || a.duration || '';
    const dateBStr = b.date || b.period || b.duration || '';
    const [startA] = getEventPeriod(dateAStr);
    const [startB] = getEventPeriod(dateBStr);
    
    if (order === 'old') {
      return startA - startB; // 古い順（昇順）
    } else {
      return startB - startA; // 新しい順（降順）
    }
  });
}

// 詳細HTMLを非同期で読み込んでインライン表示する関数
async function loadDetailHtml(url) {
  const listArea = document.getElementById('main-content-area');
  const viewer = document.getElementById('detail-viewer');
  
  if (!viewer || !listArea) return;

  try {
    console.log(`詳細HTMLを取得中: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ファイルが見つかりません。ファイル名: ${url} (Status: ${response.status})`);
    }
    const htmlText = await response.text();

    // 1. カード一覧エリアとプルダウンの枠（#main-content-area）だけを非表示にする
    listArea.style.display = 'none';

    // 2. 詳細用ビューアーにHTMLを流し込み、一番上に戻るボタンを配置
    viewer.innerHTML = `
      <div style="padding: 15px 0;">
        <button id="back-to-list-btn" class="button" style="margin-left:0;"><i class="bi bi-arrow-left"></i> 一覧に戻る</button>
      </div>
      <div class="detail-body-content">
        ${htmlText}
      </div>
    `;
    viewer.style.display = 'block';
    window.scrollTo(0, 0); // 画面最上部へスクロール

    // 3. 一覧に戻るボタンのクリックイベントを設定
    document.getElementById('back-to-list-btn').addEventListener('click', () => {
      viewer.style.display = 'none';
      listArea.style.display = 'block';
      viewer.innerHTML = ''; // メモリ解放
    });

  } catch (error) {
    console.error(error);
    alert(`詳細画面を開けませんでした。\n\n【原因の可能性】\n${error.message}`);
  }
}

// カードを画面に自動生成する関数
function createCards(eventList) {
  const container = document.getElementById('CardConteiner') || document.getElementById('card-container');
  if (!container) return;

  container.innerHTML = '';

  if (!eventList || eventList.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#888; padding-top: 40px;">該当する情報はありません</p>';
    return;
  }

  eventList.forEach(event => {
    const card = document.createElement('div');
    card.className = 'Card';
    
    card.style.pointerEvents = 'auto';

    const title = event.title || event.name || '無題のイベント';
    const date = event.date || event.period || event.duration || '期間未定';
    const imageUrl = event.imageUrl || event.image || event.img || event.url || 'https://placeholder.com';
    
    const detailId = event.id || event.ID || event.link || encodeURIComponent(title);
    const detailUrl = `events/${detailId}.html`;

    card.innerHTML = `
      <img src="${imageUrl}" alt="${title}" style="pointer-events: none;">
      <div class="Card-text" style="pointer-events: none;">
        <p class="Card-title" style="pointer-events: none;">${title}</p>
        <p class="Card-date" style="pointer-events: none;">${date}</p>
      </div>
      <div class="Card-arrow" style="pointer-events: none;">
        <i class="bi bi-chevron-right" style="pointer-events: none;"></i>
      </div>
    `;

    // カードクリック時に詳細表示関数を確実に実行
    card.addEventListener('click', (e) => {
      e.preventDefault();
      loadDetailHtml(detailUrl);
    });

    container.appendChild(card);
  });
}

// タブ切り替え、データ自動フィルタ、ソートをまとめて制御する
function initTabs() {
  const buttons = document.querySelectorAll('.button-section .button');
  const container = document.getElementById('CardConteiner') || document.getElementById('card-container');
  const sortSelect = document.getElementById('sortOrder');

  // JSON構造が配列で直始まっていなくても自動で中身を引っ張り出す
  function extractArray(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      return data.events || data.PU || data.pu || data.data || Object.values(data).find(Array.isArray) || [];
    }
    return [];
  }

  // アプリ起動時にデータをロードする
  async function loadAllData() {
    if (container) container.innerHTML = '<p style="text-align:center; color:#888; padding-top: 20px;">データを読み込み中...</p>';
    try {
      const [puData, eventsData] = await Promise.all([
        fetchEventData(jsonConfig['召喚']),
        fetchEventData(jsonConfig['イベント'])
      ]);

      const puList = extractArray(puData);
      puList.forEach(e => e.type = '召喚');

      const eventsList = extractArray(eventsData);
      eventsList.forEach(e => e.type = 'イベント');

      // すべてのデータを1つの配列に統合
      allFetchedEvents = [...puList, ...eventsList];

      // 現在「active」が付いているボタンの処理を実行
      const activeButton = document.querySelector('.button-section .button.active');
      if (activeButton) {
        switchTab(activeButton);
      }
    } catch (error) {
      if (container) {
        container.innerHTML = `<p style="color:red; text-align:center; padding-top: 20px;">データの読み込みに失敗しました。JSONファイル名を確認してください。</p>`;
      }
    }
  }

  // タブの切り替えと自動フィルタリング処理
  function switchTab(button) {
    buttons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');

    const key = button.getAttribute('data-json-key');
    const now = new Date(); // 現在の日時

    if (key === '全て') {
      currentDisplayEvents = [...allFetchedEvents];
    } else if (key === '現在') {
      currentDisplayEvents = allFetchedEvents.filter(event => {
        const dateStr = event.date || event.period || event.duration || '';
        const [start, end] = getEventPeriod(dateStr);
        return now >= start && now <= end;
      });
    } else {
      currentDisplayEvents = allFetchedEvents.filter(event => event.type === key);
    }

    const order = sortSelect ? sortSelect.value : 'new';
    const sortedList = sortEvents([...currentDisplayEvents], order);
    createCards(sortedList);
  }

  // 各タブボタンにクリックイベントを紐付け
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const viewer = document.getElementById('detail-viewer');
      const listArea = document.getElementById('main-content-area');
      if (viewer && listArea) {
        viewer.style.display = 'none';
        listArea.style.display = 'block';
      }
      switchTab(button);
    });
  });

  // プルダウンメニュー変更時のイベント設定
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      const order = sortSelect.value;
      const sortedList = sortEvents([...currentDisplayEvents], order);
      createCards(sortedList);
    });
  }

  // アプリ起動時のデータ読み込みを開始
  loadAllData();
}

// 初期化を実行
document.addEventListener('DOMContentLoaded', initTabs);
