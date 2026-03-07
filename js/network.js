import Peer from 'peerjs';
import { State, subscribe, dispatch } from './state.js';
import { UI, DOM } from './ui.js';
import { Engine } from './engine.js';
import { Sound } from './sound.js';

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
    'party', 'activeEnemies', 'defeatedEnemies', 'lootDrops',
    'lastStoryPart', 'gameStarted', 'combatEnded', 'activeMerchant',
    'journal', 'sessionStats', 'fate', 'fatigue', 'abilityCooldowns',
    'isBossFight', 'dungeonLevel', 'weather', 'gold', 'momentum',
    'pendingRolls', 'pendingAbilityLearning',
    'combatActions', 'votingSession', 'leaderName', 'playerAssignments',
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
    turnOrder: [],
    currentTurnIndex: 0,

    isHost() { return this.role === 'host'; },
    isClient() { return this.role === 'client'; },
    isConnected() { return this.connState === 'connected'; },
    isLeader() {
        if (!this.isConnected()) return true;
        const leader = State.leaderName;
        return leader ? leader === this.playerName : this.isHost();
    },
    getMyCharId() { return State.playerAssignments[this.playerName]; },
    getMyChar() { return State.party.find(c => c.id === this.getMyCharId()); },
    isMyTurn() {
        if (!this.isConnected() || this.turnOrder.length <= 1) return true;
        return this.turnOrder[this.currentTurnIndex] === this.playerName;
    },

    generateRoomCode() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    },

    _getPeerConfig() {
        const opts = { config: { iceServers: [...DEFAULT_ICE_SERVERS] } };

        try {
            const turnJson = localStorage.getItem(LS_KEY_TURN);
            if (turnJson) {
                const custom = JSON.parse(turnJson);
                if (Array.isArray(custom) && custom.length > 0) {
                    opts.config.iceServers = [...DEFAULT_ICE_SERVERS, ...custom];
                }
            }
        } catch (e) { console.warn('Failed to parse TURN config:', e); }

        try {
            const serverJson = localStorage.getItem(LS_KEY_SERVER);
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
        if (this.peer) this.disconnect();
        this.playerName = playerName || 'DM';
        dispatch({ type: 'BULK_UPDATE', updates: { localPlayerName: this.playerName, leaderName: this.playerName } });
        this.roomCode = this.generateRoomCode();
        this.role = 'host';
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
            UI.addChatLog('System', `Multiplayer-Raum erstellt: **${this.roomCode}**. Teile diesen Code mit deinen Spielern.`);
        });

        this.peer.on('connection', (conn) => {
            conn.on('open', () => {
                this.connections.push(conn);
                const joinedName = conn.metadata?.name || 'Unbekannt';
                UI.addChatLog('System', `Spieler **${joinedName}** ist beigetreten.`);
                if (!this.turnOrder.includes(joinedName)) {
                    this.turnOrder.push(joinedName);
                }
                this._updateUI();
                this._sendTo(conn, { type: 'STATE_SYNC', state: this._getSyncState() });
                this.broadcastTurnState();
            });

            conn.on('data', (msg) => this._handleClientMessage(conn, msg));

            conn.on('close', () => {
                this.connections = this.connections.filter(c => c !== conn);
                const leftName = conn.metadata?.name || 'Unbekannt';
                UI.addChatLog('System', `Spieler **${leftName}** hat den Raum verlassen.`);
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
            this.broadcastState();
        });
    },

    join(roomCode, playerName) {
        if (this.peer) this.disconnect();
        this.playerName = playerName || 'Spieler';
        dispatch({ type: 'BULK_UPDATE', updates: { localPlayerName: this.playerName } });
        this.roomCode = roomCode.toUpperCase();
        this.role = 'client';
        this._setConnState('connecting');
        this._startConnectTimeout();

        const config = this._getPeerConfig();
        this.peer = new Peer(undefined, config);

        this.peer.on('open', () => {
            const peerId = ROOM_PREFIX + this.roomCode;
            const conn = this.peer.connect(peerId, {
                metadata: { name: this.playerName },
            });

            conn.on('open', () => {
                this._clearConnectTimeout();
                this.connections = [conn];
                this._setConnState('connected');
                UI.addChatLog('System', `Verbunden mit Raum **${this.roomCode}** als **${this.playerName}**.`);
            });

            conn.on('data', (msg) => this._handleHostMessage(msg));

            conn.on('close', () => {
                UI.addChatLog('System', 'Verbindung zum Host verloren.');
                this.connections = [];
                this._setConnState('error', 'Verbindung zum Host verloren.');
            });

            conn.on('error', (err) => {
                console.error('Connection error:', err);
                this._setConnState('error', err.message);
                UI.addChatLog('System', `Verbindungsfehler: ${err.message}`);
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
    },

    disconnect() {
        this._clearConnectTimeout();
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
        this.connections.forEach(c => { try { c.close(); } catch (_) {} });
        this.connections = [];
        if (this.peer) {
            try { this.peer.destroy(); } catch (_) {}
            this.peer = null;
        }
        this.role = null;
        this.roomCode = null;
        this.turnOrder = [];
        this.currentTurnIndex = 0;
        this._setConnState('idle');
        const turnEl = document.getElementById('mp-turn-indicator');
        if (turnEl) turnEl.classList.add('hidden');
    },

    sendPlayerAction(action, actingChar) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], {
            type: 'PLAYER_ACTION',
            action,
            actingChar,
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

    broadcastState() {
        if (!this.isHost()) return;
        const syncState = this._getSyncState();
        this.connections.forEach(conn => {
            this._sendTo(conn, { type: 'STATE_SYNC', state: syncState });
        });
    },

    broadcastChat(sender, text) {
        if (!this.isHost()) return;
        this.connections.forEach(conn => {
            this._sendTo(conn, { type: 'DM_MESSAGE', sender, text });
        });
    },

    broadcastSystemChat(sender, text) {
        if (!this.isHost()) return;
        this.connections.forEach(conn => {
            this._sendTo(conn, { type: 'SYSTEM_CHAT', sender, text });
        });
    },

    advanceTurn() {
        if (!this.isHost() || this.turnOrder.length <= 1) return;
        this.currentTurnIndex = (this.currentTurnIndex + 1) % this.turnOrder.length;
        this.broadcastTurnState();
        this._updateTurnUI();
    },

    broadcastTurnState() {
        if (!this.isHost()) return;
        const msg = {
            type: 'TURN_UPDATE',
            turnOrder: this.turnOrder,
            currentTurnIndex: this.currentTurnIndex,
        };
        this.connections.forEach(c => this._sendTo(c, msg));
        this._updateTurnUI();
    },

    // ── Combat Round ──────────────────────────────────────────────
    submitCombatAction(action) {
        if (this.isHost()) {
            dispatch({ type: 'SET_COMBAT_ACTION', playerName: this.playerName, action });
            this.broadcastState();
        } else {
            this._sendTo(this.connections[0], { type: 'COMBAT_ACTION_SUBMIT', action, playerName: this.playerName });
        }
    },

    clearCombatActions() {
        dispatch({ type: 'CLEAR_COMBAT_ACTIONS' });
        if (this.isHost()) this.broadcastState();
    },

    // ── Voting ────────────────────────────────────────────────────
    startVote(question, options) {
        if (!this.isHost()) return;
        const session = { id: Date.now().toString(), question, options, votes: {} };
        dispatch({ type: 'START_VOTE', session });
        this.broadcastState();
        UI.addChatLog('System', `🗳️ **Abstimmung:** ${question}`);
        this.broadcastSystemChat('System', `🗳️ **Abstimmung:** ${question}`);
    },

    castVote(optionIdx) {
        if (this.isHost()) {
            dispatch({ type: 'CAST_VOTE', playerName: this.playerName, optionIdx });
            this.broadcastState();
        } else {
            this._sendTo(this.connections[0], { type: 'VOTE_CAST', optionIdx, playerName: this.playerName });
        }
    },

    resolveVote(optionIdx) {
        if (!this.isLeader()) return;
        const session = State.votingSession;
        if (!session) return;
        const chosen = session.options[optionIdx];
        dispatch({ type: 'END_VOTE' });
        if (this.isHost()) this.broadcastState();
        return chosen;
    },

    skipVotePlayer(playerName) {
        if (!this.isHost()) return;
        dispatch({ type: 'CAST_VOTE', playerName, optionIdx: -1 });
        this.broadcastState();
        UI.addChatLog('System', `⏭️ **${playerName}** wurde in der Abstimmung übersprungen.`);
    },

    // ── Leader ────────────────────────────────────────────────────
    setLeader(name) {
        if (!this.isHost()) return;
        dispatch({ type: 'SET_LEADER', name });
        this.broadcastState();
        UI.addChatLog('System', `👑 **${name}** ist jetzt der Gruppenleader.`);
        this.broadcastSystemChat('System', `👑 **${name}** ist jetzt der Gruppenleader.`);
    },

    // ── Character Assignment ──────────────────────────────────────
    assignCharacterToPlayer(playerName, charId) {
        if (!this.isHost()) return;
        dispatch({ type: 'ASSIGN_PLAYER', playerName, charId });
        this.broadcastState();
        const char = State.party.find(c => c.id === charId);
        UI.addChatLog('System', `🎭 **${playerName}** spielt jetzt **${char?.name || charId}**.`);
    },

    requestCharacterAssign(charId) {
        if (this.isHost()) {
            this.assignCharacterToPlayer(this.playerName, charId);
        } else {
            this._sendTo(this.connections[0], { type: 'CHARACTER_ASSIGN_REQUEST', charId, playerName: this.playerName });
        }
    },

    // ── Item Transfer ─────────────────────────────────────────────
    giveItemToChar(fromCharId, itemName, toCharId) {
        if (this.isHost()) {
            this._executeItemGive(fromCharId, itemName, toCharId);
        } else {
            this._sendTo(this.connections[0], { type: 'ITEM_GIVE_REQUEST', fromCharId, itemName, toCharId });
        }
    },

    _executeItemGive(fromCharId, itemName, toCharId) {
        const from = State.party.find(c => c.id === fromCharId);
        const to = State.party.find(c => c.id === toCharId);
        if (!from || !to) return;
        const idx = from.inventory.findIndex(i => i === itemName);
        if (idx === -1) return;
        from.inventory.splice(idx, 1);
        to.inventory.push(itemName);
        dispatch({ type: 'BULK_UPDATE', updates: {} }); // trigger listeners
        if (this.isHost()) this.broadcastState();
        UI.addChatLog('System', `📦 **${from.name}** gibt **${itemName}** an **${to.name}** weiter.`);
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
            localStorage.setItem(LS_KEY_SERVER, JSON.stringify({
                host,
                port: portEl?.value.trim() || '9000',
                path: pathEl?.value.trim() || '/',
                secure: secureEl?.checked !== false,
            }));
        } else {
            localStorage.removeItem(LS_KEY_SERVER);
        }

        const turnUrl = turnUrlEl?.value.trim();
        if (turnUrl) {
            localStorage.setItem(LS_KEY_TURN, JSON.stringify([{
                urls: turnUrl,
                username: turnUserEl?.value.trim() || '',
                credential: turnPassEl?.value.trim() || '',
            }]));
        } else {
            localStorage.removeItem(LS_KEY_TURN);
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
                this.connections.forEach(c => {
                    if (c !== conn) {
                        this._sendTo(c, { type: 'PLAYER_CHAT', sender: msg.actingChar || name, text: msg.action });
                    }
                });
                UI.addChatLog(msg.actingChar || name, msg.action);
                if (DOM.actingChar) DOM.actingChar.value = msg.actingChar || 'party';
                Engine.interactWithAI(msg.action);
                break;
            }
            case 'DICE_RESULT': {
                const roll = State.pendingRolls.find(r => r.id === msg.rollId);
                if (roll) {
                    roll.rolled = true;
                    roll.result = msg.result;
                    roll.rawRoll = msg.rawRoll;
                    UI.updateActionBox();
                }
                break;
            }
            case 'COMBAT_ACTION_SUBMIT': {
                dispatch({ type: 'SET_COMBAT_ACTION', playerName: msg.playerName || name, action: msg.action });
                this.broadcastState();
                Sound.play('bling');
                UI.addChatLog('System', `⚔️ **${msg.playerName || name}** hat eine Kampfaktion eingereicht.`);
                UI.updateAll();
                break;
            }
            case 'VOTE_CAST': {
                dispatch({ type: 'CAST_VOTE', playerName: msg.playerName || name, optionIdx: msg.optionIdx });
                this.broadcastState();
                UI.updateAll();
                break;
            }
            case 'CHARACTER_ASSIGN_REQUEST': {
                this.assignCharacterToPlayer(msg.playerName || name, msg.charId);
                break;
            }
            case 'ITEM_GIVE_REQUEST': {
                this._executeItemGive(msg.fromCharId, msg.itemName, msg.toCharId);
                break;
            }
            default:
                console.warn('Unknown client message:', msg.type);
        }
    },

    _handleHostMessage(msg) {
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'STATE_SYNC': {
                const incoming = msg.state;
                const wasStarted = State.gameStarted;
                SYNC_KEYS.forEach(k => {
                    if (incoming[k] !== undefined) State[k] = incoming[k];
                });
                if (State.gameStarted && !wasStarted) UI.toggleViews(true);
                UI.updateAll();
                break;
            }
            case 'DM_MESSAGE':
                UI.addChatLog(msg.sender || 'DM', msg.text);
                break;
            case 'PLAYER_CHAT':
                Sound.play('turn');
                UI.addChatLog(msg.sender || 'Spieler', msg.text);
                break;
            case 'SYSTEM_CHAT':
                UI.addChatLog(msg.sender || 'System', msg.text);
                break;
            case 'TURN_UPDATE': {
                this.turnOrder = msg.turnOrder || [];
                this.currentTurnIndex = msg.currentTurnIndex || 0;
                const wasProcessing = State.isProcessing;
                State.isProcessing = false;
                UI.showLoader(false);
                if (wasProcessing && this.isMyTurn()) Sound.play('turn');
                this._updateTurnUI();
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
                badge.innerHTML = `<i class="fas fa-wifi text-green-400"></i> ${roleLabel} (${count})`;
                badge.title = this.isHost()
                    ? `Raum: ${this.roomCode} | ${count} Spieler verbunden`
                    : `Verbunden mit Raum ${this.roomCode}`;
            } else if (this.connState === 'connecting') {
                badge.classList.remove('hidden');
                badge.innerHTML = `<i class="fas fa-spinner fa-spin text-amber-400"></i> Verbinde...`;
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
            content.innerHTML = `
                <div class="flex flex-col items-center gap-3 py-6">
                    <i class="fas fa-spinner fa-spin text-cyan-400 text-3xl"></i>
                    <p class="text-slate-300 text-sm">Verbinde mit Signaling-Server...</p>
                    <p class="text-slate-500 text-[10px]">Timeout: ${CONNECT_TIMEOUT_MS / 1000}s</p>
                    <button data-action="mp-disconnect" class="mt-2 bg-slate-700/80 hover:bg-slate-600 text-white py-1.5 px-4 rounded-lg text-xs font-bold transition-all border border-slate-500/40">
                        Abbrechen
                    </button>
                </div>`;
            return;
        }

        if (this.connState === 'error') {
            content.innerHTML = `
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
                </div>`;
            return;
        }

        if (this.connState === 'connected') {
            const count = this.connections.length;
            const roleLabel = this.isHost() ? 'Host (DM)' : 'Spieler';
            const leaderName = State.leaderName || this.playerName;
            const allPlayers = this.isHost()
                ? [{ name: this.playerName, isHost: true }, ...this.connections.map(c => ({ name: c.metadata?.name || 'Unbekannt', conn: c }))]
                : [];

            const playersListHtml = this.isHost()
                ? allPlayers.map(p => {
                    const isLeader = leaderName === p.name;
                    const assignment = Object.entries(State.playerAssignments).find(([pn]) => pn === p.name);
                    const charName = assignment ? State.party.find(c => c.id === assignment[1])?.name || '' : '';
                    return `<li class="flex items-center justify-between text-xs py-0.5">
                        <span class="${isLeader ? 'text-amber-300 font-bold' : 'text-green-300'}">
                            ${isLeader ? '<i class="fas fa-crown text-amber-400 mr-1"></i>' : '<i class="fas fa-user text-slate-500 mr-1"></i>'}
                            ${p.name}${charName ? ` <span class="text-slate-500 font-normal">(${charName})</span>` : ''}
                        </span>
                        ${!isLeader ? `<button data-action="set-leader" data-name="${p.name}" class="text-[9px] text-slate-500 hover:text-amber-400 transition-colors ml-2">👑</button>` : ''}
                    </li>`;
                }).join('')
                : `<li class="text-green-300 text-xs">Leader: <span class="text-amber-400 font-bold">${leaderName}</span></li>`;

            content.innerHTML = `
                <div class="space-y-3">
                    <div class="bg-green-900/30 border border-green-500/40 rounded-lg p-3">
                        <p class="text-green-300 text-sm font-bold"><i class="fas fa-check-circle mr-1"></i> Verbunden als ${roleLabel}</p>
                        ${this.isHost() ? `<p class="text-slate-400 text-xs mt-1">Raum-Code: <span class="text-amber-400 font-mono font-bold text-sm select-all">${this.roomCode}</span></p>` : `<p class="text-slate-400 text-xs mt-1">Raum: <span class="text-amber-400 font-mono">${this.roomCode}</span></p>`}
                        <p class="text-slate-400 text-xs mt-1">${count} Spieler verbunden</p>
                        <ul class="mt-2 space-y-1">${playersListHtml}</ul>
                    </div>
                    ${this.isHost() ? `
                    <button data-action="start-vote" class="w-full bg-purple-800/60 hover:bg-purple-700 text-purple-200 py-1.5 rounded-lg text-xs font-bold transition-all border border-purple-500/40">
                        <i class="fas fa-vote-yea mr-1"></i> Abstimmung starten
                    </button>` : ''}
                    <button data-action="mp-disconnect" class="w-full bg-red-700/80 hover:bg-red-600 text-white py-2 rounded-lg text-xs font-bold transition-all border border-red-500/40">
                        <i class="fas fa-sign-out-alt mr-1"></i> Trennen
                    </button>
                </div>`;
            return;
        }

        const savedServer = (() => {
            try { return JSON.parse(localStorage.getItem(LS_KEY_SERVER)) || {}; } catch (_) { return {}; }
        })();
        const savedTurn = (() => {
            try { const t = JSON.parse(localStorage.getItem(LS_KEY_TURN)); return (t && t[0]) || {}; } catch (_) { return {}; }
        })();

        content.innerHTML = `
            <div class="space-y-4">
                <div>
                    <label class="text-xs text-slate-400 font-bold uppercase tracking-wider block mb-1">Dein Name</label>
                    <input id="mp-player-name" type="text" placeholder="Spielername" value="" class="w-full bg-black/50 border border-slate-700/50 rounded-lg p-2 text-sm text-slate-200 outline-none focus:border-purple-500/50">
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <button data-action="mp-host" class="bg-purple-700/80 hover:bg-purple-600 text-white py-3 rounded-lg text-xs font-bold transition-all border border-purple-500/40 flex flex-col items-center gap-1">
                        <i class="fas fa-crown text-amber-400 text-lg"></i>
                        <span>Raum erstellen</span>
                        <span class="text-[10px] text-slate-400 font-normal">(als DM/Host)</span>
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
            </div>`;
    },

    _injectTurnIndicator() {
        if (document.getElementById('mp-turn-indicator')) return;
        const actionArea = document.getElementById('action-area');
        if (!actionArea) return;
        const indicator = document.createElement('div');
        indicator.id = 'mp-turn-indicator';
        indicator.className = 'hidden text-[11px] px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg backdrop-blur-sm text-center tracking-wide';
        actionArea.insertBefore(indicator, actionArea.firstChild);
    },

    _updateTurnUI() {
        this._injectTurnIndicator();
        const el = document.getElementById('mp-turn-indicator');
        if (!el) return;

        if (!this.isConnected() || this.turnOrder.length <= 1) {
            el.classList.add('hidden');
            return;
        }

        const currentPlayer = this.turnOrder[this.currentTurnIndex] || '';
        const myTurn = this.isMyTurn();
        el.classList.remove('hidden');
        el.innerHTML = myTurn
            ? `<i class="fas fa-arrow-right text-green-400 mr-1.5"></i> <span class="text-green-300 font-bold">Dein Zug!</span> <span class="text-slate-500 text-[9px] ml-2">Reihenfolge: ${this.turnOrder.join(' \u2192 ')}</span>`
            : `<i class="fas fa-hourglass-half text-amber-400 mr-1.5 animate-pulse"></i> <span class="text-amber-300"><b>${currentPlayer}</b> ist am Zug...</span>`;

        const playerInput = document.getElementById('player-input');
        const sendBtn = document.getElementById('send-btn');
        const hasPendingRolls = State.pendingRolls && State.pendingRolls.length > 0;
        if (playerInput && !hasPendingRolls) {
            playerInput.disabled = !myTurn;
            playerInput.placeholder = myTurn ? 'Was tut ihr?' : `Warte auf ${currentPlayer}...`;
        }
        if (sendBtn && !hasPendingRolls) {
            sendBtn.disabled = !myTurn;
        }
    },
};
