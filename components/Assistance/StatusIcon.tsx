import styles from './Assistance.module.css';

export function StatusIcon({ kind, label }: { kind: 'busy' | 'check'; label: string }) {
  return (
    <span className={styles.statusIcon} role="status" aria-label={label}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={kind === 'busy' ? styles.spinner : undefined}
      >
        <path d={kind === 'busy' ? 'M21 12a9 9 0 1 1-9-9' : 'm5 12 4 4L19 6'} />
      </svg>
    </span>
  );
}
