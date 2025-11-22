import styles from './blertcoin-amount.module.scss';

type BlertcoinAmountProps = {
  amount: number;
  className?: string;
  showSymbol?: boolean;
};

/**
 * Displays a Blertcoin amount with the currency symbol.
 * The symbol "ꞗ" represents Blertcoin.
 */
export default function BlertcoinAmount({
  amount,
  className,
  showSymbol = true,
}: BlertcoinAmountProps) {
  return (
    <span
      className={className ? `${styles.amount} ${className}` : styles.amount}
    >
      {showSymbol && <span className={styles.symbol}>ꞗ</span>}
      <span>{amount.toLocaleString()}</span>
    </span>
  );
}
