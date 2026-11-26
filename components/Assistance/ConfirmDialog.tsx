import type { ReactNode } from 'react';
import { Modal } from '@mantine/core';
import styles from './Assistance.module.css';

export function ConfirmDialog({
  opened,
  title,
  confirmLabel,
  children,
  onConfirm,
  onCancel,
}: {
  opened: boolean;
  title: string;
  confirmLabel: string;
  children: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={title}
      centered
      returnFocus
      transitionProps={{ duration: 0 }}
      classNames={{
        content: styles.modalContent,
        header: styles.modalHeader,
        title: styles.modalTitle,
        body: styles.modalBody,
        close: styles.modalClose,
      }}
    >
      {children}
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onCancel} data-autofocus>
          Cancel
        </button>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
