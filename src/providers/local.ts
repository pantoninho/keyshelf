import fs from 'node:fs';
import path from 'node:path';
import { SecretProvider } from './provider.js';

type Store = Record<string, Record<string, string>>;

/** Stores secrets as JSON on the local filesystem. */
export class LocalProvider implements SecretProvider {
    private readonly filePath: string;

    constructor(configDir: string) {
        this.filePath = path.join(configDir, 'secrets.json');
    }

    ref(_env: string, secretPath: string): string {
        return secretPath;
    }

    async get(env: string, secretPath: string): Promise<string> {
        const store = this.read();
        const value = store[env]?.[secretPath];
        if (value === undefined) {
            throw new Error(`Secret "${secretPath}" not found in environment "${env}"`);
        }
        return value;
    }

    async set(env: string, secretPath: string, value: string): Promise<void> {
        const store = this.read();
        store[env] ??= {};
        store[env][secretPath] = value;
        this.write(store);
    }

    async delete(env: string, secretPath: string): Promise<void> {
        const store = this.read();
        if (!store[env]?.[secretPath]) {
            throw new Error(`Secret "${secretPath}" not found in environment "${env}"`);
        }
        delete store[env][secretPath];
        this.write(store);
    }

    async list(env: string, prefix?: string): Promise<string[]> {
        const store = this.read();
        const envSecrets = store[env] ?? {};
        const paths = Object.keys(envSecrets);
        if (!prefix) return paths;
        return paths.filter((p) => p === prefix || p.startsWith(prefix + '/'));
    }

    private read(): Store {
        try {
            const content = fs.readFileSync(this.filePath, 'utf-8');
            return JSON.parse(content) as Store;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
            throw err;
        }
    }

    private write(store: Store): void {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(store, null, 2), 'utf-8');
    }
}
