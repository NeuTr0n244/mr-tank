/**
 * AKAI INU V1.0
 * Continuously Learning Agentic Realtime Knowledgebase
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    modelPath: './shibainu.glb',
    radioStreams: {
        lofi: 'https://streams.ilovemusic.de/iloveradio17.mp3',
        jazz: 'https://jazz.streamr.ru/jazz-64.mp3',
        classical: 'https://live.musopen.org:8085/streamvbr0'
    },
    groq: {
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.1-8b-instant',
        systemPrompt: `You are Akai Inu, a powerful and muscular Shiba Inu. You embody strength, loyalty, and determination. You speak with confidence and wisdom, making references to Japanese culture, martial arts, and the spirit of the warrior. You understand crypto, finance, and community building. Your responses are short (maximum 2 sentences) and impactful. You love making analogies between strength training, discipline, and success. You occasionally reference samurai wisdom or Japanese proverbs. Always respond in English. Speak like a strong, loyal companion who inspires others.`
    }
};

// ============================================
// STATE
// ============================================

const STATE = {
    // API Key - set here or will load from localStorage if previously saved
    groqApiKey: localStorage.getItem('tank_groq_key') || '',

    // Voice - always starts ON
    voiceEnabled: true,
    soundEnabled: localStorage.getItem('tank_sound_enabled') !== 'false',
    isSpeaking: false,
    isWordActive: false,
    wordTimeout: null,

    // Stats
    mood: 75,
    health: 80,
    volatility: 45,
    ticks: 0,

    // 3D
    scene: null,
    camera: null,
    renderer: null,
    model: null,
    modelPivot: null,

    // Animation
    mixer: null,
    clock: new THREE.Clock(),

    // Mouse tracking
    targetRotationX: 0,
    targetRotationY: 0,
    currentRotationX: 0,
    currentRotationY: 0,

    // Breathing animation
    breathTime: 0,
    originalScale: null,

    // Speech
    lastSpeechTime: 0,

    // Knowledge Database
    knowledgeDB: [],

    // Radio
    radioElement: null,
    radioPlaying: false,
    radioMuted: true,

    // Speech
    voices: []
};

// ============================================
// AUTOMATIC SPEECH QUEUE SYSTEM
// ============================================

// Global speech queue for automatic reading of Arctic Archives
const speechQueue = [];
let isProcessingQueue = false;
const spokenMessages = new Set(); // Track what has been spoken to avoid repeats
let initialLoadDone = false; // Track if initial load completed
let initialLoadCount = 0; // Count items in initial load

// ============================================
// SPOKEN NEWS PERSISTENCE (Firebase)
// Each news is spoken ONLY ONCE - SHARED across ALL users
// If ONE user heard it, NO user will hear it again
// ============================================

/**
 * Mark a news item as already spoken (shared across ALL users via Firebase)
 * @param {string} newsId - Unique ID of the news item
 */
async function markAsSpoken(newsId) {
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isAvailable()) {
        await FirebaseDB.markNewsAsSpoken(newsId);
    } else {
        // Fallback to localStorage if Firebase not available
        const spoken = JSON.parse(localStorage.getItem('tank_spoken_news') || '[]');
        if (!spoken.includes(newsId)) {
            spoken.push(newsId);
            if (spoken.length > 500) spoken.shift();
            localStorage.setItem('tank_spoken_news', JSON.stringify(spoken));
        }
    }
}

/**
 * Check if a news item was already spoken (by ANY user)
 * @param {string} newsId - Unique ID of the news item
 * @returns {Promise<boolean>} True if already spoken, false otherwise
 */
async function wasAlreadySpoken(newsId) {
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isAvailable()) {
        return await FirebaseDB.wasNewsSpoken(newsId);
    } else {
        // Fallback to localStorage
        const spoken = JSON.parse(localStorage.getItem('tank_spoken_news') || '[]');
        return spoken.includes(newsId);
    }
}

/**
 * Add message to speech queue for automatic reading
 *
 * IMPORTANT: This function is for AUTOMATIC speech only.
 * - NEWS, PREDICTIONS, KNOWLEDGE → Added automatically
 * - MARKET → NOT added automatically (only speaks when user clicks "CLICK TO HEAR")
 *
 * CRITICAL RULE: Each news is spoken ONLY ONCE - shared across ALL users via Firebase
 * - If ONE user heard it, NO user will hear it again
 * - Uses Firebase 'spoken_news' collection to sync across all users
 * - If user wasn't on page when news arrived, they won't hear it
 * - Only NEW news (that arrived AFTER page opened) will be spoken
 *
 * @param {string} text - Text to speak
 * @param {string} itemId - Unique ID to prevent duplicates
 * @param {boolean} isInitialLoad - Whether this is part of initial page load
 */
async function addToSpeechQueue(text, itemId, isInitialLoad = false) {
    // IMPORTANT: Check if voice AND sound are enabled BEFORE adding to queue
    if (!STATE.voiceEnabled || !STATE.soundEnabled) {
        console.log('🔇 Voice/Sound disabled, skipping speech:', itemId);
        return;
    }

    // CRITICAL: Check if this news was EVER spoken before (Firebase - shared across ALL users)
    const alreadySpoken = await wasAlreadySpoken(itemId);
    if (alreadySpoken) {
        console.log('🔇 News already spoken before (Firebase - any user), skipping:', itemId);
        return;
    }

    // Skip if already spoken in this session
    if (spokenMessages.has(itemId)) {
        console.log('🔇 Already spoken in this session:', itemId);
        return;
    }

    // For initial load, only add first 3 items
    if (isInitialLoad && initialLoadCount >= 3) {
        console.log('🔇 Initial load limit reached, skipping:', itemId);
        return;
    }

    if (isInitialLoad) {
        initialLoadCount++;
    }

    console.log('🔊 Adding to speech queue:', text.substring(0, 50) + '...');

    // Mark as spoken in session and Firebase (forever - for ALL users)
    spokenMessages.add(itemId);
    await markAsSpoken(itemId);

    speechQueue.push({ text, itemId });

    // Start processing queue
    processQueue();
}

/**
 * Process speech queue one by one
 *
 * CRITICAL RULE: Akai Inu can NEVER be interrupted
 * - Must finish speaking current message completely before next
 * - Uses STATE.isSpeaking to ensure no overlap
 * - 2 second pause between messages for natural rhythm
 */
async function processQueue() {
    // IMPORTANT: If voice OR sound is disabled, clear the queue and stop
    if (!STATE.voiceEnabled || !STATE.soundEnabled) {
        console.log('🔇 Voice/Sound disabled, clearing speech queue');
        speechQueue.length = 0; // Clear array
        isProcessingQueue = false;
        return;
    }

    // CRITICAL: Don't start if already speaking or processing
    if (isProcessingQueue || STATE.isSpeaking || speechQueue.length === 0) {
        return;
    }

    isProcessingQueue = true;
    console.log(`📢 Processing speech queue (${speechQueue.length} items)...`);

    while (speechQueue.length > 0) {
        // Check again during processing (in case user disables mid-queue)
        if (!STATE.voiceEnabled || !STATE.soundEnabled) {
            console.log('🔇 Voice/Sound disabled during processing, stopping queue');
            speechQueue.length = 0;
            break;
        }

        const { text, itemId } = speechQueue.shift();
        console.log('🎙️ Speaking:', text.substring(0, 50) + '...', '(', speechQueue.length, 'remaining)');

        // CRITICAL: Wait for speaking to complete fully
        // speakCardContent will set STATE.isSpeaking = true and then false when done
        await speakCardContent(text, false); // Pass false to indicate it's from queue (don't cancel)

        // Pause between messages for natural rhythm (2 seconds)
        console.log('⏸️ Pausing 2 seconds before next message...');
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    isProcessingQueue = false;
    console.log('✅ Speech queue finished');
}

/**
 * Mark initial load as complete
 * After this, all new items will be read automatically
 */
function markInitialLoadComplete() {
    initialLoadDone = true;
    console.log('✅ Initial load complete. All new items will now be read automatically.');
}

/**
 * Create speech text for market data (prices)
 */
function createMarketSpeech(card) {
    const title = card.title || '';
    const content = card.content || '';

    // Extract price and change from content
    const priceMatch = content.match(/\$([\d,]+\.?\d*)/);
    const changeMatch = content.match(/([\-\+]?\d+\.?\d*)%/);

    if (priceMatch && changeMatch) {
        const price = priceMatch[1];
        const change = changeMatch[1];
        const direction = parseFloat(change) > 0 ? 'up' : 'down';

        // Simplify price reading (e.g., "89 thousand" instead of "eighty nine thousand")
        let priceWords = price;
        if (price.includes(',')) {
            const parts = price.split(',');
            if (parts.length === 2) {
                priceWords = `${parts[0]} thousand`;
            }
        }

        return `${title} at ${priceWords} dollars, ${direction} ${Math.abs(parseFloat(change))} percent`;
    }

    // Fallback to title and content
    return `${title}. ${content}`;
}

/**
 * Create speech text for news
 */
function createNewsSpeech(card) {
    return `${card.title}`;
}

/**
 * Create speech text for predictions
 */
function createPredictionSpeech(card) {
    return `${card.title}. ${card.content}`;
}

/**
 * Create speech text for knowledge
 */
function createKnowledgeSpeech(card) {
    return `${card.title}. ${card.content}`;
}

// ============================================
// LIFECYCLE DATA
// ============================================

const LIFECYCLE = [
    { start: 6, end: 9, time: '06:00', text: 'Morning fishing in Arctic frozen waters' },
    { start: 9, end: 12, time: '09:00', text: 'Hot cocoa and financial iceberg analysis' },
    { start: 12, end: 14, time: '12:00', text: 'Executive lunch: fresh Arctic salmon' },
    { start: 14, end: 17, time: '14:00', text: 'Strategic market dive in polar waters' },
    { start: 17, end: 19, time: '18:00', text: 'Contemplating the northern lights' },
    { start: 19, end: 22, time: '20:00', text: 'Whisky on the rocks under polar stars' },
    { start: 22, end: 24, time: '22:00', text: 'Meditation on the eternal ice' },
    { start: 0, end: 6, time: '00:00', text: 'Rest in the executive igloo' }
];

// ============================================
// INVENTORY DATA
// ============================================

const INVENTORY = [
    { id: 'salmon', name: 'Fresh Salmon', desc: 'Straight from Arctic waters', cost: 8, mood: 6, health: 4, vol: 1 },
    { id: 'hotchoco', name: 'Hot Chocolate', desc: 'To warm the flippers', cost: 5, mood: 5, health: 2, vol: 2 },
    { id: 'whisky', name: 'Whisky On The Rocks', desc: 'Cold as an iceberg', cost: 10, mood: 4, health: -1, vol: 5 },
    { id: 'ice', name: 'Premium Ice Cube', desc: 'Crystalline and sophisticated', cost: 3, mood: 2, health: 1, vol: 1 },
    { id: 'newspaper', name: 'Antarctic Times', desc: 'News from the frozen continent', cost: 2, mood: 3, health: 0, vol: 2 },
    { id: 'caviar', name: 'Arctic Caviar', desc: 'Luxury from frozen depths', cost: 15, mood: 5, health: 3, vol: 3 },
    { id: 'tea', name: 'Glacial Mint Tea', desc: 'Refreshing and invigorating', cost: 4, mood: 4, health: 3, vol: -1 },
    { id: 'goldfish', name: 'Golden Fish', desc: 'Rare delicacy from cold waters', cost: 12, mood: 6, health: 5, vol: 2 },
    { id: 'scarf', name: 'Silk Scarf', desc: 'Elegance against the cold', cost: 6, mood: 3, health: 1, vol: 1 },
    { id: 'vodka', name: 'Aurora Borealis Vodka', desc: 'Distilled under the northern lights', cost: 10, mood: 4, health: -2, vol: 6 }
];

// ============================================
// REAL-TIME DATA CACHE
// ============================================

let realTimeCards = [];
let isLoadingData = false;
let lastDataUpdate = null;

// ============================================
// AUTONOMOUS PHRASES
// ============================================

const PHRASES = {
    // Routine phrases (time of day) - ARCTIC THEME
    routine: {
        morning: [
            "The temperature is perfect today... -20°C, just as I prefer.",
            "Nothing like an icy dive to start the day properly.",
            "The Arctic sun is particularly inspiring this morning.",
            "The waters are calm. Time to fish for opportunities."
        ],
        afternoon: [
            "Business flows like the currents of the Antarctic Ocean.",
            "My private iceberg has the finest view of the market.",
            "I prefer my meetings like my habitat: cold and calculated.",
            "The ice creaks beneath my feet. Music to my executive ears."
        ],
        evening: [
            "Time for my strategic dive. The finest fish lurk in the depths.",
            "The aurora borealis never fails to inspire grand ideas.",
            "In the corporate Arctic, only those who can swim survive.",
            "The colours of the polar sky reflect the complexity of the markets."
        ],
        night: [
            "A whisky on the rocks... well, everything here is on the rocks.",
            "The polar stars guard the secrets of the great investors.",
            "Contemplating the aurora borealis is my most sophisticated hobby.",
            "The Arctic night is long. Perfect for deep reflections."
        ]
    },

    // Item reaction phrases - ARCTIC THEME
    items: {
        salmon: [
            "Ah, fresh salmon! Caught in the purest Arctic waters.",
            "Nothing like premium protein from the frozen depths.",
            "Excellent choice. Arctic salmon is simply incomparable."
        ],
        hotchoco: [
            "Hot chocolate... a necessary indulgence in the polar cold.",
            "Warms the flippers and the executive soul.",
            "Ah, comforting warmth amidst the eternal ice."
        ],
        whisky: [
            "Whisky on the rocks... quite literally, here in the Arctic.",
            "Cold as my negotiator's heart. Perfect.",
            "The amber liquid glows like the aurora borealis."
        ],
        ice: [
            "Premium ice. Crystalline as my market vision.",
            "Ah, the purity of ancient ice. Absolute sophistication.",
            "A perfect cube for a perfect tank."
        ],
        newspaper: [
            "The Antarctic Times... the coldest news in the market.",
            "Let us see what transpires on the frozen continent today.",
            "Information is power, even at extreme latitudes."
        ],
        caviar: [
            "Arctic caviar! From the most exclusive depths.",
            "Luxury from frozen waters. You know me well.",
            "The finest roe in the northern hemisphere."
        ],
        tea: [
            "Glacial mint tea... refreshing as a polar breeze.",
            "Invigorates the body and sharpens the strategic mind.",
            "Arctic mint has a rather unique flavour."
        ],
        goldfish: [
            "Golden fish! A rarity from the cold currents.",
            "A delicacy worthy of an executive of my calibre.",
            "The gold of the Arctic Ocean. Excellent choice."
        ],
        scarf: [
            "A silk scarf... elegance against the biting cold.",
            "Style and function. The pillars of Arctic fashion.",
            "Sophisticated comfort for meetings on the ice."
        ],
        vodka: [
            "Aurora Borealis Vodka... distilled beneath the northern lights.",
            "The spirit of the Arctic in liquid form.",
            "Crystalline as ice, strong as a polar bear."
        ]
    },

    // Random idle phrases - ARCTIC THEME
    idle: [
        "Market currents are as unpredictable as those of the Arctic...",
        "My personal iceberg has appreciated nicely this quarter.",
        "Strategy is like swimming beneath the ice: it requires absolute precision.",
        "A tank of my calibre knows when to dive and when to wait.",
        "The financial temperature is in freefall... just as I prefer.",
        "In the Arctic of business, only the most adapted prosper.",
        "The aurora borealis reminds me of growth charts.",
        "Patience is a virtue... especially at -30 degrees.",
        "Icebergs show only 10%. Much like sound investments.",
        "The cold sharpens the mind. Hence my remarkable perspicacity.",
        "Each snowflake is unique. As is each opportunity.",
        "The silence of the Arctic is conducive to grand decisions.",
        "My portfolio is as solid as the permafrost.",
        "Global thawing concerns me... yet it opens new markets.",
        "Socrates said he knew nothing. I rather disagree. Particularly regarding ice."
    ]
};

// Interval between random speeches (30-60 seconds)
const IDLE_SPEECH_MIN = 30000;
const IDLE_SPEECH_MAX = 60000;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Firebase FIRST so listeners are ready
    initFirebaseListeners();

    // Then initialize everything else
    initClock();
    initThreeJS();
    initVoice();
    initRadio();
    initKnowledge();
    initNewsfeed();
    initTankView();
    initTicks();
    updateStats();
    initAutonomousSpeech();
    initArcticEffects();
    initAutoObservations();
    initTimestampUpdater();
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
    const isReady = FirebaseDB.init();

    if (!isReady) {
        console.log('Firebase initialization failed, using localStorage');
        return;
    }

    console.log('🔥 Firebase listeners starting...');

    // Listen to knowledge updates from Firebase with REAL-TIME detection
    let isFirstLoad = true;
    FirebaseDB.listenToKnowledgeWithChanges((items, changes) => {
        console.log(`🔥 Firebase: Knowledge event - ${items.length} total items`);

        // Update STATE with all items
        STATE.knowledgeDB = items;
        updateKnowledgeCount();

        // If this is the first load, just render without triggering reactions
        if (isFirstLoad) {
            console.log('📚 Initial knowledge load:', items.length, 'items');
            // Load all items into realTimeCards
            items.forEach(item => {
                addKnowledgeToCards(item, false); // false = don't trigger Akai Inu
            });
            renderArchivesFeed();
            isFirstLoad = false;
            return;
        }

        // Process changes for real-time updates
        if (changes && changes.length > 0) {
            // Use async IIFE to support await
            (async () => {
                for (const change of changes) {
                    if (change.type === 'added') {
                        const newItem = change.doc.data();
                        newItem.id = change.doc.id;
                        console.log('✨ NEW knowledge detected:', newItem.title);

                        // Add to cards and trigger Akai Inu reaction
                        await addKnowledgeToCards(newItem, true); // true = trigger Akai Inu
                        await onKnowledgeAdded(newItem);
                    }
                    if (change.type === 'removed') {
                        const removedId = change.doc.id;
                        console.log('🗑️ Knowledge removed:', removedId);
                        // Remove from realTimeCards
                        const index = realTimeCards.findIndex(c => c.id === removedId);
                        if (index !== -1) {
                            realTimeCards.splice(index, 1);
                        }
                    }
                }
                renderArchivesFeed();
            })();
        }
    });

    // Listen to news updates from Firebase
    FirebaseDB.listenToNews((news) => {
        console.log('Firebase: News updated', news.length, 'items');
        // Update realTimeCards with news from Firebase
        const apiCards = news.map(item => ({
            id: item.id || 'fb_' + Date.now(),
            icon: '📰',
            category: item.category || 'news',
            source: item.source || 'NEWS',
            title: item.title,
            content: item.content || item.description || '',
            date: item.date || new Date(item.timestamp).toLocaleDateString(),
            timestamp: item.timestamp,
            url: item.url
        }));

        // Detect NEW news cards
        const oldCardIds = new Set(realTimeCards.map(c => c.id));
        const newNewsCards = apiCards.filter(c => !oldCardIds.has(c.id));

        // Keep user knowledge, replace API data
        const userCards = realTimeCards.filter(c => c.isUserKnowledge);
        realTimeCards = [...userCards, ...apiCards];

        // AUTOMATIC SPEECH: Add new news to speech queue
        // ONLY if initial load is complete (don't read history)
        if (newNewsCards.length > 0 && initialLoadDone) {
            console.log(`📰 ${newNewsCards.length} new news items - adding to speech queue`);
            // Use for...of to support async/await
            (async () => {
                for (const card of newNewsCards) {
                    const speechText = createNewsSpeech(card);
                    await addToSpeechQueue(speechText, card.id, false);
                }
            })();
        }

        renderArchivesFeed();
    });

    // Listen to status updates from Firebase
    FirebaseDB.listenToStatus((status) => {
        console.log('Firebase: Status updated');
        if (status.temp) {
            STATE.temp = parseInt(status.temp);
            localStorage.setItem('arcticTemp', status.temp);
        }
        if (status.ice) {
            STATE.ice = parseInt(status.ice);
            localStorage.setItem('arcticIce', status.ice);
        }
        if (status.snow) localStorage.setItem('arcticSnow', status.snow);
        if (status.aurora) localStorage.setItem('arcticAurora', status.aurora);
        updateWeatherDisplays();
    });

    console.log('Firebase listeners initialized');
}

