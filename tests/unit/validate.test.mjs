import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertValid, validate } from '../../shared/schema/validate.mjs';

describe('validate', () => {
  it('distinguishes integer from number', () => {
    assert.equal(validate(3, { type: 'integer' }).valid, true);
    assert.equal(validate(3.5, { type: 'integer' }).valid, false);
    assert.equal(validate(3, { type: 'number' }).valid, true);
  });

  it('treats null as its own type, never as an object', () => {
    assert.equal(validate(null, { type: 'null' }).valid, true);
    assert.equal(validate(null, { type: 'object' }).valid, false);
    assert.equal(validate(null, { type: ['string', 'null'] }).valid, true);
  });

  it('treats an array as an array, never as an object', () => {
    assert.equal(validate([], { type: 'array' }).valid, true);
    assert.equal(validate([], { type: 'object' }).valid, false);
  });

  it('enforces required, and points at the missing key', () => {
    const schema = { type: 'object', required: ['a', 'b'], properties: {} };
    const { valid, errors } = validate({ a: 1 }, schema);

    assert.equal(valid, false);
    assert.deepEqual(errors, [{ path: '/b', message: 'is required' }]);
  });

  it('rejects unknown properties when additionalProperties is false', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { a: { type: 'number' } },
    };

    assert.equal(validate({ a: 1 }, schema).valid, true);
    assert.equal(validate({ a: 1, b: 2 }, schema).valid, false);
  });

  it('validates every item of an array, reporting the index', () => {
    const schema = { type: 'array', items: { type: 'string' } };
    const { errors } = validate(['a', 2, 'c'], schema);

    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, '/1');
  });

  it('reports a nested path a reader can follow', () => {
    const schema = {
      type: 'object',
      properties: {
        window: { type: 'object', properties: { durationMs: { type: 'number', minimum: 0 } } },
      },
    };
    const { errors } = validate({ window: { durationMs: -1 } }, schema);

    assert.equal(errors[0].path, '/window/durationMs');
  });

  it('enforces const and enum', () => {
    assert.equal(validate(1, { const: 1 }).valid, true);
    assert.equal(validate(2, { const: 1 }).valid, false);
    assert.equal(validate('A', { enum: ['A', 'B'] }).valid, true);
    assert.equal(validate('C', { enum: ['A', 'B'] }).valid, false);
  });

  it('refuses a schema keyword it does not implement, rather than ignoring it', () => {
    // The failure mode that makes a hand-rolled validator dangerous is silent
    // under-enforcement. A schema that grows beyond the subset must break the
    // build, not quietly pass everything.
    assert.throws(
      () => validate({}, { type: 'object', patternProperties: {} }),
      /Unsupported JSON Schema keyword "patternProperties"/,
    );
  });
});

describe('assertValid', () => {
  it('passes silently on a valid value', () => {
    assert.doesNotThrow(() => assertValid({ a: 1 }, { type: 'object' }));
  });

  it('throws with every failure listed', () => {
    const schema = { title: 'Thing', type: 'object', required: ['a', 'b'], properties: {} };

    assert.throws(() => assertValid({}, schema), (error) => {
      assert.match(error.message, /Thing does not match its schema/);
      assert.match(error.message, /\/a: is required/);
      assert.match(error.message, /\/b: is required/);
      return true;
    });
  });
});
