import { startZatcaWorker } from './services/zatca/index.js';
import { createApp } from './app.js';
import { config } from './config.js';

startZatcaWorker();
createApp().listen(config.port, () => console.log(`Raseed API on :${config.port}`));