// Update weather displays when Firebase status changes
function updateWeatherDisplays() {
    const tempEl = document.getElementById('temperature');
    const condEl = document.getElementById('condition');

    if (tempEl) tempEl.textContent = `${STATE.temp}°C`;
    if (condEl) {
        if (STATE.temp <= -20) condEl.textContent = 'EXTREME COLD';
        else if (STATE.temp <= -10) condEl.textContent = 'FREEZING';
        else if (STATE.temp <= 0) condEl.textContent = 'COLD';
        else condEl.textContent = 'MILD';
    }
}

// ============================================
// VISUAL EFFECTS - REMOVED
// ============================================

// Snowfall effect removed for cleaner UI

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
// ARCTIC EFFECTS - PERSISTENT VALUES
// ============================================

// Default values if nothing in localStorage
const ARCTIC_DEFAULTS = {
    temp: -15,
    ice: 85,
    snow: 'HEAVY',
    aurora: 'VISIBLE',
    ticks: 0,
    mood: 75,
    health: 80,
    vol: 45
};

function initArcticEffects() {
    // Load persistent weather from localStorage (or use defaults)
    loadPersistentWeather();

    // Start ticks counter
    initTicksCounter();

    // Gradual temperature drift every 10 minutes (subtle, 1-2 degrees)
    setInterval(() => {
        driftTemperature();
    }, 10 * 60 * 1000); // Every 10 minutes
}

// Load weather from localStorage or set defaults
function loadPersistentWeather() {
    const savedTemp = localStorage.getItem('arcticTemp');

    if (savedTemp !== null) {
        // Use saved values
        const temp = parseInt(savedTemp) || ARCTIC_DEFAULTS.temp;
        const ice = parseInt(localStorage.getItem('arcticIce')) || ARCTIC_DEFAULTS.ice;
        const snow = localStorage.getItem('arcticSnow') || ARCTIC_DEFAULTS.snow;
        const aurora = localStorage.getItem('arcticAurora') || ARCTIC_DEFAULTS.aurora;

        updateWeatherDisplay(temp, ice, snow, aurora);
        console.log('🌡️ Weather loaded from localStorage:', { temp, ice, snow, aurora });
    } else {
        // First time - set defaults
        const { temp, ice, snow, aurora } = ARCTIC_DEFAULTS;
        saveWeatherToStorage(temp, ice, snow, aurora);
        updateWeatherDisplay(temp, ice, snow, aurora);
        console.log('🌡️ Weather initialized with defaults:', { temp, ice, snow, aurora });
    }
}

// Update weather display elements
function updateWeatherDisplay(temp, ice, snow, aurora) {
    const tempEl = document.getElementById('tempValue');
    const iceEl = document.getElementById('iceValue');
    if (tempEl) tempEl.textContent = `${temp}°C`;
    if (iceEl) iceEl.textContent = `${ice}%`;
}

// Save weather to localStorage
function saveWeatherToStorage(temp, ice, snow, aurora) {
    localStorage.setItem('arcticTemp', temp.toString());
    localStorage.setItem('arcticIce', ice.toString());
    localStorage.setItem('arcticSnow', snow);
    localStorage.setItem('arcticAurora', aurora);
    localStorage.setItem('weatherLastUpdate', Date.now().toString());
}

// Change temperature by delta (called by events)
function changeTemperature(delta) {
    let temp = parseInt(localStorage.getItem('arcticTemp')) || ARCTIC_DEFAULTS.temp;
    temp = Math.max(-40, Math.min(-5, temp + delta)); // Clamp between -40 and -5

    const ice = parseInt(localStorage.getItem('arcticIce')) || ARCTIC_DEFAULTS.ice;
    const snow = localStorage.getItem('arcticSnow') || ARCTIC_DEFAULTS.snow;
    const aurora = localStorage.getItem('arcticAurora') || ARCTIC_DEFAULTS.aurora;

    saveWeatherToStorage(temp, ice, snow, aurora);
    updateWeatherDisplay(temp, ice, snow, aurora);

    // Save to Firebase for real-time sync across users
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isAvailable()) {
        FirebaseDB.saveStatus({
            temp: temp,
            ice: ice,
            snow: snow,
            aurora: aurora,
            mood: STATE.mood,
            health: STATE.health,
            volatility: STATE.volatility
        });
    }

    console.log('🌡️ Temperature changed by', delta, '→', temp + '°C');
}

// Gradual temperature drift (every 10 minutes)
function driftTemperature() {
    const drift = Math.random() > 0.5 ? 1 : -1; // +1 or -1 degree
    changeTemperature(drift);
    console.log('🌡️ Temperature drifted by', drift);
}

// Initialize ticks counter
function initTicksCounter() {
    let ticks = parseInt(localStorage.getItem('arcticTicks')) || 0;
    const ticksEl = document.getElementById('tickCount');
    if (ticksEl) ticksEl.textContent = ticks;

    // Increment every second
    setInterval(() => {
        ticks++;
        localStorage.setItem('arcticTicks', ticks.toString());
        if (ticksEl) ticksEl.textContent = ticks;
    }, 1000);
}

// Update arctic weather (for external events like feeding)
function updateArcticWeather() {
    // Just refresh display from localStorage
    loadPersistentWeather();
}

// ============================================
// THREE.JS
// ============================================

function initThreeJS() {
    const container = document.getElementById('modelViewer');
    const canvas = document.getElementById('canvas3d');

    // Scene - Ice blue background
    STATE.scene = new THREE.Scene();
    STATE.scene.background = new THREE.Color(0xccd6e3);

    // Camera - focused on face (high position looking at head)
    const aspect = container.clientWidth / container.clientHeight;
    STATE.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    STATE.camera.position.set(0, 2.5, 3);

    // Renderer - ice blue background
    STATE.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    STATE.renderer.setClearColor(0xccd6e3, 1);
    STATE.renderer.setSize(container.clientWidth, container.clientHeight);
    STATE.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    STATE.renderer.outputColorSpace = THREE.SRGBColorSpace;
    STATE.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    STATE.renderer.toneMappingExposure = 1.0;

    // Lighting - Arctic Aurora Theme
    const ambient = new THREE.AmbientLight(0x88a4b8, 0.4);
    STATE.scene.add(ambient);

    const mainLight = new THREE.DirectionalLight(0xe8f4f8, 1);
    mainLight.position.set(5, 10, 7);
    STATE.scene.add(mainLight);

    // Aurora green light
    const auroraLight = new THREE.DirectionalLight(0x4adeab, 0.3);
    auroraLight.position.set(-5, 8, -5);
    STATE.scene.add(auroraLight);

    // Ice blue rim light
    const rimLight = new THREE.DirectionalLight(0x88d4f7, 0.4);
    rimLight.position.set(0, -5, -10);
    STATE.scene.add(rimLight);

    // Subtle pink aurora accent
    const pinkLight = new THREE.PointLight(0xf788b0, 0.2, 50);
    pinkLight.position.set(10, 5, -10);
    STATE.scene.add(pinkLight);

    // Camera looks at head position
    STATE.camera.lookAt(0, 2.0, 0);

    // Mouse tracking - tank follows cursor
    document.addEventListener('mousemove', onMouseMove);

    // Load Model
    loadModel();

    // Resize
    window.addEventListener('resize', onResize);

    // Animate
    animate();
}

