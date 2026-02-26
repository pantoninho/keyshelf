/** Interface for secret storage backends. */
export interface SecretProvider {
    get(env: string, path: string): Promise<string>;
    set(env: string, path: string, value: string): Promise<void>;
    delete(env: string, path: string): Promise<void>;
    list(env: string, prefix?: string): Promise<string[]>;
    ref(env: string, path: string): string;
}
