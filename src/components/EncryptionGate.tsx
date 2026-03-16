import React from 'react';
import { useEncryption } from '../context/EncryptionContext';

export const EncryptionGate = ({ children }: { children: React.ReactNode }) => {
    useEncryption();

    return <>{children}</>;
};
