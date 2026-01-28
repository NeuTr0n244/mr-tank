/**
 * AKAI INU - FINANCIAL TERMINAL
 * Shiba Market Data System
 * Multi-Source Token Aggregator
 */

// ============================================
// STATE
// ============================================

const STATE = {
    tokens: [],
    trending: [],
    predictions: [],
    watchlist: JSON.parse(localStorage.getItem('tank_watchlist') || '[]'),
    remarks: JSON.parse(localStorage.getItem('tank_remarks') || '[]'),
    lastUpdate: null,
    isLoading: false
};

// Known coins for detection
const KNOWN_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'SHIB', 'PEPE', 'BONK', 'WIF', 'ARB', 'OP', 'MATIC', 'AVAX', 'LINK', 'UNI', 'AAVE', 'JUP', 'PYTH', 'JTO', 'ORCA', 'RAY', 'FLOKI', 'BRETT', 'MOG', 'TURBO', 'NEIRO', 'RENDER', 'FET', 'TAO', 'INJ', 'SEI', 'SUI', 'APT', 'TIA', 'STRK', 'MANTA', 'DYM', 'PIXEL', 'PORTAL', 'MYRO', 'SLERF', 'POPCAT', 'MEW'];

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initSnowfall();
    initClock();
    loadAllMarketData();
    initAutoRefresh();
    initCrossTabSync();
    initFirebaseListeners();
    renderWatchlist();
    renderRemarks();
});

// ============================================
// FIREBASE REAL-TIME LISTENERS
// ============================================

function initFirebaseListeners() {
    // Check if FirebaseDB is available
    if (typeof FirebaseDB === 'undefined') {
        console.log('Firebase not available, using localStorage');
        return;
    }

    // Initialize Firebase
    FirebaseDB.init();

    // Listen to market data updates from Firebase
    FirebaseDB.listenToMarket((tokens) => {
        if (tokens && tokens.length > 0) {
            console.log('Firebase: Market data updated', tokens.length, 'tokens');
            STATE.tokens = tokens;
            STATE.trending = tokens.slice(0, 15);
            renderTokenGrid();
            renderTrendingList();
            updateTokenCount();
        }
    });

    // Listen to watchlist updates from Firebase
    FirebaseDB.listenToWatchlist((symbols) => {
        console.log('Firebase: Watchlist updated', symbols.length, 'symbols');
        STATE.watchlist = symbols;
        renderWatchlist();
    });

    // Listen to remarks updates from Firebase
    FirebaseDB.listenToRemarks((remarks) => {
        console.log('Firebase: Remarks updated', remarks.length, 'items');
        STATE.remarks = remarks;
        renderRemarks();
    });

    console.log('Firebase listeners initialized for market page');
}

// ============================================
// SNOWFALL EFFECT
// ============================================

function initSnowfall() {
    const container = document.getElementById('snowflakes');
    if (!container) return;

    const snowflakeChars = ['❄', '❅', '❆', '•', '✦'];
    const numSnowflakes = 50;

    for (let i = 0; i < numSnowflakes; i++) {
        const snowflake = document.createElement('div');
        snowflake.className = 'snowflake';
        snowflake.textContent = snowflakeChars[Math.floor(Math.random() * snowflakeChars.length)];

        const startX = Math.random() * 100;
        const size = 0.5 + Math.random() * 1;
        const duration = 12 + Math.random() * 18;
        const delay = Math.random() * duration;

        snowflake.style.cssText = `
            left: ${startX}%;
            font-size: ${size}em;
            animation-duration: ${duration}s;
            animation-delay: -${delay}s;
        `;

        container.appendChild(snowflake);
    }
}

// ============================================
// CLOCK
// ============================================

function initClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });
    const date = now.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
    }).toUpperCase();

    const timeEl = document.getElementById('clock-time');
    const dateEl = document.getElementById('clock-date');

    if (timeEl) timeEl.textContent = time;
    if (dateEl) dateEl.textContent = date;
}

// ============================================
// CROSS-TAB SYNC (with main page news)
// ============================================

