import chalk from 'chalk';
import * as dotenv from 'dotenv';

import { NANGO_VERSION } from './version.js';

dotenv.config();

export const getVersionOutput = (): string => {
    const version = NANGO_VERSION;
    return `${chalk.green('Tenklo CLI version:')} ${version}`;
};
