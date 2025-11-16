/**
 * deploy-commands.js
 * Rejestruje komendy globalnie.
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const commands = [
  // =======================
  //       MODERACJA
  // =======================
  {
    name: 'warn',
    description: 'Ostrzeż użytkownika',
    options: [
      { name: 'user', type: 6, required: true, description: 'Użytkownik' },
      { name: 'reason', type: 3, required: false, description: 'Powód' }
    ]
  },
  {
    name: 'kick',
    description: 'Wyrzuć użytkownika',
    options: [
      { name: 'user', type: 6, required: true, description: 'Użytkownik' },
      { name: 'reason', type: 3, required: false, description: 'Powód' }
    ]
  },
  {
    name: 'ban',
    description: 'Zbanuj użytkownika',
    options: [
      { name: 'user', type: 6, required: true, description: 'Użytkownik' },
      { name: 'reason', type: 3, required: false, description: 'Powód' }
    ]
  },
  {
    name: 'mute',
    description: 'Wycisz użytkownika',
    options: [
      { name: 'user', type: 6, required: true, description: 'Użytkownik' },
      { name: 'duration', type: 3, required: false, description: 'Czas np. 10m' }
    ]
  },
  {
    name: 'unmute',
    description: 'Odcisz użytkownika',
    options: [
      { name: 'user', type: 6, required: true, description: 'Użytkownik' }
    ]
  },

  { name: 'info', description: 'Informacje o bocie' },
  { name: 'help', description: 'Lista komend' },

  {
    name: 'panelogon',
    description: 'Ustaw hasło panelu',
    options: [
      { name: 'password', type: 3, required: true, description: 'Hasło' }
    ]
  },

  // =======================
  //        EKONOMIA
  // =======================
  { name: 'balance', description: 'Sprawdź swoje saldo' },
  { name: 'work', description: 'Pracuj aby zarobić' },
  { name: 'daily', description: 'Odbierz daily' },
  { name: 'weekly', description: 'Odbierz weekly' },

  {
    name: 'addmoney',
    description: 'Dodaj komuś pieniądze (admin)',
    options: [
      { name: 'user', type: 6, required: true, description: 'Użytkownik' },
      { name: 'amount', type: 4, required: true, description: 'Ile dodać' }
    ]
  },

  {
    name: 'pay',
    description: 'Wyślij monety innemu użytkownikowi',
    options: [
      { name: 'user', type: 6, required: true, description: 'Użytkownik' },
      { name: 'amount', type: 4, required: true, description: 'Kwota' }
    ]
  },

  // =======================
  //          SKLEP
  // =======================
  { name: 'shop', description: 'Wyświetl sklep' },

  {
    name: 'buy',
    description: 'Kup przedmiot',
    options: [
      { name: 'item', type: 4, required: true, description: 'ID przedmiotu' }
    ]
  },

  {
    name: 'additem',
    description: 'Dodaj przedmiot do sklepu (admin)',
    options: [
      { name: 'name', type: 3, required: true, description: 'Nazwa' },
      { name: 'price', type: 4, required: true, description: 'Cena' },
      { name: 'desc', type: 3, required: false, description: 'Opis' },
      { name: 'giverole', type: 5, required: false, description: 'Czy daje rolę?' },
      { name: 'role', type: 8, required: false, description: 'Rola do nadania' },
      { name: 'requiresrole', type: 8, required: false, description: 'Wymagana rola' }
    ]
  },

  {
    name: 'deleteitem',
    description: 'Usuń przedmiot (admin)',
    options: [
      { name: 'id', type: 4, required: true, description: 'ID' },
      { name: 'confirm', type: 5, required: true, description: 'Potwierdzenie' }
    ]
  },

  // =======================
  //         TICKETY
  // =======================
  {
    name: 'newticket',
    description: 'Otwórz ticket'
  },
  {
    name: 'closeticket',
    description: 'Zamknij ticket'
  },

  // =======================
  //        WIDGETY
  // =======================
  {
    name: 'addwidget',
    description: 'Dodaj leaderboard na kanał',
    options: [
      {
        name: 'type',
        type: 3,
        required: true,
        description: 'Typ leaderboardu',
        choices: [
          { name: 'Najwięcej monet (A)', value: 'A' },
          { name: 'Top pracownicy (B)', value: 'B' },
          { name: 'Najaktywniejsi (C)', value: 'C' }
        ]
      },
      {
        name: 'channel',
        type: 7,
        description: 'Kanał gdzie wysłać widget',
        required: true
      }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('⏳ Deploying commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Commands deployed!');
  } catch (err) {
    console.error('❌ Error deploying commands:', err);
  }
})();
