import { initDb, query, withTransaction } from '../src/db';
import {
  getAvailablePlatformAddress,
  getAvailablePlatformAddressWithTransaction,
} from '../src/models/platformAddress';

type Alloc = { address: string; index: number; inUse: boolean };

async function seedPlatformAddresses(count: number) {
  await query('DELETE FROM platform_address', []);
  for (let i = 0; i < count; i++) {
    await query(
      'INSERT INTO platform_address(address, index, is_used) VALUES ($1, $2, false)',
      [`addr_${i}`, i]
    );
  }
}

async function testNonTransactionConcurrency() {
  const N = 5;
  await seedPlatformAddresses(N);

  const M = 7; // more concurrent requests than available addresses
  const results = await Promise.all(
    Array.from({ length: M }, () => getAvailablePlatformAddress())
  );
  const allocated = results.filter(Boolean) as Alloc[];
  const indices = allocated.map((r) => r.index);
  const unique = new Set(indices);

  if (unique.size !== allocated.length) {
    throw new Error('Duplicate allocation detected in non-transaction version');
  }

  const after = await getAvailablePlatformAddress();
  if (after !== null) {
    throw new Error('Expected null after exhausting addresses (non-transaction)');
  }
}

async function testTransactionConcurrency() {
  // reset all to unused
  await query('UPDATE platform_address SET is_used = false', []);

  const M = 7; // more concurrent requests than available addresses
  const results = await Promise.all(
    Array.from({ length: M }, () =>
      withTransaction((client) => getAvailablePlatformAddressWithTransaction(client))
    )
  );
  const allocated = results.filter(Boolean) as Alloc[];
  const indices = allocated.map((r) => r.index);
  const unique = new Set(indices);

  if (unique.size !== allocated.length) {
    throw new Error('Duplicate allocation detected in transaction version');
  }

  const after = await withTransaction((client) =>
    getAvailablePlatformAddressWithTransaction(client)
  );
  if (after !== null) {
    throw new Error('Expected null after exhausting addresses (transaction)');
  }
}

async function main() {
  // Ensure DB is available; skip gracefully if not
  try {
    await initDb();
  } catch (e) {
    console.log('SKIP: Database not available, skipping concurrency test.');
    process.exit(0);
  }

  try {
    await testNonTransactionConcurrency();
    await testTransactionConcurrency();
    console.log('PASS: Platform address concurrency allocation behaves as expected.');
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err);
    process.exit(1);
  }
}

main();