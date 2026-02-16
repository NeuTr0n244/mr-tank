/**
 * SENKO - FIREBASE REAL-TIME DATABASE
 * Synchronizes data across all users in real-time
 */

// ============================================
// FIREBASE CONFIGURATION
// ============================================

// Firebase Configuration - SENKO Real-Time Database
const firebaseConfig = {
    apiKey: "AIzaSyDGqhVjbrao2krVid14FVoppeqE6PqvjlA",
    authDomain: "tank-c748f.firebaseapp.com",
    projectId: "tank-c748f",
    storageBucket: "tank-c748f.firebasestorage.app",
    messagingSenderId: "804077384752",
    appId: "1:804077384752:web:118c377b61574f849929f5"
};

// Initialize Firebase
let db = null;
let firebaseInitialized = false;

function initFirebase() {
    if (firebaseInitialized) return true;

    try {
        // Check if Firebase SDK is loaded
        if (typeof firebase === 'undefined') {
            console.warn('❌ Firebase SDK not loaded. Using localStorage fallback.');
            return false;
        }

        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        firebaseInitialized = true;
        console.log('✅ Firebase initialized successfully! Real-time sync ACTIVE.');
        console.log('📡 Connecting to project:', firebaseConfig.projectId);
        return true;
    } catch (error) {
        console.error('❌ Firebase initialization error:', error);
        console.error('Using localStorage fallback mode.');
        return false;
    }
}

// Check if Firebase is available
function isFirebaseAvailable() {
    return firebaseInitialized && db !== null;
}

// ============================================
// KNOWLEDGE FUNCTIONS
// ============================================

/**
 * Add knowledge to Firebase
 */
async function addKnowledgeToFirebase(knowledge) {
    if (!isFirebaseAvailable()) {
        return addKnowledgeToLocal(knowledge);
    }

    try {
        knowledge.timestamp = Date.now();
        knowledge.date = new Date().toISOString().split('T')[0];

        const docRef = await db.collection('knowledge').add(knowledge);
        console.log('Knowledge saved to Firebase:', docRef.id);
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('Error saving knowledge to Firebase:', error);
        return addKnowledgeToLocal(knowledge);
    }
}

/**
 * Listen to knowledge in real-time
 */
function listenToKnowledge(callback) {
    if (!isFirebaseAvailable()) {
        // Fallback: load from localStorage
        const items = JSON.parse(localStorage.getItem('tank_knowledge_db') || '[]');
        callback(items);
        return () => {}; // Return empty unsubscribe function
    }

    return db.collection('knowledge')
        .orderBy('timestamp', 'desc')
        .onSnapshot((snapshot) => {
            const items = [];
            snapshot.forEach((doc) => {
                items.push({ id: doc.id, ...doc.data() });
            });
            console.log(`🔥 Firebase: ${items.length} knowledge items`);
            callback(items);
        }, (error) => {
            console.error('Error listening to knowledge:', error);
            // Fallback to localStorage
            const items = JSON.parse(localStorage.getItem('tank_knowledge_db') || '[]');
            callback(items);
        });
}

/**
 * Listen to knowledge with real-time change detection
 * Detects when new items are added, modified, or removed
 */
function listenToKnowledgeWithChanges(callback) {
    if (!isFirebaseAvailable()) {
        // Fallback: load from localStorage
        const items = JSON.parse(localStorage.getItem('tank_knowledge_db') || '[]');
        callback(items, []);
        return () => {}; // Return empty unsubscribe function
    }

    return db.collection('knowledge')
        .orderBy('timestamp', 'desc')
        .onSnapshot((snapshot) => {
            // Get all items
            const items = [];
            snapshot.forEach((doc) => {
                items.push({ id: doc.id, ...doc.data() });
            });

            // Get changes (added, modified, removed)
            const changes = snapshot.docChanges();

            console.log(`🔥 Firebase: ${items.length} total items, ${changes.length} changes`);
            changes.forEach(change => {
                const data = change.doc.data();
                console.log(`  - ${change.type.toUpperCase()}: ${data.title || 'unknown'}`);
            });

            // Call callback with items and changes
            callback(items, changes);
        }, (error) => {
            console.error('❌ Error listening to knowledge:', error);
            // Fallback to localStorage
            const items = JSON.parse(localStorage.getItem('tank_knowledge_db') || '[]');
            callback(items, []);
        });
}

/**
 * Delete knowledge from Firebase
 */
async function deleteKnowledgeFromFirebase(id) {
    if (!isFirebaseAvailable()) {
        return deleteKnowledgeFromLocal(id);
    }

    try {
        await db.collection('knowledge').doc(id).delete();
        console.log('Knowledge deleted from Firebase:', id);
        return { success: true };
    } catch (error) {
        console.error('Error deleting knowledge:', error);
        return { success: false, error };
    }
}

