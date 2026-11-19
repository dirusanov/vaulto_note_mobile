import React from 'react';
import { PixelRatio, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { createStyles } from '../theme/createStyles';
import { haptics } from '../utils/haptics';
import type { MicRoute } from '../services/micRouteState';
import type { TranscriptionRoute, VoiceAgentRouteValue, VoiceInputMode } from '../utils/micRoute';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

/** Where the recording goes, in one short line, with a matching icon. */
export const routeLabel = (
    t: TFunction,
    route: TranscriptionRoute,
    cloudFallback: boolean,
): { icon: IconName; text: string; tone: 'default' | 'warning' } => {
    switch (route) {
        case 'audio_only':
            return { icon: 'graphic-eq', text: t('voice.route.audioOnly', 'Recording only · no text yet'), tone: 'default' };
        case 'device_private':
            return { icon: 'lock-outline', text: t('voice.route.devicePrivate', 'Only on this phone · nothing is sent'), tone: 'default' };
        case 'device_model_missing':
            return { icon: 'lock-outline', text: t('voice.route.deviceModelMissing', 'Only on this phone · speech model not downloaded'), tone: 'warning' };
        case 'device_offline':
            return { icon: 'smartphone', text: t('voice.route.deviceOffline', 'No internet · text is made on this phone'), tone: 'default' };
        case 'device':
            return { icon: 'smartphone', text: t('voice.route.device', 'On this phone · works offline'), tone: 'default' };
        case 'later':
            return { icon: 'cloud-off', text: t('voice.route.later', 'No internet · text comes when you are online'), tone: 'warning' };
        case 'custom':
            return { icon: 'dns', text: t('voice.route.custom', 'Your AI service · needs internet'), tone: 'default' };
        case 'cloud':
        default:
            return {
                icon: 'cloud-queue',
                text: cloudFallback
                    ? t('voice.route.cloudFallback', 'Vaulto cloud · this phone when offline')
                    : t('voice.route.cloud', 'Vaulto cloud · needs internet'),
                tone: 'default',
            };
    }
};

/** The route in two or three words, for the line under the recorder's timer. */
export const routeShortLabel = (t: TFunction, route: TranscriptionRoute): string => {
    switch (route) {
        case 'audio_only': return t('voice.routeShort.audioOnly', 'Audio only');
        case 'device_private': return t('voice.routeShort.devicePrivate', 'Only on this phone');
        case 'device_model_missing': return t('voice.routeShort.deviceModelMissing', 'No speech model');
        case 'device_offline': return t('voice.routeShort.deviceOffline', 'Offline · on this phone');
        case 'device': return t('voice.routeShort.device', 'On this phone');
        case 'later': return t('voice.routeShort.later', 'Text when online');
        case 'custom': return t('voice.routeShort.custom', 'Your AI service');
        case 'cloud':
        default: return t('voice.routeShort.cloud', 'Vaulto cloud');
    }
};

/**
 * Which explanation the recorder would show: one per kind of recording, so
 * each is shown on its own once. Warnings (no text yet) are not one-time.
 */
export const micHintKind = ({ route, mode, meeting, transcribe }: {
    route: MicRoute | null;
    mode: VoiceInputMode | null;
    meeting: boolean;
    transcribe: boolean;
}): string | null => {
    if (!route) return null;
    if (route.transcription === 'later' || route.transcription === 'device_model_missing') return null;
    if (!transcribe || route.transcription === 'audio_only') return 'audioOnly';
    if (meeting) return 'meeting';
    if (mode === 'edit') return route.agent === 'device' ? 'editDevice' : 'editCloud';
    if (mode === 'dictate') return 'dictate';
    return 'toText';
};

/** What Done will do with the words, for the chosen mode and route. */
export const outcomeText = (
    t: TFunction,
    route: MicRoute,
    mode: VoiceInputMode | null,
): string => {
    if (route.transcription === 'audio_only') {
        return t('voice.outcome.audioOnly', 'Saved as audio. Make text later from the note’s recordings.');
    }
    if (route.transcription === 'later') {
        return t('voice.outcome.later', 'The recording is saved now. Open the note with internet to get the text.');
    }
    if (route.transcription === 'device_model_missing') {
        return t('voice.outcome.modelMissing', 'The recording is saved. Download the speech model to get the text.');
    }
    if (mode === 'dictate') {
        return t('voice.outcome.dictate', 'Your words go into the note exactly as spoken.');
    }
    if (mode === 'edit' && route.agent === 'device') {
        return t('voice.outcome.editDevice', 'Short requests work on this phone: make a checklist or a list, rename the note. Anything else goes in as text.');
    }
    if (mode === 'edit' && route.agent === 'cloud') {
        return t('voice.outcome.editCloud', 'Say a change: “make a checklist”, “remove the eggs”, “rename it Trip”. Anything else goes in as text.');
    }
    return t('voice.toTextHint', 'When you finish, the recording becomes text');
};

const MODE_ICON: Record<VoiceInputMode, IconName> = { dictate: 'short-text', edit: 'auto-fix-high' };

export const modeLabel = (t: TFunction, mode: VoiceInputMode): string => (mode === 'dictate'
    ? t('voice.mode.dictate', 'Dictate')
    : t('voice.mode.edit', 'Edit by voice'));

/** The two microphone modes, side by side: what is chosen is never hidden behind a gesture. */
export const VoiceModeSwitch = ({
    value,
    onChange,
    large = false,
}: {
    value: VoiceInputMode;
    onChange: (mode: VoiceInputMode) => void;
    large?: boolean;
}) => {
    const { t } = useTranslation();
    // Large text: the words matter more than the icons, and may take two lines.
    const bigText = PixelRatio.getFontScale() >= 1.3;
    return (
        <View
            style={[styles.segments, large && styles.segmentsLarge, bigText && styles.segmentsBigText]}
            accessibilityRole="radiogroup"
            accessibilityLabel={t('voice.mode.label', 'Microphone mode')}
        >
            {(['dictate', 'edit'] as const).map((mode) => {
                const selected = value === mode;
                return (
                    <TouchableOpacity
                        key={mode}
                        style={[styles.segment, selected && styles.segmentSelected, bigText && styles.segmentBigText]}
                        onPress={() => {
                            if (selected) return;
                            haptics.selection();
                            onChange(mode);
                        }}
                        activeOpacity={0.75}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, checked: selected }}
                        accessibilityLabel={modeLabel(t, mode)}
                        accessibilityHint={mode === 'dictate'
                            ? t('voice.mode.dictateHint', 'Words go into the note as spoken')
                            : t('voice.mode.editHint', 'Requests change the note; other speech goes in as text')}
                    >
                        {!bigText && (
                            <MaterialIcons
                                name={MODE_ICON[mode]}
                                size={16}
                                color={selected ? colors.onPrimary : colors.textSecondary}
                            />
                        )}
                        <Text
                            style={[styles.segmentText, selected && styles.segmentTextSelected]}
                            numberOfLines={1}
                            adjustsFontSizeToFit={bigText}
                            minimumFontScale={0.7}
                        >
                            {modeLabel(t, mode)}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
};

/** Route and outcome under the recorder's choices: where it goes, then what Done does. */
export const MicRouteNote = ({
    route,
    mode,
    showRoute = true,
    outcome,
    alert,
}: {
    route: MicRoute | null;
    mode: VoiceInputMode | null;
    showRoute?: boolean;
    /** Replaces the outcome line (meeting, spoken instruction). */
    outcome?: string | null;
    /** Replaces both lines, in the error colour (e.g. "tap the bin again"). */
    alert?: string | null;
}) => {
    const { t } = useTranslation();
    const label = route ? routeLabel(t, route.transcription, route.cloudFallback) : null;
    const outcomeLine = outcome
        || (route ? outcomeText(t, route, mode) : t('voice.toTextHint', 'When you finish, the recording becomes text'));
    return (
        <View style={styles.note} accessibilityLiveRegion="polite" accessible>
            {alert ? (
                <Text style={[styles.noteOutcome, styles.noteWarning]} numberOfLines={3}>
                    {alert}
                </Text>
            ) : (
                <>
                    {showRoute && (
                        // Kept in place while the route is read, so nothing jumps.
                        <View style={[styles.routeLine, !label && styles.hidden]}>
                            <MaterialIcons
                                name={label?.icon ?? 'cloud-queue'}
                                size={15}
                                color={label?.tone === 'warning' ? colors.warning : colors.primary}
                            />
                            <Text style={styles.routeText} numberOfLines={2}>
                                {label?.text ?? ' '}
                            </Text>
                        </View>
                    )}
                    <Text style={styles.noteOutcome} numberOfLines={6}>
                        {outcomeLine}
                    </Text>
                </>
            )}
        </View>
    );
};

/**
 * Beside the editor's microphone: the mode the next recording uses, readable
 * before recording. One tap switches it.
 */
export const VoiceModePill = ({
    mode,
    onToggle,
}: {
    mode: VoiceInputMode;
    onToggle: () => void;
}) => {
    const { t } = useTranslation();
    const other: VoiceInputMode = mode === 'dictate' ? 'edit' : 'dictate';
    return (
        <TouchableOpacity
            style={styles.pill}
            onPress={() => {
                haptics.selection();
                onToggle();
            }}
            activeOpacity={0.75}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel={t('voice.mode.current', 'Microphone mode: {{mode}}', { mode: modeLabel(t, mode) })}
            accessibilityHint={t('voice.mode.switchTo', 'Double tap to switch to {{mode}}', { mode: modeLabel(t, other) })}
        >
            <MaterialIcons name={MODE_ICON[mode]} size={16} color={colors.primary} />
            <Text style={styles.pillText} numberOfLines={1}>
                {modeLabel(t, mode)}
            </Text>
            {PixelRatio.getFontScale() < 1.3 && (
                <MaterialIcons name="swap-horiz" size={16} color={colors.textTertiary} />
            )}
        </TouchableOpacity>
    );
};

export type { VoiceAgentRouteValue };

const styles = createStyles(() => ({
    segments: {
        flexDirection: 'row',
        alignSelf: 'center',
        maxWidth: '100%',
        padding: 3,
        borderRadius: 24,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        flexShrink: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 3,
    },
    segmentsLarge: {
        borderRadius: 26,
    },
    segment: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 1,
        minHeight: 44,
        paddingHorizontal: 14,
        paddingVertical: 4,
        borderRadius: 21,
        gap: 6,
    },
    segmentsBigText: {
        flex: 1,
    },
    segmentBigText: {
        flex: 1,
        paddingHorizontal: spacing.s,
    },
    segmentSelected: {
        backgroundColor: colors.primary,
    },
    segmentText: {
        ...typography.captionBold,
        fontSize: 13,
        color: colors.textSecondary,
        flexShrink: 1,
        textAlign: 'center',
    },
    segmentTextSelected: {
        color: colors.onPrimary,
    },
    note: {
        alignSelf: 'stretch',
        maxWidth: '100%',
        backgroundColor: colors.surface,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        paddingHorizontal: spacing.m,
        paddingVertical: spacing.s,
        marginBottom: spacing.s,
        gap: 2,
    },
    hidden: {
        opacity: 0,
    },
    routeLine: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    routeText: {
        ...typography.captionBold,
        fontSize: 13,
        lineHeight: 18,
        color: colors.text,
        flexShrink: 1,
        textAlign: 'center',
    },
    noteOutcome: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    noteWarning: {
        color: colors.error,
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: 300,
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: 18,
        gap: 6,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
    },
    pillText: {
        ...typography.captionBold,
        fontSize: 13,
        color: colors.text,
        flexShrink: 1,
    },
}));
