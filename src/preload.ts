import { resolveEnv } from './core/resolve-env.js';

const env = process.env.KEYSHELF_ENV;
if (!env) {
    throw new Error('KEYSHELF_ENV is required when using keyshelf/preload');
}

const projectDir = process.env.KEYSHELF_PROJECT_DIR ?? process.cwd();
const configDir = process.env.KEYSHELF_CONFIG_DIR;
const envRecord = await resolveEnv({ env, projectDir, configDir });

for (const [key, value] of Object.entries(envRecord)) {
    process.env[key] = value;
}
