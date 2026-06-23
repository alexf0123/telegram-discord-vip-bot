import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import {
  activeVipSubs,
  allLinkedSubs,
  connectDiscord,
  deactivateExpiredVip,
  expiredVipSubs,
  expireOldSubs,
  getSubByDiscord,
  getSubByTelegram,
} from './db.js';

export const discord = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
});

const cfg = () => ({
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  vipRoleId: process.env.VIP_ROLE_ID || '1518270281028997170',
  vipLogChannelId: process.env.VIP_LOG_CHANNEL_ID || '1518278744719102104',
  vipPanelChannelId: process.env.VIP_PANEL_CHANNEL_ID || '1518278904475812020',
  telegramBotUrl: process.env.TELEGRAM_BOT_URL || 'https://t.me/bordovipgaming_bot',
});

function fmtDate(value) {
  if (!value) return 'Non disponibile';
  return new Date(Number(value)).toLocaleString('it-IT');
}

async function sendChannelMessage(channelId, payload) {
  try {
    const channel = await discord.channels.fetch(channelId);
    if (!channel?.isTextBased()) return false;
    await channel.send(payload);
    return true;
  } catch (error) {
    console.error('Errore invio messaggio canale:', error?.message || error);
    return false;
  }
}

async function sendDm(discordId, payload) {
  try {
    const user = await discord.users.fetch(discordId);
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

export async function notifyVipPayment({ telegramId, username, discordId, expires, amount = 50 }) {
  const embed = new EmbedBuilder()
    .setTitle('💰 NUOVO ABBONAMENTO VIP')
    .setColor(0xf1c40f)
    .addFields(
      { name: '👤 Telegram', value: username ? `@${username}` : 'Username non disponibile', inline: true },
      { name: '🆔 Telegram ID', value: String(telegramId), inline: true },
      { name: '⭐ Importo', value: `${amount} Stelle`, inline: true },
      { name: '📅 Attivazione', value: fmtDate(Date.now()), inline: true },
      { name: '📅 Scadenza', value: fmtDate(expires), inline: true },
      { name: '🔗 Discord', value: discordId ? `<@${discordId}>` : 'Non ancora collegato', inline: false },
    )
    .setFooter({ text: 'BORDO CAMPO VIP' })
    .setTimestamp();

  await sendChannelMessage(cfg().vipLogChannelId, { embeds: [embed] });
}

export async function notifyVipRoleAssigned(discordId, expires) {
  await sendDm(discordId, [
    '👑 **Abbonamento VIP attivato!**',
    '',
    'Grazie per aver sostenuto **BORDO CAMPO**.',
    '',
    '✅ Ti è stato assegnato il ruolo **VIP**.',
    '',
    'Con il ruolo VIP potrai accedere a:',
    '• Dirette esclusive',
    '• Contenuti riservati',
    '• Eventi speciali della community',
    '• Vantaggi dedicati ai membri VIP',
    '',
    `📅 Scadenza abbonamento: **${fmtDate(expires)}**`,
    '',
    'Grazie per il supporto! ❤️',
  ].join('\n'));
}

export async function notifyVipExpired(row) {
  const embed = new EmbedBuilder()
    .setTitle('❌ VIP SCADUTO')
    .setColor(0xe74c3c)
    .addFields(
      { name: '👤 Telegram', value: row.telegram_username ? `@${row.telegram_username}` : 'Username non disponibile', inline: true },
      { name: '🆔 Telegram ID', value: String(row.telegram_id), inline: true },
      { name: '🔗 Discord', value: row.discord_id ? `<@${row.discord_id}>` : 'Non collegato', inline: true },
      { name: '📅 Scadenza', value: fmtDate(row.expires_at), inline: true },
      { name: '🗑️ Azione', value: 'Ruolo VIP rimosso automaticamente.', inline: false },
    )
    .setFooter({ text: 'BORDO CAMPO VIP' })
    .setTimestamp();

  await sendChannelMessage(cfg().vipLogChannelId, { embeds: [embed] });

  if (row.discord_id) {
    await sendDm(row.discord_id, [
      '❌ **Il tuo abbonamento VIP è scaduto.**',
      '',
      'Il ruolo **VIP** è stato rimosso automaticamente.',
      '',
      'Per continuare a supportare **BORDO CAMPO** e mantenere l’accesso ai contenuti esclusivi, rinnova il tuo abbonamento VIP dal bot Telegram.',
    ].join('\n'));
  }
}

export async function registerDiscordCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('collega_telegram')
      .setDescription('Collega il tuo Telegram al profilo Discord')
      .addStringOption(o => o.setName('codice').setDescription('Codice ricevuto su Telegram').setRequired(true)),
    new SlashCommandBuilder().setName('stato_vip').setDescription('Controlla il tuo stato VIP Telegram'),
    new SlashCommandBuilder().setName('sync_vip').setDescription('Sincronizza ruoli VIP Telegram').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder().setName('pannello_vip').setDescription('Pubblica il pannello VIP').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('vip_attivi').setDescription('Mostra tutti i VIP attivi').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder().setName('vip_scaduti').setDescription('Mostra VIP scaduti/non attivi').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder()
      .setName('vip_info')
      .setDescription('Mostra informazioni VIP di un utente Discord')
      .addUserOption(o => o.setName('utente').setDescription('Utente Discord').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(cfg().token);
  await rest.put(Routes.applicationGuildCommands(cfg().clientId, cfg().guildId), { body: commands });
  console.log('Comandi Discord pubblicati.');
}

export async function setVipRole(discordId, shouldHaveRole, expires = null, sendAssignedDm = true) {
  const guild = await discord.guilds.fetch(cfg().guildId);
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return false;

  if (shouldHaveRole) {
    const alreadyHas = member.roles.cache.has(cfg().vipRoleId);
    await member.roles.add(cfg().vipRoleId, 'Abbonamento Telegram Stars attivo');
    if (sendAssignedDm && !alreadyHas) await notifyVipRoleAssigned(discordId, expires);
  } else {
    await member.roles.remove(cfg().vipRoleId, 'Abbonamento Telegram Stars scaduto/non attivo').catch(() => null);
  }

  return true;
}

export async function syncVipRoles() {
  expireOldSubs();

  const expired = expiredVipSubs();
  for (const row of expired) {
    if (row.discord_id) await setVipRole(row.discord_id, false);
    await notifyVipExpired(row);
    deactivateExpiredVip(row.telegram_id);
  }

  const rows = allLinkedSubs();
  let added = 0;
  let removed = 0;
  let skipped = 0;

  for (const r of rows) {
    const active = Number(r.active) === 1 && (!r.expires_at || Number(r.expires_at) > Date.now());
    const ok = await setVipRole(r.discord_id, active, r.expires_at, false);
    if (!ok) skipped++;
    else if (active) added++;
    else removed++;
  }

  return { added, removed, skipped, expiredNotified: expired.length };
}

async function publishVipPanel(interaction) {
  if (interaction.channelId !== cfg().vipPanelChannelId) {
    return interaction.reply({ content: `❌ Questo comando può essere usato solo nel canale <#${cfg().vipPanelChannelId}>.`, ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle('⭐ DIVENTA VIP BORDO CAMPO ⭐')
    .setDescription([
      'Entra nell’area esclusiva di **BORDO CAMPO** e ricevi il ruolo **VIP** su Discord.',
      '',
      'Con il VIP potrai vedere tutte le dirette trasmesse da BORDO CAMPO e accedere ai contenuti riservati.',
      '',
      '**Cosa ottieni:**',
      '✅ Ruolo Discord esclusivo **VIP**',
      '✅ Accesso alle dirette esclusive',
      '✅ Contenuti riservati',
      '✅ Comunicazioni e vantaggi dedicati',
      '',
      '**Costo:**',
      '⭐ **50 Stelle Telegram ogni 30 giorni**',
      '',
      '**Come fare:**',
      '1️⃣ Premi **DIVENTA VIP**',
      '2️⃣ Apri il bot Telegram',
      '3️⃣ Completa il pagamento con le Stelle',
      '4️⃣ Genera il codice Discord',
      '5️⃣ Torna qui e premi **COLLEGA CODICE**',
      '',
      'Se l’abbonamento scade, il ruolo VIP viene rimosso automaticamente.',
    ].join('\n'))
    .setColor(0xf1c40f)
    .setFooter({ text: 'BORDO CAMPO VIP' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('⭐ DIVENTA VIP').setStyle(ButtonStyle.Link).setURL(cfg().telegramBotUrl),
    new ButtonBuilder().setCustomId('connect_code').setLabel('🔗 COLLEGA CODICE').setStyle(ButtonStyle.Primary),
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  return interaction.reply({ content: '✅ Pannello VIP pubblicato.', ephemeral: true });
}

export function setupDiscordHandlers() {
  discord.once('clientReady', () => console.log(`Discord online: ${discord.user.tag}`));

  discord.on('interactionCreate', async interaction => {
    if (interaction.isButton() && interaction.customId === 'connect_code') {
      const modal = new ModalBuilder().setCustomId('connect_code_modal').setTitle('Collega Telegram');
      const input = new TextInputBuilder().setCustomId('code').setLabel('Inserisci il codice Telegram').setPlaceholder('Esempio: ABC123').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'connect_code_modal') {
      const code = interaction.fields.getTextInputValue('code').trim().toUpperCase();
      const res = connectDiscord(code, interaction.user.id);
      if (!res.ok) return interaction.reply({ content: `❌ ${res.reason}`, ephemeral: true });
      const sub = getSubByTelegram(res.telegramId);
      const active = sub && Number(sub.active) === 1 && (!sub.expires_at || Number(sub.expires_at) > Date.now());
      if (active) await setVipRole(interaction.user.id, true, sub.expires_at);
      return interaction.reply({ content: active ? '✅ Account collegato e ruolo VIP assegnato.' : '✅ Account collegato. Paga/attiva il VIP su Telegram per ricevere il ruolo.', ephemeral: true });
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'pannello_vip') return publishVipPanel(interaction);

    if (interaction.commandName === 'collega_telegram') {
      const code = interaction.options.getString('codice', true).trim().toUpperCase();
      const res = connectDiscord(code, interaction.user.id);
      if (!res.ok) return interaction.reply({ content: `❌ ${res.reason}`, ephemeral: true });
      const sub = getSubByTelegram(res.telegramId);
      const active = sub && Number(sub.active) === 1 && (!sub.expires_at || Number(sub.expires_at) > Date.now());
      if (active) await setVipRole(interaction.user.id, true, sub.expires_at);
      return interaction.reply({ content: active ? '✅ Account collegato e ruolo VIP assegnato.' : '✅ Account collegato. Paga/attiva il VIP su Telegram per ricevere il ruolo.', ephemeral: true });
    }

    if (interaction.commandName === 'stato_vip') {
      const row = getSubByDiscord(interaction.user.id);
      if (!row) return interaction.reply({ content: 'Non hai ancora collegato Telegram. Scrivi /start al bot Telegram e genera un codice.', ephemeral: true });
      const active = Number(row.active) === 1 && (!row.expires_at || Number(row.expires_at) > Date.now());
      return interaction.reply({ content: active ? `✅ VIP attivo fino al ${fmtDate(row.expires_at)}` : '❌ VIP non attivo o scaduto.', ephemeral: true });
    }

    if (interaction.commandName === 'sync_vip') {
      await interaction.deferReply({ ephemeral: true });
      const r = await syncVipRoles();
      return interaction.editReply(`✅ Sync completato. Attivi: ${r.added}, rimossi/non attivi: ${r.removed}, saltati: ${r.skipped}, scaduti notificati: ${r.expiredNotified}`);
    }

    if (interaction.commandName === 'vip_attivi') {
      const rows = activeVipSubs();
      if (!rows.length) return interaction.reply({ content: 'Nessun VIP attivo al momento.', ephemeral: true });
      const lines = rows.slice(0, 25).map((r, i) => `**${i + 1}.** ${r.discord_id ? `<@${r.discord_id}>` : 'Discord non collegato'} | Telegram: ${r.telegram_username ? `@${r.telegram_username}` : `ID ${r.telegram_id}`} | Scade: ${fmtDate(r.expires_at)}`);
      return interaction.reply({ content: `👑 **VIP ATTIVI**\nTotale: ${rows.length}\n\n${lines.join('\n')}`, ephemeral: true });
    }

    if (interaction.commandName === 'vip_scaduti') {
      const rows = allLinkedSubs().filter(r => !r.expires_at || Number(r.expires_at) <= Date.now() || Number(r.active) !== 1);
      if (!rows.length) return interaction.reply({ content: 'Nessun VIP scaduto/non attivo trovato.', ephemeral: true });
      const lines = rows.slice(0, 25).map((r, i) => `**${i + 1}.** ${r.discord_id ? `<@${r.discord_id}>` : 'Discord non collegato'} | Telegram: ${r.telegram_username ? `@${r.telegram_username}` : `ID ${r.telegram_id}`} | Scadenza: ${fmtDate(r.expires_at)}`);
      return interaction.reply({ content: `❌ **VIP SCADUTI/NON ATTIVI**\nTotale: ${rows.length}\n\n${lines.join('\n')}`, ephemeral: true });
    }

    if (interaction.commandName === 'vip_info') {
      const user = interaction.options.getUser('utente', true);
      const row = getSubByDiscord(user.id);
      if (!row) return interaction.reply({ content: 'Nessun collegamento VIP trovato per questo utente.', ephemeral: true });
      const active = Number(row.active) === 1 && Number(row.expires_at) > Date.now();
      return interaction.reply({ content: ['👤 **Scheda VIP**', '', `Discord: <@${user.id}>`, `Telegram: ${row.telegram_username ? '@' + row.telegram_username : 'Non disponibile'}`, `Telegram ID: ${row.telegram_id}`, `VIP: ${active ? 'ATTIVO ✅' : 'NON ATTIVO ❌'}`, `Attivato il: ${fmtDate(row.activated_at)}`, `Scadenza: ${fmtDate(row.expires_at)}`].join('\n'), ephemeral: true });
    }
  });
}
