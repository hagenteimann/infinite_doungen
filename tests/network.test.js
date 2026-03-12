import { describe, it, expect, beforeEach, vi } from 'vitest';
import { State, subscribe } from '../js/state.js';

vi.mock('peerjs', () => ({ default: vi.fn() }));
vi.mock('../js/ui.js', () => ({
    UI: {
        addChatLog: vi.fn(),
        updateAll: vi.fn(),
        updateActionBox: vi.fn(),
        showLoader: vi.fn(),
        toggleViews: vi.fn(),
        renderTransientEvents: vi.fn(),
        showTransientEvent: vi.fn(),
        showNetworkDiceAnimation: vi.fn(),
        closeEnemyLightbox: vi.fn(),
    },
    DOM: {
        storyLog: { appendChild: vi.fn(), scrollTop: 0, scrollHeight: 0, querySelector: vi.fn(() => null) },
        actingChar: { value: 'party' },
        playerInput: { disabled: false, placeholder: '' },
        sendBtn: { disabled: false },
        actionBoxContainer: { innerHTML: '', classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn() } },
    },
}));
vi.mock('../js/engine.js', () => ({
    Engine: { interactWithAI: vi.fn(), submitPlayerAction: vi.fn() },
}));
vi.mock('../js/sound.js', () => ({
    Sound: { play: vi.fn() },
}));
vi.mock('../js/sanitize.js', () => ({
    validateHeroData: vi.fn(d => d),
    sanitize: vi.fn(h => h),
    sanitizeStrict: vi.fn(h => h),
}));
vi.mock('../js/features.js', () => ({
    Weather: { apply: vi.fn() },
    WEATHER_TYPES: [],
}));

const { Network } = await import('../js/network.js');
const { UI } = await import('../js/ui.js');
const { Engine } = await import('../js/engine.js');

// Decoupled UI sync (mirrors main.js)
subscribe((_state, action) => {
    if (action.type === 'ADD_CHAT_MSG' || action.type === 'ADD_SYSTEM_MSG') {
        UI.addChatLog(action.entry, null, { persist: false });
    }
});

function resetNetwork() {
    Network.peer = null;
    Network.connections = [];
    Network.role = null;
    Network.roomCode = null;
    Network.playerName = '';
    Network.connState = 'idle';
    Network._unsubscribe = null;
    Network._connectTimer = null;
    Network._lastError = '';
    Network.turnOrder = [];
    Network.currentTurnIndex = 0;
    Network.combatActions = {};
    Network._combatStatus = {};
    Network.playerCharMap = {};
    Network.currentVote = null;
    Network._mySubmittedAction = null;
    Network.autoPlayers = {};
    Network._idCounter = 0;
    Network._seenMessageIds = new Set();
    Network._seenEventIds = new Set();
}

function resetState() {
    State.party = [];
    State.activeEnemies = [];
    State.defeatedEnemies = [];
    State.lootDrops = [];
    State.gold = 0;
    State.pendingRolls = [];
    State.gameStarted = false;
    State.combatEnded = false;
    State.isProcessing = false;
    State._mpRole = null;
    State._mpMyCharId = null;
    State.quickplayEnabled = false;
    State.chatMessages = [];
    State.systemMessages = [];
    State.transientEvents = [];
    State.playerControlMode = {};
    State.dmControlMode = 'human';
    State.afkSince = {};
}

function makeChar(overrides = {}) {
    return {
        id: 'hero-1', name: 'Gimli', class: 'Krieger',
        level: 1, xp: 0, hp: 20, maxHp: 20,
        attributes: { STR: 14, DEX: 8, INT: 8, CON: 14 },
        equipment: [], inventory: [], isSummon: false,
        ...overrides,
    };
}

function makeEnemy(overrides = {}) {
    return {
        id: 'enemy-1', name: 'Goblin', hp: 15, maxHp: 15,
        desc: '', loggedDefeat: false, portrait: '',
        ...overrides,
    };
}

beforeEach(() => {
    resetNetwork();
    resetState();
    vi.clearAllMocks();
});

// ──────────────────────────────────────────
// Role & state getters
// ──────────────────────────────────────────

describe('isHost / isClient / isConnected', () => {
    it('returns false for all when disconnected', () => {
        expect(Network.isHost()).toBe(false);
        expect(Network.isClient()).toBe(false);
        expect(Network.isConnected()).toBe(false);
    });

    it('identifies host role', () => {
        Network.role = 'host';
        expect(Network.isHost()).toBe(true);
        expect(Network.isClient()).toBe(false);
    });

    it('identifies client role', () => {
        Network.role = 'client';
        expect(Network.isClient()).toBe(true);
        expect(Network.isHost()).toBe(false);
    });

    it('identifies connected state', () => {
        Network.connState = 'connected';
        expect(Network.isConnected()).toBe(true);
        Network.connState = 'idle';
        expect(Network.isConnected()).toBe(false);
    });
});