function loadModel() {
    const loader = new GLTFLoader();
    const loadingEl = document.getElementById('modelLoading');

    loader.load(
        CONFIG.modelPath,
        (gltf) => {
            STATE.model = gltf.scene;

            // ========================================
            // DEBUG: Lista TODAS as meshes do modelo
            // ========================================
            console.log('========================================');
            console.log('=== MODEL MESHES ===');
            console.log('========================================');
            STATE.model.traverse((child) => {
                if (child.isMesh) {
                    console.log('Name:', child.name, '| Type:', child.type);
                }
            });
            console.log('========================================');

            // Scale and position model with face as focus
            const box = new THREE.Box3().setFromObject(STATE.model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            // Scale model
            const scale = 2.5 / Math.max(size.x, size.y, size.z);
            STATE.model.scale.multiplyScalar(scale);

            // Recalculate after scaling
            box.setFromObject(STATE.model);
            box.getCenter(center);
            const min = box.min;

            // Position model inside pivot
            STATE.model.position.x = -center.x;
            STATE.model.position.z = -center.z;
            STATE.model.position.y = -min.y;

            // Create pivot container for mouse rotation
            STATE.modelPivot = new THREE.Group();
            STATE.modelPivot.add(STATE.model);
            STATE.scene.add(STATE.modelPivot);

            // Save original scale for breathing animation
            STATE.originalScale = {
                x: STATE.model.scale.x,
                y: STATE.model.scale.y,
                z: STATE.model.scale.z
            };

            // ========================================
            // ANIMATION SETUP - Play morph target animations
            // ========================================
            if (gltf.animations && gltf.animations.length > 0) {
                console.log('========================================');
                console.log('=== ANIMATIONS FOUND ===');
                console.log('Number of animations:', gltf.animations.length);
                gltf.animations.forEach((clip, index) => {
                    console.log(`Animation ${index}:`, clip.name, '| Duration:', clip.duration.toFixed(2), 's');
                });
                console.log('========================================');

                // Create AnimationMixer
                STATE.mixer = new THREE.AnimationMixer(STATE.model);

                // Play all animations in loop
                gltf.animations.forEach((clip, index) => {
                    const action = STATE.mixer.clipAction(clip);
                    action.setLoop(THREE.LoopRepeat);
                    action.play();
                    console.log(`✅ Playing animation ${index}: ${clip.name}`);
                });
            } else {
                console.log('⚠️ No animations found in model');
            }

            loadingEl.classList.add('hidden');
        },
        (progress) => {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            loadingEl.textContent = `Loading... ${pct}%`;
        },
        (error) => {
            console.error('Model load error:', error);
            loadingEl.textContent = 'Failed to load model';
        }
    );
}

function onResize() {
    const container = document.getElementById('modelViewer');
    STATE.camera.aspect = container.clientWidth / container.clientHeight;
    STATE.camera.updateProjectionMatrix();
    STATE.renderer.setSize(container.clientWidth, container.clientHeight);
}

function onMouseMove(event) {
    // Normalize mouse position to -1 to 1
    const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    const mouseY = (event.clientY / window.innerHeight) * 2 - 1;

    // Set target rotation (max ~15 degrees = 0.26 radians)
    STATE.targetRotationY = mouseX * 0.25;
    STATE.targetRotationX = mouseY * 0.1;
}

function animate() {
    requestAnimationFrame(animate);

    // Update animation mixer for morph target animations
    const delta = STATE.clock.getDelta();
    if (STATE.mixer) {
        STATE.mixer.update(delta);
    }

    // Smooth mouse follow - rotate the PIVOT only
    if (STATE.modelPivot) {
        STATE.currentRotationY += (STATE.targetRotationY - STATE.currentRotationY) * 0.05;
        STATE.currentRotationX += (STATE.targetRotationX - STATE.currentRotationX) * 0.05;
        STATE.modelPivot.rotation.y = STATE.currentRotationY;
        STATE.modelPivot.rotation.x = STATE.currentRotationX;
    }

    // Breathing animation - subtle scale on Y axis
    if (STATE.model && STATE.originalScale) {
        STATE.breathTime += 0.015; // slow breathing
        const breath = 1 + Math.sin(STATE.breathTime) * 0.005; // 0.5% scale variation
        STATE.model.scale.y = STATE.originalScale.y * breath;
    }

    STATE.renderer.render(STATE.scene, STATE.camera);
}

// ============================================
// DEBUG FUNCTIONS
// ============================================

window.listMorphTargets = function() {
    if (!STATE.model) {
        console.log('❌ Model not loaded yet');
        return;
    }

    console.log('========================================');
    console.log('=== MORPH TARGETS ===');
    STATE.model.traverse((child) => {
        if (child.isMesh && child.morphTargetDictionary) {
            console.log('Mesh:', child.name);
            console.log('Morph Targets:', child.morphTargetDictionary);
            console.log('Influences:', child.morphTargetInfluences);
        }
    });
    console.log('========================================');
};

// Global function to test full TTS pipeline
window.testTTS = function() {
    console.log('========================================');
    console.log('FULL TTS PIPELINE TEST');
    console.log('========================================');
    console.log('1. speechSynthesis supported?', 'speechSynthesis' in window);
    console.log('2. Voices loaded:', STATE.voices.length);
    console.log('3. soundEnabled:', STATE.soundEnabled);
    console.log('4. voiceEnabled:', STATE.voiceEnabled);
    console.log('5. mixer exists?', STATE.mixer !== null);
    console.log('6. isSpeaking:', STATE.isSpeaking);
    console.log('========================================');
    console.log('Starting speech test...');

    // Force sound enabled for test
    const originalSound = STATE.soundEnabled;
    STATE.soundEnabled = true;

    speakText('This is a test of the speech system.').then(() => {
        console.log('========================================');
        console.log('TEST COMPLETE');
        console.log('========================================');
        STATE.soundEnabled = originalSound;
    });
};

window.debugState = function() {
    console.log('========================================');
    console.log('DEBUG STATE');
    console.log('1. model:', STATE.model);
    console.log('2. mixer:', STATE.mixer);
    console.log('3. soundEnabled:', STATE.soundEnabled);
    console.log('4. voiceEnabled:', STATE.voiceEnabled);
    console.log('5. isSpeaking:', STATE.isSpeaking);
    console.log('========================================');
};

// ============================================
// LIFECYCLE - REMOVED
// ============================================

// Lifecycle feature removed for cleaner UI

// ============================================
// INVENTORY - REMOVED
// ============================================

// Inventory/Feed feature removed for cleaner UI

function updateStats() {
    document.getElementById('moodValue').textContent = `${STATE.mood}%`;
    document.getElementById('healthValue').textContent = `${STATE.health}%`;
    document.getElementById('volValue').textContent = `${STATE.volatility}%`;
    document.getElementById('moodBar').style.width = `${STATE.mood}%`;
    document.getElementById('healthBar').style.width = `${STATE.health}%`;
    document.getElementById('volBar').style.width = `${STATE.volatility}%`;
}

// ============================================
// AUTONOMOUS SPEECH SYSTEM
// ============================================

function initAutonomousSpeech() {
    // Initial speech based on time of day
    setTimeout(() => {
        speakRoutinePhrase();
    }, 3000);

    // Random speeches every 30-60 seconds
    scheduleIdleSpeech();

    // Speak when the period of day changes
    setInterval(() => {
        const hour = new Date().getHours();
        const minutes = new Date().getMinutes();
        // Speak at the start of each period (minute 0)
        if (minutes === 0) {
            speakRoutinePhrase();
        }
    }, 60000);
}

function scheduleIdleSpeech() {
    const delay = IDLE_SPEECH_MIN + Math.random() * (IDLE_SPEECH_MAX - IDLE_SPEECH_MIN);
    setTimeout(() => {
        if (!STATE.isSpeaking) {
            speakIdlePhrase();
        }
        scheduleIdleSpeech();
    }, delay);
}

function getCurrentPeriod() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
}

// Get appropriate greeting based on time of day
function getGreeting() {
    const hour = new Date().getHours();

    if (hour >= 5 && hour < 12) {
        return "Good morning";
    } else if (hour >= 12 && hour < 18) {
        return "Good afternoon";
    } else if (hour >= 18 && hour < 22) {
        return "Good evening";
    } else {
        return "Good night";
    }
}

// Get intro message with appropriate greeting
function getIntroMessage() {
    const greeting = getGreeting();
    return `${greeting}. I am Akai Inu, your distinguished executive companion from the Arctic. I analyse markets, track investments, and offer refined insights on finance, art, and philosophy. The cold sharpens the mind, you see.`;
}

async function speakRoutinePhrase() {
    const period = getCurrentPeriod();

    // Try AI if available
    if (STATE.groqApiKey) {
        const prompts = {
            morning: 'Make a brief comment about the morning, coffee, or financial markets.',
            afternoon: 'Make a brief comment about business, meetings or market analysis.',
            evening: 'Make a brief comment about portfolio review or networking.',
            night: 'Make a brief comment about whisky, philosophy or evening reflections.'
        };

        const aiResponse = await callGroqAPI(prompts[period], getRoutineContext());
        if (aiResponse) {
            tankSpeak(aiResponse);
            return;
        }
    }

    // Fallback to pre-programmed phrases
    const phrases = PHRASES.routine[period];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    tankSpeak(phrase);
}

async function speakItemReaction(itemId) {
    const item = INVENTORY.find(i => i.id === itemId);
    if (!item) return;

    // Try AI if available
    if (STATE.groqApiKey) {
        const prompt = `The user gave me "${item.name}" (${item.desc}). React briefly and sophisticatedly.`;
        const aiResponse = await callGroqAPI(prompt);
        if (aiResponse) {
            tankSpeak(aiResponse);
            return;
        }
    }

    // Fallback to pre-programmed phrases
    const phrases = PHRASES.items[itemId];
    if (phrases) {
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        tankSpeak(phrase);
    }
}

async function speakIdlePhrase() {
    // 20% chance to reference knowledge base if there's knowledge
    if (STATE.knowledgeDB.length > 0 && Math.random() < 0.2) {
        speakKnowledgeReference();
        return;
    }

    // Try AI if available
    if (STATE.groqApiKey) {
        const prompts = [
            'Make a brief reflection on financial markets or the economy.',
            'Make a brief philosophical comment.',
            'Say something sophisticated about the art of negotiation.',
            'Make an ironic observation about the corporate world.',
            'Briefly quote a philosopher with an elegant comment.',
            'Make a comment about investment strategy.'
        ];
        const prompt = prompts[Math.floor(Math.random() * prompts.length)];
        const aiResponse = await callGroqAPI(prompt, getRoutineContext());
        if (aiResponse) {
            tankSpeak(aiResponse);
            return;
        }
    }

    // Fallback to pre-programmed phrases
    const phrase = PHRASES.idle[Math.floor(Math.random() * PHRASES.idle.length)];
    tankSpeak(phrase);
}

async function speakKnowledgeReference() {
    const item = STATE.knowledgeDB[Math.floor(Math.random() * STATE.knowledgeDB.length)];
    const preview = item.text.substring(0, 100);

    // Try AI if available
    if (STATE.groqApiKey) {
        const prompt = `You have this information in your knowledge base: "${preview}". Make a brief, sophisticated reference to it.`;
        const aiResponse = await callGroqAPI(prompt);
        if (aiResponse) {
            tankSpeak(aiResponse);
            return;
        }
    }

    // Fallback to pre-programmed phrases
    const templates = [
        `According to my notes... "${preview.substring(0, 40)}..."`,
        `I recall documenting something about "${preview.substring(0, 40)}..."`,
        `My archives indicate... "${preview.substring(0, 40)}..."`,
        `Ah yes, I recorded: "${preview.substring(0, 40)}..."`,
        `From my knowledge base... "${preview.substring(0, 40)}..."`
    ];

    const phrase = templates[Math.floor(Math.random() * templates.length)];
    tankSpeak(phrase);
}

function tankSpeak(text) {
    // Add to speech log
    addSpeechEntry(text);

    // Speak with TTS if enabled
    if (STATE.voiceEnabled && STATE.soundEnabled) {
        speakText(text);
    }
}

