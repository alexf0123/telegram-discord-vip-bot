import 'dotenv/config';
import cron from 'node-cron';
import { discord, setupDiscordHandlers, registerDiscordCommands, syncVipRoles } from './discord.js';
import { startTelegram } from './telegram.js';

setupDiscordHandlers();
await registerDiscordCommands();
await discord.login(process.env.DISCORD_TOKEN);
startTelegram().catch(err => console.error('Telegram error:', err));

cron.schedule('*/30 * * * *', async () => {
  try {
    const r = await syncVipRoles();
    console.log('Sync VIP automatico:', r);
  } catch (e) {
    console.error('Errore sync VIP:', e);
  }
});
