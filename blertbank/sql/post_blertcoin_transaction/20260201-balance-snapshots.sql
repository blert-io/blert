CREATE OR REPLACE FUNCTION post_blertcoin_transaction(
  p_created_by INT,
  p_created_by_svc TEXT,
  p_reason TEXT,
  p_idem_key TEXT,
  p_source_table TEXT,
  p_source_id BIGINT,
  p_metadata JSONB,
  p_entries blertcoin_entry_input[]
) RETURNS TABLE (
  transaction_id BIGINT,
  created_at TIMESTAMPTZ,
  account_id BIGINT,
  delta BIGINT,
  balance_after BIGINT,
  idempotent BOOLEAN  -- True if the transaction was previously posted with the same idempotency key.
) LANGUAGE plpgsql AS $$
DECLARE
  v_txn_id BIGINT;
  v_created_at TIMESTAMPTZ;
  v_sum BIGINT;
BEGIN
  -- Validate input entries.
  SELECT COALESCE(SUM((e).amount), 0) INTO v_sum FROM unnest(p_entries) e;
  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'UNBALANCED_TRANSACTION' USING ERRCODE = 'BL101';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_entries) e WHERE (e).amount = 0
  ) THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'BL102',
      DETAIL = 'Zero-amount entries are not allowed';
  END IF;

  -- Check for idempotency.
  IF p_idem_key IS NOT NULL THEN
    INSERT INTO blertcoin_transactions (
      created_by,
      created_by_svc,
      reason,
      idempotency_key,
      source_table,
      source_id,
      metadata
    ) VALUES (
      p_created_by,
      p_created_by_svc,
      p_reason,
      p_idem_key,
      p_source_table,
      p_source_id,
      COALESCE(p_metadata, '{}'::jsonb)
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id, blertcoin_transactions.created_at INTO v_txn_id, v_created_at;

    IF v_txn_id IS NULL THEN
      SELECT id, t.created_at INTO v_txn_id, v_created_at
      FROM blertcoin_transactions t
      WHERE idempotency_key = p_idem_key;

      RETURN QUERY
      SELECT v_txn_id, v_created_at, s.account_id, s.delta, s.balance_after, TRUE
      FROM blertcoin_transaction_accounts s
      WHERE s.txn_id = v_txn_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'MISSING_SNAPSHOT' USING ERRCODE = 'BL104';
      END IF;
      RETURN;
    END IF;
  ELSE
    INSERT INTO blertcoin_transactions (
      created_by,
      created_by_svc,
      reason,
      source_table,
      source_id,
      metadata
    ) VALUES (
      p_created_by,
      p_created_by_svc,
      p_reason,
      p_source_table,
      p_source_id,
      COALESCE(p_metadata, '{}'::jsonb)
    ) RETURNING id, blertcoin_transactions.created_at INTO v_txn_id, v_created_at;
  END IF;

  -- Ensure balance rows exist and lock them deterministically.
  INSERT INTO blertcoin_account_balances (account_id, balance)
  SELECT DISTINCT (e).account_id, 0::BIGINT FROM unnest(p_entries) e
  ON CONFLICT ON CONSTRAINT blertcoin_account_balances_pkey DO NOTHING;

  -- Lock balance rows in deterministic order to prevent deadlocks.
  PERFORM 1 FROM blertcoin_account_balances b
  WHERE b.account_id = ANY(ARRAY(SELECT DISTINCT (e).account_id FROM unnest(p_entries) e))
  ORDER BY b.account_id
  FOR UPDATE;

  PERFORM 1 FROM (
    SELECT b.account_id, b.balance + SUM((e).amount) AS new_balance
    FROM blertcoin_account_balances b
    JOIN blertcoin_accounts a ON a.id = b.account_id
    JOIN unnest(p_entries) e ON (e).account_id = b.account_id
    WHERE a.kind IN ('user', 'sink', 'escrow')
    GROUP BY b.account_id, b.balance
  ) x WHERE x.new_balance < 0;
  IF FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS' USING ERRCODE = 'BL103';
  END IF;

  INSERT INTO blertcoin_transaction_entries(txn_id, account_id, amount)
  SELECT v_txn_id, (e).account_id, (e).amount FROM unnest(p_entries) e;

  WITH deltas AS (
    SELECT (e).account_id AS acct_id, SUM((e).amount) AS delta
    FROM unnest(p_entries) e
    GROUP BY (e).account_id
  ),
  updated AS (
    UPDATE blertcoin_account_balances b
    SET balance = b.balance + d.delta, updated_at = NOW()
    FROM deltas d
    WHERE b.account_id = d.acct_id
    RETURNING b.account_id, d.delta, b.balance AS balance_after
  )
  INSERT INTO blertcoin_transaction_accounts (txn_id, account_id, delta, balance_after)
  SELECT v_txn_id, u.account_id, u.delta, u.balance_after
  FROM updated u;

  RETURN QUERY
  SELECT v_txn_id, v_created_at, s.account_id, s.delta, s.balance_after, FALSE
  FROM blertcoin_transaction_accounts s
  WHERE s.txn_id = v_txn_id;
END $$;
