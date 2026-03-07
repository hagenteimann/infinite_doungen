import { TTS, DOM, UI } from './ui.js';
import { Engine } from './engine.js';
import { Network } from './network.js';

export function initEvents() {
    document.addEventListener('click', (e) => {
        const closeModal = e.target.closest('[data-close-modal]');
        if (closeModal) {
            const id = closeModal.dataset.closeModal;
            document.getElementById(id)?.classList.add('hidden');
            return;
        }

        const actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;
        const action = actionEl.dataset.action;

        const ACTIONS = {
            'show-api-settings': () => UI.showApiSettings(),
            'toggle-sound': () => Engine.toggleSound(),
            'tts-open-picker': () => TTS.openPicker(),
            'download-save': () => Engine.downloadSave(),
            'start-game': () => Engine.startGame(),
            'submit-action': () => {
                const text = actionEl.dataset.text;
                text ? Engine.submitPlayerAction(text) : Engine.submitPlayerAction();
            },
            'show-prompts': () => UI.showPromptManager(),
            'toggle-target': () => UI.toggleTargetMode(),
            'camp': () => Engine.camp(),
            'ask-oracle': () => Engine.askOracle(),
            'plot-twist': () => Engine.generatePlotTwist(),
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
            'save-prompt': () => Engine.savePrompt(),
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
            'use-ability': () => Engine.useAbility(actionEl.dataset.charId, actionEl.dataset.ability, actionEl.dataset.itemAbility === 'true'),
            'roll-specific': () => Engine.rollSpecific(actionEl.dataset.rollId),
            'roll-all': () => Engine.rollAllPending(),
            'submit-rolls': () => Engine.submitPendingRolls(),
            'start-crafting': () => Engine.startCrafting(actionEl.dataset.charId),
            'add-craft-ingredient': () => Engine.addCraftingIngredient(actionEl.dataset.charId, actionEl.dataset.item),
            'remove-craft-ingredient': () => Engine.removeCraftingIngredient(parseInt(actionEl.dataset.idx)),
            'replace-ability': () => Engine.replaceAbility(parseInt(actionEl.dataset.idx)),
            'insert-prompt': () => Engine.insertPrompt(parseInt(actionEl.dataset.idx)),
            'play-prompt': () => Engine.playPrompt(parseInt(actionEl.dataset.idx)),
            'delete-prompt': () => Engine.deletePrompt(parseInt(actionEl.dataset.idx)),
            'show-details': () => UI.showDetails(actionEl.dataset.charId),
            'submit-combat-action': () => Engine.submitCombatAction(),
            'execute-combat-round': () => Engine.executeCombatRound(),
            'start-vote': () => Engine.startVoteDialog(),
            'submit-vote-creation': () => Engine.submitVoteCreation(),
            'cast-vote': () => Network.castVote(parseInt(actionEl.dataset.idx)),
            'resolve-vote': () => Engine.resolveVote(parseInt(actionEl.dataset.idx)),
            'skip-vote-player': () => Engine.skipVotePlayer(actionEl.dataset.name),
            'set-leader': () => Engine.setLeader(actionEl.dataset.name),
            'assign-character': () => Engine.requestAssignCharacter(actionEl.dataset.charId),
            'add-vote-option': () => {
                const list = document.getElementById('vote-options-list');
                if (!list) return;
                const count = list.querySelectorAll('.vote-option-input').length + 1;
                const inp = document.createElement('input');
                inp.type = 'text'; inp.placeholder = `Option ${count}`;
                inp.className = 'vote-option-input w-full bg-black/50 border border-slate-700/50 rounded-lg p-2 text-sm text-slate-200 outline-none focus:border-purple-500/50';
                list.appendChild(inp);
            },
            'show-multiplayer': () => Network.showModal(),
            'mp-host': () => {
                const name = document.getElementById('mp-player-name')?.value.trim() || 'DM';
                Network.host(name);
            },
            'mp-join': () => {
                const code = document.getElementById('mp-room-code')?.value.trim();
                const name = document.getElementById('mp-player-name')?.value.trim() || 'Spieler';
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
        };

        ACTIONS[action]?.();
    });

    document.addEventListener('change', (e) => {
        const el = e.target;
        if (el.id === 'import-save') Engine.importSave(e);
        else if (el.id === 'import-hero') Engine.importHero(e);
        else if (el.id === 'api-provider-select') UI.updateApiSettingsView();
        else if (el.id === 'loot-assign-all') {
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
    }
}
