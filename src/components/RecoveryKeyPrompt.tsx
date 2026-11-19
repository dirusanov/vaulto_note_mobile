import React, { useEffect, useState } from 'react';
import { useEncryption } from '../context/EncryptionContext';
import { RecoveryCodeModal } from './RecoveryCodeModal';

// How long to wait for the platform backup before showing the 24 words anyway.
const BACKUP_WAIT_MS = 6000;

/**
 * After automatic end-to-end setup: the 24 words once, until the user confirms
 * they are saved. Also when the key went to Google / iCloud backup: the app can
 * only request that backup (it cannot tell whether iCloud Keychain or Google
 * backup is actually on and synced), so it never replaces a personal copy.
 * The platform result is awaited briefly so the screen states it correctly.
 */
export const RecoveryKeyPrompt: React.FC = () => {
    const { recoveryKeyNeedsSaving, recoveryCode, confirmRecoveryKeySaved, keyBackup, keyBackupChecked } = useEncryption();
    const [waitedOut, setWaitedOut] = useState(false);

    const pending = recoveryKeyNeedsSaving && !!recoveryCode;

    // Give the backup a moment; a slow or failed one shows the words without it.
    useEffect(() => {
        if (!pending || keyBackupChecked) {
            setWaitedOut(false);
            return;
        }
        const timer = setTimeout(() => setWaitedOut(true), BACKUP_WAIT_MS);
        return () => clearTimeout(timer);
    }, [pending, keyBackupChecked]);

    const showWords = pending && (keyBackupChecked || waitedOut);

    return (
        <RecoveryCodeModal
            visible={showWords}
            recoveryCode={recoveryCode}
            firstTime
            backup={keyBackupChecked ? keyBackup : null}
            onClose={() => { void confirmRecoveryKeySaved(); }}
        />
    );
};
