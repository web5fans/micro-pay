import { initDb, withTransaction, query } from '../src/db';
import {
  createPaymentWithTransaction,
  getTransferPaymentsBySender,
  updatePaymentStatusFromPrepareToTransfer,
  updatePaymentStatusFromTransferToPrepare,
} from '../src/models/payment';

// This test demonstrates race conditions around creating multiple prepare payments for the same sender
// and status transitions without verifying affected rows.

async function seedPayments() {
  // Delete dependent rows first to satisfy FK constraint, then payments
  await query('DELETE FROM account', []);
  await query('DELETE FROM payment', []);
}

async function testConcurrentPrepareCreatesDuplicateUncompleted() {
  await seedPayments();

  const sender = 'sender_a';
  const receiver = 'receiver_x';
  const platformIndex = 0;
  const amount = 100;
  // With unique index on active payments per sender, one of the concurrent inserts
  // should fail with 23505 and the other succeed. Adjust to handle this expected race.
  // Re-run with allSettled to capture expected failure when index triggers.
  // Now test concurrent inserts under unique index: expect one success, one 23505
  await seedPayments();
  const i1 = withTransaction((client) =>
    createPaymentWithTransaction(client, sender, receiver, platformIndex, amount, null, null)
  );
  const i2 = withTransaction((client) =>
    createPaymentWithTransaction(client, sender, receiver, platformIndex + 1, amount, null, null)
  );
  const results = await Promise.allSettled([i1, i2]);
  const successCount = results.filter(r => r.status === 'fulfilled').length;
  const hasUniqueViolation = results.some(r => r.status === 'rejected' && (
    (r as any).reason?.code === '23505' || String((r as any).reason).includes('unique constraint "ux_payment_active_sender"')
  ));
  if (successCount !== 1 || !hasUniqueViolation) {
    throw new Error(`Expected one success and one unique-constraint failure; got successCount=${successCount}, uniqueViolation=${hasUniqueViolation}`);
  }
  const uncompleted = await getTransferPaymentsBySender(sender);
  if (uncompleted.length !== 1) {
    throw new Error(`Expected 1 active payment after race; found ${uncompleted.length}`);
  }
}

async function testStatusTransitionRaceSafety() {
  await seedPayments();

  // Create a single payment
  const sender = 'sender_b';
  const receiver = 'receiver_y';
  const amount = 100;
  const created = await withTransaction((client) =>
    createPaymentWithTransaction(client, sender, receiver, 0, amount, null, null)
  );

  // Move to transfer (returns row)
  const moved = await updatePaymentStatusFromPrepareToTransfer(created.id, created.tx_hash);
  if (!moved || moved.status !== 1) {
    throw new Error('Failed to move payment to transfer');
  }

  // Race: two concurrent attempts to revert to prepare; one should succeed, the other should affect 0 rows
  const r1 = updatePaymentStatusFromTransferToPrepare(created.id);
  const r2 = updatePaymentStatusFromTransferToPrepare(created.id);
  await Promise.all([r1, r2]);

  // Verify final status by reading back
  const afterRace = await getTransferPaymentsBySender(sender);
  // Should have exactly one uncompleted payment for sender_b
  if (afterRace.length !== 1) {
    throw new Error('Unexpected number of uncompleted payments after race on status update');
  }
}

async function main() {
  try {
    await initDb();
  } catch (e) {
    console.log('SKIP: Database not available, skipping payment concurrency test.');
    process.exit(0);
  }

  try {
    await testConcurrentPrepareCreatesDuplicateUncompleted();
    await testStatusTransitionRaceSafety();
    console.log('PASS: Payment concurrency tests executed.');
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err);
    process.exit(1);
  }
}

main();