function addSpeechEntry(text) {
    const container = document.getElementById('speechLog');
    const div = document.createElement('div');
    div.className = 'speech-entry';
    div.innerHTML = `<span class="speech-text">"${escapeHtml(text)}"</span>`;

    // Remove entradas antigas (manter apenas 3)
    while (container.children.length >= 3) {
        container.removeChild(container.firstChild);
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ============================================
// GROQ AI API
// ============================================

async function callGroqAPI(userMessage, context = '') {
    if (!STATE.groqApiKey) {
        console.log('⚠️ Groq API key not configured, using fallback');
        return null;
    }

    try {
        const messages = [
            { role: 'system', content: CONFIG.groq.systemPrompt },
        ];

        if (context) {
            messages.push({ role: 'system', content: `Additional context: ${context}` });
        }

        messages.push({ role: 'user', content: userMessage });

        const response = await fetch(CONFIG.groq.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${STATE.groqApiKey}`
            },
            body: JSON.stringify({
                model: CONFIG.groq.model,
                messages: messages,
                max_tokens: 150,
                temperature: 0.9
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('❌ Groq API error:', error);
            return null;
        }

        const data = await response.json();
        const reply = data.choices[0]?.message?.content?.trim();
        console.log('✅ Groq response:', reply);
        return reply;
    } catch (error) {
        console.error('❌ Groq API call failed:', error);
        return null;
    }
}

function getRoutineContext() {
    const period = getCurrentPeriod();
    const hour = new Date().getHours();
    const temp = -10 - Math.floor(Math.random() * 15);
    const contexts = {
        morning: `It's ${hour}:00 in the Arctic, temperature ${temp}°C. Time for an icy dive, hot chocolate and reviewing the financial icebergs. The polar sun is rising.`,
        afternoon: `It's ${hour}:00 in the Arctic, ${temp}°C. Time for strategic dives, market current analysis and meetings on the ice.`,
        evening: `It's ${hour}:00 in the Arctic, ${temp}°C. The aurora borealis is appearing. Time to contemplate, review the portfolio and appreciate the northern lights.`,
        night: `It's ${hour}:00 at night in the Arctic, ${temp}°C. The polar stars are shining. Time for whisky on the rocks, deep reflections and contemplating the eternal ice.`
    };
    return contexts[period] || contexts.afternoon;
}

// ============================================
// AUTO OBSERVATIONS SYSTEM
// ============================================

const AUTO_OBSERVATION_CONFIG = {
    minInterval: 2 * 60 * 1000,  // 2 minutes
    maxInterval: 5 * 60 * 1000,  // 5 minutes
    maxAutoEntries: 50,
    types: ['Observation', 'Market', 'Prediction', 'Note'],
    prompt: `You are Akai Inu, a sophisticated tank executive. Generate a short observation (1-2 sentences) about one of these topics:
- Arctic market conditions and fish stock prices
- Weather observations from the polar perspective
- Philosophical thoughts about ice, patience, or business
- Investment insights with arctic metaphors
- Observations about the eternal polar night/day

Respond with ONLY the observation text, nothing else. Be witty and sophisticated.`
};

function initAutoObservations() {
    // Only run if Groq API is configured
    if (!STATE.groqApiKey) {
        console.log('⚠️ Auto-observations disabled: No Groq API key');
        return;
    }

    console.log('🐧 Auto-observations system initialized');

    // Schedule first observation after 1-2 minutes
    const firstDelay = 60000 + Math.random() * 60000;
    setTimeout(() => {
        generateAutoObservation();
        scheduleNextObservation();
    }, firstDelay);
}

function scheduleNextObservation() {
    const delay = AUTO_OBSERVATION_CONFIG.minInterval +
        Math.random() * (AUTO_OBSERVATION_CONFIG.maxInterval - AUTO_OBSERVATION_CONFIG.minInterval);

    console.log(`⏰ Next auto-observation in ${Math.round(delay / 60000)} minutes`);

    setTimeout(() => {
        generateAutoObservation();
        scheduleNextObservation();
    }, delay);
}

async function generateAutoObservation() {
    if (!STATE.groqApiKey) return;

    // Don't generate if Akai Inu is speaking
    if (STATE.isSpeaking) {
        console.log('🐧 Skipping auto-observation: Akai Inu is speaking');
        return;
    }

    try {
        console.log('🐧 Generating auto-observation...');

        // Call Groq API with observation prompt
        const response = await fetch(CONFIG.groq.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${STATE.groqApiKey}`
            },
            body: JSON.stringify({
                model: CONFIG.groq.model,
                messages: [
                    { role: 'system', content: AUTO_OBSERVATION_CONFIG.prompt },
                    { role: 'user', content: 'Generate an observation now.' }
                ],
                max_tokens: 100,
                temperature: 0.95
            })
        });

        if (!response.ok) {
            console.error('❌ Auto-observation API error');
            return;
        }

        const data = await response.json();
        const observationText = data.choices[0]?.message?.content?.trim();

        if (!observationText) {
            console.error('❌ Empty observation from API');
            return;
        }

        // Determine type based on content
        const type = determineObservationType(observationText);

        // Create knowledge entry
        const knowledge = {
            id: Date.now(),
            type: type,
            text: observationText,
            url: '',
            author: 'MR. TANK',
            date: new Date().toISOString().split('T')[0],
            timestamp: Date.now(),
            tags: ['auto', 'tank-thought', type.toLowerCase()],
            auto: true
        };

        // Clean up old auto entries if over limit
        cleanupAutoObservations();

        // Save to Firebase (will update via listener)
        saveKnowledgeToFirebase(knowledge);

        console.log(`✅ Auto-observation added: "${observationText.substring(0, 50)}..."`);

        // Akai Inu speaks the observation
        addSpeechEntry(observationText);
        tankSpeak(`I've just noted: ${observationText}`);

        showToast('Akai Inu added an observation', 'success');

    } catch (error) {
        console.error('❌ Auto-observation error:', error);
    }
}

function determineObservationType(text) {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('market') || lowerText.includes('price') ||
        lowerText.includes('stock') || lowerText.includes('invest') ||
        lowerText.includes('portfolio') || lowerText.includes('trade')) {
        return 'Market';
    }

    if (lowerText.includes('predict') || lowerText.includes('forecast') ||
        lowerText.includes('expect') || lowerText.includes('will be') ||
        lowerText.includes('future') || lowerText.includes('soon')) {
        return 'Prediction';
    }

    if (lowerText.includes('today') || lowerText.includes('noticed') ||
        lowerText.includes('observe') || lowerText.includes('see') ||
        lowerText.includes('weather') || lowerText.includes('ice')) {
        return 'Observation';
    }

    // Random type for variety
    const types = ['Observation', 'Note', 'Market'];
    return types[Math.floor(Math.random() * types.length)];
}

function cleanupAutoObservations() {
    // Count auto entries
    const autoEntries = STATE.knowledgeDB.filter(k => k.auto === true);

    if (autoEntries.length >= AUTO_OBSERVATION_CONFIG.maxAutoEntries) {
        // Find oldest auto entries and remove them
        const toRemove = autoEntries.length - AUTO_OBSERVATION_CONFIG.maxAutoEntries + 1;

        // Sort by timestamp and get oldest
        autoEntries.sort((a, b) => a.timestamp - b.timestamp);
        const idsToRemove = autoEntries.slice(0, toRemove).map(k => k.id);

        // Remove from knowledgeDB
        STATE.knowledgeDB = STATE.knowledgeDB.filter(k => !idsToRemove.includes(k.id));

        console.log(`🧹 Cleaned up ${toRemove} old auto-observations`);
    }
}

// ============================================
// VOICE / TTS
// ============================================

function initVoice() {
    const voiceBtn = document.getElementById('voiceToggle');
    const soundBtn = document.getElementById('soundToggle');

    // Preload voices and store in STATE
    STATE.voices = [];
    if ('speechSynthesis' in window) {
        const loadVoices = () => {
            STATE.voices = window.speechSynthesis.getVoices();
            console.log('✅ Voices loaded:', STATE.voices.length);
            if (STATE.voices.length > 0) {
                const enVoice = STATE.voices.find(v => v.lang.startsWith('en'));
                console.log('   English voice available:', enVoice ? enVoice.name : 'none');
            }
        };

        // Try to load immediately
        loadVoices();

        // Also listen for async load (Chrome needs this)
        window.speechSynthesis.onvoiceschanged = loadVoices;
    } else {
        console.error('❌ Web Speech API not supported in this browser!');
    }

    // Set initial button states from loaded preferences
    voiceBtn.classList.toggle('active', STATE.voiceEnabled);
    soundBtn.classList.toggle('active', STATE.soundEnabled);
    document.getElementById('voiceState').textContent = STATE.voiceEnabled ? 'on' : 'off';
    document.getElementById('soundState').textContent = STATE.soundEnabled ? 'on' : 'off';

    console.log('🎙️ Voice initial:', STATE.voiceEnabled ? 'ON' : 'OFF');
    console.log('🔊 Sound initial:', STATE.soundEnabled ? 'ON' : 'OFF');

    voiceBtn.addEventListener('click', () => {
        STATE.voiceEnabled = !STATE.voiceEnabled;
        voiceBtn.classList.toggle('active', STATE.voiceEnabled);
        document.getElementById('voiceState').textContent = STATE.voiceEnabled ? 'on' : 'off';

        console.log('🎙️ Voice toggled:', STATE.voiceEnabled);

        if (!STATE.voiceEnabled) {
            // IMMEDIATELY stop any current speech
            window.speechSynthesis.cancel();
            STATE.isSpeaking = false;

            // CLEAR the entire speech queue
            speechQueue.length = 0;
            isProcessingQueue = false;

            console.log('🔇 Voice OFF: Speech stopped, queue cleared');
        } else {
            // Speak test when enabling voice
            console.log('🔊 Voice ON: Speech enabled');
            speakText('Voice activated.');
        }
    });

    soundBtn.addEventListener('click', () => {
        STATE.soundEnabled = !STATE.soundEnabled;
        soundBtn.classList.toggle('active', STATE.soundEnabled);
        document.getElementById('soundState').textContent = STATE.soundEnabled ? 'on' : 'off';

        // Save preference to localStorage
        localStorage.setItem('tank_sound_enabled', STATE.soundEnabled);

        if (!STATE.soundEnabled) {
            // IMMEDIATELY stop any current speech
            window.speechSynthesis.cancel();
            STATE.isSpeaking = false;

            // CLEAR the entire speech queue
            speechQueue.length = 0;
            isProcessingQueue = false;

            console.log('🔇 Sound OFF: Speech stopped, queue cleared');
        } else {
            console.log('🔊 Sound ON: Speech enabled');
        }

        console.log('🔊 Sound toggled:', STATE.soundEnabled);
    });
}

async function speakText(text) {
    console.log('📢 speakText() called');
    console.log('   soundEnabled:', STATE.soundEnabled);
    console.log('   text:', text.substring(0, 50) + '...');

    if (!STATE.soundEnabled) {
        console.log('❌ Sound disabled, will not speak');
        return;
    }

    // Show speaking bar
    showSpeakingBar(text);

    console.log('   Using Web Speech API...');
    await speakWebSpeech(text);

    // Hide speaking bar when done
    hideSpeakingBar();
}

// Speaking bar functions
function showSpeakingBar(text) {
    const bar = document.getElementById('speakingBar');
    const textEl = document.getElementById('speakingText');
    if (bar && textEl) {
        textEl.textContent = text;
        bar.classList.add('active');
    }
}

function hideSpeakingBar() {
    const bar = document.getElementById('speakingBar');
    if (bar) {
        bar.classList.remove('active');
    }
}

async function speakWebSpeech(text) {
    return new Promise((resolve) => {
        console.log('🔊 speakWebSpeech() starting...');

        if (!('speechSynthesis' in window)) {
            console.error('❌ Web Speech API not supported');
            resolve();
            return;
        }

        // Cancel any ongoing speech and reset state
        window.speechSynthesis.cancel();
        clearTimeout(STATE.wordTimeout);
        STATE.isWordActive = false;

        // Use cached voices from STATE
        let voices = STATE.voices || window.speechSynthesis.getVoices();
        console.log('   Available voices:', voices.length);

        // If no voices yet, try to get them
        if (voices.length === 0) {
            console.warn('⚠️ No voices loaded yet, trying again...');
            voices = window.speechSynthesis.getVoices();
        }

        const utterance = new SpeechSynthesisUtterance(text);

        // Find a good English voice (prefer British)
        const voice = voices.find(v =>
            v.name.includes('UK') || v.name.includes('British') || v.name.includes('Daniel')
        ) || voices.find(v =>
            v.name.includes('English') || v.lang.startsWith('en')
        ) || voices[0];

        if (voice) {
            utterance.voice = voice;
            console.log('   Voice selected:', voice.name);
        } else {
            console.warn('⚠️ No voice found, using default');
        }

        // Cartoon tank voice - high pitched and animated
        utterance.rate = 1.25;
        utterance.pitch = 1.5;
        utterance.volume = 1.0;

        // Track if onboundary works
        let boundarySupported = false;

        // Detect each word for precise lip sync
        utterance.onboundary = (event) => {
            if (event.name === 'word') {
                boundarySupported = true;
                STATE.isWordActive = true;

                // Close mouth after estimated word duration (150ms)
                clearTimeout(STATE.wordTimeout);
                STATE.wordTimeout = setTimeout(() => {
                    STATE.isWordActive = false;
                }, 150);
            }
        };

        utterance.onstart = () => {
            STATE.isSpeaking = true;
            console.log('🎤 Started speaking - isSpeaking:', STATE.isSpeaking);

            // Fallback: if onboundary doesn't work after 500ms, use simulation
            setTimeout(() => {
                if (!boundarySupported && STATE.isSpeaking) {
                    console.log('⚠️ onboundary not supported, using fallback');
                    simulateWordBoundaries(text);
                }
            }, 500);
        };

        utterance.onend = () => {
            // IMMEDIATELY close mouth
            STATE.isSpeaking = false;
            STATE.isWordActive = false;
            clearTimeout(STATE.wordTimeout);
            console.log('🔇 Stopped speaking - mouth closed');
            resolve();
        };

        utterance.onerror = (event) => {
            STATE.isSpeaking = false;
            STATE.isWordActive = false;
            clearTimeout(STATE.wordTimeout);
            console.error('❌ Speech error:', event.error);
            resolve();
        };

        // Start speaking
        console.log('   Calling speechSynthesis.speak()...');
        window.speechSynthesis.speak(utterance);
        console.log('   speak() called successfully');

        // Chrome bug workaround - speech can pause after ~15 seconds
        const keepAlive = setInterval(() => {
            if (!STATE.isSpeaking) {
                clearInterval(keepAlive);
                return;
            }
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
        }, 10000);
    });
}

// Fallback: simulate word boundaries if browser doesn't support it
function simulateWordBoundaries(text) {
    const words = text.split(/\s+/);
    const avgWordDuration = 280; // ms per word (adjusted for rate 0.9)

    words.forEach((word, index) => {
        if (!STATE.isSpeaking) return;

        setTimeout(() => {
            if (!STATE.isSpeaking) return;

            STATE.isWordActive = true;
            setTimeout(() => {
                STATE.isWordActive = false;
            }, 120); // mouth opening duration
        }, index * avgWordDuration);
    });
}

// ============================================
// RADIO
// ============================================

function initRadio() {
    STATE.radioElement = new Audio();
    STATE.radioElement.volume = 0.5;
    STATE.radioElement.crossOrigin = 'anonymous';

    const playBtn = document.getElementById('radioPlayPause');
    const muteBtn = document.getElementById('radioMute');
    const volumeSlider = document.getElementById('radioVolume');

    playBtn.addEventListener('click', toggleRadio);
    muteBtn.addEventListener('click', toggleRadioMute);
    volumeSlider.addEventListener('input', (e) => {
        STATE.radioElement.volume = e.target.value / 100;
        document.getElementById('volumeValue').textContent = e.target.value;
    });
}

function toggleRadio() {
    const btn = document.getElementById('radioPlayPause');
    if (STATE.radioPlaying) {
        STATE.radioElement.pause();
        STATE.radioPlaying = false;
        btn.textContent = 'play';
    } else {
        STATE.radioElement.src = CONFIG.radioStreams.lofi;
        STATE.radioElement.play().catch(console.error);
        STATE.radioPlaying = true;
        btn.textContent = 'pause';
    }
}

function toggleRadioMute() {
    const btn = document.getElementById('radioMute');
    STATE.radioMuted = !STATE.radioMuted;
    STATE.radioElement.muted = STATE.radioMuted;
    btn.textContent = STATE.radioMuted ? 'unmute' : 'mute';
}

// ============================================
// KNOWLEDGE BASE
// ============================================

function initKnowledge() {
    // Only load from localStorage if Firebase is not available
    // The Firebase listener will handle loading if Firebase is ready
    if (typeof FirebaseDB === 'undefined' || !FirebaseDB.isAvailable()) {
        console.log('📚 Loading knowledge from localStorage (Firebase not available)');
        loadKnowledgeFromStorage();
        updateKnowledgeCount();
    } else {
        console.log('📚 Knowledge will be loaded from Firebase listener');
    }

    // Button listeners - Add Knowledge (now a div in unified panel)
    const addBtn = document.getElementById('btnAddKnowledge');
    if (addBtn) {
        addBtn.addEventListener('click', openUploadModal);
    }

    // Upload Modal
    document.getElementById('closeUploadModal').addEventListener('click', closeUploadModal);
    document.getElementById('cancelUpload').addEventListener('click', closeUploadModal);
    document.getElementById('confirmUpload').addEventListener('click', uploadKnowledge);

    // Graph Modal
    document.getElementById('closeGraphModal').addEventListener('click', closeGraphModal);

    // Expand Modal
    document.getElementById('closeExpandModal').addEventListener('click', closeExpandModal);
    document.getElementById('filterType').addEventListener('change', filterExpandList);
    document.getElementById('filterSearch').addEventListener('input', filterExpandList);

    // Detail Modal
    document.getElementById('closeDetailModal').addEventListener('click', closeDetailModal);
    document.getElementById('closeDetail').addEventListener('click', closeDetailModal);
    document.getElementById('deleteKnowledge').addEventListener('click', deleteCurrentKnowledge);

    // Close modals on background click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
}

function loadKnowledgeFromStorage() {
    const stored = localStorage.getItem('tank_knowledge_db');
    if (stored) {
        try {
            STATE.knowledgeDB = JSON.parse(stored);
        } catch (e) {
            STATE.knowledgeDB = [];
        }
    }

    // Migrate old format if exists
    const oldKnowledge = localStorage.getItem('tank_knowledge');
    if (oldKnowledge && !stored) {
        try {
            const oldData = JSON.parse(oldKnowledge);
            if (Array.isArray(oldData)) {
                oldData.forEach(text => {
                    if (typeof text === 'string') {
                        STATE.knowledgeDB.push({
                            id: generateId(),
                            text: text,
                            url: '',
                            type: 'Note',
                            author: 'anon',
                            timestamp: Date.now(),
                            tags: []
                        });
                    }
                });

                // Migrate old data to Firebase
                STATE.knowledgeDB.forEach(item => {
                    saveKnowledgeToFirebase(item);
                });

                localStorage.removeItem('tank_knowledge');
            }
        } catch (e) {}
    }

    // Load user knowledge into realTimeCards for display in Archives
    loadUserKnowledgeToCards();
}

function loadUserKnowledgeToCards() {
    const typeToCategory = {
        'KNOWLEDGE': 'knowledge',
        'NEWS': 'news',
        'MARKET': 'market',
        'PREDICTION': 'prediction',
        'OBSERVATION': 'observation',
        'Note': 'knowledge',
        'Link': 'knowledge',
        'Article': 'news',
        'Quote': 'knowledge',
        'Fact': 'knowledge'
    };

    const typeToIcon = {
        'KNOWLEDGE': '📚',
        'NEWS': '📰',
        'MARKET': '📈',
        'PREDICTION': '🔮',
        'OBSERVATION': '👁️',
        'Note': '📝',
        'Link': '🔗',
        'Article': '📄',
        'Quote': '💬',
        'Fact': '✓'
    };

    // Filter out old user knowledge from realTimeCards
    realTimeCards = realTimeCards.filter(card => !card.isUserKnowledge);

    // Add user knowledge to realTimeCards
    STATE.knowledgeDB.forEach(knowledge => {
        if (knowledge.isUserKnowledge || knowledge.title) {
            const card = {
                id: knowledge.id,
                category: typeToCategory[knowledge.type] || 'knowledge',
                icon: typeToIcon[knowledge.type] || '📚',
                title: knowledge.title || knowledge.text?.substring(0, 50) || 'Knowledge',
                content: knowledge.content || knowledge.text || '',
                source: knowledge.source || knowledge.author || 'USER',
                date: knowledge.date || new Date(knowledge.timestamp).toISOString().split('T')[0],
                timestamp: knowledge.timestamp || Date.now(),
                url: knowledge.url || '',
                changeValue: 0,
                isUserKnowledge: true
            };
            realTimeCards.unshift(card);
        }
    });

    console.log(`📚 Loaded ${STATE.knowledgeDB.length} user knowledge items`);
}

function saveKnowledgeToStorage() {
    localStorage.setItem('tank_knowledge_db', JSON.stringify(STATE.knowledgeDB));
    updateKnowledgeCount();
}

// Save a single knowledge item to Firebase
async function saveKnowledgeToFirebase(knowledge) {
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isAvailable()) {
        try {
            await FirebaseDB.addKnowledge(knowledge);
        } catch (e) {
            console.error('Error saving knowledge to Firebase:', e);
        }
    }
}

function generateId() {
    return 'kb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function updateKnowledgeCount() {
    const userCount = STATE.knowledgeDB.length;
    const apiCount = realTimeCards.filter(c => !c.isUserKnowledge).length;
    const totalCount = userCount + apiCount;

    const countEl = document.getElementById('knowledgeCount');
    if (countEl) {
        const timeStr = lastDataUpdate ? lastDataUpdate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        }) : '--:--';
        countEl.textContent = `${totalCount} | ${timeStr}`;
    }
}

