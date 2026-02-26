import fs from 'node:fs/promises';
import path from 'node:path';
import { EnvironmentDefinition } from './types.js';
import { parseEnvironment, serializeEnvironment } from './yaml.js';

const ENVIRONMENTS_DIR = path.join('.keyshelf', 'environments');

function envFilePath(projectRoot: string, name: string): string {
    return path.join(projectRoot, ENVIRONMENTS_DIR, `${name}.yml`);
}

/** Load an environment definition from .keyshelf/environments/<name>.yml. */
export async function loadEnvironment(
    projectRoot: string,
    name: string
): Promise<EnvironmentDefinition> {
    const filePath = envFilePath(projectRoot, name);
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return parseEnvironment(content);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(
                `Environment "${name}" not found. Run "keyshelf env:create ${name}" to create it.`
            );
        }
        throw err;
    }
}

/** Save an environment definition to .keyshelf/environments/<name>.yml. */
export async function saveEnvironment(
    projectRoot: string,
    name: string,
    def: EnvironmentDefinition
): Promise<void> {
    const filePath = envFilePath(projectRoot, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, serializeEnvironment(def), 'utf-8');
}

/** List all environment names in .keyshelf/environments/. */
export async function listEnvironments(projectRoot: string): Promise<string[]> {
    const dir = path.join(projectRoot, ENVIRONMENTS_DIR);
    try {
        const files = await fs.readdir(dir);
        return files.filter((f) => f.endsWith('.yml')).map((f) => f.replace(/\.yml$/, ''));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw err;
    }
}
