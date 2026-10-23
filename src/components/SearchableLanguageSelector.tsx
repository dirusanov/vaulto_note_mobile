import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, SafeAreaView, StatusBar, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { TextInput } from './TextInput';
import { TranscriptionLanguage } from '../utils/storage';
import { createStyles } from '../theme/createStyles';

export interface LanguageOption {
    key: string;
    /** English name: kept for search. */
    label: string;
    /** The language's own name, shown in the list (as the app-language picker does). */
    native?: string;
}

export const WHISPER_LANGUAGES: LanguageOption[] = [
    { key: 'auto', label: 'Auto-Detect' },
    { key: 'en', label: 'English' },
    { key: 'zh', label: 'Chinese', native: '中文' },
    { key: 'de', label: 'German', native: 'Deutsch' },
    { key: 'es', label: 'Spanish', native: 'Español' },
    { key: 'ru', label: 'Russian', native: 'Русский' },
    { key: 'ko', label: 'Korean', native: '한국어' },
    { key: 'fr', label: 'French', native: 'Français' },
    { key: 'ja', label: 'Japanese', native: '日本語' },
    { key: 'pt', label: 'Portuguese', native: 'Português' },
    { key: 'tr', label: 'Turkish', native: 'Türkçe' },
    { key: 'pl', label: 'Polish', native: 'Polski' },
    { key: 'ca', label: 'Catalan', native: 'Català' },
    { key: 'nl', label: 'Dutch', native: 'Nederlands' },
    { key: 'ar', label: 'Arabic', native: 'العربية' },
    { key: 'sv', label: 'Swedish', native: 'Svenska' },
    { key: 'it', label: 'Italian', native: 'Italiano' },
    { key: 'id', label: 'Indonesian', native: 'Bahasa Indonesia' },
    { key: 'hi', label: 'Hindi', native: 'हिन्दी' },
    { key: 'fi', label: 'Finnish', native: 'Suomi' },
    { key: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
    { key: 'he', label: 'Hebrew', native: 'עברית' },
    { key: 'uk', label: 'Ukrainian', native: 'Українська' },
    { key: 'el', label: 'Greek', native: 'Ελληνικά' },
    { key: 'ms', label: 'Malay', native: 'Bahasa Melayu' },
    { key: 'cs', label: 'Czech', native: 'Čeština' },
    { key: 'ro', label: 'Romanian', native: 'Română' },
    { key: 'da', label: 'Danish', native: 'Dansk' },
    { key: 'hu', label: 'Hungarian', native: 'Magyar' },
    { key: 'ta', label: 'Tamil', native: 'தமிழ்' },
    { key: 'no', label: 'Norwegian', native: 'Norsk' },
    { key: 'th', label: 'Thai', native: 'ไทย' },
    { key: 'ur', label: 'Urdu', native: 'اردو' },
    { key: 'hr', label: 'Croatian', native: 'Hrvatski' },
    { key: 'bg', label: 'Bulgarian', native: 'Български' },
    { key: 'lt', label: 'Lithuanian', native: 'Lietuvių' },
    { key: 'la', label: 'Latin', native: 'Latina' },
    { key: 'mi', label: 'Maori', native: 'Māori' },
    { key: 'ml', label: 'Malayalam', native: 'മലയാളം' },
    { key: 'cy', label: 'Welsh', native: 'Cymraeg' },
    { key: 'sk', label: 'Slovak', native: 'Slovenčina' },
    { key: 'te', label: 'Telugu', native: 'తెలుగు' },
    { key: 'fa', label: 'Persian', native: 'فارسی' },
    { key: 'lv', label: 'Latvian', native: 'Latviešu' },
    { key: 'bn', label: 'Bengali', native: 'বাংলা' },
    { key: 'sr', label: 'Serbian', native: 'Српски' },
    { key: 'az', label: 'Azerbaijani', native: 'Azərbaycan' },
    { key: 'sl', label: 'Slovenian', native: 'Slovenščina' },
    { key: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
    { key: 'et', label: 'Estonian', native: 'Eesti' },
    { key: 'mk', label: 'Macedonian', native: 'Македонски' },
    { key: 'br', label: 'Breton', native: 'Brezhoneg' },
    { key: 'eu', label: 'Basque', native: 'Euskara' },
    { key: 'is', label: 'Icelandic', native: 'Íslenska' },
    { key: 'hy', label: 'Armenian', native: 'Հայերեն' },
    { key: 'ne', label: 'Nepali', native: 'नेपाली' },
    { key: 'mn', label: 'Mongolian', native: 'Монгол' },
    { key: 'bs', label: 'Bosnian', native: 'Bosanski' },
    { key: 'kk', label: 'Kazakh', native: 'Қазақ' },
    { key: 'sq', label: 'Albanian', native: 'Shqip' },
    { key: 'sw', label: 'Swahili', native: 'Kiswahili' },
    { key: 'gl', label: 'Galician', native: 'Galego' },
    { key: 'mr', label: 'Marathi', native: 'मराठी' },
    { key: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
    { key: 'si', label: 'Sinhala', native: 'සිංහල' },
    { key: 'km', label: 'Khmer', native: 'ខ្មែរ' },
    { key: 'sn', label: 'Shona', native: 'ChiShona' },
    { key: 'yo', label: 'Yoruba', native: 'Yorùbá' },
    { key: 'so', label: 'Somali', native: 'Soomaali' },
    { key: 'af', label: 'Afrikaans' },
    { key: 'oc', label: 'Occitan' },
    { key: 'ka', label: 'Georgian', native: 'ქართული' },
    { key: 'be', label: 'Belarusian', native: 'Беларуская' },
    { key: 'tg', label: 'Tajik', native: 'Тоҷикӣ' },
    { key: 'sd', label: 'Sindhi', native: 'سنڌي' },
    { key: 'gu', label: 'Gujarati', native: 'ગુજરાતી' },
    { key: 'am', label: 'Amharic', native: 'አማርኛ' },
    { key: 'yi', label: 'Yiddish', native: 'ייִדיש' },
    { key: 'lo', label: 'Lao', native: 'ລາວ' },
    { key: 'uz', label: 'Uzbek', native: 'Oʻzbek' },
    { key: 'fo', label: 'Faroese', native: 'Føroyskt' },
    { key: 'ht', label: 'Haitian Creole', native: 'Kreyòl ayisyen' },
    { key: 'ps', label: 'Pashto', native: 'پښتو' },
    { key: 'tk', label: 'Turkmen', native: 'Türkmen' },
    { key: 'nn', label: 'Nynorsk' },
    { key: 'mt', label: 'Maltese', native: 'Malti' },
    { key: 'sa', label: 'Sanskrit', native: 'संस्कृतम्' },
    { key: 'lb', label: 'Luxembourgish', native: 'Lëtzebuergesch' },
    { key: 'my', label: 'Myanmar', native: 'မြန်မာ' },
    { key: 'bo', label: 'Tibetan', native: 'བོད་སྐད' },
    { key: 'tl', label: 'Tagalog' },
    { key: 'mg', label: 'Malagasy' },
    { key: 'as', label: 'Assamese', native: 'অসমীয়া' },
    { key: 'tt', label: 'Tatar', native: 'Татар' },
    { key: 'haw', label: 'Hawaiian', native: 'ʻŌlelo Hawaiʻi' },
    { key: 'ln', label: 'Lingala', native: 'Lingála' },
    { key: 'ha', label: 'Hausa' },
    { key: 'ba', label: 'Bashkir', native: 'Башҡорт' },
    { key: 'jw', label: 'Javanese', native: 'Basa Jawa' },
    { key: 'su', label: 'Sundanese', native: 'Basa Sunda' },
];


interface SearchableLanguageSelectorProps {
    value: TranscriptionLanguage;
    onChange: (value: TranscriptionLanguage) => void;
    /** Draws a custom control in place of the default pill, e.g. a whole settings row. */
    renderTrigger?: (open: () => void, selectedLabel: string) => React.ReactNode;
}

export const SearchableLanguageSelector: React.FC<SearchableLanguageSelectorProps> = ({ value, onChange, renderTrigger }) => {
    const { t } = useTranslation();

    const [modalVisible, setModalVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Each language in its own name, whatever the app language; only "auto" is UI copy.
    const getLanguageLabel = (lang: LanguageOption) =>
        lang.key === 'auto' ? t('aux.autoDetect', 'Auto-Detect') : (lang.native ?? lang.label);

    const selectedLanguageLabel = useMemo(() => {
        const selected = WHISPER_LANGUAGES.find(l => l.key === value);
        return selected ? getLanguageLabel(selected) : t('aux.autoDetect', 'Auto-Detect');
    }, [value, t]);

    const filteredLanguages = useMemo(() => {
        if (!searchQuery) return WHISPER_LANGUAGES;
        const lowerQuery = searchQuery.toLowerCase();
        return WHISPER_LANGUAGES.filter(
            lang => lang.label.toLowerCase().includes(lowerQuery)
                || (lang.native ?? '').toLowerCase().includes(lowerQuery)
                || getLanguageLabel(lang).toLowerCase().includes(lowerQuery)
                || lang.key.toLowerCase().includes(lowerQuery)
        );
    }, [searchQuery, t]);

    const handleSelect = (key: string) => {
        onChange(key as TranscriptionLanguage);
        setModalVisible(false);
        setSearchQuery('');
    };

    return (
        <View>
            {renderTrigger ? renderTrigger(() => setModalVisible(true), selectedLanguageLabel) : (
                <TouchableOpacity
                    style={styles.selectorButton}
                    activeOpacity={0.8}
                    onPress={() => setModalVisible(true)}
                >
                    <Text style={styles.selectorText}>{selectedLanguageLabel}</Text>
                    <MaterialIcons name="arrow-drop-down" size={16} color={colors.primary} />
                </TouchableOpacity>
            )}

            <Modal
                visible={modalVisible}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => setModalVisible(false)}
            >
                <SafeAreaView style={styles.modalContainer}>
                    {/* Same header as the app's sheets: title on the start side, round close button. */}
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle} accessibilityRole="header">{t("aux.selectLanguage", "Select Language")}</Text>
                        <TouchableOpacity
                            style={styles.closeButton}
                            onPress={() => setModalVisible(false)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={t('a11y.close', 'Close')}
                        >
                            <MaterialIcons name="close" size={20} color={colors.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    {/* Search and list keep a readable width on tablets. */}
                    <View style={styles.modalBody}>
                    <View style={styles.searchContainer}>
                        <MaterialIcons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
                        <TextInput
                            containerStyle={styles.searchField}
                            style={styles.searchInput}
                            placeholder={t('aux.searchLanguage', 'Search language...')}
                            placeholderTextColor={colors.textSecondary}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoFocus={false}
                            clearButtonMode="while-editing"
                        />
                    </View>

                    <FlatList
                        data={filteredLanguages}
                        keyExtractor={(item) => item.key}
                        contentContainerStyle={styles.listContent}
                        renderItem={({ item }) => {
                            const isSelected = item.key === value;
                            return (
                                <TouchableOpacity
                                    style={[styles.languageItem, isSelected && styles.languageItemActive]}
                                    onPress={() => handleSelect(item.key)}
                                >
                                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                                         <Text style={[styles.languageText, isSelected && styles.languageTextActive]}>
                                             {getLanguageLabel(item)}
                                         </Text>
                                    </View>
                                    {isSelected && <MaterialIcons name="check" size={20} color={colors.primary} />}
                                </TouchableOpacity>
                            );
                        }}
                        ListEmptyComponent={
                            <View style={styles.emptyContainer}>
                                <Text style={styles.emptyText}>{t('aux.noLanguagesFound', 'No languages found for "{{query}}"', { query: searchQuery })}</Text>
                            </View>
                        }
                    />
                    </View>
                </SafeAreaView>
            </Modal>
        </View>
    );
};

const styles = createStyles(() => ({
    selectorButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingVertical: 4,
        paddingHorizontal: spacing.s,
        backgroundColor: colors.primary + '15',
        borderRadius: 8,
        gap: 2,
    },
    selectorText: {
        ...typography.body,
        fontSize: 13,
        color: colors.primary,
        fontWeight: '600',
    },
    modalContainer: {
        flex: 1,
        backgroundColor: colors.background,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.m,
        paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + spacing.m : spacing.m,
        paddingBottom: spacing.xs,
    },
    modalBody: {
        flex: 1,
        width: '100%',
        maxWidth: 680,
        alignSelf: 'center',
    },
    modalTitle: {
        flexShrink: 1,
        fontSize: 20,
        lineHeight: 26,
        fontWeight: '700',
        letterSpacing: -0.3,
        color: colors.text,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.backgroundSecondary,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.backgroundSecondary,
        margin: spacing.m,
        paddingHorizontal: spacing.s,
        borderRadius: 12,
    },
    searchIcon: {
        marginRight: spacing.xs,
    },
    searchField: {
        flex: 1,
        marginBottom: 0,
    },
    searchInput: {
        minHeight: 48,
        borderWidth: 0,
        backgroundColor: 'transparent',
        paddingHorizontal: spacing.xs,
        paddingVertical: 0,
        ...typography.body,
        color: colors.text,
    },
    listContent: {
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.xxl,
    },
    languageItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.m,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    languageItemActive: {
        // backgroundColor: colors.primary + '10', // Optional subtle highlight
    },
    languageText: {
        ...typography.body,
        color: colors.text,
    },
    languageTextActive: {
        fontWeight: '600',
    },
    emptyContainer: {
        padding: spacing.xl,
        alignItems: 'center',
    },
    emptyText: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
    },
}));
