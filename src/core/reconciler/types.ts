export type SecretChange =
    | { kind: 'add'; path: string }
    | { kind: 'remove'; path: string }
    | { kind: 'copy'; path: string; sourceEnv: string };

export interface EnvironmentPlan {
    envName: string;
    secretChanges: SecretChange[];
}

export interface ReconciliationPlan {
    environments: EnvironmentPlan[];
}
