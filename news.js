/**
 * THE YUKI TIMES - NEWS PAGE
 * Vintage Newspaper Style
 */

// ============================================
// STATE
// ============================================

const STATE = {
    news: [],
    predictions: [],
    marketData: [],
    lastUpdate: null,
    isLoading: false,
    firebaseInitialized: false,
    hasLoadedOnce: false
};

// 24 hours in milliseconds
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

// ============================================
// 24-HOUR NEWS EXPIRATION SYSTEM
// ============================================

/**
 * Clean news older than 24 hours from localStorage
 * BUT KEEP THEM IN DOM (for infinite scroll history)
 * Returns ALL news (including old ones for display)
 */
function cleanOldNews() {
    const allNews = JSON.parse(localStorage.getItem('allNews') || '[]');
    const now = Date.now();

    // Mark news as old but DON'T REMOVE THEM
    allNews.forEach(news => {
        const newsTime = news.timestamp || new Date(news.date).getTime();
        const ageHours = (now - newsTime) / (60 * 60 * 1000);
        news.ageHours = ageHours;
        news.isOld = ageHours >= 24;
    });

    // For localStorage, keep only recent ones (24h)
    const recentNews = allNews.filter(news => !news.isOld);
    localStorage.setItem('allNews', JSON.stringify(recentNews));

    const removed = allNews.length - recentNews.length;
    if (removed > 0) {
        console.log(`🧹 Cleaned ${removed} old news (>24h) from localStorage. BUT keeping in DOM for history!`);
    }

    // Return ALL news (including old) for rendering
    // This creates the infinite scroll effect
    return allNews;
}

/**
 * Save news with timestamp
 * New news goes to the TOP (most recent first)
 */
function saveNews(newNews) {
    // First clean old news
    let allNews = cleanOldNews();

    // Add new news at the BEGINNING (most recent first)
    newNews.forEach(news => {
        const exists = allNews.find(n => n.title === news.title);
        if (!exists) {
            news.timestamp = Date.now(); // IMPORTANT: always add timestamp
            allNews.unshift(news);
        }
    });

    localStorage.setItem('allNews', JSON.stringify(allNews));
    return allNews;
}

/**
 * Format how old the news is
 */
