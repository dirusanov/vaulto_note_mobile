import React, { useMemo } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { diffWords, hasDifferences } from '../utils/textDiff';
import { createStyles } from '../theme/createStyles';

interface CompareVersionsModalProps {
    visible: boolean;
    versionLabel: string;
    originalText: string;
    versionText: string;
    onClose: () => void;
}

/** What a version changed relative to the original: removals struck red, additions green. */
export const CompareVersionsModal = ({ visible, versionLabel, originalText, versionText, onClose }: CompareVersionsModalProps) => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const segments = useMemo(
        () => (visible ? diffWords(originalText, versionText) : []),
        [visible, originalText, versionText]
    );
    const changed = hasDifferences(segments);

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <View style={[styles.container, { paddingTop: insets.top + spacing.s, paddingBottom: insets.bottom }]}>
                <View style={styles.header}>
                    <TouchableOpacity
                        onPress={onClose}
                        style={styles.closeButton}
                        accessibilityRole="button"
                        accessibilityLabel={t('a11y.close', 'Close')}
                    >
                        <MaterialIcons name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <View style={styles.headerText}>
                        <Text style={styles.title}>{t('edit.versions.compareTitle', 'Changes vs Original')}</Text>
                        <Text style={styles.subtitle} numberOfLines={1}>{`${t('edit.original', 'Original')} → ${versionLabel}`}</Text>
                    </View>
                </View>
                <View style={styles.legend}>
                    <Text style={[styles.legendItem, styles.removed]}>{t('edit.versions.legendRemoved', 'removed')}</Text>
                    <Text style={[styles.legendItem, styles.added]}>{t('edit.versions.legendAdded', 'added')}</Text>
                </View>
                <ScrollView contentContainerStyle={styles.body}>
                    {changed ? (
                        <Text style={styles.text} selectable>
                            {segments.map((segment, index) => (
                                <Text
                                    key={index}
                                    style={segment.type === 'removed' ? styles.removed : segment.type === 'added' ? styles.added : undefined}
                                >
                                    {segment.text}
                                </Text>
                            ))}
                        </Text>
                    ) : (
                        <Text style={styles.empty}>{t('edit.versions.noDifferences', 'No differences from the original.')}</Text>
                    )}
                </ScrollView>
            </View>
        </Modal>
    );
};

const styles = createStyles(() => ({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.s,
        gap: spacing.m,
    },
    closeButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: -12,
    },
    headerText: {
        flex: 1,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
    },
    subtitle: {
        fontSize: 13,
        color: colors.textSecondary,
        marginTop: 2,
    },
    legend: {
        flexDirection: 'row',
        gap: spacing.s,
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.s,
    },
    legendItem: {
        fontSize: 12,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        overflow: 'hidden',
    },
    body: {
        padding: spacing.m,
    },
    text: {
        fontSize: 16,
        lineHeight: 24,
        color: colors.text,
    },
    removed: {
        color: colors.error,
        backgroundColor: colors.errorLight,
        textDecorationLine: 'line-through',
    },
    added: {
        color: isDarkScheme() ? '#4ADE80' : '#0B7A55',
        backgroundColor: colors.successLight,
    },
    empty: {
        fontSize: 15,
        color: colors.textSecondary,
    },
}));
