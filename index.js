/**
 * ZeppBot (full)
 * Moderacja + Ekonomia + Sklep + Tickety + Leaderboard widgets + Panel WWW
 *
 * Uwaga: plik korzysta z data.json w katalogu bota.
 */

require('dotenv').config();
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  EmbedBuilder
} = require('discord.js');

const DATA_FILE = path.join(__dirname, 'data.json'); // <- jeśli masz inny plik, zmień tutaj
const PORT = process.env.PORT || 3000;
const WIDGET_REFRESH_MS = 60 * 1000; // 60 sekund

// --- Ensure data.json exists with structure ---
function ensureData() {
  if (!fs.existsSync(DATA_FILE)) {
    const init = {
      servers: {},    // server-specific config (panel password etc)
      logs: [],       // moderation & purchase logs
      mutes: {},
      bans: {},
      economy: {},    // per-server economy: economy[serverId][userId] = {...}
      shop: {},       // per-server shop arrays
      widgets: [],    // widgets array { id, serverId, channelId, messageId, type }
      tickets: {}     // per-server ticket metadata
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2), 'utf8');
  }
}
ensureData();

async function readData() {
  const raw = await fsp.readFile(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}
async function writeData(obj) {
  // atomic write
  await fsp.writeFile(DATA_FILE + '.tmp', JSON.stringify(obj, null, 2), 'utf8');
  await fsp.rename(DATA_FILE + '.tmp', DATA_FILE);
}

// ----------------------- Discord Client -----------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel]
});

client.once('ready', async () => {
  console.log(`ZeppBot online jako ${client.user.tag}`);
  // Start widget refresher
  try { startWidgetRefresher(); } catch (e) { console.error('Widget refresher start error', e); }
});

// Helper: check admin perms in guild
async function isAdmin(guild, userId) {
  try {
    const m = await guild.members.fetch(userId);
    return m.permissions.has(PermissionsBitField.Flags.Administrator) || m.permissions.has(PermissionsBitField.Flags.ManageGuild);
  } catch (e) {
    return false;
  }
}

// Helper econ getter
function ensureServerStructures(data, serverId) {
  data.economy[serverId] = data.economy[serverId] || {};
  data.shop[serverId] = data.shop[serverId] || [];
  data.tickets[serverId] = data.tickets[serverId] || { lastTicketId: 0, openTickets: {} };
}

// ensure user economy object
function getUserEconomyObj(data, serverId, userId) {
  ensureServerStructures(data, serverId);
  const eco = data.economy[serverId];
  eco[userId] = eco[userId] || { balance: 0, lastWork: 0, lastDaily: 0, lastWeekly: 0, totalSpent: 0, itemsBought: 0 };
  return eco[userId];
}

