/*
 * A validator for the subset of JSON Schema the shared contracts actually use.
 *
 * Hand-written rather than pulled from npm because the schemas here are
 * deliberately plain — types, enums, const, required, properties,
 * additionalProperties, items, minimum — and because this module is destined to
 * run in two places with very different dependency budgets: the test suite now,
 * and the licence/analysis server later. Anything the schemas grow beyond this
 * subset throws at validation time rather than being silently ignored, which is
 * the failure mode that makes a hand-rolled validator dangerous.
 */

const SUPPORTED = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'type',
  'const',
  'enum',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minimum',
]);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

function assertSupported(schema, path) {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED.has(keyword)) {
      throw new Error(`Unsupported JSON Schema keyword "${keyword}" at ${path || '#'}`);
    }
  }
}

function check(value, schema, path, errors) {
  assertSupported(schema, path);

  if ('const' in schema && value !== schema.const) {
    errors.push({ path, message: `expected ${JSON.stringify(schema.const)}` });
    return;
  }

  if ('enum' in schema && !schema.enum.includes(value)) {
    errors.push({ path, message: `expected one of ${schema.enum.join(', ')}, got ${JSON.stringify(value)}` });
    return;
  }

  if ('type' in schema) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((expected) => matchesType(value, expected))) {
      errors.push({ path, message: `expected ${allowed.join(' or ')}, got ${typeOf(value)}` });
      return;
    }
  }

  if ('minimum' in schema && typeof value === 'number' && value < schema.minimum) {
    errors.push({ path, message: `expected >= ${schema.minimum}, got ${value}` });
  }

  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        errors.push({ path: `${path}/${key}`, message: 'is required' });
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, entry] of Object.entries(value)) {
      if (key in properties) {
        check(entry, properties[key], `${path}/${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push({ path: `${path}/${key}`, message: 'is not a known property' });
      }
    }
  }

  if (typeOf(value) === 'array' && schema.items) {
    value.forEach((entry, index) => check(entry, schema.items, `${path}/${index}`, errors));
  }
}

/**
 * @param {unknown} value
 * @param {object} schema
 * @returns {{valid: boolean, errors: Array<{path: string, message: string}>}}
 */
export function validate(value, schema) {
  const errors = [];
  check(value, schema, '', errors);
  return { valid: errors.length === 0, errors };
}

/**
 * Validate or throw, with every failure in the message. Used where a malformed
 * value is a programming error rather than an input to be reported.
 * @param {unknown} value
 * @param {object} schema
 * @param {string} [label]
 */
export function assertValid(value, schema, label = schema.title ?? 'value') {
  const { valid, errors } = validate(value, schema);
  if (!valid) {
    const detail = errors.map((e) => `  ${e.path || '#'}: ${e.message}`).join('\n');
    throw new Error(`${label} does not match its schema:\n${detail}`);
  }
}