// ──────────────────────────────────────────
// isInCombat
// ──────────────────────────────────────────

describe('isInCombat', () => {
    it('returns false when not connected', () => {
        Network.turnOrder = ['A', 'B'];
        State.activeEnemies = [makeEnemy()];
        expect(Network.isInCombat()).toBe(false);
    });

    it('returns false with single player', () => {
        Network.connState = 'connected';
        Network.turnOrder = ['Host'];
        State.activeEnemies = [makeEnemy()];
        expect(Network.isInCombat()).toBe(false);
    });

    it('returns false with no enemies', () => {
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'Player1'];
        State.activeEnemies = [];
        expect(Network.isInCombat()).toBe(false);
    });

    it('returns true when connected, multiple players, and active enemies', () => {
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'Player1'];
        State.activeEnemies = [makeEnemy()];
        expect(Network.isInCombat()).toBe(true);
    });
});

// ──────────────────────────────────────────
// isMyTurn
// ──────────────────────────────────────────

describe('isMyTurn', () => {
    it('returns true when not connected', () => {
        expect(Network.isMyTurn()).toBe(true);
    });

    it('returns true when single player', () => {
        Network.connState = 'connected';
        Network.turnOrder = ['Solo'];
        expect(Network.isMyTurn()).toBe(true);
    });

    it('returns true during exploration when current turn matches playerName', () => {
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'Player1'];
        Network.currentTurnIndex = 0;
        Network.playerName = 'Host';
        expect(Network.isMyTurn()).toBe(true);
    });

    it('returns false during exploration when not my turn', () => {
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'Player1'];
        Network.currentTurnIndex = 1;
        Network.playerName = 'Host';
        expect(Network.isMyTurn()).toBe(false);
    });

    it('returns true in combat when action not yet submitted', () => {
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'Player1'];
        Network.playerName = 'Host';
        State.activeEnemies = [makeEnemy()];
        Network._mySubmittedAction = null;
        expect(Network.isMyTurn()).toBe(true);
    });

    it('returns false in combat when action already submitted', () => {
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'Player1'];
        Network.playerName = 'Host';
        State.activeEnemies = [makeEnemy()];
        Network._mySubmittedAction = { action: 'attack', charName: 'Gimli' };
        expect(Network.isMyTurn()).toBe(false);
    });
});

// ──────────────────────────────────────────
// getMyCharId
// ──────────────────────────────────────────

describe('getMyCharId', () => {
    it('returns null when no mapping exists', () => {
        Network.playerName = 'Host';
        expect(Network.getMyCharId()).toBeNull();
    });

    it('returns the mapped char id', () => {
        Network.playerName = 'Host';
        Network.playerCharMap = { Host: 'hero-1' };
        expect(Network.getMyCharId()).toBe('hero-1');
    });
});

// ──────────────────────────────────────────
// generateRoomCode
// ──────────────────────────────────────────

describe('generateRoomCode', () => {
    it('returns a 6-character uppercase string', () => {
        const code = Network.generateRoomCode();
        expect(code).toHaveLength(6);
        expect(code).toMatch(/^[A-Z0-9]+$/);
    });

    it('generates different codes', () => {
        const codes = new Set(Array.from({ length: 20 }, () => Network.generateRoomCode()));
        expect(codes.size).toBeGreaterThan(1);
    });
});

// ──────────────────────────────────────────
// assignCharacters
// ──────────────────────────────────────────

describe('registerCharacter', () => {
    it('does nothing when not host', () => {
        Network.role = 'client';
        Network.registerCharacter('Player1', 'c1');
        expect(Network.playerCharMap).toEqual({});
    });

    it('maps a player to a character explicitly', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.playerName = 'Host';
        Network.connections = [];
        Network.registerCharacter('Host', 'c1');
        expect(Network.playerCharMap['Host']).toBe('c1');
        expect(State._mpMyCharId).toBe('c1');
    });

    it('maps a different player without affecting host _mpMyCharId', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.playerName = 'Host';
        Network.connections = [];
        Network.registerCharacter('Player1', 'c2');
        expect(Network.playerCharMap['Player1']).toBe('c2');
        expect(State._mpMyCharId).toBeNull();
    });

    it('marks dirty for sync broadcast', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.playerName = 'Host';
        Network.connections = [];
        Network._syncDirty = false;
        Network.registerCharacter('Host', 'c1');
        expect(Network._syncDirty).toBe(true);
    });
});