function initCrossTabSync() {
    // When news updates, check for mentioned coins
    window.addEventListener('storage', (e) => {
        if (e.key === 'allNews') {
            console.log('📰 News updated, checking for mentioned coins...');
            updateMarketFromNews();
        }
    });

    // Update when tab gains focus
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            console.log('📊 Tab visible, refreshing market data...');
            loadAllMarketData();
        }
    });
}

async function updateMarketFromNews() {
    const mentionedCoins = await fetchMentionedCoins();
    if (mentionedCoins.length > 0) {
        // Add mentioned coins to the existing list
        mentionedCoins.forEach(coin => {
            const exists = STATE.tokens.find(t => t.symbol === coin.symbol);
            if (!exists) {
                STATE.tokens.unshift(coin);
            }
        });
        renderTokenGrid();
        renderTrendingList();
        updateTokenCount();
    }
}

// ============================================
// DATA FETCHING - MULTIPLE SOURCES
// ============================================

async function loadAllMarketData() {
    STATE.isLoading = true;
    showLoading();

    console.log('📊 Loading user tokens and predictions...');

    // Fetch only predictions (no automatic token fetching)
    const [predictions] = await Promise.all([
        fetchPolymarketPredictions()
    ]);

    // Load user-added tokens from Firebase
    await loadUserTokens();

    // Render everything
    renderTokenGrid();
    renderTrendingList();
    updateTokenCount();

    STATE.isLoading = false;
    updateTimestamp();
}

// ============================================
// USER TOKEN MANAGEMENT
// ============================================

async function loadUserTokens() {
    console.log('📊 Loading user tokens from Firebase...');

    // User tokens will be loaded via Firebase listener
    // This function is called on initial load
    if (STATE.tokens.length === 0) {
        console.log('ℹ️ No user tokens yet. Terminal empty.');
    }
}

/**
 * Add token by LINK (DexScreener, Coinbase, Binance) or SYMBOL
 * Detects automatically what was provided
 */
async function addTokenByLink(input) {
    const trimmed = input.trim();

    if (!trimmed) {
        alert('Please enter a token symbol or paste a link');
        return;
    }

    console.log('📊 Processing input:', trimmed);

    // Detect if it's a link or symbol
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        // It's a LINK
        console.log('🔗 Detected LINK input');
        await addTokenFromLink(trimmed);
    } else {
        // It's a SYMBOL
        console.log('🔤 Detected SYMBOL input');
        await addTokenBySymbol(trimmed);
    }
}

/**
 * Add token from various links (DexScreener, Coinbase, Binance)
 */
async function addTokenFromLink(link) {
    let tokenData = null;

    try {
        // DexScreener - ANY CHAIN (not just Solana)
        if (link.includes('dexscreener.com')) {
            console.log('🦎 DexScreener link detected');

            // Extract chain and address from link
            // https://dexscreener.com/solana/ADDRESS
            // https://dexscreener.com/ethereum/ADDRESS
            const parts = link.split('/').filter(p => p);
            const chain = parts[parts.length - 2]; // solana, ethereum, bsc, base, etc
            const address = parts[parts.length - 1];

            console.log(`  Chain: ${chain}, Address: ${address}`);

            const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
            const data = await response.json();

            if (data.pairs && data.pairs.length > 0) {
                const pair = data.pairs[0];
                tokenData = createTokenFromPair(pair, 'USER');
                tokenData.chain = chain.toUpperCase();
            } else {
                alert('Token not found on DexScreener');
                return;
            }
        }

        // Coinbase
        else if (link.includes('coinbase.com/price/')) {
            console.log('💰 Coinbase link detected');

            const symbol = link.split('/price/')[1].split('/')[0].split('?')[0];
            console.log(`  Symbol extracted: ${symbol}`);

            await addTokenBySymbol(symbol);
            return; // Use symbol search for Coinbase
        }

        // Binance
        else if (link.includes('binance.com')) {
            console.log('🟡 Binance link detected');

            let symbol = null;
            if (link.includes('/price/')) {
                symbol = link.split('/price/')[1].split('/')[0].split('?')[0];
            } else if (link.includes('/trade/')) {
                symbol = link.split('/trade/')[1].split('?')[0];
            }

            if (symbol) {
                console.log(`  Symbol extracted: ${symbol}`);
                await addTokenBySymbol(symbol);
                return;
            } else {
                alert('Could not extract token symbol from Binance link');
                return;
            }
        }

        else {
            alert('Link not supported. Please use DexScreener, Coinbase, or Binance links.');
            return;
        }

        // Add token to state if we got data
        if (tokenData) {
            // Check if already exists
            const exists = STATE.tokens.find(t =>
                t.symbol.toUpperCase() === tokenData.symbol.toUpperCase()
            );

            if (exists) {
                alert(`${tokenData.symbol} is already added`);
                return;
            }

            STATE.tokens.unshift(tokenData);
            STATE.trending = STATE.tokens.slice(0, 15);

            // Save to Firebase
            saveMarketData(STATE.tokens);

            // Render
            renderTokenGrid();
            renderTrendingList();
            updateTokenCount();

            console.log(`✅ Added ${tokenData.symbol} from link successfully`);
            alert(`✅ ${tokenData.symbol} added successfully!`);
        }

    } catch (error) {
        console.error('❌ Error adding token from link:', error);
        alert('Failed to add token from link. Please try again or use a symbol instead.');
    }
}

