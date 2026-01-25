/**
 * FIREBASE CLEANUP SCRIPT
 * Limpa TODOS os dados do Firebase para começar do zero
 */

// Usar firebase-admin para poder deletar em lote
const admin = require('firebase-admin');

// Inicializar com credenciais do projeto
admin.initializeApp({
    apiKey: "AIzaSyDGqhVjbrao2krVid14FVoppeqE6PqvjlA",
    authDomain: "tank-c748f.firebaseapp.com",
    projectId: "tank-c748f",
    storageBucket: "tank-c748f.firebasestorage.app",
    messagingSenderId: "804077384752",
    appId: "1:804077384752:web:118c377b61574f849929f5"
});

const db = admin.firestore();

/**
 * Limpar uma collection inteira
 */
async function clearCollection(collectionName) {
    console.log(`\n🗑️  Clearing collection: ${collectionName}`);

    const collectionRef = db.collection(collectionName);
    const snapshot = await collectionRef.get();

    if (snapshot.empty) {
        console.log(`   ℹ️  Collection "${collectionName}" is already empty`);
        return 0;
    }

    let deletedCount = 0;
    const batchSize = 500;

    // Deletar em lotes
    const deleteInBatch = async (docs) => {
        const batch = db.batch();
        docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        return docs.length;
    };

    let allDocs = snapshot.docs;

    while (allDocs.length > 0) {
        const batch = allDocs.splice(0, batchSize);
        const deleted = await deleteInBatch(batch);
        deletedCount += deleted;
        console.log(`   🗑️  Deleted ${deletedCount} documents...`);
    }

    console.log(`   ✅ Cleared ${deletedCount} documents from "${collectionName}"`);
    return deletedCount;
}

/**
 * Limpar TODAS as collections
 */
async function clearAllData() {
    console.log('╔═══════════════════════════════════════════╗');
    console.log('║   🧹 FIREBASE CLEANUP - MR. TANK        ║');
    console.log('║   Clearing ALL data from Firebase        ║');
    console.log('╚═══════════════════════════════════════════╝');

    const collections = [
        'knowledge',      // Conhecimentos adicionados
        'news',          // Notícias do RSS
        'spoken_news',   // Notícias já lidas
        'user_tokens',   // Tokens do market (se existir)
        'market',        // Market data
        'status',        // Status compartilhado
        'remarks',       // Comentários
        'watchlist'      // Watchlist
    ];

    let totalDeleted = 0;

    for (const collectionName of collections) {
        try {
            const deleted = await clearCollection(collectionName);
            totalDeleted += deleted;
        } catch (error) {
            console.error(`   ❌ Error clearing ${collectionName}:`, error.message);
        }
    }

    console.log('\n╔═══════════════════════════════════════════╗');
    console.log(`║   ✅ CLEANUP COMPLETE!                    ║`);
    console.log(`║   Total documents deleted: ${totalDeleted.toString().padEnd(14)}║`);
    console.log('╚═══════════════════════════════════════════╝\n');

    console.log('📝 Next steps:');
    console.log('   1. Clear browser localStorage: localStorage.clear()');
    console.log('   2. Refresh the page: F5');
    console.log('   3. Site will start fresh with no data!\n');
}

// Executar limpeza
clearAllData()
    .then(() => {
        console.log('✅ Script finished successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Script failed:', error);
        process.exit(1);
    });
