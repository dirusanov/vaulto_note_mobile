import React from 'react';
import { useEncryption } from '../context/EncryptionContext';
import { RecoveryCodeModal } from './RecoveryCodeModal';

/**
 * Shown once, app-wide, after automatic end-to-end setup: the recovery key, until
 * the user confirms it is saved (it comes back on the next launch otherwise).
 */
export const RecoveryKeyPrompt: React.FC = () => {
    const { recoveryKeyNeedsSaving, recoveryCode, confirmRecoveryKeySaved, keyBackup } = useEncryption();
    return (
        <RecoveryCodeModal
            visible={recoveryKeyNeedsSaving && !!recoveryCode}
            recoveryCode={recoveryCode}
            firstTime
            backup={keyBackup}
            onClose={() => { void confirmRecoveryKeySaved(); }}
        />
    );
};