/**
 * Add token by SYMBOL (original function, renamed)
 */
async function addTokenBySymbol(symbol) {
    const upperSymbol = symbol.toUpperCase().trim();

    if (!upperSymbol) {
        alert('Please enter a token symbol');
        return;
    }

    // Check if already exists
    const exists = STATE.tokens.find(t => t.symbol.toUpperCase() === upperSymbol);
    if (exists) {
        alert(`${upperSymbol} is already added`);
        return;
    }

    console.log(`➕ Adding user token: ${upperSymbol}`);

    // Fetch token data from DexScreener
    try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${upperSymbol}`);
        const data = await response.json();

        if (data.pairs && data.pairs.length > 0) {
            const pair = data.pairs[0];
            const token = createTokenFromPair(pair, 'USER');

            // Add to state
            STATE.tokens.unshift(token);
            STATE.trending = STATE.tokens.slice(0, 15);

            // Save to Firebase
            saveMarketData(STATE.tokens);

            // Render
            renderTokenGrid();
            renderTrendingList();
            updateTokenCount();

            console.log(`✅ Added ${upperSymbol} successfully`);
            alert(`✅ ${upperSymbol} added successfully!`);
        } else {
            alert(`Token ${upperSymbol} not found on DexScreener`);
        }
    } catch (error) {
        console.error(`❌ Error adding token:`, error);
        alert(`Failed to add ${upperSymbol}. Please try again.`);
    }
}

function removeUserToken(symbol) {
    const upperSymbol = symbol.toUpperCase();

    console.log(`➖ Removing user token: ${upperSymbol}`);

    // Remove from state
    STATE.tokens = STATE.tokens.filter(t => t.symbol.toUpperCase() !== upperSymbol);
    STATE.trending = STATE.tokens.slice(0, 15);

    // Save to Firebase
    saveMarketData(STATE.tokens);

    // Render
    renderTokenGrid();
    renderTrendingList();
    updateTokenCount();

    console.log(`✅ Removed ${upperSymbol}`);
}

async function updateUserTokenPrices() {
    if (STATE.tokens.length === 0) {
        console.log('ℹ️ No user tokens to update');
        return;
    }

    console.log(`🔄 Updating prices for ${STATE.tokens.length} user tokens...`);

    const updatedTokens = [];

    for (const token of STATE.tokens) {
        try {
            const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${token.symbol}`);
            const data = await response.json();

            if (data.pairs && data.pairs.length > 0) {
                const pair = data.pairs[0];
                const updatedToken = createTokenFromPair(pair, token.type || 'USER');
                updatedTokens.push(updatedToken);
            } else {
                // Keep old data if fetch fails
                updatedTokens.push(token);
            }

            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 100));
        } catch (error) {
            console.error(`❌ Error updating ${token.symbol}:`, error);
            // Keep old data
            updatedTokens.push(token);
        }
    }

    STATE.tokens = updatedTokens;
    STATE.trending = updatedTokens.slice(0, 15);

    // Save to Firebase
    saveMarketData(STATE.tokens);

    // Render
    renderTokenGrid();
    renderTrendingList();
    updateTokenCount();
    updateTimestamp();

    console.log(`✅ Updated ${updatedTokens.length} token prices`);
}

