import 'dotenv/config';
import { registerDiscordCommands } from './src/discord.js';

await registerDiscordCommands();
console.log('Comandi Discord pubblicati.');
