import { SlashCommandBuilder } from 'discord.js';
import { startPlayerPanel } from '../utils/startPanel.js';

export default {
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('🎧 Start here: player panel in your voice room / ابدأ من هنا: لوحة التشغيل في رومك')
    .setDMPermission(false),

  execute: (interaction) => startPlayerPanel(interaction)
};
