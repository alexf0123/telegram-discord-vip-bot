import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle
} from 'discord.js';
import { connectDiscord, getSubByTelegram, getSubByDiscord, allLinkedSubs, expireOldSubs } from './db.js';

export const discord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const cfg = () => ({
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  vipRoleId: process.env.VIP_ROLE_ID || '1518270281028997170',
  vipLogChannelId: process.env.VIP_LOG_CHANNEL_ID || '1518278744719102104',
  vipStaffChannelId: process.env.VIP_STAFF_CHANNEL_ID || '1514358694245306559',
  vipPanelChannelId: process.env.VIP_PANEL_CHANNEL_ID || '1518278904475812020',
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || 'bordovipgaming_bot',
});

export async function registerDiscordCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('pannello_vip')
      .setDescription('Pubblica il pannello VIP Telegram')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('collega_telegram')
      .setDescription('Collega il tuo Telegram al profilo Discord')
      .addStringOption(o => o.setName('codice').setDescription('Codice ricevuto su Telegram').setRequired(true)),
    new SlashCommandBuilder().setName('stato_vip').setDescription('Controlla il tuo stato VIP Telegram'),
    new SlashCommandBuilder()
      .setName('sync_vip')
      .setDescription('Sincronizza ruoli VIP Telegram')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  ].map(c => c.toJSON());
  const rest = new REST({ version: '10' }).setToken(cfg().token);
  await rest.put(Routes.applicationGuildCommands(cfg().clientId, cfg().guildId), { body: commands });
  console.log('Comandi Discord pubblicati.');
}

async function sendToChannel(channelId, content) {
  const ch = await discord.channels.fetch(channelId).catch(() => null);
  if (ch?.isTextBased()) await ch.send(content).catch(() => null);
}

export async function notifyVipAssigned(discordId, expiresAt) {
  await sendToChannel(cfg().vipLogChannelId, `✅ <@${discordId}> è diventato **VIP**. Scadenza: **${new Date(Number(expiresAt)).toLocaleString('it-IT')}**`);
}

export async function notifyVipRemoved(discordId) {
  await sendToChannel(cfg().vipLogChannelId, `❌ A <@${discordId}> è stato rimosso il ruolo **VIP** perché l'abbonamento non è più attivo.`);
}

export async function setVipRole(discordId, shouldHaveRole, expiresAt = null) {
  const guild = await discord.guilds.fetch(cfg().guildId);
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return false;
  const hasRole = member.roles.cache.has(cfg().vipRoleId);
  if (shouldHaveRole && !hasRole) {
    await member.roles.add(cfg().vipRoleId, 'Abbonamento Telegram Stars attivo');
    await notifyVipAssigned(discordId, expiresAt || Date.now());
  } else if (!shouldHaveRole && hasRole) {
    await member.roles.remove(cfg().vipRoleId, 'Abbonamento Telegram Stars scaduto/non attivo').catch(() => null);
    await notifyVipRemoved(discordId);
  }
  return true;
}

export async function syncVipRoles() {
  expireOldSubs();
  const rows = allLinkedSubs();
  let added = 0, removed = 0, skipped = 0;
  for (const r of rows) {
    const active = Number(r.active) === 1 && (!r.expires_at || Number(r.expires_at) > Date.now());
    const ok = await setVipRole(r.discord_id, active, r.expires_at);
    if (!ok) skipped++;
    else if (active) added++;
    else removed++;
  }
  return { added, removed, skipped };
}

async function completeConnection(discordId, code) {
  const res = connectDiscord(code, discordId);
  if (!res.ok) return { ok: false, text: `❌ ${res.reason}` };
  const sub = getSubByTelegram(res.telegramId);
  const active = sub && Number(sub.active) === 1 && (!sub.expires_at || Number(sub.expires_at) > Date.now());
  if (active) await setVipRole(discordId, true, sub.expires_at);
  return { ok: true, text: active ? '✅ Account collegato e ruolo VIP assegnato.' : '✅ Account collegato. Ora abbonati dal bot Telegram per ricevere il VIP.' };
}

function vipPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('⭐ BORDO CAMPO VIP')
    .setDescription([
      'Diventa **VIP** per entrare nella sezione esclusiva di BORDO CAMPO.',
      '',
      'Con il VIP riceverai un **ruolo esclusivo** su Discord e potrai vedere tutte le **dirette trasmesse da BORDO CAMPO**.',
      '',
      'Premi **DIVENTA VIP** per aprire il bot Telegram e pagare l’abbonamento da **50 Stelle al mese**.',
      'Dopo il pagamento, torna qui e premi **COLLEGA CODICE** per collegare Telegram a Discord.'
    ].join('\n'));
}

function vipPanelButtons() {
  const tgUrl = `https://t.me/${cfg().telegramBotUsername}?start=vip`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vip_request').setLabel('⭐ DIVENTA VIP').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('connect_code').setLabel('🔗 COLLEGA CODICE').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setLabel('Apri Telegram').setStyle(ButtonStyle.Link).setURL(tgUrl)
  );
}

export function setupDiscordHandlers() {
  discord.once('clientReady', () => console.log(`Discord online: ${discord.user.tag}`));
  discord.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'pannello_vip') {
        if (interaction.channelId !== cfg().vipPanelChannelId) {
          return interaction.reply({ content: `❌ Questo comando può essere usato solo nel canale <#${cfg().vipPanelChannelId}>.`, ephemeral: true });
        }
        await interaction.channel.send({ embeds: [vipPanelEmbed()], components: [vipPanelButtons()] });
        return interaction.reply({ content: '✅ Pannello VIP pubblicato.', ephemeral: true });
      }
      if (interaction.commandName === 'collega_telegram') {
        const code = interaction.options.getString('codice', true);
        const out = await completeConnection(interaction.user.id, code);
        return interaction.reply({ content: out.text, ephemeral: true });
      }
      if (interaction.commandName === 'stato_vip') {
        const row = getSubByDiscord(interaction.user.id);
        if (!row) return interaction.reply({ content: 'Non hai ancora collegato Telegram. Apri il bot Telegram e genera un codice.', ephemeral: true });
        const active = Number(row.active) === 1 && (!row.expires_at || Number(row.expires_at) > Date.now());
        return interaction.reply({ content: active ? `✅ VIP attivo fino al ${new Date(row.expires_at).toLocaleString('it-IT')}` : '❌ VIP non attivo o scaduto.', ephemeral: true });
      }
      if (interaction.commandName === 'sync_vip') {
        await interaction.deferReply({ ephemeral: true });
        const r = await syncVipRoles();
        return interaction.editReply(`✅ Sync completato. Attivi: ${r.added}, rimossi/non attivi: ${r.removed}, saltati: ${r.skipped}`);
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'vip_request') {
        await sendToChannel(cfg().vipStaffChannelId, `📩 <@${interaction.user.id}> ha fatto richiesta VIP dal pannello Discord.`);
        return interaction.reply({ content: `Apri il bot Telegram per abbonarti: https://t.me/${cfg().telegramBotUsername}?start=vip`, ephemeral: true });
      }
      if (interaction.customId === 'connect_code') {
        const modal = new ModalBuilder().setCustomId('connect_code_modal').setTitle('Collega Telegram');
        const input = new TextInputBuilder().setCustomId('code').setLabel('Inserisci il codice ricevuto su Telegram').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'connect_code_modal') {
      const code = interaction.fields.getTextInputValue('code');
      const out = await completeConnection(interaction.user.id, code);
      return interaction.reply({ content: out.text, ephemeral: true });
    }
  });
}
