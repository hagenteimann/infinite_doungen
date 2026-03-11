import Peer from 'peerjs';
import { State, subscribe, dispatch } from './state.js';
import { UI, DOM } from './ui.js';
import { Engine } from './engine.js';
import { Sound } from './sound.js';
import { PartyManager } from './party.js';
import { Utils } from './utils.js';
import { validateHeroData, sanitize } from './sanitize.js';
import { API } from './api.js';
import { Weather } from './features.js';

const ROOM_PREFIX = 'infdung-';
const CONNECT_TIMEOUT_MS = 10000;
const LS_KEY_SERVER = 'mp_peer_server';
const LS_KEY_TURN = 'mp_turn_config';

const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: 'free', credential: 'free' },
    { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'free', credential: 'free' },
];

const SYNC_KEYS = [
    'party', 'activeEnemies', 'defeatedEnemies', 'lootDrops', 'gold', 'dungeonLevel',
    'lastStoryPart', 'gameStarted', 'combatEnded', 'activeMerchant',
    'journal', 'sessionStats', 'fate', 'fatigue', 'abilityCooldowns',
    'isBossFight', 'weather', 'momentum', 'chatHistory', 'isProcessing',
    'pendingRolls', 'recentRolls', 'pendingAbilityLearning', 'quickplayEnabled',
    'routeChoices', 'craftingIngredients', 'activeCrafterId',
    'chatMessages', 'systemMessages', 'transientEvents', 'sessionPhase', 'playerProfiles', 'playerControlMode', 'afkSince',
];

