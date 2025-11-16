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
  account_id BIGINT,
  delta BIGINT,
  balance_after BIGINT,
  idempotent BOOLEAN  -- True if the transaction was previously posted with the same idempotency key.
) LANGUAGE plpgsql AS $$
DECLARE
  v_txn_id BIGINT;
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
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_txn_id;

    IF v_txn_id IS NULL THEN
      SELECT id INTO v_txn_id
      FROM blertcoin_transactions
      WHERE idempotency_key = p_idem_key;

      RETURN QUERY
      SELECT v_txn_id, b.account_id, d.delta, b.balance, TRUE
      FROM (
        SELECT account_id, SUM(amount) AS delta
        FROM blertcoin_transaction_entries
        WHERE txn_id = v_txn_id
        GROUP BY account_id
      ) d
      JOIN blertcoin_account_balances b ON b.account_id = d.account_id;
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
    ) RETURNING id INTO v_txn_id;
  END IF;

  -- Ensure balance rows exist and lock them deterministically.
  INSERT INTO blertcoin_account_balances (account_id, balance)
  SELECT DISTINCT (e).account_id, 0::BIGINT FROM unnest(p_entries) e
  ON CONFLICT (account_id) DO NOTHING;

  PERFORM 1 FROM blertcoin_account_balances b
  JOIN (SELECT DISTINCT (e).account_id acct FROM unnest(p_entries) e ORDER BY acct) d
    ON d.acct = b.account_id
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

  UPDATE blertcoin_account_balances b
  SET balance = b.balance + d.delta, updated_at = NOW()
  FROM (
    SELECT (e).account_id, SUM((e).amount) AS delta
    FROM unnest(p_entries) e
    GROUP BY 1
  ) d
  WHERE b.account_id = d.account_id;

  RETURN QUERY
  SELECT v_txn_id, b.account_id, d.delta, b.balance, FALSE
  FROM blertcoin_account_balances b
  JOIN (
    SELECT (e).account_id, SUM((e).amount) AS delta
    FROM unnest(p_entries) e
    GROUP BY 1
  ) d ON d.account_id = b.account_id;
END $$;