function renderKnowledgeList() {
    // Knowledge list is now part of the unified archives panel
    // This function is kept for compatibility with modal operations
    const list = document.getElementById('knowledgeList');
    if (!list) return;

    if (STATE.knowledgeDB.length === 0) {
        list.innerHTML = '<div class="kb-empty">No knowledge yet. Click + Add to start.</div>';
        return;
    }

    // Show last 5 items, newest first
    const items = [...STATE.knowledgeDB].slice(0, 5);

    list.innerHTML = items.map(item => {
        const displayType = (item.type || 'KNOWLEDGE').toUpperCase();
        const displayText = item.title || item.text || 'Knowledge';
        const previewText = displayText.substring(0, 60);

        return `
        <div class="kb-item" data-id="${item.id}">
            <div class="kb-item-header">
                <span class="kb-item-type type-${displayType.toLowerCase()}">${displayType}</span>
                <span class="kb-item-date">${formatDate(item.timestamp)}</span>
            </div>
            <div class="kb-item-preview">${escapeHtml(previewText)}${displayText.length > 60 ? '...' : ''}</div>
        </div>
    `}).join('');

    // Add click handlers
    list.querySelectorAll('.kb-item').forEach(el => {
        el.addEventListener('click', () => openDetailModal(el.dataset.id));
    });
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Modal Functions
function openUploadModal() {
    document.getElementById('kbTitle').value = '';
    document.getElementById('kbContent').value = '';
    document.getElementById('kbType').value = 'KNOWLEDGE';
    document.getElementById('kbSource').value = 'USER';
    document.getElementById('kbUrl').value = '';
    document.getElementById('kbTags').value = '';
    document.getElementById('modalUpload').classList.add('active');
}

function closeUploadModal() {
    document.getElementById('modalUpload').classList.remove('active');
}

async function uploadKnowledge() {
    const title = document.getElementById('kbTitle').value.trim();
    const content = document.getElementById('kbContent').value.trim();

    if (!title) {
        showToast('Please enter a title', 'error');
        return;
    }
    if (!content) {
        showToast('Please enter content', 'error');
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const knowledge = {
        id: 'kb_' + Date.now(),
        title: title,
        content: content,
        text: `${title}. ${content}`, // For backward compatibility
        type: document.getElementById('kbType').value,
        source: document.getElementById('kbSource').value.trim() || 'USER',
        url: document.getElementById('kbUrl').value.trim(),
        date: today,
        author: document.getElementById('kbSource').value.trim() || 'USER',
        timestamp: Date.now(),
        tags: document.getElementById('kbTags').value
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0),
        isUserKnowledge: true
    };

    // Save to Firebase - the listener will handle the rest for ALL users
    await saveKnowledgeToFirebase(knowledge);

    closeUploadModal();
    showToast('Knowledge saved to Arctic Archives', 'success');

    // Note: onKnowledgeAdded will be called by the Firebase listener
    // This ensures ALL users (including this one) get the same experience
}

// Add knowledge to realTimeCards (helper function)
async function addKnowledgeToCards(knowledge, triggerReaction = false) {
    // Check if already exists (avoid duplicates)
    const exists = realTimeCards.find(c => c.id === knowledge.id);
    if (exists) {
        console.log('📚 Knowledge already in cards:', knowledge.title);
        return;
    }

    const typeToCategory = {
        'KNOWLEDGE': 'knowledge',
        'NEWS': 'news',
        'MARKET': 'market',
        'PREDICTION': 'prediction',
        'OBSERVATION': 'observation'
    };

    const typeToIcon = {
        'KNOWLEDGE': '📚',
        'NEWS': '📰',
        'MARKET': '📈',
        'PREDICTION': '🔮',
        'OBSERVATION': '👁️'
    };

    const newCard = {
        id: knowledge.id,
        category: typeToCategory[knowledge.type] || 'knowledge',
        icon: typeToIcon[knowledge.type] || '📚',
        title: knowledge.title,
        content: knowledge.content,
        source: knowledge.source,
        date: knowledge.date,
        timestamp: knowledge.timestamp || Date.now(),
        url: knowledge.url,
        changeValue: 0,
        isUserKnowledge: true
    };

    // Add to beginning of realTimeCards
    realTimeCards.unshift(newCard);
    console.log('✅ Added to realTimeCards:', knowledge.title);

    // AUTOMATIC SPEECH: Add to speech queue if triggerReaction is true
    if (triggerReaction) {
        const speechText = createKnowledgeSpeech(newCard);
        await addToSpeechQueue(speechText, knowledge.id, !initialLoadDone);
    }
}

// Called when new knowledge is added (triggers Akai Inu reaction)
// Note: Item should already be in realTimeCards (added by addKnowledgeToCards)
async function onKnowledgeAdded(knowledge) {
    console.log('🎙️ Akai Inu will now speak about:', knowledge.title);

    // Re-render to show the new item
    renderArchivesFeed();

    // 1. Show Tank View popup BEFORE speaking
    showTankView(knowledge.source, knowledge.url, knowledge.type);

    // 2. Akai Inu speaks the knowledge
    const speechText = `New knowledge received. ${knowledge.title}. ${knowledge.content}`;

    // Add to speech log
    addSpeechEntry(`New knowledge: ${knowledge.title}`);

    // 3. Speak it - WAIT for it to complete FULLY
    await speakCardContent(speechText);

    // 4. Wait 2 more seconds AFTER speech finishes
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 5. NOW hide popup (only after speech finished + 2s delay)
    hideTankView();
}

// This function is now replaced by onKnowledgeAdded which handles everything

function openGraphModal() {
    document.getElementById('modalGraph').classList.add('active');
    setTimeout(() => renderKnowledgeGraph(), 100);
}

function closeGraphModal() {
    document.getElementById('modalGraph').classList.remove('active');
}

function renderKnowledgeGraph() {
    const container = document.getElementById('graphContainer');

    if (STATE.knowledgeDB.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 40px;">No knowledge to visualize yet.</div>';
        return;
    }

    // Create nodes from knowledge items
    const nodes = STATE.knowledgeDB.map((item, index) => ({
        id: item.id,
        label: item.text.substring(0, 20) + (item.text.length > 20 ? '...' : ''),
        title: item.text,
        color: getTypeColor(item.type),
        font: { color: '#f4eee1', size: 10 }
    }));

    // Create edges based on shared tags
    const edges = [];
    for (let i = 0; i < STATE.knowledgeDB.length; i++) {
        for (let j = i + 1; j < STATE.knowledgeDB.length; j++) {
            const item1 = STATE.knowledgeDB[i];
            const item2 = STATE.knowledgeDB[j];

            // Check for shared tags
            const sharedTags = item1.tags.filter(t => item2.tags.includes(t));
            if (sharedTags.length > 0) {
                edges.push({
                    from: item1.id,
                    to: item2.id,
                    color: { color: '#333', highlight: '#f4eee1' },
                    width: sharedTags.length
                });
            }

            // Check for similar words in text
            const words1 = item1.text.toLowerCase().split(/\s+/);
            const words2 = item2.text.toLowerCase().split(/\s+/);
            const sharedWords = words1.filter(w =>
                w.length > 4 && words2.includes(w)
            );
            if (sharedWords.length >= 2 && sharedTags.length === 0) {
                edges.push({
                    from: item1.id,
                    to: item2.id,
                    color: { color: '#222', highlight: '#666' },
                    dashes: true
                });
            }
        }
    }

    const data = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };

    const options = {
        nodes: {
            shape: 'dot',
            size: 16,
            borderWidth: 2,
            shadow: true
        },
        edges: {
            smooth: { type: 'continuous' }
        },
        physics: {
            stabilization: { iterations: 100 },
            barnesHut: {
                gravitationalConstant: -2000,
                springLength: 150
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 100
        }
    };

    new vis.Network(container, data, options);
}

function getTypeColor(type) {
    const colors = {
        'Note': '#60a5fa',
        'Link': '#4ade80',
        'Article': '#f472b6',
        'Quote': '#f4eee1',
        'Fact': '#f59e0b'
    };
    return colors[type] || '#666';
}

function openExpandModal() {
    document.getElementById('modalExpand').classList.add('active');
    document.getElementById('filterType').value = 'all';
    document.getElementById('filterSearch').value = '';
    renderExpandList();
}

function closeExpandModal() {
    document.getElementById('modalExpand').classList.remove('active');
}

function filterExpandList() {
    renderExpandList();
}

function renderExpandList() {
    const list = document.getElementById('expandList');
    const typeFilter = document.getElementById('filterType').value;
    const searchFilter = document.getElementById('filterSearch').value.toLowerCase();

    let items = [...STATE.knowledgeDB].reverse();

    // Apply filters
    if (typeFilter !== 'all') {
        items = items.filter(item => item.type === typeFilter);
    }
    if (searchFilter) {
        items = items.filter(item =>
            item.text.toLowerCase().includes(searchFilter) ||
            item.tags.some(t => t.includes(searchFilter))
        );
    }

    if (items.length === 0) {
        list.innerHTML = '<div class="kb-empty">No matching knowledge found.</div>';
        return;
    }

    list.innerHTML = items.map(item => `
        <div class="expand-item" data-id="${item.id}">
            <div class="expand-item-header">
                <span class="kb-item-type type-${item.type.toLowerCase()}">${item.type.toUpperCase()}</span>
                <span class="kb-item-date">${formatDate(item.timestamp)}</span>
            </div>
            <div class="expand-item-text">${escapeHtml(item.text)}</div>
            <div class="expand-item-meta">
                <span>by ${escapeHtml(item.author)}</span>
                ${item.url ? `<span><a href="${escapeHtml(item.url)}" target="_blank">Source</a></span>` : ''}
            </div>
            ${item.tags.length > 0 ? `
                <div class="expand-item-tags">
                    ${item.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}
                </div>
            ` : ''}
        </div>
    `).join('');

    // Add click handlers
    list.querySelectorAll('.expand-item').forEach(el => {
        el.addEventListener('click', () => {
            closeExpandModal();
            openDetailModal(el.dataset.id);
        });
    });
}

let currentDetailId = null;

function openDetailModal(id) {
    const item = STATE.knowledgeDB.find(k => k.id === id);
    if (!item) return;

    currentDetailId = id;

    document.getElementById('detailType').textContent = (item.type || 'KNOWLEDGE').toUpperCase();

    // Handle both old and new knowledge structure
    const contentText = item.title
        ? `${item.title}\n\n${item.content || ''}`
        : item.text || '';
    document.getElementById('detailContent').textContent = contentText;

    const author = item.author || item.source || 'USER';
    const date = item.date || new Date(item.timestamp).toLocaleDateString();
    let meta = `Added by ${author} on ${date}`;

    if (item.url) {
        meta += `<br>Source: <a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.url)}</a>`;
    }
    if (item.tags && item.tags.length > 0) {
        meta += `<br>Tags: ${item.tags.map(t => '#' + t).join(', ')}`;
    }
    document.getElementById('detailMeta').innerHTML = meta;

    document.getElementById('modalDetail').classList.add('active');
}

function closeDetailModal() {
    document.getElementById('modalDetail').classList.remove('active');
    currentDetailId = null;
}

async function deleteCurrentKnowledge() {
    if (!currentDetailId) return;

    // Delete from Firebase (will update via listener)
    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isAvailable()) {
        try {
            await FirebaseDB.deleteKnowledge(currentDetailId);
            closeDetailModal();
            showToast('Knowledge deleted', 'success');
            tankSpeak('I have purged that from my Arctic archives.');
        } catch (e) {
            console.error('Error deleting knowledge:', e);
            showToast('Error deleting knowledge', 'error');
        }
    } else {
        // Fallback to localStorage
        const index = STATE.knowledgeDB.findIndex(k => k.id === currentDetailId);
        if (index !== -1) {
            STATE.knowledgeDB.splice(index, 1);
            saveKnowledgeToStorage();
            renderKnowledgeList();
            closeDetailModal();
            showToast('Knowledge deleted', 'success');
            tankSpeak('I have purged that from my Arctic archives.');
        }
    }
}

// ============================================
// REAL-TIME API FETCHING (CoinCap, CoinGecko, DexScreener)
// ============================================

// COINCAP - Major Cryptocurrencies (reliable, no rate limit)
async function fetchCoinCap() {
    try {
        console.log('📊 [CoinCap] Fetching data...');
        const response = await fetch('https://api.coincap.io/v2/assets?limit=5');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('📊 [CoinCap] Response:', data.data?.length || 0, 'coins');
        return data.data || [];
    } catch (error) {
        console.error('❌ [CoinCap] Error:', error.message);
        return [];
    }
}

// COINGECKO - Trending Coins (free tier)
async function fetchCoinGeckoTrending() {
    try {
        console.log('📊 [CoinGecko] Fetching trending...');
        const response = await fetch('https://api.coingecko.com/api/v3/search/trending');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('📊 [CoinGecko] Response:', data.coins?.length || 0, 'trending');
        return data.coins || [];
    } catch (error) {
        console.error('❌ [CoinGecko] Error:', error.message);
        return [];
    }
}

// DEXSCREENER - Trending Tokens (using search endpoint)
async function fetchDexScreener() {
    try {
        console.log('📊 [DexScreener] Fetching trending tokens...');

        // Use search endpoint which is more reliable
        const response = await fetch('https://api.dexscreener.com/latest/dex/search?q=sol');

        if (!response.ok) {
            console.error('❌ [DexScreener] HTTP Status:', response.status);
            return [];
        }

        const data = await response.json();
        console.log('📊 [DexScreener] Raw response:', data);
        console.log('📊 [DexScreener] Pairs found:', data.pairs?.length || 0);

        if (!data.pairs || data.pairs.length === 0) {
            console.warn('⚠️ [DexScreener] No pairs in response');
            return [];
        }

        // Filter for high volume pairs and return top 5
        const filteredPairs = data.pairs
            .filter(pair => pair.volume?.h24 > 10000) // Min $10K volume
            .slice(0, 5);

        console.log('📊 [DexScreener] Filtered pairs:', filteredPairs.length);
        return filteredPairs;
    } catch (error) {
        console.error('❌ [DexScreener] Error:', error);
        // Try fallback method
        return await fetchDexScreenerFallback();
    }
}

