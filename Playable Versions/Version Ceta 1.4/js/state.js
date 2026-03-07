/* ==========================================
   2. STATE
   ========================================== */
const State = {
    party: [], activeEnemies: [], defeatedEnemies: [], lootDrops: [],
    lastStoryPart: "", gameStarted: false, isProcessing: false,
    tempPortraitData: "", tempImagePrompt: "",
    pendingRolls: [], craftingIngredients: [],
    targetMapMode: false,
    imageQuotaExceeded: false,
    combatEnded: false,
    activeMerchant: null,
    journal: [],
    sessionStats: { totalDamageDealt: 0, totalDamageTaken: 0, totalXPEarned: 0, totalHealed: 0, diceRolls: [], highestRoll: 0, lowestRoll: 21, combatsWon: 0, turnsPlayed: 0 },
    soundEnabled: true,
    quickplayEnabled: false,
    fate: 0,
    fatigue: 0,
    abilityCooldowns: {},
    isBossFight: false,
    chatHistory: [],
    undoSnapshot: null,
    savedPrompts: [],
    weather: { current: 'sunny', name: 'Sonnig', icon: '☀️', dcMod: 0 }
};
