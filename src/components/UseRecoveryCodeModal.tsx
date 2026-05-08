import React, { useState } from 'react';
import {
    Modal,
    StyleSheet,
    Text,
    View,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    TouchableOpacity,
    Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useEncryption } from '../context/EncryptionContext';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { Button } from './Button';
import { TextInput } from './TextInput';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import jpeg from 'jpeg-js';
import jsQR from 'jsqr';

interface UseRecoveryCodeModalProps {
    visible: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export const UseRecoveryCodeModal: React.FC<UseRecoveryCodeModalProps> = ({
    visible,
    onClose,
    onSuccess,
}) => {
    const { t } = useTranslation();
    const { setupWithRecoveryCode } = useEncryption();
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [showScanner, setShowScanner] = useState(false);
    const [permission, requestPermission] = useCameraPermissions();

    const base64ToUint8Array = (base64: string): Uint8Array => {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    };

    const handleUnlock = async () => {
        if (!code.trim()) {
            setError(t('settings.recovery.inputRequired', 'Please enter your recovery code.'));
            return;
        }

        setLoading(true);
        setError(null);
        try {
            await setupWithRecoveryCode(code);
            setCode('');
            onSuccess();
            onClose();
        } catch (e: any) {
            setError(e?.message || t('settings.recovery.invalidCode', 'Invalid recovery code. Please check for typos.'));
        } finally {
            setLoading(false);
        }
    };

    const handleScanQr = async () => {
        if (!permission || !permission.granted) {
            const res = await requestPermission();
            if (!res.granted) {
                Alert.alert(t('common.permission', 'Permission'), t('settings.recovery.cameraPermissionRequired', 'Camera permission required to scan QR code.'));
                return;
            }
        }
        setShowScanner(true);
    };

    const handleImportImage = async () => {
        try {
            const res = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: 'images',
                allowsEditing: true,
                quality: 1,
            });

            if (res.canceled || !res.assets || !res.assets[0]) return;

            const uri = res.assets[0].uri;
            const base64 = await FileSystem.readAsStringAsync(uri, {
                encoding: 'base64',
            });

            const buffer = base64ToUint8Array(base64);
            const decoded = jpeg.decode(buffer, { useTArray: true });
            
            if (decoded && decoded.data) {
                const qrCode = jsQR(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height);
                if (qrCode && qrCode.data) {
                    setCode(qrCode.data);
                    Alert.alert(t('common.success', 'Success'), t('settings.recovery.qrScannedMsg', 'QR code successfully read!'));
                } else {
                    Alert.alert(t('common.error', 'Error'), t('settings.recovery.noQrFound', 'No QR code found in this image.'));
                }
            } else {
                Alert.alert(t('common.error', 'Error'), t('settings.recovery.decodeFailed', 'Failed to decode image data.'));
            }
        } catch (e: any) {
            Alert.alert(t('common.error', 'Error'), e.message || t('settings.recovery.errorProcessingImage', 'Failed to process image.'));
        }
    };

    if (showScanner) {
        return (
            <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setShowScanner(false)}>
                <View style={styles.scannerOverlay}>
                    <CameraView
                        style={StyleSheet.absoluteFillObject}
                        onBarcodeScanned={({ data }) => {
                            setCode(data);
                            setShowScanner(false);
                        }}
                    />
                    <View style={styles.scannerControls}>
                        <Button
                            title={t('common.cancel', 'Cancel')}
                            variant="outline"
                            onPress={() => setShowScanner(false)}
                            style={styles.scannerCancelButton}
                        />
                    </View>
                </View>
            </Modal>
        );
    }

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <KeyboardAvoidingView
                    behavior="padding"
                    style={styles.avoider}
                    pointerEvents="box-none"
                >
                    <ScrollView
                        style={styles.scrollView}
                        contentContainerStyle={styles.scrollContent}
                        bounces={false}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                        pointerEvents="box-none"
                    >
                        <Pressable style={styles.cardPressable} pointerEvents="auto">
                            <View style={styles.card}>
                                <Text style={styles.title}>{t('settings.recovery.useTitle', 'Use Recovery Code')}</Text>
                                <Text style={styles.subtitle}>
                                    {t('settings.recovery.useSubtitle', 'Enter your 12 or 24-word recovery code to regain access to your encrypted notes.')}
                                </Text>

                                <TextInput
                                    label={t('settings.recovery.label', 'Recovery Code')}
                                    value={code}
                                    onChangeText={setCode}
                                    multiline
                                    numberOfLines={3}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    placeholder="e.g. portion goat learn cup..."
                                    style={styles.input}
                                />

                                <View style={styles.qrActions}>
                                    <TouchableOpacity style={styles.qrActionButton} onPress={handleScanQr}>
                                        <MaterialCommunityIcons name="camera" size={20} color={colors.primary} />
                                        <Text style={styles.qrActionButtonText}>{t('settings.recovery.scanQr', 'Scan QR Code')}</Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity style={styles.qrActionButton} onPress={handleImportImage}>
                                        <MaterialCommunityIcons name="image-search" size={20} color={colors.primary} />
                                        <Text style={styles.qrActionButtonText}>{t('settings.recovery.pickQr', 'Import from Image')}</Text>
                                    </TouchableOpacity>
                                </View>

                                {error && <Text style={styles.error}>{error}</Text>}

                                <View style={styles.actions}>
                                    <Button
                                        title={t('common.cancel', 'Cancel')}
                                        variant="outline"
                                        onPress={onClose}
                                        disabled={loading}
                                        style={styles.actionButton}
                                    />
                                    <Button
                                        title={t('common.unlock', 'Unlock')}
                                        onPress={handleUnlock}
                                        loading={loading}
                                        disabled={loading}
                                        style={styles.actionButton}
                                    />
                                </View>
                            </View>
                        </Pressable>
                    </ScrollView>
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    avoider: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        padding: spacing.l,
    },
    cardPressable: {
        width: '100%',
        alignItems: 'center',
    },
    card: {
        width: '100%',
        maxWidth: 400,
        backgroundColor: colors.surface,
        borderRadius: 24,
        padding: spacing.l,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'stretch',
    },
    title: {
        ...typography.h3,
        textAlign: 'center',
        marginBottom: spacing.s,
    },
    subtitle: {
        ...typography.bodySmall,
        textAlign: 'center',
        color: colors.textSecondary,
        marginBottom: spacing.l,
    },
    input: {
        minHeight: 100,
        textAlignVertical: 'top',
    },
    qrActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: spacing.s,
        marginBottom: spacing.m,
        gap: spacing.s,
    },
    qrActionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.s,
        backgroundColor: colors.primary + '10',
        borderRadius: 12,
    },
    qrActionButtonText: {
        ...typography.captionBold,
        color: colors.primary,
    },
    error: {
        ...typography.captionBold,
        color: colors.error,
        marginTop: spacing.s,
        marginBottom: spacing.s,
    },
    actions: {
        flexDirection: 'row',
        gap: spacing.s,
        marginTop: spacing.m,
    },
    actionButton: {
        flex: 1,
    },
    scannerOverlay: {
        flex: 1,
        backgroundColor: '#000',
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    scannerControls: {
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        width: '100%',
        padding: spacing.xl,
        alignItems: 'center',
    },
    scannerCancelButton: {
        width: '80%',
    },
});
