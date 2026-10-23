import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { createStyles } from '../theme/createStyles';
import { ColorPicker } from './ColorPicker';
import { INK_COLORS } from './ink';

type Props = {
    color: string;
    recent: string[];
    onChange: (color: string, source: 'swatch' | 'custom') => void;
    /** How a colour looks on the canvas (dark mode shows ink inverted). */
    display?: (color: string) => string;
};

const Swatch: React.FC<{ value: string; active: boolean; onPress: () => void; shown: string }> = ({ value, active, onPress, shown }) => (
    <TouchableOpacity
        onPress={onPress}
        style={[styles.ring, active && styles.ringActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={value}
    >
        <View style={[styles.swatch, { backgroundColor: shown }]}>
            {active && <MaterialIcons name="check" size={16} color={isLight(shown) ? '#1D1D1F' : '#FFFFFF'} />}
        </View>
    </TouchableOpacity>
);

const isLight = (hex: string) => {
    const value = parseInt(hex.slice(1), 16) || 0;
    return 0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255) > 170;
};

/** Ready-made palette, recently used colours and a full custom picker. */
export const ColorPanel: React.FC<Props> = ({ color, recent, onChange, display = (value) => value }) => {
    const { t } = useTranslation();
    const [tab, setTab] = useState<'palette' | 'custom'>('palette');
    const current = color.toUpperCase();

    return (
        <View style={styles.root}>
            <View style={styles.tabs}>
                {(['palette', 'custom'] as const).map((value) => (
                    <TouchableOpacity
                        key={value}
                        onPress={() => setTab(value)}
                        style={[styles.tab, tab === value && styles.tabActive]}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: tab === value }}
                    >
                        <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>
                            {value === 'palette' ? t('drawing.color.palette', 'Palette') : t('drawing.color.custom', 'Custom')}
                        </Text>
                    </TouchableOpacity>
                ))}
                <View style={[styles.preview, { backgroundColor: display(current) }]} />
            </View>

            {tab === 'palette' ? (
                <View style={styles.grid}>
                    {INK_COLORS.map((value) => (
                        <Swatch key={value} value={value} shown={display(value)} active={value === current} onPress={() => onChange(value, 'swatch')} />
                    ))}
                </View>
            ) : (
                <ColorPicker color={current} onChange={(hex) => onChange(hex, 'custom')} />
            )}

            {recent.length > 0 && (
                <>
                    <Text style={styles.heading}>{t('drawing.color.recent', 'Recent')}</Text>
                    <View style={styles.grid}>
                        {recent.map((value) => (
                            <Swatch key={value} value={value} shown={display(value)} active={value === current} onPress={() => onChange(value, 'swatch')} />
                        ))}
                    </View>
                </>
            )}
        </View>
    );
};

const styles = createStyles(() => ({
    root: { gap: 12 },
    tabs: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tab: { paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: colors.backgroundSecondary },
    tabActive: { backgroundColor: colors.primary },
    tabText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    tabTextActive: { color: colors.onPrimary },
    preview: { marginLeft: 'auto', width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
    heading: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    ring: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
    ringActive: { borderColor: colors.primary },
    swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)', alignItems: 'center', justifyContent: 'center' },
}));