function formatNewsAge(timestamp) {
    if (!timestamp) return '';

    const now = Date.now();
    const diff = now - timestamp;
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const minutes = Math.floor(diff / (60 * 1000)) % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ago`;
    }
    return `${minutes}m ago`;
}

// Yuki quotes for the sidebar
const YUKI_QUOTES = [
    "Strength and discipline forge success. Stay strong, stay loyal.",
    "In the crypto jungle, only the pack survives together.",
    "Patience is the warrior's greatest weapon.",
    "True strength shows in restraint, not aggression.",
    "My portfolio is built on solid foundations and iron will.",
    "The rising sun reminds me of growth charts.",
    "Strategy is like a samurai's sword: precision is everything.",
    "A wise warrior knows when to pounce and when to hold.",
    "The dojo of crypto requires discipline and focus.",
    "Community is strength. Together we are unstoppable."
];

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 News page initializing...');

    // Show initial loading state
    STATE.isLoading = true;
    renderNewsLoading();

    // Initialize Firebase listeners FIRST (highest priority)
    initFirebaseListeners();

    // Setup UI elements
    updateDate();
    updateWeather();
    setRandomQuote();
    initRefreshButton();
    initCrossTabSync();

    // Clean old news (>24h) on page load
    cleanOldNews();

    // Wait a bit for Firebase to respond (200ms)
    await new Promise(resolve => setTimeout(resolve, 200));

    // If Firebase hasn't loaded yet, try loading from localStorage and APIs
    if (!STATE.hasLoadedOnce) {
        console.log('⏳ Firebase taking time, loading from localStorage and APIs...');
        await loadAllContent();
    } else {
        console.log('✅ Firebase loaded news successfully');
    }

    updateNewsCount();
    STATE.isLoading = false;

    console.log('✅ News page initialization complete');
});

// Clean old news every 5 minutes
setInterval(cleanOldNews, 5 * 60 * 1000);

// ============================================
// FIREBASE REAL-TIME LISTENERS
// ============================================

function initFirebaseListeners() {
    // Check if FirebaseDB is available
    if (typeof FirebaseDB === 'undefined') {
        console.log('Firebase not available, using localStorage');
        STATE.firebaseInitialized = false;
        return;
    }

    // Initialize Firebase
    FirebaseDB.init();
    STATE.firebaseInitialized = true;

    // Listen to news updates from Firebase
    FirebaseDB.listenToNews((items) => {
        console.log('📡 Firebase: News updated', items.length, 'items');

        if (items && items.length > 0) {
            // Mark that we've received data from Firebase
            STATE.hasLoadedOnce = true;
            STATE.combinedNews = items;

            // Also save to localStorage for offline access
            localStorage.setItem('allNews', JSON.stringify(items));

            renderNews();
            updateNewsCount();

            console.log('✅ News rendered from Firebase');
        } else {
            console.log('⚠️ Firebase returned empty news array');
        }
    });

    // Listen to status/weather updates from Firebase
    FirebaseDB.listenToStatus((status) => {
        console.log('Firebase: Status updated');
        if (status.temp) localStorage.setItem('arcticTemp', status.temp);
        if (status.ice) localStorage.setItem('arcticIce', status.ice);
        if (status.snow) localStorage.setItem('arcticSnow', status.snow);
        if (status.aurora) localStorage.setItem('arcticAurora', status.aurora);
        updateWeather();
    });

    console.log('✅ Firebase listeners initialized for news page');
}

// ============================================
// CROSS-TAB SYNC (with main page)
// ============================================

function initCrossTabSync() {
    // When localStorage changes in another tab, update newspaper
    window.addEventListener('storage', (e) => {
        if (e.key === 'allNews') {
            console.log('📰 News updated in another tab, refreshing...');
            loadAllContent();
            updateNewsCount();
        }
    });

    // Update when tab gains focus
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            console.log('📰 Tab visible, checking for updates...');
            // Clean old news when tab becomes visible
            cleanOldNews();
            loadAllContent();
            updateNewsCount();
        }
    });
}

// Load news from localStorage (synced with main page)
// Cleans old news (>24h) first
function loadNewsFromStorage() {
    try {
        // Clean old news before loading
        const allNews = cleanOldNews();
        console.log(`📰 Loaded ${allNews.length} items from localStorage (after 24h cleanup)`);
        return allNews;
    } catch (e) {
        console.error('❌ Error loading news from localStorage:', e);
        return [];
    }
}

// Sort news by timestamp (newest first)
function sortByRecent(news) {
    return news.sort((a, b) => {
        const timeA = a.timestamp || new Date(a.date).getTime() || 0;
        const timeB = b.timestamp || new Date(b.date).getTime() || 0;
        return timeB - timeA;
    });
}

// Remove duplicate news by title
function removeDuplicateNews(news) {
    const seen = new Set();
    return news.filter(item => {
        const key = item.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ============================================
// DATE & WEATHER
// ============================================

function updateDate() {
    const now = new Date();
    const options = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };
    const formatted = now.toLocaleDateString('en-US', options).toUpperCase();
    document.getElementById('currentDate').textContent = formatted;
}

// Get weather from localStorage (synced with main page)
function getWeatherFromMain() {
    const temp = localStorage.getItem('arcticTemp') || '-15';
    const ice = localStorage.getItem('arcticIce') || '85';
    const snow = localStorage.getItem('arcticSnow') || 'HEAVY';
    const aurora = localStorage.getItem('arcticAurora') || 'VISIBLE';

    console.log('🌡️ Reading weather from localStorage:', { temp, ice, snow, aurora });

    return { temp, ice, snow, aurora };
}

// Update weather display from localStorage
function updateWeather() {
    const weather = getWeatherFromMain();

    // Update temperature displays
    const tempEl = document.getElementById('weatherTemp');
    const infoEl = document.getElementById('weatherInfo');
    if (tempEl) tempEl.textContent = `${weather.temp}°C`;
    if (infoEl) infoEl.textContent = `FROZEN ${weather.temp}°C`;

    // Update forecast details
    const iceEl = document.getElementById('weatherIce');
    const snowEl = document.getElementById('weatherSnow');
    const auroraEl = document.getElementById('weatherAurora');
    if (iceEl) iceEl.textContent = `ICE: ${weather.ice}%`;
    if (snowEl) snowEl.textContent = `SNOW: ${weather.snow}`;
    if (auroraEl) auroraEl.textContent = `AURORA: ${weather.aurora}`;

    console.log('🌡️ Weather display updated');
}

function setRandomQuote() {
    const quote = YUKI_QUOTES[Math.floor(Math.random() * YUKI_QUOTES.length)];
    document.querySelector('.quote-text').textContent = `"${quote}"`;
}

// ============================================
// CONTENT LOADING
// ============================================

async function loadAllContent() {
    STATE.isLoading = true;

    console.log('📰 Loading all content...');

    // First, load from localStorage (synced with main page)
    const storedNews = loadNewsFromStorage();

    // If we have stored news, render it immediately
    if (storedNews.length > 0) {
        console.log(`📰 Found ${storedNews.length} news items in localStorage, rendering...`);
        combineAndRenderNews(storedNews);
    }

    // Then fetch fresh data in parallel
    // NOTE: Only fetch NEWS, not market data (prices belong in market.html)
    await Promise.all([
        fetchNews(),
        fetchPredictions()
    ]);

    // Combine stored news with fresh news
    // This will merge any new items from API with existing ones
    combineAndRenderNews(storedNews);

    STATE.isLoading = false;
    updateLastUpdated();

    console.log('✅ Content loading complete');
}

// Combine localStorage news with fresh fetched news
// IMPORTANT: Preserve ALL historical news (even >24h) for infinite scroll
function combineAndRenderNews(storedNews) {
    // Convert STATE.news to same format (preserve original timestamp)
    const freshNews = STATE.news.map(item => ({
        ...item,
        type: 'NEWS',
        content: item.description,
        timestamp: item.timestamp || Date.now()  // Use existing timestamp if available
    }));

    // Get existing combined news to preserve history
    const existingNews = STATE.combinedNews || [];

    // Combine: existing history + fresh + stored
    // This ensures we NEVER lose old news from DOM
    let allNews = [...existingNews, ...freshNews, ...storedNews];

    // Remove duplicates
    allNews = removeDuplicateNews(allNews);

    // Sort by timestamp (newest first)
    allNews = sortByRecent(allNews);

    // Only update STATE.combinedNews if we have news
    if (allNews.length > 0) {
        STATE.combinedNews = allNews;
        console.log(`📰 Combined news: ${allNews.length} total items (including history)`);

        // Render immediately
        renderNews();
        updateNewsCount();
    } else {
        console.log('⚠️ No news to combine');
    }
}

// ============================================
// NEWS FETCHING (RSS)
// ============================================

async function fetchNews() {
    try {
        console.log('📰 Fetching news from RSS...');
        const RSS_URL = 'https://cointelegraph.com/rss';
        const PROXY = 'https://api.allorigins.win/raw?url=';

        const response = await fetch(PROXY + encodeURIComponent(RSS_URL));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const text = await response.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const items = xml.querySelectorAll('item');

        STATE.news = [];
        items.forEach((item, i) => {
            if (i < 15) {
                const title = item.querySelector('title')?.textContent || '';
                const description = item.querySelector('description')?.textContent || '';
                const link = item.querySelector('link')?.textContent || '';
                const pubDate = item.querySelector('pubDate')?.textContent || '';

                // Clean description
                const cleanDesc = description.replace(/<[^>]*>/g, '').substring(0, 200);

                // Try to extract image from description
                const imgMatch = description.match(/<img[^>]+src="([^">]+)"/);
                const image = imgMatch ? imgMatch[1] : null;

                // Parse pubDate to get proper timestamp
                const newsTimestamp = pubDate ? new Date(pubDate).getTime() : Date.now();

                STATE.news.push({
                    title,
                    description: cleanDesc,
                    url: link,
                    date: pubDate ? formatNewsDate(pubDate) : 'Today',
                    source: 'COINTELEGRAPH',
                    image,
                    timestamp: newsTimestamp,
                    type: 'NEWS',
                    category: 'news'
                });
            }
        });

        console.log(`✅ Fetched ${STATE.news.length} news articles from RSS`);

        // Save fetched news to Firebase for real-time sync
        if (STATE.news.length > 0 && typeof FirebaseDB !== 'undefined' && FirebaseDB.isAvailable()) {
            console.log('💾 Saving news to Firebase...');
            await FirebaseDB.saveNews(STATE.news);
        }

        // Note: Don't call renderNews() here, let combineAndRenderNews() handle it
    } catch (error) {
        console.error('❌ News fetch error:', error);
        // Don't show error immediately, might have cached news
    }
}

// ============================================
// MARKET DATA FETCHING
// ============================================

async function fetchMarketData() {
    try {
        console.log('📊 Fetching market data...');
        const response = await fetch('https://api.coincap.io/v2/assets?limit=8');

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        STATE.marketData = data.data || [];

        console.log(`✅ Loaded ${STATE.marketData.length} market items`);
        renderMarketData();
    } catch (error) {
        console.error('❌ Market data error:', error);
    }
}

// ============================================
// PREDICTIONS FETCHING (Polymarket)
// ============================================

async function fetchPredictions() {
    try {
        console.log('🔮 Fetching predictions...');
        const response = await fetch('https://gamma-api.polymarket.com/markets?closed=false&limit=5');

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        STATE.predictions = data.map(market => {
            let yesOdds = 50;
            let noOdds = 50;

            if (market.outcomePrices) {
                try {
                    const outcomes = JSON.parse(market.outcomePrices);
                    yesOdds = Math.round(parseFloat(outcomes[0]) * 100);
                    noOdds = Math.round(parseFloat(outcomes[1]) * 100);
                } catch (e) {}
            }

            return {
                question: market.question || 'Unknown',
                yesOdds,
                noOdds,
                url: `https://polymarket.com/event/${market.slug || ''}`
            };
        });

        console.log(`✅ Loaded ${STATE.predictions.length} predictions`);
        renderPredictions();
    } catch (error) {
        console.error('❌ Predictions error:', error);
    }
}