// DEXSCREENER FALLBACK - Search specific popular tokens
async function fetchDexScreenerFallback() {
    console.log('📊 [DexScreener] Trying fallback method...');

    const tokens = ['BONK', 'WIF', 'JUP'];
    const results = [];

    for (const token of tokens) {
        try {
            const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${token}`);

            if (response.ok) {
                const data = await response.json();
                if (data.pairs?.[0]) {
                    results.push(data.pairs[0]);
                    console.log(`📊 [DexScreener] Found ${token}:`, data.pairs[0].baseToken?.symbol);
                }
            }

            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 200));
        } catch (e) {
            console.error(`❌ [DexScreener] Error fetching ${token}:`, e.message);
        }
    }

    console.log('📊 [DexScreener] Fallback results:', results.length);
    return results;
}

// RSS NEWS - Cointelegraph (via proxy)
async function fetchRSSNews() {
    try {
        console.log('📰 [RSS] Fetching news from Cointelegraph...');
        const RSS_URL = 'https://cointelegraph.com/rss';
        const PROXY = 'https://api.allorigins.win/raw?url=';

        const response = await fetch(PROXY + encodeURIComponent(RSS_URL));
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();

        // Parse XML
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const items = xml.querySelectorAll('item');

        const news = [];
        items.forEach((item, i) => {
            if (i < 5) {
                const title = item.querySelector('title')?.textContent || '';
                const description = item.querySelector('description')?.textContent || '';
                const link = item.querySelector('link')?.textContent || '';
                const pubDate = item.querySelector('pubDate')?.textContent || '';

                // Clean description (remove HTML tags)
                const cleanDesc = description.replace(/<[^>]*>/g, '').substring(0, 120);

                news.push({
                    type: 'NEWS',
                    title: title,
                    content: cleanDesc + '...',
                    source: 'COINTELEGRAPH',
                    date: pubDate ? new Date(pubDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                    url: link
                });
            }
        });

        console.log('📰 [RSS] Fetched', news.length, 'news items');
        return news;
    } catch (e) {
        console.error('❌ [RSS] Error:', e.message);
        return [];
    }
}

// CRYPTO PANIC NEWS - Alternative source
async function fetchCryptoPanicNews() {
    try {
        console.log('📰 [CryptoPanic] Fetching news...');
        const response = await fetch('https://cryptopanic.com/api/v1/posts/?auth_token=DEMO&public=true&kind=news');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        return data.results?.slice(0, 5).map(news => ({
            type: 'NEWS',
            title: news.title,
            content: news.title,
            source: news.source?.title || 'CRYPTO NEWS',
            date: new Date(news.published_at).toISOString().split('T')[0],
            url: news.url
        })) || [];
    } catch (e) {
        console.error('❌ [CryptoPanic] Error:', e.message);
        return [];
    }
}

// NEWS TRACKING - Store last news IDs for detecting new articles
let lastNewsIds = [];

// CHECK FOR NEW NEWS - Akai Inu announces breaking news
async function checkForNewNews() {
    if (STATE.isSpeaking) return;

    console.log('📰 Checking for new news...');
    const news = await fetchRSSNews();

    for (const item of news) {
        const newsId = item.title;

        // If this is new news
        if (!lastNewsIds.includes(newsId)) {
            lastNewsIds.push(newsId);

            // Akai Inu announces (only if we already have cached news - skip first load)
            if (lastNewsIds.length > 1) {
                const announcement = `Breaking news from the Arctic wires. ${item.title}`;
                console.log('🐧 Announcing:', announcement);
                tankSpeak(announcement);
                showSpeakingBar(announcement);
                showTankView(item.source, item.url, 'NEWS');

                // Only announce one news item at a time
                break;
            }
        }
    }

    // Keep only last 20 news IDs
    if (lastNewsIds.length > 20) {
        lastNewsIds = lastNewsIds.slice(-20);
    }
}

// POLYMARKET - Prediction Markets (general)
async function fetchPolymarket() {
    try {
        console.log('🔮 [Polymarket] Fetching prediction markets...');
        const response = await fetch('https://gamma-api.polymarket.com/markets?closed=false&limit=10');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('🔮 [Polymarket] Response:', data.length, 'markets');

        return data.map(market => {
            // Extract odds/probabilities
            let yesOdds = 50;
            let noOdds = 50;

            if (market.outcomePrices) {
                try {
                    const outcomes = JSON.parse(market.outcomePrices);
                    yesOdds = (parseFloat(outcomes[0]) * 100).toFixed(0);
                    noOdds = (parseFloat(outcomes[1]) * 100).toFixed(0);
                } catch (e) {
                    console.warn('Could not parse outcomePrices');
                }
            }

            const liquidity = market.liquidity ? `$${(market.liquidity / 1000).toFixed(1)}K` : '$0';
            const question = market.question || 'Unknown Market';
            const shortQuestion = question.length > 50 ? question.substring(0, 50) + '...' : question;

            return {
                type: 'PREDICTION',
                title: shortQuestion,
                content: `Yes ${yesOdds}% / No ${noOdds}% | Liquidity: ${liquidity}`,
                source: 'POLYMARKET',
                date: new Date().toISOString().split('T')[0],
                url: `https://polymarket.com/event/${market.slug || ''}`
            };
        }) || [];

    } catch (error) {
        console.error('❌ [Polymarket] Error:', error.message);
        return [];
    }
}

// POLYMARKET - Crypto-specific markets
async function fetchPolymarketCrypto() {
    try {
        console.log('🔮 [Polymarket] Fetching crypto prediction markets...');
        const response = await fetch('https://gamma-api.polymarket.com/markets?closed=false&tag=crypto&limit=5');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('🔮 [Polymarket Crypto] Response:', data.length, 'markets');

        return data.map(market => {
            let yesOdds = 50;
            let noOdds = 50;

            if (market.outcomePrices) {
                try {
                    const outcomes = JSON.parse(market.outcomePrices);
                    yesOdds = (parseFloat(outcomes[0]) * 100).toFixed(0);
                    noOdds = (parseFloat(outcomes[1]) * 100).toFixed(0);
                } catch (e) {
                    console.warn('Could not parse outcomePrices');
                }
            }

            const liquidity = market.liquidity ? `$${(market.liquidity / 1000).toFixed(1)}K` : '$0';
            const question = market.question || 'Crypto Market';

            return {
                type: 'PREDICTION',
                title: `🪙 ${question}`,
                content: `Yes ${yesOdds}% / No ${noOdds}% | Liquidity: ${liquidity}`,
                source: 'POLYMARKET',
                date: new Date().toISOString().split('T')[0],
                url: `https://polymarket.com/event/${market.slug || ''}`
            };
        }) || [];

    } catch (error) {
        console.error('❌ [Polymarket Crypto] Error:', error.message);
        return [];
    }
}

// FETCH ALL REAL DATA
async function fetchAllRealData() {
    console.log('🔄 ========================================');
    console.log('🔄 STARTING DATA FETCH FROM ALL SOURCES...');
    console.log('🔄 ========================================');

    const cards = [];
    const today = new Date().toISOString().split('T')[0];
    const now = Date.now();
    let btcData = null;

    // 1. COINCAP - Major Crypto (most reliable)
    try {
        console.log('📊 Fetching CoinCap...');
        const cryptos = await fetchCoinCap();
        cryptos.forEach(coin => {
            const change = parseFloat(coin.changePercent24Hr || 0).toFixed(2);
            const price = parseFloat(coin.priceUsd || 0).toFixed(2);
            const marketCap = (parseFloat(coin.marketCapUsd || 0) / 1e9).toFixed(1);
            const trend = change >= 0 ? '📈' : '📉';
            const changeSign = change >= 0 ? '+' : '';

            if (coin.symbol === 'BTC') {
                btcData = { price, change, trend };
            }

            cards.push({
                id: `coincap_${coin.id}`,
                category: 'market',
                icon: trend,
                title: `${coin.symbol} $${price}`,
                content: `${trend} ${changeSign}${change}% (24h) | MCap: $${marketCap}B`,
                source: 'COINCAP',
                date: today,
                timestamp: now,
                url: `https://coincap.io/assets/${coin.id}`,
                changeValue: parseFloat(change)
            });
        });
        console.log(`✅ CoinCap: ${cryptos.length} coins added`);
    } catch (e) {
        console.error('❌ CoinCap error:', e);
    }

    // 2. COINGECKO - Trending Coins
    try {
        console.log('📊 Fetching CoinGecko Trending...');
        const trending = await fetchCoinGeckoTrending();
        trending.slice(0, 5).forEach(item => {
            const coin = item.item;
            cards.push({
                id: `gecko_${coin.id}`,
                category: 'market',
                icon: '🔥',
                title: `${coin.symbol} TRENDING`,
                content: `${coin.name} | Rank: #${coin.market_cap_rank || 'N/A'} | Score: ${coin.score + 1}`,
                source: 'COINGECKO',
                date: today,
                timestamp: now,
                url: `https://www.coingecko.com/en/coins/${coin.id}`,
                changeValue: 0
            });
        });
        console.log(`✅ CoinGecko: ${Math.min(trending.length, 5)} trending added`);
    } catch (e) {
        console.error('❌ CoinGecko error:', e);
    }

    // 3. DEXSCREENER - Trending Tokens
    try {
        console.log('📊 Fetching DexScreener...');
        const pairs = await fetchDexScreener();
        if (pairs.length > 0) {
            pairs.slice(0, 5).forEach((pair, index) => {
                const priceChange = parseFloat(pair.priceChange?.h24 || 0).toFixed(2);
                const trend = parseFloat(priceChange) >= 0 ? '📈' : '📉';
                const volume = pair.volume?.h24 ? (pair.volume.h24 / 1000).toFixed(1) : '0';
                const liquidity = pair.liquidity?.usd ? (pair.liquidity.usd / 1000).toFixed(1) : '0';
                const price = pair.priceUsd ? parseFloat(pair.priceUsd).toFixed(6) : '0';
                const baseSymbol = pair.baseToken?.symbol || 'TOKEN';
                const chainId = pair.chainId || 'solana';

                cards.push({
                    id: `dex_${pair.pairAddress?.slice(0, 12) || Math.random().toString(36).slice(2)}`,
                    category: 'market',
                    icon: trend,
                    title: `${baseSymbol} ${trend}`,
                    content: `$${price} | ${priceChange}% (24h) | Vol: $${volume}K | Liq: $${liquidity}K`,
                    source: 'DEXSCREENER',
                    date: today,
                    timestamp: now,
                    url: pair.url || `https://dexscreener.com/${chainId}/${pair.pairAddress}`,
                    changeValue: parseFloat(priceChange)
                });
            });
            console.log(`✅ DexScreener: ${Math.min(pairs.length, 5)} tokens added`);
        }
    } catch (e) {
        console.error('❌ DexScreener error:', e);
    }

    // 4. BINANCE - Major pairs with 24h stats
    try {
        console.log('📊 Fetching Binance...');
        const symbols = '["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT"]';
        const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbols}`);
        if (response.ok) {
            const data = await response.json();
            data?.forEach(ticker => {
                const symbol = ticker.symbol.replace('USDT', '');
                const price = parseFloat(ticker.lastPrice).toFixed(2);
                const change = parseFloat(ticker.priceChangePercent).toFixed(2);
                const trend = change >= 0 ? '📈' : '📉';
                const volume = (parseFloat(ticker.quoteVolume) / 1e6).toFixed(1);

                cards.push({
                    id: `binance_${symbol}`,
                    category: 'market',
                    icon: trend,
                    title: `${symbol} $${price}`,
                    content: `${trend} ${change >= 0 ? '+' : ''}${change}% | Vol: $${volume}M`,
                    source: 'BINANCE',
                    date: today,
                    timestamp: now - 1000,
                    url: `https://www.binance.com/en/trade/${symbol}_USDT`,
                    changeValue: parseFloat(change)
                });
            });
            console.log(`✅ Binance: ${data?.length || 0} pairs added`);
        }
    } catch (e) {
        console.error('❌ Binance error:', e);
    }

    // 5. COINBASE - Spot prices
    try {
        console.log('📊 Fetching Coinbase...');
        const coins = ['BTC', 'ETH', 'SOL'];
        for (const coin of coins) {
            try {
                const response = await fetch(`https://api.coinbase.com/v2/prices/${coin}-USD/spot`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.data) {
                        cards.push({
                            id: `coinbase_${coin}`,
                            category: 'market',
                            icon: '💵',
                            title: `${coin} $${parseFloat(data.data.amount).toFixed(2)}`,
                            content: `Spot price from Coinbase`,
                            source: 'COINBASE',
                            date: today,
                            timestamp: now - 2000,
                            url: `https://www.coinbase.com/price/${coin.toLowerCase()}`,
                            changeValue: 0
                        });
                    }
                }
            } catch (e) { /* skip individual coin errors */ }
        }
        console.log(`✅ Coinbase: ${coins.length} spot prices added`);
    } catch (e) {
        console.error('❌ Coinbase error:', e);
    }

    // 6. NEWS - Cointelegraph RSS
    try {
        console.log('📰 Fetching Cointelegraph RSS...');
        const newsItems = await fetchRSSNews();
        newsItems.forEach((item, index) => {
            cards.push({
                id: `news_ct_${index}_${now}`,
                category: 'news',
                icon: '📰',
                title: item.title,
                content: item.content,
                source: 'COINTELEGRAPH',
                date: item.date,
                timestamp: now + index,
                url: item.url,
                changeValue: 0
            });
        });
        console.log(`✅ Cointelegraph: ${newsItems.length} articles added`);
    } catch (e) {
        console.error('❌ Cointelegraph RSS error:', e);
    }

    // 7. NEWS - Bitcoin Magazine RSS
    try {
        console.log('📰 Fetching Bitcoin Magazine RSS...');
        const PROXY = 'https://api.allorigins.win/raw?url=';
        const RSS_URL = 'https://bitcoinmagazine.com/feed';
        const response = await fetch(PROXY + encodeURIComponent(RSS_URL));
        if (response.ok) {
            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, 'text/xml');
            const items = xml.querySelectorAll('item');

            let addedCount = 0;
            items.forEach((item, i) => {
                if (i < 3) {
                    const title = item.querySelector('title')?.textContent || '';
                    const link = item.querySelector('link')?.textContent || '';
                    if (title) {
                        cards.push({
                            id: `news_btcmag_${i}_${now}`,
                            category: 'news',
                            icon: '🪙',
                            title: title,
                            content: 'Bitcoin Magazine',
                            source: 'BITCOIN MAG',
                            date: today,
                            timestamp: now + 100 + i,
                            url: link,
                            changeValue: 0
                        });
                        addedCount++;
                    }
                }
            });
            console.log(`✅ Bitcoin Magazine: ${addedCount} articles added`);
        }
    } catch (e) {
        console.error('❌ Bitcoin Magazine RSS error:', e);
    }

    // 8. POLYMARKET - Prediction Markets
    try {
        console.log('🔮 Fetching Polymarket...');
        const polymarkets = await fetchPolymarket();
        polymarkets.slice(0, 5).forEach((market, index) => {
            cards.push({
                id: `poly_${index}_${now}`,
                category: 'prediction',
                icon: '🔮',
                title: market.title,
                content: market.content,
                source: 'POLYMARKET',
                date: market.date,
                timestamp: now - 3000 + index,
                url: market.url,
                changeValue: 0
            });
        });
        console.log(`✅ Polymarket: ${Math.min(polymarkets.length, 5)} predictions added`);
    } catch (e) {
        console.error('❌ Polymarket error:', e);
    }

    // 9. POLYMARKET CRYPTO - Crypto-specific prediction markets
    try {
        console.log('🔮 Fetching Polymarket Crypto...');
        const cryptoMarkets = await fetchPolymarketCrypto();
        cryptoMarkets.slice(0, 3).forEach((market, index) => {
            cards.push({
                id: `poly_crypto_${index}_${now}`,
                category: 'prediction',
                icon: '🪙',
                title: market.title,
                content: market.content,
                source: 'POLYMARKET',
                date: market.date,
                timestamp: now - 4000 + index,
                url: market.url,
                changeValue: 0
            });
        });
        console.log(`✅ Polymarket Crypto: ${Math.min(cryptoMarkets.length, 3)} predictions added`);
    } catch (e) {
        console.error('❌ Polymarket Crypto error:', e);
    }

    // 10. MR. TANK OBSERVATION - Based on market data
    if (btcData) {
        const isUp = parseFloat(btcData.change) >= 0;
        const observations = isUp ? [
            `Bitcoin swimming upward at ${btcData.change}%. The arctic markets are warming nicely.`,
            `BTC rises ${btcData.change}% today. The icebergs of profit are within reach.`,
            `A green day in the frozen markets. Bitcoin up ${btcData.change}%.`
        ] : [
            `Bitcoin diving ${btcData.change}% into cold waters. Patience, fellow tanks.`,
            `BTC drops ${btcData.change}% today. The market currents run cold.`,
            `A red tide in the arctic markets. Bitcoin down ${btcData.change}%.`
        ];

        const observation = observations[Math.floor(Math.random() * observations.length)];

        cards.push({
            id: `tank_obs_${now}`,
            category: 'observation',
            icon: '🐧',
            title: 'Market Analysis',
            content: observation,
            source: 'MR. TANK',
            date: today,
            timestamp: now + 1000,
            url: '',
            changeValue: 0
        });
        console.log('✅ Akai Inu observation added');
    }

    console.log('🔄 ========================================');
    console.log(`🔄 FETCH COMPLETE: ${cards.length} total cards`);
    console.log('🔄 ========================================');

    return cards;
}

