/*
 * ZeppBot (JSON storage)
 * Moderacja + Ekonomia + Sklep + Panel WWW
 */

require('dotenv').config();
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3000;

// --- Tworzenie data.json ---
function ensureData() {
  if (!fs.existsSync(DATA_FILE)) {
    const init = {
      servers: {},
      logs: [],
      mutes: {},
      bans: {},
      economy: {},
      shop: {} // <--- sklep
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2), 'utf8');
  }
}
ensureData();

async function readData() {
  return JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
}
async function writeData(obj) {
  await fsp.writeFile(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

// ----------------------- DISCORD BOT -----------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message]
});

client.once('ready', () => {
  console.log(`ZeppBot online jako ${client.user.tag}`);
});

// ----------------------- KOMENDY -----------------------
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;
    const guild = interaction.guild;
    const user = interaction.user;
    const serverId = guild.id;
    const userId = user.id;
    const modTag = `${user.username}#${user.discriminator || '0000'}`;

    let isAdmin = false;
    try {
      const m = await guild.members.fetch(userId);
      isAdmin = m.permissions.has('Administrator') || m.permissions.has('ManageGuild');
    } catch {}

    const data = await readData();
    data.economy[serverId] = data.economy[serverId] || {};
    data.shop[serverId] = data.shop[serverId] || [];
    const eco = data.economy[serverId];
    const shop = data.shop[serverId];

    function getUserEconomy(id) {
      eco[id] = eco[id] || { balance: 0, lastWork: 0, lastDaily: 0, lastWeekly: 0 };
      return eco[id];
    }

    // ------------------- HELP -------------------
    if (cmd === 'help') {
      return interaction.reply({
        content:
          'Komendy:\nModeracja: warn kick ban mute unmute panelogon\nEkonomia: balance work daily weekly pay addmoney\nSklep: shop buy additem deleteitem',
        ephemeral: true
      });
    }

    // ------------------- INFO -------------------
    if (cmd === 'info') {
      return interaction.reply({ content: 'ZeppBot — moderacja + ekonomia + sklep + panel.', ephemeral: true });
    }

    // ------------------- PANELOGON -------------------
    if (cmd === 'panelogon') {
      const password = interaction.options.getString('password', true);
      data.servers[serverId] = data.servers[serverId] || {};
      data.servers[serverId].panel_password = password;
      await writeData(data);
      return interaction.reply({ content: `Hasło panelu ustawione!\nID serwera: ${serverId}`, ephemeral: true });
    }

    // ------------------- PERMISJE -------------------
    if (['warn','kick','ban','mute','unmute','addmoney','additem','deleteitem'].includes(cmd) && !isAdmin) {
      return interaction.reply({ content: 'Ta komenda jest tylko dla adminów.', ephemeral: true });
    }

    // ------------------- MODERACJA -------------------
    if (cmd === 'warn') {
      const target = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'Brak powodu';
      data.logs.unshift({ server: serverId, user: target.id, action: 'warn', moderator: modTag, reason, time: new Date().toISOString() });
      await writeData(data);
      return interaction.reply({ content: `⚠️ Ostrzeżono ${target.tag}`, ephemeral: true });
    }

    if (cmd === 'kick') {
      const target = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'Brak powodu';
      try { await guild.members.fetch(target.id).then(m => m.kick(reason)); } catch (e) { return interaction.reply({ content: `Błąd: ${e.message}`, ephemeral: true }); }
      data.logs.unshift({ server: serverId, user: target.id, action: 'kick', moderator: modTag, reason, time: new Date().toISOString() });
      await writeData(data);
      return interaction.reply({ content: `🔨 Wyrzucono ${target.tag}`, ephemeral: true });
    }

    if (cmd === 'ban') {
      const target = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'Brak powodu';
      try { await guild.members.ban(target.id, { reason }); } catch (e) { return interaction.reply({ content: `Błąd: ${e.message}`, ephemeral: true }); }
      data.bans[target.id] = { server: serverId, moderator: modTag, reason, time: new Date().toISOString() };
      data.logs.unshift({ server: serverId, user: target.id, action: 'ban', moderator: modTag, reason, time: new Date().toISOString() });
      await writeData(data);
      return interaction.reply({ content: `🚫 Zbanowano ${target.tag}`, ephemeral: true });
    }

    if (cmd === 'mute') {
      const target = interaction.options.getUser('user', true);
      const duration = interaction.options.getString('duration');
      data.mutes[target.id] = { server: serverId, moderator: modTag, duration, time: new Date().toISOString() };
      data.logs.unshift({ server: serverId, user: target.id, action: 'mute', moderator: modTag, reason: duration || 'manual', time: new Date().toISOString() });
      await writeData(data);
      return interaction.reply({ content: `🔇 Wyciszono ${target.tag}`, ephemeral: true });
    }

    if (cmd === 'unmute') {
      const target = interaction.options.getUser('user', true);
      delete data.mutes[target.id];
      data.logs.unshift({ server: serverId, user: target.id, action: 'unmute', moderator: modTag, reason:'manual', time: new Date().toISOString() });
      await writeData(data);
      return interaction.reply({ content: `🔊 Odciszono ${target.tag}`, ephemeral: true });
    }

    // ------------------- EKONOMIA -------------------
    if (cmd === 'balance') {
      const u = getUserEconomy(userId);
      return interaction.reply({ content: `💰 Masz **${u.balance}** monet.`, ephemeral: true });
    }

    if (cmd === 'work') {
      const u = getUserEconomy(userId);
      const now = Date.now();
      if (now - u.lastWork < 10*60*1000) return interaction.reply({ content: '⏳ Poczekaj kilka minut', ephemeral: true });
      const earn = Math.floor(Math.random()*80)+20;
      u.balance += earn; u.lastWork = now;
      await writeData(data);
      return interaction.reply({ content: `🛠️ Zarobiłeś **${earn}** monet!`, ephemeral: true });
    }

    if (cmd === 'daily') {
      const u = getUserEconomy(userId);
      const now = Date.now();
      if (now - u.lastDaily < 24*60*60*1000) return interaction.reply({ content: '❌ Odebrałeś już daily!', ephemeral: true });
      u.lastDaily = now; u.balance += 250;
      await writeData(data);
      return interaction.reply({ content: '🎁 +250 monet!', ephemeral: true });
    }

    if (cmd === 'weekly') {
      const u = getUserEconomy(userId);
      const now = Date.now();
      if (now - u.lastWeekly < 7*24*60*60*1000) return interaction.reply({ content: '❌ Odebrałeś już weekly!', ephemeral: true });
      u.lastWeekly = now; u.balance += 2000;
      await writeData(data);
      return interaction.reply({ content: '💎 +2000 monet!', ephemeral: true });
    }

    if (cmd === 'addmoney') {
      const target = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      const u = getUserEconomy(target.id);
      u.balance += amount;
      await writeData(data);
      return interaction.reply({ content: `💵 Dodano ${amount} monet ${target.tag}`, ephemeral: true });
    }

    // ------------------- PAY -------------------
    if (cmd === 'pay') {
      const target = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      if (target.id === userId) return interaction.reply({ content: '❌ Nie możesz zapłacić sobie.', ephemeral: true });
      const u = getUserEconomy(userId);
      const t = getUserEconomy(target.id);
      if (u.balance < amount) return interaction.reply({ content: '❌ Brak pieniędzy.', ephemeral: true });
      u.balance -= amount; t.balance += amount;
      await writeData(data);
      return interaction.reply({ content: `💸 Wysłałeś ${amount} monet do ${target.tag}`, ephemeral: true });
    }

    // ------------------- SHOP -------------------
    if (cmd === 'shop') {
      if (shop.length===0) return interaction.reply({ content:'🛒 Sklep jest pusty.', ephemeral:true });
      let txt = '🛒 **Sklep serwera:**\n\n';
      shop.forEach((item,i)=>{
        txt+=`**${i+1}. ${item.name}** — ${item.price} monet\n${item.desc || ""}\n\n`;
      });
      return interaction.reply({ content: txt, ephemeral:true });
    }

    if (cmd === 'buy') {
      const id = interaction.options.getInteger('item', true)-1;
      if (!shop[id]) return interaction.reply({ content:'❌ Nie ma takiego przedmiotu.', ephemeral:true });
      const item = shop[id];
      const u = getUserEconomy(userId);

      if (item.requiresrole) {
        const member = await guild.members.fetch(userId);
        if (!member.roles.cache.has(item.requiresrole)) {
          return interaction.reply({ content: '❌ Nie masz wymaganej roli, aby kupić ten przedmiot.', ephemeral:true });
        }
      }

      if (u.balance<item.price) return interaction.reply({ content:'❌ Za mało monet!', ephemeral:true });
      u.balance-=item.price;

      if (item.giverole && item.role) {
        try { (await guild.members.fetch(userId)).roles.add(item.role); } catch(e){ console.error(e); }
      }

      data.logs.unshift({ server: serverId, user:userId, action:'buy', item:item.name, price:item.price, time:new Date().toISOString() });
      await writeData(data);

      return interaction.reply({ content:`🛒 Kupiono: **${item.name}**`, ephemeral:true });
    }

    // ------------------- ADDITEM -------------------
    if (cmd==='additem') {
      const name = interaction.options.getString('name', true);
      const price = interaction.options.getInteger('price', true);
      const desc = interaction.options.getString('desc') || '';
      const giverole = interaction.options.getBoolean('giverole') || false;
      const role = interaction.options.getRole('role')?.id || '';
      const requiresrole = interaction.options.getRole('requiresrole')?.id || '';

      data.shop[serverId].push({ name, desc, price, giverole, role, requiresrole });
      await writeData(data);
      return interaction.reply({ content:`✅ Dodano przedmiot: ${name}`, ephemeral:true });
    }

    // ------------------- DELETEITEM -------------------
    if (cmd==='deleteitem') {
      const id = interaction.options.getInteger('id', true)-1;
      const confirm = interaction.options.getBoolean('confirm', true);
      if (!shop[id]) return interaction.reply({ content:'❌ Nie ma takiego przedmiotu.', ephemeral:true });
      if (!confirm) return interaction.reply({ content:'❌ Potwierdź usunięcie.', ephemeral:true });

      const removed = shop.splice(id,1)[0];
      await writeData(data);
      return interaction.reply({ content:`🗑️ Usunięto przedmiot: ${removed.name}`, ephemeral:true });
    }

  } catch(err){
    console.error('interaction error', err);
  }
});

