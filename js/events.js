import { TTS, DOM, UI } from './ui.js';
import { Engine } from './engine.js';
import { Network } from './network.js';
import { State } from './state.js';
import { PartyManager } from './party.js';

export function initEvents() {
    document.addEventListener('click', (e) => {
        const closeModal = e.target.closest('[data-close-modal]');
        if (closeModal) {
            const id = closeModal.dataset.closeModal;
            document.getElementById(id)?.classList.add('hidden');
            return;
        }

        // Close settings panel when clicking outside
        if (!e.target.closest('#settings-panel') && !e.target.closest('#settings-btn')) {
            document.getElementById('settings-panel')?.classList.add('hidden');
        }
        // Close mobile sidebar when clicking backdrop
        const sidebar = document.getElementById('sidebar');
        if (sidebar && !sidebar.classList.contains('translate-x-full') && !e.target.closest('#sidebar')) {
            sidebar.classList.add('translate-x-full');
        }
        // Close sound menu when clicking outside
        if (!e.target.closest('#sound-menu-wrapper')) {
            document.getElementById('sound-menu-panel')?.classList.add('hidden');
        }

        const actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;
        const action = actionEl.dataset.action;

        const ACTIONS = {
            'show-api-settings': () => UI.showApiSettings(),
            'show-music-settings': () => UI.showMusicSettings(),
            'toggle-music-playback': () => Engine.toggleMusicPlayback(),
            'entry-start-solo': () => Engine.beginSessionFlow('solo'),
            'entry-start-host': () => Engine.beginSessionFlow('host'),
            'entry-join-room': () => Engine.beginSessionFlow('join'),
            'entry-select-provider': () => Engine.selectStartApiProvider(actionEl.dataset.provider),
            'entry-confirm-api': () => Engine.confirmApiGate(),
            'entry-back': () => { State.sessionPhase = 'start'; State.pendingApiMode = null; UI.updateAll(); },
            'pregame-toggle-ready': () => Engine.togglePregameReady(),
            'pregame-load-hero': () => Engine.openHeroImport(),
            'pregame-create-hero': () => UI.showCreator(),
            'pregame-load-saved-hero': () => Engine.loadHeroFromRoster(actionEl.dataset.heroId),
            'pregame-delete-saved-hero': () => Engine.deleteHeroFromRoster(actionEl.dataset.heroId),
            'save-hero-to-roster': () => Engine.saveHeroToRoster(actionEl.dataset.charId),
            'toggle-sound-menu': () => document.getElementById('sound-menu-panel')?.classList.toggle('hidden'),
            'toggle-sound': () => Engine.toggleSound(),
            'tts-open-picker': () => TTS.openPicker(),
            'download-save': () => Engine.downloadSave(),
            'start-game': () => Engine.startGame(),
            'submit-action': () => {
                const text = actionEl.dataset.text;
                text ? Engine.submitPlayerAction(text) : Engine.submitPlayerAction();
            },
            'toggle-settings-panel': () => document.getElementById('settings-panel')?.classList.toggle('hidden'),
            'open-sidebar': () => document.getElementById('sidebar')?.classList.remove('translate-x-full'),
            'close-sidebar': () => document.getElementById('sidebar')?.classList.add('translate-x-full'),
            'toggle-mobile-actions': () => {
                const row = document.getElementById('action-buttons-row');
                const chevron = document.getElementById('mobile-actions-chevron');
                if (!row) return;
                const nowHidden = row.classList.toggle('hidden');
                if (chevron) chevron.className = `fas fa-chevron-${nowHidden ? 'up' : 'down'} text-[10px]`;
            },
            'toggle-verbose-mode': () => Engine.toggleVerboseMode(),

            'camp': () => Engine.camp(),
            'ask-oracle': () => Engine.askOracle(),

            'generate-npc': () => Engine.generateNPC(),
            'check-enemies': () => Engine.checkEnemies(),
            'toggle-quickplay': () => Engine.toggleQuickplay(),
            'bulk-export': () => Engine.bulkExportHeroes(),
            'show-creator': () => UI.showCreator(),
            'hide-details': () => UI.hideDetails(),
            'gen-journal': () => Engine.generateJournalEntry(),
            'leave-merchant': () => Engine.leaveMerchant(),
            'gen-portrait': () => Engine.generatePortrait(),
            'finalize-char': () => Engine.finalizeCharacter(),
            'close-creator': () => UI.closeCreator(),
            'submit-dice': () => Engine.submitManualDiceRoll(),
            'save-api-key': () => Engine.saveApiKey(),
            'submit-oracle': () => Engine.submitOracle(),
            'confirm-use': () => Engine.confirmUseItem(),
            'confirm-equip': () => Engine.confirmEquipItem(),
            'confirm-give': () => Engine.confirmGiveItem(),
            'confirm-offer': () => Engine.confirmOfferItem(),
            'confirm-drop': () => Engine.confirmDropItem(),
            'confirm-unequip': () => Engine.confirmUnequipItem(),
            'suggest-craft': () => Engine.suggestCrafting(),
            'submit-craft': () => Engine.submitCrafting(),
            'close-craft': () => UI.closeCrafting(),
            'decline-ability': () => Engine.declineNewAbility(),
            'save-api-settings': () => Engine.saveApiSettings(),
            'tts-test': () => TTS.testVoice(),
            'tts-save': () => TTS.savePicker(),
            'apply-preset': () => UI.applyPreset(actionEl.dataset.preset),
            'switch-tab': () => UI.switchTab(actionEl.dataset.tab),
            'choose-route': () => Engine.chooseRoute(actionEl.dataset.route),
            'propose-trade': () => Engine.proposeTrade(actionEl.dataset.safeId, actionEl.dataset.merchantName),
            'entity-click': () => UI.handleEntityClick(actionEl.dataset.name, actionEl.dataset.entityType, actionEl.dataset.entityId),
            'tts-speak': () => {
                const msgEl = actionEl.closest('.tts-msg');
                TTS.speak(msgEl?.querySelector('.tts-text'), actionEl);
            },
            'assign-loot': () => Engine.assignLoot(parseInt(actionEl.dataset.idx), actionEl.dataset.charId),
            'collect-all-loot': () => {
                const charId = actionEl.value || actionEl.dataset.charId;
                if (charId) Engine.collectAllLoot(charId);
            },
            'item-click': () => Engine.handleItemClick(actionEl.dataset.charId, actionEl.dataset.item, actionEl.dataset.equipped === 'true', parseInt(actionEl.dataset.count) || 1),
            'upgrade-stat': () => Engine.upgradeStat(actionEl.dataset.charId, actionEl.dataset.stat),
            'remove-char': () => Engine.removeCharacter(actionEl.dataset.charId),
            'export-hero': () => Engine.exportHero(actionEl.dataset.charId),
            'learn-talent': () => Engine.learnTalent(actionEl.dataset.charId, actionEl.dataset.talent),
            'use-ability': () => Engine.useAbility(actionEl.dataset.charId, actionEl.dataset.ability, actionEl.dataset.itemAbility === 'true', actionEl.dataset.abilitySource || ''),
            'refresh-levelup-portrait': () => {
                const char = State.party.find(p => p.id === actionEl.dataset.charId);
                if (char) PartyManager.refreshLevelUpPortrait(char);
            },
            'roll-specific': () => Engine.rollSpecific(actionEl.dataset.rollId),
            'roll-all': () => Engine.rollAllPending(),
            'submit-rolls': () => Engine.submitPendingRolls(),
            'start-crafting': () => Engine.startCrafting(actionEl.dataset.charId),
            'add-craft-ingredient': () => Engine.addCraftingIngredient(actionEl.dataset.charId, actionEl.dataset.item),
            'remove-craft-ingredient': () => Engine.removeCraftingIngredient(parseInt(actionEl.dataset.idx)),
            'replace-ability': () => Engine.replaceAbility(parseInt(actionEl.dataset.idx)),
            'show-details': () => UI.showDetails(actionEl.dataset.charId),
            'show-multiplayer': () => Network.showModal(),
            'mp-host': () => {
                const name = document.getElementById('mp-player-name')?.value.trim();
                Network.host(name);
            },
            'mp-join': () => {
                const code = document.getElementById('mp-room-code')?.value.trim();
                const name = document.getElementById('mp-player-name')?.value.trim();
                if (!code) return;
                Network.join(code, name);
            },
            'mp-disconnect': () => Network.disconnect(),
            'mp-retry': () => {
                const lastRole = Network.role;
                const lastCode = Network.roomCode;
                const lastName = Network.playerName;
                Network.disconnect();
                if (lastRole === 'host') Network.host(lastName);
                else if (lastRole === 'client' && lastCode) Network.join(lastCode, lastName);
                else Network.showModal();
            },
            'mp-save-config': () => Network.saveAdvancedConfig(),
            'mp-request-sync': () => Network.requestSync(),
            'mp-execute-round': () => Network.executeCombatRound(),
            'mp-roll-pending': () => Network.hostRollPending(actionEl.dataset.rollId),
            'mp-skip-player': () => Network.skipPlayer(actionEl.dataset.player),
            'mp-toggle-auto': () => Network.toggleAutoPlayer(actionEl.dataset.player),
            'mp-toggle-control': () => Network.togglePlayerControlMode(actionEl.dataset.player),
            'toggle-self-control': () => Engine.toggleSelfControlMode(),
            'close-enemy-lightbox': () => UI.closeEnemyLightbox(),
            'mp-cast-vote': () => Network.castVote(parseInt(actionEl.dataset.option)),
            'mp-resolve-vote': () => Network.resolveVote(parseInt(actionEl.dataset.option)),
            'mp-start-vote': () => {
                const input = prompt('Abstimmung erstellen:\nFormat: Frage | Option1, Option2, Option3');
                if (!input) return;
                const parts = input.split('|').map(s => s.trim());
                if (parts.length >= 2) {
                    const question = parts[0];
                    const options = parts[1].split(',').map(s => s.trim()).filter(Boolean);
                    if (options.length >= 2) { Network.startVote(question, options); return; }
                }
                UI.addChatLog('System', 'Ungueltiges Format. Nutze: Frage | Option1, Option2, Option3');
            },
        };

        ACTIONS[action]?.();
    });

    document.addEventListener('input', (e) => {
        const el = e.target;
        if (el.id === 'entry-room-code') State.pendingRoomCode = el.value.toUpperCase();
        else if (el.id === 'start-api-key-input') State.pendingApiKeyValue = el.value;
        else if (el.id === 'start-api-model-input') State.pendingApiModelText = el.value;
        else if (el.id === 'music-volume-slider') Engine.setMusicVolume(Number(el.value) / 100);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const el = e.target;
        if (!el) return;
        if (el.id === 'player-input') Engine.submitPlayerAction();
        else if (el.id === 'oracle-input') Engine.submitOracle();
    });

    document.addEventListener('pointerover', (e) => {
        const card = e.target.closest('.entity-card');
        if (!card) return;
        if (card._hoverOutTimer) { clearTimeout(card._hoverOutTimer); card._hoverOutTimer = null; }
        card.classList.add('is-hovered');
    });

    document.addEventListener('pointerout', (e) => {
        const card = e.target.closest('.entity-card');
        if (!card) return;
        if (card.contains(e.relatedTarget)) return;
        card._hoverOutTimer = setTimeout(() => {
            card.classList.remove('is-hovered');
            card._hoverOutTimer = null;
        }, 120);
    });

    document.addEventListener('change', (e) => {
        const el = e.target;
        if (el.id === 'import-save') Engine.importSave(e);
        else if (el.id === 'import-hero') Engine.importHero(e);
        else if (el.id === 'api-provider-select') UI.updateApiSettingsView();
        else if (el.id === 'collect-all-select') {
            if (el.value) { Engine.collectAllLoot(el.value); el.value = ''; }
        }
        else if (el.dataset.action === 'assign-loot' && el.value) {
            Engine.assignLoot(parseInt(el.dataset.idx), el.value);
            el.value = '';
        }
    });

    const slider = document.getElementById('item-action-slider');
    const numInput = document.getElementById('item-action-amount');
    if (slider && numInput) {
        slider.addEventListener('input', () => { numInput.value = slider.value; });
        numInput.addEventListener('input', () => { slider.value = numInput.value; });
        numInput.addEventListener('change', () => {
            const max = parseInt(numInput.max);
            if (parseInt(numInput.value) > max) { numInput.value = max; slider.value = max; }
            else if (parseInt(numInput.value) < 1) { numInput.value = 1; slider.value = 1; }
        });
    // Swipe-up on action area opens mobile actions panel
    let _swipeStartY = 0;
    document.addEventListener('touchstart', e => { _swipeStartY = e.touches[0].clientY; }, { passive: true });
    document.addEventListener('touchend', e => {
        if (window.innerWidth >= 768) return;
        const dy = _swipeStartY - e.changedTouches[0].clientY;
        const row = document.getElementById('action-buttons-row');
        const chevron = document.getElementById('mobile-actions-chevron');
        if (!row) return;
        if (dy > 50 && row.classList.contains('hidden')) {
            row.classList.remove('hidden');
            if (chevron) chevron.className = 'fas fa-chevron-down text-[10px]';
        } else if (dy < -50 && !row.classList.contains('hidden')) {
            row.classList.add('hidden');
            if (chevron) chevron.className = 'fas fa-chevron-up text-[10px]';
        }
    }, { passive: true });
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') UI.closeEnemyLightbox();
});














