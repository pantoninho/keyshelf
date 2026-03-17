/** Interface for deployment platform backends. */
export interface DeployTarget {
    list(): Promise<Record<string, string>>;
    set(key: string, value: string, sensitive: boolean): Promise<void>;
    delete(key: string): Promise<void>;
}
