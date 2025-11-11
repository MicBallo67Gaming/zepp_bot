\
  // index.js - ZeppBot (Discord + Dashboard API)
  require('dotenv').config();
  const fs = require('fs');
  const express = require('express');
  const bodyParser = require('body-parser');
  const cors = require('cors');
  const pool = require('./db');
  const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
  const app = express();
  app.use(cors());
  app.use(bodyParser.json());
  app.use(express.static('public'));
  const PORT = process.env.PORT || 3000;
  // Initialize DB schema if not exists
  (async () => {
    const conn = await pool.getConnection();
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS servers (
          id BIGINT PRIMARY KEY,
          panel_password VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await conn.query(`
        CREATE TABLE IF NOT EXISTS logs (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          server_id BIGINT,
          user_id VARCHAR(64),
          action VARCHAR(64),
          moderator VARCHAR(64),
          reason TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await conn.query(`
        CREATE TABLE IF NOT EXISTS mutes (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          server_id BIGINT,
          user_id VARCHAR(64),
          expires_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
    } finally {
      conn.release();
    }
  })();
  // Express API for dashboard (requires simple login)
  app.post('/api/login', async (req, res) => {
    // body: { serverId, password }
    const { serverId, password } = req.body;
    if (!serverId || !password) return res.status(400).json({ error: 'Brak danych' });
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query('SELECT panel_password FROM servers WHERE id=?', [serverId]);
      if (rows.length===0) return res.status(404).json({ error: 'Brak ustawionego panelu. Użyj /panelogon na serwerze.' });
      const pass = rows[0].panel_password || '';
      if (pass !== password) return res.status(403).json({ error: 'Nieprawidłowe hasło' });
      // ok
      return res.json({ ok:true });
    } finally {
      conn.release();
    }
  });
  app.get('/api/logs/:serverId', async (req, res) => {
    const serverId = req.params.serverId;
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query('SELECT * FROM logs WHERE server_id=? ORDER BY created_at DESC LIMIT 200', [serverId]);
      res.json(rows);
    } finally {
      conn.release();
    }
  });
  // Serve dashboard static files in /public
  // public/index.html is created below
  // Discord client
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
    partials: [Partials.Message, Partials.Reaction]
  });
  client.once('ready', () => {
    console.log('ZeppBot ready as', client.user.tag);
  });
  client.on('interactionCreate', async interaction => {
    try {
      if (!interaction.isChatInputCommand()) return;
      const cmd = interaction.commandName;
      const serverId = interaction.guildId;
      const author = interaction.user;
      const modTag = `${author.username}#${author.discriminator || '0000'}`;
      if (cmd === 'help') {
        return interaction.reply({ content: 'Dostępne komendy: /warn /kick /ban /mute /unmute /panelogon etc.', ephemeral:true });
      }
      if (cmd === 'info') {
        return interaction.reply({ content: 'ZeppBot - moderacja & dashboard (MySQL).', ephemeral:true });
      }
      // only allow admins for moderation commands
      const member = await interaction.guild.members.fetch(author.id);
      const isAdmin = member.permissions.has('Administrator') || member.permissions.has('ManageGuild');
      if (['warn','kick','ban','mute','unmute'].includes(cmd) && !isAdmin) {
        return interaction.reply({ content: 'Tylko admini mogą używać tej komendy.', ephemeral:true });
      }
      if (cmd === 'warn') {
        const target = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'Brak powodu';
        const conn = await pool.getConnection();
        try {
          await conn.query('INSERT INTO logs (server_id,user_id,action,moderator,reason) VALUES (?,?,?,?,?)', [serverId, target.id, 'warn', modTag, reason]);
        } finally { conn.release(); }
        return interaction.reply({ content: `⚠️ Ostrzeżono ${target.tag}`, ephemeral:true });
      }
      if (cmd === 'kick') {
        const target = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'Brak powodu';
        try {
          const guildMember = await interaction.guild.members.fetch(target.id);
          await guildMember.kick(reason);
          const conn = await pool.getConnection();
          try { await conn.query('INSERT INTO logs (server_id,user_id,action,moderator,reason) VALUES (?,?,?,?,?)', [serverId, target.id, 'kick', modTag, reason]); } finally { conn.release(); }
          return interaction.reply({ content: `🔨 Wyrzucono ${target.tag}`, ephemeral:true });
        } catch (e) {
          return interaction.reply({ content: `Błąd: ${e.message}`, ephemeral:true });
        }
      }
      if (cmd === 'ban') {
        const target = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'Brak powodu';
        try {
          await interaction.guild.members.ban(target.id, { reason });
          const conn = await pool.getConnection();
          try { await conn.query('INSERT INTO logs (server_id,user_id,action,moderator,reason) VALUES (?,?,?,?,?)', [serverId, target.id, 'ban', modTag, reason]); } finally { conn.release(); }
          return interaction.reply({ content: `🚫 Zbanowano ${target.tag}`, ephemeral:true });
        } catch (e) {
          return interaction.reply({ content: `Błąd: ${e.message}`, ephemeral:true });
        }
      }
      if (cmd === 'mute') {
        const target = interaction.options.getUser('user', true);
        const duration = interaction.options.getString('duration') || null;
        const conn = await pool.getConnection();
        try {
          await conn.query('INSERT INTO mutes (server_id,user_id,expires_at) VALUES (?,?,?)', [serverId, target.id, null]);
          await conn.query('INSERT INTO logs (server_id,user_id,action,moderator,reason) VALUES (?,?,?,?,?)', [serverId, target.id, 'mute', modTag, duration||'manual']);
        } finally { conn.release(); }
        return interaction.reply({ content: `🔇 Wyciszono ${target.tag}`, ephemeral:true });
      }
      if (cmd === 'unmute') {
        const target = interaction.options.getUser('user', true);
        const conn = await pool.getConnection();
        try {
          await conn.query('DELETE FROM mutes WHERE server_id=? AND user_id=?', [serverId, target.id]);
          await conn.query('INSERT INTO logs (server_id,user_id,action,moderator,reason) VALUES (?,?,?,?,?)', [serverId, target.id, 'unmute', modTag, 'manual']);
        } finally { conn.release(); }
        return interaction.reply({ content: `🔊 Odciszono ${target.tag}`, ephemeral:true });
      }
      if (cmd === 'panelogon') {
        const password = interaction.options.getString('password', true);
        const conn = await pool.getConnection();
        try {
          await conn.query('INSERT INTO servers (id,panel_password) VALUES (?,?) ON DUPLICATE KEY UPDATE panel_password=?', [serverId, password, password]);
        } finally { conn.release(); }
        return interaction.reply({ content: `🔐 Panel skonfigurowany. ID serwera: ${serverId}`, ephemeral:true });
      }
    } catch (err) {
      console.error('interaction error', err);
      if (interaction.replied || interaction.deferred) interaction.followUp({ content: 'Błąd wewnętrzny', ephemeral:true });
      else interaction.reply({ content: 'Błąd serwera', ephemeral:true });
    }
  });
  // simple enforcement: (not full) - for demonstration, could be expanded to actual muting via roles
  // start express + static dashboard
  app.listen(PORT, () => console.log('API + Dashboard running on port', PORT));
  client.login(process.env.DISCORD_TOKEN);
