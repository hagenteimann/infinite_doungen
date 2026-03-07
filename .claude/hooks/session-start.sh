#!/bin/bash
set -euo pipefail

# Nur im Web/Mobile-Modus ausführen
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "Infinite Dungeon – Session gestartet"
echo "Arbeitsverzeichnis: $(pwd)"
echo "Neueste Version: $(ls 'Playable Versions/'*.html 2>/dev/null | tail -1 || echo 'Stable 1.4.html')"