describe('assignCharacters', () => {
    it('does nothing when not host', () => {
        Network.role = 'client';
        Network.assignCharacters();
        expect(Network.playerCharMap).toEqual({});
    });

    it('preserves existing explicit mappings', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.playerName = 'Host';
        Network.turnOrder = ['Host', 'Player1'];
        Network.connections = [];
        State.party = [
            makeChar({ id: 'c1', name: 'Gimli' }),
            makeChar({ id: 'c2', name: 'Legolas' }),
        ];
        Network.playerCharMap = { Host: 'c1', Player1: 'c2' };
        Network.assignCharacters();
        expect(Network.playerCharMap['Host']).toBe('c1');
        expect(Network.playerCharMap['Player1']).toBe('c2');
        expect(State._mpMyCharId).toBe('c1');
    });

    it('removes mappings for disconnected players', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.playerName = 'Host';
        Network.turnOrder = ['Host'];
        Network.connections = [];
        State.party = [makeChar({ id: 'c1' })];
        Network.playerCharMap = { Host: 'c1', LeftPlayer: 'c2' };
        Network.assignCharacters();
        expect(Network.playerCharMap['LeftPlayer']).toBeUndefined();
        expect(Network.playerCharMap['Host']).toBe('c1');
    });

    it('removes mappings for deleted characters', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.playerName = 'Host';
        Network.turnOrder = ['Host', 'Player1'];
        Network.connections = [];
        State.party = [makeChar({ id: 'c1' })];
        Network.playerCharMap = { Host: 'c1', Player1: 'deleted-id' };
        Network.assignCharacters();
        expect(Network.playerCharMap['Player1']).toBeUndefined();
    });
});

// ──────────────────────────────────────────
// _getCharForPlayer
// ──────────────────────────────────────────

describe('_getCharForPlayer', () => {
    it('returns null when player has no mapping', () => {
        expect(Network._getCharForPlayer('Nobody')).toBeNull();
    });

    it('returns undefined when mapped id not in party', () => {
        Network.playerCharMap = { Host: 'nonexistent' };
        expect(Network._getCharForPlayer('Host')).toBeUndefined();
    });

    it('returns the character object', () => {
        const char = makeChar({ id: 'c1' });
        State.party = [char];
        Network.playerCharMap = { Host: 'c1' };
        expect(Network._getCharForPlayer('Host')).toBe(char);
    });
});

// ──────────────────────────────────────────
// _generateAutoAction
// ──────────────────────────────────────────

describe('_generateAutoAction', () => {
    it('warrior attacks enemy in combat', () => {
        State.activeEnemies = [makeEnemy({ name: 'Orc' })];
        const action = Network._generateAutoAction(makeChar({ name: 'Gimli', class: 'Krieger' }));
        expect(action).toContain('Gimli');
        expect(action).toContain('Orc');
        expect(action.toLowerCase()).toContain('greift');
    });

    it('healer heals injured ally instead of attacking', () => {
        State.activeEnemies = [makeEnemy()];
        State.party = [
            makeChar({ id: 'c1', name: 'Gimli', hp: 5, maxHp: 20 }),
            makeChar({ id: 'c2', name: 'Jose', class: 'Kleriker', hp: 20, maxHp: 20 }),
        ];
        const action = Network._generateAutoAction(
            makeChar({ name: 'Jose', class: 'Kleriker' })
        );
        expect(action).toContain('heilt');
        expect(action).toContain('Gimli');
    });

    it('healer attacks when nobody is hurt', () => {
        State.activeEnemies = [makeEnemy({ name: 'Goblin' })];
        State.party = [
            makeChar({ id: 'c1', name: 'Gimli', hp: 20, maxHp: 20 }),
        ];
        const action = Network._generateAutoAction(
            makeChar({ name: 'Jose', class: 'Kleriker' })
        );
        expect(action).toContain('Goblin');
    });

    it('mage casts spell in combat', () => {
        State.activeEnemies = [makeEnemy({ name: 'Dragon' })];
        const action = Network._generateAutoAction(
            makeChar({ name: 'Gandalf', class: 'Magier' })
        );
        expect(action).toContain('Zauber');
        expect(action).toContain('Dragon');
    });

    it('ranger shoots in combat', () => {
        State.activeEnemies = [makeEnemy({ name: 'Wolf' })];
        const action = Network._generateAutoAction(
            makeChar({ name: 'Legolas', class: 'Waldläufer' })
        );
        expect(action).toContain('Pfeil');
    });

    it('rogue sneaks in combat', () => {
        State.activeEnemies = [makeEnemy({ name: 'Thief' })];
        const action = Network._generateAutoAction(
            makeChar({ name: 'Shadow', class: 'Schurke' })
        );
        expect(action).toContain('schleicht');
    });

    it('follows the group when no enemies', () => {
        State.activeEnemies = [];
        const action = Network._generateAutoAction(makeChar({ name: 'Gimli' }));
        expect(action).toContain('folgt der Gruppe');
    });

    it('defends when enemies present but all dead', () => {
        State.activeEnemies = [makeEnemy({ hp: 0 })];
        const action = Network._generateAutoAction(makeChar({ name: 'Gimli' }));
        expect(action).toContain('folgt der Gruppe');
    });
});

