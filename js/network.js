import Peer from 'peerjs';
import { State, subscribe, dispatch } from './state.js';
import { UI, DOM } from './ui.js';
import { Engine } from './engine.js';
import { Sound } from './sound.js';
import { PartyManager } from './party.js';
import { validateHeroData } from './sanitize.js';

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
    'pendingRolls', 'pendingAbilityLearning', 'quickplayEnabled',
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
    combatActions: {},
    _combatStatus: {},
    playerCharMap: {},
    currentVote: null,
    _mySubmittedAction: null,
    autoPlayers: {},
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
        this.playerName = playerName || 'Host';
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
            this._startHeartbeat();
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
                this.assignCharacters();
                this._sendTo(conn, this._getFullSyncPayload());
                this._updateTurnUI();
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
            this._markDirty();
        });
    },

    join(roomCode, playerName) {
        if (this.peer) this.disconnect();
        this.playerName = playerName || 'Spieler';
        this.roomCode = roomCode.toUpperCase();
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
        this.combatActions = {};
        this._combatStatus = {};
        this.playerCharMap = {};
        this.currentVote = null;
        this._mySubmittedAction = null;
        this.autoPlayers = {};
        State._mpRole = null;
        State._mpMyCharId = null;
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

    sendCharacterCreate(charData) {
        if (!this.isClient() || this.connections.length === 0) return;
        this._sendTo(this.connections[0], {
            type: 'CHARACTER_CREATE',
            charData,
            playerName: this.playerName,
        });
    },

    broadcastState() {
        if (!this.isHost()) return;
        this._markDirty();
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

    // Helper: addChatLog lokal + broadcastSystemChat in einem Schritt (verhindert Doppelnachrichten)
    _sysMsgBroadcast(text) {
        UI.addChatLog('System', text);
        this.broadcastSystemChat('System', text);
    },

    broadcastDiceShow(roll) {
        if (!this.isConnected()) return;
        const msg = { charName: roll.name, dc: roll.dc, mod: roll.mod || 0, diceType: roll.diceType || 'W20' };
        if (this.isHost()) {
            this.connections.forEach(c => this._sendTo(c, { type: 'DICE_SHOW', ...msg }));
        } else if (this.connections.length > 0) {
            this._sendTo(this.connections[0], { type: 'DICE_SHOW_RELAY', ...msg });
        }
    },

    advanceTurn() {
        if (!this.isHost() || this.turnOrder.length <= 1) return;
        this.currentTurnIndex = (this.currentTurnIndex + 1) % this.turnOrder.length;
        this.broadcastTurnState();
        this._updateTurnUI();
        const currentPlayer = this.turnOrder[this.currentTurnIndex];
        if (currentPlayer && this.autoPlayers[currentPlayer]) {
            const char = this._getCharForPlayer(currentPlayer);
            if (char && char.hp > 0) {
                setTimeout(() => {
                    const action = this._generateAutoAction(char);
                    UI.addChatLog(char.name, action);
                    this.connections.forEach(c => {
                        this._sendTo(c, { type: 'PLAYER_CHAT', sender: char.name, text: action });
                    });
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
        }
        this._updateTurnUI();
    },

    executeCombatRound() {
        if (!this.isHost()) return;
        const entries = Object.entries(this.combatActions);
        if (entries.length === 0) return;
        const actions = entries.map(([, d]) => `${d.charName}: ${d.action}`).join('\n');
        this._sysMsgBroadcast(`**Kampfrunde gestartet!** ${entries.length} Aktionen werden ausgeführt...`);
        this.combatActions = {};
        this._mySubmittedAction = null;
        this._broadcastCombatStatus();
        Engine.interactWithAI(`Kampfrunde – Alle Aktionen der Gruppe:\n${actions}\n\nFuehre alle Aktionen gleichzeitig aus. Beschreibe Proben, Ergebnisse, Schaden.`);
    },

    skipPlayer(playerName) {
        if (!this.isHost() || this.combatActions[playerName]) return;
        this.combatActions[playerName] = { action: 'wartet ab (uebersprungen)', charName: playerName };
        this._sysMsgBroadcast(`**${playerName}** wurde übersprungen.`);
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
        if (!this.isHost()) return;
        if (this.autoPlayers[playerName]) {
            delete this.autoPlayers[playerName];
            UI.addChatLog('System', `**${playerName}** wird wieder manuell gesteuert.`);
        } else {
            this.autoPlayers[playerName] = true;
            UI.addChatLog('System', `**${playerName}** wird jetzt automatisch (KI) gesteuert.`);
        }
        this.broadcastSystemChat('System', `**${playerName}** ist jetzt ${this.autoPlayers[playerName] ? 'KI-gesteuert' : 'manuell'}.`);
        this._updateTurnUI();
    },

    _getCharForPlayer(playerName) {
        const charId = this.playerCharMap[playerName];
        return charId ? State.party.find(p => p.id === charId) : null;
    },

    _generateAutoAction(char) {
        const weakestEnemy = State.activeEnemies
            .filter(e => e.hp > 0)
            .sort((a, b) => a.hp - b.hp)[0];
        const hurt = State.party
            .filter(p => p.hp > 0 && !p.isSummon && p.hp < PartyManager.getEffectiveMaxHp(p) * 0.5)
            .sort((a, b) => a.hp / PartyManager.getEffectiveMaxHp(a) - b.hp / PartyManager.getEffectiveMaxHp(b))[0];

        if (!weakestEnemy) return `${char.name} folgt der Gruppe`;

        const cls = (char.class || '').toLowerCase();
        const t = weakestEnemy.name;
        const pick = arr => arr[Math.floor(Math.random() * arr.length)];

        if (cls === 'kleriker' || cls === 'heiler') {
            if (hurt) return pick([
                `${char.name} heilt ${hurt.name}`,
                `${char.name} ruft eine heilige Aura um ${hurt.name}`,
                `${char.name} fleht die Götter um Schutz für ${hurt.name} an`,
            ]);
            return pick([`${char.name} schlägt ${t} mit dem Streitkolben`, `${char.name} ruft die Strafe der Götter auf ${t} herab`]);
        }
        if (cls === 'magier') return pick([
            `${char.name} wirkt einen Feuerball auf ${t}`,
            `${char.name} schleudert Eiskristalle auf ${t}`,
            `${char.name} beschwört arkane Kraft gegen ${t}`,
        ]);
        if (cls === 'krieger') return pick([
            `${char.name} greift ${t} mit voller Wucht an`,
            `${char.name} pariert und kontert ${t}`,
            `${char.name} provoziert ${t} um Verbündete zu schützen`,
        ]);
        if (cls === 'schurke') return pick([
            `${char.name} schleicht sich an ${t} heran und attackiert`,
            `${char.name} wirft ein Messer auf ${t}`,
            `${char.name} trifft ${t} an einem verwundbaren Punkt`,
        ]);
        if (cls.includes('wald')) return pick([
            `${char.name} schießt einen Pfeil auf ${t}`,
            `${char.name} zielt präzise auf ${t}`,
            `${char.name} hetzt seinen tierischen Begleiter auf ${t}`,
        ]);
        return `${char.name} greift ${t} an`;
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
                this.connections.forEach(c => {
                    this._sendTo(c, { type: 'PLAYER_CHAT', sender: char.name, text: action });
                });
                UI.addChatLog(char.name, action);
                submitted = true;
            }
            if (submitted) this._broadcastCombatStatus();
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
            const diceMax = r.diceType === 'W6' ? 6 : (r.diceType === 'W100' ? 100 : 20);
            r.rawRoll = Math.floor(Math.random() * diceMax) + 1;
            r.result = r.rawRoll + (r.mod || 0);
            r.rolled = true;
            rolled = true;
        }
        if (rolled) {
            UI.updateActionBox();
            if (this.isConnected()) this.broadcastState();
        }
    },

    _broadcastCombatStatus() {
        if (!this.isHost()) return;
        this._updateTurnUI();
        this._markDirty();

        // Auto-execute wenn alle menschlichen Spieler ihre Aktion eingereicht haben
        const humanPlayers = this.turnOrder.filter(p => !this.autoPlayers[p]);
        if (humanPlayers.length > 0 && humanPlayers.every(p => this.combatActions[p]) && !State.isProcessing) {
            setTimeout(() => {
                if (humanPlayers.every(p => this.combatActions[p]) && !State.isProcessing) {
                    this.executeCombatRound();
                }
            }, 500);
        }
    },

    registerCharacter(playerName, charId) {
        if (!this.isHost()) return;
        this.playerCharMap[playerName] = charId;
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
        this._sysMsgBroadcast(`**Beute verteilt:**\n${distributed.join('\n')}`);
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
        this._sysMsgBroadcast(`**Abstimmung beendet:** "${chosen}" wurde gewählt.`);
        const msg = { type: 'VOTE_RESULT', chosen, chosenIndex };
        this.connections.forEach(c => this._sendTo(c, msg));
        this.currentVote = null;
        this._updateTurnUI();
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
            case 'COMBAT_ACTION': {
                Sound.play('turn');
                this.combatActions[msg.playerName] = { action: msg.action, charName: msg.charName };
                const combatSender = msg.charName || msg.playerName;
                this.connections.forEach(c => {
                    this._sendTo(c, { type: 'PLAYER_CHAT', sender: combatSender, text: msg.action });
                });
                UI.addChatLog(combatSender, msg.action);
                this._broadcastCombatStatus();
                break;
            }
            case 'CHARACTER_CREATE': {
                try {
                    const char = validateHeroData(msg.charData);
                    if (!State.party.find(p => p.id === char.id)) {
                        State.party.push(char);
                        this._sysMsgBroadcast(`**${msg.playerName}** hat **${char.name}** zur Gruppe hinzugefügt.`);
                        this.registerCharacter(msg.playerName, char.id);
                        this.broadcastState();
                        UI.updateAll();
                    }
                } catch (e) {
                    console.warn('Invalid character data from client:', e);
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
            case 'DICE_RESULT': {
                const roll = State.pendingRolls.find(r => r.id === msg.rollId);
                if (roll) {
                    roll.rolled = true;
                    roll.result = msg.result;
                    roll.rawRoll = msg.rawRoll;
                    UI.updateActionBox();
                    this._markDirty();
                    // Auto-submit wenn alle Würfe erledigt sind
                    if (State.pendingRolls.length > 0 && State.pendingRolls.every(r => r.rolled) && !State.isProcessing) {
                        setTimeout(() => {
                            if (State.pendingRolls.every(r => r.rolled) && !State.isProcessing) {
                                Engine.submitPendingRolls();
                            }
                        }, 800);
                    }
                }
                break;
            }
            case 'DICE_SHOW_RELAY': {
                // Client sendet Würfel-Show-Anfrage → Host zeigt Animation und leitet an andere weiter
                UI.showAnimatedDiceModal(msg.charName, msg.dc, msg.mod, null, true, msg.diceType, true);
                this.connections.forEach(c => {
                    if (c !== conn) this._sendTo(c, { type: 'DICE_SHOW', charName: msg.charName, dc: msg.dc, mod: msg.mod, diceType: msg.diceType });
                });
                break;
            }
            case 'REQUEST_SYNC': {
                this._sendTo(conn, this._getFullSyncPayload());
                break;
            }
            default:
                console.warn('Unknown client message:', msg.type);
        }
    },

    _applyStateSync(incoming) {
        const wasStarted = State.gameStarted;
        SYNC_KEYS.forEach(k => {
            if (incoming[k] === undefined) return;
            if (k === 'pendingRolls' && Array.isArray(incoming[k])) {
                State[k] = incoming[k].map(r => {
                    const local = State.pendingRolls.find(lr => lr.id === r.id);
                    return (local && local.rolled && !r.rolled) ? local : r;
                });
            } else {
                State[k] = incoming[k];
            }
        });
        if (State.gameStarted && !wasStarted) UI.toggleViews(true);
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
                State._mpMyCharId = this.playerCharMap[this.playerName] || null;
                this._combatStatus = msg.combatSubmitted || {};
                this._mySubmittedAction = this._combatStatus[this.playerName] ? { submitted: true } : null;
                this.currentVote = msg.vote || null;
                State.isProcessing = !!msg.isProcessing;
                UI.showLoader(!!msg.isProcessing);
                UI.updateAll();
                this._updateTurnUI();
                break;
            }
            case 'STATE_SYNC': {
                this._applyStateSync(msg.state);
                UI.updateAll();
                this._updateTurnUI();
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
                this._updateTurnUI();
                break;
            }
            case 'COMBAT_STATUS': {
                this._combatStatus = msg.submitted || {};
                this._mySubmittedAction = this._combatStatus[this.playerName] ? { submitted: true } : null;
                this._updateTurnUI();
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
                UI.addChatLog('System', `**Abstimmung beendet:** "${msg.chosen}" wurde gewählt.`);
                this.currentVote = null;
                this._updateTurnUI();
                break;
            }
            case 'DICE_SHOW': {
                // Ein anderer Spieler würfelt – Animation im Zuschauermodus anzeigen
                UI.showAnimatedDiceModal(msg.charName, msg.dc, msg.mod, null, true, msg.diceType, true);
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
            const roleLabel = this.isHost() ? 'Host' : 'Spieler';
            const playersList = this.isHost()
                ? this.connections.map(c => `<li class="text-green-300 text-xs"><i class="fas fa-user mr-1"></i> ${c.metadata?.name || 'Unbekannt'}</li>`).join('')
                : '';

            content.innerHTML = `
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
            </div>`;
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
            playerInput.disabled = submitted || State.isProcessing;
            sendBtn.disabled = submitted || State.isProcessing;
            playerInput.placeholder = submitted
                ? 'Aktion eingereicht – warte auf andere...'
                : 'Deine Kampfaktion eingeben...';
            this._setQuickActionsEnabled(false);
            return;
        }

        if (hasPendingRolls) {
            el.classList.remove('hidden');
            el.className = 'relative text-[11px] px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg backdrop-blur-sm text-center tracking-wide';
            if (this.isClient()) {
                const myChar = State._mpMyCharId ? State.party.find(p => p.id === State._mpMyCharId) : null;
                const hasOwnRolls = myChar && State.pendingRolls.some(r => !r.rolled && r.name === myChar.name);
                el.innerHTML = (hasOwnRolls
                    ? '<i class="fas fa-dice-d20 text-green-400 mr-1.5 animate-pulse"></i> <span class="text-green-300 font-bold">Deine Proben wuerfeln!</span>'
                    : '<i class="fas fa-dice-d20 text-amber-400 mr-1.5 animate-pulse"></i> <span class="text-amber-300">Warte auf Probenergebnisse...</span>')
                    + this._syncBtnHtml;
            } else {
                el.innerHTML = '<i class="fas fa-dice-d20 text-indigo-400 mr-1.5 animate-pulse"></i> <span class="text-indigo-300 font-bold">Proben ausstehend...</span>' + this._syncBtnHtml;
            }
            playerInput.disabled = true;
            sendBtn.disabled = true;
            this._setQuickActionsEnabled(false);
            return;
        }

        const currentPlayer = this.turnOrder[this.currentTurnIndex] || '';
        const myTurn = this.isMyTurn();
        el.classList.remove('hidden');
        el.className = 'relative text-[11px] px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg backdrop-blur-sm text-center tracking-wide';
        const voteBtn = this.isHost() ? ' <button data-action="mp-start-vote" class="ml-2 text-purple-400 hover:text-purple-300 transition-colors" title="Abstimmung starten"><i class="fas fa-poll"></i></button>' : '';
        const isAutoTurn = this.autoPlayers[currentPlayer];
        const turnOrderHtml = this.turnOrder.map(p => {
            const isAuto = this.autoPlayers[p];
            const label = isAuto ? `<span class="text-cyan-400">${p} <i class="fas fa-robot text-[8px]"></i></span>` : p;
            return p === this.playerName ? `<b>${label}</b>` : label;
        }).join(' \u2192 ');
        const autoToggleHtml = this.isHost() ? this.turnOrder.filter(p => p !== this.playerName).map(p => {
            const isAuto = !!this.autoPlayers[p];
            return `<button data-action="mp-toggle-auto" data-player="${p}" class="text-[9px] px-1.5 py-0.5 rounded ${isAuto ? 'bg-cyan-900/40 text-cyan-400 border border-cyan-500/30' : 'bg-slate-800/60 text-slate-500 border border-slate-600/30'} hover:text-cyan-300 transition-all" title="${p}: KI ${isAuto ? 'aus' : 'an'}"><i class="fas fa-robot mr-0.5"></i>${p}</button>`;
        }).join(' ') : '';
        el.innerHTML = this._syncBtnHtml + (myTurn
            ? `<i class="fas fa-arrow-right text-green-400 mr-1.5"></i> <span class="text-green-300 font-bold">Dein Zug!</span>${voteBtn}`
            : `<i class="fas fa-hourglass-half text-amber-400 mr-1.5 animate-pulse"></i> <span class="text-amber-300"><b>${currentPlayer}</b>${isAutoTurn ? ' <i class="fas fa-robot text-[9px]"></i>' : ''} ist am Zug...</span>`)
            + `<div class="text-slate-500 text-[9px] mt-1">${turnOrderHtml}</div>`
            + (autoToggleHtml ? `<div class="flex flex-wrap gap-1 mt-1.5 justify-center">${autoToggleHtml}</div>` : '');
        playerInput.disabled = !myTurn || State.isProcessing;
        sendBtn.disabled = !myTurn || State.isProcessing;
        playerInput.placeholder = myTurn ? 'Was tut ihr?' : `Warte auf ${currentPlayer}...`;
        this._setQuickActionsEnabled(myTurn);
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
            const isAuto = !!this.autoPlayers[p];
            const icon = isAuto
                ? '<i class="fas fa-robot text-cyan-400"></i>'
                : done
                    ? '<i class="fas fa-check-circle text-green-400"></i>'
                    : '<i class="fas fa-hourglass-half text-amber-400 animate-pulse"></i>';
            const nameClass = isMe ? 'text-cyan-300 font-bold' : (isAuto ? 'text-cyan-400' : 'text-slate-300');
            const autoLabel = isAuto ? ' <span class="text-[8px] text-cyan-500">(KI)</span>' : '';
            let actions = '';
            if (this.isHost() && !isMe) {
                const autoBtn = `<button data-action="mp-toggle-auto" data-player="${p}" class="text-[9px] ${isAuto ? 'text-cyan-400 hover:text-cyan-300' : 'text-slate-500 hover:text-cyan-400'} ml-1" title="${isAuto ? 'KI deaktivieren' : 'KI aktivieren'}"><i class="fas fa-robot"></i></button>`;
                const skipBtn = !done && !isAuto
                    ? ` <button data-action="mp-skip-player" data-player="${p}" class="text-[9px] text-red-400 hover:text-red-300 ml-1 underline">Skip</button>`
                    : '';
                actions = autoBtn + skipBtn;
            }
            return `<div class="flex items-center gap-1.5 text-[10px]">${icon} <span class="${nameClass}">${isMe ? 'Du' : p}</span>${autoLabel}${actions}</div>`;
        }).join('');

        const canExecute = submittedCount > 0 && !State.isProcessing;
        const executeBtn = this.isHost()
            ? `<button data-action="mp-execute-round" class="mt-2 w-full ${canExecute ? 'bg-red-700 hover:bg-red-600 border-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.3)]' : 'bg-slate-700 border-slate-600 opacity-50 cursor-not-allowed'} text-white py-1.5 rounded-lg text-[10px] font-bold border transition-all" ${canExecute ? '' : 'disabled'}><i class="fas fa-fist-raised mr-1"></i> Runde ausfuehren (${submittedCount}/${totalPlayers})</button>`
            : '';

        el.innerHTML = `${this._syncBtnHtml}<div class="text-left space-y-1.5">
            <div class="flex items-center gap-2 mb-1">
                <i class="fas fa-khanda text-red-400"></i>
                <span class="text-red-300 font-bold text-[11px] uppercase tracking-wider">Kampfrunde</span>
                <span class="text-slate-500 text-[9px] ml-auto">${submittedCount}/${totalPlayers} bereit</span>
            </div>
            <div class="space-y-1 pl-1">${playersHtml}</div>
            ${executeBtn}
        </div>`;
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

        el.innerHTML = `<div class="text-left space-y-1.5">
            <div class="flex items-center gap-2 mb-1">
                <i class="fas fa-poll text-purple-400"></i>
                <span class="text-purple-300 font-bold text-[11px] uppercase tracking-wider">Abstimmung</span>
                <span class="text-slate-500 text-[9px] ml-auto">${Object.keys(vote.votes).length}/${this.turnOrder.length}</span>
            </div>
            <p class="text-slate-200 text-[11px] font-medium">${vote.question}</p>
            <div class="space-y-1">${optionsHtml}</div>
            ${resolveBtn}
        </div>`;
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
            '[data-action="ask-party-member"]',
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