// ============================================
// NEWS FUNCTIONS
// ============================================

/**
 * Save news to Firebase (avoids duplicates)
 */
async function saveNewsToFirebase(newsArray) {
    if (!isFirebaseAvailable()) {
        return saveNewsToLocal(newsArray);
    }

    try {
        const batch = db.batch();
        let addedCount = 0;

        for (const news of newsArray) {
            // Check if already exists by title
            const existing = await db.collection('news')
                .where('title', '==', news.title)
                .limit(1)
                .get();

            if (existing.empty) {
                const docRef = db.collection('news').doc();
                news.timestamp = news.timestamp || Date.now();
                batch.set(docRef, news);
                addedCount++;
            }
        }

        if (addedCount > 0) {
            await batch.commit();
            console.log(`Firebase: Added ${addedCount} new news items`);
        }

        return { success: true, added: addedCount };
    } catch (error) {
        console.error('Error saving news to Firebase:', error);
        return saveNewsToLocal(newsArray);
    }
}

/**
 * Listen to news in real-time
 */
function listenToNews(callback) {
    if (!isFirebaseAvailable()) {
        const items = JSON.parse(localStorage.getItem('allNews') || '[]');
        callback(items);
        return () => {};
    }

    return db.collection('news')
        .orderBy('timestamp', 'desc')
        .limit(100)
        .onSnapshot((snapshot) => {
            const items = [];
            snapshot.forEach((doc) => {
                items.push({ id: doc.id, ...doc.data() });
            });
            console.log(`Firebase: ${items.length} news items`);
            callback(items);
        }, (error) => {
            console.error('Error listening to news:', error);
            const items = JSON.parse(localStorage.getItem('allNews') || '[]');
            callback(items);
        });
}

/**
 * Clean old news (older than 24 hours)
 */
async function cleanOldNewsFromFirebase() {
    if (!isFirebaseAvailable()) {
        return cleanOldNewsFromLocal();
    }

    try {
        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);

        const oldNews = await db.collection('news')
            .where('timestamp', '<', twentyFourHoursAgo)
            .get();

        if (oldNews.empty) {
            console.log('Firebase: No old news to clean');
            return { success: true, deleted: 0 };
        }

        const batch = db.batch();
        oldNews.forEach((doc) => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`Firebase: Deleted ${oldNews.size} old news items`);
        return { success: true, deleted: oldNews.size };
    } catch (error) {
        console.error('Error cleaning old news:', error);
        return { success: false, error };
    }
}

// ============================================
// MARKET DATA FUNCTIONS
// ============================================

/**
 * Save market data to Firebase (single document, updates in place)
 */
async function saveMarketToFirebase(tokens) {
    if (!isFirebaseAvailable()) {
        return saveMarketToLocal(tokens);
    }

    try {
        await db.collection('market').doc('current').set({
            tokens: tokens,
            updatedAt: Date.now()
        });
        console.log('Firebase: Market data saved');
        return { success: true };
    } catch (error) {
        console.error('Error saving market data:', error);
        return saveMarketToLocal(tokens);
    }
}

/**
 * Listen to market data in real-time
 */
function listenToMarket(callback) {
    if (!isFirebaseAvailable()) {
        const tokens = JSON.parse(localStorage.getItem('marketTokens') || '[]');
        callback(tokens);
        return () => {};
    }

    return db.collection('market').doc('current')
        .onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                console.log(`Firebase: ${data.tokens?.length || 0} market tokens`);
                callback(data.tokens || []);
            } else {
                callback([]);
            }
        }, (error) => {
            console.error('Error listening to market:', error);
            const tokens = JSON.parse(localStorage.getItem('marketTokens') || '[]');
            callback(tokens);
        });
}

// ============================================
// STATUS/TEMPERATURE FUNCTIONS
// ============================================

/**
 * Save shared status to Firebase
 */
async function saveStatusToFirebase(status) {
    if (!isFirebaseAvailable()) {
        return saveStatusToLocal(status);
    }

    try {
        await db.collection('status').doc('current').set({
            temp: status.temp,
            ice: status.ice,
            snow: status.snow,
            aurora: status.aurora,
            mood: status.mood,
            health: status.health,
            volatility: status.volatility,
            updatedAt: Date.now()
        });
        console.log('Firebase: Status saved');
        return { success: true };
    } catch (error) {
        console.error('Error saving status:', error);
        return saveStatusToLocal(status);
    }
}

/**
 * Listen to status in real-time
 */
