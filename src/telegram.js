import { Bot, InlineKeyboard } from 'grammy';
import { upsertTelegramUser, createLinkCode, activateVip, getSubByTelegram } from './db.js';
import { notifyVipPayment, setVipRole } from './discord.js';

export const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

const price = () => Number(process.env.VIP_STARS_PRICE || 50);
const durationDays = () => Number(process.env.VIP_DURATION_DAYS || 30);
const channelId = () => String(process.env.TELEGRAM_CHANNEL_ID || '').trim();
const discordInvite = () => String(process.env.DISCORD_INVITE_URL || '').trim();

function mainKeyboard() {
  const kb = new InlineKeyboard()
    .text(`⭐ Abbonati VIP - ${price()} Stelle/mese`, 'buy_vip')
    .row()
    .text('🔗 Genera codice Discord', 'gen_code');

  if (discordInvite()) {
    kb.row().url('Apri Discord', discordInvite());
  }

  return kb;
}

async function sendWelcome(ctx) {
  await ctx.reply(
    [
      '⭐ Benvenuto in BORDO VIP.',
      '',
      'Con il VIP ricevi il ruolo esclusivo su Discord e puoi vedere tutte le dirette trasmesse da BORDO CAMPO.',
      '',
      `Prezzo: ${price()} Stelle ogni ${durationDays()} giorni.`,
      '',
      'Come funziona:',
      '1️⃣ Premi “Abbonati VIP” e completa il pagamento con Telegram Stars.',
      '2️⃣ Dopo il pagamento il VIP viene attivato automaticamente.',
      '3️⃣ Premi “Genera codice Discord”.',
      '4️⃣ Vai sul server Discord e premi il pulsante “COLLEGA CODICE” nel pannello VIP.',
      '',
      'Se il VIP scade, il ruolo Discord verrà rimosso automaticamente.',
    ].join('\n'),
    { reply_markup: mainKeyboard() },
  );
}

async function sendVipInvoice(ctx) {
  const amount = price();

  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply('❌ Prezzo VIP non valido. Contatta lo staff.');
    return;
  }

  await ctx.api.raw.sendInvoice({
    chat_id: ctx.chat.id,
    title: 'BORDO CAMPO VIP',
    description: `Abbonamento VIP per ${durationDays()} giorni. Riceverai il ruolo VIP su Discord dopo il collegamento.`,
    payload: `bordo_vip_${amount}_stars`,
    currency: 'XTR',
    prices: [{ label: `VIP ${durationDays()} giorni`, amount }],
  });
}

async function createInviteLinkSafe() {
  const id = channelId();

  console.log('TELEGRAM DEBUG - CHANNEL ID:', id || 'NON IMPOSTATO');

  if (!id) {
    console.error('TELEGRAM TEST ERROR: TELEGRAM_CHANNEL_ID non impostato.');
    return null;
  }

  try {
    const chat = await bot.api.getChat(id);
    console.log('TELEGRAM DEBUG - CHAT FOUND:', {
      id: chat.id,
      title: chat.title,
      type: chat.type,
      username: chat.username,
    });

    const expire = Math.floor(Date.now() / 1000) + 3600;

    const invite = await bot.api.createChatInviteLink(id, {
      expire_date: expire,
      member_limit: 1,
      name: 'VIP automatico',
    });

    console.log('TELEGRAM DEBUG - INVITE CREATED:', invite.invite_link);
    return invite;
  } catch (error) {
    console.error('TELEGRAM TEST ERROR:', {
      description: error?.description,
      message: error?.message,
      error_code: error?.error_code,
      payload: error?.payload,
    });
    return null;
  }
}

export function setupTelegramHandlers() {
  bot.command('start', async (ctx) => {
    if (ctx.from) {
      upsertTelegramUser(ctx.from.id, ctx.from.username || '');
    }

    await sendWelcome(ctx);
  });

  bot.command('stato', async (ctx) => {
    const row = getSubByTelegram(ctx.from.id);
    const active = row && Number(row.active) === 1 && Number(row.expires_at) > Date.now();

    if (!active) {
      return ctx.reply('❌ VIP non attivo.');
    }

    return ctx.reply(`✅ VIP attivo fino al ${new Date(row.expires_at).toLocaleString('it-IT')}`);
  });

  bot.callbackQuery('buy_vip', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendVipInvoice(ctx);
  });

  bot.callbackQuery('gen_code', async (ctx) => {
    await ctx.answerCallbackQuery();

    upsertTelegramUser(ctx.from.id, ctx.from.username || '');

    const code = createLinkCode(ctx.from.id);

    await ctx.reply(
      [
        '🔗 Codice Discord generato:',
        '',
        `CODICE: ${code}`,
        '',
        'Ora vai nel pannello VIP su Discord e premi “COLLEGA CODICE”.',
        'Il codice dura 15 minuti.',
      ].join('\n'),
      {
        reply_markup: discordInvite()
          ? new InlineKeyboard().url('Apri Discord', discordInvite())
          : undefined,
      },
    );
  });

  bot.on('pre_checkout_query', async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on('message:successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const amount = payment?.total_amount || price();

    const expires = activateVip(
      ctx.from.id,
      ctx.from.username || '',
      durationDays(),
      payment,
    );

    const row = getSubByTelegram(ctx.from.id);

    await notifyVipPayment({
      telegramId: ctx.from.id,
      username: ctx.from.username || '',
      discordId: row?.discord_id || null,
      expires,
      amount,
    });

    if (row?.discord_id) {
      await setVipRole(row.discord_id, true, expires);
    }

    const invite = await createInviteLinkSafe();

    await ctx.reply(
      [
        '✅ Pagamento ricevuto. VIP attivato!',
        `Scadenza: ${new Date(expires).toLocaleString('it-IT')}`,
        '',
        row?.discord_id
          ? 'Il ruolo VIP Discord è stato assegnato.'
          : 'Ora genera il codice e collegalo su Discord per ricevere il ruolo VIP.',
        invite?.invite_link ? `\nLink canale VIP Telegram: ${invite.invite_link}` : '',
      ].join('\n'),
      { reply_markup: mainKeyboard() },
    );
  });

  bot.catch((err) => {
    console.error('Telegram error:', err);
  });
}

export async function startTelegram() {
  setupTelegramHandlers();

  const me = await bot.api.getMe();
  console.log(`Telegram online: @${me.username}`);

  await bot.start();
}