// ──────────────────────────────────────────
// autoRollPending
// ──────────────────────────────────────────

describe('autoRollPending', () => {
    it('does nothing when not host', () => {
        Network.role = 'client';
        State.pendingRolls = [{ id: 'r1', name: 'Gimli', rolled: false, mod: 2, diceType: 'W20' }];
        Network.autoRollPending();
        expect(State.pendingRolls[0].rolled).toBe(false);
    });

    it('does nothing when no auto-players', () => {
        Network.role = 'host';
        Network.autoPlayers = {};
        State.pendingRolls = [{ id: 'r1', name: 'Gimli', rolled: false, mod: 2, diceType: 'W20' }];
        Network.autoRollPending();
        expect(State.pendingRolls[0].rolled).toBe(false);
    });

    it('rolls dice for auto-player characters', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.autoPlayers = { Player1: true };
        Network.playerCharMap = { Player1: 'c1' };
        State.party = [makeChar({ id: 'c1', name: 'Gimli' })];
        State.pendingRolls = [
            { id: 'r1', name: 'Gimli', rolled: false, mod: 2, diceType: 'W20', dc: 12 },
        ];
        Network.autoRollPending();
        const roll = State.pendingRolls[0];
        expect(roll.rolled).toBe(true);
        expect(roll.rawRoll).toBeGreaterThanOrEqual(1);
        expect(roll.rawRoll).toBeLessThanOrEqual(20);
        expect(roll.result).toBe(roll.rawRoll + 2);
    });

    it('uses correct dice max for W6', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.autoPlayers = { P1: true };
        Network.playerCharMap = { P1: 'c1' };
        State.party = [makeChar({ id: 'c1', name: 'Gimli' })];
        State.pendingRolls = [
            { id: 'r1', name: 'Gimli', rolled: false, mod: 0, diceType: 'W6', dc: 4 },
        ];
        Network.autoRollPending();
        expect(State.pendingRolls[0].rawRoll).toBeLessThanOrEqual(6);
    });

    it('uses correct dice max for W100', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.autoPlayers = { P1: true };
        Network.playerCharMap = { P1: 'c1' };
        State.party = [makeChar({ id: 'c1', name: 'Gimli' })];
        State.pendingRolls = [
            { id: 'r1', name: 'Gimli', rolled: false, mod: 5, diceType: 'W100', dc: 50 },
        ];
        Network.autoRollPending();
        expect(State.pendingRolls[0].rawRoll).toBeLessThanOrEqual(100);
    });

    it('skips already rolled dice', () => {
        Network.role = 'host';
        Network.autoPlayers = { P1: true };
        Network.playerCharMap = { P1: 'c1' };
        State.party = [makeChar({ id: 'c1', name: 'Gimli' })];
        State.pendingRolls = [
            { id: 'r1', name: 'Gimli', rolled: true, rawRoll: 15, result: 17, mod: 2, diceType: 'W20' },
        ];
        Network.autoRollPending();
        expect(State.pendingRolls[0].rawRoll).toBe(15);
    });

    it('skips rolls for non-auto characters', () => {
        Network.role = 'host';
        Network.autoPlayers = { P1: true };
        Network.playerCharMap = { P1: 'c1' };
        State.party = [
            makeChar({ id: 'c1', name: 'Gimli' }),
            makeChar({ id: 'c2', name: 'Legolas' }),
        ];
        State.pendingRolls = [
            { id: 'r1', name: 'Legolas', rolled: false, mod: 3, diceType: 'W20' },
        ];
        Network.autoRollPending();
        expect(State.pendingRolls[0].rolled).toBe(false);
    });
});

