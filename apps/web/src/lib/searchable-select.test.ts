import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterSearchableOptions } from './searchable-select';

interface FakeCustomer {
  id: string;
  customerNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

const customers: FakeCustomer[] = [
  { id: '1', customerNumber: 'TA-000013', firstName: 'Michael', lastName: 'Owusu', email: 'michael.owusu@example.com', phone: '+1-555-0100' },
  { id: '2', customerNumber: 'TA-000042', firstName: 'Ama', lastName: 'Boateng', email: 'ama.boateng@example.com', phone: '+1-555-0142' },
  { id: '3', customerNumber: 'TA-000099', firstName: 'Kwesi', lastName: 'Owusu', email: 'kwesi.o@example.com', phone: null },
];

function searchText(customer: FakeCustomer): string {
  return `${customer.customerNumber} ${customer.firstName} ${customer.lastName} ${customer.email} ${customer.phone ?? ''}`;
}

test('empty query returns every item, unfiltered', () => {
  const { matches, truncatedCount } = filterSearchableOptions(customers, '', searchText);
  assert.deepEqual(matches, customers);
  assert.equal(truncatedCount, 0);
});

test('matches by customer name, case-insensitively', () => {
  const { matches } = filterSearchableOptions(customers, 'michael', searchText);
  assert.deepEqual(matches.map((c) => c.id), ['1']);
});

test('matches by customer number', () => {
  const { matches } = filterSearchableOptions(customers, 'TA-000042', searchText);
  assert.deepEqual(matches.map((c) => c.id), ['2']);
});

test('matches by customer number regardless of case', () => {
  const { matches } = filterSearchableOptions(customers, 'ta-000013', searchText);
  assert.deepEqual(matches.map((c) => c.id), ['1']);
});

test('matches by email', () => {
  const { matches } = filterSearchableOptions(customers, 'ama.boateng@example.com', searchText);
  assert.deepEqual(matches.map((c) => c.id), ['2']);
});

test('matches by phone', () => {
  const { matches } = filterSearchableOptions(customers, '555-0100', searchText);
  assert.deepEqual(matches.map((c) => c.id), ['1']);
});

test('multi-word queries require every token to match (AND), independent of word order', () => {
  assert.deepEqual(filterSearchableOptions(customers, 'michael owusu', searchText).matches.map((c) => c.id), ['1']);
  assert.deepEqual(filterSearchableOptions(customers, 'owusu michael', searchText).matches.map((c) => c.id), ['1']);
});

test('a shared last name alone can match multiple customers', () => {
  const { matches } = filterSearchableOptions(customers, 'owusu', searchText);
  assert.deepEqual(
    matches.map((c) => c.id).sort(),
    ['1', '3'],
  );
});

test('a customer with no phone is never a false match on an empty phone field', () => {
  const { matches } = filterSearchableOptions(customers, 'kwesi', searchText);
  assert.deepEqual(matches.map((c) => c.id), ['3']);
});

test('no matches returns an empty list, not an error', () => {
  const { matches, truncatedCount } = filterSearchableOptions(customers, 'nonexistent-query-xyz', searchText);
  assert.deepEqual(matches, []);
  assert.equal(truncatedCount, 0);
});

test('maxResults caps the returned list and reports how many were cut off', () => {
  const many = Array.from({ length: 250 }, (_, i) => ({
    id: String(i),
    customerNumber: `TA-${String(i).padStart(6, '0')}`,
    firstName: 'Test',
    lastName: `Customer${i}`,
    email: `test${i}@example.com`,
    phone: null,
  }));
  const { matches, truncatedCount } = filterSearchableOptions(many, 'test', searchText, 50);
  assert.equal(matches.length, 50);
  assert.equal(truncatedCount, 200);
});

test('maxResults does not report truncation when everything fit', () => {
  const { matches, truncatedCount } = filterSearchableOptions(customers, '', searchText, 50);
  assert.equal(matches.length, 3);
  assert.equal(truncatedCount, 0);
});
