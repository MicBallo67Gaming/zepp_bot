/**
 * deploy-commands.js
 * Registers slash commands globally.
 */
require('dotenv').config();
const { REST, Routes } = require('discord.js');

const commands = [
  // --- MODERACJA ---
  {
    name: 'warn',
    description: 'Ostrzeż użytkownika',
    options: [
      { name: 'user', type: 6, description: 'Użytkownik', required: true },
      { name: 'reason', type: 3, description: 'Powód', required: false }
    ]
  },

  {
    name: 'kick',
    description: 'Wyrzuć użytkownika',
    options: [
      { name: 'user', type: 6, description: 'Użytkownik', required: true },
      { name: 'reason', type: 3, description: 'Powód', required: false }
    ]
  },

  {
    name: 'ban',
    description: 'Zbanuj użytkownika',
    options: [
      { name: 'user', type: 6, description: 'Użytkownik', required: true },
      { name: 'reason', type: 3, description: 'Powód', required: false }
    ]
  },

  {
    name: 'mute',
    description: 'Wycisz użytkownika',
    options: [
      { name: 'user', type: 6, description: 'Użytkownik', required: true },
      { name: 'duration', type: 3, description: 'Czas (np. 10m)', required: false }
    ]
  },

  {
    name: 'unmute',
    description: 'Odcisz użytkownika',
    options: [
      { name: 'user', type: 6, description: 'Użytkownik', required: true }
    ]
  },

  { name: 'info', description: 'Informacje o bocie' },
  { name: 'help', description: 'Lista komend' },

  {
    name: 'panelogon',
    description: 'Ustaw hasło do panelu',
    options: [
      { name: 'password', type: 3, description: 'Hasło', required: true }
    ]
  },

  // --- EKONOMIA ---
  { name: 'balance', description: 'Sprawdź swoje saldo' },

  { name: 'work', description: 'Pracuj, aby zarobić pieniądze' },

  { name: 'daily', description: 'Odbierz dzienną nagrodę' },

  { name: 'weekly', description: 'Odbierz tygodniową nagrodę' },

  {
    name: 'addmoney',
    description: 'Dodaj komuś pieniądze (admin)',
    options: [
      { name: 'user', type: 6, description: 'Użytkownik', required: true },
      { name: 'amount', type: 4, description: 'Kwota', required: true }
    ]
  },

  // --- SKLEP: ADDITEM ---
  {
    name: 'additem',
    description: 'Dodaj przedmiot do sklepu (admin)',
    options: [
      { name: 'name', type: 3, description: 'Nazwa przedmiotu', required: true },
      { name: 'price', type: 4, description: 'Cena przedmiotu', required: true },
      { name: 'giverole', type: 5, description: 'Czy daje rolę po zakupie?', required: false },
      { name: 'role', type: 8, description: 'Rola do nadania', required: false },
      { name: 'requiresrole', type: 8, description: 'Wymagana rola do zakupu', required: false }
    ]
  },

  // --- SKLEP: DELETEITEM ---
  {
    name: 'deleteitem',
    description: 'Usuń przedmiot ze sklepu',
    options: [
      { name: 'id', type: 4, description: 'ID przedmiotu', required: true },
      { name: 'confirm', type: 5, description: 'Czy na pewno?', required: true }
    ]
  },

  // --- PAY ---
  {
    name: 'pay',
    description: 'Prześlij monety innemu użytkownikowi',
    options: [
      { name: 'user', type: 6, description: 'Użytkownik', required: true },
      { name: 'amount', type: 4, description: 'Kwota do wysłania', required: true }
    ]
  },

  // --- SHOP ---
  { name: 'shop', description: 'Wyświetl sklep serwera' },

  {
    name: 'buy',
    description: 'Kup przedmiot ze sklepu',
    options: [
      { name: 'item', type: 4, description: 'Numer przedmiotu', required: true }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Deploying commands...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('OK!');
  } catch (err) {
    console.error('Failed to deploy commands:', err);
  }
})();