// ============================================
// DEXSCREENER - MULTIPLE CHAINS
// ============================================

async function fetchDexScreenerMultiple() {
    const cards = [];

    // Fetch trending (general)
    try {
        console.log('📊 [DexScreener] Fetching trending tokens...');
        const response = await fetch('https://api.dexscreener.com/latest/dex/search?q=trending');
        const data = await response.json();

        data.pairs?.slice(0, 20).forEach(pair => {
            if (pair.volume?.h24 > 1000) {
                cards.push(createTokenFromPair(pair, 'TRENDING'));
            }
        });
        console.log(`✅ [DexScreener] Trending: ${cards.length} tokens`);
    } catch (e) {
        console.error('❌ DexScreener trending:', e.message);
    }

    // Fetch by chain
    const chains = ['solana', 'ethereum', 'bsc', 'base', 'arbitrum'];

    for (const chain of chains) {
        try {
            const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${chain}`);
            const data = await response.json();

            let addedFromChain = 0;
            data.pairs?.slice(0, 15).forEach(pair => {
                // Avoid duplicates
                const exists = cards.find(c => c.symbol === pair.baseToken?.symbol);
                if (!exists && pair.volume?.h24 > 1000) {
                    cards.push(createTokenFromPair(pair, chain.toUpperCase()));
                    addedFromChain++;
                }
            });
            console.log(`✅ [DexScreener] ${chain}: ${addedFromChain} tokens`);

            // Small delay between requests
            await new Promise(r => setTimeout(r, 100));
        } catch (e) {
            console.error(`❌ DexScreener ${chain}:`, e.message);
        }
    }

    return cards;
}

// ============================================
// MEME COINS
// ============================================

async function fetchMemeCoins() {
    const memeCoins = ['PEPE', 'DOGE', 'SHIB', 'FLOKI', 'BONK', 'WIF', 'BRETT', 'MOG', 'TURBO', 'NEIRO', 'POPCAT', 'MEW', 'MYRO', 'SLERF'];
    const cards = [];

    console.log('🐸 [Meme] Fetching meme coins...');

    for (const coin of memeCoins) {
        try {
            const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${coin}`);
            const data = await response.json();

            if (data.pairs?.[0]) {
                const pair = data.pairs[0];
                cards.push(createTokenFromPair(pair, 'MEME'));
            }
            await new Promise(r => setTimeout(r, 80));
        } catch (e) {
            console.error(`❌ Meme coin ${coin}:`, e.message);
        }
    }

    console.log(`✅ [Meme] Loaded ${cards.length} meme coins`);
    return cards;
}

// ============================================
// TOP CRYPTOS (CoinCap)
// ============================================

async function fetchTopCryptos() {
    const cards = [];

    try {
        console.log('🏆 [CoinCap] Fetching top 20 cryptos...');
        const response = await fetch('https://api.coincap.io/v2/assets?limit=20');
        const data = await response.json();

        data.data?.forEach(coin => {
            cards.push({
                symbol: coin.symbol,
                name: coin.name,
                price: parseFloat(coin.priceUsd) || 0,
                change24h: parseFloat(coin.changePercent24Hr) || 0,
                volume: parseFloat(coin.volumeUsd24Hr) || 0,
                marketCap: parseFloat(coin.marketCapUsd) || 0,
                liquidity: 0,
                txns: 0,
                chain: 'MULTI',
                type: 'TOP',
                rank: parseInt(coin.rank),
                url: `https://coincap.io/assets/${coin.id}`,
                timestamp: Date.now()
            });
        });

        console.log(`✅ [CoinCap] Loaded ${cards.length} top cryptos`);
    } catch (e) {
        console.error('❌ CoinCap:', e.message);
    }

    return cards;
}

// ============================================
// COINS MENTIONED IN NEWS
// ============================================

function extractCoinsFromNews() {
    const allNews = JSON.parse(localStorage.getItem('allNews') || '[]');
    const mentionedCoins = new Set();

    allNews.forEach(news => {
        const text = ((news.title || '') + ' ' + (news.content || '') + ' ' + (news.description || '')).toUpperCase();

        KNOWN_COINS.forEach(coin => {
            if (text.includes(coin) || text.includes('$' + coin)) {
                mentionedCoins.add(coin);
            }
        });
    });

    console.log(`📰 Coins mentioned in news: ${Array.from(mentionedCoins).join(', ')}`);
    return Array.from(mentionedCoins);
}