// ──────────────────────────────────────────
// toggleAutoPlayer
// ──────────────────────────────────────────

describe('toggleAutoPlayer', () => {
    it('does nothing when not host', () => {
        Network.role = 'client';
        Network.toggleAutoPlayer('Player1');
        expect(Network.autoPlayers).toEqual({});
    });

    it('enables auto for a player', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.turnOrder = [];
        Network.toggleAutoPlayer('Player1');
        expect(Network.autoPlayers['Player1']).toBe(true);
        expect(UI.addChatLog).toHaveBeenCalled();
        expect(UI.addChatLog.mock.calls[0][0]).toEqual(expect.objectContaining({ sender: 'System' }));
        expect(UI.addChatLog.mock.calls[0][0].text).toContain('KI-gesteuert');
    });

    it('disables auto for a player on second toggle', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.turnOrder = [];
        Network.autoPlayers = { Player1: true };
        Network.toggleAutoPlayer('Player1');
        expect(Network.autoPlayers['Player1']).toBeUndefined();
        expect(UI.addChatLog).toHaveBeenCalled();
        expect(UI.addChatLog.mock.calls[0][0]).toEqual(expect.objectContaining({ sender: 'System' }));
        expect(UI.addChatLog.mock.calls[0][0].text).toContain('manuell');
    });
});

// ──────────────────────────────────────────
// skipPlayer
// ──────────────────────────────────────────

describe('skipPlayer', () => {
    it('does nothing when not host', () => {
        Network.role = 'client';
        Network.skipPlayer('Player1');
        expect(Network.combatActions).toEqual({});
    });

    it('does nothing if player already submitted', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.turnOrder = ['Host', 'Player1'];
        Network.combatActions = { Player1: { action: 'attack', charName: 'Gimli' } };
        Network.skipPlayer('Player1');
        expect(Network.combatActions['Player1'].action).toBe('attack');
    });

    it('marks player as skipped', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.turnOrder = ['Host', 'Player1'];
        Network.combatActions = {};
        Network.skipPlayer('Player1');
        expect(Network.combatActions['Player1'].action).toContain('uebersprungen');
        const sysMsg = (State.systemMessages || []).find(m => m.text && m.text.includes('Player1'));
        expect(sysMsg).toBeDefined();
    });
});

// ──────────────────────────────────────────
// startNewCombatRound
// ──────────────────────────────────────────

describe('startNewCombatRound', () => {
    it('does nothing when not host', () => {
        Network.role = 'client';
        Network.combatActions = { Host: { action: 'x' } };
        Network.startNewCombatRound();
        expect(Network.combatActions).toEqual({ Host: { action: 'x' } });
    });

    it('clears combat actions and submitted action', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.turnOrder = ['Host'];
        Network.combatActions = { Host: { action: 'attack', charName: 'Gimli' } };
        Network._mySubmittedAction = { action: 'attack' };
        State.activeEnemies = [];
        Network.startNewCombatRound();
        expect(Network.combatActions).toEqual({});
        expect(Network._mySubmittedAction).toBeNull();
    });
});

// ──────────────────────────────────────────
// Voting
// ──────────────────────────────────────────

describe('startVote', () => {
    it('does nothing when not host', () => {
        Network.role = 'client';
        Network.startVote('Where to go?', ['Left', 'Right']);
        expect(Network.currentVote).toBeNull();
    });

    it('creates a vote with question and options', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.turnOrder = ['Host'];
        Network.startVote('Where to go?', ['Left', 'Right']);
        expect(Network.currentVote).not.toBeNull();
        expect(Network.currentVote.question).toBe('Where to go?');
        expect(Network.currentVote.options).toEqual(['Left', 'Right']);
        expect(Network.currentVote.votes).toEqual({});
        expect(Network.currentVote.resolved).toBe(false);
    });
});

describe('castVote', () => {
    beforeEach(() => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.turnOrder = ['Host'];
        Network.playerName = 'Host';
        Network.currentVote = {
            question: 'Q?',
            options: ['A', 'B'],
            votes: {},
            resolved: false,
        };
    });

    it('records vote for current player (host)', () => {
        Network.castVote(1);
        expect(Network.currentVote.votes['Host']).toBe(1);
    });

    it('does nothing when no active vote', () => {
        Network.currentVote = null;
        Network.castVote(0);
        expect(Network.currentVote).toBeNull();
    });

    it('does nothing when vote is resolved', () => {
        Network.currentVote.resolved = true;
        Network.castVote(0);
        expect(Network.currentVote.votes).toEqual({});
    });
});

