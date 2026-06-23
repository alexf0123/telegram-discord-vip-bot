import 'dotenv/config';
import cron from 'node-cron';
import { ensureDataDir } from './db.js';
import { discord, registerDiscordCommands, setupDiscordHandlers, syncVipRoles } from './discord.js';
import { startTelegram } from './telegram.js';

ensureDataDir();
await registerDiscordCommands();
setupDiscordHandlers();
await discord.login(process.env.DISCORD_TOKEN);
await startTelegram();

cron.schedule('*/10 * * * *', async () => {
  try {
    const result = await syncVipRoles();
    console.log('Sync VIP automatico:', result);
  } catch (error) {
    console.error('Errore sync VIP automatico:', error);
  }
});
