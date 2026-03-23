import { runMain } from 'citty';
import { main } from './cli/index.ts';
import { closeAll } from './lib/graceful-shutdown.ts';
import { validateProjectRoot } from './cli/shared/validate-project-root.ts';

validateProjectRoot();
process.on('exit', closeAll);
runMain(main);