describe('resolveVote', () => {
    it('resolves vote and marks it resolved', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.turnOrder = ['Host'];
        Network.playerName = 'Host';
        Network.currentVote = {
            question: 'Q?',
            options: ['Links', 'Rechts'],
            votes: { Host: 0 },
            resolved: false,
        };
        Network.resolveVote(0);
        expect(Network.currentVote).toBeNull();
        expect(UI.addChatLog).toHaveBeenCalledWith(
            'System',
            expect.stringContaining('Links')
        );
    });

    it('does nothing when not host', () => {
        Network.role = 'client';
        Network.currentVote = {
            question: 'Q?', options: ['A'], votes: {}, resolved: false,
        };
        Network.resolveVote(0);
        expect(Network.currentVote).not.toBeNull();
    });
});

// ──────────────────────────────────────────
// autoDistributeLoot
// ──────────────────────────────────────────

describe('autoDistributeLoot', () => {
    it('does nothing when not host', () => {
        Network.role = 'client';
        State.lootDrops = ['Sword'];
        Network.autoDistributeLoot();
        expect(State.lootDrops).toEqual(['Sword']);
    });

    it('distributes loot among living non-summon party members', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        const c1 = makeChar({ id: 'c1', name: 'Gimli', hp: 10, inventory: [] });
        const c2 = makeChar({ id: 'c2', name: 'Legolas', hp: 15, inventory: [] });
        const dead = makeChar({ id: 'c3', name: 'Ghost', hp: 0, inventory: [] });
        const summon = makeChar({ id: 's1', name: 'Wolf', isSummon: true, hp: 10, inventory: [] });
        State.party = [c1, c2, dead, summon];
        State.lootDrops = ['Sword', 'Shield', 'Potion'];
        Network.autoDistributeLoot();
        expect(State.lootDrops).toEqual([]);
        const totalItems = c1.inventory.length + c2.inventory.length;
        expect(totalItems).toBe(3);
        expect(dead.inventory).toEqual([]);
        expect(summon.inventory).toEqual([]);
    });

    it('gives all loot to single living member', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        const c1 = makeChar({ id: 'c1', name: 'Solo', hp: 10, inventory: [] });
        State.party = [c1];
        State.lootDrops = ['A', 'B'];
        Network.autoDistributeLoot();
        expect(c1.inventory).toEqual(['A', 'B']);
    });
});

// ──────────────────────────────────────────
// _getSyncState
// ──────────────────────────────────────────

describe('_getSyncState', () => {
    it('returns a deep copy of sync keys', () => {
        State.party = [makeChar()];
        State.gold = 42;
        State.quickplayEnabled = true;
        const sync = Network._getSyncState();
        expect(sync.party).toHaveLength(1);
        expect(sync.gold).toBe(42);
        expect(sync.quickplayEnabled).toBe(true);
        sync.party[0].name = 'Modified';
        expect(State.party[0].name).toBe('Gimli');
    });

    it('includes all expected sync keys', () => {
        const sync = Network._getSyncState();
        const expectedKeys = [
            'party', 'activeEnemies', 'defeatedEnemies', 'lootDrops',
            'lastStoryPart', 'gameStarted', 'combatEnded', 'activeMerchant',
            'pendingRolls', 'quickplayEnabled',
        ];
        for (const key of expectedKeys) {
            expect(sync).toHaveProperty(key);
        }
    });
});

// ──────────────────────────────────────────
// disconnect cleanup
// ──────────────────────────────────────────

describe('disconnect', () => {
    it('resets all network state', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.roomCode = 'ABC123';
        Network.turnOrder = ['Host', 'P1'];
        Network.combatActions = { Host: {} };
        Network.autoPlayers = { P1: true };
        Network.playerCharMap = { Host: 'c1' };
        Network.currentVote = { question: 'Q?' };
        Network._mySubmittedAction = { action: 'x' };
        State._mpRole = 'host';
        State._mpMyCharId = 'c1';

        Network.disconnect();

        expect(Network.role).toBeNull();
        expect(Network.roomCode).toBeNull();
        expect(Network.turnOrder).toEqual([]);
        expect(Network.combatActions).toEqual({});
        expect(Network.autoPlayers).toEqual({});
        expect(Network.playerCharMap).toEqual({});
        expect(Network.currentVote).toBeNull();
        expect(Network._mySubmittedAction).toBeNull();
        expect(Network.connState).toBe('idle');
        expect(State._mpRole).toBeNull();
        expect(State._mpMyCharId).toBeNull();
    });
});