// ----------------------- Interaction handling (commands & buttons) -----------------------
client.on('interactionCreate', async (interaction) => {
  try {
    // Button interactions (ticket open)
    if (interaction.isButton()) {
      const custom = interaction.customId;
      // ticket open button id: 'open_ticket::<serverId>'
      if (custom && custom.startsWith('open_ticket::')) {
        const serverId = custom.split('::')[1];
        await handleOpenTicketButton(interaction, serverId);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;
    const guild = interaction.guild;
    const user = interaction.user;

    if (!guild) return interaction.reply({ content: 'Ta komenda działa tylko na serwerze.', ephemeral: true });

    const serverId = guild.id;
    const userId = user.id;
    const modTag = `${user.username}#${user.discriminator || '0000'}`;

    // load data fresh per interaction
    const data = await readData();
    ensureServerStructures(data, serverId);
    const eco = data.economy[serverId];
    const shop = data.shop[serverId];
    const ticketsMeta = data.tickets[serverId];

    // permissions for admin-only commands
    const adminOnly = ['warn','kick','ban','mute','unmute','addmoney','additem','deleteitem','addwidget','delwidget','addticketpanel','addadmin','removeadmin','close'];
    if (adminOnly.includes(cmd)) {
      const ok = await isAdmin(guild, userId);
      if (!ok) return interaction.reply({ content: 'Ta komenda jest tylko dla adminów.', ephemeral: true });
    }

    // --- HELP / INFO ---
    if (cmd === 'help') {
      return interaction.reply({
        content: 'Komendy:\nModeracja: warn kick ban mute unmute panelogon\nEkonomia: balance work daily weekly pay addmoney\nSklep: shop buy additem deleteitem\nTicket: addticketpanel close addadmin removeadmin\nWidgety: addwidget delwidget',
        ephemeral: true
      });
    }
    if (cmd === 'info') {
      return interaction.reply({ content: 'ZeppBot — moderacja + ekonomia + sklep + ticket + leaderboard', ephemeral: true });
    }

    // --- PANEL PASSWORD ---
    if (cmd === 'panelogon') {
      const password = interaction.options.getString('password', true);
      data.servers[serverId] = data.servers[serverId] || {};
      data.servers[serverId].panel_password = password;
      await writeData(data);
      return interaction.reply({ content: `Hasło panelu ustawione!\nID serwera: ${serverId}`, ephemeral: true });
    }

    // ---------------- MODERACJA ----------------
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
      try { await guild.members.fetch(target.id).then(m => m.kick(reason)); }
      catch (e) { return interaction.reply({ content: `Błąd: ${e.message}`, ephemeral: true }); }
      data.logs.unshift({ server: serverId, user: target.id, action: 'kick', moderator: modTag, reason, time: new Date().toISOString() });
      await writeData(data);
      return interaction.reply({ content: `🔨 Wyrzucono ${target.tag}`, ephemeral: true });
    }

    if (cmd === 'ban') {
      const target = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'Brak powodu';
      try { await guild.members.ban(target.id, { reason }); }
      catch (e) { return interaction.reply({ content: `Błąd: ${e.message}`, ephemeral: true }); }
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

    // ---------------- EKONOMIA ----------------
    if (cmd === 'balance') {
      const u = getUserEconomyObj(data, serverId, userId);
      return interaction.reply({ content: `💰 Masz **${u.balance}** monet.`, ephemeral: true });
    }

    if (cmd === 'work') {
      const u = getUserEconomyObj(data, serverId, userId);
      const now = Date.now();
      if (now - u.lastWork < 10 * 60 * 1000) return interaction.reply({ content: '⏳ Poczekaj kilka minut', ephemeral: true });
      const earn = Math.floor(Math.random() * 80) + 20;
      u.balance += earn; u.lastWork = now;
      await writeData(data);
      return interaction.reply({ content: `🛠️ Zarobiłeś **${earn}** monet!`, ephemeral: true });
    }

    if (cmd === 'daily') {
      const u = getUserEconomyObj(data, serverId, userId);
      const now = Date.now();
      if (now - u.lastDaily < 24 * 60 * 60 * 1000) return interaction.reply({ content: '❌ Odebrałeś już daily!', ephemeral: true });
      u.lastDaily = now; u.balance += 250;
      await writeData(data);
      return interaction.reply({ content: '🎁 +250 monet!', ephemeral: true });
    }

    if (cmd === 'weekly') {
      const u = getUserEconomyObj(data, serverId, userId);
      const now = Date.now();
      if (now - u.lastWeekly < 7 * 24 * 60 * 60 * 1000) return interaction.reply({ content: '❌ Odebrałeś już weekly!', ephemeral: true });
      u.lastWeekly = now; u.balance += 2000;
      await writeData(data);
      return interaction.reply({ content: '💎 +2000 monet!', ephemeral: true });
    }

    if (cmd === 'addmoney') {
      const target = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      const u = getUserEconomyObj(data, serverId, target.id);
      u.balance += amount;
      await writeData(data);
      return interaction.reply({ content: `💵 Dodano ${amount} monet ${target.tag}`, ephemeral: true });
    }

    if (cmd === 'pay') {
      const target = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      if (target.id === userId) return interaction.reply({ content: '❌ Nie możesz zapłacić sobie.', ephemeral: true });
      const u = getUserEconomyObj(data, serverId, userId);
      const t = getUserEconomyObj(data, serverId, target.id);
      if (u.balance < amount) return interaction.reply({ content: '❌ Brak pieniędzy.', ephemeral: true });
      u.balance -= amount; t.balance += amount;
      await writeData(data);
      data.logs.unshift({ server: serverId, user: userId, action: 'pay', to: target.id, amount, time: new Date().toISOString() });
      await writeData(data);
      return interaction.reply({ content: `💸 Wysłałeś ${amount} monet do ${target.tag}`, ephemeral: true });
    }

    // ---------------- SHOP (commands) ----------------
    if (cmd === 'shop') {
      const shopList = data.shop[serverId] || [];
      if (shopList.length === 0) return interaction.reply({ content: '🛒 Sklep jest pusty.', ephemeral: true });
      let txt = '🛒 **Sklep serwera:**\n\n';
      shopList.forEach((item, i) => {
        txt += `**${i + 1}. ${item.name}** — ${item.price} monet\n${item.desc || ''}\n`;
        if (item.giverole) txt += `_Daje rolę po zakupie._\n`;
        if (item.requiresrole) txt += `_Wymagana rola: <@&${item.requiresrole}>_\n`;
        txt += '\n';
      });
      return interaction.reply({ content: txt, ephemeral: true });
    }

    if (cmd === 'buy') {
      const idnum = interaction.options.getInteger('item', true) - 1;
      const shopList = data.shop[serverId] || [];
      if (!shopList[idnum]) return interaction.reply({ content: '❌ Nie ma takiego przedmiotu.', ephemeral: true });
      const item = shopList[idnum];
      const u = getUserEconomyObj(data, serverId, userId);

      // requiresrole check
      if (item.requiresrole) {
        try {
          const member = await guild.members.fetch(userId);
          if (!member.roles.cache.has(item.requiresrole)) {
            return interaction.reply({ content: '❌ Nie masz wymaganej roli, aby kupić ten przedmiot.', ephemeral: true });
          }
        } catch (e) { /* ignore */ }
      }

      if (u.balance < item.price) return interaction.reply({ content: '❌ Za mało monet!', ephemeral: true });
      u.balance -= item.price;
      u.totalSpent = (u.totalSpent || 0) + item.price;
      u.itemsBought = (u.itemsBought || 0) + 1;

      // giverole
      if (item.giverole && item.role) {
        try { (await guild.members.fetch(userId)).roles.add(item.role); } catch (e) { console.error('Role add failed', e); }
      }

      data.logs.unshift({ server: serverId, user: userId, action: 'buy', item: item.name, price: item.price, time: new Date().toISOString() });
      await writeData(data);
      return interaction.reply({ content: `🛒 Kupiono: **${item.name}**`, ephemeral: true });
    }

    // ---------------- additem / deleteitem (admin) ----------------
    if (cmd === 'additem') {
      const name = interaction.options.getString('name', true);
      const price = interaction.options.getInteger('price', true);
      const desc = interaction.options.getString('desc') || '';
      const giverole = interaction.options.getBoolean('giverole') || false;
      const roleId = interaction.options.getRole('role')?.id || '';
      const requiresrole = interaction.options.getRole('requiresrole')?.id || '';

      data.shop[serverId] = data.shop[serverId] || [];
      const item = { id: Date.now(), name, desc, price, giverole, role: roleId, requiresrole };
      data.shop[serverId].push(item);
      await writeData(data);
      return interaction.reply({ content: `✅ Dodano przedmiot: ${name}`, ephemeral: true });
    }

    if (cmd === 'deleteitem') {
      const id = interaction.options.getInteger('id', true) - 1;
      const shopList = data.shop[serverId] || [];
      if (!shopList[id]) return interaction.reply({ content: '❌ Nie ma takiego przedmiotu.', ephemeral: true });
      const removed = shopList.splice(id, 1)[0];
      data.shop[serverId] = shopList;
      await writeData(data);
      return interaction.reply({ content: `🗑️ Usunięto przedmiot: ${removed.name}`, ephemeral: true });
    }

    // ---------------- WIDGETS (addwidget, delwidget) ----------------
    if (cmd === 'addwidget') {
      const type = interaction.options.getString('type', true).toUpperCase(); // A/B/C
      const channel = interaction.options.getChannel('channel', true);

      if (!['A','B','C'].includes(type)) return interaction.reply({ content: '❌ Typ widgetu musi być A, B lub C', ephemeral: true });

      // create embed initially
      const embed = createLeaderboardEmbed(data, serverId, type);
      const sent = await channel.send({ embeds: [embed] });

      // store widget
      const wid = { id: Date.now().toString(), serverId, channelId: channel.id, messageId: sent.id, type };
      data.widgets.push(wid);
      await writeData(data);

      return interaction.reply({ content: `✅ Widget dodany (ID: ${wid.id})`, ephemeral: true });
    }

    if (cmd === 'delwidget') {
      const wid = interaction.options.getString('id', true);
      const idx = data.widgets.findIndex(w => w.id === wid && w.serverId === serverId);
      if (idx === -1) return interaction.reply({ content: '❌ Nie znaleziono widgetu o podanym ID.', ephemeral: true });
      data.widgets.splice(idx,1);
      await writeData(data);
      return interaction.reply({ content: '🗑️ Usunięto widget', ephemeral: true });
    }

    // ---------------- TICKETS (panel create) ----------------
    if (cmd === 'addticketpanel') {
      const channel = interaction.options.getChannel('channel', true);
      const title = interaction.options.getString('title') || 'Otwórz ticket';
      const desc = interaction.options.getString('description') || 'Kliknij przycisk, aby utworzyć ticket.';
      const btn = new ButtonBuilder().setCustomId(`open_ticket::${serverId}`).setLabel('Otwórz ticket').setStyle(ButtonStyle.Primary);
      const row = new ActionRowBuilder().addComponents(btn);
      const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0x00AAFF);
      await channel.send({ embeds: [embed], components: [row] });

      // ensure tickets meta exists
      data.tickets[serverId] = data.tickets[serverId] || { lastTicketId: 0, openTickets: {} };
      await writeData(data);
      return interaction.reply({ content: `✅ Panel ticketowy wysłany do ${channel}`, ephemeral: true });
    }

    // /close (close ticket) - admin only or channel owner
    if (cmd === 'close') {
      // expects to be run inside ticket channel or provide channel option
      let targetChannel = interaction.channel;
      const argChannel = interaction.options.getChannel('channel');
      if (argChannel) targetChannel = argChannel;

      // find ticket metadata by channel id
      const tm = data.tickets[serverId] || { openTickets: {} };
      const ticketEntry = Object.entries(tm.openTickets).find(([tid, info]) => info.channelId === targetChannel.id);
      if (!ticketEntry) return interaction.reply({ content: '❌ To nie wygląda jak kanał ticketowy.', ephemeral: true });

      const [ticketId, info] = ticketEntry;
      // archive = delete channel or set perms? we'll delete channel
      try {
        await targetChannel.delete(`Ticket ${ticketId} closed by ${interaction.user.tag}`);
      } catch (e) {
        return interaction.reply({ content: `Błąd przy usuwaniu kanału: ${e.message}`, ephemeral: true });
      }

      delete tm.openTickets[ticketId];
      data.tickets[serverId] = tm;
      data.logs.unshift({ server: serverId, user: interaction.user.id, action: 'ticket_close', ticket: ticketId, time: new Date().toISOString() });
      await writeData(data);
      return; // channel was deleted so no reply
    }

    // /addadmin /removeadmin for ticket (admin only)
    if (cmd === 'addadmin' || cmd === 'removeadmin') {
      const member = interaction.options.getMember('user', true);
      // must be executed in ticket channel
      const tm = data.tickets[serverId] || { openTickets: {} };
      const ticketEntry = Object.entries(tm.openTickets).find(([tid, info]) => info.channelId === interaction.channel.id);
      if (!ticketEntry) return interaction.reply({ content: 'Ta komenda działa tylko w kanale ticketowym.', ephemeral: true });
      const [ticketId, info] = ticketEntry;

      try {
        if (cmd === 'addadmin') {
          await interaction.channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true });
          interaction.reply({ content: `✅ Dodano ${member.user.tag} do ticketu.`, ephemeral: true });
        } else {
          await interaction.channel.permissionOverwrites.delete(member.id);
          interaction.reply({ content: `✅ Usunięto ${member.user.tag} z ticketu.`, ephemeral: true });
        }
      } catch (e) {
        interaction.reply({ content: `Błąd: ${e.message}`, ephemeral: true });
      }
      return;
    }

    // If command not matched, ignore
  } catch (err) {
    console.error('interaction error', err);
    try { if (interaction && !interaction.replied) interaction.reply({ content: 'Błąd serwera.', ephemeral: true }); } catch(e) {}
  }
});