// UPDATE ARCTIC ARCHIVES WITH REAL DATA
async function updateArcticArchives() {
    if (isLoadingData) {
        console.log('⏳ Already loading data, skipping...');
        return;
    }

    isLoadingData = true;
    const startTime = Date.now();
    console.log('🔄 ========================================');
    console.log('🔄 UPDATING ARCTIC ARCHIVES...');
    console.log('🔄 Time:', new Date().toLocaleTimeString());
    console.log('🔄 ========================================');

    // Show loading state if no data yet
    const feed = document.getElementById('archivesFeed');
    if (feed && realTimeCards.filter(c => !c.isUserKnowledge).length === 0) {
        feed.innerHTML = '<div class="archives-loading">❄️ Fetching live data from the Arctic servers...</div>';
    }

    try {
        const cards = await fetchAllRealData();

        if (cards.length > 0) {
            // Keep user knowledge, replace API data
            const userCards = realTimeCards.filter(c => c.isUserKnowledge);

            // Detect NEW cards (not in previous realTimeCards)
            const oldCardIds = new Set(realTimeCards.map(c => c.id));
            const newCards = cards.filter(c => !oldCardIds.has(c.id));

            realTimeCards = [...userCards, ...cards];

            // AUTOMATIC SPEECH: Add new cards to speech queue
            if (newCards.length > 0) {
                console.log(`🔊 ${newCards.length} new cards detected - adding to speech queue`);

                newCards.forEach(card => {
                    // AUTOMATIC SPEECH FILTER:
                    // - NEWS, PREDICTIONS, KNOWLEDGE → speak automatically
                    // - MARKET → only speak when user clicks "CLICK TO HEAR"

                    // Skip MARKET from automatic speech
                    if (card.category === 'market') {
                        console.log('🔇 Skipping automatic speech for MARKET:', card.title);
                        return; // Don't add market data to automatic speech queue
                    }

                    // Create appropriate speech text based on category
                    let speechText = '';
                    if (card.category === 'news') {
                        speechText = createNewsSpeech(card);
                    } else if (card.category === 'prediction') {
                        speechText = createPredictionSpeech(card);
                    } else {
                        speechText = createKnowledgeSpeech(card);
                    }

                    // Add to speech queue (only NEWS, PREDICTIONS, KNOWLEDGE)
                    addToSpeechQueue(speechText, card.id, !initialLoadDone);
                });

                // Mark initial load as complete after first batch
                if (!initialLoadDone) {
                    setTimeout(() => {
                        markInitialLoadComplete();
                    }, 5000); // Wait 5 seconds before marking complete
                }
            }

            // Save to localStorage for news.html sync
            saveNewsToStorage(cards);

            lastDataUpdate = new Date();
            const elapsed = Date.now() - startTime;

            console.log('✅ ========================================');
            console.log(`✅ ARCTIC ARCHIVES UPDATED!`);
            console.log(`✅ API cards: ${cards.length}`);
            console.log(`✅ User cards: ${userCards.length}`);
            console.log(`✅ Total: ${realTimeCards.length}`);
            console.log(`✅ New cards: ${newCards.length}`);
            console.log(`✅ Time elapsed: ${elapsed}ms`);
            console.log('✅ ========================================');

            // Re-render current view
            renderArchivesFeed();

            // Update knowledge count
            updateKnowledgeCount();

            // Akai Inu comments on market (15% chance after first load)
            // DISABLED: Now using automatic speech queue instead
            // if (lastDataUpdate && Math.random() < 0.15) {
            //     setTimeout(() => tankMarketComment(), 2000);
            // }
        } else {
            console.warn('⚠️ No cards returned from APIs');
            if (feed) {
                feed.innerHTML = '<div class="archives-empty">❄️ Unable to fetch data. Will retry...</div>';
            }
        }
    } catch (error) {
        console.error('❌ Error updating Arctic Archives:', error);
        if (feed) {
            feed.innerHTML = '<div class="archives-empty">❄️ Connection error. Retrying...</div>';
        }
    }

    isLoadingData = false;
}

// 24 hours in milliseconds
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Clean old news (>24h) from localStorage
function cleanOldNewsFromStorage() {
    const allNews = JSON.parse(localStorage.getItem('allNews') || '[]');
    const now = Date.now();

    // Filter only news from the last 24 hours
    const recentNews = allNews.filter(news => {
        const newsTime = news.timestamp || new Date(news.date).getTime() || 0;
        return (now - newsTime) < TWENTY_FOUR_HOURS_MS;
    });

    // Save cleaned list
    localStorage.setItem('allNews', JSON.stringify(recentNews));

    const removed = allNews.length - recentNews.length;
    if (removed > 0) {
        console.log(`🧹 Cleaned ${removed} old news (>24h). Remaining: ${recentNews.length}`);
    }

    return recentNews;
}

// Save news to localStorage and Firebase for sync
// IMPORTANT: Only saves REAL NEWS (not market data/prices)
function saveNewsToStorage(cards) {
    try {
        // FILTER: Only save real news articles (NOT market data)
        const newsOnly = cards.filter(card => {
            // Exclude market data (prices)
            if (card.category === 'market' || card.type === 'MARKET') {
                return false;
            }

            // Exclude if title looks like a price (contains $ followed by numbers)
            if (card.title && /\$\d/.test(card.title)) {
                return false;
            }

            // Exclude known market sources
            const marketSources = ['COINCAP', 'BINANCE', 'COINBASE', 'DEXSCREENER'];
            if (marketSources.includes(card.source)) {
                return false;
            }

            // Include only news sources
            const newsSources = ['COINTELEGRAPH', 'BITCOIN MAG', 'RSS', 'NEWS', 'CRYPTOPANIC'];
            const isNewsSource = newsSources.includes(card.source) ||
                                 card.category === 'news' ||
                                 card.type === 'NEWS';

            return isNewsSource;
        });

        console.log(`📰 Filtered for storage: ${newsOnly.length} news articles (from ${cards.length} total cards)`);

        // First, clean old news (>24h)
        const existingNews = cleanOldNewsFromStorage();

        // Add new cards (avoid duplicates by title)
        let addedCount = 0;
        const newCards = [];
        newsOnly.forEach(card => {
            const exists = existingNews.find(n => n.title === card.title && n.source === card.source);
            if (!exists) {
                // IMPORTANT: Add timestamp to each news item
                card.timestamp = Date.now();
                existingNews.unshift(card); // Add to beginning (newest first)
                newCards.push(card);
                addedCount++;
            }
        });

        // Save to localStorage (no limit since 24h cleanup handles it)
        localStorage.setItem('allNews', JSON.stringify(existingNews));
        localStorage.setItem('newsLastUpdate', Date.now().toString());

        // Also save to Firebase if available (only real news)
        if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isAvailable()) {
            FirebaseDB.saveNews(newCards);
        }

        console.log(`📰 Saved to localStorage: ${addedCount} new news articles, ${existingNews.length} total`);
    } catch (e) {
        console.error('❌ Error saving news to localStorage:', e);
    }
}

// Clean old news every 5 minutes
setInterval(cleanOldNewsFromStorage, 5 * 60 * 1000);

// Clean old news on page load
document.addEventListener('DOMContentLoaded', () => {
    cleanOldNewsFromStorage();
});

// MR. TANK MARKET COMMENTARY
async function tankMarketComment() {
    if (STATE.isSpeaking) return;

    const btcCard = realTimeCards.find(c => c.id === 'coincap_bitcoin');
    if (!btcCard) {
        console.log('🐧 No BTC data for comment');
        return;
    }

    const btcChange = btcCard.changeValue || 0;
    let comment = '';

    if (btcChange >= 5) {
        comment = `Extraordinary! Bitcoin surging ${btcChange.toFixed(2)}% today. The Arctic markets are positively ablaze.`;
    } else if (btcChange >= 2) {
        comment = `Bitcoin swimming upward at ${btcChange.toFixed(2)}% today. The frozen waters are warming nicely.`;
    } else if (btcChange >= 0) {
        comment = `Bitcoin holding steady at ${btcChange.toFixed(2)}%. Calm waters in the crypto fjords.`;
    } else if (btcChange >= -2) {
        comment = `Bitcoin dipping ${btcChange.toFixed(2)}% today. A minor chill in the markets.`;
    } else if (btcChange >= -5) {
        comment = `Bitcoin diving ${btcChange.toFixed(2)}% today. Cold currents ahead, tanks stay vigilant.`;
    } else {
        comment = `Bitcoin plunging ${btcChange.toFixed(2)}% today. A proper Arctic storm in the markets. Time for whisky.`;
    }

    const ethCard = realTimeCards.find(c => c.id === 'coincap_ethereum');
    if (ethCard && Math.random() < 0.5) {
        const ethChange = ethCard.changeValue || 0;
        if ((btcChange >= 0 && ethChange < 0) || (btcChange < 0 && ethChange >= 0)) {
            comment += ` Meanwhile, Ethereum diverges at ${ethChange.toFixed(2)}%. Interesting currents.`;
        }
    }

    console.log('🐧 Akai Inu says:', comment);
    tankSpeak(comment);
}

// INITIALIZE REAL-TIME UPDATES
function initRealTimeUpdates() {
    console.log('📊 ========================================');
    console.log('📊 INITIALIZING REAL-TIME DATA SYSTEM');
    console.log('📊 Update interval: 1 minute');
    console.log('📊 Time:', new Date().toLocaleTimeString());
    console.log('📊 ========================================');

    // Initial fetch immediately
    console.log('📊 Starting initial data fetch...');
    updateArcticArchives();

    // Update every 30 seconds
    setInterval(() => {
        console.log('⏰ ========================================');
        console.log('⏰ Scheduled update triggered');
        console.log('⏰ Time:', new Date().toLocaleTimeString());
        console.log('⏰ ========================================');
        updateArcticArchives();
    }, 30 * 1000);

    console.log('📊 Real-time updates initialized');
}

// ============================================
// ARCTIC ARCHIVES (Unified Panel)
// ============================================

let currentArchivesFilter = 'ALL';
let showChangelog = false;

function initNewsfeed() {
    initArchivesNavigation();
    initRealTimeUpdates();
    initNewsChecker();
}

// Initialize news checking for Akai Inu announcements
function initNewsChecker() {
    // Check for new news every 3 minutes
    setInterval(() => {
        checkForNewNews();
    }, 3 * 60 * 1000);
}

function initArchivesNavigation() {
    // Filter buttons (ALL, PREDICTION) - these filter cards locally
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filter = btn.dataset.filter;

            // MARKET button - open market.html in same tab
            if (filter === 'MARKET') {
                e.preventDefault();
                window.location.href = 'market.html';
                return;
            }

            // NEWS button - open news.html in same tab
            if (filter === 'NEWS') {
                e.preventDefault();
                window.location.href = 'news.html';
                return;
            }

            // Other buttons (ALL, PREDICTION) - filter cards normally
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentArchivesFilter = filter;
            showChangelog = false;
            renderArchivesFeed();
        });
    });

    // SHOW INTRO button
    const introBtn = document.getElementById('btnShowIntro');
    if (introBtn) {
        introBtn.addEventListener('click', () => {
            showIntroMessage();
        });
    }

    // VIEW ART button
    const artBtn = document.getElementById('btnViewArt');
    if (artBtn) {
        artBtn.addEventListener('click', () => {
            showToast('Arctic Art Gallery coming soon...', 'info');
        });
    }
}

function showIntroMessage() {
    const intro = getIntroMessage();
    tankSpeak(intro);
}

function renderArchivesFeed() {
    const feed = document.getElementById('archivesFeed');
    if (!feed) return;

    console.log('🎨 Rendering Archives Feed...');
    console.log('   Current filter:', currentArchivesFilter);
    console.log('   Show changelog:', showChangelog);
    console.log('   Total cards in cache:', realTimeCards.length);

    // Handle changelog view
    if (showChangelog) {
        const items = getChangelogItems();
        console.log('   Changelog items:', items.length);
        renderFeedCards(feed, items);
        return;
    }

    // Get all cards (user + API)
    const allCards = [...realTimeCards];
    console.log('   All cards:', allCards.length);

    // Filter items based on current filter
    let items = [];
    if (currentArchivesFilter === 'ALL') {
        // Show everything except changelog
        items = allCards;
    } else if (currentArchivesFilter === 'MARKET') {
        items = allCards.filter(item => item.category === 'market');
    } else if (currentArchivesFilter === 'NEWS') {
        items = allCards.filter(item => item.category === 'news');
    } else if (currentArchivesFilter === 'PREDICTION') {
        items = allCards.filter(item =>
            item.category === 'prediction' || item.category === 'observation'
        );
    }

    console.log('   Filtered items:', items.length);

    // Render the filtered cards
    renderFeedCards(feed, items);
}

// Remove duplicate cards based on ID first, then title + source
function removeDuplicates(cards) {
    const seenIds = new Set();
    const seenTitles = new Set();

    return cards.filter(card => {
        // Check by ID first (most reliable)
        if (card.id && seenIds.has(card.id)) {
            return false;
        }

        // Check by title + source (for items without unique IDs)
        const titleKey = (card.title || '').toLowerCase().trim() + '|' + (card.source || '');
        if (seenTitles.has(titleKey)) {
            return false;
        }

        // Add to both sets
        if (card.id) seenIds.add(card.id);
        seenTitles.add(titleKey);

        return true;
    });
}

// Format timestamp to relative time or absolute time
function formatTimestamp(timestamp) {
    if (!timestamp) return 'Unknown time';

    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    // Relative time for recent items
    if (seconds < 60) {
        return 'há menos de 1 min';
    } else if (minutes < 60) {
        return `há ${minutes} min`;
    } else if (hours < 24) {
        return `há ${hours} hora${hours > 1 ? 's' : ''}`;
    } else if (days < 7) {
        return `há ${days} dia${days > 1 ? 's' : ''}`;
    }

    // Absolute time for older items
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');

    // Show year only if different from current year
    const currentYear = new Date().getFullYear();
    if (year !== currentYear) {
        return `${year}-${month}-${day} ${hour}:${minute}`;
    }

    return `${month}-${day} ${hour}:${minute}`;
}

