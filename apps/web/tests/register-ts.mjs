// Lets tests import TypeScript modules that use extensionless relative imports, as the app does.
import {register} from 'node:module';
register('./ts-resolve-hooks.mjs',import.meta.url);
