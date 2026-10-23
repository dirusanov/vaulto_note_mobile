import React, { useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

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
                                    <MaterialIcons name="close" size={20} color={colors.textSecondary} />
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
                                                accessibilityLabel={[item.label, item.title !== item.label ? item.title : ''].filter(Boolean).join(', ')}
                                            >
                                                <MaterialIcons
                                                    name={item.icon as any}
                                                    size={18}
                                                    color={isActive ? colors.primary : colors.textSecondary}
                                                    style={styles.rowIcon}
                                                />
                                                <View style={styles.rowText}>
                                                    <View style={styles.rowTopLine}>
                                                        <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
                                                        {item.timeLabel ? <Text style={styles.rowTime}>{item.timeLabel}</Text> : null}
                                                    </View>
                                                    {/* No per-version title line: the note has one title, so it only repeated it. */}
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

const styles = createStyles(() => ({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
        borderTopRightRadius: 24,
        paddingTop: spacing.l,
        maxHeight: '80%',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.l,
        marginBottom: spacing.m,
    },
    title: {
        fontSize: 20,
        lineHeight: 26,
        fontWeight: '700',
        letterSpacing: -0.3,
        color: colors.text,
    },
    list: {
        paddingHorizontal: spacing.m,
    },
    // The open version gets the same 2px outline as a chosen plan or model;
    // the border is reserved at rest so rows do not shift.
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        borderRadius: 14,
        borderWidth: 2,
        borderColor: 'transparent',
        paddingVertical: spacing.s,
        paddingHorizontal: spacing.s,
        marginBottom: spacing.xs,
    },
    rowActive: {
        borderColor: colors.primary,
    },
    rowMain: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    rowIcon: {
        marginTop: 1,
        marginRight: spacing.s,
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
    rowSnippet: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        marginTop: 2,
    },
    moreButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.backgroundSecondary,
    },
    actions: {
        // One column of plain rows: translated labels are too long to sit side by side.
        width: '100%',
        marginTop: spacing.s,
        borderRadius: 12,
        backgroundColor: colors.backgroundSecondary,
        overflow: 'hidden',
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s,
        minHeight: 48,
        paddingHorizontal: spacing.m,
    },
    actionText: {
        fontSize: 15,
        color: colors.text,
    },
}));