// ──────────────────────────────────────────
// submitCombatAction
// ──────────────────────────────────────────

describe('submitCombatAction', () => {
    it('does nothing if already submitted', () => {
        Network._mySubmittedAction = { action: 'old' };
        Network.submitCombatAction('new action', 'Gimli');
        expect(Network._mySubmittedAction.action).toBe('old');
    });

    it('stores action locally for host', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.turnOrder = ['Host'];
        Network.playerName = 'Host';
        Network._mySubmittedAction = null;
        Network.submitCombatAction('attacks Goblin', 'Gimli');
        expect(Network._mySubmittedAction).toEqual({ action: 'attacks Goblin', charName: 'Gimli' });
        expect(Network.combatActions['Host']).toEqual({ action: 'attacks Goblin', charName: 'Gimli' });
    });

    it('sends to host for client', () => {
        Network.role = 'client';
        Network.connState = 'connected';
        const mockConn = { send: vi.fn(), metadata: { name: 'P1' } };
        Network.connections = [mockConn];
        Network.playerName = 'P1';
        Network.turnOrder = ['Host', 'P1'];
        Network._mySubmittedAction = null;
        Network.submitCombatAction('defend', 'Legolas');
        expect(Network._mySubmittedAction).toEqual({ action: 'defend', charName: 'Legolas' });
        expect(mockConn.send).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'COMBAT_ACTION', action: 'defend', charName: 'Legolas' })
        );
    });
});

// ──────────────────────────────────────────
// executeCombatRound
// ──────────────────────────────────────────

describe('executeCombatRound', () => {
    it('does nothing when not host', () => {
        Network.role = 'client';
        Network.combatActions = { P1: { action: 'attack', charName: 'Gimli' } };
        Network.executeCombatRound();
        expect(Engine.interactWithAI).not.toHaveBeenCalled();
    });

    it('does nothing with no actions', () => {
        Network.role = 'host';
        Network.combatActions = {};
        Network.executeCombatRound();
        expect(Engine.interactWithAI).not.toHaveBeenCalled();
    });

    it('collects actions and calls interactWithAI', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network.combatActions = {
            Host: { action: 'greift an', charName: 'Gimli' },
            P1: { action: 'heilt', charName: 'Jose' },
        };
        Network._mySubmittedAction = { action: 'greift an' };
        Network.executeCombatRound();
        expect(Engine.interactWithAI).toHaveBeenCalledWith(
            expect.stringContaining('Gimli: greift an')
        );
        expect(Engine.interactWithAI).toHaveBeenCalledWith(
            expect.stringContaining('Jose: heilt')
        );
        expect(Network.combatActions).toEqual({});
        expect(Network._mySubmittedAction).toBeNull();
    });
});

// ──────────────────────────────────────────
// _setConnState
// ──────────────────────────────────────────

// ──────────────────────────────────────────
// canRollFor
// ──────────────────────────────────────────

describe('canRollFor', () => {
    it('always allows when not connected', () => {
        expect(Network.canRollFor('Anyone')).toBe(true);
    });

    it('always allows in single player MP', () => {
        Network.connState = 'connected';
        Network.turnOrder = ['Host'];
        expect(Network.canRollFor('Anyone')).toBe(true);
    });

    it('allows own character', () => {
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'Player1'];
        Network.playerName = 'Host';
        State._mpMyCharId = 'c1';
        State.party = [makeChar({ id: 'c1', name: 'Gimli' })];
        expect(Network.canRollFor('Gimli')).toBe(true);
    });

    it('denies other player character for client', () => {
        Network.role = 'client';
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'Player1'];
        Network.playerName = 'Player1';
        State._mpMyCharId = 'c2';
        State.party = [
            makeChar({ id: 'c1', name: 'Gimli' }),
            makeChar({ id: 'c2', name: 'Legolas' }),
        ];
        Network.playerCharMap = { Host: 'c1', Player1: 'c2' };
        expect(Network.canRollFor('Gimli')).toBe(false);
        expect(Network.canRollFor('Legolas')).toBe(true);
    });

    it('host can roll for auto-player characters', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'Player1'];
        Network.playerName = 'Host';
        Network.autoPlayers = { Player1: true };
        Network.playerCharMap = { Host: 'c1', Player1: 'c2' };
        State._mpMyCharId = 'c1';
        State.party = [
            makeChar({ id: 'c1', name: 'Gimli' }),
            makeChar({ id: 'c2', name: 'Legolas' }),
        ];
        expect(Network.canRollFor('Legolas')).toBe(true);
    });

    it('host can roll for unassigned NPCs', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'Player1'];
        Network.playerName = 'Host';
        Network.playerCharMap = { Host: 'c1', Player1: 'c2' };
        State._mpMyCharId = 'c1';
        State.party = [
            makeChar({ id: 'c1', name: 'Gimli' }),
            makeChar({ id: 'c2', name: 'Legolas' }),
            makeChar({ id: 'npc1', name: 'Gandalf', isNPC: true }),
        ];
        expect(Network.canRollFor('Gandalf')).toBe(true);
    });

    it('host cannot roll for other human player characters', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'Player1'];
        Network.playerName = 'Host';
        Network.autoPlayers = {};
        Network.playerCharMap = { Host: 'c1', Player1: 'c2' };
        State._mpMyCharId = 'c1';
        State.party = [
            makeChar({ id: 'c1', name: 'Gimli' }),
            makeChar({ id: 'c2', name: 'Legolas' }),
        ];
        expect(Network.canRollFor('Legolas')).toBe(false);
    });
});