// ============================================
// RENDERING
// ============================================

function renderNews() {
    // Use combined news (localStorage + fresh) if available, fallback to STATE.news
    const allNews = STATE.combinedNews && STATE.combinedNews.length > 0
        ? STATE.combinedNews
        : STATE.news;

    // If no news yet, show loading message if still loading, otherwise show error
    if (allNews.length === 0) {
        if (STATE.isLoading || !STATE.hasLoadedOnce) {
            renderNewsLoading();
        } else {
            renderNewsError();
        }
        return;
    }

    // Mark that we've successfully loaded news at least once
    STATE.hasLoadedOnce = true;

    // IMPORTANT: Filter to show ONLY real news articles (NO market data/prices)
    const newsOnly = allNews.filter(item => {
        // Exclude market data (prices)
        if (item.category === 'market' || item.type === 'MARKET') {
            return false;
        }

        // Exclude if title looks like a price (contains $ followed by numbers)
        if (item.title && /\$\d/.test(item.title)) {
            return false;
        }

        // Exclude known market sources
        const marketSources = ['COINCAP', 'BINANCE', 'COINBASE', 'DEXSCREENER'];
        if (marketSources.includes(item.source)) {
            return false;
        }

        // Include only news sources
        const newsSources = ['COINTELEGRAPH', 'BITCOIN MAG', 'RSS', 'NEWS', 'CRYPTOPANIC'];
        const isNewsSource = newsSources.includes(item.source) ||
                             item.category === 'news' ||
                             item.type === 'NEWS';

        return isNewsSource;
    });

    console.log(`📰 Filtered: ${newsOnly.length} real news articles (from ${allNews.length} total items)`);

    if (newsOnly.length === 0) {
        renderNewsError();
        return;
    }

    const newsStream = document.getElementById('newsStream');
    if (!newsStream) return;

    // Sort by timestamp (newest first)
    const sortedNews = sortByRecent([...newsOnly]);

    // Render ALL news with visual hierarchy based on position
    let html = '';

    sortedNews.forEach((item, index) => {
        const article = normalizeArticle(item);
        const age = formatNewsAge(item.timestamp);
        const ageDisplay = age ? ` • ${age}` : '';

        // Check if news is >24h old (archived)
        const isArchived = item.isOld || (item.ageHours && item.ageHours >= 24);
        const archivedLabel = isArchived ? '<span class="archived-badge">ARCHIVED</span>' : '';

        // Determine article class based on position (recency)
        let articleClass = '';
        let headlineClass = '';
        let showImage = false;
        let showExcerpt = false;
        let excerptLength = 0;

        if (index === 0) {
            // #1 = HERO (biggest, most prominent)
            articleClass = 'news-article-hero';
            headlineClass = 'headline-hero';
            showImage = !!article.image;
            showExcerpt = true;
            excerptLength = 300;
        } else if (index >= 1 && index <= 2) {
            // #2-3 = FEATURED (large, prominent)
            articleClass = 'news-article-featured';
            headlineClass = 'headline-featured';
            showImage = !!article.image;
            showExcerpt = true;
            excerptLength = 200;
        } else if (index >= 3 && index <= 9) {
            // #4-10 = STANDARD (normal size)
            articleClass = 'news-article-standard';
            headlineClass = 'headline-standard';
            showExcerpt = true;
            excerptLength = 150;
        } else {
            // #11+ = COMPACT (small, list format)
            articleClass = 'news-article-compact';
            headlineClass = 'headline-compact';
            showExcerpt = false;
        }

        const description = article.description || '';
        const excerpt = showExcerpt && description
            ? (description.length > excerptLength ? description.substring(0, excerptLength) + '...' : description)
            : '';

        html += `
            <article class="news-article ${articleClass}" data-index="${index}">
                ${showImage ? `
                    <img class="article-image" src="${article.image}" alt="News Image" onerror="this.style.display='none'">
                ` : ''}
                <div class="article-body">
                    <h2 class="article-headline ${headlineClass}">
                        ${article.url ? `<a href="${article.url}" target="_blank">${escapeHtml(article.title)}</a>` : escapeHtml(article.title)}
                    </h2>
                    <div class="article-meta">
                        <span class="article-source">${article.source}</span>
                        <span class="meta-separator">•</span>
                        <span class="article-date">${article.date}${ageDisplay}</span>
                        ${archivedLabel}
                    </div>
                    ${showExcerpt && excerpt ? `
                        <p class="article-excerpt">${escapeHtml(excerpt)}</p>
                    ` : ''}
                    ${article.url && index < 10 ? `
                        <a href="${article.url}" target="_blank" class="article-read-more">Continue Reading →</a>
                    ` : ''}
                </div>
                <div class="article-divider"></div>
            </article>
        `;
    });

    newsStream.innerHTML = html;

    console.log(`✅ Rendered ${sortedNews.length} articles in infinite scroll format`);
}

