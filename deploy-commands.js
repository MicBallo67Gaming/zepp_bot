\
  // deploy-commands.js - register slash commands (global)
  require('dotenv').config();
  const { REST, Routes } = require('discord.js');
  const commands = [
    { name: 'warn', description: 'Ostrzeż użytkownika', options:[ { name:'user', type:6, description:'Użytkownik', required:true }, { name:'reason', type:3, description:'Powód', required:false } ] },
    { name: 'kick', description: 'Wyrzuć użytkownika', options:[ { name:'user', type:6, description:'Użytkownik', required:true }, { name:'reason', type:3, description:'Powód', required:false } ] },
    { name: 'ban', description: 'Zbanuj użytkownika', options:[ { name:'user', type:6, description:'Użytkownik', required:true }, { name:'reason', type:3, description:'Powód', required:false } ] },
    { name: 'mute', description: 'Wycisz użytkownika', options:[ { name:'user', type:6, description:'Użytkownik', required:true }, { name:'duration', type:3, description:'Czas (np. 10m)', required:false } ] },
    { name: 'unmute', description: 'Odcisz użytkownika', options:[ { name:'user', type:6, description:'Użytkownik', required:true } ] },
    { name: 'info', description: 'Informacje o bocie' },
    { name: 'help', description: 'Lista komend' },
    { name: 'panelogon', description: 'Ustaw hasło do panelu dla tego serwera (pierwsze użycie tworzy konto)', options:[ { name:'password', type:3, description:'Hasło', required:true } ] }
  ];
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  (async () => {
    try {
      console.log('Deploying commands...');
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log('Commands deployed.');
    } catch (err) {
      console.error(err);
    }
  })();
