import { runMain } from 'citty';
import { main } from './cli/index.ts';
import { closeAll } from './lib/graceful-shutdown.ts';

process.on('exit', closeAll);
runMain(main);