// Normalize article format for rendering
function normalizeArticle(item) {
    return {
        title: item.title || '',
        description: item.description || item.content || '',
        url: item.url || '',
        date: item.date || formatTimestamp(item.timestamp),
        source: item.source || 'UNKNOWN',
        image: item.image || null
    };
}

// Format timestamp to readable date
function formatTimestamp(timestamp) {
    if (!timestamp) return 'Today';
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

function renderNewsColumn(columnId, articles, sectionTitle) {
    const column = document.getElementById(columnId);
    if (!column || articles.length === 0) return;

    const content = column.querySelector('.column-content');
    if (!content) {
        column.innerHTML = `
            <div class="section-header">
                <span class="section-line"></span>
                <span class="section-title">${sectionTitle}</span>
                <span class="section-line"></span>
            </div>
            <div class="column-content"></div>
        `;
    }

    const contentEl = column.querySelector('.column-content') || column;

    contentEl.innerHTML = articles.map(article => {
        const desc = article.description || '';
        const excerpt = desc.length > 120 ? desc.substring(0, 120) + '...' : desc;

        return `
            <article class="news-article">
                <h3 class="article-headline">${escapeHtml(article.title)}</h3>
                <div class="article-meta">
                    <span class="article-source">${article.source}</span> | ${article.date}
                </div>
                <p class="article-excerpt">${escapeHtml(excerpt)}</p>
                ${article.url ? `<a href="${article.url}" target="_blank" class="article-link">Read More &rarr;</a>` : ''}
            </article>
        `;
    }).join('');
}

function renderMoreHeadlines(articles) {
    const container = document.getElementById('moreHeadlines');
    if (!container || articles.length === 0) return;

    container.innerHTML = articles.slice(0, 4).map(article => `
        <div class="headline-item">
            <a href="${article.url}" target="_blank" style="text-decoration: none; color: inherit;">
                <h4 class="headline-title">${escapeHtml(article.title)}</h4>
                <span class="headline-source">${article.source} | ${article.date}</span>
            </a>
        </div>
    `).join('');
}

function renderMarketData() {
    // DEPRECATED: Market data is not shown in the newspaper
    // Market prices belong in market.html, not in a news journal
    // This function is kept for backwards compatibility but does nothing
    console.log('⚠️ renderMarketData() called but skipped - market data not shown in newspaper');
    return;
}

function renderPredictions() {
    const container = document.getElementById('predictionsColumn');
    if (!container) return;

    if (STATE.predictions.length === 0) {
        container.innerHTML = '<div class="loading-placeholder">No predictions available</div>';
        return;
    }

    container.innerHTML = STATE.predictions.map(pred => {
        const shortQuestion = pred.question.length > 60
            ? pred.question.substring(0, 60) + '...'
            : pred.question;

        return `
            <div class="prediction-item">
                <a href="${pred.url}" target="_blank" style="text-decoration: none; color: inherit;">
                    <div class="prediction-question">${escapeHtml(shortQuestion)}</div>
                    <div class="prediction-odds">
                        <span class="odds-yes">YES ${pred.yesOdds}%</span>
                        <span class="odds-no">NO ${pred.noOdds}%</span>
                    </div>
                </a>
            </div>
        `;
    }).join('');
}

function renderNewsLoading() {
    const newsStream = document.getElementById('newsStream');
    if (!newsStream) return;

    newsStream.innerHTML = `
        <div class="loading-placeholder" style="text-align: center; padding: 60px 20px;">
            <div style="font-size: 48px; margin-bottom: 20px;">📰</div>
            <div style="font-size: 24px; margin-bottom: 10px; font-weight: 600;">LOADING YUKI TIMES...</div>
            <div style="font-size: 14px; opacity: 0.7;">Fetching latest news from the pack archives...</div>
        </div>
    `;
}

function renderNewsError() {
    const newsStream = document.getElementById('newsStream');
    if (!newsStream) return;

    newsStream.innerHTML = `
        <div style="text-align: center; padding: 60px 20px;">
            <h2 class="main-headline">DISPATCH FROM THE PACK</h2>
            <div class="main-subhead">Yuki's morning briefing awaits fresh intelligence from the crypto markets.</div>
            <div class="main-content-text">
                <p>The network connections appear to be experiencing difficulties. Our correspondents are working diligently to restore communications.</p>
                <p>In the meantime, Yuki recommends reviewing your portfolio with the patience and discipline of a warrior.</p>
            </div>
        </div>
    `;
}

// ============================================
// UTILITIES
// ============================================

function formatNewsDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        }).toUpperCase();
    } catch (e) {
        return 'TODAY';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateLastUpdated() {
    STATE.lastUpdate = new Date();
    const el = document.getElementById('lastUpdated');
    if (el) {
        el.textContent = STATE.lastUpdate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }
    // Also update news count
    updateNewsCount();
}

/**
 * Update the news count display
 */
function updateNewsCount() {
    const allNews = JSON.parse(localStorage.getItem('allNews') || '[]');

    const storiesEl = document.querySelector('.stories-count');
    if (storiesEl) {
        storiesEl.textContent = `STORIES: ${allNews.length}`;
    }

    const lastUpdatedEl = document.querySelector('.last-updated-info');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = `LAST UPDATED: ${new Date().toLocaleTimeString()}`;
    }
}

// ============================================
// REFRESH
// ============================================

function initRefreshButton() {
    const btn = document.getElementById('refreshNews');
    if (btn) {
        btn.addEventListener('click', async () => {
            btn.textContent = 'REFRESHING...';
            btn.disabled = true;

            await loadAllContent();
            setRandomQuote();
            updateWeather();

            btn.textContent = 'REFRESH EDITION';
            btn.disabled = false;
        });
    }
}

// ============================================
// AUTO REFRESH (every 30 seconds)
// ============================================

setInterval(() => {
    console.log('⏰ Auto-refreshing newspaper...');
    loadAllContent();
    updateWeather();
}, 30 * 1000);

// ============================================
// GLOBAL EXPORTS
// ============================================

window.NEWS_STATE = STATE;
window.refreshNews = loadAllContent;
window.cleanOldNews = cleanOldNews;
window.saveNews = saveNews;
window.formatNewsAge = formatNewsAge;