function listenToStatus(callback) {
    if (!isFirebaseAvailable()) {
        const status = {
            temp: localStorage.getItem('arcticTemp') || '-15',
            ice: localStorage.getItem('arcticIce') || '85',
            snow: localStorage.getItem('arcticSnow') || 'HEAVY',
            aurora: localStorage.getItem('arcticAurora') || 'VISIBLE'
        };
        callback(status);
        return () => {};
    }

    return db.collection('status').doc('current')
        .onSnapshot((doc) => {
            if (doc.exists) {
                const status = doc.data();
                console.log('Firebase: Status updated');
                callback(status);
            }
        }, (error) => {
            console.error('Error listening to status:', error);
            const status = {
                temp: localStorage.getItem('arcticTemp') || '-15',
                ice: localStorage.getItem('arcticIce') || '85',
                snow: localStorage.getItem('arcticSnow') || 'HEAVY',
                aurora: localStorage.getItem('arcticAurora') || 'VISIBLE'
            };
            callback(status);
        });
}

// ============================================
// REMARKS/COMMENTS FUNCTIONS
// ============================================

/**
 * Add remark to Firebase
 */
async function addRemarkToFirebase(remark) {
    if (!isFirebaseAvailable()) {
        return addRemarkToLocal(remark);
    }

    try {
        remark.timestamp = Date.now();
        await db.collection('remarks').add(remark);
        console.log('Firebase: Remark added');
        return { success: true };
    } catch (error) {
        console.error('Error adding remark:', error);
        return addRemarkToLocal(remark);
    }
}

/**
 * Listen to remarks in real-time
 */
function listenToRemarks(callback) {
    if (!isFirebaseAvailable()) {
        const remarks = JSON.parse(localStorage.getItem('tank_remarks') || '[]');
        callback(remarks);
        return () => {};
    }

    return db.collection('remarks')
        .orderBy('timestamp', 'desc')
        .limit(50)
        .onSnapshot((snapshot) => {
            const items = [];
            snapshot.forEach((doc) => {
                items.push({ id: doc.id, ...doc.data() });
            });
            callback(items);
        }, (error) => {
            console.error('Error listening to remarks:', error);
            const remarks = JSON.parse(localStorage.getItem('tank_remarks') || '[]');
            callback(remarks);
        });
}

// ============================================
// SPOKEN NEWS FUNCTIONS (Shared across all users)
// ============================================

/**
 * Mark a news item as spoken (shared across ALL users)
 * Once marked, NO user will hear it again
 * @param {string} newsId - Unique ID of the news item
 */
async function markNewsAsSpoken(newsId) {
    if (!isFirebaseAvailable()) {
        // Fallback to localStorage
        const spoken = JSON.parse(localStorage.getItem('tank_spoken_news') || '[]');
        if (!spoken.includes(newsId)) {
            spoken.push(newsId);
            if (spoken.length > 500) spoken.shift();
            localStorage.setItem('tank_spoken_news', JSON.stringify(spoken));
        }
        return { success: true };
    }

    try {
        await db.collection('spoken_news').doc(newsId).set({
            spokenAt: firebase.firestore.FieldValue.serverTimestamp(),
            timestamp: Date.now()
        });
        console.log('✅ Marked as spoken (Firebase - all users):', newsId);
        return { success: true };
    } catch (error) {
        console.error('Error marking news as spoken:', error);
        return { success: false, error };
    }
}

/**
 * Check if a news item was already spoken (by ANY user)
 * @param {string} newsId - Unique ID of the news item
 * @returns {Promise<boolean>} True if already spoken
 */
async function wasNewsSpoken(newsId) {
    if (!isFirebaseAvailable()) {
        // Fallback to localStorage
        const spoken = JSON.parse(localStorage.getItem('tank_spoken_news') || '[]');
        return spoken.includes(newsId);
    }

    try {
        const doc = await db.collection('spoken_news').doc(newsId).get();
        return doc.exists;
    } catch (error) {
        console.error('Error checking if news was spoken:', error);
        return false;
    }
}

/**
 * Get all spoken news IDs (for debugging)
 * @returns {Promise<string[]>} Array of spoken news IDs
 */
async function getAllSpokenNews() {
    if (!isFirebaseAvailable()) {
        const spoken = JSON.parse(localStorage.getItem('tank_spoken_news') || '[]');
        return spoken;
    }

    try {
        const snapshot = await db.collection('spoken_news').get();
        const ids = [];
        snapshot.forEach(doc => {
            ids.push(doc.id);
        });
        return ids;
    } catch (error) {
        console.error('Error getting spoken news:', error);
        return [];
    }
}

// ============================================
// WATCHLIST FUNCTIONS
// ============================================

/**
 * Save watchlist to Firebase
 */
async function saveWatchlistToFirebase(symbols) {
    if (!isFirebaseAvailable()) {
        localStorage.setItem('tank_watchlist', JSON.stringify(symbols));
        return { success: true };
    }

    try {
        await db.collection('watchlist').doc('current').set({
            symbols: symbols,
            updatedAt: Date.now()
        });
        return { success: true };
    } catch (error) {
        console.error('Error saving watchlist:', error);
        localStorage.setItem('tank_watchlist', JSON.stringify(symbols));
        return { success: false };
    }
}