// ──────────────────────────────────────────
// fullSync / _markDirty / _getFullSyncPayload
// ──────────────────────────────────────────

describe('fullSync', () => {
    it('does nothing when not host', () => {
        Network.role = 'client';
        const mockConn = { send: vi.fn() };
        Network.connections = [mockConn];
        Network.fullSync();
        expect(mockConn.send).not.toHaveBeenCalled();
    });

    it('sends FULL_SYNC with all state and network metadata', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.playerName = 'Host';
        Network.turnOrder = ['Host', 'Player1'];
        Network.currentTurnIndex = 1;
        Network.playerCharMap = { Host: 'c1' };
        Network.autoPlayers = { Player1: true };
        Network.combatActions = {};
        Network.currentVote = null;
        State.gold = 42;
        State.isProcessing = true;
        const mockConn = { send: vi.fn() };
        Network.connections = [mockConn];
        Network.fullSync();
        expect(mockConn.send).toHaveBeenCalledOnce();
        const payload = mockConn.send.mock.calls[0][0];
        expect(payload.type).toBe('FULL_SYNC');
        expect(payload.state.gold).toBe(42);
        expect(payload.turnOrder).toEqual(['Host', 'Player1']);
        expect(payload.currentTurnIndex).toBe(1);
        expect(payload.playerCharMap).toEqual({ Host: 'c1' });
        expect(payload.autoPlayers).toEqual({ Player1: true });
        expect(payload.isProcessing).toBe(true);
    });

    it('clears dirty flag after sending', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.connections = [];
        Network._syncDirty = true;
        Network.fullSync();
        expect(Network._syncDirty).toBe(false);
    });

    it('includes combat submitted status', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.turnOrder = ['Host', 'P1'];
        Network.combatActions = { Host: { action: 'attack', charName: 'Gimli' } };
        const mockConn = { send: vi.fn() };
        Network.connections = [mockConn];
        Network.fullSync();
        const payload = mockConn.send.mock.calls[0][0];
        expect(payload.combatSubmitted['Host']).toBe('Gimli');
        expect(payload.combatSubmitted['P1']).toBeNull();
    });
});

describe('_markDirty', () => {
    it('sets dirty flag', () => {
        Network.role = 'host';
        Network._syncDirty = false;
        Network._markDirty();
        expect(Network._syncDirty).toBe(true);
        if (Network._syncDebounceTimer) clearTimeout(Network._syncDebounceTimer);
        Network._syncDebounceTimer = null;
    });
});

describe('requestSync', () => {
    it('client sends REQUEST_SYNC to host', () => {
        Network.role = 'client';
        Network.connState = 'connected';
        const mockConn = { send: vi.fn() };
        Network.connections = [mockConn];
        Network.requestSync();
        expect(mockConn.send).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'REQUEST_SYNC' })
        );
    });

    it('host calls fullSync directly', () => {
        Network.role = 'host';
        Network.connState = 'connected';
        Network.turnOrder = ['Host'];
        Network.combatActions = {};
        const mockConn = { send: vi.fn() };
        Network.connections = [mockConn];
        Network.requestSync();
        expect(mockConn.send).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'FULL_SYNC' })
        );
    });
});

describe('_setConnState', () => {
    it('updates connState and error', () => {
        Network._setConnState('error', 'timeout');
        expect(Network.connState).toBe('error');
        expect(Network._lastError).toBe('timeout');
    });

    it('defaults error to empty string', () => {
        Network._setConnState('connected');
        expect(Network.connState).toBe('connected');
        expect(Network._lastError).toBe('');
    });
});
