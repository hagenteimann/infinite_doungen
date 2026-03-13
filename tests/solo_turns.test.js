import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Engine } from '../js/engine.js';
import { State, dispatch } from '../js/state.js';
import { Network } from '../js/network.js';
import { UI } from '../js/ui.js';

// Mock UI and Network to avoid side effects
vi.mock('../js/ui.js', () => ({
    UI: {
        updateAll: vi.fn(),
        toggleViews: vi.fn(),
        showToast: vi.fn(),
        addChatLog: vi.fn()
    }
}));

vi.mock('../js/network.js', () => ({
    Network: {
        isConnected: vi.fn(() => false),
        isHost: vi.fn(() => false),
        isClient: vi.fn(() => false),
        getDisplayPlayerName: vi.fn((n) => n),
        playerName: 'SoloPlayer'
    }
}));

describe('Solo Multi-Hero Support', () => {
    beforeEach(() => {
        // Reset State
        State.party = [];
        State.actingChar = '';
        State.localPlayerName = 'SoloPlayer';
        State.playerProfiles = { 'SoloPlayer': { heroId: null, heroName: null } };

        // Mock getPregameStatus
        vi.spyOn(Engine, 'getPregameStatus').mockReturnValue({ ok: true });
        // Mock interactWithAI to skip actual AI calls
        vi.spyOn(Engine, 'interactWithAI').mockImplementation(vi.fn());
    });

    it('should allow adding multiple heroes without replacement in solo mode', () => {
        const hero1 = { id: 'h1', name: 'Hero 1', class: 'Warrior' };
        const hero2 = { id: 'h2', name: 'Hero 2', class: 'Mage' };

        // Mock roster
        vi.spyOn(Engine, 'getHeroRoster').mockReturnValue([hero1, hero2]);

        Engine.loadHeroFromRoster('h1');
        expect(State.party.length).toBe(1);
        expect(State.party[0].name).toBe('Hero 1');

        Engine.loadHeroFromRoster('h2');
        expect(State.party.length).toBe(2);
        expect(State.party[1].name).toBe('Hero 2');
    });

    it('should set the first hero as actingChar when starting game', () => {
        State.party = [
            { id: 'h1', name: 'Hero 1', isNPC: false },
            { id: 'h2', name: 'Hero 2', isNPC: false }
        ];

        Engine.startGame();
        expect(State.actingChar).toBe('Hero 1');
    });

    it('should cycle turns between heroes in solo mode', () => {
        State.party = [
            { id: 'h1', name: 'Hero 1', isNPC: false },
            { id: 'h2', name: 'Hero 2', isNPC: false }
        ];
        State.actingChar = 'Hero 1';

        Engine._soloAdvanceTurn();
        expect(State.actingChar).toBe('Hero 2');

        Engine._soloAdvanceTurn();
        expect(State.actingChar).toBe('Hero 1');
    });

    it('should skip NPCs and Summons during turn rotation', () => {
        State.party = [
            { id: 'h1', name: 'Hero 1', isNPC: false },
            { id: 'npc1', name: 'NPC', isNPC: true },
            { id: 'h2', name: 'Hero 2', isNPC: false }
        ];
        State.actingChar = 'Hero 1';

        Engine._soloAdvanceTurn();
        expect(State.actingChar).toBe('Hero 2');
    });
});
