import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ScrollView, TouchableOpacity, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { ProIcon } from './ProIcon';

interface SecurityInfoModalProps {
    visible: boolean;
    onClose: () => void;
}

export const SecurityInfoModal: React.FC<SecurityInfoModalProps> = ({ visible, onClose }) => {
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
                            <Text style={styles.title}>Security & Privacy</Text>
                            <Text style={styles.subtitle}>How we protect your data</Text>
                        </View>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <MaterialIcons name="close" size={24} color={colors.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>

                        <View style={styles.section}>
                            <View style={[styles.iconBox, { backgroundColor: colors.accentGreen + '15' }]}>
                                <MaterialIcons name="lock" size={20} color={colors.accentGreen} />
                            </View>
                            <View style={styles.sectionText}>
                                <Text style={styles.sectionTitle}>End-to-End Encryption</Text>
                                <Text style={styles.sectionDescription}>
                                    Your notes are encrypted on your device using a key only you have. We cannot see your data.
                                </Text>
                            </View>
                        </View>

                        <View style={styles.divider} />

                        <View style={styles.section}>
                            <View style={[styles.iconBox, { backgroundColor: colors.primary + '15' }]}>
                                <MaterialIcons name="cloud-sync" size={20} color={colors.primary} />
                            </View>
                            <View style={styles.sectionText}>
                                <Text style={styles.sectionTitle}>Secure Sync</Text>
                                <Text style={styles.sectionDescription}>
                                    Encrypted data is safely stored in the cloud so you can access it across devices.
                                </Text>
                            </View>
                        </View>

                        <View style={styles.divider} />

                        <View style={styles.section}>
                            <View style={[styles.iconBox, { backgroundColor: colors.accentPurple + '15' }]}>
                                <MaterialIcons name="vpn-key" size={20} color={colors.accentPurple} />
                            </View>
                            <View style={styles.sectionText}>
                                <Text style={styles.sectionTitle}>Your Key, Your Data</Text>
                                <Text style={styles.sectionDescription}>
                                    If you lose your access key, we cannot recover your data. Keep it safe.
                                </Text>
                            </View>
                        </View>

                        <View style={styles.infoBox}>
                            <MaterialIcons name="info-outline" size={20} color={colors.textSecondary} />
                            <Text style={styles.infoBoxText}>
                                We practice Zero Knowledge architecture. Your privacy comes first.
                            </Text>
                        </View>

                    </ScrollView>

                    <View style={styles.footer}>
                        <TouchableOpacity style={styles.button} onPress={onClose}>
                            <Text style={styles.buttonText}>Got it</Text>
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
    content: {
        maxHeight: 400,
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
