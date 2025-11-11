ZeppBot - Discord moderation bot + Dashboard (Render-ready)
=========================================================
Co to daje:
- Slash komendy: /warn /kick /ban /mute /unmute /panelogon /help /info
- Dashboard (Polish) dostępny pod / (servowany przez Express) - logowanie ID serwera + hasło
- MySQL (use Aiven) - konfiguracja w .env
Jak użyć:
1) W katalogu /bot uzupełnij plik config.example.env i zapisz jako .env (DISCORD_TOKEN, CLIENT_ID, MYSQL_*)
2) Na lokalnym komputerze uruchom raz: npm run deploy-commands (to zarejestruje slash komendy)
3) Zepchnij repo na GitHub i podłącz do Render (Web Service, Root: /bot)
4) Ustaw ENV w Render (DISCORD_TOKEN, CLIENT_ID, MYSQL_HOST, MYSQL_USER, MYSQL_PASS, MYSQL_DB)
5) Start: Render uruchomi `npm start` i bot zacznie działać.
Uwaga:
- Ten szkielet zawiera podstawowe funkcje i API. Możesz rozszerzyć komendy, dodać role, moderację automatyczną, webhooks, itp.
- Hasła paneli zapisywane są w bazie w prostym tekscie - dla produkcji warto dodać hash/salt.