/**
 * Listen to watchlist in real-time
 */
function listenToWatchlist(callback) {
    if (!isFirebaseAvailable()) {
        const symbols = JSON.parse(localStorage.getItem('tank_watchlist') || '[]');
        callback(symbols);
        return () => {};
    }

    return db.collection('watchlist').doc('current')
        .onSnapshot((doc) => {
            if (doc.exists) {
                callback(doc.data().symbols || []);
            } else {
                callback([]);
            }
        }, (error) => {
            console.error('Error listening to watchlist:', error);
            const symbols = JSON.parse(localStorage.getItem('tank_watchlist') || '[]');
            callback(symbols);
        });
}

// ============================================
// LOCAL STORAGE FALLBACK FUNCTIONS
// ============================================

function addKnowledgeToLocal(knowledge) {
    const items = JSON.parse(localStorage.getItem('tank_knowledge_db') || '[]');
    knowledge.id = 'local_' + Date.now();
    knowledge.timestamp = Date.now();
    items.unshift(knowledge);
    localStorage.setItem('tank_knowledge_db', JSON.stringify(items));
    return { success: true, id: knowledge.id };
}

function deleteKnowledgeFromLocal(id) {
    const items = JSON.parse(localStorage.getItem('tank_knowledge_db') || '[]');
    const filtered = items.filter(item => item.id !== id);
    localStorage.setItem('tank_knowledge_db', JSON.stringify(filtered));
    return { success: true };
}

function saveNewsToLocal(newsArray) {
    const existing = JSON.parse(localStorage.getItem('allNews') || '[]');
    let addedCount = 0;

    newsArray.forEach(news => {
        const exists = existing.find(n => n.title === news.title);
        if (!exists) {
            news.timestamp = news.timestamp || Date.now();
            existing.unshift(news);
            addedCount++;
        }
    });

    localStorage.setItem('allNews', JSON.stringify(existing.slice(0, 100)));
    return { success: true, added: addedCount };
}

function cleanOldNewsFromLocal() {
    const allNews = JSON.parse(localStorage.getItem('allNews') || '[]');
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    const recent = allNews.filter(news => {
        const newsTime = news.timestamp || new Date(news.date).getTime() || 0;
        return (now - newsTime) < twentyFourHours;
    });

    localStorage.setItem('allNews', JSON.stringify(recent));
    return { success: true, deleted: allNews.length - recent.length };
}

function saveMarketToLocal(tokens) {
    localStorage.setItem('marketTokens', JSON.stringify(tokens));
    return { success: true };
}

function saveStatusToLocal(status) {
    if (status.temp) localStorage.setItem('arcticTemp', status.temp);
    if (status.ice) localStorage.setItem('arcticIce', status.ice);
    if (status.snow) localStorage.setItem('arcticSnow', status.snow);
    if (status.aurora) localStorage.setItem('arcticAurora', status.aurora);
    return { success: true };
}

function addRemarkToLocal(remark) {
    const remarks = JSON.parse(localStorage.getItem('tank_remarks') || '[]');
    remark.timestamp = Date.now();
    remarks.unshift(remark);
    localStorage.setItem('tank_remarks', JSON.stringify(remarks.slice(0, 50)));
    return { success: true };
}

// ============================================
// CLEANUP INTERVAL
// ============================================

// Clean old news every 10 minutes
setInterval(() => {
    cleanOldNewsFromFirebase();
}, 10 * 60 * 1000);

// ============================================
// GLOBAL EXPORTS
// ============================================

window.FirebaseDB = {
    init: initFirebase,
    isAvailable: isFirebaseAvailable,

    // Knowledge
    addKnowledge: addKnowledgeToFirebase,
    listenToKnowledge: listenToKnowledge,
    listenToKnowledgeWithChanges: listenToKnowledgeWithChanges,
    deleteKnowledge: deleteKnowledgeFromFirebase,

    // News
    saveNews: saveNewsToFirebase,
    listenToNews: listenToNews,
    cleanOldNews: cleanOldNewsFromFirebase,

    // Spoken News (shared across all users)
    markNewsAsSpoken: markNewsAsSpoken,
    wasNewsSpoken: wasNewsSpoken,
    getAllSpokenNews: getAllSpokenNews,

    // Market
    saveMarket: saveMarketToFirebase,
    listenToMarket: listenToMarket,

    // Status
    saveStatus: saveStatusToFirebase,
    listenToStatus: listenToStatus,

    // Remarks
    addRemark: addRemarkToFirebase,
    listenToRemarks: listenToRemarks,

    // Watchlist
    saveWatchlist: saveWatchlistToFirebase,
    listenToWatchlist: listenToWatchlist
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
});

console.log('Firebase module loaded. Call FirebaseDB.init() to initialize.');
