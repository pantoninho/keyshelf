import yaml from 'js-yaml';

export interface TaggedValue {
  tag: string;
  config: Record<string, unknown>;
}

function createTagType(tagName: string): yaml.Type {
  return new yaml.Type(`!${tagName}`, {
    kind: 'mapping',
    construct(data: Record<string, unknown> | null): TaggedValue {
      return { tag: tagName, config: data ?? {} };
    },
    instanceOf: Object,
    represent(value: unknown) {
      const tv = value as TaggedValue;
      return tv.config;
    },
  });
}

function createBareTagType(tagName: string): yaml.Type {
  return new yaml.Type(`!${tagName}`, {
    kind: 'scalar',
    construct(): TaggedValue {
      return { tag: tagName, config: {} };
    },
    instanceOf: Object,
    represent() {
      return '';
    },
  });
}

const TAG_NAMES = ['secret', 'gcp', 'aws', 'age'] as const;

const mappingTypes = TAG_NAMES.map((name) => createTagType(name));
const bareTypes = TAG_NAMES.map((name) => createBareTagType(name));

export const KEYSHELF_SCHEMA = yaml.DEFAULT_SCHEMA.extend([
  ...bareTypes,
  ...mappingTypes,
]);

export function isTaggedValue(value: unknown): value is TaggedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tag' in value &&
    'config' in value &&
    typeof (value as TaggedValue).tag === 'string'
  );
}