// ----------------------- Helper functions for widgets & tickets -----------------------

function createLeaderboardEmbed(data, serverId, type) {
  const eco = (data.economy && data.economy[serverId]) || {};
  // prepare array with stats for types:
  // A => balance, B => totalSpent, C => itemsBought
let arr = Object.entries(eco).map(([uid, obj]) => {
    let value = 0;
    if (type === 'A') value = obj.balance || 0;
    else if (type === 'B') value = obj.totalSpent || 0;
    else if (type === 'C') value = obj.itemsBought || 0;
    return { uid, value };
  });

  // sort descending
  arr.sort((a, b) => b.value - a.value);

  const top = arr.slice(0, 10); // top 10
  let desc = '';
  for (let i = 0; i < top.length; i++) {
    const entry = top[i];
    desc += `**${i + 1}.** <@${entry.uid}> — ${entry.value}\n`;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Leaderboard ${type}`)
    .setDescription(desc || 'Brak danych')
    .setColor(0x00FFAA)
    .setTimestamp();

  return embed;
}

// Widget refresher: update all widget messages every WIDGET_REFRESH_MS
async function startWidgetRefresher() {
  setInterval(async () => {
    try {
      const data = await readData();
      for (const wid of data.widgets || []) {
        try {
          const guild = await client.guilds.fetch(wid.serverId);
          const channel = await guild.channels.fetch(wid.channelId);
          if (!channel || !channel.isTextBased()) continue;
          const message = await channel.messages.fetch(wid.messageId).catch(() => null);
          if (!message) continue;
          const embed = createLeaderboardEmbed(data, wid.serverId, wid.type);
          await message.edit({ embeds: [embed] });
        } catch (e) {
          console.error('Widget update error', e);
        }
      }
    } catch (e) { console.error('Widget refresher loop error', e); }
  }, WIDGET_REFRESH_MS);
}

// Ticket button handler
async function handleOpenTicketButton(interaction, serverId) {
  const data = await readData();
  ensureServerStructures(data, serverId);
  const ticketsMeta = data.tickets[serverId];

  const userId = interaction.user.id;
  // create channel name
  ticketsMeta.lastTicketId = (ticketsMeta.lastTicketId || 0) + 1;
  const ticketId = ticketsMeta.lastTicketId;
  const guild = interaction.guild;

  const channelName = `ticket-${ticketId}`;
  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });
  } catch (e) {
    return interaction.reply({ content: `Błąd przy tworzeniu kanału ticketowego: ${e.message}`, ephemeral: true });
  }

  ticketsMeta.openTickets[ticketId] = { channelId: channel.id, ownerId: userId, created: new Date().toISOString() };
  data.tickets[serverId] = ticketsMeta;
  await writeData(data);

  const embed = new EmbedBuilder().setTitle('Ticket').setDescription('Twój ticket został utworzony. Czekaj na obsługę.').setColor(0x00AAFF);
  await channel.send({ content: `<@${userId}>`, embeds: [embed] });
  await interaction.reply({ content: `✅ Ticket utworzony: ${channel}`, ephemeral: true });
}

// ----------------------- Express Panel -----------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// panel login
app.post('/api/login', async (req, res) => {
  const { serverId, password } = req.body;
  const data = await readData();
  if (!data.servers[serverId]) return res.status(404).json({ error: 'Panel nie skonfigurowany.' });
  if (data.servers[serverId].panel_password !== password) return res.status(403).json({ error: 'Złe hasło.' });
  res.json({ ok: true });
});

// logs API
app.get('/api/logs/:serverId', async (req, res) => {
  const data = await readData();
  res.json(data.logs.filter(l => String(l.server) === req.params.serverId).slice(0, 200));
});

// shop API
app.get('/api/shop/:serverId', async (req, res) => {
  const data = await readData();
  res.json(data.shop[req.params.serverId] || []);
});
app.post('/api/shop/:serverId', async (req, res) => {
  const serverId = req.params.serverId;
  const { name, desc, price } = req.body;
  const data = await readData();
  data.shop[serverId] = data.shop[serverId] || [];
  data.shop[serverId].push({ name, desc, price });
  await writeData(data);
  res.json({ ok: true });
});
app.delete('/api/shop/:serverId/:index', async (req, res) => {
  const serverId = req.params.serverId;
  const index = parseInt(req.params.index);
  const data = await readData();
  data.shop[serverId] = data.shop[serverId] || [];
  if (!data.shop[serverId][index]) return res.status(404).json({ error: 'Nie istnieje' });
  data.shop[serverId].splice(index, 1);
  await writeData(data);
  res.json({ ok: true });
});

// -----------------------
app.listen(PORT, () => console.log(`Panel aktywny na porcie ${PORT}`));
client.login(process.env.DISCORD_TOKEN);