// Helper function to render feed cards
function renderFeedCards(feed, items) {
    // Show loading or empty state
    if (items.length === 0) {
        if (isLoadingData) {
            feed.innerHTML = '<div class="archives-loading">❄️ Fetching live data from the Arctic servers...</div>';
        } else {
            feed.innerHTML = '<div class="archives-empty">No data available. Add knowledge or check connection.</div>';
        }
        return;
    }

    // Sort by timestamp FIRST (newest first) - ensures proper ordering
    items.sort((a, b) => {
        const timeA = a.timestamp || new Date(a.date).getTime() || 0;
        const timeB = b.timestamp || new Date(b.date).getTime() || 0;
        return timeB - timeA; // Descending order (newest first)
    });

    // Remove duplicates AFTER sorting (keeps the newest version)
    items = removeDuplicates(items);

    console.log('   Sorted and deduplicated:', items.length, 'items (newest first)');

    feed.innerHTML = items.map(item => {
        // Determine trend styling based on change value
        const changeValue = item.changeValue || 0;
        const trendClass = item.category === 'market' && !item.isUserKnowledge ? (changeValue >= 0 ? 'trend-up' : 'trend-down') : '';
        const userClass = item.isUserKnowledge ? 'user-knowledge' : '';

        // Format timestamp for display
        const displayTime = formatTimestamp(item.timestamp);

        return `
        <div class="feed-card cat-${item.category} ${trendClass} ${userClass}" data-id="${item.id}" data-type="${item.category.toUpperCase()}">
            <div class="feed-card-header">
                <span class="feed-card-icon">${item.icon}</span>
                <span class="feed-card-category cat-${item.category}">${item.category.toUpperCase()}</span>
                <span class="feed-card-source-badge">${escapeHtml(item.source)}</span>
            </div>
            <div class="feed-card-title">${escapeHtml(item.title)}</div>
            <div class="feed-card-content">${escapeHtml(item.content)}</div>
            <div class="feed-card-footer">
                <span class="feed-card-date" title="Adicionado: ${displayTime}">${displayTime}</span>
                <span class="feed-card-hear" data-id="${item.id}">CLICK TO HEAR ~</span>
            </div>
        </div>
    `}).join('');

    console.log('   Rendered', items.length, 'cards');

    // Add click listener to entire card - Akai Inu reads content
    feed.querySelectorAll('.feed-card').forEach(card => {
        card.style.cursor = 'pointer';

        card.addEventListener('click', () => {
            const itemId = card.dataset.id;
            const hearBtn = card.querySelector('.feed-card-hear');
            if (hearBtn) {
                speakFeedItem(itemId, hearBtn);
            }
        });
    });
}

function getChangelogItems() {
    return [
        {
            id: 'cl0000',
            category: 'changelog',
            icon: '📋',
            title: 'V1.4 - The Tank Times',
            content: 'New vintage newspaper-style news page with printed paper aesthetic. Features main headlines, market columns, Polymarket predictions, and Akai Inu quotes.',
            source: 'MR. TANK',
            date: '2026-01-24'
        },
        {
            id: 'cl000',
            category: 'changelog',
            icon: '📋',
            title: 'V1.3 - Financial Terminal',
            content: 'New dedicated market page with DexScreener token grid, Solana trending, Polymarket predictions, watchlist, and analyst remarks. Auto-refresh every 30s.',
            source: 'MR. TANK',
            date: '2026-01-24'
        },
        {
            id: 'cl00',
            category: 'changelog',
            icon: '📋',
            title: 'V1.2 - Polymarket Integration',
            content: 'Added real prediction markets from Polymarket API. Shows live odds, liquidity, and crypto-specific prediction markets.',
            source: 'MR. TANK',
            date: '2026-01-24'
        },
        {
            id: 'cl0',
            category: 'changelog',
            icon: '📋',
            title: 'V1.1 - Live News Integration',
            content: 'Added real-time crypto news from Cointelegraph RSS feed. Unified feed with ALL/MARKET/NEWS/PREDICTIONS filters. Akai Inu announces breaking news.',
            source: 'MR. TANK',
            date: '2026-01-24'
        },
        {
            id: 'cl1',
            category: 'changelog',
            icon: '📋',
            title: 'V1.0 - Arctic Archives Integration',
            content: 'Unified news feed, market data, and predictions into a single panel. Added Clark-style navigation buttons.',
            source: 'MR. TANK',
            date: '2026-01-24'
        },
        {
            id: 'cl2',
            category: 'changelog',
            icon: '📋',
            title: 'Knowledge Graph System',
            content: 'Added interactive 3D knowledge visualization with node connections based on tags and content similarity.',
            source: 'MR. TANK',
            date: '2026-01-23'
        },
        {
            id: 'cl3',
            category: 'changelog',
            icon: '📋',
            title: 'Arctic Winter Theme',
            content: 'Complete visual overhaul with snowfall effects, aurora lighting, and ice-blue color palette.',
            source: 'MR. TANK',
            date: '2026-01-22'
        }
    ];
}

async function speakFeedItem(itemId, element) {
    // Check realTimeCards and changelog
    let item = realTimeCards.find(n => n.id === itemId);
    if (!item) {
        item = getChangelogItems().find(n => n.id === itemId);
    }
    if (!item) {
        console.log('❌ Item not found:', itemId);
        return;
    }

    // Prevent speaking if already speaking
    if (STATE.isSpeaking) {
        showToast('Please wait, Akai Inu is speaking...', 'info');
        return;
    }

    console.log('🎤 Speaking feed item:', item.title);

    // Update UI to show speaking state
    element.textContent = 'SPEAKING...';
    element.classList.add('speaking');

    // Show Tank View popup with source info
    const itemType = item.category ? item.category.toUpperCase() : null;
    showTankView(item.source, item.url || '', itemType);

    // Construct speech text
    const speechText = `${item.title}. ${item.content}`;

    // Add to speech log
    addSpeechEntry(item.title);

    // Force speak when user clicks "CLICK TO HEAR"
    // Pass true to allow canceling existing speech (user explicitly wants to hear THIS)
    // CRITICAL: Wait for speech to complete FULLY before hiding popup
    await speakCardContent(speechText, true);

    // Wait 2 more seconds AFTER speech finishes for user to read
    await new Promise(resolve => setTimeout(resolve, 2000));

    // NOW hide the popup (only after speech finished + 2s delay)
    hideTankView();

    // Reset UI
    element.textContent = 'CLICK TO HEAR ~';
    element.classList.remove('speaking');
}

// Special function for CLICK TO HEAR - always speaks (user explicitly requested)
/**
 * Speak text using Web Speech API
 *
 * @param {string} text - Text to speak
 * @param {boolean} cancelExisting - If true, cancels any ongoing speech (default: true)
 *                                   Set to false when called from queue to never interrupt
 */
async function speakCardContent(text, cancelExisting = true) {
    console.log('🎤 speakCardContent() - ', cancelExisting ? 'user click (can cancel)' : 'from queue (never cancel)');

    // Show speaking bar
    showSpeakingBar(text);

    // Use Web Speech API directly
    return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
            console.error('❌ Web Speech API not supported');
            hideSpeakingBar();
            resolve();
            return;
        }

        // CRITICAL: Only cancel if explicitly allowed (user clicked, not from queue)
        if (cancelExisting) {
            console.log('🔇 Canceling existing speech (user clicked)');
            window.speechSynthesis.cancel();
            clearTimeout(STATE.wordTimeout);
        } else {
            console.log('🔒 NOT canceling existing speech (from queue - never interrupt)');
        }

        const utterance = new SpeechSynthesisUtterance(text);

        // Get voices
        let voices = window.speechSynthesis.getVoices();
        const voice = voices.find(v =>
            v.name.includes('UK') || v.name.includes('British') || v.name.includes('Daniel')
        ) || voices.find(v =>
            v.name.includes('English') || v.lang.startsWith('en')
        ) || voices[0];

        if (voice) {
            utterance.voice = voice;
        }

        // Cartoon tank voice
        utterance.rate = 1.25;
        utterance.pitch = 1.5;
        utterance.volume = 1.0;

        // Lip sync - detect word boundaries
        let boundarySupported = false;
        utterance.onboundary = (event) => {
            if (event.name === 'word') {
                boundarySupported = true;
                STATE.isWordActive = true;
                clearTimeout(STATE.wordTimeout);
                STATE.wordTimeout = setTimeout(() => {
                    STATE.isWordActive = false;
                }, 150);
            }
        };

        utterance.onstart = () => {
            STATE.isSpeaking = true;
            console.log('🎤 Started speaking card content');

            // Fallback lip sync if onboundary not supported
            setTimeout(() => {
                if (!boundarySupported && STATE.isSpeaking) {
                    simulateWordBoundaries(text);
                }
            }, 500);
        };

        utterance.onend = () => {
            STATE.isSpeaking = false;
            STATE.isWordActive = false;
            clearTimeout(STATE.wordTimeout);
            hideSpeakingBar();
            console.log('🔇 Finished speaking card content');
            resolve();
        };

        utterance.onerror = (event) => {
            STATE.isSpeaking = false;
            STATE.isWordActive = false;
            clearTimeout(STATE.wordTimeout);
            hideSpeakingBar();
            console.error('❌ Speech error:', event.error);
            resolve();
        };

        window.speechSynthesis.speak(utterance);

        // Chrome bug workaround - speech can pause after ~15 seconds
        const keepAlive = setInterval(() => {
            if (!STATE.isSpeaking) {
                clearInterval(keepAlive);
                return;
            }
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
        }, 10000);
    });
}

// ============================================
// TANK VIEW POPUP
// ============================================

function initTankView() {
    const closeBtn = document.getElementById('closeTankView');
    if (closeBtn) {
        closeBtn.addEventListener('click', hideTankView);
    }
}

function showTankView(source, url, type = null) {
    const popup = document.getElementById('tankView');
    const sourceEl = document.getElementById('viewSource');
    const typeEl = document.getElementById('viewType');
    const urlEl = document.getElementById('viewUrl');
    const linkEl = document.getElementById('viewLink');

    if (!popup) return;

    // Set source
    if (sourceEl) {
        sourceEl.textContent = source || 'ARCTIC TIMES';
    }

    // Set type
    if (typeEl) {
        if (type) {
            typeEl.textContent = type;
            typeEl.style.display = 'block';
        } else {
            typeEl.style.display = 'none';
        }
    }

    // Set URL display and link
    if (url && url.trim()) {
        if (urlEl) {
            urlEl.textContent = url;
            urlEl.style.display = 'block';
        }
        if (linkEl) {
            linkEl.href = url;
            linkEl.classList.remove('hidden');
        }
    } else {
        if (urlEl) {
            urlEl.textContent = '';
            urlEl.style.display = 'none';
        }
        if (linkEl) {
            linkEl.classList.add('hidden');
        }
    }

    popup.classList.add('active');
}

function hideTankView() {
    const popup = document.getElementById('tankView');
    if (popup) {
        popup.classList.remove('active');
    }
}

// ============================================
// TICKS
// ============================================

function initTicks() {
    setInterval(() => {
        STATE.ticks++;
        document.getElementById('tickCount').textContent = STATE.ticks;
    }, 1000);
}

// Update relative timestamps every minute
function initTimestampUpdater() {
    // Update timestamps every 60 seconds to keep "há X min" accurate
    setInterval(() => {
        renderArchivesFeed();
    }, 60000); // 1 minute
}

// ============================================
// UTILITIES
// ============================================

function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 200);
    }, 2500);
}

// Debug: expose STATE and functions globally for testing in console
window.DEBUG_STATE = STATE;
window.DEBUG_CARDS = () => realTimeCards;
window.DEBUG_REFRESH = () => {
    console.log('🔄 Manual refresh triggered');
    updateArcticArchives();
};
window.DEBUG_FETCH = async () => {
    console.log('🧪 Testing API fetch...');
    const cards = await fetchAllRealData();
    console.log('🧪 Results:', cards);
    return cards;
};
window.DEBUG_DEXSCREENER = async () => {
    console.log('🧪 Testing DexScreener API...');
    try {
        const response = await fetch('https://api.dexscreener.com/latest/dex/search?q=sol');
        console.log('🧪 Response status:', response.status);
        const data = await response.json();
        console.log('🧪 Raw data:', data);
        console.log('🧪 Pairs count:', data.pairs?.length || 0);
        if (data.pairs?.[0]) {
            console.log('🧪 First pair:', data.pairs[0]);
        }
        return data;
    } catch (e) {
        console.error('🧪 Error:', e);
        return null;
    }
};
window.DEBUG_COINCAP = async () => {
    console.log('🧪 Testing CoinCap API...');
    try {
        const response = await fetch('https://api.coincap.io/v2/assets?limit=5');
        console.log('🧪 Response status:', response.status);
        const data = await response.json();
        console.log('🧪 Data:', data);
        return data;
    } catch (e) {
        console.error('🧪 Error:', e);
        return null;
    }
};
window.DEBUG_COINGECKO = async () => {
    console.log('🧪 Testing CoinGecko API...');
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/search/trending');
        console.log('🧪 Response status:', response.status);
        const data = await response.json();
        console.log('🧪 Data:', data);
        return data;
    } catch (e) {
        console.error('🧪 Error:', e);
        return null;
    }
};
window.DEBUG_POLYMARKET = async () => {
    console.log('🧪 Testing Polymarket API...');
    try {
        const response = await fetch('https://gamma-api.polymarket.com/markets?closed=false&limit=5');
        console.log('🧪 Response status:', response.status);
        const data = await response.json();
        console.log('🧪 Markets found:', data.length);
        data.forEach((market, i) => {
            let odds = 'N/A';
            if (market.outcomePrices) {
                try {
                    const outcomes = JSON.parse(market.outcomePrices);
                    odds = `Yes ${(parseFloat(outcomes[0]) * 100).toFixed(0)}% / No ${(parseFloat(outcomes[1]) * 100).toFixed(0)}%`;
                } catch (e) {}
            }
            console.log(`🧪 ${i + 1}. ${market.question?.substring(0, 50)}... | ${odds}`);
        });
        return data;
    } catch (e) {
        console.error('🧪 Error:', e);
        return null;
    }
};
window.DEBUG_NEWS = async () => {
    console.log('🧪 Testing RSS News Feed...');
    try {
        const news = await fetchRSSNews();
        console.log('🧪 News items:', news.length);
        news.forEach((item, i) => {
            console.log(`🧪 ${i + 1}. ${item.title?.substring(0, 60)}...`);
        });
        return news;
    } catch (e) {
        console.error('🧪 Error:', e);
        return null;
    }
};
window.FORCE_REFRESH = async () => {
    console.log('🔄 ========================================');
    console.log('🔄 FORCING MANUAL REFRESH');
    console.log('🔄 Time:', new Date().toLocaleTimeString());
    console.log('🔄 ========================================');
    isLoadingData = false; // Reset loading flag
    await updateArcticArchives();
    console.log('🔄 Refresh complete!');
};
window.SHOW_CARDS = () => {
    console.log('📊 Current cards in memory:');
    console.log('   Total:', realTimeCards.length);
    console.log('   User:', realTimeCards.filter(c => c.isUserKnowledge).length);
    console.log('   API:', realTimeCards.filter(c => !c.isUserKnowledge).length);
    console.log('   Categories:', [...new Set(realTimeCards.map(c => c.category))]);
    realTimeCards.forEach((c, i) => {
        console.log(`   ${i + 1}. [${c.category}] ${c.title} (${c.source})`);
    });
    return realTimeCards;
};
