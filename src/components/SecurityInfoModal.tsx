import { useTranslation } from 'react-i18next';
import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface SecurityInfoModalProps {
    visible: boolean;
    onClose: () => void;
    e2eeEnabled: boolean;
    syncEnabled: boolean;
}

export const SecurityInfoModal: React.FC<SecurityInfoModalProps> = ({
    visible,
    onClose,
    e2eeEnabled,
    syncEnabled,
}) => {
    const { t } = useTranslation();

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable style={styles.container} onPress={() => { }}>
                    <View style={styles.handlecontainer}>
                        <View style={styles.handle} />
                    </View>

                    <View style={styles.header}>
                        <View style={styles.headerIconContainer}>
                            <MaterialIcons name="security" size={24} color={colors.primary} />
                        </View>
                        <View>
                            <Text style={styles.title}>{t("aux.securityPrivacy", "Security & Privacy")}</Text>
                            <Text style={styles.subtitle}>{t("aux.howWeProtect", "How we protect your data")}</Text>
                        </View>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <MaterialIcons name="close" size={24} color={colors.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.scrollContent}>

                        <View style={styles.section}>
                            <View style={[styles.iconBox, { backgroundColor: colors.accentGreen + '15' }]}>
                                <MaterialIcons name="lock" size={20} color={colors.accentGreen} />
                            </View>
                            <View style={styles.sectionText}>
                                <Text style={styles.sectionTitle}>
                                    {e2eeEnabled
                                        ? t("aux.e2eEncryption", "End-to-End Encryption")
                                        : t("settings.security.localProtection", "Local protection")}
                                </Text>
                                <Text style={styles.sectionDescription}>
                                    {e2eeEnabled
                                        ? t("aux.e2eEncryptionDesc", "Your notes are encrypted on your device using a key only you have. Vaulto cannot read the synced content.")
                                        : t("settings.security.localProtectionDescription", "Notes are encrypted in the app's local storage with a device key.")}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.divider} />

                        <View style={styles.section}>
                            <View style={[styles.iconBox, { backgroundColor: colors.primary + '15' }]}>
                                <MaterialIcons name="cloud-sync" size={20} color={colors.primary} />
                            </View>
                            <View style={styles.sectionText}>
                                <Text style={styles.sectionTitle}>
                                    {e2eeEnabled
                                        ? t("aux.secureSync", "Encrypted cloud sync")
                                        : syncEnabled
                                            ? t("settings.security.standardSync", "Standard cloud sync")
                                            : t("settings.security.syncOff", "Cloud sync is off")}
                                </Text>
                                <Text style={styles.sectionDescription}>
                                    {e2eeEnabled
                                        ? t("aux.secureSyncDesc", "End-to-end encrypted data is stored in the cloud for access across your devices.")
                                        : syncEnabled
                                            ? t("settings.security.standardSyncDescription", "Notes use standard cloud sync. Vaulto can technically process their contents to provide server features and account recovery.")
                                            : t("settings.security.syncOffDescription", "New changes stay on this device until you enable a sync mode.")}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.divider} />

                        <View style={styles.section}>
                            <View style={[styles.iconBox, { backgroundColor: colors.accentPurple + '15' }]}>
                                <MaterialIcons name="vpn-key" size={20} color={colors.accentPurple} />
                            </View>
                            <View style={styles.sectionText}>
                                <Text style={styles.sectionTitle}>
                                    {e2eeEnabled
                                        ? t("aux.yourKeyYourData", "Your Key, Your Data")
                                        : t("settings.security.optionalE2EE", "Optional E2EE")}
                                </Text>
                                <Text style={styles.sectionDescription}>
                                    {e2eeEnabled
                                        ? t("aux.yourKeyYourDataDesc", "If you lose every recovery method, Vaulto cannot recover your encrypted vault.")
                                        : t("settings.security.optionalE2EEDescription", "You can enable end-to-end encryption in Settings when you want the server to be unable to read note contents.")}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.infoBox}>
                            <MaterialIcons name="info-outline" size={20} color={colors.textSecondary} />
                            <Text style={styles.infoBoxText}>
                                {e2eeEnabled
                                    ? t("aux.zeroKnowledge", "E2EE mode uses a zero-knowledge design for note contents.")
                                    : t("settings.security.standardDisclosure", "Standard sync is not zero-knowledge. Enable E2EE for maximum cloud privacy.")}
                            </Text>
                        </View>

                    </View>

                    <View style={styles.footer}>
                        <TouchableOpacity style={styles.button} onPress={onClose}>
                            <Text style={styles.buttonText}>{t("aux.gotIt", "Got it")}</Text>
                        </TouchableOpacity>
                    </View>

                </Pressable>
            </Pressable>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    container: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '85%',
        paddingBottom: spacing.xxl, // Safe area
    },
    handlecontainer: {
        alignItems: 'center',
        paddingVertical: spacing.s,
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.border,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.l,
        paddingBottom: spacing.m,
        borderBottomWidth: 1,
        borderBottomColor: colors.border + '40', // Subtle separator
    },
    headerIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.primary + '15',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.m,
    },
    title: {
        ...typography.h3,
        fontSize: 18,
        color: colors.text,
    },
    subtitle: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    closeButton: {
        marginLeft: 'auto',
        padding: spacing.s,
    },
    scrollContent: {
        padding: spacing.l,
    },
    section: {
        flexDirection: 'row',
        gap: spacing.m,
    },
    iconBox: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    sectionText: {
        flex: 1,
        gap: 4,
    },
    sectionTitle: {
        ...typography.h4,
        fontSize: 16,
        color: colors.text,
    },
    sectionDescription: {
        ...typography.body,
        color: colors.textSecondary,
        lineHeight: 20,
    },
    divider: {
        height: 1,
        backgroundColor: colors.border,
        opacity: 0.4,
        marginVertical: spacing.l,
    },
    infoBox: {
        flexDirection: 'row',
        gap: spacing.s,
        backgroundColor: colors.backgroundSecondary,
        padding: spacing.m,
        borderRadius: 12,
        marginTop: spacing.l,
        alignItems: 'center',
    },
    infoBoxText: {
        ...typography.caption,
        color: colors.textSecondary,
        flex: 1,
    },
    footer: {
        padding: spacing.l,
        paddingTop: 0,
    },
    button: {
        backgroundColor: colors.primary,
        borderRadius: 16,
        paddingVertical: spacing.m,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonText: {
        ...typography.button,
        color: colors.surface,
        fontWeight: '600',
    },
});
