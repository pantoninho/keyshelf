import { Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { findRootDir } from '../config/loader.js';
import { createDefaultRegistry } from '../providers/setup.js';
import { KEYSHELF_SCHEMA } from '../config/yaml-tags.js';
import { setNestedValue } from '../utils/paths.js';
import { createInterface } from 'node:readline';

async function readHiddenInput(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    process.stderr.write(prompt);
    rl.on('line', (line) => {
      rl.close();
      resolve(line);
    });
  });
}

function readStdinPipe(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

export const setCommand = new Command('set')
  .description('Set a config or secret value for an environment')
  .requiredOption('--env <env>', 'Environment name')
  .option('--provider <provider>', 'Store value via provider')
  .option('--value <value>', 'Value to set (non-interactive)')
  .argument('<key>', 'Key path (e.g. db/password)')
  .action(
    async (
      keyPath: string,
      opts: { env: string; provider?: string; value?: string },
    ) => {
      const rootDir = findRootDir(process.cwd());
      const envFilePath = join(rootDir, '.keyshelf', `${opts.env}.yaml`);

      // Determine value
      let value: string;
      if (opts.value !== undefined) {
        value = opts.value;
      } else if (!process.stdin.isTTY) {
        value = await readStdinPipe();
      } else {
        value = await readHiddenInput(`Enter value for ${keyPath}: `);
      }

      // If provider specified, store via provider
      if (opts.provider) {
        const registry = createDefaultRegistry();
        const provider = registry.get(opts.provider);

        // Load existing env file to get provider config
        let envDoc: Record<string, unknown> = {};
        try {
          const content = await readFile(envFilePath, 'utf-8');
          envDoc = (yaml.load(content, { schema: KEYSHELF_SCHEMA }) ??
            {}) as Record<string, unknown>;
        } catch {
          // File doesn't exist yet, start fresh
        }

        const providerBlock = envDoc['default-provider'] as
          | Record<string, unknown>
          | undefined;
        const providerConfig: Record<string, unknown> = {};
        if (providerBlock && providerBlock.name === opts.provider) {
          Object.assign(providerConfig, providerBlock);
          delete providerConfig.name;
        }

        await provider.set(
          { keyPath, envName: opts.env, config: providerConfig },
          value,
        );
        console.log(
          `Stored "${keyPath}" via ${opts.provider} provider for ${opts.env}`,
        );
        return;
      }

      // Otherwise store as plaintext in env file
      let envDoc: Record<string, unknown> = {};
      try {
        const content = await readFile(envFilePath, 'utf-8');
        envDoc = (yaml.load(content, { schema: KEYSHELF_SCHEMA }) ??
          {}) as Record<string, unknown>;
      } catch {
        // File doesn't exist yet, start fresh
      }

      // Set the value using nested path
      setNestedValue(envDoc, keyPath, value);

      await writeFile(envFilePath, yaml.dump(envDoc), 'utf-8');
      console.log(`Set "${keyPath}" = "${value}" in ${opts.env}`);
    },
  );
