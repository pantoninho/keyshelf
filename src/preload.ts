import { resolveEnv } from './core/resolve-env.js';
import { loadEnvMapping } from './core/env-keyshelf.js';
import { findProjectRoot } from './core/config.js';

const env = process.env.KEYSHELF_ENV;
if (!env) {
    throw new Error('KEYSHELF_ENV is required when using keyshelf/preload');
}

const projectDir = process.env.KEYSHELF_PROJECT_DIR ?? findProjectRoot(process.cwd());
if (!projectDir) {
    throw new Error('keyshelf.yml not found in current directory or any parent directory.');
}
const configDir = process.env.KEYSHELF_CONFIG_DIR;
const envMapping = loadEnvMapping(process.cwd());
const envRecord = await resolveEnv({ env, projectDir, configDir, envMapping });

for (const [key, value] of Object.entries(envRecord)) {
    process.env[key] = value;
}
