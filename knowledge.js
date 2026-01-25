/**
 * KNOWLEDGE GRAPH - MR. TANK
 * 3D Visualization with Three.js
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================
// CONFIGURATION
// ============================================

// Arctic theme colors (matching main page)
const TYPE_COLORS = {
    'Note': { color: 0x88d4f7, name: 'KNOWLEDGE', emoji: '❄️' },
    'Fact': { color: 0x4fd1c5, name: 'FACTS', emoji: '🧊' },
    'Link': { color: 0x4adeab, name: 'JOURNAL', emoji: '🌿' },
    'Article': { color: 0xa78bfa, name: 'OBSERVATION', emoji: '🔮' },
    'Quote': { color: 0xf788b0, name: 'NEWS', emoji: '📰' },
    'Market': { color: 0x5bb8e0, name: 'MARKET', emoji: '📊' },
    'Prediction': { color: 0xa78bfa, name: 'PREDICTION', emoji: '🔮' },
    'Art': { color: 0xf59e0b, name: 'ART', emoji: '🎨' },
    'Meme': { color: 0xf788b0, name: 'MEMES', emoji: '🐧' },
    'Tweet': { color: 0x88d4f7, name: 'TWEETS', emoji: '🐦' },
    'Entry': { color: 0xe8f4f8, name: 'ENTRY', emoji: '📝' },
    'Other': { color: 0x5a7a8a, name: 'OTHER', emoji: '❄️' }
};

// ============================================
// STATE
// ============================================

const STATE = {
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    knowledgeDB: [],
    nodes: [],
    raycaster: new THREE.Raycaster(),
    mouse: new THREE.Vector2(),
    hoveredNode: null,
    selectedNode: null,
    typeCounts: {}
};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initSnowfall();
    initClock();
    initHeaderControls();
    loadKnowledge();
    initThreeJS();
    initLegend();
    initSearch();
    initDirectory();
    updateStats();
    animate();
});

// ============================================
// SNOWFALL EFFECT
// ============================================

function initSnowfall() {
    const container = document.getElementById('snowflakes');
    if (!container) return;

    const snowflakeChars = ['❄', '❅', '❆', '•', '✦'];
    const numSnowflakes = 80;

    for (let i = 0; i < numSnowflakes; i++) {
        const snowflake = document.createElement('div');
        snowflake.className = 'snowflake';
        snowflake.textContent = snowflakeChars[Math.floor(Math.random() * snowflakeChars.length)];

        // Random properties
        const startX = Math.random() * 100;
        const size = 0.5 + Math.random() * 1.2;
        const duration = 10 + Math.random() * 15;
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
// HEADER CONTROLS
// ============================================

function initHeaderControls() {
    const voiceToggle = document.getElementById('voiceToggle');
    const soundToggle = document.getElementById('soundToggle');
    const voiceState = document.getElementById('voiceState');
    const soundState = document.getElementById('soundState');

    let voiceOn = false;
    let soundOn = false;

    if (voiceToggle) {
        voiceToggle.addEventListener('click', () => {
            voiceOn = !voiceOn;
            voiceState.textContent = voiceOn ? 'VOICE ON' : 'VOICE OFF';
            voiceToggle.classList.toggle('active', voiceOn);
        });
    }

    if (soundToggle) {
        soundToggle.addEventListener('click', () => {
            soundOn = !soundOn;
            soundState.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
            soundToggle.classList.toggle('active', soundOn);
        });
    }
}

// ============================================
// LOAD KNOWLEDGE FROM FIREBASE (REAL-TIME)
// ============================================

function loadKnowledge() {
    // Check if FirebaseDB is available
    if (typeof FirebaseDB === 'undefined') {
        console.warn('FirebaseDB not loaded. Using localStorage fallback.');
        loadKnowledgeFromLocal();
        return;
    }

    FirebaseDB.init();

    // Listen to knowledge in real-time
    FirebaseDB.listenToKnowledge((items) => {
        console.log(`Knowledge updated: ${items.length} items`);
        STATE.knowledgeDB = items;

        // Count types
        STATE.typeCounts = {};
        STATE.knowledgeDB.forEach(item => {
            const type = item.type || 'Other';
            STATE.typeCounts[type] = (STATE.typeCounts[type] || 0) + 1;
        });

        // Update UI and 3D visualization
        updateStats();
        updateDirectory();

        // Recreate 3D nodes if scene exists
        if (STATE.scene) {
            recreateNodes();
        }
    });
}

// Fallback to localStorage
function loadKnowledgeFromLocal() {
    const stored = localStorage.getItem('tank_knowledge_db');
    if (stored) {
        try {
            STATE.knowledgeDB = JSON.parse(stored);
        } catch (e) {
            STATE.knowledgeDB = [];
        }
    }

    // Count types
    STATE.typeCounts = {};
    STATE.knowledgeDB.forEach(item => {
        const type = item.type || 'Other';
        STATE.typeCounts[type] = (STATE.typeCounts[type] || 0) + 1;
    });
}

// ============================================
// THREE.JS SETUP
// ============================================

function initThreeJS() {
    const container = document.getElementById('graphContainer');
    const canvas = document.getElementById('graphCanvas');

    // Scene - Arctic dark theme
    STATE.scene = new THREE.Scene();
    STATE.scene.background = new THREE.Color(0x0a1628);

    // Add fog for depth - arctic blue
    STATE.scene.fog = new THREE.FogExp2(0x0a1628, 0.012);

    // Camera
    const aspect = container.clientWidth / container.clientHeight;
    STATE.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    STATE.camera.position.set(0, 30, 50);

    // Renderer
    STATE.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    STATE.renderer.setSize(container.clientWidth, container.clientHeight);
    STATE.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Controls
    STATE.controls = new OrbitControls(STATE.camera, STATE.renderer.domElement);
    STATE.controls.enableDamping = true;
    STATE.controls.dampingFactor = 0.05;
    STATE.controls.maxDistance = 150;
    STATE.controls.minDistance = 10;

    // Lighting - Arctic theme
    const ambient = new THREE.AmbientLight(0x1b2838, 0.5);
    STATE.scene.add(ambient);

    const pointLight = new THREE.PointLight(0x88d4f7, 1, 100);
    pointLight.position.set(0, 20, 0);
    STATE.scene.add(pointLight);

    const pointLight2 = new THREE.PointLight(0x4fd1c5, 0.5, 100);
    pointLight2.position.set(-30, -10, 20);
    STATE.scene.add(pointLight2);

    // Create central hub
    createCentralHub();

    // Create nodes from knowledge
    createNodes();

    // Create connections
    createConnections();

    // Create grid/ring structure
    createRings();

    // Event listeners
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);
}

function createCentralHub() {
    // Central sphere (Mr. Tank) - Arctic theme
    const geometry = new THREE.SphereGeometry(3, 32, 32);
    const material = new THREE.MeshPhongMaterial({
        color: 0xe8f4f8,
        emissive: 0x1b2838,
        shininess: 100
    });
    const hub = new THREE.Mesh(geometry, material);
    hub.position.set(0, 0, 0);
    STATE.scene.add(hub);

    // Glow effect - Ice blue
    const glowGeometry = new THREE.SphereGeometry(3.5, 32, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0x88d4f7,
        transparent: true,
        opacity: 0.2
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    STATE.scene.add(glow);

    // Label
    addLabel('MR. TANK', new THREE.Vector3(0, 5, 0), 0xe8f4f8);
}

function createNodes() {
    if (STATE.knowledgeDB.length === 0) return;

    // Group items by type for ring placement
    const typeGroups = {};
    STATE.knowledgeDB.forEach(item => {
        const type = item.type || 'Other';
        if (!typeGroups[type]) typeGroups[type] = [];
        typeGroups[type].push(item);
    });

    const types = Object.keys(typeGroups);
    const ringRadius = 15;
    const ringSpacing = 8;

    types.forEach((type, typeIndex) => {
        const items = typeGroups[type];
        const currentRingRadius = ringRadius + typeIndex * ringSpacing;
        const typeConfig = TYPE_COLORS[type] || TYPE_COLORS['Other'];

        items.forEach((item, itemIndex) => {
            // Calculate position in a spiral pattern
            const angle = (itemIndex / items.length) * Math.PI * 2;
            const heightVariation = (Math.random() - 0.5) * 10;

            const x = Math.cos(angle) * currentRingRadius;
            const z = Math.sin(angle) * currentRingRadius;
            const y = heightVariation;

            // Create sphere
            const size = 1 + Math.random() * 0.5;
            const geometry = new THREE.SphereGeometry(size, 16, 16);
            const material = new THREE.MeshPhongMaterial({
                color: typeConfig.color,
                emissive: typeConfig.color,
                emissiveIntensity: 0.2,
                shininess: 50
            });
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.set(x, y, z);

            // Store reference to knowledge item
            sphere.userData = {
                knowledge: item,
                originalColor: typeConfig.color
            };

            STATE.scene.add(sphere);
            STATE.nodes.push(sphere);
        });
    });
}

// Recreate nodes when data changes (real-time updates)
function recreateNodes() {
    // Remove old nodes
    STATE.nodes.forEach(node => {
        STATE.scene.remove(node);
        node.geometry.dispose();
        node.material.dispose();
    });
    STATE.nodes = [];

    // Remove old connections (lines)
    STATE.scene.children.forEach(child => {
        if (child.type === 'Line') {
            STATE.scene.remove(child);
            child.geometry.dispose();
            child.material.dispose();
        }
    });

    // Recreate nodes and connections
    createNodes();
    createConnections();

    // Update legend
    initLegend();
}

function createConnections() {
    if (STATE.nodes.length < 2) return;

    const material = new THREE.LineBasicMaterial({
        color: 0x2d4a6f,
        transparent: true,
        opacity: 0.3
    });

    // Connect nodes with shared tags
    for (let i = 0; i < STATE.nodes.length; i++) {
        const node1 = STATE.nodes[i];
        const item1 = node1.userData.knowledge;

        // Connect to central hub - Arctic theme
        const hubLine = createLine(
            node1.position,
            new THREE.Vector3(0, 0, 0),
            0x2d4a6f,
            0.1
        );
        STATE.scene.add(hubLine);

        // Connect to nearby nodes with shared tags
        for (let j = i + 1; j < STATE.nodes.length; j++) {
            const node2 = STATE.nodes[j];
            const item2 = node2.userData.knowledge;

            const sharedTags = (item1.tags || []).filter(t =>
                (item2.tags || []).includes(t)
            );

            if (sharedTags.length > 0) {
                const line = createLine(
                    node1.position,
                    node2.position,
                    0x4fd1c5,
                    0.2 + sharedTags.length * 0.1
                );
                STATE.scene.add(line);
            }
        }
    }
}

function createLine(start, end, color, opacity) {
    const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity
    });
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    return new THREE.Line(geometry, material);
}

function createRings() {
    const ringMaterial = new THREE.LineBasicMaterial({
        color: 0x2d4a6f,
        transparent: true,
        opacity: 0.2
    });

    // Create concentric rings
    for (let i = 1; i <= 5; i++) {
        const radius = 15 + i * 8;
        const segments = 64;
        const geometry = new THREE.BufferGeometry();
        const points = [];

        for (let j = 0; j <= segments; j++) {
            const angle = (j / segments) * Math.PI * 2;
            points.push(new THREE.Vector3(
                Math.cos(angle) * radius,
                0,
                Math.sin(angle) * radius
            ));
        }

        geometry.setFromPoints(points);
        const ring = new THREE.Line(geometry, ringMaterial);
        STATE.scene.add(ring);
    }

    // Grid lines - Arctic theme
    const gridHelper = new THREE.GridHelper(100, 20, 0x2d4a6f, 0x1b2838);
    gridHelper.position.y = -15;
    STATE.scene.add(gridHelper);
}

function addLabel(text, position, color) {
    // Using sprites for labels (simplified)
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;

    context.fillStyle = 'transparent';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.font = '24px IBM Plex Mono';
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.textAlign = 'center';
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(10, 2.5, 1);
    STATE.scene.add(sprite);
}

// ============================================
// INTERACTION
// ============================================

function onMouseMove(event) {
    const container = document.getElementById('graphContainer');
    const rect = container.getBoundingClientRect();

    STATE.mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
    STATE.mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

    // Raycasting
    STATE.raycaster.setFromCamera(STATE.mouse, STATE.camera);
    const intersects = STATE.raycaster.intersectObjects(STATE.nodes);

    // Reset previous hover
    if (STATE.hoveredNode && STATE.hoveredNode !== STATE.selectedNode) {
        STATE.hoveredNode.material.emissiveIntensity = 0.2;
        STATE.hoveredNode.scale.setScalar(1);
    }

    if (intersects.length > 0) {
        const node = intersects[0].object;
        STATE.hoveredNode = node;
        node.material.emissiveIntensity = 0.5;
        node.scale.setScalar(1.3);

        // Update hover preview
        const item = node.userData.knowledge;
        updateHoverPreview(item);
    } else {
        STATE.hoveredNode = null;
        document.getElementById('hoverContent').textContent = 'Hover a node to preview.';
        document.getElementById('hoverContent').classList.remove('has-content');
    }
}

function onClick(event) {
    if (STATE.hoveredNode) {
        // Deselect previous
        if (STATE.selectedNode) {
            STATE.selectedNode.material.emissiveIntensity = 0.2;
            STATE.selectedNode.scale.setScalar(1);
        }

        STATE.selectedNode = STATE.hoveredNode;
        STATE.selectedNode.material.emissiveIntensity = 0.8;
        STATE.selectedNode.scale.setScalar(1.5);

        const item = STATE.selectedNode.userData.knowledge;
        updateSelectedDetail(item);
    }
}

function updateHoverPreview(item) {
    const content = document.getElementById('hoverContent');
    const preview = item.text.substring(0, 80) + (item.text.length > 80 ? '...' : '');
    content.textContent = `[${item.type}] ${preview}`;
    content.classList.add('has-content');
}

function updateSelectedDetail(item) {
    const content = document.getElementById('selectedContent');
    const date = new Date(item.timestamp).toLocaleDateString();

    content.innerHTML = `
        <div style="margin-bottom: 8px;"><strong>${item.type.toUpperCase()}</strong></div>
        <div style="margin-bottom: 8px;">${escapeHtml(item.text)}</div>
        <div style="font-size: 9px; color: #7a7a7a;">
            By: ${item.author || 'anon'} | ${date}
            ${item.tags && item.tags.length > 0 ? '<br>Tags: ' + item.tags.join(', ') : ''}
        </div>
    `;
    content.classList.add('has-content');
}

function onResize() {
    const container = document.getElementById('graphContainer');
    STATE.camera.aspect = container.clientWidth / container.clientHeight;
    STATE.camera.updateProjectionMatrix();
    STATE.renderer.setSize(container.clientWidth, container.clientHeight);
}

// ============================================
// ANIMATION
// ============================================

function animate() {
    requestAnimationFrame(animate);

    // Rotate nodes slightly for ambient motion
    STATE.nodes.forEach((node, i) => {
        node.position.y += Math.sin(Date.now() * 0.001 + i) * 0.002;
    });

    STATE.controls.update();
    STATE.renderer.render(STATE.scene, STATE.camera);
}

// ============================================
// UI FUNCTIONS
// ============================================

function initLegend() {
    const container = document.getElementById('legendContainer');
    container.innerHTML = '';

    Object.entries(TYPE_COLORS).forEach(([type, config]) => {
        const count = STATE.typeCounts[type] || 0;
        const div = document.createElement('div');
        div.className = 'legend-item';
        div.innerHTML = `
            <div class="legend-color" style="background: #${config.color.toString(16).padStart(6, '0')}"></div>
            <span>${config.name}</span>
            <span class="legend-count">${count}</span>
        `;
        container.appendChild(div);
    });
}

function initDirectory() {
    const container = document.getElementById('directoryList');

    if (STATE.knowledgeDB.length === 0) {
        container.innerHTML = '<div class="empty-message">No knowledge yet.</div>';
        return;
    }

    container.innerHTML = '';
    const items = [...STATE.knowledgeDB].reverse().slice(0, 20);

    items.forEach(item => {
        const typeConfig = TYPE_COLORS[item.type] || TYPE_COLORS['Other'];
        const date = formatDate(item.timestamp);
        const preview = item.text.substring(0, 40) + (item.text.length > 40 ? '...' : '');

        const div = document.createElement('div');
        div.className = 'directory-item';
        div.innerHTML = `
            <div class="dir-icon" style="background: #${typeConfig.color.toString(16).padStart(6, '0')}"></div>
            <span class="dir-text">${escapeHtml(preview)}</span>
            <span class="dir-type">${item.type}</span>
            <span class="dir-date">${date}</span>
        `;
        div.addEventListener('click', () => {
            focusOnKnowledge(item);
        });
        container.appendChild(div);
    });

    document.getElementById('directoryItems').textContent = `${items.length} / ${STATE.knowledgeDB.length}`;
}

function focusOnKnowledge(item) {
    // Find the node for this item
    const node = STATE.nodes.find(n => n.userData.knowledge.id === item.id);
    if (node) {
        // Animate camera to focus on this node
        const targetPos = node.position.clone();
        targetPos.z += 15;
        targetPos.y += 5;

        STATE.camera.position.copy(targetPos);
        STATE.controls.target.copy(node.position);

        // Select the node
        if (STATE.selectedNode) {
            STATE.selectedNode.material.emissiveIntensity = 0.2;
            STATE.selectedNode.scale.setScalar(1);
        }
        STATE.selectedNode = node;
        node.material.emissiveIntensity = 0.8;
        node.scale.setScalar(1.5);
        updateSelectedDetail(item);
    }
}

function initSearch() {
    const input = document.getElementById('searchInput');
    const btn = document.getElementById('searchBtn');
    const results = document.getElementById('searchResults');

    btn.addEventListener('click', performSearch);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    function performSearch() {
        const query = input.value.toLowerCase().trim();
        if (!query) {
            results.innerHTML = '<div class="empty-message">No results.</div>';
            return;
        }

        const matches = STATE.knowledgeDB.filter(item =>
            item.text.toLowerCase().includes(query) ||
            (item.tags || []).some(t => t.toLowerCase().includes(query)) ||
            (item.url || '').toLowerCase().includes(query)
        );

        if (matches.length === 0) {
            results.innerHTML = '<div class="empty-message">No results.</div>';
            return;
        }

        results.innerHTML = '';
        matches.slice(0, 10).forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.innerHTML = `
                <div style="font-size: 10px; margin-bottom: 2px;">[${item.type}]</div>
                <div style="font-size: 11px;">${escapeHtml(item.text.substring(0, 60))}...</div>
            `;
            div.addEventListener('click', () => focusOnKnowledge(item));
            results.appendChild(div);
        });
    }
}

function updateStats() {
    const total = STATE.knowledgeDB.length;
    const types = Object.keys(STATE.typeCounts).length;
    const latest = total > 0 ? formatDate(STATE.knowledgeDB[total - 1].timestamp) : '--';

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statTank').textContent = total;
    document.getElementById('statTypes').textContent = types;
    document.getElementById('statLatest').textContent = latest;

    document.getElementById('headerItems').textContent = `${total} / ${total}`;
    document.getElementById('headerEntries').textContent = total;
    document.getElementById('inspectorLatest').textContent = latest;
}

// ============================================
// UTILITIES
// ============================================

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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
