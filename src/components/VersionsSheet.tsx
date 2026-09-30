import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

export interface VersionListItem {
    id: string;
    /** Step label, e.g. "Make Professional → Summarize"; "Original" for the source. */
    label: string;
    icon: string;
    /** Content-derived title of the version, shown as a secondary line. */
    title?: string;
    snippet: string;
    timeLabel?: string;
}

interface VersionsSheetProps {
    visible: boolean;
    items: VersionListItem[];
    activeId: string;
    onClose: () => void;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onMakeMain: (id: string) => void;
    onCopyToNewNote: (id: string) => void;
    onRename: (id: string) => void;
}

/** Every version of a note at a glance, once the chip row gets too long to scan. */
export const VersionsSheet = ({
    visible, items, activeId, onClose, onSelect, onDelete, onMakeMain, onCopyToNewNote, onRename,
}: VersionsSheetProps) => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const close = () => {
        setExpandedId(null);
        onClose();
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
            <TouchableWithoutFeedback onPress={close}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.m) }]}>
                            <View style={styles.header}>
                                <Text style={styles.title}>{t('edit.versions.sheetTitle', 'Versions')}</Text>
                                <TouchableOpacity
                                    onPress={close}
                                    style={styles.closeButton}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('a11y.close', 'Close')}
                                >
                                    <MaterialIcons name="close" size={22} color={colors.textSecondary} />
                                </TouchableOpacity>
                            </View>
                            <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: spacing.s }}>
                                {items.map((item) => {
                                    const isActive = item.id === activeId;
                                    const isOriginal = item.id === 'original';
                                    const expanded = expandedId === item.id;
                                    return (
                                        <View key={item.id} style={[styles.row, isActive && styles.rowActive]}>
                                            <TouchableOpacity
                                                style={styles.rowMain}
                                                onPress={() => { close(); onSelect(item.id); }}
                                                accessibilityRole="button"
                                                accessibilityState={{ selected: isActive }}
                                                accessibilityLabel={[item.label, item.title].filter(Boolean).join(', ')}
                                            >
                                                <View style={[styles.iconBadge, isActive && styles.iconBadgeActive]}>
                                                    <MaterialIcons
                                                        name={item.icon as any}
                                                        size={16}
                                                        color={isActive ? colors.surface : colors.primary}
                                                    />
                                                </View>
                                                <View style={styles.rowText}>
                                                    <View style={styles.rowTopLine}>
                                                        <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
                                                        {item.timeLabel ? <Text style={styles.rowTime}>{item.timeLabel}</Text> : null}
                                                    </View>
                                                    {item.title ? <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text> : null}
                                                    {item.snippet ? <Text style={styles.rowSnippet} numberOfLines={2}>{item.snippet}</Text> : null}
                                                </View>
                                            </TouchableOpacity>
                                            {!isOriginal && (
                                                <TouchableOpacity
                                                    style={styles.moreButton}
                                                    onPress={() => setExpandedId(expanded ? null : item.id)}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={t('a11y.moreOptions', 'More options')}
                                                >
                                                    <MaterialIcons name={expanded ? 'expand-less' : 'more-vert'} size={22} color={colors.textSecondary} />
                                                </TouchableOpacity>
                                            )}
                                            {expanded && !isOriginal && (
                                                <View style={styles.actions}>
                                                    <ActionButton
                                                        icon="drive-file-rename-outline"
                                                        text={t('edit.versions.rename', 'Rename')}
                                                        onPress={() => { close(); setTimeout(() => onRename(item.id), 400); }}
                                                    />
                                                    <ActionButton
                                                        icon="vertical-align-top"
                                                        text={t('edit.versions.makeMain', 'Use as main text')}
                                                        // It asks for confirmation; iOS drops an Alert shown
                                                        // while this modal is still sliding away.
                                                        onPress={() => { close(); setTimeout(() => onMakeMain(item.id), 400); }}
                                                    />
                                                    <ActionButton
                                                        icon="note-add"
                                                        text={t('edit.versions.copyToNewNote', 'Copy to new note')}
                                                        onPress={() => { close(); onCopyToNewNote(item.id); }}
                                                    />
                                                    <ActionButton
                                                        icon="delete-outline"
                                                        text={t('common.delete', 'Delete')}
                                                        destructive
                                                        onPress={() => { close(); onDelete(item.id); }}
                                                    />
                                                </View>
                                            )}
                                        </View>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const ActionButton = ({ icon, text, onPress, destructive }: { icon: string; text: string; onPress: () => void; destructive?: boolean }) => (
    <TouchableOpacity style={styles.actionButton} onPress={onPress} accessibilityRole="button">
        <MaterialIcons name={icon as any} size={18} color={destructive ? colors.error : colors.text} />
        <Text style={[styles.actionText, destructive && { color: colors.error }]} numberOfLines={1}>{text}</Text>
    </TouchableOpacity>
);

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: spacing.m,
        maxHeight: '80%',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.m,
        marginBottom: spacing.s,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
    },
    list: {
        paddingHorizontal: spacing.s,
    },
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        borderRadius: 12,
        paddingVertical: spacing.s,
        paddingLeft: spacing.s,
        marginBottom: spacing.xs,
    },
    rowActive: {
        backgroundColor: colors.primaryLight,
    },
    rowMain: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    iconBadge: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primaryLight,
        marginRight: spacing.s,
        marginTop: 2,
    },
    iconBadgeActive: {
        backgroundColor: colors.primary,
    },
    rowText: {
        flex: 1,
    },
    rowTopLine: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    rowLabel: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    rowTime: {
        fontSize: 12,
        color: colors.textSecondary,
        marginLeft: spacing.s,
    },
    rowTitle: {
        fontSize: 13,
        color: colors.textSecondary,
        marginTop: 1,
    },
    rowSnippet: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
        marginTop: 2,
    },
    moreButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: -12,
    },
    actions: {
        width: '100%',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.s,
        paddingLeft: 40,
        paddingRight: spacing.s,
        paddingTop: spacing.s,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 44,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    actionText: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.text,
    },
});