export const Network = {
    peer: null,
    connections: [],
    role: null,
    roomCode: null,
    playerName: '',
    connState: 'idle',
    _unsubscribe: null,
    _connectTimer: null,
    _lastError: '',
    _currentActionPlayerName: null,
    turnOrder: [],
    currentTurnIndex: 0,
    combatActions: {},
    _combatStatus: {},
    playerCharMap: {},
    currentVote: null,
    _mySubmittedAction: null,
    autoPlayers: {},
    _seenMessageIds: new Set(),
    _seenEventIds: new Set(),
    _syncDirty: false,
    _syncDebounceTimer: null,
    _heartbeatTimer: null,

    isHost() { return this.role === 'host'; },
    isClient() { return this.role === 'client'; },
    isConnected() { return this.connState === 'connected'; },
    isInCombat() {
        return this.isConnected() && this.turnOrder.length > 1 &&
            State.activeEnemies && State.activeEnemies.length > 0;
    },
    getMyCharId() {
        return this.playerCharMap[this.playerName] || null;
    },
    isMyTurn() {
        if (!this.isConnected() || this.turnOrder.length <= 1) return true;
        if (this.isInCombat()) return !this._mySubmittedAction;
        const current = String(this.turnOrder[this.currentTurnIndex] || '').toLowerCase().trim();
        const me = String(this.playerName || '').toLowerCase().trim();
        return current === me;
    },

    generateRoomCode() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    },

    validatePlayerName(playerName) {
        const normalized = String(playerName || '').trim();
        if (!normalized) return 'Bitte starte zuerst eine Sitzung.';
        if (/^slot-[a-z0-9]{4,}$/i.test(normalized)) return '';
        if (normalized.length < 2) return 'Der Spielername sollte mindestens 2 Zeichen haben.';
        if (/^(spieler|host|player)$/i.test(normalized)) return 'Bitte waehle einen echten Namen statt eines Platzhalters.';
        return '';
    },

    getDisplayPlayerName(playerName, fallback = 'Ein Held') {
        const normalized = String(playerName || '').trim();
        const heroName = String(State.playerProfiles?.[normalized]?.heroName || '').trim();
        if (heroName) return heroName;
        if (!normalized) return fallback;
        if (/^slot-[a-z0-9]{4,}$/i.test(normalized)) return fallback;
        return normalized;
    },

    _ensurePlayerProfile(playerName, updates = {}) {
        if (!playerName) return null;
        State.playerProfiles = State.playerProfiles || {};
        const existing = State.playerProfiles[playerName] || {};
        const next = {
            name: playerName,
            heroId: existing.heroId || null,
            heroName: existing.heroName || '',
            isReady: !!existing.isReady,
            controlMode: this.getPlayerControlMode(playerName),
            ...existing,
            ...updates,
        };
        State.playerProfiles[playerName] = next;
        return next;
    },

    setPregameReady(playerName, isReady, options = {}) {
        if (!playerName) return;
        this._ensurePlayerProfile(playerName, { isReady: !!isReady, controlMode: this.getPlayerControlMode(playerName) });
        if (this.isHost() && options.broadcast !== false) this._markDirty();
    },

    _rememberSeenId(store, id, limit = 400) {
        if (!id) return;
        store.add(id);
        if (store.size > limit) {
            const first = store.values().next().value;
            if (first) store.delete(first);
        }
    },

    _mergeCollectionById(current, incoming) {
        const map = new Map();
        (Array.isArray(current) ? current : []).forEach(item => {
            if (item?.id) map.set(item.id, item);
        });
        (Array.isArray(incoming) ? incoming : []).forEach(item => {
            if (!item?.id) return;
            map.set(item.id, { ...(map.get(item.id) || {}), ...item });
        });
        return [...map.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    },

    _rememberStateIds() {
        (State.chatMessages || []).forEach(entry => this._rememberSeenId(this._seenMessageIds, entry.id));
        (State.systemMessages || []).forEach(entry => this._rememberSeenId(this._seenMessageIds, entry.id));
        (State.transientEvents || []).forEach(event => this._rememberSeenId(this._seenEventIds, event.id));
    },

    _syncAutoPlayersFromControlModes() {
        this.autoPlayers = {};
        const modes = State.playerControlMode || {};
        Object.entries(modes).forEach(([playerName, mode]) => {
            if (mode === 'ai') this.autoPlayers[playerName] = true;
        });
    },

    getPlayerControlMode(playerName) {
        return State.playerControlMode?.[playerName] || (this.autoPlayers[playerName] ? 'ai' : 'human');
    },

    _recordChatEntry(entry, broadcastType = null) {
        if (!entry || !entry.id) return null;
        dispatch({ type: 'ADD_CHAT_MSG', entry });
        this._rememberSeenId(this._seenMessageIds, entry.id);
        if (this.isHost() && broadcastType) {
            this.connections.forEach(conn => this._sendTo(conn, { type: broadcastType, entry }));
            this._markDirty();
        }
        return entry;
    },

    _recordSystemEntry(entry, broadcast = true) {
        if (!entry || !entry.id) return null;
        dispatch({ type: 'ADD_SYSTEM_MSG', entry });
        this._rememberSeenId(this._seenMessageIds, entry.id);
        if (this.isHost() && broadcast) {
            this.connections.forEach(conn => this._sendTo(conn, { type: 'SYSTEM_CHAT', entry }));
            this._markDirty();
        }
        return entry;
    },

    _pushTransientEvent(event, options = {}) {
        if (!event) return null;
        const now = Date.now();
        const normalized = {
            id: event.id || Utils.generateId('te'),
            type: event.type || 'important_notice',
            sender: event.sender || 'System',
            targetPlayer: event.targetPlayer || null,
            payload: event.payload || {},
            createdAt: event.createdAt || now,
            expiresAt: event.expiresAt || (now + (options.durationMs || 5000)),
        };
        State.transientEvents = Array.isArray(State.transientEvents) ? State.transientEvents : [];
        const idx = State.transientEvents.findIndex(item => item.id === normalized.id);
        if (idx >= 0) State.transientEvents[idx] = { ...State.transientEvents[idx], ...normalized };
        else State.transientEvents.push(normalized);
        State.transientEvents = State.transientEvents.filter(item => item.expiresAt > now).slice(-12);
        this._rememberSeenId(this._seenEventIds, normalized.id);
        if (options.render !== false) UI.showTransientEvent(normalized);
        if (this.isHost() && options.broadcast !== false) {
            this.connections.forEach(conn => this._sendTo(conn, { type: 'TRANSIENT_EVENT', event: normalized }));
            this._markDirty();
        }
        return normalized;
    },

    setPlayerControlMode(playerName, mode) {
        if (!this.isHost() || !playerName) return;
        State.playerControlMode = State.playerControlMode || {};
        State.playerControlMode[playerName] = mode === 'ai' ? 'ai' : 'human';
        this._syncAutoPlayersFromControlModes();
        const displayName = this.getDisplayPlayerName(playerName);
        const entry = { id: Utils.generateId('sys'), sender: 'System', text: '**' + displayName + '** ist jetzt ' + (State.playerControlMode[playerName] === 'ai' ? 'KI-gesteuert' : 'manuell') + '.', tone: 'neutral', createdAt: Date.now() };
        this._recordSystemEntry(entry);
        this.connections.forEach(conn => this._sendTo(conn, { type: 'CONTROL_MODE_UPDATE', playerName, mode: State.playerControlMode[playerName] }));
        this._updateTurnUI();
    },

    togglePlayerControlMode(playerName) {
        this.setPlayerControlMode(playerName, this.getPlayerControlMode(playerName) === 'ai' ? 'human' : 'ai');
    },
    _getPeerConfig() {
        const opts = { config: { iceServers: [...DEFAULT_ICE_SERVERS] } };

        try {
            const turnJson = Utils.safeStorageGet(LS_KEY_TURN);
            if (turnJson) {
                const custom = JSON.parse(turnJson);
                if (Array.isArray(custom) && custom.length > 0) {
                    opts.config.iceServers = [...DEFAULT_ICE_SERVERS, ...custom];
                }
            }
        } catch (e) { console.warn('Failed to parse TURN config:', e); }

        try {
            const serverJson = Utils.safeStorageGet(LS_KEY_SERVER);
            if (serverJson) {
                const srv = JSON.parse(serverJson);
                if (srv.host) {
                    opts.host = srv.host;
                    opts.port = parseInt(srv.port) || 9000;
                    opts.path = srv.path || '/';
                    opts.secure = srv.secure !== false;
                }
            }
        } catch (e) { console.warn('Failed to parse server config:', e); }

        return opts;
    },

    _setConnState(state, error) {
        this.connState = state;
        this._lastError = error || '';
        this._updateUI();
    },

    _startConnectTimeout() {
        this._clearConnectTimeout();
        this._connectTimer = setTimeout(() => {
            if (this.connState === 'connecting') {
                this._setConnState('error', 'Zeitüberschreitung: Server nicht erreichbar.');
                this.disconnect();
            }
        }, CONNECT_TIMEOUT_MS);
    },

    _clearConnectTimeout() {
        if (this._connectTimer) {
            clearTimeout(this._connectTimer);
            this._connectTimer = null;
        }
    },

    host(playerName) {
        const error = this.validatePlayerName(playerName);
        if (error) {
            UI.addChatLog('System', error);
            return false;
        }
        if (this.peer) this.disconnect();
        this.playerName = String(playerName || '').trim();
        this.roomCode = this.generateRoomCode();
        this.role = 'host';
        State._mpRole = 'host';
        this._setConnState('connecting');
        this._startConnectTimeout();

        const peerId = ROOM_PREFIX + this.roomCode;
        const config = this._getPeerConfig();
        this.peer = new Peer(peerId, config);

        this.peer.on('open', () => {
            this._clearConnectTimeout();
            this._setConnState('connected');
            this.turnOrder = [this.playerName];
            this.currentTurnIndex = 0;
            State.playerControlMode = { [this.playerName]: 'human' };
            this._ensurePlayerProfile(this.playerName, { isReady: false, controlMode: 'human' });
            this._startHeartbeat();
            this._recordSystemEntry({ id: Utils.generateId('sys'), sender: 'System', text: `Multiplayer-Raum erstellt: **${this.roomCode}**. Teile diesen Code mit deinen Spielern.`, tone: 'neutral', createdAt: Date.now() }, false);
            UI.updateAll();
        });

        this.peer.on('connection', (conn) => {
            conn.on('open', () => {
                this.connections.push(conn);
                const joinedName = conn.metadata?.name || 'Unbekannt';
                const joinedLabel = this.getDisplayPlayerName(joinedName, 'Ein Spieler');
                this._recordSystemEntry({ id: Utils.generateId('sys'), sender: 'System', text: `**${joinedLabel}** ist beigetreten.`, tone: 'neutral', createdAt: Date.now() });
                if (!this.turnOrder.includes(joinedName)) {
                    this.turnOrder.push(joinedName);
                }
                State.playerControlMode = State.playerControlMode || {};
                if (!State.playerControlMode[joinedName]) State.playerControlMode[joinedName] = 'human';
                this._ensurePlayerProfile(joinedName, { isReady: false, controlMode: 'human' });
                this._updateUI();
                this.assignCharacters();
                this._sendTo(conn, this._getFullSyncPayload());
                this._updateTurnUI();
            });

            conn.on('data', (msg) => this._handleClientMessage(conn, msg));

            conn.on('close', () => {
                this.connections = this.connections.filter(c => c !== conn);
                const leftName = conn.metadata?.name || 'Unbekannt';
                const leftLabel = this.getDisplayPlayerName(leftName, 'Ein Spieler');
                this._recordSystemEntry({ id: Utils.generateId('sys'), sender: 'System', text: `**${leftLabel}** hat den Raum verlassen.`, tone: 'neutral', createdAt: Date.now() });
                if (State.playerControlMode) delete State.playerControlMode[leftName];
                if (State.playerProfiles) delete State.playerProfiles[leftName];
                const turnIdx = this.turnOrder.indexOf(leftName);
                if (turnIdx > -1) {
                    this.turnOrder.splice(turnIdx, 1);
                    if (this.currentTurnIndex >= this.turnOrder.length) {
                        this.currentTurnIndex = 0;
                    }
                }
                this._updateUI();
                this.broadcastTurnState();
            });

            conn.on('error', (err) => {
                console.error('Connection error:', err);
            });
        });

        this.peer.on('error', (err) => {
            this._clearConnectTimeout();
            if (err.type === 'unavailable-id') {
                this._setConnState('error', `Raum-Code ${this.roomCode} ist bereits vergeben.`);
                UI.addChatLog('System', `Raum-Code **${this.roomCode}** ist bereits vergeben. Versuche es erneut.`);
                this.disconnect();
            } else {
                console.error('Peer error:', err);
                this._setConnState('error', err.message);
                UI.addChatLog('System', `Verbindungsfehler: ${err.message}`);
            }
        });

        this.peer.on('disconnected', () => {
            if (this.connState === 'connected') {
                this._setConnState('error', 'Verbindung zum Signaling-Server verloren.');
            }
        });

        this._unsubscribe = subscribe(() => {
            this._markDirty();
        });
    },

    join(roomCode, playerName) {
        const error = this.validatePlayerName(playerName);
        if (error) {
            UI.addChatLog('System', error);
            return false;
        }
        if (this.peer) this.disconnect();
        this.playerName = String(playerName || '').trim();
        this.roomCode = String(roomCode || '').trim().toUpperCase();
        this.role = 'client';
        State._mpRole = 'client';
        this._setConnState('connecting');
        this._startConnectTimeout();

        const config = this._getPeerConfig();
        this.peer = new Peer(undefined, config);

        this.peer.on('open', () => {
            const peerId = ROOM_PREFIX + this.roomCode;
            const conn = this.peer.connect(peerId, {
                metadata: { name: this.playerName },
                reliable: true
            });

            conn.on('open', () => {
                this._clearConnectTimeout();
                this._setConnState('connected');
                this.connections = [conn];
                this.turnOrder = [];
                this.currentTurnIndex = 0;
                State.playerControlMode = { [this.playerName]: 'human' };
                this._ensurePlayerProfile(this.playerName, { isReady: false, controlMode: 'human' });
                this._startHeartbeat();
                this._recordSystemEntry({ id: Utils.generateId('sys'), sender: 'System', text: `Mit Raum **${this.roomCode}** verbunden als **${this.playerName}**.`, tone: 'neutral', createdAt: Date.now() }, false);
                UI.updateAll();
            });

            conn.on('data', (msg) => this._handleHostMessage(msg));

            conn.on('close', () => {
                this._recordSystemEntry({ id: Utils.generateId('sys'), sender: 'System', text: `Verbindung zum Host verloren.`, tone: 'neutral', createdAt: Date.now() }, false);
                this.disconnect();
            });

            conn.on('error', (err) => {
                console.error('Connection error:', err);
                this._setConnState('error', 'Verbindungsfehler zum Host.');
                this.disconnect();
            });
        });

        this.peer.on('error', (err) => {
            this._clearConnectTimeout();
            if (err.type === 'peer-unavailable') {
                this._setConnState('error', `Raum ${this.roomCode} nicht gefunden.`);
                UI.addChatLog('System', `Raum **${this.roomCode}** nicht gefunden. Ist der Host online?`);
            } else {
                console.error('Peer error:', err);
                this._setConnState('error', err.message);
                UI.addChatLog('System', `Verbindungsfehler: ${err.message}`);
            }
            this.disconnect();
        });

        this.peer.on('disconnected', () => {
            if (this.connState === 'connected') {
                this._setConnState('error', 'Verbindung zum Signaling-Server verloren.');
            }
        });

        this._unsubscribe = subscribe(() => {
            // Clients do not emit FULL_SYNC
        });
    },

    disconnect() {
        this._stopHeartbeat();
        if (this._syncDebounceTimer) {
            clearTimeout(this._syncDebounceTimer);
            this._syncDebounceTimer = null;
        }
        this._syncDirty = false;
        this._clearConnectTimeout();
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
        this.connections.forEach(c => { try { c.close(); } catch (_) { } });
        this.connections = [];
        if (this.peer) {
            try { this.peer.destroy(); } catch (_) { }
            this.peer = null;
        }
        this.role = null;
        this.roomCode = null;
        this.turnOrder = [];
        this.currentTurnIndex = 0;
        this.combatActions = {};
        this._combatStatus = {};
        this.playerCharMap = {};
        this.currentVote = null;
        this._mySubmittedAction = null;
        this.autoPlayers = {};
        this._seenMessageIds = new Set();
        this._seenEventIds = new Set();
        State.playerControlMode = {};
        State.playerProfiles = {};
        State.afkSince = {};
        State.transientEvents = [];
        State.sessionPhase = State.gameStarted ? 'in_game' : 'start';
        State.pendingApiMode = null;
        State._mpRole = null;
        State._mpMyCharId = null;
        this._setConnState('idle');
        const turnEl = document.getElementById('mp-turn-indicator');
        if (turnEl) turnEl.classList.add('hidden');
    },

    sendStatUpgrade(charId, stat) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], { type: 'STAT_UPGRADE', charId, stat });
    },

    sendPlayerAction(action, actingChar, messageId = null, createdAt = Date.now()) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], {
            type: 'PLAYER_ACTION',
            action,
            actingChar,
            playerName: this.playerName,
            messageId,
            createdAt,
        });
    },

    requestPortraitGeneration(requestId, prompts) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], {
            type: 'PORTRAIT_REQUEST',
            playerName: this.playerName,
            requestId,
            prompts: Array.isArray(prompts) ? prompts : [],
        });
    },

    sendDiceRollStarted(rollId) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], {
            type: 'DICE_ROLL_STARTED',
            rollId,
            playerName: this.playerName,
        });
    },

    sendDiceResult(rollId, result, rawRoll) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], {
            type: 'DICE_RESULT',
            rollId,
            result,
            rawRoll,
            playerName: this.playerName,
        });
    },

    sendCharacterCreate(charData) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], {
            type: 'CHARACTER_CREATE',
            charData,
            playerName: this.playerName,
        });
    },

    sendPregameReady(isReady) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], {
            type: 'PLAYER_READY_UPDATE',
            playerName: this.playerName,
            isReady: !!isReady,
        });
    },

    requestSelfControlMode(mode) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], {
            type: 'SELF_CONTROL_REQUEST',
            playerName: this.playerName,
            mode,
        });
    },

    sendInventoryAction(action, payload) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], {
            type: 'ITEM_ACTION',
            action,
            payload,
            playerName: this.playerName,
        });
    },

    sendCraftingSuggestionRequest(materials) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], {
            type: 'CRAFTING_SUGGESTION_REQUEST',
            materials,
            playerName: this.playerName,
        });
    },

    broadcastState() {
        if (!this.isHost()) return;
        this._markDirty();
    },

    broadcastChat(sender, text, meta = {}) {
        if (!this.isHost()) return;
        const msgs = State.chatMessages;
        const lastCreatedAt = msgs && msgs.length > 0 ? (msgs[msgs.length - 1].createdAt || 0) : 0;
        const createdAt = Math.max(Date.now(), lastCreatedAt + 1);
        const senderType = meta.senderType || (sender === 'DM' ? 'dm' : 'player');
        this._recordChatEntry({ id: Utils.generateId('msg'), sender, text, senderType, isAiControlled: false, createdAt, relatedPlayer: meta.relatedPlayer || '', relatedCharacter: meta.relatedCharacter || '' }, sender === 'DM' ? 'DM_MESSAGE' : 'PLAYER_CHAT');
    },

    broadcastSystemChat(sender, text) {
        if (!this.isHost()) return;
        this._recordSystemEntry({ id: Utils.generateId('sys'), sender, text, tone: 'neutral', createdAt: Date.now() });
    },

    advanceTurn() {
        if (!this.isHost() || this.turnOrder.length <= 1) return;
        this.currentTurnIndex = (this.currentTurnIndex + 1) % this.turnOrder.length;
        this.broadcastTurnState();
        this._updateTurnUI();
        const currentPlayer = this.turnOrder[this.currentTurnIndex];
        if (currentPlayer) {
            this._pushTransientEvent({ id: 'turn-' + currentPlayer + '-' + this.currentTurnIndex, type: 'turn_notice', sender: currentPlayer, payload: { text: this.getDisplayPlayerName(currentPlayer) + ' ist am Zug.' }, expiresAt: Date.now() + 4500 });
        }
        if (currentPlayer && this.getPlayerControlMode(currentPlayer) === 'ai') {
            const char = this._getCharForPlayer(currentPlayer);
            if (char && char.hp > 0) {
                setTimeout(() => {
                    this._currentActionPlayerName = currentPlayer;
                    const action = this._generateAutoAction(char);
                    this._recordChatEntry({ id: Utils.generateId('msg'), sender: char.name, text: action, senderType: 'player', isAiControlled: true, createdAt: Date.now(), relatedPlayer: currentPlayer, relatedCharacter: char.name }, 'PLAYER_CHAT');
                    Engine.interactWithAI(action);
                }, 600);
            }
        }
    },

    broadcastTurnState() {
        if (!this.isHost()) return;
        this._updateTurnUI();
        this._markDirty();
    },

    submitCombatAction(action, charName) {
        if (this._mySubmittedAction) return;
        this._mySubmittedAction = { action, charName };
        Sound.play('turn');
        if (this.isClient()) {
            this._sendTo(this.connections[0], {
                type: 'COMBAT_ACTION', action, charName, playerName: this.playerName,
            });
        } else {
            this.combatActions[this.playerName] = { action, charName };
            this._broadcastCombatStatus();
            this._queueCombatExecution();
        }
        this._updateTurnUI();
    },

    executeCombatRound() {
        if (!this.isHost()) return;
        const entries = Object.entries(this.combatActions);
        if (entries.length === 0) return;
        const actions = entries.map(([, d]) => `${d.charName}: ${d.action}`).join('\n');
        this.broadcastSystemChat('System', `**Kampfrunde gestartet!** ${entries.length} Aktionen werden ausgefuehrt...`);
        this.combatActions = {};
        this._mySubmittedAction = null;
        this._broadcastCombatStatus();
        this._currentActionPlayerName = 'Gruppe';
        State.actingChar = 'party';
        Engine.interactWithAI(`Kampfrunde – Alle Aktionen der Gruppe:\n${actions}\n\nFuehre alle Aktionen gleichzeitig aus. Beschreibe Proben, Ergebnisse, Schaden.`);
    },

    skipPlayer(playerName) {
        if (!this.isHost() || this.combatActions[playerName]) return;
        this.combatActions[playerName] = { action: 'wartet ab (uebersprungen)', charName: playerName };
        const skippedLabel = this.getDisplayPlayerName(playerName);
        this.broadcastSystemChat('System', `**${skippedLabel}** wurde uebersprungen.`);
        this._broadcastCombatStatus();
    },

    startNewCombatRound() {
        if (!this.isHost()) return;
        this.combatActions = {};
        this._mySubmittedAction = null;
        this._broadcastCombatStatus();
        this._scheduleAutoActions();
    },

    toggleAutoPlayer(playerName) {
        this.togglePlayerControlMode(playerName);
    },

    _getCharForPlayer(playerName) {
        const charId = this.playerCharMap[playerName];
        return charId ? State.party.find(p => p.id === charId) : null;
    },


    _isAuthorizedCharacter(playerName, charIdOrName) {
        if (this.isHost() && playerName === this.playerName) return true;
        const assignedId = this.playerCharMap[playerName];
        if (!assignedId) return false;
        const assignedChar = State.party.find(p => p.id === assignedId);
        if (!assignedChar) return false;
        return assignedChar.id === charIdOrName || assignedChar.name === charIdOrName;
    },

    _allCombatActionsSubmitted() {
        return this.turnOrder.every(playerName => {
            if (this.getPlayerControlMode(playerName) === 'ai') return true;
            const char = this._getCharForPlayer(playerName);
            if (!char || char.hp <= 0) return true;
            return !!this.combatActions[playerName];
        });
    },

    _allPendingRollsResolved() {
        return State.pendingRolls.length > 0 && State.pendingRolls.every(r => r.rolled);
    },

    _queueCombatExecution() {
        if (!this.isHost() || !this._allCombatActionsSubmitted() || State.isProcessing) return;
        setTimeout(() => {
            if (this.isHost() && this._allCombatActionsSubmitted() && !State.isProcessing) {
                this.executeCombatRound();
            }
        }, 150);
    },

    _queuePendingRollResolution() {
        if (!this.isHost() || !this._allPendingRollsResolved() || State.isProcessing) return;
        setTimeout(() => {
            if (this.isHost() && this._allPendingRollsResolved() && !State.isProcessing) {
                Engine.submitPendingRolls();
            }
        }, 150);
    },
    _generateAutoAction(char) {
        const enemy = State.activeEnemies.find(e => e.hp > 0);
        const hurt = State.party
            .filter(p => p.hp > 0 && !p.isSummon && p.hp < PartyManager.getEffectiveMaxHp(p) * 0.5)
            .sort((a, b) => a.hp / PartyManager.getEffectiveMaxHp(a) - b.hp / PartyManager.getEffectiveMaxHp(b))[0];

        if (State.activeEnemies.some(e => e.hp > 0)) {
            const cls = (char.class || '').toLowerCase();
            if ((cls === 'kleriker' || cls === 'heiler') && hurt) return `${char.name} heilt ${hurt.name}`;
            if (cls === 'magier' && enemy) return `${char.name} wirkt einen Zauber gegen ${enemy.name}`;
            if ((cls.includes('wald')) && enemy) return `${char.name} schiesst einen Pfeil auf ${enemy.name}`;
            if (cls === 'schurke' && enemy) return `${char.name} schleicht sich an ${enemy.name} heran und attackiert`;
            if (enemy) return `${char.name} greift ${enemy.name} an`;
            return `${char.name} verteidigt sich`;
        }
        return `${char.name} folgt der Gruppe`;
    },

    _scheduleAutoActions() {
        if (!this.isHost() || !this.isInCombat()) return;
        setTimeout(() => {
            let submitted = false;
            for (const playerName of Object.keys(this.autoPlayers)) {
                if (this.combatActions[playerName]) continue;
                const char = this._getCharForPlayer(playerName);
                if (!char || char.hp <= 0) continue;
                const action = this._generateAutoAction(char);
                this.combatActions[playerName] = { action, charName: char.name };
                this.broadcastChat(char.name, action, { relatedPlayer: playerName, relatedCharacter: char.name });
                submitted = true;
            }
            if (submitted) { this._broadcastCombatStatus(); this._queueCombatExecution(); }
        }, 800);
    },

    autoRollPending() {
        if (!this.isHost()) return;
        const autoCharNames = new Set();
        for (const playerName of Object.keys(this.autoPlayers)) {
            const char = this._getCharForPlayer(playerName);
            if (char) autoCharNames.add(char.name);
        }
        let rolled = false;
        for (const r of State.pendingRolls) {
            if (r.rolled || !autoCharNames.has(r.name)) continue;
            rolled = this.hostRollPending(r.id, { silent: true }) || rolled;
        }
        if (rolled) {
            UI.updateActionBox();
            if (this.isConnected()) this.broadcastState();
            this._queuePendingRollResolution();
        }
    },

    hostRollPending(rollId, options = {}) {
        if (!this.isHost()) return false;
        const roll = State.pendingRolls.find(r => r.id === rollId);
        if (!roll || roll.rolled) return false;
        const diceMax = roll.diceType === 'W6' ? 6 : (roll.diceType === 'W100' ? 100 : 20);
        const rawRoll = Math.floor(Math.random() * diceMax) + 1;
        roll.rawRoll = rawRoll;
        roll.result = rawRoll + (roll.mod || 0);
        roll.rolled = true;
        const animationPayload = {
            id: roll.id,
            name: roll.name,
            reason: roll.desc || 'Probe',
            targetDC: roll.dc,
            modifier: roll.mod || 0,
            diceType: roll.diceType || 'W20',
            result: roll.result,
            rawRoll,
        };
        UI.showNetworkDiceAnimation(animationPayload);
        this.broadcastDiceAnimation(animationPayload);
        if (!options.silent) {
            UI.addChatLog('System', `🎲 Host würfelt für **${roll.name}**.`);
            this.broadcastSystemChat('System', `🎲 Host würfelt für **${roll.name}**.`);
        }
        UI.updateActionBox();
        this._queuePendingRollResolution();
        this.broadcastState();
        return true;
    },
    _removeItems(list, itemName, amount) {
        let removed = 0;
        while (removed < amount) {
            const idx = list.indexOf(itemName);
            if (idx === -1) break;
            list.splice(idx, 1);
            removed++;
        }
        return removed;
    },

    _applyInventoryAction(action, payload, playerName) {
        const amount = Math.max(1, parseInt(payload.amount, 10) || 1);
        if (playerName && !this._isAuthorizedCharacter(playerName, payload.charId || payload.fromCharId)) {
            return { ok: false, error: 'Aktion nicht erlaubt.' };
        }

        if (action === 'ASSIGN_LOOT') {
            const char = State.party.find(p => p.id === payload.charId);
            const item = State.lootDrops[payload.index];
            if (!char || !item) return { ok: false, error: 'Beute nicht gefunden.' };
            char.inventory.push(item);
            State.lootDrops.splice(payload.index, 1);
            return { ok: true, message: `🎁 **${char.name}** erhält **${item}**.` };
        }

        if (action === 'COLLECT_ALL_LOOT') {
            const char = State.party.find(p => p.id === payload.charId);
            if (!char || State.lootDrops.length === 0) return { ok: false, error: 'Keine Beute verfügbar.' };
            char.inventory.push(...State.lootDrops);
            State.lootDrops = [];
            return { ok: true, message: `?? **${char.name}** hat die gesamte Beute eingesammelt.` };
        }

        if (action === 'DROP_ITEM') {
            const char = State.party.find(p => p.id === payload.charId);
            if (!char) return { ok: false, error: 'Held nicht gefunden.' };
            const removed = this._removeItems(char.inventory, payload.itemName, amount);
            if (!removed) return { ok: false, error: 'Item nicht gefunden.' };
            const effMax = PartyManager.getEffectiveMaxHp(char);
            if (char.hp > effMax) char.hp = effMax;
            return { ok: true, message: `🗑️ **${char.name}** hat **${removed}x ${payload.itemName}** weggeworfen.` };
        }

        if (action === 'GIVE_ITEM') {
            const fromChar = State.party.find(p => p.id === payload.fromCharId);
            const toChar = State.party.find(p => p.id === payload.toCharId);
            if (!fromChar || !toChar) return { ok: false, error: 'Tauschpartner nicht gefunden.' };
            const removed = this._removeItems(fromChar.inventory, payload.itemName, amount);
            if (!removed) return { ok: false, error: 'Item nicht gefunden.' };
            for (let i = 0; i < removed; i++) toChar.inventory.push(payload.itemName);
            const effMax = PartyManager.getEffectiveMaxHp(fromChar);
            if (fromChar.hp > effMax) fromChar.hp = effMax;
            return { ok: true, message: `🤝 **${fromChar.name}** übergibt **${removed}x ${payload.itemName}** an **${toChar.name}**.` };
        }

        if (action === 'EQUIP_ITEM') {
            const char = State.party.find(p => p.id === payload.charId);
            if (!char) return { ok: false, error: 'Held nicht gefunden.' };
            const idx = char.inventory.indexOf(payload.itemName);
            if (idx === -1) return { ok: false, error: 'Item nicht im Inventar.' };
            const oldMax = PartyManager.getEffectiveMaxHp(char);
            char.inventory.splice(idx, 1);
            char.equipment = char.equipment || [];
            let extraMessage = '';
            if (char.equipment.length >= 10) {
                const unequippedItem = char.equipment.shift();
                char.inventory.push(unequippedItem);
                extraMessage = `?? **${char.name}** legt automatisch **${unequippedItem}** ab.\n`;
            }
            char.equipment.push(payload.itemName);
            const newMax = PartyManager.getEffectiveMaxHp(char);
            if (newMax > oldMax) char.hp += (newMax - oldMax);
            else if (newMax < oldMax) char.hp = Math.max(1, char.hp - (oldMax - newMax));
            return { ok: true, message: `${extraMessage}🛡️ **${char.name}** rüstet **${payload.itemName}** aus.`.trim() };
        }

        if (action === 'UNEQUIP_ITEM') {
            const char = State.party.find(p => p.id === payload.charId);
            if (!char) return { ok: false, error: 'Held nicht gefunden.' };
            const idx = (char.equipment || []).indexOf(payload.itemName);
            if (idx === -1) return { ok: false, error: 'Item nicht ausgerüstet.' };
            const oldMax = PartyManager.getEffectiveMaxHp(char);
            char.equipment.splice(idx, 1);
            char.inventory.push(payload.itemName);
            const newMax = PartyManager.getEffectiveMaxHp(char);
            if (newMax < oldMax) char.hp = Math.max(1, char.hp - (oldMax - newMax));
            return { ok: true, message: `?? **${char.name}** legt **${payload.itemName}** ab.` };
        }

        return { ok: false, error: 'Unbekannte Inventar-Aktion.' };
    },
    _broadcastCombatStatus() {
        if (!this.isHost()) return;
        this._updateTurnUI();
        this._markDirty();
    },

    registerCharacter(playerName, charId) {
        if (!this.isHost()) return;
        this.playerCharMap[playerName] = charId;
        const char = State.party.find(p => p.id === charId);
        this._ensurePlayerProfile(playerName, { heroId: charId, heroName: char?.name || '', isReady: false, controlMode: this.getPlayerControlMode(playerName) });
        if (playerName === this.playerName) {
            State._mpMyCharId = charId;
        }
        this._broadcastCharMap();
    },

    assignCharacters() {
        if (!this.isHost()) return;
        for (const [player, charId] of Object.entries(this.playerCharMap)) {
            if (!this.turnOrder.includes(player) || !State.party.find(c => c.id === charId)) {
                delete this.playerCharMap[player];
            }
        }
        State._mpMyCharId = this.playerCharMap[this.playerName] || null;
        this._broadcastCharMap();
    },

    _broadcastCharMap() {
        if (!this.isHost()) return;
        this._markDirty();
    },

    canRollFor(rollName) {
        if (!this.isConnected() || this.turnOrder.length <= 1) return true;
        const myChar = State.party.find(p => p.id === State._mpMyCharId);
        if (myChar && myChar.name === rollName) return true;
        if (this.isHost()) {
            for (const pn of Object.keys(this.autoPlayers)) {
                const ch = this._getCharForPlayer(pn);
                if (ch && ch.name === rollName) return true;
            }
            const assignedNames = new Set();
            for (const cid of Object.values(this.playerCharMap)) {
                const ch = State.party.find(p => p.id === cid);
                if (ch) assignedNames.add(ch.name);
            }
            if (!assignedNames.has(rollName)) return true;
        }
        return false;
    },

    autoDistributeLoot() {
        if (!this.isHost() || !this.isConnected() || State.lootDrops.length === 0) return;
        const chars = State.party.filter(c => !c.isSummon && c.hp > 0);
        if (chars.length === 0) return;
        const distributed = [];
        for (const item of State.lootDrops) {
            const recipient = chars[Math.floor(Math.random() * chars.length)];
            recipient.inventory.push(item);
            distributed.push(`**${recipient.name}** erhaelt: ${item}`);
        }
        State.lootDrops = [];
        UI.addChatLog('System', `**Beute verteilt:**\n${distributed.join('\n')}`);
        this.broadcastSystemChat('System', `**Beute verteilt:**\n${distributed.join('\n')}`);
    },

    startVote(question, options) {
        if (!this.isHost()) return;
        this.currentVote = { question, options, votes: {}, resolved: false };
        const msg = { type: 'VOTE_START', question, options };
        this.connections.forEach(c => this._sendTo(c, msg));
        this._updateTurnUI();
    },

    castVote(optionIndex) {
        if (!this.currentVote || this.currentVote.resolved) return;
        if (this.isClient()) {
            this._sendTo(this.connections[0], {
                type: 'VOTE_CAST', option: optionIndex, playerName: this.playerName,
            });
        } else {
            this.currentVote.votes[this.playerName] = optionIndex;
            this._broadcastVoteStatus();
        }
        this._updateTurnUI();
    },

    _broadcastVoteStatus() {
        if (!this.isHost() || !this.currentVote) return;
        const msg = {
            type: 'VOTE_STATUS',
            question: this.currentVote.question,
            options: this.currentVote.options,
            votes: this.currentVote.votes,
            totalPlayers: this.turnOrder.length,
        };
        this.connections.forEach(c => this._sendTo(c, msg));
    },

    resolveVote(chosenIndex) {
        if (!this.isHost() || !this.currentVote) return;
        const chosen = this.currentVote.options[chosenIndex] || 'Unbekannt';
        UI.addChatLog('System', `**Abstimmung beendet:** "${chosen}" wurde gewaehlt.`);
        this.broadcastSystemChat('System', `**Abstimmung beendet:** "${chosen}" wurde gewaehlt.`);
        const msg = { type: 'VOTE_RESULT', chosen, chosenIndex };
        this.connections.forEach(c => this._sendTo(c, msg));
        this.currentVote = null;
        this._updateTurnUI();
    },

    broadcastDiceRollStarted(payload) {
        if (!this.isHost()) return;
        this.connections.forEach(c => this._sendTo(c, { type: 'DICE_ROLL_STARTED', payload }));
    },

    broadcastDiceAnimation(payload) {
        if (!this.isHost()) return;
        this.connections.forEach(c => this._sendTo(c, { type: 'DICE_ANIMATION', payload }));
    },

    saveAdvancedConfig() {
        const hostEl = document.getElementById('mp-cfg-host');
        const portEl = document.getElementById('mp-cfg-port');
        const pathEl = document.getElementById('mp-cfg-path');
        const secureEl = document.getElementById('mp-cfg-secure');
        const turnUrlEl = document.getElementById('mp-cfg-turn-url');
        const turnUserEl = document.getElementById('mp-cfg-turn-user');
        const turnPassEl = document.getElementById('mp-cfg-turn-pass');

        const host = hostEl?.value.trim();
        if (host) {
            Utils.safeStorageSet(LS_KEY_SERVER, JSON.stringify({
                host,
                port: portEl?.value.trim() || '9000',
                path: pathEl?.value.trim() || '/',
                secure: secureEl?.checked !== false,
            }));
        } else {
            Utils.safeStorageRemove(LS_KEY_SERVER);
        }

        const turnUrl = turnUrlEl?.value.trim();
        if (turnUrl) {
            Utils.safeStorageSet(LS_KEY_TURN, JSON.stringify([{
                urls: turnUrl,
                username: turnUserEl?.value.trim() || '',
                credential: turnPassEl?.value.trim() || '',
            }]));
        } else {
            Utils.safeStorageRemove(LS_KEY_TURN);
        }

        UI.addChatLog('System', 'Multiplayer-Konfiguration gespeichert.');
        this._renderModalContent();
    },

    _getSyncState() {
        const sync = {};
        SYNC_KEYS.forEach(k => {
            sync[k] = State[k];
        });
        return JSON.parse(JSON.stringify(sync));
    },

    _getFullSyncPayload() {
        const combatSubmitted = {};
        this.turnOrder.forEach(p => {
            combatSubmitted[p] = this.combatActions[p] ? this.combatActions[p].charName : null;
        });
        return {
            type: 'FULL_SYNC',
            state: this._getSyncState(),
            turnOrder: this.turnOrder,
            currentTurnIndex: this.currentTurnIndex,
            playerCharMap: this.playerCharMap,
            autoPlayers: this.autoPlayers,
            combatSubmitted,
            vote: this.currentVote,
            isProcessing: State.isProcessing,
        };
    },

    fullSync() {
        if (!this.isHost()) return;
        this._syncDirty = false;
        const payload = this._getFullSyncPayload();
        this.connections.forEach(c => this._sendTo(c, payload));
    },

    _markDirty() {
        if (!this.isHost()) return;
        this._syncDirty = true;
        if (this._syncDebounceTimer) return;
        this._syncDebounceTimer = setTimeout(() => {
            this._syncDebounceTimer = null;
            if (this._syncDirty) this.fullSync();
        }, 80);
    },

    _startHeartbeat() {
        this._stopHeartbeat();
        this._heartbeatTimer = setInterval(() => {
            if (this.isHost() && this.isConnected() && this._syncDirty) {
                this.fullSync();
            }
        }, 3000);
    },

    _stopHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    },

    requestSync() {
        if (this.isClient() && this.connections.length > 0) {
            this._sendTo(this.connections[0], { type: 'REQUEST_SYNC' });
        } else if (this.isHost()) {
            this.fullSync();
            this._updateTurnUI();
            UI.updateAll();
        }
    },

    _sendTo(conn, data) {
        try {
            conn.send(data);
        } catch (e) {
            console.error('Send failed:', e);
        }
    },

    _handleClientMessage(conn, msg) {
        if (!msg || !msg.type) return;
        const name = conn.metadata?.name || 'Spieler';

        switch (msg.type) {
            case 'PLAYER_ACTION': {
                Sound.play('turn');
                this._recordChatEntry({ id: msg.messageId || Utils.generateId('msg'), sender: msg.actingChar || name, text: msg.action, senderType: 'player', isAiControlled: this.getPlayerControlMode(name) === 'ai', createdAt: msg.createdAt || Date.now(), relatedPlayer: msg.playerName || name, relatedCharacter: msg.actingChar || '' }, 'PLAYER_CHAT');
                State.actingChar = msg.actingChar || 'party';
                this._currentActionPlayerName = msg.playerName || name;
                Engine.interactWithAI(msg.action);
                break;
            }
            case 'STAT_UPGRADE': {
                dispatch({ type: 'UPGRADE_STAT', charId: msg.charId, stat: msg.stat });
                this._markDirty();
                break;
            }
            case 'COMBAT_ACTION': {
                if (!this._isAuthorizedCharacter(msg.playerName, msg.charName)) {
                    this._sendTo(conn, { type: 'SYSTEM_CHAT', sender: 'System', text: 'Du darfst nur deinen eigenen Helden steuern.' });
                    break;
                }
                Sound.play('turn');
                this.combatActions[msg.playerName] = { action: msg.action, charName: msg.charName };
                const combatSender = msg.charName || msg.playerName;
                this._recordChatEntry({ id: Utils.generateId('msg'), sender: combatSender, text: msg.action, senderType: 'player', isAiControlled: this.getPlayerControlMode(msg.playerName) === 'ai', createdAt: Date.now(), relatedPlayer: msg.playerName || combatSender, relatedCharacter: msg.charName || combatSender }, 'PLAYER_CHAT');
                this._broadcastCombatStatus();
                this._queueCombatExecution();
                break;
            }
            case 'PORTRAIT_REQUEST': {
                if (!Array.isArray(msg.prompts) || msg.prompts.length === 0) break;
                (async () => {
                    let portrait = '';
                    try {
                        portrait = await Engine.generatePortraitForPrompts(msg.prompts);
                    } catch (e) {
                        console.warn('Portrait generation failed for client:', e);
                    }
                    this._sendTo(conn, {
                        type: 'PORTRAIT_RESULT',
                        requestId: msg.requestId || '',
                        portrait,
                        imagePrompt: Array.isArray(msg.prompts) ? String(msg.prompts[0] || '') : '',
                    });
                })();
                break;
            }
            case 'CHARACTER_CREATE': {
                try {
                    const char = validateHeroData(msg.charData);
                    if (!State.party.find(p => p.id === char.id)) {
                        State.party.push(char);
                        this._recordSystemEntry({ id: Utils.generateId('sys'), sender: 'System', text: `**${msg.playerName}** hat **${char.name}** zur Gruppe hinzugefuegt.`, tone: 'neutral', createdAt: Date.now() });
                        this.registerCharacter(msg.playerName, char.id);
                        this._ensurePlayerProfile(msg.playerName, { heroId: char.id, heroName: char.name, isReady: false, controlMode: this.getPlayerControlMode(msg.playerName) });
                        this.broadcastState();
                        UI.updateAll();
                    }
                } catch (e) {
                    console.warn('Invalid character data from client:', e);
                }
                break;
            }
            case 'PLAYER_READY_UPDATE': {
                this.setPregameReady(msg.playerName || name, !!msg.isReady);
                UI.updateAll();
                break;
            }
            case 'SELF_CONTROL_REQUEST': {
                this.setPlayerControlMode(msg.playerName || name, msg.mode === 'ai' ? 'ai' : 'human');
                UI.updateAll();
                break;
            }
            case 'ITEM_ACTION': {
                const result = this._applyInventoryAction(msg.action, msg.payload || {}, msg.playerName);
                if (result.ok) {
                    if (msg.action === 'ASSIGN_LOOT' || msg.action === 'COLLECT_ALL_LOOT') {
                        const msgs = State.chatMessages;
                        const lastCreatedAt = msgs && msgs.length > 0 ? (msgs[msgs.length - 1].createdAt || 0) : 0;
                        this._recordChatEntry({ id: Utils.generateId('msg'), sender: 'Beute', text: result.message, senderType: 'loot', isAiControlled: false, createdAt: Math.max(Date.now(), lastCreatedAt + 1), relatedPlayer: '', relatedCharacter: '' }, 'PLAYER_CHAT');
                        const char = State.party.find(p => p.id === (msg.payload || {}).charId);
                        if (char) {
                            this._pushTransientEvent({ type: 'loot_gain', sender: char.name, targetPlayer: char.name, payload: { icon: 'fa-gem', text: msg.action === 'COLLECT_ALL_LOOT' ? char.name + ' sammelt die gesamte Beute ein.' : char.name + ' erhaelt Beute.' }, expiresAt: Date.now() + 7000 });
                        }
                    } else {
                        this._recordSystemEntry({ id: Utils.generateId('sys'), sender: 'System', text: result.message, tone: 'neutral', createdAt: Date.now() });
                    }
                    UI.updateAll();
                    this.broadcastState();
                } else if (result.error) {
                    this._sendTo(conn, { type: 'SYSTEM_CHAT', sender: 'System', text: result.error });
                }
                break;
            }
            case 'VOTE_CAST': {
                if (this.currentVote && !this.currentVote.resolved) {
                    this.currentVote.votes[msg.playerName] = msg.option;
                    this._broadcastVoteStatus();
                    this._updateTurnUI();
                }
                break;
            }
            case 'DICE_ROLL_STARTED': {
                const roll = State.pendingRolls.find(r => r.id === msg.rollId);
                if (roll && this._isAuthorizedCharacter(msg.playerName, roll.name)) {
                    const startPayload = {
                        id: roll.id,
                        name: roll.name,
                        reason: roll.desc || 'Probe',
                        targetDC: roll.dc,
                        modifier: roll.mod || 0,
                        diceType: roll.diceType || 'W20',
                        result: null,
                        rawRoll: null,
                    };
                    UI.pushDiceFeedEntry(startPayload);
                    this._pushTransientEvent({ id: 'roll-start-' + roll.id, type: 'dice_start', sender: roll.name, payload: startPayload, expiresAt: Date.now() + 3000 }, { render: true });
                    this.broadcastDiceRollStarted(startPayload);
                    this._markDirty();
                }
                break;
            }
            case 'DICE_RESULT': {
                const roll = State.pendingRolls.find(r => r.id === msg.rollId);
                if (roll && this._isAuthorizedCharacter(msg.playerName, roll.name)) {
                    roll.rolled = true;
                    roll.result = msg.result;
                    roll.rawRoll = msg.rawRoll;
                    const animationPayload = {
                        id: roll.id,
                        name: roll.name,
                        reason: roll.desc || 'Probe',
                        targetDC: roll.dc,
                        modifier: roll.mod || 0,
                        diceType: roll.diceType || 'W20',
                        result: msg.result,
                        rawRoll: msg.rawRoll,
                    };
                    UI.showNetworkDiceAnimation(animationPayload);
                    this._pushTransientEvent({ id: 'roll-' + roll.id, type: 'dice_result', sender: roll.name, payload: animationPayload, expiresAt: Date.now() + 8000 }, { render: false });
                    this.broadcastDiceAnimation(animationPayload);
                    UI.updateActionBox();
                    this._markDirty();
                    this._queuePendingRollResolution();
                }
                break;
            }
            case 'REQUEST_SYNC': {
                this._sendTo(conn, this._getFullSyncPayload());
                break;
            }
            case 'CRAFTING_SUGGESTION_REQUEST': {
                const materials = msg.materials;
                (async () => {
                    try {
                        let aiText = await API.generateText(`Erfinde einen passenden, gut ausbalancierten Gegenstand, der logisch aus diesen Zutaten hergestellt werden kann: [${materials}]. WICHTIG: Wenn die Zutaten bereits starke Werte oder Fähigkeiten haben, soll dein vorgeschlagener Gegenstand diese Werte logischerweise übernehmen oder ganz leicht verbessern. \n\nDu bist ein Generator. Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt ohne Markdown oder Codeblock-Tags. Nutze ZWINGEND diese exakten Keys: {"name": "Gegenstandsname", "str": Zahl, "dex": Zahl, "int": Zahl, "con": Zahl}. Wähle 1-2 passende weise Attribute aus (Wert 1-3 oder höher falls die Zutaten es rechtfertigen), die anderen 0.`);
                        const match = aiText.match(/\{[\s\S]*\}/);
                        if (!match) throw new Error("Konnte kein JSON extrahieren.");
                        const data = JSON.parse(match[0]);
                        this._sendTo(conn, {
                            type: 'CRAFTING_SUGGESTION_RESPONSE',
                            data
                        });
                    } catch (e) {
                        this._sendTo(conn, {
                            type: 'SYSTEM_CHAT',
                            sender: 'System',
                            text: 'KI-Vorschlag fehlgeschlagen: ' + e.message
                        });
                        // Also tell client to reset button
                        this._sendTo(conn, {
                            type: 'CRAFTING_SUGGESTION_RESPONSE',
                            data: null
                        });
                    }
                })();
                break;
            }
            default:
                console.warn('Unknown client message:', msg.type);
        }
    },
    _applyStateSync(incoming) {
        const wasStarted = State.gameStarted;
        if (incoming.party !== undefined) State.party = incoming.party;
        if (incoming.activeEnemies !== undefined) State.activeEnemies = incoming.activeEnemies;
        if (incoming.defeatedEnemies !== undefined) State.defeatedEnemies = incoming.defeatedEnemies;
        if (incoming.lootDrops !== undefined) State.lootDrops = incoming.lootDrops;
        if (incoming.gold !== undefined) State.gold = incoming.gold;
        if (incoming.dungeonLevel !== undefined) State.dungeonLevel = incoming.dungeonLevel;
        if (incoming.lastStoryPart !== undefined) State.lastStoryPart = incoming.lastStoryPart;
        if (incoming.gameStarted !== undefined) State.gameStarted = incoming.gameStarted;
        if (incoming.combatEnded !== undefined) State.combatEnded = incoming.combatEnded;
        if (incoming.activeMerchant !== undefined) State.activeMerchant = incoming.activeMerchant;
        if (incoming.journal !== undefined) State.journal = incoming.journal;
        if (incoming.sessionStats !== undefined) State.sessionStats = incoming.sessionStats;
        if (incoming.fate !== undefined) State.fate = incoming.fate;
        if (incoming.fatigue !== undefined) State.fatigue = incoming.fatigue;
        if (incoming.abilityCooldowns !== undefined) State.abilityCooldowns = incoming.abilityCooldowns;
        if (incoming.isBossFight !== undefined) State.isBossFight = incoming.isBossFight;
        if (incoming.weather !== undefined) {
            State.weather = incoming.weather;
            Weather.apply(incoming.weather.current, { skipChat: true });
        }
        if (incoming.momentum !== undefined) State.momentum = incoming.momentum;
        if (incoming.pendingRolls !== undefined) {
            const incomingRolls = Array.isArray(incoming.pendingRolls) ? incoming.pendingRolls : [];
            State.pendingRolls = incomingRolls.map(r => {
                const local = (State.pendingRolls || []).find(lr => lr.id === r.id);
                return (local && local.rolled && !r.rolled) ? local : r;
            });
        }
        if (incoming.recentRolls !== undefined) State.recentRolls = incoming.recentRolls;
        if (incoming.pendingAbilityLearning !== undefined) State.pendingAbilityLearning = incoming.pendingAbilityLearning;
        if (incoming.quickplayEnabled !== undefined) State.quickplayEnabled = incoming.quickplayEnabled;
        if (incoming.sessionPhase !== undefined) State.sessionPhase = incoming.sessionPhase;
        if (incoming.isProcessing !== undefined) {
            State.isProcessing = incoming.isProcessing;
            UI.showLoader(State.isProcessing);
        }
        if (incoming.chatHistory !== undefined) State.chatHistory = incoming.chatHistory;
        if (incoming.afkSince !== undefined) State.afkSince = incoming.afkSince || {};
        if (incoming.playerProfiles !== undefined) State.playerProfiles = { ...(State.playerProfiles || {}), ...(incoming.playerProfiles || {}) };
        if (incoming.playerControlMode !== undefined) State.playerControlMode = { ...(State.playerControlMode || {}), ...(incoming.playerControlMode || {}) };
        if (incoming.chatMessages !== undefined) State.chatMessages = this._mergeCollectionById(State.chatMessages, incoming.chatMessages);
        if (incoming.systemMessages !== undefined) State.systemMessages = this._mergeCollectionById(State.systemMessages, incoming.systemMessages);

        if (incoming.turnOrder !== undefined) this.turnOrder = incoming.turnOrder;
        if (incoming.currentTurnIndex !== undefined) this.currentTurnIndex = incoming.currentTurnIndex;

        if (incoming.transientEvents !== undefined) {
            State.transientEvents = this._mergeCollectionById(State.transientEvents, incoming.transientEvents)
                .filter(event => (event.expiresAt || 0) > Date.now())
                .slice(-12);
        } else {
            State.transientEvents = (State.transientEvents || []).filter(event => (event.expiresAt || 0) > Date.now());
        }
        this._syncAutoPlayersFromControlModes();
        this._rememberStateIds();
        if (State.gameStarted && !wasStarted) UI.toggleViews(true);
        if (!State.gameStarted) UI.toggleViews(false);
    },

    _handleHostMessage(msg) {
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'FULL_SYNC': {
                this._applyStateSync(msg.state);
                this.turnOrder = msg.turnOrder || [];
                this.currentTurnIndex = msg.currentTurnIndex || 0;
                this.playerCharMap = msg.playerCharMap || {};
                this.autoPlayers = msg.autoPlayers || {};
                this._syncAutoPlayersFromControlModes();
                State._mpMyCharId = this.playerCharMap[this.playerName] || null;
                this._combatStatus = msg.combatSubmitted || {};
                this._mySubmittedAction = this._combatStatus[this.playerName] ? { submitted: true } : null;
                this.currentVote = msg.vote || null;
                State.isProcessing = !!msg.isProcessing;
                UI.showLoader(!!msg.isProcessing);
                UI.syncChatLogFromState();
                UI.renderTransientEvents();
                UI.updateAll();
                this._updateTurnUI();
                break;
            }
            case 'STATE_SYNC': {
                this._applyStateSync(msg.state);
                UI.syncChatLogFromState();
                UI.renderTransientEvents();
                UI.updateAll();
                this._updateTurnUI();
                break;
            }
            case 'DM_MESSAGE':
                if (msg.entry?.id && this._seenMessageIds.has(msg.entry.id)) break;
                UI.addChatLog(msg.entry || { id: Utils.generateId('msg'), sender: msg.sender || 'DM', text: msg.text, senderType: 'dm', createdAt: Date.now() }, null, { persist: true });
                break;
            case 'DICE_ROLL_STARTED':
                if (msg.payload?.id) UI.pushDiceFeedEntry(msg.payload);
                break;
            case 'DICE_ANIMATION':
                UI.showNetworkDiceAnimation(msg.payload || {});
                break;
            case 'TRANSIENT_EVENT':
                if (msg.event?.id && this._seenEventIds.has(msg.event.id)) break;
                this._pushTransientEvent(msg.event || {}, { broadcast: false });
                break;
            case 'PLAYER_CHAT':
                Sound.play('turn');
                if (msg.entry?.id && this._seenMessageIds.has(msg.entry.id)) break;
                UI.addChatLog(msg.entry || { id: Utils.generateId('msg'), sender: msg.sender || 'Spieler', text: msg.text, senderType: 'player', createdAt: Date.now() }, null, { persist: true });
                break;
            case 'SYSTEM_CHAT':
                if (msg.entry?.id && this._seenMessageIds.has(msg.entry.id)) break;
                UI.addChatLog(msg.entry || { id: Utils.generateId('sys'), sender: msg.sender || 'System', text: msg.text, tone: 'neutral', createdAt: Date.now() }, null, { persist: true });
                break;
            case 'TURN_UPDATE': {
                this.turnOrder = msg.turnOrder || [];
                this.currentTurnIndex = msg.currentTurnIndex || 0;
                const activePlayer = this.turnOrder[this.currentTurnIndex] || '';
                if (activePlayer) this._pushTransientEvent({ id: 'turn-' + activePlayer + '-' + this.currentTurnIndex, type: 'turn_notice', sender: activePlayer, payload: { text: this.getDisplayPlayerName(activePlayer) + ' ist am Zug.' }, expiresAt: Date.now() + 4500 }, { broadcast: false });
                this._updateTurnUI();
                break;
            }
            case 'COMBAT_STATUS': {
                this._combatStatus = msg.submitted || {};
                this._mySubmittedAction = this._combatStatus[this.playerName] ? { submitted: true } : null;
                this._updateTurnUI();
                break;
            }
            case 'PORTRAIT_RESULT': {
                if (msg.requestId && msg.requestId !== State.pendingPortraitRequestId) break;
                State.pendingPortraitRequestId = '';
                State.tempPortraitData = msg.portrait || '';
                State.tempImagePrompt = msg.imagePrompt || State.tempImagePrompt || '';
                if (State.tempPortraitData) {
                    if (DOM.generatedPortrait) DOM.generatedPortrait.src = State.tempPortraitData;
                    DOM.portraitPreview?.classList.remove('hidden');
                } else {
                    DOM.portraitPreview?.classList.add('hidden');
                    UI.addChatLog('System', 'Portraet konnte ueber den Host nicht generiert werden.');
                }
                UI.showLoader(false);
                if (DOM.genImgBtn) DOM.genImgBtn.innerText = State.imageQuotaExceeded ? 'Ohne Portraet' : 'Portraet';
                break;
            }
            case 'CHAR_MAP': {
                this.playerCharMap = msg.map || {};
                State._mpMyCharId = this.playerCharMap[this.playerName] || null;
                UI.updateAll();
                break;
            }
            case 'VOTE_START': {
                this.currentVote = { question: msg.question, options: msg.options, votes: {}, resolved: false };
                this._updateTurnUI();
                break;
            }
            case 'VOTE_STATUS': {
                if (this.currentVote) this.currentVote.votes = msg.votes || {};
                this._updateTurnUI();
                break;
            }
            case 'VOTE_RESULT': {
                UI.addChatLog({ id: Utils.generateId('sys'), sender: 'System', text: `**Abstimmung beendet:** "${msg.chosen}" wurde gewaehlt.`, tone: 'neutral', createdAt: Date.now() }, null, { persist: true });
                this.currentVote = null;
                this._updateTurnUI();
                break;
            }
            case 'CONTROL_MODE_UPDATE': {
                State.playerControlMode = State.playerControlMode || {};
                State.playerControlMode[msg.playerName] = msg.mode;
                this._syncAutoPlayersFromControlModes();
                this._updateTurnUI();
                UI.updateAll();
                break;
            }
            case 'TRANSIENT_EVENT': {
                if (!msg.event) break;
                const evt = msg.event;
                const now = Date.now();
                if ((evt.expiresAt || 0) <= now) break;
                State.transientEvents = Array.isArray(State.transientEvents) ? State.transientEvents : [];
                const idx = State.transientEvents.findIndex(item => item.id === evt.id);
                if (idx >= 0) State.transientEvents[idx] = { ...State.transientEvents[idx], ...evt };
                else State.transientEvents.push(evt);
                State.transientEvents = State.transientEvents.filter(item => (item.expiresAt || 0) > now).slice(-12);
                UI.showTransientEvent(evt);
                break;
            }
            case 'CRAFTING_SUGGESTION_RESPONSE': {
                Engine.applyCraftingSuggestion(msg.data);
                break;
            }
            default:
                console.warn('Unknown host message:', msg.type);
        }
    },

    _updateUI() {
        const badge = document.getElementById('mp-status-badge');
        const modal = document.getElementById('multiplayer-modal');

        if (badge) {
            if (this.connState === 'connected') {
                badge.classList.remove('hidden');
                const count = this.connections.length;
                const roleLabel = this.isHost() ? 'Host' : 'Client';
                // Security: render badge text via text nodes to avoid XSS.
                badge.replaceChildren();
                const icon = document.createElement('i');
                icon.className = 'fas fa-wifi text-green-400';
                badge.appendChild(icon);
                badge.appendChild(document.createTextNode(` ${roleLabel} (${count})`));
                badge.title = this.isHost()
                    ? `Raum: ${this.roomCode} | ${count} Spieler verbunden`
                    : `Verbunden mit Raum ${this.roomCode}`;
            } else if (this.connState === 'connecting') {
                badge.classList.remove('hidden');
                // Security: render badge text via text nodes to avoid XSS.
                badge.replaceChildren();
                const icon = document.createElement('i');
                icon.className = 'fas fa-spinner fa-spin text-amber-400';
                badge.appendChild(icon);
                badge.appendChild(document.createTextNode(' Verbinde...'));
                badge.title = 'Verbindung wird hergestellt...';
            } else {
                badge.classList.add('hidden');
            }
        }


        if (modal && !modal.classList.contains('hidden')) {
            this._renderModalContent();
        }
    },

    showModal() {
        const modal = document.getElementById('multiplayer-modal');
        if (modal) {
            modal.classList.remove('hidden');
            this._renderModalContent();
        }
    },

    _renderModalContent() {
        const content = document.getElementById('mp-modal-content');
        if (!content) return;

        if (this.connState === 'connecting') {
            content.innerHTML = sanitize(`
                <div class="flex flex-col items-center gap-3 py-6">
                    <i class="fas fa-spinner fa-spin text-cyan-400 text-3xl"></i>
                    <p class="text-slate-300 text-sm">Verbinde mit Signaling-Server...</p>
                    <p class="text-slate-500 text-[10px]">Timeout: ${CONNECT_TIMEOUT_MS / 1000}s</p>
                    <button data-action="mp-disconnect" class="mt-2 bg-slate-700/80 hover:bg-slate-600 text-white py-1.5 px-4 rounded-lg text-xs font-bold transition-all border border-slate-500/40">
                        Abbrechen
                    </button>
                </div>`);
            return;
        }

        if (this.connState === 'error') {
            content.innerHTML = sanitize(`
                <div class="space-y-4">
                    <div class="bg-red-900/30 border border-red-500/40 rounded-lg p-3">
                        <p class="text-red-300 text-sm font-bold"><i class="fas fa-exclamation-triangle mr-1"></i> Verbindungsfehler</p>
                        <p class="text-slate-400 text-xs mt-1">${this._lastError || 'Unbekannter Fehler'}</p>
                    </div>
                    <div class="flex gap-2">
                        <button data-action="mp-retry" class="flex-1 bg-amber-700/80 hover:bg-amber-600 text-white py-2 rounded-lg text-xs font-bold transition-all border border-amber-500/40">
                            <i class="fas fa-redo mr-1"></i> Erneut versuchen
                        </button>
                        <button data-action="mp-disconnect" class="flex-1 bg-slate-700/80 hover:bg-slate-600 text-white py-2 rounded-lg text-xs font-bold transition-all border border-slate-500/40">
                            Zurück
                        </button>
                    </div>
                </div>`);
            return;
        }

        if (this.connState === 'connected') {
            const count = this.connections.length;
            const roleLabel = this.isHost() ? 'Host' : 'Spieler';
            const playersList = this.isHost()
                ? this.turnOrder.map(playerName => {
                    const mode = this.getPlayerControlMode(playerName);
                    const canToggle = playerName !== this.playerName;
                    return `<li class="flex items-center gap-2 rounded-xl border border-slate-700/40 bg-black/20 px-2.5 py-2 text-xs text-green-300"><i class="fas ${playerName === this.playerName ? 'fa-crown text-amber-400' : 'fa-user'}"></i><span>${playerName}</span><span class="ml-auto rounded-full border ${mode === 'ai' ? 'border-cyan-500/40 bg-cyan-950/60 text-cyan-300' : 'border-slate-600/40 bg-slate-950/60 text-slate-400'} px-1.5 py-0.5 text-[9px]">${mode === 'ai' ? 'AI' : 'Human'}</span>${canToggle ? `<button data-action="mp-toggle-control" data-player="${playerName}" class="rounded-lg border border-slate-600/40 bg-black/30 px-2 py-1 text-[10px] font-bold text-slate-200">${mode === 'ai' ? 'Human' : 'AI'}</button>` : ''}</li>`;
                }).join('')
                : '';

            content.innerHTML = sanitize(`
                <div class="space-y-4">
                    <div class="bg-green-900/30 border border-green-500/40 rounded-lg p-3">
                        <p class="text-green-300 text-sm font-bold"><i class="fas fa-check-circle mr-1"></i> Verbunden als ${roleLabel}</p>
                        ${this.isHost() ? `<p class="text-slate-400 text-xs mt-1">Raum-Code: <span class="text-amber-400 font-mono font-bold text-sm select-all">${this.roomCode}</span></p>` : `<p class="text-slate-400 text-xs mt-1">Raum: <span class="text-amber-400 font-mono">${this.roomCode}</span></p>`}
                        <p class="text-slate-400 text-xs mt-1">${count} Spieler verbunden</p>
                        ${playersList ? `<ul class="mt-2 space-y-1">${playersList}</ul>` : ''}
                    </div>
                    
                    <button data-action="mp-disconnect" class="w-full bg-red-700/80 hover:bg-red-600 text-white py-2 rounded-lg text-xs font-bold transition-all border border-red-500/40">
                        <i class="fas fa-sign-out-alt mr-1"></i> Trennen
                    </button>
                </div>`);
            return;
        }

        const savedServer = (() => {
            try { return JSON.parse(Utils.safeStorageGet(LS_KEY_SERVER)) || {}; } catch (_) { return {}; }
        })();
        const savedTurn = (() => {
            try { const t = JSON.parse(Utils.safeStorageGet(LS_KEY_TURN)); return (t && t[0]) || {}; } catch (_) { return {}; }
        })();

        content.innerHTML = sanitize(`
            <div class="space-y-4">
                <div>
                    <label class="text-xs text-slate-400 font-bold uppercase tracking-wider block mb-1">Dein Name</label>
                    <input id="mp-player-name" type="text" placeholder="Spielername" value="" class="w-full bg-black/50 border border-slate-700/50 rounded-lg p-2 text-sm text-slate-200 outline-none focus:border-purple-500/50">
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <button data-action="mp-host" class="bg-purple-700/80 hover:bg-purple-600 text-white py-3 rounded-lg text-xs font-bold transition-all border border-purple-500/40 flex flex-col items-center gap-1">
                        <i class="fas fa-crown text-amber-400 text-lg"></i>
                        <span>Raum erstellen</span>
                        <span class="text-[10px] text-slate-400 font-normal">(als Host)</span>
                    </button>
                    <div class="flex flex-col gap-2">
                        <input id="mp-room-code" type="text" placeholder="RAUM-CODE" maxlength="6" class="w-full bg-black/50 border border-slate-700/50 rounded-lg p-2 text-sm text-center font-mono uppercase text-amber-400 outline-none focus:border-indigo-500/50 tracking-widest placeholder-slate-600">
                        <button data-action="mp-join" class="flex-1 bg-indigo-700/80 hover:bg-indigo-600 text-white py-2 rounded-lg text-xs font-bold transition-all border border-indigo-500/40 flex items-center justify-center gap-1.5">
                            <i class="fas fa-sign-in-alt"></i> Beitreten
                        </button>
                    </div>
                </div>

                <details class="group border border-slate-700/40 rounded-lg overflow-hidden">
                    <summary class="cursor-pointer px-3 py-2 text-[10px] text-slate-500 font-bold uppercase tracking-wider bg-slate-800/40 hover:bg-slate-800/80 transition-colors flex items-center gap-1.5 select-none">
                        <i class="fas fa-cog text-slate-600 group-open:text-cyan-500 transition-colors"></i>
                        Erweiterte Einstellungen
                        <i class="fas fa-chevron-right text-[8px] ml-auto group-open:rotate-90 transition-transform"></i>
                    </summary>
                    <div class="p-3 space-y-3 border-t border-slate-700/40">
                        <p class="text-[10px] text-slate-500">Standard: Kostenloser PeerJS-Cloud-Server. Optional: eigenen Server nutzen (<code class="text-cyan-500">npx peer --port 9000</code>).</p>
                        <div class="space-y-2">
                            <label class="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">PeerServer</label>
                            <div class="grid grid-cols-3 gap-1.5">
                                <input id="mp-cfg-host" type="text" placeholder="Host (leer = Cloud)" value="${savedServer.host || ''}" class="col-span-2 bg-black/50 border border-slate-700/50 rounded p-1.5 text-[11px] text-slate-300 outline-none focus:border-cyan-500/50 placeholder-slate-600">
                                <input id="mp-cfg-port" type="text" placeholder="Port" value="${savedServer.port || ''}" class="bg-black/50 border border-slate-700/50 rounded p-1.5 text-[11px] text-slate-300 outline-none focus:border-cyan-500/50 placeholder-slate-600">
                            </div>
                            <div class="grid grid-cols-3 gap-1.5 items-center">
                                <input id="mp-cfg-path" type="text" placeholder="Pfad (/)" value="${savedServer.path || ''}" class="col-span-2 bg-black/50 border border-slate-700/50 rounded p-1.5 text-[11px] text-slate-300 outline-none focus:border-cyan-500/50 placeholder-slate-600">
                                <label class="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                                    <input id="mp-cfg-secure" type="checkbox" ${savedServer.secure !== false ? 'checked' : ''} class="accent-cyan-500"> SSL
                                </label>
                            </div>
                        </div>
                        <div class="space-y-2">
                            <label class="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">TURN Relay (NAT-Traversal)</label>
                            <input id="mp-cfg-turn-url" type="text" placeholder="turn:server:port (leer = Standard)" value="${savedTurn.urls || ''}" class="w-full bg-black/50 border border-slate-700/50 rounded p-1.5 text-[11px] text-slate-300 outline-none focus:border-cyan-500/50 placeholder-slate-600">
                            <div class="grid grid-cols-2 gap-1.5">
                                <input id="mp-cfg-turn-user" type="text" placeholder="Username" value="${savedTurn.username || ''}" class="bg-black/50 border border-slate-700/50 rounded p-1.5 text-[11px] text-slate-300 outline-none focus:border-cyan-500/50 placeholder-slate-600">
                                <input id="mp-cfg-turn-pass" type="text" placeholder="Credential" value="${savedTurn.credential || ''}" class="bg-black/50 border border-slate-700/50 rounded p-1.5 text-[11px] text-slate-300 outline-none focus:border-cyan-500/50 placeholder-slate-600">
                            </div>
                        </div>
                        <button data-action="mp-save-config" class="w-full bg-cyan-800/60 hover:bg-cyan-700/80 text-cyan-200 py-1.5 rounded text-[10px] font-bold transition-all border border-cyan-600/30">
                            <i class="fas fa-save mr-1"></i> Konfiguration speichern
                        </button>
                    </div>
                </details>
            </div>`);
    },

    _syncBtnHtml: '<button data-action="mp-request-sync" class="absolute top-1 right-1.5 text-[9px] text-slate-600 hover:text-cyan-400 transition-colors" title="Sync erzwingen"><i class="fas fa-sync-alt"></i></button>',

    _injectTurnIndicator() {
        if (document.getElementById('mp-turn-indicator')) return;
        const actionArea = document.getElementById('action-area');
        if (!actionArea) return;
        const indicator = document.createElement('div');
        indicator.id = 'mp-turn-indicator';
        indicator.className = 'hidden relative text-[11px] px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg backdrop-blur-sm text-center tracking-wide';
        actionArea.insertBefore(indicator, actionArea.firstChild);
    },

    _updateTurnUI() {
        this._injectTurnIndicator();
        const el = document.getElementById('mp-turn-indicator');
        if (!el) return;

        if (!this.isConnected() || this.turnOrder.length <= 1) {
            el.classList.add('hidden');
            this._setQuickActionsEnabled(true);
            return;
        }

        const playerInput = document.getElementById('player-input');
        const sendBtn = document.getElementById('send-btn');
        const hasPendingRolls = State.pendingRolls && State.pendingRolls.length > 0;

        if (this.currentVote && !this.currentVote.resolved) {
            el.classList.remove('hidden');
            el.className = 'relative px-3 py-2 bg-black/40 border border-purple-900/50 rounded-lg backdrop-blur-sm shadow-[0_0_15px_rgba(168,85,247,0.15)]';
            this._renderVotePanel(el);
            playerInput.disabled = true;
            sendBtn.disabled = true;
            this._setQuickActionsEnabled(false);
            return;
        }

        if (this.isInCombat() && !hasPendingRolls) {
            el.classList.remove('hidden');
            el.className = 'relative px-3 py-2 bg-black/40 border border-red-900/50 rounded-lg backdrop-blur-sm shadow-[0_0_15px_rgba(239,68,68,0.15)]';
            this._renderCombatRoundPanel(el);
            const submitted = !!this._mySubmittedAction;
            this._setQuickActionsEnabled(false);
            playerInput.disabled = submitted || State.isProcessing;
            sendBtn.disabled = submitted || State.isProcessing;
            playerInput.placeholder = submitted
                ? 'Aktion eingereicht – warte auf andere...'
                : 'Deine Kampfaktion eingeben...';
            return;
        }

        if (hasPendingRolls) {
            el.classList.remove('hidden');
            el.className = 'relative text-[11px] px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg backdrop-blur-sm text-center tracking-wide';
            if (this.isClient()) {
                const myChar = State._mpMyCharId ? State.party.find(p => p.id === State._mpMyCharId) : null;
                const hasOwnRolls = myChar && State.pendingRolls.some(r => !r.rolled && r.name === myChar.name);
                el.innerHTML = sanitize((hasOwnRolls
                    ? '<i class="fas fa-dice-d20 text-green-400 mr-1.5 animate-pulse"></i> <span class="text-green-300 font-bold">Deine Proben wuerfeln!</span>'
                    : '<i class="fas fa-dice-d20 text-amber-400 mr-1.5 animate-pulse"></i> <span class="text-amber-300">Warte auf Probenergebnisse...</span>')
                    + this._syncBtnHtml);
            } else {
                el.innerHTML = sanitize('<i class="fas fa-dice-d20 text-indigo-400 mr-1.5 animate-pulse"></i> <span class="text-indigo-300 font-bold">Proben ausstehend...</span>' + this._syncBtnHtml);
            }
            playerInput.disabled = true;
            sendBtn.disabled = true;
            this._setQuickActionsEnabled(false);
            return;
        }

        const currentPlayer = this.turnOrder[this.currentTurnIndex] || '';
        const currentPlayerLabel = this.getDisplayPlayerName(currentPlayer);
        const myTurn = this.isMyTurn();
        const actionArea = document.getElementById('action-area');
        if (actionArea) {
            actionArea.classList.toggle('mp-active-turn', !!myTurn);
            actionArea.classList.toggle('mp-inactive-turn', !myTurn);
        }
        el.classList.remove('hidden');
        el.className = 'relative text-[11px] px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg backdrop-blur-sm text-center tracking-wide';
        const voteBtn = this.isHost() ? ' <button data-action="mp-start-vote" class="ml-2 text-purple-400 hover:text-purple-300 transition-colors" title="Abstimmung starten"><i class="fas fa-poll"></i></button>' : '';
        const isAutoTurn = this.getPlayerControlMode(currentPlayer) === 'ai';
        const turnOrderHtml = this.turnOrder.map(p => {
            const isAuto = this.getPlayerControlMode(p) === 'ai';
            const displayName = this.getDisplayPlayerName(p);
            const label = isAuto ? `<span class="text-cyan-400">${displayName} <i class="fas fa-robot text-[8px]"></i></span>` : displayName;
            return p === this.playerName ? `<b>${label}</b>` : label;
        }).join(' \u2192 ');
        const autoToggleHtml = this.isHost() ? this.turnOrder.filter(p => p !== this.playerName).map(p => {
            const isAuto = this.getPlayerControlMode(p) === 'ai';
            const displayName = this.getDisplayPlayerName(p);
            return `<button data-action="mp-toggle-control" data-player="${p}" class="text-[9px] px-1.5 py-0.5 rounded ${isAuto ? 'bg-cyan-900/40 text-cyan-400 border border-cyan-500/30' : 'bg-slate-800/60 text-slate-500 border border-slate-600/30'} hover:text-cyan-300 transition-all" title="${displayName}: KI ${isAuto ? 'aus' : 'an'}"><i class="fas fa-robot mr-0.5"></i>${displayName}</button>`;
        }).join(' ') : '';
        el.innerHTML = sanitize(this._syncBtnHtml + (myTurn
            ? `<i class="fas fa-arrow-right text-green-400 mr-1.5"></i> <span class="text-green-300 font-bold">Dein Zug!</span>${voteBtn}`
            : `<i class="fas fa-hourglass-half text-amber-400 mr-1.5 animate-pulse"></i> <span class="text-amber-300"><b>${currentPlayerLabel}</b>${isAutoTurn ? ' <i class="fas fa-robot text-[9px]"></i>' : ''} ist am Zug...</span>`)
            + `<div class="text-slate-500 text-[9px] mt-1">${turnOrderHtml}</div>`
            + (autoToggleHtml ? `<div class="flex flex-wrap gap-1 mt-1.5 justify-center">${autoToggleHtml}</div>` : ''));
        playerInput.disabled = !myTurn || State.isProcessing;
        sendBtn.disabled = !myTurn || State.isProcessing;
        playerInput.placeholder = State.isProcessing ? 'DM antwortet...' : (myTurn ? 'Was tut ihr?' : `Warte auf ${currentPlayerLabel}...`);
        this._setQuickActionsEnabled(myTurn && !State.isProcessing);
    },

    _renderCombatRoundPanel(el) {
        const submitted = this.isHost()
            ? Object.fromEntries(this.turnOrder.map(p => [p, !!this.combatActions[p]]))
            : this._combatStatus;
        const totalPlayers = this.turnOrder.length;
        const submittedCount = Object.values(submitted).filter(Boolean).length;

        const playersHtml = this.turnOrder.map(p => {
            const done = !!submitted[p];
            const isMe = p === this.playerName;
            const isAuto = this.getPlayerControlMode(p) === 'ai';
            const icon = isAuto
                ? '<i class="fas fa-robot text-cyan-400"></i>'
                : done
                    ? '<i class="fas fa-check-circle text-green-400"></i>'
                    : '<i class="fas fa-hourglass-half text-amber-400 animate-pulse"></i>';
            const displayName = this.getDisplayPlayerName(p);
            const nameClass = isMe ? 'text-cyan-300 font-bold' : (isAuto ? 'text-cyan-400' : 'text-slate-300');
            const autoLabel = isAuto ? ' <span class="text-[8px] text-cyan-500">(KI)</span>' : '';
            let actions = '';
            if (this.isHost() && !isMe) {
                const autoBtn = `<button data-action="mp-toggle-control" data-player="${p}" class="text-[9px] ${isAuto ? 'text-cyan-400 hover:text-cyan-300' : 'text-slate-500 hover:text-cyan-400'} ml-1" title="${isAuto ? 'KI deaktivieren' : 'KI aktivieren'}"><i class="fas fa-robot"></i></button>`;
                const skipBtn = !done && !isAuto
                    ? ` <button data-action="mp-skip-player" data-player="${p}" class="text-[9px] text-red-400 hover:text-red-300 ml-1 underline">Skip</button>`
                    : '';
                actions = autoBtn + skipBtn;
            }
            return `<div class="flex items-center gap-1.5 text-[10px]">${icon} <span class="${nameClass}">${isMe ? 'Du' : displayName}</span>${autoLabel}${actions}</div>`;
        }).join('');

        const canExecute = submittedCount > 0 && !State.isProcessing;
        const executeBtn = this.isHost()
            ? `<button data-action="mp-execute-round" class="mt-2 w-full ${canExecute ? 'bg-red-700 hover:bg-red-600 border-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.3)]' : 'bg-slate-700 border-slate-600 opacity-50 cursor-not-allowed'} text-white py-1.5 rounded-lg text-[10px] font-bold border transition-all" ${canExecute ? '' : 'disabled'}><i class="fas fa-fist-raised mr-1"></i> Runde ausfuehren (${submittedCount}/${totalPlayers})</button>`
            : '';

        el.innerHTML = sanitize(`${this._syncBtnHtml}<div class="text-left space-y-1.5">
            <div class="flex items-center gap-2 mb-1">
                <i class="fas fa-khanda text-red-400"></i>
                <span class="text-red-300 font-bold text-[11px] uppercase tracking-wider">Kampfrunde</span>
                <span class="text-slate-500 text-[9px] ml-auto">${submittedCount}/${totalPlayers} bereit</span>
            </div>
            <div class="space-y-1 pl-1">${playersHtml}</div>
            ${executeBtn}
        </div>`);
    },

    _renderVotePanel(el) {
        const vote = this.currentVote;
        if (!vote) return;
        const myVote = vote.votes[this.playerName];
        const voteCounts = {};
        vote.options.forEach((_, i) => { voteCounts[i] = 0; });
        Object.values(vote.votes).forEach(v => { voteCounts[v] = (voteCounts[v] || 0) + 1; });

        const optionsHtml = vote.options.map((opt, i) => {
            const count = voteCounts[i] || 0;
            const isMyChoice = myVote === i;
            const btnClass = isMyChoice
                ? 'bg-purple-700 border-purple-400 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]'
                : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700 hover:border-purple-500/50';
            const disabled = myVote !== undefined ? 'pointer-events-none' : '';
            return `<button data-action="mp-cast-vote" data-option="${i}" class="${btnClass} ${disabled} w-full text-left py-1.5 px-2.5 rounded-lg text-[10px] font-medium border transition-all flex justify-between items-center">
                <span>${opt}</span>
                <span class="text-[9px] text-slate-400">${count} Stimme${count !== 1 ? 'n' : ''}</span>
            </button>`;
        }).join('');

        const resolveBtn = this.isHost()
            ? `<div class="mt-2 flex gap-1.5">${vote.options.map((opt, i) => {
                const count = voteCounts[i] || 0;
                return `<button data-action="mp-resolve-vote" data-option="${i}" class="flex-1 bg-amber-800/60 hover:bg-amber-700 text-amber-200 py-1 rounded text-[9px] font-bold border border-amber-600/40 transition-all">${opt} (${count})</button>`;
            }).join('')}</div>`
            : '';

        el.innerHTML = sanitize(`<div class="text-left space-y-1.5">
            <div class="flex items-center gap-2 mb-1">
                <i class="fas fa-poll text-purple-400"></i>
                <span class="text-purple-300 font-bold text-[11px] uppercase tracking-wider">Abstimmung</span>
                <span class="text-slate-500 text-[9px] ml-auto">${Object.keys(vote.votes).length}/${this.turnOrder.length}</span>
            </div>
            <p class="text-slate-200 text-[11px] font-medium">${vote.question}</p>
            <div class="space-y-1">${optionsHtml}</div>
            ${resolveBtn}
        </div>`);
    },

    _showClientRollView() {
        const actionBox = document.getElementById('action-box-container');
        if (!actionBox || actionBox.classList.contains('hidden')) return;

        actionBox.querySelectorAll(
            'button[data-action="roll-specific"], button[data-action="roll-all"], button[data-action="submit-rolls"]'
        ).forEach(btn => btn.remove());

        if (!actionBox.querySelector('.mp-waiting-rolls')) {
            const msg = document.createElement('p');
            msg.className = 'mp-waiting-rolls text-center text-[10px] text-amber-400 mt-2 animate-pulse';
            msg.innerHTML = '<i class="fas fa-dice-d20 mr-1"></i> Der Host würfelt die Proben...';
            actionBox.appendChild(msg);
        }
    },

    _setQuickActionsEnabled(enabled) {
        const selectors = [
            '[data-action="submit-action"]',
            '[data-action="camp"]',
            '[data-action="ask-oracle"]',
            '[data-action="plot-twist"]',
            '[data-action="generate-npc"]',
            '[data-action="check-enemies"]',
            '[data-action="toggle-quickplay"]',
        ];
        document.querySelectorAll(selectors.join(',')).forEach(btn => {
            btn.disabled = !enabled;
            btn.classList.toggle('opacity-40', !enabled);
            btn.classList.toggle('pointer-events-none', !enabled);
        });
    },
};















