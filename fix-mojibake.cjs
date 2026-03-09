const fs = require('fs');
const path = require('path');

const directoriesToProcess = [
    path.join(__dirname, 'js'),
    path.join(__dirname, 'Playable Versions') // Might have some too
];

const replacements = {
    // 5-level mojibake
    'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¤': 'ä',
    'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¼': 'ü',
    'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢': '•',

    // 4-level mojibake
    'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¶': 'ö',
    'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂŸ': 'ß',

    // 3-level mojibake
    'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¤': 'ä',
    'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¶': 'ö',
    'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¼': 'ü',
    'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂŸ': 'ß',
    'ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¤': 'ä',
    'ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¶': 'ö',
    'ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¼': 'ü',
    'ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂŸ': 'ß',

    // 2-level mojibake (Emojis, Typography, Umlauts)
    'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â': '⚠️',
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ËœÃ‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â': '👁️',
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂºÃ‚Â¡ÃƒÂ¯Ã‚Â¸Ã‚Â': '🛡️',
    'ÃƒÂ¢Ã‚Â Ã‚Â¤ÃƒÂ¯Ã‚Â¸Ã‚Â': '❤️',
    'ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦': '✅',
    'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“': '–',   
    'ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾': '„',
    'ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ': '“',
    'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢': '’',
    'ÃƒÂ°Ã…Â¸Ã…â€™Ã…Â¸': '🌟',
    'ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â²': '🎲',
    'ÃƒÂ¢Ã…â€œÃ‚Â¨': '✨',
    'ÃƒÂ¢Ã‚Â Ã‚Â³': '⏳',
    'ÃƒÂ¢Ã…Â¡Ã‚Â”': '⚔️',
    'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢': '•',
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬Â Ã¢â‚¬Å¾': '🔄',
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬Â Ã…â€™': '🔌',
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¾': '💾',

    'ÃƒÆ’Ã‚Â¤': 'ä',
    'ÃƒÆ’Ã‚Â¼': 'ü',
    'ÃƒÆ’Ã‚Â¶': 'ö',
    'ÃƒÆ’Ã‚ÂŸ': 'ß',
    'ÃƒÆ’Ã…Â¸': 'ß', // common alternative variant
    'ÃƒÆ’Ã¢â‚¬Å¾': 'Ä',
    'ÃƒÆ’Ã¢â‚¬â€œ': 'Ö',
    'ÃƒÆ’Ã…â€œ': 'Ü',

    // 1-level standard mojibake (ISO-8859-1 double encoded utf8)
    'Ã¤': 'ä',
    'Ã¼': 'ü',
    'Ã¶': 'ö',
    'ÃŸ': 'ß',
    'Ã„': 'Ä',
    'Ã–': 'Ö',
    'Ãœ': 'Ü',

    // Raw corrupted emoji backups
    'âš ï¸ ': '⚠️',
    'âœ…': '✅',
    'â€“': '–',
    'â€ž': '„',
    'â€œ': '“',
    'â€™': '’',
    'ðŸŒŸ': '🌟',
    'ðŸŽ²': '🎲',
    'âœ¨': '✨',
    'â ³': '⏳',
    'ðŸ‘ ï¸ ': '👁️',
    'ðŸ›¡ï¸ ': '🛡️',
};

// Sort keys descending by string length so larger corruptions are caught before partial subsets
const sortedKeys = Object.keys(replacements).sort((a, b) => b.length - a.length);

function processFile(filePath) {
    if (!filePath.endsWith('.js') && !filePath.endsWith('.html')) return;

    let content = fs.readFileSync(filePath, 'utf8');
    let originalContent = content;

    for (const key of sortedKeys) {
        // Fast string replacement logic
        content = content.split(key).join(replacements[key]);
    }

    if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Fixed mojibake in ${filePath}`);
    }
}

function walkDir(currentPath) {
    if (!fs.existsSync(currentPath)) {
        return;
    }
    const files = fs.readdirSync(currentPath);
    for (const file of files) {
        const fullPath = path.join(currentPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
        } else {
            processFile(fullPath);
        }
    }
}

directoriesToProcess.forEach(d => walkDir(d));
console.log('Mojibake fix complete.');