async function fetchMentionedCoins() {
    const mentioned = extractCoinsFromNews();
    const cards = [];

    if (mentioned.length === 0) return cards;

    console.log('📰 [Mentioned] Fetching coins from news...');

    for (const coin of mentioned.slice(0, 10)) { // Limit to 10
        try {
            const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${coin}`);
            const data = await response.json();

            if (data.pairs?.[0]) {
                const pair = data.pairs[0];
                cards.push(createTokenFromPair(pair, 'MENTIONED'));
            }
            await new Promise(r => setTimeout(r, 80));
        } catch (e) {
            console.error(`❌ Mentioned coin ${coin}:`, e.message);
        }
    }

    console.log(`✅ [Mentioned] Loaded ${cards.length} mentioned coins`);
    return cards;
}

// ============================================
// POLYMARKET PREDICTIONS
// ============================================

async function fetchPolymarketPredictions() {
    try {
        console.log('🔮 [Polymarket] Fetching predictions...');

        const response = await fetch('https://gamma-api.polymarket.com/markets?closed=false&limit=10');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

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
                question: market.question || 'Unknown Market',
                yesOdds,
                noOdds,
                liquidity: market.liquidity || 0,
                slug: market.slug,
                url: `https://polymarket.com/event/${market.slug || ''}`
            };
        });

        console.log(`✅ Loaded ${STATE.predictions.length} predictions`);
        renderPredictions();
        return STATE.predictions;
    } catch (error) {
        console.error('❌ [Polymarket] Error:', error.message);
        document.getElementById('predictionsList').innerHTML =
            '<div class="empty-message">Unable to load predictions</div>';
        return [];
    }
}

// ============================================
// HELPER: Create token from DexScreener pair
// ============================================

function createTokenFromPair(pair, type = '') {
    return {
        symbol: pair.baseToken?.symbol || 'TOKEN',
        name: pair.baseToken?.name || '',
        price: parseFloat(pair.priceUsd || 0),
        change24h: parseFloat(pair.priceChange?.h24 || 0),
        volume: pair.volume?.h24 || 0,
        liquidity: pair.liquidity?.usd || 0,
        txns: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
        chain: pair.chainId || 'unknown',
        type: type,
        url: pair.url || `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`,
        pairAddress: pair.pairAddress,
        timestamp: Date.now()
    };
}

// ============================================
// SAVE MARKET DATA
// ============================================

function saveMarketData(tokens) {
    localStorage.setItem('marketTokens', JSON.stringify(tokens));
    localStorage.setItem('marketLastUpdate', Date.now().toString());

    // Also save to Firebase for real-time sync
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isAvailable()) {
        FirebaseDB.saveMarket(tokens);
    }
}

// ============================================
// RENDERING
// ============================================

function showLoading() {
    document.getElementById('tokenGrid').innerHTML = '<div class="loading-message">Loading tokens from multiple sources...</div>';
    document.getElementById('trendingList').innerHTML = '<div class="loading-message">Loading trending...</div>';
    document.getElementById('predictionsList').innerHTML = '<div class="loading-message">Loading predictions...</div>';
}

