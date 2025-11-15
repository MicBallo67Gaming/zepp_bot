ZeppBot (JSON storage) - quickstart
=================================

Opis:
- Lekki bot moderacji dla Discorda zapisujący wszystko do `data.json` (bez SQL).
- Prosty panel webowy dostępny pod / (Polish).
- Slash-komendy: /warn /kick /ban /mute /unmute /panelogon /help /info i inne komendy Economy!

Instalacja lokalnie / Render:
1. Wejdź w .env i edytuj te sekretne zmienne:
   DISCORD_TOKEN, CLIENT_ID, PORT (opcjonalnie)
2. Zainstaluj zależności:
   npm install
3. Zarejestruj komendy (chyba, że po update na github):
   npm run deploy-commands
4. Uruchom bota:
   npm start
5. Panel dostępny: http://localhost:3000/ (lub port który został wybrany w zmiennej w pliku .env)

Uwaga:
- Panel przechowuje hasło w plaintext w `data.json` (dla prostoty). Dla produkcji zamień na hash bcrypt.
- Możesz przenieść `data.json` do trwałego storage (np. mounted volume) na Render lub twoim hostingu.
