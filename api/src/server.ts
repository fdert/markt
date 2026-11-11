import { createApp } from './app.js';
import { config } from './config.js';

createApp().listen(config.port, () => console.log(`Raseed API on :${config.port}`));
