/**
 * ZeppBot (complete)
 * Moderacja + Ekonomia + Sklep + Tickety + Leaderboard widgets + Panel WWW
 *
 * Uses data.json (creates it automatically if missing).
 *
 * Requirements:
 *  - Node 18+
 *  - discord.js v14
 *  - npm install discord.js express body-parser cors dotenv
 *
 * Notes:
 *  - Make sure your environment variable DISCORD_TOKEN (or TOKEN) and CLIENT_ID (for deploy)
 *    are set in a .env file or in environment.
 *  - This file is intended for environments with persistent filesystem (Termux, VPS).
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
  EmbedBuilder
} = require('discord.js');

const DATA_FILE = path.join(__dirname, 'data.json'); // change if you want
const PORT = process.env.PORT || 3000;
const WIDGET_REFRESH_MS = 60 * 1000; // 60s

// ------------------------ data.json helpers ------------------------
function ensureData() {
  if (!fs.existsSync(DATA_FILE)) {
    const init = {
      servers: {},    // server-specific config (panel password etc)
      logs: [],       // moderation & purchase logs
      mutes: {},
      bans: {},
      economy: {},    // economy[serverId][userId] = { balance,...}
      shop: {},       // shop[serverId] = [ { id,name,desc,price,giverole,role,requiresrole } ]
      widgets: [],    // { id, serverId, channelId, messageId, type }
      tickets: {}     // tickets[serverId] = { lastTicketId, openTickets: { ticketId: { channelId, ownerId } } }
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2), 'utf8');
  }
}
ensureData();

async function readData() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    // if parse error, create fresh structure to avoid crashes
    console.error('readData error, recreating file:', e.message);
    const init = {
      servers: {},
      logs: [],
      mutes: {},
      bans: {},
      economy: {},
      shop: {},
      widgets: [],
      tickets: {}
    };
    await fsp.writeFile(DATA_FILE, JSON.stringify(init, null, 2), 'utf8');
    return init;
  }
}

async function writeData(obj) {
  // atomic write
  const tmp = DATA_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fsp.rename(tmp, DATA_FILE);
}

// Utility to ensure server structures exist
function ensureServerStructures(data, serverId) {
  data.economy = data.economy || {};
  data.shop = data.shop || {};
  data.tickets = data.tickets || {};
  data.widgets = data.widgets || [];
  data.servers = data.servers || {};

  data.economy[serverId] = data.economy[serverId] || {};
  data.shop[serverId] = data.shop[serverId] || [];
  data.tickets[serverId] = data.tickets[serverId] || { lastTicketId: 0, openTickets: {} };
}

// ensure user econ object
function getUserEconomyObj(data, serverId, userId) {
  ensureServerStructures(data, serverId);
  const eco = data.economy[serverId];
  eco[userId] = eco[userId] || { balance: 0, lastWork: 0, lastDaily: 0, lastWeekly: 0, totalSpent: 0, itemsBought: 0 };
  return eco[userId];
}

// ----------------------- Discord client -----------------------
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
  // start widget refresher
  try {
    startWidgetRefresher();
  } catch (e) {
    console.error('startWidgetRefresher error', e);
  }
});

// Helper: check admin (Administrator or ManageGuild)
async function isAdmin(guild, userId) {
  try {
    const member = await guild.members.fetch(userId);
    return member.permissions.has(PermissionsBitField.Flags.Administrator) || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
  } catch (e) {
    return false;
  }
}

// ----------------------- Leaderboard embed & refresher -----------------------
function createLeaderboardEmbed(data, serverId, type) {
  const eco = (data.economy && data.economy[serverId]) || {};
  // build array: { id, balance, totalSpent, itemsBought }
  const arr = Object.entries(eco).map(([id, obj]) => ({
    id,
    balance: obj.balance || 0,
    totalSpent: obj.totalSpent || 0,
    itemsBought: obj.itemsBought || 0
  }));

  let sorted;
  let title;
  if (type === 'A') {
    sorted = arr.sort((a, b) => b.balance - a.balance);
    title = '🏆 TOP 10 — Salda (Balance)';
  } else if (type === 'B') {
    sorted = arr.sort((a, b) => b.totalSpent - a.totalSpent);
    title = '💸 TOP 10 — Wydane pieniądze';
  } else { // 'C'
    sorted = arr.sort((a, b) => b.itemsBought - a.itemsBought);
    title = '🪙 TOP 10 — Ilość zakupów';
  }

  const top = sorted.slice(0, 10);
  const description = top.length > 0
    ? top.map((u, i) => {
        const val = (type === 'A') ? u.balance : (type === 'B') ? u.totalSpent : u.itemsBought;
        return `**${i + 1}.** <@${u.id}> — **${val}**`;
      }).join('\n')
    : 'Brak danych';

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xF1C40F)
    .setTimestamp();

  return embed;
}

let widgetRefresherRunning = false;
function startWidgetRefresher() {
  if (widgetRefresherRunning) return;
  widgetRefresherRunning = true;

  setInterval(async () => {
    try {
      const data = await readData();
      const widgets = data.widgets || [];
      for (const w of widgets) {
        try {
          // ensure server still exists in client
          const guild = client.guilds.cache.get(w.serverId) || await client.guilds.fetch(w.serverId).catch(()=>null);
          if (!guild) continue;
          const channel = guild.channels.cache.get(w.channelId) || await guild.channels.fetch(w.channelId).catch(()=>null);
          if (!channel || !channel.isTextBased()) continue;
          const message = await channel.messages.fetch(w.messageId).catch(()=>null);
          if (!message) continue;

          const embed = createLeaderboardEmbed(data, w.serverId, w.type);
          await message.edit({ embeds: [embed] }).catch(()=>null);
        } catch (errWidget) {
          console.error('widget update failed for', w, errWidget && errWidget.message ? errWidget.message : errWidget);
        }
      }
    } catch (err) {
      console.error('widget refresher loop error', err && err.message ? err.message : err);
    }
  }, WIDGET_REFRESH_MS);
}

// ----------------------- Ticket button handler -----------------------
async function handleOpenTicketButton(interaction, serverId) {
  try {
    await interaction.deferReply({ ephemeral: true }).catch(()=>{});
    const guild = interaction.guild;
    const user = interaction.user;
    if (!guild) return interaction.editReply({ content: 'Błąd: brak guild', ephemeral: true });

    const data = await readData();
    ensureServerStructures(data, guild.id);
    const tm = data.tickets[guild.id];

    // create ticket id
    tm.lastTicketId = (tm.lastTicketId || 0) + 1;
    const ticketId = tm.lastTicketId.toString().padStart(4, '0');

    // channel name
    const channelName = `ticket-${ticketId}`;

    // find category named 'tickets' or similar (optional)
    let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('ticket'));
    const options = {
      type: ChannelType.GuildText,
      topic: `Ticket ${ticketId} by ${user.tag}`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    };
    if (category) options.parent = category.id;

    const channel = await guild.channels.create({ name: channelName, ...options }).catch(e => { throw e; });

    // initial message
    const embed = new EmbedBuilder()
      .setTitle(`Ticket #${ticketId}`)
      .setDescription(`Witaj <@${user.id}>! Opisz swój problem poniżej. Administratorzy zostaną powiadomieni.`)
      .setColor(0x00AAFF)
      .setTimestamp();

    await channel.send({ content: `<@${user.id}>`, embeds: [embed] }).catch(()=>{});

    // persist ticket meta
    tm.openTickets = tm.openTickets || {};
    tm.openTickets[ticketId] = { channelId: channel.id, ownerId: user.id, createdAt: new Date().toISOString() };
    data.tickets[guild.id] = tm;
    data.logs = data.logs || [];
    data.logs.unshift({ server: guild.id, user: user.id, action: 'ticket_open', ticket: ticketId, time: new Date().toISOString() });
    await writeData(data);

    await interaction.editReply({ content: `✅ Utworzono ticket: ${channel}`, ephemeral: true });
  } catch (e) {
    console.error('handleOpenTicketButton error', e && e.message ? e.message : e);
    try { await interaction.editReply({ content: `Błąd przy tworzeniu ticketu: ${e.message || e}`, ephemeral: true }); } catch (ex) {}
  }
}

// ----------------------- Interaction handling (commands & buttons) -----------------------
client.on('interactionCreate', async (interaction) => {
  // catch-all safe handler with error logging
  try {
    // Buttons (ticket open)
    if (interaction.isButton()) {
      const custom = interaction.customId;
      if (typeof custom === 'string' && custom.startsWith('open_ticket::')) {
        const serverId = custom.split('::')[1];
        return handleOpenTicketButton(interaction, serverId);
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

    // load fresh data
    const data = await readData();
    ensureServerStructures(data, serverId);
    const eco = data.economy[serverId];
    const shop = data.shop[serverId];
    const ticketsMeta = data.tickets[serverId];

    // admin-only list
    const adminOnly = ['warn','kick','ban','mute','unmute','addmoney','additem','deleteitem','addwidget','delwidget','addticketpanel','addadmin','removeadmin','close'];
    if (adminOnly.includes(cmd)) {
      const ok = await isAdmin(guild, userId);
      if (!ok) return interaction.reply({ content: 'Ta komenda jest tylko dla adminów.', ephemeral: true });
    }

    // HELP / INFO
    if (cmd === 'help') {
      return interaction.reply({
        content: 'Komendy:\nModeracja: warn kick ban mute unmute panelogon\nEkonomia: balance work daily weekly pay addmoney\nSklep: shop buy additem deleteitem\nTicket: addticketpanel close addadmin removeadmin\nWidgety: addwidget delwidget',
        ephemeral: true
      });
    }
    if (cmd === 'info') {
      return interaction.reply({ content: 'ZeppBot — moderacja + ekonomia + sklep + ticket + leaderboard', ephemeral: true });
    }

    // panelogon
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

  if (!['A','B','C'].includes(type))
    return interaction.reply({ content: '❌ Typ widgetu musi być A, B lub C', ephemeral: true });

  const embed = createLeaderboardEmbed(data, serverId, type);
  const sent = await channel.send({ embeds: [embed] });

  const wid = {
    id: Date.now().toString(),
    serverId,
    channelId: channel.id,
    messageId: sent.id,
    type
  };

  data.widgets.push(wid);
  await writeData(data);

  return interaction.reply({ content: `✅ Widget dodany (ID: ${wid.id})`, ephemeral: true });
}

if (cmd === 'delwidget') {
  const wid = interaction.options.getString('id', true);
  const idx = data.widgets.findIndex(w => w.id === wid && w.serverId === serverId);
  if (idx === -1)
    return interaction.reply({ content: '❌ Nie znaleziono widgetu o podanym ID.', ephemeral: true });

  data.widgets.splice(idx, 1);
  await writeData(data);

  return interaction.reply({ content: '🗑️ Usunięto widget', ephemeral: true });
}
if (cmd === 'addticketpanel') {
  const channel = interaction.options.getChannel('channel', true);
  const title = interaction.options.getString('title') || 'Otwórz ticket';
  const desc = interaction.options.getString('description') || 'Kliknij przycisk, aby utworzyć ticket.';

  const btn = new ButtonBuilder()
    .setCustomId(`open_ticket::${serverId}`)
    .setLabel('Otwórz ticket')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(btn);
  const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0x00AAFF);

  await channel.send({ embeds: [embed], components: [row] });

  data.tickets[serverId] = data.tickets[serverId] || { lastTicketId: 0, openTickets: {} };
  await writeData(data);

  return interaction.reply({ content: `✅ Panel ticketowy wysłany do ${channel}`, ephemeral: true });
}
if (cmd === 'close') {
  let targetChannel = interaction.channel;
  const argChannel = interaction.options.getChannel('channel');
  if (argChannel) targetChannel = argChannel;

  const tm = data.tickets[serverId] || { openTickets: {} };
  const ticketEntry = Object.entries(tm.openTickets)
    .find(([tid, info]) => info.channelId === targetChannel.id);

  if (!ticketEntry)
    return interaction.reply({ content: '❌ To nie wygląda jak kanał ticketowy.', ephemeral: true });

  const [ticketId, info] = ticketEntry;

  try {
    await targetChannel.delete(`Ticket ${ticketId} closed by ${interaction.user.tag}`);
  } catch (e) {
    return interaction.reply({ content: `Błąd przy usuwaniu kanału: ${e.message}`, ephemeral: true });
  }

  delete tm.openTickets[ticketId];
  data.tickets[serverId] = tm;

  data.logs.unshift({
    server: serverId,
    user: interaction.user.id,
    action: 'ticket_close',
    ticket: ticketId,
    time: new Date().toISOString()
  });

  await writeData(data);
  return;
}
if (cmd === 'addadmin' || cmd === 'removeadmin') {
  const member = interaction.options.getMember('user', true);
  const tm = data.tickets[serverId] || { openTickets: {} };

  const ticketEntry = Object.entries(tm.openTickets)
    .find(([tid, info]) => info.channelId === interaction.channel.id);

  if (!ticketEntry)
    return interaction.reply({ content: 'Ta komenda działa tylko w kanale ticketowym.', ephemeral: true });

  try {
    if (cmd === 'addadmin') {
      await interaction.channel.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        SendMessages: true
      });

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
// ----------------------- Helper functions for widgets & tickets -----------------------

function createLeaderboardEmbed(data, serverId, type) {
  const eco = (data.economy && data.economy[serverId]) || {};
  let arr = Object.entries(eco).map(([userId, u]) => {
    if (type === 'A') return { userId, value: u.balance || 0 };
    if (type === 'B') return { userId, value: u.totalSpent || 0 };
    if (type === 'C') return { userId, value: u.itemsBought || 0 };
    return { userId, value: 0 };
  });
  arr.sort((a,b) => b.value - a.value);
  let txt = '';
  arr.slice(0,10).forEach((x,i) => {
    txt += `**${i+1}. <@${x.userId}>** — ${x.value}\n`;
  });
  const embed = new EmbedBuilder().setTitle(`Leaderboard ${type}`).setDescription(txt || 'Brak danych').setColor(0x00AAFF);
  return embed;
}

async function startWidgetRefresher() {
  setInterval(async () => {
    try {
      const data = await readData();
      for (const w of data.widgets) {
        const guild = client.guilds.cache.get(w.serverId);
        if (!guild) continue;
        const channel = guild.channels.cache.get(w.channelId);
        if (!channel) continue;
        const msg = await channel.messages.fetch(w.messageId).catch(()=>null);
        if (!msg) continue;
        const embed = createLeaderboardEmbed(data, w.serverId, w.type);
        await msg.edit({ embeds: [embed] });
      }
    } catch (e) { console.error('Widget refresh error', e); }
  }, 60*1000);
}

async function handleOpenTicketButton(interaction, serverId) {
  const data = await readData();
  const tm = data.tickets[serverId] || { lastTicketId: 0, openTickets: {} };
  tm.lastTicketId = (tm.lastTicketId || 0) + 1;
  const ticketId = tm.lastTicketId;
  const guild = interaction.guild;
  const user = interaction.user;

  const channelName = `ticket-${ticketId}`;
  const perms = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
  ];

  const ch = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites: perms
  });

  tm.openTickets[ticketId] = { channelId: ch.id, ownerId: user.id, created: new Date().toISOString() };
  data.tickets[serverId] = tm;
  await writeData(data);

  const embed = new EmbedBuilder().setTitle(`Ticket #${ticketId}`).setDescription('Poczekaj na odpowiedź administracji').setColor(0x00AAFF);
  await ch.send({ content: `<@${user.id}>`, embeds: [embed] });
  await interaction.reply({ content: `✅ Ticket utworzony: ${ch}`, ephemeral: true });
}

// ----------------------- Client login -----------------------
client.login(process.env.TOKEN);