function renderTokenGrid() {
    const grid = document.getElementById('tokenGrid');
    if (!grid) return;

    if (STATE.tokens.length === 0) {
        grid.innerHTML = `
            <div class="empty-message">
                <div style="font-size: 48px; margin-bottom: 20px;">📊</div>
                <div style="font-size: 18px; margin-bottom: 10px;">NO TOKENS ADDED YET</div>
                <div style="font-size: 14px; opacity: 0.7;">Click the + button to add a token</div>
            </div>
        `;
        return;
    }

    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false });

    grid.innerHTML = STATE.tokens.map(token => {
        const isPositive = token.change24h >= 0;
        const changeStr = (isPositive ? '+' : '') + token.change24h.toFixed(2);
        const priceStr = formatPrice(token.price);
        const volStr = formatNumber(token.volume);
        const liqStr = formatNumber(token.liquidity);
        const chainLabel = token.chain ? token.chain.toUpperCase().substring(0, 3) : 'N/A';

        return `
            <div class="token-card ${isPositive ? 'positive' : 'negative'}"
                 data-symbol="${token.symbol}"
                 data-type="${token.type}">
                <button class="token-remove" onclick="event.stopPropagation(); removeUserToken('${token.symbol}')" title="Remove token">✕</button>
                <div onclick="openToken('${token.url}')">
                    <div class="token-name">${escapeHtml(token.symbol)}</div>
                    <div class="token-change">${changeStr}%</div>
                    <div class="token-stats">
                        <span>vol: $${volStr}</span>
                        <span>liq: $${liqStr}</span>
                        ${token.txns ? `<span>tx: ${token.txns}</span>` : ''}
                    </div>
                    <div class="token-price">$${priceStr}</div>
                    <div class="token-chain">${chainLabel}</div>
                    <div class="token-snapshot">snapshot: ${timestamp}</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderTrendingList() {
    const list = document.getElementById('trendingList');
    if (!list || STATE.trending.length === 0) {
        list.innerHTML = '<div class="empty-message">No trending tokens</div>';
        return;
    }

    // Sort by absolute change for top movers
    const topMovers = [...STATE.trending].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 15);

    list.innerHTML = topMovers.map((token, index) => {
        const isPositive = token.change24h >= 0;
        const changeStr = (isPositive ? '+' : '') + token.change24h.toFixed(2);

        return `
            <div class="trending-item" onclick="openToken('${token.url}')">
                <span class="trending-rank">#${index + 1}</span>
                <span class="trending-symbol">${escapeHtml(token.symbol)}</span>
                <span class="trending-change ${isPositive ? 'positive' : 'negative'}">${changeStr}%</span>
            </div>
        `;
    }).join('');
}

function renderPredictions() {
    const list = document.getElementById('predictionsList');
    if (!list || STATE.predictions.length === 0) {
        list.innerHTML = '<div class="empty-message">No predictions available</div>';
        return;
    }

    list.innerHTML = STATE.predictions.map(pred => {
        const liqStr = formatNumber(pred.liquidity);
        const shortQuestion = pred.question.length > 80
            ? pred.question.substring(0, 80) + '...'
            : pred.question;

        return `
            <div class="prediction-card" onclick="openPrediction('${pred.url}')">
                <div class="prediction-question">${escapeHtml(shortQuestion)}</div>
                <div class="prediction-odds">
                    <span class="odds-yes">Yes ${pred.yesOdds}%</span>
                    <span class="odds-no">No ${pred.noOdds}%</span>
                </div>
                <div class="prediction-liquidity">Liquidity: $${liqStr}</div>
            </div>
        `;
    }).join('');
}

function renderWatchlist() {
    const list = document.getElementById('watchlist');
    if (!list) return;

    if (STATE.watchlist.length === 0) {
        list.innerHTML = '<div class="empty-message">No tokens tracked yet</div>';
        return;
    }

    list.innerHTML = STATE.watchlist.map(symbol => `
        <span class="watchlist-item" onclick="searchToken('${symbol}')">${escapeHtml(symbol)}</span>
    `).join('');
}

function renderRemarks() {
    const list = document.getElementById('remarksList');
    if (!list) return;

    if (STATE.remarks.length === 0) {
        list.innerHTML = '<div class="empty-message">No remarks yet</div>';
        return;
    }

    list.innerHTML = STATE.remarks.slice(0, 20).map(remark => {
        const time = new Date(remark.timestamp).toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        return `
            <div class="remark-item">
                <div class="remark-text">${escapeHtml(remark.text)}</div>
                <div class="remark-meta">
                    <span class="remark-source">${escapeHtml(remark.source)}</span>
                    <span class="remark-time">${time}</span>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================
// WATCHLIST & REMARKS
// ============================================

function addToWatchlist(symbol) {
    const upperSymbol = symbol.toUpperCase();
    if (!STATE.watchlist.includes(upperSymbol)) {
        STATE.watchlist.unshift(upperSymbol);
        if (STATE.watchlist.length > 20) {
            STATE.watchlist.pop();
        }
        localStorage.setItem('tank_watchlist', JSON.stringify(STATE.watchlist));

        // Save to Firebase for real-time sync
        if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isAvailable()) {
            FirebaseDB.saveWatchlist(STATE.watchlist);
        }

        renderWatchlist();
        console.log(`✅ Added ${upperSymbol} to watchlist`);
    }
}

function addRemark(text, source = 'AKAI INU') {
    const remark = {
        text,
        source,
        timestamp: Date.now()
    };

    STATE.remarks.unshift(remark);

    if (STATE.remarks.length > 50) {
        STATE.remarks.pop();
    }

    localStorage.setItem('tank_remarks', JSON.stringify(STATE.remarks));

    // Save to Firebase for real-time sync
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isAvailable()) {
        FirebaseDB.addRemark(remark);
    }

    renderRemarks();
}