// ------------------- PANEL WWW -------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

app.post('/api/login', async (req,res)=>{
  const { serverId, password } = req.body;
  const data = await readData();
  if (!data.servers[serverId]) return res.status(404).json({ error:'Panel nie skonfigurowany.' });
  if (data.servers[serverId].panel_password!==password) return res.status(403).json({ error:'Złe hasło.' });
  res.json({ ok:true });
});

app.get('/api/logs/:serverId', async (req,res)=>{
  const data = await readData();
  res.json(data.logs.filter(l=>String(l.server)===req.params.serverId).slice(0,200));
});

// ---------- API SKLEPU ----------
app.get('/api/shop/:serverId', async (req,res)=>{
  const data = await readData();
  const shop = data.shop[req.params.serverId] || [];
  res.json(shop);
});

app.post('/api/shop/:serverId', async (req,res)=>{
  const serverId = req.params.serverId;
  const { name, desc='', price, giverole=false, role='', requiresrole='' } = req.body;
  const data = await readData();
  data.shop[serverId] = data.shop[serverId] || [];
  data.shop[serverId].push({ name, desc, price, giverole, role, requiresrole });
  await writeData(data);
  res.json({ ok:true });
});

app.delete('/api/shop/:serverId/:index', async (req,res)=>{
  const serverId = req.params.serverId;
  const index = parseInt(req.params.index);
  const data = await readData();
  data.shop[serverId] = data.shop[serverId] || [];
  if (!data.shop[serverId][index]) return res.status(404).json({ error:'Nie istnieje' });
  data.shop[serverId].splice(index,1);
  await writeData(data);
  res.json({ ok:true });
});

// -------------------
app.listen(PORT, () => console.log(`Panel aktywny na porcie ${PORT}`));
client.login(process.env.DISCORD_TOKEN);