// Extract and track mentioned tokens
function extractAndTrackTokens(text) {
    const upperText = text.toUpperCase();

    KNOWN_COINS.forEach(token => {
        if (upperText.includes(token)) {
            addToWatchlist(token);
        }
    });
}

// ============================================
// ACTIONS
// ============================================

function openToken(url) {
    if (url) {
        window.open(url, '_blank');
    }
}

function openPrediction(url) {
    if (url) {
        window.open(url, '_blank');
    }
}

function searchToken(symbol) {
    const token = STATE.tokens.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
    if (token && token.url) {
        window.open(token.url, '_blank');
    } else {
        window.open(`https://dexscreener.com/search?q=${symbol}`, '_blank');
    }
}

// ============================================
// AUTO REFRESH
// ============================================

function initAutoRefresh() {
    // Update user token prices every 30 seconds
    setInterval(async () => {
        console.log('⏰ Auto-refreshing user token prices...');
        await updateUserTokenPrices();
    }, 30000);
}

function updateTimestamp() {
    STATE.lastUpdate = new Date();
    const el = document.getElementById('lastUpdate');
    if (el) {
        el.textContent = STATE.lastUpdate.toLocaleString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }
}

function updateTokenCount() {
    const el = document.getElementById('tokenCount');
    if (el) {
        el.textContent = STATE.tokens.length;
    }

    // Also update stats in header if exists
    const statsEl = document.querySelector('.tokens-count');
    if (statsEl) {
        statsEl.textContent = `TOKENS: ${STATE.tokens.length}`;
    }
}

// ============================================
// UTILITIES
// ============================================

function formatNumber(num) {
    if (!num || isNaN(num)) return '0';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
}

function formatPrice(price) {
    if (!price || isNaN(price)) return '0';
    if (price < 0.00001) return price.toFixed(10);
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    return price.toFixed(2);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// MODAL FUNCTIONS
// ============================================

function openAddTokenModal() {
    const modal = document.getElementById('addTokenModal');
    const input = document.getElementById('tokenSymbolInput');
    if (modal && input) {
        modal.style.display = 'flex';
        input.value = '';
        input.focus();
    }
}

function closeAddTokenModal() {
    const modal = document.getElementById('addTokenModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function handleAddToken() {
    const input = document.getElementById('tokenSymbolInput');
    if (input) {
        const value = input.value.trim();
        if (value) {
            closeAddTokenModal();
            addTokenByLink(value); // Detects automatically if it's a link or symbol
        }
    }
}

// Handle Enter key in modal
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('tokenSymbolInput');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleAddToken();
            }
        });
    }

    // Close modal on background click
    const modal = document.getElementById('addTokenModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeAddTokenModal();
            }
        });
    }
}, { once: false });

// ============================================
// GLOBAL EXPORTS (for debugging)
// ============================================

window.MARKET_STATE = STATE;
window.addRemark = addRemark;
window.addToWatchlist = addToWatchlist;
window.refreshMarket = loadAllMarketData;
window.extractCoinsFromNews = extractCoinsFromNews;
window.addTokenByLink = addTokenByLink;
window.addTokenBySymbol = addTokenBySymbol;
window.addTokenFromLink = addTokenFromLink;
window.removeUserToken = removeUserToken;
window.openAddTokenModal = openAddTokenModal;
window.closeAddTokenModal = closeAddTokenModal;
window.handleAddToken = handleAddToken;
